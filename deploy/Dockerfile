# Images of the deployed services (task 0.12a, deploy/README.md). Build context: the repository root.
#
#   docker build -f deploy/Dockerfile --target api .       API and worker (one image, two entrypoints)
#   docker build -f deploy/Dockerfile --target web .       web app, SSR on Node
#   docker build -f deploy/Dockerfile --target landing .   landing page, static files on nginx
#
# Base images are pinned by digest (Renovate bumps tag and digest together). The build stages use the same Node
# 24 release as the distroless runtime.

# --- Build -----------------------------------------------------------------------------------------------------

FROM node:24.22.3-trixie-slim@sha256:4d00acb4bcc42c454c4eb801526f7ad7f772ea3bd4fd168c5cc2e384abcbb9d4 AS deps
ENV CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo
# pnpm in the exact version of `packageManager`, through Corepack (verifies the npm registry signature).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack install
# Fetch the store from the lockfile alone, so this layer only changes with the lockfile.
RUN pnpm fetch --frozen-lockfile
COPY . .
# As in CI: no lifecycle scripts (every `allowBuilds` entry is false anyway).
RUN pnpm install --frozen-lockfile --offline --ignore-scripts

FROM deps AS api-build
# `pnpm deploy --prod`: the package with its production dependencies only, workspace packages copied in. Not
# offline: it checks the lockfile against the supply-chain policy (minimumReleaseAge), which needs registry metadata.
RUN pnpm turbo run build --filter=@enduva/api \
 && pnpm --filter=@enduva/api deploy --prod /out

FROM deps AS web-build
# The SSR bundle includes its dependencies (apps/web/vite.config.mjs), so the server needs only srvx (no
# dependencies of its own) next to it; `cp -L` resolves pnpm's symlink. The bundled packages leave no
# package.json in the image, so an image scan can't see them: sbom/web.cdx.json lists the web app's production
# dependency closure from the lockfile (a superset of what is bundled), and the SBOM scanner of the image
# attestation reads it from the image as well.
RUN pnpm turbo run build --filter=@enduva/web \
 && mkdir -p /out/node_modules /out/sbom \
 && pnpm --filter=@enduva/web sbom --prod --lockfile-only --sbom-format cyclonedx --sbom-type application \
      > /out/sbom/web.cdx.json \
 && cd apps/web \
 && cp -R package.json server.mjs dist /out/ \
 && cp -RL node_modules/srvx /out/node_modules/srvx

FROM deps AS landing-build
RUN pnpm turbo run build --filter=@enduva/landing

# --- Runtime ---------------------------------------------------------------------------------------------------
# Distroless Node: no shell or package manager, runs as `nonroot` (65532). The app files stay owned by root, so
# the process can't modify them.

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:675c532423b908f9e56f9d60a4e62309b63cd2a3175acb90a46b96f7ee68e121 AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=api-build /out/package.json ./
COPY --from=api-build /out/node_modules ./node_modules
COPY --from=api-build /out/dist ./dist
EXPOSE 3000
# Liveness only (`/v1/health` touches nothing else); the worker overrides or disables it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/v1/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# The worker runs the same image with `dist/worker.js` as its command.
CMD ["--enable-source-maps", "dist/main.js"]

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:675c532423b908f9e56f9d60a4e62309b63cd2a3175acb90a46b96f7ee68e121 AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000
COPY --from=web-build /out/package.json /out/server.mjs ./
COPY --from=web-build /out/node_modules ./node_modules
COPY --from=web-build /out/dist ./dist
COPY --from=web-build /out/sbom ./sbom
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["--enable-source-maps", "server.mjs"]

# The landing page is fully prerendered (T4), so it needs no Node at run time: unprivileged nginx (uid 101, 8080).
FROM nginxinc/nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8bb9437d74a600ec5dbf90c035451c724dc33eac8d3a71078f6f8612c345f6 AS landing
COPY deploy/landing.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=landing-build /repo/apps/landing/dist/client /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/robots.txt"]
