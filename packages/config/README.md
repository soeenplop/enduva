# @enduva/config

Shared presets for the TypeScript 7 toolchain ([ADR-0001](../../docs/adr/0001-typescript-7-toolchain.md)). Add `"@enduva/config": "workspace:*"` as a devDependency, then:

| Preset | Use |
| --- | --- |
| `tsconfig/base.json` | Strict TS 7 base, `module: nodenext`, no ambient types. `tsc` only type-checks |
| `tsconfig/node.json` | Node.js code (`types: ["node"]`, needs `@types/node`) |
| `tsconfig/nest.json` | NestJS on SWC (decorators + metadata) |
| `tsconfig/react.json` | React/DOM code bundled by Vite (`moduleResolution: bundler`, `jsx: react-jsx`) |
| `swc/lib.json` | `swc src -d dist --strip-leading-paths --delete-dir-on-start --config-file node_modules/@enduva/config/swc/lib.json` (`--delete-dir-on-start` keeps files of deleted sources out of `dist` and the Turbo cache) |
| `swc/react.json` | Same command for React packages: TSX with the automatic JSX runtime, matching `jsx: react-jsx` in `tsconfig/react.json` |
| `swc/nest.json` | SWC with `legacyDecorator` + `decoratorMetadata`, for Nest builds and `unplugin-swc` |
| `oxlint.json` | `oxlint -c node_modules/@enduva/config/oxlint.json --type-aware --deny-warnings src test` |
| `vitest` | `export { default } from '@enduva/config/vitest';` in `vitest.config.mjs`; runs `test/**/*.test.{ts,tsx}` |
| `vitest/nest` | Same, plus `unplugin-swc` with the options of `swc/nest.json`, so Nest tests run on the build's emit (decorator metadata) |

Pass explicit paths to oxlint: `ignorePatterns` in a shared config resolve relative to this directory, so the preset has none. The formatter config is the root [`.oxfmtrc.json`](../../.oxfmtrc.json): oxfmt has no `extends` and only discovers `.oxfmtrc.json`, and it formats the whole repository.
