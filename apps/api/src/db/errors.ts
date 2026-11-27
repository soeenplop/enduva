import { DrizzleQueryError } from 'drizzle-orm';

/**
 * What may be logged of an error. Drizzle puts the query's parameters into its error message and stack, and
 * Postgres messages and details can quote values; either can hold personal or health data. A query error is
 * therefore logged as its SQL text (placeholders only), SQLSTATE, table, constraint and call stack. Other errors
 * pass through unchanged.
 */
export function loggableError(error: unknown): unknown {
  if (!(error instanceof DrizzleQueryError)) return error;
  const cause = (error.cause ?? {}) as { code?: unknown; table?: unknown; constraint?: unknown };
  return {
    type: 'DrizzleQueryError',
    query: error.query,
    sqlState: cause.code,
    table: cause.table,
    constraint: cause.constraint,
    stack: error.stack
      ?.split('\n')
      .filter((line) => line.startsWith('    at '))
      .join('\n'),
  };
}
