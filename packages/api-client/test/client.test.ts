import { describe, expect, it, vi } from 'vitest';

import { ApiResponseError, getHealth, getMe, type Me, UNEXPECTED_RESPONSE, updateMe } from '../src/index.js';

const me: Me = {
  id: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a',
  displayName: 'Synthetic Sam',
  birthDate: null,
  sex: null,
  heightCm: 181,
  locale: 'de',
  timeZone: 'Europe/Berlin',
  role: 'user',
  onboardingCompletedAt: null,
  version: 2,
};

/** A fetch stand-in that records the request and answers with one response. A string body is sent as is. */
function stub(status: number, body?: unknown, headers: Record<string, string> = {}, statusText = '') {
  const calls: Request[] = [];
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push(new Request(url, init));
    const text = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers, statusText });
  });
  return { fetch, calls };
}

let stubbed: typeof fetch;

describe('generated client', () => {
  it('sends the bearer token and If-None-Match, and returns the typed body with its ETag', async () => {
    const { fetch, calls } = stub(200, me, { 'content-type': 'application/json; charset=utf-8', etag: '"2-x"' });
    const res = await getMe(
      { 'If-None-Match': '"1-x"' },
      { baseUrl: 'https://api.example.test/prefix', accessToken: 'token', fetch },
    );
    expect(calls[0]?.url).toBe('https://api.example.test/prefix/v1/me');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer token');
    expect(calls[0]?.headers.get('if-none-match')).toBe('"1-x"');
    expect(res.status).toBe(200);
    if (res.status === 200) expect(res.data.timeZone).toBe('Europe/Berlin');
    expect(res.headers.get('etag')).toBe('"2-x"');
  });

  it('sends If-Match and the JSON body, and decodes a problem+json error by status', async () => {
    const problem = { type: 'about:blank', title: 'Precondition Failed', status: 412, code: 'precondition_failed' };
    const { fetch, calls } = stub(412, problem, { 'content-type': 'application/problem+json; charset=utf-8' });
    const res = await updateMe({ heightCm: null }, { 'If-Match': '"1-x"' }, { baseUrl: 'http://h', fetch });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.headers.get('if-match')).toBe('"1-x"');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(await calls[0]?.text()).toBe('{"heightCm":null}');
    // The status narrows the body type: a 412 carries a Problem.
    if (res.status !== 412) throw new Error(`unexpected ${res.status}`);
    expect(res.data.code).toBe('precondition_failed');
  });

  it('returns no body for a 304', async () => {
    const notModified = stub(304, undefined, { etag: '"2-x"' });
    const res = await getMe({ 'If-None-Match': '"2-x"' }, { baseUrl: 'http://h', fetch: notModified.fetch });
    expect(res).toMatchObject({ status: 304, data: undefined });
  });

  it.each([
    ['an HTML page from a proxy', 502, '<html>Bad Gateway</html>', 'text/html', 'Bad Gateway'],
    ['malformed problem JSON', 500, '{"type":"about:bl', 'application/problem+json', ''],
    ['a JSON body that is no problem', 400, '{"error":"nope"}', 'application/json', 'Bad Request'],
    ['no body', 503, undefined, 'text/plain', ''],
  ])('makes up a Problem for an error with %s, instead of throwing or returning undefined', async (...args) => {
    const [, status, body, contentType, statusText] = args;
    const { fetch } = stub(status, body, { 'content-type': contentType }, statusText);
    const res = await getHealth({}, { baseUrl: 'http://h', fetch });
    if (res.status === 200 || res.status === 304) throw new Error(`unexpected ${res.status}`);
    // The generated type promises a Problem for every error status, and it is one.
    expect(res.data.code).toBe(UNEXPECTED_RESPONSE);
    expect(res.data).toEqual({
      type: 'about:blank',
      title: statusText === '' ? 'Unexpected response' : statusText,
      status,
      code: UNEXPECTED_RESPONSE,
    });
  });

  it.each([
    ['a bodyless 204 to a GET', 204, undefined, () => getHealth({}, { baseUrl: 'http://h', fetch: stubbed })],
    [
      'a 304 to a PATCH',
      304,
      undefined,
      () => updateMe({}, { 'If-Match': '"1-x"' }, { baseUrl: 'http://h', fetch: stubbed }),
    ],
    [
      'an undocumented 201 with JSON',
      201,
      JSON.stringify(me),
      () => getMe({}, { baseUrl: 'http://h', fetch: stubbed }),
    ],
  ])('gives %s the Problem its generated type promises', async (_case, status, body, call) => {
    stubbed = stub(status, body, { 'content-type': 'application/json' }).fetch;
    const res = await call();
    expect(res.status).toBe(status);
    expect((res.data as { code: string }).code).toBe(UNEXPECTED_RESPONSE);
  });

  it('passes a real problem body through unchanged', async () => {
    const problem = { type: 'about:blank', title: 'Too Many Requests', status: 429, code: 'rate_limited', detail: 'x' };
    const { fetch } = stub(429, problem, { 'content-type': 'application/problem+json' });
    expect((await getHealth({}, { baseUrl: 'http://h', fetch })).data).toEqual(problem);
  });

  it.each([
    ['HTML', '<html>Hi</html>', 'text/html'],
    ['malformed JSON', '{"status":', 'application/json'],
    ['an empty body', '', 'application/json'],
    ['JSON null', 'null', 'application/json'],
    ['a JSON array', '[]', 'application/json'],
    ['a JSON primitive', '42', 'application/json'],
  ])('rejects a success response with %s with ApiResponseError', async (_case, body, contentType) => {
    const { fetch } = stub(200, body, { 'content-type': contentType });
    const call = getHealth({}, { baseUrl: 'http://h', fetch });
    await expect(call).rejects.toBeInstanceOf(ApiResponseError);
    await expect(call).rejects.toMatchObject({ status: 200 });
  });

  it('refuses a call without baseUrl before any request', async () => {
    const { fetch } = stub(200, { status: 'ok' });
    await expect(getHealth({}, { fetch })).rejects.toThrow('`baseUrl` is required');
    expect(fetch).not.toHaveBeenCalled();
  });
});
