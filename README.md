<img src="assets/brand/concept-b/icon.svg" width="64" height="64" alt="Enduva icon">

# Enduva

Endurance training, strength training and nutrition tracking in one app — for iPhone, Apple Watch and the web.

> 🚧 Early development. See [`docs/plan`](docs/plan) for the project plan.

## Development

Prerequisites: **Node.js ≥ 24** (CI uses 24) and **pnpm 12.21.0** (pinned in `packageManager`, e.g. via `corepack enable`).

```sh
pnpm install          # also installs the commit-msg hook (lefthook + commitlint)
pnpm build            # SWC builds of all packages (Turborepo)
pnpm typecheck        # tsc 7, type-check only
pnpm lint             # oxlint, type-aware via tsgolint
pnpm test             # Vitest, plus the audit self-tests
pnpm format           # oxfmt (pnpm format:check only checks)
pnpm audit:ts         # TypeScript 7 only: lockfile + bundled-TypeScript audits, pnpm why typescript
```

`build`, `typecheck`, `lint` and `test` run through [Turborepo](https://turborepo.com) and are cached; `pnpm turbo build typecheck lint test format:check` runs them together. Packages live in `packages/*` (apps follow in `apps/*`). Shared tsconfig, SWC, oxlint and Vitest presets are in [`packages/config`](packages/config), the formatter config is [`.oxfmtrc.json`](.oxfmtrc.json), and the audits are in [`tools/`](tools). Only TypeScript 7 is allowed ([T1](docs/plan/00-decisions.md), [ADR-0001](docs/adr/0001-typescript-7-toolchain.md)).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). External contributions require signing the [Contributor License Agreement](CLA.md). The CLA is still a draft, and its automated check arrives with roadmap task 0.5, so external pull requests can't be merged yet.

## License

Enduva is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2). You may use, modify and self-host it, but you may not provide it to third parties as a hosted or managed service that gives users access to any substantial set of its features or functionality. ELv2 is not an OSI-approved open-source license.
