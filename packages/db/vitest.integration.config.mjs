// Integration suite against the local Supabase stack (`pnpm db:start`, then `pnpm db:reset`). See README.md.
export default {
  test: {
    include: ['test/integration/**/*.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // One file at a time: the tests share the seeded rows (every write is rolled back).
    fileParallelism: false,
    testTimeout: 15_000,
  },
};
