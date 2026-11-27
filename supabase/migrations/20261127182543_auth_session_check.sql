-- Session and account status of the transaction's claims (02-architecture → Authentication, task 0.8b).
-- Hand-written.
--
-- A verified access token outlives sign-out, session revocation and account deletion or banning until it expires,
-- so the API checks on every request, inside the request transaction, that the token's session still exists and its
-- account is active. That lives in Supabase's `auth` schema, which the runtime roles can't read. Only Supabase's own
-- admin roles can grant USAGE on `auth`, so enduva_owner can't be given access; this one function is therefore owned
-- by the migration role (postgres), which can read auth.users and auth.sessions, and runs with its rights
-- (SECURITY DEFINER). It is the only function in `app` not owned by enduva_owner (ADR-0002 → Session check).
--
-- It takes no arguments and answers for the user and session in the claims withUserTx set transaction-locally. The
-- database doesn't verify those claims: the API sets them from a token it verified, but anyone with the API's
-- database login can set any claims (the same trusted-caller boundary as withUserTx, ADR-0002 → Trust boundary). It
-- returns true only if
--   * the user exists, isn't soft-deleted and isn't banned (`banned_until` in the future), and
--   * the claims' `session_id` names an existing session of that user that hasn't reached its `not_after`.
-- Missing or malformed claims return false (fail closed). A `session_id` that isn't a UUID fails the cast, and with
-- it the request.
--
-- Search path: an empty `search_path` still looks up types in the session's temporary schema first, so a caller
-- could shadow `uuid` or `jsonb` with a temporary domain whose check runs inside this function with postgres' rights.
-- Every function on the call path therefore sets `search_path = pg_catalog, pg_temp` (pg_temp last; functions and
-- operators are never looked up there) and schema-qualifies its types, functions and operators (`nullif` is SQL syntax,
-- not a function). The catalog test pins the paths and that temporary types can't shadow these casts.

-- The helper the policies and this function use, redefined with the same safe path (still owned by enduva_owner).
set role enduva_owner;

create or replace function app.current_user_id() returns pg_catalog.uuid
  language sql
  stable
  set search_path = pg_catalog, pg_temp
  as $$
    select nullif(
      nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb
        operator(pg_catalog.->>) 'sub',
      ''
    )::pg_catalog.uuid
  $$;

reset role;

create function app.auth_session_active() returns pg_catalog.bool
  language sql
  stable
  security definer
  set search_path = pg_catalog, pg_temp
  as $$
    select exists (
      select
      from auth.users u
      join auth.sessions s on s.user_id operator(pg_catalog.=) u.id
      where u.id operator(pg_catalog.=) app.current_user_id()
        and s.id operator(pg_catalog.=) (
          nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::pg_catalog.jsonb
            operator(pg_catalog.->>) 'session_id'
        )::pg_catalog.uuid
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until operator(pg_catalog.<=) pg_catalog.now())
        and (s.not_after is null or s.not_after operator(pg_catalog.>) pg_catalog.now())
    )
  $$;

revoke all on function app.auth_session_active() from public;
grant execute on function app.auth_session_active() to enduva_api;
