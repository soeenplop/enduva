import * as z from 'zod';

/**
 * Stable error codes and their HTTP status. Clients translate the code, so a code is never renamed or reused
 * (02-architecture → API design). Add new codes here.
 */
export const problemStatus = {
  bad_request: 400,
  unauthorized: 401,
  /** The token's device was revoked: the client wipes its local account data (02-architecture → Watch). */
  device_revoked: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  /** `If-Match` names an outdated version: reload, then retry. */
  precondition_failed: 412,
  payload_too_large: 413,
  unsupported_media_type: 415,
  /** The write needs `If-Match` with the resource's ETag. */
  precondition_required: 428,
  rate_limited: 429,
  internal_error: 500,
  database_unavailable: 503,
  /** The signing keys (JWKS) can't be fetched, so no token can be verified. */
  auth_unavailable: 503,
} as const satisfies Record<string, number>;

export type ProblemCode = keyof typeof problemStatus;

export const problemCodes = Object.keys(problemStatus) as ProblemCode[];

export const isProblemCode = (code: unknown): code is ProblemCode =>
  typeof code === 'string' && Object.hasOwn(problemStatus, code);

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

/**
 * RFC 9457 problem details, as every error is answered. `code` is a plain string on the wire, not an enum: a client
 * built before a code was added must still decode the body (and fall back to a generic message).
 */
export const Problem = z
  .object({
    type: z.string().meta({ description: '`about:blank`: `title` is the status phrase and `code` tells errors apart' }),
    title: z.string(),
    status: z.int().min(400).max(599),
    code: z.string().meta({ description: `Stable error code: ${problemCodes.join(', ')}` }),
    detail: z.string().optional(),
  })
  .meta({ id: 'Problem' });

export type Problem = z.output<typeof Problem>;
