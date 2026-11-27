import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router';
import { tokens } from '@enduva/ui/tokens';
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
      // Brand files from assets/brand/final/web, copied to the site root by scripts/build.mjs.
      { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
      { rel: 'manifest', href: '/site.webmanifest' },
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
        {/* Rendered here rather than in `head()`, which keeps only one meta tag per name. */}
        <meta name="theme-color" content={tokens.colors.light.background} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={tokens.colors.dark.background} media="(prefers-color-scheme: dark)" />
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
