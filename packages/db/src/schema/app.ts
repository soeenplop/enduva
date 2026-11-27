import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Schema of all API-owned tables. It is not in `[api].schemas` (supabase/config.toml) and nothing in it is
 * granted to `anon`/`authenticated`, so the Data API can't reach it (ADR-0002).
 */
export const app = pgSchema('app');
