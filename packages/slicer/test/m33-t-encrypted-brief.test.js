// M33 T (helper briefs). A Codex hand-off (`spawn_agent`, `collaboration.spawn_agent`, `followup_task`)
// whose `message` is one encrypted token — whitespace-free, >= 100 base64url characters, optional `=`
// padding, the recorder's shape (one lowercase letter then three uppercase, as Codex's "gAAAAA…"), and as
// unreadable as the redactor's entropy floor — carries no readable brief. The slicer records that the brief exists but the recorder encrypted
// it (`parentInstruction: { tool, field, encrypted: true }`, no text), and never keeps, hashes or prints the
// token. A plaintext message keeps today's behaviour exactly: it is carried as text and scrubbed by
// redaction as agent prose.
//
// Synthetic Codex rollouts only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isEncryptedBrief, detectDelegation } from '../src/delegation.js';
import { sliceLineage } from '../index.js';
import { redact, sliceHash } from '../../redact/index.js';
import { syntheticToken, READABLE_BRIEFS } from '../../evidence/test/m33-t-helper-brief-fixture.js';

const TOKEN = syntheticToken('synthetic encrypted brief', 812);
const FOLLOW_TOKEN = syntheticToken('synthetic encrypted follow-up', 1_204);
const SECRET = `sk-ant-api03-${'Q7'.repeat(40)}`;
const response = (payload) => ({ type: 'response_item', payload });
const spawn = (callId, args, name = 'spawn_agent') =>
  response({ type: 'function_call', name, call_id: callId, arguments: JSON.stringify(args) });
const output = (callId, value) => response({ type: 'function_call_output', call_id: callId, output: JSON.stringify(value) });

async function slice(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-t-brief-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-01T12-00-00-synthetic.jsonl');
  await writeFile(file, [{ type: 'session_meta', payload: { id: 'root', cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Split the parser work between helpers.' }), ...rows]
    .map((row) => JSON.stringify(row)).join('\n') + '\n');
  const raw = await sliceLineage([file]);
  return { raw, clean: redact(structuredClone(raw)).ledger };
}
const everywhere = (value) => JSON.stringify(value);

test('M33 T the encrypted-token shape: whitespace-free, >= 100 base64url characters, optional padding', () => {
  const body = syntheticToken('shape', 100);
  assert.equal(isEncryptedBrief(body), true);
  assert.equal(isEncryptedBrief(`${body}=`), true);
  assert.equal(isEncryptedBrief(`${body}==`), true);
  assert.equal(isEncryptedBrief(TOKEN), true);
  assert.equal(isEncryptedBrief(body.slice(0, 99)), false, 'shorter than 100 characters is plaintext');
  assert.equal(isEncryptedBrief(`${body}===`), false);
  assert.equal(isEncryptedBrief(`${body.slice(0, 60)} ${body.slice(60)}`), false, 'whitespace makes it prose');
  assert.equal(isEncryptedBrief(`${body}\n`), false);
  assert.equal(isEncryptedBrief(` ${body}`), false);
  assert.equal(isEncryptedBrief(`${body.slice(0, 50)}+/${body.slice(50)}`), false, 'not the base64url alphabet');
  assert.equal(isEncryptedBrief(`${body.slice(0, 50)}=${body.slice(50)}`), false, 'padding only at the end');
  for (const value of [undefined, null, 42, {}, [], ''])
    assert.equal(isEncryptedBrief(value), false);
});

// Repair: the shape alone also matched readable text with no spaces, which base 23afc8a kept as text. Only the
// recorder's token shape, as unreadable as the redactor's own entropy floor, is an encrypted brief.
test('M33 T only the recorder\'s token shape, unreadable by the redactor\'s measure, is an encrypted brief', () => {
  const body = syntheticToken('shape', 160);
  assert.equal(isEncryptedBrief(body), true, 'the synthetic token has the recorder\'s shape');
  for (const [name, words] of Object.entries(READABLE_BRIEFS)) {
    assert.ok(words.length >= 100 && /^[A-Za-z0-9_-]+$/.test(words), name);
    assert.equal(isEncryptedBrief(words), false, `${name}: readable words are plaintext`);
  }
  // Without the recorder's opening shape a long random run is not called encrypted: redaction judges it.
  for (const variant of [`Q${body.slice(1)}`, `ga${body.slice(2)}`, `gAa${body.slice(3)}`, `gAA9${body.slice(4)}`,
    `9${body.slice(1)}`, `_${body.slice(1)}`, `-${body.slice(1)}`]) {
    assert.equal(isEncryptedBrief(variant), false, variant.slice(0, 6));
  }
  assert.equal(isEncryptedBrief(`gAAA${body.slice(4)}`), true);
  assert.equal(isEncryptedBrief(`xYZW${body.slice(4)}`), true, 'the recorder\'s shape, not one literal prefix');
  // The recorder's shape, but low entropy: not a token.
  assert.equal(isEncryptedBrief(`gAAA${'a'.repeat(200)}`), false);
  assert.equal(isEncryptedBrief(`gAAA${'ab_cd-'.repeat(40)}`), false);
});

test('M33 T only the Codex hand-off reads an encrypted token as an encrypted brief', () => {
  const codex = detectDelegation({ type: 'tool_use', name: 'spawn_agent', id: 'c', input: { message: TOKEN } },
    { callId: 'c', value: { task_name: '/root/fix_parser' }, isError: false }, { adapter: 'codex', turn: 1 });
  assert.deepEqual(codex.parentInstruction, { tool: 'spawn_agent', field: 'message', encrypted: true });
  assert.equal(codex.taskName, '/root/fix_parser');
  // A Claude brief of the same shape is not a recorder encryption: it stays text, for redaction to judge.
  const claude = detectDelegation({ type: 'tool_use', name: 'Task', id: 'c', input: { prompt: TOKEN } },
    { callId: 'c', value: { agentId: 'child-1' }, isError: false }, { adapter: 'claude', turn: 1 });
  assert.deepEqual(claude.parentInstruction, { text: TOKEN, tool: 'Task', field: 'prompt' });
});

test('M33 T a spawn whose message is an encrypted token records the encrypted fact, never the token', async (t) => {
  for (const name of ['spawn_agent', 'collaboration.spawn_agent']) {
    const { raw, clean } = await slice(t, [spawn('spawn-1', { message: TOKEN, task_name: 'fix_parser' }, name),
      output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' })]);
    const [d] = clean.delegations;
    assert.deepEqual(d.parentInstruction, { tool: name, field: 'message', encrypted: true }, name);
    assert.equal(d.taskName, '/root/fix_parser', 'the task name survives as an identity field');
    assert.equal(d.identityUnchecked, undefined);
    assert.equal(d.identityUncheckedFields, undefined);
    for (const ledger of [raw, clean]) {
      assert.equal(everywhere(ledger).includes(TOKEN), false, 'the token is nowhere in the ledger');
      assert.equal(everywhere(ledger).includes(TOKEN.slice(0, 40)), false, 'not even a prefix of it');
      assert.equal(everywhere(ledger).includes('‹dropped'), false, 'no redaction marker stands in for it');
      assert.equal(everywhere(ledger).includes('‹redacted'), false);
    }
    assert.equal(d.parentInstruction.redacted, undefined, 'an encrypted brief is not a redaction');
    assert.equal(d.parentInstruction.redactedLines, undefined);
    assert.deepEqual((clean.dropped ?? []).filter((loss) => loss.where === 'parent agent instruction'), []);
    // The slice hash is computed over the redacted ledger, which never held the token.
    assert.equal(typeof sliceHash(clean), 'string');
  }
});

test('M33 T a follow-up whose message is an encrypted token is recorded the same way', async (t) => {
  for (const name of ['followup_task', 'collaboration.followup_task']) {
    const { raw, clean } = await slice(t, [
      spawn('spawn-1', { message: TOKEN, task_name: 'fix_parser' }),
      output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' }),
      spawn('follow-1', { target: 'fix_parser', message: FOLLOW_TOKEN }, name),
      output('follow-1', { ok: true })]);
    const follow = clean.delegations.find((d) => d.kind === 'followup');
    assert.deepEqual(follow.parentInstruction, { tool: name, field: 'message', encrypted: true }, name);
    assert.equal(follow.target, 'fix_parser');
    for (const ledger of [raw, clean]) {
      assert.equal(everywhere(ledger).includes(FOLLOW_TOKEN.slice(0, 40)), false);
      assert.equal(everywhere(ledger).includes('‹dropped'), false);
    }
  }
});

test('M33 T a plaintext message keeps today\'s behaviour exactly', async (t) => {
  const brief = 'Fix the parser: keep the tokenizer and add a regression test for nested input.';
  const { raw, clean } = await slice(t, [spawn('spawn-1', { message: brief, task_name: 'fix_parser' }),
    output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' })]);
  assert.deepEqual(raw.delegations[0].parentInstruction, { text: brief, tool: 'spawn_agent', field: 'message' });
  assert.deepEqual(clean.delegations[0].parentInstruction, { text: brief, tool: 'spawn_agent', field: 'message' });
  assert.equal(clean.delegations[0].taskName, '/root/fix_parser');
});

test('M33 T a plaintext message carrying a secret is still redacted at token level, as agent prose', async (t) => {
  const brief = `Call the staging API with ${SECRET} and report the parser errors.`;
  const { raw, clean } = await slice(t, [spawn('spawn-1', { message: brief, task_name: 'fix_parser' }),
    output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' })]);
  assert.equal(raw.delegations[0].parentInstruction.text, brief, 'the slicer carries plaintext as text');
  const instruction = clean.delegations[0].parentInstruction;
  assert.equal(instruction.encrypted, undefined);
  assert.equal(instruction.redacted, true);
  assert.equal(everywhere(clean).includes(SECRET), false);
  assert.match(instruction.text, /^Call the staging API with ‹/);
  assert.match(instruction.text, /› and report the parser errors\.$/);
});

test('M33 T a short or whitespace-bearing message that merely looks base64-ish is plaintext', async (t) => {
  const short = syntheticToken('short', 72);
  const spaced = `${syntheticToken('spaced-a', 300)} ${syntheticToken('spaced-b', 300)}`;
  const lined = `${syntheticToken('lined', 300)}\n`;
  for (const message of [short, spaced, lined]) {
    const { raw, clean } = await slice(t, [spawn('spawn-1', { message, task_name: 'fix_parser' }),
      output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' })]);
    assert.deepEqual(raw.delegations[0].parentInstruction, { text: message, tool: 'spawn_agent', field: 'message' });
    const instruction = clean.delegations[0].parentInstruction;
    assert.equal(instruction.encrypted, undefined, 'plaintext is never marked encrypted');
    assert.equal(typeof instruction.text, 'string', 'plaintext keeps a text field for redaction to scrub');
  }
  // What redaction does with the spaced one is today's token-level rule, unchanged.
  const { clean } = await slice(t, [spawn('spawn-1', { message: spaced, task_name: 'fix_parser' }),
    output('spawn-1', { agent_id: 'child-1', task_name: '/root/fix_parser' })]);
  assert.equal(clean.delegations[0].parentInstruction.redacted, true);
  assert.equal(everywhere(clean).includes(spaced.slice(0, 40)), false);
});

test('M33 T a readable whitespace-free brief of 100+ characters stays text, exactly as before', async (t) => {
  for (const [name, message] of Object.entries(READABLE_BRIEFS)) {
    const spawned = await slice(t, [spawn('spawn-1', { message, task_name: 'fix_parser' }),
      output('spawn-1', { task_name: '/root/fix_parser' })]);
    const followed = await slice(t, [spawn('spawn-1', { message: TOKEN, task_name: 'fix_parser' }),
      output('spawn-1', { task_name: '/root/fix_parser' }),
      spawn('follow-1', { target: 'fix_parser', message }, 'followup_task'), output('follow-1', { ok: true })]);
    for (const [ledgers, tool, pick] of [[spawned, 'spawn_agent', (l) => l.delegations[0]],
      [followed, 'followup_task', (l) => l.delegations.find((d) => d.kind === 'followup')]]) {
      const expected = { text: message, tool, field: 'message' };
      assert.deepEqual(pick(ledgers.raw).parentInstruction, expected, `${name} ${tool}, sliced`);
      // Redaction keeps these words, as it did before this change: the brief is shown, never called encrypted.
      assert.deepEqual(pick(ledgers.clean).parentInstruction, expected, `${name} ${tool}, redacted`);
    }
  }
});

test('M33 T a random token without the recorder\'s shape stays in redaction\'s hands and is dropped, as before', async (t) => {
  const token = `Q${syntheticToken('no recorder shape', 400).slice(1)}`;
  assert.equal(isEncryptedBrief(token), false);
  const { raw, clean } = await slice(t, [spawn('spawn-1', { message: token, task_name: 'fix_parser' }),
    output('spawn-1', { task_name: '/root/fix_parser' })]);
  assert.deepEqual(raw.delegations[0].parentInstruction, { text: token, tool: 'spawn_agent', field: 'message' });
  const instruction = clean.delegations[0].parentInstruction;
  assert.equal(instruction.encrypted, undefined);
  assert.equal(instruction.redacted, true, 'fails closed, as a redaction');
  assert.equal(everywhere(clean).includes(token.slice(0, 32)), false);
});
