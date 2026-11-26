// @expect TS2322 at 5:27
import { Hero } from '../src/components/Hero';

// `title` is a string.
export const hero = <Hero title={42} switchLabel="Deutsch" switchHref="/de/" />;
