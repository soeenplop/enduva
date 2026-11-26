import { defineConfig } from 'drizzle-kit';

// drizzle-kit loads the TS schema with its own esbuild-based loader; no `typescript` package needed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
