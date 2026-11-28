import { authBaseUrl, authPublishableKey } from '../config.server';

/**
 * The few Supabase Auth (GoTrue) endpoints the web server needs, called over its REST API. Only the web server talks
 * to Auth: the browser never sees an access or refresh token. Nothing is kept in module state.
 */

/** What the session cookie stores: the tokens and the access token's expiry (Unix seconds). */
export interface AuthSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: number;
}

/** Auth's `error_code` (e.g. `invalid_credentials`), or `unexpected_response` if it sent none. */
export type AuthResult<T> = { ok: true; value: T } | { ok: false; status: number; code: string };

const TIMEOUT_MS = 5_000;

async function post(path: string, body: object, accessToken?: string): Promise<AuthResult<unknown>> {
  const res = await fetch(new URL(`auth/v1/${path}`, authBaseUrl()), {
    method: 'POST',
    headers: {
      apikey: authPublishableKey(),
      'content-type': 'application/json',
      ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json: unknown = await res.json().catch(() => undefined);
  if (res.ok) return { ok: true, value: json };
  const code = (json as { error_code?: unknown } | undefined)?.error_code;
  return { ok: false, status: res.status, code: typeof code === 'string' ? code : 'unexpected_response' };
}

function toSession(result: AuthResult<unknown>): AuthResult<AuthSession> {
  if (!result.ok) return result;
  const { access_token: a, refresh_token: r, expires_at: e } = (result.value ?? {}) as Record<string, unknown>;
  if (typeof a === 'string' && typeof r === 'string' && typeof e === 'number' && a !== '' && r !== '')
    return { ok: true, value: { accessToken: a, refreshToken: r, expiresAt: e } };
  return { ok: false, status: 502, code: 'unexpected_response' };
}

const security = (captchaToken: string) => ({ gotrue_meta_security: { captcha_token: captchaToken } });

/** Creates an unconfirmed user; Auth mails the confirmation link (supabase/templates/confirmation.html). */
export const signUp = (email: string, password: string, captchaToken: string, locale: string) =>
  post('signup', { email, password, data: { locale }, ...security(captchaToken) });

export const signInWithPassword = async (email: string, password: string, captchaToken: string) =>
  toSession(await post('token?grant_type=password', { email, password, ...security(captchaToken) }));

/** Mails a sign-in link to an existing user (`create_user: false`: a magic link never signs anyone up). */
export const sendMagicLink = (email: string, captchaToken: string) =>
  post('otp', { email, create_user: false, ...security(captchaToken) });

/** Redeems the token hash of a confirmation or magic-link mail (single use). */
export const verifyEmailLink = async (tokenHash: string) =>
  toSession(await post('verify', { type: 'email', token_hash: tokenHash }));

export const refreshSession = async (refreshToken: string) =>
  toSession(await post('token?grant_type=refresh_token', { refresh_token: refreshToken }));

/** Exchanges an OAuth authorization code for a session, with the PKCE verifier this browser holds. */
export const exchangeCode = async (authCode: string, codeVerifier: string) =>
  toSession(await post('token?grant_type=pkce', { auth_code: authCode, code_verifier: codeVerifier }));

/** Ends this session at Auth (`scope=local`: the user's other devices stay signed in). */
export const signOut = (accessToken: string) => post('logout?scope=local', {}, accessToken);

/** The URL that starts an OAuth sign-in at Auth, which redirects back to `redirectTo` with `?code=`. */
export function authorizeUrl(provider: 'google', redirectTo: string, codeChallenge: string): string {
  const url = new URL('auth/v1/authorize', authBaseUrl());
  url.search = new URLSearchParams({
    provider,
    redirect_to: redirectTo,
    code_challenge: codeChallenge,
    code_challenge_method: 's256',
  }).toString();
  return url.href;
}

/** Whether Google sign-in is enabled for the project (Auth's public settings). False if Auth can't be asked. */
export async function googleEnabled(): Promise<boolean> {
  try {
    const res = await fetch(new URL('auth/v1/settings', authBaseUrl()), {
      headers: { apikey: authPublishableKey() },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json()) as { external?: { google?: unknown } };
    return res.ok && body.external?.google === true;
  } catch {
    return false;
  }
}
