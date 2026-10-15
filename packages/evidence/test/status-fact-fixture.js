// Status fact (owner decision 2026-10-06: "unproven" is not a terminal state; C-02, C-05): the ONLY request bytes it
// moved, as literal text — what `sonah.narrative/15`, `sonah.challenge/12` and `sonah.carry/6` send that `/14`, `/11` and
// `/5` did not: three lines of the narrative task's claims item, one sentence of the challengers' system prompt, and one
// "status:" line under the header of a RESULT whose zero exit status does not cover every command of its line (a window's
// own or a carried one). Rendered back through `requestBeforeStatusFact`, every request a baseline captures is the one
// the code before it built, byte for byte: that is the proof nothing else moved. Node built-ins only; it imports no
// module under test, so a change to the words fails every test that uses it instead of silently following it.

/** Item 3 of the narrative task (prompt.js TASK), after its supportedBy/contradictedBy rule, with its newline. */
const NARRATIVE_TASK = [
  '     A RESULT with a "status:" line under its header proves nothing by its exit status, which',
  '     does not cover every command of its line: cite it as supportedBy or contradictedBy only',
  '     by quoting the exact line of its output that shows the result.',
  '',
].join('\n');

/** The challengers' system prompt (challenge.js SYSTEM), the sentence after "A support vote citing none of them does
 *  not count.", with the newline it ends on. */
const CHALLENGE_SYSTEM = [
  'When that result has a "status:" line under its header (its exit',
  'status does not cover every command of its line), cite that result itself, quoting the line of its output that shows',
  'what the candidate says it shows; a vote citing only its command or the candidate\'s own words does not count.',
  '',
].join('\n');

/** Every fixed text the status fact added, frozen, by name. */
export const STATUS_FACT_TEXT = Object.freeze({ narrativeTask: NARRATIVE_TASK, challengeSystem: CHALLENGE_SYSTEM });

/** The status line's words (status-fact.js), every lead with every tail. */
const LEADS = ['This command line exited 0',
  'This command line finished with a zero status (the harness\'s typed verdict; no exit code was recorded)'];
const TAILS = [
  'that is the status of the last command of its pipeline and does not cover the earlier commands of the pipeline (pipeline)',
  'that is the status of its last command and does not cover the commands before a ; or a newline (sequence)',
  'that is the status of whichever side of || ran last and does not cover a command that failed before it (or_list)',
  'that does not cover a command it ran in the background with & (background)',
  'that does not cover a command run inside a substitution: $(…), backquotes or <(…) (substitution)',
  'under ! that is the inverse of the negated command\'s status and does not cover that command (negation)',
  'that does not cover the commands eval ran (eval)',
  'that does not cover the commands of a nested shell whose script was not read (nested_shell)',
  'the line could not be read, so that does not cover its commands (unreadable)',
  'the record does not show that it covers every command of the line',
];
/** Every status line a request may hold, with the newline before it. */
export const STATUS_LINES = Object.freeze(LEADS.flatMap((lead) => TAILS.map((tail) => `\n  status: ${lead}; ${tail}.`)));

/** The versions it moved, before and after. */
export const STATUS_FACT_VERSIONS = Object.freeze({
  prompt: Object.freeze({ before: 'sonah.narrative/14', after: 'sonah.narrative/15' }),
  challenge: Object.freeze({ before: 'sonah.challenge/11', after: 'sonah.challenge/12' }),
  carry: Object.freeze({ before: 'sonah.carry/5', after: 'sonah.carry/6' }),
});

/** `text` with every text the status fact added taken out; anything else untouched. */
export function beforeStatusFact(text) {
  if (typeof text !== 'string') return text;
  let out = text.split(NARRATIVE_TASK).join('').split(`count. ${CHALLENGE_SYSTEM}`).join('count. ');
  for (const line of STATUS_LINES) out = out.split(line).join('');
  return out;
}

/** How many status lines `text` holds. */
export const statusLinesIn = (text) => STATUS_LINES.reduce((n, line) => n + (String(text).split(line).length - 1), 0);

/** A request as the code before the status fact sent it: its system, prompt and evidence prompt rendered back. */
export function requestBeforeStatusFact(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, system: beforeStatusFact(request.system), prompt: beforeStatusFact(request.prompt),
    ...(Object.hasOwn(request, 'evidencePrompt') ? { evidencePrompt: beforeStatusFact(request.evidencePrompt) } : {}) };
}

/** A run profile as the code before the status fact froze it: its three versions put back. */
export function profileBeforeStatusFact(profile) {
  const copy = structuredClone(profile);
  if (copy?.promptVersion === STATUS_FACT_VERSIONS.prompt.after) copy.promptVersion = STATUS_FACT_VERSIONS.prompt.before;
  if (copy?.challenge?.version === STATUS_FACT_VERSIONS.challenge.after)
    copy.challenge.version = STATUS_FACT_VERSIONS.challenge.before;
  if (copy?.carry?.version === STATUS_FACT_VERSIONS.carry.after) copy.carry.version = STATUS_FACT_VERSIONS.carry.before;
  return copy;
}

/**
 * The review modules a capture runs (`runReview`, `planWindowRequests`), wrapped so that every request a judge is sent
 * and every request a plan holds is the one the code before the status fact would have built (`requestBeforeStatusFact`).
 * Innermost of the render-backs: compose the older ones (forbidden edit, relay rule) around it.
 */
export function modulesBeforeStatusFact({ runReview, planWindowRequests, ...rest }) {
  return {
    ...rest,
    ...(runReview ? { runReview: (options) => runReview({ ...options,
      judge: (request, ...more) => options.judge(requestBeforeStatusFact(request), ...more) }) } : {}),
    ...(planWindowRequests ? { planWindowRequests: (...args) => {
      const plan = planWindowRequests(...args);
      return { ...plan, requests: plan.requests.map((built) => ({ ...built, request: requestBeforeStatusFact(built.request) })) };
    } } : {}),
  };
}

/** The canonical observation fields the status fact added (adapters/sonah-ledger.js), after every other field. */
export const STATUS_FACT_FIELDS = Object.freeze(['lastStatus', 'coversAll', 'statusGap']);

/** Events as the adapter built them before the status fact: each without its three fields; nothing else changes. */
export const eventsBeforeStatusFact = (events) => (Array.isArray(events) ? events.map((event) => {
  if (event === null || typeof event !== 'object') return event;
  const copy = { ...event };
  for (const field of STATUS_FACT_FIELDS) delete copy[field];
  return copy;
}) : events);

/** A session (for a digest of its own members) with its events rendered back (`eventsBeforeStatusFact`). */
export const sessionBeforeStatusFact = (session) => Object.assign(Object.create(Object.getPrototypeOf(session)), session,
  { events: eventsBeforeStatusFact(session.events) });
