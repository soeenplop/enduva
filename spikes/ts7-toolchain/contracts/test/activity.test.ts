import { describe, expect, it } from 'vitest';
import { Activity, ActivityQuery, openApiDocument } from '../src/index.js';

describe('contracts', () => {
  it('defaults the unit system to metric', () => {
    expect(ActivityQuery.parse({})).toEqual({ units: 'metric' });
  });

  it('rejects a negative distance', () => {
    const result = Activity.safeParse({
      id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
      sport: 'run',
      distance: -1,
      distanceUnit: 'km',
      startedAt: '2026-11-26T08:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('emits an OpenAPI 3.1 document with the Activity component', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
    expect(openApiDocument.components?.schemas).toHaveProperty('Activity');
  });
});
