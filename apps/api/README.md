# @enduva/api

The NestJS API (REST under `/v1`) and the worker entrypoint. NestJS 12 runs as ES modules, compiled by SWC with
legacy decorators and decorator metadata, and type-checked by TypeScript 7 `tsc --noEmit`. There is no Nest CLI
([ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md)).

## Scripts

| Script | What it does |
| --- | --- |
| `pnpm build` | SWC: `src` → `dist` (`dist/main.js`, `dist/worker.js`), preset `@enduva/config/swc/nest.json` |
| `pnpm dev` | Builds once, then runs `swc --watch` and `node --watch dist/main.js`, reading `apps/api/.env` if it exists |
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
| `DATABASE_URL` | required | Transaction-pooler URL as `enduva_api_login` (`<role>.<tenant>` through the pooler). Any other user is refused |
| `DATABASE_POOL_MAX` | `10` | Pool size per process (06-deployment → Connection budget) |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |
| `LOG_LEVEL` | `info` | pino level, or `silent` |
| `TRUST_PROXY` | empty | Comma-separated IPs/CIDRs of the ingress (Traefik in Dokploy, e.g. the CIDR of its Docker network). `X-Forwarded-For` is honoured only from these peers; empty trusts none. No hop counts |
| `THROTTLE_LIMIT` / `THROTTLE_TTL_SECONDS` | `100` / `60` | Requests per client IP **and endpoint** per window (see Throttling) |

Locally, start the database with `pnpm --filter @enduva/db db:start` and `db:reset` ([`packages/db`](../db/README.md)).
Never point a local process at a hosted project.

## Behaviour

- **Routes** live under `/v1` through Nest's URI versioning (`defaultVersion: '1'`), not a global prefix, so
  Nest's 404 handling also covers paths outside `/v1`.
- **Health:** `GET /v1/health` is liveness and never touches the database. `GET /v1/health/ready` pings the
  database (`select 1`, 2 s timeout) and answers `503` `database_unavailable` otherwise.
- **Errors:** every error is RFC 9457 problem details (`application/problem+json`) with `type: about:blank`, the
  status phrase as `title`, `status` and a stable `code` from [`src/problem/problem.ts`](src/problem/problem.ts).
  Throw `ProblemException(code)` for expected errors. Messages of Nest and Express exceptions are not passed on.
  Unexpected errors become `500` `internal_error` and are logged with the request ID and their class only: the
  `err` serializer ([`src/logging/safe-error.ts`](src/logging/safe-error.ts)) never logs messages, causes, stacks
  or other properties, since those can carry request input.
- **Logging:** pino JSON on stdout. The request logger is the first middleware, ahead of the body parser, so every
  request gets a server-generated ID, echoed in the `x-request-id` response header. An incoming `x-request-id` is
  ignored: it is client-controlled. Request logs hold only ID, method, the matched route template (e.g.
  `/v1/items/:id`; `(unmatched)` when the request ended before routing), status and duration: no raw paths or query
  strings, headers, tokens, bodies, client IPs or health data. Nest's own logs go through the same logger
  (nestjs-pino).
  For failed queries only the SQL text (placeholders), SQLSTATE, table and constraint are logged, never the
  parameters or Postgres' message ([`src/db/errors.ts`](src/db/errors.ts)).
- **Throttling:** `@nestjs/throttler` as a global guard, in memory per process. Each matched endpoint (controller and
  handler) has its own bucket per client IP, so the limit is not an API-wide or ingress-wide request limit. The
  guard runs after the body parser and routing: requests to unmatched routes and requests whose body is rejected are
  never counted. Over the limit: `429` `rate_limited` with `Retry-After`. Per-user limits follow with auth (0.8b);
  an overall request limit belongs to the ingress.
- **Database:** one pg pool on `DATABASE_URL` ([ADR-0002](../../docs/adr/0002-db-access-and-rls.md)). It connects
  lazily, so the API starts and stays live while the database is down. A request whose `claims` were set by the
  auth guard (0.8b) runs its handler in **one** `withUserTx` transaction as `enduva_api`, with the claims set
  transaction-locally, so it works with the transaction pooler. The transaction commits before the response is sent
  and rolls back if the handler throws. Handlers take it with the `@RequestTx()` parameter decorator and pass it to
  services; using it on a route without verified claims fails with a `500`. Requests without claims get no
  transaction.

## Tests

- Unit tests for the env schema, the problem mapping, query-error redaction and the transaction interceptor.
- `test/health.e2e.test.ts` boots the real `AppModule` under SWC: DI through decorator metadata, liveness,
  readiness without a database, request IDs, problem bodies (404 inside and outside `/v1`, malformed body,
  unexpected error), log redaction and throttling.
- `test/dist.e2e.test.ts` runs the SWC build with plain `node`: it boots, serves `/v1/health`, and refuses to boot
  with an invalid environment. The worker entrypoint runs and exits.
- `test/database.e2e.test.ts` runs against the **local** Supabase stack through the transaction pooler: readiness, a
  request transaction as `enduva_api` under RLS, rollback, and a failed query whose parameter stays out of the logs.
  Without a running stack its tests are reported as skipped (`SKIPPED, not running` in the suite name), as in CI.
