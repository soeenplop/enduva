import { getLocale, locales } from './paraglide/runtime.js';
import { pageUrl, siteOrigin, xDefaultUrl } from '../site.mjs';

export { pageUrl, xDefaultUrl };

const ogLocales = { de: 'de_DE', en: 'en_US' } as const satisfies Record<(typeof locales)[number], string>;

export interface PageHeadInput {
  /** The page's path without a locale prefix, as in `site.mjs` (`/`, `/imprint/`). */
  path: string;
  title: string;
  description: string;
}

/**
 * Head tags of a page in the current locale: title, description, the canonical URL, `hreflang`
 * alternates for every locale plus `x-default`, and Open Graph / Twitter tags with the OG image.
 */
export function pageHead({ path, title, description }: PageHeadInput) {
  const locale = getLocale();
  const url = pageUrl(path, locale);
  const image = `${siteOrigin}/og.png`;
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: 'Enduva' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: url },
      { property: 'og:image', content: image },
      { property: 'og:image:width', content: '1200' },
      { property: 'og:image:height', content: '630' },
      { property: 'og:image:alt', content: 'Enduva' },
      { property: 'og:locale', content: ogLocales[locale] },
      ...locales
        .filter((other) => other !== locale)
        .map((other) => ({ property: 'og:locale:alternate', content: ogLocales[other] })),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
      { name: 'twitter:image', content: image },
    ],
    links: [
      { rel: 'canonical', href: url },
      ...locales.map((other) => ({ rel: 'alternate', hrefLang: other, href: pageUrl(path, other) })),
      { rel: 'alternate', hrefLang: 'x-default', href: xDefaultUrl(path) },
    ],
  };
}
