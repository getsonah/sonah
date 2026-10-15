// Minimal diffs — the content channel's carrier.
//
// The judge never saw what a write CHANGED, only which path it touched. A skip marker slipped into
// a test, an assertion deleted, a bound loosened: invisible. Full contents will not fit the
// envelope (most Writes are over the cap), and old/new pairs are barely smaller than diffs
// because agents already send tight edits.
// What fits is the DELTA: changed lines plus one line of context, git-shaped, capped with a
// declared elision. Deterministic (line LCS, no clock, no randomness), zero dependencies.
//
// M33 R repair: every cut of a change is made AFTER redaction has scrubbed the whole change. A diff
// used to be rendered from the raw texts and cut there — one line of context around each change, a
// Write's first 30 lines, the 900/400 head and tail budget — and redaction saw only the lines left.
// When a cut took away the line that makes the lines below it secret (a YAML block's `signing_key: |`,
// a PEM block's BEGIN line, the first line of a continued one), those lines reached the ledger
// verbatim while the same lines were masked in the write's own text. Now `editChange` and
// `createChange` hand the WHOLE change, as diff lines, to redaction (redact/index.js
// `scrubDiffWhole`: the diff channel's own rules), render the diff from the lines it returns, and only
// then cut: which lines a diff shows is still decided by the raw change (a masked secret that changed
// is still shown changing), but what each shown line holds is what redaction left of it. A line it
// dropped is not shown and is counted in its note; what it declared over the lines shown is carried
// to redaction, which declares it (`diffRedaction`). A change with nothing to redact renders exactly
// the bytes it always did.

import { scrubDiffWhole, diffDropNotes } from '../../redact/index.js';

export const DIFF_BUDGET = 1_400;           // chars per event, head/tail split below
const HEAD = 900;
const TAIL = 400;
const LCS_CEILING = 250_000;               // n*m guard; beyond it, fall back to marked head/tail
const FALLBACK_LINES = 12;                 // per side, past the LCS ceiling
const CREATE_LINES = 30;                   // a whole-file write's head

// D69 (c) (owner decision 2026-10-08): the programming-language keyword list that named a hunk by its "enclosing
// definition" (`DEF_LINE`, `hunkHeader`) and a whole-file write by the names it "defines" (`definedNames`, `@@ defines:
// … @@`) are deleted: a list fitted to the languages seen, deciding from a line's words what it is. A change is its
// changed lines with their context; a header the recorder wrote (a hunk's own `@@ -a,b +c,d @@` line numbers,
// recorded.js) is kept where it carries them.

/** The line-level edit script between two texts' lines, `[marker, line, oldIndex]` per op (oldIndex -1 for an added
 *  line), or null past the LCS ceiling. */
function editScript(A, B) {
  if (A.length * B.length > LCS_CEILING) return null;
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i], i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push(['-', A[i], i]); i++; }
    else { ops.push(['+', B[j], -1]); j++; }
  }
  while (i < n) { ops.push(['-', A[i], i]); i++; }
  while (j < m) ops.push(['+', B[j++], -1]);
  return ops;
}

/** The ops a minimal diff shows, in order: every changed op and `ctx` ops either side of it. */
function windowOf(ops, ctx) {
  const keep = new Uint8Array(ops.length);
  ops.forEach((o, k) => {
    if (o[0] !== ' ') for (let d = Math.max(0, k - ctx); d <= Math.min(ops.length - 1, k + ctx); d++) keep[d] = 1;
  });
  const shown = [];
  keep.forEach((on, k) => { if (on) shown.push(k); });
  return shown;
}

/** The lines of the `shown` ops, `…` between ops that were not adjacent; `line(k)` null shows nothing for op k. */
function render(shown, line) {
  const out = [];
  let last = -2;
  for (const k of shown) {
    const text = line(k);
    if (text !== null) {
      if (k !== last + 1 && out.length) out.push('…');
      out.push(text);
    }
    last = k;
  }
  return out;
}

/** Past the LCS ceiling: each side's first lines as removed and added, and how many of each are not shown. */
function fallback(A, B, line) {
  const head = (side, from, count) => Array.from({ length: Math.min(FALLBACK_LINES, count) }, (_, k) => line(side, from + k))
    .filter((text) => text !== null);
  return [...head('-', 0, A.length), `[… ${Math.max(0, A.length - FALLBACK_LINES)} old lines elided …]`,
    ...head('+', A.length, B.length), `[… ${Math.max(0, B.length - FALLBACK_LINES)} new lines elided …]`];
}

/** Line-level minimal diff between two strings: changed lines with `ctx` lines of context. Of the RAW texts: the
 *  slicer never emits it (`editChange` renders the same lines from the change as redaction scrubbed it whole). */
export function minimalDiff(oldText, newText, { ctx = 1 } = {}) {
  const A = String(oldText ?? '').split('\n');
  const B = String(newText ?? '').split('\n');
  const ops = editScript(A, B);
  if (!ops) return fallback(A, B, (side, k) => `${side}${k < A.length ? A[k] : B[k - A.length]}`).join('\n');
  return render(windowOf(ops, ctx), (k) => ops[k][0] + ops[k][1]).join('\n');
}

/** Cap a diff to the budget with a declared head/tail elision. */
export function budgetDiff(diff, budget = DIFF_BUDGET) {
  const s = String(diff ?? '');
  if (s.length <= budget) return s;
  const lines = s.split('\n');
  const head = [];
  let used = 0;
  for (const l of lines) { if (used + l.length + 1 > HEAD) break; head.push(l); used += l.length + 1; }
  const tail = [];
  used = 0;
  for (let k = lines.length - 1; k >= head.length; k--) { const l = lines[k]; if (used + l.length + 1 > TAIL) break; tail.unshift(l); used += l.length + 1; }
  const elided = lines.length - head.length - tail.length;
  return [...head, `[… ${Math.max(0, elided)} diff lines elided …]`, ...tail].join('\n');
}

/**
 * What a change's diff carries once it is rendered from `whole` (`scrubDiffWhole` of every line of the change): the
 * text, then a note for each line redaction dropped among the `shown` ones; and what redaction declared over them —
 * `reasons`, and `lost` when it dropped one.
 */
function settled(text, whole, shown) {
  const on = new Set(shown);
  const drops = shown.filter((k) => whole.lines[k] === null && whole.drops[k] !== null).map((k) => whole.drops[k]);
  const notes = diffDropNotes(drops);
  const reasons = whole.groups.filter((g) => g.at.some((k) => on.has(k))).flatMap((g) => g.reasons);
  const diff = notes.length ? [...(text === '' ? [] : [text]), ...notes].join('\n') : text;
  return { diff, reasons, lost: drops.length > 0 };
}

/**
 * The diff for an Edit-shaped write (old -> new): `{ diff, reasons, lost }`. M33 R repair: rendered from the whole change
 * as redaction scrubbed it (`scrubDiffWhole`), and only then cut. D69 (c): no computed hunk header. D84: `mask: false`
 * (a session review's load) renders it from the change as recorded; the cut is the same.
 */
export function editChange(oldText, newText, { mask = true } = {}) {
  const A = String(oldText ?? '').split('\n');
  const B = String(newText ?? '').split('\n');
  const ops = editScript(A, B);
  const whole = scrubDiffWhole(ops ? ops.map(([marker, line]) => marker + line)
    : [...A.map((line) => `-${line}`), ...B.map((line) => `+${line}`)], { mask });
  const at = (k) => whole.lines[k];
  let shown;
  let body;
  if (ops) {
    shown = windowOf(ops, 1);
    body = render(shown, at).join('\n');
  } else {
    const side = (from, count) => Array.from({ length: Math.min(FALLBACK_LINES, count) }, (_, k) => from + k);
    shown = [...side(0, A.length), ...side(A.length, B.length)];
    body = fallback(A, B, (_, k) => at(k)).join('\n');
  }
  return settled(budgetDiff(body), whole, shown);
}

/** The diff for a whole-file write: all additions, head shown — `{ diff, reasons, lost }`. M33 R repair: rendered from
 *  the whole body as redaction scrubbed it (`scrubDiffWhole`), and only then cut to its head. D69 (c): no names listed.
 *  D84: `mask: false` renders it from the body as recorded. */
export function createChange(content, { mask = true } = {}) {
  const lines = String(content ?? '').split('\n');
  const whole = scrubDiffWhole(lines.map((line) => `+${line}`), { mask });
  const shown = Array.from({ length: Math.min(CREATE_LINES, lines.length) }, (_, k) => k);
  const head = shown.map((k) => whole.lines[k]).filter((line) => line !== null);
  const rest = lines.length - shown.length;
  const parts = [...head];
  if (rest > 0) parts.push(`[… ${rest} more lines …]`);
  return settled(budgetDiff(parts.join('\n')), whole, shown);
}

/** The diff text of an Edit-shaped write (`editChange`). */
export const editDiff = (oldText, newText) => editChange(oldText, newText).diff;
/** The diff text of a whole-file write (`createChange`). */
export const createDiff = (content) => createChange(content).diff;
