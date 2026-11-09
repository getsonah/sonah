// reasons.mjs: the closed vocabulary of drop reasons. Every dropped answer, entry or field names exactly one of these,
// so the rate of each reason stays countable. Never build a reason string anywhere else.

const MEANING = {
  answer_invalid: 'the answer did not parse or failed its shape after one re-ask; the request abstains',
  call_failed: 'the call gave no answer to check',
  unknown_function: 'names a function id that is not in the facts',
  duplicate_function: 'a function answered a second time; the first answer is kept',
  missing_text: 'a required text is missing, empty or not a string',
  over_word_limit: 'a text is over its word limit after the one limit re-ask',
  over_count_limit: 'a list is longer than allowed after the one limit re-ask; the first ones are kept',
  flow_without_steps: 'a flow has no step left to draw',
  duplicate_step: 'two steps of one flow share an id; the first is kept',
  step_without_target: 'a step names neither a function nor an external',
  was_not_allowed: 'a "was" on a step not marked new in this change',
  unknown_step: 'an edge names a step the flow never had',
  edge_to_dropped_step: 'an edge names a step that was dropped',
  edge_kind_unknown: 'an edge kind is not main, branch or signal',
  main_not_one_chain: 'a flow\'s main edges do not form one chain',
  step_not_joined: 'a step that no main or branch edge joins to its flow\'s main chain',
  duplicate_term: 'a glossary term given a second time; the first is kept',
  term_not_in_diff: 'a glossary term does not appear literally in the diff',
  tier_unknown: 'a finding tier is not must-act, must-know or good-to-know',
  quote_too_long: 'a finding quote is over 120 characters',
  quote_not_in_diff: 'a finding quote does not appear literally in the diff',
};

const list = Object.keys(MEANING);
// The list also answers by name (DROP_REASONS.answer_invalid), so code never spells a reason inline.
for (const r of list) Object.defineProperty(list, r, { value: r, enumerable: false });

export const DROP_REASONS = Object.freeze(list);
export const DROP_REASON_MEANING = Object.freeze({ ...MEANING });
export const isDropReason = (x) => typeof x === 'string' && Object.hasOwn(MEANING, x);
