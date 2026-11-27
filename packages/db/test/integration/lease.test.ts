// The request transaction's hold on its pool client (ADR-0002): the client always goes back to the pool, broken
// clients are destroyed, and a connection lost mid-transaction fails the transaction instead of the process.
import { setTimeout as delay } from 'node:timers/promises';

import { sql } from 'drizzle-orm';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, withUserTx, type Database } from '../../src/index.js';
import { apiUrl, claimsFor, ROUTES, USER_A } from './support.js';

const asA = <T>(db: Database, fn: Parameters<typeof withUserTx<T>>[2], config?: PgTransactionConfig) =>
  withUserTx(db, claimsFor(USER_A), fn, config);

const userId = async (db: Database) =>
  asA(db, async (tx) => (await tx.execute<{ id: string }>(sql`select app.current_user_id() as id`)).rows[0]?.id);

describe.each(ROUTES)('the leased transaction client via %s', (route) => {
  let db: Database;
  beforeAll(() => {
    // One slot: a leaked client would make every later transaction wait forever.
    db = createDatabase({ connectionString: apiUrl(route), max: 1, applicationName: 'enduva-db-tests' });
  });
  afterAll(async () => {
    await db.$client.end();
  });

  it('gives the slot back when BEGIN fails', async () => {
    const invalid = { isolationLevel: 'no such level' } as unknown as PgTransactionConfig;
    await expect(asA(db, async () => 'unreachable', invalid)).rejects.toThrow();
    expect(db.$client.totalCount).toBe(0);
    await expect(userId(db)).resolves.toBe(USER_A);
  });

  it('keeps a client that rolled back cleanly after the handler failed', async () => {
    await userId(db);
    await expect(
      asA(db, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(db.$client.totalCount).toBe(1);
    expect(db.$client.idleCount).toBe(1);
    await expect(userId(db)).resolves.toBe(USER_A);
  });
});

describe('a connection lost during the lease (direct)', () => {
  let db: Database;
  let killer: Database;
  beforeAll(() => {
    db = createDatabase({ connectionString: apiUrl('direct'), max: 1, applicationName: 'enduva-db-tests' });
    killer = createDatabase({ connectionString: apiUrl('direct'), max: 1, applicationName: 'enduva-db-tests' });
  });
  afterAll(async () => {
    await Promise.all([db.$client.end(), killer.$client.end()]);
  });

  it('fails the transaction, not the process, and destroys the client', async () => {
    const lost = asA(db, async (tx) => {
      const [backend] = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows;
      // Same login, outside a transaction: allowed to signal its own role's backends.
      await killer.execute(sql`select pg_terminate_backend(${backend?.pid ?? 0})`);
      // Between queries: node-postgres emits `error` on the client, which the pool no longer listens to.
      await delay(200);
      return 'committed';
    });
    await expect(lost).rejects.toThrow();
    expect(db.$client.totalCount).toBe(0);
    await expect(userId(db)).resolves.toBe(USER_A);
  });
});
