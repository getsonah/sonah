// What a recorded result is allowed to claim.
//
// The rule this file pins: an outcome is read from a POSITIVE recorded signal, never from the
// absence of a negative one. Before this, a tool result with no `is_error` flag, no exit code and
// no recognisable output produced `{ outcome: 'succeeded', provenance: 'native' }` — a guess,
// labelled as if the harness had reported it (H44, M92). Two more recordings of the same fact
// were mishandled: a recorded exit code overrode a contradicting `is_error` instead of declaring
// the disagreement (M91), and a command the user interrupted read as passed (M90).
//
// One test per row of the spec's table. Every fixture is synthetic; no real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';

let seq = 0;
const uid = () => `id-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-result', cwd: '/repo', version: '2.1.205', gitBranch: 'main', isSidechain: false };

const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
/** `isError === undefined` means the flag was ABSENT, which is not the same as `false`. */
const toolResult = (id, content, { isError, toolUseResult } = {}) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content,
    ...(isError === undefined ? {} : { is_error: isError }) }] },
  ...(toolUseResult === undefined ? {} : { toolUseResult }) });

/** Slice a one-file synthetic session, optionally with capture-time hook evidence. */
async function slice(records, hookOutcomes) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-result-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    return await sliceLineage([file], hookOutcomes ? { outcomes: new Map(Object.entries(hookOutcomes)) } : {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const hook = (exitCode, interrupted = null) => ({ exitCode, interrupted, tool: 'Bash' });

const write = (id, result, hookOutcomes) => slice([
  userTurn('add the pricing module'),
  toolUse(id, 'Write', { file_path: '/repo/src/price.js', content: 'export const rate = 1;\n' }),
  result,
], hookOutcomes).then((l) => l.ledger.find((e) => e.path === 'src/price.js'));

const bash = (id, result, hookOutcomes) => slice([
  userTurn('run the linter'),
  toolUse(id, 'Bash', { command: 'eslint src' }),
  result,
], hookOutcomes).then((l) => l.ledger.find((e) => e.cmd === 'eslint src'));

// ---- row: none of the above -> unknown, no provenance --------------------------------------

test('a write whose result carries no success signal is unknown, never succeeded (H44, M92)', async () => {
  const ev = await write('t1', toolResult('t1', '/repo/src/price.js'));
  assert.equal(ev.result.seen, true);
  assert.equal(ev.result.outcome, 'unknown');
  assert.equal('provenance' in ev.result, false, 'a guess must not be labelled native');
});

test('an empty recorded result is seen but says nothing (H44)', async () => {
  const ev = await write('t1b', toolResult('t1b', ''));
  assert.equal(ev.result.seen, true);
  assert.equal(ev.result.outcome, 'unknown');
  assert.equal('provenance' in ev.result, false);
});

// ---- row: structured success (toolUseResult.type) -> succeeded / native ---------------------

test('a structured create result is a positive signal from the harness', async () => {
  const ev = await write('t2', toolResult('t2', 'ok-ish', { toolUseResult: { type: 'create', filePath: '/repo/src/price.js' } }));
  assert.equal(ev.result.outcome, 'succeeded');
  assert.equal(ev.result.provenance, 'native');
});

test('a structured update result is a positive signal from the harness', async () => {
  const ev = await write('t3', toolResult('t3', 'edited', { toolUseResult: { type: 'update', filePath: '/repo/src/price.js' } }));
  assert.equal(ev.result.outcome, 'succeeded');
  assert.equal(ev.result.provenance, 'native');
});

// ---- row: is_error true, no conflicting code -> failed / native ----------------------------

test('is_error with no exit code is a recorded failure', async () => {
  const ev = await write('t4', toolResult('t4', 'EACCES: permission denied', { isError: true }));
  assert.equal(ev.result.outcome, 'failed');
  assert.equal(ev.result.provenance, 'native');
  assert.equal(ev.attempted, 'create', 'a failure does not change what was attempted');
});

// ---- row: is_error true AND exitCode 0 -> unknown + conflict / native ----------------------

test('a write whose flag and exit code disagree is unknown and says so (M91)', async () => {
  const ev = await write('t5', toolResult('t5', 'wrote it', { isError: true }), { t5: hook(0) });
  assert.equal(ev.result.outcome, 'unknown');
  assert.equal(ev.result.conflict, true);
  assert.equal(ev.result.provenance, 'native');
});

test('a command whose flag and exit code disagree is unknown, not passed (M91)', async () => {
  const ev = await bash('t6', toolResult('t6', 'ok', { isError: true }), { t6: hook(0) });
  assert.equal(ev.outcome, 'unknown');
  assert.equal(ev.conflict, true);
});

// ---- row: exitCode recorded and non-zero -> failed / native --------------------------------

test('a recorded non-zero exit code fails the write with no error flag present', async () => {
  const ev = await write('t7', toolResult('t7', 'partial'), { t7: hook(2) });
  assert.equal(ev.result.outcome, 'failed');
  assert.equal(ev.result.provenance, 'native');
  assert.equal(ev.result.exitCode, 2);
});

// ---- row: exitCode 0 -> succeeded / native -------------------------------------------------

test('a recorded zero exit code is a positive signal', async () => {
  const ev = await write('t8', toolResult('t8', 'done-ish'), { t8: hook(0) });
  assert.equal(ev.result.outcome, 'succeeded');
  assert.equal(ev.result.provenance, 'native');
  assert.equal(ev.result.exitCode, 0);
});

// ---- row: recognised success line in the text -> succeeded / parsed-output ------------------

test('H1: output text other than the file tool\'s own sentence is no status, even for a write', async () => {
  for (const text of ['ok', 'Done', '3 passed', 'Compiled successfully']) {
    const ev = await write('t9', toolResult('t9', text));
    assert.equal(ev.result.outcome, 'unknown', text);
    assert.equal(ev.result.provenance, undefined, text);
  }
});

test("the harness's own write-success sentence counts, and is still only parsed output", async () => {
  // Recordings without `toolUseResult.type` carry this sentence and nothing else. It is a real
  // positive signal — but it arrives as text, so it may never claim `native`.
  for (const line of ['File created successfully at: /repo/src/price.js',
                      'The file /repo/src/price.js has been updated.',
                      'Applied 3 edits to /repo/src/price.js:']) {
    const ev = await write('t9b', toolResult('t9b', line));
    assert.equal(ev.result.outcome, 'succeeded', line);
    assert.equal(ev.result.provenance, 'parsed-output', line);
  }
});

// ---- row: interrupted -> unknown + ev.interrupted / native ---------------------------------

test('an interrupted command is unknown, whatever its partial output looks like (M90)', async () => {
  const ev = await bash('t10', toolResult('t10', 'ok'), { t10: hook(null, true) });
  assert.equal(ev.outcome, 'unknown');
  assert.equal(ev.interrupted, true);
});

test('an interrupted write is unknown, and the flag is a field, not a reason', async () => {
  const ev = await write('t11', toolResult('t11', 'ok'), { t11: hook(null, true) });
  assert.equal(ev.result.outcome, 'unknown');
  assert.equal(ev.result.provenance, 'native');
  assert.equal(ev.interrupted, true);
});
