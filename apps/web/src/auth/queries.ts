import { queryOptions } from '@tanstack/react-query';
import { getAuthOptions, getViewer } from './functions';

/** The signed-in user (or null). Sign-in and sign-out reload the page, which starts a fresh cache. */
export const viewerQuery = queryOptions({
  queryKey: ['viewer'],
  queryFn: () => getViewer(),
  staleTime: 60_000,
});

export const authOptionsQuery = queryOptions({
  queryKey: ['auth-options'],
  queryFn: () => getAuthOptions(),
  staleTime: 5 * 60_000,
});
