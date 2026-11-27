import { DrizzleQueryError } from 'drizzle-orm';

/** What may be logged of a database error. Only fields picked here, each checked against a strict pattern. */
export interface DatabaseErrorFields {
  /** SQLSTATE, e.g. `23505`. */
  readonly sqlState?: string;
  readonly table?: string;
  readonly constraint?: string;
}

const sqlState = /^[0-9A-Z]{5}$/;
/** Table and constraint names come from our schema: lowercase SQL identifiers. Anything else is dropped. */
const identifier = /^[a-z_][a-z0-9_]{0,62}$/;

/** pg's server error (pg-protocol's `DatabaseError`), recognised by its class: pg-protocol is no direct dependency. */
function isServerError(error: unknown): error is Record<string, unknown> {
  return error instanceof Error && error.constructor.name === 'DatabaseError';
}

const pick = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;

/**
 * The loggable fields of a database error: SQLSTATE, table and constraint. Drizzle interpolates the parameters into
 * its message (and so its stack), and Postgres' message, detail, hint and where can quote values; any of them can
 * hold personal or health data, so none of them is logged, nor is the query text. `undefined` for other errors.
 */
export function databaseErrorFields(error: unknown): DatabaseErrorFields | undefined {
  const server = error instanceof DrizzleQueryError ? error.cause : error;
  if (!isServerError(server)) return error instanceof DrizzleQueryError ? {} : undefined;
  const fields = {
    sqlState: pick(server.code, sqlState),
    table: pick(server.table, identifier),
    constraint: pick(server.constraint, identifier),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
