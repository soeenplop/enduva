// @expect TS2345 at 5:38
import { metresToKilometres } from '../src/index.js';

// A distance is a number of metres; passing a string must not type-check.
export const km = metresToKilometres('1000');
