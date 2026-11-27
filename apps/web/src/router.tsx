// Registers the browser's locale strategy before anything renders.
import './locale';
import { QueryClient } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { routeTree } from './routeTree.gen';

export interface RouterContext {
  readonly queryClient: QueryClient;
}

/**
 * Start calls this once per SSR request (and once in the browser), so every request gets its own
 * QueryClient. Never hoist the QueryClient to module scope: one server process serves many users,
 * and a shared cache would hand one user's data to another (02-architecture.md, Web).
 */
export function getRouter() {
  const queryClient = new QueryClient();
  const router = createRouter({
    routeTree,
    context: { queryClient } satisfies RouterContext,
    scrollRestoration: true,
    defaultPreload: 'intent',
  });
  // Dehydrates the queries the loaders fetched during SSR into the page and hydrates them in the browser.
  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}
