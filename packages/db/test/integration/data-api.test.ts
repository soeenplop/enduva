// Supabase's Data API (PostgREST, pg_graphql) can't reach the API-only tables, with the publishable key or a user's
// token. The same tokens, verified against the local JWKS (asymmetric ES256 keys), drive withUserTx.
import { sql } from 'drizzle-orm';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withUserTx, type Database, type VerifiedClaims } from '../../src/index.js';
import { profiles } from '../../src/schema/index.js';
import { apiUrl, EMAILS, openDatabase, PASSWORDS, USER_A, USER_B } from './support.js';

const { apiUrl: supabaseUrl, publishableKey } = inject('supabase');
const issuer = `${supabaseUrl}/auth/v1`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));

/** Cloudflare's documented Turnstile test token, accepted by the local stack's test secret (supabase/config.toml). */
const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

async function signIn(userId: string): Promise<string> {
  const response = await fetch(`${issuer}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: publishableKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: EMAILS[userId],
      password: PASSWORDS[userId],
      gotrue_meta_security: { captcha_token: TURNSTILE_TEST_TOKEN },
    }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { access_token: string };
  return body.access_token;
}

/** What the API will do in 0.8: accept only ES256 tokens from the JWKS, with the exact issuer and audience. */
async function verify(token: string): Promise<VerifiedClaims> {
  const { payload } = await jwtVerify<JWTPayload & { role?: unknown }>(token, jwks, {
    algorithms: ['ES256'],
    issuer,
    audience: 'authenticated',
  });
  if (typeof payload.sub !== 'string' || payload.role !== 'authenticated') throw new Error('Not a user token');
  return { ...payload, sub: payload.sub, role: 'authenticated' };
}

const tokens: Record<string, string> = {};
beforeAll(async () => {
  tokens[USER_A] = await signIn(USER_A);
  tokens[USER_B] = await signIn(USER_B);
});

describe('access tokens', () => {
  it('are ES256-signed by a key from the JWKS', async () => {
    const { keys } = (await (await fetch(`${issuer}/.well-known/jwks.json`)).json()) as { keys: { kid: string }[] };
    const header = decodeProtectedHeader(tokens[USER_A] ?? '');
    expect(header.alg).toBe('ES256');
    expect(keys.map((key) => key.kid)).toContain(header.kid);
    await expect(verify(tokens[USER_A] ?? '')).resolves.toMatchObject({ sub: USER_A, role: 'authenticated' });
  });

  describe('drive withUserTx through the pooler', () => {
    let db: Database;
    beforeAll(() => {
      db = openDatabase(apiUrl('pooler'));
    });
    afterAll(async () => {
      await db.$client.end();
    });

    it.each([
      ['A', USER_A],
      ['B', USER_B],
    ])('%s sees only their own profile', async (_label, userId) => {
      const claims = await verify(tokens[userId] ?? '');
      const rows = await withUserTx(db, claims, (tx) => tx.select({ userId: profiles.userId }).from(profiles));
      expect(rows).toEqual([{ userId }]);
    });

    it('withUserTx sets the verified claims for the transaction', async () => {
      const claims = await verify(tokens[USER_A] ?? '');
      const { rows } = await withUserTx(db, claims, (tx) =>
        tx.execute<{ role: string; uid: string; session: string }>(
          sql`select current_user::text as role, app.current_user_id()::text as uid,
                     current_setting('request.jwt.claims', true)::jsonb ->> 'session_id' as session`,
        ),
      );
      expect(rows).toEqual([{ role: 'enduva_api', uid: USER_A, session: claims['session_id'] }]);
    });
  });
});

describe('Data API', () => {
  const callers = [
    ['the publishable key', () => ({ apikey: publishableKey })],
    ['user A', () => ({ apikey: publishableKey, authorization: `Bearer ${tokens[USER_A] ?? ''}` })],
  ] as const;

  describe.each(callers)('as %s', (_label, headers) => {
    it('rejects the app schema in PostgREST (not exposed)', async () => {
      const read = await fetch(`${supabaseUrl}/rest/v1/profiles?select=*`, {
        headers: { ...headers(), 'accept-profile': 'app' },
      });
      expect(read.status).toBe(406);
      expect(await read.json()).toMatchObject({ code: 'PGRST106' });

      const write = await fetch(`${supabaseUrl}/rest/v1/profiles`, {
        method: 'POST',
        headers: { ...headers(), 'content-profile': 'app', 'content-type': 'application/json' },
        body: JSON.stringify({ user_id: USER_B }),
      });
      expect(write.status).toBe(406);

      const rpc = await fetch(`${supabaseUrl}/rest/v1/rpc/current_user_id`, {
        method: 'POST',
        headers: { ...headers(), 'content-profile': 'app', 'content-type': 'application/json' },
        body: '{}',
      });
      expect(rpc.status).toBe(406);
    });

    it('has no app tables in the exposed schemas', async () => {
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?select=*`, { headers: headers() });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({ code: 'PGRST205' });
    });

    it('has no app tables in GraphQL', async () => {
      const response = await fetch(`${supabaseUrl}/graphql/v1`, {
        method: 'POST',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __schema { types { name } } }' }),
      });
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        data?: { __schema: { types: { name: string }[] } };
        errors?: { message: string }[];
      };
      // The local stack ships with pg_graphql disabled; hosted projects may enable it. Either way no app type
      // may show up (pg_graphql only reflects what the caller's role is granted, and that is nothing).
      if (body.data === undefined) {
        expect(body.errors).toEqual([{ message: 'pg_graphql extension is not enabled.' }]);
        return;
      }
      const names = body.data.__schema.types.map((type) => type.name.toLowerCase());
      expect(names.length).toBeGreaterThan(0);
      for (const table of ['profiles', 'usersettings', 'entitlements', 'consents', 'devices']) {
        expect(names.some((name) => name.includes(table))).toBe(false);
      }
    });
  });
});
