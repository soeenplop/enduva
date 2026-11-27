// Cross-tenant suite (ADR-0002): acting as one user, every attempt to read or write another user's rows in every
// account table returns nothing or is denied, for the API and the worker role, through the transaction pooler and
// directly. Each attempt runs in its own rolled-back transaction. Positive controls show that the same statements
// work on the actor's own rows, so "nothing" isn't the result of a broken statement.
import { sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consents, devices, entitlements, profiles, userSettings } from '../../src/schema/index.js';
import { withUserTx, withWorkerTx, type Database, type Transaction } from '../../src/index.js';
import {
  apiUrl,
  attempt,
  claimsFor,
  isBlocked,
  openDatabase,
  rolledBack,
  ROUTES,
  USER_A,
  USER_B,
  workerUrl,
  type Outcome,
  type Route,
} from './support.js';

interface TableCase {
  readonly table: PgTable;
  /** One row per user (keyed by user_id), so a second own row can't be inserted. */
  readonly oneToOne: boolean;
  /** A no-op SET the API role may run, or undefined if it may not update the table at all. */
  readonly apiSet: string | undefined;
  readonly workerSet: string;
  /** Column list and VALUES of a new row for `userId` that violates no constraint. */
  readonly newRow: (userId: string) => SQL;
}

const TABLES: Readonly<Record<string, TableCase>> = {
  profiles: {
    table: profiles,
    oneToOne: true,
    apiSet: 'display_name = display_name',
    workerSet: 'display_name = display_name',
    newRow: (userId) => sql`(user_id) values (${userId})`,
  },
  user_settings: {
    table: userSettings,
    oneToOne: true,
    apiSet: 'theme = theme',
    workerSet: 'theme = theme',
    newRow: (userId) => sql`(user_id) values (${userId})`,
  },
  entitlements: {
    table: entitlements,
    oneToOne: false,
    apiSet: undefined,
    workerSet: 'tier = tier',
    newRow: (userId) => sql`(user_id, tier, source) values (${userId}, 'premium', 'manual')`,
  },
  consents: {
    table: consents,
    oneToOne: false,
    apiSet: 'revoked_at = revoked_at',
    workerSet: 'revoked_at = revoked_at',
    newRow: (userId) => sql`(user_id, purpose, consent_version) values (${userId}, 'ai_coach', 'test')`,
  },
  devices: {
    table: devices,
    oneToOne: false,
    apiSet: 'name = name',
    workerSet: 'name = name',
    newRow: (userId) => sql`(user_id, kind, auth_session_id) values (${userId}, 'web', gen_random_uuid())`,
  },
};

interface Actor {
  readonly role: 'enduva_api' | 'enduva_worker';
  readonly url: (route: Route) => string;
  readonly open: (db: Database, userId: string) => (fn: (tx: Transaction) => Promise<never>) => Promise<unknown>;
  readonly set: (table: TableCase) => string | undefined;
  readonly mayDelete: boolean;
}

const ACTORS: readonly Actor[] = [
  {
    role: 'enduva_api',
    url: apiUrl,
    open: (db, userId) => (fn) => withUserTx(db, claimsFor(userId), fn),
    set: (table) => table.apiSet,
    mayDelete: false,
  },
  {
    role: 'enduva_worker',
    url: workerUrl,
    open: (db, userId) => (fn) => withWorkerTx(db, userId, fn),
    set: (table) => table.workerSet,
    mayDelete: true,
  },
];

const PAIRS = [
  { actor: USER_A, victim: USER_B, label: 'A → B' },
  { actor: USER_B, victim: USER_A, label: 'B → A' },
];

const rowCount = async (tx: Transaction, query: SQL) => (await tx.execute(query)).rowCount ?? 0;

/** Positive control: the statement ran and touched at least one of the actor's own rows. */
function expectTouched(outcome: Outcome): void {
  expect(outcome).toHaveProperty('rows');
  expect('rows' in outcome && outcome.rows).toBeGreaterThan(0);
}

describe.each(ACTORS)('$role', (actor) => {
  describe.each(ROUTES)('via %s', (route) => {
    let db: Database;
    beforeAll(() => {
      db = openDatabase(actor.url(route));
    });
    afterAll(async () => {
      await db.$client.end();
    });

    describe.each(PAIRS)('$label', ({ actor: me, victim }) => {
      const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => rolledBack(actor.open(db, me), fn);

      describe.each(Object.entries(TABLES))('%s', (_name, table) => {
        const t = table.table;
        const set = actor.set(table);

        it('reads only its own rows', async () => {
          const owners = await inTx(async (tx) => {
            const result = await tx.execute<{ user_id: string }>(sql`select distinct user_id::text from ${t}`);
            return result.rows.map((row) => row.user_id);
          });
          expect(owners).toEqual([me]);

          const victimRows = await inTx((tx) => rowCount(tx, sql`select 1 from ${t} where user_id = ${victim}`));
          expect(victimRows).toBe(0);
        });

        it("can't update the other user's rows", async () => {
          const statement = sql`update ${t} set ${sql.raw(set ?? 'user_id = user_id')} where user_id = `;
          const outcome = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${victim}`)));
          expect(isBlocked(outcome)).toBe(true);

          if (set !== undefined) {
            expectTouched(await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${me}`))));
          }
        });

        it("can't delete the other user's rows", async () => {
          const statement = sql`delete from ${t} where user_id = `;
          const outcome = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${victim}`)));
          expect(isBlocked(outcome)).toBe(true);

          const own = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${me}`)));
          if (actor.mayDelete) expectTouched(own);
          else expect(own).toEqual({ denied: true });
        });

        it("can't insert rows for the other user", async () => {
          const insert = (userId: string) => sql`insert into ${t} ${table.newRow(userId)}`;
          expect(await attempt(() => inTx((tx) => rowCount(tx, insert(victim))))).toEqual({ denied: true });

          const mayInsert = actor.role === 'enduva_worker' ? !table.oneToOne : !table.oneToOne && t !== entitlements;
          if (mayInsert) {
            expectTouched(await attempt(() => inTx((tx) => rowCount(tx, insert(me)))));
          }
        });

        it("can't hand its own rows to the other user", async () => {
          const outcome = await attempt(() =>
            inTx((tx) => rowCount(tx, sql`update ${t} set user_id = ${victim} where user_id = ${me}`)),
          );
          expect(outcome).toEqual({ denied: true });
        });
      });

      it("can't reach the other user's rows through a join", async () => {
        const rows = await inTx((tx) =>
          rowCount(
            tx,
            sql`select 1 from ${profiles} p
                join ${devices} d on d.user_id = p.user_id
                join ${consents} c on c.user_id = p.user_id
                where p.user_id = ${victim} or d.user_id = ${victim} or c.user_id = ${victim}`,
          ),
        );
        expect(rows).toBe(0);
      });

      it('counts only its own rows in aggregates', async () => {
        const counts = await inTx(async (tx) => {
          const result = await tx.execute<{ users: number }>(
            sql`select count(distinct user_id)::int as users from (
                  select user_id from ${profiles} union all select user_id from ${userSettings}
                  union all select user_id from ${entitlements} union all select user_id from ${consents}
                  union all select user_id from ${devices}) all_rows`,
          );
          return result.rows[0]?.users;
        });
        expect(counts).toBe(1);
      });
    });
  });
});
