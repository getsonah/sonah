// C-01 event identity (stable event ids, 2026-10-07; contract C-01 "Event identity").
//
// Where the recorder wrote each element of the ledger, so the evidence adapter names every canonical event by the
// recorder's OWN record identity — never by a turn number, a sequence or an ordinal, which any slicer change that
// renumbers turns moves. Structure only, never wording: the row's position in its recording (`stream`, the lineage's
// file index; `record`, the one-based line), the content block (`block`: the message's content index, or the part of a
// Codex call), and the identifier the recorder itself wrote for the row or the call (`native`):
//
//   Claude Code  the row's `uuid` (a copied row keeps it across forked and resumed recordings). A row that records no
//                uuid is marked `unidentified`: it is named by its row position, and counted.
//   Codex        a call's `call_id` (or a native item's own `id`), a message's item `id`, where the recorder wrote one;
//                otherwise its row position IS its identity (rollouts are append-only): no gap.
//   Cursor       its row position (the transcript writes no row id): no gap.
//
// `sub` names a sub-event derived from one recorded block (closed, `IDENTITY_SUBS`): a command's k-th shell write, the
// k-th answer one result carries, the k-th agent a Workflow call's run started, a turn's closing statement, a compaction
// or interruption the recorder marked, the join of a lineage's next file. The evidence adapter composes the id
// (sonah-ledger.js `ledgerEventIds`); an earlier redaction may have withheld `native` (fail closed: `withheld: true`;
// D90: none does now), and the adapter then names the event by its row position, counted.
//
// Pure: no I/O, no clock, no model.

/** A recorder identifier a ledger may carry: a letter or digit, then letters, digits, `_` or `-` — never a `.`, which
 *  separates the parts of a composed id. Anything else is not carried: the event is named by its row position. */
export const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** The closed vocabulary of derived sub-events (`sub`): `w<k>` a command's k-th shell write, `a<k>` the k-th answer of
 *  one result, `g<k>` the k-th agent candidate of a Workflow call's run (its journal order), `final` a turn's closing
 *  statement, `compaction` a compaction row, `join` a lineage file join, `interrupt` a typed interruption. */
export const IDENTITY_SUBS = Object.freeze({
  shellWrite: (k) => `w${k}`,
  answer: (k) => `a${k}`,
  workflowAgent: (k) => `g${k}`,
  final: 'final',
  compaction: 'compaction',
  join: 'join',
  interrupt: 'interrupt',
});
export const IDENTITY_SUB = /^(?:[wag](?:0|[1-9]\d{0,5})|final|compaction|join|interrupt)$/;

/** The keys an identity may carry. `unidentified`: a Claude Code row that records no uuid. `withheld`: an earlier
 *  redaction's — the recorder's id was scrubbed (fails closed); a ledger it wrote is still read. */
export const IDENTITY_KEYS = Object.freeze(['stream', 'record', 'block', 'native', 'sub', 'unidentified', 'withheld']);

const count = (value, least) => Number.isSafeInteger(value) && value >= least;
const native = (value) => (typeof value === 'string' && NATIVE_ID.test(value) ? value : null);

/** The identifier the recorder wrote for a whole row — Claude Code's `uuid`, a Codex message's item `id` (codex.js
 *  `nativeId`) — and whether the recorder's identity of a row is that identifier (Claude Code) or its position. */
function rowNative(rec) {
  const adapter = rec?.adapter ?? 'claude';
  if (adapter === 'claude') {
    const id = native(rec?.raw?.uuid);
    return id !== null ? { native: id } : { unidentified: true };
  }
  if (adapter === 'codex') {
    const id = native(rec?.nativeId);
    return id !== null ? { native: id } : {};
  }
  return {};
}

/** `{stream, record}` of a record: its lineage file and one-based line (or, for a record a caller built without one,
 *  its index in the records read). */
function rowAt(rec, recordIndex) {
  return { stream: count(rec?.source, 0) ? rec.source : 0,
    record: count(rec?.line, 1) ? rec.line : recordIndex + 1 };
}

/** The identity of a row's block (`block`, its content index; 0 for a row recorded as one text), or of a sub-event
 *  derived from the row (`sub`; `block` null for the row as a whole). */
export function rowIdentity(rec, recordIndex, block = 0, sub = null) {
  return { ...rowAt(rec, recordIndex), ...(count(block, 0) ? { block } : {}), ...rowNative(rec),
    ...(sub !== null ? { sub } : {}) };
}

/**
 * The identity of a tool call. Claude Code: its row and content block. Codex: the call the recorder wrote — its row
 * and part (`sourceLocator`, codex.js) and its `call_id` (or native item id) when the recorder wrote one (`nativeId`,
 * never a synthetic id this reader made up).
 */
export function callIdentity(rec, recordIndex, use, block) {
  if ((rec?.adapter ?? 'claude') !== 'codex') return rowIdentity(rec, recordIndex, block);
  const locator = use?.sourceLocator;
  const at = rowAt(rec, recordIndex);
  const id = native(use?.nativeId);
  return { stream: at.stream, record: count(locator?.record, 1) ? locator.record : at.record,
    block: count(locator?.part, 0) ? locator.part : block, ...(id !== null ? { native: id } : {}) };
}

/** A sub-event derived from `identity` (a shell write of a command, an answer of a result). */
export const derivedIdentity = (identity, sub) => ({ ...identity, sub });

/** Is `value` an identity this module writes (or redaction left): only its keys, in shape, with a block or a sub? */
export function validIdentity(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some((key) => !IDENTITY_KEYS.includes(key))) return false;
  return count(value.stream, 0) && count(value.record, 1)
    && (value.block === undefined || count(value.block, 0))
    && (value.native === undefined || native(value.native) !== null)
    && (value.sub === undefined || (typeof value.sub === 'string' && IDENTITY_SUB.test(value.sub)))
    && (value.unidentified === undefined || value.unidentified === true && value.native === undefined)
    && (value.withheld === undefined || value.withheld === true && value.native === undefined)
    && (value.block !== undefined || value.sub !== undefined);
}
