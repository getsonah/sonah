// M29 — a reviewed diff cannot recover the body of an earlier unrecorded write by path alone.
//
// W3c-8 declared every write whose body the recording does not contain (`unrecorded_body`) and
// let it cap session coverage. A later path-only diff review used to clear that cap, but a later
// write can replace the missing historical body. Every unrecorded write stays declared and
// counted. It caps session coverage unless verified head equivalence exists —
//
//   a path outside the repository (the recorder marked it external)              → not code under review
//   a repository path, even if its PR diff was placed and complete              → caps
//
// Every byte here is synthetic: invented paths, invented code, invented session text. No model,
// no provider, no recording is read. Recordings are written to a temp directory and deleted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runReview } from '../src/run-review.js';
import { runCodeReview } from '../src/code-review.js';
import { honestStatuses, unrecordedCover, UNRECORDED_COVER } from '../src/ledger.js';
// M33 (C-06 "M33 session verdict"): the reviews below COMPLETE — every window answered, challenged
// and grounded — and their coverage is partial only by a recorder limit the adapter declared (a
// capture, redaction, outcome, child or pair gap). That reads NO_FINDINGS: never CLEAN, always
// shown with the partial coverage and its causes. Before M33 it read UNCHECKED, which now means
// the review itself did not complete.
const RECORDER_LIMITED = 'NO_FINDINGS';
import { renderReview, coverageCauses, UNRECORDED_COVER_SENTENCE } from '../src/review.js';

const repo = { host: 'github.com', id: '10' };
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

// ---- a recording, through the production pair `sonah review` runs -----------------------------

let seq = 0;
const uid = () => `w3c10-${String(++seq).padStart(6, '0')}`;
// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human prompts carry the host's typed origin; a
// 2.1.205 recording is labelled by the declared legacy fallback, every row of it a counted gap.
const base = { sessionId: 'sess-w3c10-raw', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), origin: { kind: 'human' },
  message: { role: 'user', content: text } });
const said = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  // These scenarios isolate missing write BODIES. A native zero exit code prevents an unrelated
  // unknown command status from limiting their otherwise complete synthetic session.
  toolUseResult: { exit_code: 0 } });
const call = (id, name, input, result) => [toolUse(id, name, input), toolResult(id, result)];

async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'w3c10-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    return sessionFromLedger(ledger, { sessionKey: 'w3c10' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// W3c-8's realistic session: read, test, two Writes, an Edit, three routine shell writes, a
// MultiEdit and a final test run. `shell` replaces the three shell writes' commands.
const SHELL = {
  tee: 'node scripts/gen-docs.js | tee docs/api.md',
  sed: "sed -i 's/100/120/' src/config.js",
  // Through `tee`: since W3c-11 a `cat > path <<'EOF'` records its body (it is in the command), so
  // this fixture pipes the heredoc into `tee`, which stays a write with no recorded body.
  heredoc: "cat <<'EOF' | tee test/fixtures/orders.json\n[{\"id\": 1}]\nEOF",
};
function realisticSession(shell = SHELL) {
  return [
    userTurn('Add rate limiting to the orders API, with tests. Keep the existing middleware order.'),
    said('Reading the app entry point first.'),
    ...call('r1', 'Read', { file_path: '/repo/src/app.js' }, '     1\tconst app = express();\n     2\tapp.use(auth);'),
    ...call('b1', 'Bash', { command: 'npm test' }, 'Tests: 12 passed, 12 total'),
    ...call('w1', 'Write', { file_path: '/repo/src/middleware/rate-limit.js',
      content: 'export function rateLimit(opts) {\n  return (req, res, next) => next();\n}\n' }, 'File created successfully'),
    ...call('e1', 'Edit', { file_path: '/repo/src/app.js', old_string: 'app.use(auth);',
      new_string: 'app.use(auth);\napp.use(rateLimit({ max: 100 }));' }, 'The file has been updated.'),
    ...call('w2', 'Write', { file_path: '/repo/test/rate-limit.test.js', content: "test('limits', () => {});\n" },
      'File created successfully'),
    ...call('b2', 'Bash', { command: shell.tee }, 'generated 4 pages'),
    ...call('b3', 'Bash', { command: shell.sed }, ''),
    ...call('b4', 'Bash', { command: shell.heredoc }, ''),
    ...call('m1', 'MultiEdit', { file_path: '/repo/README.md', edits: [
      { old_string: '## API', new_string: '## API\n\nRate limited.' }, { old_string: 'v1', new_string: 'v2' }] },
    'Applied 2 edits.'),
    ...call('b5', 'Bash', { command: 'npm test' }, 'Tests: 14 passed, 14 total'),
    said('Rate limiting is in place and the tests pass.'),
  ];
}

const STRUCTURED = ['src/middleware/rate-limit.js', 'src/app.js', 'test/rate-limit.test.js', 'README.md'];
const SHELL_TARGETS = ['docs/api.md', 'src/config.js', 'test/fixtures/orders.json'];

// ---- a frozen PR over exactly the files the test names ------------------------------------------

function modified(path, n) {
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n`
    + `@@ -1 +1 @@\n-SYNTHETIC_W3C10_OLD_${n}\n+SYNTHETIC_W3C10_NEW_${n}\n`;
}
/** `files` are PR paths; `withheld` are in the PR but redaction withheld their block (F23). */
function prOver(files, { withheld = [] } = {}) {
  const pr = { repo, number: 40, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
    gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [...files.map((path) => ({ path, change: 'modified', contentState: 'complete' })),
      ...withheld.map((path) => ({ path, change: 'modified', contentState: 'partial' }))] };
  return { pr, diff: files.map(modified).join('') };
}

/** Finds nothing, and reports exactly the files its request showed it. */
function honestJudge() {
  return async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [] })) };
    const shown = [...String(request.prompt).matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
    return { ...EMPTY, codeFindings: [], sessionFindings: [], reviewedFiles: shown };
  };
}

const unrecorded = (report) => (report.gaps ?? []).filter((g) => g.code === 'unrecorded_body');

// ---- 1. every shell write is to a PR file the code review placed ------------------------------

test('M29 placed diff cannot cover any missing historical shell body', async () => {
  const session = await throughProductionPath(realisticSession());
  const { pr, diff } = prOver([...STRUCTURED, ...SHELL_TARGETS]);
  const report = await runCodeReview({ session, pr, diff, judge: honestJudge() });

  for (const path of SHELL_TARGETS)
    assert.ok(report.codeCoverageFacts.placed.includes(path), `${path} was placed in an answered request`);
  const [gap] = unrecorded(report);
  assert.ok(gap, 'the three writes are still declared');
  assert.equal(gap.count, 3);
  assert.deepEqual(gap.writes.map((w) => w.path), SHELL_TARGETS, 'each declared write names its path');
  assert.deepEqual(unrecordedCover(gap, { pr, placed: report.codeCoverageFacts.placed }).byCover,
    { diff: 0, outside: 0, none: 3 });

  assert.equal(report.coverage, 'partial', 'a diff does not prove each piped shell write completed');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.reviewStatus, RECORDER_LIMITED);
  assert.deepEqual(coverageCauses(report), [['unrecorded_body', { n: 3 }],
    ['write_outcome_unknown', { n: 2 }]],
  'missing historical bodies and the two unproved outcomes both cap');

  const md = renderReview(report);
  // D71 (a): rendered, a completed session review over the recorder's limits — never a status.
  assert.ok(md.includes('Session review: **complete**') && !md.includes('NO_FINDINGS'));
  assert.ok(md.includes('- `unrecorded_body`'), 'the covered writes stay listed under what was not checked');
  assert.ok(md.includes(`  - 3 ${UNRECORDED_COVER_SENTENCE.none}.`), 'and counted as unreviewed');
  assert.ok(!md.includes(UNRECORDED_COVER_SENTENCE.diff));
  // The published verdict and a re-render agree: the renderer recomputes from the same facts.
  assert.equal(honestStatuses(report).reviewStatus, RECORDER_LIMITED);
});

// ---- 2. one of them is to a repository file the PR does not contain -----------------------------

test('W3c-10 one shell write to a repository file not in the PR caps the session: NO_FINDINGS, never CLEAN', async () => {
  const session = await throughProductionPath(realisticSession());
  const inPr = SHELL_TARGETS.filter((p) => p !== 'src/config.js');
  const { pr, diff } = prOver([...STRUCTURED, ...inPr]);
  const report = await runCodeReview({ session, pr, diff, judge: honestJudge() });

  assert.equal(report.codeCoverage, 'complete', 'the code review read every file the PR has');
  const [gap] = unrecorded(report);
  assert.deepEqual(unrecordedCover(gap, { pr, placed: report.codeCoverageFacts.placed }).byCover,
    { diff: 0, outside: 0, none: 3 });
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  assert.equal(report.reviewStatus, RECORDER_LIMITED);
  assert.deepEqual(coverageCauses(report), [['unrecorded_body', { n: 3 }],
    ['write_outcome_unknown', { n: 2 }]], 'the header counts distinct body and outcome losses');

  const md = renderReview(report);
  assert.ok(md.includes('Not covered: 3 write(s) have no recorded body'));
  assert.ok(md.includes(`  - 3 ${UNRECORDED_COVER_SENTENCE.none}.`));
});

// ---- 3. one of them is to a path outside the repository ---------------------------------------

test('W3c-10 a shell write to /tmp is listed as outside the repository and does not cap', async () => {
  const session = await throughProductionPath(realisticSession({ ...SHELL, sed: "sed -i 's/100/120/' /tmp/scratch.js" }));
  const [adapterGap] = (session.adapterGaps ?? []).filter((g) => g.code === 'unrecorded_body');
  const outside = adapterGap.writes.filter((w) => w.outsideRepository);
  assert.equal(outside.length, 1, 'the recorder marked the /tmp write as outside the repository');

  const targets = SHELL_TARGETS.filter((p) => p !== 'src/config.js');
  const { pr, diff } = prOver([...STRUCTURED, ...targets]);
  const report = await runCodeReview({ session, pr, diff, judge: honestJudge() });
  const [gap] = unrecorded(report);
  assert.equal(gap.count, 3, 'still declared and counted');
  assert.deepEqual(unrecordedCover(gap, { pr, placed: report.codeCoverageFacts.placed }).byCover,
    { diff: 0, outside: 1, none: 2 });
  assert.equal(report.coverage, 'partial', 'the two internal piped writes still lack outcomes');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  assert.equal(report.reviewStatus, RECORDER_LIMITED);

  const md = renderReview(report);
  assert.ok(md.includes(`  - 1 ${UNRECORDED_COVER_SENTENCE.outside}.`));
  assert.ok(md.includes(`  - 2 ${UNRECORDED_COVER_SENTENCE.none}.`));
});

test('W3c-10 an outside-the-repository write does not cap even with no code review at all', async () => {
  const session = await throughProductionPath([
    userTurn('Keep a scratch copy of the config while you work.'),
    ...call('b1', 'Bash', { command: 'npm test' }, 'Tests: 1 passed, 1 total'),
    ...call('b2', 'Bash', { command: "sed -i 's/1/2/' /tmp/scratch.js" }, ''),
  ]);
  const report = await runReview({ session, pr: prOver(['src/app.js']).pr, judge: async (request) =>
    request.challenge ? { votes: [] } : EMPTY });
  assert.deepEqual(unrecorded(report).map((g) => g.count), [1]);
  assert.equal(report.coverage, 'complete', 'an outside write needs no placement to be not-capping');
  assert.equal(report.sessionStatus, 'CLEAN');
});

// ---- 4. a PR file that redaction withheld, so the code review never placed it -------------------

test('W3c-10 a shell write to a PR file withheld by redaction (not placed) caps', async () => {
  const session = await throughProductionPath(realisticSession());
  const placedTargets = SHELL_TARGETS.filter((p) => p !== 'src/config.js');
  const { pr, diff } = prOver([...STRUCTURED, ...placedTargets], { withheld: ['src/config.js'] });
  const report = await runCodeReview({ session, pr, diff, judge: honestJudge() });

  assert.ok(!report.codeCoverageFacts.placed.includes('src/config.js'), 'the withheld file was never placed');
  const [gap] = unrecorded(report);
  assert.deepEqual(unrecordedCover(gap, { pr, placed: report.codeCoverageFacts.placed }).byCover,
    { diff: 0, outside: 0, none: 3 });
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  // The withheld file leaves the CODE review partial (UNCHECKED), which outranks NO_FINDINGS.
  assert.equal(report.reviewStatus, 'UNCHECKED');
});

test('M29 neither partial nor complete PR placement proves historical body equivalence', () => {
  const gap = { code: 'unrecorded_body', channel: 'code', scope: 'session', count: 1,
    writes: [{ eventId: 'A1-3', path: 'src/config.js', outsideRepository: false }] };
  const pr = { files: [{ path: 'src/config.js', change: 'modified', contentState: 'partial' }] };
  assert.deepEqual(unrecordedCover(gap, { pr, placed: ['src/config.js'] }).byCover, { diff: 0, outside: 0, none: 1 });
  const complete = { files: [{ path: 'src/config.js', change: 'modified', contentState: 'complete' }] };
  assert.deepEqual(unrecordedCover(gap, { pr: complete, placed: ['src/config.js'] }).byCover, { diff: 0, outside: 0, none: 1 });
  assert.deepEqual(unrecordedCover(gap, { pr: complete, placed: null }).byCover, { diff: 0, outside: 0, none: 1 },
    'no code review, no placement: nothing is covered by a diff nobody read');
});

test('W3c-10 a declaration that does not list its writes, or lists fewer than it counts, caps what it does not list', () => {
  const pr = { files: [{ path: 'src/config.js', change: 'modified', contentState: 'complete' }] };
  const placed = ['src/config.js'];
  const bare = { code: 'unrecorded_body', channel: 'code', scope: 'session', count: 2 };
  assert.equal(unrecordedCover(bare, { pr, placed }).capping, 2, 'an unlisted write cannot be shown to be covered');
  const short = { ...bare, writes: [{ eventId: 'A1-3', path: 'src/config.js', outsideRepository: false }] };
  assert.equal(unrecordedCover(short, { pr, placed }).capping, 2, 'the listed unknown body and remainder both cap');
  const uncounted = { ...short, count: null };
  assert.ok(unrecordedCover(uncounted, { pr, placed }).capping >= 1, 'a declaration with no count caps');
  const honest = honestStatuses({ findings: [], codeCoverage: 'complete', pr, codeCoverageFacts: { placed },
    coverageFacts: { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, instructions: 1,
      instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: null }, gaps: [bare] });
  assert.equal(honest.sessionStatus, RECORDER_LIMITED);
  assert.deepEqual([...UNRECORDED_COVER].sort(), ['diff', 'outside']);
});

// ---- the classification is PR-independent where it can be, and the adapter says so ---------------

test('W3c-10 the adapter lists each unrecorded write with its event id, its path and whether it is outside the repository', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Bump the limit and keep a scratch note.' }], ledger: [
    { turn: 1, seq: 0, kind: 'bash', cmd: "sed -i 's/1/2/' src/limit.js", outcome: 'passed', tailLines: [] },
    { turn: 1, seq: 1, kind: 'edit', path: 'src/limit.js', via: 'sed -i' },
    { turn: 1, seq: 2, kind: 'bash', cmd: 'echo x > /tmp/note.js', outcome: 'passed', tailLines: [] },
    { turn: 1, seq: 3, kind: 'edit', path: 'tmp/note.js', via: 'redirect', external: true },
  ] }, { sessionKey: 's' });
  const [gap] = session.adapterGaps.filter((g) => g.code === 'unrecorded_body');
  assert.equal(gap.count, 2);
  assert.deepEqual(gap.writes, [
    { eventId: 'A1-1', path: 'src/limit.js', outsideRepository: false },
    { eventId: 'A1-3', path: 'tmp/note.js', outsideRepository: true },
  ]);
  assert.equal(gap.note, '2 write(s) whose body the recording does not contain: 2 shell write(s)',
    'the note is unchanged: what covered a write is decided where the PR is known, not here');
});
