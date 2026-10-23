// D143: `sonah sessions --github OWNER/REPO --pr N` lists the sessions behind a pull request's commits. The commits
// come from GitHub's list (GET .../pulls/{n}/commits) through Sonah's own client and pager, checked against the pull
// request's own count; each message is read with `git interpret-trailers --parse` and the line scan; the links are a
// range's, in the local repository: a commit this repository does not hold can only be named, or not here. A fake
// client answers every GitHub call: no network. Throwaway repositories and synthetic Claude Code recordings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMMIT_SESSION_FIXES, COMMIT_SESSION_WORDS, messageIds, pullRequestFetchSteps, sessionsOfPullRequest }
  from '../src/commit-sessions.js';
import { runSessionsCommand } from '../src/session-discovery.js';
import { PULL_REQUEST_COMMITS_CAP, readPullRequestCommits } from '../../github/reader.js';

const S1 = '11111111-2222-4333-8444-555555555555';
const S2 = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const S3 = '33333333-3333-4333-8333-333333333333';
const T0 = Date.parse('2030-01-01T10:00:00.000Z') / 1000;
const iso = (seconds) => new Date(seconds * 1000).toISOString();
const BASE = 'b'.repeat(40);
const HEAD = 'c'.repeat(40);
const fakeSha = (n) => n.toString(16).padStart(40, 'e');

/** A fake GitHub client: the pull request's metadata with `count` (`metadata` changes its fields), and `listed`
 *  commits served 100 a page. */
function fakeClient({ count, listed, status = 200, base = BASE, metadata = {} }) {
  const asked = [];
  return { asked, async request({ method, path }) {
    asked.push(`${method} ${path}`);
    if (status !== 200) return { status, headers: {}, data: {} };
    if (path === '/repos/o/r/pulls/7') return { status, headers: {}, data: { number: 7, commits: count,
      base: { sha: base, repo: { id: 1, private: false, name: 'r', owner: { login: 'o' } } }, head: { sha: HEAD },
      ...metadata } };
    const page = /^\/repos\/o\/r\/pulls\/7\/commits\?per_page=100&page=(\d+)$/.exec(path);
    if (page) {
      const n = Number(page[1]);
      return { status, headers: {}, data: listed.slice((n - 1) * 100, n * 100) };
    }
    return { status: 404, headers: {}, data: {} };
  } };
}
const item = (sha, message, time) => ({ sha, commit: { message, committer: { date: iso(time) } } });

async function sandbox(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sonah d143 2c ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const projects = join(root, 'projects');
  const codex = join(root, 'codex');
  await mkdir(home); await mkdir(projects); await mkdir(codex);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(?:GIT_|CLAUDE_CODE_)/.test(k))),
    HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 's', GIT_AUTHOR_EMAIL: 's@example.invalid',
    GIT_COMMITTER_NAME: 's', GIT_COMMITTER_EMAIL: 's@example.invalid' };
  const g = (dir, args, extra = {}) => {
    const r = spawnSync('git', args, { cwd: dir, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const repo = join(root, 'my repo');
  await mkdir(repo);
  g(repo, ['init', '-q', '-b', 'main']);
  const commit = (message, at) => {
    g(repo, ['commit', '-q', '--allow-empty', '-m', message], { GIT_COMMITTER_DATE: `@${at} +0000`, GIT_AUTHOR_DATE: `@${at} +0000` });
    return g(repo, ['rev-parse', 'HEAD']);
  };
  const claude = async (id, calls, cwd) => {
    const rows = [{ type: 'user', cwd, sessionId: id, timestamp: iso(T0 - 600), message: { role: 'user', content: 'go' } }];
    calls.forEach(([start, end], i) => {
      rows.push({ type: 'assistant', cwd, sessionId: id, timestamp: iso(start), message: { role: 'assistant',
        content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'Bash', input: { command: 'git commit' } }] } });
      rows.push({ type: 'user', cwd, sessionId: id, timestamp: iso(end), message: { role: 'user',
        content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, content: 'ok' }] } });
    });
    await mkdir(join(projects, 'p'), { recursive: true });
    await writeFile(join(projects, 'p', `${id}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  };
  return { root, repo, g, commit, claude, roots: { claude: projects, codex }, projects, codex };
}

test('the pull request\'s commits: shown, named or not here, and a commit this repository lacks is never shown', async (t) => {
  const s = await sandbox(t);
  const m1 = `one\n\nAgent-Session: ${S1}`;
  const c1 = s.commit(m1, T0);
  const m2 = `two, not in this repository\n\nAgent-Session: ${S1}`;
  const m3 = `three\n\nAgent-Session: ${S3}`;
  await s.claude(S1, [[T0 - 1, T0 + 1], [T0 + 99, T0 + 101]], s.repo);
  // GitHub lists oldest first; the second commit is not here, though a call of S1 spans its time.
  const client = fakeClient({ count: 3, listed: [item(c1, m1, T0), item(fakeSha(2), m2, T0 + 100), item(fakeSha(3), m3, T0 + 200)] });
  const found = await sessionsOfPullRequest({ owner: 'o', repo: 'r', number: 7 }, { cwd: s.repo, roots: s.roots, client });
  assert.deepEqual([found.range, found.total, found.naming, found.unusable, found.whole, found.count, found.inRepository],
    ['o/r#7', 3, 3, 0, true, 3, true]);
  assert.deepEqual(found.sessions.map((x) => [x.id, x.commits]), [
    [S3, [{ hash: fakeSha(3), link: 'not_here' }]],
    [S1, [{ hash: fakeSha(2), link: 'named' }, { hash: c1, link: 'shown' }]]]);
  assert.deepEqual(client.asked, ['GET /repos/o/r/pulls/7', 'GET /repos/o/r/pulls/7/commits?per_page=100&page=1'],
    'only GET, only the pull request and its commits');
});

test('each message is read with git interpret-trailers --parse and the line scan; each id appears as written', async (t) => {
  const s = await sandbox(t);
  const message = `squashed\n\n* one\n\nAgent-Session: ${S1}\n\n* two\n\nagent-session: ${S2}\nAgent-Session: not-an-id`;
  assert.deepEqual(await messageIds(message, { cwd: s.repo }), { ids: [S2, S1], values: 3, unusable: 1 });
  assert.deepEqual((await messageIds(`prose\n\nWe noted Agent-Session: ${S3} here.`, { cwd: s.repo })).ids, []);
  // With no git to parse the trailers, the line scan still reads whole lines.
  const none = async () => ({ ok: false, stdout: null });
  assert.deepEqual((await messageIds(`x\n\nAgent-Session: ${S1}`, { cwd: s.repo, input: none })).ids, [S1]);
  // The person's trailer separators do not hide a trailer from git's parse (a lower-case key only git reads).
  s.g(s.repo, ['config', '--local', 'trailer.separators', '=']);
  assert.deepEqual((await messageIds(`x\n\nagent-session: ${S1}`, { cwd: s.repo })).ids, [S1]);
});

test('past 250 commits GitHub\'s list is not whole: Sonah says so, states no absence, and prints the commands', async (t) => {
  const s = await sandbox(t);
  const listed = Array.from({ length: PULL_REQUEST_COMMITS_CAP }, (_, i) => item(fakeSha(i + 10), `c${i}`, T0 + i));
  const client = fakeClient({ count: 300, listed });
  const read = await readPullRequestCommits({ client, owner: 'o', repo: 'r', number: 7 });
  assert.deepEqual([read.commits.length, read.count, read.whole], [250, 300, false]);
  assert.equal(client.asked.filter((a) => a.includes('/commits')).length, 3, 'three pages of 100, 100 and 50');
  let out = '';
  const code = await runSessionsCommand(['--github', 'o/r', '--pr', '7', '--repo', s.repo], { client,
    claudeProjects: s.projects, codexHome: s.codex, stdout: { write: (x) => { out += x; } }, stderr: { write: () => {} } });
  assert.equal(code, 2, 'the list is not whole: no absence, so not exit 1');
  assert.equal(out, [COMMIT_SESSION_WORDS.notWhole(250, 300), '', `git fetch https://github.com/o/r.git pull/7/head`,
    `sonah sessions --commits ${BASE}..FETCH_HEAD`, '', COMMIT_SESSION_WORDS.noneListed(250)].join('\n') + '\n');
  assert.ok(!out.includes(COMMIT_SESSION_WORDS.none('o/r#7', 250)));
  // A whole list says nothing of it; a list longer than the pull request's count is not whole either.
  const whole = await readPullRequestCommits({ client: fakeClient({ count: 2, listed: listed.slice(0, 2) }), owner: 'o',
    repo: 'r', number: 7 });
  assert.equal(whole.whole, true);
  const longer = await readPullRequestCommits({ client: fakeClient({ count: 1, listed: listed.slice(0, 2) }), owner: 'o',
    repo: 'r', number: 7 });
  assert.equal(longer.whole, false);
});

test('the printed commands, run as printed, read every commit of the pull request in a clone that lacked them', async (t) => {
  const s = await sandbox(t);
  // GitHub's side: a repository whose pull request 7 is at refs/pull/7/head; the clone has main only.
  const up = join(s.root, 'upstream');
  await mkdir(up);
  s.g(up, ['init', '-q', '-b', 'main']);
  s.g(up, ['commit', '-q', '--allow-empty', '-m', 'base'], { GIT_COMMITTER_DATE: `@${T0 - 3600} +0000` });
  const base = s.g(up, ['rev-parse', 'HEAD']);
  s.g(up, ['checkout', '-q', '-b', 'pr']);
  const shas = [];
  for (const [i, at] of [[1, T0 + 10], [2, T0 + 20]].entries()) {
    s.g(up, ['commit', '-q', '--allow-empty', '-m', `c${at[0]}\n\nAgent-Session: ${S1}`],
      { GIT_COMMITTER_DATE: `@${at[1]} +0000`, GIT_AUTHOR_DATE: `@${at[1]} +0000` });
    shas[i] = s.g(up, ['rev-parse', 'HEAD']);
  }
  const bare = join(s.root, 'upstream.git');
  s.g(s.root, ['clone', '-q', '--bare', up, bare]);
  s.g(bare, ['update-ref', 'refs/pull/7/head', shas[1]]);
  s.g(bare, ['branch', '-q', '-D', 'pr']);
  const clone = join(s.root, 'clone');
  s.g(s.root, ['clone', '-q', bare, clone]);
  // The clone reaches GitHub's address here through the bare repository (repository-local config only).
  s.g(clone, ['config', '--local', `url.${pathToFileURL(bare).href}.insteadOf`, 'https://github.com/o/r.git']);
  await s.claude(S1, [[T0 + 9, T0 + 11], [T0 + 19, T0 + 21]], clone);
  const steps = pullRequestFetchSteps({ owner: 'o', repo: 'r', number: 7, baseOid: base }).split('\n');
  assert.deepEqual(steps, ['git fetch https://github.com/o/r.git pull/7/head', `sonah sessions --commits ${base}..FETCH_HEAD`]);
  const [fetch, list] = steps.map((line) => line.split(' '));
  assert.equal(fetch[0], 'git');
  s.g(clone, fetch.slice(1));
  assert.deepEqual(list.slice(0, 2), ['sonah', 'sessions']);
  let out = '';
  const code = await runSessionsCommand([...list.slice(2), '--repo', clone], { claudeProjects: s.projects,
    codexHome: s.codex, stdout: { write: (x) => { out += x; } }, stderr: { write: () => {} } });
  assert.equal(code, 0);
  const W = COMMIT_SESSION_WORDS;
  assert.ok(out.includes(`   ${W.commits(`${W.commit(shas[1].slice(0, 12), W.link.shown)}, ${W.commit(shas[0].slice(0, 12),
    W.link.shown)}`)}`), out);
});

test('GitHub\'s answer is checked: the pull request it names, and its count of commits', async () => {
  const listed = [item(fakeSha(1), 'x', T0)];
  for (const metadata of [{ number: 8 }, { base: { sha: BASE, repo: { id: 1, private: false, name: 'other',
    owner: { login: 'o' } } } }, { commits: undefined }, { commits: -1 }, { commits: '1' }]) {
    await assert.rejects(readPullRequestCommits({ client: fakeClient({ count: 1, listed, metadata }), owner: 'o',
      repo: 'r', number: 7 }), { code: 'github_response_invalid' }, JSON.stringify(metadata));
  }
});

test('a folder in no repository: said first, and no commit is shown', async (t) => {
  const s = await sandbox(t);
  const plain = join(s.root, 'plain');
  await mkdir(plain);
  const c1 = s.commit(`one\n\nAgent-Session: ${S1}`, T0);
  await s.claude(S1, [[T0 - 1, T0 + 1]], s.repo);
  let out = '';
  const code = await runSessionsCommand(['--github', 'o/r', '--pr', '7', '--repo', plain], { client: fakeClient({ count: 1,
    listed: [item(c1, `one\n\nAgent-Session: ${S1}`, T0)] }), claudeProjects: s.projects, codexHome: s.codex,
  stdout: { write: (x) => { out += x; } }, stderr: { write: () => {} } });
  assert.equal(code, 0);
  const W = COMMIT_SESSION_WORDS;
  assert.equal(out.split('\n').slice(0, 2).join('\n'), `${W.noRepository(plain)}\n`);
  assert.ok(out.includes(`   ${W.commits(W.commit(c1.slice(0, 12), W.link.named))}`), out);
});

test('sonah sessions --github OWNER/REPO --pr N: its lines, its usage, and GitHub\'s failures in fixed words', async (t) => {
  const s = await sandbox(t);
  const m1 = `one\n\nAgent-Session: ${S1}`;
  const c1 = s.commit(m1, T0);
  await s.claude(S1, [[T0 - 1, T0 + 1]], s.repo);
  const run = async (argv, client) => {
    let out = '', err = '';
    const code = await runSessionsCommand(argv, { client, claudeProjects: s.projects, codexHome: s.codex,
      stdout: { write: (x) => { out += x; } }, stderr: { write: (x) => { err += x; } } });
    return { code, out, err };
  };
  const W = COMMIT_SESSION_WORDS;
  let r = await run(['--github', 'o/r', '--pr', '7', '--repo', s.repo], fakeClient({ count: 1, listed: [item(c1, m1, T0)] }));
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, [W.heading('o/r#7', 1, 1), W.session(1, S1, join(s.projects, 'p', `${S1}.jsonl`)),
    `   ${W.commits(W.commit(c1.slice(0, 12), W.link.shown))}`, `   ${W.review(S1)}`, W.claim].join('\n') + '\n');
  r = await run(['--github', 'o/r', '--pr', '7', '--repo', s.repo], fakeClient({ count: 1, listed: [], status: 404 }));
  assert.deepEqual([r.code, r.err], [2, `${COMMIT_SESSION_FIXES.githubUnreadable('o/r#7')}\n`]);
  r = await run(['--github', 'o/r', '--pr', '7', '--repo', s.repo], fakeClient({ count: 1,
    listed: [{ sha: 'nope', commit: { message: 'x', committer: { date: iso(T0) } } }] }));
  assert.equal(r.code, 2, 'a response that is not a commit list');
  for (const argv of [['--github', 'o/r'], ['--pr', '7'], ['--github', 'o/r', '--pr', '0'], ['--github', 'o/r/x', '--pr', '7'],
    ['--github', 'o', '--pr', '7'], ['--github', 'o/r', '--pr', '7', '--commits', 'a..b'], ['--github', 'o/r', '--pr', 'x']]) {
    r = await run(argv, fakeClient({ count: 0, listed: [] }));
    assert.equal(r.code, 2, JSON.stringify(argv));
    assert.match(r.err, /^usage: sonah sessions/);
  }
});
