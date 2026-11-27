// /status failure modes, rendered through the production SSR bundle: a stalled API and a broken configuration.
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PROBE_TIMEOUT_MS } from '../src/api/status';

// Accepts every request and never answers.
const stalled = createServer(() => {});
type Server = { fetch(req: Request): Promise<Response> };
let server: Server;

beforeAll(async () => {
  stalled.listen(0, '127.0.0.1');
  await once(stalled, 'listening');
  ({ default: server } = (await import(new URL('../dist/server/server.js', import.meta.url).href)) as {
    default: Server;
  });
});

afterAll(() => {
  stalled.closeAllConnections();
  stalled.close();
});

const render = async () => {
  const res = await server.fetch(new Request('http://localhost/status'));
  return { status: res.status, html: await res.text() };
};

describe('/status', () => {
  it('shows a stalled API as unavailable after the probe deadline', async () => {
    process.env['ENDUVA_API_URL'] = `http://127.0.0.1:${(stalled.address() as AddressInfo).port}`;
    const started = Date.now();
    const { status, html } = await render();
    expect(status).toBe(200);
    expect(html).toContain('id="status-api" data-state="down"');
    expect(html).toContain('id="status-database" data-state="down"');
    expect(Date.now() - started).toBeLessThan(PROBE_TIMEOUT_MS + 2_000);
  });

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
