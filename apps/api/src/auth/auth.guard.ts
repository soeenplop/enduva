import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { IdentifiedRequest } from '../db/request-transaction.js';
import { ProblemException } from '../problem/problem.js';
import { AuthUnavailableError, InvalidTokenError, TokenVerifier } from './token-verifier.js';

const PUBLIC = 'enduva.public';

/** Marks a controller or handler as reachable without an access token (health). Everything else requires one. */
export const Public = () => SetMetadata(PUBLIC, true);

/** `Bearer <token>`, scheme case-insensitive (RFC 9110), exactly one space-free token. */
const bearerPattern = /^Bearer ([^\s]+)$/i;

/**
 * Global guard: every route needs a valid Supabase access token unless it is `@Public()`. A verified token's claims
 * go on the request, and the transaction interceptor then runs the handler in `withUserTx` after checking the
 * session and account. Every rejection is the same bare `401 unauthorized`: the reason is neither sent nor logged,
 * and neither is the token.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(TokenVerifier) private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()]) === true)
      return true;
    const request = context.switchToHttp().getRequest<IdentifiedRequest>();
    // `headers` keeps only the first of repeated Authorization fields; ambiguous credentials are rejected instead.
    const fields = request.headersDistinct.authorization ?? [];
    const token = fields.length === 1 ? bearerPattern.exec(fields[0] ?? '')?.[1] : undefined;
    try {
      if (token === undefined) throw new InvalidTokenError();
      request.claims = await this.verifier.verify(token);
      return true;
    } catch (error) {
      if (error instanceof AuthUnavailableError) {
        this.logger.error('access token signing keys unavailable');
        throw new ProblemException('auth_unavailable');
      }
      throw new ProblemException('unauthorized');
    }
  }
}
