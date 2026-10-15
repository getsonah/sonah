// M33 C: claims are facts (C-06 "M33 claims are facts", 2026-10-01).
//
// A chat claim is the agent's assertion that something IS true or WAS done — a completed state or an observed
// fact. The narrative prompt asks for exactly that (prompt.js), and the challengers' criteria (challenge.js v8)
// refute what is not one: a plan, an intention or a conditional, and a contradiction the agent's own statement
// already disclosed. (H3, `sonah.narrative/15`, `sonah.challenge/12`: a claim is now every statement
// about the current state or the outcome of the work, hedged or not; the challengers refute a contradicted one when its
// quoted words assert nothing about that state or outcome.)
// What code checks here, on a claim's GROUNDED receipts, before any challenger is asked:
//   - `supportCheck`: whether a claim's `supportedBy`, a result said to confirm it (recorded after it, or — owner
//     decision 2026-10-05 — before it in its own turn with no in-repository change between), grounds
//     like any receipt — only one that does is ever asked about (as its own challenge item, run-review.js), and
//     only one that item upheld makes the promise `verified`.
// M33 C recheck 2: code withholds no claim. The `claim_not_factual` opener rule and the `claim_disclosed` echo rule
// each hid true contradictions a reviewer must see ("Let's merge since all 42 tests pass"; "pytest shows FAILED
// tests/test_api.py::test_login … the login endpoint itself works correctly."), and a claim code withholds is a
// NONE no challenger can undo. No closed word list can tell a premise from a plan, or a dismissed failure from a
// disclosed one; the challengers judge both.
// The vocabularies are closed and live in ledger.js. Pure: no model, network, clock or random source; the same
// session and claim give the same answer. Never throws on model output.

import { verifyReceipt, recordedFailure } from './session.js';
import { SUPPORT_REJECTIONS, RESULT_OUTCOME_CLASSES, STOPPED_OUTCOME_FORMS, CHANGED_SINCE_LABEL, actorKeyOf,
  writeActionOf, samePathChangedBetween, resultOutcome } from './ledger.js';

const [CONTRADICTED, MALFORMED, ROLE_MISMATCH, UNSUPPLIED, UNGROUNDED, NOT_LATER, CROSS_ACTOR, FAILED_RESULT,
  NOT_SAME_TURN, STALE_RUN] = SUPPORT_REJECTIONS;
/** The typed-outcome class whose STOPPED_OUTCOME_FORMS say a call started and did not run to its end. */
const NOT_FINISHED_CLASS = RESULT_OUTCOME_CLASSES[4];
const RECEIPT_KEYS = Object.freeze(['eventId', 'role', 'quote']);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** A receipt of exactly the response contract's shape — {eventId, role, quote}, each a string, a nonempty
 *  eventId, nothing else — copied, or null. Reads one level. */
export function supportShape(value) {
  if (!plain(value) || !Object.keys(value).every((key) => RECEIPT_KEYS.includes(key))
      || typeof value.eventId !== 'string' || !value.eventId || typeof value.role !== 'string'
      || typeof value.quote !== 'string') return null;
  return { eventId: value.eventId, role: value.role, quote: value.quote };
}

/**
 * Owner decision 2026-10-05: is a result recorded BEFORE the statement stale — an in-repository change (a change row
 * not marked `outsideRepository`, of any actor: the agent's or a helper's) recorded after its run's invocation and
 * before the statement, whose action did not provably fail or get cancelled? Precision over recall: an invocation
 * code cannot find, or a change whose place in the order it cannot read, is stale too.
 * W3 F1(a) (owner decision 2026-10-13): the result of the claim actor's own write (its
 * invocation an edit or a write, ledger.js `writeActionOf`; the actor is checked before this) shows only what that
 * write did to its own paths, so only a later change to one of those typed paths makes it stale
 * (`samePathChangedBetween`: typed changes, not recorded as failed or cancelled, a path or an order it cannot read
 * counting as such a change). Before, an edit's own result was voided by a later edit of another file.
 */
/* W3 F1(b) (owner decision 2026-10-13): returns `true` when the result is stale beyond asking — its run, or the order or
 * the path of a change, cannot be read, or (F1(a)) the claim actor's own write's path changed again — else the
 * in-repository changes recorded between its run and the statement that did not provably fail or get cancelled, as
 * `[{ eventId, path }]` from their typed changes (empty: nothing changed). */
function staleRun(session, events, seen, said) {
  const run = typeof seen.invocation === 'string' ? session.event(seen.invocation) : null;
  if (!Number.isSafeInteger(run?.sequence) || run.sequence > seen.sequence) return true;
  const write = writeActionOf(session, run.id);
  if (write)
    return samePathChangedBetween(session, write, write.changes.map((change) => change?.path), said.sequence) || [];
  const since = [];
  for (const event of events) {
    if (event?.kind !== 'invocation' || !Array.isArray(event.changes)) continue;
    const inside = event.changes.filter((change) => change?.outsideRepository !== true);
    if (!inside.length) continue;
    if (!Number.isSafeInteger(event.sequence)) return true;
    if (event.sequence <= run.sequence || event.sequence >= said.sequence) continue;
    if (['failed', 'cancelled'].includes(session.actionOutcomeOf(event))) continue;
    if (inside.some((change) => !plain(change) || typeof change.path !== 'string' || !change.path)) return true;
    for (const path of new Set(inside.map((change) => change.path))) since.push({ eventId: event.id, path });
  }
  return since;
}

/** W3 F1(b): the closed label of that line (ledger.js CHANGED_SINCE_LABEL, the constants file; re-exported here for its
 *  readers). */
export { CHANGED_SINCE_LABEL };
/** The fixed lead of that line: what the list after it names. */
const CHANGED_SINCE_LEAD = 'these changes in the repository were recorded after this result\'s run and before the claim';

/**
 * W3 F1(b): the request line of a support item's `changedSince` (`[{ eventId, path }]` from typed changes, in recorded
 * order), or null when it lists none: two-space indent, CHANGED_SINCE_LABEL, the fixed lead, then each changing event
 * by `name` (the window's alias) with its paths as JSON strings, so no recorded path can break the line. Built only from
 * fixed words, event ids and typed paths; never from text a model or a recording wrote.
 */
export function changedSinceLine(changes, name = (id) => id) {
  if (!Array.isArray(changes) || !changes.length) return null;
  const byEvent = new Map();
  for (const change of changes)
    if (plain(change) && typeof change.eventId === 'string' && typeof change.path === 'string')
      byEvent.set(change.eventId, [...(byEvent.get(change.eventId) ?? []), change.path]);
  if (!byEvent.size) return null;
  const listed = [...byEvent].map(([id, paths]) => `${name(id)} ${paths.map((path) => JSON.stringify(path)).join(', ')}`);
  return `  ${CHANGED_SINCE_LABEL} ${CHANGED_SINCE_LEAD}: ${listed.join('; ')}.`;
}

/**
 * Does this claim's `supportedBy` ground like any receipt, for the window `sourceMap` shows? `{ ok: true,
 * receipt }` — the grounded receipt — or `{ ok: false, reason }` with the first SUPPORT_REJECTIONS reason. A
 * claim that also cites contradictedBy is `contradicted`: the contradiction wins. M33 C recheck: a result recorded
 * as failed or cancelled, or with a nonzero exit code, is `failed_result`; one with a human instruction recorded
 * between it and the statement, or in another recorded turn, is `not_same_turn`. Owner decision 2026-10-05: a result
 * recorded BEFORE the statement may support it only in the statement's own recorded turn (`not_same_turn`) and only
 * when no in-repository change was recorded between its run and the statement (`stale_run`). Assumes the claim's stated
 * receipt grounds (the caller checks it: a claim whose statement does not ground is withheld for its quote).
 * W3 F1(b) (owner decision 2026-10-13): with `checklist` (a session-only review, whose support items are told how to
 * judge it), an earlier result whose only fault is in-repository changes recorded since its run is not refused: it is
 * `{ ok: true, receipt, changedSince }`, the changes as `[{ eventId, path }]` (`staleRun`), and its item lists them. A
 * run, an order or a path code cannot read, and (F1(a)) an own write whose path changed again, stay `stale_run`.
 * W3 F2 (owner decision 2026-10-13): with `checklist`, a result the record says failed (`recordedFailure`) is not refused
 * `failed_result` either: it passes with `failed: true`, and its item is judged on its "outcome:" line (CLAIM_NOTE).
 * The review of W3 (2026-10-14): with `checklist`, so is a result whose typed outcome (`resultOutcome`) says its call
 * started and did not run to its end, stopped before it finished or cancelled (ledger.js STOPPED_OUTCOME_FORMS), whether
 * or not the record also says it failed: it is marked `failed: true` exactly as a failed one, counted with them
 * (`failedAsked`), and CLAIM_NOTE's criterion names its outcome line too. The typed outcome only marks; it never refuses.
 * No check above refuses on the typed outcome. D71 S2's `no_terminal_status` refused a result typed did-not-run,
 * no-terminal-status or failed-or-refused; it is removed, since whether such a result supports a claim is its challenge
 * item's to judge: such a result meets the checks above like any other, and one that passes them is asked as its own
 * challenge item; the combined route still refuses only `recordedFailure`.
 */
export function supportCheck(session, claim, sourceMap, { checklist = false } = {}) {
  try {
    if (!plain(claim)) return { ok: false, reason: MALFORMED };
    if (claim.contradictedBy) return { ok: false, reason: CONTRADICTED };
    const support = supportShape(claim.supportedBy);
    if (!support) return { ok: false, reason: MALFORMED };
    if (support.role !== 'observation') return { ok: false, reason: ROLE_MISMATCH };
    const shown = sourceMap != null && Object.hasOwn(sourceMap, support.eventId) && Array.isArray(sourceMap[support.eventId])
      ? sourceMap[support.eventId].filter((source) => source?.role === 'observation' && typeof source.text === 'string') : [];
    if (!shown.length) return { ok: false, reason: UNSUPPLIED };
    const grounded = verifyReceipt(session, support);
    if (!grounded.ok || !shown.some((source) => source.text.includes(support.quote))) return { ok: false, reason: UNGROUNDED };
    const said = session.event(claim.stated?.eventId), seen = session.event(support.eventId);
    // Owner decision 2026-10-05: a result recorded after the statement, or one recorded BEFORE it in its own turn that
    // no in-repository change made stale (below).
    if (!Number.isSafeInteger(said?.sequence) || !Number.isSafeInteger(seen?.sequence) || seen.sequence === said.sequence)
      return { ok: false, reason: NOT_LATER };
    const earlier = seen.sequence < said.sequence;
    const actors = [said, seen].map((event) => actorKeyOf(session, event));
    if (actors.includes(undefined) || actors[0] !== actors[1]) return { ok: false, reason: CROSS_ACTOR };
    // M33 C recheck: a run that failed confirms nothing, whatever line of it is quoted. H1: failed as the record
    // itself says (`recordedFailure`: a native or hook status, or a nonzero exit), never as its text reads.
    // W3 F2 (owner decision 2026-10-13): but it is the one result that can show a refusal or a failure, so on the
    // session route (`checklist`), whose challenge is told it supports only words that it failed, was refused, was
    // cancelled, was stopped or did not run, or what its output shows (CLAIM_NOTE), it is asked (`failed`); the combined
    // route refuses it as before.
    const failed = recordedFailure(seen);
    if (failed && !checklist) return { ok: false, reason: FAILED_RESULT };
    // M33 C recheck: a result recorded after a human asked for more is no confirmation the agent made in its own
    // turn — the recorded instruction only (its kind and authority, C-02), as a resolution's rule reads it — nor
    // is one of another recorded turn.
    // Owner decision 2026-10-05: an earlier result must carry the statement's own recorded turn — a turn code cannot
    // read is no leave — and no human instruction may stand between the two, in either order.
    const turn = (event) => (typeof event.turn === 'string' && event.turn ? event.turn : null);
    const events = Array.isArray(session.events) ? session.events : [];
    const [from, until] = earlier ? [seen.sequence, said.sequence] : [said.sequence, seen.sequence];
    if ((turn(said) && turn(seen) && turn(said) !== turn(seen)) || (earlier && (!turn(said) || turn(said) !== turn(seen)))
        || events.some((event) => event?.kind === 'instruction'
          && event.authority === 'human' && (Number.isSafeInteger(event.sequence)
            ? event.sequence > from && event.sequence < until : earlier))) return { ok: false, reason: NOT_SAME_TURN };
    // The review of W3 (2026-10-14): on the session route a result the recorder typed as stopped before it finished, or
    // cancelled, is marked exactly as a failed one: its item is judged by the same criterion and counted with them.
    const outcome = checklist && !failed ? resultOutcome(session, seen) : null;
    const stopped = outcome !== null && outcome.class === NOT_FINISHED_CLASS && STOPPED_OUTCOME_FORMS.includes(outcome.form);
    const marked = failed || stopped ? { failed: true } : {};
    if (!earlier) return { ok: true, receipt: grounded.receipt, ...marked };
    const since = staleRun(session, events, seen, said);
    // W3 F1(b): on the session route (`checklist`), an earlier result with changes recorded since its run is asked,
    // the changes listed beside it (`changedSince`), and its challenge item judges whether any of them can alter what
    // it shows; the combined route, whose challenge is not told so, refuses it as before.
    if (since === true || (since.length && !checklist)) return { ok: false, reason: STALE_RUN };
    return { ok: true, receipt: grounded.receipt, ...marked, ...(since.length ? { changedSince: since } : {}) };
  } catch { return { ok: false, reason: MALFORMED }; }
}
