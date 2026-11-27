import { createFileRoute } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <section aria-labelledby="home-title" className="max-w-prose">
      <h1 id="home-title" className="mb-4 text-heading font-extrabold">
        {m.home_title()}
      </h1>
      <p className="text-lead text-muted">{m.home_lead()}</p>
    </section>
  );
}
