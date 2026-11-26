import { queryOptions } from '@tanstack/react-query';
import { getActivity, type GetActivityParams } from './generated';

export const activityQuery = (activityId: string, params: GetActivityParams) =>
  queryOptions({
    queryKey: ['activities', activityId, params],
    queryFn: async ({ signal }) => {
      const res = await getActivity(activityId, params, { signal });
      if (res.status !== 200) throw new Error(`getActivity failed: ${res.data.code}`);
      return res.data;
    },
  });
