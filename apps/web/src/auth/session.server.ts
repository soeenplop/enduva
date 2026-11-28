import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { webOrigin } from '../config.server';
import { type AuthSession, refreshSession } from './gotrue.server';

/**
 * The session lives in one cookie that only the web server reads: `HttpOnly`, `SameSite=Lax`, and `Secure` with the
 * `__Host-` prefix whenever the app is served over https. It holds the access token, the refresh token and the
 * access token's expiry. The web server never trusts the access token itself: it only forwards it to the API, which
 * verifies it on every request (02-architecture.md, Authentication).
 */

const MAX_AGE_S = 60 * 60 * 24 * 30;
/** Refresh this long before the access token expires, so a token never runs out on its way to the API. */
const REFRESH_MARGIN_S = 60;

/** An auth cookie: `__Host-` prefixed and `Secure` when the app's origin is https. */
export function authCookie(name: 'enduva-session' | 'enduva-oauth') {
  const secure = new URL(webOrigin(getRequest().url)).protocol === 'https:';
  return {
    name: secure ? `__Host-${name}` : name,
    options: { httpOnly: true, secure, sameSite: 'lax', path: '/' } as const,
  };
}

const cookie = () => authCookie('enduva-session');

export function encodeSession({ accessToken, refreshToken, expiresAt }: AuthSession): string {
  return Buffer.from(JSON.stringify([accessToken, refreshToken, expiresAt])).toString('base64url');
}

export function decodeSession(value: string | undefined): AuthSession | null {
  if (value === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [accessToken, refreshToken, expiresAt] = parsed as unknown[];
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string' || typeof expiresAt !== 'number')
      return null;
    return { accessToken, refreshToken, expiresAt };
  } catch {
    return null;
  }
}

/** One lookup (and at most one refresh) per request, however many server functions a page runs. */
const perRequest = new WeakMap<Request, Promise<AuthSession | null>>();

/** This request's session, refreshed if it is about to expire; null when signed out. */
export function getSession(): Promise<AuthSession | null> {
  const request = getRequest();
  let session = perRequest.get(request);
  if (session === undefined) {
    session = loadSession();
    perRequest.set(request, session);
  }
  return session;
}

async function loadSession(): Promise<AuthSession | null> {
  // Without any session cookie, a signed-out page needs no auth configuration.
  if (getCookie('__Host-enduva-session') === undefined && getCookie('enduva-session') === undefined) return null;
  const { name } = cookie();
  const stored = decodeSession(getCookie(name));
  if (stored === null) {
    if (getCookie(name) !== undefined) clearSession();
    return null;
  }
  if (stored.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return stored;
  try {
    const refreshed = await refreshSession(stored.refreshToken);
    if (refreshed.ok) {
      writeSession(refreshed.value);
      return refreshed.value;
    }
    // A refresh token Auth refuses (revoked, reused, signed out) ends the session. Rate limits and outages don't:
    // the next request tries again.
    if (refreshed.status !== 429 && refreshed.status < 500) clearSession();
    return null;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  const { name, options } = cookie();
  setCookie(name, encodeSession(session), { ...options, maxAge: MAX_AGE_S });
  perRequest.set(getRequest(), Promise.resolve(session));
}

export function clearSession(): void {
  const { name, options } = cookie();
  deleteCookie(name, options);
  perRequest.set(getRequest(), Promise.resolve(null));
}
