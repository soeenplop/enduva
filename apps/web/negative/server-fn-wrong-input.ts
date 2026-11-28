// @expect TS2561 at 5:81
import { signIn } from '../src/auth/functions';

// The validator's input has `password`, not `pasword`.
export const call = signIn({ data: { email: 'a@example.com', captchaToken: 't', pasword: 'x' } });
