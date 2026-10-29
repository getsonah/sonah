// D170 (B1; the owner, 2026-10-28: "with the title rule"): the report's title is never taken from a reply, a message that
// answers the agent's question (its recorded link to that question, `answerTo`, the slicer's `answer` marker from the
// AskUserQuestion sidecar). A reply answers the agent, so it does not say what the session was for; Claude Code also
// writes its own placeholder answer there when the person skipped the question. The reply's asks are listed as before.
// Structure only: the reply's link, never its words. Every session and text here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, titleOf } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_HEADER_WORDS } from '../report-words.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const ask = (id, quote) => ({ text: quote, status: 'not-checked',
  instruction: { role: 'instruction', eventId: id, quote, sessionKey: STORY_KEY } });
/** A session of these messages (`[id, text, reply, quote]`), the agent's question before each reply; one ask per
 *  message, quoting `quote` (its first sentence when none is given). */
function sessionOf(messages) {
  const b = sessionBuilder();
  for (const [id, text, reply] of messages) {
    if (reply) b.say(`Q-${id}`, 'Which option do you want?');
    b.ask(id, text);
  }
  b.say('F1', 'Done.', 'final');
  for (const event of b.events) {
    const message = messages.find(([id]) => id === event.id);
    if (message?.[2]) { event.markers = ['answer']; event.answerTo = `Q-${event.id}`; }
  }
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete',
    requirements: messages.map(([id, text, , quote]) => ask(id, quote ?? text.split('.')[0])) };
  return { session, report };
}

test('D170: a reply before your next message is not the title; your message is', () => {
  const { session, report } = sessionOf([['I1', 'Use the second option. It is faster.', true],
    ['I2', 'Now add a test for the parser. Then run it.', false]]);
  const model = reportModel(session, report, {});
  assert.equal(model.header.title.text, 'Now add a test for the parser.');
  // The reply is still one of your messages, with its ask.
  assert.deepEqual(model.prompt.messages.map((m) => [m.k, m.reply]), [[1, true], [2, false]]);
  assert.equal(model.prompt.asks.length, 2);
  assert.ok(renderSessionPage(session, report, {}).includes('<title>Now add a test for the parser.</title>'));
  assert.ok(renderReportMarkdown(session, report, {}).startsWith('## Sonah review · “Now add a test for the parser.”'));
});

test('D170: with your first message before the reply, the title is as before', () => {
  const { session, report } = sessionOf([['I1', 'Fix the parser. Thanks.', false],
    ['I2', 'Use the second option.', true]]);
  assert.equal(reportModel(session, report, {}).header.title.text, 'Fix the parser.');
});

test('D170: when only replies hold an ask, the report has no title of your words', () => {
  const { session, report } = sessionOf([['I1', 'Use the second option. It is faster.', true]]);
  const model = reportModel(session, report, {});
  assert.equal(model.header.title, null);
  assert.equal(model.prompt.messages.length, 1);
  assert.ok(renderSessionPage(session, report, {}).includes(`<title>${REPORT_HEADER_WORDS.review}</title>`));
  assert.ok(renderReportMarkdown(session, report, {}).startsWith(`## ${REPORT_HEADER_WORDS.review}\n`));
  // A title the caller gives is kept, reply or not.
  assert.equal(reportModel(session, report, { title: 'Parser work' }).header.title.text, 'Parser work');
});

// D170's review (findings 1, 2 and 7): no reply is the title wherever it sits, and a wrapper's line never stands in for
// the person's words that only a reply holds.
const WRAPPED = '<pasted_text>\nRename the parser module everywhere.\n</pasted_text>';
const title = (messages) => {
  const { session, report } = sessionOf(messages);
  return reportModel(session, report, {}).header.title?.text ?? null;
};

test('D170 (review): no reply is the title, wherever it sits before your message', () => {
  // Two replies before your message.
  assert.equal(title([['I1', 'Use the second option.', true], ['I2', 'Yes, go on.', true],
    ['I3', 'Now add a test. Then run it.', false]]), 'Now add a test.');
  // A message whose words are all inside a wrapper, then a reply, then your message.
  assert.equal(title([['I1', WRAPPED, false, 'Rename the parser module everywhere'],
    ['I2', 'Use the second option. It is faster.', true], ['I3', 'Now add a test. Then run it.', false]]),
  'Now add a test.');
  // A reply between two of your messages: the first of yours.
  assert.equal(title([['I1', 'Fix the parser. Thanks.', false], ['I2', 'Use the second option.', true],
    ['I3', 'Now add a test.', false]]), 'Fix the parser.');
});

test('D170 (review): when only a reply holds words typed outside a wrapper, there is no title; never the wrapper\'s line',
  () => {
    const { session, report } = sessionOf([['I1', WRAPPED, false, 'Rename the parser module everywhere'],
      ['I2', 'Use the second option. It is faster.', true]]);
    const model = reportModel(session, report, {});
    assert.equal(model.header.title, null);
    assert.equal(model.prompt.messages.length, 2);
    assert.ok(renderSessionPage(session, report, {}).includes(`<title>${REPORT_HEADER_WORDS.review}</title>`));
    assert.ok(renderReportMarkdown(session, report, {}).startsWith(`## ${REPORT_HEADER_WORDS.review}\n`));
    // The reply first, then the wrapped message: the same.
    assert.equal(title([['I1', 'Use the second option. It is faster.', true],
      ['I2', WRAPPED, false, 'Rename the parser module everywhere']]), null);
    // No message, reply or not, has such words: the first message that is no reply is read as before (D132).
    assert.equal(title([['I1', WRAPPED, false, 'Rename the parser module everywhere'],
      ['I2', '<pasted_text>\nThe second one.\n</pasted_text>', true, 'The second one']]), '<pasted_text>');
    // titleOf by itself: the replies are read only for whether one has such words, never for the title.
    assert.equal(titleOf([[WRAPPED]], [['Use the second option.']]), null);
    assert.equal(titleOf([[WRAPPED]], [['<x>\ny\n</x>']])?.text, '<pasted_text>');
    assert.equal(titleOf([[WRAPPED], ['Typed words. More.']], [['Use the second option.']])?.text, 'Typed words.');
    assert.equal(titleOf([], [['Use the second option.']]), null);
    assert.equal(titleOf([[WRAPPED]])?.text, '<pasted_text>', 'with no replies given, as D132');
  });
