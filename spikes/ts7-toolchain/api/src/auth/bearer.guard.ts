import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TokenVerifier } from './token-verifier.service.js';

@Injectable()
export class BearerGuard implements CanActivate {
  // Constructor injection: resolved through the design:paramtypes metadata that SWC emits.
  constructor(private readonly verifier: TokenVerifier) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token || !this.verifier.verify(token)) {
      throw new UnauthorizedException({ code: 'invalid_token' });
    }
    return true;
  }
}
