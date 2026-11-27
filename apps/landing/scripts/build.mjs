// Production build of the static landing page (T4, ADR-0001). Run `pnpm generate` first.
//
// 1. `vite build` prerenders every page under /de/… and /en/… (vite.config.mjs). It runs between two
//    snapshots of the generated sources: the route tree and Paraglide runtime that `tsr generate` and
//    `paraglide-js compile` wrote for `tsc` must be byte-identical to what Start's and Paraglide's
//    Vite plugins use, or `tsc` checked a different app than the one we ship.
// 2. Adds what Start doesn't render: the language picker at `/`, sitemap.xml, robots.txt, the web app
//    manifest and the brand files from assets/brand/final/web.
// 3. Checks the result (scripts/check-static.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { checkStatic } from './check-static.mjs';
import { brandFiles, languagePicker, manifest, robots, sitemap } from './static-pages.mjs';

const app = join(import.meta.dirname, '..');
const outDir = join(app, 'dist', 'client');
const generated = [join(app, 'src', 'routeTree.gen.ts'), join(app, 'src', 'paraglide')];

function files(path) {
  if (!existsSync(path)) throw new Error(`${relative(app, path)} is missing: run \`pnpm generate\` first`);
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

/** sha256 of every generated file, keyed by its path relative to the app. */
function snapshot() {
  const hashes = new Map();
  for (const file of generated.flatMap(files)) {
    hashes.set(relative(app, file), createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return hashes;
}

/**
 * Turbo restores `generate` outputs into whatever checkout hits its cache, so no generated file may
 * name this one.
 */
function assertCheckoutIndependent() {
  const checkout = join(app, '..', '..');
  const leaks = generated
    .flatMap(files)
    .filter((file) => readFileSync(file, 'utf8').includes(checkout))
    .map((file) => relative(app, file));
  if (leaks.length > 0) {
    console.error(
      `Generated files embed the checkout path ${checkout}, so a Turbo cache hit from another checkout would not match:\n  ${leaks.join('\n  ')}`,
    );
    process.exit(1);
  }
}

assertCheckoutIndependent();
const before = snapshot();
const vite = spawnSync(join(app, 'node_modules', '.bin', 'vite'), ['build'], { cwd: app, stdio: 'inherit' });
if (vite.status !== 0) process.exit(vite.status ?? 1);

const after = snapshot();
const drift = [...new Set([...before.keys(), ...after.keys()])].filter((file) => before.get(file) !== after.get(file));
if (drift.length > 0) {
  console.error(
    `The Vite build changed generated files that tsc checked (run \`pnpm generate\`, and keep tsr.config.json's footer and paraglide.options.mjs in sync with the Vite plugins):\n  ${drift.join('\n  ')}`,
  );
  process.exit(1);
}
assertCheckoutIndependent();
console.log(`ok   route tree and Paraglide output identical after vite build (${after.size} files)`);

writeFileSync(join(outDir, 'index.html'), languagePicker());
writeFileSync(join(outDir, 'sitemap.xml'), sitemap());
writeFileSync(join(outDir, 'robots.txt'), robots());
writeFileSync(join(outDir, 'site.webmanifest'), manifest());
const brand = join(app, '..', '..', 'assets', 'brand', 'final', 'web');
for (const name of brandFiles) copyFileSync(join(brand, name), join(outDir, name));

const failures = await checkStatic(outDir);
if (failures.length > 0) {
  console.error(`\nStatic output check failed:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
