import { expect, test } from 'vitest';

import { apiPath } from '../src/index.js';

test('prefixes a route with the API version', () => {
  expect(apiPath('/activities')).toBe('/v1/activities');
});
