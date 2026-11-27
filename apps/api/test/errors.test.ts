import { DatabaseError } from '@enduva/db';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { databaseErrorFields } from '../src/db/errors.js';
import { safeError } from '../src/logging/safe-error.js';

/** pg's server error as node-postgres builds it, with every field Postgres can send. */
const serverError = (fields: Record<string, string> = {}) =>
  Object.assign(new DatabaseError('invalid input syntax for type uuid: "secret-72"', 0, 'error'), {
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

  it('recognises a server error by its class, not by a name', () => {
    const fields = { code: '23505', table: 'profiles', constraint: 'profiles_pkey' };
    class FakeDatabaseError extends Error {}
    Object.defineProperty(FakeDatabaseError, 'name', { value: 'DatabaseError' });
    const named = Object.assign(new Error('x'), { name: 'DatabaseError', ...fields });
    const ownConstructor = Object.assign(new Error('x'), { constructor: DatabaseError, ...fields });
    for (const error of [Object.assign(new FakeDatabaseError('x'), fields), named, ownConstructor]) {
      expect(databaseErrorFields(error)).toBeUndefined();
      expect(safeError(error)).toEqual({ type: 'Error' });
    }
  });

  it('never throws, whatever is thrown', () => {
    const thrower = () => {
      throw new Error('getter-secret');
    };
    const shadowed = Object.assign(new Error('x'), { constructor: undefined });
    const getterConstructor = Object.defineProperty(new Error('x'), 'constructor', { get: thrower });
    const getterCode = Object.defineProperty(serverError(), 'code', { get: thrower });
    const getterCause = Object.defineProperty(new DrizzleQueryError('select 1', [], serverError()), 'cause', {
      get: thrower,
    });
    const proxy = new Proxy(serverError(), { getPrototypeOf: thrower, get: thrower });
    for (const value of [shadowed, getterConstructor, Object.create(null), 'string-secret', undefined, proxy]) {
      expect(databaseErrorFields(value)).toBeUndefined();
    }
    expect(databaseErrorFields(getterCode)).toBeUndefined();
    expect(safeError(getterCode)).toEqual({ type: 'DatabaseError' });
    expect(databaseErrorFields(getterCause)).toBeUndefined();
    expect(safeError(getterCause)).toEqual({ type: 'DrizzleQueryError' });
  });
});
