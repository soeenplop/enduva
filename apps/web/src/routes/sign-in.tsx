import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { type AuthError, sendMagicLink, signIn, startGoogleSignIn } from '../auth/functions';
import { authOptionsQuery } from '../auth/queries';
import { safeRedirect } from '../auth/redirect';
import { Field, FormMessage, formText, primaryButton, secondaryButton, settle } from '../components/form';
import { Turnstile } from '../components/Turnstile';
import { m } from '../paraglide/messages.js';

export interface SignInSearch {
  /** A path on this app to return to (`safeRedirect`). */
  readonly redirect?: string;
  readonly error?: 'oauth';
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    ...(search['redirect'] === undefined ? {} : { redirect: safeRedirect(search['redirect'], '/profile') }),
    ...(search['error'] === 'oauth' ? { error: 'oauth' } : {}),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.viewer !== null) throw redirect({ href: search.redirect ?? '/profile' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(authOptionsQuery),
  head: () => ({ meta: [{ title: `${m.sign_in_title()} · ${m.meta_title()}` }] }),
  component: SignInPage,
});

function SignInPage() {
  const search = Route.useSearch();
  const target = search.redirect ?? '/profile';
  const { data: options } = useSuspenseQuery(authOptionsQuery);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | 'oauth' | undefined>(search.error);
  const [linkSent, setLinkSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const magic = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('name') === 'magic';
    // The magic-link button skips the form's validation (no password needed), so the email is checked here.
    const emailInput = event.currentTarget.elements.namedItem('email') as HTMLInputElement;
    if (!emailInput.reportValidity() || token === null) return;
    const form = new FormData(event.currentTarget);
    const email = formText(form, 'email');
    setPending(true);
    setError(undefined);
    setLinkSent(false);
    const outcome = await settle(
      magic
        ? sendMagicLink({ data: { email, captchaToken: token } })
        : signIn({ data: { email, password: formText(form, 'password'), captchaToken: token } }),
    );
    if (outcome.ok && !magic) return window.location.assign(target);
    setPending(false);
    setResetKey((key) => key + 1);
    if (outcome.ok) setLinkSent(true);
    else setError(outcome.error);
  }

  async function google() {
    setPending(true);
    try {
      const { url } = await startGoogleSignIn({ data: { redirect: target } });
      window.location.assign(url);
    } catch {
      setPending(false);
      setError('unavailable');
    }
  }

  return (
    <section aria-labelledby="sign-in-title" className="flex max-w-md flex-col gap-6">
      <h1 id="sign-in-title" className="text-heading font-extrabold">
        {m.sign_in_title()}
      </h1>
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <Field label={m.field_email()} name="email" type="email" autoComplete="email" required />
        <Field
          label={m.field_password()}
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={72}
          required
        />
        <Turnstile siteKey={options.turnstileSiteKey} resetKey={resetKey} onToken={setToken} />
        {(error !== undefined || linkSent) && <FormMessage error={error} notice={m.sign_in_magic_link_sent()} />}
        <div className="flex flex-wrap gap-3">
          <button type="submit" name="password" className={primaryButton} disabled={pending || token === null}>
            {m.sign_in_submit()}
          </button>
          <button
            type="submit"
            name="magic"
            formNoValidate
            className={secondaryButton}
            disabled={pending || token === null}
          >
            {m.sign_in_magic_link()}
          </button>
        </div>
      </form>
      {options.google && (
        <button type="button" className={secondaryButton} disabled={pending} onClick={() => void google()}>
          {m.sign_in_google()}
        </button>
      )}
      <p>
        {m.sign_in_no_account()}{' '}
        <Link to="/sign-up" className="font-semibold text-accent underline">
          {m.sign_in_to_sign_up()}
        </Link>
      </p>
    </section>
  );
}
