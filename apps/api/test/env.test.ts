import { describe, expect, it } from 'vitest';

import { InvalidEnvError, loadEnv } from '../src/config/env.js';

const url = 'postgresql://enduva_api_login.pooler-dev:s3cret-pw@127.0.0.1:54329/postgres';

describe('loadEnv', () => {
  it('applies the defaults', () => {
    expect(loadEnv({ DATABASE_URL: url })).toEqual({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL: url,
      DATABASE_POOL_MAX: 10,
      DATABASE_CONNECT_TIMEOUT_MS: 5000,
      TRUST_PROXY: [],
      THROTTLE_LIMIT: 100,
      THROTTLE_TTL_SECONDS: 60,
    });
  });

  it('coerces numbers', () => {
    expect(loadEnv({ DATABASE_URL: url, PORT: '8080', THROTTLE_LIMIT: '5' })).toMatchObject({
      PORT: 8080,
      THROTTLE_LIMIT: 5,
    });
  });

  it('reads trusted proxies as a list of addresses, CIDRs and named ranges', () => {
    expect(
      loadEnv({ DATABASE_URL: url, TRUST_PROXY: ' 10.0.1.5, 172.16.0.0/12,fd00::/8 ,uniquelocal,' }),
    ).toMatchObject({
      TRUST_PROXY: ['10.0.1.5', '172.16.0.0/12', 'fd00::/8', 'uniquelocal'],
    });
    expect(loadEnv({ DATABASE_URL: url, TRUST_PROXY: '' })).toMatchObject({ TRUST_PROXY: [] });
  });

  it('keeps an explicit PORT=0 for an ephemeral port', () => {
    expect(loadEnv({ DATABASE_URL: url, PORT: '0' })).toMatchObject({ PORT: 0 });
  });

  it('refuses a missing DATABASE_URL', () => {
    expect(() => loadEnv({})).toThrow(new InvalidEnvError('Invalid environment:\n  DATABASE_URL: is required'));
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
    ['TRUST_PROXY', '1'],
    ['TRUST_PROXY', '0.0.0.0/0'],
    ['TRUST_PROXY', '10.0.0.0/33'],
    ['TRUST_PROXY', '10.0.0.0/8/1'],
    ['TRUST_PROXY', '10.0.0.0/255.0.0.0'],
    ['TRUST_PROXY', 'traefik'],
    ['THROTTLE_LIMIT', '-1'],
    ['THROTTLE_TTL_SECONDS', '0'],
    ['DATABASE_POOL_MAX', '0'],
    ['DATABASE_CONNECT_TIMEOUT_MS', '0'],
    ['DATABASE_URL', 'mysql://enduva_api_login@localhost/db'],
    ['DATABASE_URL', 'not a url'],
  ])('refuses %s=%s', (name, value) => {
    expect(() => loadEnv({ DATABASE_URL: url, [name]: value })).toThrow(
      new RegExp(`^Invalid environment:\\n  ${name}: `),
    );
  });

  it.each(['postgres', 'service_role', 'enduva_worker_login', 'enduva_api_login_x'])(
    'refuses to connect as %s',
    (user) => {
      const other = url.replace('enduva_api_login.pooler-dev', user);
      expect(() => loadEnv({ DATABASE_URL: other })).toThrow('DATABASE_URL: must connect as enduva_api_login');
    },
  );

  it.each([
    ['a user parameter', `${url}?user=postgres`],
    ['a user parameter after TLS settings', `${url}?sslmode=require&user=service_role`],
    ['session options', `${url}?options=-c%20role%3Dpostgres`],
    ['a host override', `${url}?host=10.0.0.9`],
    ['a malformed escape in the user name', url.replace('enduva_api_login.pooler-dev', 'enduva_api_login.%E0%A4%A')],
  ])('refuses a DATABASE_URL with %s, without echoing it', (_case, value) => {
    expect(() => loadEnv({ DATABASE_URL: value })).toThrow('DATABASE_URL: must connect as enduva_api_login');
    expect(() => loadEnv({ DATABASE_URL: value })).not.toThrow(/s3cret-pw|10\.0\.0\.9/);
  });

  it('accepts TLS settings', () => {
    const tls = `${url}?sslmode=verify-full&sslrootcert=/etc/ssl/supabase.crt`;
    expect(loadEnv({ DATABASE_URL: tls }).DATABASE_URL).toBe(tls);
  });

  it('accepts the direct login without a pooler tenant', () => {
    const direct = 'postgresql://enduva_api_login:pw@127.0.0.1:54322/postgres';
    expect(loadEnv({ DATABASE_URL: direct }).DATABASE_URL).toBe(direct);
  });

  it('lists every offending variable but never a value', () => {
    let error: unknown;
    try {
      loadEnv({ DATABASE_URL: 'postgresql://postgres:s3cret-pw@127.0.0.1:54322/postgres', PORT: 's3cret-port' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidEnvError);
    const { message } = error as Error;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain('s3cret');
  });
});
