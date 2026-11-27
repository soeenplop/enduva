// Smoke test of the production build in Chromium (`vite preview` serves dist/). The API is deliberately unreachable,
// so /status must render "down" instead of failing.
import { type ChildProcess, spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const origin = 'http://127.0.0.1:4310';
let preview: ChildProcess;
let browser: Browser;

beforeAll(async () => {
  preview = spawn('node_modules/.bin/vite', ['preview', '--host', '127.0.0.1', '--port', '4310', '--strictPort'], {
    cwd: new URL('..', import.meta.url),
    // Port 9 (discard) refuses connections: the API is down.
    env: { ...process.env, ENDUVA_API_URL: 'http://127.0.0.1:9' },
    stdio: 'inherit',
  });
  for (
    let i = 0;
    i < 50 &&
    !(await fetch(origin).then(
      (r) => r.ok,
      () => false,
    ));
    i++
  )
    await delay(200);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  preview?.kill();
});

/** A page whose uncaught errors (hydration errors included) fail the test. */
async function open(options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext({ locale: 'en-US', ...options });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) errors.push(msg.text());
  });
  return { page, errors, close: () => context.close() };
}

const lang = (page: Page) => page.locator('html').getAttribute('lang');
const heading = (page: Page) => page.locator('h1').textContent();

describe('web app shell', () => {
  it('switches the language and keeps it across reloads', async () => {
    const { page, errors, close } = await open();
    await page.goto(origin);
    expect(await lang(page)).toBe('en');
    expect(await heading(page)).toBe('Welcome to Enduva');

    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Deutsch' }).click()]);
    expect(await lang(page)).toBe('de');
    expect(await heading(page)).toBe('Willkommen bei Enduva');
    expect(await page.getByRole('button', { name: 'Deutsch' }).getAttribute('aria-pressed')).toBe('true');

    await page.reload();
    expect(await heading(page)).toBe('Willkommen bei Enduva');
    const cookie = (await page.context().cookies()).find((c) => c.name === 'enduva-locale');
    expect(cookie).toMatchObject({ value: 'de', sameSite: 'Lax' });
    expect(errors).toEqual([]);
    await close();
  });

  it('navigates to the status page in the browser', async () => {
    const { page, errors, close } = await open();
    await page.goto(origin);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Status' }).click();
    // Client-side navigation: the loader calls the server function, then the page renders.
    await page.getByRole('heading', { name: 'Service status' }).waitFor();
    expect(page.url()).toBe(`${origin}/status`);
    expect(await page.locator('#status-api').getAttribute('data-state')).toBe('down');
    expect(await page.getByRole('link', { name: 'Status' }).getAttribute('aria-current')).toBe('page');
    expect(await page.getByRole('link', { name: 'Home', exact: true }).getAttribute('aria-current')).toBeNull();
    expect(errors).toEqual([]);
    await close();
  });

  it('answers unknown URLs with the localized 404 page', async () => {
    const { page, close } = await open({ locale: 'de-DE' });
    const res = await page.goto(`${origin}/no-such-page`);
    expect(res?.status()).toBe(404);
    expect(await heading(page)).toBe('Seite nicht gefunden');
    await close();
  });

  // WCAG 1.4.10 Reflow: no horizontal scrolling at 320 CSS px.
  it.each(['light', 'dark'] as const)('reflows at 320 CSS px (%s)', async (colorScheme) => {
    const { page, close } = await open({ locale: 'de-DE', colorScheme, viewport: { width: 320, height: 640 } });
    for (const path of ['/', '/status', '/no-such-page']) {
      await page.goto(origin + path);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, path).toBeLessThanOrEqual(320);
    }
    await close();
  });
});
