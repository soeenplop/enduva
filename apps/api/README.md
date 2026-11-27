# @enduva/api

The NestJS API (REST under `/v1`) and the worker entrypoint. NestJS 12 runs as ES modules, compiled by SWC with
legacy decorators and decorator metadata, and type-checked by TypeScript 7 `tsc --noEmit`. There is no Nest CLI
([ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md)).

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | SWC: `src` → `dist` (`dist/main.js`, `dist/worker.js`), preset `@enduva/config/swc/nest.json` |
| `pnpm dev` | Builds the workspace packages it depends on (e.g. `@enduva/db`, whose runtime entry is `dist/`) and itself once, then runs `swc --watch` and `node --watch dist/main.js`, reading `apps/api/.env` if it exists |
| `pnpm start` | `node dist/main.js` (production entrypoint) |
| `pnpm start:worker` | `node dist/worker.js` (a stub until the worker lands in 0.12c) |
| `pnpm typecheck` | `tsc -p tsconfig.json` (TS 7, no emit) |
| `pnpm lint` | oxlint, type-aware, shared config |
| `pnpm test` | Vitest through SWC (`@enduva/config/vitest/nest`); needs `pnpm build` first, which Turbo does |

The root `pnpm build|typecheck|lint|test` run these through Turbo. `pnpm test:negative` at the root also checks the
fixtures in [`negative/`](negative): each must fail `tsc` or oxlint with exactly the diagnostic in its header.

## Environment

Validated with Zod at boot ([`src/config/env.ts`](src/config/env.ts)). A missing or invalid value stops the
process with exit code 1 and a list of the offending variable names (never their values). Copy
[`.env.example`](.env.example) to `.env` for local development.

| Variable | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | required | Transaction-pooler URL as `enduva_api_login` (`<role>.<tenant>` through the pooler). Any other user is refused, and so is any query parameter but `sslmode`, `sslrootcert` and `uselibpqcompat` (node-postgres lets `?user=` or `?options=` override the URL). Readiness also checks `current_user` |
| `DATABASE_POOL_MAX` | `10` | Pool size per process (06-deployment → Connection budget) |
| `DATABASE_CONNECT_TIMEOUT_MS` | `5000` | How long a checkout may wait for a connection, queued or new, before it fails |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | pino level, or `silent` |
| `TRUST_PROXY` | empty | Comma-separated IPs/CIDRs of the ingress peers whose `X-Forwarded-For` is honoured: Traefik's own address(es), or a subnet that only trusted proxies can join. **Not** the subnet of Dokploy's `dokploy-network`, `uniquelocal` or `linklocal` (see Client IPs). Empty trusts none. No hop counts |
| `THROTTLE_LIMIT` / `THROTTLE_TTL_SECONDS` | `100` / `60` | Requests per client IP **and endpoint** per window (see Throttling) |
| `AUTH_ISSUER` | required | Supabase Auth issuer, compared exactly with a token's `iss`: `https://<project-ref>.supabase.co/auth/v1`, locally `http://127.0.0.1:54321/auth/v1`. https only, except on a loopback host; no trailing slash. The JWKS comes from `<issuer>/.well-known/jwks.json` |
| `AUTH_JWT_ALGORITHM` | `ES256` | The one asymmetric algorithm the project signs access tokens with: `ES256` or `RS256`. HS256 and `none` are never accepted |

Locally, start the database with `pnpm --filter @enduva/db db:start` and `db:reset` ([`packages/db`](../db/README.md)).
Never point a local process at a hosted project.

## Behaviour

- **Routes** live under `/v1` through Nest's URI versioning (`defaultVersion: '1'`), not a global prefix, so
  Nest's 404 handling also covers paths outside `/v1`.
- **Health:** `GET /v1/health` is liveness and never touches the database. `GET /v1/health/ready` asks the
  database for `current_user` and answers `503` `database_unavailable` within 2 s unless it answers as
  `enduva_api_login`. The probe behind it always ends and gives its connection back: the checkout is bounded by
  `DATABASE_CONNECT_TIMEOUT_MS`, the query by a 2 s `query_timeout` after which its client is destroyed, and
  concurrent readiness requests share one probe.
- **Errors:** every error is RFC 9457 problem details (`application/problem+json`) with `type: about:blank`, the
  status phrase as `title`, `status` and a stable `code` from [`src/problem/problem.ts`](src/problem/problem.ts).
  Throw `ProblemException(code)` for expected errors. Messages of Nest and Express exceptions are not passed on.
  Unexpected errors become `500` `internal_error` and are logged with the request ID and their category only: the
  `err` serializer ([`src/logging/safe-error.ts`](src/logging/safe-error.ts)) never logs messages, causes, stacks
  or other properties, since those can carry request input. The category comes from an allowlist of known error
  classes checked with `instanceof` (e.g. `DatabaseError`, `HttpException`, `TypeError`, then `Error`), never from
  the thrown value's `constructor` or `name`; anything else is `Unknown`. Neither the serializer nor the filter
  throws, whatever is thrown.
- **Logging:** pino JSON on stdout. The request logger is the first middleware, ahead of the body parser, so every
  request gets a server-generated ID, echoed in the `x-request-id` response header. An incoming `x-request-id` is
  ignored: it is client-controlled. Request logs hold only ID, method, the matched route template (e.g.
  `/v1/items/:id`; `(unmatched)` when the request ended before routing), status and duration: no raw paths or query
  strings, headers, tokens, bodies, client IPs or health data. Nest's own logs go through the same logger
  (nestjs-pino).
  Database errors add only their SQLSTATE (in full if known, otherwise only its class) and their table and constraint, only if the schema declares
  that name ([`src/db/errors.ts`](src/db/errors.ts); new tables go into its `schemaTables` list): never the query text, parameters, Drizzle's message or stack, or
  Postgres' message, detail, hint or where. This holds for every database log path (request errors, readiness,
  idle client errors).
- **Authentication:** a global guard ([`src/auth`](src/auth)) requires `Authorization: Bearer <access token>` on every
  route not marked `@Public()` (only health is). The token must verify against Supabase's JWKS with exactly
  `AUTH_JWT_ALGORITHM`, carry the exact `AUTH_ISSUER` as `iss`, `aud` and `role` `authenticated`, a valid `exp` and an
  `iat` not in the future (10 s clock skew), a UUID `sub` and `session_id`, and not be an anonymous user's. The JWKS
  is cached for 10 minutes and refetched when a token names an unknown key ID (rotation); every fetch attempt, a
  failed one too, starts a 30 s cooldown ([`src/auth/jwks.ts`](src/auth/jwks.ts)).
  Every rejection is the same `401 unauthorized` with `WWW-Authenticate: Bearer`; the reason is neither sent nor
  logged, and neither are tokens or claims. If the JWKS can't be fetched, requests fail closed with `503`
  `auth_unavailable`. The request keeps only `sub`, `role` and `session_id` as its claims. The throttler runs before
  the guard, so unauthenticated requests are limited too.
- **Throttling:** `@nestjs/throttler` as a global guard, in memory per process. Each matched endpoint (controller and
  handler) has its own bucket per client IP, so the limit is not an API-wide or ingress-wide request limit. The
  guard runs after the body parser and routing: requests to unmatched routes and requests whose body is rejected are
  never counted. Over the limit: `429` `rate_limited` with `Retry-After`. Per-user limits are not in place yet; an
  overall request limit belongs to the ingress.
- **Client IPs:** the throttler keys on Express' `req.ip`, which takes `X-Forwarded-For` only from a peer in
  `TRUST_PROXY`. Every peer listed there can choose the client IP it forwards, so list only the ingress. In Dokploy,
  every deployed service joins the shared `dokploy-network` by default, and so can reach every other one
  ([Dokploy networks](https://docs.dokploy.com/docs/core/networks)): trusting that network's subnet, or a named range
  such as `uniquelocal` that covers Docker's subnets, lets any service on the server spoof client IPs. Trust
  Traefik's address(es) on the network it shares with the API, pinned so a recreated container keeps them, or a
  dedicated subnet that only Traefik is attached to besides the API. The production value is set with the deploy
  (0.12c).
- **Database:** one pg pool on `DATABASE_URL` ([ADR-0002](../../docs/adr/0002-db-access-and-rls.md)). It connects
  lazily, so the API starts and stays live while the database is down. A request whose `claims` were set by the
  auth guard runs its handler in **one** `withUserTx` transaction as `enduva_api`, with the claims set
  transaction-locally, so it works with the transaction pooler. The transaction commits before the response is sent
  and rolls back if the handler throws. Handlers take it with the `@RequestTx()` parameter decorator and pass it to
  services; using it on a route without verified claims fails with a `500`. Requests without claims get no
  transaction.
- **Session and account check:** the first statement of every request transaction, synchronous and uncached, so a
  request started after a revocation committed is refused ([`src/auth/account-status.ts`](src/auth/account-status.ts)).
  `app.auth_session_active()` (ADR-0002 → Session check) confirms that the token's session still exists and hasn't
  expired and that its user exists, isn't deleted and isn't banned; otherwise `401 unauthorized`. A revoked device for
  the session answers `401 device_revoked`, on which clients wipe their local account data. A user's first request
  creates their profile and settings with defaults.
- **`GET /v1/me`:** the user's profile (`Cache-Control: no-store`).

## Tests

- Unit tests for the env schema, the problem mapping, error categories and query-error redaction (including hostile
  thrown values: shadowed or throwing `constructor`, proxies, primitives) and the transaction interceptor.
- `test/health.e2e.test.ts` boots the real `AppModule` under SWC: DI through decorator metadata, liveness,
  readiness without a database, request IDs, problem bodies (404 inside and outside `/v1`, malformed body,
  unexpected and hostile errors), log redaction and throttling.
- `test/dist.e2e.test.ts` runs the SWC build with plain `node`: it boots, serves `/v1/health`, and refuses to boot
  with an invalid environment. The worker entrypoint runs and exits.
- `test/database.e2e.test.ts` runs against the **local** Supabase stack through the transaction pooler, with access
  tokens from real sign-ins through the local Auth server: readiness, a request transaction as `enduva_api` under
  RLS, rollback, and a failed query whose parameter stays out of the logs.
  Without a running stack its tests are reported as skipped (`SKIPPED, not running` in the suite name), as in CI.
- `test/token-verifier.test.ts` checks token verification with locally generated keys: wrong `iss`/`aud`/`role`,
  HS256 (also with the public key as secret), `none`, the other asymmetric algorithm, unknown or forged keys,
  tampering, expiry and `iat`/`nbf` around the clock skew, missing claims, anonymous users; and the remote JWKS
  (caching, rotation, fail closed, at most one fetch per 30 s cooldown also while fetches fail) against a stand-in
  endpoint. `test/auth-guard.e2e.test.ts` runs the guard on the real `AppModule` against that endpoint: protected and
  public routes, malformed and duplicate headers, `503`, throttling first, no token in the logs.
- `test/auth.e2e.test.ts` signs in through the **local** Auth server and covers `/v1/me`, profile creation, a
  foreign issuer, and the unexpired tokens of signed-out, deleted, soft-deleted and banned accounts (reads and
  writes) and of a revoked device right after a successful request. Skipped without a running stack, like the
  database tests.
