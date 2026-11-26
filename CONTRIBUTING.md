# Contributing to Enduva

Thanks for your interest in Enduva! This document explains how to contribute. The full development workflow is described in [`docs/plan/05-workflow.md`](docs/plan/05-workflow.md).

## Licence and CLA

Enduva is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2). You may use, modify and self-host it, but you may not provide it to third parties as a hosted or managed service that gives users access to any substantial set of its features or functionality. ELv2 is not an OSI-approved open-source licence.

Because ELv2 alone wouldn't let the maintainer run contributed code as the hosted Enduva service or relicense it, **every external contributor must sign the [Contributor License Agreement](CLA.md)** before a pull request can be merged. The CLA lets the maintainer use, relicense (including commercially) and host your contributions; you keep the copyright.

When you open your first pull request, the CLA bot comments on it. To sign, reply with exactly:

```text
I have read the CLA Document and I hereby sign the CLA
```

The `CLA` check turns green once all commit authors of the PR have signed. Comment `recheck` to re-run it. Your commit email must be linked to your GitHub account so the bot can identify you. The maintainer account `soeenplop` and the bots `dependabot[bot]`, `renovate[bot]` and `github-actions[bot]` are allowlisted.

> The CLA text is still a draft awaiting the maintainer's approval. Until it is approved, external pull requests can't be merged.

## Before you start

- Check the [roadmap](docs/plan/04-roadmap.md) and open issues. For anything beyond a small fix, open an issue first so we can agree on scope.
- Everything in the repository is written in **English**.
- Don't include secrets, credentials or real personal or health data in code, tests, issues or screenshots.
- Report security issues privately to the maintainer, not in a public issue.

## Development setup

Requirements: Node.js 24 or newer and pnpm. pnpm switches to the version pinned in `packageManager` (`package.json`) automatically.

```sh
pnpm install   # also installs the git hooks (lefthook)
```

## Commits

We use [Conventional Commits](https://www.conventionalcommits.org/), checked by commitlint in a `commit-msg` hook:

```text
type(scope): subject
```

- **types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
- **scopes** (optional): `api`, `web`, `landing`, `apple`, `watch`, `db`, `domain`, `contracts`, `ai`, `i18n`, `ui`, `deploy`, `deps`, `plan`
- Breaking changes: `feat(api)!: …` plus a `BREAKING CHANGE:` footer.

Pull requests are merged with merge commits (no squash), so keep commits small and logical, and clean up fix-ups with `git commit --fixup` + `git rebase --autosquash` before the final review.

## Pull requests

1. Fork the repository and create a branch, e.g. `fix/web-login-redirect`.
2. Make your change, with tests where it makes sense. User-facing strings need German and English versions.
3. Open a pull request against `main`. Its title must be a Conventional Commit. Fill in the template and link the issue (`Closes #123`).
4. Sign the CLA if the bot asks you to.
5. Address review comments. Every PR is reviewed before merge, and all required checks must pass on the latest commit.
