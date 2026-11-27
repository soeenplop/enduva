import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { type CryptoKey, exportJWK, generateKeyPair, type JWK, type JWTPayload, SignJWT } from 'jose';

export interface SigningKey {
  readonly kid: string;
  readonly alg: 'ES256' | 'RS256';
  readonly privateKey: CryptoKey;
  readonly jwk: JWK;
}

export async function signingKey(alg: 'ES256' | 'RS256' = 'ES256'): Promise<SigningKey> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const kid = randomUUID();
  return { kid, alg, privateKey, jwk: { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' } };
}

export const TEST_USER = '0000000a-0000-4000-8000-00000000000a';
export const TEST_SESSION = '5e551011-0000-4000-8000-000000000001';

/** The claims of a Supabase access token for `issuer`, valid for an hour from `now` (seconds). */
export function accessClaims(issuer: string, now: number): JWTPayload & Record<string, unknown> {
  return {
    iss: issuer,
    aud: 'authenticated',
    sub: TEST_USER,
    role: 'authenticated',
    session_id: TEST_SESSION,
    aal: 'aal1',
    is_anonymous: false,
    email: 'athlete.a@example.com',
    iat: now,
    exp: now + 3600,
  };
}

export function sign(key: SigningKey, claims: JWTPayload): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT' }).sign(key.privateKey);
}

/**
 * A stand-in Supabase Auth server that serves only `<issuer>/.well-known/jwks.json`. `keys` can be swapped (rotation)
 * and `status` set to make the endpoint fail. `fetches` counts the requests.
 */
export async function jwksServer(initial: readonly SigningKey[]) {
  const state = { keys: [...initial], status: 200, fetches: 0 };
  const server: Server = createServer((request, response) => {
    state.fetches += 1;
    if (request.url !== '/auth/v1/.well-known/jwks.json' || state.status !== 200) {
      response.writeHead(request.url === '/auth/v1/.well-known/jwks.json' ? state.status : 404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ keys: state.keys.map((key) => key.jwk) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    state,
    issuer: `http://127.0.0.1:${port}/auth/v1`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
