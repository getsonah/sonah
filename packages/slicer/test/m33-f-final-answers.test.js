// M33 F (helper final answers). Codex records inter-agent messages as `agent_message` rows whose readable block
// opens with a fixed header ("Message Type: <TYPE>\nTask name: <path>\nSender: <path>\nPayload:\n"). The slicer reads
// that header exactly, from a closed list of message types:
//   - NEW_TASK and MESSAGE carry their payload encrypted: counted as encrypted, nothing kept;
//   - FINAL_ANSWER carries the helper's final report in plaintext: attached as the RESULT of the one hand-off of this
//     recording whose task path equals the header's SENDER (the helper; the row's author) — exact recorded identity
//     only, and only when the header's Task name (the recipient; the row's recipient) is this recording's own
//     recorded task path — or, with zero or several candidates, not attached and counted under a closed reason
//     (unattributed / ambiguous);
//   - anything else stays unparsed and counted.
// The slicer keeps the whole report it read, with the turn and row where the parent received it, and nothing bounds it
// (D68 E). D90 (owner decision 2026-10-15, privacy is not a design constraint): nothing in it is masked either.
//
// M33 F repair: in Codex rollouts `Task name` names the RECIPIENT and `Sender` the author (see the fixture); the first
// cut joined on `Task name` and so attributed nothing. Every row here has the recorder's shape.
//
// Synthetic Codex rollouts only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readCodexSession } from '../src/codex.js';
import { readAgentMessage, INTER_AGENT_MESSAGE_TYPES, INTER_AGENT_COUNTS, INTER_AGENT_LOSS_COUNTS,
  FINAL_ANSWER_ATTRIBUTION } from '../src/inter-agent.js';
import * as interAgent from '../src/inter-agent.js';
import * as redaction from '../../redact/index.js';
const { redact, sliceHash, FINAL_ANSWER_OMISSION } = redaction;
/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a report by (M33 F to D68 E): only for building inputs. */
const RETIRED = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
import { TOKENS, TEXT, SECRET, header, agentMessage, finalAnswer, newTask, message, rootMeta, ask, spawn, call, output,
  rootRows, lateReportRows, jsonl } from '../../evidence/test/m33-f-final-answer-fixture.js';

async function write(t, rows, name = 'rollout-2026-10-01T12-00-00-synthetic.jsonl') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-f-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, jsonl(rows));
  return file;
}
async function slice(t, rows, opts = {}) {
  const raw = await sliceLineage([await write(t, rows)], opts);
  return { raw, clean: redact(structuredClone(raw)).ledger };
}
const counts = (ledger) => Object.fromEntries(Object.values(INTER_AGENT_COUNTS)
  .map((key) => [key, ledger.capture?.[key] ?? 0]));
const zero = Object.freeze(Object.fromEntries(Object.values(INTER_AGENT_COUNTS).map((key) => [key, 0])));
const expectCounts = (ledger, expected) => assert.deepEqual(counts(ledger), { ...zero, ...expected });
const byCall = (ledger, callId) => ledger.delegations.find((d) => d.callId === callId);
const payload = (row) => row.payload;

// ---- the closed vocabularies -------------------------------------------------------------------------------------

test('M33 F the message types, counters and attribution reasons are closed, frozen vocabularies', () => {
  assert.deepEqual([...INTER_AGENT_MESSAGE_TYPES], ['NEW_TASK', 'MESSAGE', 'FINAL_ANSWER']);
  assert.deepEqual({ ...INTER_AGENT_COUNTS }, {
    unparsed: 'interAgentMessagesUnparsed', encrypted: 'interAgentMessagesEncrypted',
    attributed: 'interAgentFinalAnswersAttributed', unattributed: 'interAgentFinalAnswersUnattributed',
    ambiguous: 'interAgentFinalAnswersAmbiguous' });
  assert.deepEqual([...INTER_AGENT_LOSS_COUNTS], ['interAgentMessagesUnparsed', 'interAgentMessagesEncrypted',
    'interAgentFinalAnswersUnattributed', 'interAgentFinalAnswersAmbiguous'], 'an attributed report is no loss');
  assert.deepEqual({ ...FINAL_ANSWER_ATTRIBUTION }, { attributed: 'attributed', unattributed: 'unattributed',
    ambiguous: 'ambiguous' });
  for (const value of [INTER_AGENT_MESSAGE_TYPES, INTER_AGENT_COUNTS, INTER_AGENT_LOSS_COUNTS, FINAL_ANSWER_ATTRIBUTION])
    assert.equal(Object.isFrozen(value), true);
  // D68 (E): a helper's report is what it produced, kept whole; the bound and its budget are deleted everywhere. The
  // marker stays, only so a persisted ledger an earlier Sonah bounded is read as it was written.
  for (const name of ['FINAL_ANSWER_CAP', 'boundFinalAnswer']) assert.equal(Object.hasOwn(redaction, name), false, name);
  assert.equal(FINAL_ANSWER_OMISSION, '[… report middle omitted before review …]');
  assert.equal(FINAL_ANSWER_OMISSION.includes('recorder'), false);
  for (const name of ['FINAL_ANSWER_CAP', 'FINAL_ANSWER_OMISSION', 'boundFinalAnswer'])
    assert.equal(Object.hasOwn(interAgent, name), false, `${name} is redaction's, not the slicer's`);
});

// ---- the header, read exactly -------------------------------------------------------------------------------------

test('M33 F the header is read exactly: the closed type, the sender, the recipient, the payload', () => {
  // Task name is the recipient (the parent), Sender the helper: each is kept only as the row itself records it.
  assert.deepEqual(readAgentMessage(payload(finalAnswer('/root/fix_parser', TEXT.fixReport))),
    { type: 'final_answer', sender: '/root/fix_parser', recipient: '/root', text: TEXT.fixReport });
  // A payload keeps every byte after the header, its own newlines included.
  assert.deepEqual(readAgentMessage(payload(finalAnswer('/root/a/b', 'Line one.\n\nLine three.\n', { to: '/root/a' }))),
    { type: 'final_answer', sender: '/root/a/b', recipient: '/root/a', text: 'Line one.\n\nLine three.\n' });
  assert.deepEqual(readAgentMessage(payload(newTask('/root/fix_parser'))), { type: 'encrypted', messageType: 'NEW_TASK' });
  assert.deepEqual(readAgentMessage(payload(message('/root/fix_parser'))), { type: 'encrypted', messageType: 'MESSAGE' });
  // An encrypted payload block beside a plaintext report does not hide the report.
  assert.deepEqual(readAgentMessage(payload(finalAnswer('/root/x', 'Done.', { encrypted: TOKENS.answer }))),
    { type: 'final_answer', sender: '/root/x', recipient: '/root', text: 'Done.' });
  // A final answer whose readable payload is empty but whose payload the recorder encrypted is encrypted.
  assert.deepEqual(readAgentMessage(payload(agentMessage(header('FINAL_ANSWER', '/root', '/root/x'),
    { encrypted: TOKENS.answer, author: '/root/x', recipient: '/root' }))), { type: 'encrypted', messageType: 'FINAL_ANSWER' });
});

test('M33 F a header line the row itself does not record the same way names nobody', () => {
  const read = (row) => readAgentMessage(payload(row));
  // The Sender line is kept only when it equals the row's author; the Task name line only when it equals its recipient.
  assert.deepEqual(read(agentMessage(header('FINAL_ANSWER', '/root', '/root/fix_parser', 'Done.'),
    { author: '/root/impostor', recipient: '/root' })),
  { type: 'final_answer', sender: null, recipient: '/root', text: 'Done.' });
  assert.deepEqual(read(agentMessage(header('FINAL_ANSWER', '/root', '/root/fix_parser', 'Done.'),
    { author: '/root/fix_parser', recipient: '/root/fix_parser' })),
  { type: 'final_answer', sender: '/root/fix_parser', recipient: null, text: 'Done.' });
  // A row that records no author or recipient (both are optional row fields) confirms neither line.
  const bare = { type: 'agent_message', content: [{ type: 'input_text', text: header('FINAL_ANSWER', '/root', '/root/x', 'Done.') }],
    id: 'msg' };
  assert.deepEqual(readAgentMessage(bare), { type: 'final_answer', sender: null, recipient: null, text: 'Done.' });
  // Never by resemblance: a trailing space, another case, or a relative name is another value.
  assert.equal(read(agentMessage(header('FINAL_ANSWER', '/root', '/root/x', 'Done.'),
    { author: '/root/x ', recipient: '/Root' })).sender, null);
  assert.equal(read(agentMessage(header('FINAL_ANSWER', '/root', '/root/x', 'Done.'),
    { author: 'x', recipient: 'root' })).recipient, null);
});

test('M33 F anything but the exact recorded shape stays unparsed', () => {
  const unparsed = { type: 'unparsed' };
  const shapes = {
    'unknown message type': agentMessage(header('STATUS_UPDATE', '/root', '/root/x', 'working')),
    'lower-case type': agentMessage(header('final_answer', '/root', '/root/x', 'Done.')),
    'no header': agentMessage('Private child report.'),
    'header not at the start': agentMessage(` ${header('FINAL_ANSWER', '/root', '/root/x', 'Done.')}`),
    'CRLF header': agentMessage(header('FINAL_ANSWER', '/root', '/root/x', 'Done.').replace(/\n/g, '\r\n')),
    'missing sender line': agentMessage('Message Type: FINAL_ANSWER\nTask name: /root\nPayload:\nDone.'),
    'lines swapped': agentMessage('Message Type: FINAL_ANSWER\nSender: /root/x\nTask name: /root\nPayload:\nDone.'),
    'empty task name': agentMessage(header('FINAL_ANSWER', '', '/root/x', 'Done.')),
    'empty sender': agentMessage(header('FINAL_ANSWER', '/root', '', 'Done.')),
    'empty final answer, nothing encrypted': agentMessage(header('FINAL_ANSWER', '/root', '/root/x')),
    'blank final answer, nothing encrypted': agentMessage(header('FINAL_ANSWER', '/root', '/root/x', ' \n ')),
    'new task with a plaintext payload': agentMessage(header('NEW_TASK', '/root/x', '/root', 'Do it.'),
      { encrypted: TOKENS.task }),
    'new task with nothing encrypted': agentMessage(header('NEW_TASK', '/root/x', '/root')),
    'two readable blocks': agentMessage('', { blocks: [{ type: 'input_text', text: header('FINAL_ANSWER', '/root', '/root/x', 'A.') },
      { type: 'input_text', text: 'B.' }] }),
    'an unknown block': agentMessage('', { blocks: [{ type: 'input_text', text: header('FINAL_ANSWER', '/root', '/root/x', 'A.') },
      { type: 'input_image', image_url: 'x' }] }),
    'an encrypted block of another shape': agentMessage('', { blocks: [
      { type: 'input_text', text: header('NEW_TASK', '/root/x', '/root') }, { type: 'encrypted_content', data: 'opaque' }] }),
    'an empty encrypted block': agentMessage('', { blocks: [
      { type: 'input_text', text: header('NEW_TASK', '/root/x', '/root') }, { type: 'encrypted_content', encrypted_content: '' }] }),
    'content not a list': agentMessage('', { blocks: 'Message Type: FINAL_ANSWER' }),
    'an unknown row field': finalAnswer('/root/x', 'Done.', { extra: { phase: 'final' } }),
  };
  for (const [name, row] of Object.entries(shapes)) assert.deepEqual(readAgentMessage(payload(row)), unparsed, name);
  for (const value of [null, undefined, 42, 'agent_message', [], {}]) assert.deepEqual(readAgentMessage(value), unparsed);
});

// ---- attribution by exact recorded identity -----------------------------------------------------------------------

test('M33 F a final answer is attached as the result of the one hand-off whose task path its sender names', async (t) => {
  const { raw } = await slice(t, rootRows([
    finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/write_changelog', TEXT.limitReport),
  ]));
  const fix = byCall(raw, 'spawn-fix');
  const notes = byCall(raw, 'spawn-notes');
  assert.equal(fix.finalAnswer.text, TEXT.fixReport);
  assert.equal(fix.finalAnswer.truncated, undefined);
  assert.ok(Number.isSafeInteger(fix.finalAnswer.record) && fix.finalAnswer.record > 1, 'its own recorded row');
  // A harness error notice is still what the parent received: the recorded result, unjudged.
  assert.equal(notes.finalAnswer.text, TEXT.limitReport);
  expectCounts(raw, { interAgentFinalAnswersAttributed: 2 });
  // The header and the task path are the join, never evidence: only the payload is kept.
  assert.equal(JSON.stringify(raw).includes('Message Type:'), false);
});

test('M33 F the join is by the Sender line: a Task name that names a hand-off attaches nothing', async (t) => {
  const attached = async (row) => {
    const { raw } = await slice(t, rootRows([row]));
    return { fix: byCall(raw, 'spawn-fix').finalAnswer?.text ?? null, notes: byCall(raw, 'spawn-notes').finalAnswer?.text ?? null,
      counts: counts(raw) };
  };
  const unattributed = { fix: null, notes: null, counts: { ...zero, interAgentFinalAnswersUnattributed: 1 } };
  // The recorder's shape attaches: Task name /root (this recording, the recipient), Sender the helper (the author).
  assert.deepEqual(await attached(finalAnswer('/root/fix_parser', TEXT.fixReport)),
    { fix: TEXT.fixReport, notes: null, counts: { ...zero, interAgentFinalAnswersAttributed: 1 } });
  const cases = {
    // The first cut's key: the Task name names the hand-off, but the Sender (the author) is another helper.
    'task name names the hand-off, sender another helper': finalAnswer('/root/someone_else', TEXT.fixReport,
      { to: '/root/fix_parser' }),
    // Task name = Sender = the helper, as the first cut's fixture had it: addressed to no agent of this recording.
    'task name and sender both the helper': agentMessage(header('FINAL_ANSWER', '/root/fix_parser', '/root/fix_parser',
      TEXT.fixReport), { author: '/root/fix_parser', recipient: '/root/fix_parser' }),
    // The Sender line names the hand-off, but the row's author is another agent.
    'sender line not the author': agentMessage(header('FINAL_ANSWER', '/root', '/root/fix_parser', TEXT.fixReport),
      { author: '/root/someone_else', recipient: '/root' }),
    // The Task name line is /root, but the row's recipient is another agent.
    'task name line not the recipient': agentMessage(header('FINAL_ANSWER', '/root', '/root/fix_parser', TEXT.fixReport),
      { author: '/root/fix_parser', recipient: '/root/write_changelog' }),
    // The Sender names the hand-off, but the report was addressed to another agent than this recording's own.
    'addressed to another agent': finalAnswer('/root/fix_parser', TEXT.fixReport, { to: '/root/write_changelog' }),
  };
  for (const [name, row] of Object.entries(cases)) assert.deepEqual(await attached(row), unattributed, name);
  // A recording whose own task path is not recorded (a forked root) cannot prove the report was addressed to it, even
  // when the Sender equals a spawn's recorded result path.
  const forked = (await slice(t, [{ type: 'session_meta', payload: { id: 'root', cwd: '/repo', forked_from_id: 'older' } },
    ask(), ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief), finalAnswer('/root/fix_parser', TEXT.fixReport)])).raw;
  assert.equal(forked.delegations[0].finalAnswer, undefined);
  expectCounts(forked, { interAgentFinalAnswersUnattributed: 1 });
});

test('M33 F an attached report changes no status: it only proves the helper reported back', async (t) => {
  const without = (await slice(t, rootRows())).raw;
  const withReports = (await slice(t, rootRows([finalAnswer('/root/fix_parser', TEXT.fixReport)]))).raw;
  const strip = (ledger) => ledger.delegations.map(({ finalAnswer: _f, ...rest }) => rest);
  assert.deepEqual(strip(withReports), strip(without));
  assert.equal(byCall(withReports, 'spawn-fix').status, 'unresolved');
  assert.equal(byCall(withReports, 'spawn-fix').reason, 'delegation_child_unchecked');
  // A spawn the harness refused names no helper, so no report can be its result, and it stays failed.
  const refused = (await slice(t, [rootMeta(), ask(),
    ...spawn('spawn-x', 'fix_parser', TEXT.fixBrief, { is_error: true, error: 'spawn refused' }),
    finalAnswer('/root/fix_parser', TEXT.fixReport)])).raw;
  assert.equal(refused.delegations[0].status, 'failed');
  assert.equal(refused.delegations[0].finalAnswer, undefined);
  expectCounts(refused, { interAgentFinalAnswersUnattributed: 1 });
});

test('M33 F a spawn with no recorded result path is named by its task name, nested as Codex nests it', async (t) => {
  // The call records the relative task name; the root recording's own path is /root (parser-owned identity of an
  // intact, non-nested root, exactly the follow-up rule of child-links.js).
  const { raw } = await slice(t, [rootMeta(), ask(),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief, { agent_id: 'thread-7' }),
    finalAnswer('/root/fix_parser', TEXT.fixReport)]);
  assert.equal(raw.delegations[0].finalAnswer.text, TEXT.fixReport);
  expectCounts(raw, { interAgentFinalAnswersAttributed: 1 });
  // When the recorded result path and the called name disagree, the hand-off names no single path: fail closed.
  const conflicting = (await slice(t, [rootMeta(), ask(),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief, { task_name: '/root/other_task' }),
    finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/other_task', TEXT.fixReport)])).raw;
  assert.equal(conflicting.delegations[0].finalAnswer, undefined);
  expectCounts(conflicting, { interAgentFinalAnswersUnattributed: 2 });
});

test('M33 F a report naming no hand-off of this recording is not attached, and counted unattributed', async (t) => {
  const { raw } = await slice(t, rootRows([finalAnswer('/root/someone_else', TEXT.fixReport)]));
  assert.equal(raw.delegations.some((d) => d.finalAnswer), false);
  expectCounts(raw, { interAgentFinalAnswersUnattributed: 1 });
  assert.equal(raw.capture.incomplete, true);
  // A task path that is not a canonical Codex path can equal no hand-off's.
  const odd = (await slice(t, rootRows([finalAnswer('fix_parser', TEXT.fixReport),
    finalAnswer('/root/fix parser', TEXT.fixReport)]))).raw;
  expectCounts(odd, { interAgentFinalAnswersUnattributed: 2 });
});

test('M33 F an unattributed report is a typed communication loss, never a generic one', async (t) => {
  // The only hand-off failed (an explicit tool error): nothing else is incomplete.
  const { raw } = await slice(t, [rootMeta(), ask(),
    ...spawn('spawn-x', 'fix_parser', TEXT.fixBrief, { is_error: true }),
    finalAnswer('/root/someone_else', TEXT.fixReport)]);
  assert.equal(raw.capture.incomplete, true);
  assert.equal(raw.capture.genericIncomplete, false);
  assert.equal(raw.capture.interAgentMessagesSoleIncomplete, true);
  assert.deepEqual(raw.capture.reasons, [], 'counted, not a reason string');
});

test('M33 F a report two hand-offs could own is not attached, and counted ambiguous', async (t) => {
  // A spawn and a follow-up to the same helper both name its path: which assignment it answers is not recorded.
  const followed = (await slice(t, rootRows([
    call('followup_task', 'follow-fix', { target: 'fix_parser', message: 'Also rerun the tests.' }),
    output('follow-fix', { ok: true }),
    finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/write_changelog', TEXT.notesReport)]))).raw;
  assert.equal(byCall(followed, 'spawn-fix').finalAnswer, undefined);
  assert.equal(byCall(followed, 'follow-fix').finalAnswer, undefined);
  assert.equal(byCall(followed, 'spawn-notes').finalAnswer.text, TEXT.notesReport, 'the other helper is unaffected');
  expectCounts(followed, { interAgentFinalAnswersAmbiguous: 1, interAgentFinalAnswersAttributed: 1 });
  // A canonical follow-up target names the same path.
  const canonical = (await slice(t, rootRows([
    call('followup_task', 'follow-fix', { target: '/root/fix_parser', message: 'Also rerun the tests.' }),
    output('follow-fix', { ok: true }),
    finalAnswer('/root/fix_parser', TEXT.fixReport)]))).raw;
  expectCounts(canonical, { interAgentFinalAnswersAmbiguous: 1 });
  // Two spawns recorded the same path.
  const twice = (await slice(t, [rootMeta(), ask(),
    ...spawn('spawn-a', 'fix_parser', TEXT.fixBrief), ...spawn('spawn-b', 'fix_parser', TEXT.fixBrief),
    finalAnswer('/root/fix_parser', TEXT.fixReport)])).raw;
  assert.equal(twice.delegations.some((d) => d.finalAnswer), false);
  expectCounts(twice, { interAgentFinalAnswersAmbiguous: 1 });
  // One hand-off, two reports: which one is its result is not recorded either.
  const two = (await slice(t, rootRows([finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/fix_parser', TEXT.limitReport)]))).raw;
  assert.equal(byCall(two, 'spawn-fix').finalAnswer, undefined);
  expectCounts(two, { interAgentFinalAnswersAmbiguous: 2 });
});

test('M33 F a hand-off whose helper cannot be named makes every other match ambiguous', async (t) => {
  // A follow-up whose target is neither a task path nor a task name could address any helper.
  const { raw } = await slice(t, rootRows([
    call('followup_task', 'follow-x', { target: 'Fix Parser!', message: 'Keep going.' }),
    output('follow-x', { ok: true }),
    finalAnswer('/root/write_changelog', TEXT.notesReport),
    finalAnswer('/root/nobody', TEXT.fixReport)]));
  assert.equal(raw.delegations.some((d) => d.finalAnswer), false);
  expectCounts(raw, { interAgentFinalAnswersAmbiguous: 1, interAgentFinalAnswersUnattributed: 1 });
  // A spawn whose result row is missing still names the path its call recorded.
  const missing = (await slice(t, [rootMeta(), ask(),
    call('spawn_agent', 'spawn-fix', { message: TEXT.fixBrief, task_name: 'fix_parser' }),
    finalAnswer('/root/fix_parser', TEXT.fixReport)])).raw;
  assert.equal(missing.delegations[0].reason, 'delegation_result_missing');
  assert.equal(missing.delegations[0].finalAnswer.text, TEXT.fixReport);
});

test('M33 F attribution is within one recording: a report never joins a hand-off of another file', async (t) => {
  const first = await write(t, [rootMeta('root'), ask(), ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief)],
    'rollout-2026-10-01T12-00-00-first.jsonl');
  const second = await write(t, [rootMeta('root'), finalAnswer('/root/fix_parser', TEXT.fixReport)],
    'rollout-2026-10-01T12-00-01-second.jsonl');
  const raw = await sliceLineage([first, second]);
  assert.equal(raw.delegations[0].finalAnswer, undefined);
  expectCounts(raw, { interAgentFinalAnswersUnattributed: 1 });
});

test('M33 F a nested task path joins exactly, under the recording\'s own recorded path', async (t) => {
  const nestedMeta = (extra = {}) => ({ type: 'session_meta', payload: { id: 'child-a', cwd: '/repo',
    multi_agent_version: 'v2', source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/a' } } },
    ...extra } });
  // The spawn result records the full nested path.
  const recorded = (await slice(t, [nestedMeta(), ask('Do part a.'),
    ...spawn('spawn-b', 'b', 'Do part b.', { task_name: '/root/a/b' }),
    finalAnswer('/root/a/b', 'Part b is done.', { to: '/root/a' })])).raw;
  assert.equal(recorded.delegations[0].finalAnswer.text, 'Part b is done.');
  expectCounts(recorded, { interAgentFinalAnswersAttributed: 1 });
  // Only the relative name is recorded: nested under the recording's own recorded agent_path.
  const derived = (await slice(t, [nestedMeta(), ask('Do part a.'),
    ...spawn('spawn-b', 'b', 'Do part b.', { agent_id: 'thread-b' }),
    call('followup_task', 'follow-c', { target: 'c', message: 'Then part c.' }), output('follow-c', { ok: true }),
    finalAnswer('/root/a/b', 'Part b is done.', { to: '/root/a' }),
    finalAnswer('/root/a/c', 'Part c is done.', { to: '/root/a' })])).raw;
  assert.equal(byCall(derived, 'spawn-b').finalAnswer.text, 'Part b is done.');
  assert.equal(byCall(derived, 'follow-c').finalAnswer.text, 'Part c is done.');
  // Never by resemblance: the same name one level up, or a sibling's path, is another helper.
  const other = (await slice(t, [nestedMeta(), ask('Do part a.'),
    ...spawn('spawn-b', 'b', 'Do part b.', { agent_id: 'thread-b' }),
    finalAnswer('/root/b', 'Part b is done.', { to: '/root/a' }),
    finalAnswer('/root/a/b/b', 'Part b is done.', { to: '/root/a' }),
    // The right helper, but addressed to the root: not a report this recording (/root/a) received.
    finalAnswer('/root/a/b', 'Part b is done.')])).raw;
  assert.equal(other.delegations[0].finalAnswer, undefined);
  expectCounts(other, { interAgentFinalAnswersUnattributed: 3 });
  // A recording whose own path is not recorded cleanly cannot nest a relative name: that hand-off names no path.
  const conflicted = (await slice(t, [nestedMeta(), nestedMeta({ id: 'child-other' }), ask('Do part a.'),
    ...spawn('spawn-b', 'b', 'Do part b.', { agent_id: 'thread-b' }),
    finalAnswer('/root/a/b', 'Part b is done.', { to: '/root/a' })])).raw;
  assert.equal(conflicted.delegations[0].finalAnswer, undefined);
  expectCounts(conflicted, { interAgentFinalAnswersUnattributed: 1 });
});

test('M33 F a child recording read from its history boundary attributes its own helpers\' reports', async (t) => {
  const rows = [{ type: 'session_meta', payload: { id: 'child-a', cwd: '/repo', multi_agent_version: 'v2',
    subagent_history_start_ordinal: 1,
    source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/a' } } } } },
  newTask('/root/a'), ...spawn('spawn-b', 'b', 'Do part b.', { task_name: '/root/a/b' }),
  finalAnswer('/root/a/b', 'Part b is done.', { to: '/root/a' })].map((row, ordinal) => ({ ordinal, ...row }));
  const raw = await sliceLineage([await write(t, rows)], { childRecording: true, sidechainAsMain: true });
  assert.equal(raw.delegations[0].finalAnswer.text, 'Part b is done.');
  expectCounts(raw, { interAgentMessagesEncrypted: 1, interAgentFinalAnswersAttributed: 1 });
  // A child whose history turns out invalid keeps nothing — and still counts every report it read and withheld.
  const invalid = [...rows, { ordinal: 2, ...ask('A replayed row.') }];
  const withheld = await sliceLineage([await write(t, invalid)], { childRecording: true, sidechainAsMain: true });
  assert.equal(withheld.delegations, undefined);
  assert.ok(withheld.capture.reasons.includes('child_history_unchecked'), 'the withheld history is declared');
  expectCounts(withheld, { interAgentMessagesEncrypted: 1, interAgentFinalAnswersUnattributed: 1 });
});

// ---- encrypted and unparsed rows ----------------------------------------------------------------------------------

test('M33 F NEW_TASK and MESSAGE rows are counted as encrypted, apart from unparsed rows, and nothing is kept', async (t) => {
  const { raw, clean } = await slice(t, rootRows([newTask('/root/fix_parser'), message('/root/fix_parser'),
    message('/root/write_changelog'),
    agentMessage(header('STATUS_UPDATE', '/root', '/root/fix_parser', 'still working')),
    agentMessage('Private child report.')]));
  expectCounts(raw, { interAgentMessagesEncrypted: 3, interAgentMessagesUnparsed: 2 });
  for (const ledger of [raw, clean]) {
    const bytes = JSON.stringify(ledger);
    for (const token of [TOKENS.task, TOKENS.message]) assert.equal(bytes.includes(token.slice(0, 40)), false);
    assert.equal(bytes.includes('still working'), false, 'an unparsed row keeps nothing either');
    assert.equal(bytes.includes('Private child report'), false);
  }
  assert.equal(raw.capture.incomplete, true);
  assert.equal(raw.delegations.some((d) => d.finalAnswer), false);
});

test('M33 F encrypted messages alone are the sole, typed communication loss', async (t) => {
  const file = await write(t, [rootMeta(), ask(), newTask('/root/fix_parser'), message('/root/fix_parser')]);
  const source = await readCodexSession(file);
  assert.equal(source.meta.capture.interAgentMessagesEncrypted, 2);
  assert.equal(source.meta.capture.interAgentMessagesUnparsed, 0);
  assert.equal(source.meta.capture.incomplete, true);
  assert.equal(source.meta.capture.interAgentMessagesSoleIncomplete, true);
  assert.equal(source.meta.capture.attributedIncomplete, true);
  const raw = await sliceLineage([file]);
  assert.equal(raw.capture.interAgentMessagesSoleIncomplete, true);
  assert.equal(raw.capture.genericIncomplete, false);
  assert.deepEqual(raw.capture.reasons, []);
});

test('M33 F a recording with no inter-agent rows carries none of the new counters', async (t) => {
  const { raw } = await slice(t, rootRows());
  for (const key of Object.values(INTER_AGENT_COUNTS).filter((key) => key !== INTER_AGENT_COUNTS.unparsed))
    assert.equal(Object.hasOwn(raw.capture, key), false, key);
  assert.equal(raw.capture.interAgentMessagesUnparsed, 0, 'the existing counter is unchanged');
  assert.equal(raw.delegations.some((d) => Object.hasOwn(d, 'finalAnswer')), false);
});

test('M33 F a row that repeats a key stays an unsupported row, never an inter-agent message', async (t) => {
  const row = JSON.stringify(finalAnswer('/root/fix_parser', TEXT.fixReport))
    .replace('"type":"agent_message"', '"type":"future_action","type":"agent_message"');
  const { raw } = await slice(t, rootRows([row]));
  assert.equal(byCall(raw, 'spawn-fix').finalAnswer, undefined);
  expectCounts(raw, {});
  assert.equal(raw.capture.unsupported, 1);
});

// ---- the report, as recorded -----------------------------------------------------------------------------------------

test('M33 F, D90 a secret-shaped token in a report is kept as recorded, as tool output is', async (t) => {
  const report = `Deployed the fix.\nI used the key ${SECRET} to call the API.\nAll 13 tests pass.`;
  const { raw, clean } = await slice(t, rootRows([finalAnswer('/root/fix_parser', report)]));
  assert.ok(JSON.stringify(raw).includes(SECRET), 'the slicer keeps what was recorded');
  const kept = byCall(clean, 'spawn-fix').finalAnswer;
  assert.equal(kept.text, report);
  assert.equal(kept.redacted, undefined);
  // The slice hash covers the report: a different report is different evidence.
  const other = (await slice(t, rootRows([finalAnswer('/root/fix_parser', 'Deployed the fix.')]))).clean;
  const none = (await slice(t, rootRows())).clean;
  assert.notEqual(sliceHash(clean), sliceHash(other));
  assert.notEqual(sliceHash(other), sliceHash(none));
  assert.equal(sliceHash(none), sliceHash((await slice(t, rootRows())).clean), 'and stable');
});

test('D68 (E) the slicer and redaction keep a long report whole: no bound, no marker, nothing declared cut', async (t) => {
  const lines = Array.from({ length: 900 }, (_, i) => `Report line ${String(i).padStart(4, '0')} checked.`);
  const report = lines.join('\n');
  assert.ok(report.length > RETIRED.chars);
  const { raw, clean } = await slice(t, rootRows([finalAnswer('/root/fix_parser', report)]));
  const whole = byCall(raw, 'spawn-fix').finalAnswer;
  assert.equal(whole.text, report);
  assert.equal(Object.hasOwn(whole, 'truncated'), false);
  const kept = byCall(clean, 'spawn-fix').finalAnswer;
  assert.equal(kept.text, report);
  assert.equal(Object.hasOwn(kept, 'truncated'), false);
  // Redacting again changes nothing.
  assert.deepEqual(byCall(redact(structuredClone(clean)).ledger, 'spawn-fix').finalAnswer, kept);
});

// ---- a token at the retired head boundary ------------------------------------------------------------------------------

const TOKEN = `ghp_${'Zk3Qw8Rt'.repeat(4)}Ab9x`;
const fillerLines = (n, from = 0) => Array.from({ length: n }, (_, i) => `filler line ${String(from + i).padStart(4, '0')}.`);

test('M33 F, D90 a token at the retired head boundary of a report stands whole, as recorded', async (t) => {
  assert.equal(TOKEN.length, 40);
  for (let offset = 1; offset < TOKEN.length; offset += 7) {
    // In the report AS RECORDED the old head cut (code point 6000) falls `offset` characters into the token.
    const before = `${fillerLines(300).join('\n')}\n`;
    const lead = 'The deploy key is ';
    const pad = 'x'.repeat(RETIRED.head - [...before].length - lead.length - offset);
    const report = `${before}${pad}${lead}${TOKEN} and it worked.\n${fillerLines(400, 300).join('\n')}`;
    assert.equal([...report].slice(RETIRED.head - offset, RETIRED.head - offset + 4).join(''), 'ghp_');
    const { raw, clean } = await slice(t, rootRows([finalAnswer('/root/fix_parser', report)]));
    assert.equal(byCall(raw, 'spawn-fix').finalAnswer.text, report, 'the slicer cut nothing');
    const kept = byCall(clean, 'spawn-fix').finalAnswer;
    assert.deepEqual([kept.text, kept.truncated, kept.redacted], [report, undefined, undefined], `offset ${offset}`);
  }
});

// ---- where the parent received the report -------------------------------------------------------------------------

test('M33 F a report records the turn and row where the parent received it, not its hand-off\'s', async (t) => {
  const { raw, clean } = await slice(t, lateReportRows());
  const [handOff] = raw.delegations;
  assert.equal(handOff.turn, 1);
  assert.equal(handOff.finalAnswer.turn, 3, 'received in the third human turn');
  assert.ok(handOff.finalAnswer.record > handOff.record, 'on a row recorded after the hand-off');
  assert.equal(handOff.source, 0, 'in the hand-off\'s own recording');
  // Placement facts ride through redaction unchanged, and are hashed with the report.
  assert.deepEqual({ ...clean.delegations[0].finalAnswer, text: undefined }, { ...handOff.finalAnswer, text: undefined });
  const moved = structuredClone(clean);
  moved.delegations[0].finalAnswer.turn = 1;
  assert.notEqual(sliceHash(moved), sliceHash(clean));
});

test('M33 F the join and the counters are deterministic: same bytes in, same ledger out', async (t) => {
  const rows = rootRows([newTask('/root/fix_parser'), finalAnswer('/root/fix_parser', TEXT.fixReport),
    finalAnswer('/root/nobody', TEXT.notesReport)]);
  const a = (await slice(t, rows)).clean;
  const b = (await slice(t, rows)).clean;
  a.lineage.files = b.lineage.files;
  assert.deepEqual(a, b);
  assert.equal(sliceHash(a), sliceHash(b));
});
