// D206: on a recording that spans days, a file with no recorded write is not the session's when it last changed after the
// agent's turn ended and before the next message. D113's window alone took every such file (another person's pull, a
// build, another session), which is how a multi-day Codex recording in a monorepo reached thousands of paths. Such a file
// is not lost: it is named apart and reviewed as outside the evaluated session.
//
// A wait starts only at a row the recorder itself types as the end of a turn (Codex's `task_complete`). Agents speak while
// their commands run, so a row of their words starts none. Claude Code types no such row, so its recordings name no wait.
//
// Synthetic recordings and throwaway repositories: no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, sessionsOwnChange, sessionWaits } from '../src/code-snapshot.js';
import { buildCodeSession, CODE_TEXT } from './code-pass-fixture.js';

const at = (day, hms) => `2030-01-0${day}T${hms}.000Z`;
const ms = (day, hms) => Date.parse(at(day, hms));
const line = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
const meta = (when) => line(when, 'session_meta', { id: '00000000-0000-0000-0000-000000000000', cwd: '/repo', timestamp: when });
const human = (when, text = 'do it') => line(when, 'response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
const say = (when, text = 'done') => line(when, 'response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const call = (when, id) => line(when, 'response_item', { type: 'function_call', name: 'shell', call_id: id, arguments: '{"command":["make"]}' });
const output = (when, id, text = 'ok') => line(when, 'response_item', { type: 'function_call_output', call_id: id, output: text });
const ended = (when) => line(when, 'event_msg', { type: 'task_complete' });
const ROLLOUT = 'rollout-2030-01-01T10-00-00-00000000-0000-0000-0000-000000000000.jsonl';

async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d206-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const write = async (t, rows, name = ROLLOUT) => {
  const file = join(await scratch(t), name);
  await writeFile(file, typeof rows === 'string' ? rows : `${rows.join('\n')}\n`);
  return file;
};
/** Two turns a day apart: a command in each, and a long wait between them. */
const twoTurns = () => [meta(at(1, '10:00:00')), human(at(1, '10:00:01')), call(at(1, '10:00:05'), 'c1'),
  output(at(1, '10:01:00'), 'c1'), say(at(1, '10:01:05')), ended(at(1, '10:01:06')), human(at(2, '10:00:00')),
  call(at(2, '10:00:05'), 'c2'), output(at(2, '10:02:00'), 'c2'), say(at(2, '10:02:05')), ended(at(2, '10:02:06'))];
const WAIT = { start: ms(1, '10:01:06'), end: ms(2, '10:00:00') };

test('D206: a wait runs from the row that types a turn\'s end to the human\'s next message', async (t) => {
  assert.deepEqual(await sessionWaits([{ file: await write(t, twoTurns()) }]), [WAIT]);
});

test('D206: the last of the session\'s own recordings waits to its end; an earlier one does not', async (t) => {
  const rows = [...twoTurns(), line(at(9, '10:00:00'), 'event_msg', { type: 'token_count' })];
  const file = await write(t, rows);
  const tail = { start: ms(2, '10:02:06'), end: ms(9, '10:00:00') };
  assert.deepEqual(await sessionWaits([{ file }]), [WAIT, tail]);
  // Another recording after it: its end is no wait.
  const later = await write(t, [meta(at(9, '11:00:00')), human(at(9, '11:00:01'))]);
  assert.deepEqual(await sessionWaits([{ file }, { file: later }]), [WAIT]);
});

test('D206: the agent\'s words never start a wait: a polled command is no wait, whatever it says on the way', async (t) => {
  const file = await write(t, [meta(at(1, '10:00:00')), human(at(1, '10:00:01')), call(at(1, '10:00:02'), 'c1'),
    output(at(1, '10:00:12'), 'c1', 'Process running'), say(at(1, '10:00:20'), 'still building'),
    line(at(1, '10:02:00'), 'response_item', { type: 'function_call', name: 'write_stdin', call_id: 'c2', arguments: '{"chars":""}' }),
    output(at(1, '10:30:00'), 'c2', 'exit 0'), human(at(2, '10:00:00'))]);
  assert.deepEqual(await sessionWaits([{ file }]), []);
});

test('D206: Claude Code types no turn\'s end, so its recordings name no wait', async (t) => {
  const row = (when, type, content) => JSON.stringify({ sessionId: undefined, cwd: '/repo', version: '2.1.296', timestamp: when,
    type, uuid: `${type}-${when}`, ...(type === 'user' ? { origin: { kind: 'human' } } : {}), message: { role: type, content } });
  const file = await write(t, [row(at(1, '10:00:00'), 'user', 'do it'), row(at(1, '10:00:05'), 'assistant', [{ type: 'text', text: 'done' }]),
    row(at(3, '10:00:00'), 'user', 'again')], 'claude.jsonl');
  assert.deepEqual(await sessionWaits([{ file }]), []);
});

test('D206: work recorded in a wait, in any recording, unmakes it', async (t) => {
  const file = await write(t, twoTurns());
  const other = await write(t, [meta(at(1, '18:00:00')), human(at(1, '18:00:01')), call(at(1, '18:00:02'), 'c9'), output(at(1, '18:00:09'), 'c9')]);
  assert.deepEqual(await sessionWaits([{ file: other }, { file }]), []);
});

test('D206: a helper active in a wait takes that time out of it', async (t) => {
  const file = await write(t, twoTurns());
  const helper = await write(t, `${JSON.stringify({ timestamp: at(1, '18:00:00') })}\n${JSON.stringify({ timestamp: at(1, '19:00:00') })}\n`, 'agent-1.jsonl');
  assert.deepEqual(await sessionWaits([{ file }, { file: helper, helper: true }]),
    [{ start: WAIT.start, end: ms(1, '18:00:00') }, { start: ms(1, '19:00:00'), end: WAIT.end }]);
});

test('D206: a wait is named only on what every recording shows: one that cannot be read names none', async (t) => {
  const file = await write(t, twoTurns());
  assert.deepEqual(await sessionWaits([{ file }, { file: join(await scratch(t), 'missing.jsonl') }]), []);
  assert.deepEqual(await sessionWaits([{ file }, { file: join(await scratch(t), 'gone.jsonl'), helper: true }]), []);
  assert.deepEqual(await sessionWaits(null), []);
});

test('D206: a frozen read gives the waits of the recording as it was; a wait ends at its whole second', async (t) => {
  const rows = twoTurns();
  const file = await write(t, rows);
  assert.deepEqual(await sessionWaits([{ file, byteEnd: Buffer.byteLength(`${rows.slice(0, 5).join('\n')}\n`) }]), []);
  assert.deepEqual(await sessionWaits([{ file, byteEnd: Buffer.byteLength(`${rows.slice(0, 7).join('\n')}\n`) }]), [WAIT]);
  const rounded = await write(t, [meta(at(1, '10:00:00')), human(at(1, '10:00:01')), ended(at(1, '10:00:02')), human('2030-01-02T10:00:00.900Z')]);
  assert.deepEqual(await sessionWaits([{ file: rounded }]), [{ start: ms(1, '10:00:02'), end: ms(2, '10:00:00') }]);
});

test('D206: sessionsOwnChange names apart a file changed in a wait, and keeps one changed at any other time in the window', async () => {
  const window = { start: ms(1, '10:00:00'), end: ms(2, '10:02:06'), waits: [WAIT] };
  const change = (path, mtimeMs) => ({ path, recordedPath: path, mtimeMs });
  const { plan, changedOutside } = await sessionsOwnChange([], [change('in-first.txt', ms(1, '10:00:30')),
    change('in-second.txt', ms(2, '10:01:00')), change('in-the-wait.txt', ms(1, '22:00:00')),
    change('after-all.txt', ms(3, '10:00:00'))], { dir: '/repo', window });
  assert.deepEqual(plan.map((e) => e.path), ['in-first.txt', 'in-second.txt']);
  assert.deepEqual(changedOutside, ['after-all.txt', 'in-the-wait.txt']);
  // No wait named: D113's window alone, as before.
  const open = await sessionsOwnChange([], [change('in-the-wait.txt', ms(1, '22:00:00'))],
    { dir: '/repo', window: { start: window.start, end: window.end, waits: [] } });
  assert.deepEqual(open.plan.map((e) => e.path), ['in-the-wait.txt']);
});

test('D206: end to end — a file a pull changed in a wait is outside the change and still read; a helper\'s time counts', async (t) => {
  const root = await scratch(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
    GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  git('init', '-q', '-b', 'main');
  for (const f of ['pulled.js', 'made.js', 'helped.js']) await writeFile(join(root, f), 'one\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const stamp = async (f, when) => {
    await writeFile(join(root, f), 'two\n');
    await utimes(join(root, f), when / 1000, when / 1000);
  };
  await stamp('pulled.js', ms(1, '22:00:00'));
  await stamp('made.js', ms(1, '10:00:30'));
  await stamp('helped.js', ms(1, '18:00:30'));
  const recording = await write(t, twoTurns());
  const helper = await write(t, `${JSON.stringify({ timestamp: at(1, '18:00:00') })}\n${JSON.stringify({ timestamp: at(1, '18:01:00') })}\n`, 'agent-1.jsonl');
  const session = buildCodeSession('s', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
  const snapshotOf = (activity) => readCodeSnapshot(session, { root, maxBytes: 1_620_000, recording, activity });
  const pathsOf = (snap) => snap.files.filter((f) => f.diff !== undefined).map((f) => f.path).sort();
  const withHelper = await snapshotOf([{ file: recording }, { file: helper, helper: true }]);
  assert.deepEqual(pathsOf(withHelper), ['helped.js', 'made.js']);
  assert.deepEqual(withHelper.base.changedOutside, ['pulled.js']);
  // Outside the evaluated session, never lost: it is read apart.
  assert.deepEqual(withHelper.outsideFiles.filter((f) => f.diff !== undefined).map((f) => f.path), ['pulled.js']);
  assert.deepEqual(pathsOf(await snapshotOf([{ file: recording }])), ['made.js']);
  // One recording that cannot be read: no wait is named, so nothing moves.
  assert.deepEqual(pathsOf(await snapshotOf([{ file: recording }, { file: join(root, 'missing.jsonl'), helper: true }])),
    ['helped.js', 'made.js', 'pulled.js']);
});
