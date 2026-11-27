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

-- Revocation is one-way, for every role: once `revoked_at` is set it never changes again, so a stale or replayed
-- write can't make withdrawn consent or a revoked device active again, or move the revocation time. The database
-- stamps the revocation time itself. Granting consent again inserts a new row; the revoked rows stay until the
-- account is deleted (the cascade from `profiles` is the only way they go, see the grants below).
--
-- The stamp is `clock_timestamp()`, the moment the revoking UPDATE runs, not `now()`. `now()` is the start of the
-- revoking transaction, and under READ COMMITTED that transaction can see a row that was granted and committed after
-- it began; stamping `now()` would then put `revoked_at` before `granted_at` and the check constraint would reject a
-- valid revocation. The row was committed before the UPDATE could see it, so `clock_timestamp()` is already later than
-- its start time; `greatest()` with the column named by the trigger argument (`granted_at`, `created_at`) keeps
-- `revoked_at` at or after it even if the wall clock steps back, so a revocation never fails on ordering.
create function app.keep_revocation() returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if old.revoked_at is not null then
    if new.revoked_at is distinct from old.revoked_at then
      raise exception 'A revoked row in %.% stays revoked', tg_table_schema, tg_table_name
        using errcode = 'check_violation', hint = 'Insert a new row instead.';
    end if;
  elsif new.revoked_at is not null then
    new.revoked_at := greatest(clock_timestamp(), (to_jsonb(old) ->> tg_argv[0])::timestamptz);
  end if;
  return new;
end
$$;

revoke all on function app.set_updated_at() from public;
revoke all on function app.bump_version() from public;
revoke all on function app.keep_revocation() from public;

reset role;

create trigger set_updated_at before update on app.profiles for each row execute function app.set_updated_at();
create trigger bump_version before update on app.profiles for each row execute function app.bump_version();
create trigger set_updated_at before update on app.user_settings for each row execute function app.set_updated_at();
create trigger bump_version before update on app.user_settings for each row execute function app.bump_version();
create trigger set_updated_at before update on app.entitlements for each row execute function app.set_updated_at();
create trigger set_updated_at before update on app.devices for each row execute function app.set_updated_at();
create trigger keep_revocation before update on app.consents for each row execute function app.keep_revocation('granted_at');
create trigger keep_revocation before update on app.devices for each row execute function app.keep_revocation('created_at');

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

-- Grants ----------------------------------------------------------------------------------------------------------
--
-- Least privilege, column by column. Server-maintained columns (`id`, `version`, `created_at`, `updated_at`,
-- `granted_at`, `revoked_at` on insert) are never in an INSERT grant, so they always start at their defaults.
-- `role` is in no grant at all: profiles start as `user`, and only an operator makes an admin (02-architecture →
-- Authentication). Nothing but the account-deletion cascade from `profiles` deletes consent or device history.

revoke all on all tables in schema app from public, anon, authenticated, service_role;
revoke all on all functions in schema app from public, anon, authenticated, service_role;

-- Request path: reads its own account, creates its profile, settings, consents and devices, and edits the
-- user-editable columns. It never deletes (account deletion is a job) and never writes entitlements.
grant select on app.profiles, app.user_settings, app.entitlements, app.consents, app.devices to enduva_api;
grant insert (user_id, display_name, avatar_path, birth_date, sex, height_cm, locale, time_zone,
    onboarding_completed_at),
  update (display_name, avatar_path, birth_date, sex, height_cm, locale, time_zone, onboarding_completed_at)
  on app.profiles to enduva_api;
grant insert (user_id, theme, week_start, notification_prefs, health_sync),
  update (theme, week_start, notification_prefs, health_sync)
  on app.user_settings to enduva_api;
grant insert (user_id, purpose, consent_version), update (revoked_at) on app.consents to enduva_api;
grant insert (user_id, kind, name, auth_session_id, last_seen_at), update (name, last_seen_at, revoked_at)
  on app.devices to enduva_api;

-- Jobs: delete accounts (the cascade takes every account table with it), maintain entitlements (store
-- notifications), revoke consents and devices, and edit what the request path may edit. Still limited to the
-- job's user by RLS.
grant select on app.profiles, app.user_settings, app.entitlements, app.consents, app.devices to enduva_worker;
grant update (display_name, avatar_path, birth_date, sex, height_cm, locale, time_zone, onboarding_completed_at),
  delete
  on app.profiles to enduva_worker;
grant update (theme, week_start, notification_prefs, health_sync) on app.user_settings to enduva_worker;
grant insert (user_id, tier, source, external_id, valid_from, valid_until), update (tier, valid_from, valid_until)
  on app.entitlements to enduva_worker;
grant update (revoked_at) on app.consents to enduva_worker;
grant update (last_seen_at, revoked_at) on app.devices to enduva_worker;
