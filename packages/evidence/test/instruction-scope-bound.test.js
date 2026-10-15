// W3d-5 (D59, F175 F176). A window is judged against the record up to its own end: its request,
// its grounding and its carried pointers hold the human instructions recorded at or before its
// last event, never one recorded after it — and never drop one recorded before it.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called; the judge is a table keyed by window index, never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import * as ledger from '../src/ledger.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { planWindows, COMBINED_WINDOW_SETTINGS } from '../src/windows.js';
import { runReview } from '../src/run-review.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

const { instructionReviewScope, groundDecision, buildLedger } = ledger;
const REPO = { host: 'github.com', id: '59' };
const ASK = { I1: 'SYNTHETIC_D59_ASK_ONE: write the first module.', I2: 'SYNTHETIC_D59_ASK_TWO: write the second module.',
  I9: 'SYNTHETIC_D59_ASK_LATER: now review everything again.', IM: 'SYNTHETIC_D59_ASK_MIDDLE: also keep a note.' };
const PATHS = { 1: 'src/one.js', 2: 'src/two.js', 3: 'src/three.js' };

/**
 * Three windows. M35 (windowing): a compaction no longer splits a window, so each step's statement is long (150,000
 * bytes) and a combined review's window (54,613 tokens) holds one step; the second segment (I2 and the two steps after
 * it) is oversized and cut before its second statement, its human message repeated at the top of the third window:
 *   w1 = I1 C1 A1 O1 B1 | w2 = I2 C2 A2 O2 B2 | w3 = (I2) C3 A3 O3
 * `tail` appends a human instruction after the last step: a segment, and a window, of its own; `middle` inserts one
 * after window 2's write: it starts the segment window 3 holds. Sequences are the recorded order, so an insertion
 * renumbers what follows it.
 */
function sessionOf({ tail = false, middle = false, gaps, supersedes } = {}) {
  const blobs = { ...ASK };
  for (const n of [1, 2, 3]) {
    blobs[`said${n}`] = `SYNTHETIC_D59_SAID_${n}: writing module ${n} now.\n${'f'.repeat(150_000)}`;
    blobs[`ok${n}`] = `SYNTHETIC_D59_OK_${n}: wrote 1 file.`;
  }
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = [];
  let sequence = 0;
  const push = (event) => events.push({ ...event, sequence: sequence++ });
  const instruction = (id) => push({ id, kind: 'instruction', authority: 'human', text: whole(id),
    supersedes: supersedes?.[id] ?? [] });
  const step = (n) => {
    push({ id: `C${n}`, kind: 'commentary', phase: 'working', text: whole(`said${n}`) });
    push({ id: `A${n}`, kind: 'invocation', operation: 'write', tool: 'Write', paths: [{ path: PATHS[n] }] });
    push({ id: `O${n}`, kind: 'observation', phase: 'terminal', invocation: `A${n}`, result: 'succeeded',
      output: whole(`ok${n}`), sourceOfResult: 'native', terminalStatusProven: true });
  };
  instruction('I1'); step(1);
  push({ id: 'B1', kind: 'boundary', boundary: 'compaction' });
  instruction('I2'); step(2);
  if (middle) instruction('IM');
  push({ id: 'B2', kind: 'boundary', boundary: 'compaction' });
  step(3);
  if (tail) instruction('I9');
  const session = new Session({ sessionKey: 'sess-d59', adapter: 'claude', events, blobs });
  if (gaps) session.adapterGaps = gaps;
  return session;
}
const windowsOf = (session) => planWindows(session, COMBINED_WINDOW_SETTINGS);
const windowIds = (session) => windowsOf(session).map((w) => w.events.map((e) => e.id));
const digestOf = (prompt) => /^scopeDigest: (\S+)$/m.exec(prompt)?.[1] ?? null;

test('the premise: three windows; the tail instruction is a window of its own; the middle one opens window 3', () => {
  assert.deepEqual(windowIds(sessionOf()), [['I1', 'C1', 'A1', 'O1', 'B1'], ['I2', 'C2', 'A2', 'O2', 'B2'], ['C3', 'A3', 'O3']]);
  assert.equal(windowsOf(sessionOf())[2].repeats.id, 'I2');
  assert.deepEqual(windowIds(sessionOf({ tail: true })).slice(2), [['C3', 'A3', 'O3'], ['I9']]);
  assert.deepEqual(windowIds(sessionOf({ middle: true })).slice(1), [['I2', 'C2', 'A2', 'O2'], ['IM', 'B2', 'C3', 'A3', 'O3']]);
});

// ---- change 1: a bounded instruction scope ----------------------------------------------------

test('D59 without a bound the scope is exactly what it was: the whole session, the same digest', () => {
  const session = sessionOf({ tail: true });
  const whole = instructionReviewScope(session);
  assert.deepEqual(whole.instructions.map((i) => i.eventId), ['I1', 'I2', 'I9']);
  assert.equal(whole.complete, true);
  // Pinned on the code before W3d-5: every caller that wants the whole session keeps its bytes.
  assert.equal(whole.scopeDigest, 'sha256:908465bb7478047286caae5ea6a31c11930464a589e579d1e330e0e5f2ecc237');
  for (const options of [undefined, {}, { upTo: null }, { upTo: undefined }])
    assert.deepEqual(instructionReviewScope(session, options), whole);
});

test('D59 a bounded scope holds only instructions recorded at or before the bound, digested the same way', () => {
  const session = sessionOf({ tail: true });
  for (const [upTo, expected] of [[3, ['I1']], [4, ['I1']], [5, ['I1', 'I2']], [12, ['I1', 'I2']], [13, ['I1', 'I2', 'I9']]]) {
    const scope = instructionReviewScope(session, { upTo });
    assert.deepEqual(scope.instructions.map((i) => i.eventId), expected, `upTo ${upTo}`);
    assert.equal(scope.complete, true, `upTo ${upTo}`);
    // "The same way": the bounded digest is the whole-session digest of the record cut at the bound.
    const cut = new Session({ sessionKey: session.sessionKey, adapter: session.adapter, blobs: session.blobs,
      events: session.events.filter((e) => e.sequence <= upTo) });
    assert.deepEqual(scope, instructionReviewScope(cut), `upTo ${upTo}`);
  }
  // Growth after the bound changes nothing at the bound.
  assert.deepEqual(instructionReviewScope(sessionOf({ tail: true }), { upTo: 8 }),
    instructionReviewScope(sessionOf(), { upTo: 8 }));
  assert.notEqual(instructionReviewScope(sessionOf({ tail: true })).scopeDigest, instructionReviewScope(sessionOf()).scopeDigest,
    'premise: the whole-session digest does change');
});

test('D59 what is recorded after the bound cannot make the scope at the bound incomplete; before it, it still does', () => {
  const afterBound = (change) => { const s = sessionOf({ tail: true }); change(s, s.event('I9')); return s; };
  const beforeBound = (change) => { const s = sessionOf({ tail: true }); change(s, s.event('I1')); return s; };
  const changes = {
    omitted: (s, e) => { e.omitted = true; },
    assignment: (s, e) => { e.authority = 'assignment'; },
    // A second event carrying the instruction's id, recorded on the same side of the bound.
    duplicateId: (s, e) => {
      if (e.id === 'I9') s.events.push({ id: 'I9', kind: 'commentary', phase: 'working', sequence: 14, text: e.text });
      else s.event('C1').id = 'I1';
    },
    duplicateSequence: (s, e) => { s.events.push({ id: `${e.id}-dup`, kind: 'commentary', phase: 'working', sequence: e.sequence, text: e.text }); },
    unquotable: (s, e) => { e.text = []; },
  };
  for (const [name, change] of Object.entries(changes)) {
    assert.equal(instructionReviewScope(afterBound(change), { upTo: 12 }).complete, true, `${name} after the bound`);
    assert.equal(instructionReviewScope(afterBound(change)).complete, false, `${name}: the whole session is incomplete`);
    assert.equal(instructionReviewScope(beforeBound(change), { upTo: 12 }).complete, false, `${name} before the bound`);
  }
  // An event whose sequence cannot be placed on either side of the bound is examined, and fails it.
  const unplaced = sessionOf({ tail: true });
  unplaced.events.push({ id: 'X1', kind: 'commentary', phase: 'working', sequence: 3.5, text: unplaced.event('C1').text });
  assert.equal(instructionReviewScope(unplaced, { upTo: 12 }).complete, false);
});

test('D59 the session-level checks still apply to a bounded scope, and a bound that is not a sequence fails closed', () => {
  // OWNER DECISION B (2026-10-01) amends what D59 pinned here: an unlocated root gap is still session-level, and so is
  // a gap that names events without counting exactly them (the second case: no count) — but a gap LOCATED after the
  // bound (it counts exactly the events it names, each placed) no longer makes the bounded scope incomplete. One
  // located at or before the bound still does. m33-u-unasked-scope.test.js holds the rest of the decision.
  for (const gap of [{ code: 'incomplete_inventory', channel: 'identity', scope: 'session' },
    { code: 'source_clipped', channel: 'instructions', scope: 'session', eventIds: ['I9'] },
    { code: 'incomplete_inventory', scope: 'session' },
    { code: 'source_clipped', channel: 'instructions', scope: 'session', eventIds: ['I1'], count: 1 }]) {
    const session = sessionOf({ tail: true, gaps: [gap] });
    assert.equal(instructionReviewScope(session, { upTo: 3 }).complete, false, gap.code);
  }
  const after = sessionOf({ tail: true, gaps: [{ code: 'source_clipped', channel: 'instructions', scope: 'session',
    eventIds: ['I9'], count: 1 }] });
  assert.equal(instructionReviewScope(after, { upTo: 3 }).complete, true, 'located after the bound: not this bound\'s loss');
  assert.equal(instructionReviewScope(after, { upTo: 13 }).complete, false, 'the bound that reaches it still carries it');
  const actionGap = sessionOf({ tail: true, gaps: [{ code: 'incomplete_inventory',
    channel: 'actions', scope: 'session' }] });
  assert.equal(instructionReviewScope(actionGap, { upTo: 3 }).complete, true,
    'an action-only loss cannot erase the earlier root human instruction inventory');
  const session = sessionOf({ tail: true });
  session.instructionHistoryComplete = false;
  assert.equal(instructionReviewScope(session, { upTo: 3 }).complete, false);
  // No human instruction yet recorded at the bound: nothing to certify.
  assert.equal(instructionReviewScope(sessionOf(), { upTo: -1 }).complete, false);
  for (const upTo of ['3', 2.5, Number.NaN, Infinity, {}])
    assert.equal(instructionReviewScope(sessionOf(), { upTo }).complete, false, `upTo ${String(upTo)}`);
});

test('D59 windowEnd is the last recorded sequence of the window, or null when none can be placed', () => {
  const windows = windowsOf(sessionOf({ tail: true }));
  assert.deepEqual(windows.map(ledger.windowEnd), [4, 9, 12, 13]);
  assert.equal(ledger.windowEnd({ index: 0, events: [] }), null);
  assert.equal(ledger.windowEnd({ index: 0, events: [{ id: 'X', sequence: null }] }), null);
  assert.equal(ledger.windowEnd({ index: 0, events: [{ id: 'X', sequence: 4 }, { id: 'Y', sequence: 2 }] }), 4);
});

// ---- change 2: the window's request carries the bounded inventory -----------------------------

test('D59 a window\'s request carries the instructions recorded up to its end, and nothing recorded after', () => {
  const session = sessionOf({ tail: true });
  const windows = windowsOf(session);
  const expected = [['I1'], ['I1', 'I2'], ['I1', 'I2'], ['I1', 'I2', 'I9']];
  for (const [index, window] of windows.entries()) {
    const { prompt, evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window });
    const scope = instructionReviewScope(session, { upTo: ledger.windowEnd(window) });
    assert.match(evidencePrompt, /^## Human instructions recorded up to the end of this window/m);
    assert.doesNotMatch(evidencePrompt, /## Full human instruction inventory/);
    assert.ok(evidencePrompt.includes('Later instructions cannot license earlier actions.'));
    assert.equal(digestOf(prompt), scope.scopeDigest, `window ${index + 1} states its own bounded digest`);
    assert.match(evidencePrompt, /^complete: true$/m);
    const inventoried = Object.keys(sourceMap).filter((id) => sourceMap[id].some((s) => s.role === 'instruction'));
    assert.deepEqual(inventoried.sort(), expected[index], `window ${index + 1} source map`);
    for (const id of ['I1', 'I2', 'I9'])
      assert.equal(prompt.includes(ASK[id]), expected[index].includes(id), `window ${index + 1}: ${id}`);
  }
});

test('D59 an instruction appended after a window leaves that window\'s request byte-identical', () => {
  const before = sessionOf(), after = sessionOf({ tail: true });
  const [w1, w2, w3] = windowsOf(before), [x1, x2, x3] = windowsOf(after);
  for (const [a, b] of [[w1, x1], [w2, x2], [w3, x3]]) {
    const one = buildNarrativePrompt({ session: before, window: a });
    const two = buildNarrativePrompt({ session: after, window: b });
    assert.equal(two.prompt, one.prompt, `window ${a.index + 1}`);
    assert.deepEqual(two.sourceMap, one.sourceMap);
  }
  // One inserted after window 2's write opens window 3 (M35: a human message starts a segment), and reaches no earlier one.
  const middle = sessionOf({ middle: true });
  const [m1, m2, m3] = windowsOf(middle);
  assert.equal(buildNarrativePrompt({ session: middle, window: m1 }).prompt, buildNarrativePrompt({ session: before, window: w1 }).prompt);
  assert.ok(!buildNarrativePrompt({ session: middle, window: m2 }).prompt.includes(ASK.IM));
  assert.ok(buildNarrativePrompt({ session: middle, window: m3 }).prompt.includes(ASK.IM));
});

test('D59 a window with no placeable event (the code-chunk probe) keeps the whole-session inventory', () => {
  const session = sessionOf({ tail: true });
  const { prompt } = buildNarrativePrompt({ session, window: { index: 0, events: [] } });
  assert.equal(digestOf(prompt), instructionReviewScope(session).scopeDigest);
  for (const id of ['I1', 'I2', 'I9']) assert.ok(prompt.includes(ASK[id]));
});

// ---- change 3: grounding checks against the same bound ----------------------------------------

/** Window 1's unasked decision about A1, its instructionReview copied from window 1's own request. */
function unaskedDecision(session) {
  const [window] = windowsOf(session);
  const scopeDigest = digestOf(buildNarrativePrompt({ session, window }).prompt);
  return { dimension: 'SYNTHETIC_D59_DIMENSION', chosen: `Write ${PATHS[1]}`, actions: ['A1'], value: PATHS[1],
    valueReceipt: { eventId: 'A1', role: 'action', field: 'path', quote: PATHS[1] },
    stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_D59_SAID_1' }, constrainedBy: null,
    instructionReview: { dimension: 'SYNTHETIC_D59_DIMENSION', scopeDigest, noRelevantInstruction: true,
      checks: [{ instruction: { eventId: 'I1', role: 'instruction', quote: ASK.I1 }, relevant: false,
        explanation: 'SYNTHETIC: this instruction names a module, not the dimension under review.' }] } };
}
const PR = { repo: REPO, number: 1, enumeration: 'complete',
  files: Object.values(PATHS).map((path) => ({ path, change: 'added', contentState: 'complete' })) };

test('D59 a window-1 decision checked against window 1\'s instructions stays grounded when an instruction is appended later', () => {
  const candidate = { ...unaskedDecision(sessionOf()), actorSession: 'sess-d59' };
  const grown = sessionOf({ tail: true });
  const bounded = groundDecision({ repo: REPO, session: grown, pr: PR, candidate, instructionHistoryComplete: true, upTo: 3 });
  assert.equal(bounded.decision.column, 'unasked');
  assert.equal(bounded.decision.columnState, 'grounded');
  // Against the whole grown session the copied digest no longer matches: the old behaviour.
  const whole = groundDecision({ repo: REPO, session: grown, pr: PR, candidate, instructionHistoryComplete: true });
  assert.equal(whole.decision.column, null);
  assert.deepEqual(whole.decision.reasons, ['receipt_rejected']);
  // buildLedger carries the bound, as a number or per candidate.
  for (const upTo of [3, () => 3]) {
    const report = buildLedger({ repo: REPO, session: grown, pr: PR, candidates: [candidate], upTo });
    assert.equal(report.decisions[0].column, 'unasked');
  }
});

test('D59 grounding never requires an instruction recorded after the window, and never drops one recorded before it', () => {
  const session = sessionOf({ tail: true });
  const candidate = { ...unaskedDecision(sessionOf()), actorSession: 'sess-d59' };
  const at = (upTo, change = (c) => c) => groundDecision({ repo: REPO, session, pr: PR,
    candidate: change(structuredClone(candidate)), instructionHistoryComplete: true, upTo }).decision;
  // A check of the later instruction is one the window could not have been asked for.
  assert.equal(at(3, (c) => { c.instructionReview.checks.push({ instruction: { eventId: 'I9', role: 'instruction', quote: ASK.I9 },
    relevant: false, explanation: 'SYNTHETIC: later.' }); return c; }).column, null);
  // Omitting an instruction recorded before the action is still a missing check.
  const window2 = windowsOf(session)[1];
  const digest2 = instructionReviewScope(session, { upTo: ledger.windowEnd(window2) }).scopeDigest;
  const onA2 = (checks) => (c) => { c.actions = ['A2']; c.valueReceipt = { eventId: 'A2', role: 'action', field: 'path', quote: PATHS[2] };
    c.value = PATHS[2]; c.stated = { eventId: 'C2', role: 'commentary', quote: 'SYNTHETIC_D59_SAID_2' };
    c.instructionReview.scopeDigest = digest2; c.instructionReview.checks = checks; return c; };
  const check = (id) => ({ instruction: { eventId: id, role: 'instruction', quote: ASK[id] }, relevant: false, explanation: 'SYNTHETIC.' });
  assert.equal(at(8, onA2([check('I1')])).column, null, 'I2 was recorded before A2 and must be checked');
  assert.equal(at(8, onA2([check('I1'), check('I2')])).column, 'unasked');
  // An action the bound does not reach has instructions the bounded scope cannot speak for.
  assert.equal(at(3, onA2([check('I1'), check('I2')])).column, null);
  // A constraint recorded after the window cannot be the window's constraint.
  const constrained = (c) => { c.instructionReview = null; c.constrainedBy = { instruction: { eventId: 'I2', role: 'instruction',
    quote: ASK.I2 }, settles: false, settledValueQuote: null }; c.actions = ['A3']; c.value = PATHS[3];
    c.valueReceipt = { eventId: 'A3', role: 'action', field: 'path', quote: PATHS[3] };
    c.stated = { eventId: 'C3', role: 'commentary', quote: 'SYNTHETIC_D59_SAID_3' }; return c; };
  assert.equal(at(12, constrained).column, 'asked-chose');
  const deriveLate = ledger.deriveColumn(session, { instruction: { eventId: 'I9', role: 'instruction', quote: ASK.I9 },
    settles: false, settledValueQuote: null }, true, [], null, null, { upTo: 12 });
  assert.equal(deriveLate.column, null);
  assert.equal(deriveLate.reason, 'ambiguous_authority');
});

/** One judge for every run: window 1 proposes the unasked decision, copying ITS request's digest. */
function reviewer(calls = []) {
  return async (request) => {
    const window = Number(/:w(\d+)/.exec(request.label ?? '')?.[1] ?? 0);
    calls.push(request.label);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'SYNTHETIC: the instruction asks for this module.', receipts: [{ eventId: 'I1', role: 'instruction', quote: ASK.I1 }] })) };
    const empty = { decisions: [], pivots: [], claims: [], requirements: [] };
    if (window !== 1) return empty;
    const scopeDigest = digestOf(request.prompt);
    const decision = unaskedDecision(sessionOf());
    return { ...empty, decisions: [{ ...decision, instructionReview: { ...decision.instructionReview, scopeDigest } }] };
  };
}

// D60 (W3f-1): the window capsule this used to offer is gone. Window 1's answer is reused because
// its request is the same bytes after the growth — the answer cache answers it with no call — and
// it is grounded again, at its own end.
test('D59 live, reused and report-level grounding all use the window\'s own bound', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-d59-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  const recording = (asked, judge) => async (request) => { asked.push(request); return judge(request); };
  const before = [];
  const first = await runReview({ session: sessionOf(), pr: PR, judge: memoizeJudge(recording(before, reviewer()), cache) });
  assert.equal(first.decisions.length, 1);
  assert.equal(first.decisions[0].column, 'unasked', 'live, before growth');
  assert.equal(first.windowResults[0].groundingComplete, true);

  // The session grows by one human instruction after window 2.
  const calls = [];
  const grown = await runReview({ session: sessionOf({ tail: true }), pr: PR, judge: memoizeJudge(reviewer(calls), cache) });
  assert.ok(!calls.some((label) => /:w1(?::|$)/.test(label)), `window 1 was asked again: ${calls}`);
  assert.equal(grown.windowResults[0].groundingComplete, true);
  assert.equal(grown.decisions.length, 1);
  assert.equal(grown.decisions[0].column, 'unasked', 'the report re-grounds it at window 1\'s end, not the session\'s');
  assert.equal(grown.decisions[0].columnState, 'grounded');

  // Asked live against the grown session, window 1 asks the same bytes and grounds the same way.
  const after = [];
  const live = await runReview({ session: sessionOf({ tail: true }), pr: PR, judge: recording(after, reviewer()) });
  assert.equal(live.decisions[0].column, 'unasked');
  const w1 = (requests) => requests.filter((r) => /:w1(?::|$)/.test(r.label)).map((r) => [r.system, r.prompt]);
  assert.ok(w1(before).length > 1, 'premise: window 1 asked its narrative and its challenge');
  assert.deepEqual(w1(after), w1(before), 'window 1 asked the same bytes before and after the growth');
});

// ---- change 4 (F176, carryOver's bounded supersession) is gone with the carry (M35 windowing): every earlier human
// message is in a window's inventory, whatever later message supersedes it. ----------------------------------------
