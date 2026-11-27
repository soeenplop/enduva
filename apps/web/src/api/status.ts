import { getHealth, getReadiness } from '@enduva/api-client';
import { createServerFn } from '@tanstack/react-start';
import { apiBaseUrl } from '../config.server';

const ok = (call: Promise<{ status: number }>) =>
  call.then(
    (res) => res.status === 200,
    // A network error or a malformed body: the service is not usable either way.
    () => false,
  );

/** Liveness and readiness of the API, asked by the web server through the generated client. */
export const getApiStatus = createServerFn({ method: 'GET' }).handler(async () => {
  const init = { baseUrl: apiBaseUrl(), cache: 'no-store' } as const;
  const [api, database] = await Promise.all([ok(getHealth({}, init)), ok(getReadiness({}, init))]);
  return { api, database };
});
