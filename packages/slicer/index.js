// sliceLineage — the whole deterministic compression stage.
//
// One session file is not one unit of work. A compaction produces a NEW file whose first turns
// summarise the old one, so a single task can span several files, and a directory can hold several
// unrelated tasks. The caller names a lineage's files, oldest first; `sliceLineage` emits ONE ledger per lineage.

import { readSession, SCHEMA_VERSION } from './src/records.js';
import { opensTurn, partsOf, applyLabel, emptyCounts, countLabel, LINEAGE_ROLES, LABEL_GAPS } from './src/labels.js';
import { buildEvents } from './src/events.js';
import { rowIdentity, IDENTITY_SUBS } from './src/event-identity.js';
import { collectDelegationEvidence } from './src/delegation-records.js';
import { INTER_AGENT_COUNTS, INTER_AGENT_LOSS_COUNTS } from './src/inter-agent.js';
import { WORKFLOW_LIMITS, safeSessionId } from './src/workflow-runs.js';
import { codexOwnTaskPath } from './src/child-links.js';
import { recordingHome } from './src/before.js';

export { SCHEMA_VERSION };
export { NATIVE_ID, IDENTITY_SUB, IDENTITY_SUBS, IDENTITY_KEYS } from './src/event-identity.js';
export * from './src/outcome.js';

/**
 * The slicer's own closed reason vocabulary — what a ledger can declare about the completeness of
 * its own capture. Declared once and read from here, never spelled out at a call site (F15): a
 * literal is invisible to the table, survives a rename of the member, and is how a reason that is
 * no longer declared goes on being emitted. Per-reason false-positive rates must stay computable.
 *
 * A reason is a TOKEN. A count belongs in a sibling field on the drop, never glued to the string
 * (F14): `unparseable_lines:3` is not one reason, it is one reason per possible count.
 *
 * The session layer's CHILD_CAPTURE_REASONS (cli/src/session-evidence.js) declares the two delegation
 * members again, because it writes the same `capture.reasons`. The slicer does not import it — a
 * deterministic stage takes no dependency on the session layer — so the two tables are checked
 * against each other in packages/cli/test/reason-vocabulary.test.js.
 */
export const SLICE_REASONS = Object.freeze({
  UNPARSEABLE_LINES:    'unparseable_lines',
  UNKNOWN_SCHEMA_FILES: 'unknown_schema_files',
  DELEGATED_CAPTURE:    'delegated_capture_unchecked',
  DELEGATED_REVIEW:     'delegated_review_unchecked',
  CAPTURE_INCOMPLETE:   'capture_incomplete',
  KNOWN_CODE_EFFECT_UNTYPED: 'known_code_effect_untyped',
  // A child recording kept its own records but dropped drifted ones (F52, src/records.js).
  CHILD_HISTORY_PARTIAL: 'child_history_partial',
  // A child recording's whole history was withheld: inherited main-thread records, or no single
  // child identity to separate them by (W3-2, F52, src/records.js; F111 made it a member).
  CHILD_HISTORY_UNCHECKED: 'child_history_unchecked',
});

/** C-02 M33 native-first (refreeze): the integer capture counts a Codex recording with the
 *  paginated item stream declares, summed over the lineage's files. `nativeItems` counts the native
 *  items emitted as actions; `nativeInventoryGaps` the (turn, family) pairs whose inventory is not
 *  proved complete; `nativeInventoryShortfall` sums max(P - N, 1) over those pairs (an unproved but
 *  balanced pair still adds 1); `nativeCommandShortfall` and `nativeWriteShortfall` sum only
 *  max(P - N, 0) over the command and file families — dispatched calls no native item accounts for,
 *  never the unproved floor. Each of the three shortfalls is declared as its own counted gap
 *  (sonah-ledger `NATIVE_SHORTFALL_GAPS`). */
export const NATIVE_CAPTURE_COUNTS = Object.freeze(['nativeItems', 'nativeInventoryGaps',
  'nativeInventoryShortfall', 'nativeCommandShortfall', 'nativeWriteShortfall']);

/** Reasons whose drop carries a count. Zero is not a gap, and the count is read from the field;
 *  the `reason:N` form is still recognised so a ledger persisted before F14 keeps its meaning. */
const COUNTED = new Set([SLICE_REASONS.UNPARSEABLE_LINES, SLICE_REASONS.UNKNOWN_SCHEMA_FILES]);
const LEGACY_COUNTED = /^(?:unparseable_lines|unknown_schema_files):[1-9]\d*$/;
function countedGap(ledger) {
  return (ledger?.dropped ?? []).some((d) => {
    const reason = String(d?.reason ?? '');
    return COUNTED.has(reason) ? Number(d?.count) > 0 : LEGACY_COUNTED.test(reason);
  });
}

/**
 * @param {string[]} files  one lineage, oldest first
 * @param {{cwd?: string, sidechainAsMain?: boolean, lineageFiles?: string[]}} opts
 *   `lineageFiles` names the sources in the ledger when the paths on disk are not their identity
 *   — an Entire checkpoint's blobs are materialised to a scratch directory, and recording that
 *   directory would put a random string inside a hashed structure (M89). Same length and order
 *   as `files`, or it is ignored.
 * @returns {Promise<Ledger>}
 */
export async function sliceLineage(files, opts = {}) {
  const all = [];
  const meta = { sessionId: null, cwd: opts.cwd ?? null, version: null, gitBranch: null };
  let corrupt = 0;
  const boundaries = [];
  let capture = null;
  const sources = [];
  let onlyTypedCommunicationSourceLoss = true;

  let unknownSchemaFiles = 0;
  // M34 labels: the label values of rows that are counted but are no record (a harness attachment, a Codex developer
  // message, encrypted reasoning), each `{uuid, value}`.
  const unrecorded = [];
  // M34 labels review (F7): whether a Claude file of the lineage is a helper's by its rows (records.js `helperRows`).
  let helperRows = false;
  for (const [i, file] of files.entries()) {
    const { records, meta: m, corrupt: c, unknownSchema } = await readSession(file, {
      // M34 labels: a helper's recording is read whole by its own structure (records.js), never by its path.
      sidechainAsMain: opts.sidechainAsMain,
      childRecording: opts.childRecording ?? false,
      noForkChildProof: files.length === 1 ? opts.noForkChildProof ?? null : null,
    });
    corrupt += c;
    if (m.helperRows === true) helperRows = true;
    sources.push(m.sourceIdentity ?? { adapter: m.agent ?? 'unknown', identityConflict: true });
    if (unknownSchema) unknownSchemaFiles++;
    if (m.capture) {
      capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
        unmapped: 0, interAgentMessagesUnparsed: 0, reasons: [], incomplete: false };
      for (const key of ['calls', 'wrappers', 'captured', 'unsupported', 'missing', 'unmapped']) {
        capture[key] += Number.isFinite(m.capture[key]) ? m.capture[key] : 0;
      }
      // C-02 M33 native-first counts exist only for a recording with the paginated item stream;
      // a lineage carries them only when one of its files did, so other ledgers keep their bytes.
      for (const key of NATIVE_CAPTURE_COUNTS)
        if (Number.isSafeInteger(m.capture[key]) && m.capture[key] >= 0)
          capture[key] = (capture[key] ?? 0) + m.capture[key];
      if (Number.isSafeInteger(m.capture.interAgentMessagesUnparsed)
        && m.capture.interAgentMessagesUnparsed >= 0)
        capture.interAgentMessagesUnparsed += m.capture.interAgentMessagesUnparsed;
      else if (Object.hasOwn(m.capture, 'interAgentMessagesUnparsed'))
        onlyTypedCommunicationSourceLoss = false;
      // M33 F: the other closed inter-agent counters exist only for a file that had such rows; a lineage carries
      // one only when one of its files did, so other ledgers keep their bytes. A value that is not a count is
      // another loss, never read as one.
      for (const key of Object.values(INTER_AGENT_COUNTS)) {
        if (key === INTER_AGENT_COUNTS.unparsed || !Object.hasOwn(m.capture, key)) continue;
        if (Number.isSafeInteger(m.capture[key]) && m.capture[key] >= 0)
          capture[key] = (capture[key] ?? 0) + m.capture[key];
        else onlyTypedCommunicationSourceLoss = false;
      }
      if (m.capture.incomplete && m.capture.interAgentMessagesSoleIncomplete !== true)
        onlyTypedCommunicationSourceLoss = false;
      if (m.capture.unsupportedRowChannels) {
        capture.unsupportedRowChannels ??= {};
        for (const channel of ['instructions', 'commentary', 'actions', 'observations'])
          capture.unsupportedRowChannels[channel] = (capture.unsupportedRowChannels[channel] ?? 0)
            + (Number.isSafeInteger(m.capture.unsupportedRowChannels[channel])
              ? m.capture.unsupportedRowChannels[channel] : 0);
      }
      if (Number.isSafeInteger(m.capture.unclassifiedRows))
        capture.unclassifiedRows = (capture.unclassifiedRows ?? 0) + m.capture.unclassifiedRows;
      // C-03 M33 D: harness-context rows are counted scaffold, never a loss (src/records.js).
      if (Number.isSafeInteger(m.capture.harnessContextRows) && m.capture.harnessContextRows > 0)
        capture.harnessContextRows = (capture.harnessContextRows ?? 0) + m.capture.harnessContextRows;
      // A typed, unsupported row already names the affected channels. Keep the historical
      // generic action gap for any other incomplete capture, including persisted old ledgers.
      if (m.capture.incomplete && m.capture.attributedIncomplete !== true)
        capture.genericIncomplete = true;
      else capture.genericIncomplete ??= false;
      capture.incomplete ||= !!m.capture.incomplete;
      capture.reasons = [...new Set([...capture.reasons, ...(m.capture.reasons ?? [])])];
    }
    for (const k of ['sessionId', 'cwd', 'version', 'gitBranch']) {
      if (meta[k] == null && m[k] != null) meta[k] = m[k];
    }
    if (i > 0) boundaries.push({ at: all.length, source: i }); // file join == compaction boundary
    all.push(...records.map(record => ({ ...record, source: i, adapter: m.agent ?? 'claude' })));
    unrecorded.push(...(Array.isArray(m.labelled) ? m.labelled : []));
  }
  // M34 labels (C-02 "Slice-time labels"): resumed and forked recordings copy rows across files; each recorded `uuid` is
  // labelled once — a copy carries its first row's label — and counted once.
  const firstLabel = new Map();
  const labelCounts = emptyCounts();
  const labelGaps = {};
  for (const rec of all) {
    const uuid = typeof rec.raw?.uuid === 'string' && rec.raw.uuid ? rec.raw.uuid : null;
    if (uuid !== null && firstLabel.has(uuid)) {
      const first = firstLabel.get(uuid);
      if (first.kind === rec.kind) applyLabel(rec, first.value, first.lineage);
      continue;
    }
    if (rec.private === true && !Array.isArray(rec.parts)) labelCounts.private++;
    for (const part of Array.isArray(rec.parts) ? rec.parts : []) if (part?.private === true) labelCounts.private++;
    for (const part of partsOf(rec)) countLabel(labelCounts, labelGaps, part);
    if (uuid !== null) firstLabel.set(uuid, { kind: rec.kind, lineage: rec.lineage, value: rec.parts ? { parts: rec.parts }
      : rec.private === true ? { private: true } : Object.fromEntries(['label', 'basis', 'markers', 'gap', 'links']
        .filter((key) => Object.hasOwn(rec, key)).map((key) => [key, rec[key]])) });
  }
  // M34 labels review (F8): a counted row is folded by its recorded uuid like a record — a copy of a row another file of
  // the lineage holds (as a record or a counted row) is counted once.
  const countedUuids = new Set();
  for (const { uuid, value } of unrecorded) {
    if (uuid !== null && (firstLabel.has(uuid) || countedUuids.has(uuid))) continue;
    if (uuid !== null) countedUuids.add(uuid);
    if (value?.private === true) labelCounts.private++;
    else if (typeof value?.gapOnly === 'string') labelGaps[value.gapOnly] = (labelGaps[value.gapOnly] ?? 0) + 1;
    else countLabel(labelCounts, labelGaps, value);
  }

  const { events, ask, interjections, projectInstructions, claim, sayings, commentary, commentaryCapture, instructionCapture,
    actionCapture, observationCapture, marks, workflowLaunches, deliveries } = buildEvents(all, { cwd: meta.cwd ?? '',
    outcomes: opts.outcomes ?? null, claudeLocators: opts.claudeLocators === true,
    // D69 (b): the recording's home, from the path form its recorder wrote it at — the recording's own name
    // (`lineageFiles`, when the bytes were read from a copy) — never from its contents; null fails closed.
    home: recordingHome(Array.isArray(opts.lineageFiles) && opts.lineageFiles.length === files.length
      ? opts.lineageFiles : files),
    // D84: `mask: false` is a session review's load (the model reads the session unredacted); the default masks.
    mask: opts.mask !== false });
  if (instructionCapture.nonTextExcluded > 0 || instructionCapture.unclassifiedRows > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    if (instructionCapture.nonTextExcluded > 0)
      capture.instructionsNonText = instructionCapture.nonTextExcluded;
    if (instructionCapture.unclassifiedRows > 0)
      capture.unclassifiedRows = (capture.unclassifiedRows ?? 0) + instructionCapture.unclassifiedRows;
    capture.incomplete = true;
    capture.genericIncomplete ??= false;
    if (!capture.reasons.includes(SLICE_REASONS.CAPTURE_INCOMPLETE))
      capture.reasons.push(SLICE_REASONS.CAPTURE_INCOMPLETE);
  }
  if (actionCapture.unsupported > 0 || actionCapture.orphanResults > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    if (actionCapture.unsupported > 0) capture.unsupportedActions = actionCapture.unsupported;
    if (actionCapture.orphanResults > 0) capture.orphanResults = actionCapture.orphanResults;
    capture.incomplete = true;
    capture.genericIncomplete = true;
    if (!capture.reasons.includes(SLICE_REASONS.CAPTURE_INCOMPLETE))
      capture.reasons.push(SLICE_REASONS.CAPTURE_INCOMPLETE);
  }
  if (actionCapture.knownCodeEffectDemoted > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    capture.incomplete = true;
    capture.genericIncomplete = true;
    if (!capture.reasons.includes(SLICE_REASONS.KNOWN_CODE_EFFECT_UNTYPED))
      capture.reasons.push(SLICE_REASONS.KNOWN_CODE_EFFECT_UNTYPED);
  }
  // Codex already accounts for these missing result rows in its own unmapped/missing
  // counters. Keep the generic reader's count for Claude and Cursor, and use it as a
  // safety fallback if a Codex call somehow escaped its native accounting.
  const missingObservations = observationCapture.missingByAdapter.claude
    + observationCapture.missingByAdapter.cursor + observationCapture.missingByAdapter.unknown
    + ((capture?.unmapped || capture?.missing) ? 0 : observationCapture.missingByAdapter.codex);
  if (missingObservations > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    capture.observationsMissing = missingObservations;
  }
  // M33 U repair (OWNER DECISION B, 2026-10-01), L1: Claude calls the human refused (events.js `CLAUDE_USER_REFUSAL`)
  // that no ledger action carries (a hand-off, a result for no recorded call). Never read; counted so the evidence
  // adapter declares them session-wide. Like a missing observation it is a declared loss, not a capture shortfall:
  // `incomplete` is untouched.
  if (instructionCapture.feedbackUnplaced > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    capture.instructionsFeedbackUnplaced = instructionCapture.feedbackUnplaced;
  }
  // L1 review (OWNER DECISION 2026-10-06; C-02 "L1 refused calls"): calls a Claude Code recorder that types no refusal
  // recorded as failed (events.js `CLAUDE_UNTYPED_DENIAL_RECORDER`). Any of them may be a refusal holding the human's
  // answer, unread. Counted so the evidence adapter declares the refusal channel unreadable; a declared loss, not a
  // capture shortfall: `incomplete` is untouched.
  if (instructionCapture.refusalUntyped > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    capture.instructionsRefusalUntyped = instructionCapture.refusalUntyped;
  }
  // L1 session-type review (finding L1S-unknown-type-not-counted; C-02 "L1 refused calls", session type): calls refused
  // in a session whose type the recorder did not record (events.js `claudeSessionType` unknown). Each keeps its
  // declaration (fail closed) and is counted under its own reason, so the evidence adapter declares it apart from a
  // refusal in a human's session; a declared loss, not a capture shortfall: `incomplete` is untouched.
  if (instructionCapture.refusalSessionUnknown > 0) {
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, reasons: [], incomplete: false };
    capture.instructionsRefusalSessionUnknown = instructionCapture.refusalSessionUnknown;
  }
  // M34 labels: a notification whose link names no call the lineage recorded is a counted label gap (owner
  // decision 2026-10-07: one whose carried id names no call recorded before it is counted by its own label, above; one
  // that carries no call id is no gap).
  if (instructionCapture.notificationUnmatched > 0)
    labelGaps[LABEL_GAPS.notificationUnmatched] = (labelGaps[LABEL_GAPS.notificationUnmatched] ?? 0)
      + instructionCapture.notificationUnmatched;
  // M33 F: each helper's final report is attached to the one hand-off of its own recording it belongs to, by exact
  // recorded identity; an unattached one is a typed communication loss, counted by its closed reason.
  const { delegations, finalAnswers } = collectDelegationEvidence(all, sources);
  for (const [attribution, n] of Object.entries(finalAnswers)) {
    if (!(n > 0)) continue;
    capture ??= { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0,
      unmapped: 0, interAgentMessagesUnparsed: 0, reasons: [], incomplete: false };
    const key = INTER_AGENT_COUNTS[attribution];
    capture[key] = (capture[key] ?? 0) + n;
    if (key !== INTER_AGENT_COUNTS.attributed) {
      capture.incomplete = true;
      capture.genericIncomplete ??= false;
    }
  }
  if (delegations.some(d => d.status === 'unresolved')) {
    capture ??= { reasons: [], incomplete: false };
    capture.incomplete = true;
    capture.genericIncomplete = true;
    if (!capture.reasons.includes(SLICE_REASONS.DELEGATED_CAPTURE)) capture.reasons.push(SLICE_REASONS.DELEGATED_CAPTURE);
  }
  if (capture) {
    capture.interAgentMessagesUnparsed ??= 0;
    // M33 F: every closed inter-agent loss counter is the same typed communication loss (inter-agent.js).
    const communicationLoss = INTER_AGENT_LOSS_COUNTS
      .reduce((n, key) => n + (Number.isSafeInteger(capture[key]) && capture[key] > 0 ? capture[key] : 0), 0);
    capture.interAgentMessagesSoleIncomplete = communicationLoss > 0
      && capture.incomplete && onlyTypedCommunicationSourceLoss
      && capture.genericIncomplete === false && capture.unsupported === 0
      && capture.missing === 0 && capture.unmapped === 0 && capture.reasons.length === 0
      && !capture.instructionsNonText && !capture.unclassifiedRows
      && !capture.unsupportedActions && !capture.orphanResults && !capture.observationsMissing
      && !capture.instructionsFeedbackUnplaced
      && !capture.instructionsRefusalUntyped && !capture.instructionsRefusalSessionUnknown
      // M34 labels: a label gap the evidence adapter declares is another loss, as H2's and M5's counts were.
      && !labelGapDeclared(labelGaps)
      && corrupt === 0 && unknownSchemaFiles === 0
      && !sources.some((source) => source.identityConflict)
      && !delegations.some((delegation) => delegation.status === 'unresolved');
  }

  // Boundaries recorded at file joins are positional; convert to turn indices for the ledger.
  // The turn index must be counted with the SAME predicate buildEvents uses to advance `turn`
  // (M34 labels: `opensTurn`, the slicer's labels), or the two disagree: every tool_result arrives as a `user` record,
  // so counting user records put the mark at the end of the session on real recordings (H42).
  for (const { at: idx, source } of boundaries) {
    const before = all.slice(0, idx).filter((r) => opensTurn(r)).length;
    // C-01 event identity: a join is named by the first row of the file it opens (none: a file with no record).
    const first = all[idx]?.source === source ? all[idx] : null;
    marks.push({ turn: before, kind: 'compaction',
      ...(first ? { identity: rowIdentity(first, idx, null, IDENTITY_SUBS.join) } : {}) });
  }
  // Code-unit order, never locale-aware comparison: locale-aware ordering makes the ledger's
  // bytes depend on the process locale, and a Czech-locale machine then computes a different
  // hash for the same input — breaking verdict caches and every frozen-hash assertion (M86).
  marks.sort((a, b) => a.turn - b.turn || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

  // M34 labels (C-02 "Slice-time labels"): every record's label counted (`capture.labels`), and every counted label gap
  // by its closed reason (`capture.labelGaps`, only when there is one). Counted, never a capture shortfall on its own:
  // `incomplete` is untouched.
  capture = { ...(capture ?? {}), labels: labelCounts,
    ...(Object.keys(labelGaps).length ? { labelGaps: Object.fromEntries(Object.values(LABEL_GAPS)
      .filter((reason) => labelGaps[reason] > 0).map((reason) => [reason, labelGaps[reason]])) } : {}) };
  // M34 labels: the lineage's role, from structure (a helper's recording: Claude `isSidechain` rows, a Codex subagent
  // thread) — never its path. Only a helper's ledger records it, so every root ledger keeps its lineage bytes. M34 labels
  // review (F7): a Claude recording is a helper's by the rule its reader reads it by — the first row that records
  // `isSidechain` records true — as well as by its identity's `nested` (a recording of the helper's own rows only); a
  // main recording holding inline sidechain rows beside its own is the root's (its reader drops those rows).
  const helper = helperRows || sources.some((source) => source?.nested === true);

  return {
    schemaVersion: SCHEMA_VERSION,
    lineage: {
      rootSessionId: meta.sessionId,
      files: Array.isArray(opts.lineageFiles) && opts.lineageFiles.length === files.length
        ? [...opts.lineageFiles] : files,
      compactionBoundaries: marks.filter((m) => m.kind === 'compaction').map((m) => m.turn),
      ...(helper ? { role: LINEAGE_ROLES.helper } : {}),
    },
    cwd: meta.cwd,
    ask,
    // OWNER DECISION B (2026-10-01): the human's words recorded within a turn (a queued prompt, an AskUserQuestion
    // answer), at their rows. Present only when there is one, so every other ledger keeps its bytes. `ask` and the
    // capture counts are unchanged: a reader of `ask` alone has still not read them.
    ...(interjections.length ? { interjections } : {}),
    // D71 (g), owner decision 2026-10-08: the project's own instruction files the harness gave the agent (events.js
    // `projectInstructions`), at their rows. Present only when there is one, so every other ledger keeps its bytes;
    // redaction scrubs each whole before slice_hash, and the evidence adapter places them beside the session's events.
    ...(projectInstructions.length ? { projectInstructions } : {}),
    ledger: events,
    claim,
    sayings,
    commentary,
    commentaryCapture,
    marks,
    ...(opts.includeSources ? { sources } : {}),
    // M33 W: only for the run linker that asks (cli/src/session-evidence.js), which drops it before the ledger is
    // returned: every other ledger keeps its bytes.
    ...(opts.workflowLaunches === true ? { workflowLaunches: { sessionIds: lineageSessionIds(all),
      calls: workflowLaunches } } : {}),
    // M33 P: likewise only for the loader that asks, which joins it and drops it (cli/src/session-evidence.js).
    ...(opts.helperDeliveries === true ? { helperDeliveries: helperDeliveriesOf(deliveries, sources) } : {}),
    ...(delegations.length ? { delegations } : {}),
    ...(capture ? { capture } : {}),
    dropped: [
      // The reason is the token; the count is a sibling field (F14).
      ...(corrupt ? [{ turn: null, reason: SLICE_REASONS.UNPARSEABLE_LINES, count: corrupt }] : []),
      // Declared incapacity, never a silent empty ledger (locality audit, adapter fallback).
      ...(unknownSchemaFiles ? [{ turn: null, reason: SLICE_REASONS.UNKNOWN_SCHEMA_FILES, count: unknownSchemaFiles }] : []),
      ...(capture?.reasons ?? []).map((reason) => ({ turn: null, reason })),
    ],
  };
}

/**
 * M33 P. The slicer's delivery side channel as the loader joins it. An arrival is kept only when its recorded recipient
 * is the recording's OWN task path (codexOwnTaskPath: the row was addressed to this helper itself); a report is marked
 * `toParent` only when its recipient is this recording's own path (the M33 F rule: the parent received it). Paths and
 * tokens stay in memory: the loader drops this before any ledger is kept.
 */
function helperDeliveriesOf(deliveries, sources) {
  const own = (source) => codexOwnTaskPath(sources[source]);
  return {
    agents: deliveries.agents,
    // M33 P repair: each synchronous Claude Agent/Task hand-off and its own result row (its receipt).
    calls: deliveries.calls,
    // L2: each Claude Agent/Task hand-off whose one result recorded no typed launch status (no receipt; declared).
    unknown: deliveries.unknown,
    sends: deliveries.sends,
    arrivals: deliveries.arrivals.filter((arrival) => own(arrival.source) !== null && arrival.recipient === own(arrival.source))
      .map(({ recipient, ...arrival }) => arrival),
    reports: deliveries.reports.map(({ recipient, ...report }) => ({ ...report,
      toParent: own(report.source) !== null && recipient === own(report.source) })),
  };
}

/**
 * M33 W. The distinct session ids the lineage's Claude rows recorded, sorted, or null when one is not a safe id or
 * there are more than `WORKFLOW_LIMITS.sessionIds` (a resumed parent records two). A run directory is accepted only
 * under one of them; with none known, only the call's own recorded session can be one.
 */
function lineageSessionIds(records) {
  const ids = new Set();
  for (const record of records) {
    if ((record.adapter ?? 'claude') !== 'claude' || record.raw === null || typeof record.raw !== 'object') continue;
    const id = record.raw.sessionId;
    if (id === undefined) continue;
    if (!safeSessionId(id)) return null;
    ids.add(id);
    if (ids.size > WORKFLOW_LIMITS.sessionIds) return null;
  }
  return [...ids].sort();
}

/** Coarse, deliberately: 4 bytes per token, matching the upstream convention. */
export function tokensOf(ledger) {
  // Pre-edit snapshots (experiment 3) are opt-in prompt content: they do not count toward the
  // judged size, or the oversize/arc routing and the base sample would move with a switch.
  const judged = ledger?.ledger ? { ...ledger, sources: undefined, children: undefined,
    ledger: ledger.ledger.map((e) => (e.before || e.after ? { ...e, before: undefined, after: undefined } : e)) } : ledger;
  return Math.ceil(JSON.stringify(judged).length / 4);
}

/** M34 labels: whether a lineage's counted label gaps include one the evidence adapter declares as a loss of its own
 *  (sonah-ledger.js `LABEL_GAP_NOTES`): every reason but an unlabelled block or row, which the capture counts of the same
 *  rows already declare. */
function labelGapDeclared(gaps) {
  return Object.entries(gaps ?? {}).some(([reason, n]) => n > 0
    && reason !== LABEL_GAPS.unknownBlock && reason !== LABEL_GAPS.unknownRow);
}

/** The two delegation reasons: a helper's missing capture is known missing input, not a gap in the parent's own
 *  action stream. */
const DELEGATION_REASONS_ONLY = new Set([SLICE_REASONS.DELEGATED_CAPTURE, SLICE_REASONS.DELEGATED_REVIEW]);
/** The parent's own action stream is incomplete: unparseable records, unknown schema, unsupported
 *  wrappers. Nothing about the parent's writes can be trusted to be all of them. */
export function hasActionGaps(ledger) {
  const reasons = ledger?.capture?.reasons ?? [];
  const nonDelegation = reasons.some((r) => !DELEGATION_REASONS_ONLY.has(String(r)));
  return (!!ledger?.capture?.incomplete && ledger.capture.genericIncomplete !== false
    && (nonDelegation || reasons.length === 0)) || countedGap(ledger) || nativeInventoryShortfall(ledger);
}
/** C-02 M33 native-first refreeze: a counted native inventory shortfall is an action gap of its own,
 *  also when it is the only incomplete cause (and so carries no generic gap). A present counter that
 *  is not a safe nonnegative integer is a gap too: fail closed. */
function nativeInventoryShortfall(ledger) {
  return nativeCounted(ledger, 'nativeInventoryShortfall');
}
function nativeCounted(ledger, key) {
  const capture = ledger?.capture;
  if (!capture || typeof capture !== 'object' || !Object.hasOwn(capture, key)) return false;
  const n = capture[key];
  return !(Number.isSafeInteger(n) && n >= 0) || n > 0;
}
export function hasCaptureGaps(ledger) {
  return !!ledger?.capture?.incomplete || Number(ledger?.capture?.observationsMissing) > 0
    // A completed Codex call can have an action but no provably paired result. Its `unmapped`
    // count is an observation gap even when the action inventory itself is complete.
    || Number(ledger?.capture?.unmapped) > 0
    || Number(ledger?.capture?.instructionsNonText) > 0
    || Number(ledger?.capture?.unclassifiedRows) > 0
    || (ledger?.delegations ?? []).some(d => d.status === 'unresolved') || countedGap(ledger)
    // Each native shortfall is a declared gap of its own, whatever `incomplete` says (fail closed).
    || ['nativeInventoryShortfall', 'nativeCommandShortfall', 'nativeWriteShortfall']
      .some((key) => nativeCounted(ledger, key));
}

