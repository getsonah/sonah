// D150: hook rows and structured output, labelled by their recorder structure.
//   - a hook's context (`hook_additional_context`) is the harness's (`hook_context`); a hook command the harness ran
//     (`hook_success`, `hook_non_blocking_error`) is the harness's run (`hook_run`), never the agent's call. Their content
//     is not read yet: each keeps its declared loss, and no count, ledger or slice_hash moves for the label;
//   - a `structured_output` whose data equals, after a canonical JSON form, the input of the recorded call its
//     `toolUseID` names is the harness's copy of that call (`structured_output_copy`): harness context, no loss. Any
//     other keeps its declared loss.
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeLabeller } from '../src/records.js';
import { LABELS, LABEL_BASIS } from '../src/labels.js';

const SESSION = 'd150d150-0000-4000-8000-0000000004aa';
let seq = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-24T10:00:00.000Z', userType: 'external', uuid: `d150-h-${++seq}`,
  version: '2.1.308', ...extra });
const ask = row({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: 'Go.' } });
const call = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id, name, input }] } });
const result = (id) => row({ type: 'user', message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const attachment = (payload) => row({ type: 'attachment', attachment: payload });
const ANSWER = { verdict: 'done', items: [{ id: 1, ok: true }] };

async function read(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d150h-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return (await readSession(file)).meta.capture ?? {};
}
function labels(rows) {
  const labeller = claudeLabeller();
  const values = rows.map((one) => labeller.label(one));
  labeller.finish();
  return values;
}

test('D150: hook rows are the harness\'s by their type, and keep their declared loss', async (t) => {
  const hooks = [
    attachment({ type: 'hook_additional_context', content: ['Synthetic words a hook added.'], hookEvent: 'PostToolUse',
      hookName: 'PostToolUse:Bash', toolUseID: 'c-1' }),
    attachment({ type: 'hook_success', command: 'synthetic-hook', content: '', durationMs: 5, exitCode: 0,
      hookEvent: 'PostToolUse', hookName: 'PostToolUse:Bash', stderr: '', stdout: 'Synthetic output.', toolUseID: 'c-1' }),
    attachment({ type: 'hook_non_blocking_error', command: 'synthetic-hook', durationMs: 5, exitCode: 1,
      hookEvent: 'PostToolUse', hookName: 'PostToolUse:Bash', stderr: 'Synthetic error.', stdout: '', toolUseID: 'c-1' }),
  ];
  const rows = [ask, call('c-1', 'Bash', { command: 'npm test' }), result('c-1'), ...hooks];
  assert.deepEqual(labels(rows).slice(3).map((v) => [v.label, v.basis]), [[LABELS.harness, LABEL_BASIS.hookContext],
    [LABELS.harness, LABEL_BASIS.hookRun], [LABELS.harness, LABEL_BASIS.hookRun]]);
  const capture = await read(t, rows);
  assert.equal(capture.unsupportedRowChannels.observations, hooks.length);
  assert.equal(capture.harnessContextRows, undefined);
});

test('D150: a structured output that is the recorded input of its call is the harness\'s copy of it, no loss',
  async (t) => {
    const structured = (data, toolUseID = 's-1') => attachment({ type: 'structured_output', data, toolUseID });
    const reordered = { items: [{ ok: true, id: 1 }], verdict: 'done' };
    const rows = [ask, call('s-1', 'StructuredOutput', ANSWER), result('s-1'), structured(reordered)];
    assert.deepEqual([labels(rows)[3].label, labels(rows)[3].basis], [LABELS.harness, LABEL_BASIS.structuredOutputCopy]);
    const capture = await read(t, rows);
    assert.deepEqual([capture.harnessContextRows, capture.unsupportedRowChannels?.observations ?? 0], [1, 0]);
    // Other data, another call's id, or no recorded call: no twin, its declared loss stays.
    for (const other of [structured({ ...ANSWER, verdict: 'not done' }), structured(ANSWER, 's-2'),
      structured(ANSWER, 'c-9')]) {
      const more = [ask, call('s-1', 'StructuredOutput', ANSWER), call('s-2', 'StructuredOutput', { verdict: 'other' }),
        result('s-1'), other];
      assert.deepEqual([labels(more)[4].label, labels(more)[4].basis], [LABELS.harness, LABEL_BASIS.attachmentRow]);
      const capture2 = await read(t, more);
      assert.deepEqual([capture2.harnessContextRows, capture2.unsupportedRowChannels.observations], [undefined, 1]);
    }
  });
