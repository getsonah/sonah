// D80 (owner decision 2026-10-12): a support the checker did not uphold leaves a claim's identity. After the checks,
// two published claims of one window with the same stated event, role and quote, the same contradiction and the same
// resolution, neither of which publishes a support receipt, are one claim: the first is kept and takes the union of
// the two copies' flags (`assumption`, `restsOn`) (`withoutUnupheldRepeats`). And when D78 drops a repeated copy
// before the checks (`withoutRepeats`), the kept copy takes the union of the two copies' flags. The pairs D78 left
// each publish one row.
//
// Synthetic recordings (SYNTHETIC_D80 words) and synthetic judges only: no recorded session, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, withoutRepeats, withoutUnupheldRepeats } from '../src/run-review.js';

const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
  ...extra });
const LINT = 'SYNTHETIC_D80 lint: 0 problems';
const CLOSING = 'SYNTHETIC_D80: the suite passes and the lint is clean.';
/** An ask, a suite run in the background (no terminal status), a lint run with its output, and the closing message. */
const rows = () => [
  humanAsk('SYNTHETIC_D80: run the suite and the lint, then tell me the result.'),
  call('t1', 'Bash', { command: 'npm test -- --all' }),
  result('t1', 'Command running in background with ID: b1', SIDECAR({ backgroundTaskId: 'b1' })),
  call('t2', 'Bash', { command: 'npm run lint' }),
  result('t2', LINT, SIDECAR({ stdout: LINT })),
  said(CLOSING),
];
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const of = (session, kind) => session.events.filter((event) => event.kind === kind);
const parts = (session) => {
  const [suite, lint] = of(session, 'invocation');
  const lintResult = of(session, 'observation').find((event) => event.invocation === lint.id);
  const [closing] = of(session, 'commentary').slice(-1);
  return { suite, lint, lintResult, closing,
    stated: quote(closing.id, 'commentary', 'the suite passes and the lint is clean.'),
    // Two supports on the lint's result that both pass every code check, with different receipts.
    support: quote(lintResult.id, 'observation', LINT),
    otherSupport: quote(lintResult.id, 'observation', 'lint: 0 problems') };
};
const FIRST = 'The agent said the suite passes and the lint is clean.';
const SECOND = 'Suite green, lint clean, the agent claims.';
const answerOf = (claims) => ({ decisions: [], pivots: [], requirements: [], claims });

/** Every item's vote cites its own receipt (a support item: its support); `verdict(item)` decides each. */
const judgeOf = (claims, verdict = () => 'not-refuted') => async (request) => {
  if (!request.challenge) return structuredClone(answerOf(claims));
  return { votes: request.challenge.items.map((item) => {
    const said = verdict(item);
    const receipt = item.type === 'support' ? item.candidate.supportedBy
      : item.candidate?.stated ?? item.candidate?.instruction;
    return { key: item.key, verdict: said, explanation: 'Synthetic.', receipts: said === 'uncertain' || !receipt ? []
      : [{ eventId: receipt.eventId, role: receipt.role, quote: receipt.quote }] };
  }) };
};
const refuteSupports = (item) => (item.type === 'support' ? 'refuted' : 'not-refuted');
const review = (session, claims, verdict) => runReview({ session, pr: null, reviewScope: 'session-only',
  judge: judgeOf(claims, verdict) });
const rowsOf = (report) => report.promises.map((p) => [p.text, p.status]);

// ---- 1. the rule, through a review ---------------------------------------------------------------------------

test('D80: two copies apart only by the paraphrase and a support no check upheld are one row, with both flags',
  async (t) => {
  const { session } = await load(t, rows());
  const n = parts(session);
  for (const second of [{ supportedBy: n.otherSupport }, {}]) {
    const claims = [{ text: FIRST, stated: n.stated, supportedBy: n.support },
      { text: SECOND, stated: n.stated, ...second, assumption: true }];
    const report = await review(session, claims, refuteSupports);
    // D78 kept both (their supports differ): both claims and every proposed support were asked, and none upheld.
    assert.equal(report.counts.claimRepeats, undefined);
    assert.equal(report.supportChallenge.plannedItems, Object.keys(second).length + 1, 'each support asked on its own');
    assert.deepEqual(rowsOf(report), [[FIRST, 'open']], 'one row, the first copy\'s words');
    const [promise] = report.promises;
    assert.equal(promise.assumption, true, 'the second copy\'s mark is kept');
    assert.deepEqual(promise.receipts, [promise.stated], 'no support receipt');
    assert.equal(report.counts.claimsMerged, 1);
    assert.deepEqual(report.windowResults.map((w) => w.claimsMerged), [1]);
    assert.deepEqual(report.counts.checklist.assumptions, { proposed: 1, published: 1 });
    // Whichever copy comes first is the one kept, with its own id and words.
    const reversed = await review(session, [...claims].reverse(), refuteSupports);
    assert.deepEqual(rowsOf(reversed), [[SECOND, 'open']]);
    assert.equal(reversed.promises[0].assumption, true);
  }
});

test('D80: a copy that rests on unfinished checks makes the one claim incomplete, whichever copy is first',
  async (t) => {
  const { session } = await load(t, rows());
  const n = parts(session);
  const supported = { text: FIRST, stated: n.stated, supportedBy: n.support };
  const resting = { text: SECOND, stated: n.stated, restsOn: [n.suite.id] };
  // Apart, the first is open (its support was refuted) and the second incomplete (the suite never finished).
  const alone = await review(session, [resting], refuteSupports);
  assert.deepEqual([rowsOf(alone), alone.promises[0].restsOn], [[[SECOND, 'incomplete']], [n.suite.id]]);
  const report = await review(session, [supported, resting], refuteSupports);
  assert.deepEqual(rowsOf(report), [[FIRST, 'incomplete']], 'a copy never lowers the claim');
  assert.deepEqual(report.promises[0].restsOn, [n.suite.id]);
  assert.equal(report.counts.claimsMerged, 1);
  const reversed = await review(session, [resting, supported], refuteSupports);
  assert.deepEqual([rowsOf(reversed), reversed.promises[0].restsOn], [[[SECOND, 'incomplete']], [n.suite.id]]);
});

test('D80: a support the checker upheld stays part of the claim — one upheld and one not, or two upheld, stay apart',
  async (t) => {
  const { session } = await load(t, rows());
  const n = parts(session);
  const claims = [{ text: FIRST, stated: n.stated, supportedBy: n.support },
    { text: SECOND, stated: n.stated, supportedBy: n.otherSupport }];
  // The first copy's support upheld, the second's refuted: a verified row and an open row.
  const one = await review(session, claims, (item) => (item.type === 'support'
    && item.candidate.supportedBy.quote === n.otherSupport.quote ? 'refuted' : 'not-refuted'));
  assert.deepEqual(rowsOf(one), [[FIRST, 'verified'], [SECOND, 'open']]);
  assert.equal(one.counts.claimsMerged, undefined, 'nothing merged: the count is absent');
  assert.ok(one.windowResults.every((w) => !Object.hasOwn(w, 'claimsMerged')));
  // Both upheld, with different receipts: two verified rows, each with its own support receipt.
  const both = await review(session, claims);
  assert.deepEqual(rowsOf(both), [[FIRST, 'verified'], [SECOND, 'verified']]);
  assert.deepEqual(both.promises.map((p) => p.receipts[1].quote), [n.support.quote, n.otherSupport.quote]);
  assert.equal(both.counts.claimsMerged, undefined);
});

test('D80: a copy kept although its own check did not settle is read as it was proposed', async (t) => {
  const { session } = await load(t, rows());
  const n = parts(session);
  // The first copy's own item is unsettled: it is published without its basis, `open` with its reason.
  const unsure = (item) => (item.key === 'claims:0' ? 'uncertain' : refuteSupports(item));
  // It was proposed with a contradiction the second copy does not cite: another claim, apart.
  const contradicted = await review(session, [{ text: FIRST, stated: n.stated, contradictedBy: n.support },
    { text: SECOND, stated: n.stated }], unsure);
  assert.deepEqual(contradicted.promises.map((p) => [p.text, p.status, p.reason ?? null]),
    [[FIRST, 'open', 'challenge_unsettled'], [SECOND, 'open', null]]);
  assert.equal(contradicted.counts.claimsMerged, undefined);
  // It was proposed with a support only: one claim. The row shows the first copy's words, which its own check did not
  // settle, so it keeps its reason although the second copy's check upheld the second copy's words.
  const pair = [{ text: FIRST, stated: n.stated, supportedBy: n.support },
    { text: SECOND, stated: n.stated, supportedBy: n.otherSupport }];
  const supported = await review(session, pair, unsure);
  assert.deepEqual(supported.promises.map((p) => [p.text, p.status, p.reason ?? null]),
    [[FIRST, 'open', 'challenge_unsettled']]);
  assert.equal(supported.counts.claimsMerged, 1);
  // When the first copy's own check settled and the second's did not, the row shows words a check settled: no reason.
  const settledFirst = await review(session, pair, (item) => (item.key === 'claims:1' ? 'uncertain'
    : refuteSupports(item)));
  assert.deepEqual(settledFirst.promises.map((p) => [p.text, p.status, p.reason ?? null]), [[FIRST, 'open', null]]);
  assert.equal(settledFirst.counts.claimsMerged, 1);
});

// ---- 2. the merge on its own -------------------------------------------------------------------------------------

const STATED = Object.freeze(quote('C1', 'commentary', 'SYNTHETIC_D80 all checks pass.'));
const promiseOf = (id, extra = {}) => ({ id, stated: { ...STATED }, text: `text ${id}`, status: 'open',
  receipts: [{ ...STATED }], ...extra });
const proposalOf = (extra = {}) => ({ text: 'any words', stated: { ...STATED }, ...extra });
const merge = (...entries) => withoutUnupheldRepeats(entries.map(([promise, proposal]) => ({ promise, proposal })));

test('D80: the merged row is the first copy with the union of the flags, and never lower than either copy', () => {
  const restsOnUnion = merge(
    [promiseOf('a', { status: 'incomplete', restsOn: ['A1'] }), proposalOf({ restsOn: ['A1'] })],
    [promiseOf('b', { status: 'incomplete', restsOn: ['A2', 'A1'], assumption: true }),
      proposalOf({ supportedBy: STATED })]);
  assert.deepEqual(restsOnUnion, { merged: 1, promises: [{ id: 'a', stated: { ...STATED }, text: 'text a',
    status: 'incomplete', receipts: [{ ...STATED }], restsOn: ['A1', 'A2'], assumption: true }] },
  'the published order');
  // An open copy and an incomplete one: incomplete, with the resting copy's ids.
  const mixed = merge([promiseOf('a'), proposalOf()],
    [promiseOf('b', { status: 'incomplete', restsOn: ['A1'] }), proposalOf({ supportedBy: STATED })]);
  assert.deepEqual(mixed.promises.map((p) => [p.id, p.status, p.restsOn]), [['a', 'incomplete', ['A1']]]);
  // The reason is the kept copy's own, whatever the other copy's check found: the row shows the kept copy's words. An
  // incomplete claim carries none.
  const reasons = (a, b) => merge([promiseOf('a', a), proposalOf()],
    [promiseOf('b', b), proposalOf({ supportedBy: STATED })]).promises.map((p) => p.reason ?? null);
  const UNSETTLED = { reason: 'challenge_unsettled' };
  assert.deepEqual(reasons(UNSETTLED, {}), ['challenge_unsettled']);
  assert.deepEqual(reasons({}, UNSETTLED), [null]);
  assert.deepEqual(reasons(UNSETTLED, { reason: 'challenge_unexecuted' }), ['challenge_unsettled']);
  assert.deepEqual(reasons(UNSETTLED, { status: 'incomplete', restsOn: ['A1'] }), [null]);
  // Three copies are one row; two merges are counted.
  const three = merge([promiseOf('a'), proposalOf()], [promiseOf('b'), proposalOf()], [promiseOf('c'), proposalOf()]);
  assert.equal(three.merged, 2);
});

test('D80: anything a support receipt, the claim or its record tells apart stays apart, as it came', () => {
  const kept = (...entries) => merge(...entries).promises.map((p) => p.id);
  const base = [promiseOf('a'), proposalOf()];
  const apart = {
    'a verified copy': [promiseOf('b', { status: 'verified',
      receipts: [{ ...STATED }, quote('R1', 'observation', 'ok')] }),
    proposalOf({ supportedBy: quote('R1', 'observation', 'ok') })],
    'another contradiction': [promiseOf('b'), proposalOf({ contradictedBy: quote('R1', 'observation', 'FAIL') })],
    'another resolution': [promiseOf('b'), proposalOf({ resolvedBy: { observation: quote('R2', 'observation', 'ok'),
      statement: quote('C2', 'commentary', 'fixed') } })],
    'another proposed quote': [promiseOf('b'), proposalOf({ stated: quote('C1', 'commentary', 'all checks pass.') })],
    'another published receipt': [promiseOf('b', { stated: quote('C1', 'commentary', 'all checks') }), proposalOf()],
    'no proposal': [promiseOf('b'), undefined],
    'a receipt no identity can be computed for': [promiseOf('b'),
      proposalOf({ contradictedBy: { eventId: 'R1', quote: 7 } })],
    'a status code never sets': [promiseOf('b', { status: 'kept' }), proposalOf()],
  };
  for (const [name, other] of Object.entries(apart)) assert.deepEqual(kept(base, other), ['a', 'b'], name);
  // Pure: what it is given is not changed, an unmerged promise is the very object given, and the same input gives
  // the same output.
  const entries = [{ promise: promiseOf('a'), proposal: proposalOf() },
    { promise: promiseOf('b'), proposal: proposalOf() },
    { promise: promiseOf('c', { stated: quote('C9', 'commentary', 'other') }), proposal: proposalOf() }];
  const before = structuredClone(entries);
  const once = withoutUnupheldRepeats(entries);
  assert.deepEqual(entries, before);
  assert.equal(once.promises[1], entries[2].promise);
  assert.deepEqual(withoutUnupheldRepeats(entries), once);
  assert.deepEqual(withoutUnupheldRepeats(null), { promises: [], merged: 0 });
});

// ---- 3. D78's one pass keeps both copies' flags ------------------------------------------------------------------

test('D80: a copy D78 drops before the checks gives the kept copy its flags', async (t) => {
  const { session } = await load(t, rows());
  const n = parts(session);
  const unique = (claims) => withoutRepeats(answerOf(claims), { session, repo: { host: 'github.com', id: '0' } });
  const first = { text: FIRST, stated: n.stated };
  const flagged = unique([first, { text: SECOND, stated: n.stated, assumption: true, restsOn: [n.suite.id] }]);
  assert.deepEqual(flagged.narrative.claims, [{ ...first, assumption: true, restsOn: [n.suite.id] }]);
  assert.deepEqual(flagged.repeats, { claims: 1, written: 0 });
  // The kept copy's ids first, then each of the dropped copy's it lacks; a `false` mark is replaced in place.
  const joined = unique([{ ...first, assumption: false, restsOn: ['A1'] },
    { text: SECOND, stated: n.stated, assumption: true, restsOn: ['A2', 'A1', 'A2'] }]);
  assert.deepEqual(joined.narrative.claims, [{ ...first, assumption: true, restsOn: ['A1', 'A2'] }]);
  assert.deepEqual(Object.keys(joined.narrative.claims[0]), ['text', 'stated', 'assumption', 'restsOn']);
  // A copy that adds nothing leaves the kept copy as it came — the very object.
  const same = [{ ...first, assumption: true }, { text: SECOND, stated: n.stated, assumption: false }];
  assert.equal(unique(same).narrative.claims[0], same[0]);
  // Pure: the answer it is given is not changed.
  const answer = answerOf([first, { text: SECOND, stated: n.stated, assumption: true }]);
  const before = structuredClone(answer);
  withoutRepeats(answer, { session, repo: { host: 'github.com', id: '0' } });
  assert.deepEqual(answer, before);
  // Through a review: the one claim checked carries both copies' flags, and rests on the unfinished suite.
  const report = await review(session,
    [first, { text: SECOND, stated: n.stated, assumption: true, restsOn: [n.suite.id] }]);
  assert.deepEqual(report.promises.map((p) => [p.text, p.status, p.restsOn, p.assumption]),
    [[FIRST, 'incomplete', [n.suite.id], true]]);
  assert.deepEqual(report.counts.claimRepeats, { claims: 1, written: 0 });
  assert.equal(report.counts.claimsMerged, undefined, 'dropped before the checks, never merged after them');
});
