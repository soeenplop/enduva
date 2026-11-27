import { expect, test } from 'vitest';

import { qualifiedName } from '../src/index.js';

test('quotes schema and table', () => {
  expect(qualifiedName('public', 'profiles')).toBe('"public"."profiles"');
  expect(qualifiedName('public', 'a"b')).toBe('"public"."a""b"');
});
