// @expect TS2345 at 5:93
import { ActivitiesService } from '../src/activities/activities.service.js';

// 'feet' is not in the contract's unit enum.
export const activity = new ActivitiesService().get('0b5f8f6e-6c1e-4b7a-9d6a-3d1f1f3b2c4a', 'feet');
