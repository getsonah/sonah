// OWNER DECISION B (2026-10-01; amends D59). "Decided without asking you" (the `unasked` column) could not fire on a
// real review: every window's human-instruction scope read `complete: false`, so the prompt told the model not to
// answer, and it complied. Three of the causes are fixed here, in code, with nothing the model says deciding them:
//
//   1. A root instructions/identity gap is a loss for a bound only when it is unlocated, or names an event at or
//      before the bound. A gap is located only when it counts exactly the events it names (`count ===
//      eventIds.length`) and every one of them can be placed; anything else is unlocated, session-level, as D59 kept.
//   2. Completeness is judged per DECISION, against the asks recorded before its earliest action — the very asks its
//      checks already cover — never per window. M33 U repair (the owner's decision, made whole): the decision's own
//      span counts too. A loss located at or before ANY of its cited actions makes it incomplete (an unresolved answer
//      at its own question call); a human instruction recorded after its earliest action and at or before its latest
//      one (which its checks never cover) does too; and a decision that asked the human — it cites a question call, or
//      an instruction answers one it cites — was not decided without asking. Only a loss after every cited action
//      leaves it complete. An action before every human instruction still has no history to certify.
//   3. The window's request says, in code's words, which decisions its scope is complete for when the window as a
//      whole is not (`completeFor`), so a model may answer for those and only those.
//
// Every byte is synthetic: invented instructions, paths and outputs. No model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import { buildNarrativePrompt, PROMPT_VERSION } from '../src/prompt.js';
import { planWindows } from '../src/windows.js';

const { instructionReviewScope, instructionCompleteRange, decisionInstructionHistoryComplete, groundDecision,
  asksHuman } = ledger;
const REPO = { host: 'github.com', id: 'u1' };
const TEXT = {
  I1: 'SYNTHETIC_U_ASK_ONE: write the first module.',
  IQ: 'SYNTHETIC_U_ASK_MIDDLE: also keep a changelog entry.',
  I9: 'SYNTHETIC_U_ASK_LATER: now review everything again.',
  C1: 'SYNTHETIC_U_SAID_1: writing module one now.', C2: 'SYNTHETIC_U_SAID_2: writing module two now.',
  O1: 'SYNTHETIC_U_OK_1: wrote 1 file.', O2: 'SYNTHETIC_U_OK_2: wrote 1 file.',
};
const PATHS = { A1: 'src/one.js', A2: 'src/two.js' };

/**
 * One window, no compaction:
 *   0 I1 · 1 C1 · 2 A1 · 3 O1 · 4 IQ · 5 C2 · 6 A2 · 7 O2 [· 8 I9 when `tail`]
 * `partial` marks IQ omitted and capped (its middle was cut before review), the shape every real capped ask has.
 */
function sessionOf({ partial = false, tail = false, gaps } = {}) {
  const blobs = { ...TEXT };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [];
  const push = (event) => events.push({ ...event, sequence: events.length });
  const instruction = (id, extra = {}) => push({ id, kind: 'instruction', authority: 'human', text: whole(id), supersedes: [], ...extra });
  const step = (n) => {
    push({ id: `C${n}`, kind: 'commentary', phase: 'working', text: whole(`C${n}`) });
    push({ id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATHS[`A${n}`] }] });
    push({ id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded',
      output: whole(`O${n}`), sourceOfResult: 'native', terminalStatusProven: true });
  };
  instruction('I1'); step(1);
  instruction('IQ', partial ? { omitted: true, capped: true } : {});
  step(2);
  if (tail) instruction('I9');
  const session = new Session({ sessionKey: 'sess-u', adapter: 'claude', events, blobs });
  if (gaps) session.adapterGaps = gaps;
  return session;
}
const gap = (eventIds, extra = {}) => ({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
  ...(eventIds === undefined ? {} : { eventIds }), ...(eventIds === undefined ? {} : { count: eventIds.length }), ...extra });
const complete = (session, upTo) => instructionReviewScope(session, upTo === undefined ? undefined : { upTo }).complete;

// ---- 1. a located gap is a loss only at or after the event it names ------------------------------------------------

test('U a located root instruction gap after the bound no longer blocks the bounded scope', () => {
  for (const channel of ['instructions', 'identity', 'a-channel-this-code-does-not-know']) {
    const session = sessionOf({ tail: true, gaps: [gap(['I9'], { channel })] });
    assert.equal(complete(session, 7), true, `${channel}: named after the bound`);
    assert.equal(complete(session, 8), false, `${channel}: the bound reaches the named event`);
    assert.equal(complete(session), false, `${channel}: the whole session still carries the loss`);
  }
});

test('U a located gap at or before the bound still blocks it', () => {
  const at = (ids) => sessionOf({ tail: true, gaps: [gap(ids)] });
  assert.equal(complete(at(['I1']), 0), false);
  assert.equal(complete(at(['I1']), 7), false);
  assert.equal(complete(at(['A2']), 5), true, 'A2 (sequence 6) is after bound 5');
  assert.equal(complete(at(['A2']), 6), false, 'and at bound 6');
  assert.equal(complete(at(['I9', 'A1']), 7), false, 'one named event at or before the bound is enough');
});

test('U a gap is located only when it counts exactly the events it names, each of which can be placed', () => {
  const unlocated = [
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session' },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: ['I9'] },        // no count
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: ['I9'], count: null },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: ['I9'], count: 2 },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: ['I9'], count: '1' },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: [], count: 0 },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: [9], count: 1 },
    { code: 'incomplete_inventory', channel: 'identity', scope: 'session', eventIds: 'I9', count: 1 },
    // Names an event the session does not hold: where the loss is cannot be placed.
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', eventIds: ['X404'], count: 1 },
  ];
  for (const g of unlocated)
    assert.equal(complete(sessionOf({ tail: true, gaps: [g] }), 3), false, JSON.stringify(g));
  // An event whose sequence cannot be placed cannot place the loss either.
  const session = sessionOf({ tail: true, gaps: [gap(['I9'])] });
  session.event('I9').sequence = 8.5;
  assert.equal(complete(session, 3), false);
});

test('U gaps that cannot hide a root human ask still never block, located or not', () => {
  for (const g of [gap(['I1'], { channel: 'actions' }), gap(undefined, { channel: 'observations' }), gap(['I1'], { scope: 'pr' })])
    assert.equal(complete(sessionOf({ gaps: [g] }), 7), true, JSON.stringify(g));
});

// ---- 2. per-decision completeness -----------------------------------------------------------------------------------

const PR = { repo: REPO, number: 1, enumeration: 'complete',
  files: Object.values(PATHS).map((path) => ({ path, change: 'added', contentState: 'complete' })) };
const check = (id) => ({ instruction: { eventId: id, role: 'instruction', quote: TEXT[id] }, relevant: false,
  explanation: 'SYNTHETIC: this instruction names a module, not the dimension under review.' });
/** An unasked decision about `action`, its review copied from the window's own request. */
function unasked(session, action, checks) {
  const n = action.slice(1);
  const scopeDigest = instructionReviewScope(session, { upTo: 7 }).scopeDigest;
  return { dimension: 'SYNTHETIC_U_DIMENSION', chosen: `Write ${PATHS[action]}`, actions: [action], value: PATHS[action], actorSession: 'sess-u',
    valueReceipt: { eventId: action, role: 'action', field: 'path', quote: PATHS[action] },
    stated: { eventId: `C${n}`, role: 'commentary', quote: `SYNTHETIC_U_SAID_${n}` }, constrainedBy: null,
    instructionReview: { dimension: 'SYNTHETIC_U_DIMENSION', scopeDigest, noRelevantInstruction: true,
      checks: checks.map(check) } };
}
const ground = (session, candidate, upTo = 7) => groundDecision({ repo: REPO, session, pr: PR, candidate,
  instructionHistoryComplete: true, upTo }).decision;

test('U a decision is judged against the asks before its earliest action, not the window', () => {
  const session = sessionOf({ partial: true });
  assert.equal(complete(session, 7), false, 'premise: the window as a whole is incomplete (IQ was capped)');
  const before = ground(session, unasked(session, 'A1', ['I1']));
  assert.equal(before.column, 'unasked', 'A1 precedes the capped ask: its history is complete');
  assert.equal(before.columnState, 'grounded');
  const after = ground(session, unasked(session, 'A2', ['I1', 'IQ']));
  assert.equal(after.column, null, 'A2 follows the capped ask: never certified');
  assert.deepEqual(after.reasons, ['instructions_partial']);
  // The digest is still the window's: a review that copied another scope is refused.
  const other = unasked(session, 'A1', ['I1']);
  other.instructionReview.scopeDigest = instructionReviewScope(session, { upTo: 1 }).scopeDigest;
  assert.deepEqual(ground(session, other).reasons, ['receipt_rejected']);
  // And the checks are still every ask before the earliest action, no more and no fewer.
  assert.equal(ground(session, unasked(session, 'A1', [])).column, null);
  assert.equal(ground(session, unasked(session, 'A1', ['I1', 'IQ'])).column, null);
});

test('U a located loss after every cited action does not stop the decision; one at or before any of them does', () => {
  const answered = sessionOf({ gaps: [gap(['A2'])] });  // e.g. an unresolved human answer at A2, its own question call
  assert.equal(complete(answered, 7), false, 'premise');
  assert.equal(ground(answered, unasked(answered, 'A1', ['I1'])).column, 'unasked', 'the loss is after A1');
  // M33 U repair (recheck major 1): 8cd731c certified this one, bounding the decision just before A2 itself.
  assert.deepEqual(ground(answered, unasked(answered, 'A2', ['I1', 'IQ'])).reasons, ['instructions_partial'],
    'one located at the earliest action blocks it: the loss is the decision\'s own');
  const earlier = sessionOf({ gaps: [gap(['O1'])] });
  assert.deepEqual(ground(earlier, unasked(earlier, 'A2', ['I1', 'IQ'])).reasons, ['instructions_partial']);
  assert.equal(ground(earlier, unasked(earlier, 'A1', ['I1'])).column, 'unasked');
});

/**
 * One window, two actions in one turn with nothing said between them:
 *   0 I1 · 1 C1 · 2 A1 · 3 O1 · 4 C2 · 5 A2 · 6 O2
 * `question` makes A1 a question call (the adapter's `asksHuman` flag, M33 brittleness L3; `tool` is its recorded name,
 * which evidence code never reads); `answer` records the human's answer to it after O1.
 */
function spanSession({ gaps, question = false, answer = false, answerTo = 'A1', tool = 'AskUserQuestion' } = {}) {
  const blobs = { ...TEXT, IA: 'SYNTHETIC_U_ANSWER: --strict' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [];
  const push = (event) => events.push({ ...event, sequence: events.length });
  push({ id: 'I1', kind: 'instruction', authority: 'human', text: whole('I1'), supersedes: [] });
  push({ id: 'C1', kind: 'commentary', phase: 'working', text: whole('C1') });
  push({ id: 'A1', kind: 'invocation', operation: question ? 'other' : 'write', tool: question ? tool : 'Write',
    ...(question ? { asksHuman: true } : {}), paths: [{ path: PATHS.A1 }] });
  push({ id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', result: 'succeeded', output: whole('O1'),
    sourceOfResult: 'native', terminalStatusProven: true });
  if (answer) push({ id: 'I1-1', kind: 'instruction', authority: 'human', text: whole('IA'), supersedes: [], answerTo });
  push({ id: 'C2', kind: 'commentary', phase: 'working', text: whole('C2') });
  push({ id: 'A2', kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATHS.A2 }] });
  push({ id: 'O2', kind: 'observation', phase: 'terminal', invocation: 'A2', result: 'succeeded', output: whole('O2'),
    sourceOfResult: 'native', terminalStatusProven: true });
  const session = new Session({ sessionKey: 'sess-u', adapter: 'claude', events, blobs });
  if (gaps) session.adapterGaps = gaps;
  return session;
}
/** An unasked decision citing `actions` (its value the last one's path), its review copied from the window's request. */
function unaskedOf(session, actions, checks) {
  const last = actions[actions.length - 1];
  const scopeDigest = instructionReviewScope(session, { upTo: 7 }).scopeDigest;
  return { dimension: 'SYNTHETIC_U_DIMENSION', chosen: `Write ${PATHS[last]}`, actions, value: PATHS[last],
    actorSession: 'sess-u', valueReceipt: { eventId: last, role: 'action', field: 'path', quote: PATHS[last] },
    stated: null, constrainedBy: null,
    instructionReview: { dimension: 'SYNTHETIC_U_DIMENSION', scopeDigest, noRelevantInstruction: true,
      checks: checks.map((id) => ({ instruction: { eventId: id, role: 'instruction',
        quote: id === 'I1-1' ? 'SYNTHETIC_U_ANSWER: --strict' : TEXT[id] }, relevant: false,
      explanation: 'SYNTHETIC: this instruction names a module, not the dimension under review.' })) } };
}

test('U a loss located at or between a decision\'s cited actions is its own; one after them is not', () => {
  const plain = spanSession();
  assert.equal(ground(plain, unaskedOf(plain, ['A1', 'A2'], ['I1'])).column, 'unasked', 'premise: nothing lost');
  for (const named of [['A1'], ['O1'], ['C2'], ['A2']]) {
    const session = spanSession({ gaps: [gap(named)] });
    assert.deepEqual(ground(session, unaskedOf(session, ['A1', 'A2'], ['I1'])).reasons, ['instructions_partial'],
      `a loss at ${named} is within [A1, A2]`);
  }
  const after = spanSession({ gaps: [gap(['O2'])] });
  assert.equal(ground(after, unaskedOf(after, ['A1', 'A2'], ['I1'])).column, 'unasked', 'a loss after A2 is not the decision\'s');
  const atA2 = spanSession({ gaps: [gap(['A2'])] });
  assert.equal(ground(atA2, unaskedOf(atA2, ['A1'], ['I1'])).column, 'unasked', 'nor after A1, for a decision citing A1 only');
});

test('U a human instruction recorded within a decision\'s span leaves it unchecked: its checks never cover it', () => {
  // sessionOf: IQ (sequence 4) between A1 (2) and A2 (6); a complete, uncapped ask.
  const session = sessionOf();
  assert.equal(complete(session, 7), true, 'premise: the window is complete');
  assert.equal(ground(session, unaskedOf(session, ['A1'], ['I1'])).column, 'unasked');
  assert.equal(ground(session, unaskedOf(session, ['A2'], ['I1', 'IQ'])).column, 'unasked');
  const both = ground(session, unaskedOf(session, ['A1', 'A2'], ['I1']));
  assert.equal(both.column, null, 'IQ was recorded after A1 and before A2: no check covers it');
  assert.deepEqual(both.reasons, ['instructions_partial']);
  // A check of IQ cannot stand in for it: the checks are exactly the asks before the earliest action.
  assert.equal(ground(session, unaskedOf(session, ['A1', 'A2'], ['I1', 'IQ'])).column, null);
});

test('U a decision that asked the human was not decided without asking: never unasked', () => {
  // M33 brittleness L3: no tool-name list in evidence code; the recorder adapter's flag decides.
  assert.equal(ledger.HUMAN_QUESTION_TOOLS, undefined);
  assert.equal(asksHuman({ kind: 'invocation', asksHuman: true }), true);
  for (const event of [{ kind: 'invocation', tool: 'AskUserQuestion' }, { kind: 'invocation', asksHuman: 'true' },
    { kind: 'observation', asksHuman: true }, null]) assert.equal(asksHuman(event), false, JSON.stringify(event));
  // Recheck P8: the answer lies between the question call and the edit.
  const answered = spanSession({ question: true, answer: true });
  for (const actions of [['A1'], ['A1', 'A2']])
    assert.deepEqual(ground(answered, unaskedOf(answered, actions, ['I1'])).reasons, ['instructions_partial'], `${actions}`);
  // The edit alone, after the answer, is checked against it like any ask recorded before it.
  assert.equal(ground(answered, unaskedOf(answered, ['A2'], ['I1', 'I1-1'])).column, 'unasked');
  assert.equal(ground(answered, unaskedOf(answered, ['A2'], ['I1'])).column, null, 'and never without it');
  // The question call with no answer recorded at all: still a question the decision asked.
  const unanswered = spanSession({ question: true });
  assert.deepEqual(ground(unanswered, unaskedOf(unanswered, ['A1'], ['I1'])).reasons, ['instructions_partial']);
  assert.equal(ground(unanswered, unaskedOf(unanswered, ['A2'], ['I1'])).column, 'unasked', 'a later action did not ask');
  // An instruction that answers a cited action, whatever that action's tool.
  const answersA1 = spanSession({ answer: true });
  assert.deepEqual(ground(answersA1, unaskedOf(answersA1, ['A1'], ['I1'])).reasons, ['instructions_partial']);
  const answersA2 = spanSession({ answer: true, answerTo: 'A2' });
  assert.equal(ground(answersA2, unaskedOf(answersA2, ['A1'], ['I1'])).column, 'unasked', 'it answers no cited action');
});

test('U L3: only the adapter\'s flag says a call asked the human, whatever the harness names its tool', () => {
  // Another harness's question tool, flagged by its own adapter: asked, like Claude's.
  const codex = spanSession({ question: true, tool: 'request_user_input_async' });
  assert.deepEqual(ground(codex, unaskedOf(codex, ['A1'], ['I1'])).reasons, ['instructions_partial']);
  // A call named like Claude's question tool that no adapter flagged is no question to evidence code.
  const named = spanSession();
  Object.assign(named.event('A1'), { operation: 'other', tool: 'AskUserQuestion' });
  assert.equal(decisionInstructionHistoryComplete(named, [named.event('A1')]), true);
});

test('U decisionInstructionHistoryComplete is the per-decision rule the grounding applies', () => {
  const session = sessionOf();
  const at = (...ids) => ids.map((id) => session.event(id));
  assert.equal(decisionInstructionHistoryComplete(session, at('A1')), true);
  assert.equal(decisionInstructionHistoryComplete(session, at('A1', 'A2')), false);
  assert.equal(decisionInstructionHistoryComplete(session, []), false);
  assert.equal(decisionInstructionHistoryComplete(session, [{ sequence: 2.5 }]), false);
  assert.equal(decisionInstructionHistoryComplete(session, [{ sequence: 0 }]), false, 'before every human ask');
});

test('U an action before every human instruction has no history to certify, in a complete window too', () => {
  const blobs = { ...TEXT };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-u', adapter: 'claude', blobs, events: [
    { id: 'C1', kind: 'commentary', phase: 'working', text: whole('C1'), sequence: 0 },
    { id: 'A1', kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATHS.A1 }], sequence: 1 },
    { id: 'O1', kind: 'observation', phase: 'terminal', invocation: 'A1', result: 'succeeded', output: whole('O1'),
      sourceOfResult: 'native', terminalStatusProven: true, sequence: 2 },
    { id: 'I1', kind: 'instruction', authority: 'human', text: whole('I1'), supersedes: [], sequence: 3 }] });
  assert.equal(complete(session, 3), true, 'premise: the window is complete');
  const candidate = unasked(session, 'A1', []);
  candidate.instructionReview.scopeDigest = instructionReviewScope(session, { upTo: 3 }).scopeDigest;
  const decision = groundDecision({ repo: REPO, session, pr: PR, candidate, instructionHistoryComplete: true, upTo: 3 }).decision;
  assert.equal(decision.column, null);
  assert.deepEqual(decision.reasons, ['instructions_partial']);
});

// ---- 3. the range a window's scope is complete for, and what its request says -------------------------------------

test('U instructionCompleteRange names the earliest-action sequences whose history is complete', () => {
  // M33 U repair: a decision's history must be complete AT its earliest action too, so the range ends just before the
  // first cause (the capped IQ at 4; a loss at A2, 6).
  assert.deepEqual(instructionCompleteRange(sessionOf({ partial: true }), { upTo: 7 }), { from: 1, through: 3 });
  assert.deepEqual(instructionCompleteRange(sessionOf(), { upTo: 7 }), { from: 1, through: 7 });
  assert.deepEqual(instructionCompleteRange(sessionOf({ gaps: [gap(['A2'])] }), { upTo: 7 }), { from: 1, through: 5 });
  assert.equal(instructionCompleteRange(sessionOf({ gaps: [gap(undefined)] }), { upTo: 7 }), null, 'an unlocated loss');
  assert.equal(instructionCompleteRange(sessionOf({ gaps: [gap(['I1'])] }), { upTo: 7 }), null, 'a loss at the first ask');
  const flagged = sessionOf(); flagged.instructionHistoryComplete = false;
  assert.equal(instructionCompleteRange(flagged, { upTo: 7 }), null);
  assert.deepEqual(instructionCompleteRange(sessionOf({ tail: true, partial: true })), { from: 1, through: 3 }, 'whole session');
});

/** A deterministic generator of small sessions mixing every input the scope reads. */
function randomSession(seed) {
  let x = seed * 2654435761 % 4294967296 || 1;
  const next = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  const pick = (list) => list[Math.floor(next() * list.length)];
  const blobs = { a: 'SYNTHETIC_U_A: one instruction.', b: 'SYNTHETIC_U_B: another one.', e: '' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [];
  const n = 4 + Math.floor(next() * 9);
  for (let i = 0; i < n; i++) {
    const roll = next();
    const sequence = next() < 0.06 ? pick([i - 1, 2.5, -1]) : i;
    const id = next() < 0.06 && i > 0 ? events[0].id : `E${i}`;
    if (roll < 0.4) events.push({ id, kind: 'instruction', sequence, supersedes: [],
      authority: next() < 0.85 ? 'human' : 'agent', text: next() < 0.1 ? ref('e') : next() < 0.1 ? [...ref('a'), ...ref('b')] : ref(pick(['a', 'b'])),
      ...(next() < 0.12 ? { omitted: true } : {}) });
    else events.push({ id, kind: pick(['commentary', 'invocation']), sequence, phase: 'working', text: ref('a') });
  }
  const session = new Session({ sessionKey: `rand-${seed}`, adapter: 'claude', events, blobs });
  const named = () => pick(events).id;
  session.adapterGaps = [];
  for (let k = Math.floor(next() * 3); k > 0; k--) {
    const ids = next() < 0.8 ? [named()] : [named(), 'X404'];
    session.adapterGaps.push({ code: 'incomplete_inventory', channel: pick(['instructions', 'identity', 'actions']),
      scope: 'session', eventIds: ids, count: next() < 0.85 ? ids.length : ids.length + 1 });
  }
  if (next() < 0.05) session.instructionHistoryComplete = false;
  return session;
}

test('U the range agrees with the per-decision rule at every earliest action, on many generated sessions', () => {
  for (let seed = 1; seed <= 600; seed++) {
    const session = randomSession(seed);
    const top = Math.max(0, ...session.events.map((e) => (Number.isSafeInteger(e.sequence) ? e.sequence : 0)));
    for (const upTo of [null, ...Array.from({ length: top + 2 }, (_, b) => b - 1)]) {
      const range = instructionCompleteRange(session, upTo === null ? undefined : { upTo });
      const last = upTo === null ? top + 2 : upTo;
      for (let a = -2; a <= last; a++) {
        // A decision citing one action at `a` that asked no question: the range's own definition.
        const expected = decisionInstructionHistoryComplete(session, [{ sequence: a }]);
        const inRange = range !== null && a >= range.from && a <= range.through;
        assert.equal(inRange, expected, `seed ${seed} upTo ${upTo} earliest action ${a}`);
      }
    }
  }
});

test('U an incomplete window states which decisions its scope is complete for; a complete one is unchanged', () => {
  // M33 N moved it once more (`sonah.narrative/14`): a session-only request asks for edits against a human instruction.
  // Status fact moved it once more (`sonah.narrative/15`): a "status:" line under an uncovered result, three task lines.
  // H3 moved it once more (`sonah.narrative/16`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.narrative/15`): a removal or a deletion is a forbidden edit too.
  // M33 integration moved it once more (`sonah.narrative/17`): one version above every branch's own (C-05 integration).
  // The M33 labels merge moved it once more (`sonah.narrative/18`): the slice-time marker headers.
  // Stable event ids moved it once more (`sonah.narrative/19`): every recorded event's id (C-01 event identity).
  // The D64 wording moved it once more (`sonah.narrative/20`): the proposer's two disclosure sentences.
  // M35 windowing moved it once more (`sonah.narrative/21`): windows, carried context, trims, aliases (C-07).
  // M36 phase 1 moved it once more (`sonah.narrative/22`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.narrative/23`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.narrative/24`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.narrative/25`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.narrative/26`): a combined request's omission lines offer no request (F2), the ledger moved (typed withholding, paths as recorded) (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.narrative/27), and D71 (S3) once more (sonah.narrative/28): the new channels (D71_CHANNELS_VERSIONS).
  // The D80 integration moved it once more (sonah.narrative/31): a stopped call's outcome line (D80_VERSIONS).
  // The asks fixes moved it once more (sonah.narrative/33): S3's re-ask of a refuted requirement.
  // W1 A moved it once more (sonah.narrative/34): the re-ask of a decision refuted on who decided it.
  // The release review moved it once more (sonah.narrative/35): a project instruction file the session wrote
  // is left out of the window's project files. The second release review moved it once more
  // (sonah.narrative/36): that file's path is compared under the working directory. G2 moved it once more
  // (sonah.narrative/37): the re-ask of a choice not to act whose existence check refuted its words.
  assert.equal(PROMPT_VERSION, 'sonah.narrative/37');
  const session = sessionOf({ partial: true });
  const [window] = planWindows(session);
  const { evidencePrompt } = buildNarrativePrompt({ session, window });
  assert.match(evidencePrompt, /^complete: false\ncompleteFor: earliest action sequence 1 through 3$/m);
  assert.ok(evidencePrompt.includes('If complete is false, emit instructionReview only for a decision whose earliest action'
    + '\nsequence is within completeFor. A digest proves scope identity, not relevance.'));
  assert.ok(!evidencePrompt.includes('If complete is false, do not emit instructionReview.'));
  // A window with nothing complete keeps the old words exactly.
  const lost = sessionOf({ gaps: [gap(undefined)] });
  const lostPrompt = buildNarrativePrompt({ session: lost, window: planWindows(lost)[0] }).evidencePrompt;
  assert.match(lostPrompt, /^complete: false\n\nThis is captured/m);
  assert.ok(lostPrompt.includes('If complete is false, do not emit instructionReview. A digest proves scope identity, not relevance.'));
  // A complete window says nothing new.
  const whole = buildNarrativePrompt({ session: sessionOf(), window: planWindows(sessionOf())[0] }).evidencePrompt;
  assert.match(whole, /^complete: true\n\nThis is captured/m);
  assert.ok(!whole.includes('completeFor'));
});
