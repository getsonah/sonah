// graph-text.mjs: text measured with fixed font tables, so boxes are sized from their text the same way on any machine.
// No clock, random, network or model.

// ---------- text measure ----------
// Advance widths in hundredths of an em for ASCII 32..126: the larger of Overpass and the fallback sans at each
// character, so text fits whichever font the browser ends up using. Bold covers weights 600 to 800.
const SANS = Object.freeze([28, 28, 41, 68, 59, 89, 68, 25, 35, 35, 53, 65, 28, 40, 28, 49, 64, 56, 61, 60, 62, 62, 60, 56,
  61, 60, 28, 28, 65, 65, 65, 56, 102, 68, 67, 72, 72, 67, 61, 78, 72, 28, 55, 67, 56, 83, 72, 78, 67, 78, 72, 67, 61, 72,
  67, 94, 67, 67, 65, 38, 49, 38, 65, 56, 33, 56, 56, 50, 56, 56, 33, 56, 56, 25, 26, 53, 26, 85, 56, 56, 57, 56, 39, 50,
  38, 56, 51, 72, 53, 53, 51, 37, 28, 37, 65]);
const SANS_BOLD = Object.freeze([28, 33, 47, 71, 61, 89, 72, 26, 38, 38, 56, 64, 28, 42, 28, 53, 66, 56, 61, 60, 65, 61,
  62, 56, 63, 62, 33, 33, 64, 64, 64, 61, 98, 73, 72, 72, 72, 67, 61, 78, 73, 30, 56, 72, 61, 83, 72, 78, 67, 78, 72, 67,
  61, 72, 69, 94, 70, 70, 64, 40, 53, 40, 64, 56, 33, 57, 61, 56, 61, 56, 37, 61, 61, 29, 29, 57, 30, 89, 61, 61, 61, 61,
  43, 56, 40, 61, 57, 78, 60, 58, 56, 39, 31, 39, 64]);
const MONO_EM = 0.62; // Overpass Mono, and wider than its fallbacks
const OTHER_EM = 0.62; // any other character
const WIDE_EM = 1.0; // CJK and pictographs

const isWide = (c) => (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
  || (c >= 0xff00 && c <= 0xff60) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd);

// Width of `text` at `size` units. face: 'sans' | 'mono'.
export function textWidth(text, size, face = 'sans', bold = false) {
  const table = bold ? SANS_BOLD : SANS;
  let em = 0;
  for (const ch of String(text ?? '')) {
    const c = ch.codePointAt(0);
    if (isWide(c)) em += face === 'mono' ? 2 * MONO_EM : WIDE_EM;
    else if (face === 'mono') em += MONO_EM;
    else if (c >= 32 && c <= 126) em += table[c - 32] / 100;
    else em += OTHER_EM;
  }
  return em * size;
}

// Cut a text to fit `maxW`, ending in an ellipsis.
export function fitText(text, maxW, size, face = 'sans', bold = false) {
  const s = String(text ?? '');
  if (textWidth(s, size, face, bold) <= maxW) return s;
  const chars = [...s];
  let lo = 0, hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (textWidth(chars.slice(0, mid).join('') + '…', size, face, bold) <= maxW) lo = mid; else hi = mid - 1;
  }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

// Break one word wider than maxW: at case humps and punctuation first, then by characters.
function breakWord(word, maxW, size, face, bold) {
  const tokens = word.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_./\\:\-])/).filter(Boolean);
  const out = [];
  let cur = '';
  const push = (t) => {
    if (textWidth(t, size, face, bold) <= maxW) { out.push(t); return; }
    let piece = '';
    for (const ch of t) {
      if (piece && textWidth(piece + ch, size, face, bold) > maxW) { out.push(piece); piece = ''; }
      piece += ch;
    }
    if (piece) out.push(piece);
  };
  for (const t of tokens) {
    if (!cur) { cur = t; continue; }
    if (textWidth(cur + t, size, face, bold) <= maxW) cur += t;
    else { push(cur); cur = t; }
  }
  if (cur) push(cur);
  return out;
}

// Greedy line wrap. At most maxLines lines; the last one ends in an ellipsis when text is left over.
export function wrapText(text, maxW, size, face = 'sans', bold = false, maxLines = 3) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const pieces = words.flatMap((w) => (textWidth(w, size, face, bold) > maxW ? breakWord(w, maxW, size, face, bold) : [w]));
  const lines = [];
  let cur = '';
  // pieces of one broken word join without a space
  let joinNext = new Set();
  {
    let at = 0;
    for (const w of words) {
      const n = textWidth(w, size, face, bold) > maxW ? breakWord(w, maxW, size, face, bold).length : 1;
      for (let k = 1; k < n; k++) joinNext.add(at + k);
      at += n;
    }
  }
  pieces.forEach((p, i) => {
    const glue = joinNext.has(i) ? '' : ' ';
    if (!cur) { cur = p; return; }
    if (textWidth(cur + glue + p, size, face, bold) <= maxW) cur += glue + p;
    else { lines.push(cur); cur = p; }
  });
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = fitText(`${kept[maxLines - 1]} ${lines[maxLines]}`, maxW, size, face, bold);
  if (!kept[maxLines - 1].endsWith('…')) kept[maxLines - 1] = fitText(`${kept[maxLines - 1]}…`, maxW, size, face, bold);
  return kept;
}
