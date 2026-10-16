// S6 (the fixes of the S5 review): each confirmed finding's structural fix, on synthetic
// recordings only (invented words; no recorded session's text).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { checkedRequirement, restsOnCheck, closingCoverage, notClaimsCheck, ROW_ID } from '../src/checklist.js';
import { actionOutcome, contradictionSourceOf, EVIDENCE_QUOTE_MAX, DISCLOSURE_QUOTE_MAX_CHARS, REQUIREMENT_UNCHECKED_REASONS,
  FAILURE_UNCHECKED_REASONS, PROMISE_UNCHECKED_REASONS, REQUIREMENT_FACTS, RESULT_OUTCOME_WORDS } from '../src/ledger.js';
import { DIGEST_PATTERN } from '../contracts/canonical.js';
import { SONAH_SESSION_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { renderSessionPage, PAGE_COLUMN_REASON_WORDS } from '../../render/session-page.js';
import { REPORT_SECTION_WORDS } from '../../render/report-words.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { REPORT_WHAT_WORDS } from '../../render/report-words.js';

const SIDECAR = (extra = {}) => ({ stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false, ...extra });
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const empty = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const of = (session, kind) => session.events.filter((event) => event.kind === kind);

/** A synthetic recording: an ask, a command run in the background (no terminal status), a command that ran to exit 0, and
 *  a closing message of three lines. */
const rows = () => [
  humanAsk('SYNTHETIC_S6: run the full suite and the lint, then tell me the result.'),
  call('t1', 'Bash', { command: 'npm test -- --all' }),
  result('t1', 'Command running in background with ID: b1', SIDECAR({ backgroundTaskId: 'b1' })),
  call('t2', 'Bash', { command: 'npm run lint' }),
  result('t2', 'SYNTHETIC_S6 lint: 0 problems', SIDECAR({ stdout: 'SYNTHETIC_S6 lint: 0 problems' })),
  said('SYNTHETIC_S6 line one: the suite is running.\nSYNTHETIC_S6 line two: the lint is clean.\nSYNTHETIC_S6 line three: thanks.'),
];

test('S6 H2: a done ask whose deliverable is an ACTION that never completed is not checked; one that ran keeps its status', async (t) => {
  const { session } = await load(t, rows());
  const { sourceMap } = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0];
  const [ask] = of(session, 'instruction');
  const [background, lint] = of(session, 'invocation');
  assert.equal(actionOutcome(session, background).class, 'no-terminal-status', 'premise');
  const row = (deliverable) => ({ text: 'run the suite', status: 'done', deliverable,
    instruction: quote(ask.id, 'instruction', 'run the full suite') });
  const lowered = checkedRequirement(session, row(quote(background.id, 'action', 'npm test -- --all')), { sourceMap });
  assert.deepEqual([lowered.candidate.status, lowered.reason], ['not-checked', 'check_not_completed']);
  const kept = checkedRequirement(session, row(quote(lint.id, 'action', 'npm run lint')), { sourceMap });
  assert.deepEqual([kept.candidate.status, kept.reason], ['done', null]);
  // The RESULT of the same run, cited as an observation, is refused the same way (D71 S2).
  const run = of(session, 'observation').find((event) => event.invocation === background.id);
  assert.equal(checkedRequirement(session, row(quote(run.id, 'observation', 'Command running in background')), { sourceMap }).reason,
    'check_not_completed');
});

test('S6 M1 (D59): an action\'s outcome is read only from results recorded at or before the window\'s end', async (t) => {
  const { session } = await load(t, rows());
  const { sourceMap } = planWindowRequests({ session, reviewScope: 'session-only' }).requests[0];
  const [ask] = of(session, 'instruction');
  const [, lint] = of(session, 'invocation');
  const lintResult = of(session, 'observation').find((event) => event.invocation === lint.id);
  assert.equal(actionOutcome(session, lint).class, 'output-no-status', 'premise: the whole recording shows its output');
  // A window that ended before its result was recorded was never shown it: no terminal status, as that window saw it.
  assert.equal(actionOutcome(session, lint, { until: lint.sequence }).class, 'no-terminal-status');
  assert.equal(actionOutcome(session, lint, { until: lintResult.sequence }).class, 'output-no-status');
  const unbounded = restsOnCheck(session, [lint.id], { sourceMap, anchor: ask });
  assert.deepEqual([unbounded.accepted, unbounded.rejected.completed], [[], 1]);
  const bounded = restsOnCheck(session, [lint.id], { sourceMap, anchor: ask, windowEnd: lint.sequence });
  assert.deepEqual([bounded.accepted, bounded.rejected.completed], [[lint.id], 0]);
  // A done row's ACTION deliverable is checked against the same bound.
  const row = { text: 'lint', status: 'done', instruction: quote(ask.id, 'instruction', 'run the full suite and the lint'),
    deliverable: quote(lint.id, 'action', 'npm run lint') };
  assert.equal(checkedRequirement(session, row, { sourceMap, windowEnd: lint.sequence }).reason, 'check_not_completed');
  assert.equal(checkedRequirement(session, row, { sourceMap, windowEnd: lintResult.sequence }).reason, null);
});

test('S6 M4: the closing message\'s lines no claim covers and those read as asserting nothing reach the report and its readers', async (t) => {
  const { session } = await load(t, rows());
  const [closing] = of(session, 'commentary').slice(-1);
  const plan = planWindowRequests({ session, reviewScope: 'session-only' });
  const notClaims = notClaimsCheck(session, plan.windows[0], [{ eventId: closing.id, lines: [3] }]);
  const coverage = closingCoverage(session, plan.windows[0],
    [{ stated: quote(closing.id, 'commentary', 'SYNTHETIC_S6 line two: the lint is clean.') }], notClaims.accepted);
  assert.deepEqual(coverage.map((c) => [c.unreviewed, c.listedLines, c.listed]), [[[1], [3], 1]]);
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: async (request) => (request.challenge
    ? { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [item.candidate?.stated ?? item.candidate?.instruction].filter(Boolean) })) }
    : { ...empty(), notClaims: [{ eventId: closing.id, lines: [3] }] }) });
  assert.deepEqual(report.windowResults.map((w) => w.closingLines),
    [[{ eventId: closing.id, unreviewed: [1, 2], listed: [3] }]]);
  const html = renderSessionPage(session, report, { sessionHash: 'a'.repeat(64) });
  // D97: the page lists them, folded, under the claims of What the agent did, each as recorded.
  const claims = html.slice(html.indexOf('id="did"'), html.indexOf('id="not-checked"'));
  assert.ok(claims.includes(REPORT_SECTION_WORDS.closingLines(3)));
  for (const line of ['SYNTHETIC_S6 line one: the suite is running.', 'SYNTHETIC_S6 line two: the lint is clean.',
    'SYNTHETIC_S6 line three: thanks.']) assert.ok(claims.includes(`<li><q class="said">${line}</q></li>`), line);
});

test('S6 H1: a claim and a decision whose own check did not settle are kept with their weakest status, and readers say why', async (t) => {
  const { session } = await load(t, rows());
  const [closing] = of(session, 'commentary').slice(-1);
  const [, lint] = of(session, 'invocation');
  const narrative = { ...empty(),
    claims: [{ text: 'clean lint', stated: quote(closing.id, 'commentary', 'SYNTHETIC_S6 line two: the lint is clean.') }],
    decisions: [{ dimension: 'check', chosen: 'lint the code', value: null, actions: [lint.id],
      stated: quote(closing.id, 'commentary', 'the lint is clean'), constrainedBy: null, instructionReview: null }] };
  const judge = (verdict) => async (request) => (request.challenge
    ? { votes: request.challenge.items.map((item) => ({ key: item.key, verdict, explanation: 'Synthetic.',
      receipts: verdict === 'refuted' ? [quote(lint.id, 'action', 'npm run lint')] : [] })) }
    : narrative);
  const unsure = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judge('uncertain') });
  assert.deepEqual(unsure.promises.map((p) => [p.status, p.reason]), [['open', 'challenge_unsettled']]);
  assert.deepEqual(unsure.decisions.map((d) => [d.column, d.columnState, d.reasons[0]]), [[null, 'unchecked', 'unsettled']]);
  assert.equal(unsure.claimsRejected, 0, 'a kept claim is not counted as left out');
  assert.ok(unsure.promises.some((p) => p.reason === 'challenge_unsettled'), 'the kept claim says why it is not checked');
  const html = renderSessionPage(session, unsure, { sessionHash: 'a'.repeat(64) });
  // The claim, listed, says why; the decision Sonah could not tie to an ask says why in its evidence.
  assert.ok(html.includes("The session review&#39;s own check on it did not settle."));
  assert.ok(html.includes(PAGE_COLUMN_REASON_WORDS.unsettled.replace(/'/g, '&#39;')));
  assert.equal(PAGE_COLUMN_REASON_WORDS.unsettled, "The session review's check on it did not settle.");
  // A refuted claim or decision is still left out: that is not unsure.
  const refuted = await runReview({ session, pr: null, reviewScope: 'session-only', judge: judge('refuted') });
  assert.deepEqual([refuted.promises.length, refuted.decisions.length], [0, 0]);
});

test('S6 L2: a contradiction from a human message, file content or the project\'s file quotes at most 120 characters', async (t) => {
  const long = `SYNTHETIC_S6 ${'x'.repeat(EVIDENCE_QUOTE_MAX)}`;
  const { session } = await load(t, [humanAsk(long), said('SYNTHETIC_S6 the opposite holds.')]);
  const [ask] = of(session, 'instruction');
  const [statement] = of(session, 'commentary');
  const verified = (text) => [quote(statement.id, 'commentary', 'the opposite holds.'), quote(ask.id, 'instruction', text)];
  assert.deepEqual(contradictionSourceOf(session, verified(long.slice(0, EVIDENCE_QUOTE_MAX))), { ok: true, source: 'human_message' });
  const over = contradictionSourceOf(session, verified(long.slice(0, EVIDENCE_QUOTE_MAX + 1)));
  assert.deepEqual([over.ok, over.reason, over.cause], [false, 'receipt_rejected', undefined]);
  assert.equal(DISCLOSURE_QUOTE_MAX_CHARS, EVIDENCE_QUOTE_MAX);
  assert.ok(SONAH_SESSION_REVIEW_AGENT.includes(`Quote 4 to ${EVIDENCE_QUOTE_MAX} characters`));
});

test('S6 L3, L6: reason tokens are named from their closed lists and the row id pattern has one home', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
  const tokens = [...new Set([...REQUIREMENT_UNCHECKED_REASONS, ...FAILURE_UNCHECKED_REASONS, ...PROMISE_UNCHECKED_REASONS,
    ...REQUIREMENT_FACTS])];
  for (const path of ['../src/checklist.js', '../src/run-review.js'])
    for (const token of tokens) assert.ok(!read(path).includes(`'${token}'`), `${path}: ${token} is a name, never inline`);
  assert.equal(ROW_ID, DIGEST_PATTERN);
  for (const path of ['../src/checklist.js', '../../render/session-page.js', '../../cli/src/decision-command.js',
    '../../cli/src/decision-reviews.js']) assert.ok(!read(path).includes('sha256:[0-9a-f]{64}'), `${path}: no second copy`);
});

test('S6 L4, L5, M5, L7: the report .md marks a decision not to act; the outcome words deny no typed fact; the brief says what code checks', async (t) => {
  const { session } = await load(t, rows());
  const [closing] = of(session, 'commentary').slice(-1);
  const decision = { id: `sha256:${'d'.repeat(64)}`, actorSession: session.sessionKey ?? 'm33-u', dimension: 'rerun',
    chosen: 'no rerun', value: null, valueReceipt: null, valueState: 'unchecked', actions: [], notActing: true,
    stated: quote(closing.id, 'commentary', 'the suite is running'), constrainedBy: null, instructionReview: null,
    column: 'unasked', columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic',
    relevance: 'unchecked', reasons: [] };
  // D97: a decision not to act is an item of its own kind, said in its own words.
  const story = renderReportMarkdown(session, { findings: [], decisions: [decision], reviewScope: 'session-only' });
  // R14: what it is about stands beside what the agent chose, each behind its own label.
  assert.ok(story.includes(`**1 Decide:** ${REPORT_WHAT_WORDS.notActingAbout} *rerun*. ${REPORT_WHAT_WORDS.notActingDecision} `
    + '*no rerun*.'), story);
  assert.equal(RESULT_OUTCOME_WORDS['output-no-status'].output, 'output recorded; no exit code or completion typed for it');
  // The column fix moved it once more (sonah.session-review-agent/8): who decided a decision (FIX_COLUMN_VERSIONS).
  // P1 (the asks fixes) moved it once more (sonah.session-review-agent/9): a run refused at every attempt.
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  // D84 re-wrapped the passage ("made without asking you" checks the shown project files too).
  for (const once of ['A choice not to act with no actions has no earliest action',
    // S7 re-wrapped the restsOn sentence (the brief names did not run or no terminal status only).
    "helper's ACTION is the helper's, never what the agent's claim rests on"])
    assert.equal(SONAH_SESSION_REVIEW_AGENT.split(once).length, 2, once);
  assert.ok(!SONAH_SESSION_REVIEW_AGENT.includes('five-step'));
});

test('S6 H1: across windows, a copy kept after an unsettled check never replaces one its own check upheld', async () => {
  const { mergeWindowOutputs } = await import('../src/run-review.js');
  const { CHALLENGE_ENDED } = await import('../src/ledger.js');
  const decision = { actorSession: 's', dimension: 'store', chosen: 'a store', value: null, actions: ['A1'], stated: null };
  const kept = { ...decision, [CHALLENGE_ENDED]: 'unsettled' };
  const merged = (first, second) => mergeWindowOutputs({ repo: { host: 'github.com', id: '1' }, perWindow: [
    { decisions: [first], findings: [], requirements: [], promises: [] },
    { decisions: [second], findings: [], requirements: [], promises: [] }] }).decisions;
  assert.equal(merged(kept, decision)[0][CHALLENGE_ENDED], undefined, 'a later upheld copy replaces the kept one');
  assert.equal(merged(decision, kept)[0][CHALLENGE_ENDED], undefined, 'a later kept copy never replaces an upheld one');
  const promise = { id: `sha256:${'e'.repeat(64)}`, text: 't', status: 'open', stated: quote('C1', 'commentary', 'words') };
  const lowered = { ...promise, reason: 'challenge_unsettled' };
  const promisesOf = (first, second) => mergeWindowOutputs({ repo: { host: 'github.com', id: '1' }, perWindow: [
    { decisions: [], findings: [], requirements: [], promises: [first] },
    { decisions: [], findings: [], requirements: [], promises: [second] }] }).promises;
  assert.equal(promisesOf(promise, lowered)[0].reason, undefined);
  assert.equal(promisesOf(lowered, promise)[0].reason, undefined);
});
