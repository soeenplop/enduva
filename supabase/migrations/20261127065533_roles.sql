-- Database roles for tenant isolation (ADR-0002). Hand-written; drizzle-kit only tracks it in its journal.
--
--   enduva_owner         owns every table and function in the `app` schema. NOLOGIN. Migrations run as
--                        `postgres` (Supabase CLI), which owns the schema and hands every object in it to this role.
--   enduva_api           privileges of the API's request path. NOLOGIN, no BYPASSRLS, owns nothing.
--   enduva_worker        privileges of background jobs. NOLOGIN, no BYPASSRLS, owns nothing.
--   enduva_api_login     login of the API. NOINHERIT: it has no privileges of its own and must
--                        `set local role enduva_api` inside each transaction (withUserTx).
--   enduva_worker_login  login of the worker, same pattern with `enduva_worker` (withWorkerTx).
--
-- Login roles get no password here. Locally supabase/seed.sql sets well-known development passwords; hosted
-- environments set theirs out of band (task 0.12b), never in a migration.
--
-- Roles are cluster-wide and survive a database re-creation, so every statement is idempotent. The migration role
-- isn't a superuser and can't re-assert attributes of an existing role; the catalog test checks them instead.
do $$
begin
  if not exists (select from pg_roles where rolname = 'enduva_owner') then
    create role enduva_owner nologin noinherit nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'enduva_api') then
    create role enduva_api nologin noinherit nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'enduva_worker') then
    create role enduva_worker nologin noinherit nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'enduva_api_login') then
    create role enduva_api_login login noinherit nobypassrls;
  end if;
  if not exists (select from pg_roles where rolname = 'enduva_worker_login') then
    create role enduva_worker_login login noinherit nobypassrls;
  end if;
end
$$;

-- The login roles may only switch to their own role, and inherit nothing.
grant enduva_api to enduva_api_login with inherit false, set true;
grant enduva_worker to enduva_worker_login with inherit false, set true;

-- The migration role works as the owner: it creates objects in `app` and hands them over.
grant enduva_owner to postgres with inherit true, set true;
