// M33 W (Claude Code Workflow agents). A Claude `Workflow` call runs agents that write their own recordings under
// `<projects>/<slug>/<sessionId>/subagents/workflows/<runId>/`: `agent-<agentId>.jsonl` (an ordinary Claude sidechain
// transcript), `agent-<agentId>.meta.json`, and `journal.jsonl`, whose lines record which agents the run `started` and
// the structured value each returned (`result`). This module is the pure half of linking them: the closed vocabulary of
// what cannot be linked, the recorded identity rules, the journal reader and the run plan. It reads no file, no clock,
// no randomness and no network (the IO half is cli/src/workflow-agents.js). Same input, same output.
//
// Joins are by exact recorded identity only, never by time, order or resemblance:
//   call  -> run    the call's own recorded result sidecar `toolUseResult.runId` (a safe id), and a directory named
//                   exactly that, at the recorded `transcriptDir` or the parent session's own run directory;
//   run   -> agent  a journal `started` line's agentId, a file `agent-<agentId>.jsonl` beside it, and every row of
//                   that file recording that agentId and the run's own sessionId;
//   agent -> report the one journal `result` line of that agentId (two different ones: neither).
// Everything that does not join is declared under exactly one closed note, naming the Workflow call's event.
// M33 W repair 2 adds two joins, each by exact recorded identity too:
//   calls -> run    several calls of one recording naming one runId: the one whose recorded input has no
//                   resumeFromRunId owns it (the origin), every other names it by input.resumeFromRunId
//                   (`workflowCallRoles`);
//   copy  -> file   a call whose recorded transcriptDir lies under a session X this recording never records, and
//                   which Claude Code copied from <slug>/<X>.jsonl (same row uuid, sessionId rewritten): proven only
//                   by that file's own rows of the call (`copiedCallProven`).
// M33 W2 adds where a linked run's agents are placed, by exact recorded identity too:
//   run   -> receipt the row where the parent received the run's completion: the earliest typed task notification
//                   the C-02 M33 D join attaches to the chain's LAST call (its recorded call id and its own taskId) and
//                   settles to a final state (`runReceipt`). None recorded: the launch placement stands, declared.

import { strictJson } from './strict-json.js';

/**
 * The closed notes of a Workflow run's losses. One token per way an agent of a run (or the run itself) is not
 * linked, read or reviewed. The ledger adapter declares each as a `children` gap naming the Workflow call's event
 * (evidence/adapters/sonah-ledger.js `WORKFLOW_RUN_GAPS`, re-declared there and asserted equal in the tests):
 *   runUnresolved          — the call recorded a runId, but no acceptable run directory was found. Never stored in
 *                            a ledger: the call's existing M33 D declaration ("a workflow ran agents whose recordings
 *                            are not linked or reviewed") says exactly this, and is kept;
 *   journalMissing         — the run directory holds no readable `journal.jsonl`;
 *   journalUnreadable      — a journal line is not one of the two recorded shapes; the journal is not read at all
 *                            (an unreadable line could be a started agent or a conflicting result);
 *   agentRecordingMissing  — a started agent has no readable recording (none, not a regular file, past this review's
 *                            reading limits, or changed while read);
 *   agentUnstarted         — a recording (or a result) names an agent no `started` line names;
 *   agentIdentityMismatch  — an agent's rows record another agentId or sessionId than the run's, an identity
 *                            redaction withheld, or an agentId this review already linked;
 *   agentNoResult          — a linked agent has no `result` line: no report is attached, none is inferred;
 *   agentResultConflict    — a linked agent has two different `result` lines: neither is attached;
 *   nestedUnlinked         — a Workflow call inside a helper deeper than `WORKFLOW_LIMITS.nestingDepth`;
 *   runEntryUnread         — an entry of the run directory that is none of its journal, an agent recording
 *                            (`*.jsonl`) or an agent's meta file (`agent-<agentId>.meta.json`): a subdirectory or any
 *                            other file is never read, and is counted here so nothing in a run is passed over.
 */
export const WORKFLOW_RUN_NOTES = Object.freeze({
  runUnresolved: 'workflow_run_unresolved',
  journalMissing: 'workflow_journal_missing',
  journalUnreadable: 'workflow_journal_unreadable',
  agentRecordingMissing: 'workflow_agent_recording_missing',
  agentUnstarted: 'workflow_agent_unstarted',
  agentIdentityMismatch: 'workflow_agent_identity_mismatch',
  agentNoResult: 'workflow_agent_no_result',
  agentResultConflict: 'workflow_agent_result_conflict',
  nestedUnlinked: 'workflow_nested_unlinked',
  runEntryUnread: 'workflow_run_entry_unread',
});
/** The notes a ledger's run record may carry, in declaration order (`runUnresolved` is never stored). */
export const WORKFLOW_RUN_LOSSES = Object.freeze([WORKFLOW_RUN_NOTES.journalMissing,
  WORKFLOW_RUN_NOTES.journalUnreadable, WORKFLOW_RUN_NOTES.agentRecordingMissing, WORKFLOW_RUN_NOTES.agentUnstarted,
  WORKFLOW_RUN_NOTES.agentIdentityMismatch, WORKFLOW_RUN_NOTES.agentNoResult, WORKFLOW_RUN_NOTES.agentResultConflict,
  WORKFLOW_RUN_NOTES.nestedUnlinked, WORKFLOW_RUN_NOTES.runEntryUnread]);

/** The delegation kind of a linked Workflow agent, and the reason it was linked (closed, like every reason). */
export const WORKFLOW_AGENT_KIND = 'workflow-agent';
export const WORKFLOW_AGENT_LINKED = 'workflow_agent_linked';

/**
 * Frozen bounds. No per-repo or adaptive value (a project rule): a Workflow call is linked only when it sits fewer than
 * `nestingDepth` hand-offs below the reviewed recording (the root's own calls, and those of its direct helpers); a
 * journal is read only up to `journalBytes` (and `journalLineBytes` per line); a run lists at most `entries`
 * directory entries; the lineage's recorded session ids are read up to `sessionIds` distinct values. M33 W repair 2:
 * a recording reads at most `copiedSessions` earlier session files to prove copied calls (more needed: none is read),
 * each only up to `copiedSessionBytes`, keeping at most `copiedRows` rows that name a wanted row uuid.
 */
export const WORKFLOW_LIMITS = Object.freeze({ nestingDepth: 2, journalBytes: 16_000_000, journalLineBytes: 8_000_000,
  entries: 10_000, sessionIds: 8, copiedSessions: 8, copiedSessionBytes: 512_000_000, copiedRows: 256 });

const MAX_ID = 200;
/** A run id as Claude Code records it (`wf_<8hex>-<3hex>`): `wf_` and lowercase hex and dashes only. */
export const safeRunId = (value) => typeof value === 'string' && value.length > 3 && value.length <= MAX_ID
  && /^wf_[0-9a-f-]+$/.test(value);
/** A Claude agentId (C-03 M33 D): 16 lowercase hex, or `a` and 16 lowercase hex. Nothing else. */
export const safeAgentId = (value) => typeof value === 'string' && /^(?:[0-9a-f]{16}|a[0-9a-f]{16})$/.test(value);
/** A recorded session id that can name a directory and join rows: the slicer's safe identity shape. */
export const safeSessionId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
  && /^[A-Za-z0-9_][A-Za-z0-9_.:-]*$/.test(value) && value !== '..';
/** A recorded workflowName shown in plain words: a plain identifier only (like an M33 T task name), else nothing. */
export const plainWorkflowName = (value) => typeof value === 'string' && value.length <= 64
  && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
/** The agent recording file name of a valid agentId, and the agentId a file name records (null when none). */
export const agentFileName = (agentId) => `agent-${agentId}.jsonl`;
export const agentIdOfFile = (name) => {
  const match = /^agent-(.+)\.jsonl$/.exec(String(name));
  return match && safeAgentId(match[1]) ? match[1] : null;
};
/** The agentId an agent meta file name records (`agent-<agentId>.meta.json`), or null. The file is never read. */
export const agentIdOfMeta = (name) => {
  const match = /^agent-(.+)\.meta\.json$/.exec(String(name));
  return match && safeAgentId(match[1]) ? match[1] : null;
};
export const JOURNAL_FILE = 'journal.jsonl';

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const keysExactly = (value, keys) => plain(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));

/**
 * The exact recorded text of each top-level member value of one JSON object line: `{ name -> [from, until) }` in
 * UTF-16 indices of `raw`, so `raw.slice(from, until)` is a literal substring of the recorded line. The caller has
 * already parsed the line strictly (no repeated key); anything this scanner does not recognise returns null.
 */
export function topLevelValueSpans(raw) {
  if (typeof raw !== 'string') return null;
  const n = raw.length;
  let at = 0;
  const space = () => { let c = raw.charCodeAt(at); while (c === 32 || c === 10 || c === 13 || c === 9) c = raw.charCodeAt(++at); };
  const skipString = () => {
    if (raw.charCodeAt(at) !== 34) throw Error('string');
    at++;
    while (at < n) {
      const c = raw.charCodeAt(at);
      if (c === 92) { at += 2; continue; }
      at++;
      if (c === 34) return;
    }
    throw Error('string');
  };
  const skipValue = (depth) => {
    if (depth > 128) throw Error('depth');
    space();
    const c = raw.charCodeAt(at);
    if (c === 34) { skipString(); return; }
    if (c === 91 || c === 123) {
      const close = c === 91 ? 93 : 125;
      at++; space();
      while (raw.charCodeAt(at) !== close) {
        if (c === 123) { skipString(); space(); if (raw.charCodeAt(at++) !== 58) throw Error('colon'); }
        skipValue(depth + 1); space();
        if (raw.charCodeAt(at) === 44) { at++; space(); continue; }
        if (raw.charCodeAt(at) !== close) throw Error('container');
      }
      at++;
      return;
    }
    const begin = at;
    for (let d = raw.charCodeAt(at); at < n && d !== 32 && d !== 10 && d !== 13 && d !== 9
      && d !== 44 && d !== 93 && d !== 125; d = raw.charCodeAt(++at));
    if (begin === at) throw Error('value');
  };
  try {
    space();
    if (raw.charCodeAt(at) !== 123) return null;
    at++; space();
    const spans = new Map();
    while (raw.charCodeAt(at) !== 125) {
      const keyStart = at;
      skipString();
      const name = JSON.parse(raw.slice(keyStart, at));
      space();
      if (raw.charCodeAt(at++) !== 58) return null;
      space();
      const from = at;
      skipValue(0);
      if (spans.has(name)) return null;
      spans.set(name, [from, at]);
      space();
      if (raw.charCodeAt(at) === 44) { at++; space(); continue; }
      if (raw.charCodeAt(at) !== 125) return null;
    }
    at++; space();
    return at === n ? spans : null;
  } catch { return null; }
}

/**
 * Read one run's journal text: `{ started: [agentId…] in first-recorded order, results: Map<agentId, [text…]>,
 * unreadable: n }`. A line is one strict JSON object of exactly `{type, agentId, key}` (`started`) or `{type, agentId,
 * key, result}` (`result`), with a safe agentId, a nonempty string key and a result that is an object or a string.
 * A `result`'s text is the EXACT recorded JSON text of its value, sliced from the line (`topLevelValueSpans`):
 * never re-serialized, so any quote of it is a literal substring of the recorded journal. Identical repeats are one
 * fact. Blank lines are nothing. Any other line counts as unreadable (and the caller reads none of the journal).
 */
export function readJournal(text) {
  const started = [];
  const seen = new Set();
  const results = new Map();
  let unreadable = 0;
  for (const line of String(text ?? '').split('\n')) {
    const raw = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!raw.trim()) continue;
    const decoded = strictJson(raw);
    const row = decoded.strict ? decoded.value : null;
    const shapeOk = plain(row) && typeof row.key === 'string' && row.key.length > 0 && row.key.length <= 1000
      && safeAgentId(row.agentId)
      && (row.type === 'started' && keysExactly(row, ['type', 'agentId', 'key'])
        || row.type === 'result' && keysExactly(row, ['type', 'agentId', 'key', 'result'])
          && (plain(row.result) || typeof row.result === 'string'));
    if (!shapeOk) { unreadable++; continue; }
    if (row.type === 'started') {
      if (!seen.has(row.agentId)) { seen.add(row.agentId); started.push(row.agentId); }
      continue;
    }
    const span = topLevelValueSpans(raw)?.get('result');
    if (!span) { unreadable++; continue; }
    const value = raw.slice(span[0], span[1]);
    const list = results.get(row.agentId) ?? [];
    if (!list.includes(value)) list.push(value);
    results.set(row.agentId, list);
  }
  return { started, results, unreadable };
}

/**
 * The plan of one located run, before any recording is read: which started agents have a recording to verify
 * (`candidates`, in journal order), and what is already lost. `files` maps each `.jsonl` entry name of the run
 * directory (other than the journal) to whether it is a regular file; `others` counts every entry that is none of
 * the journal, a `.jsonl` entry or an agent meta file (never read: `runEntryUnread`, whatever else the run holds).
 * Pure and order-independent in its inputs: the file names are compared exactly, the journal order is the recorded one.
 */
export function planWorkflowRun({ journal, files, others = 0 }) {
  if (!Number.isSafeInteger(others) || others < 0) throw new TypeError('others must be a count');
  const losses = Object.fromEntries(WORKFLOW_RUN_LOSSES.map((note) => [note, 0]));
  losses[WORKFLOW_RUN_NOTES.runEntryUnread] = others;
  const candidates = [];
  if (journal === null) { losses[WORKFLOW_RUN_NOTES.journalMissing] = 1; return { candidates, losses }; }
  if (journal.unreadable > 0) {
    losses[WORKFLOW_RUN_NOTES.journalUnreadable] = journal.unreadable;
    return { candidates, losses };
  }
  const startedSet = new Set(journal.started);
  for (const agentId of journal.started) {
    const name = agentFileName(agentId);
    if (files.get(name) !== true) { losses[WORKFLOW_RUN_NOTES.agentRecordingMissing]++; continue; }
    candidates.push({ agentId, file: name, results: journal.results.get(agentId) ?? [] });
  }
  // A recording, or a result, no `started` line names: never linked, never guessed. Each named once.
  const unstarted = new Set();
  for (const name of [...files.keys()].sort()) {
    const agentId = agentIdOfFile(name);
    if (agentId === null || !startedSet.has(agentId)) unstarted.add(agentId === null ? `file:${name}` : agentId);
  }
  for (const agentId of journal.results.keys()) if (!startedSet.has(agentId)) unstarted.add(agentId);
  losses[WORKFLOW_RUN_NOTES.agentUnstarted] = unstarted.size;
  return { candidates, losses };
}

/** Did this ledger action launch a Workflow? Exactly the M33 D rule the adapter applies (sonah-ledger.js
 *  `workflowLaunched`, re-stated there: that package never imports this one): a recorded own result that is not an
 *  error or failure, not interrupted, conflicting, retracted or recorder-withheld. */
export function workflowLaunched(act) {
  return plain(act) && act.tool === 'Workflow' && (act.result?.seen === true || act.workflowAsyncUnresolved === true)
    && act.isError !== true && act.observationMissing !== true && act.interrupted !== true
    && act.conflict !== true && act.outcomeUnknown !== true && act.result?.outcome !== 'failed';
}

/** A run record as a ledger stores it: the Workflow call's event (turn, seq), how many agents were linked, and
 *  each closed loss with a positive count (others omitted, so the record states only what was lost). M33 W repair 2:
 *  `resumes`, the events (`{turn, seq}`) of the calls that resumed this run, in recorded order — only when there is
 *  one, so a run no call resumed keeps its bytes. M33 W2: `receipt`, where the parent received the run's completion
 *  (`runReceipt`) — only when one was recorded, so a run with none keeps its bytes. */
export function runRecord({ turn, seq, linked, losses, resumes = [], receipt = null, earlierReceipts = 0 }) {
  const kept = Object.fromEntries(WORKFLOW_RUN_LOSSES.filter((note) => losses[note] > 0).map((note) => [note, losses[note]]));
  const received = workflowReceipt(receipt);
  return { turn, seq, linked, ...(Object.keys(kept).length ? { losses: kept } : {}),
    ...(resumes.length ? { resumes: resumes.map((resume) => ({ turn: resume.turn, seq: resume.seq })) } : {}),
    ...(received ? { receipt: received } : {}),
    // M33 P (W2 recheck minor): how many EARLIER calls of the chain recorded a receipt of their own (only beside a
    // receipt of the last call, and only when positive, so every other record keeps its bytes).
    ...(received && Number.isSafeInteger(earlierReceipts) && earlierReceipts > 0 ? { earlierReceipts } : {}) };
}

/**
 * M33 P (W2 recheck minor). How many calls of a run's chain other than its LAST recorded a receipt of their own: the
 * agents are placed at the last call's receipt (the journal records no call per agent), so the order of their work
 * relative to an earlier receipt is not recorded, and is declared. Pure.
 */
export function earlierReceipts(calls, origin, resumes = []) {
  const list = Array.isArray(calls) ? calls : [];
  const chain = [origin, ...(Array.isArray(resumes) ? resumes : [])];
  if (!chain.every((index) => Number.isSafeInteger(index) && index >= 0 && index < list.length)) return 0;
  const last = Math.max(...chain);
  return chain.filter((index) => index !== last && workflowReceipt(list[index]?.receipt) !== null).length;
}

/**
 * M33 W2 (placement at receipt). The typed task-notification statuses that record a Workflow's FINAL state (C-02 M33
 * D: `completed` or `failed`; `stopped` proves nothing). Only a notification the M33 D join attaches to a launch and
 * settles to one of these is where the parent RECEIVED the run's completion.
 */
export const WORKFLOW_RECEIPT_STATUSES = Object.freeze(['completed', 'failed']);

/**
 * M33 W2. A receipt as the slicer records it: exactly `{turn, beforeEvent, source, record}` — the human turn the
 * notification row was read in, how many actions of the recording were recorded before it (the slicer's own count, as
 * a commentary block or a typed interrupt mark records it), and its row (stream, one-based record). Safe nonnegative
 * integers, `record` at least 1. Anything else is no receipt (null). Never a timestamp.
 */
export function workflowReceipt(value) {
  const count = (n, least = 0) => Number.isSafeInteger(n) && n >= least;
  if (!keysExactly(value, ['turn', 'beforeEvent', 'source', 'record']) || !count(value.turn) || !count(value.beforeEvent)
    || !count(value.source) || !count(value.record, 1)) return null;
  return { turn: value.turn, beforeEvent: value.beforeEvent, source: value.source, record: value.record };
}

/**
 * M33 W2. Where the parent received a linked run's completion: the receipt of the LAST call of its chain — the origin
 * and every call resuming it (`workflowCallRoles`), the last in recorded order (`calls` is the slicer's launch side
 * channel, in recorded order) — or null when that call recorded none. An earlier call's receipt is never the run's: the
 * run went on after it. Pure; no order but the recorded one, no time.
 */
export function runReceipt(calls, origin, resumes = []) {
  const list = Array.isArray(calls) ? calls : [];
  const chain = [origin, ...(Array.isArray(resumes) ? resumes : [])];
  if (!chain.every((index) => Number.isSafeInteger(index) && index >= 0 && index < list.length)) return null;
  return workflowReceipt(list[Math.max(...chain)]?.receipt);
}

/**
 * M33 W repair 2 (resumed runs). Which Workflow calls of one recording own a run, and which resume it. `calls` are the
 * slicer's launch side channel calls (in recorded order), each with `launched` added: the M33 D rule
 * (`workflowLaunched`) on its ledger action. A run's calls are every call whose own results recorded its runId and
 * every call whose recorded input names it by `resumeFromRunId` (a safe run id only). They link only when
 *   - exactly one of them records no `resumeFromRunId` in its input: the ORIGIN, whichever position it holds;
 *   - every other one is a RESUME: its input's `resumeFromRunId` and its own results' runId are both that runId;
 *   - every one launched; and
 *   - every resume recorded the origin's very `transcriptDir` (or, neither recording one, the origin's own recorded
 *     session): the run directory its agents wrote is then the one linked, so no resume's agents are passed over.
 * Returns one entry per call: `{ origin: true, resumes: [index…] }`, `{ resumeOf: index }`, or null — nothing of
 * that call links, and its M33 D declaration stands. A lone call with no `resumeFromRunId` is an origin with no
 * resumes (the rule before this repair). A lone resume (a run no call here launched), two origins, a resume naming
 * another run than its own result records — which leaves neither run's calls linked — or a resume that recorded
 * another run directory link nothing. Pure: no order, time or name is compared.
 */
export function workflowCallRoles(calls) {
  const list = Array.isArray(calls) ? calls : [];
  const roles = list.map(() => null);
  const groups = new Map();
  const join = (runId, index) => {
    if (!safeRunId(runId)) return;
    const members = groups.get(runId) ?? [];
    if (!members.includes(index)) members.push(index);
    groups.set(runId, members);
  };
  list.forEach((call, index) => {
    if (!plain(call)) return;
    join(call.runId, index);
    if (call.resumeFromRunId !== undefined) join(call.resumeFromRunId, index);
  });
  for (const [runId, members] of groups) {
    const origins = members.filter((index) => list[index].resumeFromRunId === undefined);
    if (origins.length !== 1) continue;
    const [origin] = origins;
    const owner = list[origin];
    const sameRun = (call) => (typeof owner.transcriptDir === 'string' ? call.transcriptDir === owner.transcriptDir
      : call.transcriptDir === undefined && owner.transcriptDir === undefined && typeof owner.sessionId === 'string'
        && call.sessionId === owner.sessionId);
    const resumes = members.filter((index) => index !== origin);
    if (owner.runId !== runId || !members.every((index) => list[index].launched === true)
      || !resumes.every((index) => list[index].resumeFromRunId === runId && list[index].runId === runId
        && sameRun(list[index]))) continue;
    roles[origin] = { origin: true, resumes };
    for (const index of resumes) roles[index] = { resumeOf: origin };
  }
  return roles;
}

/**
 * M33 W repair 2 (calls copied from an earlier session file). Claude Code continues a conversation in a new session
 * file that repeats earlier rows with the SAME row uuid while rewriting their sessionId. A call whose recorded
 * transcriptDir lies under a session X this recording never records is accepted only when X's own file proves the
 * call was X's: `rows` maps each wanted row uuid to every row of `<slug>/<X>.jsonl` that records it (null for a line
 * naming it that is not one strict JSON object), and
 *   - the call's tool_use row (`uuid`) is there, and every row with that uuid records `sessionId` X, is an assistant
 *     row, and holds exactly one `tool_use` block with the call's own id, a `Workflow` call; and
 *   - every result row of the call (`resultUuids`, each distinct from the tool_use row's) is there, and every row with
 *     that uuid records X, is a user row whose one `tool_result` block answers the call, and whose sidecar records the
 *     very same `runId`.
 * Anything less is false (the call keeps its declaration). Pure; nothing of the rows is returned.
 */
export function copiedCallProven({ rows, sessionId, callId, runId, uuid, resultUuids }) {
  if (!(rows instanceof Map) || !safeSessionId(sessionId) || typeof callId !== 'string' || !callId || !safeRunId(runId)
    || typeof uuid !== 'string' || !uuid || !Array.isArray(resultUuids) || !resultUuids.length
    || resultUuids.some((value) => typeof value !== 'string' || !value || value === uuid)) return false;
  const blocks = (row) => (plain(row.message) && Array.isArray(row.message.content) ? row.message.content : []);
  const own = (row, key, type) => plain(row) && row.uuid === key && row.sessionId === sessionId && row.type === type;
  const use = (row, key) => {
    if (!own(row, key, 'assistant')) return false;
    const calls = blocks(row).filter((block) => plain(block) && block.type === 'tool_use' && block.id === callId);
    return calls.length === 1 && calls[0].name === 'Workflow';
  };
  const result = (row, key) => {
    if (!own(row, key, 'user')) return false;
    const answers = blocks(row).filter((block) => plain(block) && block.type === 'tool_result');
    return answers.length === 1 && answers[0].tool_use_id === callId && plain(row.toolUseResult)
      && row.toolUseResult.runId === runId;
  };
  const every = (key, agrees) => {
    const found = rows.get(key);
    return Array.isArray(found) && found.length > 0 && found.every((row) => agrees(row, key));
  };
  return every(uuid, use) && [...new Set(resultUuids)].every((key) => every(key, result));
}
