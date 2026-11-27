import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import * as schema from './schema/index.js';

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema> & { $client: pg.Pool };
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseOptions {
  /** Supabase transaction-pooler URL for the API, e.g. `postgresql://enduva_api_login.<tenant>:…@…:6543/postgres`. */
  readonly connectionString: string;
  /** Pool size per process (06-deployment → Connection budget). */
  readonly max?: number;
  /** How long a checkout may wait for a connection, queued or new; unbounded if omitted (node-postgres default). */
  readonly connectionTimeoutMillis?: number;
  readonly applicationName?: string;
}

/**
 * Creates a node-postgres pool and a Drizzle database on top of it. Safe for Supabase's transaction pooler:
 * node-postgres sends unnamed statements unless a query has a `name`, and Drizzle only names one for
 * `.prepare(name)`, which this codebase doesn't use (ADR-0002). Close it with `db.$client.end()`.
 */
export function createDatabase({
  connectionString,
  max = 10,
  connectionTimeoutMillis,
  applicationName = 'enduva',
}: DatabaseOptions): Database {
  const pool = new pg.Pool({
    connectionString,
    max,
    application_name: applicationName,
    ...(connectionTimeoutMillis === undefined ? {} : { connectionTimeoutMillis }),
  });
  return drizzle({ client: pool, schema });
}
