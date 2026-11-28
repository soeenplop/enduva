# Supabase production bootstrap

Roadmap 0.12b. The **owner** runs it once, against the hosted production project. Agents prepare and review it but
never run it. It sets up **Auth only**: no schema, no data apart from synthetic test accounts. The first schema
write to production goes through the receipt-gated deploy job (0.12c, [`deploy/README.md`](../../deploy/README.md)).

## What it changes

[`tools/supabase-auth-bootstrap.mjs`](../../tools/supabase-auth-bootstrap.mjs) holds the desired Auth config. It
mirrors [`supabase/config.toml`](../../supabase/config.toml), but with the production URLs:

| Setting | Value |
| --- | --- |
| Sign-up | **off** (`disable_signup`, G1.0 sign-up lock). Existing users can still sign in |
| Site URL | `https://app.enduva.soeenplop.dev` |
| Redirect allow-list | `https://app.enduva.soeenplop.dev/auth/callback`, `…/auth/confirm` |
| Email | email + password on, confirmation required, secure email change, password ≥ 8. Phone, anonymous sign-in and manual linking off |
| Email templates | confirmation and magic link from [`supabase/templates`](../../supabase/templates) (de/en), with their subjects |
| Captcha | Turnstile, with the production secret |
| Google | on only if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, off otherwise |
| Sessions | access tokens 1 h, refresh token rotation, reuse interval 10 s |

Without `--apply` the script only reads: it prints the fields that differ and whether an ES256 key signs
tokens. With `--apply` it sends just those fields, then reads the config again and checks that nothing differs.
Running it again is safe, and when nothing has changed it does nothing.

The ES256 JWT signing key is **checked, not created**. The API verifies ES256 by default (`AUTH_JWT_ALGORITHM`), so
any other key in use (legacy HS256, RS256) means step 4 rotates it in the dashboard.

**Email delivery:** custom SMTP (an EU transactional mail provider, chosen by the owner) is configured separately,
before real users. Until then the hosted default sender applies, which is heavily rate-limited. Supabase may also
refuse custom email templates without custom SMTP. If `--apply` is refused because of the `mailer_*` fields, run it
with `SKIP_EMAIL_TEMPLATES=1` (everything else, including the sign-up lock, still applies), note it in #19, and
apply again without it once SMTP is set up.

## Prerequisites

- PR #138 (email templates) is merged, and you run the steps from an up-to-date `main` checkout.
- Node 24 and the 1Password CLI (`op`).
- An env file **outside the repo**, never the repo's `.env`. It holds only 1Password references, for example
  `~/enduva-bootstrap.env`:

  ```sh
  SUPABASE_PROJECT_REF=op://<vault>/<item>/project-ref
  SUPABASE_ACCESS_TOKEN=op://<vault>/<item>/management-token   # personal access token, revoke it afterwards
  TURNSTILE_SECRET=op://<vault>/<item>/turnstile-secret
  SUPABASE_PUBLISHABLE_KEY=op://<vault>/<item>/publishable-key
  SUPABASE_SECRET_KEY=op://<vault>/<item>/secret-key
  # Optional, only once the Google OAuth client exists:
  # GOOGLE_CLIENT_ID=op://<vault>/<item>/google-client-id
  # GOOGLE_CLIENT_SECRET=op://<vault>/<item>/google-client-secret
  ```

Below, `run` means `op run --env-file ~/enduva-bootstrap.env --`.

## Steps

1. **Dry run.** `run node tools/supabase-auth-bootstrap.mjs`. Read the list of differing fields. Secrets are shown
   as `<redacted>`, and they may show up as differing on every run because the API doesn't return them in plain
   text.
2. **Apply.** `run node tools/supabase-auth-bootstrap.mjs --apply`. It ends with `Auth config: updated.`
3. **Dry run again.** The only fields left should be the secrets, if any. Everything else must be up to date.
4. **JWT signing key.** If the script printed `ACTION NEEDED`, go to the dashboard → Project Settings → JWT Keys.
   Migrate the legacy JWT secret if asked to, create a standby **ES256** key, then **rotate** it in. No user or app
   depends on the old key yet. Run step 1 again: it must print `JWT signing: ES256 key in use.`
5. **Verify the sign-up lock.** `run node tools/supabase-auth-bootstrap.mjs --verify`. It must print
   `Sign-up via the Auth API is rejected.` It first reads `/auth/v1/settings` and stops, without sending anything, unless
   that reports `disable_signup: true`. Only then does it send a direct `POST /auth/v1/signup` with the publishable key,
   which must be refused with `signup_disabled`, or with `captcha_failed` because Turnstile runs before the sign-up
   handler. A 429, a 5xx or any other answer fails the check.
6. **Synthetic accounts.** `run node tools/synthetic-accounts.mjs create testflight smoke` shows what it would
   create; add `--apply` to create them. This creates
   `synthetic-testflight@example.com` (iOS sign-in, 0.11b) and `synthetic-smoke@example.com` (smoke tests, 0.12c),
   already confirmed. Store each printed password in 1Password straight away. Running it again leaves existing
   accounts unchanged.
7. **Record it.** Comment in #19 with the outputs of steps 3 and 5 (they contain no secrets) and the date. Revoke
   the personal access token if you created one just for this.

## Synthetic accounts and cleanup

Until G1.6, production holds synthetic data only (T25). Every account created by
[`tools/synthetic-accounts.mjs`](../../tools/synthetic-accounts.mjs) is `synthetic-<label>@example.com` and is marked
`app_metadata.synthetic = true`. Cleanup deletes only the labels you name, and only accounts that carry the
marker. `testflight` and `smoke` are standing accounts: never name them in a cleanup.

- `run node tools/synthetic-accounts.mjs list` lists them.
- `run node tools/synthetic-accounts.mjs delete xt-a xt-b` shows what it would delete; add `--apply` to delete them.
  Their app rows go too, because every account table cascades from `auth.users` via `profiles`.
- Before G1.6, the cross-tenant suite may run against production only with such fixtures, and you delete them
  afterwards (0.12c, once the schema exists): `create xt-a xt-b --apply`, run the suite, then
  `delete xt-a xt-b --apply`. After
  G1.6 it runs against staging and in the isolated environment instead.

## After the first gated migration (0.12c, not part of this bootstrap)

The migrations create the login roles `enduva_api_login` and `enduva_worker_login` without a password
([ADR-0002](../adr/0002-db-access-and-rls.md)). Once the first receipt-gated migration has run, set their passwords
in the SQL editor (`alter role … password '…'`). Generate each password in 1Password and give it to Dokploy as part
of the connection strings.

## Undo

To undo a field, change it back in the dashboard (Authentication → Sign In / Providers, URL Configuration,
Emails), or fix the value in the script and apply again. The sign-up lock stays on until G1 is declared passed
(G1.0).
