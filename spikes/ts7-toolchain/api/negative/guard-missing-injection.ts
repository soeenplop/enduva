// @expect TS2554
import { BearerGuard } from '../src/auth/bearer.guard.js';

// The guard's constructor dependency is required; forgetting it must not type-check.
export const guard = new BearerGuard();
