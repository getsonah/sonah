// W3d-4 — D58 follow-through, and the queued small items.
//
// D58 holds throughout: a check that did not run, and evidence that is absent, cap coverage; a
// check that ran and was inconclusive withholds its item without capping; nothing withheld is ever
// published. `false-clean-invariant.test.js` is untouched by this file and stays green.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called; every judge is a table keyed by label, item key and pass — never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports, so each test fails on its own against code that predates it rather than the
// whole file failing to link.
import * as challengeModule from '../src/challenge.js';
import * as ledger from '../src/ledger.js';
import * as reviewRender from '../src/review.js';
import * as reviewRun from '../src/run-review.js';
import { runCodeReview, snapshotDiff } from '../src/code-review.js';
import { Session, verifyReceipt } from '../src/session.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { attachBefore } from '../../slicer/src/before.js';
/** The body cap an earlier Sonah cut at (M33 R to D68 E); its stub stands only in a persisted ledger. */
const BEFORE_CAP = 20_000;
const STUB = `\n[… truncated at ${BEFORE_CAP} chars …]`;
import { redact } from '../../redact/index.js';
import { ARG_SEP } from '../../slicer/src/events.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

const { challengeItems } = challengeModule;
const { renderReview } = reviewRender;

// ---- shared synthetic session ------------------------------------------------------------------

const ASK = 'SYNTHETIC_W3D4_ASK: keep the ledger module small.';
const ask = { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D4_ASK' };
function oneAskSession() {
  const blobs = { ask: ASK };
  return new Session({ sessionKey: 'sess-w3d4-ask', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [],
      text: [{ sourceKey: 'ask', fromByte: 0, untilByte: Buffer.byteLength(ASK, 'utf8') }] },
  ] });
}

// ---- "unsettled" is not "not voted" ----------------------------------------------------------

test('W3d-4 an item that ran and was not settled is `unsettled`; one never voted on stays `unreviewed_scope`', async () => {
  assert.ok(ledger.JUDGMENT_REASONS.includes('unsettled'), 'the reason is a member of the closed vocabulary');
  assert.ok(!ledger.WITHHELD_REASONS.includes('unsettled'), 'a challenge reason, not a grounding withhold');
  const session = oneAskSession();
  const items = ['u1', 'u2', 'u3', 'u4'].map((key) => ({ key, type: 'requirement', candidate: { text: key } }));
  const verdictFor = { u1: 'not-refuted', u2: 'uncertain', u3: 'refuted' };
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.',
    verifyReceipt: (r) => verifyReceipt(session, r),
    judge: async ({ challenge }) => ({ votes: challenge.items
      // u4 is left out of every reply, re-ask included: nobody ever voted on it.
      .filter(({ key }) => key !== 'u4')
      .map(({ key }) => ({ key, verdict: verdictFor[key], explanation: 'Synthetic vote.',
        receipts: verdictFor[key] === 'uncertain' ? [] : [ask] })) }) });
  const reason = (key) => result.rejected.find((r) => r.key === key)?.reason;
  assert.equal(result.survivors.map((s) => s.key).join(), 'u1');
  assert.equal(reason('u2'), 'unsettled', 'voted on by every pass and not settled');
  assert.equal(reason('u3'), 'kind_rejected', 'refuted by a resolved majority, as before');
  assert.equal(reason('u4'), 'unreviewed_scope', 'never voted on: a check that did not run');
  for (const r of result.rejected) assert.ok(ledger.JUDGMENT_REASONS.includes(r.reason), r.reason);
  assert.equal(result.unsettledItems, 1);
});

// ---- the code review's session findings ------------------------------------------------

const REPO = { host: 'github.com', id: '584' };
const GREET = 'src/greet.js';
const DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,2 @@', '+const SYNTHETIC_W3D4_GREETING = "hello";', '+export default SYNTHETIC_W3D4_GREETING;', ''].join('\n');
const CODE_PR = { repo: REPO, number: 584, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
  gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: GREET, change: 'added', contentState: 'complete' }] };

/**
 * One window. A human rule, three edits under it — one that succeeded, one that failed, one with no
 * recorded outcome at all — and a second rule given only after the first edit.
 */
function vendorSession() {
  const blobs = {
    rule: 'SYNTHETIC_W3D4_RULE: never edit anything under the vendor directory.',
    said: 'SYNTHETIC_W3D4_SAID: editing the vendor files now.',
    late: 'SYNTHETIC_W3D4_LATE_RULE: and keep out of vendor from now on.',
    body: 'export const SYNTHETIC_W3D4_VENDOR = 1;\n', ok: 'SYNTHETIC_W3D4_OK', no: 'SYNTHETIC_W3D4_FAILED',
  };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  let sequence = 0;
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', sequence: sequence++, text: whole('rule'), supersedes: [] },
    { id: 'C1', kind: 'commentary', phase: 'working', sequence: sequence++, text: whole('said') },
  ];
  const edit = (id, path, result) => {
    events.push({ id, kind: 'invocation', callKey: id, tool: 'Edit', operation: 'edit', sequence: sequence++,
      paths: [{ path }], command: [], input: [], changes: [{ path, before: [], after: whole('body'), diff: [] }] });
    if (result) events.push({ id: `${id}-r`, kind: 'observation', phase: 'terminal', invocation: id, callKey: id,
      sequence: sequence++, result, exitCode: result === 'succeeded' ? 0 : 1, output: whole(result === 'succeeded' ? 'ok' : 'no'),
      sourceOfResult: 'native', terminalStatusProven: true });
  };
  edit('A1', 'vendor/one.js', 'succeeded');
  edit('A2', 'vendor/two.js', 'failed');
  edit('A3', 'vendor/three.js', null);
  events.push({ id: 'I2', kind: 'instruction', authority: 'human', sequence: sequence++, text: whole('late'), supersedes: [] });
  return new Session({ sessionKey: 'sess-w3d4-vendor', adapter: 'claude', events, blobs });
}

const rule = { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_W3D4_RULE' };
const action = (id, path) => ({ eventId: id, role: 'action', quote: path });
const breach = (title, receipts, scope = 'session-effect') => ({ origin: 'session-review',
  kind: 'edit_under_negative_requirement', title, explanation: `${title}: an edit under the vendor rule.`,
  receipts, scope, anchor: null });
const FINDINGS = Object.freeze({
  quote: breach('SYNTHETIC_W3D4_WITHHELD_QUOTE', [{ ...rule, quote: 'SYNTHETIC_W3D4_NEVER_SAID' }, action('A1', 'vendor/one.js')]),
  frozen: breach('SYNTHETIC_W3D4_WITHHELD_FROZEN', [rule, action('A1', 'vendor/one.js')], 'current-code'),
  role: breach('SYNTHETIC_W3D4_WITHHELD_ROLE', [rule]),
  late: breach('SYNTHETIC_W3D4_WITHHELD_LATE', [{ eventId: 'I2', role: 'instruction', quote: 'SYNTHETIC_W3D4_LATE_RULE' },
    action('A1', 'vendor/one.js')]),
  failed: breach('SYNTHETIC_W3D4_WITHHELD_FAILED', [rule, action('A2', 'vendor/two.js')]),
  unknown: breach('SYNTHETIC_W3D4_WITHHELD_UNKNOWN', [rule, action('A3', 'vendor/three.js')]),
});

/** The window answers `sessionFindings`; a chunk call reviews the PR's one file; nothing else. */
const answering = (sessionFindings) => async (request) => {
  const base = { decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [], sessionFindings: [] };
  if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
    explanation: 'Synthetic support.', receipts: [rule] })) };
  if (/^code\+chunk:/.test(request.label ?? '')) return { ...base, reviewedFiles: [GREET] };
  if (request.label === 'code+narrative:w1') return { ...base, sessionFindings, reviewedFiles: [] };
  return { ...base, reviewedFiles: [] };
};
const review = (findings) => runCodeReview({ session: vendorSession(), pr: CODE_PR, diff: DIFF, judge: answering(findings) });
const titles = (report) => JSON.stringify([report.findings, report.decisions]);

const section = (md, heading) => {
  const lines = md.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && (l.startsWith('### ') || l === '---'));
  return lines.slice(at + 1, end < 0 ? undefined : end).filter(Boolean);
};
const WITHHELD_HEADING = '### Checked, inconclusive — withheld';
const UNCHECKED_HEADING = '### What was not checked';

test('W3d-4 a finding resting on a write whose outcome is unknown is withheld AND caps, as declared absent evidence', async () => {
  assert.ok(snapshotDiff({ pr: CODE_PR, diff: DIFF }).complete, 'premise: the frozen diff is readable');
  assert.ok(ledger.GAP_CODES.includes('write_outcome_unknown'), 'a closed gap code');
  assert.equal(typeof reviewRender.GAP_SENTENCE.write_outcome_unknown, 'string', 'with one sentence');
  const report = await review([FINDINGS.unknown]);
  assert.equal(report.findings.length, 0, 'never published');
  assert.ok(!titles(report).includes('SYNTHETIC_W3D4_WITHHELD_UNKNOWN'));
  const gaps = report.gaps.filter((g) => g.code === 'write_outcome_unknown');
  assert.equal(gaps.length, 1, 'declared once');
  assert.deepEqual({ channel: gaps[0].channel, scope: gaps[0].scope, eventIds: gaps[0].eventIds, count: gaps[0].count },
    { channel: 'observations', scope: 'session', eventIds: ['A3'], count: 1 });
  assert.equal(report.codeCoverage, 'complete', 'premise: the code review read the PR');
  assert.equal(report.coverage, 'partial', 'whether the write happened is not in the record: it caps');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'UNCHECKED');
  assert.equal(ledger.honestStatuses(report).sessionStatus, 'UNCHECKED', 'and a re-reduction agrees');
  assert.equal(report.withheld.proposals, 0, 'it is not an inconclusive check, so it is not counted as one');
  assert.deepEqual(report.rejectedFindings.map((r) => r.reason), ['unreviewed_scope'],
    'it is rejected as a check that could not run, so the rejected count still holds every proposal');
  const md = renderReview(report);
  const unchecked = section(md, UNCHECKED_HEADING);
  assert.ok(unchecked?.some((l) => l.startsWith('- `write_outcome_unknown` at `A3` (1) — ')
    && l.includes(reviewRender.GAP_SENTENCE.write_outcome_unknown)), md);
  assert.ok(!(section(md, WITHHELD_HEADING) ?? []).some((l) => /proposal|finding/.test(l)),
    'and it is not listed as a check that ran and was inconclusive');
  assert.ok(!md.includes('SYNTHETIC_W3D4_WITHHELD_UNKNOWN'));
});

test('W3d-4 a finding resting on a write that failed stays withheld-only: it does not cap', async () => {
  const report = await review([FINDINGS.failed]);
  assert.equal(report.findings.length, 0, 'never published');
  assert.deepEqual(report.gaps.filter((g) => g.code === 'write_outcome_unknown'), []);
  assert.equal(report.withheld.proposals, 1);
  assert.equal(report.coverage, 'complete', 'a failed write is in the record: the check ran');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'CLEAN');
});

test('W3d-4 the withheld section says why each proposal was withheld, one closed sentence per cause', async () => {
  const report = await review([FINDINGS.quote, FINDINGS.frozen, FINDINGS.role, FINDINGS.late, FINDINGS.failed]);
  assert.equal(report.findings.length, 0, 'premise: nothing publishes');
  assert.equal(report.withheld.proposals, 5);
  assert.equal(report.coverage, 'complete', 'every one of them is a check that ran');
  assert.equal(report.reviewStatus, 'CLEAN');
  const md = renderReview(report);
  const lines = section(md, WITHHELD_HEADING);
  assert.ok(lines, `a withheld section:\n${md}`);
  const CAUSES = ['proposals', 'no_frozen_code', 'role_missing', 'rule_after_action', 'action_failed'];
  const sentence = (cause) => `- ${reviewRender.WITHHELD_SENTENCE[cause]?.({ n: 1 })}.`;
  for (const cause of CAUSES) assert.ok(lines.includes(sentence(cause)), `missing ${cause}:\n${lines.join('\n')}`);
  assert.ok(lines.includes('- 1 proposal(s) withheld: their quotes did not match the record.'),
    'only the one whose quote did not verify is said to have a bad quote');
  // Five distinct sentences for five distinct causes.
  assert.equal(new Set(CAUSES.map((cause) => reviewRender.WITHHELD_SENTENCE[cause]({ n: 1 }))).size, 5);
  for (const title of Object.values(FINDINGS).map((f) => f.title)) assert.ok(!md.includes(title), `${title} reached the report`);
});

test('W3d-4 every withheld cause a rejection can carry is closed, bare, and has a sentence', () => {
  const causes = ledger.WITHHELD_REJECTION_CAUSES;
  // M33 G4: `actor_ambiguous` — a decision whose cited actions resolve to more than one actor, or none. M36 phase 3 (D68 F,
  // c6): `other_session` — a contradicted claim whose result was recorded in another session than its statement.
  // D71 (S3, owner decisions D71 e, g): `source_not_before`, `source_not_human`, `source_not_file_content` — a
  // contradiction that is not a result holds only as the recorded source it names. W2: `source_rewritten` — the agent's
  // own added text whose path was changed again before the statement.
  assert.ok(Array.isArray(causes) && Object.isFrozen(causes) && causes.length === 10, 'one frozen list');
  for (const cause of causes) {
    assert.match(cause, /^[a-z][a-z_]*$/);
    assert.ok(reviewRender.WITHHELD_CAUSES.includes(cause), `${cause} has no rendered cause`);
    assert.ok(!ledger.JUDGMENT_REASONS.includes(cause), `${cause} is a cause, never a new reason`);
  }
  assert.deepEqual(Object.keys(reviewRender.WITHHELD_SENTENCE).sort(), [...reviewRender.WITHHELD_CAUSES].sort());
});

test('W3d-4 a report that declares no causes still counts every withheld proposal once, as a quote', () => {
  const md = renderReview({ pr: CODE_PR, findings: [], decisions: [], counts: { decisions: 0, byColumn: {} },
    coverage: 'complete', codeCoverage: 'complete', rejectedDecisions: [], rejectedFindings: [], gaps: [],
    withheld: { proposals: 3, unsettled: 0 } });
  assert.deepEqual(section(md, WITHHELD_HEADING).filter((l) => l.startsWith('- ')),
    ['- 3 proposal(s) withheld: their quotes did not match the record.']);
});

// ---- F163 / F164 unrecorded writes ----------------------------------------------------------

const unrecordedGap = (over = {}) => ({ code: 'unrecorded_body', channel: 'code', scope: 'session', count: 3,
  eventIds: ['A1', 'A2', 'A3'], writes: [
    { eventId: 'A1', path: 'src/a.js', outsideRepository: false },
    { eventId: 'A2', path: 'src/b.js', outsideRepository: false },
    { eventId: 'A3', path: 'src/c.js', outsideRepository: false }],
  note: '3 write(s) whose body the recording does not contain: 3 shell write(s)', ...over });
/** src/a.js and src/b.js are in the PR, complete, and were placed; src/c.js is not in the PR. */
const unrecordedReport = (gaps, adapterGaps = []) => ({
  pr: { repo: REPO, number: 585, enumeration: 'complete', files: ['src/a.js', 'src/b.js']
    .map((path) => ({ path, change: 'modified', contentState: 'complete' })) },
  session: Object.assign(new Session({ sessionKey: 'sess-w3d4-gaps', events: [] }), { adapterGaps }),
  codeCoverageFacts: { placed: ['src/a.js', 'src/b.js'] },
  findings: [], decisions: [], counts: { decisions: 0, byColumn: {} }, coverage: 'partial', codeCoverage: 'complete',
  rejectedDecisions: [], rejectedFindings: [], gaps });

test('W3d-4 F163 the unrecorded_body gap says one sentence per cover type, and no generic headline', () => {
  const md = renderReview(unrecordedReport([unrecordedGap()]));
  const lines = section(md, UNCHECKED_HEADING);
  const at = lines.findIndex((l) => l.startsWith('- `unrecorded_body`'));
  assert.ok(at >= 0, md);
  const headline = lines[at];
  assert.ok(!headline.includes(reviewRender.GAP_SENTENCE.unrecorded_body),
    `the declaration note and classified lines should supply the explanation:\n${headline}`);
  assert.ok(headline.includes('3 write(s) whose body the recording does not contain'), 'the declaration\'s own note stays');
  const covers = lines.slice(at + 1).filter((l) => l.startsWith('  - '));
  assert.deepEqual(covers, [`  - 3 ${reviewRender.UNRECORDED_COVER_SENTENCE.none}.`]);
  // Each cover sentence stands on its own: it says the body was not recorded AND what covered it.
  for (const sentence of Object.values(reviewRender.UNRECORDED_COVER_SENTENCE))
    assert.match(sentence, /no recorded body/, sentence);
  assert.ok(!md.includes(reviewRender.GAP_SENTENCE.unrecorded_body), 'the generic sentence is nowhere in the report');
});

test('W3d-4 F164 gap de-duplication keys on code, channel, scope and sorted eventIds, not on JSON bytes', () => {
  assert.equal(typeof ledger.gapKey, 'function', 'one key, exported');
  // The same declaration twice: once live, once as reloaded from disk — keys in another order, its
  // event ids in another order, and a note that differs. One loss, not two.
  const reloaded = { note: 'reloaded copy', writes: unrecordedGap().writes, eventIds: ['A3', 'A1', 'A2'],
    count: 3, scope: 'session', channel: 'code', code: 'unrecorded_body' };
  assert.notEqual(JSON.stringify(reloaded), JSON.stringify(unrecordedGap()), 'premise: the bytes differ');
  assert.equal(ledger.gapKey(reloaded), ledger.gapKey(unrecordedGap()));
  // A declaration of different writes is a different loss.
  const other = unrecordedGap({ eventIds: ['A9'], count: 1, writes: [{ eventId: 'A9', path: 'src/z.js', outsideRepository: false }] });
  assert.notEqual(ledger.gapKey(other), ledger.gapKey(unrecordedGap()));
  // The renderer's own gap list uses the same key: the header counts the loss once.
  const unreviewable = { code: 'code_unreviewable', channel: 'code', scope: 'pr', count: 2, note: 'x' };
  const copy = { note: 'x', count: 2, scope: 'pr', channel: 'code', code: 'code_unreviewable' };
  const causes = reviewRender.coverageCauses(unrecordedReport([unreviewable], [copy]));
  assert.deepEqual(causes.find(([cause]) => cause === 'code_unreviewable'), ['code_unreviewable', { n: 2 }]);
});

// ---- F156 a failed call keeps its failure code, on every review --------------------------------

const EMPTY = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

// D60 (W3f-1): the reuse path this pinned (a reused capsule's fresh joint call) is gone. The outcome
// stands under the one reuse rule: a failed call keeps its own code, and — never stored — it is asked
// live again by the next review, which reports its own code again rather than an earlier answer.
test('W3d-4 F156 a failed call keeps its code on every review and is never replayed; only an unknown one is model_unavailable', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-f156-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  const session = oneAskSession();
  for (const [code, expected] of [['model_timeout', 'model_timeout'], ['anthropic_key_missing', 'anthropic_key_missing'],
    ['model_response_invalid', 'model_response_invalid'], ['budget_exhausted', 'budget_exhausted'],
    ['something_new_from_a_backend', 'model_unavailable']]) {
    let calls = 0;
    const failing = memoizeJudge(async () => { calls++; throw Object.assign(new Error('synthetic'), { code, transportClass: 'timeout' }); }, cache);
    const report = await reviewRun.runReview({ session, pr: null, judge: failing });
    assert.equal(calls, 1, `${code}: asked live — no earlier review stored a failure`);
    assert.deepEqual(report.windowFailures, [{ window: 1, reason: expected }], code);
    assert.ok(ledger.JUDGE_FAILURE_CODES.includes(report.windowFailures[0].reason), 'always a member of the closed set');
    assert.equal(report.windowResults[0].shortfall.transport, 'timeout', 'the transport class still travels beside it');
  }
  // An answer, once given, is the answer to those bytes: the next review asks nothing.
  await reviewRun.runReview({ session, pr: null, judge: memoizeJudge(async () => EMPTY(), cache) });
  const replay = memoizeJudge(async () => { throw new Error('no call'); }, cache);
  const report = await reviewRun.runReview({ session, pr: null, judge: replay });
  assert.deepEqual(replay.answers, { calls: 0, reused: 1 });
  assert.deepEqual(report.windowFailures, []);
});

// ---- F157 why a decision's place in the PR is unknown ------------------------------------------

const placedDecision = { dimension: 'SYNTHETIC_W3D4_DIMENSION', chosen: 'SYNTHETIC_W3D4_CHOSEN', actions: ['A1'],
  value: 'vendor/one.js', valueReceipt: { eventId: 'A1', field: 'path', role: 'action', quote: 'vendor/one.js' },
  stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_W3D4_SAID' },
  constrainedBy: { instruction: rule, settles: false, settledValueQuote: null } };
const deciding = async (request) => (request.challenge
  ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted', explanation: 'Synthetic support.', receipts: [rule] })) }
  : { ...EMPTY(), decisions: [placedDecision] });

test('W3d-4 F157 a decision is unplaceable for a recorded reason, and the report says which', async () => {
  assert.deepEqual([...(ledger.RELEVANCE_UNKNOWN ?? [])].sort(), ['file_list_missing', 'file_partial'], 'a closed list');
  const noList = await reviewRun.runReview({ session: vendorSession(), pr: { repo: REPO, number: 586, files: [] }, judge: deciding });
  // The file the decision wrote was renamed in the PR, and the PR supplied it only partly: its old
  // path cannot be matched, and nothing else lists it.
  const partly = await reviewRun.runReview({ session: vendorSession(), judge: deciding, pr: { repo: REPO, number: 587,
    enumeration: 'complete', files: [{ path: 'vendor/renamed.js', oldPath: 'vendor/one.js', change: 'renamed', contentState: 'partial' }] } });
  for (const [report, reason] of [[noList, 'file_list_missing'], [partly, 'file_partial']]) {
    assert.equal(report.decisions.length, 1, 'premise: the decision grounded');
    assert.equal(report.decisions[0].relevance, 'unchecked');
    assert.equal(report.decisions[0].relevanceUnknown, reason, 'why it is unknown is recorded on the row');
    assert.equal(report.coverage, 'partial', 'absent evidence still caps, as before');
  }
  const window = (report) => section(renderReview(report), UNCHECKED_HEADING).filter((l) => l.startsWith('- window 1:'));
  assert.ok(window(noList).includes('- window 1: 1 decision(s) could not be placed in the PR: the PR file list was not available.'),
    window(noList).join('\n'));
  assert.ok(!window(noList).some((l) => l.includes('supplied only partly')), 'a list that was never supplied is not a partial file');
  assert.ok(window(partly).includes('- window 1: 1 decision(s) concern a file the PR supplied only partly.'), window(partly).join('\n'));
  assert.ok(!window(partly).some((l) => l.includes('not available')));
  // A decision whose place IS known carries no reason at all.
  const placed = await reviewRun.runReview({ session: vendorSession(), judge: deciding, pr: { repo: REPO, number: 588,
    enumeration: 'complete', files: [{ path: 'vendor/one.js', change: 'modified', contentState: 'complete' }] } });
  assert.equal(placed.decisions[0].relevance, 'survives');
  assert.equal(Object.hasOwn(placed.decisions[0], 'relevanceUnknown'), false);
});

// ---- F158 a snapped settled value is a repaired receipt -----------------------------------------

test('W3d-4 F158 counts.receiptsRepaired includes a settled value snapped to the instruction', () => {
  const text = 'SYNTHETIC_F158: use the exact backend value “Redis” for the cache layer.';
  const blobs = { ask: text, body: 'SYNTHETIC_F158_BODY\n', ok: 'SYNTHETIC_F158_OK\n' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const session = new Session({ sessionKey: 'sess-f158', adapter: 'claude', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('ask'), supersedes: [] },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Write', operation: 'write',
      paths: [{ path: 'src/cache.js' }], command: [], input: [],
      changes: [{ path: 'src/cache.js', before: [], after: whole('body'), diff: [] }] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal',
      result: 'succeeded', exitCode: 0, output: whole('ok'), sourceOfResult: 'native', terminalStatusProven: true },
  ] });
  const candidate = (value) => ({ actorSession: session.sessionKey, dimension: 'cache backend', chosen: 'Redis',
    value: null, valueReceipt: null, actions: ['A1'], stated: null,
    constrainedBy: { instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_F158' }, settles: true, settledValueQuote: value } });
  const ground = (value) => ledger.groundDecision({ repo: REPO, session, pr: null, instructionHistoryComplete: true, candidate: candidate(value) });
  const snapped = ground('backend value "Redis" for');
  assert.equal(snapped.decision.column, 'asked-settled', 'premise: the near-miss snapped and grounded');
  assert.notEqual(snapped.decision.constrainedBy.settledValueQuote, 'backend value "Redis" for', 'premise: it was repaired');
  assert.equal(snapped.receiptsRepaired, 1, 'the published settled value was snapped by code');
  assert.equal(ground('backend value “Redis” for').receiptsRepaired, 0, 'an exact value was not');
  const report = ledger.buildLedger({ repo: REPO, session, pr: null, candidates: [candidate('backend value "Redis" for')] });
  assert.equal(report.counts.receiptsRepaired, 1);
  // A value that repair cannot place is not published, so it is not counted either.
  assert.equal(ground('"Memcached"').receiptsRepaired, 0);
});

// ---- F155 / F136 the adapter reads what the slicer recorded ---------------------------------

/** The slicer's own `after` for one write, in a one-action ledger, through redaction — which (M33 R) caps it, after
 *  scrubbing it whole. */
function ledgerOf(event) {
  const [slicerEvent] = attachBefore([{ turn: 0, seq: 0, ...event }]);
  return redact({ ask: [{ turn: 0, text: 'SYNTHETIC_W3D4_ADAPTER_ASK: make the change.' }],
    ledger: [{ ...slicerEvent, result: { seen: true, outcome: 'succeeded', provenance: 'native' } }],
    commentary: [], sayings: [], marks: [] }).ledger;
}
const changeOf = (ledgerValue) => {
  const session = sessionFromLedger(ledgerValue, { sessionKey: 'sess-w3d4-adapter' });
  const [invocation] = session.events.filter((e) => e.kind === 'invocation');
  return { session, invocation, change: invocation.changes[0] };
};

test('W3d-4 F155 an Edit\'s written and replaced text each carry their own extent', () => {
  const NEW = `${'n'.repeat(20_000)}SYNTHETIC_W3D4_NEW_TAIL`;
  const OLD = 'const SYNTHETIC_W3D4_REPLACED = 1;';
  // D68 (E): the slicer and redaction keep both sides whole.
  const whole = changeOf(ledgerOf({ kind: 'edit', path: 'src/big.js', _body: `${NEW}${ARG_SEP}${OLD}`, _editParts: 1 }));
  assert.equal(whole.change.extent.truncated, false);
  assert.equal(whole.session.textOf(whole.change, 'after'), NEW);
  assert.equal(whole.session.textOf(whole.change, 'before'), OLD);
  // A ledger an earlier Sonah persisted with its written side cut: each side keeps its own extent.
  const persisted = (body) => changeOf({ ...ledgerOf({ kind: 'edit', path: 'src/big.js', _body: 'x', _editParts: 1 }),
    ledger: [{ turn: 0, seq: 0, kind: 'edit', path: 'src/big.js',
      after: { text: body, truncated: true, lines: body.split('\n').length, parts: 1, priorParts: 1 },
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } }] });
  const { session, invocation, change } = persisted(`${NEW.slice(0, BEFORE_CAP)}${STUB}${ARG_SEP}${OLD}`);
  assert.equal(invocation.changes.length, 1);
  assert.equal(change.extent.truncated, true, 'the written side was cut');
  assert.equal(change.extent.cap, BEFORE_CAP);
  assert.equal(change.extent.chars, BEFORE_CAP);
  assert.equal(change.extent.priorState, 'edit-text', 'premise: the before side is the replaced text');
  assert.equal(change.beforeExtent.truncated, false, 'the replaced side was not');
  assert.equal(change.beforeExtent.cap, null);
  assert.equal(session.textOf(change, 'before'), OLD, 'and it is whole');
  assert.ok(verifyReceipt(session, { eventId: invocation.id, role: 'code', quote: 'SYNTHETIC_W3D4_REPLACED' }).ok,
    'the replaced text is quotable');
  assert.ok(!session.textOf(change, 'after').includes('truncated at'), 'the recorder\'s stub is never quotable');

  // The other way round: the replaced side cut, the written side whole.
  const flipped = persisted(`const SYNTHETIC_W3D4_WRITTEN = 2;${ARG_SEP}${'o'.repeat(BEFORE_CAP)}${STUB}`).change;
  assert.equal(flipped.extent.truncated, false, 'the written side was not cut');
  assert.equal(flipped.extent.cap, null);
  assert.equal(flipped.beforeExtent.truncated, true, 'the replaced side was');
  assert.equal(flipped.beforeExtent.cap, BEFORE_CAP);
});

test('W3d-4 F136 an appended, expanded or inserted body says so on its change\'s extent', () => {
  const body = (flags) => changeOf({ ask: [{ turn: 0, text: 'SYNTHETIC_W3D4_ADAPTER_ASK: keep notes.' }],
    ledger: [{ turn: 0, seq: 0, kind: 'edit', path: 'docs/notes.md',
      after: { text: 'SYNTHETIC_W3D4_NOTE\n', truncated: false, lines: 2, ...flags },
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } }],
    commentary: [], sayings: [], marks: [] }).change.extent;
  for (const flag of ['append', 'expanded', 'insert']) {
    const extent = body({ [flag]: true });
    assert.equal(extent[flag], true, `${flag} reaches the extent`);
    assert.equal(extent.recorded, true);
  }
  const plain = body({});
  for (const flag of ['append', 'expanded', 'insert'])
    assert.equal(Object.hasOwn(plain, flag), false, `a whole-file body declares no ${flag}: unchanged byte for byte`);
  assert.deepEqual(Object.keys(body({ append: true, expanded: true })).filter((k) => ['append', 'expanded', 'insert'].includes(k)),
    ['append', 'expanded'], 'and only what the recorder declared');
});
