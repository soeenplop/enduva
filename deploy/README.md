# Deploy

Container images and the local compose stack (task 0.12a), and the receipt-gated Dokploy production deploy (task
0.12c, [`06-deployment.md`](../docs/plan/06-deployment.md)). Owner setup and the first deploy:
[`docs/runbooks/deploy.md`](../docs/runbooks/deploy.md).

## Images

One multi-stage [`Dockerfile`](Dockerfile), one target per image. The build context is the repository root, cut
down by an allowlist in [`.dockerignore`](../.dockerignore): only the workspace manifests and the packages the
images build from, without installs, build output or generated sources. At any depth, no dotfile or dot-directory
(`.npmrc`, `.env*`, `.envrc*`, `.ssh/`, `.aws/`, `.config/`, …) and no key or credential-named file gets in.
[`tools/check-docker-context.sh`](../tools/check-docker-context.sh) plants such files and checks that none reaches
the context (CI, `image (api)`). No build step needs a credential.

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
- **Pins:** base images by tag and digest (Renovate updates both), actions by commit SHA. In CI also the builder:
  Buildx by release, the BuildKit image and the SBOM scanner by digest.
- **SBOM:** the image attestation comes from the pinned Syft scanner. The web bundle inlines its dependencies, so
  no `package.json` of React, TanStack Start or Seroval is left for a scanner to find: the image carries
  `sbom/web.cdx.json` (CycloneDX: `pnpm sbom --prod`, the web app's production dependency closure from the
  lockfile, plus the build-time packages whose generated or injected code ships, such as the Paraglide runtime
  and Tailwind's CSS; [`apps/web/scripts/sbom.mjs`](../apps/web/scripts/sbom.mjs)), which the scanner merges into
  the attestation.
- **No configuration baked in:** every value comes from the environment at start, so one image runs everywhere.
- **Behind TLS termination** the web server sees the plain-HTTP backend origin (srvx ignores `X-Forwarded-Proto`),
  so server-function calls that rely on TanStack's `Origin` fallback get 403. Trusting forwarded headers from the
  configured ingress only belongs to 0.12c (#136).
- **No query strings in access logs for `/auth/confirm`:** its URL carries an unspent single-use sign-in token
  until the page replaces it (apps/web README, Sign-in). The ingress must not log it ([deploy runbook → Ingress logs](../docs/runbooks/deploy.md#dokploy-compose-service)).

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
- Sign-in on `web` talks to the local Auth through `host.docker.internal`. Export the local publishable key first
  (`export ENDUVA_AUTH_PUBLISHABLE_KEY=$(supabase status -o json | jq -r .PUBLISHABLE_KEY)`); without it only
  signed-out pages work. Mailed links point at the stack's `site_url` (the `vite dev` server).
- The worker connects to the local database directly as `enduva_worker_login` and consumes its `smoke` job at start.
- Stop with `docker compose -f deploy/compose.yaml down`.

## Production stack

- [`compose.production.yaml`](compose.production.yaml): the stack in Dokploy. Dokploy never builds anything and the
  file is never edited there. Images are referenced by digest, every other value comes from the compose's
  Environment in Dokploy, and domains/TLS come from its Domains tab.
- [`scripts/deploy.sh`](scripts/deploy.sh) renders it with `ghcr.io/soeenplop/enduva-<image>@sha256:…` and sends it
  to Dokploy as the compose's raw file, then starts the deploy and waits for its result. Before it changes anything
  it waits until no earlier deployment of the compose is queued or running (`--wait-idle` only waits). It calls the API that the
  Dokploy CLI (v0.30) wraps, using curl. The CLI's own dependencies aren't pinned, and it reads a `.env` file from
  the working directory. `--render-only` prints the rendered file. Tested with a stubbed API in
  [`scripts/deploy.test.sh`](scripts/deploy.test.sh).
- [`scripts/smoke.sh`](scripts/smoke.sh): exactly `200` (no redirects) plus a body marker of the expected service
  for API readiness, the web server and its SSR home page, the landing page, and
  (with a database URL) the worker's `smoke` job completed after the deploy.

## Production deploy (receipt gate)

Schema and application changes reach production only through the pipeline on `main`, never by hand (roadmap
0.12b/0.12c, [`06-deployment.md` → Pipeline](../docs/plan/06-deployment.md#pipeline), runbook
[`deploy.md`](../docs/runbooks/deploy.md)).

- [`images.yml`](../.github/workflows/images.yml) on a push to `main`: publish the images, read the applied
  production history (`baseline`), verify the candidate in isolation (`verify`), then call the deploy job.
- [`scripts/verify-candidate.sh`](scripts/verify-candidate.sh): a fresh local stack with the production history
  replayed, then the candidate's migrations, the cross-tenant suite, the pushed images by digest
  ([`compose.yaml`](compose.yaml) with `API_IMAGE`/`WEB_IMAGE`/`LANDING_IMAGE`) and the smoke tests. Writes the
  production receipt.
- [`.github/workflows/deploy-production.yml`](../.github/workflows/deploy-production.yml): one job under the
  `deploy-production` lock in the `production` environment. It checks the sign-up lock, migrates
  (`db-push.sh`), deploys the same digests (`deploy.sh`) and runs [`scripts/smoke.sh`](scripts/smoke.sh) against
  the public hosts.
- [`scripts/db-push.sh`](scripts/db-push.sh) reads the applied production migration history
  ([`scripts/applied-migrations.sh`](scripts/applied-migrations.sh)), runs the gate and only then pushes the
  checkout's migrations.
- The deploy job writes nothing unless its SHA is still the head of `main`, and waits for earlier Dokploy work on
  the compose before migrating. Merged migrations are immutable:
  [`tools/check-migrations-immutable.sh`](../tools/check-migrations-immutable.sh) fails `supabase-bootstrap` when
  one that is already on `main` changes.
- [`tools/receipt-gate.mjs`](../tools/receipt-gate.mjs) refuses unless there is a **production** receipt that passed,
  for exactly this SHA, with the same image digests and migration files, verified against exactly the applied
  history. A staging receipt, a failed or missing one, or a stale one (production moved on, e.g. migrations
  succeeded but the deploy failed) means no production write: re-verify the SHA in isolation. Its self-test runs
  in `pnpm --filter @enduva/tools test`.
- The `supabase-bootstrap` CI job is the isolated bootstrap check: a fresh local stack applies every migration from
  scratch and the cross-tenant suite runs against it. Its self-tests and `deploy.test.sh` run in
  `pnpm --filter @enduva/tools test`.
