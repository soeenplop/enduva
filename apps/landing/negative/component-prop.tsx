// @expect TS2322 at 5:50
import { PlaceholderPage } from '../src/components/PlaceholderPage';

// `title` is a string.
export const page = <PlaceholderPage task="G1.1" title={42} />;
