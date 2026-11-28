import type { ReactNode } from 'react';
import { createRootRouteWithContext, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { tokens } from '@enduva/ui/tokens';
import manrope from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import { viewerQuery } from '../auth/queries';
import { AppHeader } from '../components/AppHeader';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import type { RouterContext } from '../router';
import stylesheet from '../styles.css?url';

export const Route = createRootRouteWithContext<RouterContext>()({
  // Every page knows whether someone is signed in; the session itself stays on the server.
  beforeLoad: async ({ context }) => ({ viewer: await context.queryClient.ensureQueryData(viewerQuery) }),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: m.meta_title() },
    ],
    links: [
      { rel: 'preload', href: manrope, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: stylesheet },
    ],
  }),
  // The shell wraps every page, the error and not-found pages included.
  shellComponent: RootDocument,
  component: Outlet,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
        {/* Rendered here rather than in `head()`, which keeps only one meta tag per name. */}
        <meta name="theme-color" content={tokens.colors.light.background} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={tokens.colors.dark.background} media="(prefers-color-scheme: dark)" />
      </head>
      <body className="flex min-h-screen flex-col bg-background font-body text-text">
        <a className="absolute -top-full left-4 z-10 bg-surface px-4 py-2 focus:top-4" href="#main">
          {m.skip_to_content()}
        </a>
        <AppHeader />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 focus:outline-none">
          {children}
        </main>
        <Scripts />
      </body>
    </html>
  );
}
