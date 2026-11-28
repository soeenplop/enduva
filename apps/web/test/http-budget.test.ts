// The auth cookies' worst case through the production HTTP entry point (server.mjs on Node, after `pnpm build`):
// the fixed cookie set at its largest must fit Node's request-header limit with room to spare, so a browser in any
// state still reaches the app. A header over the limit is shown to be refused, so the check is real.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Mirrors SESSION_COOKIE_MAX_BYTES in src/auth/session.server.ts (name and value of one session cookie). */
const SLOT_MAX_BYTES = 3_800;
let port = 0;
let child: ChildProcess;

beforeAll(async () => {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  port = (probe.address() as { port: number }).port;
  probe.close();
  child = spawn('node', ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      ENDUVA_API_URL: 'http://127.0.0.1:9',
      ENDUVA_AUTH_URL: 'http://127.0.0.1:9',
      ENDUVA_AUTH_PUBLISHABLE_KEY: 'sb_publishable_test',
      ENDUVA_WEB_ORIGIN: 'https://app.example',
    },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const up = await get('/healthz', '').then(
      (res) => res.status === 200,
      () => false,
    );
    if (up) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('server.mjs did not start');
});

afterAll(() => {
  child?.kill();
});

function get(path: string, cookie: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { cookie } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.end();
  });
}

/** A cookie whose name and value take exactly `bytes`. */
const filled = (name: string, bytes: number) => `${name}=${'x'.repeat(bytes - name.length - 1)}`;

describe('auth cookie budget over HTTP', () => {
  it('serves a browser holding every auth cookie at its largest', async () => {
    const loginId = 'AAAAAAAAAAAAAAAA';
    const cookie = [
      `__Host-enduva-login=a.${loginId}`,
      filled('__Host-enduva-session-a', SLOT_MAX_BYTES),
      filled('__Host-enduva-session-b', SLOT_MAX_BYTES),
      `__Host-enduva-ended=${loginId}.local`,
      // The ten-minute Google sign-in state and the locale, the other cookies the app sets.
      filled('__Host-enduva-oauth', 200),
      'enduva-locale=de',
    ].join('; ');
    expect(Buffer.byteLength(cookie)).toBeLessThan(8 * 1024);
    expect((await get('/', cookie)).status).toBe(200);
  });

  it('is a real limit: Node refuses a header over 16 KiB', async () => {
    expect((await get('/', filled('other', 17 * 1024))).status).toBe(431);
  });
});
