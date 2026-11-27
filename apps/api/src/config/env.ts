import { isIP } from 'node:net';

import * as z from 'zod';

export const API_LOGIN = 'enduva_api_login';

/**
 * Query parameters a `DATABASE_URL` may carry: TLS settings only. node-postgres (pg-connection-string) lets query
 * parameters override the URL, e.g. `?user=postgres` replaces the login and `?options=-c role=…` sets session
 * settings, so every other parameter is refused.
 */
const allowedDatabaseParams = new Set(['sslmode', 'sslrootcert', 'uselibpqcompat']);

/** The login node-postgres will use: the URL's user name, with no override. `<role>.<tenant>` is Supabase's pooler. */
function connectsAsApiLogin(value: string): boolean {
  const url = URL.parse(value);
  if (url === null) return false;
  if ([...url.searchParams.keys()].some((key) => !allowedDatabaseParams.has(key))) return false;
  let user: string;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    return false;
  }
  return user === API_LOGIN || user.startsWith(`${API_LOGIN}.`);
}

/** Postgres URL of the API's login role (ADR-0002). */
const databaseUrl = z
  .url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' })
  .refine(connectsAsApiLogin, {
    error: `must connect as ${API_LOGIN} (ADR-0002), never as postgres or service_role, with no query parameters but sslmode, sslrootcert and uselibpqcompat`,
  });

/**
 * A decimal port number. Blank or whitespace-only values are rejected instead of coerced to 0, which would silently
 * bind an ephemeral port; an explicit `0` still asks for one.
 */
const port = z
  .string()
  .regex(/^\d+$/, 'must be a decimal port number')
  .transform(Number)
  .pipe(z.number().int().max(65_535));
const positiveInt = z.coerce.number().int().positive();

/** proxy-addr's named ranges, which Express accepts besides addresses and CIDRs. */
const proxyPresets = new Set(['loopback', 'linklocal', 'uniquelocal']);

/** One trusted proxy: an IP address, a CIDR with a non-zero prefix, or a named range. A hop count isn't accepted. */
function isProxyEntry(entry: string): boolean {
  if (proxyPresets.has(entry)) return true;
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * Proxies whose `X-Forwarded-For` is trusted: comma-separated addresses or CIDRs of the ingress (Traefik in Dokploy).
 * Express only honours the header when the connecting peer is in this list, so a direct client can't spoof its IP.
 * Every listed peer can, so list only Traefik, never a shared network such as Dokploy's `dokploy-network`.
 */
const trustedProxies = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  )
  .refine((entries) => entries.every(isProxyEntry), {
    error: 'must be comma-separated proxy IPs or CIDRs (or loopback, linklocal, uniquelocal), not a hop count',
  });

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** An exact issuer URL: https (plain http only on a loopback host), no trailing slash, query, fragment or credentials. */
function isIssuer(value: string): boolean {
  // An empty `?` or `#` leaves `search`/`hash` empty but would still swallow the appended JWKS path.
  if (value.includes('?') || value.includes('#')) return false;
  const url = URL.parse(value);
  if (url === null || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return false;
  // Already in normal form (lower-case host, no default port, no dot segments), so `iss` can be compared as a string.
  const normalized = url.href === value || url.href === `${value}/`;
  if (!normalized || value.endsWith('/')) return false;
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopbackHosts.has(url.hostname));
}

/** Environment of the API process. Every value is validated at boot; the process refuses to start otherwise. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Supabase transaction-pooler URL with the `enduva_api_login` role (ADR-0002). */
  DATABASE_URL: databaseUrl,
  /** Pool size per process (06-deployment → Connection budget). */
  DATABASE_POOL_MAX: positiveInt.max(100).default(10),
  /** How long a checkout may wait for a connection, queued or new, before it fails (node-postgres). */
  DATABASE_CONNECT_TIMEOUT_MS: positiveInt.max(60_000).default(5_000),
  /**
   * Supabase Auth issuer, compared exactly with a token's `iss`: `https://<project-ref>.supabase.co/auth/v1`, locally
   * `http://127.0.0.1:54321/auth/v1`. The JWKS is fetched from `<issuer>/.well-known/jwks.json`.
   */
  AUTH_ISSUER: z.string().refine(isIssuer, {
    error: 'must be the exact https issuer URL without a trailing slash (http only on a loopback host)',
  }),
  /** The one asymmetric algorithm the project signs access tokens with. HS256 and `none` are never accepted. */
  AUTH_JWT_ALGORITHM: z.enum(['ES256', 'RS256']).default('ES256'),
  /** Trusted ingress proxies (addresses/CIDRs). Empty: `X-Forwarded-For` is ignored and the socket peer is the client. */
  TRUST_PROXY: trustedProxies.default([]),
  /** Requests per client IP, endpoint and window. */
  THROTTLE_LIMIT: positiveInt.default(100),
  THROTTLE_TTL_SECONDS: positiveInt.default(60),
});

export type Env = z.output<typeof envSchema>;

export class InvalidEnvError extends Error {
  override readonly name = 'InvalidEnvError';
}

/**
 * Parses the environment. The error lists the offending variable names and the rules they break, never their
 * values: `DATABASE_URL` carries a password.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.');
    const message = issue.code === 'invalid_type' && source[name] === undefined ? 'is required' : issue.message;
    return `  ${name}: ${message}`;
  });
  throw new InvalidEnvError(`Invalid environment:\n${problems.join('\n')}`);
}
