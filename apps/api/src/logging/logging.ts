import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';
import type { DestinationStream, LevelWithSilent } from 'pino';
import { type HttpLogger, type Options, pinoHttp } from 'pino-http';

import type { Env } from '../config/env.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Incoming IDs are reused only if they are short and plain, so a client can't inject anything into the logs. */
const safeRequestId = /^[\w.:-]{1,128}$/;

/** Reuses a safe `x-request-id` from the client (or the proxy), otherwise makes one, and echoes it on the response. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && safeRequestId.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

interface LoggedRequest {
  readonly id?: unknown;
  readonly method?: string;
  readonly url?: string;
}

/**
 * Only the request ID, method and path are logged: no headers (tokens, cookies), no query string, no body and no
 * client IP (06-deployment → Logs). Health data must never reach the logs.
 */
export const serializers = {
  req: ({ id, method, url }: LoggedRequest) => ({ id, method, path: url?.split('?', 1)[0] }),
  res: ({ statusCode }: { readonly statusCode?: number }) => ({ statusCode }),
};

const level = (_req: IncomingMessage, res: ServerResponse, error?: Error): LevelWithSilent =>
  error !== undefined || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

/**
 * The request logger. `configureApp` mounts it as the first middleware, ahead of Nest's body parser, so every
 * response (a malformed body included) carries `x-request-id` and is logged. `destination` is for tests; production
 * logs JSON to stdout.
 */
export function createHttpLogger(env: Env, destination?: DestinationStream): HttpLogger {
  const options: Options = { level: env.LOG_LEVEL, genReqId: requestId, serializers, customLogLevel: level };
  return pinoHttp(options, destination);
}

/** nestjs-pino reuses the request logger above (`useExisting`), so Nest's own logs share its output. */
export function loggerParams(http: HttpLogger): Params {
  return { pinoHttp: { logger: http.logger }, useExisting: true };
}
