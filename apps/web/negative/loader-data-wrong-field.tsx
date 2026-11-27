// @expect TS2339 at 8:11
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/status');

export function Page() {
  // The status loader returns `{ api, database }`, not `{ healthy }`.
  const { healthy } = route.useLoaderData();
  return <p>{String(healthy)}</p>;
}
