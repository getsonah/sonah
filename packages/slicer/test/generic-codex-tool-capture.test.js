// Synthetic Codex rollouts only. No private recording or model response belongs here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { readExecCalls } from '../src/codex-exec.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { verifyReceipt } from '../../evidence/src/session.js';

const item = (payload) => ({ type: 'response_item', payload });
const direct = (name, id, input) => item({ type: 'function_call', name, call_id: id,
  arguments: typeof input === 'string' ? input : JSON.stringify(input) });
const output = (id, value) => item({ type: 'function_call_output', call_id: id, output: value });
const wrapper = (id, source) => item({ type: 'custom_tool_call', name: 'functions.exec',
  call_id: id, input: source });
const wrapperOutput = (id, ...values) => item({ type: 'custom_tool_call_output',
  call_id: id, output: [{ type: 'input_text', text: 'Script completed' },
    ...values.map((value) => ({ type: 'input_text', text: value }))] });

async function fixture(t, rows, cwd = '/repo') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-generic-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-25T12-00-00-synthetic.jsonl');
  const all = [{ type: 'session_meta', payload: { id: 'synthetic', cwd } },
    item({ type: 'message', role: 'user', content: 'Inspect the synthetic issue.' }), ...rows];
  await writeFile(file, all.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

const adapted = (ledger) => sessionFromLedger(redact(ledger).ledger);

test('new direct Codex tool retains recorded name, exact JSON input and visible result', async (t) => {
  const input = { query: 'future-query', options: { limit: 2, strict: true } };
  const ledger = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'future', input),
    output('future', 'VISIBLE_RESULT'),
  ])]);
  assert.equal(ledger.capture.captured, 1);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.unmapped, 0);
  const event = ledger.ledger[0];
  assert.equal(event.kind, 'other');
  assert.equal(event.tool, 'mcp__future_catalog__inspect');
  assert.deepEqual(JSON.parse(event.argsExcerpt), input);
  assert.equal(event.result.outcome, 'unknown');
  const session = adapted(ledger);
  assert.equal(session.adapterGaps.length, 0);
  const action = session.events.find((entry) => entry.kind === 'invocation');
  const observation = session.observationFor(action.id);
  assert.equal(verifyReceipt(session, { eventId: action.id, role: 'action',
    quote: 'future-query' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'VISIBLE_RESULT' }).ok, true);
});

test('new custom Codex tool uses its recorded input and visible text blocks', async (t) => {
  const input = { query: 'custom-query', options: { exact: true } };
  const ledger = await sliceLineage([await fixture(t, [
    item({ type: 'custom_tool_call', name: 'mcp__future_catalog__inspect',
      call_id: 'custom', input }),
    item({ type: 'custom_tool_call_output', call_id: 'custom',
      output: [{ type: 'input_text', text: 'CUSTOM_VISIBLE_RESULT' }] }),
  ])]);
  assert.equal(ledger.capture.captured, 1);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.ledger[0].tool, 'mcp__future_catalog__inspect');
  assert.deepEqual(JSON.parse(ledger.ledger[0].argsExcerpt), input);
  assert.equal(ledger.ledger[0].result.outcome, 'unknown');
  const session = adapted(ledger);
  assert.equal(session.adapterGaps.length, 0);
  const action = session.events.find((entry) => entry.kind === 'invocation');
  const observation = session.observationFor(action.id);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'CUSTOM_VISIBLE_RESULT' }).ok, true);
});

test('new write-shaped and vendor-prefixed names do not inherit file or shell effects', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('mcp__future__write_file', 'write', { path: '/repo/src/a.js', content: 'new' }),
    output('write', 'saved'),
    direct('vendor.exec_command', 'shell', { cmd: 'echo value > src/b.js' }),
    output('shell', 'Process exited with code 0'),
  ])]);
  assert.equal(ledger.ledger.length, 2);
  assert.ok(ledger.ledger.every((event) => event.kind === 'other'
    && event.genericTool === true && event.path === undefined && event.cmd === undefined
    && event.result.outcome === 'unknown'));
  assert.equal(ledger.ledger.some((event) => event.kind === 'edit'), false);
  assert.equal(ledger.ledger[1].exitCode, undefined);
});

test('changed known-tool input stays generic with the original name and JSON', async (t) => {
  const input = { cmd: 'echo one', future_mode: 'record-only' };
  const ledger = await sliceLineage([await fixture(t, [
    direct('exec_command', 'changed', input), output('changed', 'VISIBLE'),
  ])]);
  const event = ledger.ledger[0];
  assert.equal(event.kind, 'other');
  assert.equal(event.tool, 'exec_command');
  assert.deepEqual(JSON.parse(event.argsExcerpt), input);
  assert.equal(event.result.outcome, 'unknown');
});

test('nested new tool gets its own call and exact emitted result block', async (t) => {
  const source = 'text(await tools.mcp__future_catalog__inspect({query:"nested"}));';
  const ledger = await sliceLineage([await fixture(t, [
    wrapper('cell', source), wrapperOutput('cell', 'NESTED_VISIBLE_RESULT'),
  ])]);
  assert.equal(ledger.capture.captured, 1);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.ledger[0].tool, 'mcp__future_catalog__inspect');
  assert.deepEqual(ledger.ledger[0].outputSpans, ['NESTED_VISIBLE_RESULT']);
  assert.equal(adapted(ledger).adapterGaps.length, 0);
});

test('unawaited or conditional new tool calls remain explicit action gaps', () => {
  for (const source of [
    'tools.mcp__future_catalog__inspect({query:"not awaited"});',
    'if (true) text(await tools.mcp__future_catalog__inspect({query:"conditional"}));',
    'await tools["mcp__future_catalog__inspect"]({query:"computed"});',
  ]) {
    const parsed = readExecCalls(source);
    assert.ok(parsed.unsupported > 0, source);
  }
});

test('a combined wrapper emission cannot become an invented per-call quote', async (t) => {
  const source = 'text(await Promise.all(['
    + 'tools.mcp__future_catalog__inspect({query:"one"}),'
    + 'tools.mcp__future_catalog__inspect({query:"two"})]));';
  const ledger = await sliceLineage([await fixture(t, [
    wrapper('cell', source), wrapperOutput('cell', '[{"output":"one"},{"output":"two"}]'),
  ])]);
  assert.equal(ledger.ledger.length, 2);
  assert.ok(ledger.ledger.every((event) => event.kind === 'other'
    && event.observationNonText === true && event.outputSpans === undefined));
  assert.ok(adapted(ledger).adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('direct nontext blocks preserve visible text and declare the missing portion', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('FutureInspect', 'mixed', { query: 'synthetic' }),
    output('mixed', [{ type: 'input_text', text: 'VISIBLE_BLOCK' },
      { type: 'image', data: 'SYNTHETIC_IMAGE_BYTES' }]),
  ])]);
  const session = adapted(ledger);
  const action = session.events.find((entry) => entry.kind === 'invocation');
  const observation = session.observationFor(action.id);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'VISIBLE_BLOCK' }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'SYNTHETIC_IMAGE_BYTES' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('malformed direct arguments retain an action but declare lost input', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('FutureInspect', 'bad', '{"query":'),
    output('bad', 'VISIBLE'),
  ])]);
  assert.equal(ledger.ledger[0].genericTool, true);
  assert.equal(ledger.ledger[0].inputUnparsed, true);
  assert.ok(adapted(ledger).adapterGaps.some((gap) => gap.channel === 'actions'));
});

test('raw JSON custom input naming a credential path withholds its result', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    item({ type: 'custom_tool_call', name: 'FutureRead', call_id: 'private',
      input: '{"file_path":"/repo/.env"}' }),
    item({ type: 'custom_tool_call_output', call_id: 'private', output: 'SYNTHETIC_SECRET_RESULT' }),
  ])]);
  assert.equal(ledger.ledger[0].observationWithheld, true);
  assert.equal(ledger.ledger[0].outputSpans, undefined);
  assert.ok(adapted(ledger).adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('new parallel event or UI tool item beside normal rows declares source drift', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    { type: 'event_msg', payload: { type: 'future_tool_executed', name: 'FutureInspect' } },
    { type: 'event_msg', payload: { type: 'item_completed',
      item: { type: 'FutureToolCall', name: 'FutureInspect' } } },
    direct('mcp__future_catalog__inspect', 'known', { query: 'visible' }),
    output('known', 'KNOWN_VISIBLE'),
  ])]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.capture.unsupported, 2);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes('capture_incomplete'));
});

test('MCP UI item is suppressed only by an exact direct call ID and result', async (t) => {
  const args = { query: 'visible' };
  const mirror = { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'synthetic', item: {
    id: 'matched', type: 'McpToolCall', server: 'future_catalog', tool: 'inspect', arguments: args,
    result: { content: [{ type: 'text', text: 'VISIBLE' }], isError: false },
  } } };
  const matched = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'matched', args), mirror,
    output('matched', 'VISIBLE'),
  ])]);
  assert.equal(matched.capture.unsupported, 0);
  assert.equal(matched.capture.incomplete, false);
  assert.equal(matched.ledger.length, 1);

  const unmatched = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'different', { query: 'other' }), mirror,
    output('different', 'VISIBLE'),
  ])]);
  assert.equal(unmatched.capture.unsupported, 1);
  assert.ok(unmatched.capture.reasons.includes('codex_ui_tool_unmatched'));
  assert.equal(unmatched.capture.incomplete, true);
});

test('direct MCP UI tool name can match without an mcp prefix when its ID is exact', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('futureInspect', 'plain-name', { query: 'visible' }),
    { type: 'event_msg', payload: { type: 'item_completed', thread_id: 'synthetic', item: {
      id: 'plain-name', type: 'McpToolCall', server: 'future', tool: 'futureInspect',
      arguments: { query: 'visible' }, result: { content: [] },
    } } },
    output('plain-name', 'VISIBLE'),
  ])]);
  assert.equal(ledger.capture.unsupported, 0);
  assert.equal(ledger.capture.incomplete, false);
});

test('UI item without response result stays a gap even with a native call', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'missing', { query: 'visible' }),
    { type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'McpToolCall', server: 'future_catalog', tool: 'inspect',
      arguments: { query: 'visible' }, result: { content: [] },
    } } },
  ])]);
  assert.ok(ledger.capture.reasons.includes('codex_ui_tool_unmatched'));
  assert.equal(ledger.capture.incomplete, true);
});

test('a parsed wrapper MCP call cannot claim a native UI item without its ID', async (t) => {
  const source = 'text(await tools.mcp__future_catalog__inspect({query:"nested"}));';
  const mirror = { type: 'event_msg', payload: { type: 'item_completed', item: {
    type: 'McpToolCall', server: 'future_catalog', tool: 'inspect',
    arguments: { query: 'nested' }, result: { content: [{ type: 'text', text: 'NESTED' }] },
  } } };
  const ledger = await sliceLineage([await fixture(t, [
    wrapper('inner', source), mirror, wrapperOutput('inner', 'NESTED'),
  ])]);
  assert.equal(ledger.capture.unsupported, 1);
  assert.equal(ledger.capture.unmapped, 0);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes('codex_ui_tool_unmatched'));
  assert.equal(ledger.ledger.length, 1);
});

test('a conflicting native replay cannot certify an MCP UI mirror', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'conflict', { query: 'visible' }),
    { type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'McpToolCall', server: 'future_catalog', tool: 'inspect',
      arguments: { query: 'visible' }, result: { content: [] },
    } } },
    output('conflict', 'FIRST'), output('conflict', 'DIFFERENT'),
  ])]);
  assert.ok(ledger.capture.reasons.includes('codex_tool_identity_conflict'));
  assert.ok(ledger.capture.reasons.includes('codex_ui_tool_unmatched'));
  assert.equal(ledger.capture.incomplete, true);
});

test('a changed MCP UI result envelope declares drift even when the call matches', async (t) => {
  const ledger = await sliceLineage([await fixture(t, [
    direct('mcp__future_catalog__inspect', 'new-field', { query: 'visible' }),
    { type: 'event_msg', payload: { type: 'item_completed', item: {
      type: 'McpToolCall', server: 'future_catalog', tool: 'inspect',
      arguments: { query: 'visible' },
      result: { content: [], future_status: 'unknown' },
    } } },
    output('new-field', 'VISIBLE'),
  ])]);
  assert.equal(ledger.capture.unsupported, 2);
  assert.ok(ledger.capture.reasons.includes('capture_incomplete'));
});
