import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { apiStatusQuery } from '../api/queries';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/status')({
  loader: ({ context }) => context.queryClient.ensureQueryData(apiStatusQuery),
  head: () => ({ meta: [{ title: `${m.status_title()} · ${m.meta_title()}` }] }),
  component: StatusPage,
});

function StatusPage() {
  const { data } = useSuspenseQuery(apiStatusQuery);
  const rows = [
    { id: 'api', label: m.status_api(), up: data.api },
    { id: 'database', label: m.status_database(), up: data.database },
  ] as const;
  return (
    <section aria-labelledby="status-title" className="max-w-prose">
      <h1 id="status-title" className="mb-6 text-heading font-extrabold">
        {m.status_title()}
      </h1>
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        {rows.map((row) => (
          <div key={row.id} className="contents">
            <dt className="font-semibold">{row.label}</dt>
            <dd
              id={`status-${row.id}`}
              data-state={row.up ? 'up' : 'down'}
              className={row.up ? 'text-success' : 'text-danger'}
            >
              {row.up ? m.status_up() : m.status_down()}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
