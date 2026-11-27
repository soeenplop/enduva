// @expect TS2322 at 5:32
import { BrandMark } from '../src/components/BrandMark';

// `size` is a number.
export const mark = <BrandMark size="32" />;
