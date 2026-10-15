import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DELEGATION_REASONS, detectDelegation, detectDelegations, isDelegationTool } from '../src/delegation.js';

const use = (name = 'spawn_agent', id = 'call-1') => ({ type: 'tool_use', name, id,
  input: { prompt: 'Synthetic delegated brief.', message: 'Synthetic delegated brief.' } });
const result = (value = { agent_id: 'child-1' }, callId = 'call-1') => ({ callId, value, isError: false });
const context = { adapter: 'codex', turn: 3 };
const entry = (id, childId, adapter = 'codex') => ({
  adapter, turn: 3, use: use(adapter === 'claude' ? 'Agent' : 'spawn_agent', id),
  result: result({ [adapter === 'claude' ? 'agentId' : 'agent_id']: childId }, id),
});

test('known child follow-ups preserve missing coverage without treating a target name as an identity', () => {
  for (const name of ['followup_task', 'collaboration.followup_task']) {
    assert.equal(isDelegationTool(name, 'codex'), true);
    const d = detectDelegation({ ...use(name), input: { target: 'display_name' } }, result({ agent_id: 'display-name' }), context);
    assert.equal(d.status, 'unresolved');
    assert.equal(d.childId, null);
    assert.equal(d.reason, 'delegation_child_unchecked');
    assert.equal(d.kind, 'followup');
    assert.equal(d.target, 'display_name');
    assert.equal(detectDelegation(use(name), { ...result(), isError: true }, context).status, 'failed');
    assert.equal(isDelegationTool(name, 'claude'), false);
  }
  assert.equal(isDelegationTool('followup_task_extra', 'codex'), false);
});

test('structured canonical task names are retained without accepting prose or suffixes', () => {
  const d = detectDelegation(use(), result({ task_name: '/root/parser_review' }), context);
  assert.equal(d.kind, 'spawn');
  assert.equal(d.taskName, '/root/parser_review');
  assert.equal(d.childId, null);
  for (const task_name of ['parser_review', '/root', '/root/a-b', '/root/a/', '/other/a', '/root/a/../b']) {
    assert.equal(detectDelegation(use(), result({ task_name }), context).taskName, undefined);
  }
});

test('duplicate canonical task spawn results in one parent source are ambiguous', () => {
  const make = id => ({ adapter: 'codex', source: 0, turn: 1, use: use('spawn_agent', id),
    result: result({ task_name: '/root/parser_review' }, id) });
  const found = detectDelegations([make('call-a'), make('call-b')]);
  assert.ok(found.every(d => d.reason === 'delegation_child_ambiguous' && d.taskName === null));
});

test('call ambiguity clears every child-routing field', () => {
  const spawn = { adapter: 'codex', source: 0, turn: 1, use: use('spawn_agent', 'same'),
    result: result({ task_name: '/root/parser_review' }, 'same') };
  const follow = { adapter: 'codex', source: 0, turn: 2,
    use: { ...use('followup_task', 'same'), input: { target: 'parser_review' } }, result: result({}, 'same') };
  for (const d of detectDelegations([spawn, follow])) {
    assert.equal(d.reason, 'delegation_call_ambiguous');
    assert.equal(d.childId, null); assert.equal(d.taskName, null); assert.equal(d.target, null);
  }
});

test('identity reuse in separate source recordings is not a collision and source receipts survive', () => {
  const entries = [0, 1].map(source => ({ ...entry('same-call', 'same-child'), source, record: 12 }));
  const found = detectDelegations(entries);
  assert.deepEqual(found.map(d => [d.source, d.record, d.callId, d.childId, d.reason]), [
    [0, 12, 'same-call', 'same-child', 'delegation_child_unchecked'],
    [1, 12, 'same-call', 'same-child', 'delegation_child_unchecked'],
  ]);
  for (const source of [null, -1, '1', 1.5, Infinity]) {
    const d = detectDelegation(use(), result(), { ...context, source });
    assert.equal(d.childId, null);
    assert.equal(d.reason, 'delegation_source_invalid');
  }
});

test('only exact adapter-specific spawn tools produce delegation descriptors', () => {
  for (const name of ['Task', 'Agent']) {
    assert.equal(isDelegationTool(name, 'claude'), true);
    assert.equal(detectDelegation(use(name), result({ agentId: 'child-1' }), { adapter: 'claude', turn: 0 }).childId, 'child-1');
  }
  for (const name of ['spawn_agent', 'collaboration.spawn_agent']) {
    assert.equal(isDelegationTool(name, 'codex'), true);
    assert.equal(detectDelegation(use(name), result(), context).childId, 'child-1');
  }
  for (const name of ['task', 'agent', 'TaskOutput', 'spawn_agent_extra', 'tools.spawn_agent', 'functions.spawn_agent',
    'mcp__collaboration__spawn_agent', 'collaboration.send_message', 'collaboration.spawn_agent ', 'Task', 'Agent']) {
    assert.equal(detectDelegation(use(name), result(), context), null, name);
    assert.equal(isDelegationTool(name, 'codex'), false, name);
  }
  for (const name of ['spawn_agent', 'collaboration.spawn_agent']) {
    assert.equal(detectDelegation(use(name), result(), { adapter: 'claude', turn: 3 }), null);
  }
  assert.equal(detectDelegation({ ...use(), type: 'text', text: 'spawn_agent' }, result(), context), null);
  assert.equal(isDelegationTool('spawn_agent', '__proto__'), false);
  assert.equal(isDelegationTool(null, 'codex'), false);
  assert.equal(isDelegationTool('spawn_agent', {}), false);
});

test('a matched explicit child ID remains UNCHECKED and retains only the invocation brief as parent evidence', () => {
  const detected = detectDelegation(use(), result({ agent_id: 'child-1', prompt: 'Synthetic brief', summary: 'Synthetic claim', parentUuid: 'not-a-parent' }), context);
  assert.deepEqual(detected, { adapter: 'codex', callId: 'call-1', turn: 3, childId: 'child-1',
    status: 'unresolved', reason: 'delegation_child_unchecked',
    parentInstruction: { text: 'Synthetic delegated brief.', tool: 'spawn_agent', field: 'message' } });
  const claude = detectDelegation({ ...use('Task'), input: { prompt: 'Claude brief.', message: 'wrong field' } },
    result({ agentId: 'child-2' }), { adapter: 'claude', turn: 4, source: 1, record: 9 });
  assert.deepEqual(claude.parentInstruction, { text: 'Claude brief.', tool: 'Task', field: 'prompt' });
  assert.deepEqual([claude.turn, claude.source, claude.record, claude.callId], [4, 1, 9, 'call-1']);
});

test('only a correlated non-error Codex spawn preserves exact no-history mode', () => {
  const noFork = { ...use(), input: { ...use().input, fork_turns: 'none' } };
  assert.equal(detectDelegation(noFork, { ...result(), isError: false }, context).forkTurns, 'none');
  for (const fork_turns of [undefined, 'all', 'None', 'none ', 1, true]) {
    const input = { ...use().input, ...(fork_turns === undefined ? {} : { fork_turns }) };
    assert.equal(detectDelegation({ ...use(), input }, { ...result(), isError: false }, context).forkTurns,
      undefined);
  }
  assert.equal(detectDelegation(noFork, { ...result(), isError: undefined }, context).forkTurns, undefined,
    'an absent explicit success cannot prove the no-fork branch');
  assert.equal(detectDelegation(noFork, { ...result(), isError: true }, context).forkTurns, undefined);
  assert.equal(detectDelegation(noFork, { ...result(), callId: 'wrong', isError: false }, context).forkTurns, undefined);
});

test('whole structured JSON is accepted; prose, fences, blocks and malformed values are not identity', () => {
  assert.equal(detectDelegation(use(), result(' {"agent_id":"child-1"} '), context).childId, 'child-1');
  for (const value of [null, false, 12, [], [{ agent_id: 'child-1' }], '{broken', 'child-1',
    'Created agent {"agent_id":"child-1"}', '```json\n{"agent_id":"child-1"}\n```',
    [{ type: 'text', text: '{"agent_id":"child-1"}' }], JSON.stringify({ agent_id: 'child-1', text: 'x'.repeat(16_384) })]) {
    const detected = detectDelegation(use(), result(value), context);
    assert.equal(detected.childId, null);
    assert.equal(detected.status, 'unresolved');
  }
});

test('unmatched and missing results cannot borrow another call identity or explicit failure', () => {
  for (const value of [undefined, null]) assert.equal(detectDelegation(use(), value, context).reason, 'delegation_result_missing');
  for (const value of [{}, [], 'ok']) assert.equal(detectDelegation(use(), value, context).childId, null);
  assert.equal(detectDelegation(use(), result({ agent_id: 'child-1' }, 'call-2'), context).reason, 'delegation_result_unmatched');
  const spoof = detectDelegation(use(), { callId: 'call-2', value: { agent_id: 'child-1' }, isError: true }, context);
  assert.equal(spoof.status, 'unresolved');
  assert.equal(spoof.childId, null);
  assert.equal(detectDelegation(use('spawn_agent', 'call-1:0'), result(), context).childId, null);
});

test('only a matched explicit error proves spawn failure', () => {
  assert.deepEqual(detectDelegation(use(), { ...result(), isError: true }, context), {
    adapter: 'codex', callId: 'call-1', turn: 3, childId: null, status: 'failed', reason: 'delegation_spawn_failed',
    parentInstruction: { text: 'Synthetic delegated brief.', tool: 'spawn_agent', field: 'message' },
  });
  assert.equal(detectDelegation(use(), result({ error: 'synthetic failure', agent_id: 'child-1' }), context).status, 'unresolved');
  for (const flag of ['true', 1, null]) assert.equal(detectDelegation(use(), { ...result(), isError: flag }, context).childId, null);
});

test('duplicate matched results are ambiguous, including conflicting success and failure', () => {
  for (const values of [[result(), result()], [result(), { ...result(), isError: true }],
    [result(), result({ agent_id: 'child-2' })]]) {
    const detected = detectDelegation(use(), values, context);
    assert.equal(detected.childId, null);
    assert.equal(detected.status, 'unresolved');
    assert.equal(detected.reason, 'delegation_result_ambiguous');
  }
  assert.equal(detectDelegation(use(), [result(), result({ agent_id: 'child-2' }, 'call-2')], context).childId, null);
});

test('adapter, turn and identities are bounded and malformed provenance preserves a gap', () => {
  for (const adapter of ['cursor', 'Claude', '', null, undefined, '__proto__', {}, Object.create(null)]) {
    assert.equal(detectDelegation(use(), result(), { adapter, turn: 3 }), null);
  }
  for (const turn of [-1, 1.5, '3', null, undefined, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const detected = detectDelegation(use(), result(), { adapter: 'codex', turn });
    assert.equal(detected.turn, null);
    assert.equal(detected.childId, null);
    assert.equal(detected.reason, 'delegation_turn_invalid');
  }
  for (const id of ['', ' ', 'child\n1', ' child-1', 'child 1', 'x'.repeat(201), 42, {}, null]) {
    assert.equal(detectDelegation(use(), result({ agent_id: id }), context).childId, null);
    assert.equal(detectDelegation(use('spawn_agent', id), result({ agent_id: 'child-1' }, id), context).reason, 'delegation_call_invalid');
  }
  assert.equal(detectDelegation(use(), result({ agent_id: 'x'.repeat(200) }), context).childId.length, 200);
});

test('only normal own fields establish identity; generic and unrelated identifiers never do', () => {
  for (const value of [{ id: 'child-1' }, { session_id: 'child-1' }, { parentUuid: 'child-1' },
    { agentId: 'child-1' }, { source: { agent_id: 'child-1' } }, Object.create({ agent_id: 'child-1' })]) {
    assert.equal(detectDelegation(use(), result(value), context).childId, null);
  }
  assert.equal(detectDelegation(use(), Object.create(result()), context).childId, null);
  assert.equal(detectDelegation(Object.create(use()), result(), context), null);
  assert.equal(detectDelegation(use(), result(), Object.create(context)), null);
  const ownNullPrototype = Object.assign(Object.create(null), { agent_id: 'child-1' });
  assert.equal(detectDelegation(use(), result(ownNullPrototype), context).childId, 'child-1');
  const accessor = Object.defineProperty({}, 'agent_id', { get() { throw new Error('must not read accessor'); } });
  assert.equal(detectDelegation(use(), result(accessor), context).childId, null);
});

test('duplicate call IDs are ambiguous even when the competing call is not a spawn', () => {
  const first = entry('same-call', 'child-1');
  const second = entry('same-call', 'child-2');
  for (const detected of detectDelegations([first, second])) {
    assert.equal(detected.childId, null);
    assert.equal(detected.reason, 'delegation_call_ambiguous');
  }
  const unsupported = { ...second, use: use('exec_command', 'same-call') };
  const detected = detectDelegations([first, unsupported]);
  assert.equal(detected.length, 1);
  assert.equal(detected[0].reason, 'delegation_call_ambiguous');
});

test('duplicate child IDs across different calls are ambiguous within an adapter only', () => {
  for (const detected of detectDelegations([entry('call-1', 'same-child'), entry('call-2', 'same-child')])) {
    assert.equal(detected.childId, null);
    assert.equal(detected.reason, 'delegation_child_ambiguous');
  }
  const crossAdapter = detectDelegations([entry('same-call', 'same-child'), entry('same-call', 'same-child', 'claude')]);
  assert.equal(crossAdapter.length, 2);
  assert.ok(crossAdapter.every((detected) => detected.childId === 'same-child' && detected.status === 'unresolved'));
});

// B2: Claude's Agent/Task tool reports the child it launched as a LINE in the result text
// ("agentId: <16 hex>"), not as JSON. That line is the only place the identity appears, so it is
// the transport — unlike Codex, where `agent_id` is a structured field and prose is never an
// identity (the "whole structured JSON is accepted" test above pins that asymmetry).
const prose = (text, callId = 'call-1') => ({ callId, value: text, isError: false });
const claude = (value, name = 'Agent') => detectDelegation(use(name, 'call-1'), prose(value),
  { adapter: 'claude', turn: 2, source: 0 });

test('B2: a Claude spawn result line carries the child agentId as its identity', () => {
  for (const name of ['Agent', 'Task']) {
    const d = claude('Async agent launched.\nagentId: 0123456789abcdef\nUse SendMessage to reach it.', name);
    assert.equal(d.childId, '0123456789abcdef');
    assert.equal(d.status, 'unresolved');
    assert.equal(d.reason, 'delegation_child_unchecked', 'a proven child ID is still UNCHECKED coverage');
  }
  // Repeated mentions of the SAME id are one identity; the real result line can appear twice.
  assert.equal(claude('agentId: 0123456789abcdef\nrunning\nagentId: 0123456789abcdef').childId, '0123456789abcdef');
  assert.equal(claude('  agentId:0123456789abcdef').childId, '0123456789abcdef');
});

test('B2: two different agent IDs in one result are ambiguous, never a pick', () => {
  const d = claude('agentId: 0123456789abcdef\nagentId: fedcba9876543210');
  assert.equal(d.childId, null);
  assert.equal(d.reason, 'delegation_child_ambiguous');
  assert.equal(d.status, 'unresolved');
});

test('B2: only a line-anchored 16-hex agentId is an identity', () => {
  for (const value of [
    'the report mentions agentId: 0123456789abcdef inline',   // mid-line prose, not the receipt line
    'agentId: 0123456789abcde',                               // 15
    'agentId: 0123456789abcdefa',                             // 17
    'agentId: 0123456789ABCDEF',                              // not lower hex
    'agent_id: 0123456789abcdef',                             // the Codex field name
    'agentId = 0123456789abcdef',
    'agentId:\n0123456789abcdef',
    `agentId: 0123456789abcdef${'x'.repeat(16_384)}`,         // beyond the result cap
  ]) {
    const d = claude(value);
    assert.equal(d.childId, null, value.slice(0, 40));
    assert.equal(d.reason, 'delegation_result_malformed');
  }
  // Codex keeps its structured-only rule: the same line in a Codex result is still prose.
  assert.equal(detectDelegation(use('spawn_agent'), prose('agentId: 0123456789abcdef'), context).childId, null);
  assert.equal(detectDelegation(use('spawn_agent'), prose('agent_id: 0123456789abcdef'), context).childId, null);
});

test('B2: a structured Claude result still wins, and a failed spawn still reports failure', () => {
  assert.equal(detectDelegation(use('Agent'), { callId: 'call-1', value: JSON.stringify({ agentId: 'child-7' }) },
    { adapter: 'claude', turn: 2 }).childId, 'child-7');
  assert.equal(detectDelegation(use('Agent'), { callId: 'call-1', value: 'agentId: 0123456789abcdef', isError: true },
    { adapter: 'claude', turn: 2 }).status, 'failed');
});

test('B2: two Claude spawns keep the turn of their own tool_use (F29)', () => {
  const at = (turn, id, child) => ({ adapter: 'claude', source: 0, turn, use: use('Agent', id),
    result: prose(`agentId: ${child}`, id) });
  const found = detectDelegations([at(2, 'call-a', '0123456789abcdef'), at(4, 'call-b', 'fedcba9876543210')]);
  assert.deepEqual(found.map((d) => [d.turn, d.childId]),
    [[2, '0123456789abcdef'], [4, 'fedcba9876543210']]);
});

test('detection is deterministic, preserves order, and never mutates inputs', () => {
  const entries = [entry('call-2', 'child-2'), entry('call-1', 'child-1')];
  const before = structuredClone(entries);
  const first = detectDelegations(entries);
  assert.deepEqual(detectDelegations(entries), first);
  assert.deepEqual(entries, before);
  assert.deepEqual(first.map((d) => d.callId), ['call-2', 'call-1']);
  first[0].childId = 'changed';
  assert.equal(detectDelegations(entries)[0].childId, 'child-2');
  for (const invalid of [null, {}, 'spawn_agent']) assert.deepEqual(detectDelegations(invalid), []);
  assert.deepEqual(detectDelegations([null, {}, false]), []);
  assert.equal(Object.isFrozen(DELEGATION_REASONS), true);
  assert.equal(new Set(Object.values(DELEGATION_REASONS)).size, Object.keys(DELEGATION_REASONS).length);
  assert.ok(first.every((d) => Object.values(DELEGATION_REASONS).includes(d.reason)));
});
