import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { paraglideOptions } from './paraglide.options.mjs';

export default defineConfig({
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tanstackStart({
      prerender: {
        enabled: true,
        // Only the explicit locale URLs below (plus links crawled from them), never an unprefixed `/`.
        autoStaticPathsDiscovery: false,
        crawlLinks: true,
        failOnError: true,
      },
      pages: [{ path: '/de/' }, { path: '/en/' }],
    }),
    // React's plugin must come after Start's plugin.
    viteReact(),
  ],
});
