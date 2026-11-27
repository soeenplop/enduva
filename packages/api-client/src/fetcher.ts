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
 * The `code` of the problem this client makes up when an error response carries no problem body (a proxy's HTML 502,
 * a truncated body). The API never sends it.
 */
export const UNEXPECTED_RESPONSE = 'unexpected_response';

/** A success response without the JSON body its generated type promises. Holds no part of the body. */
export class ApiResponseError extends Error {
  override readonly name = 'ApiResponseError';

  constructor(readonly status: number) {
    super(`apiFetch: ${status} response without a JSON body`);
  }
}

interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
}

const isProblem = (body: unknown): body is ProblemBody => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return false;
  const { type, title, status, code, detail } = body as Record<string, unknown>;
  return (
    typeof type === 'string' &&
    typeof title === 'string' &&
    typeof code === 'string' &&
    Number.isInteger(status) &&
    (detail === undefined || typeof detail === 'string')
  );
};

function parseJson(text: string, contentType: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === '' || !JSON_TYPES.test(contentType ?? '')) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Orval mutator: every generated call goes through here. Returns `{ data, status, headers }`, which the generated
 * per-status response types discriminate on `status`, and `data` always has the type they promise for the current
 * operations (which declare `200`, `304` on GETs, and problem responses for everything else, so Orval puts any other
 * status, `204` and a PATCH `304` included, in the `Problem` arm):
 *
 * - A `304` to a `GET` or `HEAD` has no body (`undefined`).
 * - `200` carries its parsed JSON object (not validated against the schema). Without a JSON object body (empty,
 *   malformed, `null`, an array or a primitive), the call rejects with `ApiResponseError`.
 * - Every other status carries a `Problem`: the response's problem body, or, if it has none (an HTML page from a
 *   proxy, malformed JSON, a bodyless `204`, an undocumented `201`), a made-up one with `code: UNEXPECTED_RESPONSE`
 *   and the response's status.
 *
 * So a call throws only on network failures, without `baseUrl`, and with `ApiResponseError`. An operation that later
 * declares another success status (e.g. `201` or `204`) must extend these rules.
 */
export async function apiFetch<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const { baseUrl, accessToken, fetch: fetchFn = fetch, ...request } = init;
  if (baseUrl === undefined) throw new TypeError('apiFetch: `baseUrl` is required');
  const headers = new Headers(request.headers);
  if (accessToken !== undefined) headers.set('Authorization', `Bearer ${accessToken}`);
  const url = new URL(path.replace(/^\//, ''), baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const res = await fetchFn(url, { ...request, headers });
  const { status } = res;
  const result = (data: unknown) => ({ data, status, headers: res.headers }) as T;
  const method = (request.method ?? 'GET').toUpperCase();
  if (status === 304 && (method === 'GET' || method === 'HEAD')) return result(undefined);
  const body = parseJson(await res.text(), res.headers.get('content-type'));
  if (status === 200) {
    if (!body.ok || typeof body.value !== 'object' || body.value === null || Array.isArray(body.value)) {
      throw new ApiResponseError(status);
    }
    return result(body.value);
  }
  if (body.ok && isProblem(body.value)) return result(body.value);
  const title = res.statusText === '' ? 'Unexpected response' : res.statusText;
  return result({ type: 'about:blank', title, status, code: UNEXPECTED_RESPONSE } satisfies ProblemBody);
}
