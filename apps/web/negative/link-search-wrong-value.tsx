// @expect TS2322 at 6:33
import { Link } from '@tanstack/react-router';

// The sign-in page's `error` search param can only be 'oauth' (its validateSearch).
export const link = (
  <Link to="/sign-in" search={{ error: 'expired' }}>
    x
  </Link>
);
