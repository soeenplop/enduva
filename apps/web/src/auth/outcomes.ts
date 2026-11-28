/**
 * How Auth's answers become what the browser sees. None of them may tell whether an account exists: an unknown email
 * and a wrong password are the same `invalid_credentials`, and the email flows answer `ok` whenever the difference
 * would depend on the recipient. Pure, so the mapping is unit-tested on its own (test/outcomes.test.ts).
 */

export type AuthError =
  | 'invalid_credentials'
  | 'captcha'
  | 'weak_password'
  | 'rate_limited'
  | 'link_invalid'
  | 'unavailable';
export type AuthOutcome = { ok: true } | { ok: false; error: AuthError };

/** A failed Auth call: its HTTP status and `error_code`. */
export interface AuthFailure {
  readonly status: number;
  readonly code: string;
}

export const ok = { ok: true } as const;
export const fail = (error: AuthError) => ({ ok: false, error }) as const;

/** Errors that can't depend on the account (the captcha, this client's request rate, an outage), or undefined. */
function commonError({ status, code }: AuthFailure): AuthError | undefined {
  if (code === 'captcha_failed') return 'captcha';
  if (status === 429 || code.startsWith('over_')) return 'rate_limited';
  if (status >= 500 || code === 'unexpected_response') return 'unavailable';
  return undefined;
}

/**
 * Answers that only an existing account gets in the email flows: sign-up of a known address, and Auth's mail cooldown
 * (`over_email_send_rate_limit`), which it applies per recipient and so only on the existing-account path. The
 * unknown-account counterparts (`otp_disabled` for a magic link, a first sign-up) answer `ok`, so these do too. The
 * project-wide mail quota uses the same code; it can't be told apart and is reported the same way.
 */
const recipientDependent = new Set(['user_already_exists', 'otp_disabled', 'over_email_send_rate_limit']);

/** Sign-up and magic link: the mail may or may not go out, and the answer never says which. */
export function emailFlowOutcome(result: { ok: true } | ({ ok: false } & AuthFailure)): AuthOutcome {
  if (result.ok || recipientDependent.has(result.code)) return ok;
  if (result.code === 'weak_password') return fail('weak_password');
  return fail(commonError(result) ?? 'unavailable');
}

/** Password sign-in: unknown email, wrong password and unconfirmed email look the same. */
export const signInOutcome = (failure: AuthFailure): AuthOutcome => fail(commonError(failure) ?? 'invalid_credentials');

/** An email link Auth refused: used, expired or never issued. */
export const linkOutcome = (failure: AuthFailure): AuthOutcome => fail(commonError(failure) ?? 'link_invalid');
