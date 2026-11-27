import { sql } from 'drizzle-orm';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

import type { Database, Transaction } from './client.js';

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
  return db.transaction(async (tx) => {
    // `set_config('role', …, true)` is `set local role …`, with the role passed as a parameter.
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true), set_config('role', ${role}, true)`,
    );
    return fn(tx);
  }, config);
}
