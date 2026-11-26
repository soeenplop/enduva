// SSR QueryClient isolation: renders the SAME URL (same query key) twice concurrently through the
// web app's production SSR bundle, against a stub backend that answers each call differently.
// Each request must call the backend itself and render its own answer. A QueryClient shared between
// requests would serve the second request from the first one's in-flight or cached query, so both
// pages would show the same distance. Runs after `smoke.mjs` in its own process (fresh connection
// pool, port 3001 free again), because the bundle's API base URL is fixed at build time.
import { once } from 'node:events';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const id = '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a';
const activity = { id, sport: 'run', startedAt: '2026-11-26T08:00:00Z', distanceUnit: 'km' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

let calls = 0;
const stub = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== `/v1/activities/${id}?units=metric`) {
    res.writeHead(404).end();
    return;
  }
  const distance = ++calls * 11;
  // Delay so both SSR requests are in flight at the same time.
  setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...activity, distance })), 300);
});
stub.listen(3001, '127.0.0.1');
await once(stub, 'listening');

try {
  const { default: server } = await import(pathToFileURL('web/dist/server/server.js').href);
  const render = () => server.fetch(new Request(`http://localhost/activities/${id}?units=metric`)).then((r) => r.text());
  const pages = await Promise.all([render(), render()]);
  const distances = pages.map((html) => [...html.matchAll(/(\d+\.\d{2})<!-- --> <!-- -->km/g)].map((m) => m[1]).join(','));
  assert(calls === 2, `expected one backend call per SSR request, got ${calls}`);
  assert(
    distances.toSorted((a, b) => a.localeCompare(b)).join(' | ') === '11.00 | 22.00',
    `requests with the same query key did not render their own data: ${JSON.stringify(distances)}`,
  );
  console.log('web SSR ok: same query key, two concurrent requests, each with its own QueryClient');
} finally {
  stub.close();
}
