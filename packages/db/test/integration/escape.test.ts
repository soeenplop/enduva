// The API role can't get around row-level security, and nothing of a request's identity outlives its transaction.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, withUserTx, withWorkerTx, type Database } from '../../src/index.js';
import { consents, devices, entitlements, profiles, userSettings } from '../../src/schema/index.js';
import { apiUrl, attempt, claimsFor, openDatabase, rolledBack, ROUTES, USER_A, USER_B, workerUrl } from './support.js';

const ALL_TABLES = [profiles, userSettings, entitlements, consents, devices];

describe.each(ROUTES)('enduva_api via %s', (route) => {
  let db: Database;
  beforeAll(() => {
    db = openDatabase(apiUrl(route));
  });
  afterAll(async () => {
    await db.$client.end();
  });

  const asUserA = (statement: string) =>
    attempt(() =>
      rolledBack(
        (fn) => withUserTx(db, claimsFor(USER_A), fn),
        async (tx) => {
          await tx.execute(sql.raw(statement));
          return (await tx.execute(sql`select 1 from ${profiles}`)).rowCount ?? 0;
        },
      ),
    );

  it('sees no rows without an identity', async () => {
    const counts = await rolledBack(
      (fn) => db.transaction(fn),
      async (tx) => {
        await tx.execute(sql`set local role enduva_api`);
        return Promise.all(ALL_TABLES.map(async (table) => (await tx.execute(sql`select 1 from ${table}`)).rowCount));
      },
    );
    expect(counts).toEqual([0, 0, 0, 0, 0]);
  });

  it('has no privileges without `set role` (the login role is NOINHERIT)', async () => {
    const outcome = await attempt(async () => (await db.execute(sql`select 1 from ${profiles}`)).rowCount ?? 0);
    expect(outcome).toEqual({ denied: true });
  });

  it("can't turn row security off", async () => {
    expect(await asUserA('set local row_security = off')).toEqual({ denied: true });
  });

  it.each(['postgres', 'service_role', 'authenticated', 'anon', 'authenticator', 'enduva_owner', 'enduva_worker'])(
    "can't switch to %s",
    async (role) => {
      expect(await asUserA(`set local role ${role}`)).toEqual({ denied: true });
    },
  );

  it.each([
    'alter table app.profiles disable row level security',
    'alter table app.profiles no force row level security',
    'drop policy own_rows on app.profiles',
    'create policy open_rows on app.profiles for select to enduva_api using (true)',
    'alter table app.profiles owner to enduva_api',
  ])("can't run `%s`", async (statement) => {
    expect(await asUserA(statement)).toEqual({ denied: true });
  });

  it("can't grant its privileges on (Postgres only warns and grants nothing)", async () => {
    const granted = await rolledBack(
      (fn) => withUserTx(db, claimsFor(USER_A), fn),
      async (tx) => {
        await tx.execute(sql`grant select on app.profiles to anon`);
        const { rows } = await tx.execute<{ granted: boolean }>(
          sql`select has_table_privilege('anon', 'app.profiles', 'select') as granted`,
        );
        return rows[0]?.granted;
      },
    );
    expect(granted).toBe(false);
  });

  it('leaves no identity or role on the connection after commit and after rollback', async () => {
    // One client connection, so a leak would show up on the very session the transactions ran on.
    const single = createDatabase({ connectionString: apiUrl(route), max: 1 });
    try {
      await withUserTx(single, claimsFor(USER_A), (tx) => tx.execute(sql`select 1`));
      await expect(
        withUserTx(single, claimsFor(USER_B), async (tx) => {
          await tx.execute(sql`select 1`);
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');

      for (let i = 0; i < 3; i++) {
        const { rows } = await single.execute<{ role: string; claims: string | null }>(
          sql`select current_user::text as role, nullif(current_setting('request.jwt.claims', true), '') as claims`,
        );
        expect(rows).toEqual([{ role: 'enduva_api_login', claims: null }]);
      }
    } finally {
      await single.$client.end();
    }
  });
});

describe('login roles', () => {
  it("the worker login can't become enduva_api", async () => {
    const db = openDatabase(workerUrl('pooler'));
    try {
      const outcome = await attempt(() =>
        rolledBack(
          (fn) => withWorkerTx(db, USER_A, fn),
          async (tx) => (await tx.execute(sql`set local role enduva_api`)).rowCount ?? 0,
        ),
      );
      expect(outcome).toEqual({ denied: true });
    } finally {
      await db.$client.end();
    }
  });

  it("the API login can't become enduva_worker through withWorkerTx", async () => {
    const db = openDatabase(apiUrl('pooler'));
    try {
      const outcome = await attempt(() => withWorkerTx(db, USER_A, async () => 0));
      expect(outcome).toEqual({ denied: true });
    } finally {
      await db.$client.end();
    }
  });
});
