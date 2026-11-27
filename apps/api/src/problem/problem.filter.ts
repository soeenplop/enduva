import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

import { codeForStatus, problem, PROBLEM_CONTENT_TYPE, type Problem, ProblemException } from './problem.js';

/** Errors from Express middleware such as the body parser (`http-errors`): a 4xx status that is safe to expose. */
function exposedClientStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, expose } = error as { status?: unknown; expose?: unknown };
  return expose === true && typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
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
    response.status(body.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(body));
  }

  private toProblem(exception: unknown): Problem {
    if (exception instanceof ProblemException) return exception.toProblem();
    const status = exception instanceof HttpException ? exception.getStatus() : exposedClientStatus(exception);
    if (status === undefined || status >= 500) return problem('internal_error');
    return problem(codeForStatus(status), status);
  }
}
