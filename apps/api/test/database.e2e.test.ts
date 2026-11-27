import type { NestExpressApplication } from '@nestjs/platform-express';
import { createDatabase } from '@enduva/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, http, testEnv } from './support.js';

// Local Supabase only (`pnpm --filter @enduva/db db:start` + `db:reset`): the transaction pooler and the API login
// with its local development password from supabase/seed.sql. Never a hosted project.
const LOCAL_POOLER_URL = 'postgresql://enduva_api_login.pooler-dev:enduva-local-api@127.0.0.1:54329/postgres';

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

describe.skipIf(!available)(`database (e2e, local Supabase${available ? '' : ': SKIPPED, not running'})`, () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp(testEnv({ DATABASE_URL: LOCAL_POOLER_URL }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('is ready when the database answers through the transaction pooler', async () => {
    const res = await http(app).get('/v1/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
