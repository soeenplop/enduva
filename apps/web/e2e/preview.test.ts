// The smoke test must only ever talk to its own preview server (startPreview in e2e/preview.ts).
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { startPreview } from './preview';

describe('startPreview', () => {
  it('resolves with the address its own process listens on', async () => {
    const { origin, stop } = await startPreview();
    expect((await fetch(origin)).status).toBe(200);
    stop();
    await expect
      .poll(
        () =>
          fetch(origin).then(
            () => 'up',
            () => 'down',
          ),
        { timeout: 5_000 },
      )
      .toBe('down');
  });

  it('rejects when its process exits, even if another server answers on the port', async () => {
    // Another server already serves 200 on the port, as in a port race or a second running build.
    const other = createServer((_req, res) => res.end('another server')).listen(0, '127.0.0.1');
    await once(other, 'listening');
    const { port } = other.address() as AddressInfo;
    try {
      await expect(startPreview({}, port)).rejects.toThrow(/exited with code/);
    } finally {
      other.close();
    }
  });
});
