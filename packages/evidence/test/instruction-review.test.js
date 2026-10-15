// R1/D57 synthetic scope/authority regressions. No provider or private data is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { deriveColumn, groundDecision, buildLedger, instructionReviewScope } from '../src/ledger.js';
import { buildNarrativePrompt, NARRATIVE_SCHEMA } from '../src/prompt.js';
import { toCandidates } from '../src/run-review.js';
import { buildCodeReviewPrompt, CODE_REVIEW_SCHEMA } from '../src/code-review-prompt.js';
import { renderReview } from '../src/review.js';

function fixture() {
  const blobs = { one: 'Change the icon colour to blue.', two: 'Keep the image dimensions unchanged.',
    later: 'Use a compact JSON format for subsequent logs.' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: ref('one') },
    { id: 'I2', kind: 'instruction', authority: 'human', sequence: 1, text: ref('two') },
    { id: 'A3', kind: 'invocation', sequence: 2, operation: 'write', tool: 'Write',
      paths: [{ path: 'logging.json' }], command: [], changes: [] },
    { id: 'O3', kind: 'observation', sequence: 3, invocation: 'A3', phase: 'terminal', result: 'succeeded', output: [] },
    { id: 'I4', kind: 'instruction', authority: 'human', sequence: 4, text: ref('later') },
  ];
  const session = new Session({ sessionKey: 'synthetic-r1', events, blobs });
  const candidate = { actorSession: session.sessionKey, dimension: 'log format', chosen: 'indented JSON',
    actions: ['A3'], value: null, valueReceipt: null, stated: null, constrainedBy: null };
  const instructionReview = { dimension: candidate.dimension, scopeDigest: instructionReviewScope(session).scopeDigest,
    noRelevantInstruction: true, checks: [
      { instruction: { eventId: 'I1', role: 'instruction', quote: blobs.one }, relevant: false,
        explanation: 'This instruction concerns icon colour, not logging format.' },
      { instruction: { eventId: 'I2', role: 'instruction', quote: blobs.two }, relevant: false,
        explanation: 'This instruction preserves image size, not logging format.' },
    ] };
  return { session, candidate, instructionReview };
}
const args = (f) => ({ repo: { host: 'github.com', id: 'r1' }, session: f.session,
  pr: { files: [{ path: 'logging.json', change: 'added' }] }, instructionHistoryComplete: true,
  candidate: { ...f.candidate, instructionReview: f.instructionReview } });

test('R1 omission leaves authority unchecked even with complete history', () => {
  const f = fixture();
  const decision = groundDecision({ ...args(f), candidate: f.candidate }).decision;
  assert.equal(decision.column, null);
  assert.equal(decision.columnState, 'unchecked');
  assert.equal(decision.instructionReview, null);
  const report = buildLedger({ ...args(f), candidates: [f.candidate] });
  assert.equal(report.counts.byColumn.unasked, 0);
  assert.equal(report.counts.uncheckedColumn, 1);
  assert.match(renderReview(report), /\*\*not checked\*\*/, 'D71 (a): the row says not checked, in words');
});

test('R1 only an explicit complete dimension-bound review can establish unasked', () => {
  const f = fixture();
  const out = groundDecision(args(f));
  assert.equal(out.decision.column, 'unasked');
  assert.equal(out.decision.columnState, 'grounded');
  assert.equal(out.decision.instructionReview.scopeDigest, f.instructionReview.scopeDigest);
  assert.deepEqual(out.decision.instructionReview.checks.map((c) => c.instruction.eventId), ['I1', 'I2']);
  assert.ok(out.decision.instructionReview.checks.every((c) => c.instruction.sessionKey === f.session.sessionKey));
  assert.deepEqual(instructionReviewScope(f.session), instructionReviewScope(f.session), 'scope is deterministic');
});

test('R1 missing, duplicate, future, wrong-role, false-answer and vague checks stay unchecked', () => {
  const cases = [
    (r) => { r.checks.pop(); },
    (r) => { r.checks[1] = r.checks[0]; },
    (r) => { r.checks[1].instruction.eventId = 'I4'; },
    (r) => { r.checks[0].instruction.role = 'commentary'; },
    (r) => { r.noRelevantInstruction = false; },
    (r) => { r.checks[0].relevant = true; },
    (r) => { r.checks[0].explanation = ' '; },
    (r) => { r.checks[0].instruction.quote = 'Never present in the instruction'; },
    (r) => { r.dimension = 'an unrelated decision'; },
    (r) => { r.checks[0].confidence = 1; },
    (r) => { r.checks[0].instruction.quote = 'Ch'; },
  ];
  for (const change of cases) {
    const f = fixture(); change(f.instructionReview);
    assert.equal(groundDecision(args(f)).decision.column, null);
  }
});

test('R1 an instruction changed outside its quoted span invalidates the review digest', () => {
  const f = fixture();
  f.instructionReview.checks[0].instruction.quote = 'Change the icon colour';
  f.session.blobs.one = 'Change the icon colour and use compact logs.';
  f.session.event('I1').text[0].untilByte = Buffer.byteLength(f.session.blobs.one);
  const out = groundDecision(args(f));
  assert.equal(out.decision.column, null);
  assert.ok(out.decision.reasons.includes('receipt_rejected'));
});

test('R1 empty checks cannot omit a relevant earlier broad instruction', () => {
  const f = fixture();
  f.session.blobs.one = 'Finish the previously proposed production logging changes.';
  f.session.event('I1').text[0].untilByte = Buffer.byteLength(f.session.blobs.one);
  f.instructionReview.scopeDigest = instructionReviewScope(f.session).scopeDigest;
  f.instructionReview.checks = [];
  assert.equal(groundDecision(args(f)).decision.column, null);
});

test('R1 incomplete source/history and unknown inherited authority cannot establish absence', () => {
  for (const change of [
    (f) => { f.session.adapterGaps = [{ code: 'incomplete_inventory', channel: 'instructions' }]; },
    (f) => { delete f.session.blobs.one; },
    (f) => { f.session.event('I1').authority = 'inherited-unverified'; },
    (f) => { f.session.event('I1').authority = 'parent-assignment'; },
    (f) => { f.session.instructionHistoryComplete = 'yes'; },
    (f) => { f.session.event('I1').sequence = null; },
    (f) => { f.session.events.push({ ...f.session.event('I1') }); },
  ]) {
    const f = fixture(); change(f);
    assert.equal(instructionReviewScope(f.session).complete, false);
    assert.equal(groundDecision(args(f)).decision.column, null);
  }
  const f = fixture();
  for (const complete of [false, 'yes', 1, undefined])
    assert.equal(groundDecision({ ...args(f), instructionHistoryComplete: complete }).decision.column, null);
});

test('M29 an action-only gap does not erase a complete root human instruction inventory', () => {
  const f = fixture();
  const baseline = instructionReviewScope(f.session);
  f.session.adapterGaps = [{ code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: 1 }];
  assert.deepEqual(instructionReviewScope(f.session), baseline);
  assert.equal(groundDecision(args(f)).decision.column, 'unasked');
});

test('R1 a failed affirmative relation never falls back to a valid absence proof', () => {
  const f = fixture();
  f.candidate.constrainedBy = { instruction: { eventId: 'I1', role: 'instruction', quote: 'An invented instruction' },
    settles: false, settledValueQuote: null };
  assert.equal(groundDecision(args(f)).decision.column, null);
});

test('R1 affirmative asked columns still ground without an absence review', () => {
  const f = fixture();
  for (const [settles, quote, expected] of [[false, null, 'asked-chose'], [true, 'colour to blue', 'asked-settled']]) {
    const relation = { instruction: { eventId: 'I1', role: 'instruction', quote: 'Change the icon colour to blue.' },
      settles, settledValueQuote: quote };
    assert.equal(deriveColumn(f.session, relation, true, [f.session.event('A3')]).column, expected);
  }
});

test('R1 earlier-window human instructions are exact source in narrative and unified prompts', () => {
  const f = fixture();
  const window = { index: 1, events: [f.session.event('A3'), f.session.event('O3')] };
  const narrative = buildNarrativePrompt({ session: f.session, window, carry: { decisions: [], openRequirements: [], claims: [] } });
  // D59: every instruction recorded up to the window's end (sequence 3), and none after it (I4).
  const scope = instructionReviewScope(f.session, { upTo: 3 });
  assert.deepEqual(scope.instructions.map((i) => i.eventId), ['I1', 'I2']);
  for (const instruction of scope.instructions) {
    assert.ok(narrative.prompt.includes(instruction.text));
    assert.deepEqual(narrative.sourceMap[instruction.eventId], [{ role: 'instruction', text: instruction.text }]);
  }
  assert.ok(!narrative.prompt.includes(f.session.blobs.later));
  assert.equal(narrative.sourceMap.I4, undefined);
  assert.ok(narrative.prompt.includes(scope.scopeDigest));
  assert.ok(!narrative.prompt.includes(f.instructionReview.scopeDigest), 'the whole-session digest is not this window\'s');
  assert.doesNotMatch(narrative.prompt, /The session was compacted before this window/);
  const unified = buildCodeReviewPrompt({ narrativePrompt: narrative, snapshot: { diff: '', files: [], sources: [] } });
  assert.ok(unified.prompt.includes(f.session.blobs.one));
  assert.ok(unified.prompt.includes(scope.scopeDigest));
  assert.ok(CODE_REVIEW_SCHEMA.properties.decisions.items.properties.instructionReview);
  assert.ok(NARRATIVE_SCHEMA.properties.decisions.items.properties.instructionReview);
  const transported = toCandidates({ decisions: [{ ...f.candidate, instructionReview: f.instructionReview }] }, f.session.sessionKey);
  assert.deepEqual(transported.decisions[0].instructionReview, f.instructionReview);
});
