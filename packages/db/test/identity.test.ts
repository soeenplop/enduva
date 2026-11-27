import { describe, expect, it } from 'vitest';

import { withUserTx, withWorkerTx, type Database, type VerifiedClaims } from '../src/index.js';

// The checks run before the database is touched, so no database is needed.
const db = {} as Database;
const noop = async () => undefined;

describe('withUserTx', () => {
  it('rejects claims of tokens that do not act for a user', async () => {
    const claims = { sub: '0000000a-0000-4000-8000-00000000000a', role: 'anon' } as unknown as VerifiedClaims;
    await expect(withUserTx(db, claims, noop)).rejects.toThrow(TypeError);
  });

  it.each(['', 'not-a-uuid', "0000000a-0000-4000-8000-00000000000a' or true --"])(
    'rejects the user ID %j',
    async (sub) => {
      await expect(withUserTx(db, { sub, role: 'authenticated' }, noop)).rejects.toThrow('The user ID must be a UUID');
    },
  );
});

describe('withWorkerTx', () => {
  it('rejects a user ID that is not a UUID', async () => {
    await expect(withWorkerTx(db, 'job-user', noop)).rejects.toThrow('The user ID must be a UUID');
  });
});
