# ADR-0001: TypeScript 7 toolchain

- **Status:** Proposed (spike 0.3, issue [#5](https://github.com/soeenplop/enduva/issues/5)). Becomes Accepted when the owner approves this PR.
- **Date:** 2026-11-26
- **Decisions affected:** T1, T2, T3, T4, T15, T17, T18 ([`00-decisions.md`](../plan/00-decisions.md)); [`02-architecture.md` → TypeScript 7 toolchain](../plan/02-architecture.md#typescript-7-toolchain-needs-validation-in-spike-03)

## Context

T1 requires TypeScript 7 (`typescript@7`, native `tsc`) for every TS package and allows no TS 6 fallback and no workarounds. `typescript@7.0.2` ships the Go compiler and **no classic JS compiler API**. Its main export is only `lib/version.cjs`, plus an `unstable/*` IPC API. Every tool that does `import ts from 'typescript'` and calls `ts.factory`, `ts.SyntaxKind`, `ts.createProgram` and so on breaks at runtime. Spike 0.3 checks whether the planned stack works under that constraint. The six acceptance criteria are in the architecture doc.

The spike is a throwaway workspace in [`spikes/ts7-toolchain/`](../../spikes/ts7-toolchain), run by [`.github/workflows/spike-ts7.yml`](../../.github/workflows/spike-ts7.yml).

## Decision

**Adopt the pinned TypeScript 7 stack below for task 0.4.** All six criteria pass in CI with `typescript@7.0.2` as the only TypeScript in the lockfile. Two planned pieces need a different tool than assumed (see [Findings](#findings)):

1. **Web API client: Orval instead of openapi-typescript / hey-api.** Both popular generators call the pre-7 TS JS API and crash under TS 7.
2. **Route-tree generation before `tsc`: `tsr generate` with Start's route-tree footer in `tsr.config.json`.** CI checks that the result is byte-identical to the tree that `vite build` writes.

Neither is a workaround: no TS < 7, no alias, no compatibility shim, and no patched package.

### Pinned candidate stack

| Area | Package | Version | Notes |
| --- | --- | --- | --- |
| Runtime | Node.js | 24 in CI (`engines: >=24`), 26.13.1 locally | Both pass |
| Package manager | pnpm | 12.21.0 | `packageManager` field, as at the root |
| Compiler | `typescript` | **7.0.2** | `tsc -p` for type-checking only (`noEmit`) |
| API | `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `@nestjs/testing` | 12.6.3 | Nest 12 is **ESM-only**. No `@nestjs/cli` |
| API emit | `@swc/core` / `@swc/cli` | 1.16.22 / 0.8.2 | `legacyDecorator`, `decoratorMetadata`, ES modules |
| API runtime deps | `reflect-metadata` / `rxjs` | 0.2.2 / 7.8.2 | |
| Contracts | `zod` / `zod-openapi` | 4.6.7 / 6.0.3 | OpenAPI **3.1.0** via `createDocument` |
| Web client codegen | `orval` | 8.49.0 | `client: 'fetch'` plus a mutator. No `typescript` dependency |
| Web / landing | `@tanstack/react-start` | 1.169.7 | Vite plugin `@tanstack/react-start/plugin/vite` |
| | `@tanstack/react-router` | 1.170.46 | |
| | `@tanstack/router-cli` | 1.168.0 | `tsr generate` (same `router-generator` 1.168.0 as Start) |
| | `@tanstack/react-query` / `@tanstack/react-router-ssr-query` | 5.108.4 / 1.167.3 | `QueryClient` created inside `getRouter()` |
| | `react` / `react-dom` | 19.3.1 | |
| | `vite` / `@vitejs/plugin-react` | 8.4.0 / 6.3.0 | |
| i18n | `@inlang/paraglide-js` / `@inlang/plugin-message-format` | 3.2.2 / 4.6.2 | Plugin loaded from `node_modules`, not from a CDN |
| Lint | `oxlint` / `oxlint-tsgolint` | 1.95.0 / 7.0.2009 | tsgolint is built on typescript-go and targets TS 7 |
| Tests | `vitest` / `unplugin-swc` / `supertest` | 5.1.2 / 2.0.0 / 7.3.2 | |
| DB | `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 | Latest stable. 1.0 is at `rc.6`; decide in 0.7 |
| Types | `@types/node` / `@types/react` / `@types/react-dom` / `@types/express` / `@types/supertest` | 26.6.11 / 19.3.3 / 19.3.0 / 5.0.6 / 7.2.1 | |
| Swift client | `swift-openapi-generator` / `-runtime` / `-urlsession` | 1.14.4 / 1.13.4 / 1.4.0 | `exact:` pins plus a committed `Package.resolved` |
| Swift toolchain | Xcode | 26.6 on `macos-26` CI runner. 27.2 (Swift 6.4.2) locally | `swift-tools-version: 6.0` |

### Workspace layout of the spike

The spike has **its own `pnpm-workspace.yaml` and lockfile**, so it doesn't extend the root workspace. pnpm uses the nearest `pnpm-workspace.yaml`, so the spike is a separate workspace root:

- The root lockfile and the commitlint/lefthook setup stay untouched. `pnpm install --frozen-lockfile` and `commitlint` at the root still pass.
- The spike can be deleted in one step (`spikes/ts7-toolchain` plus the workflow) without editing root files.
- The audit covers both lockfiles, so it also proves that the root toolchain (commitlint) pulls in no TypeScript. The root lockfile has none at all.

Task 0.4 builds the real monorepo at the root and should copy the configs, not the directory.

## Criteria and evidence

All checks run in the `spike-ts7` workflow on PR #97. Commands are run from `spikes/ts7-toolchain`.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Nest controller + service + guard with constructor injection boots and passes an e2e test | **Pass** | [`api/test/activities.e2e.test.ts`](../../spikes/ts7-toolchain/api/test/activities.e2e.test.ts): 401 without a token (guard with an injected `TokenVerifier`), 200 with the contract-valid body (service injected into the controller), query contract applied, 400 on a bad UUID. [`scripts/smoke.mjs`](../../spikes/ts7-toolchain/scripts/smoke.mjs) boots the **SWC production build** with plain `node` and calls the route |
| 2 | `tsc --noEmit` fails on an intentional type error in api, packages, web, landing | **Pass** | [`scripts/negative-tests.mjs`](../../spikes/ts7-toolchain/scripts/negative-tests.mjs) and `*/negative/`: api TS2554 (guard built without its dependency) and TS2345 (unit outside the contract enum), contracts TS2322 (sport outside the enum), web/landing below. Each fixture names its code and `line:col`; the script requires exactly that one diagnostic and fails on any other error, in the fixture or elsewhere |
| 3 | Zod contract → `openapi.json` → Swift client compiles. Web client types come from the same spec | **Pass** | [`contracts/src/openapi.ts`](../../spikes/ts7-toolchain/contracts/src/openapi.ts) → `openapi.json` → Orval (`web/src/api/generated.ts`, used by [`queries.ts`](../../spikes/ts7-toolchain/web/src/api/queries.ts)) and → [`swift-client`](../../spikes/ts7-toolchain/swift-client), built by the `swift-openapi-generator` build plugin on `macos-26` ([`ActivityLoader.swift`](../../spikes/ts7-toolchain/swift-client/Sources/SpikeAPIClient/ActivityLoader.swift) uses the generated `Client`) |
| 4 | Broken prop / route param / search param / loader type / `Link` **in code that consumes the generated route tree** fails CI. Nothing pulls in TS 6 | **Pass** | Web: prop TS2322, `useParams().id` TS2339, `useSearch().unit` TS2551, `Link` search `units: 'kilometers'` TS2322, `useLoaderData().status` TS2339, `Link` to a missing route TS2820, server-function input TS2353 and middleware context TS2551. Landing: prop TS2322, `Link to="/pricing"` TS2322, `useSearch().lang` TS2339, Paraglide message typo TS2551. `routeTree.gen.ts` keeps its `// @ts-nocheck`. `pnpm why typescript` (CI step) shows only 7.0.2 |
| 5 | oxlint type-aware rules run on top of the TS 7 compiler | **Pass** | `oxlint --type-aware --deny-warnings` with `typescript/no-floating-promises`, `no-misused-promises`, `no-unsafe-argument` and others ([`.oxlintrc.json`](../../spikes/ts7-toolchain/.oxlintrc.json)). The negative fixture [`api/negative/lint/floating-promise.ts`](../../spikes/ts7-toolchain/api/negative/lint/floating-promise.ts) must produce exactly one diagnostic: that rule, in that file, at the location in its header. During the spike the rules found real issues (`no-unsafe-argument` on `app.getHttpServer()`, `no-misused-spread` on `HeadersInit`), so type information is really used |
| 6 | Pinned stack. Frozen install, route generation, type-check, **production builds** of api/web/landing pass. The lockfile audit fails on TS < 7, aliases or pre-7 compilers | **Pass** | CI steps: `pnpm install --frozen-lockfile`, `pnpm generate`, `pnpm typecheck`, `pnpm build` (SWC for api/contracts; `vite build` with SSR for web and prerendering for landing). [`scripts/audit-lockfile.mjs`](../../spikes/ts7-toolchain/scripts/audit-lockfile.mjs) runs a self-test first (it must reject TS 5, a TS 6 peer suffix, `npm:typescript@…`, a renamed alias, `@typescript/native-preview`, `ts-morph`, `@nestjs/cli`), then audits the spike and root lockfiles |

Also checked in CI:

- **SSR and the per-request `QueryClient`:** the smoke test renders the web SSR bundle through its `fetch` handler for two concurrent requests (metric vs. imperial). Each response contains only its own data. [`web/test/router.test.ts`](../../spikes/ts7-toolchain/web/test/router.test.ts) asserts that every `getRouter()` creates a new `QueryClient`.
- **Server functions with typed request context:** `createServerFn().middleware([…]).validator(zod)` in [`web/src/api/greeting.ts`](../../spikes/ts7-toolchain/web/src/api/greeting.ts) runs during SSR (smoke test). Wrong input and a wrong context field fail `tsc`.
- **Landing prerender:** [`scripts/check-prerender.mjs`](../../spikes/ts7-toolchain/scripts/check-prerender.mjs) checks that `dist/client/de/index.html` and `en/index.html` exist with `<html lang="de">` / `lang="en"`, the translated copy and a link to the other locale. There is no unprefixed `/` page.
- **drizzle-kit:** `drizzle-kit generate` loads the TS schema with its own esbuild loader and writes `CREATE TABLE "activities"`.
- **Route-tree identity:** the hashes of the two `routeTree.gen.ts` files from `tsr generate` match after `vite build` rewrote them.

## Findings

### Blocked tools (not used; not blockers for the stack)

| Tool | Version | Failure under TS 7 | Upstream state |
| --- | --- | --- | --- |
| `openapi-typescript` | 7.13.0 (peer `typescript ^5.x`) | `TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')` at `dist/lib/ts.mjs:11` (`ts.factory`) | Prints types with the TS compiler API. `latest` is 7.13.0; the `next` tag (7.0.0-rc.1) was not tested |
| `@hey-api/openapi-ts` | 0.99.0 (peer `typescript >=5.5.3 ‖ >=6`, satisfied by 7.0.2) | `TypeError: Cannot read properties of undefined (reading 'AnyKeyword')` (`ts.SyntaxKind`) | Its peer range admits TS 7, but the runtime needs the pre-7 API |
| `swagger-typescript-api` 13.15.0, `oazapfts` 7.5.0, `openapi-zod-client` 1.18.3 (via `tanu`) | — | Not run: they declare `typescript` ^6.0.3 / ^5.9.3, or pull it in via `tanu` | Would fail the lockfile audit |

**Orval 8.49.0** and **typed-openapi 4.1.0** print code themselves, have no `typescript` dependency and work. Orval was chosen because it is widely used, supports a custom fetch mutator and can also generate TanStack Query options. Only valibot's *optional* `typescript` peer (via Orval and Paraglide) resolves, to 7.0.2.

### Pitfalls found and how the spike handles them

1. **TanStack Start's route-tree footer.** Start's Vite plugin appends a `declare module '@tanstack/react-start' { interface Register { ssr: true; router: … } }` block to `routeTree.gen.ts`. Plain `tsr generate` doesn't. Without the block, `tsc` would check a different tree than the one the build uses. Fix: the router generator's documented `routeTreeFileFooter` option in `tsr.config.json` (one string, because each array entry gets a blank line). CI compares hashes before and after `vite build`. **0.4/0.9a:** keep the footer in sync when a `src/start.ts` is added (Start then also adds `config: …`). The identity check catches drift.
2. **Orval's react-query output vs. `exactOptionalPropertyTypes`.** Passing Orval's generated suspense query options to `queryClient.ensureQueryData` fails with TS2379 (`queryFn` may be `undefined`). This is a library typing mismatch under our strict flags, not a TS 7 issue. It couldn't be cross-checked on TS 6, which is not allowed. The spike uses Orval's plain fetch client with hand-written `queryOptions` (the TanStack-recommended pattern) and keeps `exactOptionalPropertyTypes`.
3. **Paraglide plugin loading.** The default `settings.json` from `paraglide-js init` loads plugins from jsDelivr at compile time. The spike pins `@inlang/plugin-message-format@4.6.2` as a devDependency and references it from `node_modules`. The path resolves relative to the **working directory**, not to `project.inlang`. A missing plugin is only a **warning** and yields empty messages, so the message test and the prerender check guard against that.
4. **Paraglide CLI vs. URL patterns.** `paraglide-js compile` has no `urlPatterns` flag. A shared [`paraglide.options.mjs`](../../spikes/ts7-toolchain/landing/paraglide.options.mjs) feeds both `compile()` (before `tsc`) and the Vite plugin. `outputStructure: 'message-modules'` makes the plugin write the same on-disk files that `tsc` sees, instead of virtual modules. Paraglide emits its `.d.ts` without TypeScript.
5. **`verbatimModuleSyntax`.** TanStack Start's docs advise against it because it can leak server code into client bundles. It is on in the base config and off in web/landing.
6. **Decorator metadata in tests.** Vite 8's oxc transform also emits decorator metadata (the e2e test passes without SWC). The spike still runs Vitest through `unplugin-swc`, so tests and the production build use the same emitter.
7. **Nest 12 is ESM-only.** API and contracts are `"type": "module"` with `module: nodenext`. SWC emits ES modules, and `main.ts` uses top-level `await`.

### Not covered by this spike (owned by later tasks)

- The web app's Node server preset (0.12a). The smoke test calls the SSR bundle's `fetch` handler directly.
- The OpenAPI drift check in CI and committing `openapi.json` (0.8c). The spike generates it and the client in CI and git-ignores them.
- Turborepo (0.4), Playwright (0.9a), Xcode project and SwiftLint (0.11a). Xcode 27 on CI runners is still in public preview.

## Consequences

- 0.4 can scaffold the monorepo with the stack above. Copy `tsconfig.base.json`, `.swcrc`, `.oxlintrc.json`, `tsr.config.json` (with the footer) and both audit/negative scripts into `packages/config` / CI. Use Node 24 in CI.
- 0.5 should make the lockfile audit and `pnpm why typescript` required checks, and keep `typescript-eslint`, `@nestjs/cli`, `ts-morph` and every `@typescript/native-preview*` on the banned list.
- 0.8c uses **Orval** (fetch client + mutator), not openapi-typescript or hey-api, unless they ship a TS 7-compatible release (re-check on dependency updates; the audit and a codegen step in CI would catch a regression).
- Any new tool that imports `typescript` at runtime has to be checked first. Its peer range is not enough evidence (see hey-api).
- The spike directory and `spike-ts7.yml` are deleted once 0.4 has moved the checks into the real workspace.
