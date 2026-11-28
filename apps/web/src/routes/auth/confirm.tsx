import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { type AuthError, confirmEmail } from '../../auth/functions';
import { FormMessage, primaryButton, settle } from '../../components/form';
import { m } from '../../paraglide/messages.js';

/**
 * The confirmation and magic-link mails link here (supabase/templates). Opening the page spends nothing: the button
 * posts the token hash, so a mail scanner that follows the link can't use it up.
 */
export const Route = createFileRoute('/auth/confirm')({
  validateSearch: (search: Record<string, unknown>): { token_hash?: string } =>
    typeof search['token_hash'] === 'string' ? { token_hash: search['token_hash'] } : {},
  head: () => ({
    meta: [{ title: `${m.confirm_title()} · ${m.meta_title()}` }, { name: 'referrer', content: 'no-referrer' }],
  }),
  component: ConfirmPage,
});

function ConfirmPage() {
  const { token_hash: tokenHash } = Route.useSearch();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | undefined>(tokenHash === undefined ? 'link_invalid' : undefined);

  async function confirm() {
    if (tokenHash === undefined) return;
    setPending(true);
    const outcome = await settle(confirmEmail({ data: { tokenHash } }));
    if (outcome.ok) return window.location.assign('/profile');
    setPending(false);
    setError(outcome.error);
  }

  return (
    <section aria-labelledby="confirm-title" className="flex max-w-md flex-col gap-6">
      <h1 id="confirm-title" className="text-heading font-extrabold">
        {m.confirm_title()}
      </h1>
      {error === undefined ? (
        <>
          <p>{m.confirm_body()}</p>
          <button
            type="button"
            className={`${primaryButton} self-start`}
            disabled={pending}
            onClick={() => void confirm()}
          >
            {m.confirm_submit()}
          </button>
        </>
      ) : (
        <>
          <FormMessage error={error} />
          <Link to="/sign-in" className="font-semibold text-accent underline">
            {m.nav_sign_in()}
          </Link>
        </>
      )}
    </section>
  );
}
