// Lockfile audit for spike criterion 6 (T1: TypeScript 7 only).
//
// Fails if a resolved pnpm lockfile contains
//   1. `typescript` (or its platform packages) below 7, anywhere: packages, snapshots, peer suffixes;
//   2. any alias of `typescript` (`npm:typescript@…`, or a dependency named differently that
//      resolves to `typescript@…`);
//   3. any other pre-7 compiler package: the TS 7 preview builds and tools that embed or patch a
//      pre-7 TypeScript compiler (list below).
//   4. any package that does not resolve from the registry by integrity hash (tarball, git,
//      directory): such a source can carry any code under any name, so it needs a decision.
//
// TypeScript compiler code bundled *inside* a package is invisible here; see
// audit-bundled-typescript.mjs, which scans the installed files.
//
// Usage: node scripts/audit-lockfile.mjs <pnpm-lock.yaml>... | --self-test
// The scan is textual on purpose: pnpm lockfiles can be multi-document YAML, and a text scan also
// catches versions that only appear in peer-dependency suffixes such as `foo@1.0.0(typescript@5.9.3)`.
import { readFileSync } from 'node:fs';

const BANNED = [
  // TS 7 previews (pre-release builds of the native compiler before typescript@7).
  /^@typescript\/native-preview(-.+)?$/,
  // Embed or patch a pre-7 TypeScript compiler / JS API.
  /^ts-morph$/,
  /^@ts-morph\/common$/,
  /^ts-patch$/,
  /^ttypescript$/,
  /^@typescript\/vfs$/,
  /^typescript-eslint$/,
  /^@typescript-eslint\/(typescript-estree|parser|eslint-plugin|type-utils|project-service)$/,
  /^@volar\/typescript$/,
  /^vue-tsc$/,
  /^svelte-check$/,
  /^ts-node$/,
  /^ts-loader$/,
  /^fork-ts-checker-webpack-plugin$/,
  /^@microsoft\/api-extractor$/,
  // Depends on an older `typescript` (see 02-architecture.md, T2).
  /^@nestjs\/cli$/,
];

export function audit(text) {
  const problems = new Set();

  // 1. Every `typescript@<version>` occurrence, including peer suffixes and alias targets.
  for (const m of text.matchAll(/(?<![\w@/.-])(typescript|@typescript\/typescript-[\w-]+)@(\d+)\.[^\s:'"()]*/g)) {
    if (Number(m[2]) < 7) problems.add(`pre-7 TypeScript: ${m[0]}`);
  }

  // 2. Aliases: `npm:typescript@…` specifiers, or `<other-name>: typescript@…` dependency entries.
  for (const m of text.matchAll(/npm:typescript@[^\s'"]*/g)) problems.add(`alias specifier: ${m[0]}`);
  for (const m of text.matchAll(/^\s+['"]?([^\s:'"]+)['"]?:\s+['"]?typescript@([^\s'"]+)/gm)) {
    if (m[1] !== 'typescript') problems.add(`alias "${m[1]}" -> typescript@${m[2]}`);
  }

  // 3. Banned compiler packages, by package key (`  name@version:` / `  'name@version':`).
  for (const m of text.matchAll(/^ {2}['"]?((?:@[^@\s/'"]+\/)?[^@\s'"]+)@[^\s'"]+['"]?:/gm)) {
    if (BANNED.some((re) => re.test(m[1]))) problems.add(`banned compiler package: ${m[1]}`);
  }

  // 4. Registry resolutions only (`resolution: {integrity: sha512-…}`).
  for (const m of text.matchAll(/^\s+resolution:(.*)$/gm)) {
    if (!/^\s*\{integrity: sha512-[A-Za-z0-9+/]+=*\}\s*$/.test(m[1])) {
      problems.add(`non-registry resolution: ${m[1].trim() || '(block)'}`);
    }
  }
  return [...problems];
}

function selfTest() {
  const cases = {
    'typescript 5 package': 'packages:\n  typescript@5.9.3:\n    resolution: {}\n',
    'typescript 6 peer suffix': 'snapshots:\n  foo@1.0.0(typescript@6.0.3):\n    dependencies: {}\n',
    'npm alias specifier':
      'importers:\n  .:\n    devDependencies:\n      ts6:\n        specifier: npm:typescript@^6\n        version: typescript@6.0.3\n',
    'renamed alias to TS 7': 'snapshots:\n  bar@1.0.0:\n    dependencies:\n      tsc-old: typescript@7.0.2\n',
    'native preview': "packages:\n  '@typescript/native-preview@7.0.0-dev.20260707.2':\n    resolution: {}\n",
    'ts-morph': 'packages:\n  ts-morph@27.0.0:\n    resolution: {}\n',
    'nest cli': "packages:\n  '@nestjs/cli@12.0.0':\n    resolution: {}\n",
    'tarball resolution': 'packages:\n  tool@1.0.0:\n    resolution: {tarball: https://example.com/tool-1.0.0.tgz}\n',
    'git resolution':
      'packages:\n  tool@https://codeload.github.com/x/tool/tar.gz/abc:\n    resolution: {tarball: https://codeload.github.com/x/tool/tar.gz/abc}\n',
    'directory resolution': 'packages:\n  tool@file:../tool:\n    resolution: {directory: ../tool, type: directory}\n',
  };
  let failed = 0;
  for (const [name, text] of Object.entries(cases)) {
    const ok = audit(text).length > 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} rejects ${name}`);
    if (!ok) failed++;
  }
  const clean =
    "packages:\n  typescript@7.0.2:\n    resolution: {integrity: sha512-AAAA==}\n  '@typescript/typescript-linux-x64@7.0.2':\n    resolution: {integrity: sha512-BBBB}\n";
  const cleanOk = audit(clean).length === 0;
  console.log(`${cleanOk ? 'ok  ' : 'FAIL'} accepts typescript@7.0.2`);
  if (failed > 0 || !cleanOk) process.exit(1);
}

if (process.argv[2] === '--self-test') {
  selfTest();
} else {
  const files = process.argv.slice(2);
  if (files.length === 0) throw new Error('usage: audit-lockfile.mjs <pnpm-lock.yaml>... | --self-test');
  let bad = false;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const problems = audit(text);
    const versions = [...new Set([...text.matchAll(/(?<![\w@/.-])typescript@([\d.]+[^\s:'"()]*)/g)].map((m) => m[1]))];
    if (problems.length > 0) {
      bad = true;
      console.error(`FAIL ${file}:\n  ${problems.join('\n  ')}`);
    } else {
      console.log(
        `ok   ${file}: no pre-7 TypeScript, aliases, banned compiler packages or non-registry sources (typescript: ${versions.join(', ') || 'none'})`,
      );
    }
  }
  if (bad) process.exit(1);
}
