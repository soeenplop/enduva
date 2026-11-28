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

export const refreshSession = async (refreshToken: string) =>
  toSession(await post('token?grant_type=refresh_token', { refresh_token: refreshToken }));
