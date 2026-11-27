// Conventional Commits, see docs/plan/05-workflow.md#commits.
// Plain .mjs on purpose: a .ts config would need a TypeScript loader,
// and nothing in this repo may pull in `typescript` < 7.
//
// No default ignores: they would accept release-like (`v1.2.3`), `Merge …`, `Revert …` and
// `fixup!`/`squash!`/`amend!` messages, as PR titles too. The only exceptions:
// - Merge commits are recognised by their parents, never by their message: CI lints the PR range
//   with tools/commitlint-range.sh (`git rev-list --no-merges`), and the commit-msg hook skips a
//   commit that concludes a merge (MERGE_HEAD).
// - The commit-msg hook sets COMMITLINT_ALLOW_AUTOSQUASH=1 so `git commit --fixup` works locally
//   (docs/plan/05-workflow.md#commits). CI never sets it, so a fix-up left in a PR fails there.
const AUTOSQUASH = /^(?:amend|fixup|squash)! \S/;

export default {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  ignores: process.env.COMMITLINT_ALLOW_AUTOSQUASH === '1' ? [(message) => AUTOSQUASH.test(message)] : [],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'],
    ],
    // Scope is optional, but if present it must be one of these.
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'landing',
        'apple',
        'watch',
        'db',
        'domain',
        'contracts',
        'ai',
        'i18n',
        'ui',
        'deploy',
        'deps',
        'plan',
      ],
    ],
  },
};
