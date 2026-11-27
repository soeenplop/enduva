import 'reflect-metadata';

import { EventEmitter } from 'node:events';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import type { Database, Transaction, VerifiedClaims } from '@enduva/db';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { type IdentifiedRequest, RequestTx, TransactionInterceptor } from '../src/db/request-transaction.js';

const claims: VerifiedClaims = { sub: '0000000a-0000-4000-8000-00000000000a', role: 'authenticated' };

/**
 * A stand-in Database: a pool whose one client records the statements Drizzle sends (BEGIN, the identity, COMMIT or
 * ROLLBACK) and how it was given back to the pool.
 */
function fakeDatabase() {
  const events: string[] = [];
  const label = (text: string) => (text.startsWith('select set_config') ? 'set identity' : text);
  const client = Object.assign(new EventEmitter(), {
    query: (query: { readonly text: string }) => {
      events.push(label(query.text));
      return Promise.resolve({ rows: [], rowCount: 0, command: '', fields: [] });
    },
    release: (destroy?: boolean) => void events.push(destroy === true ? 'destroy' : 'release'),
  });
  const db = { $client: { connect: () => Promise.resolve(client) } } as unknown as Database;
  return { db, events };
}

function httpContext(request: Partial<IdentifiedRequest>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** Calls the factory behind a param decorator, as Nest does when it resolves handler arguments. */
function resolveRequestTx(context: ExecutionContext): Transaction {
  class Probe {
    handler(@RequestTx() _tx: Transaction): void {}
  }
  const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler') as Record<
    string,
    { factory: (data: unknown, ctx: ExecutionContext) => Transaction }
  >;
  const [entry] = Object.values(metadata);
  if (entry === undefined) throw new Error('RequestTx left no metadata');
  return entry.factory(undefined, context);
}

describe('TransactionInterceptor', () => {
  it('runs the handler inside withUserTx when the request has verified claims', async () => {
    const { db, events } = fakeDatabase();
    const request: Partial<IdentifiedRequest> = { claims };
    const context = httpContext(request);
    let seen: Transaction | undefined;
    const next: CallHandler = {
      handle: () => {
        events.push('handler');
        seen = resolveRequestTx(context);
        return of('body');
      },
    };

    await expect(lastValueFrom(new TransactionInterceptor(db).intercept(context, next))).resolves.toBe('body');
    expect(events).toEqual(['begin', 'set identity', 'handler', 'commit', 'release']);
    expect(seen).toBeDefined();
    expect(() => resolveRequestTx(context)).toThrow('No request transaction');
  });

  it('rolls back when the handler fails', async () => {
    const { db, events } = fakeDatabase();
    const next: CallHandler = { handle: () => throwError(() => new Error('handler failed')) };

    await expect(
      lastValueFrom(new TransactionInterceptor(db).intercept(httpContext({ claims }), next)),
    ).rejects.toThrow('handler failed');
    expect(events).toEqual(['begin', 'set identity', 'rollback', 'release']);
  });

  it('opens nothing until the response is subscribed', () => {
    const { db, events } = fakeDatabase();
    void new TransactionInterceptor(db).intercept(httpContext({ claims }), { handle: () => of(null) });
    expect(events).toEqual([]);
  });

  it('opens no transaction without claims, and RequestTx then fails', async () => {
    const { db, events } = fakeDatabase();
    const context = httpContext({});
    await expect(
      lastValueFrom(new TransactionInterceptor(db).intercept(context, { handle: () => of('public') })),
    ).resolves.toBe('public');
    expect(events).toEqual([]);
    expect(() => resolveRequestTx(context)).toThrow('No request transaction: the route has no verified identity');
  });

  it('rejects claims withUserTx would not accept, before touching the database', async () => {
    const { db, events } = fakeDatabase();
    const bad = { sub: 'not-a-uuid', role: 'authenticated' } as const;
    await expect(
      lastValueFrom(new TransactionInterceptor(db).intercept(httpContext({ claims: bad }), { handle: () => of(1) })),
    ).rejects.toThrow('The user ID must be a UUID');
    expect(events).toEqual([]);
  });
});
