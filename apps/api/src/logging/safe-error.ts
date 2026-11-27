import { DatabaseError } from '@enduva/db';
import { HttpException, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DrizzleQueryError } from 'drizzle-orm';

import { databaseErrorFields, type DatabaseErrorFields } from '../db/errors.js';
import { ProblemException } from '../problem/problem.js';

/** What may be logged of an error: fields picked one by one, never its message, cause, stack or other properties. */
export interface SafeError extends DatabaseErrorFields {
  /** The error's category from `errorTypes`, e.g. `TypeError`; `UNKNOWN_ERROR_TYPE` for anything else. */
  readonly type: string;
}

/** The category of a thrown value that is no `Error`, or that cannot be inspected without throwing. */
export const UNKNOWN_ERROR_TYPE = 'Unknown';

type ErrorClass = abstract new (...args: never) => Error;

/**
 * The categories that may be logged, checked in order against the prototype chain, so subclasses come before their base
 * classes. The name is a literal here: a thrown value can bring its own `constructor` and `name`, so neither is ever
 * read from it. `Error` is last and catches every other error.
 */
const errorTypes: readonly (readonly [ErrorClass, string])[] = [
  [DrizzleQueryError, 'DrizzleQueryError'],
  [DatabaseError, 'DatabaseError'],
  [ProblemException, 'ProblemException'],
  [ThrottlerException, 'ThrottlerException'],
  [NotFoundException, 'NotFoundException'],
  [HttpException, 'HttpException'],
  [AggregateError, 'AggregateError'],
  [EvalError, 'EvalError'],
  [RangeError, 'RangeError'],
  [ReferenceError, 'ReferenceError'],
  [SyntaxError, 'SyntaxError'],
  [TypeError, 'TypeError'],
  [URIError, 'URIError'],
  [Error, 'Error'],
];

function errorType(error: unknown): string {
  if (typeof error !== 'object' || error === null) return UNKNOWN_ERROR_TYPE;
  try {
    // A plain prototype-chain check, not `instanceof`: a class can override `Symbol.hasInstance` (Zod 4 does, and reads
    // `_zod` on the value), which would let a plain object pick its own category or throw midway through the scan.
    // Zod errors have no usable prototype chain, so they are logged as `Error`.
    return (
      errorTypes.find(([type]) => Object.prototype.isPrototypeOf.call(type.prototype, error))?.[1] ?? UNKNOWN_ERROR_TYPE
    );
  } catch {
    // A proxy's `getPrototypeOf` trap can throw.
    return UNKNOWN_ERROR_TYPE;
  }
}

/**
 * The loggable fields of any thrown value. Messages, causes, stacks and enumerable properties of unknown errors can
 * carry request input (credentials, health data), so none of them are logged; the request ID on the log line links
 * the error to its request. Database errors add their SQLSTATE, table and constraint (`databaseErrorFields`). Never
 * throws, whatever is thrown: it runs while an error is being logged.
 */
export function safeError(error: unknown): SafeError {
  return { type: errorType(error), ...databaseErrorFields(error) };
}
