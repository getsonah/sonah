// D99 (F1 guard): the loader keeps the recorder census beside the ledger, never on it, summed over every recording it
// reads, and hands it to the run record (recorded-session.js `census`). Synthetic recordings only; no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionEvidence, recorderCensusOf } from '../src/session-evidence.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';

const SESSION = 'c0ffee00-0000-4000-8000-0000000000f9';
let n = 0;
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.299', uuid: `f-${n++}`,
  ...extra });
const rows = [
  row({ type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'Run the build in the background.' } }),
  row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash',
    input: { command: 'npm run build', run_in_background: true } }] } }),
  row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', is_error: false,
    content: 'Command running in background with ID: bgf1.' }] }, toolUseResult: { stdout: '', stderr: '',
    interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: 'bgf1' } }),
  // A notice with no call id: the labeller labels it, the status join cannot type it, and it names the run's id.
  row({ type: 'user', origin: { kind: 'task-notification', producer: 'session-task' }, message: { role: 'user',
    content: '<task-notification>\n<task-id>bgf1</task-id>\n<status>completed</status>\n</task-notification>' } }),
  // A Workflow run in the background, and a later harness row that names its task id.
  row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'w1', name: 'Workflow',
    input: { script: 'x', run_in_background: true } }] } }),
  row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'w1', is_error: false,
    content: 'Workflow launched. Task ID: wtf1' }] }, toolUseResult: { status: 'async_launched', taskId: 'wtf1',
    runId: 'r1', transcriptDir: '/t', workflowName: 'w' } }),
  row({ type: 'attachment', attachment: { type: 'task_progress', content: 'wtf1 progress' } }),
];

test('D99 F1 guard: the loader keeps the census beside the ledger and hands it to the run record', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d99-load-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'codex', 'sessions'), { recursive: true });
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ledger = await loadSessionEvidence([file], { outcomes: new Map(), recordingRoots: { codex: join(dir, 'codex') } });
  assert.equal(Object.hasOwn(ledger, 'recorderCensus'), false, 'never on the ledger');
  const census = recorderCensusOf(ledger);
  assert.deepEqual(census.notices, { labelled: 1, typed: 0 });
  assert.deepEqual(census.launches, { background: 1, typed: 0, stopped: 0, unread: 1, absent: 0, other: 0, linked: 0,
    linkedOther: 0 });
  // The sum keeps each unread end apart by its run's kind: a Bash run and a Workflow run under one reason and version.
  assert.deepEqual(census.entries, [{ reason: 'end_unread_mentioned', kind: 'bash', version: '2.1.299', count: 1 },
    { reason: 'end_unread_mentioned', kind: 'workflow', version: '2.1.299', count: 1 },
    { reason: 'notification_no_call_id', version: '2.1.299', count: 1 }]);
  assert.equal(recorderCensusOf({}), null, 'a ledger the loader did not return has none');
  const loaded = await loadRecordedSessionWithHash({ parent: file, codexHome: join(dir, 'codex') });
  assert.deepEqual(loaded.census, census);
  assert.equal(JSON.stringify(loaded.session.events).includes('notification_no_call_id'), false);
});
