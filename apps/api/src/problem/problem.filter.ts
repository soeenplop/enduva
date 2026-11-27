import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import {
  codeForStatus,
  isProblemCode,
  problem,
  PROBLEM_CONTENT_TYPE,
  type Problem,
  ProblemException,
  problemStatus,
} from './problem.js';

/** Errors from Express middleware such as the body parser (`http-errors`): a 4xx status that is safe to expose. */
function exposedClientStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return expose === true && isClientStatus(status) ? status : undefined;
}

/** An integer 4xx status: anything else (fractions, `NaN`, out of range) would make Express throw or lie. */
function isClientStatus(status: unknown): status is number {
  return Number.isInteger(status) && (status as number) >= 400 && (status as number) < 500;
}

/**
 * Answers every error with RFC 9457 problem details (`application/problem+json`) and a stable `code`. Messages of
 * Nest and Express exceptions are not passed on: they can echo request input. Unexpected errors become a bare 500
 * and are logged with the request ID and their class only (the `err` serializer, `safeError`), never sent to the
 * client.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const body = this.toProblem(exception);
    if (body.code === 'internal_error') this.logger.error({ err: exception, code: body.code }, 'unexpected error');
    if (response.headersSent) {
      response.end();
      return;
    }
    // RFC 6750: a 401 names the scheme the client must authenticate with, and no more.
    if (body.status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(body.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
  }

  /**
   * Never throws, and always returns a plain body built here from validated values: a thrown value whose prototype
   * lookup or fields throw (a proxy, a getter), or whose status or code is malformed, is an internal error.
   */
  private toProblem(exception: unknown): Problem {
    try {
      if (exception instanceof ProblemException) {
        const { code, detail } = exception;
        if (!isProblemCode(code) || (detail !== undefined && typeof detail !== 'string'))
          return problem('internal_error');
        return problem(code, problemStatus[code], detail);
      }
      const status: unknown =
        exception instanceof HttpException ? exception.getStatus() : exposedClientStatus(exception);
      return isClientStatus(status) ? problem(codeForStatus(status), status) : problem('internal_error');
    } catch {
      return problem('internal_error');
    }
  }
}
