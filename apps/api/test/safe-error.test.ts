import { DatabaseError } from '@enduva/db';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DrizzleQueryError } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as z from 'zod';

import { safeError, UNKNOWN_ERROR_TYPE } from '../src/logging/safe-error.js';
import { ProblemException } from '../src/problem/problem.js';

const thrower = () => {
  throw new Error('getter-secret');
};

describe('safeError', () => {
  it('keeps only the class of an error', () => {
    const cause = Object.assign(new Error('cause-secret'), { password: 'cause-prop-secret' });
    const error = Object.assign(new TypeError('message-secret', { cause }), { token: 'prop-secret' });
    expect(safeError(error)).toEqual({ type: 'TypeError' });
  });

  it.each([
    [new DrizzleQueryError('select 1', [], new Error('x')), 'DrizzleQueryError'],
    [new DatabaseError('x', 0, 'error'), 'DatabaseError'],
    [z.string().safeParse(1).error, 'Error'],
    [new ProblemException('database_unavailable'), 'ProblemException'],
    [new ThrottlerException(), 'ThrottlerException'],
    [new NotFoundException(), 'NotFoundException'],
    [new BadRequestException(), 'HttpException'],
    [new RangeError('x'), 'RangeError'],
    [new AggregateError([]), 'AggregateError'],
  ])('derives the category of a known error from its class (%#)', (error, type) => {
    expect(safeError(error)).toEqual({ type });
  });

  it('never reads the category from the thrown value', () => {
    class Crafted extends Error {}
    Object.defineProperty(Crafted, 'name', { value: 'LeakedClassName' });
    const ownConstructor = Object.assign(new Error('x'), { constructor: { name: 'LeakedName' } });
    const ownName = Object.assign(new Error('x'), { name: 'LeakedName' });
    for (const error of [new Crafted('x'), ownConstructor, ownName]) {
      expect(safeError(error)).toEqual({ type: 'Error' });
    }
    expect(safeError({ constructor: { name: 'LeakedName' }, name: 'LeakedName' })).toEqual({
      type: UNKNOWN_ERROR_TYPE,
    });
  });

  it("ignores custom instanceof hooks such as Zod 4's", () => {
    const lookalike = { _zod: { traits: new Set(['ZodError', '$ZodError']) }, issues: [] };
    expect(safeError(lookalike)).toEqual({ type: UNKNOWN_ERROR_TYPE });
    const throwingTraits = Object.defineProperty(new RangeError('x'), '_zod', { get: thrower });
    expect(safeError(throwingTraits)).toEqual({ type: 'RangeError' });
  });

  it.each([['string-secret'], [42], [10n], [Symbol('symbol-secret')], [undefined], [null], [() => 'fn-secret']])(
    'gives a thrown primitive or function the generic category (%#)',
    (value) => {
      expect(safeError(value)).toEqual({ type: UNKNOWN_ERROR_TYPE });
    },
  );

  it('gives hostile objects a category without throwing', () => {
    const getterConstructor = Object.defineProperty({}, 'constructor', { get: thrower });
    const errorWithGetterConstructor = Object.defineProperty(new Error('x'), 'constructor', { get: thrower });
    const errorWithoutConstructor = Object.assign(new Error('x'), { constructor: undefined });
    const proxy = new Proxy(new Error('x'), { getPrototypeOf: thrower, get: thrower, ownKeys: thrower });
    expect(safeError(getterConstructor)).toEqual({ type: UNKNOWN_ERROR_TYPE });
    expect(safeError(Object.create(null))).toEqual({ type: UNKNOWN_ERROR_TYPE });
    expect(safeError(errorWithGetterConstructor)).toEqual({ type: 'Error' });
    expect(safeError(errorWithoutConstructor)).toEqual({ type: 'Error' });
    expect(safeError(proxy)).toEqual({ type: UNKNOWN_ERROR_TYPE });
  });
});
