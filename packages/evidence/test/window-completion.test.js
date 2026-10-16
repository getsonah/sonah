// W3d-1. Real review windows complete: the unvoted are re-asked once, near-miss vote quotes are
// repaired exactly as grounding repairs them, relevance is unknown only for the decision whose own
// file could make it wrong, and a window says which half of its grounding fell short and how its
// transport failed.
//
// Nothing here lowers a bar. An item still needs two grounded support votes to publish, there is
// at most one re-ask per pass, and a transport's own words are never recorded.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called; every judge is a table keyed by window index, item key and pass — never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { challengeItems, CHALLENGE_PROFILE } from '../src/challenge.js';
// A namespace import, so each test here fails on its own against code that predates it rather
// than the whole file failing to link.
import * as reviewRun from '../src/run-review.js';
import { runCodeReview, snapshotDiff } from '../src/code-review.js';
import { groundDecision } from '../src/ledger.js';
import { planWindows, COMBINED_WINDOW_SETTINGS } from '../src/windows.js';
import { Session, verifyReceipt, repairReceipt } from '../src/session.js';

const { runReview } = reviewRun;

const REPO = { host: 'github.com', id: '41' };
const modulePath = (i) => `src/step-${i}.js`;
const scratchPath = (i) => `scratch/note-${i}.txt`;
const SECRET = 'src/secret.js';
const ITEM_KEYS = ['decisions:0', 'decisions:1', 'requirements:0'];

/**
 * `count` windows, one per recorded compaction. Each holds a human instruction (with straight
 * quotes, for the curly-quote repair), the agent's words, a write to a module the PR contains, a
 * write to a scratch note the PR does not contain, and both results.
 */
function windowedSession(count) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `SYNTHETIC_W3D_ASK_${i}: write the "step ${i}" module and keep a scratch note beside it.`;
    // M35 (windowing): a compaction no longer splits a window; a long statement (150,000 bytes) puts each segment in a
    // combined review's window (54,613 tokens) of its own.
    blobs[`said${i}`] = `SYNTHETIC_W3D_SAID_${i}: writing the step ${i} module and its scratch note now.\n${'f'.repeat(150_000)}`;
    blobs[`module${i}`] = `export const SYNTHETIC_W3D_STEP_${i} = ${i};\n`;
    blobs[`note${i}`] = `SYNTHETIC_W3D_NOTE_${i}\n`;
    blobs[`ok${i}`] = `SYNTHETIC_W3D_OK_${i}: wrote 1 file.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human',
      text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working',
      text: whole(`said${i}`), beforeInvocation: `A${i}` });
    for (const [id, path, body] of [[`A${i}`, modulePath(i), `module${i}`], [`S${i}`, scratchPath(i), `note${i}`]]) {
      events.push({ id, kind: 'invocation', sequence: sequence++, callKey: id.toLowerCase(),
        tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
        changes: [{ path, before: [], after: whole(body), diff: [] }] });
      events.push({ id: `${id}-r`, kind: 'observation', sequence: sequence++, invocation: id,
        callKey: id.toLowerCase(), phase: 'terminal', result: 'succeeded', exitCode: 0,
        output: whole(`ok${i}`), sourceOfResult: 'native', terminalStatusProven: true });
    }
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-w3d', adapter: 'claude', events, blobs });
}

const decisionAbout = (i, action, path) => ({
  dimension: `SYNTHETIC_W3D_DIMENSION_${action}`,
  chosen: `SYNTHETIC_W3D_CHOSEN_${action}`,
  value: path,
  valueReceipt: { eventId: action, field: 'path', role: 'action', quote: path },
  actions: [action],
  stated: { eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_W3D_SAID_${i}` },
  constrainedBy: { instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W3D_ASK_${i}` },
    settles: false, settledValueQuote: null },
});

/** Three challenge items per window: a decision the PR keeps, one it does not, a requirement. */
const narrativeFor = (i) => ({
  decisions: [decisionAbout(i, `A${i}`, modulePath(i)), decisionAbout(i, `S${i}`, scratchPath(i))],
  pivots: [], claims: [],
  requirements: [{ text: `SYNTHETIC_W3D_REQUIREMENT_${i}`, status: 'open',
    instruction: { eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_W3D_ASK_${i}` } }],
});

/** Every module the session wrote, plus one file whose only hunk was withheld by redaction. */
const prWithRedactedHunk = (count) => ({ repo: REPO, enumeration: 'complete',
  files: [...Array.from({ length: count }, (_, k) => ({ path: modulePath(k + 1), change: 'added', contentState: 'complete' })),
    { path: SECRET, change: 'modified', contentState: 'partial' }] });

/** `narrative:w3`, `challenge:w3:b1:p2` and `challenge:w3:reask:p2` all answer 3. */
const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
const supportVote = (key, index, quote = `SYNTHETIC_W3D_ASK_${index}`) => ({ key, verdict: 'not-refuted',
  explanation: 'The cited instruction asks for exactly this.',
  receipts: [{ eventId: `I${index}`, role: 'instruction', quote }] });

/**
 * A reviewer whose challenger leaves out the items `omit` names. `omit({window, key, pass, reask})`
 * is a pure function of the slot, so the outcome never depends on which call finished first.
 */
function reviewer({ omit = () => false, calls = [], narrative = narrativeFor, quoteFor } = {}) {
  return async (request) => {
    const window = windowOf(request.label);
    if (!request.challenge) return narrative(window);
    const { pass, reask = false } = request.challenge;
    calls.push({ label: request.label, window, pass, reask, keys: request.challenge.items.map((i) => i.key) });
    return { votes: request.challenge.items
      .filter(({ key }) => !omit({ window, key, pass, reask }))
      .map(({ key }) => supportVote(key, window, quoteFor?.({ window, key, pass }))) };
  };
}

const complete = (w) => w.failure === null && w.challenge.complete === true && w.groundingComplete === true;

// ---- 1. the unvoted are re-asked once -----------------------------------------------------

const session = windowedSession(1);
const items = ['i1', 'i2', 'i3', 'i4'].map((key) => ({ key, type: 'requirement', candidate: { text: key } }));
const exact = (r) => verifyReceipt(session, r);
const grounded = { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D_ASK_1' };
const answering = ({ omit = () => false, requests = [], verdict = () => 'not-refuted', receipt = () => grounded } = {}) =>
  async (request) => {
    const { pass, reask = false } = request.challenge;
    requests.push({ pass, reask, keys: request.challenge.items.map((i) => i.key), label: request.label });
    return { votes: request.challenge.items.filter(({ key }) => !omit({ key, pass, reask }))
      .map(({ key }) => ({ key, verdict: verdict({ key, pass, reask }), explanation: 'Synthetic vote.',
        receipts: [receipt({ key, pass, reask })] })) };
  };

test('W3d-1 a reply that omits item 3 is re-asked once, with item 3 alone, and the challenge completes', async () => {
  const requests = [];
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ requests, omit: ({ key, pass, reask }) => key === 'i3' && pass === 1 && !reask }) });
  assert.equal(result.complete, true);
  assert.equal(result.executionComplete, true);
  assert.equal(result.survivors.length, 4);
  assert.equal(result.attemptedCalls, 4, 'three passes and one re-ask, and the re-ask is counted');
  assert.equal(result.reaskCalls, 1);
  const reasks = requests.filter((r) => r.reask);
  assert.deepEqual(reasks.map((r) => ({ pass: r.pass, keys: r.keys })), [{ pass: 1, keys: ['i3'] }],
    'one batch containing only the unvoted item, for the pass that left it out');
  assert.equal(new Set(requests.map((r) => r.label)).size, requests.length, 'the re-ask has its own label');
  const slot = result.results[2].votes.find((v) => v.pass === 1);
  assert.equal(slot.valid, true);
  assert.equal(slot.reasked, true, 'the vote says it came from the re-ask');
  assert.equal(result.results[2].votes.length, CHALLENGE_PROFILE.passes);
});

test('W3d-1 omitted twice stays unresolved: one re-ask only, never an open-ended retry', async () => {
  const requests = [];
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ requests, omit: ({ key, pass }) => key === 'i3' && pass === 1 }) });
  assert.equal(result.complete, false);
  assert.equal(result.attemptedCalls, 4);
  assert.equal(requests.filter((r) => r.reask).length, 1);
  assert.equal(result.unresolvedItems, 1);
  const slot = result.results[2].votes.find((v) => v.pass === 1);
  assert.equal(slot.valid, false);
  assert.equal(slot.reason, 'unreviewed_scope', 'a re-ask that also omitted it leaves the honest reason');
  assert.equal(slot.reasked, true);
  // Omitted in every pass, every time: exactly one re-ask per pass, three in all.
  const always = [];
  const worst = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ requests: always, omit: ({ key }) => key === 'i3' }) });
  assert.equal(worst.attemptedCalls, 6);
  assert.deepEqual(always.filter((r) => r.reask).map((r) => r.pass).sort(), [1, 2, 3]);
  assert.equal(worst.complete, false);
  assert.equal(worst.survivors.some((s) => s.key === 'i3'), false);
});

test('W3d-1 a malformed batch reply is re-asked once for that pass; a malformed re-ask changes nothing', async () => {
  const requests = [];
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: async (request) => {
      const { pass, reask = false } = request.challenge;
      requests.push({ pass, reask });
      if (pass === 2 && !reask) return { votes: 'not an array' };
      return answering()(request);
    } });
  assert.equal(result.complete, true);
  assert.equal(result.attemptedCalls, 4);
  assert.deepEqual(requests.filter((r) => r.reask), [{ pass: 2, reask: true }]);

  const stubborn = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: async (request) => request.challenge.pass === 2 ? { votes: 'not an array' } : answering()(request) });
  assert.equal(stubborn.complete, false);
  assert.equal(stubborn.attemptedCalls, 4);
  assert.ok(stubborn.results.every((r) => r.votes.find((v) => v.pass === 2).reason === 'kind_rejected'));
});

test('W3d-1 the re-ask is a second chance to vote, not a lower bar', async () => {
  // The re-ask refutes: the item had one support vote and a refutation, so it does not publish.
  const refuted = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ omit: ({ key, pass, reask }) => key === 'i3' && pass === 1 && !reask,
      verdict: ({ key, pass, reask }) => key === 'i3' && (reask || pass === 2) ? 'refuted' : 'not-refuted' }) });
  assert.equal(refuted.survivors.some((s) => s.key === 'i3'), false);
  // The re-ask's own quote does not ground: its vote is rejected exactly like a first reply's.
  const fabricated = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ omit: ({ key, pass, reask }) => key === 'i3' && pass === 1 && !reask,
      receipt: ({ reask }) => reask ? { ...grounded, quote: 'SYNTHETIC_W3D_NEVER_SAID' } : grounded }) });
  // D58: the re-ask was answered, so the challenge ran; the answer's quote did not verify.
  assert.equal(fabricated.complete, true);
  assert.equal(fabricated.results[2].votes.find((v) => v.pass === 1).reason, 'receipt_rejected');
  assert.equal(fabricated.results[2].votes.find((v) => v.pass === 1).valid, false);
  assert.equal(fabricated.survivors.length, 4, 'two grounded support votes from passes 2 and 3 were always enough');
  const onlyOne = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ omit: ({ key, pass }) => key === 'i3' && pass !== 3 }) });
  assert.equal(onlyOne.survivors.some((s) => s.key === 'i3'), false, 'one grounded support vote never publishes');
});

test('W3d-1 only an omitted or malformed-batch slot is re-asked: not a thrown call, not a rejected quote', async () => {
  const thrown = [];
  const failed = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: async (request) => {
      thrown.push(request.challenge.reask === true);
      if (request.challenge.pass === 1) throw new Error('SYNTHETIC_PRIVATE_TRANSPORT_TEXT');
      return answering()(request);
    } });
  assert.deepEqual(thrown.filter(Boolean), [], 'a transport failure is the transport retry\'s business');
  assert.equal(failed.attemptedCalls, 3);
  assert.ok(!JSON.stringify(failed).includes('SYNTHETIC_PRIVATE_TRANSPORT_TEXT'));
  const rejected = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ receipt: ({ key, pass }) => key === 'i3' && pass === 1
      ? { ...grounded, quote: 'SYNTHETIC_W3D_NEVER_SAID' } : grounded }) });
  assert.equal(rejected.attemptedCalls, 3, 'a vote that was cast and rejected is not re-asked');
  assert.equal(rejected.reaskCalls, 0);
});

test('W3d-1 omissions from two batches of one pass share its one re-ask', async () => {
  const many = Array.from({ length: 17 }, (_, i) => ({ key: `k${i}`, type: 'requirement', candidate: { text: `k${i}` } }));
  const requests = [];
  const result = await challengeItems({ items: many, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ requests, omit: ({ key, pass, reask }) => ['k2', 'k16'].includes(key) && pass === 1 && !reask }) });
  assert.equal(result.plannedBatches, 2);
  assert.equal(result.attemptedCalls, 7);
  assert.deepEqual(requests.filter((r) => r.reask).map((r) => r.keys), [['k2', 'k16']]);
  assert.equal(result.complete, true);
});

test('W3d-1 re-asks obey the in-flight limit, and a budget stop ends them', async () => {
  let active = 0, highWater = 0;
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact, concurrency: 2,
    judge: async (request) => {
      active++; highWater = Math.max(highWater, active);
      await new Promise((resolve) => setImmediate(resolve));
      active--;
      return answering({ omit: ({ key, reask }) => key === 'i3' && !reask })(request);
    } });
  assert.equal(result.attemptedCalls, 6);
  assert.equal(result.complete, true);
  assert.ok(highWater <= 2, `${highWater} calls were in flight above a limit of 2`);

  const reasks = [];
  const stopped = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact, concurrency: 1,
    judge: async (request) => {
      if (request.challenge.reask) {
        reasks.push(request.challenge.pass);
        throw Object.assign(new Error('synthetic quota'), { code: 'budget_exhausted' });
      }
      return answering({ omit: ({ key }) => key === 'i3' })(request);
    } });
  assert.deepEqual(reasks, [1], 'a budget stop ends the re-asks queued behind it');
  assert.equal(stopped.budgetExhausted, true);
  assert.equal(stopped.complete, false);
});

test('W3d-1 in a review, a challenger that omits item 3 once still completes the window', async () => {
  const calls = [];
  const report = await runReview({ session, pr: prWithRedactedHunk(1), judge: reviewer({ calls,
    omit: ({ key, pass, reask }) => key === 'requirements:0' && pass === 1 && !reask }) });
  const window = report.windowResults[0];
  assert.equal(window.challenge.complete, true);
  assert.equal(window.challenge.attemptedCalls, 4);
  assert.equal(window.shortfall.challenge.reason, null);
  assert.deepEqual(calls.filter((c) => c.reask).map((c) => c.keys), [['requirements:0']]);
  assert.equal(report.requirements.length, 1);
});

// ---- 2. repair applies to challenge votes ------------------------------------------------

test('W3d-1 a curly-quote vote is snapped to the exact source and counted as repaired', async () => {
  // The instruction says "step 1" with straight quotes; the challenger typed curly ones.
  const curly = 'write the “step 1” module';
  assert.equal(verifyReceipt(session, { ...grounded, quote: curly }).ok, false, 'premise: strictly, it does not ground');
  assert.equal(repairReceipt(session, { ...grounded, quote: curly }).ok, true, 'premise: grounding would repair it');
  const report = await runReview({ session, pr: prWithRedactedHunk(1),
    judge: reviewer({ quoteFor: () => curly }) });
  const challenge = report.windowResults[0].challenge;
  assert.equal(challenge.complete, true);
  assert.equal(challenge.repairedVotes, 9, 'three items, three passes, each vote snapped once');
  for (const vote of challenge.results.flatMap((r) => r.votes)) {
    assert.equal(vote.valid, true);
    assert.equal(vote.receipts[0].quote, 'write the "step 1" module', 'the exact source substring, not the model\'s');
    assert.equal(vote.receipts[0].repaired, true);
    assert.equal(vote.receipts[0].original, curly);
  }
  assert.equal(report.decisions.length, 2);
});

test('W3d-1 repair never reaches past the supplied window or the declared role', async () => {
  const two = windowedSession(2);
  // Window 2's challenger quotes window 1's commentary with a doubled space: repairable against the
  // session, but absent from the input window 2 was given, so it stays rejected.
  const report = await runReview({ session: two, pr: prWithRedactedHunk(2), judge: async (request) => {
    const window = windowOf(request.label);
    if (!request.challenge) return window === 2 ? narrativeFor(2) : { decisions: [], pivots: [], claims: [], requirements: [] };
    return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'x',
      receipts: [{ eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_W3D_SAID_1:  writing the step 1 module' }] })) };
  } });
  assert.ok(report.windowResults[1].challenge.results.flatMap((r) => r.votes).every((v) => v.reason === 'receipt_rejected'));
  // A wrong role is rejected, never repaired.
  const wrongRole = await runReview({ session, pr: prWithRedactedHunk(1), judge: async (request) => {
    if (!request.challenge) return narrativeFor(1);
    return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'x',
      receipts: [{ eventId: 'I1', role: 'commentary', quote: 'SYNTHETIC_W3D_ASK_1' }] })) };
  } });
  assert.equal(wrongRole.windowResults[0].challenge.repairedVotes, 0);
  assert.equal(wrongRole.decisions.length, 0);
});

test('W3d-1 the code review\'s challenge verifier repairs a curly-quote vote on frozen code', async () => {
  const diff = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/greet.js', '@@ -0,0 +1,2 @@', '+const GREETING = "hello, world";', '+export default GREETING;', ''].join('\n');
  const pr = { repo: REPO, number: 7, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
    gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: 'src/greet.js', change: 'added', contentState: 'complete' }] };
  const source = snapshotDiff({ pr, diff }).sources.find((s) => s.side === 'RIGHT' && s.text.includes('GREETING ='));
  assert.ok(source, 'premise: the frozen change has a quotable source');
  const receipt = { role: 'code', eventId: source.eventId, revisionOid: source.revisionOid, quote: 'GREETING = "hello, world"' };
  const candidate = { origin: 'code-review', kind: 'code_issue', title: 'The greeting is a hardcoded literal',
    explanation: 'The greeting cannot be localised because it is a literal in the module.',
    receipts: [receipt], scope: 'current-code', anchor: { path: 'src/greet.js', side: 'RIGHT', startLine: 1, endLine: 1 } };
  const report = await runCodeReview({ pr, diff,
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [candidate],
      sessionFindings: [], reviewedFiles: ['src/greet.js'] }),
    challengeJudge: async ({ challenge }) => ({ votes: challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'The literal is in the frozen code.', receipts: [{ ...receipt, quote: 'GREETING = “hello, world”' }] })) }) });
  assert.equal(report.codeChallenges[0].complete, true);
  assert.equal(report.codeChallenges[0].repairedVotes, 3);
  assert.equal(report.findings.filter((f) => f.origin === 'code-review').length, 1);
  const vote = report.codeChallenges[0].results[0].votes[0];
  assert.equal(vote.receipts[0].quote, 'GREETING = "hello, world"');
  assert.equal(vote.receipts[0].revisionOid, source.revisionOid, 'repair never changes the frozen revision');
});

// ---- 3. relevance is unknown only for the decision it concerns -----------------------------

test('W3d-1 a redacted hunk in b.js leaves a decision about a.js with a known relevance', () => {
  const s = windowedSession(1);
  const rel = (pr, actions) => groundDecision({ repo: REPO, session: s, pr, instructionHistoryComplete: true,
    candidate: { ...decisionAbout(1, actions[0], null), value: null, valueReceipt: null, actions, actorSession: s.sessionKey } })
    .decision.relevance;
  const pr = { repo: REPO, enumeration: 'complete', files: [
    { path: modulePath(1), change: 'added', contentState: 'complete' },
    { path: 'src/b.js', change: 'modified', contentState: 'partial' }] };
  assert.equal(rel(pr, ['A1']), 'survives', 'a.js is in the list');
  assert.equal(rel(pr, ['S1']), 'reverted', 'a complete list without the path says it is not in the PR, whatever b.js lost');
  // Still unknown where it could be wrong for THIS decision.
  assert.equal(rel({ ...pr, enumeration: 'partial' }, ['S1']), 'unchecked', 'an unlisted file could hold the path');
  const own = { ...pr, files: [...pr.files, { path: scratchPath(1), change: 'deleted', contentState: 'partial' }] };
  assert.equal(rel(own, ['S1']), 'unchecked', 'the decision\'s own file is the one the reader could not fully read');
  const renamed = { ...pr, files: [...pr.files, { path: 'scratch/moved.txt', oldPath: scratchPath(1),
    change: 'renamed', contentState: 'partial' }] };
  assert.equal(rel(renamed, ['S1']), 'unchecked', 'a partial rename away from the decision\'s file is its own file');
});

// ---- 4. which half of grounding fell short ---------------------------------------------------

test('W3d-1 shortfall.grounding says whether the session grounded and how many relevances are unknown', async () => {
  const partial = { repo: REPO, enumeration: 'partial', files: [{ path: modulePath(1), change: 'added', contentState: 'complete' }] };
  const report = await runReview({ session, pr: partial, judge: reviewer() });
  const window = report.windowResults[0];
  assert.equal(window.groundingComplete, false);
  assert.equal(window.shortfall.grounding.sessionGrounded, true);
  assert.equal(window.shortfall.grounding.relevanceUnchecked, 1, 'only the scratch note could be anywhere');

  const fabricated = await runReview({ session, pr: prWithRedactedHunk(1), judge: reviewer({ narrative: () => ({
    ...narrativeFor(1), claims: [{ text: 'SYNTHETIC_W3D_CLAIM', stated: { eventId: 'C1', role: 'commentary',
      quote: 'SYNTHETIC_W3D_NEVER_SAID' }, contradictedBy: null }] }) }) });
  // D58: grounding ran; the claim whose quote did not match is withheld and counted, not ungrounded.
  assert.equal(fabricated.windowResults[0].shortfall.grounding.sessionGrounded, true);
  assert.equal(fabricated.windowResults[0].grounding.withheld, 1);
  assert.equal(fabricated.windowResults[0].shortfall.grounding.relevanceUnchecked, 0);
  // A proposal no check could evaluate still leaves the session ungrounded.
  const unread = await runReview({ session, pr: prWithRedactedHunk(1), judge: reviewer({ narrative: () => ({
    ...narrativeFor(1), decisions: [{ ...decisionAbout(1, 'A1', modulePath(1)), actions: [], value: null, valueReceipt: null }] }) }) });
  assert.equal(unread.windowResults[0].shortfall.grounding.sessionGrounded, false);
  for (const w of [...report.windowResults, ...fabricated.windowResults, ...unread.windowResults])
    assert.equal(w.groundingComplete, w.shortfall.grounding.sessionGrounded && w.shortfall.grounding.relevanceUnchecked === 0);
});

// ---- 5. transport failures are classified without text --------------------------------------

test('W3d-1 a window records the transport class beside its closed failure token, never the text', async () => {
  const two = windowedSession(2);
  for (const [transportClass, expected] of [...(reviewRun.TRANSPORT_SHORTFALL ?? []).map((c) => [c, c]),
    ['SYNTHETIC_NOT_A_CLASS', 'unknown'], [undefined, null]]) {
    const report = await runReview({ session: two, pr: prWithRedactedHunk(2), judge: async (request) => {
      if (!request.challenge && windowOf(request.label) === 2)
        throw Object.assign(new Error('SYNTHETIC_STDERR ANTHROPIC_API_KEY=sk-ant-FAKE'),
          { code: 'model_unavailable', ...(transportClass ? { transportClass } : {}) });
      return reviewer()(request);
    } });
    const [ok, failed] = report.windowResults;
    assert.equal(failed.failure, 'model_unavailable', 'the reason stays the closed token');
    assert.equal(failed.shortfall.narrative, 'model_unavailable');
    assert.equal(failed.shortfall.transport, expected, String(transportClass));
    assert.equal(ok.shortfall.transport, null);
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC_STDERR'));
    assert.ok(!JSON.stringify(report).includes('SYNTHETIC_NOT_A_CLASS'));
  }
  assert.deepEqual(reviewRun.TRANSPORT_SHORTFALL,
    ['timeout', 'exit_nonzero', 'output_limit', 'spawn_failed', 'no_output', 'unknown',
      // The agent transport's two limits (cli/src/review-judge.js AGENT_RESULT_FAILURES).
      'turn_limit', 'structured_output_failed']);
  for (const token of reviewRun.TRANSPORT_SHORTFALL) assert.match(token, /^[a-z][a-z_]*$/);
});

// ---- 6. many windows, one redacted hunk and some replies omitting an item, as a regression guard ----------------------------------------------

test('W3d-1 nine windows, one redacted hunk, 1 in 10 first replies omitting an item: every window completes', async () => {
  const COUNT = 9;
  const s = windowedSession(COUNT);
  assert.equal(planWindows(s, COMBINED_WINDOW_SETTINGS).length, COUNT, 'premise: nine windows');
  // Slot n = ((window - 1) * 3 + item) * 3 + (pass - 1); every tenth slot is left out of its first reply.
  const omit = ({ window, key, pass, reask }) => !reask
    && (((window - 1) * ITEM_KEYS.length + ITEM_KEYS.indexOf(key)) * CHALLENGE_PROFILE.passes + pass - 1) % 10 === 9;
  const calls = [];
  const report = await runReview({ session: s, pr: prWithRedactedHunk(COUNT), judge: reviewer({ omit, calls }) });
  assert.equal(calls.filter((c) => c.reask).length, 8, 'premise: eight omitted slots, one re-ask each');
  assert.equal(report.windowResults.filter((w) => w.challenge.complete).length, COUNT);
  assert.equal(report.windowResults.filter((w) => w.groundingComplete).length, COUNT);
  assert.equal(report.windowResults.filter(complete).length, COUNT);
  assert.deepEqual(report.decisions.map((d) => d.relevance).sort(),
    [...Array(COUNT).fill('reverted'), ...Array(COUNT).fill('survives')]);
});
