// The code step's context, assembled by code (`sonah.code-pass/2`; agentic since `sonah.code-pass/7`, D90): the change
// as a table of contents and `| OLD | NEW | TYPE | code` rows — the review agent's starting map, bounded, the agent
// reading any file of the repository itself — and the session dossier built from the saved report. Zero calls.
//
// Pure and deterministic: no disk, network, clock or random source. The CLI (cli/src/code-snapshot.js) reads git and the
// files and hands this module their bytes; code-pass.js freezes them. Nothing here reads a word of a file, a row or an
// answer to decide anything: code checks structure (paths, line numbers, which side, whether a line is literally there);
// meaning is the model's, under grounding and challenge.
//
// Portions adapted from Pullfrog (pullfrog/pullfrog), MIT, Copyright (c) 2026 Pullfrog, Inc.: the table of contents
// with line ranges and the `| OLD | NEW | TYPE | code` row format (`mcp/checkout.ts` `formatFilesWithLineNumbers`,
// e354ba2).
// Portions adapted from PR-Agent (qodo-ai/pr-agent), MIT, Copyright (c) 2026 The PR Agent: the extra hunk context (five
// lines before, one after) and the dynamic context that widens a hunk to git's section header when the old and new
// lines before it match, at most ten lines back (`pr_agent/algo/git_patch_processing.py` `extend_patch`, 330f0813); and
// listing by name what does not fit the change block (`pr_agent/algo/pr_processing.py`).

import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { CODE_DIFF_STATES, CODE_CHANGE_TYPES, CODE_DOSSIER_KINDS, CODE_DOSSIER_MOVES, PROMISE_STATUSES,
  REQUIREMENT_STATUSES, FAILURE_HANDLINGS, DECISION_COLUMNS, WRITTEN_LABELS, FORBIDDEN_EDIT_BREACHES, personsProjectFile,
  CODE_ACCOUNT_ASK_SOURCES } from './ledger.js';
import { isRead, effectReader, ACTION_EFFECTS, CHANGING_EFFECTS } from './session.js';
import { itemKindOf, unsettledAsk, unsettledRow } from './triage.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && [Object.prototype, null].includes(Object.getPrototypeOf(v));
const list = (v) => (Array.isArray(v) ? v : []);
const bytesOf = (value) => Buffer.byteLength(value, 'utf8');

const [RECORDED, UNRECORDED, BASE_UNKNOWN, WITHHELD, DIFF_UNREADABLE] = CODE_DIFF_STATES;
const [ADDED, MODIFIED, DELETED] = CODE_CHANGE_TYPES;

// ---- paths ------------------------------------------------------------------------------------------------------------

/**
 * The path the code step names a file by: a path as recorded that lies under the working directory `root` (absolute) is
 * named relative to it, with forward slashes, so a file the session named absolutely, the one it named relatively and
 * the one git names are one file; any other path is named as recorded. String work only, never the disk.
 */
export function displayPath(path, root) {
  if (typeof path !== 'string' || !path || typeof root !== 'string' || !isAbsolute(root) || !isAbsolute(path)) return path;
  const rel = relative(resolve(root), resolve(path));
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return path;
  return rel.split(sep).join('/');
}

/** A path the shell reads from the home folder (`~/`, `$HOME/`, `${HOME}/`, `%USERPROFILE%\`): the shell's own grammar,
 *  never the working directory's, whatever folder a relative join would put it in. */
export const HOME_SPELLED = /^(?:~|\$HOME|\$\{HOME\}|%USERPROFILE%)(?:[/\\]|$)/i;

/**
 * The shell's expansion grammar in a recorded spelling (POSIX Shell Command Language 2.6.2 and 2.6.3): a parameter
 * expansion — `$` before a name's first character, a digit, a special parameter or a brace (`$NAME`, `$1`, `$@`, `$$`,
 * `${…}`) — or a command substitution (`$(…)`, a backquote). The shell replaced it when the command ran; the recording
 * keeps the command as typed. Never a list of names.
 */
const SHELL_EXPANSION = /\$[A-Za-z_0-9{(@*#?!$-]|`/;
/** The recorded operations that write a file, as the code step's plan reads them (code-pass.js `codeSnapshotPlan`). */
const WRITE_OPERATIONS = Object.freeze(['write', 'edit', 'delete']);

/**
 * D117 amended and D118 (b), one rule since their integration (0.3.0-beta.5; the owner, 2026-10-18: "paths that hold an
 * unexpanded $VARIABLE are never counted"): the recorded spellings of the paths that the session's writes could have
 * changed (landed or unknown effect, as the code step's plan reads a write) and that the recording does not resolve, each
 * once, in the order first written. A spelling is not resolved exactly when
 *   (1) every such write of it was read by the slicer from a command's text (`shellWriteOf`, the parent link it writes):
 *       a file tool's path is the path the tool used, so a `$` in it is a character of the name (a route file named
 *       `$id.tsx`), and a spelling a file tool wrote once is a file;
 *   (2) it holds the shell's expansion grammar (`SHELL_EXPANSION`), and is not spelled from the home folder
 *       (`HOME_SPELLED`: D109 names that one from the home, and reads it first); and
 *   (3) its literal spelling names no path that exists, resolved against the session's working folder: the recording
 *       keeps a parsed write's spelling without the command's quoting, so a heredoc to 'app/routes/users.$id.tsx' wrote
 *       that very name. Whether a path exists is a fact of the disk, which this module never reads: `literal` holds the
 *       spellings that the code step's snapshot found naming a path (cli code-snapshot.js `readCodeSnapshot`), and its
 *       record keeps them (`base.literal`, code-pass.js `literalOf`), so every other reader decides from that record.
 *       With no such record (the code step off, or a record written before this rule), no spelling is known to name a
 *       path, and (1) and (2) decide.
 * Such a path names no file Sonah can place: never a file of the change or of the repository, nor one outside them; it is
 * counted apart. The one list every reader reads: the code step's plan (code-pass.js `codeSnapshotPlan`), its snapshot's
 * count (`base.unresolved`) and the story (render session-story.js), so the report model's header and Files section.
 * Structure, the shell's grammar and the recorded fact only, never a variable's name. Pure.
 */
export function unresolvedShellPaths(session, { literal = [] } = {}) {
  const named = new Set(list(literal));
  const shellOnly = new Map();
  const effectOf = effectReader(session);
  for (const event of list(session?.events)) {
    if (event?.kind !== 'invocation' || !WRITE_OPERATIONS.includes(event.operation)) continue;
    if (!CHANGING_EFFECTS.includes(effectOf(event))) continue;
    const shell = typeof event.shellWriteOf === 'string' && event.shellWriteOf !== '';
    for (const change of list(event.changes)) {
      const path = change?.path;
      if (typeof path === 'string' && path) shellOnly.set(path, (shellOnly.get(path) ?? true) && shell);
    }
  }
  return [...shellOnly].filter(([path, shell]) => shell && !HOME_SPELLED.test(path) && SHELL_EXPANSION.test(path)
    && !named.has(path)).map(([path]) => path);
}

/**
 * Whether a path the code step names lies under the working directory, by its spelling: relative (`displayPath` made it
 * so), with no `..` step, not home-spelled. A recorded write outside it (absolute as recorded, or reached by `..`) is no
 * part of the change under review: it is counted (`outside_root`). Structure, not privacy (D90: every path may be
 * named). String work only.
 */
export function underRoot(path) {
  if (typeof path !== 'string' || !path || isAbsolute(path) || win32.isAbsolute(path) || HOME_SPELLED.test(path))
    return false;
  return !path.split(/[\\/]/).includes('..');
}

// ---- hunks ------------------------------------------------------------------------------------------------------------

/** Git's unified-diff hunk header (`@@ -a[,b] +c[,d] @@ section`): a formal, documented grammar. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
/** The context PR-Agent adds around git's own three lines (`configuration.toml`: patch_extra_lines_before = 5,
 *  patch_extra_lines_after = 1, max_extra_lines_before_dynamic_context = 10). Frozen literals. */
export const HUNK_CONTEXT = Object.freeze({ before: 5, after: 1, dynamicMax: 10 });

/** Git's own words for a path whose diff it shows without text (a `binary` or `-diff` attribute, or content it reads as
 *  binary): `Binary files a/x and b/x differ`, or `GIT binary patch`. Git's output grammar, not a word list. */
const GIT_BINARY_LINE = /^(?:Binary files .* differ|GIT binary patch)$/;

/**
 * The hunks of one file's git patch (`git diff -U3` output for one path), each `{ oldStart, oldCount, newStart,
 * newCount, header, rows }` with `rows` `{ type: ' ' | '-' | '+', text, old, new }` (line numbers, 1-based, null on the
 * side a row is not on). Lines before the first hunk (the `diff --git`, `index`, `---`, `+++` and mode lines) are not
 * read; a `\ No newline at end of file` line is skipped. `binary` is true when git said it shows the path without text
 * (`GIT_BINARY_LINE`). `{ ok: false }` for a body line that is none of the three, or a hunk whose rows do not add up to
 * its header's counts. Pure.
 */
export function parseHunks(patch) {
  if (typeof patch !== 'string') return { ok: false, hunks: [] };
  const hunks = [];
  let binary = false;
  let current = null, oldLeft = 0, newLeft = 0, oldAt = 0, newAt = 0;
  const lines = patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (current && (oldLeft > 0 || newLeft > 0)) {
      if (line.startsWith('\\')) continue;
      const type = line[0] ?? ' ';
      const text = line.slice(1);
      if (type === ' ' && oldLeft > 0 && newLeft > 0) {
        current.rows.push({ type, text, old: oldAt++, new: newAt++ }); oldLeft--; newLeft--;
      } else if (type === '-' && oldLeft > 0) { current.rows.push({ type, text, old: oldAt++, new: null }); oldLeft--; }
      else if (type === '+' && newLeft > 0) { current.rows.push({ type, text, old: null, new: newAt++ }); newLeft--; }
      else return { ok: false, hunks: [] };
      continue;
    }
    const match = HUNK_HEADER.exec(line);
    if (match) {
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      const oldStart = Number(match[1]), newStart = Number(match[3]);
      current = { oldStart, oldCount, newStart, newCount, header: match[5].trim(), rows: [] };
      hunks.push(current);
      oldLeft = oldCount; newLeft = newCount;
      // A zero-length side numbers the line before the change (`-0,0` for an added file).
      oldAt = oldCount === 0 ? oldStart + 1 : oldStart;
      newAt = newCount === 0 ? newStart + 1 : newStart;
      continue;
    }
    if (current && line.startsWith('\\')) continue;
    if (current) return { ok: false, hunks: [] };
    if (GIT_BINARY_LINE.test(line)) binary = true;
  }
  if (current && (oldLeft > 0 || newLeft > 0)) return { ok: false, hunks: [] };
  return { ok: true, hunks, binary };
}

/** The lines of a text as git numbers them: split on LF; a final LF opens no line of its own. */
export const linesOf = (text) => {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
};

/** The lines of a text as a diff counts them: none for an empty text, else `linesOf`. */
export const diffLines = (text) => (text === '' ? [] : linesOf(text));

/**
 * Whether `hunks` (parsed, before widening) turn `base` into `head` (each a `diffLines` list; null: no file on that
 * side): every line outside the hunks kept, each hunk's removed lines dropped and its added lines put in. False when
 * they do not (a patch that left out a change, or is not of these texts). The review of the code step: what a request
 * shows of a change is exactly the change. Pure.
 */
export function rebuilds(hunks, base, head) {
  const from = base ?? [], to = head ?? [];
  const out = [];
  let at = 1;
  for (const hunk of list(hunks)) {
    const first = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    if (!Number.isSafeInteger(first) || first < at) return false;
    for (; at < first; at++) { if (at > from.length) return false; out.push(from[at - 1]); }
    for (const row of hunk.rows) {
      if (row.type === '+') { out.push(row.text); continue; }
      if (row.old !== at || at > from.length) return false;
      if (row.type === ' ') out.push(row.text);
      at++;
    }
  }
  for (; at <= from.length; at++) out.push(from[at - 1]);
  return out.length === to.length && out.every((line, i) => line === to[i]);
}

/** Every row of every hunk is literally its file's line at its number: old rows in `base`, new rows in `head` (each a
 *  line list, null when that side has no file). False for any mismatch: the diff is not of these two texts. Pure. */
export function hunksMatch(hunks, base, head) {
  for (const hunk of list(hunks)) for (const row of hunk.rows) {
    if (row.old !== null && (base === null || base[row.old - 1] !== row.text)) return false;
    if (row.new !== null && (head === null || head[row.new - 1] !== row.text)) return false;
  }
  return true;
}

/** How many of `n` lines before old line `o` and new line `w` (both 1-based, exclusive) are equal pairwise, counted from
 *  the nearest. */
function commonBefore(base, head, o, w, n) {
  let k = 0;
  while (k < n && o - 1 - k - 1 >= 0 && w - 1 - k - 1 >= 0 && base[o - 2 - k] === head[w - 2 - k]) k++;
  return k;
}
/** How many of `n` lines after old line `o` and new line `w` (inclusive starts) are equal pairwise, from the nearest. */
function commonAfter(base, head, o, w, n) {
  let k = 0;
  while (k < n && o - 1 + k < base.length && w - 1 + k < head.length && base[o - 1 + k] === head[w - 1 + k]) k++;
  return k;
}

/**
 * Each hunk of a modified file with PR-Agent's extra context (adapted from `extend_patch`): when git's section header
 * is in one of the `dynamicMax` lines before the hunk and every line from there on is the same before and after, the
 * hunk widens to start at it; otherwise it takes up to `before` more lines, as many as are the same on both sides; and
 * up to `after` more lines after it, the same way. A widening never reaches into the hunk before or after it. Only a
 * file with both sides is widened: an added or deleted file's one hunk is the whole file already. Pure.
 */
export function extendHunks(hunks, base, head, context = HUNK_CONTEXT) {
  if (!Array.isArray(base) || !Array.isArray(head)) return list(hunks).map((h) => ({ ...h, rows: [...h.rows] }));
  const out = [];
  const sorted = [...list(hunks)];
  sorted.forEach((hunk, at) => {
    const firstOld = hunk.oldCount === 0 ? hunk.oldStart + 1 : hunk.oldStart;
    const firstNew = hunk.newCount === 0 ? hunk.newStart + 1 : hunk.newStart;
    const lastOld = firstOld + hunk.oldCount - 1, lastNew = firstNew + hunk.newCount - 1;
    const prior = out.at(-1);
    const floorOld = prior ? prior.lastOld + 1 : 1;
    const next = sorted[at + 1];
    const ceilingOld = next ? (next.oldCount === 0 ? next.oldStart + 1 : next.oldStart) - 1 : base.length;
    const room = Math.max(0, firstOld - floorOld);
    let before = commonBefore(base, head, firstOld, firstNew, Math.min(context.before, room));
    if (hunk.header) {
      const reach = Math.min(context.dynamicMax, room);
      for (let back = reach; back > 0; back--) {
        if (!base[firstOld - 1 - back].includes(hunk.header)) continue;
        if (commonBefore(base, head, firstOld, firstNew, back) === back) before = back;
        break;
      }
    }
    const after = commonAfter(base, head, lastOld + 1, lastNew + 1,
      Math.min(context.after, Math.max(0, ceilingOld - lastOld)));
    const rows = [];
    for (let k = before; k > 0; k--) rows.push({ type: ' ', text: base[firstOld - 1 - k], old: firstOld - k, new: firstNew - k });
    rows.push(...hunk.rows);
    for (let k = 0; k < after; k++) rows.push({ type: ' ', text: base[lastOld + k], old: lastOld + 1 + k, new: lastNew + 1 + k });
    const oldCount = hunk.oldCount + before + after, newCount = hunk.newCount + before + after;
    out.push({ oldStart: oldCount === 0 ? hunk.oldStart : firstOld - before, oldCount,
      newStart: newCount === 0 ? hunk.newStart : firstNew - before, newCount, header: hunk.header, rows,
      lastOld: lastOld + after });
  });
  return out.map(({ lastOld: _last, ...hunk }) => hunk);
}

/** One added file's single hunk, every line `+`, numbered from 1 (the whole file: an untracked file git has no patch
 *  for). */
export const addedHunk = (head) => ({ oldStart: 0, oldCount: 0, newStart: 1, newCount: head.length, header: '',
  rows: head.map((text, i) => ({ type: '+', text, old: null, new: i + 1 })) });

/** A line diff of two short texts' lines (`[type, text]` per row), LCS, bounded: past `ceiling` cells every old line is
 *  removed and every new one added. */
function lineDiff(a, b, ceiling = 250_000) {
  if (a.length * b.length > ceiling) return [...a.map((t) => ['-', t]), ...b.map((t) => ['+', t])];
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a[i++]]);
    else ops.push(['+', b[j++]]);
  }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}

/**
 * The new-side rows a recorded call's hunks give its one file, as the recorder numbered and wrote them
 * (`event.recorded.hunks`: Claude Code's `structuredPatch`, a Codex change's `unified_diff`): each `{ line, text, added }`
 * — a context row (`added: false`) or a row the call added — or null when the call records no hunk, a hunk out of shape,
 * or changes more than one file (its hunks then name no file by structure). Pure.
 */
export function recordedNewRows(event) {
  const hunks = recordedPatchOf(event);
  if (hunks === null) return null;
  const rows = [];
  for (const hunk of hunks) {
    let newAt = hunk.newStart;
    for (const line of hunk.lines) {
      const mark = line[0] ?? ' ';
      if (mark === '+' || mark === ' ') rows.push({ line: newAt++, text: line.slice(1), added: mark === '+' });
    }
  }
  return rows;
}
/** A recorded call's hunks in the recorder's shape (`{ oldStart, oldLines, newStart, newLines, lines }`), when it holds
 *  them for exactly one file; null otherwise. */
function recordedPatchOf(event) {
  const hunks = event?.kind === 'invocation' ? event.recorded?.hunks : undefined;
  if (!Array.isArray(hunks) || !hunks.length || list(event.changes).length !== 1) return null;
  const count = (n) => Number.isSafeInteger(n) && n >= 0;
  const ok = hunks.every((h) => h !== null && typeof h === 'object' && ['oldStart', 'oldLines', 'newStart', 'newLines']
    .every((k) => count(h[k])) && Array.isArray(h.lines) && h.lines.every((line) => typeof line === 'string'
    && [' ', '-', '+', '\\'].includes(line[0] ?? ' ')));
  return ok ? hunks : null;
}
/**
 * Rows of a file (`rows`, `{ line, … }`, 1-based) as the same rows after a later recorded call on it changed it, by that
 * call's own hunks (`recordedPatchOf`): a line before or after a hunk moves by what the hunks before it added and
 * removed; a context line of a hunk keeps its place in it; a removed line is gone. A context row that is gone is dropped
 * (the later call changed it); null when an added row is gone (the call's own text is no longer all there), or the call
 * records no hunk: the place is then not known. Pure.
 */
export function mapRecordedRows(rows, event) {
  const hunks = recordedPatchOf(event);
  if (!Array.isArray(rows) || hunks === null) return null;
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  const one = (line) => {
    let delta = 0;
    for (const hunk of sorted) {
      const first = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
      if (line < first) return line + delta;
      if (line <= first + hunk.oldLines - 1) {
        let oldAt = hunk.oldStart, newAt = hunk.newStart;
        for (const row of hunk.lines) {
          const mark = row[0] ?? ' ';
          if (mark === ' ') { if (oldAt === line) return newAt; oldAt++; newAt++; }
          else if (mark === '-') { if (oldAt === line) return null; oldAt++; }
          else if (mark === '+') newAt++;
        }
        return null;
      }
      delta += hunk.newLines - hunk.oldLines;
    }
    return line + delta;
  };
  const mapped = [];
  for (const row of rows) {
    const line = one(row.line);
    if (line === null && row.added) return null;
    if (line !== null) mapped.push({ ...row, line });
  }
  return mapped;
}

/**
 * The hunks of a file with no git base: one per recorded change of it, in order (`edits`, from codeSnapshotPlan:
 * `{ before, after, whole, placed }`, each side a list of the change's uninterrupted text spans; `placed` the rows the
 * recorder's own hunks numbered for it — its context and added rows, `{ line, text, added }` — as they are in the file
 * now, or null when the recording does not give them). An edit's before and after (one span each) are line-diffed; any
 * other is its before lines removed and its after lines added. Its new-side numbers are where its after text is
 * literally in the file now, its rows the file's own lines. With recorded numbers, only where they still hold: every
 * row the recorder numbered is, word for word, that line of the file now, and the place holds every added row — and when
 * the after text is in more than one place, at least one context row must say which (the second review of the code step:
 * numbers gone stale after a change no recording holds, such as a formatter run, placed an edit on an untouched line
 * with the same text; fails closed). With no recorded numbers, the only such place there is. An edit whose after text
 * the file no longer holds (a later edit replaced it), whose recorded numbers no longer hold, or whose place the
 * recording cannot tell apart, is not located: it has no new-side line (never the first match, which may be another line
 * with the same text), and the file is shown whole. A whole-file write is shown by the file itself: its hunk carries no
 * row. Old-side numbers are never known. `header` names the edit's place (`recorded edit N`). Pure.
 */
export function recordedHunks(edits, headText) {
  const head = linesOf(headText) ?? [];
  return list(edits).map((edit, at) => {
    const header = `recorded edit ${at + 1}`;
    const after = list(edit.after).filter((s) => typeof s === 'string');
    const before = list(edit.before).filter((s) => typeof s === 'string');
    const afterText = after.length === 1 ? after[0] : null;
    const placed = Array.isArray(edit.placed) && edit.placed.some((r) => r?.added === true) ? edit.placed : null;
    // Every place in the file now where the after text starts a line.
    const starts = [];
    if (afterText && typeof headText === 'string') {
      for (let offset = headText.indexOf(afterText); offset !== -1; offset = headText.indexOf(afterText, offset + 1))
        if (offset === 0 || headText[offset - 1] === '\n') starts.push(headText.slice(0, offset).split('\n').length);
    }
    // The recorder's numbers hold: each row it numbered is that line of the file now, and they tell the place apart.
    const holds = placed === null || (placed.every((r) => Number.isSafeInteger(r.line) && head[r.line - 1] === r.text)
      && (starts.length <= 1 || placed.some((r) => r.added !== true)));
    const addedLines = placed === null ? [] : placed.filter((r) => r.added === true).map((r) => r.line);
    if (edit.whole === true) {
      const count = afterText === null ? 0 : (linesOf(afterText) ?? []).length;
      const fits = holds ? starts.filter((start) => addedLines.every((l) => l >= start && l < start + count)) : [];
      const startNew = fits.length === 1 ? fits[0] : null;
      return { oldStart: null, oldCount: 0, newStart: startNew, newCount: startNew === null ? 0 : count, header,
        whole: true, rows: [] };
    }
    const ops = before.length === 1 && after.length === 1 ? lineDiff(linesOf(before[0]) ?? [], linesOf(after[0]) ?? [])
      : [...before.flatMap((s) => (linesOf(s) ?? []).map((t) => ['-', t])),
        ...after.flatMap((s) => (linesOf(s) ?? []).map((t) => ['+', t]))];
    const rowsAt = (start) => {
      let newAt = start;
      return ops.map(([type, text]) => {
        const row = { type, text, old: null, new: type === '-' ? null : newAt };
        if (type !== '-') newAt++;
        return row;
      });
    };
    // A located edit's new rows must be the file's lines, and hold every line the recording added it on.
    const located = holds ? starts.map(rowsAt).filter((rows) => rows.every((r) => r.new === null
      || head[r.new - 1] === r.text) && addedLines.every((l) => rows.some((r) => r.new === l))) : [];
    const rows = located.length === 1 ? located[0] : ops.map(([type, text]) => ({ type, text, old: null, new: null }));
    const startNew = located.length === 1 ? rows.find((r) => r.new !== null)?.new ?? null : null;
    return { oldStart: null, oldCount: rows.filter((r) => r.type !== '+').length,
      newStart: startNew, newCount: startNew === null ? 0 : rows.filter((r) => r.type !== '-').length, header, rows };
  });
}

/**
 * The lines one file's hunks changed, by side: `new` — the new-side lines of added rows, and for a hunk that only
 * removed lines the new-side lines either side of the removal; `old` — the old-side lines of removed rows. A whole-file
 * recorded write changed every line it wrote. `[[start, end], …]` per side, in order. Pure.
 */
export function changedSpans(hunks) {
  const lines = { new: new Set(), old: new Set() };
  for (const hunk of list(hunks)) {
    if (hunk.whole === true && Number.isSafeInteger(hunk.newStart) && hunk.newCount > 0) {
      for (let l = hunk.newStart; l < hunk.newStart + hunk.newCount; l++) lines.new.add(l);
      continue;
    }
    const removalOnly = !hunk.rows.some((r) => r.type === '+');
    hunk.rows.forEach((row, at) => {
      if (row.type === '+' && row.new !== null) lines.new.add(row.new);
      if (row.type === '-' && row.old !== null) lines.old.add(row.old);
      if (row.type === '-' && removalOnly) {
        // A removal only: the new-side lines it sits between.
        const before = hunk.rows.slice(0, at).reverse().find((r) => r.new !== null)?.new;
        const after = hunk.rows.slice(at + 1).find((r) => r.new !== null)?.new;
        for (const l of [before, after]) if (Number.isSafeInteger(l)) lines.new.add(l);
      }
    });
  }
  const spans = (set) => [...set].sort((a, b) => a - b).reduce((out, l) => {
    const last = out.at(-1);
    if (last && l === last[1] + 1) last[1] = l; else out.push([l, l]);
    return out;
  }, []);
  return { new: spans(lines.new), old: spans(lines.old) };
}

/**
 * The line ranges a file's shown hunks show as one contiguous text, by side (`new`, `old`): each a run of rows on that
 * side with no row of the other side between them (the review of the code step: a removed row between two new-side
 * lines splits them, so a quote never joins two lines the request showed apart). What of a file a request shows
 * through its diff. Pure.
 */
export function hunkRanges(hunks) {
  const ranges = { new: [], old: [] };
  for (const hunk of list(hunks)) for (const side of ['new', 'old']) {
    let run = null;
    for (const row of list(hunk.rows)) {
      const line = row[side];
      if (!Number.isSafeInteger(line)) { run = null; continue; }
      if (run && line === run[1] + 1) run[1] = line;
      else { run = [line, line]; ranges[side].push(run); }
    }
  }
  return ranges;
}

// ---- the change, as a request shows it ---------------------------------------------------------------------------------

/** What a table-of-contents row says of a path, by its diff state, and of one whose hunks the change block does not
 *  show, by why (its file's closed state, or `clipped`: over the change block's bound); and of a file that changed
 *  after the session's last recorded edit (`drifted`: its last recorded write is no longer literally in it), whose
 *  hunks are shown like any changed file's. Fixed words for the model; the states stay closed in the report. */
export const CHANGE_ROW_WORDS = Object.freeze({
  [UNRECORDED]: 'not written by a recorded edit',
  [BASE_UNKNOWN]: 'no git base: its hunks are the recorded edits',
  [WITHHELD]: 'no hunk shown',
  [DIFF_UNREADABLE]: 'its diff could not be read consistently: no hunk shown',
  binary: 'binary: no hunk shown',
  oversize: 'too large to read: no hunk shown',
  changed_since_session: 'it no longer holds what the session last wrote to it: no hunk shown',
  unreadable: 'could not be read: no hunk shown',
  clipped: 'not shown here: its hunks are over this block\'s bound; read the file yourself',
  // code-pass/12 (D105): its hunks fit this block, but not beside the rest of the request.
  request_bound: 'not shown here: its hunks did not fit in this request; read the file yourself',
  drifted: 'changed after the session\'s last recorded edit, so its lines now may not all be the agent\'s',
  // D149: its review unit is past the most units one review plans: no request shows its hunks.
  unit_cap: 'not shown in any call: past the calls one review makes; read it yourself',
});
/** D149: what a table-of-contents row of a review of several units names: the unit that shows the file's hunks, or the
 *  first and the last of the units that show a file split into runs of its hunks. Fixed words. */
export const UNIT_ROW_WORDS = (labels) => (labels.length === 1 ? labels[0] : `${labels[0]} to ${labels.at(-1)}`);

/**
 * D149: the change block of one unit of a review of several (Pullfrog's format, adapted): `## Files (N)`, one row per
 * differing path, the same bytes in every unit — `- path · type · U<k>` (UNIT_ROW_WORDS: the unit, or the units, that
 * show its hunks), or the path with why no unit shows them (`why`, a CHANGE_ROW_WORDS key) — each row's `notes` after
 * it; the counted rows as `renderChange`'s; then `---` and the sections of this unit's files (`sectionLines`), in the
 * table of contents' order. `entries`: `{ path, type, labels, why, notes, hunks, shown }`. Pure.
 */
export function renderUnitChange(entries, { outside = 0, elsewhere = 0 } = {}) {
  const rows = list(entries);
  const counted = [...(outside > 0 ? [OUTSIDE_ROW_WORDS(outside)] : []),
    ...(elsewhere > 0 ? [ELSEWHERE_ROW_WORDS(elsewhere)] : [])];
  const toc = [`## Files (${rows.length})`, ...rows.map((entry) => {
    const notes = list(entry.notes).filter((n) => typeof n === 'string' && n).map((n) => ` · ${n}`).join('');
    return list(entry.labels).length ? `- ${entry.path} · ${entry.type} · ${UNIT_ROW_WORDS(entry.labels)}${notes}`
      : `- ${entry.path} · ${entry.type} · ${CHANGE_ROW_WORDS[entry.why] ?? CHANGE_ROW_WORDS[WITHHELD]}${notes}`;
  }), ...counted, '', '---', ''];
  const out = rows.filter((entry) => entry.shown).flatMap((entry) => sectionLines(entry));
  return `${toc.join('\n')}${out.join('\n')}`;
}
/** What the table of contents says, by count only, of the paths git shows differing from the start commit outside the
 *  working directory (git's lists stop at it). Fixed words. */
export const OUTSIDE_ROW_WORDS = (n) => `- and ${n} more ${n === 1 ? 'path differs' : 'paths differ'} from the start `
  + 'commit outside the working directory: not part of the change reviewed';
/** D113: what the table of contents says, by count only, of the paths in the working directory that differ from the
 *  start commit and that no recorded write of the session touched (cli code-snapshot.js `sessionsOwnChange`): they
 *  changed outside this session's recorded writes and are no part of the change. D113 amended (the owner, 2026-10-18:
 *  "tag it by outside the evaluated session"): they are outside the evaluated session, said in those fixed words, and the
 *  review request may show them in a block of their own after the change (code-pass.js `outsideBlock`). Fixed words. */
export const ELSEWHERE_ROW_WORDS = (n) => `- and ${n} more ${n === 1 ? 'path differs' : 'paths differ'} from the start `
  + 'commit in the working directory, changed outside this session\'s recorded writes: outside the evaluated session, '
  + 'not part of this change';

const pad = (n) => (n === null || n === undefined ? '    ' : String(n).padStart(4, ' '));
/** One hunk row as Pullfrog formats it: `| OLD | NEW | TYPE | code`. */
const rowLine = (row) => `| ${pad(row.old)} | ${pad(row.new)} | ${row.type === ' ' ? ' ' : row.type} | ${row.text}`;
/** The `@@` line of a shown hunk: git's numbers (as widened) and its section header; a recorded edit by its place. */
const hunkLine = (hunk) => (hunk.oldStart === null
  ? `@@ ${hunk.header}${hunk.newStart === null ? ': not found in the file now' : hunk.whole === true
    ? `: wrote the whole file, lines ${hunk.newStart}-${hunk.newStart + hunk.newCount - 1} (read the file for its text)`
    : `: new lines ${hunk.newStart}-${hunk.newStart + hunk.newCount - 1}`} @@`
  : `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@${hunk.header ? ` ${hunk.header}` : ''}`);

/** One shown file's diff section as lines: its `diff --git` header (Pullfrog keeps git's) and its hunks as rows, then a
 *  blank line. */
export function sectionLines(entry) {
  const a = entry.type === ADDED ? '/dev/null' : `a/${entry.path}`;
  const b = entry.type === DELETED ? '/dev/null' : `b/${entry.path}`;
  const lines = [`diff --git a/${entry.path} b/${entry.path}`, `--- ${a}`, `+++ ${b}`];
  if (!list(entry.hunks).length) lines.push('(no line changed: a mode change, or an empty file)');
  for (const hunk of list(entry.hunks)) lines.push(hunkLine(hunk), ...hunk.rows.map(rowLine));
  lines.push('');
  return lines;
}
/** The bytes one file's diff section takes in a request (its lines and their line ends). */
export const sectionBytes = (entry) => sectionLines(entry).reduce((sum, line) => sum + bytesOf(line) + 1, 0);

/**
 * The change block (Pullfrog's format, adapted): `## Files (N)`, one row per differing path — `- path → lines a-b ·
 * type` when the block shows its hunks (a-b: the lines of this block they occupy, counted from the `## Files` line as
 * line 1), else the path with why not — each row's `notes` after it (the dossier keys whose events touch the path, …),
 * never removing or reordering a row; then, by count only, the paths git shows differing outside the working directory
 * (`outside`, OUTSIDE_ROW_WORDS) and (D113) those in it that changed outside this session's recorded writes
 * (`elsewhere`, ELSEWHERE_ROW_WORDS); then `---` and each shown file's section (`sectionLines`). `entries`: `{ path,
 * type, hunks, shown, notes, why }` in table-of-contents order; `shown` false lists the path by `why` (a CHANGE_ROW_WORDS
 * key). Pure.
 */
export function renderChange(entries, { outside = 0, elsewhere = 0 } = {}) {
  const rows = list(entries);
  const counted = [...(outside > 0 ? [OUTSIDE_ROW_WORDS(outside)] : []),
    ...(elsewhere > 0 ? [ELSEWHERE_ROW_WORDS(elsewhere)] : [])];
  const placed = rows.filter((entry) => entry.shown);
  const out = [];
  const ranges = new Map();
  let at = 1 + rows.length + counted.length + 2 + 1;
  for (const entry of placed) {
    const lines = sectionLines(entry);
    ranges.set(entry.path, [at, at + lines.length - 1]);
    out.push(...lines);
    at += lines.length;
  }
  const toc = [`## Files (${rows.length})`, ...rows.map((entry) => {
    const range = ranges.get(entry.path);
    const notes = list(entry.notes).filter((n) => typeof n === 'string' && n).map((n) => ` · ${n}`).join('');
    return range ? `- ${entry.path} → lines ${range[0]}-${range[1]} · ${entry.type}${notes}`
      : `- ${entry.path} · ${entry.type} · ${CHANGE_ROW_WORDS[entry.why] ?? CHANGE_ROW_WORDS[WITHHELD]}${notes}`;
  }), ...counted, '', '---', ''];
  return `${toc.join('\n')}${out.join('\n')}`;
}

// ---- the dossier ------------------------------------------------------------------------------------------------------

const [CLAIM_UNCONFIRMED, CLAIM_CONFIRMED, DESIGN_POINT, NOT_ACTING, FAILURE_PASSED_OVER, NEVER_RAN, ASK_SHORT,
  EDIT_AGAINST, ASK_DONE] = CODE_DOSSIER_MOVES;
const [ASK, CLAIM, DECISION, PIVOT, FAILURE, EDIT_AGAINST_KIND] = CODE_DOSSIER_KINDS;
const [OPEN_CLAIM, VERIFIED] = PROMISE_STATUSES;
const [DONE, PARTLY_DONE, NOT_DONE, NOT_CHECKED_ASK] = REQUIREMENT_STATUSES;
const PASSED_OVER = FAILURE_HANDLINGS[2];
const [SETTLED, ASKED_CHOSE, UNASKED] = DECISION_COLUMNS;
const [WRITTEN_UNVERIFIED] = WRITTEN_LABELS;

/** Who decided a decision, in the request's fixed words, by its column. */
export const DOSSIER_COLUMN_WORDS = Object.freeze({ [SETTLED]: 'the person settled it',
  [ASKED_CHOSE]: 'the person asked, the agent chose how', [UNASKED]: 'made without asking the person',
  unchecked: 'the review could not tell whether the person asked' });

const quoteOf = (receipt) => (plain(receipt) && typeof receipt.quote === 'string' ? receipt.quote : null);
const textOf = (session, event, field) => {
  try { return event ? session.textRegionsOf(event, field).text : ''; } catch { return ''; }
};
/** The most bytes of a session text's start, and of its end, the code step's review request shows when it does not
 *  show the text whole (a command, a failure's command and its output): the literal the request showed 2,000 characters
 *  a side by before code-pass/12, now in bytes and in whole lines. A frozen literal. */
export const SHOWN_SIDE_BYTES = 2_000;

/**
 * What the code step's review request shows of one session text (code-pass/12, D105: nothing is shortened inside a
 * line). Whole when it is at most twice `side` bytes; else its first whole lines while they stay within `side` bytes,
 * and its last whole lines within `side` bytes, each part named by its line numbers (`linesOf`: a final line end opens
 * no line). A line longer than `side` bytes is shown in no part, never cut. `{ whole: true, text, lines }`, or
 * `{ whole: false, lines, bytes, parts: [{ from, through, text }] }` — each part's text literally in the text, so a
 * quote copied from one part grounds in it. Pure.
 */
export function shownLines(value, side = SHOWN_SIDE_BYTES) {
  const text = String(value ?? '');
  const lines = diffLines(text);
  if (bytesOf(text) <= 2 * side) return { whole: true, text, lines: lines.length };
  const size = lines.map((line) => bytesOf(line) + 1);
  let head = 0, used = 0;
  while (head < lines.length && used + size[head] <= side) used += size[head++];
  let tail = lines.length; used = 0;
  while (tail > head && used + size[tail - 1] <= side) used += size[--tail];
  const parts = [...(head > 0 ? [{ from: 1, through: head, text: lines.slice(0, head).join('\n') }] : []),
    ...(tail < lines.length ? [{ from: tail + 1, through: lines.length, text: lines.slice(tail).join('\n') }] : [])];
  return { whole: false, lines: lines.length, bytes: bytesOf(text), parts };
}
/** A text shown in part (`shownLines`) as a request shows it: its lines and its parts, each with its line numbers. */
const partsShown = (shown) => ({ lines: shown.lines, parts: shown.parts.map((p) => ({ lines: [p.from, p.through],
  text: p.text })) });
/** The line ranges a text shown in part shows, `[[from, through], …]`. */
export const shownRanges = (shown) => (shown.whole ? (shown.lines ? [[1, shown.lines]] : [])
  : shown.parts.map((p) => [p.from, p.through]));

/** The paths a row's receipts' events and its actions named, in order, as the code step names them. */
export function eventPaths(session, ids, root = null) {
  const paths = [];
  for (const id of list(ids).filter((x) => typeof x === 'string')) {
    const event = session?.event?.(id);
    for (const path of [...list(event?.paths).map((p) => p?.path), ...list(event?.changes).map((c) => c?.path)]) {
      const named = displayPath(path, root);
      if (typeof named === 'string' && named && !paths.includes(named)) paths.push(named);
    }
  }
  return paths;
}

/** Who a session text belongs to, by its recorded structure. Closed: the person, a recorded result, the agent. */
export const SESSION_ACTORS = Object.freeze(['person', 'recorded', 'agent']);
const [PERSON, RECORDED_RESULT, AGENT] = SESSION_ACTORS;
/** The actors whose words may be shown to a finding's checker, and quoted by a trace step: the person's words and
 *  recorded results (tool output), never the agent's: the agent's own words cannot check themselves. */
export const EVIDENCE_ACTORS = Object.freeze([PERSON, RECORDED_RESULT]);

/** The typed operations whose result is the harness's own record of what the call did — the output of a command it
 *  ran, the outcome of a write, an edit or a delete — with a typed read (session.js `isRead`): what a file held. Closed. */
export const RECORDED_RESULT_OPERATIONS = Object.freeze(['command', 'write', 'edit', 'delete']);

/**
 * Whose words the text of event `eventId` is, by the recorder's structure, never its words: `person` — a human
 * instruction of the root session, or a project instruction file the harness gave the main agent that no typed change
 * of the session wrote (ledger.js `personsProjectFile`, the rule the session review reads too; otherwise the
 * agent's); `recorded` — the result of
 * a call the slicer typed as a command, a read, a write, an edit or a delete (RECORDED_RESULT_OPERATIONS, `isRead`):
 * the harness's own record of what that call did; `agent` — everything else, so every text code cannot type as one of
 * those (fails closed): the agent's commentary, actions and code, a helper's or a peer's words, and every result that may
 * carry them — a helper's report handed back to its parent (`helperReported`, the result of a delegate call), a
 * background task's result fetched by a poll (TaskOutput), a Workflow's or a message tool's result, a tool the slicer
 * does not type (an MCP tool, a web fetch: what it returns may be another model's words), a result whose call the session
 * does not hold, and any event it does not hold (the second review of the code step: a helper's report fetched through
 * TaskOutput was labelled a recorded result). Known limit: a command that runs another agent prints that agent's words
 * as its own output; no structure tells them apart. Pure.
 */
export function actorOf(session, eventId) {
  let event = null;
  try { event = typeof eventId === 'string' ? session?.event?.(eventId) ?? null : null; } catch { event = null; }
  if (!event) return AGENT;
  if (event.kind === 'instruction') return event.authority === 'human' && (event.childId ?? null) === null ? PERSON : AGENT;
  if (event.kind === 'project-instructions') return personsProjectFile(session, event) ? PERSON : AGENT;
  if (event.kind === 'observation') {
    if (event.helperReported === true) return AGENT;
    let call = null;
    try { call = typeof event.invocation === 'string' ? session.event(event.invocation) : null; } catch { call = null; }
    return call?.kind === 'invocation' && (RECORDED_RESULT_OPERATIONS.includes(call.operation) || isRead(call))
      ? RECORDED_RESULT : AGENT;
  }
  return AGENT;
}

const [ASKED_BY_PERSON, ASKED_IN_BRIEF, ASKED_BY_OTHER] = CODE_ACCOUNT_ASK_SOURCES;
/**
 * D111 amended (2026-10-18): whose words an ask of the session review rests on (ledger.js CODE_ACCOUNT_ASK_SOURCES), from
 * the recorded event its instruction receipt `receipt` cites, never from its words: `person` when that text is yours by
 * `actorOf` (a root instruction recorded with human authority, or a project file you wrote that the main agent was
 * given); `helper_brief` when it is an instruction of a helper's session recorded with its parent agent's authority (the
 * adapter's lineage: sonah-ledger.js `lineageAuthority`), a brief an agent wrote; else `other` (fails closed: no receipt,
 * an event the session does not hold or cannot read, another agent's message, a file not yours). Pure.
 */
export function askSourceOf(session, receipt) {
  const eventId = plain(receipt) && typeof receipt.eventId === 'string' ? receipt.eventId : null;
  if (eventId === null) return ASKED_BY_OTHER;
  let event = null;
  try { event = session?.event?.(eventId) ?? null; } catch { event = null; }
  if (event === null || typeof event !== 'object') return ASKED_BY_OTHER;
  if (actorOf(session, eventId) === PERSON) return ASKED_BY_PERSON;
  return event.kind === 'instruction' && event.authority === 'agent' && typeof event.childId === 'string'
    && event.childId !== '' ? ASKED_IN_BRIEF : ASKED_BY_OTHER;
}

/**
 * The session dossier, built by code from the saved report: every ask (its status and what is missing),
 * every claim (its status), every decision by its column, every change of approach, every failure passed over and every
 * edit against an instruction — each keyed (`S1`, `S2`, … in that order), labelled by whose words it is (`actor`:
 * person, agent or recorded), given the move it asks of the reviewer (`move`, CODE_DOSSIER_MOVES, chosen by structure:
 * code-pass/7, an ask the review shows done is `ask_done`, its delivery checked in the code) and quoted as the review
 * recorded it, with the paths its events named. A quote of an item whose words are another actor's than the item's own
 * (an ask's delivery or shortfall in the agent's words, a failure's command and the agent's response to it) is shown as
 * `{ actor, quote }`, so no agent text is ever labelled the person's or a recorded result (the review of the code step).
 * Each item's `sources` are its quoted texts, each with its event, role and actor (`actorOf`). D96 (code-pass/10): each
 * item's `itemKind` is the report item its row is (triage.js `itemKindOf`, REPORT_ITEM_KINDS), or null when the row can
 * be no item (a done ask, a confirmed claim, a decision you settled): what makes its key one the code review may triage.
 * D153: a row the after-point re-check reaffirmed or left unsettled (triage.js `unsettledRow`) is sent as not checked —
 * an ask with no move and no shortfall, a claim open with no contradiction, a statement unverified — never as one found
 * short or contradicted. Structure only, from the row; never a tier. Pure.
 */
export function codeDossier({ report, session, root = null }) {
  const items = [];
  const add = (kind, actor, move, source, index, id, shown, ids, sources) => {
    items.push({ key: `S${items.length + 1}`, kind, actor, move, source, index, id: id ?? null, shown,
      paths: eventPaths(session, ids, root), sources: sources.filter((s) => typeof s.eventId === 'string'
        && typeof s.text === 'string' && s.text), itemKind: itemKindOf(source, list(report?.[source])[index]) });
  };
  const ids = (receipts) => list(receipts).filter(plain).map((r) => r.eventId);
  // The session text each shown quote is: a receipt's own words, by its event, role and actor.
  const src = (receipts) => list(receipts).filter((r) => quoteOf(r)).map((r) => ({ eventId: r.eventId, role: r.role,
    text: r.quote, actor: actorOf(session, r.eventId) }));
  // A quote as an item of `actor` shows it: its words alone when they are the item's actor's, else with their actor.
  const as = (actor, receipt) => {
    const by = actorOf(session, receipt.eventId);
    return by === actor ? receipt.quote : { actor: by, quote: receipt.quote };
  };
  list(report?.requirements).forEach((r, i) => {
    if (!plain(r)) return;
    const asked = quoteOf(r.instruction) ?? (typeof r.text === 'string' ? r.text : null);
    if (!asked) return;
    // D153: an ask no later window settled, or one a later window reaffirmed (triage.js `unsettledAsk`), is sent as not
    // checked, with no move and no shortfall — never as an ask found short, so the code review is not primed by it.
    const unsettled = unsettledAsk(r);
    add(ASK, PERSON, unsettled ? null : [PARTLY_DONE, NOT_DONE].includes(r.status) ? ASK_SHORT
      : r.status === DONE ? ASK_DONE : null,
    'requirements', i, null,
    { status: unsettled ? NOT_CHECKED_ASK : r.status ?? null,
      asked: quoteOf(r.instruction) ? as(PERSON, r.instruction) : asked,
      ...(quoteOf(r.deliverable) ? { delivered: as(PERSON, r.deliverable) } : {}),
      ...(!unsettled && quoteOf(r.shortfall) ? { missing: as(PERSON, r.shortfall) } : {}) },
    ids([r.deliverable, ...(unsettled ? [] : [r.shortfall])]),
    src([r.instruction, r.deliverable, ...(unsettled ? [] : [r.shortfall])]));
  });
  list(report?.promises).forEach((p, i) => {
    if (!plain(p) || !quoteOf(p.stated)) return;
    add(CLAIM, AGENT, p.status === VERIFIED ? CLAIM_CONFIRMED : CLAIM_UNCONFIRMED, 'promises', i, p.id,
      { status: p.status ?? null, said: as(AGENT, p.stated) }, ids([p.stated, ...list(p.receipts)]), src([p.stated]));
  });
  list(report?.writtenClaims).forEach((w, i) => {
    if (!plain(w) || !quoteOf(w.stated)) return;
    // D153: a contradicted statement the re-check reaffirmed or left unsettled is sent as one not checked.
    add(CLAIM, AGENT, CLAIM_UNCONFIRMED, 'writtenClaims', i, w.id,
      { status: w.label === WRITTEN_UNVERIFIED || unsettledRow('writtenClaims', w) ? 'written, unverified'
        : 'written, contradicted',
        said: as(AGENT, w.stated) }, ids([w.stated]), src([w.stated]));
  });
  list(report?.findings).forEach((f, i) => {
    if (!plain(f) || f.origin === 'code-review') return;
    if (f.kind === 'claim_contradicted') {
      const said = list(f.receipts).find((r) => r?.role === 'commentary');
      const against = list(f.receipts).find((r) => r?.role !== 'commentary');
      if (!quoteOf(said)) return;
      // D153: a contradicted claim the re-check reaffirmed or left unsettled is sent as a claim not checked (open), with
      // no contradiction.
      if (unsettledRow('findings', f)) {
        add(CLAIM, AGENT, CLAIM_UNCONFIRMED, 'findings', i, f.id, { status: OPEN_CLAIM, said: as(AGENT, said) }, ids([said]),
          src([said]));
        return;
      }
      add(CLAIM, AGENT, CLAIM_UNCONFIRMED, 'findings', i, f.id, { status: 'contradicted', said: as(AGENT, said),
        ...(quoteOf(against) ? { contradictedBy: as(AGENT, against) } : {}) }, ids(f.receipts), src([said, against]));
    }
  });
  list(report?.decisions).forEach((d, i) => {
    if (!plain(d)) return;
    const move = d.notActing === true ? NOT_ACTING : d.column === SETTLED ? null : DESIGN_POINT;
    add(DECISION, AGENT, move, 'decisions', i, d.id, { column: DOSSIER_COLUMN_WORDS[d.column]
      ?? DOSSIER_COLUMN_WORDS.unchecked, ...(d.notActing === true ? { notActing: true } : {}),
    ...(typeof d.dimension === 'string' ? { question: d.dimension } : {}),
    ...(typeof d.chosen === 'string' ? { chosen: d.chosen } : {}),
    ...(quoteOf(d.stated) ? { said: as(AGENT, d.stated) } : {}),
    ...(quoteOf(d.valueReceipt) ? { value: as(AGENT, d.valueReceipt) } : {}) },
    [...ids([d.stated, d.valueReceipt]), ...list(d.actions)], src([d.stated, d.valueReceipt]));
  });
  list(report?.pivots).forEach((p, i) => {
    if (!plain(p)) return;
    const said = list(p.receipts).filter((r) => quoteOf(r)).slice(0, 2);
    add(PIVOT, AGENT, DESIGN_POINT, 'pivots', i, null, {
      ...(typeof p.abandoned === 'string' ? { abandoned: p.abandoned } : {}),
      ...(typeof p.adopted === 'string' ? { adopted: p.adopted } : {}),
      ...(said.length ? { said: said.map((r) => as(AGENT, r)) } : {}) }, ids(p.receipts), src(said));
  });
  list(report?.failures).forEach((row, i) => {
    if (!plain(row) || row.handling !== PASSED_OVER || typeof row.eventId !== 'string') return;
    const result = session?.event?.(row.eventId);
    const action = result?.invocation ? session.event(result.invocation) : null;
    // code-pass/12 (D105): the command and its output whole, or their first and last whole lines, each part named.
    const ran = action ? shownLines(textOf(session, action, 'command')) : null;
    const output = result ? shownLines(textOf(session, result, 'output')) : null;
    const outputActor = result ? actorOf(session, result.id) : AGENT;
    const texts = (shown) => (shown.whole ? [shown.text] : shown.parts.map((p) => p.text));
    const field = (actor, shown, own) => (shown.whole ? (actor === own ? shown.text : { actor, quote: shown.text })
      : { ...(actor === own ? {} : { actor }), ...partsShown(shown) });
    add(FAILURE, RECORDED_RESULT, FAILURE_PASSED_OVER, 'failures', i, null, { outcome: row.outcome ?? null,
      ...(ran && (!ran.whole || ran.text) ? { ran: field(AGENT, ran, null) } : {}),
      ...(output ? { output: field(outputActor, output, RECORDED_RESULT) } : {}),
      ...(quoteOf(row.response) ? { response: as(RECORDED_RESULT, row.response) } : {}) },
    [...ids([row.response]), ...(action ? [action.id] : [])],
    [...(action && ran ? texts(ran).map((text) => ({ eventId: action.id, role: 'action', text, actor: AGENT })) : []),
      ...(result ? texts(output).map((text) => ({ eventId: result.id, role: 'observation', text, actor: outputActor }))
        : []),
      ...src([row.response])]);
    // What the request shows of each of them in part, by its line numbers (the request manifest's session texts).
    items.at(-1).inPart = [['ran', ran], ['output', output]].filter(([, shown]) => shown && !shown.whole)
      .map(([name, shown]) => ({ field: name, shown: shownRanges(shown), lines: shown.lines, bytes: shown.bytes }));
  });
  list(report?.findings).forEach((f, i) => {
    if (!plain(f) || f.kind !== 'edit_under_negative_requirement' || !FORBIDDEN_EDIT_BREACHES.includes(f.breach)) return;
    const asked = list(f.receipts).find((r) => r?.role === 'instruction' || r?.role === 'project-instructions');
    const did = list(f.receipts).find((r) => r?.role === 'action' || r?.role === 'code');
    if (!quoteOf(asked)) return;
    add(EDIT_AGAINST_KIND, PERSON, EDIT_AGAINST, 'findings', i, f.id, { breach: f.breach, asked: as(PERSON, asked),
      ...(quoteOf(did) ? { did: as(PERSON, did) } : {}) }, ids(f.receipts), src([asked, did]));
  });
  return items;
}

/** The kind of an event the code step reads as a command run: a recorded invocation of operation `command`. */
const isCommand = (event) => event?.kind === 'invocation' && event.operation === 'command';
const EDITS = Object.freeze(['write', 'edit', 'delete']);
/** D98 (F9): the effect of a call the recorder typed as refused before it ran (session.js ACTION_EFFECTS `none`). */
const [NO_EFFECT] = ACTION_EFFECTS;

/**
 * The commands recorded after a changed file's last recorded edit, each once and numbered (code-pass/12, D105: before,
 * the list repeated after every changed file, so its size grew with files times commands), and per changed path (`paths`,
 * as the code step names them) the first of them after its own last edit. `{ commands: [{ n, at, text, exit | outcome,
 * helper? }], files: [{ path, first }] }`: `commands` are every command recorded after the earliest last edit of a
 * listed path, in recorded order, numbered from 1 (`at` its place in the session's events), each with its exit code (or
 * its recorded outcome when no exit code is typed); `files` the paths with a recorded edit, in the order given, `first`
 * the number of the first command after the path's last edit, so every command from it on came after that edit, or null
 * when none did (`never_ran`). A path with no recorded edit is not listed. Ordering only: whether a command reached the
 * file is the reviewer's to judge. A path's last edit is its last change that could have happened (D98, one reading per
 * recorder fact: session.js `effectOf` is landed or unknown), as the change list (code-pass.js `codeSnapshotPlan`) and
 * the page's Runs list read it: a write refused before it ran, failed or cancelled changed nothing, so commands recorded
 * after an earlier change are not hidden behind it. A command whose effect is `none` (refused before it ran) ran nothing,
 * so it is not listed (the owner's answer of 2026-10-17, "all as suggested", code-pass/11): a file that only such
 * commands follow is `never_ran`, as the page's Runs list says it (report-model.js `neverRanPaths`). The run list still
 * shows the refused command. D149: with `named` (names of files, as the code step names them), the list also holds
 * every command recorded before that whose recorded text names one of those files (`namesPath`: the name literally, as
 * a whole path, never its wording), in the same recorded order, each once, marked `named: true`; with none named, the
 * list is as before. Pure.
 */
/** D149: the characters a path's name is made of: a name in a command's text is a whole path only where none of these
 *  is beside it. */
const PATH_CHARACTER = /[A-Za-z0-9_.\-/~@+]/;
/**
 * D149: whether `text` names the file `name` as a whole path: the name literally, with no path character (`PATH_CHARACTER`)
 * just before it, or just after it — but a `./` just before it (itself after none). So `src/a.js` is named in
 * `node ./src/a.js` and `cat "src/a.js"`, never in `src/a.json`, `lib/src/a.js` or `xsrc/a.js`. Literal string work only.
 * Pure.
 */
export function namesPath(text, name) {
  if (typeof text !== 'string' || typeof name !== 'string' || !name) return false;
  const free = (c) => c === undefined || !PATH_CHARACTER.test(c);
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const after = text[at + name.length];
    const before = text[at - 1];
    const dotted = text.slice(at - 2, at) === './' && free(text[at - 3]);
    if (free(after) && (free(before) || dotted)) return true;
  }
  return false;
}
export function commandsAfterLastEdit(session, paths, root = null, { named = [] } = {}) {
  const events = list(session?.events);
  const lastEdit = new Map();
  const effect = effectReader(session);
  events.forEach((event, at) => {
    if (event?.kind !== 'invocation' || !EDITS.includes(event.operation)) return;
    if (!CHANGING_EFFECTS.includes(effect(event))) return;
    for (const change of list(event.changes)) {
      const name = displayPath(change?.path, root);
      if (typeof name === 'string') lastEdit.set(name, at);
    }
  });
  const listed = list(paths).filter((path) => lastEdit.has(path));
  const names = [...new Set(list(named).filter((name) => typeof name === 'string' && name !== ''))];
  if (!listed.length && !names.length) return { commands: [], files: [] };
  const from = listed.length ? Math.min(...listed.map((path) => lastEdit.get(path))) + 1 : Infinity;
  const mayHaveRun = (event) => isCommand(event) && effect(event) !== NO_EFFECT;
  const namesOne = (event) => { const text = textOf(session, event, 'command'); return names.some((n) => namesPath(text, n)); };
  const commands = [];
  events.forEach((event, at) => {
    if (!mayHaveRun(event) || (at < from && !(names.length && namesOne(event)))) return;
    const result = session.observationFor?.(event.id) ?? null;
    const exit = Number.isSafeInteger(result?.exitCode) ? result.exitCode : null;
    commands.push({ n: commands.length + 1, at, text: textOf(session, event, 'command'), ...(exit !== null ? { exit }
      : { outcome: typeof result?.result === 'string' ? result.result : 'no result recorded' }),
    ...(event.childId ? { helper: true } : {}), ...(at < from ? { named: true } : {}) });
  });
  return { commands, files: listed.map((path) => ({ path,
    first: commands.find((c) => c.at > lastEdit.get(path))?.n ?? null })) };
}

/** The dossier's items as a request shows them: one JSON line per item. Every path is named (D90). An item the code
 *  review may triage names its report item kind (`item`, code-pass/10), never its tier: a tier shown would anchor the
 *  proposal. D147: each path by the name `shownAs` gives it (code-pass.js `shownAsOf`; as it is by default). Pure. */
export function renderDossier(items, { shownAs = (path) => path } = {}) {
  const line = (item) => JSON.stringify({ key: item.key, kind: item.kind, actor: item.actor,
    ...(item.move ? { move: item.move } : {}), ...(item.itemKind ? { item: item.itemKind } : {}), ...item.shown,
    ...(item.paths.length ? { paths: item.paths.map(shownAs) } : {}) });
  return (items.length ? items.map(line) : ['(the review recorded no ask, claim, decision or failure)']).join('\n');
}

/** The commands block's headings and fixed words (code-pass/12). */
export const COMMANDS_HEADING = '## The commands recorded after a changed file\'s last recorded edit, each once, in order';
/** D149: the heading of a unit's commands block that holds earlier commands naming a file of the unit (`named`). */
export const NAMED_COMMANDS_HEADING = '## The commands recorded after a changed file\'s last recorded edit, and those '
  + 'marked "named": recorded before it, whose text names a file of this unit; each once, in order';
export const FIRST_COMMANDS_HEADING = '## Each changed file\'s first command after its last recorded edit';
/** One command as the commands block shows it: its number, its text (whole, or its first and last whole lines, each
 *  part named: `shownLines`), its exit code or recorded outcome, and whether a helper agent ran it. Pure. */
export function commandLine(command) {
  const shown = shownLines(command.text);
  const { n, at: _at, text: _text, ...rest } = command;
  return JSON.stringify({ command: `C${n}`, ran: shown.whole ? shown.text : partsShown(shown), ...rest });
}
/** What the commands block says of the commands it leaves out for room (C`from` to C`through`). Fixed words. */
export const commandsLeftOutLine = (from, through) => `(${from === through ? `C${from} is` : `C${from} to C${through} are`} `
  + 'not shown here: they did not fit in this request)';
/**
 * The commands block (code-pass/12, D105): each command once, numbered — those before C`from` left out for room, named
 * by number in fixed words (`commandsLeftOutLine`); the latest are kept, as each file's commands run to the last — then
 * each changed file with a recorded edit and the first command after its last edit (`never_ran` when none). `lines`, a
 * Map the caller keeps to render each command's line once over several calls. D147: each file by the name `shownAs`
 * gives it (code-pass.js `shownAsOf`; as it is by default). Pure.
 */
export function renderCommands({ commands, files } = {}, { from = 1, lines = new Map(), shownAs = (path) => path } = {}) {
  const rows = list(files).map((f) => JSON.stringify({ path: shownAs(f.path), ...(f.first !== null
    ? { firstCommandAfterLastEdit: `C${f.first}` } : { commandsAfterLastEdit: 'none', move: NEVER_RAN }) }));
  const cmds = list(commands);
  const lineOf = (c) => {
    if (!lines.has(c.n)) lines.set(c.n, commandLine(c));
    return lines.get(c.n);
  };
  return [cmds.some((c) => c.named === true) ? NAMED_COMMANDS_HEADING : COMMANDS_HEADING, '',
    ...(cmds.length ? [...(from > 1 ? [commandsLeftOutLine(1, Math.min(from - 1, cmds.length))] : []),
      ...cmds.filter((c) => c.n >= from).map(lineOf)] : ['(no command was recorded after a changed file\'s last edit)']),
    '', FIRST_COMMANDS_HEADING, '', ...(rows.length ? rows : ['(no file was changed by a recorded edit)'])].join('\n');
}

/** The words an item's dossier line shows (`renderDossier`), as values: each string of its `shown` fields and the quote
 *  of each `{ actor, quote }` there, a list's members included — the review's own words too (a decision's question and
 *  choice), which no session text holds. Structure only. Pure. */
export function dossierWords(item) {
  const words = [];
  const add = (value) => {
    if (typeof value === 'string') words.push(value);
    else if (plain(value) && typeof value.actor === 'string' && typeof value.quote === 'string') words.push(value.quote);
    // code-pass/12: a text shown in part (`shownLines`): each part's words, apart.
    else if (plain(value) && Array.isArray(value.parts))
      for (const part of value.parts) if (plain(part) && typeof part.text === 'string') words.push(part.text);
  };
  const shown = plain(item?.shown) ? item.shown : {};
  // Only the fields that hold an item's own words: never Sonah's closed labels (a status, a column, an outcome, a
  // breach), which many items share, so a quote of one could key a question to the wrong item.
  for (const [field, value] of Object.entries(shown)) {
    if (!DOSSIER_WORD_FIELDS.includes(field)) continue;
    if (Array.isArray(value)) value.forEach(add); else add(value);
  }
  return words;
}
/** The dossier fields that hold an item's own words (the person's, the agent's, a recorded result's, or the review's
 *  words for a decision or a change of approach); read in the order the item's line shows them. */
const DOSSIER_WORD_FIELDS = Object.freeze(['asked', 'delivered', 'missing', 'said', 'contradictedBy', 'question', 'chosen',
  'value', 'abandoned', 'adopted', 'ran', 'output', 'response', 'did']);

export { RECORDED as DIFF_RECORDED, UNRECORDED as DIFF_UNRECORDED, BASE_UNKNOWN as DIFF_BASE_UNKNOWN,
  WITHHELD as DIFF_WITHHELD, DIFF_UNREADABLE, ADDED, MODIFIED, DELETED, bytesOf };
