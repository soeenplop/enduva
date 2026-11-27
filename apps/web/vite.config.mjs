import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { paraglideOptions } from './paraglide.options.mjs';

export default defineConfig(({ command }) => ({
  // The production SSR bundle includes its dependencies, so the `web` image ships dist/ and srvx, but none of
  // @tanstack/react-start's build-time dependencies (Vite, Babel, Prettier). Dev keeps Vite's default.
  ...(command === 'build' && { ssr: { noExternal: true } }),
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tailwindcss(),
    tanstackStart(),
    // React's plugin must come after Start's plugin.
    viteReact(),
  ],
}));
