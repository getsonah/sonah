// C-06 "M33 session verdict": wherever NO_FINDINGS is shown, every declared cause of the partial
// coverage is shown WITH ITS COUNT, and "a cause whose items carry no count is counted by its
// declarations". A gap code this version does not name still shows the count it declared. A count
// that is only a lower bound (some declaration stated none) is said as one: "at least N".
//
// Synthetic sessions and gaps only; the judge is a stub that answers every window with nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { runReview } from '../src/run-review.js';
import { GAP_CODES, honestStatuses } from '../src/ledger.js';
import { renderReview, coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';

const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const TEXT = { ask: 'SYNTHETIC_M33_CAUSE_ASK: run the synthetic checks.', cmd: 'npm test',
  out: 'SYNTHETIC_M33_CAUSE_OUT: 3 passed' };
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];

/** A fully reviewable session whose only limits are the declarations handed in. */
function declaring(gaps) {
  const session = new Session({ sessionKey: 's', blobs: { ...TEXT }, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' }] });
  session.adapterGaps = gaps.map((gap, lossOrdinal) => ({ scope: 'session', sessionKey: 's', lossOrdinal, ...gap }));
  return session;
}
const review = (gaps) => runReview({ session: declaring(gaps), pr: null, reviewScope: 'session-only', judge: async () => EMPTY });
const header = (report) => renderReview(report).split('\n').find((line) => line.startsWith('Not covered:')) ?? null;
const counted = (counts) => Number.isSafeInteger(counts?.n) && counts.n > 0;

test('M33 a cause whose one declaration states no count is counted by its declaration, as a lower bound', async () => {
  const report = await review([{ code: 'incomplete_inventory', channel: 'actions', count: null }]);
  assert.equal(report.sessionReview, 'complete');
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(report), [['incomplete_inventory', { n: 1, atLeast: true }]]);
  assert.equal(header(report), 'Not covered: at least 1 part of the session evidence was incomplete.');
  assert.doesNotMatch(header(report), /\bsome\b/, 'a count, never "some", beside NO_FINDINGS');
});

test('M33 several countless declarations of one cause are counted one each', async () => {
  const report = await review([
    { code: 'incomplete_inventory', channel: 'actions', count: null },
    { code: 'incomplete_inventory', channel: 'children', count: null, eventIds: ['A1'] },
  ]);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(report), [['incomplete_inventory', { n: 2, atLeast: true }]]);
  assert.match(header(report), /at least 2 parts of the session evidence were incomplete/);
});

test('M33 a counted and a countless declaration of one cause sum to a lower bound', async () => {
  const report = await review([
    { code: 'source_clipped', channel: 'code', count: 3, eventIds: ['A1'] },
    { code: 'source_clipped', channel: 'commentary', count: null },
  ]);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(report), [['source_clipped', { n: 4, atLeast: true }]]);
  assert.match(header(report), /at least 4 recorded text\(s\) were cut short/);
  // Every declaration stating its count keeps the exact count, with no "at least".
  const exact = await review([{ code: 'source_clipped', channel: 'code', count: 3, eventIds: ['A1'] },
    { code: 'source_clipped', channel: 'commentary', count: 1 }]);
  assert.deepEqual(coverageCauses(exact), [['source_clipped', { n: 4 }]]);
  assert.match(header(exact), /Not covered: 4 recorded text\(s\) were cut short/);
});

test('M33 a gap code outside the vocabulary still shows the count it declared', async () => {
  const report = await review([{ code: 'retired_synthetic_code', channel: 'commentary', count: 4 }]);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(report), [['other_gap', { n: 4 }]]);
  assert.match(header(report), /\b4\b/);
  assert.equal(header(report), `Not covered: ${COVERAGE_SENTENCE.other_gap({ n: 4 })}.`);
  // And with no count, counted by its declaration.
  const bare = await review([{ code: 'retired_synthetic_code', channel: 'commentary' }]);
  assert.deepEqual(coverageCauses(bare), [['other_gap', { n: 1, atLeast: true }]]);
});

test('M33 a zero count on a capping declaration is not a count: the declaration counts itself', async () => {
  const report = await review([{ code: 'unsupported_message', channel: 'commentary', count: 0 }]);
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(report), [['unsupported_message', { n: 1, atLeast: true }]]);
});

test('M33 for every gap code and channel, a NO_FINDINGS report names each cause with a positive count', () => {
  const channels = ['instructions', 'commentary', 'actions', 'observations', 'children', 'identity', 'code'];
  const facts = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, reviewableEvents: 3,
    instructions: 1, instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 1,
    pairGaps: 0, declared: null };
  const failures = [];
  for (const code of [...GAP_CODES, 'retired_synthetic_code'])
    for (const channel of channels)
      for (const count of [null, 0, 2]) {
        const gap = { code, channel, scope: 'session', count, ...(code === 'unrecorded_body' ? { writes: [] } : {}) };
        const report = { findings: [], decisions: [], rejectedDecisions: [], rejectedFindings: [], gaps: [gap],
          coverageFacts: facts, coverage: 'partial', codeCoverage: 'missing', reviewScope: 'session-only',
          sessionReview: 'complete', hasSessionEvidence: true, pr: null };
        if (honestStatuses(report).sessionStatus !== 'NO_FINDINGS') continue;
        const causes = coverageCauses(report);
        if (!causes.length || !causes.every(([, counts]) => counted(counts)))
          failures.push(`${code}/${channel}/${count}: ${JSON.stringify(causes)}`);
        for (const [cause, counts] of causes)
          if (/\bsome\b|null|undefined|NaN/.test(COVERAGE_SENTENCE[cause](counts))) failures.push(`${code}/${channel}/${count}: ${cause}`);
      }
  assert.deepEqual(failures, []);
});

test('M33 the PR file list cause carries a count of its declared shortfalls', () => {
  const pr = { number: 1, enumeration: 'partial',
    files: [{ path: 'a.js', contentState: 'complete' }, { path: 'b.js', contentState: 'partial' }] };
  const facts = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, reviewableEvents: 1,
    instructions: 1, instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 0, pairGaps: 0 };
  const causes = Object.fromEntries(coverageCauses({ pr, coverageFacts: facts, gaps: [] }));
  assert.deepEqual(causes.pr_files_incomplete, { n: 2 });
  assert.match(COVERAGE_SENTENCE.pr_files_incomplete(causes.pr_files_incomplete), /the PR file list was incomplete/);
  assert.match(COVERAGE_SENTENCE.pr_files_incomplete(causes.pr_files_incomplete), /\b2\b/);
});
