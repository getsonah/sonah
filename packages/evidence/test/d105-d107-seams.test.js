// The seams between D105 (one request, one bound, a manifest: what the code review was sent and what it read) and D107
// (the repair kept by identity, F3a), which were built apart in bucket B and joined after their reviews. Each test holds
// one place where the two meet, and fails if either side stops holding its part there:
//   1. A repaired item whose anchor lies in a file the request left out: D107 matches it by identity on the file as
//      Sonah reads it, never on what the request showed, so it takes the failing item's place one to one, is checked
//      and published; D105 places its receipts by what the review or its repair read, so they sit inside only when the
//      repair's own reading record read those lines.
//   2. The coverage words after a repair: the code review saw a file the request left out only when the review agent
//      or its repair read it, and the coverage, the files line and the seen lines say so from both records, whatever
//      the fates of the items.
//   3. A repair too large to send under D105's bound: no call, and D107 still gives every item of the answer one fate;
//      the failing one is withheld with D105's `too_large`, in D107's words.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, codeSeenOf, AGENT_RUN_FIELD } from '../src/code-pass.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS, codeCoverageLines, codeFooterLines, codeSeenLines, withheldWhy } from '../src/code-report.js';
import { buildCodeSession, holds, allSound, verifiedFinding, batchItems, fatesOf, accountsHold }
  from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const GIT = { kind: 'git', commit: 'b'.repeat(40), how: 'reflog' };
const ASK = 'SYNTHETIC_ASK: add the modules and run the tests.';
const RULES = 'SYNTHETIC_RULES: every module exports one function.';

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`
  .padEnd(width, '.')).join('\n') + '\n';
/** git's own patch of an added file. */
const addedPatch = (path, text) => {
  const rows = text.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n');
};

/** A session that writes `files` (path -> text, each added) and then runs `commands`, the project's rule file loaded;
 *  the snapshot of that change with a git base; an in-memory repository reader; and the session review's report. */
function fixture({ files, commands = [] }) {
  const blobs = { ask: ASK, rules: RULES, ok: 'ok' };
  const T1 = { turn: 'T1' };
  const region = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const command = (id, text) => {
    blobs[`cmd-${id}`] = text;
    return [{ id, kind: 'invocation', tool: 'Bash', operation: 'command', paths: [], input: [], changes: [],
      callKey: id, command: region(`cmd-${id}`), ...T1 },
    { id: `${id}-r`, kind: 'observation', invocation: id, blob: 'ok', ...T1 }];
  };
  const specs = [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...Object.entries(files).map(([path, text], at) => {
      blobs[`file-${at}`] = text;
      return { id: `W${at + 1}`, kind: 'invocation', write: path, blob: `file-${at}`, ...T1 };
    }),
    ...commands.flatMap((text, at) => command(`B${at + 1}`, text))];
  const session = buildCodeSession('sess-d105-d107', blobs, specs,
    { projectInstructions: [{ path: 'CLAUDE.md', blob: 'rules' }] });
  const plan = codeSnapshotPlan(session, { root: ROOT });
  const reads = plan.map((entry) => ({ path: entry.path, bytes: enc(files[entry.path]), type: 'added',
    patch: addedPatch(entry.path, files[entry.path]) }));
  const snapshot = freezeCodeSnapshot(plan, reads, { base: GIT });
  const now = { ...files, 'CLAUDE.md': RULES };
  const fileOf = (set, path) => {
    const named = String(path).replace(`${ROOT}/`, '');
    return Object.hasOwn(set, named) ? { path: named, text: set[named], sha256: sha(set[named]) } : null;
  };
  const repo = { root: ROOT, top: ROOT, read: (path) => fileOf(now, path), base: () => null };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Add the modules.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}

/** The fake agents: the review agent answers `review`, its one repair `repair`; each answer carries the run record
 *  `runs[label]` (none when absent), as the agent transport /2 sets it. A finding's checker holds, every question is
 *  sound. `seen` receives every request. */
function agents({ review, repair = review, runs = {}, seen = [] }) {
  const withRun = (answer, label) => {
    if (runs[label]) Object.defineProperty(answer, AGENT_RUN_FIELD, { value: runs[label], enumerable: false });
    return answer;
  };
  return async (request) => {
    // F3b (D111): an accounting agent's request answers every item as holding, and stays out of `seen`: this file
    // reads the review's requests and its checks' (d111-accounting.test.js reads the accounting's).
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return accountsHold(request.prompt);
    seen.push(request);
    if (request.label === 'code-review:agent') return withRun(structuredClone(review), request.label);
    if (request.label === 'code-review:repair') return withRun(structuredClone(repair), request.label);
    if (/^code-verify:F\d+/.test(request.label)) return holds(verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
}
const runWith = (f, judge, bound = 1_620_000 * 4) => runCodePass({ report: f.report, session: f.session,
  snapshot: f.snapshot, repo: f.repo, judge, bound, base: GIT, root: ROOT });

/** A run record of Reads with these typed ranges (`[path, startLine, numLines, totalLines]`). */
const runOf = (...ranges) => ({ numTurns: 2, toolCalls: { Read: ranges.length },
  reads: [...new Set(ranges.map(([path]) => `${ROOT}/${path}`))],
  readRanges: ranges.map(([path, startLine, numLines, totalLines]) => ({ path: `${ROOT}/${path}`, startLine, numLines,
    totalLines })), readsUnranged: 0, readsUnrangedPaths: [], readsFailed: [] });

// 10,250 lines of 40 bytes: over the change block's cap, so the request leaves its hunks out (`block_cap`); the file is
// added, so it has no earlier side.
const HUGE_LINES = 10_250;
const FILES = Object.freeze({ 'src/a.js': linesOf('alpha', 2), 'src/huge.js': linesOf('hugefile', HUGE_LINES) });
/** A bug in src/huge.js at `lines` (`[start, end]`), its one code step quoting line `start` as `quote`. */
const hugeFinding = (quote, [startLine, endLine] = [5_000, 5_000]) => ({ kind: 'bug', lens: 'behaviour',
  title: `SYNTHETIC: line ${startLine} of the left-out file is wrong`, claims: [], input: 'SYNTHETIC input',
  trace: [{ step: `It reaches line ${startLine}.`, path: 'src/huge.js', side: 'new', startLine, endLine: startLine,
    quote }], anchor: { path: 'src/huge.js', side: 'new', startLine, endLine }, leadsFrom: [] });
// The answer's finding quotes words that are not on its line: it fails its grounding and goes to the one repair. The
// repair mends the quote and widens the anchor by a line: not the same value, the same identity (one kind, one file
// version, overlapping lines).
const FAILING = { findings: [hugeFinding('SYNTHETIC words that are not on the line')], questions: [] };
const MENDED = { findings: [hugeFinding('hugefile 05000', [5_000, 5_001])], questions: [] };

test('D105 x D107: a repaired item whose anchor lies in a file the request left out takes the failing item\'s place '
  + 'by identity, is checked and published; its receipt sits inside only when the repair read its line', async () => {
  const f = fixture({ files: FILES, commands: ['npm test'] });
  const placesWith = async (runs) => {
    const seen = [];
    const ran = await runWith(f, agents({ review: FAILING, repair: MENDED, runs, seen }));
    return { ran, pass: ran.codePass, seen };
  };
  // Neither agent read the left-out file.
  const { ran, pass, seen } = await placesWith({});
  // D105: the request left out the file's hunks, and the repair's request did too.
  for (const part of ['review', 'repair']) {
    const entry = pass.manifest[part].files.find((x) => x.path === 'src/huge.js');
    assert.deepEqual([entry.state, entry.reason, entry.shown], ['left_out', 'block_cap', []], part);
  }
  assert.ok(!seen.find((r) => r.label === 'code-review:agent').prompt.includes('hugefile 05000'),
    'the request shows no line of the left-out file');
  // D107: the mended finding takes the failing one's place one to one (each the only match of the other), is checked
  // and published; no item is withheld, none is lost (`fatesOf` checks every fate).
  assert.equal(pass.calls.repair, 1);
  assert.deepEqual(fatesOf(ran, FAILING, MENDED).findings, { answer: ['replaced'], repair: ['kept'] });
  assert.deepEqual(pass.fates.filter((r) => r.list === 'findings').map(({ from, fate, by, replaces }) =>
    [from, fate, by ?? replaces]), [['answer', 'replaced', 0], ['repair', 'kept', 0]]);
  assert.deepEqual(pass.findings.map((x) => [x.anchor.path, x.anchor.startLine, x.anchor.endLine]),
    [['src/huge.js', 5_000, 5_001]]);
  assert.deepEqual(pass.withheld, []);
  // D105: the receipt is in no line the request showed, and no agent read it: outside.
  assert.deepEqual(pass.receiptPlaces, { inside: 0, outside: 1, unknown: 0 });
  // The repair's reading record read the receipt's line (the review agent read nothing): inside.
  const read = await placesWith({ 'code-review:repair': runOf(['src/huge.js', 4_990, 20, HUGE_LINES]) });
  assert.deepEqual(fatesOf(read.ran, FAILING, MENDED).findings, { answer: ['replaced'], repair: ['kept'] });
  assert.deepEqual(read.pass.receiptPlaces, { inside: 1, outside: 0, unknown: 0 });
  // Lines read apart from it, by either agent, leave it outside.
  const apart = await placesWith({ 'code-review:agent': runOf(['src/huge.js', 1, 2_000, HUGE_LINES]),
    'code-review:repair': runOf(['src/huge.js', 6_000, 10, HUGE_LINES]) });
  assert.deepEqual(apart.pass.receiptPlaces, { inside: 0, outside: 1, unknown: 0 });
});

test('D105 x D107: the coverage words after a repair say what the review agent and its repair read of a file the '
  + 'request left out — seen whole only when one of them read every line, whatever the fates', async () => {
  const f = fixture({ files: FILES, commands: ['npm test'] });
  const passWith = async (runs) => (await runWith(f, agents({ review: FAILING, repair: MENDED, runs }))).codePass;
  const W = CODE_REPORT_WORDS;
  // Neither agent read it: its change is not seen; the footer names it, and the coverage is partial.
  const unread = await passWith({});
  assert.deepEqual(codeSeenOf(unread).files.map((x) => [x.path, x.state, x.changeSeen]),
    [['src/a.js', 'whole', true], ['src/huge.js', 'not_seen', false]]);
  // D109 (its review): its hunks alone are over the change block's cap: too large on its own, named by that state.
  assert.deepEqual([unread.footer, unread.coverage], [[{ kind: 'withheld', path: 'src/huge.js' }], 'partial']);
  // D109: the one tally's groups, summing to the whole: one seen whole, one not seen (too large on its own).
  assert.equal(unread.files.find((x) => x.path === 'src/huge.js').state, 'oversize');
  assert.deepEqual(codeCoverageLines(unread), [W.files(2, [['whole', 1]], 1), W.coverage.partial]);
  assert.ok(codeFooterLines({ codePass: unread }).length > 0, 'the footer names the file the review did not see');
  // The repair read every line of it (the review agent read nothing): seen whole, its change seen (an added file has
  // no earlier side), no footer, and the coverage complete: the repair's reading record counts as the review's.
  const whole = await passWith({ 'code-review:repair': runOf(['src/huge.js', 1, HUGE_LINES, HUGE_LINES]) });
  assert.deepEqual(whole.fates.filter((r) => r.list === 'findings').map((r) => r.fate), ['replaced', 'kept']);
  assert.deepEqual(codeSeenOf(whole).files.map((x) => [x.path, x.state, x.changeSeen]),
    [['src/a.js', 'whole', true], ['src/huge.js', 'whole', true]]);
  assert.deepEqual([whole.footer, whole.coverage], [[], 'complete']);
  assert.deepEqual(codeCoverageLines(whole), [W.files(2, [['whole', 2]], 0)]);
  assert.deepEqual(codeSeenLines(whole), []);
  // The repair read only part of it: seen in part, named with its lines, its change not seen; the coverage partial.
  const part = await passWith({ 'code-review:repair': runOf(['src/huge.js', 4_990, 20, HUGE_LINES]) });
  assert.deepEqual(codeSeenOf(part).files.find((x) => x.path === 'src/huge.js'),
    { path: 'src/huge.js', total: HUGE_LINES, state: 'in_part', lines: [[4_990, 5_009]], changeSeen: false });
  assert.deepEqual([part.footer, part.coverage], [[], 'partial']);
  assert.equal(codeSeenLines(part).length, 1);
  assert.match(codeSeenLines(part)[0], /src\/huge\.js/);
  // The review agent read the first part and the repair the rest: the two records join, and the file is seen whole.
  const joined = await passWith({ 'code-review:agent': runOf(['src/huge.js', 1, 5_000, HUGE_LINES]),
    'code-review:repair': runOf(['src/huge.js', 5_001, HUGE_LINES - 5_000, HUGE_LINES]) });
  assert.deepEqual([joined.footer, joined.coverage, codeSeenLines(joined)], [[], 'complete', []]);
});

test('D105 x D107: a repair too large to send under the bound makes no call, and every item of the answer still ends '
  + 'with one fate; the failing one is withheld with `too_large`, in the repair\'s words', async () => {
  const f = fixture({ files: { 'src/a.js': linesOf('alpha', 2), 'src/b.js': linesOf('beta', 20) },
    commands: ['npm test'] });
  const passing = { kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: line 3 of b is wrong', claims: [],
    input: 'SYNTHETIC input', trace: [{ step: 'It reaches line 3.', path: 'src/b.js', side: 'new', startLine: 3,
      endLine: 3, quote: 'beta 00003' }], anchor: { path: 'src/b.js', side: 'new', startLine: 3, endLine: 3 },
    leadsFrom: [] };
  const failing = { ...passing, title: 'SYNTHETIC: line 9 of b is wrong', trace: [{ ...passing.trace[0],
    step: 'It reaches line 9.', startLine: 9, endLine: 9, quote: 'SYNTHETIC words that are not on the line' }],
  anchor: { ...passing.anchor, startLine: 9, endLine: 9 } };
  const answer = { findings: [failing, passing], questions: [] };
  const sentAt = async (bound) => {
    const seen = [];
    const ran = await runWith(f, agents({ review: answer, repair: answer, seen }), bound);
    return { ran, seen };
  };
  // The least bound the review request is sent at: there it holds nothing more that could give way to the repair's note.
  let lo = 1, hi = reviewInputBytes((await sentAt(Infinity)).seen.find((r) => r.label === 'code-review:agent'));
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await sentAt(mid)).ran.codePass.manifest.review.sent === true) hi = mid; else lo = mid + 1;
  }
  const { ran, seen } = await sentAt(lo);
  const pass = ran.codePass;
  assert.equal(pass.manifest.review.sent, true);
  assert.deepEqual([seen.some((r) => r.label === 'code-review:repair'), pass.calls.repair], [false, 0]);
  // D107: each item of the answer, one fate; with no repair, the passing item stands and the failing one is withheld.
  assert.deepEqual(fatesOf(ran, answer, null).findings, { answer: ['withheld', 'kept'], repair: [] });
  assert.deepEqual(pass.findings.map((x) => x.title), [passing.title]);
  // D105's reason why no repair was checked, said by D107's readers, never as a call that did not answer.
  assert.deepEqual(pass.withheld.map(({ reason, cause, repair }) => [reason, cause, repair]),
    [['evidence_grounding_failed', 'quote_ungrounded', 'too_large']]);
  assert.ok(withheldWhy(pass.withheld[0]).endsWith(`, and ${CODE_REPORT_WORDS.unrepaired.too_large}`));
  assert.doesNotMatch(withheldWhy(pass.withheld[0]), /even after one repair|failed/);
  assert.deepEqual(pass.footer.filter((x) => ['failed', 'too_large'].includes(x.kind)),
    [{ kind: 'too_large', part: 'repair', count: 1 }]);
  assert.equal(pass.coverage, 'partial');
});
