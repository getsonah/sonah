// D104 (owner pick 2026-10-17; F5 part 4, the mark): say what the session review did not see. A window shows a recorded
// result longer than twice its skim (windows.js `SKIM_SIDE_BYTES`) as a head and a tail, its middle named by lines and
// bytes; until now nothing past the window's request said so. Each result an answered window's request showed only in
// part is recorded once, on one window (`seenInPart`: `seenInPartOfWindows`), the report counts them (the coverage fact
// `resultsSeenInPart`, the sum over its windows), and each row of the session review whose evidence cites one carries a
// mark that names the lines left out and the result's place in the recording. A row keeps its status: the mark is a
// fact beside it, never a check.
//
// Structure only: an event's kind, the ids a row cites, and the positional cut the window applied (`eventView`). No word
// of an output, a thought or a row is read. Deterministic: no clock, no random source, no model.
import { eventView } from './windows.js';
import { citedEventIds } from './prompt.js';

/** The row sets of the session review that can carry the mark, as the report holds them. The code step's rows cite the
 *  repository, not a recorded result, and carry none. */
export const SEEN_IN_PART_SOURCES = Object.freeze(['requirements', 'decisions', 'pivots', 'writtenClaims', 'findings',
  'failures', 'promises']);

const whole = (n) => Number.isSafeInteger(n) && n >= 0;
const lineNumber = (n) => Number.isSafeInteger(n) && n >= 1;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * What a window's request showed of one recorded result, when it showed it only in part: `{ eventId, sequence,
 * fromLine, throughLine, partFrom, partThrough, fileLines, bytes }` — the facts the request's own omission line names
 * (prompt.js `omittedLine`): the lines its cut left out (1-based in the output's stored text), whether the first
 * (`partFrom`) or the last (`partThrough`) of them is shown in part (a line longer than the skim's side is cut inside
 * it), a numbered read's file lines of them (`{ from, through }`, else null), and the UTF-8 bytes not shown; and the
 * event's place in the recording (`sequence`). Null for any other event, or one shown whole. The cut is the window's
 * (`settings`): every request of a window shows an uncited result so, and its first request shows every result so (a
 * challenge may show a cited one whole, D103; the mark names the window's cut either way).
 */
export function shownInPart(session, event, settings) {
  if (event?.kind !== 'observation' || typeof event.id !== 'string') return null;
  const view = eventView(session, event, settings);
  const field = view.fields[0];
  if (!field?.omitted) return null;
  const file = view.fileLines;
  return { eventId: event.id, sequence: whole(event.sequence) ? event.sequence : null, fromLine: field.omitted.fromLine,
    throughLine: field.omitted.throughLine, partFrom: field.omitted.partFrom === true,
    partThrough: field.omitted.partThrough === true,
    fileLines: plain(file) && lineNumber(file.from) && lineNumber(file.through) ? { from: file.from, through: file.through }
      : null,
    bytes: field.omittedBytes };
}

/** By recorded order, then by id: the order every list of this module keeps. */
const byPlace = (a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity)
  || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

/**
 * The results the answered windows' requests showed only in part, each recorded once: `windows` one entry per planned
 * window, in window order, `{ answered, events, shownIds, settings }` — whether its narrative answered (the session
 * review read it), its own events, the ids of every event its request showed (its source map: its carried context too)
 * and its cut. A result is recorded on the first answered window whose request showed it in part: its own window, or,
 * when that window was not read, the first later window that carried it. Each event's cut is read once.
 * Returns `{ records, index }`: `records[i]` the results window `i` records, in recorded order (empty for a window not
 * read); `index` every recorded result by event id. So the report's count, the sum over the records, is the index's
 * size, and every result a row is marked for is counted exactly once.
 */
export function seenInPartOfWindows(session, windows) {
  const index = new Map();
  const read = new Set();
  const records = (Array.isArray(windows) ? windows : []).map((window) => {
    const out = [];
    if (window?.answered !== true) return out;
    const own = (Array.isArray(window.events) ? window.events : []).map((event) => event?.id);
    for (const id of [...own, ...(Array.isArray(window.shownIds) ? window.shownIds : [])]) {
      if (typeof id !== 'string' || read.has(id)) continue;
      read.add(id);
      const seen = shownInPart(session, session?.event?.(id), window.settings);
      if (!seen) continue;
      index.set(id, seen);
      out.push(seen);
    }
    return out.sort(byPlace);
  });
  return { records, index };
}

/**
 * The mark of one row: each result it cites (`citedEventIds`: every receipt's event id, at any depth, and the actions
 * it names; a failure row's own result) that `index` holds, in recorded order, each once. Empty when it cites none.
 */
export function rowSeenInPart(row, index) {
  if (!plain(row) || !(index instanceof Map) || !index.size) return [];
  const out = [];
  for (const id of citedEventIds(row)) if (index.has(id)) out.push(index.get(id));
  return out.sort(byPlace).map((seen) => ({ ...seen, fileLines: seen.fileLines ? { ...seen.fileLines } : null }));
}

/**
 * Puts the mark on every row of the session review's sets (SEEN_IN_PART_SOURCES) that cites a result `index` holds:
 * `row.seenInPart`, its `rowSeenInPart`. A row that cites none carries no field, so its bytes are as before. Nothing
 * else of a row moves: its status, its reason and its receipts stay. Returns how many rows it marked.
 */
export function markSeenInPart(report, index) {
  let marked = 0;
  for (const source of SEEN_IN_PART_SOURCES) {
    for (const row of Array.isArray(report?.[source]) ? report[source] : []) {
      if (!plain(row)) continue;
      if (Object.hasOwn(row, 'seenInPart')) delete row.seenInPart;
      const mark = rowSeenInPart(row, index);
      if (!mark.length) continue;
      row.seenInPart = mark;
      marked++;
    }
  }
  return marked;
}

/**
 * A reader's view of a row's mark (the page, the Markdown report): its entries whose fields are what this module writes —
 * an event id, whole line numbers in order, a flag for each end line shown in part, a numbered read's file lines or
 * null, whole bytes, a place or null — each once, in recorded order. Anything else is no mark. Pure.
 */
export function seenInPartOf(row) {
  if (!plain(row) || !Array.isArray(row.seenInPart)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of row.seenInPart) {
    if (!plain(entry) || typeof entry.eventId !== 'string' || !entry.eventId || seen.has(entry.eventId)) continue;
    if (!lineNumber(entry.fromLine) || !Number.isSafeInteger(entry.throughLine) || entry.throughLine < entry.fromLine
      || typeof entry.partFrom !== 'boolean' || typeof entry.partThrough !== 'boolean' || !whole(entry.bytes)) continue;
    const file = entry.fileLines;
    if (file !== null && !(plain(file) && lineNumber(file.from) && Number.isSafeInteger(file.through)
      && file.through - file.from === entry.throughLine - entry.fromLine)) continue;
    seen.add(entry.eventId);
    out.push({ eventId: entry.eventId, sequence: whole(entry.sequence) ? entry.sequence : null, fromLine: entry.fromLine,
      throughLine: entry.throughLine, partFrom: entry.partFrom, partThrough: entry.partThrough,
      fileLines: file === null ? null : { from: file.from, through: file.through }, bytes: entry.bytes });
  }
  return out.sort(byPlace);
}
