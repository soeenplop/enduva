// @expect TS2820
import { Link } from '@tanstack/react-router';

// There is no /activities/$activityId/edit route in the generated route tree.
export const link = <Link to="/activities/$activityId/edit" params={{ activityId: 'x' }}>Edit</Link>;
