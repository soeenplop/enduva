// @expect TS2339 at 8:32
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/');

export function Page() {
  // The home route declares no search params.
  return <p>{route.useSearch().lang}</p>;
}
