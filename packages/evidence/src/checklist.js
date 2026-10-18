// D71 (S2): the structural checks a session-only answer's checklist rows get after the model returns (owner decisions
// 2026-10-08; C-06 "D71 the checklist rows"). Code checks structure, provenance and
// verbatim evidence only — which event a receipt cites, whether its quote is literally in what the window showed, the
// recorded order, the session, and the typed outcome of a result (ledger.js `resultOutcome`, recorder fields only). What
// an ask, a claim or a line MEANS is the model's, under grounding and challenge; nothing here reads a word for meaning.
// Owner decision D71 (b): a row whose evidence does not hold is KEPT with its weakest status (not-checked) and a closed
// reason, never dropped and never shown stronger; only a row that cannot be anchored on an exact quote is left out.
//
// Pure and deterministic: no model, network, clock or random source; never throws on model output.

import { identityDigest, DIGEST_PATTERN } from '../contracts/canonical.js';
import { verifyReceipt } from './session.js';
import { oneSession, actorKeyOf, actionOutcome, resultOutcome, REQUIREMENT_STATUSES, RESTS_ON_REJECTIONS,
  RESTS_ON_OUTCOMES, NOT_COMPLETED_OUTCOMES, NOT_CLAIM_REJECTIONS, FAILURE_OUTCOMES,
  FAILURE_HANDLINGS, FAILURE_REJECTIONS, REQUIREMENT_UNCHECKED_REASONS, FAILURE_UNCHECKED_REASONS,
  UNRUN_WRITE_REASON, quotesOnlyUnrunWrite, RESTS_ON_REPAIRED, END_UNREAD_CLASS, END_UNCHECKED_FORM,
  GROUNDING_ANCHOR_CAUSES, groundingCheck, groundingRefusalFields, shownInRole } from './ledger.js';
import { closingMessages, messageLines } from './windows.js';

const [DONE, PARTLY, NOT_DONE, NOT_CHECKED] = REQUIREMENT_STATUSES;
const [MALFORMED, NOT_ACTION, OUT_OF_ORDER, CROSS_ACTOR, COMPLETED] = RESTS_ON_REJECTIONS;
const [NOT_CLAIM_MALFORMED, NOT_CLOSING, LINE_OUT_OF_RANGE] = NOT_CLAIM_REJECTIONS;
// S6 (S5 review L3): the reasons code lowers a row for, by name from their closed lists (ledger.js), never inline.
const [DELIVERABLE_UNGROUNDED, DELIVERABLE_NOT_AFTER, CHECK_NOT_COMPLETED, SHORTFALL_UNGROUNDED, , , , , ,
  CHECK_END_UNREAD, CHECK_END_UNCHECKED] = REQUIREMENT_UNCHECKED_REASONS;
const [RESPONSE_UNGROUNDED, RESPONSE_NOT_AFTER, RESPONSE_OTHER_AGENT, RESPONSE_NOT_SHOWN, TURN_END_NOT_CITED]
  = FAILURE_UNCHECKED_REASONS;

/** The regions a deliverable or a shortfall may quote. */
export const DELIVERABLE_ROLES = Object.freeze(['code', 'action', 'observation', 'commentary']);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const zeros = (list) => Object.fromEntries(list.map((reason) => [reason, 0]));
const sequenceOf = (event) => (Number.isSafeInteger(event?.sequence) ? event.sequence : null);

/** D101: a receipt through the one quote gate (ledger.js `groundingCheck`): strict (no repair), in what the window
 *  showed, within its field's bounds (QUOTE_LIMITS), and, given an `anchor` (`{ event, sameSession }`), recorded after
 *  it (and in its session, when `sameSession`). `{ ok, receipt }` or the refusal with its cause. */
const groundedIn = (session, sourceMap, value, field, roles, anchor = null) =>
  groundingCheck(session, value, { field, roles, sourceMap, anchor });
/** D101: the reason a field's anchor tests lower its row for (GROUNDING_ANCHOR_CAUSES), else the field's other one. */
const reasonOf = (refusal, notAfter, ungrounded) => (GROUNDING_ANCHOR_CAUSES.includes(refusal.cause) ? notAfter
  : ungrounded);

/**
 * The actions a row rests on (`restsOn`): each must be an ACTION its window showed, recorded after the
 * row's anchor (a requirement's instruction) or before it (a claim's statement: `before`), of the anchor's session (a
 * requirement) or its actor (a claim), whose typed outcome is did-not-run or no-terminal-status
 * (RESTS_ON_OUTCOMES) by the results recorded at or before `windowEnd` (D59; S5 review M1: never a result recorded
 * after the window, which its request was not shown). Returns `{ accepted, rejected, repaired }`: the accepted ids in
 * their cited order, de-duplicated, and every other id counted by its RESTS_ON_REJECTIONS reason. A value that is not a
 * list is one malformed id.
 * W2 (owner decision 2026-10-13; root cause 2): a cited id that is a RESULT whose recorded
 * `invocation` is an ACTION its window showed is checked as that ACTION, and accepted by the ACTION's id — recorder
 * provenance, the link the recorder typed, never a word of either event. Each such move is counted in `repaired` (the
 * report's `restsOnRepaired`), whatever the checks after it find; every check after it is unchanged. (A claim id
 * refused `not_action` can be such a RESULT, of an action that was the agent's own, recorded before the statement.)
 */
export function restsOnCheck(session, ids, { sourceMap, anchor, before = false, windowEnd = null }) {
  const accepted = [], rejected = zeros(RESTS_ON_REJECTIONS);
  let repaired = 0;
  if (ids === undefined || ids === null) return { accepted, rejected, repaired };
  for (const cited of Array.isArray(ids) ? ids : [ids]) {
    if (typeof cited !== 'string' || !cited) { rejected[MALFORMED]++; continue; }
    let id = cited;
    let event = typeof session?.event === 'function' ? session.event(id) : null;
    const action = event?.kind === 'observation' && typeof event.invocation === 'string' && event.invocation
      ? session.event(event.invocation) : null;
    if (action?.kind === 'invocation' && Object.hasOwn(sourceMap ?? {}, action.id)) {
      id = action.id; event = action; repaired++;
    }
    if (event?.kind !== 'invocation' || !Object.hasOwn(sourceMap ?? {}, id)) { rejected[NOT_ACTION]++; continue; }
    const at = sequenceOf(event), from = sequenceOf(anchor);
    if (at === null || from === null || (before ? !(at < from) : !(at > from))) { rejected[OUT_OF_ORDER]++; continue; }
    const same = before ? actorKeyOf(session, event) !== undefined && actorKeyOf(session, event) === actorKeyOf(session, anchor)
      : oneSession(session, [anchor, event]);
    if (!same) { rejected[CROSS_ACTOR]++; continue; }
    if (!RESTS_ON_OUTCOMES.includes(actionOutcome(session, event, { until: windowEnd }).class)) { rejected[COMPLETED]++; continue; }
    if (!accepted.includes(id)) accepted.push(id);
  }
  return { accepted, rejected, repaired };
}

/**
 * One session-only requirement row as code publishes it — its status checked against its receipts, structurally:
 *   - done or partly-done: `deliverable` grounds in what the window showed (at most 120 characters), was recorded after
 *     the instruction in its session, and its check completed — not a RESULT (role observation) whose typed outcome is
 *     NOT_COMPLETED_OUTCOMES, nor (S6, S5 review H2) an ACTION (role action) whose outcome, by the results recorded at
 *     or before `windowEnd` (D59), is NOT_COMPLETED_OUTCOMES; else `not-checked` with `deliverable_ungrounded`,
 *     `deliverable_not_after` or `check_not_completed`; and (D80, owner decision 2026-10-12) one that holds all of
 *     those but quotes only the body of a write the slicer parsed from a command that did not run, failed or stopped
 *     before it finished (ledger.js `unrunEnd`, `quotesOnlyUnrunWrite`, against what the window showed, by the
 *     results recorded at or before `windowEnd`) is
 *     `not-checked` with `write_command_not_run_or_failed` (UNRUN_WRITE_REASON). A shortfall is not refused so: it
 *     proves no work done, and lowering it would hide a row that says work is missing;
 *   - partly-done or not-done: `shortfall` grounds and was recorded after the instruction in its session; else
 *     `not-checked` with `shortfall_ungrounded`;
 *   - `restsOn` (`restsOnCheck`, after the instruction) keeps its accepted ids; refusals are counted, the row keeps its
 *     status.
 * Assumes the row is readable and its instruction receipt is in shape (the caller's checks). Returns `{ candidate,
 * reason, restsOnRejected, restsOnRepaired }`: `candidate` the row in the answer contract's shape with the status code
 * publishes and only the receipts that held (a not-checked row carries no deliverable or shortfall: its status needs
 * none), `reason` the REQUIREMENT_UNCHECKED_REASONS token when code lowered it (null otherwise), and (W2) the RESULT ids
 * `restsOnCheck` checked as their ACTIONs. D101 (owner decision 2026-10-17): a row lowered at the quote gate (one shared
 * gate for the deliverable and the shortfall, ledger.js `groundingCheck`: the grounding tests in GROUNDING_CAUSES order,
 * the instruction's session and then the order after it last) also returns the refusal's fields
 * (`groundingRefusalFields`): `cause`, `quotePlace` and, for a length cause, `quoteLength`. A cause of the anchor
 * (`not_anchor_session`, `not_after`) is `deliverable_not_after` for the deliverable; any other cause is
 * `deliverable_ungrounded`; every cause is `shortfall_ungrounded` for the shortfall.
 */
export function checkedRequirement(session, row, { sourceMap, windowEnd = null }) {
  const instruction = typeof session?.event === 'function' ? session.event(row?.instruction?.eventId) : null;
  const rests = restsOnCheck(session, row?.restsOn, { sourceMap, anchor: instruction, windowEnd });
  const base = { text: row.text, instruction: { eventId: row.instruction.eventId, role: row.instruction.role,
    quote: row.instruction.quote } };
  const out = (status, reason, receipts = {}, refusal = null) => ({ reason, ...groundingRefusalFields(refusal),
    restsOnRejected: rests.rejected, [RESTS_ON_REPAIRED]: rests.repaired,
    candidate: { ...base, status, ...receipts, ...(rests.accepted.length ? { restsOn: rests.accepted } : {}) } });
  const lower = (reason, refusal = null) => out(NOT_CHECKED, reason, {}, refusal);
  // Recorded after the instruction, in the instruction's session.
  const anchor = { event: instruction, sameSession: true };
  const status = row.status;
  if (!REQUIREMENT_STATUSES.includes(status) || status === NOT_CHECKED) return out(NOT_CHECKED, null);
  const receipts = {};
  if (status === DONE || status === PARTLY) {
    const check = groundedIn(session, sourceMap, row.deliverable, 'deliverable', DELIVERABLE_ROLES, anchor);
    if (!check.ok) return lower(reasonOf(check, DELIVERABLE_NOT_AFTER, DELIVERABLE_UNGROUNDED), check);
    const deliverable = check.receipt;
    // D99 (F1 guard): a check whose end Sonah could not read is lowered by its own reason, which says no absence; review
    // of A1b: by a reason of its own where no later mention of the run is established either.
    const end = deliverableEnd(session, deliverable, windowEnd);
    if (end?.class === END_UNREAD_CLASS)
      return lower(end.form === END_UNCHECKED_FORM ? CHECK_END_UNCHECKED : CHECK_END_UNREAD);
    if (end !== null) return lower(CHECK_NOT_COMPLETED);
    if (quotesOnlyUnrunWrite(session, deliverable, { sourceMap, until: windowEnd })) return lower(UNRUN_WRITE_REASON);
    receipts.deliverable = deliverable;
  }
  if (status === PARTLY || status === NOT_DONE) {
    const check = groundedIn(session, sourceMap, row.shortfall, 'shortfall', DELIVERABLE_ROLES, anchor);
    if (!check.ok) return lower(SHORTFALL_UNGROUNDED, check);
    receipts.shortfall = check.receipt;
  }
  return out(status, null, receipts);
}

/**
 * S6 (S5 review H2): did the check a done or partly-done row's deliverable cites run to an end, by its typed
 * outcome (recorder fields only)? A RESULT (role observation): its own outcome is not NOT_COMPLETED_OUTCOMES. An ACTION
 * (role action): its outcome by the results recorded at or before `windowEnd` (D59) is not NOT_COMPLETED_OUTCOMES — a
 * command, search or fetch that never came back delivers nothing. Written text (role code) is not refused here: a failed,
 * denied or interrupted edit's written text is never shown, so it cannot ground; refusing a shell write with no typed
 * status would refuse an untyped success, so that stays the challenge's). D80 refuses the body of a shell write whose command's typed end says it did not run,
 * failed or stopped before it finished (ledger.js `unrunEnd`), after this check (`checkedRequirement`). The agent's
 * words (role commentary) are not a check: the challenge judges them. D99 (F1 guard): null when it ran to an end (or is
 * no check), else its outcome (`{class, form}`, the class one of NOT_COMPLETED_OUTCOMES), so a check whose end Sonah
 * could not read is lowered by its own reason, by its form.
 */
function deliverableEnd(session, deliverable, windowEnd) {
  const event = session.event(deliverable.eventId);
  const outcome = deliverable.role === 'observation' ? resultOutcome(session, event)
    : deliverable.role === 'action' ? actionOutcome(session, event, { until: windowEnd }) : null;
  return outcome !== null && NOT_COMPLETED_OUTCOMES.includes(outcome.class) ? outcome : null;
}

/**
 * A claim's `restsOn` — the actions it rests on, each the agent's own, recorded before its statement and shown to
 * its window, whose typed outcome by the window's end is RESTS_ON_OUTCOMES (`restsOnCheck` with `before`).
 * `{ accepted, rejected, repaired }`.
 */
export function claimRestsOn(session, claim, sourceMap, windowEnd = null) {
  const anchor = typeof session?.event === 'function' && plain(claim?.stated) ? session.event(claim.stated.eventId) : null;
  return restsOnCheck(session, claim?.restsOn, { sourceMap, anchor, before: true, windowEnd });
}

/**
 * The human messages recorded in a window that a requirement row must cite — every root human instruction among
 * the window's own events (never a file the human attached, which is part of its message; never one whose words
 * redaction withheld), shown to the window as an instruction. Structure only.
 */
export function windowAsks(window, sourceMap) {
  return (Array.isArray(window?.events) ? window.events : []).filter((event) => event?.kind === 'instruction'
    && event.authority === 'human' && (event.childId ?? null) === null
    && !(Array.isArray(event.markers) && event.markers.includes('attached'))
    && shownInRole(sourceMap, event.id, 'instruction'));
}

/**
 * A window's `notClaims` entries, checked structurally: `{ eventId, lines }` naming one of its closing messages
 * (`closingMessages`) and line numbers within it. `{ accepted: Map(eventId -> Set(line)), rejected }` — each entry that
 * fails counted once by its NOT_CLAIM_REJECTIONS reason. Absent: none. A value that is not a list is one malformed entry.
 */
export function notClaimsCheck(session, window, entries) {
  const accepted = new Map(), rejected = zeros(NOT_CLAIM_REJECTIONS);
  if (entries === undefined || entries === null) return { accepted, rejected };
  const closing = new Map(closingMessages(session, window).filter((c) => c.eventId !== null).map((c) => [c.eventId, c]));
  for (const entry of Array.isArray(entries) ? entries : [entries]) {
    if (!plain(entry) || typeof entry.eventId !== 'string' || !Array.isArray(entry.lines) || !entry.lines.length
        || !entry.lines.every((line) => Number.isSafeInteger(line) && line >= 1)
        || !Object.keys(entry).every((key) => ['eventId', 'lines'].includes(key))) { rejected[NOT_CLAIM_MALFORMED]++; continue; }
    const message = closing.get(entry.eventId);
    if (!message) { rejected[NOT_CLOSING]++; continue; }
    if (entry.lines.some((line) => line > message.lines)) { rejected[LINE_OUT_OF_RANGE]++; continue; }
    if (!accepted.has(entry.eventId)) accepted.set(entry.eventId, new Set());
    for (const line of entry.lines) accepted.get(entry.eventId).add(line);
  }
  return { accepted, rejected };
}

/**
 * Closing-message coverage — for each closing message of the window, the lines inside the quote of a claim the
 * answer proposed whose stated receipt grounds there (every place the quote occurs in the message's stored text), the
 * lines an accepted `notClaims` entry lists, and the non-empty lines in neither (`closing_line_unreviewed`). `claims`
 * are the answer's claims (their `stated` receipts); `notClaims` an accepted map (`notClaimsCheck`). Positions only.
 * Returns `[{ eventId, lines, covered, listed, unreviewed, listedLines }]` — counts, the unreviewed line numbers, and
 * (S6, S5 review M4) the line numbers `notClaims` lists that no claim covers, ascending, so a reader can show both.
 */
export function closingCoverage(session, window, claims, notClaims) {
  const out = [];
  for (const closing of closingMessages(session, window)) {
    if (closing.eventId === null) continue;
    const lines = messageLines(session, session.event(closing.eventId));
    const regions = session.textRegionsOf(session.event(closing.eventId), 'text');
    const covered = new Set();
    for (const claim of Array.isArray(claims) ? claims : []) {
      const stated = plain(claim) ? claim.stated : null;
      if (!plain(stated) || stated.eventId !== closing.eventId || stated.role !== 'commentary'
          || typeof stated.quote !== 'string' || !stated.quote.length) continue;
      if (!verifyReceipt(session, { eventId: stated.eventId, role: stated.role, quote: stated.quote }).ok) continue;
      for (let at = regions.text.indexOf(stated.quote); at !== -1; at = regions.text.indexOf(stated.quote, at + 1)) {
        const until = at + stated.quote.length;
        for (const line of lines) if (line.from < until && line.until > at) covered.add(line.k);
      }
    }
    const listed = notClaims instanceof Map ? notClaims.get(closing.eventId) ?? new Set() : new Set();
    const unreviewed = lines.filter((line) => line.spans.length && !covered.has(line.k) && !listed.has(line.k))
      .map((line) => line.k);
    const listedLines = [...listed].filter((k) => !covered.has(k)).sort((a, b) => a - b);
    out.push({ eventId: closing.eventId, lines: lines.length, covered: covered.size, listed: listedLines.length, unreviewed,
      listedLines });
  }
  return out;
}

// ---- D71 (S3, owner decision D71 c): the failures the agent passed over ------------------------------------------------

const [ACTED_ON, TOLD_HUMAN, PASSED_OVER, FAILURE_NOT_CHECKED] = FAILURE_HANDLINGS;
const [FAILURE_MALFORMED, NOT_LISTED, MERGED] = FAILURE_REJECTIONS;
/** D71 (c): the regions a failure row's response may quote, by its handling. */
export const FAILURE_RESPONSE_ROLES = Object.freeze({ [ACTED_ON]: Object.freeze(['action', 'code']),
  [TOLD_HUMAN]: Object.freeze(['commentary']), [PASSED_OVER]: Object.freeze(['commentary']) });

/**
 * D71 (c): the RESULTs a window's failures step answers for — every RESULT among the window's own events (an
 * observation answering an ACTION: its `invocation` recorded) whose typed outcome (ledger.js `resultOutcome`, recorder
 * fields only) is one of FAILURE_OUTCOMES, in recorded order, as `[{ event, outcome }]`. Code lists them; what the agent
 * did about each is the answer's, checked below and judged by the challenge.
 */
export function windowFailures(session, window) {
  return (Array.isArray(window?.events) ? window.events : [])
    .filter((event) => event?.kind === 'observation' && typeof event.invocation === 'string' && event.invocation)
    .map((event) => ({ event, outcome: resultOutcome(session, event).class }))
    .filter(({ outcome }) => FAILURE_OUTCOMES.includes(outcome));
}

/** A root human message recorded strictly between two sequences: the turn changed between them (C-02 `authority`). */
const humanBetween = (session, from, until) => (Array.isArray(session?.events) ? session.events : []).some((event) =>
  event?.kind === 'instruction' && event.authority === 'human' && (event.childId ?? null) === null
  && Number.isSafeInteger(event.sequence) && event.sequence > from && event.sequence < until);

/**
 * D71 (c): one proposed failure row's handling, checked by structure only (owner decision D71 b: a handling its evidence
 * does not carry is lowered to not-checked with its closed reason, never dropped). `failure` is the listed `{ event,
 * outcome }` the row names. `{ candidate, reason }`: the row in the contract's shape (`{ eventId, handling, response? }`,
 * the response only when it held) and the FAILURE_UNCHECKED_REASONS token when code lowered it.
 *   acted-on     the response is an ACTION (role action or code) recorded after the RESULT, of the failed action's session
 *   told-human   the response is a message (role commentary) recorded after the RESULT, of the main agent: a helper's
 *                words never reach the human
 *   passed-over  the response is the first closing message (`phase: final`, "last message of its turn") of the failed
 *                action's session recorded after the RESULT, with no human message between them
 * Each response grounds strictly in what the window showed, at most 120 characters (`groundedIn`). D80 (owner
 * decision 2026-10-12): a response that holds every one of those but quotes only the body of a write the slicer parsed
 * from a command that did not run, failed or stopped before it finished (ledger.js `unrunEnd`, `quotesOnlyUnrunWrite`,
 * against what the window showed, by the results recorded at or before `windowEnd`) is lowered with
 * `write_command_not_run_or_failed` (UNRUN_WRITE_REASON): a write that may not have happened shows no action taken.
 * D101 (owner decision 2026-10-17): the response goes through the one quote gate (ledger.js `groundingCheck`, the order
 * after the RESULT last; its session is checked by handling, below); a row it lowers carries the refusal's fields
 * (`groundingRefusalFields`) beside its reason — `response_not_after` for the cause `not_after`, `response_ungrounded`
 * for any other.
 */
export function checkedFailure(session, row, failure, { sourceMap, windowEnd = null }) {
  const eventId = failure.event.id;
  const lower = (reason, refusal = null) => ({ candidate: { eventId, handling: FAILURE_NOT_CHECKED }, reason,
    ...groundingRefusalFields(refusal) });
  if (row.handling === FAILURE_NOT_CHECKED) return { candidate: { eventId, handling: FAILURE_NOT_CHECKED }, reason: null };
  const at = sequenceOf(failure.event);
  const check = groundedIn(session, sourceMap, row.response, 'response', FAILURE_RESPONSE_ROLES[row.handling],
    { event: failure.event, sameSession: false });
  if (!check.ok) return lower(reasonOf(check, RESPONSE_NOT_AFTER, RESPONSE_UNGROUNDED), check);
  const response = check.receipt;
  const said = session.event(response.eventId);
  const then = sequenceOf(said);
  const action = session.event(failure.event.invocation);
  if (row.handling === TOLD_HUMAN) {
    if (said.kind !== 'commentary' || (said.childId ?? null) !== null) return lower(RESPONSE_NOT_SHOWN);
  } else if (!action || !oneSession(session, [action, said])) return lower(RESPONSE_OTHER_AGENT);
  if (row.handling === PASSED_OVER) {
    const end = (Array.isArray(session.events) ? session.events : []).find((event) => event?.kind === 'commentary'
      && event.phase === 'final' && Number.isSafeInteger(event.sequence) && event.sequence > at
      && oneSession(session, [action, event])) ?? null;
    if (end === null || end.id !== said.id || humanBetween(session, at, then)) return lower(TURN_END_NOT_CITED);
  }
  if (quotesOnlyUnrunWrite(session, response, { sourceMap, until: windowEnd })) return lower(UNRUN_WRITE_REASON);
  return { candidate: { eventId, handling: row.handling, response }, reason: null };
}

/**
 * D71 (S3): a checked failure row's response (`candidate`, from `checkedFailure`), grounded again on the same view for
 * its published shape (`verifyReceipt`'s: the recording's session key, and a helper's child id, set from the event).
 * `{ response }`. The row's gate held the response on this view, so this holds too; should it not, `{ reason, cause?,
 * quotePlace?, quoteLength? }`, the reason `response_ungrounded` — D101: with the cause the same gate names for it
 * (`groundingRefusalFields`), so no row lowered at a quote gate goes without one. Pure.
 */
export function publishedResponse(session, candidate, { sourceMap }) {
  const check = verifyReceipt(session, candidate?.response);
  if (check.ok) return { response: check.receipt };
  const failed = typeof session?.event === 'function' ? session.event(candidate?.eventId) : null;
  return { reason: RESPONSE_UNGROUNDED, ...groundingRefusalFields(groundedIn(session, sourceMap, candidate?.response,
    'response', FAILURE_RESPONSE_ROLES[candidate?.handling] ?? [], { event: failed, sameSession: false })) };
}

/**
 * D71 (c): a window's proposed failure rows (`failures`, the answer's member) against the RESULTs code listed
 * (`windowFailures`). Each row is `{ eventId, handling, response? }` naming a listed RESULT: one of any other shape is
 * `malformed`, one naming no listed RESULT `not_listed`, a second row for one RESULT `merged` (counted, left out: nothing
 * anchors them). Every other row is checked (`checkedFailure`; D80: a command's end by the results recorded at or
 * before `windowEnd`). Absent: none. A value that is not a list is one malformed row. `{ rows: [{ candidate, reason }],
 * rejected }`, rows in the answer's order.
 */
export function failuresCheck(session, window, rows, { sourceMap, windowEnd = null }) {
  const listed = new Map(windowFailures(session, window).map((failure) => [failure.event.id, failure]));
  const out = [], rejected = zeros(FAILURE_REJECTIONS), seen = new Set();
  if (rows === undefined || rows === null) return { rows: out, rejected };
  for (const row of Array.isArray(rows) ? rows : [rows]) {
    if (!plain(row) || typeof row.eventId !== 'string' || !row.eventId || !FAILURE_HANDLINGS.includes(row.handling)
        || !Object.keys(row).every((key) => ['eventId', 'handling', 'response'].includes(key))
        || !(row.response == null || plain(row.response))) { rejected[FAILURE_MALFORMED]++; continue; }
    const failure = listed.get(row.eventId);
    if (!failure) { rejected[NOT_LISTED]++; continue; }
    if (seen.has(row.eventId)) { rejected[MERGED]++; continue; }
    seen.add(row.eventId);
    out.push(checkedFailure(session, row, failure, { sourceMap, windowEnd }));
  }
  return { rows: out, rejected };
}

// ---- D71 (S4): the id a person answers a checklist row by (`sonah decision`) ------------------------------------------

/** A ledger row id: `sha256:` and 64 lower-case hex digits — the output format of contracts/canonical.js
 *  `identityDigest` (a formal grammar: the digest's own spelling). S6 (S5 review L6): the one copy every reader imports. */
export const ROW_ID = DIGEST_PATTERN;

/**
 * D71 (S4): the id of a session-only requirement row (a checklist status, ledger.js REQUIREMENT_STATUSES) — computed from
 * the row's own merge key (run-review.js `mergeWindowOutputs`: its instruction's event and grounded quote; code's own
 * row, `codeMade`, by its event alone), never stored, so every reader and `sonah decision` compute the same id from the
 * same report. Null for a row that is not a checklist row.
 */
export function requirementRowId(row) {
  if (!plain(row) || !REQUIREMENT_STATUSES.includes(row.status) || !plain(row.instruction)
      || typeof row.instruction.eventId !== 'string') return null;
  return identityDigest('sonah.requirement-identity/1', { instruction: row.instruction.eventId,
    quote: row.codeMade === true || typeof row.instruction.quote !== 'string' ? null : row.instruction.quote });
}

/** D71 (S4): the id of a failures-section row — by the RESULT it answers for (one row per RESULT: `failuresCheck`).
 *  Computed, never stored, as `requirementRowId`. Null for a row without one. */
export function failureRowId(row) {
  if (!plain(row) || typeof row.eventId !== 'string' || !row.eventId || !FAILURE_HANDLINGS.includes(row.handling)) return null;
  return identityDigest('sonah.failure-identity/1', { result: row.eventId });
}

/**
 * D71 (S4), owner decision (h) of the page: every checklist row a person can confirm or overrule, by its id — the
 * report's decisions, findings, claims (promises) and written statements by the ledger id each carries, and its
 * checklist requirement and failure rows by the ids computed above; D87: then a code pass's findings. In the report's
 * order, each id once.
 */
export function answerableRowIds(report) {
  const rows = (key) => (Array.isArray(report?.[key]) ? report[key].filter(plain) : []);
  // D87: and the findings a code pass published (`report.codePass.findings`), by the ledger id each carries; D110: and
  // those it could not confirm (`report.codePass.unconfirmed`), which a person can confirm or overrule too.
  const codePass = ['findings', 'unconfirmed'].flatMap((key) => (Array.isArray(report?.codePass?.[key])
    ? report.codePass[key].filter(plain) : []));
  const ids = [...['decisions', 'findings', 'promises', 'writtenClaims'].flatMap((key) => rows(key).map((row) => row.id)),
    ...rows('requirements').map(requirementRowId), ...rows('failures').map(failureRowId), ...codePass.map((f) => f.id)];
  return [...new Set(ids.filter((id) => typeof id === 'string' && ROW_ID.test(id)))];
}
