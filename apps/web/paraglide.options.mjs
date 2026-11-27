// Shared by the Vite plugin and the pre-typecheck compile step, so both emit the same runtime
// (ADR-0001, pitfall 4). The web app has no locale in its URLs: the locale is resolved per request
// (02-architecture.md, Internationalisation). The cookie stands in for the user setting until the
// profile exists (0.9b); then comes `Accept-Language` (`preferredLanguage`), then `en`.
import { fileURLToPath } from 'node:url';

export const paraglideOptions = {
  // Absolute, so the compile step and the Vite plugin load the same project whatever their cwd.
  project: fileURLToPath(new URL('./project.inlang', import.meta.url)),
  outdir: './src/paraglide',
  // The README embeds the absolute project path (see apps/landing/paraglide.options.mjs).
  emitReadme: false,
  strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
  cookieName: 'enduva-locale',
  cookieSameSite: 'lax',
  // `Secure` on https (production), so the cookie still works on http://localhost in development.
  cookieSecure: 'auto',
  emitTsDeclarations: true,
  // Same on-disk output for tsc and for Vite (the plugin otherwise defaults to virtual modules).
  outputStructure: 'message-modules',
};

/**
 * What the Vite plugin adds on its own in a production build (`vite build`). The compile step for
 * `tsc` passes these too, so scripts/build.mjs can require byte-identical output.
 */
export const viteBuildOverrides = {
  isServer: "import.meta.env?.SSR ?? typeof window === 'undefined'",
  isDevelopment: 'false',
};
