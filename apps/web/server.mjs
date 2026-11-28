// Production server of the web app (the `web` image, deploy/Dockerfile): srvx on Node serves the built client
// assets from dist/client and hands every other request to the SSR fetch handler in dist/server/server.js.
// Listens on HOST:PORT (default 0.0.0.0:3000) and drains open requests on SIGTERM/SIGINT.
//
// Behind TLS termination (Traefik) the request URL stays the plain-HTTP backend origin: srvx ignores
// `X-Forwarded-Proto`. Server-function calls that rely on TanStack's `Origin` fallback (no Fetch Metadata) are then
// refused with 403. Trusting forwarded headers from the configured ingress only is task 0.12c (#136).
import { fileURLToPath } from 'node:url';

import { serve } from 'srvx/node';
import { staticMiddleware } from 'srvx/static';

import ssr from './dist/server/server.js';

// A file path, not the URL's `pathname`, which keeps percent-escapes such as `%20` for a space.
const client = fileURLToPath(new URL('dist/client/', import.meta.url));

/** Liveness for the container healthcheck: the process serves requests. Touches neither SSR nor the API. */
const health = (request, next) =>
  new URL(request.url).pathname === '/healthz'
    ? new Response('ok\n', { headers: { 'cache-control': 'no-store', 'content-type': 'text/plain' } })
    : next();

// Vite's content-hashed assets never change under the same URL; any other file is revalidated.
const hashed = staticMiddleware({ dir: client, maxAge: 31_536_000, immutable: true });
const plain = staticMiddleware({ dir: client });
const files = (request, next) =>
  new URL(request.url).pathname.startsWith('/assets/') ? hashed(request, next) : plain(request, next);

serve({
  hostname: process.env['HOST'] ?? '0.0.0.0',
  port: process.env['PORT'] ?? 3000,
  middleware: [health, files],
  fetch: (request) => ssr.fetch(request),
  gracefulShutdown: true,
});
