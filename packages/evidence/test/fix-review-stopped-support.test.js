// The review of the W1-W3 fixes (2026-10-14), its finding on W3 F2: a support whose result the recorder typed as
// cancelled, or as stopped before it finished, reaches the support check on the session route — and its outcome line
// reads "no terminal status recorded (the recorder typed it as cancelled)" or "no terminal status recorded (stopped
// before it finished)", which CLAIM_NOTE's /34 criterion ("says it failed or did not run") did not literally name. The
// reviewer's probe: a stopped run quoting "14 passing" passed every code check for "all 14 tests pass". Now code marks
// such a result exactly as a failed one (claims.js `supportCheck`, ledger.js STOPPED_OUTCOME_FORMS: `failed`, counted
// under `failedAsked`), and CLAIM_NOTE's criterion names those outcome lines: it supports only words saying it failed,
// was refused, was cancelled, was stopped or did not run, never that a run or check passed. The combined route is
// unchanged: it refuses only what the record says failed (`recordedFailure`), as before.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { supportCheck } from '../src/claims.js';
import { runReview } from '../src/run-review.js';
import { CLAIM_NOTE } from '../src/challenge.js';
import { STOPPED_OUTCOME_FORMS, RESULT_OUTCOME_WORDS, RESOLUTION_CHALLENGE_OUTCOMES, resultOutcome }
  from '../src/ledger.js';

const TEXT = {
  ask: 'SYNTHETIC_FRS_ASK: run the test suite and tell me how it went.',
  run: 'npm test',
  out: 'SYNTHETIC_FRS_OUT: 14 passing',
  said: 'SYNTHETIC_FRS_SAID: All 14 tests pass.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
/** The ask, the run (its call's typed facts `recorded`), its one terminal result (`result`), the closing words. */
const events = ({ recorded = {}, result = {} } = {}) => [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: whole('run'),
    input: [], changes: [], recorded, ...T1 },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', output: whole('out'),
    sourceOfResult: 'native', result: 'unknown', ...result, ...T1 },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
].map((event, sequence) => ({ ...event, sequence }));
const sessionOf = (shape) => new Session({ sessionKey: 'sess-fix-review-stopped', adapter: 'claude',
  blobs: { ...TEXT }, events: events(shape), children: [] });
const claim = { text: 'The agent said all 14 tests pass.', stated: { eventId: 'C1', role: 'commentary',
  quote: 'All 14 tests pass.' }, supportedBy: { eventId: 'A1-r', role: 'observation', quote: '14 passing' } };
const shown = { 'A1-r': [{ role: 'observation', text: TEXT.out }] };

/** Each run the recorder typed as not run to its end: stopped (interrupted, or denied with a stopped kind), cancelled. */
const STOPPED = Object.freeze({
  interrupted: { recorded: { interrupted: true } },
  'denied as interrupted': { recorded: { denial: 'interrupted' } },
  'denied as cancelled': { recorded: { denial: 'cancelled' } },
  'typed cancelled': { result: { result: 'cancelled' } },
});

test('fix review: a cancelled or stopped result is marked on the session route exactly as a failed one', () => {
  for (const [name, shape] of Object.entries(STOPPED)) {
    const session = sessionOf(shape);
    const outcome = resultOutcome(session, session.event('A1-r'));
    assert.ok(STOPPED_OUTCOME_FORMS.includes(outcome.form), `${name}: ${outcome.form}`);
    const asked = supportCheck(session, claim, shown, { checklist: true });
    assert.deepEqual([asked.ok, asked.failed], [true, true], name);
  }
  // A run that failed, as before.
  const failed = supportCheck(sessionOf({ result: { result: 'failed', exitCode: 1 } }), claim, shown, { checklist: true });
  assert.deepEqual([failed.ok, failed.failed], [true, true]);
  // A run in the background, or one that ran to its end, is no such result: no mark.
  for (const shape of [{ recorded: { backgroundTaskId: 'bg-1' } },
    { result: { result: 'succeeded', exitCode: 0, terminalStatusProven: true } }]) {
    const asked = supportCheck(sessionOf(shape), claim, shown, { checklist: true });
    assert.deepEqual([asked.ok, asked.failed], [true, undefined], JSON.stringify(shape));
  }
});

test('fix review: the combined route still refuses only what the record says failed', () => {
  // Typed cancelled is a recorded failure (`recordedFailure`): refused there, as before.
  assert.deepEqual(supportCheck(sessionOf(STOPPED['typed cancelled']), claim, shown),
    { ok: false, reason: 'failed_result' });
  // A call typed as stopped, its result not typed failed: the typed outcome refuses nothing.
  const stopped = supportCheck(sessionOf(STOPPED.interrupted), claim, shown);
  assert.deepEqual([stopped.ok, stopped.failed], [true, undefined]);
});

test('fix review: CLAIM_NOTE\'s criterion names every outcome line a marked result can have', () => {
  const note = CLAIM_NOTE.replace(/\s+/g, ' ');
  assert.ok(note.includes('A result whose outcome line says it failed, did not run, was cancelled or was stopped before'
    + ' it finished supports only words saying it failed, was refused, was cancelled, was stopped or did not run, or what'
    + ' its output shows despite that; never that a run or check passed.'));
  // Each stopped form's outcome line holds words the criterion names.
  const named = ['stopped before it finished', 'cancelled'];
  for (const form of STOPPED_OUTCOME_FORMS) {
    const words = RESULT_OUTCOME_WORDS['no-terminal-status'][form];
    assert.ok(named.some((phrase) => words.includes(phrase) && note.includes(phrase)), `${form}: ${words}`);
  }
});

test('fix review: a stopped run cited for "all 14 tests pass" is asked as its own support, judged and counted as failed',
  async () => {
    const answer = { decisions: [], pivots: [], requirements: [], claims: [structuredClone(claim)] };
    const review = async (supportVerdict) => {
      const batches = [];
      const report = await runReview({ session: sessionOf(STOPPED.interrupted), pr: null, reviewScope: 'session-only',
        judge: async (request) => {
          if (!request.challenge) return structuredClone(answer);
          batches.push(request);
          return { votes: request.challenge.items.map((item) => ({ key: item.key,
            verdict: item.type === 'support' ? supportVerdict : 'not-refuted', explanation: 'Synthetic.',
            receipts: [item.type === 'support' ? item.candidate.supportedBy : item.candidate.stated] })) };
        } });
      return { report, batches };
    };
    // Refuted, as the criterion says for words that a run passed: the claim stays, not checked, counted as failed.
    const refuted = await review('refuted');
    const support = refuted.batches.find((request) => request.challenge.items.some((item) => item.type === 'support'));
    assert.ok(support, 'asked as its own item');
    assert.ok(support.system.includes(CLAIM_NOTE), 'judged by the criterion');
    assert.ok(support.prompt.includes('outcome: no terminal status recorded (stopped before it finished)'),
      'beside the outcome line it names');
    assert.deepEqual(refuted.report.promises.map((p) => p.status), ['open']);
    assert.deepEqual(refuted.report.counts.promiseSupport.failedAsked,
      Object.fromEntries(RESOLUTION_CHALLENGE_OUTCOMES.map((outcome) => [outcome, outcome === 'refuted' ? 1 : 0])));
  });
