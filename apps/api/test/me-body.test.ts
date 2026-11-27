import { Me } from '@enduva/contracts';
import { profiles } from '@enduva/db';
import { describe, expect, it } from 'vitest';

import { toMe } from '../src/me/me.controller.js';

const row = {
  id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
  displayName: null,
  birthDate: null,
  sex: null,
  heightCm: null,
  locale: 'de',
  timeZone: 'Europe/Berlin',
  role: 'user',
  version: 1,
} as const;

/** What Drizzle makes of the driver's value for `profiles.onboarding_completed_at`. */
const fromDriver = (value: string) => profiles.onboardingCompletedAt.mapFromDriverValue(value) as Date;

describe('the /v1/me response body', () => {
  it('sends the onboarding time as an ISO string, or null', () => {
    const at = fromDriver('2026-11-27 08:00:00.123+00');
    expect(toMe({ ...row, onboardingCompletedAt: at }).onboardingCompletedAt).toBe('2026-11-27T08:00:00.123Z');
    expect(toMe({ ...row, onboardingCompletedAt: null }).onboardingCompletedAt).toBeNull();
  });

  it.each(['infinity', '-infinity'])('sends PostgreSQL %s as null instead of failing', (value) => {
    const at = fromDriver(value);
    expect(Number.isNaN(at.getTime())).toBe(true);
    const body = toMe({ ...row, onboardingCompletedAt: at });
    expect(body.onboardingCompletedAt).toBeNull();
    // The wire value is unchanged from before the contracts (JSON.stringify of the row) and fits the contract.
    expect(JSON.parse(JSON.stringify(body))).toEqual(JSON.parse(JSON.stringify({ ...row, onboardingCompletedAt: at })));
    expect(Me.strict().parse(body)).toEqual(body);
  });
});
