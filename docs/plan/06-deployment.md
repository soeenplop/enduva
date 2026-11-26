# 06 — Deployment & Operations

## Environments

| Env | Landing | Web app | API | Database | Trigger |
| --- | --- | --- | --- | --- | --- |
| **local** | `localhost:5174` | `localhost:5173` | `localhost:3000` | Supabase CLI (`supabase start`, Docker) | `pnpm dev` |
| **staging** | `staging.enduva.soeenplop.dev` | `app-staging.enduva.soeenplop.dev` | `api-staging.enduva.soeenplop.dev` | Supabase Cloud project `enduva-staging` (EU) | Merge to `main` |
| **production** | `enduva.soeenplop.dev` | `app.enduva.soeenplop.dev` | `api.enduva.soeenplop.dev` | Supabase Cloud project `enduva-prod` (EU, Frankfurt) | Release tag + manual approval |

Staging domains are a proposal (O8). Wildcard DNS already points to the Dokploy server. Traefik in Dokploy issues Let's Encrypt certificates per host.

## Docker Compose

`deploy/compose.yaml` defines one stack per environment in Dokploy:

| Service | Image | Command | Notes |
| --- | --- | --- | --- |
| `api` | `ghcr.io/soeenplop/enduva-api:<tag>` | `node dist/main.js` | Port 3000, health check `/v1/health` |
| `worker` | same image as `api` | `node dist/worker.js` | pg-boss consumers. Scale independently |
| `web` | `ghcr.io/soeenplop/enduva-web:<tag>` | `node build` | SvelteKit `adapter-node` |
| `landing` | `ghcr.io/soeenplop/enduva-landing:<tag>` | static server (Caddy/nginx) | Prerendered |

- There is no database in the compose file: Supabase Cloud is used for staging and production.
- Images: multi-stage builds, `pnpm deploy --prod` for minimal node_modules, non-root user, distroless or alpine runtime.
- Labels/domains are configured in Dokploy (via CLI). Env vars come from Dokploy's environment settings.

## Pipeline

```mermaid
flowchart LR
  PR[PR] --> CI[CI: lint · typecheck · test · build]
  CI --> MERGE[merge to main]
  MERGE --> IMG[Build + push images<br/>tag sha-xxxx]
  IMG --> MIG_S[supabase db push → staging]
  MIG_S --> DEP_S[dokploy compose deploy → staging]
  DEP_S --> SMOKE[Smoke tests]
  MERGE --> RP[release-please PR]
  RP -- merged --> TAG[tag vX.Y.Z]
  TAG --> APPROVE{manual approval}
  APPROVE --> MIG_P[supabase db push → prod]
  MIG_P --> DEP_P[dokploy compose deploy → prod]
```

- Deploy commands go through the **Dokploy CLI** (`dokploy compose …`, installed v0.30.x), scripted in `deploy/scripts/deploy.sh` so they run the same way locally and in GitHub Actions. The exact commands are fixed in task 0.12 (`dokploy compose --help`).
- Migrations are **expand/contract** (backwards-compatible), so a deploy never breaks the previous API version during rollout.
- Apple builds: built and signed locally (Xcode 27) or via Xcode Cloud / GitHub macOS runners (decided in 0.11; public repos get free macOS runners). Uploaded to TestFlight with `xcrun altool`/`notarytool` or fastlane.

## Supabase

- **Local:** `supabase start`. Migrations in `supabase/migrations`, seed in `supabase/seed.sql` + TS seed scripts for BLS/exercise data. `supabase db reset` gives a clean state.
- **Cloud:** two projects (staging, prod) in an EU region. Auth configuration (redirect URLs, Google OAuth client, email templates de/en, SMTP via a transactional mail provider) lives in `supabase/config.toml` where possible and is otherwise documented.
- **Connections:** the API uses the transaction pooler for requests. The worker (pg-boss, LISTEN/NOTIFY) uses the session pooler or a direct connection.
- **Storage buckets:** `avatars` (public-read via signed URLs), `activity-files`, `meal-photos` (private, retention policy), `exports` (private, 7-day expiry).
- **Plan:** free tier for staging. Production on Pro once real users exist (backups/PITR, no pausing, 8 GB DB). See O4.

## Secrets & configuration

| Where | What |
| --- | --- |
| 1Password Environments | Local `.env` files (Supabase local keys, OpenAI key, MapTiler key, Google OAuth) mounted per developer |
| GitHub Actions secrets (per environment) | `DOKPLOY_URL`, `DOKPLOY_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, project refs, `GHCR` (via `GITHUB_TOKEN`), Apple signing (later) |
| Dokploy environment | Runtime env for `api`, `worker` and `web` (DB URLs, Supabase URL + publishable key, OpenAI key, Sentry DSN, …) |

- `.env.example` per app documents every variable. The API validates env at boot with Zod and refuses to start if something is missing.
- Gitleaks in CI. The repo is public, so **never** commit real values.

## Observability & operations

- **Logs:** pino JSON → Dokploy log viewer. Request IDs propagated to clients in the `x-request-id` header.
- **Errors:** Sentry (or GlitchTip, O7) for API, worker, web and iOS.
- **Uptime:** health checks in Dokploy plus an external uptime monitor (e.g. Uptime Kuma on Dokploy) for landing, app and API.
- **Backups:** Supabase Pro daily backups (prod), plus a nightly `pg_dump` to S3-compatible storage via a GitHub Actions cron, for the owner's own retention.
- **Runbooks** in `docs/runbooks/`: deploy rollback (redeploy previous tag), restore from backup, rotate keys, AI quota emergency stop (feature flag).
