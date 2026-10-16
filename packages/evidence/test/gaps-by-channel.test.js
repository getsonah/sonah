// W3c-8 — a gap says what it is, and caps the review it is a loss of.
//
//   F106: a changed file the CODE review could not read is `code_unreviewable` (channel `code`,
//         scope `pr`). It was reported as `source_clipped` — "the recorder stripped some source
//         text" — which is false for it, and it capped the session review it has nothing to do with.
//   F96:  a write whose body the recording does not contain (a shell write, a write the recorder
//         kept no text for) is declared as `unrecorded_body`, a loss of the session record. It was
//         declared per change only, so the session gap list and the verdict never heard of it.
//
// Every byte here is synthetic: invented paths, invented code, invented session text. No model,
// no provider, no recording is read. The recordings in the production-path tests are written to
// a temp directory by this file and deleted after.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import { runReview } from '../src/run-review.js';
import { runCodeReview } from '../src/code-review.js';
import { GAP_CODES, honestStatuses } from '../src/ledger.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';

const repo = { host: 'github.com', id: '9' };
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const quiet = async () => EMPTY;

// ---- F106: code_unreviewable ------------------------------------------------------------------

const TEXT = {
  ask: 'SYNTHETIC_W3C8_ASK: add the pricing module and the logo.',
  said: 'SYNTHETIC_W3C8_SAID: writing the pricing module now.',
  body: 'export const SYNTHETIC_W3C8_PRICE = 1;\n',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

/** A session the review reads in full: one ask, one statement, one successful write. */
function fullyReadSession(path) {
  return new Session({ sessionKey: 'sess-w3c8', adapter: 'claude', blobs: { ...TEXT }, events: [
    { id: 'E1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'E2', kind: 'commentary', sequence: 1, phase: 'working', text: whole('said'), beforeInvocation: 'E3' },
    { id: 'E3', kind: 'invocation', sequence: 2, callKey: 'c1', tool: 'Write', operation: 'write',
      paths: [{ path }], command: [], input: [], changes: [{ path, before: [], after: whole('body'), diff: [] }] },
    { id: 'E4', kind: 'observation', sequence: 3, invocation: 'E3', callKey: 'c1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
  ] });
}

/** A judge that finds nothing and reports exactly the files its request showed it. */
function honestJudge() {
  return async (request) => {
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [] })) };
    const shown = [...String(request.prompt).matchAll(/^- (\S+) · [^\n]*· shown$/gm)].map((m) => m[1]);
    return { ...EMPTY, codeFindings: [], sessionFindings: [], reviewedFiles: shown };
  };
}

function binaryPr(code, binary) {
  const diff = [`diff --git a/${code} b/${code}`, 'new file mode 100644', 'index 0000000..1111111 100644',
    '--- /dev/null', `+++ b/${code}`, '@@ -0,0 +1 @@', '+export const SYNTHETIC_W3C8_PRICE = 1;', ''].join('\n')
    + `diff --git a/${binary} b/${binary}\nindex 2222222..3333333 100644\nBinary files a/${binary} and b/${binary} differ\n`;
  const pr = { repo, number: 38, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
    gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: code, change: 'added', contentState: 'complete' },
      { path: binary, change: 'binary', contentState: 'complete' }] };
  return { pr, diff };
}

test('F106 a changed file the code review could not read is code_unreviewable, not a recorder cut', async () => {
  const code = 'src/price.js', binary = 'assets/logo.png';
  const { pr, diff } = binaryPr(code, binary);
  const report = await runCodeReview({ session: fullyReadSession(code), pr, diff, judge: honestJudge() });

  const gap = report.gaps.find((g) => g.code === 'code_unreviewable');
  assert.ok(gap, 'the unreadable file is declared under its own code');
  assert.equal(gap.channel, 'code');
  assert.equal(gap.scope, 'pr', 'a changed file of the PR is a PR-scoped loss, not a session one');
  assert.equal(gap.count, 1);
  assert.equal(gap.note, '1 changed file(s) could not be reviewed: 1 binary');
  assert.ok(!report.gaps.some((g) => g.code === 'source_clipped'),
    'the recorder stripped nothing, so nothing may say it did');
  assert.ok(GAP_CODES.includes('code_unreviewable'));
});

test('F106/F116 a code-channel gap alone: the session reads CLEAN, the code review and the verdict do not', async () => {
  const code = 'src/price.js', binary = 'assets/logo.png';
  const { pr, diff } = binaryPr(code, binary);
  const report = await runCodeReview({ session: fullyReadSession(code), pr, diff, judge: honestJudge() });

  assert.equal(report.coverage, 'complete', 'the session was read in full');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'UNCHECKED', 'a declared gap never lets the review read CLEAN overall');

  assert.equal(report.sessionReview, 'complete');
  assert.deepEqual(coverageCauses(report), [['code_unreviewable', { n: 1 }]],
    'the causes name why the code review is short, although the session is complete');
  assert.ok(report.gaps.some((gap) => gap.code === 'code_unreviewable' && /1 binary/.test(gap.note ?? '')));
});

test('F106 the note counts every reason present, and only those', async () => {
  const code = 'src/price.js';
  const { pr, diff } = binaryPr(code, 'assets/logo.png');
  // A second file redaction withheld: in the PR, marked partial, its block absent (F23).
  pr.files.push({ path: 'config/withheld.js', change: 'added', contentState: 'partial' });
  const report = await runCodeReview({ session: fullyReadSession(code), pr, diff, judge: honestJudge() });
  const gap = report.gaps.find((g) => g.code === 'code_unreviewable');
  assert.equal(gap.count, 2);
  assert.equal(gap.note, '2 changed file(s) could not be reviewed: 1 binary, 1 withheld by redaction');
});

// ---- F96: unrecorded_body ---------------------------------------------------------------------

let seq = 0;
const uid = () => `w3c8-${String(++seq).padStart(6, '0')}`;
// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human prompts carry the host's typed origin; a
// 2.1.205 recording is labelled by the declared legacy fallback, every row of it a counted gap.
const base = { sessionId: 'sess-w3c8-raw', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), origin: { kind: 'human' },
  message: { role: 'user', content: text } });
const said = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] },
  // These scenarios isolate missing write bodies; the outcome itself is positively recorded.
  toolUseResult: { exit_code: 0 } });
const call = (id, name, input, result) => [toolUse(id, name, input), toolResult(id, result)];

/** analyze() -> sessionFromLedger(), the exact pair `sonah review` runs, on a temp recording. */
async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'w3c8-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    return sessionFromLedger(ledger, { sessionKey: 'w3c8' });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// The three shell-write forms the slicer recognises and an agent reaches for routinely: a
// generated file piped through `tee`, a one-line `sed -i`, and a heredoc fixture. The heredoc goes
// through `tee`: since W3c-11 a `cat > path <<'EOF'` records its body (it is in the command), so
// it is no longer a write whose body the recording lacks — this file's subject.
const SHELL_WRITES = [
  ['b2', 'node scripts/gen-docs.js | tee docs/api.md', 'generated 4 pages'],
  ['b3', "sed -i 's/100/120/' src/config.js", ''],
  ['b4', "tee test/fixtures/orders.json <<'EOF'\n[{\"id\": 1}]\nEOF", '[{"id": 1}]'],
];

/**
 * A realistic small session: read, test, two Writes, an Edit, a MultiEdit, a final test run —
 * and, when `shell` is set, the three shell writes above in the middle of it. Without them the
 * same session changes the same kinds of files through structured tools only.
 */
function realisticSession({ shell = true } = {}) {
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
    ...(shell ? SHELL_WRITES.flatMap(([id, command, out]) => call(id, 'Bash', { command }, out)) : []),
    ...call('m1', 'MultiEdit', { file_path: '/repo/README.md', edits: [
      { old_string: '## API', new_string: '## API\n\nRate limited.' }, { old_string: 'v1', new_string: 'v2' }] },
    'Applied 2 edits.'),
    ...call('b5', 'Bash', { command: 'npm test' }, 'Tests: 14 passed, 14 total'),
    said('Rate limiting is in place and the tests pass.'),
  ];
}

const changesOf = (session) => session.events.filter((e) => e.kind === 'invocation')
  .flatMap((e) => (e.changes ?? []).map((change) => ({ event: e, change })));
const unrecordedGaps = (session) => (session.adapterGaps ?? []).filter((g) => g.code === 'unrecorded_body');
const prFor = (session) => ({ repo, number: 1, enumeration: 'complete',
  files: [...new Set(changesOf(session).map(({ change }) => change.path))]
    .map((path) => ({ path, change: 'modified', contentState: 'complete' })) });

test('F96 a shell write is declared as a session gap, counted from the per-change extent', async () => {
  const session = await throughProductionPath(realisticSession());
  const all = changesOf(session);
  const unrecorded = all.filter(({ change }) => change.extent?.recorded === false);
  assert.equal(all.length, 8, 'two Writes, one Edit, two MultiEdit entries and three shell writes');
  assert.equal(unrecorded.length, 3, 'exactly the three shell writes carry no body');
  assert.ok(unrecorded.every(({ event }) => event.shellWriteOf), 'each is a shell-write sibling of its command');

  const gaps = unrecordedGaps(session);
  assert.equal(gaps.length, 1, 'one declaration, counted, not one per write');
  const [gap] = gaps;
  assert.equal(gap.channel, 'code', 'the lost text is written code');
  assert.equal(gap.scope, 'session', 'and it is the recording that lacks it, not the PR');
  assert.equal(gap.count, 3);
  assert.deepEqual(gap.eventIds, unrecorded.map(({ event }) => event.id));
  assert.equal(gap.note, '3 write(s) whose body the recording does not contain: 3 shell write(s)');
  assert.ok(GAP_CODES.includes('unrecorded_body'));
});

test('F96 structured writes, an empty edit and a delete declare no unrecorded_body', async () => {
  const session = await throughProductionPath([
    ...realisticSession({ shell: false }),
    // F107: an Edit whose new_string is empty wrote the empty string, and the record says so.
    ...call('e2', 'Edit', { file_path: '/repo/src/app.js', old_string: '  console.log("SYNTHETIC_DEBUG");', new_string: '' },
      'The file has been updated.'),
    // A delete writes no body: the file's absence is its whole after-state, so nothing is missing.
    ...call('d1', 'mcp__fs__delete_file', { path: '/repo/src/legacy.js' }, 'Deleted.'),
  ]);
  const ops = changesOf(session).map(({ event }) => event.operation);
  assert.ok(ops.includes('delete'), 'the fixture really does contain a delete');
  assert.deepEqual(unrecordedGaps(session), []);
});

test('F96 a write the recorder kept no text for is declared too, and the note says it was not a shell write', () => {
  // Ledger shape: a create with no `after` (an empty Write, F108) beside one shell write.
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Make the placeholder and bump the limit.' }], ledger: [
    { turn: 1, seq: 0, kind: 'create', path: 'src/.keep.js' },
    { turn: 1, seq: 1, kind: 'bash', cmd: "sed -i 's/1/2/' src/limit.js", outcome: 'passed', tailLines: [] },
    { turn: 1, seq: 2, kind: 'edit', path: 'src/limit.js', via: 'sed -i' },
  ] }, { sessionKey: 's' });
  const [gap] = unrecordedGaps(session);
  assert.equal(gap.count, 2);
  assert.deepEqual(gap.eventIds, ['A1-0', 'A1-2']);
  assert.equal(gap.note, '2 write(s) whose body the recording does not contain: 1 shell write(s), 1 other write(s) with no recorded text');
});

test('F96 a transferred child\'s unrecorded write is counted on the parent, under the child\'s event id', () => {
  const brief = { text: 'Bump the limit in src/limit.js', tool: 'Task', field: 'prompt' };
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Delegate the limit bump.' }], ledger: [],
    delegations: [{ adapter: 'claude', callId: 'd1', turn: 1, childId: 'kid', status: 'linked',
      reason: 'child_recording_linked', source: 0, link: { source: 0 }, parentInstruction: brief }],
    children: [{ source: 0, ledger: { ask: [], instructions: [{ turn: 1, text: brief.text }], ledger: [
      { turn: 1, seq: 0, kind: 'bash', cmd: "sed -i 's/1/2/' src/limit.js", outcome: 'passed', tailLines: [] },
      { turn: 1, seq: 1, kind: 'edit', path: 'src/limit.js', via: 'sed -i' }] } }],
  }, { sessionKey: 's' });
  const [gap] = unrecordedGaps(session);
  assert.ok(gap, 'the child\'s shell write reaches the parent\'s declaration');
  assert.equal(gap.count, 1);
  assert.deepEqual(gap.eventIds, ['child:kid:A1-1']);
});

test('F96 the causes name unrecorded_body beside the writes with no provable outcome', async () => {
  const session = await throughProductionPath(realisticSession());
  const report = await runReview({ session, pr: prFor(session), judge: quiet });
  const [gap] = unrecordedGaps(session);
  assert.equal(gap.note, '3 write(s) whose body the recording does not contain: 3 shell write(s)');
  const causes = coverageCauses(report);
  assert.deepEqual(causes.map(([cause]) => cause), ['unrecorded_body', 'write_outcome_unknown']);
  assert.deepEqual(causes[0], ['unrecorded_body', { n: 3 }]);
  assert.equal(typeof COVERAGE_SENTENCE.unrecorded_body(causes[0][1]), 'string');
});

// ---- F96, the decision: what the rule costs on a realistic session -----------------------------
//
// The rule as W3c-8 shipped it: `unrecorded_body` is a declared session-channel gap, so it caps
// session coverage like any other, and a session with no findings reads UNCHECKED. On this
// synthetic realistic session — 13 actions, 8 changes, 3 of them routine shell writes (`| tee`,
// `sed -i`, a heredoc) — the three shell writes alone move the session review from CLEAN to
// UNCHECKED; the same session without them reads CLEAN.
//
// W3c-10 (F133) narrowed it: a write caps only when nothing covered it — not a PR file whose hunks
// an answered code-review request placed, and not outside the repository. This test runs the
// SESSION review alone: no code review is joined, nothing was placed, so all three still cap and
// the pinned consequence below still holds. The covered case is covered-by-diff.test.js.

// M33 (C-06): the session review completes, and the shell writes' missing bodies and outcomes are
// recorder limits, so it reads NO_FINDINGS — never CLEAN, and named. It read UNCHECKED before M33.
test('F96 decision: a realistic session whose only unrecorded writes are shell writes reads NO_FINDINGS, never CLEAN', async () => {
  const withShell = await throughProductionPath(realisticSession());
  const report = await runReview({ session: withShell, pr: prFor(withShell), judge: quiet });
  assert.equal(report.coverageFacts.actions, 13);
  assert.deepEqual((withShell.adapterGaps ?? []).map((g) => g.code),
    ['write_outcome_unknown', 'unrecorded_body'],
    'the piped shell writes lack both own status proof and bodies');
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(honestStatuses({ ...report, codeCoverage: 'complete' }).reviewStatus, 'NO_FINDINGS');

  const without = await throughProductionPath(realisticSession({ shell: false }));
  const control = await runReview({ session: without, pr: prFor(without), judge: quiet });
  assert.deepEqual(without.adapterGaps ?? [], []);
  assert.equal(control.coverage, 'complete');
  assert.equal(control.sessionStatus, 'CLEAN', 'the control proves the shell writes alone flipped the verdict');
});

