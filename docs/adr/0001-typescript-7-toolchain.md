# ADR-0001: TypeScript 7 toolchain

- **Status:** Accepted (spike 0.3, issue [#5](https://github.com/soeenplop/enduva/issues/5), merged in PR #97 with the owner's T1 ruling). Later changes to TS < 7 exceptions are decided by the lead and reviewed (W13).
- **Date:** 2026-11-26
- **Decisions affected:** T1, T2, T3, T4, T15, T17, T18 ([`00-decisions.md`](../plan/00-decisions.md)); [`02-architecture.md` → TypeScript 7 toolchain](../plan/02-architecture.md#typescript-7-toolchain-needs-validation-in-spike-03)

## Context

T1 requires TypeScript 7 (`typescript@7`, native `tsc`) for every TS package and allows no TS 6 fallback and no workarounds. `typescript@7.0.2` ships the Go compiler and **no classic JS compiler API**. Its main export is only `lib/version.cjs`, plus an `unstable/*` IPC API. Every tool that does `import ts from 'typescript'` and calls `ts.factory`, `ts.SyntaxKind`, `ts.createProgram` and so on breaks at runtime. Spike 0.3 checks whether the planned stack works under that constraint. The six acceptance criteria are in the architecture doc.

The spike is a throwaway workspace in [`spikes/ts7-toolchain/`](../../spikes/ts7-toolchain), run by [`.github/workflows/spike-ts7.yml`](../../.github/workflows/spike-ts7.yml).

## Decision

**Adopt the pinned TypeScript 7 stack below for task 0.4.** All six criteria pass in CI with `typescript@7.0.2` as the only TypeScript package in the lockfile. Two third-party tools bundle TypeScript 6.0 *parser* code for formatting: Prettier 3.10.1 (TS 6.0.3), which TanStack's route generator invokes, and oxfmt, which ships a re-bundled copy of that Prettier parser. The owner's T1 clarification tolerates that only with an explicit, audited allowlist (see [Owner ruling on bundled TypeScript](#owner-ruling-on-bundled-typescript-t1-clarification)). Two planned pieces need a different tool than assumed (see [Findings](#findings)):

1. **Web API client: Orval instead of openapi-typescript / hey-api.** Both popular generators call the pre-7 TS JS API and crash under TS 7.
2. **Route-tree generation before `tsc`: `tsr generate` with Start's route-tree footer in `tsr.config.json`.** CI checks that the result is byte-identical to the tree that `vite build` writes.

Neither is a workaround: no TS < 7, no alias, no compatibility shim, and no patched package.

### Pinned candidate stack

| Area | Package | Version | Notes |
| --- | --- | --- | --- |
| Runtime | Node.js | CI selects major 24 (`engines: >=24`); observed 24.22.3 on both runners. 26.13.1 locally | Both pass |
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
| Format | `oxfmt` | 0.80.0 | Our formatter (`format` / `format:check`, [`.oxfmtrc.json`](../../spikes/ts7-toolchain/.oxfmtrc.json)); our scripts never call Prettier. oxfmt ships a bundled copy of Prettier's TS parser that it does not load for our files, and TanStack's route generator invokes Prettier itself (both allowlisted) |
| Tests | `vitest` / `unplugin-swc` / `supertest` | 5.1.2 / 2.0.0 / 7.3.2 | |
| DB | `drizzle-orm` / `drizzle-kit` | 0.45.4 / 0.31.11 | Latest stable. 1.0 is at `rc.6`; decide in 0.7 |
| Types | `@types/node` / `@types/react` / `@types/react-dom` / `@types/express` / `@types/supertest` | 24.19.2 / 19.3.3 / 19.3.0 / 5.0.6 / 7.2.1 | `@types/node` matches the minimum supported Node major (`engines: >=24`, CI). A workspace `overrides` entry keeps transitive `@types/*` (`@types/node: '*'`) on the same version, so `tsc` cannot accept a Node 26-only API |
| Swift client | `swift-openapi-generator` / `-runtime` / `-urlsession` | 1.14.4 / 1.13.4 / 1.4.0 | `exact:` pins plus a committed `Package.resolved` |
| Swift toolchain | Xcode | The `macos-26` runner's default Xcode, not pinned by the workflow; observed Xcode 26.6 (17F113), Swift 6.3.3, image `macos-26-arm64` 20261117.0516.1. 27.2 (Swift 6.4.2) locally | `swift-tools-version: 6.0`. The Swift job prints the versions it used |

### Workspace layout of the spike

The spike has **its own `pnpm-workspace.yaml` and lockfile**, so it doesn't extend the root workspace. pnpm uses the nearest `pnpm-workspace.yaml`, so the spike is a separate workspace root:

- The root lockfile and the commitlint/lefthook setup stay untouched. `pnpm install --frozen-lockfile` and `commitlint` at the root still pass.
- The spike can be deleted in one step (`spikes/ts7-toolchain` plus the workflow) without editing root files.
- The lockfile audit covers both lockfiles. During the spike the root lockfile contained no TypeScript at all; since 0.4 it contains `typescript` 7.0.2 (see [Handoff in 0.4](#handoff-in-04)).

Task 0.4 builds the real monorepo at the root and should copy the configs, not the directory.

## Criteria and evidence

All checks run in the `spike-ts7` workflow on PR #97. Commands are run from `spikes/ts7-toolchain`.

| # | Criterion | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Nest controller + service + guard with constructor injection boots and passes an e2e test | **Pass** | [`api/test/activities.e2e.test.ts`](../../spikes/ts7-toolchain/api/test/activities.e2e.test.ts): 401 without a token (guard with an injected `TokenVerifier`), 200 with the contract-valid body (service injected into the controller), query contract applied, 400 on a bad UUID. [`scripts/smoke.mjs`](../../spikes/ts7-toolchain/scripts/smoke.mjs) boots the **SWC production build** with plain `node` and calls the route |
| 2 | `tsc --noEmit` fails on an intentional type error in api, packages, web, landing | **Pass** | [`scripts/negative-tests.mjs`](../../spikes/ts7-toolchain/scripts/negative-tests.mjs) and `*/negative/`: api TS2554 (guard built without its dependency) and TS2345 (unit outside the contract enum), contracts TS2322 (sport outside the enum), web/landing below. Each fixture names its code and `line:col`; the script requires exactly that one diagnostic and fails on any other error, in the fixture or elsewhere |
| 3 | Zod contract → `openapi.json` → Swift client compiles. Web client types come from the same spec | **Pass** | [`contracts/src/openapi.ts`](../../spikes/ts7-toolchain/contracts/src/openapi.ts) → `openapi.json` → Orval (`web/src/api/generated.ts`, used by [`queries.ts`](../../spikes/ts7-toolchain/web/src/api/queries.ts)) and → [`swift-client`](../../spikes/ts7-toolchain/swift-client), built by the `swift-openapi-generator` build plugin on `macos-26` ([`ActivityLoader.swift`](../../spikes/ts7-toolchain/swift-client/Sources/SpikeAPIClient/ActivityLoader.swift) uses the generated `Client`) |
| 4 | Broken prop / route param / search param / loader type / `Link` **in code that consumes the generated route tree** fails CI. Nothing pulls in TS 6 | **Pass** | Web: prop TS2322, `useParams().id` TS2339, `useSearch().unit` TS2551, `Link` search `units: 'kilometers'` TS2322, `useLoaderData().status` TS2339, `Link` to a missing route TS2820, server-function input TS2353 and middleware context TS2551. Landing: prop TS2322, `Link to="/pricing"` TS2322, `useSearch().lang` TS2339, Paraglide message typo TS2551. `routeTree.gen.ts` keeps its `// @ts-nocheck`. `pnpm why typescript` (CI step) shows only 7.0.2. No TS 6 compiler is installed; the bundled TS 6.0 parser code is allowlisted and audited (see the owner ruling below) |
| 5 | oxlint type-aware rules run on top of the TS 7 compiler | **Pass** | `oxlint --type-aware --deny-warnings` with `typescript/no-floating-promises`, `no-misused-promises`, `no-unsafe-argument` and others ([`.oxlintrc.json`](../../spikes/ts7-toolchain/.oxlintrc.json)). The negative fixture [`api/negative/lint/floating-promise.ts`](../../spikes/ts7-toolchain/api/negative/lint/floating-promise.ts) must produce exactly one diagnostic: that rule, in that file, at the location in its header. During the spike the rules found real issues (`no-unsafe-argument` on `app.getHttpServer()`, `no-misused-spread` on `HeadersInit`), so type information is really used |
| 6 | Pinned stack. Frozen install, route generation, type-check, **production builds** of api/web/landing pass. The lockfile audit fails on TS < 7, aliases or pre-7 compilers | **Pass** | CI steps: `pnpm install --frozen-lockfile`, `pnpm generate`, `pnpm typecheck`, `pnpm build` (SWC for api/contracts; `vite build` with SSR for web and prerendering for landing), `pnpm format:check`. [`scripts/audit-lockfile.mjs`](../../spikes/ts7-toolchain/scripts/audit-lockfile.mjs) runs a self-test first (it must reject TS 5, a TS 6 peer suffix, `npm:typescript@…`, a renamed alias, `@typescript/native-preview`, `ts-morph`, `@nestjs/cli`, tarball/git/directory resolutions), then audits the spike and root lockfiles. [`scripts/audit-bundled-typescript.mjs`](../../spikes/ts7-toolchain/scripts/audit-bundled-typescript.mjs) then scanned the installed files of both workspaces for bundled compiler code against the allowlist. Since 0.4 each workspace's bundled audit scans only its own install against its own allowlist ([Handoff in 0.4](#handoff-in-04)) |

Also checked in CI:

- **SSR and the per-request `QueryClient`:** the smoke test renders the web SSR bundle through its `fetch` handler for two concurrent requests (metric vs. imperial). Each response contains only its own data. [`scripts/ssr-isolation.mjs`](../../spikes/ts7-toolchain/scripts/ssr-isolation.mjs) then renders the **same** URL (same query key) twice concurrently against a stub backend that answers each call with a different distance. It requires one backend call per request and each page to show its own answer. With the `QueryClient` deliberately hoisted to module scope, the check fails (one backend call for both requests); the distinct-key check above fails too, because dehydration puts the other request's query into the HTML. [`web/test/router.test.ts`](../../spikes/ts7-toolchain/web/test/router.test.ts) asserts that every `getRouter()` creates a new `QueryClient`.
- **Server functions with typed request context:** `createServerFn().middleware([…]).validator(zod)` in [`web/src/api/greeting.ts`](../../spikes/ts7-toolchain/web/src/api/greeting.ts) runs during SSR (smoke test). Wrong input and a wrong context field fail `tsc`.
- **Landing prerender:** [`scripts/check-prerender.mjs`](../../spikes/ts7-toolchain/scripts/check-prerender.mjs) checks that `dist/client/de/index.html` and `en/index.html` exist with `<html lang="de">` / `lang="en"`, the translated copy and a link to the other locale. `lang` is read from the opening `<html>` tag's own attribute. There is no unprefixed `/` page, and the check fails if `dist/client/index.html` exists.
- **drizzle-kit:** `drizzle-kit generate` loads the TS schema with its own esbuild loader and writes `CREATE TABLE "activities"`.
- **Route-tree identity:** the hashes of the two `routeTree.gen.ts` files from `tsr generate` match after `vite build` rewrote them.

## Owner ruling on bundled TypeScript (T1 clarification)

Review of PR #97 found that `@tanstack/router-generator` 1.168.0 hard-depends on **Prettier 3.10.1**, which bundles the **TypeScript 6.0.3** parser (`plugins/typescript.{js,mjs}`, with `createSourceFile` and `typescript-estree`). The generator formats `routeTree.gen.ts` with `parser: 'typescript'`, so route generation runs that code. The lockfile audit could not see it, because no package named `typescript` < 7 is involved.

**Ruling (owner, PR #97):** TypeScript < 7 is forbidden as a compiler, type checker, language service, or for emit/transpilation in our toolchain. TypeScript code that third-party tools bundle purely for parsing or formatting (e.g. Prettier's TypeScript parser used by TanStack's route generator) is tolerated, but only if it is explicitly allowlisted (package, exact version, bundled TS version, where it is used, why it is needed) and monitored by the audit. Our own formatter is **oxfmt**, not Prettier. TanStack stays.

### Allowlist

[`ts-bundled-allowlist.json`](../../spikes/ts7-toolchain/ts-bundled-allowlist.json) has two entries:

| Package | Bundled TS (as detected) | Files (sha256-pinned) | Consumers (pinned) | Used for |
| --- | --- | --- | --- | --- |
| `prettier` 3.10.1 | 6.0.3 | `plugins/typescript.js`, `plugins/typescript.mjs` | `@tanstack/router-generator@1.168.0`, `orval@8.49.0` | The generator (via `router-cli` and the Start Vite plugin) formats the generated route trees. Orval resolves the same copy as its optional `prettier` peer and only uses it with `output.formatter: 'prettier'`, which we don't set |
| `oxfmt` 0.80.0 | 6.0 | `dist/typescript-DQUs9PXr.js` | `workspace:ts7-toolchain-spike` | oxfmt bundles Prettier for the languages it delegates to Prettier and for its Tailwind class sorter. The plugin is lazy-loaded; JS/TS/JSON are formatted natively. With this file removed, `format:check` on the spike still passes, so our check does not load it. Embedded-language formatting is off and Markdown/YAML are not formatted |

The audit reads only `6.0` from the oxfmt chunk (no notice file names the patch version), so the entry records `6.0` and the file digest pins the reviewed bytes. The chunk's `//#region` comment names `prettier@3.10.1/.../plugins/typescript.mjs` as its source, which points to TS 6.0.3, but that is a reviewer's reading, not something CI verifies.

The oxfmt entry was not anticipated by the ruling ("Prettier only enters via TanStack"): the audit found it in the first run. It falls under the same tolerated category (parsing/formatting only) and is allowlisted on the same terms. Prettier's parser could also be kept out of route generation with the generator's `enableRouteTreeFormatting: false`; the spike keeps the default, since the ruling tolerates it and the tree is not linted or formatted by us.

### How the audit works

[`scripts/audit-bundled-typescript.mjs`](../../spikes/ts7-toolchain/scripts/audit-bundled-typescript.mjs) (`pnpm audit:bundled-ts`, CI step after the lockfile audit):

1. Walks the installed `node_modules` directories it is given (during the spike: the spike's and the root's; since 0.4 each workspace passes only its own) **without following symlinks**, so every file in pnpm's store is read once. This includes nested `node_modules` (bundled dependencies) and packages from any source, because it checks contents, not names.
2. Reads every JavaScript file (`.js`, `.mjs`, `.cjs`, extensionless files with a `node` shebang). TypeScript < 7 only ever shipped as JavaScript.
3. Flags a file as compiler code if it contains a key of the compiler's generated diagnostic table (`"Unterminated_string_literal_1002"`, `"Identifier_expected_1003"`). These string literals belong to the scanner/parser and survive minification and re-bundling (both hits above are minified or re-bundled). Checked against the real `lib/typescript.js` of TS 2.0.10, 3.9.10, 4.9.5 and 5.9.3, each copied into a renamed package: all four are detected, with versions 3.9, 4.9 and 5.9 and "unknown" for 2.0.
4. Reads the bundled version from `versionMajorMinor = "X.Y"`, from its minified form (an identifier set to `"X.Y"` and used as `<id>.split(".")` or `${<id>}`), and from `typescript@vX.Y.Z` in the package's notice files. The most precise of these is the detected version. No version, or two that disagree, fails even for an allowlisted package (T1 requires an explicit version).
5. Attributes each file to its nearest `package.json` with `name` and `version` and records the file's SHA-256 digest per installed copy. pnpm can install one name and version more than once (peer variants, bundled dependencies); since 0.5 every copy must match the allowlist on its own, so a changed copy can't hide behind an unchanged one ([#100](https://github.com/soeenplop/enduva/issues/100)).
6. Reads each such package's direct dependents (packages as `<name>@<version>`, workspace importers as `workspace:<name>`) with `pnpm why <name> -r --json` in each scanned workspace.

Every allowlist entry must have exactly the fields `package`, `version` (exact), `bundledTypeScript` (`X.Y` or `X.Y.Z`), `files` (path to `sha256:` digest), `consumers` (non-empty, distinct) and non-blank `usage` and `reason`; anything missing, empty, malformed or unknown fails. The audit then **fails** if a package with compiler code is not allowlisted with exactly that name and version, if the detected bundled version is not string-equal to `bundledTypeScript` (so `6.0` ≠ `6.0.3` ≠ `6.0.4`), if the files carrying compiler code or any of their digests differ in any installed copy, if the direct consumers differ from `consumers` (a consumer added, removed or at another version), or if an entry matches nothing (stale). So a version bump of Prettier, oxfmt or `@tanstack/router-generator`, or any change to the bundled bytes, fails until the allowlist is updated on purpose. A version change of a package further up the chain (e.g. `@tanstack/router-cli`) that keeps the same generator does not fail.

What CI does **not** verify: the content of `usage` and `reason`, and whether a consumer still uses the bundle only for parsing or formatting. The audit only forces the allowlist diff into the PR; judging it is the reviewer's job, and the lead decides on the change (W13, AGENTS.md). The `typescript` package itself passes only at ≥ 7 and with no < 7 compiler code inside; `typescript` < 7 is never allowlistable.

The self-test runs first. With fixtures in the shape of an unminified and a minified TS 6 build, it must reject an unlisted copy, a renamed or minified copy, a copy in a bundled dependency or an extensionless `node` script, `typescript` < 7, a copy with no readable version (even if allowlisted), conflicting versions, a changed package version, a changed bundled minor, a same-minor mismatch (6.0.3 vs 6.0.4), an entry claiming a patch the scan cannot read (6.0 vs 6.0.3), a changed file with the same name and version, a new file, empty, blank, `null` or missing `usage`/`reason`/`consumers`/`files`, an unknown field, and a changed, added or vanished consumer. On the real install it must detect TS 6.0.3 and the TanStack consumer in Prettier 3.10.1 and only `6.0` in oxfmt, and the real allowlist must fail with oxfmt at `6.0.3` or `6.0.4`, with the generator consumer at another version, and with `null` usage and reason.

The lockfile audit now also rejects any package that does not resolve from the registry by `sha512` integrity (tarball, git, directory), so such sources need an explicit decision instead of passing on their name.

**Limits.** Only installed files are scanned, so optional packages for other platforms (not installed on the Linux runner) are not covered. Compiler code that is compressed, encoded (base64, wasm, archives) or downloaded at run time is invisible, as is a copy whose diagnostic keys were stripped or rewritten. A tool that copies only small TS helpers without the scanner/parser is not detected; that code cannot type-check or emit. Minified version detection is a heuristic: where only `X.Y` can be read, the entry records `X.Y` and the digests pin the bytes; an unreadable version always fails. Consumers are only the direct dependents in pnpm's graph; a copy reachable only through a package's own bundled `node_modules` has none there and fails.

## Findings

### Blocked tools (not used; not blockers for the stack)

| Tool | Version | Failure under TS 7 | Upstream state |
| --- | --- | --- | --- |
| `openapi-typescript` | 7.13.0 (peer `typescript ^5.x`) | `TypeError: Cannot read properties of undefined (reading 'createKeywordTypeNode')` at `dist/lib/ts.mjs:11` (`ts.factory`) | Prints types with the TS compiler API. `latest` is 7.13.0; the `next` tag (7.0.0-rc.1) was not tested |
| `@hey-api/openapi-ts` | 0.99.0 (peer `typescript >=5.5.3 ‖ >=6`, satisfied by 7.0.2) | `TypeError: Cannot read properties of undefined (reading 'AnyKeyword')` (`ts.SyntaxKind`) | Its peer range admits TS 7, but the runtime needs the pre-7 API |
| `swagger-typescript-api` 13.15.0, `oazapfts` 7.5.0, `openapi-zod-client` 1.18.3 (via `tanu`) | — | Not run: they declare `typescript` ^6.0.3 / ^5.9.3, or pull it in via `tanu` | Would fail the lockfile audit |

**Orval 8.49.0** and **typed-openapi 4.1.0** print code themselves, have no `typescript` dependency and work. Orval was chosen because it is widely used, supports a custom fetch mutator and can also generate TanStack Query options. Only valibot's *optional* `typescript` peer (via Orval and Paraglide) resolves, to 7.0.2.

### Pitfalls found and how the spike handles them

1. **TanStack Start's route-tree footer.** Start's Vite plugin appends a `declare module '@tanstack/react-start' { interface Register { ssr: true; router: … } }` block to `routeTree.gen.ts`. Plain `tsr generate` doesn't. Without the block, `tsc` would check a different tree than the one the build uses. Fix: the router generator's documented `routeTreeFileFooter` option in `tsr.config.json` (one string, because each array entry gets a blank line). CI compares hashes before and after `vite build`. **0.9a/0.10:** keep the footer in sync when a `src/start.ts` is added (Start then also adds `config: …`). The identity check catches drift.
2. **Orval's react-query output vs. `exactOptionalPropertyTypes`.** Passing Orval's generated suspense query options to `queryClient.ensureQueryData` fails with TS2379 (`queryFn` may be `undefined`). This is a library typing mismatch under our strict flags, not a TS 7 issue. It couldn't be cross-checked on TS 6, which is not allowed. The spike uses Orval's plain fetch client with hand-written `queryOptions` (the TanStack-recommended pattern) and keeps `exactOptionalPropertyTypes`.
3. **Paraglide plugin loading.** The default `settings.json` from `paraglide-js init` loads plugins from jsDelivr at compile time. The spike pins `@inlang/plugin-message-format@4.6.2` as a devDependency and references it from `node_modules`. The path resolves relative to the **working directory**, not to `project.inlang`. A missing plugin is only a **warning** and yields empty messages, so the message test and the prerender check guard against that.
4. **Paraglide CLI vs. URL patterns.** `paraglide-js compile` has no `urlPatterns` flag. A shared [`paraglide.options.mjs`](../../spikes/ts7-toolchain/landing/paraglide.options.mjs) feeds both `compile()` (before `tsc`) and the Vite plugin. `outputStructure: 'message-modules'` makes the plugin write the same on-disk files that `tsc` sees, instead of virtual modules. Paraglide emits its `.d.ts` without TypeScript.
5. **`verbatimModuleSyntax`.** TanStack Start's docs advise against it because it can leak server code into client bundles. It is on in the base config and off in web/landing.
6. **Decorator metadata in tests.** Vite 8's oxc transform also emits decorator metadata (the e2e test passes without SWC). The spike still runs Vitest through `unplugin-swc`, so tests and the production build use the same emitter.
7. **Nest 12 is ESM-only.** API and contracts are `"type": "module"` with `module: nodenext`. SWC emits ES modules, and `main.ts` uses top-level `await`.

### Not covered by this spike (owned by later tasks)

- The web app's Node server preset (0.12a). The smoke test calls the SSR bundle's `fetch` handler directly.
- The OpenAPI drift check in CI and committing `openapi.json` (0.8c). The spike generates it and the client in CI and git-ignores them.
- **Runtime behaviour of the generated clients (0.8c).** Criterion 3 is a compile-time check: the Swift client is generated from the spec and compiles, but no Swift code calls the API. Two gaps remain for the handoff:
  - **Auth:** [`ActivityLoader`](../../spikes/ts7-toolchain/swift-client/Sources/SpikeAPIClient/ActivityLoader.swift) builds the `Client` without a middleware that sets `Authorization: Bearer …`, so every call to the real API would get 401. The spec declares the `bearer` scheme, but the generator does not apply it.
  - **Error bodies:** the spec documents 400/401/404 as `application/problem+json` with the required `Problem` fields `type`, `title`, `status` and `code`. The Nest exceptions actually answer with `application/json` bodies such as `{"code":"invalid_token"}` (400 adds `issues`). Decoding the documented problem body would fail (wrong content type, missing required fields), so `LoaderError.problem` is never reached. The web query's `res.data.code` only works because `code` happens to be present.

  0.8c adds a `ClientMiddleware` for the bearer token and a Nest exception filter that emits the documented problem bodies, and verifies authenticated requests and error-body decoding at runtime (Swift and web) before the generated client becomes a production dependency.
- Turborepo (added in 0.4), Playwright (0.9a), Xcode project and SwiftLint (0.11a). Xcode 27 on CI runners is still in public preview.

## Handoff in 0.4

Task 0.4 ([PR #101](https://github.com/soeenplop/enduva/pull/101)) built the root workspace from this stack. What moved, and what stays in the spike for now:

- **Audit split.** Both audit scripts moved to [`tools/`](../../tools) (workspace package `@enduva/tools`). At the root, `pnpm audit:ts` runs the lockfile audit on `pnpm-lock.yaml`, then the bundled-TypeScript audit on the root `node_modules` against [`tools/ts-bundled-allowlist.json`](../../tools/ts-bundled-allowlist.json), each after its self-test, and then prints `pnpm why typescript -r`. The spike's `audit:lockfile` still checks both lockfiles, but its `audit:bundled-ts` now scans only the spike's install against the spike's allowlist. oxfmt is installed in both workspaces, so a single scan would see two consumers for one entry.
- **Root lockfile.** It now contains `typescript` 7.0.2 and no other TypeScript: the packages' devDependency, and cosmiconfig's optional `typescript` peer under `@commitlint/cli`, which resolves to the same 7.0.2. cosmiconfig only loads it for `.ts` configs, and `commitlint.config.mjs` is plain JS.
- **Root allowlist.** It has one entry, oxfmt 0.80.0. Version, file, digest, usage and reason are the same as in the spike's entry; only the consumer is `workspace:enduva`. Prettier is not in the root graph until TanStack arrives with the web app, so its entry stays in the spike's list for now.
- **CI.** [`ci.yml`](../../.github/workflows/ci.yml) runs a frozen root install, `pnpm format:check` and `pnpm audit:ts` on every PR. 0.5 adds build, lint, typecheck and test and makes these checks required.
- **Route generation and negative tests stay in the spike.** The real workspace has no route tree and no app yet. `tsr.config.json` with Start's footer, the route-tree identity check and the web/landing negative fixtures (criterion 4) move with `apps/web` (0.9a) and `apps/landing` (0.10), and the API fixtures (criteria 1, 2, 5) move with `apps/api` (0.8a). 0.5 adds the negative-test runner to the root CI so that each of these tasks only adds its fixtures. `spike-ts7.yml` keeps running them until 0.9a and 0.10 have taken them over. The apps copy the configs and fixtures from the spike, and the spike is deleted in the PR that completes that handoff (see Consequences).

## Handoff in 0.5

Task 0.5a ([#7](https://github.com/soeenplop/enduva/issues/7)) made the root checks required:

- **Required checks.** [`ci.yml`](../../.github/workflows/ci.yml) runs `build-typecheck-lint-test` (`pnpm turbo build typecheck lint test`), `format`, `ts7-audits` (`pnpm audit:ts`), `negative-tests` and `gitleaks`; [`commitlint.yml`](../../.github/workflows/commitlint.yml) runs `commitlint` on the PR title and every non-merge commit, without commitlint's default ignores. `gitleaks` also scans merge commits' diffs ([`tools/gitleaks-scan.sh`](../../tools/gitleaks-scan.sh), with a self-test). The [`main` ruleset](../../.github/rulesets/main.json) requires all six on the latest commit.
- **`pnpm why typescript`** is now a gate, not just a printout: [`tools/audit-why-typescript.mjs`](../../tools/audit-why-typescript.mjs) fails on any `typescript` < 7 in the resolved graph.
- **Negative-test runner.** [`tools/negative-tests.mjs`](../../tools/negative-tests.mjs) (`pnpm test:negative`) is the spike's script, generalised to every workspace package with a `negative/` directory. [`packages/domain/negative/`](../../packages/domain/negative) holds one type and one lint fixture so the runner always has work; 0.8a, 0.9a and 0.10 add the app fixtures from the spike.
- **Spike.** Its lockfile audit checks only its own lockfile now, and `spike-ts7.yml` no longer runs on root lockfile changes.
- **CodeQL: approved standalone analysis exception (W13).** Its JavaScript/TypeScript extractor (CodeQL CLI 2.27.6) runs its own bundled TypeScript 5.9.2, calling `ts.createProgram` per file (`noResolve`, no type checker) only to parse our code for its own analysis. The lead approved it as a standalone analysis exception under W13 ([decision on PR #104](https://github.com/soeenplop/enduva/pull/104#issuecomment-7212225890)): CodeQL runs outside our build toolchain and never type-checks, emits or serves as a language service for our build, and it influences no artifact. It is added as a **non-required** check (security alerts only) in a follow-up PR. Inside our build toolchain the TS < 7 ban stays absolute.

## Handoff in 0.8a

Task 0.8a ([#10](https://github.com/soeenplop/enduva/issues/10)) builds [`apps/api`](../../apps/api) on this stack:

- **Nest on SWC.** Nest 12.6.3, `@swc/cli`/`@swc/core` with [`swc/nest.json`](../../packages/config/swc/nest.json), no Nest CLI. The build emits `dist/main.js` and `dist/worker.js`, and a test runs the build with plain `node` (criterion 1, as in the spike's smoke script). Vitest runs through `unplugin-swc` 2.0.0 via the new preset `@enduva/config/vitest/nest`, which passes the options of `swc/nest.json` and nothing else (no `.swcrc` lookup, no tsconfig-derived defaults).
- **API fixtures (criteria 2 and 5).** [`apps/api/negative/`](../../apps/api/negative) holds the ported fixtures for the root runner: TS2554 (controller built without its injected service), TS2345 (a problem code outside the closed set) and `typescript(no-floating-promises)`. The spike keeps its own copies until it is deleted (Consequences).
- **New runtime packages** (`nestjs-pino` 5.3.2, `pino` 10.4.0, `pino-http` 11.0.0) bring no TypeScript: `pnpm audit:ts` passes with no new allowlist entry.

## Consequences

- 0.4 can scaffold the monorepo with the stack above. Copy `tsconfig.base.json`, `.swcrc`, `.oxlintrc.json`, `.oxfmtrc.json`, `tsr.config.json` (with the footer), the negative-test script, both audit scripts and the bundled-TS allowlist into `packages/config` / CI. 0.4 copied the presets, `.oxfmtrc.json`, both audit scripts and the allowlist; `tsr.config.json` and the negative-test script move with the apps ([Handoff in 0.4](#handoff-in-04)). Use Node 24 in CI and pin `@types/node` (plus an `overrides` entry) to the same major as the minimum supported or deployed Node.
- 0.4 uses **oxfmt** as the repo formatter (`format:check` in CI). Prettier is not a direct dependency and is not invoked by our scripts or by Orval; it only stays as TanStack's transitive dependency.
- 0.5 should make the lockfile audit, the **bundled-TypeScript audit** and `pnpm why typescript` required checks, run the bundled audit after a frozen install of every workspace on the CI platform, and keep `typescript-eslint`, `@nestjs/cli`, `ts-morph` and every `@typescript/native-preview*` on the banned list. Changes to the allowlist are decided by the lead and checked by the reviewer (W13, owner delegation on 2026-11-27).
- 0.8c uses **Orval** (fetch client + mutator), not openapi-typescript or hey-api, unless they ship a TS 7-compatible release (re-check on dependency updates; the audit and a codegen step in CI would catch a regression).
- Any new tool that imports `typescript` at runtime has to be checked first. Its peer range is not enough evidence (see hey-api).
- The spike directory and `spike-ts7.yml` **stay until 0.9a and 0.10** have brought route generation, the route-tree identity check and the app negative tests into the real workspace (and 0.8a the Nest/SWC checks). Until then they are the only CI coverage for TanStack Start under TS 7. They are deleted in the PR that completes that handoff, once the root CI runs the audits and the negative-test runner as required checks (0.5). See [Handoff in 0.4](#handoff-in-04). Lead decision on PR #101.
