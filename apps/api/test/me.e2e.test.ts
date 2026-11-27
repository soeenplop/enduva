import { Me, PROBLEM_CONTENT_TYPE, Problem } from '@enduva/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteUser, LOCAL_POOLER_URL, localAuth, newUser as createUser, type Session } from './local-supabase.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

const auth = localAuth();
if (auth === undefined)
  console.warn('[skipped] local Supabase is not running: /v1/me e2e tests need `db:start` + `db:reset`');

/** Every test gets its own synthetic users, deleted at the end, so tests don't depend on each other. */
const created: string[] = [];
async function newUser(): Promise<Session> {
  const session = await createUser(auth!);
  created.push(session.userId);
  return session;
}

describe.skipIf(auth === undefined)(`/v1/me (e2e, local Supabase${auth ? '' : ': SKIPPED, not running'})`, () => {
  const logs = logCapture();
  let app: NestExpressApplication;

  beforeAll(async () => {
    if (auth === undefined) return;
    app = await createTestApp(
      testEnv({ DATABASE_URL: LOCAL_POOLER_URL, AUTH_ISSUER: auth.issuer, LOG_LEVEL: 'info' }),
      { logDestination: logs },
    );
  });

  afterAll(async () => {
    await app?.close();
    await Promise.allSettled(created.map((userId) => deleteUser(auth!, userId)));
  });

  const get = (user: Session) => http(app).get('/v1/me').set('authorization', `Bearer ${user.accessToken}`);
  const patch = (user: Session, body: unknown, ifMatch?: string) => {
    const req = http(app)
      .patch('/v1/me')
      .set('authorization', `Bearer ${user.accessToken}`)
      .send(body as object);
    return ifMatch === undefined ? req : req.set('if-match', ifMatch);
  };

  it('updates the profile with If-Match and returns it with the next ETag', async () => {
    const user = await newUser();
    const before = await get(user);
    expect(before.headers.etag).toMatch(/^"1-[\w-]{22}"$/);
    const res = await patch(
      user,
      { displayName: ' Synthetic Sam ', timeZone: 'europe/VIENNA', heightCm: 181, onboardingCompleted: true },
      before.headers.etag,
    );
    expect(res.status).toBe(200);
    expect(res.headers.etag).toMatch(/^"2-[\w-]{22}"$/);
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
    const after = await get(user);
    expect(after.body).toEqual(res.body);
    expect(after.headers.etag).toBe(res.headers.etag);
    // Both bodies are exactly what the OpenAPI contract describes, no field more.
    for (const body of [before.body, res.body]) expect(Me.strict().parse(body)).toEqual(body);
  });

  it('keeps the first onboarding time and clears fields with null', async () => {
    const user = await newUser();
    const first = await patch(user, { onboardingCompleted: true, heightCm: 170 }, (await get(user)).headers.etag);
    expect(first.status).toBe(200);
    const second = await patch(user, { onboardingCompleted: true, heightCm: null }, first.headers.etag);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ onboardingCompletedAt: first.body.onboardingCompletedAt, heightCm: null });
  });

  it('requires If-Match (428) and refuses a stale, weak, wildcard or list tag (412) without writing', async () => {
    const user = await newUser();
    const stale = (await get(user)).headers.etag as string;
    const current = await patch(user, { displayName: 'Current' }, stale);
    expect(current.status).toBe(200);
    const tag = current.headers.etag as string;
    for (const [ifMatch, status, code] of [
      [undefined, 428, 'precondition_required'],
      [stale, 412, 'precondition_failed'],
      ['*', 412, 'precondition_failed'],
      [`W/${tag}`, 412, 'precondition_failed'],
      [`${tag}, ${stale}`, 412, 'precondition_failed'],
      [`"${current.body.version}"`, 412, 'precondition_failed'],
    ] as const) {
      const res = await patch(user, { displayName: 'Lost update' }, ifMatch);
      expect(res.status).toBe(status);
      expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
      expect(Problem.strict().parse(res.body)).toMatchObject({ code });
    }
    expect((await get(user)).body).toEqual(current.body);
  });

  it("never matches another account's tag at the same version, in a conditional GET or If-Match", async () => {
    const [first, second] = [await newUser(), await newUser()];
    const firstTag = (await get(first)).headers.etag as string;
    const secondRes = await get(second);
    expect(secondRes.body.version).toBe(1);
    expect(firstTag).not.toBe(secondRes.headers.etag);
    // The tag left over from the first account (account switch on the same device).
    const conditional = await get(second).set('if-none-match', firstTag);
    expect(conditional.status).toBe(200);
    expect(conditional.body).toMatchObject({ id: second.userId });
    expect((await get(first).set('if-none-match', firstTag)).status).toBe(304);
    const res = await patch(second, { displayName: 'Wrong account' }, firstTag);
    expect(res.status).toBe(412);
    expect((await get(second)).body).toEqual(secondRes.body);
  });

  it('refuses an invalid body with a bare 400 that echoes nothing, and never writes', async () => {
    const user = await newUser();
    const { body: current, headers } = await get(user);
    for (const body of [
      { role: 'admin' },
      { displayName: 'health-secret-72', heightCm: 5 },
      { displayName: 'nul\u0000name' },
      { timeZone: 'SystemV/EST5' },
      {},
    ]) {
      const res = await patch(user, body, headers.etag);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ type: 'about:blank', title: 'Bad Request', status: 400, code: 'bad_request' });
    }
    expect((await get(user)).body).toEqual(current);
    expect(logs.text()).not.toMatch(/health-secret|Synthetic Sam|Lost update|Wrong account|nul/);
  });

  it('needs a token like every other route', async () => {
    expect((await http(app).patch('/v1/me').send({ locale: 'en' })).status).toBe(401);
  });
});
