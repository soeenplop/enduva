// @expect TS2322
import { Link } from '@tanstack/react-router';

// The landing app has no /pricing route.
export const link = <Link to="/pricing">Pricing</Link>;
