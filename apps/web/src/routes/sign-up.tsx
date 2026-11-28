import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, Link, redirect } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { type AuthError, signUp } from '../auth/functions';
import { authOptionsQuery } from '../auth/queries';
import { Field, FormMessage, formText, primaryButton, settle } from '../components/form';
import { Turnstile } from '../components/Turnstile';
import { m } from '../paraglide/messages.js';

export const Route = createFileRoute('/sign-up')({
  beforeLoad: ({ context }) => {
    if (context.viewer !== null) throw redirect({ href: '/profile' });
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(authOptionsQuery),
  head: () => ({ meta: [{ title: `${m.sign_up_title()} · ${m.meta_title()}` }] }),
  component: SignUpPage,
});

function SignUpPage() {
  const { data: options } = useSuspenseQuery(authOptionsQuery);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthError | undefined>();
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (token === null) return;
    setPending(true);
    setError(undefined);
    const outcome = await settle(
      signUp({
        data: { email: formText(form, 'email'), password: formText(form, 'password'), captchaToken: token },
      }),
    );
    setPending(false);
    setResetKey((key) => key + 1);
    if (outcome.ok) setDone(true);
    else setError(outcome.error);
  }

  return (
    <section aria-labelledby="sign-up-title" className="flex max-w-md flex-col gap-6">
      <h1 id="sign-up-title" className="text-heading font-extrabold">
        {m.sign_up_title()}
      </h1>
      {done ? (
        <FormMessage notice={m.sign_up_check_inbox()} />
      ) : (
        <form method="post" className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <Field label={m.field_email()} name="email" type="email" autoComplete="email" required />
          <Field
            label={m.field_password()}
            hint={m.field_password_hint()}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            required
          />
          <Turnstile siteKey={options.turnstileSiteKey} resetKey={resetKey} onToken={setToken} />
          {error !== undefined && <FormMessage error={error} />}
          <button type="submit" className={`${primaryButton} self-start`} disabled={pending || token === null}>
            {m.sign_up_submit()}
          </button>
        </form>
      )}
      <p>
        {m.sign_up_have_account()}{' '}
        <Link to="/sign-in" className="font-semibold text-accent underline">
          {m.sign_up_to_sign_in()}
        </Link>
      </p>
    </section>
  );
}
