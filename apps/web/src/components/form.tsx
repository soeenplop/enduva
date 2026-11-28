import { type InputHTMLAttributes, type ReactNode, useId, useSyncExternalStore } from 'react';
import type { AuthError, AuthOutcome } from '../auth/functions';
import { m } from '../paraglide/messages.js';

export const primaryButton =
  'rounded-md bg-primary px-4 py-2 font-semibold text-on-primary disabled:cursor-not-allowed disabled:opacity-60';
export const secondaryButton =
  'rounded-md border border-border px-4 py-2 font-semibold hover:bg-background disabled:cursor-not-allowed disabled:opacity-60';

/** A labelled input; `control` renders another control (a select) with the label's `id`. */
type FieldProps = Readonly<{ label: string; hint?: string; control?: (id: string) => ReactNode }> &
  InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, hint, control, ...input }: FieldProps) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {control?.(id) ?? (
        <input
          id={id}
          aria-describedby={hint === undefined ? undefined : `${id}-hint`}
          className="min-w-0 rounded-md border border-border bg-surface px-3 py-2"
          {...input}
        />
      )}
      {hint !== undefined && (
        <p id={`${id}-hint`} className="text-small text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

const authErrors: Record<AuthError | 'oauth', () => string> = {
  invalid_credentials: () => m.auth_error_invalid_credentials(),
  captcha: () => m.auth_error_captcha(),
  weak_password: () => m.auth_error_weak_password(),
  rate_limited: () => m.auth_error_rate_limited(),
  link_invalid: () => m.auth_error_link_invalid(),
  unavailable: () => m.auth_error_unavailable(),
  oauth: () => m.auth_error_oauth(),
};

/** A form's outcome, announced to screen readers: an error (alert) or a notice (status). */
export function FormMessage({ error, notice }: Readonly<{ error?: AuthError | 'oauth' | undefined; notice?: string }>) {
  if (error !== undefined)
    return (
      <p role="alert" className="text-danger">
        {authErrors[error]()}
      </p>
    );
  return (
    <p role="status" className="text-success">
      {notice}
    </p>
  );
}

/** A server function call that failed outright (network, refused input) counts as `unavailable`. */
export const settle = (call: Promise<AuthOutcome>): Promise<AuthOutcome> =>
  call.catch(() => ({ ok: false, error: 'unavailable' }) as const);

/** A text field's value from form data ('' when missing or a file). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

const noSubscription = () => () => {};

/**
 * False in the server render and until hydration, then true. Forms keep their submit button disabled until then, so
 * a native submit never happens before their handler exists.
 */
export const useHydrated = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
