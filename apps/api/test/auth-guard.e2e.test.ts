import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Public } from '../src/auth/auth.guard.js';
import { accessClaims, jwksServer, sign, type SigningKey, signingKey } from './jwks-fixture.js';
import { createTestApp, http, logCapture, testEnv, UNREACHABLE_ISSUER } from './support.js';

@Controller('guarded')
class GuardedController {
  @Public()
  @Get('public')
  open(): { ok: true } {
    return { ok: true };
  }

  @Get('private')
  closed(): { ok: true } {
    return { ok: true };
  }
}

const unauthorized = { type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthorized' };

// The guard against a stand-in JWKS endpoint, no Supabase needed. The database is unreachable, so a request that
// passes the guard fails afterwards (in the request transaction), never with 401.
describe('auth guard (e2e)', () => {
  const logs = logCapture();
  let app: NestExpressApplication;
  let server: Awaited<ReturnType<typeof jwksServer>>;
  let key: SigningKey;
  let token: string;

  beforeAll(async () => {
    key = await signingKey();
    server = await jwksServer([key]);
    token = await sign(key, accessClaims(server.issuer, Math.floor(Date.now() / 1000)));
    app = await createTestApp(testEnv({ AUTH_ISSUER: server.issuer, LOG_LEVEL: 'info', THROTTLE_LIMIT: '1000' }), {
      logDestination: logs,
      controllers: [GuardedController],
    });
  });

  afterAll(async () => {
    await app?.close();
    await server?.close();
  });

  it('protects every route that is not @Public()', async () => {
    expect((await http(app).get('/v1/guarded/private')).status).toBe(401);
    expect((await http(app).get('/v1/guarded/public')).status).toBe(200);
    expect((await http(app).get('/v1/health')).status).toBe(200);
  });

  it.each([
    ['no Authorization header', undefined],
    ['another scheme', 'Basic dXNlcjpwdw=='],
    ['a bare scheme', 'Bearer'],
    ['two tokens', 'Bearer a b'],
    ['a malformed token', 'Bearer not-a-jwt'],
  ])('answers %s with a bare 401 and WWW-Authenticate', async (_case, header) => {
    const req = http(app).get('/v1/guarded/private');
    const res = await (header === undefined ? req : req.set('authorization', header));
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
    expect(res.body).toEqual(unauthorized);
  });

  it('lets a valid token through, with the scheme in any case', async () => {
    for (const scheme of ['Bearer', 'bearer']) {
      const res = await http(app).get('/v1/guarded/private').set('authorization', `${scheme} ${token}`);
      expect(res.status).toBeGreaterThanOrEqual(500);
    }
  });

  it('fails closed with 503 auth_unavailable when the JWKS cannot be fetched', async () => {
    // testEnv's default issuer has no server behind it.
    const unreachable = await createTestApp(testEnv(), { controllers: [GuardedController] });
    try {
      const claims = accessClaims(UNREACHABLE_ISSUER, Math.floor(Date.now() / 1000));
      const res = await http(unreachable)
        .get('/v1/guarded/private')
        .set('authorization', `Bearer ${await sign(key, claims)}`);
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'auth_unavailable' });
    } finally {
      await unreachable.close();
    }
  });

  it('throttles before it verifies, so floods of bad tokens are limited too', async () => {
    const limited = await createTestApp(testEnv({ AUTH_ISSUER: server.issuer, THROTTLE_LIMIT: '2' }), {
      controllers: [GuardedController],
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 3; i += 1) codes.push((await http(limited).get('/v1/guarded/private')).status);
      expect(codes).toEqual([401, 401, 429]);
    } finally {
      await limited.close();
    }
  });

  it('logs no token', () => {
    expect(logs.text()).not.toContain(token.split('.')[1]);
    expect(logs.text()).not.toMatch(/authorization|bearer|athlete/i);
  });
});
