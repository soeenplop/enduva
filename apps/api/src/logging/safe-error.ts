import { databaseErrorFields, type DatabaseErrorFields } from '../db/errors.js';

/** What may be logged of an error: fields picked one by one, never its message, cause, stack or other properties. */
export interface SafeError extends DatabaseErrorFields {
  /** The error's class, e.g. `TypeError`; `NonError` for a thrown non-object. */
  readonly type: string;
}

/** Class names come from code, but a crafted error can set any `name`; anything that isn't an identifier is dropped. */
const identifier = /^[A-Za-z_$][\w$]{0,63}$/;

/**
 * The loggable fields of any thrown value. Messages, causes, stacks and enumerable properties of unknown errors can
 * carry request input (credentials, health data), so none of them are logged; the request ID on the log line links
 * the error to its request. Database errors add their SQLSTATE, table and constraint (`databaseErrorFields`).
 */
export function safeError(error: unknown): SafeError {
  if (typeof error !== 'object' || error === null) return { type: 'NonError' };
  const name: unknown = (error as { constructor?: { name?: unknown } }).constructor?.name;
  return { type: typeof name === 'string' && identifier.test(name) ? name : 'Error', ...databaseErrorFields(error) };
}
