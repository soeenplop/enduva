# @enduva/db

Drizzle schema, the database client and the transaction-local identity helpers. Roles, grants and row-level
security are hand-written SQL in [`supabase/migrations`](../../supabase/migrations); the reasoning is in
[ADR-0002](../../docs/adr/0002-db-access-and-rls.md).

## Local database

Needs Docker and the Supabase CLI (v3). Everything runs locally: these scripts never link to or touch a hosted
Supabase project.

```sh
pnpm --filter @enduva/db db:start   # creates supabase/signing_keys.json (ES256, gitignored) once, then `supabase start`
pnpm --filter @enduva/db db:reset   # drops the local database, applies supabase/migrations, runs supabase/seed.sql
pnpm --filter @enduva/db db:stop
```

| What | Local value |
| --- | --- |
| Direct Postgres | `127.0.0.1:54322` |
| Supavisor (transaction mode) | `127.0.0.1:54329`, user name `<role>.pooler-dev` |
| API login | `enduva_api_login` / `enduva-local-api` (set by `seed.sql`) |
| Worker login | `enduva_worker_login` / `enduva-local-worker` (set by `seed.sql`) |
| Synthetic users | `athlete.a@example.com` / `enduva-local-a`, `athlete.b@example.com` / `enduva-local-b` (full accounts); `athlete.c@…` / `enduva-local-c` (no profile yet), `athlete.d@…` / `enduva-local-d` (profile only) |

These passwords are local development values, like the CLI's own `postgres`/`postgres`. Hosted environments set
their own out of band (task 0.12b); migrations never contain a password.

Auth signs access tokens with the local ES256 key, and its JWKS is at
`http://127.0.0.1:54321/auth/v1/.well-known/jwks.json`, so the API's JWKS verification works locally as it does on
hosted projects.

## Tests

```sh
pnpm --filter @enduva/db test               # unit tests, no database
pnpm --filter @enduva/db test:integration   # against the running local stack, after db:reset
```

The integration suite reads URLs and keys from `supabase status`. It covers the cross-tenant matrix (every
account table, API and worker role, through Supavisor and directly), the account rules (one-way revocation,
operator-only `role`), escape attempts, the role and grant catalog,
and the Data API and JWKS path ([ADR-0002 → Tests](../../docs/adr/0002-db-access-and-rls.md#tests)). Every write is
rolled back, so the seed stays intact.

## Migration flow

All migrations live in [`supabase/migrations`](../../supabase/migrations) and are applied by the Supabase CLI:
`supabase db reset` locally, `supabase db push` in deploys (0.12). drizzle-kit only **generates** SQL. Never run
`drizzle-kit push` or `drizzle-kit migrate`.

1. **Tables:** change the schema in [`src/schema`](src/schema), then run `pnpm --filter @enduva/db db:generate --name=<what>`.
   drizzle-kit diffs the schema against its last snapshot (`supabase/migrations/meta`) and writes
   `<timestamp>_<what>.sql` (`migrations.prefix: 'supabase'`, so the CLI's naming).
2. **Roles, grants, RLS policies, functions, triggers:** hand-written SQL. Create the file with
   `pnpm --filter @enduva/db db:custom --name=<what>` so it takes its place in drizzle-kit's journal and the next
   generated migration sorts after it, then write the SQL.
3. Run `pnpm --filter @enduva/db db:reset` and the integration suite.
4. Commit the SQL **and** `supabase/migrations/meta`. Never edit a migration that has been merged; add a new one.

Every new table in `app` needs, in a hand-written migration: `owner to enduva_owner`, `enable` + `force row level
security`, an `own_rows` policy on `user_id = (select app.current_user_id())` for `enduva_api, enduva_worker`, and
explicit, column-level grants. INSERT grants list only the columns a caller supplies, so `id`, `version` and
timestamps always start at their defaults. Nothing in `app` is ever granted to `anon`, `authenticated` or
`service_role`. Create functions between `set role enduva_owner;` and `reset role;`, so they get enduva_owner's
default privileges (no EXECUTE for PUBLIC), and still `revoke all … from public` on each.

`pnpm --filter @enduva/db db:generate` printing "No schema changes" means the schema and the migrations agree.

## Querying

```ts
import { createDatabase, profiles, withUserTx } from '@enduva/db';

const db = createDatabase({ connectionString: process.env.DATABASE_URL! }); // transaction pooler URL

// `claims` must come from a token verified against the Supabase JWKS (0.8).
const mine = await withUserTx(db, claims, (tx) => tx.select().from(profiles));
```

- `withUserTx(db, claims, fn)` (API) and `withWorkerTx(db, userId, fn)` (jobs) open one transaction, set
  `request.jwt.claims` and the role **transaction-locally**, and run `fn` in it. Row-level security limits every
  query in `fn` to that user. Outside them, the login roles can't read any table.
- Both run on a client checked out for exactly the transaction (`leasedTransaction`): it always goes back to the
  pool, even if `BEGIN` fails, has an `error` listener for the whole lease, so a lost connection fails the
  transaction rather than the process, and is destroyed unless the transaction committed or rolled back cleanly.
  Drizzle's own pool transaction does neither.
- Don't call `.prepare('name')` on Drizzle queries: named prepared statements are what a transaction pooler can't
  be relied on to keep (ADR-0002).
