// M28: synthetic identity cuts preserve only independently verifiable linkage paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from '../index.js';

const opaque = 'call_' + createHash('sha256').update('synthetic opaque ID 32')
  .digest('base64url').replace(/[-_]/g, 'A').slice(0, 24);
const secret = 'sk-ant-api03-' + 'A'.repeat(80);
const unit = (fields) => ({ ask: [], ledger: [], claim: {}, dropped: [], ...fields });
const clean = (fields) => redact(unit(fields)).ledger;

test('M28: scrubbed call ID does not erase an independent Codex spawn tuple', () => {
  const result = clean({ delegations: [{ adapter: 'codex', kind: 'spawn', turn: 1,
    callId: opaque, childId: 'child-1', taskName: '/root/worker' }] });
  const delegation = result.delegations[0];
  assert.equal(delegation.callId, null);
  assert.deepEqual(delegation.identityUncheckedFields, ['callId']);
  assert.notEqual(delegation.identityUnchecked, true);
  assert.ok(!JSON.stringify(result).includes(opaque));
  assert.deepEqual(clean({ delegations: [delegation] }).delegations[0].identityUncheckedFields, ['callId']);
});

test('M28: scrubbed call ID leaves a Claude child receipt and Codex child-only spawn eligible', () => {
  const rows = clean({ delegations: [
    { adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1' },
    { adapter: 'codex', turn: 2, callId: opaque, childId: 'child-2' },
  ] }).delegations;
  assert.deepEqual(rows.map((row) => row.identityUncheckedFields), [['callId'], ['callId']]);
  assert.deepEqual(rows.map((row) => row.identityUnchecked === true), [false, false]);
  assert.ok(!JSON.stringify(rows).includes(opaque));
});

test('M28: scrubbed task or child identity blocks only proofs requiring that field', () => {
  const rows = clean({ delegations: [
    { adapter: 'codex', kind: 'spawn', turn: 1, childId: 'child-1', taskName: '/root/' + secret },
    { adapter: 'codex', kind: 'spawn', turn: 2, childId: secret, taskName: '/root/worker' },
    { adapter: 'codex', kind: 'spawn', turn: 3, childId: secret, taskName: '/root/' + secret },
    { adapter: 'codex', kind: 'followup', turn: 4, callId: opaque, target: '/root/worker' },
    { adapter: 'codex', kind: 'followup', turn: 5, target: secret },
    { adapter: 'claude', kind: 'spawn', turn: 6, childId: secret, callId: 'safe-call' },
  ] }).delegations;
  assert.deepEqual(rows.map((row) => row.identityUnchecked === true),
    [false, false, true, false, true, true]);
  assert.deepEqual(rows.map((row) => row.identityUncheckedFields),
    [['taskName'], ['childId'], ['childId', 'taskName'], ['callId'], ['target'], ['childId']]);
  assert.ok(!JSON.stringify(rows).includes(secret));
});

test('M28: source identity cuts preserve a clean independent Codex tuple', () => {
  const rows = clean({ sources: [
    { adapter: 'codex', nested: true, sessionId: secret,
      parentThreadId: 'parent-1', taskPath: '/root/worker' },
    { adapter: 'codex', nested: true, sessionId: 'child-1',
      parentThreadId: secret, taskPath: '/root/worker' },
    { adapter: 'codex', nested: true, sessionId: secret,
      parentThreadId: 'parent-1', taskPath: '/root/' + secret },
  ] }).sources;
  assert.deepEqual(rows.map((row) => row.identityUnchecked === true), [false, false, true]);
  assert.deepEqual(rows.map((row) => row.identityUncheckedFields),
    [['sessionId'], ['parentThreadId'], ['sessionId', 'taskPath']]);
  assert.ok(!JSON.stringify(rows).includes(secret));
});

// D69 review: a hand-off's typed result is carried as recorder strings — no 512-character bound on its
// tool name and no `[a-z_]{1,40}` shape on its status (neither changed a recording) — and a flagged one is withheld whole.
test('D69 review: a hand-off receipt carries its recorded tool name and status as written; a flagged one is withheld', () => {
  const long = `mcp__${'n'.repeat(600)}__agent`;
  const [kept] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: long, status: 'Completed Fully', totalToolUseCount: 2 } }] }).delegations;
  assert.deepEqual(kept.recorded, { tool: long, status: 'Completed Fully', totalToolUseCount: 2 });
  const [held] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: 'Agent', status: secret, totalToolUseCount: 2 } }] }).delegations;
  assert.deepEqual(held.recorded, { tool: 'Agent', totalToolUseCount: 2, withheld: true });
  assert.ok(!JSON.stringify(held).includes(secret));
  const [odd] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: 'Agent', status: 7 } }] }).delegations;
  assert.deepEqual(odd.recorded, { tool: 'Agent', withheld: true });
});
