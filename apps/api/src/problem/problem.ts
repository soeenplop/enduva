import { STATUS_CODES } from 'node:http';

import { type Problem as ProblemBody, type ProblemCode, problemStatus } from '@enduva/contracts';

// The codes and the wire schema live in the contracts (OpenAPI); this module builds the bodies.
export { isProblemCode, PROBLEM_CONTENT_TYPE, type ProblemCode, problemStatus } from '@enduva/contracts';

/**
 * RFC 9457 problem details, as the contract's `Problem` schema describes them. `type` stays `about:blank`, so `title`
 * is the status phrase; `code` tells errors apart.
 */
export interface Problem extends Readonly<ProblemBody> {
  readonly type: 'about:blank';
  readonly code: ProblemCode;
}

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

/** The first, generic code of each status: `unauthorized` for 401, not `device_revoked`. */
const codeByStatus = new Map<number, ProblemCode>();
for (const [code, status] of Object.entries(problemStatus))
  if (!codeByStatus.has(status)) codeByStatus.set(status, code as ProblemCode);

/** The stable code for a status from Nest or Express: its generic code if it has one, otherwise `bad_request`/`internal_error`. */
export function codeForStatus(status: number): ProblemCode {
  return codeByStatus.get(status) ?? (status >= 400 && status < 500 ? 'bad_request' : 'internal_error');
}
