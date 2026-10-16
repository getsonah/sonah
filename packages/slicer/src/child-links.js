// Pure child-recording linkage. The IO layer reads identities by their shape before calling this
// function (D90: nothing scans them; a ledger an earlier redactor scrubbed names the fields it scrubbed). A link proves only which recording belongs to a handoff; it says nothing about the
// completeness, correctness or authority of the child's work.

export const CHILD_LINK_REASONS = Object.freeze({
  DESCRIPTOR_INVALID: 'child_link_descriptor_invalid',
  PARENT_INVALID: 'child_link_parent_invalid',
  IDENTITY_REDACTED: 'child_link_identity_redacted',
  SOURCE_INVALID: 'child_link_source_invalid',
  SOURCE_CONFLICT: 'child_link_source_conflict',
  IDENTITY_CONFLICT: 'child_link_identity_conflict',
  ORDER_UNCHECKED: 'child_link_order_unchecked',
  UNAVAILABLE: 'child_link_unavailable',
  AMBIGUOUS: 'child_link_ambiguous',
});

const ADAPTERS = new Set(['claude', 'codex']);
const MAX_ID = 200;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const own = (value, name) => {
  if (!object(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};
const identity = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
  && /^[A-Za-z0-9_][A-Za-z0-9_./:-]*$/.test(value);
const namespace = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const sourceIndex = value => Number.isSafeInteger(value) && value >= 0;
const canonicalTask = value => typeof value === 'string' && value.length <= MAX_ID
  && /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/.test(value);
const parentTask = value => value === '/root' || canonicalTask(value);
const relativeTask = value => typeof value === 'string' && /^[a-z0-9_]+$/.test(value);
const SOURCE_FIELDS = new Set(['sessionId', 'childId', 'parentThreadId', 'taskPath']);
const DELEGATION_FIELDS = new Set(['callId', 'childId', 'taskName', 'target', 'sessionId']);

/**
 * C-03 M33 D: the Claude session a hand-off's child must have recorded. It is the sessionId the
 * hand-off's own tool_use and result rows recorded when that survived redaction; otherwise the
 * parent file's single identity. When both exist they must agree (a disagreement is a conflict,
 * never a choice); `undefined` means they disagreed. A scrubbed recorded value is never a key.
 */
function claudeHandOffSession(delegation, parent) {
  const fields = own(delegation, 'identityUncheckedFields');
  const scrubbed = Array.isArray(fields) && fields.includes('sessionId');
  const recorded = !scrubbed && identity(own(delegation, 'sessionId')) ? own(delegation, 'sessionId') : null;
  const file = identity(own(parent, 'sessionId')) ? own(parent, 'sessionId') : null;
  if (recorded && file && recorded !== file) return undefined;
  // A recorded value stands in for a missing file identity only for the known resumed shape.
  if (recorded && !file) return own(parent, 'sessionIdConflictOnly') === true ? recorded : null;
  return file;
}

/** A scrubbed field closes only the proof that needs it. A legacy coarse flag without the
 * field inventory, a malformed inventory, or a marked field retaining a value stays unknown. */
export function delegationIdentityUnverified(delegation) {
  if (!object(delegation)) return true;
  const fields = own(delegation, 'identityUncheckedFields');
  if (fields === undefined) return own(delegation, 'identityUnchecked') === true;
  if (!Array.isArray(fields) || fields.some(field => !DELEGATION_FIELDS.has(field))
    || new Set(fields).size !== fields.length
    || fields.some(field => own(delegation, field) != null)
    || (own(delegation, 'identityUnchecked') === true && fields.length === 0)) return true;
  const clean = field => !fields.includes(field);
  if (own(delegation, 'adapter') === 'claude')
    return !(clean('childId') && identity(own(delegation, 'childId')));
  if (own(delegation, 'adapter') === 'codex' && own(delegation, 'kind') === 'followup')
    return !(clean('target') && (canonicalTask(own(delegation, 'target'))
      || relativeTask(own(delegation, 'target'))));
  if (own(delegation, 'adapter') === 'codex' && own(delegation, 'kind') === 'spawn')
    return !(clean('childId') && identity(own(delegation, 'childId'))
      || clean('taskName') && canonicalTask(own(delegation, 'taskName')));
  return own(delegation, 'identityUnchecked') === true;
}

// A redacted field matters only if this candidate could still satisfy one of the recorded
// linkage proofs. An earlier redactor left clean fields intact and named the scrubbed fields; legacy
// coarse flags without that detail stay unknown. An unrelated safely excluded source cannot
// suppress an otherwise unique child.
function redactedCandidateCouldMatch(source, adapter, childId, task, parent) {
  const fields = own(source, 'identityUncheckedFields');
  if (fields === undefined) return own(source, 'identityUnchecked') === true;
  if (!Array.isArray(fields) || fields.some(field => !SOURCE_FIELDS.has(field))
    || new Set(fields).size !== fields.length
    || fields.some(field => own(source, field) != null)
    || (own(source, 'identityUnchecked') === true && fields.length === 0)) return true;
  const hidden = field => fields.includes(field);
  if (adapter === 'claude') {
    if (own(source, 'nested') !== true) return false;
    const childPossible = hidden('childId') && (hidden('sessionId')
      || own(source, 'sessionId') === own(parent, 'sessionId'));
    const parentPossible = hidden('sessionId') && own(source, 'childId') === childId;
    return childPossible || parentPossible;
  }
  const idPossible = identity(childId) && hidden('sessionId');
  const tuplePossible = canonicalTask(task) && identity(own(parent, 'sessionId'))
    && ((hidden('parentThreadId') && (hidden('taskPath') || own(source, 'taskPath') === task))
      || (hidden('taskPath') && (hidden('parentThreadId')
        || own(source, 'parentThreadId') === own(parent, 'sessionId'))));
  return idPossible || tuplePossible;
}

// C-03 (M33 conflicting sources): a source whose recorded identity conflicts blocks a hand-off
// only if one of its bounded, already-redacted candidate values could satisfy this hand-off's
// identity proof. A field in `hidden` or `overflow` matches any value. Without a verified
// candidate record (no Map from the caller, an invalid or unknown source key, a malformed
// identity or a damaged record) the source blocks every hand-off in its namespace, as before.
// Claude's nested flag is not required: the conflict itself can change it.
const RECORD_FIELDS = new Set(['malformed', 'values', 'hidden', 'overflow']);
function conflictCandidateCouldMatch(source, conflictCandidates, adapter, childId, task, parent) {
  if (!(conflictCandidates instanceof Map)) return true;
  const key = own(source, 'key');
  if (!sourceIndex(key) || !conflictCandidates.has(key)) return true;
  const record = conflictCandidates.get(key);
  if (!object(record) || Object.keys(record).some(field => !RECORD_FIELDS.has(field))
    || own(record, 'malformed') !== false) return true;
  const values = own(record, 'values'), hidden = own(record, 'hidden'), overflow = own(record, 'overflow');
  const fieldList = list => Array.isArray(list) && list.every(field => SOURCE_FIELDS.has(field))
    && new Set(list).size === list.length;
  if (!object(values) || !fieldList(hidden) || !fieldList(overflow)
    || Object.keys(values).some(field => !SOURCE_FIELDS.has(field))) return true;
  for (const field of SOURCE_FIELDS) {
    const list = own(values, field);
    if (!Array.isArray(list) || list.length > 2 || new Set(list).size !== list.length
      || list.some(value => typeof value !== 'string' || !value || value.length > MAX_ID)) return true;
  }
  const possible = (field, value) => hidden.includes(field) || overflow.includes(field)
    || own(values, field).includes(value);
  if (adapter === 'claude') return possible('childId', childId) && possible('sessionId', own(parent, 'sessionId'));
  const idPossible = identity(childId) && possible('sessionId', childId);
  const tuplePossible = canonicalTask(task) && identity(own(parent, 'sessionId'))
    && possible('parentThreadId', own(parent, 'sessionId')) && possible('taskPath', task);
  return idPossible || tuplePossible;
}

function parentAt(parents, index) {
  if (Array.isArray(parents)) return parents[index];
  if (object(parents)) return own(parents, String(index));
  return undefined;
}

function unresolved(descriptor, reason) {
  const copy = object(descriptor) ? { ...descriptor } : {};
  delete copy.link;
  return { ...copy, status: 'unresolved', reason };
}

/**
 * Link delegation receipts to explicitly supplied, already-scrubbed child metadata.
 * `parents` is indexed by delegation.source. No filesystem or transcript inference occurs here.
 * `conflictCandidates` is the inventory's private Map of redacted candidate records for its
 * conflicting sources, keyed by source key; a caller that supplies none keeps the
 * namespace-wide conflict block.
 */
export function resolveChildLinks(delegations, sources, parents, { conflictCandidates } = {}) {
  if (!Array.isArray(delegations)) return [];
  const candidates = Array.isArray(sources) ? sources : [];

  return delegations.map((delegation) => {
    if (!object(delegation) || own(delegation, 'status') !== 'unresolved'
      || own(delegation, 'reason') !== 'delegation_child_unchecked'
      || !ADAPTERS.has(own(delegation, 'adapter')) || !sourceIndex(own(delegation, 'source'))) {
      return unresolved(delegation, CHILD_LINK_REASONS.DESCRIPTOR_INVALID);
    }
    if (delegationIdentityUnverified(delegation)) {
      return unresolved(delegation, CHILD_LINK_REASONS.IDENTITY_REDACTED);
    }
    if (own(delegation, 'kind') === 'followup') return unresolved(delegation, CHILD_LINK_REASONS.DESCRIPTOR_INVALID);
    const childId = own(delegation, 'childId');
    const task = own(delegation, 'taskName');
    if (!identity(childId) && !(own(delegation, 'adapter') === 'codex' && canonicalTask(task))) {
      return unresolved(delegation, CHILD_LINK_REASONS.DESCRIPTOR_INVALID);
    }

    let parent = parentAt(parents, own(delegation, 'source'));
    const adapter = own(delegation, 'adapter');
    if (!object(parent) || own(parent, 'adapter') !== adapter || !namespace(own(parent, 'namespace'))) {
      return unresolved(delegation, CHILD_LINK_REASONS.PARENT_INVALID);
    }
    // B2: one Claude project namespace holds the children of EVERY session in that project, and
    // a nested recording carries the sessionId of the parent that launched it. Corroborating it
    // is not inferring a parent pointer — the agentId remains the join identity — but a parent
    // whose own session identity was never recorded cannot corroborate anything.
    // C-03 M33 D: a resumed parent has no single file identity; its hand-off's own recorded
    // sessionId corroborates instead (claudeHandOffSession), and every check below uses it.
    if (adapter === 'claude') {
      const session = claudeHandOffSession(delegation, parent);
      if (session === undefined) return unresolved(delegation, CHILD_LINK_REASONS.IDENTITY_CONFLICT);
      if (!identity(session)) return unresolved(delegation, CHILD_LINK_REASONS.PARENT_INVALID);
      if (session !== own(parent, 'sessionId')) parent = { ...parent, sessionId: session };
    }
    const scope = candidates.filter(source => object(source)
      && own(source, 'adapter') === adapter && own(source, 'namespace') === own(parent, 'namespace'));

    // A scrubbed or conflicting identity in the relevant namespace could be this child. It must
    // not be ignored in favour of a convenient visible candidate.
    if (scope.some(source => redactedCandidateCouldMatch(source, adapter, childId, task, parent))) {
      return unresolved(delegation, CHILD_LINK_REASONS.IDENTITY_REDACTED);
    }
    if (scope.some(source => own(source, 'identityConflict') === true
      && conflictCandidateCouldMatch(source, conflictCandidates, adapter, childId, task, parent))) {
      return unresolved(delegation, CHILD_LINK_REASONS.SOURCE_CONFLICT);
    }
    // A conflicting source is never a link target, even one that could not be this child.
    const eligible = scope.filter(source => own(source, 'identityConflict') !== true);

    const opaqueMatches = identity(childId) ? eligible.filter(source => adapter === 'claude'
      ? own(source, 'nested') === true && own(source, 'childId') === childId
        && own(source, 'sessionId') === own(parent, 'sessionId')
      : own(source, 'sessionId') === childId) : [];
    const tupleMatches = adapter === 'codex' && canonicalTask(task) && identity(own(parent, 'sessionId'))
      ? eligible.filter(source => own(source, 'taskPath') === task
        && own(source, 'parentThreadId') === own(parent, 'sessionId')) : [];
    if (identity(childId) && canonicalTask(task)
      && (opaqueMatches.length !== 1 || tupleMatches.length !== 1 || opaqueMatches[0] !== tupleMatches[0])) {
      return unresolved(delegation, CHILD_LINK_REASONS.IDENTITY_CONFLICT);
    }
    const identityMatches = [...new Set([...opaqueMatches, ...tupleMatches])];
    if (identityMatches.some(source => !sourceIndex(own(source, 'key')))) {
      return unresolved(delegation, CHILD_LINK_REASONS.SOURCE_INVALID);
    }
    const matches = identityMatches;
    if (!matches.length) return unresolved(delegation, CHILD_LINK_REASONS.UNAVAILABLE);
    if (matches.length > 1 || new Set(matches.map(source => own(source, 'key'))).size !== 1) {
      return unresolved(delegation, CHILD_LINK_REASONS.AMBIGUOUS);
    }
    const match = matches[0];
    return { ...delegation, status: 'linked', reason: 'child_recording_linked',
      link: { source: own(match, 'key') } };
  });
}

/**
 * A missing child-history ordinal is safe to treat as zero only for a verified Codex V2
 * no-history spawn. The upstream V2 spawn handler maps the exact `fork_turns: "none"` call
 * to `fork_mode: None`; agent control then creates a new thread instead of copying a parent's
 * rollout. This proof is scoped to the exact linked parent/child tuple. The reader still checks
 * every row ordinal and the child's final metadata before releasing any actions.
 * Source basis: openai/codex 6824dabe0393337a38cb257d5fe75ae5ca168470,
 * codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs and
 * codex-rs/core/src/agent/control/spawn.rs. This pins a source snapshot, not the
 * installed Codex runtime version. A non-null history_base violates the no-fork
 * premise and is rejected by recordingIdentity.
 *
 * Keep this separate from ordinary linkage: a linked child can have inherited history.
 */
export function proveNoForkChildHistory(delegation, child, parent) {
  if (!object(delegation) || !object(child) || !object(parent)
    || own(delegation, 'adapter') !== 'codex' || own(delegation, 'kind') !== 'spawn'
    || own(delegation, 'status') !== 'linked' || own(delegation, 'forkTurns') !== 'none'
    || !object(own(delegation, 'link')) || !sourceIndex(own(own(delegation, 'link'), 'source'))
    || own(own(delegation, 'link'), 'source') !== own(child, 'key')
    || own(parent, 'adapter') !== 'codex' || !identity(own(parent, 'sessionId'))
    || own(parent, 'identityConflict') === true || own(parent, 'identityUnchecked') === true
    || !namespace(own(parent, 'namespace')) || own(child, 'namespace') !== own(parent, 'namespace')
    || own(child, 'adapter') !== 'codex' || own(child, 'nested') !== true
    || own(child, 'identityConflict') !== false || own(child, 'identityUnchecked') === true
    || own(child, 'multiAgentVersion') !== 'v2' || own(child, 'forked') !== false
    || own(child, 'historyStart') !== null || !identity(own(child, 'sessionId'))
    || own(child, 'parentThreadId') !== own(parent, 'sessionId')
    || !canonicalTask(own(delegation, 'taskName'))
    || own(child, 'taskPath') !== own(delegation, 'taskName')
    || (own(delegation, 'childId') != null && own(delegation, 'childId') !== own(child, 'sessionId'))) return null;
  return Object.freeze({ contract: 'codex-v2-no-fork/1', sessionId: own(child, 'sessionId'),
    parentThreadId: own(parent, 'sessionId'), taskPath: own(child, 'taskPath') });
}

/**
 * The canonical Codex task path a hand-off reference names, exactly as Codex nests it: a canonical path
 * (`/root/…`) names itself; a relative task name names `<own path>/<name>`, where the own path is the recording's
 * recorded `taskPath` — or, since Codex root rollouts record none, `/root`, but only when the parser-owned identity
 * is an intact, non-nested root. Anything else names no path (`null`). `parent` is that recording's source identity
 * (recording-identity.js `value()`); only its recorded fields are read. Shared by the follow-up link above and the
 * M33 F final-answer join (inter-agent.js), so the two can never nest a name differently.
 */
export function codexTaskPath(reference, parent) {
  if (canonicalTask(reference)) return reference;
  if (!relativeTask(reference)) return null;
  const path = codexOwnTaskPath(parent);
  const expected = path ? `${path}/${reference}` : null;
  return canonicalTask(expected) ? expected : null;
}

/**
 * M33 F repair. The recording's OWN Codex task path, from its parser-owned identity only: its recorded `taskPath`
 * (when its identity is not in conflict), else `/root` when the identity is an intact, non-nested root (Codex root
 * rollouts record no task path), else `null`. The nesting base of `codexTaskPath`, and the path a helper's final
 * report must be addressed to (its header's Task name, the row's recipient) for this recording to have received it.
 */
export function codexOwnTaskPath(parent) {
  if (!object(parent)) return null;
  if (own(parent, 'identityConflict') !== true && parentTask(own(parent, 'taskPath'))) return own(parent, 'taskPath');
  const root = own(parent, 'nested') === false && own(parent, 'taskPath') === null
    && own(parent, 'parentThreadId') === null && own(parent, 'historyStart') === null
    && own(parent, 'forked') === false && own(parent, 'identityConflict') === false
    && identity(own(parent, 'sessionId'));
  return root ? '/root' : null;
}

const earlier = (followup, spawn) => {
  const fr = own(followup, 'record'), sr = own(spawn, 'record');
  if (Number.isSafeInteger(fr) && fr > 0 && Number.isSafeInteger(sr) && sr > 0) return sr < fr;
  const ft = own(followup, 'turn'), st = own(spawn, 'turn');
  return Number.isSafeInteger(ft) && ft >= 0 && Number.isSafeInteger(st) && st >= 0 && st < ft;
};

/** A follow-up can reuse only an already linked earlier spawn; it cannot discover a source. */
export function resolveFollowupLink(delegation, verifiedEarlierSpawns, parents) {
  if (!object(delegation) || own(delegation, 'kind') !== 'followup'
    || own(delegation, 'status') !== 'unresolved' || own(delegation, 'adapter') !== 'codex'
    || own(delegation, 'reason') !== 'delegation_child_unchecked'
    || !sourceIndex(own(delegation, 'source')) || delegationIdentityUnverified(delegation)) {
    return unresolved(delegation, delegationIdentityUnverified(delegation)
      ? CHILD_LINK_REASONS.IDENTITY_REDACTED : CHILD_LINK_REASONS.DESCRIPTOR_INVALID);
  }
  const parent = parentAt(parents, own(delegation, 'source'));
  if (!object(parent) || own(parent, 'adapter') !== 'codex' || !namespace(own(parent, 'namespace'))
    || own(parent, 'identityUnchecked') === true || own(parent, 'identityConflict') === true) {
    return unresolved(delegation, CHILD_LINK_REASONS.PARENT_INVALID);
  }
  const target = own(delegation, 'target');
  if (!canonicalTask(target) && !relativeTask(target)) return unresolved(delegation, CHILD_LINK_REASONS.DESCRIPTOR_INVALID);
  // The actual child must still be an earlier, uniquely linked canonical spawn from this same source.
  const expected = codexTaskPath(target, parent);
  if (expected === null) return unresolved(delegation, CHILD_LINK_REASONS.PARENT_INVALID);
  const same = (Array.isArray(verifiedEarlierSpawns) ? verifiedEarlierSpawns : []).filter(spawn => object(spawn)
    && own(spawn, 'kind') === 'spawn' && own(spawn, 'adapter') === 'codex'
    && own(spawn, 'source') === own(delegation, 'source') && own(spawn, 'status') === 'linked'
    && !delegationIdentityUnverified(spawn) && own(spawn, 'identityConflict') !== true
    && object(own(spawn, 'link')) && sourceIndex(own(own(spawn, 'link'), 'source'))
    && own(spawn, 'taskName') === expected);
  if (same.some(spawn => !earlier(delegation, spawn))) return unresolved(delegation, CHILD_LINK_REASONS.ORDER_UNCHECKED);
  if (!same.length) return unresolved(delegation, CHILD_LINK_REASONS.UNAVAILABLE);
  if (same.length !== 1) return unresolved(delegation, CHILD_LINK_REASONS.AMBIGUOUS);
  return { ...delegation, status: 'linked', reason: 'child_followup_linked', link: { ...same[0].link },
    spawnCallId: own(same[0], 'callId') };
}
