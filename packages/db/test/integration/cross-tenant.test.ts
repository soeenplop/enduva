// Cross-tenant suite (ADR-0002): acting as one user, every attempt to read or write another user's rows in every
// account table returns nothing or is denied, for the API and the worker role, through the transaction pooler and
// directly. Each attempt runs in its own rolled-back transaction. Controls run the same statements on rows the actor
// owns: they work where the role's grants allow them (so "nothing" isn't the result of a broken statement) and are
// denied where they don't (support.ts → TABLE_CASES).
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { consents, devices, entitlements, profiles, userSettings } from '../../src/schema/index.js';
import type { Database, Transaction } from '../../src/index.js';
import {
  ACTORS,
  attempt,
  isBlocked,
  openDatabase,
  rolledBack,
  ROUTES,
  TABLE_CASES,
  tableSql,
  USER_A,
  USER_B,
  type Outcome,
} from './support.js';

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
      const inTxAs = <T>(userId: string, fn: (tx: Transaction) => Promise<T>) => rolledBack(actor.open(db, userId), fn);
      const inTx = <T>(fn: (tx: Transaction) => Promise<T>) => inTxAs(me, fn);

      describe.each(TABLE_CASES)('$name', (table) => {
        const t = tableSql(table.name);
        const access = table.access[actor.role];

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
          // A role that may update nothing here tries a column it can't write: the grant must deny it.
          const statement = sql`update ${t} set ${sql.raw(access.set ?? 'user_id = user_id')} where user_id = `;
          const outcome = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${victim}`)));
          expect(isBlocked(outcome)).toBe(true);

          const own = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${me}`)));
          if (access.set !== undefined) expectTouched(own);
          else expect(own).toEqual({ denied: true });
        });

        it("can't delete the other user's rows", async () => {
          const statement = sql`delete from ${t} where user_id = `;
          const outcome = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${victim}`)));
          expect(isBlocked(outcome)).toBe(true);

          const own = await attempt(() => inTx((tx) => rowCount(tx, sql`${statement}${me}`)));
          if (access.delete) expectTouched(own);
          else expect(own).toEqual({ denied: true });
        });

        // The row is valid for its owner, so only the identity check can stop it: for one-to-one tables the owner
        // is a fixture user without that row yet (C has no profile, D no settings), otherwise the other user.
        it("can't insert rows for another user", async () => {
          const owner = table.freshUser ?? victim;
          const insert = sql`insert into ${t} ${table.newRow(owner)}`;
          expect(await attempt(() => inTx((tx) => rowCount(tx, insert)))).toEqual({ denied: true });

          const asOwner = await attempt(() => inTxAs(owner, (tx) => rowCount(tx, insert)));
          if (access.insert) expectTouched(asOwner);
          else expect(asOwner).toEqual({ denied: true });
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
