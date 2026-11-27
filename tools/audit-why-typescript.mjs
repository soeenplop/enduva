// `pnpm why typescript -r` gate (T1, ADR-0001): fails if the installed graph of the workspace
// contains any `typescript` below 7, an unparseable version, or no `typescript` at all. The
// lockfile audit reads the lockfile; this reads pnpm's resolved graph, so both have to agree.
//
// Usage: node tools/audit-why-typescript.mjs           (runs `pnpm why typescript -r --json`)
//        node tools/audit-why-typescript.mjs --self-test
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

/** `why` is the parsed output of `pnpm why typescript -r --json`. */
export function judge(why) {
  if (!Array.isArray(why)) return { problems: ['pnpm why output is not a list'], versions: [] };
  const versions = why.filter((p) => p?.name === 'typescript').map((p) => String(p.version));
  const problems = [];
  if (versions.length === 0) problems.push('no typescript in the installed graph (expected typescript >= 7)');
  for (const v of versions) {
    const m = /^(\d+)\.\d+\.\d+(?:-[\w.]+)?$/.exec(v);
    if (!m) problems.push(`typescript@${v}: not an exact version`);
    else if (Number(m[1]) < 7) problems.push(`typescript@${v}: TypeScript < 7 is not allowed (T1)`);
  }
  return { problems, versions };
}

function selfTest() {
  const ts = (version) => ({ name: 'typescript', version, dependents: [] });
  const cases = [
    ['accepts typescript 7.0.2 alone', [ts('7.0.2')], false],
    ['accepts two TS 7 versions', [ts('7.0.2'), ts('7.1.0')], false],
    ['rejects typescript 6.0.3 next to 7.0.2', [ts('7.0.2'), ts('6.0.3')], true],
    ['rejects typescript 5.9.3', [ts('5.9.3')], true],
    ['rejects a 6.x prerelease', [ts('6.1.0-beta')], true],
    ['rejects an unparseable version', [ts('latest')], true],
    ['rejects a graph without typescript', [], true],
    ['rejects output that is not a list', {}, true],
  ];
  let failed = 0;
  for (const [name, why, expectFail] of cases) {
    const ok = judge(why).problems.length > 0 === expectFail;
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
  }
  if (failed > 0) process.exit(1);
}

const args = process.argv.slice(2);
if (args[0] === '--self-test') {
  selfTest();
} else if (args.length === 0) {
  const why = JSON.parse(execFileSync('pnpm', ['why', 'typescript', '-r', '--json'], { encoding: 'utf8' }));
  const { problems, versions } = judge(why);
  if (problems.length > 0) {
    console.error(`FAIL pnpm why typescript -r:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`ok   pnpm why typescript -r: only typescript ${versions.join(', ')}`);
} else {
  throw new Error(`usage: ${basename(process.argv[1])} [--self-test]`);
}
