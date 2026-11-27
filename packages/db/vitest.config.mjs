import { configDefaults, mergeConfig } from 'vitest/config';

import preset from '@enduva/config/vitest';

// Unit tests only. The integration suite needs the local Supabase stack: `pnpm test:integration`.
export default mergeConfig(preset, {
  test: {
    exclude: [...configDefaults.exclude, 'test/integration/**'],
  },
});
