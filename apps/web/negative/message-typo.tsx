// @expect TS2551 at 5:24
import { m } from '../src/paraglide/messages.js';

// Paraglide's compiled messages are typed; a misspelled key fails.
export const title = m.home_titel();
