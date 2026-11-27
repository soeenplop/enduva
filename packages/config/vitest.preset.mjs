// Shared Vitest config. A package's vitest.config.mjs re-exports it, or merges it with
// `mergeConfig` from `vitest/config`. Nest packages add `unplugin-swc` with swc/nest.json (ADR-0001).
export default {
  test: {
    include: ['test/**/*.test.ts'],
  },
};
