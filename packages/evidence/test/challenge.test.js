import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { challengeItems, CHALLENGE_PROFILE, MAX_REVIEW_INPUT_BYTES, requestFits, reviewInputBytes } from '../src/challenge.js';
import { Session, verifyReceipt } from '../src/session.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { runReview, toCandidates } from '../src/run-review.js';
import { groundDecision } from '../src/ledger.js';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

/** D60: one review's judge, memoized by exact request bytes into a temporary answer cache. */
async function answerStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-challenge-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  return { cache, review: (judge, options) => memoizeJudge(judge, cache, options) };
}

const session = redisPivotSession();
const pr = redisPivotPr();
const receipt = { eventId: 'E1', role: 'instruction', quote: 'Do not add any new infrastructure' };
const vote = (verdict = 'not-refuted') => ({ verdict, explanation: 'The cited instruction establishes the constraint.', receipts: [receipt] });
const batchVote = (request, response = vote()) => ({ votes: request.challenge.items.map(({ key }) => ({ key, ...response })) });
const decision = { dimension: 'cache backend', chosen: 'Redis', actions: ['E3'],
  value: 'config/redis.yml', valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
  constrainedBy: { instruction: { eventId: 'E1', role: 'instruction', quote: 'Add response caching' }, settles: false, settledValueQuote: null } };
const item = { key: 'decisions:0', type: 'decision', candidate: decision };
const narrative = { decisions: [decision], claims: [], pivots: [], requirements: [] };
const challenge = (overrides = {}) => challengeItems({ items: [item], evidence: 'Synthetic complete evidence.',
  judge: async (request) => batchVote(request), verifyReceipt: (r) => verifyReceipt(session, r), ...overrides });
const empty = () => ({ decisions: [], claims: [], pivots: [], requirements: [] });
/** M35 (windowing): a compaction splits no window. A long statement (100,000 bytes) after the ask and before each cut
 *  makes the one segment over a combined review's window budget, cut before the statements: windows E1..E4, E5..E6 and
 *  E7..E9 (each later one repeating the ask at its top). */
const FILL = `SYNTHETIC_FILL: still working.\n${'f'.repeat(100_000)}`;
const fill = (id, sequence) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, sequence,
  text: [{ sourceKey: 'fill', fromByte: 0, untilByte: FILL.length }] });
function splitAt(cuts) {
  const events = [];
  for (const event of structuredClone(session.events)) {
    if (cuts.includes(event.id)) {
      events.push({ id: `B-${event.id}`, kind: 'boundary', boundary: 'compaction', sequence: events.length });
      events.push(fill(`F-${event.id}`, events.length));
    }
    events.push({ ...event, sequence: events.length });
    if (event.id === 'E1') events.push(fill('F-E1', events.length));
  }
  return new Session({ sessionKey: session.sessionKey, events, blobs: { ...session.blobs, fill: FILL } });
}
const threeWindowSession = () => splitAt(['E5', 'E7']);

test('R3 three independent fresh requests and a two-vote positive majority', async () => {
  const requests = [];
  const result = await challenge({ judge: async (request) => {
    requests.push(request);
    return batchVote(request, vote(request.challenge.pass === 3 ? 'refuted' : 'not-refuted'));
  } });
  assert.equal(result.attemptedCalls, 3);
  assert.equal(result.survivors.length, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(requests.map((r) => r.challenge.pass).sort(), [1, 2, 3]);
  assert.equal(new Set(requests.map((r) => r.label)).size, 3);
  assert.equal(new Set(requests.map((r) => r.prompt)).size, 1, 'no preceding vote is fed to another pass');
  assert.ok(requests.every((r) => r.challenge.items[0].candidate === decision));
});

test('R3 challenge profile 3 defines source-region roles and fresh receipt provenance', async () => {
  const requests = [];
  const result = await challenge({ judge: async (request) => {
    requests.push(request);
    return batchVote(request);
  } });
  // M33 C2: version 9 — a claim-class item is shown with its verbatim words; these candidates are not of that class.
  // M33 H repair: version 10 — a relay of another agent's report is the passing agent's own claim.
  // M33 N moved it once more (`sonah.challenge/11`): a forbidden-edit item and its note; no earlier request byte moved.
  // Status fact moved it once more (`sonah.challenge/12`): one system sentence; a vote must quote an uncovered result.
  // H3 moved it once more (`sonah.challenge/13`): a hedged outcome statement is a claim.
  // M33 brittleness M3 moved it once more (`sonah.challenge/12`): a forbidden-edit item names its breach; no other batch moved.
  // M33 brittleness M4 moved it once more (`sonah.challenge/13`): a disclosure item and its note; no other batch moved.
  // M33 brittleness M4's session route moved it once more (`sonah.challenge/14`): a forbidden-edit item no longer
  // shows the agent's statement, which is asked as a disclosure item; no other batch moved.
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(result.profile.version, 'sonah.challenge/45');
  for (const request of requests) {
    assert.deepEqual(request.schema.properties.votes.items.properties.receipts.items.properties.role.enum,
      ['instruction', 'commentary', 'action', 'observation', 'code']);
    for (const rule of [
      'instruction: the human instruction text in HUMAN INSTRUCTION',
      "commentary: the agent's visible words in AGENT SAID",
      'action: an invoked command or a file path in ACTION; this does not include written contents',
      'observation: tool output in RESULT',
      'code: written file contents or a frozen PR code source',
      'Written file contents use role="code", even inside an ACTION event; never role="action"',
      'A RESULT uses its own eventId and role="observation"',
      'For session written code, use the action eventId and role="code" without revisionOid',
      // W3f-2: a request names no commit, so a challenger cannot copy one; code derives it from the ID.
      'For frozen PR code, use the supplied code source ID and role="code"; omit revisionOid, which code derives from that ID',
      "Other candidates' receipts are not source-copy templates. Copy each receipt freshly from the",
      'A wrong role is rejected, never repaired for you',
    ]) assert.ok(request.system.includes(rule), rule);
    assert.ok(!request.system.includes('exact revisionOid'), 'a challenger is never asked for a revision it cannot see');
  }
});

test('R3 literal written contents and outcomes require their actual roles, without repair', async () => {
  const sources = [
    { eventId: 'E3', role: 'code', quote: 'backend: redis' },
    { eventId: 'E6', role: 'observation', quote: 'Tests: 1 failed, 11 passed, 12 total' },
  ];
  for (const correct of sources) {
    assert.equal(verifyReceipt(session, correct).ok, true, 'the literal source really exists');
    const accepted = await challenge({ judge: async (request) =>
      batchVote(request, { ...vote(), receipts: [correct] }) });
    assert.equal(accepted.survivors.length, 1);
    assert.equal(accepted.complete, true);
    assert.ok(accepted.results[0].votes.every((v) => v.receipts[0].role === correct.role));

    const wrong = { ...correct, role: 'action' }, checkedRoles = [];
    const rejected = await challenge({ judge: async (request) =>
      batchVote(request, { ...vote(), receipts: [wrong] }), verifyReceipt: (r) => {
        checkedRoles.push(r.role); return verifyReceipt(session, r);
      } });
    // `sonah.challenge/44`: a rejected vote is an answer and stands; it is not asked again.
    assert.deepEqual(checkedRoles, ['action', 'action', 'action']);
    assert.ok(rejected.results[0].votes.every((v) => v.reasked !== true));
    assert.equal(wrong.role, 'action', 'the proposed receipt was not rewritten');
    assert.equal(rejected.survivors.length, 0);
    // D58: every pass voted, so the challenge ran; the wrong role left the item unsettled, and it
    // is withheld and counted — never published, never repaired for the challenger.
    assert.equal(rejected.executionComplete, true);
    assert.equal(rejected.complete, true);
    assert.equal(rejected.unresolvedItems, 1);
    assert.equal(rejected.unsettledItems, 1);
    assert.ok(rejected.results[0].votes.every((v) => !v.valid && v.reason === 'receipt_rejected'));
  }
});

test('R3 refutation or uncertainty cannot substitute for two grounded support votes', async () => {
  const result = await challenge({ judge: async (request) => batchVote(request, vote(['not-refuted', 'refuted', 'uncertain'][request.challenge.pass - 1])) });
  assert.equal(result.survivors.length, 0);
  assert.equal(result.rejected.length, 1);
  // D58: all three passes voted, so the challenge ran; the item it could not settle is withheld.
  assert.equal(result.complete, true);
  assert.equal(result.unsettledItems, 1);
});

test('R3 malformed, rated, fabricated and evidence-free votes do not count', async () => {
  for (const response of [null, {}, { ...vote(), confidence: 1 },
    { ...vote(), receipts: [] }, { ...vote(), receipts: [{ ...receipt, quote: 'This instruction was never given.' }] },
    { ...vote(), receipts: [{ ...receipt, confidence: 1 }] },
    { ...vote(), explanation: ' ' }, { ...vote(), verdict: 'approved' }]) {
    const result = await challenge({ judge: async (request) => response == null ? response : batchVote(request, response) });
    assert.equal(result.survivors.length, 0);
    assert.ok(result.results[0].votes.every((v) => !v.valid));
  }
});

test('R3 one failed vote permits majority survival but declares incomplete challenge coverage', async () => {
  const result = await challenge({ judge: async (request) => {
    if (request.challenge.pass === 1) throw new Error('private provider detail must not be exported');
    return batchVote(request);
  } });
  assert.equal(result.survivors.length, 1);
  assert.equal(result.complete, false);
  assert.ok(!JSON.stringify(result).includes('private provider detail'));
});

test('R3 batch fanout is bounded and authority claims are ordered first', async () => {
  let active = 0, highWater = 0;
  const order = [];
  // Two items per batch, never three. M33 H1 (challenge/5, then /6 at the refreeze): the system
  // prompt grew by about 1 KB, so each payload is 1,000 bytes smaller to keep a pair inside the cap.
  // M33 C (challenge/8): it grew by about 1.4 KB more (the claim and support criteria), so 1,000 smaller again.
  const items = Array.from({ length: 9 }, (_, index) => ({ key: `i${index}`, type: index < 7 ? 'pivot' : 'decision',
    candidate: { payload: 'x'.repeat(258000), ...(index === 8 ? { constrainedBy: { settles: true } } : {}) } }));
  const result = await challenge({ items, judge: async (request) => {
    order.push(request.challenge.items.map((i) => i.key));
    active++; highWater = Math.max(highWater, active);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    return batchVote(request);
  } });
  assert.equal(result.attemptedCalls, 15);
  assert.equal(highWater, CHALLENGE_PROFILE.maxConcurrency);
  // D145: every batch's first pass is sent first, the authority claims' batch leading; then each batch's later passes.
  assert.deepEqual(order.slice(0, 7), [['i7', 'i8'], ['i0', 'i1'], ['i2', 'i3'], ['i4', 'i5'], ['i6'], ['i7', 'i8'],
    ['i7', 'i8']]);
  assert.equal(result.plannedBatches, 5);
  assert.equal(result.plannedVoteSlots, 27);
});

test('R3 full framing counts against input cap and budget exhaustion stops queued work', async () => {
  assert.equal(requestFits({ system: 'a', prompt: 'b'.repeat(MAX_REVIEW_INPUT_BYTES - 1) }), true);
  assert.equal(requestFits({ system: 'a', prompt: 'b'.repeat(MAX_REVIEW_INPUT_BYTES) }), false);
  let calls = 0;
  const oversized = await challenge({ evidence: 'é'.repeat(MAX_REVIEW_INPUT_BYTES / 2), judge: async (request) => { calls++; return batchVote(request); } });
  assert.equal(calls, 0);
  assert.equal(oversized.complete, false);
  assert.equal(oversized.budgetExhausted, true);
  const stopped = await challenge({ items: [item, { ...item, key: 'second' }], concurrency: 1,
    judge: async () => { calls++; throw Object.assign(new Error('budget exhausted'), { code: 'budget_exhausted' }); } });
  assert.equal(calls, 1);
  assert.equal(stopped.budgetExhausted, true);
  assert.equal(stopped.survivors.length, 0);
});

test('R3 a broad human instruction refutes unasked; related topic does not settle the value', async () => {
  for (const candidate of [{ ...decision, constrainedBy: null },
    { ...decision, constrainedBy: { ...decision.constrainedBy, settles: true, settledValueQuote: 'response caching' } }]) {
    const result = await challenge({ items: [{ ...item, candidate }], judge: async (request) => batchVote(request, vote('refuted')) });
    assert.equal(result.survivors.length, 0);
    assert.equal(result.results[0].votes.length, 3);
  }
});

test('R3 fully refuted narrative is resolved review with no surviving claim', async () => {
  const report = await runReview({ session, pr, judge: async (request) => request.challenge ? batchVote(request, vote('refuted')) : narrative });
  assert.equal(report.decisions.length, 0);
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.challenge.rejectedItems, 1);
  assert.equal(report.challenge.attemptedCalls, 3);
  assert.deepEqual(report.instrument.challenge, CHALLENGE_PROFILE);
  // M35: a combined review windows by its own settings (54,613 tokens of work, nothing carried).
  assert.equal(report.instrument.windowing.workTokens, 54_613);
  assert.equal(report.instrument.windowing.carriedTokens, 0);
});

// D60 (W3f-1): these three tests pinned the per-target capsule path (`reuseWindow`,
// `reviewReusedWindow`). The capsule is gone; the same outcomes hold under the one reuse rule —
// an answer to the same bytes is reused with no call, and everything after it is re-derived.
test('D60 a stored answer skips the call, never the grounding: relevance is recomputed from the current PR', async (t) => {
  const { review } = await answerStore(t);
  let firstCalls = 0;
  const first = await runReview({ session, pr, judge: review(async (request) => {
    firstCalls++; return request.challenge ? batchVote(request) : narrative;
  }) });
  assert.equal(firstCalls, 4);
  assert.equal(first.decisions[0].relevance, 'survives');
  const replay = review(async () => { throw new Error('should never run'); });
  const repeated = await runReview({ session, pr: { ...pr, enumeration: 'complete',
    files: [{ path: 'other.js', change: 'added', contentState: 'complete' }] }, judge: replay });
  assert.deepEqual(replay.answers, { calls: 0, reused: 4 }, 'the narrative and its three challenge passes');
  assert.equal(repeated.decisions[0].relevance, 'reverted');
  assert.equal(first.decisions[0].relevance, 'survives', 'the first report was not mutated');
});

test('D60 an unusable answer is never stored: the next review asks again, and the window is never fully checked', async (t) => {
  const { review } = await answerStore(t);
  const first = await runReview({ session, pr, judge: review(async (request) => request.challenge ? batchVote(request) : null) });
  assert.equal(first.windowResults[0].failure, 'model_response_invalid');
  let calls = 0;
  const repeated = await runReview({ session, pr, judge: review(async () => { calls++; return null; }) });
  assert.equal(calls, 1, 'the null answer was not stored, so the narrative was asked again');
  assert.equal(repeated.decisions.length, 0);
  assert.notEqual(repeated.coverage, 'complete');
  assert.equal(repeated.windowResults[0].failure, 'model_response_invalid');
  assert.equal(repeated.challenge.complete, false);
});

test('R3 oversized final prompt is withheld before the extraction transport', async () => {
  let calls = 0;
  const report = await runReview({ session, pr, diff: 'x'.repeat(MAX_REVIEW_INPUT_BYTES),
    judge: async () => { calls++; return narrative; } });
  assert.equal(calls, 0);
  assert.equal(report.coverage, 'missing');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.challenge.budgetExhausted, true);
});

test('R3 malformed candidates do not discard supported neighbors or fake successful coverage', async () => {
  const report = await runReview({ session, pr, judge: async (request) => request.challenge ? batchVote(request)
    : { ...narrative, decisions: [null, decision, 'prose'] } });
  assert.equal(report.decisions.length, 1);
  assert.equal(report.challenge.rejectedItems, 2);
  assert.equal(report.challenge.attemptedCalls, 3, 'malformed candidates never spend a model call');
  assert.equal(report.coverage, 'partial');
});

test('R3 ungrounded value, requirement and claim never become carry-over facts', async () => {
  const splitSession = splitAt(['E7']);
  let secondPrompt = '';
  const first = { decisions: [{ ...decision, chosen: 'UNVERIFIED_CHOICE', value: 'invented-value',
    valueReceipt: { eventId: 'E3', role: 'action', field: 'path', quote: 'config/redis.yml' } }],
    pivots: [], requirements: [{ text: 'UNVERIFIED_REQUIREMENT', status: 'open',
      instruction: { eventId: 'E1', role: 'instruction', quote: 'not a real instruction' } }],
    claims: [{ text: 'UNVERIFIED_CLAIM', stated: { eventId: 'E2', role: 'commentary', quote: 'never spoken' }, contradictedBy: null }] };
  const report = await runReview({ session: splitSession, pr, judge: async (request) => {
    if (request.challenge) return batchVote(request);
    if (request.label.endsWith('w1')) return first;
    secondPrompt = request.prompt;
    return { decisions: [], claims: [], pivots: [], requirements: [] };
  } });
  assert.ok(secondPrompt);
  for (const word of ['UNVERIFIED_CHOICE', 'UNVERIFIED_REQUIREMENT', 'UNVERIFIED_CLAIM'])
    assert.ok(!secondPrompt.includes(word), word);
  assert.equal(report.requirementsRejected, 1);
  assert.equal(report.decisions[0].valueState, 'unchecked');
  // D58: each check ran and was inconclusive — the requirement and claim are withheld and counted,
  // the value shows its own unchecked cell — so none of them caps coverage.
  assert.deepEqual(report.withheld, { proposals: 2, unsettled: 0 });
  assert.equal(report.coverage, 'complete');
  assert.ok(!JSON.stringify([report.requirements, report.findings]).includes('UNVERIFIED_'));
});

test('R3 challenger cannot cite a true event omitted from its window input', async () => {
  const splitSession = splitAt(['E7']);
  const report = await runReview({ session: splitSession, pr, judge: async (request) => {
    if (request.challenge) return batchVote(request, { ...vote(), receipts: [{ eventId: 'E9', role: 'commentary', quote: 'the tests pass' }] });
    return request.label.endsWith('w1') ? narrative : { decisions: [], claims: [], pivots: [], requirements: [] };
  } });
  assert.equal(report.decisions.length, 0);
  assert.equal(report.challenge.rejectedItems, 1);
  assert.ok(report.windowResults[0].challenge.results[0].votes.every((v) => v.reason === 'receipt_rejected'));
});

test('R3 runtime schema rejects top-level verdicts and candidate-local ratings without laundering', async () => {
  for (const field of ['approved', 'confidence']) {
    const report = await runReview({ session, pr, judge: async () => ({ decisions: [], claims: [], pivots: [], requirements: [], [field]: true }) });
    assert.equal(report.coverage, 'missing');
    assert.equal(report.sessionStatus, 'UNCHECKED');
  }
  const report = await runReview({ session, pr, judge: async (request) => request.challenge ? batchVote(request) : {
    ...narrative, decisions: [decision, { ...decision, severity: 'critical' }],
    pivots: [{ abandoned: 'A', adopted: 'B', receipts: [receipt], severity: 'critical' }],
  } });
  assert.equal(report.decisions.length, 1);
  assert.equal(report.pivots.length, 0);
  assert.equal(report.pivotsRejected, 1);
  assert.equal(report.challenge.rejectedItems, 2);
  assert.equal(report.coverage, 'partial');
  assert.ok(!JSON.stringify(report.pivots).includes('severity'));
});

test('R3 an uncontradicted claim with fabricated source is withheld and counted, never published (D58)', async () => {
  const report = await runReview({ session, pr, judge: async (request) => request.challenge ? batchVote(request) : {
    decisions: [], requirements: [], pivots: [], claims: [{ text: 'Unsupported claim',
      stated: { eventId: 'E9', role: 'commentary', quote: 'THIS SYNTHETIC QUOTE NEVER OCCURRED' }, contradictedBy: null }],
  } });
  assert.equal(report.claimsRejected, 1);
  // D58: grounding ran and the quote did not match — withheld and counted, not unchecked.
  assert.equal(report.withheld.proposals, 1);
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.windowResults[0].groundingComplete, true);
  assert.equal(report.windowResults[0].grounding.withheld, 1);
  assert.equal(report.windowResults[0].challenge.complete, true, 'resolved challenge votes do not repair a fabricated original receipt');
  assert.ok(!JSON.stringify([report.findings, report.promises ?? []]).includes('Unsupported claim'));
});

// W3-7 rewrote what this test guards. Windows are reviewed in parallel now, so a window cannot
// be shown a previous window's answer — it would be a second model's prose entering this prompt
// as evidence, and the report would depend on the order the calls finished in. The requirement
// still survives a silent or failed window; it survives through the MERGE, and what the later
// prompt carries is the human instruction the requirement came from, not the requirement.
test('R3 the requirement survives a silent or failed window, and no answer travels between windows', async () => {
  const requirement = { text: 'SYNTHETIC_CARRY_REQUIREMENT', instruction: receipt, status: 'open' };
  for (const middle of ['empty', 'failure', 'unrelated', 'addressed']) {
    const prompts = [];
    const report = await runReview({ session: threeWindowSession(), pr, judge: async (request) => {
      if (request.challenge) return batchVote(request);
      prompts.push(request.prompt);
      if (request.window.index === 0) return { ...empty(), requirements: [requirement] };
      if (request.window.index === 1) {
        if (middle === 'failure') throw new Error('synthetic transport failure');
        if (middle === 'addressed') return { ...empty(), requirements: [{ ...requirement, status: 'addressed' }] };
        if (middle === 'unrelated') return { ...empty(), requirements: [{ ...requirement, text: 'ANOTHER_REQUIREMENT', status: 'addressed' }] };
      }
      return empty();
    } });
    assert.equal(prompts.length, 3);
    for (const prompt of prompts)
      assert.ok(!prompt.includes('SYNTHETIC_CARRY_REQUIREMENT'), `a window was shown another window's answer (${middle})`);
    // What the later windows do carry: the human instruction itself — M35: repeated at the top of each later piece of its
    // segment and quotable from the inventory in the same prompt (the "Stated before this window" pointers are gone).
    for (const prompt of prompts.slice(1)) {
      assert.doesNotMatch(prompt, /## Stated before this window/);
      assert.match(prompt, /^\[E1\] HUMAN INSTRUCTION · authority=human · sequence=0 · role=instruction/m);
    }
    // One row for one requirement, and only a later GROUNDED status for the same
    // instruction+requirement replaces the earlier one. Silence and failure close nothing.
    const rows = report.requirements.filter((r) => r.text === 'SYNTHETIC_CARRY_REQUIREMENT');
    assert.equal(rows.length, 1, middle);
    assert.equal(rows[0].status, middle === 'addressed' ? 'addressed' : 'open', middle);
    if (middle === 'unrelated') assert.equal(report.requirements.length, 2);
    if (middle === 'failure') assert.equal(report.coverage, 'partial');
  }
});

test('R3 original candidates cannot cite prior-window actions or commentary, but full human inventory stays available', async () => {
  const report = await runReview({ session: threeWindowSession(), pr, judge: async (request) => {
    if (request.challenge) return batchVote(request);
    if (request.window.index !== 2) return empty();
    assert.ok(!request.prompt.includes('Caching this properly needs a shared store'));
    return { decisions: [decision], claims: [],
      pivots: [{ abandoned: 'An in-process map', adopted: 'Redis',
        receipts: [{ eventId: 'E2', role: 'commentary', quote: 'Caching this properly needs a shared store' }] }],
      requirements: [{ text: 'Use the existing infrastructure', status: 'open', instruction: receipt }] };
  } });
  assert.equal(report.decisions.length, 0);
  assert.equal(report.pivots.length, 0);
  assert.equal(report.requirements.length, 1);
  assert.equal(report.challenge.rejectedItems, 2);
  assert.equal(report.challenge.attemptedCalls, 3, 'out-of-scope original candidates are rejected before challenge');
  // D58: a proposal citing a source its window was not shown is withheld and counted; the window's
  // checks all ran on what it was shown, so coverage is not capped for it.
  assert.equal(report.withheld.proposals, 2);
  assert.equal(report.coverage, 'complete');
});

test('D60 a stored answer is checked against the sources its own request showed, exactly like a live one', async (t) => {
  const { cache, review } = await answerStore(t);
  const asked = [];
  await runReview({ session: threeWindowSession(), pr, judge: review(async (request) => { asked.push(request); return empty(); }) });
  // Window 3's stored answer is replaced by one citing window 1's events, which window 3 never showed.
  const third = asked.find((request) => request.label === 'narrative:w3');
  assert.equal(await cache.put(third, narrative), true);
  const extracted = [];
  const report = await runReview({ session: threeWindowSession(), pr,
    judge: review(async (request) => { extracted.push(request.window?.index ?? request.label); return empty(); }) });
  assert.deepEqual(extracted, [], 'every answer came from the cache');
  assert.equal(report.decisions.length, 0, 'a proposal citing a source its window was not shown is never published');
  assert.equal(report.windowResults[2].challenge.withheldProposals, 1);
});

test('R3 missing or mistyped authority fields are never converted into affirmative columns', async () => {
  const relations = [
    { instruction: decision.constrainedBy.instruction },
    { ...decision.constrainedBy, settles: 'true' },
    { ...decision.constrainedBy, instruction: { eventId: 'E1', quote: 'Add response caching' } },
    { ...decision.constrainedBy, instruction: { ...decision.constrainedBy.instruction, role: 'commentary' } },
  ];
  for (const relation of relations) {
    const candidate = toCandidates({ ...narrative, decisions: [{ ...decision, constrainedBy: relation }] }, session.sessionKey).decisions[0];
    assert.equal(candidate.constrainedBy.settles, relation.settles);
    assert.equal(candidate.constrainedBy.instruction.role, relation.instruction.role);
    const grounded = groundDecision({ repo: pr.repo, session, pr, candidate, instructionHistoryComplete: true });
    assert.equal(grounded.ok, true);
    assert.equal(grounded.decision.column, null);
    assert.equal(grounded.decision.columnState, 'unchecked');
  }
  const report = await runReview({ session, pr, judge: async (request) => {
    assert.ok(!request.challenge, 'bad authority shape must fail before challenge');
    return { ...narrative, decisions: relations.map((constrainedBy) => ({ ...decision, constrainedBy })) };
  } });
  assert.equal(report.decisions.length, 0);
  assert.equal(report.challenge.rejectedItems, 4);
  assert.equal(report.coverage, 'partial');
});

test('R3 an unchecked deterministic value is re-derived, never trusted, when its answer is reused (D58, D60)', async (t) => {
  const { review } = await answerStore(t);
  const report = await runReview({ session, pr, judge: review(async (request) => request.challenge ? batchVote(request)
    : { ...narrative, decisions: [{ ...decision, value: 'not the path in the receipt' }] }) });
  assert.equal(report.decisions[0].valueState, 'unchecked');
  // D58: the value check ran and was inconclusive; the row shows its own unchecked cell, and the
  // window whose checks all ran is complete — and so reusable (W3d-3).
  assert.equal(report.coverage, 'complete');
  assert.equal(report.challenge.complete, true);
  assert.equal(report.windowResults[0].groundingComplete, true);
  assert.equal(report.windowResults[0].grounding.uncheckedValues, 1);
  assert.equal(report.windowResults[0].challenge.complete, true);
  let extracts = 0;
  const replay = review(async () => { extracts++; return empty(); });
  const repeated = await runReview({ session, pr, judge: replay });
  assert.equal(extracts, 0);
  assert.equal(replay.answers.calls, 0);
  // Reuse regrounds the narrative: the value is derived again, and is still not trusted.
  assert.equal(repeated.decisions[0].valueState, 'unchecked');
  assert.equal(repeated.decisions[0].value, null);
});

test('R3 object-prototype event IDs are rejected without discarding supported neighbors', async () => {
  const report = await runReview({ session, pr, judge: async (request) => request.challenge ? batchVote(request) : {
    ...narrative, pivots: ['constructor', '__proto__', 'toString'].map((eventId) => ({
      abandoned: 'Synthetic earlier plan', adopted: 'Synthetic later plan',
      receipts: [{ eventId, role: 'commentary', quote: 'synthetic quote' }],
    })),
  } });
  assert.equal(report.decisions.length, 1);
  assert.equal(report.pivots.length, 0);
  assert.equal(report.challenge.rejectedItems, 3);
  assert.equal(report.challenge.attemptedCalls, 3);
  // D58: a receipt naming an event the window was not shown is withheld and counted, not unchecked.
  assert.equal(report.withheld.proposals, 3);
  assert.equal(report.coverage, 'complete');
});

test('R3 one full batch handles sixteen candidates in three fresh keyed passes', async () => {
  const items = Array.from({ length: 16 }, (_, i) => ({ ...item, key: `candidate-${i}` }));
  const requests = [];
  const result = await challenge({ items, judge: async (request) => {
    requests.push(request);
    return { votes: batchVote(request).votes.reverse() };
  } });
  // M33 brittleness M3 moved it once more (`sonah.challenge/12`): a forbidden-edit item names its breach; no other batch moved.
  // M33 brittleness M4 moved it once more (`sonah.challenge/13`): a disclosure item and its note; no other batch moved.
  // M33 brittleness M4's session route moved it once more (`sonah.challenge/14`): a forbidden-edit item no longer
  // shows the agent's statement, which is asked as a disclosure item; no other batch moved.
  // M33 integration moved it once more (`sonah.challenge/15`): one version above every branch's own (C-05 integration).
  // The disclosure narrowing moved it once more (`sonah.challenge/16`): a disclosure item's proposition and note only.
  // Stable event ids moved it once more (`sonah.challenge/17`): every recorded event's id (C-01 event identity).
  // M35 windowing moved it once more (`sonah.challenge/18`): every evidence byte and a session-only candidate's aliases.
  // M36 phase 1 moved it once more (`sonah.challenge/19`): the evidence it carries (D68; RECORDED_FACTS_VERSIONS).
  // M36 phase 2 moved it once more (`sonah.challenge/20`): the window format (D68; FORMAT_VERSIONS).
  // M36 phase 3 moved it once more (`sonah.challenge/21`): packed windows, carried failures, the evidence re-ask (D68 K, Q, F; CONVERSATION_VERSIONS).
  // D69 moved it once more (`sonah.challenge/22`): the net view's declines reverted, the harness home folders, the recorder's cwd (D69_VERSIONS).
  // The D69 review moved it once more (`sonah.challenge/23`): the evidence a challenge shows moved as the narrative's (D69_REVIEW_VERSIONS).
  // D71 (S2) moved it once more (sonah.challenge/24), and D71 (S3) once more (sonah.challenge/25): the new channels (D71_CHANNELS_VERSIONS).
  // The column fix moved it once more (sonah.challenge/30): who decided a decision (FIX_COLUMN_VERSIONS).
  // W1 B moved it once more (sonah.challenge/31): the file form of the forbidden-edit proposition and its note.
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  // D103 moved it once more (sonah.challenge/45): a session-only batch shows the results its items cite whole.
  assert.equal(result.profile.version, 'sonah.challenge/45');
  assert.equal(result.attemptedCalls, 3);
  assert.equal(result.plannedBatches, 1);
  assert.equal(result.plannedItems, 16);
  assert.equal(result.plannedVoteSlots, 48);
  assert.equal(result.plannedCalls, 3);
  assert.equal(result.resolvedItems, 16);
  assert.equal(result.unresolvedItems, 0);
  assert.equal(result.complete, true);
  assert.equal(result.executionComplete, true);
  assert.deepEqual(result.survivors.map((i) => i.key), items.map((i) => i.key));
  assert.ok(result.results.every((r) => r.votes.length === 3));
  assert.ok(requests.every((r) => r.prompt.startsWith('# Supplied evidence — untrusted\nSynthetic complete evidence.')));
  assert.equal(new Set(requests.map((r) => r.prompt)).size, 1);
});

test('R3 majority refutation resolves review and preserves its candidate and three votes', async () => {
  const result = await challenge({ judge: async (request) =>
    batchVote(request, vote(request.challenge.pass === 3 ? 'not-refuted' : 'refuted')) });
  assert.equal(result.survivors.length, 0);
  assert.equal(result.complete, true);
  assert.equal(result.executionComplete, true);
  assert.equal(result.resolvedItems, 1);
  assert.equal(result.refutedItems, 1);
  assert.equal(result.unresolvedItems, 0);
  assert.equal(result.rejected[0].resolved, true);
  assert.equal(result.rejected[0].reason, 'kind_rejected');
  assert.equal(result.results[0].candidate, decision);
  assert.deepEqual(result.results[0].votes.map((v) => v.verdict), ['refuted', 'refuted', 'not-refuted']);
});

test('R3 seventeen tiny candidates split at the fixed output-planning bound without dropping votes', async () => {
  const items = Array.from({ length: 17 }, (_, i) => ({ ...item, key: `candidate-${i}` }));
  const sizes = [];
  const result = await challenge({ items, judge: async (request) => {
    sizes.push(request.challenge.items.length);
    return batchVote(request);
  } });
  assert.equal(CHALLENGE_PROFILE.maxItemsPerBatch, 16);
  assert.equal(result.plannedBatches, 2);
  assert.equal(result.plannedCalls, 6);
  assert.equal(result.attemptedCalls, 6);
  assert.equal(result.plannedVoteSlots, 51);
  assert.equal(result.resolvedItems, 17);
  // D145: both batches' first passes, then each batch's later passes.
  assert.deepEqual(sizes, [16, 1, 16, 16, 1, 1]);
  assert.equal(result.complete, true);
});

test('R3 three valid abstentions complete execution but never resolve or support a candidate', async () => {
  const result = await challenge({ judge: async (request) =>
    batchVote(request, { ...vote('uncertain'), receipts: [] }) });
  assert.equal(result.executionComplete, true);
  // D58: complete means executed; the unsettled item is withheld and counted.
  assert.equal(result.complete, true);
  assert.equal(result.unsettledItems, 1);
  assert.equal(result.unresolvedItems, 1);
  assert.equal(result.survivors.length, 0);
  assert.equal(result.refutedItems, 0);
  assert.equal(result.rejected[0].resolved, false);
  // W3d-4: it ran and was not settled — `unsettled`, never the not-run `unreviewed_scope`.
  assert.equal(result.rejected[0].reason, 'unsettled');
});

test('R3 invalid batch envelopes, duplicate and foreign response identities cannot launder votes', async () => {
  const second = { ...item, key: 'second' };
  const transforms = [
    () => vote(),
    (answer) => ({ ...answer, confidence: 1 }),
    (answer) => ({ votes: [...answer.votes, answer.votes[0]] }),
    (answer) => ({ votes: [...answer.votes, { ...answer.votes[0], key: 'foreign' }] }),
    (answer) => ({ votes: [null, ...answer.votes] }),
    () => ({ votes: {} }),
  ];
  for (const transform of transforms) {
    const result = await challenge({ items: [item, second], judge: async (request) => transform(batchVote(request)) });
    assert.equal(result.survivors.length, 0);
    assert.equal(result.executionComplete, false);
    assert.equal(result.unresolvedItems, 2);
    assert.ok(result.results.every((r) => r.votes.length === 3 && r.votes.every((v) => !v.valid)));
  }
});

test('R3 missing and locally malformed rows remain explicit without discarding supported neighbors', async () => {
  const items = [item, { ...item, key: 'missing' }, { ...item, key: 'rated' }];
  const result = await challenge({ items, judge: async (request) => ({ votes: [
    { key: item.key, ...vote() }, { key: 'rated', ...vote(), severity: 'high' },
  ] }) });
  assert.equal(result.survivors.length, 1);
  assert.equal(result.results[0].resolved, true);
  assert.equal(result.results[1].votes[0].reason, 'unreviewed_scope');
  assert.equal(result.results[2].votes[0].reason, 'kind_rejected');
  assert.equal(result.unresolvedItems, 2);
  assert.equal(result.complete, false);
});

test('R3 receipt validation gets the keyed item, including object-prototype-shaped keys', async () => {
  const items = ['__proto__', 'constructor', 'toString'].map((key) => ({ ...item, key }));
  const seen = new Map();
  const result = await challenge({ items, verifyReceipt: (r, current) => {
    seen.set(current.key, (seen.get(current.key) ?? 0) + 1);
    return current.key === 'constructor' ? { ok: false } : verifyReceipt(session, r);
  } });
  // `sonah.challenge/44`: the rejected item's three votes stand; none is asked again.
  assert.deepEqual([...seen.values()], [3, 3, 3]);
  assert.deepEqual(result.survivors.map((x) => x.key), ['__proto__', 'toString']);
  assert.equal(result.results[1].votes[0].reason, 'receipt_rejected');
});

test('R3 duplicate or invalid input identities fail before any judge request', async () => {
  let calls = 0;
  for (const items of [[item, item], [null], [{ ...item, key: '' }], [{ ...item, type: '' }]])
    await assert.rejects(challenge({ items, judge: async () => { calls++; } }), TypeError);
  await assert.rejects(challenge({ items: [], evidence: null }), TypeError);
  assert.equal(calls, 0);
});

test('R3 actual UTF-8 framing admits an exact-fit batch and rejects a one-byte excess without clipping', async () => {
  let baseBytes;
  await challenge({ evidence: '', judge: async (request) => { baseBytes = reviewInputBytes(request); return batchVote(request); } });
  const room = MAX_REVIEW_INPUT_BYTES - baseBytes;
  const evidence = 'é'.repeat(Math.floor(room / 2)) + 'x'.repeat(room % 2);
  let calls = 0;
  const exact = await challenge({ evidence, judge: async (request) => {
    calls++;
    assert.equal(reviewInputBytes(request), MAX_REVIEW_INPUT_BYTES);
    assert.ok(request.prompt.includes(evidence));
    return batchVote(request);
  } });
  assert.equal(calls, 3);
  assert.equal(exact.complete, true);
  const excess = await challenge({ evidence: evidence + 'x', judge: async () => { calls++; } });
  assert.equal(calls, 3);
  assert.equal(excess.attemptedCalls, 0);
  assert.equal(excess.plannedCalls, 0);
  assert.equal(excess.plannedVoteSlots, 3);
  assert.equal(excess.results[0].votes.length, 3);
  assert.equal(excess.budgetExhausted, true);
  assert.equal(excess.complete, false);
});

test('R3 byte-overflow batches retain all evidence and deterministic membership across passes and runs', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ ...item, key: `large-${i}`,
    candidate: { ...decision, chosen: 'é'.repeat(120000) } }));
  const evidence = 'SYNTHETIC_FULL_EVIDENCE\nwhitespace\t remains exact.\n';
  const runs = [];
  for (let i = 0; i < 2; i++) {
    const seen = [];
    const result = await challenge({ items, evidence, judge: async (request) => {
      seen.push({ batch: request.challenge.batchIndex, pass: request.challenge.pass,
        keys: request.challenge.items.map((i) => i.key), prompt: request.prompt });
      assert.ok(request.prompt.startsWith(`# Supplied evidence — untrusted\n${evidence}\n\n# Candidates`));
      assert.ok(requestFits(request));
      return batchVote(request);
    } });
    assert.equal(result.plannedBatches, 3);
    assert.equal(result.attemptedCalls, 9);
    assert.equal(result.resolvedItems, 5);
    runs.push(seen);
  }
  assert.deepEqual(runs[0], runs[1]);
  for (let batch = 0; batch < 3; batch++)
    assert.equal(new Set(runs[0].filter((x) => x.batch === batch).map((x) => x.prompt)).size, 1);
});

test('R3 oversized and invalid singletons leave all slots unchecked while fitting neighbors still run', async () => {
  const items = [
    { ...item, key: 'oversized', candidate: { ...decision, chosen: 'x'.repeat(MAX_REVIEW_INPUT_BYTES) } },
    { ...item, key: 'invalid', candidate: null }, item,
  ];
  const result = await challenge({ items });
  assert.equal(result.plannedItems, 3);
  assert.equal(result.plannedVoteSlots, 9);
  assert.equal(result.attemptedCalls, 3);
  assert.deepEqual(result.survivors.map((i) => i.key), [item.key]);
  assert.ok(result.results.every((r) => r.votes.length === 3));
  assert.equal(result.unresolvedItems, 2);
  assert.equal(result.budgetExhausted, true);
});

test('R3 one failed batch pass remains incomplete without leaking transport errors or losing another batch', async () => {
  const items = [item, { ...item, key: 'other' }].map((i) => ({ ...i,
    candidate: { ...decision, chosen: 'x'.repeat(300000) } }));
  const result = await challenge({ items, judge: async (request) => {
    if (request.challenge.batchIndex === 0 && request.challenge.pass === 1)
      throw new Error('SYNTHETIC_PRIVATE_TRANSPORT_TEXT');
    return batchVote(request);
  } });
  assert.equal(result.attemptedCalls, 6);
  assert.equal(result.survivors.length, 2);
  assert.equal(result.results[0].resolved, false);
  assert.equal(result.results[1].resolved, true);
  assert.equal(result.complete, false);
  assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_TRANSPORT_TEXT'));
});

test('R3 late budget exhaustion retains every unstarted item/pass slot and prior resolved batches', async () => {
  const items = [item, { ...item, key: 'other' }].map((i) => ({ ...i,
    candidate: { ...decision, chosen: 'x'.repeat(300000) } }));
  const exhaustedAt = (pass) => challenge({ items, concurrency: 1, judge: async (request) => {
    if (request.challenge.batchIndex === 1 && request.challenge.pass === pass)
      throw Object.assign(new Error('synthetic quota'), { code: 'budget_exhausted' });
    return batchVote(request);
  } });
  // D145: the queue is b1p1, b2p1, b1p2, b1p3, b2p2, b2p3. Exhausted at the second batch's second pass, the first
  // batch's three passes ran before it and resolve it.
  const result = await exhaustedAt(2);
  assert.equal(result.plannedCalls, 6);
  assert.equal(result.attemptedCalls, 5);
  assert.equal(result.results[0].resolved, true);
  assert.equal(result.results[1].resolved, false);
  assert.ok(result.results.every((r) => r.votes.length === 3));
  assert.equal(result.budgetExhausted, true);
  // Exhausted at the second batch's first pass, the first batch's later passes, queued after it, never start; each
  // keeps its slot unanswered.
  const early = await exhaustedAt(1);
  assert.equal(early.attemptedCalls, 2);
  assert.ok(early.results.every((r) => r.resolved === false && r.votes.length === 3));
  assert.deepEqual(early.results[0].votes.map((v) => v.answered), [true, false, false]);
  assert.equal(early.budgetExhausted, true);
});

test('R3 valid empty candidate set requires no challenge calls or fictitious votes', async () => {
  const result = await challenge({ items: [], judge: async () => { throw new Error('must not call'); } });
  assert.equal(result.complete, true);
  assert.equal(result.executionComplete, true);
  for (const key of ['plannedBatches', 'plannedItems', 'plannedVoteSlots', 'plannedCalls',
    'attemptedCalls', 'resolvedItems', 'refutedItems', 'unresolvedItems']) assert.equal(result[key], 0);
  assert.deepEqual(result.results, []);
});
