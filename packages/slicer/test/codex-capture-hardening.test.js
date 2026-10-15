// Synthetic Codex recordings only. No private rollout text belongs in these fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCodexSession } from '../src/codex.js';
import { readExecCalls, isCodeTool } from '../src/codex-exec.js';
import { sliceLineage } from '../index.js';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { runReview } from '../../evidence/src/run-review.js';
import { scratchDir } from './scratch-dir.js';

const row = (payload) => JSON.stringify({ type: 'response_item', payload });
const direct = (name, id, input) => row({ type: 'function_call', name, call_id: id,
  arguments: JSON.stringify(input) });
const output = (id, value) => row({ type: 'function_call_output', call_id: id, output: value });
const wrapper = (id, source) => row({ type: 'custom_tool_call', name: 'functions.exec', call_id: id, input: source });
const wrapperOutput = (id, ...values) => row({ type: 'custom_tool_call_output', call_id: id,
  output: [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
    ...values.map((value) => ({ type: 'input_text', text: JSON.stringify(value) }))] });

async function fixture(lines) {
  const dir = await scratchDir('sonah-codex-capture-');
  const path = join(dir, 'rollout-2026-09-24T12-00-00-synthetic.jsonl');
  await writeFile(path, [JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } }),
    row({ type: 'message', role: 'user', content: 'Check the files.' }), ...lines].join('\n'));
  return path;
}

test('known MCP save and trash file tools survive direct and wrapper capture', async () => {
  assert.equal(isCodeTool('mcp__fs__save_file'), true);
  assert.equal(isCodeTool('mcp__fs__trash_file'), true);
  assert.equal(readExecCalls('text(await tools.mcp__fs__save_file({file_path:"a.js",content:"next"}));').calls.length, 1);
  const file = await fixture([
    direct('mcp__fs__save_file', 'save-direct', { file_path: 'direct.js', content: 'next' }),
    output('save-direct', { output: 'saved' }),
    direct('mcp__fs__trash_file', 'trash-direct', { file_path: 'old.js' }),
    output('trash-direct', { output: 'trashed' }),
    wrapper('wrap', 'text(await tools.mcp__fs__save_file({file_path:"wrapped.js",content:"new"})); '
      + 'text(await tools.mcp__fs__trash_file({file_path:"stale.js"}));'),
    wrapperOutput('wrap', { output: 'saved' }, { output: 'trashed' }),
  ]);
  const sliced = await sliceLineage([file]);
  assert.equal(sliced.capture.captured, 4);
  assert.equal(sliced.capture.unmapped, 0);
  assert.equal(sliced.capture.incomplete, false);
  assert.deepEqual(sliced.ledger.map((event) => [event.kind, event.path]), [
    ['edit', 'direct.js'], ['delete', 'old.js'], ['edit', 'wrapped.js'], ['delete', 'stale.js'],
  ]);
  assert.ok(sliced.ledger.every((event) => event.observationMissing !== true));
});

test('exact direct result replay stays one observation; a changed replay retracts the outcome', async () => {
  const call = direct('exec_command', 'one', { cmd: 'make build' });
  const success = output('one', { output: 'built', exit_code: 0 });
  const repeated = await sliceLineage([await fixture([call, success, success])]);
  assert.equal(repeated.ledger.length, 1);
  assert.equal(repeated.ledger[0].exitCode, 0);
  assert.equal(repeated.capture.unmapped, 0);

  const failure = output('one', { output: 'failed', exit_code: 2 });
  for (const results of [[success, failure], [failure, success]]) {
    const conflict = await sliceLineage([await fixture([call, ...results])]);
    assert.equal(conflict.ledger.length, 1);
    assert.equal(conflict.ledger[0].exitCode, undefined);
    assert.equal(conflict.ledger[0].outcome, undefined);
    assert.equal(conflict.ledger[0].observationMissing, true);
    assert.equal(conflict.capture.unmapped, 1);
    assert.ok(conflict.capture.reasons.includes('codex_tool_identity_conflict'));
  }
});

test('duplicate direct call identities preserve both actions and cannot assign either result', async () => {
  for (const resultBeforeDuplicate of [false, true]) {
    const first = direct('exec_command', 'reused', { cmd: 'make first' });
    const second = direct('exec_command', 'reused', { cmd: 'make second' });
    const lines = resultBeforeDuplicate
      ? [first, output('reused', { output: 'first done', exit_code: 0 }), second,
        output('reused', { output: 'second failed', exit_code: 2 })]
      : [first, second, output('reused', { output: 'unknown', exit_code: 0 })];
    const file = await fixture(lines);
    const normalized = await readCodexSession(file);
    const uses = normalized.records.flatMap((r) => r.raw.message?.content ?? []).filter((b) => b.type === 'tool_use');
    assert.equal(new Set(uses.map((use) => use.id)).size, 2, 'both actions keep unique event identities');
    assert.ok(uses.every((use) => use.sourceCallId === 'reused'));
    const sliced = await sliceLineage([file]);
    assert.deepEqual(sliced.ledger.map((event) => event.cmd), ['make first', 'make second']);
    assert.ok(sliced.ledger.every((event) => event.exitCode === undefined && event.observationMissing === true));
    assert.equal(sliced.capture.incomplete, true);
    assert.ok(sliced.capture.reasons.includes('codex_tool_identity_conflict'));
  }
});

test('duplicate call identity still reaches a partial real review request', async () => {
  const file = await fixture([
    direct('exec_command', 'reused', { cmd: 'make first' }),
    direct('exec_command', 'reused', { cmd: 'make second' }),
    output('reused', { output: 'unattributable', exit_code: 0 }),
  ]);
  const { ledger } = await analyze([file]);
  const session = sessionFromLedger(ledger, { sessionKey: 'synthetic-duplicate' });
  let requests = 0;
  const judge = async ({ system, prompt }) => {
    requests++;
    assert.ok(!system.includes('\0') && !prompt.includes('\0'));
    return { decisions: [], pivots: [], claims: [], requirements: [] };
  };
  const report = await runReview({ session, pr: { repo: { host: 'github.com', id: '42' }, files: [] }, judge });
  assert.ok(requests > 0, 'the review judge receives a usable request');
  // M33 (C-06): the review completed; the unattributable result is a declared recorder limit, so the
  // session reads NO_FINDINGS — partial, named, never CLEAN. Before M33 it read UNCHECKED.
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.ok(report.gaps.some((gap) => gap.channel === 'observations'));
});

test('a duplicate ID across wrapper and direct calls retracts the wrapper result and keeps the direct action', async () => {
  const file = await fixture([
    wrapper('reused', 'text(await tools.exec_command({cmd:"make wrapped"}));'),
    wrapperOutput('reused', { output: 'built', exit_code: 0 }),
    direct('exec_command', 'reused', { cmd: 'make direct' }),
    output('reused', { output: 'failed', exit_code: 2 }),
  ]);
  const sliced = await sliceLineage([file]);
  assert.deepEqual(sliced.ledger.map((event) => event.cmd), ['make wrapped', 'make direct']);
  assert.ok(sliced.ledger.every((event) => event.exitCode === undefined && event.observationMissing === true));
  assert.equal(sliced.capture.incomplete, true);
  assert.ok(sliced.capture.reasons.includes('codex_tool_identity_conflict'));
});

test('duplicate incomplete wrappers declare the action gap without inventing an executed call', async () => {
  const source = 'text(await tools.exec_command({cmd:"make build"}));';
  const file = await fixture([wrapper('reused', source), wrapper('reused', source),
    wrapperOutput('reused', { output: 'unattributable', exit_code: 0 })]);
  const sliced = await sliceLineage([file]);
  assert.equal(sliced.ledger.length, 0);
  assert.equal(sliced.capture.incomplete, true);
  assert.ok(sliced.capture.reasons.includes('codex_tool_identity_conflict'));
  assert.ok(sliced.capture.unmapped > 0);
});
