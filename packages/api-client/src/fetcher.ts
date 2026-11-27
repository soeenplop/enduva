/**
 * Per-call settings, passed as the generated functions' last argument. Nothing is module-global, so one SSR process
 * can serve many users at once. `baseUrl` is optional only because Orval makes that argument optional: a call without
 * it throws before any request is made.
 */
export interface ApiRequestInit extends RequestInit {
  /** Origin (and optional path prefix) of the API, e.g. `https://api.example.com`. */
  readonly baseUrl?: string;
  /** The user's Supabase access token, sent as `Authorization: Bearer …`. */
  readonly accessToken?: string;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
}

const JSON_TYPES = /^application\/(?:problem\+)?json(?:;|$)/i;

/**
 * Orval mutator: every generated call goes through here. Returns `{ data, status, headers }`, which the generated
 * per-status response types discriminate on `status` (errors are `Problem` bodies, not exceptions). Only network
 * failures throw.
 */
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { baseUrl, accessToken, fetch: fetchFn = fetch, ...request } = init;
  if (baseUrl === undefined) throw new TypeError('apiFetch: `baseUrl` is required');
  const headers = new Headers(request.headers);
  if (accessToken !== undefined) headers.set('Authorization', `Bearer ${accessToken}`);
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const res = await fetchFn(url, { ...request, headers });
  const text = await res.text();
  const data: unknown =
    text !== '' && JSON_TYPES.test(res.headers.get('content-type') ?? '') ? JSON.parse(text) : undefined;
  return { data, status: res.status, headers: res.headers } as T;
}
