// M33 G5 (C-06 "M33 session verdict"; C-02 "M33 native-first", after the G4 reviews). Two evidence
// defects, each tested on the shape that exposed it:
//   1. "`counts.promisesAsFindings` records how many." When EVERY claim became its contradicted-claim finding there
//      is no open promise left to list, and the count still says how many claims are their findings.
//   2. A native shortfall the capture counts is declared once, counted, on the lineage, and on an arc whose capture
//      carries the counters themselves. B5.2 (L8, D76): the slicer no longer splits arcs (step 6a), so nothing
//      writes the arc-only capture fields (`scope: 'lineage'`, `lineageUncertainty`, `observationGap`) and their
//      readers are removed; a stored ledger that still carries them is read without them.
// Synthetic sessions, ledgers and judges only: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// Namespace imports, so each test fails on its own against code that predates it.
import * as reviewRun from '../src/run-review.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

const { runReview } = reviewRun;

// ---- 1. every claim that became its finding is counted -------------------------------------------

const TEXT = {
  ask: 'SYNTHETIC_G5_ASK: add the retry helper and run the unit tests.',
  said: 'SYNTHETIC_G5_SAID: I added the retry helper and the unit tests pass now.',
  cmd: 'npm run test:unit',
  out: 'SYNTHETIC_G5_OUT: Tests: 1 failed, 4 passed, 5 total',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const claimsSession = () => new Session({ sessionKey: 'sess-g5-claims', adapter: 'claude', blobs: { ...TEXT }, events: [
  { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
  { id: 'C1', kind: 'commentary', sequence: 1, phase: 'final', text: whole('said'), beforeInvocation: null },
  { id: 'A1', kind: 'invocation', sequence: 2, callKey: 'a1', tool: 'Bash', operation: 'command',
    paths: [], command: whole('cmd'), input: [], changes: [] },
  { id: 'A1-r', kind: 'observation', sequence: 3, invocation: 'A1', callKey: 'a1', phase: 'terminal',
    result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
] });
const STATED = { eventId: 'C1', role: 'commentary', quote: 'I added the retry helper and the unit tests pass now.' };
const AGAINST = { eventId: 'A1-r', role: 'observation', quote: 'Tests: 1 failed, 4 passed, 5 total' };
const CLAIM = 'SYNTHETIC_G5 the unit tests pass';
const REQUIREMENT = { text: 'SYNTHETIC_G5 requirement', status: 'open',
  instruction: { eventId: 'I1', role: 'instruction', quote: 'add the retry helper and run the unit tests.' } };
const claimsJudge = (narrative) => async (request) => (request.challenge
  ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Recorded.',
    receipts: [STATED] })) }
  : { decisions: [], pivots: [], claims: [], requirements: [], ...narrative });

test('M33 G5 every claim became its finding: none is left open, and the count says how many', async () => {
  const report = await runReview({ session: claimsSession(), pr: null, reviewScope: 'session-only',
    judge: claimsJudge({ claims: [{ text: CLAIM, stated: STATED, contradictedBy: null },
      { text: CLAIM, stated: STATED, contradictedBy: AGAINST }], requirements: [REQUIREMENT] }) });
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted'], 'premise: the finding survived');
  assert.equal(report.promises.length, 0, 'premise: no open promise is left');
  assert.equal(report.counts.promisesAsFindings, 1, 'premise: counted');
  assert.ok(report.requirements.length > 0, 'premise: a requirements ledger is beside them');
});

// ---- 2. a counted native shortfall is declared once, counted ---------------------------------------

const INVENTORY_REASON = 'codex_native_inventory_incomplete';
const NATIVE = Object.freeze({
  nativeInventoryShortfall: ['actions', 'incomplete_inventory'],
  nativeCommandShortfall: ['observations', 'command_outcome_unknown'],
  nativeWriteShortfall: ['observations', 'write_outcome_unknown'],
});
const act = (turn) => ({ turn, seq: 0, kind: 'bash', cmd: `node step${turn}.js`, outcome: 'passed', exitCode: 0,
  exitCodeSource: 'native', tailLines: ['ok'] });
/** The whole lineage: two human requests, a native shortfall the slicer counted once. */
const lineage = (capture) => ({ ask: [{ turn: 1, text: 'Run the first step.' }, { turn: 2, text: 'Run the second step.' }],
  ledger: [act(1), act(2)], commentary: [], sayings: [], marks: [], dropped: [],
  capture: { incomplete: true, genericIncomplete: false, reasons: [INVENTORY_REASON], ...capture } });
/** One arc of it, in the shape the slicer's arc split gave until B5.2 step 6a: the capture carried under the lineage scope. */
const arc = (turn, capture) => ({ ask: [{ turn, text: `Run step ${turn}.` }], ledger: [act(turn)], commentary: [],
  sayings: [], marks: [], dropped: [], arc: { index: turn - 1, turn, until: null, turns: 1 },
  capture: { incomplete: true, genericIncomplete: false, reasons: [INVENTORY_REASON], scope: 'lineage', ...capture } });
const nativeGaps = (ledger) => sessionFromLedger(ledger, { sessionKey: 'g5-arc' }).adapterGaps
  .filter((g) => Object.values(NATIVE).some(([channel, code]) => g.channel === channel && g.code === code)
    && !(Array.isArray(g.eventIds) && g.eventIds.length));
const shape = (gaps) => gaps.map((g) => `${g.channel}/${g.code}:${g.count}`).sort();

test('M33 G5 anchor: the lineage declares its native shortfall once, counted', () => {
  const gaps = nativeGaps(lineage({ nativeInventoryShortfall: 1, nativeCommandShortfall: 1 }));
  assert.deepEqual(shape(gaps), ['actions/incomplete_inventory:1', 'observations/command_outcome_unknown:1']);
  assert.ok(gaps.every((g) => g.scope === 'session'));
});

test('M33 G5 an arc whose capture carries the counters themselves (per-arc attributed) declares them counted', () => {
  // The arc the loss was attributed to states it with its count; the arc it was not says nothing.
  assert.deepEqual(shape(nativeGaps(arc(1, { nativeInventoryShortfall: 1, nativeCommandShortfall: 1 }))),
    ['actions/incomplete_inventory:1', 'observations/command_outcome_unknown:1']);
  assert.deepEqual(shape(nativeGaps(arc(2, { reasons: [], incomplete: false }))), []);
  // B5.2 (L8, D76): a stored ledger that still carries the arc-only fields is read without them.
  const gapsOf = (capture) => sessionFromLedger(arc(1, capture), { sessionKey: 'g5-arc' }).adapterGaps;
  assert.deepEqual(gapsOf({ nativeInventoryShortfall: 1, observationGap: true,
    lineageUncertainty: { nativeInventoryShortfall: true, unsupportedActions: true, syntheticFutureLoss: 1 } }),
  gapsOf({ nativeInventoryShortfall: 1 }));
});
