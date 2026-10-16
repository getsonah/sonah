// Counting the words of one sentence the way Simplified Technical English counts them (D97: "STE at about 80%", its rule
// of at most 20 words a sentence). Form only: which characters group into one counted word, never what a word means.
// Two readers use it: the code step's check of a triage label (code-pass.js, at most TRIAGE_LIMITS.labelWords words)
// and the style linter of Sonah's own fixed sentences (render/test/style-lint.js).
//
// Pure and deterministic: no disk, network, clock or random source.

/** The one mark a counted group becomes before the whitespace split: a letter, so it counts as one word whatever it
 *  held, and joins the word it touches (`item(s)` is one word). */
const GROUP = 'W';
/** A token counts as a word when it holds a letter or a digit (a lone `·`, `—` or `&` is no word). */
const WORDY = /[\p{L}\p{N}]/u;

/** `text` with each inline code span (a run of backticks, up to the next run of the same length) made one group; an
 *  opening run with no closing run of its length is left as it is. */
function codeSpansGrouped(text) {
  let out = '';
  let at = 0;
  while (at < text.length) {
    if (text[at] !== '`') { out += text[at]; at++; continue; }
    let run = 0;
    while (text[at + run] === '`') run++;
    const fence = '`'.repeat(run);
    let close = text.indexOf(fence, at + run);
    // The closing run must be exactly as long: a longer run of backticks is not this span's end.
    while (close !== -1 && text[close + run] === '`') {
      let longer = run;
      while (text[close + longer] === '`') longer++;
      close = text.indexOf(fence, close + longer);
    }
    if (close === -1) { out += fence; at += run; continue; }
    out += GROUP;
    at = close + run;
  }
  return out;
}

/** `text` with each balanced pair of `open` and `close` (outermost, nested pairs inside it) made one group; an
 *  unbalanced mark is left as it is. */
function pairsGrouped(text, open, close) {
  let out = '';
  let depth = 0;
  let start = -1;
  for (let at = 0; at < text.length; at++) {
    const c = text[at];
    if (c === open) {
      if (depth === 0) start = at;
      depth++;
      continue;
    }
    if (c === close && depth > 0) {
      depth--;
      if (depth === 0) out += GROUP;
      continue;
    }
    if (depth === 0) out += c;
  }
  // An opening mark never closed: what followed it is counted as it stands.
  return depth > 0 ? out + text.slice(start) : out;
}

/**
 * The number of words in `text` by STE counting: text in parentheses is one word; a hyphenated word is one word; an
 * inline code span, a placeholder in braces (`{n}`), a path, a `file:line`, a URL and a number are one word each (the
 * last four hold no space, so they are one token anyway). Every other run of characters between spaces is one word
 * when it holds a letter or a digit. Not a string: 0. Pure.
 */
export function steWordCount(text) {
  if (typeof text !== 'string') return 0;
  const grouped = pairsGrouped(pairsGrouped(codeSpansGrouped(text), '(', ')'), '{', '}');
  return grouped.split(/\s+/u).filter((token) => WORDY.test(token)).length;
}
