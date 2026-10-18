// An ask's status never contradicts Sonah's own findings (D87, amended). The session review gives each ask its
// status, and the release guards read that token, so it stays the session review's. What the code step tied
// to an ask — a published finding, a withheld one, an open question, the row's own code check — is joined beside the
// status as `codeLinks` (ledger.js ASK_CODE_LINKS) on a copy of the ask's row, so every reader can show it with the
// status and place the ask by it (review.js `askRowKind`): never hidden behind "done" or a fold, and never ruling on
// the conflict.
//
// A link is read from structure only: the dossier keys a finding says it follows from, the rows a question or a
// withheld finding names, the row's code check, and where a trace step's quote of the person's words sits in the ask's
// own instruction (string search over the recorded text, the rule "Cited in" uses). No word of a finding, a question or
// an ask is read to decide anything.
//
// Pure and deterministic: no disk, network, clock or random source. It reads the report the code step joined (both the
// code step's report shapes: findings with `leadsFrom` and `trace`, `withheld` entries with `leadsFrom` refs, questions
// with `concerns`; an earlier report with no `withheld` simply has no such links) and the loaded session the trace
// quotes are grounded in. A row's code check links it only when it contradicts the row.

import { ASK_CODE_LINKS, CODE_CHECK_OUTCOMES } from './ledger.js';
import { verifyReceipt } from './session.js';
import { codePassFindings, codePassUnconfirmed, codeRowCheck } from './code-pass.js';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const [LEADS_FROM, TRACE_QUOTES_ASK, CONTRADICTED_BY_CODE, WITHHELD_FINDING, QUESTION_CONCERNS, UNCONFIRMED_FINDING] =
  ASK_CODE_LINKS;
const [CONTRADICTED] = CODE_CHECK_OUTCOMES;
const ASK_SOURCE = 'requirements';
const INSTRUCTION_ROLE = 'instruction';
/** What the code step withholds that may name an ask: a finding (its `what`, as the code step's report writes it). */
const WITHHELD_FINDING_WHAT = 'finding';

/**
 * Where a grounded instruction quote sits in its instruction, as `{ span, from, until }` without the whitespace at
 * its ends: its place in the one uninterrupted text span of the instruction that holds it (a quote that grounds is
 * in one of them). A quote found at more than one place is not located: its words do not say which place it cites.
 * (Moved here from the story, which reads it from here, so the evidence package never imports a reader.)
 */
export function locateQuote(instruction, spans) {
  // D71 (S2): code's own row for a message no row cited quotes nothing (`ask_unreviewed`): it is never located.
  if (typeof instruction?.quote !== 'string' || !instruction.quote) return null;
  let at = null;
  for (let span = 0; span < spans.length; span++) {
    const from = spans[span].indexOf(instruction.quote);
    if (from === -1) continue;
    if (at || spans[span].indexOf(instruction.quote, from + 1) !== -1) return null;
    at = { span, from, until: from + instruction.quote.length };
  }
  if (!at) return null;
  const text = spans[at.span];
  while (at.from < at.until && /\s/.test(text[at.from])) at.from++;
  while (at.until > at.from && /\s/.test(text[at.until - 1])) at.until--;
  return at.from < at.until ? at : null;
}
/** How many characters two located quotes of one span share (0 or less when none). As quotes are located without
 *  the whitespace at their ends, any shared character run holds a word character. */
export const sharedChars = (a, b) => Math.min(a.until, b.until) - Math.max(a.from, b.from);
/** Whether two located quotes overlap by at least half of the shorter one. */
export const overlapping = (a, b) => 2 * sharedChars(a, b) >= Math.min(a.until - a.from, b.until - b.from);

/** Whether a ref (a finding's `leadsFrom` entry, a question's `concerns`) names the ask row at `index`. */
const namesAsk = (ref, index) => plain(ref) && ref.source === ASK_SOURCE && ref.index === index;

/**
 * Where an instruction receipt (`{ eventId, role: 'instruction', quote }`) sits in its event's recorded text, or null:
 * only when it grounds there word for word (session.js `verifyReceipt`) and is found at one place (`locateQuote`).
 * `cache` holds each event's text spans.
 */
function placed(session, receipt, cache) {
  if (!plain(receipt) || receipt.role !== INSTRUCTION_ROLE || typeof receipt.eventId !== 'string'
    || typeof receipt.quote !== 'string' || !receipt.quote) return null;
  try {
    const event = session.event(receipt.eventId);
    if (!event || !verifyReceipt(session, { eventId: receipt.eventId, role: INSTRUCTION_ROLE, quote: receipt.quote }).ok)
      return null;
    if (!cache.has(receipt.eventId)) cache.set(receipt.eventId, session.textSpansOf(event, 'text'));
    return locateQuote(receipt, cache.get(receipt.eventId));
  } catch { return null; }
}

/**
 * The links between each ask row of `report` (its `requirements`, by index) and what the code step joined to it
 * (`report.codePass`), as one list per row, in ASK_CODE_LINKS order and, within a link, in the order the report holds
 * the items:
 *   { link: 'leads_from' | 'trace_quotes_ask', finding: <the published finding's id> }
 *   { link: 'contradicted_by_code', finding?: <id> }   (the finding the code check names, when it names a published one)
 *   { link: 'withheld_finding', withheld: <index in codePass.withheld> }
 *   { link: 'question_concerns', question: <index in codePass.questions> }
 *   { link: 'unconfirmed_finding', unconfirmed: <the id of a finding Sonah could not confirm> }   (D110)
 * The published findings are those code's label confirms, and the findings to verify those it does not, each computed
 * again from its stored check (code-pass.js `codePassFindings`, `codePassUnconfirmed`): a finding to verify links an
 * ask by its `leadsFrom` alone, and never as an attention link. `trace_quotes_ask` needs `session` (the loaded
 * recording the quotes ground in); with none, that link is never made.
 * A row that is not an object, or that the code step joined nothing to, gets an empty list. Pure.
 */
export function askCodeLinks(report, session = null) {
  const pass = plain(report?.codePass) ? report.codePass : null;
  const findings = codePassFindings(report).filter((f) => typeof f.id === 'string');
  const unconfirmed = codePassUnconfirmed(report).filter((f) => typeof f.id === 'string');
  const ids = new Set(findings.map((f) => f.id));
  const withheld = list(pass?.withheld);
  const questions = list(pass?.questions);
  const cache = new Map();
  const where = (receipt) => (session && typeof session.event === 'function' ? placed(session, receipt, cache) : null);
  return list(report?.requirements).map((row, index) => {
    if (!plain(row)) return [];
    const links = [];
    for (const f of findings)
      if (list(f.leadsFrom).some((ref) => namesAsk(ref, index))) links.push({ link: LEADS_FROM, finding: f.id });
    const ask = plain(row.instruction) && row.instruction.role === INSTRUCTION_ROLE ? where(row.instruction) : null;
    if (ask) {
      for (const f of findings) {
        const quoting = list(f.trace).some((step) => plain(step) && step.source === 'session'
          && step.eventId === row.instruction.eventId && (() => {
            const at = where(step);
            return at !== null && at.span === ask.span && overlapping(at, ask);
          })());
        if (quoting) links.push({ link: TRACE_QUOTES_ASK, finding: f.id });
      }
    }
    // D110's review: the row's check as every reader reads it (a contradiction stands only beside a checked finding).
    const check = codeRowCheck(report, row);
    if (check?.outcome === CONTRADICTED)
      links.push({ link: CONTRADICTED_BY_CODE, ...(ids.has(check.finding) ? { finding: check.finding } : {}) });
    withheld.forEach((w, k) => {
      if (plain(w) && w.what === WITHHELD_FINDING_WHAT && list(w.leadsFrom).some((ref) => namesAsk(ref, index)))
        links.push({ link: WITHHELD_FINDING, withheld: k });
    });
    questions.forEach((q, k) => {
      if (plain(q) && typeof q.question === 'string' && namesAsk(q.concerns, index)) links.push({ link: QUESTION_CONCERNS, question: k });
    });
    for (const f of unconfirmed)
      if (list(f.leadsFrom).some((ref) => namesAsk(ref, index))) links.push({ link: UNCONFIRMED_FINDING, unconfirmed: f.id });
    return links;
  });
}

/**
 * The report with each ask row's links joined (`askCodeLinks`): a row with any link is a copy of itself carrying them as
 * `codeLinks`; a row with none is left as it was (a `codeLinks` an earlier join wrote is dropped). No other field of any
 * row, and no other member of the report, is read for anything else or changed: the status, the receipts, the reason and
 * the facts stay the session review's. Pure.
 */
export function withAskCodeLinks(report, session = null) {
  if (!plain(report) || !Array.isArray(report.requirements)) return report;
  const links = askCodeLinks(report, session);
  return { ...report, requirements: report.requirements.map((row, index) => {
    if (!plain(row)) return row;
    if (links[index].length) return { ...row, codeLinks: links[index] };
    if (!Object.hasOwn(row, 'codeLinks')) return row;
    const { codeLinks: _earlier, ...rest } = row;
    return rest;
  }) };
}
