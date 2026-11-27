# Contributing to Enduva

Thanks for your interest in Enduva! This document explains how to contribute. The full development workflow is described in [`docs/plan/05-workflow.md`](docs/plan/05-workflow.md).

## Licence and CLA

Enduva is **source-available** under the [Elastic License 2.0](LICENSE) (ELv2). You may use, modify and self-host it, but you may not provide it to third parties as a hosted or managed service that gives users access to any substantial set of its features or functionality. ELv2 is not an OSI-approved open-source licence.

Because ELv2 alone wouldn't let the maintainer run contributed code as the hosted Enduva service or relicense it, **every external contributor must sign the [Contributor License Agreement](CLA.md)** before a pull request can be merged. The CLA lets the maintainer use, relicense (including commercially) and host your contributions; you keep the copyright.

> [!IMPORTANT]
> **External contributions can't be merged yet.** The CLA is still a draft awaiting legal review and the maintainer's approval. Until it is final, the CLA check fails every pull request that has a commit or opener outside the maintainer's account and the listed bots, and it collects no signatures. Please don't sign anything yet; you're welcome to open issues.

### How the CLA check works

The `cla` status check ([`.github/workflows/cla.yml`](.github/workflows/cla.yml), logic in [`tools/cla-check.mjs`](tools/cla-check.mjs)) is required on `main`. Once the CLA is final:

- Every account that authored a commit in your pull request, and the account that opened it, must sign. Exempt are only the maintainer's account and the bots listed in [`.github/cla.json`](.github/cla.json), matched by GitHub account ID for each commit.
- Commits are attributed by **GitHub account**, not by git name or email: each commit's author must be linked to your account, and the commit must be **signed with your own key** and committed by you, so GitHub shows it as *Verified* (see [Commits](#commits)). Commits that fail this block the check before any signature is looked at.
- To sign, post the exact comment that the check's prompt on your pull request shows, from your own account. It names the CLA version and the SHA-256 of its text, and the prompt links to that exact text at a fixed commit. The check records your signature (account ID, login, pull request, version, hash, time) on the `cla-signatures` branch and reuses it for later pull requests.
- A new CLA version has a new phrase and hash: everyone signs again before further contributions can be merged.
- If the check can't read your pull request completely (for example more than 250 commits), it fails rather than guess.
- GitHub attaches the `cla` status to your pull request's **head commit**, so every open pull request to `main` with the same head commit shares it. It turns green only when **all** of them pass. If another account opens a pull request with the same head commit and hasn't signed, yours stays blocked until that account signs or that pull request is closed (also while the CLA is a draft, when only the maintainer can close it).

### Activating the CLA (maintainer only)

Approving the final CLA text is an owner-only decision. Activation is one pull request, merged only with the owner's approval for its exact head SHA, that:

1. replaces `CLA.md` with the approved text, without the draft notice;
2. sets `.github/cla.json` to `"status": "final"`, `"version"` to the new version (e.g. `"1.0"`) and `"sha256"` to the output of `node tools/cla-check.mjs --hash`.

The check refuses a final config whose hash doesn't match `CLA.md` or whose text is still marked as a draft. Any later change to `CLA.md` needs a new version and hash. Merging re-evaluates every open pull request; a check that was still running with the previous CLA doesn't post its result (or replaces it with a failure if it already did).

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
4. Sign the CLA when the check asks you to, once it is in force (see [How the CLA check works](#how-the-cla-check-works)).
5. Address review comments. Every PR is reviewed before merge, and all required checks must pass on the latest commit.
