// D126 (N0; the owner, 2026-10-22: "go with your recommendations"), the IO half. A Claude Code
// recording that opens on a compaction continues an earlier recording of the same folder: Claude Code writes a resumed
// session into a new recording that starts with a copy of the compaction's boundary row, and the person's messages from
// before the compaction stay in the earlier one. This module finds the recordings a session continues, by the recorder's
// own link (the boundary row's `logicalParentUuid`), oldest first. The plan is the slicer's (slicer/src/continued.js);
// this module only reads: the first rows of a recording, and, of every other recording in its folder, whether it holds
// the linked row before the same boundary row (recording-read.js `readLinkedRow`, the verified read every recording
// gets). No model, no network, no clock; never a word of a message.
import { createReadStream } from 'node:fs';
import { readdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { strictJson } from '../../slicer/src/strict-json.js';
import { CONTINUED_LIMITS, CONTINUED_REASONS, earlierRecording, openingCompaction } from '../../slicer/src/continued.js';
import { readLinkedRow } from './recording-read.js';

/** Frozen bounds of one session's search, in bytes: each recording read (`fileBytes`, its lines `lineBytes`), and all
 *  of them together (`totalBytes`). They are the child recordings' bounds (session-evidence.js CHILD_RECORDING_LIMITS). */
export const CONTINUED_READ_LIMITS = Object.freeze({ fileBytes: 512_000_000, lineBytes: 128_000_000,
  totalBytes: 2_000_000_000 });

/** The first rows of a recording, parsed (a line that is not one strict JSON object reads as null), at most
 *  CONTINUED_LIMITS.headRows; reading stops at its first `user` or `assistant` row or compaction boundary row. */
async function headRows(file) {
  const rows = [];
  let input = null, lines = null;
  try {
    input = createReadStream(file, { encoding: 'utf8' });
    lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      if (rows.length >= CONTINUED_LIMITS.headRows) break;
      if (!line.trim()) continue;
      const parsed = strictJson(line);
      const row = parsed.strict && parsed.value !== null && typeof parsed.value === 'object'
        && !Array.isArray(parsed.value) ? parsed.value : null;
      rows.push(row);
      if (row && (row.type === 'user' || row.type === 'assistant' || row.subtype === 'compact_boundary')) break;
    }
  } catch { return []; }
  finally { lines?.close(); input?.destroy(); }
  return rows;
}

const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The recordings a session continues, by the recorder's link, or null when the recording does not open on a compaction
 * (slicer `openingCompaction`). `{ files, through, unread }`: `files` the recordings oldest first, the given one last
 * (each by its real path); `through` aligned with them, the `uuid` each earlier one is read through and null for the
 * last (slicer `sliceLineage`'s `through`); `unread` one of CONTINUED_REASONS when the earliest part was not found, or
 * null. Each step looks only in the given recording's own folder, at its top-level `.jsonl` entries that are regular
 * files, in name order; the earlier recording is the one that holds the linked row before the same boundary row (slicer
 * `earlierRecording`). A recording that could not be read within the bounds is counted; it makes a part that no
 * readable recording holds `earlier_recording_unread`, never `missing`.
 */
export async function continuedLineage(file, { limits = CONTINUED_READ_LIMITS } = {}) {
  let real;
  try { real = await realpath(file); } catch { return null; }
  const folder = dirname(real);
  const chain = [{ file: real, through: null }];
  const visited = new Set([real]);
  let current = real, unread = null, opened = false, spent = 0;
  for (;;) {
    const head = openingCompaction(await headRows(current));
    if (!head) break;
    opened = true;
    if (chain.length - 1 >= CONTINUED_LIMITS.recordings) { unread = CONTINUED_REASONS.unread; break; }
    let entries = [];
    try { entries = await readdir(folder, { withFileTypes: true }); } catch { unread = CONTINUED_REASONS.unread; break; }
    const names = entries.filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.jsonl')
      && join(folder, entry.name) !== current).map((entry) => entry.name).sort(byName);
    const candidates = [];
    let unreadable = 0;
    const facts = async (path, digest) => {
      const room = Math.min(limits.fileBytes, limits.totalBytes - spent);
      if (room <= 0) return null;
      try {
        const found = await readLinkedRow(path, { namespace: folder, linked: head.linked, boundary: head.boundary,
          maxBytes: room, maxLineBytes: Math.min(limits.lineBytes, room), digest });
        spent += found.bytesRead;
        return found;
      } catch (error) {
        if (Number.isSafeInteger(error?.bytesRead)) spent += error.bytesRead;
        return null;
      }
    };
    for (const name of names) {
      const path = join(folder, name);
      const found = await facts(path, false);
      if (found === null) { unreadable++; continue; }
      if (found.linkedLine !== null && found.boundaryAfter) candidates.push({ key: path, ...found });
    }
    // Several hold the linked row before the boundary row: they are compared by their bytes through it (read again).
    if (candidates.length > 1) {
      for (const candidate of candidates) {
        const again = await facts(candidate.key, true);
        if (again === null || again.linkedLine !== candidate.linkedLine || !again.boundaryAfter) candidate.digest = null;
        else candidate.digest = again.digest;
      }
      if (candidates.some((candidate) => candidate.digest === null)) { unread = CONTINUED_REASONS.unread; break; }
    } else for (const candidate of candidates) candidate.digest = 'one';
    const pick = earlierRecording({ candidates, unreadable, visited });
    if (pick.reason) { unread = pick.reason; break; }
    chain.unshift({ file: pick.key, through: head.linked });
    visited.add(pick.key);
    current = pick.key;
  }
  if (!opened) return null;
  return { files: chain.map((step) => step.file), through: chain.map((step) => step.through), unread };
}

