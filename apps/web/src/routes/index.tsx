import { createFileRoute } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

export interface HomeSearch {
  /** Set after a sign-out Auth couldn't confirm (`signOut` answered `revoked: false`). */
  readonly signedOut?: 'local';
}

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
    search['signedOut'] === 'local' ? { signedOut: 'local' } : {},
  component: Home,
});

function Home() {
  const { signedOut } = Route.useSearch();
  return (
    <section aria-labelledby="home-title" className="max-w-prose">
      {/* Here, not on /sign-in: home never redirects, so the notice also shows when another tab has signed in since. */}
      {signedOut === 'local' && (
        <p role="status" className="mb-6 text-warning">
          {m.sign_out_not_confirmed()}
        </p>
      )}
      <h1 id="home-title" className="mb-4 text-heading font-extrabold">
        {m.home_title()}
      </h1>
      <p className="text-lead text-muted">{m.home_lead()}</p>
    </section>
  );
}
