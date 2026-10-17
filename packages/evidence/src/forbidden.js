// M33 N: an edit against a human instruction, in a session-only review (owner decision 2026-10-01; C-06 "M33 forbidden
// edits").
//
// The human said not to do something — leave it out, keep it unchanged, ignore it — and a later edit, write or command of
// the agent (or of a helper it delegated to) did it. The combined (PR) route has always published this as
// `edit_under_negative_requirement` from its joint answer; a session-only review had no route to it. Here the narrative
// proposes one (`forbiddenEdits`, prompt.js `sonah.narrative/14`): the human instruction's event and a verbatim quote of
// the constraint, the action's event and a verbatim quote of what it wrote or ran (M33 brittleness M3, `/15`: or
// removed), and optionally the agent's statement that told the human about it. Never a paraphrase as evidence.
//
// Code checks every candidate before anything is asked (`readForbiddenEdit`, fail closed, each failure one closed reason
// of ledger.js FORBIDDEN_EDIT_REJECTIONS), names every human instruction recorded between the two (shown to the
// challengers: one may lift the constraint — code never judges what words mean), and proves from the recording alone
// whether the change was undone before the turn ended (`forbiddenRevert`). The challengers then judge one proposition in
// code's fixed words (challenge.js). M33 brittleness M4, session route (owner decision 2026-10-06: "disclosed means FYI"
// on both routes): the agent's statement (`reportedBy`) is no part of the edit's own item; it is the edit's proposed
// disclosure, carried on its finding as `disclosedBy` and judged by the one disclosure step both routes share
// (challenge.js `disclosureAsks`, ledger.js `editDisclosure`). Pure: no model, network, clock or random source.

import { verifyReceipt, MIN_QUOTE_CHARS, atWordEdges, PROJECT_INSTRUCTIONS_ROLE, effectReader, ACTION_EFFECTS }
  from './session.js';
import { FORBIDDEN_EDIT_REJECTIONS, FORBIDDEN_EDIT_BREACHES, FORBIDDEN_EDIT_ITEM_TYPE,
  humanChoice, asksHuman, actorKeyOf, rootInstructionLossOf, locatedGapSequences, replacedSideComparable, wholeFileBody,
  projectFilesBefore, personsProjectFile } from './ledger.js';

/** The narrative key of the class, and the key prefix of its challenge items. */
export const FORBIDDEN_CHANNEL = 'forbiddenEdits';

/** The longest instruction or violation quote the response contract admits (a project rule: evidence quotes are at most 120
 *  characters). A frozen literal. */
export const FORBIDDEN_QUOTE_MAX_CHARS = 120;
/** The longest `text` (the model's own reading, published as the finding's explanation): C-06's explanation bound. */
export const FORBIDDEN_TEXT_MAX_CHARS = 4000;

const [MALFORMED, NOT_HUMAN, CONTEXT, INSTRUCTION_UNGROUNDED, INSTRUCTION_PARTIAL, NOT_ACTION, CARRIED,
  VIOLATION_UNGROUNDED, NOT_WRITTEN, ACTOR_UNLINKED, NOT_LANDED, NOT_AFTER, HISTORY_PARTIAL] = FORBIDDEN_EDIT_REJECTIONS;
const [WROTE, RAN, REMOVED] = FORBIDDEN_EDIT_BREACHES;

/** The review of the W1-W3 fixes (2026-10-14): the place before every recorded event (a sequence is a nonnegative
 *  integer; a project file recorded before any event has `afterSequence` -1), from which the human instructions and
 *  choices that may lift a project file's rule are counted (`readForbiddenEdit`). */
export const SESSION_START = -1;
/** C-02 operations that put a body into a file (a create is `write`), and the one that runs a command. */
const WRITE_OPERATIONS = Object.freeze(['write', 'edit']);
const COMMAND_OPERATION = 'command';
/** C-02 operations whose effect on a file is what their record holds (a delete writes no body). */
const FILE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
/** M33 N repair: the one outcome under which an action is published as done. D98 (F9): its effect (session.js
 *  `effectOf`) is `landed`: its C-02 outcome (`actionOutcomeOf`) is `succeeded`, and it was not refused before it ran. */
const [, , LANDED] = ACTION_EFFECTS;
/** M33 N repair: the recorded tool of the slicer's `read` kind (Read, Glob, Grep, a notebook or MCP read), operation
 *  `other`: nothing it does can put text into a file. */
const READ_TOOL = 'read';
const ITEM_KEYS = Object.freeze(['text', 'instruction', 'violation', 'reportedBy']);
const RECEIPT_KEYS = Object.freeze(['eventId', 'role', 'quote']);

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
/** A receipt of exactly {eventId, role, quote}, each a string, the role one of `roles`, the quote within `max`. */
const receiptOf = (value, roles, max = Infinity) => plain(value)
  && Object.keys(value).length === RECEIPT_KEYS.length && RECEIPT_KEYS.every((key) => typeof value[key] === 'string')
  && value.eventId.length > 0 && roles.includes(value.role)
  && value.quote.trim().length >= MIN_QUOTE_CHARS && value.quote.length <= max;

/**
 * Is `item` a forbidden edit of exactly the response contract's shape? Closed at its top level and in its two receipts:
 * any other field — a rating above all — makes it unreadable, never cleaned up. Its `reportedBy` is judged apart, as the
 * edit's proposed disclosure (M33 brittleness M4: a bad one is counted by DISCLOSURE_REJECTIONS, never an unreadable
 * edit), so only its presence is read here. W1 B (owner decision 2026-10-13): the instruction's role may be
 * project-instructions (a project instruction file); which source it is, `readForbiddenEdit` reads from the cited event.
 */
export function forbiddenShape(item) {
  return plain(item) && Object.keys(item).every((key) => ITEM_KEYS.includes(key))
    && typeof item.text === 'string' && item.text.trim().length > 0 && item.text.length <= FORBIDDEN_TEXT_MAX_CHARS
    && receiptOf(item.instruction, ['instruction', PROJECT_INSTRUCTIONS_ROLE], FORBIDDEN_QUOTE_MAX_CHARS)
    && receiptOf(item.violation, ['code', 'action'], FORBIDDEN_QUOTE_MAX_CHARS);
}

/** A narrative's `forbiddenEdits` as a list: none when absent or null (M33 N repair: a null member proposes nothing, as
 *  an empty list does), and one proposal no check can read when it is anything else that is not a list. */
export function forbiddenListOf(narrative) {
  const listed = plain(narrative) ? narrative[FORBIDDEN_CHANNEL] : undefined;
  return listed == null ? [] : Array.isArray(listed) ? [...listed] : [null];
}

/** The texts a window was shown of one receipt's event and role (its C-05 source map). */
const shown = (sourceMap, receipt) => (sourceMap != null && Object.hasOwn(sourceMap, receipt.eventId)
  && Array.isArray(sourceMap[receipt.eventId])
  ? sourceMap[receipt.eventId].filter((source) => source?.role === receipt.role && typeof source.text === 'string')
    .map((source) => source.text) : []);

/** M33 N repair: does a quote start and end on a word's edge (session.js `atWordEdges`, where it now lives so the one
 *  disclosure check of both routes applies it too — M33 brittleness M4 session route)? Re-exported for its readers. */
export { atWordEdges };

/** Strict grounding (no W3-3 repair): the quote is an exact substring of the cited event's text of its role, AND of a
 *  text of that role the window was shown — M33 N repair: there, starting and ending on a word's edge (`atWordEdges`).
 *  Returns the verified receipt, or null. */
function grounded(session, sourceMap, receipt) {
  let check;
  try { check = verifyReceipt(session, receipt); } catch { return null; }
  if (check?.ok !== true || !shown(sourceMap, receipt).some((text) => atWordEdges(text, receipt.quote))) return null;
  return check.receipt;
}

/** Is this the root session's instruction recorded with human authority (OWNER DECISION B's queued prompts and
 *  AskUserQuestion answers included)? A helper's brief, an agent assignment, the agent's own words are not. */
const humanInstruction = (event) => event?.kind === 'instruction' && event.authority === 'human' && event.childId == null;

/**
 * M33 N repair (C-06 "M33 forbidden edits"); M34 labels (C-02 "Slice-time labels"): is `quote`, cited from instruction
 * `event`, not the human's own statement? Read from the labels the slicer gave the instruction's blocks, never from tag
 * names: a human instruction holds only blocks the slicer labelled `human` (a block is labelled whole; a harness block is
 * never part of it), and of those, a block the human ATTACHED (`attached`: an @-mentioned file's content) is material
 * the human supplied, not words the human said. The tag-name span check this replaces (`contextElementSpans`) is
 * deleted with its tag list. Pure; reads no meaning.
 */
function harnessWords(session, event) {
  return Array.isArray(event?.markers) && event.markers.includes('attached');
}

/** Is the instruction's text recorded whole: not omitted, one complete span with words? */
function wholeText(session, event) {
  if (event.omitted === true) return false;
  const { spans, complete } = session.textSpanInfoOf(event, 'text');
  return complete === true && spans.length === 1 && typeof spans[0] === 'string' && spans[0].trim().length > 0;
}

/**
 * Every human instruction recorded strictly after sequence `from` and strictly before `until`, by id in recorded order
 * — the instructions that may have lifted the constraint, which the challengers are shown — and whether that history is
 * complete: each of them recorded whole, no event of the root session that
 * cannot be placed, no root history flag saying it is not, and no loss of the human instruction channel
 * (`rootInstructionLossOf`, the test `instructionReviewScope` applies) that is unlocated or located from `from` through
 * `until`. Pure.
 */
export function humanInstructionsBetween(session, from, until) {
  const events = Array.isArray(session?.events) ? session.events : [];
  let complete = session?.instructionHistoryComplete === undefined || session?.instructionHistoryComplete === true;
  const loss = rootInstructionLossOf(session);
  for (const gap of Array.isArray(session?.adapterGaps) ? session.adapterGaps : []) {
    if (!loss(gap)) continue;
    const named = locatedGapSequences(session, gap);
    if (named === null || named.some((sequence) => sequence >= from && sequence <= until)) complete = false;
  }
  const between = [];
  for (const event of events) {
    if (event?.childId != null) continue;
    if (!Number.isSafeInteger(event?.sequence)) { complete = false; continue; }
    if (!(event.sequence > from && event.sequence < until) || !humanInstruction(event)) continue;
    if (!wholeText(session, event)) complete = false;
    between.push(event);
  }
  return { complete, ids: between.sort((a, b) => a.sequence - b.sequence).map((event) => event.id) };
}

/**
 * M33 N repair (C-06 "M33 forbidden edits"): every root action recorded strictly after sequence `from` and strictly
 * before `until` whose result can record a choice the human made (ledger.js `humanChoice`, the recorder adapter's flag:
 * a plan the human approved), by id in recorded order — shown to the challengers, who judge whether the human lifted
 * the constraint by it. Code names them and never judges them. Pure.
 *
 * M33 brittleness L3 review: and every root action that asked the human (ledger.js `asksHuman`, the adapter's flag) that
 * no root human instruction answers (`answerTo`): the human's answer is then recorded only in that action's result —
 * every Codex question's is, since its recorder writes the answer as the call's output — so it is a choice the human
 * made, named and shown whole with its result exactly as a plan approval is. A question an instruction answers is not
 * named again: its answer is a human instruction, named by `humanInstructionsBetween` when it falls between.
 */
export function humanChoicesBetween(session, from, until) {
  const events = Array.isArray(session?.events) ? session.events : [];
  const answered = new Set(events.filter((event) => humanInstruction(event) && typeof event.answerTo === 'string'
    && event.answerTo).map((event) => event.answerTo));
  const choice = (event) => humanChoice(event) || (asksHuman(event) && !answered.has(event.id));
  return events.filter((event) => event?.childId == null && choice(event) && Number.isSafeInteger(event.sequence)
    && event.sequence > from && event.sequence < until)
    .sort((a, b) => a.sequence - b.sequence).map((event) => event.id);
}

/** Was each named choice shown to the window (its source map), with at least one recorded result, every one shown? */
function choicesShown(session, sourceMap, choices) {
  const has = (id) => sourceMap != null && Object.hasOwn(sourceMap, id);
  return choices.every((id) => {
    const results = session.events.filter((event) => event?.kind === 'observation' && event.invocation === id);
    return has(id) && results.length > 0 && results.every((result) => has(result.id));
  });
}

/** The bodies one write action wrote (`after`, never the file as the record found it), with their changes. */
const writtenBodies = (session, action) => (Array.isArray(action.changes) ? action.changes : [])
  .filter((change) => plain(change))
  .flatMap((change) => session.textSpansOf(change, 'after').map((text) => ({ change, text })));

/**
 * What the violating action did that holds the quote:
 *   `wrote`    the quote, role code, is in a body a write, create or edit wrote (as the window was shown it), and occurs
 *              more often in what it wrote to that path than in the text it replaced (`wroteMore`);
 *   `removed`  (M33 brittleness M3) the quote, role code, is in a before side of a write or edit that is recorded whole
 *              (as the window was shown it), and occurs fewer times in what it wrote to that path than in the text it
 *              replaced (`removedMore`);
 *   `ran`      the quote, role action, is in the command a command action ran.
 * Any other pairing is null (`violation_not_written`): a write's path, a before-text the change kept, a tool input, a
 * command line of a write action, a delete (M3 review: its `deleted` kind is held back — ledger.js
 * FORBIDDEN_EDIT_BREACHES), a read, a hand-off. Structure only: which side of a recorded change holds the quote, and how
 * often; never what the quote means.
 */
function breachOf(session, sourceMap, action, receipt) {
  // M36 phase 2 (critique c4): the quote lies inside one span the window showed (a body, a hunk run, a command's shown
  // head or tail); which side of the recorded change holds it is read from the change itself, as before.
  if (!shown(sourceMap, receipt).some((text) => text.includes(receipt.quote))) return null;
  if (WRITE_OPERATIONS.includes(action.operation)) {
    if (receipt.role !== 'code') return null;
    const paths = new Set(writtenBodies(session, action)
      .filter(({ text }) => text.includes(receipt.quote)).map(({ change }) => change.path));
    if ([...paths].some((path) => wroteMore(session, action, path, receipt.quote))) return WROTE;
    const replaced = new Set(changesOf(action).filter((change) => {
      const before = wholeSide(session, change, 'before');
      return before !== null && before.some((text) => text.includes(receipt.quote));
    }).map((change) => change.path));
    return [...replaced].some((path) => removedMore(session, action, path, receipt.quote)) ? REMOVED : null;
  }
  if (action.operation === COMMAND_OPERATION && receipt.role === 'action')
    return session.textSpansOf(action, 'command').some((text) => text.includes(receipt.quote)) ? RAN : null;
  return null;
}

/** An action's recorded changes that are plain objects. */
const changesOf = (action) => (Array.isArray(action.changes) ? action.changes : []).filter((change) => plain(change));

/** The actor of an action, when the recording names one this route accepts: the root (null) or a helper a verified child
 *  link attributes (its child id); undefined otherwise. */
function actorOf(session, event) {
  const actor = actorKeyOf(session, event);
  if (actor === null) return null;
  return typeof actor === 'string' && session.verifiedChildSession(actor) !== null ? actor : undefined;
}

/**
 * M33 brittleness M4, session route: was a proposed disclosure's statement supplied to the window that proposed it — its
 * event shown to the window as the agent's words (a commentary source in the window's source map)? The route's one fact
 * for the shared check's `unsupplied` (ledger.js DISCLOSURE_REJECTIONS), as the joint request's supplied events are the
 * combined route's. Event level only: whether its quote grounds is the shared check's (`ungrounded`).
 */
const disclosureShown = (sourceMap, value) => plain(value) && typeof value.eventId === 'string' && value.eventId.length > 0
  && shown(sourceMap, { eventId: value.eventId, role: 'commentary' }).length > 0;

/** Occurrences of `quote` in `text`, overlapping ones counted. */
function occurrences(text, quote) {
  let n = 0;
  for (let at = text.indexOf(quote); at !== -1; at = text.indexOf(quote, at + 1)) n++;
  return n;
}

/**
 * M33 N repair (C-06 "M33 forbidden edits"): did `action` write `quote` into `path`, rather than keep it? Over its changes
 * of that path, the quote occurs more often in what they wrote (`after`) than in the path's text they replaced (`before`:
 * an edit's replaced text, or the file as the record found it). A before side that is recorded must be recorded whole
 * (`wholeSide`), or what the change kept cannot be told apart from what it wrote; an edit with no before side recorded
 * at all is likewise unreadable. A write with none wrote its whole body. Pure.
 */
function wroteMore(session, action, path, quote) {
  const changes = (Array.isArray(action.changes) ? action.changes : []).filter((change) => plain(change) && change.path === path);
  let written = 0, kept = 0;
  for (const change of changes) {
    written += session.textSpansOf(change, 'after').reduce((n, text) => n + occurrences(text, quote), 0);
    if (!session.textSpansOf(change, 'before').length && !plain(change.beforeExtent)) {
      if (action.operation !== 'write') return false;
      continue;
    }
    const before = wholeSide(session, change, 'before');
    if (before === null) return false;
    kept += before.reduce((n, text) => n + occurrences(text, quote), 0);
  }
  return written > kept;
}

/**
 * M33 brittleness M3 (C-06 "M33 forbidden edits"): did `action` take `quote` out of `path`, rather than keep it? Over its
 * changes of that path, the quote occurs fewer times in what they wrote (`after`) than in the path's text they replaced
 * (`before`). Both sides must be recorded whole (`wholeSide`): a before side cut or redacted cannot show the quote was
 * there, and an after side cut or redacted cannot show it is gone. A change with no before side recorded at all removed
 * nothing this record shows (a create: nothing was there). The mirror of `wroteMore`, under its fail-closed rules — and
 * one more, since here a wrong comparison publishes rather than withholds (M3 review): every recorded before side must be
 * the text its own change replaced (ledger.js `replacedSideComparable`). An edit whose first change carries the whole
 * file as the record found it, beside only the edit's new text, fails closed: text it left untouched is never removed.
 * Pure.
 */
function removedMore(session, action, path, quote) {
  const changes = changesOf(action).filter((change) => change.path === path);
  let written = 0, kept = 0;
  for (const change of changes) {
    const after = wholeSide(session, change, 'after');
    if (after === null) return false;
    written += after.reduce((n, text) => n + occurrences(text, quote), 0);
    if (!session.textSpansOf(change, 'before').length && !plain(change.beforeExtent)) {
      if (action.operation !== 'write') return false;
      continue;
    }
    const before = wholeSide(session, change, 'before');
    if (before === null || !replacedSideComparable(action.operation, change)) return false;
    kept += before.reduce((n, text) => n + occurrences(text, quote), 0);
  }
  return kept > written;
}

/** A body side of a change recorded whole: recorded, not truncated, no line redacted, its refs complete. */
function wholeSide(session, change, field) {
  const extent = field === 'after' ? change.extent : change.beforeExtent;
  if (!plain(extent) || extent.recorded !== true || extent.truncated === true || (extent.redactedLines ?? 0) !== 0) return null;
  const { spans, complete } = session.textSpanInfoOf(change, field);
  return complete === true ? spans : null;
}

const touches = (event, path) => (Array.isArray(event.paths) && event.paths.some((p) => p?.path === path))
  || (Array.isArray(event.changes) && event.changes.some((change) => change?.path === path));

/**
 * M33 N repair: can what invocation `event` did to `path` NOT be read from its record? A read reads nothing in; a write,
 * create, edit or delete (never a shell-inferred one) whose every change names its path, and whose changes of `path` are
 * recorded whole (a delete writes no body), is read. Anything else — a command (`echo … >>`, `sed -i`, `git stash pop`,
 * a script), a shell-inferred write, a hand-off, any other tool, a write whose body or path is not recorded whole — can
 * have put the quote back into the file where no record shows it. Pure.
 */
function unreadEffect(session, event, path) {
  if (event.operation === 'other' && event.tool === READ_TOOL) return false;
  if (!FILE_OPERATIONS.includes(event.operation) || event.shellWriteOf) return true;
  const changes = Array.isArray(event.changes) ? event.changes : [];
  if (changes.some((change) => !plain(change) || typeof change.path !== 'string')) return true;
  const own = changes.filter((change) => change.path === path);
  if (!own.length) return touches(event, path);
  return event.operation !== 'delete' && own.some((change) => wholeSide(session, change, 'after') === null);
}
const writesQuote = (session, event, path, quote) => (Array.isArray(event.changes) ? event.changes : [])
  .some((change) => plain(change) && change.path === path
    && session.textSpansOf(change, 'after').some((text) => text.includes(quote)));

/**
 * Does `event` remove `quote` from `path`, by its recorded change? A delete of the path; a whole-file write of the path
 * whose body, recorded whole and the file's new whole state (ledger.js `wholeFileBody`), does not hold it; or an edit of
 * the path whose replaced text, recorded whole, holds it and whose new text, recorded whole, does not. M33 brittleness
 * M3 review: an edit's before side counts only when it is the text that change replaced (ledger.js
 * `replacedSideComparable`), never the whole file as the record found it.
 */
function removes(session, event, path, quote) {
  if (event.operation === 'delete') return touches(event, path);
  const changes = (Array.isArray(event.changes) ? event.changes : []).filter((change) => plain(change) && change.path === path);
  if (!changes.length) return false;
  if (event.operation === 'write')
    return changes.every((change) => { const after = wholeSide(session, change, 'after');
      return after !== null && wholeFileBody(change) && !after.some((t) => t.includes(quote)); });
  if (event.operation === 'edit')
    return changes.some((change) => {
      const before = wholeSide(session, change, 'before'), after = wholeSide(session, change, 'after');
      return before !== null && after !== null && replacedSideComparable(event.operation, change)
        && before.some((t) => t.includes(quote)) && !after.some((t) => t.includes(quote));
    }) && !changes.some((change) => session.textSpansOf(change, 'after').some((t) => t.includes(quote)));
  return false;
}

/**
 * C-06 "M33 forbidden edits": was the change undone before the turn ended? Proven only from the recording, never from
 * anything a model wrote: the violation wrote the quote exactly once, into one path, in a body recorded whole; and later,
 * in the same recorded turn, with no human instruction recorded in between, an action of the same actor whose recorded
 * outcome is succeeded removed it from that path (`removes`), with nothing writing the quote into that path again
 * before it, nor after it before the turn ended. M33 N repair: fail closed — every action of any actor recorded after the
 * violation in that turn must have an effect on files its record shows (`unreadEffect`): a command, a shell-inferred
 * write, a hand-off or another tool there leaves the undoing unproved. Returns the verified action receipt of the undoing
 * (its path, role action), or null. A command's breach is never undone by this rule: it wrote no path; nor (M33
 * brittleness M3) is a removal: what would restore it is not proved here, so it stays as recorded (its review found a
 * symmetric rule changed nothing). Pure; never throws.
 */
export function forbiddenRevert(session, action, violation, breach) {
  try {
    if (breach !== WROTE || typeof action.turn !== 'string' || !action.turn) return null;
    const holding = writtenBodies(session, action).filter(({ text }) => text.includes(violation.quote));
    const paths = new Set(holding.map(({ change }) => change.path));
    if (paths.size !== 1) return null;
    const [path] = paths;
    const change = holding[0].change;
    if (typeof path !== 'string' || holding.some((h) => h.change !== change)) return null;
    const body = wholeSide(session, change, 'after');
    if (body === null || body.reduce((n, text) => n + occurrences(text, violation.quote), 0) !== 1) return null;
    const actor = actorKeyOf(session, action);
    const later = (Array.isArray(session.events) ? session.events : [])
      .filter((event) => Number.isSafeInteger(event?.sequence) && event.sequence > action.sequence)
      .sort((a, b) => a.sequence - b.sequence);
    let undone = null;
    const effect = effectReader(session);
    for (const event of later) {
      // A human instruction ends the turn (a queued prompt or an answer included): the change was not undone of the
      // agent's own accord before it.
      if (humanInstruction(event)) break;
      // The actor's own next turn ends it; a boundary (a compaction, a helper's receipt) carries no turn of its own.
      if (event.kind !== 'boundary' && (event.childId ?? null) === (action.childId ?? null) && event.turn !== action.turn) break;
      if (event.kind !== 'invocation') continue;
      // M33 N repair: what this action did to the path must be read from its record, or nothing is proved.
      if (unreadEffect(session, event, path)) return null;
      if (!touches(event, path)) continue;
      if (writesQuote(session, event, path, violation.quote)) return null;
      if (undone === null && actorKeyOf(session, event) === actor && effect(event) === LANDED
          && removes(session, event, path, violation.quote)) undone = event;
    }
    if (undone === null) return null;
    const check = verifyReceipt(session, { eventId: undone.id, role: 'action', quote: path });
    return check.ok ? { eventId: undone.id, role: 'action', quote: path } : null;
  } catch { return null; }
}

/**
 * Read one proposed forbidden edit against the session and its window. Returns
 *   { withheld: <FORBIDDEN_EDIT_REJECTIONS> }  — never asked, never published, counted;
 *   { edit }                                   — every code check passed: it may be put to the challengers.
 * `edit` is { text, instruction, violation, breach, between, choices, disclosedBy, disclosureSupplied, revertedBy }: the
 * verified instruction and violation receipts, what the violation is (FORBIDDEN_EDIT_BREACHES: `wrote`, `ran`, or — M33
 * brittleness M3 — `removed`), every human instruction recorded between them (by id), every action between
 * them whose result can record a human choice (`humanChoicesBetween`, by id), the agent's statement about the change as
 * proposed (`reportedBy`, or null; M33 brittleness M4: the edit's proposed disclosure, never checked here — the shared
 * disclosure step checks it once the edit is upheld) and whether the window was shown it (`disclosureShown`), and the
 * code-proved undoing (`forbiddenRevert`) or null. `carried` is the set of event ids carried into the window from before
 * it; `upTo` the window's end (`windowEnd`).
 * W1 B (owner decision 2026-10-13; D83 (2) carried into step 5): the instruction may be a project instruction file the
 * main agent was given before the action — what the person wrote for the agent counts as their words. Which source it is
 * comes from the cited event (a session's `projectInstructions` entry), never from the role the model wrote: its receipt
 * takes role project-instructions, as a decision's covering receipt does (ledger.js `constraintWithSourceRole`). A file
 * given to a helper is `instruction_not_human`, and (the fourth review of the code step) so is one the session wrote
 * (ledger.js `personsProjectFile`); the file must be one `projectFilesBefore` lists for the action (shown to
 * the window whole, given to the main agent, recorded before the action; else `not_after`). Every other check is the same.
 * The review of the W1-W3 fixes (2026-10-14): the human instructions and choices that may lift a file's rule are every
 * one recorded from the session's start up to the action (`SESSION_START`), never only those after the file's place: a
 * recorder attaches the file after the first prompt of its turn (Claude Code records a CLAUDE.md after the message it
 * came with), so counting from the file's place left out the person's own ask, and an ask for exactly what the file
 * forbids could read as an edit against what they said. By order alone; what any message says is the challenge's.
 * Checked in FORBIDDEN_EDIT_REJECTIONS order; never throws (what cannot be read is `malformed`).
 */
export function readForbiddenEdit(item, { session, sourceMap, carried = new Set(), upTo = null }) {
  try {
    if (!forbiddenShape(item)) return { withheld: MALFORMED };
    const instructionEvent = session.event(item.instruction.eventId);
    const file = instructionEvent?.kind === PROJECT_INSTRUCTIONS_ROLE;
    // The fourth review of the code step: a file given to a helper, or one the session wrote, is not the person's words
    // (ledger.js `personsProjectFile`).
    if (file && !personsProjectFile(session, instructionEvent)) return { withheld: NOT_HUMAN };
    if (instructionEvent && !file && !humanInstruction(instructionEvent)) return { withheld: NOT_HUMAN };
    if (instructionEvent && !file && harnessWords(session, instructionEvent)) return { withheld: CONTEXT };
    const cited = file ? { ...item.instruction, role: PROJECT_INSTRUCTIONS_ROLE } : item.instruction;
    const instruction = instructionEvent ? grounded(session, sourceMap, cited) : null;
    if (!instruction) return { withheld: INSTRUCTION_UNGROUNDED };
    if (!wholeText(session, instructionEvent)) return { withheld: INSTRUCTION_PARTIAL };
    const action = session.event(item.violation.eventId);
    if (action && action.kind !== 'invocation') return { withheld: NOT_ACTION };
    if (action && carried.has(action.id)) return { withheld: CARRIED };
    const violation = action ? grounded(session, sourceMap, item.violation) : null;
    if (!violation) return { withheld: VIOLATION_UNGROUNDED };
    const breach = breachOf(session, sourceMap, action, item.violation);
    if (breach === null) return { withheld: NOT_WRITTEN };
    const actor = actorOf(session, action);
    if (actor === undefined) return { withheld: ACTOR_UNLINKED };
    // M33 N repair: only an outcome proved `succeeded` is an action that happened; failed, cancelled, unknown or never
    // recorded is withheld — what is not proved to have landed is never published as done.
    if (effectReader(session)(action) !== LANDED) return { withheld: NOT_LANDED };
    // W1 B: a file's place is after the event recorded before it (`afterSequence`); it must be one the window showed the
    // main agent before the action.
    const from = file ? instructionEvent.afterSequence : instructionEvent.sequence;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(action.sequence) || !(from < action.sequence)
        || (file && !projectFilesBefore(session, [action], upTo).some((listed) => listed.eventId === instructionEvent.id)))
      return { withheld: NOT_AFTER };
    // The review of the W1-W3 fixes: a file's rule may be lifted by anything the person said or chose from the
    // session's start, the message the file was attached after included; a human message's, only after it.
    const since = file ? SESSION_START : from;
    const history = humanInstructionsBetween(session, since, action.sequence);
    if (!history.complete) return { withheld: HISTORY_PARTIAL };
    // M33 N repair: a human choice between them (a plan the human approved) not shown to the window could be the lift.
    const choices = humanChoicesBetween(session, since, action.sequence);
    if (!choicesShown(session, sourceMap, choices)) return { withheld: HISTORY_PARTIAL };
    const disclosedBy = item.reportedBy ?? null;
    return { edit: { text: item.text, instruction, violation, breach, between: history.ids, choices,
      disclosedBy, disclosureSupplied: disclosedBy !== null && disclosureShown(sourceMap, disclosedBy),
      revertedBy: forbiddenRevert(session, action, violation, breach) } };
  } catch { return { withheld: MALFORMED }; }
}

/** A receipt as a challenger or a candidate is shown it: exactly {eventId, role, quote}. */
const bare = (receipt) => ({ eventId: receipt.eventId, role: receipt.role, quote: receipt.quote });

/**
 * The challenge item of an edit that passed every code check: one proposition in code's fixed words, the two verified
 * receipts, what the violation is in code's closed word (`breach`, M33 brittleness M3), every human instruction recorded
 * between them (by id), and every action between them whose result can record a human choice (by id; M33 N repair, present
 * only when there is one). Nothing the narrative model wrote about it (its `text`) is shown. M33 brittleness M4, session
 * route: nor the agent's statement about the change — it is the edit's proposed disclosure, judged as an item of its own
 * once the edit is upheld, exactly as the combined route judges a joint finding without its `disclosedBy`.
 */
export function forbiddenChallengeItem(key, edit, proposition) {
  return { key, type: FORBIDDEN_EDIT_ITEM_TYPE, candidate: { proposition, instruction: bare(edit.instruction),
    violation: bare(edit.violation), breach: edit.breach, humanInstructionsBetween: [...edit.between],
    ...(Array.isArray(edit.choices) && edit.choices.length ? { humanChoicesBetween: [...edit.choices] } : {}) } };
}

/**
 * M33 N repair: the identity of an edit that passed every code check — its two verified receipts, exactly (the identity
 * of the finding it would publish, C-06). Two proposals of one identity are one edit: asked once, counted once
 * (`merged`), whatever else they say.
 */
export const forbiddenEditIdentity = (edit) => JSON.stringify([edit.instruction.eventId, edit.instruction.role,
  edit.instruction.quote, edit.violation.eventId, edit.violation.role, edit.violation.quote]);

/** C-06 "M33 forbidden edits": the fixed words a published row's title opens with. */
export const FORBIDDEN_EDIT_TITLE = 'Did what you said not to';

/**
 * The finding candidate of an edit whose challenge item was upheld: the existing kind, scope session-effect, no anchor,
 * receipts [instruction, violation] (its identity), the route's code-built field — the code-proved undoing — beside them,
 * never among them, and (M33 brittleness M4, session route) the agent's statement about the change as proposed, as the
 * finding's proposed disclosure (`disclosedBy`, present only when one was proposed), exactly as a joint session finding
 * carries one. The ledger grounds it again (ledger.js `groundFinding`) and sets its status: DECIDE; FYI
 * `self_corrected` when the undoing grounds; else FYI `disclosed` only when the disclosure passed the shared check and
 * its own challenge item was upheld (`disclosureChallenge`, set by run-review.js).
 */
export function forbiddenFindingCandidate(edit) {
  const text = String(edit.text);
  return { origin: 'session-review', kind: 'edit_under_negative_requirement',
    title: `${FORBIDDEN_EDIT_TITLE}: ${text.slice(0, 120)}`, explanation: text, scope: 'session-effect', anchor: null,
    receipts: [bare(edit.instruction), bare(edit.violation)],
    ...(edit.disclosedBy != null ? { disclosedBy: edit.disclosedBy } : {}),
    forbiddenEdit: { ...(edit.revertedBy ? { revertedBy: bare(edit.revertedBy) } : {}) } };
}
