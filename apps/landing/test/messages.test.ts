import { readFileSync } from 'node:fs';
import { locales as sharedLocales } from '@enduva/i18n';
import { describe, expect, it } from 'vitest';
import { m } from '../src/paraglide/messages.js';
import { locales } from '../src/paraglide/runtime.js';

const catalog = (locale: string): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8'));

describe('messages', () => {
  it('uses the locales of @enduva/i18n', () => {
    expect([...locales].sort()).toEqual([...sharedLocales].sort());
  });

  it('has the same non-empty keys in every catalog', () => {
    const [first, ...rest] = locales.map((locale) => catalog(locale));
    const keys = Object.keys(first ?? {}).sort();
    for (const other of rest) expect(Object.keys(other).sort()).toEqual(keys);
    for (const messages of [first, ...rest])
      for (const value of Object.values(messages ?? {})) expect(value.trim()).not.toBe('');
  });

  // A plugin that fails to load is only a warning in Paraglide and yields empty messages (ADR-0001, pitfall 3).
  it('compiles translated messages for de and en', () => {
    expect(m.hero_title({}, { locale: 'de' })).toBe('Ausdauer, Kraft und Ernährung in einer App');
    expect(m.hero_title({}, { locale: 'en' })).toBe('Endurance, strength and nutrition in one app');
    expect(m.placeholder_notice({ task: 'G1.1' }, { locale: 'de' })).toBe(
      'Platzhalter, der endgültige Text folgt in G1.1.',
    );
    expect(m.placeholder_notice({ task: 'G1.1' }, { locale: 'en' })).toBe('Placeholder, final text follows in G1.1.');
  });
});
