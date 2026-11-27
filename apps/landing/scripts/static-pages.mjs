// Static files next to the prerendered pages: the language picker at `/`.

// Paraglide's compiled output (`pnpm generate`), so the picker and the checks use the app's messages.
const { m } = await import('../src/paraglide/messages.js');
const { baseLocale, locales, localizeHref } = await import('../src/paraglide/runtime.js');

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
  const headings = locales.map((locale) => `<span lang="${locale}">${escape(m.picker_heading({}, { locale }))}</span>`);

  return `<!DOCTYPE html>
<html lang="${baseLocale}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escape(title)}</title>
<meta name="description" content="${escape(m.meta_home_description({}, { locale: baseLocale }))}"/>
<meta name="color-scheme" content="light dark"/>
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
