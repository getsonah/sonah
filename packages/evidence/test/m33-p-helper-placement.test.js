// M33 P (C-03 "M33 child placement", amended), the ledger adapter. A valid `helperSegments` record (the loader's exact
// delivery and receipt joins) cuts a linked helper's history into segments at the recorded arrival of each assignment,
// and places each segment where the parent RECEIVED the helper's result: a block of the receipt's turn, ordered by its
// row, moved back past the parent's own work recorded after it, headed — when the parent recorded work of its own
// between the delivery and the receipt — by a receipt boundary whose fixed code wording states the concurrency. Every
// identity, and each event's C-02 turn, is the delivery's: commentary ids are the launch layout's, a segment another
// assignment delivered is that assignment's part. A record that is not exactly valid is no record. Synthetic ledgers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, HELPER_RECEIPT_BOUNDARY, HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES }
  from '../adapters/sonah-ledger.js';
import { partAttribution } from '../src/ledger.js';
import { planWindowRequests } from '../src/run-review.js';
import { planWindows } from '../src/windows.js';
import * as prompt from '../src/prompt.js';

// ---- synthetic ledgers (Codex-shaped: every action records its row) ------------------------------------------------

const cmd = (turn, seq, record, name, extra = {}) => ({ turn, seq, kind: 'bash', cmd: `node ${name}.js`,
  outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: [`${name} ok`],
  sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 }, ...extra });
const send = (turn, seq, record) => ({ turn, seq, kind: 'other', tool: 'send_message', genericTool: true,
  argsExcerpt: '{"target":"helper_a"}', inputRecorded: true, result: { seen: true, outcome: 'succeeded', provenance: 'native' },
  sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 } });
const say = (turn, record, beforeEvent, text) => ({ turn, source: 0, record, block: 0, beforeEvent, text });
const spawn = (turn, record, extra = {}) => ({ adapter: 'codex', kind: 'spawn', callId: `spawn-${record}`, turn,
  childId: 'helper-a', taskName: '/root/helper_a', status: 'linked', reason: 'child_recording_linked', source: 0, record,
  link: { source: 0 }, parentInstruction: { tool: 'spawn_agent', field: 'message', encrypted: true }, ...extra });
const followup = (turn, record) => ({ adapter: 'codex', kind: 'followup', callId: `follow-${record}`, turn, target: 'helper_a',
  status: 'linked', reason: 'child_followup_linked', source: 0, record, link: { source: 0 },
  parentInstruction: { tool: 'followup_task', field: 'message', encrypted: true } });
/** The helper's own ledger: its first assignment's work (an edit and a FAILING run), then a later assignment's. */
const helper = () => ({ ask: [], instructions: [], instructionAuthority: 'unchecked', sayings: [], marks: [],
  ledger: [cmd(0, 0, 3, 'helper-edit'), cmd(0, 1, 5, 'helper-test', { outcome: 'failed', exitCode: 1, tailLines: ['FAIL nested'] }),
    cmd(0, 2, 9, 'helper-more')],
  commentary: [say(0, 2, 0, 'Starting the first assignment.'), say(0, 8, 2, 'Starting the second assignment.')],
  capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] } });
const row = (turn, beforeEvent, record) => ({ turn, beforeEvent, source: 0, record });
/**
 * One parent: turn 1 runs the suite (rows 4-5), spawns the helper (row 6), runs a check (rows 8-9) and claims (row 10);
 * turn 2 (ask at row 12) follows up (row 14), runs once more (rows 16-17) and closes (row 20).
 */
const parent = (segments = null, over = {}) => ({
  ask: [{ turn: 1, text: 'Fix the parser.' }, { turn: 2, text: 'Also cover the nested case.' }],
  ledger: [cmd(1, 0, 4, 'suite'), cmd(1, 1, 8, 'check'), cmd(2, 0, 16, 'again')],
  commentary: [say(1, 10, 2, 'All parser tests pass now.'), say(2, 20, 3, 'Both assignments are done.')],
  sayings: [], marks: [],
  delegations: [spawn(1, 6), followup(2, 14)],
  children: [{ source: 0, ledger: helper(), parentInstructions: [] }],
  ...(segments ? { helperSegments: [{ child: 0, segments }] } : {}),
  ...over,
});
const SEG0 = (receipt) => ({ delivery: { delegation: 0 }, arrival: row(0, 0, 2), ...(receipt ? { receipt } : {}) });
const SEG1 = (receipt) => ({ delivery: { delegation: 1 }, arrival: row(0, 2, 7), ...(receipt ? { receipt } : {}) });
const ids = (session) => session.events.map((event) => event.id);
const at = (session, id) => { const index = ids(session).indexOf(id); assert.ok(index >= 0, id); return index; };
const H = 'child:helper-a:';
const boundaries = (session) => session.events.filter((event) => event.boundary === HELPER_RECEIPT_BOUNDARY);
const withoutPlacement = ({ sequence, deliveredBy, ...event }) => event;

test('M33 P the receipt boundary is one fixed value, its statement fixed code wording, its notes closed', () => {
  assert.equal(HELPER_RECEIPT_BOUNDARY, 'helper_receipt');
  // M35 (windowing): its fixed statement (`helperConcurrencyLine`) is gone with the placement it stated: a helper is a
  // session of its own, and no window shows the receipt boundary.
  assert.equal(Object.hasOwn(prompt, 'helperConcurrencyLine'), false);
  // M33 P repair: work with no receipt is placed after the request that delivered it (never ahead of parent work it may
  // have followed), and the note says so. M33 P second repair: after the SESSION's last request (a later request's
  // claim is parent work it may have followed too).
  assert.equal(HELPER_PLACEMENT_NOTES.unreceived,
    'a helper\'s work is placed after the session\'s last request because the parent recorded no receipt of its result');
  for (const notes of [HELPER_PLACEMENT_NOTES, HELPER_DELIVERY_GAP_NOTES]) {
    assert.ok(Object.isFrozen(notes));
    assert.equal(new Set(Object.values(notes)).size, Object.values(notes).length);
  }
});

test('M33 P a segment stands where the parent received it: after the parent\'s claim, headed by the concurrency', () => {
  // Segment 1 of 1: the whole history, received at row 11 — after the check and the claim of turn 1.
  const session = sessionFromLedger(parent([SEG0(row(1, 2, 11))], { delegations: [spawn(1, 6)] }), { sessionKey: 'p' });
  const claim = session.events.find((event) => event.kind === 'commentary' && session.textOf(event, 'text') === 'All parser tests pass now.');
  assert.ok(at(session, 'A1-0-r') < at(session, 'D1-0') && at(session, 'D1-0') < at(session, 'A1-1'), 'the spawn stays at its row');
  const [boundary] = boundaries(session);
  assert.deepEqual({ ...boundary, sequence: undefined }, { id: 'R1-0', kind: 'boundary', sequence: undefined,
    boundary: HELPER_RECEIPT_BOUNDARY, relatedSession: null, delivery: 'D1-0', assignments: ['D1-0'], turn: 'T1' });
  assert.ok(at(session, claim.id) < at(session, 'R1-0'), 'received after the claim');
  assert.equal(at(session, `${H}A0-1-r`) > at(session, 'R1-0'), true, 'the helper\'s failing run follows its receipt');
  assert.deepEqual(session.events.map((event) => event.sequence), session.events.map((_, i) => i));
  // M35 (windowing): the helper is a session of its own — its events are its own session's, after the parent's, and the
  // receipt boundary is in no window. M36 phase 3 (D68 K): small, it shares the parent's window, under its own heading.
  const windows = planWindows(session);
  assert.deepEqual(windows.map((window) => window.parts.map((part) => part.session.childId)), [[null, 'helper-a']]);
  assert.ok(windows.every((window) => window.events.every((event) => event.id !== 'R1-0')));
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  assert.ok(requests.every(({ request }) => !request.evidencePrompt.includes(HELPER_RECEIPT_BOUNDARY)));
  assert.ok(Object.hasOwn(requests[0].sourceMap, `${H}A0-1-r`), 'the helper\'s run, in its own section of the window');
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.unreceived), []);
});

test('M33 P received right after its delivery, with no parent work between: placed there, no statement', () => {
  const session = sessionFromLedger(parent([SEG0(row(1, 1, 7))], { delegations: [spawn(1, 6)] }), { sessionKey: 'p' });
  assert.deepEqual(boundaries(session), []);
  assert.equal(at(session, `${H}C0-0-0`), at(session, 'D1-0') + 1);
  assert.ok(at(session, `${H}A0-2-r`) < at(session, 'A1-1'));
});

test('M33 P follow-up segments: each at its own receipt, each the part of the request that delivered it', () => {
  const session = sessionFromLedger(parent([SEG0(row(1, 2, 11)), SEG1(row(2, 3, 18))]), { sessionKey: 'p' });
  const order = ids(session);
  // Segment 0 (the first assignment's work, the failing run included) in turn 1 at row 11; segment 1 in turn 2 at row 18.
  assert.ok(at(session, `${H}A0-1-r`) < at(session, 'I2') && at(session, `${H}A0-1-r`) > at(session, 'R1-0'));
  assert.ok(at(session, `${H}A0-2`) > at(session, 'A2-0-r') && at(session, `${H}A0-2`) > at(session, 'R2-1'));
  assert.deepEqual(boundaries(session).map((b) => [b.id, b.delivery, b.turn]), [['R1-0', 'D1-0', 'T1'], ['R2-1', 'D2-1', 'T2']]);
  // Every event of the helper appears once.
  assert.equal(order.filter((id) => id.startsWith(H)).length, 8);
  assert.equal(new Set(order).size, order.length);
  // Parts (C-06): the follow-up's segment is the part of the request that delivered it; the first, its spawn's.
  const parts = partAttribution(session);
  assert.equal(parts.get(`${H}A0-0`), 'T1');
  assert.equal(parts.get(`${H}A0-1-r`), 'T1');
  assert.equal(parts.get(`${H}A0-2`), 'T2');
  assert.equal(session.event(`${H}A0-2`).deliveredBy, 'D2-1');
  assert.equal(session.event(`${H}A0-0`).deliveredBy, undefined);
  // The follow-up's delivery is proven, so it no longer declares that it was not.
  const link = session.children.find((child) => child.assignmentEvent === 'D2-1');
  assert.equal(link.assignmentEffectProven, true);
  assert.equal(session.adapterGaps.some((gap) => gap.eventIds?.includes('D2-1')
    && /delivery and later child work were not causally established/.test(gap.note)), false);
});

test('M33 P commentary ids are the launch layout\'s, however far a segment moves', () => {
  const placed = sessionFromLedger(parent([SEG0(row(2, 3, 18))]), { sessionKey: 'p' });   // received a turn later
  const legacy = sessionFromLedger(parent(), { sessionKey: 'p' });                         // the history behind its spawn
  const commentary = (session) => session.events.filter((event) => event.kind === 'commentary').map((event) => event.id).sort();
  assert.deepEqual(commentary(placed), commentary(legacy));
  // Only order moved, and the receipt boundary was added: every other event is as it was, field for field.
  const old = new Map(legacy.events.map((event) => [event.id, event]));
  for (const event of placed.events.filter((e) => e.boundary !== HELPER_RECEIPT_BOUNDARY))
    assert.deepEqual(withoutPlacement(event), withoutPlacement(old.get(event.id)), event.id);
  assert.equal(placed.events.length, legacy.events.length + 1);
});

test('M33 P a segment with no receipt stands after the session\'s last request, stated and declared once', () => {
  // M33 P repair (recheck minor): with no receipt the parent never received the work, which may have finished after any
  // parent work recorded after its delivery — so it is never shown ahead of that work (before the repair: at its
  // delivery, right behind its spawn or follow-up, ahead of the parent's later claim). Each block is headed by the
  // receipt boundary marked `unproven`. M33 P second repair: that includes a LATER request's work (before it: after its
  // delivery request's own work, ahead of a claim in the next request).
  const session = sessionFromLedger(parent([SEG0(), SEG1()]), { sessionKey: 'p' });
  assert.deepEqual(boundaries(session).map((b) => [b.delivery, b.unproven]), [['D1-0', true], ['D2-1', true]]);
  const claim = session.events.find((event) => event.kind === 'commentary' && session.textOf(event, 'text') === 'All parser tests pass now.');
  assert.ok(at(session, 'D1-0') < at(session, 'A1-1') && at(session, claim.id) < at(session, `${H}C0-0-0`)
    && at(session, 'C2-1-18') < at(session, `${H}C0-0-0`), 'the first after the last request\'s own work, every claim included');
  assert.ok(at(session, 'D2-1') < at(session, 'A2-0') && at(session, 'C2-1-18') < at(session, `${H}C0-2-5`)
    && at(session, `${H}C0-0-0`) < at(session, `${H}C0-2-5`), 'the second after it, in segment order');
  assert.deepEqual(boundaries(session).map((b) => b.turn), ['T1', 'T2'], 'each boundary keeps its delivery\'s turn');
  const declared = session.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.unreceived);
  assert.deepEqual(declared.map(({ sessionKey, ...gap }) => gap), [{ code: 'incomplete_inventory', channel: 'children',
    scope: 'session', count: 2, eventIds: ['D1-0', 'D2-1'], note: HELPER_PLACEMENT_NOTES.unreceived }]);
  // A send_message's segment with no receipt stands after its own request's work too, in the part that sent it.
  const sent = parent([SEG0(), { delivery: { action: { turn: 2, seq: 0 } }, arrival: row(0, 2, 7) }],
    { ledger: [cmd(1, 0, 4, 'suite'), cmd(1, 1, 8, 'check'), send(2, 0, 14), cmd(2, 1, 16, 'again')], delegations: [spawn(1, 6)],
      commentary: [say(1, 10, 2, 'All parser tests pass now.'), say(2, 20, 4, 'Both assignments are done.')] });
  const viaSend = sessionFromLedger(sent, { sessionKey: 'p' });
  assert.ok(at(viaSend, 'A2-1-r') < at(viaSend, `${H}C0-2-5`));
  assert.equal(viaSend.event(`${H}A0-2`).deliveredBy, 'A2-0');
  assert.equal(partAttribution(viaSend).get(`${H}A0-2`), 'T2');
});

test('M33 P a record that is not exactly valid is no record: the helper keeps its whole history behind its spawn', () => {
  const legacy = ids(sessionFromLedger(parent(), { sessionKey: 'p' }));
  for (const [why, segments] of [
    ['a receipt before its delivery', [SEG0(row(1, 1, 5))]],
    ['a receipt in an earlier turn', [{ ...SEG0(), receipt: row(0, 0, 9) }]],
    ['a receipt past its turn\'s actions', [SEG0(row(1, 3, 11))]],
    ['a receipt with an extra field', [SEG0({ ...row(1, 2, 11), status: 'completed' })]],
    ['a first segment delivered by the follow-up', [{ delivery: { delegation: 1 }, arrival: row(0, 0, 2) }]],
    ['a later segment with no arrival', [SEG0(), { delivery: { delegation: 1 } }]],
    ['arrivals out of order', [SEG0(), { ...SEG1(), arrival: row(0, 0, 1) }]],
    ['a delivery named twice', [SEG0(), SEG1(), SEG1()]],
    ['a send that is no send_message', [SEG0(), { delivery: { action: { turn: 1, seq: 1 } }, arrival: row(0, 2, 7) }]],
    ['an unknown field', [{ ...SEG0(), placedAt: 3 }]],
    ['no segments', []],
  ]) {
    const session = sessionFromLedger(parent(segments), { sessionKey: 'p' });
    assert.deepEqual(ids(session), legacy, why);
    assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === HELPER_PLACEMENT_NOTES.unreceived), [], why);
  }
  // A child named by two records, or by none of the ledger's units: neither is a record.
  const twice = parent([SEG0(row(1, 2, 11))]);
  twice.helperSegments.push({ child: 0, segments: [SEG0()] });
  assert.deepEqual(ids(sessionFromLedger(twice, { sessionKey: 'p' })), legacy);
  assert.deepEqual(ids(sessionFromLedger({ ...parent(), helperSegments: [{ child: 7, segments: [SEG0(row(1, 2, 11))] }] },
    { sessionKey: 'p' })), legacy);
});

test('M33 P every recorded delivery loss is declared under its closed note, naming its sends; an unreadable one too', () => {
  const ledger = parent(null, { helperDeliveryLosses: [
    { delivery: { delegation: 0 }, reason: 'helper_delivery_unmatched' },
    { delivery: { delegation: 1 }, reason: 'helper_followup_unproven' },
    { delivery: { delegation: 0 }, reason: 'helper_arrival_unmatched' },
    { delivery: { delegation: 0 }, reason: 'helper_arrival_unmatched' },
    { delivery: { action: { turn: 1, seq: 1 } }, reason: 'helper_delivery_ambiguous' },
    { delivery: { delegation: 0 }, reason: 'a reason no vocabulary has' },
    { delivery: { action: { turn: 9, seq: 9 } }, reason: 'helper_delivery_unmatched' },
  ] });
  const gaps = sessionFromLedger(ledger, { sessionKey: 'p' }).adapterGaps
    .filter((gap) => Object.values(HELPER_DELIVERY_GAP_NOTES).includes(gap.note)).map(({ sessionKey, lossOrdinal, ...gap }) => gap);
  const gap = (note, count, eventIds) => ({ code: 'incomplete_inventory', channel: 'children', scope: 'session', count,
    ...(eventIds ? { eventIds } : {}), note });
  assert.deepEqual(gaps, [
    gap(HELPER_DELIVERY_GAP_NOTES.helper_delivery_unmatched, 1, ['D1-0']),
    gap(HELPER_DELIVERY_GAP_NOTES.helper_delivery_ambiguous, 1, ['A1-1']),
    gap(HELPER_DELIVERY_GAP_NOTES.helper_followup_unproven, 1, ['D2-1']),
    gap(HELPER_DELIVERY_GAP_NOTES.helper_arrival_unmatched, 2, ['D1-0']),
    gap(HELPER_DELIVERY_GAP_NOTES.unreadable, 2)]);
});

test('M33 P a transferred child\'s own receipt boundary is renamed with the hand-offs it heads, and rides uncounted', () => {
  // The helper itself spawned a grandchild that it received only after its own later work.
  const grandchild = { ...helper(), ledger: [cmd(0, 0, 3, 'grand')], commentary: [] };
  const middle = { ...helper(), delegations: [{ ...spawn(0, 4, { childId: 'grand', taskName: '/root/helper_a/grand' }) }],
    children: [{ source: 0, ledger: grandchild, parentInstructions: [] }],
    helperSegments: [{ child: 0, segments: [{ delivery: { delegation: 0 }, receipt: row(0, 2, 8) }] }] };
  const session = sessionFromLedger({ ...parent(null, { delegations: [spawn(1, 6)] }),
    children: [{ source: 0, ledger: middle, parentInstructions: [] }] }, { sessionKey: 'p' });
  const [nested] = boundaries(session);
  assert.deepEqual([nested.id, nested.delivery, nested.assignments, nested.childId],
    [`${H}R0-0`, `${H}D0-0`, [`${H}D0-0`], 'helper-a']);
  // The parent's own commentary ids do not count it.
  const legacy = sessionFromLedger({ ...parent(null, { delegations: [spawn(1, 6)] }),
    children: [{ source: 0, ledger: { ...middle, helperSegments: undefined }, parentInstructions: [] }] }, { sessionKey: 'p' });
  const commentary = (s) => s.events.filter((event) => event.kind === 'commentary' && !event.childId).map((event) => event.id);
  assert.deepEqual(commentary(session), commentary(legacy));
});
