import { describe, expect, it } from 'vitest';
import { emailFlowOutcome, linkOutcome, signInOutcome } from '../src/auth/outcomes';

const failure = (status: number, code: string) => ({ ok: false, status, code }) as const;

describe('emailFlowOutcome', () => {
  it.each([
    ['a sent mail', { ok: true } as const],
    ['a known address at sign-up', failure(422, 'user_already_exists')],
    ['an unknown address for a magic link', failure(422, 'otp_disabled')],
    // Auth's per-recipient cooldown only hits existing accounts, so it must look like the unknown-account answer.
    ['the mail cooldown of a known address', failure(429, 'over_email_send_rate_limit')],
  ])('answers ok for %s', (_, result) => expect(emailFlowOutcome(result)).toEqual({ ok: true }));

  it.each([
    [failure(400, 'captcha_failed'), 'captcha'],
    [failure(429, 'over_request_rate_limit'), 'rate_limited'],
    [failure(422, 'weak_password'), 'weak_password'],
    [failure(503, 'unexpected_response'), 'unavailable'],
    [failure(400, 'validation_failed'), 'unavailable'],
  ])('maps %j to %s', (result, error) => expect(emailFlowOutcome(result)).toEqual({ ok: false, error }));
});

describe('signInOutcome', () => {
  it.each(['invalid_credentials', 'email_not_confirmed', 'user_banned'])('hides %s behind one error', (code) =>
    expect(signInOutcome({ status: 400, code })).toEqual({ ok: false, error: 'invalid_credentials' }),
  );

  it('keeps captcha failures distinct', () =>
    expect(signInOutcome({ status: 400, code: 'captcha_failed' })).toEqual({ ok: false, error: 'captcha' }));
});

describe('linkOutcome', () => {
  it('reports a spent or expired link', () =>
    expect(linkOutcome({ status: 403, code: 'otp_expired' })).toEqual({ ok: false, error: 'link_invalid' }));
});
