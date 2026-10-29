// D175 (beta.9 known issue 3), end to end through the loader a session-only review uses. A launched Claude helper the
// parent RESUMED (a SendMessage whose one result's typed sidecar names the agentId it resumed) had all its work after
// its own later request placed after the session's last request, unreceived and declared (`helper_continued_unproven`),
// although the recorder types where the parent received it: a later task notification naming that SendMessage's call id
// and that agentId. Each later request whose message the resume carried verbatim is now a segment of its own, placed at
// that notification (the M33 P receipt rule), its work in the resuming SendMessage's part (C-06 `deliveredBy`). A record
// that is not exactly valid makes the helper fall back to the placement before M33 P; an older recording that types no
// resume keeps today's placement. Synthetic rows only: no recording of anyone's, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES }
  from '../../evidence/adapters/sonah-ledger.js';
import { adapt, labelOf } from '../../evidence/test/stable-ids-fixture.js';
import { HELPER_DELIVERY_REASONS } from '../../slicer/src/helper-deliveries.js';
import { AGENT, AGENT_CALL, CLAUDE_RUNS, CLAUDE_TEXT, CONTINUE_TEXT, SEND_MESSAGE_CALL, SID, agentCallRow,
  agentNotification, agentStubRow, claudeRow, claudeTree, jsonl, rm } from './m33-p-placement-fixture.js';

const HUMAN_PROMPT = Object.freeze({ origin: Object.freeze({ kind: 'human' }), promptSource: 'sdk' });
const SECOND = 'toolu_01SyntheticSendD1752';
const SECOND_TEXT = 'SYNTHETIC_D175_CONTINUE_2: now update the changelog.';
const ids = (session) => session.events.map((event) => labelOf(session, event.id));
const at = (session, id) => {
  const index = session.events.findIndex((event) => event.id === id || labelOf(session, event.id) === id);
  assert.ok(index >= 0, id);
  return index;
};
const commentaryId = (session, words) => session.events.find((event) => event.kind === 'commentary'
  && session.textOf(event, 'text').includes(words))?.id;
const resultId = (session, words) => session.events.find((event) => event.kind === 'observation' && event.childId
  && session.textSpansOf(event, 'output').join('').includes(words))?.id;
const receipts = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY)
  .map((event) => [labelOf(session, event.delivery), event.unproven === true]);
const gapsOf = (session, note) => session.adapterGaps.filter((gap) => gap.note === note)
  .map((gap) => [gap.count, gap.eventIds?.map((id) => labelOf(session, id))]);
const FOLLOWUP_NOTE = 'a child follow-up was sent without attributable subsequent child history';
/** The placement before M33 P: no helper record, and no Claude action recording a row. */
const legacyOf = ({ helperSegments, helperDeliveryLosses, ...ledger }) => ({ ...ledger,
  ledger: ledger.ledger.map(({ sourceLocator, ...act }) => act) });

const uuid = (seed) => { const h = createHash('sha256').update(`d175:${seed}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const agentRow = (type, content, seed, extra = {}) => ({ parentUuid: null, isSidechain: true, agentId: AGENT, type,
  message: { role: type, content }, uuid: uuid(seed), timestamp: '2026-10-01T09:00:00.000Z', userType: 'external',
  entrypoint: 'cli', cwd: '/repo', sessionId: SID, version: '2.1.311', gitBranch: 'main', ...extra });
const bash = (id, command) => ({ type: 'tool_use', id, name: 'Bash', input: { command } });
/** The resume as Claude Code records it in the helper: a coordinator's user row of its own, the message inside it. */
const resumeRow = (text, seed) => agentRow('user', `<coordinator-message>\n${text}\n</coordinator-message>`, seed,
  { isMeta: true, origin: { kind: 'coordinator' } });
/**
 * The helper (`agent`): its brief and a passing lint run (turn 1); resumed: a FAILING suite (turn 2); resumed again (turn
 * 3). `woken`: after its reply in turn `woken`, a task of its own wakes it (a task-notification `user` row of its own)
 * and it says more; `queued`: the notification is instead queued into its work (a `queued_command` attachment).
 */
function helperRows({ resumedWith = CONTINUE_TEXT, second = false, woken = 0, queued = false, agent = AGENT,
  prefix = '' } = {}) {
  const own = (type, content, seed, extra = {}) => agentRow(type, content, `${prefix}${seed}`, { agentId: agent, ...extra });
  const text = (n, call) => `<task-notification>\n<task-id>bsynthetic000${n}</task-id>\n<tool-use-id>${call}</tool-use-id>\n`
    + '<status>completed</status>\n</task-notification>';
  const wake = (n, call) => (woken !== n ? [] : [queued
    ? own('attachment', undefined, `wake${n}`, { attachment: { type: 'queued_command', commandMode: 'task-notification',
      prompt: text(n, call) }, message: undefined })
    : own('user', text(n, call), `wake${n}`, { origin: { kind: 'task-notification' } }),
  own('assistant', [{ type: 'text', text: 'Rechecked after my own run.' }], `woke${n}`)]);
  return [own('user', CLAUDE_TEXT.brief, 'brief'),
    own('assistant', [bash('toolu_d175_lint', 'npm run lint')], 'lint'),
    own('user', [{ type: 'tool_result', tool_use_id: 'toolu_d175_lint', content: 'lint ok' }], 'lint:r'),
    own('assistant', [{ type: 'text', text: 'Lint is clean.' }], 'said1'), ...wake(1, 'toolu_d175_lint'),
    own('user', `<coordinator-message>\n${resumedWith}\n</coordinator-message>`, 'resume1',
      { isMeta: true, origin: { kind: 'coordinator' } }),
    own('assistant', [bash('toolu_d175_test', 'npm test')], 'test'),
    own('user', [{ type: 'tool_result', tool_use_id: 'toolu_d175_test', is_error: true, content: CLAUDE_RUNS.agentFail }],
      'test:r'),
    own('assistant', [{ type: 'text', text: 'The suite fails.' }], 'said2'), ...wake(2, 'toolu_d175_test'),
    ...(second ? [resumeRow(SECOND_TEXT, 'resume2'),
      agentRow('assistant', [bash('toolu_d175_log', 'git log -1')], 'log'),
      agentRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_d175_log', content: 'changelog updated' }], 'log:r'),
      agentRow('assistant', [{ type: 'text', text: 'Changelog updated.' }], 'said3')] : [])];
}
const sidecarOf = (agent = AGENT) => ({ success: true, message: 'Message sent.', resumedAgentId: agent, revivedAgentId: agent });
const send = (id, message, sidecar, seed, to = AGENT) => [
  claudeRow('assistant', [{ type: 'tool_use', id, name: 'SendMessage', input: { to, message, summary: 'continue' } }],
    {}, `d175:${seed}`),
  claudeRow('user', [{ type: 'tool_result', tool_use_id: id, content: 'Message sent.' }],
    sidecar ? { toolUseResult: sidecar } : {}, `d175:${seed}:r`)];
const notice = (id, seed, task = AGENT) => claudeRow('user', `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${id}`
  + '</tool-use-id>\n<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>',
{ origin: { kind: 'task-notification' } }, `d175:${seed}:n`);
const claim = () => claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'd175:claim');
/**
 * The parent. Rows: 1 ask, 2 the Agent call (background), 3 its launch stub, 4 its notification (the first receipt), 5 the
 * SendMessage, 6 its result (`sidecar`), then the resume's notification and the claim (`order`: 'receipt-first' or
 * 'claim-first'), then (`second`) a second resume, its result and its notification, then the closing statement.
 */
function parentRows({ sidecar = sidecarOf(), order = 'receipt-first', second = false, secondSidecar = sidecarOf(),
  task = AGENT } = {}) {
  const middle = order === 'receipt-first' ? [notice(SEND_MESSAGE_CALL, 'one', task), claim()]
    : [claim(), notice(SEND_MESSAGE_CALL, 'one', task)];
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'd175:ask'), agentCallRow({ flag: true }), agentStubRow(),
    agentNotification(AGENT_CALL), ...send(SEND_MESSAGE_CALL, CONTINUE_TEXT, sidecar, 'one'), ...middle,
    ...(second ? [...send(SECOND, SECOND_TEXT, secondSidecar, 'two'), notice(SECOND, 'two')] : []),
    claudeRow('assistant', [{ type: 'text', text: 'Done.' }], {}, 'd175:done'),
    // An action of another tool, after everything (its row is no receipt of anything).
    claudeRow('assistant', [bash('toolu_d175_status', 'git status')], {}, 'd175:status'),
    claudeRow('user', [{ type: 'tool_result', tool_use_id: 'toolu_d175_status', content: 'clean' }], {}, 'd175:status:r')];
}
async function ledgerOf(t, rows, agentRows) {
  const tree = await claudeTree(rows, agentRows);
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  return redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
}
const row = (record, beforeEvent) => ({ turn: 1, beforeEvent, source: 0, record });

test('D175: a resumed helper\'s later work is placed at the notification that received it, in the resuming part', async (t) => {
  for (const order of ['receipt-first', 'claim-first']) {
    const ledger = await ledgerOf(t, parentRows({ order }), helperRows());
    assert.equal(ledger.delegations[0].status, 'linked', order);
    // The first segment at its launch's notification (row 4); the resumed request (the helper's turn 2) at the
    // resume's notification (row 7 or 8), delivered by the SendMessage (turn 1, seq 0).
    const receiptRow = order === 'receipt-first' ? 7 : 8;
    assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 }, receipt: row(4, 0) },
      { delivery: { action: { turn: 1, seq: 0 } }, request: 2, receipt: row(receiptRow, 1) }] }], order);
    assert.equal(ledger.helperDeliveryLosses, undefined, `${order}: no continued loss`);
    // Fix round: the ledger keeps the slicer's follow-up flag; the adapter, which checks the record, does not declare it.
    const sent = ledger.ledger.find((act) => act.tool === 'SendMessage');
    assert.equal(sent.childFollowupUnresolved, true, order);
    const session = adapt(ledger, { sessionKey: `d175-${order}` });
    const claimAt = at(session, commentaryId(session, CLAUDE_RUNS.claimQuote));
    const failure = resultId(session, CLAUDE_RUNS.agentFailQuote);
    const lint = resultId(session, 'lint ok');
    assert.ok(at(session, lint) < at(session, failure), order);
    if (order === 'receipt-first') assert.ok(at(session, failure) < claimAt, 'received before the claim: before it');
    else assert.ok(claimAt < at(session, failure), 'received after the claim: after it');
    // Not after the session's last request's own work any more: before the closing statement.
    assert.ok(at(session, failure) < at(session, commentaryId(session, 'Done.')), order);
    assert.deepEqual(receipts(session).filter(([, unproven]) => unproven), [], `${order}: no unproven boundary`);
    assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_continued_unproven), [], order);
    assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [], order);
    assert.deepEqual(gapsOf(session, FOLLOWUP_NOTE), [], order);
    // C-06: the resumed work is the resuming SendMessage's; the work before it stays its hand-off's.
    assert.equal(labelOf(session, session.event(failure).deliveredBy), 'A1-0', order);
    assert.equal(session.event(lint).deliveredBy, undefined, order);
  }
});

test('D175: two resumes, each received at its own notification; a later request no resume proves stays declared', async (t) => {
  const ledger = await ledgerOf(t, parentRows({ second: true }), helperRows({ second: true }));
  assert.deepEqual(ledger.helperSegments[0].segments.slice(1).map((s) => [s.delivery.action?.seq, s.request, s.receipt?.record]),
    [[0, 2, 7], [1, 3, 11]]);
  assert.equal(ledger.helperDeliveryLosses, undefined);
  // The second SendMessage's result typed no resume (an older recorder): the first is proven, the rest as before.
  const prefix = await ledgerOf(t, parentRows({ second: true, secondSidecar: null }), helperRows({ second: true }));
  assert.deepEqual(prefix.helperSegments[0].segments.slice(1), [
    { delivery: { action: { turn: 1, seq: 0 } }, request: 2, receipt: row(7, 1) }, { delivery: { request: 3 } }]);
  assert.deepEqual(prefix.helperDeliveryLosses, [{ delivery: { delegation: 0 }, reason: HELPER_DELIVERY_REASONS.continued }]);
  const session = adapt(prefix, { sessionKey: 'd175-prefix' });
  assert.ok(at(session, resultId(session, CLAUDE_RUNS.agentFailQuote)) < at(session, commentaryId(session, CLAUDE_RUNS.claimQuote)));
  const last = session.events.filter((event) => !event.childId && event.kind !== 'boundary').at(-1);
  assert.ok(at(session, last.id) < at(session, resultId(session, 'changelog updated')), 'the unproven rest after every parent event');
  assert.deepEqual(receipts(session).filter(([, unproven]) => unproven).length, 1);
  assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_continued_unproven), [[1, ['D1-0']]]);
});

test('D175: an older recording, a message not found verbatim, or another agent\'s resume keeps today\'s placement', async (t) => {
  const today = [{ delivery: { delegation: 0 }, receipt: row(4, 0) }, { delivery: { request: 2 } }];
  for (const [why, rows, agentRows] of [
    ['no resumedAgentId (an older recorder)', parentRows({ sidecar: { success: true, message: 'Message sent.' } }), helperRows()],
    ['no sidecar', parentRows({ sidecar: null }), helperRows()],
    ['the message not in the helper\'s request', parentRows(), helperRows({ resumedWith: 'SYNTHETIC_D175_OTHER: something else.' })],
    // Its own notification names it: a resume of another agent, received, delivers nothing to this one.
    ['another agent resumed', parentRows({ sidecar: sidecarOf('a0000000000000000'), task: 'a0000000000000000' }), helperRows()],
  ]) {
    const ledger = await ledgerOf(t, rows, agentRows);
    assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: today }], why);
    assert.deepEqual(ledger.helperDeliveryLosses, [{ delivery: { delegation: 0 }, reason: HELPER_DELIVERY_REASONS.continued }], why);
    assert.equal(ledger.ledger.find((act) => act.tool === 'SendMessage').childFollowupUnresolved, true, why);
  }
});

test('D175: a resumed helper\'s record that is not exactly valid is no record (the placement before M33 P)', async (t) => {
  const ledger = await ledgerOf(t, parentRows({ second: true }), helperRows({ second: true }));
  const [{ child, segments: [first, one, two] }] = ledger.helperSegments;
  const legacy = ids(adapt(legacyOf(ledger), { sessionKey: 'd175-tamper' }));
  assert.notDeepEqual(ids(adapt(ledger, { sessionKey: 'd175-tamper' })), legacy, 'the valid record moves the order');
  const bare = (request) => ({ delivery: { request } });
  // The action the resume names recorded as another tool's.
  const otherTool = { ...ledger, ledger: ledger.ledger.map((act) => (act.seq === 0 ? { ...act, tool: 'TaskOutput' } : act)) };
  assert.deepEqual(ids(adapt(otherTool, { sessionKey: 'd175-tamper' })), legacy, 'the action is another tool\'s');
  // Fix round: the action with no recorded row (`sourceLocator`).
  const unlocated = { ...ledger, ledger: ledger.ledger.map(({ sourceLocator, ...act }) => (act.seq === 0 ? act
    : { ...act, sourceLocator })) };
  assert.deepEqual(ids(adapt(unlocated, { sessionKey: 'd175-tamper' })), legacy, 'the action records no row');
  for (const [why, segments] of [
    ['an extra key', [first, { ...one, arrival: one.receipt }]],
    ['no receipt', [first, { delivery: one.delivery, request: one.request }]],
    ['no request', [first, { delivery: one.delivery, receipt: one.receipt }]],
    ['an action that is no SendMessage', [first, { ...one, delivery: { action: { turn: 1, seq: 2 } } }]],
    ['an action not recorded', [first, { ...one, delivery: { action: { turn: 1, seq: 9 } } }]],
    ['an action with another key', [first, { ...one, delivery: { action: one.delivery.action, delegation: 0 } }]],
    ['a request its helper does not record', [first, { ...one, request: 9 }]],
    ['a request at the helper\'s first turn', [first, { ...one, request: 1 }]],
    ['requests not increasing', [first, { ...one, request: 3 }, { ...two, request: 2 }]],
    ['a receipt before its action\'s row', [first, { ...one, receipt: row(3, 0) }]],
    // Fix round: each rule below is the only one that rejects its case.
    ['an action with an extra key', [first, { ...one, delivery: { action: { ...one.delivery.action, x: 1 } } }]],
    ['a receipt not past its action\'s position', [first, { ...one, receipt: { ...one.receipt, beforeEvent: 0 } }]],
    // Row 8 (the claim): after the first resume's receipt (row 7), before the second SendMessage's row (9).
    ['a second receipt before its own action\'s row', [first, one, { ...two, receipt: row(8, 1) }]],
    ['a receipt not after the first segment\'s', [{ ...first, receipt: one.receipt }, one]],
    ['receipts not increasing', [first, { ...one, receipt: two.receipt }, { ...two, receipt: one.receipt }]],
    ['no first receipt', [{ delivery: first.delivery }, one]],
    ['one action twice', [first, one, { ...two, delivery: one.delivery }]],
    ['a resume first', [one]],
    ['a resume after the bare request', [first, bare(2), two]],
    ['a bare request not after the resume', [first, one, bare(2)]],
    ['a resume after a bare request at a later turn', [first, bare(3), { ...one, request: 2 }]],
  ]) {
    const tampered = { ...ledger, helperSegments: [{ child, segments }] };
    assert.deepEqual(ids(adapt(tampered, { sessionKey: 'd175-tamper' })), legacy, why);
  }
  // And the valid shapes: one resume, then the bare rest at a later turn.
  const valid = { ...ledger, helperSegments: [{ child, segments: [first, one, bare(3)] }] };
  assert.notDeepEqual(ids(adapt(valid, { sessionKey: 'd175-tamper' })), legacy);
});

test('D175 fix round: the follow-up gap is dropped only for a SendMessage a VALID record proves', async (t) => {
  const ledger = await ledgerOf(t, parentRows(), helperRows());
  const [{ child, segments: [first, one] }] = ledger.helperSegments;
  assert.equal(ledger.ledger.find((act) => act.tool === 'SendMessage').childFollowupUnresolved, true);
  assert.deepEqual(gapsOf(adapt(ledger, { sessionKey: 'd175-gap' }), FOLLOWUP_NOTE), []);
  // A record the adapter rejects: the placement before M33 P, and the gap is declared as before.
  const rejected = { ...ledger, helperSegments: [{ child, segments: [first, { ...one, arrival: one.receipt }] }] };
  assert.deepEqual(ids(adapt(rejected, { sessionKey: 'd175-gap' })), ids(adapt(legacyOf(ledger), { sessionKey: 'd175-gap' })));
  assert.deepEqual(gapsOf(adapt(rejected, { sessionKey: 'd175-gap' }), FOLLOWUP_NOTE), [[1, ['A1-0']]]);
});

test('D175 fix round: a resumed turn a task of the helper\'s own woke is not proven (today\'s placement, declared)', async (t) => {
  const ledger = await ledgerOf(t, parentRows(), helperRows({ woken: 2 }));
  assert.deepEqual(ledger.helperSegments, [{ child: 0, segments: [{ delivery: { delegation: 0 }, receipt: row(4, 0) },
    { delivery: { request: 2 } }] }]);
  assert.deepEqual(ledger.helperDeliveryLosses, [{ delivery: { delegation: 0 }, reason: HELPER_DELIVERY_REASONS.continued }]);
  const session = adapt(ledger, { sessionKey: 'd175-woken' });
  const last = session.events.filter((event) => !event.childId && event.kind !== 'boundary').at(-1);
  assert.ok(at(session, last.id) < at(session, resultId(session, CLAUDE_RUNS.agentFailQuote)), 'after every parent event');
  assert.deepEqual(gapsOf(session, HELPER_DELIVERY_GAP_NOTES.helper_continued_unproven), [[1, ['D1-0']]]);
  assert.deepEqual(gapsOf(session, FOLLOWUP_NOTE), [[1, ['A1-0']]]);
  // A notification queued into its work in progress (no wake), or a wake in its first turn (its hand-off's segment,
  // under the M33 P rule as before): the resume is still proven.
  const resumed = [{ delivery: { action: { turn: 1, seq: 0 } }, request: 2, receipt: row(7, 1) }];
  const queued = await ledgerOf(t, parentRows(), helperRows({ woken: 2, queued: true }));
  assert.deepEqual(queued.helperSegments[0].segments.slice(1), resumed, 'queued');
  const first = await ledgerOf(t, parentRows(), helperRows({ woken: 1 }));
  assert.deepEqual(first.helperSegments[0].segments.slice(1), resumed, 'its first turn');
});

const AGENT_B = 'a8888888888888888';
const AGENT_B_CALL = 'toolu_01SyntheticAgentD175B';
const SEND_B = 'toolu_01SyntheticSendD175B';
const B_TEXT = 'SYNTHETIC_D175_CONTINUE_B: now check the docs.';
test('D175 fix round: one SendMessage named by two helpers\' records proves only the first', async (t) => {
  const rows = [claudeRow('user', CLAUDE_TEXT.ask, HUMAN_PROMPT, 'd175:ask'), agentCallRow({ flag: true }), agentStubRow(),
    agentNotification(AGENT_CALL), agentCallRow({ flag: true, id: AGENT_B_CALL }),
    agentStubRow({ id: AGENT_B_CALL, agent: AGENT_B }), agentNotification(AGENT_B_CALL, 'completed', AGENT_B),
    ...send(SEND_MESSAGE_CALL, CONTINUE_TEXT, sidecarOf(), 'one'), notice(SEND_MESSAGE_CALL, 'one'),
    ...send(SEND_B, B_TEXT, sidecarOf(AGENT_B), 'b', AGENT_B), notice(SEND_B, 'b', AGENT_B),
    claudeRow('assistant', [{ type: 'text', text: 'Done.' }], {}, 'd175:done')];
  const tree = await claudeTree(rows, helperRows());
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  await writeFile(join(tree.projects, '-srv-synthetic-p', SID, 'subagents', `agent-${AGENT_B}.jsonl`),
    jsonl(helperRows({ resumedWith: B_TEXT, agent: AGENT_B, prefix: 'b:' })), { mode: 0o600 });
  const ledger = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } })).ledger;
  assert.deepEqual(ledger.helperSegments.map((record) => record.segments.slice(1).map((s) => s.delivery.action)),
    [[{ turn: 1, seq: 0 }], [{ turn: 1, seq: 1 }]]);
  const [a, b] = ledger.helperSegments;
  const key = { sessionKey: 'd175-two' };
  const onlyA = ids(adapt({ ...ledger, helperSegments: [a] }, key));
  assert.notDeepEqual(ids(adapt(ledger, key)), onlyA);
  // The second record names the first's SendMessage (its receipt still after that action): it is no record.
  const tampered = { ...ledger, helperSegments: [a, { ...b, segments: [b.segments[0], { ...b.segments[1],
    delivery: a.segments[1].delivery }] }] };
  assert.deepEqual(ids(adapt(tampered, key)), onlyA);
  assert.deepEqual(gapsOf(adapt(tampered, key), FOLLOWUP_NOTE), [[1, ['A1-1']]]);
});
