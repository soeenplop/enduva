// WCAG 1.4.10 Reflow (#113): no horizontal overflow at 320 CSS px on every prerendered page and the language picker,
// in light and dark, with and without JavaScript. Serves the static build (dist/client, `pnpm build`) the way
// production does: a directory URL maps to its index.html.
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { type Browser, chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prerenderPaths } from '../site.mjs';

const root = new URL('../dist/client/', import.meta.url).pathname;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  const file = normalize(join(root, path.endsWith('/') ? `${path}index.html` : path));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  readFile(file).then(
    (body) => res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(body),
    () => res.writeHead(404).end(),
  );
});
let origin = '';
let browser: Browser;

beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  server.close();
});

const variants = ['light', 'dark'].flatMap((colorScheme) =>
  [true, false].map((javaScriptEnabled) => ({ colorScheme: colorScheme as 'light' | 'dark', javaScriptEnabled })),
);

describe('320 px reflow', () => {
  it('covers the picker and every prerendered page', () => {
    expect(prerenderPaths.length).toBeGreaterThanOrEqual(12);
  });

  it.each(variants)('has no horizontal overflow (%o)', async (variant) => {
    const context = await browser.newContext({ ...variant, viewport: { width: 320, height: 640 } });
    const page = await context.newPage();
    const overflowing: string[] = [];
    for (const path of ['/', ...prerenderPaths]) {
      const res = await page.goto(origin + path);
      expect(res?.status(), path).toBe(200);
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      if (width > 320) overflowing.push(`${path} (${width}px)`);
    }
    await context.close();
    expect(overflowing).toEqual([]);
  });
});
