// The Markdown report (D97). ONE recorded session's review as GitHub Markdown, for a pull request comment
// (`gh pr comment --body-file <file>`, which posts on the pull request of the current branch and which the person
// runs: Sonah posts nothing). It renders the report model
// (report-model.js `reportModel`), the one the HTML page renders: the same sections, in the same order, with the same
// numbers and counts — the header and the count line, your prompt as a table, then Must act, Must know, Good to know
// (folded), what the agent did (folded), what Sonah could not check (folded) and the footer. This file also holds the
// facts both readers read from the recording (`storyFacts`: your messages and the asks the review tied to them, the
// steps, the changed files with their line counts, the commands) and the small text helpers they share.
//
// Pure and deterministic: no clock, no random source, no network, no model, no filesystem, no locale. Same inputs,
// same bytes out.
//
// The rules that carry the weight:
//   1. Nothing is upgraded and nothing is ruled: every word is the report model's, which reads structure only. A quote
//      is shown only when the report model found it again, literally, in the session; it alone is in quotation marks,
//      and a cut is said outside them. The session review's and the code review's own words are in italics, and the
//      footer says whose words each is.
//   2. Safe as a comment: every recorded and review-written text passes `escapeSource` (review.js: line breaks
//      flattened, `&<>` and Markdown's inline and block markers escaped; here also `~` and `$`), so no quote opens a
//      heading, a list, a table cell or a fence, closes a fold, strikes itself through or renders as math; then
//      `neutraliseMentions`, so no `@name`, `#123`, `owner/repo#123` or bare commit hash in it pings a person or links an
//      issue. Paths and commands are code spans, and an excerpt is a fence,
//      each longer than any run of backticks in it. A balanced single-backtick span of a recorded or review-written text
//      is a code span too (`backtickPieces`; the page shows it as `<code>`): inside it GitHub pings, links and renders
//      nothing. No script, no image, no colour, no alert box.
//   3. Bounded: at most `REPORT_MD_LIMITS.maxBytes` UTF-8 bytes, below GitHub's comment limit. Past it, the report is
//      shortened in a fixed order and says so once; the header, the count line, the prompt table and the visible lines
//      of Must act and Must know are never shortened.
//   4. Code links only to GitHub commit permalinks the report model built from validated local git facts (D97), each a
//      bare URL on its own line, so GitHub shows the code; where there is none, the stored excerpt is a fence.
//
// The report model imports its facts from this file and this file renders the report model: an import cycle, so nothing
// at this file's top level reads a binding of report-model.js (it is read only inside the functions).

import { verifyReceipt, effectReader, CHANGING_EFFECTS, REFUSED_DENIALS, ACTION_EFFECTS } from '../evidence/src/session.js';
import { startsSegment } from '../evidence/src/windows.js';
import { locateQuote, overlapping, sharedChars } from '../evidence/src/ask-code-links.js';
import { DISCLOSURE_REASONS, REQUIREMENT_STATUSES, LEGACY_REQUIREMENT_STATUSES, STOPPED_DENIALS, REPORT_TIERS,
  REPORT_ITEM_KINDS } from '../evidence/src/ledger.js';
import { escapeSource } from '../evidence/src/review.js';
import { INTER_AGENT_GAP_NOTES } from '../evidence/adapters/sonah-ledger.js';
import { reportModel, REPORT_LIMITS } from './report-model.js';
import { REPORT_TIER_WORDS, REPORT_TYPE_WORDS, REPORT_HEADER_WORDS, REPORT_COUNT_WORDS, REPORT_SECTION_WORDS,
  REPORT_ITEM_WORDS, REPORT_PROMPT_WORDS, REPORT_DID_WORDS, REPORT_NOT_CHECKED_WORDS, REPORT_TRIM_WORDS,
  REPORT_FOOTER_WORDS, REPORT_KIND_WORDS, REPORT_SEEN_WORDS } from './report-words.js';

/** The Markdown report's layout version. /32 (D97, owner decisions 2026-10-16): the story is now the report .md — the
 *  report model rendered for a pull request comment, in the page's order and with its counts: the header, the count
 *  line, your prompt as a table, Must act and Must know open, Good to know, what the agent did and what Sonah could not
 *  check folded, and the footer; GitHub permalinks on their own lines; no pings; at most 60,000 bytes. The story's
 *  charts, its product, lead and engineer sections and its overview are removed. (/31 and every version before it: the
 *  session story, `git log` of this file.) /33 (D98, one reading per recorder fact): its rows, its runs and the gaps it
 *  names read one effect rule (evidence session.js `effectOf`), as the page does. /34 (D99, F1 guard): a background run's
 *  end, and a stopped run, in the page's words. /35 (D100, the audit of absence sentences): an absence only where code
 *  proves it, in the page's words. /36 (D101, owner decision 2026-10-17): an ask that Sonah did not check because a
 *  test refused its quote says which test, with the numbers code measured, as the page does. /37 (D104, F5 part 4): a
 *  claim, a run and a decision you settled show their rows' shown-in-part mark under its label, as an item's evidence
 *  and an ask's lines show it. /38 (D105, F2 part A): what the code review saw short of whole, a request too large to
 *  send, and the commands left out of it for room, in the page's words; and in the same move (D107, F3a), whether an
 *  item of the repair matched a withheld finding or question, by identity, saying only what code compared, as the page
 *  says it. And (D110, the premise contract): a code finding confirmed only by code's label, with its premises; a
 *  finding Sonah could not confirm as an item to verify, each premise that Sonah could not check on a visible line; and
 *  no sentence that a second reviewer checked a finding, as the page says it. And (D111, F3b, the accounting): the
 *  items of the session review that the code review's item-by-item check (the accounting) did not examine in a way
 *  that Sonah could use, counted by kind, as the page says it; never the ones it examined; and the code review's coverage
 *  line by its own coverage (D111's second review), as the page says it. And (E1-F8, D112: one point, one item): an item's
 *  members after its own lines, as the page shows them, and the items of a section in the report model's order (by final
 *  level, then kind). */
export const STORY_VERSION = 'sonah.session-story/38';

/** The bounds of the facts this file reads: a command's text 80 code points; a line diff's input and work; the
 *  comparisons the grouping of an earlier report's asks may make. */
export const STORY_LIMITS = Object.freeze({ commandChars: 80, diffLines: 50_000, diffWork: 1_000_000,
  requirementWork: 2_000_000 });

/** M33 brittleness M4 (owner decision 2026-10-06: on both routes): the agent's statement of an edit the review published
 *  FYI `disclosed` — its upheld disclosure — or null for any other row. */
export const disclosedEdit = (f) => (f?.kind === 'edit_under_negative_requirement' && f.status === 'FYI'
  && f.disclosureReason === DISCLOSURE_REASONS[2] && typeof f.disclosedBy?.quote === 'string' ? f.disclosedBy : null);
/** A requirement row the readers read: a checklist status, or an earlier report's (ledger.js). */
const readableStatus = (status) => REQUIREMENT_STATUSES.includes(status) || LEGACY_REQUIREMENT_STATUSES.includes(status);

const HEREDOC = 'heredoc';   // the tool a shell heredoc write carries (slicer events.js SHELL_WRITES `how`)
const WRITE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
/** /16 (D79): the recorder's typed prior states of a write (redact `RECORDED_FACTS.prior`) that say the file was there
 *  before it — its record holds the file whole or as hunks — so the write is never read as a create. */
const PRIOR_HELD = Object.freeze(['file', 'hunks']);
/** /16 (owner decision D79): the members of the recorder's closed denial vocabulary that mean the call was refused
 *  before it ran, so the command did not run and is never counted among the ones that failed. D98 (F9): one list, the
 *  effect rule's (evidence session.js), re-exported here; test/d79-refusals.test.js holds it against the redactor's
 *  vocabulary. */
export { REFUSED_DENIALS };
/** D98 (F9): the effect of a call the recorder typed as refused before it ran (session.js ACTION_EFFECTS). */
const [NO_EFFECT] = ACTION_EFFECTS;
const GAP = '‹…›';   // shown where a recorded body's quotable spans are not contiguous (a cut)

// ---- text safety ------------------------------------------------------------------------------------

// D90 (owner decision 2026-10-15, privacy is not a design constraint): the session a reader is given is the one the
// reviewer model read, as recorded, and every reader renders it as it is: no text is masked for a person. What the
// helpers below do is make a text safe to show as written: `visible` (and `oneLine`, `codeSpan`, the page's
// `escapeHtml`, each built on it) shows bidi controls and invisible characters as their code points, and `clip` cuts by
// code points. Bidi controls and invisible characters could make a quote read differently from what the record holds;
// they are shown as their code point. C0 controls other than newline and tab never render.
const INVISIBLE = /[؜​‎‏‪-‮⁦-⁩﻿]/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const visible = (text) => String(text ?? '').replace(/\r\n?/g, '\n')
  .replace(INVISIBLE, (c) => `‹U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}›`)
  .replace(CONTROL, '�');
export const oneLine = (text) => visible(text).replace(/\s+/g, ' ').trim();
/** Clip to `n` code points, marking the cut. */
export function clip(text, n) {
  const whole = String(text);
  const points = [...whole];
  return points.length <= n ? whole : `${points.slice(0, Math.max(1, n - 1)).join('')}…`;
}
/** An inline code span that holds any text on one line, backticks included: its fence is longer than any run of
 *  backticks in it. */
function codeSpan(text) {
  const value = oneLine(text);
  const run = Math.max(0, ...[...value.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(run + 1);
  const pad = value.startsWith('`') || value.endsWith('`') || value.startsWith(' ') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

/** A leading `cd <dir> &&` / `cd <dir>;` segment: where a command ran, not what it did (the page drops it too). Formal
 *  grammar (D69 page audit): the shell's own — a simple command `cd` with one word (unquoted, or in single or double
 *  quotes) ended by an AND-list `&&` or the sequential separator `;` (POSIX.1-2017 XCU 2.9.3 Lists, 2.2 Quoting). */
const LEADING_CD = /^\s*cd\s+(?:"[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:&&|;)\s*/;
/** A command's text with every leading `cd <dir> &&` / `cd <dir>;` dropped (`LEADING_CD`). */
export function withoutLeadingCd(raw) {
  let text = String(raw ?? '');
  while (LEADING_CD.test(text)) text = text.replace(LEADING_CD, '');
  return text;
}
/**
 * M1: a failed command as a reader is shown it — its recorded text with any leading `cd <dir> &&` or `cd <dir>;` dropped
 * (where it ran, not what it did), on one line, clipped to `limit`; a command that is nothing but such a `cd` is shown
 * as recorded. Null only for a command with no recorded text. D90 (owner decision 2026-10-15, privacy is not a design
 * constraint): a command that names a path outside the working tree (an absolute path, a home directory, a climb out
 * with `..`) is shown by its words too; it is no longer withheld for the user name such a path can carry.
 */
export function failedCommandText(raw, limit = STORY_LIMITS.commandChars) {
  const text = withoutLeadingCd(raw);
  const shown = text.trim() ? text : String(raw ?? '');
  return shown.trim() ? clip(oneLine(shown), limit) : null;
}

// ---- line counts ------------------------------------------------------------------------------------

/** Lines of a recorded body. A final newline ends the last line; it does not start another. A CRLF line
 *  end is read as LF, so a file's line endings are never counted as changed lines. */
function splitLines(text) {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * A bounded line diff of two line arrays: `{ ops, added, removed, exact }`. `ops` is the edit script as
 * `[' ' | '-' | '+', line]` pairs. The common head and tail are trimmed first; the middle is Myers'
 * O((N+M)D) diff, stopped once its work passes `maxWork` (or the input passes `maxLines`). Stopped, it
 * falls back to multiset counts with no edit script: those are lower bounds (`exact: false`).
 */
export function diffLines(before, after, { maxWork = STORY_LIMITS.diffWork, maxLines = STORY_LIMITS.diffLines } = {}) {
  const a = Array.isArray(before) ? before : [], b = Array.isArray(after) ? after : [];
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tailA = a.length, tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) { tailA--; tailB--; }
  const A = a.slice(head, tailA), B = b.slice(head, tailB);
  const middle = A.length + B.length > maxLines ? null : myers(A, B, maxWork);
  if (middle === null) {
    const pool = new Map();
    for (const line of A) pool.set(line, (pool.get(line) ?? 0) + 1);
    let common = 0;
    for (const line of B) { const left = pool.get(line); if (left) { pool.set(line, left - 1); common++; } }
    return { ops: null, added: B.length - common, removed: A.length - common, exact: false };
  }
  const ops = [...a.slice(0, head).map((line) => [' ', line]), ...middle, ...a.slice(tailA).map((line) => [' ', line])];
  return { ops, added: ops.filter((op) => op[0] === '+').length, removed: ops.filter((op) => op[0] === '-').length, exact: true };
}

function myers(A, B, maxWork) {
  const N = A.length, M = B.length;
  if (!N) return B.map((line) => ['+', line]);
  if (!M) return A.map((line) => ['-', line]);
  const max = N + M, off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let work = 0, done = false;
  for (let d = 0; d <= max && !done; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));   // k in [-d-1, d+1], as it stood before step d
    work += 2 * d + 3;
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; work++; }
      v[off + k] = x;
      if (x >= N && y >= M) { done = true; break; }
    }
    if (!done && work > maxWork) return null;
  }
  const ops = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const snap = trace[d];
    const at = (k) => snap[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push([' ', A[x - 1]]); x--; y--; }
    if (d > 0) ops.push(x === prevX ? ['+', B[y - 1]] : ['-', A[x - 1]]);
    x = prevX; y = prevY;
  }
  return ops.reverse();
}

/** A count as printed: `≥n` (or `?` for nothing known) when the true number may be higher. */
const countWord = (n, atLeast) => (atLeast ? (n > 0 ? `≥${n}` : '?') : String(n));
export const lineWord = (c) => `+${countWord(c.added, c.addedAtLeast)} −${countWord(c.removed, c.removedAtLeast)}`;
export const inexact = (c) => c.addedAtLeast || c.removedAtLeast;
const zeroCounts = () => ({ added: 0, removed: 0, addedAtLeast: false, removedAtLeast: false });
function addCounts(into, c) {
  into.added += c.added; into.removed += c.removed;
  into.addedAtLeast ||= c.addedAtLeast; into.removedAtLeast ||= c.removedAtLeast;
  return into;
}

/** What the record says a path held after a change: deleted, a whole recorded body, or not known. */
const DELETED = Object.freeze({ deleted: true });
const UNKNOWN = Object.freeze({ unknown: true });

/** Whether a change's written body is the file's whole new state: a structured write, or a shell heredoc
 *  that replaced the file (`cat > f <<'EOF'`). Never an edit entry, an append, a new cell, or a heredoc
 *  whose unquoted delimiter let the shell expand it into text the record never saw. */
const wholeBody = (event, extent) => extent.recorded !== false && extent.priorState !== 'edit-text'
  && extent.append !== true && extent.insert !== true && extent.expanded !== true
  && (event.operation === 'write' || (event.operation === 'edit' && event.tool === HEREDOC));

/**
 * One recorded change's line counts and edit script, from recorded bodies only. `prior` is what the
 * record says the path held before this change (`undefined` when this session had not changed it yet):
 *   - a delete removes its recorded prior body (unknown when the record kept none);
 *   - a body the record does not contain counts nothing (`+? −?`);
 *   - an append or a new cell adds its body; an expanded heredoc adds at least its recorded lines;
 *   - an edit entry with its replaced segment is diffed against that segment;
 *   - a whole new body is diffed against its recorded prior file, else against the body this session last
 *     wrote to the path. It is a create (all additions) when the path was deleted before, or when it is a
 *     structured write to a path this session never changed. Otherwise its prior is unknown: its written
 *     lines are additions and its removals are `?`. The recorder keeps a prior state for a path's FIRST
 *     write only (slicer before.js), so without this a rewrite would read as a create. /16 (D79): that first
 *     write may be one that changed nothing (a shell write of a command that did not run or failed, which has
 *     no row), so a structured write the recorder typed as having a prior file (`PRIOR_HELD`) and that carries
 *     none is never a create: its removals are `?`.
 *   - an edit whose replaced text the record does not isolate counts its written lines as additions, and
 *     its removals as unknown.
 * A side the recorder cut, or the redactor dropped lines from, makes every count on it a lower bound.
 */
function changeFacts(session, event, change, prior) {
  const extent = change?.extent ?? {};
  const afterInfo = session.textSpanInfoOf(change, 'after'), beforeInfo = session.textSpanInfoOf(change, 'before');
  const afterText = afterInfo.spans.join(GAP), beforeText = beforeInfo.spans.join(GAP);
  const after = splitLines(afterText), before = splitLines(beforeText);
  const hasBefore = Array.isArray(change?.before) && change.before.length > 0;
  const afterCut = change?.truncated === true || extent.truncated === true;
  const beforeCut = change?.beforeExtent?.truncated === true;
  const afterDropped = Number(extent.redactedLines) > 0;
  const beforeDropped = Number(change?.beforeExtent?.redactedLines) > 0;
  const whole = wholeBody(event, extent);
  const state = event.operation === 'delete' ? DELETED
    : whole && !afterCut && !afterDropped && afterInfo.complete ? Object.freeze({ lines: after }) : UNKNOWN;
  const facts = (counts, ops) => ({ path: typeof change?.path === 'string' ? change.path : null,
    counts: { ...counts, addedAtLeast: counts.addedAtLeast || afterDropped, removedAtLeast: counts.removedAtLeast || beforeDropped },
    ops: ops && ops.length ? ops : null, afterText, beforeText, state });
  const unknownCounts = { added: 0, removed: 0, addedAtLeast: true, removedAtLeast: true };
  if (event.operation === 'delete') {
    return hasBefore
      ? facts({ added: 0, removed: before.length, addedAtLeast: false, removedAtLeast: beforeCut },
        beforeCut ? null : before.map((line) => ['-', line]))
      : facts({ added: 0, removed: 0, addedAtLeast: false, removedAtLeast: true }, null);
  }
  if (extent.recorded === false) return facts(unknownCounts, null);
  const additions = (removedAtLeast) => facts({ added: after.length, removed: 0, addedAtLeast: afterCut, removedAtLeast },
    after.map((line) => ['+', line]));
  if (extent.append === true || extent.insert === true) return additions(false);
  if (extent.expanded === true) return facts({ added: after.length, removed: 0, addedAtLeast: true, removedAtLeast: true }, null);
  const diffed = (from, fromCut) => {
    if (afterCut || fromCut) return facts(unknownCounts, null);
    const diff = diffLines(from, after);
    // A replace-all edit changed the segment at least once: its counts are lower bounds.
    const bound = !diff.exact || extent.replaceAll === true;
    return facts({ added: diff.added, removed: diff.removed, addedAtLeast: bound, removedAtLeast: bound }, diff.ops);
  };
  if (extent.priorState === 'edit-text') return hasBefore ? diffed(before, beforeCut) : additions(false);
  if (whole) {
    if (hasBefore) return diffed(before, beforeCut);
    if (prior === DELETED) return additions(false);
    if (prior === undefined) {
      return additions(event.operation !== 'write' || PRIOR_HELD.includes(event.recorded?.prior));
    }
    if (Array.isArray(prior.lines)) return diffed(prior.lines, false);
  }
  return additions(true);
}

// ---- the facts of a session and its report ----------------------------------------------------------

// ---- the facts of a session and its report ----------------------------------------------------------

const list = (value) => (Array.isArray(value) ? value : []);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Recorded outcomes, indexed once per render: the Session's own `observationFor` / `outcomeOf` scan every
 * event per call, which is quadratic over a long session. `result` and `outcome` are those two methods'
 * definitions over the index (the FIRST terminal observation of an invocation). `effect` is the one effect rule every
 * reader reads (D98, F9: evidence session.js `effectReader`), over one index of the session.
 */
function outcomeIndex(session, events) {
  const terminals = new Map();
  for (const event of events) {
    if (event.kind !== 'observation' || event.phase !== 'terminal' || typeof event.invocation !== 'string') continue;
    if (!terminals.has(event.invocation)) terminals.set(event.invocation, []);
    terminals.get(event.invocation).push(event);
  }
  const effect = effectReader(session);
  return {
    result: (id) => terminals.get(id)?.[0] ?? null,
    outcome: (id) => terminals.get(id)?.[0]?.result ?? 'none',
    effect: (event) => effect(event),
  };
}

/**
 * /16 (owner decision D79): how a command's record says it ended, by typed fields only. `didNotRun`: the recorder typed
 * the call as refused before it ran — its effect is none (D98, F9: the one effect rule, a REFUSED_DENIALS kind on a call
 * with a recorded result) — then it is not a failed command, whatever its result row says (Claude Code records a
 * refusal as an error result). `failed` (M1): its result `failed`
 * (only ever from a native or hook status: sonah-ledger.js), or a recorded nonzero exit — whatever command it was.
 * D80: `stopped`: the recorder typed the call with a stopped denial kind (`STOPPED_DENIALS`) — it started and did not
 * finish; neither failed nor did not run, whatever its result row says.
 */
function commandEnd(outcomes, event) {
  const result = outcomes.result(event.id);
  const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : null;
  const didNotRun = outcomes.effect(event) === NO_EFFECT;
  const stopped = STOPPED_DENIALS.includes(event.recorded?.denial);
  const failed = !didNotRun && !stopped
    && (outcomes.outcome(event.id) === 'failed' || (exitCode !== null && exitCode !== 0));
  return { exitCode, didNotRun, stopped, failed };
}

/**
 * Every write-shaped action's changes, in session order, with their line facts: event id -> rows. A write
 * the record says failed or was cancelled changed nothing and has no row. Each path's recorded state is
 * carried from one change to the next, so a rewrite is diffed against the body written before it.
 * /16 (D79): a write the slicer parsed from a command (`shellWriteOf`, a heredoc's body) has no result of its own; it
 * changed nothing when its command did not run, so it has no row and never becomes the state a later
 * write of the path is compared with — as the ledger reads it (`actionOutcome`: did-not-run), by typed outcome, never
 * by text. D98 (F9): both by the one effect rule (`outcomes.effect`): only a write whose effect could have changed the
 * file (`CHANGING_EFFECTS`: landed or unknown) has a row. D80 (owner decision 2026-10-12): one whose command failed or was stopped keeps its row, marked `unconfirmed`
 * (`failed` or `stopped`: a SHELL_WRITE_ENDS key): the record does not say whether it happened (C-02; the ledger's
 * `command-failed` and `command-stopped` forms), so after it the path's content is not known (`UNKNOWN`).
 * D98: the mark reads the call that holds the write — the command a parsed write came from, or the direct write's own
 * call — by the one typed end (`commandEnd`): a call the recorder typed as stopped (a STOPPED_DENIALS kind) marks its
 * write `stopped`, whether the write is parsed or direct (the ledger's `command-stopped` and `interrupted` forms; the
 * effect rule's `unknown`), and a command that failed marks the writes parsed from it `failed`. A direct write whose
 * own result the record proved failed or cancelled left nothing (effect `undone`) and has no row.
 */
function countedChanges(session, events, outcomes) {
  const counted = new Map();
  const state = new Map();
  const unconfirmedEnd = (event) => {
    const parsed = typeof event.shellWriteOf === 'string' && event.shellWriteOf !== '';
    const call = parsed ? session.event(event.shellWriteOf) : event;
    if (!call) return null;
    const end = commandEnd(outcomes, call);
    return parsed && end.failed ? 'failed' : end.stopped ? 'stopped' : null;
  };
  for (const event of events) {
    if (event.kind !== 'invocation' || !WRITE_OPERATIONS.includes(event.operation)
      || !CHANGING_EFFECTS.includes(outcomes.effect(event))) continue;
    const end = unconfirmedEnd(event);
    const rows = [];
    list(event.changes).forEach((change, index) => {
      if (typeof change?.path !== 'string' || !change.path) return;
      const outside = change.outsideRepository === true;
      const facts = changeFacts(session, event, change, outside ? undefined : state.get(change.path));
      if (!outside) state.set(change.path, end === null ? facts.state : UNKNOWN);
      rows.push({ event, index, helper: event.childId != null, outside, ...(end === null ? {} : { unconfirmed: end }),
        ...facts });
    });
    counted.set(event.id, rows);
  }
  return counted;
}


/** Gain I (2026-10-13): what a message carried beside its words (its event's `nonText`, by the recorder's block type):
 *  `{ pasted: { images, others } }`, or nothing when it carried none. */
const pastedOf = (event) => {
  const blocks = Array.isArray(event?.nonText) ? event.nonText : [];
  const images = blocks.filter((block) => block?.type === 'image').length;
  return blocks.length ? { pasted: { images, others: blocks.length - images } } : {};
};

/**
 * The facts of a session and its review that the readers read (the report model, report-model.js): `events`; `asks`,
 * your messages in session order — each `{ k, event, at, reply, attachments, pasted?, requirements }` — with the asks the
 * review tied to each (`requirements`, `distinctRequirements`); `unattached`, files you attached before any message;
 * `steps`, the review's steps — `{ index, n, request, events, windows, failure }`; `whole`, what the session did
 * (`stepActivity`: its commands, its changed files with their line counts, the writes not recorded as done, the files
 * changed outside the repository); and the hand-off briefs and inter-agent messages the recorder encrypted.
 *
 * /14 (owner decision D77 C): a step is one of your messages — every event the review windows hold that belongs to it
 * (`requestOfEvent`), in session order, whichever windows hold them; work before your first message is a step of its
 * own, first. /15 (owner decision D79): a file you attached to a message (the recorder's `attached` marker: the one
 * human instruction windows.js `startsSegment` keeps with its message) is no message of its own; it belongs to the
 * last of your messages recorded before it. Structure only: the recorder's labels, event order, turns and the recorded
 * hand-off links, never the words.
 */
export function storyFacts(session, report) {
  const events = list(session?.events);
  const orderOf = new Map(events.map((event, index) => [event.id, index]));
  const order = (id) => orderOf.get(id) ?? Infinity;
  const outcomes = outcomeIndex(session, events);
  const counted = countedChanges(session, events, outcomes);
  const windows = list(report?.windowResults);

  const instructions = events.filter((event) => event.kind === 'instruction' && event.authority === 'human');
  const asks = instructions.filter(startsSegment)
    // OWNER DECISION B: the human's answer to a question the agent asked (AskUserQuestion) is a reply.
    .map((event, k) => ({ k: k + 1, event, at: order(event.id), reply: typeof event.answerTo === 'string',
      attachments: [], ...pastedOf(event) }));
  const unattached = [];
  for (const event of instructions.filter((event) => !startsSegment(event))) {
    const at = order(event.id);
    const ask = asks.filter((candidate) => candidate.at <= at).at(-1);
    (ask ? ask.attachments : unattached).push({ event, at });
  }
  // A turn's message is its first one (OWNER DECISION B: an instruction recorded later within the turn — a queued
  // prompt, an answer — never takes the turn's helpers from it).
  const requestOfTurn = new Map();
  for (const ask of asks) if (typeof ask.event.turn === 'string' && !requestOfTurn.has(ask.event.turn)) requestOfTurn.set(ask.event.turn, ask.k);
  // The hand-off that launched each verified helper (a spawn, never a follow-up): the first recorded for its child.
  const launchOf = new Map();
  for (const event of events) {
    if (event.kind !== 'invocation' || event.operation !== 'delegate') continue;
    const link = session.childFor(event.id);
    if (link?.relation === 'followup' || link?.state !== 'verified' || typeof link.childId !== 'string') continue;
    if (!launchOf.has(link.childId)) launchOf.set(link.childId, event);
  }
  // The message an event belongs to: the last of your messages recorded at or before it; for a helper's event, the
  // message of the hand-off that delivered it (C-03 M33 P `deliveredBy`), else of the hand-off that launched the
  // helper. A hand-off's message is its turn's (`requestOfTurn`), else that of its own place. A cycle names none.
  const requestOfEvent = (event, seen = new Set()) => {
    if (!event || seen.has(event.id)) return null;
    seen.add(event.id);
    const helperEvent = typeof event.childId === 'string' && event.childId !== '';
    const delivering = helperEvent && typeof event.deliveredBy === 'string' && event.deliveredBy !== event.id
      ? session.event(event.deliveredBy) : null;
    const handOff = delivering ?? (helperEvent ? launchOf.get(event.childId) ?? null : null);
    if (handOff) {
      if (seen.has(handOff.id)) return null;
      return typeof handOff.turn === 'string' && requestOfTurn.has(handOff.turn) ? requestOfTurn.get(handOff.turn)
        : requestOfEvent(handOff, seen);
    }
    const at = order(event.id);
    return asks.filter((ask) => ask.at <= at).at(-1)?.k ?? null;
  };

  // The steps: each holds the events of one message the review windows hold, with the windows that hold them and the
  // failure of the first of them that failed. A message no window touches has no step.
  const held = new Map();
  windows.forEach((window, w) => {
    const ids = list(window?.eventIds).filter((id) => typeof id === 'string' && orderOf.has(id));
    for (const id of new Set(ids)) {
      if (!held.has(id)) held.set(id, { event: session.event(id), request: requestOfEvent(session.event(id)), windows: [] });
      held.get(id).windows.push(w);
    }
  });
  const byRequest = new Map();
  for (const entry of held.values()) {
    if (!byRequest.has(entry.request)) byRequest.set(entry.request, []);
    byRequest.get(entry.request).push(entry);
  }
  const stepRequests = [...(byRequest.has(null) ? [null] : []), ...asks.map((ask) => ask.k).filter((k) => byRequest.has(k))];
  const steps = stepRequests.map((request, index) => {
    const own = byRequest.get(request).sort((a, b) => order(a.event.id) - order(b.event.id));
    const stepWindows = [...new Set(own.flatMap((entry) => entry.windows))].sort((a, b) => a - b);
    return { index, n: index + 1, request, events: own.map((entry) => entry.event), windows: stepWindows,
      failure: stepWindows.map((w) => windows[w]?.failure ?? null).find((failure) => failure !== null) ?? null };
  });

  // /15 (D79): a requirement citing a file you attached is its message's.
  const kOfAsk = new Map(asks.flatMap((ask) => [[ask.event.id, ask.k],
    ...ask.attachments.map((a) => [a.event.id, ask.k])]));
  const requirements = distinctRequirements(session, report, new Set(kOfAsk.keys()));
  for (const ask of asks) ask.requirements = requirements.filter((r) => kOfAsk.get(r.ask) === ask.k);

  const whole = stepActivity(session, events, outcomes, counted);
  // M33 T: every hand-off (a spawn or a follow-up, the parent's or a transferred helper's) whose brief the recorder
  // encrypted.
  const encryptedBriefs = events.filter((event) => event.kind === 'invocation' && event.operation === 'delegate'
    && event.briefEncrypted === true).length;
  // M33 F: every inter-agent message the recorder encrypted, as the adapter declared them (this session's and each
  // transferred helper's gap); a declaration with no count is one.
  const encryptedGaps = list(session?.adapterGaps).filter((gap) => plainObject(gap) && gap.code === 'incomplete_inventory'
    && gap.channel === 'children' && gap.note === INTER_AGENT_GAP_NOTES.encrypted);
  const encryptedMessages = { n: encryptedGaps.reduce((n, gap) => n + (Number.isSafeInteger(gap.count) && gap.count > 0
    ? gap.count : 1), 0), atLeast: encryptedGaps.some((gap) => !(Number.isSafeInteger(gap.count) && gap.count > 0)) };
  return { events, steps, asks, unattached, whole, encryptedBriefs, encryptedMessages };
}

/** A requirement's text as compared, for rows whose quote cannot be located: case, whitespace and punctuation
 *  do not make another requirement. */
const requirementKey = (eventId, text) => JSON.stringify([eventId,
  String(text).toLowerCase().replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim()]);
/** How unevenly a wording reads beside the others: a lower-case first letter, a closing period. */
const untidy = (text) => { const line = oneLine(text); return Number(/^\p{Ll}/u.test(line)) + Number(/\.$/.test(line)); };
/** Requirement statuses, least addressed first. D71 (S2): with the checklist's, a not-checked row before a done one. */
const REQUIREMENT_ORDER = Object.freeze(['open', 'not-done', 'partly-addressed', 'partly-done', 'not-checked', 'addressed', 'done']);
const leastAddressed = (rows) => REQUIREMENT_ORDER.find((status) => rows.some((row) => row.r.status === status));
// Where a grounded instruction quote sits in its instruction (`locateQuote`) and whether two such places overlap by half
// the shorter (`overlapping`): the evidence package's (ask-code-links.js), so the code step's links to an ask and "Cited
// in" read one rule; exported from here as before.
export { locateQuote, overlapping };
/** The share of the words two located quotes cover together that both cover (0 when they share none). */
const sameWords = (a, b) => Math.max(0, sharedChars(a, b)) / (Math.max(a.until, b.until) - Math.min(a.from, b.from));

/**
 * The review's requirement rows, grouped into requirements. `batches` are lists of rows no two of which are one
 * requirement: a review window's proposals (a window proposes each requirement once), or one report row each.
 *
 * A located row continues a requirement of an EARLIER batch, of the same instruction span, only when its quote
 * shares words with every quote of that requirement and overlaps at least one of them by at least half of the
 * shorter: so two quotes that share no word are never one requirement, whatever quote lies between them. Each
 * requirement is continued by at most one row of a batch. Rows and requirements are matched best first: the most
 * words in common between the quotes (the share both cover), then row and requirement order. When the best match of
 * a row, or for a requirement, ties with another, nothing tells which it is: the row starts a requirement of its own,
 * and a requirement two rows tie for is not continued in that batch. (L6: no wording
 * similarity breaks such a tie — the English stop-word Dice score, `alike`, that did is deleted.) A row that
 * continues nothing starts a requirement. A row a batch holds twice, at the same place, is one.
 *
 * A row whose quote cannot be located joins, by its text as compared (`requirementKey`), the first requirement
 * that holds a located row with that text, else the first one without a location that has it. So does every row
 * of the batches after the matching has done `STORY_LIMITS.requirementWork` comparisons: a review whose rows fit
 * many requirements equally, window after window, cannot make the story slow, and text grouping never merges two
 * wordings, so it can only show more rows, never fewer.
 */
function groupRequirements(batches, spansOf) {
  const groups = [];
  const bySpan = new Map();
  const place = (row) => JSON.stringify([row.ask, row.at.span]);
  const start = (row) => {
    const group = { n: groups.length, ask: row.ask, members: [], quotes: [], batches: new Set(),
      minUntil: Infinity, maxFrom: -Infinity };
    groups.push(group);
    if (row.at) {
      if (!bySpan.has(place(row))) bySpan.set(place(row), []);
      bySpan.get(place(row)).push(group);
    }
    return group;
  };
  const join = (group, row) => {
    group.members.push(row);
    group.batches.add(row.batch);
    if (row.at) {
      if (!group.quotes.some((q) => q.span === row.at.span && q.from === row.at.from && q.until === row.at.until)) group.quotes.push(row.at);
      group.minUntil = Math.min(group.minUntil, row.at.until);
      group.maxFrom = Math.max(group.maxFrom, row.at.from);
    }
  };
  const score = (row, group) => {
    // Shares words with every quote (the quotes of a requirement all share a place: that place is inside
    // [maxFrom, minUntil)), and overlaps one by half.
    if (group.batches.has(row.batch) || row.at.from >= group.minUntil || row.at.until <= group.maxFrom) return null;
    if (!group.quotes.some((q) => overlapping(row.at, q))) return null;
    return { q: group.quotes.reduce((n, q) => Math.max(n, sameWords(row.at, q)), 0) };
  };
  let work = 0;
  const unmatched = new Set();
  batches.forEach((rows, batch) => {
    // Past the work bound, a batch's rows are grouped by their text as compared, like rows without a location.
    if (work > STORY_LIMITS.requirementWork) for (const row of rows) if (row.at) unmatched.add(row);
    // A row one batch holds twice (the same text as compared, at the same place) is one row: it goes where the
    // first goes.
    const firstAt = new Map();
    const echoes = [];
    const located = rows.filter((row) => {
      if (!row.at || unmatched.has(row)) return false;
      const same = JSON.stringify([row.key, row.at.span, row.at.from, row.at.until]);
      if (firstAt.has(same)) { echoes.push([row, firstAt.get(same)]); return false; }
      firstAt.set(same, row);
      return true;
    });
    const pairs = [];
    located.forEach((row, i) => {
      for (const group of bySpan.get(place(row)) ?? []) {
        work++;
        const s = score(row, group);
        if (s) pairs.push({ i, group, ...s });
      }
    });
    work += pairs.length;
    pairs.sort((x, y) => y.q - x.q || x.i - y.i || x.group.n - y.group.n);
    const chosen = new Map(), taken = new Set();
    for (let k = 0; k < pairs.length; k++) {
      const pair = pairs[k];
      if (chosen.has(pair.i) || taken.has(pair.group)) continue;
      // Its rivals: the pairs of equal score after it, of the same row or the same requirement, still open.
      const rivals = [];
      for (let j = k + 1; j < pairs.length && pairs[j].q === pair.q; j++)
        if ((pairs[j].i === pair.i || pairs[j].group === pair.group) && !chosen.has(pairs[j].i) && !taken.has(pairs[j].group))
          rivals.push(pairs[j]);
      const contested = rivals.some((p) => p.group === pair.group);
      chosen.set(pair.i, rivals.length ? null : pair.group);
      for (const p of rivals) if (p.group === pair.group) chosen.set(p.i, null);
      if (!rivals.length || contested) taken.add(pair.group);
    }
    const home = new Map();
    located.forEach((row, i) => { const group = chosen.get(i) ?? start(row); join(group, row); home.set(row, group); });
    for (const [row, first] of echoes) join(home.get(first), row);
  });
  // Rows without a location (or past the work bound), by their text as compared, once every located row has its
  // requirement.
  const locatedByKey = new Map(), plainByKey = new Map();
  for (const group of groups)
    for (const row of group.members) if (!locatedByKey.has(row.key)) locatedByKey.set(row.key, group);
  batches.forEach((rows) => {
    for (const row of rows.filter((r) => !r.at || unmatched.has(r))) {
      const group = locatedByKey.get(row.key) ?? plainByKey.get(row.key) ?? start(row);
      if (!plainByKey.has(row.key) && !locatedByKey.has(row.key)) plainByKey.set(row.key, group);
      join(group, row);
    }
  });
  return groups;
}

/**
 * The distinct requirements of the human asks. The review re-proposes a requirement in every window, in other
 * words each time, so its wording cannot tell two rows of one requirement apart; the human words each row cites
 * mostly can (`groupRequirements`). The rows grouped are each window's proposals whose instruction quote grounds
 * in this session, a window being a batch; the report's own rows only say which requirements the review published,
 * and in what order. A report row no window proposed (or every row, when the report has no window narratives) is
 * grouped with the others like it, one row a batch: nothing then says which rows one window proposed side by side.
 * A requirement the report lists no row of is not shown; the requirements are in the order the report first lists
 * them.
 *
 * Each requirement is shown ONCE. One with a located quote reads as the human's own words: the longest of its
 * quotes that no other requirement's quote overlaps by half, else the longest of them. Its status is from the LAST
 * window that proposed any row of it (the least addressed of that window's rows, should it hold two). A requirement
 * only report rows make up gives the least addressed status of those rows: a report row keeps the status of its latest
 * wording, however old. `wording` is
 * the review's words of the row the status is from, for the reader when two requirements read as the same words.
 */
function distinctRequirements(session, report, askIds) {
  const readable = (r) => plainObject(r) && typeof r.text === 'string' && readableStatus(r.status)
    && plainObject(r.instruction) && askIds.has(r.instruction.eventId);
  const spansCache = new Map();
  const spansOf = (id) => {
    if (!spansCache.has(id)) spansCache.set(id, session.textSpansOf(session.event(id), 'text'));
    return spansCache.get(id);
  };
  const row = (r, window, batch) => {
    const grounded = verifyReceipt(session, r.instruction).ok;
    const ask = r.instruction.eventId;
    return { r, window, batch, ask, grounded, key: requirementKey(ask, r.text),
      at: grounded ? locateQuote(r.instruction, spansOf(ask)) : null };
  };
  // D71 (S4): a checklist row (a session-only review's statuses, ledger.js REQUIREMENT_STATUSES) is read as code published
  // it — its status, evidence and reason after the code checks and the challenge (owner decision D71 b), never the
  // answer's proposed status — one requirement per report row (the merge already keyed it by its grounded instruction
  // quote: run-review.js `mergeWindowOutputs`). The legacy rows are grouped below, as before.
  const all = list(report?.requirements).filter(readable);
  const checklist = all.filter((r) => REQUIREMENT_STATUSES.includes(r.status));
  const listed = all.filter((r) => !REQUIREMENT_STATUSES.includes(r.status));
  const order = new Map();
  listed.forEach((r, i) => { const key = requirementKey(r.instruction.eventId, r.text); if (!order.has(key)) order.set(key, i); });
  const windows = list(report?.windowResults).map((window, index) => list(window?.narrative?.requirements)
    .filter((r) => readable(r) && !REQUIREMENT_STATUSES.includes(r.status) && r.instruction.role === 'instruction')
    .map((r) => row(r, index, index)).filter((x) => x.grounded));
  const proposedKeys = new Set(windows.flat().map((x) => x.key));
  const unproposed = listed.filter((r) => !proposedKeys.has(requirementKey(r.instruction.eventId, r.text)));
  const groups = [...groupRequirements(windows, spansOf),
    ...groupRequirements(unproposed.map((r, i) => [row(r, null, i)]), spansOf)];
  const lowest = (values) => values.reduce((n, v) => Math.min(n, v), Infinity);
  const highest = (values) => values.reduce((n, v) => Math.max(n, v), -Infinity);
  // A quote another requirement of the same request also overlaps by half is not how either one reads.
  const shared = (group, quote) => groups.some((other) => other !== group && other.ask === group.ask
    && other.quotes.some((q) => q.span === quote.span && overlapping(q, quote)));
  return [...groups.map((group) => ({ group, first: lowest(group.members.map((m) => order.get(m.key) ?? Infinity)) }))
    .filter(({ first }) => first !== Infinity).sort((a, b) => a.first - b.first || a.group.n - b.group.n).map(({ group }) => {
      const proposed = group.members.filter((m) => m.window !== null);
      const last = proposed.length ? highest(proposed.map((m) => m.window)) : null;
      const deciding = last === null ? group.members : proposed.filter((m) => m.window === last);
      const status = leastAddressed(deciding);
      const own = group.quotes.filter((quote) => !shared(group, quote));
      const shown = (own.length ? own : group.quotes)
        .reduce((best, q) => (best === null || q.until - q.from > best.until - best.from ? q : best), null);
      const text = shown ? spansOf(group.ask)[shown.span].slice(shown.from, shown.until)
        : group.members.map((m) => m.r.text).reduce((best, t) => (untidy(t) < untidy(best) ? t : best));
      // `located`: every place in the message's recorded text its grounded quotes sit (D69 f (g)): the readers mark them.
      return { ask: group.ask, status, text, quoted: shown !== null, wording: deciding.find((m) => m.r.status === status).r.text,
        located: group.quotes.map((q) => ({ span: q.span, from: q.from, until: q.until })) };
    }), ...checklist.map((r) => checklistRequirement(session, r, spansOf))];
}

/**
 * D71 (S4): one checklist requirement row as the readers show it — the human's grounded words for the ask (code's own
 * row, `codeMade`, has none: it reads in its fixed words), the status code published, and the row itself (`checked`:
 * its deliverable, shortfall, `restsOn`, closed reason and facts). Structure only.
 */
function checklistRequirement(session, r, spansOf) {
  const ask = r.instruction.eventId;
  const quoted = r.codeMade !== true && verifyReceipt(session, r.instruction).ok;
  const at = quoted ? locateQuote(r.instruction, spansOf(ask)) : null;
  return { ask, status: r.status, text: quoted ? r.instruction.quote : r.text, quoted, wording: r.text,
    located: at ? [{ span: at.span, from: at.from, until: at.until }] : [], checked: r,
    // What the code step tied to the ask (ask-code-links.js), read by `askRowKind` as on the report's row.
    ...(Array.isArray(r.codeLinks) ? { codeLinks: r.codeLinks } : {}) };
}

/** What a list of events did: its commands (each with how its record says it ended, `commandEnd`), the files it
 *  changed in the repository with their line counts, and hand-offs. Changes outside the repository are only counted, as
 *  distinct paths. D80: a write of a failed or stopped command, and (D98) a direct write the recorder typed as stopped
 *  (`unconfirmed`, inside the repository or not), is none of the changes: it is listed apart. */
function stepActivity(session, events, outcomes, counted) {
  const commands = [], changes = [], unconfirmed = [], outside = new Set();
  let spawns = 0;
  for (const event of events) {
    if (event.kind !== 'invocation') continue;
    if (event.operation === 'command') {
      // M1: a command failed when its record says so (`commandEnd`); /16 (D79): one the recorder typed as refused did
      // not run, and is not a failed command; D80: and one it typed as stopped is neither.
      const { exitCode, didNotRun, stopped, failed } = commandEnd(outcomes, event);
      commands.push({ event, outcome: outcomes.outcome(event.id), exitCode, failed, didNotRun, stopped });
    } else if (event.operation === 'delegate') {
      if (session.childFor(event.id)?.relation !== 'followup') spawns++;
    } else if (WRITE_OPERATIONS.includes(event.operation)) {
      for (const row of counted.get(event.id) ?? []) {
        if (row.unconfirmed) unconfirmed.push(row);
        else if (row.outside) outside.add(row.path);
        else changes.push(row);
      }
    }
  }
  const files = new Map();
  for (const change of changes) {
    const file = files.get(change.path) ?? { path: change.path, counts: zeroCounts(), helper: true, operations: new Set() };
    addCounts(file.counts, change.counts);
    file.helper &&= change.helper;
    file.operations.add(change.event.operation);
    files.set(change.path, file);
  }
  const counts = [...files.values()].reduce((sum, file) => addCounts(sum, file.counts), zeroCounts());
  return { commands, changes, unconfirmed, files: [...files.values()], counts, spawns, outsidePaths: outside,
    outside: outside.size };
}

/** How long the recording ran, from its first to its last recorded timestamp: "12 min" or "1 h 5 min"; null with fewer
 *  than two timestamps. Recorded times only, never the clock. */
export function durationWord(events) {
  const times = events.map((event) => (typeof event.timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(event.timestamp)
    ? Date.parse(event.timestamp) : NaN)).filter(Number.isFinite);
  if (times.length < 2) return null;
  const minutes = Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}


// ---- the Markdown report (D97) -------------------------------------------------------------------------------------

/**
 * The Markdown report's bounds: at most `maxBytes` UTF-8 bytes (GitHub refuses a comment body over 65,536 characters,
 * and a text never has more characters than bytes, so it always fits), unless the parts it never shortens are longer on
 * their own (`renderReportMarkdown`); an ask's words in the prompt table cut after `askWords` words; and when the
 * report must be shortened, each message kept to its first `messageChars` characters.
 * The last two are the report model's own bounds (report-model.js REPORT_LIMITS `askPrefixWords`, `messageChars`).
 */
export const REPORT_MD_LIMITS = Object.freeze({ maxBytes: 60_000, askWords: 12, messageChars: 300 });

/** The Markdown report's own words, beside the report's (report-words.js): the prompt table's headings, the fold of
 *  each whole message (or of its start, when the report is shortened), and a kind's count when Good to know is
 *  shortened to counts. */
export const REPORT_MD_WORDS = Object.freeze({
  status: 'Status', asked: 'You asked', note: "Sonah's note",
  coverage: 'Sonah checked only the parts of your prompt that the table above lists.',
  wholeMessage: (n) => `Your whole message (${n} ${n === 1 ? 'word' : 'words'})`,
  messageStart: (n) => `The start of your message (${n} ${n === 1 ? 'word' : 'words'} in all)`,
  kindCount: (kind, n) => `${kind}: ${n}`,
});
/** How the style linter (packages/render/test/style-lint.js) reads this file's word table. */
export const STYLE_KINDS = Object.freeze({ REPORT_MD_WORDS: 'heading', 'REPORT_MD_WORDS.kindCount': 'fragment',
  'REPORT_MD_WORDS.coverage': 'notice' });
/** The arguments each function of the table is rendered with for the linter: one and many. */
export const STYLE_FIXTURES = Object.freeze({ 'REPORT_MD_WORDS.wholeMessage': [[1], [42]],
  'REPORT_MD_WORDS.messageStart': [[1], [42]],
  'REPORT_MD_WORDS.kindCount': [['A change of approach', 1], ['A corrected claim', 3]] });

/** A token GitHub would turn into a ping or a link in a comment, in Markdown text that `escapeSource` escaped: another
 *  repository's issue (`owner/repo#123`), an issue (`#123`), a mention (`@name`), or a run of 7 to 64 hexadecimal
 *  characters that stands alone (a commit hash). An escaped `_` (`\_`) and `#` (`\#`) are read as theirs. */
const NAME = '(?:[A-Za-z0-9.-]|\\\\_)+';
const MENTION_TOKENS = new RegExp([`${NAME}/${NAME}\\\\?#\\d+`, '\\\\?#\\d+', '@[A-Za-z0-9][A-Za-z0-9-]*',
  '(?<![A-Za-z0-9_\\\\])[0-9A-Fa-f]{7,64}(?![A-Za-z0-9_])'].join('|'), 'g');
/**
 * No pings, no cross-links (D97): in Markdown text that `escapeSource` escaped, each `@` followed by a name
 * character, each `#` followed by a digit (with any `owner/repo` before it), and each run of 7 to 64 hexadecimal
 * characters that stands alone as a word is wrapped in an inline code span, inside which GitHub links nothing. The
 * characters stay as written, so a quote is still word for word. Pure.
 */
export function neutraliseMentions(text) {
  return String(text).replace(MENTION_TOKENS, (token) => `\`${token.replace(/\\([_#])/g, '$1')}\``);
}
/** The same for HTML text (a fold's summary, where Markdown is not read): each token in a `<code>` element. */
const neutraliseHtml = (text) => String(text).replace(MENTION_TOKENS, (token) => `<code>${token}</code>`);

const BR = '  \n';
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/blob\/(?:[0-9a-f]{40}|[0-9a-f]{64})\/[^\s"'<>]*$/;
const bytesOf = (text) => Buffer.byteLength(text, 'utf8');
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const shortId = (id) => (typeof id === 'string' && id.startsWith('sha256:') ? id.slice(7, 19) : String(id ?? ''));
const placeText = (w) => `${w.path}${Number.isSafeInteger(w.startLine) ? `:${w.startLine}${Number.isSafeInteger(w.endLine)
  && w.endLine > w.startLine ? `-${w.endLine}` : ''}` : ''}`;

/** Markdown text as written: `escapeSource`, and GitHub's own inline markers it leaves — `~` (struck text) and `$`
 *  (math) — escaped too, so no text strikes itself through or renders as a formula; and a leading `=`, so a line of
 *  your message made of `=` never turns the line above it into a heading. */
const mdEscape = (text) => escapeSource(text).replace(/[~$]/g, (c) => `\\${c}`).replace(/^=/, '\\=');
/** Sonah's own words as Markdown text: escaped, never neutralised (they hold no mention). */
const mdOwn = (text) => mdEscape(text);
/** Where a sentence of Sonah's names recorded paths: a character no word table holds. */
const PATHS_SLOT = '\uE000';
/** Sonah's sentence `sentence(names)` as Markdown text, the recorded paths it names each a code span: the
 *  sentence is escaped with a slot where the names go, and the code spans are put in the slot. */
const mdOwnNaming = (sentence, paths) => mdOwn(sentence(PATHS_SLOT)).split(PATHS_SLOT)
  .join(list(paths).map(codeSpan).join(', '));
/** A span of code a recorded or review-written text marks the Markdown way: one backtick, then at least one character
 *  that is not a space, with no backtick or line break, then one backtick, with no backtick on either side. */
const BACKTICK_SPAN = /(?<!`)`([^`\n]*[^`\s][^`\n]*)`(?!`)/g;
/**
 * A recorded or review-written text cut at its balanced single-backtick spans: `[{ text, code }]`, in order, every
 * character kept (a span's backticks are its markers). Every other backtick is text. Structure only, never meaning: the
 * Markdown report shows each span as a code span and the page as `<code>`, inside which nothing pings, links or renders
 * as HTML.
 */
export function backtickPieces(text) {
  const value = String(text ?? '');
  const pieces = [];
  let at = 0;
  for (const m of value.matchAll(BACKTICK_SPAN)) {
    if (m.index > at) pieces.push({ text: value.slice(at, m.index), code: false });
    pieces.push({ text: m[1], code: true });
    at = m.index + m[0].length;
  }
  if (at < value.length) pieces.push({ text: value.slice(at), code: false });
  return pieces;
}
/** A span's text as an inline code span: one backtick each side (it holds none), and one more space each side when it
 *  starts and ends with one, which GitHub takes off. */
const inlineCode = (value) => (value.startsWith(' ') && value.endsWith(' ') ? `\` ${value} \`` : `\`${value}\``);
/** A recorded or review-written text as Markdown text: escaped, then its mentions neutralised; each balanced
 *  single-backtick span a code span (`backtickPieces`), unless a neutralised token's own backtick touches it, when it
 *  stays text as written. */
function mdText(text) {
  const pieces = backtickPieces(visible(text));
  const prose = pieces.map((p) => (p.code ? null : neutraliseMentions(mdEscape(p.text))));
  return pieces.map((p, i) => {
    if (!p.code) return prose[i];
    if ((prose[i - 1] ?? '').endsWith('`') || (prose[i + 1] ?? '').startsWith('`'))
      return neutraliseMentions(mdEscape(`\`${p.text}\``));
    return inlineCode(p.text);
  }).join('');
}
/** Italics around escaped text, its spaces outside the markers. */
const italic = (escaped) => {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(escaped);
  return core ? `${lead}*${core}*${trail}` : escaped;
};
/** One text part of the report model as Markdown: code as a code span, a verbatim quote in quotation marks (a cut
 *  outside them), a review's own words in italics, Sonah's words as they are. An in-page link is text. */
function partMd(p) {
  if (!plainObject(p)) return '';
  if (p.code) return codeSpan(p.text);
  if (p.quote) return `“${mdText(p.text)}”${p.cut ? '…' : ''}`;
  if (p.by === 'sonah') return mdOwn(p.text);
  return italic(mdText(p.text));
}
const partsMd = (parts) => list(parts).map(partMd).join('');

/** Text for HTML (a fold's summary): on one line, the characters HTML reads as markup escaped. */
const escHtml = (text) => visible(text).replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** A recorded or review-written text for HTML: escaped and neutralised, each balanced single-backtick span a `<code>`
 *  element (`backtickPieces`). */
const textHtml = (text) => backtickPieces(visible(text)).map((p) => (p.code ? `<code>${escHtml(p.text)}</code>`
  : neutraliseHtml(escHtml(p.text)))).join('');
function partHtml(p) {
  if (!plainObject(p)) return '';
  if (p.code) return `<code>${escHtml(p.text)}</code>`;
  if (p.quote) return `“${textHtml(p.text)}”${p.cut ? '…' : ''}`;
  if (p.by === 'sonah') return escHtml(p.text);
  return `<em>${textHtml(p.text)}</em>`;
}
const partsHtml = (parts) => list(parts).map(partHtml).join('');

/** A fold: `<details>`, its summary (HTML, one line), a blank line, the content, a blank line, `</details>`. */
const fold = (summaryHtml, blocks) => `<details><summary>${summaryHtml}</summary>\n\n${blocks.filter(Boolean).join('\n\n')}`
  + `${blocks.some(Boolean) ? '\n\n' : ''}</details>`;
/** A table cell: a `|` left unescaped (only a code span can hold one) is escaped, as GitHub's tables read it. */
const cell = (md) => md.replace(/(?<!\\)\|/g, '\\|');
/** One line of a message in a block quote: its leading spaces kept as no-break spaces, so no line opens a block. */
function quoteLine(line) {
  if (!line.trim()) return '>';
  const [, lead, rest] = /^([ \t]*)([\s\S]*)$/.exec(line);
  return `> ${'&nbsp;'.repeat([...lead].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0))}${mdText(rest)}`;
}
/** A code excerpt as a fence longer than any run of backticks or tildes in its lines, then how many lines it leaves
 *  out. Its lines are verbatim. */
function fenced(excerpt) {
  const texts = list(excerpt?.lines).map((l) => String(l.text));
  const run = Math.max(2, ...texts.flatMap((t) => [...t.matchAll(/`+|~+/g)].map((m) => m[0].length)));
  const fence = '`'.repeat(run + 1);
  return [fence, ...texts, fence].join('\n')
    + (excerpt.more ? `\n\n${mdOwn(REPORT_ITEM_WORDS.unchangedLines(excerpt.more))}` : '');
}
/** An ask's words in the prompt table, cut after `askWords` words (the cut outside the quotation marks). */
function askWordsMd(ask) {
  const [p] = list(ask.words);
  if (!p) return '';
  const prefix = new RegExp(`^\\s*(?:\\S+\\s+){${REPORT_MD_LIMITS.askWords - 1}}\\S+`).exec(p.text)?.[0];
  const cut = prefix !== undefined && prefix.length < p.text.trimEnd().length;
  const text = cut ? prefix : p.text;
  return p.quote ? partMd({ ...p, text, cut: p.cut || cut }) : `${partMd({ ...p, text })}${cut ? '…' : ''}`;
}

// ---- the sections -----------------------------------------------------------------------------------------------

function headerBlocks(model) {
  const { header, countLine } = model;
  const blocks = [`## ${mdOwn(REPORT_HEADER_WORDS.review)}${header.title ? ` · ${partsMd(header.title.parts)}` : ''}`];
  const lines = [mdOwn(header.size.join(' · ')), ...(header.noLinks.length ? [mdOwn(header.noLinks.join(' '))] : []),
    ...(header.runs.length ? [mdOwn(header.runs.join(' '))] : [])];
  const notChecked = [...header.reviewIncomplete];
  if (header.didNotCheck) notChecked.push(`${header.didNotCheck.lead} ${header.didNotCheck.phrases.join(' · ')}`
    + `${header.didNotCheck.more ? ` ${header.didNotCheck.more}` : ''}`);
  if (notChecked.length) lines.push(mdOwn(notChecked.join(' ')));
  if (header.noCode) lines.push(mdOwn(header.noCode.join(' ')));
  blocks.push(lines.join(BR));
  const tiers = countLine.tiers.map((t) => `${REPORT_COUNT_WORDS.tier(t.words, t.n)}${t.folded
    ? ` ${REPORT_COUNT_WORDS.folded}` : ''}`).join(' · ');
  const count = [mdOwn(`${tiers} · ${countLine.prompt}`)];
  if (countLine.empty) count.push(mdOwn(countLine.empty));
  else if (countLine.labels.length) count.push(`${mdOwn(REPORT_COUNT_WORDS.mustActLead)} ${countLine.labels
    .map((l) => `[${partsMd(l.parts)}](#item-${l.n})`).join(' · ')}${countLine.more
    ? ` ${mdOwn(REPORT_COUNT_WORDS.more(countLine.more))}` : ''}`);
  blocks.push(count.join(BR));
  return blocks;
}

/** Whether a message is longer than the report keeps when it is shortened (`messageChars` characters). */
const longMessage = (message) => [...message.segments.map((s) => s.text).join('')].length
  > REPORT_MD_LIMITS.messageChars;
/** A message as a block quote: its recorded text (a join between two recorded spans is Sonah's), or Sonah's sentence
 *  when the recording holds no words of it; its first `messageChars` characters when `cut`. */
function messageBlock(message, cut) {
  if (message.segments.every((s) => s.sonah || s.join)) return mdOwn(message.segments.map((s) => s.text).join(''));
  const text = message.segments.map((s) => s.text).join('');
  const shown = cut && longMessage(message) ? `${[...text].slice(0, REPORT_MD_LIMITS.messageChars).join('')}…` : text;
  return shown.split('\n').map(quoteLine).join('\n');
}
/** The words of a message as you wrote it: its recorded segments joined as they are (an ask's words and the text
 *  around them are one text), a join between two recorded spans or a sentence of Sonah's read as a space. */
const wordCount = (message) => message.segments.map((s) => (s.join || s.sonah ? ' ' : s.text)).join('')
  .split(/\s+/).filter(Boolean).length;

function promptSection(model, trim, notice) {
  const { prompt } = model;
  const blocks = [`### ${mdOwn(REPORT_SECTION_WORDS.promptCounted(prompt.asks.length, prompt.parts.join(', ')))}`];
  if (notice) blocks.push(mdOwn(notice));
  if (!prompt.asks.length) blocks.push(mdOwn(REPORT_COUNT_WORDS.noAsk));
  else {
    const rows = prompt.asks.map((ask) => {
      const message = prompt.messages.find((m) => m.asks.includes(ask.n));
      const notes = [...(message?.attachedAsks.includes(ask.n) ? [mdOwn(REPORT_PROMPT_WORDS.fromAttached)] : []),
        ...(message?.unlocated.includes(ask.n) ? [mdOwn(REPORT_PROMPT_WORDS.unlocated)] : []), ...ask.lines.map(partsMd)];
      return `| ${cell(mdOwn(ask.status))} | ${cell(askWordsMd(ask))} | ${cell(notes.join(' '))} |`;
    });
    blocks.push([`| ${mdOwn(REPORT_MD_WORDS.status)} | ${mdOwn(REPORT_MD_WORDS.asked)} | ${mdOwn(REPORT_MD_WORDS.note)} |`,
      '|---|---|---|', ...rows].join('\n'));
    // Nothing in a message below is marked: the table names what Sonah checked, once.
    blocks.push(mdOwn(REPORT_MD_WORDS.coverage));
  }
  for (const m of prompt.messages) {
    if (m.attached) blocks.push(mdOwn(REPORT_PROMPT_WORDS.attached(m.attached)));
    if (m.pasted) blocks.push(mdOwn(m.pasted));
    // A message cut to its start says so in its fold's summary, which keeps the whole message's count.
    const summary = (trim.messages && longMessage(m) ? REPORT_MD_WORDS.messageStart : REPORT_MD_WORDS.wholeMessage)(
      wordCount(m));
    blocks.push(fold(escHtml(summary), [messageBlock(m, trim.messages)]));
  }
  if (prompt.emptyMessages.length) blocks.push(fold(escHtml(REPORT_SECTION_WORDS.noAskMessages(prompt.emptyMessages.length)),
    prompt.emptyMessages.flatMap((m) => [messageBlock(m, trim.messages), m.pasted ? mdOwn(m.pasted) : null])));
  const shortened = trim.messages && [...prompt.messages, ...prompt.emptyMessages].some(longMessage);
  return { text: blocks.join('\n\n'), shortened };
}

function whereMd(item) {
  const places = [...item.where.map((w) => (w.anchor ? mdOwn(w.text) : codeSpan(placeText(w)))),
    ...(item.whereMore ? [mdOwn(REPORT_ITEM_WORDS.morePlaces(item.whereMore))] : [])];
  // A member (D112) has no scope of its own: its item's marker says whether you asked.
  const asks = item.scope?.asks ?? [];
  const marker = asks.length && !item.where.some((w) => w.anchor === `ask-${asks[0]}`)
    ? [mdOwn(REPORT_ITEM_WORDS.asked(asks[0]))] : [];
  return places.length || marker.length ? `${mdOwn(REPORT_ITEM_WORDS.where)} ${[...places, ...marker].join(' · ')}` : null;
}
function evidenceFold(item, trimmed) {
  const summary = escHtml(`${REPORT_ITEM_WORDS.evidence} · ${REPORT_ITEM_WORDS.why(REPORT_TIER_WORDS[item.tier.final])}`);
  if (trimmed) return fold(summary, []);
  const lines = item.evidence.map((e) => `- ${e.label ? `${mdOwn(e.label)} ` : ''}${partsMd(e.parts)}`);
  for (const reason of new Set(item.where.map((w) => w.noLink).filter(Boolean))) lines.push(`- ${mdOwn(reason)}`);
  lines.push(`- ${mdOwn(item.why)}`);
  if (item.rowId) lines.push(`- ${mdOwn(REPORT_ITEM_WORDS.rowId)} ${codeSpan(shortId(item.rowId))}`);
  // Your earlier answer is your own words, escaped, and never in a recorded quote's quotation marks.
  if (item.answer) lines.push(`- ${mdOwn(REPORT_ITEM_WORDS.yourAnswer)} ${mdOwn(item.answer.words)} ${mdText(item.answer.reason)}`);
  return fold(summary, [lines.join('\n')]);
}
/** The head of an item: its number, its type word first (S10), what it is, and whether you asked for it. */
const itemHead = (item, render) => {
  const scope = item.scope.notAsked ? ` ${REPORT_ITEM_WORDS.notAsked}` : item.scope.askedUnknown
    ? ` ${REPORT_ITEM_WORDS.askedUnknown}` : '';
  return render === 'html' ? `${item.n} ${escHtml(REPORT_TYPE_WORDS[item.type])}: ${partsHtml(item.what.parts)}${escHtml(scope)}`
    : `**${item.n} ${mdOwn(REPORT_TYPE_WORDS[item.type])}:** ${partsMd(item.what.parts)}${mdOwn(scope)}`;
};
/** An item or a member's lines (D97, D112) after `lines` (its head, when shown): each permalink on its own line, the
 *  excerpt as a fence when its place has no permalink, then its evidence, folded. */
function entryMd(item, lines, { evidence = false, excerpts = false } = {}) {
  if (item.quote) lines.push(`${item.quoteLabel ? `${mdOwn(item.quoteLabel)} ` : ''}${partMd(item.quote)}`);
  else if (item.quoteMissing) lines.push(mdOwn(REPORT_ITEM_WORDS.quoteMissing));
  // D110: each premise of an item to verify that Sonah could not check, in its check's words.
  for (const parts of Array.isArray(item.restsOutside) ? item.restsOutside : [])
    lines.push(`${mdOwn(REPORT_ITEM_WORDS.restsOutside)} ${partsMd(parts)}`);
  if (item.impact) lines.push(`${mdOwn(REPORT_ITEM_WORDS.impact)} ${partsMd(item.impact)}`);
  if (item.agentSaid) lines.push(`${mdOwn(item.agentSaidLabel ?? REPORT_ITEM_WORDS.agentSaid)} ${partMd(item.agentSaid)}`);
  if (item.action) lines.push(`${mdOwn(REPORT_ITEM_WORDS.action)} ${partsMd(item.action)}`);
  const where = whereMd(item);
  if (where) lines.push(where);
  const blocks = [lines.join(BR)];
  for (const w of item.where) if (typeof w.url === 'string' && GITHUB_URL.test(w.url)) blocks.push(w.url);
  const first = item.where[0];
  const fence = !first?.url && first?.excerpt?.lines?.length ? first.excerpt : null;
  if (fence && !excerpts) blocks.push(fenced(fence));
  blocks.push(evidenceFold(item, evidence));
  return { text: blocks.filter(Boolean).join('\n\n'), fenced: fence !== null };
}
/** An item (D97): its visible lines in order (with its head unless the fold's summary shows it), then (D112) the line
 *  that counts its members and each member: its type word, what it is and its own tier word, then its lines, inside a
 *  fold when the report model folds it. */
function itemMd(item, { head = true, evidence = false, excerpts = false } = {}) {
  const own = entryMd(item, head ? [`<a name="item-${item.n}"></a>${itemHead(item, 'md')}`] : [], { evidence, excerpts });
  const members = list(item.members);
  if (!members.length) return own;
  const blocks = [own.text, mdOwn(REPORT_ITEM_WORDS.members(members.length))];
  let fencedAny = own.fenced;
  for (const m of members) {
    const tier = REPORT_TIER_WORDS[m.tier.final];
    const one = m.folded ? entryMd(m, [], { evidence, excerpts })
      : entryMd(m, [`**${mdOwn(REPORT_TYPE_WORDS[m.type])}:** ${partsMd(m.what.parts)} · ${mdOwn(tier)}`], { evidence, excerpts });
    fencedAny = fencedAny || one.fenced;
    blocks.push(m.folded ? fold(`${escHtml(REPORT_TYPE_WORDS[m.type])}: ${partsHtml(m.what.parts)} · ${escHtml(tier)}`,
      [one.text]) : one.text);
  }
  return { text: blocks.join('\n\n'), fenced: fencedAny };
}

function tierSection(model, tier, trim, notice) {
  const items = model.tiers[tier];
  const evidence = tier === 'must_act' ? trim.actEvidence : trim.knowEvidence;
  const rendered = items.map((item) => itemMd(item, { evidence, excerpts: trim.excerpts }));
  const blocks = [`### ${mdOwn(REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[tier], items.length))}`,
    notice ? mdOwn(notice) : null, ...rendered.map((r) => r.text)];
  const shortened = items.length > 0 && (evidence || (trim.excerpts && rendered.some((r) => r.fenced)));
  return { text: blocks.filter(Boolean).join('\n\n'), shortened };
}

function goodToKnowSection(model, trim, notice) {
  const items = model.tiers.good_to_know;
  const summary = escHtml(REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS.good_to_know, items.length));
  const top = notice ? [mdOwn(notice)] : [];
  if (trim.gtkCounts && items.length) {
    const counts = REPORT_ITEM_KINDS.map((kind) => [kind, items.filter((item) => item.kind === kind).length])
      .filter(([, n]) => n > 0).map(([kind, n]) => `- ${mdOwn(REPORT_MD_WORDS.kindCount(capital(REPORT_KIND_WORDS[kind]), n))}`);
    return { text: fold(summary, [...top, counts.join('\n')]), shortened: true };
  }
  const rendered = items.map((item) => {
    const where = item.where.slice(0, 1).map((w) => (w.anchor ? escHtml(w.text) : `<code>${escHtml(placeText(w))}</code>`));
    const one = itemMd(item, { head: false, evidence: trim.gtkEvidence, excerpts: trim.excerpts });
    return { fenced: one.fenced, text: fold(`<a name="item-${item.n}"></a>${itemHead(item, 'html')}`
      + `${where.length ? ` · ${where[0]}` : ''}`, [one.text]) };
  });
  const shortened = items.length > 0 && (trim.gtkEvidence || (trim.excerpts && rendered.some((r) => r.fenced)));
  return { text: fold(summary, [...top, ...rendered.map((r) => r.text)]), shortened };
}

const cap = (n) => Math.min(n, REPORT_LIMITS.files);
/** D104: a row's shown-in-part mark in a list (`seen`: lines of parts), each line after the row's own, under its label. */
const seenMd = (seen) => list(seen).map((line, k) => ` · ${k === 0 ? `${mdOwn(REPORT_SEEN_WORDS.label)} ` : ''}`
  + partsMd(line)).join('');
function didSection(model, trim, notice) {
  const { did } = model;
  const summary = escHtml(REPORT_SECTION_WORDS.didCounted(did.files.total, did.runs.commands, did.runs.others,
    did.claims.total));
  const sub = (heading) => `#### ${mdOwn(heading)}`;
  const counted = (n) => (n ? mdOwn(REPORT_NOT_CHECKED_WORDS.rowsNotShown(n)) : null);
  const blocks = notice ? [mdOwn(notice)] : [];
  const rows = did.files.total + did.runs.shown.length + did.claims.total + did.leftOut.length + did.settled.length;
  if (trim.didCounts) {
    blocks.push(sub(REPORT_SECTION_WORDS.files), did.files.total ? counted(did.files.total) : mdOwn(REPORT_DID_WORDS.noFiles),
      sub(REPORT_SECTION_WORDS.runs), did.runs.total ? counted(did.runs.total) : mdOwn(REPORT_DID_WORDS.noRuns),
      sub(REPORT_SECTION_WORDS.claims), did.claims.total ? counted(did.claims.total) : mdOwn(REPORT_DID_WORDS.noClaims),
      sub(REPORT_SECTION_WORDS.leftOut), did.leftOut.length ? counted(did.leftOut.length) : mdOwn(REPORT_DID_WORDS.noLeftOut),
      sub(REPORT_SECTION_WORDS.settled), did.settled.length ? counted(did.settled.length) : mdOwn(REPORT_DID_WORDS.noSettled));
    return { text: fold(summary, blocks), shortened: rows > 0 };
  }
  // Files, by the ask each serves when the code review grouped them.
  blocks.push(sub(REPORT_SECTION_WORDS.files));
  if (did.files.grouped) blocks.push(mdOwn(REPORT_DID_WORDS.filesByAsk));
  let room = cap(did.files.total), shownFiles = 0;
  // A file's counts sit mid-line, so their leading `+` opens no list: escaped as inline text only.
  const fileLine = (f) => `- ${codeSpan(f.path)} · ${mdOwn(f.type)}${f.counts ? ` · ${mdEscape(`·${f.counts}`).slice(1)}` : ''}`
    + `${f.state ? ` · ${mdOwn(f.state)}` : ''}${f.what ? ` · ${partsMd(f.what)}` : ''}`
    + `${typeof f.link === 'string' && GITHUB_URL.test(f.link) ? ` · ${f.link}` : ''}`
    + `${f.items.map((n) => ` → ${mdOwn(REPORT_ITEM_WORDS.item(n))}`).join('')}`;
  for (const g of did.files.groups) {
    const shown = g.files.slice(0, Math.max(0, room));
    room -= shown.length;
    shownFiles += shown.length;
    if (!shown.length) continue;
    if (did.files.grouped) blocks.push(`**${mdOwn(g.ask === null ? REPORT_DID_WORDS.noAskGroup : REPORT_DID_WORDS.askGroup(g.ask))}**`);
    blocks.push(shown.map(fileLine).join('\n'));
  }
  if (!did.files.total) blocks.push(mdOwn(REPORT_DID_WORDS.noFiles));
  if (did.files.total > shownFiles) blocks.push(mdOwn(REPORT_DID_WORDS.moreFiles(did.files.total - shownFiles)));
  // D109 (its review): with the code step's one tally, the writes it counts and that are no file of the change.
  const outsideWords = did.files.outside?.notInChange ? REPORT_DID_WORDS.notInChange : REPORT_DID_WORDS.outside;
  if (did.files.outside) blocks.push(did.files.outside.paths.length ? mdOwnNaming((names) => outsideWords(
    did.files.outside.n, names, did.files.outside.more), did.files.outside.paths)
    : mdOwn(outsideWords(did.files.outside.n, '')));
  if (did.files.unconfirmed) blocks.push(mdOwn(REPORT_DID_WORDS.unconfirmed(did.files.unconfirmed)));
  // Runs, from the recording, in order.
  blocks.push(sub(REPORT_SECTION_WORDS.runs));
  if (!did.runs.total) blocks.push(mdOwn(REPORT_DID_WORDS.noRuns));
  else if (did.runs.shown.length) blocks.push(did.runs.shown.map((run) => `- ${mdOwn(REPORT_ITEM_WORDS.run(run.k))}`
    + `${run.text ? ` · ${codeSpan(run.text)}` : run.tool ? ` · ${codeSpan(run.tool)}` : ''}`
    + `${run.outcome ? ` · ${mdOwn(run.outcome)}` : ''}${run.handling ? ` · ${mdOwn(run.handling)}` : ''}`
    + `${run.item ? ` → ${mdOwn(REPORT_ITEM_WORDS.item(run.item))}` : ''}${seenMd(run.seen)}`).join('\n'));
  if (did.runs.quietExit0) blocks.push(mdOwn(REPORT_DID_WORDS.moreRuns(did.runs.quietExit0)));
  if (did.runs.cut) blocks.push(mdOwn(REPORT_DID_WORDS.runsCut(did.runs.shown.length, did.runs.cut,
    did.runs.cutParts.join(', ') || String(did.runs.cut))));
  if (did.runs.neverRan.length) blocks.push(mdOwnNaming(REPORT_DID_WORDS.neverRan, did.runs.neverRan));
  // Claims.
  blocks.push(sub(REPORT_SECTION_WORDS.claims));
  if (!did.claims.total) blocks.push(mdOwn(REPORT_DID_WORDS.noClaims));
  else blocks.push(did.claims.shown.map((c) => `- ${c.status ? mdOwn(c.status) : ''}`
    + `${c.item ? `${c.status ? ' ' : ''}→ ${mdOwn(REPORT_ITEM_WORDS.item(c.item))}` : ''}`
    + ` ${c.quote ? partMd(c.quote) : mdOwn(REPORT_ITEM_WORDS.quoteMissing)}`
    + `${c.confirmedBy ? ` · ${mdOwn(REPORT_ITEM_WORDS.recordedResult)} ${partMd(c.confirmedBy)}` : ''}`
    + `${c.why ? ` · ${mdOwn(c.why)}` : ''}${c.path ? ` · ${mdOwnNaming(REPORT_DID_WORDS.written, [c.path])}` : ''}`
    + seenMd(c.seen)).join('\n'));
  if (did.claims.more > 0) blocks.push(mdOwn(REPORT_DID_WORDS.moreClaims(did.claims.more)));
  if (did.claims.closing.total) blocks.push(fold(escHtml(REPORT_SECTION_WORDS.closingLines(did.claims.closing.total)), [
    did.claims.closing.rows.map((l) => `- ${partsMd(l.parts)}`).join('\n'),
    counted(did.claims.closing.total - did.claims.closing.rows.length)]));
  // What the agent said it did not do; the decisions you settled.
  blocks.push(sub(REPORT_SECTION_WORDS.leftOut));
  blocks.push(did.leftOut.length ? did.leftOut.map((x) => `- ${partMd(x.quote)} → ${mdOwn(REPORT_ITEM_WORDS.item(x.item))}`)
    .join('\n') : mdOwn(REPORT_DID_WORDS.noLeftOut));
  blocks.push(sub(REPORT_SECTION_WORDS.settled));
  blocks.push(did.settled.length ? did.settled.map((x) => `- ${partsMd(x.parts)}${x.youSaid
    ? ` · ${mdOwn(x.youSaidLabel ?? REPORT_ITEM_WORDS.youSaid)} ${partMd(x.youSaid)}` : ''}${seenMd(x.seen)}`).join('\n')
    : mdOwn(REPORT_DID_WORDS.noSettled));
  return { text: fold(summary, blocks), shortened: false };
}

function notCheckedSection(model, trim, notice) {
  const nc = model.notChecked;
  const summary = escHtml(REPORT_SECTION_WORDS.notCheckedCounted(nc.total));
  const blocks = notice ? [mdOwn(notice)] : [];
  const counted = (n) => (n ? mdOwn(REPORT_NOT_CHECKED_WORDS.rowsNotShown(n)) : null);
  const session = nc.facts.filter((f) => f.group !== 'code');
  const code = nc.facts.filter((f) => f.group === 'code');
  const listed = (facts) => (facts.length ? (trim.notCheckedCounts ? counted(facts.length)
    : facts.map((f) => `- ${partsMd(f.parts)}`).join('\n')) : null);
  blocks.push(`#### ${mdOwn(REPORT_NOT_CHECKED_WORDS.sessionReview)}`, mdOwn(nc.lead), listed(session));
  if (nc.code.length || code.length || nc.withheldTotal) {
    blocks.push(`#### ${mdOwn(REPORT_NOT_CHECKED_WORDS.codeReview)}`, ...nc.code.map(partsMd), listed(code));
    if (nc.withheldTotal) blocks.push(fold(escHtml(REPORT_SECTION_WORDS.withheld(nc.withheldTotal)), trim.notCheckedCounts
      ? [counted(nc.withheldTotal)] : [nc.withheld.map((w) => `- ${w.what ? `${mdOwn(w.what)} ` : ''}${partsMd(w.words)}`
        + `${w.why ? ` · ${mdOwn(w.why)}` : ''}${w.check ? ` · ${mdOwn(REPORT_NOT_CHECKED_WORDS.checkSaid)} `
        + `${partsMd(w.check)}` : ''}`).join('\n'), counted(nc.withheldTotal - nc.withheld.length)]));
  }
  blocks.push(...[...nc.unreadAsks, ...nc.unreadRows].map(mdOwn));
  const shortened = trim.notCheckedCounts && (nc.facts.length + nc.withheldTotal) > 0;
  return { text: fold(summary, blocks), shortened };
}

function footerBlocks(model) {
  const { footer } = model;
  return ['---', [footer.provenance, ...footer.legend, footer.triageLegend, REPORT_FOOTER_WORDS.youMeans, footer.share]
    .filter(Boolean).map(mdOwn).join(BR)];
}

/**
 * What each composition shortens, in order (D97), until the report fits `maxBytes`: nothing; your messages keep their
 * first `messageChars` characters (your own words, which you hold; the page cuts them first too); then the evidence
 * folds of Good to know keep their summary only; then those of Must know, then of Must act; then the lists of what the
 * agent did keep their counts only; then those of what Sonah could not check; then the code excerpts give way to their
 * place (`path:line`, on the Where line); last, Good to know becomes counts by kind. The header, the count line, the
 * prompt table and the visible lines of Must act and Must know are never shortened.
 */
const MD_TRIM_STEPS = Object.freeze(['messages', 'gtkEvidence', 'knowEvidence', 'actEvidence', 'didCounts',
  'notCheckedCounts', 'excerpts', 'gtkCounts']);
function* mdCompositions() {
  let trim = Object.fromEntries(MD_TRIM_STEPS.map((step) => [step, false]));
  yield trim;
  for (const step of MD_TRIM_STEPS) { trim = { ...trim, [step]: true }; yield trim; }
}

/** One composition of the report: its sections in order, the shortening said once (`notice`, Sonah's sentence), at the
 *  top of the first section this composition shortened. */
function composeMd(model, trim, notice) {
  const sections = [(said) => promptSection(model, trim, said),
    (said) => tierSection(model, 'must_act', trim, said), (said) => tierSection(model, 'must_know', trim, said),
    (said) => goodToKnowSection(model, trim, said), (said) => didSection(model, trim, said),
    (said) => notCheckedSection(model, trim, said)];
  const rendered = sections.map((section) => section(null));
  const first = rendered.findIndex((r) => r.shortened);
  if (first >= 0) rendered[first] = sections[first](notice);
  return `${[...headerBlocks(model), ...rendered.map((r) => r.text), ...footerBlocks(model)].join('\n\n')}\n`;
}

/**
 * The Markdown report of one session's review (D97): the report model (report-model.js `reportModel`) of `session`
 * (the Session the adapter built) and `report` (the finished review report), as GitHub Markdown for a pull request
 * comment, at most `REPORT_MD_LIMITS.maxBytes` bytes when the parts it never shortens fit in that bound. When they do
 * not (the header, the count line, the prompt table and the visible lines of Must act and Must know, longer on their
 * own), the report is every shortening applied and over the bound, and says that it is still too long for one comment
 * (`REPORT_TRIM_WORDS.mdStillLong`): the CLI then prints no `gh` line
 * (report-output.js). `options` are the report model's: `title`, `sonahVersion`, and the CLI's repository and GitHub
 * facts (`repo`, `github`), from which the report model builds the code links; and `page`, `{ whole }` when the same
 * run wrote the HTML page (session-page.js `sessionPage`), so a shortened report says the page holds every part only
 * when that is so. Pure: the same inputs give the same bytes.
 */
export function renderReportMarkdown(session, report, options = {}) {
  const opts = plainObject(options) ? options : {};
  const model = reportModel(session, plainObject(report) ? report : {}, opts);
  // R2: the sentence that the HTML page holds every part only when this run wrote the page and the page kept every
  // part (`options.page`: `{ whole }` from session-page.js `sessionPage`; none with `--format md`, the default).
  const said = (base) => [base, ...(opts.page?.whole === true ? [REPORT_TRIM_WORDS.pageWhole] : [])].join(' ');
  let trim = null;
  for (trim of mdCompositions()) {
    const text = composeMd(model, trim, said(REPORT_TRIM_WORDS.mdShortened));
    if (bytesOf(text) <= REPORT_MD_LIMITS.maxBytes) return text;
  }
  // Every shortening applied and still over the bound: the parts never shortened are longer on their own, and the
  // report says that it is still too long for one comment.
  return composeMd(model, trim, said(REPORT_TRIM_WORDS.mdStillLong));
}
