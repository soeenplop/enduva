import { spawn } from 'node:child_process';

const READY = /Local:\s+(http:\/\/127\.0\.0\.1:\d+)\//;

/**
 * Starts `vite preview` of the production build and resolves with the origin that this process reported for its own
 * listener. With the default port 0 the OS picks a free port at bind time, so no other server can answer on it, and
 * the origin comes from the child's ready message rather than from probing a port. Rejects if the process exits or
 * reports nothing within 30 s.
 */
export function startPreview(env: NodeJS.ProcessEnv = {}, port = 0) {
  const child = spawn(
    'node_modules/.bin/vite',
    ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {
      cwd: new URL('..', import.meta.url),
      // NO_COLOR: plain output, so the ready message matches.
      env: { ...process.env, NO_COLOR: '1', ...env },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  const stop = () => void child.kill();
  return new Promise<{ origin: string; stop: () => void }>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`vite preview reported no address within 30 s:\n${output}`));
    }, 30_000);
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const match = READY.exec(output);
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        resolve({ origin: match[1], stop });
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`vite preview exited with code ${String(code)} before it was ready:\n${output}`));
    });
  });
}
