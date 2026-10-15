// Status fact (owner decision 2026-10-06: "unproven" is not a terminal state; C-02, C-05).
//
// A command line's exit status is the status of its LAST command (H1, slicer events.js `exitStatusGap`). When a zero
// status does not speak for every command of the line — a pipeline, a `;` sequence, a `||` list, … — the record still
// proves one fact: the line's last command finished with a zero status. The canonical observation carries it
// (adapters/sonah-ledger.js: `lastStatus`, `coversAll`, `statusGap`), and every request that shows that observation
// states it in ONE fixed sentence, outside any fence, built only from this file's closed word tables — never from text a
// model or a recording wrote. Whether the earlier commands passed is then shown only by the result's own output, quoted
// verbatim: a support or a contradiction citing such a result is admissible only through a quote of that output
// (run-review.js `bindingsFor`, challenge.js `result_unquoted`).
//
// Pure: no model, network, clock or random source.

/** The label the sentence is shown under, beneath a RESULT's header line (prompt.js). */
export const STATUS_FACT_LABEL = 'status:';

/** How the line's last status is typed: an exit code 0, or (no exit code) the harness's typed completion verdict. */
const LEADS = Object.freeze({
  exit: 'This command line exited 0',
  verdict: 'This command line finished with a zero status (the harness\'s typed verdict; no exit code was recorded)',
});

/** Why that status does not cover every command of the line — one entry per slicer EXIT_STATUS_GAPS reason (closed). */
export const STATUS_GAP_WORDS = Object.freeze({
  pipeline: 'that is the status of the last command of its pipeline and does not cover the earlier commands of the '
    + 'pipeline (pipeline)',
  sequence: 'that is the status of its last command and does not cover the commands before a ; or a newline (sequence)',
  or_list: 'that is the status of whichever side of || ran last and does not cover a command that failed before it '
    + '(or_list)',
  background: 'that does not cover a command it ran in the background with & (background)',
  substitution: 'that does not cover a command run inside a substitution: $(…), backquotes or <(…) (substitution)',
  negation: 'under ! that is the inverse of the negated command\'s status and does not cover that command (negation)',
  eval: 'that does not cover the commands eval ran (eval)',
  nested_shell: 'that does not cover the commands of a nested shell whose script was not read (nested_shell)',
  unreadable: 'the line could not be read, so that does not cover its commands (unreadable)',
});

/** A zero status the record does not say covers every command, with no closed reason recorded (an older ledger). */
const UNRECORDED_WORDS = 'the record does not show that it covers every command of the line';

const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The fixed sentence for an observation whose zero status does not cover every command of its line, or null for any
 * other event (a covered status, a failure, no typed status). Read from the canonical fields only (`lastStatus`,
 * `coversAll`, `statusGap`); a value outside the closed tables states nothing.
 */
export function statusFactSentence(event) {
  if (event?.kind !== 'observation' || event.coversAll !== false || !plain(event.lastStatus)) return null;
  const { exitCode, verdict } = event.lastStatus;
  const lead = exitCode === 0 ? LEADS.exit : exitCode === null && verdict === 'completed' ? LEADS.verdict : null;
  if (lead === null) return null;
  const gap = event.statusGap;
  const tail = gap == null ? UNRECORDED_WORDS : Object.hasOwn(STATUS_GAP_WORDS, gap) ? STATUS_GAP_WORDS[gap] : null;
  return tail === null ? null : `${lead}; ${tail}.`;
}

/** The request line that states it (two-space indent, outside any fence), or null. */
export function statusFactLine(event) {
  const sentence = statusFactSentence(event);
  return sentence === null ? null : `  ${STATUS_FACT_LABEL} ${sentence}`;
}

/**
 * Does this observation's recorded status leave its result to its output? True exactly where a request states the
 * sentence: a zero status that does not cover every command of its line. A covered zero status, a recorded failure and
 * an observation with no typed status are not this: their structural path is unchanged.
 */
export const statusUncovered = (event) => statusFactSentence(event) !== null;
