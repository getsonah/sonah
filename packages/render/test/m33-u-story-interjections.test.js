// OWNER DECISION B (2026-10-01): the session story shows the human's in-turn instructions where they were recorded — a
// queued prompt as an ask, an AskUserQuestion answer as a reply ("You replied") — and a turn's helpers stay under the
// turn's own first request. Every recording is synthetic (packages/evidence/test/m33-u-unasked-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory } from '../session-story.js';
import { planWindows } from '../../evidence/src/windows.js';
import { claudeRows, load, QUEUED, ANSWER } from '../../evidence/test/m33-u-unasked-fixture.js';

const reportOf = (session) => ({ sessionStatus: 'NO_FINDINGS', windowResults: planWindows(session).map((window, windowIndex) =>
  ({ windowIndex, eventIds: window.events.map((event) => event.id), failure: null })) });

test('U a queued prompt is an ask and an answer is a reply, each where it was recorded', async (t) => {
  const { session } = await load(t, claudeRows({ queuedPrompt: QUEUED, ask: true }));
  const story = renderSessionStory(session, reportOf(session));
  const headings = story.split('\n').filter((line) => line.startsWith('### You'));
  assert.deepEqual(headings, ['### You: Write the parser in src/parser.js. Keep the public API unchanged.',
    `### You: ${QUEUED}`, '### You: Now add a flag to the CLI in src/cli.js.', `### You replied: \\${ANSWER}`]);
  assert.equal(ANSWER, '--strict', 'its markdown escapes the leading dash');
  // Without either shape the story is the one it always was: two asks.
  const plain = await load(t, claudeRows());
  assert.deepEqual(renderSessionStory(plain.session, reportOf(plain.session)).split('\n').filter((line) => line.startsWith('### You')),
    ['### You: Write the parser in src/parser.js. Keep the public API unchanged.', '### You: Now add a flag to the CLI in src/cli.js.']);
});
