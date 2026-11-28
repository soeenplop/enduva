import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { type FormEvent, useEffect, useState } from 'react';
import { type ConfirmOutcome, confirmEmail } from '../../auth/functions';
import { Field, FormMessage, formText, primaryButton, useHydrated } from '../../components/form';
import { m } from '../../paraglide/messages.js';

/**
 * The confirmation and magic-link mails link here (supabase/templates). Opening the page spends nothing: the form
 * posts the token hash with the address the user types, and the server keeps the session only if the link belongs
 * to that address (a scanner can't spend the link, someone else's link can't switch accounts). The token leaves the
 * address bar as soon as the page runs, and no Referer carries it anywhere.
 */
export const Route = createFileRoute('/auth/confirm')({
  validateSearch: (search: Record<string, unknown>): { token_hash?: string } =>
    typeof search['token_hash'] === 'string' ? { token_hash: search['token_hash'] } : {},
  headers: () => ({ 'Referrer-Policy': 'no-referrer' }),
  head: () => ({ meta: [{ title: `${m.confirm_title()} · ${m.meta_title()}` }] }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const router = useRouter();
  const search = Route.useSearch();
  // Kept from the first render: the URL is cleaned right after.
  const [tokenHash] = useState(search.token_hash);
  const ready = useHydrated();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ConfirmOutcome | undefined>(
    tokenHash === undefined ? { ok: false, error: 'link_invalid' } : undefined,
  );

  useEffect(() => {
    if (search.token_hash !== undefined) void router.navigate({ to: '/auth/confirm', search: {}, replace: true });
  }, [router, search.token_hash]);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (tokenHash === undefined) return;
    setPending(true);
    const email = formText(new FormData(event.currentTarget), 'email');
    const result = await confirmEmail({ data: { tokenHash, email } }).catch((): ConfirmOutcome => ({
      ok: false,
      error: 'unavailable',
    }));
    if (result.ok) return window.location.assign('/profile');
    setPending(false);
    setOutcome(result);
  }

  return (
    <section aria-labelledby="confirm-title" className="flex max-w-md flex-col gap-6">
      <h1 id="confirm-title" className="text-heading font-extrabold">
        {m.confirm_title()}
      </h1>
      {outcome === undefined || outcome.ok ? (
        // POST and disabled until the page runs: a native submit never sends the address in a URL.
        <form method="post" className="flex flex-col gap-4" onSubmit={(event) => void confirm(event)}>
          <p>{m.confirm_body()}</p>
          <Field label={m.field_email()} name="email" type="email" autoComplete="email" required />
          <button type="submit" className={`${primaryButton} self-start`} disabled={!ready || pending}>
            {m.confirm_submit()}
          </button>
        </form>
      ) : (
        <>
          {outcome.error === 'email_mismatch' ? (
            <p role="alert" className="text-danger">
              {m.auth_error_email_mismatch()}
            </p>
          ) : (
            <FormMessage error={outcome.error} />
          )}
          <Link to="/sign-in" className="font-semibold text-accent underline">
            {m.nav_sign_in()}
          </Link>
        </>
      )}
    </section>
  );
}
