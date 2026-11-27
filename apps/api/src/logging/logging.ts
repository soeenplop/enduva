import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';
import type { DestinationStream, LevelWithSilent } from 'pino';
import { type HttpLogger, type Options, pinoHttp } from 'pino-http';

import type { Env } from '../config/env.js';
import { safeError } from './safe-error.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Label of requests that matched no route (404s), whose raw path is never logged. */
export const UNMATCHED_ROUTE = '(unmatched)';

/**
 * Every request gets a server-generated ID, echoed in `x-request-id`. An incoming `x-request-id` is ignored: it is
 * client-controlled and could carry an identifier or token into the logs.
 */
export function requestId(_req: IncomingMessage, res: ServerResponse): string {
  const id = randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

interface RoutedRequest extends IncomingMessage {
  /** Set by Express once a route matched; `path` is its template, e.g. `/v1/items/:id`. */
  readonly route?: { readonly path?: unknown };
}

/** The matched route template, never the raw path: path segments can hold tokens or personal identifiers. */
export function routeTemplate(req: IncomingMessage): string {
  const path = (req as RoutedRequest).route?.path;
  return typeof path === 'string' ? path : UNMATCHED_ROUTE;
}

/**
 * Only the request ID, method, route template and status are logged: no raw path or query string, no headers
 * (tokens, cookies), no body and no client IP (06-deployment → Logs). Health data must never reach the logs. The
 * serializers get the raw objects (`wrapSerializers: false`), so nothing else is picked up by accident. `err` is
 * serialized the same way for every log line, including Nest's own (nestjs-pino shares this logger).
 */
export const serializers = {
  req: ({ id, method }: RoutedRequest) => ({ id, method }),
  res: ({ statusCode }: ServerResponse) => ({ statusCode }),
  err: safeError,
};

const level = (_req: IncomingMessage, res: ServerResponse, error?: Error): LevelWithSilent =>
  error !== undefined || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

/** The completion line: the route is only known once routing ran, so it is added here, not to the `req` binding. */
const successObject = (req: IncomingMessage, _res: ServerResponse, value: object) => ({
  ...value,
  route: routeTemplate(req),
});
const errorObject = (req: IncomingMessage, _res: ServerResponse, _error: Error, value: object) => ({
  ...value,
  route: routeTemplate(req),
});

/**
 * The request logger. `configureApp` mounts it as the first middleware, ahead of Nest's body parser, so every
 * response (a malformed body included) carries `x-request-id` and is logged. `destination` is for tests; production
 * logs JSON to stdout.
 */
export function createHttpLogger(env: Env, destination?: DestinationStream): HttpLogger {
  const options: Options = {
    level: env.LOG_LEVEL,
    genReqId: requestId,
    serializers,
    wrapSerializers: false,
    customLogLevel: level,
    customSuccessObject: successObject,
    customErrorObject: errorObject,
  };
  return pinoHttp(options, destination);
}

/**
 * nestjs-pino reuses the request logger above (`useExisting`), so Nest's own logs share its output. For logs outside
 * a request it wraps that logger in another pino-http instance, whose child logger would otherwise get pino-http's
 * default serializers (full `err` with message and stack), so the same serializers are passed again.
 */
export function loggerParams(http: HttpLogger): Params {
  return { pinoHttp: { logger: http.logger, serializers, wrapSerializers: false }, useExisting: true };
}
