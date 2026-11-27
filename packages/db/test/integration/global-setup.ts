import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { TestProject } from 'vitest/node';

export interface LocalSupabase {
  readonly apiUrl: string;
  readonly publishableKey: string;
  /** Host of the local database and pooler, from `DB_URL`. */
  readonly dbHost: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

/** Reads the running local stack's URLs and keys from `supabase status`, so no key is hard-coded. */
export default function setup(project: TestProject): void {
  let status: Record<string, string>;
  try {
    const stdout = execFileSync('supabase', ['status', '--output', 'json', '--workdir', repoRoot], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    status = JSON.parse(stdout) as Record<string, string>;
  } catch (error) {
    throw new Error('The local Supabase stack is not running. Start it with `pnpm db:start` and `pnpm db:reset`.', {
      cause: error,
    });
  }
  const { API_URL: apiUrl, PUBLISHABLE_KEY: publishableKey, DB_URL: dbUrl } = status;
  if (apiUrl === undefined || publishableKey === undefined || dbUrl === undefined) {
    throw new Error('`supabase status` is missing API_URL, PUBLISHABLE_KEY or DB_URL');
  }
  project.provide('supabase', { apiUrl, publishableKey, dbHost: new URL(dbUrl).hostname });
}
