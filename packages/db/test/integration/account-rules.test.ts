// Rules on the account tables that hold for the runtime roles on their own rows (ADR-0002): revocation is one-way,
// `role` and server-maintained columns can't be written, entitlements are the worker's, and consent and device
// history only goes with the account.
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database, Transaction } from '../../src/index.js';
import { ACTORS, attempt, openDatabase, pgCode, rolledBack, ROUTES, USER_A, USER_C, USER_D } from './support.js';

const rows = async <T extends Record<string, unknown>>(tx: Transaction, query: SQL) =>
  (await tx.execute<T>(query)).rows;
const rowCount = async (tx: Transaction, query: SQL) => (await tx.execute(query)).rowCount ?? 0;

/** Runs `fn`, which is expected to fail, and returns the SQLSTATE it failed with. */
async function sqlState(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (error) {
    return pgCode(error);
  }
  return 'no error';
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

    const asUser = <T>(userId: string, fn: (tx: Transaction) => Promise<T>) => rolledBack(actor.open(db, userId), fn);
    const asA = <T>(fn: (tx: Transaction) => Promise<T>) => asUser(USER_A, fn);

    describe.each(['consents', 'devices'])('revoking %s', (name) => {
      const t = sql.raw(`app.${name}`);

      it('is stamped by the database and can never be undone or moved', async () => {
        const states = await asA(async (tx) => {
          // A past time is ignored: the database stamps the revocation itself.
          const [revoked] = await rows<{ stamped: boolean }>(
            tx,
            sql`update ${t} set revoked_at = '2000-01-01' where revoked_at is null
                returning revoked_at = now() as stamped`,
          );
          const attempts: Record<string, string | undefined> = {};
          for (const [label, set] of [
            ['clear', sql`revoked_at = null`],
            ['move back', sql`revoked_at = revoked_at - interval '1 hour'`],
            ['move forward', sql`revoked_at = revoked_at + interval '1 hour'`],
          ] as const) {
            attempts[label] = await sqlState(() =>
              tx.transaction((savepoint) => savepoint.execute(sql`update ${t} set ${set}`)),
            );
          }
          const noop = await rowCount(tx, sql`update ${t} set revoked_at = revoked_at`);
          const active = await rowCount(tx, sql`select 1 from ${t} where revoked_at is null`);
          return { revoked, attempts, noop, active };
        });
        expect(states).toEqual({
          revoked: { stamped: true },
          attempts: { clear: '23514', 'move back': '23514', 'move forward': '23514' },
          noop: 1,
          active: 0,
        });
      });

      it("can't be supplied on insert", async () => {
        const columns = name === 'consents' ? sql`purpose, consent_version` : sql`kind, auth_session_id`;
        const values = name === 'consents' ? sql`'ai_coach', 'test'` : sql`'web', gen_random_uuid()`;
        const outcome = await attempt(() =>
          asA((tx) =>
            rowCount(tx, sql`insert into ${t} (user_id, ${columns}, revoked_at) values (${USER_A}, ${values}, now())`),
          ),
        );
        expect(outcome).toEqual({ denied: true });
      });

      it("can't delete the history", async () => {
        expect(await attempt(() => asA((tx) => rowCount(tx, sql`delete from ${t}`)))).toEqual({ denied: true });
      });
    });

    if (actor.role === 'enduva_api') {
      it('grants consent again as a new row, keeping the revoked one', async () => {
        const history = await asA(async (tx) => {
          await tx.execute(sql`update app.consents set revoked_at = now() where purpose = 'health_data'`);
          await tx.execute(
            sql`insert into app.consents (user_id, purpose, consent_version) values (${USER_A}, 'health_data', '2026-12')`,
          );
          return rows<{ consent_version: string; revoked: boolean }>(
            tx,
            sql`select consent_version, revoked_at is not null as revoked from app.consents
                where purpose = 'health_data' order by revoked desc`,
          );
        });
        expect(history).toEqual([
          { consent_version: '2026-11', revoked: true },
          { consent_version: '2026-12', revoked: false },
        ]);
      });

      it('creates a profile only as a user, with server-maintained columns at their defaults', async () => {
        const created = await asUser(USER_C, async (tx) => {
          await tx.execute(sql`insert into app.profiles (user_id) values (${USER_C})`);
          return rows(
            tx,
            sql`select role, version, created_at = now() as created_now, updated_at = now() as updated_now
                from app.profiles`,
          );
        });
        expect(created).toEqual([{ role: 'user', version: '1', created_now: true, updated_now: true }]);
      });

      it.each([
        ['role', sql`(user_id, role) values (${USER_C}, 'admin')`],
        ['role (as user)', sql`(user_id, role) values (${USER_C}, 'user')`],
        ['version', sql`(user_id, version) values (${USER_C}, 100)`],
        ['created_at', sql`(user_id, created_at) values (${USER_C}, '2000-01-01')`],
        ['updated_at', sql`(user_id, updated_at) values (${USER_C}, '2000-01-01')`],
      ])("can't set %s when creating a profile", async (_column, values) => {
        const outcome = await attempt(() =>
          asUser(USER_C, (tx) => rowCount(tx, sql`insert into app.profiles ${values}`)),
        );
        expect(outcome).toEqual({ denied: true });
      });

      it.each([
        [
          'consents.granted_at',
          USER_A,
          sql`app.consents (user_id, purpose, consent_version, granted_at)`,
          sql`'ai_coach', 't', '2000-01-01'`,
        ],
        [
          'consents.id',
          USER_A,
          sql`app.consents (user_id, purpose, consent_version, id)`,
          sql`'ai_coach', 't', gen_random_uuid()`,
        ],
        [
          'devices.created_at',
          USER_A,
          sql`app.devices (user_id, kind, auth_session_id, created_at)`,
          sql`'web', gen_random_uuid(), now()`,
        ],
        ['user_settings.version', USER_D, sql`app.user_settings (user_id, version)`, sql`7`],
      ])("can't set %s on insert", async (_column, owner, target, values) => {
        const outcome = await attempt(() =>
          asUser(owner, (tx) => rowCount(tx, sql`insert into ${target} values (${owner}, ${values})`)),
        );
        expect(outcome).toEqual({ denied: true });
      });

      it.each([
        ['insert', sql`insert into app.entitlements (user_id, tier, source) values (${USER_A}, 'premium', 'manual')`],
        ['update', sql`update app.entitlements set valid_until = now() + interval '1 year'`],
        ['update the tier', sql`update app.entitlements set tier = 'premium'`],
      ])("can't %s entitlements", async (_label, statement) => {
        expect(await attempt(() => asA((tx) => rowCount(tx, statement)))).toEqual({ denied: true });
      });
    }

    it.each([
      ['assign admin', sql`update app.profiles set role = 'admin'`],
      ['set the role at all', sql`update app.profiles set role = role`],
      ['set the version', sql`update app.profiles set version = 1`],
      ['set a timestamp', sql`update app.profiles set created_at = now()`],
    ])("can't %s on its profile", async (_label, statement) => {
      expect(await attempt(() => asA((tx) => rowCount(tx, statement)))).toEqual({ denied: true });
    });

    if (actor.role === 'enduva_worker') {
      it("can't create a profile, so it can't create one as admin", async () => {
        const outcome = await attempt(() =>
          asUser(USER_C, (tx) =>
            rowCount(tx, sql`insert into app.profiles (user_id, role) values (${USER_C}, 'admin')`),
          ),
        );
        expect(outcome).toEqual({ denied: true });
      });

      it('deletes an account with all its rows, consent and device history included', async () => {
        const left = await asA(async (tx) => {
          await tx.execute(sql`update app.consents set revoked_at = now()`);
          await tx.execute(sql`delete from app.profiles`);
          return rows<{ rows: number }>(
            tx,
            sql`select count(*)::int as rows from (
                  select user_id from app.profiles union all select user_id from app.user_settings
                  union all select user_id from app.entitlements union all select user_id from app.consents
                  union all select user_id from app.devices) all_rows`,
          );
        });
        expect(left).toEqual([{ rows: 0 }]);
      });

      it('maintains entitlements, but not their owner, source or store ID', async () => {
        const changed = await asA((tx) =>
          rowCount(tx, sql`update app.entitlements set tier = 'premium', valid_until = now() + interval '1 year'`),
        );
        expect(changed).toBe(1);
        for (const set of ['source = source', 'external_id = external_id', 'created_at = created_at']) {
          expect(
            await attempt(() => asA((tx) => rowCount(tx, sql`update app.entitlements set ${sql.raw(set)}`))),
          ).toEqual({ denied: true });
        }
      });
    }
  });
});
