import { describe, expect, it } from 'vitest';
import { pagePaths, pageUrl, prerenderPaths, xDefaultUrl } from '../site.mjs';
import { localizeHref, locales } from '../src/paraglide/runtime.js';

describe('site', () => {
  it('prerenders every page under an explicit prefix for each locale, and nothing else', () => {
    const expected = locales.flatMap((locale) => pagePaths.map((path) => localizeHref(path, { locale })));
    expect([...prerenderPaths].sort()).toEqual(expected.sort());
    for (const path of prerenderPaths) expect(path).toMatch(/^\/(de|en)\/([a-z-]+\/)?$/);
  });

  it('builds canonical and x-default URLs on the production origin', () => {
    expect(pageUrl('/imprint/', 'de')).toBe('https://enduva.soeenplop.dev/de/imprint/');
    expect(pageUrl('/', 'en')).toBe('https://enduva.soeenplop.dev/en/');
    expect(xDefaultUrl('/')).toBe('https://enduva.soeenplop.dev/');
    expect(xDefaultUrl('/terms/')).toBe('https://enduva.soeenplop.dev/en/terms/');
  });
});
