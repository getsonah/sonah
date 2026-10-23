// D143: from commits to sessions. `sonah sessions --commits A..B` lists the sessions that the range's Agent-Session
// lines name; `sonah review --commits A..B` reviews one. The link of each commit (the owner's default, 2026-10-23):
// "shown in the recording" only when one tool call of the session it names spans the commit's committer time, by the
// recording's own timestamps, and that call ran in a folder of the same repository; else "named by the commit only";
// else "not on this computer". A recording here is never said to be missing: two with one id, or one compressed, are
// named as such. Throwaway repositories and synthetic recordings (Claude Code rows and a Codex rollout,
// shaped as each writes them), commit times fixed with GIT_COMMITTER_DATE. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMIT_SESSION_GIT_ARGS, COMMIT_SESSION_WORDS, commitGitAllowed, commitRangeShape, commitSessionLines,
  commitsOf, gitWithInput, sessionsOfCommits, sessionsOfPullRequest, spans } from '../src/commit-sessions.js';
import { runGit } from '../src/code-snapshot.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { runSessionsCommand } from '../src/session-discovery.js';
import { REVIEW_FIX_WORDS, runSessionReviewCommand } from '../src/session-review-command.js';
import { CLI_SAFE_ERROR_CODES, COMMIT_RECORDING_STATES, COMMIT_SESSION_LINKS, COMMITS_PROBLEMS }
  from '../../evidence/src/ledger.js';

const S1 = '11111111-2222-4333-8444-555555555555';
const S2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const S3 = '33333333-3333-4333-8333-333333333333';
const S4 = '44444444-4444-4444-8444-444444444444';
const S5 = '55555555-5555-4555-8555-555555555555';
const CX = '01a091c7-46e5-7032-8000-000000000001';
const T0 = Date.parse('2030-01-01T10:00:00.000Z') / 1000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
/** The range's git argv for `range`. */
const rangeArgs = (range) => COMMIT_SESSION_GIT_ARGS[0].map((word) => (word === '<range>' ? range : word));

function sealedEnv(home) {
  const keep = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:GIT_|CLAUDE_CODE_|CODEX_)/.test(k)));
  return { ...keep, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_NOSYSTEM: '1', LANG: 'C',
    GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic',
    GIT_COMMITTER_EMAIL: 's@example.invalid', GIT_EDITOR: 'false' };
}

async function sandbox(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sonah d143 2b ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const projects = join(root, 'projects');
  const codex = join(root, 'codex');
  await mkdir(home); await mkdir(projects); await mkdir(codex);
  const env = sealedEnv(home);
  const g = (dir, args, extra = {}) => {
    const r = spawnSync('git', args, { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const repo = async (name) => {
    const dir = join(root, name);
    await mkdir(dir);
    g(dir, ['init', '-q', '-b', 'main']);
    g(dir, ['commit', '-q', '--allow-empty', '-m', 'base'], { GIT_COMMITTER_DATE: `@${T0 - 3600} +0000` });
    return dir;
  };
  /** An empty commit at a fixed committer time, with this message. */
  const commit = (dir, message, at) => {
    g(dir, ['commit', '-q', '--allow-empty', '-m', message], { GIT_COMMITTER_DATE: `@${at} +0000`,
      GIT_AUTHOR_DATE: `@${at} +0000` });
    return g(dir, ['rev-parse', 'HEAD']);
  };
  /** A Claude Code recording `<projects>/<folder>/<id>.jsonl` (or a helper's under `<id>/subagents/`) whose tool calls
   *  run from `start` to `end` (seconds) in `cwd`, each with `output` as its result. */
  const claude = async (id, calls, { cwd, helper = null, folder = 'p' } = {}) => {
    const rows = [{ type: 'user', cwd, sessionId: id, timestamp: iso(T0 - 600), message: { role: 'user', content: 'go' } }];
    calls.forEach(([start, end, output = 'ok', callCwd = cwd], i) => {
      rows.push({ type: 'assistant', cwd: callCwd, sessionId: id, timestamp: iso(start), message: { role: 'assistant',
        content: [{ type: 'tool_use', id: `toolu_${id.slice(0, 4)}_${i}`, name: 'Bash', input: { command: 'git commit' } }] } });
      rows.push({ type: 'user', cwd: callCwd, sessionId: id, timestamp: iso(end), message: { role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `toolu_${id.slice(0, 4)}_${i}`, content: output }] } });
    });
    const dir = helper ? join(projects, folder, id, 'subagents') : join(projects, folder);
    await mkdir(dir, { recursive: true });
    const file = join(dir, helper ? `agent-${helper}.jsonl` : `${id}.jsonl`);
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  };
  /** A Codex rollout of `id` under `<codex>/sessions/2030/01/01/`, whose turn runs in `cwd`, with one call per
   *  `[start, end, workdir]` (`workdir` left out when undefined); `zst` names the file `.jsonl.zst`. */
  const codexRollout = async (id, calls, { cwd, zst = false } = {}) => {
    const rows = [{ timestamp: iso(T0 - 600), type: 'session_meta', payload: { id, cwd: '/elsewhere' } },
      { timestamp: iso(T0 - 599), type: 'turn_context', payload: { cwd } }];
    calls.forEach(([start, end, workdir], i) => {
      rows.push({ timestamp: iso(start), type: 'response_item', payload: { type: 'function_call', name: 'exec_command',
        call_id: `call_${i}`, arguments: JSON.stringify({ cmd: 'git commit', ...(workdir === undefined ? {} : { workdir }) }) } });
      rows.push({ timestamp: iso(end), type: 'response_item', payload: { type: 'function_call_output', call_id: `call_${i}`,
        output: 'ok' } });
    });
    const day = join(codex, 'sessions', '2030', '01', '01');
    await mkdir(day, { recursive: true });
    const file = join(day, `rollout-2030-01-01T10-00-00-${id}.jsonl${zst ? '.zst' : ''}`);
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return file;
  };
  const roots = { claude: projects, codex };
  return { root, home, env, g, repo, commit, claude, codexRollout, roots, projects, codex };
}

test('the closed lists, the git argv shapes, the range\'s shape and the span\'s seconds', () => {
  assert.deepEqual(COMMIT_SESSION_LINKS, ['shown', 'named', 'not_here']);
  assert.deepEqual(COMMIT_RECORDING_STATES, ['one', 'several', 'compressed', 'none']);
  assert.deepEqual(Object.keys(COMMIT_SESSION_WORDS.link), COMMIT_SESSION_LINKS);
  assert.deepEqual(COMMITS_PROBLEMS, ['commits_range_unreadable', 'commits_no_session', 'commits_choose_one',
    'session_not_on_this_computer']);
  for (const code of COMMITS_PROBLEMS) {
    assert.ok(CLI_SAFE_ERROR_CODES.includes(code), code);
    assert.equal(typeof REVIEW_FIX_WORDS[code], 'string', code);
  }
  // The range's read, the common dir of a folder, a commit's presence, and one message's trailers: four shapes.
  assert.equal(COMMIT_SESSION_GIT_ARGS.length, 4);
  assert.ok(!commitGitAllowed(['rev-parse', '--show-toplevel']));
  assert.ok(commitGitAllowed(['cat-file', '-e', `${'a'.repeat(40)}^{commit}`]));
  assert.ok(!commitGitAllowed(['cat-file', '-e', 'HEAD^{commit}']));
  assert.ok(commitGitAllowed(['-c', 'trailer.separators=:', '-c', 'core.commentChar=#', 'interpret-trailers', '--parse',
    '--no-divider']));
  assert.ok(!commitGitAllowed(['interpret-trailers', '--parse', '--no-divider']), 'never without the trailer rules');
  assert.ok(!commitGitAllowed(['interpret-trailers', '--in-place', '--no-divider']));
  for (const range of ['main..HEAD', 'v1.2..feature/x', '..HEAD', 'main..']) assert.ok(commitRangeShape(range), range);
  for (const range of ['main...HEAD', 'HEAD', '-n1..HEAD', 'a..b..c', 'a ..b', '', '..']) assert.ok(!commitRangeShape(range), range);
  // The range's read turns off signatures and asks for UTF-8, whatever the person's git config says.
  assert.deepEqual(rangeArgs('main..HEAD').slice(0, 2), ['-c', 'log.showSignature=false']);
  assert.ok(rangeArgs('main..HEAD').includes('--encoding=UTF-8'));
  assert.ok(commitGitAllowed(rangeArgs('main..HEAD')));
  assert.ok(!commitGitAllowed(rangeArgs('--all')));
  assert.ok(!commitGitAllowed(['log', '-z', rangeArgs('x..y').find((w) => w.startsWith('--format=')), 'main..HEAD', '--']));
  assert.ok(!commitGitAllowed(['log', '--format=%B', 'main..HEAD', '--']));
  // A call spans a commit made from the second of its row through the second of its result's row, each truncated, as
  // git truncates a commit's time: never the second after.
  const call = { start: T0 * 1000 + 999, end: (T0 + 5) * 1000 + 999 };
  assert.deepEqual([T0 - 1, T0, T0 + 5, T0 + 6].map((t) => spans(call, t)), [false, true, true, false]);
  assert.deepEqual([T0 + 5, T0 + 6].map((t) => spans({ start: T0 * 1000, end: (T0 + 5) * 1000 }, t)), [true, false]);
});

test('each commit is shown, named only or not on this computer, by both facts', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('my repo');
  const other = await s.repo('other repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  const c2 = s.commit(repo, `two, amended later\n\nAgent-Session: ${S1}`, T0 + 600);
  const c3 = s.commit(repo, `three\n\nAgent-Session: ${S2}`, T0 + 1200);
  const c4 = s.commit(repo, `four\n\nAgent-Session: ${S3}`, T0 + 1800);
  // S1: one call spans c1's time in this repository; none spans c2's.
  const f1 = await s.claude(S1, [[T0 - 2, T0 + 1], [T0 + 300, T0 + 310]], { cwd: repo });
  // S2: a call spans c3's time, but it ran in another repository.
  await s.claude(S2, [[T0 + 1199, T0 + 1201]], { cwd: other });
  // S3: no recording here.
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual([found.total, found.naming, found.unusable], [4, 4, 0]);
  const byId = Object.fromEntries(found.sessions.map((x) => [x.id, x]));
  assert.deepEqual(found.sessions.map((x) => x.id), [S3, S2, S1], 'the order of their newest commits');
  assert.deepEqual([byId[S1].state, byId[S1].recording.file, byId[S1].files], ['one', f1, [f1]]);
  assert.deepEqual(byId[S1].commits, [{ hash: c2, link: 'named' }, { hash: c1, link: 'shown' }]);
  assert.deepEqual(byId[S2].commits, [{ hash: c3, link: 'named' }]);
  assert.deepEqual([byId[S3].state, byId[S3].recording, byId[S3].files, byId[S3].commits],
    ['none', null, [], [{ hash: c4, link: 'not_here' }]]);
  // The same repository, another folder of it (a linked worktree shares the git common dir): shown.
  const wt = join(s.root, 'my repo wt');
  s.g(repo, ['worktree', 'add', '-q', '-b', 'wt', wt]);
  const c5 = s.commit(wt, `five\n\nAgent-Session: ${S4}`, T0 + 2400);
  await s.claude(S4, [[T0 + 2399, T0 + 2400]], { cwd: wt });
  const fromWt = await sessionsOfCommits('main..wt', { cwd: repo, roots: s.roots });
  assert.deepEqual(fromWt.sessions.find((x) => x.id === S4).commits, [{ hash: c5, link: 'shown' }]);
  // The folder of the call that spans the commit counts, not the folder of the session's first call.
  const c6 = s.commit(wt, `six\n\nAgent-Session: ${S5}`, T0 + 3000);
  await s.claude(S5, [[T0 + 100, T0 + 101, 'ok', other], [T0 + 2999, T0 + 3001, 'ok', wt]], { cwd: other });
  const moved = await sessionsOfCommits('main..wt', { cwd: repo, roots: s.roots });
  assert.deepEqual(moved.sessions.find((x) => x.id === S5).commits, [{ hash: c6, link: 'shown' }]);
});

test('a spanning call in no repository, with no folder, or in another repository by its workdir: named', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  const other = await s.repo('other');
  const plain = join(s.root, 'plain folder');
  await mkdir(plain);
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `in a plain folder\n\nAgent-Session: ${S1}`, T0);
  const c2 = s.commit(repo, `with no folder\n\nAgent-Session: ${S2}`, T0 + 100);
  const c3 = s.commit(repo, `by codex, in another repository\n\nAgent-Session: ${CX}`, T0 + 200);
  // The only calls that span each commit's time ran in a folder in no repository, or name no folder.
  await s.claude(S1, [[T0 - 1, T0 + 1, 'ok', plain]], { cwd: repo });
  await s.claude(S2, [[T0 + 99, T0 + 101, 'ok', null]], { cwd: repo });
  // Codex: the turn runs in this repository, and the call's workdir is another one.
  await s.codexRollout(CX, [[T0 + 199, T0 + 201, other]], { cwd: repo });
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(found.sessions.map((x) => [x.id, x.commits]), [[CX, [{ hash: c3, link: 'named' }]],
    [S2, [{ hash: c2, link: 'named' }]], [S1, [{ hash: c1, link: 'named' }]]]);
  // The same Codex call with no workdir runs in the turn's folder, this repository: shown.
  await s.codexRollout(CX, [[T0 + 199, T0 + 201]], { cwd: repo });
  const turn = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(turn.sessions[0].commits, [{ hash: c3, link: 'shown' }]);
});

test('two sessions in one repository: a call of one never shows the other\'s commit', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  // S2's commit, typed in a terminal at T0+50, inside a long call of S1 that also made S1's own commit.
  const b = s.commit(repo, `typed\n\nAgent-Session: ${S2}`, T0 + 50);
  const a = s.commit(repo, `by S1\n\nAgent-Session: ${S1}`, T0 + 100);
  await s.claude(S1, [[T0 + 40, T0 + 110]], { cwd: repo });
  await s.claude(S2, [[T0 - 100, T0 - 90]], { cwd: repo });
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(found.sessions.map((x) => [x.id, x.commits]), [[S1, [{ hash: a, link: 'shown' }]],
    [S2, [{ hash: b, link: 'named' }]]]);
});

test('a commit\'s abbreviation in a call\'s output is no link; only the time and the repository are', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c = s.commit(repo, `typed by hand\n\nAgent-Session: ${S5}`, T0 + 5000);
  // The recording prints git's summary with this commit's abbreviation, in a call long before the commit.
  await s.claude(S5, [[T0, T0 + 1, `[work ${c.slice(0, 7)}] typed by hand\n${c.slice(0, 12)}`]], { cwd: repo });
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(found.sessions[0].commits, [{ hash: c, link: 'named' }]);
});

test('ids from git\'s trailer reader and from whole lines of a squashed message; other values counted', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  // A squash keeps the earlier commits' lines as body text; git's trailer reader reads only the last block.
  const squash = `squashed\n\n* first\n\nAgent-Session: ${S1}\n\n* second\n\nmore words\n\nAgent-Session: ${S2}`;
  s.commit(repo, squash, T0);
  // A key in another case, read by git's trailer reader; an id in upper case, as `--session` takes it; a value that is
  // no id, counted and not listed.
  const upper = 'cccccccc-dddd-4eee-8fff-000000000000';
  s.commit(repo, `cased\n\nagent-session: ${S3}\nAgent-Session: not-a-session\nAgent-Session: ${upper.toUpperCase()}`,
    T0 + 10);
  // A line in a paragraph that is no trailer block and not a whole line of its own: no id.
  s.commit(repo, `prose\n\nWe noted Agent-Session: ${S5} in the notes.`, T0 + 20);
  const { commits } = await commitsOf('main..work', { cwd: repo });
  assert.deepEqual(commits.map((c) => [c.ids, c.values, c.unusable]), [[[], 0, 0], [[S3, upper], 3, 1],
    [[S2, S1], 2, 0]]);
  const messages = s.g(repo, ['log', '--format=%B', 'main..work']).toLowerCase();
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  for (const session of found.sessions) assert.ok(messages.includes(session.id), session.id);
  assert.deepEqual([found.sessions.map((x) => x.id), found.naming, found.unusable], [[S3, upper, S2, S1], 2, 1]);
});

test('the person\'s git config changes nothing of the read: signatures, encoding, trailer rules, colour', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  // Repository-local settings only (never the person's own config). Signed commits when ssh-keygen is here.
  const key = join(s.root, 'key');
  const signing = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key, '-C', 's@example.invalid'],
    { encoding: 'utf8' }).status === 0;
  if (signing) {
    await writeFile(join(s.root, 'allowed'), `s@example.invalid ${(await import('node:fs')).readFileSync(`${key}.pub`, 'utf8')}`);
    for (const [k, v] of [['gpg.format', 'ssh'], ['user.signingkey', `${key}.pub`], ['commit.gpgSign', 'true'],
      ['gpg.ssh.allowedSignersFile', join(s.root, 'allowed')]]) s.g(repo, ['config', '--local', k, v]);
  }
  const c1 = s.commit(repo, `café\n\nagent-session: ${S1}`, T0);
  const c2 = s.commit(repo, `two\n\nAgent-Session: ${S2}`, T0 + 10);
  s.g(repo, ['notes', 'add', '-m', 'a note', c2]);
  for (const [k, v] of [['log.showSignature', 'true'], ['color.ui', 'always'], ['i18n.logOutputEncoding', 'ISO-8859-1'],
    ['trailer.separators', '='], ['core.commentChar', ';'], ['log.decorate', 'full'], ['format.pretty', 'oneline'],
    ['notes.displayRef', 'refs/notes/*'], ['log.abbrevCommit', 'true'], ['log.showRoot', 'true']])
    s.g(repo, ['config', '--local', k, v]);
  const { commits } = await commitsOf('main..work', { cwd: repo });
  // Full ids, and the lower-case key that only git's trailer reader reads, with `trailer.separators` set to `=`.
  assert.deepEqual(commits.map((c) => [c.hash, c.ids]), [[c2, [S2]], [c1, [S1]]]);
});

test('a helper\'s recording under the session, and a Codex rollout, show their commits', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `by a helper\n\nAgent-Session: ${S1}`, T0 + 100);
  const c2 = s.commit(repo, `by codex\n\nAgent-Session: ${CX}`, T0 + 200);
  await s.claude(S1, [], { cwd: repo });
  await s.claude(S1, [[T0 + 99, T0 + 101]], { cwd: repo, helper: 'a1' });
  await s.codexRollout(CX, [[T0 + 199, T0 + 200]], { cwd: repo });
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(found.sessions.map((x) => [x.id, x.recording.adapter, x.commits]), [
    [CX, 'codex', [{ hash: c2, link: 'shown' }]], [S1, 'claude', [{ hash: c1, link: 'shown' }]]]);
});

test('two recordings with one id, or one compressed: each named as it is, never missing, through both commands', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  const c2 = s.commit(repo, `two\n\nAgent-Session: ${CX}`, T0 + 10);
  const p1 = await s.claude(S1, [[T0 - 1, T0 + 1]], { cwd: repo, folder: 'p1' });
  const p2 = await s.claude(S1, [[T0 - 1, T0 + 1]], { cwd: repo, folder: 'p2' });
  const zst = await s.codexRollout(CX, [[T0 + 9, T0 + 11]], { cwd: repo, zst: true });
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots });
  assert.deepEqual(found.sessions.map((x) => [x.id, x.state, x.recording, x.files, x.commits]), [
    [CX, 'compressed', null, [zst], [{ hash: c2, link: 'named' }]],
    [S1, 'several', null, [p1, p2], [{ hash: c1, link: 'named' }]]]);
  const W = COMMIT_SESSION_WORDS;
  assert.deepEqual(commitSessionLines(found), [W.heading('main..work', 2, 2), W.session(1, CX, zst), `   ${W.compressed}`,
    `   ${W.commits(W.commit(c2.slice(0, 12), W.link.named))}`, W.session(2, S1, W.several),
    `   ${W.recordings(`${p1}, ${p2}`)}`, `   ${W.commits(W.commit(c1.slice(0, 12), W.link.named))}`, W.claim]);
  // The review stops with D142's code and the files, never with session_not_on_this_computer.
  const env = { ...s.env, SONAH_HOME: join(s.home, '.sonah'), SONAH_CLAUDE_PROJECTS: s.projects, CODEX_HOME: s.codex };
  for (const [choose, code, files] of [['1', 'session_id_compressed', [zst]], ['2', 'session_id_ambiguous', [p1, p2]],
    [undefined, 'commits_choose_one', []]]) {
    let out = '', err = '';
    const code2 = await runSessionReviewCommand(['--commits', 'main..work', ...(choose ? ['--choose', choose] : []),
      '--dry-run'], { cwd: repo, env, installSignals: false, stdout: { write: (x) => { out += x; } },
      stderr: { write: (x) => { err += x; } } });
    assert.equal(code2, 2, err);
    assert.match(err, new RegExp(`Review could not complete: ${code}\\.`));
    assert.ok(!err.includes('session_not_on_this_computer'), err);
    for (const file of files) assert.ok(err.includes(file), `${code} names ${file}`);
    assert.ok(out.includes(W.session(2, S1, W.several)), 'the list first');
  }
});

test('sonah sessions --commits prints each session, its commits and their links, and a review line', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  s.commit(repo, 'no line', T0 + 5);
  const c3 = s.commit(repo, `three\n\nAgent-Session: ${S3}`, T0 + 10);
  const file = await s.claude(S1, [[T0 - 1, T0 + 1]], { cwd: repo });
  const run = async (argv) => {
    let out = '', err = '';
    const code = await runSessionsCommand(argv, { claudeProjects: s.projects, codexHome: s.codex,
      stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } } });
    return { code, out, err };
  };
  const W = COMMIT_SESSION_WORDS;
  let r = await run(['--commits', 'main..work', '--repo', repo]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [W.heading('main..work', 2, 3), W.session(1, S3, W.link.not_here),
    `   ${W.commits(W.commit(c3.slice(0, 12), W.link.not_here))}`, W.session(2, S1, file),
    `   ${W.commits(W.commit(c1.slice(0, 12), W.link.shown))}`, `   ${W.review(S1)}`, W.claim].join('\n') + '\n');
  r = await run(['--repo', repo, '--commits', 'work..main']);
  assert.deepEqual([r.code, r.out], [1, `${W.none('work..main', 0)}\n`]);
  // Lines whose value is no session id: counted and said, never read as no line at all.
  s.g(repo, ['checkout', '-q', '-b', 'odd', 'main']);
  s.commit(repo, 'odd\n\nAgent-Session: not-a-session\nAgent-Session: 12345', T0 + 20);
  r = await run(['--repo', repo, '--commits', 'main..odd']);
  assert.deepEqual([r.code, r.out], [1, `${W.none('main..odd', 1)}\n${W.unusable(2)}\n`]);
  assert.equal(W.unusable(2), '2 Agent-Session lines carry a value that is not a session id, so Sonah lists no session '
    + 'for them.');
  r = await run(['--repo', repo, '--commits', 'main..nowhere']);
  assert.equal(r.code, 2);
  assert.match(r.err, /Git could not list the commits in main\.\.nowhere/);
  for (const argv of [['--commits'], ['--commits', 'HEAD'], ['--commits', 'a...b'], ['--commits', 'a..b', '--commits', 'a..b'],
    ['--repo', repo, '--repo', repo], ['--choose', '1']]) {
    r = await run(argv);
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /^usage: sonah sessions \[--repo DIR\] \[--commits A\.\.B \| --github OWNER\/REPO --pr N\]/);
  }
});

test('sonah review --commits reviews the one session here, or the --choose N of the list, or says why not', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  s.commit(repo, `two\n\nAgent-Session: ${S3}`, T0 + 10);
  await s.claude(S1, [[T0 - 1, T0 + 1]], { cwd: repo });
  const env = { ...s.env, SONAH_HOME: join(s.home, '.sonah'), SONAH_CLAUDE_PROJECTS: s.projects, CODEX_HOME: s.codex };
  const review = async (argv, cwd = repo) => {
    let out = '', err = '';
    const asked = [];
    // The review stops at the recording: the id it would review is what this test reads.
    const code = await runSessionReviewCommand(argv, { cwd, env, installSignals: false,
      stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } },
      resolveSession: async (id) => { asked.push(id); throw Object.assign(new Error('session_id_not_found'), { code: 'session_id_not_found' }); } });
    return { code, out, err, asked };
  };
  let r = await review(['--commits', 'main..work', '--dry-run']);
  assert.deepEqual(r.asked, [S1], 'the one session whose recording is here');
  // --repo names the range's repository, from a folder outside it.
  r = await review(['--commits', 'main..work', '--repo', repo, '--dry-run'], s.root);
  assert.deepEqual(r.asked, [S1], 'the session of --repo\'s range');
  r = await review(['--commits', 'main..work', '--choose', '2', '--dry-run']);
  assert.deepEqual(r.asked, [S1]);
  r = await review(['--commits', 'main..work', '--choose', '1', '--dry-run']);
  assert.deepEqual([r.code, r.asked], [2, []]);
  assert.match(r.err, /session_not_on_this_computer/);
  assert.ok(r.out.includes(COMMIT_SESSION_WORDS.session(1, S3, COMMIT_SESSION_WORDS.link.not_here)), 'the list first');
  r = await review(['--commits', 'main..work', '--choose', '3', '--dry-run']);
  assert.match(r.err, /commits_choose_one/);
  // Two sessions here and no --choose: the list, then the code.
  await s.claude(S3, [[T0 + 9, T0 + 11]], { cwd: repo });
  r = await review(['--commits', 'main..work', '--dry-run']);
  assert.deepEqual([r.code, r.asked], [2, []]);
  assert.match(r.err, /commits_choose_one/);
  assert.match(r.err, new RegExp(REVIEW_FIX_WORDS.commits_choose_one.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  r = await review(['--commits', 'work..main', '--dry-run']);
  assert.match(r.err, /commits_no_session/);
  r = await review(['--commits', 'main..nowhere', '--dry-run']);
  assert.match(r.err, /commits_range_unreadable/);
  for (const [argv, problem] of [[['x.jsonl', '--commits', 'main..work'], /recording path or --commits/],
    [['--session', S1, '--commits', 'main..work'], /--session ID or --commits/], [['--commits', 'HEAD'], /takes a range/]]) {
    r = await review(argv);
    assert.equal(r.code, 2);
    assert.match(r.err, problem);
  }
});

test('every git argv that the reads run is one of the allowlisted shapes', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  const other = await s.repo('other');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c1 = s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  await s.claude(S1, [[T0 - 1, T0 + 1, 'ok', other], [T0 - 1, T0 + 1]], { cwd: repo });
  const asked = [];
  const run = (args, options) => {
    asked.push(args);
    return commitGitAllowed(args) ? runGit(args, options) : Promise.resolve({ ok: false, stdout: null });
  };
  const input = (args, message, options) => { asked.push(args); return gitWithInput(args, message, options); };
  const found = await sessionsOfCommits('main..work', { cwd: repo, roots: s.roots, run });
  assert.deepEqual(found.sessions[0].commits, [{ hash: c1, link: 'shown' }]);
  const client = { async request({ path }) {
    if (path === '/repos/o/r/pulls/7') return { status: 200, headers: {}, data: { number: 7, commits: 2,
      base: { sha: 'b'.repeat(40), repo: { id: 1, private: false, name: 'r', owner: { login: 'o' } } },
      head: { sha: c1 } } };
    return { status: 200, headers: {}, data: [{ sha: c1, commit: { message: `one\n\nAgent-Session: ${S1}`,
      committer: { date: iso(T0) } } }, { sha: 'e'.repeat(40), commit: { message: 'x', committer: { date: iso(T0) } } }] };
  } };
  const pr = await sessionsOfPullRequest({ owner: 'o', repo: 'r', number: 7 }, { cwd: repo, roots: s.roots, client,
    run, input });
  assert.deepEqual(pr.sessions[0].commits, [{ hash: c1, link: 'shown' }]);
  for (const args of asked) assert.ok(commitGitAllowed(args), JSON.stringify(args));
  assert.deepEqual([...new Set(asked.map((args) => args.find((w, i) => !w.startsWith('-') && args[i - 1] !== '-c')))]
    .sort(), ['cat-file', 'interpret-trailers', 'log', 'rev-parse']);
});

test('the list\'s words: each listed id, its commits by abbreviation and link, and the claim the line makes', () => {
  const lines = commitSessionLines({ range: 'a..b', total: 2, naming: 1, unusable: 0, sessions: [{ id: S1, state: 'several',
    recording: null, files: ['/r/p1/s.jsonl', '/r/p2/s.jsonl'], commits: [{ hash: 'f'.repeat(40), link: 'named' }] }] });
  assert.deepEqual(lines, [COMMIT_SESSION_WORDS.heading('a..b', 1, 2), COMMIT_SESSION_WORDS.session(1, S1,
    COMMIT_SESSION_WORDS.several), '   recordings: /r/p1/s.jsonl, /r/p2/s.jsonl',
  `   ${COMMIT_SESSION_WORDS.commits(`${'f'.repeat(12)} named by the commit only`)}`, COMMIT_SESSION_WORDS.claim]);
});

test('an empty CODEX_HOME is unset, as review reads it: the list finds the rollout that review --session finds', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  const c = s.commit(repo, `by codex\n\nAgent-Session: ${CX}`, T0 + 200);
  // The rollout sits in the home's own .codex; CODEX_HOME is set, and empty.
  const codexHome = join(s.home, '.codex');
  const day = join(codexHome, 'sessions', '2030', '01', '01');
  await mkdir(day, { recursive: true });
  const file = join(day, `rollout-2030-01-01T10-00-00-${CX}.jsonl`);
  await writeFile(file, [{ timestamp: iso(T0), type: 'session_meta', payload: { id: CX, cwd: repo } },
    { timestamp: iso(T0 + 199), type: 'response_item', payload: { type: 'function_call', name: 'exec_command',
      call_id: 'call_1', arguments: '{}' } },
    { timestamp: iso(T0 + 200), type: 'response_item', payload: { type: 'function_call_output', call_id: 'call_1',
      output: 'ok' } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  let out = '';
  const code = await runSessionsCommand(['--commits', 'main..work', '--repo', repo], { claudeProjects: s.projects,
    env: { ...s.env, CODEX_HOME: '' }, stdout: { write: (x) => { out += x; } }, stderr: { write: () => {} } });
  assert.equal(code, 0);
  const W = COMMIT_SESSION_WORDS;
  assert.ok(out.includes(W.session(1, CX, file)), out);
  assert.ok(out.includes(`   ${W.commits(W.commit(c.slice(0, 12), W.link.shown))}`), out);
});

test('review --commits reads the session it picks as review --session does: through the frozen read', async (t) => {
  const s = await sandbox(t);
  const repo = await s.repo('repo');
  s.g(repo, ['checkout', '-q', '-b', 'work']);
  s.commit(repo, `one\n\nAgent-Session: ${S1}`, T0);
  const file = await s.claude(S1, [[T0 - 1, T0 + 1]], { cwd: repo });
  const env = { ...s.env, SONAH_HOME: join(s.home, '.sonah'), SONAH_CLAUDE_PROJECTS: s.projects, CODEX_HOME: s.codex };
  const seen = [];
  let err = '';
  const code = await runSessionReviewCommand(['--commits', 'main..work', '--dry-run', '--no-code-pass'], { cwd: repo, env,
    installSignals: false, stdout: { write: () => {} }, stderr: { write: (x) => { err += x; } },
    loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async (input) => { seen.push(input); return loadRecordedSessionWithHash(input); },
    createJudge: () => assert.fail('a judge must not run') });
  assert.equal(code, 0, err);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].parent, file);
  assert.equal(typeof seen[0].frozen?.endOf, 'function', 'a review by commits is a frozen read');
});
