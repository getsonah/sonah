// M33 P repair, the ledger adapter. (1) A synchronous Claude Agent/Task record's receipt is its own result row: the
// hand-off stays at its call row and the agent's history is placed where the parent received it — after a sibling call's
// result recorded first — with the concurrency stated. A Claude hand-off with no valid record keeps d7226ec's placement:
// its block never moves back past a parent action, whatever rows the ledger records. (2) Work with no receipt is placed
// after its delivery request's own work, never ahead of parent work recorded after its delivery; (3) a queued
// assignment's `shared` record is placed at the helper's `next` report, else after the receiving request's own work;
// both are stated in a second fixed wording and declared. A record that is not exactly valid is no record. Synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES } from '../adapters/sonah-ledger.js';
import { partAttribution } from '../src/ledger.js';
import { planWindowRequests } from '../src/run-review.js';

const say = (turn, record, beforeEvent, text) => ({ turn, source: 0, record, block: 0, beforeEvent, text });
const row = (turn, beforeEvent, record) => ({ turn, beforeEvent, source: 0, record });
const ids = (session) => session.events.map((event) => event.id);
const at = (session, id) => { const index = ids(session).indexOf(id); assert.ok(index >= 0, id); return index; };
const boundaries = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY);
const gapsOf = (session, note) => session.adapterGaps.filter((gap) => gap.note === note).map((gap) => [gap.count, gap.eventIds]);

// ---- a Claude-shaped parent: an Agent call (row 2) in parallel with the parent's own test run (rows 3-4) ---------------

const run = (turn, seq, record, outcome, located = true) => ({ turn, seq, kind: 'test', cmd: 'npm test', outcome,
  exitCode: outcome === 'passed' ? 0 : 1, exitCodeSource: 'native', tailLines: [`suite ${outcome}`],
  ...(located ? { sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 } } : {}) });
const agent = () => ({ ask: [], instructions: [{ turn: 1, text: 'Write the nested test.', origin: 'agent-or-inherited' }],
  instructionAuthority: 'unchecked', sayings: [], marks: [],
  ledger: [{ turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'passed', exitCode: 0, exitCodeSource: 'native',
    tailLines: ['agent suite passed'] }],
  commentary: [], capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] } });
const claudeParent = (segments = null, { located = true } = {}) => ({
  ask: [{ turn: 1, text: 'Fix the parser.' }],
  ledger: [run(1, 0, 3, 'failed', located)],
  commentary: [say(1, 6, 1, 'All parser tests pass now.')], sayings: [], marks: [],
  delegations: [{ adapter: 'claude', callId: 'toolu_a', turn: 1, childId: 'agent-a', status: 'linked',
    reason: 'child_recording_linked', parentInstruction: { text: 'Write the nested test.', tool: 'Agent', field: 'prompt' },
    source: 0, record: 2, link: { source: 0 } }],
  children: [{ source: 0, ledger: agent(), parentInstructions: [] }],
  ...(segments ? { helperSegments: [{ child: 0, segments }] } : {}),
});
const A = 'child:agent-a:';
const claim = (session) => session.events.find((event) => event.kind === 'commentary' && !event.childId).id;

test('M33 P repair a synchronous Agent is received at its own result row, after a sibling\'s result recorded first', () => {
  const session = sessionFromLedger(claudeParent([{ delivery: { delegation: 0 }, receipt: row(1, 1, 5) }]), { sessionKey: 'p' });
  // The hand-off at its call row; the sibling's run and result; the receipt and its statement; the agent's work; the claim.
  assert.deepEqual(ids(session), ['I1', 'D1-0', 'A1-0', 'A1-0-r', 'R1-0', `${A}I1`, `${A}A1-0`, `${A}A1-0-r`, claim(session)]);
  const [boundary] = boundaries(session);
  assert.deepEqual([boundary.delivery, boundary.unproven], ['D1-0', undefined]);
  // M35 (windowing): no window shows the receipt boundary; the agent's work is its own session's (M36 phase 3, D68 K:
  // sharing the parent's window, as its own part).
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  assert.ok(requests.every(({ request }) => !request.evidencePrompt.includes(HELPER_RECEIPT_BOUNDARY)));
  assert.deepEqual(requests.map(({ window }) => window.parts.map((part) => part.session.childId)), [[null, 'agent-a']]);
  // Its call and both results on one stream; a sibling CALLED on the hand-off's own row but answered before its receipt
  // ran concurrently too (its result row is between), so the statement stands.
  const sameRow = claudeParent([{ delivery: { delegation: 0 }, receipt: row(1, 1, 4) }]);
  sameRow.ledger = [{ ...run(1, 0, 2, 'failed'), sourceLocator: { stream: 0, record: 2, part: 1, resultRecord: 3 } }];
  assert.equal(boundaries(sessionFromLedger(sameRow, { sessionKey: 'p' })).length, 1);
});

test('M33 P repair a Claude hand-off with no valid record never moves back past a parent action (d7226ec\'s placement)', () => {
  const rowless = ids(sessionFromLedger(claudeParent(null, { located: false }), { sessionKey: 'p' }));
  assert.deepEqual(rowless, ['I1', 'A1-0', 'A1-0-r', 'D1-0', `${A}I1`, `${A}A1-0`, `${A}A1-0-r`, 'C1-1-3']);
  // With rows recorded, and no record (a ledger tampered with, or an older loader's): the same order, never the call row.
  assert.deepEqual(ids(sessionFromLedger(claudeParent(), { sessionKey: 'p' })), rowless);
  assert.deepEqual(ids(sessionFromLedger(claudeParent([{ delivery: { delegation: 0 }, receipt: { ...row(1, 1, 5), x: 1 } }]),
    { sessionKey: 'p' })), rowless);
});

test('M33 P repair no receipt: the hand-off at its call row, the work after its request\'s own work, stated and declared', () => {
  const session = sessionFromLedger(claudeParent([{ delivery: { delegation: 0 } }]), { sessionKey: 'p' });
  assert.deepEqual(ids(session), ['I1', 'D1-0', 'A1-0', 'A1-0-r', claim(session), 'R1-0', `${A}I1`, `${A}A1-0`, `${A}A1-0-r`]);
  const [boundary] = boundaries(session);
  assert.deepEqual([boundary.delivery, boundary.unproven, boundary.assignments], ['D1-0', true, ['D1-0']]);
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  assert.ok(requests.every(({ request }) => !request.evidencePrompt.includes(HELPER_RECEIPT_BOUNDARY)));
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), [[1, ['D1-0']]]);
});

test('M33 P repair the second fixed wording and the placement notes are closed values', () => {
  // M35 (windowing): the second fixed wording (`helperUnreceivedLine`) is gone with the placement it stated.
  // M33 P second repair: work with no proven receipt stands after the SESSION's last request; a helper whose reports no
  // segment can be tied to is declared under its own note.
  assert.deepEqual(Object.keys(HELPER_PLACEMENT_NOTES), ['unreceived', 'shared', 'ambiguous']);
  assert.equal(HELPER_PLACEMENT_NOTES.unreceived, 'a helper\'s work is placed after the session\'s last request because '
    + 'the parent recorded no receipt of its result');
  assert.equal(HELPER_PLACEMENT_NOTES.shared, 'a helper\'s assignment was sent before its earlier assignment\'s report '
    + 'arrived, so that report is not proven to be its receipt; its work is placed at the helper\'s next report, or after '
    + 'the session\'s last request');
  assert.equal(HELPER_PLACEMENT_NOTES.ambiguous, 'a helper reported more often than its parent assigned it work, or '
    + 'received a message that is no assignment of its parent, so which report received this work is not recorded; it is '
    + 'placed after the session\'s last request');
  assert.ok(Object.isFrozen(HELPER_PLACEMENT_NOTES));
});

// ---- a Codex-shaped parent: a follow-up QUEUED before the helper's first report -----------------------------------------

const cmd = (turn, seq, record, name, extra = {}) => ({ turn, seq, kind: 'bash', cmd: `node ${name}.js`,
  outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: [`${name} ok`],
  sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 }, ...extra });
const helper = () => ({ ask: [], instructions: [], instructionAuthority: 'unchecked', sayings: [], marks: [],
  ledger: [cmd(0, 0, 3, 'helper-edit'), cmd(0, 1, 9, 'helper-test', { outcome: 'failed', exitCode: 1, tailLines: ['FAIL nested'] })],
  commentary: [say(0, 2, 0, 'Starting the first assignment.'), say(0, 8, 1, 'Starting the second assignment.')],
  capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] } });
/**
 * Turn 1: the suite (rows 4-5), the spawn (row 6), the follow-up (row 7), a check (rows 8-9), the claim (row 10); the
 * helper's first report arrives at row 11. Turn 2 (ask at row 12): another run (rows 16-17), the close (row 20).
 */
const codexParent = (segments) => ({
  ask: [{ turn: 1, text: 'Fix the parser.' }, { turn: 2, text: 'Also cover the nested case.' }],
  ledger: [cmd(1, 0, 4, 'suite'), cmd(1, 1, 8, 'check'), cmd(2, 0, 16, 'again')],
  commentary: [say(1, 10, 2, 'All parser tests pass now.'), say(2, 20, 3, 'Both assignments are done.')],
  sayings: [], marks: [],
  delegations: [{ adapter: 'codex', kind: 'spawn', callId: 'spawn-6', turn: 1, childId: 'helper-a', taskName: '/root/helper_a',
    status: 'linked', reason: 'child_recording_linked', source: 0, record: 6, link: { source: 0 },
    parentInstruction: { tool: 'spawn_agent', field: 'message', encrypted: true } },
  { adapter: 'codex', kind: 'followup', callId: 'follow-7', turn: 1, target: 'helper_a', status: 'linked',
    reason: 'child_followup_linked', source: 0, record: 7, link: { source: 0 },
    parentInstruction: { tool: 'followup_task', field: 'message', encrypted: true } }],
  children: [{ source: 0, ledger: helper(), parentInstructions: [] }],
  ...(segments ? { helperSegments: [{ child: 0, segments }] } : {}),
});
const H = 'child:helper-a:';
const S0 = { delivery: { delegation: 0 }, arrival: row(0, 0, 2), receipt: row(1, 2, 11) };
const S1 = (placed) => ({ delivery: { delegation: 1 }, arrival: row(0, 1, 7), ...placed });

test('M33 P repair a queued assignment is placed at the helper\'s next report, stated, in the part that sent it', () => {
  const session = sessionFromLedger(codexParent([S0, S1({ shared: row(1, 2, 11), next: row(2, 3, 18) })]), { sessionKey: 'p' });
  // The first assignment's work at the first report (after the claim); the second's at the next report, in turn 2.
  assert.ok(at(session, 'C1-2-5') < at(session, `${H}A0-0`) && at(session, `${H}A0-0-r`) < at(session, 'I2'));
  assert.ok(at(session, 'A2-0-r') < at(session, `${H}A0-1-r`) && at(session, `${H}A0-1-r`) < at(session, 'C2-1-17'));
  assert.deepEqual(boundaries(session).map((b) => [b.id, b.delivery, b.unproven ?? false, b.turn]),
    [['R1-0', 'D1-0', false, 'T1'], ['R2-1', 'D1-1', true, 'T1']]);
  assert.equal(partAttribution(session).get(`${H}A0-1-r`), 'T1');
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.shared), [[1, ['D1-1', 'D1-0']]]);
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), []);
});

test('M33 P repair a queued assignment with no next report is placed after the session\'s last request', () => {
  // M33 P second repair: not after the request that received the shared report (a later request's claim may precede it).
  const session = sessionFromLedger(codexParent([S0, S1({ shared: row(1, 2, 11) })]), { sessionKey: 'p' });
  assert.ok(at(session, `${H}A0-0-r`) < at(session, `${H}A0-1`), 'the helper\'s own order is kept');
  assert.ok(at(session, `${H}A0-0-r`) < at(session, 'I2'), 'the first assignment at its receipt');
  assert.ok(at(session, 'C2-1-17') < at(session, `${H}A0-1`), 'the second after the last request\'s own work');
  assert.deepEqual(boundaries(session).map((b) => [b.delivery, b.unproven ?? false, b.turn]),
    [['D1-0', false, 'T1'], ['D1-1', true, 'T1']]);
  assert.equal(partAttribution(session).get(`${H}A0-1-r`), 'T1', 'still the part of the request that sent it');
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.shared), [[1, ['D1-1', 'D1-0']]]);
});

test('M33 P second repair an ambiguous segment takes no report: after the session\'s last request, declared', () => {
  const ambiguous = { delivery: { delegation: 0 }, arrival: row(0, 0, 2), ambiguous: true };
  const session = sessionFromLedger(codexParent([ambiguous, S1({ ambiguous: true })]), { sessionKey: 'p' });
  assert.ok(at(session, 'C2-1-17') < at(session, `${H}A0-0`) && at(session, `${H}A0-0-r`) < at(session, `${H}A0-1`));
  assert.deepEqual(boundaries(session).map((b) => [b.delivery, b.unproven]), [['D1-0', true], ['D1-1', true]]);
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.ambiguous), [[2, ['D1-0', 'D1-1']]]);
  assert.deepEqual(gapsOf(session, HELPER_PLACEMENT_NOTES.unreceived), []);
  assert.equal(session.event(`${H}A0-1`).deliveredBy, 'D1-1', 'still the follow-up\'s part');
});

test('M33 P repair a queued or placed record that is not exactly valid is no record', () => {
  const legacy = ids(sessionFromLedger(codexParent(), { sessionKey: 'p' }));
  for (const [why, segments] of [
    ['a shared first segment', [{ ...S0, receipt: undefined, shared: row(1, 2, 11) }]],
    ['shared and a receipt', [S0, S1({ shared: row(1, 2, 11), receipt: row(2, 3, 18) })]],
    ['a next report with nothing shared', [S0, S1({ next: row(2, 3, 18) })]],
    ['a next report not after the shared one', [S0, S1({ shared: row(1, 2, 11), next: row(1, 2, 11) })]],
    ['shared before its delivery', [S0, S1({ shared: row(1, 0, 5) })]],
    ['a shared report other than the one the segment before was placed at', [S0, S1({ shared: row(2, 3, 18) })]],
    ['two segments received at one report', [S0, S1({ receipt: row(1, 2, 11) })]],
    ['a receipt before the earlier segment\'s placement', [{ ...S0, receipt: row(2, 3, 18) }, S1({ receipt: row(1, 2, 11) })]],
    // M33 P second repair: `ambiguous` exactly true, beside no report, and every segment after one ambiguous too; a
    // later request of the helper's own on a Claude helper only.
    ['ambiguous beside a receipt', [S0, S1({ ambiguous: true, receipt: row(2, 3, 18) })]],
    ['ambiguous beside a shared report', [S0, S1({ ambiguous: true, shared: row(1, 2, 11) })]],
    ['ambiguous not true', [S0, S1({ ambiguous: 1 })]],
    ['a placed segment after an ambiguous one', [{ ...S0, receipt: undefined, ambiguous: true }, S1({ receipt: row(2, 3, 18) })]],
    ['a later request of a Codex helper', [S0, { delivery: { request: 1 } }]],
  ]) {
    const segmentsOf = segments.map((segment) => Object.fromEntries(Object.entries(segment).filter(([, v]) => v !== undefined)));
    assert.deepEqual(ids(sessionFromLedger(codexParent(segmentsOf), { sessionKey: 'p' })), legacy, why);
  }
});
