-- Session and account status of the transaction's verified token (02-architecture → Authentication, task 0.8b).
-- Hand-written.
--
-- A verified access token outlives sign-out, session revocation and account deletion or banning until it expires,
-- so the API checks on every request, inside the request transaction, that the token's session still exists and its
-- account is active. That lives in Supabase's `auth` schema, which the runtime roles can't read. Only Supabase's own
-- admin roles can grant USAGE on `auth`, so enduva_owner can't be given access; this one function is therefore owned
-- by the migration role (postgres), which can read auth.users and auth.sessions, and runs with its rights
-- (SECURITY DEFINER). It is the only function in `app` not owned by enduva_owner (ADR-0002 → Session check).
--
-- It takes no arguments: the user and session come from the claims withUserTx set transaction-locally, so a caller
-- learns only whether its own identity is still valid. It returns true only if
--   * the user exists, isn't soft-deleted and isn't banned (`banned_until` in the future), and
--   * the token's `session_id` names an existing session of that user that hasn't reached its `not_after`.
-- Missing or malformed claims return false (fail closed). A `session_id` that isn't a UUID fails the cast, and with
-- it the request.

create function app.auth_session_active() returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select exists (
      select
      from auth.users u
      join auth.sessions s on s.user_id = u.id
      where u.id = app.current_user_id()
        and s.id = (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id')::uuid
        and u.deleted_at is null
        and (u.banned_until is null or u.banned_until <= now())
        and (s.not_after is null or s.not_after > now())
    )
  $$;

revoke all on function app.auth_session_active() from public;
grant execute on function app.auth_session_active() to enduva_api;
