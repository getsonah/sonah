// D211 (0.3.0-beta.13): a request's prompt in parts, so requests that share a long first part read it from the prompt
// cache instead of each writing it again. The claude CLI writes its own cache entries only at the end of the system
// prompt, at the end of the user message and at its own environment tail (Claude Code 2.1.311 under --print), and it
// passes a caller's own `cache_control` on a stream-json text block through. So a request whose prompt is cut at a
// boundary its builder already makes, and sent as one text block per part with the first block marked, leaves an entry
// at the end of that first part that a sibling request with the same first part reads.
//
// What the model reads does not move: the parts join to the prompt byte for byte, in order. A builder sets the cuts
// from the structure it builds (an offset at a join it makes), never from what the text says. Everything here is
// deterministic and makes no call.
import { createHash } from 'node:crypto';
import { REPLY_BEGUN } from './challenge.js';

/**
 * The offsets at which a request's prompt is cut into parts (`request.parts`): strictly increasing whole numbers, each
 * inside the prompt, each part ending at one and the last part at the prompt's end. `[]` — the prompt is sent as one
 * string, as before — for a request that carries none, and for cuts the transport could not send as they are: a cut
 * outside the prompt or out of order, one inside a surrogate pair, or a part with no character other than white space
 * (the Messages API refuses such a text block). Malformed cuts are never refused: the prompt sent whole is the same text.
 */
export function promptCutsOf(request) {
  const cuts = request?.parts, prompt = request?.prompt;
  if (!Array.isArray(cuts) || cuts.length === 0 || typeof prompt !== 'string') return [];
  let from = 0;
  for (const cut of cuts) {
    if (!Number.isSafeInteger(cut) || cut <= from || cut >= prompt.length) return [];
    const before = prompt.charCodeAt(cut - 1), after = prompt.charCodeAt(cut);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) return [];
    if (!/\S/.test(prompt.slice(from, cut))) return [];
    from = cut;
  }
  return /\S/.test(prompt.slice(from)) ? [...cuts] : [];
}

/** The prompt's parts at `cuts` (`promptCutsOf`): strings that join to `prompt`, in order. */
export function promptPartsOf(prompt, cuts) {
  const parts = [];
  let from = 0;
  for (const cut of [...cuts, prompt.length]) { parts.push(prompt.slice(from, cut)); from = cut; }
  return parts;
}

/**
 * The request a re-ask or a repair sends when it appends `suffix` to `request`'s prompt: `request` with that prompt, its
 * own cuts kept, and one more at its prompt's end, so the re-ask reads the cache entry its original wrote at the end of
 * its user message while that entry lives. With an empty suffix the request is returned as it was.
 */
export function appendedRequest(request, suffix) {
  if (typeof request?.prompt !== 'string' || typeof suffix !== 'string' || suffix === '') return request;
  return { ...request, prompt: `${request.prompt}${suffix}`, parts: [...promptCutsOf(request), request.prompt.length] };
}

/**
 * `next` (a request rebuilt from the same plan as `original`) with the cuts `appendedRequest` would give it, when it is
 * `original`'s system and prompt with more after it, byte for byte; else `next` as it was (a rebuilt request whose
 * blocks gave way shares no prefix to cut at).
 */
export function continuedRequest(original, next) {
  if (typeof original?.prompt !== 'string' || typeof next?.prompt !== 'string' || next.system !== original.system
      || next.prompt.length <= original.prompt.length || !next.prompt.startsWith(original.prompt)) return next;
  return { ...next, parts: [...promptCutsOf(original), original.prompt.length] };
}

/**
 * D211: the name of the function a request may carry, not enumerable (so no key, byte, copy or JSON of the request holds
 * it), which the answer store (cli answer-cache.js `memoizeJudge`) calls once when it answers the request with a stored
 * answer: no call was made, so no cache entry was written. `staggerSharedParts` gives one to the request that leads its
 * first part, so that when it made no call the next request of that first part leads in its place.
 */
export const ANSWER_REPLAYED = 'answerReplayed';

/** What two requests must hold alike for the second to read the first one's first part from the cache: the system
 *  prompt, the answer's schema (the CLI's structured output tool, part of the cached prefix) and the first part, as a
 *  SHA-256 of the three, so a long first part is not held for the whole step. Null for a request sent whole, or whose
 *  schema has no JSON form. */
function sharedFirstOf(request) {
  const cuts = promptCutsOf(request);
  if (!cuts.length || typeof request.system !== 'string') return null;
  let shared;
  try { shared = JSON.stringify([request.system, request.schema ?? null, request.prompt.slice(0, cuts[0])]); }
  catch { return null; }
  return createHash('sha256').update(shared).digest('hex');
}

/**
 * D211: `judge` with each request that shares its first part (`sharedFirstOf`) with one given before it held back until
 * the request leading that first part has begun its reply, so it reads the first part the leader wrote instead of
 * writing it again. The first request of each first part leads it: it is sent with a REPLY_BEGUN function (challenge.js,
 * D145), which the claude CLI transport calls once when the model's reply begins, and with an ANSWER_REPLAYED one, which
 * the answer store calls when it answers from a stored answer. A later one is sent when the leader's reply begins or
 * when its call settles, whatever came of it (a failure, an abort), so none waits forever; after that, one of that first
 * part waits for nothing. When the leader was answered from the store it made no call, so the next request of its first
 * part leads in its place. Requests reach `judge` in exactly the order they were given, so the order never depends on
 * timing: identical requests take the same D60 occurrences, and a call cap (cli review-budget.js) admits the same
 * requests whenever a reply begins. A request given after one that waits is sent after it; one with nothing given before
 * it still waiting, and nothing to wait for, is sent at once, in the same turn. No request byte changes; a request's own
 * REPLY_BEGUN and ANSWER_REPLAYED are still called.
 */
export function staggerSharedParts(judge) {
  // Each first part's group, by its digest: `open` once a leader's reply began or its call settled (later ones wait for
  // nothing), and `leading` while a leader's call is out. `queue`: the requests given and not yet sent, in that order.
  const groups = new Map();
  const queue = [];
  const call = (request) => {
    try { return Promise.resolve(judge(request)); } catch (error) { return Promise.reject(error); }
  };
  // Send from the front of the queue while its first may go: one with no first part, one of an open first part, or the
  // leader of a first part none leads. A request of a first part still being led stops it, and all behind it.
  const pump = () => {
    while (queue.length) {
      const { request, group, go } = queue[0];
      if (group !== null && !group.open && group.leading) return;
      queue.shift();
      go(group === null || group.open ? call(request) : lead(group, request));
    }
  };
  const lead = (group, request) => {
    group.leading = true;
    let ended = false, replayed = false;
    const ownBegun = request[REPLY_BEGUN], ownReplayed = request[ANSWER_REPLAYED];
    const sent = Object.defineProperties({ ...request }, {
      [REPLY_BEGUN]: { value: () => {
        if (!ended) { ended = true; group.leading = false; group.open = true; pump(); }
        if (typeof ownBegun === 'function') ownBegun();
      } },
      [ANSWER_REPLAYED]: { value: () => {
        replayed = true;
        if (typeof ownReplayed === 'function') ownReplayed();
      } } });
    const reply = call(sent);
    const settled = () => {
      if (ended) return;
      ended = true;
      group.leading = false;
      if (!replayed) group.open = true;
      pump();
    };
    reply.then(settled, settled);
    return reply;
  };
  return (request) => {
    const shared = sharedFirstOf(request);
    let group = null;
    if (shared !== null) {
      group = groups.get(shared) ?? null;
      if (group === null) groups.set(shared, group = { open: false, leading: false });
    }
    return new Promise((go) => { queue.push({ request, group, go }); pump(); });
  };
}
