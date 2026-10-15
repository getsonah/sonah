// Keeping a human turn whole.
//
// The spec said "every user turn, verbatim". That made `ask` most of the sliced payload, and one
// ask block can run to megabytes; M33 R cut a turn over a transport
// budget in its middle, declared. The windowing spec (2026-10-06) keeps every human message in full.
//
// M6 (C-02 "M6 the human turn whole"). This module used to tell INSTRUCTION
// text from PASTED MATERIAL by shape — a code fence, a traceback, a run of indented lines or an attachment
// element of 1,200 characters or more became a stub the model never saw. Shape stood in for meaning: a spec,
// an interface or acceptance criteria pasted in a fence lost its requirements, and a shorter paste of the
// same kind survived. Now every turn is kept whole (runs of blank lines folded, the turn trimmed, as it
// always was) and the model decides, under grounding, whether what was pasted states a requirement.
//
// Windowing (owner-confirmed spec 2026-10-06; C-02 "M35 the human message in
// full"): a human message is kept IN FULL. The 20,000-code-point transport budget M33 R declared here is gone, and no
// human turn is declared over any budget. Only a file the human attached keeps a budget — redaction's `ATTACHED_CAP`,
// 2k tokens, head and tail — and, as M33 R made it, the cut is declared here and made by redaction after it scrubbed the
// whole text (a cut made here, before redaction, handed the redactor half a token).

import { ASK_MIDDLE } from '../../redact/index.js';

/**
 * @param {string} text  raw user turn
 * @param {{chars: number, head: number, tail: number}|null} cap  an attached file's budget (`ATTACHED_CAP`); none for a
 *   human message
 * @returns {{text: string, elided: Array<{what: string, chars: number}>}} the turn, whole — its runs of blank lines
 *   folded and the turn trimmed, as it always was — and, for an attached file over its budget only, the one cut due on
 *   it: its middle (made by redaction, after it has scrubbed the text whole).
 */
export function compressAsk(text, cap = null) {
  const kept = String(text ?? '').replace(/\n{3,}/g, '\n\n').trim();
  const elided = [];
  if (cap !== null && kept.length > cap.chars) elided.push({ what: ASK_MIDDLE, chars: kept.length - cap.head - cap.tail });
  return { text: kept, elided };
}
