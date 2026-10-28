// D149: in a review of several units, the units' candidate findings are grouped by anchor identity before any check
// (the same file version, overlapping lines, whatever their kind): one check a group, the group's first standing for it
// and each other folded into it. The record keeps who proposed each published finding (`proposedBy`) and which unit's
// block its check was shown (`checkUnit`); no check request carries either. A finding's check is shown the whole
// table of contents and the block of the unit that holds its anchor's file; the questions' check and the accounting, the
// table of contents and the blocks of the units their items' files are in, as many as fit the room. A unit's file notes
// name its own files; the files outside the session are shown in the first unit's request alone.
//
// Synthetic files and sessions, deterministic fake agents: no recording, no model, no network. Each rule is a test that
// fails on a mutant of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, planReviewUnits, isCodeReviewLabel, OUTSIDE_SESSION_WORDS }
  from '../src/code-pass.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, linesOf, GIT, ROOT, FILES as BASE_FILES } from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
const enc = (text) => new TextEncoder().encode(text);
/** Two units: U1 src/one/a.js, docs/d.md and src/parse.js; U2 src/two/c.js, which does not fit beside them. The session
 *  writes them in this order (W1 a.js, W2 c.js, W3 d.md, W4 parse.js). */
const FILES = Object.freeze({ 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500),
  'docs/d.md': linesOf('dd', 200), 'src/parse.js': fixture.CODE_FILES['src/parse.js'] });
const OUTSIDE_HEADING = `# The files ${OUTSIDE_SESSION_WORDS}`;
const sectionOf = (path) => `diff --git a/${path} b/${path}\n`;
const sectionsIn = (prompt, files = FILES) => Object.keys(files).filter((p) => prompt.includes(sectionOf(p))).sort();
const TOC_ROWS = ['- docs/d.md · added · U1', '- src/one/a.js · added · U1', '- src/parse.js · added · U1',
  '- src/two/c.js · added · U2'];
/** The table of contents' rows: path, type and unit (a row's dossier keys after them left out). */
const tocRowsIn = (prompt) => prompt.split('\n').filter((l) => /^- \S+ · \w+ · U\d/.test(l))
  .map((l) => l.split(' · ').slice(0, 3).join(' · '));
const by = (...units) => units.map((unit) => ({ unit, angle: 'review', round: 'R1' }));

/** A finding of the review agent on one line of the change (`path`, line `line`, quoting `quote`). */
const findingOn = (path, line, quote, over = {}) => fixture.reviewFinding({ title: `SYNTHETIC ${path}:${line} is wrong`,
  trace: [{ step: 'SYNTHETIC the traced line.', path, side: 'new', startLine: line, endLine: line, quote }],
  anchor: { path, side: 'new', startLine: line, endLine: line }, ...over });
const cFinding = () => findingOn('src/two/c.js', 5, 'cc 00005');
const parseLine3 = () => findingOn('src/parse.js', 3, 'return parts.map((part) => part.trim());');

/** One file outside the evaluated session: lib/old.js, modified in its first line, no recorded write (D113). */
const OLD = Object.freeze({ before: 'export const old = 1;\nexport const other = 3;\n',
  after: 'export const old = 2;\nexport const other = 3;\n' });
function outsideSnapshot() {
  const { before, after } = OLD;
  const patch = ['diff --git a/lib/old.js b/lib/old.js', 'index 1111111..2222222 100644', '--- a/lib/old.js',
    '+++ b/lib/old.js', '@@ -1,2 +1,2 @@', '-export const old = 1;', '+export const old = 2;', ' export const other = 3;',
    ''].join('\n');
  return freezeCodeSnapshot([{ path: 'lib/old.js', recordedPath: 'lib/old.js', changed: true, recorded: false,
    outside: false, last: null, edits: [] }], [{ path: 'lib/old.js', bytes: enc(after), type: 'modified',
    base: { bytes: enc(before) }, patch }], { base: GIT });
}

/**
 * One run over FILES: each unit's review answers `review(label)` (nothing by default), each finding's check holds, every
 * question is sound, the accounting holds every item. `report(f)` gives the session review's report (the scenario's by
 * default); `outside` adds the file outside the session. `seen` receives every request.
 */
async function run({ review = () => ({ findings: [], questions: [] }), report = (f) => f.report, outside = false,
  seen = [], files = FILES, modified = {}, bound = Infinity, commandsAfter = {} } = {}) {
  const f = scenario(mods, { files, modified, commandsAfter });
  // With the file outside the session, the repository reads it too.
  const old = (side) => ({ path: 'lib/old.js', text: OLD[side], sha256: createHash('sha256').update(OLD[side]).digest('hex') });
  const repo = !outside ? f.repo : { ...f.repo,
    read: (path) => (String(path).endsWith('lib/old.js') ? old('after') : f.repo.read(path)),
    base: (path) => (String(path).endsWith('lib/old.js') ? old('before') : f.repo.base(path)) };
  const judge = async (request) => {
    seen.push(request);
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return fixture.accountsHold(request.prompt);
    if (isCodeReviewLabel(request.label)) return review(request.label, request);
    if (/^code-verify:F\d+/.test(request.label)) return fixture.holds(fixture.verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return fixture.allSound(fixture.batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
  const result = await runCodePass({ report: report(f), session: f.session, snapshot: f.snapshot, repo, judge,
    base: GIT, root: ROOT, wholeFiles: false, bound, ...(outside ? { outsideSnapshot: outsideSnapshot() } : {}) });
  return { ...result, f, seen };
}
const U1 = 'code-review:review:U1:R1', U2 = 'code-review:review:U2:R1';
const checksOf = (seen) => seen.filter((r) => /^code-verify:F\d+$/.test(r.label));

test('D149: the fixture is two units', () => {
  const f = scenario(mods, { files: FILES });
  assert.deepEqual(planReviewUnits(f.snapshot).units.map((u) => [u.label, u.paths]), [['U1', ['docs/d.md',
    'src/one/a.js', 'src/parse.js']], ['U2', ['src/two/c.js']]]);
});

test('D149: the units\' candidates are grouped by anchor identity before any check: a copy folds into its first; another kind on the same lines is checked and published on its own', async () => {
  const copy = fixture.reviewFinding({ title: 'SYNTHETIC the same lines and kind, other words' });
  const missed = fixture.reviewFinding({ kind: 'missed_case', title: 'SYNTHETIC a missed case on the same lines' });
  const { codePass, seen } = await run({ review: (label) => (label === U1 ? { findings: [fixture.reviewFinding()],
    questions: [] } : { findings: [copy, missed, cFinding(), parseLine3()], questions: [] }) });
  // Four groups: parse.js line 2 as a bug (U1's, with U2's copy), the same lines as a missed case, c.js line 5, parse.js
  // line 3 (no overlap).
  const checks = checksOf(seen);
  assert.deepEqual(checks.map((r) => r.label), ['code-verify:F1', 'code-verify:F2', 'code-verify:F3', 'code-verify:F4']);
  assert.deepEqual(checks.map((r) => fixture.verifiedFinding(r.prompt).title), [fixture.reviewFinding().title,
    missed.title, cFinding().title, parseLine3().title]);
  assert.equal(codePass.calls.verify, 4);
  assert.deepEqual(codePass.fates.filter((r) => r.from === 'answer').map((r) => [r.unit, r.index, r.fate, r.into]), [
    ['U1', 0, 'kept', undefined], ['U2', 0, 'folded', [{ from: 'answer', index: 0, unit: 'U1' }]],
    ['U2', 1, 'kept', undefined], ['U2', 2, 'kept', undefined], ['U2', 3, 'kept', undefined]]);
  // Both kinds on the same lines are published, each with who proposed it and the unit whose block its check saw.
  assert.deepEqual(codePass.findings.map((x) => [x.title, x.kind, x.proposedBy, x.checkUnit]), [
    [fixture.reviewFinding().title, 'bug', by('U1', 'U2'), 'U1'], [missed.title, 'missed_case', by('U2'), 'U1'],
    [cFinding().title, 'bug', by('U2'), 'U2'], [parseLine3().title, 'bug', by('U2'), 'U1']]);
  // No two published findings share an anchor identity (one kind, overlapping lines of one file).
  const ids = codePass.findings.map((x) => ({ kind: x.kind, ...x.anchor }));
  for (const [i, a] of ids.entries()) for (const b of ids.slice(i + 1)) assert.ok(a.kind !== b.kind || a.path !== b.path
    || a.endLine < b.startLine || b.endLine < a.startLine, JSON.stringify([a, b]));
});

test('D149: a finding\'s check is shown the whole table of contents and the block of the unit that holds its anchor\'s file, whichever unit proposed it', async () => {
  const { codePass, seen } = await run({ review: (label) => (label === U1 ? { findings: [cFinding()], questions: [] }
    : { findings: [fixture.reviewFinding()], questions: [] }) });
  const checks = new Map(checksOf(seen).map((r) => [fixture.verifiedFinding(r.prompt).title, r.prompt]));
  const onC = checks.get(cFinding().title), onParse = checks.get(fixture.reviewFinding().title);
  assert.deepEqual([sectionsIn(onC), tocRowsIn(onC)], [['src/two/c.js'], TOC_ROWS]);
  assert.deepEqual([sectionsIn(onParse), tocRowsIn(onParse)], [['docs/d.md', 'src/one/a.js', 'src/parse.js'], TOC_ROWS]);
  assert.deepEqual(codePass.findings.map((x) => [x.title, x.proposedBy, x.checkUnit]), [
    [cFinding().title, by('U1'), 'U2'], [fixture.reviewFinding().title, by('U2'), 'U1']]);
});

test('D149: a finding on a file sent in runs is checked with the block of the run whose hunks hold its lines', async () => {
  // A file changed every 20th line: 1,500 hunks, over a unit's room; each run of them its own unit.
  const before = linesOf('ss', 30_000);
  const now = before.split('\n').map((line, i) => ((i + 1) % 20 === 0 ? line.toUpperCase() : line)).join('\n');
  const a = before.split('\n').slice(0, -1), b = now.split('\n').slice(0, -1);
  const hunks = [];
  for (let at = 20; at <= a.length; at += 20) {
    const rows = [];
    for (let l = at - 3; l <= Math.min(a.length, at + 3); l++) rows.push(...(l === at ? [`-${a[l - 1]}`, `+${b[l - 1]}`]
      : [` ${a[l - 1]}`]));
    hunks.push(`@@ -${at - 3},${rows.length - 1} +${at - 3},${rows.length - 1} @@`, ...rows);
  }
  const patch = ['diff --git a/big/s.js b/big/s.js', 'index 1111111..2222222 100644', '--- a/big/s.js', '+++ b/big/s.js',
    ...hunks, ''].join('\n');
  const files = { 'big/s.js': now, 'src/parse.js': FILES['src/parse.js'] };
  const modified = { 'big/s.js': { before, patch } };
  const runs = planReviewUnits(scenario(mods, { files, modified }).snapshot).units.filter((u) => u.split);
  assert.ok(runs.length > 1);
  const last = findingOn('big/s.js', 29_980, 'SS 29980'), first = findingOn('big/s.js', 20, 'SS 00020');
  const seen = [];
  const { codePass } = await run({ files, modified, seen, review: (label) => (label === U1
    ? { findings: [last, first], questions: [] } : { findings: [], questions: [] }) });
  const reviewOf = (unit) => seen.find((r) => r.label === `code-review:review:${unit}:R1`).prompt;
  const blockIn = (prompt) => prompt.slice(prompt.indexOf('diff --git a/big/s.js'), prompt.indexOf('\n\n# ',
    prompt.indexOf('diff --git a/big/s.js')));
  const checks = new Map(checksOf(seen).map((r) => [fixture.verifiedFinding(r.prompt).title, r.prompt]));
  assert.equal(blockIn(checks.get(last.title)), blockIn(reviewOf(runs.at(-1).label)));
  assert.equal(blockIn(checks.get(first.title)), blockIn(reviewOf(runs[0].label)));
  assert.deepEqual(codePass.findings.map((x) => [x.title, x.checkUnit]), [[last.title, runs.at(-1).label],
    [first.title, runs[0].label]]);
});

test('D149: a check that one unit\'s block serves is shown the block that unit\'s review was shown, byte for byte, also when the bound left a file of it out', async () => {
  const CHANGE = '# The change — built by Sonah\n\n';
  const blockIn = (prompt) => { const at = prompt.indexOf(CHANGE) + CHANGE.length;
    return prompt.slice(at, prompt.indexOf('\n\n# ', at)); };
  for (const bound of [Infinity, 250_000]) {
    const { seen } = await run({ bound, review: (label) => (label === U1 ? { findings: [fixture.reviewFinding()],
      questions: [] } : { findings: [], questions: [] }) });
    const review = seen.find((r) => r.label === U1), [check] = checksOf(seen);
    assert.equal(blockIn(check.prompt), blockIn(review.prompt), String(bound));
    assert.equal(sectionsIn(review.prompt).includes('src/one/a.js'), bound === Infinity, String(bound));
  }
});

test('D149: a check request carries nothing of who proposed its finding: the same bytes whether one unit proposed it or two', async () => {
  const one = await run({ review: (label) => (label === U1 ? { findings: [fixture.reviewFinding()], questions: [] }
    : { findings: [], questions: [] }) });
  const two = await run({ review: () => ({ findings: [fixture.reviewFinding()], questions: [] }) });
  assert.deepEqual(checksOf(two.seen), checksOf(one.seen));
  assert.equal(checksOf(two.seen).length, 1);
  for (const r of two.seen) assert.ok(!JSON.stringify(r).includes('proposedBy'), r.label);
  assert.deepEqual([one.codePass.findings[0].proposedBy, two.codePass.findings[0].proposedBy], [by('U1'), by('U1', 'U2')]);
});

test('D149: the questions\' check and the accounting are shown the table of contents and the blocks of the units their items\' files are in, as many as fit; none named, the table of contents alone', async () => {
  const question = { question: 'SYNTHETIC should the third module keep its order?', key: 'S1',
    quote: 'add the modules' };
  const review = (label) => (label === U1 ? { findings: [], questions: [question] } : { findings: [], questions: [] });
  const withAsk = (receipts) => (f) => ({ ...f.report, requirements: [{ ...f.report.requirements[0], status: 'partly-done',
    ...receipts }] });
  const blocks = async (report) => {
    const { seen, codePass } = await run({ review, report });
    const batch = seen.find((r) => r.label === 'code-verify:batch'), account = seen.find((r) => r.label === 'code-account:1');
    assert.equal(codePass.questions.length, 1);
    return [batch, account].map((r) => [sectionsIn(r.prompt), tocRowsIn(r.prompt)]);
  };
  // The ask delivered by the write of c.js (W2): U2's block.
  assert.deepEqual(await blocks(withAsk({ deliverable: { eventId: 'W2', role: 'code', quote: 'cc 00001' } })),
    [[['src/two/c.js'], TOC_ROWS], [['src/two/c.js'], TOC_ROWS]]);
  // Delivered by a.js (W1) and short in c.js (W2): both units named, and the two do not fit together: the first alone.
  assert.deepEqual(await blocks(withAsk({ deliverable: { eventId: 'W1', role: 'code', quote: 'aa 00001' },
    shortfall: { eventId: 'W2', role: 'code', quote: 'cc 00001' } })),
  [[['docs/d.md', 'src/one/a.js', 'src/parse.js'], TOC_ROWS], [['docs/d.md', 'src/one/a.js', 'src/parse.js'], TOC_ROWS]]);
  // An ask that names no file: the table of contents alone.
  assert.deepEqual(await blocks((f) => f.report), [[[], TOC_ROWS], [[], TOC_ROWS]]);
});

test('D149: a unit\'s file notes name its own files: a note on another unit\'s file is dropped `file_not_in_unit`, with its unit', async () => {
  const note = (path, what) => ({ path, what, asks: [] });
  const { codePass } = await run({ review: (label) => (label === U1
    ? { findings: [], questions: [], files: [note('src/parse.js', 'SYNTHETIC U1 on its own file.')] }
    : { findings: [], questions: [], files: [note('src/parse.js', 'SYNTHETIC U2 on a file of U1.'),
      note('src/two/c.js', 'SYNTHETIC U2 on its own file.')] }) });
  assert.deepEqual(codePass.filesDropped.map((d) => [d.key, d.index, d.cause, d.unit]),
    [['src/parse.js', 0, 'file_not_in_unit', 'U2']]);
  assert.deepEqual(codePass.files.map((x) => [x.path, x.what ?? null]).sort(), [['docs/d.md', null],
    ['src/one/a.js', null], ['src/parse.js', 'SYNTHETIC U1 on its own file.'], ['src/two/c.js', 'SYNTHETIC U2 on its own file.']]);
});

test('D149: the files outside the session are shown in the first unit\'s request alone', async () => {
  const seen = [];
  const { codePass } = await run({ outside: true, seen });
  const [u1, u2] = seen.filter((r) => isCodeReviewLabel(r.label));
  assert.deepEqual([u1.label, u2.label], [U1, U2]);
  assert.ok(u1.prompt.includes(OUTSIDE_HEADING) && u1.prompt.includes(sectionOf('lib/old.js')));
  assert.ok(!u2.prompt.includes(OUTSIDE_HEADING) && !u2.prompt.includes('lib/old.js'));
  assert.deepEqual(codePass.manifest.units.map((u) => Array.isArray(u.request.outsideFiles)), [true, false]);
  assert.deepEqual(codePass.outsideFiles.map((x) => x.path), ['lib/old.js']);
});

test('D149: today\'s one request groups nothing and records neither who proposed a finding nor which unit checked it', async () => {
  const files = { 'src/parse.js': FILES['src/parse.js'] };
  const seen = [];
  const { codePass } = await run({ files, seen, review: () => ({ findings: [fixture.reviewFinding(),
    fixture.reviewFinding({ title: 'SYNTHETIC the same lines and kind, other words' })], questions: [] }) });
  assert.deepEqual(seen.filter((r) => isCodeReviewLabel(r.label)).map((r) => r.label), ['code-review:agent']);
  assert.equal(codePass.calls.verify, 2);
  assert.deepEqual(codePass.fates.map((r) => r.fate), ['kept', 'kept']);
  assert.ok(codePass.findings.length > 0 && codePass.findings.every((x) => !Object.hasOwn(x, 'proposedBy')
    && !Object.hasOwn(x, 'checkUnit')));
});

test('D149: a note on a file no unit holds (binary, its diff unreadable) is kept from any unit, the first unit\'s first; a note on another unit\'s own file is dropped', async () => {
  const files = { ...FILES, 'assets/logo.png': BASE_FILES['assets/logo.png'], 'src/bad.js': BASE_FILES['src/bad.js'] };
  const f = scenario(mods, { files });
  const plan = planReviewUnits(f.snapshot);
  assert.deepEqual(plan.units.map((u) => u.label), ['U1', 'U2']);
  assert.ok(plan.units.every((u) => !u.paths.includes('assets/logo.png') && !u.paths.includes('src/bad.js')));
  const note = (path, what) => ({ path, what, asks: [] });
  const { codePass } = await run({ files, review: (label) => (label === U1
    ? { findings: [], questions: [], files: [note('assets/logo.png', 'SYNTHETIC U1 on the binary file.'),
      note('src/two/c.js', 'SYNTHETIC U1 on a file of U2.')] }
    : { findings: [], questions: [], files: [note('assets/logo.png', 'SYNTHETIC U2 on the binary file.'),
      note('src/bad.js', 'SYNTHETIC U2 on the unreadable diff.'), note('src/parse.js', 'SYNTHETIC U2 on a file of U1.')] }) });
  assert.deepEqual(codePass.filesDropped.map((d) => [d.key, d.cause, d.unit]),
    [['src/two/c.js', 'file_not_in_unit', 'U1'], ['src/parse.js', 'file_not_in_unit', 'U2']]);
  const whats = new Map(codePass.files.map((x) => [x.path, x.what ?? null]));
  assert.deepEqual([whats.get('assets/logo.png'), whats.get('src/bad.js'), whats.get('src/two/c.js'),
    whats.get('src/parse.js')], ['SYNTHETIC U1 on the binary file.', 'SYNTHETIC U2 on the unreadable diff.', null, null]);
});

test('D149: a file no unit can hold is the first unit\'s own: its commands, its note and the check of a finding on it', async () => {
  // src/p.js's one hunk is over a unit's room; the session ran a command right after writing it, before the others.
  const files = { 'src/p.js': linesOf('pp', 9_800, 20), 'src/one/a.js': FILES['src/one/a.js'],
    'src/two/c.js': FILES['src/two/c.js'] };
  const commandsAfter = { 'src/p.js': ['SYNTHETIC_CMD check p'] };
  const f = scenario(mods, { files, commandsAfter });
  const plan = planReviewUnits(f.snapshot);
  assert.deepEqual([plan.units.map((u) => u.paths), plan.unplaced.map((x) => x.path)], [[['src/one/a.js'],
    ['src/two/c.js']], ['src/p.js']]);
  const note = (path, what) => ({ path, what, asks: [] });
  const onP = findingOn('src/p.js', 5, 'pp 00005');
  const seen = [];
  const { codePass } = await run({ files, commandsAfter, seen, review: (label) => (label === U1
    ? { findings: [], questions: [], files: [note('src/p.js', 'SYNTHETIC U1 on the file no unit holds.')] }
    : { findings: [onP], questions: [], files: [note('src/p.js', 'SYNTHETIC U2 on it.')] }) });
  const [u1, u2] = [U1, U2].map((label) => seen.find((r) => r.label === label).prompt);
  assert.ok(u1.includes('SYNTHETIC_CMD check p') && u1.includes('{"path":"src/p.js","firstCommandAfterLastEdit":"C1"}'));
  assert.ok(!u2.includes('SYNTHETIC_CMD check p'));
  assert.deepEqual(codePass.filesDropped.map((d) => [d.key, d.cause, d.unit]), [['src/p.js', 'file_not_in_unit', 'U2']]);
  assert.equal(codePass.files.find((x) => x.path === 'src/p.js').what, 'SYNTHETIC U1 on the file no unit holds.');
  const [check] = checksOf(seen);
  assert.deepEqual([sectionsIn(check.prompt, files), codePass.findings.map((x) => [x.proposedBy, x.checkUnit])],
    [['src/one/a.js'], [[by('U2'), 'U1']]]);
});

test('D149: a finding on the earlier side of a file sent in runs is checked with the run whose hunks hold those earlier lines', async () => {
  // Every 20th line changed and a line inserted after it: 1,500 hunks, the lines now one further each hunk, over a
  // unit's room.
  const before = linesOf('ss', 30_000);
  const a = before.split('\n').slice(0, -1);
  const b = a.flatMap((line, i) => ((i + 1) % 20 === 0 ? [line.toUpperCase(), `INSERTED ${String(i + 1).padStart(5, '0')}`]
    : [line]));
  const hunks = [];
  for (let at = 20, k = 0; at <= a.length; at += 20, k++) {
    const from = at - 3, to = Math.min(a.length, at + 3);
    const rows = [];
    for (let l = from; l <= to; l++) rows.push(...(l === at ? [`-${a[l - 1]}`, `+${a[l - 1].toUpperCase()}`,
      `+INSERTED ${String(at).padStart(5, '0')}`] : [` ${a[l - 1]}`]));
    hunks.push(`@@ -${from},${to - from + 1} +${from + k},${to - from + 2} @@`, ...rows);
  }
  const patch = ['diff --git a/big/s.js b/big/s.js', 'index 1111111..2222222 100644', '--- a/big/s.js', '+++ b/big/s.js',
    ...hunks, ''].join('\n');
  const files = { 'big/s.js': `${b.join('\n')}\n`, 'src/parse.js': FILES['src/parse.js'] };
  const modified = { 'big/s.js': { before, patch } };
  const runs = planReviewUnits(scenario(mods, { files, modified }).snapshot).units.filter((u) => u.split);
  assert.ok(runs.length > 1);
  // The earlier side's changed line of the last run's first hunk: on the side now, that number lies in an earlier run.
  const line = 20 * (runs.at(-1).hunks[0] + 1);
  const quote = `ss ${String(line).padStart(5, '0')}`;
  const old = fixture.reviewFinding({ title: 'SYNTHETIC an earlier line in the last run',
    trace: [{ step: 'SYNTHETIC the earlier line.', path: 'big/s.js', side: 'old', startLine: line, endLine: line, quote }],
    anchor: { path: 'big/s.js', side: 'old', startLine: line, endLine: line } });
  const { codePass } = await run({ files, modified, review: (label) => (label === U1 ? { findings: [old], questions: [] }
    : { findings: [], questions: [] }) });
  assert.deepEqual(codePass.findings.map((x) => [x.title, x.checkUnit]), [[old.title, runs.at(-1).label]]);
});

test('D149: a finding on a file no unit holds, outside the session, is checked with the block of the unit that proposed it, and the record says no unit holds it', async () => {
  const away = fixture.reviewFinding({ title: 'SYNTHETIC old is 2', trace: [{ step: 'SYNTHETIC old is now 2.',
    path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1, quote: 'export const old = 2;' }],
  anchor: { path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1 } });
  const seen = [];
  const { codePass } = await run({ outside: true, seen, review: (label) => (label === U2
    ? { findings: [away], questions: [] } : { findings: [], questions: [] }) });
  const [check] = checksOf(seen);
  assert.deepEqual([sectionsIn(check.prompt), tocRowsIn(check.prompt)], [['src/two/c.js'], TOC_ROWS]);
  assert.ok(check.prompt.includes(OUTSIDE_HEADING));
  assert.deepEqual(codePass.findings.map((x) => [x.title, x.outsideSession, x.proposedBy, x.checkUnit]),
    [[away.title, true, by('U2'), null]]);
});
