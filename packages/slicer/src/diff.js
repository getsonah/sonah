// Minimal diffs — the content channel's carrier.
//
// The judge never saw what a write CHANGED, only which path it touched. A skip marker slipped into
// a test, an assertion deleted, a bound loosened: invisible. Full contents will not fit the
// envelope (most Writes are over the cap), and old/new pairs are barely smaller than diffs
// because agents already send tight edits.
// What fits is the DELTA: changed lines plus one line of context, git-shaped, capped with a
// declared elision. Deterministic (line LCS, no clock, no randomness), zero dependencies.
//
// D90 (owner decision 2026-10-15, privacy is not a design constraint): a diff is rendered from the change as recorded.
// M33 R repair had it rendered from the change as redaction scrubbed it whole (redact `scrubDiffWhole`), then cut; with
// nothing masked, those are the recorded lines, and the cuts are the same: one line of context around each change, a
// Write's first 30 lines, the 900/400 head and tail budget.

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

/** Line-level minimal diff between two strings: changed lines with `ctx` lines of context. */
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

/** The diff of an Edit-shaped write (old -> new): its changed lines with one line of context, within the budget.
 *  D69 (c): no computed hunk header. */
export const editDiff = (oldText, newText) => budgetDiff(minimalDiff(oldText, newText));

/** The diff of a whole-file write: all additions, its first lines shown, within the budget. D69 (c): no names listed. */
export function createDiff(content) {
  const lines = String(content ?? '').split('\n');
  const head = lines.slice(0, CREATE_LINES).map((line) => `+${line}`);
  const rest = lines.length - head.length;
  if (rest > 0) head.push(`[… ${rest} more lines …]`);
  return budgetDiff(head.join('\n'));
}
