// @expect TS2339 at 8:32
import { getRouteApi } from '@tanstack/react-router';

const route = getRouteApi('/');

export function Page() {
  // The home route's only search param is `signedOut`.
  return <p>{route.useSearch().tab}</p>;
}
