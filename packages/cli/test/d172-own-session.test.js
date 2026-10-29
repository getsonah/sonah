// D172: `sonah review` given no path, no --session, no --commits and no --choose, run inside Claude Code, reviews the
// session it runs in: the one recording that CLAUDE_CODE_SESSION_ID names (D142's rule), only when that recording is
// one of the repository's discovered sessions, read as it was at the start (D142's frozen read). Else the newest, as
// before, byte for byte. The variable is read from the environment the command is given, never from process.env.
// Every fixture is synthetic and written to a private temporary folder; no real recording is read, no reviewer called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { discoverSessions } from '../src/session-discovery.js';
import { resolveSessionId } from '../src/session-id.js';
import { CONTINUED_RECORDING_WORDS, SESSION_ID_WORDS, parseSessionReviewArgs, runSessionReviewCommand,
  sessionReviewUsage } from '../src/session-review-command.js';

const ID = '3f2a9c1e-5b7d-4e2f-9a1b-0c3d4e5f6a7b';
const OTHER = '0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a';
const NONE = 'b1111111-1111-4111-8111-111111111111';
const EARLIER = 'c2222222-2222-4222-8222-222222222222';
const CODEX_ID = '019a1b2c-3d4e-7f50-8a9b-0c1d2e3f4a5b';

const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};
const rowOf = (sid, cwd, extra) => ({ sessionId: sid, cwd, version: '2.1.308', isSidechain: false,
  timestamp: '2026-10-28T10:00:00.000Z', ...extra });
const user = (sid, cwd, text) => rowOf(sid, cwd, { type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const call = (sid, cwd, id, name, input) => rowOf(sid, cwd, { type: 'assistant', timestamp: '2026-10-28T10:00:01.000Z',
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (sid, cwd, id, content) => rowOf(sid, cwd, { type: 'user', timestamp: '2026-10-28T10:00:02.000Z',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const lines = (rows) => rows.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** A home with Claude Code's projects folder, a Codex home and two folders that are no git repository, `repo` and
 *  `elsewhere`; the options a review needs (an environment of its own, with no CLAUDE_CODE_SESSION_ID). */
async function home(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d172-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'claude', 'projects'), codex = join(dir, 'codex');
  const repo = join(dir, 'repo'), elsewhere = join(dir, 'elsewhere');
  for (const folder of [projects, codex, repo, elsewhere]) await mkdir(folder, { recursive: true });
  const env = { HOME: dir, SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: codex, CLAUDE_CONFIG_DIR: join(dir, 'claude') };
  return { dir, projects, codex, repo, elsewhere, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
/** A Claude Code recording of `cwd` under `<projects>/<slug>/<id>.jsonl`, written at `at` seconds (its mtime). */
async function recording(h, slug, id, cwd, at) {
  await mkdir(join(h.projects, slug), { recursive: true });
  const file = join(h.projects, slug, `${id}.jsonl`);
  await writeFile(file, lines([user(id, cwd, 'Read the parser.'), call(id, cwd, 'r1', 'Read', { file_path: `${cwd}/a.js` }),
    result(id, cwd, 'r1', 'parser text')]), { mode: 0o600 });
  await utimes(file, at, at);
  return file;
}
/** The repository's two sessions: the agent's own (ID), and a newer one (OTHER) that the newest pick takes. */
async function twoSessions(h) {
  const own = await recording(h, '-repo', ID, h.repo, 1_800_000_000);
  const newer = await recording(h, '-repo', OTHER, h.repo, 1_800_000_100);
  return { own, newer };
}
const never = (what) => () => assert.fail(`${what} must not run`);
/** A dry run of the session alone, recording what the load is given and how often discovery and the resolver run. */
async function dryRun(h, argv, env = h.env, extra = {}) {
  const seen = { loads: [], discovered: 0, resolved: [] };
  const out = streams();
  const code = await runSessionReviewCommand([...argv, '--dry-run', '--no-code-pass'], { ...h.options, env, ...out,
    createJudge: never('a judge'),
    discover: async (input) => { seen.discovered++; return discoverSessions(input); },
    resolveSession: async (id, roots) => { seen.resolved.push(id); return resolveSessionId(id, roots); },
    loadSession: async (input) => { seen.loads.push(input); return loadRecordedSessionWithHash(input); }, ...extra });
  return { code, stdout: out.chunks.stdout, stderr: out.chunks.stderr, ...seen };
}
const recordingLine = (file) => `Recording: ${file} (claude).\n`;

// ------------------------------------------------------------------------------------------------ the pick

test('D172: inside Claude Code, a review given no path reviews the session it runs in, read as at the start, and says '
  + 'so after the recording\'s line', async (t) => {
  const h = await home(t);
  const { own, newer } = await twoSessions(h);
  // Without the variable, the newest, as before.
  const before = await dryRun(h, []);
  assert.equal(before.code, 0);
  assert.equal(before.loads[0].parent, newer);
  assert.equal(before.loads[0].frozen, undefined);
  assert.ok(before.stdout.startsWith(recordingLine(newer)));
  assert.ok(!before.stdout.includes(SESSION_ID_WORDS.own));
  assert.deepEqual(before.resolved, [], 'no harness variable, no session id resolved');
  // With it, the agent's own recording, through D142's frozen read, and one line that says so.
  const inside = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: ID });
  assert.equal(inside.code, 0);
  assert.equal(inside.loads.length, 1);
  assert.equal(inside.loads[0].parent, own);
  assert.equal(typeof inside.loads[0].frozen?.endOf, 'function', 'the pick is a review by session id: a frozen read');
  assert.ok(inside.stdout.startsWith(`${recordingLine(own)}${SESSION_ID_WORDS.own}\n`), inside.stdout);
  assert.equal(inside.stdout.split(SESSION_ID_WORDS.own).length, 2, 'said once');
  assert.equal(inside.discovered, 1, 'discovery runs once');
  assert.equal(inside.stderr, '');
  // The rest of the dry run is the dry run of the same recording given by --session.
  const named = await dryRun(h, ['--session', ID]);
  assert.equal(inside.stdout, named.stdout.replace(recordingLine(own), `${recordingLine(own)}${SESSION_ID_WORDS.own}\n`));
  // Any case of the id, as --session takes it (D142: kept in lower case).
  const upper = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: ID.toUpperCase() });
  assert.equal(upper.loads[0].parent, own);
  assert.equal(upper.stdout, inside.stdout);
});

test('D172: an id that names no recording of this repository, or not exactly one, leaves the newest pick byte for byte',
  async (t) => {
    const h = await home(t);
    const { newer } = await twoSessions(h);
    // The same name in another project folder, for the ambiguous case; a recording of another folder, for the last.
    const away = await recording(h, '-elsewhere', NONE, h.elsewhere, 1_800_000_200);
    const plain = await dryRun(h, []);
    assert.equal(plain.loads[0].parent, newer);
    const cases = { unset: undefined, empty: '', malformed: 'not-an-id', short: ID.slice(0, -1), none: CODEX_ID,
      otherRepository: NONE };
    for (const [name, value] of Object.entries(cases)) {
      const env = value === undefined ? h.env : { ...h.env, CLAUDE_CODE_SESSION_ID: value };
      const run = await dryRun(h, [], env);
      assert.equal(run.code, plain.code, name);
      assert.equal(run.stdout, plain.stdout, name);
      assert.equal(run.stderr, plain.stderr, name);
      assert.equal(run.loads[0].parent, newer, name);
      assert.equal(run.loads[0].frozen, undefined, name);
      assert.ok(run.discovered <= 1, `${name}: discovery runs once at most`);
    }
    assert.ok(away);
    // Two folders hold ID's name: D142's ambiguous id, so no pick.
    await recording(h, '-a-second-folder', ID, h.repo, 1_800_000_000);
    const ambiguous = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: ID });
    assert.equal(ambiguous.stdout, plain.stdout);
    assert.equal(ambiguous.loads[0].parent, newer);
  });

test('D172: a Codex rollout named by the id is not Claude Code\'s session, so the newest pick stays', async (t) => {
  const h = await home(t);
  const { newer } = await twoSessions(h);
  const day = join(h.codex, 'sessions', '2026', '10', '28');
  await mkdir(day, { recursive: true });
  const rollout = join(day, `rollout-2026-10-28T10-00-00-${CODEX_ID}.jsonl`);
  await writeFile(rollout, lines([{ type: 'session_meta', payload: { id: CODEX_ID, cwd: h.repo } }]), { mode: 0o600 });
  await utimes(rollout, 1_700_000_000, 1_700_000_000);
  const plain = await dryRun(h, []);
  const run = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: CODEX_ID });
  assert.ok((await discoverSessions({ repo: h.repo, claudeProjects: h.projects, codexHome: h.codex })).sessions
    .some((found) => found.file === rollout), 'the rollout is one of the repository\'s sessions');
  assert.equal(run.stdout, plain.stdout);
  assert.equal(run.loads[0].parent, newer);
});

test('D172: with --choose N, a path, --session ID or --commits A..B, the variable changes nothing', async (t) => {
  const h = await home(t);
  const { own, newer } = await twoSessions(h);
  const inside = { ...h.env, CLAUDE_CODE_SESSION_ID: ID };
  for (const [argv, picked] of [[['--choose', '1'], newer], [['--choose', '2'], own], [[newer], newer],
    [['--session', OTHER], newer]]) {
    const run = await dryRun(h, argv, inside);
    const plain = await dryRun(h, argv);
    assert.equal(run.loads[0].parent, picked, argv.join(' '));
    assert.equal(run.stdout, plain.stdout, argv.join(' '));
    assert.ok(!run.resolved.includes(ID) || argv[0] === '--session', argv.join(' '));
    assert.ok(!run.stdout.includes(SESSION_ID_WORDS.own), argv.join(' '));
  }
  // --commits in a folder that is no git repository stops by its own closed code, with or without the variable.
  const commits = await dryRun(h, ['--commits', 'main..HEAD'], inside, { loadSession: never('the load') });
  const plainCommits = await dryRun(h, ['--commits', 'main..HEAD'], h.env, { loadSession: never('the load') });
  assert.deepEqual([commits.code, commits.stdout, commits.stderr], [plainCommits.code, plainCommits.stdout,
    plainCommits.stderr]);
  assert.deepEqual(commits.resolved, []);
});

// D172 fix round: the id's shape is checked before any file is looked for. Discovery lists any `.jsonl` of the
// repository's project folder, so a recording whose file name is no session id can be one of its sessions; a variable
// that names it is still no session id, and the newest stays.
test('D172: a variable of another shape that names a discovered recording leaves the newest pick byte for byte',
  async (t) => {
    const h = await home(t);
    const { newer } = await twoSessions(h);
    const odd = await recording(h, '-repo', 'not-an-id', h.repo, 1_799_999_000);
    assert.ok((await discoverSessions({ repo: h.repo, claudeProjects: h.projects, codexHome: h.codex })).sessions
      .some((found) => found.file === odd), 'the recording named not-an-id is one of the repository\'s sessions');
    const plain = await dryRun(h, []);
    assert.equal(plain.loads[0].parent, newer);
    for (const value of ['not-an-id', 'NOT-AN-ID']) {
      const run = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: value });
      assert.deepEqual([run.code, run.stdout, run.stderr], [plain.code, plain.stdout, plain.stderr], value);
      assert.equal(run.loads[0].parent, newer, value);
      assert.equal(run.loads[0].frozen, undefined, value);
      assert.deepEqual(run.resolved, [], `${value}: no file is looked for`);
    }
  });

// D172 fix round: the id is resolved over both homes, as --session resolves it (judgment call 4), so a Claude Code
// recording and a Codex rollout that carry the same id are D142's ambiguous id: no pick.
test('D172: an id that a Claude Code recording and a Codex rollout both carry is ambiguous, so the newest pick stays',
  async (t) => {
    const h = await home(t);
    const { newer } = await twoSessions(h);
    const day = join(h.codex, 'sessions', '2026', '10', '28');
    await mkdir(day, { recursive: true });
    const rollout = join(day, `rollout-2026-10-28T10-00-00-${ID}.jsonl`);
    await writeFile(rollout, lines([{ type: 'session_meta', payload: { id: ID, cwd: h.elsewhere } }]), { mode: 0o600 });
    await utimes(rollout, 1_700_000_000, 1_700_000_000);
    await assert.rejects(resolveSessionId(ID, { claudeProjects: h.projects, codexHome: h.codex }),
      { code: 'session_id_ambiguous' });
    const plain = await dryRun(h, []);
    const run = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: ID });
    assert.deepEqual(run.resolved, [ID], 'the id was resolved');
    assert.deepEqual([run.code, run.stdout, run.stderr], [plain.code, plain.stdout, plain.stderr]);
    assert.equal(run.loads[0].parent, newer);
    assert.equal(run.loads[0].frozen, undefined);
  });

// D172 fix round: the line is the one right after `Recording: …`, before D126's line for a session that opens on a
// compaction and is read with the recording it continues.
test('D172: on a session that continues an earlier recording, the line comes right after the recording\'s, before '
  + 'the continued one', async (t) => {
    const h = await home(t);
    const at = '2026-10-28T10:00:00.000Z';
    const base = (sid, extra) => rowOf(sid, h.repo, { gitBranch: 'main', userType: 'external', timestamp: at,
      ...extra });
    const ask = (sid, uuid, parentUuid, text) => base(sid, { type: 'user', uuid, parentUuid, origin: { kind: 'human' },
      promptSource: 'typed', message: { role: 'user', content: text } });
    const said = (sid, uuid, parentUuid, text) => base(sid, { type: 'assistant', uuid, parentUuid,
      message: { role: 'assistant', model: 'claude-x', content: [{ type: 'text', text }] } });
    const boundary = (sid) => base(sid, { type: 'system', subtype: 'compact_boundary', uuid: 'b1', parentUuid: null,
      logicalParentUuid: 'last0', content: 'Conversation compacted', level: 'info',
      compactMetadata: { trigger: 'auto', preTokens: 1000, postTokens: 100 } });
    const summary = (sid) => base(sid, { type: 'user', uuid: 'sum1', parentUuid: 'b1', isCompactSummary: true,
      isVisibleInTranscriptOnly: true, message: { role: 'user', content: 'Summary.' } });
    await mkdir(join(h.projects, '-repo'), { recursive: true });
    const earlier = join(h.projects, '-repo', `${EARLIER}.jsonl`), own = join(h.projects, '-repo', `${ID}.jsonl`);
    await writeFile(earlier, lines([ask(EARLIER, 'ask0', null, 'Ask number 0.'),
      said(EARLIER, 'last0', 'ask0', 'Answer 0.'), boundary(EARLIER), summary(EARLIER)]), { mode: 0o600 });
    await writeFile(own, lines([boundary(ID), summary(ID), said(ID, 'last0', 'sum1', 'Answer 0.'),
      ask(ID, 'ask1', 'last0', 'Ask number 1.'), said(ID, 'last1', 'ask1', 'Answer 1.')]), { mode: 0o600 });
    await utimes(earlier, 1_799_000_000, 1_799_000_000);
    await utimes(own, 1_800_000_000, 1_800_000_000);
    const newer = await recording(h, '-repo', OTHER, h.repo, 1_800_000_100);
    const continued = CONTINUED_RECORDING_WORDS.read(1);
    // By --session, the recording's line is followed by the continued one: the fixture is a continued session.
    const named = await dryRun(h, ['--session', ID]);
    assert.equal(named.loads[0].parent, own);
    assert.ok(named.stdout.startsWith(`${recordingLine(own)}${continued}\n`), named.stdout);
    const inside = await dryRun(h, [], { ...h.env, CLAUDE_CODE_SESSION_ID: ID });
    assert.equal(inside.loads[0].parent, own);
    assert.ok(inside.stdout.startsWith(`${recordingLine(own)}${SESSION_ID_WORDS.own}\n${continued}\n`), inside.stdout);
    assert.equal(inside.stdout, named.stdout.replace(recordingLine(own),
      `${recordingLine(own)}${SESSION_ID_WORDS.own}\n`));
    assert.equal((await dryRun(h, [])).loads[0].parent, newer, 'without the variable, the newest');
  });

test('D172: --background still needs --session ID, whatever the variable says', async (t) => {
  const h = await home(t);
  await twoSessions(h);
  assert.throws(() => parseSessionReviewArgs(['--background']), { code: 'usage' });
  const out = streams();
  assert.equal(await runSessionReviewCommand(['--background'], { ...h.options, env: { ...h.env,
    CLAUDE_CODE_SESSION_ID: ID }, ...out, discover: never('discovery'), resolveSession: never('the resolver'),
    loadSession: never('the load'), startReview: never('a background review') }), 2);
  assert.equal(out.chunks.stdout, '');
  assert.match(out.chunks.stderr, /--background needs --session ID/);
});

test('D172: with --repo DIR, the session it runs in is taken only when its recording is one of DIR\'s', async (t) => {
  const h = await home(t);
  const { own } = await twoSessions(h);
  const away = await recording(h, '-elsewhere', NONE, h.elsewhere, 1_800_000_200);
  const inside = { ...h.env, CLAUDE_CODE_SESSION_ID: ID };
  // From the repository, pointed at another: that one's newest, as without the variable.
  const there = await dryRun(h, ['--repo', h.elsewhere], inside);
  assert.equal(there.loads[0].parent, away);
  assert.equal(there.stdout, (await dryRun(h, ['--repo', h.elsewhere])).stdout);
  // From the other folder, pointed at the repository that holds it: the session it runs in.
  const back = await dryRun(h, ['--repo', h.repo], inside, { cwd: h.elsewhere });
  assert.equal(back.loads[0].parent, own);
  assert.ok(back.stdout.startsWith(`${recordingLine(own)}${SESSION_ID_WORDS.own}\n`));
});

test('D172: the pick reviews the recording as its path would: the same requests, slice_hash and state folder',
  async (t) => {
    const h = await home(t);
    const { own } = await twoSessions(h);
    const review = async (argv, env, output) => {
      const sent = [], hashes = [];
      const out = streams();
      const code = await runSessionReviewCommand([...argv, '--no-code-pass', '--output', output], { ...h.options, env,
        ...out, loadSession: async (input) => { const loaded = await loadRecordedSessionWithHash(input);
          hashes.push(loaded.hash); return loaded; },
        createJudge: ({ onResult }) => async (request) => {
          sent.push([request.label ?? null, request.system, request.prompt]);
          onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
          if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key,
            verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [] })) };
          return { decisions: [], pivots: [], claims: [], requirements: [] };
        } });
      return { code, sent, hashes, stdout: out.chunks.stdout };
    };
    const pickHome = { ...h.env, SONAH_HOME: join(h.dir, '.sonah-pick'), CLAUDE_CODE_SESSION_ID: ID };
    const byPath = await review([own], h.env, join(h.dir, 'path.md'));
    const byPick = await review([], pickHome, join(h.dir, 'pick.md'));
    assert.deepEqual([byPath.code, byPick.code], [0, 0]);
    assert.ok(byPath.sent.length > 0);
    assert.deepEqual(byPick.sent, byPath.sent, 'the same requests');
    assert.deepEqual(byPick.hashes, byPath.hashes, 'the same slice_hash: a finished recording reads alike frozen');
    const folder = [createHash('sha256').update(own).digest('hex')];
    assert.deepEqual(await readdir(join(h.env.SONAH_HOME, 'session-reviews')), folder);
    assert.deepEqual(await readdir(join(pickHome.SONAH_HOME, 'session-reviews')), folder, 'the same state folder');
    // In the path's home, the pick replays the path's stored answers: the same answer keys, no request sent.
    const replay = await review([], { ...h.env, CLAUDE_CODE_SESSION_ID: ID }, join(h.dir, 'replay.md'));
    assert.deepEqual([replay.code, replay.sent.length], [0, 0]);
    assert.deepEqual(await readdir(join(h.env.SONAH_HOME, 'session-reviews')), folder);
    assert.ok(byPick.stdout.includes(`${recordingLine(own)}${SESSION_ID_WORDS.own}\n`));
  });

// D172 fix round: the command table of `sonah --help` says the pick too, on the row of a review given no path.
test('D172: sonah --help says a review given no path takes this Claude Code session, else the latest', async (t) => {
  const h = await home(t);
  const bin = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
  const help = spawnSync(process.execPath, [bin, '--help'], { cwd: h.repo, encoding: 'utf8', timeout: 20_000,
    env: { HOME: h.dir, SONAH_HOME: h.env.SONAH_HOME, PATH: '/usr/bin:/bin', SONAH_NO_UPDATE_CHECK: '1' } });
  assert.equal(help.status, 0);
  assert.match(help.stdout, new RegExp('^ {2}sonah review \\[--repo DIR\\] \\[--choose N\\]\\n {31}'
    + 'review this Claude Code session, else the latest$', 'm'));
  assert.doesNotMatch(help.stdout, /review the latest session in this repository/);
  assert.ok(help.stdout.split('\n').every((line) => line.length <= 80));
});

test('D172: the usage says the pick within 80 columns, and the new line is one closed entry', () => {
  const usage = sessionReviewUsage.split('\n');
  assert.deepEqual(usage.slice(1, 3), ['Reviews one recorded session. With no path, it reviews the session that it',
    'runs in (from inside Claude Code), else the latest one of this repository.']);
  assert.ok(usage.every((line) => line.length <= 80));
  assert.equal(typeof SESSION_ID_WORDS.own, 'string');
  assert.ok(Object.isFrozen(SESSION_ID_WORDS));
});
