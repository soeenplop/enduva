// Browser tests (`pnpm test:e2e`, after `pnpm build`): playwright-core driven from Vitest. Not `@playwright/test`,
// whose runner bundles a Babel TypeScript loader (see the e2e README section).
export default {
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};
