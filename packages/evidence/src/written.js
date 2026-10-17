// M33 written statements (C-06, owner decision 2026-09-29).
//
// Statements the agent writes into a file — the written body of one of its own write, create or edit
// actions — are a separate proposal class, `writtenClaims`, never a chat claim. Each cites its exact
// written text with role `code` on that write action, grounded like any written-code receipt (a strict
// string search of the action's written side, as its window was shown it), and may cite a recorded
// observation said to contradict it. It is published in its own section with one closed side label
// (ledger.js WRITTEN_LABELS). It is never a finding and never changes a status; one that cannot be read
// or grounded is withheld and counted, and never makes a window or the review incomplete.
//
// Pure: no model, network, clock or random source. Code, never the model, assigns every label.

import { verifyReceipt, receiptProjection, effectOf, ACTION_EFFECTS } from './session.js';
import { identityDigest } from '../contracts/canonical.js';
import { WRITTEN_LABELS, WRITTEN_WITHHELD_CAUSES, WRITTEN_CONTRADICTION_REJECTIONS,
  RESOLUTION_CHALLENGE_OUTCOMES, UNRUN_WRITE_REASON, quotesOnlyUnrunWrite, writeActionOf, ownWrittenCheck,
  EVIDENCE_QUOTE_MAX, OWN_WRITTEN_SOURCE, SOURCE_REWRITTEN_CAUSE } from './ledger.js';

// W2: one definition of the agent's own write, in ledger.js (the `own_written` contradiction source reads it too).
export { writeActionOf };

const [UNVERIFIED, CONTRADICTED] = WRITTEN_LABELS;
const [UNREADABLE, NOT_OWN_WRITE, UNGROUNDED, NOT_LANDED] = WRITTEN_WITHHELD_CAUSES;
const [UNSUPPLIED, CONTRADICTION_UNGROUNDED, NOT_LATER, NOT_OWN_WRITTEN, SOURCE_REWRITTEN] = WRITTEN_CONTRADICTION_REJECTIONS;
const [UPHELD] = RESOLUTION_CHALLENGE_OUTCOMES;
/** W2: the contradiction source (ledger.js CONTRADICTION_SOURCES) of a written statement contradicted by code. */
const OWN_WRITTEN = OWN_WRITTEN_SOURCE;

/** The narrative key of the class, and the type and key prefix of its challenge items. */
export const WRITTEN_CHANNEL = 'writtenClaims';
export const WRITTEN_ITEM_TYPE = 'written';

/** D98 (F9): the effects (session.js ACTION_EFFECTS) the record states as a write that did not happen: refused before
 *  it ran, or failed or cancelled. */
const [NO_EFFECT, UNDONE_EFFECT] = ACTION_EFFECTS;
const ITEM_KEYS = Object.freeze(['text', 'stated', 'contradictedBy']);
const RECEIPT_KEYS = Object.freeze(['eventId', 'role', 'quote']);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** A receipt of exactly the response contract's shape and this role. Two fixed levels are read. */
const receiptOf = (value, role) => plain(value) && Object.keys(value).every((key) => RECEIPT_KEYS.includes(key))
  && typeof value.eventId === 'string' && value.eventId.length > 0 && value.role === role && typeof value.quote === 'string';

/** The roles a written statement's contradiction may quote by default: a RESULT. W2 (owner decision 2026-10-13): a
 *  session-only answer's contract also admits role code, the text the agent's own earlier write added (run-review.js
 *  reads the roles from the contract its request carried). */
export const WRITTEN_CONTRADICTION_ROLES = Object.freeze(['observation']);

/** Is `item` a written statement of exactly the response contract's shape? Closed at every level:
 *  any other field — a rating above all — makes it unreadable, never cleaned up. Its contradiction quotes one of
 *  `roles` (W2: the roles the request's contract admits). */
export function writtenShape(item, roles = WRITTEN_CONTRADICTION_ROLES) {
  return plain(item) && Object.keys(item).every((key) => ITEM_KEYS.includes(key))
    && typeof item.text === 'string' && item.text.trim().length > 0 && receiptOf(item.stated, 'code')
    && (item.contradictedBy == null || (Array.isArray(roles) ? roles : [])
      .some((role) => receiptOf(item.contradictedBy, role)));
}

/** The written bodies of one write action — the `after` side of each change, never the file as the record
 *  found it — as `session.textSpansOf` spans them. */
const writtenSpans = (session, write) => write.changes.flatMap((change) =>
  (change !== null && typeof change === 'object' ? session.textSpansOf(change, 'after') : []));

/**
 * C-06: "A chat claim whose stated receipt quotes written file content instead of commentary is
 * reclassified as this class, not unread." True only when a claim's stated receipt is role `code` on one of
 * the agent's own write actions AND its quote is an exact substring of that action's written body as its
 * window was supplied it: a written span of the action that is also a supplied `code` source of that event
 * (`sourceMap`, the window's C-05 source map). A quote of the agent's chat, of an edit's before-text or of a
 * body the window was not shown is no written content of that window: such a claim stays a chat claim —
 * one no check can read — so the re-ask and part rules apply to it. With no source map (a caller that has
 * no window), the written body alone decides. Reads two fixed levels of the claim; never throws.
 */
export function writtenChatClaim(claim, session, sourceMap = null) {
  try {
    if (!plain(claim) || !plain(claim.stated) || claim.stated.role !== 'code' || typeof claim.stated.quote !== 'string'
        || !claim.stated.quote) return false;
    const write = writeActionOf(session, claim.stated.eventId);
    if (!write) return false;
    const bodies = writtenSpans(session, write).filter((span) => typeof span === 'string' && span.includes(claim.stated.quote));
    if (!bodies.length) return false;
    if (sourceMap == null) return true;
    // M36 phase 2 (critique c4): inside one span the window showed — the body itself, or a hunk run that holds it.
    return supplied(sourceMap, claim.stated).some((source) => source.text.includes(claim.stated.quote));
  } catch { return false; }
}

/**
 * A window's source map as the narrative prompt builds it (prompt.js), for a caller that holds the window
 * but not its map: every source of every event the window shows, by event id. Only the window's own
 * events: the instruction inventory it also carries supplies no written body.
 */
export function windowSourceMap(session, window) {
  const map = Object.create(null);
  for (const event of Array.isArray(window?.events) ? window.events : [])
    if (typeof event?.id === 'string') map[event.id] = session.sourcesFor(event).map(({ role, text }) => ({ role, text }));
  return map;
}

/** A reclassified chat claim as the written statement it is. A written statement has no resolution,
 *  so a `resolvedBy` is dropped; every other field is kept for the shape check to judge. */
export function asWrittenStatement(claim) {
  const { resolvedBy: _dropped, ...statement } = claim;
  return { ...statement, contradictedBy: statement.contradictedBy ?? null };
}

/** The sources of this receipt's role that its window was shown, as the window's source map has them. */
const supplied = (sourceMap, receipt) => (sourceMap != null && Object.hasOwn(sourceMap, receipt.eventId)
  && Array.isArray(sourceMap[receipt.eventId])
  ? sourceMap[receipt.eventId].filter((source) => source?.role === receipt.role && typeof source.text === 'string') : []);

/**
 * M33 C2 repair: the written bodies of the write a written statement's stated receipt cites, as its window was shown
 * them — each a body that write wrote (`after`, never the file as the record found it) and a supplied `code` source of
 * its event — that hold the receipt's quote: the text its challenge item may show as its context (challenge.js
 * `verbatimWords`). None for a receipt on no write. Pure; never throws.
 */
export function shownWrittenBodies(session, sourceMap, receipt) {
  try {
    const write = writeActionOf(session, receipt?.eventId);
    if (!write || typeof receipt.quote !== 'string' || !receipt.quote) return [];
    if (!writtenSpans(session, write).some((span) => typeof span === 'string' && span.includes(receipt.quote))) return [];
    // M36 phase 2: the shown texts that hold it — the written body itself, or the hunk run the window showed it in.
    return supplied(sourceMap, receipt).map((source) => source.text).filter((text) => text.includes(receipt.quote));
  } catch { return []; }
}

/**
 * Read one proposed written statement against the session and its window's source map. Returns
 *   { withheld: <WRITTEN_WITHHELD_CAUSES> }                    — never published, counted;
 *   { statement: { text, stated } }                           — no contradiction proposed;
 *   { statement, ignored: <WRITTEN_CONTRADICTION_REJECTIONS> } — its contradiction failed a code check;
 *   { statement, contradiction }                              — its contradiction passed every code
 *                                                               check and may be challenged.
 * `stated` and `contradiction` are the verified receipts. Checked in the closed vocabularies' order. D80 (owner
 * decision 2026-10-12): a statement quoted only from the body of a write the slicer parsed from a command that did not
 * run, failed or stopped before it finished (ledger.js `unrunEnd`, `quotesOnlyUnrunWrite`, against what the window
 * showed, by the results recorded at or before `until`) is withheld `write_command_not_run_or_failed`
 * (UNRUN_WRITE_REASON): it may never have been written into the file.
 * W2 (owner decision 2026-10-13): where the contract admits role code (`roles`), the contradiction may be the text the
 * statement's own actor's earlier edit or write added (ledger.js `ownWrittenCheck`, the `own_written` source, with the
 * statement's write as the statement): at most EVIDENCE_QUOTE_MAX characters, shown and grounded like any receipt, else
 * `not_own_written` (it is not such text: another actor's, a write that did not run to a recorded success, removed or
 * context lines, or recorded after the statement's write) or `source_rewritten` (a later change to that path was
 * recorded before the statement's write); such a statement carries `source: 'own_written'`.
 */
export function readWrittenStatement(item, { session, sourceMap, until = null, roles = WRITTEN_CONTRADICTION_ROLES }) {
  if (!writtenShape(item, roles)) return { withheld: UNREADABLE };
  const write = writeActionOf(session, item.stated.eventId);
  if (!write) return { withheld: NOT_OWN_WRITE };
  // Grounded like any written-code receipt: the strict check, then the side it claims — the body the
  // action wrote (`after`), never the file as the record found it — as this window was shown it.
  const checked = verifyReceipt(session, item.stated);
  const written = write.changes.some((change) => session.textSpansOf(change, 'after')
    .some((span) => span.includes(item.stated.quote)));
  const shown = supplied(sourceMap, item.stated).some((source) => source.text.includes(item.stated.quote));
  if (!checked.ok || !written || !shown) return { withheld: UNGROUNDED };
  // A write the record says failed or was cancelled never put this text into a file: not a statement the
  // agent wrote into one. An unrecorded outcome is not a failure, and is declared as its own gap. D98 (F9): by the one
  // effect rule; a write refused before it ran never put it there either — a parsed write's command named first by
  // D80's reason, as before.
  const effect = effectOf(session, write);
  if (effect === UNDONE_EFFECT) return { withheld: NOT_LANDED };
  if (quotesOnlyUnrunWrite(session, checked.receipt, { sourceMap, until })) return { withheld: UNRUN_WRITE_REASON };
  if (effect === NO_EFFECT) return { withheld: NOT_LANDED };
  const statement = { text: item.text, stated: checked.receipt };
  if (item.contradictedBy == null) return { statement };
  const against = item.contradictedBy;
  const sources = supplied(sourceMap, against);
  if (!sources.length) return { statement, ignored: UNSUPPLIED };
  const grounded = verifyReceipt(session, against);
  if (!grounded.ok || !sources.some((source) => source.text.includes(against.quote)))
    return { statement, ignored: CONTRADICTION_UNGROUNDED };
  if (against.role === 'code') {
    if (against.quote.length > EVIDENCE_QUOTE_MAX) return { statement, ignored: CONTRADICTION_UNGROUNDED };
    const own = ownWrittenCheck(session, grounded.receipt, [write], { said: write.sequence, until });
    if (own !== null) return { statement, ignored: own === SOURCE_REWRITTEN_CAUSE ? SOURCE_REWRITTEN : NOT_OWN_WRITTEN };
    return { statement, contradiction: grounded.receipt, source: OWN_WRITTEN };
  }
  const at = session.event(against.eventId)?.sequence;
  if (!Number.isSafeInteger(at) || !Number.isSafeInteger(write.sequence) || at <= write.sequence)
    return { statement, ignored: NOT_LATER };
  return { statement, contradiction: grounded.receipt };
}

/** The challenge item of a statement whose contradiction passed every code check: the statement and the
 *  result said to contradict it, as proposed — nothing else about the window's narrative. */
export const writtenChallengeCandidate = (item) => ({ text: item.text, stated: { ...item.stated },
  contradictedBy: { ...item.contradictedBy } });

/** C-06 identity, like a promise's: `sonah.written-claim-identity/1` over `repo, stated, text`, the stated
 *  receipt by its C-06 projection. The label is not part of it: one statement keeps one identity. */
export function writtenClaimIdentity(repo, statement) {
  return identityDigest('sonah.written-claim-identity/1',
    { repo, stated: receiptProjection(statement.stated), text: statement.text });
}

/**
 * The published record of a read statement, given how its contradiction's challenge item ended (a
 * RESOLUTION_CHALLENGE_OUTCOMES word, or undefined when it had none). `contradicted` only when the
 * contradiction passed every code check AND its item was upheld; otherwise `unverified`, with the
 * closed reason its contradiction was not accepted, if it proposed one.
 *
 * Never throws. A statement whose identity or record cannot be computed — model text the identity digest
 * refuses, such as a lone surrogate the transport's JSON parser accepts, in its text or in a quote that
 * grounded on half of a recorded surrogate pair — is `{ record: null, rejected: null, withheld:
 * 'written_unreadable' }`: withheld and counted like any statement that cannot be read, never a failed review.
 */
export function publishedStatement(repo, read, outcome) {
  try {
    const { statement } = read;
    const upheld = read.contradiction != null && outcome === UPHELD;
    const record = { id: writtenClaimIdentity(repo, statement), stated: statement.stated, text: statement.text,
      label: upheld ? CONTRADICTED : UNVERIFIED,
      receipts: upheld ? [statement.stated, read.contradiction] : [statement.stated],
      // W2: what contradicts it, when it is not a result (absent: a result, as before), for a reader's words.
      ...(upheld && read.source === OWN_WRITTEN ? { contradictionSource: OWN_WRITTEN } : {}) };
    const rejected = read.ignored ?? (read.contradiction == null || upheld ? null
      : RESOLUTION_CHALLENGE_OUTCOMES.includes(outcome) ? outcome : 'unexecuted');
    return { record, rejected };
  } catch { return { record: null, rejected: null, withheld: UNREADABLE }; }
}
