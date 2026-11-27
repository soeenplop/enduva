// /status failure modes, rendered through the production SSR bundle.
import { beforeAll, describe, expect, it, vi } from 'vitest';

type Server = { fetch(req: Request): Promise<Response> };
let server: Server;

beforeAll(async () => {
  ({ default: server } = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
    default: Server;
  });
});

const render = async () => {
  const res = await server.fetch(new Request('http://localhost/status'));
  return { status: res.status, html: await res.text() };
};

describe('/status', () => {
  it.each([
    ['missing', undefined, 'ENDUVA_API_URL is not set'],
    ['malformed', 'not a url', 'Invalid URL'],
  ])('keeps a %s ENDUVA_API_URL out of the response', async (_case, value, internal) => {
    if (value === undefined) delete process.env['ENDUVA_API_URL'];
    else process.env['ENDUVA_API_URL'] = value;
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { status, html } = await render();
    expect(status).toBe(500);
    expect(html).toContain('Something went wrong');
    // Neither the visible page nor the hydration payload carries the internal message or the configured value.
    expect(html).not.toContain(internal);
    expect(html).not.toContain('ENDUVA_API_URL');
    if (value !== undefined) expect(html).not.toContain(value);
    expect(log).toHaveBeenCalledWith('getApiStatus failed', expect.objectContaining({ message: internal }));
    log.mockRestore();
  });
});
