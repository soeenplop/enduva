// @expect TS2551 at 8:32
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/activities/$activityId');

export function Page() {
  // The search param is `units`, not `unit`.
  return <p>{route.useSearch().unit}</p>;
}
