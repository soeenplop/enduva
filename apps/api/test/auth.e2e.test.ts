import { Controller, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { type Database, type Transaction, withUserTx } from '@enduva/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/db/database.js';
import { RequestTx } from '../src/db/request-transaction.js';
import {
  banUser,
  deleteUser,
  LOCAL_POOLER_URL,
  localAuth,
  newUser as createUser,
  type Session,
  signIn,
  signOut,
} from './local-supabase.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

const auth = localAuth();
if (auth === undefined)
  console.warn('[skipped] local Supabase is not running: auth e2e tests need `db:start` + `db:reset`');

/** A write in the request transaction, for "401 on writes". */
@Controller('probe-write')
class WriteProbeController {
  @Post()
  async write(@RequestTx() tx: Transaction): Promise<{ ok: true }> {
    await tx.execute(sql`update app.profiles set display_name = 'written' where user_id = app.current_user_id()`);
    return { ok: true };
  }
}

const bearer = (session: Session) => `Bearer ${session.accessToken}`;

/** Users this suite created, deleted again at the end (some are deleted by the tests already). */
const created: string[] = [];
async function newUser(): Promise<Session> {
  const session = await createUser(auth!);
  created.push(session.userId);
  return session;
}

describe.skipIf(auth === undefined)(`auth (e2e, local Supabase${auth ? '' : ': SKIPPED, not running'})`, () => {
  const logs = logCapture();
  let app: NestExpressApplication;
  let athleteA: Session;

  beforeAll(async () => {
    if (auth === undefined) return;
    app = await createTestApp(
      testEnv({ DATABASE_URL: LOCAL_POOLER_URL, AUTH_ISSUER: auth.issuer, LOG_LEVEL: 'info' }),
      { logDestination: logs, controllers: [WriteProbeController] },
    );
    athleteA = await signIn(auth, 'athlete.a@example.com', 'enduva-local-a');
  });

  afterAll(async () => {
    await app?.close();
    await Promise.allSettled(created.map((userId) => deleteUser(auth!, userId)));
  });

  const me = (session: Session) => http(app).get('/v1/me').set('authorization', bearer(session));
  const write = (session: Session) => http(app).post('/v1/probe-write').set('authorization', bearer(session));

  it('serves /v1/me for a token from a real sign-in, verified against the local JWKS', async () => {
    const res = await me(athleteA);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ id: athleteA.userId, displayName: 'Athlete A', locale: 'de', role: 'user' });
  });

  it("creates the profile on a new user's first request", async () => {
    const fresh = await newUser();
    const res = await me(fresh);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: fresh.userId, displayName: null, locale: 'de', timeZone: 'Europe/Berlin' });
  });

  it('answers a missing or broken token with a bare 401', async () => {
    for (const res of [
      await http(app).get('/v1/me'),
      await http(app).get('/v1/me').set('authorization', `Basic ${athleteA.accessToken}`),
      await http(app)
        .get('/v1/me')
        .set('authorization', `${bearer(athleteA)}x`),
    ]) {
      expect(res.status).toBe(401);
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.body).toEqual({ type: 'about:blank', title: 'Unauthorized', status: 401, code: 'unauthorized' });
    }
  });

  it('rejects a token whose issuer differs from the configured one', async () => {
    // Same server and keys, reached as `localhost`: the token's `iss` is 127.0.0.1, so it must not pass.
    const other = await createTestApp(
      testEnv({ DATABASE_URL: LOCAL_POOLER_URL, AUTH_ISSUER: auth!.issuer.replace('127.0.0.1', 'localhost') }),
    );
    try {
      expect((await http(other).get('/v1/me').set('authorization', bearer(athleteA))).status).toBe(401);
    } finally {
      await other.close();
    }
  });

  it.each([
    ['signed out', (session: Session) => signOut(auth!, session)],
    ['deleted', (session: Session) => deleteUser(auth!, session.userId)],
    ['soft-deleted', (session: Session) => deleteUser(auth!, session.userId, true)],
    ['banned', (session: Session) => banUser(auth!, session.userId)],
  ])('refuses reads and writes with the unexpired token of a %s account', async (_case, revoke) => {
    const session = await newUser();
    expect((await write(session)).status).toBe(201);
    await revoke(session);
    for (const res of [await write(session), await me(session)]) {
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: 'unauthorized' });
    }
  });

  it('answers 401 device_revoked once the session’s device is revoked, right after a successful request', async () => {
    const session = await newUser();
    const db = app.get<Database>(DATABASE);
    const claims = { sub: session.userId, role: 'authenticated', session_id: session.sessionId } as const;
    expect((await me(session)).status).toBe(200);
    await withUserTx(db, claims, (tx) =>
      tx.execute(sql`insert into app.devices (user_id, kind, auth_session_id)
                     values (${session.userId}, 'watch', ${session.sessionId})`),
    );
    expect((await me(session)).status).toBe(200);
    await withUserTx(db, claims, (tx) =>
      tx.execute(sql`update app.devices set revoked_at = now() where auth_session_id = ${session.sessionId}`),
    );
    for (const res of [await me(session), await write(session)]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ type: 'about:blank', title: 'Unauthorized', status: 401, code: 'device_revoked' });
    }
  });

  it('logs neither tokens nor user data', () => {
    const text = logs.text();
    expect(text).not.toContain(athleteA.accessToken.split('.')[1]);
    expect(text).not.toMatch(/athlete\.a@example\.com|e2e-[0-9a-f-]+@example\.com|Athlete A|authorization|Bearer/i);
    expect(text).not.toContain(athleteA.userId);
  });
});
