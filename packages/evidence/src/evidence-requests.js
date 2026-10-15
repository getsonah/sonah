// M36 phase 3 — a narrative window's evidence request and its DETERMINISTIC re-ask (owner decision 2026-10-07,
// D68 Q; critique c3, c4; C-07 "M36 evidence re-ask"). A window shows what the agent consumed cut by one positional rule
// and the file before an edit not at all; both are "available on request". The first narrative answer may carry a typed
// request (`evidenceRequests`: an event and a line range, or the file before an edit and a line range). Sonah then builds
// ONE more request from bytes alone, serving the requested lines — sorted, de-duplicated, from the REDACTED ledger, only
// of events the window's request named (its alias table), capped by frozen literals and by the window's remaining work
// budget — with every item it does not serve said by a fixed line of a closed reason. D71 (S2): the
// served lines are placed AT THEIR EVENTS — the re-ask re-renders the window (prompt.js `buildNarrativePrompt` with
// `served`), each served range between its field's head and tail under its label, every part still not shown keeping
// its omission line — never appended under a section of their own (appending buys no cache read for a re-ask that
// extends the first request). Never a conversation: no answer's words enter a request,
// only the set of items asked for, and the same set gives the same bytes, so the re-ask is keyed by its bytes like any
// request (D60) and replays from the answer store with no call. Served spans join the window's source map (C-05 "M36
// grounding per shown span"), so a quote from them grounds by string search like any shown span.
//
// Deterministic: no clock, no random source, no model, no file. Nothing here reads a word of an answer or a record: ids,
// line numbers and positions only.

import { requestableTexts, servedLines } from './windows.js';

/**
 * The frozen bounds of a window's evidence requests (owner decision D68 Q: "bounded by frozen literals in one constants
 * file (items, bytes, and at most R re-asks per window)"). One place; each literal justified:
 *   - `reasks` 1: the owner's start (R = 1). A window is asked at most once more, so its calls stay bounded: one narrative,
 *     at most one re-ask, then the challenge calls as before.
 *   - `items` 8: the most distinct line ranges served to one window. A window's cut results are few (under one per
 *     window for Claude Code) except in long Codex windows (a few dozen), where a narrative
 *     checks a handful of claims; eight ranges serve a claim-heavy window without letting one answer page a window's
 *     whole middle back in.
 *   - `bytes` 72,000: the most bytes served to one window: ten observations' shown halves (2 x 3,600 bytes at the 2k trim)
 *     and 10% of the window's 720,000-byte work budget, so a served window stays inside the spec's worst-case call (200k
 *     work + 200k carried + the fixed text, 450k tokens) — and never more than the window's own remaining work budget.
 *   - `parsed` 256: the most request entries one answer's list is read for; the rest are counted (`over_items`) unread,
 *     so a hostile answer costs bounded work.
 * D69 review (2026-10-08): these are cost bounds the owner asked for as literals (D68 Q names items and bytes), not a
 * reading of what an answer means, so they stay. Each window's record counts what they refused
 * (`evidence.refused.over_items`, `.over_budget`), so a bound that refuses what a window needed shows in its record.
 */
export const EVIDENCE_REQUEST_LIMITS = Object.freeze({ reasks: 1, items: 8, bytes: 72_000, parsed: 256 });

/**
 * Why a requested item was not served (closed: per-reason rates stay computable; the request names each by its code).
 *   malformed       not an item of the request's shape (an event id, whole line numbers from <= through)
 *   unknown_event   names no event of the session
 *   out_of_window   names an event the window's request never named (outside its alias table)
 *   not_requestable the event holds no text of the kind asked: an instruction or a statement (shown whole), a call with
 *                   no recorded file before it, an edit's own change (shown as recorded; its command and input hold no
 *                   text), a field with no stored text
 *   withheld        an output, or the file before a change, Sonah withheld before review (a credential-shaped path or a
 *                   harness home folder of the recording's user, D68 R, D69 b)
 *   out_of_range    the lines lie outside the text
 *   shown           every requested line is already shown in the window
 *   repeated        every requested line was served by an earlier re-ask of this window
 *   over_items      beyond the item bound (`EVIDENCE_REQUEST_LIMITS.items`, or `parsed` entries read)
 *   over_budget     the bytes left (`EVIDENCE_REQUEST_LIMITS.bytes`, the window's remaining work budget) do not hold it
 *   reask_limit     requested in an answer no re-ask follows: the window's re-asks are used
 *   request_bound   the re-ask would not fit the review's request bound, so it was not sent
 */
export const EVIDENCE_REQUEST_REFUSALS = Object.freeze(['malformed', 'unknown_event', 'out_of_window', 'not_requestable',
  'withheld', 'out_of_range', 'shown', 'repeated', 'over_items', 'over_budget', 'reask_limit', 'request_bound']);

/** The answer member that carries the requests (a session-only narrative's contract, prompt.js). */
export const EVIDENCE_REQUEST_MEMBER = 'evidenceRequests';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const whole = (n) => Number.isSafeInteger(n) && n >= 1;
const thousands = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const lineRange = (from, through) => (from === through ? `line ${thousands(from)}` : `lines ${thousands(from)}–${thousands(through)}`);
const zeros = () => Object.fromEntries(EVIDENCE_REQUEST_REFUSALS.map((reason) => [reason, 0]));

/** The requests an answer carries (its `evidenceRequests` list), or null when it carries none (absent, or an empty
 *  list). A member that is not a list is one request no check can read (`malformed`, counted; read apart like a
 *  `writtenClaims` that is not a list, never failing the answer — and the answer store, whose schema asks for a list,
 *  does not keep it, so the next review asks again). Reads nothing else. */
export function requestsOf(answer) {
  if (!plain(answer) || !Object.hasOwn(answer, EVIDENCE_REQUEST_MEMBER)) return null;
  const listed = answer[EVIDENCE_REQUEST_MEMBER];
  return Array.isArray(listed) ? (listed.length ? listed : null) : [listed];
}

/** An answer without its requests: what the window reads and records (the requests are counted, never kept). */
export function withoutRequests(answer) {
  if (!plain(answer) || !Object.hasOwn(answer, EVIDENCE_REQUEST_MEMBER)) return answer;
  const { [EVIDENCE_REQUEST_MEMBER]: _requests, ...rest } = answer;
  return rest;
}

/** One request entry, read by shape alone: `{ eventId, fileBefore, from, through }`, or null (malformed). M36 phase 3
 *  review: no hidden length bound on the id — an id no event has is `unknown_event`, whatever its length, and an id is
 *  never written into a request (an item the window names is said by its alias; the rest by count). */
function shapeOf(entry) {
  if (!plain(entry) || !Object.keys(entry).every((key) => ['eventId', 'fileBefore', 'fromLine', 'throughLine'].includes(key))
      || typeof entry.eventId !== 'string' || !entry.eventId
      || (entry.fileBefore !== undefined && typeof entry.fileBefore !== 'boolean')
      || !whole(entry.fromLine) || !whole(entry.throughLine) || entry.fromLine > entry.throughLine) return null;
  return { eventId: entry.eventId, fileBefore: entry.fileBefore === true, from: entry.fromLine, through: entry.throughLine };
}

/** Merge line ranges (sorted, overlapping or touching ones joined): the set a list of ranges names, in order. */
function merged(ranges) {
  const out = [];
  for (const [from, through] of [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const last = out.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], through);
    else out.push([from, through]);
  }
  return out;
}

const PART_ORDER = Object.freeze({ output: 0, command: 1, input: 2, before: 3 });

/**
 * Serve one round of requests for one window. `requests` the answer's raw list, already mapped from the window's aliases
 * to stable ids; `aliases` the window's frozen alias table (only events it names are served); `sourceMap` the window's
 * (an event in it was shown, so only its omitted lines are served); `served` what earlier rounds of this window served
 * (`{ key -> [[from, through], ...] }`, for `repeated`); `maxBytes` the bytes this round may serve. Returns `{ byEvent,
 * notes, sources, served, record }`: D71 (S2) the served blocks by stable event id (`{ part, holder, path, from,
 * through, partial, spans, role, invocation, report }`, placed at their events by the re-ask's render; empty when nothing
 * is served), the fixed lines of what was asked for and not served (shown to the re-ask's narrative only, never to a
 * challenger), the served spans by stable id (`{ role, text, served: true }`), the served ranges (for a later round), and
 * the counts.
 */
export function serveEvidence({ session, settings = null, aliases, sourceMap, requests, served = {}, maxBytes,
  alias = (id) => (aliases && typeof aliases.of === 'function' ? aliases.of(id) : id) }) {
  const refused = zeros();
  const list = Array.isArray(requests) ? requests : [];
  const read = list.slice(0, EVIDENCE_REQUEST_LIMITS.parsed);
  refused.over_items += list.length - read.length;
  // De-duplicated as a set: an entry asked twice is one entry, so the same set of requests gives the same bytes.
  const seen = new Set(), wanted = new Map();
  const unknown = { unknown_event: 0, out_of_window: 0, malformed: 0 };
  read.forEach((entry, at) => {
    const shape = shapeOf(entry);
    let raw = null;
    // A malformed entry is one entry by its whole JSON (M36 phase 3 review: no hidden length bound decides whether two
    // equal entries are one); only one JSON cannot write is one by its position.
    if (!shape) try { raw = JSON.stringify(entry) ?? null; } catch { raw = null; }
    const identity = shape ? JSON.stringify([shape.eventId, shape.fileBefore, shape.from, shape.through])
      : typeof raw === 'string' ? `malformed:${raw}` : `malformed#${at}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    if (!shape) { unknown.malformed++; return; }
    const event = typeof session?.event === 'function' ? session.event(shape.eventId) : null;
    if (!event) { unknown.unknown_event++; return; }
    if (!aliases || typeof aliases.has !== 'function' || !aliases.has(event.id)) { unknown.out_of_window++; return; }
    const shown = sourceMap != null && Object.hasOwn(sourceMap, event.id);
    const texts = requestableTexts(session, event, settings, { fileBefore: shape.fileBefore, shown });
    const order = Number(String(alias(event.id)).slice(1)) || 0;
    if (!texts.length) { wanted.set(`refused:${identity}`, { order, event, shape, reason: 'not_requestable' }); return; }
    texts.forEach((text, index) => {
      const key = `${event.id}\u0000${text.part}\u0000${index}`;
      if (!wanted.has(key)) wanted.set(key, { order, event, text, index, ranges: [] });
      wanted.get(key).ranges.push([shape.from, shape.through]);
    });
  });
  for (const [reason, n] of Object.entries(unknown)) refused[reason] += n;
  // Sorted: by the window's alias order of the event, then the part, then the line.
  const items = [];
  for (const [key, want] of wanted) {
    if (want.reason) { items.push({ ...want, key, from: want.shape.from, through: want.shape.through, part: 'none' }); continue; }
    for (const [from, through] of merged(want.ranges)) items.push({ ...want, key, from, through, part: want.text.part });
  }
  items.sort((a, b) => a.order - b.order || (PART_ORDER[a.part] ?? 9) - (PART_ORDER[b.part] ?? 9)
    || (a.index ?? 0) - (b.index ?? 0) || a.from - b.from || a.through - b.through);
  const sources = Object.create(null), servedNow = {}, byEvent = new Map(), notes = [];
  let bytesLeft = Math.max(0, maxBytes), servedItems = 0, servedBytes = 0, counted = 0;
  const what = (item) => (item.part === 'output' ? (item.event.helperReported === true ? 'of its report' : 'of its output')
    : item.part === 'command' ? 'of its command' : item.part === 'input' ? 'of its tool input'
      : item.part === 'before' ? `of ${item.text.path ?? 'the file'} before this call, counted from the first line recorded of it`
        : 'of it');
  const refuse = (item, reason, from = item.from, through = item.through) => {
    refused[reason]++;
    notes.push(`[${alias(item.event.id)}] ${lineRange(from, through)} ${what(item)} (${reason})`);
  };
  for (const item of items) {
    if (item.reason) { refuse(item, item.reason); continue; }
    if (item.text.withheld) { refuse(item, 'withheld'); continue; }
    if (item.from > item.text.lines) { refuse(item, 'out_of_range'); continue; }
    const through = Math.min(item.through, item.text.lines);
    const [low, high] = item.text.servable ?? [1, 0];
    const from = Math.max(item.from, low), upto = Math.min(through, high);
    if (from > upto) { refuse(item, 'shown', item.from, through); continue; }
    const before = merged(served[item.key] ?? []);
    if (before.some(([a, b]) => a <= from && upto <= b)) { refuse(item, 'repeated', from, upto); continue; }
    if (counted >= EVIDENCE_REQUEST_LIMITS.items) { refuse(item, 'over_items', from, upto); continue; }
    counted++;
    const got = servedLines(session, item.text.holder, item.text.field, from, upto, bytesLeft);
    if (!got) { refuse(item, 'over_budget', from, upto); continue; }
    servedItems++;
    servedBytes += got.bytes;
    bytesLeft -= got.bytes;
    (servedNow[item.key] ??= []).push([from, got.through]);
    if (!byEvent.has(item.event.id)) byEvent.set(item.event.id, []);
    byEvent.get(item.event.id).push({ part: item.part, holder: item.text.holder, path: item.text.path ?? null, from,
      through: got.through, partial: got.partial, spans: got.spans, role: item.text.role,
      invocation: typeof item.event.invocation === 'string' ? item.event.invocation : null,
      report: item.event.helperReported === true });
    (sources[item.event.id] ??= []).push(...got.spans.map((text) => ({ role: item.text.role, text, served: true })));
    if (got.through < upto || got.partial) refuse(item, 'over_budget', got.partial ? got.through : got.through + 1, upto);
  }
  const record = { requested: list.length, items: items.length + Object.values(unknown).reduce((n, k) => n + k, 0),
    served: servedItems, servedBytes, refused };
  const counts = [
    ...(unknown.malformed ? [`${unknown.malformed} requested item(s) not in the request's shape (malformed)`] : []),
    ...(unknown.unknown_event ? [`${unknown.unknown_event} requested item(s) naming no event of this session (unknown_event)`] : []),
    ...(unknown.out_of_window ? [`${unknown.out_of_window} requested item(s) naming an event this window never named (out_of_window)`] : []),
    ...(list.length > read.length ? [`${list.length - read.length} requested item(s) past the first ${EVIDENCE_REQUEST_LIMITS.parsed}, not read (over_items)`] : []),
  ];
  // D71 (S2, D20, D21): no served section and no closing of its own — the re-ask's render places the blocks and says
  // what was not served under "About this window" (prompt.js `notServedLine`); its "Now answer" is the re-ask's.
  if (!servedItems) return { byEvent: new Map(), notes: [], sources, served: servedNow, record };
  return { byEvent, notes: [...notes, ...counts], sources, served: servedNow, record };
}

/** The empty counts of a window's evidence requests (its record when it requested nothing is absent). `kept`: `first`
 *  (no re-ask answer was kept) or `merged` (a re-ask's answer, merged with the first: run-review.js `servedAnswer`);
 *  `fromFirst`: the first answer's proposals the re-ask did not repeat, kept beside it (by exact identity). */
export const emptyEvidenceRecord = () => ({ requested: 0, items: 0, served: 0, servedBytes: 0, refused: zeros(), reasks: 0,
  reaskFailed: false, kept: 'first', fromFirst: 0 });

/** Sum one round's counts into a window's record. */
export function addRound(record, round) {
  record.requested += round.requested;
  record.items += round.items;
  record.served += round.served;
  record.servedBytes += round.servedBytes;
  for (const reason of EVIDENCE_REQUEST_REFUSALS) record.refused[reason] += round.refused[reason] ?? 0;
  return record;
}

/** A served source map: the window's, with every served span appended as one more entry of its event (C-05). */
export function withServed(sourceMap, sources) {
  const out = Object.create(null);
  for (const [id, list] of Object.entries(sourceMap ?? {})) out[id] = list;
  for (const [id, list] of Object.entries(sources ?? {})) out[id] = [...(out[id] ?? []), ...list];
  return out;
}

/** The lines a later round may not serve again, merged with this round's. */
export function servedSoFar(before, now) {
  const out = { ...before };
  for (const [key, ranges] of Object.entries(now)) out[key] = merged([...(out[key] ?? []), ...ranges]);
  return out;
}
