// C-02 chunk reconstruction and TextRef resolution. NORMATIVE.
//
// "TextRef offsets are half-open [fromByte, untilByte) ranges relative to the referenced blob's
// decoded `text` UTF-8 bytes, not its JSON encoding or the complete logical source. Chunk offsets
// map those bytes into the logical source."
//
// Two byte spaces exist and must never be confused:
//   - blob-local:  offsets into ONE blob's decoded text bytes  (what a TextRef uses)
//   - logical:     offsets into the complete source            (what chunk.fromByte declares)
// A quote that silently mixes them would cite text the source never contained.

import { ContractError, fail } from './errors.js';

export { ContractError };

/** True when byte `i` of `buf` starts a UTF-8 scalar (not a 10xxxxxx continuation byte). */
function isScalarBoundary(buf, i) {
  if (i === 0 || i === buf.length) return true;
  if (i < 0 || i > buf.length) return false;
  return (buf[i] & 0xc0) !== 0x80;
}

/**
 * Resolve a half-open [fromByte, untilByte) range against a blob's decoded text.
 *
 * Character-index and JSON-encoded offsets are rejected whenever they land off a UTF-8 scalar
 * boundary or past the end, which is the common case for multibyte text. It is NOT a total
 * defense: a character index can coincidentally equal a valid byte boundary. Callers therefore
 * still verify a quote by exact substring match (C-05), which is what actually grounds it.
 */
export function resolveTextRef(text, fromByte, untilByte) {
  if (typeof text !== 'string') fail('not_json_value');
  if (!Number.isSafeInteger(fromByte) || !Number.isSafeInteger(untilByte)) fail('unsafe_number');
  const buf = Buffer.from(text, 'utf8');
  // Half-open: from === until is a legal empty range; until < from never is.
  if (fromByte < 0 || untilByte < fromByte || untilByte > buf.length) fail('range_out_of_bounds');
  if (!isScalarBoundary(buf, fromByte) || !isScalarBoundary(buf, untilByte)) fail('range_not_scalar_aligned');
  return buf.subarray(fromByte, untilByte).toString('utf8');
}

/**
 * Reconstruct the complete logical source from its chunks.
 *
 * Requires: contiguity from byte 0, no overlap, no gap, a single agreed `totalBytes`, and a
 * scalar boundary at every seam. A missing, reordered, duplicated or overlapping chunk makes
 * the range unavailable — it never yields a "complete" string (CT-05).
 */
export function reconstructChunks(chunks) {
  if (!Array.isArray(chunks) || chunks.length === 0) fail('missing_chunk');

  const totals = new Set(chunks.map((c) => c.totalBytes));
  if (totals.size !== 1) fail('chunk_total_disagrees');
  const total = chunks[0].totalBytes;
  if (!Number.isSafeInteger(total) || total < 0) fail('unsafe_number');

  // Sort by declared start rather than trusting array order, then require exact tiling. This
  // accepts a reordered ARRAY but still rejects reordered CONTENT, because a swap leaves a gap.
  const ordered = [...chunks].sort((a, b) => a.fromByte - b.fromByte);

  const parts = [];
  let cursor = 0;
  for (const chunk of ordered) {
    const { fromByte, untilByte, text } = chunk;
    if (!Number.isSafeInteger(fromByte) || !Number.isSafeInteger(untilByte)) fail('unsafe_number');
    if (fromByte !== cursor) fail('missing_chunk');        // gap, overlap or duplicate
    if (untilByte < fromByte || untilByte > total) fail('missing_chunk');
    if (typeof text !== 'string') fail('not_json_value');
    const bytes = Buffer.from(text, 'utf8');
    // The declared range must match the bytes actually carried, or offsets downstream are lies.
    if (bytes.length !== untilByte - fromByte) fail('chunk_length_mismatch');
    if (!isScalarBoundary(bytes, 0) || !isScalarBoundary(bytes, bytes.length)) fail('range_not_scalar_aligned');
    parts.push(bytes);
    cursor = untilByte;
  }
  if (cursor !== total) fail('missing_chunk'); // short of the declared total

  const joined = Buffer.concat(parts);
  // A seam that split a multibyte scalar would decode to U+FFFD here; re-encoding catches it.
  const decoded = joined.toString('utf8');
  if (!Buffer.from(decoded, 'utf8').equals(joined)) fail('range_not_scalar_aligned');
  return decoded;
}
