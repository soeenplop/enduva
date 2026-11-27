import type { ReactNode } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import type { RouterContext } from '../router';

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: m.meta_title() },
    ],
  }),
  // The shell wraps every page, the error and not-found pages included.
  shellComponent: RootDocument,
  component: Outlet,
  notFoundComponent: () => <h1>{m.not_found_title()}</h1>,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        <main id="main">{children}</main>
        <Scripts />
      </body>
    </html>
  );
}
