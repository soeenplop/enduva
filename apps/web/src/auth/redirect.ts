const BASE = 'http://enduva.invalid';

/**
 * Where to go after signing in: a path on this app, or `fallback`. Anything that could leave the app (absolute and
 * protocol-relative URLs, backslashes that browsers read as slashes, control characters, which the URL parser strips)
 * and the auth pages themselves are refused.
 */
export function safeRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.length > 2048) return fallback;
  if (/[\\\p{Cc}]/u.test(value) || value.startsWith('//')) return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  // Checked again after normalisation: dot segments (`/a/..//x`, `/%2e%2e//x`) can leave a protocol-relative path.
  if (url.origin !== BASE || url.pathname.startsWith('//')) return fallback;
  if (['/sign-in', '/sign-up'].includes(url.pathname) || url.pathname.startsWith('/auth/')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
