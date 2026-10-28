// D150: each recording row the reader leaves unread is counted once, by its kind (`unreadRows`), where it is
// actually read or not.
//   - a prompt the person queued, or a file the person attached, is read only where its record yields words
//     (`interjectionWordsOf`, the one predicate events.js reads it by): a PDF, an image file or an empty prompt stays an
//     unread row of kind `other`, never by its label alone;
//   - a user row holding a block of a type no reader reads is `other` (events.js); a drifted user row the reader already
//     counts is counted once;
//   - a hook command's error row is a hook output;
//   - slice_hash does not move for any of it: the values below were computed on the tree before this count changed, and
//     the count is outside the hash.
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { redact, sliceHash } from '../../redact/index.js';

const SESSION = 'd150d150-0000-4000-8000-0000000005aa';
const CHILD = 'a150d150d150d1505';
const row = (n, extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false,
  parentUuid: n > 1 ? `d150-u-${n - 1}` : null, sessionId: SESSION, timestamp: `2026-10-24T10:00:${String(n).padStart(2, '0')}.000Z`,
  userType: 'external', uuid: `d150-u-${n}`, version: '2.1.308', ...extra });
const ask = (n, text) => row(n, { type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const bash = (n, id) => row(n, { type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command: 'npm test' } }] } });
const result = (n, id, extra = [], more = {}) => row(n, { type: 'user', ...more, message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'ok' }, ...extra] } });
const attachment = (n, payload) => row(n, { type: 'attachment', attachment: payload });
const queued = (n, prompt) => attachment(n, { type: 'queued_command', commandMode: 'prompt', prompt,
  origin: { kind: 'human' } });
const hook = (n, type, id) => {
  const ok = type === 'hook_success';
  return attachment(n, { type, command: 'synthetic-hook', durationMs: 1, exitCode: ok ? 0 : 1, hookEvent: 'PostToolUse',
    hookName: 'PostToolUse:Bash', stderr: '', stdout: 'Synthetic output.', toolUseID: id, ...(ok ? { content: '' } : {}) });
};

/** The person's ask with three files attached to it (a PDF, an image, a text file), then a call and its result, two
 *  queued prompts (one empty), and a hook's row. */
const PERSON = [
  ask(1, 'Implement what the attached spec says.'),
  attachment(2, { type: 'pdf_reference', displayPath: 'spec.pdf', fileSize: 1000, filename: '/repo/spec.pdf', pageCount: 3 }),
  attachment(3, { type: 'file', displayPath: 'shot.png', filename: '/repo/shot.png',
    content: { type: 'image', file: { base64: 'AAAA', type: 'image/png' } } }),
  attachment(4, { type: 'file', displayPath: 'notes.md', filename: '/repo/notes.md',
    content: { type: 'text', file: { filePath: '/repo/notes.md', content: 'Synthetic notes.' } } }),
  bash(5, 'b-1'), result(6, 'b-1'),
  queued(7, ''), queued(8, 'Also run the linter.'),
  hook(9, 'hook_success', 'b-1'),
];
/** A result row holding a block of a type no reader reads; a drifted user row (an alternate carrier) holding one too. */
const BLOCKS = [
  ask(1, 'Go.'), bash(2, 'b-1'), result(3, 'b-1', [{ type: 'new_block', n: 1 }]),
  bash(4, 'b-2'), result(5, 'b-2', [{ type: 'new_block', n: 2 }], { body: { n: 3 } }),
];

async function file(t, rows, name = `${SESSION}.jsonl`) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d150u-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, name);
  await writeFile(path, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return path;
}
/** The slice_hash of each fixture below, computed on the tree before this count changed. */
const HASHES = Object.freeze({ main: 'ad93cb6f299ff8099c47b120a1ba28fc7784365a95fe8f8f2ab608dbe26edb83',
  child: '9f733011faf47ea0cf820ec4152a5358907fefa1f780efed4a8617b60c0acaf9' });
const sliced = async (t, rows) => redact(await sliceLineage([await file(t, rows)], { cwd: '/repo' })).ledger;

test('D150: a file or prompt the person sent is read only where its words are read; one with none stays unread',
  async (t) => {
    const ledger = await sliced(t, PERSON);
    // The text file and the worded prompt are read at their rows; the PDF, the image and the empty prompt are not.
    assert.deepEqual(ledger.interjections.map((i) => i.kind), ['attached', 'queued']);
    assert.equal(ledger.capture.unsupportedRowChannels.instructions, 5);
    assert.deepEqual(ledger.unreadRows, { hook_output: 1, other: 3 });
  });

test('D150: a user row with a block no reader reads is one unread row; a drifted one is counted once', async (t) => {
  const ledger = await sliced(t, BLOCKS);
  // The capture counts the drifted row as the reader's and as the events' (as it did before); the kinds count it once.
  assert.equal(ledger.capture.unclassifiedRows, 3);
  assert.deepEqual(ledger.unreadRows, { other: 2 });
  const plainRow = await sliced(t, BLOCKS.slice(0, 3));
  assert.deepEqual(plainRow.unreadRows, { other: 1 });
});

test('D150: a hook command\'s error row is a hook output', async (t) => {
  const ledger = await sliced(t, [ask(1, 'Go.'), bash(2, 'b-1'), result(3, 'b-1'), hook(4, 'hook_non_blocking_error', 'b-1')]);
  assert.equal(ledger.capture.unsupportedRowChannels.observations, 1);
  assert.deepEqual(ledger.unreadRows, { hook_output: 1 });
});

test('D150: counting these rows moves no slice_hash, a helper\'s read as a child included', async (t) => {
  const main = await sliced(t, [...PERSON, bash(10, 'b-2'), result(11, 'b-2', [{ type: 'new_block', n: 1 }]),
    bash(12, 'b-3'), result(13, 'b-3', [{ type: 'new_block', n: 2 }], { body: { n: 3 } }),
    hook(14, 'hook_non_blocking_error', 'b-3')]);
  assert.deepEqual(main.unreadRows, { hook_output: 2, other: 5 });
  assert.equal(sliceHash(main), HASHES.main);
  // A helper's rows: its assignment, a call and result, two prompts its parent queued (one empty), a hook's row.
  const own = (r) => ({ ...r, isSidechain: true, agentId: CHILD });
  const coordinator = (n, prompt) => own(attachment(n, { type: 'queued_command', commandMode: 'prompt', prompt,
    origin: { kind: 'coordinator' } }));
  const rows = [own(row(1, { type: 'user', message: { role: 'user', content: 'Fix the parser.' } })), own(bash(2, 'c-1')),
    own(result(3, 'c-1')), coordinator(4, ''), coordinator(5, 'Also check the lexer.'), own(hook(6, 'hook_success', 'c-1'))];
  const ledger = redact(await sliceLineage([await file(t, rows, `agent-${CHILD}.jsonl`)],
    { sidechainAsMain: true, childRecording: true, includeSources: true })).ledger;
  assert.deepEqual(ledger.interjections.map((i) => i.kind), ['queued']);
  assert.deepEqual(ledger.unreadRows, { hook_output: 1, other: 1 });
  // A child's capture and sources are in its hash.
  assert.equal(sliceHash({ ...ledger, instructions: ledger.ask, ask: [], instructionAuthority: 'unchecked' }), HASHES.child);
});
