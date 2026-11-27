# @enduva/landing

The landing page at `https://enduva.soeenplop.dev` (T4): TanStack Start, prerendered to static HTML, no server at run time. Stack and pitfalls: [ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md).

## URLs

Every page exists once per locale, always with a prefix: `/de/…` and `/en/…`, each with its own `<html lang>`. [`site.mjs`](site.mjs) lists the pages, and the prerender config renders exactly those URLs.

## Commands

Run them through Turbo from the repository root (`pnpm turbo build typecheck lint test`), which runs `generate` first. In this directory:

| Script | What it does |
| --- | --- |
| `pnpm generate` | Compiles the Paraglide messages (`src/paraglide/`) and the route tree (`src/routeTree.gen.ts`, with Start's footer from `tsr.config.json`) for `tsc`. Both are git-ignored |
| `pnpm build` | `vite build` with prerendering into `dist/client` |
| `pnpm dev` | Vite dev server |
| `pnpm test` | Vitest |

## Messages

`messages/{de,en}.json`, compiled by Paraglide JS. They live in the app, not in `@enduva/i18n`, because the landing copy is used nowhere else and the landing build stays self-contained; the locales must match `@enduva/i18n` (unit test). The plugin is pinned in `devDependencies` and loaded from `node_modules`; a missing plugin only warns and yields empty messages, which the tests catch. Every key must exist in both catalogs.
