# @enduva/landing

The landing page at `https://enduva.de` (T4): TanStack Start, prerendered to static HTML, no server at run time. Stack and pitfalls: [ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md).

## URLs

Every page exists once per locale, always with a prefix: `/de/…` and `/en/…`, each with its own `<html lang>`, canonical URL and `hreflang` alternates (`x-default` is `/` for the home page and the English page otherwise). [`site.mjs`](site.mjs) lists the pages, and the prerender config renders exactly those URLs. `/` is a static language picker that links to both and redirects by `navigator.languages`. There are no unprefixed duplicates.

## Commands

Run them through Turbo from the repository root (`pnpm turbo build typecheck lint test`), which runs `generate` first. In this directory:

| Script | What it does |
| --- | --- |
| `pnpm generate` | Compiles the Paraglide messages (`src/paraglide/`) and the route tree (`src/routeTree.gen.ts`, with Start's footer from `tsr.config.json`) for `tsc`. Both are git-ignored |
| `pnpm build` | [`scripts/build.mjs`](scripts/build.mjs): `vite build` with prerendering, the route-tree and Paraglide identity check, then the picker at `/`, `sitemap.xml`, `robots.txt`, the manifest and the brand files from `assets/brand/final/web`, then [`scripts/check-static.mjs`](scripts/check-static.mjs) on `dist/client` |
| `pnpm dev` | Vite dev server. The brand files, `/` and the sitemap only exist in the build |
| `pnpm test` | Vitest |
| `pnpm test:e2e` | [`e2e/reflow.test.ts`](e2e/reflow.test.ts): no horizontal overflow at 320 CSS px (WCAG 1.4.10) on `/` and every prerendered page, light and dark, with and without JS, in Chromium via `playwright-core` (setup: [`apps/web/README.md`](../web/README.md#e2e)). Serves `dist/client` like a static file server |

`dist/client` is the whole site. Serve it with any static file server that maps `/de/` to `/de/index.html`.

### Identity check

`tsc` checks the route tree and Paraglide output that `pnpm generate` wrote. The build hashes both before and after `vite build` and fails if Start's or Paraglide's Vite plugin wrote anything different, so `tsc` can't pass on a different app than the one we ship. Keep `tsr.config.json`'s footer in sync with Start (it changes once a `src/start.ts` exists) and keep [`paraglide.options.mjs`](paraglide.options.mjs) the only place for compiler options.

### Negative tests

Each `negative/*.tsx` starts with `// @expect TS<code> at <line>:<col>` and must fail `tsc` with exactly that one diagnostic: a wrong component prop, a `Link` to a route that doesn't exist, a misspelled Paraglide message and a search param the route doesn't declare. The root runner [`tools/negative-tests.mjs`](../../tools/negative-tests.mjs) finds them on its own (`pnpm test:negative` from the repository root, which runs `generate` first).

## Messages

`messages/{de,en}.json`, compiled by Paraglide JS. They live in the app, not in `@enduva/i18n`, because the landing copy is used nowhere else and the landing build stays self-contained; the locales must match `@enduva/i18n` (unit test). The plugin is pinned in `devDependencies` and loaded from `node_modules`; a missing plugin only warns and yields empty messages, which the tests and the static check catch. Every key must exist in both catalogs.

## Design

Concept B "Daybreak": colors, spacing and type come from `@enduva/ui/tokens.css`, which follows the system's light/dark setting. Manrope (SIL OFL) is self-hosted from `@fontsource-variable/manrope`. The final landing page is task 5.1.

## Lighthouse

Not part of CI. To check the static build locally, serve `dist/client` and run the pinned Lighthouse with `npx`, which installs it into npm's cache and never into our lockfile (13.6.0 has no `typescript` dependency and bundles no compiler code):

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/client
npx --yes lighthouse@13.6.0 http://127.0.0.1:4173/de/ --only-categories=performance,accessibility,best-practices,seo
```
