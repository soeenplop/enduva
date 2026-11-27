# @enduva/web

The web app at `https://app.enduva.soeenplop.dev`: TanStack Start with server-side rendering, TanStack Router file
routes and TanStack Query. Stack and pitfalls: [ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md). Sign-in
is task 0.9b.

## Commands

Run them through Turbo from the repository root (`pnpm turbo build typecheck lint test`), which runs `generate` first.
In this directory:

| Script | What it does |
| --- | --- |
| `pnpm generate` | Compiles the Paraglide messages (`src/paraglide/`) and the route tree (`src/routeTree.gen.ts`) for `tsc`. Both are git-ignored |
| `pnpm build` | [`scripts/build.mjs`](scripts/build.mjs): `vite build`, then the same route-tree and Paraglide identity check as the landing page ([`apps/landing/README.md`](../landing/README.md#identity-check)) |
| `pnpm dev` | Vite dev server (talks to the local API at `http://127.0.0.1:3000` unless `ENDUVA_API_URL` is set) |
| `pnpm test` | Vitest. Turbo builds first: `test/ssr*.test.ts` render through the production SSR bundle |

`dist/server/server.js` exports the SSR fetch handler; the Node server preset is pinned in 0.12a.

## Per-request state

[`getRouter()`](src/router.tsx) creates a new `QueryClient` for every router, and Start creates one router per SSR
request, so no query data is shared between requests or users. Never create a `QueryClient` (or anything else that
holds user data) at module scope. Loaders fill the cache with `context.queryClient.ensureQueryData(…)`;
`@tanstack/react-router-ssr-query` dehydrates it into the page.

## Environment

| Variable | Read by | Meaning |
| --- | --- | --- |
| `ENDUVA_API_URL` | the server, at call time ([`src/config.server.ts`](src/config.server.ts)) | Origin of the API for server-side calls. Required in a production build |

Nothing is baked in at build time, so one image serves every environment. The browser doesn't call the API yet; 0.9b
adds its public URL together with sign-in.

## API

Calls go through the generated client [`@enduva/api-client`](../../packages/api-client) (its README defines the
result contract). [`/status`](src/routes/status.tsx) shows the API's liveness and readiness: a server function asks
`GET /v1/health` and `GET /v1/health/ready`, and the route loader puts the result in the request's `QueryClient`
([`src/api/queries.ts`](src/api/queries.ts)). [`test/ssr-isolation.test.ts`](test/ssr-isolation.test.ts) renders
that page for two visitors at once against a stub API that answers each call differently, and requires each page to
show its own answer; with a module-level `QueryClient` it fails.

## Locale

No locale in the URL (02-architecture.md, Internationalisation). [`src/server.ts`](src/server.ts) resolves it per
request: the `enduva-locale` cookie (a stand-in for the profile setting until 0.9b), then `Accept-Language`, then
`en`. In the browser, [`src/locale.ts`](src/locale.ts) takes the locale from the `<html lang>` the server rendered, so
hydration never renegotiates it from `navigator.languages`. The language switch sets the cookie and reloads. Messages
live in [`packages/i18n/messages`](../../packages/i18n/messages); every key must exist in `de` and `en` (unit test).

## Design

Colors, radii and type come from `@enduva/ui/tokens.css`, which follows the system's light/dark setting. Tailwind CSS 4
maps its theme onto those custom properties ([`src/styles.css`](src/styles.css)), so utilities such as `bg-surface`
switch with the theme. Tailwind's default palette is removed, so only token colors exist.

## Negative tests

`negative/*.tsx` must fail `tsc` with exactly the diagnostic they name (`pnpm test:negative` from the repository root):
a wrong component prop, a `Link` to a missing route, an undeclared search param, a misspelled message, a misspelled
router-context field, a loader-data field that doesn't exist and a misspelled field of the API status query data.
