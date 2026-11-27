// SSR request isolation (taken over from spikes/ts7-toolchain/scripts/ssr-isolation.mjs). Two concurrent requests
// for the same page (same query key) from two different visitors, rendered through the production SSR bundle against
// a stub API that answers each readiness call differently. Each request must ask the API itself and render its own
// answer in its own locale. A QueryClient shared between requests would serve the second request from the first
// one's in-flight query, so both pages would show the same state and the stub would count one readiness call.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let readinessCalls = 0;
const stub = createServer((req, res) => {
  const json = (status: number, body: object, type = 'application/json') =>
    res.writeHead(status, { 'content-type': type }).end(JSON.stringify(body));
  if (req.url === '/v1/health') return json(200, { status: 'ok' });
  if (req.url !== '/v1/health/ready') return json(404, {});
  const call = ++readinessCalls;
  // Delayed, so both SSR requests are in flight at the same time.
  setTimeout(() => {
    if (call === 1) json(200, { status: 'ok' });
    else
      json(
        503,
        { type: 'about:blank', title: 'Unavailable', status: 503, code: 'database_unavailable' },
        'application/problem+json',
      );
  }, 300);
});

type Server = { fetch(req: Request): Promise<Response> };
let server: Server;

beforeAll(async () => {
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  process.env['ENDUVA_API_URL'] = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  ({ default: server } = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
    default: Server;
  });
});

afterAll(() => {
  stub.close();
});

async function render(locale: string) {
  const res = await server.fetch(
    new Request('http://localhost/status', { headers: { cookie: `enduva-locale=${locale}` } }),
  );
  const html = await res.text();
  return {
    lang: /<html lang="(\w+)"/.exec(html)?.[1],
    api: /id="status-api" data-state="(\w+)"/.exec(html)?.[1],
    database: /id="status-database" data-state="(\w+)"/.exec(html)?.[1],
  };
}

describe('SSR request isolation', () => {
  it('gives two concurrent requests their own query data', async () => {
    const pages = await Promise.all([render('de'), render('en')]);
    expect(readinessCalls).toBe(2);
    expect(pages.map((page) => page.lang)).toEqual(['de', 'en']);
    expect(pages.map((page) => page.api)).toEqual(['up', 'up']);
    expect(new Set(pages.map((page) => page.database))).toEqual(new Set(['up', 'down']));
  });
});
