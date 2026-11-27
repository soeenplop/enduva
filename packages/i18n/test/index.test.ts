import { expect, test } from 'vitest';

import { isLocale } from '../src/index.js';

test('accepts only supported locales', () => {
  expect(isLocale('de')).toBe(true);
  expect(isLocale('en')).toBe(true);
  expect(isLocale('fr')).toBe(false);
});
