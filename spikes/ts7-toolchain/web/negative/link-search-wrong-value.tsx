// @expect TS2322
import { Link } from '@tanstack/react-router';

// `units` must be 'metric' | 'imperial' (from the Zod contract used as validateSearch).
export const link = (
  <Link to="/activities/$activityId" params={{ activityId: 'x' }} search={{ units: 'kilometers' }}>
    x
  </Link>
);
