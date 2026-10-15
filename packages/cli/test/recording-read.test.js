import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, link, mkdir, appendFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readRecording, readRecordingIdentity, snapshotRecording } from '../src/recording-read.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

const fixture = async () => {
  const dir = await scratchDir('sonah-recording-read-');
  const namespace = join(dir, 'store');
  await mkdir(namespace);
  return { dir, namespace };
};
const rejected = promise => assert.rejects(promise, error => {
  assert.equal(error.message, 'Recording input could not be verified');
  return true;
});

test('returns the exact validated UTF-8 bytes from a regular owned recording', async () => {
  const { namespace } = await fixture();
  const file = join(namespace, 'child.jsonl');
  const expected = Buffer.from('{"type":"session_meta"}\n🙂\n', 'utf8');
  await writeFile(file, expected);
  const actual = await readRecording(file, { namespace });
  assert.ok(Buffer.isBuffer(actual));
  assert.deepEqual(actual, expected);
});

test('rejects direct outside paths and file or directory symlinks without disclosing paths', async () => {
  const { dir, namespace } = await fixture();
  const outside = join(dir, 'outside.jsonl'); await writeFile(outside, '{}\n');
  await rejected(readRecording(outside, { namespace }));
  const alias = join(namespace, 'alias.jsonl'); await symlink(outside, alias);
  await rejected(readRecording(alias, { namespace }));
  const other = join(dir, 'other'); await mkdir(other);
  const nested = join(other, 'nested.jsonl'); await writeFile(nested, '{}\n');
  const dirAlias = join(namespace, 'linked-dir'); await symlink(other, dirAlias);
  await rejected(readRecording(join(dirAlias, 'nested.jsonl'), { namespace }));
});

test('rejects hard-linked inputs because a second path can mutate the opened inode', async () => {
  const { namespace } = await fixture();
  const file = join(namespace, 'child.jsonl'); const alias = join(namespace, 'alias.jsonl');
  await writeFile(file, '{}\n'); await link(file, alias);
  await rejected(readRecording(file, { namespace }));
});

test('enforces total and per-line byte limits before returning content', async () => {
  const { namespace } = await fixture();
  const file = join(namespace, 'child.jsonl');
  await writeFile(file, '12345\n67890\n');
  await rejected(readRecording(file, { namespace, maxBytes: 10, maxLineBytes: 5 }));
  await rejected(readRecording(file, { namespace, maxBytes: 20, maxLineBytes: 4 }));
  assert.equal((await readRecording(file, { namespace, maxBytes: 20, maxLineBytes: 5 })).toString(), '12345\n67890\n');
});

test('a child action snapshot admits a six-megabyte row inside the eight-megabyte file cap', async t => {
  const { dir, namespace } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(namespace, 'child.jsonl');
  const content = meta('child') + '\n' + JSON.stringify({ padding: 'x'.repeat(6_020_443) }) + '\n';
  await writeFile(file, content);
  const bytes = await readRecording(file, { namespace });
  assert.equal(bytes.length, Buffer.byteLength(content));
  await assert.rejects(readRecording(file, { namespace, maxLineBytes: 1_000_000 }), error => {
    assert.equal(error.reason, 'line_bytes');
    return true;
  });
});

test('a streamed action snapshot remains the exact verified bytes after its source grows', async t => {
  const { dir, namespace } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(namespace, 'child.jsonl');
  const initial = meta('child') + '\n' + '{}\n';
  await writeFile(file, initial);
  const copy = await snapshotRecording(file, { namespace, maxBytes: 1_000_000, maxLineBytes: 1_000_000 });
  t.after(() => rm(copy.directory, { recursive: true, force: true }));
  await appendFile(file, meta('later') + '\n');
  const { readFile } = await import('node:fs/promises');
  assert.equal(await readFile(copy.path, 'utf8'), initial);
  assert.equal(copy.bytesRead, Buffer.byteLength(initial));
  assert.equal((await readRecordingIdentity(copy.path, { namespace: copy.directory,
    adapter: 'codex', maxBytes: copy.bytesRead, maxLineBytes: copy.bytesRead })).sessionId, 'child');
});

test('a source changed while spooling cannot release a partial action snapshot', async t => {
  const { dir, namespace } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(namespace, 'child.jsonl');
  await writeFile(file, meta('child') + '\n' + '{}\n'.repeat(20_000));
  const handle = await open(file, 'r');
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  await handle.close();
  let changed = false;
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await read.apply(this, args);
    if (!changed) { changed = true; await appendFile(file, '{}\n'); }
    return result;
  });
  await assert.rejects(snapshotRecording(file, { namespace, maxBytes: 1_000_000,
    maxLineBytes: 1_000_000 }), error => {
    assert.equal(error.message, 'Recording input could not be verified');
    assert.equal(error.reason, 'unverified');
    return true;
  });
  assert.equal(changed, true);
});

test('measures line limits in bytes and rejects invalid UTF-8', async () => {
  const { namespace } = await fixture();
  const file = join(namespace, 'child.jsonl');
  await writeFile(file, '🙂\n');
  await rejected(readRecording(file, { namespace, maxBytes: 10, maxLineBytes: 3 }));
  assert.equal((await readRecording(file, { namespace, maxBytes: 10, maxLineBytes: 4 })).toString(), '🙂\n');
  await writeFile(file, Buffer.from([0xc3, 0x28, 0x0a]));
  await rejected(readRecording(file, { namespace, maxBytes: 10, maxLineBytes: 4 }));
});

test('rejects malformed limits and missing paths with the same closed error', async () => {
  const { namespace } = await fixture();
  for (const options of [{ namespace, maxBytes: 0 }, { namespace, maxBytes: 10, maxLineBytes: 11 },
    { namespace: '' }]) await rejected(readRecording(join(namespace, 'missing'), options));
});

const meta = id => JSON.stringify({ type: 'session_meta', payload: { id } });
async function metadataFixture(t, content) {
  const f = await fixture();
  t.after(() => rm(f.dir, { recursive: true, force: true }));
  f.file = join(f.namespace, 'child.jsonl');
  await writeFile(f.file, content);
  f.options = { namespace: f.namespace, adapter: 'codex' };
  return f;
}

test('metadata streams split UTF-8 and CRLF lines, including a final line without a newline', async t => {
  const prefix = '{"text":"';
  const content = prefix + ' '.repeat(65535 - prefix.length) + '🙂"}\r\n\n' + meta('child');
  const f = await metadataFixture(t, content);
  const result = await readRecordingIdentity(f.file, f.options);
  assert.equal(result.sessionId, 'child');
  assert.equal(result.bytesRead, Buffer.byteLength(content));
  assert.equal(result.records, 2);
  assert.equal(result.identityConflict, false);
  assert.equal(Object.hasOwn(result, 'text'), false);
});

test('C-02: a session_meta row that repeats an identity key is a conflict, never the last value', async t => {
  const clean = await metadataFixture(t, meta('child-A'));
  assert.equal((await readRecordingIdentity(clean.file, clean.options)).identityConflict, false, 'positive control');
  const repeated = await metadataFixture(t, meta('child-A').replace('"id":"child-A"', '"id":"child-Z","id":"child-A"'));
  const result = await readRecordingIdentity(repeated.file, repeated.options);
  assert.equal(result.identityConflict, true);
  assert.notEqual(result.sessionId, 'child-A', 'the inventory never adopts the last repeated id');
});

test('metadata scans a file larger than the action snapshot ceiling without exposing its payload', async t => {
  const content = meta('child') + '\n' + (JSON.stringify({ text: 'x'.repeat(100_000) }) + '\n').repeat(81);
  const f = await metadataFixture(t, content);
  await rejected(readRecording(f.file, { namespace: f.namespace }));
  const result = await readRecordingIdentity(f.file, f.options);
  assert.equal(result.sessionId, 'child');
  assert.equal(result.records, 82);
  assert.equal(result.bytesRead, Buffer.byteLength(content));
  assert.ok(JSON.stringify(result).length < 500);
});

test('metadata never stops at the first ID and preserves conflicts after many distinct values', async t => {
  const rows = Array.from({ length: 5000 }, (_, n) => meta('child-' + n));
  const f = await metadataFixture(t, rows.join('\n'));
  const result = await readRecordingIdentity(f.file, f.options);
  assert.equal(result.sessionId, null);
  assert.equal(result.identityConflict, true);
  assert.equal(result.records, 5000);
});

test('every metadata line must be valid JSON object and complete UTF-8, even after a valid identity', async t => {
  const f = await metadataFixture(t, '');
  for (const ending of ['{"private":"unfinished', 'null', '[]', '4', Buffer.from([0xc3, 0x28]), Buffer.from([0xf0, 0x9f])]) {
    await writeFile(f.file, Buffer.concat([Buffer.from(meta('child') + '\n'), Buffer.from(ending)]));
    await rejected(readRecordingIdentity(f.file, f.options));
  }
});

test('metadata enforces byte, line, record and time budgets with safe closed counters', async t => {
  const content = meta('child') + '\n' + '{}\n';
  const f = await metadataFixture(t, content);
  const cases = [
    [{ maxBytes: 5, maxLineBytes: 5 }, 'bytes'],
    [{ maxLineBytes: 5 }, 'line_bytes'],
    [{ maxRecords: 1 }, 'records'],
    [{ deadline: performance.now() - 1 }, 'deadline'],
  ];
  for (const [options, reason] of cases) {
    await assert.rejects(readRecordingIdentity(f.file, { ...f.options, ...options }), error => {
      assert.equal(error.message, 'Recording input could not be verified');
      assert.equal(error.reason, reason);
      assert.equal(Number.isSafeInteger(error.bytesRead), true);
      assert.equal(Number.isSafeInteger(error.records), true);
      assert.equal(Object.hasOwn(error, 'sessionId'), false);
      return true;
    });
  }
  assert.equal((await readRecordingIdentity(f.file, { ...f.options, maxRecords: 2 })).records, 2);
  await rejected(readRecordingIdentity(f.file, { ...f.options, adapter: 'unknown' }));
  await rejected(readRecordingIdentity(f.file, { ...f.options, maxRecords: 0 }));
});

test('metadata uses the same namespace, symlink and hardlink checks as action snapshots', async t => {
  const f = await metadataFixture(t, meta('child'));
  const outside = join(f.dir, 'outside.jsonl');
  await writeFile(outside, meta('child'));
  await rejected(readRecordingIdentity(outside, f.options));
  const alias = join(f.namespace, 'alias.jsonl');
  await symlink(f.file, alias);
  await rejected(readRecordingIdentity(alias, f.options));
  await rm(alias);
  await link(f.file, alias);
  await rejected(readRecordingIdentity(f.file, f.options));
});

test('metadata rejects a source changed during its read and discards provisional identities', async t => {
  const f = await metadataFixture(t, meta('child') + '\n' + '{}\n'.repeat(50_000));
  const handle = await open(f.file, 'r');
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  await handle.close();
  let changed = false;
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await read.apply(this, args);
    if (!changed) { changed = true; await appendFile(f.file, meta('different') + '\n'); }
    return result;
  });
  await rejected(readRecordingIdentity(f.file, f.options));
  assert.equal(changed, true);
});

// M33 conflicting sources (C-03): the conflict candidate side channel is opt-in only.
test('M33 A9 the default identity shape is unchanged; candidates are returned only on request', async t => {
  const { dir, namespace } = await fixture();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(namespace, 'rollout-2026-09-12T00-00-00-a.jsonl');
  await writeFile(file, [{ type: 'session_meta', payload: { id: 'fork-a' } },
    { type: 'session_meta', payload: { id: 'fork-b', agent_path: '/root/other' } }].map(JSON.stringify).join('\n') + '\n');
  const plain = await readRecordingIdentity(file, { adapter: 'codex', namespace });
  assert.equal(Object.hasOwn(plain, 'candidates'), false);
  assert.equal(plain.identityConflict, true);
  for (const flag of [false, 'true', 1, {}]) {
    const other = await readRecordingIdentity(file, { adapter: 'codex', namespace, candidates: flag });
    assert.equal(Object.hasOwn(other, 'candidates'), false, String(flag));
  }
  const { candidates, ...rest } = await readRecordingIdentity(file, { adapter: 'codex', namespace, candidates: true });
  assert.deepEqual(rest, plain, 'the opt-in adds one key and changes nothing else');
  assert.deepEqual(candidates, { malformed: false, values: { sessionId: ['fork-a', 'fork-b'], childId: [],
    parentThreadId: [], taskPath: ['/root/other'] }, overflow: [] });
});
