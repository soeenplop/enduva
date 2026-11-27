import { defineCustomClientStrategy, isLocale } from './paraglide/runtime.js';

/**
 * The browser uses the locale the server resolved for this page (`<html lang>`), never its own preferences: if
 * `navigator.languages` differed from `Accept-Language`, hydration would render another language than the server did.
 * Switching sets the cookie and reloads (the cookie strategy), so this strategy stores nothing.
 */
defineCustomClientStrategy('custom-document', {
  getLocale: () => {
    const lang = typeof document === 'undefined' ? undefined : document.documentElement.lang;
    return lang !== undefined && isLocale(lang) ? lang : undefined;
  },
  setLocale: () => {},
});
