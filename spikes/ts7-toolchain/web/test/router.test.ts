import { describe, expect, it } from 'vitest';
import { getRouter } from '../src/router';

describe('getRouter', () => {
  it('creates a new QueryClient for every router (one per SSR request)', () => {
    const a = getRouter().options.context.queryClient;
    const b = getRouter().options.context.queryClient;
    expect(a).not.toBe(b);
  });
});
