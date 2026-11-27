import { base64url, createLocalJWKSet, type CryptoKey, exportSPKI, importJWK, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AuthUnavailableError,
  CLOCK_SKEW_SECONDS,
  InvalidTokenError,
  remoteKeys,
  TokenVerifier,
} from '../src/auth/token-verifier.js';
import {
  accessClaims,
  jwksServer,
  sign,
  type SigningKey,
  signingKey,
  TEST_SESSION,
  TEST_USER,
} from './jwks-fixture.js';

const issuer = 'http://127.0.0.1:54321/auth/v1';
const now = 1_800_000_000;

let key: SigningKey;
let rsaKey: SigningKey;
let verifier: TokenVerifier;

beforeAll(async () => {
  key = await signingKey('ES256');
  rsaKey = await signingKey('RS256');
  verifier = new TokenVerifier({
    issuer,
    algorithm: 'ES256',
    keys: createLocalJWKSet({ keys: [key.jwk, rsaKey.jwk] }),
    now: () => now,
  });
});

const claims = (overrides: Readonly<Record<string, unknown>> = {}) => ({ ...accessClaims(issuer, now), ...overrides });

function without(name: string) {
  const { [name]: _dropped, ...rest } = accessClaims(issuer, now);
  return rest;
}

const unsigned = (header: object, payload: object, signature = '') =>
  `${base64url.encode(JSON.stringify(header))}.${base64url.encode(JSON.stringify(payload))}.${signature}`;

describe('TokenVerifier', () => {
  it('accepts a Supabase access token and keeps only sub, role and session_id', async () => {
    await expect(verifier.verify(await sign(key, claims()))).resolves.toEqual({
      sub: TEST_USER,
      role: 'authenticated',
      session_id: TEST_SESSION,
    });
  });

  it.each([
    ['another issuer', { iss: 'https://evil.example/auth/v1' }],
    ['the issuer with a trailing slash', { iss: `${issuer}/` }],
    ['a missing issuer', { iss: undefined }],
    ['another audience', { aud: 'anon' }],
    ['an audience list without authenticated', { aud: ['anon', 'service'] }],
    ['an audience list with authenticated and more', { aud: ['authenticated', 'other-service'] }],
    ['authenticated as a one-element list', { aud: ['authenticated'] }],
    ['the anon role', { role: 'anon' }],
    ['the service_role role', { role: 'service_role' }],
    ['a sub that is not a UUID', { sub: 'athlete-a' }],
    ['a session_id that is not a UUID', { session_id: 'session-1' }],
    ['an anonymous user', { is_anonymous: true }],
    ['an expiry beyond the clock skew', { exp: now - CLOCK_SKEW_SECONDS - 1 }],
    ['an iat in the future beyond the clock skew', { iat: now + CLOCK_SKEW_SECONDS + 1 }],
    ['an nbf in the future beyond the clock skew', { nbf: now + CLOCK_SKEW_SECONDS + 1 }],
  ])('rejects %s', async (_case, overrides) => {
    await expect(verifier.verify(await sign(key, claims(overrides)))).rejects.toThrow(InvalidTokenError);
  });

  it.each(['exp', 'iat', 'sub', 'role', 'session_id', 'aud'])('rejects a token without %s', async (name) => {
    await expect(verifier.verify(await sign(key, without(name)))).rejects.toThrow(InvalidTokenError);
  });

  it('tolerates the clock skew on exp and iat', async () => {
    const skewed = claims({ exp: now - CLOCK_SKEW_SECONDS + 1, iat: now + CLOCK_SKEW_SECONDS });
    await expect(verifier.verify(await sign(key, skewed))).resolves.toMatchObject({ sub: TEST_USER });
  });

  it('rejects an RS256 token from the same key set when ES256 is configured, and the reverse', async () => {
    await expect(verifier.verify(await sign(rsaKey, claims()))).rejects.toThrow(InvalidTokenError);
    const rsaVerifier = new TokenVerifier({
      issuer,
      algorithm: 'RS256',
      keys: createLocalJWKSet({ keys: [key.jwk, rsaKey.jwk] }),
      now: () => now,
    });
    await expect(rsaVerifier.verify(await sign(rsaKey, claims()))).resolves.toMatchObject({ sub: TEST_USER });
    await expect(rsaVerifier.verify(await sign(key, claims()))).rejects.toThrow(InvalidTokenError);
  });

  it('rejects alg none', async () => {
    const token = unsigned({ alg: 'none', typ: 'JWT', kid: key.kid }, claims());
    await expect(verifier.verify(token)).rejects.toThrow(InvalidTokenError);
  });

  it('rejects HS256, also with the public key as the HMAC secret (algorithm confusion)', async () => {
    const publicPem = await exportSPKI((await importJWK(key.jwk, 'ES256')) as CryptoKey);
    for (const secret of [new TextEncoder().encode(publicPem), new TextEncoder().encode('super-secret-jwt-token')]) {
      const token = await new SignJWT(claims()).setProtectedHeader({ alg: 'HS256', kid: key.kid }).sign(secret);
      await expect(verifier.verify(token)).rejects.toThrow(InvalidTokenError);
    }
  });

  it('rejects an unknown key ID, a forged signature and a tampered payload', async () => {
    const stranger = await signingKey('ES256');
    await expect(verifier.verify(await sign(stranger, claims()))).rejects.toThrow(InvalidTokenError);
    await expect(verifier.verify(await sign({ ...stranger, kid: key.kid }, claims()))).rejects.toThrow(
      InvalidTokenError,
    );
    const [header, , signature] = (await sign(key, claims())).split('.');
    const tampered = `${header}.${base64url.encode(JSON.stringify(claims({ sub: '0000000b-0000-4000-8000-00000000000b' })))}.${signature}`;
    await expect(verifier.verify(tampered)).rejects.toThrow(InvalidTokenError);
  });

  it.each([
    ['an empty token', ''],
    ['garbage', 'not-a-jwt'],
    ['an oversized token', `${'a'.repeat(8193)}`],
  ])('rejects %s without trying to verify it', async (_case, token) => {
    await expect(verifier.verify(token)).rejects.toThrow(InvalidTokenError);
  });
});

describe('remote JWKS', () => {
  let server: Awaited<ReturnType<typeof jwksServer>>;
  let first: SigningKey;

  beforeAll(async () => {
    first = await signingKey('ES256');
    server = await jwksServer([first]);
  });
  afterAll(async () => {
    await server.close();
  });

  const remoteVerifier = (cooldownMs?: number) =>
    new TokenVerifier({
      issuer: server.issuer,
      algorithm: 'ES256',
      keys: remoteKeys(server.issuer, cooldownMs === undefined ? {} : { cooldownMs }),
    });
  const token = (signer: SigningKey) => sign(signer, accessClaims(server.issuer, Math.floor(Date.now() / 1000)));

  it('fetches the key set once and serves later tokens from the cache', async () => {
    server.state.fetches = 0;
    const remote = remoteVerifier();
    await expect(remote.verify(await token(first))).resolves.toMatchObject({ sub: TEST_USER });
    await expect(remote.verify(await token(first))).resolves.toMatchObject({ sub: TEST_USER });
    expect(server.state.fetches).toBe(1);
  });

  it('picks up a rotated key by refetching for an unknown key ID', async () => {
    const remote = remoteVerifier(0);
    await remote.verify(await token(first));
    const next = await signingKey('ES256');
    server.state.keys = [first, next];
    await expect(remote.verify(await token(next))).resolves.toMatchObject({ sub: TEST_USER });
    server.state.keys = [first];
  });

  it('fails closed with AuthUnavailableError when the key set cannot be fetched', async () => {
    server.state.status = 500;
    try {
      await expect(remoteVerifier().verify(await token(first))).rejects.toThrow(AuthUnavailableError);
    } finally {
      server.state.status = 200;
    }
    const nobody = new TokenVerifier({
      issuer: 'http://127.0.0.1:1/auth/v1',
      algorithm: 'ES256',
      keys: remoteKeys('http://127.0.0.1:1/auth/v1'),
    });
    await expect(nobody.verify(await token(first))).rejects.toThrow(AuthUnavailableError);
  });

  /** A verifier on a clock the test moves (milliseconds). */
  function clocked(options: { readonly cacheMaxAgeMs?: number } = {}) {
    const clock = { ms: 1_000_000 };
    const remote = new TokenVerifier({
      issuer: server.issuer,
      algorithm: 'ES256',
      keys: remoteKeys(server.issuer, { cooldownMs: 30_000, now: () => clock.ms, ...options }),
    });
    return { clock, remote };
  }

  it('limits failed fetches to one per cooldown during an outage, also for concurrent requests', async () => {
    const { clock, remote } = clocked();
    const signed = await token(first);
    server.state.status = 500;
    server.state.fetches = 0;
    try {
      const attempts = Array.from({ length: 5 }, () => remote.verify(signed));
      for (const attempt of attempts) await expect(attempt).rejects.toThrow(AuthUnavailableError);
      for (let i = 0; i < 5; i += 1) await expect(remote.verify(signed)).rejects.toThrow(AuthUnavailableError);
      expect(server.state.fetches).toBe(1);
      clock.ms += 29_999;
      await expect(remote.verify(signed)).rejects.toThrow(AuthUnavailableError);
      expect(server.state.fetches).toBe(1);
      clock.ms += 1;
      await expect(remote.verify(signed)).rejects.toThrow(AuthUnavailableError);
      expect(server.state.fetches).toBe(2);
    } finally {
      server.state.status = 200;
    }
    // Recovered: the next attempt after the cooldown fetches and verifies again.
    clock.ms += 30_000;
    await expect(remote.verify(signed)).resolves.toMatchObject({ sub: TEST_USER });
    expect(server.state.fetches).toBe(3);
  });

  it('keeps verifying with fresh keys while refetches for unknown keys fail, one fetch per cooldown', async () => {
    const { clock, remote } = clocked();
    const known = await token(first);
    const unknown = await token(await signingKey('ES256'));
    server.state.fetches = 0;
    await remote.verify(known);
    server.state.status = 500;
    try {
      clock.ms += 30_000;
      await expect(remote.verify(unknown)).rejects.toThrow(AuthUnavailableError);
      for (let i = 0; i < 5; i += 1) await expect(remote.verify(unknown)).rejects.toThrow(InvalidTokenError);
      await expect(remote.verify(known)).resolves.toMatchObject({ sub: TEST_USER });
      expect(server.state.fetches).toBe(2);
    } finally {
      server.state.status = 200;
    }
  });

  it('refetches a stale key set, and fails closed if that fetch fails', async () => {
    const { clock, remote } = clocked({ cacheMaxAgeMs: 600_000 });
    const signed = await token(first);
    server.state.fetches = 0;
    await remote.verify(signed);
    clock.ms += 600_000;
    server.state.status = 500;
    try {
      await expect(remote.verify(signed)).rejects.toThrow(AuthUnavailableError);
    } finally {
      server.state.status = 200;
    }
    expect(server.state.fetches).toBe(2);
  });
});
