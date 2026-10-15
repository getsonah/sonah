// M33 S6: a helper whose hand-off recorded no brief is still described: by the brief it received, else by
// its own first statement, marked as the helper's words (Codex `spawn_agent` records neither on the hand-off).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory } from '../session-story.js';
import { storySession, storyReport, TEXT } from './session-story-fixture.js';

const withoutBrief = () => {
  const session = storySession();
  session.event('D4-0').input = [];
  return session;
};
const firstWords = (text) => String(text).split(/\s+/).slice(0, 4).join(' ');

test('M33 S6 a hand-off with no brief shows the brief the helper received', () => {
  const story = renderSessionStory(withoutBrief(), storyReport());
  assert.match(story, new RegExp(firstWords(TEXT.brief1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(story, /helper said:/);
});

test('M33 S6 with neither a brief nor a received message, the helper is described by its own first statement', () => {
  const session = withoutBrief();
  const received = session.event('child:c1:I0');
  received.kind = 'commentary';
  const story = renderSessionStory(session, storyReport());
  assert.match(story, /helper said:/);
});

/** M5: harness context a helper recording starts with (a Codex plugin list) is no
 *  instruction event of it at all — the slicer reads none from it (records.js `humanTurnBasis`) — so a helper that
 *  received only that has no received instruction. */
const receivedNothing = (session) => {
  const received = session.event('child:c1:I0');
  session.events.splice(session.events.indexOf(received), 1);
  session.byId.delete(received.id);
  return session;
};

test('M33 S6, M5: a helper that received only harness context has no received brief', () => {
  const session = receivedNothing(withoutBrief());
  const story = renderSessionStory(session, storyReport());
  assert.doesNotMatch(story, /recommended_plugins/);
});

test('M33 S6 a recorded brief is shown as before', () => {
  const story = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(story, /helper said:/);
  assert.match(story, new RegExp(firstWords(TEXT.brief1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

// ---- M33 T: the task name, and briefs the recorder encrypted --------------------------------------------

/** A hand-off with no recorded brief whose helper received only harness context (M5: so no instruction event), and
 *  optionally a task name. */
const harnessOnly = (taskName) => {
  const session = receivedNothing(withoutBrief());
  if (taskName !== undefined) session.event('D4-0').taskName = taskName;
  return session;
};

test('M33 T with no brief, sent or received, a helper is described by its task name in plain words', () => {
  const story = renderSessionStory(harnessOnly('/root/fix_parser'), storyReport());
  assert.match(story, /task: fix parser/);
  assert.doesNotMatch(story, /fix_parser/);
  assert.doesNotMatch(story, /helper said:/);
  assert.doesNotMatch(story, /recommended_plugins/);
  // A nested task path is named by its own last part; `-` reads as a space too.
  assert.match(renderSessionStory(harnessOnly('/root/fix_parser/write_tests'), storyReport()), /task: write tests/);
  assert.match(renderSessionStory(harnessOnly('write-release-notes'), storyReport()), /task: write release notes/);
});

test('M33 T the order: recorded brief, then the brief received, then the task name, then the helper\'s words', () => {
  const sent = storySession();
  sent.event('D4-0').taskName = '/root/fix_parser';
  assert.doesNotMatch(renderSessionStory(sent, storyReport()), /task: fix parser/, 'a recorded brief comes first');
  const received = withoutBrief();
  received.event('D4-0').taskName = '/root/fix_parser';
  const receivedStory = renderSessionStory(received, storyReport());
  assert.doesNotMatch(receivedStory, /task: fix parser/, 'the brief the helper received comes before its task name');
  assert.match(receivedStory, new RegExp(firstWords(TEXT.brief1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const said = withoutBrief();
  said.event('child:c1:I0').kind = 'commentary';
  said.event('D4-0').taskName = '/root/fix_parser';
  const saidStory = renderSessionStory(said, storyReport());
  assert.match(saidStory, /task: fix parser/, 'the task name comes before the helper\'s own words');
  assert.doesNotMatch(saidStory, /helper said:/);
});

test('M33 T a task name that is not a plain identifier is never shown', () => {
  for (const name of ['', '/root', '/root/', 'fix parser', '<b>x</b>', 'a'.repeat(300), 42, null]) {
    const story = renderSessionStory(harnessOnly(name), storyReport());
    assert.doesNotMatch(story, /task:/, String(name));
  }
});

test('M33 T encrypted briefs are stated once, in the meta line, in plain words', () => {
  const plain = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(plain, /encrypted/);
  const one = storySession();
  one.event('D4-0').briefEncrypted = true;
  one.event('D4-0').input = [];
  const oneStory = renderSessionStory(one, storyReport());
  assert.equal(oneStory.split('1 helper brief was encrypted by the recorder and cannot be shown').length - 1, 1);
  const lines = oneStory.split('\n');
  const meta = lines.find((line) => line.includes('helper brief was encrypted'));
  assert.ok(meta.startsWith('Claude Code recording · '), 'it is the meta line under the title');
  assert.equal(oneStory.split('encrypted').length - 1, 1, 'said once, never per helper');
  const codex = storySession();
  codex.adapter = 'codex';
  for (const id of ['D4-0', 'D4-1']) { codex.event(id).briefEncrypted = true; codex.event(id).input = []; }
  const codexStory = renderSessionStory(codex, storyReport());
  assert.match(codexStory, /^Codex recording · .* · 2 helper briefs were encrypted by Codex and cannot be shown/m);
  assert.equal(codexStory.split('encrypted').length - 1, 1);
});

// ---- M33 C + M33 T merged: one story carries both sides' facts ---------------------------------------------

test('M33 C+T one story names the helper by task, states the encrypted brief once, and words the claims plainly', () => {
  const session = harnessOnly('/root/fix_parser');
  session.adapter = 'codex';
  session.event('D4-0').briefEncrypted = true;
  const report = storyReport();
  // M33 C recheck 2: code withholds no claim, so no cause says a statement was not listed as a claim; a report that
  // still carries the retired causes is shown no such line.
  report.withheld = { ...(report.withheld ?? {}), causes: { ...(report.withheld?.causes ?? {}),
    claim_not_factual: 1, claim_disclosed: 1 } };
  const story = renderSessionStory(session, report);
  // M33 T: the meta line, once; the helper by its task name, never by its harness context.
  assert.match(story, /^Codex recording · .* · 1 helper brief was encrypted by Codex and cannot be shown/m);
  assert.equal(story.split('encrypted').length - 1, 1, 'said once, never per helper');
  assert.match(story, /task: fix parser/);
  assert.doesNotMatch(story, /helper said:|recommended_plugins/);
  // M33 C: the claims in plain words — never "open".
  assert.ok(!story.includes('Open promises'), 'never "open"');
  // D88: the claim not checked is listed under What Sonah could not check, in plain words.
  assert.match(story, /## What Sonah could not check \(\d+\)[\s\S]*\*\*Claims not checked against a recorded result \(1\)\*\*\n\n- .* \(not checked; /);
  assert.doesNotMatch(story, /not listed as claims/);
  assert.match(story, /- Claim \(not checked\): /);
});
