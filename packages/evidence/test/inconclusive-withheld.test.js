// W3d-3 / D58. A check that ran and was inconclusive withholds its item; it does not uncheck the
// review.
//
//   not run      a call failed, timed out or was stopped; a reply omitted an item even after the
//                re-ask; evidence is absent (a partial file, an unlinked child, an elided ask)
//                -> caps coverage, exactly as before
//   inconclusive a proposal whose quote did not match the record; an item the challengers voted on
//                and could not settle; a code finding rejected; a published decision whose
//                authority column or value could not be determined
//                -> the item is withheld (never shown as an accusation), counted and listed, and
//                   coverage is NOT capped
//
// Precision over recall is unchanged: nothing inconclusive is ever published as a finding, a
// decision column or an accusation, and an inconclusive result never lifts what a not-run cause
// capped. `false-clean-invariant.test.js` is untouched by this change and stays green.
//
// Every byte is synthetic: invented instructions, paths, outputs and model replies. No model is
// called; every judge is a table keyed by window, item key and pass — never by call order.
import test from 'node:test';
import assert from 'node:assert/strict';
// Namespace imports, so each test fails on its own against code that predates it rather than the
// whole file failing to link.
import * as challengeModule from '../src/challenge.js';
import * as reviewRun from '../src/run-review.js';
import * as ledger from '../src/ledger.js';
import * as reviewRender from '../src/review.js';
import { runCodeReview, snapshotDiff } from '../src/code-review.js';
import { planWindows, COMBINED_WINDOW_SETTINGS } from '../src/windows.js';
import { Session, verifyReceipt } from '../src/session.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnswerCache, memoizeJudge } from '../../cli/src/answer-cache.js';

const { challengeItems, CHALLENGE_PROFILE } = challengeModule;
const { runReview } = reviewRun;
const { buildLedger, honestStatuses, sessionCoverageFacts, coverageFrom } = ledger;
const { coverageCauses } = reviewRender;

const REPO = { host: 'github.com', id: '58' };
const modulePath = (i) => `src/part-${i}.js`;
const scratchPath = (i) => `scratch/draft-${i}.txt`;

/**
 * `count` windows, one per recorded compaction. Each holds a human instruction, the agent's words,
 * a write to a module the PR contains, a write to a scratch draft it does not, and both results.
 * M35 (windowing): a compaction no longer splits a window, so each segment also holds a long thought (150,000 bytes):
 * two segments no longer fit one combined review's window (54,613 tokens), and each is a window of its own.
 */
function windowedSession(count) {
  const blobs = {};
  const events = [];
  let sequence = 0;
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  for (let i = 1; i <= count; i++) {
    blobs[`ask${i}`] = `SYNTHETIC_D58_ASK_${i}: write part ${i} and keep a draft beside it.`;
    blobs[`said${i}`] = `SYNTHETIC_D58_SAID_${i}: writing part ${i} and its draft now.`;
    blobs[`module${i}`] = `export const SYNTHETIC_D58_PART_${i} = ${i};\n`;
    blobs[`draft${i}`] = `SYNTHETIC_D58_DRAFT_${i}\n`;
    blobs[`ok${i}`] = `SYNTHETIC_D58_OK_${i}: wrote 1 file.\n`;
    events.push({ id: `I${i}`, kind: 'instruction', sequence: sequence++, authority: 'human',
      text: whole(`ask${i}`), supersedes: [] });
    events.push({ id: `C${i}`, kind: 'commentary', sequence: sequence++, phase: 'working',
      text: whole(`said${i}`), beforeInvocation: `A${i}` });
    blobs[`fill${i}`] = `SYNTHETIC_D58_FILL_${i}: ${'f'.repeat(150_000)}`;
    events.push({ id: `F${i}`, kind: 'commentary', sequence: sequence++, phase: 'working', text: whole(`fill${i}`),
      beforeInvocation: null });
    for (const [id, path, body] of [[`A${i}`, modulePath(i), `module${i}`], [`S${i}`, scratchPath(i), `draft${i}`]]) {
      events.push({ id, kind: 'invocation', sequence: sequence++, callKey: id.toLowerCase(),
        tool: 'Write', operation: 'write', paths: [{ path }], command: [], input: [],
        changes: [{ path, before: [], after: whole(body), diff: [] }] });
      events.push({ id: `${id}-r`, kind: 'observation', sequence: sequence++, invocation: id,
        callKey: id.toLowerCase(), phase: 'terminal', result: 'succeeded', exitCode: 0,
        output: whole(`ok${i}`), sourceOfResult: 'native', terminalStatusProven: true });
    }
    if (i < count) events.push({ id: `B${i}`, kind: 'boundary', sequence: sequence++, boundary: 'compaction' });
  }
  return new Session({ sessionKey: 'sess-d58', adapter: 'claude', events, blobs });
}

const prOf = (count, over = {}) => ({ repo: REPO, number: 58, enumeration: 'complete',
  files: Array.from({ length: count }, (_, k) => ({ path: modulePath(k + 1), change: 'added', contentState: 'complete' })),
  ...over });

const ask = (i) => ({ eventId: `I${i}`, role: 'instruction', quote: `SYNTHETIC_D58_ASK_${i}` });
const said = (i) => ({ eventId: `C${i}`, role: 'commentary', quote: `SYNTHETIC_D58_SAID_${i}` });
const grounded = (i, action, path, dimension = `SYNTHETIC_D58_DIMENSION_${action}`) => ({
  dimension, chosen: `SYNTHETIC_D58_CHOSEN_${action}`, value: path,
  valueReceipt: { eventId: action, field: 'path', role: 'action', quote: path },
  actions: [action], stated: said(i), constrainedBy: { instruction: ask(i), settles: false, settledValueQuote: null },
});

// Words that must never reach a published row, a finding or the rendered report.
const NEVER = Object.freeze({
  decision: 'SYNTHETIC_D58_NEVER_SAID_DECISION', pivot: 'SYNTHETIC_D58_NEVER_SAID_PIVOT',
  requirement: 'SYNTHETIC_D58_WITHHELD_REQUIREMENT', claim: 'SYNTHETIC_D58_WITHHELD_CLAIM',
  unsettled: 'SYNTHETIC_D58_DIMENSION_UNSETTLED',
});

/**
 * Window 1 answers with one of each inconclusive outcome beside one fully grounded decision:
 *   decisions:0  grounded — published
 *   decisions:1  column and value undetermined — published with UNCHECKED cells
 *   decisions:2  its stated quote was never said — withheld (quote did not match)
 *   decisions:3  the challengers vote `uncertain` on it — withheld (could not settle)
 *   pivots:0, requirements:1, claims:0  quotes never said — withheld (quote did not match)
 *   requirements:0 grounded — published
 */
const inconclusiveNarrative = () => ({
  decisions: [
    grounded(1, 'A1', modulePath(1)),
    { dimension: 'SYNTHETIC_D58_DIMENSION_UNDETERMINED', chosen: 'SYNTHETIC_D58_CHOSEN_UNDETERMINED',
      value: null, valueReceipt: null, actions: ['S1'], stated: said(1), constrainedBy: null },
    { ...grounded(1, 'A1', modulePath(1), 'SYNTHETIC_D58_DIMENSION_WITHHELD'),
      stated: { eventId: 'C1', role: 'commentary', quote: NEVER.decision } },
    grounded(1, 'S1', scratchPath(1), NEVER.unsettled),
  ],
  pivots: [{ abandoned: 'SYNTHETIC_D58_ABANDONED', adopted: 'SYNTHETIC_D58_ADOPTED',
    receipts: [{ eventId: 'C1', role: 'commentary', quote: NEVER.pivot }] }],
  claims: [{ text: NEVER.claim, stated: { eventId: 'C1', role: 'commentary', quote: 'SYNTHETIC_D58_NEVER_SAID_CLAIM' },
    contradictedBy: null }],
  requirements: [
    { text: 'SYNTHETIC_D58_REQUIREMENT_1', status: 'open', instruction: ask(1) },
    { text: NEVER.requirement, status: 'open',
      instruction: { eventId: 'I1', role: 'instruction', quote: 'SYNTHETIC_D58_NEVER_ASKED' } },
  ],
});
const EMPTY = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

const windowOf = (label) => Number(/:w(\d+)/.exec(label ?? '')?.[1] ?? 0);
const supportVote = (key, window) => ({ key, verdict: 'not-refuted',
  explanation: 'The cited instruction asks for exactly this.', receipts: [ask(window)] });

/**
 * A reviewer. `narrative(window)` answers the narrative call; `uncertain({window, key})` names the
 * items every pass votes `uncertain` on; `omit({window, key, pass, reask})` the slots a reply leaves
 * out. Everything else gets a grounded support vote.
 */
function reviewer({ narrative = (w) => (w === 1 ? inconclusiveNarrative() : EMPTY()), uncertain = () => false,
  omit = () => false, calls = [] } = {}) {
  return async (request) => {
    const window = windowOf(request.label);
    calls.push(request.label);
    if (!request.challenge) return narrative(window);
    const { pass, reask = false } = request.challenge;
    return { votes: request.challenge.items.filter(({ key }) => !omit({ window, key, pass, reask }))
      .map(({ key, candidate }) => uncertain({ window, key, candidate })
        ? { key, verdict: 'uncertain', explanation: 'The supplied evidence does not settle this.', receipts: [] }
        : supportVote(key, window)) };
  };
}
const unsettledDecision = ({ candidate }) => candidate?.dimension === NEVER.unsettled;

/** Everything a report publishes as a row, a finding or a card, as one string. */
const published = (report) => JSON.stringify([report.decisions, report.findings, report.pivots ?? [],
  report.requirements ?? [], report.promises ?? []]);

// ---- challenge `complete` means executed ----------------------------------------------------

const session1 = windowedSession(1);
const items = ['i1', 'i2', 'i3', 'i4'].map((key) => ({ key, type: 'requirement', candidate: { text: key } }));
const exact = (r) => verifyReceipt(session1, r);
const answering = ({ omit = () => false, verdict = () => 'not-refuted', receipt = () => ask(1), fail = () => false } = {}) =>
  async (request) => {
    const { pass, reask = false } = request.challenge;
    if (fail({ pass, reask })) throw new Error('SYNTHETIC_D58_TRANSPORT_TEXT');
    return { votes: request.challenge.items.filter(({ key }) => !omit({ key, pass, reask }))
      .map(({ key }) => { const v = verdict({ key, pass, reask });
        return { key, verdict: v, explanation: 'Synthetic vote.', receipts: v === 'uncertain' ? [] : [receipt({ key, pass, reask })] }; }) };
  };

test('W3d-3 an item every challenger voted uncertain on is withheld and counted; the challenge completed', async () => {
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ verdict: ({ key }) => (key === 'i2' ? 'uncertain' : 'not-refuted') }) });
  assert.equal(result.complete, true, 'every planned call ran and voted on every item');
  assert.equal(result.executionComplete, true);
  assert.equal(result.unresolvedItems, 1, 'unresolvedItems is counted as before');
  assert.equal(result.unsettledItems, 1, 'and the unsettled item is counted as withheld');
  assert.deepEqual(result.survivors.map((s) => s.key), ['i1', 'i3', 'i4'], 'it is never published');
  const row = result.rejected.find((r) => r.key === 'i2');
  assert.equal(row.resolved, false);
  assert.equal(row.executionComplete, true, 'voted on — ran, inconclusive');
  assert.ok(result.results[1].votes.every((v) => v.answered === true));
});

test('W3d-3 a vote cast with a quote that did not verify is an answer: withheld, not unchecked', async () => {
  const result = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ receipt: ({ key }) => (key === 'i3' ? { ...ask(1), quote: 'SYNTHETIC_D58_NEVER_SAID' } : ask(1)) }) });
  assert.equal(result.complete, true);
  assert.equal(result.unsettledItems, 1);
  assert.ok(result.results[2].votes.every((v) => v.valid === false && v.reason === 'receipt_rejected' && v.answered === true));
  assert.equal(result.survivors.some((s) => s.key === 'i3'), false);
});

test('W3d-3 not run stays incomplete: omitted after the re-ask, a thrown call, a malformed reply, a budget stop', async () => {
  const omitted = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ omit: ({ key, pass }) => key === 'i3' && pass === 1 }) });
  assert.equal(omitted.reaskCalls, 1, 'premise: the one re-ask was spent');
  assert.equal(omitted.complete, false, 'a reply that left the item out even after the re-ask never ran on it');
  assert.equal(omitted.executionComplete, false);
  assert.equal(omitted.unsettledItems, 0, 'an item nobody voted on is not an inconclusive one');
  assert.equal(omitted.results[2].votes.find((v) => v.pass === 1).answered, false);

  const thrown = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: answering({ fail: ({ pass }) => pass === 2 }) });
  assert.equal(thrown.complete, false);
  assert.ok(!JSON.stringify(thrown).includes('SYNTHETIC_D58_TRANSPORT_TEXT'));

  const malformed = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: async (request) => (request.challenge.pass === 3 ? { votes: 'not an array' } : answering()(request)) });
  assert.equal(malformed.complete, false, 'an unreadable reply, even after its re-ask, is not an answer');

  const stopped = await challengeItems({ items, evidence: 'Synthetic evidence.', verifyReceipt: exact,
    judge: async (request) => {
      if (request.challenge.pass === 3) throw Object.assign(new Error('synthetic quota'), { code: 'budget_exhausted' });
      return answering()(request);
    } });
  assert.equal(stopped.complete, false);
  assert.equal(stopped.budgetExhausted, true);
});

// ---- grounding ran = grounded -------------------------------------------------------------

test('W3d-3 a window whose only shortfalls are inconclusive is grounded, counted, and publishes none of them', async () => {
  const report = await runReview({ session: session1, pr: prOf(1),
    judge: reviewer({ uncertain: unsettledDecision }) });
  const [w] = report.windowResults;
  assert.equal(w.failure, null);
  assert.equal(w.challenge.complete, true, 'the uncertain votes were cast');
  assert.equal(w.challenge.unsettledItems, 1);
  assert.equal(w.sessionGroundingComplete, true, 'grounding ran on a valid narrative');
  assert.equal(w.relevanceComplete, true);
  assert.equal(w.groundingComplete, true);
  assert.equal(w.shortfall.grounding.sessionGrounded, true);
  assert.equal(w.grounding.withheld, 4, 'a decision, a pivot, a requirement and a claim whose quotes did not match');
  assert.equal(w.grounding.uncheckedColumns, 1);
  assert.equal(w.grounding.uncheckedValues, 1);
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(honestStatuses({ ...report, codeCoverage: 'complete' }).reviewStatus, 'CLEAN');
  assert.deepEqual(report.withheld, { proposals: 4, unsettled: 1 });
  // Published: the grounded decision and the undetermined one (with its UNCHECKED cells), and the
  // grounded requirement. Nothing withheld is anywhere a reader could take it as a row or finding.
  assert.deepEqual(report.decisions.map((d) => d.dimension).sort(),
    ['SYNTHETIC_D58_DIMENSION_A1', 'SYNTHETIC_D58_DIMENSION_UNDETERMINED']);
  const undetermined = report.decisions.find((d) => d.dimension === 'SYNTHETIC_D58_DIMENSION_UNDETERMINED');
  assert.equal(undetermined.column, null);
  assert.equal(undetermined.columnState, 'unchecked');
  assert.equal(undetermined.valueState, 'unchecked');
  assert.deepEqual(report.requirements.map((r) => r.text), ['SYNTHETIC_D58_REQUIREMENT_1']);
  assert.deepEqual(report.pivots, []);
  assert.deepEqual(report.findings, []);
  for (const word of Object.values(NEVER)) assert.ok(!published(report).includes(word), `${word} was published`);
});

test('W3d-3 relevance unknown because the decision\'s own file is partial still leaves grounding incomplete', async () => {
  const report = await runReview({ session: session1, pr: prOf(1, { enumeration: 'partial' }),
    judge: reviewer({ narrative: () => ({ ...EMPTY(), decisions: [grounded(1, 'S1', scratchPath(1))] }) }) });
  const [w] = report.windowResults;
  assert.equal(w.sessionGroundingComplete, true);
  assert.equal(w.relevanceComplete, false, 'absent evidence, not an inconclusive check');
  assert.equal(w.groundingComplete, false);
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, 'UNCHECKED');
});

test('W3d-3 a proposal this code could not evaluate at all still caps: it is not an inconclusive check', async () => {
  // Schema-valid, so it reaches grounding — but a decision that cites no action is no_actions, not
  // a quote that failed to match. It stays a shortfall exactly as before.
  const report = await runReview({ session: session1, pr: prOf(1), judge: reviewer({ narrative: () => ({ ...EMPTY(),
    decisions: [{ ...grounded(1, 'A1', modulePath(1)), actions: [], value: null, valueReceipt: null }] }) }) });
  assert.equal(report.rejectedDecisions[0]?.reason, 'no_actions', 'premise');
  assert.equal(report.windowResults[0].groundingComplete, false);
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, 'UNCHECKED');
  // And a schema violation (a model-rated field) is an unreadable proposal, never a withheld one.
  const rated = await runReview({ session: session1, pr: prOf(1), judge: reviewer({ narrative: () => ({ ...EMPTY(),
    decisions: [{ ...grounded(1, 'A1', modulePath(1)), severity: 'high' }] }) }) });
  assert.equal(rated.windowResults[0].challenge.complete, false);
  assert.equal(rated.coverage, 'partial');
  assert.deepEqual(rated.withheld, { proposals: 0, unsettled: 0 });
});

test('W3d-3 a proposal citing a source its window was not shown is withheld before the challenge, not unchecked', async () => {
  const two = windowedSession(2);
  const report = await runReview({ session: two, pr: prOf(2), judge: reviewer({ narrative: (w) => (w === 2
    ? { ...EMPTY(), decisions: [grounded(2, 'A2', modulePath(2)), grounded(1, 'A1', modulePath(1))] } : EMPTY()) }) });
  const w2 = report.windowResults[1];
  assert.equal(w2.challenge.rejected.find((r) => r.key === 'decisions:1')?.reason, 'receipt_rejected', 'premise');
  assert.equal(w2.challenge.complete, true);
  assert.equal(w2.challenge.withheldProposals, 1);
  assert.equal(report.coverage, 'complete');
  assert.equal(report.withheld.proposals, 1);
  assert.deepEqual(report.decisions.map((d) => d.dimension), ['SYNTHETIC_D58_DIMENSION_A2']);
});

// ---- buildLedger, honestStatuses and codeCoverage -------------------------------------------

const facts = () => sessionCoverageFacts({ session: session1, windows: [{}],
  perWindow: [{ narrative: EMPTY(), challenge: { complete: true }, groundingComplete: true }] });
const ledgerOf = (candidates, pr = prOf(1)) => buildLedger({ repo: REPO, session: session1, pr, candidates,
  codeCoverage: 'complete', sessionCoverage: coverageFrom(facts()), coverageFacts: facts() });
const candidateOf = (d) => ({ ...d, actorSession: session1.sessionKey });

test('W3d-3 buildLedger: a decision whose quote did not match is withheld and does not cap coverage', () => {
  const report = ledgerOf([candidateOf(grounded(1, 'A1', modulePath(1))),
    candidateOf({ ...grounded(1, 'A1', modulePath(1), 'SYNTHETIC_D58_DIMENSION_WITHHELD'),
      stated: { eventId: 'C1', role: 'commentary', quote: NEVER.decision } })]);
  assert.equal(report.rejectedDecisions.length, 1);
  assert.equal(report.rejectedDecisions[0].reason, 'receipt_rejected');
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(honestStatuses(report).sessionStatus, 'CLEAN');
  assert.deepEqual(report.withheld, { proposals: 1, unsettled: 0 });
  assert.ok(!published(report).includes(NEVER.decision));
});

test('W3d-3 buildLedger: an undetermined column or value is shown UNCHECKED and does not cap coverage', () => {
  const report = ledgerOf([candidateOf({ dimension: 'SYNTHETIC_D58_DIMENSION_UNDETERMINED', chosen: 'x',
    value: null, valueReceipt: null, actions: ['A1'], stated: said(1), constrainedBy: null })]);
  assert.equal(report.decisions[0].columnState, 'unchecked');
  assert.equal(report.decisions[0].valueState, 'unchecked');
  assert.equal(report.decisions[0].relevance, 'survives');
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('W3d-3 buildLedger: unchecked relevance and an unevaluable proposal still cap coverage', () => {
  const relevance = ledgerOf([candidateOf(grounded(1, 'S1', scratchPath(1)))], prOf(1, { enumeration: 'partial' }));
  assert.equal(relevance.decisions[0].relevance, 'unchecked', 'premise');
  assert.equal(relevance.coverage, 'partial');
  const forged = ledgerOf([candidateOf({ ...grounded(1, 'A1', modulePath(1)), confidence: 0.9 })]);
  assert.equal(forged.rejectedDecisions[0].reason, 'kind_rejected', 'premise');
  assert.equal(forged.coverage, 'partial');
  assert.deepEqual(forged.withheld, { proposals: 0, unsettled: 0 });
});

test('W3d-3 honestStatuses agrees with buildLedger: one rule, recomputed from the report itself', () => {
  const COMPLETE = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, instructions: 1,
    instructionsElided: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: null };
  const base = { findings: [], decisions: [], rejectedDecisions: [], rejectedFindings: [], gaps: [],
    coverage: 'complete', coverageFacts: COMPLETE, codeCoverage: 'complete' };
  assert.equal(honestStatuses(base).sessionStatus, 'CLEAN', 'premise: nothing declared, nothing capped');
  // A report that says complete while one of its own rows could not be placed in the PR.
  assert.equal(honestStatuses({ ...base, decisions: [{ relevance: 'unchecked', columnState: 'grounded', valueState: 'grounded' }] }).coverage,
    'partial');
  // ... or while it carries a proposal no check could evaluate.
  assert.equal(honestStatuses({ ...base, rejectedDecisions: [{ reason: 'kind_rejected' }] }).coverage, 'partial');
  assert.equal(honestStatuses({ ...base, rejectedFindings: [{ reason: 'unreviewed_scope' }] }).coverage, 'partial');
  // A withheld proposal and an undetermined column do not.
  assert.equal(honestStatuses({ ...base, rejectedDecisions: [{ reason: 'receipt_rejected' }],
    decisions: [{ relevance: 'survives', columnState: 'unchecked', valueState: 'unchecked' }] }).sessionStatus, 'CLEAN');
  // And an inconclusive result never lifts a coverage a not-run cause capped.
  assert.equal(honestStatuses({ ...base, rejectedDecisions: [{ reason: 'receipt_rejected' }],
    coverageFacts: { ...COMPLETE, windowsFailed: 1 } }).coverage, 'partial');
});

// The code review: one frozen file and one code finding.
const GREET = 'src/greet.js';
const DIFF = ['diff --git a/src/greet.js b/src/greet.js', 'new file mode 100644', '--- /dev/null',
  '+++ b/src/greet.js', '@@ -0,0 +1,2 @@', '+const SYNTHETIC_D58_GREETING = "hello";', '+export default SYNTHETIC_D58_GREETING;', ''].join('\n');
const CODE_PR = { repo: REPO, number: 580, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40), headOid: 'a'.repeat(40),
  gitAlgorithm: 'sha1', enumeration: 'complete', files: [{ path: GREET, change: 'added', contentState: 'complete' }] };
const SOURCE = snapshotDiff({ pr: CODE_PR, diff: DIFF }).sources.find((s) => s.side === 'RIGHT' && s.text.includes('GREETING ='));
const codeReceipt = (quote) => ({ role: 'code', eventId: SOURCE.eventId, revisionOid: SOURCE.revisionOid, quote });
const codeFinding = (quote) => ({ origin: 'code-review', kind: 'code_issue', title: 'SYNTHETIC_D58_CODE_FINDING',
  explanation: 'The greeting is a literal in the module.', receipts: [codeReceipt(quote)], scope: 'current-code',
  anchor: { path: GREET, side: 'RIGHT', startLine: 1, endLine: 1 } });
const REAL_QUOTE = 'SYNTHETIC_D58_GREETING = "hello"';
const codeAnswer = (findings) => async (request) => {
  const base = { decisions: [], pivots: [], claims: [], requirements: [], sessionFindings: [] };
  // The one receipt-repair call returns nothing it can establish.
  if (/receipt-repair$/.test(request.label)) return { ...base, codeFindings: [], reviewedFiles: [] };
  return { ...base, codeFindings: findings, reviewedFiles: [GREET] };
};
const codeVotes = (verdict) => async ({ challenge }) => ({ votes: challenge.items.map(({ key }) => (verdict === 'uncertain'
  ? { key, verdict, explanation: 'Cannot tell from the frozen code.', receipts: [] }
  : { key, verdict, explanation: 'The literal is in the frozen code.', receipts: [codeReceipt(REAL_QUOTE)] })) });

test('W3d-3 codeCoverage: a code finding whose quote did not match is withheld and does not cap the code review', async () => {
  assert.ok(SOURCE, 'premise: the frozen change has a quotable source');
  const report = await runCodeReview({ pr: CODE_PR, diff: DIFF, judge: codeAnswer([codeFinding('SYNTHETIC_D58_NOT_IN_THE_CODE')]),
    challengeJudge: codeVotes('not-refuted') });
  assert.deepEqual(report.rejectedCodeFindings.map((r) => r.reason), ['receipt_rejected'], 'premise');
  assert.equal(report.codeCoverage, 'complete');
  assert.equal(report.codeStatus, 'CLEAN');
  assert.equal(report.withheld.proposals, 1);
  assert.equal(report.findings.length, 0);
});

test('a failed optional code receipt repair does not turn a checked rejection into unread code', async () => {
  const initial = codeAnswer([codeFinding('SYNTHETIC_D58_NOT_IN_THE_CODE')]);
  for (const repairFailure of ['model_timeout', 'model_output_limit', 'malformed']) {
    const judge = async (request) => {
      if (!/receipt-repair$/.test(request.label)) return initial(request);
      if (repairFailure === 'malformed') return { codeFindings: [] };
      throw Object.assign(new Error('synthetic optional repair failure'), { code: repairFailure });
    };
    const report = await runCodeReview({ pr: CODE_PR, diff: DIFF, judge });
    assert.deepEqual(report.rejectedCodeFindings.map((r) => r.reason), ['receipt_rejected']);
    assert.equal(report.withheld.proposals, 1);
    assert.equal(report.codeJudgment.attemptedCalls, 2);
    assert.equal(report.codeJudgment.usableResults, 1);
    assert.equal(report.codeCoverage, 'complete', repairFailure);
    assert.equal(report.codeStatus, 'CLEAN', repairFailure);
    assert.ok(!report.codeJudgment.reasons.includes('unreviewed_scope'));
  }
});

test('W3d-3 codeCoverage: a code finding the challengers could not settle is withheld; one whose challenge never ran caps', async () => {
  const unsettled = await runCodeReview({ pr: CODE_PR, diff: DIFF, judge: codeAnswer([codeFinding(REAL_QUOTE)]),
    challengeJudge: codeVotes('uncertain') });
  assert.equal(unsettled.codeChallenges[0].complete, true);
  assert.equal(unsettled.codeChallenges[0].unsettledItems, 1);
  assert.equal(unsettled.codeCoverage, 'complete');
  assert.equal(unsettled.codeStatus, 'CLEAN');
  assert.equal(unsettled.withheld.unsettled, 1);
  assert.equal(unsettled.findings.length, 0, 'never published');
  assert.ok(!published(unsettled).includes('SYNTHETIC_D58_CODE_FINDING'));

  const notRun = await runCodeReview({ pr: CODE_PR, diff: DIFF, judge: codeAnswer([codeFinding(REAL_QUOTE)]),
    challengeJudge: async () => { throw new Error('synthetic transport failure'); } });
  assert.equal(notRun.codeChallenges[0].complete, false);
  assert.equal(notRun.codeCoverage, 'partial');
  assert.equal(notRun.codeStatus, 'UNCHECKED');
  assert.equal(notRun.withheld.unsettled, 0);
});

// ---- the report says what was withheld -----------------------------------------------------

test('W3d-3 the report counts each inconclusive kind apart from what did not run', async () => {
  const report = await runReview({ session: session1, pr: prOf(1), judge: reviewer({ uncertain: unsettledDecision }) });
  assert.deepEqual(report.withheld, { proposals: 4, unsettled: 1 });
  assert.equal(report.decisions.filter((d) => d.column == null).length, 1, 'one decision whose authority is not checked');
  // The window's receipts that did not verify are counted with the inconclusive, not as unchecked.
  assert.ok(report.windowResults[0].shortfall.grounding.rejected > 0);
  assert.deepEqual(coverageCauses(report), [], 'no cause is named, because nothing failed to run');
  // D71 (a): the code review did not run, so Sonah's review is incomplete; the session review completed.
  assert.equal(ledger.reviewRunState(report), 'incomplete', 'premise: the code review did not run');
  assert.equal(report.sessionReview, 'complete');
  for (const word of Object.values(NEVER)) assert.ok(!published(report).includes(word), `${word} reached the report`);
});

test('W3d-3 the causes list only what did not run; the withheld counts stand beside them', async () => {
  const two = windowedSession(2);
  const report = await runReview({ session: two, pr: prOf(2), judge: async (request) => {
    if (!request.challenge && windowOf(request.label) === 2)
      throw Object.assign(new Error('synthetic transport failure'), { code: 'model_unavailable' });
    return reviewer({ uncertain: unsettledDecision })(request);
  } });
  assert.deepEqual(coverageCauses(report), [['windows_incomplete', { n: 1, m: 2 }]], 'only the window whose call failed');
  assert.equal(report.withheld.unsettled, 1);
  assert.equal(report.windowResults[1].shortfall.narrative, 'model_unavailable');
  assert.equal(report.sessionStatus, 'UNCHECKED');
});

// ---- caching follows -----------------------------------------------------------------------

// D60 (W3f-1): the window capsule these two pinned is gone; a stored answer is reused only for the
// same request bytes, and everything after it — grounding, the withheld counts — is re-derived.
async function answerStore(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-d58-answers-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cache = createAnswerCache(directory, { backend: 'synthetic', model: 'synthetic' });
  return { cache, review: (judge) => memoizeJudge(judge, cache) };
}

test('W3d-3 a window whose checks all ran is replayed with its withheld counts, and nothing is asked again', async (t) => {
  const { review } = await answerStore(t);
  const first = await runReview({ session: session1, pr: prOf(1), judge: review(reviewer({ uncertain: unsettledDecision })) });
  const [w] = first.windowResults;
  assert.equal(w.groundingComplete, true, 'premise');
  assert.equal(w.challenge.complete, true, 'premise');
  const calls = [];
  const replay = review(reviewer({ calls }));
  const again = await runReview({ session: session1, pr: prOf(1), judge: replay });
  assert.deepEqual(calls, [], 'nothing was asked again');
  assert.equal(replay.answers.calls, 0);
  assert.equal(again.windowResults[0].challenge.unsettledItems, 1, 'the unsettled count travels with the cached result');
  assert.deepEqual(again.withheld, first.withheld, 'and the withheld counts are the same answer');
  assert.equal(again.windowResults[0].grounding.withheld, 4);
  assert.equal(again.coverage, 'complete');
  assert.equal(again.sessionStatus, 'CLEAN');
  for (const word of Object.values(NEVER)) assert.ok(!published(again).includes(word), `${word} was published on reuse`);
});

test('W3d-3 a stored answer is never trusted: one whose quote no longer matches the record is withheld, never published', async (t) => {
  const { cache, review } = await answerStore(t);
  const asked = [];
  const inner = reviewer({ uncertain: unsettledDecision });
  const first = await runReview({ session: session1, pr: prOf(1),
    judge: review(async (request) => { asked.push(request); return inner(request); }) });
  // The stored answer to window 1's request is altered on disk: a quote that grounded no longer matches.
  const request = asked.find((r) => r.label === 'narrative:w1');
  const stored = await cache.get(request);
  stored.decisions.find((d) => d.dimension === 'SYNTHETIC_D58_DIMENSION_A1').stated.quote = 'SYNTHETIC_D58_CHANGED_SINCE';
  assert.equal(await cache.put(request, stored), true);
  const calls = [];
  const again = await runReview({ session: session1, pr: prOf(1), judge: review(reviewer({ calls, uncertain: unsettledDecision })) });
  assert.ok(!calls.includes('narrative:w1'), 'the stored answer was used, not re-asked');
  assert.ok(!published(again).includes('SYNTHETIC_D58_CHANGED_SINCE'), 'a quote the record does not hold is never published');
  assert.ok(!again.decisions.some((d) => d.dimension === 'SYNTHETIC_D58_DIMENSION_A1'), 'its decision is withheld');
  assert.ok(again.withheld.proposals > first.withheld.proposals, 'and counted as withheld');
});

// ---- the invariant suite -------------------------------------------------------------------

test('W3d-3 a window with only inconclusive items can be CLEAN, and counts what it withheld', async () => {
  const report = await runReview({ session: session1, pr: prOf(1), judge: reviewer({ uncertain: unsettledDecision }) });
  const joined = { ...report, codeCoverage: 'complete' };
  Object.assign(joined, honestStatuses(joined));
  assert.equal(joined.sessionStatus, 'CLEAN');
  assert.equal(joined.reviewStatus, 'CLEAN');
  // D71 (a): the review ran to completion; no reader shows the status token.
  assert.equal(ledger.reviewRunState(joined), 'complete');
  assert.deepEqual(joined.withheld, { proposals: 4, unsettled: 1 }, 'the withheld counts are kept beside it');
});

// M33 (C-06): the window ran and completed; the missing child is a declared recorder limit, not a
// check that did not run. That reads NO_FINDINGS — never CLEAN. Before M33 it read UNCHECKED.
test('W3d-3 the same, plus one declared recorder gap, is NO_FINDINGS, never CLEAN', async () => {
  const gapped = windowedSession(1);
  gapped.adapterGaps = [{ code: 'missing_child', channel: 'children', scope: 'session', eventIds: ['A1'], count: 1 }];
  const report = await runReview({ session: gapped, pr: prOf(1), judge: reviewer({ uncertain: unsettledDecision }) });
  const joined = { ...report, codeCoverage: 'complete' };
  Object.assign(joined, honestStatuses(joined));
  assert.equal(joined.windowResults[0].groundingComplete, true, 'premise: the window itself ran');
  assert.equal(joined.coverage, 'partial');
  assert.equal(joined.sessionStatus, 'NO_FINDINGS');
  assert.equal(joined.reviewStatus, 'NO_FINDINGS');
  assert.deepEqual(coverageCauses(joined).find(([cause]) => cause === 'delegations_unlinked'),
    ['delegations_unlinked', { n: 1 }]);
  assert.ok(joined.withheld.unsettled > 0, 'the withheld counts are still kept');
});

test('W3d-3 a challenge pass whose reply omitted an item even after the re-ask is UNCHECKED', async () => {
  const calls = [];
  const report = await runReview({ session: session1, pr: prOf(1), judge: reviewer({ calls,
    narrative: () => ({ ...EMPTY(), decisions: [grounded(1, 'A1', modulePath(1))] }),
    omit: ({ key, pass }) => key === 'decisions:0' && pass === 2 }) });
  assert.equal(calls.filter((l) => /reask/.test(l)).length, 1, 'premise: one re-ask, and it omitted the item too');
  assert.equal(report.windowResults[0].challenge.complete, false);
  assert.equal(report.decisions.length, 1, 'two grounded support votes still publish it');
  const joined = { ...report, codeCoverage: 'complete' };
  Object.assign(joined, honestStatuses(joined));
  assert.equal(joined.sessionStatus, 'UNCHECKED');
  assert.equal(joined.reviewStatus, 'UNCHECKED');
  assert.equal(joined.withheld.unsettled, 0, 'an item nobody could vote on is not an inconclusive one');
});

// ---- many windows, some replies omitting an item and some votes uncertain, as a regression guard -----

test('W3d-3 nine windows, 1 in 10 first replies omitting an item, 1 in 5 items voted uncertain: all complete', async () => {
  const COUNT = 9;
  const KEYS = ['decisions:0', 'decisions:1', 'requirements:0'];
  const s = windowedSession(COUNT);
  assert.equal(planWindows(s, COMBINED_WINDOW_SETTINGS).length, COUNT, 'premise: nine windows');
  const narrative = (i) => ({ ...EMPTY(), decisions: [grounded(i, `A${i}`, modulePath(i)), grounded(i, `S${i}`, scratchPath(i))],
    requirements: [{ text: `SYNTHETIC_D58_REQUIREMENT_${i}`, status: 'open', instruction: ask(i) }] });
  const index = (window, key) => (window - 1) * KEYS.length + KEYS.indexOf(key);
  const omit = ({ window, key, pass, reask }) => !reask && (index(window, key) * CHALLENGE_PROFILE.passes + pass - 1) % 10 === 9;
  const uncertain = ({ window, key }) => index(window, key) % 5 === 4;
  const pr = { ...prOf(COUNT), files: [...prOf(COUNT).files, { path: 'src/redacted.js', change: 'modified', contentState: 'partial' }] };
  const report = await runReview({ session: s, pr, judge: reviewer({ narrative, omit, uncertain }) });
  const complete = (w) => w.failure === null && w.challenge.complete === true && w.groundingComplete === true;
  assert.equal(report.windowResults.filter(complete).length, COUNT);
  assert.equal(report.challenge.unresolvedItems, 5);
  assert.deepEqual(report.withheld, { proposals: 0, unsettled: 5 });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.decisions.length + report.requirements.length, 3 * COUNT - 5, 'the five unsettled items are withheld');
});
