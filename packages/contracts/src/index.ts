/** Prefixes an API route with the current API version, e.g. `/activities` → `/v1/activities`. */
export function apiPath(route: `/${string}`): `/v1/${string}` {
  return `/v1${route}`;
}
