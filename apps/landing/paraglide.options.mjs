// Shared by the Vite plugin and the pre-typecheck compile step, so both emit the same runtime
// (ADR-0001, pitfall 4). Every locale has an explicit prefix: /de/… and /en/…, never an unprefixed
// base-locale URL.
import { fileURLToPath } from 'node:url';

export const paraglideOptions = {
  // Absolute, so the compile step and the Vite plugin load the same project whatever their cwd.
  project: fileURLToPath(new URL('./project.inlang', import.meta.url)),
  outdir: './src/paraglide',
  // The README embeds the absolute project path, so a Turbo cache hit restored in another checkout
  // would differ from what the Vite build writes. Nothing reads it; every other file is
  // path-independent, which scripts/build.mjs enforces.
  emitReadme: false,
  strategy: ['url', 'baseLocale'],
  emitTsDeclarations: true,
  // Same on-disk output for tsc and for Vite (the plugin otherwise defaults to virtual modules).
  outputStructure: 'message-modules',
  urlPatterns: [
    {
      pattern: '/:path(.*)?',
      localized: [
        ['de', '/de/:path(.*)?'],
        ['en', '/en/:path(.*)?'],
      ],
    },
  ],
};

/**
 * What the Vite plugin adds on its own in a production build (`vite build`). The compile step for
 * `tsc` passes these too, so scripts/build.mjs can require byte-identical output.
 */
export const viteBuildOverrides = {
  isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
  isDevelopment: 'false',
};
