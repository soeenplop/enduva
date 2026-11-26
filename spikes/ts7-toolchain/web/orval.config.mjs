// Generates the typed web client (plain fetch functions + types) from the contracts' OpenAPI spec.
// Orval prints code itself and does not depend on the `typescript` package (unlike
// openapi-typescript and @hey-api/openapi-ts, which need the pre-7 TS JS API; see ADR-0001).
export default {
  api: {
    input: '../contracts/openapi.json',
    output: {
      target: './src/api/generated.ts',
      client: 'fetch',
      override: { mutator: { path: './src/api/fetcher.ts', name: 'apiFetch' } },
      // No `formatter` on purpose: `prettier` would run the Prettier that TanStack's route
      // generator pulls in. The generated client is excluded from lint and format (ADR-0001).
    },
  },
};
