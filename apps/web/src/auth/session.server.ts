import { randomBytes } from 'node:crypto';
import { deleteCookie, getCookie, getCookies, getRequest, setCookie } from '@tanstack/react-start/server';
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
 *
 * The cookies stay bounded: every request that carries any of them deletes the session cookies and tombstones of
 * other logins (left behind by overlapping sign-ins or late refreshes), so after it only the active login's session
 * and tombstone remain. A session cookie larger than SESSION_COOKIE_MAX_BYTES is never written: a browser would
 * drop it silently, so sign-in fails and a refresh signs out instead.
 */

const MAX_AGE_S = 60 * 60 * 24 * 30;
/** Refresh this long before the access token expires, so a token never runs out on its way to the API. */
const REFRESH_MARGIN_S = 60;
const LOGIN_ID = /^[A-Za-z0-9_-]{16}$/;
/** Name and value of one session cookie; below the 4096 bytes every browser must accept (RFC 6265, 6.1). */
export const SESSION_COOKIE_MAX_BYTES = 3_800;
/** The per-login cookies, with or without the `__Host-` prefix. */
const PER_LOGIN = /^(?:__Host-)?enduva-(?:session|ended)-(.*)$/;

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

/** Deletes every per-login cookie that doesn't belong to `keep` (all of them without an active login). */
function pruneOtherLogins(keep: string | undefined): void {
  for (const cookieName of Object.keys(getCookies())) {
    const id = PER_LOGIN.exec(cookieName)?.[1];
    if (id === undefined || id === keep) continue;
    deleteCookie(cookieName, authCookie(cookieName).options);
  }
}

async function loadSession(): Promise<RequestSession> {
  // Without any auth cookie, a signed-out page needs no auth configuration.
  const names = Object.keys(getCookies());
  if (!names.some((name) => /^(?:__Host-)?enduva-login$/.test(name) || PER_LOGIN.test(name)))
    return { loginId: undefined, session: null };
  const pointer = getCookie(loginCookie().name);
  const loginId = pointer !== undefined && LOGIN_ID.test(pointer) ? pointer : undefined;
  pruneOtherLogins(loginId);
  if (loginId === undefined) return { loginId: undefined, session: null };
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
      if (storeSession(loginId, refreshed.value)) return { loginId, session: refreshed.value };
      // Too large to store: signing out cleanly beats a cookie the browser would drop.
      console.error('Refreshed session exceeds the cookie budget; signing out');
      deleteSessionCookie(loginId);
      return { loginId, session: null };
    }
    // A refresh token Auth refuses (revoked, reused, signed out) ends this login. Rate limits and outages don't: the
    // next request tries again.
    if (refreshed.status !== 429 && refreshed.status < 500) deleteSessionCookie(loginId);
    return { loginId, session: null };
  } catch {
    return { loginId, session: null };
  }
}

/** Writes the login's session cookie, unless it would exceed SESSION_COOKIE_MAX_BYTES (then false, nothing written). */
function storeSession(loginId: string, session: AuthSession): boolean {
  const { name, options } = sessionCookie(loginId);
  const value = encodeSession(session);
  if (name.length + 1 + value.length > SESSION_COOKIE_MAX_BYTES) return false;
  setCookie(name, value, { ...options, maxAge: MAX_AGE_S });
  return true;
}

function deleteSessionCookie(loginId: string): void {
  const { name, options } = sessionCookie(loginId);
  deleteCookie(name, options);
}

/**
 * A new sign-in: a new login ID becomes the active one, and this request's previous login cookies go. False (and
 * nothing changed) if the session is too large for its cookie; the caller reports the sign-in as failed.
 */
export async function startLogin(session: AuthSession): Promise<boolean> {
  const previous = (await requestSession()).loginId;
  const loginId = randomBytes(12).toString('base64url');
  if (!storeSession(loginId, session)) {
    console.error('Session exceeds the cookie budget; sign-in refused');
    return false;
  }
  const { name, options } = loginCookie();
  setCookie(name, loginId, { ...options, maxAge: MAX_AGE_S });
  if (previous !== undefined) {
    deleteSessionCookie(previous);
    const ended = endedCookie(previous);
    if (getCookie(ended.name) !== undefined) deleteCookie(ended.name, ended.options);
  }
  perRequest.set(getRequest(), Promise.resolve({ loginId, session }));
  return true;
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
 * alone, since by the time this response arrives it may name a newer login from another tab. The tombstone records
 * whether Auth confirmed the sign-out (`revoked`), so a repeated sign-out can report the same, and it lives as long as
 * a session cookie could (a late refresh may write one); pruning keeps at most the active login's tombstone.
 */
export async function endSession(revoked: boolean): Promise<void> {
  const { loginId } = await requestSession();
  if (loginId !== undefined) {
    deleteSessionCookie(loginId);
    const { name, options } = endedCookie(loginId);
    setCookie(name, revoked ? 'revoked' : 'local', { ...options, maxAge: MAX_AGE_S });
  }
  perRequest.set(getRequest(), Promise.resolve({ loginId, session: null }));
}

/** Whether the active login was signed out on this device only (Auth didn't confirm), per its tombstone. */
export async function endedLocally(): Promise<boolean> {
  const { loginId } = await requestSession();
  return loginId !== undefined && getCookie(endedCookie(loginId).name) === 'local';
}
