// @expect TS2322 at 5:37
import { DistanceBadge } from '../src/components/DistanceBadge';

// `distance` is a number.
export const badge = <DistanceBadge distance="10" unit="km" />;
