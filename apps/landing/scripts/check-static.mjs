// Checks the static output in dist/client (ported from the spike's check-prerender.mjs, ADR-0001):
//
// - Exactly the expected HTML files: every page under each locale prefix plus the picker at `/`,
//   and no unprefixed duplicate such as dist/client/imprint/index.html.
// - Each page: the opening <html> tag's own `lang`, the translated heading, a canonical URL,
//   hreflang alternates for every locale plus x-default, Open Graph / Twitter tags, links to the
//   page in the other locale, the ELv2 note with the repository link, and internal links that all
//   carry a locale prefix.
// - The picker links to every locale, has the home page's hreflang alternates and redirects by
//   `navigator.languages` (its inline script is run in a sandbox).
// - sitemap.xml lists every page in every locale, and robots.txt, the manifest and the brand files
//   are in place.
//
// Usage: node scripts/check-static.mjs [dist/client] (scripts/build.mjs runs it after every build).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { pagePaths, pageUrl, repositoryUrl, siteOrigin, xDefaultUrl } from '../site.mjs';
import { brandFiles } from './static-pages.mjs';

const { m } = await import('../src/paraglide/messages.js');
const { baseLocale, locales, localizeHref } = await import('../src/paraglide/runtime.js');

/** The heading each page must show, and the roadmap task its placeholder notice names. */
const expectedPages = {
  '/': { heading: (locale) => m.hero_title({}, { locale }) },
  '/imprint/': { heading: (locale) => m.page_imprint({}, { locale }), task: 'G1.1' },
  '/privacy/': { heading: (locale) => m.page_privacy({}, { locale }), task: 'G1.1' },
  '/terms/': { heading: (locale) => m.page_terms({}, { locale }), task: 'G1.1' },
  '/disclaimer/': { heading: (locale) => m.page_disclaimer({}, { locale }), task: 'G1.1' },
  '/data-sources/': { heading: (locale) => m.page_data_sources({}, { locale }), task: 'G1.2' },
};
const ogLocales = { de: 'de_DE', en: 'en_US' };

/** Strips tags (until none are left) and decodes the entities React emits: the text a page shows. */
function stripTags(text) {
  let previous;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return text;
}

const decode = (text) =>
  stripTags(text)
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The attributes (lower-cased names) of every opening `<name …>` tag. */
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}(\\s[^>]*)?>`, 'gi'))].map(([, attrs = '']) => {
    const parsed = [...attrs.matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
    return parsed.map(([, key, a, b, c]) => [key.toLowerCase(), decode(a ?? b ?? c ?? '')]);
  });
}

const attr = (tag, key) => {
  const values = tag.filter(([k]) => k === key);
  return values.length === 1 ? values[0][1] : undefined;
};
const metas = (html, key, value) => tags(html, 'meta').filter((tag) => attr(tag, key) === value);
const content = (html, key, value) => metas(html, key, value).map((tag) => attr(tag, 'content'));

/** `hreflang` alternates: one per locale plus `x-default`, all absolute, nothing else. */
function checkAlternates(links, path, fail) {
  const alternates = links
    .filter((tag) => attr(tag, 'rel') === 'alternate')
    .map((tag) => `${attr(tag, 'hreflang')} ${attr(tag, 'href')}`)
    .sort();
  const want = [...locales.map((other) => `${other} ${pageUrl(path, other)}`), `x-default ${xDefaultUrl(path)}`].sort();
  if (alternates.join('|') !== want.join('|'))
    fail(`hreflang alternates:\n    want ${want.join('\n         ')}\n    got  ${alternates.join('\n         ')}`);
}

function checkPage(outDir, path, locale, failures) {
  const href = localizeHref(path, { locale });
  const file = join(outDir, href, 'index.html');
  const label = relative(process.cwd(), file);
  const fail = (message) => failures.push(`${label}: ${message}`);
  if (!existsSync(file)) return fail('missing');
  const html = readFileSync(file, 'utf8');
  const before = failures.length;

  const htmlTags = tags(html, 'html');
  const lang = htmlTags.length === 1 ? attr(htmlTags[0], 'lang') : undefined;
  if (lang !== locale) fail(`expected <html lang="${locale}">, got ${lang ?? 'no single lang attribute'}`);

  const heading = expectedPages[path].heading(locale);
  const h1 = [...html.matchAll(/<h1(?:\s[^>]*)?>(.*?)<\/h1>/gs)].map(([, text]) => decode(text));
  if (h1.length !== 1 || h1[0] !== heading) fail(`expected one <h1> "${heading}", got ${JSON.stringify(h1)}`);
  const task = expectedPages[path].task;
  if (task && !decode(html).includes(m.placeholder_notice({ task }, { locale })))
    fail(`placeholder notice for ${task} missing`);

  const url = pageUrl(path, locale);
  const links = tags(html, 'link');
  const canonical = links.filter((tag) => attr(tag, 'rel') === 'canonical').map((tag) => attr(tag, 'href'));
  if (canonical.length !== 1 || canonical[0] !== url) fail(`expected canonical ${url}, got ${canonical.join(', ')}`);
  checkAlternates(links, path, fail);

  const title = [...html.matchAll(/<title>(.*?)<\/title>/gs)].map(([, text]) => decode(text));
  const description = content(html, 'name', 'description');
  if (title.length !== 1 || !title[0]) fail('expected one non-empty <title>');
  if (description.length !== 1 || !description[0]) fail('expected one non-empty meta description');
  const og = {
    'og:title': title[0],
    'og:description': description[0],
    'og:url': url,
    'og:image': `${siteOrigin}/og.png`,
    'og:locale': ogLocales[locale],
  };
  for (const [property, value] of Object.entries(og)) {
    const got = content(html, 'property', property);
    if (got.length !== 1 || got[0] !== value) fail(`expected ${property} "${value}", got ${JSON.stringify(got)}`);
  }
  for (const [name, value] of Object.entries({
    'twitter:card': 'summary_large_image',
    'twitter:image': og['og:image'],
  })) {
    const got = content(html, 'name', name);
    if (got.length !== 1 || got[0] !== value) fail(`expected ${name} "${value}", got ${JSON.stringify(got)}`);
  }

  const anchors = tags(html, 'a').map((tag) => attr(tag, 'href') ?? '');
  for (const other of locales.filter((l) => l !== locale)) {
    const otherHref = localizeHref(path, { locale: other });
    if (!anchors.includes(otherHref)) fail(`link to ${otherHref} missing`);
  }
  if (!anchors.includes(repositoryUrl) || !decode(html).includes(m.footer_licence({}, { locale })))
    fail(`ELv2 licence note with a link to ${repositoryUrl} missing`);
  const unprefixed = anchors.filter(
    (href) => href.startsWith('/') && !locales.some((l) => href.startsWith(localizeHref('/', { locale: l }))),
  );
  if (unprefixed.length > 0) fail(`internal links without a locale prefix: ${unprefixed.join(', ')}`);

  if (failures.length === before) console.log(`ok   ${label}: lang="${locale}", canonical, hreflang, OG tags`);
}

function checkPicker(outDir, failures) {
  const file = join(outDir, 'index.html');
  const fail = (message) => failures.push(`${relative(process.cwd(), file)}: ${message}`);
  if (!existsSync(file)) return fail('missing (the language picker at /)');
  const html = readFileSync(file, 'utf8');
  const before = failures.length;
  const links = tags(html, 'link');
  const canonical = links.filter((tag) => attr(tag, 'rel') === 'canonical').map((tag) => attr(tag, 'href'));
  if (canonical.join() !== `${siteOrigin}/`) fail(`expected canonical ${siteOrigin}/, got ${canonical.join(', ')}`);
  checkAlternates(links, '/', fail);
  const anchors = tags(html, 'a').map((tag) => attr(tag, 'href'));
  for (const locale of locales) {
    const home = localizeHref('/', { locale });
    if (!anchors.includes(home)) fail(`link to ${home} missing`);
  }
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(([, code]) => code);
  if (scripts.length !== 1) return fail(`expected one inline redirect script, got ${scripts.length}`);
  const cases = [
    [['de-AT', 'en'], 'de'],
    [['de'], 'de'],
    [['en-GB', 'de'], 'en'],
    [['fr-FR', 'de-CH'], 'de'],
    [['fr-FR'], baseLocale],
    [[], baseLocale],
  ];
  for (const [languages, locale] of cases) {
    let target;
    runInNewContext(scripts[0], {
      navigator: { languages, language: languages[0] },
      location: { replace: (url) => (target = url) },
    });
    const want = localizeHref('/', { locale });
    if (target !== want) fail(`navigator.languages ${JSON.stringify(languages)} redirects to ${target}, want ${want}`);
  }
  if (failures.length === before)
    console.log(`ok   ${relative(process.cwd(), file)}: picker links, hreflang and redirects`);
}

export async function checkStatic(outDir) {
  const failures = [];

  const expectedHtml = new Set([
    'index.html',
    ...pagePaths.flatMap((path) =>
      locales.map((locale) => join(localizeHref(path, { locale }), 'index.html').slice(1).split('/').join(sep)),
    ),
  ]);
  const html = readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.html'));
  for (const file of html) if (!expectedHtml.has(file)) failures.push(`unexpected page ${file}`);
  if (Object.keys(expectedPages).sort().join() !== [...pagePaths].sort().join())
    failures.push('check-static.mjs expectations are out of sync with site.mjs pagePaths');

  for (const path of pagePaths) for (const locale of locales) checkPage(outDir, path, locale, failures);
  checkPicker(outDir, failures);

  const sitemapFile = join(outDir, 'sitemap.xml');
  const sitemap = existsSync(sitemapFile) ? readFileSync(sitemapFile, 'utf8') : '';
  const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map(([, loc]) => loc).sort();
  const wantLocs = pagePaths.flatMap((path) => locales.map((locale) => pageUrl(path, locale))).sort();
  if (locs.join('|') !== wantLocs.join('|')) failures.push(`sitemap.xml: expected <loc> ${wantLocs.join(', ')}`);

  const robots = existsSync(join(outDir, 'robots.txt')) ? readFileSync(join(outDir, 'robots.txt'), 'utf8') : '';
  if (!robots.includes(`Sitemap: ${siteOrigin}/sitemap.xml`)) failures.push('robots.txt: Sitemap line missing');

  const manifest = JSON.parse(readFileSync(join(outDir, 'site.webmanifest'), 'utf8'));
  const assets = [...brandFiles, ...manifest.icons.map((icon) => icon.src.slice(1))];
  for (const name of assets) if (!existsSync(join(outDir, name))) failures.push(`${name} missing`);

  if (failures.length === 0) console.log(`ok   ${html.length} HTML files, sitemap.xml, robots.txt, manifest and icons`);
  return failures;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const failures = await checkStatic(process.argv[2] ?? 'dist/client');
  if (failures.length > 0) {
    console.error(`\nStatic output check failed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
}
