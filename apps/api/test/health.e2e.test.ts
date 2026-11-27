import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HealthController } from '../src/health/health.controller.js';
import { HealthService } from '../src/health/health.service.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

const problemType = /^application\/problem\+json/;

@Controller('boom')
class BoomController {
  @Get()
  fail(): never {
    throw new Error('internal detail');
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

  it('is live', async () => {
    const res = await http(app).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('echoes a safe x-request-id and replaces an unsafe one', async () => {
    const kept = await http(app).get('/v1/health').set('x-request-id', 'trace-abc.123');
    expect(kept.headers['x-request-id']).toBe('trace-abc.123');

    for (const unsafe of ['a b {"level":60}', 'x'.repeat(129)]) {
      const replaced = await http(app).get('/v1/health').set('x-request-id', unsafe);
      expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
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

  it('hides unexpected errors behind internal_error and logs them with the request ID', async () => {
    const res = await http(app).get('/v1/boom').set('x-request-id', 'boom-check');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      type: 'about:blank',
      title: 'Internal Server Error',
      status: 500,
      code: 'internal_error',
    });
    expect(res.text).not.toContain('internal detail');
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        level: 50,
        context: 'ProblemFilter',
        req: expect.objectContaining({ id: 'boom-check' }) as unknown,
        err: expect.objectContaining({ message: 'internal detail' }) as unknown,
      }),
    );
  });

  it('logs requests with their ID but without headers, query strings or bodies', async () => {
    await http(app)
      .post('/v1/boom?token=query-secret')
      .set('x-request-id', 'log-check')
      .set('authorization', 'Bearer header-secret')
      .set('cookie', 'sb=cookie-secret')
      .send({ heartRate: 'body-secret' });

    const line = logs.lines().find((l) => (l.req as { id?: string } | undefined)?.id === 'log-check');
    expect(line).toMatchObject({
      req: { id: 'log-check', method: 'POST', path: '/v1/boom' },
      res: { statusCode: 201 },
    });
    expect(Object.keys(line?.req ?? {})).toEqual(['id', 'method', 'path']);
    expect(logs.text()).not.toMatch(/query-secret|header-secret|cookie-secret|body-secret/);
  });
});
