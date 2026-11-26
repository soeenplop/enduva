# Agent rules

Rules for coding agents working on Enduva. The full workflow is in [`docs/plan/05-workflow.md`](docs/plan/05-workflow.md), decisions are in [`docs/plan/00-decisions.md`](docs/plan/00-decisions.md). If this file and the plan disagree, the plan wins.

## Basics

- **English only** in the repo: code, comments, commits, PRs, issues, docs.
- **One task = one branch + one worktree + one PR.** Branch name: `<type>/<task-id>-<slug>`, e.g. `feat/1.3-healthkit-workout-import`. Manual worktrees go to `.worktrees/<branch-name>`.
- Start from the latest `origin/main`. Rebase before review; once review has started, merge `main` in instead.
- **TypeScript 7 only.** Nothing may install `typescript` < 7, an alias of it, or another pre-7 compiler. Check with `pnpm why typescript`. Prefer `.mjs` configs over `.ts` configs that need a TS loader.
- **Never commit secrets** (`.env`, keys, tokens, credentials). Only `.env.example` is tracked.
- Pin dependency versions exactly. Dependency build scripts are denied by default (`allowBuilds` in `pnpm-workspace.yaml`).

## Commits

- [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`, enforced by commitlint (lefthook `commit-msg` hook, CI later).
  - types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`
  - scopes (optional): `api`, `web`, `landing`, `apple`, `watch`, `db`, `domain`, `contracts`, `ai`, `i18n`, `ui`, `deploy`, `deps`, `plan`
  - breaking: `feat(api)!: …` plus a `BREAKING CHANGE:` footer
- Small, logical commits that each build. No squash merges, so history is reviewed: no "wip"/"fix typo" commits. Fold fix-ups in with `git commit --fixup` + `git rebase --autosquash` before the final review round.
- Agent commits end with a `Co-Authored-By:` trailer naming the model.
- **Signing:** commits are signed with the repo-local SSH key `~/.ssh/enduva_signing_ed25519`. Never disable signing and never change git config. If signing fails, stop and report.

## Pull requests

- Fill in [`.github/pull_request_template.md`](.github/pull_request_template.md). Link the issue with `Closes #<n>`.
- The PR title is a Conventional Commit.
- Target ≤ ~400 changed lines (excluding lockfiles, generated files, fixtures). Split larger tasks (`1.3a`, `1.3b`).
- Draft while CI is red. Mark ready when CI is green and self-review is done.
- Labels: `type:*` and `area:*` classify the PR/issue. `parallel-ok` marks tasks that may run in parallel, `gate` marks gate issues, `needs-arbiter` marks an unresolved review disagreement. Labels already exist; don't create new ones without the owner.

## Review protocol

All agents share the owner's GitHub account, so every comment starts with an author prefix:

- **`[Sol]`**: reviewer (GPT-6.2 Sol). Each comment has a severity: `blocker`, `major`, `minor`, `nit`, `question`. The summary ends with `Verdict: changes requested @ <full-head-sha>` or `Verdict: LGTM @ <full-head-sha>`.
- **`[Claude]`**: implementer / lead. Answer **every** review comment in its thread: `Fixed in <sha>` or a reasoned disagreement.
- **`[Astra]`**: designer (GPT-6.2 Astra).

The lead starts a **new** Sol run for every PR and for each re-check. A re-check receives the prior findings and replies, resolves fixed threads, answers disagreements and respects recorded owner rulings.

A verdict is bound to a head SHA. **Any push invalidates it** and needs a new reviewer run (at least a delta review). After two exchanges without agreement on a thread, the lead adds `needs-arbiter` and posts `[Claude] arbiter request`. The owner's `Ruling: …` is final; apply it, reply `[Claude] ruling applied in <sha>`, resolve the thread, remove the label.

## Merging

The lead's merge procedure: merge only when all of these hold **for the current head SHA**:

- `Verdict: LGTM @ <head-sha>`; open nits are turned into follow-up issues.
- All `blocker`/`major` threads resolved, no `needs-arbiter` label.
- All required status checks green on that head.
- **Owner approval** is **not** required when Sol's verdict is LGTM and the lead agrees (owner ruling, 2026-11-27). It is still required only for: (a) decisions only the owner can make or provide (legal texts such as the privacy policy, imprint and the final CLA text, licence changes, accounts, costs or contracts with third parties), (b) passing the gates G1 and G2, (c) arbiter rulings on unresolved disagreements (`needs-arbiter`), and (d) PRs the owner explicitly asked to review. In those cases an `Approved @ <sha>` comment (or an approval relayed by the lead with the SHA) is needed.

Merge commits only, with a head guard:

```sh
gh pr merge <n> --merge --match-head-commit <head-sha> --delete-branch
```

Never squash or rebase-merge. Never push to `main` directly. The owner can always merge or veto manually ([`05-workflow.md` → Merging](docs/plan/05-workflow.md#merging)).

## Definition of done

- [ ] Acceptance criteria from the issue are met
- [ ] Tests: unit for domain logic, integration for API endpoints, UI tests for critical flows
- [ ] User-facing strings in de + en
- [ ] OpenAPI/client regenerated if the API changed
- [ ] Docs/ADR updated if architecture or behaviour changed
- [ ] CI green, review LGTM, no open blockers
