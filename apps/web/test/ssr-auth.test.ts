// The session cookies, the OAuth callback and the CSRF check, through the production SSR bundle against a stub Auth server. The app
// runs as https://app.example, so its cookies must be `__Host-` prefixed and Secure.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** An unsigned token with `sub` and `email`; the web server only reads them for display. */
const jwt = (email: string) =>
  `e30.${Buffer.from(JSON.stringify({ sub: `user-${email}`, email })).toString('base64url')}.sig`;
const encode = (tokens: [string, string, number]) => Buffer.from(JSON.stringify(tokens)).toString('base64url');
const VERIFIER = 'v'.repeat(43);
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

/** A browser signed in as login `id` in `slot` with these tokens. */
const signedIn = (id: string, tokens: [string, string, number], slot: 'a' | 'b' = 'a') =>
  new Jar({ '__Host-enduva-login': `${slot}.${id}`, [`__Host-enduva-session-${slot}`]: `${id}.${encode(tokens)}` });

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
    if (req.url === '/auth/v1/token?grant_type=pkce' && body['auth_code'] === 'good-code')
      return body['code_verifier'] === VERIFIER
        ? json(200, { access_token: 'a.b.c', refresh_token: 'refresh-1', expires_at: 4_102_444_800 })
        : json(400, { error_code: 'bad_code_verifier' });
    if (req.url === '/auth/v1/token?grant_type=refresh_token') {
      return void refreshGate.then(() => {
        if (body['refresh_token'] === 'refresh-ok')
          return json(200, {
            access_token: jwt('fresh@example.com'),
            refresh_token: 'refresh-2',
            expires_at: 4_102_444_800,
          });
        if (body['refresh_token'] === 'refresh-huge')
          return json(200, {
            access_token: `e30.${'x'.repeat(4000)}.sig`,
            refresh_token: 'r',
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

const oauthState = (redirect: string) =>
  `__Host-enduva-oauth=${Buffer.from(JSON.stringify([VERIFIER, redirect])).toString('base64url')}`;

const callback = (query: string, cookie?: string) =>
  server.fetch(
    new Request(`http://internal:3000/auth/callback${query}`, { headers: cookie === undefined ? {} : { cookie } }),
  );

describe('OAuth callback', () => {
  it('signs in with a new __Host- login and returns to the saved page', async () => {
    const res = await callback('?code=good-code', oauthState('/status?tab=1'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://app.example/status?tab=1');
    const jar = new Jar({ '__Host-enduva-oauth': 'x' });
    jar.apply(res);
    const pointer = jar.cookies.get('__Host-enduva-login') ?? '';
    expect(pointer).toMatch(/^a\.[A-Za-z0-9_-]{16}$/);
    expect(jar.cookies.get('__Host-enduva-session-a')).toBe(
      `${pointer.slice(2)}.${encode(['a.b.c', 'refresh-1', 4_102_444_800])}`,
    );
    for (const line of res.headers.getSetCookie().filter((c) => !c.startsWith('__Host-enduva-oauth=')))
      expect(line).toMatch(/; Path=\/; HttpOnly; Secure; SameSite=Lax/i);
    // The PKCE state is spent.
    expect(jar.cookies.has('__Host-enduva-oauth')).toBe(false);
  });

  it('keeps the fixed cookie set however many sign-ins overlap', async () => {
    // Forty sign-ins (Google callbacks) in two waves, each wave sent from one snapshot of an A-signed-in browser and
    // answered in shuffled order.
    const jar = signedIn(LOGIN_A, [jwt('a@example.com'), 'refresh-a', 4_102_444_800]);
    const fixed = ['__Host-enduva-ended', '__Host-enduva-login', '__Host-enduva-session-a', '__Host-enduva-session-b'];
    for (let wave = 0; wave < 2; wave++) {
      const cookie = `${jar.header()}; ${oauthState('/')}`;
      const answers = await Promise.all(Array.from({ length: 20 }, () => callback('?code=good-code', cookie)));
      for (const res of answers.sort(() => Math.random() - 0.5)) jar.apply(res);
      for (const name of jar.cookies.keys()) expect(fixed).toContain(name);
      expect(Buffer.byteLength(jar.header())).toBeLessThan(8 * 1024);
    }
    // The browser ends up in one consistent login: the pointer's ID is the one in its slot.
    const [slot, id] = (jar.cookies.get('__Host-enduva-login') ?? '').split('.');
    expect(jar.cookies.get(`__Host-enduva-session-${slot ?? ''}`)?.startsWith(`${id ?? ''}.`)).toBe(true);
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
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-enduva-login='))).toBe(false);
    // An unverified callback leaves a pending sign-in's state alone.
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-enduva-oauth='))).toBe(false);
  });
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
    expect(jar.cookies.has('__Host-enduva-session-a')).toBe(false);
  });

  it('refreshes an expiring session once per request and stores the new tokens in the same slot', async () => {
    const jar = signedIn(LOGIN_A, expiring('refresh-ok'));
    const before = calls.length;
    const res = await page(jar);
    expect(calls.slice(before).map((c) => c.path)).toEqual(['/auth/v1/token?grant_type=refresh_token']);
    const set = res.headers.getSetCookie();
    expect(set).toHaveLength(1);
    expect(set[0]).toMatch(
      /^__Host-enduva-session-a=A{16}\.[^;]+; Max-Age=2592000; Path=\/; HttpOnly; Secure; SameSite=Lax/i,
    );
    jar.apply(res);
    expect(jar.cookies.get('__Host-enduva-session-a')).toBe(
      `${LOGIN_A}.${encode([jwt('fresh@example.com'), 'refresh-2', 4_102_444_800])}`,
    );
  });

  it('ends the login when Auth refuses the refresh token', async () => {
    const jar = signedIn(LOGIN_A, expiring('refresh-revoked'));
    jar.apply(await page(jar));
    expect(jar.cookies.has('__Host-enduva-session-a')).toBe(false);
  });

  it('keeps the session through an Auth outage', async () => {
    const res = await page(signedIn(LOGIN_A, expiring('refresh-down')));
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it.each([
    ['a refresh', 'refresh-ok'],
    ['a refused refresh', 'refresh-revoked'],
  ])('lets a late %s leave a newer login alone', async (_, refreshToken) => {
    // Tab 1 is still refreshing login A (slot a) when tab 2 signs in as B, which takes slot b.
    let release = () => {};
    refreshGate = new Promise((resolve) => (release = resolve));
    const jar = signedIn(LOGIN_A, expiring(refreshToken));
    const late = page(jar);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const sessionB = `${LOGIN_B}.${encode([jwt('b@example.com'), 'refresh-b', 4_102_444_800])}`;
    jar.cookies.set('__Host-enduva-login', `b.${LOGIN_B}`);
    jar.cookies.set('__Host-enduva-session-b', sessionB);
    release();
    jar.apply(await late);
    refreshGate = Promise.resolve();
    expect(jar.cookies.get('__Host-enduva-login')).toBe(`b.${LOGIN_B}`);
    expect(jar.cookies.get('__Host-enduva-session-b')).toBe(sessionB);
  });

  it.each([
    ['still valid', [jwt('a@example.com'), 'refresh-ok', 4_102_444_800] as [string, string, number]],
    ['expiring', expiring('refresh-ok')],
  ])('keeps a signed-out login dead when a late refresh wrote it back (%s)', async (_, tokens) => {
    // Sign-out of A marked it ended; a refresh of A that answered afterwards stored A's tokens again.
    const jar = signedIn(LOGIN_A, tokens);
    jar.cookies.set('__Host-enduva-ended-a', `${LOGIN_A}.local`);
    const before = calls.length;
    jar.apply(await page(jar));
    expect(calls.length).toBe(before);
    expect(jar.cookies.has('__Host-enduva-session-a')).toBe(false);
    expect(jar.cookies.get('__Host-enduva-ended-a')).toBe(`${LOGIN_A}.local`);
  });

  it("keeps a newer login's local sign-out when an older sign-out answers late", async () => {
    // A (slot a) signs out; before that answer lands, B signs in (slot b) and signs out locally. A late refresh of B
    // even put B's tokens back. Then A's sign-out answer arrives: it deletes slot a and marks A in slot a's marker.
    const tokensB = `${LOGIN_B}.${encode([jwt('b@example.com'), 'refresh-b', 4_102_444_800])}`;
    const jar = new Jar({
      '__Host-enduva-login': `b.${LOGIN_B}`,
      '__Host-enduva-session-b': tokensB,
      '__Host-enduva-ended-b': `${LOGIN_B}.local`,
      '__Host-enduva-ended-a': `${LOGIN_A}.revoked`,
    });
    const before = calls.length;
    const res = await page(jar);
    expect(await res.text()).not.toContain('b@example.com');
    expect(calls.length).toBe(before);
    jar.apply(res);
    expect(jar.cookies.has('__Host-enduva-session-b')).toBe(false);
    expect(jar.cookies.get('__Host-enduva-ended-b')).toBe(`${LOGIN_B}.local`);
  });

  it('signs out, never switches, when another login ended up in the active slot', async () => {
    // Overlapping sign-ins: the pointer names A in slot a, but slot a holds C's tokens.
    const jar = signedIn(LOGIN_A, [jwt('a@example.com'), 'refresh-a', 4_102_444_800]);
    jar.cookies.set(
      '__Host-enduva-session-a',
      `CCCCCCCCCCCCCCCC.${encode([jwt('c@example.com'), 'r', 4_102_444_800])}`,
    );
    const before = calls.length;
    const res = await page(jar);
    expect(await res.text()).not.toContain('c@example.com');
    expect(calls.length).toBe(before);
  });

  it('keeps the fixed cookie set however many refresh answers overlap', async () => {
    // Twenty requests from one snapshot are in flight at once; all of their answers land afterwards.
    let release = () => {};
    refreshGate = new Promise((resolve) => (release = resolve));
    const jar = signedIn(LOGIN_A, expiring('refresh-ok'));
    jar.cookies.set('__Host-enduva-ended-b', `${LOGIN_B}.local`);
    const header = jar.header();
    const answers = Array.from({ length: 20 }, () =>
      server.fetch(new Request('https://app.example/', { headers: { cookie: header } })),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    for (const res of await Promise.all(answers)) jar.apply(res);
    refreshGate = Promise.resolve();
    expect([...jar.cookies.keys()].sort()).toEqual([
      '__Host-enduva-ended-b',
      '__Host-enduva-login',
      '__Host-enduva-session-a',
    ]);
  });

  it('signs out cleanly when a refreshed session would exceed the cookie budget', async () => {
    const jar = signedIn(LOGIN_A, expiring('refresh-huge'));
    const res = await page(jar);
    for (const line of res.headers.getSetCookie()) expect(line.length).toBeLessThan(4096);
    jar.apply(res);
    expect(jar.cookies.has('__Host-enduva-session-a')).toBe(false);
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
