// D159: a review that reads a session frozen at an instant keeps that cut — the instant its sizes were taken, to the
// millisecond, and every size it took — in its state folder and in its run's entry, so a later replay reads the same
// bytes with no instant to find again. A review by path keeps nothing and sends what it sent before. Every fixture is
// synthetic and written to a private temporary folder; no real recording is read, and no reviewer is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { FROZEN_READ_SCHEMA, freezeRecordings, frozenFromRecord, frozenReadValid } from '../src/frozen-read.js';
import { FROZEN_READ_FILE, createSessionReviewStore, frozenRunOf, frozenRunValid }
  from '../src/session-review.js';
import { answerKey } from '../src/answer-cache.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';

const ID = '3f2a9c1e-5b7d-4e2f-9a1b-0c3d4e5f6a7b';
const OTHER = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const AGENT = '0123456789abcdef';
const AT = '2026-10-23T19:53:43.441Z';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const rowOf = (sid, extra) => ({ sessionId: sid, cwd: '/repo', version: '2.1.308', isSidechain: false,
  timestamp: '2026-10-23T19:50:00.000Z', ...extra });
const user = (sid, text, at = '2026-10-23T19:50:00.000Z') => rowOf(sid, { type: 'user', timestamp: at,
  origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: text } });
const call = (sid, id, name, input, at = '2026-10-23T19:50:01.000Z') => rowOf(sid, { type: 'assistant', timestamp: at,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (sid, id, content, at = '2026-10-23T19:50:02.000Z') => rowOf(sid, { type: 'user', timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const helperRow = (extra) => rowOf(ID, { agentId: AGENT, isSidechain: true, ...extra });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** A home with Claude Code's projects folder: the session `ID` (an ask, a launched helper, a read), its helper's
 *  recording below it, and another session of the same folder. */
async function home(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d159-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'claude', 'projects'), codex = join(dir, 'codex'), repo = join(dir, 'repo');
  const folder = join(projects, '-repo');
  await mkdir(join(folder, ID, 'subagents'), { recursive: true }); await mkdir(codex, { recursive: true });
  await mkdir(repo);
  const file = join(folder, `${ID}.jsonl`), helper = join(folder, ID, 'subagents', `agent-${AGENT}.jsonl`);
  await writeFile(file, lines([user(ID, 'Read the parser, and have a helper check the docs.'),
    call(ID, 'spawn-1', 'Agent', { prompt: 'Check the docs.' }),
    result(ID, 'spawn-1', `Async agent launched.\nagentId: ${AGENT}\nUse SendMessage to reach it.`),
    call(ID, 'r1', 'Read', { file_path: '/repo/src/parser.js' }, '2026-10-23T19:50:03.000Z'),
    result(ID, 'r1', 'parser text', '2026-10-23T19:50:04.000Z')]), { mode: 0o600 });
  await writeFile(helper, lines([helperRow({ type: 'user', message: { role: 'user', content: 'Check the docs.' } }),
    helperRow({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'h1', name: 'Read',
      input: { file_path: '/repo/README.md' } }] } })]), { mode: 0o600 });
  await writeFile(join(folder, `${OTHER}.jsonl`), lines([user(OTHER, 'another session')]), { mode: 0o600 });
  const env = { HOME: dir, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: codex, CLAUDE_CONFIG_DIR: join(dir, 'claude') };
  return { dir, projects, codex, repo, folder, file, helper, env };
}
const load = (h, frozen = null) => loadRecordedSessionWithHash({ parent: h.file, codexHome: h.codex,
  claudeProjects: h.projects, ...(frozen ? { frozen } : {}) });
/** Rows written after the start: the session goes on, its helper goes on, a new helper begins, half a row. */
async function goOn(h) {
  await appendFile(h.file, lines([user(ID, 'Now write the tests too.', '2026-10-23T19:53:43.442Z'),
    call(ID, 'w1', 'Write', { file_path: '/repo/test/parser.test.js', content: 'x' }, '2026-10-23T19:53:44.000Z')])
    + JSON.stringify(user(ID, 'half a row')).slice(0, 40));
  await appendFile(h.helper, lines([helperRow({ type: 'assistant', timestamp: '2026-10-23T19:53:45.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'The docs are fine.' }] } })]));
  await writeFile(join(h.folder, ID, 'subagents', 'agent-fedcba9876543210.jsonl'), lines([helperRow({ agentId:
    'fedcba9876543210', type: 'user', message: { role: 'user', content: 'Later brief.' } })]), { mode: 0o600 });
}

test('D159: a frozen read keeps its cut — the instant, read once just before the first size, to the millisecond, and '
  + 'every size it took, by path', async (t) => {
  const h = await home(t);
  let reads = 0;
  // The clock is read before any size: a row written as it is read is inside the cut.
  const now = () => { reads++; appendFileSync(h.file, lines([user(ID, 'written as the clock was read', AT)])); return Date.parse(AT); };
  const frozen = await freezeRecordings(h.file, { adapter: 'claude', codexHome: h.codex, now });
  assert.equal(reads, 1, 'one clock read');
  const size = async (path) => (await stat(path)).size;
  const record = frozen.record();
  assert.deepEqual(record, { schema: FROZEN_READ_SCHEMA, at: AT, adapter: 'claude', recording: h.file,
    bytes: await size(h.file), files: [[`${OTHER}.jsonl`, await size(join(h.folder, `${OTHER}.jsonl`))],
      [`${ID}.jsonl`, await size(h.file)], [`${ID}/subagents/agent-${AGENT}.jsonl`, await size(h.helper)]] });
  assert.ok(frozenReadValid(record));
  assert.ok(frozenReadValid(JSON.parse(JSON.stringify(record))), 'as stored');
  // The cut is the start's, whatever is written after.
  await goOn(h);
  assert.deepEqual(frozen.record(), record);
  // The clock's own millisecond, never a rounded time.
  const later = await freezeRecordings(h.file, { adapter: 'claude', now: () => Date.parse(AT) + 0.9 });
  assert.equal(later.record().at, AT);
  // A recording named by a relative path is kept by its absolute one.
  const named = await freezeRecordings(relative(process.cwd(), h.file), { adapter: 'claude', now: () => Date.parse(AT) });
  assert.equal(named.record().recording, h.file);
  assert.ok(frozenReadValid(named.record()));
  // A frozen set built from sizes alone (no cut given) has no record.
  const { frozenOf } = await import('../src/frozen-read.js');
  assert.equal(frozenOf(new Map()).record(), null);
});

test('D159: a replay given the kept cut reads the same bytes as the review that kept it, whatever was written since, '
  + 'and keeps the same cut', async (t) => {
  const h = await home(t);
  const frozen = await freezeRecordings(h.file, { adapter: 'claude', codexHome: h.codex, now: () => Date.parse(AT) });
  const atStart = await load(h, frozen);
  const stored = JSON.parse(JSON.stringify(frozen.record()));
  await goOn(h);
  assert.notEqual((await load(h)).hash, atStart.hash, 'the session went on');
  assert.notEqual((await load(h, await freezeRecordings(h.file, { adapter: 'claude' }))).hash, atStart.hash,
    'a new freeze reads what was written since');
  const replay = await frozenFromRecord(stored, { recording: h.file, codexHome: h.codex });
  const replayed = await load(h, replay);
  assert.equal(replayed.hash, atStart.hash, 'the same slice_hash');
  assert.deepEqual(replayed.session.events.map((e) => e.id), atStart.session.events.map((e) => e.id));
  assert.deepEqual(replay.record(), stored, 'the replay keeps the cut it was given');
  // Given by a relative path, the same absolute path: the record again.
  const byRelative = await frozenFromRecord(stored, { recording: relative(process.cwd(), h.file), codexHome: h.codex });
  assert.deepEqual(byRelative.record(), stored);
  assert.equal((await load(h, byRelative)).hash, atStart.hash);
  // A copy of the projects folder, replayed at the copy's path: the same instant, files and sizes under that path, and
  // the same slice_hash; the copy goes on after it was made, and the cut leaves that out too.
  const copy = join(h.dir, 'copy');
  await cp(join(h.dir, 'claude'), join(copy, 'claude'), { recursive: true });
  const copied = join(copy, 'claude', 'projects', '-repo', `${ID}.jsonl`);
  await appendFile(copied, lines([user(ID, 'written to the copy', '2026-10-23T19:55:00.000Z')]));
  const inCopy = await frozenFromRecord(stored, { recording: copied, codexHome: h.codex });
  assert.deepEqual(inCopy.record(), { ...stored, recording: copied });
  assert.ok(frozenReadValid(inCopy.record()));
  const fromCopy = await loadRecordedSessionWithHash({ parent: copied, codexHome: h.codex,
    claudeProjects: join(copy, 'claude', 'projects'), frozen: inCopy });
  assert.equal(fromCopy.hash, atStart.hash, 'the same slice_hash from the copy');
  // A record is replayed only on the recording it froze, and only as written.
  await assert.rejects(frozenFromRecord(stored, { recording: join(h.folder, `${OTHER}.jsonl`) }), TypeError);
  await assert.rejects(frozenFromRecord({ ...stored, at: '2026-10-23T19:53:44Z' }, { recording: h.file }), TypeError);
});

test('D159: a Codex rollout outside the sessions folder keeps its own size in the cut, and a replay reads it as kept',
  async (t) => {
    const h = await home(t);
    const id = '019a0000-0000-7000-8000-00000000a001';
    const archived = join(h.codex, 'archived_sessions');
    await mkdir(archived, { recursive: true }); await mkdir(join(h.codex, 'sessions', '2026', '10', '23'), { recursive: true });
    const rollout = join(archived, `rollout-2026-10-23T19-50-00-${id}.jsonl`);
    const meta = { type: 'session_meta', payload: { id, cwd: '/repo' } };
    const message = (text) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: text } });
    await writeFile(rollout, lines([meta, message('Review the change.')].map((row, ordinal) => ({ ordinal, ...row }))));
    const sibling = join(h.codex, 'sessions', '2026', '10', '23', 'rollout-2026-10-23T19-51-00-other.jsonl');
    await writeFile(sibling, lines([meta]));
    // The clock is read before the rollout's size is taken: a row written as it is read is inside the cut. The walk
    // never takes this rollout's size again, so its one size is the one taken after the clock.
    const before = (await stat(rollout)).size;
    const now = () => { appendFileSync(rollout, lines([{ ordinal: 2, ...message('as the clock was read') }])); return Date.parse(AT); };
    const frozen = await freezeRecordings(rollout, { adapter: 'codex', codexHome: h.codex, now });
    const record = frozen.record();
    assert.ok(record.bytes > before);
    assert.equal(record.bytes, (await stat(rollout)).size);
    assert.equal(record.at, AT);
    assert.deepEqual(record.files, [['2026/10/23/rollout-2026-10-23T19-51-00-other.jsonl', (await stat(sibling)).size]]);
    await appendFile(rollout, lines([message('Later.')].map((row) => ({ ordinal: 3, ...row }))));
    const replay = await frozenFromRecord(record, { recording: rollout, codexHome: h.codex });
    assert.equal(replay.sizeOf(await stat(rollout, { bigint: true })), BigInt(record.bytes));
    assert.equal(await replay.endOf(rollout), record.bytes);
  });

test('D159: a record is read only as written: its instant to the millisecond, sizes, relative paths in path order, '
  + 'each once, and nothing else', () => {
  const good = { schema: FROZEN_READ_SCHEMA, at: AT, adapter: 'claude', recording: '/p/-repo/a.jsonl', bytes: 10,
    files: [['a.jsonl', 10], ['a/subagents/agent-1.jsonl', 3]] };
  assert.ok(frozenReadValid(good));
  assert.ok(frozenReadValid({ ...good, adapter: null, bytes: null, files: [] }));
  // A file name may hold a backslash: the record's separator is '/' alone.
  assert.ok(frozenReadValid({ ...good, files: [['\\a.jsonl', 1], ['b\\.jsonl', 1]] }));
  for (const bad of [{ ...good, at: '2026-10-23T19:53:44Z' }, { ...good, at: '2026-10-23 19:53:43.441' },
    { ...good, at: null }, { ...good, schema: 'sonah.frozen-read/2' }, { ...good, adapter: 'other' },
    { ...good, recording: 'a.jsonl' }, { ...good, bytes: -1 }, { ...good, bytes: 1.5 },
    { ...good, files: [['b.jsonl', 1], ['a.jsonl', 1]] }, { ...good, files: [['a.jsonl', 1], ['a.jsonl', 1]] },
    { ...good, files: [['../a.jsonl', 1]] }, { ...good, files: [['/p/a.jsonl', 1]] }, { ...good, files: [['a.jsonl']] },
    { ...good, files: [['a//b.jsonl', 1]] }, { ...good, extra: 1 }, (({ bytes, ...rest }) => rest)(good), null, []])
    assert.equal(frozenReadValid(bad), false, JSON.stringify(bad));
});

test('D159: a run\'s entry keeps its cut by its instant, size, count and digest; an entry with another shape is not '
  + 'read, and an entry written before still reads', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d159-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSessionReviewStore(join(dir, 'review'));
  const record = { schema: FROZEN_READ_SCHEMA, at: AT, adapter: 'claude', recording: '/p/-repo/a.jsonl', bytes: 10,
    files: [['a.jsonl', 10]] };
  const frozen = frozenRunOf(record);
  assert.deepEqual(frozen, { at: AT, bytes: 10, files: 1, digest: sha256(JSON.stringify(record)) });
  assert.equal(frozenRunOf(null), null);
  assert.equal(frozenRunOf({ ...record, at: '2026-10-23T19:53:44Z' }), null);
  const usage = { version: 'sonah.review-usage/1' };
  const identity = { backend: 'claude-cli', model: 'm', codeModel: null };
  // Entries written before (no cut; no identity) and after.
  await store.appendUsageRun({ usage, paused: null, failure: null });
  await store.appendUsageRun({ usage, paused: null, failure: null, identity });
  await store.appendUsageRun({ usage, paused: null, failure: null, identity, frozen });
  await store.appendUsageRun({ usage, paused: null, failure: null, frozen });
  assert.deepEqual((await store.readUsageRuns()).runs.map((run) => run.frozen ?? null), [null, null, frozen, frozen]);
  for (const bad of [{ ...frozen, at: '2026-10-23T19:53:44Z' }, { ...frozen, digest: 'x' }, { ...frozen, bytes: -1 },
    { ...frozen, files: 1.5 }, { ...frozen, extra: 1 }, null, AT])
    await assert.rejects(store.appendUsageRun({ usage, paused: null, failure: null, frozen: bad }), TypeError);
  assert.equal(frozenRunValid(frozen), true);
  // The kept cut: saved and read back; a malformed file is not read; the next run's cut replaces it.
  assert.deepEqual(await store.readFrozenRead(), { record: null });
  await store.saveFrozenRead(record);
  assert.deepEqual(await store.readFrozenRead(), { record });
  assert.equal(sha256(await readFile(join(dir, 'review', FROZEN_READ_FILE))), frozen.digest);
  await assert.rejects(store.saveFrozenRead({ ...record, files: [['b', 1], ['a', 1]] }), TypeError);
  const next = { ...record, at: '2026-10-23T19:53:50.000Z' };
  await store.saveFrozenRead(next);
  assert.deepEqual(await store.readFrozenRead(), { record: next });
  await writeFile(join(dir, 'review', FROZEN_READ_FILE), JSON.stringify({ ...record, files: 1 }), { mode: 0o600 });
  assert.deepEqual(await store.readFrozenRead(), { record: null, discard: 'schema_invalid' });
  // A non-regular entry at the name (a folder, with a file in it) is moved aside, never deleted, and the cut is saved.
  await rm(join(dir, 'review', FROZEN_READ_FILE));
  await mkdir(join(dir, 'review', FROZEN_READ_FILE));
  await writeFile(join(dir, 'review', FROZEN_READ_FILE, 'inside'), 'kept');
  assert.equal((await store.readFrozenRead()).discard, 'not_regular_file');
  await store.saveFrozenRead(record);
  assert.deepEqual(await store.readFrozenRead(), { record });
  assert.equal(await readFile(join(dir, 'review', '.discarded', `${FROZEN_READ_FILE}.0`, 'inside'), 'utf8'), 'kept');
});

/** One `sonah review` of the home's session: by `--session` (a frozen read whose clock reads AT) or by path, into its
 *  own state folder, with a reviewer that answers every window with an empty narrative and records what it was sent.
 *  `onFirstCall` runs as the first request is sent. */
let outputs = 0;
async function review(h, { bySession, state, onFirstCall = async () => {}, freeze = null, extra = [], dry = false,
  attestation = 'attested', env = h.env, by = null }) {
  const sent = [];
  const out = { text: '' };
  const argv = [...(by ?? (bySession ? ['--session', ID] : [h.file])), '--no-code-pass', '--concurrency', '1',
    '--state-dir', state, ...(dry ? ['--dry-run'] : ['--format', 'md', '--output', join(h.dir, `review-${++outputs}.md`)]),
    '--no-open', ...extra];
  const code = await runSessionReviewCommand(argv, { cwd: h.repo, env, installSignals: false,
    stdout: { write: (text) => { out.text += text; } }, stderr: { write: () => {} },
    loadReviews: async () => new Map(), openPage: async () => {},
    freeze: freeze ?? ((file, options) => freezeRecordings(file, { ...options, now: () => Date.parse(AT) })),
    createJudge: ({ config, onResult }) => async (request) => {
      if (sent.length === 0) await onFirstCall();
      sent.push({ request, key: answerKey(request, config) });
      onResult({ ok: true, backend: 'claude-cli', attestation, contextWindow: 1_000_000,
        usage: { input_tokens: 1, output_tokens: 1 } });
      return { decisions: [], pivots: [], claims: [], requirements: [] };
    } });
  return { code, sent, out: out.text };
}
const keptOf = (state) => readFile(join(state, 'review', FROZEN_READ_FILE), 'utf8');
const runsOf = async (state) => JSON.parse(await readFile(join(state, 'review', 'usage.private.json'), 'utf8')).runs;

test('D159: a review by session id keeps its cut in its state folder before its first call and in its run\'s entry; '
  + 'a review by path keeps none, and both send the same requests', async (t) => {
  const h = await home(t);
  const byPathState = join(h.dir, 'state-by-path'), bySessionState = join(h.dir, 'state-by-session');
  const sizeAtStart = (await stat(h.file)).size;
  const byPath = await review(h, { bySession: false, state: byPathState });
  assert.ok(byPath.sent.length > 0, byPath.out);
  let keptAtFirstCall = null;
  const bySession = await review(h, { bySession: true, state: bySessionState, onFirstCall: async () => {
    keptAtFirstCall = await readFile(join(bySessionState, 'review', FROZEN_READ_FILE), 'utf8').catch(() => null);
    // The session goes on while the review runs: rows its cut leaves out.
    await goOn(h);
  } });
  assert.equal(bySession.code, byPath.code, bySession.out);
  // The cut, kept before the first call, and as the review read it.
  assert.notEqual(keptAtFirstCall, null, 'kept before the first call');
  const kept = JSON.parse(keptAtFirstCall);
  assert.ok(frozenReadValid(kept));
  assert.equal(kept.at, AT);
  assert.equal(kept.recording, h.file);
  assert.equal(kept.bytes, sizeAtStart);
  assert.deepEqual(kept.files.map(([path]) => path), [`${OTHER}.jsonl`, `${ID}.jsonl`,
    `${ID}/subagents/agent-${AGENT}.jsonl`]);
  const stateFile = await readFile(join(bySessionState, 'review', FROZEN_READ_FILE), 'utf8');
  assert.equal(stateFile, keptAtFirstCall);
  assert.equal(((await stat(join(bySessionState, 'review', FROZEN_READ_FILE))).mode & 0o777), 0o600);
  // The run's entry: the instant, the recording's size, the count and the digest of the kept file's bytes.
  const [entry] = await runsOf(bySessionState);
  assert.deepEqual(entry.frozen, { at: AT, bytes: sizeAtStart, files: 3, digest: sha256(stateFile) });
  // A review by path keeps no cut, and its entry has none.
  assert.deepEqual(await readdir(join(byPathState, 'review')).then((names) => names.includes(FROZEN_READ_FILE)), false);
  assert.equal(Object.hasOwn((await runsOf(byPathState))[0], 'frozen'), false);
  // The cut adds nothing to what is sent: the same requests, byte for byte, and the same answer keys.
  assert.deepEqual(bySession.sent.map((s) => [s.request.label ?? null, s.request.system, s.request.prompt, s.key]),
    byPath.sent.map((s) => [s.request.label ?? null, s.request.system, s.request.prompt, s.key]));
  // Run again on the same state, the session having gone on: a new cut, kept in place of the first, each run's in its
  // own entry.
  const again = await review(h, { bySession: true, state: bySessionState });
  assert.ok(again.sent.length > 0);
  const [, second] = await runsOf(bySessionState);
  const keptNow = await readFile(join(bySessionState, 'review', FROZEN_READ_FILE), 'utf8');
  assert.deepEqual(second.frozen, { at: AT, bytes: (await stat(h.file)).size, files: 4, digest: sha256(keptNow) });
  assert.notEqual(keptNow, stateFile);
});

test('D159: a cut that cannot be kept as a record is not kept, and the review reads and sends as before', async (t) => {
  const h = await home(t);
  const kept = join(h.dir, 'state-kept'), unkept = join(h.dir, 'state-unkept');
  const first = await review(h, { bySession: true, state: kept });
  // A frozen set whose record is not one (a relative recording path): the same frozen read, nothing kept.
  const second = await review(h, { bySession: true, state: unkept, freeze: async (file, options) => {
    const frozen = await freezeRecordings(file, options);
    return { ...frozen, record: () => ({ ...frozen.record(), recording: 'relative.jsonl' }) };
  } });
  assert.equal(second.code, first.code, second.out);
  assert.deepEqual(second.sent.map((s) => s.key), first.sent.map((s) => s.key));
  assert.equal((await readdir(join(unkept, 'review'))).includes(FROZEN_READ_FILE), false);
  assert.equal(Object.hasOwn((await runsOf(unkept))[0], 'frozen'), false);
  assert.equal((await readdir(join(kept, 'review'))).includes(FROZEN_READ_FILE), true);
});

test('D159: a run refused the lock leaves the kept cut as it was, and keeps no entry', async (t) => {
  const h = await home(t);
  const state = join(h.dir, 'state');
  const first = await review(h, { bySession: true, state });
  assert.equal(first.code, 0, first.out);
  const kept = await keptOf(state);
  const runs = await runsOf(state);
  await goOn(h);
  // Another run holds the review's lock: this run reads a later cut and is refused before any call.
  const release = await createSessionReviewStore(join(state, 'review')).lock();
  let refused;
  try { refused = await review(h, { bySession: true, state }); } finally { await release(); }
  assert.notEqual(refused.code, 0);
  assert.equal(refused.sent.length, 0);
  assert.equal(await keptOf(state), kept, 'byte for byte');
  assert.deepEqual(await runsOf(state), runs);
});

test('D159: a run that fails, or stops where you asked, keeps its cut in its entry', async (t) => {
  const h = await home(t);
  for (const [label, options, check] of [
    ['failed', { attestation: 'unattested' }, (run) => assert.equal(run.failure, 'model_unavailable')],
    ['stopped', { extra: ['--max-input-bytes', '1'] }, (run) => assert.equal(run.paused, 'max_input_bytes')]]) {
    const state = join(h.dir, `state-${label}`);
    const ran = await review(h, { bySession: true, state, ...options });
    assert.notEqual(ran.code, 0, label);
    const [run] = await runsOf(state);
    check(run);
    const kept = await keptOf(state);
    assert.deepEqual(run.frozen, { at: AT, bytes: (await stat(h.file)).size, files: 3,
      digest: sha256(kept) }, label);
  }
});

test('D159: a review by --commits keeps its cut; a dry run by session id keeps none', async (t) => {
  const h = await home(t);
  // A repository whose commit names the session (sealed git: no config of the person's, fixed times).
  const keep = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:GIT_|CLAUDE_CODE_|CODEX_)/.test(k)));
  const gitEnv = { ...keep, HOME: h.dir, XDG_CONFIG_HOME: join(h.dir, '.config'), GIT_CONFIG_NOSYSTEM: '1', LANG: 'C',
    GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic',
    GIT_COMMITTER_EMAIL: 's@example.invalid', GIT_EDITOR: 'false', GIT_AUTHOR_DATE: '@1900000000 +0000',
    GIT_COMMITTER_DATE: '@1900000000 +0000' };
  const g = (args) => {
    const r = spawnSync('git', args, { cwd: h.repo, env: gitEnv, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  g(['init', '-q', '-b', 'main']);
  g(['commit', '-q', '--allow-empty', '-m', 'base']);
  g(['checkout', '-q', '-b', 'work']);
  g(['commit', '-q', '--allow-empty', '-m', `one\n\nAgent-Session: ${ID}`]);
  const env = { ...gitEnv, ...h.env };
  const state = join(h.dir, 'state-commits');
  const byCommits = await review(h, { by: ['--commits', 'main..work'], state, env });
  assert.equal(byCommits.code, 0, byCommits.out);
  const kept = JSON.parse(await keptOf(state));
  assert.ok(frozenReadValid(kept));
  assert.equal(kept.recording, h.file);
  assert.equal((await runsOf(state))[0].frozen.digest, sha256(await keptOf(state)));
  // A dry run by session id reads through the frozen read and writes nothing, so it keeps no cut.
  const dryState = join(h.dir, 'state-dry');
  const dry = await review(h, { bySession: true, state: dryState, dry: true });
  assert.equal(dry.code, 0, dry.out);
  assert.equal(dry.sent.length, 0);
  await assert.rejects(stat(join(dryState, 'review', FROZEN_READ_FILE)), { code: 'ENOENT' });
});
