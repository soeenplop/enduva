// Generates the typed fetch client from the API's committed OpenAPI spec (ADR-0001: Orval prints code itself and
// needs no `typescript`, unlike openapi-typescript and @hey-api/openapi-ts). Plain fetch functions, no React Query
// output (ADR-0001 pitfall 2); the web app writes its `queryOptions` around them.
export default {
  api: {
    input: '../../apps/api/openapi.json',
    output: {
      target: './src/generated/api.ts',
      client: 'fetch',
      headers: true,
      override: { mutator: { path: './src/fetcher.ts', name: 'apiFetch' } },
      // No `formatter` on purpose: 'prettier' would load the Prettier copy (bundled TypeScript 6 parser) that is in
      // the graph for TanStack. The output is git-ignored and excluded from lint and format.
    },
  },
};
