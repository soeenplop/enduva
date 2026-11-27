import * as z from 'zod';

const API_LOGIN = 'enduva_api_login';

/** Postgres URL of the API's login role. `<role>.<tenant>` is the user name format of Supabase's pooler. */
const databaseUrl = z.url({ protocol: /^postgres(ql)?$/, error: 'must be a postgres:// or postgresql:// URL' }).refine(
  (value) => {
    const user = decodeURIComponent(URL.parse(value)?.username ?? '');
    return user === API_LOGIN || user.startsWith(`${API_LOGIN}.`);
  },
  { error: `must connect as ${API_LOGIN} (ADR-0002), never as postgres or service_role` },
);

const port = z.coerce.number().int().min(0).max(65_535);
const positiveInt = z.coerce.number().int().positive();

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
  /** Number of reverse proxies in front of the API whose `X-Forwarded-For` is trusted (Traefik: 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Requests per client IP and window. */
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
