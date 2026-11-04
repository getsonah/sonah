// D207 (a false NONE, independently checked on a real Codex recording): the end test reads the end of the session's
// recorded work, never the last row that carries a time. A recorder writes rows of its own long after the work (on that
// recording, a settings row 13 days after the last action), so a commit of other hands in between made every file the
// session's commands wrote look "committed by the end", and rule 3 never let them in. The end is the newest row the slicer
// labels thought, action or observation, in the session's recordings and its helpers' (`recordedWorkEnd`; the human's
// newest only where the agent has none, D207's second review); a row it labels harness, or keeps as no record, is none,
// by the recorder's structure and never by a row type named here.
//
// D113's window ends there too: Claude Code types no turn's end, so no wait covers the time after its work, and on one
// recording 20 days of a recorder's own rows held 99 files that others changed. When no row of work carries a time, the
// window keeps the last timestamp and the evidence falls back, as with no last timestamp.
//
// Synthetic recordings and throwaway repositories: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readCodeSnapshot, recordedWorkEnd, recordingEnd } from '../src/code-snapshot.js';
import { buildCodeSession, CODE_TEXT } from './code-pass-fixture.js';
import { at, claude, codex, ms, recording, repository, ROLLOUT, scratch } from './d207-fixture.js';

const session = () => buildCodeSession('s', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
const placesOf = (snap) => Object.fromEntries(snap.plan.map((e) => [e.path, e.recorded ? 'write' : e.placedBy]));
const snapshotOf = (root, activity) => readCodeSnapshot(session(), { root, maxBytes: 1_620_000, recording: activity[0].file,
  activity });

/** Claude Code rows the slicer reads as no work: a hook summary it keeps and labels harness, and an attachment it only
 *  counts. Each carries a time. */
const hookSummary = (when) => JSON.stringify({ cwd: '/repo', version: '2.1.296', uuid: `h-${when}`, timestamp: when,
  type: 'system', subtype: 'stop_hook_summary', hookCount: 1, hookInfos: [], hookErrors: [], preventedContinuation: false,
  stopReason: '', hasOutput: false, level: 'suggestion' });
const attachment = (when) => JSON.stringify({ cwd: '/repo', version: '2.1.296', uuid: `a-${when}`, timestamp: when,
  type: 'attachment', attachment: { type: 'mcp_instructions_delta', addedNames: [], addedBlocks: [], removedNames: [] } });
/** A Codex row the recorder writes when a thread's settings are applied: an event the slicer reads as no work. */
const settings = (when) => JSON.stringify({ timestamp: when, type: 'event_msg', payload: { type: 'thread_settings_applied' } });

test('D207: the end of the recorded work is the last row of work, not the last row that carries a time', async (t) => {
  const file = await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:30:00'), 'make', 'c1'),
    claude.result(at('10:31:00'), 'ok', 'c1'), claude.thought(at('10:59:00'), 'done'), hookSummary(at('10:00:00', 3)),
    attachment(at('10:00:00', 4))]);
  assert.equal(await recordingEnd(file), at('10:00:00', 4));
  assert.equal(await recordedWorkEnd([{ file }]), at('10:59:00'));
  // On Codex: a turn's end, a token count and a settings row after the agent's last words are none.
  const rollout = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')),
    codex.shell(at('10:30:00'), 'make', 'c1'), codex.output(at('10:31:00'), 'c1'), codex.say(at('10:59:00')),
    codex.ended(at('10:59:01')), settings(at('10:00:00', 4))], ROLLOUT);
  assert.equal(await recordingEnd(rollout), at('10:00:00', 4));
  assert.equal(await recordedWorkEnd([{ file: rollout }]), at('10:59:00'));
});

test('D207: a helper\'s work after the session\'s last row ends the work later; any unreadable recording names no end',
  async (t) => {
    const file = await recording(t, [claude.human(at('10:00:00')), claude.thought(at('10:10:00'), 'asked a helper')]);
    const helper = await recording(t, [claude.human(at('10:10:01'), 'the brief'), claude.action(at('10:40:00'), 'make', 'h1'),
      claude.result(at('10:45:00'), 'ok', 'h1'), hookSummary(at('10:00:00', 2))], 'helper.jsonl');
    assert.equal(await recordedWorkEnd([{ file }, { file: helper, helper: true }]), at('10:45:00'));
    assert.equal(await recordedWorkEnd([{ file }, { file: join(await scratch(t), 'gone.jsonl') }]), null);
    // No row of work carries a time: no end (the window decides, as with no last timestamp).
    assert.equal(await recordedWorkEnd([{ file: await recording(t, [hookSummary(at('10:00:00'))]) }]), null);
  });

/** A file a command of the session wrote (no recorded write: `make`), then committed by other hands after the work ended,
 *  before the recorder's own late row. */
async function committedAfterTheWork(t) {
  const repo = await repository(t);
  await repo.put('b.txt', 'made by the session\'s command\n', ms('10:30:00'));
  repo.git(['commit', '-qam', 'A commit of other hands, the next day'], '2030-01-02T09:00:00Z');
  await repo.put('b.txt', 'made by the session\'s command\n', ms('10:30:00'));
  return repo;
}

test('D207: on Codex, a file the session\'s command wrote, committed by other hands after the work ended, is `time`',
  async (t) => {
    const repo = await committedAfterTheWork(t);
    const file = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')),
      codex.shell(at('10:29:00'), 'make', 'c1'), codex.output(at('10:31:00'), 'c1'), codex.say(at('10:59:00')),
      codex.ended(at('10:59:01')), settings(at('10:00:00', 4))], ROLLOUT);
    const snap = await snapshotOf(repo.top, [{ file }]);
    assert.deepEqual(placesOf(snap), { 'b.txt': 'time' });
    assert.deepEqual(snap.base.changedOutside, []);
  });

test('D207: on Claude Code, the same, with the recorder\'s hook summary and attachment days later', async (t) => {
  const repo = await committedAfterTheWork(t);
  const file = await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:29:00'), 'make', 'c1'),
    claude.result(at('10:31:00'), 'ok', 'c1'), claude.thought(at('10:59:00'), 'done'), hookSummary(at('10:00:00', 3)),
    attachment(at('10:00:00', 4))]);
  const snap = await snapshotOf(repo.top, [{ file }]);
  assert.deepEqual(placesOf(snap), { 'b.txt': 'time' });
});

test('D207: a commit of other hands before the work ended stays outside; one the session made stays `commit`',
  async (t) => {
    const repo = await repository(t, { 'a.txt': 'one\n', 'b.txt': 'one\n' });
    await repo.put('b.txt', 'theirs\n', ms('10:30:00'));
    repo.git(['commit', '-qam', 'A commit of other hands while the agent works'], '2030-01-01T10:40:00Z');
    await repo.put('b.txt', 'theirs\n', ms('10:30:00'));
    await repo.put('a.txt', 'mine\n', ms('10:30:00'));
    repo.git(['commit', '-qm', 'Make the parser strict', '--', 'a.txt'], '2030-01-02T09:00:00Z');
    await repo.put('a.txt', 'mine\n', ms('10:30:00'));
    const file = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')),
      codex.shell(at('10:50:00'), 'git commit -qm "Make the parser strict" -- a.txt', 'c1'), codex.output(at('10:51:00'), 'c1'),
      codex.say(at('10:59:00')), codex.ended(at('10:59:01')), settings(at('10:00:00', 4))], ROLLOUT);
    const snap = await snapshotOf(repo.top, [{ file }]);
    assert.deepEqual(placesOf(snap), { 'a.txt': 'commit' });
    assert.deepEqual(snap.base.changedOutside, ['b.txt']);
  });

test('D207: a helper\'s later work ends the work later: its command\'s file is `time`, unless others committed it then',
  async (t) => {
  // The session's own recording stops on day 1; its helper works on into day 2, and its command writes b.txt there.
  const repo = await repository(t);
  await repo.put('b.txt', 'made by the helper\'s command\n', ms('08:30:00', 2));
  const file = await recording(t, [claude.human(at('10:00:00')), claude.thought(at('10:10:00'), 'asked a helper'),
    hookSummary(at('10:00:00', 4))]);
  const helper = await recording(t, [claude.human(at('10:10:01'), 'the brief'), claude.action(at('08:29:00', 2), 'make', 'h1'),
    claude.result(at('08:31:00', 2), 'ok', 'h1'), claude.thought(at('08:59:00', 2), 'done')], 'helper.jsonl');
  const both = [{ file }, { file: helper, helper: true }];
  assert.deepEqual(placesOf(await snapshotOf(repo.top, both)), { 'b.txt': 'time' });
  // The session's recording alone: its work ended on day 1, so a file changed on day 2 is not its own.
  assert.deepEqual(placesOf(await snapshotOf(repo.top, [{ file }])), {});
  // Other hands commit that file while the helper works: by the end of the work it was committed, not by the session.
  repo.git(['commit', '-qam', 'A commit of other hands'], '2030-01-02T08:45:00Z');
  await repo.put('b.txt', 'made by the helper\'s command\n', ms('08:30:00', 2));
  const snap = await snapshotOf(repo.top, both);
  assert.deepEqual(placesOf(snap), {});
  assert.deepEqual(snap.base.changedOutside, ['b.txt']);
});

test('D207: the window ends with the recorded work: a file others changed after it, under the recorder\'s late rows, is outside',
  async (t) => {
    // Claude Code types no turn's end, so no wait covers the time after the work: on one recording, 20 days of a
    // recorder's own rows, in which other hands changed 99 files and left them uncommitted.
    const repo = await repository(t);
    await repo.put('b.txt', 'changed by other hands after the work\n', ms('10:00:00', 2));
    await repo.put('new.txt', 'made by other hands after the work\n', ms('10:00:00', 2));
    await repo.put('a.txt', 'made by the session\'s command\n', ms('10:30:00'));
    const file = await recording(t, [claude.human(at('10:00:00')), claude.action(at('10:29:00'), 'make', 'c1'),
      claude.result(at('10:31:00'), 'ok', 'c1'), claude.thought(at('10:59:00'), 'done'), hookSummary(at('10:00:00', 3)),
      attachment(at('10:00:00', 4))]);
    const snap = await snapshotOf(repo.top, [{ file }]);
    assert.deepEqual(placesOf(snap), { 'a.txt': 'time' });
    assert.deepEqual(snap.base.changedOutside, ['b.txt', 'new.txt']);
    // When no row of work carries a time, D113's window keeps the recording's last timestamp, as before.
    const bare = await recording(t, [JSON.stringify({ timestamp: at('10:00:00') }), JSON.stringify({ timestamp: at('10:00:00', 4) })]);
    assert.deepEqual(placesOf(await snapshotOf(repo.top, [{ file: bare }])), { 'a.txt': 'time', 'b.txt': 'time',
      'new.txt': 'time' });
  });

// D207's second review: a human message that no row of the agent's follows asked for work that was not done. As the end,
// it moved the end test and the window past a commit made by hand after the agent stopped: a file the session's own
// command wrote then read as committed by the end, and went outside. The end is the agent's last row; the human's last row
// ends the work only where the agent has no row with a time.
test('D207: a human message with no reply, days after the work, ends nothing, on Claude Code and Codex', async (t) => {
  const repo = await repository(t);
  await repo.put('a.txt', 'made by the session\'s command\n', ms('10:30:00'));
  repo.git(['commit', '-qam', 'A commit by hand, the next day'], '2030-01-02T09:00:00Z');
  await repo.put('a.txt', 'made by the session\'s command\n', ms('10:30:00'));
  const claudeRows = [claude.human(at('10:00:00')), claude.action(at('10:29:00'), 'make', 'c1'),
    claude.result(at('10:31:00'), 'ok', 'c1'), claude.thought(at('10:59:00'), 'done')];
  const claudeFile = await recording(t, [...claudeRows, claude.human(at('09:00:00', 3), 'thanks')]);
  assert.equal(await recordedWorkEnd([{ file: claudeFile }]), at('10:59:00'));
  assert.deepEqual(placesOf(await snapshotOf(repo.top, [{ file: claudeFile }])), { 'a.txt': 'time' });
  const codexFile = await recording(t, [codex.meta(at('10:00:00')), codex.human(at('10:00:01')),
    codex.shell(at('10:29:00'), 'make', 'c1'), codex.output(at('10:31:00'), 'c1'), codex.say(at('10:59:00')),
    codex.ended(at('10:59:01')), codex.human(at('09:00:00', 3), 'thanks')], ROLLOUT);
  assert.equal(await recordedWorkEnd([{ file: codexFile }]), at('10:59:00'));
  const snap = await snapshotOf(repo.top, [{ file: codexFile }]);
  assert.deepEqual(placesOf(snap), { 'a.txt': 'time' });
  assert.deepEqual(snap.base.changedOutside, []);
  // The window ends with the agent too: a file others changed after it, before the unanswered message, is outside.
  await repo.put('b.txt', 'changed by other hands on day 2\n', ms('12:00:00', 2));
  const late = await snapshotOf(repo.top, [{ file: claudeFile }]);
  assert.deepEqual(placesOf(late), { 'a.txt': 'time' });
  assert.deepEqual(late.base.changedOutside, ['b.txt']);
  // Where the agent has no row with a time, the human's last message ends the work: the end test still runs.
  assert.equal(await recordedWorkEnd([{ file: await recording(t, [claude.human(at('10:00:00')),
    claude.human(at('11:00:00'), 'anyone?')]) }]), at('11:00:00'));
});
