import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm, symlink, readdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexRecordings, recordingInventoryCurrent, RECORDING_INDEX_LIMITS } from '../src/recording-inventory.js';

const meta = id => JSON.stringify({ type: 'session_meta', payload: { id } }) + '\n';
async function fixture(t, contents = [meta('one'), meta('two'), meta('three')]) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-index-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const files = contents.map((_, n) => join(dir, `rollout-2026-09-12T00-00-0${n}.jsonl`));
  await Promise.all(files.map((file, n) => writeFile(file, contents[n])));
  return { dir, files };
}

test('an index retains redacted identity and aggregate accounting, without recording payloads', async t => {
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  const f = await fixture(t, [meta(secret) + '{"text":"private payload"}\n', meta('two')]);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, false);
  assert.equal(found.stats.candidateFiles, 2);
  assert.equal(found.stats.verifiedFiles, 2);
  assert.equal(found.stats.records, 3);
  assert.equal(found.sources[0].identityUnchecked, true);
  assert.equal(JSON.stringify(found).includes(secret), false);
  assert.equal(JSON.stringify(found).includes('private payload'), false);
  assert.deepEqual(found.stats.reasons, []);
});

test('Codex inventory verifies a six-megabyte JSONL row within the bounded line ceiling', async t => {
  const longRow = JSON.stringify({ padding: 'x'.repeat(6_020_443) }) + '\n';
  const contents = meta('large-child') + longRow;
  const f = await fixture(t, [contents, meta('another-child')]);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, false);
  assert.equal(found.stats.verifiedFiles, 2);
  assert.equal(found.stats.records, 3);
  assert.equal(found.stats.bytesRead, Buffer.byteLength(contents) + Buffer.byteLength(meta('another-child')));
  assert.equal(found.sources[0].sessionId, 'large-child');
  assert.equal(JSON.stringify(found).includes('x'.repeat(100)), false, 'payload bytes stay out of the index');

  const lowered = await indexRecordings(f.dir, 'codex', { limits: { lineBytes: 1_000_000 } });
  assert.equal(lowered.incomplete, true);
  assert.equal(lowered.stats.failedFiles, 1);
  assert.deepEqual(lowered.stats.reasons, ['line_bytes']);

  const overCeiling = meta('large-child')
    + JSON.stringify({ padding: 'x'.repeat(RECORDING_INDEX_LIMITS.lineBytes) }) + '\n';
  await writeFile(f.files[0], overCeiling);
  const refused = await indexRecordings(f.dir, 'codex');
  assert.equal(refused.incomplete, true);
  assert.equal(refused.stats.failedFiles, 1);
  assert.deepEqual(refused.stats.reasons, ['line_bytes']);
});

test('a native recording beyond the former file and line ceilings verifies to EOF', async t => {
  const longRow = JSON.stringify({ padding: 'x'.repeat(9_000_000) }) + '\n';
  const filler = JSON.stringify({ padding: 'y'.repeat(100_000) }) + '\n';
  const content = meta('large-child') + longRow + filler.repeat(551);
  assert.ok(Buffer.byteLength(content) > 64_000_000);
  const f = await fixture(t, [content]);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, false);
  assert.equal(found.stats.verifiedFiles, 1);
  assert.equal(found.stats.bytesRead, Buffer.byteLength(content));
  assert.equal(found.sources[0].sessionId, 'large-child');
});

test('one failed source does not hide later candidates or make the inventory complete', async t => {
  const f = await fixture(t, [meta('one'), '{"broken":\n', meta('three')]);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, true);
  assert.equal(found.stats.candidateFiles, 3);
  assert.equal(found.stats.verifiedFiles, 2);
  assert.equal(found.stats.failedFiles, 1);
  assert.equal(found.stats.unscannedFiles, 0);
  assert.deepEqual(found.stats.reasons, ['unverified']);
});

test('an empty or identity-free source remains an unknown candidate instead of proving uniqueness', async t => {
  const f = await fixture(t);
  for (const content of ['', '{}\n', '{"type":"session_meta","payload":{}}\n']) {
    await writeFile(f.files[1], content);
    const found = await indexRecordings(f.dir, 'codex');
    assert.equal(found.incomplete, true);
    assert.equal(found.stats.failedFiles, 1);
    assert.equal(found.stats.unscannedFiles, 0);
    assert.deepEqual(found.stats.reasons, ['identity_missing']);
  }
});

test('file, total-byte and total-record ceilings never exclude unknown candidates from accounting', async t => {
  const f = await fixture(t);
  for (const [limits, reason] of [
    [{ metadataBytes: 5 }, 'bytes'],
    [{ inventoryBytes: 5 }, 'inventory_bytes'],
    [{ inventoryBytes: Buffer.byteLength(meta('one')) }, 'inventory_bytes'],
    [{ inventoryRecords: 1 }, 'inventory_records'],
    [{ files: 1 }, 'files'],
  ]) {
    const found = await indexRecordings(f.dir, 'codex', { limits });
    assert.equal(found.incomplete, true);
    assert.equal(found.stats.candidateFiles, 3);
    assert.ok(found.stats.reasons.includes(reason));
    assert.equal(found.stats.verifiedFiles + found.stats.failedFiles + found.stats.unscannedFiles, 3);
  }
});

test('directory, depth and alias gaps declare enumeration incomplete', async t => {
  const f = await fixture(t);
  await mkdir(join(f.dir, 'nested', 'deeper'), { recursive: true });
  for (const [limits, reason] of [[{ directories: 1 }, 'directories'], [{ depth: 1 }, 'depth']]) {
    const found = await indexRecordings(f.dir, 'codex', { limits });
    assert.equal(found.incomplete, true);
    assert.equal(found.stats.enumerationIncomplete, true);
    assert.ok(found.stats.reasons.includes(reason));
  }
  await symlink(f.files[0], join(f.dir, 'alias.jsonl'));
  const aliased = await indexRecordings(f.dir, 'codex');
  assert.equal(aliased.incomplete, true);
  assert.ok(aliased.stats.reasons.includes('source_alias'));
});

test('deadline includes directory discovery and cannot make a partially scanned store complete', async t => {
  const f = await fixture(t);
  // Delay only the invented store's directory read; no real source or timing race is needed.
  const { default: fs } = await import('node:fs/promises');
  const { syncBuiltinESMExports } = await import('node:module');
  const read = readdir;
  t.mock.method(fs, 'readdir', async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    return read(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const found = await indexRecordings(f.dir, 'codex', { limits: { milliseconds: 10 } });
  assert.equal(found.incomplete, true);
  assert.equal(found.stats.enumerationIncomplete, true);
  assert.ok(found.stats.reasons.includes('deadline'));
});

test('a candidate added during inventory prevents a false unique closure', async t => {
  const f = await fixture(t, [meta('one'), meta('two')]);
  const { default: fs } = await import('node:fs/promises');
  const { syncBuiltinESMExports } = await import('node:module');
  const read = readdir;
  let calls = 0;
  t.mock.method(fs, 'readdir', async (...args) => {
    if (++calls === 2) await writeFile(join(f.dir, 'rollout-2026-09-12T00-00-03.jsonl'), meta('late'));
    return read(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, true);
  assert.equal(found.stats.enumerationIncomplete, true);
  assert.ok(found.stats.reasons.includes('enumeration_changed'));
});

test('a cached complete inventory expires when a candidate grows', async t => {
  const f = await fixture(t);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(await recordingInventoryCurrent(found), true);
  await appendFile(f.files[0], '{}\n');
  assert.equal(await recordingInventoryCurrent(found), false);
});

test('inventory ceilings are frozen; callers can lower but cannot loosen them', async t => {
  const f = await fixture(t);
  assert.equal(Object.isFrozen(RECORDING_INDEX_LIMITS), true);
  for (const limits of [{ inventoryBytes: RECORDING_INDEX_LIMITS.inventoryBytes + 1 },
    { lineBytes: RECORDING_INDEX_LIMITS.lineBytes + 1 }, { files: 0 }, { extra: 1 }]) {
    await assert.rejects(indexRecordings(f.dir, 'codex', { limits }), /limits could not be verified/);
  }
});

// M33 conflicting sources (C-03): conflicting sources keep a private, redacted candidate record
// beside the inventory. It never enters sources, and nothing else gains a record.
test('M33 A9 conflict candidates are redacted before storage, frozen and kept outside sources', async t => {
  const secret = 'sk-ant-api03-' + 'B'.repeat(80);
  const f = await fixture(t, [meta('clean'), meta('fork-a') + meta(secret),
    meta('three-a') + meta('three-b') + meta('three-c'),
    JSON.stringify({ type: 'session_meta', payload: { id: 'bad', agent_path: 'x'.repeat(201) } }) + '\n']);
  const found = await indexRecordings(f.dir, 'codex');
  assert.equal(found.incomplete, false);
  assert.deepEqual(found.sources.map(s => s.identityConflict), [false, true, true, true]);
  assert.ok(found.conflictCandidates instanceof Map);
  assert.deepEqual([...found.conflictCandidates.keys()], [1, 2, 3], 'conflicting sources only, by source key');
  assert.deepEqual(found.conflictCandidates.get(1), { malformed: false, hidden: ['sessionId'], overflow: [],
    values: { sessionId: ['fork-a'], childId: [], parentThreadId: [], taskPath: [] } });
  assert.deepEqual(found.conflictCandidates.get(2), { malformed: false, hidden: [], overflow: ['sessionId'],
    values: { sessionId: ['three-a', 'three-b'], childId: [], parentThreadId: [], taskPath: [] } });
  assert.equal(found.conflictCandidates.get(3).malformed, true);
  assert.equal(JSON.stringify([...found.conflictCandidates]).includes(secret), false);
  for (const source of found.sources) {
    assert.equal(Object.hasOwn(source, 'candidates'), false);
    assert.equal(Object.hasOwn(source, 'conflictCandidates'), false);
  }
  for (const value of ['fork-a', 'three-a', secret]) assert.equal(JSON.stringify(found).includes(value), false, value);
  assert.throws(() => found.conflictCandidates.set(0, {}));
  assert.throws(() => found.conflictCandidates.delete(1));
  assert.throws(() => found.conflictCandidates.clear());
  assert.equal(found.conflictCandidates.size, 3);
  const record = found.conflictCandidates.get(2);
  for (const part of [found.conflictCandidates, record, record.values, record.values.sessionId, record.hidden,
    record.overflow]) assert.equal(Object.isFrozen(part), true);
  const clean = await fixture(t, [meta('one'), meta('two')]);
  const none = await indexRecordings(clean.dir, 'codex');
  assert.ok(none.conflictCandidates instanceof Map);
  assert.equal(none.conflictCandidates.size, 0);
});
