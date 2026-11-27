-- Local seed, run by `supabase db reset` after the migrations. LOCAL ONLY: never applied to a hosted project.
-- Everything here is synthetic. Passwords are well-known development values, like the CLI's own `postgres`.

-- Login passwords for the API and worker roles (hosted environments set theirs out of band, task 0.12b).
alter role enduva_api_login password 'enduva-local-api';
alter role enduva_worker_login password 'enduva-local-worker';

-- Two synthetic users who sign in with email + password:
--   athlete.a@example.com / enduva-local-a
--   athlete.b@example.com / enduva-local-b
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
values
  (
    '00000000-0000-0000-0000-000000000000', '0000000a-0000-4000-8000-00000000000a', 'authenticated', 'authenticated',
    'athlete.a@example.com', extensions.crypt('enduva-local-a', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '0000000b-0000-4000-8000-00000000000b', 'authenticated', 'authenticated',
    'athlete.b@example.com', extensions.crypt('enduva-local-b', extensions.gen_salt('bf')), now(),
    '{"provider": "email", "providers": ["email"]}', '{}', now(), now(), '', '', '', ''
  );

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), id, id::text, 'email',
  jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), now(), now(), now()
from auth.users
where id in ('0000000a-0000-4000-8000-00000000000a', '0000000b-0000-4000-8000-00000000000b');

-- One row per account table for each user, so the cross-tenant suite has something to (not) find.
insert into app.profiles (user_id, display_name, locale, time_zone)
values
  ('0000000a-0000-4000-8000-00000000000a', 'Athlete A', 'de', 'Europe/Berlin'),
  ('0000000b-0000-4000-8000-00000000000b', 'Athlete B', 'en', 'Europe/London');

insert into app.user_settings (user_id, theme, week_start)
values
  ('0000000a-0000-4000-8000-00000000000a', 'dark', 1),
  ('0000000b-0000-4000-8000-00000000000b', 'light', 7);

insert into app.entitlements (user_id, tier, source)
values
  ('0000000a-0000-4000-8000-00000000000a', 'free', 'manual'),
  ('0000000b-0000-4000-8000-00000000000b', 'premium', 'manual');

insert into app.consents (user_id, purpose, consent_version)
values
  ('0000000a-0000-4000-8000-00000000000a', 'health_data', '2026-11'),
  ('0000000b-0000-4000-8000-00000000000b', 'health_data', '2026-11'),
  ('0000000b-0000-4000-8000-00000000000b', 'ai_nutrition', '2026-11');

insert into app.devices (user_id, kind, name, auth_session_id)
values
  ('0000000a-0000-4000-8000-00000000000a', 'iphone', 'iPhone A', '0000000a-0000-4000-8000-0000000000a1'),
  ('0000000b-0000-4000-8000-00000000000b', 'watch', 'Watch B', '0000000b-0000-4000-8000-0000000000b1');
