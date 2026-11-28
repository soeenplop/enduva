import { randomBytes } from 'node:crypto';
import { deleteCookie, getCookie, getRequest, setCookie } from '@tanstack/react-start/server';
import { webOrigin } from '../config.server';
import { type AuthSession, refreshSession } from './gotrue.server';

/**
 * Sessions live in cookies only the web server reads: `HttpOnly`, `SameSite=Lax`, and `Secure` with the `__Host-`
 * prefix whenever the app is served over https. They hold the access token, the refresh token and the access token's
 * expiry. The web server never trusts the access token itself: it only forwards it to the API, which verifies it on
 * every request (02-architecture.md, Authentication).
 *
 * Every sign-in gets a random login ID. `enduva-login` names the active login, and its tokens are in
 * `enduva-session-<id>`. A refresh, or dropping a session the API or Auth refused, only ever touches the cookie of
 * the login it started from. So a response that arrives late (a tab refreshing account A after another tab signed
 * in as B) can't replace or clear B: the browser keeps `enduva-login` pointing at B.
 *
 * Sign-out doesn't touch `enduva-login` either (another tab may have just signed in). It deletes the login's session
 * and leaves a tombstone, `enduva-ended-<id>`, so a refresh of that login that answers later can't bring it back.
 */

const MAX_AGE_S = 60 * 60 * 24 * 30;
/** Refresh this long before the access token expires, so a token never runs out on its way to the API. */
const REFRESH_MARGIN_S = 60;
const LOGIN_ID = /^[A-Za-z0-9_-]{16}$/;

/** An auth cookie: `__Host-` prefixed and `Secure` when the app's origin is https. */
export function authCookie(name: string) {
  const secure = new URL(webOrigin(getRequest().url)).protocol === 'https:';
  return {
    name: secure ? `__Host-${name}` : name,
    options: { httpOnly: true, secure, sameSite: 'lax', path: '/' } as const,
  };
}

const loginCookie = () => authCookie('enduva-login');
const sessionCookie = (loginId: string) => authCookie(`enduva-session-${loginId}`);
const endedCookie = (loginId: string) => authCookie(`enduva-ended-${loginId}`);

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

interface RequestSession {
  /** The login this request's cookies named, if any (also when its session is gone). */
  readonly loginId: string | undefined;
  readonly session: AuthSession | null;
}

/** One lookup (and at most one refresh) per request, however many server functions a page runs. */
const perRequest = new WeakMap<Request, Promise<RequestSession>>();

function requestSession(): Promise<RequestSession> {
  const request = getRequest();
  let current = perRequest.get(request);
  if (current === undefined) {
    current = loadSession();
    perRequest.set(request, current);
  }
  return current;
}

/** This request's session, refreshed if it is about to expire; null when signed out. */
export async function getSession(): Promise<AuthSession | null> {
  return (await requestSession()).session;
}

async function loadSession(): Promise<RequestSession> {
  // Without a login cookie, a signed-out page needs no auth configuration.
  if (getCookie('__Host-enduva-login') === undefined && getCookie('enduva-login') === undefined)
    return { loginId: undefined, session: null };
  const loginId = getCookie(loginCookie().name);
  if (loginId === undefined || !LOGIN_ID.test(loginId)) return { loginId: undefined, session: null };
  if (getCookie(endedCookie(loginId).name) !== undefined) {
    // Signed out. Whatever a late refresh wrote for this login is never used.
    if (getCookie(sessionCookie(loginId).name) !== undefined) deleteSessionCookie(loginId);
    return { loginId, session: null };
  }
  const stored = decodeSession(getCookie(sessionCookie(loginId).name));
  if (stored === null) return { loginId, session: null };
  if (stored.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return { loginId, session: stored };
  try {
    const refreshed = await refreshSession(stored.refreshToken);
    if (refreshed.ok) {
      storeSession(loginId, refreshed.value);
      return { loginId, session: refreshed.value };
    }
    // A refresh token Auth refuses (revoked, reused, signed out) ends this login. Rate limits and outages don't: the
    // next request tries again.
    if (refreshed.status !== 429 && refreshed.status < 500) deleteSessionCookie(loginId);
    return { loginId, session: null };
  } catch {
    return { loginId, session: null };
  }
}

function storeSession(loginId: string, session: AuthSession): void {
  const { name, options } = sessionCookie(loginId);
  setCookie(name, encodeSession(session), { ...options, maxAge: MAX_AGE_S });
}

function deleteSessionCookie(loginId: string): void {
  const { name, options } = sessionCookie(loginId);
  deleteCookie(name, options);
}

/** Whether this request came from a browser with a login that wasn't signed out, whatever state its session is in. */
export async function hasLogin(): Promise<boolean> {
  const { loginId } = await requestSession();
  return loginId !== undefined && getCookie(endedCookie(loginId).name) === undefined;
}

/** A new sign-in: a new login ID becomes the active one, and this request's previous login cookies go. */
export async function startLogin(session: AuthSession): Promise<void> {
  const previous = (await requestSession()).loginId;
  const loginId = randomBytes(12).toString('base64url');
  storeSession(loginId, session);
  const { name, options } = loginCookie();
  setCookie(name, loginId, { ...options, maxAge: MAX_AGE_S });
  if (previous !== undefined) {
    deleteSessionCookie(previous);
    const ended = endedCookie(previous);
    if (getCookie(ended.name) !== undefined) deleteCookie(ended.name, ended.options);
  }
  perRequest.set(getRequest(), Promise.resolve({ loginId, session }));
}

/**
 * Drops the session this request started with, after the API or Auth refused it. Only its own cookie: the login
 * cookie may already name a newer login in this browser.
 */
export async function dropSession(): Promise<void> {
  const { loginId } = await requestSession();
  if (loginId !== undefined) deleteSessionCookie(loginId);
  perRequest.set(getRequest(), Promise.resolve({ loginId, session: null }));
}

/**
 * Sign-out of the login this request started with: its session goes and a tombstone stays. `enduva-login` is left
 * alone, since by the time this response arrives it may name a newer login from another tab.
 */
export async function endSession(): Promise<void> {
  const { loginId } = await requestSession();
  if (loginId !== undefined) {
    deleteSessionCookie(loginId);
    const { name, options } = endedCookie(loginId);
    setCookie(name, '1', { ...options, maxAge: MAX_AGE_S });
  }
  perRequest.set(getRequest(), Promise.resolve({ loginId, session: null }));
}
