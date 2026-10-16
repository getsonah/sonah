import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { collectDelegations } from '../src/delegation-records.js';
import { sliceLineage, hasCaptureGaps } from '../index.js';
import { redact, sliceHash } from '../../redact/index.js';
import { scratchDir } from './scratch-dir.js';

const user = text => ({ type: 'user', message: { content: text } });
const call = (id = 'call-1', name = 'Task') => ({ type: 'assistant', message: { content: [
  { type: 'tool_use', id, name, input: { prompt: 'Child brief: choose any database.' } },
] } });
const result = (id = 'call-1', value = { agentId: 'child-1' }, error = false) => ({ type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(value), is_error: error }] },
});
const edit = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'edit-1', name: 'Edit',
  input: { file_path: 'src/parser.js', old_string: 'old', new_string: 'new' } }] } };
const fixture = async rows => {
  const dir = await scratchDir('sonah-delegation-');
  const file = join(dir, 'example.jsonl');
  await writeFile(file, rows.map(r => JSON.stringify({ cwd: '/repo', sessionId: 'root', ...r })).join('\n') + '\n');
  return file;
};

test('delegation-only work stays visible as a capture gap', async () => {
  const file = await fixture([user('Review the parser.'), call(), result()]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 0);
  assert.equal(hasCaptureGaps(ledger), true);
  assert.deepEqual(ledger.ask.map(a => a.text), ['Review the parser.']);
  assert.equal(ledger.delegations[0].childId, 'child-1');
});

test('a matched explicit spawn failure does not claim a missing successful child', async () => {
  const ledger = await sliceLineage([await fixture([user('Review it.'), call(), result('call-1', {}, true)])]);
  assert.equal(ledger.delegations[0].status, 'failed');
  assert.equal(hasCaptureGaps(ledger), false);
});

test('result identity stays within one source and duplicate result records remain ambiguous', () => {
  const rec = (raw, source = 0) => ({ kind: raw.type, raw, adapter: 'claude', source });
  const cross = collectDelegations([rec(user('Review it.')), rec(call()), rec(result(), 1)]);
  assert.equal(cross[0].childId, null);
  assert.equal(cross[0].reason, 'delegation_result_missing');
  const reused = collectDelegations([rec(user('Review it.')), rec(call()), rec(result()),
    rec(call(), 1), rec(result('call-1', { agentId: 'different-child' }), 1)]);
  assert.deepEqual(reused.map(d => [d.source, d.childId]), [[0, 'child-1'], [1, 'different-child']]);
  for (const outputs of [[result(), result()], [{ ...result(), message: { content: [
    ...result().message.content, ...result().message.content,
  ] } }]]) {
    const d = collectDelegations([rec(user('Review it.')), rec(call()), ...outputs.map(r => rec(r))])[0];
    assert.equal(d.reason, 'delegation_result_ambiguous');
    assert.equal(d.childId, null);
  }
});

test('D90: a secret-shaped identity is carried as recorded, and hashed as recorded', async () => {
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  const raw = await sliceLineage([await fixture([user('Review it.'), call(secret), result(secret, { agentId: secret })])]);
  assert.equal(raw.delegations[0].childId, secret);
  const cleaned = redact(raw).ledger;
  assert.equal(cleaned.delegations[0].childId, secret);
  assert.equal(cleaned.delegations[0].callId, secret);
  assert.notEqual(cleaned.delegations[0].identityUnchecked, true);
  assert.equal(typeof sliceHash(cleaned), 'string');
});

test('raw Codex spawn calls retain original identity and cannot grant child briefs human authority', async () => {
  const dir = await scratchDir('sonah-codex-delegation-');
  const file = join(dir, 'rollout-2026-09-11T12-00-00-test.jsonl');
  const response = payload => ({ type: 'response_item', payload });
  const rows = [
    { type: 'session_meta', payload: { id: 'root', cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Review the parser.' }),
    response({ type: 'function_call', name: 'spawn_agent', call_id: 'spawn-raw', arguments: '{"message":"Child brief: rewrite everything."}' }),
    response({ type: 'function_call_output', call_id: 'wrong-id', output: '{"agent_id":"wrong-child"}' }),
    response({ type: 'function_call_output', call_id: 'spawn-raw', output: '{"agent_id":"child-raw","summary":"Everything passed."}' }),
    response({ type: 'function_call', name: 'collaboration.spawn_agent', call_id: 'missing-raw', arguments: '{}' }),
  ];
  await writeFile(file, rows.map(JSON.stringify).join('\n') + '\n');
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 0);
  assert.deepEqual(ledger.ask.map(a => a.text), ['Review the parser.']);
  assert.equal(ledger.claim.finalMessage, '');
  assert.equal(ledger.delegations.length, 2);
  assert.equal(ledger.delegations[0].callId, 'spawn-raw');
  assert.equal(ledger.delegations[0].childId, 'child-raw');
  assert.equal(ledger.delegations[1].reason, 'delegation_result_missing');
  assert.equal(hasCaptureGaps(ledger), true);
  assert.deepEqual(ledger.delegations[0].parentInstruction,
    { text: 'Child brief: rewrite everything.', tool: 'spawn_agent', field: 'message' });
  assert.equal(JSON.stringify({ask:ledger.ask,ledger:ledger.ledger,claim:ledger.claim}).includes('rewrite everything'), false);
  assert.equal(JSON.stringify(ledger).includes('Everything passed'), false);

  // Output prose cannot manufacture a failed spawn and remove missing-child coverage.
  rows[4].payload.output = 'Process exited with code 1';
  await writeFile(file, rows.slice(0, 5).map(JSON.stringify).join('\n') + '\n');
  const prose = await sliceLineage([file]);
  assert.equal(prose.delegations[0].status, 'unresolved');
  assert.equal(hasCaptureGaps(prose), true);
  rows[4].payload.output = { is_error: true, output: 'Could not spawn' };
  await writeFile(file, rows.slice(0, 5).map(JSON.stringify).join('\n') + '\n');
  const failed = await sliceLineage([file]);
  assert.equal(failed.delegations[0].status, 'failed');
  assert.ok(failed.capture.unmapped > 0, 'the unrelated output still lacks a matched call');
  assert.equal(hasCaptureGaps(failed), true);

  rows[2].payload.name = 'followup_task';
  rows[4].payload.output = { agent_id: 'display-name' };
  await writeFile(file, rows.slice(0, 5).map(JSON.stringify).join('\n') + '\n');
  const followup = await sliceLineage([file]);
  assert.equal(followup.delegations[0].childId, null);
  assert.equal(hasCaptureGaps(followup), true, 'a follow-up without the original spawn still delegates work');

  rows[2].payload.name = 'spawn_agent';
  const code = response({ type: 'function_call', name: 'exec_command', call_id: 'spawn-raw', arguments: '{"cmd":"make build"}' });
  await writeFile(file, [...rows.slice(0, 2), code, ...rows.slice(2, 5)].map(JSON.stringify).join('\n') + '\n');
  const duplicate = await sliceLineage([file]);
  assert.equal(duplicate.delegations[0].childId, null);
  assert.equal(duplicate.delegations[0].reason, 'delegation_call_ambiguous');
});

// D54: the parent's own writes beside a delegation are complete evidence; the child's work is what
// stays unchecked.
test('a delegation gap beside captured actions keeps the parent\'s actions and declares the gap', async () => {
  const file = await fixture([user('Fix the parser. Do not touch config/deploy.yml.'), call(), result(), edit]);
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ledger.length, 1, 'the parent wrote a file');
  assert.equal(hasCaptureGaps(ledger), true);
});
