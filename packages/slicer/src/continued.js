// D126 (N0; the owner, 2026-10-22: "go with your recommendations"). A Claude Code recording
// that opens on a compaction continues an earlier recording: when a session is resumed after a compaction, Claude Code
// writes a new recording that starts with a copy of the compaction's boundary row, its summary and the messages the
// compaction kept, and the person's messages from before the compaction stay in the earlier recording. The boundary row
// names the last row before the compaction (`logicalParentUuid`, the recorder's own link). Sonah reads the earlier
// recording through that row, then the later one, as one session in order.
//
// This module is the pure half: which compaction a recording opens on, and which recording of the folder is the earlier
// one, from facts the IO layer read (cli/src/continued-recordings.js). Structure only: row types, the `compact_boundary`
// subtype, `uuid` and `logicalParentUuid`, and the bytes of the rows through the linked one; never a word of a message.

/**
 * Why Sonah could not read the earlier part of a session that opens on a compaction: a closed vocabulary, declared once
 * (the evidence adapter re-declares it: that package never imports the slicer). A ledger names one of them in
 * `lineage.continued.unread`.
 *   missing    no recording in the folder holds the linked row before the compaction's boundary row
 *   ambiguous  more than one recording does, and their rows through the linked row differ
 *   unread     a recording of the folder could not be read within the bounds and none that was read holds it, or the
 *              session continues more earlier recordings than CONTINUED_LIMITS.recordings, or the linked row was gone
 *              when the slicer read the earlier recording
 *   cycle      every recording that holds it is already part of the session
 */
export const CONTINUED_REASONS = Object.freeze({
  missing: 'earlier_recording_missing',
  ambiguous: 'earlier_recording_ambiguous',
  unread: 'earlier_recording_unread',
  cycle: 'earlier_recording_cycle',
});

/** Frozen bounds. `recordings`: the most earlier recordings one session joins (well above the longest chain seen);
 *  `headRows`: the most rows read to find the compaction a recording opens on (well above the latest opening boundary
 *  row seen). */
export const CONTINUED_LIMITS = Object.freeze({ recordings: 16, headRows: 1000 });

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && value.length > 0;

/**
 * The compaction a Claude Code recording opens on, from its rows in recorded order (the caller passes the rows from the
 * first one; at most CONTINUED_LIMITS.headRows are read): the first row that is a `user` or `assistant` row, or a
 * `system` row of subtype `compact_boundary`. When it is such a boundary row of the main thread (`isSidechain` not true)
 * with a non-empty `uuid` and a non-empty `logicalParentUuid` that no row before it records as its `uuid`, returns
 * `{ boundary, linked }` (the two ids); else null. A recording whose first message comes before any compaction, a
 * helper's recording and a Codex rollout (no such rows) are null.
 */
export function openingCompaction(rows) {
  const held = new Set();
  let seen = 0;
  for (const row of rows) {
    if (++seen > CONTINUED_LIMITS.headRows) return null;
    if (!plain(row)) continue;
    if (row.type === 'user' || row.type === 'assistant') return null;
    if (row.type === 'system' && row.subtype === 'compact_boundary') {
      if (row.isSidechain === true || !id(row.uuid) || !id(row.logicalParentUuid) || held.has(row.logicalParentUuid))
        return null;
      return { boundary: row.uuid, linked: row.logicalParentUuid };
    }
    if (id(row.uuid)) held.add(row.uuid);
  }
  return null;
}

/**
 * Which recording of the folder the session continues, from what the IO layer read of each one:
 * `candidates` `[{ key, linkedLine, boundaryAfter, digest }]`, one per readable recording that holds the linked row
 * (`linkedLine`, its line, from 1), with whether a `compact_boundary` row with the boundary's `uuid` follows it there
 * (`boundaryAfter`) and a digest of its bytes through that line; `unreadable` how many recordings of the folder could
 * not be read; `visited` the keys already in the session. The earlier recording holds the linked row before the
 * compaction's own boundary row: there the compaction happened. A recording that holds it after (a copy of the kept
 * messages in another continuation) is not one. Several that hold the same bytes through the linked row are copies of one
 * history: the first by key (code-unit order) is read. Returns `{ key, linkedLine }`, or `{ reason }` of
 * CONTINUED_REASONS.
 */
export function earlierRecording({ candidates, unreadable = 0, visited = new Set() }) {
  const held = (Array.isArray(candidates) ? candidates : []).filter((c) => plain(c) && typeof c.key === 'string'
    && Number.isSafeInteger(c.linkedLine) && c.linkedLine >= 1 && c.boundaryAfter === true && typeof c.digest === 'string');
  if (!held.length) return { reason: unreadable > 0 ? CONTINUED_REASONS.unread : CONTINUED_REASONS.missing };
  const fresh = held.filter((c) => !visited.has(c.key));
  if (!fresh.length) return { reason: CONTINUED_REASONS.cycle };
  if (new Set(fresh.map((c) => c.digest)).size > 1) return { reason: CONTINUED_REASONS.ambiguous };
  const [first] = [...fresh].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { key: first.key, linkedLine: first.linkedLine };
}

/** Whether `value` is a `lineage.continued` the slicer writes: `{ earlier, unread? }`, `earlier` the earlier recordings
 *  read with the session (a safe integer >= 0), `unread` one of CONTINUED_REASONS when its earliest part was not read. */
export function continuedShape(value) {
  return plain(value) && Object.keys(value).every((key) => key === 'earlier' || key === 'unread')
    && Number.isSafeInteger(value.earlier) && value.earlier >= 0
    && (value.unread === undefined || Object.values(CONTINUED_REASONS).includes(value.unread));
}
