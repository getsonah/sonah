import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { COMBINED_WINDOW_SETTINGS, planWindows } from '../../evidence/src/windows.js';
import { runReview } from '../../evidence/src/run-review.js';

const sid = 'e3f1c2d4-1111-4222-8333-abcdefabcdef';
const agentId = '0123456789abcdef';
const record = (row) => ({ cwd: '/repo', sessionId: sid, ...row });
const save = (file, rows) => writeFile(file, rows.map((row) => JSON.stringify(record(row))).join('\n') + '\n',
  { mode: 0o600 });

test('PR review transfers verified child A/O into one completed review window', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah pr child review ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects');
  const project = join(projects, '-Users-synthetic-repo');
  const nested = join(project, sid, 'subagents');
  await mkdir(nested, { recursive: true });
  const parent = join(project, `${sid}.jsonl`);
  const child = join(nested, `agent-${agentId}.jsonl`);
  // M34 labels review (F6): the parent is a typed recorder (2.1.219 and later), whose human prompt carries the host's
  // typed origin; an unversioned one is labelled by the declared legacy fallback, every row of it a counted gap.
  await save(parent, [
    { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'Inspect the implementation.' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'spawn-1', name: 'Agent', input: { prompt: 'Inspect one file.' } },
    ] } },
    // L2: the typed launch sidecar Claude Code writes decides the launch, never the prose.
    { type: 'user', toolUseResult: { status: 'async_launched', isAsync: true, agentId, description: 'inspect' },
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'spawn-1', content: `Async agent launched.\nagentId: ${agentId}` },
      ] } },
    // M33 P second repair: the launch stub is a launch, received by its completion notification (with none, its work
    // would be declared placed after the session's last request: m33-p-repair2.test.js).
    { type: 'user', origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n`
      + `<task-id>${agentId}</task-id>\n<tool-use-id>spawn-1</tool-use-id>\n<status>completed</status>\n`
      + '<summary>Agent finished</summary>\n</task-notification>' } },
  ].map((row) => ({ ...row, isSidechain: false, version: '2.1.284' })));
  await save(child, [
    { type: 'user', message: { role: 'user', content: 'Inspect one file.' } },
    { type: 'assistant', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: '/repo/src/a.js' } },
    ] } },
    { type: 'user', message: { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'read-1', content: 'const answer = 1;' },
    ] } },
  ].map((row) => ({ ...row, agentId, isSidechain: true })));
  const ledger = await loadSessionEvidence([parent],
    { recordingRoots: { claude: projects }, reviewLinkedChildren: true });
  const session = sessionFromLedger(ledger, { sessionKey: 'pr-child-synthetic' });
  assert.equal(session.children.length, 1);
  assert.equal(session.children[0].state, 'verified');
  assert.equal(session.adapterGaps.length, 0);
  const childEvents = session.events.filter((event) => event.childId === agentId);
  assert.equal(childEvents.filter((event) => event.kind === 'invocation').length, 1);
  assert.equal(childEvents.filter((event) => event.kind === 'observation').length, 1);
  // M35 windowing: a combined review's windows (the linked child's are its own).
  const windows = planWindows(session, COMBINED_WINDOW_SETTINGS);
  for (const event of childEvents)
    assert.equal(windows.flatMap((window) => window.events).filter((item) => item.id === event.id).length, 1);
  const report = await runReview({ session,
    pr: { repo: { host: 'local', id: 'synthetic' }, files: [] },
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [] }) });
  assert.equal(report.instrument.windowCompletion.complete, windows.length);
  assert.equal(report.sessionStatus, 'CLEAN');
});
