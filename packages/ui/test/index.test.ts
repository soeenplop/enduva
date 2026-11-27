import { expect, test } from 'vitest';

import { cx } from '../src/index.js';

test('joins truthy class names', () => {
  expect(cx('btn', false, null, undefined, 'btn-active')).toBe('btn btn-active');
});
