// D150 (the owner's call on the blob byte check): a Claude Code request blob (`api-request-blob`, one message of a model
// request, stored under its hash) is a copy of what the recording holds — harness, never a turn — when every block of
// its message has its STRUCTURAL twin in the same recording, byte for byte after a canonical JSON form: a user's text in
// a user row's content labelled human or harness, or in an attachment rendered in role user; a tool call in the recorded
// tool_use (its input as recorded, or as sent: the row's `wireToolInputs`); a result in the recorded tool_result; agent
// text and thinking in the recorded assistant block; a system reminder in the attachment or system row that carries those
// exact bytes. A string found anywhere else is no twin; any other blob stays declared unread.
//
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeLabeller, requestBlobRow, claudeRowClass } from '../src/records.js';
import { LABELS, LABEL_BASIS, LABEL_GAPS } from '../src/labels.js';
import { SESSION, CHILD, apiRequestBlob } from './d150-recorder-rows-fixture.js';

let seq = 0;
const envelope = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-24T10:00:00.000Z', userType: 'external', uuid: `d150-c-${++seq}`,
  version: '2.1.308', ...extra });
const ask = (text) => envelope({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const attachment = (payload, extra = {}) => envelope({ type: 'attachment', attachment: payload, ...extra });
const CALL = { type: 'tool_use', id: 'toolu_d150_1', name: 'Bash', input: { command: 'npm test' } };
const AS_SENT = { command: 'npm test', description: 'Run the tests' };
const THINKING = { type: 'thinking', thinking: 'Synthetic private words.', signature: 'sig-d150-1' };
const RESULT = { type: 'tool_result', tool_use_id: CALL.id, content: 'pass 3\nfail 0' };
/** The recorded rows every blob below is looked up in. */
const recorded = () => [
  ask('Run the tests, then tell me what failed.'),
  attachment({ type: 'session_context', context: { branch: 'main' } },
    { rendered: [{ content: 'Synthetic context words the harness rendered.' }], renderedRole: 'user' }),
  attachment({ type: 'total_tokens_reminder', text: 'Synthetic reminder words of the harness.' }),
  attachment({ type: 'skill_listing', content: 'Synthetic skill words.', isInitial: true, skillCount: 1 },
    { rendered: [{ content: 'Synthetic skill words rendered for the model.' }], renderedRole: 'system' }),
  envelope({ type: 'assistant', wireToolInputs: { [CALL.id]: AS_SENT }, message: { role: 'assistant', content: [
    THINKING, { type: 'text', text: 'Running the tests now.' }, CALL] } }),
  envelope({ type: 'user', message: { role: 'user', content: [RESULT] } }),
  envelope({ type: 'user', origin: { kind: 'peer' }, isMeta: true, message: { role: 'user',
    content: 'Synthetic words of another agent.' } }),
  envelope({ type: 'user', origin: { kind: 'peer' }, message: { role: 'user',
    content: [{ type: 'text', text: 'Synthetic block words of another agent.' }] } }),
  envelope({ type: 'system', subtype: 'informational', content: 'Synthetic words of a system notice.', isMeta: false,
    level: 'info' }),
];
/** Key order is no part of a twin: the canonical form sorts every object's keys. */
const reordered = (block) => Object.fromEntries(Object.entries(block).reverse());

async function recording(t, rows, name = `${SESSION}.jsonl`) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d150c-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
/** Each blob's settled label, by the labeller over the recording. */
function blobLabels(rows) {
  const labeller = claudeLabeller();
  const values = rows.map((one) => [one, labeller.label(one)]);
  labeller.finish();
  return values.filter(([one]) => one.type === 'api-request-blob').map(([, value]) => value);
}
const COPY = { label: LABELS.harness, basis: LABEL_BASIS.requestCopy };
const UNREAD = { label: null, basis: LABEL_BASIS.recorderRow, gap: LABEL_GAPS.unknownRow };
const lostOf = (capture) => (capture.unclassifiedRows ?? 0)
  + Object.values(capture.unsupportedRowChannels ?? {}).reduce((n, k) => n + k, 0);

test('D150: a blob every block of whose message has its structural twin is a request copy — harness, never a turn',
  async (t) => {
    const blobs = [
      apiRequestBlob({ role: 'user', content: 'Run the tests, then tell me what failed.' }),
      apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'Run the tests, then tell me what failed.' },
        { text: 'Synthetic context words the harness rendered.', type: 'text' }] }),
      apiRequestBlob({ role: 'assistant', content: [reordered(THINKING), { type: 'text', text: 'Running the tests now.' },
        { ...CALL, input: AS_SENT }] }),
      apiRequestBlob({ role: 'assistant', content: [CALL] }),
      apiRequestBlob({ role: 'user', content: [reordered(RESULT)] }),
      apiRequestBlob({ role: 'system', content: 'Synthetic reminder words of the harness.' }),
      apiRequestBlob({ role: 'system', content: [{ type: 'text', text: 'Synthetic words of a system notice.' }] }),
      apiRequestBlob({ role: 'system', content: [{ type: 'text', text: 'Synthetic context words the harness rendered.' }] }),
      apiRequestBlob({ role: 'system', content: 'Synthetic skill words rendered for the model.' }),
    ];
    const rows = [...recorded(), ...blobs];
    assert.ok(blobs.every(requestBlobRow));
    assert.deepEqual(blobLabels(rows), blobs.map(() => COPY));
    const { meta, records } = await readSession(await recording(t, rows));
    // The three harness attachments, the system notice (unclassified as before: it carries content) and every blob.
    assert.deepEqual([meta.capture.harnessContextRows, meta.capture.unclassifiedRows ?? 0,
      lostOf(meta.capture) - (meta.capture.unclassifiedRows ?? 0)], [3 + blobs.length, 1, 0]);
    assert.ok(records.every((rec) => rec.raw?.type !== 'api-request-blob'), 'a request copy is never a record');
  });

test('D150: only a structural twin counts — a string found elsewhere, another role or another id is no twin',
  async (t) => {
    const unread = [
      // A user's text found only in an attachment's payload, or in a rendering of another role, or in a peer's message,
      // or in a result.
      apiRequestBlob({ role: 'user', content: 'Synthetic reminder words of the harness.' }),
      apiRequestBlob({ role: 'user', content: 'Synthetic words of another agent.' }),
      apiRequestBlob({ role: 'user', content: 'Synthetic skill words rendered for the model.' }),
      apiRequestBlob({ role: 'user', content: 'pass 3\nfail 0' }),
      // A peer's text block (array content): no human's or harness's words. A result of another call, same content.
      apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'Synthetic block words of another agent.' }] }),
      apiRequestBlob({ role: 'user', content: [{ ...RESULT, tool_use_id: 'toolu_d150_other' }] }),
      // A system reminder found only in a user row, or deep in an attachment's payload.
      apiRequestBlob({ role: 'system', content: 'Run the tests, then tell me what failed.' }),
      apiRequestBlob({ role: 'system', content: 'main' }),
      // A tool call of the same id with another input; with the input sent for another id.
      apiRequestBlob({ role: 'assistant', content: [{ ...CALL, input: { command: 'npm test -- --watch' } }] }),
      apiRequestBlob({ role: 'assistant', content: [{ ...CALL, id: 'toolu_d150_2', input: AS_SENT }] }),
      // One block a twin holds and one no twin holds; no block at all; a block type no row records; another role.
      apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'Run the tests, then tell me what failed.' },
        { type: 'text', text: 'Synthetic words found in no row.' }] }),
      apiRequestBlob({ role: 'user', content: [] }),
      apiRequestBlob({ role: 'system', content: [{ type: 'tool_addition', names: ['Bash'] }] }),
      apiRequestBlob({ role: 'developer', content: 'Synthetic reminder words of the harness.' }),
      // A text block carrying another key is no `{type, text}` block: its twin must be the same block.
      apiRequestBlob({ role: 'user', content: [{ type: 'text', text: 'Run the tests, then tell me what failed.',
        cache_control: { type: 'ephemeral' } }] }),
    ];
    for (const blob of unread) {
      const rows = [...recorded(), blob];
      assert.deepEqual(blobLabels(rows), [UNREAD], JSON.stringify(blob.message).slice(0, 90));
      const { meta } = await readSession(await recording(t, rows));
      assert.equal(lostOf(meta.capture), 1 + 1, JSON.stringify(blob.message).slice(0, 90));   // and the system notice
      assert.equal(meta.capture.harnessContextRows, 3);
    }
    // A blob of another form (a key no blob carries) is no listed form: never settled, counted as before.
    const odd = { ...apiRequestBlob({ role: 'user', content: 'Run the tests, then tell me what failed.' }), note: 'x' };
    assert.equal(requestBlobRow(odd), false);
    assert.deepEqual(blobLabels([...recorded(), odd]), [UNREAD]);
    for (const message of [{ role: 'user', content: 'x', extra: 1 }, { role: 7, content: 'x' }, { role: 'user' },
      { role: 'user', content: 'x', output_config: { note: 'Words of a person.' } }])
      assert.equal(requestBlobRow(apiRequestBlob(message)), false, JSON.stringify(message));
    assert.equal(requestBlobRow(apiRequestBlob({ role: 'user', content: 'x', output_config: { effort: 'high' } })), true);
  });

test('D150: a helper\'s request copy is its harness context only as the recording\'s own', async (t) => {
  const brief = 'Check the build and report.';
  const own = [envelope({ type: 'user', isSidechain: true, agentId: CHILD, message: { role: 'user', content: brief } })];
  const mine = await readSession(await recording(t, [...own, apiRequestBlob({ role: 'user', content: brief },
    { agentId: CHILD })], `agent-${CHILD}.jsonl`), { sidechainAsMain: true });
  assert.deepEqual([mine.meta.capture.harnessContextRows, mine.meta.capture.unclassifiedRows], [1, undefined]);
  const foreign = await readSession(await recording(t, [...own, apiRequestBlob({ role: 'user', content: brief },
    { agentId: 'aotheragent000000' })], `agent-${CHILD}.jsonl`), { sidechainAsMain: true });
  assert.deepEqual([foreign.meta.capture.harnessContextRows, foreign.meta.capture.unclassifiedRows], [undefined, 1]);
});

test('D150 (review F2): a queued command flagged isMeta with a mode no list names stays unclassified', async (t) => {
  const odd = attachment({ type: 'queued_command', isMeta: true, commandMode: 'bash', prompt: 'x', reminderId: 'r' });
  assert.equal(claudeRowClass(odd), null);
  const { meta } = await readSession(await recording(t, [...recorded(), odd]));
  assert.equal(meta.capture.unclassifiedRows, 1 + 1);   // and the system notice
});
