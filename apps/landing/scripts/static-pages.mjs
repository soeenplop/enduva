// Static files next to the prerendered pages: the language picker at `/`, sitemap.xml, robots.txt
// and the web app manifest.
import { tokens } from '@enduva/ui/tokens';
import { pagePaths, pageUrl, siteOrigin, xDefaultUrl } from '../site.mjs';

// Paraglide's compiled output (`pnpm generate`), so the picker and the checks use the app's messages.
const { m } = await import('../src/paraglide/messages.js');
const { baseLocale, locales, localizeHref } = await import('../src/paraglide/runtime.js');

/** Files from assets/brand/final/web that the site serves from its root. */
export const brandFiles = [
  'favicon.ico',
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'og.png',
];

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A JSON value as a JavaScript literal that is safe inside an inline `<script>`. */
const scriptLiteral = (value) =>
  JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/**
 * Picks the first of the browser's languages that the site supports (`de-AT` → `de`), else the base
 * locale. Inlined into the picker page as source text, so it must stay self-contained.
 */
export function pickLocale(languages, supported, fallback) {
  for (const language of languages) {
    const primary = String(language || '')
      .toLowerCase()
      .split('-')[0];
    if (supported.includes(primary)) return primary;
  }
  return fallback;
}

const { light, dark } = tokens.colors;
const pickerStyle = [
  `body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:${tokens.fonts.body};background:${light.background};color:${light.text}}`,
  `a{color:${light.accent};font-size:${tokens.type.lead};font-weight:700}`,
  'ul{list-style:none;padding:0;display:flex;gap:2rem;justify-content:center}',
  'h1{font-size:1.5rem;text-align:center}',
  `@media (prefers-color-scheme:dark){body{background:${dark.background};color:${dark.text}}a{color:${dark.accent}}}`,
].join('');

/**
 * `/`: links to both locales and redirects to one by `navigator.languages`. Without JavaScript it
 * stays a plain page with both links.
 */
export function languagePicker() {
  const homes = Object.fromEntries(locales.map((locale) => [locale, localizeHref('/', { locale })]));
  const redirect = `(function(){var l=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];location.replace(${scriptLiteral(homes)}[(${pickLocale.toString()})(Array.prototype.slice.call(l),${scriptLiteral(locales)},${scriptLiteral(baseLocale)})]);})();`;
  const title = locales.map((locale) => m.picker_title({}, { locale })).join(' · ');
  const links = locales.map(
    (locale) =>
      `<li><a href="${homes[locale]}" hreflang="${locale}" lang="${locale}">${escape(m.language_name({}, { locale }))}</a></li>`,
  );
  const alternates = [
    ...locales.map((locale) => `<link rel="alternate" hreflang="${locale}" href="${pageUrl('/', locale)}"/>`),
    `<link rel="alternate" hreflang="x-default" href="${xDefaultUrl('/')}"/>`,
  ];
  const headings = locales.map((locale) => `<span lang="${locale}">${escape(m.picker_heading({}, { locale }))}</span>`);

  return `<!DOCTYPE html>
<html lang="${baseLocale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escape(title)}</title>
<meta name="description" content="${escape(m.meta_home_description({}, { locale: baseLocale }))}"/>
<meta name="color-scheme" content="light dark"/>
<link rel="canonical" href="${siteOrigin}/"/>
${alternates.join('\n')}
<link rel="icon" href="/favicon.ico" sizes="32x32"/>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"/>
<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>
<style>${pickerStyle}</style>
<script>${redirect}</script>
</head>
<body>
<main id="main">
<h1>${headings.join(' · ')}</h1>
<ul>
${links.join('\n')}
</ul>
</main>
</body>
</html>
`;
}

/** Every page in every locale, each with its hreflang alternates (Google's sitemap format). */
export function sitemap() {
  const urls = pagePaths.flatMap((path) =>
    locales.map((locale) => {
      const alternates = [
        ...locales.map((other) => `<xhtml:link rel="alternate" hreflang="${other}" href="${pageUrl(path, other)}"/>`),
        `<xhtml:link rel="alternate" hreflang="x-default" href="${xDefaultUrl(path)}"/>`,
      ];
      return `<url><loc>${pageUrl(path, locale)}</loc>${alternates.join('')}</url>`;
    }),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>
`;
}

export function robots() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteOrigin}/sitemap.xml\n`;
}

/** The web app manifest, in the light theme's colors. */
export function manifest() {
  return `${JSON.stringify(
    {
      name: 'Enduva',
      short_name: 'Enduva',
      start_url: '/',
      display: 'browser',
      background_color: tokens.colors.light.background,
      theme_color: tokens.colors.light.background,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    null,
    2,
  )}\n`;
}
