import 'reflect-metadata';

import { EventEmitter } from 'node:events';

import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import type { Database, Transaction, VerifiedClaims } from '@enduva/db';
import { lastValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it } from 'vitest';

import { type IdentifiedRequest, RequestTx, TransactionInterceptor } from '../src/db/request-transaction.js';

const claims: VerifiedClaims = {
  sub: '0000000a-0000-4000-8000-00000000000a',
  role: 'authenticated',
  session_id: '5e551011-0000-4000-8000-000000000001',
};

const activeAccount = { active: true, device_revoked: false, has_profile: true };

/**
 * A stand-in Database: a pool whose one client records the statements Drizzle sends (BEGIN, the identity, the account
 * check, COMMIT or ROLLBACK) and how it was given back to the pool. The account check answers with `status`.
 */
function fakeDatabase(status: Readonly<Record<string, boolean>> = activeAccount) {
  const events: string[] = [];
  const label = (text: string) => {
    if (text.startsWith('select set_config')) return 'set identity';
    if (text.startsWith('select app.auth_session_active()')) return 'check account';
    return /^insert into app\.(\w+)/.exec(text)?.[0] ?? text;
  };
  const client = Object.assign(new EventEmitter(), {
    query: (query: { readonly text: string }) => {
      const event = label(query.text);
      events.push(event);
      const rows = event === 'check account' ? [status] : [];
      return Promise.resolve({ rows, rowCount: rows.length, command: '', fields: [] });
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
    expect(events).toEqual(['begin', 'set identity', 'check account', 'handler', 'commit', 'release']);
    expect(seen).toBeDefined();
    expect(() => resolveRequestTx(context)).toThrow('No request transaction');
  });

  it('rolls back when the handler fails', async () => {
    const { db, events } = fakeDatabase();
    const next: CallHandler = { handle: () => throwError(() => new Error('handler failed')) };

    await expect(
      lastValueFrom(new TransactionInterceptor(db).intercept(httpContext({ claims }), next)),
    ).rejects.toThrow('handler failed');
    expect(events).toEqual(['begin', 'set identity', 'check account', 'rollback', 'release']);
  });

  it.each([
    ['an inactive session or account', { ...activeAccount, active: false }, 'unauthorized'],
    ['a revoked device', { ...activeAccount, device_revoked: true }, 'device_revoked'],
    [
      'a revoked device of an inactive session',
      { active: false, device_revoked: true, has_profile: true },
      'device_revoked',
    ],
  ])('refuses %s before the handler runs, and rolls back', async (_case, status, code) => {
    const { db, events } = fakeDatabase(status);
    const next: CallHandler = { handle: () => (events.push('handler'), of('body')) };

    await expect(
      lastValueFrom(new TransactionInterceptor(db).intercept(httpContext({ claims }), next)),
    ).rejects.toMatchObject({ code });
    expect(events).toEqual(['begin', 'set identity', 'check account', 'rollback', 'release']);
  });

  it("creates the profile and settings on the user's first request", async () => {
    const { db, events } = fakeDatabase({ ...activeAccount, has_profile: false });
    const next: CallHandler = { handle: () => (events.push('handler'), of('body')) };

    await expect(lastValueFrom(new TransactionInterceptor(db).intercept(httpContext({ claims }), next))).resolves.toBe(
      'body',
    );
    expect(events).toEqual([
      'begin',
      'set identity',
      'check account',
      'insert into app.profiles',
      'insert into app.user_settings',
      'handler',
      'commit',
      'release',
    ]);
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
