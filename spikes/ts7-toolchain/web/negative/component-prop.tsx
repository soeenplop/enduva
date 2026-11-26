// @expect TS2322
import { DistanceBadge } from '../src/components/DistanceBadge';

// `distance` is a number.
export const badge = <DistanceBadge distance="10" unit="km" />;
