# ADR-0002: Database access and row-level security

- **Status:** Proposed (task 0.7, issue [#9](https://github.com/soeenplop/enduva/issues/9)). Becomes Accepted when the PR
  merges under the normal merge rules ([`AGENTS.md` → Merging](../../AGENTS.md#merging), W12).
- **Date:** 2026-11-27
- **Decisions affected:** T13, T25 ([`00-decisions.md`](../plan/00-decisions.md)); [`02-architecture.md` → Tenant isolation](../plan/02-architecture.md#tenant-isolation-adr-0002-task-07), [`06-deployment.md` → Supabase](../plan/06-deployment.md#supabase)

## Context

The API verifies Supabase access tokens itself and queries Postgres directly; clients never use Supabase's Data API.
Row-level security (RLS) is meant as defence in depth behind the API's own ownership checks, but it is only that if
the API's queries actually run **under** it: as a role without `BYPASSRLS` that owns no table, with the user's
identity set for exactly one transaction. Production reaches Postgres through Supabase's **transaction pooler**
(Supavisor), so nothing may depend on session state.

## Decision

### Trust boundary

- **Who a transaction acts for** comes from outside the database: the claims of an access token the API verified
  (0.8) or the user ID of a trusted job. `withUserTx`/`withWorkerTx` set it transaction-locally.
- **What RLS guarantees** given that identity: every query, including one that forgets its ownership filter or joins
  the wrong way, sees and writes only that user's rows, and with no identity it sees and writes nothing. Grants
  limit which operations and columns each role may use at all.
- **What stays with the application:** keeping the runtime database credentials secret (anyone with them can set any
  identity), passing only verified identities to the helpers, and keeping SQL parameterized. RLS doesn't defend
  against a caller that sets someone else's `sub`.

### Driver: node-postgres

`pg` 8.23.1 under Drizzle's `node-postgres` driver ([`src/client.ts`](../../packages/db/src/client.ts)).

- **Safe for the transaction pooler by default.** node-postgres sends unnamed statements unless a query has a
  `name`, and Drizzle only names one for `.prepare(name)`, which we don't use. postgres.js would need
  `prepare: false` on every client.
- **One driver for API and worker.** The worker uses pg-boss ([06-deployment](../plan/06-deployment.md#supabase)),
  which is built on `pg`: one pool configuration and one set of type parsers.
- **Maturity.** postgres.js 4.0 (2026-10-29) rewrote its pool, protocol and socket layer and changed how parameter
  types are chosen (`infer: false`). Drizzle 0.45.4 predates it, and the 3.x line is now the previous major.
  node-postgres is slower in micro-benchmarks, which doesn't matter at our scale.

### Drizzle and the migration flow

`drizzle-orm` 0.45.4 and `drizzle-kit` 0.31.11, the latest stable releases. 1.0 is at `rc.6`; revisit when it ships.
Neither brings TypeScript < 7 (`pnpm audit:ts` passes). drizzle-kit loads the schema with esbuild.

- drizzle-kit only **generates** SQL into `supabase/migrations` (`migrations.prefix: 'supabase'`, `.mjs` config).
  The Supabase CLI applies it: `supabase db reset` locally, `supabase db push` in deploys. `drizzle-kit push` and
  `migrate` are never used.
- Roles, grants, policies, functions and triggers are **hand-written SQL** in custom migrations
  (`drizzle-kit generate --custom`, so they sit in drizzle-kit's journal and later migrations sort after them).
  Drizzle's own RLS/role DSL is not used: the policies depend on our roles and helper function, and drizzle-kit's
  role management would have to coexist with Supabase's built-in roles. Policies are easier to review as SQL.
- The flow is documented in [`packages/db/README.md`](../../packages/db/README.md#migration-flow).

### Schema `app`, invisible to the Data API

All API tables live in schema `app`. It isn't in `[api].schemas` (`supabase/config.toml`), and nothing in it is
granted to `public`, `anon`, `authenticated` or `service_role`. PostgREST answers `406 PGRST106` for it, and
pg_graphql can't reflect it. `auto_expose_new_tables = false` also keeps tables created in `public` unreachable
without an explicit grant.

### Roles

| Role | Login | Purpose |
| --- | --- | --- |
| `postgres` | yes (Supabase) | Migration role. Applies migrations and hands every object in `app` to `enduva_owner`. Member of it (`inherit`, `set`) |
| `enduva_owner` | no | Owns all tables and functions in `app`. RLS is **forced**, so it applies to the owner too |
| `enduva_api` | no | Privileges of the request path. No `BYPASSRLS`, owns nothing |
| `enduva_worker` | no | Privileges of jobs. No `BYPASSRLS`, owns nothing |
| `enduva_api_login` | yes | The API's login. `NOINHERIT`, member of `enduva_api` with `set` only: without `set local role` it can't read any table, so a query outside `withUserTx` fails instead of running unscoped |
| `enduva_worker_login` | yes | The worker's login, same pattern with `enduva_worker`. Neither login can switch to the other's role |

`service_role` is never used by the API or the worker. Login roles get no password in migrations. Locally
`supabase/seed.sql` sets development passwords; hosted environments set theirs out of band (0.12b). The
**catalog-writer** role for global catalogs (architecture) is added with the first catalog table.

### Identity: transaction-local claims

[`withUserTx(db, claims, fn)`](../../packages/db/src/identity.ts) runs `fn` in one transaction whose first statement
is

```sql
select set_config('request.jwt.claims', $1, true), set_config('role', 'enduva_api', true)
```

(`set_config('role', …, true)` is `set local role`.) `withWorkerTx(db, userId, fn)` does the same with
`enduva_worker` and `{ sub: userId }`. Both reject a `sub` that isn't a UUID, and `withUserTx` rejects claims whose
`role` isn't `authenticated`. The claims must come from a token the API verified against the JWKS (0.8).

Policies read the identity through `app.current_user_id()`, which returns the claims' `sub` as a UUID or NULL. This
is the convention for every user-owned table ([`03-domain-model.md`](../plan/03-domain-model.md)). We don't use
Supabase's `auth.uid()`: that would need grants on Supabase's `auth` schema, and it also accepts the legacy
`request.jwt.claim.sub` setting. With no claims, policies match no row. A `sub` that isn't a UUID fails the cast and
with it the query.

### RLS decides whose rows, grants decide which operations

Every table has an `own_rows` policy `for all to enduva_api, enduva_worker`, with `using` and `with check`
`user_id = (select app.current_user_id())`. The sub-select makes Postgres evaluate the function once per statement.

Grants are column-level and least-privilege. INSERT grants list only the columns a caller supplies, so `id`,
`version`, `granted_at` and the timestamps always start at their defaults, and no row can be inserted already
revoked.

| Table | `enduva_api` | `enduva_worker` |
| --- | --- | --- |
| `profiles` | select; insert and update of the user-editable columns (+ `user_id` on insert) | select; update of the user-editable columns; delete (account deletion) |
| `user_settings` | select; insert and update of the settings columns (+ `user_id` on insert) | select; update of the settings columns |
| `entitlements` | select | select; insert; update of `tier`, `valid_from`, `valid_until` |
| `consents` | select; insert of `purpose`, `consent_version` (+ `user_id`); update of `revoked_at` | select; update of `revoked_at` |
| `devices` | select; insert of `kind`, `name`, `auth_session_id`, `last_seen_at` (+ `user_id`); update of `name`, `last_seen_at`, `revoked_at` | select; update of `last_seen_at`, `revoked_at` |

- **`role` is in no grant.** Profiles start as `user`; only an operator (the migration role) makes an admin.
  `role` and entitlements are authorisation inputs (architecture → Authentication), so the request path can write
  neither. Entitlement changes from store notifications are worker jobs.
- **Revocation is one-way, for every role.** A trigger (`app.keep_revocation`) stamps `revoked_at` with the
  transaction time when a consent or device is revoked and rejects any later change to it (`23514`). A stale or
  replayed write can't make withdrawn consent or a revoked device active again. Granting consent again inserts a new
  row.
- **History stays until the account goes.** Neither role may delete consents or devices. The worker deletes an
  account by deleting its profile, and the foreign-key cascade removes every account row with it.
- The API deletes nothing and can never change `user_id`, `role`, `version` or timestamps. Triggers maintain
  `updated_at` and bump `version`.
- Functions in `app` are created as `enduva_owner`, whose global default privileges grant EXECUTE to nobody else. A
  schema-scoped `ALTER DEFAULT PRIVILEGES` can't revoke PostgreSQL's global default of EXECUTE for PUBLIC, so the
  default is changed for that role. Each function also revokes PUBLIC explicitly.

### Tables and sync columns

`profiles`, `user_settings`, `entitlements`, `consents` and `devices`, as in the domain model. Two deliberate
differences:

- **`consents` instead of `ai_consents`**, as the roadmap names it: purpose-specific (`health_data`,
  `ai_nutrition`, `ai_coach`; architecture → AI), with `consent_version`, `granted_at` and `revoked_at`. At most one
  active consent per user and purpose. Revoking sets `revoked_at`, and granting again inserts a new row, so the
  history stays (see above: revocation is one-way).
- **Sync columns:** `profiles` and `user_settings` get `version` for `ETag`/`If-Match`. `change_seq` and
  `deleted_at` are **deferred to 1.0a**: these tables are served by `/me`, not by the offline sync. `change_seq`
  needs `sync_state`, which 1.0a introduces. Account data is hard-deleted on account deletion (GDPR), not
  tombstoned. `devices` and `consents` keep their history through `revoked_at`. If 1.0a syncs one of these tables,
  it adds the columns in a migration.

### Asymmetric JWT keys locally

`supabase/config.toml` points `signing_keys_path` at `supabase/signing_keys.json`. That file holds one ES256 key,
generated by `pnpm --filter @enduva/db db:keys` (also part of `db:start`) and gitignored. Local access tokens are
ES256-signed, and the JWKS endpoint serves the public key, as on hosted projects.

## Findings (local Supabase CLI 3.2.0, Postgres 17.12, Supavisor 2.10.1)

- **The pooler accepts custom login roles.** The CLI runs Supavisor in transaction mode on port 54329, with tenant
  `pooler-dev`. User names are `<role>.pooler-dev`, and passwords are checked through `pgbouncer.get_auth`, which
  accepts any login role with a password. `enduva_api_login.pooler-dev` therefore works without further
  configuration. Hosted projects use `<role>.<project-ref>`. This is **unverified** until 0.12b/0.12c connect with
  the real login roles.
- **Nothing leaks across transactions.** After `withUserTx` or `withWorkerTx` commits or rolls back, the **same
  Postgres backend** shows the login role as `current_user` and no claims, directly and through the pooler.
  Supavisor may give successive transactions different backends, so the test records `pg_backend_pid()` inside the
  transaction and probes until a statement reports that pid. A control shows that session-level state set with
  `set_config(…, false)` is visible to the same probe.
- After a custom setting has been set once in a session, `current_setting(name, true)` returns `''`, not NULL, so
  `app.current_user_id()` treats `''` as unset.
- **Named prepared statements:** 200 executions of one named statement from 8 concurrent clients through the local
  Supavisor succeeded. We still don't rely on them: other poolers (PgBouncer, other Supavisor versions) differ.
- On Supabase, `postgres` isn't a superuser. It can't re-assert attributes such as `nosuperuser` on existing roles
  (the catalog test checks them instead), and on Postgres 16+ it holds `ADMIN OPTION` on every role it creates.
- A `GRANT` by a role without grant options is a warning and grants nothing, not an error.
- pg_graphql is disabled on the local stack. The GraphQL test accepts that, or no `app` types.

## Tests

`pnpm --filter @enduva/db test:integration` runs against the running local stack (it reads URLs and keys from
`supabase status`):

- **Cross-tenant suite:** acting as user A against user B and vice versa, as `enduva_api` and `enduva_worker`,
  through the pooler **and** directly. For every account table, reading, updating, deleting and inserting the
  other user's rows, and handing an own row to them, return nothing or are denied with `42501`. Inserts use rows
  that are valid for their owner: for `profiles` and `user_settings` a fixture user without that row (C has no
  profile, D no settings). Joins and aggregates see one user only. Controls run the same statements on the actor's
  own rows: they work where the role's grants allow them and are denied where they don't. Any error other than
  `42501` fails the test.
- **Account rules:** revoking a consent or device is stamped by the database and can't be cleared or moved (both
  roles), and granting consent again adds a row. Neither role can set `role`, `version` or timestamps, the API
  can't write entitlements, the worker can't create profiles or delete consent or device history, and deleting a
  profile removes every account row.
- **Escape attempts:** with no claims, claims without `sub` or an empty `sub`, both roles read nothing and every
  insert, update and (worker) delete they are allowed is denied or touches nothing, while the same statement works
  with the owner's identity. No `set role` → no privileges; `row_security = off`, `set role` to
  `postgres`/`service_role`/`authenticated`/…, disabling RLS, dropping policies and changing owners are denied.
  Nothing of the identity stays on the backend (see Findings).
- **Catalog:** role attributes and memberships; every table in `app` is owned by `enduva_owner` with RLS enabled,
  forced and a policy, so tables added later are covered; no table, column, function or schema privilege for
  `public`, `anon`, `authenticated` or `service_role`; a snapshot of every runtime-role grant, column by column; no
  runtime role may write `role`, ids, versions or timestamps; only the worker deletes, and only profiles; the
  revocation trigger is in place; new functions of `enduva_owner` get no EXECUTE for PUBLIC.
- **Data API and JWKS:** PostgREST rejects schema `app` for the publishable key and a user token. Seeded users sign
  in, their ES256 tokens verify against the JWKS (`ES256` only, exact `iss`, `aud = authenticated`), and the verified
  claims drive `withUserTx` through the pooler.

Deliberately weakening the setup makes the suite (462 tests) fail: an extra `using (true)` policy on `devices` alone
fails 64 tests, and that policy together with `BYPASSRLS` on `enduva_api` and a grant on `app` to `authenticated`
fails 157. Dropping the revocation trigger fails 9, and table-wide INSERT and UPDATE on `profiles` for the worker
fail 16.

### CI (0.5)

The suite needs Docker and the Supabase CLI on the runner: the pinned `supabase/setup-cli` action, then
`pnpm --filter @enduva/db db:start` (it generates the key), `db:reset` and `test:integration`. `supabase start -x`
can skip services the suite doesn't use (Studio, Realtime, Storage, edge runtime, analytics, mail) to save time.
0.12b runs the same suite in its isolated bootstrap check.

## Consequences

- 0.8a builds request handling on `createDatabase` (transaction-pooler URL, `enduva_api_login`) and `withUserTx`.
  It also verifies tokens against the JWKS, and the per-request session/device check runs inside the same
  transaction.
- The worker (0.12c) connects as `enduva_worker_login` through the session pooler and wraps every job in
  `withWorkerTx`.
- 0.12b sets the login roles' passwords in the hosted projects and confirms the pooler user names there.
- Every new table follows the checklist in the package README: owned by `enduva_owner`, RLS forced, an `own_rows`
  policy and explicit grants. The catalog test fails otherwise.
- `docs/plan/03-domain-model.md` now names `consents` instead of `ai_consents`.
