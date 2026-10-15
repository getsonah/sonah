// C-01 event identity (stable event ids, 2026-10-07), for tests. Every canonical event is named by the recorder's own
// identity of its row now (a Claude Code row's uuid and block, a Codex call_id and part, else the row's position), so a
// test written against a recording names an event by a fixed notation instead: the positional label the event had before
// stable ids (`A<turn>-<seq>`, `I<turn>`, `I<turn>-<n>`, `A<turn>-<seq>-r`, `C<turn>-<slot>-<ordinal>`, …), paired with
// its id by the adapter's own migration map (`positionalEventIds`: the same ledger adapted with its identities taken out
// — the session's TWIN — holds the same events in the same order). Never by parsing an id.
//
// A pin taken before stable ids stays checkable byte for byte: rendered back (`beforeStableIds`), a session's parts are
// its twin's; a request's text is its twin's once the lines a digest of event ids makes (`scopeDigest`) are taken from
// the twin's request (`textBeforeStableIds` checks that and throws on any other difference). So such a pin also proves
// that only the ids moved.
import { sessionFromLedger, positionalEventIds } from '../adapters/sonah-ledger.js';

const IDENTIFIED = Object.freeze(['ask', 'instructions', 'interjections', 'ledger', 'commentary', 'sayings', 'marks',
  'delegations']);
/** `ledger` with every recorded identity taken out, as a slicer before stable ids wrote it (its children's too). */
export const withoutIdentity = (ledger) => ({ ...ledger,
  ...Object.fromEntries(IDENTIFIED.filter((field) => Array.isArray(ledger?.[field]))
    .map((field) => [field, ledger[field].map((element) => (element !== null && typeof element === 'object'
      ? (({ identity: _identity, ...rest }) => rest)(element) : element))])),
  ...(Array.isArray(ledger?.children) ? { children: ledger.children.map((unit) => ({ ...unit,
    ...(unit?.ledger ? { ledger: withoutIdentity(unit.ledger) } : {}) })) } : {}) });

/** D68 (C-02 "M36 recorded facts"): a ledger as the slicer wrote it before the recorder's typed facts (`recorded` on an
 *  action and on a hand-off receipt) and the ledger format they came with (`schemaVersion` 3 → 2), children included:
 *  every other byte is the ledger's own. */
export const withoutRecordedFacts = (ledger) => ({ ...ledger,
  ...(ledger?.schemaVersion === 3 ? { schemaVersion: 2 } : {}),
  ...Object.fromEntries(['ledger', 'delegations'].filter((field) => Array.isArray(ledger?.[field]))
    .map((field) => [field, ledger[field].map((element) => (element !== null && typeof element === 'object'
      ? (({ recorded: _recorded, ...rest }) => rest)(element) : element))])),
  ...(Array.isArray(ledger?.children) ? { children: ledger.children.map((unit) => ({ ...unit,
    ...(unit?.ledger ? { ledger: withoutRecordedFacts(unit.ledger) } : {}) })) } : {}) });

const positional = new WeakMap();
const twins = new WeakMap();

/** Register `session` (adapted from `ledger` with `options`) for the helpers below; returns it. */
export function register(session, ledger, options = {}) {
  positional.set(session, positionalEventIds(ledger, options));
  twins.set(session, sessionFromLedger(withoutIdentity(ledger), options));
  return session;
}
/** `sessionFromLedger`, registered. */
export const adapt = (ledger, options = {}) => register(sessionFromLedger(ledger, options), ledger, options);
/** The registered session's twin: the same ledger adapted with its identities taken out (the positional ids). */
export const twinOf = (session) => twins.get(session);

/** The id of the event a test names `label` in a registered `session`. */
export function named(session, label) {
  const map = positional.get(session);
  if (!map?.has(label)) throw new Error(`no event is labelled ${label}`);
  return map.get(label);
}
/** The positional label of the event `id` names in a registered `session` (the inverse of `named`); else `id` as is. */
export function labelOf(session, id) {
  for (const [label, now] of positional.get(session) ?? []) if (now === id) return label;
  return id;
}

/**
 * `value` — a session's parts, or a request's text — with every id the registered `session`'s events carry now replaced
 * by its positional label. A part is renamed where a string value IS an id; a text wherever an id occurs, longest first
 * (an id occurs inside another only as its prefix, `<id>.r`).
 */
export function beforeStableIds(session, value) {
  const back = new Map([...(positional.get(session) ?? [])].map(([label, now]) => [now, label]));
  if (typeof value === 'string') {
    let text = value;
    for (const now of [...back.keys()].sort((a, b) => b.length - a.length)) text = text.split(now).join(back.get(now));
    return text;
  }
  return JSON.parse(JSON.stringify(value), (_key, part) => (typeof part === 'string' && back.has(part) ? back.get(part) : part));
}
/** The parts a session digest reads (`events`, `blobs`, `adapterGaps`, `children`), rendered back. */
export const sessionBeforeStableIds = (session) => beforeStableIds(session, { events: session.events,
  blobs: session.blobs, adapterGaps: session.adapterGaps, children: session.children });

/** D68 (C-02 "M36 recorded facts"): a session's bytes as they were before the adapter carried the recorder's typed facts
 *  on an invocation (`recorded`), rendered back: every other byte is the session's own, so a pin taken before them stays
 *  checkable byte for byte. Works on a session or on any of the plain renderings above. */
export const beforeRecordedFacts = (session) => ({ events: session.events.map(({ recorded: _recorded, ...event }) => event),
  blobs: session.blobs, adapterGaps: session.adapterGaps, children: session.children });

/** A request's lines a digest of its event ids makes (C-05 instruction review scope). */
export const ID_DIGEST_LINE = /^scopeDigest: \S+$/gm;
/**
 * Text `now` (built from the registered `session`) rendered back, with its id digests taken from `before` (the same text
 * built from the session's twin). Throws unless the result is `before`, byte for byte: only ids moved.
 */
export function textBeforeStableIds(session, now, before) {
  if (typeof now !== 'string') return now;
  const digests = String(before).match(ID_DIGEST_LINE) ?? [];
  let at = 0;
  const back = beforeStableIds(session, now).replace(ID_DIGEST_LINE, () => digests[at++] ?? '');
  if (back !== before) throw new Error('stable ids moved a request beyond its ids');
  return back;
}
/** A request's texts (`system`, `prompt`, `evidencePrompt`), each rendered back against the twin's `before` request. */
export const requestBeforeStableIds = (session, request, before) => ({ ...request,
  ...Object.fromEntries(['system', 'prompt', 'evidencePrompt'].filter((field) => typeof request?.[field] === 'string')
    .map((field) => [field, textBeforeStableIds(session, request[field], before?.[field])])) });
