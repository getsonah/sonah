// D79 (owner decision 2026-10-11): the re-ask merge keys a decision by its structure, not its wording. When a window
// is asked again — the proposal re-ask (`reaskedAnswer`) or the evidence re-ask (`servedAnswer`) — a decision of the
// second answer with the same cited actions, instruction receipt, stated receipt and not-acting as one already kept is
// the same decision, whatever its `dimension`, `chosen`, `value` or `valueReceipt` say (`proposalIdentity`, decisions
// channel: `decisionStructure`). Which copy is kept is unchanged (the proposal re-ask keeps the first answer's, the
// evidence re-ask its own), and so are the published ids (`decisionIdentity`) and the merge across windows
// (`mergeWindowOutputs`). The D79 review: a decision's structure is checked only against the OTHER answer's decisions,
// so two decisions of one answer that share a structure stay two (`acrossAnswersOnly`).
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, decisionIdentity } from '../src/session.js';
import * as reviewRun from '../src/run-review.js';

const REPO = { host: 'github.com', id: '0' };
const KEY = 'sess-d79';
const TEXT = {
  ask: 'SYNTHETIC_D79_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  check: 'node /srv/x/check.js',
  three: 'SYNTHETIC_D79_REPLAY: gaps=3',
  ok: 'SYNTHETIC_D79_CHECK: ok',
  claim: 'SYNTHETIC_D79_CLAIM: this change clears the gap.',
  leave: 'SYNTHETIC_D79_LEAVE: I will not touch the CSV writer.',
};
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const command = (id, key) => ({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
  command: ref(key), input: [], changes: [] });
const output = (id, invocation, key, failed) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: failed ? 'failed' : 'succeeded', exitCode: failed ? 1 : 0, terminalStatusProven: true,
  output: ref(key), sourceOfResult: 'native' });
/** One turn: the ask, a failing replay, a passing check, the claim and a statement of what the agent leaves alone. */
const session = () => new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT }, children: [], events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask') },
  command('A1', 'replay'), output('A1-r', 'A1', 'three', true),
  command('A2', 'check'), output('A2-r', 'A2', 'ok', false),
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('claim') },
  { id: 'C2', kind: 'commentary', phase: 'working', beforeInvocation: null, text: ref('leave') },
].map((event, sequence) => ({ ...event, turn: 'T1', sequence })) });

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
/** A decision's value receipt on a command's text (the contract's `field` and `role`). */
const valueReceipt = (quote) => ({ eventId: 'A1', field: 'command', role: 'action', quote });
const EMPTY = Object.freeze({ decisions: [], pivots: [], claims: [], requirements: [] });
/** A decision proposal outside the response contract (no `chosen`, no `actions`): no check can read it. */
const MALFORMED = Object.freeze({ dimension: 'SYNTHETIC_D79_UNREADABLE' });
const INSTRUCTION = Object.freeze({
  instruction: receipt('I1', 'instruction', 'make the synthetic replay report no gaps.'), settles: false });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const LEAVE = receipt('C2', 'commentary', 'I will not touch the CSV writer.');
/** The first answer's decision, and the re-ask's restatement of it: other words, another value and value receipt, the
 *  same cited action, no instruction, no stated receipt. */
const DECISION = Object.freeze({ dimension: 'replay target', chosen: 'the synthetic replay', value: 'replay.js',
  valueReceipt: valueReceipt('replay.js'), actions: ['A1'] });
const RESTATED = Object.freeze({ dimension: 'which replay script is run', chosen: 'the one under /srv/x, as recorded',
  value: 'node /srv/x/replay.js', valueReceipt: valueReceipt('node /srv/x/replay.js'), actions: ['A1'] });
/** Another decision, on the check. */
const OTHER = Object.freeze({ dimension: 'the check', chosen: 'run after the replay', actions: ['A2'] });
/** A choice not to act, anchored on the agent's words, and the same words read as acting. */
const NOT_ACTING = Object.freeze({ dimension: 'the CSV writer', chosen: 'left untouched', actions: [], stated: LEAVE,
  notActing: true });
const ACTING = Object.freeze({ ...NOT_ACTING, notActing: false });

const reasked = (first, second) => reviewRun.reaskedAnswer({ first: { ...EMPTY, decisions: [MALFORMED], ...first },
  second: { ...EMPTY, ...second }, session: session(), repo: REPO, sourceMap: null });
/** The decisions kept when the first answer proposed `first` (beside an unreadable item) and the re-ask `second`. */
const kept = (first, second) => reasked({ decisions: first }, { decisions: second }).narrative.decisions;

// ---- 1. a restatement is the same decision; the first answer's copy stands ---------------------------------------

test('D79 re-ask: a restatement in other words is the same decision; the first answer\'s copy stands', () => {
  const merged = reasked({ decisions: [DECISION] }, { decisions: [RESTATED] });
  assert.equal(merged.recovered, true, 'the re-ask read in full');
  assert.deepEqual(merged.narrative.decisions, [DECISION]);
  // Each of the model's wordings alone is no new decision: the dimension, the choice, the value, the value receipt.
  const wordings = {
    dimension: { ...DECISION, dimension: 'the replay that is run' },
    chosen: { ...DECISION, chosen: 'the recorded replay' },
    value: { ...DECISION, value: 'the replay script' },
    'no value': { ...DECISION, value: null, valueReceipt: null },
    'value receipt': { ...DECISION, valueReceipt: valueReceipt('node /srv/x/replay.js') },
  };
  for (const [name, other] of Object.entries(wordings)) assert.deepEqual(kept([DECISION], [other]), [DECISION], name);
  // The same actions in another order, or repeated, are one set; "none" is one meaning however it is spelled.
  const two = { ...DECISION, actions: ['A1', 'A2'] };
  assert.deepEqual(kept([two], [{ ...RESTATED, actions: ['A2', 'A1', 'A1'] }]), [two]);
  assert.deepEqual(kept([DECISION], [{ ...RESTATED, constrainedBy: null, stated: null }]), [DECISION]);
  const spelled = { ...DECISION, constrainedBy: null, stated: null };
  assert.deepEqual(kept([spelled], [RESTATED]), [spelled]);
  // Two restatements in the re-ask are both the present decision; another decision beside them is added.
  assert.deepEqual(kept([DECISION], [RESTATED, { ...RESTATED, chosen: 'x' }, OTHER]), [DECISION, OTHER]);
});

// ---- 2. another structure is another decision -------------------------------------------------------------------

test('D79 re-ask: another action set, instruction or stated receipt, or not-acting is another decision', () => {
  const apart = {
    'another action': { ...RESTATED, actions: ['A2'] },
    'one more action': { ...RESTATED, actions: ['A1', 'A2'] },
    'no action': { ...RESTATED, actions: [] },
    'an instruction receipt': { ...RESTATED, constrainedBy: INSTRUCTION },
    'a stated receipt': { ...RESTATED, stated: STATED },
  };
  for (const [name, other] of Object.entries(apart))
    assert.deepEqual(kept([DECISION], [other]), [DECISION, other], name);
  // The instruction receipt is the event and the quote: another event, or another quote of the same event, is another
  // structure; `settles` and the settled value are the model's reading of that receipt, not the structure.
  const constrained = { ...DECISION, constrainedBy: INSTRUCTION };
  const settled = { ...RESTATED, constrainedBy: { ...INSTRUCTION, settles: true, settledValueQuote: 'no gaps' } };
  assert.deepEqual(kept([constrained], [settled]), [constrained]);
  const otherQuote = { ...RESTATED, constrainedBy: { instruction: receipt('I1', 'instruction', 'report no gaps.'),
    settles: false } };
  assert.deepEqual(kept([constrained], [otherQuote]), [constrained, otherQuote]);
  const otherEvent = { ...RESTATED, constrainedBy: { ...INSTRUCTION, instruction: { ...INSTRUCTION.instruction,
    eventId: 'C1' } } };
  assert.deepEqual(kept([constrained], [otherEvent]), [constrained, otherEvent]);
  // So is the stated receipt.
  const anchored = { ...DECISION, stated: STATED };
  assert.deepEqual(kept([anchored], [{ ...RESTATED, stated: { ...STATED } }]), [anchored]);
  assert.deepEqual(kept([anchored], [{ ...RESTATED, stated: LEAVE }]), [anchored, { ...RESTATED, stated: LEAVE }]);
  // A choice not to act and the same words read as acting are two decisions; null, absent and false are one meaning.
  assert.deepEqual(kept([NOT_ACTING], [ACTING]), [NOT_ACTING, ACTING]);
  assert.deepEqual(kept([ACTING], [NOT_ACTING]), [ACTING, NOT_ACTING]);
  const { notActing, ...absent } = ACTING;
  assert.deepEqual(kept([ACTING], [{ ...ACTING, notActing: null }, absent]), [ACTING]);
  assert.deepEqual(kept([NOT_ACTING], [{ ...NOT_ACTING, dimension: 'the writer' }]), [NOT_ACTING]);
});

// ---- 3. the evidence re-ask: the re-ask's copy is the one kept --------------------------------------------------

test('D79 evidence re-ask: a first-answer decision the re-ask restates is dropped; the first\'s rest follows', () => {
  const first = { ...EMPTY, decisions: [DECISION, OTHER] };
  const served = reviewRun.servedAnswer({ first, reask: { ...EMPTY, decisions: [RESTATED] }, session: session(),
    repo: REPO, sourceMap: null });
  assert.deepEqual(served.narrative.decisions, [RESTATED, OTHER], 'the re-ask\'s copy stands; the other follows');
  assert.equal(served.fromFirst, 1);
  // Another structure in the re-ask keeps both copies, the first answer's after the re-ask's.
  const constrained = { ...RESTATED, constrainedBy: INSTRUCTION };
  const apart = reviewRun.servedAnswer({ first, reask: { ...EMPTY, decisions: [constrained] }, session: session(),
    repo: REPO, sourceMap: null });
  assert.deepEqual(apart.narrative.decisions, [constrained, DECISION, OTHER]);
  assert.equal(apart.fromFirst, 2);
});

// ---- 4. the published id and the merge across windows are unchanged ---------------------------------------------

test('D79: published decision ids still read the wording, and two windows\' restatements stay two decisions', () => {
  const candidate = (d) => ({ actorSession: KEY, dimension: d.dimension, value: d.value ?? null, actions: d.actions,
    stated: d.stated ?? null });
  assert.notEqual(decisionIdentity(REPO, candidate(DECISION)), decisionIdentity(REPO, candidate(RESTATED)),
    'the owner\'s answers are keyed by these ids: the wording stays part of them');
  assert.equal(decisionIdentity(REPO, candidate(DECISION)),
    decisionIdentity(REPO, candidate({ ...DECISION, chosen: 'x' })));
  const merged = reviewRun.mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [candidate(DECISION)], findings: [], requirements: [], promises: [] },
    { decisions: [candidate(RESTATED)], findings: [], requirements: [], promises: [] }] });
  assert.deepEqual(merged.decisions.map((d) => d.dimension), [DECISION.dimension, RESTATED.dimension]);
  // `toCandidates` reads a decision exactly as before.
  const [read] = reviewRun.toCandidates({ decisions: [RESTATED] }, session()).decisions;
  assert.deepEqual([read.dimension, read.chosen, read.value, read.actions, read.actorSession],
    [RESTATED.dimension, RESTATED.chosen, RESTATED.value, ['A1'], KEY]);
});

// ---- 5. end to end: one decision published, under the first answer's words; checked once -------------------------

test('D79 end to end: a review whose re-ask restates a decision publishes it once, with the first\'s id', async () => {
  const constrained = { ...RESTATED, constrainedBy: INSTRUCTION };
  const answers = [{ ...EMPTY, decisions: [DECISION, MALFORMED] }, { ...EMPTY, decisions: [RESTATED, constrained] }];
  let nth = 0;
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Recorded.', receipts: [STATED] })) };
    return structuredClone(answers[Math.min(nth++, answers.length - 1)]);
  };
  const report = await reviewRun.runReview({ session: session(), pr: null, reviewScope: 'session-only', judge });
  assert.deepEqual(report.counts.proposalReasks, { asked: 1, recovered: 1, unreadable: 0 });
  assert.deepEqual(report.windowResults[0].narrative.decisions.map((d) => d.dimension),
    [DECISION.dimension, RESTATED.dimension], 'the restatement is not kept; the constrained copy is');
  assert.deepEqual(report.decisions.map((d) => [d.dimension, d.chosen]).sort(),
    [[DECISION.dimension, DECISION.chosen], [RESTATED.dimension, RESTATED.chosen]].sort());
  const published = report.decisions.find((d) => d.dimension === DECISION.dimension);
  assert.equal(published.id, decisionIdentity(REPO, { actorSession: KEY, dimension: DECISION.dimension,
    value: published.value, actions: ['A1'], stated: null }), 'the published id is the first answer\'s');
  // Each kept decision is asked once in the first challenge pass; the restatement is never asked.
  const items = seen.filter((r) => r.challenge && r.challenge.pass === 1).flatMap((r) => r.challenge.items)
    .filter((item) => item.type === 'decision');
  assert.deepEqual(items.map((item) => item.candidate.dimension).sort(),
    [DECISION.dimension, RESTATED.dimension].sort());
  const restated = items.filter((item) => item.candidate.chosen === RESTATED.chosen && !item.candidate.constrainedBy);
  assert.equal(restated.length, 0, 'the restatement without the instruction is never asked');
});

// ---- 6. purity, determinism, bad input --------------------------------------------------------------------------

test('D79 re-ask: pure and deterministic; an unreadable structure is never dropped, nothing throws', () => {
  const first = { ...EMPTY, decisions: [DECISION, MALFORMED] };
  const second = { ...EMPTY, decisions: [RESTATED, { ...RESTATED, constrainedBy: INSTRUCTION }] };
  const before = structuredClone([first, second]);
  const once = reviewRun.reaskedAnswer({ first, second, session: session(), repo: REPO, sourceMap: null });
  assert.deepEqual(reviewRun.reaskedAnswer({ first, second, session: session(), repo: REPO, sourceMap: null }), once);
  assert.deepEqual([first, second], before, 'the answers are not changed');
  // Outside the contract (an action that is not a string, a receipt that is not an object, `constrainedBy` not an
  // object): unreadable, so never remembered as present and never added; the first answer's readable copy stands.
  const garbage = [{ ...RESTATED, actions: ['A1', 7] }, { ...RESTATED, stated: 'C1' },
    { ...RESTATED, constrainedBy: 5 }, { ...RESTATED, constrainedBy: { settles: true } }, null, 'SYNTHETIC', 5];
  const unread = reviewRun.reaskedAnswer({ first, second: { ...EMPTY, decisions: garbage }, session: session(),
    repo: REPO, sourceMap: null });
  assert.equal(unread.recovered, false);
  assert.deepEqual(unread.narrative.decisions, [DECISION, MALFORMED]);
});

// ---- 7. D79 review: a structure is checked only against the OTHER answer's decisions ------------------------------

/** Another decision on the same action as `DECISION`, with no receipt either: the same structure, another decision. */
const SIBLING = Object.freeze({ dimension: 'how often the replay is run', chosen: 'once', actions: ['A1'] });

test('D79 review: two decisions of one answer that share a structure stay two; only the other answer is read', () => {
  // The evidence re-ask: the first answer's two decisions, the re-ask holding neither — both kept, both counted.
  const served = (first, reask) => reviewRun.servedAnswer({ first: { ...EMPTY, decisions: first },
    reask: { ...EMPTY, decisions: reask }, session: session(), repo: REPO, sourceMap: null });
  const both = served([DECISION, SIBLING], []);
  assert.deepEqual(both.narrative.decisions, [DECISION, SIBLING]);
  assert.equal(both.fromFirst, 2);
  // Beside a re-ask decision of another structure: still both, after it.
  const constrained = { ...RESTATED, constrainedBy: INSTRUCTION };
  const beside = served([DECISION, SIBLING], [constrained]);
  assert.deepEqual(beside.narrative.decisions, [constrained, DECISION, SIBLING]);
  assert.equal(beside.fromFirst, 2);
  // The proposal re-ask: the re-ask's two decisions, the first answer holding neither (an unreadable item only).
  const reask = reasked({ decisions: [MALFORMED] }, { decisions: [DECISION, SIBLING] });
  assert.equal(reask.recovered, true);
  assert.deepEqual(reask.narrative.decisions, [DECISION, SIBLING]);
  assert.deepEqual(kept([constrained], [DECISION, SIBLING]), [constrained, DECISION, SIBLING]);
  // A restatement of what the other answer holds is still that decision (D79): the first answer's two stand.
  assert.deepEqual(kept([DECISION, SIBLING], [RESTATED]), [DECISION, SIBLING]);
  assert.deepEqual(kept([DECISION], [RESTATED, SIBLING, OTHER]), [DECISION, OTHER]);
  // The other answers' channels are read as before: two identical pivots of one answer are still one.
  const pivot = { abandoned: 'x', adopted: 'y', receipts: [STATED] };
  assert.deepEqual(reasked({ decisions: [MALFORMED] }, { decisions: [], pivots: [pivot, { ...pivot }] })
    .narrative.pivots, [pivot]);
});
