// The read side of capture-time exit codes. Early previews' PostToolUse hook (`sonah capture-outcome`, retired in D76)
// wrote one line per Bash call to ~/.sonah/outcomes/<session_id>.ndjson; nothing writes them now, and the sidecars
// already on disk are still read. Every sidecar here is written by the test, in the hook's line format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { loadOutcomes, outcomesFor } from '../src/outcomes.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

// Every test gets its own throwaway HOME — nothing here may touch the real ~/.sonah.
const freshHome = () => scratchDir('sonah-outcomes-');

/** A sidecar as the hook wrote it: one JSON line per call, `{k, tool, exitCode, interrupted}`. */
async function sidecar(home, sessionId, rows) {
  await mkdir(join(home, 'outcomes'), { recursive: true });
  await writeFile(join(home, 'outcomes', `${sessionId}.ndjson`),
    rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n', 'utf8');
}

test('a recorded line loads by session id and tool_use_id', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [{ k: 'toolu_01ABC123', tool: 'Bash', exitCode: 1, interrupted: false }]);
  const map = await loadOutcomes('abc123', { home });
  assert.equal(map.size, 1);
  assert.deepEqual(map.get('toolu_01ABC123'), { exitCode: 1, interrupted: false, tool: 'Bash' });
});

test('lines accumulate; a conflicting duplicate tool_use_id is permanently ambiguous', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [['toolu_A', 0], ['toolu_B', 2], ['toolu_A', 7], ['toolu_A', 0]]
    .map(([k, exitCode]) => ({ k, tool: 'Bash', exitCode, interrupted: false })));
  const map = await loadOutcomes('abc123', { home });
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('toolu_A'), { exitCode: null, interrupted: null, tool: null, ambiguous: true });
  assert.equal(map.get('toolu_B').exitCode, 2);
});

test('an exact replay stays usable and compatible partial rows combine', async () => {
  const home = await freshHome();
  const replay = { k: 'toolu_01ABC123', tool: 'Bash', exitCode: 2, interrupted: false };
  await sidecar(home, 'abc123', [replay, replay]);
  assert.deepEqual((await loadOutcomes('abc123', { home })).get('toolu_01ABC123'),
    { exitCode: 2, interrupted: false, tool: 'Bash' });

  await sidecar(home, 'partial', [{ k: 'toolu_partial', exitCode: 2 }, { k: 'toolu_partial', interrupted: false, tool: 'Bash' }]);
  assert.deepEqual((await loadOutcomes('partial', { home })).get('toolu_partial'),
    { exitCode: 2, interrupted: false, tool: 'Bash' });
});

test('contradictory interruption or tool identity withholds the sidecar result', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [
    { k: 'toolu_interrupt', interrupted: false },
    { k: 'toolu_interrupt', interrupted: true },
    { k: 'toolu_tool', exitCode: 0, tool: 'Bash' },
    { k: 'toolu_tool', exitCode: 0, tool: 'Read' },
  ]);
  const map = await loadOutcomes('abc123', { home });
  for (const id of ['toolu_interrupt', 'toolu_tool']) {
    assert.deepEqual(map.get(id), { exitCode: null, interrupted: null, tool: null, ambiguous: true });
  }
});

test('lineage merge cannot restore a conflicting hook result by file order', async () => {
  const home = await freshHome();
  for (const [sid, exitCode] of [['first', 2], ['second', 0]]) {
    await sidecar(home, sid, [{ k: 'toolu_reused', tool: 'Bash', exitCode, interrupted: false }]);
  }
  for (const files of [['first.jsonl', 'second.jsonl'], ['second.jsonl', 'first.jsonl']]) {
    assert.deepEqual((await outcomesFor(files, { home })).get('toolu_reused'), {
      exitCode: null, interrupted: null, tool: null, ambiguous: true,
    });
  }
});

test('interrupted:true without an exit code is still evidence', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [{ k: 'toolu_01ABC123', tool: 'Bash', interrupted: true }]);
  assert.deepEqual((await loadOutcomes('abc123', { home })).get('toolu_01ABC123'),
    { exitCode: null, interrupted: true, tool: 'Bash' });
});

test('session_id is a filename: traversal and separators are never read', async () => {
  const home = await freshHome();
  await sidecar(join(home, 'nested'), 'evil', [{ k: 'toolu_evil', exitCode: 0 }]);
  for (const evil of ['../nested/outcomes/evil', '..', '.', 'a/b', 'a\\b', '.hidden', 'x'.repeat(200), '']) {
    assert.equal((await loadOutcomes(evil, { home })).size, 0, `session_id ${JSON.stringify(evil)}`);
  }
});

test('loadOutcomes: missing session -> empty Map, garbage lines skipped individually', async () => {
  const home = await freshHome();
  assert.equal((await loadOutcomes('nope', { home })).size, 0);
  await sidecar(home, 'abc123', [
    '{"k":"toolu_good","exitCode":0,"interrupted":false,"tool":"Bash"}',
    'this line is garbage',
    '{"no key":true}',
    '{"k":"toolu_partial"}',       // key but no evidence fields: normalized to nulls
    '',
  ]);
  const map = await loadOutcomes('abc123', { home });
  assert.equal(map.size, 2);
  assert.deepEqual(map.get('toolu_good'), { exitCode: 0, interrupted: false, tool: 'Bash' });
  assert.deepEqual(map.get('toolu_partial'), { exitCode: null, interrupted: null, tool: null });
});

test('SONAH_HOME is honored when no home option is given', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [{ k: 'toolu_01ABC123', tool: 'Bash', exitCode: 0, interrupted: false }]);
  const prev = process.env.SONAH_HOME;
  process.env.SONAH_HOME = home;
  try {
    assert.equal((await loadOutcomes('abc123')).get('toolu_01ABC123').exitCode, 0);
  } finally {
    if (prev === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = prev;
  }
});

test('outcomesFor merges the capture-time outcomes of every file in a lineage - the one loader all slicers use', async () => {
  const home = await freshHome();
  await sidecar(home, 'abc123', [{ k: 'toolu_01ABC123', tool: 'Bash', exitCode: 2, interrupted: false }]);
  const m = await outcomesFor(['abc123.jsonl', 'nope.jsonl'], { home });
  assert.deepEqual(m.get('toolu_01ABC123'), { exitCode: 2, interrupted: false, tool: 'Bash' },
    'the recorded outcome is loaded by session id from the file name');
});
