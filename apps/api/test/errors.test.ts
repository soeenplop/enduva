import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { loggableError } from '../src/db/errors.js';

describe('loggableError', () => {
  it('drops the parameters and the Postgres message of a query error', () => {
    const cause = Object.assign(new Error('invalid input syntax for type uuid: "secret-72"'), {
      code: '22P02',
      detail: 'Key (x)=(secret-72)',
    });
    const logged = loggableError(new DrizzleQueryError('select $1::uuid', ['secret-72'], cause));
    expect(logged).toMatchObject({ type: 'DrizzleQueryError', query: 'select $1::uuid', sqlState: '22P02' });
    expect(JSON.stringify(logged)).not.toContain('secret-72');
  });

  it('passes other errors through', () => {
    const error = new Error('boom');
    expect(loggableError(error)).toBe(error);
  });
});
