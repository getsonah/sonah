// Closed error vocabulary for the contract layer (C-07: "Errors return closed codes and safe
// counters, never source-bearing exception text"). A ContractError never carries the offending
// value, a path, or a parser exception message — only a frozen code and safe counters.

export const CONTRACT_ERROR_CODES = Object.freeze([
  'not_json_value',        // undefined, function, symbol, bigint, or a non-plain object
  'non_finite_number',     // NaN or +/-Infinity
  'unsafe_number',         // outside Number.MAX_SAFE_INTEGER, or not an integer (no floats)
  'negative_zero',         // -0 is not distinguishable after round-trip
  'lone_surrogate',        // unpaired UTF-16 surrogate: not encodable as valid UTF-8
  'invalid_utf8',          // input bytes are not well-formed UTF-8
  'noncanonical_bytes',    // parses, but is not the canonical encoding of its own value
  'missing_schema',        // record has no schema string
  'schema_mismatch',       // record schema is not the expected one
  'digest_mismatch',       // recomputed digest does not equal the expected digest
  'malformed_digest',      // not sha256: followed by 64 lowercase hex characters
  'self_digest_present',   // record carries its own digest field; the record must not self-hash
  'depth_exceeded',        // nesting beyond the frozen structural bound
  'cycle',                 // object graph is not a tree
  'range_out_of_bounds',   // TextRef range outside the referenced blob's decoded bytes
  'range_not_scalar_aligned', // offset splits a UTF-8 scalar, or is a character index
  'missing_chunk',         // chunk set has a gap, overlap, duplicate or short total
  'chunk_total_disagrees', // chunks declare conflicting totalBytes
  'chunk_length_mismatch', // a chunk's carried bytes differ from its declared range
]);

const CODES = new Set(CONTRACT_ERROR_CODES);

export class ContractError extends Error {
  constructor(code, counters = {}) {
    if (!CODES.has(code)) throw new Error('unknown contract error code');
    // The message is the code itself. It is safe to log: it contains no source text.
    super(code);
    this.name = 'ContractError';
    this.code = code;
    this.counters = Object.freeze({ ...counters });
  }
}

export function fail(code, counters) {
  throw new ContractError(code, counters);
}
