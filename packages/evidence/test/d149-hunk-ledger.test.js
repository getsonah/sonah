// D149: the hunk ledger. Every hunk of the change, from the frozen snapshot, has an id over its path, side, `@@` numbers
// and rows, its changed lines, and, in the record, the requests of the code review that showed its rows or why none did;
// a file whose hunks cannot be shown keeps its closed state. Every file whose hunks from the start commit Sonah holds
// keeps its added and removed lines, shown or not. The ledger only records: no byte of any request moves (golden digests
// of the requests before D149).
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Each rule is a test that fails on a mutant of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_FILE_STATES, CODE_LEFT_OUT_REASONS } from '../src/ledger.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, hunkLedger, hunkId, codeSeenOf, planReviewUnits,
  SOURCE_ID_HEX } from '../src/code-pass.js';
import { changedSpans, recordedHunks } from '../src/code-context.js';
import * as fixture from '../../cli/test/code-pass-fixture.js';
import { scenario, runScenario, digestOf, FILES, linesOf, replacedPatch, GOLDEN_REQUESTS }
  from './d149-hunk-ledger-fixture.js';

const mods = { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fixture };
const ID = new RegExp(`^hunk:[0-9a-f]{${SOURCE_ID_HEX}}$`);
const hunksOf = (ledger) => ledger.filter((e) => typeof e.closed !== 'string' || Number.isSafeInteger(e.at));
const pad = (n) => (n === null || n === undefined ? '    ' : String(n).padStart(4, ' '));
/** A hunk's rows as the change block shows them (code-context.js `rowLine`). */
const rowLines = (hunk) => hunk.rows.map((r) => `| ${pad(r.old)} | ${pad(r.new)} | ${r.type === ' ' ? ' ' : r.type} | ${r.text}`);

test('D149: every hunk of the snapshot is in the ledger once, in the table of contents\' order, with its id, numbers, rows and changed lines', () => {
  const { snapshot } = scenario(mods);
  const ledger = hunkLedger(snapshot);
  assert.deepEqual(ledger.map((e) => [e.path, e.at ?? null, e.closed ?? null]), [
    ['assets/logo.png', null, 'binary'], ['src/a.js', 0, null], ['src/b.js', 0, null], ['src/b.js', 1, null],
    ['src/bad.js', null, 'unreadable'], ['src/huge.js', 0, null], ['src/m.js', 0, null]]);
  for (const e of ledger) assert.match(e.id, ID);
  assert.equal(new Set(ledger.map((e) => e.id)).size, ledger.length, 'no two entries share an id');
  // Each hunk entry is its snapshot hunk: the same numbers, its rows counted, its changed lines by side.
  for (const e of hunksOf(ledger)) {
    const f = snapshot.find((x) => x.path === e.path);
    const h = f.hunks[e.at];
    assert.deepEqual([e.side, e.old, e.new, e.rows], ['new', [h.oldStart, h.oldCount], [h.newStart, h.newCount],
      h.rows.length]);
    assert.equal(e.added, h.rows.filter((r) => r.type === '+').length);
    assert.equal(e.removed, h.rows.filter((r) => r.type === '-').length);
    assert.deepEqual(e.changed, changedSpans([h]));
    assert.equal(e.id, hunkId({ path: e.path, side: e.side, ...h }));
  }
  const b = ledger.filter((e) => e.path === 'src/b.js');
  assert.deepEqual(b.map((e) => [e.added, e.removed, e.changed]), [[1, 1, { new: [[5, 5]], old: [[5, 5]] }],
    [1, 1, { new: [[40, 40]], old: [[40, 40]] }]]);
  assert.deepEqual(ledger.find((e) => e.path === 'src/huge.js').changed, { new: [[1, 11_000]], old: [] });
});

test('D149: the same snapshot gives the same ledger, whatever the order of its files and whatever else the change holds', () => {
  const { snapshot } = scenario(mods);
  const ledger = hunkLedger(snapshot);
  assert.deepEqual(hunkLedger(snapshot), ledger);
  assert.deepEqual(hunkLedger([...snapshot].reverse()), ledger, 'the table of contents\' order, not the snapshot\'s');
  // A file more, or a file fewer, moves no other id.
  const fewer = hunkLedger(snapshot.filter((f) => f.path !== 'src/m.js'));
  assert.deepEqual(fewer, ledger.filter((e) => e.path !== 'src/m.js'));
  const more = hunkLedger([...snapshot, { ...snapshot.find((f) => f.path === 'src/a.js'), path: 'src/z.js' }]);
  assert.deepEqual(more.filter((e) => e.path !== 'src/z.js'), ledger);
  assert.notEqual(more.find((e) => e.path === 'src/z.js').id, ledger.find((e) => e.path === 'src/a.js').id,
    'the same rows in another file are another hunk');
});

test('D149: a hunk\'s id is over its path, side, @@ numbers and header, and its rows\' types and texts, and nothing else', () => {
  const h = { oldStart: 2, oldCount: 3, newStart: 2, newCount: 3, header: 'function f()', rows: [
    { type: ' ', text: 'a', old: 2, new: 2 }, { type: '-', text: 'b', old: 3, new: null },
    { type: '+', text: 'B', old: null, new: 3 }, { type: ' ', text: 'c', old: 4, new: 4 }] };
  const id = hunkId({ path: 'src/x.js', side: 'new', ...h });
  assert.match(id, ID);
  assert.equal(hunkId({ path: 'src/x.js', side: 'new', ...h }), id);
  const moved = [
    { path: 'src/y.js' }, { side: 'old' }, { oldStart: 1 }, { oldCount: 4 }, { newStart: 3 }, { newCount: 2 },
    { header: '' }, { rows: h.rows.slice(1) }, { rows: h.rows.map((r) => (r.type === '+' ? { ...r, text: 'C' } : r)) },
    { rows: h.rows.map((r) => (r.type === '-' ? { ...r, type: '+' } : r)) }];
  for (const over of moved) assert.notEqual(hunkId({ path: 'src/x.js', side: 'new', ...h, ...over }), id,
    JSON.stringify(over));
  // A row's own numbers are the @@ line's: they are not read again, and no other field of the hunk is.
  assert.equal(hunkId({ path: 'src/x.js', side: 'new', ...h, rows: h.rows.map((r) => ({ ...r, old: 0, new: 0 })),
    whole: true, lastOld: 9 }), id);
  // A file whose hunks cannot be shown: its path and side alone.
  assert.equal(hunkId({ path: 'src/x.js', side: 'new' }), hunkId({ path: 'src/x.js', side: 'new', rows: [] }));
  assert.notEqual(hunkId({ path: 'src/x.js', side: 'new' }), hunkId({ path: 'src/x.js', side: 'old' }));
});

test('D149: a file whose hunks cannot be shown keeps its closed state, and a recorded write outside the change block its own', () => {
  const head = { state: 'readable', text: 'x\n', sha256: '0'.repeat(64), bytes: 2, lines: 2 };
  const files = [
    { path: 'a.bin', changed: true, recorded: true, state: 'binary', type: 'added', diff: 'withheld', base: null, hunks: [] },
    { path: 'b.js', changed: true, recorded: true, ...head, type: 'modified', diff: 'unreadable', base: null, hunks: [] },
    { path: 'c.js', changed: true, recorded: true, ...head, type: 'modified', diff: 'withheld', base: null, hunks: [] },
    { path: 'd.js', changed: true, recorded: true, state: 'oversize', type: 'added', diff: 'withheld', base: null, hunks: [] },
    { path: 'e.js', changed: true, recorded: true, state: 'changed_since_session', type: 'modified', diff: 'withheld',
      base: null, hunks: [] },
    { path: 'f.js', changed: true, recorded: true, state: 'unreadable', type: 'modified', diff: 'withheld', base: null,
      hunks: [] },
    // Recorded writes the change block does not hold: in a folder the review can read, closed by their state; a scratch
    // write outside every such folder is no file of the change.
    { path: '/elsewhere/g.js', changed: true, recorded: true, state: 'other_repository' },
    { path: '/repo/h.js', changed: true, recorded: true, state: 'outside_root', inRepository: true },
    { path: 'sub/i.js', changed: true, recorded: true, state: 'outside_writer_root' },
    { path: '/tmp/scratch.txt', changed: true, recorded: true, state: 'outside_root' },
  ];
  const ledger = hunkLedger(files);
  assert.deepEqual(ledger.map((e) => [e.path, e.side, e.closed]), [['a.bin', 'new', 'binary'],
    ['b.js', 'new', 'unreadable'], ['c.js', 'new', 'oversize'], ['d.js', 'new', 'oversize'],
    ['e.js', 'new', 'changed_since_session'], ['f.js', 'new', 'unreadable'], ['/elsewhere/g.js', 'new', 'other_repository'],
    ['/repo/h.js', 'new', 'outside_root'], ['sub/i.js', 'new', 'outside_writer_root']]);
  for (const e of ledger) {
    assert.ok(CODE_FILE_STATES.includes(e.closed), e.closed);
    assert.deepEqual(Object.keys(e).sort(), ['closed', 'id', 'path', 'side'], 'no numbers, rows or lines: none is held');
    assert.equal(e.id, hunkId({ path: e.path, side: e.side }));
  }
  // D117: a file of another place names it.
  assert.equal(hunkLedger([{ ...files[0], place: '/work/other' }])[0].place, '/work/other');
});

test('D149: a deleted file\'s hunk is on the earlier side; a recorded edit\'s hunks are told apart by their place, a whole-file write by the lines it wrote', () => {
  const base = 'one\ntwo\n';
  const deleted = [{ path: 'gone.js', changed: true, recorded: true, state: 'deleted', type: 'deleted', diff: 'recorded',
    base: { text: base }, hunks: [{ oldStart: 1, oldCount: 2, newStart: 0, newCount: 0, header: '', rows: [
      { type: '-', text: 'one', old: 1, new: null }, { type: '-', text: 'two', old: 2, new: null }] }] }];
  const [gone] = hunkLedger(deleted);
  assert.deepEqual([gone.side, gone.added, gone.removed, gone.changed], ['old', 0, 2, { new: [], old: [[1, 2]] }]);
  // No git base: the change is the recorded edits. Two edits that wrote the same text where the file holds it twice
  // (not located), and a whole-file write: each its own id, by its place in the recording.
  const head = 'a\nb\na\nb\n';
  const hunks = recordedHunks([{ before: ['x'], after: ['a\nb'] }, { before: ['x'], after: ['a\nb'] },
    { whole: true, after: [head] }], head);
  const file = { path: 'r.js', changed: true, recorded: true, state: 'readable', text: head, type: 'modified',
    diff: 'base_unknown', base: null, hunks };
  const ledger = hunkLedger([file]);
  assert.equal(ledger.length, 3);
  assert.equal(new Set(ledger.map((e) => e.id)).size, 3);
  assert.deepEqual(ledger.map((e) => [e.old[0], e.new[0], e.whole ?? false, e.rows]), [[null, null, false, 3],
    [null, null, false, 3], [null, 1, true, 0]]);
  assert.deepEqual(ledger[2].changed, { new: [[1, 4]], old: [] }, 'a whole-file write changed every line it wrote');
});

test('D149: the record keeps the ledger, each hunk with the requests that showed its rows, else why the review request left it out', async () => {
  const seen = [];
  const { codePass } = await runScenario(mods, { wholeFiles: false, seen });
  const { snapshot } = scenario(mods);
  const ledger = hunkLedger(snapshot);
  const record = codePass.manifest.hunks;
  assert.deepEqual(record.map(({ shownIn: _s, closed: _c, ...e }) => e),
    ledger.map(({ closed: _c, ...e }) => e), 'the ledger, entry for entry');
  assert.deepEqual(record.map((e) => [e.path, e.shownIn, e.closed ?? null]), [
    ['assets/logo.png', [], 'binary'], ['src/a.js', ['code-review:agent'], null], ['src/b.js', ['code-review:agent'], null],
    ['src/b.js', ['code-review:agent'], null], ['src/bad.js', [], 'unreadable'], ['src/huge.js', [], 'block_cap'],
    ['src/m.js', ['code-review:agent'], null]]);
  // Invariant: every hunk a request is said to show has every row literally in that request's prompt; one it does not
  // show has no section there.
  const review = seen.find((r) => r.label === 'code-review:agent');
  for (const e of hunksOf(record)) {
    const h = snapshot.find((f) => f.path === e.path).hunks[e.at];
    const section = review.prompt.includes(`diff --git a/${e.path} b/${e.path}\n`);
    if (e.shownIn.length) assert.ok(rowLines(h).every((line) => review.prompt.includes(`\n${line}\n`)), e.path);
    else assert.equal(section, false, e.path);
  }
  // A review request bound that leaves a file out for room: its hunk is closed by it.
  const tight = await runScenario(mods, { wholeFiles: false, bound: 34_056 });
  assert.deepEqual(tight.codePass.manifest.hunks.filter((e) => e.path === 'src/m.js').map((e) => [e.shownIn, e.closed]),
    [[[], 'request_bound']]);
});

test('D149: a hunk the review showed and its repair left out names the review alone; every hunk not shown has one closed reason', async () => {
  // The repair of an answer Sonah could not use (`{}`), and the repair of an answer whose finding failed its checks.
  const malformed = { findings: [{ kind: 'bug' }], questions: [] };
  for (const [wholeFiles, bound, first] of [[false, 39_056, {}], [true, 43_048, {}], [false, 39_056, malformed]]) {
    const seen = [];
    const { codePass } = await runScenario(mods, { wholeFiles, bound, first, seen });
    assert.deepEqual(seen.map((r) => r.label), ['code-review:agent', 'code-review:repair', 'code-account:1']);
    const record = codePass.manifest.hunks;
    const repairShown = new Set(codePass.manifest.repair.files.filter((e) => ['whole', 'hunks_only'].includes(e.state)
      && seen[1].prompt.includes(`diff --git a/${e.path} b/${e.path}\n`)).map((e) => e.path));
    for (const e of hunksOf(record)) {
      assert.equal(e.shownIn.includes('code-review:repair'), repairShown.has(e.path), `${wholeFiles} ${e.path}`);
      if (!e.shownIn.length) assert.ok(CODE_LEFT_OUT_REASONS.includes(e.closed), e.path);
      else assert.equal(e.closed, undefined);
    }
    for (const e of record.filter((x) => !Number.isSafeInteger(x.at))) {
      assert.ok(CODE_FILE_STATES.includes(e.closed));
      assert.deepEqual(e.shownIn, []);
    }
    // Part A: the repair left the largest file out for its note, so that file's hunks name the review alone. Part B: the
    // whole files gave way to the note first, and every hunk the review showed the repair showed too.
    const lost = hunksOf(record).filter((e) => e.shownIn.length === 1);
    assert.deepEqual(lost.map((e) => [e.path, e.shownIn]), wholeFiles ? [] : [['src/m.js', ['code-review:agent']]]);
  }
});

test('D149: part B\'s whole file shows an added file\'s change, never a modified file\'s whose removed rows no request shows', async () => {
  // r.js and p.js added, q.js modified in every line. The change block's cap holds r.js's hunks; p.js's hunks alone
  // and q.js's alone are over it, so the change is today's one unit (D149: two files that fit apart are two units,
  // d149-unit-requests.test.js); part B shows p.js and q.js whole, as they are now (D106). p.js's change is every line
  // of it, all shown; q.js's removed rows are in no request.
  const files = { 'src/r.js': linesOf('rr', 300), 'src/p.js': linesOf('pp', 9_800, 20), 'src/q.js': linesOf('QQ', 6_500,
    10) };
  const before = linesOf('qq', 6_500, 10);
  const modified = { 'src/q.js': { before, patch: replacedPatch('src/q.js', before, files['src/q.js']) } };
  const seen = [];
  assert.equal(planReviewUnits(scenario(mods, { files, modified }).snapshot).today, true);
  const { codePass } = await runScenario(mods, { wholeFiles: true, files, modified, seen });
  const entry = (path) => codePass.manifest.review.files.find((e) => e.path === path);
  assert.deepEqual(['src/p.js', 'src/q.js', 'src/r.js'].map((path) => [path, entry(path).state, entry(path).beforeUnshown]),
    [['src/p.js', 'whole', 0], ['src/q.js', 'whole', 6_500], ['src/r.js', 'whole', 0]]);
  for (const [path, inChange] of [['src/p.js', false], ['src/q.js', false], ['src/r.js', true]])
    assert.equal(seen[0].prompt.includes(`diff --git a/${path} b/${path}\n`), inChange, path);
  assert.deepEqual(codePass.manifest.hunks.map((e) => [e.path, e.shownIn, e.closed ?? null]),
    [['src/p.js', ['code-review:agent'], null], ['src/q.js', [], 'block_cap'], ['src/r.js', ['code-review:agent'], null]]);
  // As D105's coverage says: p.js's change seen, q.js's not.
  const seenOf = new Map(codeSeenOf(codePass).files.map((f) => [f.path, f.changeSeen]));
  assert.deepEqual([seenOf.get('src/p.js'), seenOf.get('src/q.js'), seenOf.get('src/r.js')], [true, false, true]);
  // Every line of p.js is literally in the request, each after its number.
  const lines = files['src/p.js'].split('\n').slice(0, -1);
  assert.ok(lines.every((line, at) => seen[0].prompt.includes(`\n${String(at + 1).padStart(6, ' ')}\t${line}\n`)));
  assert.deepEqual(codePass.files.map((f) => [f.path, f.added, f.removed]), [['src/r.js', 300, 0],
    ['src/p.js', 9_800, 0], ['src/q.js', 6_500, 6_500]]);
});

test('D149: with no git base the record keeps no added or removed lines (the recording\'s own lines say them), the ledger every recorded edit', async () => {
  const session = fixture.codeSession();
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(fixture.CODE_FILES, entry.path)
    ? { path: entry.path, bytes: new TextEncoder().encode(fixture.CODE_FILES[entry.path]) }
    : { path: entry.path, state: 'deleted' })), { base: { kind: 'recorded_edits' } });
  const { codePass } = await runCodePass({ report: { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only',
    findings: [], pivots: [], failures: [], promises: [], writtenClaims: [], decisions: [], requirements: [] }, session,
  snapshot, repo: fixture.memoryRepo(), judge: async () => ({ findings: [], questions: [] }), base: { kind: 'recorded_edits' },
  root: '/repo' });
  const parse = codePass.files.find((f) => f.path === 'src/parse.js');
  assert.deepEqual([parse.state, parse.added, parse.removed], ['shown', undefined, undefined]);
  const hunks = codePass.manifest.hunks.filter((e) => e.path === 'src/parse.js');
  assert.deepEqual(hunks.map((e) => [e.at, e.old[0], e.shownIn]), snapshot.find((f) => f.path === 'src/parse.js').hunks
    .map((h, at) => [at, null, ['code-review:agent']]));
});

test('D149: a review request too large to send shows no hunk: each keeps why; with no review request there is no ledger in the record', async () => {
  const { codePass } = await runScenario(mods, { wholeFiles: false, bound: 1_000 });
  assert.equal(codePass.manifest.review.sent, false);
  assert.ok(codePass.manifest.hunks.every((e) => e.shownIn.length === 0));
  assert.deepEqual(codePass.manifest.hunks.map((e) => [e.path, e.closed]), [['assets/logo.png', 'binary'],
    ['src/a.js', 'request_bound'], ['src/b.js', 'request_bound'], ['src/b.js', 'request_bound'],
    ['src/bad.js', 'unreadable'], ['src/huge.js', 'block_cap'], ['src/m.js', 'request_bound']]);
  // The code step off (no review request planned): no manifest, so no ledger.
  const f = scenario(mods);
  const off = await runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot, repo: f.repo,
    judge: async () => { throw new Error('no call'); }, ran: false });
  assert.equal(off.codePass.manifest, undefined);
});

test('D149: every file whose hunks from the start commit Sonah holds keeps its added and removed lines, shown or not', async () => {
  for (const bound of [Infinity, 34_056, 1_000]) {
    const { codePass } = await runScenario(mods, { wholeFiles: false, bound });
    const byPath = new Map(codePass.files.map((f) => [f.path, f]));
    for (const path of ['src/a.js', 'src/b.js', 'src/m.js', 'src/huge.js']) {
      const lines = codePass.manifest.hunks.filter((e) => e.path === path);
      assert.deepEqual([byPath.get(path).added, byPath.get(path).removed], [lines.reduce((n, e) => n + e.added, 0),
        lines.reduce((n, e) => n + e.removed, 0)], `${bound} ${path}`);
    }
    assert.deepEqual([byPath.get('src/m.js').added, byPath.get('src/huge.js').added], [400, 11_000]);
    // A file whose hunks cannot be shown holds no line Sonah can count.
    for (const path of ['assets/logo.png', 'src/bad.js']) assert.deepEqual([byPath.get(path).added,
      byPath.get(path).removed], [undefined, undefined]);
  }
  assert.equal((await runScenario(mods, { wholeFiles: false, bound: 34_056 })).codePass.files
    .find((f) => f.path === 'src/m.js').state, 'left_out');
  assert.equal((await runScenario(mods, { wholeFiles: false })).codePass.files
    .find((f) => f.path === 'src/huge.js').state, 'oversize');
});

test('D149: the ledger only records: every request is byte for byte the one before D149 (golden digests)', async () => {
  // The digests of every request each run sends (its label, brief and prompt), computed with the code before D149.
  for (const [options, digest] of GOLDEN_REQUESTS) {
    const seen = [];
    await runScenario(mods, { ...options, seen });
    assert.equal(digestOf(seen), digest, JSON.stringify(options));
  }
});

test('D149: the fixture\'s files take every path through the change block', () => {
  // Guard on the fixture itself: a change here would let the tests above pass on less.
  const { snapshot } = scenario(mods);
  assert.deepEqual(snapshot.map((f) => [f.path, f.state, f.diff, f.hunks.length]), [
    ['src/a.js', 'readable', 'recorded', 1], ['src/b.js', 'readable', 'recorded', 2], ['src/m.js', 'readable', 'recorded', 1],
    ['src/huge.js', 'readable', 'recorded', 1], ['assets/logo.png', 'binary', 'withheld', 0],
    ['src/bad.js', 'readable', 'unreadable', 0]]);
  assert.equal(Object.keys(FILES).length, snapshot.length);
});
