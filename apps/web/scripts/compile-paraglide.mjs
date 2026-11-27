import { compile } from '@inlang/paraglide-js';
import { paraglideOptions, viteBuildOverrides } from '../paraglide.options.mjs';

// Same options as the Vite plugin in a production build, so `tsc` checks the runtime the build
// ships (ADR-0001, pitfall 4). scripts/build.mjs verifies that the two outputs are identical.
await compile({ ...paraglideOptions, ...viteBuildOverrides });
