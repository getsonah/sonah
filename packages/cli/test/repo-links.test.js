// The repository's facts for the report's code links (D97): GitHub's documented remote forms only;
// `atHead` by the hash of HEAD's bytes; `goneAtHead` by HEAD's lack of a deleted path; the prefix of a session in a
// subfolder from the snapshot, never the process's folder; whether HEAD and the start commit are on the remote; and every
// git argv one of an allowlist of local reads, so no command can reach the network. A fake git runner; no repository,
// no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { githubRemoteOf, readRepoFacts, outputsInRepository, repoGitAllowed, REPO_FACT_GIT_ARGS }
  from '../src/repo-links.js';
import { gitEnvironment, runGit } from '../src/code-snapshot.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const HEAD = 'a'.repeat(40);
const START = 'b'.repeat(40);

test('D97 (5): githubRemoteOf reads GitHub\'s three documented forms, with and without .git, and nothing else', () => {
  for (const url of ['https://github.com/getsonah/sonah', 'https://github.com/getsonah/sonah.git',
    'git@github.com:getsonah/sonah', 'git@github.com:getsonah/sonah.git', 'ssh://git@github.com/getsonah/sonah',
    'ssh://git@github.com/getsonah/sonah.git'])
    assert.deepEqual(githubRemoteOf(url), { owner: 'getsonah', repo: 'sonah' }, url);
  assert.deepEqual(githubRemoteOf('https://github.com/Some-Org/my.repo_1.git'), { owner: 'Some-Org', repo: 'my.repo_1' });
  for (const url of ['https://gitlab.com/getsonah/sonah.git', 'https://github.example.com/getsonah/sonah.git',
    'git@github.example.com:getsonah/sonah.git', 'http://github.com/getsonah/sonah', 'https://github.com/getsonah',
    'https://github.com/getsonah/sonah/tree/main', 'https://user@github.com/getsonah/sonah', 'github.com/getsonah/sonah',
    'https://github.com/../sonah', 'https://github.com/getsonah/..', 'https://github.com/a b/c', '', null, 42])
    assert.equal(githubRemoteOf(url), null, String(url));
});

/** A fake git: answers from a table keyed by the argv, records every argv it is asked. */
function fakeGit(answers) {
  const asked = [];
  const git = async (args, { cwd } = {}) => {
    asked.push({ args, cwd });
    const key = args.join(' ');
    if (!Object.hasOwn(answers, key)) return { ok: false, stdout: null };
    const value = answers[key];
    return value === false ? { ok: false, stdout: null } : { ok: true, stdout: Buffer.from(value) };
  };
  return { git, asked };
}

async function folders(t) {
  const top = await mkdtemp(join(tmpdir(), 'sonah-repo-links-'));
  t.after(() => rm(top, { recursive: true, force: true }));
  const dir = join(top, 'packages', 'app');
  await mkdir(dir, { recursive: true });
  return { top, dir };
}

test('D97 (6): readRepoFacts — atHead by HEAD\'s bytes, goneAtHead by HEAD\'s lack, the prefix from the snapshot, the push state',
  async (t) => {
  const { top, dir } = await folders(t);
  const codePass = { base: { kind: 'git', commit: START }, files: [
    { path: 'src/a.js', type: 'modified', state: 'shown', sha256: sha256('a\n') },
    { path: 'src/b.js', type: 'added', state: 'shown', sha256: sha256('b now\n') },
    { path: 'src/old.js', type: 'deleted', state: 'deleted' },
    { path: 'src/kept.js', type: 'deleted', state: 'deleted' },
    { path: '../scratch.md', type: 'added', state: 'outside_root' }] };
  const { git, asked } = fakeGit({
    'rev-parse --verify --quiet HEAD^{commit}': `${HEAD}\n`,
    [`cat-file blob ${HEAD}:packages/app/src/a.js`]: 'a\n',
    [`cat-file blob ${HEAD}:packages/app/src/b.js`]: 'b at head\n',
    [`cat-file -e ${HEAD}:packages/app/src/old.js`]: false,
    [`cat-file -e ${HEAD}:packages/app/src/kept.js`]: '',
    remote: 'origin\nfork\n',
    'rev-parse --abbrev-ref --symbolic-full-name @{upstream}': 'fork/main\n',
    'remote get-url fork': 'git@github.com:someone/app-fork.git\n',
    [`branch -r --contains ${HEAD}`]: '  fork/main\n  origin/main\n',
    [`branch -r --contains ${START}`]: '  origin/main\n',
  });
  // The process runs elsewhere: the prefix is the snapshot's working directory under its top folder.
  const facts = await readRepoFacts({ snapshot: { root: true, top, dir, realRoot: dir }, codePass, git });
  assert.deepEqual(facts.repo, { head: HEAD, start: START, prefix: 'packages/app', atHead: ['src/a.js'],
    goneAtHead: ['src/old.js'] });
  assert.deepEqual(facts.github, { owner: 'someone', repo: 'app-fork', remote: 'fork', pushed: true, startPushed: false });
  // Every argv is one of the allowed shapes, run in the repository's top folder.
  for (const { args } of asked) assert.ok(repoGitAllowed(args), args.join(' '));
  assert.ok(asked.every(({ cwd }) => typeof cwd === 'string' && cwd.endsWith(top.split('/').at(-1))));
  // The outside file is never asked about.
  assert.equal(asked.some(({ args }) => args.join(' ').includes('scratch')), false);
});

test('D97 (6): no upstream reads origin, else the only remote; no GitHub remote, no git base and git errors fail closed',
  async (t) => {
  const { top } = await folders(t);
  const snapshot = { root: true, top, dir: top };
  const codePass = { base: { kind: 'git', commit: START }, files: [] };
  const base = { 'rev-parse --verify --quiet HEAD^{commit}': `${HEAD}\n`, [`branch -r --contains ${HEAD}`]: '' };
  let { git } = fakeGit({ ...base, remote: 'origin\nupstream\n', 'remote get-url origin': 'https://github.com/o/r\n' });
  assert.deepEqual((await readRepoFacts({ snapshot, codePass, git })).github,
    { owner: 'o', repo: 'r', remote: 'origin', pushed: false, startPushed: null });
  ({ git } = fakeGit({ ...base, remote: 'mine\n', 'remote get-url mine': 'https://github.com/o/r.git\n' }));
  assert.equal((await readRepoFacts({ snapshot, codePass, git })).github.remote, 'mine');
  ({ git } = fakeGit({ ...base, remote: 'a\nb\n' }));
  assert.equal((await readRepoFacts({ snapshot, codePass, git })).github, null, 'two remotes, neither origin');
  ({ git } = fakeGit({ ...base, remote: 'origin\n', 'remote get-url origin': 'https://gitlab.com/o/r.git\n' }));
  const gitlab = await readRepoFacts({ snapshot, codePass, git });
  assert.equal(gitlab.github, null);
  assert.equal(gitlab.repo.head, HEAD);
  // No commit yet: no head, nothing at HEAD, and nothing pushed.
  ({ git } = fakeGit({ remote: 'origin\n', 'remote get-url origin': 'https://github.com/o/r\n' }));
  const fresh = await readRepoFacts({ snapshot, codePass: { ...codePass, files: [{ path: 'a.js', sha256: sha256('x') }] },
    git });
  assert.deepEqual([fresh.repo.head, fresh.repo.atHead, fresh.github.pushed], [null, [], null]);
  // A git that cannot say whether a commit is on the remote: null, never true.
  ({ git } = fakeGit({ 'rev-parse --verify --quiet HEAD^{commit}': `${HEAD}\n`, remote: 'origin\n',
    'remote get-url origin': 'https://github.com/o/r\n' }));
  assert.equal((await readRepoFacts({ snapshot, codePass, git })).github.pushed, null);
  // No git base, or no snapshot: no repository facts, and no GitHub facts given.
  for (const input of [{ snapshot, codePass: { base: { kind: 'recorded_edits' } } }, { snapshot: null, codePass },
    { snapshot: { root: false }, codePass }])
    assert.deepEqual(await readRepoFacts({ ...input, git: () => assert.fail('no git is run') }),
      { repo: null, github: undefined });
});

test('D97 (6): every argv is in REPO_FACT_GIT_ARGS; a fetch, a push or an option in a slot is refused unrun', () => {
  assert.ok(REPO_FACT_GIT_ARGS.every((shape) => Object.isFrozen(shape)));
  assert.deepEqual(REPO_FACT_GIT_ARGS.map((shape) => shape.slice(0, 2).join(' ')), ['rev-parse --verify',
    'rev-parse --abbrev-ref', 'remote', 'remote get-url', 'cat-file blob', 'cat-file -e', 'branch -r', 'check-ignore -q']);
  for (const args of [['fetch'], ['fetch', 'origin'], ['ls-remote', 'origin'], ['push'], ['pull'],
    ['remote', 'update'], ['remote', 'get-url', '--push'], ['cat-file', 'blob', '--batch'],
    ['branch', '-r', '--contains', '--all'], ['remote', 'get-url', 'origin', 'extra'], ['check-ignore', '-q', 'x'],
    ['rev-parse', 'HEAD'], ['cat-file', 'blob', 'a\nb']])
    assert.equal(repoGitAllowed(args), false, args.join(' '));
  assert.equal(repoGitAllowed(['branch', '-r', '--contains', HEAD]), true);
});

test('D97 (6): every git call runs with lazy fetching off, so a partial clone never fetches from its promisor remote',
  async (t) => {
  // The environment every git call of code-snapshot.js and repo-links.js runs in: no GIT_* variable of the caller's, and
  // GIT_NO_LAZY_FETCH=1 whatever the caller set.
  const env = gitEnvironment({ PATH: '/bin', GIT_DIR: '/elsewhere', GIT_NO_LAZY_FETCH: '0' });
  assert.equal(env.GIT_NO_LAZY_FETCH, '1');
  assert.equal(Object.hasOwn(env, 'GIT_DIR'), false);
  // And git itself sees it: a shell alias run through `runGit` prints the variable. Local only: a new empty repository.
  const dir = await mkdtemp(join(tmpdir(), 'sonah-repo-links-env-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.equal((await runGit(['init', '-q'], { cwd: dir })).ok, true);
  const printed = await runGit(['-c', 'alias.sonah-env=!printenv GIT_NO_LAZY_FETCH', 'sonah-env'], { cwd: dir });
  assert.equal(printed.ok, true);
  assert.equal(printed.stdout.toString('utf8').trim(), '1');
});

test('D97 (6): a report file inside the repository and not ignored is found; one ignored or outside is not', async (t) => {
  const { top } = await folders(t);
  const outside = await mkdtemp(join(tmpdir(), 'sonah-repo-links-out-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  const snapshot = { root: true, top, dir: top };
  const { git, asked } = fakeGit({ 'check-ignore -q -- ignored.md': '' });
  assert.equal(await outputsInRepository({ snapshot, paths: [join(top, 'ignored.md'), join(outside, 'r.md')], git }), false);
  assert.equal(await outputsInRepository({ snapshot, paths: [join(top, 'review.md')], git }), true);
  for (const { args } of asked) assert.ok(repoGitAllowed(args), args.join(' '));
  assert.equal(await outputsInRepository({ snapshot: null, paths: [join(top, 'review.md')], git }), false);
});
