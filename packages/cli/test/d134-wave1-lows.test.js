// D134 (M2): two behaviours of D126 and D127 that no test held (surviving mutants (a) and (b) of a review). (a) The
// search for the recordings a session continues charges every byte it reads, read whole or refused part way, to one shared
// bound (continued-recordings.js `spent`, CONTINUED_READ_LIMITS.totalBytes), and a recording past what is left of it is
// not read. (b) The terminal says, after the recording's line, that Sonah could not read the part before the compaction
// (session-review-command.js CONTINUED_RECORDING_WORDS.unread). Every fixture is synthetic and written to a private
// temporary folder; no real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continuedLineage, CONTINUED_READ_LIMITS } from '../src/continued-recordings.js';
import { runSessionReviewCommand, CONTINUED_RECORDING_WORDS } from '../src/session-review-command.js';
import { codeSession, codeJudge, sha256 } from './code-pass-fixture.js';

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

/** The earlier recording (it holds the linked row `last0`, then the boundary `b1`) and the one that opens on `b1`. */
const earlier = [human('s0', 'ask0', null, 'ask number 0'), said('s0', 'last0', 'ask0', 'answer 0'),
  boundary('s0', 'b1', 'last0'), summary('s0', 'sum1', 'b1')];
const later = [boundary('s1', 'b1', 'last0'), summary('s1', 'sum1', 'b1'), said('s1', 'last0', 'sum1', 'answer 0'),
  human('s1', 'ask1', 'last0', 'ask number 1'), said('s1', 'last1', 'ask1', 'answer 1')];
/** A recording of the same folder that holds no link: read in full, and found not to be the earlier one. */
const other = (k) => [human(`o${k}`, `oa${k}`, null, `another session ${k} ${'x'.repeat(400)}`),
  said(`o${k}`, `ob${k}`, `oa${k}`, 'its answer')];

async function folder(named) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd134-')));
  for (const [name, content] of Object.entries(named)) await writeFile(join(dir, name), content);
  return dir;
}
const size = async (dir, name) => Number((await stat(join(dir, name))).size);

test('D134 (a): every byte read in the search counts against one shared bound; past it the earlier part is unread',
  async () => {
    // Name order: a.jsonl and b.jsonl (no link) are read before z.jsonl (the earlier recording); y.jsonl is the given one.
    const dir = await folder({ 'a.jsonl': lines(other(1)), 'b.jsonl': lines(other(2)), 'z.jsonl': lines(earlier),
      'y.jsonl': lines(later) });
    try {
      const fillers = await size(dir, 'a.jsonl') + await size(dir, 'b.jsonl');
      const z = await size(dir, 'z.jsonl');
      const given = join(dir, 'y.jsonl');
      const found = { files: [join(dir, 'z.jsonl'), given], through: ['last0', null], unread: null };
      const limits = (totalBytes) => ({ fileBytes: 1_000_000, lineBytes: 1_000_000, totalBytes });
      // Room for every recording: the earlier one is found.
      assert.deepEqual(await continuedLineage(given, { limits: limits(fillers + z) }), found);
      // Each recording alone fits its own bound, but after the two read first, one byte too few is left for it.
      assert.ok(z - 1 < 1_000_000 && fillers < fillers + z - 1);
      assert.deepEqual(await continuedLineage(given, { limits: limits(fillers + z - 1) }),
        { files: [given], through: [null], unread: 'earlier_recording_unread' });
      // Nothing is left after the first: the rest are never opened, and the part is unread, never missing.
      assert.equal((await continuedLineage(given, { limits: limits(await size(dir, 'a.jsonl')) })).unread,
        'earlier_recording_unread');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

test('D134 (a): a recording refused part way through is charged the bytes read before it was refused', async () => {
  // a.jsonl ends on a byte that is not UTF-8: it is read to its end, then refused (`unverified`), its bytes counted.
  const bad = Buffer.concat([Buffer.from(lines(other(1))), Buffer.from([0xff])]);
  const dir = await folder({ 'a.jsonl': bad, 'z.jsonl': lines(earlier), 'y.jsonl': lines(later) });
  try {
    const z = await size(dir, 'z.jsonl');
    const given = join(dir, 'y.jsonl');
    const limits = (totalBytes) => ({ fileBytes: 1_000_000, lineBytes: 1_000_000, totalBytes });
    // With the refused bytes charged, the earlier recording no longer fits: no readable one holds the part.
    assert.deepEqual(await continuedLineage(given, { limits: limits(bad.length + z - 1) }),
      { files: [given], through: [null], unread: 'earlier_recording_unread' });
    // With room for both, the earlier one is read; the refused one is counted and is not it.
    assert.deepEqual(await continuedLineage(given, { limits: limits(bad.length + z) }),
      { files: [join(dir, 'z.jsonl'), given], through: ['last0', null], unread: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('D134 (a): the bound is shared by every step of a chain, and its literals are frozen', async () => {
  assert.deepEqual(CONTINUED_READ_LIMITS, { fileBytes: 512_000_000, lineBytes: 128_000_000, totalBytes: 2_000_000_000 });
  assert.ok(Object.isFrozen(CONTINUED_READ_LIMITS));
  // Three recordings: a.jsonl opens on no compaction; b.jsonl continues it (b1 links last0) and is compacted again (b2);
  // c.jsonl continues b.jsonl (b2 links last1). From c: step 1 reads a and b (b is the earlier one); step 2 reads a and c.
  const r1 = [boundary('s1', 'b1', 'last0'), summary('s1', 'sum1', 'b1'), said('s1', 'last0', 'sum1', 'answer 0'),
    human('s1', 'ask1', 'last0', 'ask number 1'), said('s1', 'last1', 'ask1', 'answer 1'), boundary('s1', 'b2', 'last1'),
    summary('s1', 'sum2', 'b2')];
  const r2 = [boundary('s2', 'b2', 'last1'), summary('s2', 'sum2', 'b2'), said('s2', 'last1', 'sum2', 'answer 1'),
    human('s2', 'ask2', 'last1', 'ask number 2'), said('s2', 'last2', 'ask2', 'answer 2')];
  const dir = await folder({ 'a.jsonl': lines(earlier), 'b.jsonl': lines(r1), 'c.jsonl': lines(r2) });
  try {
    const [a, b, c] = await Promise.all(['a.jsonl', 'b.jsonl', 'c.jsonl'].map((name) => size(dir, name)));
    const given = join(dir, 'c.jsonl');
    const limits = (totalBytes) => ({ fileBytes: 1_000_000, lineBytes: 1_000_000, totalBytes });
    const whole = { files: [join(dir, 'a.jsonl'), join(dir, 'b.jsonl'), given], through: ['last0', 'last1', null],
      unread: null };
    // Each file here is read in one chunk, so each read is charged its size: step 1 a + b, step 2 a + c.
    assert.deepEqual(await continuedLineage(given, { limits: limits(a + b + a + c) }), whole);
    // One byte short for step 2's read of a.jsonl, counting what step 1 read: the oldest part is unread.
    assert.deepEqual(await continuedLineage(given, { limits: limits(a + b + a - 1) }),
      { files: [join(dir, 'b.jsonl'), given], through: ['last1', null], unread: 'earlier_recording_unread' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

/** Run the review command as far as its dry run on a session whose `continued` is given; the terminal's lines. */
async function terminalOf(continued) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd134-run-')));
  try {
    const recording = join(dir, 'last.jsonl');
    await writeFile(recording, `${JSON.stringify({ timestamp: '2030-01-01T12:00:00.000Z' })}\n`);
    const session = codeSession();
    if (continued) session.continued = continued;
    let out = '';
    const answer = codeJudge({ narrative: () => ({ decisions: [], pivots: [], claims: [], requirements: [] }),
      review: () => ({ findings: [], questions: [] }) });
    await runSessionReviewCommand([recording, '--dry-run', '--concurrency', '1', '--state-dir', join(dir, 'state')], {
      stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: dir,
      env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
        SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
      installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
      loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: dir, recordings: [recording] }),
      createJudge: () => async (request) => answer(request) });
    return out.split('\n');
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('D134 (b): the terminal says, after the recording\'s line, that Sonah could not read the part before it',
  async () => {
    for (const unread of ['earlier_recording_missing', 'earlier_recording_unread', 'earlier_recording_ambiguous',
      'earlier_recording_cycle']) {
      const out = await terminalOf({ earlier: 0, unread });
      const at = out.findIndex((line) => line.startsWith('Recording: '));
      assert.ok(at >= 0);
      assert.equal(out[at + 1], CONTINUED_RECORDING_WORDS.unread, unread);
      assert.equal(out.filter((line) => line === CONTINUED_RECORDING_WORDS.unread).length, 1);
    }
    // Read in part: the earlier recordings it read, then the line for the part before them.
    const part = await terminalOf({ earlier: 2, unread: 'earlier_recording_unread' });
    const at = part.findIndex((line) => line.startsWith('Recording: '));
    assert.deepEqual(part.slice(at + 1, at + 3), [CONTINUED_RECORDING_WORDS.read(2), CONTINUED_RECORDING_WORDS.unread]);
    // A session read whole, or one that does not continue another, has no such line.
    for (const continued of [{ earlier: 1, unread: null }, null]) {
      assert.equal((await terminalOf(continued)).includes(CONTINUED_RECORDING_WORDS.unread), false);
    }
    assert.equal(CONTINUED_RECORDING_WORDS.unread, 'The session opens on a compaction. Sonah could not read the part '
      + 'before it, and the report says why.');
  });
