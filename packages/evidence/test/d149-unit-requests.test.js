// D149: a change of more than one review unit is sent as one review request a unit. Each request shows the whole
// change's table of contents, the same bytes in every unit, each row naming the unit that shows its hunks; its own
// files' hunks; part B's whole files of its own; and its brief says which unit it is. The calls run six at a time, each
// with its own repair, labelled `code-review:review:U<k>:R1` (a call that failed is asked again by the transport alone,
// under its rules). The record keeps every
// unit (`manifest.units`) and, as one request's manifest, the union of what they showed (`manifest.review`), which every
// reader reads; a unit past the guard is closed `unit_cap`; the record is the same whatever order the calls end in.
//
// Synthetic files and sessions, deterministic fake agents: no recording, no model, no network. Each rule is a test that
// fails on a mutant of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, planReviewUnits, unitChangeBlock, codeSeenOf,
  codeChangeTally, isCodeReviewLabel, CODE_CHANGE_BLOCK_MAX_BYTES, CODE_UNIT_BRIEF, CODE_UNIT_LIMITS } from '../src/code-pass.js';
import { CHANGE_ROW_WORDS, commandsAfterLastEdit, namesPath, COMMANDS_HEADING, NAMED_COMMANDS_HEADING }
  from '../src/code-context.js';
import { withTransportRetry } from '../../cli/src/review-judge.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines, codeFooterLines } from '../src/code-report.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, linesOf, GIT, ROOT } from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
const B_BEFORE = linesOf('bb', 3_000);
/** Five files of two units: U1 docs/d.md, src/one/a.js, src/one/b.js (modified in one line) and src/parse.js (the
 *  directory, then the table of contents' order); U2 src/two/c.js, which does not fit beside them. */
const FILES = Object.freeze({ 'src/one/a.js': linesOf('aa', 4_000), 'src/one/b.js': B_BEFORE.replace('bb 00010', 'BB 00010'),
  'src/two/c.js': linesOf('cc', 3_500), 'docs/d.md': linesOf('dd', 200), 'src/parse.js': fixture.CODE_FILES['src/parse.js'] });
const patchB = () => {
  const a = B_BEFORE.split('\n').slice(0, -1), b = FILES['src/one/b.js'].split('\n').slice(0, -1);
  const rows = [];
  for (let l = 7; l <= 13; l++) rows.push(...(l === 10 ? [`-${a[l - 1]}`, `+${b[l - 1]}`] : [` ${a[l - 1]}`]));
  return ['diff --git a/src/one/b.js b/src/one/b.js', 'index 1111111..2222222 100644', '--- a/src/one/b.js',
    '+++ b/src/one/b.js', '@@ -7,7 +7,7 @@', ...rows, ''].join('\n');
};
const MODIFIED = Object.freeze({ 'src/one/b.js': { before: B_BEFORE, patch: patchB() } });
const reviewLabel = (k) => `code-review:review:U${k}:R1`;
const tocOf = (prompt) => prompt.slice(prompt.indexOf('## Files ('), prompt.indexOf('\n---\n'));
const delay = (ms) => new Promise((done) => { setTimeout(done, ms); });

/**
 * One run over `files` (`modified` as the fixture's): each unit's review answers `review(label, request)` (nothing by
 * default; a thrown error is a call that failed), each finding's check holds, the accounting holds every item. `seen`
 * receives every request's label (`keep`: and the request).
 */
async function runUnits({ files = FILES, modified = MODIFIED, wholeFiles = true, review = () => ({ findings: [],
  questions: [] }), seen = [], keep = true, bound = Infinity, commandsAfter = {}, commandsFirst = [], wrap = (j) => j } = {}) {
  const f = scenario(mods, { files, modified, commandsAfter, commandsFirst });
  const judge = async (request) => {
    seen.push(keep ? request : { label: request.label });
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return fixture.accountsHold(request.prompt);
    if (isCodeReviewLabel(request.label)) return review(request.label, request);
    if (/^code-verify:F\d+/.test(request.label)) return fixture.holds(fixture.verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return fixture.allSound(fixture.batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
  const result = await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo,
    judge: wrap(judge), base: GIT, root: ROOT, wholeFiles, bound });
  return { ...result, f };
}

test('D149: one review request a unit, each with the same table of contents naming every row\'s unit, its own files\' hunks and whole files, and its brief', async () => {
  const seen = [];
  const { codePass, f } = await runUnits({ seen });
  const plan = planReviewUnits(f.snapshot);
  assert.deepEqual(plan.units.map((u) => [u.label, u.paths]), [['U1', ['docs/d.md', 'src/one/a.js', 'src/one/b.js',
    'src/parse.js']], ['U2', ['src/two/c.js']]]);
  const reviews = seen.filter((r) => isCodeReviewLabel(r.label));
  assert.deepEqual(reviews.map((r) => r.label), [reviewLabel(1), reviewLabel(2)]);
  // The table of contents: the same bytes in both, every row naming its unit.
  assert.equal(tocOf(reviews[0].prompt), tocOf(reviews[1].prompt));
  assert.deepEqual(tocOf(reviews[0].prompt).split('\n').filter((l) => l.startsWith('- ')), ['- docs/d.md · added · U1',
    '- src/one/a.js · added · U1', '- src/one/b.js · modified · U1', '- src/parse.js · added · U1',
    '- src/two/c.js · added · U2']);
  // Each request shows its own files' hunks alone.
  const sections = (prompt) => Object.keys(FILES).filter((p) => prompt.includes(`diff --git a/${p} b/${p}\n`)).sort();
  assert.deepEqual(sections(reviews[0].prompt), ['docs/d.md', 'src/one/a.js', 'src/one/b.js', 'src/parse.js']);
  assert.deepEqual(sections(reviews[1].prompt), ['src/two/c.js']);
  // Part B: b.js, modified, whole in its own unit's request alone.
  assert.ok(reviews[0].prompt.includes('FILE {"path":"src/one/b.js","lines":3000}'));
  assert.ok(!reviews[1].prompt.includes('FILE {"path":"src/one/b.js"'));
  // Each brief names its unit, after today's brief.
  for (const [k, r] of reviews.entries()) assert.ok(r.system.endsWith(CODE_UNIT_BRIEF(k + 1, 2)), String(k));
  // Each unit's change block stays within the change block's cap: the rows' unit words fit the room the reserve keeps.
  for (const k of [0, 1]) assert.ok(Buffer.byteLength(unitChangeBlock(f.snapshot, plan, k).change)
    <= CODE_CHANGE_BLOCK_MAX_BYTES, String(k));
  assert.equal(codePass.calls.review, 2);
});

test('D149: the record keeps every unit and, as one request\'s manifest, what they showed together; the ledger names each hunk\'s unit; every reader sees the whole change', async () => {
  const { codePass } = await runUnits({ wholeFiles: false });
  assert.deepEqual(codePass.manifest.units.map((u) => [u.label, u.paths, u.sent, u.answered, u.terminal,
    Number.isSafeInteger(u.bytes) && u.bytes > 0, u.request.sent]), [
    ['U1', ['docs/d.md', 'src/one/a.js', 'src/one/b.js', 'src/parse.js'], true, true, 'answered', true, true],
    ['U2', ['src/two/c.js'], true, true, 'answered', true, true]]);
  assert.deepEqual(codePass.manifest.review.files.map((e) => [e.path, e.state, e.units]), [
    ['docs/d.md', 'whole', ['U1']], ['src/one/a.js', 'whole', ['U1']], ['src/one/b.js', 'hunks_only', ['U1']],
    ['src/parse.js', 'whole', ['U1']], ['src/two/c.js', 'whole', ['U2']]]);
  assert.equal(codePass.manifest.review.sent, true);
  assert.deepEqual(codePass.manifest.hunks.map((e) => [e.path, e.shownIn]), [['docs/d.md', [reviewLabel(1)]],
    ['src/one/a.js', [reviewLabel(1)]], ['src/one/b.js', [reviewLabel(1)]], ['src/parse.js', [reviewLabel(1)]],
    ['src/two/c.js', [reviewLabel(2)]]]);
  assert.ok(codeSeenOf(codePass).files.every((x) => x.changeSeen === true));
  assert.deepEqual(codeChangeTally(codePass).groups.not_seen, []);
  assert.deepEqual([codePass.coverage, codePass.footer], ['complete', []]);
  assert.deepEqual(codePass.files.map((x) => x.state), ['shown', 'shown', 'shown', 'shown', 'shown']);
  assert.equal(codeCoverageLines(codePass)[0], W.units(5, 2, []));
  assert.equal(W.units(5, 2, []), 'Sonah showed the code review every changed line of 5 files in 2 calls.');
});

test('D149: a unit\'s failed call is asked again by the transport alone, under its rules, and a unit\'s answer it cannot use gets its own repair, by its unit\'s labels', async () => {
  // Through the transport every review's judge goes through (cli session-review.js): one retry of a transport failure;
  // none of an agent call that ran out of its time, of a provider class an identical request cannot change, or of a
  // request refused before it was sent. The code step adds no call of its own.
  for (const [code, providerClass, physical] of [['model_unavailable', 'exit_nonzero', 2], ['model_unavailable',
    'rate_limit', 1], ['model_unavailable', 'auth', 1], ['model_timeout', 'timeout', 1], ['invalid_model_input', null, 1]]) {
    const seen = [];
    const { codePass } = await runUnits({ seen, keep: false, wrap: withTransportRetry, review: (label) => {
      if (label === reviewLabel(1)) throw Object.assign(new Error('synthetic'), { code, providerClass });
      return { findings: [], questions: [] };
    } });
    const how = `${code}/${providerClass}`;
    assert.deepEqual(seen.map((r) => r.label).filter(isCodeReviewLabel).sort(), [...Array(physical).fill(reviewLabel(1)),
      reviewLabel(2)].sort(), how);
    assert.deepEqual(codePass.manifest.units.map((u) => [u.label, u.answered, Object.hasOwn(u, 'retried')]),
      [['U1', false, false], ['U2', true, false]], how);
    assert.equal(codePass.calls.review, 2, how);
  }
  const seen = [];
  const { codePass } = await runUnits({ seen, keep: false, review: (label) => (label === reviewLabel(2) ? {}
    : { findings: [], questions: [] }) });
  assert.deepEqual(seen.map((r) => r.label).filter(isCodeReviewLabel).sort(), [reviewLabel(1), reviewLabel(2),
    `${reviewLabel(2)}:repair`]);
  assert.deepEqual(codePass.manifest.units.map((u) => [u.label, Boolean(u.repair), u.terminal]),
    [['U1', false, 'answered'], ['U2', true, 'answered']]);
  assert.deepEqual([codePass.calls.review, codePass.calls.repair, codePass.coverage], [2, 1, 'complete']);
});

test('D149: a unit whose call stays silent leaves its files unseen and named, and the coverage partial', async () => {
  const { codePass } = await runUnits({ wholeFiles: false, review: (label) => {
    if (label.startsWith(reviewLabel(1))) throw Object.assign(new Error('synthetic'), { code: 'model_unavailable' });
    return { findings: [], questions: [] };
  } });
  assert.deepEqual(codePass.manifest.units.map((u) => [u.label, u.answered, u.terminal]), [['U1', false, 'failed'],
    ['U2', true, 'answered']]);
  const seen = new Map(codeSeenOf(codePass).files.map((x) => [x.path, x.state]));
  assert.deepEqual([...seen], [['docs/d.md', 'not_seen'], ['src/one/a.js', 'not_seen'], ['src/one/b.js', 'not_seen'],
    ['src/parse.js', 'not_seen'], ['src/two/c.js', 'whole']]);
  assert.equal(codePass.coverage, 'partial');
  assert.deepEqual(codePass.footer.filter((e) => e.kind === 'withheld').map((e) => e.path),
    ['docs/d.md', 'src/one/a.js', 'src/one/b.js', 'src/parse.js']);
  assert.deepEqual(codePass.footer.filter((e) => e.kind === 'failed'), [{ kind: 'failed', part: 'review', count: 1 }]);
  assert.ok(codeFooterLines({ codePass }).some((line) => line.startsWith(W.footerKinds.failed({ count: 1, parts: [] }))));
});

test('D149: a file over a unit\'s room is sent in runs of whole hunks, each run in its own unit\'s request, and every hunk once', async () => {
  // A file changed every 20th line: 1,500 hunks, over the room; each run of them its own unit.
  const before = linesOf('ss', 30_000);
  const now = before.split('\n').map((line, i) => ((i + 1) % 20 === 0 ? line.toUpperCase() : line)).join('\n');
  const a = before.split('\n').slice(0, -1), b = now.split('\n').slice(0, -1);
  const hunks = [];
  for (let at = 20; at <= a.length; at += 20) {
    const from = at - 3, to = Math.min(a.length, at + 3);
    const rows = [];
    for (let l = from; l <= to; l++) rows.push(...(l === at ? [`-${a[l - 1]}`, `+${b[l - 1]}`] : [` ${a[l - 1]}`]));
    hunks.push(`@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`, ...rows);
  }
  const patch = ['diff --git a/big/s.js b/big/s.js', 'index 1111111..2222222 100644', '--- a/big/s.js', '+++ b/big/s.js',
    ...hunks, ''].join('\n');
  const files = { 'big/s.js': now, 'src/parse.js': fixture.CODE_FILES['src/parse.js'] };
  const seen = [];
  const { codePass, f } = await runUnits({ files, modified: { 'big/s.js': { before, patch } }, wholeFiles: false, seen });
  const plan = planReviewUnits(f.snapshot);
  const runs = plan.units.filter((u) => u.split);
  assert.ok(runs.length > 1 && runs.every((u) => u.paths[0] === 'big/s.js'));
  assert.deepEqual([runs[0].hunks[0], runs.at(-1).hunks[1]], [0, 1_499]);
  // Each run's request shows its hunks' rows and no other run's.
  const reviews = new Map(seen.filter((r) => isCodeReviewLabel(r.label)).map((r) => [r.label, r]));
  const snapshotFile = f.snapshot.find((x) => x.path === 'big/s.js');
  const at = (i) => `\n@@ -${snapshotFile.hunks[i].oldStart},${snapshotFile.hunks[i].oldCount} +`;
  for (const u of runs) {
    const prompt = reviews.get(reviewLabel(Number(u.label.slice(1)))).prompt;
    assert.ok(prompt.includes(at(u.hunks[0])) && prompt.includes(at(u.hunks[1])), u.label);
    const other = runs.find((x) => x !== u);
    assert.ok(!prompt.includes(at(other.hunks[0])), u.label);
    assert.equal(tocOf(prompt).split('\n').find((l) => l.startsWith('- big/s.js')),
      `- big/s.js · modified · ${runs[0].label} to ${runs.at(-1).label}`);
  }
  // The ledger: each hunk in its run's unit; the union: every hunk shown, the change seen.
  const ledger = codePass.manifest.hunks.filter((e) => e.path === 'big/s.js');
  assert.equal(ledger.length, 1_500);
  for (const u of runs) for (let i = u.hunks[0]; i <= u.hunks[1]; i++)
    assert.deepEqual(ledger[i].shownIn, [reviewLabel(Number(u.label.slice(1)))], String(i));
  const entry = codePass.manifest.review.files.find((e) => e.path === 'big/s.js');
  assert.deepEqual([entry.state, entry.units], ['hunks_only', runs.map((u) => u.label)]);
  assert.equal(codeSeenOf(codePass).files.find((x) => x.path === 'big/s.js').changeSeen, true);
  assert.equal(codePass.coverage, 'complete');
  // One run's call silent: the file counts only the runs the answered units showed, its change not seen.
  const silentRun = runs[0].label;
  const { codePass: partly } = await runUnits({ files, modified: { 'big/s.js': { before, patch } }, wholeFiles: false,
    keep: false, review: (label) => {
      if (label.startsWith(reviewLabel(Number(silentRun.slice(1))))) throw Object.assign(new Error('synthetic'),
        { code: 'judge_failed' });
      return { findings: [], questions: [] };
    } });
  const some = partly.manifest.review.files.find((e) => e.path === 'big/s.js');
  assert.deepEqual([some.state, some.units], ['hunks_only', runs.slice(1).map((u) => u.label)]);
  assert.ok(some.beforeUnshown > 0 && Array.isArray(some.change));
  const sees = codeSeenOf(partly).files.find((x) => x.path === 'big/s.js');
  assert.deepEqual([sees.state, sees.changeSeen], ['in_part', false]);
  assert.equal(partly.coverage, 'partial');
});

test('D149: the same record whatever order the units\' calls end in, and a folded candidate\'s triage key names what its group published', async () => {
  const entry = { key: 'F1', level: 'high', impact: 'An empty input gives you one empty part.',
    action: 'Return an empty list for empty input.', label: 'fix empty input', where: null };
  const records = [];
  for (const slow of [1, 2]) {
    const { codePass } = await runUnits({ review: async (label) => {
      await delay(label === reviewLabel(slow) ? 30 : 1);
      // Each unit proposes the same finding; U2 also its triage, keyed F1 in its own answer.
      return label === reviewLabel(2) ? { findings: [fixture.reviewFinding()], questions: [], triage: [entry] }
        : { findings: [fixture.reviewFinding()], questions: [] };
    } });
    records.push(codePass);
  }
  assert.deepEqual(records[0], records[1]);
  const [codePass] = records;
  assert.equal(codePass.findings.length, 1);
  assert.deepEqual(codePass.triage.map((t) => t.ref), [{ finding: codePass.findings[0].id }]);
  // U2's copy folds into U1's before any check (D149): one group, one check.
  assert.deepEqual(codePass.fates.filter((r) => r.from === 'answer').map((r) => [r.unit, r.list, r.index, r.fate,
    r.into]), [['U1', 'findings', 0, 'kept', undefined],
    ['U2', 'findings', 0, 'folded', [{ from: 'answer', index: 0, unit: 'U1' }]]]);
  assert.equal(codePass.calls.verify, 1);
});

test('D149: a file no unit can hold (its one hunk over the room) is offered whole to part B in the first unit', async () => {
  const files = { 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500),
    'src/p.js': linesOf('pp', 9_800, 20) };
  const seen = [];
  const { codePass, f } = await runUnits({ files, modified: {}, wholeFiles: true, seen });
  const plan = planReviewUnits(f.snapshot);
  assert.deepEqual([plan.units.length, plan.unplaced], [2, [{ path: 'src/p.js', at: 0 }]]);
  const [u1, u2] = seen.filter((r) => isCodeReviewLabel(r.label));
  assert.ok(u1.prompt.includes('FILE {"path":"src/p.js","lines":9800}'));
  assert.ok(!u2.prompt.includes('FILE {"path":"src/p.js"'));
  const entry = codePass.manifest.review.files.find((e) => e.path === 'src/p.js');
  assert.deepEqual([entry.state, entry.units, entry.beforeUnshown], ['whole', ['U1'], 0]);
  assert.equal(codeSeenOf(codePass).files.find((x) => x.path === 'src/p.js').changeSeen, true);
  assert.deepEqual(codePass.manifest.hunks.filter((e) => e.path === 'src/p.js').map((e) => e.shownIn), [[reviewLabel(1)]]);
  // Part A: no request shows it, and its hunk, over every unit's room alone, is closed `block_cap` (too large on its own).
  const { codePass: partA } = await runUnits({ files, modified: {}, wholeFiles: false, keep: false });
  assert.deepEqual(partA.manifest.hunks.filter((e) => e.path === 'src/p.js').map((e) => [e.shownIn, e.closed]),
    [[[], 'block_cap']]);
  const left = partA.manifest.review.files.find((e) => e.path === 'src/p.js');
  assert.deepEqual([left.state, left.reason, left.alone], ['left_out', 'block_cap', true]);
  assert.equal(partA.files.find((x) => x.path === 'src/p.js').state, 'oversize');
});

test('D149: at most six unit calls run at once', async () => {
  const files = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`m${i}/f.js`, linesOf(`m${i}`, 4_000)]));
  let active = 0, peak = 0;
  const { codePass } = await runUnits({ files, modified: {}, wholeFiles: false, keep: false, review: async () => {
    active += 1; peak = Math.max(peak, active);
    await delay(5);
    active -= 1;
    return { findings: [], questions: [] };
  } });
  assert.equal(codePass.manifest.units.length, 9);
  assert.equal(CODE_UNIT_LIMITS.inFlight, 6);
  assert.equal(peak, 6);
});

test('D149: past the guard of 50 units, a file is closed unit_cap in the record, the ledger and every table of contents', async () => {
  const files = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`m${String(i).padStart(2, '0')}/f.js`,
    linesOf(`m${i}`, 4_000)]));
  const seen = [];
  const { codePass } = await runUnits({ files, modified: {}, wholeFiles: false, seen, keep: true });
  assert.equal(codePass.manifest.units.length, CODE_UNIT_LIMITS.units);
  const last = 'm50/f.js';
  const entry = codePass.manifest.review.files.find((e) => e.path === last);
  assert.deepEqual([entry.state, entry.reason], ['left_out', 'unit_cap']);
  assert.deepEqual(codePass.manifest.hunks.filter((e) => e.path === last).map((e) => [e.shownIn, e.closed]),
    [[[], 'unit_cap']]);
  const first = seen.find((r) => r.label === reviewLabel(1));
  assert.ok(first.prompt.includes(`- ${last} · added · ${CHANGE_ROW_WORDS.unit_cap}\n`));
  assert.equal(codeCoverageLines(codePass)[0], W.units(50, 50, [[W.unitCap, 1]]));
  assert.equal(codePass.files.find((x) => x.path === last).state, 'left_out');
});

test('D149: a file only a silent unit was shown is read from the reading records alone, never seen whole by another unit\'s one line', async () => {
  // U1's call stays silent; U2's agent opens one line of U1's src/one/a.js (4,000 lines).
  const { codePass, f } = await runUnits({ wholeFiles: false, review: (label, request) => {
    if (label.startsWith(reviewLabel(1))) throw Object.assign(new Error('synthetic'), { code: 'judge_failed' });
    // And opens U1's src/one/b.js (modified) whole: as it is now, never as it was before (its removed rows were in the
    // silent unit's request alone).
    const root = request.agent.root;
    return fixture.withRun({ findings: [], questions: [] }, { ...fixture.SYNTHETIC_RUN, toolCalls: { Read: 2, Grep: 0,
      Glob: 0, StructuredOutput: 1 }, reads: [`${root}/src/one/a.js`, `${root}/src/one/b.js`], readRanges: [{ path:
        `${root}/src/one/a.js`, startLine: 1, numLines: 1, totalLines: 4_000 }, { path: `${root}/src/one/b.js`,
      startLine: 1, numLines: 3_000, totalLines: 3_000 }] });
  } });
  assert.deepEqual(codePass.manifest.units.map((u) => u.answered), [false, true]);
  const seen = new Map(codeSeenOf(codePass).files.map((x) => [x.path, [x.state, x.changeSeen, x.lines ?? null]]));
  assert.deepEqual(seen.get('src/one/a.js'), ['in_part', false, [[1, 1]]]);
  assert.deepEqual(seen.get('src/one/b.js'), ['whole', false, null]);
  assert.deepEqual(seen.get('docs/d.md'), ['not_seen', false, null]);
  assert.ok(!codeCoverageLines(codePass).some((line) => /saw \d+ of them whole/.test(line)
    && Number(/saw (\d+) of them whole/.exec(line)[1]) > 1), codeCoverageLines(codePass).join('\n'));
  // The rule files and the commands are the answered unit's.
  assert.equal(planReviewUnits(f.snapshot).units.length, 2);
});

test('D149: a unit\'s own file its request leaves out for the bound says so in that unit\'s table of contents', async () => {
  // At this bound U1's request leaves out its largest file, src/one/a.js, for room; U2 still names it U1's.
  const seen = [];
  const { codePass } = await runUnits({ wholeFiles: false, seen, bound: 250_000 });
  const u1 = codePass.manifest.units[0].request.files.find((e) => e.path === 'src/one/a.js');
  assert.deepEqual([u1.state, u1.reason], ['left_out', 'request_bound']);
  const [first, second] = seen.filter((r) => isCodeReviewLabel(r.label));
  const row = (prompt) => tocOf(prompt).split('\n').find((l) => l.startsWith('- src/one/a.js'));
  assert.equal(row(first.prompt), `- src/one/a.js · added · ${CHANGE_ROW_WORDS.request_bound}`);
  assert.equal(row(second.prompt), '- src/one/a.js · added · U1');
  // Every other row is the same in both.
  const others = (prompt) => tocOf(prompt).split('\n').filter((l) => !l.startsWith('- src/one/a.js'));
  assert.deepEqual(others(first.prompt), others(second.prompt));
});

test('D149: each unit\'s request lists the commands recorded after its own files\' earliest last edit, numbered in the unit', async () => {
  // a.js (U1) written, then `npm test one`; c.js (U2) written, then `npm test two`.
  const files = { 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500) };
  const commandsAfter = { 'src/one/a.js': ['SYNTHETIC npm test one'], 'src/two/c.js': ['SYNTHETIC npm test two'] };
  const seen = [];
  const { codePass } = await runUnits({ files, modified: {}, commandsAfter, wholeFiles: false, seen });
  const [u1, u2] = seen.filter((r) => isCodeReviewLabel(r.label));
  const commandsBlock = (prompt) => prompt.slice(prompt.indexOf('## The commands recorded after'), prompt.indexOf(
    '## Each changed file\'s first command'));
  assert.ok(commandsBlock(u1.prompt).includes('npm test one') && commandsBlock(u1.prompt).includes('npm test two'));
  assert.ok(!commandsBlock(u2.prompt).includes('npm test one') && commandsBlock(u2.prompt).includes('npm test two'));
  assert.ok(commandsBlock(u2.prompt).includes('"command":"C1"'), commandsBlock(u2.prompt));
  // The record: each unit's own count; together, the session's, none left out.
  assert.deepEqual(codePass.manifest.units.map((u) => u.request.commands.count), [2, 1]);
  assert.deepEqual([codePass.manifest.review.commands.count, codePass.manifest.review.commands.from], [2, 1]);
  assert.ok(!codePass.footer.some((e) => e.kind === 'commands_left_out'));
  // U1's call silent: the commands U2 showed alone, by the session's numbers — the first was shown only to U1.
  const { codePass: silent } = await runUnits({ files, modified: {}, commandsAfter, wholeFiles: false, keep: false,
    review: (label) => {
      if (label.startsWith(reviewLabel(1))) throw Object.assign(new Error('synthetic'), { code: 'judge_failed' });
      return { findings: [], questions: [] };
    } });
  assert.deepEqual([silent.manifest.review.commands.count, silent.manifest.review.commands.from], [2, 2]);
});

test('D149: a unit\'s request also lists, in recorded order, each once and marked, the earlier commands whose text names one of its own files as a whole path', async () => {
  // Before any write: `grep … src/two/c.js`, `cat src/two/c.json` (another path), `node ./src/two/c.js`, and `wc -l` of
  // its absolute path; a.js (U1) written, then `cat src/two/c.js` and `npm test one`; c.js (U2) written, then
  // `npm test two` and `node src/two/c.js` (after its edit and naming it: listed once, unmarked).
  const files = { 'src/one/a.js': linesOf('aa', 4_000), 'src/two/c.js': linesOf('cc', 3_500) };
  const commandsFirst = ['SYNTHETIC grep -n x src/two/c.js', 'SYNTHETIC cat src/two/c.json',
    'SYNTHETIC node ./src/two/c.js', `SYNTHETIC wc -l ${ROOT}/src/two/c.js`];
  const commandsAfter = { 'src/one/a.js': ['SYNTHETIC cat src/two/c.js', 'SYNTHETIC npm test one'],
    'src/two/c.js': ['SYNTHETIC npm test two', 'SYNTHETIC node src/two/c.js'] };
  const seen = [];
  const { codePass } = await runUnits({ files, modified: {}, commandsAfter, commandsFirst, wholeFiles: false, seen });
  const [u1, u2] = seen.filter((r) => isCodeReviewLabel(r.label));
  const ran = (prompt) => prompt.split('\n').filter((l) => l.startsWith('{"command":"C')).map((l) => JSON.parse(l))
    .map((c) => [c.command, c.ran, c.named ?? false]);
  // U1: the commands after its file's last edit (no earlier one names a.js), under today's heading; U2: the earlier ones
  // that name c.js, marked, then those after c.js's last edit, numbered in the unit, under the heading that says so.
  assert.deepEqual(ran(u1.prompt), [['C1', 'SYNTHETIC cat src/two/c.js', false], ['C2', 'SYNTHETIC npm test one', false],
    ['C3', 'SYNTHETIC npm test two', false], ['C4', 'SYNTHETIC node src/two/c.js', false]]);
  assert.deepEqual(ran(u2.prompt), [['C1', 'SYNTHETIC grep -n x src/two/c.js', true],
    ['C2', 'SYNTHETIC node ./src/two/c.js', true], ['C3', `SYNTHETIC wc -l ${ROOT}/src/two/c.js`, true],
    ['C4', 'SYNTHETIC cat src/two/c.js', true], ['C5', 'SYNTHETIC npm test two', false],
    ['C6', 'SYNTHETIC node src/two/c.js', false]]);
  assert.ok(u1.prompt.includes(`${COMMANDS_HEADING}\n`) && !u1.prompt.includes(NAMED_COMMANDS_HEADING));
  assert.ok(u2.prompt.includes(`${NAMED_COMMANDS_HEADING}\n`));
  assert.ok(u2.prompt.includes('{"path":"src/two/c.js","firstCommandAfterLastEdit":"C5"}'));
  // The record, by the session's numbers: today's block's four and the three before them, seven; every one shown.
  assert.deepEqual(codePass.manifest.units.map((u) => u.request.commands.count), [4, 6]);
  assert.deepEqual([codePass.manifest.review.commands.count, codePass.manifest.review.commands.from,
    codePass.manifest.review.commands.unshown], [7, 1, undefined]);
  assert.ok(!codePass.footer.some((e) => e.kind === 'commands_left_out'));
  // U1's call silent: U2 showed all but `npm test one`, which no unit showed; the record and the footer say so.
  const { codePass: silent } = await runUnits({ files, modified: {}, commandsAfter, commandsFirst, wholeFiles: false,
    keep: false, review: (label) => {
      if (label.startsWith(reviewLabel(1))) throw Object.assign(new Error('synthetic'), { code: 'judge_failed' });
      return { findings: [], questions: [] };
    } });
  assert.deepEqual([silent.manifest.review.commands.count, silent.manifest.review.commands.from,
    silent.manifest.review.commands.unshown], [7, 1, 1]);
  assert.deepEqual(silent.footer.filter((e) => e.kind === 'commands_left_out'), [{ kind: 'commands_left_out', count: 1 }]);
  // The block's rule alone: with no file of the unit's edited, only the commands that name its files, each marked; with
  // no name either, none.
  const f = scenario(mods, { files, modified: {}, commandsAfter, commandsFirst });
  assert.deepEqual(commandsAfterLastEdit(f.session, [], ROOT, { named: ['src/two/c.js'] }).commands
    .map((c) => [c.text, c.named]), [['SYNTHETIC grep -n x src/two/c.js', true], ['SYNTHETIC node ./src/two/c.js', true],
    ['SYNTHETIC cat src/two/c.js', true], ['SYNTHETIC node src/two/c.js', true]]);
  assert.deepEqual(commandsAfterLastEdit(f.session, [], ROOT), { commands: [], files: [] });
  // A whole path: bounded by no path character, but a leading `./`.
  assert.deepEqual(['x src/a.js', 'x "src/a.js"', 'x ./src/a.js', 'x=src/a.js;', 'src/a.js', 'x src/a.json', 'x lib/src/a.js',
    'x xsrc/a.js', 'x .//src/a.js', 'x a./src/a.js', 'x src/a.js.map'].map((text) => namesPath(text, 'src/a.js')),
  [true, true, true, true, true, false, false, false, false, false, false]);
});
