// D79 (owner decision 2026-10-11; story /15, page /16): a file you attached to a message belongs to that message's
// request — for the steps and for the request a decision or a row is shown under — read from the recorder's
// `attached` marker (the one human instruction windows.js `startsSegment` keeps with its message), never from the
// words. /14 read every human instruction event as a request, so one message with one attached file was two requests
// and two steps, and the work after the file was shown under the file. A reply to the agent's question stays a request
// of its own (D78). The attached file stays visible under its message. Every string here is invented.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionPage, PAGE_SENTENCES, PAGE_LABELS, PAGE_LIMITS } from '../session-page.js';
import { renderSessionStory, storyFacts, STORY_SENTENCES, STORY_LIMITS, clip } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { FOLDED_SECTION_WORDS } from '../../evidence/src/review.js';

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

const rowOf = (html, k) => {
  const from = html.indexOf(`id="decision-${k}"`);
  return html.slice(from, html.indexOf('</div></li>', from));
};
const requestCard = (html, k) => {
  const from = html.indexOf(`id="request-${k}"`);
  return from === -1 ? '' : html.slice(from, html.indexOf('</div></li>', from));
};
const textOf = (html) => html.replace(/<q class="said[^"]*">/g, '“').replace(/<\/q>/g, '”').replace(/<[^>]+>/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const stepShape = (facts) => facts.steps.map((step) =>
  [step.n, step.request, step.windows, step.events.map((e) => e.id)]);
const engineerOf = (story) => story.slice(story.indexOf('<a name="for-engineers">'));
/** A story section: from its heading to the next section's. */
const sectionOf = (story, mark) => { const at = story.indexOf(mark); const next = story.indexOf('\n## ', at + 1);
  return story.slice(at, next === -1 ? undefined : next); };
/** The story's Markdown escape of a backtick, as `md` writes it. */
const mdOf = (text) => text.replace(/`/g, '\\`');

test('D79: a message with an attached file is one request and one step; the file is shown under the message', () => {
  const { session, ids } = attachedSession();
  const report = oneWindowReport(ids);
  const facts = storyFacts(session, report);
  // One step per message: the attached file, and the work after it, are request 1's.
  assert.deepEqual(stepShape(facts), [
    [1, 1, [0], ['I1', 'I1F', 'C1', 'W1', 'W1-r', 'R1', 'R1-r']],
    [2, 2, [0], ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.attachments.map((a) => a.event.id), ask.steps]),
    [[1, 'I1', ['I1F'], [1]], [2, 'I2', [], [2]]]);
  assert.equal(facts.asks[0].attachments[0].text, FILE);
  // A requirement citing the attached file is its message's request's; the request has both of its rows.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.ask)), [['I1', 'I1F'], ['I2']]);
  // The step and the request agree by construction for every decision.
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step, x.request]),
    [['cursor format', 0, 1], ['docs section', 1, 2]]);
  for (const x of facts.decisions) assert.equal(facts.steps[x.step].request, x.request);

  const story = renderSessionStory(session, report);
  assert.match(story, /^Claude Code recording · 2 asks · 2 steps · /m);
  // For product: the message, then the file it carried, then its requirements (the file's among them). D88: the
  // product section comes after the leads', and an ask not checked is listed under What Sonah could not check.
  const product = sectionOf(story, '<a name="for-product">');
  assert.ok(product.includes(`**1. You asked:** ${mdOf(ASK1)}\n\n**${STORY_SENTENCES.youAttached}:** `
    + `${mdOf(clip(FILE, STORY_LIMITS.askChars))}\n\n`), product);
  assert.ok(product.includes(`_${FOLDED_SECTION_WORDS.here(2, 'ask')}_`), product);
  // The file's requirement, by the message's request; read by window, the one window holds both requests (steps 1–2).
  assert.ok(sectionOf(story, '## What Sonah could not check').includes('- You asked (request 1): "An invalid \\`limit\\` is a 400." '
    + '(steps 1–2)'), story);
  assert.ok(!product.includes('**3. You asked:**'), 'the file is no request of its own');
  // For engineers: the message's heading, the file under it, then step 1; no heading made of the file's words.
  const engineer = engineerOf(story);
  const order = ['### You: Add pagination', `**${STORY_SENTENCES.youAttached}:** Pagination spec.`, '<a name="step-1">',
    '### You: Thanks.', '<a name="step-2">'].map((mark) => engineer.indexOf(mark));
  assert.ok(order.every((at) => at !== -1) && order.every((at, i) => i === 0 || at > order[i - 1]), String(order));
  assert.ok(!engineer.includes('### You: Pagination spec.'));

  const html = renderSessionPage(session, report);
  assert.match(html, /Claude Code recording, 2 steps/);
  assert.equal(requestCard(html, 3), '', 'no third request');
  // The request card shows the message, then the file it carried, labelled; the file's requirement is its request's (D88:
  // not checked, so listed under What Sonah could not check, by its request, and counted on the card).
  const card = textOf(requestCard(html, 1));
  assert.ok(card.includes(`${PAGE_LABELS.youAsked} `), card);
  assert.ok(card.includes(`${PAGE_LABELS.youAttached} “${FILE}”`), card);
  assert.ok(card.includes(FOLDED_SECTION_WORDS.here(2, 'ask')), card);
  const folded = textOf(html.slice(html.indexOf('<details class="unchecked">')));
  assert.ok(folded.includes('“An invalid `limit` is a 400.” request 1'), folded);
  assert.ok(card.indexOf(PAGE_LABELS.youAttached) > card.indexOf('Add pagination'), 'the file comes after the message');
  // A decision after the attachment is shown under the message's request, with the message's words beside it.
  const row = rowOf(html, 1);
  assert.ok(textOf(row).toLowerCase().includes('cursor format'));
  assert.ok(textOf(row).includes(`${PAGE_LABELS.stepAsk} ${PAGE_SENTENCES.stepInstructions(1)} request 1`),
    textOf(row));
  assert.match(row, /<a class="more" href="#request-1">request 1<\/a>/);
  assert.match(row, /href="#step-1">step 1</);
  assert.match(rowOf(html, 2), /href="#request-2">request 2<\/a>/);
});

test('D79: the marker keeps the file with its message, never the words: the same text unmarked is a request', () => {
  const plain = attachedSession({ attached: false });
  const facts = storyFacts(plain.session, oneWindowReport(plain.ids));
  assert.equal(facts.steps.length, 3);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.attachments.length]),
    [[1, 'I1', 0], [2, 'I1F', 0], [3, 'I2', 0]]);
  assert.deepEqual(facts.decisions.map((x) => [x.d.dimension, x.step, x.request]),
    [['cursor format', 1, 2], ['docs section', 2, 3]]);
  assert.match(renderSessionStory(plain.session, oneWindowReport(plain.ids)),
    /^Claude Code recording · 3 asks · 3 steps · /m);
});

test('D78: a reply to the agent\'s question stays a request of its own, beside a message with an attached file', () => {
  const { session, ids } = attachedSession({ reply: true });
  const facts = storyFacts(session, oneWindowReport(ids));
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.event.id, ask.reply, ask.attachments.map((a) => a.event.id)]),
    [[1, 'I1', false, ['I1F']], [2, 'I2', true, []]]);
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request]), [[1, 1], [2, 2]]);
  const story = renderSessionStory(session, oneWindowReport(ids));
  assert.ok(engineerOf(story).includes('### You replied: Thanks.'));
  assert.ok(story.includes('**2. You replied:** Thanks.'));
});

test('D79: a long attached file is shown to the request bound and folded whole, as a long request is', () => {
  const { session, ids } = attachedSession({ file: LONG_FILE });
  assert.ok([...LONG_FILE].length > PAGE_LIMITS.askChars);
  const html = renderSessionPage(session, oneWindowReport(ids));
  const card = requestCard(html, 1);
  assert.match(card,
    new RegExp(`<p class="note attached"><span class="label">${PAGE_LABELS.youAttached}</span> <q class="said[^"]*">`));
  assert.ok(card.includes(`<summary>${PAGE_LABELS.wholeAttached}</summary>`), card);
  assert.ok(textOf(card).includes(LONG_FILE), 'the whole file is in the fold');
  // The story clips it to the request bound, with the cut marked.
  const story = renderSessionStory(session, oneWindowReport(ids));
  assert.match(story, new RegExp(`\\*\\*${STORY_SENTENCES.youAttached}:\\*\\* Pagination spec\\. [^\\n]*…\\n`));
});

test('D79: an attached file recorded before any message of yours belongs to no request, and stays visible', () => {
  const { session, ids } = attachedSession({ orphan: true });
  const report = oneWindowReport(ids, { fileId: 'I0F' });
  const facts = storyFacts(session, report);
  assert.deepEqual(facts.steps.map((step) => [step.n, step.request, step.events.map((e) => e.id)]), [
    [1, null, ['I0F']], [2, 1, ['I1', 'C1', 'W1', 'W1-r', 'R1', 'R1-r']], [3, 2, ['I2', 'W2', 'W2-r', 'F1']]]);
  assert.deepEqual(facts.asks.map((ask) => [ask.k, ask.attachments.length]), [[1, 0], [2, 0]]);
  assert.deepEqual(facts.unattached.map((a) => [a.event.id, a.text]), [['I0F', FILE]]);
  // A requirement citing it is no request's, so it is not listed; the message's own row still is.
  assert.deepEqual(facts.asks.map((ask) => ask.requirements.map((r) => r.ask)), [['I1'], ['I2']]);

  // Its words stay visible, before your requests: in the story's product section, and in the step of the work before
  // your first request (the step that holds it); never as a request heading of its own.
  const story = renderSessionStory(session, report);
  assert.match(story, /^Claude Code recording · 2 asks · 3 steps · /m);
  const line = `**${STORY_SENTENCES.youAttached}:** ${mdOf(clip(FILE, STORY_LIMITS.askChars))}\n\n`;
  const product = sectionOf(story, '<a name="for-product">');
  assert.ok(product.includes(`your requests\n\n${line}**1. You asked:** ${mdOf(ASK1)}`), product);
  const engineer = engineerOf(story);
  const order = [line, '<a name="step-1">', '### You: Add pagination', '<a name="step-2">']
    .map((mark) => engineer.indexOf(mark));
  assert.ok(order.every((at) => at !== -1) && order.every((at, i) => i === 0 || at > order[i - 1]), String(order));
  assert.ok(!engineer.includes('### You: Pagination spec.'));

  const html = renderSessionPage(session, report);
  const requests = html.slice(html.indexOf('<section class="part" id="requests">'),
    html.indexOf('</section>', html.indexOf('<section class="part" id="requests">')));
  assert.ok(textOf(requests).includes(`${PAGE_LABELS.youAttached} “${FILE}”`), textOf(requests));
  assert.ok(requests.indexOf(PAGE_LABELS.youAttached) < requests.indexOf('id="request-1"'), 'before request 1');
  assert.ok(!textOf(requestCard(html, 1)).includes(PAGE_LABELS.youAttached), 'no request holds it');
});

test('D79: a finding quoting the attached file concerns its message\'s request, both ways', () => {
  const { session, ids } = attachedSession();
  const report = { ...oneWindowReport(ids), sessionStatus: 'FYI',
    findings: [{ origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'The limit check',
      receipts: [receipt('instruction', 'I1F', 'An invalid `limit` is a 400.'),
        receipt('commentary', 'C1', 'I will read the attached spec first')] }] };
  const html = renderSessionPage(session, report);
  const from = html.indexOf('id="finding-1"');
  const finding = html.slice(from, html.indexOf('</div></li>', from));
  assert.match(finding, /<span class="label">Concerns<\/span> <a href="#request-1">request 1<\/a>/);
  // The request's row citing the same words links back to the finding (D88: the row is not checked, so it is listed under
  // What Sonah could not check, with its request).
  const folded = html.slice(html.indexOf('<details class="unchecked">'));
  assert.match(folded, /<a href="#request-1">request 1<\/a>[\s\S]*<span class="label">Cited in<\/span> <a href="#finding-1">finding 1<\/a>/);
});
