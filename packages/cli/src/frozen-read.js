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
// Structure only: sizes and newline bytes, never a word of a row. No clock, no network.
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** How deep the folder walk goes below the folder it starts in: Claude Code writes a Workflow's agents at
 *  `<session>/subagents/workflows/<run>/agent-*.jsonl`, Codex its rollouts at `YYYY/MM/DD/`. */
export const FROZEN_WALK_DEPTH = 4;
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

/**
 * A frozen set from sizes already taken (`Map` of `dev:ino` to a BigInt size). `sizeOf(stat)` the size of the file a
 * `{ bigint: true }` stat names when the review started, or null when it was not there; `endOf(path)` the offset just
 * after its last whole line within that size (computed once, from the file's own bytes), or null when the file was not
 * there at the start or is now shorter than it was.
 */
export function frozenOf(sizes) {
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
  });
}

async function walk(folder, depth, sizes) {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth > 0) await walk(path, depth - 1, sizes);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) await add(path, sizes);
  }
}
async function add(path, sizes) {
  try {
    const stat = await lstat(path, { bigint: true });
    if (stat.isFile()) sizes.set(keyOf(stat), stat.size);
  } catch { /* a file gone since the listing is not there at the start */ }
}

/**
 * The sizes at the start of a review of `recording` (`adapter` claude or codex): the recording, and every `.jsonl` file
 * of the folder its load reads — its project folder (Claude Code) or `<codexHome>/sessions` (Codex) — at most
 * FROZEN_WALK_DEPTH folders below it. Symbolic links are not followed (a load never reads through one).
 */
export async function freezeRecordings(recording, { adapter, codexHome = null } = {}) {
  const sizes = new Map();
  await add(recording, sizes);
  let folder = null;
  if (adapter === 'claude') folder = dirname(await realpath(recording).catch(() => recording));
  else if (adapter === 'codex' && typeof codexHome === 'string' && codexHome) folder = join(codexHome, 'sessions');
  if (folder) await walk(folder, FROZEN_WALK_DEPTH, sizes);
  return frozenOf(sizes);
}
