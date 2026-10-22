// D126 (N0): a recording that opens on a compaction is read with the recordings it continues (cli
// continued-recordings.js, session-evidence.js), as one session in order; a part Sonah could not read is a counted,
// disclosed gap. Every fixture is synthetic and written to a private temporary folder; no real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { continuedLineage } from '../src/continued-recordings.js';
import { loadSessionEvidence, continuedRecordingsOf } from '../src/session-evidence.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { runSessionReviewCommand, CONTINUED_RECORDING_WORDS } from '../src/session-review-command.js';
import { codeSession, codeJudge, sha256 } from './code-pass-fixture.js';
import { execFileSync } from 'node:child_process';
import { redact, sliceHash } from '../../redact/index.js';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES, CONTINUED_UNREAD_REASONS }
  from '../../evidence/adapters/sonah-ledger.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../../evidence/src/review.js';
import { CONTINUED_LIMITS, CONTINUED_REASONS } from '../../slicer/src/continued.js';

const V = '2.1.284';
const row = (sessionId, extra, at = '2026-10-20T10:00:00.000Z') => ({ sessionId, cwd: '/repo', version: V,
  gitBranch: 'main', isSidechain: false, userType: 'external', timestamp: at, ...extra });
const human = (sid, uuid, parentUuid, text, at) => row(sid, { type: 'user', uuid, parentUuid,
  origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: text } }, at);
const said = (sid, uuid, parentUuid, text, at) => row(sid, { type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } }, at);
const boundary = (sid, uuid, linked, at) => row(sid, { type: 'system', subtype: 'compact_boundary', uuid,
  parentUuid: null, logicalParentUuid: linked, content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 100 } }, at);
const summary = (sid, uuid, parentUuid, at) => row(sid, { type: 'user', uuid, parentUuid, isCompactSummary: true,
  isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary.' } }, at);
const meta = (sid) => ({ type: 'custom-title', customTitle: 'x', sessionId: sid });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/**
 * A chain of `n` recordings, oldest first: recording k holds its own ask and the agent's answer, then a compaction
 * whose boundary row (uuid `b<k+1>`) links its last row; recording k+1 opens on a copy of that boundary row, its
 * summary and the kept answer, then its own ask. Recording 0 opens on no compaction.
 */
function chain(n) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const sid = `s${k}`;
    const at = `2026-10-${String(10 + k).padStart(2, '0')}T10:00:00.000Z`;
    const rows = [meta(sid)];
    if (k > 0) rows.push(boundary(sid, `b${k}`, `last${k - 1}`, at), summary(sid, `sum${k}`, `b${k}`, at),
      said(sid, `last${k - 1}`, `sum${k}`, `answer ${k - 1}`, at));
    rows.push(human(sid, `ask${k}`, k > 0 ? `last${k - 1}` : null, `ask number ${k}`, at),
      said(sid, `last${k}`, `ask${k}`, `answer ${k}`, at));
    if (k < n - 1) rows.push(boundary(sid, `b${k + 1}`, `last${k}`, at), summary(sid, `sum${k + 1}`, `b${k + 1}`, at));
    out.push(rows);
  }
  return out;
}

async function folder(named) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd126-cli-')));
  for (const [name, rows] of Object.entries(named)) await writeFile(join(dir, name), typeof rows === 'string' ? rows
    : lines(rows));
  return dir;
}

test('continuedLineage: a chain is read back to the recording that opens on no compaction, oldest first', async () => {
  const [r0, r1, r2] = chain(3);
  const dir = await folder({ 'c.jsonl': r0, 'a.jsonl': r1, 'b.jsonl': r2, 'other.jsonl': chain(1)[0] });
  try {
    assert.deepEqual(await continuedLineage(join(dir, 'b.jsonl')), { files: [join(dir, 'c.jsonl'),
      join(dir, 'a.jsonl'), join(dir, 'b.jsonl')], through: ['last0', 'last1', null], unread: null });
    // A recording that opens on no compaction is no continued session.
    assert.equal(await continuedLineage(join(dir, 'c.jsonl')), null);
    assert.equal(await continuedLineage(join(dir, 'other.jsonl')), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('continuedLineage: missing, copies by bytes, ambiguous, unreadable and cycle', async () => {
  const [r0, r1] = chain(2);
  // Missing: the folder holds no earlier recording.
  let dir = await folder({ 'b.jsonl': r1 });
  try {
    assert.deepEqual(await continuedLineage(join(dir, 'b.jsonl')), { files: [join(dir, 'b.jsonl')], through: [null],
      unread: 'earlier_recording_missing' });
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A recording that holds the linked row only after the boundary (another continuation's copy) is not the earlier one.
  dir = await folder({ 'b.jsonl': r1, 'copy.jsonl': r1 });
  try {
    assert.equal((await continuedLineage(join(dir, 'b.jsonl'))).unread, 'earlier_recording_missing');
  } finally { await rm(dir, { recursive: true, force: true }); }
  // Two copies of the same history through the linked row: the first by name is read.
  dir = await folder({ 'z.jsonl': r0, 'm.jsonl': [...r0, said('s0', 'more', 'sum1', 'later')], 'b.jsonl': r1 });
  try {
    assert.deepEqual(await continuedLineage(join(dir, 'b.jsonl')), { files: [join(dir, 'm.jsonl'), join(dir, 'b.jsonl')],
      through: ['last0', null], unread: null });
  } finally { await rm(dir, { recursive: true, force: true }); }
  // Two that differ before the linked row: ambiguous, nothing earlier is read.
  dir = await folder({ 'z.jsonl': r0, 'm.jsonl': [meta('s9'), ...r0], 'b.jsonl': r1 });
  try {
    assert.deepEqual(await continuedLineage(join(dir, 'b.jsonl')), { files: [join(dir, 'b.jsonl')], through: [null],
      unread: 'earlier_recording_ambiguous' });
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A recording past the bounds is counted: no readable one holds the part, so it is unread, never missing.
  dir = await folder({ 'a.jsonl': r0, 'b.jsonl': r1 });
  try {
    assert.equal((await continuedLineage(join(dir, 'b.jsonl'), { limits: { fileBytes: 64, lineBytes: 64,
      totalBytes: 1_000 } })).unread, 'earlier_recording_unread');
    // A symlink in the folder is never read.
    await symlink(join(dir, 'a.jsonl'), join(dir, 'link.jsonl'));
    assert.deepEqual((await continuedLineage(join(dir, 'b.jsonl'))).files, [join(dir, 'a.jsonl'), join(dir, 'b.jsonl')]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  // A cycle: the earlier recording's own opening links back to the later one.
  const loopA = [meta('sa'), boundary('sa', 'bx', 'lastB'), summary('sa', 'sx', 'bx'), human('sa', 'qa', 'sx', 'ask a'),
    said('sa', 'lastA', 'qa', 'answer a'), boundary('sa', 'by', 'lastA'), summary('sa', 'sy', 'by')];
  const loopB = [meta('sb'), boundary('sb', 'by', 'lastA'), summary('sb', 'sy', 'by'), human('sb', 'qb', 'sy', 'ask b'),
    said('sb', 'lastB', 'qb', 'answer b'), boundary('sb', 'bx', 'lastB'), summary('sb', 'sx', 'bx')];
  dir = await folder({ 'a.jsonl': loopA, 'b.jsonl': loopB });
  try {
    assert.deepEqual(await continuedLineage(join(dir, 'b.jsonl')), { files: [join(dir, 'a.jsonl'), join(dir, 'b.jsonl')],
      through: ['lastA', null], unread: 'earlier_recording_cycle' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('continuedLineage: past CONTINUED_LIMITS.recordings, the rest is unread', async () => {
  const n = CONTINUED_LIMITS.recordings + 2;
  const named = Object.fromEntries(chain(n).map((rows, k) => [`r${String(k).padStart(2, '0')}.jsonl`, rows]));
  const dir = await folder(named);
  try {
    const found = await continuedLineage(join(dir, `r${String(n - 1).padStart(2, '0')}.jsonl`));
    assert.equal(found.files.length, CONTINUED_LIMITS.recordings + 1);
    assert.equal(found.unread, 'earlier_recording_unread');
    assert.equal(found.through.at(-1), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the session loader reads a continued session as one: earlier asks, recorded ids, the gap, the code-step start',
  async () => {
    const [r0, r1, r2] = chain(3);
    const dir = await folder({ 'a.jsonl': r0, 'b.jsonl': r1, 'c.jsonl': r2 });
    const empty = await mkdtemp(join(tmpdir(), 'd126-home-'));
    try {
      const file = join(dir, 'c.jsonl');
      const raw = await loadSessionEvidence([file], { recordingRoots: { codex: empty, claude: empty } });
      const { ledger } = redact(raw);
      assert.deepEqual(ledger.ask.map((a) => a.text), ['ask number 0', 'ask number 1', 'ask number 2']);
      assert.deepEqual(continuedRecordingsOf(raw), [join(dir, 'a.jsonl'), join(dir, 'b.jsonl'), file]);
      assert.deepEqual(ledger.lineage.continued, { earlier: 2 });
      // Read alone, the same recording holds only its own ask and the kept answer.
      const alone = redact(await loadSessionEvidence([file], { continued: false,
        recordingRoots: { codex: empty, claude: empty } })).ledger;
      assert.deepEqual(alone.ask.map((a) => a.text), ['ask number 2']);
      assert.equal(alone.lineage.continued, undefined);
      // The events the recording holds keep their ids: the recorder's own uuid, whichever stream they are read in.
      const ids = (session) => session.events.filter((e) => e.kind === 'instruction').map((e) => e.id);
      const joinedSession = sessionFromLedger(ledger);
      const aloneSession = sessionFromLedger(alone);
      assert.ok(ids(aloneSession).every((id) => ids(joinedSession).includes(id)));
      assert.deepEqual(joinedSession.continued, { earlier: 2, unread: null });
      assert.equal(aloneSession.continued, undefined);
      // The review's load: the recordings, oldest first, and the code step starts where the first of them starts.
      const loaded = await loadRecordedSessionWithHash({ parent: file, codexHome: empty, claudeProjects: empty });
      assert.deepEqual(loaded.recordings, [join(dir, 'a.jsonl'), join(dir, 'b.jsonl'), file]);
      assert.equal(loaded.hash, sliceHash(ledger));
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(empty, { recursive: true, force: true });
    }
  });

test('a recording that opens on no compaction loads exactly as before: same ledger, same hash', async () => {
  const [r0] = chain(1);
  const dir = await folder({ 'a.jsonl': r0, 'b.jsonl': chain(2)[1] });
  const empty = await mkdtemp(join(tmpdir(), 'd126-home-'));
  try {
    const file = join(dir, 'a.jsonl');
    const roots = { recordingRoots: { codex: empty, claude: empty } };
    const on = redact(await loadSessionEvidence([file], roots)).ledger;
    const off = redact(await loadSessionEvidence([file], { ...roots, continued: false })).ledger;
    assert.equal(JSON.stringify(on), JSON.stringify(off));
    assert.equal(sliceHash(on), sliceHash(off));
    const loaded = await loadRecordedSessionWithHash({ parent: file, codexHome: empty, claudeProjects: empty });
    assert.deepEqual(loaded.recordings, [file]);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test('a part not read is a counted gap on the instructions channel, named by its reason', async () => {
  const [, r1] = chain(2);
  const dir = await folder({ 'b.jsonl': r1 });
  const empty = await mkdtemp(join(tmpdir(), 'd126-home-'));
  try {
    const { ledger } = redact(await loadSessionEvidence([join(dir, 'b.jsonl')],
      { recordingRoots: { codex: empty, claude: empty } }));
    assert.deepEqual(ledger.lineage.continued, { earlier: 0, unread: 'earlier_recording_missing' });
    const session = sessionFromLedger(ledger);
    assert.deepEqual(session.continued, { earlier: 0, unread: 'earlier_recording_missing' });
    assert.equal(session.instructionScopeIncomplete, true);
    const gaps = session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.earlier_recording_missing);
    assert.equal(gaps.length, 1);
    const { code, channel, scope, count, eventIds } = gaps[0];
    assert.deepEqual({ code, channel, scope, count, eventIds }, { code: 'incomplete_inventory', channel: 'instructions',
      scope: 'session', count: 1, eventIds: undefined });
    assert.deepEqual(coverageCauses({ session }).find(([cause]) => cause === 'instructions_earlier_missing'),
      ['instructions_earlier_missing', { n: 1 }]);
    assert.match(COVERAGE_SENTENCE.instructions_earlier_missing({ n: 1 }), /^Sonah found no earlier recording/);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test('the code step starts where the first recording of a continued session starts (D113 with D126)', async (t) => {
  // A repository with two commits: the base, and one made after the first recording began but before the reviewed one.
  const repo = await realpath(await mkdtemp(join(tmpdir(), 'd126-repo-')));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const env = (at) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
    GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' });
  const git = (at, ...args) => execFileSync('git', args, { cwd: repo, env: env(at), stdio: 'pipe' }).toString().trim();
  await writeFile(join(repo, 'README.md'), '# r\n');
  git('2029-01-01T00:00:00Z', 'init', '-q', '-b', 'main');
  git('2029-01-01T00:00:00Z', 'add', '-A');
  git('2029-01-01T00:00:00Z', 'commit', '-q', '-m', 'base');
  const base = git('2029-01-01T00:00:00Z', 'rev-parse', 'HEAD');
  await writeFile(join(repo, 'README.md'), '# r\n\nmore\n');
  git('2030-01-01T06:00:00Z', 'commit', '-q', '-am', 'between');
  const between = git('2030-01-01T06:00:00Z', 'rev-parse', 'HEAD');
  const recordings = await realpath(await mkdtemp(join(tmpdir(), 'd126-rec-')));
  t.after(() => rm(recordings, { recursive: true, force: true }));
  const first = join(recordings, 'first.jsonl'), last = join(recordings, 'last.jsonl');
  await writeFile(first, `${JSON.stringify({ timestamp: '2030-01-01T00:00:00.000Z' })}\n`);
  await writeFile(last, `${JSON.stringify({ timestamp: '2030-01-01T12:00:00.000Z' })}\n`
    + `${JSON.stringify({ timestamp: '2030-01-02T00:00:00.000Z' })}\n`);
  const session = codeSession();
  const joined = await readCodeSnapshot(session, { root: repo, maxBytes: 100_000, recording: last, startRecording: first });
  const alone = await readCodeSnapshot(session, { root: repo, maxBytes: 100_000, recording: last });
  assert.equal(joined.base.commit, base);
  assert.equal(alone.base.commit, between);

  // The review command passes the first of the loaded recordings as the start.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'd126-run-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const read = [];
  let out = '';
  session.continued = { earlier: 1, unread: null };
  const answer = codeJudge({ narrative: () => ({ decisions: [], pivots: [], claims: [], requirements: [] }),
    review: () => ({ findings: [], questions: [] }) });
  await runSessionReviewCommand([last, '--concurrency', '1', '--state-dir', join(dir, 'state'), '--format', 'md',
    '--output', join(dir, 'story.md'), '--no-open', '--code-pass'], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: () => {} }, cwd: dir,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: repo, recordings: [first, last] }),
    readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); },
    createJudge: ({ onResult }) => async (request) => {
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return answer(request);
    } });
  assert.equal(read.length, 1);
  assert.equal(read[0][1].startRecording, first);
  assert.equal(read[0][1].recording, last);
  // The terminal says that the review reads the earlier recording with it.
  const lines = out.split('\n');
  assert.equal(lines[lines.findIndex((line) => line.startsWith('Recording: ')) + 1],
    'The session continues an earlier recording in this folder. Sonah reads it with it.');
  assert.equal(CONTINUED_RECORDING_WORDS.read(2), 'The session continues 2 earlier recordings in this folder. Sonah '
    + 'reads them with it.');
});

test('the reasons are one closed vocabulary: the slicer declares them, the adapter re-declares them, each has a cause', () => {
  assert.deepEqual([...CONTINUED_UNREAD_REASONS], Object.values(CONTINUED_REASONS));
  for (const reason of CONTINUED_UNREAD_REASONS) {
    assert.equal(typeof INSTRUCTION_GAP_NOTES[reason], 'string');
    const cause = `instructions_${reason.replace('_recording', '')}`;
    assert.equal(typeof COVERAGE_SENTENCE[cause], 'function', cause);
    assert.deepEqual(coverageCauses({ session: { adapterGaps: [{ code: 'incomplete_inventory', channel: 'instructions',
      scope: 'session', count: 1, note: INSTRUCTION_GAP_NOTES[reason] }] } }), [[cause, { n: 1 }]]);
  }
});
