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
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | |

## Behaviour

- **Routes** live under `/v1` through Nest's URI versioning (`defaultVersion: '1'`), not a global prefix, so
  Nest's 404 handling also covers paths outside `/v1`.
- **Health:** `GET /v1/health` is liveness and touches nothing else.
- **Errors:** every error is RFC 9457 problem details (`application/problem+json`) with `type: about:blank`, the
  status phrase as `title`, `status` and a stable `code` from [`src/problem/problem.ts`](src/problem/problem.ts).
  Throw `ProblemException(code)` for expected errors. Messages of Nest and Express exceptions are not passed on.
  Unexpected errors become `500` `internal_error`; their message is logged, never sent.

## Tests

- Unit tests for the env schema and the problem mapping.
- `test/health.e2e.test.ts` boots the real `AppModule` under SWC: DI through decorator metadata, liveness and
  problem bodies (404 inside and outside `/v1`, malformed body, unexpected error).
- `test/dist.e2e.test.ts` runs the SWC build with plain `node`: it boots, serves `/v1/health`, and refuses to boot
  with an invalid environment. The worker entrypoint runs and exits.
