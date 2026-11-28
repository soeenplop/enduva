# Production deploy

Roadmap 0.12c, single-environment phase (T25). Every push to `main` runs one pipeline
([`images.yml`](../../.github/workflows/images.yml)), one push at a time (`main-pipeline`):

1. **publish**: builds the three images and pushes them to GHCR (private). Each digest is handed on as an artifact.
2. **baseline**: reads the migration history production has applied (read-only).
3. **verify (isolated candidate)**: a fresh Supabase local stack in CI replays exactly that history, applies the
   candidate's remaining migrations and runs the cross-tenant suite. Then it starts the pushed images **by digest**
   and runs the smoke tests, including the worker's queue round trip. Only if all of that passes does it write the
   production receipt ([`verify-candidate.sh`](../../deploy/scripts/verify-candidate.sh)).
4. **deploy (production)** ([`deploy-production.yml`](../../.github/workflows/deploy-production.yml)), under the
   `deploy-production` lock:
   1. checks the sign-up lock;
   2. migrates production, gated by the receipt;
   3. deploys the **same digests** to Dokploy;
   4. runs the smoke tests against the public hosts.

Agents never deploy, migrate or call Dokploy or Supabase by hand. Production changes only through this pipeline.

## What refuses a production write

- No receipt (the verifier failed or didn't run): the deploy job doesn't start.
- A receipt for another SHA, other digests, another migration set, or one verified against a different production
  history ([`receipt-gate.mjs`](../../tools/receipt-gate.mjs)): the job stops before `supabase db push`.
- Sign-up is not locked on production: the job stops before any write.
- Production has applied a migration that the candidate doesn't contain: the verifier refuses.

**Re-runs:** if a deploy fails after its migrations went through, production's history has moved on and the old
receipt is stale. "Re-run failed jobs" is then refused by the gate. Use **"Re-run all jobs"** (or push again): the
verifier checks the same SHA again against the new history and writes a fresh receipt.

## Owner setup (once)

### GitHub: environment `production`

Settings → Environments → **New environment** `production`. Under deployment branches, choose **Selected
branches** and add `main` only. No required reviewers until G1.6.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SUPABASE_DB_URL` | Session pooler URL as `postgres`: `postgresql://postgres.<project-ref>:<database password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres` (Dashboard → Connect → Session pooler). The GitHub runners have no IPv6, so don't use the direct URL |
| Secret | `DOKPLOY_API_KEY` | Dokploy → Profile → API/CLI → generate a key for this pipeline |
| Variable | `DOKPLOY_URL` | Base URL of the Dokploy panel, e.g. `https://<dokploy host>`, without a trailing slash |
| Variable | `DOKPLOY_COMPOSE_ID` | ID of the compose service below (in its URL in Dokploy) |
| Variable | `SUPABASE_PROJECT_REF` | Production project ref |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | Production publishable key (public, used for the sign-up lock check) |

### Dokploy: registry

The images are private. Dokploy pulls them with a registry entry (Settings → Registry), which already exists:

- **Registry URL: `ghcr.io`**. Leave it empty and Dokploy logs in to Docker Hub instead, so every pull fails.
- Username `soeenplop`. The password is a **classic** personal access token with **`read:packages` only**.
- **Renewal:** before the token expires, create a new one with the same scope, put it in the registry entry, use
  **Test** there, then delete the old token on GitHub. When it expires, the next deploy fails while pulling the
  images. Production keeps running the old containers.

### Dokploy: compose service

1. Project `enduva` → **Create service → Compose**, name `production`, type **Docker Compose**, source
   **Raw**. Leave the file empty: the pipeline writes it on every deploy (rendered from
   [`deploy/compose.production.yaml`](../../deploy/compose.production.yaml) with the image digests). Never edit it
   in Dokploy, and leave autodeploy off. Dokploy doesn't build anything.
2. **Environment** tab (values never go into the repo):

   | Variable | Value |
   | --- | --- |
   | `API_DATABASE_URL` | Transaction pooler, port **6543**: `postgresql://enduva_api_login.<project-ref>:<api password>@aws-<n>-<region>.pooler.supabase.com:6543/postgres` |
   | `WORKER_DATABASE_URL` | Session pooler, port **5432**: `postgresql://enduva_worker_login.<project-ref>:<worker password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres` |
   | `AUTH_ISSUER` | `https://<project-ref>.supabase.co/auth/v1` |
   | `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `SUPABASE_PUBLISHABLE_KEY` | Production publishable key |
   | `TRUST_PROXY` | Traefik's address on `dokploy-network` (see below), or empty |

   Fixed in `deploy/compose.production.yaml`, not in Dokploy: `ENDUVA_WEB_ORIGIN=https://app.enduva.de` and the
   production Turnstile site key `ENDUVA_TURNSTILE_SITE_KEY=0x4AAAAAAGXBOONCBWDjvHnR` (public; its secret is set in
   Supabase Auth by the bootstrap).

   Generate both login passwords (32+ random characters) in your password manager now. You set them in the
   database after the first deploy.
3. **Domains** tab, HTTPS on, certificate **Let's Encrypt**:

   | Service | Host | Port |
   | --- | --- | --- |
   | `api` | `api.enduva.de` | 3000 |
   | `web` | `app.enduva.de` | 3000 |
   | `landing` | `enduva.de` | 8080 |

   **DNS** for `enduva.de`: `A` (and `AAAA`, if the server has IPv6) records for `enduva.de`, `www`, `app` and
   `api`, or one wildcard plus the apex, pointing at the Dokploy server. Let's Encrypt can only issue a
   certificate once they resolve. The redirect from `www.enduva.de` to `enduva.de` isn't set up by this stack yet.
   The Dokploy dashboard stays under `soeenplop.dev`.

**`TRUST_PROXY`:** the API honours `X-Forwarded-For` only from these peers (apps/api README, Client IPs). Find
Traefik's address on the server with
`docker inspect dokploy-traefik -f '{{(index .NetworkSettings.Networks "dokploy-network").IPAddress}}'`. Never use
the whole network's subnet. If it's empty, every request appears to come from Traefik, so all clients share one
throttle bucket. That is acceptable while only synthetic accounts exist, but set it before real users arrive.

**Ingress logs:** Traefik's access log must stay off for these hosts, because `/auth/confirm` carries a single-use
token in its query string (deploy README). Check under Dokploy → Web Server → Traefik that the configuration has no
`accessLog` section, or one without query strings.

## First deploy

Prerequisites: the Auth bootstrap is done ([supabase-bootstrap.md](supabase-bootstrap.md)), its sign-up lock check
passed, and the setup above is complete.

1. The first merge to `main` after the setup runs the pipeline. The baseline is empty, so the verifier checks every
   migration from scratch. The deploy job then applies them to production and deploys.
2. The smoke tests of this first run **fail on API readiness**: the login roles exist now, but have no password
   yet. That's expected.
3. In the Supabase SQL editor, set the passwords you put into the Dokploy URLs:
   `alter role enduva_api_login password '<api password>';` and
   `alter role enduva_worker_login password '<worker password>';`
4. Open the failed run and choose **Re-run all jobs**. The verifier checks the same SHA against the history that
   now exists. The gate passes, `db push` has nothing left to apply, and the deploy and smoke tests go green.
5. Comment in #20 with the run link.

## Changing the stack

- Image, port or command changes go through `deploy/compose.production.yaml` in a PR. A new variable also needs its
  value in Dokploy's Environment tab **before** the merge, or the deploy stops on the missing variable.
- Rollback means rolling forward: revert the change on `main`. Migrations are expand/contract, so the previous
  code runs on the newer schema.
