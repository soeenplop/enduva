// @expect TS2820 at 5:27
import { Link } from '@tanstack/react-router';

// There is no /activities/$activityId/edit route in the generated route tree.
export const link = <Link to="/activities/$activityId/edit">Edit</Link>;
