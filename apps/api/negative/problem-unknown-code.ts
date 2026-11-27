// @expect TS2345 at 5:43
import { ProblemException } from '../src/problem/problem.js';

// Error codes are a closed set that clients translate; an unknown one must not type-check.
export const error = new ProblemException('teapot');
