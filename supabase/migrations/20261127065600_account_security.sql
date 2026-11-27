-- Ownership, grants, row-level security and triggers for the account tables (ADR-0002). Hand-written.
--
-- Rules for every table in `app` (checked by packages/db/test/integration/catalog.test.ts):
--   * owned by enduva_owner, RLS enabled and forced;
--   * RLS decides *whose* rows (user_id = app.current_user_id()), GRANTs decide *which operations*;
--   * nothing is granted to public, anon, authenticated or service_role.

-- Schema --------------------------------------------------------------------------------------------------------

revoke all on schema app from public, anon, authenticated, service_role;
grant usage, create on schema app to enduva_owner;
grant usage on schema app to enduva_api, enduva_worker;

-- Functions in `app` are created as enduva_owner. PostgreSQL grants EXECUTE on every new function to PUBLIC by
-- default, and a schema-scoped ALTER DEFAULT PRIVILEGES can't take away a global default, so the default is changed
-- for enduva_owner globally. enduva_owner creates nothing outside `app`. Each function still revokes PUBLIC
-- explicitly, in case it was created by another role.
alter default privileges for role enduva_owner revoke execute on functions from public;

set role enduva_owner;

-- Identity --------------------------------------------------------------------------------------------------------

-- The user a transaction acts for: the `sub` of the verified JWT claims that withUserTx/withWorkerTx set with
-- `set_config('request.jwt.claims', …, true)`. NULL when unset, so policies then match no row. A `sub` that
-- isn't a UUID fails the cast and with it the query.
create function app.current_user_id() returns uuid
  language sql
  stable
  set search_path = ''
  as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;

revoke all on function app.current_user_id() from public;
grant execute on function app.current_user_id() to enduva_api, enduva_worker;

-- Triggers --------------------------------------------------------------------------------------------------------

create function app.set_updated_at() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create function app.bump_version() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  new.version := old.version + 1;
  return new;
end
$$;

revoke all on function app.set_updated_at() from public;
revoke all on function app.bump_version() from public;

reset role;

create trigger set_updated_at before update on app.profiles for each row execute function app.set_updated_at();
create trigger bump_version before update on app.profiles for each row execute function app.bump_version();
create trigger set_updated_at before update on app.user_settings for each row execute function app.set_updated_at();
create trigger bump_version before update on app.user_settings for each row execute function app.bump_version();
create trigger set_updated_at before update on app.entitlements for each row execute function app.set_updated_at();
create trigger set_updated_at before update on app.devices for each row execute function app.set_updated_at();

-- Ownership and RLS -----------------------------------------------------------------------------------------------

alter table app.profiles owner to enduva_owner;
alter table app.user_settings owner to enduva_owner;
alter table app.entitlements owner to enduva_owner;
alter table app.consents owner to enduva_owner;
alter table app.devices owner to enduva_owner;

alter table app.profiles enable row level security;
alter table app.profiles force row level security;
alter table app.user_settings enable row level security;
alter table app.user_settings force row level security;
alter table app.entitlements enable row level security;
alter table app.entitlements force row level security;
alter table app.consents enable row level security;
alter table app.consents force row level security;
alter table app.devices enable row level security;
alter table app.devices force row level security;

create policy own_rows on app.profiles for all to enduva_api, enduva_worker
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
create policy own_rows on app.user_settings for all to enduva_api, enduva_worker
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
create policy own_rows on app.entitlements for all to enduva_api, enduva_worker
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
create policy own_rows on app.consents for all to enduva_api, enduva_worker
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));
create policy own_rows on app.devices for all to enduva_api, enduva_worker
  using (user_id = (select app.current_user_id()))
  with check (user_id = (select app.current_user_id()));

-- The API creates a user's profile on their first request (02-architecture → Authentication), always as `user`.
-- Admins are made by an operator, never through the request path.
create policy api_inserts_users_only on app.profiles as restrictive for insert to enduva_api
  with check (role = 'user');

-- Grants ----------------------------------------------------------------------------------------------------------

revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;

-- Request path: reads its own account, edits user-editable columns, never deletes (account deletion and
-- entitlement changes are jobs). `user_id`, `role`, `version` and timestamps aren't user-editable.
grant select on app.profiles, app.user_settings, app.entitlements, app.consents, app.devices to enduva_api;
grant insert on app.profiles, app.user_settings, app.consents, app.devices to enduva_api;
grant update (display_name, avatar_path, birth_date, sex, height_cm, locale, time_zone, onboarding_completed_at)
  on app.profiles to enduva_api;
grant update (theme, week_start, notification_prefs, health_sync) on app.user_settings to enduva_api;
grant update (revoked_at) on app.consents to enduva_api;
grant update (name, last_seen_at, revoked_at) on app.devices to enduva_api;

-- Jobs: full DML, still limited to the job's user by RLS.
grant select, insert, update, delete on app.profiles, app.user_settings, app.entitlements, app.consents, app.devices
  to enduva_worker;
