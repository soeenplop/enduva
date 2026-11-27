// drizzle-kit only generates SQL into supabase/migrations; the Supabase CLI applies it (`supabase db reset`
// locally, `supabase db push` in deploys). Never run `drizzle-kit push`/`migrate`. See README.md and ADR-0002.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: '../../supabase/migrations',
  schemaFilter: ['app'],
  migrations: { prefix: 'supabase' },
  strict: true,
  verbose: true,
});
