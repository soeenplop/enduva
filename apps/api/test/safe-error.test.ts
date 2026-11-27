import { describe, expect, it } from 'vitest';

import { safeError } from '../src/logging/safe-error.js';

describe('safeError', () => {
  it('keeps only the class of an error', () => {
    const cause = Object.assign(new Error('cause-secret'), { password: 'cause-prop-secret' });
    const error = Object.assign(new TypeError('message-secret', { cause }), { token: 'prop-secret' });
    expect(safeError(error)).toEqual({ type: 'TypeError' });
  });

  it('names thrown non-objects without their value', () => {
    expect(safeError('string-secret')).toEqual({ type: 'NonError' });
    expect(safeError(undefined)).toEqual({ type: 'NonError' });
  });

  it('drops a class name that is not a plain identifier', () => {
    class Crafted extends Error {}
    Object.defineProperty(Crafted, 'name', { value: 'user@example.com' });
    expect(safeError(new Crafted('x'))).toEqual({ type: 'Error' });
    expect(safeError(Object.create(null))).toEqual({ type: 'Error' });
  });
});
