// The runtime roles fail closed without a user identity, the API role can't get around row-level security, and
// nothing of a transaction's identity outlives it on the Postgres backend.
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, withUserTx, withWorkerTx, type Database, type Transaction } from '../../src/index.js';
import { profiles } from '../../src/schema/index.js';
import {
  ACTORS,
  apiUrl,
  attempt,
  claimsFor,
  openDatabase,
  rawIdentityTx,
  rolledBack,
  ROUTES,
  TABLE_CASES,
  tableSql,
  USER_A,
  USER_B,
  workerUrl,
} from './support.js';

const rowCount = async (tx: Transaction, statement: ReturnType<typeof sql>) =>
  (await tx.execute(statement)).rowCount ?? 0;

// Policies match `user_id = app.current_user_id()`, which is NULL for all of these, so no row may pass `using` or
// `with check`. Every write below is one the role may run with an identity (the controls show it), on a row that is
// valid for its owner.
const NO_USER: readonly (readonly [string, Readonly<Record<string, unknown>> | undefined])[] = [
  ['no claims', undefined],
  ['claims without sub', { role: 'authenticated' }],
  ['an empty sub', { sub: '', role: 'authenticated' }],
];

describe.each(ACTORS)('$role without a user identity', (actor) => {
  describe.each(ROUTES)('via %s', (route) => {
    let db: Database;
    beforeAll(() => {
      db = openDatabase(actor.url(route));
    });
    afterAll(async () => {
      await db.$client.end();
    });

    const asOwner = (owner: string, statement: ReturnType<typeof sql>) =>
      attempt(() => rolledBack(actor.open(db, owner), (tx) => rowCount(tx, statement)));

    describe.each(NO_USER)('with %s', (_label, claims) => {
      const anonymous = (statement: ReturnType<typeof sql>) =>
        attempt(() => rolledBack(rawIdentityTx(db, actor.role, claims), (tx) => rowCount(tx, statement)));

      it('reads no rows', async () => {
        const counts = await rolledBack(rawIdentityTx(db, actor.role, claims), async (tx) =>
          Promise.all(TABLE_CASES.map(({ name }) => rowCount(tx, sql`select 1 from ${tableSql(name)}`))),
        );
        expect(counts).toEqual([0, 0, 0, 0, 0]);
      });

      const inserts = TABLE_CASES.filter((table) => table.access[actor.role].insert);
      it.each(inserts)("can't insert into $name", async (table) => {
        const owner = table.freshUser ?? USER_A;
        const insert = sql`insert into ${tableSql(table.name)} ${table.newRow(owner)}`;
        expect(await anonymous(insert)).toEqual({ denied: true });
        expect(await asOwner(owner, insert)).toEqual({ rows: 1 });
      });

      const updates = TABLE_CASES.filter((table) => table.access[actor.role].set !== undefined);
      it.each(updates)("can't update $name", async (table) => {
        const update = sql`update ${tableSql(table.name)} set ${sql.raw(table.access[actor.role].set ?? '')}`;
        expect(await anonymous(update)).toEqual({ rows: 0 });
        // A has exactly one row in every account table (supabase/seed.sql).
        expect(await asOwner(USER_A, update)).toEqual({ rows: 1 });
      });

      const deletes = TABLE_CASES.filter((table) => table.access[actor.role].delete);
      it.each(deletes)("can't delete from $name", async (table) => {
        const remove = sql`delete from ${tableSql(table.name)}`;
        expect(await anonymous(remove)).toEqual({ rows: 0 });
        expect(await asOwner(USER_A, remove)).toEqual({ rows: 1 });
      });
    });
  });
});

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
});

type BackendState = {
  readonly pid: number;
  readonly role: string;
  readonly claims: string | null;
  readonly probe: string | null;
};

const backendState = sql`select pg_backend_pid() as pid, current_user::text as role,
  nullif(current_setting('request.jwt.claims', true), '') as claims,
  nullif(current_setting('enduva.leak_probe', true), '') as probe`;

// Supavisor may hand each transaction a different Postgres backend, so checking "the next statement" could look at
// an untouched backend. Instead, each check records the backend's pg_backend_pid() inside the transaction and then
// probes (one autocommit statement at a time, each reporting its own pid) until it lands on that same backend.
describe.each(ACTORS)('$role leaves nothing on the Postgres backend', (actor) => {
  describe.each(ROUTES)('via %s', (route) => {
    let db: Database;
    beforeAll(() => {
      db = createDatabase({ connectionString: actor.url(route), max: 1, applicationName: 'enduva-db-tests' });
    });
    afterAll(async () => {
      await db.$client.end();
    });

    const state = async (tx: Pick<Database, 'execute'>) => {
      const [row] = (await tx.execute<BackendState>(backendState)).rows;
      if (row === undefined) throw new Error('no backend state');
      return row;
    };

    /** The state of backend `pid`, seen by the first probe that Supavisor routes to it. */
    async function stateOf(pid: number): Promise<BackendState> {
      for (let probe = 0; probe < 100; probe++) {
        const seen = await state(db);
        if (seen.pid === pid) return seen;
      }
      throw new Error(`No probe reached backend ${pid}`);
    }

    const clean = (pid: number) => ({ pid, role: actor.login, claims: null, probe: null });

    it('after commit and after rollback', async () => {
      const committed = await actor.open(
        db,
        USER_A,
      )(async (tx) => {
        const inside = await state(tx);
        expect(inside).toMatchObject({ role: actor.role, claims: expect.stringContaining(USER_A) });
        return inside;
      });
      expect(await stateOf(committed.pid)).toEqual(clean(committed.pid));

      let rolledBackPid: number | undefined;
      await expect(
        actor.open(
          db,
          USER_B,
        )(async (tx) => {
          const inside = await state(tx);
          expect(inside).toMatchObject({ role: actor.role, claims: expect.stringContaining(USER_B) });
          rolledBackPid = inside.pid;
          throw new Error('abort');
        }),
      ).rejects.toThrow('abort');
      expect(rolledBackPid).toBeDefined();
      expect(await stateOf(rolledBackPid ?? -1)).toEqual(clean(rolledBackPid ?? -1));
    });

    it('control: session-level state does survive on the backend, so the probe would see a leak', async () => {
      const value = `leak-${Math.random()}`;
      const [set] = (
        await db.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid, set_config('enduva.leak_probe', ${value}, false)`,
        )
      ).rows;
      const pid = set?.pid ?? -1;
      try {
        expect(await stateOf(pid)).toMatchObject({ pid, probe: value });
      } finally {
        // Leave the pooled backend as it was.
        for (let probe = 0; probe < 100; probe++) {
          const [reset] = (
            await db.execute<{ pid: number }>(
              sql`select pg_backend_pid() as pid, set_config('enduva.leak_probe', '', false)`,
            )
          ).rows;
          if (reset?.pid === pid) break;
        }
      }
    });
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
