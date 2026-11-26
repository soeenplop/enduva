// Negative tests for spike criteria 2, 4 and 5: deliberately broken fixtures must FAIL.
//
// - `<pkg>/negative/*.ts(x)`: each file starts with `// @expect TS<code>`. The script type-checks
//   the package's normal sources plus that one fixture with TS 7 `tsc` and asserts that tsc exits
//   non-zero, reports the expected code in the fixture, and reports nothing anywhere else.
// - `<pkg>/negative/lint/*.ts`: each file starts with `// @expect-lint <rule>`. The script asserts
//   that oxlint's type-aware run (tsgolint) reports that rule for the file.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const packages = ['api', 'contracts', 'web', 'landing'];
const bin = (name) => join(import.meta.dirname, '..', 'node_modules', '.bin', name);
const failures = [];
let checked = 0;

function expectation(file, tag) {
  const match = readFileSync(file, 'utf8').match(new RegExp(`^// @${tag} (\\S+)`));
  if (!match) throw new Error(`${file}: missing "// @${tag} …" header`);
  return match[1];
}

for (const pkg of packages) {
  const dir = join(pkg, 'negative');
  if (!existsSync(dir)) continue;
  const base = JSON.parse(readFileSync(join(pkg, 'tsconfig.json'), 'utf8'));

  for (const name of readdirSync(dir).filter((f) => /\.tsx?$/.test(f))) {
    const code = expectation(join(dir, name), 'expect');
    const configPath = join(pkg, 'tsconfig.negative.json');
    const config = { extends: './tsconfig.json', include: [...base.include, `negative/${name}`] };
    writeFileSync(configPath, JSON.stringify(config));
    const result = spawnSync(bin('tsc'), ['-p', 'tsconfig.negative.json', '--pretty', 'false'], { cwd: pkg, encoding: 'utf8' });
    rmSync(configPath);

    const lines = `${result.stdout}${result.stderr}`.split('\n').filter((l) => /error TS\d+/.test(l));
    const inFixture = lines.filter((l) => l.startsWith(`negative/${name}(`));
    const elsewhere = lines.filter((l) => !l.startsWith(`negative/${name}(`));
    const label = `${pkg}/negative/${name}`;
    checked++;
    if (result.status === 0) failures.push(`${label}: tsc passed, expected ${code}`);
    else if (!inFixture.some((l) => l.includes(`error ${code}:`))) failures.push(`${label}: expected ${code}, got:\n  ${lines.join('\n  ')}`);
    else if (elsewhere.length > 0) failures.push(`${label}: unexpected errors outside the fixture:\n  ${elsewhere.join('\n  ')}`);
    else console.log(`ok   ${label} fails with ${code}: ${inFixture[0]?.split(`error ${code}: `)[1]}`);
  }

  const lintDir = join(dir, 'lint');
  if (!existsSync(lintDir)) continue;
  // The repo config ignores negative/**, so lint the fixtures with the same rules minus the ignores.
  const { ignorePatterns: _ignored, ...lintConfig } = JSON.parse(readFileSync('.oxlintrc.json', 'utf8'));
  const lintConfigPath = 'negative.oxlintrc.json';
  writeFileSync(lintConfigPath, JSON.stringify(lintConfig));
  for (const name of readdirSync(lintDir).filter((f) => /\.tsx?$/.test(f))) {
    const file = join(lintDir, name);
    const rule = expectation(file, 'expect-lint');
    const result = spawnSync(bin('oxlint'), ['--type-aware', '-c', lintConfigPath, '--format', 'unix', file], { encoding: 'utf8' });
    const output = `${result.stdout}${result.stderr}`;
    checked++;
    if (result.status === 0 || !output.includes(rule)) failures.push(`${file}: expected oxlint to report ${rule}, got:\n  ${output}`);
    else console.log(`ok   ${file} fails oxlint with ${rule}`);
  }
  rmSync(lintConfigPath);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${checked} negative tests did not fail as expected:\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`\nAll ${checked} negative fixtures fail as expected.`);
