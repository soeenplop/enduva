// @expect TS2551
import { m } from '../src/paraglide/messages.js';

// Paraglide's compiled messages are typed; a misspelled key fails.
export const title = m.hero_titel();
