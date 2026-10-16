// L1 session-type review (finding L1S-unknown-type-not-counted; OWNER DECISION 2026-10-06; C-02 "L1 refused calls",
// session type). Calls refused in a session whose type the recorder did not record (`capture.
// instructionsRefusalSessionUnknown`, each placed call marked `refusalSessionUnknown`) keep their declaration under one
// instructions gap with its own closed note and review cause — never the note of a refusal a human gave — located at
// the calls it names only when it names every one it counts, otherwise a loss at every bound. Synthetic ledgers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES, UNREAD_ANSWER_NOTE } from '../adapters/sonah-ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { instructionReviewScope, rootInstructionLossOf } from '../src/ledger.js';

/** The coverage causes as every reader names them (the CLI's and the page's "Not covered" line). */
const causeLine = (report) => coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ');

const NOTE = INSTRUCTION_GAP_NOTES.refusal_session_unknown;
const led = ({ capture, marks = [] }) => ({ version: 1, session: 'l1s-unknown', claim: {},
  ask: [{ turn: 1, text: 'Fix the parser.' }, { turn: 2, text: 'Now the tests.' }],
  ledger: [
    { turn: 1, seq: 0, kind: 'edit', path: 'src/parser.js', ...(marks.includes(0) ? { refusalSessionUnknown: true } : {}) },
    { turn: 2, seq: 0, kind: 'error', attempted: 'edit', path: 'src/cli.js', isError: true,
      ...(marks.includes(1) ? { refusalSessionUnknown: true } : {}) },
  ],
  capture: { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0, unmapped: 0, reasons: [],
    incomplete: false, ...capture } });
const gapsOf = (session) => session.adapterGaps.filter((gap) => gap.note === NOTE);

test('L1 session-type review: one closed note of its own, never a human\'s unread answer', () => {
  assert.notEqual(NOTE, UNREAD_ANSWER_NOTE);
  assert.match(NOTE, /did not record whether a human was present/);
});

test('L1 session-type review: refusals in a session of unrecorded type are one located instructions loss', () => {
  const session = sessionFromLedger(led({ capture: { instructionsRefusalSessionUnknown: 1 }, marks: [1] }),
    { sessionKey: 'l1s-unknown' });
  assert.deepEqual(gapsOf(session).map(({ code, channel, scope, count, eventIds }) => ({ code, channel, scope, count,
    eventIds })), [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1,
    eventIds: ['A2-0'] }]);
  assert.equal(session.adapterGaps.some((gap) => gap.note === UNREAD_ANSWER_NOTE), false, 'never a human\'s answer');
  const first = session.events.find((event) => event.id === 'A1-0').sequence;
  const refused = session.events.find((event) => event.id === 'A2-0').sequence;
  assert.equal(instructionReviewScope(session, { upTo: first }).complete, true, 'before the refused call: no loss');
  assert.equal(instructionReviewScope(session, { upTo: refused }).complete, false, 'at it: a loss, as before');
});

test('L1 session-type review: a count the marks do not cover, a count out of shape, or a mark with no count is unlocated', () => {
  for (const [capture, marks, count] of [[{ instructionsRefusalSessionUnknown: 2 }, [1], 2],
    [{ instructionsRefusalSessionUnknown: 'two' }, [1], null], [{}, [1], null]]) {
    const session = sessionFromLedger(led({ capture, marks }), { sessionKey: 'l1s-unknown-odd' });
    assert.deepEqual(gapsOf(session).map((gap) => [gap.count, Object.hasOwn(gap, 'eventIds')]), [[count, false]],
      JSON.stringify(capture));
    const first = session.events.find((event) => event.id === 'A1-0').sequence;
    assert.equal(instructionReviewScope(session, { upTo: first }).complete, false, 'a loss at every bound');
  }
  const none = sessionFromLedger(led({ capture: { instructionsRefusalSessionUnknown: 0 } }),
    { sessionKey: 'l1s-unknown-none' });
  assert.deepEqual(gapsOf(none), []);
});

test('L1 session-type review: the loss is named by its own cause', () => {
  assert.ok(COVERAGE_CAUSES.includes('instructions_refusal_session_unknown'));
  // The refused call is the subject, so "the call" (or "any of them") is what can hold an answer, never the session.
  assert.equal(COVERAGE_SENTENCE.instructions_refusal_session_unknown({ n: 1 }), '1 refused call is in a session that '
    + 'does not record whether you were there to answer, so the call can hold an answer that Sonah did not read');
  assert.equal(COVERAGE_SENTENCE.instructions_refusal_session_unknown({ n: 2 }), '2 refused calls are in a session that '
    + 'does not record whether you were there to answer, so any of them can hold an answer that Sonah did not read');
  const report = { repo: { host: 'github.com', id: 'l1s' }, pr: null, session: null, hasSessionEvidence: true,
    coverageFacts: { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 2, instructions: 2,
      instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 1, declared: 'partial' },
    decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [],
    gaps: [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 3, note: NOTE }],
    counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
    coverage: 'partial', codeCoverage: 'complete' };
  assert.deepEqual(coverageCauses(report).map(([cause, { n }]) => [cause, n]),
    [['instructions_refusal_session_unknown', 3]]);
  const header = causeLine(report);
  assert.match(header, /3 refused calls are in a session that does not record whether you were there to answer/);
});

// Review finding L1S-headless-parent-helper-refusal (not built: a helper run under a non-interactive parent is not
// handled apart). A helper's recording types no prompt, so its refusals carry this note; transferred into its parent's review
// they are declared and named by this cause, but a verified child's gap is child-scoped: it never makes the parent's own
// instruction history incomplete. The parent's own gap of the same note does.
test('L1 session-type review: a linked helper\'s unknown-type refusal is the child\'s loss, never the parent\'s history', () => {
  const session = { sessionKey: 'parent', children: [{ state: 'verified', childSession: 'helper', childId: 'c1' }],
    event: (id) => (id === 'C1-A1-0' ? { childId: 'c1' } : id === 'A1-0' ? { childId: null } : undefined) };
  const rootLoss = rootInstructionLossOf(session);
  const gap = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1, note: NOTE };
  assert.equal(rootLoss({ ...gap, sessionKey: 'helper', eventIds: ['C1-A1-0'] }), false, 'the helper\'s, transferred');
  assert.equal(rootLoss({ ...gap, sessionKey: 'helper' }), false, 'the helper\'s, unlocated');
  assert.equal(rootLoss({ ...gap, sessionKey: 'parent', eventIds: ['A1-0'] }), true, 'the parent\'s own');
});
