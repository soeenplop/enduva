import { paraglideVitePlugin } from '@inlang/paraglide-js';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { paraglideOptions } from './paraglide.options.mjs';

export default defineConfig({
  server: { port: 3000 },
  plugins: [
    paraglideVitePlugin(paraglideOptions),
    tailwindcss(),
    tanstackStart(),
    // React's plugin must come after Start's plugin.
    viteReact(),
  ],
});
