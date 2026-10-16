// R4 acceptance tests. Every source, diff and model response is synthetic; no model or
// provider is invoked. These tests exercise the review boundary, not review quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotDiff, validateAnchor, runCodeReview as rawRunCodeReview } from '../src/code-review.js';
import { Session } from '../src/session.js';
import { redisPivotSession, redisPivotPr, REDIS_PIVOT_TEXT } from '../fixtures/redis-pivot.js';
import { DECISION_CANDIDATES, FINDING_CANDIDATES } from '../fixtures/redis-pivot-candidates.js';

// Most R4 cases isolate the frozen-diff grounder. Challenge votes use exact synthetic source
// receipts; dedicated integration cases below exercise refusal. Extraction call counts stay
// separate from the three independent challenge contexts introduced by R3.
function runCodeReview(options) {
  return rawRunCodeReview({ challengeJudge: async ({ challenge }) => {
    return { votes: challenge.items.map(({ key, candidate: c }) => {
    const receipts = c.receipts ?? [c.constrainedBy?.instruction ?? c.stated ?? c.instruction ?? c.valueReceipt].filter(Boolean);
    if (!receipts.length && c.actions?.length) {
      const event = options.session?.event(c.actions[0]);
      const source = options.session?.sourcesFor(event).find((s) => s.text.length >= 4);
      if (source) receipts.push({ eventId: event.id, role: source.role, quote: source.text.slice(0, 120) });
    }
    return { key, verdict: 'not-refuted', explanation: 'Synthetic support is present in the named source.', receipts };
    }) };
  }, ...options });
}

const DIFF = [
  'diff --git a/config/redis.yml b/config/redis.yml',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/config/redis.yml',
  '@@ -0,0 +1,5 @@',
  '+cache:',
  '+  backend: redis',
  '+  host: localhost',
  '+  port: 6379',
  '+  ttl_seconds: 300',
  '',
].join('\n');

const makePr = () => ({ ...redisPivotPr(), headOid: 'a'.repeat(40), enumeration: 'complete',
  files: [{ path: 'config/redis.yml', change: 'added', contentState: 'complete' }] });
const emptyResult = (paths = ['config/redis.yml']) => ({
  decisions: [], pivots: [], claims: [], requirements: [],
  codeFindings: [], sessionFindings: [], reviewedFiles: paths,
});
const codeFindings = (report) => report.findings.filter((finding) => finding.origin === 'code-review');

function codeCandidate(snapshot) {
  const source = snapshot.sources.find((entry) => entry.side === 'RIGHT'
    && entry.path === 'config/redis.yml' && entry.text.includes('host: localhost'));
  assert.ok(source, 'the frozen changed code must have a quotable source');
  return {
    origin: 'code-review', kind: 'code_issue',
    title: 'A separate Redis service cannot be reached through localhost',
    explanation: 'When Redis runs in another container, the configured host targets the application container. '
      + 'The integration run records a refused connection. Read the service host from deployment configuration.',
    receipts: [{ role: 'code', eventId: source.eventId,
      revisionOid: source.revisionOid, quote: 'host: localhost' }],
    scope: 'current-code',
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 },
  };
}

async function runCandidate(change, options = {}) {
  const pr = makePr();
  const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const changed = change(candidate) ?? candidate;
  return runCodeReview({ session: redisPivotSession(), pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [changed] }), ...options });
}

function assertWithheld(report) {
  assert.equal(codeFindings(report).length, 0, 'unsupported code must not become a published finding');
  assert.notEqual(report.codeCoverage, 'complete', 'rejection cannot become an empty complete review');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.ok(report.rejectedCodeFindings.length || report.codeJudgment.rejectedItems
    || report.codeJudgment.reasons.length, 'the rejection or unusable response must be counted');
}

// D58: a code finding the review CHECKED and could not establish — its quote did not match the
// frozen code, or its challengers could not settle it — is withheld: never published, counted, and
// it does not cap the code review, because the check ran. `assertWithheld` above is the not-run case.
function assertInconclusive(report) {
  assert.equal(codeFindings(report).length, 0, 'unsupported code must not become a published finding');
  assert.equal(report.codeCoverage, 'complete', 'an inconclusive check is not an unchecked review');
  assert.equal(report.codeStatus, 'CLEAN');
  assert.ok(report.withheld.proposals + report.withheld.unsettled > 0, 'the withheld item must be counted');
}

test('R4 LEFT receipt identities use the PR merge base, while the report retains target base', async () => {
  const pr = { ...makePr(), diffBaseOid: 'c'.repeat(40) };
  const snapshot = snapshotDiff({ pr, diff: DIFF });
  assert.equal(snapshot.baseOid, pr.diffBaseOid);
  assert.ok(snapshot.complete);
  const report = await runCodeReview({ pr, diff: DIFF, judge: async () => emptyResult() });
  assert.equal(report.instrument.baseOid, pr.baseOid);
  assert.equal(report.instrument.diffBaseOid, pr.diffBaseOid);
  assert.equal(snapshotDiff({ pr: { ...pr, diffBaseOid: 'main' }, diff: DIFF }).complete, false);
});

test('R4 valid-looking code candidate must survive the separate challenge majority', async () => {
  const pr = makePr(), candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  let calls = 0;
  const report = await rawRunCodeReview({ pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [candidate] }),
    challengeJudge: async ({ challenge }) => { calls++; return { votes: challenge.items.map(({ key }) => ({ key,
      verdict: 'refuted', explanation: 'Synthetic counterevidence.', receipts: candidate.receipts })) }; } });
  assert.equal(calls, 3);
  assert.equal(codeFindings(report).length, 0);
  assert.equal(report.codeCoverage, 'complete', 'three grounded refutations resolve the reviewed claim');
  assert.equal(report.codeStatus, 'CLEAN');
  assert.equal(report.codeChallenges[0].refutedItems, 1);
  assert.equal(report.codeChallenges[0].survivors.length, 0);
  assert.deepEqual(report.findingFunnel.direct.code, { proposed: 1, responseUnusable: 0,
    deterministicRejected: 0, challengeEligible: 1, challengeVoted: 1,
    challengeComplete: 1, challengeSurvived: 0, grounded: 0 });
});

test('joint challenge retains all supplied immutable source while omitting extraction instructions', async () => {
  const pr = makePr(), candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const requests = [];
  const report = await rawRunCodeReview({ session: redisPivotSession(), pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [candidate] }),
    challengeJudge: async (request) => {
      requests.push(request);
      return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
        explanation: 'Synthetic immutable support.', receipts: candidate.receipts })) };
    } });
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.ok(request.prompt.includes('## Human instructions recorded up to the end of this window'));
    assert.ok(request.prompt.includes(DIFF));
    assert.ok(request.prompt.includes(candidate.receipts[0].eventId));
    assert.ok(!request.prompt.includes('## Output: one JSON object, seven mandatory arrays'));
  }
});

test('joint extraction retains a registered budget stop as an explicit unchecked window', async () => {
  const report = await rawRunCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
    judge: async () => { throw Object.assign(new Error('private provider detail'), { code: 'budget_exhausted' }); } });
  assert.equal(report.windowResults[0].failure, 'budget_exhausted');
  assert.equal(report.challenge.budgetExhausted, true);
  assert.equal(report.coverage, 'missing');
  assert.equal(report.codeCoverage, 'missing');
  assert.ok(!JSON.stringify(report).includes('private provider detail'));
});

test('R4 challenge cannot support a claim with a quote assigned to the wrong code revision', async () => {
  const pr = makePr(), candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const report = await rawRunCodeReview({ pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [candidate] }),
    challengeJudge: async ({ challenge }) => ({ votes: challenge.items.map(({ key }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic support.',
      receipts: candidate.receipts.map((r) => ({ ...r, revisionOid: 'd'.repeat(40) })) })) }) });
  // D58: every pass voted, and no vote grounded — voted on, never settled, so withheld.
  assert.equal(report.codeChallenges[0].unsettledItems, 1);
  assertInconclusive(report);
});

test('R4 header without any hunk cannot borrow another file coverage', () => {
  const pr = makePr();
  pr.files.unshift({ path: 'missing.js', change: 'modified', contentState: 'complete' });
  const diff = 'diff --git a/missing.js b/missing.js\n--- a/missing.js\n+++ b/missing.js\n' + DIFF;
  assert.equal(snapshotDiff({ pr, diff }).complete, false);
});

test('R4 combined full input budget includes large diff before calling the transport', async () => {
  const pr = makePr(), diff = DIFF.replace('host: localhost', 'host: ' + 'x'.repeat(530000));
  let calls = 0;
  const report = await rawRunCodeReview({ pr, diff, judge: async () => { calls++; return emptyResult(); } });
  assert.equal(calls, 0); assert.equal(report.codeStatus, 'UNCHECKED');
});

test('R4 one reviewer sees the full session and diff and preserves code and session findings', async () => {
  const session = redisPivotSession();
  const pr = makePr();
  const snapshot = snapshotDiff({ pr, diff: DIFF });
  const candidate = codeCandidate(snapshot);
  const { actorSession, ...decision } = structuredClone(DECISION_CANDIDATES[0]);
  let calls = 0;
  let request;
  const report = await runCodeReview({ session, pr, diff: DIFF, judge: async (input) => {
    calls++;
    request = input;
    return {
      ...emptyResult(),
      decisions: [decision],
      claims: [{ text: 'the tests pass',
        stated: { eventId: 'E9', role: 'commentary', quote: 'verified it works — the tests pass' },
        contradictedBy: { eventId: 'E6', role: 'observation', quote: 'Tests: 1 failed, 11 passed, 12 total' } }],
      codeFindings: [candidate],
      sessionFindings: [{ ...structuredClone(FINDING_CANDIDATES[0]),
        receipts: [...structuredClone(FINDING_CANDIDATES[0].receipts), ...structuredClone(candidate.receipts)] }],
    };
  } });
  assert.equal(calls, 1, 'code and session review must share one call for one window');
  assert.ok(request.prompt.includes(DIFF), 'the full frozen diff is supplied');
  for (const text of [REDIS_PIVOT_TEXT.ask, REDIS_PIVOT_TEXT.pivot,
    REDIS_PIVOT_TEXT.testOut, REDIS_PIVOT_TEXT.unitOut, REDIS_PIVOT_TEXT.claim]) {
    assert.ok(request.prompt.includes(text), 'session evidence must not be replaced by its final reply');
  }
  assert.match(request.system, /synthesizer/i);
  assert.ok(/test[\s\S]*theatre/i.test(request.system), 'review craft includes tests that cannot fail');
  for (const key of ['decisions', 'pivots', 'claims', 'requirements',
    'codeFindings', 'sessionFindings', 'reviewedFiles']) assert.ok(request.schema.properties[key], key);
  assert.equal(report.decisions.length, 1);
  assert.equal(report.decisions[0].column, 'asked-chose');
  assert.deepEqual(report.findings.map((finding) => finding.kind).sort(),
    ['claim_contradicted', 'code_issue', 'edit_under_negative_requirement']);
  const finding = codeFindings(report)[0];
  assert.equal(finding.status, 'DECIDE', 'the grounder derives the public status');
  assert.match(finding.id, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(finding.anchor, candidate.anchor);
  assert.equal(finding.receipts[0].revisionOid, pr.headOid);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'DECIDE');
  assert.equal(report.sessionStatus, 'DECIDE');
  assert.equal(report.reviewStatus, 'DECIDE');
  assert.equal(report.codeFindingCandidates.length, 1);
  assert.equal(report.rejectedCodeFindings.length, 0);
  assert.equal(report.codeJudgment.attemptedCalls, 1);
  assert.equal(report.codeJudgment.usableResults, 1);
  assert.deepEqual(report.findingFunnel.direct.code, { proposed: 1, responseUnusable: 0, deterministicRejected: 0,
    challengeEligible: 1, challengeVoted: 1, challengeComplete: 1, challengeSurvived: 1, grounded: 1 });
  assert.deepEqual(report.findingFunnel.direct.session, { proposed: 1, responseUnusable: 0, deterministicRejected: 0,
    challengeEligible: 1, challengeVoted: 1, challengeComplete: 1, challengeSurvived: 1, grounded: 1 });
  assert.deepEqual(report.findingFunnel.narrativeContradictedClaims, { proposed: 1,
    challengeEligible: 1, challengeVoted: 1, challengeComplete: 1, challengeSurvived: 1, grounded: 1 });
  assert.deepEqual(report.findingFunnel.final, { published: 3, code: 1, session: 2, merged: 0 });
});

test('R4 a diff-only PR still receives code review while session coverage stays missing', async () => {
  const pr = makePr();
  const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  let calls = 0;
  const report = await runCodeReview({ pr, diff: DIFF, judge: async () => {
    calls++;
    return { ...emptyResult(), codeFindings: [candidate] };
  } });
  assert.equal(calls, 1);
  assert.equal(codeFindings(report).length, 1);
  assert.equal(report.codeStatus, 'DECIDE');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.hasSessionEvidence, false);
  assert.equal(report.coverage, 'missing');
});

test('R4 a complete usable empty review permits code CLEAN without certifying a missing session', async () => {
  const report = await runCodeReview({ pr: makePr(), diff: DIFF, judge: async () => emptyResult() });
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'CLEAN');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'UNCHECKED');
  assert.deepEqual(report.findingFunnel, {
    direct: {
      code: { proposed: 0, responseUnusable: 0, deterministicRejected: 0,
        challengeEligible: 0, challengeVoted: 0, challengeComplete: 0, challengeSurvived: 0, grounded: 0 },
      session: { proposed: 0, responseUnusable: 0, deterministicRejected: 0,
        challengeEligible: 0, challengeVoted: 0, challengeComplete: 0, challengeSurvived: 0, grounded: 0 },
    },
    narrativeContradictedClaims: { proposed: 0, challengeEligible: 0, challengeVoted: 0,
      challengeComplete: 0, challengeSurvived: 0, grounded: 0 },
    final: { published: 0, code: 0, session: 0, merged: 0 },
  });
});

test('finding funnel separates a model proposal withheld by literal receipt verification from no proposal', async () => {
  const pr = makePr();
  const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  candidate.receipts[0].quote = 'invented source text absent from the frozen patch';
  let calls = 0;
  const report = await runCodeReview({ pr, diff: DIFF, judge: async () => {
    calls++;
    return calls === 1 ? { ...emptyResult(), codeFindings: [candidate] } : emptyResult([]);
  } });
  assert.equal(calls, 2, 'the receipt repair response is not a second finding proposal');
  assert.deepEqual(report.findingFunnel.direct.code, { proposed: 1, responseUnusable: 0, deterministicRejected: 1,
    challengeEligible: 0, challengeVoted: 0, challengeComplete: 0, challengeSurvived: 0, grounded: 0 });
  assert.equal(report.findingFunnel.final.published, 0);
  assert.equal(report.rejectedCodeFindings[0].reason, 'receipt_rejected');
});

test('finding funnel counts proposals in an unusable response without claiming they were verified', async () => {
  const pr = makePr();
  const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const report = await runCodeReview({ pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [candidate], priority: 0 }) });
  assert.deepEqual(report.findingFunnel.direct.code, { proposed: 1, responseUnusable: 1,
    deterministicRejected: 0, challengeEligible: 0, challengeVoted: 0,
    challengeComplete: 0, challengeSurvived: 0, grounded: 0 });
  assert.equal(report.findingFunnel.final.published, 0);
  assert.equal(report.codeStatus, 'UNCHECKED');
});

test('R4 no judge means no code verdict', async () => {
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF });
  assert.equal(report.codeCoverage, 'missing');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.equal(report.codeJudgment.attemptedCalls, 0);
});

test('R4 missing diff cannot turn an empty answer into complete code review', async () => {
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(),
    judge: async () => emptyResult() });
  assert.equal(report.codeCoverage, 'missing');
  assert.equal(report.codeStatus, 'UNCHECKED');
});

test('R4 a failed call records missing coverage and does not expose provider exception text', async () => {
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
    judge: async () => { throw new Error('SYNTHETIC_PROVIDER_SECRET_DO_NOT_LOG'); } });
  assert.equal(report.codeCoverage, 'missing');
  assert.equal(report.codeStatus, 'UNCHECKED');
  // W3-1: the window call and, because it placed nothing, one chunk call for the same file.
  // A file left unplaced by a failed window is unreviewed, and the chunk pass is what covers it.
  assert.equal(report.codeJudgment.attemptedCalls, 2);
  assert.equal(report.codeJudgment.usableResults, 0);
  assert.ok(!JSON.stringify(report.codeJudgment).includes('SYNTHETIC_PROVIDER_SECRET_DO_NOT_LOG'));
});

for (const [name, response] of [
  ['null', null], ['prose', 'Everything looks fine'], ['array', []], ['empty object', {}],
  ['non-array findings', { ...emptyResult(), codeFindings: {} }],
  ['missing narrative channel', (() => { const result = emptyResult(); delete result.claims; return result; })()],
  ['top-level approval', { ...emptyResult(), approved: true }],
]) {
  test(`R4 malformed response (${name}) has no complete code verdict`, async () => {
    const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
      judge: async () => response });
    assert.notEqual(report.codeCoverage, 'complete');
    assert.equal(report.codeStatus, 'UNCHECKED');
    assert.equal(codeFindings(report).length, 0);
  });
}

for (const [name, change] of [
  ['omitted acknowledgement', (result) => { delete result.reviewedFiles; }],
  ['no files acknowledged', (result) => { result.reviewedFiles = []; }],
  ['wrong file acknowledged', (result) => { result.reviewedFiles = ['src/unrelated.js']; }],
]) {
  test(`R4 ${name} cannot certify the supplied diff`, async () => {
    const result = emptyResult();
    change(result);
    const report = await runCodeReview({ pr: makePr(), diff: DIFF, judge: async () => result });
    assert.notEqual(report.codeCoverage, 'complete');
    assert.equal(report.codeStatus, 'UNCHECKED');
  });
}

for (const [name, modify] of [
  ['file enumeration is partial', (pr) => { pr.enumeration = 'partial'; }],
  ['file enumeration is absent', (pr) => { delete pr.enumeration; }],
  ['file enumeration is unknown', (pr) => { pr.enumeration = 'unknown'; }],
  ['file content is partial', (pr) => { pr.files[0].contentState = 'partial'; }],
  ['file content is unavailable', (pr) => { pr.files[0].contentState = 'unavailable'; }],
  ['file content state is absent', (pr) => { delete pr.files[0].contentState; }],
  ['file content state is unknown', (pr) => { pr.files[0].contentState = 'unknown'; }],
  ['an enumerated file has no patch', (pr) => { pr.files.push({ path: 'src/other.js', change: 'modified', contentState: 'complete' }); }],
]) {
  test(`R4 partial PR scope: ${name}`, async () => {
    const pr = makePr(); modify(pr);
    const report = await runCodeReview({ pr, diff: DIFF,
      judge: async () => emptyResult(pr.files.map((file) => file.path)) });
    assert.notEqual(report.codeCoverage, 'complete');
    assert.equal(report.codeStatus, 'UNCHECKED');
  });
}

for (const [name, mutate] of [
  ['missing source', (item) => { item.receipts[0].eventId = 'NO_SUCH_SOURCE'; }],
  ['wrong revision', (item) => { item.receipts[0].revisionOid = 'c'.repeat(40); }],
  ['historical session code only', (item) => { item.receipts = [{ role: 'code', eventId: 'E3',
    revisionOid: item.receipts[0].revisionOid, quote: 'host: localhost' }]; }],
  ['changed quote whitespace', (item) => { item.receipts[0].quote = 'host:  localhost'; }],
  ['invented quote', (item) => { item.receipts[0].quote = 'host: redis.internal.invalid'; }],
  ['non-code receipt role', (item) => { item.receipts[0].role = 'commentary'; }],
  ['out-of-range anchor', (item) => { item.anchor.startLine = 9999; item.anchor.endLine = 10000; }],
  ['wrong-side anchor', (item) => { item.anchor.side = 'LEFT'; }],
  ['unrelated anchor path', (item) => { item.anchor.path = 'src/elsewhere.js'; }],
  ['valid line that does not contain the receipt', (item) => { item.anchor.startLine = 5; item.anchor.endLine = 5; }],
  ['reversed range', (item) => { item.anchor.startLine = 4; item.anchor.endLine = 2; }],
  ['non-numeric line', (item) => { item.anchor.startLine = '3'; }],
  ['unknown finding kind', (item) => { item.kind = 'made_up_issue'; }],
  ['wrong origin', (item) => { item.origin = 'session-review'; }],
  ['missing title', (item) => { delete item.title; }],
  ['malformed receipts', (item) => { item.receipts = { role: 'code' }; }],
  ['model severity', (item) => { item.severity = 'high'; }],
  ['model confidence', (item) => { item.confidence = 0.99; }],
  ['model priority', (item) => { item.priority = 0; }],
  ['model approval', (item) => { item.approved = true; }],
  ['nested model ranking', (item) => { item.receipts[0].confidence = 1; }],
  ['model status', (item) => { item.status = 'DECIDE'; }],
  ['model identity', (item) => { item.id = 'sha256:' + 'f'.repeat(64); }],
]) {
  test(`R4 withholds a candidate with ${name}`, async () => {
    const report = await runCandidate((item) => { mutate(item); return item; });
    if (['wrong revision', 'changed quote whitespace', 'invented quote'].includes(name))
      assertInconclusive(report);
    else assertWithheld(report);
  });
}

// W3f-2 / F225: no request shows a revision, so a code receipt omits it; code reads it from the
// source the id names. A supplied revision that is not the source's is still withheld (above).
test('R4 a code receipt that omits its revision is read at its source\'s revision', async () => {
  const report = await runCandidate((item) => { delete item.receipts[0].revisionOid; return item; });
  assert.equal(codeFindings(report).length, 1);
  assert.equal(codeFindings(report)[0].receipts[0].revisionOid, makePr().headOid);
  assert.deepEqual(codeFindings(report)[0].anchor, { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 });
});

test('R4 a null anchor preserves a grounded non-inline code concern', async () => {
  const report = await runCandidate((item) => { item.anchor = null; return item; });
  assert.equal(codeFindings(report).length, 1);
  assert.equal(codeFindings(report)[0].anchor, null);
  assert.equal(report.codeStatus, 'DECIDE');
});

test('R4 valid findings survive a separate checked, rejected receipt with complete code coverage', async () => {
  const pr = makePr(); const valid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const invalid = structuredClone(valid); invalid.receipts[0].quote = 'invented current code';
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [valid, invalid] }) });
  assert.equal(codeFindings(report).length, 1);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'DECIDE');
  assert.ok(report.rejectedCodeFindings.length >= 1);
});

/** M35 (windowing): a compaction splits no window; a long statement (100,000 bytes) after the ask and after the split
 *  makes the one segment over a combined review's window budget, cut before the second: two windows. */
function twoWindowSession() {
  const original = redisPivotSession();
  const fill = `SYNTHETIC_FILL: still working.\n${'f'.repeat(100_000)}`;
  const statement = (id) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null,
    text: [{ sourceKey: 'fill', fromByte: 0, untilByte: fill.length }] });
  const events = [original.events[0], statement('F1'), ...original.events.slice(1, 4),
    { id: 'SPLIT', kind: 'boundary', boundary: 'compaction' }, statement('F2'),
    ...original.events.slice(4)].map((event, sequence) => ({ ...event, sequence }));
  return new Session({ sessionKey: original.sessionKey, events, blobs: { ...original.blobs, fill } });
}

test('R4 repeated code findings across session windows have one grounded identity', async () => {
  const session = twoWindowSession();
  const pr = makePr(); const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  let calls = 0;
  const report = await runCodeReview({ session, pr, diff: DIFF, judge: async () => {
    calls++; return { ...emptyResult(), codeFindings: [structuredClone(candidate)] };
  } });
  assert.equal(calls, 2, 'one unified call for each existing compaction window');
  assert.equal(codeFindings(report).length, 1, 'the same code issue is not republished per window');
  assert.equal(report.codeJudgment.attemptedCalls, 2);
  assert.equal(report.findingFunnel.direct.code.proposed, 1, 'repeated window proposals are one claim');
  assert.equal(report.findingFunnel.direct.code.grounded, 1);
});

test('R4 a failed second session window retains a complete prior code review', async () => {
  const pr = makePr(); const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  let calls = 0;
  const report = await runCodeReview({ session: twoWindowSession(), pr, diff: DIFF, judge: async () => {
    if (++calls === 2) throw new Error('synthetic unavailable window');
    return { ...emptyResult(), codeFindings: [candidate] };
  } });
  assert.equal(calls, 2);
  assert.equal(codeFindings(report).length, 1);
  assert.equal(report.codeCoverage, 'complete');
  assert.notEqual(report.coverage, 'complete', 'the failed session window remains declared');
  assert.equal(report.codeStatus, 'DECIDE');
  assert.equal(report.codeJudgment.usableResults, 1);
});

test('R4 a valid anchor in another changed file cannot borrow this file\'s code receipt', async () => {
  const pr = makePr(); pr.files.push({ path: 'config/backup.yml', change: 'added', contentState: 'complete' });
  const diff = DIFF + DIFF.replaceAll('config/redis.yml', 'config/backup.yml');
  const candidate = codeCandidate(snapshotDiff({ pr, diff }));
  candidate.anchor.path = 'config/backup.yml';
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff,
    judge: async () => ({ ...emptyResult(['config/redis.yml', 'config/backup.yml']), codeFindings: [candidate] }) });
  assertWithheld(report);
});

test('R4 an anchored negative requirement cannot borrow a frozen receipt from another file', async () => {
  const pr = makePr(); pr.files.push({ path: 'config/backup.yml', change: 'added', contentState: 'complete' });
  const diff = DIFF + DIFF.replaceAll('config/redis.yml', 'config/backup.yml');
  const code = codeCandidate(snapshotDiff({ pr, diff }));
  const finding = structuredClone(FINDING_CANDIDATES[0]);
  finding.receipts.push(...code.receipts);
  finding.anchor.path = 'config/backup.yml';
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff,
    judge: async () => ({ ...emptyResult(['config/redis.yml', 'config/backup.yml']), sessionFindings: [finding] }) });
  assert.equal(report.findings.length, 0);
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.ok(report.rejectedFindings.length >= 1);
});

test('R4 current-code session findings require current-code evidence even without an anchor', async () => {
  const finding = structuredClone(FINDING_CANDIDATES[0]); finding.anchor = null;
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
    judge: async () => ({ ...emptyResult(), sessionFindings: [finding] }) });
  assert.equal(report.findings.length, 0);
  assert.ok(report.rejectedFindings.length >= 1);
  // D58: the evidence check ran and the accusation could not be established: withheld and
  // counted, never published — and not an unchecked session.
  assert.ok(report.rejectedFindings.every((r) => r.reason === 'receipt_rejected'));
  assert.equal(report.withheld.proposals, 1);
  assert.equal(report.sessionStatus, 'CLEAN');
});

for (const outcome of ['failed', 'unknown']) {
  test(`R4 a ${outcome} historical write does not establish an adopted prohibited action`, async () => {
    const original = redisPivotSession();
    const session = new Session({ sessionKey: original.sessionKey, blobs: original.blobs,
      events: original.events.map((event) => event.id === 'E4' ? { ...event, result: outcome } : event) });
    const pr = makePr(); const code = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
    const finding = structuredClone(FINDING_CANDIDATES[0]); finding.receipts.push(...code.receipts);
    const report = await runCodeReview({ session, pr, diff: DIFF,
      judge: async () => ({ ...emptyResult(), sessionFindings: [finding] }) });
    assert.equal(report.findings.length, 0);
    assert.ok(report.rejectedFindings.length >= 1);
    const gaps = report.gaps.filter((gap) => gap.code === 'write_outcome_unknown');
    if (outcome === 'failed') {
      // D58: withheld and counted, never published; the check ran on the recorded outcome.
      assert.equal(report.withheld.proposals, 1);
      assert.deepEqual(gaps, []);
      assert.equal(report.sessionStatus, 'CLEAN');
    } else {
      // W3d-4 (orchestrator decision under D58): whether the write happened is not in the record.
      // That is absent evidence, not an inconclusive check: withheld AND declared, and it caps.
      const actions = finding.receipts.filter((r) => r.role === 'action').map((r) => r.eventId);
      assert.equal(report.withheld.proposals, 0);
      assert.deepEqual(gaps.map((gap) => gap.eventIds), [actions]);
      assert.equal(report.sessionStatus, 'UNCHECKED');
    }
    assert.ok(!JSON.stringify(report.findings).includes(finding.title), 'the withheld accusation is never published');
  });
}

test('R4 freezes PR metadata before an asynchronous judge can observe a moving head', async () => {
  const pr = makePr(); const originalHead = pr.headOid;
  const candidate = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async () => {
    await Promise.resolve();
    pr.headOid = 'c'.repeat(40);
    pr.files[0].path = 'src/changed-during-review.js';
    return { ...emptyResult(), codeFindings: [candidate] };
  } });
  assert.equal(report.pr.headOid, originalHead);
  assert.equal(report.pr.files[0].path, 'config/redis.yml');
  assert.equal(codeFindings(report).length, 1);
  assert.equal(codeFindings(report)[0].receipts[0].revisionOid, originalHead);
});

test('R4 an added-file snapshot preserves source bytes and rejects a non-existent old side', () => {
  const snapshot = snapshotDiff({ pr: makePr(), diff: DIFF });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.diff, DIFF);
  const source = snapshot.sources.find((entry) => entry.side === 'RIGHT');
  assert.ok(source.text.includes('  host: localhost\n'), 'indentation and newlines remain exact');
  assert.equal(source.startLine, 1);
  assert.equal(source.endLine, 5);
  assert.equal(validateAnchor(snapshot, null), true);
  assert.equal(validateAnchor(snapshot, { path: 'config/redis.yml', side: 'RIGHT', startLine: 1, endLine: 5 }), true);
  assert.equal(validateAnchor(snapshot, { path: 'config/redis.yml', side: 'LEFT', startLine: 1, endLine: 1 }), false);
});

const RENAME_DIFF = [
  'diff --git a/src/old.js b/src/new.js',
  'similarity index 80%', 'rename from src/old.js', 'rename to src/new.js',
  '--- a/src/old.js', '+++ b/src/new.js',
  '@@ -10,3 +20,4 @@', ' keep()', '-old()', '+replacement()', '+added()', ' tail()',
  '@@ -40,2 +51,1 @@', '-deleted()', ' stable()', '',
].join('\n');

test('R4 renamed files retain exact context and deletion coordinates on each side', () => {
  const pr = { ...makePr(), files: [{ path: 'src/new.js', oldPath: 'src/old.js', change: 'renamed', contentState: 'complete' }] };
  const snapshot = snapshotDiff({ pr, diff: RENAME_DIFF });
  assert.equal(snapshot.complete, true);
  const left = snapshot.sources.find((source) => source.side === 'LEFT' && source.startLine === 10);
  const right = snapshot.sources.find((source) => source.side === 'RIGHT' && source.startLine === 20);
  assert.ok(left); assert.ok(right);
  assert.equal(left.path, 'src/new.js', 'LEFT uses the canonical PR path even on a rename');
  assert.equal(right.path, 'src/new.js');
  assert.ok(left.text.includes('old()'));
  assert.ok(!right.text.includes('old()'));
  assert.ok(right.text.includes('replacement()'));
  for (const [source, startLine, endLine] of [[left, 10, 12], [right, 20, 23]]) {
    assert.equal(validateAnchor(snapshot, { path: source.path, side: source.side, startLine, endLine }), true);
  }
  assert.equal(validateAnchor(snapshot, { path: right.path, side: 'RIGHT', startLine: 24, endLine: 24 }), false);
  assert.equal(validateAnchor(snapshot, { path: right.path, side: 'RIGHT', startLine: 23, endLine: 51 }), false,
    'a range cannot silently span omitted lines between hunks');
});

test('R4 deleted files have old-side source without invented new-side lines', () => {
  const diff = ['diff --git a/src/gone.js b/src/gone.js', 'deleted file mode 100644',
    '--- a/src/gone.js', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-old()', '-removed()', ''].join('\n');
  const pr = { ...makePr(), files: [{ path: 'src/gone.js', change: 'deleted', contentState: 'complete' }] };
  const snapshot = snapshotDiff({ pr, diff });
  assert.equal(snapshot.complete, true);
  assert.equal(validateAnchor(snapshot, { path: 'src/gone.js', side: 'LEFT', startLine: 1, endLine: 2 }), true);
  assert.equal(validateAnchor(snapshot, { path: 'src/gone.js', side: 'RIGHT', startLine: 1, endLine: 1 }), false);
});

for (const [name, diff] of [
  ['truncated added hunk', DIFF.replace('+  ttl_seconds: 300\n', '')],
  ['inconsistent added count', DIFF.replace('+1,5', '+1,4')],
  ['malformed hunk header', DIFF.replace('@@ -0,0 +1,5 @@', '@@ broken @@')],
  ['source text without hunk coordinates', DIFF.replace('@@ -0,0 +1,5 @@\n', '')],
  ['orphan trailing diff header', DIFF + 'diff --git a/src/orphan.js b/src/orphan.js\n'],
  ['unrecognized trailing truncation marker', DIFF + '.. truncated ..\n'],
]) {
  test(`R4 ${name} cannot be certified as a complete frozen diff`, async () => {
    let snapshot;
    try { snapshot = snapshotDiff({ pr: makePr(), diff }); } catch { /* Rejecting the snapshot also fails closed. */ }
    if (snapshot) assert.equal(snapshot.complete, false);
    const report = await runCodeReview({ pr: makePr(), diff, judge: async () => emptyResult() });
    assert.notEqual(report.codeCoverage, 'complete');
    assert.equal(report.codeStatus, 'UNCHECKED');
  });
}

test('R4 an unreviewable binary patch leaves partial code coverage beside reviewed text', async () => {
  const pr = makePr(); pr.files.push({ path: 'assets/cache.bin', change: 'binary', contentState: 'complete' });
  const diff = DIFF + ['diff --git a/assets/cache.bin b/assets/cache.bin',
    'Binary files a/assets/cache.bin and b/assets/cache.bin differ', ''].join('\n');
  const report = await runCodeReview({ pr, diff,
    judge: async () => emptyResult(['config/redis.yml', 'assets/cache.bin']) });
  assert.notEqual(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'UNCHECKED');
});

for (const [name, baseOid, headOid] of [
  ['moving base branch', 'main', 'a'.repeat(40)],
  ['moving head reference', 'b'.repeat(40), 'HEAD'],
  ['non-hex head', 'b'.repeat(40), 'h'.repeat(40)],
  ['short head', 'b'.repeat(40), 'a'.repeat(39)],
  ['mixed algorithms', 'b'.repeat(40), 'a'.repeat(64)],
]) {
  test(`R4 ${name} cannot identify a frozen PR revision`, async () => {
    const pr = { ...makePr(), baseOid, headOid };
    let snapshot;
    try { snapshot = snapshotDiff({ pr, diff: DIFF }); } catch { /* A rejection is also fail-closed. */ }
    if (snapshot) assert.equal(snapshot.complete, false);
    const report = await runCodeReview({ pr, diff: DIFF, judge: async () => emptyResult() });
    assert.notEqual(report.codeCoverage, 'complete');
    assert.equal(report.codeStatus, 'UNCHECKED');
  });
}

test('R4 full hexadecimal SHA-256 revisions are supported together', () => {
  const pr = { ...makePr(), baseOid: 'b'.repeat(64), headOid: 'a'.repeat(64) };
  const snapshot = snapshotDiff({ pr, diff: DIFF });
  assert.equal(snapshot.complete, true);
  assert.ok(snapshot.sources.every((source) => source.revisionOid.length === 64));
});

test('R4 diff headers and manifest change kinds must agree with the actual patch', () => {
  const mismatchedHeader = DIFF.replace('diff --git a/config/redis.yml b/config/redis.yml',
    'diff --git a/config/other.yml b/config/other.yml');
  const modified = ['diff --git a/config/redis.yml b/config/redis.yml',
    '--- a/config/redis.yml', '+++ b/config/redis.yml', '@@ -1 +1 @@', '-old()', '+new()', ''].join('\n');
  const deletionPr = makePr(); deletionPr.files[0].change = 'deleted';
  for (const [pr, diff] of [[makePr(), mismatchedHeader], [deletionPr, modified]]) {
    let snapshot;
    try { snapshot = snapshotDiff({ pr, diff }); } catch { /* Rejecting malformed provenance is also fail-closed. */ }
    if (snapshot) assert.equal(snapshot.complete, false);
  }
});

// F101: the F93/F94 merge ran inside buildLedger only, and runCodeReview published its own
// concatenation of code and session findings — which is how four framings of one defect reached
// a review. Two framings on different, non-overlapping lines of one file, sharing one
// distinctive code receipt, are one defect.
test('F101 two code findings sharing a distinctive code receipt are published as one, with alsoReportedAs', async () => {
  const pr = makePr();
  const snapshot = snapshotDiff({ pr, diff: DIFF });
  const SHARED = 'backend: redis\n  host: localhost';   // lines 2-3, 27 non-whitespace characters
  const source = snapshot.sources.find((entry) => entry.side === 'RIGHT'
    && entry.path === 'config/redis.yml' && entry.text.includes(SHARED));
  assert.ok(source, 'the shared quote is an exact substring of the frozen changed code');
  const receipt = (quote) => ({ role: 'code', eventId: source.eventId, revisionOid: source.revisionOid, quote });
  const first = { ...codeCandidate(snapshot), receipts: [receipt(SHARED)],
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 } };
  const second = { ...codeCandidate(snapshot), title: 'The cache is pinned to the application container',
    receipts: [receipt(SHARED), receipt('backend: redis')],
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 2, endLine: 2 } };
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [first, second] }) });

  assert.equal(report.codeFindingCandidates.length, 2, 'both framings grounded, so only a merge can make them one');
  const published = codeFindings(report);
  assert.equal(published.length, 1, 'one defect, one published finding');
  assert.equal(published[0].title, second.title, 'the framing with more receipts is the one kept');
  assert.deepEqual(published[0].alsoReportedAs, [first.title], 'the other framing is named, not deleted');
  assert.equal(report.counts.findingsMerged, 1, 'the merge is counted, so a disappearance is never silent');
  assert.deepEqual(report.findingFunnel.final, { published: 1, code: 1, session: 0, merged: 1 });
  // Statuses are reduced from the published list (F63): the survivor is what the verdict reads.
  assert.equal(report.codeStatus, published[0].status);
});

test('F101 two code findings with nothing shared stay two in the published list', async () => {
  const pr = makePr();
  const snapshot = snapshotDiff({ pr, diff: DIFF });
  const source = snapshot.sources.find((entry) => entry.side === 'RIGHT' && entry.path === 'config/redis.yml');
  const receipt = (quote) => ({ role: 'code', eventId: source.eventId, revisionOid: source.revisionOid, quote });
  const first = { ...codeCandidate(snapshot), receipts: [receipt('host: localhost')],
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 } };
  const second = { ...codeCandidate(snapshot), title: 'The cache entries never expire under load',
    receipts: [receipt('ttl_seconds: 300')], anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 5, endLine: 5 } };
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF,
    judge: async () => ({ ...emptyResult(), codeFindings: [first, second] }) });
  assert.equal(codeFindings(report).length, 2);
  assert.equal(report.counts.findingsMerged, 0);
});

test('R4 an empty review retains adapter source-loss gaps as partial session coverage', async () => {
  const session = redisPivotSession();
  session.adapterGaps = [{ code: 'source_clipped', channel: 'code', scope: 'session', count: 1 }];
  const report = await runCodeReview({ session, pr: makePr(), diff: DIFF, judge: async () => emptyResult() });
  assert.ok(report.gaps.some((gap) => gap.code === 'source_clipped'));
  assert.equal(report.coverage, 'partial');
  // M33 (C-06): the session review completed, and a recorder's clip is a declared recorder limit, so
  // the session reads NO_FINDINGS — partial coverage, named, never CLEAN. It read UNCHECKED before M33.
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(report.codeCoverage, 'complete', 'session clipping does not erase complete frozen code coverage');
});

test('R4 rejected pivot and requirement receipts are withheld and counted, never published (D58)', async () => {
  const response = { ...emptyResult(),
    pivots: [{ abandoned: 'old approach', adopted: 'new approach', whyAbandoned: 'it failed',
      receipts: [{ eventId: 'E6', role: 'observation', quote: 'invented failure output' }] }],
    requirements: [{ text: 'a fabricated requirement', status: 'open',
      instruction: { eventId: 'E1', role: 'instruction', quote: 'invented human requirement' } }],
  };
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
    judge: async () => response });
  assert.equal(report.pivotsRejected, 1);
  assert.equal(report.requirementsRejected, 1);
  assert.deepEqual(report.pivots, []);
  assert.deepEqual(report.requirements, []);
  // D58: every challenge pass voted, citing the same fabricated quotes, so no vote grounded: the
  // challengers could not settle either item. Withheld and counted — not an unchecked session.
  assert.deepEqual(report.withheld, { proposals: 0, unsettled: 2 });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.ok(!JSON.stringify([report.pivots, report.requirements]).includes('a fabricated requirement'));
});

const repairResult = (...candidates) => ({ ...emptyResult([]), codeFindings: candidates });

test('R4 permits one receipt repair with the same complete joint evidence', async () => {
  const pr = makePr(); const valid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const invalid = structuredClone(valid); invalid.receipts[0].quote = 'invented source text';
  const requests = [];
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async (request) => {
    requests.push(request);
    return requests.length === 1 ? { ...emptyResult(), codeFindings: [invalid] } : repairResult(valid);
  } });
  assert.equal(requests.length, 2, 'one repair is allowed after a failed receipt check');
  assert.equal(codeFindings(report).length, 1);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'DECIDE');
  for (const text of [DIFF, REDIS_PIVOT_TEXT.ask, REDIS_PIVOT_TEXT.pivot,
    REDIS_PIVOT_TEXT.testOut, REDIS_PIVOT_TEXT.claim]) {
    assert.ok(requests[1].prompt.includes(text), 'repair retains full joint evidence rather than a summary');
  }
});

test('R4 a second bad quote exhausts the one repair allowance and the finding is withheld (D58)', async () => {
  const pr = makePr(); const invalid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  invalid.receipts[0].quote = 'still invented source text';
  let calls = 0;
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async () => {
    calls++;
    return calls === 1 ? { ...emptyResult(), codeFindings: [invalid] } : repairResult(invalid);
  } });
  assert.equal(calls, 2, 'one repair, never a third attempt');
  assert.deepEqual(report.rejectedCodeFindings.map((r) => r.reason), ['receipt_rejected']);
  assertInconclusive(report);
});

test('R4 failed receipt repair preserves already valid code and session findings', async () => {
  const pr = makePr(); const valid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  const invalid = structuredClone(valid);
  invalid.title = 'Another proposed configuration issue';
  invalid.receipts[0].quote = 'invented source text';
  const sessionFinding = structuredClone(FINDING_CANDIDATES[0]);
  sessionFinding.receipts.push(...structuredClone(valid.receipts));
  let calls = 0;
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async () => {
    if (++calls === 2) throw new Error('synthetic repair provider failure');
    return { ...emptyResult(), codeFindings: [valid, invalid], sessionFindings: [sessionFinding] };
  } });
  assert.equal(calls, 2);
  assert.equal(codeFindings(report).length, 1);
  assert.ok(report.findings.some((finding) => finding.kind === 'edit_under_negative_requirement'));
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'DECIDE');
});

test('R4 quote repair cannot replace a claim, change its anchor, or introduce model ratings', async () => {
  for (const [name, change] of [
    ['claim', (item) => { item.explanation = 'A different claim that was never proposed.'; }],
    ['anchor', (item) => { item.anchor = null; }],
    ['rating', (item) => { item.priority = 0; }],
  ]) {
    const pr = makePr(); const valid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
    const invalid = structuredClone(valid); invalid.receipts[0].quote = 'invented source text';
    const repaired = structuredClone(valid); change(repaired);
    let calls = 0;
    const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async () => {
      return ++calls === 1 ? { ...emptyResult(), codeFindings: [invalid] } : repairResult(repaired);
    } });
    assert.equal(calls, 2, name);
    assertInconclusive(report);
    assert.equal(report.codeCoverage, 'complete', name);
  }
});

test('R4 structural rejection does not spend a quote-repair call', async () => {
  const pr = makePr(); const invalid = codeCandidate(snapshotDiff({ pr, diff: DIFF }));
  invalid.priority = 0;
  let calls = 0;
  const report = await runCodeReview({ session: redisPivotSession(), pr, diff: DIFF, judge: async () => {
    calls++;
    return { ...emptyResult(), codeFindings: [invalid] };
  } });
  assert.equal(calls, 1);
  assertWithheld(report);
});

// ---- B8/B9: code coverage comes from what the CODE placed, never from reviewedFiles --------
//
// The only thing that used to separate 'partial' from 'complete' on a well-formed empty response
// was whether `reviewedFiles` set-equalled the manifest. That is a model-emitted completeness
// flag deciding CLEAN vs UNCHECKED — the exact thing CLAUDE.md forbids and the prompt itself
// tells the model it may not do.

const TWO_FILE_PR = () => ({ ...makePr(), files: [
  { path: 'config/redis.yml', change: 'added', contentState: 'complete' },
  { path: 'src/unshown.js', change: 'added', contentState: 'complete' }] });

test('B8/B9 (a) a file whose hunks were never placed cannot be certified by the model naming it', async () => {
  // The manifest holds two files; the supplied patch carries one. Whatever the model says it
  // read, the code placed exactly one file's hunks in front of it.
  const report = await runCodeReview({ pr: TWO_FILE_PR(), diff: DIFF,
    judge: async () => emptyResult(['config/redis.yml', 'src/unshown.js']) });
  assert.deepEqual(report.codeCoverageFacts.placed, ['config/redis.yml'],
    "the placement record is the code's own; it names only what was written into the request");
  assert.equal(report.codeCoverageFacts.snapshotFiles, 2);
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.ok(report.codeJudgment.reasons.includes('unreviewed_scope'),
    'claiming to have read a file it was never shown is itself a downgrade');
});

test('M29 only a same-request reviewedFiles acknowledgement places a file', async () => {
  const seen = [];
  for (const claimed of [['config/redis.yml', 'src/unshown.js'], ['config/redis.yml'], []]) {
    const report = await runCodeReview({ pr: TWO_FILE_PR(), diff: DIFF, judge: async () => emptyResult(claimed) });
    seen.push([report.codeCoverage, report.codeCoverageFacts.placed]);
  }
  assert.deepEqual(seen, [['partial', ['config/redis.yml']], ['partial', ['config/redis.yml']],
    ['partial', []]],
    'a foreign claim never adds a file, and an omitted claim cannot certify one');
});

test('M29 an empty reviewedFiles leaves the prompted file unplaced and partial', async () => {
  const report = await runCodeReview({ pr: makePr(), diff: DIFF, judge: async () => emptyResult([]) });
  assert.deepEqual(report.codeCoverageFacts.placed, []);
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
});

test('M29 a code-only omission is retried once from the same frozen diff', async () => {
  let chunks = 0;
  const report = await runCodeReview({ pr: makePr(), diff: DIFF, judge: async (request) => {
    if (/^code\+chunk:/.test(request.label)) chunks++;
    return emptyResult(chunks === 1 ? [] : ['config/redis.yml']);
  } });
  assert.equal(chunks, 2);
  assert.deepEqual(report.codeCoverageFacts.placed, ['config/redis.yml']);
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'CLEAN');
  assert.ok(!report.codeJudgment.reasons.includes('unreviewed_scope'));
});

test('M29 a narrative omission can recover in one code-only retry', async () => {
  let chunks = 0;
  const report = await runCodeReview({ session: redisPivotSession(), pr: makePr(), diff: DIFF,
    judge: async (request) => {
      if (/^code\+chunk:/.test(request.label)) { chunks++; return emptyResult(['config/redis.yml']); }
      return emptyResult([]);
    } });
  assert.equal(chunks, 1);
  assert.deepEqual(report.codeCoverageFacts.placed, ['config/redis.yml']);
  assert.equal(report.codeCoverage, 'complete');
  assert.ok(!report.codeJudgment.reasons.includes('unreviewed_scope'));
});

test("B8/B9 (c) complete needs the code's own placement record, the only path to code CLEAN", async () => {
  const report = await runCodeReview({ pr: makePr(), diff: DIFF, judge: async () => emptyResult() });
  assert.deepEqual(report.codeCoverageFacts,
    { placed: ['config/redis.yml'], snapshotFiles: 1, usableResults: 1, attemptedCalls: 1,
      // W3-1: which requests carried which files is part of the placement record now.
      windowRequests: 0, chunkRequests: 1, overBudgetRequests: 0, unreviewable: [] });
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'CLEAN');
});

test('B8/B9 a model naming a file outside the manifest is a downgrade, not a certification', async () => {
  const report = await runCodeReview({ pr: makePr(), diff: DIFF,
    judge: async () => emptyResult(['config/redis.yml', 'vendor/ghost.js']) });
  assert.equal(report.codeCoverage, 'partial');
  assert.equal(report.codeStatus, 'UNCHECKED');
});
