# @enduva/web

The web app at `https://app.enduva.soeenplop.dev`: TanStack Start with server-side rendering, TanStack Router file
routes and TanStack Query. Stack and pitfalls: [ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md).

## Commands

Run them through Turbo from the repository root (`pnpm turbo build typecheck lint test`), which runs `generate` first.
In this directory:

| Script | What it does |
| --- | --- |
| `pnpm generate` | Compiles the Paraglide messages (`src/paraglide/`) and the route tree (`src/routeTree.gen.ts`) for `tsc`. Both are git-ignored |
| `pnpm build` | [`scripts/build.mjs`](scripts/build.mjs): `vite build`, then the same route-tree and Paraglide identity check as the landing page ([`apps/landing/README.md`](../landing/README.md#identity-check)) |
| `pnpm dev` | Vite dev server (talks to the local API at `http://127.0.0.1:3000` unless `ENDUVA_API_URL` is set) |
| `pnpm test:e2e` | Browser tests in `e2e/` against `vite preview` of the build (see E2E) |
| `pnpm test` | Vitest. Turbo builds first: `test/ssr*.test.ts` render through the production SSR bundle |

`dist/server/server.js` exports the SSR fetch handler. The production build bundles its dependencies into it
(`ssr.noExternal` in [`vite.config.mjs`](vite.config.mjs)), and [`server.mjs`](server.mjs) serves it on Node with
[srvx](https://srvx.h3.dev): `node server.mjs` after `pnpm build` (`HOST`, `PORT`, default `0.0.0.0:3000`), with the
static files from `dist/client` and a `/healthz` liveness endpoint. The `web` image runs exactly that
([`deploy/README.md`](../../deploy/README.md)).

## Per-request state

[`getRouter()`](src/router.tsx) creates a new `QueryClient` for every router, and Start creates one router per SSR
request, so no query data is shared between requests or users. Never create a `QueryClient` (or anything else that
holds user data) at module scope. Loaders fill the cache with `context.queryClient.ensureQueryData(…)`;
`@tanstack/react-router-ssr-query` dehydrates it into the page.

## Environment

| Variable | Read by | Meaning |
| --- | --- | --- |
| `ENDUVA_API_URL` | the server, at call time ([`src/config.server.ts`](src/config.server.ts)) | Origin of the API for server-side calls. Required in a production build |
| `ENDUVA_AUTH_URL` | the server | Supabase project URL (`https://<ref>.supabase.co`); Auth is under `/auth/v1`. Required in a production build, `pnpm dev` defaults to `http://127.0.0.1:54321` |
| `ENDUVA_AUTH_PUBLISHABLE_KEY` | the server | Supabase publishable key. Always required; locally `PUBLISHABLE_KEY` from `supabase status` |
| `ENDUVA_WEB_ORIGIN` | the server | This app's public origin (`https://app.enduva.soeenplop.dev`): https makes the auth cookies `Secure` and `__Host-`, and it builds the OAuth callback URL. Required in a production build, `pnpm dev` uses the request's origin |
| `ENDUVA_TURNSTILE_SITE_KEY` | the server, sent to the sign-in pages | Turnstile site key (public). Required in a production build, `pnpm dev` defaults to Cloudflare's always-passing test key |

Nothing is baked in at build time, so one image serves every environment. The browser never calls the API or Auth:
every call goes through the web server, which holds the session.

## Sign-in

Email + password, magic link and Google, all through Supabase Auth (02-architecture.md, Authentication), called by
the web server over Auth's REST API ([`src/auth/gotrue.server.ts`](src/auth/gotrue.server.ts)). The pages post to
server functions ([`src/auth/functions.ts`](src/auth/functions.ts)), so no token ever reaches the browser.

- **Session cookies** ([`src/auth/session.server.ts`](src/auth/session.server.ts)): each sign-in gets a random
  login ID; `enduva-login` names the active one and `enduva-session-<id>` holds its access token, refresh token and
  expiry. All are `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days; over https also `Secure` with the `__Host-` prefix.
  A request whose access token expires within 60 s refreshes it first, once per request however many server
  functions run; a refresh token that Auth refuses ends that login, an outage or rate limit doesn't. A refresh or a
  dropped session only writes the cookie of the login it started from, so a late response from one tab can't replace
  or clear a newer sign-in from another. Server functions get the session from `sessionMiddleware` as
  `context.session`. The web server only forwards the access token: the API verifies it on every call. Every response
  from the server is `Cache-Control: private, no-store` unless it sets its own, so no shared cache keeps a page or a
  cookie.
- **CSRF:** Start's default CSRF middleware guards every server function: `Sec-Fetch-Site` must be `same-origin`, or
  without it the `Origin` (then `Referer`) must be the request's origin; a call without any of them is refused.
  Mutations are `POST`. `SameSite=Lax` keeps the cookie off cross-site subrequests too.
- **No account enumeration** ([`src/auth/outcomes.ts`](src/auth/outcomes.ts)): a wrong password, an unknown email
  and an unconfirmed email are the same error; sign-up and the magic link answer the same whether the account
  exists. Auth's recipient-dependent answers (`user_already_exists`, `otp_disabled`, and its per-recipient mail
  cooldown `over_email_send_rate_limit`) all map to success. Only captcha, request-rate and availability errors
  are shown as such.
- **Email links** (`supabase/templates`) point at `/auth/confirm?token_hash=…`. That page posts the hash back, so a
  mail scanner that follows links can't spend the single-use link, and it works in any browser. The user types the
  address the mail went to, and the session is kept only if the link belongs to it, so someone else's link can't
  switch this browser to their account.
- **Sign-out** ends the session at Auth and clears the cookies. If Auth can't confirm it (outage, or a session that
  could no longer be refreshed), the cookies still go, `signOut` answers `revoked: false` and the page says that
  tokens already issued stay valid until they expire (at most an hour).
- **Google** (PKCE): `startGoogleSignIn` keeps the verifier and the page to return to in an `HttpOnly` cookie for ten
  minutes and sends the browser to Auth; [`/auth/callback`](src/routes/auth/callback.ts) redeems the code with it.
  Only a verified exchange spends that state, so a callback anyone can trigger leaves a pending sign-in alone.
  The sign-in page shows Google only when Auth reports the provider as enabled. Locally it is off: enabling it needs
  your own OAuth client (`supabase/config.toml`).
- **Return path:** `safeRedirect` ([`src/auth/redirect.ts`](src/auth/redirect.ts)) keeps only paths on this app and
  never the auth pages, checked after URL normalisation (dot segments can turn `/a/..//x` into `//x`).
- **Pages:** `/sign-up`, `/sign-in` (password, magic link, Google), `/auth/confirm` and `/profile` (`GET`/`PATCH
  /v1/me` with `If-Match`; a conflict reloads the form with the current profile). Signing in or out reloads the page,
  so the query cache starts empty. A session the API refuses (`401`) is dropped and the page goes to sign-in.
- **Errors:** server functions log anything unexpected and send a generic error (`serverErrors`), because Start
  would put the message into the page.
- **Turnstile:** Auth verifies the token on sign-up, password sign-in and magic links. Locally and in CI Cloudflare's
  test keys are used (`supabase/config.toml`); production keys come with the deploy (0.12b).

## API

Calls go through the generated client [`@enduva/api-client`](../../packages/api-client) (its README defines the
result contract). [`/status`](src/routes/status.tsx) shows the API's liveness and readiness: a server function asks
`GET /v1/health` and `GET /v1/health/ready`, and the route loader puts the result in the request's `QueryClient`
([`src/api/queries.ts`](src/api/queries.ts)). Each probe has a 2 s deadline, so a stalled API shows as unavailable instead
of holding the page, and unexpected errors are logged on the server and reach the page only as a generic error. [`test/ssr-isolation.test.ts`](test/ssr-isolation.test.ts) renders
that page for two visitors at once against a stub API that answers each call differently, and requires each page to
show its own answer; with a module-level `QueryClient` it fails.

## Locale

No locale in the URL (02-architecture.md, Internationalisation). [`src/server.ts`](src/server.ts) resolves it per
request: the `enduva-locale` cookie, then `Accept-Language`, then `en`. In the browser, [`src/locale.ts`](src/locale.ts) takes the locale from the `<html lang>` the server rendered, so
hydration never renegotiates it from `navigator.languages`. The language switch sets the cookie and reloads, and so
does saving another language on the profile page. Messages
live in [`packages/i18n/messages`](../../packages/i18n/messages); every key must exist in `de` and `en` (unit test).

## Design

Colors, radii and type come from `@enduva/ui/tokens.css`, which follows the system's light/dark setting. Tailwind CSS 4
maps its theme onto those custom properties ([`src/styles.css`](src/styles.css)), so utilities such as `bg-surface`
switch with the theme. Tailwind's default palette is removed, so only token colors exist.

## Negative tests

`negative/*.tsx` must fail `tsc` with exactly the diagnostic they name (`pnpm test:negative` from the repository root):
a wrong component prop, a `Link` to a missing route, an undeclared search param, a misspelled message, a misspelled
router-context field, a loader-data field that doesn't exist and a misspelled field of the API status query data.

## E2E

[`e2e/shell.test.ts`](e2e/shell.test.ts) drives Chromium with [`playwright-core`](https://playwright.dev/docs/library)
(exact pin) from Vitest: the language switch (cookie, reload, `<html lang>`), hydration in the server's locale when the
browser prefers another one, client-side navigation to `/status` with the API down, the localized 404 and 320 px
reflow in light and dark. Uncaught page errors, hydration errors included, fail a test.
[`e2e/preview.ts`](e2e/preview.ts) starts `vite preview` on port 0 and uses the address its own process reports, so the
tests can never reach another server. The landing page's reflow check lives in [`apps/landing/e2e`](../landing/e2e).

We use the library, not `@playwright/test`: its runner (`playwright`) bundles a Babel TypeScript loader for test
files, and `playwright-core` contains neither a loader nor TypeScript compiler code. Vitest transforms the tests with
Vite, like every other test. Install the matching browser once with `pnpm exec playwright-core install chromium`, then
run `pnpm turbo test:e2e` from the repository root (it builds first). CI runs the `e2e` job.
