import { setTimeout as delay } from 'node:timers/promises';

import { Controller, Get, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase, type Database, profiles, type Transaction } from '@enduva/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Public } from '../src/auth/auth.guard.js';
import { DATABASE } from '../src/db/database.js';
import { RequestTx } from '../src/db/request-transaction.js';
import { LOCAL_POOLER_URL, localAuth, signIn } from './local-supabase.js';
import { createTestApp, http, logCapture, testEnv } from './support.js';

// Local Supabase only (`pnpm --filter @enduva/db db:start` + `db:reset`): the transaction pooler and the API login
// with its local development password from supabase/seed.sql, and real sign-ins through the local Auth server.
// Never a hosted project.
const USER_A = '0000000a-0000-4000-8000-00000000000a';

async function localSupabaseRunning(): Promise<boolean> {
  const db = createDatabase({ connectionString: LOCAL_POOLER_URL, max: 1 });
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  } finally {
    await db.$client.end();
  }
}

const auth = localAuth();
const available = auth !== undefined && (await localSupabaseRunning());
if (!available)
  console.warn('[skipped] local Supabase is not running: database e2e tests need `db:start` + `db:reset`');

/** Athlete A's access token from a real sign-in. */
const bearerA = available
  ? `Bearer ${(await signIn(auth, 'athlete.a@example.com', 'enduva-local-a')).accessToken}`
  : '';
const authEnv = { AUTH_ISSUER: auth?.issuer ?? '' };

@Controller('probe')
class ProbeController {
  @Get()
  async whoami(@RequestTx() tx: Transaction) {
    const [identity] = await tx
      .execute<{ role: string; user_id: string | null }>(
        sql`select current_user as role, app.current_user_id() as user_id`,
      )
      .then((r) => r.rows);
    const visible = await tx.select({ userId: profiles.userId, name: profiles.displayName }).from(profiles);
    return { ...identity, profiles: visible };
  }

  /** A failing query whose parameter must not reach the logs. */
  @Get('bad-query')
  async badQuery(@RequestTx() tx: Transaction): Promise<never> {
    // Multiline, so Drizzle's message would get lines that look like stack frames.
    await tx.execute(sql`select ${'heart-rate-72\n    at fake (/heart-rate/frame.js:1:1)'}::uuid`);
    throw new Error('unreachable');
  }

  /** A route without an identity can't have a request transaction. */
  @Public()
  @Get('public')
  unscoped(@RequestTx() _tx: Transaction): never {
    throw new Error('unreachable');
  }

  /** Writes inside the request transaction, then fails: nothing may persist. */
  @Post()
  async failAfterWrite(@RequestTx() tx: Transaction): Promise<never> {
    await tx.execute(sql`update app.profiles set display_name = 'rolled back' where user_id = ${USER_A}`);
    throw new Error('fail after write');
  }
}

describe.skipIf(!available)(`database (e2e, local Supabase${available ? '' : ': SKIPPED, not running'})`, () => {
  const logs = logCapture();
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ ...authEnv, DATABASE_URL: LOCAL_POOLER_URL, LOG_LEVEL: 'info' }), {
      logDestination: logs,
      controllers: [ProbeController],
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is ready when the database answers through the transaction pooler', async () => {
    const res = await http(app).get('/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('is not ready when the pool logs in as another role', async () => {
    // The env check refuses such a URL; this stands in for a login node-postgres or the pooler changed anyway.
    const other = await createTestApp(testEnv({ ...authEnv, DATABASE_URL: LOCAL_POOLER_URL }));
    try {
      other.get<Database>(DATABASE).$client.options.connectionString = LOCAL_POOLER_URL.replace(
        'enduva_api_login.pooler-dev:enduva-local-api',
        'enduva_worker_login.pooler-dev:enduva-local-worker',
      );
      const res = await http(other).get('/v1/health/ready');
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ code: 'database_unavailable' });
    } finally {
      await other.close();
    }
  });

  it('runs a request with verified claims in one transaction as enduva_api, scoped by RLS', async () => {
    const res = await http(app).get('/v1/probe').set('authorization', bearerA);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'enduva_api', user_id: USER_A, profiles: [{ userId: USER_A }] });
  });

  it('rolls the request transaction back when the handler fails', async () => {
    const before = await http(app).get('/v1/probe').set('authorization', bearerA);
    expect((await http(app).post('/v1/probe').set('authorization', bearerA)).status).toBe(500);
    const after = await http(app).get('/v1/probe').set('authorization', bearerA);
    expect(after.body).toEqual(before.body);
    expect(JSON.stringify(after.body)).not.toContain('rolled back');
  });

  it('logs a failed query without its parameters', async () => {
    const res = await http(app).get('/v1/probe/bad-query').set('authorization', bearerA);
    expect(res.status).toBe(500);
    expect(logs.lines()).toContainEqual(
      expect.objectContaining({
        context: 'ProblemFilter',
        req: expect.objectContaining({ id: res.headers['x-request-id'] }) as unknown,
        err: { type: 'DrizzleQueryError', sqlState: '22P02' },
      }),
    );
    expect(logs.text()).not.toMatch(/heart-rate|select|::uuid/);
  });

  it('gives a route without verified claims no transaction (500, nothing runs unscoped)', async () => {
    const res = await http(app).get('/v1/probe/public');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'internal_error' });
  });
});

// Straight to Postgres, where terminating a backend closes the API's connection (the pooler would keep it open).
const LOCAL_DIRECT_URL = 'postgresql://enduva_api_login:enduva-local-api@127.0.0.1:54322/postgres';

/** Same login, outside any transaction: allowed to terminate its own role's backends. */
const killer = available ? createDatabase({ connectionString: LOCAL_DIRECT_URL, max: 1 }) : undefined;

@Controller('lose')
class LoseConnectionController {
  /** Loses its connection between two queries of the request transaction. */
  @Get()
  async lose(@RequestTx() tx: Transaction): Promise<never> {
    const [backend] = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows;
    await killer?.execute(sql`select pg_terminate_backend(${backend?.pid ?? 0})`);
    await delay(200);
    await tx.execute(sql`select 1`);
    throw new Error('unreachable');
  }
}

describe.skipIf(!available)('a request whose connection is lost (e2e, local Postgres)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ ...authEnv, DATABASE_URL: LOCAL_DIRECT_URL, DATABASE_POOL_MAX: '1' }), {
      controllers: [LoseConnectionController, ProbeController],
    });
  });

  afterAll(async () => {
    await app?.close();
    await killer?.$client.end();
  });

  it('fails the request, not the process, and frees the pool slot', async () => {
    const res = await http(app).get('/v1/lose').set('authorization', bearerA);
    expect(res.status).toBe(500);
    expect(app.get<Database>(DATABASE).$client.totalCount).toBe(0);
    const next = await http(app).get('/v1/probe').set('authorization', bearerA);
    expect(next.status).toBe(200);
    expect(next.body).toMatchObject({ role: 'enduva_api', user_id: USER_A });
  });
});
