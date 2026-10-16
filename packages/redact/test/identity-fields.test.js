// M28, D90: a recording's identities — a hand-off's, a source's — are carried as recorded. D90 (owner decision
// 2026-10-15, privacy is not a design constraint): nothing scans them (an identity scan once nulled a field it read as
// secret-shaped and declared it unchecked). A field a ledger already declared unchecked (`identityUncheckedFields`)
// stays unchecked and blocks only the proofs that need it; an invalid declaration leaves the whole row unchecked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from '../index.js';

const opaque = 'call_' + createHash('sha256').update('synthetic opaque ID 32')
  .digest('base64url').replace(/[-_]/g, 'A').slice(0, 24);
const keyShaped = ['sk', 'ant', 'api03', 'A'.repeat(80)].join('-');
const unit = (fields) => ({ ask: [], ledger: [], claim: {}, dropped: [], ...fields });
const clean = (fields) => redact(unit(fields)).ledger;

test('D90: a hand-off\'s and a source\'s identities are carried as recorded, a key-shaped or opaque one too', () => {
  const delegations = [
    { adapter: 'codex', kind: 'spawn', turn: 1, callId: opaque, childId: 'child-1', taskName: `/root/${keyShaped}` },
    { adapter: 'claude', kind: 'spawn', turn: 2, childId: keyShaped, callId: 'safe-call' },
    { adapter: 'codex', kind: 'followup', turn: 3, target: keyShaped },
  ];
  const sources = [{ adapter: 'codex', nested: true, sessionId: keyShaped, parentThreadId: opaque,
    taskPath: '/root/worker' }];
  const out = clean({ delegations: structuredClone(delegations), sources: structuredClone(sources) });
  assert.deepEqual(out.delegations, delegations);
  assert.deepEqual(out.sources, sources);
});

test('M28: a hand-off field a ledger declared unchecked blocks only the proofs that require it', () => {
  const rows = clean({ delegations: [
    { adapter: 'codex', kind: 'spawn', turn: 1, callId: null, childId: 'child-1', taskName: '/root/worker',
      identityUncheckedFields: ['callId'] },
    { adapter: 'codex', kind: 'spawn', turn: 2, childId: 'child-2', taskName: null, identityUncheckedFields: ['taskName'] },
    { adapter: 'codex', kind: 'spawn', turn: 3, childId: null, taskName: '/root/worker', identityUncheckedFields: ['childId'] },
    { adapter: 'codex', kind: 'spawn', turn: 4, childId: null, taskName: null,
      identityUncheckedFields: ['taskName', 'childId'] },
    { adapter: 'codex', kind: 'followup', turn: 5, callId: null, target: '/root/worker', identityUncheckedFields: ['callId'] },
    { adapter: 'codex', kind: 'followup', turn: 6, target: null, identityUncheckedFields: ['target'] },
    { adapter: 'claude', kind: 'spawn', turn: 7, childId: null, callId: 'safe-call', identityUncheckedFields: ['childId'] },
    { adapter: 'claude', turn: 8, callId: null, childId: 'child-8', identityUncheckedFields: ['callId'] },
  ] }).delegations;
  assert.deepEqual(rows.map((row) => row.identityUnchecked === true),
    [false, false, false, true, false, true, true, false]);
  assert.deepEqual(rows.map((row) => row.identityUncheckedFields), [['callId'], ['taskName'], ['childId'],
    ['childId', 'taskName'], ['callId'], ['target'], ['childId'], ['callId']], 'kept, sorted');
  // A declaration that names no identity field of the row, or repeats one, leaves the whole row unchecked.
  for (const fields of [['bogus'], ['callId', 'callId'], 'callId']) {
    const [row] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: 'c', childId: 'child-1',
      identityUncheckedFields: fields }] }).delegations;
    assert.equal(row.identityUnchecked, true, JSON.stringify(fields));
  }
});

test('M28: a source field a ledger declared unchecked blocks only the proofs that require it', () => {
  const rows = clean({ sources: [
    { adapter: 'codex', nested: true, sessionId: null, parentThreadId: 'parent-1', taskPath: '/root/worker',
      identityUncheckedFields: ['sessionId'] },
    { adapter: 'codex', nested: true, sessionId: 'child-1', parentThreadId: null, taskPath: '/root/worker',
      identityUncheckedFields: ['parentThreadId'] },
    { adapter: 'codex', nested: true, sessionId: null, parentThreadId: 'parent-1', taskPath: null,
      identityUncheckedFields: ['sessionId', 'taskPath'] },
  ] }).sources;
  assert.deepEqual(rows.map((row) => row.identityUnchecked === true), [false, false, true]);
  assert.deepEqual(rows.map((row) => row.identityUncheckedFields),
    [['sessionId'], ['parentThreadId'], ['sessionId', 'taskPath']]);
});

// D69 review: a hand-off's typed result is carried as recorder strings — no 512-character bound on its
// tool name and no `[a-z_]{1,40}` shape on its status (neither changed a recording). D90: a key-shaped status is a recorder
// string like any other; only a value that is not one is withheld.
test('D69 review, D90: a hand-off receipt carries its recorded tool name and status as written', () => {
  const long = `mcp__${'n'.repeat(600)}__agent`;
  const [kept] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: long, status: 'Completed Fully', totalToolUseCount: 2 } }] }).delegations;
  assert.deepEqual(kept.recorded, { tool: long, status: 'Completed Fully', totalToolUseCount: 2 });
  const [shaped] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: 'Agent', status: keyShaped, totalToolUseCount: 2 } }] }).delegations;
  assert.deepEqual(shaped.recorded, { tool: 'Agent', status: keyShaped, totalToolUseCount: 2 });
  const [odd] = clean({ delegations: [{ adapter: 'claude', turn: 1, callId: opaque, childId: 'child-1',
    recorded: { tool: 'Agent', status: 7 } }] }).delegations;
  assert.deepEqual(odd.recorded, { tool: 'Agent', withheld: true });
});
