// Vitest preset for NestJS packages: the shared preset plus SWC with the options of swc/nest.json, so tests run on
// the same emit as the build (legacy decorators + decorator metadata, ADR-0001). Vite's own oxc transform would also
// emit metadata, but SWC is our only emitter. The options come from the JSON file alone: no .swcrc lookup and no
// tsconfig-derived defaults.
import { readFileSync } from 'node:fs';

import swc from 'unplugin-swc';

import preset from './vitest.preset.mjs';

const { jsc, module } = JSON.parse(readFileSync(new URL('./swc/nest.json', import.meta.url), 'utf8'));

export default {
  ...preset,
  plugins: [swc.vite({ tsconfigFile: false, swcrc: false, jsc, module })],
};
