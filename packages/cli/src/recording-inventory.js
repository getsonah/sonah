import { lstat, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readRecordingIdentity, recordingVersion } from './recording-read.js';
import { CONFLICT_CANDIDATE_FIELDS } from '../../slicer/src/recording-identity.js';

// Metadata is streamed, so total bytes/records/time do not impose a small-session default.
// Explicit lower budgets remain useful for callers and tests, and always produce an incomplete
// inventory. The per-line ceiling bounds one JSON parse; it never silently excludes a source.
const UNBOUNDED = Number.MAX_SAFE_INTEGER;
/**
 * C-03 M33 D: what the Claude inventory names instead of skipping silently. A directory below
 * `<session>/subagents/` is not a place Claude Code writes Agent/Task children: `workflows/<runId>/`
 * holds a Workflow's own agents (declared per Workflow launch on the children channel by the
 * ledger adapter), and any other directory is named too. Neither is indexed, and neither makes the
 * Agent-child inventory incomplete. Closed, like every reason table.
 */
export const RECORDING_INVENTORY_NOTES = Object.freeze({
  WORKFLOW_RECORDINGS_UNINDEXED: 'workflow_recordings_unindexed',
  SUBAGENT_DIRECTORY_UNINDEXED: 'subagent_directory_unindexed',
});
const inventoryVersions = new WeakMap();
export const RECORDING_INDEX_LIMITS = Object.freeze({ files: 100_000, directories: 100_000, depth: 16,
  metadataBytes: UNBOUNDED, inventoryBytes: UNBOUNDED, inventoryRecords: UNBOUNDED,
  lineBytes: 128_000_000, milliseconds: UNBOUNDED });

const wellFormedCandidates = candidates => candidates !== null && typeof candidates === 'object'
  && candidates.malformed === false && Array.isArray(candidates.overflow)
  && candidates.overflow.every(field => CONFLICT_CANDIDATE_FIELDS.includes(field))
  && candidates.values !== null && typeof candidates.values === 'object'
  && CONFLICT_CANDIDATE_FIELDS.every(field => Array.isArray(candidates.values[field]));

/** C-03 (M33 conflicting sources). Every candidate value of a conflicting source (each one the recording-identity
 * read checked by its shape, slicer recording-identity.js). The records live only in this frozen Map, keyed by source
 * key: never in sources, a ledger, a packet or a cache key. A candidate list that cannot be verified is recorded as
 * malformed. D90 (owner decision 2026-10-15, privacy is not a design constraint): nothing scans a value, so no field
 * is `hidden` (an identity scan once dropped a value it read as secret-shaped and hid its field, which matched any
 * value); the field stays in the record's shape (slicer child-links.js reads it). */
function conflictCandidateRecords(pending) {
  const records = new Map();
  for (const [key, { candidates }] of pending) {
    const wellFormed = wellFormedCandidates(candidates);
    records.set(key, { malformed: !wellFormed,
      values: Object.fromEntries(CONFLICT_CANDIDATE_FIELDS.map(field => [field, wellFormed ? [...candidates.values[field]]
        : []])), hidden: new Set(), overflow: wellFormed ? [...candidates.overflow] : [] });
  }
  const frozen = new Map([...records].map(([key, record]) => [key, Object.freeze({
    malformed: record.malformed,
    values: Object.freeze(Object.fromEntries(CONFLICT_CANDIDATE_FIELDS
      .map(field => [field, Object.freeze([...record.values[field]])]))),
    hidden: Object.freeze(CONFLICT_CANDIDATE_FIELDS.filter(field => record.hidden.has(field))),
    overflow: Object.freeze(CONFLICT_CANDIDATE_FIELDS.filter(field => record.overflow.includes(field))),
  })]));
  const readOnly = () => { throw new TypeError('Conflict candidates are read-only'); };
  for (const name of ['set', 'delete', 'clear']) Object.defineProperty(frozen, name, { value: readOnly });
  return Object.freeze(frozen);
}

async function enumerate(namespace, adapter, limits, deadline) {
  const files = [], reasons = new Set();
  let directories = 0, omittedFiles = 0, incomplete = false, unindexedDirectories = 0;
  const unavailable = reason => { incomplete = true; reasons.add(reason); };
  async function walk(dir, depth) {
    if (performance.now() >= deadline) { unavailable('deadline'); return; }
    if (++directories > limits.directories) { unavailable('directories'); return; }
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch { unavailable('directory_unverified'); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (performance.now() >= deadline) { unavailable('deadline'); return; }
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) { unavailable('source_alias'); continue; }
      if (entry.isDirectory()) {
        if (adapter === 'claude') {
          if (depth === 0 || (depth === 1 && /^subagents?$/.test(entry.name))) await walk(file, depth + 1);
          else if (depth === 2) {
            unindexedDirectories++;
            reasons.add(entry.name === 'workflows' ? RECORDING_INVENTORY_NOTES.WORKFLOW_RECORDINGS_UNINDEXED
              : RECORDING_INVENTORY_NOTES.SUBAGENT_DIRECTORY_UNINDEXED);
          }
        } else if (depth < limits.depth) await walk(file, depth + 1);
        else unavailable('depth');
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      if (adapter === 'codex' && !/^rollout-\d{4}-\d{2}-\d{2}T/.test(entry.name)) continue;
      if (adapter === 'claude' && !/(?:^|\/)subagents?\//.test(relative(namespace, file))) continue;
      if (files.length >= limits.files) { omittedFiles++; unavailable('files'); continue; }
      files.push(file);
    }
  }
  await walk(namespace, 0);
  return { files, reasons, directories, omittedFiles, incomplete, unindexedDirectories };
}

export async function indexRecordings(namespace, adapter, { limits: lower = {} } = {}) {
  const limits = { ...RECORDING_INDEX_LIMITS, ...lower };
  if (!['codex', 'claude'].includes(adapter) || Object.entries(limits).some(([key, n]) =>
    !Number.isSafeInteger(n) || n <= 0 || !(key in RECORDING_INDEX_LIMITS) || n > RECORDING_INDEX_LIMITS[key])) {
    throw new Error('Recording inventory limits could not be verified');
  }
  const started = performance.now(), deadline = limits.milliseconds === UNBOUNDED
    ? Infinity : started + limits.milliseconds;
  const first = await enumerate(namespace, adapter, limits, deadline);
  const { files } = first;
  const sources = [], versions = new Map(), reasons = new Set(first.reasons), pendingCandidates = new Map();
  let failedFiles = 0, bytesRead = 0, records = 0, scannedFiles = 0;
  for (const [key, file] of files.entries()) {
    if (bytesRead >= limits.inventoryBytes) { reasons.add('inventory_bytes'); break; }
    if (records >= limits.inventoryRecords) { reasons.add('inventory_records'); break; }
    if (performance.now() >= deadline) { reasons.add('deadline'); break; }
    const remaining = Math.min(limits.metadataBytes, limits.inventoryBytes - bytesRead);
    try {
      const { bytesRead: bytes, records: count, version, candidates, ...identity } = await readRecordingIdentity(file,
        { adapter, namespace, maxBytes: remaining, maxLineBytes: Math.min(limits.lineBytes, remaining),
          maxRecords: limits.inventoryRecords - records, deadline, candidates: true });
      bytesRead += bytes; records += count; scannedFiles++;
      if (!identity.identityConflict && !(adapter === 'codex' ? identity.sessionId : identity.childId)) {
        failedFiles++;
        reasons.add('identity_missing');
        continue;
      }
      versions.set(file, version);
      sources.push({ ...identity, namespace, key });
      if (identity.identityConflict === true) pendingCandidates.set(key, { adapter, candidates });
    } catch (error) {
      bytesRead += error.bytesRead ?? 0; records += error.records ?? 0; scannedFiles++;
      failedFiles++;
      reasons.add(error.reason === 'bytes' && remaining < limits.metadataBytes ? 'inventory_bytes'
        : error.reason === 'records' ? 'inventory_records' : error.reason ?? 'unverified');
      // Later candidates still count, but no link is released with an unknown candidate.
    }
  }
  const unscannedFiles = files.length - scannedFiles + first.omittedFiles;
  // Detect an added/deleted candidate or changed verified file before releasing the index.
  const last = await enumerate(namespace, adapter, limits, deadline);
  const enumerationChanged = first.incomplete !== last.incomplete || first.omittedFiles !== last.omittedFiles
    || files.length !== last.files.length || files.some((file, index) => file !== last.files[index]);
  if (enumerationChanged) reasons.add('enumeration_changed');
  for (const reason of last.reasons) reasons.add(reason);
  let changedFiles = 0;
  for (const [file, version] of versions) {
    try {
      if (recordingVersion(await lstat(file, { bigint: true })) !== version) changedFiles++;
    } catch { changedFiles++; }
  }
  if (changedFiles) reasons.add('source_changed');
  // D90 (owner decision 2026-10-15): the identities are kept as read (checked by their shape, recording-identity.js);
  // nothing scans them before cache storage or a join (an identity scan once did).
  if (performance.now() >= deadline) reasons.add('deadline');
  const enumerationIncomplete = first.incomplete || last.incomplete || enumerationChanged;
  const incomplete = enumerationIncomplete || failedFiles > 0 || unscannedFiles > 0 || changedFiles > 0
    || reasons.has('deadline');
  const conflictCandidates = conflictCandidateRecords(pendingCandidates);
  const result = { files, sources, conflictCandidates, incomplete,
    stats: { candidateFiles: files.length + first.omittedFiles, verifiedFiles: sources.length,
      failedFiles, unscannedFiles, omittedFiles: first.omittedFiles, enumerationIncomplete,
      unindexedDirectories: first.unindexedDirectories,
      changedFiles, bytesRead, records, elapsedMs: performance.now() - started,
      reasons: [...reasons] } };
  if (!incomplete) inventoryVersions.set(result, { namespace, adapter, limits, versions });
  return result;
}

/** Check a cached complete inventory before a later review unit reuses an absence/uniqueness
 * claim. This is cheap directory/stat work; content is rescanned only if any version changed. */
export async function recordingInventoryCurrent(inventory) {
  const saved = inventoryVersions.get(inventory);
  if (!saved || inventory.incomplete) return false;
  const { namespace, adapter, limits, versions } = saved;
  const now = await enumerate(namespace, adapter, limits, Infinity);
  if (now.incomplete || now.files.length !== inventory.files.length
    || now.files.some((file, i) => file !== inventory.files[i])) return false;
  for (const [file, version] of versions) {
    try {
      if (recordingVersion(await lstat(file, { bigint: true })) !== version) return false;
    } catch { return false; }
  }
  return true;
}
