// Single source for the site's pages. Read by vite.config.mjs (prerender list) and by
// scripts/build.mjs (picker, static checks).
import settings from './project.inlang/settings.json' with { type: 'json' };

/** The public repository, linked from the licence note. */
export const repositoryUrl = 'https://github.com/soeenplop/enduva';

/** @type {readonly string[]} */
export const locales = settings.locales;

/**
 * Every page as the router sees it (without a locale prefix). Each one is prerendered under
 * /de/… and /en/…; nothing is prerendered without a prefix. `/` itself is the static language
 * picker written by scripts/build.mjs.
 */
export const pagePaths = ['/', '/imprint/', '/privacy/', '/terms/', '/disclaimer/', '/data-sources/'];

/** `/imprint/` → `/de/imprint/`. */
export const localizedPath = (locale, path) => `/${locale}${path}`;

/** The concrete URLs the prerenderer renders: every page in every locale. */
export const prerenderPaths = locales.flatMap((locale) => pagePaths.map((path) => localizedPath(locale, path)));
