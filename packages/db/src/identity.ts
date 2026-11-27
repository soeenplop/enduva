import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

import type { Database, Transaction } from './client.js';
import * as schema from './schema/index.js';

/**
 * Claims of an access token the API has verified: signature against the Supabase JWKS, `iss`, `aud`, `exp`
 * (02-architecture → Authentication). Never build this from an unverified token.
 */
export interface VerifiedClaims {
  readonly sub: string;
  readonly role: 'authenticated';
  readonly [claim: string]: unknown;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUserId(userId: string): void {
  if (!uuidPattern.test(userId)) throw new TypeError('The user ID must be a UUID');
}

/**
 * Runs `fn` in one transaction as the API role, acting for the verified user. Row-level security limits every
 * query to that user's rows. Identity and role are transaction-local (`set_config(…, true)`), so nothing outlives
 * the transaction and the connection can go back to Supabase's transaction pooler.
 */
export async function withUserTx<T>(
  db: Database,
  claims: VerifiedClaims,
  fn: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  if (claims.role !== 'authenticated') throw new TypeError('Only `authenticated` tokens act for a user');
  assertUserId(claims.sub);
  return withIdentityTx(db, 'enduva_api', claims, fn, config);
}

/** Runs `fn` in one transaction as the worker role, acting for the user a job belongs to. */
export async function withWorkerTx<T>(
  db: Database,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  assertUserId(userId);
  return withIdentityTx(db, 'enduva_worker', { sub: userId, role: 'enduva_worker' }, fn, config);
}

function withIdentityTx<T>(
  db: Database,
  role: 'enduva_api' | 'enduva_worker',
  claims: Readonly<Record<string, unknown>>,
  fn: (tx: Transaction) => Promise<T>,
  config: PgTransactionConfig | undefined,
): Promise<T> {
  return leasedTransaction(
    db,
    async (tx) => {
      // `set_config('role', …, true)` is `set local role …`, with the role passed as a parameter.
      await tx.execute(
        sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', ${role}, true)`,
      );
      return fn(tx);
    },
    config,
  );
}

/**
 * One transaction on a client checked out of `db`'s pool for exactly its duration. Drizzle's own pool transaction
 * awaits `BEGIN` before the `try` that releases the client, so a failed `BEGIN` would lose the pool slot, and the pool
 * stops listening for `error` on a checked-out client, so a connection error between queries would crash the
 * process. Here the client always goes back to the pool, has an `error` listener for the whole lease, and is
 * destroyed instead of reused unless the transaction ended cleanly: committed, or rolled back after `fn` failed.
 */
export async function leasedTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  const client = await db.$client.connect();
  let broken = false;
  const onError = (): void => {
    broken = true;
  };
  client.on('error', onError);
  let fnError: { readonly error: unknown } | undefined;
  try {
    // Drizzle on a single client runs BEGIN, COMMIT and ROLLBACK on it and leaves releasing it to us.
    return await drizzle({ client, schema }).transaction(async (tx) => {
      try {
        return await fn(tx);
      } catch (error) {
        fnError = { error };
        throw error;
      }
    }, config);
  } catch (error) {
    // Anything but `fn`'s own error (BEGIN, COMMIT or ROLLBACK failed) leaves the connection in an unknown state.
    if (fnError?.error !== error) broken = true;
    throw error;
  } finally {
    client.off('error', onError);
    client.release(broken);
  }
}
