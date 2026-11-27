import { type CanActivate, Controller, type ExecutionContext, Get, Injectable, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase, profiles, type Transaction } from '@enduva/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type IdentifiedRequest, RequestTx } from '../src/db/request-transaction.js';
import { createTestApp, http, testEnv } from './support.js';

// Local Supabase only (`pnpm --filter @enduva/db db:start` + `db:reset`): the transaction pooler and the API login
// with its local development password from supabase/seed.sql. Never a hosted project.
const LOCAL_POOLER_URL = 'postgresql://enduva_api_login.pooler-dev:enduva-local-api@127.0.0.1:54329/postgres';
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

const available = await localSupabaseRunning();
if (!available)
  console.warn('[skipped] local Supabase is not running: database e2e tests need `db:start` + `db:reset`');

/** Stand-in for the 0.8b auth guard: it puts verified claims on the request, as the JWKS check will. */
@Injectable()
class FakeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<IdentifiedRequest>();
    if (request.headers['x-test-user'] === USER_A) request.claims = { sub: USER_A, role: 'authenticated' };
    return true;
  }
}

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

  /** Writes inside the request transaction, then fails: nothing may persist. */
  @Post()
  async failAfterWrite(@RequestTx() tx: Transaction): Promise<never> {
    await tx.execute(sql`update app.profiles set display_name = 'rolled back' where user_id = ${USER_A}`);
    throw new Error('fail after write');
  }
}

describe.skipIf(!available)(`database (e2e, local Supabase${available ? '' : ': SKIPPED, not running'})`, () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ DATABASE_URL: LOCAL_POOLER_URL }), {
      controllers: [ProbeController],
      providers: [{ provide: APP_GUARD, useClass: FakeAuthGuard }],
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

  it('runs a request with verified claims in one transaction as enduva_api, scoped by RLS', async () => {
    const res = await http(app).get('/v1/probe').set('x-test-user', USER_A);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'enduva_api', user_id: USER_A, profiles: [{ userId: USER_A }] });
  });

  it('rolls the request transaction back when the handler fails', async () => {
    const before = await http(app).get('/v1/probe').set('x-test-user', USER_A);
    expect((await http(app).post('/v1/probe').set('x-test-user', USER_A)).status).toBe(500);
    const after = await http(app).get('/v1/probe').set('x-test-user', USER_A);
    expect(after.body).toEqual(before.body);
    expect(JSON.stringify(after.body)).not.toContain('rolled back');
  });

  it('gives a route without verified claims no transaction (500, nothing runs unscoped)', async () => {
    const res = await http(app).get('/v1/probe');
    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ code: 'internal_error' });
  });
});
