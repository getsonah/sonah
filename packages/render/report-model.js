// The report model (D97): one review, built once, for the two readers that show it — the HTML page
// (session-page.js) and the Markdown report for a pull request. Both render this model, in its order, with its counts.
//
// The order (owner decision 5): the header, the count line, your prompt marked up, then the items in three tiers —
// Must act, Must know, Good to know (folded) — then what the agent did (folded), what Sonah could not check (folded),
// and the footer. No verdict (D71): the count line is computed from the items, and when Must act and Must know are
// empty a fixed sentence says that this does not mean the work is correct.
//
// One item is one row of the review (or a few rows with one root cause, merged by structure): its type, what it is,
// the verbatim quote it stands on, the code review's impact and action when the code step gave them, where to look,
// whether you asked for it, and its evidence, folded. Its tier is the kind's default, or the code review's proposal kept
// inside the kind's floor and ceiling (D96, triage.js `boundTier`). Every row the readers read is placed exactly once:
// as an item, folded into an item, as an ask of your prompt, or in a list (`reportPlacement`): fold, never drop.
//
// Pure and deterministic: no clock, no random source, no network, no model, no filesystem. Same inputs, same model.
// Every choice reads structure (a closed token, an index, an event's order, whether a quote is literally in the
// recording); no word of a row is ever judged. A quote is shown only when it is found again, literally, in the session
// this model is given. The links out (GitHub permalinks) are built only from validated facts the CLI passes in.
import { verifyReceipt, PROJECT_INSTRUCTIONS_ROLE, referredPath, effectReader, CHANGING_EFFECTS }
  from '../evidence/src/session.js';
import { messageLines } from '../evidence/src/windows.js';
import { honestStatuses, resultOutcome, actionOutcome, DECISION_COLUMNS, REQUIREMENT_STATUSES,
  LEGACY_REQUIREMENT_STATUSES, FAILURE_HANDLINGS, PROMISE_STATUSES, WRITTEN_LABELS, CONTRADICTION_SOURCES,
  CONTRADICTION_ROLES, OWN_WRITTEN_SOURCE, REPORT_TIERS, REPORT_ITEM_KINDS, TRIAGE_LEVELS, PART_REASONS,
  windowRecordComplete, TRIAGE_ERRORS, STOPPED_OUTCOME_FORMS, PROVED_NO_END_FORM, NO_RESULT_OUTCOME_FORM,
  nestedReceipts, writesNothing, REPORT_GROUP_TIES, REPORT_TIER_SOURCES }
  from '../evidence/src/ledger.js';
import { boundTier, itemKindOf, PERMISSION_DENIALS, ITEM_KIND_TABLE } from '../evidence/src/triage.js';
import { askRowKind, derivedColumn, askCodeNotes, listedPromises, coverageCauses, uncappedCauses, COVERAGE_SENTENCE,
  checklistReasonWords, CHECKLIST_REQUIREMENT_FACT_WORDS, CHECKLIST_CLAIM_REASON_WORDS }
  from '../evidence/src/review.js';
import { seenInPartOf, SEEN_IN_PART_SOURCES } from '../evidence/src/seen-in-part.js';
import { requirementRowId, failureRowId } from '../evidence/src/checklist.js';
import { statusUncovered } from '../evidence/src/status-fact.js';
import { codePassFindings, codePassQuestions, codePassWithheld, codePassUnconfirmed, findingConfirmed, premiseConfirms,
  premiseRuled, codeRowCheck, TRIAGE_TEXT_FIELDS, TRACE_LIMITS, CODE_OUTSIDE_STATES, codeChangeTally }
  from '../evidence/src/code-pass.js';
import { CODE_REPORT_WORDS, codeCoverageLines, codeFooterLines, codeReceiptFound, findingClaims, withheldWhy,
  codeNoFindingLine, codeStepWithheld, codeUnseenFiles, codeUnseenReadByChecks, codeQuestionsLine, codeBaseLine,
  codeHowLine }
  from '../evidence/src/code-report.js';
import { storyFacts, visible, oneLine, clip, lineWord, durationWord, failedCommandText, disclosedEdit, locateQuote,
  overlapping, withoutLeadingCd } from './session-story.js';
import { REPORT_TIER_WORDS, REPORT_TYPE_WORDS, REPORT_RECORDING_KINDS, REPORT_HEADER_WORDS, REPORT_RESULT_PARTS,
  REPORT_NOT_CHECKED_PARTS, REPORT_COUNT_WORDS, REPORT_PROMPT_PARTS, REPORT_ITEM_WORDS, REPORT_WHAT_WORDS,
  REPORT_CONTRADICTION_SOURCES, REPORT_DISCLOSURE_WORDS, REPORT_KIND_LABELS, REPORT_TIER_WHY, REPORT_KIND_WORDS,
  REPORT_LEVEL_WORDS, REPORT_PROMPT_WORDS, REPORT_DID_WORDS, REPORT_OUTCOME_WORDS, REPORT_NOT_CHECKED_WORDS,
  REPORT_FOOTER_WORDS, REPORT_ANSWER_WORDS, REPORT_CAUSE_WORDS, REPORT_GAP_WORDS, REPORT_COLUMN_REASON_WORDS,
  REPORT_SECTION_WORDS, REPORT_REFUSAL_WORDS, REPORT_SEEN_WORDS } from './report-words.js';

/** The report model's version: reported in the page's generator meta and the footer. /2 (D101, owner decision
 *  2026-10-17): an ask's line for why it is not checked reads the cause of the test that refused its quote
 *  (review.js `checklistReasonWords`). /3 (D104, F5 part 4): an item, an ask, a claim, a run and a decision you settled
 *  show the mark of each recorded result their rows cite that Sonah first showed the session review only in part
 *  (`seen`, and an item's evidence), and What Sonah could not check counts those results whatever the coverage. /4 (D105,
 *  F2 part A): What Sonah could not check names what the code review saw short of whole (evidence code-report.js
 *  `codeSeenLines`), a request too large to send (`tooLarge`, the footer's `too_large`) and the commands left out of it
 *  for room; the header counts every file of a request too large to send as one the code review did not see. And in the
 *  same move (D107, F3a): a withheld finding or question of the code review says whether an item of the repair matched
 *  it, by identity, saying only what code compared (evidence code-report.js `withheldWhy`). And in the same move (D110,
 *  the premise contract): a code finding is shown as confirmed only when code's label, computed again from its stored check, confirms
 *  it (evidence code-pass.js `codePassFindings`), with each premise beside where its evidence is; a finding that holds and
 *  that the label does not confirm is an item to verify (`code_finding_unconfirmed`, `restsOutside`: each premise Sonah
 *  could not check, in its check's words), tied to the asks it follows from by a line beside them; and no sentence says
 *  that a second reviewer checked a finding. And (D111, F3b, the accounting): What Sonah could not check counts, by kind,
 *  your asks, the statements the agent wrote into a file and its decisions not to act that the code review's
 *  item-by-item check (the accounting) did not examine in a way that Sonah could use (evidence code-report.js
 *  `codeFooterLines`, the footer's `unaccounted`), and names a call of the accounting that did not answer or was too large to send; it never counts or
 *  lists the ones it examined, and no entry of the accounting is shown. Its coverage line is said by the code review's
 *  own coverage (D111's second review, evidence code-report.js `codeReviewCoverage`), naming no list: none when only
 *  those counts keep the coverage short. And (E1-F8, D112: one point, one item): a question the code review wrote is
 *  shown inside the item that holds the row it concerns (but an ask's), and two decisions whose stated quotes nest are
 *  one item, led by the longer quote: each joined row is a member of the item (`members`, placed `memberOf`), with its
 *  own lines and its own tier, folded when that tier is below the item's or when it repeats the lead; the item takes the
 *  higher of its rows' tiers (`tier.from`, `own`). Inside each section the items are ordered by final level (high,
 *  medium, low, then none), then by kind as before. A failure that the agent passed over defaults to Good to know when
 *  its call is a refused read by the recorder's types (triage.js `sonah.tiers/2`). */
export const REPORT_MODEL_VERSION = 'sonah.report-model/4';

/**
 * Every display bound the report keeps (D97), frozen literals: a quote 120 characters; an ask's prefix in a
 * list line 12 words; a message shown open up to 300 characters; a code excerpt 8 lines of 160 characters, one an item;
 * a permalink's range 8 lines; 3 places an item; 40 runs, 50 claims and 200 files shown, then counted; 3 Must act
 * labels on the count line; a title 80 characters; a question's what line the code step's own bound on a question (1000); a command 80; the review's own words 160.
 * A row a bound cuts is still placed: its list counts it.
 */
export const REPORT_LIMITS = Object.freeze({ quoteChars: 120, askPrefixWords: 12, messageChars: 300, excerptLines: 8,
  excerptLineChars: 160, permalinkLines: 8, where: 3, runs: 40, claims: 50, files: 200, mustActLabels: 3, titleChars: 80,
  questionChars: TRACE_LIMITS.questionChars, commandChars: 80, wordsChars: 160, notCheckedPhrases: 4, closingLines: 200, withheld: 100,
  unreadIds: 20, labelWords: 6 });

// ---- small helpers ------------------------------------------------------------------------------------------------

const list = (value) => (Array.isArray(value) ? value : []);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const [MUST_ACT, MUST_KNOW, GOOD_TO_KNOW] = REPORT_TIERS;
const [SETTLED, CHOSE, UNASKED] = DECISION_COLUMNS;
const [DONE, PARTLY_DONE, NOT_DONE, NOT_CHECKED] = REQUIREMENT_STATUSES;
const [ADDRESSED, PARTLY_ADDRESSED, OPEN] = LEGACY_REQUIREMENT_STATUSES;
const [ACTED_ON, TOLD_HUMAN, PASSED_OVER, FAILURE_NOT_CHECKED] = FAILURE_HANDLINGS;
const [, PROMISE_VERIFIED, PROMISE_INCOMPLETE] = PROMISE_STATUSES;
const [, WRITTEN_CONTRADICTED] = WRITTEN_LABELS;
const CODE_REVIEW = 'code-review';
const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** A text part: Sonah's own words unless `by` says whose (the session review's or the code review's words, which a
 *  reader sets apart), and whether it is code, a verbatim quote (`quote`, with `cut` when the report clipped it) or a
 *  link to an anchor of the report (`href`, never a URL). */
const part = (text, extra = {}) => Object.freeze({ text: String(text), by: 'sonah', code: false, quote: false,
  cut: false, href: null, ...extra });
const S = (text) => part(text);
const R = (text) => part(text, { by: 'session-review' });
const C = (text) => part(text, { by: CODE_REVIEW });
const CODE = (text) => part(text, { code: true });
const LINK = (text, href) => part(text, { href });
const ONE = (text) => [S(text)];

/** A list cut to `n` entries (R17): all of it when at most one entry would be cut (a lone hidden entry is shown, never
 *  counted as "and 1 more"), else its first `n` and how many it leaves out. */
const cutTo = (rows, n) => (rows.length <= n + 1 ? { shown: rows, more: 0 } : { shown: rows.slice(0, n), more: rows.length - n });
/** The review's own words (or a recorded text) on one line, clipped. */
const words = (text, n = REPORT_LIMITS.wordsChars) => clip(oneLine(text ?? ''), n);
const capital = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);
const sentence = (text) => (text ? `${capital(text)}${/[.!?]$/.test(text) ? '' : '.'}` : '');

/** Does this receipt ground in this session, in this render? */
function grounds(session, receipt) {
  if (!plain(receipt) || typeof receipt.quote !== 'string' || !receipt.quote) return false;
  try { return verifyReceipt(session, receipt).ok === true; } catch { return false; }
}
/** A verbatim quote as the report shows it: on one line, at most `quoteChars`, the cut said outside the marks. */
function quoted(text) {
  const full = visible(text).replace(/\n/g, ' ');
  const points = [...full];
  const cut = points.length > REPORT_LIMITS.quoteChars;
  return part(cut ? points.slice(0, REPORT_LIMITS.quoteChars - 1).join('') : full, { quote: true, cut });
}
/** A grounded receipt's quote part, or null when it does not ground in this session. A quote of the agent's action
 *  drops a leading `cd <dir> &&` (where a command ran, not what it did), unless that is all of it. */
function quoteOf(session, receipt) {
  if (!grounds(session, receipt)) return null;
  if (receipt.role !== 'action') return quoted(receipt.quote);
  const shown = withoutLeadingCd(receipt.quote);
  return quoted(shown.trim() ? shown : receipt.quote);
}
/** Sonah's join between two recorded spans of one text (a gap in the recording): never inside quotation marks. */
const JOIN = ' … ';
/**
 * Recorded text spans as parts (D69 f (g) finding 14): each span on one line, a verbatim quote of its own; Sonah's join
 * between two spans outside the quotation marks; at most `chars` characters of recorded text in all, the cut said
 * outside the last mark. No span, no part: Sonah never quotes its own words.
 */
function spanQuotes(spans, chars = REPORT_LIMITS.quoteChars) {
  const texts = list(spans).filter((span) => typeof span === 'string' && span !== '')
    .map((span) => [...visible(span).replace(/\n/g, ' ')]);
  const out = [];
  let room = chars;
  for (const [i, points] of texts.entries()) {
    if (i > 0) out.push(S(JOIN));
    if (points.length > room || (points.length === room && i < texts.length - 1)) {
      out.push(part(points.slice(0, Math.max(1, Math.min(points.length, room) - 1)).join(''), { quote: true, cut: true }));
      break;
    }
    out.push(part(points.join(''), { quote: true }));
    room -= points.length;
  }
  return out;
}
/**
 * The title (D97, header line A): the first sentence of your first message that holds an ask, read from its recorded
 * text spans: up to the first `.`, `!` or `?` before a space or a span's end, or to the first line break; at most
 * `titleChars` characters, cut at a word. Each span is a verbatim quote of its own; the joins and the cut are outside
 * the marks. A message with no recorded words gives no title. `{ text, parts, quoted, cut }` or null.
 */
function titleOf(spans) {
  const pieces = [];
  for (const raw of list(spans).filter((span) => typeof span === 'string')) {
    const text = raw.replace(/\r\n?/g, '\n').replace(/^\s+/u, '');
    if (!text) continue;
    const end = /[.!?](?=\s|$)|\n/u.exec(text);
    // As recorded: the page shows each character as `visible` does for every quote; nothing in it is rewritten.
    const piece = visible(end ? text.slice(0, end[0] === '\n' ? end.index : end.index + 1) : text).trim();
    if (piece) pieces.push(piece);
    if (end) break;
  }
  const parts = [];
  let room = REPORT_LIMITS.titleChars;
  for (const [i, piece] of pieces.entries()) {
    if (i > 0) {
      if (room <= JOIN.length + 1) { parts[parts.length - 1] = part(parts.at(-1).text, { quote: true, cut: true }); break; }
      parts.push(S(JOIN));
      room -= JOIN.length;
    }
    const points = [...piece];
    if (points.length <= room) { parts.push(part(piece, { quote: true })); room -= points.length; continue; }
    const head = points.slice(0, room).join('');
    parts.push(part(head.lastIndexOf(' ') > 0 ? head.slice(0, head.lastIndexOf(' ')) : head, { quote: true, cut: true }));
    break;
  }
  if (!parts.length) return null;
  const cut = parts.at(-1).cut;
  return { text: parts.map((p) => p.text).join(''), parts, quoted: true, cut };
}
/** Is a code receipt's quote on the written (after) side of one of its event's changes: code the agent wrote? */
function onWrittenSide(session, receipt) {
  if (!plain(receipt) || receipt.role !== 'code') return false;
  const event = session?.event?.(receipt.eventId);
  return list(event?.changes).some((change) => {
    try { return session.textSpansOf(change, 'after').some((span) => span.includes(receipt.quote)); } catch { return false; }
  });
}

/** Whose words a receipt of yours is: your message's (`fallback`), or a project instruction file's, named by its recorded
 *  path as a reader may see it (`referredPath`: a path outside the working tree by its file name alone). */
function yourLabel(session, receipt, fallback) {
  if (!plain(receipt) || receipt.role !== PROJECT_INSTRUCTIONS_ROLE) return fallback;
  const event = session?.event?.(receipt.eventId);
  return typeof event?.path === 'string' ? REPORT_ITEM_WORDS.referredFrom(referredPath(event.path)) : fallback;
}

/** The paths an event names: its changes' paths first, then the paths it read. */
function eventPaths(session, eventId) {
  const event = typeof eventId === 'string' ? session?.event?.(eventId) : null;
  if (!event) return [];
  const changes = list(event.changes).map((c) => c?.path);
  const read = list(event.paths).map((p) => p?.path);
  return [...new Set([...changes, ...read].filter((p) => typeof p === 'string' && p))];
}
/** The path of a written statement's write: the change whose written side holds its quote, else the first change. */
function writtenPath(session, w) {
  const event = typeof w?.stated?.eventId === 'string' ? session?.event?.(w.stated.eventId) : null;
  const changes = list(event?.changes).filter((c) => typeof c?.path === 'string' && c.path);
  const holding = changes.find((c) => {
    try { return session.textSpansOf(c, 'after').some((span) => span.includes(w.stated.quote)); } catch { return false; }
  });
  return (holding ?? changes[0])?.path ?? null;
}
/** A path's file name. */
const fileName = (path) => String(path).slice(String(path).lastIndexOf('/') + 1) || String(path);

// ---- GitHub permalinks (D97) ---------------------------------------------------------------------------

const validSha = (sha) => typeof sha === 'string' && SHA_PATTERN.test(sha);
const validPath = (path) => typeof path === 'string' && path !== '' && !path.startsWith('/')
  && !path.split('/').some((segment) => segment === '..' || segment === '');
const validPrefix = (prefix) => prefix === '' || validPath(prefix);
/** The repository and GitHub facts the CLI passed in, validated; anything invalid reads as absent (fail closed). */
function linkFacts(options) {
  const repo = plain(options?.repo) ? options.repo : null;
  const github = plain(options?.github) ? options.github : null;
  const facts = {
    repo: repo && (repo.head === null || validSha(repo.head)) && (repo.start === null || repo.start === undefined
      || validSha(repo.start)) && validPrefix(repo.prefix ?? '') ? {
      head: repo.head ?? null, start: repo.start ?? null, prefix: repo.prefix ?? '',
      atHead: new Set(list(repo.atHead).filter(validPath)), goneAtHead: new Set(list(repo.goneAtHead).filter(validPath)),
    } : null,
    github: github && NAME_PATTERN.test(String(github.owner ?? '')) && NAME_PATTERN.test(String(github.repo ?? ''))
      && !['.', '..'].includes(github.owner) && !['.', '..'].includes(github.repo)
      ? { owner: github.owner, repo: github.repo, remote: typeof github.remote === 'string' ? github.remote : null,
        pushed: github.pushed === true ? true : github.pushed === false ? false : null,
        startPushed: github.startPushed === true ? true : github.startPushed === false ? false : null } : null,
    githubGiven: options?.github === null || plain(options?.github),
  };
  return facts;
}
/**
 * The GitHub permalink of one location (`{ path, side, startLine?, endLine? }`), or why there is none:
 * `{ url, reason }`, `reason` one of `uncommitted`, `remote`, `unpushed` or null. A link is built only from validated
 * facts: the owner and repository names, a 40- or 64-hex commit, a prefix and a path with no `..` segment; the range is
 * at most `permalinkLines` lines. Pure.
 */
export function permalinkOf(options, location) {
  const facts = linkFacts(options);
  const none = (reason = null) => ({ url: null, reason });
  if (!plain(location) || !validPath(location.path)) return none();
  if (facts.githubGiven && facts.github === null) return none('remote');
  if (!facts.github || !facts.repo) return none();
  const side = location.side === 'old' ? 'old' : 'new';
  const sha = side === 'old' ? facts.repo.start : facts.repo.head;
  const pushed = side === 'old' ? facts.github.startPushed : facts.github.pushed;
  if (!validSha(sha)) return none();
  if (side === 'new' && !facts.repo.atHead.has(location.path)) return none('uncommitted');
  if (pushed !== true) return none(pushed === false ? 'unpushed' : null);
  const full = facts.repo.prefix ? `${facts.repo.prefix}/${location.path}` : location.path;
  // `encodeURIComponent` keeps the apostrophe, which the readers never put in a link as is: it is encoded too.
  const encoded = full.split('/').map((segment) => encodeURIComponent(segment).replace(/'/g, '%27')).join('/');
  const start = Number.isSafeInteger(location.startLine) && location.startLine > 0 ? location.startLine : null;
  const end = start !== null && Number.isSafeInteger(location.endLine) && location.endLine > start
    ? Math.min(location.endLine, start + REPORT_LIMITS.permalinkLines - 1) : null;
  const anchor = start === null ? '' : end === null ? `#L${start}` : `#L${start}-L${end}`;
  return { url: `https://github.com/${facts.github.owner}/${facts.github.repo}/blob/${sha}/${encoded}${anchor}`,
    reason: null };
}
/** The reasons a link is missing that hold for the whole repository (no GitHub remote, a commit not on GitHub): said
 *  once, in the header (`header.noLinks`), never on each place. */
const REPO_WIDE_NO_LINK = Object.freeze(['remote', 'unpushed']);
/** A place's permalink (`permalinkOf`), noting a reason that holds for the whole repository in `ctx.noLinks` (by side,
 *  for a commit not on GitHub). */
function linkOf(ctx, location) {
  const link = permalinkOf(ctx.options, location);
  if (!link.url && REPO_WIDE_NO_LINK.includes(link.reason))
    ctx.noLinks.add(link.reason === 'unpushed' ? `unpushed:${location?.side === 'old' ? 'old' : 'new'}` : link.reason);
  return link;
}
/** The fixed sentence of a place's own missing link: its file differs from the last commit. */
const noLinkWords = (reason) => (reason === 'uncommitted' ? REPORT_ITEM_WORDS.noLinkUncommitted : null);

// ---- code excerpts -------------------------------------------------------------------------------------------------

/** The file's hash on a side, from the change's list of files, or null. */
function fileSha(report, path, side) {
  const file = list(report?.codePass?.files).find((f) => plain(f) && f.path === path);
  const sha = side === 'old' ? file?.baseSha256 : file?.sha256;
  return typeof sha === 'string' ? sha : null;
}
/** A code excerpt from a span the report stored with its file's hash: at most `excerptLines` lines of
 *  `excerptLineChars`, numbered from `startLine`, the lines in `changed` marked. Null when the hash differs from the
 *  file's in the change's list (`codeReceiptFound`'s rule) or the span is no text. */
function excerptOf(report, { path, side, startLine, span, sha256, changed = [], cut = 0 }) {
  if (typeof span !== 'string' || !span || !Number.isSafeInteger(startLine) || startLine < 1) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  const known = fileSha(report, path, side);
  if (known !== null && known !== sha256) return null;
  const all = visible(span).split('\n');
  const marked = new Set(list(changed).flatMap((r) => (Array.isArray(r) && r.length === 2
    && Number.isSafeInteger(r[0]) && Number.isSafeInteger(r[1]) ? Array.from({ length: Math.max(0, r[1] - r[0] + 1) },
      (_, i) => r[0] + i) : Number.isSafeInteger(r) ? [r] : [])));
  const lines = all.slice(0, REPORT_LIMITS.excerptLines).map((text, i) => ({ n: startLine + i,
    text: clip(text, REPORT_LIMITS.excerptLineChars), changed: marked.has(startLine + i) }));
  return { lines, more: Math.max(0, all.length - lines.length) + (Number.isSafeInteger(cut) && cut > 0 ? cut : 0) };
}
/** A code finding's excerpt: its `anchorSpan` (code-pass/10) when its hash matches, else the trace step on its anchor
 *  whose stored span grounds (`codeReceiptFound`). */
function findingExcerpt(report, f) {
  const anchor = plain(f?.anchor) ? f.anchor : null;
  if (!anchor) return null;
  // code-pass/10 records the anchor's lines as read: `{ startLine, lines, linesCut, charsCut }`.
  const span = plain(f.anchorSpan) && Array.isArray(f.anchorSpan.lines)
    && f.anchorSpan.lines.every((line) => typeof line === 'string') ? f.anchorSpan : null;
  if (span) {
    const own = excerptOf(report, { path: anchor.path, side: anchor.side ?? 'new',
      startLine: Number.isSafeInteger(span.startLine) ? span.startLine : anchor.startLine, span: span.lines.join('\n'),
      sha256: f.anchorSha256, changed: f.anchorChanged, cut: span.linesCut });
    if (own) return own;
  }
  const step = list(f.trace).find((t) => plain(t) && t.path === anchor.path && (t.side ?? 'new') === (anchor.side ?? 'new')
    && Number.isSafeInteger(t.startLine) && t.startLine <= anchor.endLine && t.endLine >= anchor.startLine
    && codeReceiptFound(report, t));
  return step ? excerptOf(report, { path: step.path, side: step.side ?? 'new', startLine: step.startLine,
    span: step.span, sha256: step.sha256 }) : null;
}

// ---- the item kinds -------------------------------------------------------------------------------------------------

/** Each item kind's type (triage.js ITEM_KIND_TABLE): set by the kind, never by the code review. */
export const ITEM_TYPES = Object.freeze(Object.fromEntries(REPORT_ITEM_KINDS.map((kind) => [kind,
  ITEM_KIND_TABLE[kind].type])));
const KIND_ORDER = new Map(REPORT_ITEM_KINDS.map((kind, i) => [kind, i]));
/** The source sets, in the order a tie is broken (D97). */
export const REPORT_SOURCES = Object.freeze(['requirements', 'decisions', 'pivots', 'writtenClaims', 'findings',
  'failures', 'promises', 'codePass.findings', 'codePass.questions', 'codePass.unconfirmed', 'codePass.withheld']);
const SOURCE_ORDER = new Map(REPORT_SOURCES.map((source, i) => [source, i]));
const rowKey = (source, index) => `${source}:${index}`;
const DECIDE_KINDS = Object.freeze(['decision_not_acting', 'decision_unasked', 'decision_chose', 'decision_whether_asked',
  'pivot']);
const LISTED_KINDS = Object.freeze(['claim_not_checked', 'claim_incomplete', 'written_not_checked']);

/** The rows of every source set, each `{ source, index, row }`, as the readers read them (D97). */
export function reportSources(report) {
  const rows = (key) => list(report?.[key]).map((row, index) => ({ row, index })).filter(({ row }) => plain(row));
  const out = [];
  for (const source of ['requirements', 'decisions', 'pivots', 'writtenClaims', 'findings', 'failures', 'promises'])
    for (const { row, index } of rows(source)) out.push({ source, index, row });
  codePassFindings(report).forEach((row, index) => out.push({ source: 'codePass.findings', index, row }));
  codePassQuestions(report).forEach((row, index) => out.push({ source: 'codePass.questions', index, row }));
  // D110: the findings code's label does not confirm, computed again from each one's stored check.
  codePassUnconfirmed(report).forEach((row, index) => out.push({ source: 'codePass.unconfirmed', index, row }));
  codePassWithheld(report).forEach((row, index) => out.push({ source: 'codePass.withheld', index, row }));
  return out;
}

/** Does this row cite a call that a permission rule or auto mode refused before it ran (PERMISSION_DENIALS)? A
 *  decision by its actions, a failure by its own call. Recorder fields only. */
export function refusedCall(session, row) {
  if (!plain(row)) return false;
  const refused = (id) => {
    const event = typeof id === 'string' ? session?.event?.(id) : null;
    return PERMISSION_DENIALS.includes(event?.recorded?.denial);
  };
  if (Array.isArray(row.actions)) return row.actions.some(refused);
  if (typeof row.eventId === 'string' && FAILURE_HANDLINGS.includes(row.handling)) {
    const result = session?.event?.(row.eventId);
    return refused(typeof row.action === 'string' ? row.action : result?.invocation);
  }
  return false;
}

/** E1-F8 (D112): is this failure row's own call a refused read by the recorder's types? Its call (the row's `action`,
 *  else its result's call) has the result class `did-not-run` (ledger.js `actionOutcome`: a typed denial other than a
 *  stop, `user-rejected` included, unlike `refusedCall`'s ceiling), and its tool writes nothing by type (ledger.js
 *  `writesNothing`: the slicer's read kind, or a command the recorder typed as only reading, searching or listing). A
 *  call the session does not hold is none. Recorder fields only: no command text and no word is read. */
export function refusedRead(session, row) {
  if (!plain(row) || typeof row.eventId !== 'string' || !FAILURE_HANDLINGS.includes(row.handling)) return false;
  const result = session?.event?.(row.eventId);
  const id = typeof row.action === 'string' ? row.action : result?.invocation;
  const call = typeof id === 'string' ? session?.event?.(id) : null;
  if (!writesNothing(call)) return false;
  try { return actionOutcome(session, call).class === 'did-not-run'; } catch { return false; }
}

// ---- your prompt (D97) -------------------------------------------------------------------------------------

const DONE_STATUSES = Object.freeze([DONE, ADDRESSED]);
const PARTLY_STATUSES = Object.freeze([PARTLY_DONE, PARTLY_ADDRESSED]);
const NOT_DONE_STATUSES = Object.freeze([NOT_DONE, OPEN]);
/** An ask's place on the count line (D93 split); its links read against the report (D110's review: `askRowKind`). */
function askState(req, report) {
  const code = askRowKind(req, report) === 'asksCodeFinding';
  if (DONE_STATUSES.includes(req.status)) return code ? 'doneCode' : 'done';
  if (PARTLY_STATUSES.includes(req.status)) return 'partly';
  if (NOT_DONE_STATUSES.includes(req.status)) return 'notDone';
  return code ? 'notCheckedCode' : 'notChecked';
}
const STATE_WORD = Object.freeze({ done: 'done', doneCode: 'done', partly: 'partly', notDone: 'notDone',
  notChecked: 'notChecked', notCheckedCode: 'notChecked' });
const PROMPT_PART_ORDER = Object.freeze(['done', 'doneCode', 'partly', 'notDone', 'notChecked', 'notCheckedCode']);

/**
 * The report rows each requirement stands for: a checklist row is its own (`checked`); a legacy requirement, grouped
 * from several rows, stands for the report rows of its message whose words are its own (`wording`) or whose located
 * quote overlaps its own — each row taken once, by the first requirement it fits.
 */
function requirementRows(session, report, asks) {
  const rows = list(report?.requirements);
  const taken = new Set();
  const out = new Map();
  for (const ask of asks) for (const req of ask.requirements) {
    if (plain(req.checked)) {
      const index = rows.indexOf(req.checked);
      if (index >= 0 && !taken.has(index)) { taken.add(index); out.set(req, [index]); continue; }
      out.set(req, []);
      continue;
    }
    const mine = [];
    rows.forEach((r, index) => {
      if (taken.has(index) || !plain(r) || !plain(r.instruction) || r.instruction.eventId !== req.ask
        || REQUIREMENT_STATUSES.includes(r.status) || typeof r.text !== 'string') return;
      let at = null;
      if (grounds(session, r.instruction)) {
        try { at = locateQuote(r.instruction, session.textSpansOf(session.event(req.ask), 'text')); } catch { at = null; }
      }
      const fits = r.text === req.wording || (at && list(req.located).some((q) => q.span === at.span && overlapping(q, at)));
      if (fits) { taken.add(index); mine.push(index); }
    });
    out.set(req, mine);
  }
  return out;
}

/** The asks of your prompt, numbered in message order and then by where they stand in the message. */
function promptAsks(session, report, facts) {
  const rowsOf = requirementRows(session, report, facts.asks);
  const asks = [];
  for (const message of facts.asks) {
    const own = message.requirements.map((req, order) => {
      const located = req.ask === message.event.id ? list(req.located).filter((q) => Number.isSafeInteger(q?.from)) : [];
      const first = located.reduce((best, q) => (best === null || q.span < best.span
        || (q.span === best.span && q.from < best.from) ? q : best), null);
      return { req, order, located, first };
    });
    own.sort((a, b) => (a.first === null) - (b.first === null)
      || (a.first && b.first ? a.first.span - b.first.span || a.first.from - b.first.from : 0) || a.order - b.order);
    for (const { req, located } of own) {
      const rows = rowsOf.get(req) ?? [];
      asks.push({ n: asks.length + 1, message: message.k, req, located, rows, state: askState(req, report),
        row: rows.length ? list(report.requirements)[rows[0]] : (plain(req.checked) ? req.checked : null) });
    }
  }
  return asks;
}

// ---- the model ---------------------------------------------------------------------------------------------------------

/**
 * The report model of one review. `session` is the Session the adapter built; `report` the finished review report;
 * `options` the CLI's facts: `title`, `sonahVersion`, `sessionHash`, `decisionReviews` (your earlier answers, by row
 * id), `repo` and `github` (D97). Frozen. Pure.
 *
 * The shape every reader renders (the contract of the page and the Markdown report). A **Part** is
 * `{ text, by, code, quote, cut, href }`: `by` is `sonah`, `session-review` or `code-review` (whose words; a reader
 * sets the reviews' words apart); `quote` true only for a verbatim quote found again in this session (a reader puts
 * it, and nothing else, in quotation marks, with `…` outside them when `cut`); `code` for code; `href` an in-page
 * anchor or null. A **Segment** of a message is `{ text }` (recorded text), `{ text, join: true }` (Sonah's join
 * between two recorded spans), `{ text, sonah: true }` (Sonah's sentence) or `{ text, ask, state, first }` (an ask's
 * located words). Every list is in display order.
 *
 * - `version`: `REPORT_MODEL_VERSION`.
 * - `header`: `title` (`{ text, parts, quoted, cut }` or null: your words as quote parts, the joins and the cut outside
 *   them; a caller's title as one plain part; `text` the plain text, for a page's `<title>`), `size` (the size line's
 *   parts), `runs` (line C's sentences), `reviewIncomplete` (sentences), `didNotCheck` (`{ lead, phrases, more }` or
 *   null), `noCode` (line E's sentences, or null when the code step ran).
 * - `countLine`: `tiers` (`[{ tier, words, n, folded }]`), `prompt` (its text), `labels` (`[{ n, parts }]`, the first
 *   Must act items' labels), `more` (Must act items past them), `empty` (the fixed pair, or null), `counts` (by tier).
 * - `prompt`: `asks` (`[{ n, message, state, status, words (Parts), quoted, located, item, lines (Part lists),
 *   codeMade, rowId }]`), `messages` (`[{ k, reply, segments, chars, cutAt, attached, pasted, asks, attachedAsks,
 *   unlocated }]`: each message that holds an ask; `cutAt` the characters shown open, or null), `emptyMessages`
 *   (`[{ k, segments, chars, pasted }]`: the messages that hold none), `counts` (by state), `parts` (the count words).
 * - `tiers`: `{ must_act, must_know, good_to_know }`, each a list of **Items**: `{ n, kind, type, tier: { default,
 *   proposed, final, bound }, what: { template, parts }, quote (a Part or null), quoteLabel, quoteMissing, agentSaid (a
 *   Part, or null when no quote of the agent's words is linked: never read as silence), agentSaidLabel, restsOutside (D110:
 *   for an item to verify, one Part list per premise of its check that Sonah could not check, in the check's words; else
 *   null), impact, action, label (Parts or null), where (`[{ path, side, startLine, endLine, url, noLink, excerpt }]` or `[{ anchor, text }]`; an excerpt is
 *   `{ lines: [{ n, text, changed }], more }`), whereMore (the places past `REPORT_LIMITS.where` not shown, counted), scope: { asks, notAsked, askedUnknown, preExisting }, related: { items,
 *   asks }, evidence (`[{ label, parts }]`, folded), why (its tier's sentence), rowId, answer ({ words, reason } or
 *   null), rows ([{ source, index }], the primary row first) }`.
 * - `did`: `files` (`{ groups: [{ ask, files: [{ path, type, counts, state, what, asks, link, items }] }], grouped,
 *   total, shown, more, outside: { n, paths, more, notInChange } | null, unconfirmed }`; `notInChange`: the code step's
 *   writes that are no file of its change, D109), `runs` (`{ shown: [{ k, text, tool, afterEdit, outcome, handling,
 *   item, failureIndex }], total, commands, others, quietExit0, cut, cutParts, neverRan, cutRuns }`: `commands` the
 *   runs that are commands, as the header counts them; `others` the calls of other tools a failure row answers for), `claims` (`{ shown: [{ anchor,
 *   source, index, status, item, quote, path, confirmedBy, why }], total, more, closing: { rows: [{ k, parts }],
 *   total }, notChecked: { claims, written } }`: every row's own status and words, `item` the item that holds it or a
 *   code finding's that follows from it), `leftOut` (`[{ item, quote }]`: a decision not to act, by the agent's words that ground),
 *   `settled` (`[{ index, parts, youSaid, youSaidLabel,
 *   rowId }]`).
 * - `notChecked`: `lead`, `code` (Part lists), `facts` (`[{ group, parts }]`), `withheld` (`[{ index, what, words, why,
 *   check }]`), `withheldTotal`, `unreadAsks`, `unreadRows` (sentences), `total`.
 * - `footer`: `provenance`, `legend` (three sentences), `triageLegend` (or null), `share`, `sessionHash` (or null).
 * - `placement`: `{ rows, version }`, `rows` by `source:index` (`reportPlacement`).
 */
export function reportModel(session, report, options = {}) {
  const r = plain(report) ? report : {};
  const opts = plain(options) ? options : {};
  const facts = storyFacts(session, r);
  const read = { ...r, findings: list(r.findings) };
  const honest = { ...read, ...honestStatuses(read) };
  const codePass = plain(r.codePass) ? r.codePass : null;
  const codeRan = codePass?.ran === true;
  // D109 (its review): the code step's one tally of the change (code-pass.js `codeChangeTally`), when it ran with a review
  // request and the change holds a file: the header's size line, its count of files the code review did not see, the
  // files that the agent changed and the coverage line all count these files, so they agree.
  const tally = codeRan ? codeChangeTally(codePass) : null;
  const change = tally !== null && tally.total > 0 ? tally : null;
  const ctx = { session, report: r, options: opts, facts, honest, codePass, codeRan, change,
    events: list(session?.events), orderOf: new Map(list(session?.events).map((e, i) => [e?.id, i])),
    answers: answersOf(opts.decisionReviews), noLinks: new Set() };
  ctx.asks = promptAsks(session, r, facts);
  ctx.askOfRow = new Map(ctx.asks.flatMap((ask) => ask.rows.map((index) => [index, ask])));
  ctx.triage = triageOf(r);
  ctx.codeTied = codeTiedRows(r);
  ctx.runs = runsOf(ctx);

  const candidates = candidatesOf(ctx);
  const items = placeItems(ctx, candidates);
  ctx.items = items;
  ctx.itemOfRow = new Map(items.flatMap((item) => item.rows.map((ref) => [rowKey(ref.source, ref.index), item.n])));
  for (const item of items) { finishItem(ctx, item); for (const member of item.members) finishItem(ctx, member); }
  const prompt = promptOf(ctx);
  const did = didOf(ctx);
  ctx.did = did;
  const notChecked = notCheckedOf(ctx);
  const header = headerOf(ctx, prompt);
  const shown = items.map(publicItem);
  const tiers = Object.fromEntries(REPORT_TIERS.map((tier) => [tier, shown.filter((item) => item.tier.final === tier)]));
  const countLine = countLineOf(ctx, tiers, prompt);
  const footer = footerOf(ctx, items);
  const model = { version: REPORT_MODEL_VERSION, header, countLine, prompt, tiers, did, notChecked, footer };
  model.placement = placementOf(ctx, candidates, model);
  return deepFreeze(model);
}

/** An item as the readers see it: its fields (D97), never the report's own rows. D112: `tier.from` (which row places
 *  the item), `own` (its lead's own tier) and `members` (`publicMember`, in the order they joined). */
const publicItem = (item) => ({ n: item.n, kind: item.kind, type: item.type, tier: { ...item.tier }, own: { ...item.own },
  what: item.what, quote: item.quote, quoteLabel: item.quoteLabel, quoteMissing: item.quoteMissing,
  agentSaid: item.agentSaid, agentSaidLabel: item.agentSaidLabel, restsOutside: item.restsOutside, impact: item.impact,
  action: item.action, label: item.label, where: item.where,
  whereMore: item.whereMore,
  scope: item.scope, related: item.related, evidence: item.evidence, why: item.why, rowId: item.rowId,
  answer: item.answer, rows: item.rows.map((ref) => ({ ...ref })), members: item.members.map(publicMember) });
/** A member of an item (D112) as the readers see it: the tie that joined it (REPORT_GROUP_TIES), its own tier, whether
 *  a reader shows it folded, its own lines (as an item's, but no number, label, scope or links of its own) and its
 *  rows. */
const publicMember = (member) => ({ kind: member.kind, type: member.type, tie: member.tie, tier: { ...member.tier },
  folded: member.foldedMember === true, what: member.what, quote: member.quote, quoteLabel: member.quoteLabel,
  quoteMissing: member.quoteMissing, agentSaid: member.agentSaid, agentSaidLabel: member.agentSaidLabel,
  impact: member.impact, action: member.action, where: member.where, whereMore: member.whereMore,
  evidence: member.evidence, why: member.why, rowId: member.rowId, answer: member.answer,
  rows: member.rows.map((ref) => ({ ...ref })) });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Your earlier answers (`options.decisionReviews`: a Map or an object, row id -> `{ verb, reason }`). */
function answersOf(value) {
  const entries = value instanceof Map ? [...value] : plain(value) ? Object.entries(value) : [];
  return new Map(entries.filter(([id, a]) => typeof id === 'string' && plain(a) && Object.hasOwn(REPORT_ANSWER_WORDS, a.verb)
    && typeof a.reason === 'string' && a.reason.trim()).map(([id, a]) => [id, { verb: a.verb, reason: a.reason }]));
}

// ---- the code step's triage (D97) -------------------------------------------------------------------------

/** The code step's triage entries, by the row they name (`row:source:index`, `finding:id`, `question:id`), each with
 *  its level, impact, action, label and `where` as code checked them; the first entry for a key stands. */
function triageOf(report) {
  const out = new Map();
  for (const entry of list(report?.codePass?.triage)) {
    if (!plain(entry) || !plain(entry.ref)) continue;
    const ref = entry.ref;
    const key = typeof ref.finding === 'string' ? `finding:${ref.finding}` : typeof ref.question === 'string'
      ? `question:${ref.question}` : typeof ref.source === 'string' && Number.isSafeInteger(ref.index)
        ? `row:${ref.source}:${ref.index}` : null;
    if (key === null || out.has(key)) continue;
    const text = (value, n) => (typeof value === 'string' && oneLine(value) ? clip(oneLine(value), n) : null);
    out.set(key, { level: TRIAGE_LEVELS.includes(entry.level) ? entry.level : null, impact: text(entry.impact, 200),
      action: text(entry.action, 160), label: text(entry.label, 48), where: plain(entry.where) ? entry.where : null });
  }
  return out;
}
/** The rows of the report a published finding of the code review follows from (`leadsFrom`) or one of its questions
 *  concerns (`concerns`), by `source:index`, each with the finding's or question's own row keys (`codePass.findings:i`,
 *  `codePass.questions:i`): structure only (D96 amended, 2026-10-16). */
function codeTiedRows(report) {
  const tied = new Map();
  const add = (ref, by) => {
    if (!plain(ref) || typeof ref.source !== 'string' || !Number.isSafeInteger(ref.index)) return;
    const key = rowKey(ref.source, ref.index);
    if (!tied.has(key)) tied.set(key, []);
    if (!tied.get(key).includes(by)) tied.get(key).push(by);
  };
  codePassFindings(report).forEach((f, i) => { for (const ref of list(f?.leadsFrom)) add(ref, rowKey('codePass.findings', i)); });
  codePassQuestions(report).forEach((q, i) => add(q?.concerns, rowKey('codePass.questions', i)));
  return tied;
}
/** The sources of a code finding's row: published as confirmed, and (D110) not confirmed. A triage entry names either
 *  by the finding's id. */
const CODE_FINDING_SOURCES = Object.freeze(['codePass.findings', 'codePass.unconfirmed']);
/** The tiers by rank, lowest first (triage.js's order): a tie lifts an item at most to the tier of the item that ties
 *  it. */
const TIER_RANK = Object.freeze({ [GOOD_TO_KNOW]: 0, [MUST_KNOW]: 1, [MUST_ACT]: 2 });
const triageKeyOf = (ref, row) => (CODE_FINDING_SOURCES.includes(ref.source) && typeof row?.id === 'string'
  ? `finding:${row.id}`
  : ref.source === 'codePass.questions' && typeof row?.id === 'string' ? `question:${row.id}`
    : `row:${ref.source}:${ref.index}`);

// ---- the runs (D97) -----------------------------------------------------------------------------------

const WRITE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);
/** A write that may have landed: a write invocation whose effect (`effect`, an evidence session.js `effectReader` over
 *  the session) is one of CHANGING_EFFECTS. D98 (one reading per recorder fact): the rule every reader of a change
 *  reads, so a write refused before it ran, or one the tool rejected, changed no file, and one the recorder typed as
 *  stopped may have. One rule for the header's runs line and the Runs list. */
const landedWrite = (effect, event) => event?.kind === 'invocation' && WRITE_OPERATIONS.includes(event.operation)
  && CHANGING_EFFECTS.includes(effect(event));
/** The command ends that do not show the command ran: refused before it ran (`did-not-run`), and failed or refused
 *  with the recorder marking neither (`failed-or-refused`). */
const NOT_SHOWN_RUN = Object.freeze(['did-not-run', 'failed-or-refused']);
/** A command that ran: one whose recorded end shows it ran (none of NOT_SHOWN_RUN). The header counts only these as
 *  run. */
const ranCommand = (session, event) => event?.kind === 'invocation' && event.operation === 'command'
  && !NOT_SHOWN_RUN.includes(actionOutcome(session, event).class);
/** A command that may have run: any but one the recorder typed as refused before it ran. A file is said to have no
 *  command after its last edit only when none of these follows it. */
const mayHaveRunCommand = (session, event) => event?.kind === 'invocation' && event.operation === 'command'
  && actionOutcome(session, event).class !== 'did-not-run';
/** Every command the recording holds, and every call of any tool a failure row answers for, in session order, each
 *  with its outcome (`actionOutcome`), its failure row (when one answers for it) and whether it ran after the agent's
 *  last edit. */
function runsOf(ctx) {
  const { session, report, events } = ctx;
  const failures = list(report.failures).map((row, index) => ({ row, index }))
    .filter(({ row }) => plain(row) && typeof row.eventId === 'string');
  const failureOfCall = new Map();
  for (const f of failures) {
    const result = session?.event?.(f.row.eventId);
    const call = typeof f.row.action === 'string' ? f.row.action : result?.invocation;
    if (typeof call === 'string' && !failureOfCall.has(call)) failureOfCall.set(call, f);
    else if (typeof call !== 'string') failureOfCall.set(`result:${f.row.eventId}`, f);
  }
  const effect = effectReader(session);
  const lastEdit = events.reduce((at, event, i) => (landedWrite(effect, event) ? i : at), -1);
  const runs = [];
  events.forEach((event, i) => {
    if (event?.kind !== 'invocation') return;
    const failure = failureOfCall.get(event.id) ?? null;
    if (event.operation !== 'command' && !failure) return;
    const outcome = actionOutcome(session, event);
    // Status fact (owner decision 2026-10-06): a zero status that does not cover every command of its line.
    const result = events.slice(i + 1).find((e) => e?.kind === 'observation' && e.invocation === event.id
      && e.phase === 'terminal');
    const uncovered = outcome.class === 'ran-exit-0' && result !== undefined && statusUncovered(result);
    let raw = '';
    try { raw = session.textSpansOf(event, 'command').join(' '); } catch { raw = ''; }
    runs.push({ event, at: i, command: event.operation === 'command', text: event.operation === 'command'
      ? failedCommandText(raw, REPORT_LIMITS.commandChars) : null, tool: typeof event.tool === 'string' ? event.tool : null,
    outcome, uncovered, failure, afterEdit: lastEdit >= 0 && i > lastEdit });
  });
  // A failure row whose call the recording does not hold is still placed: a run of its own, by its result.
  for (const f of failures) {
    if (runs.some((run) => run.failure === f)) continue;
    const result = session?.event?.(f.row.eventId);
    runs.push({ event: null, at: ctx.orderOf.get(f.row.eventId) ?? Infinity, command: false, text: null,
      tool: typeof f.row.tool === 'string' ? f.row.tool : null,
      outcome: result ? resultOutcome(session, result) : { class: 'no-terminal-status', form: NO_RESULT_OUTCOME_FORM },
      failure: f, afterEdit: false });
  }
  runs.sort((a, b) => a.at - b.at);
  runs.forEach((run, k) => { run.k = k + 1; });
  // The runs the Runs list shows, by the call each answers for: the ones it names (every run but a quiet exit 0), the
  // first `REPORT_LIMITS.runs` of them. A run link points only to one of these.
  const showable = runs.filter(showableRun);
  const shownByCall = new Map(showable.slice(0, REPORT_LIMITS.runs).filter((run) => run.event)
    .map((run) => [run.event.id, run]));
  return { runs, lastEdit, showable, shownByCall };
}
/** A run the Runs list names: any but one that exited 0, with a status that covers it, before the last edit, and
 *  answered for by no failure row. */
const showableRun = (run) => run.outcome.class !== 'ran-exit-0' || run.uncovered || run.afterEdit || run.failure;

// ---- the shown-in-part mark (D104) ---------------------------------------------------------------------------------

/**
 * D104 (F5 part 4): the mark of rows, as lines of parts: one line for each recorded result any of `refs` cites that
 * Sonah first showed the session review only in part (the row's `seenInPart`, read by `seenInPartOf`), in recorded
 * order, each result once. A line names the result's place — the run that produced it, linked, when the Runs list shows
 * that run; else its event in the recording, counted from 1 — and what Sonah left out (`REPORT_SEEN_WORDS.cut`). It
 * claims nothing of what those lines hold, nor of what they would settle. `refs`: `[{ source, row }]`, read only for the
 * session review's own sets (SEEN_IN_PART_SOURCES: a mark is code's, written there alone; the code step's rows carry
 * none). Structure only.
 */
function seenOf(ctx, refs) {
  const byEvent = new Map();
  for (const ref of refs) {
    if (!SEEN_IN_PART_SOURCES.includes(ref.source)) continue;
    for (const seen of seenInPartOf(ref.row)) if (!byEvent.has(seen.eventId)) byEvent.set(seen.eventId, seen);
  }
  const order = (seen) => ctx.orderOf.get(seen.eventId) ?? seen.sequence ?? Infinity;
  return [...byEvent.values()].sort((a, b) => order(a) - order(b)).map((seen) => {
    const event = ctx.session?.event?.(seen.eventId) ?? null;
    const run = typeof event?.invocation === 'string' ? ctx.runs.shownByCall.get(event.invocation) ?? null : null;
    const at = ctx.orderOf.get(seen.eventId) ?? seen.sequence;
    const place = run ? LINK(REPORT_SEEN_WORDS.ofRun(run.k), `run-${run.k}`)
      : S(Number.isSafeInteger(at) ? REPORT_SEEN_WORDS.atEvent(at + 1) : REPORT_SEEN_WORDS.aResult);
    return [S(`${REPORT_SEEN_WORDS.lead} `), place, S('. '), S(REPORT_SEEN_WORDS.cut(seen))];
  });
}

// ---- the candidates: every row's item kind or list ---------------------------------------------------------------------

/**
 * Every row of every source set, with the item kind it would be (`itemKindOf`) and where it goes otherwise. Merges
 * (D97) are applied here: a not-done or partly done ask named by an `ask_not_met` finding, and the claim a
 * `claim_false` finding contradicts (`contradictedBy`), fold into that finding's item; a promise a contradicted-claim finding cites folds into
 * that finding's item.
 */
function candidatesOf(ctx) {
  const { report, session } = ctx;
  const all = reportSources(report);
  const byKey = new Map(all.map((c) => [rowKey(c.source, c.index), c]));
  for (const c of all) {
    c.key = rowKey(c.source, c.index);
    c.kind = c.source === 'codePass.withheld' ? null : itemKindOf(c.source, c.row);
    c.place = null;
  }
  // Requirements: those `storyFacts` reads are asks; an ask not done or partly done is an item.
  const readRequirement = new Set(ctx.asks.flatMap((ask) => ask.rows));
  for (const c of all.filter((x) => x.source === 'requirements')) {
    if (!readRequirement.has(c.index)) { c.kind = null; c.place = { notChecked: 'unreadAsks' }; continue; }
    const ask = ctx.askOfRow.get(c.index);
    if (ask.rows[0] !== c.index) { c.kind = null; c.place = { ask: ask.n }; continue; }
    c.ask = ask;
    c.kind = ask.state === 'notDone' ? 'ask_not_done' : ask.state === 'partly' ? 'ask_partly_done' : null;
    if (c.kind === null) c.place = { ask: ask.n };
  }
  // Decisions you settled are listed; every other decision is an item.
  for (const c of all.filter((x) => x.source === 'decisions')) if (c.kind === null) c.place = { list: 'settled' };
  // Failures not passed over are runs.
  for (const c of all.filter((x) => x.source === 'failures')) {
    if (typeof c.row.eventId !== 'string') { c.kind = null; c.place = { notChecked: 'unreadRows' }; continue; }
    if (c.kind === null) c.place = { list: 'runs' };
  }
  // Promises: those the readers list are claims; the rest fold into the contradicted-claim finding that cites them.
  const listed = new Set(listedPromises(report));
  const findingsRows = list(report.findings);
  for (const c of all.filter((x) => x.source === 'promises')) {
    if (listed.has(c.row)) { c.listedClaim = true; continue; }
    const at = findingsRows.findIndex((f) => plain(f) && f.kind === 'claim_contradicted' && list(f.receipts)
      .some((rc) => sameReceipt(c.row.stated, rc)));
    if (at >= 0 && byKey.get(rowKey('findings', at))?.kind) { c.kind = null; c.foldInto = rowKey('findings', at); continue; }
    c.kind = null;
    c.place = { notChecked: 'unreadRows' };
  }
  // Written statements with a label outside the vocabulary, findings of no kind: read by no reader as a row.
  for (const c of all.filter((x) => ['writtenClaims', 'findings'].includes(x.source)))
    if (c.kind === null && c.place === null) c.place = { notChecked: 'unreadRows' };
  for (const c of all.filter((x) => x.source === 'writtenClaims' && typeof x.row.text !== 'string')) {
    c.kind = null; c.place = { notChecked: 'unreadRows' };
  }
  for (const c of all.filter((x) => x.source === 'codePass.withheld')) c.place = { notChecked: 'withheld' };
  // Merges (D97): by the code finding's own rows (`leadsFrom`).
  for (const c of all.filter((x) => x.source === 'codePass.findings')) {
    const refs = list(c.row.leadsFrom).filter((ref) => plain(ref) && typeof ref.source === 'string'
      && Number.isSafeInteger(ref.index));
    if (c.kind === 'code_ask_not_met') {
      for (const ref of refs.filter((x) => x.source === 'requirements')) {
        const target = byKey.get(rowKey('requirements', ref.index));
        if (target && ['ask_not_done', 'ask_partly_done'].includes(target.kind) && !target.foldInto)
          { target.foldInto = c.key; target.kind = null; }
      }
    }
    if (c.kind === 'code_claim_false') {
      // Only the row the finding contradicts, by that row's own code check, folds into it; every other row it follows
      // from keeps its own kind, status and quote (R10: an admission the finding cites is not contradicted by it).
      for (const ref of refs.filter((x) => ['promises', 'writtenClaims', 'findings'].includes(x.source))) {
        const target = byKey.get(rowKey(ref.source, ref.index));
        if (!target || target.foldInto) continue;
        if (ref.source === 'findings' && target.row.kind !== 'claim_contradicted') continue;
        if (!contradictedBy(ctx.report, target.row, c.row)) continue;
        target.foldInto = c.key;
        target.kind = null;
        target.place = null;
        target.byCode = true;
      }
    }
  }
  // Triage: a listed kind becomes an item only when the code review proposed medium or high.
  for (const c of all) {
    if (!LISTED_KINDS.includes(c.kind)) continue;
    const entry = ctx.triage.get(triageKeyOf(c, c.row));
    const tier = boundTier(c.kind, entry?.level ?? null, {});
    if (tier.final === null) { c.listedKind = c.kind; c.kind = null; c.place = { list: 'claims' }; }
  }
  for (const c of all.filter((x) => x.source === 'promises' && x.kind === null && x.place === null && !x.foldInto))
    c.place = { list: 'claims' };
  return all;
}
const sameReceipt = (a, b) => plain(a) && plain(b) && a.role === b.role && a.eventId === b.eventId
  && typeof a.quote === 'string' && a.quote === b.quote;

/** The items: one per candidate with a kind, its tier bounded, grouped (E1-F8, D112: `groupItems`), ordered (D97; by
 *  final level first since D112) and numbered across the three tiers. A row folded into another follows its target's
 *  chain to the item that holds it. */
function placeItems(ctx, candidates) {
  const byKey = new Map(candidates.map((c) => [c.key, c]));
  const items = [];
  const readOf = (c) => c.kind === 'failure_passed_over' && refusedRead(ctx.session, c.row);
  const bounds = (c, entry, tied) => boundTier(c.kind, entry?.level ?? null, { refused: refusedCall(ctx.session, c.row),
    unchecked: c.kind === 'code_question' && !plain(c.row.check), tied, refusedRead: readOf(c) });
  for (const c of candidates) {
    if (c.kind === null || c.foldInto) continue;
    const entry = ctx.triage.get(triageKeyOf(c, c.row)) ?? null;
    items.push({ kind: c.kind, type: ITEM_TYPES[c.kind], tier: bounds(c, entry, false), tied: false, tiedBy: null,
      triage: entry, primary: c, rows: [{ source: c.source, index: c.index }], folded: [], members: [], memberOf: null,
      tie: null, refusedRead: readOf(c) });
  }
  const itemOf = new Map(items.map((item) => [item.primary.key, item]));
  // Tied (D96 amended, R6): a published finding of the code review follows from this row, or one of its questions
  // concerns it, and that item is in the report. The tie lifts the row's item at most to the tier of the item that
  // ties it, never above it: only when the tying item's own tier is at least the kind's tied tier. The tying items'
  // own tiers never rest on a tie (their kinds have none), so one pass reads them.
  for (const item of items) {
    const tiedTier = ITEM_KIND_TABLE[item.kind].tiedTier;
    if (tiedTier === null) continue;
    const by = list(ctx.codeTied.get(item.primary.key)).map((key) => itemOf.get(key)).filter(Boolean)
      .sort((a, b) => TIER_RANK[b.tier.final] - TIER_RANK[a.tier.final]);
    if (!by.length || TIER_RANK[by[0].tier.final] < TIER_RANK[tiedTier]) continue;
    item.tier = bounds(item.primary, item.triage, true);
    item.tied = true;
    item.tiedBy = by[0];
  }
  const holder = (c, seen = new Set()) => {
    if (!c.foldInto || seen.has(c.key)) return itemOf.get(c.key) ?? null;
    seen.add(c.key);
    const target = byKey.get(c.foldInto);
    return target ? holder(target, seen) : null;
  };
  for (const c of candidates) {
    if (!c.foldInto) continue;
    const item = holder(c);
    if (item) { item.rows.push({ source: c.source, index: c.index }); item.folded.push(c); c.heldBy = item; }
    else { c.place = c.source === 'requirements' ? { ask: ctx.askOfRow.get(c.index)?.n ?? null } : { list: 'claims' }; }
  }
  const placed = groupItems(items, ctx.session);
  for (const item of items) item.scope = scopeOf(ctx, item);
  const firstAsk = (item) => (item.scope.asks.length ? Math.min(...item.scope.asks) : Infinity);
  // D112 (3): inside each section, by final level first (`levelOf`: high, medium, low, then none), then as before.
  const ordered = [...placed].sort((a, b) => levelOf(a) - levelOf(b) || KIND_ORDER.get(a.kind) - KIND_ORDER.get(b.kind)
    || firstAsk(a) - firstAsk(b) || SOURCE_ORDER.get(a.primary.source) - SOURCE_ORDER.get(b.primary.source)
    || a.primary.index - b.primary.index);
  const numbered = REPORT_TIERS.flatMap((tier) => ordered.filter((item) => item.tier.final === tier));
  numbered.forEach((item, i) => { item.n = i + 1; });
  return numbered;
}

const [CONCERNS_TIE, NESTED_TIE] = REPORT_GROUP_TIES;
const [FROM_LEAD, FROM_MEMBER] = REPORT_TIER_SOURCES;
/** A question that the code review wrote itself (code-pass.js publishes `from: 'review'`; `'finding'` is a finding its
 *  check found not against your goal, whose `concerns` no quote checked). */
const FROM_REVIEW = 'review';
/** A decision's stated quote, or null. */
const statedQuote = (item) => (typeof item.primary.row.stated?.quote === 'string' ? item.primary.row.stated.quote : null);
/** A proposal's rank for the order: the level's tier (high, medium, low), else none, last. */
const PROPOSED_RANK = Object.freeze({ [MUST_ACT]: 0, [MUST_KNOW]: 1, [GOOD_TO_KNOW]: 2 });
const proposedRank = (tier) => (tier.proposed === null ? REPORT_TIERS.length : PROPOSED_RANK[tier.proposed]);
/**
 * D112 (3): an item's final level, for its order inside its section: the highest level that the code review proposed
 * and code kept for a row that places the item in its tier (its lead, or a member whose own tier is the item's), high,
 * medium, low, then none. Read from the tier records alone.
 */
const levelOf = (item) => Math.min(...[item, ...item.members].filter((x) => x.tier.final === item.tier.final)
  .map((x) => proposedRank(x.tier)));

/** D112 amended: the fields of a row that name one recorded receipt, a list of receipts, or a list of event ids, as
 *  the ledger types them (a decision's statement, value and actions; a claim's statement; an ask's instruction,
 *  delivery and shortfall; a failure's call, result and response; a code finding's receipts and trace; a question's
 *  quote). Closed. */
const PLACE_RECEIPTS = Object.freeze(['stated', 'valueReceipt', 'instruction', 'deliverable', 'shortfall', 'response',
  'quote']);
const PLACE_RECEIPT_LISTS = Object.freeze(['receipts', 'trace']);
const PLACE_EVENT_IDS = Object.freeze(['eventId', 'action']);
const PLACE_EVENT_LISTS = Object.freeze(['actions']);
/**
 * D112 amended (2026-10-18; the owner: "go for fix first"): the place a row names, `{ events, files }` — the recorded
 * events its receipts and actions cite (`events`), the files those events name (the session's own paths, no lines), and
 * the files and lines its code receipts and its anchor name (a finding's, or a question's routed from one: `files`, each
 * `{ path, side, lines }`, `lines` null when no line is named). Read from the row's typed fields only, never a word.
 */
function placeOf(session, row) {
  const events = new Set();
  const files = [];
  if (!plain(row)) return { events, files };
  const event = (id) => {
    if (typeof id !== 'string' || !id || events.has(id)) return;
    events.add(id);
    for (const path of eventPaths(session, id)) files.push({ path, side: null, lines: null });
  };
  const span = (r) => (Number.isSafeInteger(r.startLine) && Number.isSafeInteger(r.endLine) && r.startLine <= r.endLine
    ? [r.startLine, r.endLine] : null);
  const code = (r) => files.push({ path: r.path, side: typeof r.side === 'string' ? r.side : 'new', lines: span(r) });
  const receipt = (r) => {
    if (typeof r === 'string') event(r);
    else if (plain(r) && typeof r.path === 'string' && r.path) code(r);
    else if (plain(r)) event(r.eventId);
  };
  for (const key of PLACE_RECEIPTS) receipt(row[key]);
  for (const key of PLACE_RECEIPT_LISTS) for (const r of list(row[key])) receipt(r);
  for (const key of PLACE_EVENT_IDS) event(row[key]);
  for (const key of PLACE_EVENT_LISTS) for (const id of list(row[key])) event(id);
  for (const anchor of [row.anchor, row.finding?.anchor]) if (plain(anchor) && typeof anchor.path === 'string'
    && anchor.path) code(anchor);
  return { events, files };
}
/** Whether two places overlap: one recorded event both name, or one file both name — on the same side, at lines that
 *  overlap, when both name lines; else the file alone (a session's edit names no line). Pure. */
function placesOverlap(a, b) {
  for (const id of a.events) if (b.events.has(id)) return true;
  return a.files.some((x) => b.files.some((y) => x.path === y.path && (x.lines === null || y.lines === null
    || (x.side === y.side && x.lines[0] <= y.lines[1] && y.lines[0] <= x.lines[1]))));
}
/** An item's place: its lead's rows and those folded into it, and its nested members' (D112 amended). */
const itemPlaceOf = (session, item) => {
  const place = { events: new Set(), files: [] };
  for (const one of [item, ...item.members.filter((m) => m.tie === NESTED_TIE)])
    for (const c of [one.primary, ...one.folded]) {
      const own = placeOf(session, c.row);
      for (const id of own.events) place.events.add(id);
      place.files.push(...own.files);
    }
  return place;
};

/**
 * E1-F8 (D112, owner 2026-10-17: "One point, one item"): the items that lead, each with the rows a checked tie joins to
 * it as its `members` (ledger.js REPORT_GROUP_TIES). Structure only, never a word:
 *   nested    two decisions whose stated receipts nest (ledger.js `nestedReceipts`, D102's one shared key: the same
 *             event, one quote holding the other) are one item. The decision with the longer quote leads (the earlier
 *             row on a tie); each decision joins the first lead, in that order, whose quote holds its own, so a member's
 *             quote always lies inside its lead's.
 *   concerns  a question that the code review wrote (`from: 'review'`; the code step grounded its quote in the words of
 *             the row it concerns before it published it) joins the item that holds that row, the lead's or a
 *             member's — D112 amended (2026-10-18): only when the question's own place (the events, files and lines
 *             its receipt or anchor names: `placeOf`) overlaps the item's place (`itemPlaceOf`, `placesOverlap`). The
 *             row its `concerns` names is the code review's word for what it is about; a place both name is a fact of
 *             the recording. A question whose quote the code step found only in the words the session review wrote of
 *             the row (`quote` null) names no place, and stays its own item. A question on an ask stays its own item,
 *             as before (your prompt shows its line); so does a question routed from a finding, and one whose row no
 *             item holds.
 * A finding never joins anything, and no D97 fold moves. The item takes the higher of its rows' tiers: the lead's own
 * (`own`), or a member's when that is higher (`tier.from` `member`), so no row of an item sits below the tier it has
 * alone — a question's own tier among them — and no member is lifted: each keeps its own tier, shown folded when that
 * tier is below the item's or when it repeats its lead (`nested`). Returns the leads; every member carries `memberOf`
 * and `tie`.
 */
function groupItems(items, session = null) {
  const join = (into, item, tie) => { item.memberOf = into; item.tie = tie; into.members.push(item); };
  const decisions = items.filter((item) => item.primary.source === 'decisions' && statedQuote(item) !== null)
    .sort((a, b) => statedQuote(b).length - statedQuote(a).length || a.primary.index - b.primary.index);
  const leads = [];
  for (const d of decisions) {
    const into = leads.find((lead) => nestedReceipts(lead.primary.row.stated, d.primary.row.stated));
    if (into) join(into, d, NESTED_TIE); else leads.push(d);
  }
  const holderOf = new Map();
  for (const item of items.filter((x) => !x.memberOf))
    for (const one of [item, ...item.members]) for (const ref of one.rows) holderOf.set(rowKey(ref.source, ref.index), item);
  for (const item of items) {
    const concerns = item.primary.row.concerns;
    if (item.kind !== 'code_question' || item.primary.row.from !== FROM_REVIEW || !plain(concerns)
      || typeof concerns.source !== 'string' || concerns.source === 'requirements' || !Number.isSafeInteger(concerns.index))
      continue;
    const into = holderOf.get(rowKey(concerns.source, concerns.index));
    if (into && into !== item && placesOverlap(placeOf(session, item.primary.row), itemPlaceOf(session, into)))
      join(into, item, CONCERNS_TIE);
  }
  const placed = items.filter((item) => !item.memberOf);
  for (const item of placed) {
    item.own = item.tier;
    let setter = item;
    for (const member of item.members) {
      if (TIER_RANK[member.tier.final] > TIER_RANK[setter.tier.final]) setter = member;
      for (const c of member.folded) c.heldBy = item;
      item.rows.push(...member.rows);
    }
    item.tier = { ...setter.tier, from: setter === item ? FROM_LEAD : FROM_MEMBER };
    item.setter = setter;
    for (const member of item.members)
      member.foldedMember = member.tie === NESTED_TIE || TIER_RANK[member.tier.final] < TIER_RANK[item.tier.final];
  }
  return placed;
}

/** Whether you asked for an item (D97): the asks it is tied to by structure, and its decision's marker. */
function scopeOf(ctx, item) {
  const { primary } = item;
  const asks = new Set();
  const askOfIndex = (index) => ctx.askOfRow.get(index)?.n ?? null;
  for (const ref of item.rows) if (ref.source === 'requirements' && askOfIndex(ref.index)) asks.add(askOfIndex(ref.index));
  if (CODE_FINDING_SOURCES.includes(primary.source))
    for (const ref of list(primary.row.leadsFrom))
      if (plain(ref) && ref.source === 'requirements' && askOfIndex(ref.index)) asks.add(askOfIndex(ref.index));
  let notAsked = false, askedUnknown = false;
  if (primary.source === 'decisions') {
    const column = derivedColumn(primary.row);
    notAsked = column === UNASKED;
    askedUnknown = column === null;
    const instruction = primary.row.constrainedBy?.instruction;
    if (plain(instruction) && grounds(ctx.session, instruction)) {
      let at = null;
      try { at = locateQuote(instruction, ctx.session.textSpansOf(ctx.session.event(instruction.eventId), 'text')); }
      catch { at = null; }
      if (at) for (const ask of ctx.asks)
        if (ask.req.ask === instruction.eventId && ask.located.some((q) => q.span === at.span && overlapping(q, at)))
          asks.add(ask.n);
    }
  }
  return { asks: [...asks].sort((a, b) => a - b), notAsked, askedUnknown, preExisting: false };
}

// ---- one item's fields (D97) ---------------------------------------------------------------------

const locationOf = (ctx, { path, side = 'new', startLine = null, endLine = null, excerpt = null }) => {
  const link = linkOf(ctx, { path, side, startLine, endLine });
  return { path, side, startLine, endLine, url: link.url, noLink: link.url ? null : noLinkWords(link.reason),
    excerpt };
};
const sameRange = (a, b) => a.path === b.path && a.side === b.side && a.startLine === b.startLine && a.endLine === b.endLine;
const anchorOf = (anchor, text) => ({ anchor, text });

/** Fills an item's visible and folded fields from its rows. */
function finishItem(ctx, item) {
  const { session } = ctx;
  const row = item.primary.row;
  const entry = item.triage;
  const ev = [];
  const evidence = (label, parts) => ev.push({ label, parts });
  // Who said a quote is read from the recording: a statement a helper's own session recorded is the helper's.
  const speaker = (receipt, label) => (plain(receipt) && receipt.role === 'commentary'
    && typeof session?.event?.(receipt.eventId)?.childId === 'string' ? REPORT_ITEM_WORDS.helperSaid : label);
  const quote = (label, receipt) => { const q = quoteOf(session, receipt); if (q) evidence(speaker(receipt, label), [q]);
    return q; };
  // Whose words a quote is, by its receipt's role: one rule for every item whose quote line shows a receipt's quote —
  // yours (or a project instruction file's), the agent's (or a helper's), a recorded result, the agent's action, or
  // the change.
  const roleLabel = (receipt) => (receipt.role === 'instruction' || receipt.role === PROJECT_INSTRUCTIONS_ROLE
    ? yourLabel(session, receipt, REPORT_ITEM_WORDS.youSaid)
    : receipt.role === 'commentary' ? speaker(receipt, REPORT_ITEM_WORDS.agentSaid)
      : receipt.role === 'observation' ? REPORT_ITEM_WORDS.recordedResult
        : receipt.role === 'action' ? REPORT_ITEM_WORDS.agentDid : REPORT_ITEM_WORDS.changeShows);
  let what = [], quoteLine = null, quoteLabel = null, quoteMissing = false, agentSaid = null, agentSaidLabel = null;
  let where = [], rowId = null;
  const label = { text: null, parts: null, numbered: false };
  const ask = item.primary.ask ?? null;
  const shortfallLabel = (r) => (r?.role === 'commentary' ? REPORT_ITEM_WORDS.agentSaid : r?.role === 'observation'
    ? REPORT_ITEM_WORDS.recordedResult : REPORT_ITEM_WORDS.changeShows);
  const codeWhere = (f) => {
    const anchor = plain(f?.anchor) && typeof f.anchor.path === 'string' ? f.anchor : null;
    return anchor ? locationOf(ctx, { path: anchor.path, side: anchor.side ?? 'new', startLine: anchor.startLine,
      endLine: anchor.endLine, excerpt: findingExcerpt(ctx.report, f) }) : null;
  };
  const sessionFile = (receipt) => (plain(receipt) && ['code', 'action'].includes(receipt.role)
    ? eventPaths(session, receipt.eventId).slice(0, 1).map((path) => locationOf(ctx, { path })) : []);
  const askNotes = (askRow) => askCodeNotes(ctx.report, askRow).map((note) => {
    const subject = typeof note.subject === 'string' && note.subject ? [S(' '), C(words(note.subject))] : [];
    return { label: null, parts: [S(sentence(note.words)), ...subject] };
  });
  const finding = CODE_FINDING_SOURCES.includes(item.primary.source);
  // D110: the premises of a finding's stored check that Sonah could not check (an `outside` one, or any that cannot
  // confirm: `premiseConfirms`), each shown in the check's own words on a visible line of an item to verify.
  const restsOutside = [];
  /** A code receipt's quote as code, under its label, when it is found literally in the span stored with it. */
  const codeQuote = (r) => {
    if (!codeReceiptFound(ctx.report, r)) return;
    const code = quoted(r.quote);
    evidence(r.side === 'old' ? REPORT_ITEM_WORDS.codeBefore : REPORT_ITEM_WORDS.codeNow, [
      ...(typeof r.path === 'string' ? [CODE(`${r.path}:${r.startLine}`), S(' ')] : []), CODE(code.text),
      ...(code.cut ? [S('…')] : [])]);
  };
  // D110: under the premise contract, the label code computes again from the stored check (`findingConfirmed`), never
  // the check's own word, and each premise beside where its evidence is: its source in fixed words, a code receipt as
  // code. A report made before it keeps the words of the gate of its day.
  const checkEvidence = (f) => {
    const explanation = plain(f.check) && typeof f.check.explanation === 'string' && f.check.explanation.trim()
      ? [S(' '), C(words(f.check.explanation, 300))] : [];
    if (!premiseRuled(ctx.report?.codePass) || !plain(f.check)) {
      if (explanation.length) evidence(REPORT_ITEM_WORDS.check, [S(CODE_REPORT_WORDS.checkHolds), ...explanation]);
      return;
    }
    evidence(REPORT_ITEM_WORDS.check, [S(findingConfirmed(f.check) ? CODE_REPORT_WORDS.checkConfirmed
      : CODE_REPORT_WORDS.checkUnconfirmed), ...explanation]);
    for (const p of list(f.check.premises).filter((x) => plain(x) && typeof x.premise === 'string' && x.premise.trim())) {
      // A premise that cannot confirm is said as one Sonah could not check, whatever source it names.
      const confirms = premiseConfirms(p);
      evidence(REPORT_ITEM_WORDS.restsOn, [C(words(p.premise, TRACE_LIMITS.premiseChars)), S(' '),
        S(CODE_REPORT_WORDS.premiseSources[confirms ? p.source : 'outside'])]);
      for (const r of list(p.receipts).filter(plain)) codeQuote(r);
      if (!confirms) restsOutside.push([C(words(p.premise, TRACE_LIMITS.premiseChars))]);
    }
  };
  // A trace step's quote: a session step's is a verbatim quote of the recording; a code step's is the code as the
  // code review read it (checked against the span it stored, `codeReceiptFound`), so it is code under its own label
  // ("The code now:", "The code before the session:"), never in the recording's quotation marks.
  const traceEvidence = (f) => {
    for (const step of list(f.trace).filter(plain)) {
      const parts = [];
      if (typeof step.step === 'string' && step.step.trim()) parts.push(C(words(step.step, 300)));
      const fromSession = step.source === 'session' || step.side === 'session';
      const recorded = fromSession ? quoteOf(session, step) : null;
      if (recorded) parts.push(S(' '), recorded);
      if (parts.length) evidence(REPORT_ITEM_WORDS.trace, parts);
      if (fromSession) continue;
      codeQuote(step);
    }
    for (const claim of findingClaims(f)) evidence(null, [C(words(claim.text, 300))]);
    if (typeof f.input === 'string' && f.input.trim()) evidence(REPORT_ITEM_WORDS.forExample, [C(words(f.input, 300))]);
    checkEvidence(f);
  };

  switch (item.kind) {
    case 'ask_not_done': case 'ask_partly_done': {
      what = ONE(item.kind === 'ask_not_done' ? REPORT_WHAT_WORDS.ask_not_done(ask.n) : REPORT_WHAT_WORDS.ask_partly_done(ask.n));
      const checked = plain(ask.req.checked) ? ask.req.checked : null;
      quoteLine = ask.req.quoted && checked ? quoteOf(session, checked.instruction)
        : ask.req.quoted ? quoted(ask.req.text) : null;
      quoteMissing = !quoteLine;
      where.push(anchorOf(`ask-${ask.n}`, REPORT_ITEM_WORDS.asked(ask.n)));
      if (item.kind === 'ask_partly_done' && checked) {
        if (!quote(REPORT_ITEM_WORDS.whatDoes, checked.deliverable)) evidence(REPORT_ITEM_WORDS.whatDoes, ONE(REPORT_ITEM_WORDS.noFindingRest));
        where.push(...sessionFile(checked.deliverable));
      }
      if (checked) {
        const label = item.kind === 'ask_partly_done' ? REPORT_ITEM_WORDS.whatMissing : shortfallLabel(checked.shortfall);
        if (!quote(label, checked.shortfall)) evidence(null, ONE(item.kind === 'ask_partly_done'
          ? REPORT_ITEM_WORDS.noFindingRest : REPORT_ITEM_WORDS.noFinding));
        where.push(...sessionFile(checked.shortfall));
        ev.push(...askNotes(checked));
      }
      rowId = checked ? requirementRowId(checked) : null;
      label.text = REPORT_KIND_LABELS.ask(ask.n);
      label.numbered = true;
      break;
    }
    case 'code_ask_not_met': case 'code_claim_false': case 'code_bug': case 'code_contract': case 'code_weak_test':
    case 'code_finding_legacy': case 'code_finding_unconfirmed': {
      const f = row;
      what = [typeof f.title === 'string' && f.title.trim() ? C(words(f.title)) : S(REPORT_WHAT_WORDS.noTitle)];
      if (finding || plain(f.anchor)) { const w = codeWhere(f); if (w) where.push(w); }
      if (!where.length) for (const rc of list(f.receipts).filter(plain)) {
        if (typeof rc.path === 'string' && rc.path) { where.push(locationOf(ctx, { path: rc.path, side: rc.side ?? 'new',
          startLine: rc.startLine ?? null, endLine: rc.endLine ?? null })); break; }
        const paths = eventPaths(session, rc.eventId);
        if (paths.length) { where.push(locationOf(ctx, { path: paths[0] })); break; }
      }
      if (item.kind === 'code_claim_false') {
        // The quote of the claim it contradicts (the row folded into it), labelled by whose words they are.
        for (const c of item.folded) {
          const receipt = c.source === 'promises' || c.source === 'writtenClaims' ? c.row.stated
            : c.source === 'findings' ? list(c.row.receipts).find((x) => x?.role === 'commentary') : null;
          const q = quoteOf(session, receipt);
          if (q) { quoteLine = q; quoteLabel = roleLabel(receipt); break; }
        }
      }
      if (finding) traceEvidence(f);
      else for (const rc of list(f.receipts).filter(plain)) quote(null, rc);
      if (item.kind === 'code_ask_not_met')
        for (const ref of list(f.leadsFrom).filter((x) => plain(x) && x.source === 'requirements'))
          ev.push(...askNotes(list(ctx.report.requirements)[ref.index]));
      rowId = typeof f.id === 'string' ? f.id : null;
      const anchor = plain(f.anchor) ? f.anchor : null;
      label.text = item.kind === 'code_finding_legacy' || !anchor ? null
        : REPORT_KIND_LABELS.place(anchor.path, anchor.startLine);
      break;
    }
    case 'claim_contradicted': case 'claim_corrected': {
      const f = row;
      const source = CONTRADICTION_SOURCES.includes(f.contradictionSource) ? f.contradictionSource : CONTRADICTION_SOURCES[0];
      what = ONE(REPORT_WHAT_WORDS.contradicts(REPORT_CONTRADICTION_SOURCES[source]));
      if (item.kind === 'claim_corrected' && Object.hasOwn(REPORT_DISCLOSURE_WORDS.claim, f.disclosureReason))
        what.push(S(' '), S(REPORT_DISCLOSURE_WORDS.claim[f.disclosureReason]));
      const said = list(f.receipts).find((x) => plain(x) && x.role === 'commentary');
      quoteLine = quoteOf(session, said);
      quoteMissing = !quoteLine;
      if (quoteLine) quoteLabel = speaker(said, null);
      const claimRow = item.folded.find((c) => c.source === 'promises');
      if (claimRow) where.push(anchorOf(`claim-${claimRow.index + 1}`, REPORT_ITEM_WORDS.claimsList));
      const against = list(f.receipts).find((x) => plain(x) && x.role === CONTRADICTION_ROLES[source] && x !== said);
      quote(contradictionWords(session, source, against), against);
      where.push(...sessionFile(against));
      rowId = typeof f.id === 'string' ? f.id : null;
      label.text = item.kind === 'claim_contradicted' ? REPORT_KIND_LABELS.claim : null;
      break;
    }
    case 'edit_against_instruction': case 'edit_undone': {
      const f = row;
      what = ONE(REPORT_WHAT_WORDS.editAgainst);
      if (item.kind === 'edit_undone' && Object.hasOwn(REPORT_DISCLOSURE_WORDS.edit, f.disclosureReason))
        what.push(S(' '), S(REPORT_DISCLOSURE_WORDS.edit[f.disclosureReason]));
      const said = list(f.receipts).find((x) => plain(x) && (x.role === 'instruction' || x.role === PROJECT_INSTRUCTIONS_ROLE));
      quoteLine = quoteOf(session, said);
      quoteMissing = !quoteLine;
      if (quoteLine && said.role === PROJECT_INSTRUCTIONS_ROLE) {
        const source = session?.event?.(said.eventId);
        quoteLabel = typeof source?.path === 'string' ? REPORT_ITEM_WORDS.referredFrom(referredPath(source.path)) : null;
      } else if (quoteLine) quoteLabel = REPORT_ITEM_WORDS.youSaid;
      const did = list(f.receipts).find((x) => plain(x) && (x.role === 'action' || x.role === 'code'));
      quote(REPORT_ITEM_WORDS.breach[f.breach] ?? REPORT_ITEM_WORDS.agentDid, did);
      where.push(...sessionFile(did));
      const told = disclosedEdit(f);
      if (told) quote(REPORT_ITEM_WORDS.agentTold, told);
      rowId = typeof f.id === 'string' ? f.id : null;
      label.text = item.kind === 'edit_against_instruction' ? REPORT_KIND_LABELS.edit : null;
      break;
    }
    case 'written_contradicted': case 'written_not_checked': {
      const w = row;
      const path = writtenPath(session, w);
      const shownPath = path ?? REPORT_WHAT_WORDS.aFile;
      what = item.kind === 'written_contradicted'
        ? [S(`${REPORT_CONTRADICTION_SOURCES[w.contradictionSource === OWN_WRITTEN_SOURCE ? OWN_WRITTEN_SOURCE : 'result']} `
          + 'contradicts a statement that the agent wrote into '), path ? CODE(path) : S(shownPath), S('.')]
        : [S('Sonah did not check a statement that the agent wrote into '), path ? CODE(path) : S(shownPath), S('.')];
      quoteLine = quoteOf(session, w.stated);
      quoteMissing = !quoteLine;
      if (path) where.push(locationOf(ctx, { path }));
      for (const rc of list(w.receipts).filter((x) => plain(x) && !sameReceipt(x, w.stated)))
        quote(rc.role === 'observation' ? REPORT_ITEM_WORDS.recordedResult : REPORT_ITEM_WORDS.codeWritten, rc);
      rowId = typeof w.id === 'string' ? w.id : null;
      label.text = item.kind === 'written_contradicted' && path ? REPORT_KIND_LABELS.written(fileName(path)) : null;
      break;
    }
    case 'failure_passed_over': {
      const f = row;
      const run = ctx.runs.runs.find((x) => x.failure?.row === f) ?? null;
      const outcome = run?.outcome ?? { class: 'no-terminal-status', form: NO_RESULT_OUTCOME_FORM };
      const tool = run?.tool ?? (typeof f.tool === 'string' ? f.tool : null);
      const lead = Object.hasOwn(REPORT_WHAT_WORDS.failure, partOf(outcome)) ? partOf(outcome) : 'other';
      const kind = run?.event?.recorded?.denial ?? null;
      what = tool ? [S(`${REPORT_WHAT_WORDS.failureLead} `), CODE(tool), S(` ${REPORT_WHAT_WORDS.failureCall} `)]
        : [S(`${REPORT_WHAT_WORDS.aCallLead} `)];
      what.push(S(REPORT_WHAT_WORDS.failure[lead]));
      // Who refused it, only as far as the recording types it (R15): never a raw token, never "you" for a kind that
      // also covers a prompt no person could be shown.
      if (lead === 'did-not-run') what.push(S(' '), S(Object.hasOwn(REPORT_REFUSAL_WORDS, kind)
        ? REPORT_REFUSAL_WORDS[kind] : REPORT_REFUSAL_WORDS['user-rejected']), S('.'));
      what.push(S(' '), S(REPORT_WHAT_WORDS.failureTail));
      quoteLine = run?.text ? CODE(run.text) : null;
      if (run) where.push(anchorOf(`run-${run.k}`, REPORT_ITEM_WORDS.run(run.k)));
      const outcomeWords = REPORT_OUTCOME_WORDS[outcome.class]?.[outcome.form];
      if (outcomeWords) evidence(null, ONE(capital(outcomeWords(exitOf(session, run?.event), kind ?? ''))));
      quote(REPORT_ITEM_WORDS.turnEnded, f.response);
      rowId = failureRowId(f);
      label.text = REPORT_KIND_LABELS.failure;
      break;
    }
    case 'decision_not_acting': case 'decision_unasked': case 'decision_chose': case 'decision_whether_asked': {
      const d = row;
      // What the decision is about (its dimension) stands in the what line beside what the agent chose, so the reader
      // sees what the agent left alone or settled without opening the evidence (D97).
      // A decision not to act sets its dimension and its choice apart behind labels: the fixed words never attach a
      // negation to the session review's words, however it words them ("not to act on Leaving X alone" read backwards).
      const about = typeof d.dimension === 'string' && d.dimension.trim() ? d.dimension : null;
      const chosen = typeof d.chosen === 'string' && d.chosen.trim() ? R(words(d.chosen)) : S('…');
      if (about !== null && item.kind === 'decision_not_acting') {
        what = [S(`${REPORT_WHAT_WORDS.notActingAbout} `), R(words(about)), S(`. ${REPORT_WHAT_WORDS.notActingDecision} `),
          chosen, S('.')];
      } else {
        const lead = about === null ? (item.kind === 'decision_not_acting' ? REPORT_WHAT_WORDS.notActing
          : item.kind === 'decision_chose' ? REPORT_WHAT_WORDS.choseHow : REPORT_WHAT_WORDS.decided)
          : item.kind === 'decision_chose' ? REPORT_WHAT_WORDS.choseHowOn : REPORT_WHAT_WORDS.decidedOn;
        what = [S(`${lead} `), ...(about === null ? [] : [R(words(about)), S(': ')]), chosen, S('.')];
      }
      const asked = d.constrainedBy?.instruction;
      if (item.kind === 'decision_chose') {
        quoteLine = quoteOf(session, asked);
        if (quoteLine) quoteLabel = yourLabel(session, asked, REPORT_ITEM_WORDS.youAsked);
      } else if (item.kind === 'decision_not_acting') quote(yourLabel(session, asked, REPORT_ITEM_WORDS.youAsked), asked);
      // The agent's own words only: a statement that is a recorded result is never shown as what the agent said.
      agentSaid = d.stated?.role === 'commentary' ? quoteOf(session, d.stated) : null;
      if (agentSaid && speaker(d.stated, null)) agentSaidLabel = REPORT_ITEM_WORDS.helperSaid;
      // A value is code written only on the written side of its write; an action's value is what the agent did.
      if (d.valueReceipt?.role === 'action') quote(REPORT_ITEM_WORDS.agentDid, d.valueReceipt);
      else if (onWrittenSide(session, d.valueReceipt)) quote(REPORT_ITEM_WORDS.codeWritten, d.valueReceipt);
      if (item.kind === 'decision_unasked' && plain(d.instructionReview)) {
        const checks = list(d.instructionReview.checks).filter(plain);
        const fileOf = (c) => (c.instruction?.role === PROJECT_INSTRUCTIONS_ROLE
          ? session?.event?.(c.instruction.eventId) : null);
        const files = [...new Set(checks.map(fileOf).filter((e) => typeof e?.path === 'string')
          .map((e) => referredPath(e.path)))];
        const messages = checks.filter((c) => !fileOf(c)).length;
        if (checks.length) evidence(null, ONE(REPORT_ITEM_WORDS.checkedAgainst(messages, files)));
      }
      if (item.kind === 'decision_whether_asked') {
        const reason = list(d.reasons).find((x) => Object.hasOwn(REPORT_COLUMN_REASON_WORDS, x));
        if (reason) evidence(null, ONE(REPORT_COLUMN_REASON_WORDS[reason]));
      }
      const triageWhere = entry?.where && codeReceiptFound(ctx.report, entry.where) ? entry.where : null;
      if (triageWhere) where.push(locationOf(ctx, { path: triageWhere.path, side: triageWhere.side ?? 'new',
        startLine: triageWhere.startLine, endLine: triageWhere.endLine, excerpt: excerptOf(ctx.report, triageWhere) }));
      else if (plain(d.valueReceipt) && eventPaths(session, d.valueReceipt.eventId).length)
        where.push(locationOf(ctx, { path: eventPaths(session, d.valueReceipt.eventId)[0] }));
      else for (const path of new Set(list(d.actions).flatMap((id) => eventPaths(session, id))))
        where.push(locationOf(ctx, { path }));
      rowId = typeof d.id === 'string' ? d.id : null;
      // "decision on {dimension}": the session review's words set apart as its own (D97).
      label.parts = typeof d.dimension === 'string' && d.dimension.trim() ? [S(`${REPORT_KIND_LABELS.decision} `),
        R(oneLine(d.dimension).split(' ').slice(0, REPORT_LIMITS.labelWords - 2).join(' '))] : null;
      break;
    }
    case 'pivot': {
      const p = row;
      what = typeof p.abandoned === 'string' && typeof p.adopted === 'string'
        ? [S(`${REPORT_WHAT_WORDS.pivotFrom} `), R(words(p.abandoned)), S(` ${REPORT_WHAT_WORDS.pivotTo} `),
          R(words(p.adopted)), S('.')] : ONE(REPORT_WHAT_WORDS.pivotUnnamed);
      const receipts = list(p.receipts).filter(plain);
      const first = receipts.find((x) => x.role === 'commentary' && grounds(session, x));
      agentSaid = first ? quoted(first.quote) : null;
      if (first && speaker(first, null)) agentSaidLabel = REPORT_ITEM_WORDS.helperSaid;
      for (const rc of receipts.filter((x) => x !== first).slice(0, 2)) quote(null, rc);
      if (entry?.where && codeReceiptFound(ctx.report, entry.where)) where.push(locationOf(ctx, { path: entry.where.path,
        side: entry.where.side ?? 'new', startLine: entry.where.startLine, endLine: entry.where.endLine,
        excerpt: excerptOf(ctx.report, entry.where) }));
      label.text = REPORT_KIND_LABELS.pivot;
      break;
    }
    case 'code_question': case 'code_question_finding': {
      const q = row;
      if (item.kind === 'code_question_finding') {
        const title = plain(q.finding) && typeof q.finding.title === 'string' ? q.finding.title : q.question;
        what = [C(words(title))];
        evidence(null, ONE(CODE_REPORT_WORDS.fromFindingWords));
        const w = codeWhere(q.finding);
        if (w) where.push(w);
      } else {
        // The whole question as the code review wrote it, on one line: no sentence of it is picked by its punctuation
        // or words (its first sentence was often background, the question itself folded away). The code step bounds
        // it (code-pass.js TRACE_LIMITS.questionChars); the clip only guards a report that did not pass that check.
        const text = oneLine(q.question);
        what = [C(clip(text, REPORT_LIMITS.questionChars))];
        quoteLine = plain(q.quote) ? quoteOf(session, q.quote) : null;
        if (quoteLine) quoteLabel = roleLabel(q.quote);
        const concerns = plain(q.concerns) && typeof q.concerns.source === 'string' && Number.isSafeInteger(q.concerns.index)
          ? q.concerns : null;
        if (concerns) {
          const target = ctx.itemOfRow.get(rowKey(concerns.source, concerns.index));
          const askN = concerns.source === 'requirements' ? ctx.askOfRow.get(concerns.index)?.n : null;
          // D112: a member's row is in its own item, which it never names as a place.
          if (target && target !== (item.n ?? item.memberOf?.n)) where.push(anchorOf(`item-${target}`,
            REPORT_ITEM_WORDS.item(target)));
          else if (!target && askN) where.push(anchorOf(`ask-${askN}`, REPORT_ITEM_WORDS.asked(askN)));
        }
      }
      if (plain(q.check) && typeof q.check.explanation === 'string' && q.check.explanation.trim())
        evidence(REPORT_ITEM_WORDS.check, [C(words(q.check.explanation, 300))]);
      rowId = typeof q.id === 'string' ? q.id : null;
      label.text = REPORT_KIND_LABELS.question;
      break;
    }
    case 'claim_not_checked': case 'claim_incomplete': {
      const p = row;
      what = ONE(item.kind === 'claim_not_checked' ? REPORT_WHAT_WORDS.claimNotChecked : REPORT_WHAT_WORDS.claimIncomplete);
      quoteLine = quoteOf(session, p.stated);
      quoteMissing = !quoteLine;
      where.push(anchorOf(`claim-${item.primary.index + 1}`, REPORT_ITEM_WORDS.claimsList));
      if (Object.hasOwn(CHECKLIST_CLAIM_REASON_WORDS, p.reason)) evidence(null, ONE(sentence(CHECKLIST_CLAIM_REASON_WORDS[p.reason])));
      if (item.kind === 'claim_incomplete') for (const id of list(p.restsOn).filter((x) => typeof x === 'string').slice(0, 5)) {
        const run = ctx.runs.runs.find((x) => x.event?.id === id);
        if (run) evidence(null, [LINK(REPORT_ITEM_WORDS.run(run.k), `run-${run.k}`)]);
      }
      rowId = typeof p.id === 'string' ? p.id : null;
      break;
    }
    default: break;
  }
  // A row's code check, when the code contradicts it.
  const checkLine = codeCheckLine(ctx.report, row);
  if (checkLine && !item.primary.source.startsWith('codePass.')) evidence(null, ONE(checkLine));
  // D104: the mark of every row the item holds (its own, then those folded into it), one line a result.
  for (const parts of seenOf(ctx, [item.primary, ...item.folded].map((c) => ({ source: c.source, row: c.row }))))
    evidence(REPORT_SEEN_WORDS.label, parts);
  // The first ask a code finding names, for its item's evidence; a decision's related rows.
  item.related = relatedOf(ctx, item);
  // The triage `where`, when the code review named a different range than the item's first location.
  if (entry?.where && codeReceiptFound(ctx.report, entry.where) && !DECIDE_KINDS.includes(item.kind)) {
    const loc = { path: entry.where.path, side: entry.where.side ?? 'new', startLine: entry.where.startLine,
      endLine: entry.where.endLine };
    // Its own excerpt, always: the nested-place rule below may keep this place and drop the one that held an excerpt.
    if (!where.some((w) => w.path && sameRange(w, loc))) where.push(locationOf(ctx, { ...loc,
      excerpt: excerptOf(ctx.report, entry.where) }));
  }
  // A place inside another place of the same file and side names lines already named: only the outer place is shown
  // (of two places with the same lines, the first) (D97).
  const holds = (o, w) => typeof o.path === 'string' && o.path === w.path && o.side === w.side
    && Number.isSafeInteger(o.startLine) && Number.isSafeInteger(w.startLine) && o.startLine <= w.startLine
    && (o.endLine ?? o.startLine) >= (w.endLine ?? w.startLine);
  where = where.filter((w, i) => !where.some((o, j) => j !== i && holds(o, w) && !(holds(w, o) && i < j)));
  const placesCut = cutTo(where, REPORT_LIMITS.where);
  where = placesCut.shown;
  item.whereMore = placesCut.more;
  // One excerpt an item, chosen only after the places are settled: the first kept place that has one leads, and the
  // others show none.
  const firstWithExcerpt = where.findIndex((w) => w.excerpt);
  if (firstWithExcerpt > 0) where = [where[firstWithExcerpt], ...where.filter((_, i) => i !== firstWithExcerpt)];
  where = where.map((w, i) => (i === 0 || !w.excerpt ? w : { ...w, excerpt: null }));
  // Why it is in its tier. D112: an item a member places says so; a tie by a question inside the same item names no
  // item number. A member says why it alone is in its own tier.
  const kindWords = REPORT_KIND_WORDS[item.kind];
  const tierWords = REPORT_TIER_WORDS[item.tier.final];
  const holding = item.memberOf ?? item;
  const own = item.tier.from === FROM_MEMBER ? null : item.tier;
  const whyText = own === null ? REPORT_TIER_WHY.held(REPORT_KIND_WORDS[item.setter.kind], tierWords)
    : own.bound === 'refused_call_ceiling' ? REPORT_TIER_WHY.refused
      : own.proposed === null && item.tied ? (item.tiedBy.memberOf === holding ? REPORT_TIER_WHY.tiedHere(tierWords)
        : REPORT_TIER_WHY.tied(item.tiedBy.n ?? item.tiedBy.memberOf?.n, tierWords))
        : own.proposed === null && item.refusedRead ? REPORT_TIER_WHY.refusedRead(tierWords)
          : own.proposed === null ? REPORT_TIER_WHY.byDefault(kindWords, tierWords)
            : own.bound === null ? REPORT_TIER_WHY.kept(REPORT_LEVEL_WORDS[entry.level])
              : REPORT_TIER_WHY.bounded(REPORT_LEVEL_WORDS[entry.level], kindWords, REPORT_TIER_WORDS[own.proposed]);
  // The code review's label, else the fixed kind label. A fixed label that does not name its item by a number (two
  // findings on one line, two false claims) ends with the item's number, so no two labels read the same (D97). A
  // member has no label: the count line names items.
  const fixed = label.parts ?? (label.text ? [S(label.text)] : null);
  const labelParts = item.memberOf ? null : entry?.label ? [C(entry.label)] : fixed === null
    ? [S(REPORT_KIND_LABELS.item(item.n))] : label.numbered ? fixed : [...fixed, S(' '), S(REPORT_KIND_LABELS.ofItem(item.n))];
  const answer = rowId ? ctx.answers.get(rowId) ?? null : null;
  Object.assign(item, {
    what: Object.freeze({ template: item.kind, parts: what }),
    quote: quoteLine, quoteLabel, quoteMissing: quoteMissing && !quoteLine,
    // The agent's own words, when the session review linked a quote of them that grounds here; else no line at all. A
    // missing quote says only that none was linked, never that the agent was silent.
    agentSaid,
    agentSaidLabel,
    // D110: an item to verify names each premise that Sonah could not check, on a visible line of its own.
    restsOutside: item.kind === 'code_finding_unconfirmed' && restsOutside.length ? restsOutside : null,
    impact: entry?.impact ? [C(entry.impact)] : null,
    action: entry?.action ? [C(entry.action)] : null,
    label: labelParts,
    where,
    evidence: ev,
    why: whyText,
    rowId,
    answer: answer ? { words: REPORT_ANSWER_WORDS[answer.verb], reason: answer.reason } : null,
  });
  delete item.triage;
}
/** A row's code check, shown only when the code contradicts it (D93 amended): its fixed sentence, or null. */
const CONTRADICTED_BY_CODE = 'contradicted-by-code';
/** Does the published claim_false finding `f` contradict `row`? Only by the row's own code check (code-pass.js marks
 *  the one row each such finding contradicts, naming the finding; a check of an earlier pass names none), as every
 *  reader reads it (code-pass.js `codeRowCheck`, D110's review: under the premise contract, only beside a finding that
 *  code's label confirms). One rule for the item's merge, its quote and the claims list. Structure only. */
const contradictedBy = (report, row, f) => {
  const check = codeRowCheck(report, row);
  return check?.outcome === CONTRADICTED_BY_CODE && (check.finding === undefined || check.finding === f?.id);
};
const codeCheckLine = (report, row) => (codeRowCheck(report, row)?.outcome === CONTRADICTED_BY_CODE
  ? sentence(CODE_REPORT_WORDS.outcomes[CONTRADICTED_BY_CODE]) : null);

/** The label of what contradicts a claim, by its source; a project instruction file by its recorded path. */
function contradictionWords(session, source, receipt) {
  if (source === 'project_instructions') {
    const event = plain(receipt) ? session?.event?.(receipt.eventId) : null;
    return typeof event?.path === 'string' ? REPORT_ITEM_WORDS.referredFrom(referredPath(event.path)) : null;
  }
  return { result: REPORT_ITEM_WORDS.recordedResult, human_message: REPORT_ITEM_WORDS.youSaid,
    file_content: REPORT_ITEM_WORDS.changeShows, own_written: REPORT_ITEM_WORDS.codeWritten }[source] ?? null;
}
const exitOf = (session, event) => {
  if (!event) return null;
  const result = list(session?.events).find((e) => e?.kind === 'observation' && e.invocation === event.id
    && e.phase === 'terminal');
  return Number.isSafeInteger(result?.exitCode) ? result.exitCode : null;
};

/** The items and asks an item is joined to by structure: a code finding's other rows, a question's row. */
function relatedOf(ctx, item) {
  const items = new Set(), asks = new Set(item.scope.asks);
  const refs = CODE_FINDING_SOURCES.includes(item.primary.source) ? list(item.primary.row.leadsFrom)
    : item.primary.source === 'codePass.questions' && plain(item.primary.row.concerns) ? [item.primary.row.concerns] : [];
  for (const ref of refs.filter(plain)) {
    const n = ctx.itemOfRow.get(rowKey(ref.source, ref.index));
    if (n && n !== item.n) items.add(n);
  }
  for (const other of ctx.items) {
    if (other === item || !CODE_FINDING_SOURCES.includes(other.primary.source)) continue;
    if (list(other.primary.row.leadsFrom).some((ref) => plain(ref) && item.rows.some((x) => x.source === ref.source
      && x.index === ref.index))) items.add(other.n);
  }
  return { items: [...items].sort((a, b) => a - b), asks: [...asks].sort((a, b) => a - b) };
}

// ---- your prompt, marked up -------------------------------------------------------------------------------------------

function promptOf(ctx) {
  const { session, facts, report } = ctx;
  const findingItem = (id, source = 'codePass.findings') => ctx.items.find((item) => item.primary.source === source
    && item.primary.row.id === id) ?? null;
  // The item that holds a question: its own, or (D112) the item it is a member of.
  const questionItem = (index) => {
    const q = list(report.codePass?.questions)[index];
    return ctx.items.find((item) => [item, ...item.members].some((x) => x.primary.source === 'codePass.questions'
      && x.primary.row === q)) ?? null;
  };
  const askLines = ctx.asks.map((ask) => {
    const req = ask.req;
    const checked = plain(req.checked) ? req.checked : null;
    const itemN = ctx.itemOfRow.get(rowKey('requirements', ask.rows[0] ?? -1)) ?? null;
    const lines = [];
    const notes = checked ? askCodeNotes(report, checked) : [];
    if ((ask.state === 'done' || ask.state === 'doneCode') && checked?.deliverable?.role === 'commentary')
      lines.push(ONE(REPORT_PROMPT_WORDS.agentOnly));
    if (ask.state === 'doneCode' || ask.state === 'notCheckedCode') {
      const linked = notes.find((note) => plain(note.finding));
      lines.push(ONE(REPORT_PROMPT_WORDS.codeFinding(linked ? findingItem(linked.finding.id)?.n ?? null : null)));
    }
    if ((ask.state === 'partly' || ask.state === 'notDone') && itemN !== null) lines.push(ONE(REPORT_ITEM_WORDS.seeItem(itemN)));
    if (ask.state === 'notChecked' || ask.state === 'notCheckedCode') {
      // D101: a row the quote gate lowered says which test refused its quote (its cause), with code's numbers.
      const why = checked ? checklistReasonWords(checked, 'requirement') : null;
      const reason = why ? sentence(why) : null;
      const fact = checked ? list(checked.facts).find((x) => Object.hasOwn(CHECKLIST_REQUIREMENT_FACT_WORDS, x)) : null;
      if (reason) lines.push(ONE(reason));
      else if (fact) lines.push(ONE(CHECKLIST_REQUIREMENT_FACT_WORDS[fact]));
    }
    const askCheck = codeCheckLine(report, checked);
    if (askCheck) lines.push(ONE(askCheck));
    // D104: the mark of the ask's rows (its checklist row, or the rows an earlier report's ask stands for).
    const askRows = [...new Set([...ask.rows.map((index) => list(report.requirements)[index]), checked].filter(plain))];
    lines.push(...seenOf(ctx, askRows.map((row) => ({ source: 'requirements', row }))));
    for (const note of notes) {
      if (note.link === 'withheld_finding') {
        const w = list(report.codePass?.withheld)[note.withheld];
        const why = w ? withheldWhy(w) : null;
        lines.push([S(why ? REPORT_PROMPT_WORDS.withheldFinding(why) : `${REPORT_PROMPT_WORDS.withheldFinding('').slice(0, -3)}.`),
          S(' '), LINK(REPORT_PROMPT_WORDS.withheldSee, 'not-checked')]);
      } else if (note.link === 'question_concerns') {
        lines.push(ONE(REPORT_PROMPT_WORDS.codeQuestion(questionItem(note.question)?.n ?? null)));
      } else if (note.link === 'unconfirmed_finding') {
        // D110: a finding Sonah could not confirm never moves the ask: a line beside it, naming its item to verify.
        lines.push(ONE(REPORT_PROMPT_WORDS.unconfirmedFinding(findingItem(note.unconfirmed.id, 'codePass.unconfirmed')?.n
          ?? null)));
      }
    }
    // Sonah's own row for a message no row cited (`codeMade`) has no words of anyone's: only its status and reason.
    const askText = checked?.codeMade === true ? [] : req.quoted ? [quoted(req.text)] : [R(words(req.text))];
    return { n: ask.n, message: ask.message, state: ask.state, status: REPORT_PROMPT_WORDS.status[STATE_WORD[ask.state]],
      words: askText, quoted: req.quoted === true, located: ask.located.length > 0, item: itemN, lines,
      codeMade: checked?.codeMade === true,
      rowId: checked ? requirementRowId(checked) : null };
  });
  // The messages that hold an ask, each cut at its asks' located spans; the others counted.
  const messages = [];
  const empty = [];
  for (const message of facts.asks) {
    const own = ctx.asks.filter((ask) => ask.message === message.k);
    const pasted = plain(message.pasted) && (message.pasted.images || message.pasted.others)
      ? REPORT_PROMPT_WORDS.pasted(message.pasted.images ?? 0, message.pasted.others ?? 0) : null;
    let spans = [];
    try { spans = session.textSpansOf(message.event, 'text'); } catch { spans = []; }
    // A message that holds no ask: its recorded spans as recorded, the join between two of them Sonah's; no span, the
    // fixed sentence that says so (never a quote of Sonah's own words).
    if (!own.length) {
      const segments = spans.length ? spans.flatMap((text, s) => [...(s > 0 ? [{ text: JOIN, join: true }] : []), { text }])
        : [{ text: REPORT_PROMPT_WORDS.withheldMessage, sonah: true }];
      empty.push({ k: message.k, segments, chars: [...segments.map((x) => x.text).join('')].length, pasted });
      continue;
    }
    const marks = [];
    const overlaps = new Map();
    for (const ask of own) for (const q of ask.located) {
      const clash = marks.find((m) => m.span === q.span && m.from < q.until && q.from < m.until);
      if (clash) { overlaps.set(ask.n, clash.n); const from = Math.max(q.from, clash.until);
        if (from < q.until && !(q.from < clash.from)) { marks.push({ span: q.span, from, until: q.until, n: ask.n }); }
        continue; }
      marks.push({ span: q.span, from: q.from, until: q.until, n: ask.n });
    }
    const segments = [];
    spans.forEach((text, s) => {
      if (s > 0) segments.push({ text: JOIN, join: true });
      const here = marks.filter((m) => m.span === s).sort((a, b) => a.from - b.from);
      let at = 0;
      for (const m of here) {
        if (m.from < at) continue;
        if (m.from > at) segments.push({ text: text.slice(at, m.from) });
        segments.push({ text: text.slice(m.from, m.until), ask: m.n,
          state: own.find((a) => a.n === m.n).state, first: !segments.some((x) => x.ask === m.n) });
        at = m.until;
      }
      if (at < text.length) segments.push({ text: text.slice(at) });
    });
    if (!spans.length) segments.push({ text: REPORT_PROMPT_WORDS.withheldMessage, sonah: true });
    for (const [n, m] of overlaps) askLines[n - 1].lines.unshift(ONE(REPORT_PROMPT_WORDS.overlaps(m)));
    const total = [...segments.map((x) => x.text).join('')].length;
    messages.push({ k: message.k, reply: message.reply === true, segments, chars: total,
      cutAt: total > REPORT_LIMITS.messageChars ? REPORT_LIMITS.messageChars : null,
      attached: message.attachments.length, pasted,
      asks: own.map((ask) => ask.n),
      // An ask whose words are in a file you attached to the message (its own event), and one Sonah could not find.
      attachedAsks: own.filter((ask) => ask.req.ask !== message.event.id).map((ask) => ask.n),
      unlocated: own.filter((ask) => !ask.located.length && ask.req.ask === message.event.id).map((ask) => ask.n) });
  }
  const counts = Object.fromEntries(PROMPT_PART_ORDER.map((state) => [state, ctx.asks.filter((ask) => ask.state === state).length]));
  return { asks: askLines, messages, emptyMessages: empty, counts,
    parts: PROMPT_PART_ORDER.filter((state) => counts[state] > 0).map((state) => REPORT_PROMPT_PARTS[state](counts[state])) };
}

// ---- what the agent did (D97) ------------------------------------------------------------------------------

function didOf(ctx) {
  const { session, report, facts, codePass } = ctx;
  const itemsOnPath = (path) => ctx.items.filter((item) => item.where.some((w) => w.path === path)).map((item) => item.n);
  // Files. D109 (its review): with the code step's one tally, the files of the change (`ctx.change`): every file the
  // coverage line counts, a recorded write that lies in a folder the code review could read among them; else, with a git
  // base, the change's files whose lines the change block holds; else the recording's own writes.
  const recordOf = new Map(list(codePass?.files).filter((f) => plain(f) && typeof f.path === 'string')
    .map((f) => [f.path, f]));
  const codeFiles = ctx.change ? ctx.change.units.map((u) => recordOf.get(u.path) ?? { path: u.path })
    : ctx.codeRan && codePass?.base?.kind === 'git'
      ? list(codePass.files).filter((f) => plain(f) && typeof f.path === 'string' && !CODE_OUTSIDE_STATES.includes(f.state))
      : null;
  const storyFile = new Map(facts.whole.files.map((f) => [f.path, f]));
  const askOfRef = (ref) => (plain(ref) && ref.source === 'requirements' ? ctx.askOfRow.get(ref.index)?.n ?? null : null);
  let files;
  if (codeFiles) {
    files = codeFiles.map((f) => {
      const counts = Number.isSafeInteger(f.added) && Number.isSafeInteger(f.removed) ? `+${f.added} −${f.removed}`
        : storyFile.has(f.path) ? lineWord(storyFile.get(f.path).counts) : null;
      const state = f.state && f.state !== 'shown' && Object.hasOwn(CODE_REPORT_WORDS.states, f.state)
        ? CODE_REPORT_WORDS.states[f.state] : null;
      const asks = Array.isArray(f.asks) ? [...new Set(f.asks.map(askOfRef).filter(Boolean))] : null;
      // A recorded write the change block does not hold lies outside the change block's repository or files: no link.
      return { path: f.path, type: REPORT_DID_WORDS.fileTypes[f.type] ?? REPORT_DID_WORDS.fileTypes.modified, counts, state,
        what: typeof f.what === 'string' && f.what.trim() ? [C(words(f.what, 100))] : null, asks,
        link: CODE_OUTSIDE_STATES.includes(f.state) ? null
          : linkOf(ctx, { path: f.path, side: f.type === 'deleted' ? 'old' : 'new' }).url,
        items: itemsOnPath(f.path) };
    });
  } else {
    files = facts.whole.files.map((f) => ({ path: f.path, type: f.operations.has('delete') && f.operations.size === 1
      ? REPORT_DID_WORDS.fileTypes.deleted : REPORT_DID_WORDS.fileTypes.modified, counts: lineWord(f.counts), state: null,
    what: null, asks: null, link: null, items: itemsOnPath(f.path) }));
  }
  const grouped = files.some((f) => Array.isArray(f.asks));
  const groups = grouped ? [...[...new Set(files.flatMap((f) => (f.asks?.length ? [f.asks[0]] : [])))].sort((a, b) => a - b)
    .map((n) => ({ ask: n, files: files.filter((f) => f.asks?.[0] === n) })),
  { ask: null, files: files.filter((f) => !f.asks?.length) }].filter((g) => g.files.length) : [{ ask: null, files }];
  const shownFiles = REPORT_LIMITS.files;
  // The writes outside the files above: with the code step's one tally, those it counts and that are no file of the
  // change (its record's writes outside the change block that the tally does not hold, `notInChange`, the footer's
  // count); else the recording's writes outside its write scope.
  const tallied = ctx.change ? new Set(ctx.change.units.map((u) => u.path)) : null;
  const outsidePaths = tallied ? [...new Set(list(codePass.files).filter((f) => plain(f) && typeof f.path === 'string'
    && CODE_OUTSIDE_STATES.includes(f.state) && !tallied.has(f.path)).map((f) => f.path))] : [...facts.whole.outsidePaths];
  const outsideCut = cutTo(outsidePaths, 3);
  const outside = outsidePaths.length ? { n: outsidePaths.length, paths: outsideCut.shown, more: outsideCut.more,
    notInChange: tallied !== null } : null;
  // Runs.
  const { runs, showable } = ctx.runs;
  const quietExit0 = runs.filter((run) => !showable.includes(run));
  const shown = showable.slice(0, REPORT_LIMITS.runs);
  const cut = showable.slice(REPORT_LIMITS.runs);
  const runLine = (run) => {
    const outcomeWords = REPORT_OUTCOME_WORDS[run.outcome.class]?.[run.outcome.form];
    const handling = run.failure ? run.failure.row.handling : null;
    const itemN = run.failure ? ctx.itemOfRow.get(rowKey('failures', run.failure.index)) ?? null : null;
    return { k: run.k, text: run.text, tool: run.tool, afterEdit: run.afterEdit,
      outcome: run.uncovered ? REPORT_DID_WORDS.uncoveredExit
        : outcomeWords ? outcomeWords(exitOf(session, run.event), run.event?.recorded?.denial ?? '') : null,
      handling: handling && Object.hasOwn(REPORT_DID_WORDS.handling, handling) ? REPORT_DID_WORDS.handling[handling]
        : handling ? REPORT_DID_WORDS.handling[FAILURE_NOT_CHECKED] : null,
      item: itemN, failureIndex: run.failure?.index ?? null,
      // D104: the mark of its failure row, the one row a run shows.
      seen: run.failure ? seenOf(ctx, [{ source: 'failures', row: run.failure.row }]) : [] };
  };
  const cutParts = RESULT_PART_ORDER.map((cls) => [cls, cut.filter((run) => partOf(run.outcome) === cls).length])
    .filter(([, n]) => n > 0).map(([cls, n]) => REPORT_RESULT_PARTS[cls](n));
  // Files no command ran after.
  const neverRan = neverRanPaths(ctx);
  // Claims: every promise and written statement, in session order.
  const claimRows = [
    ...list(report.promises).map((p, index) => ({ source: 'promises', index, row: p })),
    ...list(report.writtenClaims).map((w, index) => ({ source: 'writtenClaims', index, row: w })),
  ].filter(({ row }) => plain(row)).map((x) => ({ ...x, at: ctx.orderOf.get(x.row.stated?.eventId) ?? Infinity }))
    .sort((a, b) => a.at - b.at || SOURCE_ORDER.get(a.source) - SOURCE_ORDER.get(b.source) || a.index - b.index);
  // A row a published code finding follows from (`leadsFrom`) links to that finding's item, keeping its own status;
  // D110: a finding to verify's item too.
  const codeLink = new Map();
  for (const item of ctx.items.filter((x) => CODE_FINDING_SOURCES.includes(x.primary.source)))
    for (const ref of list(item.primary.row.leadsFrom).filter(plain))
      if (!codeLink.has(rowKey(ref.source, ref.index))) codeLink.set(rowKey(ref.source, ref.index), item.n);
  const claims = claimRows.map(({ source, index, row }) => {
    // The item that holds the row (its own item, or the one it is folded into), else a code finding's that names it.
    const held = ctx.itemOfRow.get(rowKey(source, index)) ?? null;
    const item = held === null ? null : ctx.items.find((x) => x.n === held) ?? null;
    // One status rule for every row, whatever item holds or names it; the row's words are always shown.
    const status = item?.kind === 'code_claim_false' ? 'contradictedByCode'
      : item && (['claim_contradicted', 'claim_corrected', 'written_contradicted'].includes(item.kind)
        || (source === 'promises' && item.primary.source === 'findings')) ? 'contradicted'
        : codeCheckLine(report, row) ? 'contradictedByCode'
          : source === 'writtenClaims' ? (row.label === WRITTEN_CONTRADICTED ? 'contradicted' : 'notChecked')
            : row.status === PROMISE_VERIFIED ? 'checked' : row.status === PROMISE_INCOMPLETE ? 'incomplete' : 'notChecked';
    return { anchor: `claim-${source === 'promises' ? index + 1 : `w${index + 1}`}`, source, index, statusKey: status,
      status: REPORT_DID_WORDS.claimStatus[status], item: held ?? codeLink.get(rowKey(source, index)) ?? null,
      quote: quoteOf(session, row.stated), path: source === 'writtenClaims' ? writtenPath(session, row) : null,
      // Status fact (owner decision 2026-10-06): a claim confirmed by a recorded result shows the result's own words it
      // was confirmed through, when they ground here.
      confirmedBy: status === 'checked' ? quoteOf(session, list(row.receipts).find((x) => plain(x)
        && x.role === 'observation')) : null,
      // Why a claim kept with its weakest status is not checked (S6, owner decision D71 b), in the closed reason's words.
      why: status === 'notChecked' && source === 'promises' && Object.hasOwn(CHECKLIST_CLAIM_REASON_WORDS, row.reason)
        ? sentence(CHECKLIST_CLAIM_REASON_WORDS[row.reason]) : null,
      // D104: the mark of the claim's row.
      seen: seenOf(ctx, [{ source, row }]) };
  });
  const shownClaims = claims.slice(0, REPORT_LIMITS.claims);
  // What Sonah did not check, counted from this list's own statuses: the header and What Sonah could not check say
  // the same numbers the list shows. A claim that rests on a check that did not finish is one Sonah did not check too:
  // its row says so in its own words, and it is counted here with the rows that say "not checked".
  const UNCHECKED_STATUSES = ['notChecked', 'incomplete'];
  const notCheckedOfSource = (source) => claims.filter((c) => c.source === source
    && UNCHECKED_STATUSES.includes(c.statusKey)).length;
  // Closing lines no claim covers.
  const closing = closingLinesOf(ctx);
  // What the agent said it did not do: only the agent's own words, a decision not to act whose quote grounds. A row
  // with no such words is not listed under this heading: a decision whose quote does not ground is its item, in the
  // session review's words (a missing quote is not silence), and an ask not done is in your prompt and its item, by
  // the session review's status.
  // D112: a decision not to act that is a member of an item is listed too, by the item that holds it.
  const leftOut = ctx.items.flatMap((item) => [item, ...item.members].filter((x) => x.kind === 'decision_not_acting')
    .map((x) => ({ item: item.n, quote: quoteOf(session, x.primary.row.stated) }))).filter((x) => x.quote);
  // Decisions you settled.
  const settled = list(report.decisions).map((d, index) => ({ d, index }))
    .filter(({ d }) => plain(d) && d.notActing !== true && derivedColumn(d) === SETTLED)
    .map(({ d, index }) => ({ index, parts: [R(words(d.dimension ?? '')), S(': '), R(words(d.chosen ?? ''))],
      youSaid: typeof d.constrainedBy?.settledValueQuote === 'string' && plain(d.constrainedBy?.instruction)
        ? quoteOf(session, { ...d.constrainedBy.instruction, quote: d.constrainedBy.settledValueQuote }) : null,
      youSaidLabel: yourLabel(session, d.constrainedBy?.instruction, REPORT_ITEM_WORDS.youSaid),
      rowId: typeof d.id === 'string' ? d.id : null,
      // D104: the mark of the decision.
      seen: seenOf(ctx, [{ source: 'decisions', row: d }]) }));
  return {
    files: { groups, grouped, total: files.length, shown: Math.min(files.length, shownFiles),
      more: Math.max(0, files.length - shownFiles), outside, unconfirmed: facts.whole.unconfirmed.length },
    runs: { shown: shown.map(runLine), total: runs.length, commands: runs.filter((run) => run.command).length,
      others: runs.filter((run) => !run.command).length, quietExit0: quietExit0.length, cut: cut.length, cutParts,
      neverRan, cutRuns: cut.map((run) => run.k) },
    claims: { shown: shownClaims.map(({ statusKey, ...c }) => c), total: claims.length,
      more: claims.length - shownClaims.length, closing,
      notChecked: { claims: notCheckedOfSource('promises'), written: notCheckedOfSource('writtenClaims') } },
    leftOut, settled,
  };
}
const RESULT_PART_ORDER = Object.freeze(['ran-exit-0', 'ran-completed', 'ran-failed', 'failed-or-refused', 'did-not-run',
  'no-terminal-status', 'stopped', 'no-result', 'end-unread', 'output-no-status']);
/** D99 (F1 guard): the header part and the failure what line a run's outcome is said under: its class, but a run the
 *  record typed as stopped before it finished, or cancelled (STOPPED_OUTCOME_FORMS of no-terminal-status) is said as
 *  stopped, never as having no recorded end. D100 (the audit of absence sentences): "no recorded end" is said only of a
 *  background run whose recording the slicer proved holds no end of it (PROVED_NO_END_FORM); a run Sonah read no result
 *  of, and any other form, is said as what Sonah found (`no-result`). */
const partOf = (outcome) => (outcome?.class !== 'no-terminal-status' ? outcome?.class
  : STOPPED_OUTCOME_FORMS.includes(outcome.form) ? 'stopped' : outcome.form === PROVED_NO_END_FORM ? outcome.class
    : 'no-result');

/** The changed files no command ran after their last recorded edit, by the recording's order: the last write that
 *  landed (`landedWrite`), then no command that may have run (`mayHaveRunCommand`: a refused one did not run; one that
 *  failed or was refused, with the recorder marking neither, may have). */
function neverRanPaths(ctx) {
  const { events, session } = ctx;
  const paths = ctx.facts.whole.files.map((f) => f.path);
  const lastEdit = new Map();
  const effect = effectReader(session);
  events.forEach((event, i) => {
    if (!landedWrite(effect, event)) return;
    for (const change of list(event.changes)) if (typeof change?.path === 'string') lastEdit.set(change.path, i);
  });
  return paths.filter((path) => lastEdit.has(path) && !events.slice(lastEdit.get(path) + 1)
    .some((event) => mayHaveRunCommand(session, event)));
}

/** The lines of the agent's closing messages that no claim covers, or that the session review read as asserting
 *  nothing (`windowResults[].closingLines`), as recorded. */
function closingLinesOf(ctx) {
  const { session } = ctx;
  const seen = new Set(), rows = [];
  for (const window of list(ctx.honest.windowResults)) {
    for (const entry of list(plain(window) ? window.closingLines : null)) {
      const event = plain(entry) && typeof entry.eventId === 'string' ? session?.event?.(entry.eventId) : null;
      if (event?.kind !== 'commentary') continue;
      let lines = [];
      try { lines = messageLines(session, event); } catch { lines = []; }
      const byK = new Map(lines.map((line) => [line.k, line]));
      for (const field of ['unreviewed', 'listed']) for (const k of list(entry[field])) {
        const line = byK.get(k);
        if (!line || !line.spans.length || seen.has(`${event.id}:${k}`)) continue;
        seen.add(`${event.id}:${k}`);
        rows.push({ k, parts: spanQuotes(line.spans) });
      }
    }
  }
  return { rows: rows.slice(0, REPORT_LIMITS.closingLines), total: rows.length };
}

// ---- what Sonah could not check (D97) ----------------------------------------------------------------------

/** The steps (your messages) any of whose review windows is incomplete. */
function incompleteSteps(ctx) {
  const records = list(ctx.honest.windowResults);
  return ctx.facts.steps.filter((step) => step.windows.some((w) => !windowRecordComplete(records[w])));
}

/** A record of `triageDropped` or `filesDropped` (code-pass/10) that is a note Sonah did not use: it names an entry by
 *  its index, its cause is not `where_ungrounded` (that entry was kept without its place), and it names no `field` (that
 *  entry was kept without that text field). By structure only. */
const WHERE_UNGROUNDED = TRIAGE_ERRORS.find((cause) => cause === 'where_ungrounded');
const ITEM_WITHHELD = TRIAGE_ERRORS.find((cause) => cause === 'item_withheld');
const notUsedNote = (record) => plain(record) && Number.isInteger(record.index) && record.index >= 0
  && record.cause !== WHERE_UNGROUNDED && !Object.hasOwn(record, 'field');
/** A record of a text field dropped alone from a triage entry Sonah kept (code-pass/10, as built). */
const fieldDropped = (record) => plain(record) && Number.isInteger(record.index) && record.index >= 0
  && TRIAGE_TEXT_FIELDS.includes(record.field);

function notCheckedOf(ctx) {
  const { honest, report, codePass, facts, session } = ctx;
  const facts_ = [];
  const fact = (group, parts, extra = {}) => facts_.push({ group, parts, ...extra });
  // 1. The session review.
  const notReviewed = new Set(incompleteSteps(ctx).map((step) => step.request).filter((k) => k !== null));
  const complete = honest.sessionReview === 'complete';
  const lead = complete ? REPORT_NOT_CHECKED_WORDS.complete : REPORT_NOT_CHECKED_WORDS.incomplete;
  if (notReviewed.size) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.messagesNotReviewed(notReviewed.size)));
  const causes = honest.coverage === 'complete' ? [] : coverageCauses(honest).map(([cause, counts]) => {
    if (cause !== 'windows_incomplete') return [cause, counts];
    const n = incompleteSteps(ctx).length;
    return n ? [cause, { ...counts, n, m: facts.steps.length }] : [cause, counts];
  });
  for (const [cause, counts] of causes) {
    const text = Object.hasOwn(REPORT_CAUSE_WORDS, cause) ? REPORT_CAUSE_WORDS[cause](counts)
      : Object.hasOwn(COVERAGE_SENTENCE, cause) ? COVERAGE_SENTENCE[cause](counts) : null;
    if (text) fact('session', ONE(sentence(text)));
  }
  // D104: the causes that never cap the coverage (the results Sonah first showed the session review only in part),
  // whatever the coverage.
  for (const [cause, counts] of uncappedCauses(honest)) fact('session', ONE(sentence(COVERAGE_SENTENCE[cause](counts))));
  const gaps = gapsByMessage(ctx);
  for (const [k, reasons] of gaps.byAsk) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.gapsOfMessage(k,
    reasons.map((reason) => REPORT_GAP_WORDS[reason]).join(', and '))));
  if (gaps.untied.length) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.gapsUntied(gaps.untied
    .map((reason) => REPORT_GAP_WORDS[reason]).join(', and '))));
  if (facts.encryptedBriefs) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.encryptedBriefs(facts.encryptedBriefs)));
  if (facts.encryptedMessages.n) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.encryptedMessages(facts.encryptedMessages.n,
    facts.encryptedMessages.atLeast)));
  // 2. Rows the session review named and did not keep.
  const count = (value) => (Number.isSafeInteger(value) && value > 0 ? value : 0);
  if (count(report.requirementsRejected)) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.requirementsRejected(count(report.requirementsRejected))));
  if (count(report.claimsRejected)) fact('session', ONE(REPORT_NOT_CHECKED_WORDS.claimsRejected(count(report.claimsRejected))));
  // The asks and claims Sonah did not check are listed in your prompt and under what the agent did: counted here.
  const asksNotChecked = ctx.asks.filter((ask) => ask.req.status === NOT_CHECKED).length;
  // The same counts, in the same terms, as header line D: claims, then statements that the agent wrote into files.
  const { claims: claimsNotChecked, written: writtenNotChecked } = ctx.did.claims.notChecked;
  if (asksNotChecked) fact('session', [LINK(REPORT_NOT_CHECKED_WORDS.asksThere(asksNotChecked), 'prompt')]);
  if (claimsNotChecked) fact('session', [LINK(REPORT_NOT_CHECKED_WORDS.claimsThere(claimsNotChecked), 'did')]);
  if (writtenNotChecked) fact('session', [LINK(REPORT_NOT_CHECKED_WORDS.writtenThere(writtenNotChecked), 'did')]);
  // 3. The code step.
  const code = [];
  if (codePass) {
    // D109 (its review): how the code review works, only where the record shows that it read what Sonah sent it.
    const how = codeHowLine(codePass);
    if (how) code.push(ONE(how));
    // D110: how code computes the label, beside `how`, for a report whose code step used the premise contract.
    if (how && premiseRuled(codePass)) code.push(ONE(CODE_REPORT_WORDS.howConfirm));
    // D109: what the records show of the open questions' checks, and where the change runs from.
    const questionsLine = codeQuestionsLine(codePass);
    if (questionsLine) code.push(ONE(questionsLine));
    const baseLine = codeBaseLine(codePass);
    if (baseLine) code.push(ONE(baseLine));
    for (const line of codeCoverageLines(codePass)) code.push(ONE(sentence(line)));
    // With no finding published as confirmed: whether the review proposed none, or where the ones it proposed are.
    if (codePass.ran === true && !codePassFindings(report).length)
      code.push(ONE(sentence(codeNoFindingLine(codePass, codeStepWithheld(report), codePassQuestions(report),
        codePassUnconfirmed(report)))));
  }
  // D111 amended: the session, so that the asks the item-by-item check did not examine are counted by whose words each
  // rests on (code-report.js `unaccountedAsks`).
  for (const line of codeFooterLines(report, { session })) fact('code', ONE(sentence(line)));
  const withheld = codePassWithheld(report).map((w, index) => {
    const why = withheldWhy(w);
    return { index, what: CODE_REPORT_WORDS.withheldWhat[w.what] ?? null,
      words: typeof w.text === 'string' && w.text.trim() ? [C(words(w.text, 300))] : ONE(REPORT_NOT_CHECKED_WORDS.withheldNoText),
      why: why ? REPORT_NOT_CHECKED_WORDS.withheldWhy(why) : null,
      check: plain(w.check) && typeof w.check.explanation === 'string' && w.check.explanation.trim()
        ? [C(words(w.check.explanation, 300))] : null };
  });
  // 4. The code step's triage notes that failed Sonah's checks: one record an entry Sonah did not use, the records with an
  //    entry's index and a cause other than `where_ungrounded` (D96; ledger.js TRIAGE_ERRORS). A list that is absent or
  //    not a list is one record with no index, and is no note; an entry kept without its place is kept, not dropped.
  //    A note about a finding or question that Sonah withheld (`item_withheld`) passed its own checks: it is counted
  //    apart, in words that say so.
  const notUsed = [...list(codePass?.triageDropped), ...list(codePass?.filesDropped)].filter(notUsedNote);
  const ofWithheld = notUsed.filter((record) => record.cause === ITEM_WITHHELD).length;
  const dropped = notUsed.length - ofWithheld;
  if (dropped) fact('code', ONE(REPORT_NOT_CHECKED_WORDS.triageDropped(dropped)));
  if (ofWithheld) fact('code', ONE(REPORT_NOT_CHECKED_WORDS.triageOfWithheld(ofWithheld)));
  const partly = new Set(list(codePass?.triageDropped).filter(fieldDropped).map((record) => record.index)).size;
  if (partly) fact('code', ONE(REPORT_NOT_CHECKED_WORDS.triagePartly(partly)));
  // 5. Rows no reader reads: asks and other rows.
  const unread = ctx.unread ?? { asks: [], rows: [] };
  return { lead, code, facts: facts_, withheld: withheld.slice(0, REPORT_LIMITS.withheld),
    withheldTotal: withheld.length, unreadAsks: unread.asks, unreadRows: unread.rows,
    total: facts_.length + withheld.length + (unread.asks.length ? 1 : 0) + (unread.rows.length ? 1 : 0) };
}

/** The gaps of the session by message (D69 f): each part reason but a finding under the message whose turn it is. */
function gapsByMessage(ctx) {
  const findings = PART_REASONS.slice(0, 2);
  const gaps = PART_REASONS.filter((reason) => !findings.includes(reason));
  const firstAsk = new Map();
  for (const ask of ctx.facts.asks) if (typeof ask.event.turn === 'string' && !firstAsk.has(ask.event.turn)) firstAsk.set(ask.event.turn, ask.k);
  const byAsk = new Map(), untied = [];
  for (const p of list(ctx.honest.parts)) {
    if (!plain(p)) continue;
    const reasons = gaps.filter((reason) => list(p.reasons).includes(reason));
    if (!reasons.length) continue;
    const k = typeof p.part === 'string' && firstAsk.has(p.part) ? firstAsk.get(p.part) : null;
    if (k === null) { untied.push(...reasons); continue; }
    byAsk.set(k, [...new Set([...(byAsk.get(k) ?? []), ...reasons])]);
  }
  const wide = plain(ctx.honest.sessionWideLimits) ? list(ctx.honest.sessionWideLimits.reasons) : [];
  untied.push(...gaps.filter((reason) => wide.includes(reason)));
  return { byAsk: new Map([...byAsk].sort((a, b) => a[0] - b[0])), untied: gaps.filter((reason) => untied.includes(reason)) };
}

// ---- the header (D97) -------------------------------------------------------------------------------------

function headerOf(ctx, prompt) {
  const { session, facts, codePass, options, report } = ctx;
  // A. The title.
  let title;
  if (typeof options.title === 'string' && oneLine(options.title)) {
    const text = clip(oneLine(options.title), REPORT_LIMITS.titleChars);
    title = { text, parts: [S(text)], quoted: false, cut: false };
  } else {
    // Read from the recorded spans themselves (never `storyFacts`' joined text, which holds Sonah's words).
    const message = prompt.messages[0] ? facts.asks.find((m) => m.k === prompt.messages[0].k) : null;
    let spans = [];
    if (message) try { spans = session.textSpansOf(message.event, 'text'); } catch { spans = []; }
    title = titleOf(spans);
  }
  // B. The size line.
  const kind = REPORT_RECORDING_KINDS[Object.hasOwn(REPORT_RECORDING_KINDS, session?.adapter) && session.adapter !== 'other'
    ? session.adapter : 'other'];
  const duration = durationWord(facts.events);
  const counted = codePass && codePass.ran === true ? list(codePass.files).filter((f) => plain(f)
    && !CODE_OUTSIDE_STATES.includes(f.state)) : [];
  const files = changeSizeOf(ctx, counted);
  const commit = commitFact(ctx, counted);
  const size = [kind, duration, files, REPORT_HEADER_WORDS.commands(facts.whole.commands.length),
    ...(commit?.short ? [REPORT_HEADER_WORDS.commit(commit.short)] : commit?.notCommitted ? [commit.notCommitted] : [])]
    .filter(Boolean);
  // C. The runs after the last edit: the commands that ran, counted and by their results; the ones that failed or were
  // refused with the recorder marking neither, and the ones refused before they ran, each said apart (neither counts as
  // one the agent ran, and "ran no command" stands only when none may have run). With no write that landed there is no
  // last edit, and no line about one. The files that no command followed are named in the Runs list (`neverRanPaths`)
  // only: a command that ran after the last edit of all follows every file's last edit.
  const after = ctx.runs.runs.filter((run) => run.command && run.afterEdit);
  const ran = after.filter((run) => ranCommand(session, run.event));
  const unclear = after.filter((run) => run.outcome.class === 'failed-or-refused').length;
  const refused = after.filter((run) => run.outcome.class === 'did-not-run').length;
  const runs = [];
  if (ran.length) {
    runs.push(REPORT_HEADER_WORDS.runsAfterEdit(ran.length));
    runs.push(REPORT_HEADER_WORDS.results(RESULT_PART_ORDER.map((cls) => [cls, ran.filter((run) => partOf(run.outcome) === cls)
      .length]).filter(([, n]) => n > 0).map(([cls, n]) => REPORT_RESULT_PARTS[cls](n)).join(', ')));
  } else if (!unclear && ctx.runs.lastEdit >= 0) runs.push(REPORT_HEADER_WORDS.noRunAfterEdit);
  if (unclear) runs.push(REPORT_HEADER_WORDS.unclearAfterEdit(unclear));
  if (refused) runs.push(REPORT_HEADER_WORDS.refusedAfterEdit(refused));
  // D. Sonah did not check.
  const notChecked = [];
  if (ctx.honest.sessionReview !== 'complete') notChecked.push(REPORT_HEADER_WORDS.reviewIncomplete);
  const asksNotChecked = ctx.asks.filter((ask) => ask.req.status === NOT_CHECKED).length;
  const agentOnly = ctx.asks.filter((ask) => DONE_STATUSES.includes(ask.req.status)
    && ask.req.checked?.deliverable?.role === 'commentary').length;
  // The same counts as the claims list shows "not checked" (didOf), in the same terms as What Sonah could not check.
  const { claims, written } = ctx.did.claims.notChecked;
  // D105: every file of a request too large to send; else the files the footer names as not shown.
  const unseen = codeUnseenFiles(codePass);
  const messages = new Set(incompleteSteps(ctx).map((step) => step.request).filter((k) => k !== null)).size;
  // D109 amended: beside the files the code review did not see, how many of them its checks read (the one tally's).
  const phrases = [['asks', asksNotChecked], ['agentOnly', agentOnly], ['claims', claims], ['written', written],
    ['unseenFiles', unseen, codeUnseenReadByChecks(codePass)], ['messages', messages]].filter(([, n]) => n > 0);
  const cutPhrases = cutTo(phrases, REPORT_LIMITS.notCheckedPhrases);
  const shown = cutPhrases.shown.map(([key, n, more]) => REPORT_NOT_CHECKED_PARTS[key](n, ...(more ? [more] : [])));
  const rest = phrases.slice(cutPhrases.shown.length).reduce((n, [, k]) => n + k, 0);
  const didNotCheck = phrases.length ? { lead: REPORT_HEADER_WORDS.notCheckedLead, phrases: shown,
    more: rest ? REPORT_NOT_CHECKED_PARTS.more(rest) : null } : null;
  // E. No code step.
  const noCode = !ctx.codeRan ? [REPORT_HEADER_WORDS.noCodeStep, ...(codePass ? codeCoverageLines(codePass).slice(0, 1)
    .map(sentence) : [])] : null;
  // F. Why the report has no code links, when that holds for the whole repository: said once, here (D97). A commit not
  // on GitHub is said by the side that lacks its links, naming only those (a place on the other side keeps its link);
  // when both sides lack them through one commit, the report has no code link at all, and one sentence says so.
  const facts_ = linkFacts(options);
  const head = ctx.noLinks.has('unpushed:new') && validSha(facts_.repo?.head) ? facts_.repo.head : null;
  const start = ctx.noLinks.has('unpushed:old') && validSha(facts_.repo?.start) ? facts_.repo.start : null;
  const short = (sha) => sha.slice(0, 7);
  const noLinks = [...(ctx.noLinks.has('remote') ? [REPORT_HEADER_WORDS.noGitHubRemote] : []),
    ...(head && head === start ? [REPORT_HEADER_WORDS.notOnGitHub.both(short(head))]
      : [...(head ? [REPORT_HEADER_WORDS.notOnGitHub.new(short(head))] : []),
        ...(start ? [REPORT_HEADER_WORDS.notOnGitHub.old(short(start))] : [])])];
  return { title, size, runs, reviewIncomplete: notChecked, didNotCheck, noCode, noLinks };
}

/**
 * The size line's files (D97). D109 (its review): with the code step's one tally (`ctx.change`), the files of the change,
 * the count the coverage line says (a recorded write that lies in a folder the code review could read among them), so the
 * header's count of files the code review did not see is a part of it; their lines when Sonah holds every file's: the
 * code step's added and removed lines of each, or, when the change is the recorded edits (no git base), the recording's
 * lines of each; else no lines. An earlier report (no tally) whose every counted file has the code step's lines: those
 * files and lines. Either is said as the change, never as what the recording changed: with git the change runs from the
 * start commit to the files as they are now. Else the files that the recording's own writes changed, with their lines.
 */
function changeSizeOf(ctx, counted) {
  const { facts, codePass, change } = ctx;
  const exactOf = (f) => plain(f) && Number.isSafeInteger(f.added) && Number.isSafeInteger(f.removed);
  const exactLines = (fs) => `+${fs.reduce((n, f) => n + f.added, 0)} −${fs.reduce((n, f) => n + f.removed, 0)}`;
  if (change) {
    const recordOf = new Map(list(codePass.files).filter((f) => plain(f) && typeof f.path === 'string')
      .map((f) => [f.path, f]));
    const records = change.units.map((u) => recordOf.get(u.path));
    const storyFile = new Map(facts.whole.files.map((f) => [f.path, f]));
    const story = codePass.base?.kind !== 'git' ? change.units.map((u) => storyFile.get(u.path)) : [];
    const lines = records.every(exactOf) ? exactLines(records)
      : story.length && story.every(Boolean) ? lineWord(story.reduce((sum, f) => ({ added: sum.added + f.counts.added,
        removed: sum.removed + f.counts.removed, addedAtLeast: sum.addedAtLeast || f.counts.addedAtLeast,
        removedAtLeast: sum.removedAtLeast || f.counts.removedAtLeast }), { added: 0, removed: 0, addedAtLeast: false,
        removedAtLeast: false })) : null;
    return REPORT_HEADER_WORDS.change(change.total, lines);
  }
  if (counted.length > 0 && counted.every(exactOf)) return REPORT_HEADER_WORDS.change(counted.length, exactLines(counted));
  return REPORT_HEADER_WORDS.filesChanged(facts.whole.files.length, lineWord(facts.whole.counts));
}

/** The commit fact (D97): the short HEAD when every counted file of the change is committed, else how
 *  many differ; nothing when Sonah cannot tell. */
function commitFact(ctx, counted) {
  const facts = linkFacts(ctx.options);
  if (!facts.repo || !validSha(facts.repo.head)) return null;
  if (!ctx.codeRan || !counted.length) return { short: facts.repo.head.slice(0, 7), notCommitted: null };
  const unknown = counted.some((f) => typeof f.sha256 !== 'string' && f.type !== 'deleted' && f.state !== 'deleted');
  if (unknown) return null;
  const committed = (f) => facts.repo.atHead.has(f.path) || ((f.type === 'deleted' || f.state === 'deleted')
    && facts.repo.goneAtHead.has(f.path));
  const differ = counted.filter((f) => !committed(f)).length;
  return differ ? { short: null, notCommitted: REPORT_HEADER_WORDS.notCommitted(differ) }
    : { short: facts.repo.head.slice(0, 7), notCommitted: null };
}

// ---- the count line (D97) ------------------------------------------------------------------------------

function countLineOf(ctx, tiers, prompt) {
  const counts = Object.fromEntries(REPORT_TIERS.map((tier) => [tier, tiers[tier].length]));
  const mustAct = tiers[MUST_ACT];
  return {
    tiers: REPORT_TIERS.map((tier) => ({ tier, words: REPORT_TIER_WORDS[tier], n: counts[tier], folded: tier === GOOD_TO_KNOW })),
    prompt: ctx.asks.length ? REPORT_COUNT_WORDS.prompt(prompt.parts.join(', ')) : REPORT_COUNT_WORDS.noAsk,
    labels: cutTo(mustAct, REPORT_LIMITS.mustActLabels).shown.map((item) => ({ n: item.n, parts: item.label })),
    more: cutTo(mustAct, REPORT_LIMITS.mustActLabels).more,
    empty: counts[MUST_ACT] === 0 && counts[MUST_KNOW] === 0 ? REPORT_COUNT_WORDS.emptyTiers : null,
    counts,
  };
}

// ---- the footer (D97) -------------------------------------------------------------------------------------

function footerOf(ctx, items) {
  const facts = linkFacts(ctx.options);
  const version = typeof ctx.options.sonahVersion === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(ctx.options.sonahVersion)
    ? ctx.options.sonahVersion : null;
  const triaged = items.some((item) => item.impact || item.action);
  const hash = typeof ctx.options.sessionHash === 'string' && /^[0-9a-f]{64}$/.test(ctx.options.sessionHash)
    ? ctx.options.sessionHash : null;
  return { provenance: REPORT_FOOTER_WORDS.provenance(version ?? '', REPORT_MODEL_VERSION,
    facts.repo && validSha(facts.repo.head) ? facts.repo.head.slice(0, 7) : null).replace(/^Sonah {2}/, 'Sonah '),
  legend: [REPORT_FOOTER_WORDS.legend, REPORT_FOOTER_WORDS.legendCodeReview, REPORT_FOOTER_WORDS.legendSessionReview],
  triageLegend: triaged ? REPORT_FOOTER_WORDS.triageLegend : null, share: REPORT_FOOTER_WORDS.share, sessionHash: hash };
}

// ---- placement (D97) ----------------------------------------------------------------------------------

/** Where each row of every source set is placed: `{ item }`, `{ foldedInto }`, `{ memberOf }` (D112: a member of that
 *  item, with its own lines), `{ ask }`, `{ list, shown }` or `{ notChecked }`. Also fills the unread rows section 8
 *  names. */
function placementOf(ctx, candidates, model) {
  const rows = {};
  const unreadAsks = [], unreadRows = [];
  const shownRuns = new Set(model.did.runs.shown.map((run) => run.failureIndex).filter((x) => x !== null));
  const shownClaims = new Set(model.did.claims.shown.map((c) => rowKey(c.source, c.index)));
  const memberOf = new Map(ctx.items.flatMap((item) => item.members.map((member) => [member.primary, item])));
  for (const c of candidates) {
    let place;
    if (c.heldBy) place = c.heldBy.primary === c ? { item: c.heldBy.n } : { foldedInto: c.heldBy.n };
    else if (memberOf.has(c)) place = { memberOf: memberOf.get(c).n };
    else {
      const item = ctx.items.find((x) => x.primary === c);
      if (item) place = { item: item.n };
      else if (c.place?.ask) place = { ask: c.place.ask };
      else if (c.place?.list === 'runs') place = { list: 'runs', shown: shownRuns.has(c.index) };
      else if (c.place?.list === 'claims') place = { list: 'claims', shown: shownClaims.has(c.key) };
      else if (c.place?.list === 'settled') place = { list: 'settled', shown: true };
      else if (c.place?.notChecked === 'withheld') place = { notChecked: 'withheld', shown: c.index < REPORT_LIMITS.withheld };
      else if (c.place?.notChecked === 'unreadAsks') { place = { notChecked: 'unreadAsks' }; unreadAsks.push(c); }
      else { place = { notChecked: 'unreadRows' }; unreadRows.push(c); }
    }
    rows[c.key] = place;
  }
  // A row's short id. An ask with none is counted with no number: an unread ask maps to no ask of your prompt (it is
  // not among their rows), and the prompt's numbering is the only "ask N" the report uses, never the session review's
  // own list index. Any other part with none: by its kind and its place in the session review's list of that kind.
  const idOf = (c) => (typeof c.row.id === 'string' ? c.row.id.replace(/^sha256:/, '').slice(0, 12)
    : c.source === 'requirements' ? null
      : REPORT_NOT_CHECKED_WORDS.unreadRow(REPORT_NOT_CHECKED_WORDS.rowKinds[c.source], c.index + 1));
  const ids = (cs) => {
    const named = cs.map(idOf).filter((name) => name !== null);
    const unnamed = cs.length - named.length;
    // Cut as every list is (`cutTo`): a lone entry past the cut is shown, never "and 1 more".
    const cut = cutTo(named, REPORT_LIMITS.unreadIds);
    const parts = [...cut.shown];
    if (cut.more) parts.push(REPORT_COUNT_WORDS.more(cut.more));
    if (unnamed && parts.length) parts.push(REPORT_NOT_CHECKED_WORDS.noId(unnamed));
    return parts.join(', ');
  };
  const nc = model.notChecked;
  if (unreadAsks.length) nc.unreadAsks = [REPORT_NOT_CHECKED_WORDS.unreadAsks(unreadAsks.length, ids(unreadAsks))];
  if (unreadRows.length) nc.unreadRows = [REPORT_NOT_CHECKED_WORDS.unreadRows(unreadRows.length, ids(unreadRows))];
  nc.total = nc.facts.length + nc.withheldTotal + nc.unreadAsks.length + nc.unreadRows.length;
  return { rows, version: REPORT_MODEL_VERSION };
}

/** The placement map of a model: every row of every source set, where it is (D97). */
export const reportPlacement = (model) => model.placement.rows;

/** Per item, its kind and its default, proposed and final tier, and the bound that moved it (D97); since D112, which
 *  row placed it (`from`: a member's record is then the item's tier). */
export function tierMoves(model) {
  return REPORT_TIERS.flatMap((tier) => model.tiers[tier]).map((item) => ({ n: item.n, kind: item.kind,
    default: item.tier.default, proposed: item.tier.proposed, final: item.tier.final, bound: item.tier.bound,
    from: item.tier.from }));
}

// ---- the visible words (D97) -------------------------------------------------------------------------------

const partsText = (parts) => list(parts).map((p) => (p.quote ? `“${p.text}”${p.cut ? '…' : ''}` : p.text)).join('');
const countWords = (text) => String(text).split(/\s+/).filter(Boolean).length;

/** The lines of an item or a member (D112) under its head: quote, impact, the agent's words, action. */
function bodyLines(item) {
  const lines = [];
  if (item.quote) lines.push(`${item.quoteLabel ? `${item.quoteLabel} ` : ''}${partsText([item.quote])}`);
  else if (item.quoteMissing) lines.push(REPORT_ITEM_WORDS.quoteMissing);
  for (const parts of list(item.restsOutside)) lines.push(`${REPORT_ITEM_WORDS.restsOutside} ${partsText(parts)}`);
  if (item.impact) lines.push(`${REPORT_ITEM_WORDS.impact} ${partsText(item.impact)}`);
  if (item.agentSaid) lines.push(`${item.agentSaidLabel ?? REPORT_ITEM_WORDS.agentSaid} ${partsText([item.agentSaid])}`);
  if (item.action) lines.push(`${REPORT_ITEM_WORDS.action} ${partsText(item.action)}`);
  return lines;
}
const placeWords = (item) => item.where.map((w) => (w.anchor ? w.text : `${w.path}${w.startLine ? `:${w.startLine}` : ''}`));
/** A member's head (D112): its type word, what it is, and its own tier word. */
export const memberHeadText = (member) => `${REPORT_TYPE_WORDS[member.type]}: ${partsText(member.what.parts)} · `
  + `${REPORT_TIER_WORDS[member.tier.final]}`;
/** The text of an item's visible lines (D97), as a reader sees them. D112: then the line that counts its members, and
 *  each member's head; an open member's lines too (a folded member shows its head alone). */
export function itemVisibleText(item) {
  const lines = [];
  const scope = item.scope.notAsked ? ` ${REPORT_ITEM_WORDS.notAsked}` : item.scope.askedUnknown
    ? ` ${REPORT_ITEM_WORDS.askedUnknown}` : '';
  lines.push(`${item.n} ${REPORT_TYPE_WORDS[item.type]}: ${partsText(item.what.parts)}${scope}`);
  lines.push(...bodyLines(item));
  const where = placeWords(item);
  const marker = item.scope.asks.length && !item.where.some((w) => w.anchor === `ask-${item.scope.asks[0]}`)
    ? [REPORT_ITEM_WORDS.asked(item.scope.asks[0])] : [];
  const more = item.whereMore ? [REPORT_ITEM_WORDS.morePlaces(item.whereMore)] : [];
  if (where.length || marker.length) lines.push(`${REPORT_ITEM_WORDS.where} ${[...where, ...more, ...marker].join(' · ')}`);
  const members = list(item.members);
  if (members.length) lines.push(REPORT_ITEM_WORDS.members(members.length));
  for (const member of members) {
    lines.push(memberHeadText(member));
    if (member.folded) continue;
    lines.push(...bodyLines(member));
    const at = placeWords(member);
    if (at.length) lines.push(`${REPORT_ITEM_WORDS.where} ${at.join(' · ')}`);
  }
  return lines.join('\n');
}
/** The text of the header, the count line and your prompt as they show open (sections 1 to 3). */
export function openText(model) {
  const { header, countLine, prompt } = model;
  const lines = [];
  if (header.title) lines.push(partsText(header.title.parts));
  lines.push(header.size.join(' · '));
  lines.push(header.runs.join(' '));
  if (header.reviewIncomplete.length || header.didNotCheck) lines.push([...header.reviewIncomplete,
    ...(header.didNotCheck ? [`${header.didNotCheck.lead} ${header.didNotCheck.phrases.join(' · ')}`
      + `${header.didNotCheck.more ? ` ${header.didNotCheck.more}` : ''}`] : [])].join(' '));
  if (header.noCode) lines.push(header.noCode.join(' '));
  lines.push(`${countLine.tiers.map((t) => `${t.words} ${t.n}${t.folded ? ` ${REPORT_COUNT_WORDS.folded}` : ''}`).join(' · ')}`
    + ` · ${countLine.prompt}`);
  if (countLine.empty) lines.push(countLine.empty);
  else if (countLine.labels.length) lines.push(`${REPORT_COUNT_WORDS.mustActLead} ${countLine.labels
    .map((l) => partsText(l.parts)).join(' · ')}${countLine.more ? ` ${REPORT_COUNT_WORDS.more(countLine.more)}` : ''}`);
  lines.push(REPORT_SECTION_WORDS.promptCounted(prompt.asks.length, prompt.parts.join(', ')));
  for (const message of prompt.messages) {
    let room = message.cutAt ?? Infinity;
    const shown = [];
    for (const seg of message.segments) {
      if (room <= 0) break;
      const text = [...seg.text].slice(0, room).join('');
      room -= [...seg.text].length;
      shown.push(seg.ask && seg.first ? `${REPORT_PROMPT_WORDS.status[STATE_WORD[seg.state]]} ${text}` : text);
    }
    lines.push(shown.join(''));
    lines.push(REPORT_PROMPT_WORDS.coverage);
  }
  for (const ask of prompt.asks.filter((a) => a.lines.length || !a.located))
    lines.push(`${REPORT_PROMPT_WORDS.askLine(ask.n)} · ${ask.status} · ${ask.lines.map(partsText).join(' ')}`);
  return lines.join('\n');
}
/** The visible words of the first screen (D97): sections 1 to 3 and the first item of Must act, else of
 *  Must know, by `wc -w` rules on the text. */
export function firstScreenWords(model) {
  const first = model.tiers[MUST_ACT][0] ?? model.tiers[MUST_KNOW][0] ?? null;
  return countWords(openText(model)) + (first ? countWords(itemVisibleText(first)) : 0);
}
/** The code lines of the first screen's item excerpt (at most `excerptLines`). */
export function firstScreenExcerptLines(model) {
  const first = model.tiers[MUST_ACT][0] ?? model.tiers[MUST_KNOW][0] ?? null;
  return first?.where?.[0]?.excerpt?.lines?.length ?? 0;
}
/** Every word a reader sees with every fold closed: sections 1 to 3, Must act and Must know whole, and the headings
 *  of the folded sections. */
export function visibleWords(model) {
  const items = [...model.tiers[MUST_ACT], ...model.tiers[MUST_KNOW]].map(itemVisibleText);
  const headings = [REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[MUST_ACT], model.tiers[MUST_ACT].length),
    REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[MUST_KNOW], model.tiers[MUST_KNOW].length),
    REPORT_SECTION_WORDS.tier(REPORT_TIER_WORDS[GOOD_TO_KNOW], model.tiers[GOOD_TO_KNOW].length),
    REPORT_SECTION_WORDS.did, REPORT_SECTION_WORDS.notCheckedCounted(model.notChecked.total)];
  const footer = [model.footer.provenance, ...model.footer.legend, model.footer.triageLegend ?? '', model.footer.share];
  return countWords([openText(model), ...items, ...headings, ...footer].join('\n'));
}
