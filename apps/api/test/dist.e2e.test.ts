import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

// The production build: plain `node` on SWC's output, as in the container (`node dist/main.js`). Turbo builds the
// package before its tests (turbo.json).
const dist = (file: string) => fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
if (!existsSync(dist('main.js'))) throw new Error('dist/main.js is missing: run `pnpm build` first');

const cleanEnv = { PATH: process.env.PATH ?? '' };

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === 'string') throw new Error('no port');
  return address.port;
}

describe('dist/main.js (SWC build, plain node)', () => {
  let api: ChildProcess | undefined;

  afterAll(async () => {
    if (api === undefined || api.exitCode !== null) return;
    const exited = new Promise((resolve) => api?.once('exit', resolve));
    api.kill('SIGTERM');
    await exited;
  });

  it('refuses to boot with an invalid environment, naming the variables but not their values', () => {
    const r = spawnSync(process.execPath, [dist('main.js')], {
      env: { ...cleanEnv, PORT: 's3cret', NODE_ENV: 'staging' },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Invalid environment:');
    expect(r.stderr).toContain('PORT:');
    expect(r.stderr).toContain('NODE_ENV:');
    expect(r.stderr).not.toContain('s3cret');
  });

  it('boots and serves /v1/health', async () => {
    const port = await freePort();
    api = spawn(process.execPath, [dist('main.js')], {
      env: { ...cleanEnv, HOST: '127.0.0.1', PORT: String(port), LOG_LEVEL: 'warn' },
      stdio: 'ignore',
    });
    let res: Response | undefined;
    for (let attempt = 0; attempt < 50 && res === undefined; attempt++) {
      res = await fetch(`http://127.0.0.1:${port}/v1/health`).catch(() => undefined);
      if (res === undefined) await delay(100);
    }
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ status: 'ok' });
    expect(res?.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('has a worker entrypoint', () => {
    const r = spawnSync(process.execPath, [dist('worker.js')], { env: cleanEnv, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('worker stub');
  });
});
