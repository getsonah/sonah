// D109 (the truth check of paid reports, 2026-10-17): every count of the code review's coverage lines comes from one
// tally of the request manifest and the reading records (code-pass.js `codeChangeTally`), and the parts sum to the
// whole. A file whose change is the whole file and that the request showed only in part is seen in part, with its lines.
// A recorded write outside the change block is classed by where it lies, named, and counted among the files the code
// review did not see when it did not see it. Hunks left out for room are said so, never "too large". With a git base,
// the change says when it holds files no recorded edit of the session wrote. The open questions' checks are said as the
// records show them. The gap `code_unreviewable` is the tally's.
//
// Synthetic manifests, reading records and snapshots, an in-memory repository and deterministic fake agents: no
// recording, no model, no network. Each invariant is a test that fails on a mutant of its rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CODE_FILE_STATES } from '../src/ledger.js';
import { codeChangeTally, codeSeenOf, freezeCodeSnapshot, runCodePass, CODE_TALLY_GROUPS, AGENT_RUN_FIELD }
  from '../src/code-pass.js';
import { CODE_REPORT_WORDS as W, codeCoverageLines, codeFooterLines, codeSeenLines, codeUnseenFiles, codeBaseLine,
  codeQuestionsLine } from '../src/code-report.js';
import { buildCodeSession, accountsHoldWith, changeReceipt, fileReceipt } from '../../cli/test/code-pass-fixture.js';

// ---- the property: one tally, the parts summing to the whole --------------------------------------------------------

/** A seeded generator (a linear congruential one): the same seed, the same cases. */
function generator(seed) {
  let state = seed >>> 0;
  const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = (values) => values[int(0, values.length - 1)];
  return { next, int, pick };
}
const NOT_SHOWN_REASONS = CODE_FILE_STATES.filter((s) => !['shown', 'left_out'].includes(s));

/** A manifest of `n` files in every state the request records, and the review's reading record over some of them. */
function generated(seed) {
  const g = generator(seed);
  const n = g.int(1, 14);
  const ranges = (total) => {
    const out = [];
    let at = g.int(1, Math.max(1, Math.floor(total / 2)));
    while (at <= total && out.length < 3) {
      const end = Math.min(total, at + g.int(0, 6));
      out.push([at, end]);
      at = end + g.int(2, 8);
    }
    return out;
  };
  const files = Array.from({ length: n }, (_, i) => {
    const path = `src/f${String(i).padStart(2, '0')}.js`;
    const total = g.int(1, 60);
    const recorded = g.next() < 0.5;
    switch (g.pick(['whole', 'hunks', 'hunksWhole', 'unplaced', 'leftOut', 'notShown', 'old'])) {
      case 'whole': return { path, state: 'whole', side: 'new', shown: [[1, total]], beforeUnshown: g.pick([0, 3]),
        lines: total, recorded };
      case 'hunks': return { path, state: 'hunks_only', side: 'new', shown: ranges(total), beforeUnshown: 0,
        lines: total, recorded };
      case 'hunksWhole': return { path, state: 'hunks_only', side: 'new', shown: g.next() < 0.3 ? [] : ranges(total),
        change: [[1, total]], beforeUnshown: 0, lines: total, recorded };
      case 'unplaced': return { path, state: 'hunks_only', side: 'new', shown: g.next() < 0.5 ? [] : ranges(total),
        unplaced: true, beforeUnshown: 0, lines: total, recorded };
      case 'leftOut': return { path, state: 'left_out', reason: g.pick(['block_cap', 'request_bound']), side: 'new',
        shown: [], change: ranges(total), beforeUnshown: g.pick([0, 4]), lines: total, recorded };
      case 'notShown': return { path, state: 'not_shown', reason: g.pick(NOT_SHOWN_REASONS), side: 'new', shown: [],
        beforeUnshown: g.pick([0, null]), lines: g.pick([total, null]), recorded };
      default: return { path, state: 'hunks_only', side: 'old', shown: ranges(total), lines: total, recorded };
    }
  });
  const reads = [], unranged = [];
  for (const f of files) {
    if (f.lines === null) continue;
    const r = g.next();
    if (r < 0.25) reads.push({ path: f.path, ranges: [[1, f.lines]], lines: f.lines });
    else if (r < 0.45) reads.push({ path: f.path, ranges: ranges(f.lines), lines: f.lines });
    else if (r < 0.55) unranged.push(f.path);
  }
  const sent = g.next() < 0.9;
  return { ran: true, coverage: 'partial', withheld: [], files: [], footer: [],
    manifest: { review: { sent, files, rules: [], commands: { count: 0, from: 1, inPart: [] }, texts: [] } },
    agents: [{ label: 'code-review:agent', run: { turns: 1, tools: { Read: 1, Grep: 0, Glob: 0 }, reads, unranged: 0,
      unrangedPaths: unranged, failed: [] } }] };
}

/** The numbers the coverage line says: the files the change covers, and each group's count, in its order. */
function coverageNumbers(line) {
  const total = Number(/^The change covers (\d+) files?\./.exec(line)?.[1]);
  if (/The code review did not see any of them\.$/.test(line)) return { total, parts: [total], unseen: total };
  const parts = [...line.matchAll(/(?:The code review saw (\d+) of them|It saw (\d+)|It did not see (\d+))/g)]
    .map((m) => Number(m[1] ?? m[2] ?? m[3]));
  const unseen = Number(/It did not see (\d+)\./.exec(line)?.[1] ?? 0);
  return { total, parts, unseen };
}
const countOf = (line) => Number(/^(\d+) /.exec(line)?.[1]);

test('D109: over generated manifests and reading records, every count of the coverage lines is the one tally\'s, and the '
  + 'parts sum to the whole', () => {
  let cases = 0, sent = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const pass = generated(seed);
    const tally = codeChangeTally(pass);
    // Each file of the manifest in exactly one group.
    assert.equal(tally.total, pass.manifest.review.files.length, `seed ${seed}`);
    assert.equal(CODE_TALLY_GROUPS.reduce((n, group) => n + tally.groups[group].length, 0), tally.total, `seed ${seed}`);
    assert.deepEqual(new Set(tally.units.map((u) => u.path)).size, tally.total, `seed ${seed}`);
    // The header's count is the tally's files not seen.
    assert.equal(codeUnseenFiles(pass), tally.groups.not_seen.length, `seed ${seed}`);
    cases++;
    if (tally.sent !== true) {
      assert.deepEqual(codeCoverageLines(pass), [W.tooLarge(tally.total)], `seed ${seed}`);
      assert.equal(tally.groups.not_seen.length, tally.total, `seed ${seed}`);
      continue;
    }
    sent++;
    // The coverage line: its parts sum to the files the change covers, and the files it did not see are the header's.
    const numbers = coverageNumbers(codeCoverageLines(pass)[0]);
    assert.equal(numbers.total, tally.total, `seed ${seed}`);
    assert.equal(numbers.parts.reduce((a, b) => a + b, 0), numbers.total, `seed ${seed}: ${codeCoverageLines(pass)[0]}`);
    assert.equal(numbers.unseen, codeUnseenFiles(pass), `seed ${seed}`);
    // The footer: the files not seen, each named once, under `clipped` (left out for room) or `withheld`; the states in
    // a withheld line sum to its count; each line of what it saw short of whole counts its group.
    const lines = codeFooterLines({ codePass: pass });
    const clipped = lines.filter((l) => l.includes('left out of the code review\'s input for room'));
    const withheld = lines.filter((l) => l.includes('whose change the code review did not see'));
    assert.equal([...clipped, ...withheld].reduce((n, l) => n + countOf(l), 0), tally.groups.not_seen.length,
      `seed ${seed}: ${lines.join(' | ')}`);
    for (const line of withheld) {
      const states = /\(([^)]*)\)/.exec(line)?.[1] ?? '';
      assert.equal(states.split(', ').reduce((n, part) => n + countOf(part), 0), countOf(line), `seed ${seed}: ${line}`);
    }
    // A seen line by its words before the paths, singular or plural.
    const heads = (words) => [words(['P']), words(['P', 'Q'])].map((line) => line.slice(line.indexOf(' ') + 1,
      line.indexOf(':')));
    const linesOf = (words) => lines.filter((l) => heads(words).includes(l.slice(l.indexOf(' ') + 1, l.indexOf(':'))));
    for (const [group, words] of [['in_part', W.seenInPart], ['hunks_only', W.hunksOnly],
      ['whole_not_before', W.wholeNotBefore], ['lines_unknown', W.linesUnknown]])
      assert.equal(linesOf(words).reduce((n, l) => n + countOf(l), 0), tally.groups[group].length, `seed ${seed} ${group}`);
    // No path is named twice.
    for (const unit of tally.units) {
      const named = lines.filter((l) => l.includes(`${unit.path}`)).length;
      assert.ok(named <= 1, `seed ${seed}: ${unit.path} named ${named} times`);
    }
  }
  assert.ok(cases === 400 && sent > 300, `${sent} of ${cases} sent`);
});

test('D109: the coverage line of a recorded-edits review says each group once — a file deleted and not seen is counted '
  + 'once, and a file read in part whose change it did not see is one of those seen in part (the paid long run)', () => {
  // The shape of the paid report: 8 seen whole, 3 seen in part (one whose change it did not see), 11 only where the
  // change touched them, 33 not seen (one of them not there any more).
  const unit = (path, state, extra = {}) => ({ path, side: 'new', beforeUnshown: 0, lines: 100, recorded: true, state,
    ...extra });
  const files = [
    ...Array.from({ length: 8 }, (_, i) => unit(`w${i}.md`, 'hunks_only', { shown: [[1, 10]] })),
    unit('p0.md', 'hunks_only', { shown: [] }), unit('p1.md', 'hunks_only', { shown: [[10, 20]] }),
    unit('p2.md', 'hunks_only', { shown: [[30, 40]] }),
    ...Array.from({ length: 11 }, (_, i) => unit(`h${String(i).padStart(2, '0')}.md`, 'hunks_only', { shown: [[5, 6]] })),
    unit('${S}.txt', 'not_shown', { reason: 'deleted', shown: [], beforeUnshown: null, lines: null }),
    ...Array.from({ length: 32 }, (_, i) => unit(`n${String(i).padStart(2, '0')}.md`, 'hunks_only', { shown: [],
      change: [[1, 100]] })),
  ];
  const reads = [...Array.from({ length: 8 }, (_, i) => ({ path: `w${i}.md`, ranges: [[1, 100]], lines: 100 })),
    { path: 'p0.md', ranges: [[50, 100]], lines: 100 }, { path: 'p1.md', ranges: [[1, 30]], lines: 100 },
    { path: 'p2.md', ranges: [[25, 50]], lines: 100 }];
  const pass = { ran: true, coverage: 'partial', withheld: [], files: [{ path: '${S}.txt', state: 'deleted' }],
    footer: [], manifest: { review: { sent: true, files, rules: [], commands: { count: 0, from: 1, inPart: [] },
      texts: [] } }, agents: [{ label: 'code-review:agent', run: { reads, unrangedPaths: [], failed: [] } }] };
  assert.equal(codeSeenOf(pass).files.find((x) => x.path === 'p0.md').changeSeen, false);
  assert.deepEqual(codeCoverageLines(pass), ['The change covers 55 files. The code review saw 8 of them whole. It saw 3 in '
    + 'part. It saw 11 only where the change touched them. It did not see 33.', W.coverage.partial]);
  assert.equal(codeUnseenFiles(pass), 33);
  const withheld = codeFooterLines({ codePass: pass }).find((l) => l.includes('did not see'));
  assert.ok(withheld.startsWith(`33 files whose change the code review did not see (${'1 not there any more'}, 32 `
    + `${W.unseenShown}): `), withheld);
});

// ---- the record: a whole-file change, rows that cannot be placed, states and gaps from the manifest -----------------

const ROOT = '/work/repo';
const enc = (text) => new TextEncoder().encode(text);
const ASK = 'SYNTHETIC_ASK: write the docs and the module.';

/** A recorded-edits plan entry: its path's edits as the slicer records them (code-pass.js `codeSnapshotPlan`). */
const planEntry = (path, edits, extra = {}) => ({ path, recordedPath: path, changed: true, recorded: true,
  outside: false, last: { deleted: false, spans: [] }, edits, ...extra });
const wholeWrite = (text) => ({ before: [], after: [text], whole: true, placed: null });
const edit = (before, after) => ({ before: [before], after: [after], whole: false, placed: null });

/** The session, the snapshot from `plan` and the files now (`now`, path -> text; a path absent is not there, or its
 *  `states` entry gives a CLI state), and a report with one ask. */
function recordedFixture(plan, now, states = {}) {
  const session = buildCodeSession('sess-d109', { ask: ASK }, [{ id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' }]);
  const reads = plan.map((entry) => (states[entry.path] ? { path: entry.path, state: states[entry.path] }
    : Object.hasOwn(now, entry.path) ? { path: entry.path, bytes: enc(now[entry.path]) }
      : { path: entry.path, state: 'deleted' }));
  const snapshot = freezeCodeSnapshot(plan, reads, { base: { kind: 'recorded_edits' } });
  const repo = { root: ROOT, top: ROOT, read: (path) => (Object.hasOwn(now, path) ? { path, text: now[path] } : null),
    base: () => null };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Write them.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report, now };
}
/** F3b (D111): an accounting agent's request answers the fixture's one ask as holding, quoting the first line that the
 *  change shows, else the first line of a file of the change as it is now (code-pass-fixture.js `changeReceipt`,
 *  `fileReceipt`), so each record here is the review's alone; every other request goes to `judge`. */
const withAccount = (f, judge) => async (request) => (/^code-account:\d+(:reask)?$/.test(request.label ?? '')
  ? accountsHoldWith(changeReceipt(request.prompt) ?? fileReceipt(request.prompt, f.now))(request.prompt)
  : judge(request));
/** The review agent answers nothing, with this reading record (`reads`: [path, from, through, total]). */
const reviewer = (reads = [], unranged = []) => async (request) => {
  const answer = { findings: [], questions: [] };
  Object.defineProperty(answer, AGENT_RUN_FIELD, { enumerable: false, value: { numTurns: 1, toolCalls: { Read: reads.length },
    reads: reads.map(([p]) => `${ROOT}/${p}`), readRanges: reads.map(([p, from, through, total]) => ({ path: `${ROOT}/${p}`,
      startLine: from, numLines: through - from + 1, totalLines: total })), readsUnranged: unranged.length,
    readsUnrangedPaths: unranged.map((p) => `${ROOT}/${p}`), readsFailed: [] } });
  if (request.label === 'code-review:agent') return answer;
  throw new Error(`unexpected request ${request.label}`);
};
const runOn = (f, judge, more = {}) => runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot,
  repo: f.repo, judge: withAccount(f, judge), root: ROOT, base: { kind: 'recorded_edits' }, wholeFiles: false, ...more });

const DOC = 'intro\nnew middle\nend\n';

test('D109: a file whose change is the whole file — written whole by a recorded edit — and that the request showed only '
  + 'where a later edit touched it is seen in part, with its lines; never "only where the change touched it"', async () => {
  // docs/a.md: written whole (its text since changed, so the write cannot be placed), then one line edited (placed).
  const f = recordedFixture([planEntry('docs/a.md', [wholeWrite('intro\nold middle\nend\n'),
    edit('old middle', 'new middle')])], { 'docs/a.md': DOC });
  const { codePass } = await runOn(f, reviewer());
  const entry = codePass.manifest.review.files.find((x) => x.path === 'docs/a.md');
  assert.deepEqual([entry.state, entry.shown, entry.change, entry.lines], ['hunks_only', [[2, 2]], [[1, 3]], 3]);
  assert.deepEqual(codeSeenOf(codePass).files.map((x) => [x.path, x.state, x.lines, x.changeSeen]),
    [['docs/a.md', 'in_part', [[2, 2]], false]]);
  assert.deepEqual(codeSeenLines(codePass), [W.seenInPart(['docs/a.md (line 2 of 3)'])]);
  assert.equal(codePass.coverage, 'partial');
  // Read whole by the review: seen whole, its change seen.
  const read = await runOn(f, reviewer([['docs/a.md', 1, 3, 3]]));
  assert.deepEqual(codeSeenOf(read.codePass).files.map((x) => [x.state, x.changeSeen]), [['whole', true]]);
  // A file whose change is only its edits (no whole write) shown by them is seen only where the change touched it.
  const edits = recordedFixture([planEntry('src/m.js', [edit('old middle', 'new middle')])], { 'src/m.js': DOC });
  const only = await runOn(edits, reviewer());
  assert.equal(only.codePass.manifest.review.files[0].change, undefined);
  assert.deepEqual(codeSeenLines(only.codePass), [W.hunksOnly(['src/m.js'])]);
});

test('D109: rows of a recorded edit that Sonah could not place in the file now were shown to the review: such a file is '
  + 'seen in lines Sonah could not number, never a file whose change the review did not see', async () => {
  const f = recordedFixture([planEntry('src/x.js', [edit('gone line', 'line the file no longer holds')])],
    { 'src/x.js': 'alpha\nbeta\ngamma\n' });
  const { codePass } = await runOn(f, reviewer());
  const entry = codePass.manifest.review.files[0];
  assert.deepEqual([entry.state, entry.shown, entry.unplaced], ['hunks_only', [], true]);
  assert.deepEqual(codeSeenOf(codePass).files.map((x) => [x.state, x.changeSeen]), [['lines_unknown', true]]);
  assert.deepEqual(codePass.footer, []);
  assert.equal(codeUnseenFiles(codePass), 0);
  assert.deepEqual(codeSeenLines(codePass), [W.linesUnknown(['src/x.js'])]);
  assert.deepEqual(codeCoverageLines(codePass), [W.files(1, [['lines_unknown', 1]], 0)]);
});

test('D109: a recorded write the change block does not hold that lies in a folder the review can read — another '
  + 'repository, or the working directory outside the writing agent\'s — is a file of the change, named with its state '
  + 'and counted among the files the review did not see; one outside every such folder is only counted', async () => {
  const plan = [planEntry('src/m.js', [edit('old middle', 'new middle')]),
    planEntry('inner/gateway.py', [wholeWrite('x\n')], { outside: true }),
    planEntry('device/bridge/core.ts', [wholeWrite('y\n')], { outside: true }),
    planEntry('/tmp/scratch.sh', [wholeWrite('z\n')], { outside: true }),
    planEntry('../lib/sibling.js', [wholeWrite('w\n')], { outside: true })];
  const f = recordedFixture(plan, { 'src/m.js': DOC }, { 'inner/gateway.py': 'other_repository',
    'device/bridge/core.ts': 'outside_writer_root', '/tmp/scratch.sh': 'outside_root', '../lib/sibling.js': 'outside_root' });
  // The CLI says the sibling lies in the repository (`repository: true`).
  f.snapshot.find((x) => x.path === '../lib/sibling.js').inRepository = true;
  const { codePass } = await runOn(f, reviewer([['inner/gateway.py', 1, 1, 1]]));
  assert.deepEqual(codePass.files.map((x) => [x.path, x.state]), [['src/m.js', 'shown'],
    ['inner/gateway.py', 'other_repository'], ['device/bridge/core.ts', 'outside_writer_root'],
    ['/tmp/scratch.sh', 'outside_root'], ['../lib/sibling.js', 'outside_root']]);
  assert.deepEqual(codePass.manifest.review.files.map((x) => [x.path, x.state, x.reason ?? null]),
    [['src/m.js', 'hunks_only', null], ['inner/gateway.py', 'not_shown', 'other_repository'],
      ['device/bridge/core.ts', 'not_shown', 'outside_writer_root'], ['../lib/sibling.js', 'not_shown', 'outside_root']]);
  // The review read gateway.py whole: seen whole as it is now, not as it was (Sonah holds no earlier side of it).
  const tally = codeChangeTally(codePass);
  assert.deepEqual(Object.fromEntries(Object.entries(tally.groups).map(([g, u]) => [g, u.map((x) => x.path)])), {
    whole: [], whole_not_before: ['inner/gateway.py'], in_part: [], hunks_only: ['src/m.js'], lines_unknown: [],
    not_seen: ['device/bridge/core.ts', '../lib/sibling.js'] });
  assert.deepEqual(codeCoverageLines(codePass), [W.files(4, [['whole_not_before', 1], ['hunks_only', 1]], 2),
    W.coverage.partial]);
  assert.equal(codeUnseenFiles(codePass), 2);
  const lines = codeFooterLines({ codePass });
  assert.ok(lines.includes(W.footerKinds.withheld({ n: 2, states: [[W.states.outside_root, 1],
    [W.states.outside_writer_root, 1]], paths: ['device/bridge/core.ts', '../lib/sibling.js'] })), lines.join('\n'));
  assert.ok(lines.includes(W.wholeNotBefore(['inner/gateway.py'])));
  assert.ok(lines.includes(W.footerKinds.outside_root({ count: 1 })));
  // Not read: in another repository, named so, and counted.
  const unread = await runOn(f, reviewer());
  assert.equal(codeUnseenFiles(unread.codePass), 3);
  assert.ok(codeFooterLines({ codePass: unread.codePass }).some((l) => l.includes(`1 ${W.states.other_repository}`)
    && l.includes('inner/gateway.py')));
  // The gap is the tally's.
  assert.deepEqual(unread.codePass.gaps.find((g) => g.code === 'code_unreviewable').count, 3);
});

test('D109: the record\'s file states and the gap `code_unreviewable` are the manifest\'s tally — a file read whole is no '
  + 'unreviewable file, and hunks over the change block\'s cap on their own are `oversize`', async () => {
  // A file whose diff cannot be shown (a CLI state) read whole; a file whose hunk alone is over the change block's cap.
  const big = Array.from({ length: 12_000 }, (_, i) => `line ${String(i).padStart(6, '0')} ${'x'.repeat(30)}`).join('\n');
  // big.js: one edit that wrote all of its 12,000 lines, placed: its hunk is over the change block's cap.
  const plan = [planEntry('src/big.js', [edit('placeholder', big)]),
    planEntry('src/huge.bin', [wholeWrite('q\n')]), planEntry('src/m.js', [edit('old middle', 'new middle')])];
  const f = recordedFixture(plan, { 'src/big.js': `${big}\n`, 'src/m.js': DOC }, { 'src/huge.bin': 'oversize' });
  const { codePass } = await runOn(f, reviewer(), { bound: 1_620_000 });
  const states = Object.fromEntries(codePass.files.map((x) => [x.path, x.state]));
  const manifest = Object.fromEntries(codePass.manifest.review.files.map((x) => [x.path, [x.state, x.reason ?? null]]));
  assert.deepEqual(manifest['src/huge.bin'], ['not_shown', 'oversize']);
  assert.equal(states['src/huge.bin'], 'oversize', 'too large on its own');
  assert.deepEqual(manifest['src/big.js'], ['left_out', 'block_cap']);
  // D109 (its review): its hunk alone is over the change block's cap: too large on its own, never left out for room.
  assert.equal(codePass.manifest.review.files.find((x) => x.path === 'src/big.js').alone, true);
  assert.equal(states['src/big.js'], 'oversize', 'too large on its own');
  const gap = (pass) => pass.gaps.find((g) => g.code === 'code_unreviewable') ?? { count: 0, byState: {} };
  assert.equal(gap(codePass).count, codeUnseenFiles(codePass));
  assert.equal(gap(codePass).count, codeChangeTally(codePass).groups.not_seen.length);
  // Read whole, the oversize file is seen (whole, its earlier side not shown): no longer unreviewable, and no longer
  // counted by the header.
  const read = await runOn(f, reviewer([['src/huge.bin', 1, 1, 1]]), { bound: 1_620_000 });
  assert.equal(codeChangeTally(read.codePass).units.find((u) => u.path === 'src/huge.bin').group, 'whole_not_before');
  assert.equal(gap(read.codePass).count, gap(codePass).count - 1);
  assert.equal(gap(read.codePass).count, codeUnseenFiles(read.codePass));
});

// ---- the words: left out for room, where the change runs from, the questions' checks ---------------------------------

test('D109: hunks left out for room are said so, never "too large"; a file too large on its own is named by its state',
  () => {
    const pass = { ran: true, coverage: 'partial', withheld: [], files: [], footer: [],
      manifest: { review: { sent: true, files: [
        { path: 'a.js', state: 'left_out', reason: 'block_cap', side: 'new', shown: [], change: [[1, 2]], beforeUnshown: 0,
          lines: 9, recorded: true },
        { path: 'b.bin', state: 'not_shown', reason: 'oversize', side: 'new', shown: [], beforeUnshown: null, lines: null,
          recorded: true }], rules: [], commands: { count: 0, from: 1, inPart: [] }, texts: [] } }, agents: [] };
    const lines = codeFooterLines({ codePass: pass });
    assert.deepEqual(lines, [W.footerKinds.clipped({ paths: ['a.js'] }),
      W.footerKinds.withheld({ n: 1, states: [[W.states.oversize, 1]], paths: ['b.bin'] })]);
    assert.doesNotMatch(lines[0], /too large/);
    assert.equal(W.states.left_out, 'left out for room');
  });

test('D109: with a git base, the change says it can hold work done after the session when the manifest holds files no '
  + 'recorded edit wrote, and how many; the method never says the change is the session\'s', () => {
  const file = (path, recorded) => ({ path, state: 'whole', side: 'new', shown: [[1, 1]], beforeUnshown: 0, lines: 1,
    recorded });
  const passOf = (files, base = { kind: 'git', commit: 'c'.repeat(40) }) => ({ ran: true, base, coverage: 'complete',
    withheld: [], files: [], footer: [], manifest: { review: { sent: true, files, rules: [],
      commands: { count: 0, from: 1, inPart: [] }, texts: [] } }, agents: [] });
  const commit = 'c'.repeat(40);
  assert.equal(codeBaseLine(passOf([file('a', true), file('b', true)])), W.base(commit));
  assert.equal(codeBaseLine(passOf([file('a', true), file('b', false), file('c', false)])), W.base(commit, 2, 3));
  assert.match(W.base(commit, 2, 3), /So it can hold work done after the session\. Sonah found no recorded edit of the session that wrote 2 of its 3 files\.$/);
  assert.match(codeBaseLine(passOf([file('a', false)])), /wrote any of its 1 file\.$/);
  // A manifest written before D109 (no `recorded`) says nothing of it; with no git base, the change is the edits.
  assert.equal(codeBaseLine(passOf([{ ...file('a', true), recorded: undefined }])), W.base(commit));
  assert.equal(codeBaseLine(passOf([file('a', false)], { kind: 'recorded_edits' })), W.base(null));
  assert.doesNotMatch(W.how, /that the session made|checked each open question|each finding/);
});

test('D109: the open questions\' checks are said as the records show them — each one only when every published question '
  + 'carries a check', () => {
  const pass = (questions) => ({ ran: true, questions });
  const checked = { question: 'Q?', from: 'review', check: { verdict: 'sound', explanation: 'x' } };
  const unchecked = { question: 'R?', from: 'review' };
  const routed = { question: 'S?', from: 'finding', finding: {}, check: { verdict: 'refuted', reason: 'not_against_goal',
    explanation: 'y' } };
  assert.equal(codeQuestionsLine(pass([checked, routed])), W.questionsChecked(2, 2));
  assert.equal(codeQuestionsLine(pass([checked, routed])), 'With the same access, the same model checked each open '
    + 'question.');
  assert.equal(codeQuestionsLine(pass([checked, unchecked])), W.questionsChecked(1, 2));
  assert.match(codeQuestionsLine(pass([unchecked, unchecked, checked])), /checked 1 of the 3 open questions\. Sonah publishes the others unchecked\.$/);
  assert.equal(codeQuestionsLine(pass([])), null);
  assert.equal(codeQuestionsLine({ ran: false, questions: [checked] }), null);
});
