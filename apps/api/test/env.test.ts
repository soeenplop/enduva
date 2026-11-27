import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies the defaults', () => {
    expect(loadEnv({})).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      THROTTLE_LIMIT: 100,
      THROTTLE_TTL_SECONDS: 60,
    });
  });

  it('coerces numbers', () => {
    expect(loadEnv({ PORT: '8080', THROTTLE_LIMIT: '5', TRUST_PROXY: '1' })).toMatchObject({
      PORT: 8080,
      THROTTLE_LIMIT: 5,
      TRUST_PROXY: 1,
    });
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
    ['LOG_LEVEL', 'verbose'],
    ['TRUST_PROXY', 'true'],
    ['THROTTLE_LIMIT', '-1'],
    ['THROTTLE_TTL_SECONDS', '0'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => loadEnv({ [name]: value })).toThrow(new RegExp(`^Invalid environment:\\n  ${name}: `));
  });

  it('lists every offending variable but never a value', () => {
    let error: unknown;
    try {
      loadEnv({ PORT: 's3cret-port', LOG_LEVEL: 's3cret-level' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidEnvError);
    const { message } = error as Error;
    expect(message).toContain('PORT');
    expect(message).toContain('LOG_LEVEL');
    expect(message).not.toContain('s3cret');
  });
});
