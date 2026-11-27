import { STATUS_CODES } from 'node:http';

/**
 * Stable error codes and their HTTP status. Clients translate the code, so a code is never renamed or reused
 * (02-architecture → API design). Add new codes here.
 */
export const problemStatus = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal_error: 500,
  database_unavailable: 503,
  /** The signing keys (JWKS) can't be fetched, so no token can be verified. */
  auth_unavailable: 503,
} as const satisfies Record<string, number>;

export type ProblemCode = keyof typeof problemStatus;

/** RFC 9457 problem details. `type` stays `about:blank`, so `title` is the status phrase; `code` tells errors apart. */
export interface Problem {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail?: string;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function problem(code: ProblemCode, status: number = problemStatus[code], detail?: string): Problem {
  const title = STATUS_CODES[status] ?? 'Error';
  return detail === undefined
    ? { type: 'about:blank', title, status, code }
    : { type: 'about:blank', title, status, code, detail };
}

/** Throw this for an expected error. `detail` is sent to the client, so it must not contain personal data. */
export class ProblemException extends Error {
  override readonly name = 'ProblemException';

  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
  ) {
    super(detail ?? code);
  }

  toProblem(): Problem {
    return problem(this.code, problemStatus[this.code], this.detail);
  }
}

/** The first, generic code of each status: `database_unavailable` for 503, not `auth_unavailable`. */
const codeByStatus = new Map<number, ProblemCode>();
for (const [code, status] of Object.entries(problemStatus))
  if (!codeByStatus.has(status)) codeByStatus.set(status, code as ProblemCode);

/** The stable code for a status from Nest or Express: its generic code if it has one, otherwise `bad_request`/`internal_error`. */
export function codeForStatus(status: number): ProblemCode {
  return codeByStatus.get(status) ?? (status >= 400 && status < 500 ? 'bad_request' : 'internal_error');
}
