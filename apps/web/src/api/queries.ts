import { queryOptions } from '@tanstack/react-query';
import { getApiStatus } from './status';

export const apiStatusQuery = queryOptions({
  queryKey: ['api-status'],
  queryFn: () => getApiStatus(),
  staleTime: 10_000,
});
