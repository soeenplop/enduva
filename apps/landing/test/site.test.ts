import { describe, expect, it } from 'vitest';
import { pagePaths, prerenderPaths } from '../site.mjs';
import { localizeHref, locales } from '../src/paraglide/runtime.js';

describe('site', () => {
  it('prerenders every page under an explicit prefix for each locale, and nothing else', () => {
    const expected = locales.flatMap((locale) => pagePaths.map((path) => localizeHref(path, { locale })));
    expect([...prerenderPaths].sort()).toEqual(expected.sort());
    for (const path of prerenderPaths) expect(path).toMatch(/^\/(de|en)\/([a-z-]+\/)?$/);
  });
});
