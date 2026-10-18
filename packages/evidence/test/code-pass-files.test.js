// D96, D97 (code-pass/10): what the code step's record adds for the report's readers — each shown file's added and
// removed lines (the rows of its hunks), the review agent's note on what the change does in each file and which asks it
// serves (checked by code, a slip named only in a repair a failing finding or question asks for and dropped with its
// cause), and each published finding's anchor lines as the step read
// them (bounded, the cut counted), with the file's hash and the lines the change touched.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, fileNoteShape, ANCHOR_SPAN_LIMITS } from '../src/code-pass.js';
import { TRIAGE_LIMITS } from '../src/triage.js';
import { CODE_FILES, CODE_TEXT, codeSession, buildCodeSession, reviewFinding, holds, allSound, verifiedFinding,
  batchItems, accountsHold } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const RECORDED = { kind: 'recorded_edits' };
const ROOT = '/work/repo';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');
/** An untracked file git diffs from nothing: two lines added. */
const ADDED_TEXT = 'export const one = 1;\nexport const two = 2;\n';
const ADDED_PATCH = ['diff --git a/src/added.js b/src/added.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/added.js', '@@ -0,0 +1,2 @@', '+export const one = 1;', '+export const two = 2;', ''].join('\n');

/** A snapshot with a git base: parse.js modified (git's patch), and `added` an untracked file git diffs from nothing. */
function gitSnapshot(session = codeSession(), { added = false, binary = false } = {}) {
  const plan = [...codeSnapshotPlan(session)];
  const extra = [...(added ? ['src/added.js'] : []), ...(binary ? ['logo.png'] : [])];
  for (const path of extra) plan.push({ path, recordedPath: path, changed: true, recorded: false, outside: false,
    last: null, edits: [] });
  const reads = plan.map((entry) => {
    if (entry.path === 'src/parse.js') return { path: entry.path, bytes: enc(CODE_FILES['src/parse.js']), type: 'modified',
      base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH };
    if (entry.path === 'src/added.js') return { path: entry.path, bytes: enc(ADDED_TEXT), type: 'added', patch: ADDED_PATCH };
    if (entry.path === 'logo.png') return { path: entry.path, bytes: new Uint8Array([0, 1, 2]), type: 'added',
      patch: null };
    return { path: entry.path, state: 'deleted' };
  });
  return freezeCodeSnapshot(plan, reads, { base: GIT });
}
const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
const repoOf = (now) => ({ root: ROOT, top: ROOT,
  read: (path) => (Object.hasOwn(now, named(path)) ? { path: named(path), text: now[named(path)],
    sha256: sha(enc(now[named(path)])) } : null),
  base: (path) => (named(path) === 'src/parse.js' ? { path: 'src/parse.js', text: BASE_PARSE, sha256: sha(enc(BASE_PARSE)) }
    : null) });

const R = (eventId, role, quote) => ({ eventId, role, quote });
/** The session review's rows: S1 an ask partly done, S2 a claim not checked. */
const report = () => ({ repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [],
  promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: R('C1', 'commentary', 'parse now returns an empty list'),
    text: 'SYNTHETIC claim', status: 'open', receipts: [] }],
  requirements: [{ text: 'Return [] for empty input.', instruction: R('I1', 'instruction', 'add a parse function'),
    status: 'partly-done' }], decisions: [], failures: [], writtenClaims: [] });

function agents({ review, repair = null, seen = [] }) {
  return async (request) => {
    // F3b (D111): an accounting agent's request answers every item as holding, and stays out of `seen`: this file
    // reads the review's requests and its checks' (d111-accounting.test.js reads the accounting's).
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return accountsHold(request.prompt);
    seen.push(request);
    if (request.label === 'code-review:agent') return review(request.prompt, request);
    if (request.label === 'code-review:repair') return repair ? repair(request) : review(request.prompt, request);
    if (/^code-verify:F\d+(:reask)?$/.test(request.label)) return holds(verifiedFinding(request.prompt));
    if (/^code-verify:batch(:reask)?$/.test(request.label)) return allSound(batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
}
const run = (judge, { session = codeSession(), snapshot = gitSnapshot(session), now = CODE_FILES, base = GIT } = {}) =>
  runCodePass({ report: report(), session, snapshot, repo: repoOf(now), bound: 1_620_000, judge, base, root: ROOT });
const rowsOf = (snapshot, path, type) => snapshot.find((f) => f.path === path).hunks.flatMap((h) => h.rows)
  .filter((r) => r.type === type).length;

// ---- added and removed lines ------------------------------------------------------------------------------------------

test('files: a shown file\'s added and removed lines are the + and - rows of its hunks from the start commit', async () => {
  const snapshot = gitSnapshot(codeSession(), { added: true, binary: true });
  const result = await run(agents({ review: () => ({ findings: [], questions: [] }) }), { snapshot,
    now: { ...CODE_FILES, 'src/added.js': ADDED_TEXT } });
  const byPath = Object.fromEntries(result.codePass.files.map((f) => [f.path, f]));
  assert.deepEqual([byPath['src/parse.js'].added, byPath['src/parse.js'].removed],
    [rowsOf(snapshot, 'src/parse.js', '+'), rowsOf(snapshot, 'src/parse.js', '-')]);
  assert.deepEqual([byPath['src/parse.js'].added, byPath['src/parse.js'].removed], [1, 1]);
  assert.deepEqual([byPath['src/added.js'].added, byPath['src/added.js'].removed], [2, 0]);
  // A file whose hunks are not shown (binary: no line of it is in the change) has no counts.
  assert.equal(byPath['logo.png'].state, 'binary');
  assert.ok(!Object.hasOwn(byPath['logo.png'], 'added') && !Object.hasOwn(byPath['logo.png'], 'removed'));
  // With no git base the hunks are the recorded edits, not the change from the start commit: no counts.
  const plan = codeSnapshotPlan(codeSession());
  const recorded = freezeCodeSnapshot(plan, plan.map((e) => ({ path: e.path, bytes: enc(CODE_FILES[e.path]) })),
    { base: RECORDED });
  const noGit = await run(agents({ review: () => ({ findings: [], questions: [] }) }), { snapshot: recorded,
    base: RECORDED });
  assert.equal(noGit.codePass.files[0].state, 'shown');
  assert.ok(!Object.hasOwn(noGit.codePass.files[0], 'added'));
});

// ---- the review agent's file notes ----------------------------------------------------------------------------------

test('files: a note for a file of the change is kept with the asks it serves; one for another path, an unknown ask or a repeated path is dropped with its cause', async () => {
  const note = (path, over = {}) => ({ path, what: 'Splits the input on commas', asks: ['S1'], ...over });
  const seen = [];
  const files = [note('src/parse.js'), note('src/other.js'), note('src/parse.js', { what: 'Again' }),
    note('src/added.js', { asks: ['S2'] }), note('src/added.js', { what: 'x'.repeat(TRIAGE_LIMITS.fileChars + 1) })];
  // A question whose quote is in no item's words asks for the one repair; the notes' faults ride on it.
  const question = { question: 'SYNTHETIC is the split right?', key: 'S1', quote: 'SYNTHETIC words no item shows' };
  const result = await run(agents({ seen, review: () => ({ findings: [], questions: [question], triage: [], files }) }),
    { snapshot: gitSnapshot(codeSession(), { added: true }), now: { ...CODE_FILES, 'src/added.js': ADDED_TEXT } });
  const parse = result.codePass.files.find((f) => f.path === 'src/parse.js');
  assert.deepEqual([parse.what, parse.asks], ['Splits the input on commas',
    [{ source: 'requirements', index: 0, id: null }]]);
  assert.ok(!Object.hasOwn(result.codePass.files.find((f) => f.path === 'src/added.js'), 'what'));
  assert.deepEqual(result.codePass.filesDropped, [{ key: 'src/other.js', index: 1, cause: 'file_not_in_change' },
    { key: 'src/parse.js', index: 2, cause: 'triage_key_repeated' },
    { key: 'src/added.js', index: 3, cause: 'triage_key_unknown' },
    { key: 'src/added.js', index: 4, cause: 'text_over_limit' }]);
  // Each is named in the question's repair; the triage list was given (empty): no cause for it.
  const repair = seen.find((r) => r.label === 'code-review:repair').prompt;
  assert.match(repair, /^- questions\[0\]: /m);
  assert.match(repair, /^- files\[1\]: file_not_in_change \(the path is no file of the change\) at files\[1\]\.path "src\/other\.js"$/m);
  assert.match(repair, /^- files\[3\]: triage_key_unknown .* at files\[3\]\.asks "S2"$/m);
  assert.match(repair, /^- files\[4\]: text_over_limit .* at files\[4\]\.what$/m);
  assert.deepEqual(result.codePass.triageDropped, []);
  // With no question to repair, the same notes ask for no call and are dropped with the same causes.
  const alone = [];
  const unasked = await run(agents({ seen: alone, review: () => ({ findings: [], questions: [], triage: [], files }) }),
    { snapshot: gitSnapshot(codeSession(), { added: true }), now: { ...CODE_FILES, 'src/added.js': ADDED_TEXT } });
  assert.deepEqual(alone.map((r) => r.label), ['code-review:agent']);
  assert.deepEqual(unasked.codePass.filesDropped, result.codePass.filesDropped);
  // A note with no asks of yours: kept, `asks` empty.
  const plain = await run(agents({ review: () => ({ findings: [], questions: [], files: [note('src/parse.js',
    { asks: [] })] }) }));
  assert.deepEqual(plain.codePass.files[0].asks, []);
  // The shape check alone: a path of the change, a non-blank note, asks a list of dossier ask keys, each once.
  const paths = new Set(['src/parse.js']);
  const dossier = new Map([['S1', { kind: 'ask' }], ['S2', { kind: 'claim' }]]);
  assert.deepEqual(fileNoteShape(note('src/parse.js'), { paths, dossier }), { ok: true });
  assert.equal(fileNoteShape({ ...note('src/parse.js'), extra: 1 }, { paths, dossier }).error, 'key_outside_contract');
  assert.equal(fileNoteShape(note('src/parse.js', { what: '  ' }), { paths, dossier }).error, 'text_over_limit');
  assert.equal(fileNoteShape(note('src/parse.js', { asks: ['S1', 'S1'] }), { paths, dossier }).error, 'value_outside_list');
  assert.equal(fileNoteShape(note('src/parse.js', { asks: 'S1' }), { paths, dossier }).error, 'value_outside_list');
});

test('files: notes past the runaway guard are dropped unchecked, in their order', async () => {
  const files = Array.from({ length: TRIAGE_LIMITS.files + 2 }, (_, k) => ({ path: k === 0 ? 'src/parse.js' : `x${k}.js`,
    what: 'SYNTHETIC', asks: [] }));
  const result = await run(agents({ review: () => ({ findings: [], questions: [], triage: [], files }) }));
  const causes = result.codePass.filesDropped.map((d) => [d.index, d.cause]);
  assert.equal(causes.length, TRIAGE_LIMITS.files + 1);
  assert.deepEqual(causes.slice(-2), [[TRIAGE_LIMITS.files, 'text_over_limit'], [TRIAGE_LIMITS.files + 1, 'text_over_limit']]);
  assert.ok(causes.slice(0, -2).every(([, cause]) => cause === 'file_not_in_change'));
  assert.equal(result.codePass.files[0].what, 'SYNTHETIC');
});

// ---- the anchor as read ------------------------------------------------------------------------------------------------

test('anchor: a published finding keeps its anchor\'s lines as read — at most 12, each at most 160 characters, the cut counted — the file\'s hash and the lines the change touched', async () => {
  assert.deepEqual(ANCHOR_SPAN_LIMITS, { lines: 12, lineChars: 160 });
  const long = `  const long = "${'y'.repeat(200)}";`;
  const LINES = Array.from({ length: 15 }, (_, k) => (k === 4 ? long : `  const line${k + 1} = ${k + 1};`));
  const BODY = ['export function many() {', ...LINES, '}', ''].join('\n');
  const session = buildCodeSession('s-anchor', { ...CODE_TEXT, body: BODY }, [
    { id: 'I1', kind: 'instruction', blob: 'ask' },
    { id: 'W1', kind: 'invocation', write: 'src/many.js', blob: 'body' },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote' },
  ]);
  const now = { 'src/many.js': BODY };
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, [{ path: 'src/many.js', bytes: enc(BODY) }], { base: RECORDED });
  const finding = reviewFinding({ title: 'SYNTHETIC many lines', trace: [{ step: 'SYNTHETIC', path: 'src/many.js',
    side: 'new', startLine: 3, endLine: 3, quote: 'const line2 = 2;' }],
  anchor: { path: 'src/many.js', side: 'new', startLine: 2, endLine: 16 } });
  const result = await run(agents({ review: () => ({ findings: [finding], questions: [] }) }), { session, snapshot, now,
    base: RECORDED });
  const [published] = result.codePass.findings;
  assert.ok(published, JSON.stringify(result.codePass.withheld));
  const kept = LINES.slice(0, 12).map((line) => (line === long ? line.slice(0, 160) : line));
  assert.deepEqual(published.anchorSpan, { startLine: 2, lines: kept, linesCut: 3, charsCut: long.length - 160 });
  assert.equal(published.anchorSha256, sha(enc(BODY)));
  assert.equal(published.anchorSha256, result.codePass.files.find((f) => f.path === 'src/many.js').sha256);
  // The whole file is the session's write: every kept line is a changed one.
  assert.deepEqual(published.anchorChanged, Array.from({ length: 12 }, (_, k) => k + 2));
  // On a git base, only the lines the change touched: parse.js line 2 of an anchor over lines 1-3.
  const git = await run(agents({ review: () => ({ findings: [reviewFinding({ anchor: { path: 'src/parse.js', side: 'new',
    startLine: 1, endLine: 3 } })], questions: [] }) }));
  assert.deepEqual(git.codePass.findings[0].anchorSpan, { startLine: 1, lines: CODE_FILES['src/parse.js'].split('\n')
    .slice(0, 3), linesCut: 0, charsCut: 0 });
  assert.deepEqual(git.codePass.findings[0].anchorChanged, [2]);
  // An anchor on the side before the session reads the start commit's file, and its hash.
  const before = await run(agents({ review: () => ({ findings: [reviewFinding({ kind: 'contract_break', lens: 'contracts',
    trace: [{ step: 'SYNTHETIC it split on semicolons', path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2,
      quote: 'const parts = input.split(";");' }, ...reviewFinding().trace],
    anchor: { path: 'src/parse.js', side: 'old', startLine: 2, endLine: 2 } })], questions: [] }) }));
  const [old] = before.codePass.findings;
  assert.ok(old, JSON.stringify(before.codePass.withheld));
  assert.deepEqual([old.anchorSpan.lines, old.anchorSha256, old.anchorChanged],
    [['  const parts = input.split(";");'], sha(enc(BASE_PARSE)), [2]]);
});
