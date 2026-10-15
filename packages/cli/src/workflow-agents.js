// M33 W (Claude Code Workflow agents), the IO half. Locates one Workflow run's directory by exact recorded identity
// and reads what it holds: its journal (bounded, through the same verified read as every recording) and the names of
// its agent recordings. Nothing here joins, infers or orders by time: the plan is the slicer's (slicer/src/
// workflow-runs.js), and every agent recording is verified, sliced and redacted by the caller (session-evidence.js)
// exactly as an Agent/Task child is. No model, no network; paths never leave this module.
import { lstat, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { readRecording, readRecordingRows } from './recording-read.js';
import { redact } from '../../redact/index.js';
import { JOURNAL_FILE, WORKFLOW_LIMITS, agentIdOfMeta, readJournal, safeRunId, safeSessionId }
  from '../../slicer/src/workflow-runs.js';

const canonical = (path) => realpath(path).catch(() => null);

/**
 * The recorded identities the redactor keeps, in order: each value goes through the same fail-closed identity scan a
 * recording's own identity passes (a source row's `sessionId`), BEFORE it is compared or used to name a directory. A
 * value the scan withholds is never a join key; it is simply not kept.
 */
export function keptIdentities(values) {
  const rows = values.map((value) => ({ adapter: 'claude', sessionId: value }));
  if (!rows.length) return [];
  const scrubbed = redact({ ask: [], ledger: [], claim: {}, sources: rows, dropped: [] }).ledger.sources;
  return values.filter((value, index) => typeof value === 'string' && scrubbed?.[index]?.sessionId === value
    && scrubbed[index].identityUncheckedFields === undefined && scrubbed[index].identityUnchecked !== true);
}

/**
 * The run directory a recorded path names, whatever session segment it lies under, or null: a real directory (not a
 * symlink) whose CANONICAL path is exactly `<root>/<sessionId>/subagents/workflows/<runId>` with a safe `sessionId`
 * segment and the path's basename the runId. `root` is the canonical namespace. Canonicalization means no symlink can
 * lead out of the namespace or into another session's segment unnoticed. Returns `{ dir, sessionId }`.
 */
async function runAt(root, path, runId) {
  if (typeof path !== 'string' || !isAbsolute(path) || basename(path) !== runId) return null;
  let entry;
  try { entry = await lstat(path); } catch { return null; }
  if (!entry.isDirectory() || entry.isSymbolicLink()) return null;
  const real = await canonical(path);
  if (!real) return null;
  const parts = relative(root, real).split(sep);
  if (parts.length !== 4 || !safeSessionId(parts[0]) || parts[1] !== 'subagents' || parts[2] !== 'workflows'
    || parts[3] !== runId || join(root, ...parts) !== real) return null;
  return { dir: real, sessionId: parts[0] };
}

/**
 * M33 W repair 2. The session segment of the run directory a call's recorded `transcriptDir` names inside the
 * namespace (`runAt`), or null. Only names a candidate: the caller accepts a segment the lineage never recorded only
 * once that session's own file proves the call was copied from it (`readEarlierSessionRows`, slicer
 * `copiedCallProven`).
 */
export async function workflowRunSegment({ namespace, runId, transcriptDir }) {
  if (!safeRunId(runId) || typeof namespace !== 'string' || !namespace) return null;
  const root = await canonical(namespace);
  return root ? (await runAt(root, transcriptDir, runId))?.sessionId ?? null : null;
}

/**
 * Where a Workflow call's run lives, or null (the run is unresolved). `namespace` is the Claude projects slug
 * directory that holds the parent recording. A candidate directory is accepted only when `runAt` accepts it with
 * `runId` the call's own recorded, safe run id and its session segment one of the allowed. The recorded
 * `transcriptDir` is tried first, under any of the lineage's recorded session ids (a resumed parent records two) or
 * `copiedSessionId` — a session the lineage never records, whose own file proved this very call was copied from it
 * (M33 W repair 2; the caller proves it) — else only the call's own session's run directory. Returns
 * `{ dir, sessionId }`: the canonical run directory and the session id of its segment, which every row of its agents
 * must record.
 */
export async function locateWorkflowRun({ namespace, runId, transcriptDir, sessionIds, callSessionId,
  copiedSessionId = null }) {
  if (!safeRunId(runId) || typeof namespace !== 'string' || !namespace) return null;
  const root = await canonical(namespace);
  if (!root) return null;
  const own = safeSessionId(callSessionId) ? callSessionId : null;
  const lineage = new Set([...(Array.isArray(sessionIds) ? sessionIds : []).filter(safeSessionId), ...(own ? [own] : []),
    ...(safeSessionId(copiedSessionId) ? [copiedSessionId] : [])]);
  const recorded = await runAt(root, transcriptDir, runId);
  if (recorded && lineage.has(recorded.sessionId)) return recorded;
  const fallback = own ? await runAt(root, join(root, own, 'subagents', 'workflows', runId), runId) : null;
  return fallback && fallback.sessionId === own ? fallback : null;
}

/**
 * M33 W repair 2. The rows of the earlier session file `<namespace>/<sessionId>.jsonl` that record one of `uuids`,
 * read like a recording (`readRecordingRows`: inside the slug namespace, a regular owned single-linked file, bounded,
 * unchanged while read, only lines naming a wanted uuid parsed). Null when it cannot be read within those bounds.
 * Nothing else of the file is kept; its path never leaves this module.
 */
export async function readEarlierSessionRows({ namespace, sessionId, uuids, maxLineBytes, limits = WORKFLOW_LIMITS }) {
  if (!safeSessionId(sessionId) || typeof namespace !== 'string' || !namespace) return null;
  const maxBytes = limits.copiedSessionBytes;
  try {
    return await readRecordingRows(join(namespace, `${sessionId}.jsonl`), { namespace, uuids, maxBytes,
      maxLineBytes: Math.min(maxLineBytes ?? maxBytes, maxBytes), maxRows: limits.copiedRows });
  } catch { return null; }
}

/**
 * What a located run holds: its journal, read (`null` when there is no journal entry; an entry that is not a regular
 * file, or cannot be read within the frozen bounds, reads as one unreadable line), every other `.jsonl` entry by
 * name, with whether it is a regular file, and how many `others` it lists: entries that are none of these and no
 * agent meta file (`agent-<agentId>.meta.json`, never read) — a subdirectory or any other file, never read, counted.
 * Entries are compared by name in code-unit order, so the result never depends on the directory listing order. Returns null when the directory cannot be listed, or lists more entries
 * than `WORKFLOW_LIMITS.entries` (the run is then unresolved, and its M33 D declaration stands).
 */
export async function readWorkflowRun(run, { namespace, limits = WORKFLOW_LIMITS } = {}) {
  let entries;
  try { entries = await readdir(run.dir, { withFileTypes: true }); } catch { return null; }
  if (entries.length > limits.entries) return null;
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const files = new Map();
  let journalEntry = null;
  let others = 0;
  for (const entry of entries) {
    if (entry.name === JOURNAL_FILE) { journalEntry = entry; continue; }
    if (entry.name.endsWith('.jsonl')) files.set(entry.name, entry.isFile() && !entry.isSymbolicLink());
    else if (agentIdOfMeta(entry.name) === null) others++;
  }
  let journal = null;
  if (journalEntry) {
    const unreadable = { started: [], results: new Map(), unreadable: 1 };
    if (!journalEntry.isFile() || journalEntry.isSymbolicLink()) journal = unreadable;
    else {
      try {
        const bytes = await readRecording(join(run.dir, JOURNAL_FILE), { namespace,
          maxBytes: limits.journalBytes, maxLineBytes: limits.journalLineBytes });
        journal = readJournal(bytes.toString('utf8'));
      } catch { journal = unreadable; }
    }
  }
  return { journal, files, others };
}
