// D153: which accusing rows the after-point re-check reads, and in which windows. A window is judged against the record
// up to its own end (D59), so an accusing row (ledger.js RECHECK_KINDS: an ask partly done or not done, a claim or a
// written statement the recording contradicts) is judged before the work that a later window of its session records.
// This module names, by structure alone, each such row, the point in the recording after which work is new to it, and
// the later windows of its own session that hold work recorded after that point: the recorded order of the events
// (`sequence`), whose session each event is (ledger.js `actorKeyOf`), and which window holds it. No word of a row or of
// an event is read; what later work means for a row is the model's, under grounding and challenge.
//
// Pure and deterministic: no model, network, clock or random source; never throws on a row's shape.

import { RECHECK_KINDS, RECHECK_OUTCOMES, actorKeyOf } from './ledger.js';
import { itemKindOf } from './triage.js';

const [, , NOT_CHECKED_AFTER_LATER_WORK, NO_LATER_WORK, NOT_PLACED] = RECHECK_OUTCOMES;

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const sequenceOf = (event) => (Number.isSafeInteger(event?.sequence) ? event.sequence : null);
const eventOf = (session, id) => (typeof id === 'string' && id && typeof session?.event === 'function'
  ? session.event(id) : null);

/** The receipt fields a row may hold, one receipt each: an ask's instruction, deliverable and shortfall; a claim's or a
 *  written statement's stated words. A row's `receipts` list holds the rest (a finding's, a written statement's). */
const RECEIPT_FIELDS = Object.freeze(['instruction', 'deliverable', 'shortfall', 'stated']);

/** Every receipt of `row` that names an event (`{ eventId }`), in field order, then its `receipts` list in order. */
export function rowReceipts(row) {
  if (!plain(row)) return [];
  return [...RECEIPT_FIELDS.map((field) => row[field]), ...list(row.receipts)]
    .filter((receipt) => plain(receipt) && typeof receipt.eventId === 'string' && receipt.eventId.length > 0);
}

/** The receipt whose event names a row's session (its subject): an ask's instruction; a claim's words, the finding's
 *  first receipt of role commentary; a written statement's stated write. Null when the row has none. */
function subjectOf(source, row) {
  if (!plain(row)) return null;
  if (source === 'requirements') return plain(row.instruction) ? row.instruction : null;
  if (source === 'findings') return list(row.receipts).find((r) => plain(r) && r.role === 'commentary') ?? null;
  if (source === 'writtenClaims') return plain(row.stated) ? row.stated : null;
  return null;
}

/**
 * D153: the after point of one row of `source` (an ITEM_SOURCES member) — the receipt of the row, among those whose
 * event has a recorded sequence, that was recorded last (`{ eventId, sequence }`) — and the session the row belongs to
 * (`actor`: `actorKeyOf` of its subject's event, null for the root session). Every receipt the row rests on was recorded
 * at or before the after point, so work recorded after it is work the row's receipts do not cover. Null when no
 * receipt names an event with a recorded sequence, or when the subject's session cannot be named. Pure.
 */
export function recheckAnchor(session, source, row) {
  const subject = eventOf(session, subjectOf(source, row)?.eventId);
  const actor = subject ? actorKeyOf(session, subject) : undefined;
  if (actor === undefined) return null;
  let anchor = null;
  for (const receipt of rowReceipts(row)) {
    const at = sequenceOf(eventOf(session, receipt.eventId));
    if (at !== null && (anchor === null || at > anchor.sequence)) anchor = { eventId: receipt.eventId, sequence: at };
  }
  return anchor === null ? null : { ...anchor, actor };
}

/** A window's events: its own `events`, or its parts' (D68 K), as windows.js `planWindows` gives them. */
const windowEvents = (window) => (Array.isArray(window?.events) ? window.events
  : list(window?.parts).flatMap((part) => list(part?.events)));

/** A window's sessions: its parts' (D68 K), or its own, as windows.js `planWindows` gives them. */
const windowSessions = (window) => (Array.isArray(window?.parts) && window.parts.length
  ? window.parts.map((part) => part?.session) : [window?.session]);

/**
 * D153: the helpers the review's windows hold, each with the event that launched it — the verified spawn assignment its
 * window's session names (windows.js `reviewSessions`, C-03), never inferred — and the last recorded sequence of its
 * events those windows hold: `Map(childId -> { launchedBy, last })`. A helper whose launch is not verified (`launchedBy`
 * null) is not one of them.
 */
function launchedHelpers(session, windows) {
  const helpers = new Map();
  for (const window of windows) for (const own of windowSessions(window)) {
    if (!plain(own) || own.helper !== true || typeof own.childId !== 'string' || !own.childId
        || typeof own.launchedBy !== 'string' || !own.launchedBy || helpers.has(own.childId)) continue;
    helpers.set(own.childId, { launchedBy: own.launchedBy, last: null });
  }
  if (!helpers.size) return helpers;
  for (const window of windows) for (const event of windowEvents(window)) {
    const at = sequenceOf(event);
    const helper = at === null ? undefined : helpers.get(actorKeyOf(session, event) ?? null);
    if (helper && (helper.last === null || at > helper.last)) helper.last = at;
  }
  return helpers;
}

/**
 * D153: the helpers of the row's session — launched by it (their verified launch is an event of the row's session) —
 * whose events the review's windows hold recorded after the row's after point: their child ids, in the order the windows
 * first name them. Where a helper's history is recorded is not where it was launched: the adapter places it where the
 * parent received the helper's work (adapters/sonah-ledger.js HELPER_RECEIPT_BOUNDARY, M33 P), so a helper launched
 * before the row (in the background, say) can have done all its work after it. What counts is that work, as the review
 * shows it. It cannot ground the row's status (an ask is delivered in its own session: checklist.js
 * `checkedRequirement`, ledger.js `oneSession`), so no window of a helper re-checks the row; but the recording holds work
 * of the row's session's own making after it, so the row is never `no_later_work`. By the verified launch and recorded
 * order alone.
 */
function laterHelpers(session, helpers, anchor) {
  const out = [];
  for (const [childId, { launchedBy, last }] of helpers)
    if (last !== null && last > anchor.sequence && actorKeyOf(session, eventOf(session, launchedBy)) === anchor.actor)
      out.push(childId);
  return out;
}

/** For each window, the first recorded sequence of each session it holds events of: `Map(actor -> sequence)`. */
function firstSequences(session, windows) {
  return windows.map((window) => {
    const first = new Map();
    for (const event of windowEvents(window)) {
      const at = sequenceOf(event);
      if (at === null) continue;
      const actor = actorKeyOf(session, event);
      if (actor === undefined) continue;
      if (!first.has(actor) || at < first.get(actor)) first.set(actor, at);
    }
    return first;
  });
}

/**
 * D153: the accusing rows among `rows` and the windows that re-check each of them, by order and window only.
 *
 * `rows`: `[{ source, index, row, kind, window }]` — `source` an ITEM_SOURCES member and `index` the row's place there
 * (both only passed through), `kind` the row's item kind when the caller names it (else `itemKindOf(source, row)`), and
 * `window` the index of the window whose answer the row is (null or absent when not known). A row whose kind is not in
 * RECHECK_KINDS is not selected. `windows`: the review's windows in review order (windows.js `planWindows`), each with
 * its events and their recorded sequences.
 *
 * A window k re-checks a row when it comes after the window that judged the row (any window, when that is not known),
 * holds events of the row's session, and every one of them was recorded after the row's after point
 * (`recheckAnchor`): the work it shows of that session is all later than every receipt the row rests on. A window of
 * another session (a helper's, for a row of the main agent) never re-checks it. A row no window re-checks is
 * `no_later_work` — unless a helper its session launched (the verified launch, `launchedBy`) has events the windows hold
 * recorded after its after point: that later work is the helper's, which cannot ground the row, so the row is
 * `not_checked_after_later_work` (`launched` names the helpers).
 *
 * Returns `{ rows, windows }`: `rows` one entry per accusing row, in the order given — `{ at, source, index, kind,
 * anchor, actor, judgedIn, later, launched, outcome }`, `at` its place in `rows`, `anchor` `{ eventId, sequence }` or
 * null, `actor` its session (null for the root, undefined when not placed), `judgedIn` the window given or null, `later`
 * the indices of the windows that re-check it, in order, `launched` the child ids of such helpers (empty when `later`
 * holds a window), and `outcome` null when `later` holds one (the row is re-checked), else a RECHECK_OUTCOMES member
 * (`not_checked_after_later_work` when `launched` holds one, `no_later_work`, or `not_placed` when `recheckAnchor`
 * places no after point); `windows[k]` the `at` of every row window k re-checks, in the order given. Pure.
 */
export function recheckSelection({ session, windows, rows }) {
  const planned = list(windows);
  const first = firstSequences(session, planned);
  const helpers = launchedHelpers(session, planned);
  const selected = [];
  const byWindow = planned.map(() => []);
  list(rows).forEach((entry, at) => {
    if (!plain(entry)) return;
    const { source, index, row } = entry;
    let kind;
    try { kind = typeof entry.kind === 'string' ? entry.kind : itemKindOf(source, row); } catch { kind = null; }
    if (!RECHECK_KINDS.includes(kind)) return;
    const judgedIn = Number.isSafeInteger(entry.window) && entry.window >= 0 ? entry.window : null;
    const anchor = recheckAnchor(session, source, row);
    if (anchor === null) {
      selected.push({ at, source, index, kind, anchor: null, actor: undefined, judgedIn, later: [], launched: [],
        outcome: NOT_PLACED });
      return;
    }
    const later = [];
    first.forEach((sequences, k) => {
      if (judgedIn !== null && k <= judgedIn) return;
      const from = sequences.get(anchor.actor);
      if (from !== undefined && from > anchor.sequence) later.push(k);
    });
    for (const k of later) byWindow[k].push(at);
    const launched = later.length ? [] : laterHelpers(session, helpers, anchor);
    selected.push({ at, source, index, kind, anchor: { eventId: anchor.eventId, sequence: anchor.sequence },
      actor: anchor.actor, judgedIn, later, launched,
      outcome: later.length ? null : launched.length ? NOT_CHECKED_AFTER_LATER_WORK : NO_LATER_WORK });
  });
  return { rows: selected, windows: byWindow };
}
