import { queryOptions } from '@tanstack/react-query';
import { getProfile } from './functions';

export const profileQuery = queryOptions({
  queryKey: ['profile'],
  queryFn: () => getProfile(),
});
