import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '@enduva/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/db/database.js';
import { HealthController } from '../src/health/health.controller.js';
import { HealthService } from '../src/health/health.service.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

const problemType = /^application\/problem\+json/;

const reqId = (line: Record<string, unknown>): unknown => (line.req as { id?: unknown } | undefined)?.id;

@Controller('boom')
class BoomController {
  @Get()
  fail(): never {
    const cause = Object.assign(new Error('cause-secret'), { password: 'cause-prop-secret' });
    throw Object.assign(new Error('message-secret', { cause }), { token: 'prop-secret' });
  }

  @Get('items/:id')
  item(): { readonly ok: true } {
    return { ok: true };
  }

  @Post()
  accept(): { readonly ok: true } {
    return { ok: true };
  }
}

describe('GET /v1/health (e2e, SWC)', () => {
  const logs = logCapture();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ LOG_LEVEL: 'info' }), { logDestination: logs, controllers: [BoomController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves the controller through the decorator metadata SWC emitted', () => {
    expect(Reflect.getMetadata('design:paramtypes', HealthController)).toEqual([HealthService]);
    expect(app.get(HealthController)).toBeInstanceOf(HealthController);
  });

  it('is live without a database', async () => {
    const res = await http(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('is not ready while the database is unreachable', async () => {
    const res = await http(app).get('/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.headers['content-type']).toMatch(problemType);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      code: 'database_unavailable',
    });
    // The checkout failure is logged by class only, not with its message (host and port here).
    const line = logs
      .lines()
      .find((l) => l.msg === 'readiness check failed' && reqId(l) === res.headers['x-request-id']);
    expect(line?.err).toEqual({ type: 'Error' });
  });

  it('survives an idle database client failing and logs it without its message', async () => {
    const error = Object.assign(new Error('idle-secret'), { detail: 'detail-secret' });
    app.get<Database>(DATABASE).$client.emit('error', error);
    expect((await http(app).get('/v1/health')).status).toBe(200);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({ msg: 'idle database client failed', err: { type: 'Error' } }),
    );
    expect(logs.text()).not.toMatch(/idle-secret|detail-secret/);
  });

  it('generates every x-request-id and ignores the client one', async () => {
    for (const incoming of ['trace-abc.123', '8f14e45f-ceea-467f-a0e6-0b5b6f3a3c1d', 'a b {"level":60}']) {
      const res = await http(app).get('/v1/health').set('x-request-id', incoming);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(res.headers['x-request-id']).not.toBe(incoming);
    }
    const generated = await http(app).get('/v1/health');
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('answers unknown routes, inside and outside /v1, with a problem', async () => {
    for (const path of ['/v1/nope', '/nope', '/v2/health']) {
      const res = await http(app).get(path);
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toMatch(problemType);
      expect(res.body).toMatchObject({ status: 404, code: 'not_found' });
      expect(res.headers['x-request-id']).toBeDefined();
    }
  });

  it('answers a malformed body with a problem and a request ID', async () => {
    const res = await http(app).post('/v1/boom').set('content-type', 'application/json').send('{"oops');
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch(problemType);
    expect(res.body).toEqual({ type: 'about:blank', title: 'Bad Request', status: 400, code: 'bad_request' });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('hides unexpected errors behind internal_error and logs only their class and the request ID', async () => {
    const res = await http(app).get('/v1/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
    });
    expect(res.text).not.toContain('secret');
    const id = res.headers['x-request-id'];
    const filterLine = logs.lines().find((l) => l.context === 'ProblemFilter' && reqId(l) === id);
    expect(filterLine).toMatchObject({ level: 50, code: 'internal_error', err: { type: 'Error' } });
    expect(filterLine?.err).toEqual({ type: 'Error' });
    const completion = logs.lines().find((l) => l.res !== undefined && reqId(l) === id);
    expect(completion?.err).toEqual({ type: 'Error' });
    expect(logs.text()).not.toMatch(/message-secret|cause-secret|cause-prop-secret|prop-secret|"stack"/);
  });

  it('logs requests with their ID and route template but without paths, headers, query strings or bodies', async () => {
    const res = await http(app)
      .post('/v1/boom?token=query-secret')
      .set('authorization', 'Bearer header-secret')
      .set('cookie', 'sb=cookie-secret')
      .send({ heartRate: 'body-secret' });
    const item = await http(app).get('/v1/boom/items/path-secret');
    const missing = await http(app).get('/v1/users/unmatched-secret');
    const malformed = await http(app)
      .post('/v1/boom/malformed-secret')
      .set('content-type', 'application/json')
      .send('{"oops');

    const completion = (id: unknown) => logs.lines().find((l) => l.res !== undefined && reqId(l) === id);
    expect(completion(res.headers['x-request-id'])).toMatchObject({
      req: { id: res.headers['x-request-id'], method: 'POST' },
      res: { statusCode: 201 },
      route: '/v1/boom',
    });
    expect(Object.keys(completion(res.headers['x-request-id'])?.req ?? {})).toEqual(['id', 'method']);
    expect(completion(item.headers['x-request-id'])).toMatchObject({ route: '/v1/boom/items/:id' });
    // Nest answers unknown paths from its own catch-all route.
    expect(completion(missing.headers['x-request-id'])).toMatchObject({ route: '/{*splat}', res: { statusCode: 404 } });
    // The body parser rejects before routing.
    expect(completion(malformed.headers['x-request-id'])).toMatchObject({
      route: '(unmatched)',
      res: { statusCode: 400 },
    });
    expect(logs.text()).not.toMatch(
      /query-secret|header-secret|cookie-secret|body-secret|path-secret|unmatched-secret|malformed-secret/,
    );
  });
});

describe('throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ THROTTLE_LIMIT: '2', THROTTLE_TTL_SECONDS: '60' }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 429 rate_limited with Retry-After once the limit is used up', async () => {
    expect((await http(app).get('/v1/health')).status).toBe(200);
    expect((await http(app).get('/v1/health')).status).toBe(200);
    const res = await http(app).get('/v1/health');
    expect(res.status).toBe(429);
    expect(res.headers['content-type']).toMatch(problemType);
    expect(res.body).toMatchObject({ status: 429, code: 'rate_limited', title: 'Too Many Requests' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});

describe('client IPs for throttling (e2e)', () => {
  const apps: NestExpressApplication[] = [];
  const boot = async (trustProxy: string) => {
    const app = await createTestApp(testEnv({ THROTTLE_LIMIT: '1', TRUST_PROXY: trustProxy }));
    apps.push(app);
    return (ip: string) => http(app).get('/v1/health').set('x-forwarded-for', ip);
  };

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  // supertest connects from loopback, so loopback plays the ingress here.
  it('counts each forwarded client IP separately when the peer is a trusted proxy', async () => {
    const from = await boot('127.0.0.1, ::1');
    expect((await from('203.0.113.1')).status).toBe(200);
    expect((await from('203.0.113.1')).status).toBe(429);
    expect((await from('203.0.113.2')).status).toBe(200);
  });

  it('ignores X-Forwarded-For from a peer that is not a trusted proxy', async () => {
    const from = await boot('10.0.0.0/8');
    expect((await from('203.0.113.1')).status).toBe(200);
    expect((await from('203.0.113.2')).status).toBe(429);
  });

  it('ignores X-Forwarded-For when no proxy is configured', async () => {
    const from = await boot('');
    expect((await from('203.0.113.1')).status).toBe(200);
    expect((await from('203.0.113.2')).status).toBe(429);
  });

  it('stops at the first untrusted hop in a forwarded chain', async () => {
    const from = await boot('127.0.0.1, ::1, 10.0.0.0/8');
    // The client spoofs a leftmost entry; the trusted chain ends at 198.51.100.7, the IP the ingress saw.
    expect((await from('203.0.113.1, 198.51.100.7, 10.0.0.2')).status).toBe(200);
    expect((await from('203.0.113.9, 198.51.100.7, 10.0.0.2')).status).toBe(429);
  });
});
