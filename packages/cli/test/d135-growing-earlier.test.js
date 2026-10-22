// D135 (M3): an earlier recording that is still being written is read through the row the compaction links to. The
// search for the recordings a session continues (continued-recordings.js) reads each candidate through the boundary
// row's line and needs only those bytes unchanged (recording-read.js `readLinkedRow`, `scanRecording`'s `prefix`); a
// change inside them still refuses the recording. Every fixture is synthetic and written to a private temporary
// folder; no real recording is read. The file changes between the read's first chunk and its final checks, as in
// recording-read.test.js (the FileHandle's `read`, wrapped once).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, open, appendFile, truncate, rename, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continuedLineage } from '../src/continued-recordings.js';
import { readLinkedRow, readRecordingIdentity } from '../src/recording-read.js';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';

const V = '2.1.284';
const row = (sessionId, extra) => ({ sessionId, cwd: '/repo', version: V, gitBranch: 'main', isSidechain: false,
  userType: 'external', timestamp: '2026-10-20T10:00:00.000Z', ...extra });
const human = (sid, uuid, parentUuid, text) => row(sid, { type: 'user', uuid, parentUuid, origin: { kind: 'human' },
  promptSource: 'typed', message: { role: 'user', content: text } });
const said = (sid, uuid, parentUuid, text) => row(sid, { type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });
const boundary = (sid, uuid, linked) => row(sid, { type: 'system', subtype: 'compact_boundary', uuid, parentUuid: null,
  logicalParentUuid: linked, content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 100 } });
const summary = (sid, uuid, parentUuid) => row(sid, { type: 'user', uuid, parentUuid, isCompactSummary: true,
  isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary.' } });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

// The earlier recording: the person's ask, the linked row `last0`, the compaction `b1`; then the session goes on in it
// (the original session, still running, after the later recording forked from it).
const prefixRows = [human('s0', 'ask0', null, 'ask number 0'), said('s0', 'last0', 'ask0', 'answer 0'),
  boundary('s0', 'b1', 'last0'), summary('s0', 'sum1', 'b1')];
const goesOn = [human('s0', 'ask9', 'sum1', 'a later ask in the original'), said('s0', 'last9', 'ask9', 'answer 9')];
const later = [boundary('s1', 'b1', 'last0'), summary('s1', 'sum1', 'b1'), said('s1', 'last0', 'sum1', 'answer 0'),
  human('s1', 'ask1', 'last0', 'ask number 1'), said('s1', 'last1', 'ask1', 'answer 1')];
const PREFIX = lines(prefixRows);

async function fixture(t, earlier = PREFIX + lines(goesOn)) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd135-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'a.jsonl'), earlier);
  await writeFile(join(dir, 'b.jsonl'), lines(later));
  return { dir, a: join(dir, 'a.jsonl'), b: join(dir, 'b.jsonl') };
}

/** After the next read of any file returns, `change` runs once (the recording is written to while Sonah reads it). */
async function onFirstRead(t, file, change) {
  const handle = await open(file, 'r');
  const prototype = Object.getPrototypeOf(handle);
  const read = prototype.read;
  await handle.close();
  const state = { changed: false };
  t.mock.method(prototype, 'read', async function (...args) {
    const result = await read.apply(this, args);
    if (!state.changed) { state.changed = true; await change(); }
    return result;
  });
  return state;
}

/** Overwrite bytes at `at` in place (the file's length is kept). */
async function overwrite(file, at, text) {
  const handle = await open(file, 'r+');
  try { await handle.write(Buffer.from(text), 0, Buffer.byteLength(text), at); } finally { await handle.close(); }
}

const whole = (f) => ({ files: [f.a, f.b], through: ['last0', null], unread: null });
const notRead = (f) => ({ files: [f.b], through: [null], unread: 'earlier_recording_unread' });

test('D135: an earlier recording that grows while it is read is read through the linked row', async (t) => {
  const f = await fixture(t);
  const state = await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more', 'last9', 'still going')])));
  assert.deepEqual(await continuedLineage(f.b), whole(f));
  assert.equal(state.changed, true);
  t.mock.restoreAll();
  // The session loads with the earlier ask, and nothing that the original recorded after the compaction.
  const empty = await realpath(await mkdtemp(join(tmpdir(), 'd135-home-')));
  t.after(() => rm(empty, { recursive: true, force: true }));
  await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more2', 'more', 'and more')])));
  const { ledger } = redact(await loadSessionEvidence([f.b], { recordingRoots: { codex: empty, claude: empty } }));
  assert.deepEqual(ledger.ask.map((a) => a.text), ['ask number 0', 'ask number 1']);
  assert.deepEqual(ledger.lineage.continued, { earlier: 1 });
});

test('D135: a change inside the bytes through the boundary row still refuses the recording', async (t) => {
  // An ask before the linked row rewritten (same length), with the file also growing: refused, the part unread.
  let f = await fixture(t);
  let state = await onFirstRead(t, f.a, async () => {
    await overwrite(f.a, PREFIX.indexOf('ask number 0'), 'ask number 7');
    await appendFile(f.a, lines([said('s0', 'more', 'last9', 'still going')]));
  });
  assert.deepEqual(await continuedLineage(f.b), notRead(f));
  assert.equal(state.changed, true);
  t.mock.restoreAll();
  // The boundary row's own line rewritten: refused.
  f = await fixture(t);
  state = await onFirstRead(t, f.a, () => overwrite(f.a, PREFIX.indexOf('"auto"'), '"xxxx"'));
  assert.deepEqual(await continuedLineage(f.b), notRead(f));
  t.mock.restoreAll();
  // Cut short inside the boundary row's line: refused.
  f = await fixture(t);
  state = await onFirstRead(t, f.a, () => truncate(f.a, PREFIX.indexOf('"auto"')));
  assert.deepEqual(await continuedLineage(f.b), notRead(f));
  t.mock.restoreAll();
  // Cut short after it (inside the summary row that follows): the bytes Sonah relies on are all there.
  f = await fixture(t);
  state = await onFirstRead(t, f.a, () => truncate(f.a, PREFIX.length - 10));
  assert.deepEqual(await continuedLineage(f.b), whole(f));
  t.mock.restoreAll();
  // Replaced by another file with the same bytes and more (a new inode at the path): another file, refused.
  f = await fixture(t);
  state = await onFirstRead(t, f.a, async () => {
    await writeFile(join(f.dir, 'a.tmp'), Buffer.concat([await readFile(f.a), Buffer.from(lines(goesOn))]));
    await rename(join(f.dir, 'a.tmp'), f.a);
  });
  assert.deepEqual(await continuedLineage(f.b), notRead(f));
  assert.equal(state.changed, true);
  t.mock.restoreAll();
  // A change after the boundary row's line (the original going on, rewritten in place) is not read, so it is no change.
  f = await fixture(t);
  state = await onFirstRead(t, f.a, () => overwrite(f.a, PREFIX.length + lines(goesOn).indexOf('answer 9'), 'ANSWER 9'));
  assert.deepEqual(await continuedLineage(f.b), whole(f));
});

test('D135: a recording that holds no linked pair is read whole, and its change while read still refuses it', async (t) => {
  // The folder's only other recording holds the linked row but no boundary after it: read to its end; growing, it is
  // counted unreadable, so the part is unread (as before), never missing.
  const f = await fixture(t, lines([human('s0', 'ask0', null, 'ask number 0'), said('s0', 'last0', 'ask0', 'answer 0')]));
  const unchanged = await continuedLineage(f.b);
  assert.equal(unchanged.unread, 'earlier_recording_missing');
  await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more', 'last0', 'still going')])));
  assert.equal((await continuedLineage(f.b)).unread, 'earlier_recording_unread');
});

test('D135: the facts and the digest are the same read through the boundary row as read whole', async (t) => {
  const f = await fixture(t);
  const options = { namespace: f.dir, linked: 'last0', boundary: 'b1', maxBytes: 1_000_000, digest: true };
  const found = await readLinkedRow(f.a, options);
  assert.equal(found.linkedLine, 2);
  assert.equal(found.boundaryAfter, true);
  assert.match(found.digest, /^[0-9a-f]{64}$/);
  // The read ends at the boundary row's line, so it is charged no more than the file holds.
  assert.ok(found.bytesRead > 0 && found.bytesRead <= Buffer.byteLength(PREFIX + lines(goesOn)));
  // The digest is of the lines through the linked row only: the same for a copy that goes on differently after it.
  const g = await fixture(t, PREFIX + lines([human('s0', 'other', 'sum1', 'something else')]));
  assert.equal((await readLinkedRow(g.a, { ...options, namespace: g.dir })).digest, found.digest);
  // Every other reader of a recording still needs the whole file unchanged.
  await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more', 'last9', 'still going')])));
  await assert.rejects(readRecordingIdentity(f.a, { adapter: 'claude', namespace: f.dir }),
    (error) => error.reason === 'unverified');
});

test('D135: the bytes read again to check the prefix are reported as read, so the shared bound charges them', async (t) => {
  const f = await fixture(t);
  const size = Buffer.byteLength(PREFIX + lines(goesOn));
  const through = Buffer.byteLength(lines(prefixRows.slice(0, 3)));   // through the boundary row's line
  const options = { namespace: f.dir, linked: 'last0', boundary: 'b1', maxBytes: 1_000_000 };
  // Unchanged: the one read (a single chunk here) and nothing more.
  assert.equal((await readLinkedRow(f.a, options)).bytesRead, size);
  // Changed while read: the chunk read, then the prefix read again.
  const state = await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more', 'last9', 'still going')])));
  assert.equal((await readLinkedRow(f.a, options)).bytesRead, size + through);
  assert.equal(state.changed, true);
  t.mock.restoreAll();
  // Refused after the second read (the prefix changed): the bytes of both reads are on the error.
  const g = await fixture(t);
  await onFirstRead(t, g.a, () => overwrite(g.a, PREFIX.indexOf('ask number 0'), 'ask number 7'));
  await assert.rejects(readLinkedRow(g.a, { ...options, namespace: g.dir }),
    (error) => error.reason === 'unverified' && error.bytesRead === size + through);
});

test('D135: a boundary row whose line ends exactly at the end of a read chunk ends the read there', async (t) => {
  // The ask is padded so that the bytes through the boundary row's line are exactly one 64 KB chunk.
  const through = (pad) => [human('s0', 'ask0', null, `ask number 0 ${'x'.repeat(pad)}`),
    said('s0', 'last0', 'ask0', 'answer 0'), boundary('s0', 'b1', 'last0')];
  const CHUNK = 64 * 1024;
  const pad = CHUNK - Buffer.byteLength(lines(through(0)));
  const head = lines(through(pad));
  assert.equal(Buffer.byteLength(head), CHUNK);
  const f = await fixture(t, head + lines([summary('s0', 'sum1', 'b1'), ...goesOn]));
  const options = { namespace: f.dir, linked: 'last0', boundary: 'b1', maxBytes: 1_000_000 };
  const found = await readLinkedRow(f.a, options);
  assert.deepEqual([found.linkedLine, found.boundaryAfter, found.bytesRead], [2, true, CHUNK]);
  // Growing, it is still read through that line, and only that chunk is read again.
  const state = await onFirstRead(t, f.a, () => appendFile(f.a, lines([said('s0', 'more', 'last9', 'still going')])));
  assert.equal((await readLinkedRow(f.a, options)).bytesRead, CHUNK + CHUNK);
  assert.equal(state.changed, true);
  t.mock.restoreAll();
  assert.deepEqual(await continuedLineage(f.b), whole(f));
});

test('D135: bytes after the boundary row\'s line are not read as text, so bytes that are not UTF-8 there refuse nothing',
  async (t) => {
    const head = lines(prefixRows.slice(0, 3));
    const f = await fixture(t, Buffer.concat([Buffer.from(head), Buffer.from([0xff, 0xfe, 0x0a]),
      Buffer.from(lines([summary('s0', 'sum1', 'b1'), ...goesOn]))]));
    const found = await readLinkedRow(f.a, { namespace: f.dir, linked: 'last0', boundary: 'b1', maxBytes: 1_000_000 });
    assert.deepEqual([found.linkedLine, found.boundaryAfter], [2, true]);
    assert.deepEqual(await continuedLineage(f.b), whole(f));
    // The same bytes before the boundary row's line refuse it.
    const g = await fixture(t, Buffer.concat([Buffer.from(lines(prefixRows.slice(0, 1))), Buffer.from([0xff, 0xfe, 0x0a]),
      Buffer.from(lines(prefixRows.slice(1))), Buffer.from(lines(goesOn))]));
    assert.deepEqual(await continuedLineage(g.b), notRead(g));
  });
