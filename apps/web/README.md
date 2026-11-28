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

- **Session cookies** ([`src/auth/session.server.ts`](src/auth/session.server.ts)): a fixed set of names, so
  overlapping responses can only overwrite cookies, never add them. `enduva-login` = `<slot>.<login ID>` names the
  active login (only a sign-in writes it); `enduva-session-a`/`-b` are two slots holding `<login ID>.<tokens>` (a
  sign-in takes the slot the current login doesn't use); `enduva-ended` = `<login ID>.<revoked|local>` marks the last
  sign-out. All are `HttpOnly`, `SameSite=Lax`, `Path=/`, 30 days; over https also `Secure` with the `__Host-`
  prefix. A session counts only if its slot holds the active login's ID and the marker doesn't name it, so a late
  response from one tab (a refresh, a refused refresh, a sign-out) can't replace, clear or revive another tab's newer
  login; if overlapping sign-ins put two logins in one slot, the browser is signed out, never switched. A request
  whose access token expires within 60 s refreshes it first, once per request; a refresh token that Auth refuses ends
  that login, an outage or rate limit doesn't. A session cookie over 3800 bytes is never written (sign-in fails, a
  refresh signs out), so the worst case, pointer plus two full slots plus the marker, stays under 8 KiB, half of
  Node's request-header limit ([`test/http-budget.test.ts`](test/http-budget.test.ts) checks it through `server.mjs`).
  Server functions get the session from `sessionMiddleware` as `context.session`. The web server only forwards the
  access token: the API verifies it on every call. Every response from the server is `Cache-Control: private,
  no-store` unless it sets its own, so no shared cache keeps a page or a cookie.
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
  could no longer be refreshed), the cookies still go, `signOut` answers `revoked: false` and the home page (`/?signedOut=local`, which never redirects) says that
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
  so the query cache starts empty. A session the API refuses (`401`) is dropped, the cached viewer with it, and the
  page goes to sign-in. `/profile` re-reads the profile on every visit and shows the email of the session it read it
  with; a save names the account the form was rendered for, and if this browser has signed in as someone else since,
  nothing is written and the page reloads. Every form posts natively (`method="post"`) and can't be submitted before hydration, so no
  personal field or credential ever lands in a URL.
- **`/auth/confirm`** answers with `Referrer-Policy: no-referrer` and replaces its URL without the token once it
  runs. The first request still carries the unspent token in its query string: **the ingress must not log query
  strings for `/auth/confirm`** (deployment requirement, 0.12c). The web server logs no request URLs.
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
router-context field, a loader-data field that doesn't exist, a misspelled field of the API status query data, a
search value the route doesn't accept (`/sign-in`'s `error`), a misspelled server-function input field (`signIn`) and a
misspelled middleware context field (`sessionMiddleware`). A typed route param waits for the first route with one.

## E2E

[`e2e/shell.test.ts`](e2e/shell.test.ts) drives Chromium with [`playwright-core`](https://playwright.dev/docs/library)
(exact pin) from Vitest: the language switch (cookie, reload, `<html lang>`), hydration in the server's locale when the
browser prefers another one, client-side navigation to `/status` with the API down, the localized 404 and 320 px
reflow in light and dark. Uncaught page errors, hydration errors included, fail a test.
[`e2e/preview.ts`](e2e/preview.ts) starts `vite preview` on port 0 and uses the address its own process reports, so the
tests can never reach another server. The landing page's reflow check lives in [`apps/landing/e2e`](../landing/e2e).

[`e2e/auth.test.ts`](e2e/auth.test.ts) runs sign-in end to end against the local Supabase stack (`pnpm --filter
@enduva/db db:start`) and the built API, which it starts itself ([`e2e/local-stack.ts`](e2e/local-stack.ts)):

- sign up → the confirmation mail from Mailpit → confirm (typing the address) → edit the profile (saved, still there
  after a reload) → sign out → a wrong password → sign in. The login and session cookies are `HttpOnly` and
  `SameSite=Lax`, neither token appears in the page or `document.cookie`, and after sign-out the old access token gets
  `401` from the API;
- `/auth/confirm` answers with `Referrer-Policy: no-referrer` and drops the token from its URL;
- an unknown email gets the same answers as a known one; magic-link sign-in, and the link works only once;
- a link to another account, confirmed with the signed-in user's address, leaves that login in place;
- a session the API refuses during client navigation ends on `/sign-in` without bouncing back, also when coming
  back to a profile loaded earlier;
- two tabs: a sign-out answered after the other tab signed in leaves that new login alone (the answer and its
  cookies are held in a separate request context until then), a profile form rendered for A never saves to B (it
  reloads and shows B), and a save answer for A that arrives after the tab shows B is dropped;
- the local-only sign-out notice shows on home even with an active login;
- a sign-out request that gets no answer is reported, and a retry signs out;
- captcha: the stack refuses valid credentials without a token (`captcha_failed`), and the web server forwards the
  widget's token (the answer is the credentials error, not a captcha rejection). Cloudflare's
  test secret accepts any token, so a *rejected* token can't be produced locally;
- **SSR isolation with real sessions:** two users request `/profile` at once and each page shows only that user's
  email and name from `GET /v1/me` (fails with a module-level `QueryClient`); the server-rendered form posts and its
  Save button is disabled until hydration.

It needs `ENDUVA_WEB_ORIGIN` before the preview starts, so it picks a free port first; `--strictPort` makes the
preview fail rather than share it. Without a running stack the suite is skipped locally (`CI=true` fails instead).
`ENDUVA_SUPABASE_WORKDIR` points it at a stack started from another directory. The files run one after another:
Vite allows one preview server per project.

We use the library, not `@playwright/test`: its runner (`playwright`) bundles a Babel TypeScript loader for test
files, and `playwright-core` contains neither a loader nor TypeScript compiler code. Vitest transforms the tests with
Vite, like every other test. Install the matching browser once with `pnpm exec playwright-core install chromium`, then
run `pnpm turbo test:e2e` from the repository root (it builds first). CI runs the `e2e` job.
