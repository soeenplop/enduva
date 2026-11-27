import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HealthController } from '../src/health/health.controller.js';
import { HealthService } from '../src/health/health.service.js';
import { createTestApp, http, testEnv } from './support.js';

describe('GET /v1/health (e2e, SWC)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv());
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

  it('serves the health routes only under /v1', async () => {
    for (const path of ['/health', '/v2/health']) {
      expect((await http(app).get(path)).status).toBe(404);
    }
  });
});
