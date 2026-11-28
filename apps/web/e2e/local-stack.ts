import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

// The LOCAL Supabase stack only (`pnpm --filter @enduva/db db:start`), never a hosted project, plus the API built
// from this checkout. Users are synthetic. ENDUVA_SUPABASE_WORKDIR points at another local stack's directory.

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));

export interface LocalStack {
  readonly authUrl: string;
  readonly publishableKey: string;
  readonly secretKey: string;
  readonly mailUrl: string;
  readonly poolerUrl: string;
}

/** Cloudflare's documented test token, accepted by the test secret in supabase/config.toml. */
export const TURNSTILE_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** The running stack's URLs and keys, or undefined if none runs. */
export function localStack(): LocalStack | undefined {
  try {
    const workdir = process.env['ENDUVA_SUPABASE_WORKDIR'] ?? repoRoot;
    const status = JSON.parse(
      execFileSync('supabase', ['status', '--output', 'json', '--workdir', workdir], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
      }),
    ) as Record<string, string | undefined>;
    const { API_URL, PUBLISHABLE_KEY, SECRET_KEY, MAILPIT_URL, DB_URL } = status;
    if (!API_URL || !PUBLISHABLE_KEY || !SECRET_KEY || !MAILPIT_URL || !DB_URL) return undefined;
    // The transaction pooler as the API login (supabase/seed.sql), next to the database port.
    const dbPort = Number(new URL(DB_URL).port);
    const poolerUrl = `postgresql://enduva_api_login.pooler-dev:enduva-local-api@127.0.0.1:${dbPort + 7}/postgres`;
    return {
      authUrl: API_URL,
      publishableKey: PUBLISHABLE_KEY,
      secretKey: SECRET_KEY,
      mailUrl: MAILPIT_URL,
      poolerUrl,
    };
  } catch {
    return undefined;
  }
}

/** A free TCP port on the loopback interface, for servers that need their URL before they start. */
export async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as { port: number };
  server.close();
  return port;
}

/** Starts the built API (apps/api/dist) against the local stack and waits until it is ready. */
export async function startApi(stack: LocalStack) {
  const port = await freePort();
  const child = spawn('node', ['dist/main.js'], {
    cwd: new URL('../../api/', import.meta.url),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      LOG_LEVEL: 'warn',
      DATABASE_URL: stack.poolerUrl,
      AUTH_ISSUER: `${stack.authUrl}/auth/v1`,
      // The tests sign in and save more often than a person would.
      THROTTLE_LIMIT: '10000',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const url = `http://127.0.0.1:${port}`;
  const stop = () => void child.kill();
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`API exited with code ${String(child.exitCode)}`);
    const ready = await fetch(`${url}/v1/health/ready`).then(
      (res) => res.ok,
      () => false,
    );
    if (ready) return { url, stop };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stop();
  throw new Error('API not ready within 20 s');
}

async function auth(stack: LocalStack, path: string, body: object, key = stack.publishableKey) {
  const res = await fetch(`${stack.authUrl}/auth/v1/${path}`, {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Local Auth POST ${path}: ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** A confirmed synthetic user, signed in: the session as the web server would store it. */
export async function newSession(stack: LocalStack) {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = randomUUID();
  await auth(stack, 'admin/users', { email, password, email_confirm: true }, stack.secretKey);
  const body = await auth(stack, 'token?grant_type=password', {
    email,
    password,
    gotrue_meta_security: { captcha_token: TURNSTILE_TEST_TOKEN },
  });
  return {
    email,
    password,
    accessToken: String(body['access_token']),
    refreshToken: String(body['refresh_token']),
    expiresAt: Number(body['expires_at']),
  };
}

/** The link in the mail to `to` (Mailpit's API), polling until it arrives. The mail is deleted after reading. */
export async function mailedLink(stack: LocalStack, to: string): Promise<URL> {
  const search = `${stack.mailUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`;
  for (let attempt = 0; attempt < 50; attempt++) {
    const { messages } = (await (await fetch(search)).json()) as { messages: { ID: string }[] };
    const id = messages[0]?.ID;
    if (id !== undefined) {
      const { HTML } = (await (await fetch(`${stack.mailUrl}/api/v1/message/${id}`)).json()) as { HTML: string };
      await fetch(search, { method: 'DELETE' });
      const href = /href="([^"]+)"/.exec(HTML)?.[1];
      if (href !== undefined) return new URL(href.replaceAll('&amp;', '&'));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No mail to ${to}`);
}
