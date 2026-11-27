import { createServer, type Server, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Database } from '@enduva/db';
import { afterEach, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/db/database.js';
import { READINESS_TIMEOUT_MS } from '../src/health/health.service.js';
import { createTestApp, http, testEnv } from './support.js';

/** AuthenticationOk followed by ReadyForQuery (idle): enough of the Postgres protocol for node-postgres to connect. */
const HANDSHAKE = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]);

/**
 * A stalled pooler: it accepts connections and then never answers (`stall: 'connect'`), or completes the startup
 * handshake and never answers a query (`stall: 'query'`). It records every connection and whether it is still open.
 */
async function stalledPooler(stall: 'connect' | 'query') {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {});
    // Read (and ignore) everything, so a client hanging up is seen as the end of the stream.
    socket.resume();
    if (stall === 'query') socket.once('data', () => socket.write(HANDSHAKE));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return {
    url: `postgresql://enduva_api_login:unused@127.0.0.1:${address.port}/postgres`,
    connections: () => sockets.length,
    open: () => sockets.filter((socket) => !socket.destroyed && socket.readable).length,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function until(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await delay(20);
  }
}

describe('readiness against a stalled pooler (e2e)', () => {
  const cleanup: (() => Promise<unknown>)[] = [];

  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
  });

  async function boot(stall: 'connect' | 'query') {
    const pooler = await stalledPooler(stall);
    cleanup.push(pooler.close);
    const app: NestExpressApplication = await createTestApp(
      testEnv({ DATABASE_URL: pooler.url, DATABASE_CONNECT_TIMEOUT_MS: '300', DATABASE_POOL_MAX: '2' }),
    );
    cleanup.push(() => app.close());
    return { app, pooler, pool: app.get<Database>(DATABASE).$client };
  }

  it('ends a stalled checkout and leaves nothing in the pool', async () => {
    const { app, pooler, pool } = await boot('connect');
    const res = await http(app).get('/v1/health/ready');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ code: 'database_unavailable' });
    await until(() => pool.totalCount === 0 && pool.waitingCount === 0 && pooler.open() === 0, 1_000);
  });

  it('ends a stalled query, destroys its client and leaves nothing in the pool', async () => {
    const { app, pooler, pool } = await boot('query');
    const started = Date.now();
    const res = await http(app).get('/v1/health/ready');
    expect(res.status).toBe(503);
    expect(Date.now() - started).toBeLessThan(READINESS_TIMEOUT_MS + 1_000);
    await until(() => pool.totalCount === 0 && pooler.open() === 0, READINESS_TIMEOUT_MS + 1_000);
  });

  it('shares one probe between concurrent readiness requests', async () => {
    const { app, pooler, pool } = await boot('query');
    const responses = await Promise.all(Array.from({ length: 5 }, () => http(app).get('/v1/health/ready')));
    expect(responses.map((res) => res.status)).toEqual([503, 503, 503, 503, 503]);
    expect(pooler.connections()).toBe(1);
    await until(() => pool.totalCount === 0 && pooler.open() === 0, READINESS_TIMEOUT_MS + 1_000);
  });
});
