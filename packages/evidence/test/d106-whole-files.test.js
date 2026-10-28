// D106 (F2 part B): the code review's request also shows the code around the change — each changed file whole, as it
// is now, smallest first within a frozen 400,000-byte block, a file that does not fit named with its line count; and the
// lines of unchanged tracked files the session read with a typed read, as they are now — behind one frozen setting
// (code-pass.js `CODE_WHOLE_FILES`), named in the session run profile, on since D108 (the owner, 2026-10-17: "Yes, keep
// it on for now"). Off (`runCodePass({ wholeFiles: false })`), every byte is part A's. On, the brief says the changed
// files are given whole and to open the ones the request names as not shown; the two blocks give way first, the reads
// before the whole files, each unit named in fixed words and in the manifest.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Each invariant is a test that fails on a mutant of its rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_SHOWN_STATES, CODE_LEFT_OUT_REASONS } from '../src/ledger.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, codeSeenOf, planReviewRequest, sessionReadsOf,
  wholeFilesBlock, readsBlock, withoutGutter, CODE_WHOLE_FILES, CODE_PASS_PROFILE, CODE_REVIEW_SYSTEM,
  CODE_REVIEW_SYSTEM_WHOLE_FILES, CODE_REQUEST_BLOCKS, CODE_REQUEST_BLOCKS_WHOLE_FILES, CODE_REQUEST_YIELD_ORDER,
  CODE_CHANGE_BLOCK_MAX_BYTES, WHOLE_LEFT_OUT_WORDS, WHOLE_NONE_WORDS, READS_NONE_WORDS, readsLeftOutLine,
  AGENT_RUN_FIELD } from '../src/code-pass.js';
import { runProfile } from '../src/run-review.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS, codeSeenLines } from '../src/code-report.js';
import { buildCodeSession, holds, allSound, verifiedFinding, batchItems, accountsHold, accountsHoldWith } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const ASK = 'SYNTHETIC_ASK: change the two modules and run the tests.';
const RULES = 'SYNTHETIC_RULES: every module exports one function.';
const WHOLE_HEADING = '# The changed files whole, as they are now';
const READS_HEADING = '# The lines of unchanged tracked files the session read';

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`
  .padEnd(width, '.')).join('\n') + '\n';
const addedPatch = (path, text) => {
  const rows = text.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n');
};
/** git's own patch of a file whose line `at` (1-based) changed, three lines of context. */
const modifiedPatch = (path, before, after, at) => {
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  const from = Math.max(1, at - 3), to = Math.min(a.length, at + 3);
  const rows = [];
  for (let l = from; l <= to; l++) { if (l === at) rows.push(`-${a[l - 1]}`, `+${b[l - 1]}`); else rows.push(` ${a[l - 1]}`); }
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    `@@ -${from},${to - from + 1} +${from},${to - from + 1} @@`, ...rows, ''].join('\n');
};
/** A file of `n` lines whose line `at` changed: its text before and after. */
const changedAt = (tag, n, at) => {
  const before = linesOf(tag, n);
  const line = `${tag} ${String(at).padStart(5, '0')}`;
  return { before, after: before.replace(line, line.toUpperCase()), at };
};

/**
 * A session that writes `files` (path -> text; `modified` gives a file's text at the start commit and the line that
 * changed) and runs `commands`, the project's rule file loaded, then makes the typed reads `reads` (each `{ path,
 * window?: [startLine, numLines], input?: object, failed?, refused?, noResult? }`, its result as Claude Code's are
 * recorded: a read that returned lines has no typed outcome, only a failure is typed; `also` a second path the read
 * names, `results` its terminal results in order, each 'ok' or 'failed'); the snapshot of the change with a git base
 * (`patches` replaces a path's patch); and a
 * repository whose unchanged files are `tracked` (now and at the start commit), `untracked` (now only) and `drifted`
 * (path -> [at the start commit, now]).
 */
function fixture({ files, modified = {}, commands = [], reads = [], tracked = {}, untracked = {}, drifted = {},
  rules = RULES, patches = {} }) {
  const blobs = { ask: ASK, rules, ok: 'ok', failed: 'Error: SYNTHETIC read failed' };
  const T1 = { turn: 'T1' };
  const region = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const command = (id, text) => {
    blobs[`cmd-${id}`] = text;
    return [{ id, kind: 'invocation', tool: 'Bash', operation: 'command', paths: [], input: [], changes: [], callKey: id,
      command: region(`cmd-${id}`), ...T1 }, { id: `${id}-r`, kind: 'observation', invocation: id, blob: 'ok', ...T1 }];
  };
  const read = (r, at) => {
    const id = `R${at + 1}`;
    if (r.input) blobs[`input-${id}`] = JSON.stringify(r.input);
    const result = (failed, suffix) => ({ id: `${id}-r${suffix}`, kind: 'observation', invocation: id, exitCode: null,
      ...(failed ? { blob: 'failed', result: 'failed', terminalStatusProven: true, sourceOfResult: 'native' }
        : { blob: 'ok', result: 'unknown', terminalStatusProven: false, sourceOfResult: 'unknown' }), ...T1 });
    return [{ id, kind: 'invocation', read: r.path, ...(r.input ? { input: region(`input-${id}`) } : {}),
      ...(r.also ? { paths: [{ path: r.path }, { path: r.also }] } : {}),
      recorded: { tool: 'Read', ...(r.window ? { read: { startLine: r.window[0], numLines: r.window[1] } } : {}),
        ...(r.failed ? { isError: true } : {}), ...(r.refused ? { denial: 'user-rejected' } : {}) }, ...T1 },
    ...(r.noResult ? [] : r.results ? r.results.map((x, k) => result(x === 'failed', k ? `${k}` : ''))
      : [result(r.failed || r.refused, '')])];
  };
  const specs = [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...Object.entries(files).map(([path, text], at) => {
      blobs[`file-${at}`] = text;
      return { id: `W${at + 1}`, kind: 'invocation', write: path, blob: `file-${at}`, ...T1 };
    }),
    ...commands.flatMap((text, at) => command(`B${at + 1}`, text)),
    ...reads.flatMap(read)];
  const session = buildCodeSession('sess-d106', blobs, specs,
    { projectInstructions: rules === null ? [] : [{ path: 'CLAUDE.md', blob: 'rules' }] });
  const plan = codeSnapshotPlan(session, { root: ROOT });
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => {
    const text = files[entry.path];
    const before = modified[entry.path];
    return before ? { path: entry.path, bytes: enc(text), type: 'modified', base: { bytes: enc(before.text) },
      patch: patches[entry.path] ?? modifiedPatch(entry.path, before.text, text, before.at) }
      : { path: entry.path, bytes: enc(text), type: 'added', patch: addedPatch(entry.path, text) };
  }), { base: GIT });
  const now = { ...files, 'CLAUDE.md': rules ?? '', ...tracked, ...untracked,
    ...Object.fromEntries(Object.entries(drifted).map(([path, [, after]]) => [path, after])) };
  const before = { ...Object.fromEntries(Object.entries(modified).map(([path, m]) => [path, m.text])),
    'CLAUDE.md': rules ?? '', ...tracked, ...Object.fromEntries(Object.entries(drifted).map(([path, [was]]) => [path, was])) };
  const fileOf = (set, path) => {
    const named = String(path).replace(`${ROOT}/`, '');
    return Object.hasOwn(set, named) ? { path: named, text: set[named], sha256: sha(set[named]) } : null;
  };
  const repo = { root: ROOT, top: ROOT, read: (path) => fileOf(now, path), base: (path) => fileOf(before, path) };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Change the modules.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}

/** The fake agents: the review answers `review(prompt)` (default nothing), its answer carrying `run` as the transport
 *  sets it; a finding's checker holds, the questions' checker finds each sound. `seen` receives every request. */
function agents({ review = () => ({ findings: [], questions: [] }), run = null, seen = [], account = accountsHold } = {}) {
  return async (request) => {
    // F3b (D111): an accounting agent's request answers every item as holding, and stays out of `seen`: this file
    // reads the review's requests and its checks' (d111-accounting.test.js reads the accounting's).
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return account(request.prompt);
    seen.push(request);
    if (['code-review:agent', 'code-review:repair'].includes(request.label)) {
      const answer = review(request.prompt, request);
      if (run) Object.defineProperty(answer, AGENT_RUN_FIELD, { value: run, enumerable: false });
      return answer;
    }
    if (/^code-verify:F\d+/.test(request.label)) return holds(verifiedFinding(request.prompt), request);
    if (/^code-verify:batch/.test(request.label)) return allSound(batchItems(request.prompt), request);
    throw new Error(`unexpected request ${request.label}`);
  };
}
const runWith = (f, judge, { bound = Infinity, wholeFiles } = {}) => runCodePass({ report: f.report, session: f.session,
  snapshot: f.snapshot, repo: f.repo, judge, bound, base: GIT, root: ROOT,
  ...(wholeFiles === undefined ? {} : { wholeFiles }) });

const B = changedAt('beta', 20, 7);
const C = changedAt('gamma', 60, 30);
/** The change: an added module (its hunk holds every line), and two modules modified at one line each. */
const CHANGE = Object.freeze({ files: { 'src/a.js': linesOf('alpha', 2), 'src/b.js': B.after, 'src/c.js': C.after },
  modified: { 'src/b.js': { text: B.before, at: B.at }, 'src/c.js': { text: C.before, at: C.at } } });
const UTIL = linesOf('util', 40);
const SMALL = linesOf('small', 12);
/** The session's reads: a typed window, an input's offset and limit, a read with neither, and reads part B must not
 *  show (a search, a failed read, a changed file, an untracked file, a file changed since the start commit, a path
 *  outside the repository, the rule file the rules block shows whole). */
const READS = Object.freeze([
  { path: 'lib/util.js', window: [10, 5] },
  { path: 'lib/util.js', input: { offset: 30, limit: 3 } },
  { path: 'lib/small.js' },
  { path: 'lib/search.js', input: { pattern: 'util' } },
  { path: 'lib/failed.js', failed: true },
  { path: 'lib/refused.js', refused: true },
  { path: 'lib/noresult.js', noResult: true },
  { path: 'src/c.js', window: [1, 60] },
  { path: 'lib/scratch.js' },
  { path: 'lib/moved.js' },
  { path: '/etc/hosts' },
  { path: 'CLAUDE.md' },
]);
const REPO = Object.freeze({ tracked: { 'lib/util.js': UTIL, 'lib/small.js': SMALL, 'lib/search.js': linesOf('search', 5),
  'lib/failed.js': linesOf('failed', 5), 'lib/refused.js': linesOf('refused', 5), 'lib/noresult.js': linesOf('noresult', 5) },
untracked: { 'lib/scratch.js': linesOf('scratch', 5) },
drifted: { 'lib/moved.js': [linesOf('moved', 5), linesOf('MOVED', 5)] } });
const full = (more = {}) => fixture({ ...CHANGE, commands: ['npm test'], reads: READS, ...REPO, ...more });

test('D108: the setting is on by default — the code step sends part B; off, run by runCodePass({ wholeFiles: false }), '
  + 'the request, its brief, its manifest and the record are part A\'s byte for byte; the session run profile names the '
  + 'setting', async () => {
  assert.deepEqual(CODE_WHOLE_FILES, { on: true, maxBytes: 400_000, readsMaxBytes: 400_000, readPage: 2_000,
    yieldFirst: ['reads', 'wholeFiles'] });
  assert.ok(Object.isFrozen(CODE_WHOLE_FILES) && Object.isFrozen(CODE_WHOLE_FILES.yieldFirst));
  assert.equal(CODE_WHOLE_FILES.maxBytes, CODE_CHANGE_BLOCK_MAX_BYTES, 'the change block\'s own literal');
  assert.equal(CODE_PASS_PROFILE.wholeFiles, CODE_WHOLE_FILES);
  assert.deepEqual(runProfile('session-only').codePass.wholeFiles, JSON.parse(JSON.stringify(CODE_WHOLE_FILES)));
  const f = full();
  const byDefault = [], on = [], off = [];
  const byDefaultResult = await runWith(f, agents({ seen: byDefault }));
  await runWith(f, agents({ seen: on }), { wholeFiles: true });
  const result = await runWith(f, agents({ seen: off }), { wholeFiles: false });
  assert.deepEqual(byDefault, on, 'by default the setting is on');
  assert.equal(byDefault[0].system, CODE_REVIEW_SYSTEM_WHOLE_FILES);
  assert.ok(byDefault[0].prompt.includes(WHOLE_HEADING) && byDefault[0].prompt.includes(READS_HEADING));
  assert.equal(byDefaultResult.codePass.version, CODE_PASS_PROFILE, 'a default run names the frozen setting');
  // Off: part A's request, as D105 sends it.
  const [request] = off;
  assert.equal(request.system, CODE_REVIEW_SYSTEM);
  assert.ok(!request.prompt.includes(WHOLE_HEADING) && !request.prompt.includes(READS_HEADING));
  assert.ok(!request.prompt.includes(UTIL.split('\n')[9]), 'no line the session read');
  const { review } = result.codePass.manifest;
  const { brief: _brief, total: _total, ...blocks } = review.bytes;
  assert.deepEqual(Object.keys(blocks), [...CODE_REQUEST_BLOCKS]);
  assert.equal(review.reads, undefined);
  assert.deepEqual(review.files.map((x) => [x.path, x.state, x.reason ?? null]), [['src/a.js', 'whole', null],
    ['src/b.js', 'hunks_only', null], ['src/c.js', 'hunks_only', null]]);
  assert.deepEqual(result.codePass.version, { ...CODE_PASS_PROFILE, wholeFiles: { ...CODE_WHOLE_FILES, on: false } },
    'the record names the setting it ran under');
  // The planner alone, off: part A's request, the session's reads given or not; by default it plans part B.
  const inputs = { words: { asked: [ASK] }, files: f.snapshot, where: { root: ROOT, top: null } };
  const reads = sessionReadsOf(f.session, { root: ROOT, repo: f.repo });
  assert.ok(reads.length > 0);
  assert.deepEqual(planReviewRequest({ ...inputs, wholeFiles: false, sessionReads: reads }),
    planReviewRequest({ ...inputs, wholeFiles: false }));
  assert.deepEqual(planReviewRequest({ ...inputs, sessionReads: reads }),
    planReviewRequest({ ...inputs, wholeFiles: true, sessionReads: reads }));
  assert.notDeepEqual(planReviewRequest({ ...inputs, sessionReads: reads }),
    planReviewRequest({ ...inputs, wholeFiles: false, sessionReads: reads }));
});

test('D106 on: each changed file whole, as it is now, its lines numbered; a file whose hunks hold every line is not '
  + 'repeated; the brief says the changed files are given whole and to open the ones named as not shown', async () => {
  const f = full();
  const seen = [];
  const result = await runWith(f, agents({ seen }), { wholeFiles: true });
  const [request] = seen;
  assert.equal(request.system, CODE_REVIEW_SYSTEM_WHOLE_FILES);
  const flat = (text) => text.replace(/\s+/g, ' ');
  assert.ok(flat(request.system).includes('each changed file is given whole in this request, by its hunks or among the '
    + 'changed files whole, but for a file it says is not shown whole or whose hunks it does not show: open those'));
  assert.ok(flat(request.system).includes('the changed files whole, as they are now, each line after its number (a file '
    + 'whose hunks hold every line it has now is not repeated there, and a file whose hunks the change cannot show is not '
    + 'there; a file left out for room is named with its line count, or one line says that all are left out)'));
  assert.ok(!flat(CODE_REVIEW_SYSTEM).includes('given whole in this request'));
  const block = request.prompt.slice(request.prompt.indexOf(WHOLE_HEADING), request.prompt.indexOf(READS_HEADING));
  // In the prompt after the change and before the reads, then the dossier: CODE_REQUEST_BLOCKS_WHOLE_FILES.
  assert.ok(request.prompt.indexOf('# The change —') < request.prompt.indexOf(WHOLE_HEADING));
  assert.ok(request.prompt.indexOf(READS_HEADING) < request.prompt.indexOf('# Sonah\'s review of the session'));
  assert.ok(!block.includes('"path":"src/a.js"'), 'an added file whose hunk holds every line is not repeated');
  for (const [path, text] of [['src/b.js', B.after], ['src/c.js', C.after]]) {
    const lines = text.split('\n').slice(0, -1);
    assert.ok(block.includes(`FILE {"path":"${path}","lines":${lines.length}}\n${lines.map((line, at) =>
      `${String(at + 1).padStart(6, ' ')}\t${line}`).join('\n')}\n`), path);
  }
  const { review } = result.codePass.manifest;
  assert.deepEqual(review.files.map((x) => [x.path, x.state, x.shown, x.lines]), [['src/a.js', 'whole', [[1, 2]], 2],
    ['src/b.js', 'whole', [[1, 20]], 20], ['src/c.js', 'whole', [[1, 60]], 60]]);
  // Seen whole, so its change seen: no file named short of whole, the coverage complete.
  assert.deepEqual(codeSeenOf(result.codePass).files.map((x) => [x.state, x.changeSeen]), [['whole', true],
    ['whole', true], ['whole', true]]);
  assert.deepEqual([result.codePass.footer, result.codePass.coverage], [[], 'complete']);
  // A quote copied from a whole file's row with its gutter grounds as the line itself.
  assert.equal(withoutGutter(`${String(30).padStart(6, ' ')}\t${C.after.split('\n')[29]}`), C.after.split('\n')[29]);
  // The record names the setting it ran under (D108: the frozen one); every other member is the profile's.
  assert.equal(result.codePass.version, CODE_PASS_PROFILE);
  assert.equal(result.codePass.version.wholeFiles.on, true);
});

test('D106 on: the whole files fill smallest first within their block\'s cap; a file that does not fit is named with its '
  + 'line count in fixed words and in the manifest, never cut, and reads as seen only where the change touched it',
async () => {
  const candidates = [{ path: 'src/big.js', text: linesOf('big', 300) }, { path: 'src/mid.js', text: linesOf('mid', 120) },
    { path: 'src/tiny.js', text: linesOf('tiny', 10) }].map((c) => ({ ...c, lines: c.text.split('\n').length - 1 }));
  const at = (maxBytes) => wholeFilesBlock(candidates, { maxBytes });
  const all = at(Infinity);
  const cap = Buffer.byteLength(all.text) - 1;
  // One byte short of all three: the largest leaves, named with its line count; the two smaller stay whole.
  const short = at(cap);
  assert.ok(Buffer.byteLength(short.text) <= cap);
  assert.deepEqual([...short.shown], ['src/mid.js', 'src/tiny.js']);
  assert.deepEqual([...short.reasons], [['src/big.js', 'block_cap']]);
  assert.ok(short.text.includes(`FILE {"path":"src/big.js","lines":300}\n${WHOLE_LEFT_OUT_WORDS.block_cap}\n`));
  assert.ok(!short.text.includes('big 00001'), 'no part of a file over the cap is shown');
  // Whatever their order: the smallest are kept first (a mutant filling in path order keeps big.js).
  assert.deepEqual([...wholeFilesBlock([...candidates].reverse(), { maxBytes: cap }).shown].sort(), ['src/mid.js',
    'src/tiny.js']);
  // Below every name: one fixed line, no file named, none shown; with nothing to show: its own line.
  assert.ok(at(50).text.includes(WHOLE_NONE_WORDS.block_cap));
  assert.ok(wholeFilesBlock([]).text.includes(WHOLE_NONE_WORDS.none));
  // Through the step: a changed file over the frozen 400,000-byte cap is named, hunks only, with its line count.
  const huge = changedAt('huge', 10_500, 5_000);
  const f = fixture({ files: { ...CHANGE.files, 'src/huge.js': huge.after },
    modified: { ...CHANGE.modified, 'src/huge.js': { text: huge.before, at: huge.at } }, commands: ['npm test'] });
  const seen = [];
  const result = await runWith(f, agents({ seen }), { wholeFiles: true });
  const entry = result.codePass.manifest.review.files.find((x) => x.path === 'src/huge.js');
  assert.deepEqual([entry.state, entry.reason, entry.lines], ['hunks_only', 'block_cap', 10_500]);
  assert.ok(seen[0].prompt.includes(`FILE {"path":"src/huge.js","lines":10500}\n${WHOLE_LEFT_OUT_WORDS.block_cap}`));
  assert.ok(result.codePass.manifest.review.bytes.wholeFiles <= CODE_WHOLE_FILES.maxBytes);
  const huged = codeSeenOf(result.codePass).files.find((x) => x.path === 'src/huge.js');
  assert.deepEqual([huged.state, huged.changeSeen], ['hunks_only', true]);
  assert.equal(result.codePass.coverage, 'complete', 'its change was shown: hunks only does not lower the coverage');
});

test('D106 on: the lines the session read of unchanged tracked files, as they are now — a typed window, an input\'s '
  + 'offset and limit, a read with neither — and nothing of a search, a failed, refused or unanswered read, a changed, '
  + 'untracked or moved file, a path outside the repository or a rule file shown whole', async () => {
  const f = full();
  const reads = sessionReadsOf(f.session, { root: ROOT, repo: f.repo });
  // CLAUDE.md is read here (tracked, unchanged); the planner leaves it out, as the rules block shows it whole.
  assert.deepEqual(reads.map((r) => [r.path, r.lines, r.read]), [['CLAUDE.md', 1, [[1, 1]]],
    ['lib/small.js', 12, [[1, 12]]], ['lib/util.js', 40, [[10, 14], [30, 32]]]]);
  // No repository reader with a start commit: no read can be proved unchanged.
  assert.deepEqual(sessionReadsOf(f.session, { root: ROOT, repo: { read: f.repo.read } }), []);
  const seen = [];
  const result = await runWith(f, agents({ seen }), { wholeFiles: true });
  const { prompt } = seen[0];
  const block = prompt.slice(prompt.indexOf(READS_HEADING), prompt.indexOf('# Sonah\'s review of the session'));
  const util = UTIL.split('\n');
  assert.ok(block.includes(`FILE {"path":"lib/util.js","lines":40,"read":[[10,14],[30,32]]}\n${[10, 11, 12, 13, 14]
    .map((n) => `${String(n).padStart(6, ' ')}\t${util[n - 1]}`).join('\n')}\n${[30, 31, 32]
    .map((n) => `${String(n).padStart(6, ' ')}\t${util[n - 1]}`).join('\n')}\n`));
  assert.ok(!block.includes(util[8]) && !block.includes(util[14]), 'only the lines read');
  for (const absent of ['lib/search.js', 'lib/failed.js', 'lib/refused.js', 'lib/noresult.js', 'src/c.js',
    'lib/scratch.js', 'lib/moved.js', '/etc/hosts', 'CLAUDE.md']) assert.ok(!block.includes(`"path":"${absent}"`), absent);
  // The record keeps paths and line numbers, never a file's text.
  assert.ok(!JSON.stringify(result.codePass).includes(util[11]) && !JSON.stringify(result.codePass)
    .includes(C.after.split('\n')[54]), 'no file text in the record');
  assert.deepEqual(result.codePass.manifest.review.reads, [
    { path: 'lib/small.js', lines: 12, read: [[1, 12]], shown: [[1, 12]], state: 'whole' },
    { path: 'lib/util.js', lines: 40, read: [[10, 14], [30, 32]], shown: [[10, 14], [30, 32]], state: 'in_part' }]);
  // A typed window of no line is no read; a read whose input holds another field read no lines; a page from line 1.
  const g = fixture({ ...CHANGE, ...REPO, reads: [{ path: 'lib/util.js', window: [5, 0] },
    { path: 'lib/small.js', input: { offset: 3, limit: 2, extra: true } }, { path: 'lib/small.js', input: { offset: 11 } }] });
  assert.deepEqual(sessionReadsOf(g.session, { root: ROOT, repo: g.repo }).map((r) => [r.path, r.read]),
    [['lib/small.js', [[11, 12]]]]);
  assert.equal(sessionReadsOf(g.session, { root: ROOT, repo: g.repo, page: 1 })[0].read[0][1], 11);
  // None read, with a start commit: the block says what Sonah found, in fixed words.
  const none = [];
  await runWith(fixture({ ...CHANGE }), agents({ seen: none }), { wholeFiles: true });
  assert.ok(none[0].prompt.includes(READS_NONE_WORDS.git));
});

test('D106 on: over the bound the session\'s reads give way first, then the whole files, then the commands, the hunks '
  + 'and the rule files, each in whole units named in fixed words and in the manifest; a request sent always fits, and '
  + 'the minimum still sends', async () => {
  const commands = Array.from({ length: 20 }, (_, i) => `npm test -- --grep case-${String(i + 1).padStart(2, '0')}`);
  const f = full({ commands, rules: linesOf('rule', 120) });
  const sizeAt = async (bound) => {
    const seen = [];
    const result = await runWith(f, agents({ seen }), { bound, wholeFiles: true });
    return { review: result.codePass.manifest.review, request: seen.find((r) => r.label === 'code-review:agent') ?? null };
  };
  const top = await sizeAt(Infinity);
  const fullBytes = reviewInputBytes(top.request);
  // Under the bound nothing is left out; the request is its brief and its blocks, each within its cap.
  const { brief, total, ...blocks } = top.review.bytes;
  assert.deepEqual(Object.keys(blocks), [...CODE_REQUEST_BLOCKS_WHOLE_FILES]);
  assert.equal(total, brief + Object.values(blocks).reduce((a, b) => a + b, 0) + CODE_REQUEST_BLOCKS_WHOLE_FILES.length - 1);
  assert.ok(blocks.wholeFiles <= CODE_WHOLE_FILES.maxBytes && blocks.reads <= CODE_WHOLE_FILES.readsMaxBytes);
  assert.deepEqual([...CODE_WHOLE_FILES.yieldFirst, ...CODE_REQUEST_YIELD_ORDER],
    ['reads', 'wholeFiles', 'commands', 'hunks', 'rules']);
  // One byte under: a read range leaves first, named; every whole file and every command stays.
  const one = await sizeAt(fullBytes - 1);
  assert.ok(reviewInputBytes(one.request) <= fullBytes - 1);
  assert.ok(one.review.reads.some((r) => r.leftOut?.some((x) => x.reason === 'request_bound')));
  assert.ok(one.review.files.every((x) => x.state === 'whole') && one.review.commands.from === 1);
  const left = one.review.reads.flatMap((r) => (r.leftOut ?? []).map((x) => x.lines))[0];
  assert.ok(one.request.prompt.includes(readsLeftOutLine(left[0], left[1], 'request_bound')));
  let order = 0, minimumSeen = false;
  const ranks = new Set();
  const rank = (review) => (review.rules[0].state === 'left_out' ? 5 : review.files.some((x) => x.state === 'left_out') ? 4
    : review.commands.from > 1 ? 3 : review.files.some((x) => x.reason === 'request_bound') ? 2
      : review.reads.some((r) => r.leftOut) ? 1 : 0);
  for (let bound = fullBytes; bound > 0; bound -= 97) {
    const { review, request } = await sizeAt(bound);
    if (!review.sent) { minimumSeen = true; assert.equal(request, null); continue; }
    assert.ok(reviewInputBytes(request) <= bound, `${bound}`);
    assert.equal(review.bytes.total, reviewInputBytes(request));
    // The order: a block gives way only once every block below it has given way whole.
    const now = rank(review);
    if (now >= 2) assert.ok(review.reads.every((r) => r.state === 'left_out'), `${bound}: the reads leave before a file`);
    if (now >= 3) assert.ok(review.files.every((x) => x.state !== 'whole' || x.reason === undefined)
      && !review.files.some((x) => x.path !== 'src/a.js' && x.state === 'whole'), `${bound}: the files before a command`);
    if (now >= 4) assert.equal(review.commands.from, 21, `${bound}: every command before a hunk`);
    assert.ok(now >= order, `${bound}: the lowest blocks first`);
    ranks.add(now);
    order = now;
    for (const entry of [...review.files, ...review.reads]) assert.ok(CODE_SHOWN_STATES.includes(entry.state));
    for (const r of review.reads) for (const x of r.leftOut ?? []) assert.ok(CODE_LEFT_OUT_REASONS.includes(x.reason));
  }
  assert.deepEqual([[...ranks], minimumSeen], [[0, 1, 2, 3, 4, 5], true], 'every block gave way, in order, then the minimum');
});

test('D106 on: a whole-file write with no git base, whose hunk shows no line of it, is shown whole and seen; off, it is '
  + 'not seen unless the review reads it', async () => {
  const text = linesOf('alpha', 3);
  const f = fixture({ files: { 'src/a.js': text } });
  const plan = codeSnapshotPlan(f.session, { root: ROOT });
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => ({ path: entry.path, bytes: enc(text) })),
    { base: { kind: 'recorded_edits' } });
  // F3b (D111): the change shows no line of the file, so the accounting quotes its first line from the repository.
  const account = accountsHoldWith({ path: 'src/a.js', side: 'new', startLine: 1, endLine: 1, quote: text.split('\n')[0] });
  const runOn = (wholeFiles) => runCodePass({ report: f.report, session: f.session, snapshot, repo: f.repo,
    judge: agents({ account }), bound: Infinity, base: { kind: 'recorded_edits' }, root: ROOT, wholeFiles });
  const off = (await runOn(false)).codePass;
  assert.deepEqual([codeSeenOf(off).files[0].state, off.coverage], ['not_seen', 'partial']);
  const on = (await runOn(true)).codePass;
  assert.deepEqual(on.manifest.review.files.map((x) => [x.path, x.state, x.shown]), [['src/a.js', 'whole', [[1, 3]]]]);
  assert.deepEqual([codeSeenOf(on).files[0].state, on.footer, on.coverage], ['whole', [], 'complete']);
});

test('D106 on: a receipt on a line of a changed file shown whole, or of a range the session read, is counted inside what '
  + 'the review was shown; off, outside', async () => {
  const util = UTIL.split('\n');
  const finding = { kind: 'contract_break', lens: 'contracts', title: 'SYNTHETIC: the caller relies on the old line',
    claims: [], input: 'SYNTHETIC input', trace: [
      { step: 'The caller.', path: 'lib/util.js', side: 'new', startLine: 12, endLine: 12, quote: util[11] },
      { step: 'Far from the change.', path: 'src/c.js', side: 'new', startLine: 55, endLine: 55,
        quote: C.after.split('\n')[54] },
      { step: 'The change.', path: 'src/c.js', side: 'new', startLine: 30, endLine: 30, quote: 'GAMMA 00030' }],
    anchor: { path: 'src/c.js', side: 'new', startLine: 30, endLine: 30 }, leadsFrom: [] };
  const places = async (wholeFiles) => (await runWith(full(), agents({ review: () => ({ findings: [finding],
    questions: [] }) }), { wholeFiles })).codePass.receiptPlaces;
  assert.deepEqual(await places(true), { inside: 3, outside: 0, unknown: 0 });
  assert.deepEqual(await places(false), { inside: 1, outside: 2, unknown: 0 });
});

test('D106 on: the reads block fills its ranges smallest first within its cap; a range that does not fit is named in '
  + 'fixed words, never cut; below every name, one fixed line', () => {
  const reads = [{ path: 'lib/x.js', lines: 400, read: [[1, 200], [300, 310]], text: linesOf('x', 400) }];
  const all = readsBlock(reads, { maxBytes: Infinity });
  assert.deepEqual(all.entries, [{ path: 'lib/x.js', lines: 400, read: [[1, 200], [300, 310]],
    shown: [[1, 200], [300, 310]], state: 'in_part' }]);
  const cap = Buffer.byteLength(all.text) - 1;
  const short = readsBlock(reads, { maxBytes: cap });
  assert.ok(Buffer.byteLength(short.text) <= cap);
  assert.deepEqual(short.entries[0].shown, [[300, 310]], 'the smaller range is kept');
  assert.deepEqual(short.entries[0].leftOut, [{ lines: [1, 200], reason: 'block_cap' }]);
  assert.ok(short.text.includes(readsLeftOutLine(1, 200, 'block_cap')));
  assert.ok(!short.text.includes('x 00001'), 'no part of a range left out is shown');
  const tiny = readsBlock(reads, { maxBytes: 40 });
  assert.ok(tiny.text.includes(READS_NONE_WORDS.block_cap));
  assert.deepEqual(tiny.entries[0].state, 'left_out');
});

// ---- after the build's independent review (2026-10-17) -------------------------------------------------------------

test('D106 on: a changed file whose hunks hold every line but go over the change block\'s cap is shown whole when it '
  + 'fits its block, seen whole, the coverage complete; a file whose hunks the change block shows whole is not '
  + 'repeated', async () => {
  // Two added files: each hunk holds every line of its file, and x2.js's alone is over the change block's cap (D149: two
  // that fit apart but not together are planned as two units, each shown by its hunks: d149-unit-requests.test.js).
  const files = { 'src/x1.js': linesOf('xone', 4_500), 'src/x2.js': linesOf('xtwo', 7_000) };
  const f = fixture({ files, rules: null });
  const off = (await runWith(f, agents(), { wholeFiles: false })).codePass;
  assert.deepEqual(off.manifest.review.files.map((x) => [x.path, x.state, x.reason ?? null]),
    [['src/x1.js', 'whole', null], ['src/x2.js', 'left_out', 'block_cap']], 'the change block clips the larger one');
  const seen = [];
  const on = (await runWith(f, agents({ seen }), { wholeFiles: true })).codePass;
  const { prompt } = seen[0];
  const block = prompt.slice(prompt.indexOf(WHOLE_HEADING), prompt.indexOf(READS_HEADING));
  assert.ok(block.includes(`FILE {"path":"src/x2.js","lines":7000}\n${String(1).padStart(6, ' ')}\txtwo 00001`));
  assert.ok(block.includes(`${String(7000).padStart(6, ' ')}\txtwo 07000`), 'its last line too');
  assert.ok(!block.includes('"path":"src/x1.js"'), 'the file whose hunks the change block shows is not repeated');
  assert.ok(!block.includes(WHOLE_NONE_WORDS.none));
  assert.deepEqual(on.manifest.review.files.map((x) => [x.path, x.state, x.shown, x.lines]),
    [['src/x1.js', 'whole', [[1, 4_500]], 4_500], ['src/x2.js', 'whole', [[1, 7_000]], 7_000]]);
  assert.ok(on.manifest.review.bytes.wholeFiles <= CODE_WHOLE_FILES.maxBytes);
  assert.deepEqual(codeSeenOf(on).files.map((x) => [x.path, x.state, x.changeSeen]),
    [['src/x1.js', 'whole', true], ['src/x2.js', 'whole', true]]);
  assert.deepEqual([on.footer, on.coverage], [[], 'complete']);
  // Over the bound, the hunks give way only after the whole files have: a file is never shown whole while the change
  // block is short of its cap, so the change block a file is left out of the whole files for is the one it shows.
  const inputs = { words: { asked: [ASK] }, files: f.snapshot, where: { root: ROOT, top: null }, wholeFiles: true };
  const top = planReviewRequest(inputs);
  const all = top.manifest.bytes.total;
  let whole = 0, cut = 0;
  for (let bound = all; bound > all - 520_000; bound -= 40_000) {
    const plan = planReviewRequest({ ...inputs, bound });
    const shownWhole = plan.manifest.files.some((x) => x.path === 'src/x2.js' && x.state === 'whole');
    const hunksCut = plan.manifest.files.some((x) => x.reason === 'request_bound' && x.state === 'left_out');
    assert.ok(!(shownWhole && hunksCut), `${bound}: a file shown whole while the change block gave way`);
    whole += shownWhole ? 1 : 0;
    cut += hunksCut ? 1 : 0;
  }
  assert.ok(whole > 0 && cut > 0, 'the sweep saw both');
});

test('D106 on (D105 review): a modified file shown whole while the change block\'s cap left its hunks out is seen whole '
  + 'as it is now, not as it was: its change is not seen, the coverage stays partial, and the readers say so', async () => {
  // Every line of a 5,000-line file changed: its hunks (each line removed and added) are over the change block's cap,
  // while the file now fits the whole files block.
  const n = 5_000;
  const before = linesOf('every', n), after = linesOf('EVERY', n);
  const rows = (text, mark) => text.split('\n').slice(0, -1).map((line) => `${mark}${line}`);
  const patch = ['diff --git a/src/all.js b/src/all.js', 'index 1111111..2222222 100644', '--- a/src/all.js',
    '+++ b/src/all.js', `@@ -1,${n} +1,${n} @@`, ...rows(before, '-'), ...rows(after, '+'), ''].join('\n');
  const f = fixture({ files: { 'src/all.js': after }, modified: { 'src/all.js': { text: before, at: 1 } },
    patches: { 'src/all.js': patch }, rules: null });
  // Off (part A): the change block clips its hunks; read whole as it is now, it is not seen as it was.
  const readWhole = { numTurns: 2, toolCalls: { Read: 1 }, reads: [`${ROOT}/src/all.js`],
    readRanges: [{ path: `${ROOT}/src/all.js`, startLine: 1, numLines: n, totalLines: n }], readsUnranged: 0,
    readsUnrangedPaths: [], readsFailed: [] };
  const off = (await runWith(f, agents({ run: readWhole }), { wholeFiles: false })).codePass;
  assert.deepEqual(off.manifest.review.files.map((x) => [x.path, x.state, x.reason, x.beforeUnshown]),
    [['src/all.js', 'left_out', 'block_cap', n]], 'the change block clips its hunks, every earlier row with them');
  assert.deepEqual([codeSeenOf(off).files[0].state, codeSeenOf(off).files[0].changeSeen, off.coverage],
    ['whole', false, 'partial']);
  // F3b (D111): the change block shows no line of the file, so the accounting quotes its first line from the repository.
  const account = accountsHoldWith({ path: 'src/all.js', side: 'new', startLine: 1, endLine: 1,
    quote: after.split('\n')[0] });
  const on = (await runWith(f, agents({ account }), { wholeFiles: true })).codePass;
  const [entry] = on.manifest.review.files;
  assert.deepEqual([entry.state, entry.shown, entry.beforeUnshown], ['whole', [[1, n]], n],
    'shown whole, with the rows its hunks hold on the earlier side that the request did not show');
  assert.deepEqual(codeSeenOf(on).files.map((x) => [x.path, x.state, x.changeSeen]), [['src/all.js', 'whole', false]]);
  assert.deepEqual([on.footer, on.coverage], [[], 'partial']);
  assert.deepEqual(codeSeenLines(on), [CODE_REPORT_WORDS.wholeNotBefore(['src/all.js'])]);
  // Shown whole with its hunks too (no cap reached): the earlier side shown, its change seen.
  const small = changedAt('small', 40, 9);
  const g = fixture({ files: { 'src/s.js': small.after }, modified: { 'src/s.js': { text: small.before, at: small.at } },
    rules: null });
  const both = (await runWith(g, agents(), { wholeFiles: true })).codePass;
  assert.deepEqual(both.manifest.review.files.map((x) => [x.state, x.beforeUnshown]), [['whole', 0]]);
  assert.deepEqual([codeSeenOf(both).files[0].changeSeen, both.coverage], [true, 'complete']);
});

test('D106 on: when the reads block shows no line, it says why — Sonah could not read where the session started, or '
  + 'what Sonah found — and never that the session read nothing', async () => {
  for (const words of Object.values(READS_NONE_WORDS))
    assert.ok(!/read no line/.test(words) && words.startsWith('('), words);
  // No start commit (the change is the recorded edits): a typed read of a tracked file that did not change.
  const text = linesOf('alpha', 3);
  const f = fixture({ files: { 'src/a.js': text }, reads: [{ path: 'lib/util.js', window: [1, 5] }], ...REPO });
  const plan = codeSnapshotPlan(f.session, { root: ROOT });
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => ({ path: entry.path, bytes: enc(text) })),
    { base: { kind: 'recorded_edits' } });
  const repo = { ...f.repo, base: () => null };
  const seen = [];
  await runCodePass({ report: f.report, session: f.session, snapshot, repo, judge: agents({ seen }), bound: Infinity,
    base: { kind: 'recorded_edits' }, root: ROOT, wholeFiles: true });
  const reads = (prompt) => prompt.slice(prompt.indexOf(READS_HEADING), prompt.indexOf('# Sonah\'s review of the session'));
  assert.ok(reads(seen[0].prompt).includes(READS_NONE_WORDS.recorded_edits), 'no start commit: said so');
  assert.ok(!reads(seen[0].prompt).includes(READS_NONE_WORDS.git));
  // A start commit, and the only read is of the rule file the rules block shows whole: what Sonah found.
  const g = [];
  await runWith(fixture({ ...CHANGE, reads: [{ path: 'CLAUDE.md' }] }), agents({ seen: g }), { wholeFiles: true });
  assert.ok(reads(g[0].prompt).includes(READS_NONE_WORDS.git));
  assert.ok(!reads(g[0].prompt).includes(READS_NONE_WORDS.recorded_edits));
  // The planner told nothing of a start commit claims none.
  const inputs = { words: { asked: [ASK] }, files: f.snapshot, where: { root: ROOT, top: null }, wholeFiles: true };
  assert.ok(planReviewRequest(inputs).request.prompt.includes(READS_NONE_WORDS.recorded_edits));
  assert.ok(planReviewRequest({ ...inputs, startCommit: true }).request.prompt.includes(READS_NONE_WORDS.git));
});

test('D106 on: a receipt in a range the session read that the request left out for room counts outside', async () => {
  const small = SMALL.split('\n');
  const finding = { kind: 'contract_break', lens: 'contracts', title: 'SYNTHETIC: the helper relies on the old line',
    claims: [], input: 'SYNTHETIC input', trace: [
      { step: 'The helper.', path: 'lib/small.js', side: 'new', startLine: 5, endLine: 5, quote: small[4] },
      { step: 'The change.', path: 'src/c.js', side: 'new', startLine: 30, endLine: 30, quote: 'GAMMA 00030' }],
    anchor: { path: 'src/c.js', side: 'new', startLine: 30, endLine: 30 }, leadsFrom: [] };
  const run = async (bound) => {
    const seen = [];
    const { codePass } = await runWith(full(), agents({ seen, review: () => ({ findings: [finding], questions: [] }) }),
      { bound, wholeFiles: true });
    return { codePass, request: seen.find((r) => r.label === 'code-review:agent') };
  };
  const top = await run(Infinity);
  assert.deepEqual(top.codePass.receiptPlaces, { inside: 2, outside: 0, unknown: 0 });
  const short = await run(reviewInputBytes(top.request) - 1);
  const entry = short.codePass.manifest.review.reads.find((r) => r.path === 'lib/small.js');
  assert.deepEqual([entry.read, entry.shown, entry.leftOut], [[[1, 12]], [], [{ lines: [1, 12], reason: 'request_bound' }]]);
  assert.deepEqual(short.codePass.receiptPlaces, { inside: 1, outside: 1, unknown: 0 }, 'read, not shown: outside');
});

test('D106 on: a readable changed file whose diff cannot be read is not shown whole; the brief says such a file is not '
  + 'in the whole files block, and that the review opens it', async () => {
  const D = changedAt('delta', 30, 12);
  const good = modifiedPatch('src/d.js', D.before, D.after, D.at);
  const f = fixture({ files: { ...CHANGE.files, 'src/d.js': D.after },
    modified: { ...CHANGE.modified, 'src/d.js': { text: D.before, at: D.at } },
    patches: { 'src/d.js': good.replace('+DELTA 00012', '+DELTA 99999') } });
  const seen = [];
  const { codePass } = await runWith(f, agents({ seen }), { wholeFiles: true });
  const entry = codePass.manifest.review.files.find((x) => x.path === 'src/d.js');
  assert.deepEqual([entry.state, entry.reason], ['not_shown', 'unreadable']);
  const { prompt, system } = seen[0];
  const block = prompt.slice(prompt.indexOf(WHOLE_HEADING), prompt.indexOf(READS_HEADING));
  assert.ok(!block.includes('"path":"src/d.js"') && !block.includes('delta 00001'), 'not shown whole');
  assert.ok(block.includes('"path":"src/c.js"'), 'the readable files beside it are');
  const flat = (text) => text.replace(/\s+/g, ' ');
  assert.ok(!flat(system).includes('(a file not shown whole is named, with its line count)'));
  assert.ok(!flat(system).includes('the changed files are given whole in this request;'));
  assert.ok(flat(system).includes('a file whose hunks the change cannot show is not there'));
  assert.ok(flat(system).includes('but for a file it says is not shown whole or whose hunks it does not show: open '
    + 'those'));
});

test('D106 on: a typed read counts only by its first terminal result, of one path, from line 1 at the least', () => {
  const f = fixture({ ...CHANGE, ...REPO, reads: [
    { path: 'lib/util.js', input: { offset: 2, limit: 2 }, results: ['failed', 'ok'] },
    { path: 'lib/small.js', input: { offset: 4, limit: 2 }, results: ['ok', 'failed'] },
    { path: 'lib/search.js', window: [1, 3], also: 'lib/failed.js' },
    { path: 'lib/refused.js', input: { offset: 0, limit: 3 } },
    { path: 'lib/noresult.js', input: { offset: -5, limit: 2 } }] });
  assert.deepEqual(sessionReadsOf(f.session, { root: ROOT, repo: f.repo }).map((r) => [r.path, r.read]),
    [['lib/noresult.js', [[1, 2]]], ['lib/refused.js', [[1, 3]]], ['lib/small.js', [[4, 5]]]]);
});

test('D106 on: a rule file shown whole is not shown again among the reads, however the session spelled its path',
  () => {
  const app = `${ROOT}/app`;
  const rules = [{ kind: 'project', path: '../CLAUDE.md', text: RULES, actor: 'person' }];
  const read = (path) => ({ path, lines: 1, read: [[1, 1]], text: `${RULES}\n` });
  const f = fixture({ ...CHANGE });
  for (const spelled of [`${ROOT}/CLAUDE.md`, '../CLAUDE.md']) {
    const plan = planReviewRequest({ words: { asked: [ASK] }, projectFiles: rules, files: f.snapshot,
      where: { root: app, top: ROOT }, wholeFiles: true, startCommit: true, sessionReads: [read(spelled)] });
    assert.deepEqual(plan.manifest.reads, [], spelled);
    assert.ok(plan.request.prompt.includes(READS_NONE_WORDS.git), spelled);
  }
  // A file the rules block does not show is still shown among the reads.
  const other = planReviewRequest({ words: { asked: [ASK] }, projectFiles: rules, files: f.snapshot,
    where: { root: app, top: ROOT }, wholeFiles: true, startCommit: true, sessionReads: [read(`${ROOT}/OTHER.md`)] });
  assert.deepEqual(other.manifest.reads.map((r) => r.path), [`${ROOT}/OTHER.md`]);
});

test('D106 on: with no file to show whole, the whole files block says what is true of each changed file; over the '
  + 'bound part B\'s frame gives way before a hunk does, so those words never stand beside hunks left out for room '
  + '(D108 review)', () => {
  const f = fixture({ files: { 'src/a.js': linesOf('alpha', 200) }, rules: null });
  const inputs = { words: { asked: [ASK] }, files: f.snapshot, where: { root: ROOT, top: null }, wholeFiles: true,
    startCommit: true };
  const all = planReviewRequest(inputs);
  assert.ok(all.request.prompt.includes(WHOLE_NONE_WORDS.none), 'its hunks hold every line of it');
  // One byte under: part B's frame gives way whole, and the request is part A's, its hunks shown.
  const under = planReviewRequest({ ...inputs, bound: all.manifest.bytes.total - 1 });
  const offInputs = { ...inputs, wholeFiles: false };
  assert.deepEqual(under.request, planReviewRequest({ ...offInputs, bound: all.manifest.bytes.total - 1 }).request);
  assert.deepEqual(under.manifest.files.map((x) => [x.path, x.state, x.reason ?? null]), [['src/a.js', 'whole', null]]);
  assert.ok(!under.request.prompt.includes(WHOLE_HEADING) && !under.request.prompt.includes(WHOLE_NONE_WORDS.none));
  // Under part A's own size: its hunks are left out for room, in part A's request, with no whole files block.
  const offAll = planReviewRequest(offInputs).manifest.bytes.total;
  const cut = planReviewRequest({ ...inputs, bound: offAll - 1 });
  assert.deepEqual(cut.manifest.files.map((x) => [x.path, x.state, x.reason]), [['src/a.js', 'left_out',
    'request_bound']], 'its hunks, which hold every line of it, are left out for room');
  assert.deepEqual(cut.request, planReviewRequest({ ...offInputs, bound: offAll - 1 }).request);
  assert.ok(!cut.request.prompt.includes(WHOLE_NONE_WORDS.none));
  // The words speak of the file's hunks, which hold every line it has now, not of what the change block shows.
  assert.ok(WHOLE_NONE_WORDS.none.includes('each changed file has every line it has now in its hunks, or its hunks '
    + 'cannot be shown and the change above says why'));
  assert.ok(!WHOLE_NONE_WORDS.none.includes('the change above holds'));
});

test('D106 on (D108 review): part B\'s frame — its brief and its two blocks\' headings and words — gives way as one unit '
  + 'after the two blocks: part B never leaves out a unit part A shows, never makes a review too large to send that part '
  + 'A sends, and shows the checking agents part A\'s change', async () => {
  const util = UTIL.split('\n');
  const finding = { kind: 'contract_break', lens: 'contracts', title: 'SYNTHETIC: the caller relies on the old line',
    claims: [], input: 'SYNTHETIC input', trace: [
      { step: 'The caller.', path: 'lib/util.js', side: 'new', startLine: 12, endLine: 12, quote: util[11] },
      { step: 'The change.', path: 'src/c.js', side: 'new', startLine: 30, endLine: 30, quote: 'GAMMA 00030' }],
    anchor: { path: 'src/c.js', side: 'new', startLine: 30, endLine: 30 }, leadsFrom: [] };
  const commands = Array.from({ length: 20 }, (_, i) => `npm test -- --grep case-${String(i + 1).padStart(2, '0')}`);
  let bands = 0;
  for (const [f, step] of [[full(), 53], [full({ commands, rules: linesOf('rule', 120) }), 211]]) {
    const at = async (bound, wholeFiles) => {
      const seen = [];
      const { codePass } = await runWith(f, agents({ seen, review: () => ({ findings: [finding], questions: [] }) }),
        { bound, wholeFiles });
      const label = (name) => seen.find((r) => r.label === name) ?? null;
      return { review: label('code-review:agent'), check: label('code-verify:F1'), manifest: codePass.manifest.review };
    };
    const top = reviewInputBytes((await at(Infinity, true)).review);
    for (let bound = top + step; bound > 0; bound -= step) {
      const [a, b] = [await at(bound, false), await at(bound, true)];
      assert.equal(b.review === null, a.review === null, `${bound}: too large to send only when part A is`);
      if (a.review === null) continue;
      assert.ok(reviewInputBytes(b.review) <= bound, `${bound}`);
      // The checking agents are shown part A's change.
      assert.deepEqual(b.check, a.check, `${bound}: the checker's request is part A's`);
      // No unit of part A's blocks gives way while part B shows anything: its commands and rule files as part A's.
      assert.deepEqual([b.manifest.commands, b.manifest.rules], [a.manifest.commands, a.manifest.rules], `${bound}`);
      // Once part A leaves a unit out, part B's frame is gone: the request is part A's byte for byte, and the manifest
      // still says what part B left out.
      const aCut = a.manifest.commands.from > 1 || a.manifest.rules.some((x) => x.state === 'left_out')
        || a.manifest.files.some((x) => x.state === 'left_out' && x.reason === 'request_bound');
      if (aCut) {
        bands++;
        assert.deepEqual(b.review, a.review, `${bound}: part A's request`);
        assert.ok(b.manifest.reads.every((r) => r.state === 'left_out'), `${bound}: the reads named as left out`);
        assert.ok(b.manifest.files.every((x) => x.state !== 'hunks_only' || x.reason === 'request_bound'), `${bound}`);
      }
    }
  }
  assert.ok(bands > 0, 'the sweep reached bounds where part A leaves units out');
});
