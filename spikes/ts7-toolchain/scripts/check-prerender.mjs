// Checks the landing app's static prerender output: /de/ and /en/ exist as static HTML,
// carry the matching <html lang>, contain the translated copy and link to the other locale.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'landing/dist/client';
const expected = {
  de: { title: 'Training, Ernährung und Erholung an einem Ort', otherHref: '/en/' },
  en: { title: 'Train, eat and recover in one place', otherHref: '/de/' },
};
const failures = [];

for (const [locale, { title, otherHref }] of Object.entries(expected)) {
  const file = join(outDir, locale, 'index.html');
  if (!existsSync(file)) {
    failures.push(`${file} missing`);
    continue;
  }
  const html = readFileSync(file, 'utf8');
  if (!new RegExp(`<html[^>]*\\blang="${locale}"`).test(html)) failures.push(`${file}: <html lang="${locale}"> missing`);
  if (!html.includes(`<h1>${title}</h1>`)) failures.push(`${file}: translated title missing`);
  if (!html.includes(`href="${otherHref}"`)) failures.push(`${file}: link to ${otherHref} missing`);
  if (failures.length === 0) console.log(`ok   ${file}: lang="${locale}", translated, links to ${otherHref}`);
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
