// M35 windowing (C-07 "M35 windowing"): test helpers. Inside a session-only request every event is named by its
// window's alias (`E1`, `E2`, …, windows.js `aliasTable`). A test that reads a request for an event's stable id reads it
// through `stableText`: every alias the window's table holds, written back as the stable id it names. Test-only; nothing
// in the product reads a request's text back.
import { planWindowRequests } from '../src/run-review.js';

/** `text` (a planned request's prompt or evidence) with every alias of `built.aliases` written back as its stable id. */
export function stableText(built, text = built?.request?.evidencePrompt ?? '') {
  const aliases = built?.aliases;
  if (!aliases || typeof aliases.stable !== 'function') return text;
  return String(text).replace(/\bE\d+\b/g, (alias) => aliases.stable(alias));
}

/** Every planned request's evidence, each with its aliases written back, joined. */
export const stableEvidence = (plan) => plan.requests.map((built) => stableText(built)).join('\n');

/**
 * A judge that reads its request as a test reads it: with every alias of its window written back as the stable id it
 * names (`stableText`; the window from the request's label, `:wN`), for a synthetic judge that parses event ids out of
 * the prompt. Its answers may cite stable ids: an id the window's alias table does not hold passes through unchanged.
 * The plan is the review's own (`planWindowRequests` is deterministic), built once.
 */
export function readingStableIds(session, judge, { reviewScope = 'session-only', speedProfile = undefined } = {}) {
  let plan = null;
  return async (request) => {
    plan ??= planWindowRequests({ session, reviewScope, ...(speedProfile ? { speedProfile } : {}) });
    const window = Number(/:w(\d+)/.exec(request?.label ?? '')?.[1] ?? 0);
    const built = plan.requests[window - 1];
    if (!built?.aliases) return judge(request);
    return judge({ ...request, prompt: stableText(built, request.prompt),
      ...(typeof request.evidencePrompt === 'string' ? { evidencePrompt: stableText(built, request.evidencePrompt) } : {}) });
  };
}
