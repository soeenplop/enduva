import * as z from 'zod';

/**
 * A decimal port number. Blank or whitespace-only values are rejected instead of coerced to 0, which would silently
 * bind an ephemeral port; an explicit `0` still asks for one.
 */
const port = z
  .string()
  .regex(/^\d+$/, 'must be a decimal port number')
  .transform(Number)
  .pipe(z.number().int().max(65_535));

/** Environment of the API process. Every value is validated at boot; the process refuses to start otherwise. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: port.default(3000),
});

export type Env = z.output<typeof envSchema>;

export class InvalidEnvError extends Error {
  override readonly name = 'InvalidEnvError';
}

/**
 * Parses the environment. The error lists the offending variable names and the rules they break, never their
 * values, which can be secrets.
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
