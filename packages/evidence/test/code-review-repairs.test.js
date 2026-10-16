// W3e-2 (F187) — a receipt the code review repaired is counted where every other repair is.
//
// `groundFinding` snaps a near-miss quote to the exact recorded text, marks the receipt
// `repaired: true` and returns how many it snapped (`receiptsRepaired`, W3-3). `buildLedger` adds
// that to `counts.receiptsRepaired`; the code review's own `ground` threw it away. So a code
// finding's repaired receipt carried its per-line `· repaired` mark, while the footer — which
// prints `counts.receiptsRepaired` since F172 — did not count it: two statements about one report
// that disagreed.
//
// Every byte is synthetic: invented instructions, paths and model replies. No model is called; the
// judge is a table keyed by label, never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCodeReview, snapshotDiff } from '../src/code-review.js';
import { Session } from '../src/session.js';

const REPO = { host: 'github.com', id: '187' };
const GREET = 'src/greet.js';
const DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,2 @@', '+const SYNTHETIC_F187_GREETING = "hello";', '+export default SYNTHETIC_F187_GREETING;', ''].join('\n');
const PR = { repo: REPO, number: 187, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
  gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: GREET, change: 'added', contentState: 'complete' }] };

/** A human rule whose recorded text carries curly quotes, then one command that succeeded. */
function session() {
  const blobs = {
    rule: 'SYNTHETIC_F187_RULE: the greeting must stay “hello” in every locale.',
    cmd: 'node --check src/greet.js', ok: 'SYNTHETIC_F187_OK',
  };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  return new Session({ sessionKey: 'sess-f187', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: 0, text: whole('rule'), supersedes: [] },
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', sequence: 1,
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', sequence: 2,
      result: 'succeeded', exitCode: 0, output: whole('ok'), sourceOfResult: 'native' },
  ] });
}

const source = snapshotDiff({ pr: PR, diff: DIFF }).sources
  .find((s) => s.path === GREET && s.side === 'RIGHT' && s.text.includes('SYNTHETIC_F187_GREETING = "hello"'));
const code = { role: 'code', eventId: source.eventId, revisionOid: source.revisionOid,
  quote: 'const SYNTHETIC_F187_GREETING = "hello";' };
// Straight quotes where the recording has curly ones: grounding snaps this one to the recorded text.
const NEAR_MISS = 'the greeting must stay "hello" in every locale';
const rule = { eventId: 'I1', role: 'instruction', quote: NEAR_MISS };
const exactRule = { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F187_RULE' };

const CODE_FINDING = { origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC_F187_CODE',
  explanation: 'SYNTHETIC_F187: the greeting is hard-coded where the rule asks for every locale.',
  receipts: [code, rule], scope: 'current-code', anchor: { path: GREET, side: 'RIGHT', startLine: 1, endLine: 1 } };

/**
 * The window call answers `sessionFindings`; every chunk call answers `codeFindings` and reviews the
 * PR's one file. Challengers support every item with an exact receipt.
 */
const answering = ({ codeFindings = [], sessionFindings = [] }) => async (request) => {
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support.', receipts: [exactRule] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, codeFindings, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, sessionFindings, reviewedFiles: [] };
  return { ...base, reviewedFiles: [] };
};

/** The receipts of the published findings that code marked as snapped to the recorded text. */
const markedReceipts = (report) => report.findings.flatMap((f) => f.receipts ?? []).filter((r) => r.repaired === true).length;

test('F187 a code finding with one repaired receipt is counted in counts.receiptsRepaired, and the marks equal it', async () => {
  const report = await runCodeReview({ session: session(), pr: PR, diff: DIFF, judge: answering({ codeFindings: [CODE_FINDING] }) });
  const published = report.findings.filter((f) => f.origin === 'code-review');
  assert.equal(published.length, 1, `premise: the code finding is published:\n${JSON.stringify(report.rejectedCodeFindings)}`);
  const marked = published[0].receipts.filter((r) => r.repaired === true);
  assert.equal(marked.length, 1, 'premise: exactly one of its receipts was snapped by code');
  assert.equal(marked[0].role, 'instruction');
  assert.notEqual(marked[0].quote, NEAR_MISS, 'premise: the published quote is the recorded text');

  assert.equal(report.counts.receiptsRepaired, 1, 'the repair is counted');
  assert.equal(markedReceipts(report), report.counts.receiptsRepaired, 'the marks say what the count says');
});

test('F187 a finding offered again by a second request is one finding, and its repair is counted once', async () => {
  // The chunk pass and the window both answer with the same finding; grounding keeps the first.
  const judge = async (request) => {
    const answer = await answering({ codeFindings: [CODE_FINDING] })(request);
    return request.label === 'code+narrative:w1' ? { ...answer, codeFindings: [CODE_FINDING] } : answer;
  };
  const report = await runCodeReview({ session: session(), pr: PR, diff: DIFF, judge });
  assert.equal(report.findings.filter((f) => f.origin === 'code-review').length, 1, 'premise: one finding');
  assert.equal(report.counts.receiptsRepaired, 1);
  assert.equal(markedReceipts(report), 1);
});

test('F187 a session finding the code review grounded with a repaired receipt is counted too', async () => {
  const breach = { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 'SYNTHETIC_F187_SESSION',
    explanation: 'SYNTHETIC_F187: a command ran under the locale rule.', scope: 'session-effect', anchor: null,
    receipts: [rule, { eventId: 'A1', role: 'action', quote: 'node --check src/greet.js' }] };
  const report = await runCodeReview({ session: session(), pr: PR, diff: DIFF, judge: answering({ sessionFindings: [breach] }) });
  const published = report.findings.filter((f) => f.title === breach.title);
  assert.equal(published.length, 1, `premise: published:\n${JSON.stringify(report.rejectedFindings)}`);
  assert.equal(published[0].receipts.filter((r) => r.repaired === true).length, 1, 'premise: one repaired receipt');
  assert.equal(report.counts.receiptsRepaired, 1);
  assert.equal(markedReceipts(report), report.counts.receiptsRepaired);
});

test('F187 a finding the session review already grounded is published as its copy, and counted as that copy', async () => {
  // The window's narrative carries a contradicted claim (exact quotes), which the session review
  // grounds as a finding; the same window also offers that contradiction as a session finding with
  // a near-miss quote, which grounding here snaps back to the same identity. One finding is
  // published — the session review's, with no repaired line — so nothing is added to the count.
  const blobs = { said: 'SYNTHETIC_F187_SAID: the “locale” tests all pass now.', cmd: 'npm test -- locale',
    failed: 'SYNTHETIC_F187_FAILED: 2 locale tests failed' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const claimed = new Session({ sessionKey: 'sess-f187-claim', adapter: 'claude', blobs, events: [
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', sequence: 0,
      paths: [], command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', phase: 'terminal', invocation: 'A1', callKey: 'A1', sequence: 1,
      result: 'failed', exitCode: 1, output: whole('failed'), sourceOfResult: 'native' },
    { id: 'C1', kind: 'commentary', phase: 'final', sequence: 2, text: whole('said') },
  ] });
  const stated = { eventId: 'C1', role: 'commentary', quote: 'the “locale” tests all pass now' };
  const contradictedBy = { eventId: 'A1-r', role: 'observation', quote: 'SYNTHETIC_F187_FAILED: 2 locale tests failed' };
  const again = { origin: 'session-review', kind: 'claim_contradicted', title: 'SYNTHETIC_F187_AGAIN',
    explanation: 'SYNTHETIC_F187: the claim is contradicted by the recorded result.', scope: 'session-effect', anchor: null,
    receipts: [{ ...stated, quote: 'the "locale" tests all pass now' }, contradictedBy] };
  const judge = async (request) => {
    const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Synthetic support.', receipts: [contradictedBy] })) };
    if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
    if (request.label === 'code+narrative:w1') return { ...base, reviewedFiles: [],
      claims: [{ text: 'SYNTHETIC_F187 the locale tests pass', stated, contradictedBy }], sessionFindings: [again] };
    return { ...base, reviewedFiles: [] };
  };
  const report = await runCodeReview({ session: claimed, pr: PR, diff: DIFF, judge });
  const contradictions = report.findings.filter((f) => f.kind === 'claim_contradicted');
  assert.equal(contradictions.length, 1, `premise: one contradiction, published once:\n${JSON.stringify(report.findings.map((f) => f.title))}`);
  assert.notEqual(contradictions[0].title, again.title, 'premise: the session review\'s copy is the one published');
  assert.equal(contradictions[0].receipts.filter((r) => r.repaired === true).length, 0, 'premise: no line is marked');
  assert.equal(report.counts.receiptsRepaired, 0, 'the copy not published adds nothing');
  assert.equal(markedReceipts(report), 0);
});

test('F187 a code finding whose quotes were all exact adds nothing to the count', async () => {
  const exact = { ...CODE_FINDING, title: 'SYNTHETIC_F187_EXACT', receipts: [code, exactRule] };
  const report = await runCodeReview({ session: session(), pr: PR, diff: DIFF, judge: answering({ codeFindings: [exact] }) });
  assert.equal(report.findings.filter((f) => f.origin === 'code-review').length, 1, 'premise: published');
  assert.equal(report.counts.receiptsRepaired, 0);
  assert.equal(markedReceipts(report), 0, 'no mark when nothing was repaired');
});
