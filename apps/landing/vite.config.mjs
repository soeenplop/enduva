import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { paraglideOptions } from './paraglide.options.mjs';
import { prerenderPaths } from './site.mjs';

export default defineConfig({
  // The prerender step serves the build with `vite preview` and fetches the pages from it. Pinned to IPv4 loopback:
  // where /etc/hosts maps `localhost` to ::1 first (Debian container images), the server listened on ::1 while the
  // prerender fetched from 127.0.0.1 and failed.
  preview: { host: '127.0.0.1' },
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
