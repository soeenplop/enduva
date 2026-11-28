// SBOM of the `web` image (deploy/Dockerfile, task 0.12a). Reads the CycloneDX document of `pnpm sbom --prod`
// (file argument) and writes it to stdout with the build-time packages whose code ships in the bundle added:
// the production closure alone misses them, because they are dev dependencies that generate or inject code.
//
//   node scripts/sbom.mjs prod.cdx.json > web.cdx.json
//
// Versions come from the installed packages, so the build fails if one of them can't be resolved.
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

const app = join(import.meta.dirname, '..');

/** Packages whose generated or injected code is part of dist/, and where it ends up. */
const shipped = [
  { name: '@inlang/paraglide-js', from: app, code: 'Paraglide runtime and message functions (generated source)' },
  { name: '@enduva/i18n', from: app, code: 'message catalogs compiled into the Paraglide message functions' },
  { name: 'tailwindcss', from: app, code: 'preflight and utility CSS in the client stylesheet' },
  { name: 'vite', from: app, code: 'client runtime helpers such as the module preload helper' },
  // Vite's bundler, a sibling of the vite package in pnpm's layout.
  {
    name: 'rolldown',
    from: join(dirname(realpathSync(join(app, 'node_modules', 'vite'))), '..'),
    code: 'module runtime helpers',
  },
];

function installed(name, from) {
  const manifest = JSON.parse(readFileSync(join(from, 'node_modules', name, 'package.json'), 'utf8'));
  if (manifest.name !== name || typeof manifest.version !== 'string')
    throw new Error(`unexpected manifest for ${name}`);
  return manifest.version;
}

const bom = JSON.parse(readFileSync(process.argv[2] ?? '/dev/stdin', 'utf8'));
const root = bom.metadata.component['bom-ref'];
const rootDependencies = bom.dependencies.find((entry) => entry.ref === root);

for (const { name, from, code } of shipped) {
  const version = installed(name, from);
  const [group, base] = name.startsWith('@') ? name.split('/') : [undefined, name];
  const purl = `pkg:npm/${group === undefined ? '' : `${encodeURIComponent(group)}/`}${base}@${version}`;
  // Already listed (vite and rolldown are in Start's production closure): nothing to add.
  if (bom.components.some((component) => component['bom-ref'] === purl)) continue;
  bom.components.push({
    type: 'library',
    name: base,
    ...(group !== undefined && { group }),
    version,
    purl,
    'bom-ref': purl,
    properties: [{ name: 'enduva:bundled-code', value: code }],
  });
  rootDependencies.dependsOn.push(purl);
}

process.stdout.write(`${JSON.stringify(bom, null, 2)}\n`);
