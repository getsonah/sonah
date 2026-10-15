// Owner decision 2026-10-05 (M33 light fixes, G3): the challenge's support sentence as the code before it sent it.
//
// `sonah.challenge/11` was amended in one SYSTEM sentence: a support candidate's result is now "recorded before or
// after it, said to confirm it", where it was "recorded after it said to confirm it". `sonah.narrative/14` was amended
// in its two supportedBy sentences: a result recorded before or after the claim in the same turn, not only after it.
// Nothing else of any request moved. Rendering that sentence back in every request a judge is sent and every request a plan holds reproduces the
// requests of the code before it byte for byte, so a capture pinned before the amendment stays pinned
// (`modulesBeforeSupportOrder`); a capture of what the code sends now pins the values it moved as
// `MOVED_BY_SUPPORT_ORDER`, in each baseline test.

import { INTEGRATION_SUPPORT_SENTENCE } from './m33-integration-fixture.js';

/** Each amended text, `[now, before]`, by the request member that holds it. M33 integration (M33 integration,
 *  2026-10-06): merged with H3, the first sentence is the integration's (G3's rule without the example phrasing H3
 *  removed), so its pair (`INTEGRATION_SUPPORT_SENTENCE`, m33-integration-fixture.js) is rendered back first; G3's own
 *  pair below is the bytes G3 sent on its branch, and still renders those back. */
export const SUPPORT_ORDER_TEXTS = Object.freeze({
  system: Object.freeze([['recorded before or after it, said to confirm it.', 'recorded after it said to confirm it.']]),
  prompt: Object.freeze([
    INTEGRATION_SUPPORT_SENTENCE,
    [`     a RESULT of the agent's own action in the SAME turn, recorded before or after the claim,
     confirms exactly the claimed state (a passing run just before or right after "the tests
     pass"), cite that result as its supportedBy.`,
    `     a RESULT of the agent's own action recorded AFTER the claim confirms exactly the claimed
     state (a passing run right after "the tests pass"), cite that result as its supportedBy.`],
    [`recorded before or after the claim in the same turn, confirms exactly what was claimed: then it quotes that
RESULT. When unsure, null.`,
    'recorded AFTER the claim, confirms exactly what was claimed: then it quotes that RESULT. When unsure, null.'],
  ]),
});

const back = (text, pairs) => pairs.reduce((out, [now, before]) => out.replace(now, before), text);
/** A narrative prompt's text as the code before the amendment wrote it; anything else untouched. */
export const beforeSupportOrderText = (text) => (typeof text === 'string' ? back(text, SUPPORT_ORDER_TEXTS.prompt) : text);

/** A request as the code before the amendment sent it: each amended text rendered back. */
export function requestBeforeSupportOrder(request) {
  if (request === null || typeof request !== 'object') return request;
  const out = { ...request };
  for (const [member, pairs] of Object.entries(SUPPORT_ORDER_TEXTS))
    if (typeof out[member] === 'string') out[member] = back(out[member], pairs);
  return out;
}

/** The review modules a capture runs, wrapped so that every request is the one the code before the amendment built.
 *  Composes innermost with `modulesBeforeForbiddenEdit` and `modulesBeforeRelayRule`. */
export function modulesBeforeSupportOrder({ runReview, planWindowRequests, ...rest }) {
  return {
    ...rest,
    ...(runReview ? { runReview: (options) => runReview({ ...options,
      judge: (request, ...more) => options.judge(requestBeforeSupportOrder(request), ...more) }) } : {}),
    ...(planWindowRequests ? { planWindowRequests: (...args) => {
      const plan = planWindowRequests(...args);
      return { ...plan, requests: plan.requests.map((built) => ({ ...built, request: requestBeforeSupportOrder(built.request) })) };
    } } : {}),
  };
}
