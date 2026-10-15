// M33 V (2026-10-03). A decision with no instructionReview whose own instruction history cannot be certified is
// unchecked for that reason (`instructions_partial`, "instruction history incomplete"), never `column_unchecked` ("the
// claimed instruction was contradictory"). A window whose scope is incomplete tells the model not to answer, so on a
// real Claude Code session every such decision had no review, and the report blamed the model for a contradiction it
// never made. The column is unchecked either way; only the reason moves.
//
// Synthetic events only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';

const { groundDecision } = ledger;
const REPO = { host: 'github.com', id: '61' };
const ASK = 'SYNTHETIC_M33V_ASK: write the module.';
const PATH = 'src/one.js';
const PR = { repo: REPO, number: 1, enumeration: 'complete', files: [{ path: PATH, change: 'added', contentState: 'complete' }] };

/** One window: I1 C1 A1 O1. `omitted` marks the human's ask as not kept whole, so no decision after it is certifiable. */
function sessionOf({ omitted = false } = {}) {
  const blobs = { I1: ASK, said: 'SYNTHETIC_M33V_SAID: writing the module now.', ok: 'SYNTHETIC_M33V_OK: wrote 1 file.' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', text: whole('I1'), supersedes: [], ...(omitted ? { omitted: true } : {}) },
    { id: 'C1', kind: 'commentary', phase: 'working', text: whole('said') },
    { id: 'A1', kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATH }] },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', result: 'succeeded', output: whole('ok'),
      sourceOfResult: 'native', terminalStatusProven: true },
  ].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: 'sess-m33v', adapter: 'claude', events, blobs });
}

const decision = (instructionReview) => ({ dimension: 'SYNTHETIC_M33V_DIMENSION', chosen: `Write ${PATH}`, actions: ['A1'],
  value: PATH, valueReceipt: { eventId: 'A1', role: 'action', field: 'path', quote: PATH },
  stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_M33V_SAID' }, constrainedBy: null, instructionReview,
  actorSession: 'sess-m33v' });

function review(session) {
  const scopeDigest = /^scopeDigest: (\S+)$/m.exec(buildNarrativePrompt({ session, window: planWindows(session)[0] }).prompt)?.[1];
  return { dimension: 'SYNTHETIC_M33V_DIMENSION', scopeDigest, noRelevantInstruction: true,
    checks: [{ instruction: { eventId: 'I1', role: 'instruction', quote: ASK }, relevant: false,
      explanation: 'SYNTHETIC: this instruction names a module, not the dimension under review.' }] };
}

const ground = (session, candidate) => groundDecision({ repo: REPO, session, pr: PR, candidate, instructionHistoryComplete: true,
  upTo: 3 }).decision;

test('M33 V an uncertifiable history with no review is unchecked as instructions_partial, not column_unchecked', () => {
  const session = sessionOf({ omitted: true });
  assert.equal(ledger.instructionReviewScope(session, { upTo: 3 }).complete, false, 'premise: the scope is incomplete');
  const { column, columnState, reasons } = ground(session, decision(null));
  assert.equal(column, null);
  assert.equal(columnState, 'unchecked');
  assert.deepEqual(reasons, ['instructions_partial']);
});

test('M33 V a certifiable history keeps every earlier outcome: no review is column_unchecked, a good review is unasked', () => {
  const session = sessionOf();
  assert.equal(ledger.instructionReviewScope(session, { upTo: 3 }).complete, true, 'premise: the scope is complete');
  assert.deepEqual(ground(session, decision(null)).reasons, ['column_unchecked']);
  const grounded = ground(session, decision(review(session)));
  assert.equal(grounded.column, 'unasked');
  assert.equal(grounded.columnState, 'grounded');
});

test('M33 V an uncertifiable history is instructions_partial whatever the review says', () => {
  const session = sessionOf({ omitted: true });
  assert.deepEqual(ground(session, decision(review(sessionOf()))).reasons, ['instructions_partial']);
  assert.deepEqual(ground(session, decision({ dimension: 'other' })).reasons, ['instructions_partial']);
});
