// C-01 canonical serialization and identity. NORMATIVE.
//
// Every digest in every package resolves through this module, so its output is a frozen wire
// format, not an implementation detail. Zero runtime dependencies; Node stdlib only. No clock,
// no randomness, no I/O: same input, same bytes, forever.
//
// Canonical form (C-01):
//   - object keys sorted recursively with JavaScript string comparison (UTF-16 code unit order)
//   - array order preserved
//   - JSON string escaping, UTF-8, no BOM, no trailing newline
// Rejected: invalid UTF-8, unpaired surrogates, negative zero, non-finite/unsafe numbers,
// floats, duplicate keys, alternate encodings and non-JSON values.

import { createHash } from 'node:crypto';
import { ContractError, fail } from './errors.js';

export { ContractError };

// A structural bound so a hostile or damaged record cannot exhaust the stack before validation.
export const MAX_DEPTH = 64;

/** A digest's own spelling: `sha256:` and 64 lower-case hex digits (a formal grammar). The one copy every reader of a
 *  digest or a ledger row id uses (S6, S5 review L6). */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/** True for a `sha256:` + 64 lowercase hex digest. Rejects SHA3/short/legacy labels (CT-04). */
export function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

export function assertDigest(value) {
  if (!isDigest(value)) fail('malformed_digest');
  return value;
}

// A lone surrogate is unencodable as UTF-8. JSON.stringify would escape it into well-formed
// JSON (ES2019), which would silently let an invalid string through, so reject it here first.
function assertNoLoneSurrogate(str) {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail('lone_surrogate');
      i++; // consume the valid low surrogate
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      fail('lone_surrogate'); // a low surrogate with no preceding high surrogate
    }
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function writeValue(value, out, depth, seen) {
  if (depth > MAX_DEPTH) fail('depth_exceeded');

  if (value === null) { out.push('null'); return; }

  const type = typeof value;

  if (type === 'boolean') { out.push(value ? 'true' : 'false'); return; }

  if (type === 'number') {
    if (!Number.isFinite(value)) fail('non_finite_number');
    // C-01: "All numbers are finite safe integers; no floats." Number.isSafeInteger rejects
    // both 1.5 and 2**53, so one check covers the float ban and the safe-range bound.
    if (!Number.isSafeInteger(value)) fail('unsafe_number');
    if (Object.is(value, -0)) fail('negative_zero');
    out.push(String(value));
    return;
  }

  if (type === 'string') {
    assertNoLoneSurrogate(value);
    out.push(JSON.stringify(value)); // correct, minimal JSON escaping for a validated string
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) fail('cycle');
    seen.add(value);
    out.push('[');
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out.push(',');
      // A hole or an explicit undefined is not a JSON value; JSON.stringify would emit null.
      if (!(i in value) || value[i] === undefined) fail('not_json_value');
      writeValue(value[i], out, depth + 1, seen);
    }
    out.push(']');
    seen.delete(value);
    return;
  }

  if (isPlainObject(value)) {
    if (seen.has(value)) fail('cycle');
    seen.add(value);
    // C-01: recursively sorted keys, JavaScript string comparison. Default Array#sort on
    // strings compares UTF-16 code units, which is exactly that ordering.
    const keys = Object.keys(value).sort();
    out.push('{');
    let written = 0;
    for (const key of keys) {
      const child = value[key];
      // C-01: "optional fields are absent, never `undefined`". An undefined-valued key is a
      // caller bug, not an absent field: JSON.stringify would drop it and change the digest.
      if (child === undefined) fail('not_json_value');
      if (written > 0) out.push(',');
      assertNoLoneSurrogate(key);
      out.push(JSON.stringify(key), ':');
      writeValue(child, out, depth + 1, seen);
      written++;
    }
    out.push('}');
    seen.delete(value);
    return;
  }

  fail('not_json_value'); // undefined, function, symbol, bigint, Date, Map, class instance…
}

/** Canonical JSON text for a validated JSON value. Throws ContractError on any violation. */
export function canonicalJson(value) {
  const out = [];
  writeValue(value, out, 0, new Set());
  return out.join('');
}

/** Canonical UTF-8 bytes. No BOM, no trailing newline. */
export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8');
}

/**
 * C-01 digest. Hash input is UTF8(schema + "\0") || canonicalJson(record).
 * The "\0" is domain separation: it cannot occur in the schema name, so no two distinct
 * (schema, record) pairs can collide by concatenation.
 */
export function digestOf(record) {
  if (!isPlainObject(record)) fail('not_json_value');
  const schema = record.schema;
  if (typeof schema !== 'string' || schema.length === 0) fail('missing_schema');
  // C-01: "The record contains no own digest." A record that carries its own hash cannot be
  // verified, because recomputing it would require knowing the answer first.
  if ('digest' in record) fail('self_digest_present');
  assertNoLoneSurrogate(schema);
  const hash = createHash('sha256');
  hash.update(Buffer.from(schema + '\0', 'utf8'));
  hash.update(canonicalBytes(record));
  return 'sha256:' + hash.digest('hex');
}

/** C-07 encodeObject: canonical bytes plus their digest. */
export function encodeObject(validatedRecord) {
  return { bytes: canonicalBytes(validatedRecord), digest: digestOf(validatedRecord) };
}

/**
 * C-07 decodeObject. Rejects invalid UTF-8, non-canonical encodings, duplicate keys, unsafe
 * numbers, a wrong schema and a wrong digest.
 *
 * Duplicate keys and every alternate encoding are caught by one rule: re-serialize the parsed
 * value and require byte equality with the input. JSON.parse silently keeps the last duplicate,
 * so the re-serialization is shorter than the input and the comparison fails. The same check
 * subsumes unsorted keys, added whitespace, \u-escaped ASCII and "1.0" for 1.
 */
export function decodeObject(bytes, expectedDigest, expectedSchema) {
  // Only real byte containers. `Buffer.from(string)` would re-encode a JS string, silently
  // replacing lone surrogates with U+FFFD and ACCEPTING input that CT-03 requires us to reject.
  if (typeof bytes === 'string') fail('invalid_utf8');
  let buf;
  if (Buffer.isBuffer(bytes)) buf = bytes;
  else if (ArrayBuffer.isView(bytes)) buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  else if (bytes instanceof ArrayBuffer) buf = Buffer.from(bytes);
  else fail('not_json_value');

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(buf);
  } catch {
    fail('invalid_utf8');
  }
  // TextDecoder with ignoreBOM:false strips a leading BOM rather than failing; canonical form
  // forbids one, so a BOM must be rejected explicitly.
  if (text.charCodeAt(0) === 0xfeff) fail('noncanonical_bytes');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('noncanonical_bytes');
  }

  // Re-serializing validates every value constraint (numbers, surrogates, JSON-ness) and, by
  // byte comparison, every encoding constraint.
  const reserialized = canonicalBytes(parsed);
  if (!reserialized.equals(buf)) fail('noncanonical_bytes');

  if (expectedSchema !== undefined && expectedSchema !== null) {
    if (!isPlainObject(parsed) || typeof parsed.schema !== 'string') fail('missing_schema');
    if (parsed.schema !== expectedSchema) fail('schema_mismatch');
  }

  if (expectedDigest !== undefined && expectedDigest !== null) {
    assertDigest(expectedDigest);
    const actual = digestOf(parsed);
    // Length-equal constant-time-ish comparison is unnecessary here (digests are public), but
    // the mismatch must not report the computed value.
    if (actual !== expectedDigest) fail('digest_mismatch');
  }

  return parsed;
}

/**
 * C-06 row identity. Hashes a schema-tagged projection of exactly the identity fields.
 * `setFields` are deduplicated and sorted by their canonical JSON bytes, per C-06:
 * "Set-valued arrays below are deduplicated and sorted by their canonical JSON bytes".
 */
export function identityDigest(schemaTag, fields, setFields = []) {
  if (typeof schemaTag !== 'string' || schemaTag.length === 0) fail('missing_schema');
  if (!isPlainObject(fields)) fail('not_json_value');
  // A null prototype is required, not stylistic: on a normal object literal, assigning the key
  // "__proto__" invokes Object.prototype's inherited accessor instead of creating an own
  // property, so the field would vanish from Object.keys and two distinct field maps would
  // hash identically. C-01 requires every payload field to participate.
  const sets = new Set(setFields);
  const projection = Object.create(null);
  // Defensive: C-06's identity field lists never contain `schema`, and letting one through
  // would let a payload field silently replace the domain-separation tag.
  if (Object.hasOwn(fields, 'schema')) fail('schema_mismatch');
  projection.schema = schemaTag;
  for (const key of Object.keys(fields)) {
    const value = fields[key];
    if (value === undefined) fail('not_json_value');
    projection[key] = sets.has(key) && Array.isArray(value) ? canonicalSet(value) : value;
  }
  return digestOf(projection);
}

/**
 * Deduplicate and sort array members by their canonical JSON bytes (stable, order-free).
 *
 * C-06 says "sorted by their canonical JSON bytes", which is UTF-8 byte order. That is NOT the
 * same comparator as C-01's object-key rule ("JavaScript string comparison" = UTF-16 code-unit
 * order). The two disagree whenever one member holds an astral-plane character (UTF-8 lead
 * 0xF0-0xF4, UTF-16 lead 0xD800-0xDBFF) and another holds U+E000..U+FFFF (UTF-8 lead 0xEE-0xEF).
 * Sorting these as UTF-16 would fork content-addressed identity against any implementation that
 * reads the spec literally, so compare the encoded bytes.
 */
export function canonicalSet(values) {
  if (!Array.isArray(values)) fail('not_json_value');
  const byBytes = new Map();
  for (const value of values) {
    const key = canonicalJson(value);
    if (!byBytes.has(key)) byBytes.set(key, { value, bytes: Buffer.from(key, 'utf8') });
  }
  return [...byBytes.values()]
    .sort((a, b) => Buffer.compare(a.bytes, b.bytes))
    .map((entry) => entry.value);
}
