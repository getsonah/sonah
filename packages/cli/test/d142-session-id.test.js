// D142: `sonah review --session ID`, `--background`, and the frozen read. A session id names the recording whose
// file name carries it, or none; an empty id reviews nothing; `--background` says one line and starts the review
// detached; a review by session id reads every recording as it was when it started. Every fixture is synthetic and
// written to a private temporary folder; no real recording is read, and no reviewer is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, truncate, utimes, writeFile }
  from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { redact, sliceHash } from '../../redact/index.js';
import { SESSION_ID_PROBLEMS, CLI_SAFE_ERROR_CODES } from '../../evidence/src/ledger.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { freezeRecordings } from '../src/frozen-read.js';
import { readCodeSnapshot, recordingEnd, recordingStart } from '../src/code-snapshot.js';
import { codexNameCarries, recordingsNamed, resolveSessionId } from '../src/session-id.js';
import { BACKGROUND_MARK, REVIEW_FIX_DEFAULT, REVIEW_FIX_WORDS, SESSION_ID_WORDS, STATE_FOLDER_ENTRIES,
  parseSessionReviewArgs, runSessionReviewCommand, startDetachedReview } from '../src/session-review-command.js';
import { buildCodeSession, CODE_TEXT } from './code-pass-fixture.js';
import * as WF from './m33-w-workflow-fixture.js';

const ID = '3f2a9c1e-5b7d-4e2f-9a1b-0c3d4e5f6a7b';
const OTHER = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const CODEX_ID = '019a1b2c-3d4e-7f50-8a9b-0c1d2e3f4a5b';

const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
const rowOf = (sid, extra) => ({ sessionId: sid, cwd: '/repo', version: '2.1.308', isSidechain: false,
  timestamp: '2026-10-23T10:00:00.000Z', ...extra });
const user = (sid, text, at = '2026-10-23T10:00:00.000Z') => rowOf(sid, { type: 'user', timestamp: at,
  origin: { kind: 'human' }, promptSource: 'typed', message: { role: 'user', content: text } });
const call = (sid, id, name, input, at = '2026-10-23T10:00:01.000Z') => rowOf(sid, { type: 'assistant', timestamp: at,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (sid, id, content, at = '2026-10-23T10:00:02.000Z') => rowOf(sid, { type: 'user', timestamp: at,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** A home with Claude Code's projects folder and a Codex home, and the options a review needs to run on it. */
async function home(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d142-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'claude', 'projects'), codex = join(dir, 'codex'), repo = join(dir, 'repo');
  await mkdir(projects, { recursive: true }); await mkdir(codex, { recursive: true }); await mkdir(repo);
  const env = { HOME: dir, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: codex, CLAUDE_CONFIG_DIR: join(dir, 'claude') };
  return { dir, projects, codex, repo, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
async function claudeRecording(projects, slug, id, rows) {
  await mkdir(join(projects, slug), { recursive: true });
  const file = join(projects, slug, `${id}.jsonl`);
  await writeFile(file, lines(rows), { mode: 0o600 });
  return file;
}
async function codexRollout(codex, folder, name) {
  const dir = join(codex, ...folder);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, name), '{}\n', { mode: 0o600 });
  return join(dir, name);
}
const never = (what) => () => assert.fail(`${what} must not run`);

// ------------------------------------------------------------------------------------------------ the flags

test('D142: --session takes one UUID, kept in lower case; an empty value is kept; no value, a dash or another shape '
  + 'is a usage error', () => {
  assert.equal(parseSessionReviewArgs(['--session', ID]).session, ID);
  assert.equal(parseSessionReviewArgs(['--session', ID.toUpperCase()]).session, ID);
  assert.equal(parseSessionReviewArgs(['--session', '']).session, '');
  for (const argv of [['--session'], ['--session', '--background'], ['--session', '-x'], ['--session', 'not-an-id'],
    ['--session', `${ID}x`], ['--session', '3f2a9c1e5b7d4e2f9a1b0c3d4e5f6a7b'], ['--session', ID, '--session', ID]])
    assert.throws(() => parseSessionReviewArgs(argv), { code: 'usage' }, argv.join(' '));
});

test('D142: --session goes with no path, --choose or --repo; --background needs --session and takes no output, format, '
  + 'dry run or PR comment of its own', () => {
  for (const argv of [['file.jsonl', '--session', ID], ['--session', ID, '--choose', '1'],
    ['--session', ID, '--repo', '.'], ['--background'], ['file.jsonl', '--background'],
    ['--session', ID, '--background', '--dry-run'], ['--session', ID, '--background', '--format', 'md'],
    ['--session', ID, '--background', '--output', 'x.md'], ['--session', ID, '--background', '--background'],
    ['--session', ID, '--background', '--post-comment', '--github', 'o/r', '--pr', '1', '--format', 'html',
      '--output', 'x.html'], ['--commits', 'main..HEAD', '--background'],
    ['--commits', 'main..HEAD', '--session', ID, '--background']])
    assert.throws(() => parseSessionReviewArgs(argv), { code: 'usage' }, argv.join(' '));
  const parsed = parseSessionReviewArgs(['--session', ID, '--background', '--no-open', '--state-dir', 'state']);
  assert.equal(parsed.background, true);
  assert.equal(parsed.noOpen, true);
});

test('D142: the closed codes of a session id are codes the review may print by name, each with its fix words', () => {
  assert.deepEqual(SESSION_ID_PROBLEMS, ['session_id_not_found', 'session_id_ambiguous', 'session_id_compressed']);
  for (const code of SESSION_ID_PROBLEMS) {
    assert.ok(CLI_SAFE_ERROR_CODES.includes(code), code);
    assert.equal(typeof REVIEW_FIX_WORDS[code], 'string', code);
  }
  assert.ok(STATE_FOLDER_ENTRIES.includes('background'));
});

// ------------------------------------------------------------------------------------------------ the resolver

test('D142: a session id names the recording whose file name carries it, never one whose rows name it', async (t) => {
  const h = await home(t);
  // A forked recording: its rows open with the session it was forked from, under that session's id.
  const forked = await claudeRecording(h.projects, '-repo', ID, [user(OTHER, 'copied from the other session'),
    user(ID, 'the forked session')]);
  // The session it was forked from: its rows hold the id of the fork nowhere, and its name is its own.
  await claudeRecording(h.projects, '-repo', OTHER, [user(OTHER, 'the original session')]);
  // A recording of another folder whose rows name the id (a copy), under another name.
  await claudeRecording(h.projects, '-other', 'a0000000-0000-4000-8000-000000000000', [user(ID, 'a copy of a row')]);
  const roots = { claudeProjects: h.projects, codexHome: h.codex };
  assert.deepEqual(await resolveSessionId(ID, roots), { file: forked, adapter: 'claude' });
  assert.deepEqual(await resolveSessionId(ID.toUpperCase(), roots), { file: forked, adapter: 'claude' });
  assert.equal((await resolveSessionId(OTHER, roots)).file, join(h.projects, '-repo', `${OTHER}.jsonl`));
  // The same name in two folders: ambiguous, listed in path order.
  const second = await claudeRecording(h.projects, '-a-second-folder', ID, [user(ID, 'x')]);
  await assert.rejects(resolveSessionId(ID, roots), (error) => error.code === 'session_id_ambiguous'
    && JSON.stringify(error.matches) === JSON.stringify([second, forked]));
  // None: not found. A symbolic link named by the id is no recording.
  const none = 'b1111111-1111-4111-8111-111111111111';
  await assert.rejects(resolveSessionId(none, roots), { code: 'session_id_not_found' });
  await symlink(forked, join(h.projects, '-repo', `${none}.jsonl`));
  await assert.rejects(resolveSessionId(none, roots), { code: 'session_id_not_found' });
});

test('D142: Codex rollouts by name: the plain, the revert and the archived form; two files are ambiguous, a .zst one '
  + 'is compressed', async (t) => {
  const h = await home(t);
  const roots = { claudeProjects: h.projects, codexHome: h.codex };
  const day = ['sessions', '2026', '10', '23'];
  assert.equal(codexNameCarries(`rollout-2026-10-23T10-00-00-${CODEX_ID}.jsonl`, CODEX_ID), true);
  assert.equal(codexNameCarries(`rollout-2026-10-23T10-00-00-${CODEX_ID}_019a1b2c-0000-7000-8000-000000000001.jsonl`,
    CODEX_ID), true);
  assert.equal(codexNameCarries(`rollout-2026-10-23T10-00-00-${CODEX_ID}.jsonl.zst`, CODEX_ID), true);
  for (const name of [`rollout-2026-10-23T10-00-00-${CODEX_ID}_.jsonl`, `${CODEX_ID}.jsonl`,
    `rollout-2026-10-23T10-00-00-${CODEX_ID}.json`, `rollout-2026-10-23T10-00-00-x${CODEX_ID.slice(1)}.jsonl`])
    assert.equal(codexNameCarries(name, CODEX_ID), false, name);
  const plain = await codexRollout(h.codex, day, `rollout-2026-10-23T10-00-00-${CODEX_ID}.jsonl`);
  assert.deepEqual(await resolveSessionId(CODEX_ID, roots), { file: plain, adapter: 'codex' });
  // A folder that is not a day's (`sessions/notes`) is not searched.
  await codexRollout(h.codex, ['sessions', 'notes'], `rollout-2026-10-23T10-00-00-${CODEX_ID}.jsonl`);
  assert.deepEqual(await resolveSessionId(CODEX_ID, roots), { file: plain, adapter: 'codex' });
  // After a revert, Codex writes a second file for the same thread: ambiguous, both listed.
  const reverted = await codexRollout(h.codex, day,
    `rollout-2026-10-23T11-00-00-${CODEX_ID}_019a1b2c-0000-7000-8000-000000000001.jsonl`);
  await assert.rejects(resolveSessionId(CODEX_ID, roots), (error) => error.code === 'session_id_ambiguous'
    && JSON.stringify(error.matches) === JSON.stringify([plain, reverted]));
  // The archived form, alone.
  const archivedId = '019a1b2c-3d4e-7f50-8a9b-000000000002';
  const archived = await codexRollout(h.codex, ['archived_sessions'], `rollout-2026-10-01T10-00-00-${archivedId}.jsonl`);
  assert.deepEqual(await resolveSessionId(archivedId, roots), { file: archived, adapter: 'codex' });
  // A compressed rollout, alone: compressed, never read.
  const coldId = '019a1b2c-3d4e-7f50-8a9b-000000000003';
  await codexRollout(h.codex, day, `rollout-2026-10-23T09-00-00-${coldId}.jsonl.zst`);
  await assert.rejects(resolveSessionId(coldId, roots), { code: 'session_id_compressed' });
  assert.equal((await recordingsNamed(coldId, roots)).length, 1);
});

// ------------------------------------------------------------------------------------------------ the command

test('D142: an empty session id reviews nothing, and never looks for the newest recording', async (t) => {
  const h = await home(t);
  await claudeRecording(h.projects, '-repo', ID, [user(ID, 'the newest recording')]);
  for (const background of [false, true]) {
    const out = streams();
    const code = await runSessionReviewCommand(['--session', '', ...(background ? ['--background'] : [])], {
      ...h.options, ...out, discover: never('discovery'), loadSession: never('the load'),
      resolveSession: never('the resolver'), startReview: never('a background review'), createJudge: never('a judge') });
    assert.equal(code, background ? 0 : 1);
    assert.equal(out.chunks.stdout, `${SESSION_ID_WORDS.missing}\n`);
    assert.equal(out.chunks.stderr, '');
  }
});

test('D142: an id that no recording carries, or that two carry, fails by its closed code and reads nothing',
  async (t) => {
    const h = await home(t);
    let out = streams();
    assert.equal(await runSessionReviewCommand(['--session', ID], { ...h.options, ...out,
      discover: never('discovery'), loadSession: never('the load') }), 2);
    assert.equal(out.chunks.stderr, `Review could not complete: session_id_not_found.\nFix: ${
      REVIEW_FIX_WORDS.session_id_not_found}\n`);
    const a = await claudeRecording(h.projects, '-a', ID, [user(ID, 'x')]);
    const b = await claudeRecording(h.projects, '-b', ID, [user(ID, 'x')]);
    out = streams();
    assert.equal(await runSessionReviewCommand(['--session', ID], { ...h.options, ...out,
      discover: never('discovery'), loadSession: never('the load') }), 2);
    assert.match(out.chunks.stderr, /session_id_ambiguous/);
    assert.ok(out.chunks.stderr.endsWith(`${SESSION_ID_WORDS.matches([a, b])}\n`));
  });

test('D142: --session reviews the named recording, read with the frozen set, whatever is newer in the repository',
  async (t) => {
    const h = await home(t);
    const named = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'Read the parser.')]);
    // A newer recording of the same folder: the default would take it; the id never does.
    await claudeRecording(h.projects, '-repo', OTHER, [user(OTHER, 'another session, written later')]);
    const seen = [];
    const out = streams();
    assert.equal(await runSessionReviewCommand(['--session', ID, '--dry-run', '--no-code-pass'], { ...h.options, ...out,
      discover: never('discovery'), loadSession: async (input) => { seen.push(input); return loadRecordedSessionWithHash(input); },
      createJudge: never('a judge') }), 0);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].parent, named);
    assert.equal(typeof seen[0].frozen?.endOf, 'function', 'a review by session id is a frozen read');
    assert.match(out.chunks.stdout, new RegExp(`^Recording: ${named.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(claude\\)\\.`));
  });

const stateFolderOf = (h, file) => join(h.env.SONAH_HOME, 'session-reviews',
  createHash('sha256').update(file).digest('hex'));

test('D142: --background prints one line and starts the review detached with the same options; it reads and sends '
  + 'nothing itself', async (t) => {
  const h = await home(t);
  const named = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'Read the parser.')]);
  for (const noOpen of [true, false]) {
    const started = [];
    const out = streams();
    const argv = ['--session', ID, '--background', ...(noOpen ? ['--no-open'] : []), '--profile', 'standard'];
    assert.equal(await runSessionReviewCommand(argv, { ...h.options, ...out, discover: never('discovery'),
      loadSession: never('the load'), createJudge: never('a judge'), freeze: never('the frozen read'),
      startReview: async (spec) => { started.push(spec); return 4242; } }), 0);
    assert.equal(started.length, 1);
    const [{ argv: child, cwd, env, log }] = started;
    const state = stateFolderOf(h, named);
    const page = child[child.indexOf('--output') + 1];
    assert.ok(page.startsWith(join(state, 'background', 'review-')) && page.endsWith('.html'), page);
    assert.equal(log, `${page.slice(0, -'.html'.length)}.log`);
    assert.deepEqual(child, ['review', '--session', ID, ...(noOpen ? ['--no-open'] : []), '--profile', 'standard',
      '--format', 'html', '--output', page]);
    assert.equal(cwd, h.repo);
    assert.equal(env, h.env);
    // One line, and nothing of a review: no estimate, no counts, no report, no PR comment line. With --no-open, the
    // line never says that Sonah opens the page.
    const W = SESSION_ID_WORDS;
    assert.equal(out.chunks.stdout, `${(noOpen ? W.startedNoOpen : W.started)(page, log)}\n`);
    assert.equal(out.chunks.stderr, '');
    // The mark names the started review's process, so a second start finds it while it runs.
    assert.deepEqual(JSON.parse(await readFile(join(state, 'background', BACKGROUND_MARK), 'utf8')), { pid: 4242 });
    await rm(join(state, 'background', BACKGROUND_MARK));
  }
});

test('D142: --background says each outcome before the start in one line on stdout, and exits 0', async (t) => {
  const h = await home(t);
  const run = async (argv, startReview = never('a background review')) => {
    const out = streams();
    const code = await runSessionReviewCommand(argv, { ...h.options, ...out, loadSession: never('the load'),
      startReview });
    assert.equal(code, 0);
    assert.equal(out.chunks.stderr, '');
    assert.equal(out.chunks.stdout.split('\n').length, 2, out.chunks.stdout);
    return out.chunks.stdout;
  };
  const failed = (code, matches = null) => `${SESSION_ID_WORDS.failed(code, REVIEW_FIX_WORDS[code])}${matches
    ? ` ${SESSION_ID_WORDS.matches(matches)}` : ''}\n`;
  assert.equal(await run(['--session', ID, '--background']), failed('session_id_not_found'));
  const a = await claudeRecording(h.projects, '-a', ID, [user(ID, 'x')]);
  const b = await claudeRecording(h.projects, '-b', ID, [user(ID, 'x')]);
  assert.equal(await run(['--session', ID, '--background']), failed('session_id_ambiguous', [a, b]));
  // A compressed Codex rollout: its path on the line, so the fix words' "that file" is named.
  const coldId = '019a1b2c-3d4e-7f50-8a9b-000000000003';
  const cold = await codexRollout(h.codex, ['sessions', '2026', '10', '23'], `rollout-2026-10-23T09-00-00-${coldId}.jsonl.zst`);
  assert.equal(await run(['--session', coldId, '--background']), failed('session_id_compressed', [cold]));
  // Any review of the recording while it asks the model (its review lock, held by a live process).
  const one = await claudeRecording(h.projects, '-repo', OTHER, [user(OTHER, 'x')]);
  const state = stateFolderOf(h, one);
  await mkdir(join(state, 'review'), { recursive: true });
  await writeFile(join(state, 'review', 'active.lock'), JSON.stringify({ pid: process.pid, startedAt: 'x', nonce: 'y' }));
  assert.equal(await run(['--session', OTHER, '--background']), failed('review_in_progress'));
  await rm(join(state, 'review', 'active.lock'));
  // A review that --background started, in any phase (here its load: it holds no review lock): its mark names its
  // running process, so a second start says it is in progress and starts nothing.
  let started = 0;
  const live = async () => { started++; return process.pid; };
  assert.match(await run(['--session', OTHER, '--background'], live), /^Sonah started a review/);
  assert.equal(started, 1);
  assert.equal(await run(['--session', OTHER, '--background'], live), failed('review_in_progress'));
  assert.equal(started, 1, 'no second review starts');
  // A mark left by a review that ended (its process is gone) is taken back: the next start starts.
  const gone = spawnSync(process.execPath, ['-e', '0']).pid;
  await writeFile(join(state, 'background', BACKGROUND_MARK), JSON.stringify({ pid: gone }));
  assert.match(await run(['--session', OTHER, '--background'], async () => { started++; return 4343; }),
    /^Sonah started a review/);
  assert.equal(started, 2);
  assert.deepEqual(JSON.parse(await readFile(join(state, 'background', BACKGROUND_MARK), 'utf8')), { pid: 4343 });
  // A start that fails leaves no mark behind.
  await rm(join(state, 'background', BACKGROUND_MARK));
  const out = streams();
  assert.equal(await runSessionReviewCommand(['--session', OTHER, '--background'], { ...h.options, ...out,
    startReview: async () => { throw Object.assign(new Error('spawn failed'), { code: 'ENOENT' }); } }), 0);
  assert.equal(out.chunks.stdout, `${SESSION_ID_WORDS.failed('review_failed', REVIEW_FIX_DEFAULT)}\n`);
  await assert.rejects(readFile(join(state, 'background', BACKGROUND_MARK)), { code: 'ENOENT' });
});

test('D142: the detached start runs sonah in its own process group with its output in the log, and returns its pid',
  async (t) => {
    const h = await home(t);
    const log = join(h.dir, 'start.log');
    const pid = await startDetachedReview({ argv: ['--version'], cwd: h.repo, env: process.env, log });
    assert.ok(Number.isSafeInteger(pid) && pid > 0);
    // Detached: the child leads a process group of its own (signal 0 to the group -pid reaches it), so the session that
    // ran it can end without ending it.
    let grouped = false;
    try { process.kill(-pid, 0); grouped = true; } catch (error) { grouped = error.code === 'EPERM'; }
    assert.equal(grouped, true, 'the review runs in a process group of its own');
    const version = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
    let text = '';
    for (let i = 0; i < 100 && !text.includes(version); i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      text = await readFile(log, 'utf8');
    }
    assert.equal(text, `${version}\n`);
    assert.equal(((await stat(log)).mode & 0o777), 0o600);
    await assert.rejects(startDetachedReview({ argv: ['--version'], cwd: h.repo, env: process.env, log }),
      { code: 'EEXIST' }, 'a log that exists is never written over');
  });

test('D142: a review by session id hands the code step the recording\'s end at the start', async (t) => {
  const h = await home(t);
  const file = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'Read the parser.'),
    call(ID, 'r1', 'Read', { file_path: '/repo/src/parser.js' }), result(ID, 'r1', 'parser text')]);
  const sizeAtStart = (await stat(file)).size;
  const seen = [];
  const out = streams();
  assert.equal(await runSessionReviewCommand(['--session', ID, '--dry-run', '--code-pass', '--backend', 'claude-cli'], {
    ...h.options, ...out, createJudge: never('a judge'),
    // The session goes on right after the start: a row the code step's window must not end at.
    freeze: async (...args) => { const frozen = await freezeRecordings(...args);
      await appendFile(file, lines([user(ID, 'later', '2026-10-23T11:00:00.000Z')])); return frozen; },
    readCode: async (session, options) => { seen.push(options); return { root: false, plan: [], files: [] }; } }), 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].recording, file);
  assert.equal(seen[0].recordingBytes, sizeAtStart);
});

// ------------------------------------------------------------------------------------------------ the frozen read

test('D142: a frozen read reads the recording as it was at the start, whatever is written after', async (t) => {
  const h = await home(t);
  const file = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'Read the parser.'),
    call(ID, 'r1', 'Read', { file_path: '/repo/src/parser.js' }), result(ID, 'r1', 'parser text')]);
  const load = (frozen = null) => loadRecordedSessionWithHash({ parent: file, codexHome: h.codex,
    claudeProjects: h.projects, ...(frozen ? { frozen } : {}) });
  const atStart = await load();
  const frozen = await freezeRecordings(file, { adapter: 'claude', codexHome: h.codex });
  // The session goes on: a new ask and a write, then a row still being written (no newline yet).
  await appendFile(file, lines([user(ID, 'Now write the tests too.', '2026-10-23T10:05:00.000Z'),
    call(ID, 'w1', 'Write', { file_path: '/repo/test/parser.test.js', content: 'x' }, '2026-10-23T10:05:01.000Z')])
    + JSON.stringify(user(ID, 'half a row')).slice(0, 40));
  const later = await load(frozen);
  assert.equal(later.hash, atStart.hash, 'the same slice_hash as a read taken at the start');
  assert.notEqual((await load()).hash, atStart.hash, 'a read to the end of the file reads the rows written later');
  // A row being written when the review started: cut at the last whole line.
  const growing = await claudeRecording(h.projects, '-repo', OTHER, [user(OTHER, 'Read the parser.')]);
  const whole = await loadRecordedSessionWithHash({ parent: growing, codexHome: h.codex, claudeProjects: h.projects });
  await appendFile(growing, JSON.stringify(user(OTHER, 'half')).slice(0, 30));
  const partial = await freezeRecordings(growing, { adapter: 'claude', codexHome: h.codex });
  assert.equal((await loadRecordedSessionWithHash({ parent: growing, codexHome: h.codex, claudeProjects: h.projects,
    frozen: partial })).hash, whole.hash);
});

// A parent that launched Agents, whose helper recordings Claude Code writes beside it (child-recordings.test.js).
const AGENT = '0123456789abcdef', LATE = 'fedcba9876543210';
const launch = (id, agentId) => [call(ID, id, 'Agent', { prompt: `Brief for ${agentId}.` }),
  result(ID, id, `Async agent launched.\nagentId: ${agentId}\nUse SendMessage to reach it.`)];
const helperRow = (agentId, extra) => rowOf(ID, { agentId, isSidechain: true, ...extra });
const helperRows = (agentId, path) => [helperRow(agentId, { type: 'user', message: { role: 'user', content: 'Brief.' } }),
  helperRow(agentId, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: `${agentId}-w`,
    name: 'Write', input: { file_path: path, content: 'v1' } }] } })];
async function withHelpers(h, { launched = [AGENT], written = [AGENT] } = {}) {
  const nested = join(h.projects, '-repo', ID, 'subagents');
  await mkdir(nested, { recursive: true });
  const parent = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'Delegate the migration.'),
    ...launched.flatMap((agentId, i) => launch(`spawn-${i}`, agentId))]);
  const fileOf = (agentId) => join(nested, `agent-${agentId}.jsonl`);
  for (const agentId of written) await writeFile(fileOf(agentId), lines(helperRows(agentId, `/repo/src/${agentId}.js`)),
    { mode: 0o600 });
  return { parent, fileOf };
}
const hashOf = (raw) => sliceHash(redact(raw).ledger);
const statuses = (raw) => (raw.delegations ?? []).map((d) => [d.childId ?? null, d.status]);

test('D142: a frozen read reads a linked helper as it was at the start too', async (t) => {
  const h = await home(t);
  const { parent, fileOf } = await withHelpers(h);
  const roots = { recordingRoots: { claude: h.projects } };
  const paths = (ledger) => ledger.children?.[0]?.ledger.ledger.map((e) => e.path);
  const atStart = await loadSessionEvidence([parent], roots);
  assert.deepEqual(statuses(atStart), [[AGENT, 'linked']]);
  assert.deepEqual(paths(atStart), [`src/${AGENT}.js`]);
  const frozen = await freezeRecordings(parent, { adapter: 'claude' });
  // The helper goes on after the start: another write, and a row still being written.
  await appendFile(fileOf(AGENT), lines([helperRow(AGENT, { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'c2', name: 'Write', input: { file_path: '/repo/src/later.js', content: 'v2' } }] } })])
    + '{"type":"assi');
  const later = await loadSessionEvidence([parent], { ...roots, frozen });
  assert.deepEqual(statuses(later), [[AGENT, 'linked']]);
  assert.deepEqual(paths(later), [`src/${AGENT}.js`], 'the helper as it was at the start');
  assert.equal(hashOf(later), hashOf(atStart));
  // Read to its end, the helper is another one now (its row being written is no whole row: no link).
  assert.notEqual(hashOf(await loadSessionEvidence([parent], roots)), hashOf(atStart));
});

test('D142: a helper the parent launched before the start, whose recording begins after it, is not read', async (t) => {
  const h = await home(t);
  const { parent, fileOf } = await withHelpers(h, { launched: [AGENT, LATE], written: [AGENT] });
  const roots = { recordingRoots: { claude: h.projects } };
  const atStart = await loadSessionEvidence([parent], roots);
  assert.deepEqual(statuses(atStart).map(([id, status]) => [id, status === 'linked']), [[AGENT, true], [LATE, false]]);
  const frozen = await freezeRecordings(parent, { adapter: 'claude' });
  await writeFile(fileOf(LATE), lines(helperRows(LATE, '/repo/src/late.js')), { mode: 0o600 });
  // Read now, the late helper links; read as at the start, it does not, and nothing else moves.
  assert.deepEqual(statuses(await loadSessionEvidence([parent], roots)), [[AGENT, 'linked'], [LATE, 'linked']]);
  const later = await loadSessionEvidence([parent], { ...roots, frozen });
  assert.deepEqual(statuses(later), statuses(atStart));
  assert.equal(hashOf(later), hashOf(atStart));
});

test('D142: a helper recording that is shorter than at the start is not read as it is now', async (t) => {
  const h = await home(t);
  const { parent, fileOf } = await withHelpers(h);
  const roots = { recordingRoots: { claude: h.projects } };
  const frozen = await freezeRecordings(parent, { adapter: 'claude' });
  // The helper's recording is cut to its first row, which ends with a newline: a read now would read one whole row.
  await truncate(fileOf(AGENT), lines(helperRows(AGENT, `/repo/src/${AGENT}.js`).slice(0, 1)).length);
  const later = await loadSessionEvidence([parent], { ...roots, frozen });
  assert.notEqual(later.delegations[0].status, 'linked', 'a recording shorter than at the start is not read');
  assert.equal(later.children, undefined);
});

test('D142: a root recording read as a helper\'s (its rows are a sidechain) is read as it was at the start', async (t) => {
  const h = await home(t);
  const file = await claudeRecording(h.projects, '-repo', ID, helperRows(AGENT, '/repo/src/a.js'));
  const roots = { recordingRoots: { claude: h.projects } };
  const atStart = await loadSessionEvidence([file], roots);
  const frozen = await freezeRecordings(file, { adapter: 'claude' });
  await appendFile(file, lines([helperRow(AGENT, { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'w9', name: 'Write', input: { file_path: '/repo/src/b.js', content: 'x' } }] } })]));
  assert.notEqual(hashOf(await loadSessionEvidence([file], roots)), hashOf(atStart));
  assert.equal(hashOf(await loadSessionEvidence([file], { ...roots, frozen })), hashOf(atStart));
});

// A session that opens on a compaction continues an earlier recording of its folder (d135-growing-earlier.test.js).
const crow = (sid, extra) => ({ sessionId: sid, cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false,
  userType: 'external', timestamp: '2026-10-20T10:00:00.000Z', ...extra });
const chuman = (sid, uuid, parentUuid, text) => crow(sid, { type: 'user', uuid, parentUuid, origin: { kind: 'human' },
  promptSource: 'typed', message: { role: 'user', content: text } });
const csaid = (sid, uuid, parentUuid, text) => crow(sid, { type: 'assistant', uuid, parentUuid,
  message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });
const cboundary = (sid, uuid, linked) => crow(sid, { type: 'system', subtype: 'compact_boundary', uuid, parentUuid: null,
  logicalParentUuid: linked, content: 'Conversation compacted', level: 'info',
  compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 100 } });
const csummary = (sid, uuid, parentUuid) => crow(sid, { type: 'user', uuid, parentUuid, isCompactSummary: true,
  isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary.' } });
const EARLIER = [chuman(OTHER, 'ask0', null, 'ask number 0'), csaid(OTHER, 'last0', 'ask0', 'answer 0'),
  cboundary(OTHER, 'b1', 'last0'), csummary(OTHER, 'sum1', 'b1')];
const CONTINUING = [cboundary(ID, 'b1', 'last0'), csummary(ID, 'sum1', 'b1'), csaid(ID, 'last0', 'sum1', 'answer 0'),
  chuman(ID, 'ask1', 'last0', 'ask number 1'), csaid(ID, 'last1', 'ask1', 'answer 1')];

test('D142: the search for the recordings a session continues takes no candidate that was not there at the start',
  async (t) => {
    const h = await home(t);
    const later = await claudeRecording(h.projects, '-repo', ID, CONTINUING);
    const load = (frozen = null) => loadRecordedSessionWithHash({ parent: later, codexHome: h.codex,
      claudeProjects: h.projects, ...(frozen ? { frozen } : {}) });
    const atStart = await load();
    assert.equal(atStart.recordings.length, 1, 'no earlier recording at the start');
    const frozen = await freezeRecordings(later, { adapter: 'claude' });
    await claudeRecording(h.projects, '-repo', OTHER, EARLIER);
    assert.equal((await load()).recordings.length, 2, 'read now, the session continues the new recording');
    const again = await load(frozen);
    assert.equal(again.recordings.length, 1);
    assert.equal(again.hash, atStart.hash);
    // Not a candidate at all, so the part before the compaction is missing, as at the start, never "unread".
    assert.deepEqual(again.session.continued, atStart.session.continued);
    assert.equal(atStart.session.continued.unread, 'earlier_recording_missing');
  });

test('D142: a recording that opened on a compaction only after the start is not read as continued', async (t) => {
  const h = await home(t);
  await claudeRecording(h.projects, '-repo', OTHER, EARLIER);
  // At the start the new recording is empty: Claude Code has made the file and written no whole row yet.
  const later = await claudeRecording(h.projects, '-repo', ID, []);
  await writeFile(later, '');
  const load = (frozen = null) => loadRecordedSessionWithHash({ parent: later, codexHome: h.codex,
    claudeProjects: h.projects, ...(frozen ? { frozen } : {}) });
  const atStart = await load();
  const frozen = await freezeRecordings(later, { adapter: 'claude' });
  await appendFile(later, lines(CONTINUING));
  assert.equal((await load()).recordings.length, 2, 'read now, it continues the earlier recording');
  const again = await load(frozen);
  assert.equal(again.recordings.length, 1);
  assert.equal(again.hash, atStart.hash);
});

test('D142: a Codex helper rollout is read as it was at the start', async (t) => {
  const h = await home(t);
  const day = join(h.codex, 'sessions', '2026', '09', '23');
  await mkdir(day, { recursive: true });
  const response = (payload) => ({ type: 'response_item', payload });
  const rootId = '019a0000-0000-7000-8000-00000000a001', childId = '019a0000-0000-7000-8000-00000000a002';
  const root = join(day, `rollout-2026-09-23T12-00-00-${rootId}.jsonl`);
  const child = join(day, `rollout-2026-09-23T12-00-01-${childId}.jsonl`);
  await writeFile(root, lines([{ type: 'session_meta', payload: { id: rootId, cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Review the change.' }),
    response({ type: 'function_call', name: 'collaboration.spawn_agent', call_id: 'spawn-1',
      arguments: JSON.stringify({ task_name: 'worker', message: 'Write child.js', fork_turns: 'none' }) }),
    response({ type: 'function_call_output', call_id: 'spawn-1', output: JSON.stringify({ task_name: '/root/worker' }) })]
    .map((row, ordinal) => ({ ordinal, ...row }))));
  const patch = (name) => `*** Begin Patch\n*** Add File: ${name}\n+const checked = true;\n*** End Patch`;
  const childRows = [{ type: 'session_meta', payload: { id: childId, cwd: '/repo', multi_agent_version: 'v2',
    source: { subagent: { thread_spawn: { parent_thread_id: rootId, agent_path: '/root/worker' } } } } },
  response({ type: 'message', role: 'user', content: 'Agent brief.' }),
  response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'edit-1', input: patch('child.js') }),
  response({ type: 'custom_tool_call_output', call_id: 'edit-1', output: 'Done.' })];
  await writeFile(child, lines(childRows.map((row, ordinal) => ({ ordinal, ...row }))));
  const roots = { recordingRoots: { codex: join(h.codex, 'sessions') } };
  const atStart = await loadSessionEvidence([root], roots);
  assert.equal(atStart.delegations[0].status, 'linked');
  const frozen = await freezeRecordings(root, { adapter: 'codex', codexHome: h.codex });
  await appendFile(child, lines([response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'edit-2',
    input: patch('later.js') }), response({ type: 'custom_tool_call_output', call_id: 'edit-2', output: 'Done.' })]
    .map((row, i) => ({ ordinal: childRows.length + i, ...row }))));
  assert.notEqual(hashOf(await loadSessionEvidence([root], roots)), hashOf(atStart));
  const later = await loadSessionEvidence([root], { ...roots, frozen });
  assert.equal(later.delegations[0].status, 'linked');
  assert.equal(hashOf(later), hashOf(atStart));
});

// A Workflow run (m33-w-workflow-fixture.js): the parent's launch, its journal and its agents' recordings.
async function workflowTree(t, run) {
  const dir = await WF.scratch('sonah-d142-wf-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const runDir = join(dir, 'projects', WF.SLUG, WF.SID, 'subagents', 'workflows', WF.RUN);
  const tree = await WF.writeTree(dir, { parent: WF.parentRows({ workflows: [WF.workflowRows({ transcriptDir: runDir })] }),
    run: { session: WF.SID, runId: WF.RUN, ...run } });
  const codex = join(dir, 'codex-sessions');
  await mkdir(codex, { recursive: true });
  const load = (frozen = null) => loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex }, ...(frozen ? { frozen } : {}) });
  return { tree, runDir, load };
}
const agentsOf = (raw) => (raw.delegations ?? []).filter((d) => d.kind === 'workflow-agent')
  .map((d) => [d.childId, d.finalAnswer?.text ?? null, raw.children?.[d.link?.source]?.ledger?.ledger?.length ?? null]);

test('D142: a Workflow run is read as it was at the start: its journal, and its agents\' recordings', async (t) => {
  const { AGENTS, RESULTS, started, resulted, fixerRows, testerRows, jsonl } = WF;
  // The journal grows after the start: the tester's result is not read.
  {
    const w = await workflowTree(t, { journal: [started(AGENTS.fixer), started(AGENTS.tester),
      resulted(AGENTS.fixer, RESULTS.fixer)], agents: { [AGENTS.fixer]: fixerRows(), [AGENTS.tester]: testerRows() } });
    const atStart = await w.load();
    const frozen = await freezeRecordings(w.tree.parent, { adapter: 'claude' });
    await appendFile(join(w.runDir, 'journal.jsonl'), `${resulted(AGENTS.tester, RESULTS.tester)}\n`);
    assert.notEqual(hashOf(await w.load()), hashOf(atStart));
    const later = await w.load(frozen);
    assert.deepEqual(agentsOf(later), agentsOf(atStart));
    assert.equal(hashOf(later), hashOf(atStart));
  }
  // An agent's recording that begins after the start is not one of the run's: the tester stays without a recording.
  {
    const w = await workflowTree(t, { journal: [started(AGENTS.fixer), started(AGENTS.tester)],
      agents: { [AGENTS.fixer]: fixerRows() } });
    const atStart = await w.load();
    const frozen = await freezeRecordings(w.tree.parent, { adapter: 'claude' });
    await writeFile(join(w.runDir, `agent-${AGENTS.tester}.jsonl`), jsonl(testerRows()), { mode: 0o600 });
    assert.notEqual(hashOf(await w.load()), hashOf(atStart));
    const later = await w.load(frozen);
    assert.deepEqual(agentsOf(later), agentsOf(atStart));
    assert.equal(hashOf(later), hashOf(atStart));
  }
  // Both go on together: the fixer's edit and its report in the journal come after the start. Read as at the start, no
  // report is attached to a recording that holds only the agent's brief.
  {
    const w = await workflowTree(t, { journal: [started(AGENTS.fixer)], agents: { [AGENTS.fixer]: fixerRows().slice(0, 1) } });
    const atStart = await w.load();
    const frozen = await freezeRecordings(w.tree.parent, { adapter: 'claude' });
    await appendFile(join(w.runDir, `agent-${AGENTS.fixer}.jsonl`), jsonl(fixerRows().slice(1)));
    await appendFile(join(w.runDir, 'journal.jsonl'), `${resulted(AGENTS.fixer, RESULTS.fixer)}\n`);
    const later = await w.load(frozen);
    assert.deepEqual(agentsOf(later), agentsOf(atStart));
    assert.equal(agentsOf(later)[0]?.[1] ?? null, null, 'no report from after the start');
    assert.equal(hashOf(later), hashOf(atStart));
  }
  // A journal that begins after the start is not the run's: the run has none, as at the start (never "unreadable").
  {
    const w = await workflowTree(t, { journal: null, agents: { [AGENTS.fixer]: fixerRows() } });
    const atStart = await w.load();
    const frozen = await freezeRecordings(w.tree.parent, { adapter: 'claude' });
    await writeFile(join(w.runDir, 'journal.jsonl'), `${started(AGENTS.fixer)}\n${resulted(AGENTS.fixer, RESULTS.fixer)}\n`);
    assert.notEqual(hashOf(await w.load()), hashOf(atStart));
    const later = await w.load(frozen);
    assert.deepEqual(later.workflowRuns, atStart.workflowRuns);
    assert.equal(hashOf(later), hashOf(atStart));
  }
  // An agent's recording that is shorter than at the start cannot be read as it was: it is not linked.
  {
    const w = await workflowTree(t, { journal: [started(AGENTS.fixer), resulted(AGENTS.fixer, RESULTS.fixer)],
      agents: { [AGENTS.fixer]: fixerRows() } });
    assert.equal(agentsOf(await w.load()).length, 1);
    const frozen = await freezeRecordings(w.tree.parent, { adapter: 'claude' });
    await truncate(join(w.runDir, `agent-${AGENTS.fixer}.jsonl`), jsonl(fixerRows().slice(0, 1)).length);
    assert.deepEqual(agentsOf(await w.load(frozen)), []);
  }
});

test('D142: the earlier session file that proves a copied Workflow call is read as it was at the start', async (t) => {
  const { AGENTS, SID, SID_COPIED, SLUG, copiedRows, fixerRows, jsonl, linkedRun, parentRows, testerRows, workflowRows }
    = WF;
  const dir = await WF.scratch('sonah-d142-copy-');
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const runDir = join(dir, 'projects', SLUG, SID_COPIED, 'subagents', 'workflows', WF.RUN);
  const callRows = workflowRows({ sessionId: SID_COPIED, transcriptDir: runDir });
  const earlierRows = parentRows({ sessionId: SID_COPIED, workflows: [callRows] });
  const tree = await WF.writeTree(dir, { parent: parentRows({ workflows: [copiedRows(callRows, SID)] }),
    run: { ...linkedRun({ session: SID_COPIED }), agents: { [AGENTS.fixer]: fixerRows({ sessionId: SID_COPIED }),
      [AGENTS.tester]: testerRows({ sessionId: SID_COPIED }) } } });
  // At the start the earlier session file holds only its first row: it does not yet record the copied call.
  const earlier = join(tree.slugDir, `${SID_COPIED}.jsonl`);
  await writeFile(earlier, jsonl(earlierRows.slice(0, 1)), { mode: 0o600 });
  const codex = join(dir, 'codex-sessions');
  await mkdir(codex, { recursive: true });
  const load = (frozen = null) => loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex }, ...(frozen ? { frozen } : {}) });
  const atStart = await load();
  assert.deepEqual(agentsOf(atStart), []);
  const frozen = await freezeRecordings(tree.parent, { adapter: 'claude' });
  await appendFile(earlier, jsonl(earlierRows.slice(1)));
  assert.equal(agentsOf(await load()).length, 2, 'read now, the file proves the copy and the run links');
  const later = await load(frozen);
  assert.deepEqual(agentsOf(later), []);
  assert.equal(hashOf(later), hashOf(atStart));
  // The same file, not there at all at the start: a frozen read reads no file that was not there then.
  await rm(earlier);
  const noneAtStart = await load();
  const frozenNone = await freezeRecordings(tree.parent, { adapter: 'claude' });
  await writeFile(earlier, jsonl(earlierRows), { mode: 0o600 });
  assert.equal(agentsOf(await load()).length, 2);
  const afterNone = await load(frozenNone);
  assert.deepEqual(agentsOf(afterNone), []);
  assert.equal(hashOf(afterNone), hashOf(noneAtStart));
});

test('D142: the code step reads the recording\'s start and end through the same bound', async (t) => {
  const h = await home(t);
  const file = await claudeRecording(h.projects, '-repo', ID, [user(ID, 'first', '2026-10-23T10:00:00.000Z'),
    user(ID, 'second', '2026-10-23T10:01:00.000Z')]);
  const frozen = await freezeRecordings(file, { adapter: 'claude' });
  await appendFile(file, lines([user(ID, 'third', '2026-10-23T10:09:00.000Z')]));
  const end = await frozen.endOf(file);
  assert.equal(await recordingEnd(file, { byteEnd: end }), '2026-10-23T10:01:00.000Z');
  assert.equal(await recordingEnd(file), '2026-10-23T10:09:00.000Z');
  assert.equal((await recordingStart(file, { byteEnd: end })).at, '2026-10-23T10:00:00.000Z');
  assert.equal(await recordingEnd(file, { byteEnd: 0 }), null);
});

test('D142: the code step\'s window ends where the recording ended at the start', async (t) => {
  // A repository whose file changed after the session's last row at the start, and before a row written later: inside
  // the window read to the end of the recording, outside it read as at the start (D113's window, code-snapshot.js).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d142-code-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'pipe', env: { ...Object.fromEntries(Object
    .entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
    GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  git(['init', '-q', '-b', 'main']);
  await writeFile(join(root, 'notes.md'), 'old\n');
  git(['add', '-A']); git(['commit', '-q', '-m', 'base']);
  await writeFile(join(root, 'notes.md'), 'changed by a command\n');
  await utimes(join(root, 'notes.md'), new Date('2030-01-01T00:20:00Z'), new Date('2030-01-01T00:20:00Z'));
  const recording = join(root, '..', `${root.split('/').pop()}-rec.jsonl`);
  t.after(() => rm(recording, { force: true }));
  await writeFile(recording, lines([{ timestamp: '2030-01-01T00:00:00.000Z' }, { timestamp: '2030-01-01T00:10:00.000Z' }]));
  const recordingBytes = (await stat(recording)).size;
  await appendFile(recording, lines([{ timestamp: '2030-01-01T00:30:00.000Z' }]));
  const session = buildCodeSession('s-d142-window', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask',
    turn: 'T1' }, { id: 'B1', kind: 'invocation', command: 'node build.js', blob: 'wrote', turn: 'T1' },
  { id: 'C1', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);
  const inChange = async (bound) => (await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording,
    ...(bound ? { recordingBytes } : {}) })).files.map((f) => f.path);
  assert.deepEqual(await inChange(false), ['notes.md'], 'read to its end, the window holds the change');
  assert.deepEqual(await inChange(true), [], 'read as at the start, the change came after the window');
});
