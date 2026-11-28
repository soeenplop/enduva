import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { decodeJwt } from 'jose';

// The LOCAL Supabase stack only (`pnpm --filter @enduva/db db:start` + `db:reset`), never a hosted project: URLs and
// keys come from `supabase status`, users are synthetic.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

/** Transaction pooler as the API login, with its local development password from supabase/seed.sql. */
export const LOCAL_POOLER_URL = 'postgresql://enduva_api_login.pooler-dev:enduva-local-api@127.0.0.1:54329/postgres';

export interface LocalAuth {
  readonly issuer: string;
  readonly publishableKey: string;
  readonly secretKey: string;
}

/** The running stack's Auth URL and keys, or undefined if no stack runs (CI: the e2e suites are skipped). */
export function localAuth(): LocalAuth | undefined {
  try {
    const stdout = execFileSync('supabase', ['status', '--output', 'json', '--workdir', repoRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    });
    const {
      API_URL: apiUrl,
      PUBLISHABLE_KEY: publishableKey,
      SECRET_KEY: secretKey,
    } = JSON.parse(stdout) as Record<string, string | undefined>;
    if (apiUrl === undefined || publishableKey === undefined || secretKey === undefined) return undefined;
    return { issuer: `${apiUrl}/auth/v1`, publishableKey, secretKey };
  } catch {
    return undefined;
  }
}

export interface Session {
  readonly accessToken: string;
  readonly userId: string;
  readonly sessionId: string;
}

interface Call {
  readonly method: 'POST' | 'PUT' | 'DELETE';
  readonly body?: string;
  readonly admin?: boolean;
  readonly headers?: Readonly<Record<string, string>>;
}

async function call(auth: LocalAuth, path: string, { method, body, admin, headers }: Call): Promise<unknown> {
  const key = admin === true ? auth.secretKey : auth.publishableKey;
  const response = await fetch(`${auth.issuer}${path}`, {
    method,
    ...(body === undefined ? {} : { body }),
    headers: { apikey: key, 'content-type': 'application/json', ...headers },
  });
  if (!response.ok) throw new Error(`Local Auth ${method} ${path}: ${response.status}`);
  return response.status === 204 ? undefined : response.json();
}

/**
 * Cloudflare's documented Turnstile test token. The local stack verifies captchas with Cloudflare's test secret
 * (supabase/config.toml), which accepts it; production secrets refuse it.
 */
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** Signs in through the local Auth server (email + password), as a client would. */
export async function signIn(auth: LocalAuth, email: string, password: string): Promise<Session> {
  const body = (await call(auth, '/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: TURNSTILE_TEST_TOKEN } }),
  })) as { access_token: string };
  const { sub, session_id: sessionId } = decodeJwt(body.access_token);
  return { accessToken: body.access_token, userId: String(sub), sessionId: String(sessionId) };
}

/** Creates a confirmed synthetic user through the Admin API and signs them in. */
export async function newUser(auth: LocalAuth): Promise<Session> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = randomUUID();
  await call(auth, '/admin/users', {
    method: 'POST',
    admin: true,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  return signIn(auth, email, password);
}

export const deleteUser = (auth: LocalAuth, userId: string, soft = false) =>
  call(auth, `/admin/users/${userId}`, {
    method: 'DELETE',
    admin: true,
    body: JSON.stringify({ should_soft_delete: soft }),
  });

export const banUser = (auth: LocalAuth, userId: string) =>
  call(auth, `/admin/users/${userId}`, { method: 'PUT', admin: true, body: JSON.stringify({ ban_duration: '24h' }) });

/** Signs the session out (Auth deletes it); the access token itself stays valid until it expires. */
export const signOut = (auth: LocalAuth, session: Session) =>
  call(auth, '/logout?scope=local', { method: 'POST', headers: { authorization: `Bearer ${session.accessToken}` } });
