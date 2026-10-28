// D150: queued commands and notifications, and edited text files, read by their recorder structure.
//
//   - a queued command the person typed (`queued_command`, mode `prompt`, origin human) is a human instruction at its
//     recorded row, marked `queued`, among the instructions a review gives a status to;
//   - a queued task notification (the one carrier rule) is read by its typed status, as one written as a user row is:
//     no declared loss; another agent's stays unclassified;
//   - an edited text file (`edited_text_file`) is read at its row with its file and the snippet the harness recorded
//     (`editedFiles`); no review reads it yet, so its label stays the harness's, it keeps its declared loss and
//     slice_hash leaves it out: no hash moves for it, a helper's read as a child included.
//
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeLabeller } from '../src/records.js';
import { sliceLineage } from '../index.js';
import { LABELS, LABEL_BASIS } from '../src/labels.js';
import { redact, sliceHash } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'd150d150-0000-4000-8000-0000000003aa';
const CHILD = 'a150d150d150d1503';
let seq = 0;
const at = (s) => `2026-10-24T10:00:${String(s).padStart(2, '0')}.000Z`;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: at(seq % 60), userType: 'external', uuid: `d150-q-${++seq}`, version: '2.1.308',
  ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const bash = (id, command, extra = {}) => row({ type: 'assistant', ...extra, message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id, content, extra = {}) => row({ type: 'user', ...extra, message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content }] } });
const attachment = (payload, extra = {}) => row({ type: 'attachment', attachment: payload, ...extra });

async function recording(t, rows, name = `${SESSION}.jsonl`) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d150q-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

test('D150: a queued command the person typed is a human instruction at its recorded row, marked queued', async (t) => {
  const words = 'Also keep the old flag working.';
  const rows = [ask('Fix the parser.'), bash('b-1', 'npm test'),
    { type: 'queue-operation', operation: 'enqueue', content: words, sessionId: SESSION, timestamp: at(30) },
    result('b-1', 'fail 1'), bash('b-2', 'npm test', { timestamp: at(40) }),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: words, origin: { kind: 'human' },
      source_uuid: 'u-src-1', timestamp: at(41) }), result('b-2', 'pass 2'), bash('b-3', 'git diff')];
  const ledger = redact(await sliceLineage([await recording(t, rows)], { cwd: '/repo' })).ledger;
  assert.deepEqual(ledger.interjections.map(({ kind, text, turn, beforeEvent, record }) => ({ kind, text, turn,
    beforeEvent, record })), [{ kind: 'queued', text: words, turn: 1, beforeEvent: 2, record: 6 }]);
  const { events } = sessionFromLedger(ledger);
  const instructions = events.filter((event) => event.kind === 'instruction');
  assert.equal(instructions.length, 2);
  const queued = instructions[1];
  assert.deepEqual(queued.recordedAs?.markers ?? queued.markers, ['queued']);
  // At its recorded position: after the two calls recorded before it, before the third.
  const order = events.map((event) => event.id);
  const calls = events.filter((event) => event.kind === 'invocation').map((event) => event.id);
  assert.ok(order.indexOf(calls[1]) < order.indexOf(queued.id) && order.indexOf(queued.id) < order.indexOf(calls[2]));
});

const notification = (taskId, toolUseId, status, payload = {}, extra = {}) => attachment({ type: 'queued_command',
  commandMode: 'task-notification', prompt: `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${toolUseId}`
    + `</tool-use-id>\n<status>${status}</status>\n<summary>Synthetic summary words.</summary>\n</task-notification>`,
  ...payload }, extra);

test('D150: a queued task notification is read by its typed status, never a declared loss; another agent\'s stays '
  + 'unclassified', async (t) => {
  const rows = [ask('Run the e2e suite in the background.'), bash('b-1', 'npm run e2e'),
    result('b-1', 'Command running in background with ID: bg0001.'), notification('bg0001', 'b-1', 'completed')];
  const { meta, records } = await readSession(await recording(t, rows));
  assert.equal(records.filter((rec) => rec.kind === 'notification').length, 1);
  assert.deepEqual([meta.capture?.unsupportedRowChannels?.observations ?? 0, meta.capture?.unclassifiedRows ?? 0], [0, 0]);
  const labeller = claudeLabeller();
  const values = rows.map((one) => labeller.label(one));
  labeller.finish();
  assert.deepEqual([values.at(-1).label, values.at(-1).basis], [LABELS.observation, LABEL_BASIS.taskNotification]);
  // In a helper's recording, one of its own is read so; one of another agent is another agent's row.
  const own = [row({ type: 'user', isSidechain: true, agentId: CHILD, message: { role: 'user', content: 'Brief.' } })];
  const foreignId = 'aotheragent000003';
  const helperRead = await readSession(await recording(t, [...own,
    notification('bg0002', 'b-9', 'completed', {}, { isSidechain: true, agentId: CHILD })], `agent-${CHILD}.jsonl`),
  { sidechainAsMain: true });
  assert.deepEqual([helperRead.meta.capture?.unclassifiedRows ?? 0,
    helperRead.meta.capture?.unsupportedRowChannels?.observations ?? 0], [0, 0]);
  const foreign = await readSession(await recording(t, [...own,
    notification('bg0003', 'b-9', 'completed', {}, { isSidechain: true, agentId: foreignId })],
  `agent-${CHILD}.jsonl`), { sidechainAsMain: true });
  assert.equal(foreign.meta.capture.unclassifiedRows, 1);
  // A notification mode whose human origin contradicts it is no notification: it stays a declared loss.
  const contradicted = await readSession(await recording(t, [ask('Go.'),
    notification('bg0004', 'b-1', 'completed', { origin: { kind: 'human' } })]));
  assert.equal(contradicted.meta.capture.unsupportedRowChannels.observations, 1);
});

test('D150: an edited text file is read at its row with its file and snippet, and moves no slice_hash',
  async (t) => {
    const edited = (extra = {}) => attachment({ type: 'edited_text_file', filename: '/repo/src/parse.js',
      snippet: '12\tconst limit = 3;\n13\texport default limit;', ...extra });
    const rows = [ask('Fix the parser.'), bash('b-1', 'npm test'), result('b-1', 'fail 1'), edited(),
      bash('b-2', 'npm test'), result('b-2', 'pass 2'), edited({ displayPath: 'src/parse.js' })];
    const labeller = claudeLabeller();
    const values = rows.map((one) => labeller.label(one));
    labeller.finish();
    assert.deepEqual(values[3], { label: LABELS.harness, basis: LABEL_BASIS.attachmentRow });
    const file = await recording(t, rows);
    const raw = await sliceLineage([file], { cwd: '/repo' });
    const ledger = redact(raw).ledger;
    assert.deepEqual(ledger.editedFiles.map(({ path, text, turn, beforeEvent, record }) => ({ path, text, turn,
      beforeEvent, record })), [
      { path: 'src/parse.js', text: '12\tconst limit = 3;\n13\texport default limit;', turn: 1, beforeEvent: 1,
        record: 4 },
      { path: 'src/parse.js', text: '12\tconst limit = 3;\n13\texport default limit;', turn: 1, beforeEvent: 2,
        record: 7 }]);
    assert.ok(ledger.editedFiles.every((entry) => entry.identity?.record === entry.record));
    // No review reads them yet: their label stays the harness's, their declared loss stays, and slice_hash is the same
    // with or without them.
    assert.equal(ledger.capture.labels.observation, 2);
    assert.equal(ledger.capture.labels.harness, 2);
    assert.equal(ledger.capture.labels.action, 2);
    assert.equal(ledger.capture.unsupportedRowChannels.observations, 2);
    const { editedFiles: _, ...without } = ledger;
    assert.equal(sliceHash(ledger), sliceHash(without));
    // One whose snippet or file name is not a string is not read.
    const odd = await sliceLineage([await recording(t, [ask('Go.'), edited({ snippet: 7 })])], { cwd: '/repo' });
    assert.equal(odd.editedFiles, undefined);
  });

test('D150 (step 3 review): an edited file in a helper read as a child moves no slice_hash', async (t) => {
  const own = (extra) => row({ isSidechain: true, agentId: CHILD, ...extra });
  const rows = (withEdit) => [own({ type: 'user', message: { role: 'user', content: 'Fix the parser.' } }),
    own({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'c-1', name: 'Bash',
      input: { command: 'npm test' } }] } }),
    own({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c-1', content: 'ok' }] } }),
    withEdit ? own({ type: 'attachment', attachment: { type: 'edited_text_file', filename: '/repo/src/a.js', snippet: '1\tx' } })
      : own({ type: 'attachment', attachment: { type: 'hook_non_blocking_error', command: 'x', durationMs: 1, exitCode: 1,
        hookEvent: 'PostToolUse', hookName: 'x', stderr: '', stdout: '', toolUseID: 'c-1' } })];
  const child = async (withEdit) => {
    const ledger = redact(await sliceLineage([await recording(t, rows(withEdit), `agent-${CHILD}.jsonl`)],
      { sidechainAsMain: true, childRecording: true, includeSources: true })).ledger;
    return { ...ledger, instructions: ledger.ask, ask: [], instructionAuthority: 'unchecked' };
  };
  const edited = await child(true), other = await child(false);
  assert.equal(edited.editedFiles.length, 1);
  // A child's capture is in its hash: the edited file counts as the other harness attachment of the same channel does.
  assert.deepEqual(edited.capture, other.capture);
  const { editedFiles: _, ...without } = edited;
  assert.equal(sliceHash(edited), sliceHash(without));
});
