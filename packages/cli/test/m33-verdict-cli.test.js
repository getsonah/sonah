// M33 (C-06 "M33 session verdict"), amended by D71 (a) (owner decision 2026-10-08: no verdict anywhere the human
// sees): the CLI prints no status — its first line says whether Sonah's own review ran, its exit code is that run
// state only (complete 0, incomplete 1, failed 3), and a partial coverage is printed with every declared cause and its
// count. The session-review harness summary carries no status either. Synthetic sessions and a fake transport only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { Session } from '../../evidence/src/session.js';
import { runReview } from '../../evidence/src/run-review.js';
import { REVIEW_RUN_STATES } from '../../evidence/src/ledger.js';
import { REVIEW_RUN_EXIT_CODES, reviewExitCode, runStateLine, notCoveredLine } from '../src/session-review-command.js';
import { countLines } from '../src/report-output.js';
import { reportModel } from '../../render/report-model.js';
import { REPORT_COUNT_WORDS } from '../../render/report-words.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const SENTINEL = 'SYNTHETIC_M33_VERDICT_CLI';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

/** One instruction, one command with a proven result, and a hand-off with no child link: a
 *  completed review of this reads NO_FINDINGS (the unlinked delegation is a recorder limit). */
function delegatedSession() {
  const blobs = { ask: `${SENTINEL}_ASK: run the checks and hand the docs to a helper.`, cmd: 'npm test',
    out: `${SENTINEL}_OUT: 3 passed`, brief: `${SENTINEL}_BRIEF: write the docs page.` };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'session', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'O1', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
    { id: 'D1', kind: 'invocation', sequence: 3, callKey: 'd1', tool: 'Task', operation: 'delegate',
      paths: [], command: [], input: whole('brief'), changes: [] }] });
}

const STATUS_WORDS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b|needs your decision|worth a look/i;

test('D71 the exit code is Sonah\'s own run state, closed: complete 0, incomplete 1, failed 3', async () => {
  assert.deepEqual(Object.keys(REVIEW_RUN_EXIT_CODES), [...REVIEW_RUN_STATES]);
  assert.ok(Object.isFrozen(REVIEW_RUN_EXIT_CODES));
  assert.deepEqual(Object.values(REVIEW_RUN_EXIT_CODES), [0, 1, 3]);
  // A completed review exits 0 whatever it found; one whose window did not answer exits 1; no report exits 3.
  const completed = await runReview({ session: delegatedSession(), pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
  assert.equal(completed.sessionReview, 'complete');
  assert.equal(reviewExitCode(completed), 0);
  assert.equal(reviewExitCode({ ...completed, findings: [{ id: 'f', origin: 'session-review', kind: 'shortcut',
    status: 'DECIDE', title: 'Synthetic', explanation: 'Synthetic.', receipts: [], scope: 'session-effect', anchor: null }] }), 0,
  'a finding never moves the exit code');
  const failed = await runReview({ session: delegatedSession(), pr: null, reviewScope: 'session-only', judge: async () => null });
  assert.equal(failed.sessionReview, 'incomplete');
  assert.equal(reviewExitCode(failed), 1);
  for (const none of [undefined, null, 'complete', [], 3]) assert.equal(reviewExitCode(none), 3, `${String(none)} is failed`);
});

test('D71 the CLI says what of its own review ran, and prints no status', async () => {
  const completed = await runReview({ session: delegatedSession(), pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
  assert.equal(runStateLine(completed, 'initial'), "Sonah's review: complete (session review complete). initial review.");
  const failed = await runReview({ session: delegatedSession(), pr: null, reviewScope: 'session-only', judge: async () => null });
  assert.equal(runStateLine(failed, 'cached'), "Sonah's review: incomplete (session review did not finish). cached review.");
  // D97 (S6, S5 review M2 before it): after the run state, the count line — counts from the items in their tiers,
  // never a lone count of findings that reads as a pass; a decision not to act and a failure passed over are items.
  const session = delegatedSession();
  const lines = countLines(reportModel(session, completed));
  // (Sonah's own row for the message no row of the review cited is an ask it did not check.)
  assert.deepEqual(lines, ['Must act 0 · Must know 0 · Good to know 0 · Your prompt: 1 not checked',
    REPORT_COUNT_WORDS.emptyTiers], 'nothing found is never said to mean the work is right');
  const marked = countLines(reportModel(session, { ...completed, findings: [],
    decisions: [{ notActing: true, column: null, chosen: 'skip the docs' }],
    failures: [{ eventId: 'O1', action: 'A1', handling: 'passed-over', outcome: 'ran-failed', form: 'exit' }] }));
  assert.match(marked[0], /^Must act 0 · Must know 2 · Good to know 0 · /);
  assert.ok(marked.every((line) => !line.includes('**')));
  for (const line of [runStateLine(completed, 'initial'), runStateLine(failed, 'initial'), ...lines, ...marked])
    assert.doesNotMatch(line, STATUS_WORDS);
});

test('M33 wherever the coverage is partial, every declared cause is printed with its count', async () => {
  const report = await runReview({ session: delegatedSession(), pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(notCoveredLine(report), 'Not covered: Sonah found no checked recording for 1 delegation to a helper.');
  // D71 (a): the line follows the coverage, never a status; a complete coverage prints none.
  assert.equal(notCoveredLine({ ...report, sessionStatus: 'UNCHECKED', reviewStatus: 'UNCHECKED', codeStatus: 'UNCHECKED' }),
    'Not covered: Sonah found no checked recording for 1 delegation to a helper.');
  assert.equal(notCoveredLine({ ...report, coverage: 'complete', codeCoverage: 'missing' }), null);
  assert.doesNotMatch(notCoveredLine(report), STATUS_WORDS);
  assert.doesNotMatch(notCoveredLine(report), new RegExp(SENTINEL));
});

test('M33 the harness summary reports a completed review with its causes and counts only, and no status (D71)', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-verdict-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return request.challenge ? { votes: [] } : { ...EMPTY };
  };
  let stdout = '';
  const { summary, exitCode } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => delegatedSession(), createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.equal(exitCode, 0, 'the harness finished its run');
  assert.equal(summary.coverage, 'partial');
  assert.equal(summary.sessionReview, 'complete');
  assert.ok(!Object.hasOwn(summary, 'sessionStatus') && !Object.hasOwn(summary, 'reviewStatus'), 'D71 (a): no status');
  assert.doesNotMatch(stdout, STATUS_WORDS);
  assert.deepEqual(summary.coverageCauses, { delegations_unlinked: { n: 1, atLeast: false } });
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()).coverageCauses, { delegations_unlinked: { n: 1, atLeast: false } });
});

// ---- M33 G2: counted causes, published claims, closed status lists --------------------------------

test('M33 G2 a declared cause with no count is printed with the count of its declarations', async () => {
  const session = delegatedSession();
  session.adapterGaps = [{ code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: null,
    sessionKey: 'session', lossOrdinal: 0 }];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  // The causes are listed as the PR comment lists them, with no semicolon (S6).
  assert.equal(notCoveredLine(report), 'Not covered: Sonah found no checked recording for 1 delegation to a helper · '
    + 'at least 1 part of the session evidence is incomplete.');
});

/** The delegated session plus the agent's own words: a claim the challengers can uphold. */
function claimingSession() {
  const said = `${SENTINEL}_SAID: the checks pass and the docs are handed off.`;
  const base = delegatedSession();
  return new Session({ sessionKey: 'session', adapter: 'claude', blobs: { ...base.blobs, said }, events: [
    ...base.events.map((event) => ({ ...event })),
    { id: 'C1', kind: 'commentary', sequence: 4, phase: 'final', beforeInvocation: null,
      text: [{ sourceKey: 'said', fromByte: 0, untilByte: Buffer.byteLength(said, 'utf8') }] }] });
}

test('M33 G2 the harness summary counts the published claims, never their text', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-m33-claims-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const stated = { eventId: 'C1', role: 'commentary', quote: 'the checks pass and the docs are handed off.' };
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return request.challenge
      ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'The agent said so in its final message.', receipts: [stated] })) }
      : { ...EMPTY, claims: [{ text: `${SENTINEL}_CLAIM`, stated, contradictedBy: null }] };
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'session', concurrency: 1 },
  { loadSession: async () => claimingSession(), createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.equal(summary.promises, 1);
  assert.doesNotMatch(stdout, new RegExp(SENTINEL), 'no claim text leaves the harness');
});
