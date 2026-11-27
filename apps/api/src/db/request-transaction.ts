import {
  type CallHandler,
  createParamDecorator,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { type Database, type Transaction, type VerifiedClaims, withUserTx } from '@enduva/db';
import type { Request } from 'express';
import { defer, lastValueFrom, type Observable } from 'rxjs';

import { assertActiveAccount } from '../auth/account-status.js';
import { DATABASE } from './database.js';

const TRANSACTION = Symbol('enduva.request-transaction');

/**
 * The request as the database layer sees it. The auth guard sets `claims` once it has verified the access token
 * against the JWKS; nothing else may set them.
 */
export interface IdentifiedRequest extends Request {
  claims?: VerifiedClaims;
  [TRANSACTION]?: Transaction;
}

/**
 * Transaction per request (ADR-0002): a request with verified claims runs its handler inside one `withUserTx`
 * transaction as `enduva_api`, with the claims set transaction-locally, so it is safe for the transaction pooler.
 * The session and account check runs first in that transaction and fails the request (401) before the handler runs.
 * The transaction commits before the response is sent and rolls back if the handler throws. Requests without
 * claims (health, public routes) get no transaction.
 */
@Injectable()
export class TransactionInterceptor implements NestInterceptor {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<IdentifiedRequest>();
    const { claims } = request;
    if (claims === undefined) return next.handle();
    return defer(() =>
      withUserTx(this.db, claims, async (tx) => {
        await assertActiveAccount(tx, claims);
        request[TRANSACTION] = tx;
        try {
          return await lastValueFrom(next.handle(), { defaultValue: undefined });
        } finally {
          delete request[TRANSACTION];
        }
      }),
    );
  }
}

/**
 * Handler parameter: the request's transaction. Pass it on to services; never open another connection in a
 * request. Throws (500) on a route without verified claims, which is a bug in that route.
 */
export const RequestTx = createParamDecorator((_data: unknown, context: ExecutionContext): Transaction => {
  const tx = context.switchToHttp().getRequest<IdentifiedRequest>()[TRANSACTION];
  if (tx === undefined) throw new Error('No request transaction: the route has no verified identity');
  return tx;
});
