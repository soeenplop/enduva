/**
 * Server-side configuration, read from the environment at call time (not at build time), so one image runs in every
 * environment (0.12a). Only server code may import this file.
 */

const env = (name: string): string | undefined => {
  const value = process.env[name];
  return value === undefined || value === '' ? undefined : value;
};

function required(name: string, devDefault?: string): string {
  const value = env(name) ?? (import.meta.env.PROD ? undefined : devDefault);
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}

/** API origin for server-side calls. Required in production builds; `pnpm dev` defaults to the local API. */
export function apiBaseUrl(): string {
  return new URL(required('ENDUVA_API_URL', 'http://127.0.0.1:3000')).href;
}

/** Supabase project URL (Auth lives under `/auth/v1`). `pnpm dev` defaults to the local stack. */
export function authBaseUrl(): string {
  return new URL(required('ENDUVA_AUTH_URL', 'http://127.0.0.1:54321')).href;
}

/** Supabase publishable key, sent as `apikey`. Always required: locally it comes from `supabase status`. */
export function authPublishableKey(): string {
  return required('ENDUVA_AUTH_PUBLISHABLE_KEY');
}

/**
 * The public origin of this web app (`https://app.enduva.de`). It decides the session cookie's `Secure`
 * flag and builds the OAuth callback URL, so it never comes from request headers in production. `pnpm dev` falls back
 * to the request's own origin.
 */
export function webOrigin(requestUrl: string): string {
  const value = env('ENDUVA_WEB_ORIGIN');
  if (value !== undefined) return new URL(value).origin;
  if (import.meta.env.PROD) throw new Error('ENDUVA_WEB_ORIGIN is not set');
  return new URL(requestUrl).origin;
}

/** Cloudflare's documented test site key: always passes, and only works with the test secret (supabase/config.toml). */
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA';

/** Turnstile site key (public). `pnpm dev` defaults to Cloudflare's test key. */
export function turnstileSiteKey(): string {
  return required('ENDUVA_TURNSTILE_SITE_KEY', TURNSTILE_TEST_SITE_KEY);
}
