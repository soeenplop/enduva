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
| `pnpm dev` | Vite dev server on port 3000 |
| `pnpm test` | Vitest. Turbo builds first: `test/ssr.test.ts` renders through the production SSR bundle |

`dist/server/server.js` exports the SSR fetch handler; the Node server preset is pinned in 0.12a.

## Per-request state

[`getRouter()`](src/router.tsx) creates a new `QueryClient` for every router, and Start creates one router per SSR
request, so no query data is shared between requests or users. Never create a `QueryClient` (or anything else that
holds user data) at module scope. Loaders fill the cache with `context.queryClient.ensureQueryData(…)`;
`@tanstack/react-router-ssr-query` dehydrates it into the page.

## Locale

No locale in the URL (02-architecture.md, Internationalisation). [`src/server.ts`](src/server.ts) resolves it per
request: the `enduva-locale` cookie (a stand-in for the profile setting until 0.9b), then `Accept-Language`, then
`en`. Messages live in [`packages/i18n/messages`](../../packages/i18n/messages); every key must exist in `de` and `en`
(unit test).

## Negative tests

`negative/*.tsx` must fail `tsc` with exactly the diagnostic they name (`pnpm test:negative` from the repository root):
a `Link` to a missing route, an undeclared search param, a misspelled message and a misspelled router-context field.
