import { getHealth, getReadiness } from '@enduva/api-client';
import { createServerFn } from '@tanstack/react-start';
import { apiBaseUrl } from '../config.server';

/** Deadline for each probe: an API that accepts the connection and then stalls counts as unavailable. */
export const PROBE_TIMEOUT_MS = 2_000;

const ok = (call: Promise<{ status: number }>) =>
  call.then(
    (res) => res.status === 200,
    // A network error, the deadline or a malformed body: the service is not usable either way.
    () => false,
  );

/**
 * Liveness and readiness of the API, asked by the web server through the generated client.
 *
 * Start serializes a thrown error, message included, into the page's hydration payload. So anything unexpected (a
 * missing or malformed `ENDUVA_API_URL`) is logged here and replaced with a generic error before it leaves the server.
 */
export const getApiStatus = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const baseUrl = apiBaseUrl();
    const init = () => ({ baseUrl, cache: 'no-store', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) }) as const;
    const [api, database] = await Promise.all([ok(getHealth({}, init())), ok(getReadiness({}, init()))]);
    return { api, database };
  } catch (error) {
    console.error('getApiStatus failed', error);
    throw new Error('Service status unavailable');
  }
});
