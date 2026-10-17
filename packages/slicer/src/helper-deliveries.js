// M33 P (helper placement by recorded delivery and receipt). A helper works CONCURRENTLY with its parent: the parent
// sends it work (a spawn, a follow-up, a message), keeps working, and later RECEIVES its result. Placed at its spawn,
// a helper's whole history read as recorded before the parent's own later work, so a helper's edit or failing test
// made after the parent's claim read as recorded before it (a false DECIDE). This module is the pure half of placing
// each piece of a helper's history where the parent received it, by exact recorded identity only — never by
// timestamp, position guess or resemblance:
//
//   send    -> arrival  a Codex parent's spawn_agent / followup_task / send_message call records its payload as one
//                       encrypted token in its `message` argument; the helper's own recording receives it as an
//                       `agent_message` row (NEW_TASK or MESSAGE) addressed to the helper itself, whose one
//                       `encrypted_content` block holds that very token, byte for byte. A token found in exactly one
//                       arrival row of the parent's linked helpers, and sent exactly once, is a DELIVERY. Zero or
//                       several: it links nothing and is declared. A `compacted` row's copy is never an arrival.
//   segment -> receipt  a helper's history is cut at each delivered arrival (a SEGMENT runs from its arrival to the
//                       next); each segment is placed where the parent RECEIVED the helper's result: a Codex helper's
//                       FINAL_ANSWER in the parent (the M33 F join: Sender is the helper's recorded task path, Task
//                       name the parent's own) — the first recorded after that segment's delivery that no earlier
//                       segment already took (M33 P repair: one report receives at most one assignment; a later
//                       assignment sent before an earlier one's report is SHARED: placed at the helper's next report,
//                       else — M33 P second repair — after the session's last request, declared; and a helper that
//                       reported more often than it was assigned work, or acted before a stray message, ties no report
//                       to a segment from there on: AMBIGUOUS, declared); a Claude background Agent's earliest
//                       recorded completed receipt (a typed task notification the C-02 M33 D join attaches to its launch
//                       by its call id and agentId, settling a final state, or a typed TaskOutput completion of that
//                       agentId); a synchronous Agent/Task's own result row (M33 P second repair: background or
//                       synchronous is what that result records — the launch stub is never a receipt). None recorded:
//                       the segment is placed after the session's last request, declared (adapter). A Claude agent
//                       continued after its first request is cut at its own later request (`laterRequestTurn`).
//
// The tokens live only in memory, in the slicer's side channel the loader asks for and drops: never stored, hashed,
// printed or compared by anything but string equality. Pure: no file, clock, randomness or network.

import { WORKFLOW_RECEIPT_STATUSES } from './workflow-runs.js';

/** The exact Codex names of a message to an existing helper (not a hand-off: it starts no new helper). */
export const CODEX_SEND_NAMES = Object.freeze(['send_message', 'collaboration.send_message']);
/** The inter-agent message types that carry work TO a helper (M33 F header types). */
export const ARRIVAL_MESSAGE_TYPES = Object.freeze(['NEW_TASK', 'MESSAGE']);
/** The record kind the Codex reader emits for an encrypted arrival (a token and its confirmed recipient). */
export const AGENT_ARRIVAL_RECORD = 'agent_arrival';
/** A helper's receipt is a final state only (C-02 M33 D): `stopped` proves nothing. */
export const HELPER_RECEIPT_STATUSES = WORKFLOW_RECEIPT_STATUSES;

/**
 * The closed reasons a parent's send does not split its helper's history (the ledger adapter declares each as one
 * counted `children` gap, `HELPER_DELIVERY_GAP_NOTES`, asserted equal in the tests):
 *   unmatched — its token was found in no arrival row of this recording's linked helpers;
 *   ambiguous — its token was found in several arrival rows, or several sends recorded it;
 *   conflict  — its one arrival is in another helper's recording than the one its hand-off linked (M33 P repair: the
 *               exact evidence contradicts both links, so neither helper is cut or placed: no segments for either);
 *   order     — the helper received its deliveries in another order than the parent recorded them (or the spawn's
 *               own payload arrived after another): none of that helper's deliveries splits its history;
 *   unsplit   — a follow-up linked to the helper whose delivery is not proven: the helper's history cannot be cut
 *               exactly, so it keeps the placement it had before M33 P (whole, behind its spawn);
 *   stray     — an arrival row addressed to the helper that is no delivery of its parent (a sibling's message, or a
 *               payload recorded twice): it cuts nothing, and is counted on the helper's spawn;
 *   continued — (M33 P second repair) a linked Claude Agent/Task whose own recording records a request after its first
 *               (the parent continued it: a SendMessage, a resume). No delivery identity joins that request to a parent
 *               row, and no receipt of the work after it is recorded apart from the first: its history is cut at that
 *               request of its own (`{delivery: {request: turn}}`), the rest placed by no receipt (after the session's
 *               last request), counted on its hand-off;
 *   launchUnknown — (L2) a linked Claude Agent/Task whose one result recorded no typed
 *               launch status (events.js `handOffResult`): whether the parent waited for it or received it later is not
 *               recorded, so its work is placed by no receipt, counted on its hand-off;
 *   endUnread — (D99, F1 guard) a linked Claude Agent run in the background with no receipt, whose end the slicer did
 *               not read while a later record mentions it (background-ends.js: a notification linked to it, or its
 *               agentId in a later row the agent did not write): its work is placed by no receipt, counted on its
 *               hand-off, and never said to have had none;
 *   endUnchecked — (D99, review of A1b) the same, where no later mention is established (its agentId in a row before
 *               its launch, of no shape a search is sound for, or a file that could not be read again): Sonah could not
 *               check whether the recording holds an end of it.
 */
export const HELPER_DELIVERY_REASONS = Object.freeze({
  unmatched: 'helper_delivery_unmatched',
  ambiguous: 'helper_delivery_ambiguous',
  conflict: 'helper_delivery_conflict',
  order: 'helper_delivery_order',
  unsplit: 'helper_followup_unproven',
  stray: 'helper_arrival_unmatched',
  continued: 'helper_continued_unproven',
  launchUnknown: 'helper_launch_mode_unknown',
  endUnread: 'helper_end_unread',
  endUnchecked: 'helper_end_unchecked',
});

/**
 * M33 P second repair. The turn at which a helper's own adapted recording (its redacted ledger) records a request after
 * its first — work the parent sent it later (a Claude SendMessage, a resume) that its own recording received as a new
 * human turn — or null. Read from the recording's own recorded turns only (its requests — a child's are `instructions`
 * — its actions, statements, commentary and typed marks): the lowest recorded turn after the first, the first being its
 * first request's (its lowest turn when no request is recorded). Anything unreadable counts as no turn.
 */
export function laterRequestTurn(ledger) {
  const turnsOf = (fields) => fields.flatMap((field) => (Array.isArray(ledger?.[field]) ? ledger[field] : []))
    .map((item) => item?.turn).filter((turn) => Number.isSafeInteger(turn) && turn >= 0);
  const all = turnsOf(['instructions', 'ask', 'ledger', 'sayings', 'commentary', 'marks']);
  const requests = turnsOf(['instructions', 'ask']);
  if (!all.length) return null;
  const first = Math.min(...(requests.length ? requests : all));
  const later = all.filter((turn) => turn > first);
  return later.length ? Math.min(...later) : null;
}

const count = (value, least = 0) => Number.isSafeInteger(value) && value >= least;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * A row as a receipt or an arrival records it: exactly `{turn, beforeEvent, source, record}` — the human turn the row
 * was read in, how many actions of its recording were recorded before it (the slicer's count, as a commentary block
 * records it), and the row itself (stream, one-based record). Anything else is no row (null). Never a timestamp.
 */
export function helperRow(value) {
  if (!plain(value) || Object.keys(value).length !== 4
    || !['turn', 'beforeEvent', 'source', 'record'].every((key) => Object.hasOwn(value, key))
    || !count(value.turn) || !count(value.beforeEvent) || !count(value.source) || !count(value.record, 1)) return null;
  return { turn: value.turn, beforeEvent: value.beforeEvent, source: value.source, record: value.record };
}

/** Recorded order of two rows of one lineage: its files are read in order, so (stream, record) is the order. */
export const rowAfter = (a, b) => a.source > b.source || (a.source === b.source && a.record > b.record);

/**
 * The join (pure). Inputs, all of ONE parent recording (a lineage node):
 *   sends       — its Codex sends, from the slicer's side channel: `{kind: 'delegation', callId, source, record, turn,
 *                 token}` (a spawn or follow-up hand-off) or `{kind: 'action', turn, seq, source, record, token}` (a
 *                 send_message action);
 *   delegations — its final hand-off records (the loader's links, the ledger's `delegations` order);
 *   helpers     — each LINKED Codex spawn: `{child, spawn, path, arrivals}` — the child's `children` index, the
 *                 spawn's delegation index, its recorded canonical task path (or null), and the child's own arrival
 *                 rows (`{turn, beforeEvent, source, record, token}`, each addressed to that child itself);
 *   reports     — the parent's FINAL_ANSWER rows: `{turn, beforeEvent, source, record, sender, toParent}`.
 * Returns `{ segments: [{child, segments: [{delivery, arrival?, receipt? | shared, next?}]}], losses: [{delivery,
 * reason}] }`: a delivery is `{delegation: index}` or `{action: {turn, seq}}`. Nothing is inferred: no token, no
 * arrival. M33 P repair: each report is the receipt of at most ONE segment. A segment whose first report after its
 * delivery is at or before the report an earlier segment of the same helper already took was sent before that report
 * and received by the helper after it (queued), or merged into that assignment: which, is not recorded. Its receipt is
 * not proven, so it records `shared` (the latest report an earlier segment took) and, when the helper recorded one after
 * it, `next` (that later report) — never a receipt at or before `shared`. A send proven delivered to ANOTHER linked
 * helper than its hand-off's (`conflict`) contradicts both links: neither helper's history is cut or placed (no segments).
 * M33 P second repair: a helper that reported to its parent more often than it has segments, or received a stray
 * arrival after acting on its segment's assignment, ties no report to a segment from there on (from its first segment,
 * or from the segment holding the stray): each such segment records `ambiguous: true` and no report.
 */
export function planHelperSegments({ sends = [], delegations = [], helpers = [], reports = [] } = {}) {
  const losses = [];
  const segments = [];
  const list = (value) => (Array.isArray(value) ? value : []);
  const byToken = new Map();      // token -> [{ helper, arrival }]
  for (const helper of list(helpers))
    for (const arrival of list(helper.arrivals)) {
      if (typeof arrival?.token !== 'string' || !arrival.token || !helperRow(rowOf(arrival))) continue;
      if (!byToken.has(arrival.token)) byToken.set(arrival.token, []);
      byToken.get(arrival.token).push({ helper, arrival });
    }
  const sentTimes = new Map();
  for (const send of list(sends)) if (typeof send?.token === 'string')
    sentTimes.set(send.token, (sentTimes.get(send.token) ?? 0) + 1);
  // Each send, as the delivery it is: a linked hand-off (its index) or a send action (its event).
  const joined = new Map();       // helper -> [{ delivery, row, arrival, delegation? }]
  const conflicted = new Set();   // M33 P repair: children a delivery conflict names (no segments)
  for (const send of list(sends)) {
    if (typeof send?.token !== 'string' || !count(send.source) || !count(send.record, 1)) continue;
    let delivery, delegation = null;
    if (send.kind === 'delegation') {
      const index = list(delegations).findIndex((d) => d?.adapter === 'codex' && d.source === send.source
        && d.record === send.record && d.callId === send.callId);
      // A hand-off that did not link declares its own loss (C-03): its payload proves nothing more here.
      if (index < 0 || delegations[index].status !== 'linked' || !plain(delegations[index].link)) continue;
      delivery = { delegation: index };
      delegation = delegations[index];
    } else if (send.kind === 'action' && count(send.turn) && count(send.seq)) {
      delivery = { action: { turn: send.turn, seq: send.seq } };
    } else continue;
    const found = byToken.get(send.token) ?? [];
    if (sentTimes.get(send.token) > 1 || found.length > 1) { losses.push({ delivery, reason: HELPER_DELIVERY_REASONS.ambiguous }); continue; }
    if (!found.length) { losses.push({ delivery, reason: HELPER_DELIVERY_REASONS.unmatched }); continue; }
    const [{ helper, arrival }] = found;
    if (delegation && delegation.link.source !== helper.child) {
      losses.push({ delivery, reason: HELPER_DELIVERY_REASONS.conflict });
      // M33 P repair: the exact token evidence contradicts both links — neither helper is placed by it, nor by path.
      conflicted.add(delegation.link.source);
      conflicted.add(helper.child);
      continue;
    }
    if (!joined.has(helper)) joined.set(helper, []);
    joined.get(helper).push({ delivery, row: { source: send.source, record: send.record }, arrival: rowOf(arrival),
      spawn: delegation !== null && delivery.delegation === helper.spawn });
  }
  for (const helper of list(helpers)) {
    const spawn = delegations[helper.spawn];
    if (!spawn) continue;
    const spawnRow = { source: spawn.source, record: spawn.record };
    const deliveries = [...(joined.get(helper) ?? [])].sort((a, b) => (rowAfter(a.arrival, b.arrival) ? 1 : -1));
    // An arrival addressed to this helper that is no send of its parent (a sibling's message, or a send whose payload
    // was recorded twice) does not cut its history: it is declared, once per such row, on the helper's spawn.
    const delivered = new Set(deliveries.map((item) => `${item.arrival.source}:${item.arrival.record}`));
    for (const arrival of list(helper.arrivals))
      if (helperRow(rowOf(arrival)) && !delivered.has(`${arrival.source}:${arrival.record}`))
        losses.push({ delivery: { delegation: helper.spawn }, reason: HELPER_DELIVERY_REASONS.stray });
    // Delivered in the order sent, the spawn's own payload first: anything else cuts nothing. A follow-up linked to
    // this helper whose payload did not arrive leaves the history uncuttable too. Either way the helper keeps the
    // placement it had before this rule (its whole history behind its spawn: no record), and that is declared.
    const ordered = deliveries.every((item, k) => k === 0 || (rowAfter(item.row, deliveries[k - 1].row)
      && !item.spawn && (item.arrival.turn > deliveries[k - 1].arrival.turn
        || item.arrival.turn === deliveries[k - 1].arrival.turn
        && item.arrival.beforeEvent >= deliveries[k - 1].arrival.beforeEvent)));
    const unproven = list(delegations).map((d, index) => ({ d, index })).filter(({ d, index }) => d?.kind === 'followup'
      && d.status === 'linked' && d.link?.source === helper.child
      && !deliveries.some((item) => item.delivery.delegation === index));
    if (!ordered) for (const item of deliveries) losses.push({ delivery: item.delivery, reason: HELPER_DELIVERY_REASONS.order });
    for (const { index } of unproven) losses.push({ delivery: { delegation: index }, reason: HELPER_DELIVERY_REASONS.unsplit });
    if (!ordered || unproven.length) continue;
    const first = deliveries[0]?.spawn ? deliveries.shift() : null;
    const pieces = [{ delivery: { delegation: helper.spawn }, row: spawnRow, ...(first ? { arrival: first.arrival } : {}) },
      ...deliveries.map((item) => ({ delivery: item.delivery, row: item.row, arrival: item.arrival }))];
    // This helper's reports to this parent, in recorded order (joined by its recorded task path only).
    const own = typeof helper.path === 'string' ? list(reports).filter((report) => report?.toParent === true
      && report.sender === helper.path && helperRow(rowOf(report))).sort((a, b) => (rowAfter(a, b) ? 1 : -1)) : [];
    const firstAfter = (row) => own.find((report) => rowAfter(report, row));
    // M33 P second repair: which report received which assignment is recorded by no identity once the helper received
    // a message that is no delivery of its parent after it had acted on its current assignment (a stray arrival
    // recorded after an action of the segment that holds it: it may have started another turn, and another report),
    // or reported more often than it was assigned work (a report its parent's deliveries do not account for). From the
    // segment holding such a stray on, or from the first segment, no segment takes a report: each is `ambiguous`,
    // placed with no receipt and declared. A stray recorded before any action of its segment (the helper had not yet
    // acted: the same turn's input) changes no receipt. Actions are compared by the helper's own recorded count.
    let ambiguousFrom = own.length > pieces.length ? 0 : Infinity;
    for (const arrival of list(helper.arrivals)) {
      if (!helperRow(rowOf(arrival)) || delivered.has(`${arrival.source}:${arrival.record}`)) continue;
      let holder = 0;
      for (let k = 1; k < pieces.length; k++) if (rowAfter(arrival, pieces[k].arrival)) holder = k;
      if (arrival.beforeEvent > (pieces[holder].arrival?.beforeEvent ?? 0)) ambiguousFrom = Math.min(ambiguousFrom, holder);
    }
    let taken = null;             // the latest report an earlier segment of this helper was placed at
    segments.push({ child: helper.child, segments: pieces.map(({ delivery, row, arrival }, k) => {
      const at = { delivery, ...(arrival ? { arrival } : {}) };
      if (k >= ambiguousFrom) return { ...at, ambiguous: true };
      const report = firstAfter(row);
      if (!report) return at;
      if (taken === null || rowAfter(report, taken)) {
        taken = report;
        return { ...at, receipt: rowOf(report) };
      }
      // Shared: never the report an earlier assignment took, nor any before it.
      const shared = taken;
      const next = firstAfter(shared);
      if (next) taken = next;
      return { ...at, shared: rowOf(shared), ...(next ? { next: rowOf(next) } : {}) };
    }) });
  }
  return { segments: segments.filter((record) => !conflicted.has(record.child)), losses };
}

/** The four recorded position fields of a row-like value, nothing else (a token never leaves this module). */
function rowOf(value) {
  return { turn: value?.turn, beforeEvent: value?.beforeEvent, source: value?.source, record: value?.record };
}
