// The session cookie, the OAuth callback and the CSRF check, through the production SSR bundle against a stub Auth
// server. The app runs as https://app.example, so its cookies must be `__Host-` prefixed and Secure.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const VERIFIER = 'v'.repeat(43);
/** An unsigned token with an email claim; the web server only reads it for display. */
const jwt = (email: string) => `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`;
const cookieOf = (tokens: [string, string, number]) =>
  `__Host-enduva-session=${Buffer.from(JSON.stringify(tokens)).toString('base64url')}`;
const calls: { path: string; body: Record<string, unknown> }[] = [];

const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
  req.on('end', () => {
    const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
    calls.push({ path: req.url ?? '', body });
    const json = (status: number, value: object) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (req.url === '/auth/v1/token?grant_type=pkce' && body['auth_code'] === 'good-code')
      return body['code_verifier'] === VERIFIER
        ? json(200, { access_token: 'a.b.c', refresh_token: 'refresh-1', expires_at: 4_102_444_800 })
        : json(400, { error_code: 'bad_code_verifier' });
    if (req.url === '/auth/v1/token?grant_type=refresh_token') {
      if (body['refresh_token'] === 'refresh-ok')
        return json(200, {
          access_token: jwt('fresh@example.com'),
          refresh_token: 'refresh-2',
          expires_at: 4_102_444_800,
        });
      if (body['refresh_token'] === 'refresh-down') return json(503, {});
      return json(400, { error_code: 'refresh_token_not_found' });
    }
    return json(400, { error_code: 'unexpected' });
  });
});

type Server = { fetch(req: Request): Promise<Response> };
let server: Server;

beforeAll(async () => {
  stub.listen(0, '127.0.0.1');
  await once(stub, 'listening');
  Object.assign(process.env, {
    ENDUVA_API_URL: 'http://127.0.0.1:9',
    ENDUVA_AUTH_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}`,
    ENDUVA_AUTH_PUBLISHABLE_KEY: 'sb_publishable_test',
    ENDUVA_WEB_ORIGIN: 'https://app.example',
  });
  ({ default: server } = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
    default: Server;
  });
});

afterAll(() => {
  stub.close();
});

const oauthState = (redirect: string) =>
  `__Host-enduva-oauth=${Buffer.from(JSON.stringify([VERIFIER, redirect])).toString('base64url')}`;

const callback = (query: string, cookie?: string) =>
  server.fetch(
    new Request(`http://internal:3000/auth/callback${query}`, { headers: cookie === undefined ? {} : { cookie } }),
  );

describe('OAuth callback', () => {
  it('stores the session in a __Host- cookie and returns to the saved page', async () => {
    const res = await callback('?code=good-code', oauthState('/status?tab=1'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example/status?tab=1');
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('__Host-enduva-session='));
    expect(session).toMatch(/; Path=\/; .*HttpOnly; Secure; SameSite=Lax/i);
    expect(session).toContain(Buffer.from(JSON.stringify(['a.b.c', 'refresh-1', 4_102_444_800])).toString('base64url'));
    // The PKCE state is spent.
    expect(cookies.find((c) => c.startsWith('__Host-enduva-oauth='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('never redirects off the app', async () => {
    const res = await callback('?code=good-code', oauthState('//evil.example/'));
    expect(res.headers.get('location')).toBe('https://app.example/');
  });

  it.each([
    ['without the state cookie', '?code=good-code', undefined],
    [
      'with another verifier',
      '?code=good-code',
      `__Host-enduva-oauth=${Buffer.from('["other","/"]').toString('base64url')}`,
    ],
    ['without a code', '?error=access_denied', oauthState('/')],
  ])('goes back to sign-in %s', async (_, query, cookie) => {
    const res = await callback(query, cookie);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example/sign-in?error=oauth');
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-enduva-session='))).toBe(false);
  });
});

describe('session cookie', () => {
  it('drops a cookie that holds no JWT instead of failing the page', async () => {
    const value = Buffer.from(JSON.stringify(['not-a-jwt', 'refresh-1', 4_102_444_800])).toString('base64url');
    const res = await server.fetch(
      new Request('https://app.example/', { headers: { cookie: `__Host-enduva-session=${value}` } }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Sign in');
    expect(res.headers.getSetCookie().find((c) => c.startsWith('__Host-enduva-session='))).toMatch(
      /Max-Age=0|Expires=Thu, 01 Jan 1970/,
    );
  });

  const page = (cookie: string) => server.fetch(new Request('https://app.example/', { headers: { cookie } }));
  const sessionSetCookie = (res: Response) =>
    res.headers.getSetCookie().find((c) => c.startsWith('__Host-enduva-session='));

  it('refreshes an expiring session once per request and stores the new tokens', async () => {
    const before = calls.length;
    const res = await page(cookieOf([jwt('old@example.com'), 'refresh-ok', Math.floor(Date.now() / 1000) + 30]));
    expect(calls.slice(before).map((c) => c.path)).toEqual(['/auth/v1/token?grant_type=refresh_token']);
    expect(await res.text()).toContain('Sign out');
    expect(sessionSetCookie(res)).toContain(
      Buffer.from(JSON.stringify([jwt('fresh@example.com'), 'refresh-2', 4_102_444_800])).toString('base64url'),
    );
  });

  it('ends the session when Auth refuses the refresh token', async () => {
    const res = await page(cookieOf([jwt('old@example.com'), 'refresh-revoked', 1]));
    expect(await res.text()).toContain('Sign in');
    expect(sessionSetCookie(res)).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
  });

  it('keeps the session through an Auth outage', async () => {
    const res = await page(cookieOf([jwt('old@example.com'), 'refresh-down', 1]));
    expect(await res.text()).toContain('Sign in');
    expect(sessionSetCookie(res)).toBeUndefined();
  });

  it('keeps pages out of shared caches', async () => {
    const res = await server.fetch(new Request('https://app.example/'));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('CSRF', () => {
  const call = (headers: Record<string, string>) =>
    server.fetch(new Request('https://app.example/_serverFn/any', { method: 'POST', headers }));

  it.each([
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
    { origin: 'https://evil.example' },
    {},
  ])('refuses a server function call with %j', async (headers) => {
    expect((await call(headers)).status).toBe(403);
  });

  it('lets a same-origin call through to the function lookup', async () => {
    expect((await call({ 'sec-fetch-site': 'same-origin' })).status).not.toBe(403);
  });
});
