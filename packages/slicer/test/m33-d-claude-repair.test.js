// M33 D repair (review of 181ae85), three narrowings of the Claude Code drift reading:
//   - A repeated Edit or Write result whose typed sidecar differs is two results for one call. Taking
//     the Edit sidecar out of the parsed result text must not take it out of the repeat check: the
//     call is retracted (a declared missing observation), never proved by the first sidecar.
//   - The resumed-parent shape is exactly two recorded sessionIds in two contiguous blocks. A third
//     session, or a row of the first session after the second began, is not that shape.
//   - A Workflow call whose own result recorded no successful launch keeps its children loss, under
//     its own fixed note: it is never said to have run agents, and never dropped.
// Every row is synthetic and mirrors only the recorder's known key sets. No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { recordingIdentity } from '../src/recording-identity.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, WORKFLOW_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';

const SESSION = 'c0ffee00-0000-4000-8000-00000000000d';
const row = (extra) => ({ sessionId: SESSION, cwd: '/repo', isSidechain: false, version: '2.1.260', ...extra });
const ask = (text) => row({ type: 'user', message: { role: 'user', content: text } });
const use = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const answer = (id, content, { isError, sidecar } = {}) => row({ type: 'user', message: { role: 'user',
  content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(sidecar === undefined ? {} : { toolUseResult: sidecar }) });

async function review(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-d-repair-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, [ask('Edit it.'), ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'm33-d-repair' });
  const gap = (code, channel = 'observations') => session.adapterGaps
    .filter((g) => g.code === code && g.channel === channel);
  const ids = (code, channel) => gap(code, channel).flatMap((g) => g.eventIds ?? []);
  return { raw, session, gap, ids };
}

// ------------------------------------------------------------------------------------------------
const EDIT_INPUT = Object.freeze({ file_path: '/repo/src/a.js', old_string: 'const a = 1;', new_string: 'const a = 2;' });
const EDIT_SIDECAR = Object.freeze({ filePath: '/repo/src/a.js', oldString: 'const a = 1;', newString: 'const a = 2;',
  originalFile: 'const a = 1;\n', replaceAll: false, structuredPatch: [], userModified: false });
const UPDATED = 'The file /repo/src/a.js has been updated successfully.';
const WRITE_INPUT = Object.freeze({ file_path: '/repo/src/b.js', content: 'export const b = 1;\n' });
const WRITE_SIDECAR = Object.freeze({ type: 'create', filePath: '/repo/src/b.js', content: 'export const b = 1;\n',
  originalFile: null, structuredPatch: [], userModified: false });
const CREATED = 'File created successfully at: /repo/src/b.js';
const KIND = Object.freeze({ Edit: 'edit', Write: 'create' });

test('M33 D repair: a repeated Edit or Write result whose sidecar differs is retracted, never a native success', async (t) => {
  const cases = [
    ['Edit repeat modified by the user', 'Edit', EDIT_INPUT, UPDATED, EDIT_SIDECAR, { ...EDIT_SIDECAR, userModified: true }],
    ['Edit repeat naming another file', 'Edit', EDIT_INPUT, UPDATED, EDIT_SIDECAR, { ...EDIT_SIDECAR, filePath: '/repo/src/z.js' }],
    ['Edit repeat with another prior file', 'Edit', EDIT_INPUT, UPDATED, EDIT_SIDECAR, { ...EDIT_SIDECAR, originalFile: 'const a = 9;\n' }],
    ['Write repeat naming another file', 'Write', WRITE_INPUT, CREATED, WRITE_SIDECAR, { ...WRITE_SIDECAR, filePath: '/repo/src/z.js' }],
    ['Write repeat with another write type', 'Write', WRITE_INPUT, CREATED, WRITE_SIDECAR, { ...WRITE_SIDECAR, type: 'update' }],
  ];
  for (const [name, tool, input, text, first, second] of cases) {
    const r = await review(t, [use('w1', tool, input), answer('w1', text, { sidecar: first }),
      answer('w1', text, { sidecar: second })]);
    const acts = r.raw.ledger.filter((e) => e.kind === KIND[tool]);
    assert.equal(acts.length, 1, name);
    const [act] = acts;
    assert.equal(act.observationMissing, true, name);
    assert.equal(act.result, undefined, `${name}: neither sidecar is the call's result`);
    // C-01 event identity: the call's event, found by what it is (the session's one action), never by turn and seq.
    const [{ id }] = r.session.events.filter((e) => e.kind === 'invocation');
    assert.deepEqual(r.ids('write_outcome_unknown'), [id], name);
    // The call's missing result is declared as the counted observation loss, as for any retraction.
    assert.equal(r.raw.capture.observationsMissing, 1, name);
    assert.equal(r.gap('incomplete_inventory').filter((g) => /no attributable result/.test(g.note))
      .reduce((n, g) => n + g.count, 0), 1, `${name}: the missing observation is declared`);
  }
});

test('M33 D repair: an identical repeat of an Edit or Write result is one result', async (t) => {
  const r = await review(t, [
    use('e1', 'Edit', EDIT_INPUT), answer('e1', UPDATED, { sidecar: EDIT_SIDECAR }), answer('e1', UPDATED, { sidecar: EDIT_SIDECAR }),
    use('c1', 'Write', WRITE_INPUT), answer('c1', CREATED, { sidecar: WRITE_SIDECAR }), answer('c1', CREATED, { sidecar: WRITE_SIDECAR }),
  ]);
  for (const tool of ['Edit', 'Write']) {
    const act = r.raw.ledger.find((e) => e.kind === KIND[tool]);
    assert.equal(act.observationMissing, undefined, tool);
    assert.deepEqual(act.result, { seen: true, outcome: 'succeeded', provenance: 'native' }, tool);
  }
  assert.deepEqual(r.ids('write_outcome_unknown'), []);
});

// ------------------------------------------------------------------------------------------------
test('M33 D repair: the resumed shape is exactly two recorded sessionIds in two contiguous blocks', () => {
  const read = (sessions) => {
    const identity = recordingIdentity('claude');
    for (const sessionId of sessions) identity.observe(sessionId === undefined
      ? { type: 'file-history-snapshot' } : { type: 'user', sessionId });
    return identity.value();
  };
  const resumed = (value) => [value.identityConflict, value.sessionId, value.sessionIdConflictOnly];
  assert.deepEqual(resumed(read(['prior', 'prior', 'current', 'current'])), [true, null, true]);
  // A row that records no session does not break a block.
  assert.deepEqual(resumed(read(['prior', undefined, 'current', undefined, 'current'])), [true, null, true]);
  // A row of the first session after the second began: interleaved, not a copied prefix.
  assert.deepEqual(resumed(read(['prior', 'current', 'prior'])), [true, null, undefined]);
  assert.deepEqual(resumed(read(['prior', 'current', 'current', 'prior', 'current'])), [true, null, undefined]);
  // A third recorded session, contiguous or not.
  assert.deepEqual(resumed(read(['first', 'second', 'third'])), [true, null, undefined]);
  assert.deepEqual(resumed(read(['first', 'first', 'second', 'third', 'third'])), [true, null, undefined]);
  // One session is no conflict at all.
  assert.deepEqual(resumed(read(['only', undefined, 'only'])), [false, 'only', undefined]);
});

// ------------------------------------------------------------------------------------------------
const WORKFLOW_RESULT = (taskId) => ({ runId: 'wrun0000000009', scriptPath: '/private/tmp/wf.js', status: 'async_launched',
  summary: 'launched', taskId, taskType: 'local_workflow', transcriptDir: `/private/tmp/${SESSION}/subagents/workflows/wrun0000000009`,
  workflowName: 'synthetic' });

test('M33 D repair: a Workflow call that recorded no successful launch keeps a children loss under its own note', async (t) => {
  const r = await review(t, [
    use('wf1', 'Workflow', { script: 'agent("a")' }),
    answer('wf1', 'Workflow launched. Task ID: wtask0009', { isError: false, sidecar: WORKFLOW_RESULT('wtask0009') }),
    use('wf2', 'Workflow', { script: 'agent(' }),
    answer('wf2', 'Error: the workflow script did not parse', { isError: true, sidecar: 'Error: the workflow script did not parse' }),
    use('wf3', 'Workflow', { script: 'agent("c")' }),
  ]);
  // C-01 event identity: the calls' events, by what they are, in recorded order.
  const ids = r.session.events.filter((e) => e.kind === 'invocation' && e.tool === 'Workflow').map((e) => e.id);
  assert.equal(ids.length, 3);
  const children = r.gap('incomplete_inventory', 'children');
  assert.deepEqual(children.map((g) => [g.note, g.count, g.eventIds]), [
    [WORKFLOW_GAP_NOTES.agents, 1, [ids[0]]],
    [WORKFLOW_GAP_NOTES.unlaunched, 2, [ids[1], ids[2]]],
  ]);
  assert.equal(new Set(Object.values(WORKFLOW_GAP_NOTES)).size, Object.keys(WORKFLOW_GAP_NOTES).length);
  assert.ok(Object.isFrozen(WORKFLOW_GAP_NOTES));
});
