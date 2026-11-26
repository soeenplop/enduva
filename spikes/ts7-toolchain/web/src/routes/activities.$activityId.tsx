import { ActivityQuery } from '@spike/contracts';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { activityQuery } from '../api/queries';
import { DistanceBadge } from '../components/DistanceBadge';

export const Route = createFileRoute('/activities/$activityId')({
  // The Zod contract doubles as the search-param schema (Standard Schema).
  validateSearch: ActivityQuery,
  loaderDeps: ({ search }) => ({ units: search.units }),
  loader: async ({ context, params, deps }) => {
    const activity = await context.queryClient.ensureQueryData(activityQuery(params.activityId, deps));
    return { title: `${activity.sport} on ${activity.startedAt.slice(0, 10)}` };
  },
  component: ActivityPage,
});

function ActivityPage() {
  const { activityId } = Route.useParams();
  const { units } = Route.useSearch();
  const { title } = Route.useLoaderData();
  const { data: activity } = useSuspenseQuery(activityQuery(activityId, { units }));

  return (
    <main>
      <h1 data-testid="title">{title}</h1>
      <DistanceBadge distance={activity.distance} unit={activity.distanceUnit} />
      <Link
        to="/activities/$activityId"
        params={{ activityId }}
        search={{ units: units === 'metric' ? 'imperial' : 'metric' }}
      >
        Switch units
      </Link>
    </main>
  );
}
