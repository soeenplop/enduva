import { describe, expect, it } from 'vitest';

import { meUpdateSchema } from '../src/me/me.schema.js';

const parse = (body: unknown) => meUpdateSchema.safeParse(body);

describe('PATCH /v1/me body', () => {
  it('accepts a partial update, trims names and clears fields with null', () => {
    expect(parse({ displayName: '  Ada  ', heightCm: 172.5, locale: 'en' }).data).toEqual({
      displayName: 'Ada',
      heightCm: 172.5,
      locale: 'en',
    });
    expect(parse({ displayName: null, birthDate: null, sex: null, heightCm: null }).success).toBe(true);
    expect(parse({ birthDate: '1990-02-28', sex: 'female', onboardingCompleted: true }).success).toBe(true);
  });

  it('takes IANA time zones as the runtime spells them, and nothing else', () => {
    // Stored as ICU's canonical ID: case normalised (also within the location) and aliases mapped.
    for (const [input, stored] of [
      ['Europe/Berlin', 'Europe/Berlin'],
      ['europe/berlin', 'Europe/Berlin'],
      ['Europe/berlin', 'Europe/Berlin'],
      ['America/port-au-prince', 'America/Port-au-Prince'],
      ['Asia/Kolkata', 'Asia/Calcutta'],
      ['Asia/Calcutta', 'Asia/Calcutta'],
      ['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'],
      ['Etc/UTC', 'UTC'],
      ['UTC', 'UTC'],
      ['Etc/GMT+1', 'Etc/GMT+1'],
    ])
      expect(parse({ timeZone: input }).data).toEqual({ timeZone: stored });
    // ICU-only IDs, legacy abbreviations and offsets that Intl accepts but IANA tzdb consumers may not.
    for (const timeZone of ['SystemV/EST5', 'PST', 'EST5EDT', 'US/Eastern', '+01:00', 'Mars/Olympus', ''])
      expect(parse({ timeZone }).success).toBe(false);
    for (const timeZone of ['Europe/Berlin; drop', null]) expect(parse({ timeZone }).success).toBe(false);
  });

  it.each([
    ['an empty object', {}],
    ['no object', 'displayName=Ada'],
    ['a missing body', undefined],
    ['the role', { role: 'admin' }],
    ['the version', { version: 7 }],
    ['an unknown field', { displayName: 'Ada', nickname: 'A' }],
    ['a blank name', { displayName: '   ' }],
    ['a name over 100 characters', { displayName: 'a'.repeat(101) }],
    ['a name with NUL', { displayName: 'Ada\u0000' }],
    ['a name with a control character', { displayName: 'Ada\u001b[31m' }],
    ['a name with a C1 control character', { displayName: 'Ada\u0085' }],
    ['a name with an unpaired surrogate', { displayName: 'Ada\ud800' }],
    ['an impossible date', { birthDate: '1990-02-30' }],
    ['a date in the future', { birthDate: '2999-01-01' }],
    ['a date before 1900', { birthDate: '1899-12-31' }],
    ['a date with a time', { birthDate: '1990-02-28T00:00:00Z' }],
    ['another sex value', { sex: 'other' }],
    ['a height out of range', { heightCm: 20 }],
    ['a height as string', { heightCm: '180' }],
    ['another locale', { locale: 'fr' }],
    ['a null locale', { locale: null }],
    ['onboardingCompleted false', { onboardingCompleted: false }],
  ])('refuses %s', (_case, body) => {
    expect(parse(body).success).toBe(false);
  });
});
