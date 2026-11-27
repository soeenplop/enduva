import { describe, expect, it } from 'vitest';
import { m } from '../src/paraglide/messages.js';
import { localizeHref } from '../src/paraglide/runtime.js';

describe('paraglide', () => {
  it('compiles messages for de and en', () => {
    expect(m.hero_title({}, { locale: 'de' })).toBe('Training, Ernährung und Erholung an einem Ort');
    expect(m.hero_title({}, { locale: 'en' })).toBe('Train, eat and recover in one place');
  });

  it('prefixes every locale explicitly', () => {
    expect(localizeHref('/', { locale: 'de' })).toBe('/de/');
    expect(localizeHref('/', { locale: 'en' })).toBe('/en/');
  });
});
