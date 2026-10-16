// The steps every reader reads (storyFacts): story /14 (owner decision D77 C), a step IS one of your messages — the events
// the review windows hold under that message, whichever windows hold them — so a review window packing two messages
// (D68 K: one window, two messages) is two steps, a message reviewed across several windows is one step, and a helper's
// work is in the step of the message that launched it, or that a follow-up delivered it under. The report model reads
// them for the messages Sonah did not review in full. D97: the page and the report .md no longer place a decision under
// its message, nor show a steps card or a step chart; those placements went with the story. Every string here is
// invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { storyFacts } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const ASK1 = 'Add pagination to GET /notes: a `limit` parameter and a `cursor` parameter for the next page.';
const ASK2 = 'Thanks. An invalid limit should return 400, and please document `limit` in docs/api.md.';

/**
 * One request, its work, a helper it launched, then a second request; the helper's work is recorded after it. Turns as
 * the recorder writes them: each request opens its own (the hand-off keeps request 1's), a helper's events carry its
 * own session's. Options: `early` records an action before your first request; `followUp` sends the helper a
 * follow-up under request 2, whose work it delivers (`deliveredBy`, as the adapter marks it); `queued` makes request 2 a
 * message you queued during request 1's turn, recorded before the hand-off (so the hand-off's turn, not its place,
 * names its request).
 */
function twoRequestSession({ early = false, followUp = false, queued = false } = {}) {
  const b = sessionBuilder();
  if (early) b.run('R0', 'git status', 'succeeded', 'clean');
  b.ask('I1', ASK1);
  b.say('C1', 'I will use the id of the last note as the cursor.');
  b.change('W1', 'src/routes/notes.js', { after: 'const DEFAULT_LIMIT = 20;\n' });
  b.run('R1', 'npm test', 'succeeded', 'ok');
  if (!queued) b.delegate('D1', 'Write the pagination tests', 'h1');
  b.ask('I2', ASK2);
  if (queued) b.delegate('D1', 'Write the pagination tests', 'h1');
  b.change('HW', 'test/pagination.test.js', { after: "test('first page', () => {});\n", childId: 'h1' });
  if (followUp) {
    b.delegate('D2', 'Also cover an invalid limit', 'h1', 'followup');
    b.change('HW2', 'test/pagination.test.js', { operation: 'edit', before: "test('first page', () => {});\n",
      after: "test('limit=0 is a 400', () => {});\n", childId: 'h1' });
  }
  b.change('W2', 'src/routes/notes.js', { operation: 'edit', before: 'const DEFAULT_LIMIT = 20;\n',
    after: 'if (!(limit >= 1)) return res.status(400).end();\n' });
  b.say('F1', 'Done.', 'final');
  let turn = 0;
  for (const event of b.events) {
    if (event.childId) { event.turn = 'child:h1:T1'; continue; }
    if (event.id === 'I2' && queued) event.markers = ['queued'];
    else if (event.kind === 'instruction' && event.authority === 'human') turn++;
    if (turn) event.turn = `T${turn}`;
  }
  for (const event of b.events) if (['HW2', 'HW2-r'].includes(event.id)) event.deliveredBy = 'D2';
  return { session: b.session(), ids: b.events.map((event) => event.id) };
}

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const unchecked = (n, dimension, actions, actorSession = STORY_KEY) => ({ actorSession, dimension, chosen: `choice ${n}`,
  value: null, valueReceipt: null, valueState: 'unchecked', actions, stated: null, constrainedBy: null,
  instructionReview: null, column: null, columnState: 'unchecked', amends: [], materiality: 'material',
  materialityRule: 'synthetic', relevance: 'unchecked', reasons: ['instructions_partial'],
  id: `sha256:${String(n).repeat(64)}` });

/** The review packed both requests into one window, as it does for a session this small. */
function oneWindowReport(ids) {
  return {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', sessionStatus: 'DECIDE', promptVersion: 'sonah.narrative/28',
    windowResults: [{ windowIndex: 0, eventIds: [...ids], failure: null, narrative: { requirements: [] } }],
    // Checklist rows (a session-only review's statuses), each read by the windows that hold its ask.
    requirements: [
      { instruction: receipt('instruction', 'I1', 'a `cursor` parameter for the next page'), text: 'A cursor parameter',
        status: 'not-checked', reason: 'deliverable_ungrounded' },
      { instruction: receipt('instruction', 'I2', 'please document `limit` in docs/api.md'), text: 'Document limit',
        status: 'not-checked', reason: 'deliverable_ungrounded' },
    ],
    decisions: [
      unchecked(1, 'cursor format', ['W1']),
      unchecked(2, 'invalid limit check', ['W2']),
      // The helper's: launched under request 1, its work recorded after request 2.
      unchecked(3, 'test layout', ['HW'], `${STORY_KEY}/child:h1`),
    ],
    findings: [], pivots: [], promises: [], writtenClaims: [], failures: [],
    counts: { decisions: 3, byColumn: { 'asked-settled': 0, 'asked-chose': 0, unasked: 0 }, uncheckedColumn: 3 },
  };
}
/** The same review over several windows: `lists` of event ids, each one window — complete as run-review.js records one
 *  (ledger.js `windowRecordComplete`), or failed for the ones in `failed`. */
function windowedReport(ids, lists, failed = []) {
  const report = oneWindowReport(ids);
  report.windowResults = lists.map((eventIds, windowIndex) => ({ windowIndex, eventIds, narrative: { requirements: [] },
    ...(failed.includes(windowIndex) ? { failure: 'judge_timeout' } : { failure: null, groundingComplete: true, challenge: { complete: true } }) }));
  return report;
}

/** The story's Mermaid blocks, as their lines (the overview first). */
const stepShape = (facts) => facts.steps.map((step) => [step.n, step.request, step.windows, step.events.map((e) => e.id)]);

test('an action recorded before your first message is in a step of its own, first, under no message', () => {
  const { session, ids } = twoRequestSession({ early: true });
  const facts = storyFacts(session, oneWindowReport(ids));
  assert.deepEqual(facts.steps.map((step) => [step.n, step.events[0].id, step.request]), [[1, 'R0', null], [2, 'I1', 1], [3, 'I2', 2]]);
});

test('a hand-off recorded after a message you queued in its turn keeps that turn\'s request', () => {
  // Request 2 was queued during request 1's turn and recorded before the hand-off: by its place the hand-off would be
  // request 2's; by its turn (the turn's first request, OWNER DECISION B) it is request 1's, as the helper line says.
  const { session, ids } = twoRequestSession({ queued: true });
  const facts = storyFacts(session, oneWindowReport(ids));
  // The helper's work is in request 1's step.
  assert.deepEqual(facts.steps.map((step) => [step.request, step.events.filter((e) => e.childId).map((e) => e.id)]),
    [[1, ['HW', 'HW-r']], [2, []]]);
});

// ---- story /14 (owner decision D77 C): a step is one of your requests --------------------------------------------

test('story /14: one window holding two requests is two steps, each under its own request', () => {
  const { session, ids } = twoRequestSession();
  const report = oneWindowReport(ids);
  const facts = storyFacts(session, report);
  // One step per request, both held by the one window; the helper's work (recorded after request 2's ask) is in request
  // 1's step, by the hand-off that launched it.
  assert.deepEqual(stepShape(facts), [
    [1, 1, [0], ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r', 'D1', 'HW', 'HW-r']],
    [2, 2, [0], ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.requirements.length]), [[1, 1], [2, 1]]);
});

test('story /14: a request reviewed across several windows is one step with those windows', () => {
  const { session, ids } = twoRequestSession();
  const cut = ids.indexOf('I2');
  // Request 1 cut into three windows (an oversized request), request 2 in a fourth, the helper's work in a window of its
  // own (M35: a helper is reviewed apart): one step per request, step 1 holding its four windows.
  const lists = [ids.slice(0, 4), ids.slice(4, 6), ids.slice(6, cut), ['I2', 'W2', 'W2-r', 'F1'], ['HW', 'HW-r']];
  assert.deepEqual(lists.flat().sort(), [...ids].sort(), 'every event is in exactly one window');
  const report = windowedReport(ids, lists);
  const facts = storyFacts(session, report);
  assert.deepEqual(stepShape(facts), [
    [1, 1, [0, 1, 2, 4], ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r', 'D1', 'HW', 'HW-r']],
    [2, 2, [3], ['I2', 'W2', 'W2-r', 'F1']]]);
  // The steps read exactly as the one packed window's do: the same events under the same messages.
  const packed = storyFacts(session, oneWindowReport(ids));
  assert.deepEqual(stepShape(facts).map(([n, request, , events]) => [n, request, events]),
    stepShape(packed).map(([n, request, , events]) => [n, request, events]));
});

test('story /14: work recorded before your first request is one step of its own, first', () => {
  const { session, ids } = twoRequestSession({ early: true });
  const facts = storyFacts(session, oneWindowReport(ids));
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request, step.events.map((e) => e.id)]), [
    [1, null, ['R0', 'R0-r']], [2, 1, ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r', 'D1', 'HW', 'HW-r']], [3, 2, ['I2', 'W2', 'W2-r', 'F1']]]);
});

test('story /14: a failed window fails every step it touches, and the page counts the steps', () => {
  const { session, ids } = twoRequestSession();
  const incomplete = (report) => Object.assign(report, { coverage: 'partial', sessionReview: 'incomplete',
    coverageFacts: { windows: report.windowResults.length, windowsFailed: report.windowResults.filter((w) => w.failure).length,
      actions: 4, reviewableEvents: 4 } });
  // One window, two requests, failed: both steps are not reviewed.
  const packed = incomplete(windowedReport(ids, [ids], [0]));
  assert.deepEqual(storyFacts(session, packed).steps.map((step) => step.failure), ['judge_timeout', 'judge_timeout']);
  // D97: the report counts the messages Sonah did not review in full, read from the same steps.
  assert.deepEqual(reportModel(session, packed, {}).header.didNotCheck.phrases.at(-1), '2 messages of yours in full');
  // Two windows, the second failed: it holds request 2's work and the helper's work of request 1, so both steps fail.
  const cut = ids.indexOf('I2');
  const both = incomplete(windowedReport(ids, [ids.slice(0, cut), ids.slice(cut)], [1]));
  assert.deepEqual(storyFacts(session, both).steps.map((step) => [step.windows, step.failure]),
    [[[0, 1], 'judge_timeout'], [[1], 'judge_timeout']]);
  // The helper's work in a window of its own: the failed window touches request 2 alone.
  const alone = incomplete(windowedReport(ids, [ids.slice(0, cut), ['I2', 'W2', 'W2-r', 'F1'], ['HW', 'HW-r']], [1]));
  assert.deepEqual(storyFacts(session, alone).steps.map((step) => [step.windows, step.failure]),
    [[[0, 2], null], [[1], 'judge_timeout']]);
  assert.ok(reportModel(session, alone, {}).notChecked.facts.some((f) => f.parts.map((p) => p.text).join('')
    === 'Sonah did not review 1 message of yours in full.'));
});

// D84 (4) c (owner decision 2026-10-12): a review that did not complete names the part of the session it did not fully
// review, read from the report's window results (the steps any of whose windows is incomplete), never by a count alone.
// D97: the report names it as your messages Sonah did not review in full; the steps card that linked them is gone.
test('D84 (4) c: the messages not fully reviewed are read from the window results', () => {
  const { session, ids } = twoRequestSession();
  const cut = ids.indexOf('I2');
  const alone = ['I2', 'W2', 'W2-r', 'F1'];
  const partial = (report) => Object.assign(report, { coverage: 'partial', sessionReview: 'incomplete',
    coverageFacts: { windows: report.windowResults.length, actions: 4, reviewableEvents: 4,
      windowsFailed: report.windowResults
        .filter((w) => w.failure || !w.challenge?.complete || !w.groundingComplete).length } });
  const notReviewed = (report) => reportModel(session, report, {}).notChecked.facts.map((f) => f.parts.map((p) => p.text)
    .join('')).find((line) => line.startsWith('Sonah did not review')) ?? null;
  // The window of request 2 alone ran, but its checks did not finish (no call failed): message 2 is not fully reviewed.
  const report = windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']]);
  report.windowResults[1].challenge = { complete: false };
  assert.equal(notReviewed(partial(report)), 'Sonah did not review 1 message of yours in full.');
  const both = windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']]);
  for (const w of [0, 1]) both.windowResults[w].challenge = { complete: false };
  assert.equal(notReviewed(partial(both)), 'Sonah did not review 2 messages of yours in full.');
  // Every window complete: no such line.
  assert.equal(notReviewed(windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']])), null);
});

test('story /14: a helper\'s work is in the step of the request that launched it, or that a follow-up delivered it under', () => {
  const { session, ids } = twoRequestSession({ followUp: true });
  const cut = ids.indexOf('I2');
  // The helper's two pieces of work reviewed in a window of their own, after both requests' windows.
  const own = ['HW', 'HW-r', 'HW2', 'HW2-r'];
  const report = windowedReport(ids, [ids.slice(0, cut), ids.slice(cut).filter((id) => !own.includes(id)), own]);
  const facts = storyFacts(session, report);
  // The first work is request 1's (its hand-off was launched under request 1); the follow-up's is request 2's.
  assert.deepEqual(facts.steps.map((step) => [step.request, step.windows, step.events.filter((e) => e.childId).map((e) => e.id)]),
    [[1, [0, 2], ['HW', 'HW-r']], [2, [1, 2], ['HW2', 'HW2-r']]]);
});
