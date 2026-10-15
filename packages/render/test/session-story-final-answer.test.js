// M33 F (helper final answers). A helper whose final report the slicer attached to its hand-off (the delegate's
// observation marked `helperReported`) is shown with what it reported — "reported: <first sentence, clipped>" — in
// the engineer section's step block and in the helper node of the charts. Inter-agent messages the recorder encrypted
// are stated once, in plain words, in the meta line where the story states its other limits.
//
// Synthetic sessions only. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, STORY_SENTENCES, STORY_BULLETS, STORY_LIMITS, STORY_ENCRYPTED_MESSAGES }
  from '../session-story.js';
import { INTER_AGENT_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';
import { storySession, storyReport } from './session-story-fixture.js';

/** The fixture session with `text` as the recorded report of hand-off `id`, placed right after it. */
function withReport(text, id = 'D4-0', session = storySession()) {
  const key = `report-${id}`;
  session.blobs[key] = text;
  const event = { id: `${id}-r`, kind: 'observation', sequence: 0, invocation: id, callKey: id, phase: 'terminal',
    result: 'unknown', exitCode: null, output: text ? [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text) }] : [],
    sourceOfResult: 'native', helperReported: true };
  session.events.splice(session.events.findIndex((e) => e.id === id) + 1, 0, event);
  session.events.forEach((e, i) => { e.sequence = i; });
  session.byId.set(event.id, event);
  return session;
}
const engineer = (story) => story.slice(story.indexOf('<a name="for-engineers">'));
const charts = (story) => [...story.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]).join('\n');

test('M33 F a helper\'s report is shown by its first sentence in its step block and its chart node', () => {
  const report = 'Added three tests for the token bucket. All of them pass now.';
  const story = renderSessionStory(withReport(report), storyReport());
  assert.equal(STORY_SENTENCES.helperReported, 'reported:');
  const block = engineer(story);
  assert.match(block, new RegExp(`- ${STORY_BULLETS.helper}: .* — reported: Added three tests for the token bucket\\.`));
  assert.doesNotMatch(story, /All of them pass now/, 'only the first sentence');
  assert.match(charts(story), /reported: Added three/);
  // A helper with no attached report says nothing of the kind, and neither does a story without reports.
  assert.equal(story.split('reported:').length - 1 >= 2, true);
  assert.doesNotMatch(renderSessionStory(storySession(), storyReport()), /reported:/);
});

test('M33 F only an attached report is shown: a hand-off\'s other results are not reports', () => {
  const session = withReport('Updated the README limits section.', 'D4-1');
  const story = renderSessionStory(session, storyReport());
  assert.match(engineer(story), /reported: Updated the README limits section\./);
  const failed = storySession();
  const event = { id: 'D4-0-r', kind: 'observation', sequence: 0, invocation: 'D4-0', callKey: 'D4-0', phase: 'terminal',
    result: 'failed', exitCode: null, output: [], sourceOfResult: 'native' };
  failed.events.splice(failed.events.findIndex((e) => e.id === 'D4-0') + 1, 0, event);
  failed.byId.set(event.id, event);
  assert.doesNotMatch(renderSessionStory(failed, storyReport()), /reported:/);
});

test('M33 F the report is clipped, escaped, one line, and a withheld one says so', () => {
  const long = `${'Refactored the limiter so that every bucket shares one clock and '.repeat(4)}done.`;
  const story = renderSessionStory(withReport(`${long}\nSecond line.`), storyReport());
  const line = engineer(story).split('\n').find((l) => l.startsWith(`- ${STORY_BULLETS.helper}: `));
  const reported = line.slice(line.indexOf('reported:') + 'reported: '.length);
  assert.ok([...reported].length <= STORY_LIMITS.reportChars, reported);
  assert.ok(reported.endsWith('…'));
  const markup = renderSessionStory(withReport('Fixed `rate` in *src/limiter.js*. @someone #12 said so.'), storyReport());
  assert.match(engineer(markup), /reported: Fixed \\`rate\\` in \\\*src\/limiter\.js\\\*\./);
  // No words left (redaction, or a cap with no whole line to keep): said so, without naming a cause the story
  // cannot see.
  assert.equal(STORY_SENTENCES.reportWithheld, '(report text withheld before review)');
  const withheld = renderSessionStory(withReport(''), storyReport());
  assert.match(engineer(withheld), new RegExp(`reported: ${STORY_SENTENCES.reportWithheld.replace(/[()]/g, '\\$&')}`));
});

test('M33 F encrypted inter-agent messages are stated once, in the meta line, in plain words', () => {
  const plain = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(plain, /inter-agent/);
  const gap = (count, sessionKey) => ({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count,
    note: INTER_AGENT_GAP_NOTES.encrypted, sessionKey });
  const codex = storySession();
  codex.adapter = 'codex';
  codex.adapterGaps = [gap(2, codex.sessionKey), gap(1, `${codex.sessionKey}/child:c1`),
    { code: 'incomplete_inventory', channel: 'children', scope: 'session', count: 4, note: INTER_AGENT_GAP_NOTES.unparsed }];
  const story = renderSessionStory(codex, storyReport());
  const meta = story.split('\n').find((line) => line.startsWith('Codex recording · '));
  assert.ok(meta.endsWith(' · 3 inter-agent messages were encrypted by Codex and cannot be shown'), meta);
  assert.equal(story.split('inter-agent').length - 1, 1, 'said once');
  assert.equal(STORY_ENCRYPTED_MESSAGES.other(1), '1 inter-agent message was encrypted by the recorder and cannot be shown');
  // A declaration that stated no count is at least one message, and said so.
  const uncounted = storySession();
  uncounted.adapterGaps = [gap(null, uncounted.sessionKey), gap(2, uncounted.sessionKey)];
  assert.match(renderSessionStory(uncounted, storyReport()),
    / · at least 3 inter-agent messages were encrypted by the recorder and cannot be shown/);
});
