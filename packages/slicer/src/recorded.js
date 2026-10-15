// D68 (owner decision 2026-10-07; C-02 "M36 recorded facts"). The recorder's TYPED facts about a call, read once at
// slicing from the recorder's own structured fields, never from the words of an output or a thought: the recorder's
// own tool name, a Codex command's parsed meaning (`parsed_cmd`), a change's line-numbered hunks, a Claude Code result's
// sidecar (`toolUseResult`) numbers, booleans and strings. Each is carried on the ledger event as `recorded`, in the
// closed vocabulary redaction validates and scrubs before slice_hash (redact/index.js `RECORDED_FACTS`). Deterministic:
// no clock, no model, no network, no filesystem.

import { posix } from 'node:path';
import { RECORDED_FACTS, scrubHunks } from '../../redact/index.js';
import { withheldFileReason, spelledPath } from './before.js';

const own = (value, key) => Object.hasOwn(value, key);
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
/** A recorder string (any non-empty string), or undefined. D69 review: no length bound and no shape guess (redact/index.js
 *  `recorderString`); redaction withholds a flagged one whole. */
const text = (value) => (typeof value === 'string' && value.length > 0 ? value : undefined);
/** A recorder value that was recorded (present, and not null or an empty string or list): when Sonah cannot carry it as
 *  a fact, the facts say so (`withheld`), never silence (M36 review: "not recorded" and "dropped by Sonah" differ). */
const recordedValue = (value) => value !== undefined && value !== null && value !== ''
  && !(Array.isArray(value) && value.length === 0);

/** A recorded hunk exactly as the recorder wrote it, or null: `{oldStart, oldLines, newStart, newLines, lines}`. */
function hunkOf(h) {
  if (!plain(h) || !['oldStart', 'oldLines', 'newStart', 'newLines'].every((key) => count(h[key]))
    || !Array.isArray(h.lines) || !h.lines.every((line) => typeof line === 'string' && !line.includes('\n')
      && (line === '' || [' ', '-', '+', '\\'].includes(line[0])))) return null;
  return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines: [...h.lines] };
}
/** Claude Code's `structuredPatch` (an Edit's, a Write update's, a `bashEditDiff` file's): its hunks, or null when it
 *  records none or any one of them is not a hunk. No count bounds them (D68 E: an edit has no fixed size limit). */
export function recordedHunks(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const hunks = value.map(hunkOf);
  return hunks.every(Boolean) ? hunks : null;
}

/** A unified diff's hunk header: `@@ -a[,b] +c[,d] @@` and an optional section heading. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/**
 * C (1): a Codex FileChange update's `unified_diff` read as the recorder's hunks, with their line numbers kept: each
 * header's starts and lengths (a missing length is 1, as the format writes it), and its lines (context, `-`, `+`, a
 * `\` no-newline line) until both lengths are spent. Null when the text holds no hunk, a header or a line out of place,
 * or a hunk whose lines do not add up to its own lengths: then no hunk is recorded for the change.
 */
export function parseUnifiedHunks(diff) {
  if (typeof diff !== 'string' || !diff.length) return null;
  // The line break that ends the text ends its last line: it opens no empty line of its own.
  const lines = (diff.endsWith('\n') ? diff.slice(0, -1) : diff).split('\n');
  const hunks = [];
  let i = 0;
  while (i < lines.length && !HUNK_HEADER.test(lines[i])) {
    if (!/^(?:diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |old mode |new mode |similarity index |rename )/
      .test(lines[i]) && lines[i] !== '') return null;
    i++;
  }
  while (i < lines.length) {
    const m = HUNK_HEADER.exec(lines[i]);
    if (!m) {
      // Only empty lines may follow the last hunk (a diff text ends with its line break).
      if (lines.slice(i).every((line) => line === '') && hunks.length) break;
      return null;
    }
    const h = { oldStart: Number(m[1]), oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]), newLines: m[4] === undefined ? 1 : Number(m[4]), lines: [] };
    if (![h.oldStart, h.oldLines, h.newStart, h.newLines].every(count)) return null;
    let old = h.oldLines;
    let neu = h.newLines;
    i++;
    while (i < lines.length && (old > 0 || neu > 0 || lines[i].startsWith('\\'))) {
      const line = lines[i];
      if (line.startsWith('\\')) { if (!h.lines.length) return null; h.lines.push(line); i++; continue; }
      const marker = line === '' ? ' ' : line[0];
      if (marker === ' ') { old--; neu--; }
      else if (marker === '-') old--;
      else if (marker === '+') neu--;
      else return null;
      if (old < 0 || neu < 0) return null;
      h.lines.push(line);
      i++;
    }
    if (old !== 0 || neu !== 0) return null;
    hunks.push(h);
  }
  return hunks.length ? hunks : null;
}

/**
 * C (3), (c5). A Codex CommandExecution's `parsed_cmd`, the recorder's own typed reading of its command: one entry per
 * part, `{type}` from its closed set (`read`, `search`, `list_files`, `unknown`) with the recorder's own strings for that
 * type (a read's `name` and `path`, a search's `query` and `path`, a listing's `path`), verbatim (redaction scrubs them).
 * Each entry's `cmd` text is not carried: it is the command's own text, already the action. Null for any other shape.
 */
export function codexParsedCmd(value) {
  if (!Array.isArray(value) || !value.length) return null;
  const keys = { read: ['name', 'path'], search: ['query', 'path'], list_files: ['path'], unknown: [] };
  const entries = [];
  for (const entry of value) {
    if (!plain(entry) || !RECORDED_FACTS.parsedCmdTypes.includes(entry.type)) return null;
    const allowed = keys[entry.type];
    if (Object.keys(entry).some((key) => key !== 'type' && key !== 'cmd' && !allowed.includes(key))) return null;
    const kept = { type: entry.type };
    for (const key of allowed) {
      if (!own(entry, key)) continue;
      if (entry[key] === null) kept[key] = null;
      else if (typeof entry[key] === 'string') kept[key] = entry[key];
      else return null;
    }
    entries.push(kept);
  }
  return entries;
}
/** What a Codex item's `parsed_cmd` gives its command: its entries (`parsedCmd`); recorded but not readable as them, a
 *  mark (`parsedCmdUnread`: the facts say `withheld`, the class is `command`); nothing when the recorder typed none. */
export const recordedParsedCmd = (value) => {
  if (!recordedValue(value)) return {};
  const parsedCmd = codexParsedCmd(value);
  return parsedCmd ? { parsedCmd } : { parsedCmdUnread: true };
};
/** (c5; M36 review) The Codex tools whose calls run a command, by the recorder's own name (with or without its
 *  `functions.` namespace; codex.js `TOOL_ALIAS`, `headerOf`): a call so named is a `command` whatever kind the slicer
 *  made of its input — a legacy `shell_command`, an `exec_command` whose input it could not read. */
export const CODEX_COMMAND_TOOLS = Object.freeze(['exec_command', 'shell', 'local_shell', 'shell_command', 'container.exec']);
export const codexCommandTool = (name) => typeof name === 'string'
  && CODEX_COMMAND_TOOLS.includes(name.startsWith('functions.') ? name.slice('functions.'.length) : name);
/** (c5) A Codex command's class, set once at slicing: `read` only when every recorded entry is a read. */
export const commandClassOf = (parsedCmd) => (Array.isArray(parsedCmd) && parsedCmd.length
  && parsedCmd.every((entry) => entry.type === 'read') ? 'read' : 'command');

/**
 * (c2) A change's recorded hunks, scrubbed before slice_hash with the whole recorded file where one exists
 * (redact/index.js `scrubHunks`): `{ hunks, scrub, reasons, lost }`, or null (no hunk is kept). D84: `mask: false` (a
 * session review's load) keeps every line as recorded, `scrub` null.
 */
export const scrubbedHunks = (hunks, file = null, { mask = true } = {}) =>
  (hunks ? scrubHunks(hunks, file, { mask }) : null);

/** A path the way the slicer spells a call's path (events.js `makeEvent`: normalized, then `relative`): before.js
 *  `spelledPath` — relative under the recorder's cwd, as recorded outside it (D69 review F7). */
const relativeTo = (path, cwd) => {
  const s = String(path);
  return spelledPath(s.startsWith('/') ? posix.normalize(s) : s, cwd);
};

/**
 * D. A Claude Code Bash result's `bashEditDiff` (2.1.270 and later: the files the command changed): each file's path
 * (spelled as the slicer spells paths), whether the recorder typed it created or deleted, and its line-numbered hunks
 * scrubbed as one change each; the recorder's `changedFiles` list, `moreFiles` count and `shared`/`unavailable` flags.
 * D68 (R), D69 (b): a file whose content is withheld (before.js `withheldFileReason`: a credential-shaped path, a harness
 * home folder of the recording's user, `place` its home and the recorder's cwd) carries no hunk, only `hunksWithheld` (its closed reason). `{ editDiff, reasons, lost, unread }` or null for any
 * other shape: `unread` when a file's recorded hunks could not be read (the facts say `withheld`). D69 (c): a path is
 * spelled by the recorder's working directory, as an event's is; no work root re-spells it.
 */
export function bashEditDiffFacts(value, cwd, place = { cwd }, { mask = true } = {}) {
  if (!plain(value)) return null;
  if (Object.keys(value).some((key) => !RECORDED_FACTS.editDiff.includes(key))) return null;
  const editDiff = {};
  const reasons = [];
  let lost = false;
  let unread = false;
  if (own(value, 'files')) {
    if (!Array.isArray(value.files)) return null;
    editDiff.files = [];
    for (const file of value.files) {
      if (!plain(file) || typeof file.filePath !== 'string' || !file.filePath
        || Object.keys(file).some((key) => !['filePath', 'hunks', 'created', 'deleted'].includes(key))) return null;
      const entry = { path: relativeTo(file.filePath, cwd) };
      if (file.created === true) entry.created = true;
      if (file.deleted === true) entry.deleted = true;
      const why = withheldFileReason(file.filePath, place);
      if (why && recordedValue(file.hunks)) entry.hunksWithheld = why;
      else if (!why) {
        const hunks = recordedHunks(file.hunks);
        const scrubbed = scrubbedHunks(hunks, null, { mask });
        if (scrubbed) {
          entry.hunks = scrubbed.hunks;
          // D84: an unmasked read scrubbed nothing, and declares no scrub.
          if (scrubbed.scrub) entry.hunkScrub = scrubbed.scrub;
          reasons.push(...scrubbed.reasons);
          lost = lost || scrubbed.lost;
        } else if (recordedValue(file.hunks)) unread = true;
      }
      editDiff.files.push(entry);
    }
  }
  if (own(value, 'changedFiles')) {
    if (!Array.isArray(value.changedFiles) || !value.changedFiles.every((path) => typeof path === 'string')) return null;
    editDiff.changedFiles = value.changedFiles.map((path) => relativeTo(path, cwd));
  }
  if (count(value.moreFiles)) editDiff.moreFiles = value.moreFiles;
  if (typeof value.shared === 'boolean') editDiff.shared = value.shared;
  if (typeof value.unavailable === 'boolean') editDiff.unavailable = value.unavailable;
  return { editDiff, reasons, lost, unread };
}

/**
 * D. What a Claude Code result sidecar (`toolUseResult`, `raw`, a parent recording's only: helper recordings carry none)
 * types about its call, by the recorder's tool name: a Read's `file` window, a Grep's or Glob's counts, a WebFetch's
 * URL, status code and size, a WebSearch's query and result count, a Bash call's typed flags and background task id.
 * Numbers, booleans and recorder strings only; nothing read from the result's text. An Edit's or Write's hunks and type
 * are read where its prior state is (events.js `attachResult`).
 */
export function claudeSidecarFacts(tool, raw) {
  const facts = {};
  if (!plain(raw)) return facts;
  if (tool === 'Read' && plain(raw.file) && count(raw.file.startLine) && count(raw.file.numLines)) {
    facts.read = { startLine: raw.file.startLine, numLines: raw.file.numLines,
      ...(count(raw.file.totalLines) ? { totalLines: raw.file.totalLines } : {}) };
  } else if (tool === 'Grep' || tool === 'Glob') {
    const search = {};
    if (RECORDED_FACTS.searchModes.includes(raw.mode)) search.mode = raw.mode;
    for (const key of ['numFiles', 'numLines', 'numMatches', 'totalMatches']) if (count(raw[key])) search[key] = raw[key];
    if (typeof raw.truncated === 'boolean') search.truncated = raw.truncated;
    if (Object.keys(search).length) facts.search = search;
  } else if (tool === 'WebFetch') {
    const fetch = {};
    if (text(raw.url)) fetch.url = raw.url;
    else if (recordedValue(raw.url)) facts.withheld = true;
    if (count(raw.code)) fetch.code = raw.code;
    if (count(raw.bytes)) fetch.bytes = raw.bytes;
    if (Object.keys(fetch).length) facts.fetch = fetch;
  } else if (tool === 'WebSearch') {
    const webSearch = {};
    if (text(raw.query)) webSearch.query = raw.query;
    else if (recordedValue(raw.query)) facts.withheld = true;
    if (Array.isArray(raw.results)) webSearch.results = raw.results.length;
    if (Object.keys(webSearch).length) facts.webSearch = webSearch;
  } else if (tool === 'Bash') {
    if (typeof raw.interrupted === 'boolean') facts.interrupted = raw.interrupted;
    if (typeof raw.noOutputExpected === 'boolean') facts.noOutputExpected = raw.noOutputExpected;
    if (text(raw.backgroundTaskId)) facts.backgroundTaskId = raw.backgroundTaskId;
    else if (recordedValue(raw.backgroundTaskId)) facts.withheld = true;
  }
  return facts;
}

/**
 * M36 phase 3 review (D68 F; C-02 "M36 recorded facts"). Claude Code's typed denial of a call: its result row's own
 * `toolDenialKind` (read only where the row holds that one result: a row with several result blocks attributes its row
 * fields to none of them), a member of the recorder's closed vocabulary (`RECORDED_FACTS.denial`). `{ denial }`, or
 * `{ withheld: true }` for a recorded value Sonah cannot carry, or `{}` when none was recorded. Never read from words.
 */
export function claudeDenialFacts(kind) {
  if (kind === undefined || kind === null) return {};
  return RECORDED_FACTS.denial.includes(kind) ? { denial: kind } : { withheld: true };
}

/** D. A Claude Code Agent hand-off's typed result: its recorded status and tool-use count, beside the recorder's tool
 *  name, for its delegation receipt. Null when the result recorded neither. */
export function claudeAgentFacts(tool, raw) {
  if (!plain(raw)) return null;
  const facts = {};
  if (text(raw.status)) facts.status = raw.status;
  else if (recordedValue(raw.status)) facts.withheld = true;
  if (count(raw.totalToolUseCount)) facts.totalToolUseCount = raw.totalToolUseCount;
  return Object.keys(facts).length ? { tool, ...facts } : null;
}
