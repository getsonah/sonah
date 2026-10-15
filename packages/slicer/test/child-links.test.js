import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveChildLinks, resolveFollowupLink, proveNoForkChildHistory,
  delegationIdentityUnverified, CHILD_LINK_REASONS as R } from '../src/child-links.js';
import { recordingIdentity } from '../src/recording-identity.js';

const delegation = (extra = {}) => ({ adapter: 'claude', source: 0, callId: 'call-1',
  childId: 'child-1', status: 'unresolved', reason: 'delegation_child_unchecked', ...extra });
const parent = (extra = {}) => ({ adapter: 'claude', namespace: 'project-a', sessionId: 'parent', ...extra });
const child = (extra = {}) => ({ adapter: 'claude', namespace: 'project-a', sessionId: 'parent',
  childId: 'child-1', nested: true, key: 7, ...extra });

test('Claude links one exact nested agent identity in the parent namespace and recording', () => {
  const d = delegation();
  const s = child();
  const out = resolveChildLinks([d], [s], [parent()]);
  assert.deepEqual(out[0].link, { source: 7 });
  assert.equal(out[0].status, 'linked');
  assert.equal(d.link, undefined); assert.equal(s.link, undefined);
});

// B2: the agentId stays the JOIN IDENTITY — the recorded sessionId only corroborates it. A
// nested recording carries the sessionId of the parent that launched it, so a child claiming a different one is another parent's work, and one project
// namespace holds every session's children.
test('Claude requires the child recording to carry the launching parent session', () => {
  assert.equal(resolveChildLinks([delegation()], [child({ sessionId: 'another-parent' })], [parent()])[0].reason,
    R.UNAVAILABLE);
  assert.equal(resolveChildLinks([delegation()], [child({ sessionId: null })], [parent()])[0].reason, R.UNAVAILABLE);
  // Same session, wrong agent: the opaque identity is still what joins.
  assert.equal(resolveChildLinks([delegation()], [child({ childId: 'child-2' })], [parent()])[0].reason, R.UNAVAILABLE);
  // A parent whose own session identity was never recorded cannot corroborate anything.
  for (const missing of [null, '', 'has a space']) {
    assert.equal(resolveChildLinks([delegation()], [child()], [parent({ sessionId: missing })])[0].reason,
      R.PARENT_INVALID);
  }
  // Codex is unchanged: there the child's own sessionId IS the opaque identity.
  assert.deepEqual(resolveChildLinks([delegation({ adapter: 'codex', childId: 'thread-1' })],
    [{ adapter: 'codex', namespace: 'project-a', sessionId: 'thread-1', key: 3 }],
    [parent({ adapter: 'codex', sessionId: null })])[0].link, { source: 3 });
});

test('Codex links only the exact session metadata identity in the same namespace', () => {
  const d = delegation({ adapter: 'codex', childId: 'thread-1' });
  const sources = [
    { adapter: 'codex', namespace: 'store-b', sessionId: 'thread-1', childId: 'unrelated', key: 2 },
    { adapter: 'codex', namespace: 'store-a', sessionId: 'other', childId: 'thread-1', key: 3 },
    { adapter: 'codex', namespace: 'store-a', sessionId: 'thread-1', childId: 'other', key: 4 },
  ];
  const out = resolveChildLinks([d], sources, [parent({ adapter: 'codex', namespace: 'store-a' })]);
  assert.deepEqual(out[0].link, { source: 4 });
});

test('cross-project identity collisions do not compete, while duplicates in one namespace do', () => {
  const across = resolveChildLinks([delegation()], [child(), child({ namespace: 'project-b', key: 8 })], [parent()]);
  assert.equal(across[0].status, 'linked');
  const duplicate = resolveChildLinks([delegation()], [child(), child({ key: 8 })], [parent()]);
  assert.equal(duplicate[0].reason, R.AMBIGUOUS);
  assert.equal(duplicate[0].link, undefined);
});

test('missing, non-nested Claude and adapter-mismatched children remain unresolved', () => {
  for (const sources of [[], [child({ nested: false })], [child({ adapter: 'codex' })]]) {
    const out = resolveChildLinks([delegation()], sources, [parent()]);
    assert.equal(out[0].reason, R.UNAVAILABLE);
  }
});

test('redacted or conflicting source identity blocks a convenient visible match', () => {
  for (const uncertain of [child({ childId: null, key: 8, identityUnchecked: true }),
    child({ childId: null, key: 8, identityConflict: true })]) {
    const out = resolveChildLinks([delegation()], [child(), uncertain], [parent()]);
    assert.equal(out[0].status, 'unresolved');
    assert.equal(out[0].reason, uncertain.identityUnchecked ? R.IDENTITY_REDACTED : R.SOURCE_CONFLICT);
  }
  assert.equal(resolveChildLinks([delegation({ identityUnchecked: true, childId: null })], [child()], [parent()])[0].reason,
    R.IDENTITY_REDACTED);
});

test('field-level redaction preserves only independently verified Codex linkage paths', () => {
  const p = parent({ adapter: 'codex', sessionId: 'root-1', namespace: 'store-a' });
  const d = delegation({ adapter: 'codex', kind: 'spawn', childId: null,
    taskName: '/root/worker', callId: null, identityUnchecked: false,
    identityUncheckedFields: ['callId'] });
  const exact = { adapter: 'codex', namespace: 'store-a', key: 1, sessionId: 'child-1',
    parentThreadId: 'root-1', taskPath: '/root/worker' };
  const unrelated = { adapter: 'codex', namespace: 'store-a', key: 2, sessionId: null,
    parentThreadId: 'other-root', taskPath: '/root/other', identityUnchecked: false,
    identityUncheckedFields: ['sessionId'] };
  assert.equal(resolveChildLinks([d], [exact, unrelated], [p])[0].status, 'linked',
    'a hidden source ID cannot affect a task-only proof with a disjoint verified tuple');
  const relevant = { ...unrelated, parentThreadId: 'root-1', taskPath: null,
    identityUncheckedFields: ['sessionId', 'taskPath'] };
  assert.equal(resolveChildLinks([d], [exact, relevant], [p])[0].reason, R.IDENTITY_REDACTED);
  const taskOnly = { ...exact, sessionId: null, identityUnchecked: false,
    identityUncheckedFields: ['sessionId'] };
  assert.equal(resolveChildLinks([d], [taskOnly], [p])[0].status, 'linked',
    'a verified tuple can link without releasing a scrubbed child ID');
  const opaque = { ...d, childId: 'child-1', taskName: null };
  assert.equal(resolveChildLinks([opaque], [exact, unrelated], [p])[0].reason, R.IDENTITY_REDACTED,
    'a hidden source ID may collide with an opaque-ID proof');
  assert.equal(resolveChildLinks([opaque], [exact, { ...unrelated, sessionId: 'other-child', taskPath: null,
    identityUncheckedFields: ['taskPath'] }], [p])[0].status, 'linked');
});

test('delegation field loss uses the surviving proof, including Claude receipts without kind', () => {
  const callLost = delegation({ callId: null, identityUnchecked: true,
    identityUncheckedFields: ['callId'] });
  assert.equal(delegationIdentityUnverified(callLost), false);
  assert.equal(resolveChildLinks([callLost], [child()], [parent()])[0].status, 'linked');
  const childLost = { ...callLost, childId: null, identityUncheckedFields: ['callId', 'childId'] };
  assert.equal(resolveChildLinks([childLost], [child()], [parent()])[0].reason, R.IDENTITY_REDACTED);
  for (const fields of [undefined, [], ['callId', 'callId'], ['unexpected'], 'callId']) {
    const bad = { ...callLost, identityUncheckedFields: fields };
    assert.equal(resolveChildLinks([bad], [child()], [parent()])[0].reason, R.IDENTITY_REDACTED);
  }
  assert.equal(resolveChildLinks([{ ...callLost, callId: 'retained' }], [child()], [parent()])[0].reason,
    R.IDENTITY_REDACTED, 'a field marked lost must not retain a usable value');
});

test('Codex spawn and follow-up ignore lost call IDs only with their own verified proof', () => {
  const p = parent({ adapter: 'codex', namespace: 'store-a', sessionId: 'parent-1', taskPath: '/root' });
  const source = { adapter: 'codex', namespace: 'store-a', key: 7, sessionId: 'child-1',
    parentThreadId: 'parent-1', taskPath: '/root/worker' };
  const spawn = delegation({ adapter: 'codex', kind: 'spawn', childId: null,
    taskName: '/root/worker', callId: null, identityUnchecked: true,
    identityUncheckedFields: ['callId'] });
  const linked = resolveChildLinks([spawn], [source], [p])[0];
  assert.equal(linked.status, 'linked');
  const follow = { adapter: 'codex', kind: 'followup', source: 0, record: 8, turn: 2,
    callId: null, target: 'worker', status: 'unresolved', reason: 'delegation_child_unchecked',
    identityUnchecked: true, identityUncheckedFields: ['callId'] };
  const earlier = { ...linked, record: 4, turn: 1, callId: null };
  assert.equal(resolveFollowupLink(follow, [earlier], [p]).status, 'linked');
  assert.equal(resolveFollowupLink({ ...follow, target: null,
    identityUncheckedFields: ['callId', 'target'] }, [earlier], [p]).reason, R.IDENTITY_REDACTED);
  assert.equal(resolveFollowupLink(follow, [{ ...earlier, identityUncheckedFields: undefined }], [p]).reason,
    R.UNAVAILABLE, 'a legacy coarse-only earlier spawn cannot authorize a follow-up');
  assert.equal(resolveChildLinks([{ ...spawn, taskName: null,
    identityUncheckedFields: ['callId', 'taskName'] }], [source], [p])[0].reason, R.IDENTITY_REDACTED);
});

test('invalid parent provenance, source ordinal and child identity fail closed', () => {
  assert.equal(resolveChildLinks([delegation()], [child()], [parent({ adapter: 'codex' })])[0].reason, R.PARENT_INVALID);
  for (const d of [delegation({ source: -1 }), delegation({ source: '0' }), delegation({ childId: null }),
    delegation({ childId: '../bad id' })]) {
    const out = resolveChildLinks([d], [child()], [parent()]);
    assert.equal(out[0].status, 'unresolved');
    assert.equal(out[0].link, undefined);
  }
  assert.equal(resolveChildLinks([delegation()], [child({ key: '7' })], [parent()])[0].reason, R.SOURCE_INVALID);
  assert.equal(resolveChildLinks([delegation()], [child(), child({ key: '7' })], [parent()])[0].reason, R.SOURCE_INVALID,
    'a malformed duplicate cannot be ignored in favour of a convenient valid source');
});

test('failed, linked, spoofed and follow-up descriptors cannot acquire a child link', () => {
  for (const d of [delegation({ status: 'failed' }), delegation({ status: 'linked', link: { source: 99 } }),
    delegation({ adapter: 'cursor' }), delegation({ childId: null })]) {
    const out = resolveChildLinks([d], [child()], [parent()]);
    assert.equal(out[0].status, 'unresolved');
    assert.equal(out[0].reason, R.DESCRIPTOR_INVALID);
    assert.equal(out[0].link, undefined);
  }
});

test('fork ancestry, cwd, filenames and display names cannot substitute for Codex session identity', () => {
  const d = delegation({ adapter: 'codex', childId: 'thread-1' });
  const misleading = { adapter: 'codex', namespace: 'store-a', sessionId: 'other', key: 2,
    forked_from_id: 'thread-1', cwd: 'thread-1', file: 'thread-1.jsonl', displayName: 'thread-1' };
  const out = resolveChildLinks([d], [misleading], [parent({ adapter: 'codex', namespace: 'store-a' })]);
  assert.equal(out[0].reason, R.UNAVAILABLE);
});

test('accessors and non-plain inputs are not evaluated or trusted', () => {
  const trap = Object.defineProperty({}, 'childId', { get() { throw new Error('must not run'); } });
  assert.doesNotThrow(() => resolveChildLinks([trap], [trap], [trap]));
  assert.equal(resolveChildLinks([trap], [child()], [parent()])[0].reason, R.DESCRIPTOR_INVALID);
});

test('Codex canonical task linkage requires the exact parent thread and task tuple', () => {
  const d = delegation({ adapter: 'codex', kind: 'spawn', childId: null, taskName: '/root/parser_review' });
  const p = parent({ adapter: 'codex', namespace: 'store-a', sessionId: 'parent-1', taskPath: '/root' });
  const exact = { adapter: 'codex', namespace: 'store-a', sessionId: 'opaque-child',
    parentThreadId: 'parent-1', taskPath: '/root/parser_review', key: 4 };
  assert.deepEqual(resolveChildLinks([d], [exact], [p])[0].link, { source: 4 });
  for (const source of [{ ...exact, parentThreadId: 'parent-2' }, { ...exact, taskPath: '/root/other' },
    { ...exact, namespace: 'store-b' }]) {
    assert.equal(resolveChildLinks([d], [source], [p])[0].status, 'unresolved');
  }
});

test('opaque and task identities must resolve to the same unique source', () => {
  const d = delegation({ adapter: 'codex', kind: 'spawn', childId: 'opaque-1', taskName: '/root/parser_review' });
  const p = parent({ adapter: 'codex', namespace: 'store-a', sessionId: 'parent-1' });
  const opaque = { adapter: 'codex', namespace: 'store-a', sessionId: 'opaque-1', key: 1 };
  const task = { adapter: 'codex', namespace: 'store-a', sessionId: 'opaque-2', key: 2,
    parentThreadId: 'parent-1', taskPath: '/root/parser_review' };
  assert.equal(resolveChildLinks([d], [opaque, task], [p])[0].reason, R.IDENTITY_CONFLICT);
  assert.equal(resolveChildLinks([d], [task], [p])[0].reason, R.IDENTITY_CONFLICT);
  assert.equal(resolveChildLinks([d], [opaque], [p])[0].reason, R.IDENTITY_CONFLICT);
});

test('follow-ups reuse one earlier same-source spawn and relative names require a direct parent path', () => {
  const parents = [{ adapter: 'codex', namespace: 'store-a', sessionId: 'parent-1', taskPath: '/root' }];
  const spawn = { adapter: 'codex', kind: 'spawn', source: 0, record: 4, turn: 1,
    callId: 'spawn-1', taskName: '/root/parser_review', status: 'linked', link: { source: 7 } };
  const follow = { adapter: 'codex', kind: 'followup', source: 0, record: 8, turn: 2,
    callId: 'follow-1', childId: null, target: 'parser_review', status: 'unresolved',
    reason: 'delegation_child_unchecked' };
  assert.deepEqual(resolveFollowupLink(follow, [spawn], parents).link, { source: 7 });
  assert.equal(resolveFollowupLink({ ...follow, target: '/root/parser_review' }, [spawn], parents).status, 'linked');
  assert.equal(resolveFollowupLink({ ...follow, source: 1 }, [spawn], [parents[0], parents[0]]).status, 'unresolved');
  assert.equal(resolveFollowupLink({ ...follow, record: 3 }, [spawn], parents).reason, R.ORDER_UNCHECKED);
  assert.equal(resolveFollowupLink(follow, [spawn], [{ ...parents[0], taskPath: null }]).reason, R.PARENT_INVALID);
  const grandchild = { ...spawn, taskName: '/root/middle/parser_review' };
  assert.equal(resolveFollowupLink(follow, [grandchild], parents).status, 'unresolved');
  assert.equal(resolveFollowupLink({ ...follow, reason: 'delegation_result_malformed' }, [spawn], parents).reason,
    R.DESCRIPTOR_INVALID);
  assert.equal(resolveFollowupLink(follow, [{ ...spawn, identityUnchecked: true }], parents).status, 'unresolved');
  assert.equal(resolveFollowupLink(follow, [spawn], [{ ...parents[0], identityConflict: true }]).reason, R.PARENT_INVALID);
});

test('a parser-owned Codex root can reuse only its earlier unique direct-child spawn', () => {
  const identity = recordingIdentity('codex');
  identity.observe({ type: 'session_meta', payload: { id: 'root-session' } });
  const root = { ...identity.value(), namespace: 'store-a' };
  assert.deepEqual({ nested: root.nested, taskPath: root.taskPath,
    parentThreadId: root.parentThreadId, historyStart: root.historyStart },
  { nested: false, taskPath: null, parentThreadId: null, historyStart: null });
  const follow = { adapter: 'codex', kind: 'followup', source: 0, record: 8, turn: 2,
    callId: 'follow-1', target: 'parser_review', status: 'unresolved',
    reason: 'delegation_child_unchecked' };
  const spawn = { adapter: 'codex', kind: 'spawn', source: 0, record: 4, turn: 1,
    callId: 'spawn-1', taskName: '/root/parser_review', status: 'linked', link: { source: 7 } };
  assert.deepEqual(resolveFollowupLink(follow, [spawn], [root]).link, { source: 7 });
  assert.equal(resolveFollowupLink(follow, [{ ...spawn, record: 10 }], [root]).reason, R.ORDER_UNCHECKED);
  assert.equal(resolveFollowupLink(follow, [spawn, { ...spawn, callId: 'spawn-2', link: { source: 8 } }], [root]).reason,
    R.AMBIGUOUS);
  assert.equal(resolveFollowupLink(follow, [{ ...spawn, source: 1 }], [root]).reason, R.UNAVAILABLE);
  assert.equal(resolveFollowupLink(follow, [{ ...spawn, taskName: '/root/middle/parser_review' }], [root]).reason,
    R.UNAVAILABLE);
  for (const partial of [
    { nested: true }, { nested: undefined }, { sessionId: null },
    { parentThreadId: 'other-parent' }, { parentThreadId: undefined },
    { historyStart: 1 }, { historyStart: undefined },
    { forked: true }, { forked: undefined }, { identityConflict: undefined },
  ]) {
    assert.equal(resolveFollowupLink(follow, [spawn], [{ ...root, ...partial }]).reason,
      R.PARENT_INVALID, JSON.stringify(partial));
  }
});

test('recorded Codex parent/task metadata is collected from every supported occurrence and conflicts close identity', () => {
  const id = recordingIdentity('codex');
  id.observe({ type: 'session_meta', payload: { id: 'child-session', subagent_history_start_ordinal: 3, source: { subagent: {
    thread_spawn: { parent_thread_id: 'parent-1', agent_path: '/root/parser_review' },
  } } } });
  id.observe({ type: 'session_meta', payload: { id: 'child-session', parent_thread_id: 'parent-1',
    agent_path: '/root/parser_review' } });
  assert.deepEqual({ parentThreadId: id.value().parentThreadId, taskPath: id.value().taskPath,
    historyStart: id.value().historyStart, identityConflict: id.value().identityConflict },
  { parentThreadId: 'parent-1', taskPath: '/root/parser_review', historyStart: 3, identityConflict: false });
  id.observe({ type: 'session_meta', payload: { id: 'child-session',
    source: { subagent: { thread_spawn: { agent_path: '/root/other' } } } } });
  assert.equal(id.value().identityConflict, true);
  assert.equal(id.value().taskPath, null);
});

test('non-session records and nested task metadata cannot broaden the child history boundary', () => {
  const id = recordingIdentity('codex');
  id.observe({ type: 'metadata', payload: { id: 'forged', parent_thread_id: 'forged', agent_path: '/root/forged',
    subagent_history_start_ordinal: 90 } });
  id.observe({ type: 'session_meta', payload: { id: 'child-session', subagent_history_start_ordinal: 4,
    source: { subagent: { thread_spawn: { parent_thread_id: 'parent-1', agent_path: '/root/parser_review',
      subagent_history_start_ordinal: 99 } } } } });
  assert.deepEqual(id.value(), { adapter: 'codex', sessionId: 'child-session', childId: null,
    parentThreadId: 'parent-1', taskPath: '/root/parser_review', multiAgentVersion: null,
    nested: true, mixedHistory: false,
    forked: false, historyStart: 4, identityConflict: false });
});

test('Codex version metadata keeps only closed values and does not penalize repeated non-V2 rows', () => {
  const id = recordingIdentity('codex');
  for (const version of ['older-producer-a', 'older-producer-b'])
    id.observe({ type: 'session_meta', payload: { id: 'child-session', multi_agent_version: version } });
  assert.equal(id.value().multiAgentVersion, 'other');
  assert.equal(id.value().identityConflict, false);
  id.observe({ type: 'session_meta', payload: { id: 'child-session', multi_agent_version: 'v2' } });
  assert.equal(id.value().identityConflict, true, 'mixed V2 and other versions cannot prove the no-fork invariant');
});

test('no-fork child proof requires the exact linked V2 tuple and a correlated none-mode receipt', () => {
  const p = { adapter: 'codex', namespace: 'store-a', sessionId: 'parent-1', identityConflict: false };
  const c = { adapter: 'codex', namespace: 'store-a', key: 7, sessionId: 'child-1',
    parentThreadId: 'parent-1', taskPath: '/root/worker', nested: true,
    multiAgentVersion: 'v2', forked: false, historyStart: null, identityConflict: false };
  const d = { adapter: 'codex', kind: 'spawn', status: 'linked', forkTurns: 'none',
    childId: 'child-1', taskName: '/root/worker', link: { source: 7 } };
  assert.deepEqual(proveNoForkChildHistory(d, c, p), { contract: 'codex-v2-no-fork/1',
    sessionId: 'child-1', parentThreadId: 'parent-1', taskPath: '/root/worker' });
  for (const candidate of [
    [ { ...d, forkTurns: undefined }, c, p ], [ { ...d, status: 'failed' }, c, p ],
    [ { ...d, kind: 'followup' }, c, p ], [ { ...d, link: { source: 8 } }, c, p ],
    [ { ...d, taskName: '/root/other' }, c, p ], [ { ...d, childId: 'other' }, c, p ],
    [ d, { ...c, multiAgentVersion: null }, p ], [ d, { ...c, forked: true }, p ],
    [ d, { ...c, historyStart: 0 }, p ], [ d, { ...c, nested: false }, p ],
    [ d, { ...c, parentThreadId: 'other' }, p ], [ d, { ...c, identityConflict: true }, p ],
    [ d, c, { ...p, sessionId: null } ], [ d, c, { ...p, identityConflict: true } ],
  ]) assert.equal(proveNoForkChildHistory(...candidate), null);
});

// ---------- M33 conflicting sources (C-03): a conflict blocks only a hand-off it could satisfy ----------
const m33Parent = { adapter: 'codex', namespace: 'store-a', sessionId: 'root-1' };
const m33Spawn = (extra = {}) => ({ adapter: 'codex', kind: 'spawn', source: 0, callId: 'call-1',
  childId: 'child-1', taskName: '/root/worker', status: 'unresolved', reason: 'delegation_child_unchecked', ...extra });
const m33Exact = { adapter: 'codex', namespace: 'store-a', key: 1, sessionId: 'child-1',
  parentThreadId: 'root-1', taskPath: '/root/worker', identityConflict: false };
const m33Conflicting = { adapter: 'codex', namespace: 'store-a', key: 2, sessionId: null, childId: null,
  parentThreadId: null, taskPath: null, identityConflict: true };
const m33Record = (values = {}, extra = {}) => ({ malformed: false, hidden: [], overflow: [],
  values: { sessionId: ['fork-a', 'fork-b'], childId: [], parentThreadId: ['other-a', 'other-b'],
    taskPath: ['/root/other_a', '/root/other_b'], ...values }, ...extra });
const m33Candidates = record => ({ conflictCandidates: new Map([[2, record]]) });

test('M33 A1 an unrelated conflicting Codex source no longer blocks a sibling spawn', () => {
  const [both] = resolveChildLinks([m33Spawn()], [m33Exact, m33Conflicting], [m33Parent], m33Candidates(m33Record()));
  assert.equal(both.status, 'linked');
  assert.deepEqual(both.link, { source: 1 });
  const [opaque] = resolveChildLinks([m33Spawn({ taskName: undefined })], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record()));
  assert.deepEqual(opaque.link, { source: 1 });
  const [tuple] = resolveChildLinks([m33Spawn({ childId: undefined })], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record()));
  assert.deepEqual(tuple.link, { source: 1 });
});

test('M33 A2 a conflicting source whose candidate ID equals the child ID still blocks', () => {
  for (const d of [m33Spawn(), m33Spawn({ taskName: undefined })]) {
    const [out] = resolveChildLinks([d], [m33Exact, m33Conflicting], [m33Parent],
      m33Candidates(m33Record({ sessionId: ['child-1', 'fork-b'] })));
    assert.equal(out.reason, R.SOURCE_CONFLICT);
    assert.equal(out.link, undefined);
  }
});

test('M33 A3 a conflicting candidate parent/task tuple blocks; half a tuple does not', () => {
  const tupleOnly = m33Spawn({ childId: undefined });
  const run = values => resolveChildLinks([tupleOnly], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record(values)))[0];
  assert.equal(run({ parentThreadId: ['root-1', 'other-b'], taskPath: ['/root/worker', '/root/x'] }).reason,
    R.SOURCE_CONFLICT);
  assert.equal(run({ parentThreadId: ['root-1', 'other-b'] }).status, 'linked', 'parent alone');
  assert.equal(run({ taskPath: ['/root/worker'] }).status, 'linked', 'task alone');
  // The opaque-ID half of a spawn that also names a task is checked on its own.
  assert.equal(resolveChildLinks([m33Spawn()], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record({ parentThreadId: ['root-1'], taskPath: ['/root/worker'] })))[0].reason,
  R.SOURCE_CONFLICT);
});

test('M33 A4 overflow and hidden candidate fields match any value; a malformed record blocks all', () => {
  const opaque = m33Spawn({ taskName: undefined }), tuple = m33Spawn({ childId: undefined });
  for (const [record, d] of [
    [m33Record({}, { overflow: ['sessionId'] }), opaque], [m33Record({}, { hidden: ['sessionId'] }), opaque],
    [m33Record({}, { overflow: ['parentThreadId', 'taskPath'] }), tuple],
    [m33Record({}, { hidden: ['parentThreadId'], overflow: ['taskPath'] }), tuple],
    [m33Record({ parentThreadId: ['root-1'] }, { hidden: ['taskPath'] }), tuple],
    [m33Record({}, { malformed: true }), opaque], [m33Record({}, { malformed: true }), tuple],
  ]) {
    assert.equal(resolveChildLinks([d], [m33Exact, m33Conflicting], [m33Parent], m33Candidates(record))[0].reason,
      R.SOURCE_CONFLICT, JSON.stringify(record));
  }
  // Only the hidden half of a tuple is unknown; the recorded other half still has to match.
  assert.equal(resolveChildLinks([tuple], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record({}, { hidden: ['taskPath'] })))[0].status, 'linked');
  assert.equal(resolveChildLinks([opaque], [m33Exact, m33Conflicting], [m33Parent],
    m33Candidates(m33Record({}, { hidden: ['taskPath'], overflow: ['parentThreadId'] })))[0].status, 'linked');
});

test('M33 A5 a missing, unkeyed or invalid candidate record keeps the namespace-wide block', () => {
  const invalid = [undefined, null, {}, [], m33Record({ sessionId: ['a', 'b', 'c'] }), m33Record({ sessionId: [7] }),
    m33Record({ sessionId: ['a', 'a'] }), m33Record({ sessionId: [''] }), m33Record({ sessionId: ['x'.repeat(201)] }),
    m33Record({ sessionId: 'fork-a' }), m33Record({ sessionId: undefined }), m33Record({ extra: [] }),
    m33Record({}, { hidden: ['callId'] }), m33Record({}, { hidden: ['taskPath', 'taskPath'] }),
    m33Record({}, { overflow: 'sessionId' }), m33Record({}, { overflow: undefined }),
    m33Record({}, { malformed: undefined }), m33Record({}, { malformed: 0 }), m33Record({}, { note: 'x' })];
  for (const record of invalid) {
    const conflictCandidates = new Map(record === undefined ? [] : [[2, record]]);
    for (const d of [m33Spawn(), m33Spawn({ taskName: undefined }), m33Spawn({ childId: undefined })])
      assert.equal(resolveChildLinks([d], [m33Exact, m33Conflicting], [m33Parent], { conflictCandidates })[0].reason,
        R.SOURCE_CONFLICT, JSON.stringify(record));
  }
  assert.equal(resolveChildLinks([m33Spawn()], [m33Exact, m33Conflicting], [m33Parent])[0].reason,
    R.SOURCE_CONFLICT, 'a caller that supplies no candidates is unchanged');
  for (const key of [-1, '2', undefined, 1.5]) {
    assert.equal(resolveChildLinks([m33Spawn()], [m33Exact, { ...m33Conflicting, key }], [m33Parent],
      { conflictCandidates: new Map([[key, m33Record()]]) })[0].reason, R.SOURCE_CONFLICT, String(key));
  }
  for (const conflictCandidates of [{ 2: m33Record() }, [[2, m33Record()]], null, 'map'])
    assert.equal(resolveChildLinks([m33Spawn()], [m33Exact, m33Conflicting], [m33Parent], { conflictCandidates })[0]
      .reason, R.SOURCE_CONFLICT, 'only a Map of candidate records is accepted');
  const trap = Object.defineProperty(m33Record(), 'values', { get() { throw new Error('must not run'); } });
  assert.equal(resolveChildLinks([m33Spawn()], [m33Exact, m33Conflicting], [m33Parent], m33Candidates(trap))[0].reason,
    R.SOURCE_CONFLICT);
});

test('M33 A6 a conflicting source is never itself a link target', () => {
  const forged = { ...m33Conflicting, sessionId: 'child-1', parentThreadId: 'root-1', taskPath: '/root/worker' };
  const [both] = resolveChildLinks([m33Spawn()], [forged], [m33Parent], m33Candidates(m33Record()));
  assert.notEqual(both.status, 'linked');
  assert.equal(both.reason, R.IDENTITY_CONFLICT);
  const [opaque] = resolveChildLinks([m33Spawn({ taskName: undefined })], [forged], [m33Parent], m33Candidates(m33Record()));
  assert.equal(opaque.reason, R.UNAVAILABLE);
  assert.equal(opaque.link, undefined);
});

test('M33 A7 Claude: an unrelated conflicting source frees a sibling; a possible one blocks even if not nested', () => {
  const p = parent();
  const d = delegation();
  const bad = child({ key: 2, childId: null, nested: false, identityConflict: true });
  const records = (childIds, sessions = ['parent']) => ({ conflictCandidates: new Map([[2, { malformed: false,
    hidden: [], overflow: [], values: { sessionId: sessions, childId: childIds, parentThreadId: [], taskPath: [] } }]]) });
  assert.equal(resolveChildLinks([d], [child(), bad], [p], records(['agent-2', 'agent-3']))[0].status, 'linked');
  assert.equal(resolveChildLinks([d], [child(), bad], [p], records(['child-1', 'agent-3']))[0].reason, R.SOURCE_CONFLICT);
  assert.equal(resolveChildLinks([d], [child(), bad], [p], records(['child-1', 'agent-3'], ['other-parent']))[0].status,
    'linked', 'the launching parent session must also be possible');
  assert.equal(resolveChildLinks([d], [child(), bad], [p], records(['agent-2'], ['parent', 'other']))[0].status, 'linked');
  const hidden = { conflictCandidates: new Map([[2, { malformed: false, hidden: ['childId'], overflow: [],
    values: { sessionId: ['parent'], childId: [], parentThreadId: [], taskPath: [] } }]]) };
  assert.equal(resolveChildLinks([d], [child(), bad], [p], hidden)[0].reason, R.SOURCE_CONFLICT);
  assert.equal(resolveChildLinks([d], [child(), bad], [p])[0].reason, R.SOURCE_CONFLICT);
});

test('M33 A8 candidates are bounded, include omitted inherited rows and never enter value()', () => {
  const id = recordingIdentity('codex');
  const keys = Object.keys(id.value()).sort();
  for (const v of ['s-2', 's-1', 's-3', 's-1']) id.observe({ type: 'session_meta', payload: { id: v } });
  assert.deepEqual(id.candidates(), { malformed: false,
    values: { sessionId: ['s-1', 's-2'], childId: [], parentThreadId: [], taskPath: [] }, overflow: ['sessionId'] });
  assert.deepEqual(Object.keys(id.value()).sort(), keys, 'exported source shape unchanged');
  assert.equal(Object.hasOwn(id.value(), 'candidates'), false);
  const bad = recordingIdentity('codex');
  bad.observe({ type: 'session_meta', payload: { id: 'x'.repeat(201) } });
  assert.equal(bad.candidates().malformed, true);
  const repeated = recordingIdentity('codex');
  repeated.observe({ type: 'session_meta', payload: { id: 'one' } }, { repeatedKeys: true });
  assert.equal(repeated.candidates().malformed, true);
  // The existing marker-free inherited row is omitted from identity, not from the candidates.
  const inherited = recordingIdentity('codex');
  inherited.observe({ type: 'session_meta', ordinal: 0, payload: { id: 'child', subagent_history_start_ordinal: 3,
    source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/worker' } } } } });
  inherited.observe({ type: 'session_meta', ordinal: 1, payload: { id: 'root' } });
  assert.equal(inherited.value().identityConflict, false);
  assert.deepEqual(inherited.candidates().values, { sessionId: ['child', 'root'], childId: [],
    parentThreadId: ['root'], taskPath: ['/root/worker'] });
  const claude = recordingIdentity('claude');
  for (const agentId of ['a-1', 'a-2', 'a-3']) claude.observe({ type: 'user', sessionId: 'p', agentId, isSidechain: true });
  assert.deepEqual(claude.candidates(), { malformed: false,
    values: { sessionId: ['p'], childId: ['a-1', 'a-2'], parentThreadId: [], taskPath: [] }, overflow: ['childId'] });
});

// ---------- M33 nested-fork ancestor metadata (C-03) ----------
const leafRow = (extra = {}, ordinal = 0) => ({ type: 'session_meta', ordinal, payload: { id: 'leaf', cwd: '/repo',
  forked_from_id: 'middle', subagent_history_start_ordinal: 4, multi_agent_version: 'v2',
  parent_thread_id: 'middle', agent_path: '/root/middle/leaf',
  source: { subagent: { thread_spawn: { parent_thread_id: 'middle', agent_path: '/root/middle/leaf' } } }, ...extra } });
const middleRow = (extra = {}, ordinal = 1) => ({ type: 'session_meta', ordinal, payload: { id: 'middle', cwd: '/repo',
  forked_from_id: 'root', subagent_history_start_ordinal: 1, multi_agent_version: 'v2',
  parent_thread_id: 'root', agent_path: '/root/middle',
  history_base: { thread_id: 'root', end_ordinal_exclusive: 1, end_byte_offset: 90 },
  source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/middle' } } }, ...extra } });
const identityOf = rows => { const id = recordingIdentity('codex'); rows.forEach(r => id.observe(r)); return id.value(); };

test('M33 B1 a nested fork keeps its own identity across its parent subagent\'s replayed opening row', () => {
  const own = { adapter: 'codex', sessionId: 'leaf', childId: null, parentThreadId: 'middle',
    taskPath: '/root/middle/leaf', multiAgentVersion: 'v2', nested: true, mixedHistory: false,
    forked: true, historyStart: 4, identityConflict: false };
  assert.deepEqual(identityOf([leafRow(), middleRow()]), own);
  assert.deepEqual(identityOf([leafRow(), middleRow({ multi_agent_version: 'older-producer' })]), own,
    'the ancestor version describes the ancestor');
  assert.deepEqual(identityOf([leafRow(), middleRow({ history_base: undefined, subagent_history_start_ordinal: 3 })]),
    own, 'the ancestor boundary is in the ancestor ordinal space');
  assert.deepEqual(identityOf([leafRow(), middleRow({ source: undefined, parent_thread_id: undefined,
    agent_path: undefined })]), own, 'no marker is required, only the exact recorded IDs');
  assert.deepEqual(identityOf([leafRow({ parent_thread_id: undefined }), middleRow()]), own,
    'one recorded parent thread may come from thread_spawn alone');
  assert.deepEqual(identityOf([leafRow({ source: { subagent: { thread_spawn: { agent_path: '/root/middle/leaf' } } } }),
    middleRow()]), own, 'or from the top-level field alone');
  assert.deepEqual(identityOf([leafRow(), middleRow(), { ...leafRow(), ordinal: 5 }]), own,
    'a later copy of the own row agrees');
  // The existing marker-free root row and the nested ancestor row can both precede the boundary.
  assert.deepEqual(identityOf([leafRow(), middleRow(), { type: 'session_meta', ordinal: 2,
    payload: { id: 'root', cwd: '/repo' } }]), own);
});

test('M33 B2 near misses of the nested-fork ancestor row stay conflicting', () => {
  const cases = {
    idIsParentNotForkSource: [leafRow({ forked_from_id: 'someone-else' }), middleRow()],
    idIsForkSourceNotParent: [leafRow({ parent_thread_id: 'other-parent', source: { subagent: { thread_spawn: {
      parent_thread_id: 'other-parent', agent_path: '/root/middle/leaf' } } } }), middleRow()],
    ownParentsDisagree: [leafRow({ parent_thread_id: 'other-parent' }), middleRow()],
    noForkSource: [leafRow({ forked_from_id: undefined, history_base: { thread_id: 'middle', end_ordinal_exclusive: 4,
      end_byte_offset: 9 } }), middleRow()],
    ownForkSourceInvalid: [leafRow({ forked_from_id: 'x'.repeat(201) }), middleRow({ id: 'x'.repeat(201) })],
    ordinalAtBoundary: [leafRow(), middleRow({}, 4)],
    ordinalAfterBoundary: [leafRow(), middleRow({}, 9)],
    ordinalMissing: [leafRow(), { ...middleRow(), ordinal: undefined }],
    ordinalString: [leafRow(), middleRow({}, '1')],
    ordinalNegative: [leafRow(), middleRow({}, -1)],
    ordinalFractional: [leafRow(), middleRow({}, 1.5)],
    ancestorRowFirst: [middleRow({}, 0), leafRow({}, 1)],
    twoOwnIdsBefore: [leafRow(), leafRow({ id: 'leaf-2' }), middleRow()],
    twoOwnIdsAfter: [leafRow(), middleRow(), leafRow({ id: 'leaf-2' }, 5)],
    foreignThread: [leafRow(), middleRow({ id: 'stranger' })],
    ownIdReplayed: [leafRow(), middleRow({ id: 'leaf' })],
    secondAncestorCopy: [leafRow(), middleRow(), middleRow({}, 2)],
    ownRowNotNested: [leafRow({ source: undefined }), middleRow()],
    ownRowNoBoundary: [leafRow({ subagent_history_start_ordinal: undefined }), middleRow()],
    ownRowNoParent: [leafRow({ parent_thread_id: undefined, source: { subagent: { thread_spawn: {} } } }), middleRow()],
    laterForkSourceChange: [leafRow(), middleRow(), leafRow({ forked_from_id: 'another' }, 5)],
    laterInvalidForkSource: [leafRow(), middleRow(), leafRow({ forked_from_id: 7 }, 5)],
    laterParentChange: [leafRow(), middleRow(), leafRow({ parent_thread_id: 'another' }, 5)],
    laterBoundaryChange: [leafRow(), middleRow(), leafRow({ subagent_history_start_ordinal: 6 }, 5)],
    damagedAncestorPath: [leafRow(), middleRow({ agent_path: 'x'.repeat(201) })],
    damagedAncestorSpawnParent: [leafRow(), middleRow({ source: { subagent: { thread_spawn: { parent_thread_id: '' } } } })],
    damagedAncestorBoundary: [leafRow(), middleRow({ subagent_history_start_ordinal: -1 })],
    damagedAncestorForkSource: [leafRow(), middleRow({ forked_from_id: 7 })],
    damagedAncestorVersion: [leafRow(), middleRow({ multi_agent_version: '' })],
    damagedAncestorHistoryBase: [leafRow(), middleRow({ history_base: { thread_id: 'root', end_ordinal_exclusive: -1,
      end_byte_offset: 90 } })],
    ancestorHistoryBaseNotAPosition: [leafRow(), middleRow({ history_base: ['root'] })],
  };
  for (const [name, rows] of Object.entries(cases)) assert.equal(identityOf(rows).identityConflict, true, name);
  const repeated = recordingIdentity('codex');
  repeated.observe(leafRow()); repeated.observe(middleRow(), { repeatedKeys: true });
  assert.equal(repeated.value().identityConflict, true, 'repeated keys');
  const firstRepeated = recordingIdentity('codex');
  firstRepeated.observe(leafRow(), { repeatedKeys: true }); firstRepeated.observe(middleRow());
  assert.equal(firstRepeated.value().identityConflict, true, 'a repeated-key opening row proves nothing');
  // The omitted row still bounds what the conflict could be; it never becomes a join identity.
  const id = recordingIdentity('codex');
  [leafRow(), middleRow()].forEach(row => id.observe(row));
  assert.deepEqual(id.candidates().values, { sessionId: ['leaf', 'middle'], childId: [],
    parentThreadId: ['middle', 'root'], taskPath: ['/root/middle', '/root/middle/leaf'] });
});

// Names of the cases whose rows the identity still accepts. Collecting them all, instead of
// stopping at the first, shows exactly which near miss a weakened rule lets through.
const accepted = cases => Object.entries(cases).filter(([, rows]) => !identityOf(rows).identityConflict)
  .map(([name]) => name);

test('M33 B3 self-forked, top-level-parent and spawn-path near misses of the ancestor row stay conflicting', () => {
  // (a) An opening row that names itself as parent thread and fork source. A later row below S
  // carries exactly those IDs, but it is the own ID, so it is never the omitted ancestor row: it
  // counts, and its different boundary conflicts.
  const selfForked = leafRow({ parent_thread_id: 'leaf', forked_from_id: 'leaf',
    source: { subagent: { thread_spawn: { parent_thread_id: 'leaf', agent_path: '/root/middle/leaf' } } } });
  assert.equal(identityOf([selfForked]).identityConflict, false, 'the self-forked opening row alone agrees');
  assert.deepEqual(accepted({
    selfForkedOwnIdBelowBoundary: [selfForked, { ...selfForked, ordinal: 1,
      payload: { ...selfForked.payload, subagent_history_start_ordinal: 1 } }],
    // (b) The omitted row's parent is never recorded, but a damaged one is never hidden.
    damagedAncestorTopLevelParent: [leafRow(), middleRow({ parent_thread_id: '' })],
    // (c) Likewise its thread_spawn task path: 201 characters is over the identity limit.
    damagedAncestorSpawnPath: [leafRow(), middleRow({ source: { subagent: { thread_spawn: {
      parent_thread_id: 'root', agent_path: 'x'.repeat(201) } } } })],
  }), []);
  assert.equal(identityOf([leafRow(), middleRow({ source: { subagent: { thread_spawn: {
    parent_thread_id: 'root', agent_path: 'x'.repeat(200) } } } })]).identityConflict, false,
  'a 200-character ancestor spawn path is still well-formed');
});

test('M33 B4 at most one ancestor row is omitted per recording', () => {
  assert.equal(identityOf([leafRow(), middleRow()]).identityConflict, false, 'one qualifying copy is omitted');
  assert.deepEqual(accepted({
    secondCopyLaterOrdinal: [leafRow(), middleRow({}, 1), middleRow({}, 3)],
    secondCopyOtherAncestorBoundary: [leafRow(), middleRow({}, 1), middleRow({ subagent_history_start_ordinal: 2 }, 2)],
    secondCopyAfterMarkerFreeRoot: [leafRow(), middleRow({}, 1), { type: 'session_meta', ordinal: 2,
      payload: { id: 'root', cwd: '/repo' } }, middleRow({}, 3)],
  }), []);
});

test('M33 B5 the omitted ancestor row\'s history_base must be a well-formed position', () => {
  const position = { thread_id: 'root', end_ordinal_exclusive: 1, end_byte_offset: 90 };
  const without = key => Object.fromEntries(Object.entries(position).filter(([name]) => name !== key));
  assert.deepEqual(accepted(Object.fromEntries(Object.entries({
    array: ['root'],
    // Shaped like a position in every field; only being an array disqualifies it.
    positionShapedArray: Object.assign([], position),
    missingEndByteOffset: without('end_byte_offset'),
    missingEndOrdinalExclusive: without('end_ordinal_exclusive'),
    missingThreadId: without('thread_id'),
    negativeEndOrdinalExclusive: { ...position, end_ordinal_exclusive: -1 },
    negativeEndByteOffset: { ...position, end_byte_offset: -1 },
    fractionalEndOrdinalExclusive: { ...position, end_ordinal_exclusive: 1.5 },
    unsafeEndByteOffset: { ...position, end_byte_offset: 2 ** 53 },
    stringEndByteOffset: { ...position, end_byte_offset: '90' },
    emptyThreadId: { ...position, thread_id: '' },
    overlongThreadId: { ...position, thread_id: 'x'.repeat(201) },
    string: 'root',
    number: 1,
    boolean: false,
  }).map(([name, historyBase]) => [name, [leafRow(), middleRow({ history_base: historyBase })]]))), []);
  const own = identityOf([leafRow()]);
  const absent = middleRow();
  delete absent.payload.history_base;
  for (const [name, ancestor] of Object.entries({
    absent,
    null: middleRow({ history_base: null }),
    complete: middleRow({ history_base: position }),
    zeroPosition: middleRow({ history_base: { thread_id: 'root', end_ordinal_exclusive: 0, end_byte_offset: 0 } }),
    largestSafePosition: middleRow({ history_base: { thread_id: 'root', end_ordinal_exclusive: Number.MAX_SAFE_INTEGER,
      end_byte_offset: Number.MAX_SAFE_INTEGER } }),
    // Well-formed is all that is checked: the position is never compared by resemblance.
    unrelatedThread: middleRow({ history_base: { ...position, thread_id: 'x'.repeat(200) } }),
  })) assert.deepEqual(identityOf([leafRow(), ancestor]), own, name);
});
