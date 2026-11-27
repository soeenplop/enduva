// @expect TS2554 at 5:27
import { HealthController } from '../src/health/health.controller.js';

// The controller's constructor dependency is required; forgetting it must not type-check.
export const controller = new HealthController();
