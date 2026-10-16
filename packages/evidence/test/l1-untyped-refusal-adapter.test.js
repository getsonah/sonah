// L1 review (finding L1-pre-typed-recorder-fail-open; OWNER DECISION 2026-10-06; C-02 "L1 refused calls"). Calls a
// Claude Code recorder that types no refusal recorded as failed (`capture.instructionsRefusalUntyped`, each placed call
// marked `refusalUntyped`) are one instructions gap with its own closed note and review cause: located at the calls it
// names only when it names every one it counts, otherwise a loss at every bound. Synthetic ledgers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { instructionReviewScope } from '../src/ledger.js';

/** The coverage causes as every reader names them (the CLI's and the page's "Not covered" line). */
const causeLine = (report) => coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ');

const NOTE = INSTRUCTION_GAP_NOTES.refusal_untyped;
const led = ({ capture, marks = [] }) => ({ version: 1, session: 'l1-untyped', claim: {},
  ask: [{ turn: 1, text: 'Fix the parser.' }, { turn: 2, text: 'Now the tests.' }],
  ledger: [
    { turn: 1, seq: 0, kind: 'edit', path: 'src/parser.js', ...(marks.includes(0) ? { refusalUntyped: true } : {}) },
    { turn: 2, seq: 0, kind: 'error', attempted: 'edit', path: 'src/cli.js', isError: true,
      ...(marks.includes(1) ? { refusalUntyped: true } : {}) },
  ],
  capture: { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0, unmapped: 0, reasons: [],
    incomplete: false, ...capture } });
const gapsOf = (session) => session.adapterGaps.filter((gap) => gap.note === NOTE);

test('L1 review: failed calls on a recorder that types no refusal are one located instructions loss', () => {
  const session = sessionFromLedger(led({ capture: { instructionsRefusalUntyped: 1 }, marks: [1] }),
    { sessionKey: 'l1-untyped' });
  assert.deepEqual(gapsOf(session).map(({ code, channel, scope, count, eventIds }) => ({ code, channel, scope, count,
    eventIds })), [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1,
    eventIds: ['A2-0'] }]);
  assert.equal(session.adapterGaps.some((gap) => /user answer inside a tool result/.test(gap.note ?? '')), false,
    'never credited to a typed refusal');
  const first = session.events.find((event) => event.id === 'A1-0').sequence;
  const failed = session.events.find((event) => event.id === 'A2-0').sequence;
  assert.equal(instructionReviewScope(session, { upTo: first }).complete, true, 'before the failed call: no loss');
  assert.equal(instructionReviewScope(session, { upTo: failed }).complete, false, 'at it: a loss');
});

test('L1 review: a count the marks do not cover, a count out of shape, or a mark with no count is unlocated', () => {
  for (const [capture, marks, count] of [[{ instructionsRefusalUntyped: 2 }, [1], 2],
    [{ instructionsRefusalUntyped: 'two' }, [1], null], [{}, [1], null]]) {
    const session = sessionFromLedger(led({ capture, marks }), { sessionKey: 'l1-untyped-odd' });
    const gaps = gapsOf(session);
    assert.deepEqual(gaps.map((gap) => [gap.count, Object.hasOwn(gap, 'eventIds')]), [[count, false]],
      JSON.stringify(capture));
    const first = session.events.find((event) => event.id === 'A1-0').sequence;
    assert.equal(instructionReviewScope(session, { upTo: first }).complete, false, 'a loss at every bound');
  }
  const none = sessionFromLedger(led({ capture: { instructionsRefusalUntyped: 0 } }), { sessionKey: 'l1-untyped-none' });
  assert.deepEqual(gapsOf(none), []);
});

test('L1 review: the loss is named by its own cause', () => {
  assert.ok(COVERAGE_CAUSES.includes('instructions_refusal_untyped'));
  // The failed call is the subject, so "the call" (or "any of them") is what can hold an answer, never the recorder.
  assert.equal(COVERAGE_SENTENCE.instructions_refusal_untyped({ n: 1 }), '1 failed call comes from a recorder version '
    + 'that does not record which calls you refused, so the call can hold an answer that Sonah did not read');
  assert.equal(COVERAGE_SENTENCE.instructions_refusal_untyped({ n: 2 }), '2 failed calls come from a recorder version '
    + 'that does not record which calls you refused, so any of them can hold an answer that Sonah did not read');
  const report = { repo: { host: 'github.com', id: 'l1' }, pr: null, session: null, hasSessionEvidence: true,
    coverageFacts: { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 2, instructions: 2,
      instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 1, declared: 'partial' },
    decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [],
    gaps: [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 3, note: NOTE }],
    counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
    coverage: 'partial', codeCoverage: 'complete' };
  assert.deepEqual(coverageCauses(report).map(([cause, { n }]) => [cause, n]), [['instructions_refusal_untyped', 3]]);
  const header = causeLine(report);
  assert.match(header, /3 failed calls come from a recorder version that does not record which calls you refused/);
});
