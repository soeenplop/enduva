import { describe, expect, it, vi } from 'vitest';

import { getHealth, getMe, type Me, updateMe } from '../src/index.js';

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

/** A fetch stand-in that records the request and answers with one response. */
function stub(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const calls: Request[] = [];
  const fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    calls.push(new Request(url, init));
    const json = body === undefined ? null : JSON.stringify(body);
    return new Response(json, { status, headers });
  });
  return { fetch, calls };
}

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

  it('returns no body for a 304 or a non-JSON answer', async () => {
    const notModified = stub(304);
    expect((await getMe({}, { baseUrl: 'http://h', fetch: notModified.fetch })).data).toBeUndefined();
    const html = stub(502, undefined, { 'content-type': 'text/html' });
    const res = await getHealth({ baseUrl: 'http://h', fetch: html.fetch });
    expect(res).toMatchObject({ status: 502, data: undefined });
  });

  it('refuses a call without baseUrl before any request', async () => {
    const { fetch } = stub(200, { status: 'ok' });
    await expect(getHealth({ fetch })).rejects.toThrow('`baseUrl` is required');
    expect(fetch).not.toHaveBeenCalled();
  });
});
