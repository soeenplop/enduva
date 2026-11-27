/**
 * Server-side configuration, read from the environment at call time (not at build time), so one image runs in every
 * environment (0.12a). Only server code may import this file.
 */

/** API origin for server-side calls. Required in production builds; `pnpm dev` defaults to the local API. */
export function apiBaseUrl(): string {
  const value = process.env['ENDUVA_API_URL'];
  if (value !== undefined && value !== '') return new URL(value).href;
  if (import.meta.env.PROD) throw new Error('ENDUVA_API_URL is not set');
  return 'http://127.0.0.1:3000';
}
