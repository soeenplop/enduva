import { createFileRoute, Link } from '@tanstack/react-router';
import { getGreeting } from '../api/greeting';

export const Route = createFileRoute('/')({
  loader: () => getGreeting({ data: { name: 'athlete' } }),
  component: Home,
});

function Home() {
  const { greeting, userId } = Route.useLoaderData();
  return (
    <main>
      <p data-testid="greeting">
        {greeting} ({userId})
      </p>
      <Link to="/activities/$activityId" params={{ activityId: '0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a' }} search={{ units: 'metric' }}>
        Morning run
      </Link>
    </main>
  );
}
