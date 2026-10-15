// M33 N (C-06 "M33 forbidden edits", owner decision 2026-10-01): the ONLY request bytes the forbidden-edit route moved,
// as literal text — what a session-only narrative request (`sonah.narrative/14`) sends that `sonah.narrative/13` did not:
// item 6 of its task, one member of its output contract, and that member's rules. Nothing else of any request moved: a
// session-only request's evidence and system prompt, every combined request (the code review's narrative fallback
// included), and every challenge request but the new forbidden-edit run's (which no earlier review sent). Rendered back
// through `requestBeforeForbiddenEdit`, every session-only request is /13's byte for byte — that is the proof. Node
// built-ins only (and M4's fixture, built-ins only too); it imports no module under test, so a change to the words fails
// every test that uses it instead of silently following it.

import { profileBeforeM4, beforeDisclosureWords } from './m33-m4-disclosure-fixture.js';

// Owner decision 2026-10-05 (M33 light fixes, G3): a later amendment moved two narrative sentences and one challenge
// SYSTEM sentence (m33-support-order-fixture.js); rendering back to /13 and /10 renders it back first.
import { beforeSupportOrderText, requestBeforeSupportOrder } from './m33-support-order-fixture.js';

/** Item 6 of the session-only task (prompt.js FORBIDDEN_TASK), and the newline that ends it. */
const TASK = [
  '  6. EDITS AGAINST AN INSTRUCTION — a change the agent, or a helper it delegated to, made against',
  '     an explicit instruction of the human: the human said not to do something (leave it out, keep',
  '     it unchanged, do not touch it, ignore it) and a LATER edit, write or command did it anyway.',
  '     Cite the HUMAN INSTRUCTION event and quote the constraint exactly; cite the ACTION and quote',
  '     exactly what it wrote (role code, from the text that action wrote, never the file as the',
  '     record found it and never its path) or, for a command, what it ran (role action, from its',
  '     command). Each quote is at most 120 characters. If the agent then told the human about that',
  '     change, cite that AGENT SAID as reportedBy. Only the human\'s own instruction counts: never',
  '     harness context, a hand-off brief or the agent\'s own words. If a later human instruction,',
  '     recorded before the action, allowed it or withdrew the constraint, it is not one. A choice',
  '     nobody asked for is a decision, not this.',
  '',
].join('\n');

/** The output contract's member (prompt.js FORBIDDEN_CONTRACT_FIELD), right after `writtenClaims`. */
const CONTRACT_FIELD = [
  ',',
  '  "forbiddenEdits": [{',
  '    "text": "what the human ruled out and what was done anyway, in your words",',
  '    "instruction": {"eventId":"E1","role":"instruction","quote":"exact span, at most 120 characters"},',
  '    "violation": {"eventId":"E5","role":"code|action","quote":"exact span, at most 120 characters"},',
  '    "reportedBy": {"eventId":"E9","role":"commentary","quote":"exact span"} | null',
  '  }]',
].join('\n');

/** The output contract's rules for that member (prompt.js FORBIDDEN_CONTRACT_RULES), before its instructionReview rule. */
const CONTRACT_RULES = [
  'A forbiddenEdits item quotes a HUMAN INSTRUCTION recorded BEFORE the action, and an ACTION of the agent or a',
  'helper: role code quoting the text that action wrote, or role action quoting the command it ran. Omit',
  '"reportedBy" or set it null unless an AGENT SAID recorded after the action told the human about that change.',
  'A paraphrase is never a quote. When unsure, leave it out.',
  '',
].join('\n');

/** Every text the route added to a session-only narrative request, frozen, by name. */
export const FORBIDDEN_EDIT_TEXT = Object.freeze({ task: TASK, contractField: CONTRACT_FIELD, contractRules: CONTRACT_RULES });

/** The versions the route moved, before and after. */
export const FORBIDDEN_EDIT_VERSIONS = Object.freeze({
  prompt: Object.freeze({ before: 'sonah.narrative/13', after: 'sonah.narrative/14' }),
  challenge: Object.freeze({ before: 'sonah.challenge/10', after: 'sonah.challenge/11' }),
});

// ---- M33 brittleness M3: a removal is a forbidden edit too ------------------------------------------------------------

/** Item 6 of the session-only task as M3 widened it (prompt.js FORBIDDEN_TASK, `sonah.narrative/15`). M3 review: the
 *  deleted-file wording is held back, so these are the texts /15 sends. */
const M3_TASK = [
  '  6. EDITS AGAINST AN INSTRUCTION — a change the agent, or a helper it delegated to, made against',
  '     an explicit instruction of the human: the human said not to do something (leave it out, keep',
  '     it unchanged, do not touch it, do not remove it, ignore it) and a LATER edit, write or command',
  '     did it anyway. Cite the HUMAN INSTRUCTION event and quote the constraint exactly; cite the',
  '     ACTION and quote exactly what it wrote (role code, from the text that action wrote), what it',
  '     removed (role code, from the text that action replaced, when the change took it out) or, for a',
  '     command, what it ran (role action, from its command). Never quote text the change kept. Each',
  '     quote is at most 120 characters. If the agent then told the human about that change, cite that',
  '     AGENT SAID as reportedBy. Only the human\'s own instruction counts: never harness context, a',
  '     hand-off brief or the agent\'s own words. If a later human instruction, recorded before the',
  '     action, allowed it or withdrew the constraint, it is not one. A choice nobody asked for is a',
  '     decision, not this.',
  '',
].join('\n');

/** That member's rules as M3 widened them (prompt.js FORBIDDEN_CONTRACT_RULES, `sonah.narrative/15`). */
const M3_CONTRACT_RULES = [
  'A forbiddenEdits item quotes a HUMAN INSTRUCTION recorded BEFORE the action, and an ACTION of the agent or a',
  'helper: role code quoting the text that action wrote or the text it removed, or role action quoting the',
  'command it ran. Omit',
  '"reportedBy" or set it null unless an AGENT SAID recorded after the action told the human about that change.',
  'A paraphrase is never a quote. When unsure, leave it out.',
  '',
].join('\n');

/**
 * MOVED_BY_M3: the ONLY request bytes and versions M33 brittleness M3 moved — two of M33 N's three session-only texts,
 * each `[as M33 N wrote it, as M3 writes it]` (the contract member is M33 N's, byte for byte), the narrative version
 * (/14 → /15), and the challenge version (/11 → /12: a forbidden-edit run's note and candidates, which no request this
 * fixture's callers pin was ever sent). Rendered back through `beforeM3`, every session-only request is M33 N's byte for
 * byte.
 */
export const MOVED_BY_M3 = Object.freeze({
  texts: Object.freeze({ task: Object.freeze([TASK, M3_TASK]), contractRules: Object.freeze([CONTRACT_RULES, M3_CONTRACT_RULES]) }),
  versions: Object.freeze({ prompt: Object.freeze(['sonah.narrative/14', 'sonah.narrative/15']),
    challenge: Object.freeze(['sonah.challenge/11', 'sonah.challenge/12']) }),
});

/** `text` as M33 N sent it: the D64 wording's two sentences put back first (m33-m4-disclosure-fixture.js
 *  `beforeDisclosureWords`: as M3 wrote them), then each text M3 widened as M33 N wrote it; anything else untouched. */
export function beforeM3(text) {
  if (typeof text !== 'string') return text;
  let out = beforeDisclosureWords(text);
  for (const [before, after] of Object.values(MOVED_BY_M3.texts)) out = out.split(after).join(before);
  return out;
}

/** A run profile as M33 N froze it: M4's version put back first (m33-m4-disclosure-fixture.js), then M3's two. */
export function profileBeforeM3(profile) {
  const copy = profileBeforeM4(profile);
  if (copy?.promptVersion === MOVED_BY_M3.versions.prompt[1]) copy.promptVersion = MOVED_BY_M3.versions.prompt[0];
  if (copy?.challenge?.version === MOVED_BY_M3.versions.challenge[1]) copy.challenge.version = MOVED_BY_M3.versions.challenge[0];
  return copy;
}

/** `text` with every text the route added taken out (M3's widening first put back as M33 N wrote it, `beforeM3`);
 *  anything else untouched. */
export function beforeForbiddenEdit(text) {
  if (typeof text !== 'string') return text;
  let out = beforeM3(beforeSupportOrderText(text));
  for (const added of Object.values(FORBIDDEN_EDIT_TEXT)) out = out.split(added).join('');
  return out;
}

/** A request as the code before the route sent it: its prompt rendered back (`beforeForbiddenEdit`). Its evidence
 *  prompt never moved, so it is the request's own; so is every other member — but for the later support-order
 *  sentence of a challenge request's system prompt, rendered back first (`requestBeforeSupportOrder`). */
export function requestBeforeForbiddenEdit(request) {
  if (request === null || typeof request !== 'object') return request;
  const back = requestBeforeSupportOrder(request);
  return { ...back, prompt: beforeForbiddenEdit(back.prompt) };
}

/** A run profile as the code before the route froze it: the two versions put back (M3's first, `profileBeforeM3`), and a
 *  session-only profile's narrative contract without the member the route added (`forbiddenEdits`, the last of its
 *  members). */
export function profileBeforeForbiddenEdit(profile) {
  const copy = profileBeforeM3(profile);
  if (copy?.promptVersion === FORBIDDEN_EDIT_VERSIONS.prompt.after) copy.promptVersion = FORBIDDEN_EDIT_VERSIONS.prompt.before;
  if (copy?.challenge?.version === FORBIDDEN_EDIT_VERSIONS.challenge.after)
    copy.challenge.version = FORBIDDEN_EDIT_VERSIONS.challenge.before;
  if (copy?.narrativeSchema?.properties && Object.hasOwn(copy.narrativeSchema.properties, 'forbiddenEdits'))
    delete copy.narrativeSchema.properties.forbiddenEdits;
  return copy;
}

/**
 * The review modules a capture runs (`runReview`, `planWindowRequests`), wrapped so that every request a judge is sent
 * and every request a plan holds is the one the code before the route would have built (`requestBeforeForbiddenEdit`).
 * The judge still answers it exactly as it would the request it was sent. Composes with m33-h-relay-rule-fixture.js
 * `modulesBeforeRelayRule` (outermost) to render back to /12 and /9.
 */
export function modulesBeforeForbiddenEdit(modules) {
  return modulesRenderedBack(modules, requestBeforeForbiddenEdit);
}

/** M33 brittleness M3: a request as M33 N sent it — its prompt rendered back through `beforeM3`. */
export function requestBeforeM3(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, prompt: beforeM3(request.prompt) };
}
/** M33 brittleness M3: the review modules, every request rendered back as M33 N sent it (`requestBeforeM3`). */
export function modulesBeforeM3(modules) {
  return modulesRenderedBack(modules, requestBeforeM3);
}

/** D64 wording (owner decision 2026-10-07): a request as `sonah.narrative/19` (and `sonah.code-review/16`) sent it — its
 *  prompt's proposer sentences rendered back (m33-m4-disclosure-fixture.js `beforeDisclosureWords`). No other member of
 *  any request moved. */
export function requestBeforeDisclosureWords(request) {
  if (request === null || typeof request !== 'object') return request;
  return { ...request, prompt: beforeDisclosureWords(request.prompt) };
}
/** D64 wording: the review modules, every request rendered back as /19 sent it (`requestBeforeDisclosureWords`). */
export function modulesBeforeDisclosureWords(modules) {
  return modulesRenderedBack(modules, requestBeforeDisclosureWords);
}

/** The review modules with every request a judge is sent and every request a plan holds mapped by `back`. */
function modulesRenderedBack({ runReview, planWindowRequests, ...rest }, back) {
  return {
    ...rest,
    ...(runReview ? { runReview: (options) => runReview({ ...options,
      judge: (request, ...more) => options.judge(back(request), ...more) }) } : {}),
    ...(planWindowRequests ? { planWindowRequests: (...args) => {
      const plan = planWindowRequests(...args);
      return { ...plan, requests: plan.requests.map((built) => ({ ...built, request: back(built.request) })) };
    } } : {}),
  };
}
