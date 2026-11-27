# @enduva/landing

The landing page at `https://enduva.soeenplop.dev` (T4): TanStack Start, prerendered to static HTML, no server at run time. Stack and pitfalls: [ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md).

## URLs

Every page exists once per locale, always with a prefix: `/de/…` and `/en/…`, each with its own `<html lang>`. [`site.mjs`](site.mjs) lists the pages, and the prerender config renders exactly those URLs. `/` is a static language picker that links to both and redirects by `navigator.languages`. There are no unprefixed duplicates.

## Commands

Run them through Turbo from the repository root (`pnpm turbo build typecheck lint test`), which runs `generate` first. In this directory:

| Script | What it does |
| --- | --- |
| `pnpm generate` | Compiles the Paraglide messages (`src/paraglide/`) and the route tree (`src/routeTree.gen.ts`, with Start's footer from `tsr.config.json`) for `tsc`. Both are git-ignored |
| `pnpm build` | [`scripts/build.mjs`](scripts/build.mjs): `vite build` with prerendering, the route-tree and Paraglide identity check, the picker at `/`, then [`scripts/check-static.mjs`](scripts/check-static.mjs) on `dist/client` |
| `pnpm dev` | Vite dev server. The picker at `/` only exists in the build |
| `pnpm test` | Vitest |

`dist/client` is the whole site. Serve it with any static file server that maps `/de/` to `/de/index.html`.

### Identity check

`tsc` checks the route tree and Paraglide output that `pnpm generate` wrote. The build hashes both before and after `vite build` and fails if Start's or Paraglide's Vite plugin wrote anything different, so `tsc` can't pass on a different app than the one we ship. Keep `tsr.config.json`'s footer in sync with Start (it changes once a `src/start.ts` exists) and keep [`paraglide.options.mjs`](paraglide.options.mjs) the only place for compiler options.

### Negative tests

Each `negative/*.tsx` starts with `// @expect TS<code> at <line>:<col>` and must fail `tsc` with exactly that one diagnostic: a wrong component prop, a `Link` to a route that doesn't exist, a misspelled Paraglide message and a search param the route doesn't declare. The root runner [`tools/negative-tests.mjs`](../../tools/negative-tests.mjs) finds them on its own (`pnpm test:negative` from the repository root, which runs `generate` first).

## Messages

`messages/{de,en}.json`, compiled by Paraglide JS. They live in the app, not in `@enduva/i18n`, because the landing copy is used nowhere else and the landing build stays self-contained; the locales must match `@enduva/i18n` (unit test). The plugin is pinned in `devDependencies` and loaded from `node_modules`; a missing plugin only warns and yields empty messages, which the tests and the static check catch. Every key must exist in both catalogs.

## Design

Concept B "Daybreak": colors, spacing and type come from `@enduva/ui/tokens.css`, which follows the system's light/dark setting. Manrope (SIL OFL) is self-hosted from `@fontsource-variable/manrope`. The final landing page is task 5.1.
