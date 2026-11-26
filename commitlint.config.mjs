// Conventional Commits, see docs/plan/05-workflow.md#commits.
// Plain .mjs on purpose: a .ts config would need a TypeScript loader,
// and nothing in this repo may pull in `typescript` < 7.
export default {
  extends: ['@commitlint/config-conventional'],
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
