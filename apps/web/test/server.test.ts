// The production server (server.mjs, the `web` image) behind TLS termination (#136): with ENDUVA_WEB_ORIGIN set, a
// server-function call from the public https origin passes TanStack's `Origin` check although the socket is plain
// HTTP, and forwarded headers can't move the origin. Runs the built server (`pnpm build` first, as for ssr.test.ts).
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PUBLIC_ORIGIN = 'https://app.example';
let child: ChildProcess;
let backend: string;

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const address = probe.address();
  probe.close();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

beforeAll(async () => {
  const port = await freePort();
  backend = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env['PATH'] ?? '', HOST: '127.0.0.1', PORT: String(port), ENDUVA_WEB_ORIGIN: PUBLIC_ORIGIN },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await fetch(`${backend}/healthz`).then(
      (res) => res.status,
      () => 0,
    );
    if (status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('server.mjs did not start within 15 s');
});

afterAll(() => {
  child.kill();
});

const call = (headers: Record<string, string>) => fetch(`${backend}/_serverFn/any`, { method: 'POST', headers });

describe('server.mjs behind TLS termination', () => {
  it('accepts a server-function call from the public https origin', async () => {
    // Same answer as a call TanStack treats as same-origin (Fetch Metadata): the CSRF check passed.
    const sameOrigin = (await call({ 'sec-fetch-site': 'same-origin' })).status;
    expect(sameOrigin).not.toBe(403);
    expect((await call({ origin: PUBLIC_ORIGIN })).status).toBe(sameOrigin);
  });

  it('keeps the configured origin for a path that starts with two slashes', async () => {
    const res = await fetch(`${backend}//evil.example/_serverFn/any`, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      redirect: 'manual',
    });
    // The router normalises the path with a redirect, which must stay on the configured origin; never a 2xx.
    expect([403, 308]).toContain(res.status);
    expect(new URL(res.headers.get('location') ?? '/', PUBLIC_ORIGIN).origin).toBe(PUBLIC_ORIGIN);
  });

  it('refuses the plain-HTTP backend origin', async () => {
    expect((await call({ origin: backend })).status).toBe(403);
  });

  it('ignores forwarded headers', async () => {
    const forwarded = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'evil.example', host: 'evil.example' };
    expect((await call({ ...forwarded, origin: 'https://evil.example' })).status).toBe(403);
  });
});
