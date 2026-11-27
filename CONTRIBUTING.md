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
- Commits are attributed by **GitHub account**, not by git name or email: each commit's author must be linked to your account, and the commit must be **signed with your own key** and committed by you, so GitHub shows it as *Verified* (see [Commits](#commits)). Commits that GitHub signs itself (web edits, the API) count only for the account that opened the pull request. Commits that fail this block the check before any signature is looked at.
- To sign, post the exact comment that the check's prompt on your pull request shows, from your own account. It names the CLA version and the SHA-256 of its text, and the prompt links to that exact text at a fixed commit. **Edited comments don't count**, so post a new comment instead of fixing an old one. The check records your signature (account ID, login, pull request, version, hash, time and a link to your comment) on the `cla-signatures` branch and reuses it for later pull requests as long as that comment stays unedited; if it is edited or deleted, you sign again.
- A new CLA version has a new phrase and hash: everyone signs again before further contributions can be merged.
- If the check can't read your pull request completely (for example more than 250 commits or 300 changed files), it fails rather than guess. The check runs again on every push, on a new signing comment and once an hour; a maintainer can also re-run it for one pull request (`cla` workflow, *Run workflow*).
- GitHub attaches the `cla` status to your pull request's **head commit**, so every open pull request to `main` with the same head commit shares it. It turns green only when **all** of them pass, and its description names them. If another account opens a pull request with the same head commit and hasn't signed, yours stays blocked until that account signs or that pull request is closed (also while the CLA is a draft, when only the maintainer can close it).
- A pull request that changes the CLA check or its policy (the files listed in [`.github/CODEOWNERS`](.github/CODEOWNERS)) fails the check unless its head commit is signed with an **owner approval key** listed in [`.github/cla-approvers`](.github/cla-approvers).

### Activating the CLA (maintainer only)

Approving the final CLA text is an owner-only decision. Activation is one pull request that:

1. replaces `CLA.md` with the approved text, without the draft notice, and with exactly one `Version <version>` line;
2. sets `.github/cla.json` to `"status": "final"`, `"version"` to that version (e.g. `"1.0"`) and `"sha256"` to the output of `node tools/cla-check.mjs --hash`.

Because it changes protected files, it can only pass the `cla` check when the owner signs its head commit with an approval key, which is the owner's sign-off for that exact head. The check refuses a final config whose hash doesn't match `CLA.md`, whose version differs from the `Version` line, or whose text is still marked as a draft. Any later change to `CLA.md` needs a new version and hash.

Merging a policy change sets every open pull request whose `cla` status was made with the previous policy to *pending* first, then re-evaluates it. A sweep that is interrupted is finished by the hourly run, and a check that was still running with the previous policy re-evaluates instead of posting its result.

#### Owner approval key (one-time setup, owner only)

All agents work through the owner's GitHub account, so neither approvals nor code-owner reviews can tell the owner from an agent. The approval key can: it is an SSH key that **only the owner holds** (for example in a password manager that asks before each use), never the agents' repository signing key.

1. Create the key and add it to the GitHub account as a **signing key**, so that GitHub shows commits signed with it as *Verified*.
2. Add it to `.github/cla-approvers` (`owner <key type> <public key>`). This pull request changes a protected file while no key is listed yet, so it can't pass `cla`: merge it before `cla` is a required check, or with the ruleset temporarily disabled by the owner.
3. To approve a protected change, the owner signs the pull request's head commit with that key, for example `git -c user.signingkey=<key> commit --allow-empty -S -m "chore: approve CLA policy change"`, and pushes it. Any later push needs a new approval.

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
