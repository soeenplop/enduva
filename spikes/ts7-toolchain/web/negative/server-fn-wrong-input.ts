// @expect TS2353
import { getGreeting } from '../src/api/greeting';

// The validator requires `name`.
export const greeting = getGreeting({ data: { nmae: 'athlete' } });
