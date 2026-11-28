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
 * A fixed set of cookie names, so no sequence of overlapping responses can add cookies, only overwrite them:
 *
 * - `enduva-login` = `<slot>.<login ID>`: the active login. Only a sign-in writes it.
 * - `enduva-session-a` and `enduva-session-b` = `<login ID>.<tokens>`: two slots. A sign-in takes the slot its
 *   request's active login doesn't use, so the previous login's slot is never in its way.
 * - `enduva-ended-a` and `enduva-ended-b` = `<login ID>.<revoked|local>`: per slot, the last login signed out there.
 *
 * A session counts only if its slot holds the active login's ID and that slot's marker doesn't name it. So a
 * response that arrives late can never put another account in place, or bring a signed-out one back:
 *
 * - a refresh of A after another tab signed in as B writes A's slot, which B's pointer doesn't use;
 * - a sign-out of A leaves `enduva-login` alone; it deletes A's slot and marks A ended in that slot's marker, which a
 *   late refresh of A can't undo;
 * - a late sign-out of A writes only slot A's marker, never B's, and B's own sign-out already deleted B's tokens, so
 *   no marker overwrite can revive a session.
 *
 * When enough races overlap that two logins meet in one slot, the IDs don't match and the browser is signed out,
 * never switched.
 *
 * Worst case, the browser holds the pointer, two full slots (each at most SESSION_COOKIE_MAX_BYTES) and two markers:
 * under 8 KiB, half of Node's default 16 KiB request-header limit (test/http-budget.test.ts). A session too large for
 * its slot is never written: sign-in fails and a refresh signs out, rather than leaving a cookie a browser would drop.
 */

const MAX_AGE_S = 60 * 60 * 24 * 30;
/** Refresh this long before the access token expires, so a token never runs out on its way to the API. */
const REFRESH_MARGIN_S = 60;
/** Name and value of one session cookie; below the 4096 bytes every browser must accept (RFC 6265, 6.1). */
export const SESSION_COOKIE_MAX_BYTES = 3_800;

type Slot = 'a' | 'b';

/** An auth cookie: `__Host-` prefixed and `Secure` when the app's origin is https. */
export function authCookie(name: string) {
  const secure = new URL(webOrigin(getRequest().url)).protocol === 'https:';
  return {
    name: secure ? `__Host-${name}` : name,
    options: { httpOnly: true, secure, sameSite: 'lax', path: '/' } as const,
  };
}

const loginCookie = () => authCookie('enduva-login');
const slotCookie = (slot: Slot) => authCookie(`enduva-session-${slot}`);
const endedCookie = (slot: Slot) => authCookie(`enduva-ended-${slot}`);
const AUTH_COOKIE = /^(?:__Host-)?enduva-(?:login|session-[ab]|ended-[ab])$/;

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

/** A cookie value `<login ID>.<rest>`, split; undefined unless the ID is well-formed. */
function tagged(value: string | undefined): { loginId: string; rest: string } | undefined {
  const match = /^([A-Za-z0-9_-]{16})\.(.+)$/.exec(value ?? '');
  return match?.[1] === undefined || match[2] === undefined ? undefined : { loginId: match[1], rest: match[2] };
}

interface Active {
  readonly slot: Slot;
  readonly loginId: string;
}

interface RequestSession {
  /** The login this request's cookies named as active, if any (also when its session is gone). */
  readonly active: Active | undefined;
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

function readActive(): Active | undefined {
  const match = /^([ab])\.([A-Za-z0-9_-]{16})$/.exec(getCookie(loginCookie().name) ?? '');
  const [, slot, loginId] = match ?? [];
  return (slot === 'a' || slot === 'b') && loginId !== undefined ? { slot, loginId } : undefined;
}

/** What the slot's marker says about this login: `revoked`, `local`, or undefined if it names another (or none). */
function endedFor({ slot, loginId }: Active): string | undefined {
  const ended = tagged(getCookie(endedCookie(slot).name));
  return ended?.loginId === loginId ? ended.rest : undefined;
}

async function loadSession(): Promise<RequestSession> {
  // Without any auth cookie, a signed-out page needs no auth configuration.
  if (!Object.keys(getCookies()).some((name) => AUTH_COOKIE.test(name))) return { active: undefined, session: null };
  const active = readActive();
  if (active === undefined) return { active: undefined, session: null };
  const slot = tagged(getCookie(slotCookie(active.slot).name));
  // Another login in the active slot (overlapping sign-ins): signed out, never switched.
  if (slot?.loginId !== active.loginId) return { active, session: null };
  if (endedFor(active) !== undefined) {
    // Signed out; whatever a late refresh wrote back for this login goes (this request saw it in the slot).
    deleteSlot(active.slot);
    return { active, session: null };
  }
  const stored = decodeSession(slot.rest);
  if (stored === null) return { active, session: null };
  if (stored.expiresAt - Date.now() / 1000 > REFRESH_MARGIN_S) return { active, session: stored };
  try {
    const refreshed = await refreshSession(stored.refreshToken);
    if (refreshed.ok) {
      if (storeSession(active, refreshed.value)) return { active, session: refreshed.value };
      // Too large to store: signing out cleanly beats a cookie the browser would drop.
      console.error('Refreshed session exceeds the cookie budget; signing out');
      deleteSlot(active.slot);
      return { active, session: null };
    }
    // A refresh token Auth refuses (revoked, reused, signed out) ends this login. Rate limits and outages don't: the
    // next request tries again.
    if (refreshed.status !== 429 && refreshed.status < 500) deleteSlot(active.slot);
    return { active, session: null };
  } catch {
    return { active, session: null };
  }
}

/** Writes the login's slot, unless it would exceed SESSION_COOKIE_MAX_BYTES (then false, nothing written). */
function storeSession({ slot, loginId }: Active, session: AuthSession): boolean {
  const { name, options } = slotCookie(slot);
  const value = `${loginId}.${encodeSession(session)}`;
  if (name.length + 1 + value.length > SESSION_COOKIE_MAX_BYTES) return false;
  setCookie(name, value, { ...options, maxAge: MAX_AGE_S });
  return true;
}

function deleteSlot(slot: Slot): void {
  const { name, options } = slotCookie(slot);
  deleteCookie(name, options);
}

/** Whether this request came from a browser with a login that wasn't signed out, whatever state its session is in. */
export async function hasLogin(): Promise<boolean> {
  const { active } = await requestSession();
  return active !== undefined && endedFor(active) === undefined;
}

/**
 * A new sign-in: a new login ID in the slot the request's active login doesn't use becomes the active one, and the
 * previous login's slot is cleared. False (and nothing changed) if the session is too large for its cookie; the
 * caller reports the sign-in as failed.
 */
export async function startLogin(session: AuthSession): Promise<boolean> {
  const previous = (await requestSession()).active;
  const next: Active = { slot: previous?.slot === 'a' ? 'b' : 'a', loginId: randomBytes(12).toString('base64url') };
  if (!storeSession(next, session)) {
    console.error('Session exceeds the cookie budget; sign-in refused');
    return false;
  }
  const { name, options } = loginCookie();
  setCookie(name, `${next.slot}.${next.loginId}`, { ...options, maxAge: MAX_AGE_S });
  if (previous !== undefined) deleteSlot(previous.slot);
  perRequest.set(getRequest(), Promise.resolve({ active: next, session }));
  return true;
}

/**
 * Drops the session this request started with, after the API or Auth refused it. Only its own slot: the login
 * cookie may already name a newer login in this browser.
 */
export async function dropSession(): Promise<void> {
  const { active } = await requestSession();
  if (active !== undefined) deleteSlot(active.slot);
  perRequest.set(getRequest(), Promise.resolve({ active, session: null }));
}

/**
 * Sign-out of the login this request started with: its slot's session goes at once, and its slot's marker names it,
 * with whether Auth confirmed the sign-out (`revoked`), so a repeated sign-out can report the same. `enduva-login`
 * and the other slot are left alone, since by the time this response arrives another tab may have signed in. The
 * marker lives as long as a session cookie could, because a late refresh may write one.
 */
export async function endSession(revoked: boolean): Promise<void> {
  const { active } = await requestSession();
  if (active !== undefined) {
    deleteSlot(active.slot);
    const { name, options } = endedCookie(active.slot);
    setCookie(name, `${active.loginId}.${revoked ? 'revoked' : 'local'}`, { ...options, maxAge: MAX_AGE_S });
  }
  perRequest.set(getRequest(), Promise.resolve({ active, session: null }));
}

/** Whether the active login was signed out on this device only (Auth didn't confirm), per its slot's marker. */
export async function endedLocally(): Promise<boolean> {
  const { active } = await requestSession();
  return active !== undefined && endedFor(active) === 'local';
}
