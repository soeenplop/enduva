import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { m } from '../paraglide/messages.js';

/** Shown for any error a route throws. Never renders the error itself, which may hold internals. */
export function ErrorPage({ reset }: ErrorComponentProps) {
  const router = useRouter();
  const retry = () => {
    reset();
    void router.invalidate();
  };
  return (
    <section role="alert" aria-labelledby="error-title" className="max-w-prose">
      <h1 id="error-title" className="mb-4 text-heading font-extrabold">
        {m.error_title()}
      </h1>
      <p className="mb-6 text-muted">{m.error_body()}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" onClick={retry} className="rounded-md bg-primary px-4 py-2 font-semibold text-on-primary">
          {m.error_retry()}
        </button>
        <Link to="/" className="font-semibold text-accent underline">
          {m.back_home()}
        </Link>
      </div>
    </section>
  );
}
