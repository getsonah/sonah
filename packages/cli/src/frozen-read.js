// D142 (the owner, 2026-10-23): a frozen read. `/sonah` starts a review while the agent's turn
// is still open, so the recording it reviews keeps growing while the review reads it. A review by session id
// (`sonah review --session ID`) therefore reads every recording its load may read as it was when the review started:
// before the load, the size of each `.jsonl` file there is taken once (`freezeRecordings`), and each read of such a file
// reads it only through its last whole line within that size. A row written later is never read, and the same start
// gives the same bytes, so the same `slice_hash`, whatever is written meanwhile.
//
// What "there" is: the reviewed recording, and every `.jsonl` file of the folder its load reads (Claude Code: the
// recording's project folder, with each session's helpers below it; Codex: the `sessions` folder, whose rollouts include
// the helpers). The earlier recordings a session continues (D126) are in the same project folder. A file is known by its
// device and inode (whatever its path's spelling), and a file not there at the start is not read by a frozen load.
// Structure only: sizes and newline bytes, never a word of a row. No network.
//
// D159: the cut a frozen read used is kept (`record`): the instant its sizes were taken (the one clock read here, just
// before the first size) and every size it took, by path. A replay given that record (`frozenFromRecord`) reads the
// same bytes, whatever was written since, with no instant to find again.
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** How deep the folder walk goes below the folder it starts in: Claude Code writes a Workflow's agents at
 *  `<session>/subagents/workflows/<run>/agent-*.jsonl`, Codex its rollouts at `YYYY/MM/DD/`. */
export const FROZEN_WALK_DEPTH = 4;
/** D159: the version of a frozen read's record (`record()`), kept in a review's state folder. */
export const FROZEN_READ_SCHEMA = 'sonah.frozen-read/1';
const FROZEN_READ_FIELDS = Object.freeze(['schema', 'at', 'adapter', 'recording', 'bytes', 'files']);
const ADAPTERS = Object.freeze(['claude', 'codex']);
const CHUNK = 64 * 1024;
const keyOf = (stat) => `${stat.dev}:${stat.ino}`;

/** The offset just after the last newline in the first `size` bytes of the open file (0 when there is none). A file
 *  now shorter than `size` cannot be read back from it, and throws: a frozen read never reads such a file. */
export async function wholeLinesEnd(handle, size) {
  const buffer = Buffer.allocUnsafe(CHUNK);
  for (let end = size; end > 0;) {
    const start = Math.max(0, end - CHUNK);
    const { bytesRead } = await handle.read(buffer, 0, end - start, start);
    if (bytesRead !== end - start) throw new Error('A recording end could not be verified');
    const at = buffer.subarray(0, bytesRead).lastIndexOf(0x0a);
    if (at !== -1) return start + at + 1;
    end = start;
  }
  return 0;
}

/** D159: a path below `folder`, as the record names it (relative, never `..`), or null for one outside it. */
const below = (folder, path) => {
  if (typeof folder !== 'string') return null;
  const rel = relative(folder, path);
  return rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`) ? rel : null;
};
const isSize = (value) => Number.isSafeInteger(value) && value >= 0;
const isInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const isRelative = (path) => typeof path === 'string' && path.length > 0 && !isAbsolute(path)
  && !path.split('/').some((part) => part === '' || part === '.' || part === '..');

/** D159: whether `record` is a frozen read's record as `record()` writes it: its instant (an ISO time to the
 *  millisecond), its harness, the reviewed recording's path and its size at the start (null when it was not a regular
 *  file), and every file of the folder with its size at the start, by relative path, in path order, each once. */
export function frozenReadValid(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return false;
  const keys = Object.keys(record);
  if (keys.length !== FROZEN_READ_FIELDS.length || !FROZEN_READ_FIELDS.every((key) => keys.includes(key))) return false;
  if (record.schema !== FROZEN_READ_SCHEMA || !isInstant(record.at)) return false;
  if (!(record.adapter === null || ADAPTERS.includes(record.adapter))) return false;
  if (typeof record.recording !== 'string' || !isAbsolute(record.recording)) return false;
  if (!(record.bytes === null || isSize(record.bytes)) || !Array.isArray(record.files)) return false;
  return record.files.every((entry, i) => Array.isArray(entry) && entry.length === 2 && isRelative(entry[0])
    && isSize(entry[1]) && (i === 0 || record.files[i - 1][0] < entry[0]));
}

/**
 * A frozen set from sizes already taken (`Map` of `dev:ino` to a BigInt size). `sizeOf(stat)` the size of the file a
 * `{ bigint: true }` stat names when the review started, or null when it was not there; `endOf(path)` the offset just
 * after its last whole line within that size (computed once, from the file's own bytes), or null when the file was not
 * there at the start or is now shorter than it was. D159: with `cut` (`{ at, adapter, recording, folder, paths }`: the
 * instant in milliseconds, the harness, the reviewed recording's path, the folder walked and each key's path), `record()`
 * gives the cut as a record (FROZEN_READ_SCHEMA); without it, null.
 */
export function frozenOf(sizes, cut = null) {
  const ends = new Map();
  const sizeOf = (stat) => (stat && sizes.has(keyOf(stat)) ? sizes.get(keyOf(stat)) : null);
  return Object.freeze({
    sizeOf,
    has: (stat) => sizeOf(stat) !== null,
    async endOf(path) {
      let entry;
      try { entry = await lstat(path, { bigint: true }); } catch { return null; }
      const size = sizeOf(entry);
      if (size === null || entry.size < size) return null;
      const key = keyOf(entry);
      if (!ends.has(key)) {
        let handle;
        try {
          handle = await open(path, 'r');
          const opened = await handle.stat({ bigint: true });
          ends.set(key, keyOf(opened) === key ? await wholeLinesEnd(handle, Number(size)) : null);
        } catch { ends.set(key, null); }
        finally { await handle?.close().catch(() => {}); }
      }
      return ends.get(key);
    },
    record() {
      if (cut === null || !Number.isFinite(cut.at)) return null;
      const files = [];
      for (const [key, size] of sizes) {
        const path = cut.paths.get(key);
        const rel = typeof path === 'string' ? below(cut.folder, path) : null;
        if (rel !== null) files.push([rel.split(sep).join('/'), Number(size)]);
      }
      files.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const bytes = cut.recordingKey !== null && sizes.has(cut.recordingKey) ? Number(sizes.get(cut.recordingKey)) : null;
      return { schema: FROZEN_READ_SCHEMA, at: new Date(cut.at).toISOString(), adapter: cut.adapter ?? null,
        recording: cut.recording, bytes, files };
    },
  });
}

async function walk(folder, depth, sizes, paths) {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth > 0) await walk(path, depth - 1, sizes, paths);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) await add(path, sizes, paths);
  }
}
async function add(path, sizes, paths, size = null) {
  try {
    const stat = await lstat(path, { bigint: true });
    if (!stat.isFile()) return null;
    sizes.set(keyOf(stat), size ?? stat.size);
    paths.set(keyOf(stat), path);
    return keyOf(stat);
  } catch { return null; /* a file gone since the listing is not there at the start */ }
}
/** The folder a frozen load of `recording` reads: its project folder (Claude Code) or `<codexHome>/sessions` (Codex). */
async function folderOf(recording, adapter, codexHome) {
  if (adapter === 'claude') return dirname(await realpath(recording).catch(() => recording));
  if (adapter === 'codex' && typeof codexHome === 'string' && codexHome) return join(codexHome, 'sessions');
  return null;
}

/**
 * The sizes at the start of a review of `recording` (`adapter` claude or codex): the recording, and every `.jsonl` file
 * of the folder its load reads — its project folder (Claude Code) or `<codexHome>/sessions` (Codex) — at most
 * FROZEN_WALK_DEPTH folders below it. Symbolic links are not followed (a load never reads through one). D159: `now`
 * (milliseconds) is read once, just before the first size is taken: the instant the frozen set's record keeps.
 */
export async function freezeRecordings(recording, { adapter, codexHome = null, now = Date.now } = {}) {
  const sizes = new Map(), paths = new Map();
  const folder = await folderOf(recording, adapter, codexHome);
  const at = now();
  const recordingKey = await add(recording, sizes, paths);
  if (folder) await walk(folder, FROZEN_WALK_DEPTH, sizes, paths);
  return frozenOf(sizes, { at, adapter: adapter ?? null, recording: resolve(recording), folder, paths, recordingKey });
}

/**
 * D159: the frozen set a record names (`frozenReadValid`), for a replay of `recording` (the file the record froze, by
 * its name): each recorded file, found by its path below the folder the load reads now, is read through its last whole
 * line within its recorded size; a file the record does not name is not there. The same bytes as the review that
 * wrote the record read, while the files keep their relative paths and their bytes up to those sizes. Its own
 * `record()` names `recording` made absolute: the record again when replayed at the same absolute path, and the same
 * instant, files and sizes under the other path when replayed at another (a copy of the folder).
 */
export async function frozenFromRecord(record, { recording, codexHome = null } = {}) {
  if (!frozenReadValid(record)) throw new TypeError('A frozen read is replayed from a valid record');
  if (typeof recording !== 'string' || basename(recording) !== basename(record.recording))
    throw new TypeError('A frozen read is replayed on the recording it froze');
  const sizes = new Map(), paths = new Map();
  const folder = await folderOf(recording, record.adapter, codexHome);
  const recordingKey = record.bytes === null ? null : await add(recording, sizes, paths, BigInt(record.bytes));
  if (folder) for (const [rel, bytes] of record.files) await add(join(folder, ...rel.split('/')), sizes, paths, BigInt(bytes));
  return frozenOf(sizes, { at: Date.parse(record.at), adapter: record.adapter, recording: resolve(recording), folder, paths,
    recordingKey });
}
