// Production smoke test: boots the SWC build of the API with plain Node, then renders the
// web app's production SSR bundle through its fetch handler (two concurrent requests).
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const id = '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a';
const api = spawn(process.execPath, ['api/dist/main.js'], { env: { ...process.env, PORT: '3001' }, stdio: 'inherit' });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  let res;
  for (let i = 0; i < 50 && !res; i++) {
    res = await fetch(`http://127.0.0.1:3001/v1/activities/${id}`, { headers: { Authorization: 'Bearer spike-token' } }).catch(() => undefined);
    if (!res) await delay(200);
  }
  assert(res, 'API did not start');
  const body = await res.json();
  assert(res.status === 200 && body.distanceUnit === 'km', `unexpected API response ${res.status} ${JSON.stringify(body)}`);
  console.log('api ok:', JSON.stringify(body));

  const { default: server } = await import(pathToFileURL('web/dist/server/server.js').href);
  const render = (units) => server.fetch(new Request(`http://localhost/activities/${id}?units=${units}`)).then((r) => r.text());
  const [metric, imperial] = await Promise.all([render('metric'), render('imperial')]);
  assert(metric.includes('10.00<!-- --> <!-- -->km') && !metric.includes('6.21'), 'metric SSR page is wrong or contains imperial data');
  assert(imperial.includes('6.21<!-- --> <!-- -->mi') && !imperial.includes('10.00'), 'imperial SSR page is wrong or contains metric data');
  assert(metric.includes('run on 2026-11-26'), 'loader data missing from SSR HTML');
  console.log('web SSR ok: two concurrent requests rendered their own data');

  // Server function + typed middleware context, called by the index loader during SSR.
  const home = await server.fetch(new Request('http://localhost/')).then((r) => r.text());
  assert(home.includes('Hello athlete<!-- --> (<!-- -->user-1<!-- -->)'), 'server function result missing from SSR HTML');
  console.log('web server function ok');
} finally {
  api.kill();
}
