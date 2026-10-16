// M33 D (C-03, Claude Code child identity drift):
//   - Claude Code's agentId is `a` + 16 lowercase hex (17 characters) in every known version;
//     the receipt line accepts it beside the older 16-hex form. It is the only carrier inside a
//     child recording, which writes no result sidecar, so a grandchild spawn depends on it.
//   - A resumed parent recording holds two sessionId blocks and has no single file identity. Each
//     Claude hand-off therefore carries the sessionId recorded on its own tool_use row AND on its
//     result row (both, equal), and the link compares the child's recorded sessionId with that.
//     A scrubbed or disagreeing value proves nothing, and a parent whose file identity is valid must
//     agree with it.
// Every value here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDelegation } from '../src/delegation.js';
import { collectDelegations } from '../src/delegation-records.js';
import { resolveChildLinks, delegationIdentityUnverified, CHILD_LINK_REASONS as R } from '../src/child-links.js';
import { recordingIdentity } from '../src/recording-identity.js';
import { redact } from '../../redact/index.js';

const A17 = 'a0123456789abcdef';
const H16 = '0123456789abcdef';
const use = (name = 'Agent') => ({ type: 'tool_use', id: 'call-1', name, input: { prompt: 'Brief.' } });
const prose = (value, callId = 'call-1') => ({ callId, value });
const context = { adapter: 'claude', turn: 1 };

test('M33 D F7: the 17-hex Claude agentId line is a child identity, and the 16-hex form still is', () => {
  for (const id of [A17, H16]) {
    assert.equal(detectDelegation(use(), prose(`Async agent launched.\nagentId: ${id}\nUse SendMessage.`), context).childId, id);
  }
  assert.equal(detectDelegation(use('Task'), prose(`agentId: ${A17} (internal)`), context).childId, A17);
  assert.equal(detectDelegation(use(), { callId: 'call-1', value: { agentId: A17 } }, context).childId, A17);
  for (const text of [
    `agentId: ${A17}0`,                  // 18
    'agentId: b0123456789abcdef',        // 17, not the known `a` prefix
    'agentId: 0123456789abcdefa',        // 17 hex without the prefix
    `agentId: A0123456789ABCDEF`,        // upper case
    `the report quotes agentId: ${A17} inline`,
  ]) assert.equal(detectDelegation(use(), prose(text), context).reason, 'delegation_result_malformed', text);
  assert.equal(detectDelegation(use(), prose(`agentId: ${A17}\nagentId: ${H16}`), context).reason,
    'delegation_child_ambiguous');
});

const row = (sessionId, extra) => ({ sessionId, ...extra });
const spawnRows = (useSession, resultSession, agentId = A17) => [
  { kind: 'user', raw: row(useSession, { type: 'user', message: { content: 'Delegate the migration.' } }) },
  { kind: 'assistant', raw: row(useSession, { type: 'assistant', message: { content: [
    { type: 'tool_use', id: 'call-1', name: 'Agent', input: { prompt: 'Migrate.' } }] } }) },
  { kind: 'user', raw: row(resultSession, { type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: 'call-1', content: `Async agent launched.\nagentId: ${agentId}` }] } }) },
];

test('M33 D F6: a Claude hand-off records the sessionId of its own tool_use and result rows, only when they agree', () => {
  assert.equal(collectDelegations(spawnRows('current', 'current'))[0].sessionId, 'current');
  assert.equal(collectDelegations(spawnRows('current', 'prior'))[0].sessionId, undefined);
  assert.equal(collectDelegations(spawnRows(undefined, 'current'))[0].sessionId, undefined);
  assert.equal(collectDelegations(spawnRows('has a space', 'has a space'))[0].sessionId, undefined);
  // Codex identities are unchanged.
  assert.equal(detectDelegation({ type: 'tool_use', id: 'c', name: 'spawn_agent', input: {} },
    { callId: 'c', value: JSON.stringify({ agent_id: 'thread-1' }) }, { adapter: 'codex', turn: 0, sessionId: 'x' }).sessionId,
  undefined);
});

const delegation = (extra = {}) => ({ adapter: 'claude', source: 0, callId: 'call-1', childId: A17,
  status: 'unresolved', reason: 'delegation_child_unchecked', ...extra });
const child = (extra = {}) => ({ adapter: 'claude', namespace: 'project', sessionId: 'current', childId: A17,
  nested: true, key: 4, ...extra });
const resumed = { adapter: 'claude', namespace: 'project', sessionId: null, childId: null, nested: false,
  identityConflict: true, sessionIdConflictOnly: true };

test('M33 D F6: a resumed parent links a hand-off by the sessionId its own rows recorded', () => {
  const linked = resolveChildLinks([delegation({ sessionId: 'current' })], [child()], [resumed]);
  assert.deepEqual([linked[0].status, linked[0].link], ['linked', { source: 4 }]);
  // A child of another session (a fork's) is not this hand-off's, whatever its agentId.
  assert.equal(resolveChildLinks([delegation({ sessionId: 'current' })], [child({ sessionId: 'forked' })], [resumed])[0].reason,
    R.UNAVAILABLE);
  // Without a recorded hand-off session, a parent with no single identity proves nothing.
  assert.equal(resolveChildLinks([delegation()], [child()], [resumed])[0].reason, R.PARENT_INVALID);
  // A hand-off session disagreeing with a valid parent file identity is a conflict, never a choice.
  assert.equal(resolveChildLinks([delegation({ sessionId: 'current' })], [child()],
    [{ ...resumed, sessionId: 'other', identityConflict: false, sessionIdConflictOnly: undefined }])[0].reason,
  R.IDENTITY_CONFLICT);
  // An ordinary parent keeps its file identity, with or without the recorded value.
  const plain = { adapter: 'claude', namespace: 'project', sessionId: 'current' };
  assert.equal(resolveChildLinks([delegation({ sessionId: 'current' })], [child()], [plain])[0].status, 'linked');
  assert.equal(resolveChildLinks([delegation()], [child()], [plain])[0].status, 'linked');
});

test('M33 D F6: a scrubbed hand-off session blocks the resumed proof and never becomes a join key', () => {
  const scrubbed = delegation({ sessionId: null, identityUncheckedFields: ['sessionId'] });
  assert.equal(delegationIdentityUnverified(scrubbed), false, 'the child identity itself survived');
  assert.equal(resolveChildLinks([scrubbed], [child()], [resumed])[0].reason, R.PARENT_INVALID);
  // D90 (owner decision 2026-10-15): redaction scrubs no identity now; one a ledger declared unchecked stays unchecked.
  const cleaned = redact({ ask: [], ledger: [], claim: {}, delegations: [scrubbed], dropped: [] }).ledger.delegations[0];
  assert.equal(cleaned.sessionId, null);
  assert.deepEqual(cleaned.identityUncheckedFields, ['sessionId']);
  const keyShaped = `ghp_${'A'.repeat(36)}`;
  assert.equal(redact({ ask: [], ledger: [], claim: {}, delegations: [delegation({ sessionId: keyShaped })], dropped: [] })
    .ledger.delegations[0].sessionId, keyShaped, 'a recorded session id is carried as recorded');
});

test('M33 D F6: recording identity names a conflict that is only two recorded sessionIds', () => {
  const read = (rows) => { const identity = recordingIdentity('claude'); for (const r of rows) identity.observe(r); return identity.value(); };
  const two = read([{ type: 'user', sessionId: 'prior' }, { type: 'custom-title', sessionId: 'current' },
    { type: 'user', sessionId: 'current' }]);
  assert.deepEqual([two.identityConflict, two.sessionId, two.sessionIdConflictOnly], [true, null, true]);
  const withChild = read([{ type: 'user', sessionId: 'prior' }, { type: 'user', sessionId: 'current', agentId: A17 }]);
  assert.equal(withChild.sessionIdConflictOnly, undefined);
  const malformed = read([{ type: 'user', sessionId: 'prior' }, { type: 'user', sessionId: 'current' }, { type: 'user', sessionId: 7 }]);
  assert.equal(malformed.sessionIdConflictOnly, undefined);
  assert.equal(read([{ type: 'user', sessionId: 'one' }]).sessionIdConflictOnly, undefined);
});
