// M33 H repair (C-06 "M33 helper-internal claims", owner decision 2026-10-01): the ONLY request bytes the repair moved,
// as literal text — before (`sonah.narrative/12`, `sonah.challenge/9`) and after (`sonah.narrative/13`,
// `sonah.challenge/10`). An agent passing on what a helper or another agent reported is now its own claim; until then
// "what … another agent says" was excluded with a document and a handoff. The baseline tests render every request they
// capture back through `requestBeforeRelayRule` and reproduce the values pinned before the repair byte for byte: that is
// the proof that nothing else moved. Node built-ins only; it imports no module under test, so a change to either
// prompt's words fails every baseline that uses it instead of silently following it.

/** The narrative task's claims rule (prompt.js TASK, item 3), as /12 and /13 send it. */
const NARRATIVE_TASK = Object.freeze({
  before: [
    '     A plan, an intention, a prediction, a conditional, a question, or a restatement of what a',
    '     document, a handoff or another agent says is NOT a claim: leave it out ("I\'ll run the',
    '     tests", "I\'m continuing to finish the checks", "this can be reviewed once the adapter',
    '     works"). Quote the claim.',
  ].join('\n'),
  after: [
    '     A plan, an intention, a prediction, a conditional, a question, or a restatement of what a',
    '     document or a hand-off brief says is NOT a claim: leave it out ("I\'ll run the tests",',
    '     "I\'m continuing to finish the checks", "this can be reviewed once the adapter works").',
    '     An agent that passes on what a helper or another agent reported ("the helper reports the',
    '     parser is fixed", "per the subagent, the suite is green") makes it its own claim, unless',
    '     it says it did not check it or doubts it: report it as that agent\'s claim, quoting its own',
    '     words, never the report it received.',
    '     Quote the claim.',
  ].join('\n'),
});

/** The narrative output contract's claims line (prompt.js OUTPUT_CONTRACT), as /12 and /13 send it. */
const NARRATIVE_CONTRACT = Object.freeze({
  before: 'prediction, a conditional or a question, and never what a document, a handoff or another agent says.',
  after: [
    'prediction, a conditional or a question, and never what a document or a hand-off brief says. What an agent',
    'passes on from a helper\'s or another agent\'s report is its own claims item, unless it says it did not check',
    'it or doubts it.',
  ].join('\n'),
});

/** The challengers' claim criteria (challenge.js SYSTEM), as /9 and /10 send them. */
const CHALLENGE_SYSTEM = Object.freeze({
  before: [
    'state or an observed fact. A plan, intention, prediction, conditional, question, or a restatement of what',
    'a document, a handoff or another agent says is not a claim. For a claim with contradictedBy, refute when',
  ].join('\n'),
  after: [
    'state or an observed fact. A plan, intention, prediction, conditional, question, or a restatement of what',
    'a document or a hand-off brief says is not a claim. An agent that passes on what a helper or another agent',
    'reported ("the helper reports X", "per the subagent, the suite is green") makes X its own claim, unless it',
    'says it did not check it or doubts it: judge it as that agent\'s claim of X, never as a restatement.',
    'For a claim with contradictedBy, refute when',
  ].join('\n'),
});

/** Every text the repair moved, frozen, by name. */
export const RELAY_RULE_TEXT = Object.freeze({ narrativeTask: NARRATIVE_TASK, narrativeContract: NARRATIVE_CONTRACT,
  challengeSystem: CHALLENGE_SYSTEM });

/** The versions the repair moved, before and after. */
export const RELAY_RULE_VERSIONS = Object.freeze({
  prompt: Object.freeze({ before: 'sonah.narrative/12', after: 'sonah.narrative/13' }),
  challenge: Object.freeze({ before: 'sonah.challenge/9', after: 'sonah.challenge/10' }),
});

/** `text` with every moved text put back as it was before the repair; anything else untouched. */
export function beforeRelayRule(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { before, after } of Object.values(RELAY_RULE_TEXT)) out = out.split(after).join(before);
  return out;
}

/** A request as the code before the repair sent it: its system and prompt rendered back (`beforeRelayRule`). Every
 *  other member — its evidence prompt, its label, its items — is the request's own. */
export function requestBeforeRelayRule(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, system: beforeRelayRule(request.system), prompt: beforeRelayRule(request.prompt) };
}

/** A run profile as the code before the repair froze it: the two versions it moved put back. */
export function profileBeforeRelayRule(profile) {
  const copy = structuredClone(profile);
  if (copy?.promptVersion === RELAY_RULE_VERSIONS.prompt.after) copy.promptVersion = RELAY_RULE_VERSIONS.prompt.before;
  if (copy?.challenge?.version === RELAY_RULE_VERSIONS.challenge.after)
    copy.challenge.version = RELAY_RULE_VERSIONS.challenge.before;
  return copy;
}

/**
 * The review modules a capture runs (`runReview`, `planWindowRequests`), wrapped so that every request a judge is sent
 * and every request a plan holds is the one the code before the repair would have built (`requestBeforeRelayRule`).
 * The judge still answers it exactly as it would the request it was sent: no answer depends on the moved words.
 */
export function modulesBeforeRelayRule({ runReview, planWindowRequests, ...rest }) {
  return {
    ...rest,
    ...(runReview ? { runReview: (options) => runReview({ ...options,
      judge: (request, ...more) => options.judge(requestBeforeRelayRule(request), ...more) }) } : {}),
    ...(planWindowRequests ? { planWindowRequests: (...args) => {
      const plan = planWindowRequests(...args);
      return { ...plan, requests: plan.requests.map((built) => ({ ...built, request: requestBeforeRelayRule(built.request) })) };
    } } : {}),
  };
}
