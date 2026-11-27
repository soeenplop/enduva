import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { databaseErrorFields } from '../src/db/errors.js';
import { safeError } from '../src/logging/safe-error.js';

/** Stand-in for pg-protocol's DatabaseError: a server error response with every field Postgres can send. */
class DatabaseError extends Error {
  constructor(fields: Record<string, string>) {
    super('invalid input syntax for type uuid: "secret-72"');
    Object.assign(this, fields);
  }
}

const serverError = (fields: Record<string, string> = {}) =>
  new DatabaseError({
    code: '23505',
    table: 'profiles',
    constraint: 'profiles_pkey',
    detail: 'Key (user_id)=(secret-72) already exists.',
    hint: 'secret-hint',
    where: 'secret-where',
    schema: 'app',
    column: 'user_id',
    ...fields,
  });

describe('databaseErrorFields', () => {
  it('keeps only SQLSTATE, table and constraint of a server error', () => {
    expect(databaseErrorFields(serverError())).toEqual({
      sqlState: '23505',
      table: 'profiles',
      constraint: 'profiles_pkey',
    });
  });

  it('drops fields that are not plain identifiers', () => {
    expect(databaseErrorFields(serverError({ code: 'secret', table: 'Secret Table', constraint: 'x"; --' }))).toEqual(
      {},
    );
  });

  it('logs a query error by its cause, without the query, parameters or a stack', () => {
    // A multiline parameter can produce lines that look like stack frames in Drizzle's message and stack.
    const params = ['secret-72\n    at fake (/secret/frame.js:1:1)'];
    const error = new DrizzleQueryError('select $1::uuid', params, serverError({ code: '22P02' }));
    expect(safeError(error)).toEqual({
      type: 'DrizzleQueryError',
      sqlState: '22P02',
      table: 'profiles',
      constraint: 'profiles_pkey',
    });
    expect(JSON.stringify(safeError(error))).not.toMatch(/secret|select|stack/);
  });

  it('logs a query error whose cause is a connection error by its class only', () => {
    const error = new DrizzleQueryError('select 1', [], new Error('connect ECONNREFUSED secret-host'));
    expect(safeError(error)).toEqual({ type: 'DrizzleQueryError' });
  });

  it('adds nothing to other errors', () => {
    expect(databaseErrorFields(new Error('timeout exceeded when trying to connect'))).toBeUndefined();
    expect(safeError(Object.assign(new Error('x'), { code: '23505', table: 'profiles' }))).toEqual({ type: 'Error' });
  });
});
