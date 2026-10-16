// Deterministic near-miss repair for receipt quotes (W3-3).
//
// Most rejected quotes are not fabrications. They are the same sentence with a curly quote
// straightened, a double space collapsed, an HTML entity decoded or a trailing ellipsis added —
// the recorder wrote one form and the reader typed the other. Discarding those costs real
// evidence; accepting them on faith would break C-05.
//
// So this module never decides that a quote is grounded. It only proposes ONE candidate: an
// exact substring of the original source text. The caller re-runs the strict verifier on that
// candidate, and that verification is what grounds it. If this module returns nothing, or
// returns a substring the strict check still refuses, the receipt is rejected.
//
// Determinism, by construction: pure string work, no clock, no random source, no model, no
// fuzzy matching, no edit distance, no joining across sources. Same input, same bytes out.

// Characters a recorder or a keyboard swaps for one another. `\u2026` expands to three dots
// because that is the substitution people actually type.
const CHARACTER_FOLDS = new Map([
  ['\u2018', "'"], ['\u2019', "'"], ['\u201a', "'"],
  ['\u201c', '"'], ['\u201d', '"'], ['\u201e', '"'],
  ['\u2013', '-'], ['\u2014', '-'],
  ['\u2026', '...'],
]);

// Only the five named entities. Decoding arbitrary entities would let `&#100;` stand in for a
// letter the source never contained.
const ENTITIES = Object.freeze([
  ['&amp;', '&'], ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"],
]);

const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/;
const COMBINING = /\p{M}/u;
const WHITESPACE = /\s/;

// Punctuation a model adds or drops at the edges of a quote. `\u2026` is already `...` by the
// time this runs, so `.` covers it.
const EDGE_PUNCTUATION = new Set(['.', '"', "'", '(', ')', ',', ';', ':']);

/**
 * Text the RECORDER wrote into a source: elision stubs, the ask-compression stubs and the
 * redaction trailer. A quote may never span one, because that would present the recorder's words
 * — or two sides of a hole — as one continuous thing the speaker said.
 *
 * The opening/closing fragments are matched on their own, not only as complete markers: a quote
 * that stops halfway through `[\u2026]` still carries text nobody uttered.
 *
 * D90 (owner decision 2026-10-15): an earlier redactor's inline marks (`\u2039redacted:\u2026\u203a`,
 * `\u2039dropped:\u2026\u203a`) are not matched here. No Sonah writes one now; the adapter keeps one out
 * of every quotable span where its field declares it (sonah-ledger.js `declaresRedaction`), so a
 * quote cannot span it, and anywhere else those characters are the recording's own text.
 */
const SYNTHETIC_MARKER = new RegExp([
  '\\[\u2026',                                                          // [\u2026], [\u2026 N chars elided \u2026], [\u2026 N line(s) dropped: \u2026]
  '\u2026\\]',
  '\\[(?:attachment|code block|traceback|indented block), \\d+ lines, \\d+ chars\\]',
].join('|'));

/** True when `text` carries any of the recorder's own marks. Fails closed: when in doubt, yes. */
export function spansSyntheticMarker(text) {
  return SYNTHETIC_MARKER.test(text);
}

/**
 * Build the normalized view of `text` together with the map back to the original.
 *
 * Every entry is exactly one UTF-16 code unit of the normalized text, carrying the half-open
 * `[from, to)` range of the ORIGINAL characters it came from. That is what makes the snap-back
 * exact: a match found in the normalized view is converted to original offsets and sliced out
 * of the untouched source, so the returned quote is source text, never reconstructed text.
 *
 * Order, as specified: NFC, character folds, entity decode, zero-width removal, whitespace
 * collapse, trim.
 */
export function normalizeWithMap(text) {
  const source = String(text ?? '');
  const units = [];

  // Fold and record. One entry per code unit, so an index into the joined string is an index
  // into this array — surrogate pairs included.
  const emit = (produced, from, to) => {
    for (const codePoint of produced) {
      if (ZERO_WIDTH.test(codePoint)) continue;
      const folded = CHARACTER_FOLDS.get(codePoint) ?? codePoint;
      for (let k = 0; k < folded.length; k++) units.push({ ch: folded[k], from, to });
    }
  };

  let i = 0;
  while (i < source.length) {
    const entity = ENTITIES.find(([raw]) => source.startsWith(raw, i));
    if (entity) {
      emit(entity[1], i, i + entity[0].length);
      i += entity[0].length;
      continue;
    }
    // One code point plus any combining marks that follow it: NFC may compose them into a
    // single character, and the whole cluster must map back to the whole original span.
    let j = i + String.fromCodePoint(source.codePointAt(i)).length;
    while (j < source.length) {
      const next = String.fromCodePoint(source.codePointAt(j));
      if (!COMBINING.test(next)) break;
      j += next.length;
    }
    emit(source.slice(i, j).normalize('NFC'), i, j);
    i = j;
  }

  // Collapse each whitespace run to one space that spans the WHOLE run, so a match across it
  // maps back to the original spacing rather than to a single space the source never had.
  const collapsed = [];
  for (let k = 0; k < units.length; k++) {
    if (!WHITESPACE.test(units[k].ch)) { collapsed.push(units[k]); continue; }
    const from = units[k].from;
    let to = units[k].to;
    while (k + 1 < units.length && WHITESPACE.test(units[k + 1].ch)) { k += 1; to = units[k].to; }
    collapsed.push({ ch: ' ', from, to });
  }

  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start].ch === ' ') start += 1;
  while (end > start && collapsed[end - 1].ch === ' ') end -= 1;
  const kept = collapsed.slice(start, end);

  return { text: kept.map((u) => u.ch).join(''), units: kept };
}

function stripEdgePunctuation(text) {
  const strippable = (ch) => EDGE_PUNCTUATION.has(ch) || ch === ' ';
  let start = 0;
  let end = text.length;
  while (start < end && strippable(text[start])) start += 1;
  while (end > start && strippable(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

/**
 * The candidates to search for, in the order the spec fixes. Nothing beyond these: no fuzzy
 * variants, no reordering, no substitution inside a word.
 *
 * Dropping a word is only allowed while six words remain, because a short quote is not
 * distinctive enough to survive losing a third of itself — that is how a fabricated quote with
 * a few real words in it would slip through.
 */
function quoteVariants(normalized, minChars) {
  const variants = [];
  const add = (candidate) => {
    // The same floor the strict verifier applies, so a variant that could never ground is
    // never even searched for.
    const trimmed = candidate.trim();
    if (trimmed.length >= minChars && !variants.includes(trimmed)) variants.push(trimmed);
  };

  add(normalized);                                   // a. as written
  const stripped = stripEdgePunctuation(normalized); // b. without the edge punctuation
  add(stripped);

  const words = stripped.split(' ').filter(Boolean);  // c. minus one leading or trailing word
  if (words.length - 1 >= 6) {
    add(words.slice(1).join(' '));
    add(words.slice(0, -1).join(' '));
  }
  return variants;
}

/**
 * A near-miss quote must not be "repaired" by dropping its edge word when the original quote
 * actually crossed a withheld interval. The caller supplies groups of spans from ONE field,
 * each group split where TextRefs stopped touching. A virtual join is used only to detect and
 * reject a crossing, never as a source from which to return a quote. Normalization uses the same
 * source-offset map as repair, so curly punctuation, entities and UTF-8 text cannot hide a seam.
 * If the same candidate also occurs cleanly elsewhere, rejection is the conservative choice.
 */
function crossesDisjointBoundary(disjointGroups, variants) {
  for (const group of disjointGroups) {
    if (!Array.isArray(group) || group.length < 2 || group.some((s) => typeof s !== 'string')) continue;
    // The recorder may remove a marker between words that were adjacent, or the model may add
    // one space where the removed material was. Neither apparent join licenses edge-word repair.
    for (const separator of ['', ' ']) {
      const seams = [];
      let offset = 0;
      for (const span of group.slice(0, -1)) {
        offset += span.length;
        seams.push({ from: offset, to: offset + separator.length });
        offset += separator.length;
      }
      const view = normalizeWithMap(group.join(separator));
      for (const candidate of variants) {
        for (let at = view.text.indexOf(candidate); at >= 0; at = view.text.indexOf(candidate, at + 1)) {
          const from = view.units[at].from;
          const to = view.units[at + candidate.length - 1].to;
          if (seams.some((seam) => from < seam.from && seam.to < to)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Snap `quote` to an exact substring of ONE of `sourceTexts`, or return null.
 *
 * The search runs candidate-first: the least-altered form of the quote is tried against every
 * source before a more aggressive one is tried anywhere, so a quote that matches as written is
 * never traded for a word-dropped match somewhere else.
 *
 * The first form that matches ANYWHERE decides, and it is tried against every occurrence in
 * every source (F78). An occurrence that spans the recorder's own words is discarded, never
 * accepted — but it no longer ends the search before a later source is read: the old loop
 * returned null on a marker in the first source while the second held the one clean span. What
 * remains must be exactly one exact span in exactly one source. Two sources that both match
 * cleanly are ambiguous — which one the quote meant is a guess, and a guess is not a receipt —
 * so that is rejected, as is a form that matched only across markers. A matched form never falls
 * through to a more aggressive one: that would be hunting for a luckier match.
 */
export function repairQuote(sourceTexts, quote, minChars, { disjointGroups = [] } = {}) {
  const views = sourceTexts.map((text) => ({ text, view: normalizeWithMap(text) }));
  const normalized = normalizeWithMap(quote).text;
  if (!normalized) return null;

  const variants = quoteVariants(normalized, minChars);
  if (crossesDisjointBoundary(disjointGroups, variants)) return null;

  for (const candidate of variants) {
    let matched = false;
    const clean = new Map();   // source index -> the distinct exact spans found there
    views.forEach(({ text, view }, index) => {
      for (let at = view.text.indexOf(candidate); at >= 0; at = view.text.indexOf(candidate, at + 1)) {
        matched = true;
        const exact = text.slice(view.units[at].from, view.units[at + candidate.length - 1].to);
        if (!exact || spansSyntheticMarker(exact)) continue;
        if (!clean.has(index)) clean.set(index, new Set());
        clean.get(index).add(exact);
      }
    });
    if (!matched) continue;
    if (clean.size !== 1) return null;
    const [spans] = clean.values();
    if (spans.size !== 1) return null;
    const [exact] = spans;
    // The W3-3 invariant, checked on the result rather than assumed: one source holds it.
    return sourceTexts.filter((text) => text.includes(exact)).length === 1 ? exact : null;
  }
  return null;
}

// ---- F77: what the reader is shown ------------------------------------------------------

// Fields only code may write onto a published receipt. A model reply is JSON and can carry any
// of them, so each is removed from a receipt that repair did not touch. M33 (G3): `eventRepaired`
// and `eventRepairedFrom` are the marks of a vote receipt code moved from an action's id to its one
// supplied result (run-review.js `resultReceiptRepair`).
const REPAIR_FIELDS = Object.freeze(['repaired', 'original', 'repairedFrom', 'eventRepaired', 'eventRepairedFrom']);

/** `receipt` without any repair field, when it is a plain object; anything else untouched. */
export function withoutRepairFields(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return receipt;
  return Object.fromEntries(Object.entries(receipt).filter(([key]) => !REPAIR_FIELDS.includes(key)));
}

/**
 * The receipt a reader receives, from one `ok` result of `repairReceipt`. A quote that repair
 * snapped carries `repaired: true` and the model's `original` beside the exact `quote` (the
 * renderer marks it; it never shows `original` as evidence). Every other receipt carries none of
 * the repair fields, whatever the model put there — the flag is code's statement, not the model's.
 */
export function publishedReceipt(result) {
  if (result?.repaired === true)
    return { ...withoutRepairFields(result.receipt), repairedFrom: result.original,
      repaired: true, original: result.original };
  return withoutRepairFields(result?.receipt);
}
