// @expect TS2322 at 5:27
import { Link } from '@tanstack/react-router';

// There is no /settings route in the generated route tree (yet).
export const link = <Link to="/settings">Settings</Link>;
