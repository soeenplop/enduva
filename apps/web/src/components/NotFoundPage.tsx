import { Link } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

export function NotFoundPage() {
  return (
    <section aria-labelledby="not-found-title" className="max-w-prose">
      <h1 id="not-found-title" className="mb-4 text-heading font-extrabold">
        {m.not_found_title()}
      </h1>
      <p className="mb-6 text-muted">{m.not_found_body()}</p>
      <Link to="/" className="font-semibold text-accent underline">
        {m.back_home()}
      </Link>
    </section>
  );
}
