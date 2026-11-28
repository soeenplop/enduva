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
| Site URL | `https://app.enduva.de` |
| Redirect allow-list | `https://app.enduva.de/auth/callback`, `…/auth/confirm` |
| Email | email + password on, confirmation required, secure email change, password ≥ 8. Phone, anonymous sign-in and manual linking off |
| Email templates | confirmation and magic link from [`supabase/templates`](../../supabase/templates) (de/en), with their subjects |
| Captcha | Turnstile, with the production secret |
| SMTP | Resend: `smtp.resend.com`, port 465, user `resend`, the restricted API key, sender `noreply@enduva.de` (override with `SMTP_ADMIN_EMAIL`) as `Enduva` |
| Google | on only if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, off otherwise |
| Sessions | access tokens 1 h, refresh token rotation, reuse interval 10 s |

Without `--apply` the script only reads: it prints the fields that differ and whether an ES256 key signs
tokens. With `--apply` it sends just those fields, then reads the config again and checks that nothing differs.
Running it again is safe, and when nothing has changed it does nothing.

The ES256 JWT signing key is **checked, not created**. The API verifies ES256 by default (`AUTH_JWT_ALGORITHM`), so
any other key in use (legacy HS256, RS256) means step 4 rotates it in the dashboard.

**Email delivery:** Auth sends mail through Resend (custom SMTP, `smtp.resend.com:465`, user `resend`, sender name
`Enduva`). The password is a Resend API key with sending access only, and the dry run never prints it.

## Prerequisites

- PR #138 (email templates) is merged, and you run the steps from an up-to-date `main` checkout.
- Node 24.
- **Resend is set up** (owner, once):
  1. In Resend, add the sending domain `enduva.de` in region **eu-west-1** (Ireland).
  2. Add the SPF and DKIM DNS records that Resend shows, and wait until the domain is verified.
  3. Create an API key with **sending access only**, restricted to that domain. It becomes
     `RESEND_API_KEY` below.
  4. Separately, list Resend as a processor in the privacy text (owner task, before real users).
- An env file **outside the repo** with the values, for example `~/enduva-bootstrap.env` (`chmod 600`):

  ```sh
  SUPABASE_PROJECT_REF=<project ref>
  SUPABASE_ACCESS_TOKEN=<personal access token>   # create one for this run, revoke it afterwards
  TURNSTILE_SECRET=<production Turnstile secret>
  RESEND_API_KEY=<sending-only Resend API key>
  # SMTP_ADMIN_EMAIL=noreply@enduva.de         # optional, this is the default
  SUPABASE_PUBLISHABLE_KEY=<publishable key>
  SUPABASE_SECRET_KEY=<secret key>
  # Optional, only once the Google OAuth client exists:
  # GOOGLE_CLIENT_ID=<client id>
  # GOOGLE_CLIENT_SECRET=<client secret>
  ```

  **Never put this file in the repo**, and delete it when you're done. The scripts read plain environment
  variables only, so exported variables work as well.

Below, `run` means `node --env-file="$HOME/enduva-bootstrap.env"`, for example `run tools/supabase-auth-bootstrap.mjs`.

> Optional, for 1Password users: keep `op://` references in the env file instead of values, or load them from a
> 1Password Environment, and run `op run --env-file ~/enduva-bootstrap.env [--environment <id>] -- node …` instead.

## Steps

1. **Dry run.** `run tools/supabase-auth-bootstrap.mjs`. Read the list of differing fields. Secrets are shown
   as `<redacted>`, and they may show up as differing on every run because the API doesn't return them in plain
   text.
2. **Apply.** `run tools/supabase-auth-bootstrap.mjs --apply`. It ends with `Auth config: updated.`
3. **Dry run again.** The only fields left should be the secrets, if any. Everything else must be up to date.
4. **JWT signing key.** If the script printed `ACTION NEEDED`, go to the dashboard → Project Settings → JWT Keys.
   Migrate the legacy JWT secret if asked to, create a standby **ES256** key, then **rotate** it in. No user or app
   depends on the old key yet. Run step 1 again: it must print `JWT signing: ES256 key in use.`
5. **Verify the sign-up lock.** `run tools/supabase-auth-bootstrap.mjs --verify`. It must print
   `Sign-up via the Auth API is rejected.` It first reads `/auth/v1/settings` and stops, without sending anything, unless
   that reports `disable_signup: true`. Only then does it send a direct `POST /auth/v1/signup` with the publishable key,
   which must be refused with `signup_disabled`, or with `captcha_failed` because Turnstile runs before the sign-up
   handler. A 429, a 5xx or any other answer fails the check.
6. **Synthetic accounts.** `run tools/synthetic-accounts.mjs create testflight smoke` shows what it would
   create; add `--apply` to create them. This creates
   `synthetic-testflight@example.com` (iOS sign-in, 0.11b) and `synthetic-smoke@example.com` (smoke tests, 0.12c),
   already confirmed. With `--apply` it asks for each password (at least 16 characters, typing hidden) and never
   prints or logs it. Running it again leaves existing accounts unchanged.
7. **Record it.** Comment in #19 with the outputs of steps 3 and 5 (they contain no secrets) and the date. Revoke
   the personal access token and delete `~/enduva-bootstrap.env`.

## Synthetic accounts and cleanup

Until G1.6, production holds synthetic data only (T25). Every account created by
[`tools/synthetic-accounts.mjs`](../../tools/synthetic-accounts.mjs) is `synthetic-<label>@example.com` and is marked
`app_metadata.synthetic = true`. Cleanup deletes only the labels you name, and only accounts that carry the
marker. `testflight` and `smoke` are standing accounts: never name them in a cleanup.

- `run tools/synthetic-accounts.mjs list` lists them.
- `run tools/synthetic-accounts.mjs delete xt-a xt-b` shows what it would delete; add `--apply` to delete them.
  Their app rows go too, because every account table cascades from `auth.users` via `profiles`.
- Before G1.6, the cross-tenant suite may run against production only with such fixtures, and you delete them
  afterwards (0.12c, once the schema exists): `create xt-a xt-b --apply`, run the suite, then
  `delete xt-a xt-b --apply`. After
  G1.6 it runs against staging and in the isolated environment instead.

## After the first gated migration (0.12c, not part of this bootstrap)

The migrations create the login roles `enduva_api_login` and `enduva_worker_login` without a password
([ADR-0002](../adr/0002-db-access-and-rls.md)). Once the first receipt-gated migration has run, set their passwords
in the SQL editor. The steps are in [deploy.md → First deploy](deploy.md#first-deploy).

## Undo

To undo a field, change it back in the dashboard (Authentication → Sign In / Providers, URL Configuration,
Emails), or fix the value in the script and apply again. The sign-up lock stays on until G1 is declared passed
(G1.0).
