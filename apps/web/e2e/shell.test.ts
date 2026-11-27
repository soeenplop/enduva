// Smoke test of the production build in Chromium (`vite preview` serves dist/). The API is deliberately unreachable,
// so /status must render "down" instead of failing.
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { type Browser, chromium, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let origin = '';
let preview: ChildProcess;
let browser: Browser;

/** A port that was free a moment ago, so no other server (another build, another run) answers on it. */
async function freePort() {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}

beforeAll(async () => {
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  preview = spawn(
    'node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      // Port 9 (discard) refuses connections: the API is down.
      env: { ...process.env, ENDUVA_API_URL: 'http://127.0.0.1:9' },
      stdio: 'inherit',
    },
  );
  let exit: number | null | undefined;
  preview.on('exit', (code) => (exit = code));
  for (let attempt = 0, ready = false; !ready; attempt++) {
    // Fail instead of testing whatever else might answer if our server died (for example, port taken after all).
    if (exit !== undefined) throw new Error(`vite preview exited with code ${String(exit)}`);
    if (attempt === 150) throw new Error(`vite preview did not answer on ${origin} within 30 s`);
    ready = await fetch(origin).then(
      (r) => r.ok,
      () => false,
    );
    if (!ready) await delay(200);
  }
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
    // Hydrated, so the router handles the click.
    await page.waitForLoadState('networkidle');
    // A full page load would drop this marker and request a new document; the client router does neither.
    await page.evaluate(() => Object.assign(window, { enduvaMarker: true }));
    const documents: string[] = [];
    page.on('request', (req) => {
      if (req.isNavigationRequest()) documents.push(req.url());
    });
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Status' }).click();
    // The loader calls the server function, then the page renders.
    await page.getByRole('heading', { name: 'Service status' }).waitFor();
    expect(page.url()).toBe(`${origin}/status`);
    expect(await page.evaluate(() => 'enduvaMarker' in window)).toBe(true);
    expect(documents).toEqual([]);
    expect(await page.locator('#status-api').getAttribute('data-state')).toBe('down');
    expect(await page.getByRole('link', { name: 'Status' }).getAttribute('aria-current')).toBe('page');
    expect(await page.getByRole('link', { name: 'Home', exact: true }).getAttribute('aria-current')).toBeNull();
    expect(errors).toEqual([]);
    await close();
  });

  it('hydrates in the locale the server chose, whatever the browser prefers', async () => {
    // The request says German (Accept-Language from the context locale), the browser's own preference is English.
    const { page, errors, close } = await open({ locale: 'de-DE' });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'language', { get: () => 'en-US' });
    });
    await page.goto(origin);
    await page.waitForLoadState('networkidle');
    expect(await lang(page)).toBe('de');
    expect(await heading(page)).toBe('Willkommen bei Enduva');
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
