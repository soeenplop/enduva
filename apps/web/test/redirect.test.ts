import { describe, expect, it } from 'vitest';
import { safeRedirect } from '../src/auth/redirect';

describe('safeRedirect', () => {
  it.each(['/', '/profile', '/profile?tab=units#name', '/status/%2F%2Fevil.example'])('keeps the app path %s', (path) =>
    expect(safeRedirect(path)).toBe(path),
  );

  it.each([
    undefined,
    42,
    '',
    'profile',
    'https://evil.example/',
    'javascript:alert(1)',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\/evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/sign-in',
    '/sign-up?x=1',
    '/auth/confirm?token_hash=x',
    `/${'a'.repeat(2048)}`,
  ])('refuses %j', (value) => expect(safeRedirect(value)).toBe('/'));

  it('uses the given fallback', () => expect(safeRedirect('//evil.example', '/profile')).toBe('/profile'));
});
