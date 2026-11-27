// Renders through the production SSR bundle (`pnpm build`, which Turbo runs before this test).
import { describe, expect, it } from 'vitest';

const { default: server } = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
  default: { fetch(req: Request): Promise<Response> };
};

async function render(path: string, headers: Record<string, string> = {}) {
  const res = await server.fetch(new Request(`http://localhost${path}`, { headers }));
  const html = await res.text();
  return { status: res.status, lang: /<html lang="(\w+)"/.exec(html)?.[1], h1: /<h1[^>]*>(.*?)<\/h1>/.exec(html)?.[1] };
}

describe('SSR locale', () => {
  it('falls back to English', async () => {
    expect(await render('/')).toEqual({ status: 200, lang: 'en', h1: 'Welcome to Enduva' });
  });

  it('follows Accept-Language', async () => {
    expect(await render('/', { 'accept-language': 'de-DE,de;q=0.9,en;q=0.5' })).toMatchObject({ lang: 'de' });
  });

  it('prefers the locale cookie over Accept-Language', async () => {
    const page = await render('/', { cookie: 'enduva-locale=de', 'accept-language': 'en' });
    expect(page).toEqual({ status: 200, lang: 'de', h1: 'Willkommen bei Enduva' });
  });

  it('keeps the locale of each of two concurrent requests', async () => {
    const pages = await Promise.all([
      render('/', { cookie: 'enduva-locale=de' }),
      render('/', { cookie: 'enduva-locale=en' }),
    ]);
    expect(pages.map((page) => page.lang)).toEqual(['de', 'en']);
  });

  it('renders the localized not-found page with status 404', async () => {
    expect(await render('/no-such-page', { cookie: 'enduva-locale=de' })).toEqual({
      status: 404,
      lang: 'de',
      h1: 'Seite nicht gefunden',
    });
  });
});
