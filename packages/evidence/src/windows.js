// Sonah windowing: sessions, segments, windows (owner-confirmed spec 2026-10-06;
// C-07 "M35 windowing: sessions, segments, windows"). It replaces the byte-budget window splitter (a 196,608-byte source
// budget that also split at every compaction) and the carry (`sonah.carry`: earlier results, writes and the latest
// statements), and with them the per-window gap juggling that existed only because windows cut segments apart (the
// action/result pair gap, the riding boundary, the carry's request-cap gap).
//
// Words (only these):
//   - SESSION: one recording, end to end. A helper (a sub-agent) is a session of its own: its events — the ones a
//     review's session holds under one `childId` — are reviewed apart from its parent's, by the same rules, and linked
//     back to the parent segment that launched it.
//   - SEGMENT: one human message and everything the agent did until the next human message. Every human-labelled
//     record starts one — a message the human queued while the agent worked (`queued`), an answer to the agent's
//     question (`answer`) and the first message after a typed interruption (`after_interrupt`) included, each linked to
//     the task it arrived during. A file the human attached is part of the message it came with, never a start.
//   - WINDOW: consecutive segments of one session, packed in order into one main narrative call.
//
// Labels are the slicer's (C-02 "M34 slice-time labels"): a human message is an instruction event whose label was
// human (authority `human`, or `agent` — the parent agent's words to a helper — derived from the lineage), never a
// peer's. Nothing here reads a word of any text. Deterministic: no clock, no random source, no model. Every size is the
// UTF-8 bytes of the content a window shows, after the trim, and a token is 3.6 bytes (`TOKEN_BYTES`).

/** /4 (M36 phase 2, the window format; D68; C-07 "M36 window format"): what a window shows of an event, and
 *  so every event's planned size, moved — a command line and a tool input whole, a result cut on whole lines, an edit as
 *  its recorded hunk runs or its own text, the file as found never inlined. The phase's review moved more under the same
 *  version (once per phase): a helper's report its parent received is whole, and a field's lines are its stored text's.
 *  /5 (M36 phase 3, owner decisions D68 K and F): small sessions share a window — each session's own windows are packed
 *  in review order while the window's work stays within the budget — and a window carries its sessions' earlier proven
 *  failures, and a helper's beside the report its parent received, under the carried cap.
 *  /6 (owner decisions D69, 2026-10-08): the files a window's calls changed twice or more are no longer declared (the net
 *  view and its declines reverted, D69 e); what the window shows of an event moved with the ledger (an output under the
 *  harness home folders withheld and a project's own `.claude` shown, D69 b; paths spelled by the recorder's working
 *  directory, D69 c).
 *  /7 (the D69 review, 2026-10-08): a carried context over the request bound is fitted from the bytes it uses, with no
 *  round limit (finding F1), so a window one more left-out failure fits is fitted, never left unreviewed; what the window
 *  shows of an event moved with the ledger (typed withholding; a path outside the cwd spelled as recorded). */
// /8 (D71, S2: the reviewer brief as the checklist): the window format a session-only
// request shows moved — each agent message numbered by line (`messageLines`), each window's closing message and last event
// named (`closingMessages`) — and no window's events, cut or planned size moved: every shown byte is /7's.
export const WINDOWING_VERSION = 'sonah.windows/8';

/** The deterministic token estimate: UTF-8 bytes / 3.6. */
export const TOKEN_BYTES = 3.6;
/** `tokens` x 3.6 as a whole number of bytes (exact for a whole number of tokens: 200,000 -> 720,000). */
export const bytesOfTokens = (tokens) => Math.floor((tokens * 18) / 5);

/**
 * The settings: a window's current work stays at or under 200k tokens; the carried context on top of it
 * is capped at 200k tokens; every action and observation other than a file edit is trimmed to 2k tokens (its first
 * 1k and its last 1k, by position only). Frozen literals, chosen only by the review's profile, never tuned per repo.
 */
export const WINDOW_SETTINGS = Object.freeze({ workTokens: 200_000, carriedTokens: 200_000, trimTokens: 2_000 });

/** Owner steering 2026-10-09: Codex session reviews use a smaller work/carry profile. These remain
 * byte-based token estimates, not a proof that a complete model request fits its context. */
export const CODEX_WINDOW_SETTINGS = Object.freeze({ workTokens: 100_000, carriedTokens: 100_000, trimTokens: 2_000 });

/**
 * A combined (PR) review's settings. Its windows ride inside a code-review request of at most 524,288 bytes
 * (`MAX_REVIEW_INPUT_BYTES`) beside the PR's hunks and manifest, so its current work keeps the old source budget —
 * 196,608 bytes, 54,613 tokens — and it carries no earlier thoughts (a combined review carried nothing before either;
 * its human messages are in its request's instruction inventory, as always). Everything else is the spec's.
 */
export const COMBINED_WINDOW_SETTINGS = Object.freeze({ workTokens: 54_613, carriedTokens: 0, trimTokens: 2_000 });

/**
 * The most bytes one window's request (and so one of its challenge requests) may carry: the spec's worst-case call,
 * about 450k tokens (instructions and inventory, 200k of carried context and 200k of current work), inside a 1M-token
 * context. A request over it is declared `unreviewed_scope`, never clipped.
 */
export const WINDOW_REQUEST_TOKENS = 450_000;
export const WINDOW_REQUEST_MAX_BYTES = bytesOfTokens(WINDOW_REQUEST_TOKENS);

/** The frozen windowing profile of a review: its version, its token estimate (UTF-8 bytes per token, as a string: a
 *  canonical JSON digest admits whole numbers only) and its settings. */
export const windowingProfile = (settings = WINDOW_SETTINGS) => Object.freeze({ version: WINDOWING_VERSION,
  bytesPerToken: String(TOKEN_BYTES), workTokens: settings.workTokens, carriedTokens: settings.carriedTokens,
  trimTokens: settings.trimTokens });
export const WINDOWING_PROFILE = windowingProfile(WINDOW_SETTINGS);
export const CODEX_WINDOWING_PROFILE = windowingProfile(CODEX_WINDOW_SETTINGS);
export const COMBINED_WINDOWING_PROFILE = windowingProfile(COMBINED_WINDOW_SETTINGS);
/** The settings, and the frozen profile, a review of `reviewScope` windows by. */
export const windowSettingsOf = (reviewScope, backend) => (reviewScope === 'session-only'
  ? (backend === 'codex-cli' ? CODEX_WINDOW_SETTINGS : WINDOW_SETTINGS) : COMBINED_WINDOW_SETTINGS);
export const windowingProfileOf = (reviewScope, backend) => (reviewScope === 'session-only'
  ? (backend === 'codex-cli' ? CODEX_WINDOWING_PROFILE : WINDOWING_PROFILE) : COMBINED_WINDOWING_PROFILE);

// ---- what a window shows of one event (M36 phase 2: the window format) -----------------------------------------------
//
// Owner decisions 2026-10-07 (D68 P, L, T, H, critique c1-c4, c8; C-07 "M36 window format"). What the agent
// PRODUCED is shown whole: a human message, a thought, a command line, a tool input, a code change. What it CONSUMED —
// an observation — is cut by ONE positional rule: its first and last `trimTokens / 2` tokens' bytes, on whole lines, the
// middle named by line range and available on request. An edit is shown as the hunks the recorder recorded for it, each
// maximal same-side run a quotable source of its own; a created file once, whole; an edit the recorder kept no hunks for
// as its own written and replaced text, whole. The file as the record found it before an edit is never inlined. Nothing
// is computed from an output's or a thought's words, and no end state of a file is computed anywhere.

const utf8 = (code) => (code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4);
export const byteLength = (text) => Buffer.byteLength(text, 'utf8');

/**
 * The closed reasons a window declares where it shows less of what the agent produced than the record holds (C-07 "M36
 * window format"): a command line or a tool input (`action_over_budget`), an edit (`edit_over_budget`), or (M36 phase 2
 * review) a helper's report its parent received (`report_over_budget`), larger than a window's whole work budget alone —
 * its head and tail are shown up to that budget, the gap declared between them.
 */
export const SHOWN_GAPS = Object.freeze({ actionOverBudget: 'action_over_budget', editOverBudget: 'edit_over_budget',
  reportOverBudget: 'report_over_budget' });

/* D69 (e) (owner decision 2026-10-08): the net view of a file changed twice or more in a window, and its declines
 * (`changedTwice`, `NET_VIEW_DECLINED`: `start_unrecorded`, `end_unrecorded`, `not_computed`), are reverted. A net view
 * is a reading of Sonah's own, not what was recorded, so the rule goes; each change is shown at its own call, as
 * recorded. */

/** A field's stored text and quotable ranges (`Session.textRegionsOf`); a session without it (a frozen PR-code facade)
 *  gives its spans as the lines of one text. */
function regionsOf(session, holder, field) {
  if (typeof session?.textRegionsOf === 'function') return session.textRegionsOf(holder, field);
  const spans = typeof session?.textSpansOf === 'function' ? session.textSpansOf(holder, field) : [];
  let text = '';
  const ranges = [];
  for (const span of spans) {
    if (text) text += '\n';
    ranges.push({ from: text.length, until: text.length + span.length });
    text += span;
  }
  return { text, ranges, complete: true };
}

/** The index of the first range of `ranges` that ends after `at` (ranges are ordered and disjoint). */
function firstRangeAfter(ranges, at) {
  let low = 0, high = ranges.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (ranges[mid].until <= at) low = mid + 1; else high = mid;
  }
  return low;
}

/** The UTF-8 bytes of the quotable characters of `regions` in `[from, until)`. */
function bytesIn(regions, from, until) {
  let n = 0;
  for (let at = firstRangeAfter(regions.ranges, from); at < regions.ranges.length; at++) {
    const range = regions.ranges[at];
    if (range.from >= until) break;
    const a = Math.max(from, range.from), b = Math.min(until, range.until);
    if (a < b) n += byteLength(regions.text.slice(a, b));
  }
  return n;
}

/** Is the character at `at` quotable (inside a range)? */
const quotableAt = (regions, at) => {
  const index = firstRangeAfter(regions.ranges, at);
  return index < regions.ranges.length && regions.ranges[index].from <= at;
};

/** The quotable spans of `regions` inside `[from, until)`, in order: each range clipped, empty ones left out. */
function spansIn(regions, from, until) {
  const spans = [];
  for (let at = firstRangeAfter(regions.ranges, from); at < regions.ranges.length; at++) {
    const range = regions.ranges[at];
    if (range.from >= until) break;
    const a = Math.max(from, range.from), b = Math.min(until, range.until);
    if (a < b) spans.push(regions.text.slice(a, b));
  }
  return spans;
}

/** Where a head of at most `side` quotable bytes ends: after the last whole line that fits (amendment T); when the first
 *  line alone holds more, at the last character boundary that fits, never inside a character. */
function headEnd(regions, side) {
  const { text } = regions;
  let end = 0, bytes = 0;
  while (end < text.length) {
    const nl = text.indexOf('\n', end);
    const next = nl < 0 ? text.length : nl + 1;
    const more = bytesIn(regions, end, next);
    if (bytes + more > side) break;
    bytes += more;
    end = next;
  }
  if (end > 0) return end;
  let at = 0;
  bytes = 0;
  while (at < text.length) {
    const code = text.codePointAt(at);
    const n = quotableAt(regions, at) ? utf8(code) : 0;
    if (bytes + n > side) break;
    bytes += n;
    at += code > 0xffff ? 2 : 1;
  }
  return at;
}

/** Where a tail of at most `side` quotable bytes starts: at the first whole line from which every line fits; when the
 *  last line alone holds more, at the first character boundary that fits. M36 phase 2 review: the line before `start`
 *  begins after the last line break before its own (searched from `start - 2`); at `start` 1 there is none, it is the
 *  text's first line, from 0 (a negative `fromIndex` searches index 0 and found that line's own break: no progress, and
 *  planning never returned). */
function tailStart(regions, side) {
  const { text } = regions;
  let start = text.length, bytes = 0;
  while (start > 0) {
    const nl = start >= 2 ? text.lastIndexOf('\n', start - 2) : -1;
    const previous = nl < 0 ? 0 : nl + 1;
    const more = bytesIn(regions, previous, start);
    if (bytes + more > side) break;
    bytes += more;
    start = previous;
  }
  if (start < text.length) return start;
  let at = text.length;
  bytes = 0;
  while (at > 0) {
    let from = at - 1;
    const low = text.charCodeAt(from);
    if (low >= 0xdc00 && low <= 0xdfff && from > 0) {
      const high = text.charCodeAt(from - 1);
      if (high >= 0xd800 && high <= 0xdbff) from--;
    }
    const n = quotableAt(regions, from) ? utf8(text.codePointAt(from)) : 0;
    if (bytes + n > side) break;
    bytes += n;
    at = from;
  }
  return at;
}

const breaksIn = (text, from, until) => {
  let n = 0;
  for (let at = text.indexOf('\n', from); at !== -1 && at < until; at = text.indexOf('\n', at + 1)) n++;
  return n;
};
/** The lines of a text: none for an empty one; a final line break ends the last line, it opens none. */
export const lineCount = (text) => (text ? breaksIn(text, 0, text.length) + (text.endsWith('\n') ? 0 : 1) : 0);

/**
 * The positional cut: when the quotable bytes of `regions` exceed `2 x side`, its first and
 * last `side` bytes, each ending (or starting) on a whole line — a single line longer than its side is cut at a
 * character boundary — and the middle not shown. Returns null when it fits, else `{ head, tail, omittedBytes, omitted }`:
 * `head` and `tail` the shown spans (each a separate source: a seam is never quotable), `omitted` the middle's lines,
 * 1-based in the field's text (`Session.textRegionsOf`: a redaction note's line is one line): `{ fromLine, throughLine,
 * partFrom, partThrough }` — `partFrom` (`partThrough`) when that line is shown in part.
 */
export function lineCut(regions, side) {
  const { text } = regions;
  const total = bytesIn(regions, 0, text.length);
  if (total <= 2 * side) return null;
  const from = headEnd(regions, side), until = tailStart(regions, side);
  const head = spansIn(regions, 0, from), tail = spansIn(regions, until, text.length);
  const fromLine = breaksIn(text, 0, from) + 1;
  return { head, tail, omittedBytes: bytesIn(regions, from, until),
    omitted: { fromLine, throughLine: fromLine + breaksIn(text, from, until - 1),
      partFrom: from > 0 && text[from - 1] !== '\n', partThrough: text[until - 1] !== '\n' } };
}

/** One shown field: `{ role, holder, field, spans, headCount, omittedBytes, omitted, gap }` — `headCount` the spans
 *  before the cut (all of them when nothing was cut), `gap` the closed reason a cut of what the agent produced names. */
function shownField(role, holder, field, regions, cut = null, gap = null) {
  if (!cut) {
    const spans = spansIn(regions, 0, regions.text.length);
    return { role, holder, field, spans, headCount: spans.length, omittedBytes: 0, omitted: null, gap: null };
  }
  return { role, holder, field, spans: [...cut.head, ...cut.tail], headCount: cut.head.length,
    omittedBytes: cut.omittedBytes, omitted: cut.omitted, gap };
}

/** The work budget and the observation side of `settings`, in bytes (null: everything whole, a code-only chunk). */
function budgetsOf(settings) {
  const whole = (n) => Number.isSafeInteger(n) && n > 0;
  return { side: settings && whole(settings.trimTokens) ? bytesOfTokens(settings.trimTokens) / 2 : null,
    budget: settings && whole(settings.workTokens) ? bytesOfTokens(settings.workTokens) : null };
}

/** What the agent produced, one field of it: whole; over the window's work budget alone, its head and tail up to that
 *  budget on whole lines and the gap declared by its closed reason. */
function producedField(role, holder, field, regions, budget, gap) {
  return shownField(role, holder, field, regions, budget === null ? null : lineCut(regions, budget / 2), gap);
}

/** C-02 `extent.priorState` (adapters/sonah-ledger.js PRIOR_STATE, re-declared: this module imports nothing): the
 *  before sides that are the edit's own replaced text, and the ones that are the file as the record found it. */
const REPLACED_TEXT = Object.freeze(['edit-text', 'redacted']);
const FILE_STATE = Object.freeze(['first-write', 'deleted-state']);
/** A recorded `writeType` that created the file: the body is the whole file, shown once. */
const CREATED = Object.freeze(['create', 'add']);

/**
 * M36 phase 2 review (critique c1): where a change's prior state was recorded (the adapter's `priorRecord`): `{ source,
 * eventId, partial, window }` — `source` `original` (the recorder kept the file with the call itself), `read` (a Read of
 * the path) or `write` (a body written to it); `eventId` that event when this session holds it, else null; `partial` and
 * `window` a read's (its typed lines, `{ from, to, total }`, when less than the file). Null when none was recorded (a
 * ledger an older slicer wrote). Structure only.
 */
function priorRecordOf(session, change) {
  const record = change?.priorRecord;
  if (!record || typeof record !== 'object' || !['original', 'read', 'write'].includes(record.source)) return null;
  const held = typeof record.eventId === 'string' && typeof session?.event === 'function' && session.event(record.eventId);
  const w = record.window;
  return { source: record.source, eventId: held ? record.eventId : null, partial: record.partial === true,
    window: w && Number.isSafeInteger(w.from) && Number.isSafeInteger(w.to)
      ? { from: w.from, to: w.to, total: Number.isSafeInteger(w.total) ? w.total : null } : null };
}

/**
 * What a window shows of one call's code change (amendment H; c1, c3, c8). `{ mode, blocks, priorFiles,
 * unrecordedChange, gap }`:
 *   - `hunks`: the call's recorded hunks (`Session.hunkRunsOf`), each maximal same-side run a block of its own (role code,
 *     its lines and side said in a label outside the fence, numbered as the recorder numbered them: the file as recorded
 *     before this call, and the file it left) — an Edit, and a Write that replaced a file (`writeType` update), when the
 *     recorder kept its hunks. No body of the call is shown beside them: the runs hold the change.
 *   - `bodies`: otherwise, per change, what it wrote (`written`), whole, and the text it replaced (`replaced`: an edit's
 *     own replaced text, kept beside a file state by the adapter, or its before side when that is the replaced text),
 *     whole; a created file (`writeType` create or add) is its body once, whole.
 * `priorFiles`: each change whose before side is the file as the record found it (the recorder's `originalFile`, a Read
 * of the path before its first write, the last state of a path it deleted): never inlined, said to exist (its lines and
 * bytes), by the event that recorded it (`record`, c1), and how to ask for a line range of it. `unrecordedChange`: the
 * recorder fact that the file changed since an
 * earlier call by something not recorded as an edit (C-02 "M36 recorded facts"). An edit over the window's work budget
 * alone is cut to its first and last half of that budget across its blocks, on whole lines (`gap`).
 */
function editView(session, event, budget) {
  const changes = (Array.isArray(event.changes) ? event.changes : []).filter((change) => change && typeof change === 'object');
  const recorded = event.recorded && typeof event.recorded === 'object' ? event.recorded : {};
  const runs = CREATED.includes(recorded.writeType) || typeof session?.hunkRunsOf !== 'function' ? null
    : session.hunkRunsOf(event);
  const priorFiles = changes.filter((change) => FILE_STATE.includes(change.extent?.priorState)).map((change) => {
    const regions = regionsOf(session, change, 'before');
    return regions.ranges.length ? { change, lines: lineCount(regions.text), bytes: bytesIn(regions, 0, regions.text.length),
      record: priorRecordOf(session, change) } : null;
  }).filter(Boolean);
  const blocks = [];
  if (runs) {
    runs.forEach((run, index) => blocks.push({ kind: 'run', run, index, regions: { text: run.text, ranges: run.ranges } }));
  } else {
    for (const change of changes) {
      blocks.push({ kind: 'written', change, regions: regionsOf(session, change, 'after') });
      if (Array.isArray(change.replaced)) blocks.push({ kind: 'replaced', change, field: 'replaced',
        extent: change.replacedExtent ?? null, regions: regionsOf(session, change, 'replaced') });
      else if (REPLACED_TEXT.includes(change.extent?.priorState)) blocks.push({ kind: 'replaced', change, field: 'before',
        extent: change.beforeExtent ?? null, regions: regionsOf(session, change, 'before') });
    }
  }
  const unrecordedChange = recorded.unrecordedChange && typeof recorded.unrecordedChange.since === 'string'
    ? { since: recorded.unrecordedChange.since,
      commands: (Array.isArray(recorded.unrecordedChange.commands) ? recorded.unrecordedChange.commands : [])
        .filter((id) => typeof id === 'string') } : null;
  const view = { mode: runs ? 'hunks' : 'bodies', blocks, priorFiles, unrecordedChange, gap: null };
  for (const block of blocks) {
    block.spans = spansIn(block.regions, 0, block.regions.text.length);
    block.part = null;
  }
  const total = blocks.reduce((n, block) => n + bytesIn(block.regions, 0, block.regions.text.length), 0);
  if (budget !== null && total > budget) view.gap = cutBlocks(view, budget / 2, total);
  return view;
}

/**
 * An edit over the window's work budget alone (amendment E: no fixed size limit; the budget is the only bound): its
 * blocks from the start while `side` bytes last, the block that crosses cut after its last whole line that fits, and the
 * same from the end; the blocks between are not shown. A block cut on both sides (one larger than the whole budget) is
 * shown twice, its head and its tail, each its own source. Returns the gap: `{ reason, omittedBytes, after }` — `after`
 * how many of the shown blocks come before it.
 */
function cutBlocks(view, side, total) {
  const head = [], tail = [];
  let left = side;
  for (const block of view.blocks) {
    const bytes = bytesIn(block.regions, 0, block.regions.text.length);
    if (bytes <= left) { head.push(block); left -= bytes; continue; }
    const end = headEnd(block.regions, left);
    const spans = spansIn(block.regions, 0, end);
    if (spans.length) head.push({ ...block, spans, part: 'head' });
    break;
  }
  left = side;
  for (let at = view.blocks.length - 1; at >= 0; at--) {
    const block = view.blocks[at];
    const bytes = bytesIn(block.regions, 0, block.regions.text.length);
    if (bytes <= left) { tail.unshift(block); left -= bytes; continue; }
    const start = tailStart(block.regions, left);
    const spans = spansIn(block.regions, start, block.regions.text.length);
    if (spans.length) tail.unshift({ ...block, spans, part: 'tail' });
    break;
  }
  view.blocks = [...head, ...tail];
  const shown = view.blocks.reduce((n, block) => n + block.spans.reduce((m, span) => m + byteLength(span), 0), 0);
  return { reason: SHOWN_GAPS.editOverBudget, omittedBytes: total - shown, after: head.length };
}

/**
 * The typed facts a result's label line is built from (amendment L): ONLY fields the recorder typed — on the result
 * (its exit code, in its header) and on the call it answers (C-02 "M36 recorded facts": the recorder's tool name, the
 * call's path, a read's line window, the error flag, interrupted, background, no output expected, a search's counts, a
 * fetch's status and bytes, a web search's result count, a Codex command's class) — and the output's own size, or (M36
 * phase 2 review) that Sonah withheld the output before review (`outputWithheld`). Never a word of the output.
 */
export function observationFacts(session, event) {
  const call = typeof event?.invocation === 'string' && typeof session?.event === 'function' ? session.event(event.invocation)
    : null;
  const recorded = call?.recorded && typeof call.recorded === 'object' ? call.recorded : {};
  const count = (n) => (Number.isSafeInteger(n) && n >= 0 ? n : null);
  const read = recorded.read && Number.isSafeInteger(recorded.read.startLine) && count(recorded.read.numLines) !== null
    ? { startLine: recorded.read.startLine, numLines: recorded.read.numLines, totalLines: count(recorded.read.totalLines) }
    : null;
  const pick = (value, keys) => (value && typeof value === 'object' ? Object.fromEntries(keys
    .filter((key) => value[key] !== undefined && value[key] !== null).map((key) => [key, value[key]])) : null);
  return {
    tool: typeof recorded.tool === 'string' ? recorded.tool : typeof call?.tool === 'string' ? call.tool : null,
    paths: (Array.isArray(call?.paths) ? call.paths : []).map((path) => path?.path).filter((path) => typeof path === 'string'),
    read,
    errorFlag: recorded.isError === true,
    interrupted: recorded.interrupted === true,
    background: typeof recorded.backgroundTaskId === 'string',
    noOutputExpected: recorded.noOutputExpected === true,
    commandClass: typeof recorded.commandClass === 'string' ? recorded.commandClass : null,
    search: pick(recorded.search, ['mode', 'numFiles', 'numLines', 'numMatches', 'totalMatches', 'truncated']),
    fetch: pick(recorded.fetch, ['code', 'bytes']),
    webResults: count(recorded.webSearch?.results),
    // M36 phase 2 review: Sonah withheld the output before review (the adapter's `outputWithheld`: a credential-shaped
    // path or the harness's own files, D68 R) — structure, never the output's words; its size is then no recorded fact.
    outputWithheld: event?.outputWithheld === true,
  };
}

/** A numbered read's file lines for output lines `[from, through]`: only when its output is the recorder's `numLines`
 *  lines exactly and nothing of it was dropped or joined (one quotable range, the whole text) — c2: a line is never
 *  labelled by a number redaction may have moved. */
function fileLinesOf(read, regions, from, through) {
  if (!read || regions.ranges.length !== 1 || regions.ranges[0].from !== 0
      || regions.ranges[0].until !== regions.text.length || lineCount(regions.text) !== read.numLines) return null;
  return { from: read.startLine + from - 1, through: read.startLine + through - 1 };
}

/**
 * What a window shows of one event (C-07 "M36 window format"; `settings` the window's, null showing everything whole):
 *   - instruction, commentary: `{ kind, fields: [whole field] }`;
 *   - observation: `{ kind, fields: [output], facts, lines, bytes, fileLines }` — the output cut by the positional rule
 *     (`lineCut` at `trimTokens / 2`), its label facts (`observationFacts`), its size, and a numbered read's file lines
 *     of the omitted middle (`fileLinesOf`);
 *   - invocation: `{ kind, command, input, paths, edit }` — the command line and a tool's input (an `other` or
 *     `delegate` call's) whole unless over the work budget alone (`action_over_budget`), every path whole, and a
 *     write's, edit's or delete's change (`editView`).
 */
export function eventView(session, event, settings = WINDOW_SETTINGS) {
  const { side, budget } = budgetsOf(settings);
  const whole = (role, holder, field) => shownField(role, holder, field, regionsOf(session, holder, field));
  switch (event?.kind) {
    case 'instruction': return { kind: 'instruction', fields: [whole('instruction', event, 'text')] };
    case 'commentary': return { kind: 'commentary', fields: [whole('commentary', event, 'text')] };
    case 'observation': {
      const regions = regionsOf(session, event, 'output');
      // M36 phase 2 review (owner decision D68 P: "a helper's report" is what the agent PRODUCED): the report a helper
      // handed back, as its parent received it (the adapter's `helperReported`, a recorder-structure fact), is shown
      // whole like a command line — cut only when it alone is larger than the window's whole work budget, declared
      // (`report_over_budget`). Every other result is cut by the one positional rule.
      const report = event.helperReported === true;
      const cut = report ? (budget === null ? null : lineCut(regions, budget / 2))
        : side === null ? null : lineCut(regions, side);
      const output = shownField('observation', event, 'output', regions, cut, report && cut ? SHOWN_GAPS.reportOverBudget : null);
      const facts = observationFacts(session, event);
      return { kind: 'observation', fields: [output], facts, lines: lineCount(regions.text),
        bytes: bytesIn(regions, 0, regions.text.length),
        fileLines: cut ? fileLinesOf(facts.read, regions, cut.omitted.fromLine, cut.omitted.throughLine) : null };
    }
    case 'invocation': {
      const produced = (field) => producedField('action', event, field, regionsOf(session, event, field), budget,
        SHOWN_GAPS.actionOverBudget);
      const editing = ['write', 'edit', 'delete'].includes(event.operation)
        || (Array.isArray(event.changes) && event.changes.length > 0);
      return { kind: 'invocation', command: produced('command'),
        input: ['other', 'delegate'].includes(event.operation) ? produced('input') : null,
        paths: (Array.isArray(event.paths) ? event.paths : []).map((path) => path?.path).filter((path) => typeof path === 'string'),
        edit: editing ? editView(session, event, budget) : null };
    }
    default: return { kind: event?.kind ?? null, fields: [] };
  }
}

/**
 * The quotable fields a window shows of one event, in render order: `[{ role, holder, field, spans, omittedBytes, ... }]`
 * — an invocation's command, its input, then its edit's blocks (a hunk run is `{ field: 'hunk', run }`, a body its
 * change's `after`, `replaced` or `before`).
 */
export function shownFields(session, event, settings = WINDOW_SETTINGS) {
  const view = eventView(session, event, settings);
  if (view.kind !== 'invocation') return view.fields;
  const fields = [view.command, ...(view.input ? [view.input] : [])];
  for (const block of view.edit?.blocks ?? []) fields.push(block.kind === 'run'
    ? { role: 'code', holder: event, field: 'hunk', run: block.run, spans: block.spans, omittedBytes: 0, part: block.part }
    : { role: 'code', holder: block.change, field: block.kind === 'written' ? 'after' : block.field, spans: block.spans,
      omittedBytes: 0, part: block.part });
  return fields;
}

/** The quotable sources a window shows of one event (C-05: what its source map holds), in render order: every shown
 *  span with its role, and each path whole (after the command and input, before the code, as the evidence renders it). */
export function shownSources(session, event, settings = WINDOW_SETTINGS) {
  const view = eventView(session, event, settings);
  const out = [];
  const push = (role, spans) => { for (const text of spans.length ? spans : ['']) out.push({ role, text }); };
  if (view.kind !== 'invocation') {
    for (const field of view.fields) push(field.role, field.spans);
    return out;
  }
  push('action', view.command.spans);
  if (view.input) push('action', view.input.spans);
  for (const path of view.paths) out.push({ role: 'action', text: path });
  for (const block of view.edit?.blocks ?? []) push('code', block.spans);
  return out;
}

/** The UTF-8 bytes a window shows of one event (its current-work size): every shown span and every path — exactly the
 *  quotable text its rendering fences (labels, headers and notes are Sonah's words and are not counted). */
export function shownBytes(session, event, settings = WINDOW_SETTINGS) {
  return shownSources(session, event, settings).reduce((n, source) => n + byteLength(source.text), 0);
}

// ---- D71 (S2): an agent message's lines and a window's closing message -----------

/**
 * An agent message's lines, numbered in its stored text (`Session.textRegionsOf`, so a redaction note's line is one
 * line), each `{ k, from, until, spans }` — `from`/`until` the line's place in that text (its line break excluded), `spans`
 * its quotable spans (a redactor artifact is never quotable). A final line break opens no line (`lineCount`). Structure
 * only: positions of line breaks, never a word.
 */
export function messageLines(session, event, field = 'text') {
  const regions = regionsOf(session, event, field);
  const { text } = regions;
  const lines = [];
  for (let at = 0, k = 1; at < text.length; k++) {
    const nl = text.indexOf('\n', at);
    const until = nl < 0 ? text.length : nl;
    lines.push({ k, from: at, until, spans: spansIn(regions, at, until) });
    if (nl < 0) break;
    at = nl + 1;
  }
  return lines;
}

/** Whether a message is shown numbered by line: two lines or more. */
export const numberedMessage = (lines) => Array.isArray(lines) && lines.length >= 2;

/**
 * Each session part's closing message in a window (owner decision D59: built only from the window's own events,
 * never from anything recorded after it) — the last AGENT SAID of the part's own agent with no ACTION of that agent after
 * it in the window: `{ part, childId, eventId, lines, numbered }`; or, when the part's agent wrote no message,
 * `{ part, childId, eventId: null, none: 'no_message' }`; or, when an ACTION follows its last message,
 * `{ part, childId, eventId: null, none: 'ends_on', endsOn }` — the part's last event's id. Structure only.
 */
export function closingMessages(session, window) {
  const seq = (event) => (Number.isSafeInteger(event?.sequence) ? event.sequence : -1);
  return windowParts(window).map((part, index) => {
    const events = [...part.events].filter(Boolean).sort((a, b) => seq(a) - seq(b));
    const childId = part.session?.childId ?? null;
    const said = events.filter((event) => event.kind === 'commentary').at(-1) ?? null;
    if (!said) return { part: index, childId, eventId: null, none: 'no_message' };
    if (events.some((event) => event.kind === 'invocation' && seq(event) > seq(said)))
      return { part: index, childId, eventId: null, none: 'ends_on', endsOn: events.at(-1).id };
    const lines = messageLines(session, said);
    return { part: index, childId, eventId: said.id, lines: lines.length, numbered: numberedMessage(lines) };
  });
}

// ---- what a window may serve on request (M36 phase 3, owner decision D68 Q) ---------------------------------------------

/**
 * The texts of one event a window may serve on request (D68 Q: "the middle available on request"; c1: the file before an
 * edit "requestable"), each `{ part, holder, field, role, path, lines, servable }` — `lines` the field's stored text's
 * lines, `servable` the 1-based line range the window did not show whole (`[from, through]`), or null when it showed
 * every line. With `fileBefore`, an invocation's recorded file states before it (`priorState` `first-write` or
 * `deleted-state`: never inlined, so every line servable), role code; otherwise an observation's output (role
 * observation), or an invocation's command and tool input (role action) — of an event the window showed (`shown`), only
 * the lines its cut omitted (a line shown in part is served whole); of an event it only named, every line. An output Sonah
 * withheld is `withheld`, and so is the file before a change whose recorded prior state Sonah withheld before review
 * (`priorWithheld`: a credential-shaped or harness file, D68 R). M36 phase 3 review: a field that holds no stored text
 * (an edit's or a write's empty command, an empty output) is no requestable text, so a request for it is refused
 * `not_requestable` — never `out_of_range`, which is for lines past a text that is there. Structure only: positions and
 * recorded fields, never a word.
 */
export function requestableTexts(session, event, settings, { fileBefore = false, shown = false } = {}) {
  const whole = (regions) => (regions.ranges.length ? [1, Math.max(1, lineCount(regions.text))] : null);
  const middle = (field) => (field.omitted ? [field.omitted.fromLine, field.omitted.throughLine] : null);
  if (fileBefore) {
    if (event?.kind !== 'invocation') return [];
    const changes = Array.isArray(event.changes) ? event.changes : [];
    return [...changes.filter((change) => change?.priorWithheld === true).map(() => ({ part: 'before', withheld: true })),
      ...changes.filter((change) => FILE_STATE.includes(change?.extent?.priorState))
        .map((change) => ({ change, regions: regionsOf(session, change, 'before') }))
        .filter(({ regions }) => lineCount(regions.text) > 0)
        .map(({ change, regions }) => ({ part: 'before', holder: change, field: 'before', role: 'code', path: change.path ?? null,
          lines: lineCount(regions.text), servable: whole(regions) }))];
  }
  if (event?.kind === 'observation') {
    if (event.outputWithheld === true) return [{ part: 'output', withheld: true }];
    const regions = regionsOf(session, event, 'output');
    if (!lineCount(regions.text)) return [];
    const servable = shown ? middle(eventView(session, event, settings).fields[0]) : whole(regions);
    return [{ part: 'output', holder: event, field: 'output', role: 'observation', path: null, lines: lineCount(regions.text),
      servable }];
  }
  if (event?.kind !== 'invocation') return [];
  const view = shown ? eventView(session, event, settings) : null;
  return [['command', view?.command], ...(['other', 'delegate'].includes(event.operation) ? [['input', view?.input]] : [])]
    .map(([field, seen]) => ({ field, seen, regions: regionsOf(session, event, field) }))
    .filter(({ regions }) => lineCount(regions.text) > 0)
    .map(({ field, seen, regions }) => ({ part: field, holder: event, field, role: 'action', path: null,
      lines: lineCount(regions.text), servable: seen ? middle(seen) : whole(regions) }));
}

/**
 * Lines `from` through `through` (1-based, inclusive) of one field's stored text, as the quotable spans that hold them —
 * split at every redactor artifact, which is never served — at most `maxBytes` of them: from `from` while whole lines
 * fit; when not even the first does, its head at a character boundary. `{ spans, through, partial, bytes }` (`through` the
 * last line served, `partial` when it is served in part), or null when nothing fits or no line is there.
 */
export function servedLines(session, holder, field, from, through, maxBytes) {
  const regions = regionsOf(session, holder, field);
  const { text } = regions;
  const total = lineCount(text);
  if (!(from >= 1 && through >= from && from <= total)) return null;
  const startOf = (line) => {
    let at = 0;
    for (let k = 1; k < line; k++) at = text.indexOf('\n', at) + 1;
    return at;
  };
  const start = startOf(from);
  const last = Math.min(through, total);
  let end = start;
  for (let k = from; k <= last; k++) {
    const nl = text.indexOf('\n', end);
    end = nl < 0 ? text.length : k === last ? nl : nl + 1;
  }
  // The requested lines as a region of their own, its ranges clipped and shifted, cut where `maxBytes` ends.
  const sub = { text: text.slice(start, end), ranges: regions.ranges
    .map((range) => ({ from: Math.max(range.from, start) - start, until: Math.min(range.until, end) - start }))
    .filter((range) => range.from < range.until) };
  const fits = bytesIn(sub, 0, sub.text.length) <= maxBytes;
  const cut = fits ? sub.text.length : headEnd(sub, maxBytes);
  const spans = spansIn(sub, 0, cut);
  if (!spans.length) return null;
  const servedThrough = from + breaksIn(sub.text, 0, cut) - (cut > 0 && sub.text[cut - 1] === '\n' ? 1 : 0);
  return { spans, through: servedThrough, partial: cut < sub.text.length && cut > 0 && sub.text[cut - 1] !== '\n',
    bytes: spans.reduce((n, span) => n + byteLength(span), 0) };
}

// ---- sessions and segments ---------------------------------------------------------------------------------------------

/** A human message (C-02 labels): an instruction whose label was human — the human's own (authority `human`) or, in a
 *  helper's session, its parent agent's (`agent`) — never a peer's. */
export const isHumanMessage = (event) => event?.kind === 'instruction' && event.authority !== 'peer';
const markersOf = (event) => (Array.isArray(event?.markers) ? event.markers : []);
/** A human message that starts a segment: every one but a file the human attached, which is part of its message. */
export const startsSegment = (event) => isHumanMessage(event) && !markersOf(event).includes('attached');
/** The markers that say a segment's message arrived during an earlier task: its work is that task's. */
const DURING = Object.freeze(['queued', 'answer']);

const keyOf = (event) => (typeof event?.childId === 'string' && event.childId ? event.childId : null);

/** C-03 M33 P: the boundary the adapter writes where the parent received a helper's work (adapters/sonah-ledger.js
 *  `HELPER_RECEIPT_BOUNDARY`, re-declared: this module imports nothing). It is no recorded event: it placed the helper's
 *  events inside the parent's timeline, and a helper is a session of its own now, so no window shows it. */
const HELPER_RECEIPT = 'helper_receipt';
const placementOnly = (event) => event?.kind === 'boundary' && event.boundary === HELPER_RECEIPT;

/**
 * The sessions a review's session holds: the root's own events, then each helper's — the events recorded under
 * one `childId` — in the order its first event was recorded. Each helper names the event that launched it: the verified
 * spawn assignment its recorded child link names (C-03), or null when none does. The adapter's helper-receipt
 * boundaries (M33 P placement) belong to no session.
 */
export function reviewSessions(session) {
  const events = Array.isArray(session?.events) ? session.events.filter((event) => !placementOnly(event)) : [];
  const byKey = new Map([[null, []]]);
  for (const event of events) {
    const key = keyOf(event);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(event);
  }
  const links = Array.isArray(session?.children) ? session.children : [];
  const known = new Set(events.map((event) => event?.id));
  return [...byKey].map(([childId, own]) => {
    const spawn = childId === null ? null : links.find((link) => link?.childId === childId && link.state === 'verified'
      && link.relation !== 'followup' && typeof link.assignmentEvent === 'string' && known.has(link.assignmentEvent));
    return { childId, helper: childId !== null, launchedBy: spawn ? spawn.assignmentEvent : null, events: own };
  });
}

/**
 * One session's segments, in order: each human message that starts one opens it; the events before the first are
 * a segment with no human message. A segment's `task` is the human message whose work it is: its own, or — for a
 * message queued while the agent worked, or an answer to the agent's question — the task of the segment it arrived
 * during (`during`). An `after_interrupt` message starts new work and names the task it interrupted.
 */
export function segmentsOf(events) {
  const segments = [];
  let current = null;
  const open = (start) => {
    const previous = segments.at(-1) ?? null;
    const markers = start ? markersOf(start).filter((marker) => marker !== 'attached') : [];
    const during = start && markers.some((marker) => DURING.includes(marker)) ? previous?.task ?? null : null;
    current = { index: segments.length, start, markers, during,
      interrupted: start && markers.includes('after_interrupt') ? previous?.task ?? null : null,
      task: start ? (markers.some((marker) => DURING.includes(marker)) && previous?.task ? previous.task : start.id) : null,
      events: [] };
    segments.push(current);
  };
  for (const event of events) {
    if (startsSegment(event)) open(event);
    else if (!current) open(null);
    current.events.push(event);
  }
  return segments;
}

// ---- windows ----------------------------------------------------------------------------------------------------------

/**
 * A segment over the work budget (an oversized segment), cut into pieces at the boundaries between the agent's
 * thoughts — a piece after the first always opens with a thought — never inside a thought, an action or a result. Its
 * human message repeats at the top of every later piece and counts in that piece's work, so a piece that would hold
 * nothing but that message is never closed. A run between two thoughts that is itself over the budget is one piece,
 * marked oversize.
 */
function piecesOf(segment, sizes, budget) {
  const runs = [];
  for (const event of segment.events) {
    if (!runs.length || (event.kind === 'commentary' && runs.at(-1).events.length)) runs.push({ events: [], bytes: 0 });
    runs.at(-1).events.push(event);
    runs.at(-1).bytes += sizes.get(event);
  }
  const repeated = segment.start ? sizes.get(segment.start) : 0;
  const pieces = [];
  let current = null;
  for (const run of runs) {
    const onlyMessage = current !== null && current.events.length === 1 && current.events[0] === segment.start;
    if (current && current.bytes + run.bytes > budget && !onlyMessage) current = null;
    if (!current) {
      current = { events: [], bytes: pieces.length && segment.start ? repeated : 0 };
      pieces.push(current);
    }
    current.events.push(...run.events);
    current.bytes += run.bytes;
  }
  return pieces;
}

const sequenceRange = (events) => {
  const sequences = events.map((event) => event.sequence).filter(Number.isFinite);
  return sequences.length ? { fromSequence: Math.min(...sequences), untilSequence: Math.max(...sequences) }
    : { fromSequence: null, untilSequence: null };
};

const segmentRecord = (segment) => ({ index: segment.index, start: segment.start?.id ?? null, markers: [...segment.markers],
  task: segment.task, during: segment.during, interrupted: segment.interrupted,
  ...(segment.start && typeof segment.start.answerTo === 'string' ? { answerTo: segment.start.answerTo } : {}),
  ...(segment.start && typeof segment.start.interruptedBy === 'string' ? { interruptedBy: segment.start.interruptedBy } : {}) });

/**
 * One session's windows (packing): its segments in order, never reordered and never overlapping; the next segment
 * joins the open window while the window's work stays at or under the budget; when it would cross it, the window closes
 * and the next one starts with that segment. A segment over the budget alone is cut into pieces (`piecesOf`), each a
 * window of its own.
 */
function packSession(stream, sizes, budget) {
  const segments = segmentsOf(stream.events);
  const windows = [];
  let open = null;
  const close = () => { if (open) windows.push(open); open = null; };
  for (const segment of segments) {
    const bytes = segment.events.reduce((n, event) => n + sizes.get(event), 0);
    if (bytes > budget) {
      close();
      const pieces = piecesOf(segment, sizes, budget);
      pieces.forEach((piece, at) => windows.push({ segments: [segment], events: piece.events, workBytes: piece.bytes,
        piece: { at: at + 1, of: pieces.length }, repeats: at > 0 && segment.start ? segment.start : null,
        activeTask: segment.task }));
      continue;
    }
    if (open && open.workBytes + bytes > budget) close();
    if (!open) open = { segments: [], events: [], workBytes: 0, piece: null, repeats: null, activeTask: segment.task };
    open.segments.push(segment);
    open.events.push(...segment.events);
    open.workBytes += bytes;
  }
  close();
  // A window of boundaries only is never formed: no model is called for a window with nothing to review (a session of
  // boundaries only has no window, as before).
  return { segments, windows: windows.filter((window) => window.events.some((event) => event.kind !== 'boundary')) };
}

/** Settings a planner accepts: whole, positive work and trim budgets and a whole, non-negative carried cap. */
function checkedSettings(settings) {
  const positive = (n) => Number.isSafeInteger(n) && n > 0;
  if (settings === null || typeof settings !== 'object' || !positive(settings.workTokens) || !positive(settings.trimTokens)
      || !(Number.isSafeInteger(settings.carriedTokens) && settings.carriedTokens >= 0))
    throw new RangeError('Windowing settings must be whole token counts: work and trim positive, carried not negative');
  return settings;
}

/**
 * The review's windows, every session's, in review order: each window of the root session in order, and right
 * after the root window that holds a helper's launch, that helper's windows (and, after a helper's window that holds a
 * nested helper's launch, the nested helper's), so a session that grows at its end never moves an earlier window. A
 * helper whose launch is in no window is reviewed after every other.
 *
 * Each window: `{ index, events, parts, session: { helper, childId, launchedBy, parentSegment }, segments, piece,
 * repeats, activeTask, workBytes, workBudget, oversize, fromSequence, untilSequence, windowingVersion }` — `events` its
 * own events (the repeated human message of a later piece is not one of them), `parentSegment` the segment of the parent
 * session that holds the helper's launch (`{ childId, index, start }`), `segments` each segment's record (its start, its
 * markers and links), `oversize` its work over the budget (a run between two thoughts over it, or a human message).
 * M36 phase 3 (D68 K): `parts` are the sessions it holds, packed (each `{ session, events, segments, piece, repeats,
 * activeTask, workBytes, oversize }`, in review order); `session` … `activeTask` are its first part's.
 */
export function planWindows(session, settings = WINDOW_SETTINGS) {
  // Fails closed, as the splitter did: no session is never an empty plan.
  if (!Array.isArray(session?.events)) throw new TypeError('Windows are planned from a session\'s events');
  const budget = bytesOfTokens(checkedSettings(settings).workTokens);
  const sizes = new Map();
  for (const event of session.events) sizes.set(event, shownBytes(session, event, settings));
  const streams = reviewSessions(session);
  const packed = new Map(streams.map((stream) => [stream.childId, { stream, ...packSession(stream, sizes, budget) }]));
  // Where each event lies: its session's window and segment.
  const segmentOf = new Map(), windowOf = new Map();
  for (const { stream, segments, windows } of packed.values()) {
    for (const segment of segments) for (const event of segment.events) segmentOf.set(event.id, { childId: stream.childId, segment });
    windows.forEach((window) => { for (const event of window.events) windowOf.set(event.id, window); });
  }
  const launchedIn = new Map();     // window -> the helpers launched by one of its events, in launch order
  const unplaced = [];
  for (const stream of streams) {
    if (!stream.helper) continue;
    const window = stream.launchedBy ? windowOf.get(stream.launchedBy) : undefined;
    if (window === undefined) { unplaced.push(stream.childId); continue; }
    if (!launchedIn.has(window)) launchedIn.set(window, []);
    launchedIn.get(window).push(stream.childId);
  }
  const ordered = [];
  const visit = (childId, seen) => {
    if (seen.has(childId)) return;
    seen.add(childId);
    const { stream, windows } = packed.get(childId);
    for (const window of windows) {
      ordered.push({ stream, window });
      for (const helper of launchedIn.get(window) ?? []) visit(helper, seen);
    }
  };
  const seen = new Set();
  visit(null, seen);
  for (const childId of unplaced) visit(childId, seen);
  for (const childId of packed.keys()) visit(childId, seen);   // a helper launched from a helper never placed
  // Owner decision D68 (K), M36 phase 3: small sessions share a window. Each session's own windows above — its segments
  // packed in order, an oversized segment cut into pieces: the existing rules, so a session splits across windows only
  // when it alone exceeds the budget — are the units, in review order (a helper right after its parent's unit that
  // launched it); consecutive units share one window while the window's work stays within the budget. Two units of one
  // session never share a window: the packing above closed the first because the second did not fit with it, or because
  // one of them is a piece of an oversized segment (each a window of its own).
  const parts = ordered.map(({ stream, window }) => {
    const parent = stream.launchedBy ? segmentOf.get(stream.launchedBy) ?? null : null;
    return { session: { helper: stream.helper, childId: stream.childId, launchedBy: stream.launchedBy,
      parentSegment: parent ? { childId: parent.childId, index: parent.segment.index, start: parent.segment.start?.id ?? null }
        : null },
    events: window.events, segments: window.segments.map(segmentRecord), piece: window.piece, repeats: window.repeats,
    activeTask: window.activeTask, workBytes: window.workBytes, oversize: window.workBytes > budget };
  });
  const shared = [];
  for (const part of parts) {
    const open = shared.at(-1);
    if (open && open.workBytes + part.workBytes <= budget
        && !open.parts.some((held) => held.session.childId === part.session.childId)) {
      open.parts.push(part);
      open.workBytes += part.workBytes;
    } else shared.push({ parts: [part], workBytes: part.workBytes });
  }
  // `session`, `segments`, `piece`, `repeats` and `activeTask` are the first part's: a window of one session is exactly
  // what it was. `parts` names every session the window holds, in review order.
  return shared.map(({ parts: held, workBytes }, index) => {
    const [first] = held;
    const events = held.flatMap((part) => part.events);
    return { index, events, parts: held, session: first.session, segments: first.segments, piece: first.piece,
      repeats: first.repeats, activeTask: first.activeTask, workBytes, workBudget: budget, oversize: workBytes > budget,
      ...sequenceRange(events), windowingVersion: WINDOWING_VERSION };
  });
}

/** The parts of a window (D68 K): its `parts`, or — a window a caller built (a code-only chunk, a test) — the window
 *  itself as its one part. */
export const windowParts = (window) => (Array.isArray(window?.parts) && window.parts.length ? window.parts
  : [{ session: window?.session ?? { helper: false, childId: null, launchedBy: null, parentSegment: null },
    events: Array.isArray(window?.events) ? window.events : [], segments: window?.segments ?? [], piece: window?.piece ?? null,
    repeats: window?.repeats ?? null, activeTask: window?.activeTask ?? null, workBytes: window?.workBytes ?? 0,
    oversize: window?.oversize === true }]);

// ---- the carried context -----------------------------------------------------------------------------------------------

/**
 * What a window carries on top of its current work: computed from the recording alone, before any call,
 * never another window's answer. From the window's own session, recorded before the window's first event:
 *   (a) the active task — the human message that started the work the window is in the middle of, marked as such;
 *   (b) every earlier human message;
 *   (c) every earlier agent thought (visible message);
 * never an earlier action or observation — but (owner decision D68 F, M36 phase 3) (d) every earlier PROVEN failure of
 * the session (`provenFailure`: an action whose result the recorder typed as failed), its action and its result, and in
 * a parent's window the proven failures of a helper whose report it received, riding back beside that report (critique
 * c6: labelled as the helper's, never a contradiction of the parent's own statements). A window holding several
 * sessions (D68 K) carries each one's own context, under one cap: the active tasks and every human message are always
 * kept, then the most recent proven failures fill the cap, then the most recent earlier thoughts; `failuresLeftOut` and
 * `thoughtsLeftOut` say how many older ones were left out. A later piece's repeated human message is shown in its current
 * work, not carried. Settings that carry no tokens (a combined review) carry nothing: null.
 *
 * Returns `{ parts, rideBack, activeTask, activeTaskShown, humans, failures, thoughts, failuresLeftOut, thoughtsLeftOut,
 * humanBytes, failureBytes, thoughtBytes, capBytes }` — `parts` one per session the window holds (`{ childId, activeTask,
 * activeTaskShown, humans, failures, thoughts, failuresLeftOut, thoughtsLeftOut }`, each list in recorded order, a
 * failure `{ call, result }`), `rideBack` the helpers' failures beside their reports (`{ report, childId, failures,
 * leftOut }`); the rest the first part's active task and the whole window's lists and totals, as a window of one session
 * always read them. `activeTaskShown` is where an active task is shown: `window` (one of its own events), `repeated` (the
 * top of a later piece) or `carried`.
 */
export function carriedContext(session, window, settings = WINDOW_SETTINGS, { capBytes: fitted = null } = {}) {
  if (!settings || !(settings.carriedTokens > 0)) return null;
  const all = (Array.isArray(session?.events) ? session.events : []).filter((event) => !placementOnly(event));
  const position = new Map(all.map((event, at) => [event, at]));
  const shownHere = new Set((window?.events ?? []).map((event) => event?.id));
  const bytes = (event) => shownBytes(session, event, settings);
  const failureBytes = (failure) => bytes(failure.call) + bytes(failure.result);
  // M36 phase 3: a lower cap a caller fits the window's request with (run-review.js `planWindowRequests`), never higher.
  const capBytes = Number.isSafeInteger(fitted) && fitted >= 0 ? Math.min(fitted, bytesOfTokens(settings.carriedTokens))
    : bytesOfTokens(settings.carriedTokens);
  const fittedCap = capBytes < bytesOfTokens(settings.carriedTokens);
  const streams = reviewSessions(session);
  // Per part (D68 K): each session the window holds keeps its own carried context, from what that session recorded
  // before the part's first event.
  const parts = windowParts(window).map((part) => {
    const own = new Set(part.events.map((event) => event?.id));
    const childId = part.session?.childId ?? null;
    const stream = all.filter((event) => keyOf(event) === childId);
    const first = stream.findIndex((event) => own.has(event?.id));
    const before = first < 0 ? [] : stream.slice(0, first);
    const repeated = part.repeats?.id ?? null;
    const activeTask = typeof part.activeTask === 'string' ? part.activeTask : null;
    return { childId, activeTask, activeTaskShown: activeTask === null ? null : own.has(activeTask) ? 'window'
      : activeTask === repeated ? 'repeated' : 'carried',
    humans: before.filter((event) => isHumanMessage(event) && event.id !== repeated),
    failures: provenFailuresIn(session, before), thoughts: before.filter((event) => event.kind === 'commentary') };
  });
  // (F) a helper's proven failures ride back with its report into its parent's window (critique c6: under a fixed label,
  // never as a contradiction of the parent's own statements): the failures the helper recorded before the report its
  // parent received (`helperReported`, recorder structure) — none this window shows itself (a helper packed with it).
  const rideBack = [];
  for (const part of windowParts(window)) for (const event of part.events) {
    if (event?.kind !== 'observation' || event.helperReported !== true || typeof event.invocation !== 'string') continue;
    const helper = streams.find((stream) => stream.helper && stream.launchedBy === event.invocation);
    if (!helper) continue;
    const before = helper.events.filter((e) => !Number.isSafeInteger(e.sequence) || !Number.isSafeInteger(event.sequence)
      || e.sequence < event.sequence);
    const failures = provenFailuresIn(session, before)
      .filter((failure) => !shownHere.has(failure.result.id) && !shownHere.has(failure.call.id));
    if (failures.length) rideBack.push({ report: event.id, childId: helper.childId, failures });
  }
  // One cap for the window (D68 F): every active task and human message is kept; then the proven failures —
  // each session's own earlier ones and those riding back from helpers — the most recent first; then the most recent
  // earlier thoughts. What the cap left out is counted per kind.
  const humanBytes = parts.reduce((n, part) => n + part.humans.reduce((m, event) => m + bytes(event), 0), 0);
  const fill = (candidates, size, room) => {
    const kept = new Set();
    let used = 0;
    for (const candidate of [...candidates].sort((a, b) => b.at - a.at)) {
      const n = size(candidate.item);
      if (used + n > room) break;
      kept.add(candidate.item);
      used += n;
    }
    return { kept, used };
  };
  const failureCandidates = [...parts.flatMap((part) => part.failures), ...rideBack.flatMap((ride) => ride.failures)]
    .map((item) => ({ item, at: position.get(item.result) ?? -1 }));
  const failuresKept = fill(failureCandidates, failureBytes, Math.max(0, capBytes - humanBytes));
  const thoughtCandidates = parts.flatMap((part) => part.thoughts).map((item) => ({ item, at: position.get(item) ?? -1 }));
  const thoughtsKept = fill(thoughtCandidates, bytes, Math.max(0, capBytes - humanBytes - failuresKept.used));
  const keep = (list, kept) => list.filter((item) => kept.has(item));
  const shaped = parts.map((part) => {
    const failures = keep(part.failures, failuresKept.kept), thoughts = keep(part.thoughts, thoughtsKept.kept);
    return { ...part, failures, failuresLeftOut: part.failures.length - failures.length, thoughts,
      thoughtsLeftOut: part.thoughts.length - thoughts.length };
  });
  const rides = rideBack.map((ride) => {
    const failures = keep(ride.failures, failuresKept.kept);
    return { ...ride, failures, leftOut: ride.failures.length - failures.length };
  });
  const [first] = shaped;
  return { parts: shaped, rideBack: rides,
    // The window's first part, and the whole window's totals, as a window of one session always read them.
    activeTask: first.activeTask, activeTaskShown: first.activeTaskShown,
    humans: shaped.flatMap((part) => part.humans), thoughts: shaped.flatMap((part) => part.thoughts),
    failures: shaped.flatMap((part) => part.failures),
    thoughtsLeftOut: shaped.reduce((n, part) => n + part.thoughtsLeftOut, 0),
    failuresLeftOut: shaped.reduce((n, part) => n + part.failuresLeftOut, 0)
      + rides.reduce((n, ride) => n + ride.leftOut, 0),
    humanBytes, failureBytes: failuresKept.used, thoughtBytes: thoughtsKept.used, capBytes,
    ...(fittedCap ? { fitted: true } : {}) };
}

/** C-02 / H1 (session.js NATIVE_RESULT_SOURCES, re-declared: this module imports nothing): the sources a result's
 *  typed status may be read from. */
const TYPED_RESULT_SOURCES = Object.freeze(['native', 'hook']);

/**
 * Owner decision D68 (F): a PROVEN failure — an action whose result the recorder typed as failed: the result's typed
 * verdict `failed` (a native or hook source), a nonzero exit code, or the call's typed error flag (`recorded.isError`,
 * C-02 "M36 recorded facts"). Never a result's words, never a status the record does not prove (`unknown`, `unproven`),
 * never a cancelled or interrupted call. Structure only. M36 phase 3 review: never a call the recorder typed as denied
 * (`recorded.denial`, Claude Code's `toolDenialKind`: a human's refusal, a permission rule, the auto-mode classifier, a
 * cancelled call) — it never ran, so it is no failure of the agent's, whatever its error flag says.
 */
export function provenFailure(session, observation) {
  if (observation?.kind !== 'observation' || observation.phase !== 'terminal' || typeof observation.invocation !== 'string')
    return false;
  const call = typeof session?.event === 'function' ? session.event(observation.invocation) : null;
  if (call?.kind !== 'invocation' || (call.childId ?? null) !== (observation.childId ?? null)) return false;
  // A call the recorder typed as interrupted (the human stopped it) is no failure of the agent's, whatever its flag says.
  if (call.recorded?.interrupted === true) return false;
  // Nor one it typed as denied: refused, blocked or cancelled before it ran.
  if (typeof call.recorded?.denial === 'string') return false;
  return (observation.result === 'failed' && TYPED_RESULT_SOURCES.includes(observation.sourceOfResult))
    || (Number.isFinite(observation.exitCode) && observation.exitCode !== 0)
    || call.recorded?.isError === true;
}

/** The proven failures among `events`, in recorded order: `{ call, result }`, each result with the call it answers. */
function provenFailuresIn(session, events) {
  return events.filter((event) => provenFailure(session, event))
    .map((result) => ({ call: session.event(result.invocation), result }));
}

/** Counts only: what a window was carried, for its record. M36 phase 3 (D68 F): and its proven failures — each session's
 *  own and those riding back from helpers — and how many the cap left out. */
export function carriedRecord(context) {
  if (!context) return null;
  const rideBack = (context.rideBack ?? []).reduce((n, ride) => n + ride.failures.length, 0);
  return { humans: context.humans.length, thoughts: context.thoughts.length, thoughtsLeftOut: context.thoughtsLeftOut,
    humanBytes: context.humanBytes, thoughtBytes: context.thoughtBytes,
    failures: (context.failures ?? []).length + rideBack, helperFailures: rideBack,
    failuresLeftOut: context.failuresLeftOut ?? 0, failureBytes: context.failureBytes ?? 0,
    capped: context.thoughtsLeftOut > 0 || (context.failuresLeftOut ?? 0) > 0,
    // M36 phase 3: the cap was lowered to fit the window's request under the review's bound (present only then).
    ...(context.fitted ? { fitted: true } : {}) };
}

/** The ids a window carries (never its own events): the events a vote or a proposal may cite from its carried context —
 *  its earlier human messages and thoughts, and (D68 F) each carried proven failure's action and result. */
export const carriedIds = (context) => (context ? [...context.humans, ...context.thoughts,
  ...(context.failures ?? []).flatMap((failure) => [failure.call, failure.result]),
  ...(context.rideBack ?? []).flatMap((ride) => ride.failures.flatMap((failure) => [failure.call, failure.result]))]
  .map((event) => event.id) : []);

// ---- per-window aliases ------------------------------------------------------------------------------------------------

/**
 * Token saving (C-07 "M35 windowing"): inside a session review's request every event is named by a short per-window
 * alias — `E1`, `E2`, … in the order the request first names it, which is deterministic from the window — and every id
 * an answer cites is mapped back to the event's stable id (C-01) before anything reads it. An id the table does not hold
 * passes through unchanged both ways, so it names nothing it was not shown. `freeze` stops new aliases: a dossier built
 * later from the same window names only what the window's request named.
 */
export function aliasTable() {
  const toAlias = new Map(), toStable = new Map();
  let frozen = false;
  const of = (id) => {
    if (typeof id !== 'string' || !id) return id;
    const known = toAlias.get(id);
    if (known !== undefined) return known;
    if (frozen) return id;
    const alias = `E${toAlias.size + 1}`;
    toAlias.set(id, alias);
    toStable.set(alias, id);
    return alias;
  };
  return { of, stable: (alias) => (typeof alias === 'string' && toStable.has(alias) ? toStable.get(alias) : alias),
    // M36 phase 3 (D68 Q): does the table name this stable id — did the window's request name the event?
    has: (id) => toAlias.has(id), ids: () => [...toAlias.keys()],
    freeze() { frozen = true; return this; }, get size() { return toAlias.size; } };
}

const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The closed list of keys whose value is a list of event ids, in anything a request shows or an answer returns: a
 * decision's `actions` (the narrative's answer) and, on a forbidden edit's challenge candidate (forbidden.js
 * `forbiddenChallengeItem`), every human instruction (`humanInstructionsBetween`) and every human choice
 * (`humanChoicesBetween`) recorded between its instruction and its action. M35 review R1: a candidate that named these
 * by stable ids inside an aliased request named events its evidence never showed by that name. D71 (S2): and
 * the actions a session-only requirement or claim rests on (`restsOn`).
 */
export const EVENT_ID_LISTS = Object.freeze(['actions', 'humanInstructionsBetween', 'humanChoicesBetween', 'restsOn']);

/**
 * A model-shaped value with every event id it cites mapped by `map` — each `eventId` and each entry of an id list
 * (`EVENT_ID_LISTS`), at any depth up to 32 — as a copy; nothing else is touched. Used both ways: aliases to stable ids
 * on an answer, stable ids to aliases on a candidate a challenger is shown.
 */
export function mapEventIds(value, map, depth = 0) {
  if (typeof map !== 'function' || depth > 32) return value;
  if (Array.isArray(value)) return value.map((item) => mapEventIds(item, map, depth + 1));
  if (!plainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'eventId' && typeof item === 'string') out[key] = map(item);
    else if (EVENT_ID_LISTS.includes(key) && Array.isArray(item))
      out[key] = item.map((id) => (typeof id === 'string' ? map(id) : id));
    else out[key] = mapEventIds(item, map, depth + 1);
  }
  return out;
}
