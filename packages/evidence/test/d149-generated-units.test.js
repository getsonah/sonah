// D149: in a review of several units, the generated, vendored and lock files of the change (by provenance alone: a git
// attribute the snapshot read, else the name of a lock file a package tool writes) are grouped apart and form the last
// units; each such unit names each file's source; part B never offers one whole; the record keeps each one's source
// and the coverage line counts them apart. A change that fits one unit is today's, byte for byte, the class unused.
//
// Synthetic files and sessions, deterministic fake agents: no recording, no model, no network. Each rule is a test that
// fails on a mutant of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, planReviewUnits, isCodeReviewLabel, generatedSourceOf,
  CODE_LOCK_FILE_NAMES } from '../src/code-pass.js';
import { CODE_GENERATED_SOURCES } from '../src/ledger.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines } from '../src/code-report.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, linesOf, GIT, ROOT } from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
/** git's patch of a file whose line `at` changed, three lines of context. */
const oneLine = (path, before, after, at) => {
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  const from = Math.max(1, at - 3), to = Math.min(a.length, at + 3);
  const rows = [];
  for (let l = from; l <= to; l++) rows.push(...(l === at ? [`-${a[l - 1]}`, `+${b[l - 1]}`] : [` ${a[l - 1]}`]));
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    `@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`, ...rows, ''].join('\n');
};
const changed = (path, before, line) => {
  const after = before.replace(`${before.split('\n')[line - 1]}\n`, `${before.split('\n')[line - 1].toUpperCase()}\n`);
  return { text: after, modified: { before, patch: oneLine(path, before, after, line) } };
};
const B = changed('src/one/b.js', linesOf('bb', 300), 10);
const GEN = changed('gen/out.js', linesOf('gg', 300), 10);
const LOCK = changed('package-lock.json', linesOf('ll', 300), 10);
/** Two regular units (a.js with b.js; c.js), and two small files of the class: gen/out.js by its git attribute,
 *  package-lock.json by its lock file's name. Each but a.js and c.js is modified in one line. */
const FILES = Object.freeze({ 'src/one/a.js': linesOf('aa', 4_000), 'src/one/b.js': B.text, 'src/two/c.js': linesOf('cc', 3_500),
  'gen/out.js': GEN.text, 'package-lock.json': LOCK.text });
const MODIFIED = Object.freeze({ 'src/one/b.js': B.modified, 'gen/out.js': GEN.modified,
  'package-lock.json': LOCK.modified });
const ATTRIBUTES = Object.freeze({ 'gen/out.js': 'linguist-generated' });

async function run({ files = FILES, modified = MODIFIED, attributes = ATTRIBUTES, seen = [] } = {}) {
  const f = scenario(mods, { files, modified, attributes });
  const judge = async (request) => {
    seen.push(request);
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return fixture.accountsHold(request.prompt);
    if (isCodeReviewLabel(request.label)) return { findings: [], questions: [] };
    throw new Error(`unexpected request ${request.label}`);
  };
  const { codePass } = await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo,
    judge, base: GIT, root: ROOT, wholeFiles: true });
  return { codePass, f, seen };
}

test('D149: the class comes from provenance alone, in its closed order', () => {
  assert.deepEqual(CODE_GENERATED_SOURCES, ['linguist-generated', 'linguist-vendored', 'diff-unset', 'lock-file']);
  assert.deepEqual([{ path: 'a/b.js', generated: 'linguist-vendored' }, { path: 'Cargo.lock' }, { path: 'web/yarn.lock' },
    { path: 'src/package-lock.json.js' }, { path: 'a.js', generated: 'something else' },
    { path: 'go.sum', generated: 'diff-unset' }].map(generatedSourceOf),
  ['linguist-vendored', 'lock-file', 'lock-file', null, null, 'diff-unset']);
  // A manifest or build file a person writes is never of the class.
  for (const path of ['package.json', 'web/package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'pom.xml',
    'build.gradle', 'build.gradle.kts', 'app.csproj', 'composer.json', 'requirements.txt'])
    assert.equal(generatedSourceOf({ path }), null, path);
  assert.ok(CODE_LOCK_FILE_NAMES.every((name) => generatedSourceOf({ path: `x/${name}` }) === 'lock-file'));
});

test('D149: the generated and vendored files are grouped apart and form the last units, each naming its files\' sources', () => {
  const plan = planReviewUnits(scenario(mods, { files: FILES, modified: MODIFIED, attributes: ATTRIBUTES }).snapshot);
  assert.deepEqual(plan.units.map((u) => [u.label, u.paths, u.generated ?? null]), [
    ['U1', ['src/one/a.js', 'src/one/b.js'], null], ['U2', ['src/two/c.js'], null],
    ['U3', ['gen/out.js', 'package-lock.json'], ['linguist-generated', 'lock-file']]]);
  // Without the class (no attribute, a lock file by another name), the two small files join a regular unit.
  const files = { 'src/one/a.js': FILES['src/one/a.js'], 'src/two/c.js': FILES['src/two/c.js'],
    'gen/out.js': linesOf('gg', 300), 'package.lock': linesOf('ll', 300) };
  assert.deepEqual(planReviewUnits(scenario(mods, { files }).snapshot).units.map((u) => [u.label, u.paths,
    u.generated ?? null]), [['U1', ['gen/out.js', 'package.lock', 'src/one/a.js'], null], ['U2', ['src/two/c.js'], null]]);
});

test('D149: a unit of the class shows its files by their hunks, never whole; the record keeps each one\'s source and the coverage counts them apart', async () => {
  const seen = [];
  const { codePass } = await run({ seen });
  const [u1, , u3] = seen.filter((r) => isCodeReviewLabel(r.label));
  // Part B offers b.js whole in its unit, never gen/out.js or package-lock.json in theirs.
  assert.ok(u1.prompt.includes('FILE {"path":"src/one/b.js","lines":300}'));
  assert.ok(u3.prompt.includes('diff --git a/gen/out.js b/gen/out.js\n'));
  assert.ok(!u3.prompt.includes('FILE {"path":"gen/out.js"') && !u3.prompt.includes('FILE {"path":"package-lock.json"'));
  assert.deepEqual(codePass.manifest.units.map((u) => u.generated ?? null), [null, null,
    ['linguist-generated', 'lock-file']]);
  assert.deepEqual(codePass.files.filter((x) => x.generated).map((x) => [x.path, x.generated]),
    [['gen/out.js', 'linguist-generated'], ['package-lock.json', 'lock-file']]);
  assert.equal(codeCoverageLines(codePass)[0], W.units(3, 3, [], 2));
  assert.equal(W.units(3, 3, [], 2), 'Sonah showed the code review every changed line of 3 files in 3 calls. It also showed '
    + 'every changed line of 2 generated, vendored or lock files.');
});

test('D149: a change that fits one unit is today\'s: the class moves nothing and is recorded nowhere', async () => {
  const files = { 'src/parse.js': fixture.CODE_FILES['src/parse.js'], 'package-lock.json': LOCK.text };
  const modified = { 'package-lock.json': LOCK.modified };
  const plan = planReviewUnits(scenario(mods, { files, modified }).snapshot);
  assert.deepEqual([plan.today, plan.units.map((u) => [u.paths, u.generated ?? null])],
    [true, [[['package-lock.json', 'src/parse.js'], null]]]);
  const seen = [];
  const { codePass } = await run({ files, modified, attributes: {}, seen });
  assert.deepEqual(seen.filter((r) => isCodeReviewLabel(r.label)).map((r) => r.label), ['code-review:agent']);
  assert.equal(codePass.manifest.units, undefined);
  assert.ok(codePass.files.every((x) => !Object.hasOwn(x, 'generated')));
});
