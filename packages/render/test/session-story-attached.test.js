// D79 (owner decision 2026-10-11; story /15, page /16): a file you attached to a message belongs to that message's
// request — for the steps and for the request a decision or a row is shown under — read from the recorder's
// `attached` marker (the one human instruction windows.js `startsSegment` keeps with its message), never from the
// words. /14 read every human instruction event as a request, so one message with one attached file was two requests
// and two steps, and the work after the file was shown under the file. A reply to the agent's question stays a request
// of its own (D78). D97: the page and the report .md (the story since /32) say, by count, that you attached a file, and
// list an ask whose words are in it under its message; the file's words are not shown. Every string here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage } from '../session-page.js';
import { reportModel } from '../report-model.js';
import { REPORT_PROMPT_WORDS } from '../report-words.js';
import { renderReportMarkdown, storyFacts } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const ASK1 = 'Add pagination to GET /notes as the attached spec says: a `limit` parameter and a `cursor` parameter.';
const FILE = 'Pagination spec. Every list endpoint takes `limit` (1 to 100, default 20) and `cursor` (the id of the '
  + 'last item of the previous page). An invalid `limit` is a 400. The response carries `nextCursor`, null on the last '
  + 'page.';
const ASK2 = 'Thanks. Now please document `limit` in docs/api.md.';
/** A file long enough for the page to fold it as it folds a long request. */
const LONG_FILE = `${FILE} ${'The spec repeats this sentence to be long. '.repeat(8)}`.trim();

/**
 * One message with a file attached to it (the recorder's `attached` marker, in the message's turn), the work after it,
 * then a second message; one review window holds it all. Options: `file` the attached file's text; `attached: false`
 * records the same text as a plain message (no marker); `reply` makes the second message your answer to a question the
 * agent asked (D78: a request of its own); `orphan` records the attached file before any message of yours.
 */
function attachedSession({ file = FILE, attached = true, reply = false, orphan = false } = {}) {
  const b = sessionBuilder();
  if (orphan) b.ask('I0F', file);
  b.ask('I1', ASK1);
  if (!orphan) b.ask('I1F', file);
  b.say('C1', 'I will read the attached spec first.');
  b.change('W1', 'src/routes/notes.js', { after: 'const DEFAULT_LIMIT = 20;\n' });
  b.run('R1', 'npm test', 'succeeded', 'ok');
  b.ask('I2', ASK2);
  b.change('W2', 'docs/api.md', { after: '## limit\n' });
  b.say('F1', 'Done.', 'final');
  let turn = 0;
  for (const event of b.events) {
    if (['I1F', 'I0F'].includes(event.id)) { if (attached) event.markers = ['attached']; }
    else if (event.kind === 'instruction' && event.authority === 'human') turn++;
    if (event.id === 'I2' && reply) { event.markers = ['answer']; event.answerTo = 'C1'; }
    event.turn = `T${Math.max(turn, 1)}`;
  }
  return { session: b.session(), ids: b.events.map((event) => event.id) };
}

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const unchecked = (n, dimension, actions) => ({ actorSession: STORY_KEY, dimension, chosen: `choice ${n}`,
  value: null, valueReceipt: null, valueState: 'unchecked', actions, stated: null, constrainedBy: null,
  instructionReview: null, column: null, columnState: 'unchecked', amends: [], materiality: 'material',
  materialityRule: 'synthetic', relevance: 'unchecked', reasons: ['instructions_partial'],
  id: `sha256:${String(n).repeat(64)}` });

/** The review packed everything into one window; its checklist rows cite the message, the attached file and
 *  request 2. */
function oneWindowReport(ids, { fileId = 'I1F' } = {}) {
  return {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only', codeCoverage: 'missing',
    coverage: 'complete', sessionReview: 'complete', sessionStatus: 'DECIDE', promptVersion: 'sonah.narrative/28',
    windowResults: [{ windowIndex: 0, eventIds: [...ids], failure: null, narrative: { requirements: [] } }],
    requirements: [
      { instruction: receipt('instruction', 'I1', 'a `limit` parameter and a `cursor` parameter'),
        text: 'Two parameters', status: 'not-checked', reason: 'deliverable_ungrounded' },
      { instruction: receipt('instruction', fileId, 'An invalid `limit` is a 400.'), text: 'Invalid limit is a 400',
        status: 'not-checked', reason: 'deliverable_ungrounded' },
      { instruction: receipt('instruction', 'I2', 'document `limit` in docs/api.md'), text: 'Document limit',
        status: 'not-checked', reason: 'deliverable_ungrounded' },
    ],
    // A decision on the work after the attached file, and one under request 2.
    decisions: [unchecked(1, 'cursor format', ['W1']), unchecked(2, 'docs section', ['W2'])],
    findings: [], pivots: [], promises: [], writtenClaims: [], failures: [],
    counts: { decisions: 2, byColumn: { 'asked-settled': 0, 'asked-chose': 0, unasked: 0 }, uncheckedColumn: 2 },
  };
}

const textOf = (html) => html.replace(/<q class="said[^"]*">/g, '“').replace(/<\/q>/g, '”').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const stepShape = (facts) => facts.steps.map((step) =>
  [step.n, step.request, step.windows, step.events.map((e) => e.id)]);


test('D79: a message with an attached file is one request and one step; the file is shown under the message', () => {
  const { session, ids } = attachedSession();
  const report = oneWindowReport(ids);
  const facts = storyFacts(session, report);
  // One step per message: the attached file, and the work after it, are request 1's.
  assert.deepEqual(stepShape(facts), [
    [1, 1, [0], ['I1', 'I1F', 'C1', 'W1', 'W1-r', 'R1', 'R1-r']],
    [2, 2, [0], ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.attachments.map((a) => a.event.id)]),
    [[1, 'I1', ['I1F']], [2, 'I2', []]]);
  // A requirement citing the attached file is its message's request's; the request has both of its rows.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.ask)), [['I1', 'I1F'], ['I2']]);

  // The report .md: two messages, the first saying you attached a file; the ask in the file is in the prompt table,
  // said to be found in a file you attached; the file's words are not shown.
  const story = renderReportMarkdown(session, report);
  assert.equal(story.split('<details><summary>Your whole message').length - 1, 2, 'the file is no message of its own');
  assert.ok(story.includes(REPORT_PROMPT_WORDS.attached(1)));
  // A balanced single-backtick span of your words is a code span (session-story.js `backtickPieces`).
  assert.ok(story.includes(`| Not checked | “An invalid \`limit\` is a 400.” | ${REPORT_PROMPT_WORDS.fromAttached} `), story);
  assert.equal(story.includes('Pagination spec.'), false, 'the file itself is not shown');

  // The page (D97): one message holds the file, said by count; the ask in the file listed under it, in your words.
  const html = renderSessionPage(session, report);
  const model = reportModel(session, report, {});
  assert.deepEqual(model.prompt.messages.map((m) => [m.k, m.attached, m.attachedAsks]), [[1, 1, [2]], [2, 0, []]]);
  // D131: your prompt follows Must act and Must know, and comes before Good to know. D133 (R2): no coverage sentence
  // under the message (said once, in the legend).
  const prompt = textOf(html.slice(html.indexOf('id="prompt"'), html.indexOf('id="did"')));
  assert.ok(prompt.includes(`${REPORT_PROMPT_WORDS.attached(1)} `
    + `${REPORT_PROMPT_WORDS.fromAttached} ask 2 · Not checked · `
    + '“An invalid limit is a 400.”'), prompt);
  assert.ok(html.includes('An invalid <code>limit</code> is a 400.'));
  assert.equal(prompt.includes('Pagination spec.'), false, 'the file itself is not shown');
});

test('D79: the marker keeps the file with its message, never the words: the same text unmarked is a request', () => {
  const plain = attachedSession({ attached: false });
  const facts = storyFacts(plain.session, oneWindowReport(plain.ids));
  assert.equal(facts.steps.length, 3);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.attachments.length]),
    [[1, 'I1', 0], [2, 'I1F', 0], [3, 'I2', 0]]);
  // D97: the report .md shows three messages.
  assert.equal(renderReportMarkdown(plain.session, oneWindowReport(plain.ids)).split('<details><summary>Your whole message')
    .length - 1, 3);
});

test('D78: a reply to the agent\'s question stays a request of its own, beside a message with an attached file', () => {
  const { session, ids } = attachedSession({ reply: true });
  const facts = storyFacts(session, oneWindowReport(ids));
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.reply, ask.attachments.map((a) => a.event.id)]),
    [[1, 'I1', false, ['I1F']], [2, 'I2', true, []]]);
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request]), [[1, 1], [2, 2]]);
  assert.deepEqual(reportModel(session, oneWindowReport(ids), {}).prompt.messages.map((m) => [m.k, m.reply]),
    [[1, false], [2, true]]);
});

test('D79: a long attached file is counted, never shown, on the page and in the report .md', () => {
  const { session, ids } = attachedSession({ file: LONG_FILE });
  assert.ok([...LONG_FILE].length > 280);
  // The page shows no word of the file, only that you attached it.
  const html = renderSessionPage(session, oneWindowReport(ids));
  assert.equal(html.includes('The spec repeats this sentence'), false);
  assert.ok(textOf(html).includes(REPORT_PROMPT_WORDS.attached(1)));
  const story = renderReportMarkdown(session, oneWindowReport(ids));
  assert.equal(story.includes('The spec repeats this sentence'), false);
  assert.ok(story.includes(REPORT_PROMPT_WORDS.attached(1)));
});

test('D79: an attached file recorded before any message of yours belongs to no request', () => {
  const { session, ids } = attachedSession({ orphan: true });
  const report = oneWindowReport(ids, { fileId: 'I0F' });
  const facts = storyFacts(session, report);
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request, step.events.map((e) => e.id)]), [
    [1, null, ['I0F']], [2, 1, ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r']], [3, 2, ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.attachments.length]), [[1, 0], [2, 0]]);
  assert.deepEqual(facts.unattached.map((a) => a.event.id), ['I0F']);
  // A requirement citing it is no request's, so it is not listed; the message's own row still is.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.ask)), [['I1'], ['I2']]);

  // The page: no message holds it; the ask citing it is no request's, so Sonah could not read it (counted).
  const model = reportModel(session, report, {});
  assert.deepEqual(model.prompt.messages.map((m) => m.attached), [0, 0]);
  assert.equal(model.notChecked.unreadAsks.length, 1);
});

test('D79: a finding quoting the attached file concerns its message\'s request, both ways', () => {
  const { session, ids } = attachedSession();
  const report = { ...oneWindowReport(ids), sessionStatus: 'FYI',
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'The limit check',
      receipts: [receipt('instruction', 'I1F', 'An invalid `limit` is a 400.'),
        receipt('commentary', 'C1', 'I will read the attached spec first')] }] };
  // The page (D97): the finding is an item quoting the agent's words; the ask whose words it quotes is under message 1.
  const model = reportModel(session, report, {});
  const item = model.tiers.good_to_know.find((x) => x.kind === 'claim_corrected');
  assert.equal(item.quote.text, 'I will read the attached spec first');
  assert.deepEqual(model.prompt.messages[0].attachedAsks, [2]);
});
