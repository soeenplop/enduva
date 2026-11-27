import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteUser, LOCAL_POOLER_URL, localAuth, newUser, type Session } from './local-supabase.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

const auth = localAuth();
if (auth === undefined)
  console.warn('[skipped] local Supabase is not running: /v1/me e2e tests need `db:start` + `db:reset`');

describe.skipIf(auth === undefined)(`/v1/me (e2e, local Supabase${auth ? '' : ': SKIPPED, not running'})`, () => {
  const logs = logCapture();
  let app: NestExpressApplication;
  let user: Session;

  beforeAll(async () => {
    if (auth === undefined) return;
    app = await createTestApp(
      testEnv({ DATABASE_URL: LOCAL_POOLER_URL, AUTH_ISSUER: auth.issuer, LOG_LEVEL: 'info' }),
      { logDestination: logs },
    );
    user = await newUser(auth);
  });

  afterAll(async () => {
    await app?.close();
    if (user !== undefined) await deleteUser(auth!, user.userId);
  });

  const get = () => http(app).get('/v1/me').set('authorization', `Bearer ${user.accessToken}`);
  const patch = (body: unknown, ifMatch?: string) => {
    const req = http(app)
      .patch('/v1/me')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send(body as object);
    return ifMatch === undefined ? req : req.set('if-match', ifMatch);
  };

  it('updates the profile with If-Match and returns it with the next ETag', async () => {
    const before = await get();
    expect(before.headers.etag).toBe('"1"');
    const res = await patch(
      { displayName: ' Synthetic Sam ', timeZone: 'europe/vienna', heightCm: 181, onboardingCompleted: true },
      before.headers.etag,
    );
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"2"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({
      id: user.userId,
      displayName: 'Synthetic Sam',
      timeZone: 'Europe/Vienna',
      heightCm: 181,
      locale: 'de',
      role: 'user',
      version: 2,
    });
    expect(typeof res.body.onboardingCompletedAt).toBe('string');
    expect((await get()).body).toEqual(res.body);
  });

  it('keeps the first onboarding time and clears fields with null', async () => {
    const { body: current } = await get();
    const res = await patch({ onboardingCompleted: true, heightCm: null }, `"${current.version}"`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ onboardingCompletedAt: current.onboardingCompletedAt, heightCm: null });
  });

  it('requires If-Match (428) and refuses an outdated or malformed one (412) without writing', async () => {
    const { body: current } = await get();
    for (const [ifMatch, status, code] of [
      [undefined, 428, 'precondition_required'],
      ['"1"', 412, 'precondition_failed'],
      ['*', 412, 'precondition_failed'],
      [`W/"${current.version}"`, 412, 'precondition_failed'],
      [`"${current.version}", "1"`, 412, 'precondition_failed'],
    ] as const) {
      const res = await patch({ displayName: 'Lost update' }, ifMatch);
      expect(res.status).toBe(status);
      expect(res.body).toMatchObject({ code });
    }
    expect((await get()).body).toEqual(current);
  });

  it('refuses an invalid body with a bare 400 that echoes nothing, and never writes role', async () => {
    const { body: current } = await get();
    for (const body of [{ role: 'admin' }, { displayName: 'health-secret-72', heightCm: 5 }, {}]) {
      const res = await patch(body, `"${current.version}"`);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ type: 'about:blank', title: 'Bad Request', status: 400, code: 'bad_request' });
    }
    expect((await get()).body).toEqual(current);
    expect(logs.text()).not.toMatch(/health-secret|Synthetic Sam|Lost update/);
  });

  it('needs a token like every other route', async () => {
    expect((await http(app).patch('/v1/me').send({ locale: 'en' })).status).toBe(401);
  });
});
