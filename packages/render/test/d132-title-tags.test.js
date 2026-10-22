// D132 (R3 a, and its review's finding 3): the title is the first words you typed outside any wrapper, never a line
// that is only a markup tag nor the words a wrapper holds. The lines that open a message with an ask and are each one
// markup tag (`<name …>`, `</name …>`, `<name …/>`) are left out, with the block an opening tag holds through the line
// that closes it; a later span that opens with a tag line ends your words; a message with no words outside a wrapper
// gives way to the next message with an ask; when none has any, the first message is read as before. Structure only:
// no tag name is listed. Every session and text here is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, titleOf } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

/** The title of one message of these spans; `titles` of several messages, each its spans. */
const title = (...spans) => titleOf([spans])?.text ?? null;
const titles = (...messages) => titleOf(messages)?.text ?? null;

test('D132: a first line that is one markup tag is not the title; the block it opens is left out with it', () => {
  // A paste the harness wraps, then your typed words: the title is your words.
  assert.equal(title('<pasted_content id="p1">\nThe pasted log. More of it.\n</pasted_content id="p1">\n\nFix the parser. '
    + 'Then run the tests.'), 'Fix the parser.');
  // Any name, any attributes: the rule reads the line's form, never its name.
  assert.equal(title('<zz-made-up a="1" b=\'2\'>\nwrapped words\n</zz-made-up>\nAdd a test.'), 'Add a test.');
  assert.equal(title('<note>\n<inner>\nx\n</inner>\n</note>\n  Ship it.'), 'Ship it.');
  // The block ends at the closing line of its own name, not at another tag's.
  assert.equal(title('<a>\n</b>\nwords inside a\n</a>\nThe title.'), 'The title.');
  // Two blocks one after the other, and a self-closing tag line.
  assert.equal(title('<a>\nfirst\n</a>\n<b>\nsecond\n</b>\nThe words.'), 'The words.');
  assert.equal(title('<br/>\nHello there.'), 'Hello there.');
  // An opening tag that no line closes: that line alone is left out.
  assert.equal(title('<div class="x">\nunclosed block. More.'), 'unclosed block.');
  // A block in its own span: the next span gives the title.
  assert.equal(title('<wrap>\nheld\n</wrap>', 'Second span words.'), 'Second span words.');
  // A later span that opens with a tag line ends your words: the wrapper and what it holds are not joined to them.
  assert.equal(title('First words', '<pasted_content id="p2">\npasted\n</pasted_content>'), 'First words');
  assert.equal(title('First words', 'more of them. Then.'), 'First words … more of them.');
});

test('D132: only the opening lines are read; a tag inside your words, or a message of tags alone, is as before', () => {
  assert.equal(title('Use <b>bold</b> here. And more.'), 'Use <b>bold</b> here.');
  assert.equal(title('Keep this line.\n<tag>\nlater\n</tag>'), 'Keep this line.');
  assert.equal(title('<b>bold</b> first. Then.'), '<b>bold</b> first.', 'a line with words beside the tag is your words');
  assert.equal(title('<b>bold</b> first\nSecond line.'), '<b>bold</b> first', 'it is never left out');
  assert.equal(title('   Plain first words. Second.'), 'Plain first words.');
  // Nothing but wrappers, in the only message: read as before R3 (a); the words inside a wrapper are never the title.
  assert.equal(title('<pasted_content id="p1">\nOnly pasted words here.\n</pasted_content>'), '<pasted_content id="p1">');
  assert.equal(title('<system-reminder>\nharness words\n</system-reminder>\n<pasted_content id="p1">\npasted\n'
    + '</pasted_content>'), '<system-reminder>');
  assert.equal(title('<x>\n</x>'), '<x>');
  assert.equal(title(), null);
  assert.equal(titles(), null);
});

test('D132 (review, finding 3): a first message of wrappers alone gives way to the next message with typed words', () => {
  const wrapped = '<system-reminder>\nharness words. More\n</system-reminder>\n<pasted_content id="p1">\npasted\n</pasted_content>';
  assert.equal(titles([wrapped], ['Now fix the parser. Then test it.']), 'Now fix the parser.');
  assert.equal(titles([wrapped], ['<x>\ny\n</x>'], ['Third message words.']), 'Third message words.');
  // The first message with typed words wins, even when a later one has some too.
  assert.equal(titles(['First typed.'], ['Second typed.']), 'First typed.');
  // No message has words outside a wrapper: the first message, as before.
  assert.equal(titles([wrapped], ['<x>\ny\n</x>']), '<system-reminder>');
});

test('D132: the page and the .md show the title by the same rule', () => {
  const b = sessionBuilder();
  b.ask('I1', '<pasted_content id="p1">\nA pasted spec line.\n</pasted_content id="p1">\nAdd rate limiting to the API.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete', requirements: [{ text: 'rate limiting', status: 'not-checked',
      instruction: { role: 'instruction', eventId: 'I1', quote: 'Add rate limiting to the API', sessionKey: STORY_KEY } }] };
  const model = reportModel(session, report, {});
  assert.equal(model.header.title.text, 'Add rate limiting to the API.');
  assert.deepEqual(model.header.title.parts.map((p) => p.quote), [true], 'your words, word for word');
  assert.ok(renderSessionPage(session, report, {}).includes('<title>Add rate limiting to the API.</title>'));
  assert.ok(renderReportMarkdown(session, report, {}).startsWith('## Sonah review · “Add rate limiting to the API.”'));
});

test('D132 (review, finding 3): the report model reads each message with an ask, in order, for the title', () => {
  const b = sessionBuilder();
  b.ask('I1', '<pasted_content id="p1">\nAdd rate limiting to the API.\n</pasted_content>');
  b.ask('I2', 'Also add a test for it. Thanks.');
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const ask = (id, quote) => ({ text: quote, status: 'not-checked',
    instruction: { role: 'instruction', eventId: id, quote, sessionKey: STORY_KEY } });
  const report = { windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }],
    sessionReview: 'complete', coverage: 'complete',
    requirements: [ask('I1', 'Add rate limiting to the API'), ask('I2', 'Also add a test for it')] };
  const model = reportModel(session, report, {});
  assert.equal(model.prompt.messages.length, 2);
  assert.equal(model.header.title.text, 'Also add a test for it.');
});
