import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { paraglideOptions } from './paraglide.options.mjs';
import { prerenderPaths } from './site.mjs';

export default defineConfig({
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tanstackStart({
      prerender: {
        enabled: true,
        // Only the explicit locale URLs below, never an unprefixed `/` or a crawled extra.
        autoStaticPathsDiscovery: false,
        crawlLinks: false,
        failOnError: true,
      },
      pages: prerenderPaths.map((path) => ({ path })),
    }),
    // React's plugin must come after Start's plugin.
    viteReact(),
  ],
});
