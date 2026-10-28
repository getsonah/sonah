// The ledger's bound, validation and hash. No masking.
//
// D90 (owner decision 2026-10-15, privacy is not a design constraint): Sonah masks nothing it reads, sends or shows.
// The reviewer model reads the recorded session as it was recorded (D84 already loaded it with masking off), and every
// page, story, terminal line and PR comment shows it as loaded. The secret detectors this module held (the secret
// shapes, the key-name and proximity rules, the entropy backstop, the key-block drops) and its output layer
// (`maskForPeople` and the values a session's walk hid) are deleted. What is left is the half every review always ran:
//
//   - `redact(ledger)`: the ledger BOUNDED and VALIDATED — an attached file over its budget cut at line boundaries
//     around a declared marker (`ATTACHED_CAP`), the recorder's typed facts rebuilt from their closed vocabulary
//     (`RECORDED_FACTS`), a task id's shape, the identity fields a ledger already declared unchecked, a recording's file
//     names replaced by their order. It is what `redact(…, { mask: false })` returned before D90, byte for byte, for
//     every recording whose texts hold no mark-shaped string (below), so such a recording's `slice_hash` is the same.
//   - `sliceHash(ledger)`: the session's identity, a SHA3-256 digest over the ledger's content.
//   - the helpers other packages read: the Read line-number rule (`READ_LINE_NUMBER`, `isNumberedRead`, `readText`),
//     a recorder's hunk shape (`validHunks`), the ask's declared cut (`ASK_MIDDLE`), and `entropy` (the slicer's
//     delegation check reads it to tell an encrypted brief, never to mask).
//
// Deterministic: no clock, no model, no network, no random source. Zero dependencies. No Sonah writes a mark now
// (`‹redacted…›`, `‹dropped…›`, a dropped-lines note), so this module declares nothing from a text's characters: the
// same characters in a recording are its own text (a person pasted an earlier page, an agent printed one), kept and
// never declared redacted. A declaration a ledger already carries (`redacted`, `redactedLines`, `redactedTokens`) is
// kept as it is; the evidence adapter reads a field's marks as an earlier redactor's only where the field declares it.

import { createHash } from 'node:crypto';

/** The marker a persisted ledger's statement or helper report carries where an earlier Sonah bounded it (D68 E retired
 *  the bounds): recognised by the evidence adapter, which re-declares them; never produced. */
export const STATEMENT_OMISSION = '[… statement middle omitted before review …]';
export const FINAL_ANSWER_OMISSION = '[… report middle omitted before review …]';

/**
 * `text` bounded by `cap` at line boundaries around `marker`: `{ text, truncated, middle, removed }` — `middle` is what a
 * cut made now removed (the partial lines at its edges included; '' when nothing was cut now) and `removed` its code
 * points, not counting the line breaks the head and tail keep around the marker.
 *
 * `words` (M33 R repair, an ask's bound only): a side whose window holds no line break — one long line — is not left
 * empty: it is cut at the last word boundary its window holds instead (the head) or the first (the tail), never inside
 * one of an earlier Sonah's marks.
 */
function cutAtLines(text, cap, marker, { words = false } = {}) {
  const whole = String(text);
  const none = { text: whole, truncated: false, middle: '', removed: 0 };
  if (whole.length <= cap.chars) return none;   // UTF-16 units >= code points
  const points = [...whole];
  if (points.length <= cap.chars) return none;
  if (points.length <= cap.head + cap.tail + [...marker].length + 2 && whole.split('\n').includes(marker))
    return { ...none, truncated: true };
  let head = points.slice(0, cap.head).join('');
  let headBreak = true;     // the head ends where a line ends: the text's own line break stands before the marker
  if (points[cap.head] !== '\n') {
    const at = head.lastIndexOf('\n');
    if (at >= 0 || !words) head = head.slice(0, Math.max(0, at));
    else { head = whole.slice(0, wordEnd(whole, head.length)); headBreak = false; }
  }
  let tail = points.slice(-cap.tail).join('');
  let tailBreak = true;
  if (points[points.length - cap.tail - 1] !== '\n') {
    const at = tail.indexOf('\n');
    if (at >= 0) tail = tail.slice(at + 1);
    else if (!words) tail = '';
    else { tail = whole.slice(wordStart(whole, whole.length - tail.length)); tailBreak = false; }
  }
  const middle = whole.slice(head.length, whole.length - tail.length);
  return { text: [...(head ? [head] : []), marker, ...(tail ? [tail] : [])].join('\n'), truncated: true, middle,
    removed: [...middle].length - (head && headBreak ? 1 : 0) - (tail && tailBreak ? 1 : 0) };
}
/** Where a head of `text` cut at most `at` UTF-16 units in ends: at the last whitespace before `at` (the word it would
 *  split goes), else at `at`; never inside a surrogate pair or one of an earlier Sonah's marks (`safeCut`). */
function wordEnd(text, at) {
  if (at >= text.length || /\s/.test(text[at])) return safeCut(text, at);
  for (let k = at - 1; k > 0; k--) if (/\s/.test(text[k])) return safeCut(text, k);
  return safeCut(text, at);
}
/** Where a tail of `text` that starts at most at `at` begins: after the first whitespace from `at` (the word it would
 *  split goes), else at `at`; never inside a surrogate pair or one of an earlier Sonah's marks. */
function wordStart(text, at) {
  if (at <= 0 || /\s/.test(text[at - 1])) return at;
  for (let k = at; k < text.length; k++) if (/\s/.test(text[k])) return k + 1;
  let start = at;
  if (lowSurrogate(text.charCodeAt(start)) && highSurrogate(text.charCodeAt(start - 1))) start++;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  for (const m of text.slice(lineStart, text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start)).matchAll(REDACTOR_TOKEN)) {
    const from = lineStart + m.index;
    if (from < start && start < from + m[0].length) return from + m[0].length;
  }
  return start;
}

/**
 * Windowing (owner-confirmed spec 2026-10-06; C-02 "M35 the human message in
 * full"): a human message is kept IN FULL and bounded nowhere. Only an attached file (below) keeps a declared middle
 * cut. A persisted ledger whose ask an earlier Sonah already cut (`ASK_OMISSION` on a line of its own, or the older
 * slicer's stub) keeps that cut and its declaration; one an earlier slicer only declared due (its text whole) has the
 * declaration withdrawn and is kept whole (`settledAsk`).
 *
 * M34 labels (C-02 "Slice-time labels"; owner decision 2026-10-06): a file or directory the human attached (an
 * @-mention, an `interjections` entry of kind `attached`) is part of the human's message, bounded like an observation:
 * 2k tokens (at the windowing spec's 3.6 bytes per token, 7,200 code points), its head and tail kept by position only —
 * the declared middle cut (`ASK_MIDDLE`).
 */
export const ATTACHED_CAP = Object.freeze({ chars: 7_200, head: 3_600, tail: 3_600 });
/** The interjection kind whose bound is `ATTACHED_CAP` (slicer events.js `INTERJECTION_KINDS.attached`). */
const ATTACHED_KIND = 'attached';
export const ASK_OMISSION = '[… instruction middle omitted before review …]';
export const ASK_MIDDLE = 'middle of turn';
/** The older slicer's own mid-line stub of an ask it cut: a text carrying it was already bounded. */
const OLDER_ASK_ELISION = /\n\n\[… \d+ chars elided …\]\n\n/;

/**
 * M6 (C-02 "M6 the human turn whole"). Sonah strips nothing from a human turn by its
 * shape. `ASK_STRIP_KINDS` is the closed set of strips an earlier Sonah made: kept only to read a persisted ledger whose
 * ask still carries one (its stub stands in the text: the declaration stays, `stripMade`) or declares one an earlier
 * slicer left due (its text whole: the declaration is withdrawn, nothing is stripped).
 */
export const ASK_STRIP_KINDS = Object.freeze(['attachment', 'code block', 'traceback', 'indented block']);

/** Is the strip `entry` declares one an earlier pass already made — its own stub stands in `text`? */
const stripMade = (entry, text) => ASK_STRIP_KINDS.includes(entry?.what) && Number.isSafeInteger(entry.chars)
  && text.includes(`[${entry.what}, `) && new RegExp(`\\[${entry.what}, \\d+ lines, ${entry.chars} chars\\]`).test(text);

/**
 * M33 R repair 3. A numbered text — a Claude Code Read result, `cat -n` or `nl` output — holds each line of the file
 * behind its number: `     12\t`. This is the slicer's rule for a Read, in one place (slicer/src/before.js
 * `stripLineNumbers` reads it from here): a line's number is `READ_LINE_NUMBER`, and a text is numbered when at least
 * 80% of its non-empty lines carry one, its `<system-reminder>` blocks set aside (they are not lines of the file).
 */
export const READ_LINE_NUMBER = /^\s*\d+\t/;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/** `text`, its `<system-reminder>` blocks set aside and its trailing whitespace trimmed: what the 80% rule counts. */
export const readText = (text) => String(text).replace(SYSTEM_REMINDER, '').trimEnd();
/** Is `text` numbered: at least 80% of the non-empty lines of `readText(text)` behind a `READ_LINE_NUMBER`? */
export function isNumberedRead(text) {
  const nonEmpty = readText(text).split('\n').filter((line) => line.trim().length);
  return nonEmpty.length > 0 && nonEmpty.filter((line) => READ_LINE_NUMBER.test(line)).length / nonEmpty.length >= 0.8;
}

/** One of Sonah's own lines (a dropped-lines note, a stub, a marker): kept whole or not at all. */
const SONAH_LINE = /^\[… .* …\]$/;
/** A mark an earlier Sonah's redactor left in a text: a cut never splits one. */
const REDACTOR_TOKEN = /‹(?:redacted|dropped)(?::[^›\n]+)?›/g;
const highSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const lowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Where to cut `text` at most `at` UTF-16 units in: `at`, or earlier so the cut never splits a surrogate pair, one of an
 * earlier Sonah's marks, or one of Sonah's own lines (a note or stub inside the cut is dropped with its line break).
 */
function safeCut(text, at) {
  if (at >= text.length) return text.length;
  let cut = Math.max(0, at);
  if (cut > 0 && highSurrogate(text.charCodeAt(cut - 1)) && lowSurrogate(text.charCodeAt(cut))) cut--;
  const lineStart = text.lastIndexOf('\n', cut - 1) + 1;
  let lineEnd = text.indexOf('\n', cut);
  if (lineEnd < 0) lineEnd = text.length;
  if (cut > lineStart && text.startsWith('[… ', lineStart) && SONAH_LINE.test(text.slice(lineStart, lineEnd)))
    return Math.max(0, lineStart - 1);
  if (text.lastIndexOf('‹', cut - 1) >= lineStart) {
    for (const m of text.slice(lineStart, lineEnd).matchAll(REDACTOR_TOKEN)) {
      const start = lineStart + m.index;
      if (start < cut && cut < start + m[0].length) { cut = start; break; }
    }
  }
  return cut;
}

/**
 * The file names `text` names (slicer/src/ask.js harvests these from what it elided; this module from what the
 * attached file's bound cut): each whitespace- or punctuation-delimited word of 3 to 200 characters that ends in a
 * dotted extension, or is a known extensionless build-file name, lowercased, into `mentions` (a Set), at most 1,000 of
 * them. Linear: a split, then a bounded anchored test per word.
 */
export function harvestMentions(text, mentions) {
  for (const tok of String(text ?? '').split(/[\s"'`()[\]{},;:|<>*]+/)) {
    if (mentions.size >= 1000) break;
    if (tok.length < 3 || tok.length > 200) continue;
    // Known extensionless build-file names are ecosystem grammar (class A).
    if (/^(Makefile|Dockerfile|Rakefile|Justfile|Gemfile|Procfile|BUILD|WORKSPACE)$/.test(tok)) {
      mentions.add(tok.toLowerCase());
      continue;
    }
    const mm = /([\w-]{1,80}\.[a-z]{1,6})$/i.exec(tok);
    if (mm) mentions.add(mm[1].toLowerCase());
  }
  return mentions;
}

/** An attached file the slicer declared over budget, bounded: `cutAtLines`'s result, `already` when an earlier bound (or
 *  the older slicer's cut, `OLDER_ASK_ELISION`) already shortened it. */
function boundAsk(text, cap = ATTACHED_CAP) {
  const points = [...text].length;
  if (points <= cap.head + cap.tail + 64 && OLDER_ASK_ELISION.test(text))
    return { text, truncated: true, middle: '', removed: 0, already: true };
  const bound = cutAtLines(text, cap, ASK_OMISSION, { words: true });
  if (bound.truncated && bound.middle === '') return { ...bound, already: true };
  if (!bound.truncated && text.split('\n').includes(ASK_OMISSION)) return { ...bound, truncated: true, already: true };
  return { ...bound, already: false };
}

/** Windowing (C-02 "M35 the human message in full"): a human message an earlier slicer declared over the retired ask
 *  budget. Never cut now: one an earlier pass already cut (its `ASK_OMISSION` line, or the older slicer's stub) is kept
 *  as it is and keeps its declaration (`already`); any other is whole, and its declaration is withdrawn. */
function settledAsk(text) {
  const cut = text.split('\n').includes(ASK_OMISSION) || OLDER_ASK_ELISION.test(text);
  return cut ? { text, truncated: true, middle: '', removed: 0, already: true } : { text, truncated: false, middle: '', removed: 0 };
}

/**
 * The ledger the review reads: bounded and validated, nothing masked, nothing withheld for what it says (D90). It is
 * what `redact(…, { mask: false })` returned before D90, byte for byte; `dropped` is the ledger's own list, carried.
 * @param {Ledger} ledger
 * @returns {{ledger: Ledger, dropped: Array}}
 */
export function redact(ledger) {
  return redactCore(ledger);
}

// ---------------------------------------------------------------------------------------------
// D68 (owner decision 2026-10-07; C-02 "M36 recorded facts"). The recorder's TYPED facts about a call, carried on its
// ledger event as `recorded`, in one closed vocabulary: numbers, booleans and fixed members, and recorder strings.
// Nothing in it is derived from what an output or a thought says. The slicer writes it (slicer/src/recorded.js); this
// module rebuilds it from the vocabulary before slice_hash; the adapter re-declares it (evidence/adapters/sonah-ledger.js
// RECORDED_FACTS) and never imports it.
// ---------------------------------------------------------------------------------------------
export const RECORDED_FACTS = Object.freeze({
  // Every key an event's `recorded` may hold; any other is dropped (fails closed) and `withheld` set.
  keys: Object.freeze(['tool', 'commandClass', 'parsedCmd', 'hunks', 'hunkScrub', 'hunksWithheld', 'writeType', 'prior',
    'patch', 'isError', 'denial', 'interrupted', 'noOutputExpected', 'backgroundTaskId', 'editDiff', 'read', 'search',
    'fetch', 'webSearch', 'unrecordedChange', 'withheld']),
  // M36 phase 3 review (D68 F): Claude Code's typed denial of a call (its result row's `toolDenialKind`), the recorder's
  // own closed vocabulary (slicer events.js `CLAUDE_USER_REFUSAL`): the call was refused, blocked or cancelled, so it
  // never ran — never the agent's failure.
  denial: Object.freeze(['user-rejected', 'permission-rule', 'automode-blocked', 'automode-unavailable',
    'automode-parsing-error', 'interrupted', 'cancelled']),
  // (c5) Codex: a command is `read` only when every entry of the recorder's parsed command is a read.
  commandClass: Object.freeze(['read', 'command']),
  parsedCmdTypes: Object.freeze(['read', 'search', 'list_files', 'unknown']),
  // (c2) what an earlier Sonah scrubbed a change's hunks with: the whole recorded file, or the change alone. Recognised in
  // a ledger it wrote; D90: never produced.
  hunkScrub: Object.freeze(['file', 'change']),
  // D68 (R), D69 (b): why an earlier slicer did not carry a change's recorded hunks: the file was credential-shaped, in a
  // harness home folder of the recording's user, or (M36) any `.claude` directory. Recognised in a ledger it wrote; D90:
  // never produced.
  hunksWithheld: Object.freeze(['credential_path', 'harness_home', 'harness_files']),
  // The recorder's typed kind of a whole-file write: Claude Code's Write `create` (the file was not there: the recorder
  // checked) or `update`; a Codex `add` (an apply_patch `*** Add File`, a FileChange `add`: written whether or not the
  // file was there, so its prior state is `unrecorded`).
  writeType: Object.freeze(['create', 'update', 'add']),
  // (c1) the file before a write, as the record holds it: whole (`file`), only as the recorder's hunks (`hunks`), the
  // recorder says there was none (`absent`: a create, an add), or not recorded at all (`unrecorded`: a shell write…).
  prior: Object.freeze(['file', 'hunks', 'absent', 'unrecorded']),
  // What the record holds of the change itself: line-numbered hunks, the call's own old/new strings, a whole written
  // body, or nothing (a shell write the slicer inferred from its command).
  patch: Object.freeze(['hunks', 'strings', 'body', 'none']),
  searchModes: Object.freeze(['content', 'files_with_matches', 'count']),
  read: Object.freeze(['startLine', 'numLines', 'totalLines']),
  search: Object.freeze(['mode', 'numFiles', 'numLines', 'numMatches', 'totalMatches', 'truncated']),
  fetch: Object.freeze(['url', 'code', 'bytes']),
  webSearch: Object.freeze(['query', 'results']),
  editDiff: Object.freeze(['files', 'changedFiles', 'moreFiles', 'shared', 'unavailable']),
  editDiffFile: Object.freeze(['path', 'created', 'deleted', 'hunks', 'hunkScrub', 'hunksWithheld']),
  // A hand-off's (Claude Code Agent) typed result: on its delegation receipt.
  agent: Object.freeze(['tool', 'status', 'totalToolUseCount', 'withheld']),
});
/** A recorder string carried as a fact — a tool name, a path, a URL, a query, a parsed command's name, a background task
 *  id, an Agent hand-off's typed status: any non-empty string. A non-string, or an empty one, is not carried and the
 *  facts say so (`withheld`). */
const recorderString = (value) => typeof value === 'string' && value.length > 0;
const HUNK_MARKERS = new Set([' ', '-', '+']);
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
/** One recorded hunk, as the recorder wrote it: `{oldStart, oldLines, newStart, newLines, lines}`, every line one
 *  physical line with its marker (or a `\` no-newline line, or the empty line some writers leave for an empty context
 *  line). Anything else is not a hunk this module reads. */
const hunkShape = (h) => plainObject(h) && Object.keys(h).length === 5
  && ['oldStart', 'oldLines', 'newStart', 'newLines'].every((key) => isCount(h[key]))
  && Array.isArray(h.lines)
  && h.lines.every((line) => typeof line === 'string' && !line.includes('\n')
    && (line === '' || HUNK_MARKERS.has(line[0]) || line[0] === '\\'));

/**
 * D68 (c2) (owner decision 2026-10-07; C-02 "M36 recorded facts"). A change's RECORDED hunks — Claude Code's
 * `structuredPatch`, a Codex FileChange `unified_diff`, a Claude Code `bashEditDiff` file — as the recorder wrote them,
 * copied, when every one has the recorder's shape (`hunkShape`); null for anything else (the caller keeps no hunk, and
 * the facts say the record held hunks Sonah did not carry). Line numbers and lines are the recorder's.
 */
export function validHunks(hunks) {
  if (!Array.isArray(hunks) || !hunks.length || !hunks.every(hunkShape)) return null;
  return hunks.map((h) => ({ oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines,
    lines: [...h.lines] }));
}

/** The identities a recording names its hand-offs and recordings by. */
const DELEGATION_IDENTITY_FIELDS = Object.freeze(['callId', 'childId', 'taskName', 'target', 'sessionId']);
const WORKFLOW_IDENTITY_FIELDS = Object.freeze(['runId', 'workflowName']);
const SOURCE_IDENTITY_FIELDS = Object.freeze(['sessionId', 'childId', 'parentThreadId', 'taskPath']);

function redactCore(ledger) {
  const dropped = [...(ledger.dropped ?? [])];
  const out = structuredClone(ledger);

  /**
   * D68 (C-02 "M36 recorded facts"). An event's `recorded` facts, REBUILT from their closed vocabulary
   * (`RECORDED_FACTS`): a member outside it, a value of the wrong type or a number out of range is dropped and the facts
   * say `withheld`; recorded hunks are kept only when they have the recorder's shape (`validHunks`). Fails closed:
   * nothing passes it but its vocabulary. `facts` null when there is nothing to rebuild.
   */
  const recordedFacts = (value) => {
    if (!plainObject(value)) return null;
    const facts = {};
    let withheld = value.withheld === true;
    const text = (v) => {
      if (!recorderString(v)) { if (v !== undefined) withheld = true; return undefined; }
      return v;
    };
    const member = (v, list) => (list.includes(v) ? v : (withheld = withheld || v !== undefined, undefined));
    const flag = (v) => (typeof v === 'boolean' ? v : (withheld = withheld || v !== undefined, undefined));
    const num = (v) => (isCount(v) ? v : (withheld = withheld || v !== undefined, undefined));
    const put = (target, key, v) => { if (v !== undefined) target[key] = v; };
    const pick = (v, keys, read) => {
      if (!plainObject(v)) { withheld = true; return undefined; }
      const o = {};
      for (const key of Object.keys(v)) if (!keys.includes(key)) withheld = true;
      for (const key of keys) if (Object.hasOwn(v, key)) put(o, key, read(key, v[key]));
      return Object.keys(o).length ? o : undefined;
    };
    const hunksOf = (v) => {
      const hunks = validHunks(v);
      if (!hunks) { withheld = true; return undefined; }
      return hunks;
    };
    const ref = (v) => (plainObject(v) && Object.keys(v).length === 2 && isCount(v.turn) && isCount(v.seq)
      ? { turn: v.turn, seq: v.seq } : (withheld = true, undefined));
    for (const key of Object.keys(value)) if (!RECORDED_FACTS.keys.includes(key)) withheld = true;
    put(facts, 'tool', text(value.tool));
    put(facts, 'commandClass', member(value.commandClass, RECORDED_FACTS.commandClass));
    if (Object.hasOwn(value, 'parsedCmd')) {
      if (!Array.isArray(value.parsedCmd)) withheld = true;
      else facts.parsedCmd = value.parsedCmd.map((entry) => {
        if (!plainObject(entry) || !RECORDED_FACTS.parsedCmdTypes.includes(entry.type)) { withheld = true; return { type: 'unknown' }; }
        const keys = { read: ['name', 'path'], search: ['query', 'path'], list_files: ['path'], unknown: [] }[entry.type];
        const kept = { type: entry.type };
        for (const key of Object.keys(entry)) if (key !== 'type' && !keys.includes(key)) withheld = true;
        for (const key of keys) {
          if (!Object.hasOwn(entry, key)) continue;
          if (entry[key] === null) { kept[key] = null; continue; }
          const v = text(entry[key]);
          kept[key] = v === undefined ? null : v;
        }
        return kept;
      });
    }
    // D68 (R): hunks an earlier slicer withheld whole (`hunksWithheld`) carry no line: a `hunks` beside the reason is
    // never read.
    const hunksWithheld = member(value.hunksWithheld, RECORDED_FACTS.hunksWithheld);
    if (!hunksWithheld && Object.hasOwn(value, 'hunks')) put(facts, 'hunks', hunksOf(value.hunks));
    if (facts.hunks) put(facts, 'hunkScrub', member(value.hunkScrub, RECORDED_FACTS.hunkScrub));
    put(facts, 'hunksWithheld', hunksWithheld);
    put(facts, 'writeType', member(value.writeType, RECORDED_FACTS.writeType));
    put(facts, 'prior', member(value.prior, RECORDED_FACTS.prior));
    put(facts, 'patch', member(value.patch, RECORDED_FACTS.patch));
    for (const key of ['isError', 'interrupted', 'noOutputExpected']) put(facts, key, flag(value[key]));
    put(facts, 'denial', member(value.denial, RECORDED_FACTS.denial));
    if (Object.hasOwn(value, 'backgroundTaskId')) put(facts, 'backgroundTaskId', text(value.backgroundTaskId));
    if (Object.hasOwn(value, 'editDiff')) put(facts, 'editDiff', pick(value.editDiff, RECORDED_FACTS.editDiff, (key, v) => {
      // D68 (R): a file whose hunks an earlier slicer withheld whole (`hunksWithheld`, a closed reason) has no hunk read.
      if (key === 'files') return Array.isArray(v) ? v.map((file) => pick(file, RECORDED_FACTS.editDiffFile,
        (k, x) => (k === 'path' ? text(x)
          : k === 'hunks' ? (RECORDED_FACTS.hunksWithheld.includes(file.hunksWithheld) ? undefined : hunksOf(x))
            : k === 'hunkScrub' ? (RECORDED_FACTS.hunksWithheld.includes(file.hunksWithheld) ? undefined
              : member(x, RECORDED_FACTS.hunkScrub))
              : k === 'hunksWithheld' ? member(x, RECORDED_FACTS.hunksWithheld) : flag(x)))).filter(Boolean)
        : (withheld = true, undefined);
      if (key === 'changedFiles') return Array.isArray(v)
        ? v.map((path) => text(path)).filter((path) => path !== undefined) : (withheld = true, undefined);
      return key === 'moreFiles' ? num(v) : flag(v);
    }));
    if (Object.hasOwn(value, 'read')) put(facts, 'read', pick(value.read, RECORDED_FACTS.read, (key, v) => num(v)));
    if (Object.hasOwn(value, 'search')) put(facts, 'search', pick(value.search, RECORDED_FACTS.search,
      (key, v) => (key === 'mode' ? member(v, RECORDED_FACTS.searchModes) : key === 'truncated' ? flag(v) : num(v))));
    if (Object.hasOwn(value, 'fetch')) put(facts, 'fetch', pick(value.fetch, RECORDED_FACTS.fetch,
      (key, v) => (key === 'url' ? text(v) : num(v))));
    if (Object.hasOwn(value, 'webSearch')) put(facts, 'webSearch', pick(value.webSearch, RECORDED_FACTS.webSearch,
      (key, v) => (key === 'query' ? text(v) : num(v))));
    if (Object.hasOwn(value, 'unrecordedChange')) {
      const u = value.unrecordedChange;
      if (!plainObject(u) || Object.keys(u).some((key) => key !== 'since' && key !== 'commands')
        || !Array.isArray(u.commands)) withheld = true;
      else {
        const since = ref(u.since);
        const commands = u.commands.map(ref).filter(Boolean);
        if (since) facts.unrecordedChange = { since, commands };
      }
    }
    if (withheld) facts.withheld = true;
    return Object.keys(facts).length ? facts : null;
  };

  // OWNER DECISION B (2026-10-01): a human instruction recorded within a turn (`interjections`: a queued prompt, an
  // AskUserQuestion answer) is the human's words exactly as an ask is, and is read by exactly the ask's rules.
  for (const a of [...out.ask, ...(Array.isArray(out.interjections) ? out.interjections : [])]) {
    // M33 R: an attached file the slicer declared over its budget (`{ what: 'middle of turn' }`) is kept WHOLE by it and
    // bounded only here (`boundAsk`). Windowing (C-02 "M35 the human message in full"): a human message is never bounded
    // (`settledAsk`). M6: no ask is stripped by its shape; a persisted ledger whose ask
    // declares such a strip is settled: a strip an earlier pass made (its stub stands in the text) is kept as it is; one
    // an earlier slicer only left due (the text whole, unfolded) is withdrawn, and the text is folded and trimmed as that
    // slicer's strip pass would have, so a second pass changes nothing.
    const stripsDue = Array.isArray(a.elided) && a.elided.some((entry) => ASK_STRIP_KINDS.includes(entry?.what));
    let bound = null;
    if (typeof a.text === 'string') {
      let text = a.text;
      if (stripsDue) {
        a.elided = a.elided.filter((entry) => !ASK_STRIP_KINDS.includes(entry?.what) || stripMade(entry, text));
        text = text.replace(/\n{3,}/g, '\n\n').trim();
        if (!a.elided.length) delete a.elided;
      }
      const due = Array.isArray(a.elided) && a.elided.some((entry) => entry?.what === ASK_MIDDLE);
      // Windowing (C-02 "M35 the human message in full"): only an attached file is bounded; a human message never is.
      bound = !due ? null : a.kind === ATTACHED_KIND ? boundAsk(text, ATTACHED_CAP) : settledAsk(text);
      a.text = bound ? bound.text : text;
    }
    const pending = Array.isArray(a.elided) ? a.elided.findIndex((entry) => entry?.what === ASK_MIDDLE) : -1;
    // The declaration, settled: the code points this bound cut (and the names in what it cut, still named by the ask),
    // kept as it was for an ask an earlier bound already cut, and withdrawn when nothing was cut.
    if (pending >= 0) {
      if (bound?.truncated && !bound.already) {
        a.elided[pending] = { ...a.elided[pending], chars: bound.removed };
        const names = harvestMentions(bound.middle, new Set(Array.isArray(a.mentions) ? a.mentions : []));
        if (names.size) a.mentions = [...names];
      } else if (!bound?.truncated) {
        a.elided.splice(pending, 1);
        if (!a.elided.length) delete a.elided;
      }
    }
  }

  for (const e of out.ledger) {
    // Workflow and TaskOutput expose opaque task IDs in two different native records. They may establish a completion
    // link only AFTER this pass, and only when every present ID has an identifier's shape.
    const taskIdFields = ['workflowTaskId', 'taskOutputTaskId', 'taskOutputResultTaskId'];
    const presentTaskIds = taskIdFields.filter((field) => Object.hasOwn(e, field));
    delete e.taskIdentityChecked;
    if (presentTaskIds.length || e.taskIdentityRedacted === true) {
      for (const field of presentTaskIds) {
        const value = e[field];
        if (typeof value !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./:-]{0,199}$/.test(value)) {
          delete e[field];
          e.taskIdentityRedacted = true;
        }
      }
      e.taskIdentityChecked = true;
    }
    // D69 (c): a ledger an earlier slicer wrote may carry a `firstErrorLine` (deleted with its patterns); no reader reads
    // it, so it is dropped here, never shown, and the ledger stays readable.
    delete e.firstErrorLine;
    if (Object.hasOwn(e, 'recorded')) {
      const facts = recordedFacts(e.recorded);
      if (facts === null) delete e.recorded; else e.recorded = facts;
      if (facts?.withheld === true) e.redacted = true;
    }
    // Native result blocks are independent quote sources: kept only while they hold what `tailLines` holds.
    if (Array.isArray(e.tailLines)) {
      const originalSpans = Array.isArray(e.outputSpans) ? e.outputSpans.join('\n') : null;
      e.tailLines = [...e.tailLines];
      if (originalSpans !== null && e.tailLines.join('\n') !== originalSpans) {
        delete e.outputSpans;
        e.observationRedacted = true;
      }
    }
  }

  // M33 F repair 3, D68 (E): the slicer keeps the WHOLE statement, and it is kept whole (what the agent produced is
  // never bounded).
  if (out.commentaryCapture && Array.isArray(out.commentary)) {
    out.commentaryCapture.bytes = out.commentary.reduce((n,s) => n + Buffer.byteLength(s.text), 0);
  }
  // D71 (g), owner decision 2026-10-08: each project instruction file the harness gave the agent (the slicer's
  // `projectInstructions`), kept whole. Fails closed: an entry whose text is not a string keeps none.
  for (const entry of Array.isArray(out.projectInstructions) ? out.projectInstructions : []) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.text !== 'string') { entry.text = ''; entry.redacted = true; continue; }
  }
  // D150: each file the harness noticed changed outside the agent's edit calls (the slicer's `editedFiles`), its
  // recorded snippet kept whole, as a project instruction file is. Fails closed: a snippet or a path that is not a string
  // keeps none. Not in slice_hash until a reader of a review reads it (`sliceHash`).
  for (const entry of Array.isArray(out.editedFiles) ? out.editedFiles : []) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.path !== 'string') { entry.path = ''; entry.redacted = true; }
    if (typeof entry.text !== 'string') { entry.text = ''; entry.redacted = true; }
  }

  // Source identities: a field a ledger already declared unchecked (`identityUncheckedFields`, a closed list of its
  // own field names) stays unchecked, and an invalid declaration leaves the whole row unchecked. A surviving field is
  // merely eligible for later independent verification, never proof by its shape alone.
  const identityFields = (row, names) => {
    const prior = row.identityUncheckedFields;
    const valid = prior === undefined || Array.isArray(prior)
      && prior.every((name) => names.includes(name)) && new Set(prior).size === prior.length;
    const lost = new Set(valid && Array.isArray(prior) ? prior : []);
    if (lost.size) row.identityUncheckedFields = [...lost].sort();
    else delete row.identityUncheckedFields;
    return { lost, invalid: !valid };
  };
  const available = (row, lost, field) => !lost.has(field)
    && typeof row[field] === 'string' && row[field].length > 0;
  for (const d of out.delegations ?? []) {
    // C-03 M33 D: a Claude hand-off's recorded sessionId is an identity too. M33 W: a Workflow agent's hand-off also
    // records its run id and the workflow's name; both are identities too.
    const { lost, invalid } = identityFields(d, [...DELEGATION_IDENTITY_FIELDS,
      ...(d.kind === 'workflow-agent' ? WORKFLOW_IDENTITY_FIELDS : [])]);
    // Claude's Agent/Task receipt and a Codex spawn with only childId have no `kind` property. The resolver treats every
    // non-followup delegation with a surviving child identity as eligible for independent proof, so the coarse flag
    // must do the same.
    const possible = d.adapter === 'codex' && d.kind === 'followup'
      ? available(d, lost, 'target')
      : d.adapter === 'codex' && d.kind !== 'followup'
        ? available(d, lost, 'childId') || available(d, lost, 'taskName')
        : d.adapter === 'claude' && d.kind !== 'followup'
          ? available(d, lost, 'childId') : false;
    if (invalid || lost.size && !possible) d.identityUnchecked = true;
    // D68 (C-02 "M36 recorded facts"): a Claude Code Agent hand-off's typed result (its status and tool-use count),
    // rebuilt from its closed vocabulary; a status that is not a recorder string is withheld.
    if (Object.hasOwn(d, 'recorded')) {
      const r = d.recorded;
      const kept = {};
      let held = !plainObject(r) || Object.keys(r).some((key) => !RECORDED_FACTS.agent.includes(key)) || r.withheld === true;
      if (plainObject(r)) {
        if (recorderString(r.tool)) kept.tool = r.tool;
        else if (r.tool !== undefined) held = true;
        if (recorderString(r.status)) kept.status = r.status;
        else if (r.status !== undefined) held = true;
        if (isCount(r.totalToolUseCount)) kept.totalToolUseCount = r.totalToolUseCount;
        else if (r.totalToolUseCount !== undefined) held = true;
      }
      if (held) kept.withheld = true;
      if (Object.keys(kept).length) d.recorded = kept; else delete d.recorded;
    }
    // M33 F: a helper's final report is what the parent RECEIVED, kept whole (D68 E). It is REBUILT from its allow-list
    // — its text; the row (>= 1) and human turn (>= 0) it was received on, numbers the slicer wrote that place it;
    // `truncated` and `redacted`, only ever true — so no other field of it passes. Fails closed: a report that is not
    // text keeps nothing but the fact that it was withheld, and where it was received.
    if (d.finalAnswer != null) {
      const report = d.finalAnswer;
      const shaped = report !== null && typeof report === 'object' && !Array.isArray(report);
      const placed = (key, least) => (shaped && Number.isSafeInteger(report[key]) && report[key] >= least
        ? { [key]: report[key] } : {});
      const where = { ...placed('record', 1), ...placed('turn', 0) };
      if (!shaped || typeof report.text !== 'string') {
        d.finalAnswer = { text: '', ...where, redacted: true };
      } else {
        d.finalAnswer = { text: report.text, ...where,
          ...(report.truncated === true ? { truncated: true } : {}),
          ...(report.redacted === true ? { redacted: true } : {}) };
      }
    }
  }

  for (const source of out.sources ?? []) {
    const { lost, invalid } = identityFields(source, SOURCE_IDENTITY_FIELDS);
    const possible = source.adapter === 'codex' && source.nested === true
      ? available(source, lost, 'sessionId')
        || available(source, lost, 'parentThreadId') && available(source, lost, 'taskPath')
      : source.adapter === 'codex' || source.adapter === 'claude' && source.nested !== true
        ? available(source, lost, 'sessionId')
        : source.adapter === 'claude' && source.nested === true
          ? available(source, lost, 'childId') && available(source, lost, 'sessionId') : false;
    if (invalid || lost.size && !possible) source.identityUnchecked = true;
  }
  // A recording's file names are no evidence of the session itself: keep only their order and count. No raw filename
  // participates in a ledger identity or hash.
  if (out.lineage && Array.isArray(out.lineage.files))
    out.lineage.files = out.lineage.files.map((_file, index) => `recording-${index + 1}`);
  for (const child of out.children ?? []) child.ledger = redactCore(child.ledger).ledger;

  out.dropped = dropped;
  return { ledger: out, dropped };
}

/** Shannon entropy in bits per character. The slicer's delegation check reads it (with `ENTROPY_MIN`) to tell an
 *  encrypted brief from words; nothing is masked by it. */
export function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
/** The bits per character from which a token of 24 or more characters reads as random (slicer/src/delegation.js). */
export const ENTROPY_MIN = 4.6;

/** Content hash over the ledger's bytes as `redact` returned them, with keys sorted so it is stable across runs: the
 *  bounded ledger a session review reads (and `sonah slice` prints), so one recording has one hash. A SHA3-256 digest
 *  names the session and shows none of its text. */
export function sliceHash(ledger) {
  const receipt = d => ({ adapter: d.adapter, callId: d.callId, turn: d.turn,
    ...(d.source !== undefined ? { source: d.source } : {}), ...(d.record !== undefined ? { record: d.record } : {}),
    ...(d.kind ? { kind: d.kind } : {}), ...(d.parentInstruction ? { parentInstruction: d.parentInstruction } : {}),
    // M33 F: an attached final report is evidence of the hand-off; a ledger without one hashes exactly as before.
    ...(d.finalAnswer ? { finalAnswer: d.finalAnswer } : {}),
    // D68 (C-02 "M36 recorded facts"): the hand-off's typed result facts; a ledger without them hashes as before.
    ...(d.recorded ? { recorded: d.recorded } : {}) });
  const content = unit => ({ ask: unit.ask, ledger: unit.ledger, claim: unit.claim,
    // OWNER DECISION B (2026-10-01): the human's words recorded within a turn are session content; absent, the hash is
    // as before.
    ...(unit.interjections?.length ? { interjections: unit.interjections } : {}),
    // D71 (g): the project's instruction files the harness gave the agent are session content; absent, the hash is as before.
    ...(unit.projectInstructions?.length ? { projectInstructions: unit.projectInstructions } : {}),
    ...(unit.delegations?.length ? { delegationReceipts: unit.delegations.map(receipt) } : {}),
    // M33 W: a Workflow call's run record (what was linked, and each declared loss); absent, the hash is as before.
    ...(unit.workflowRuns?.length ? { workflowRuns: unit.workflowRuns } : {}),
    // M33 P: where each linked helper's work was delivered and received, and each send that split nothing; absent, the
    // hash is as before.
    ...(unit.helperSegments?.length ? { helperSegments: unit.helperSegments } : {}),
    ...(unit.helperDeliveryLosses?.length ? { helperDeliveryLosses: unit.helperDeliveryLosses } : {}),
    ...(Array.isArray(unit.commentary) ? { commentary: unit.commentary, commentaryCapture: unit.commentaryCapture } : {}),
    ...(unit.instructionAuthority === 'unchecked' ? { instructionAuthority: 'unchecked', instructions: unit.instructions,
      sources: unit.sources, capture: unit.capture, dropped: unit.dropped } : {}),
    ...(unit.children?.length ? { delegations: unit.delegations, children: unit.children.map(child => ({ source: child.source,
      content: content(child.ledger), instructions: child.ledger.instructions,
      capture: child.ledger.capture, delegations: child.ledger.delegations })) } : {}) });
  const canonical = JSON.stringify(content(ledger), sortedReplacer);
  return createHash('sha3-256').update(canonical).digest('hex');
}

function sortedReplacer(_k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Code-unit order, never localeCompare: the hash must be the same bytes on every machine
    // (audit M86 — Czech collation reordered keys and changed the digest).
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return v;
}
