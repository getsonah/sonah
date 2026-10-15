// W2 (owner decision 2026-10-13; root cause 2): a row's `restsOn` names ACTIONs, and the model
// sometimes cites the RESULT of one (a claim id refused `not_action` can be the RESULT of the agent's own action,
// recorded before the statement). Code now checks such a RESULT as the ACTION the
// recorder typed it answers (its `invocation`) when the window showed that ACTION, accepts it by the ACTION's id, and
// counts each move (`restsOnRepaired`). Recorder provenance only; every check after the move is unchanged.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { restsOnCheck, claimRestsOn, checkedRequirement } from '../src/checklist.js';
import { runReview } from '../src/run-review.js';
import { RESTS_ON_REJECTIONS } from '../src/ledger.js';

const TEXT = {
  ask: 'SYNTHETIC_W2R_ASK: run the suite and tell me.',
  run: 'npm test',
  out: 'SYNTHETIC_W2R_OUT: This command requires approval',
  said: 'SYNTHETIC_W2R_SAID: I could not run the suite: it needs approval.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const events = () => [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
  // The recorder typed the call as refused before it ran: did-not-run (ledger.js `resultOutcome`).
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: whole('run'),
    input: [], changes: [], recorded: { denial: 'permission' }, ...T1 },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'failed',
    output: whole('out'), sourceOfResult: 'native', ...T1 },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 },
].map((event, sequence) => ({ ...event, sequence }));
const sessionOf = () => new Session({ sessionKey: 'sess-w2-rests', adapter: 'claude', blobs: { ...TEXT }, events: events(),
  children: [] });
const shownAll = { I1: [{ role: 'instruction', text: TEXT.ask }], A1: [{ role: 'action', text: TEXT.run }],
  'A1-r': [{ role: 'observation', text: TEXT.out }], C1: [{ role: 'commentary', text: TEXT.said }] };
const zeros = Object.fromEntries(RESTS_ON_REJECTIONS.map((reason) => [reason, 0]));

test('W2 restsOn: a cited RESULT is checked as the ACTION it answers, accepted by that ACTION\'s id, and counted', () => {
  const session = sessionOf();
  const said = session.event('C1');
  const one = restsOnCheck(session, ['A1-r'], { sourceMap: shownAll, anchor: said, before: true });
  assert.deepEqual(one, { accepted: ['A1'], rejected: zeros, repaired: 1 });
  // Cited both ways, it is one action, accepted once; the move is counted once.
  const both = restsOnCheck(session, ['A1-r', 'A1'], { sourceMap: shownAll, anchor: said, before: true });
  assert.deepEqual(both, { accepted: ['A1'], rejected: zeros, repaired: 1 });
  // The ACTION itself, as before: nothing moved.
  assert.deepEqual(restsOnCheck(session, ['A1'], { sourceMap: shownAll, anchor: said, before: true }),
    { accepted: ['A1'], rejected: zeros, repaired: 0 });
  // A claim's restsOn and a requirement's take the same move.
  assert.deepEqual(claimRestsOn(session, { stated: { eventId: 'C1' }, restsOn: ['A1-r'] }, shownAll).accepted, ['A1']);
  const row = checkedRequirement(session, { text: 'run the suite', status: 'not-checked', restsOn: ['A1-r'],
    instruction: { eventId: 'I1', role: 'instruction', quote: 'run the suite' } }, { sourceMap: shownAll });
  assert.deepEqual([row.candidate.restsOn, row.restsOnRepaired, row.restsOnRejected], [['A1'], 1, zeros]);
});

test('W2 restsOn: only a RESULT whose recorded ACTION the window showed moves; every later check is unchanged', () => {
  const session = sessionOf();
  const said = session.event('C1');
  // The ACTION was not shown to the window: still not_action, and nothing moved.
  const { A1: _hidden, ...noAction } = shownAll;
  assert.deepEqual(restsOnCheck(session, ['A1-r'], { sourceMap: noAction, anchor: said, before: true }),
    { accepted: [], rejected: { ...zeros, not_action: 1 }, repaired: 0 });
  // Not a RESULT (a message): not_action, as before.
  assert.deepEqual(restsOnCheck(session, ['I1'], { sourceMap: shownAll, anchor: said, before: true }),
    { accepted: [], rejected: { ...zeros, not_action: 1 }, repaired: 0 });
  // Moved, then refused by the checks after it: a claim's actions are recorded before it (out_of_order) …
  const ask = session.event('I1');
  assert.deepEqual(restsOnCheck(session, ['A1-r'], { sourceMap: shownAll, anchor: ask, before: true }),
    { accepted: [], rejected: { ...zeros, out_of_order: 1 }, repaired: 1 });
  // … and their check never completed (an ACTION whose RESULT ran to an end is `completed`).
  const ran = new Session({ sessionKey: 'sess-w2-rests-ran', adapter: 'claude', blobs: { ...TEXT }, children: [],
    events: events().map((event) => (event.id === 'A1' ? { ...event, recorded: {} }
      : event.id === 'A1-r' ? { ...event, result: 'succeeded', exitCode: 0, terminalStatusProven: true } : event)) });
  assert.deepEqual(restsOnCheck(ran, ['A1-r'], { sourceMap: shownAll, anchor: ran.event('C1'), before: true }),
    { accepted: [], rejected: { ...zeros, completed: 1 }, repaired: 1 });
});

test('W2 restsOn: a claim citing the RESULT of its unrun check is published "check did not complete", counted', async () => {
  const answer = { decisions: [], pivots: [], requirements: [], claims: [{ text: 'The agent could not run the suite.',
    stated: { eventId: 'C1', role: 'commentary', quote: 'I could not run the suite' }, restsOn: ['A1-r'] }] };
  const asked = [];
  const report = await runReview({ session: sessionOf(), pr: null, reviewScope: 'session-only', judge: async (request) => {
    if (!request.challenge) return structuredClone(answer);
    asked.push(...request.challenge.items);
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [{ eventId: 'C1', role: 'commentary', quote: 'I could not run the suite' }] })) };
  } });
  // Asked on the restsOn proposition, by the ACTION's id.
  const claim = asked.find((item) => item.type === 'claim');
  assert.deepEqual(claim.candidate.restsOn, ['A1']);
  assert.deepEqual(report.promises.map((p) => [p.status, p.restsOn]), [['incomplete', ['A1']]]);
  assert.deepEqual(report.counts.checklist.restsOnRepaired, { requirements: 0, claims: 1 });
  assert.deepEqual(report.counts.checklist.restsOnRejected.claims, zeros);
});
