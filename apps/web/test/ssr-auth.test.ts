// The session cookies and the CSRF check, through the production SSR bundle against a stub Auth server. The app
// runs as https://app.example, so its cookies must be `__Host-` prefixed and Secure.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** An unsigned token with an email claim; the web server only reads it for display. */
const jwt = (email: string) => `e30.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.sig`;
const encode = (tokens: [string, string, number]) => Buffer.from(JSON.stringify(tokens)).toString('base64url');
const LOGIN_A = 'AAAAAAAAAAAAAAAA';
const LOGIN_B = 'BBBBBBBBBBBBBBBB';

/** A browser's cookie jar for this origin, applying responses' `Set-Cookie` the way a browser does. */
class Jar {
  readonly cookies = new Map<string, string>();
  constructor(entries: Record<string, string> = {}) {
    for (const [name, value] of Object.entries(entries)) this.cookies.set(name, value);
  }
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }
  apply(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair = ''] = line.split(';');
      const name = pair.slice(0, pair.indexOf('='));
      if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, pair.slice(pair.indexOf('=') + 1));
    }
  }
}

/** A browser signed in as login `id` with these tokens. */
const signedIn = (id: string, tokens: [string, string, number]) =>
  new Jar({ '__Host-enduva-login': id, [`__Host-enduva-session-${id}`]: encode(tokens) });

/** Refresh calls wait for this before Auth answers, so a test can act while one is in flight. */
let refreshGate: Promise<void> = Promise.resolve();
const calls: { path: string; body: Record<string, unknown> }[] = [];

const stub = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
  req.on('end', () => {
    const body = raw === '' ? {} : (JSON.parse(raw) as Record<string, unknown>);
    calls.push({ path: req.url ?? '', body });
    const json = (status: number, value: object) =>
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value));
    if (req.url === '/auth/v1/token?grant_type=refresh_token') {
      return void refreshGate.then(() => {
        if (body['refresh_token'] === 'refresh-ok')
          return json(200, {
            access_token: jwt('fresh@example.com'),
            refresh_token: 'refresh-2',
            expires_at: 4_102_444_800,
          });
        if (body['refresh_token'] === 'refresh-down') return json(503, {});
        return json(400, { error_code: 'refresh_token_not_found' });
      });
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

describe('session cookies', () => {
  const page = (jar: Jar) => server.fetch(new Request('https://app.example/', { headers: { cookie: jar.header() } }));
  const expiring = (refreshToken: string): [string, string, number] => [
    jwt('a@example.com'),
    refreshToken,
    Math.floor(Date.now() / 1000) + 30,
  ];

  it('drops a session that holds no JWT instead of failing the page', async () => {
    const jar = signedIn(LOGIN_A, ['not-a-jwt', 'refresh-1', 4_102_444_800]);
    const res = await page(jar);
    expect(res.status).toBe(200);
    jar.apply(res);
    expect(jar.cookies.has(`__Host-enduva-session-${LOGIN_A}`)).toBe(false);
  });

  it('refreshes an expiring session once per request and stores the new tokens for the same login', async () => {
    const jar = signedIn(LOGIN_A, expiring('refresh-ok'));
    const before = calls.length;
    const res = await page(jar);
    expect(calls.slice(before).map((c) => c.path)).toEqual(['/auth/v1/token?grant_type=refresh_token']);
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(
      /^__Host-enduva-session-A{16}=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax/i,
    );
    jar.apply(res);
    expect(jar.cookies.get(`__Host-enduva-session-${LOGIN_A}`)).toBe(
      encode([jwt('fresh@example.com'), 'refresh-2', 4_102_444_800]),
    );
  });

  it('ends the login when Auth refuses the refresh token', async () => {
    const jar = signedIn(LOGIN_A, expiring('refresh-revoked'));
    jar.apply(await page(jar));
    expect(jar.cookies.has(`__Host-enduva-session-${LOGIN_A}`)).toBe(false);
  });

  it('keeps the session through an Auth outage', async () => {
    const res = await page(signedIn(LOGIN_A, expiring('refresh-down')));
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ['a refresh', 'refresh-ok'],
    ['a refused refresh', 'refresh-revoked'],
  ])('lets a late %s leave a newer login alone', async (_, refreshToken) => {
    // Tab 1 is still refreshing login A when tab 2 signs in as B (the cookies a sign-in sets).
    let release = () => {};
    refreshGate = new Promise((resolve) => (release = resolve));
    const jar = signedIn(LOGIN_A, expiring(refreshToken));
    const late = page(jar);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sessionB = encode([jwt('b@example.com'), 'refresh-b', 4_102_444_800]);
    jar.cookies.set('__Host-enduva-login', LOGIN_B);
    jar.cookies.set(`__Host-enduva-session-${LOGIN_B}`, sessionB);
    release();
    jar.apply(await late);
    refreshGate = Promise.resolve();
    expect(jar.cookies.get('__Host-enduva-login')).toBe(LOGIN_B);
    expect(jar.cookies.get(`__Host-enduva-session-${LOGIN_B}`)).toBe(sessionB);
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
