// Local recording integration shared by `analyze` (`sonah slice`) and the session review.
// Children are separate evidence units; neither their briefs nor their actions become the parent's
// human contract.
import { realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { resolveChildLinks, resolveFollowupLink, proveNoForkChildHistory,
  delegationIdentityUnverified, CHILD_LINK_REASONS } from '../../slicer/src/child-links.js';
import { redact } from '../../redact/index.js';
import { outcomesFor } from './outcomes.js';
import { readRecordingIdentity, snapshotRecording } from './recording-read.js';
import { indexRecordings, recordingInventoryCurrent, RECORDING_INDEX_LIMITS } from './recording-inventory.js';
import { claudeProjectsDir } from './claude-home.js';
import { keptIdentities, locateWorkflowRun, readEarlierSessionRows, readWorkflowRun, workflowRunSegment }
  from './workflow-agents.js';
import { WORKFLOW_RUN_NOTES, WORKFLOW_LIMITS, WORKFLOW_AGENT_KIND, WORKFLOW_AGENT_LINKED, agentFileName,
  copiedCallProven, earlierReceipts, planWorkflowRun, plainWorkflowName, runReceipt, runRecord, workflowCallRoles,
  workflowLaunched } from '../../slicer/src/workflow-runs.js';
import { HELPER_DELIVERY_REASONS, planHelperSegments, helperRow, laterRequestTurn }
  from '../../slicer/src/helper-deliveries.js';
import { IDENTITY_SUBS, validIdentity } from '../../slicer/src/event-identity.js';
import { censusEntryOrder } from '../../slicer/src/recorder-census.js';

/**
 * M33 P: each node's encrypted arrivals (the work its own recording received), kept in memory for its parent's
 * delivery join only — never on a ledger, so no token is ever stored, hashed or printed.
 */
const arrivalsOf = new WeakMap();
const CANONICAL_TASK = /^\/root\/[a-z0-9_]+(?:\/[a-z0-9_]+)*$/;

/**
 * M33 P (C-03 "M33 child placement", amended). Where each linked helper's work was delivered and received, by exact
 * recorded identity, as the ledger records it (`helperSegments`, `helperDeliveryLosses`):
 *   - a linked Claude Agent/Task hand-off: one segment, delivered by its hand-off. M33 P repair: received at its own
 *     single result row when it ran synchronously (the parent waited for it there: a sibling call recorded between its
 *     call and that row ran concurrently with it), or — run in the background — at its launch's earliest recorded
 *     completed receipt (a settled notification or a typed TaskOutput completion) whose agentId is the linked child's.
 *     No exact receipt (none recorded, or no one launch or call matched): the segment records none, and is declared.
 *     M33 P second repair: whether it ran in the background is what its own result recorded (the slicer's launch stub
 *     test), never its input alone; and an agent whose own recording records a request after its first (the parent
 *     continued it: a SendMessage, a resume) is cut at that request of its own: its history before it is received at
 *     that receipt, the rest (`{delivery: {request: turn}}`) by no recorded receipt — declared (`continued`). L2
 *    : a hand-off whose one result recorded no typed launch status has no receipt, and
 *     that is declared (`launchUnknown`);
 *   - a linked Codex spawn: its history cut at each arrival whose token equals exactly one send of this recording,
 *     each segment received at the helper's first FINAL_ANSWER recorded after its delivery that no earlier segment
 *     took, else `shared` (`planHelperSegments`).
 * M33 P second repair: a recording that links no helper records no delivery loss (C-03 bytes: its ledger is unchanged).
 */
function helperPlacement({ deliveries, links, children }) {
  const segments = [];
  const claudeLosses = [];   // a continued agent's (M33 P second repair), an unknown launch mode's (L2)
  if (!deliveries || !links.some((delegation) => delegation?.status === 'linked')) return { segments, losses: [] };
  const list = (value) => (Array.isArray(value) ? value : []);
  for (const [index, delegation] of links.entries()) {
    if (delegation?.adapter !== 'claude' || delegation.status !== 'linked' || delegation.kind === WORKFLOW_AGENT_KIND
      || delegation.kind === 'followup' || !Number.isSafeInteger(delegation.link?.source)) continue;
    // A later request of the agent's own (a SendMessage, a resume): its work after it has no recorded receipt of its
    // own, so it is cut there and placed by none; the work before it is received at the hand-off's receipt.
    const unit = children.find((child) => child.source === delegation.link.source);
    const later = laterRequestTurn(unit?.ledger);
    if (later !== null) claudeLosses.push({ delivery: { delegation: index }, reason: HELPER_DELIVERY_REASONS.continued });
    const own = (entry) => entry?.source === delegation.source && entry.record === delegation.record
      && entry.callId === delegation.callId;
    const launches = list(deliveries.agents).filter(own);
    const calls = list(deliveries.calls).filter(own);
    // L2: its one result recorded no typed launch status: no receipt, and the loss is declared on its hand-off.
    if (list(deliveries.unknown).some(own))
      claudeLosses.push({ delivery: { delegation: index }, reason: HELPER_DELIVERY_REASONS.launchUnknown });
    const receipt = launches.length === 1 && !calls.length && launches[0].agentId === delegation.childId
      ? helperRow(launches[0].receipt) : calls.length === 1 && !launches.length ? helperRow(calls[0].receipt) : null;
    // D99 (F1 guard): a background run with no receipt whose end the slicer could not read (`endUnread`): the loss is
    // declared as that, on its hand-off, and the adapter never says the parent recorded no receipt of it.
    // Review of A1b: `endUnchecked` where no later mention of it is established.
    if (receipt === null && launches.length === 1 && !calls.length && launches[0].endUnread === true)
      claudeLosses.push({ delivery: { delegation: index }, reason: HELPER_DELIVERY_REASONS.endUnread });
    else if (receipt === null && launches.length === 1 && !calls.length && launches[0].endUnchecked === true)
      claudeLosses.push({ delivery: { delegation: index }, reason: HELPER_DELIVERY_REASONS.endUnchecked });
    segments.push({ child: delegation.link.source, segments: [{ delivery: { delegation: index },
      ...(receipt ? { receipt } : {}) }, ...(later !== null ? [{ delivery: { request: later } }] : [])] });
  }
  const helpers = [];
  for (const [index, delegation] of links.entries()) {
    if (delegation?.adapter !== 'codex' || delegation.status !== 'linked' || delegation.kind === 'followup'
      || !Number.isSafeInteger(delegation.link?.source)) continue;
    const unit = children.find((child) => child.source === delegation.link.source);
    if (!unit) continue;
    helpers.push({ child: delegation.link.source, spawn: index,
      path: typeof delegation.taskName === 'string' && CANONICAL_TASK.test(delegation.taskName) ? delegation.taskName : null,
      arrivals: arrivalsOf.get(unit.ledger) ?? [] });
  }
  const plan = planHelperSegments({ sends: list(deliveries.sends), delegations: links, helpers,
    reports: list(deliveries.reports) });
  return { segments: [...segments, ...plan.segments].sort((a, b) => a.child - b.child), losses: [...claudeLosses, ...plan.losses] };
}

export const CHILD_RECORDING_LIMITS = Object.freeze({ ...RECORDING_INDEX_LIMITS,
  children: 100_000, actionBytes: 512_000_000, aggregateActionBytes: 2_000_000_000 });

/**
 * M65: why THIS layer could not link a delegation to a child recording. The resolver's own
 * vocabulary is CHILD_LINK_REASONS (slicer/src/child-links.js); these are the IO-layer refusals
 * that happen around it — budget, index, cycle, read, re-verification. Closed for the same reason
 * every reason table is closed: a per-reason false-positive rate is only computable over a finite
 * set, and these were five bare literals at five call sites.
 */
export const CHILD_RECORDING_REASONS = Object.freeze({
  LIMIT:                'child_recording_limit',
  INVENTORY_INCOMPLETE: 'child_inventory_incomplete',
  CYCLE:                'child_recording_cycle',
  UNAVAILABLE:          'child_recording_unavailable',
  CHANGED:              'child_recording_changed',
});

/** Capture gaps this layer declares on the ledger itself. The two delegation members are the slicer's
 *  `SLICE_REASONS` strings, because both write `capture.reasons` (cli/test/reason-vocabulary.test.js). */
export const CHILD_CAPTURE_REASONS = Object.freeze({
  INSTRUCTION_AUTHORITY: 'child_instruction_authority_unchecked',
  REVIEW_UNCHECKED:      'delegated_review_unchecked',
  CAPTURE_UNCHECKED:     'delegated_capture_unchecked',
});
const inside = (path, root) => { const r = relative(root, path); return r !== '' && r !== '..' && !r.startsWith('..' + sep) && !r.startsWith(sep); };
const canonical = path => realpath(path).catch(() => null);
export const evidenceContext = () => ({ inventories: new Map() });

/**
 * D99 (F1 guard): the recorder census of a loaded session (slicer recorder-census.js `recorderCensusOf`), summed over
 * the parent recording and every helper recording the load read: what a reader of a recorder fact met and another could
 * not read, by closed reason and recorder version. Kept beside the ledger, never on it (no ledger byte moves for it), for
 * the run record only. Null when the ledger was not loaded here or nothing was counted.
 */
const censusOf = new WeakMap();
export function recorderCensusOf(ledger) {
  const census = ledger !== null && typeof ledger === 'object' ? censusOf.get(ledger) : undefined;
  return census && (census.notices.labelled || census.launches.background || census.entries.length) ? census : null;
}
const CENSUS_LAUNCH_KEYS = Object.freeze(['background', 'typed', 'stopped', 'unread', 'absent', 'other', 'linked',
  'linkedOther']);
function emptyCensus() {
  return { notices: { labelled: 0, typed: 0 }, launches: Object.fromEntries(CENSUS_LAUNCH_KEYS.map((key) => [key, 0])),
    entries: [] };
}
/** Adds one recording's census into `into`: counts summed, each entry by its reason, kind, carrier, key and version,
 *  in the slicer's one entry order (`censusEntryOrder`). */
function addCensus(into, census) {
  if (census === null || typeof census !== 'object') return;
  const n = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  for (const key of ['labelled', 'typed']) into.notices[key] += n(census.notices?.[key]);
  for (const key of CENSUS_LAUNCH_KEYS) into.launches[key] += n(census.launches?.[key]);
  for (const entry of Array.isArray(census.entries) ? census.entries : []) {
    const same = into.entries.find((e) => e.reason === entry.reason && (e.kind ?? null) === (entry.kind ?? null)
      && (e.carrier ?? null) === (entry.carrier ?? null) && (e.key ?? null) === (entry.key ?? null)
      && e.version === entry.version);
    if (same) same.count += n(entry.count);
    else into.entries.push({ ...entry, count: n(entry.count) });
  }
  into.entries.sort(censusEntryOrder);
}

async function parentSources(files, sources, roots) {
  const codex = await canonical(roots.codex ?? join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions'));
  const claude = await canonical(roots.claude ?? claudeProjectsDir());
  return Promise.all(files.map(async (file, index) => {
    const path = await canonical(file);
    const source = sources[index] ?? {};
    let namespace = null;
    if (path && source.adapter === 'codex' && codex && inside(path, codex)) namespace = codex;
    if (path && source.adapter === 'claude' && claude && inside(path, claude)) {
      const slug = relative(claude, path).split(sep)[0];
      if (!/-sonah-judge$/.test(slug)) namespace = join(claude, slug);
    }
    return { ...source, namespace };
  }));
}

/** Returns bounded, validated evidence (redact). No model or network. A fresh context rechecks growing files. D90 (owner
 *  decision 2026-10-15, privacy is not a design constraint): every recording of the lineage is sliced and kept as
 *  recorded — nothing is masked — for a review and for `sonah slice` alike. Which identities may locate a recording on
 *  disk (`keptIdentities`, before a Workflow agent is read) is a join check of their shape. */
export async function loadSessionEvidence(files, { cwd, outcomes, recordingRoots = {},
  context = evidenceContext(), reviewLinkedChildren = false, childLimits: lower = {} } = {}) {
  const limits = { ...CHILD_RECORDING_LIMITS, ...lower };
  if (Object.entries(limits).some(([key, n]) => !Number.isSafeInteger(n) || n <= 0
    || !(key in CHILD_RECORDING_LIMITS) || n > CHILD_RECORDING_LIMITS[key])) {
    throw new Error('Child recording limits could not be verified');
  }
  // A cached inventory is checked once for this review unit; a changed store is rescanned.
  // M33 W: `claimedRuns` holds every canonical Workflow run directory a call of this review has claimed.
  const state = { inventories: context.inventories, checkedInventories: new Set(), staleInventories: new Map(),
    visited: new Set(), children: 0, actionBytes: 0, claimedRuns: new Set(), census: emptyCensus() };
  async function readNode(nodeFiles, depth, child = false, snapshot = null, verifiedChild = false) {
    let raw = snapshot ?? await sliceLineage(nodeFiles, { cwd: child ? undefined : cwd,
      outcomes: child ? await outcomesFor(nodeFiles) : outcomes ?? await outcomesFor(nodeFiles),
      includeSources: true, sidechainAsMain: child || undefined, childRecording: child, workflowLaunches: true,
      claudeLocators: true, helperDeliveries: true, recorderCensus: true });
    // M34 labels (C-02 "Slice-time labels"): a helper's recording is known by its structure — the slicer's lineage role,
    // from `isSidechain` rows or a Codex subagent thread — never by its path. M34 labels review (F7): by that role alone,
    // never re-decided here: a main recording holding inline sidechain rows beside its own (`mixedHistory`, its first
    // `isSidechain` false) is the root's, and its reader drops those rows; a helper's recording holding unmarked rows
    // (its first `isSidechain` true) is a helper's, and the child read withholds its unchecked history.
    if (!child && raw.lineage?.role === 'helper') {
      child = true;
      raw = await sliceLineage(nodeFiles, { outcomes: await outcomesFor(nodeFiles),
        includeSources: true, sidechainAsMain: true, childRecording: true, workflowLaunches: true,
        claudeLocators: true, helperDeliveries: true, recorderCensus: true });
    }
    const ledger = redact(raw).ledger;
    // M33 W: the slicer's Workflow launch side channel is read below and never returned (no ledger keeps it).
    const launches = ledger.workflowLaunches ?? null;
    delete ledger.workflowLaunches;
    // M33 P: the delivery side channel likewise (tokens and paths in memory only), read below and never returned.
    const deliveries = ledger.helperDeliveries ?? null;
    delete ledger.helperDeliveries;
    // D99 (F1 guard): the recorder census likewise: summed over every recording this review reads, kept for the run
    // record (`recorderCensusOf`), never on a ledger.
    addCensus(state.census, ledger.recorderCensus ?? null);
    delete ledger.recorderCensus;
    if (child) {
      ledger.instructions = ledger.ask.map(a => ({ ...a, origin: 'agent-or-inherited' }));
      ledger.ask = [];
      ledger.instructionAuthority = 'unchecked';
      // A verified parent's review can read this child's own events. Its assignment is still
      // agent authority, not a human instruction, but that fact alone did not lose any A/O. A
      // directly opened child has no verified parent scope and keeps the existing guard.
      if (!reviewLinkedChildren || !verifiedChild)
        ledger.capture = { ...ledger.capture, incomplete: true,
          reasons: [...new Set([...(ledger.capture?.reasons ?? []), CHILD_CAPTURE_REASONS.INSTRUCTION_AUTHORITY])] };
    }
    const parents = await parentSources(nodeFiles, ledger.sources ?? [], recordingRoots);
    const children = [];
    const links = [];
    for (const delegation of ledger.delegations ?? []) {
      if (delegation.status === 'failed') { links.push(delegation); continue; }
      if (delegationIdentityUnverified(delegation)) {
        links.push({ ...delegation, status: 'unresolved', reason: CHILD_LINK_REASONS.IDENTITY_REDACTED });
        continue;
      }
      if (delegation.kind === 'followup') {
        // A follow-up can reuse a child loaded by an earlier verified spawn in this exact
        // parent recording. It cannot add a source, consume another budget slot or count
        // the child's actions again. Every handoff keeps its own turn/record locator.
        const linked = resolveFollowupLink(delegation, links.filter(d => d.kind !== 'followup'), parents);
        if (linked.status === 'linked') {
          const receipt = { ...linked, reviewStatus: 'unchecked' };
          links.push(receipt);
          if (receipt.parentInstruction) children[receipt.link.source]?.parentInstructions?.push(receipt);
        } else links.push(linked);
        continue;
      }
      if (!delegation.childId && !delegation.taskName) { links.push(delegation); continue; }
      const parent = parents[delegation.source];
      // C-03 M33 D: a resumed Claude parent (its only conflict is two recorded sessionIds) is
      // still a source of hand-offs; each is joined by the sessionId its own rows recorded, which
      // the resolver checks. Any other conflicting parent links nothing, as before.
      const resumedClaude = delegation.adapter === 'claude' && parent?.adapter === 'claude'
        && parent.sessionIdConflictOnly === true && typeof delegation.sessionId === 'string';
      if (!parent?.namespace || (parent.identityConflict && !resumedClaude)) { links.push(delegation); continue; }
      if (depth >= limits.depth || state.children >= limits.children
        || state.actionBytes >= limits.aggregateActionBytes) {
        links.push({ ...delegation, status: 'unresolved', reason: CHILD_RECORDING_REASONS.LIMIT }); continue;
      }
      const key = JSON.stringify([parent.adapter, parent.namespace]);
      if (!state.checkedInventories.has(key)) {
        const cached = state.inventories.get(key);
        let prior = null;
        try { if (cached) prior = await cached; } catch { /* rescan below */ }
        if (!prior || !await recordingInventoryCurrent(prior)) {
          if (prior && !prior.incomplete) state.staleInventories.set(key, prior);
          state.inventories.set(key, indexRecordings(parent.namespace, parent.adapter,
            { limits: Object.fromEntries(Object.keys(RECORDING_INDEX_LIMITS).map(name => [name, limits[name]])) }));
        }
        state.checkedInventories.add(key);
      }
      let found;
      try { found = await state.inventories.get(key); }
      catch { links.push({ ...delegation, status: 'unresolved', reason: CHILD_RECORDING_REASONS.INVENTORY_INCOMPLETE }); continue; }
      if (found.incomplete) { links.push({ ...delegation, reason: CHILD_RECORDING_REASONS.INVENTORY_INCOMPLETE }); continue; }
      // C-03: only these two inventory-wide checks can scope a conflict by candidate records.
      const [linked] = resolveChildLinks([delegation], found.sources, parents,
        { conflictCandidates: found.conflictCandidates });
      if (linked.status !== 'linked') {
        const stale = state.staleInventories.get(key);
        const [previous] = stale ? resolveChildLinks([delegation], stale.sources, parents,
          { conflictCandidates: stale.conflictCandidates }) : [];
        links.push(previous?.status === 'linked' && linked.reason === CHILD_LINK_REASONS.UNAVAILABLE
          ? { ...delegation, status: 'unresolved', reason: CHILD_RECORDING_REASONS.CHANGED }
          : linked);
        continue;
      }
      const file = found.files[linked.link.source];
      const noForkChildProof = proveNoForkChildHistory(linked, found.sources[linked.link.source], parent);
      if (state.visited.has(file)) { links.push({ ...delegation, reason: CHILD_RECORDING_REASONS.CYCLE }); continue; }
      let recording;
      let snapshot;
      try {
        const maxBytes = Math.min(limits.actionBytes, limits.aggregateActionBytes - state.actionBytes);
        snapshot = await snapshotRecording(file, { namespace: parent.namespace,
          maxBytes, maxLineBytes: Math.min(limits.lineBytes, maxBytes) });
        const identity = await readRecordingIdentity(snapshot.path, { adapter: parent.adapter,
          namespace: snapshot.directory, maxBytes: snapshot.bytesRead,
          maxLineBytes: Math.min(limits.lineBytes, snapshot.bytesRead),
          maxRecords: limits.inventoryRecords });
        if (!identity.identityConflict && !(parent.adapter === 'codex' ? identity.sessionId : identity.childId))
          throw new Error('Child metadata is incomplete');
        // Parse only the private immutable copy. The final link check compares its exact source
        // metadata with the indexed tuple before any child action is released.
        // D69 (b): the copy is named by the recording it was read from (`lineageFiles`), so the slicer reads the
        // recording's home from where the recorder wrote it, never from the private copy's temporary path.
        const sliced = await sliceLineage([snapshot.path], { outcomes: await outcomesFor([file]),
          includeSources: true, sidechainAsMain: true, childRecording: true, noForkChildProof, workflowLaunches: true,
          claudeLocators: true, helperDeliveries: true, recorderCensus: true, lineageFiles: [file] });
        sliced.lineage.files = [file];
        const cleaned = redact(sliced).ledger;
        const [verified] = resolveChildLinks([delegation], [{ ...cleaned.sources?.[0], namespace: parent.namespace,
          key: linked.link.source }], parents);
        if (verified.status !== 'linked') { links.push({ ...delegation, reason: CHILD_RECORDING_REASONS.CHANGED }); continue; }
        // Validate before recursion: a rejected source cannot consume another child's visit or
        // budget and thereby make a legitimate sibling look cyclic or unavailable.
        state.visited.add(file); state.children++; state.actionBytes += snapshot.bytesRead;
        recording = await readNode([file], depth + 1, true, cleaned, true);
      }
      catch (error) {
        links.push({ ...delegation, status: 'unresolved', reason: ['bytes', 'line_bytes', 'records', 'deadline']
          .includes(error?.reason) ? CHILD_RECORDING_REASONS.LIMIT : CHILD_RECORDING_REASONS.UNAVAILABLE });
        continue;
      }
      finally { if (snapshot) await rm(snapshot.directory, { recursive: true, force: true }); }
      // Re-read metadata from the exact bytes parsed as actions. The index can be stale or the
      // recording can have changed while it was loading; that cannot redirect the link.
      const [verified] = resolveChildLinks([delegation], [{ ...recording.sources?.[0], namespace: parent.namespace,
        key: linked.link.source }], parents);
      if (verified.status !== 'linked') { links.push({ ...delegation, reason: CHILD_RECORDING_REASONS.CHANGED }); continue; }
      const source = children.length;
      const receipt = { ...linked, link: { source }, reviewStatus: 'unchecked' };
      children.push({ source, ledger: recording, parentInstructions: receipt.parentInstruction ? [receipt] : [] });
      links.push(receipt);
    }
    // M33 W: each Workflow call's agents, linked by exact recorded identity as helpers of that call.
    const runs = await linkWorkflowRuns({ launches, ledger, parents, depth, links, children });
    if (ledger.delegations || links.length) ledger.delegations = links;
    if (runs.length) ledger.workflowRuns = runs;
    // M33 P: where each linked helper's work was delivered and received (C-03 "M33 child placement", amended).
    const placed = helperPlacement({ deliveries, links, children });
    if (placed.segments.length) ledger.helperSegments = placed.segments;
    if (placed.losses.length) ledger.helperDeliveryLosses = placed.losses;
    // M33 P: a Claude action's row is recorded only in a ledger that links a helper — the one consumer is a helper's
    // placement among the parent's actions — so every other ledger keeps its bytes.
    const linkedHelper = links.some((d) => d?.status === 'linked');
    for (const act of ledger.ledger ?? []) {
      if (act === null || typeof act !== 'object' || !Object.hasOwn(act, 'claudeLocator')) continue;
      if (linkedHelper) act.sourceLocator = act.claudeLocator;
      delete act.claudeLocator;
    }
    arrivalsOf.set(ledger, Array.isArray(deliveries?.arrivals) ? deliveries.arrivals : []);
    if (children.length) {
      ledger.children = children;
      const unresolved = links.some(d => d.status === 'unresolved');
      // Without reviewLinkedChildren (`sonah slice`) linked children remain pending. A review
      // transfers verified child events into its Session; it can let its own window
      // coverage decide whether they were read. Clear only the recorder's delegation-only loss
      // after every hand-off linked. Other parser/history losses remain incomplete.
      if (reviewLinkedChildren) {
        const prior = ledger.capture?.reasons ?? [];
        const onlyResolvedDelegation = !unresolved && prior.length > 0
          && prior.every(r => r === CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED);
        const reasons = prior.filter(r => r !== CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED || unresolved);
        if (ledger.capture) ledger.capture = { ...ledger.capture, reasons,
          ...(onlyResolvedDelegation ? { incomplete: false, genericIncomplete: false } : {}) };
      } else {
        const reasons = [...new Set([...(ledger.capture?.reasons ?? []), CHILD_CAPTURE_REASONS.REVIEW_UNCHECKED])]
          .filter(r => r !== CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED || unresolved);
        ledger.capture = { ...ledger.capture, incomplete: true, reasons };
      }
      ledger.dropped = (ledger.dropped ?? []).filter(d => d.reason !== CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED
        || unresolved);
    }
    return ledger;
  }
  /**
   * M33 W. Link every launched Claude Workflow call's agents (C-03 "M33 D Workflow agents", as amended). For each call
   * whose own recorded result is a launch (the M33 D rule) and records a safe runId the redactor keeps: locate its run
   * directory (`locateWorkflowRun`), read its journal and entries, and verify each `started` agent's recording exactly
   * as an Agent/Task child's is — snapshot, identity (every row records that agentId and the run's own sessionId),
   * slice, redact, re-verify — then read it as a child of this node (`readNode`, so its own hand-offs and Workflow
   * calls link by the same rules, to the frozen depths). A linked agent becomes a `workflow-agent` delegation of the
   * call's turn and row, with its journal report attached as its result; every other agent the run names is counted
   * under exactly one closed note in the call's run record. A call whose run does not resolve, or whose run names no
   * agent at all, adds nothing: its M33 D declaration stands and its ledger keeps its bytes. As for an Agent/Task
   * hand-off, a recording whose identity conflicts (other than the resumed shape) links nothing; and a run directory is
   * claimed once per review (`state.claimedRuns`), before any of its agents is read, so no later call can take it.
   * M33 W repair 2: a run several calls name is the ORIGIN's, every other call resuming it (`workflowCallRoles`): its
   * agents link once, as the origin's helpers, and the run record names each resume (no M33 D loss of its own). And a
   * recorded transcriptDir under a session this recording never records is accepted only when that session's own
   * file proves the call was copied from it (`copiedSessions`, below). M33 W2: the run record names where the parent
   * received the run's completion (`receipt`: the chain's last call's own settled notification row, `runReceipt`), so
   * the adapter places the run's agents there; none recorded, none named, and the launch placement is declared.
   */
  async function linkWorkflowRuns({ launches, ledger, parents, depth, links, children }) {
    const runs = [];
    const calls = Array.isArray(launches?.calls) ? launches.calls : [];
    if (!calls.length) return runs;
    const lineageIds = keptIdentities(Array.isArray(launches.sessionIds) ? launches.sessionIds : []);
    // An agentId already linked in this recording (an Agent/Task child's, or another run's) is never linked twice.
    const linkedIds = new Set(links.map((d) => d?.childId).filter((id) => typeof id === 'string'));
    // A run several calls of this recording name is linked only to its one origin, each other call resuming it by its
    // recorded input; anything else is neither's by recorded identity: all keep their M33 D declaration (never the
    // first by order). A runId that is not text is no call's.
    const actOf = (launch) => (ledger.ledger ?? []).find((event) => event.turn === launch.turn && event.seq === launch.seq);
    const roles = workflowCallRoles(calls.map((launch) => ({ ...launch, launched: workflowLaunched(actOf(launch)),
      runId: keptIdentities([launch.runId]).length ? launch.runId : undefined })));
    // The origins that go on to locate their run, each with its parent, its own kept session and its resumes.
    const origins = [];
    for (const [index, launch] of calls.entries()) {
      const role = roles[index];
      if (!role?.origin) continue;
      const parent = parents[launch.source];
      const callSessionId = keptIdentities([launch.sessionId])[0] ?? null;
      // C-03 M33 D, exactly as for an Agent/Task hand-off: a parent whose recorded identity conflicts links nothing,
      // unless its only conflict is the resumed shape (`sessionIdConflictOnly`) and the call recorded its own session.
      if (parent?.identityConflict && !(parent.sessionIdConflictOnly === true && callSessionId)) continue;
      // M33 W2: where the parent received the run's completion — the receipt of the chain's LAST call (`runReceipt`).
      origins.push({ index, launch, parent, callSessionId, receipt: runReceipt(calls, index, role.resumes),
        earlier: earlierReceipts(calls, index, role.resumes),
        resumes: role.resumes.map((resume) => ({ turn: calls[resume].turn, seq: calls[resume].seq })) });
    }
    const copied = await copiedSessions(origins.filter(({ parent }) => depth < WORKFLOW_LIMITS.nestingDepth
      && parent?.adapter === 'claude' && parent.namespace), lineageIds);
    const fresh = [];
    for (const { index, launch, parent, callSessionId, resumes, receipt, earlier } of origins) {
      if (depth >= WORKFLOW_LIMITS.nestingDepth) {
        runs.push(runRecord({ turn: launch.turn, seq: launch.seq, linked: 0,
          losses: { [WORKFLOW_RUN_NOTES.nestedUnlinked]: 1 }, resumes }));
        continue;
      }
      if (parent?.adapter !== 'claude' || !parent.namespace) continue;
      const run = await locateWorkflowRun({ namespace: parent.namespace, runId: launch.runId,
        transcriptDir: launch.transcriptDir, sessionIds: lineageIds, callSessionId,
        copiedSessionId: copied.get(index) ?? null });
      // A run directory is claimed once per review, BEFORE any of its agents is read: a call that names a directory
      // already claimed — a linked agent's own call naming the run that agent belongs to (its run was claimed before
      // the agent was read), or a call of a recording read later — is unresolved and keeps its M33 D declaration.
      if (!run || state.claimedRuns.has(run.dir)) continue;
      state.claimedRuns.add(run.dir);
      const contents = await readWorkflowRun(run, { namespace: parent.namespace });
      if (!contents) continue;
      const plan = planWorkflowRun(contents);
      const losses = { ...plan.losses };
      if (!plan.candidates.length && !Object.values(losses).some((n) => n > 0)) continue;
      const name = plainWorkflowName(launch.workflowName) && keptIdentities([launch.workflowName]).length
        ? launch.workflowName : null;
      let linked = 0;
      for (const [k, candidate] of plan.candidates.entries()) {
        const outcome = await linkWorkflowAgent({ candidate, run, parent, depth, linkedIds });
        if (outcome.note) { losses[outcome.note]++; continue; }
        linked++;
        linkedIds.add(candidate.agentId);
        const [report, note] = candidate.results.length === 1 ? [candidate.results[0], null]
          : [null, candidate.results.length ? WORKFLOW_RUN_NOTES.agentResultConflict : WORKFLOW_RUN_NOTES.agentNoResult];
        if (note) losses[note]++;
        const source = children.length;
        children.push({ source, ledger: outcome.recording, parentInstructions: [] });
        fresh.push({ adapter: 'claude', kind: WORKFLOW_AGENT_KIND, callId: launch.callId, turn: launch.turn,
          workflowSeq: launch.seq, source: launch.source, record: launch.record, childId: candidate.agentId,
          runId: launch.runId, ...(name ? { workflowName: name } : {}), status: 'linked', reason: WORKFLOW_AGENT_LINKED,
          link: { source }, reviewStatus: 'unchecked', ...(report !== null ? { finalAnswer: { text: report } } : {}),
          ...(note ? { reportLoss: note } : {}),
          // C-01 event identity: the k-th agent candidate of its call's run (journal order), a sub-event of the call.
          ...(validIdentity(launch.identity) && launch.identity.sub === undefined
            ? { identity: { ...launch.identity, sub: IDENTITY_SUBS.workflowAgent(k) } } : {}) });
      }
      runs.push(runRecord({ turn: launch.turn, seq: launch.seq, linked, losses, resumes, receipt, earlierReceipts: earlier }));
    }
    // Every new channel is validated before it is stored or hashed: its identities by their declared state, each report
    // rebuilt from its allow-list (redact/index.js `finalAnswer`).
    if (fresh.length) links.push(...redact({ ask: [], ledger: [], claim: {}, delegations: fresh, dropped: [] })
      .ledger.delegations);
    return runs;
  }

  /**
   * M33 W repair 2 (calls copied from an earlier session file). Claude Code continues a conversation in a new session
   * file that repeats earlier rows with the SAME row uuid while rewriting their sessionId, so a copied call's recorded
   * transcriptDir lies under a session X this recording never records. For each origin whose recorded transcriptDir
   * names a run directory under such an X (a text, `keptIdentities`), read `<slug>/<X>.jsonl` once — only the rows
   * naming the calls' own row uuids — and accept X for that call only when the file records the call's tool_use row
   * and every result row with the same uuids, call id, sessionId X and runId (slicer `copiedCallProven`). At most
   * `WORKFLOW_LIMITS.copiedSessions` such files per recording: when more are named, none is read, and every such call
   * keeps today's rule (whatever order the calls were recorded in). Returns Map<call index, X>.
   */
  async function copiedSessions(origins, lineageIds) {
    const proven = new Map();
    const bySession = new Map();
    for (const { index, launch, parent, callSessionId } of origins) {
      const segment = await workflowRunSegment({ namespace: parent.namespace, runId: launch.runId,
        transcriptDir: launch.transcriptDir });
      if (segment === null || lineageIds.includes(segment) || segment === callSessionId
        || !keptIdentities([segment]).length) continue;
      const uuids = [launch.uuid, ...(Array.isArray(launch.resultUuids) ? launch.resultUuids : [])];
      if (!uuids.every((uuid) => typeof uuid === 'string' && uuid) || uuids.length < 2
        || keptIdentities(uuids).length !== uuids.length || keptIdentities([launch.callId]).length !== 1) continue;
      const key = JSON.stringify([parent.namespace, segment]);
      const entry = bySession.get(key) ?? { namespace: parent.namespace, segment, calls: [] };
      entry.calls.push({ index, launch });
      bySession.set(key, entry);
    }
    if (bySession.size > WORKFLOW_LIMITS.copiedSessions) return proven;
    for (const { namespace, segment, calls } of [...bySession.values()]) {
      const rows = await readEarlierSessionRows({ namespace, sessionId: segment, maxLineBytes: limits.lineBytes,
        uuids: calls.flatMap(({ launch }) => [launch.uuid, ...launch.resultUuids]) });
      if (rows === null) continue;
      for (const { index, launch } of calls)
        if (copiedCallProven({ rows, sessionId: segment, callId: launch.callId, runId: launch.runId, uuid: launch.uuid,
          resultUuids: launch.resultUuids })) proven.set(index, segment);
    }
    return proven;
  }

  /** One started agent's recording: `{ recording }` when it links, else `{ note }` naming why not. */
  async function linkWorkflowAgent({ candidate, run, parent, depth, linkedIds }) {
    const { agentId } = candidate;
    const missing = { note: WORKFLOW_RUN_NOTES.agentRecordingMissing };
    const mismatch = { note: WORKFLOW_RUN_NOTES.agentIdentityMismatch };
    if (linkedIds.has(agentId) || keptIdentities([agentId, run.sessionId]).length !== 2) return mismatch;
    const file = join(run.dir, agentFileName(agentId));
    if (state.visited.has(file)) return mismatch;
    if (depth + 1 > limits.depth || state.children >= limits.children
      || state.actionBytes >= limits.aggregateActionBytes) return missing;
    const own = (identity) => identity?.adapter === 'claude' && identity.identityConflict === false
      && identity.nested === true && identity.childId === agentId && identity.sessionId === run.sessionId
      && identity.identityUnchecked !== true && identity.identityUncheckedFields === undefined;
    let snapshot;
    try {
      const maxBytes = Math.min(limits.actionBytes, limits.aggregateActionBytes - state.actionBytes);
      snapshot = await snapshotRecording(file, { namespace: parent.namespace, maxBytes,
        maxLineBytes: Math.min(limits.lineBytes, maxBytes) });
      const identity = await readRecordingIdentity(snapshot.path, { adapter: 'claude', namespace: snapshot.directory,
        maxBytes: snapshot.bytesRead, maxLineBytes: Math.min(limits.lineBytes, snapshot.bytesRead),
        maxRecords: limits.inventoryRecords });
      if (!own(identity)) return mismatch;
      // M33 W: an agent's brief (its first user row) is an ask like any helper's: the slicer keeps it whole and only
      // declares the cut due on it; redaction bounds and validates it, masking nothing (M33 R, D90).
      // D69 (b): named by the recording it was read from, as an Agent/Task child's copy is (`lineageFiles`).
      const sliced = await sliceLineage([snapshot.path], { outcomes: await outcomesFor([file]), includeSources: true,
        sidechainAsMain: true, childRecording: true, workflowLaunches: true, claudeLocators: true, helperDeliveries: true, recorderCensus: true,
        lineageFiles: [file] });
      sliced.lineage.files = [file];
      const cleaned = redact(sliced).ledger;
      if (!own(cleaned.sources?.[0])) return missing;
      state.visited.add(file); state.children++; state.actionBytes += snapshot.bytesRead;
      const recording = await readNode([file], depth + 1, true, cleaned, true);
      return own(recording.sources?.[0]) ? { recording } : missing;
    } catch {
      return missing;
    } finally {
      if (snapshot) await rm(snapshot.directory, { recursive: true, force: true });
    }
  }

  for (const file of files) { const path = await canonical(file); if (path) state.visited.add(path); }
  const root = await readNode(files, 0);
  censusOf.set(root, state.census);
  return root;
}
