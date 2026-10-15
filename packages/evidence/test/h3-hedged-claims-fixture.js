// Case H3: the ONLY request bytes the hedged-claims change and its review repair moved,
// as literal text — before (`sonah.narrative/14`, `sonah.challenge/11`) and after (`sonah.narrative/16`,
// `sonah.challenge/13`; /15 and /12 were H3 before its review repair). A claim is now every statement the agent makes
// about the current state or the outcome of its work, a hedged one included; only an action not taken yet, a question,
// or a restatement of a document or a hand-off brief is left out. Until then a plan, an intention, a prediction and a
// conditional were left out too, with example phrasings from this project's own sessions, and the challengers refuted a
// contradiction they read as a plan, an intention or a conditional. The repair (2026-10-06) removed the example
// phrasings left in item 3 and in the challengers' relay sentence (the relay rule's, from the M33 H repair, and the
// supportedBy rule's, from M33 C), and said in all three relay sentences that a hedge on what an agent passes on from a
// helper's or another agent's report is not doubt. The owner's decision of the same day (still /13) took the last list
// of statement types out of the challengers' CLAIM_WORDS_NOTE: the text a claim's words are quoted from may narrow what
// they assert and never widens it, where it said that text "may show they are a plan, a condition or a disclosed
// failure"; only a batch holding a claim-class item is sent that note. The baseline tests render every request they
// capture back through `requestBeforeHedgedClaims` and reproduce the values pinned before the change byte for byte: that
// is the proof that nothing else moved. It composes innermost with m33-n-forbidden-edit-fixture.js and
// m33-h-relay-rule-fixture.js (whose texts it restores first). Node built-ins only; it imports no module under test, so
// a change to either prompt's words fails every baseline that uses it instead of silently following it.

/** The narrative task's claims definition (prompt.js TASK, item 3), as /14 and /16 send it. */
const NARRATIVE_TASK = Object.freeze({
  before: [
    '  3. CLAIMS — the agent\'s own assertion that something IS true or WAS done: a completed state',
    '     or an observed fact about its work ("the tests pass", "this is backwards compatible").',
    '     A plan, an intention, a prediction, a conditional, a question, or a restatement of what a',
    '     document or a hand-off brief says is NOT a claim: leave it out ("I\'ll run the tests",',
    '     "I\'m continuing to finish the checks", "this can be reviewed once the adapter works").',
  ].join('\n'),
  after: [
    '  3. CLAIMS — every statement the agent makes about the current state or the outcome of its',
    '     work, including one it hedges or qualifies: report a hedged statement as a claim and keep',
    '     the hedge in the quote. Only an action the agent has not taken yet, a question, or a',
    '     restatement of what a document or a hand-off brief says is NOT a claim: leave it out.',
  ].join('\n'),
});

/** The narrative output contract's claims line (prompt.js OUTPUT_CONTRACT), as /14 and /16 send it. */
const NARRATIVE_CONTRACT = Object.freeze({
  before: [
    'A claims item is a completed state or an observed fact the agent asserted, never a plan, an intention, a',
    'prediction, a conditional or a question, and never what a document or a hand-off brief says. What an agent',
  ].join('\n'),
  after: [
    'A claims item is a statement the agent made about the current state or the outcome of its work, hedged or',
    'not and quoted with its hedge; never an action it has not taken yet or a question, and never what a document',
    'or a hand-off brief says. What an agent',
  ].join('\n'),
});

/** The challengers' claim definition (challenge.js SYSTEM), as /11 and /13 send it. */
const CHALLENGE_DEFINITION = Object.freeze({
  before: [
    'A claim asserts that something IS true or WAS done: a completed',
    'state or an observed fact. A plan, intention, prediction, conditional, question, or a restatement of what',
  ].join('\n'),
  after: [
    'A claim is a statement the agent made about the current state or the',
    'outcome of its work, hedged or not: judge the quoted words as said, hedge included. An action the agent has',
    'not taken yet, a question, or a restatement of what',
  ].join('\n'),
});

/** The challengers' first ground to refute a contradicted claim (challenge.js SYSTEM), as /11 and /13 send it. */
const CHALLENGE_REFUTE = Object.freeze({
  before: 'the statement is a plan, intention or conditional; when the statement itself already disclosed the failure',
  after: [
    'the quoted words assert nothing about the state or the outcome of the work;',
    'when the statement itself already disclosed the failure',
  ].join('\n'),
});

/** What a contradiction must show false (challenge.js SYSTEM), as /11 and /13 send it. */
const CHALLENGE_STATE = Object.freeze({
  before: 'the claimed\ncompleted state was false at the time it was claimed.',
  after: 'the claimed\nstate was false at the time it was claimed.',
});

/** Review repair: the narrative task's relay rule (prompt.js TASK, item 3), as /14 and /16 send it — its example
 *  phrasings gone, and a hedge on a relay is not doubt. */
const NARRATIVE_RELAY = Object.freeze({
  before: [
    '     An agent that passes on what a helper or another agent reported ("the helper reports the',
    '     parser is fixed", "per the subagent, the suite is green") makes it its own claim, unless',
    '     it says it did not check it or doubts it: report it as that agent\'s claim, quoting its own',
    '     words, never the report it received.',
  ].join('\n'),
  after: [
    '     An agent that passes on what a helper or another agent reported makes it its own claim,',
    '     unless it says it did not check it or doubts it: report it as that agent\'s claim, quoting',
    '     its own words, never the report it received. A hedge on what it passes on is not doubt:',
    '     report it as a claim and keep the hedge in the quote.',
  ].join('\n'),
});

/** Review repair: the narrative task's supportedBy rule (prompt.js TASK, item 3), as /14 and /16 send it — its example
 *  phrasing gone. */
const NARRATIVE_SUPPORT = Object.freeze({
  before: '     state (a passing run right after "the tests pass"), cite that result as its supportedBy.',
  after: '     state, cite that result as its supportedBy.',
});

/** Review repair: the narrative output contract's relay line (prompt.js OUTPUT_CONTRACT), as /14 and /16 send it. */
const NARRATIVE_CONTRACT_RELAY = Object.freeze({
  before: 'it or doubts it.\nA statement the agent wrote into a file goes in writtenClaims',
  after: 'it or doubts it; a hedge on it is not doubt.\nA statement the agent wrote into a file goes in writtenClaims',
});

/** Review repair: the challengers' relay rule (challenge.js SYSTEM), as /11 and /13 send it — its example phrasings
 *  gone, and a hedge on a relay is not doubt. */
const CHALLENGE_RELAY = Object.freeze({
  before: [
    'reported ("the helper reports X", "per the subagent, the suite is green") makes X its own claim, unless it',
    'says it did not check it or doubts it: judge it as that agent\'s claim of X, never as a restatement.',
  ].join('\n'),
  after: [
    'reported makes what it passes on its own claim, unless it says it did not check it or doubts it: judge it as',
    'that agent\'s own claim, never as a restatement. A hedge on what it passes on is not doubt: judge the quoted',
    'words as said, hedge included.',
  ].join('\n'),
});

/** Owner decision (2026-10-06, still /13): the challengers' CLAIM_WORDS_NOTE (challenge.js), sent after the system
 *  prompt to a batch holding a claim-class item only, as /11 and /13 send it — no list of statement types. One line:
 *  the note is joined with spaces. */
const CLAIM_WORDS_CONTEXT = Object.freeze({
  before: 'may show they are a plan, a condition or a disclosed failure, but never widens what they assert.',
  after: 'may narrow but never widens what they assert.',
});

/** Every text the change moved, frozen, by name. */
export const HEDGED_CLAIMS_TEXT = Object.freeze({ narrativeTask: NARRATIVE_TASK, narrativeContract: NARRATIVE_CONTRACT,
  challengeDefinition: CHALLENGE_DEFINITION, challengeRefute: CHALLENGE_REFUTE, challengeState: CHALLENGE_STATE,
  narrativeRelay: NARRATIVE_RELAY, narrativeSupport: NARRATIVE_SUPPORT, narrativeContractRelay: NARRATIVE_CONTRACT_RELAY,
  challengeRelay: CHALLENGE_RELAY, claimWordsContext: CLAIM_WORDS_CONTEXT });

/** The versions the change moved, before and after. */
export const HEDGED_CLAIMS_VERSIONS = Object.freeze({
  prompt: Object.freeze({ before: 'sonah.narrative/14', after: 'sonah.narrative/16' }),
  challenge: Object.freeze({ before: 'sonah.challenge/11', after: 'sonah.challenge/13' }),
});

/** `text` with every moved text put back as it was before the change; anything else untouched. */
export function beforeHedgedClaims(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  for (const { before, after } of Object.values(HEDGED_CLAIMS_TEXT)) out = out.split(after).join(before);
  return out;
}

/** A request as the code before the change sent it: its system and prompt rendered back (`beforeHedgedClaims`). Every
 *  other member — its evidence prompt, its label, its items — is the request's own. */
export function requestBeforeHedgedClaims(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, system: beforeHedgedClaims(request.system), prompt: beforeHedgedClaims(request.prompt) };
}

/** A run profile as the code before the change froze it: the two versions it moved put back. */
export function profileBeforeHedgedClaims(profile) {
  const copy = structuredClone(profile);
  if (copy?.promptVersion === HEDGED_CLAIMS_VERSIONS.prompt.after) copy.promptVersion = HEDGED_CLAIMS_VERSIONS.prompt.before;
  if (copy?.challenge?.version === HEDGED_CLAIMS_VERSIONS.challenge.after)
    copy.challenge.version = HEDGED_CLAIMS_VERSIONS.challenge.before;
  return copy;
}

/**
 * The review modules a capture runs (`runReview`, `planWindowRequests`), wrapped so that every request a judge is sent
 * and every request a plan holds is the one the code before the change would have built (`requestBeforeHedgedClaims`).
 * The judge still answers it exactly as it would the request it was sent: no answer depends on the moved words. Wrap it
 * innermost: `modulesBeforeRelayRule(modulesBeforeForbiddenEdit(modulesBeforeHedgedClaims(modules)))` renders back to
 * /12 and /9.
 */
export function modulesBeforeHedgedClaims({ runReview, planWindowRequests, ...rest }) {
  return {
    ...rest,
    ...(runReview ? { runReview: (options) => runReview({ ...options,
      judge: (request, ...more) => options.judge(requestBeforeHedgedClaims(request), ...more) }) } : {}),
    ...(planWindowRequests ? { planWindowRequests: (...args) => {
      const plan = planWindowRequests(...args);
      return { ...plan, requests: plan.requests.map((built) => ({ ...built, request: requestBeforeHedgedClaims(built.request) })) };
    } } : {}),
  };
}
