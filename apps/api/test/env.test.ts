import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies the defaults', () => {
    expect(loadEnv({})).toEqual({ NODE_ENV: 'development', HOST: '0.0.0.0', PORT: 3000 });
  });

  it('coerces numbers', () => {
    expect(loadEnv({ PORT: '8080' })).toMatchObject({ PORT: 8080 });
  });

  it('keeps an explicit PORT=0 for an ephemeral port', () => {
    expect(loadEnv({ PORT: '0' })).toMatchObject({ PORT: 0 });
  });

  it.each([
    ['PORT', ''],
    ['PORT', '   '],
    ['PORT', ' 8080'],
    ['PORT', '-1'],
    ['PORT', '80.5'],
    ['PORT', 'http'],
    ['PORT', '70000'],
    ['NODE_ENV', 'staging'],
    ['HOST', ''],
  ])('refuses %s=%s', (name, value) => {
    expect(() => loadEnv({ [name]: value })).toThrow(new RegExp(`^Invalid environment:\\n  ${name}: `));
  });

  it('lists every offending variable but never a value', () => {
    let error: unknown;
    try {
      loadEnv({ PORT: 's3cret-port', NODE_ENV: 's3cret-env' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidEnvError);
    const { message } = error as Error;
    expect(message).toContain('PORT');
    expect(message).toContain('NODE_ENV');
    expect(message).not.toContain('s3cret');
  });
});
