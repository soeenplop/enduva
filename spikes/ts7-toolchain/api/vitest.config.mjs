import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite 8's oxc transform would also emit decorator metadata, but SWC keeps tests on the same emit as the build.
  plugins: [swc.vite({ swcrc: true, configFile: '../.swcrc' })],
  test: { include: ['test/**/*.test.ts'] },
});
