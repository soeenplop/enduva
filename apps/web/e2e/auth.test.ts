// Sign-in end to end (0.9b): the production build in Chromium, the built API and the local Supabase stack, with
// confirmation and magic-link mails read from Mailpit. The Turnstile widget is Cloudflare's, with its test site key.
// CI starts the stack (e2e job); locally the suite is skipped without one.
import { randomUUID } from 'node:crypto';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freePort, localStack, mailedLink, newSession, startApi } from './local-stack';
import { startPreview } from './preview';

const stack = localStack();
if (stack === undefined && process.env['CI'] === 'true') throw new Error('CI must run the local Supabase stack');

let origin = '';
let apiUrl = '';
const stops: (() => void)[] = [];
let browser: Browser;

beforeAll(async () => {
  if (stack === undefined) return;
  const api = await startApi(stack);
  apiUrl = api.url;
  stops.push(api.stop);
  const port = await freePort();
  const preview = await startPreview(
    {
      ENDUVA_API_URL: api.url,
      ENDUVA_AUTH_URL: stack.authUrl,
      ENDUVA_AUTH_PUBLISHABLE_KEY: stack.publishableKey,
      ENDUVA_WEB_ORIGIN: `http://127.0.0.1:${port}`,
      // Cloudflare's always-passing test site key; the local stack verifies with the matching test secret.
      ENDUVA_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
    port,
  );
  origin = preview.origin;
  stops.push(preview.stop);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  for (const stop of stops) stop();
});

/** A page whose uncaught errors fail the test. */
async function open() {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { page, errors, close: () => context.close() };
}

/** Waits for the Turnstile token, which enables the form's submit button. */
const submit = async (page: Page, name: string) => {
  const button = page.getByRole('button', { name, exact: true });
  await expect.poll(() => button.isEnabled(), { timeout: 20_000 }).toBe(true);
  await button.click();
};

/** The mailed link, opened on this preview (the mail points at Auth's site URL). */
const openMailedLink = async (page: Page, email: string) => {
  const link = await mailedLink(stack!, email);
  expect(link.pathname).toBe('/auth/confirm');
  await page.goto(`${origin}${link.pathname}${link.search}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.waitForURL(`${origin}/profile`);
};

describe.skipIf(stack === undefined)(`sign-in (local Supabase${stack ? '' : ': SKIPPED, not running'})`, () => {
  it('signs up, confirms by mail, edits the profile, signs out and back in', async () => {
    const { page, errors, close } = await open();
    const email = `e2e-${randomUUID()}@example.com`;
    const password = `pw-${randomUUID()}`;

    await page.goto(`${origin}/sign-up`);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await submit(page, 'Create account');
    await page.getByRole('status').filter({ hasText: 'Check your inbox' }).waitFor();

    await openMailedLink(page, email);
    await page.getByRole('heading', { name: 'Profile' }).waitFor();
    expect(await page.getByText(email).isVisible()).toBe(true);

    // The session cookie is HttpOnly and Lax, and its tokens are nowhere in the page.
    const [session] = (await page.context().cookies()).filter((c) => c.name === 'enduva-session');
    expect(session).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const [accessToken, refreshToken] = JSON.parse(Buffer.from(session!.value, 'base64url').toString()) as string[];
    const html = await page.content();
    expect(html).not.toContain(accessToken);
    expect(html).not.toContain(refreshToken);
    expect(await page.evaluate(() => document.cookie)).not.toContain('enduva-session');

    await page.getByLabel('Name').fill('Ada Runner');
    await page.getByLabel('Height (cm)').fill('171.5');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('status').filter({ hasText: 'Saved.' }).waitFor();
    await page.reload();
    expect(await page.getByLabel('Name').inputValue()).toBe('Ada Runner');
    expect(await page.getByLabel('Height (cm)').inputValue()).toBe('171.5');

    await Promise.all([page.waitForURL(`${origin}/`), page.getByRole('button', { name: 'Sign out' }).click()]);
    expect((await page.context().cookies()).some((c) => c.name === 'enduva-session')).toBe(false);
    await page.goto(`${origin}/profile`);
    await page.waitForURL(`${origin}/sign-in?redirect=%2Fprofile`);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong-password');
    await submit(page, 'Sign in');
    const failed = await page.getByRole('alert').textContent();
    expect(failed).toContain("That didn't work");

    await page.getByLabel('Password').fill(password);
    await submit(page, 'Sign in');
    await page.waitForURL(`${origin}/profile`);
    expect(await page.getByLabel('Name').inputValue()).toBe('Ada Runner');
    expect(errors).toEqual([]);
    await close();
  });

  it('answers the same for unknown emails, and signs in with a magic link', async () => {
    const { page, errors, close } = await open();
    const { email } = await newSession(stack!);
    await page.goto(`${origin}/sign-in`);

    await page.getByLabel('Email').fill(`nobody-${randomUUID()}@example.com`);
    await submit(page, 'Email me a sign-in link instead');
    const unknown = await page.getByRole('status').textContent();
    await page.getByLabel('Password').fill('any-password');
    await submit(page, 'Sign in');
    const unknownPassword = await page.getByRole('alert').textContent();

    await page.getByLabel('Email').fill(email);
    await submit(page, 'Sign in');
    expect(await page.getByRole('alert').textContent()).toBe(unknownPassword);
    await page.getByLabel('Password').fill('');
    await submit(page, 'Email me a sign-in link instead');
    await expect.poll(() => page.getByRole('status').textContent()).toBe(unknown);

    await openMailedLink(page, email);
    expect(await page.getByText(email).isVisible()).toBe(true);
    // The link is single use.
    await page.goBack();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('alert').filter({ hasText: 'invalid or has expired' }).waitFor();
    expect(errors).toEqual([]);
    await close();
  });
});

/** The session cookie the web server would set for `user`. */
const sessionCookie = (user: Awaited<ReturnType<typeof newSession>>) =>
  Buffer.from(JSON.stringify([user.accessToken, user.refreshToken, user.expiresAt])).toString('base64url');

describe.skipIf(stack === undefined)('auth pages', () => {
  // WCAG 1.4.10 Reflow, in German (the longer words): no horizontal scrolling at 320 CSS px.
  it.each(['light', 'dark'] as const)('reflow at 320 CSS px (%s)', async (colorScheme) => {
    const context = await browser.newContext({ locale: 'de-DE', colorScheme, viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    for (const path of ['/sign-in', '/sign-up', '/auth/confirm?token_hash=x']) {
      await page.goto(origin + path);
      expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBeLessThanOrEqual(320);
    }
    const user = await newSession(stack!);
    await context.addCookies([{ name: 'enduva-session', value: sessionCookie(user), url: origin }]);
    await page.goto(`${origin}/profile`);
    await page.getByRole('heading', { name: 'Profil' }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), '/profile').toBeLessThanOrEqual(320);
    await context.close();
  });
});

describe.skipIf(stack === undefined)('SSR isolation with real sessions', () => {
  /** Names the user's profile through the API, as the profile page would. */
  async function nameProfile(accessToken: string, displayName: string) {
    const headers = { authorization: `Bearer ${accessToken}` };
    const etag = (await fetch(`${apiUrl}/v1/me`, { headers })).headers.get('etag')!;
    const res = await fetch(`${apiUrl}/v1/me`, {
      method: 'PATCH',
      headers: { ...headers, 'if-match': etag, 'content-type': 'application/json' },
      body: JSON.stringify({ displayName }),
    });
    expect(res.status).toBe(200);
  }

  it('renders two users requesting the profile at once with their own data', async () => {
    const users = await Promise.all([newSession(stack!), newSession(stack!)]);
    await Promise.all(users.map((user, i) => nameProfile(user.accessToken, `Athlete ${String(i)}`)));
    const pages = await Promise.all(
      users.map(async (user) => {
        const res = await fetch(`${origin}/profile`, { headers: { cookie: `enduva-session=${sessionCookie(user)}` } });
        return res.text();
      }),
    );
    for (const [i, html] of pages.entries()) {
      expect(html).toContain(users[i]!.email);
      expect(html).toContain(`value="Athlete ${String(i)}"`);
      expect(html).not.toContain(users[1 - i]!.email);
      expect(html).not.toContain(`Athlete ${String(1 - i)}`);
    }
  });
});
