import { consents, DatabaseError, devices, entitlements, profiles, userSettings } from '@enduva/db';
import { DrizzleQueryError } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

/** What may be logged of a database error: SQLSTATE by its strict shape, table and constraint only if our schema declares them. */
export interface DatabaseErrorFields {
  /** SQLSTATE, e.g. `23505`. */
  readonly sqlState?: string;
  readonly table?: string;
  readonly constraint?: string;
}

const sqlState = /^[0-9A-Z]{5}$/;

/** Every table of the schema. Add new tables here, or their errors are logged without table and constraint. */
const schemaTables: readonly PgTable[] = [profiles, userSettings, devices, consents, entitlements];

/**
 * Table and constraint names that may be logged: exactly the names our schema declares (drizzle-kit generates the
 * DDL, so the names match the database). A shape check alone isn't enough: an identifier-shaped value supplied by a
 * mutated error or a proxy could still be personal data, so anything not in these sets is dropped.
 */
function knownNames(): { readonly tables: ReadonlySet<string>; readonly constraints: ReadonlySet<string> } {
  const tables = new Set<string>();
  const constraints = new Set<string>();
  const add = (name: string | undefined) => {
    if (name) constraints.add(name);
  };
  for (const table of schemaTables) {
    const config = getTableConfig(table);
    tables.add(config.name);
    add(`${config.name}_pkey`);
    for (const column of config.columns) if (column.isUnique) add(column.uniqueName);
    for (const index of config.indexes) add(index.config.name);
    for (const key of config.foreignKeys) add(key.getName());
    for (const key of config.primaryKeys) add(key.getName());
    for (const unique of config.uniqueConstraints) add(unique.getName());
    for (const check of config.checks) add(check.name);
  }
  return { tables, constraints };
}

const known = knownNames();

const pick = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;

const pickKnown = (value: unknown, names: ReadonlySet<string>): string | undefined =>
  typeof value === 'string' && names.has(value) ? value : undefined;

function fieldsOf(error: unknown): DatabaseErrorFields | undefined {
  const server = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(server instanceof DatabaseError)) return error instanceof DrizzleQueryError ? {} : undefined;
  const fields = {
    sqlState: pick(server.code, sqlState),
    table: pickKnown(server.table, known.tables),
    constraint: pickKnown(server.constraint, known.constraints),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

/**
 * The loggable fields of a database error: SQLSTATE, table and constraint. Drizzle interpolates the parameters into
 * its message (and so its stack), and Postgres' message, detail, hint and where can quote values; any of them can
 * hold personal or health data, so none of them is logged, nor is the query text. `undefined` for other errors.
 *
 * A server error is recognised by pg's `DatabaseError` class, never by a name. This never throws: a thrown value
 * whose prototype lookup or fields throw (a proxy, a getter) yields no fields.
 */
export function databaseErrorFields(error: unknown): DatabaseErrorFields | undefined {
  try {
    return fieldsOf(error);
  } catch {
    return undefined;
  }
}
