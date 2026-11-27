import { sql, type SQL } from 'drizzle-orm';
import { inject } from 'vitest';

import {
  createDatabase,
  withUserTx,
  withWorkerTx,
  type Database,
  type Transaction,
  type VerifiedClaims,
} from '../../src/index.js';

// Seeded by supabase/seed.sql. A and B have rows in every account table.
export const USER_A = '0000000a-0000-4000-8000-00000000000a';
export const USER_B = '0000000b-0000-4000-8000-00000000000b';
/** An auth user without a profile: the API may create one for them. */
export const USER_C = '0000000c-0000-4000-8000-00000000000c';
/** A profile without settings: the API may create them. */
export const USER_D = '0000000d-0000-4000-8000-00000000000d';
export const PASSWORDS: Readonly<Record<string, string>> = {
  [USER_A]: 'enduva-local-a',
  [USER_B]: 'enduva-local-b',
};
export const EMAILS: Readonly<Record<string, string>> = {
  [USER_A]: 'athlete.a@example.com',
  [USER_B]: 'athlete.b@example.com',
};

export type RuntimeRole = 'enduva_api' | 'enduva_worker';

// Ports from supabase/config.toml ([db].port, [db.pooler].port). `pooler-dev` is the tenant the CLI registers in
// its local Supavisor, which expects `<role>.<tenant>` as the user name, like the hosted pooler.
const DB_PORT = 54322;
const POOLER_PORT = 54329;
const POOLER_TENANT = 'pooler-dev';

export type Route = 'pooler' | 'direct';

/** Connection URL of a local login role, through Supavisor (transaction mode) or straight to Postgres. */
export function localUrl(user: string, password: string, route: Route): string {
  const { dbHost } = inject('supabase');
  const name = route === 'pooler' ? `${user}.${POOLER_TENANT}` : user;
  const port = route === 'pooler' ? POOLER_PORT : DB_PORT;
  return `postgresql://${encodeURIComponent(name)}:${encodeURIComponent(password)}@${dbHost}:${port}/postgres`;
}

export const apiUrl = (route: Route) => localUrl('enduva_api_login', 'enduva-local-api', route);
export const workerUrl = (route: Route) => localUrl('enduva_worker_login', 'enduva-local-worker', route);
/** The CLI's local superuser-like migration role, for catalog checks only. */
export const adminUrl = () => localUrl('postgres', 'postgres', 'direct');

export const ROUTES: readonly Route[] = ['pooler', 'direct'];

export function openDatabase(connectionString: string): Database {
  return createDatabase({ connectionString, max: 2, applicationName: 'enduva-db-tests' });
}

export const claimsFor = (sub: string): VerifiedClaims => ({ sub, role: 'authenticated' });

export type OpenTx = (fn: (tx: Transaction) => Promise<never>) => Promise<unknown>;
/** Runs `fn` in a transaction opened with some identity. */
export type TxRunner = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;

export interface Actor {
  readonly role: RuntimeRole;
  readonly login: string;
  readonly url: (route: Route) => string;
  /** Opens a transaction acting for `userId`, the way production code does. */
  readonly open: (db: Database, userId: string) => TxRunner;
}

export const ACTORS: readonly Actor[] = [
  {
    role: 'enduva_api',
    login: 'enduva_api_login',
    url: apiUrl,
    open: (db, userId) => (fn) => withUserTx(db, claimsFor(userId), fn),
  },
  {
    role: 'enduva_worker',
    login: 'enduva_worker_login',
    url: workerUrl,
    open: (db, userId) => (fn) => withWorkerTx(db, userId, fn),
  },
];

/**
 * Opens a transaction as `role` with whatever `request.jwt.claims` the test wants, including none (`undefined`) or
 * claims without `sub`, which withUserTx/withWorkerTx would refuse. For fail-closed checks only.
 */
export const rawIdentityTx =
  (db: Database, role: RuntimeRole, claims: Readonly<Record<string, unknown>> | undefined): TxRunner =>
  (fn) =>
    db.transaction(async (tx) => {
      if (claims !== undefined) {
        await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
      }
      await tx.execute(sql`select set_config('role', ${role}, true)`);
      return fn(tx);
    });

/** What a runtime role may do on an account table (supabase/migrations/…_account_security.sql). */
export interface Access {
  /** May insert a row (with the columns of `TableCase.newRow`). */
  readonly insert: boolean;
  /** A no-op SET over columns the role may update, or undefined if it may update none. */
  readonly set: string | undefined;
  readonly delete: boolean;
}

export interface TableCase {
  readonly name: 'profiles' | 'user_settings' | 'entitlements' | 'consents' | 'devices';
  /** Column list and VALUES of a new row for `userId` that violates no constraint. */
  readonly newRow: (userId: string) => SQL;
  /**
   * A user for whom `newRow` is valid. One-to-one tables (keyed by user_id) need a user without the row: C has no
   * profile, D has no settings. Other tables take any user with a profile.
   */
  readonly freshUser: string | undefined;
  readonly access: Readonly<Record<RuntimeRole, Access>>;
}

const NO_UPDATE_OR_DELETE = { set: undefined, delete: false } as const;

export const TABLE_CASES: readonly TableCase[] = [
  {
    name: 'profiles',
    newRow: (userId) => sql`(user_id, display_name) values (${userId}, 'New')`,
    freshUser: USER_C,
    access: {
      enduva_api: { insert: true, set: 'display_name = display_name', delete: false },
      enduva_worker: { insert: false, set: 'display_name = display_name', delete: true },
    },
  },
  {
    name: 'user_settings',
    newRow: (userId) => sql`(user_id, theme) values (${userId}, 'dark')`,
    freshUser: USER_D,
    access: {
      enduva_api: { insert: true, set: 'theme = theme', delete: false },
      enduva_worker: { insert: false, set: 'theme = theme', delete: false },
    },
  },
  {
    name: 'entitlements',
    newRow: (userId) => sql`(user_id, tier, source) values (${userId}, 'premium', 'manual')`,
    freshUser: undefined,
    access: {
      enduva_api: { insert: false, ...NO_UPDATE_OR_DELETE },
      enduva_worker: { insert: true, set: 'tier = tier', delete: false },
    },
  },
  {
    name: 'consents',
    newRow: (userId) => sql`(user_id, purpose, consent_version) values (${userId}, 'ai_coach', 'test')`,
    freshUser: undefined,
    access: {
      enduva_api: { insert: true, set: 'revoked_at = revoked_at', delete: false },
      enduva_worker: { insert: false, set: 'revoked_at = revoked_at', delete: false },
    },
  },
  {
    name: 'devices',
    newRow: (userId) => sql`(user_id, kind, auth_session_id) values (${userId}, 'web', gen_random_uuid())`,
    freshUser: undefined,
    access: {
      enduva_api: { insert: true, set: 'name = name', delete: false },
      enduva_worker: { insert: false, set: 'last_seen_at = last_seen_at', delete: false },
    },
  },
];

/** `app.<table>` as an identifier. */
export const tableSql = (name: TableCase['name']) => sql.raw(`app.${name}`);

/** SQLSTATE of a Postgres error, also when Drizzle wraps it. */
export function pgCode(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    if ('code' in current && typeof current.code === 'string') return current.code;
  }
  return undefined;
}

export type Outcome = { readonly rows: number } | { readonly denied: true };

/**
 * Runs a statement and reports how many rows it returned or touched, or that Postgres denied it with
 * `insufficient_privilege` (42501: missing grant or row-level security violation). Any other error fails the test,
 * so a broken statement never passes as "blocked".
 */
export async function attempt(run: () => Promise<number>): Promise<Outcome> {
  try {
    return { rows: await run() };
  } catch (error) {
    if (pgCode(error) === '42501') return { denied: true };
    throw error;
  }
}

/** True if a cross-tenant attempt leaked nothing: no rows, or denied. */
export const isBlocked = (outcome: Outcome) => 'denied' in outcome || outcome.rows === 0;

class Rollback extends Error {
  constructor(readonly value: unknown) {
    super('test rollback');
  }
}

/** Runs `fn` in a transaction opened by `open` (e.g. withUserTx) and rolls it back, so the seed stays intact. */
export async function rolledBack<T>(open: OpenTx, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    await open(async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (error) {
    if (error instanceof Rollback) return error.value as T;
    throw error;
  }
  throw new Error('The transaction was not rolled back');
}
