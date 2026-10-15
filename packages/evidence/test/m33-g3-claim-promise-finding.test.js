// C-06 "M33 session verdict": "A claim whose stated receipt is also cited by a surviving
// `claim_contradicted` finding is that finding, not also an open promise." Before this lane the same
// claim could be published twice — once as an OPEN promise ("the session did not settle it either
// way") and once as a DECIDE finding saying a recorded result contradicts it.
//
// In one window (the same claim proposed with and without its contradiction), and across windows
// (the merged promises of every window against the findings that survived the ledger). Near misses
// keep their promise: another quote, another event, another finding kind, a finding that did not
// survive.
//
// Synthetic session, synthetic judge: no recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
// A namespace import, so each test fails on its own against code that predates it.
import * as reviewRun from '../src/run-review.js';
import { renderReview } from '../src/review.js';
import { runCodeReview } from '../src/code-review.js';

const { runReview, mergeWindowOutputs } = reviewRun;
const REPO = { host: 'github.com', id: '0' };

const TEXT = {
  ask: 'SYNTHETIC_G3_CLAIM_ASK: add the retry helper and run the unit tests.',
  said: 'SYNTHETIC_G3_CLAIM_SAID: I added the retry helper and the unit tests pass now.',
  also: 'SYNTHETIC_G3_CLAIM_ALSO: the retry helper is exported from the index.',
  cmd: 'npm run test:unit',
  out: 'SYNTHETIC_G3_CLAIM_OUT: Tests: 1 failed, 4 passed, 5 total',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const session = () => new Session({ sessionKey: 'sess-g3-claims', adapter: 'claude', blobs: { ...TEXT }, events: [
  { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
  { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command',
    paths: [], command: whole('cmd'), input: [], changes: [] },
  { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
    result: 'failed', exitCode: 1, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' },
  { id: 'C1', kind: 'commentary', sequence: 3, phase: 'working', text: whole('also'), beforeInvocation: null },
  { id: 'C2', kind: 'commentary', sequence: 4, phase: 'final', text: whole('said'), beforeInvocation: null },
] });

const STATED = { eventId: 'C2', role: 'commentary', quote: 'I added the retry helper and the unit tests pass now.' };
const AGAINST = { eventId: 'A1-r', role: 'observation', quote: 'Tests: 1 failed, 4 passed, 5 total' };
const OTHER = { eventId: 'C1', role: 'commentary', quote: 'the retry helper is exported from the index.' };
const CLAIM = 'The agent said the unit tests pass.';
const support = (receipt) => ({ verdict: 'not-refuted', explanation: 'Recorded.', receipts: [receipt] });
const judge = (claims) => async (request) => request.challenge
  ? { votes: request.challenge.items.map(({ key }) => ({ key, ...support(STATED) })) }
  : { decisions: [], pivots: [], requirements: [], claims };
const reviewOf = (claims) => runReview({ session: session(), pr: null, reviewScope: 'session-only', judge: judge(claims) });
// The claims listed as open (or unchecked) under the claims heading. M33 G5: when every claim became
// its finding, that heading still states how many (`counts.promisesAsFindings`), and lists none.
const listedClaims = (md) => {
  const lines = md.split('\n');
  // D88: a claim confirmed by a recorded result is listed under what the agent told you; one not checked under What
  // Sonah could not check.
  return ['### What the agent told you', '### What Sonah could not check'].flatMap((heading) => {
    const start = lines.findIndex((line) => line.startsWith(heading));
    if (start < 0) return [];
    const end = lines.findIndex((line, at) => at > start && (line.startsWith('### ') || line === '---'));
    // M33 C: a listed claim reads "not checked" or "confirmed by a later result", never "open".
    return lines.slice(start + 1, end < 0 ? undefined : end)
      .filter((line) => /^- \*\*(not checked|confirmed by a later result)\*\*/.test(line));
  });
};

test('M33 G3 in one window, a claim a surviving claim_contradicted finding cites is that finding, not an open promise', async () => {
  const report = await reviewOf([
    { text: CLAIM, stated: STATED, contradictedBy: AGAINST },
    { text: CLAIM, stated: STATED, contradictedBy: null },
  ]);
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted'], 'premise: the finding survived');
  assert.deepEqual(report.promises, [], 'the same claim is not also published as an open promise');
  assert.equal(report.counts.promisesAsFindings, 1, 'counted, never silently discarded');
  const md = renderReview(report);
  assert.deepEqual(listedClaims(md), [], 'not listed as an open claim');
  assert.ok(md.includes('`claim\\_contradicted`'), 'the claim is shown once, as its finding');
  assert.ok(!md.includes('· DECIDE'), 'D71 (a): never with a status');
});

test('M33 G3 a claim with its own stated receipt stays an open promise beside the finding', async () => {
  const report = await reviewOf([
    { text: CLAIM, stated: STATED, contradictedBy: AGAINST },
    { text: 'The agent said the helper is exported.', stated: OTHER, contradictedBy: null },
  ]);
  assert.deepEqual(report.findings.map((f) => f.kind), ['claim_contradicted']);
  assert.deepEqual(report.promises.map((p) => p.stated.eventId), ['C1']);
  assert.equal(report.counts.promisesAsFindings, 0);
});

test('M33 G3 a contradicted claim whose contradiction did not ground leaves the other claim an open promise', async () => {
  const report = await reviewOf([
    { text: CLAIM, stated: STATED, contradictedBy: { ...AGAINST, quote: 'SYNTHETIC QUOTE NOBODY EVER RECORDED' } },
    { text: CLAIM, stated: STATED, contradictedBy: null },
  ]);
  assert.deepEqual(report.findings, [], 'premise: no finding survived');
  assert.deepEqual(report.promises.map((p) => p.stated.eventId), ['C2'], 'nothing supersedes it, so it is published');
  assert.equal(report.counts.promisesAsFindings, 0);
});

// ---- across windows: the merged promises against the findings that survived ---------------------

const grounded = (receipt) => ({ ...receipt, sessionKey: 'sess-g3-claims' });
const promiseOf = (receipt, text = CLAIM) => ({ id: `promise:${receipt.eventId}:${receipt.quote}`, stated: grounded(receipt),
  text, status: 'open', receipts: [grounded(receipt)] });
const finding = (kind, receipts) => ({ origin: 'session-review', kind, title: 't', explanation: 'e', scope: 'session-effect',
  anchor: null, status: 'DECIDE', receipts: receipts.map(grounded) });

test('M33 G3 across windows, a promise from one window is superseded by a surviving finding from another', () => {
  assert.equal(typeof reviewRun.promisesBesideFindings, 'function', 'the rule is one exported function');
  const merged = mergeWindowOutputs({ repo: REPO, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [promiseOf(STATED), promiseOf(OTHER)] },
    { decisions: [], findings: [], requirements: [], promises: [] },
  ] });
  assert.equal(merged.promises.length, 2, 'premise: the merge keeps both');
  const { promises, asFindings } = reviewRun.promisesBesideFindings(merged.promises,
    [finding('claim_contradicted', [STATED, AGAINST])]);
  assert.deepEqual(promises.map((p) => p.stated.eventId), ['C1']);
  assert.equal(asFindings, 1);
});

test('M33 G3 near misses keep their promise: another quote, another event, another kind, another session', () => {
  const { promisesBesideFindings } = reviewRun;
  assert.equal(typeof promisesBesideFindings, 'function');
  const promises = [promiseOf(STATED)];
  const keep = (findings) => promisesBesideFindings(promises, findings);
  // The same event, a different (shorter) quote: a different receipt.
  assert.equal(keep([finding('claim_contradicted', [{ ...STATED, quote: 'the unit tests pass now.' }, AGAINST])]).promises.length, 1);
  // The same quote on another event.
  assert.equal(keep([finding('claim_contradicted', [{ ...STATED, eventId: 'C1' }, AGAINST])]).promises.length, 1);
  // Another finding kind citing the very same receipt is not a contradiction of the claim.
  assert.equal(keep([finding('edit_not_asked_for', [STATED, AGAINST])]).promises.length, 1);
  // A receipt bound to another session.
  assert.equal(keep([{ ...finding('claim_contradicted', [AGAINST]),
    receipts: [{ ...STATED, sessionKey: 'another-session' }, grounded(AGAINST)] }]).promises.length, 1);
  // Nothing to compare against.
  assert.deepEqual(keep([]), { promises, asFindings: 0 });
  assert.deepEqual(promisesBesideFindings(undefined, undefined), { promises: [], asFindings: 0 });
});

// ---- the renderer, for any producer ---------------------------------------------------------------

test('M33 G3 the renderer never lists a claim that a published claim_contradicted finding cites as open', async () => {
  const report = await reviewOf([{ text: CLAIM, stated: STATED, contradictedBy: null }]);
  assert.equal(report.promises.length, 1, 'premise: an open promise');
  const contradicted = { ...report, findings: [finding('claim_contradicted', [STATED, AGAINST])], reviewStatus: 'DECIDE' };
  assert.deepEqual(listedClaims(renderReview(contradicted)), []);
  const otherKind = { ...report, findings: [{ ...finding('edit_not_asked_for', [STATED]), status: 'FYI' }] };
  assert.equal(listedClaims(renderReview(otherKind)).length, 1, 'another kind leaves the claim open');
});

test('M33 G3 the combined review route does not render one claim as open and contradicted', async () => {
  // The code review's own narrative lists the claim under `claims` with no contradiction, while the
  // same answer's `sessionFindings` carries its claim_contradicted: both survive.
  const GREET = 'src/greet.js';
  const diff = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
    '+++ b/src/greet.js', '@@ -0,0 +1,1 @@', '+export default "SYNTHETIC_G3_GREETING";', ''].join('\n');
  const pr = { repo: { host: 'github.com', id: '303' }, number: 303, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
  const contradiction = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_G3_CONTRADICTED',
    explanation: 'SYNTHETIC_G3: the recorded result contradicts the claim.', scope: 'session-effect', anchor: null,
    receipts: [STATED, AGAINST] };
  const combinedJudge = async (request) => {
    const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, ...support(AGAINST) })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
    if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [],
      claims: [{ text: CLAIM, stated: STATED, contradictedBy: null }], sessionFindings: [contradiction] };
    return { ...base, reviewedFiles: [] };
  };
  const report = await runCodeReview({ session: session(), pr, diff, judge: combinedJudge });
  assert.ok(report.findings.some((f) => f.kind === 'claim_contradicted'), 'premise: the finding survived');
  const md = renderReview(report);
  assert.deepEqual(listedClaims(md), [], 'the claim is shown once, as the finding');
});
