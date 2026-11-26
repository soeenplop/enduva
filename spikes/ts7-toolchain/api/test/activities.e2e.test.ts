import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Activity } from '@spike/contracts';
import request from 'supertest';

type App = Parameters<typeof request>[0];
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';

const id = '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a';
const auth = { Authorization: 'Bearer spike-token' };

describe('GET /v1/activities/:activityId (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer() as App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request without a token (guard runs with its injected verifier)', async () => {
    const res = await request(server()).get(`/v1/activities/${id}`);
    expect(res.status).toBe(401);
  });

  it('returns the activity, valid against the contract (service injected into controller)', async () => {
    const res = await request(server()).get(`/v1/activities/${id}`).set(auth);
    expect(res.status).toBe(200);
    expect(Activity.parse(res.body)).toEqual({
      id,
      sport: 'run',
      distance: 10,
      distanceUnit: 'km',
      startedAt: '2026-11-26T08:00:00Z',
    });
  });

  it('applies the query contract', async () => {
    const res = await request(server()).get(`/v1/activities/${id}?units=imperial`).set(auth);
    expect(res.body).toMatchObject({ distance: 6.21, distanceUnit: 'mi' });
  });

  it('rejects an invalid path param via the contract', async () => {
    const res = await request(server()).get('/v1/activities/not-a-uuid').set(auth);
    expect(res.status).toBe(400);
  });
});
