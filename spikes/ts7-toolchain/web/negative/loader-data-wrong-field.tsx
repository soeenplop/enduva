// @expect TS2339
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/activities/$activityId');

export function Page() {
  // The loader returns `{ title }`, not `{ status }`.
  const { status } = route.useLoaderData();
  return <p>{status}</p>;
}
