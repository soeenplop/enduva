// @expect TS2322 at 7:3
import type { Activity } from '../src/index.js';

// The inferred contract type rejects a sport that is not in the enum.
export const activity: Activity = {
  id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
  sport: 'swimrun',
  distance: 10,
  distanceUnit: 'km',
  startedAt: '2026-11-26T08:00:00Z',
};
