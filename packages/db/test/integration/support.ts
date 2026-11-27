import { inject } from 'vitest';

import { createDatabase, type Database, type Transaction, type VerifiedClaims } from '../../src/index.js';

// Seeded by supabase/seed.sql.
export const USER_A = '0000000a-0000-4000-8000-00000000000a';
export const USER_B = '0000000b-0000-4000-8000-00000000000b';
export const PASSWORDS: Readonly<Record<string, string>> = {
  [USER_A]: 'enduva-local-a',
  [USER_B]: 'enduva-local-b',
};
export const EMAILS: Readonly<Record<string, string>> = {
  [USER_A]: 'athlete.a@example.com',
  [USER_B]: 'athlete.b@example.com',
};

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

type OpenTx = (fn: (tx: Transaction) => Promise<never>) => Promise<unknown>;

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
