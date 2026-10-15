// Parser-owned identity, never inferred from a filename, prompt, or completion prose.
// Observe the whole recording: a later contradictory ID invalidates the source.

/** C-03 (M33 conflicting sources): the only fields a conflict candidate record carries. */
export const CONFLICT_CANDIDATE_FIELDS = Object.freeze(['sessionId', 'childId', 'parentThreadId', 'taskPath']);
const MAX_ID = 200;
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID;
const validOrdinal = value => Number.isSafeInteger(value) && value >= 0;
const single = set => (set.size === 1 ? [...set][0] : null);
// Upstream `HistoryPosition`: when a position is recorded, all three of its fields are.
const historyPosition = value => value == null || (typeof value === 'object' && !Array.isArray(value)
  && validId(value.thread_id) && validOrdinal(value.end_ordinal_exclusive) && validOrdinal(value.end_byte_offset));
// A recorded but invalid fork source. It can never equal a recorded ID.
const INVALID_FORK_SOURCE = Symbol('invalid forked_from_id');

// M33 nested-fork ancestor metadata, condition (1): the opening row names its own subagent
// identity, one valid fork source, exactly one recorded parent thread and one valid boundary.
function openingFork(payload, spawn) {
  const parents = [payload?.parent_thread_id, spawn?.parent_thread_id].filter(value => value !== undefined);
  if (!payload?.source?.subagent || !validId(payload.id) || !validId(payload.forked_from_id)
    || !parents.length || !parents.every(value => validId(value) && value === parents[0])
    || !validOrdinal(payload.subagent_history_start_ordinal)) return null;
  return { id: payload.id, parent: parents[0], fork: payload.forked_from_id,
    start: payload.subagent_history_start_ordinal };
}

// The omitted ancestor row describes the ancestor, in the ancestor's ordinal space. None of its
// values is recorded or compared, but a damaged value is never hidden by omitting the row.
function ancestorWellFormed(payload, spawn) {
  return [payload.parent_thread_id, spawn?.parent_thread_id, payload.agent_path, spawn?.agent_path]
    .every(value => value === undefined || validId(value))
    && (payload.subagent_history_start_ordinal === undefined || validOrdinal(payload.subagent_history_start_ordinal))
    && (payload.forked_from_id == null || validId(payload.forked_from_id))
    && (payload.multi_agent_version == null || validId(payload.multi_agent_version))
    && historyPosition(payload.history_base);
}

export function recordingIdentity(adapter) {
  const ids = { sessionId: new Set(), childId: new Set(), parentThreadId: new Set(), taskPath: new Set(),
    multiAgentVersion: new Set() };
  let malformed = false;
  let nested = false;          // codex: the session_meta names a subagent source
  // claude: which of the two child markers — `isSidechain:true` and an agentId — the conversation
  // records carry. Booleans only, so the scan stays bounded however long the recording is.
  const marks = { both: false, sidechainOnly: false, agentOnly: false, neither: false };
  const boundaries = new Set();
  let forked = false;
  // C-03 conflict candidates: the distinct values of every identity-bearing row, including rows
  // omitted below as inherited. At most two per field; a third distinct value marks the field as
  // overflowing. They only scope a conflict and never join; value() never carries them.
  const seen = Object.fromEntries(CONFLICT_CANDIDATE_FIELDS.map(field => [field, new Set()]));
  const overflowed = new Set();
  let candidateInvalid = false;
  // C-03 M33 D repair: claude only, the number of contiguous runs of recorded sessionIds (capped at 3,
  // so the scan stays bounded). Two runs is the resumed shape: a whole prior block, then the current.
  let sessionRuns = 0;
  let lastSession;
  const candidate = (key, value) => {
    if (value === undefined) return;
    if (!validId(value)) { candidateInvalid = true; return; }
    if (seen[key].has(value)) return;
    if (seen[key].size < 2) seen[key].add(value);
    else overflowed.add(key);
  };
  // M33 nested fork: `opening` is undefined before the first session_meta row, then its proof or
  // null. `forkSources` holds the fork source of every COUNTED row (bounded); `ancestor` is the
  // ID of the one omitted ancestor row, if any.
  let opening;
  const forkSources = new Set();
  let ancestor = null;
  const remember = (key, value) => {
    if (value === undefined) return;
    if (typeof value !== 'string' || !value || value.length > MAX_ID) { malformed = true; return; }
    // Two distinct values permanently establish a conflict. Retaining later values would
    // grow with file length without changing the result of this identity check.
    if (ids[key].size < 2) ids[key].add(value);
  };
  return {
    observe(record, { repeatedKeys = false } = {}) {
      // C-02: a row that repeats a key hides one of two recorded values; never an identity.
      if (repeatedKeys && (adapter !== 'codex' || record?.type === 'session_meta')) {
        malformed = true;
        if (adapter === 'codex') opening ??= null;
        return;
      }
      if (adapter === 'codex') {
        if (record?.type !== 'session_meta') return;
        const payload = record?.payload;
        const spawn = payload?.source?.subagent?.thread_spawn;
        candidate('sessionId', payload?.id);
        for (const value of [payload?.parent_thread_id, spawn?.parent_thread_id]) candidate('parentThreadId', value);
        for (const value of [payload?.agent_path, spawn?.agent_path]) candidate('taskPath', value);
        // A child rollout may replay its parent's pre-fork history after its own opening
        // session_meta. The child's explicit ordinal boundary, own ID and subagent marker
        // together identify an inherited metadata row. Only that narrow case is omitted;
        // rows with child markers, missing ordinals or post-boundary conflicts still count.
        const start = boundaries.size === 1 ? [...boundaries][0] : null;
        const ownId = ids.sessionId.size === 1 ? [...ids.sessionId][0] : null;
        if (nested && start != null && ownId && Number.isSafeInteger(record.ordinal)
          && record.ordinal >= 0 && record.ordinal < start
          && typeof payload?.id === 'string' && payload.id && payload.id !== ownId
          && !payload?.source?.subagent && payload?.parent_thread_id === undefined
          && payload?.agent_path === undefined && payload?.subagent_history_start_ordinal === undefined) return;
        // M33: a fork of a subagent replays that subagent's own opening row below its boundary.
        // One such row is omitted when its ID is exactly both the recorded parent thread and the
        // recorded fork source of the opening row, and not the own ID. value() re-checks at the
        // end that the whole recording still agrees; otherwise the identity conflicts.
        if (opening && ancestor === null && Number.isSafeInteger(record.ordinal) && record.ordinal >= 0
          && record.ordinal < opening.start && payload?.id === opening.parent && payload.id === opening.fork
          && payload.id !== opening.id) {
          if (!ancestorWellFormed(payload, spawn)) malformed = true;
          ancestor = payload.id;
          return;
        }
        remember('sessionId', payload?.id);
        // This is classification only, never the identity used for joining.
        nested ||= !!payload?.source?.subagent;
        // An inherited paginated prefix is a fork too, even without copied JSONL rows.
        forked ||= payload?.forked_from_id != null || payload?.history_base != null;
        if (payload?.forked_from_id != null && forkSources.size < 2)
          forkSources.add(validId(payload.forked_from_id) ? payload.forked_from_id : INVALID_FORK_SOURCE);
        // Never retain an arbitrary producer version string in exported source metadata.
        // Every other value has the same closed marker: none can establish the V2-only
        // no-fork proof. A mixture of V2 and other still becomes an identity conflict.
        if (payload?.multi_agent_version != null) {
          const version = payload.multi_agent_version;
          if (typeof version !== 'string' || !version || version.length > 200) malformed = true;
          else if (version === 'v2') remember('multiAgentVersion', 'v2');
          else remember('multiAgentVersion', 'other');
        }
        for (const value of [payload?.parent_thread_id, spawn?.parent_thread_id]) remember('parentThreadId', value);
        for (const value of [payload?.agent_path, spawn?.agent_path]) remember('taskPath', value);
        // Preserve the existing child-history protocol exactly. The nested task metadata does
        // not gain authority to define or override the action boundary.
        const boundary = payload?.subagent_history_start_ordinal;
        if (boundary !== undefined) {
          const n = boundary;
          if (Number.isSafeInteger(n) && n >= 0) { if (boundaries.size < 2) boundaries.add(n); }
          else malformed = true;
        }
        if (opening === undefined) opening = openingFork(payload, spawn);
      } else if (adapter === 'claude') {
        candidate('sessionId', record.sessionId);
        candidate('childId', record.agentId);
        remember('sessionId', record.sessionId);
        remember('childId', record.agentId);
        if (validId(record.sessionId) && record.sessionId !== lastSession) {
          lastSession = record.sessionId;
          if (sessionRuns < 3) sessionRuns++;
        }
        if (['user', 'assistant', 'system'].includes(record.type)) {
          const sidechain = record.isSidechain === true;
          // The same validity `remember` applies: an invalid agentId is no child's identity.
          const agent = typeof record.agentId === 'string' && record.agentId.length > 0 && record.agentId.length <= 200;
          marks[sidechain ? (agent ? 'both' : 'sidechainOnly') : (agent ? 'agentOnly' : 'neither')] = true;
        }
      }
    },
    value() {
      const childId = ids.childId.size === 1 ? [...ids.childId][0] : null;
      // F110. Under ONE child identity every valid agentId is that child's, so a conversation
      // record carrying the agentId without `isSidechain:true` is drift — child-origin, damaged
      // shape — not inherited history, and it no longer makes the recording main-thread. Only a
      // record carrying NEITHER marker does. records.js classifies the same way (F52: a one-marker
      // record is dropped and declared child_history_partial), so a child with one record missing
      // isSidechain still links from the parent side. With no single child identity there is
      // nothing to drift from, and any non-sidechain record is main-thread, exactly as before.
      // The sidechain marker still decides that a recording is nested at all, so this can only
      // turn a drifted child from unlinked to linked-and-declared, never un-nest a recording.
      const own = marks.both || marks.sidechainOnly;
      const inherited = childId ? marks.neither : marks.agentOnly || marks.neither;
      const claudeNested = own && !inherited;
      // M33 condition (4): an omitted ancestor row stays justified only while, at the end of the
      // recording, the own ID, parent thread, fork source and boundary each have one value and the
      // parent thread and fork source are still exactly the omitted ID.
      const ancestorUnproved = ancestor !== null && !(ids.sessionId.size === 1 && boundaries.size === 1
        && single(ids.parentThreadId) === ancestor && single(forkSources) === ancestor);
      // C-03 M33 D: a Claude recording whose ONLY conflict is two recorded sessionIds — no malformed
      // or repeated-key row, no child identity — is the known resumed-parent shape (a copied
      // prior-session block, then the current one). It stays conflicting and has no file sessionId;
      // this names the shape only, so a hand-off may be joined by the sessionId its own rows recorded.
      // M33 D repair: exactly two sessionIds, in exactly two contiguous blocks. A third session, or a
      // row of the first after the second began (interleaving), is not the resumed shape.
      const sessionIdConflictOnly = adapter === 'claude' && !malformed && ids.sessionId.size === 2
        && sessionRuns === 2 && ids.childId.size === 0 && boundaries.size === 0 && ancestor === null;
      return { adapter,
        ...(sessionIdConflictOnly ? { sessionIdConflictOnly: true } : {}),
        sessionId: ids.sessionId.size === 1 ? [...ids.sessionId][0] : null,
        childId,
        parentThreadId: ids.parentThreadId.size === 1 ? [...ids.parentThreadId][0] : null,
        taskPath: ids.taskPath.size === 1 ? [...ids.taskPath][0] : null,
        multiAgentVersion: ids.multiAgentVersion.size === 1 ? [...ids.multiAgentVersion][0] : null,
        nested: adapter === 'claude' ? claudeNested : nested,
        mixedHistory: adapter === 'claude' ? own && inherited : false,
        forked, historyStart: boundaries.size === 1 ? [...boundaries][0] : null,
        identityConflict: malformed || Object.values(ids).some(set => set.size > 1) || boundaries.size > 1
          || ancestorUnproved };
    },
    /** C-03 private side channel that scopes a conflict. Never part of value() or ledger.sources;
     * the inventory redacts it before storage or any comparison. */
    candidates() {
      return { malformed: malformed || candidateInvalid,
        values: Object.fromEntries(CONFLICT_CANDIDATE_FIELDS.map(field => [field, [...seen[field]].sort()])),
        overflow: CONFLICT_CANDIDATE_FIELDS.filter(field => overflowed.has(field)) };
    },
  };
}
