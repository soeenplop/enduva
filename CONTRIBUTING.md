# Contributing to Enduva

Thanks for your interest in Enduva! This document explains how to contribute. The full development workflow is described in [`docs/plan/05-workflow.md`](docs/plan/05-workflow.md).

## Licence and CLA

Enduva is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2). You may use, modify and self-host it, but you may not provide it to third parties as a hosted or managed service that gives users access to any substantial set of its features or functionality. ELv2 is not an OSI-approved open-source licence.

Because ELv2 alone wouldn't let the maintainer run contributed code as the hosted Enduva service or relicense it, **every external contributor must sign the [Contributor License Agreement](CLA.md)** before a pull request can be merged. The CLA lets the maintainer use, relicense (including commercially) and host your contributions; you keep the copyright.

> [!IMPORTANT]
> **External contributions can't be merged yet.** The CLA is still a draft awaiting legal review and the maintainer's approval. Until it is final, please don't sign anything; you're welcome to open issues.

### Interim CLA gate

Until the CLA is final, the required `cla` check on every pull request is an **interim gate**. It passes only if the pull request was opened by the maintainer or one of the listed bots (Renovate, GitHub Actions), and the author and committer of every commit are linked to one of those GitHub accounts (GitHub's `web-flow` is also accepted as committer). Accounts are matched by GitHub account ID, never by name or email, and a commit whose author isn't linked to a GitHub account fails. Pull requests from anyone else fail the check and can't be merged.

Once the CLA is final, the gate is replaced by the full signature check (signing on the pull request, verified per GitHub account and bound to the CLA version, roadmap task CLA.1). Its implementation is kept on branch `ci/0.5b-cla-check` ([#112](https://github.com/soeenplop/enduva/pull/112)) for reactivation.

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

**Every commit must be signed** (SSH, GPG or S/MIME) with **your own key**, registered on your GitHub account, so GitHub shows it as *Verified*. See GitHub's guide on [signing commits](https://docs.github.com/en/authentication/managing-commit-signature-verification/signing-commits). The dedicated SSH key `~/.ssh/enduva_signing_ed25519` named in `AGENTS.md` and the workflow docs is the maintainer's key for the maintainer's own agent commits; it doesn't apply to contributors.

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
4. Sign the CLA once signing is enabled (see [Licence and CLA](#licence-and-cla)).
5. Address review comments. Every PR is reviewed before merge, and all required checks must pass on the latest commit.
