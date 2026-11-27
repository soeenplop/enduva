// Shared by the Vite plugin and the pre-typecheck compile step, so both emit the same runtime.
// Every locale has an explicit prefix: /de/… and /en/… (no unprefixed base-locale URLs).
export const paraglideOptions = {
  project: './project.inlang',
  outdir: './src/paraglide',
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
