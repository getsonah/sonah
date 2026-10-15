// A decision the review could not check is shown beside the instructions of the request it was made under, read from
// the event that places it, never from its step. Story /14 (owner decision D77 C): a step IS one of your requests — the
// events the review windows hold under that request, whichever windows hold them — so a review window packing two
// requests (D68 K: one window, two requests) is two steps, a request reviewed across several
// windows is one step, and a decision's step and its request agree for your own work. Every string here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_SENTENCES, PAGE_LABELS } from '../session-page.js';
import { renderSessionStory, storyFacts } from '../session-story.js';
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

/** A decision's whole row: it holds a list of its own, so it ends at the row's own close. */
const rowOf = (html, k) => {
  const from = html.indexOf(`id="decision-${k}"`);
  return html.slice(from, html.indexOf('</div></li>', from));
};
const textOf = (html) => html.replace(/<q class="said[^"]*">/g, '“').replace(/<\/q>/g, '”').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/\s+/g, ' ');
/** The steps card's rows, as a reader reads them. */
const stepRows = (html) => [...html.matchAll(/<li class="turn-row[^"]*" id="step-(\d+)">[\s\S]*?<\/li>/g)].map((m) => textOf(m[0]).trim());
/** The story's Mermaid blocks, as their lines (the overview first). */
const charts = (story) => [...story.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1].split('\n').map((line) => line.trim()));
const stepShape = (facts) => facts.steps.map((step) => [step.n, step.request, step.windows, step.events.map((e) => e.id)]);

test('one window, two requests: a decision it could not check sits beside the request it was made under', () => {
  const { session, ids } = twoRequestSession();
  const report = oneWindowReport(ids);
  const facts = storyFacts(session, report);
  // Each decision read under its own request, in the step of that request (story /14: the window is two steps, one per
  // request; the helper's work, recorded after request 2, is request 1's by the hand-off that launched it).
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step, x.request]),
    [['cursor format', 0, 1], ['invalid limit check', 1, 2], ['test layout', 0, 1]]);
  for (const x of facts.decisions) assert.equal(facts.steps[x.step].request, x.request, `${x.d.dimension}: its step is its request's`);
  const html = renderSessionPage(session, report);
  const expected = { 'cursor format': 1, 'invalid limit check': 2, 'test layout': 1 };
  const words = { 1: '“a `cursor` parameter for the next page”', 2: '“please document `limit` in docs/api.md”' };
  for (let k = 1; k <= 3; k++) {
    const row = rowOf(html, k);
    const dimension = Object.keys(expected).find((name) => textOf(row).toLowerCase().includes(name));
    assert.ok(dimension, `decision ${k} is one of the three`);
    const request = expected[dimension];
    assert.ok(textOf(row).includes(`${PAGE_LABELS.stepAsk} ${PAGE_SENTENCES.stepInstructions(request)} request ${request} ${words[request]}`),
      `${dimension}: beside request ${request}`);
    assert.match(row, new RegExp(`<a class="more" href="#request-${request}">request ${request}</a>`));
    assert.doesNotMatch(textOf(row), new RegExp(words[3 - request].replace(/[.*+?^${}()|[\]\\`]/g, '\\$&')));
  }
});

/** A decision row that names no request: the sentence says so of the decision, and no instruction or request is shown. */
const assertNoRequest = (row) => {
  assert.ok(textOf(row).includes(PAGE_SENTENCES.stepNoRequest), 'no request of yours comes before it');
  assert.equal(PAGE_SENTENCES.stepNoRequest.includes('step'), false, 'said of the decision, never of its step');
  assert.doesNotMatch(row, /href="#request-/);
  assert.equal(textOf(row).includes(PAGE_LABELS.stepAsk), false);
};

test('a decision placed by no event of the review has no request, whatever its step would say', () => {
  const { session, ids } = twoRequestSession();
  const report = oneWindowReport(ids);
  report.decisions = [unchecked(4, 'unplaced', ['nowhere'])];
  const [x] = storyFacts(session, report).decisions;
  assert.equal(x.step, null);
  assert.equal(x.request, null);
  assertNoRequest(rowOf(renderSessionPage(session, report), 1));
});

test('a decision on an action recorded before your first request has no request, and sits in the step before them', () => {
  const { session, ids } = twoRequestSession({ early: true });
  const report = oneWindowReport(ids);
  report.decisions = [unchecked(5, 'repository check', ['R0'])];
  const facts = storyFacts(session, report);
  const [x] = facts.decisions;
  assert.equal(x.request, null);
  // Story /14: the work before your first request is a step of its own, first, under no request.
  assert.deepEqual(facts.steps.map((step) => [step.n, step.events[0].id, step.request]), [[1, 'R0', null], [2, 'I1', 1], [3, 'I2', 2]]);
  assert.equal(x.step, 0);
  assertNoRequest(rowOf(renderSessionPage(session, report), 1));
});

test('a helper\'s work a follow-up delivered under request 2 is request 2\'s; its first work stays request 1\'s', () => {
  const { session, ids } = twoRequestSession({ followUp: true });
  const report = oneWindowReport(ids);
  report.decisions = [unchecked(3, 'test layout', ['HW'], `${STORY_KEY}/child:h1`),
    unchecked(6, 'invalid limit test', ['HW2'], `${STORY_KEY}/child:h1`)];
  assert.deepEqual(storyFacts(session, report).decisions.map((x) => [x.d.dimension, x.request]),
    [['test layout', 1], ['invalid limit test', 2]]);
  const html = renderSessionPage(session, report);
  const shown = [1, 2].map((k) => textOf(rowOf(html, k)));
  const row = (name) => shown.find((text) => text.toLowerCase().includes(name));
  assert.ok(row('test layout').includes(PAGE_SENTENCES.stepInstructions(1)));
  assert.ok(row('invalid limit test').includes(PAGE_SENTENCES.stepInstructions(2)));
});

test('a hand-off recorded after a message you queued in its turn keeps that turn\'s request', () => {
  // Request 2 was queued during request 1's turn and recorded before the hand-off: by its place the hand-off would be
  // request 2's; by its turn (the turn's first request, OWNER DECISION B) it is request 1's, as the helper line says.
  const { session, ids } = twoRequestSession({ queued: true });
  const report = oneWindowReport(ids);
  const facts = storyFacts(session, report);
  assert.deepEqual(facts.helpers.map((h) => h.request), [1]);
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.request]),
    [['cursor format', 1], ['invalid limit check', 2], ['test layout', 1]]);
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
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.start, ask.steps]), [[1, 0, [1]], [2, 1, [2]]]);
  assert.deepEqual(facts.steps.map((step) => step.asksStarting.map((ask) => ask.k)), [[1], [2]]);
  assert.deepEqual(facts.helpers.map((h) => [h.spawnStep, h.request]), [[0, 1]]);
  // A requirement read by window: the one window holds both requests, so request 1's runs from its own step to the
  // window's last step, and request 2's never starts before request 2.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.steps)), [[[1, 2]], [[2, 2]]]);

  const html = renderSessionPage(session, report);
  assert.match(html, /Claude Code recording, 2 steps/);
  const rows = stepRows(html);
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^step 1 .* Request 1 · 2 decisions Helper: Write the pagination tests$/);
  assert.match(rows[1], /^step 2 .* Request 2 · 1 decision$/);
  assert.ok(textOf(html).includes(PAGE_SENTENCES.allReviewed(2)));
  // Every row links the step of its own request.
  const decisionRows = [1, 2, 3].map((k) => rowOf(html, k));
  assert.match(decisionRows.find((row) => textOf(row).toLowerCase().includes('invalid limit check')), /href="#step-2">step 2</);
  for (const name of ['cursor format', 'test layout'])
    assert.match(decisionRows.find((row) => textOf(row).toLowerCase().includes(name)), /href="#step-1">step 1</);
  assert.match(html.slice(html.indexOf('id="request-2"')), /^[^]*?<a href="#step-2">step 2<\/a>/);

  const story = renderSessionStory(session, report);
  assert.match(story, /^Claude Code recording · 2 asks · 2 steps · /m);
  // The engineer section: each request's heading, then its own step; no heading left empty.
  const engineer = story.slice(story.indexOf('<a name="for-engineers">'));
  const order = ['### You: Add pagination', '<a name="step-1">', '### You: Thanks.', '<a name="step-2">']
    .map((mark) => engineer.indexOf(mark));
  assert.ok(order.every((at) => at !== -1) && order.every((at, i) => i === 0 || at > order[i - 1]), String(order));
  // The overview: request 1, its step, request 2, its step.
  const [overview] = charts(story);
  for (const edge of ['A1 --> S1', 'S1 --> A2', 'A2 --> S2']) assert.ok(overview.includes(edge), edge);
  assert.ok(!overview.includes('A1 --> A2'));
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
  assert.deepEqual(facts.asks.map((ask) => ask.steps), [[1], [2]]);
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step]), [['cursor format', 0], ['invalid limit check', 1], ['test layout', 0]]);
  // A requirement read by window: request 1's windows all map to step 1; request 2's to step 2.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.steps)), [[[1, 1]], [[2, 2]]]);
  // The steps read exactly as the one packed window's do: the same events under the same requests, the same engineer
  // section; only a requirement's steps, read by window, differ (the packed window held both requests).
  const packedReport = oneWindowReport(ids);
  const packed = storyFacts(session, packedReport);
  assert.deepEqual(stepShape(facts).map(([n, request, , events]) => [n, request, events]),
    stepShape(packed).map(([n, request, , events]) => [n, request, events]));
  const story = renderSessionStory(session, report), packedStory = renderSessionStory(session, packedReport);
  const engineerOf = (text) => text.slice(text.indexOf('<a name="for-engineers">'));
  assert.equal(engineerOf(story), engineerOf(packedStory));
  // D88: an ask not checked is listed under What Sonah could not check, by its request.
  assert.ok(story.includes('- You asked (request 1): "a \\`cursor\\` parameter for the next page" (step 1) — why not checked: '));
  assert.ok(packedStory.includes('- You asked (request 1): "a \\`cursor\\` parameter for the next page" (steps 1–2) — why not checked: '));
  assert.match(renderSessionPage(session, report), /Claude Code recording, 2 steps/);
});

test('story /14: work recorded before your first request is one step of its own, first', () => {
  const { session, ids } = twoRequestSession({ early: true });
  const report = oneWindowReport(ids);
  report.decisions = [unchecked(5, 'repository check', ['R0']), unchecked(1, 'cursor format', ['W1'])];
  const facts = storyFacts(session, report);
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request, step.events.map((e) => e.id)]), [
    [1, null, ['R0', 'R0-r']], [2, 1, ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r', 'D1', 'HW', 'HW-r']], [3, 2, ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => ask.start), [1, 2]);
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step, x.request]), [['repository check', 0, null], ['cursor format', 1, 1]]);
  const html = renderSessionPage(session, report);
  assert.match(html, /Claude Code recording, 3 steps/);
  const rows = stepRows(html);
  assert.match(rows[0], /^step 1 Ran 1 command 1 decision$/, 'under no request');
  assert.match(rows[1], /^step 2 .* Request 1 · 1 decision Helper/);
  // The story: the step before the first request is listed before any request's heading, and charted with no step
  // chart of its own (the sentence under the overview says so).
  const story = renderSessionStory(session, report);
  assert.match(story, /^Claude Code recording · 2 asks · 3 steps · /m);
  const engineer = story.slice(story.indexOf('<a name="for-engineers">'));
  assert.ok(engineer.indexOf('<a name="step-1">') < engineer.indexOf('### You: Add pagination'));
  assert.equal(charts(story).length, 3, 'the overview and one step chart per request');
});

test('story /14: a failed window fails every step it touches, and the page counts the steps', () => {
  const { session, ids } = twoRequestSession();
  const incomplete = (report) => Object.assign(report, { coverage: 'partial', sessionReview: 'incomplete',
    coverageFacts: { windows: report.windowResults.length, windowsFailed: report.windowResults.filter((w) => w.failure).length,
      actions: 4, reviewableEvents: 4 } });
  // One window, two requests, failed: both steps are not reviewed.
  const packed = incomplete(windowedReport(ids, [ids], [0]));
  assert.deepEqual(storyFacts(session, packed).steps.map((step) => step.failure), ['judge_timeout', 'judge_timeout']);
  const text = textOf(renderSessionPage(session, packed));
  assert.ok(text.includes(PAGE_SENTENCES.stepsNotReviewed(2, 2)), 'both steps are not reviewed');
  assert.ok(text.includes('2 of 2 steps were not fully reviewed'), 'the cause is said in steps, not in the one window');
  assert.ok(!text.includes('1 of 1 step'));
  // Two windows, the second failed: it holds request 2's work and the helper's work of request 1, so both steps fail.
  const cut = ids.indexOf('I2');
  const both = incomplete(windowedReport(ids, [ids.slice(0, cut), ids.slice(cut)], [1]));
  assert.deepEqual(storyFacts(session, both).steps.map((step) => [step.windows, step.failure]),
    [[[0, 1], 'judge_timeout'], [[1], 'judge_timeout']]);
  assert.ok(textOf(renderSessionPage(session, both)).includes('2 of 2 steps were not fully reviewed'));
  // The helper's work in a window of its own: the failed window touches request 2 alone.
  const alone = incomplete(windowedReport(ids, [ids.slice(0, cut), ['I2', 'W2', 'W2-r', 'F1'], ['HW', 'HW-r']], [1]));
  assert.deepEqual(storyFacts(session, alone).steps.map((step) => [step.windows, step.failure]),
    [[[0, 2], null], [[1], 'judge_timeout']]);
  const one = textOf(renderSessionPage(session, alone));
  assert.ok(one.includes(PAGE_SENTENCES.stepsNotReviewed(1, 2)));
  assert.ok(one.includes('1 of 2 steps was not fully reviewed'));
  const story = renderSessionStory(session, alone);
  assert.match(story, /\| did not complete · 1 of 2 steps not reviewed \|/);
});

// D84 (4) c (owner decision 2026-10-12): a review that did not complete names the part of the session it did not fully
// review, read from the report's window results (the steps any of whose windows is incomplete), never by a count alone.
test('D84 (4) c: the steps not fully reviewed are named from the window results, linked, with their rows', () => {
  const { session, ids } = twoRequestSession();
  const cut = ids.indexOf('I2');
  const alone = ['I2', 'W2', 'W2-r', 'F1'];
  const partial = (report) => Object.assign(report, { coverage: 'partial', sessionReview: 'incomplete',
    coverageFacts: { windows: report.windowResults.length, actions: 4, reviewableEvents: 4,
      windowsFailed: report.windowResults
        .filter((w) => w.failure || !w.challenge?.complete || !w.groundingComplete).length } });
  const notCovered = (html) => textOf(html).replace(/ ([,.])/g, '$1')
    .match(/Not covered ([^.]*)\./)?.[1].trim() ?? null;
  // The window of request 2 alone ran, but its checks did not finish (no call failed): step 2 is not fully reviewed.
  const report = windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']]);
  report.windowResults[1].challenge = { complete: false };
  report.decisions = [unchecked(1, 'cursor format', ['W1']), unchecked(2, 'invalid limit check', ['W2'])];
  const html = renderSessionPage(session, partial(report));
  assert.equal(notCovered(html), '1 of 2 steps was not fully reviewed: step 2, which holds decision 2 and request 2');
  assert.match(html,
    /not fully reviewed: <a href="#step-2">step 2<\/a>, which holds <a href="#decision-2">decision 2<\/a>/);
  assert.ok(!textOf(html).includes(PAGE_LABELS.stepsNotReviewed), 'no call failed, so no step is said not reviewed');
  // A failed window names its steps in both lines: not reviewed, and not fully reviewed.
  const failed = partial(windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']], [1]));
  const text = textOf(renderSessionPage(session, failed)).replace(/ ([,.])/g, '$1');
  assert.ok(text.includes(`${PAGE_SENTENCES.stepsNotReviewed(1, 2)} step 2.`));
  assert.match(notCovered(renderSessionPage(session, failed)), /^1 of 2 steps was not fully reviewed: step 2/);
  // Both steps not fully reviewed: several steps "hold" their rows, one "holds" them.
  const both = windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']]);
  for (const w of [0, 1]) both.windowResults[w].challenge = { complete: false };
  both.decisions = report.decisions;
  assert.equal(notCovered(renderSessionPage(session, partial(both))), '2 of 2 steps were not fully reviewed: '
    + 'steps 1–2, which hold decision 1, decision 2, request 1 and request 2');
  // Every window complete: no such line, and the steps are said reviewed.
  const whole = windowedReport(ids, [ids.slice(0, cut), alone, ['HW', 'HW-r']]);
  assert.equal(notCovered(renderSessionPage(session, whole)), null);
  assert.ok(textOf(renderSessionPage(session, whole)).includes(PAGE_SENTENCES.allReviewed(2)));
});

test('story /14: a helper\'s work is in the step of the request that launched it, or that a follow-up delivered it under', () => {
  const { session, ids } = twoRequestSession({ followUp: true });
  const cut = ids.indexOf('I2');
  // The helper's two pieces of work reviewed in a window of their own, after both requests' windows.
  const own = ['HW', 'HW-r', 'HW2', 'HW2-r'];
  const report = windowedReport(ids, [ids.slice(0, cut), ids.slice(cut).filter((id) => !own.includes(id)), own]);
  report.decisions = [unchecked(3, 'test layout', ['HW'], `${STORY_KEY}/child:h1`),
    unchecked(6, 'invalid limit test', ['HW2'], `${STORY_KEY}/child:h1`)];
  const facts = storyFacts(session, report);
  // The first work is request 1's (its hand-off was launched under request 1); the follow-up's is request 2's.
  assert.deepEqual(facts.steps.map((step) => [step.request, step.windows, step.events.filter((e) => e.childId).map((e) => e.id)]),
    [[1, [0, 2], ['HW', 'HW-r']], [2, [1, 2], ['HW2', 'HW2-r']]]);
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step, x.request]), [['test layout', 0, 1], ['invalid limit test', 1, 2]]);
  for (const x of facts.decisions) assert.equal(facts.steps[x.step].request, x.request);
  // The helper is listed once, in the step of the request that launched it; its files are counted there.
  assert.deepEqual(facts.helpers.map((h) => [h.spawnStep, h.request, h.files]), [[0, 1, 1]]);
  assert.deepEqual(facts.steps.map((step) => step.helpers.length), [1, 0]);
  const html = renderSessionPage(session, report);
  const rows = stepRows(html);
  assert.match(rows[0], /Request 1 · 1 decision Helper: Write the pagination tests$/);
  assert.match(rows[1], /Request 2 · 1 decision$/);
  // The files card names the helper's file with both steps that changed it.
  assert.match(html.slice(html.indexOf('id="files"')), /test\/pagination\.test\.js<\/code> <span class="mono">[^<]*<\/span> <span class="pill">helper<\/span> <span class="turn"><a href="#step-1">steps 1–2<\/a>/);
});
