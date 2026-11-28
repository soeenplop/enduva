import { queryOptions } from '@tanstack/react-query';
import { getViewer } from './functions';

/** The signed-in user (or null). Sign-in and sign-out reload the page, which starts a fresh cache. */
export const viewerQuery = queryOptions({
  queryKey: ['viewer'],
  queryFn: () => getViewer(),
  staleTime: 60_000,
});
