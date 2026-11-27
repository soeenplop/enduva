import { createRouter } from '@tanstack/react-router';
import { deLocalizeUrl, localizeUrl } from './paraglide/runtime.js';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  return createRouter({
    routeTree,
    // Routes are defined without a locale prefix. /de/… and /en/… map onto them.
    rewrite: {
      input: ({ url }) => deLocalizeUrl(url),
      output: ({ url }) => localizeUrl(url),
    },
  });
}
