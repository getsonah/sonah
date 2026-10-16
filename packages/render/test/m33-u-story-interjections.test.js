// OWNER DECISION B (2026-10-01): the readers show the human's in-turn instructions where they were recorded — a queued
// prompt as a message of its own, an AskUserQuestion answer as a reply — and a turn's helpers stay under the turn's own
// first message. D97: the facts every reader reads (storyFacts) and the report .md (the story since /32). Every recording
// is synthetic (packages/evidence/test/m33-u-unasked-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReportMarkdown, storyFacts } from '../session-story.js';
import { planWindows } from '../../evidence/src/windows.js';
import { claudeRows, load, QUEUED, ANSWER } from '../../evidence/test/m33-u-unasked-fixture.js';

const reportOf = (session) => ({ sessionStatus: 'NO_FINDINGS', windowResults: planWindows(session).map((window, windowIndex) =>
  ({ windowIndex, eventIds: window.events.map((event) => event.id), failure: null })) });
const wordsOf = (session, ask) => session.textSpansOf(ask.event, 'text').join('');

test('U a queued prompt is a message and an answer is a reply, each where it was recorded', async (t) => {
  const { session } = await load(t, claudeRows({ queuedPrompt: QUEUED, ask: true }));
  const facts = storyFacts(session, reportOf(session));
  assert.deepEqual(facts.asks.map((ask) => [wordsOf(session, ask), ask.reply]), [
    ['Write the parser in src/parser.js. Keep the public API unchanged.', false], [QUEUED, false],
    ['Now add a flag to the CLI in src/cli.js.', false], [ANSWER, true]]);
  // The report .md shows each as recorded; the answer's leading dash opens no list.
  const story = renderReportMarkdown(session, reportOf(session));
  assert.equal(ANSWER, '--strict', 'its markdown escapes the leading dash');
  assert.ok(story.includes(`> ${QUEUED}`) && story.includes('> \\--strict'), story);
  // Without either shape the facts are the ones they always were: two messages.
  const plain = await load(t, claudeRows());
  assert.deepEqual(storyFacts(plain.session, reportOf(plain.session)).asks.map((ask) => wordsOf(plain.session, ask)),
    ['Write the parser in src/parser.js. Keep the public API unchanged.', 'Now add a flag to the CLI in src/cli.js.']);
});
