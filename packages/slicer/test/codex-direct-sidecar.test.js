import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sliceLineage } from '../index.js';
import { scratchDir } from './scratch-dir.js';

async function ledgerFor(rows) {
  const dir = await scratchDir('sonah-exact-sidecar-');
  const file = join(dir, 'rollout-2026-09-10T12-00-00-test.jsonl');
  const header = { type: 'session_meta', payload: { id: 'own-thread', cwd: '/repo' } };
  const ask = { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Check.' } };
  await writeFile(file, [header, ask, ...rows].map((row) => typeof row === 'string' ? row : JSON.stringify(row)).join('\n'));
  return sliceLineage([file]);
}
const direct = (name, call_id, input) => ({ type: 'response_item', payload: {
  type: 'function_call', name, call_id, arguments: JSON.stringify(input),
} });
const output = (call_id, value) => ({ type: 'response_item', payload: {
  type: 'function_call_output', call_id, output: value,
} });
const command = (id, overrides = {}) => ({ type: 'event_msg', payload: {
  type: 'item_completed', thread_id: 'own-thread', item: {
    id, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
    command: ['/bin/zsh', '-lc', 'node build.js'], cwd: 'file:///repo', exit_code: 0,
    stdout: 'SIDE_CAR_ONLY', stderr: '', ...overrides,
  },
} });
const patch = '*** Begin Patch\n*** Add File: src/new.js\n+new\n*** End Patch';
const fileChange = (id, overrides = {}) => ({ type: 'event_msg', payload: {
  type: 'item_completed', thread_id: 'own-thread', item: {
    id, type: 'FileChange', status: 'completed',
    changes: [{ path: 'src/new.js', kind: 'add' }], ...overrides,
  },
} });

test('direct command uses only a unique same-thread agent sidecar with exact call ID', async () => {
  const rows = [direct('functions.exec_command', 'c1', { cmd: 'node build.js' }),
    command('c1'), output('c1', 'visible output')];
  const proof = await ledgerFor(rows);
  assert.equal(proof.ledger[0].exitCode, 0);
  assert.equal(proof.ledger[0].sourceLocator?.commandExecutionRecord, 4);
  assert.equal(JSON.stringify(proof).includes('SIDE_CAR_ONLY'), false);

  for (const receipt of [
    command('other'), command('c1', { source: 'user_shell' }),
    command('c1', { source: 'unified_exec_interaction' }),
    command('c1', { source: undefined }),
    { ...command('c1'), payload: { ...command('c1').payload, thread_id: 'foreign' } },
    command('c1', { command: ['/bin/zsh', '-lc', 'different'] }),
  ]) {
    const near = await ledgerFor([rows[0], receipt, rows[2]]);
    assert.equal(near.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
    assert.equal(near.ledger[0].exitCode, undefined);
  }
  const duplicate = await ledgerFor([rows[0], command('c1'), command('c1'), rows[2]]);
  assert.equal(duplicate.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  const duplicateKey = JSON.stringify(command('c1')).replace('"exit_code":0', '"exit_code":0,"exit_code":0');
  const unsafe = await ledgerFor([rows[0], duplicateKey, rows[2]]);
  assert.equal(unsafe.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  const structured = await ledgerFor([rows[0], command('c1'), output('c1', { output: 'visible', exit_code: 0 })]);
  assert.equal(structured.ledger[0].sourceLocator?.commandExecutionRecord, 4);
  assert.equal(structured.ledger[0].exitCode, 0);
  const conflict = await ledgerFor([rows[0], command('c1', { status: 'failed', exit_code: 2 }),
    output('c1', { output: 'visible', exit_code: 0 })]);
  assert.equal(conflict.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(conflict.ledger[0].outcome, 'unknown');
});

test('a wrapper never borrows a native command status through matching text or cwd', async () => {
  const source = 'const r = await tools.exec_command({cmd:"node build.js",workdir:"/repo"}); text(r.output);';
  const wrapper = { type: 'response_item', payload: { type: 'custom_tool_call',
    name: 'exec', call_id: 'outer', input: source } };
  const finish = { type: 'response_item', payload: { type: 'custom_tool_call_output',
    call_id: 'outer', output: [{ type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: 'visible output' }] } };
  const result = await ledgerFor([wrapper, command('inner'), finish]);
  assert.equal(result.ledger[0].exitCode, undefined);
  assert.equal(result.ledger[0].sourceLocator?.commandExecutionRecord, undefined);
  assert.equal(result.capture.incomplete, true);
});

test('direct patch uses an exact same-thread FileChange, while a wrapper cannot borrow it', async () => {
  const call = direct('functions.apply_patch', 'p1', { patch });
  const exact = await ledgerFor([call, fileChange('p1'), output('p1', 'visible result')]);
  assert.equal(exact.ledger[0].sourceLocator?.fileChangeRecord, 4);
  assert.equal(exact.ledger[0].result?.outcome, 'succeeded');
  for (const receipt of [fileChange('other'),
    { ...fileChange('p1'), payload: { ...fileChange('p1').payload, thread_id: 'foreign' } },
    fileChange('p1', { changes: [{ path: 'src/other.js', kind: 'add' }] })]) {
    const near = await ledgerFor([call, receipt, output('p1', 'visible result')]);
    assert.equal(near.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  }
  const wrapper = { type: 'response_item', payload: { type: 'custom_tool_call',
    name: 'exec', call_id: 'outer', input: `text(await tools.apply_patch(${JSON.stringify(patch)}));` } };
  const finish = { type: 'response_item', payload: { type: 'custom_tool_call_output',
    call_id: 'outer', output: [{ type: 'input_text', text: 'Script completed' },
      { type: 'input_text', text: '{}' }] } };
  const noBridge = await ledgerFor([wrapper, fileChange('inner'), finish]);
  assert.equal(noBridge.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  assert.equal(noBridge.ledger[0].result?.outcome, 'unknown');
});

test('legacy patch completion requires its exact call ID and matching changes', async () => {
  const call = direct('functions.apply_patch', 'p1', { patch });
  const legacy = (call_id, changes = { 'src/new.js': { type: 'add', content: 'new' } }) => ({
    type: 'event_msg', payload: { type: 'patch_apply_end', call_id,
      success: true, status: 'completed', changes },
  });
  const proof = await ledgerFor([call, legacy('p1'), output('p1', 'visible result')]);
  assert.equal(proof.ledger[0].sourceLocator?.fileChangeRecord, 4);
  assert.equal(proof.ledger[0].result?.outcome, 'succeeded');
  for (const receipt of [legacy('other'),
    legacy('p1', { 'src/other.js': { type: 'add', content: 'other' } }),
    { ...legacy('p1'), payload: { ...legacy('p1').payload, success: false } }]) {
    const near = await ledgerFor([call, receipt, output('p1', 'visible result')]);
    assert.equal(near.ledger[0].sourceLocator?.fileChangeRecord, undefined);
  }
});

test('D90: a change to a credential-shaped file and a command holding a key-shaped word join their native records', async () => {
  // D90 (owner decision 2026-10-15): the join keys are structural (one repository-relative path; the exact command and
  // its directory) and nothing reads what a path names or a command holds, so a change to `.env`, a path with a
  // mark-shaped name, and a command that sets a key each join their exact same-thread completion like any other.
  for (const path of ['.env', 'config/secrets.yml', 'deploy/id_rsa', 'notes/‹redacted›.md']) {
    const body = `*** Begin Patch\n*** Add File: ${path}\n+X=1\n*** End Patch`;
    const joined = await ledgerFor([direct('functions.apply_patch', 'p1', { patch: body }),
      fileChange('p1', { changes: [{ path, kind: 'add' }] }), output('p1', 'visible result')]);
    assert.equal(joined.ledger[0].sourceLocator?.fileChangeRecord, 4, path);
    assert.equal(joined.ledger[0].result?.outcome, 'succeeded', path);
  }
  // A FAKE key, built at run time so no line of this file is itself key-shaped.
  const key = ['sk', 'ant', 'api03', 'FAKEonlyForTests0123456789abcdefXYZ0123456789fake'].join('-');
  const cmd = `ANTHROPIC_API_KEY=${key} node build.js`;
  const keyed = await ledgerFor([direct('functions.exec_command', 'c1', { cmd }),
    command('c1', { command: ['/bin/zsh', '-lc', cmd] }), output('c1', 'visible output')]);
  assert.equal(keyed.ledger[0].sourceLocator?.commandExecutionRecord, 4);
  assert.equal(keyed.ledger[0].exitCode, 0);
  assert.equal(keyed.ledger[0].cmd, cmd);
});
