// Checks the landing app's static prerender output: /de/ and /en/ exist as static HTML,
// carry the matching <html lang>, contain the translated copy and link to the other locale.
// There is no unprefixed page: dist/client/index.html must not exist.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'landing/dist/client';
const expected = {
  de: { title: 'Training, Ernährung und Erholung an einem Ort', otherHref: '/en/' },
  en: { title: 'Train, eat and recover in one place', otherHref: '/de/' },
};
const failures = [];

// The `lang` attribute of the opening <html> tag (not `data-lang` or any other attribute ending in "lang").
function htmlLang(html) {
  const tag = html.match(/<html(\s[^>]*)?>/i)?.[1] ?? '';
  const attrs = [...tag.matchAll(/\s([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)];
  const lang = attrs.filter(([, name]) => name.toLowerCase() === 'lang');
  return lang.length === 1 ? (lang[0][2] ?? lang[0][3] ?? lang[0][4] ?? '') : undefined;
}

const unprefixed = join(outDir, 'index.html');
if (existsSync(unprefixed)) failures.push(`${unprefixed} exists, expected no unprefixed page`);

for (const [locale, { title, otherHref }] of Object.entries(expected)) {
  const file = join(outDir, locale, 'index.html');
  if (!existsSync(file)) {
    failures.push(`${file} missing`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  const lang = htmlLang(html);
  if (lang !== locale)
    failures.push(
      `${file}: expected <html lang="${locale}">, got ${lang === undefined ? 'no single lang attribute' : `lang="${lang}"`}`,
    );
  if (!html.includes(`<h1>${title}</h1>`)) failures.push(`${file}: translated title missing`);
  if (!html.includes(`href="${otherHref}"`)) failures.push(`${file}: link to ${otherHref} missing`);
  if (failures.length === 0) console.log(`ok   ${file}: lang="${locale}", translated, links to ${otherHref}`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
