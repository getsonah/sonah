// The code step's context, assembled by code (`sonah.code-pass/2`):
// the change as a table of contents and `| OLD | NEW | TYPE | code` rows, the whole files in fill order, the session
// dossier built from the saved report, and the budget that places them in requests. Zero calls.
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
// listing by name what does not fit (`pr_agent/algo/pr_processing.py`).

import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { CODE_DIFF_STATES, CODE_CHANGE_TYPES, CODE_DOSSIER_KINDS, CODE_DOSSIER_MOVES, PROMISE_STATUSES,
  REQUIREMENT_STATUSES, FAILURE_HANDLINGS, DECISION_COLUMNS, WRITTEN_LABELS, FORBIDDEN_EDIT_BREACHES, personsProjectFile }
  from './ledger.js';
import { isRead } from './session.js';

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
 * Whether a request may name a path by itself (the review of the code step, privacy): a path the code step names under
 * the working directory — relative (`displayPath` made it so), with no `..` step, not home-spelled. A path outside the
 * working directory (absolute as recorded, or reached by `..`) is never named in a request, only counted; the caller
 * also never names a file in a harness home, by any name. String work only.
 */
export function namedUnderRoot(path) {
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

/** What a table-of-contents row says of a path whose hunks a request does not show, by its diff state and file state.
 *  Fixed words for the model; the states stay closed in the report. */
export const CHANGE_ROW_WORDS = Object.freeze({
  [UNRECORDED]: 'not written by a recorded edit',
  [BASE_UNKNOWN]: 'no git base: the file is shown whole, its hunks are the recorded edits',
  [WITHHELD]: 'withheld: no hunk shown',
  [DIFF_UNREADABLE]: 'its diff could not be read consistently: no hunk shown',
  elsewhere: 'its hunks are in another request of this review',
  unplaced: 'its hunks did not fit this request',
  untouched: 'not shown to this check',
  clipped: 'its hunks are too large for one request: not shown',
});
/** What the table of contents says, by count only, of the paths it may not name (the review of the code step, privacy):
 *  differing paths outside the working directory or in a harness home, and the paths git shows differing outside the
 *  working directory. Fixed words. */
export const UNNAMED_ROW_WORDS = Object.freeze({
  unnamed: (n) => `- and ${n} more differing ${n === 1 ? 'path' : 'paths'} outside the working directory or in a harness `
    + 'home: not named, no hunk shown',
  outside: (n) => `- and ${n} more ${n === 1 ? 'path differs' : 'paths differ'} from the start commit outside the working `
    + 'directory: not reviewed, not named',
});

const pad = (n) => (n === null || n === undefined ? '    ' : String(n).padStart(4, ' '));
/** One hunk row as Pullfrog formats it: `| OLD | NEW | TYPE | code`. */
const rowLine = (row) => `| ${pad(row.old)} | ${pad(row.new)} | ${row.type === ' ' ? ' ' : row.type} | ${row.text}`;
/** The `@@` line of a shown hunk: git's numbers (as widened) and its section header; a recorded edit by its place. */
const hunkLine = (hunk) => (hunk.oldStart === null
  ? `@@ ${hunk.header}${hunk.newStart === null ? ': not found in the file now' : hunk.whole === true
    ? `: wrote the whole file, lines ${hunk.newStart}-${hunk.newStart + hunk.newCount - 1} (shown whole below)`
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
 * The change block one request shows (Pullfrog's format, adapted): `## Files (N)`, one row per differing path —
 * `- path → lines a-b · type` when the request shows its hunks (a-b: the lines of this block they occupy, counted from
 * the `## Files` line as line 1), else the path with why not — each row's `notes` after it (the dossier keys whose
 * events touch the path, …), never removing or reordering a row; then, by count only, the differing paths it may not
 * name (`unnamed`) and those git shows outside the working directory (`outside`, UNNAMED_ROW_WORDS); then `---` and each
 * shown file's section (`sectionLines`). `entries`: `{ path, type, hunks, shown, notes, why }` in table-of-contents
 * order; `shown` false lists the path by `why` (a CHANGE_ROW_WORDS key). `order` (paths) is the order the shown sections
 * are placed in (a checking pass's own); the table of contents keeps its order. Pure.
 */
export function renderChange(entries, { order = null, unnamed = 0, outside = 0 } = {}) {
  const rows = list(entries);
  const counted = [...(unnamed > 0 ? [UNNAMED_ROW_WORDS.unnamed(unnamed)] : []),
    ...(outside > 0 ? [UNNAMED_ROW_WORDS.outside(outside)] : [])];
  const shown = rows.filter((entry) => entry.shown);
  const placed = Array.isArray(order) ? [...order.map((path) => shown.find((e) => e.path === path)).filter(Boolean),
    ...shown.filter((e) => !order.includes(e.path))] : shown;
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
  EDIT_AGAINST] = CODE_DOSSIER_MOVES;
const [ASK, CLAIM, DECISION, PIVOT, FAILURE, EDIT_AGAINST_KIND] = CODE_DOSSIER_KINDS;
const [, VERIFIED] = PROMISE_STATUSES;
const [, PARTLY_DONE, NOT_DONE] = REQUIREMENT_STATUSES;
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
const SHOWN_OUTPUT_CHARS = 2000;
/** The head and the tail of a long recorded text, the middle named. */
export function headTail(value, chars = SHOWN_OUTPUT_CHARS) {
  const all = String(value ?? '');
  if (all.length <= 2 * chars) return all;
  return `${all.slice(0, chars)}\n[… ${all.length - 2 * chars} characters not shown …]\n${all.slice(-chars)}`;
}

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

/**
 * The session dossier, built by code from the saved report: every ask (its status and what is missing),
 * every claim (its status), every decision by its column, every change of approach, every failure passed over and every
 * edit against an instruction — each keyed (`S1`, `S2`, … in that order), labelled by whose words it is (`actor`:
 * person, agent or recorded), given the move it asks of the reviewer (`move`, CODE_DOSSIER_MOVES, chosen by structure)
 * and quoted as the review recorded it, with the paths its events named and, when step 1 checked the row, its code check.
 * A quote of an item whose words are another actor's than the item's own (an ask's delivery or shortfall in the agent's
 * words, a failure's command and the agent's response to it) is shown as `{ actor, quote }`, so no agent text is ever
 * labelled the person's or a recorded result (the review of the code step). Each item's `sources` are its quoted texts,
 * each with its event, role and actor (`actorOf`). `checks`: step 1's `codeCheck` by `source:index`. Pure.
 */
export function codeDossier({ report, session, checks = new Map(), root = null }) {
  const items = [];
  const add = (kind, actor, move, source, index, id, shown, ids, sources) => {
    const check = checks.get(`${source}:${index}`) ?? null;
    items.push({ key: `S${items.length + 1}`, kind, actor, move, source, index, id: id ?? null, shown,
      paths: eventPaths(session, ids, root), sources: sources.filter((s) => typeof s.eventId === 'string'
        && typeof s.text === 'string' && s.text), ...(check ? { codeCheck: check } : {}) });
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
    add(ASK, PERSON, [PARTLY_DONE, NOT_DONE].includes(r.status) ? ASK_SHORT : null, 'requirements', i, null,
      { status: r.status ?? null, asked: quoteOf(r.instruction) ? as(PERSON, r.instruction) : asked,
        ...(quoteOf(r.deliverable) ? { delivered: as(PERSON, r.deliverable) } : {}),
        ...(quoteOf(r.shortfall) ? { missing: as(PERSON, r.shortfall) } : {}) }, ids([r.deliverable, r.shortfall]),
      src([r.instruction, r.deliverable, r.shortfall]));
  });
  list(report?.promises).forEach((p, i) => {
    if (!plain(p) || !quoteOf(p.stated)) return;
    add(CLAIM, AGENT, p.status === VERIFIED ? CLAIM_CONFIRMED : CLAIM_UNCONFIRMED, 'promises', i, p.id,
      { status: p.status ?? null, said: as(AGENT, p.stated) }, ids([p.stated, ...list(p.receipts)]), src([p.stated]));
  });
  list(report?.writtenClaims).forEach((w, i) => {
    if (!plain(w) || !quoteOf(w.stated)) return;
    add(CLAIM, AGENT, CLAIM_UNCONFIRMED, 'writtenClaims', i, w.id,
      { status: w.label === WRITTEN_UNVERIFIED ? 'written, unverified' : 'written, contradicted',
        said: as(AGENT, w.stated) }, ids([w.stated]), src([w.stated]));
  });
  list(report?.findings).forEach((f, i) => {
    if (!plain(f) || f.origin === 'code-review') return;
    if (f.kind === 'claim_contradicted') {
      const said = list(f.receipts).find((r) => r?.role === 'commentary');
      const against = list(f.receipts).find((r) => r?.role !== 'commentary');
      if (!quoteOf(said)) return;
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
    const ran = action ? headTail(textOf(session, action, 'command'), 300) : '';
    const output = result ? headTail(textOf(session, result, 'output')) : '';
    const outputActor = result ? actorOf(session, result.id) : AGENT;
    add(FAILURE, RECORDED_RESULT, FAILURE_PASSED_OVER, 'failures', i, null, { outcome: row.outcome ?? null,
      ...(ran ? { ran: { actor: AGENT, quote: ran } } : {}),
      ...(result ? { output: outputActor === RECORDED_RESULT ? output : { actor: outputActor, quote: output } } : {}),
      ...(quoteOf(row.response) ? { response: as(RECORDED_RESULT, row.response) } : {}) },
    [...ids([row.response]), ...(action ? [action.id] : [])],
    [...(action ? [{ eventId: action.id, role: 'action', text: ran, actor: AGENT }] : []),
      ...(result ? [{ eventId: result.id, role: 'observation', text: output, actor: outputActor }] : []),
      ...src([row.response])]);
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

/**
 * Per changed path (`paths`, as the code step names them), the commands recorded after its last recorded edit, each
 * with its exit code (or its recorded outcome when no exit code is typed), or none. Ordering only: whether a command
 * reached the file is the reviewer's to judge. Pure.
 */
export function commandsAfterLastEdit(session, paths, root = null) {
  const events = list(session?.events);
  const lastEdit = new Map();
  events.forEach((event, at) => {
    if (event?.kind !== 'invocation' || !EDITS.includes(event.operation)) return;
    for (const change of list(event.changes)) {
      const named = displayPath(change?.path, root);
      if (typeof named === 'string') lastEdit.set(named, at);
    }
  });
  return list(paths).map((path) => {
    if (!lastEdit.has(path)) return { path, after: null };
    const after = events.slice(lastEdit.get(path) + 1).filter(isCommand).map((event) => {
      const result = session.observationFor?.(event.id) ?? null;
      const exit = Number.isSafeInteger(result?.exitCode) ? result.exitCode : null;
      return { ran: headTail(textOf(session, event, 'command'), 150), ...(exit !== null ? { exit }
        : { outcome: typeof result?.result === 'string' ? result.result : 'no result recorded' }),
      ...(event.childId ? { helper: true } : {}) };
    });
    return { path, after };
  });
}

/** The dossier as a request shows it: a fixed preface, one JSON line per item, then the commands after each changed
 *  file's last edit (`never_ran` when none). `named(path)` says whether the request may name a path (an item's paths
 *  that it may not are left out). Pure. */
export function renderDossier(items, commands, { named = () => true } = {}) {
  const line = (item) => {
    const paths = item.paths.filter((path) => named(path));
    return JSON.stringify({ key: item.key, kind: item.kind, actor: item.actor,
      ...(item.move ? { move: item.move } : {}), ...item.shown, ...(paths.length ? { paths } : {}),
      ...(item.codeCheck ? { codeCheck: item.codeCheck } : {}) });
  };
  const ran = list(commands).filter((c) => c.after !== null && named(c.path)).map((c) => JSON.stringify({ path: c.path,
    ...(c.after.length ? { commandsAfterLastEdit: c.after } : { commandsAfterLastEdit: 'none', move: NEVER_RAN }) }));
  return [...(items.length ? items.map(line) : ['(the review recorded no ask, claim, decision or failure)']), '',
    '## Commands recorded after each changed file\'s last recorded edit', '',
    ...(ran.length ? ran : ['(no file was changed by a recorded edit)'])].join('\n');
}

// ---- placing the context in requests ---------------------------------------------------------------------------------

/**
 * Which files each request of step 2 shows (the budget, in bytes against the review's request bound): the
 * table of contents, the person's words, the dossier and the lens paragraph are in every request; the hunks are never
 * dropped. When every file's hunks fit one request beside them, there is one group: whole files then fill what is left
 * in fill order (`fill`: changed files first, then the files the session read), and a file that does not fit is listed
 * by name. Otherwise the change splits into file groups in table-of-contents order, each keeping a file's hunks with its
 * whole file when it fits; a file whose hunks alone are over a request is `clipped`; read files fill what is left of
 * the groups, first that has room. `costOf(path)` is a file's whole block in bytes (null: none to show), `hunkCost(path)`
 * its hunks' rows, `room` what a request has for hunks and files. `{ groups: [{ hunks: [paths], files: [paths] }],
 * listed: [paths], clipped: [paths] }`. Pure.
 */
export function placeGroups({ changed, fill, costOf, hunkCost, room }) {
  const listed = [], clipped = [];
  const allHunks = changed.reduce((sum, path) => sum + hunkCost(path), 0);
  const groups = [];
  if (allHunks <= room) groups.push({ hunks: [...changed], files: [], left: room - allHunks });
  else {
    let current = null;
    for (const path of changed) {
      const cost = hunkCost(path);
      if (cost > room) { clipped.push(path); continue; }
      if (!current || current.left < cost) { current = { hunks: [], files: [], left: room }; groups.push(current); }
      current.hunks.push(path); current.left -= cost;
      const whole = costOf(path);
      if (whole !== null && whole <= current.left) { current.files.push(path); current.left -= whole; }
    }
  }
  for (const path of fill) {
    if (groups.some((g) => g.files.includes(path))) continue;
    const whole = costOf(path);
    if (whole === null) continue;
    const own = groups.find((g) => g.hunks.includes(path));
    const target = own && own.left >= whole ? own : groups.find((g) => g.left >= whole);
    if (target) { target.files.push(path); target.left -= whole; continue; }
    if (!clipped.includes(path)) (whole > room ? clipped : listed).push(path);
  }
  return { groups: groups.map(({ hunks, files }) => ({ hunks, files })), listed, clipped };
}

/** A fixed permutation of `n` items for checking pass `pass` (1-based): pass 1 keeps the order, pass 2 reverses it,
 *  pass 3 takes every other item from the first, then the rest (Bugbot's shuffle, made deterministic). */
export function passOrder(n, pass) {
  const order = Array.from({ length: n }, (_, i) => i);
  if (pass === 2) return order.reverse();
  if (pass === 3) return [...order.filter((i) => i % 2 === 0), ...order.filter((i) => i % 2 === 1)];
  return order;
}

export { RECORDED as DIFF_RECORDED, UNRECORDED as DIFF_UNRECORDED, BASE_UNKNOWN as DIFF_BASE_UNKNOWN,
  WITHHELD as DIFF_WITHHELD, DIFF_UNREADABLE, ADDED, MODIFIED, DELETED, bytesOf };
