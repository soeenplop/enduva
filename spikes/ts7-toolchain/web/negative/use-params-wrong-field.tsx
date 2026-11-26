// @expect TS2339 at 8:11
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/activities/$activityId');

export function Page() {
  // The param is `activityId`, not `id`.
  const { id } = route.useParams();
  return <p>{id}</p>;
}
