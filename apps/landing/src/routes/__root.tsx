import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import manrope from '@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url';
import type { ReactNode } from 'react';
import { SiteFooter } from '../components/SiteFooter';
import { SiteHeader } from '../components/SiteHeader';
import { m } from '../paraglide/messages.js';
import { getLocale } from '../paraglide/runtime.js';
import stylesheet from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
    ],
    links: [
      { rel: 'preload', href: manrope, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' },
      { rel: 'stylesheet', href: stylesheet },
    ],
  }),
  component: () => (
    <RootDocument>
      <Outlet />
    </RootDocument>
  ),
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang={getLocale()}>
      <head>
        <HeadContent />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {m.skip_to_content()}
        </a>
        <SiteHeader />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <SiteFooter />
        <Scripts />
      </body>
    </html>
  );
}
