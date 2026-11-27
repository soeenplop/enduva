import { expect, test } from 'vitest';

import { metresToKilometres } from '../src/index.js';

test('converts metres to kilometres', () => {
  expect(metresToKilometres(42_195)).toBe(42.195);
});
