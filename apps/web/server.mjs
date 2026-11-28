// Production server of the web app (the `web` image, deploy/Dockerfile): srvx on Node serves the built client
// assets from dist/client and hands every other request to the SSR fetch handler in dist/server/server.js.
// Listens on HOST:PORT (default 0.0.0.0:3000) and drains open requests on SIGTERM/SIGINT.
//
// Behind TLS termination (Traefik) the socket sees the plain-HTTP backend origin. With `ENDUVA_WEB_ORIGIN` set (required
// in production), the SSR handler sees every request at that public origin instead, so TanStack's `Origin` check of
// server-function calls compares against `https://app…`. `X-Forwarded-*` headers are never read: no peer can
// change the origin the app believes it serves (#136).
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

const publicOrigin = process.env['ENDUVA_WEB_ORIGIN'] ? new URL(process.env['ENDUVA_WEB_ORIGIN']).origin : undefined;

/** The request with its URL moved to the public origin; path, query, method, headers and body unchanged. */
const atPublicOrigin = (request) => {
  if (publicOrigin === undefined) return request;
  const { pathname, search } = new URL(request.url);
  // Assigned, not resolved against the origin: a path such as `//evil.example/…` must not pick its own host.
  const url = new URL(publicOrigin);
  url.pathname = pathname;
  url.search = search;
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: 'half',
    signal: request.signal,
  });
};

serve({
  hostname: process.env['HOST'] ?? '0.0.0.0',
  port: process.env['PORT'] ?? 3000,
  middleware: [health, files],
  fetch: (request) => ssr.fetch(atPublicOrigin(request)),
  gracefulShutdown: true,
});
