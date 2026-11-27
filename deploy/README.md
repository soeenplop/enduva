# Deploy

Container images and the local compose stack (task 0.12a). The Dokploy production stack, deploy script and receipts
follow in 0.12c ([`06-deployment.md`](../docs/plan/06-deployment.md)).

## Images

One multi-stage [`Dockerfile`](Dockerfile), one target per image. The build context is the repository root
([`.dockerignore`](../.dockerignore) keeps it to a clean checkout without installs, build output or `.env` files).

| Target | Image | Runtime | Runs | Health check |
| --- | --- | --- | --- | --- |
| `api` | `ghcr.io/soeenplop/enduva-api` | distroless Node 24, `nonroot` | `node dist/main.js` (API, port 3000); the worker runs `dist/worker.js` from the same image | `GET /v1/health` (liveness) |
| `web` | `ghcr.io/soeenplop/enduva-web` | distroless Node 24, `nonroot` | `node server.mjs` (srvx: SSR + `dist/client`, port 3000) | `GET /healthz` |
| `landing` | `ghcr.io/soeenplop/enduva-landing` | unprivileged nginx (uid 101) | the prerendered `dist/client` ([`landing.nginx.conf`](landing.nginx.conf), port 8080) | `GET /robots.txt` |

- **Build:** a shared `deps` stage installs the workspace exactly as CI does (frozen lockfile, no lifecycle scripts),
  then each target builds only its package and its workspace dependencies with Turbo.
- **No dev dependencies at run time:** the API image gets `pnpm deploy --prod` (production dependencies, workspace
  packages copied in). The web build bundles its SSR dependencies, so its image holds `dist/`, `server.mjs` and srvx
  only; `@tanstack/react-start`'s build-time dependencies (Vite, Babel, Prettier) never reach it. The landing page is
  static and needs no Node at all.
- **Pins:** base images by tag and digest (Renovate updates both), actions by commit SHA.
- **No configuration baked in:** every value comes from the environment at start, so one image runs everywhere.

## CI

[`.github/workflows/images.yml`](../.github/workflows/images.yml): pull requests build all three images without
pushing. A push to `main` builds and pushes them to GHCR, tagged `sha-<commit>`, with provenance and an SBOM attached.
That job is the only one with `packages: write`. The digest is printed in the job summary; deploys reference
`image@sha256:…`, never a tag.

## Local start

Against the **local** Supabase stack only (`pnpm --filter @enduva/db db:start`), never the hosted project:

```sh
docker compose -f deploy/compose.yaml up --build --wait
```

| Service | URL |
| --- | --- |
| `api` | http://127.0.0.1:3000/v1/health, `/v1/health/ready` checks the database |
| `web` | http://127.0.0.1:3001 (`/status` shows the API and database) |
| `landing` | http://127.0.0.1:3002/de/, `/en/` |

- The API reaches the local pooler and Auth through `host.docker.internal` (on Linux via the `host-gateway` entry).
  Its issuer stays `http://127.0.0.1:54321/auth/v1`, the `iss` of local tokens, so `auth-forward` relays that
  loopback port inside the API's network namespace to the host.
- The worker is a stub until 0.12c and exits right away: `docker compose -f deploy/compose.yaml --profile worker up worker`.
- Stop with `docker compose -f deploy/compose.yaml down`.
