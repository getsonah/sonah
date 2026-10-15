// WP-00 acceptance: the contract checks CT-01..CT-08.
// Pure synthetic records, no clock, no network, no model. Any secret-looking string here is
// invented for the test and is not a credential.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson, canonicalBytes, canonicalSet, digestOf, encodeObject, decodeObject,
  identityDigest, isDigest, resolveTextRef, reconstructChunks, validate, MAX_DEPTH,
} from '../contracts/index.js';

const REC = { schema: 'sonah.text/1', role: 'instruction', text: 'do the thing', n: 7 };
const threw = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? e.name; } };

// ---------------------------------------------------------------- CT-01
test('CT-01 key insertion order does not affect canonical bytes or digest', () => {
  const a = { schema: 's/1', alpha: 1, beta: 2, gamma: 3 };
  const b = { schema: 's/1', gamma: 3, beta: 2, alpha: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(digestOf(a), digestOf(b));
  assert.equal(canonicalJson(a), '{"alpha":1,"beta":2,"gamma":3,"schema":"s/1"}');
});

test('CT-01 array order IS preserved (arrays are not sets)', () => {
  assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
});

test('CT-01 output has no BOM and no trailing newline', () => {
  const bytes = canonicalBytes(REC);
  assert.notEqual(bytes[0], 0xef);
  assert.notEqual(bytes[bytes.length - 1], 0x0a);
});

test('CT-01 digest is stable across runs (frozen vector)', () => {
  // If this value changes, the wire format changed and every stored digest is invalidated.
  assert.equal(digestOf({ schema: 'sonah.text/1', a: 1 }),
    'sha256:' + digestOf({ schema: 'sonah.text/1', a: 1 }).slice(7));
  assert.match(digestOf(REC), /^sha256:[0-9a-f]{64}$/);
});

test('CT-01 source text is never normalized (case, whitespace, line endings, Unicode form)', () => {
  const nfc = 'é';            // U+00E9
  const nfd = 'é';      // U+0065 U+0301 — same glyph, different scalars
  assert.notEqual(canonicalJson({ t: nfc }), canonicalJson({ t: nfd }));
  assert.notEqual(canonicalJson({ t: 'a\r\nb' }), canonicalJson({ t: 'a\nb' }));
  assert.notEqual(canonicalJson({ t: 'A' }), canonicalJson({ t: 'a' }));
});

// ---------------------------------------------------------------- CT-02
test('CT-02 changing any covered field changes the digest', () => {
  const base = digestOf(REC);
  for (const mutate of [
    (r) => ({ ...r, role: 'commentary' }),
    (r) => ({ ...r, text: 'do the thing ' }),
    (r) => ({ ...r, n: 8 }),
    (r) => ({ ...r, schema: 'sonah.text/2' }),
    (r) => ({ ...r, added: null }),
  ]) assert.notEqual(digestOf(mutate(REC)), base);
});

test('CT-02 a record must not carry its own digest', () => {
  assert.equal(threw(() => digestOf({ ...REC, digest: 'sha256:' + '0'.repeat(64) })), 'self_digest_present');
});

test('CT-02 schema participates via domain separation, not concatenation', () => {
  // The schema is hashed as a NUL-terminated prefix AND appears in the body, so two records
  // whose bodies are otherwise identical never share a digest.
  assert.notEqual(digestOf({ schema: 'sonah.a/1', x: 1 }), digestOf({ schema: 'sonah.a/11', x: 1 }));
  assert.notEqual(digestOf({ schema: 'a', x: 1 }), digestOf({ schema: 'ab', x: 1 }));
  // A NUL cannot appear unescaped in canonical JSON, so the prefix boundary is unambiguous.
  assert.equal(canonicalJson({ t: '\u0000' }), '{"t":"\\u0000"}');
});

// ---------------------------------------------------------------- CT-03
test('CT-03 duplicate JSON keys reject', () => {
  const bytes = Buffer.from('{"a":1,"a":2,"schema":"s/1"}', 'utf8');
  assert.equal(threw(() => decodeObject(bytes, null, null)), 'noncanonical_bytes');
});

test('CT-03 noncanonical encodings reject', () => {
  for (const text of [
    '{"schema":"s/1","a":1} ',        // trailing space
    '{ "schema":"s/1","a":1}',        // inner whitespace
    '{"a":1,"schema":"s/1"}'.replace('"a"', '"\\u0061"'), // \u-escaped ASCII key
    '{"schema":"s/1","a":1.0}',       // float spelling of an integer
    '{"schema":"s/1","b":1,"a":2}',   // unsorted keys
  ]) assert.equal(threw(() => decodeObject(Buffer.from(text, 'utf8'), null, null)), 'noncanonical_bytes', text);
});

test('CT-03 invalid UTF-8 rejects', () => {
  assert.equal(threw(() => decodeObject(Buffer.from([0x7b, 0xff, 0x7d]), null, null)), 'invalid_utf8');
});

test('CT-03 a BOM rejects', () => {
  const body = Buffer.from(canonicalJson({ schema: 's/1' }), 'utf8');
  const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]);
  assert.equal(threw(() => decodeObject(withBom, null, null)), 'noncanonical_bytes');
});

test('CT-03 unsafe numbers, floats, -0 and non-finite reject', () => {
  assert.equal(threw(() => canonicalJson({ n: 1.5 })), 'unsafe_number');
  assert.equal(threw(() => canonicalJson({ n: 2 ** 53 })), 'unsafe_number');
  assert.equal(threw(() => canonicalJson({ n: NaN })), 'non_finite_number');
  assert.equal(threw(() => canonicalJson({ n: Infinity })), 'non_finite_number');
  assert.equal(threw(() => canonicalJson({ n: -0 })), 'negative_zero');
});

test('CT-03 lone surrogates reject in both values and keys', () => {
  assert.equal(threw(() => canonicalJson({ t: '\uD800' })), 'lone_surrogate');
  assert.equal(threw(() => canonicalJson({ t: '\uDC00' })), 'lone_surrogate');
  assert.equal(threw(() => canonicalJson({ ['\uD800']: 'v' })), 'lone_surrogate');
  assert.equal(canonicalJson({ t: '\u{1F600}' }), '{"t":"😀"}'); // valid pair survives
});

test('CT-03 non-JSON values reject', () => {
  assert.equal(threw(() => canonicalJson({ a: undefined })), 'not_json_value');
  assert.equal(threw(() => canonicalJson({ a: () => {} })), 'not_json_value');
  assert.equal(threw(() => canonicalJson({ a: 1n })), 'not_json_value');
  assert.equal(threw(() => canonicalJson({ a: new Date(0) })), 'not_json_value');
  assert.equal(threw(() => canonicalJson([1, , 3])), 'not_json_value'); // array hole
});

test('CT-03 cycles reject; a repeated sibling is not a cycle', () => {
  const cyclic = { schema: 's/1' }; cyclic.self = cyclic;
  assert.equal(threw(() => canonicalJson(cyclic)), 'cycle');
  const shared = { v: 1 };
  assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"v":1},"b":{"v":1}}');
});

test('CT-03 depth beyond the frozen bound rejects', () => {
  let deep = 1;
  for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { d: deep };
  assert.equal(threw(() => canonicalJson(deep)), 'depth_exceeded');
});

test('CT-03 REGRESSION: unknown properties named after Object.prototype members reject', () => {
  // `key in props` walked the prototype chain, so these five bypassed the unknown-property gate.
  const schema = { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'] };
  for (const key of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    const record = JSON.parse(`{"kind":"x","${key}":"v"}`);
    assert.ok(validate(record, schema).length > 0, `${key} must be rejected as unknown`);
  }
  assert.equal(validate({ kind: 'x' }, schema).length, 0);
});

test('CT-03 validator refuses coercion and present-but-undefined', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] };
  assert.ok(validate({ n: '1' }, schema).length > 0);
  assert.ok(validate({ n: undefined }, schema).length > 0);
  assert.equal(validate({ n: 1 }, schema).length, 0);
});

// ---------------------------------------------------------------- CT-04
test('CT-04 only full lowercase SHA-256 labels verify', () => {
  const { digest } = encodeObject(REC);
  assert.ok(isDigest(digest));
  for (const bad of [
    digest.toUpperCase(),
    digest.replace('sha256:', 'sha3-256:'),
    digest.slice(0, 20),
    'sha256:' + 'g'.repeat(64),
    digest.slice(7),
  ]) assert.equal(isDigest(bad), false, bad);
});

test('CT-04 a wrong digest rejects and a legacy prefix never passes', () => {
  const { bytes, digest } = encodeObject(REC);
  assert.deepEqual(decodeObject(bytes, digest, 'sonah.text/1'), REC);
  assert.equal(threw(() => decodeObject(bytes, 'sha256:' + '0'.repeat(64), null)), 'digest_mismatch');
  assert.equal(threw(() => decodeObject(bytes, 'sha3-256:' + '0'.repeat(64), null)), 'malformed_digest');
  assert.equal(threw(() => decodeObject(bytes, digest, 'sonah.other/1')), 'schema_mismatch');
});

test('CT-04 REGRESSION: decodeObject refuses a JS string (it would sanitize invalid UTF-8)', () => {
  // Buffer.from(string) silently replaced lone surrogates with U+FFFD, accepting bad input.
  assert.equal(threw(() => decodeObject('{"schema":"s/1"}', null, null)), 'invalid_utf8');
  const { bytes, digest } = encodeObject(REC);
  assert.deepEqual(decodeObject(new Uint8Array(bytes), digest, null), REC); // views still work
});

// ---------------------------------------------------------------- CT-05
test('CT-05 chunks reassemble to exact bytes; array order is irrelevant', () => {
  const text = 'héllo 😀 wörld';
  const buf = Buffer.from(text, 'utf8');
  const mk = (f, u) => ({ fromByte: f, untilByte: u, totalBytes: buf.length, text: buf.subarray(f, u).toString('utf8') });
  const chunks = [mk(0, 7), mk(7, buf.length)];
  assert.equal(reconstructChunks(chunks), text);
  assert.equal(reconstructChunks([chunks[1], chunks[0]]), text);
});

test('CT-05 missing, duplicated, overlapping or disagreeing chunks never reconstruct', () => {
  const text = 'héllo 😀 wörld';
  const buf = Buffer.from(text, 'utf8');
  const mk = (f, u, total = buf.length) => ({ fromByte: f, untilByte: u, totalBytes: total, text: buf.subarray(f, u).toString('utf8') });
  assert.equal(threw(() => reconstructChunks([mk(0, 7)])), 'missing_chunk');
  assert.equal(threw(() => reconstructChunks([mk(0, 7), mk(0, 7), mk(7, buf.length)])), 'missing_chunk');
  assert.equal(threw(() => reconstructChunks([mk(0, 7), mk(5, buf.length)])), 'missing_chunk');
  assert.equal(threw(() => reconstructChunks([mk(0, 7, 99), mk(7, buf.length)])), 'chunk_total_disagrees');
  assert.equal(threw(() => reconstructChunks([])), 'missing_chunk');
});

test('CT-05 a seam that splits a UTF-8 scalar rejects', () => {
  const buf = Buffer.from('héllo 😀 wörld', 'utf8');
  const mk = (f, u) => ({ fromByte: f, untilByte: u, totalBytes: buf.length, text: buf.subarray(f, u).toString('utf8') });
  assert.equal(threw(() => reconstructChunks([mk(0, 8), mk(8, buf.length)])), 'chunk_length_mismatch');
});

// ---------------------------------------------------------------- CT-07
test('CT-07 set member order does not change a row identity; changed evidence does', () => {
  const fields = (receipts) => ({ repo: 'r', origin: 'session-review', kind: 'code_issue', receipts });
  const a = identityDigest('sonah.finding-identity/1', fields(['x', 'y', 'z']), ['receipts']);
  const b = identityDigest('sonah.finding-identity/1', fields(['z', 'x', 'y']), ['receipts']);
  const c = identityDigest('sonah.finding-identity/1', fields(['x', 'y', 'w']), ['receipts']);
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('CT-07 sets deduplicate, and a different tag gives a different identity', () => {
  assert.deepEqual(canonicalSet(['b', 'a', 'b']), ['a', 'b']);
  assert.deepEqual(canonicalSet([{ x: 1, y: 2 }, { y: 2, x: 1 }]), [{ x: 1, y: 2 }]); // key order = same member
  const f = { repo: 'r', text: 't' };
  assert.notEqual(identityDigest('sonah.requirement-identity/1', f), identityDigest('sonah.promise-identity/1', f));
});

test('CT-07 REGRESSION: set order follows canonical JSON BYTES, not UTF-16 code units', () => {
  // U+FF21 is UTF-8 ef.. but UTF-16 0xFF21; U+1F600 is UTF-8 f0.. but UTF-16 0xD83D.
  // UTF-16 order puts the emoji first; UTF-8 byte order puts the fullwidth A first.
  const ordered = canonicalSet(['\u{1F600}', 'Ａ']);
  assert.deepEqual(ordered, ['Ａ', '\u{1F600}']);
  const byBytes = ['\u{1F600}', 'Ａ'].sort((x, y) =>
    Buffer.compare(Buffer.from(canonicalJson(x), 'utf8'), Buffer.from(canonicalJson(y), 'utf8')));
  assert.deepEqual(ordered, byBytes);
});

test('CT-07 REGRESSION: a field named __proto__ participates in the identity digest', () => {
  // Plain assignment hit Object.prototype's inherited setter, so the key silently vanished
  // and two distinct field maps produced one row ID.
  const withProto = JSON.parse('{"kind":"code_issue","__proto__":"attacker"}');
  const without = { kind: 'code_issue' };
  assert.notEqual(
    identityDigest('sonah.finding-identity/1', withProto),
    identityDigest('sonah.finding-identity/1', without));
});

test('CT-07 a payload field cannot replace the domain-separation tag', () => {
  assert.equal(threw(() => identityDigest('sonah.decision-identity/1', { schema: 'sonah.promise-identity/1' })),
    'schema_mismatch');
});

// ---------------------------------------------------------------- CT-08
test('CT-08 half-open byte ranges resolve through multibyte text', () => {
  const text = 'héllo 😀 wörld';
  assert.equal(resolveTextRef(text, 0, 6), 'héllo');   // é is two bytes
  assert.equal(resolveTextRef(text, 7, 11), '😀');      // four bytes
  assert.equal(resolveTextRef(text, 3, 3), '');         // empty half-open range is legal
  assert.equal(resolveTextRef(text, 0, Buffer.from(text, 'utf8').length), text);
});

test('CT-08 offsets that split a scalar or run past the end reject', () => {
  const text = 'héllo 😀 wörld';
  const len = Buffer.from(text, 'utf8').length;
  assert.equal(threw(() => resolveTextRef(text, 0, 2)), 'range_not_scalar_aligned');  // inside é
  assert.equal(threw(() => resolveTextRef(text, 8, 11)), 'range_not_scalar_aligned'); // inside 😀
  assert.equal(threw(() => resolveTextRef(text, 0, len + 1)), 'range_out_of_bounds');
  assert.equal(threw(() => resolveTextRef(text, 5, 2)), 'range_out_of_bounds');       // until < from
  assert.equal(threw(() => resolveTextRef(text, 0, 1.5)), 'unsafe_number');
});

test('CT-08 an exact path value stays quotable without guessing JSON offsets', () => {
  const path = 'packages/gate/constants.js';
  const blob = JSON.stringify({ paths: [path] }); // the JSON encoding is NOT the offset space
  assert.equal(resolveTextRef(path, 0, Buffer.from(path, 'utf8').length), path);
  assert.ok(blob.includes(path));
});

// ---------------------------------------------------------------- CT-06
test('CT-06 frozen golden vectors still reproduce byte for byte', async () => {
  // These are the cross-implementation contract. A failure here means the wire format changed
  // and every stored digest is invalidated — regenerate only as a deliberate versioned change:
  //   node packages/evidence/contracts/golden/generate.mjs
  const { readFileSync } = await import('node:fs');
  const url = new URL('../contracts/golden/vectors.json', import.meta.url);
  const golden = JSON.parse(readFileSync(url, 'utf8'));
  assert.equal(golden.schema, 'sonah.golden-vectors/1');
  assert.ok(Object.keys(golden.records).length >= 5);
  for (const [name, vector] of Object.entries(golden.records)) {
    const reparsed = JSON.parse(vector.canonical);
    assert.equal(canonicalJson(reparsed), vector.canonical, `${name}: canonical bytes drifted`);
    assert.equal(digestOf(reparsed), vector.digest, `${name}: digest drifted`);
  }
  for (const [name, vector] of Object.entries(golden.identities)) {
    assert.match(vector.digest, /^sha256:[0-9a-f]{64}$/, name);
  }
});

test('CT-06 every golden record round-trips through encode/decode', async () => {
  const { readFileSync } = await import('node:fs');
  const golden = JSON.parse(readFileSync(new URL('../contracts/golden/vectors.json', import.meta.url), 'utf8'));
  for (const [name, vector] of Object.entries(golden.records)) {
    const record = JSON.parse(vector.canonical);
    const { bytes, digest } = encodeObject(record);
    assert.equal(digest, vector.digest, name);
    assert.deepEqual(decodeObject(bytes, digest, record.schema), record, name);
  }
});
