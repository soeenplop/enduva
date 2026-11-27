import { consents, DatabaseError, devices, entitlements, profiles, userSettings } from '@enduva/db';
import { DrizzleQueryError } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';

/** What may be logged of a database error: only values from fixed allowlists, never a value just because of its shape. */
export interface DatabaseErrorFields {
  /** SQLSTATE, e.g. `23505`, if it is one of `knownSqlStates`. */
  readonly sqlState?: string;
  /** The SQLSTATE class, e.g. `23`, for any other code whose class Postgres defines. */
  readonly sqlStateClass?: string;
  readonly table?: string;
  readonly constraint?: string;
}

/**
 * SQLSTATEs logged in full: the ones the API can expect or act on. A thrown value can carry any five characters in
 * `code`, so other codes are reduced to their class (PostgreSQL docs, Appendix A), and unknown classes are dropped.
 */
const knownSqlStates: ReadonlySet<string> = new Set([
  '08000',
  '08001',
  '08003',
  '08006',
  '22001',
  '22003',
  '22007',
  '22008',
  '22P02',
  '23502',
  '23503',
  '23505',
  '23514',
  '23P01',
  '25P02',
  '28000',
  '28P01',
  '3D000',
  '40001',
  '40P01',
  '42501',
  '42703',
  '42P01',
  '53300',
  '55P03',
  '57014',
  '57P01',
  '57P03',
]);

const sqlStateClasses: ReadonlySet<string> = new Set([
  '00',
  '01',
  '02',
  '03',
  '08',
  '09',
  '0A',
  '0B',
  '0F',
  '0L',
  '0P',
  '0Z',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '2B',
  '2D',
  '2F',
  '34',
  '38',
  '39',
  '3B',
  '3D',
  '3F',
  '40',
  '42',
  '44',
  '53',
  '54',
  '55',
  '57',
  '58',
  '72',
  'F0',
  'HV',
  'P0',
  'XX',
]);

function sqlStateFields(code: unknown): Pick<DatabaseErrorFields, 'sqlState' | 'sqlStateClass'> {
  if (typeof code !== 'string') return {};
  if (knownSqlStates.has(code)) return { sqlState: code };
  const sqlClass = code.length === 5 ? code.slice(0, 2) : undefined;
  return sqlClass !== undefined && sqlStateClasses.has(sqlClass) ? { sqlStateClass: sqlClass } : {};
}

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

const pickKnown = (value: unknown, names: ReadonlySet<string>): string | undefined =>
  typeof value === 'string' && names.has(value) ? value : undefined;

function fieldsOf(error: unknown): DatabaseErrorFields | undefined {
  const server = error instanceof DrizzleQueryError ? error.cause : error;
  if (!(server instanceof DatabaseError)) return error instanceof DrizzleQueryError ? {} : undefined;
  const fields = {
    ...sqlStateFields(server.code),
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
