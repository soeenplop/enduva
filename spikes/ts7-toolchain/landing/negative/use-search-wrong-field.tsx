// @expect TS2339
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/');

export function Page() {
  // The index route declares no search params.
  return <p>{route.useSearch().lang}</p>;
}
