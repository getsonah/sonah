import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, utimes, symlink, realpath, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { discoverSessions, runSessionsCommand } from '../src/session-discovery.js';

const execute = promisify(execFile);
const stamp = 1_800_000_000;
const claudeRow = cwd => ({ type: 'user', cwd, sessionId: 'synthetic-parent', isSidechain: false,
  message: { role: 'user', content: 'Synthetic instruction.' } });
const codexRow = cwd => ({ type: 'session_meta', payload: { id: 'synthetic-parent', cwd, source: 'cli' } });

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'sonah-discovery-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'one', 'same-name');
  const other = join(home, 'two', 'same-name');
  const claudeProjects = join(home, 'claude', 'projects');
  const codexHome = join(home, 'codex');
  for (const directory of [repo, other]) {
    await mkdir(directory, { recursive: true });
    await execute('git', ['init', '--quiet', directory]);
  }
  const options = { repo, claudeProjects, codexHome };
  const claude = name => join(claudeProjects, 'native-project-slug', `${name}.jsonl`);
  const codex = name => join(codexHome, 'sessions', '2026', '10', '10', `rollout-2026-10-10T12-00-00-${name}.jsonl`);
  async function recording(file, rows, modified = stamp) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, rows.map(row => typeof row === 'string' ? row : JSON.stringify(row)).join('\n') + '\n');
    await utimes(file, modified, modified);
    return file;
  }
  return { home, repo, other, options, claude, codex, recording };
}

test('native parent discovery includes tiny recordings and orders both adapters by recency and path', async t => {
  const f = await fixture(t);
  const oldest = await f.recording(f.claude('old'), [claudeRow(f.repo)], stamp - 10);
  const newest = await f.recording(f.codex('new'), [codexRow(f.repo)], stamp + 10);
  const tied = [await f.recording(f.claude('tie-b'), [claudeRow(f.repo)]),
    await f.recording(f.claude('tie-a'), [claudeRow(f.repo)])].sort();
  const found = await discoverSessions(f.options);
  assert.equal(found.repo, await realpath(f.repo));
  assert.deepEqual(found.roots, { claude: f.options.claudeProjects, codex: join(f.options.codexHome, 'sessions') });
  assert.deepEqual(found.sessions.map(row => row.file), [newest, ...tied, oldest]);
  assert.deepEqual(found.sessions.map(row => row.adapter), ['codex', 'claude', 'claude', 'claude']);
  assert.equal(found.sessions[0].id, 'synthetic-parent');
  assert.equal(found.sessions[0].modifiedMs, (stamp + 10) * 1000);
});

test('matching uses exact physical Git roots, including subdirectories and symlink spellings', async t => {
  const f = await fixture(t);
  const subdir = join(f.repo, 'sub directory');
  const nested = join(f.repo, 'nested');
  const alias = join(f.home, 'repo-alias');
  await mkdir(subdir);
  await mkdir(nested);
  await execute('git', ['init', '--quiet', nested]);
  await symlink(f.repo, alias, 'dir');
  const one = await f.recording(f.claude('subdir'), [claudeRow(subdir)]);
  const two = await f.recording(f.codex('alias'), [codexRow(alias)]);
  await f.recording(f.claude('different-same-basename'), [claudeRow(f.other)], stamp + 20);
  await f.recording(f.codex('nested'), [codexRow(nested)], stamp + 30);
  const found = await discoverSessions({ ...f.options, repo: join(alias, 'sub directory') });
  assert.equal(found.repo, await realpath(f.repo));
  assert.deepEqual(found.sessions.map(row => row.file), [one, two].sort());
});

test('an empty CODEX_HOME uses the same home-directory default as session review', async t => {
  const f = await fixture(t);
  const codexHome = join(f.home, '.codex');
  const file = join(codexHome, 'sessions', '2026', '10', '10', 'rollout-2026-10-10T12-00-00-default.jsonl');
  await f.recording(file, [codexRow(f.repo)]);
  const moduleUrl = new URL('../src/session-discovery.js', import.meta.url).href;
  const program = `import { discoverSessions } from ${JSON.stringify(moduleUrl)};
    const result = await discoverSessions({repo:${JSON.stringify(f.repo)},claudeProjects:${JSON.stringify(f.options.claudeProjects)}});
    console.log(JSON.stringify({root:result.roots.codex,files:result.sessions.map(s=>s.file)}));`;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '--eval', program],
    { cwd: f.other, env: { HOME: f.home, CODEX_HOME: '', PATH: process.env.PATH } });
  assert.deepEqual(JSON.parse(stdout), { root: join(codexHome, 'sessions'), files: [file] });
});

test('repository matching preserves legal trailing whitespace in Git root paths', async t => {
  const f = await fixture(t);
  const repo = join(f.home, 'repo '), subdir = join(repo, 'sub');
  await mkdir(subdir, { recursive: true });
  await execute('git', ['init', '--quiet', repo]);
  const file = await f.recording(f.claude('trailing-space'), [claudeRow(subdir)]);
  const found = await discoverSessions({ ...f.options, repo });
  assert.equal(found.repo, await realpath(repo));
  assert.deepEqual(found.sessions.map(s => s.file), [file]);
  const out = output();
  assert.equal(await runSessionsCommand([], { ...out.streams, ...f.options, repo }), 0);
  const hint = out.read().stdout.split('\n').find(line => line.startsWith('1. ')).split(' · ').at(-1);
  const parsed = await execute('sh', ['-c', `set -- ${hint}; printf '%s\\0' "$@"`], { cwd: f.other });
  assert.deepEqual(parsed.stdout.split('\0').slice(0, -1), ['sonah', 'review', '--repo', await realpath(repo), '--choose', '1']);
});

test('directories outside Git match only their own canonical directory', async t => {
  const f = await fixture(t);
  const directory = join(f.home, 'plain');
  await mkdir(join(directory, 'child'), { recursive: true });
  const parent = await f.recording(f.claude('plain'), [claudeRow(directory)]);
  await f.recording(f.codex('plain-child'), [codexRow(join(directory, 'child'))]);
  const found = await discoverSessions({ ...f.options, repo: directory });
  assert.deepEqual(found.sessions.map(row => row.file), [parent]);
});

test('helpers are excluded by native location and typed recorder metadata, regardless of recency', async t => {
  const f = await fixture(t);
  const parent = await f.recording(f.claude('parent'), [claudeRow(f.repo)]);
  await f.recording(join(f.options.claudeProjects, 'native-project-slug', 'parent', 'subagents', 'agent-child.jsonl'),
    [{ ...claudeRow(f.repo), isSidechain: true, agentId: 'synthetic-child' }], stamp + 40);
  await f.recording(f.claude('sidechain'), [{ ...claudeRow(f.repo), isSidechain: true }], stamp + 30);
  await f.recording(f.claude('agent-id'), [{ ...claudeRow(f.repo), agentId: 'synthetic-child' }], stamp + 30);
  for (const [name, fields] of [
    ['subagent', { source: { subagent: { thread_spawn: { parent_thread_id: 'synthetic-parent' } } } }],
    ['parent', { parent_thread_id: 'synthetic-parent' }],
    ['task', { agent_path: '/root/worker' }],
  ]) await f.recording(f.codex(name), [{ type: 'session_meta', payload: { ...codexRow(f.repo).payload, ...fields } }], stamp + 50);
  const forked = await f.recording(f.codex('forked-parent'), [{ type: 'session_meta', payload: {
    ...codexRow(f.repo).payload, agent_path: '/root', forked_from_id: 'synthetic-previous', history_base: 3,
  } }]);
  assert.deepEqual((await discoverSessions(f.options)).sessions.map(row => row.file), [parent, forked].sort());
});

test('only native locations are searched and malformed or absent opening metadata is omitted', async t => {
  const f = await fixture(t);
  await f.recording(join(f.options.claudeProjects, 'outside-project.jsonl'), [claudeRow(f.repo)]);
  await f.recording(join(f.options.codexHome, 'sessions', 'rollout-outside-date.jsonl'), [codexRow(f.repo)]);
  await f.recording(join(dirname(f.codex('unused')), 'not-a-rollout.jsonl'), [codexRow(f.repo)]);
  await f.recording(join(dirname(f.codex('unused')), 'rollout-not-native.jsonl'), [codexRow(f.repo)]);
  await f.recording(f.claude('broken'), ['{']);
  await f.recording(f.claude('duplicate'), [`{"cwd":${JSON.stringify(f.repo)},"cwd":${JSON.stringify(f.other)}}`]);
  await f.recording(f.claude('relative'), [claudeRow('relative-directory')]);
  await f.recording(f.codex('missing-cwd'), [{ type: 'session_meta', payload: { id: 'synthetic-parent' } }]);
  await f.recording(f.codex('relative'), [codexRow('relative-directory')]);
  assert.deepEqual((await discoverSessions(f.options)).sessions, []);
});

test('discovery stops after opening identity instead of parsing whole transcripts', async t => {
  const f = await fixture(t);
  const files = [await f.recording(f.claude('opening'), [{ type: 'file-history-snapshot' }, claudeRow(f.repo),
    '{malformed-later-transcript', 'x'.repeat(400_000)]),
  await f.recording(f.codex('opening'), [codexRow(f.repo), '{malformed-later-transcript', 'x'.repeat(400_000)])].sort();
  assert.deepEqual((await discoverSessions(f.options)).sessions.map(row => row.file), files);
});

test('missing recorder stores produce an empty readable inventory; invalid workspace rejects', async t => {
  const f = await fixture(t);
  assert.deepEqual((await discoverSessions(f.options)).sessions, []);
  await assert.rejects(discoverSessions({ ...f.options, repo: join(f.home, 'absent') }));
});

function output() {
  let stdout = '', stderr = '';
  return { streams: { stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } } },
    read: () => ({ stdout, stderr }) };
}

test('an unreadable recording stream is omitted without rejecting discovery', { skip: process.getuid?.() === 0 }, async t => {
  const f = await fixture(t);
  const file = await f.recording(f.claude('unreadable'), [claudeRow(f.repo)]);
  await chmod(file, 0);
  t.after(() => chmod(file, 0o600).catch(() => {}));
  assert.deepEqual((await discoverSessions(f.options)).sessions, []);
});

test('sessions lists local file choices without recorded cwd, ids, or content', async () => {
  const out = output();
  let request;
  const code = await runSessionsCommand(['--repo', '/synthetic/repo'], { ...out.streams,
    discover: async options => { request = options; return { repo: '/synthetic/repo', sessions: [
      { adapter: 'claude', file: '/synthetic/local/recording', cwd: '/synthetic/private/workspace', id: 'private-id', modifiedMs: stamp * 1000 },
      { adapter: 'codex', file: '/synthetic/local/other', modifiedMs: (stamp - 1) * 1000 },
    ] }; } });
  assert.equal(code, 0);
  assert.equal(request.repo, '/synthetic/repo');
  assert.match(out.read().stdout, /1\. Claude Code · modified .* · \/synthetic\/local\/recording · sonah review --repo '\/synthetic\/repo' --choose 1/);
  assert.match(out.read().stdout, /2\. Codex · modified .* · \/synthetic\/local\/other · sonah review --repo '\/synthetic\/repo' --choose 2/);
  assert.doesNotMatch(out.read().stdout, /private/);
  assert.equal(out.read().stderr, '');
});

test('copyable choices carry the canonical repository with POSIX quoting from a different working directory', async t => {
  const f = await fixture(t);
  const repo = join(f.home, "repo with spaces and owner's quote");
  await mkdir(join(repo, 'sub directory'), { recursive: true });
  await execute('git', ['init', '--quiet', repo]);
  await f.recording(f.claude('quoted-repo'), [claudeRow(repo)]);
  const moduleUrl = new URL('../src/session-discovery.js', import.meta.url).href;
  const program = `import { runSessionsCommand } from ${JSON.stringify(moduleUrl)};
    process.exitCode = await runSessionsCommand(['--repo', ${JSON.stringify(join(repo, 'sub directory'))}],
      ${JSON.stringify({ claudeProjects: f.options.claudeProjects, codexHome: f.options.codexHome })});`;
  const { stdout, stderr } = await execute(process.execPath, ['--input-type=module', '--eval', program], { cwd: f.other });
  assert.equal(stderr, '');
  const hint = stdout.split('\n').find(line => line.startsWith('1. ')).split(' · ').at(-1);
  assert.ok(hint.includes("'\\''"), 'apostrophe is escaped using POSIX single-quote grammar');
  // Parsing with set does not execute sonah or invoke any provider.
  const parsed = await execute('sh', ['-c', `set -- ${hint}; printf '%s\\0' "$@"`], { cwd: f.other });
  assert.deepEqual(parsed.stdout.split('\0').slice(0, -1), ['sonah', 'review', '--repo', await realpath(repo), '--choose', '1']);
});

test('none-found and discovery failure give fixed actionable messages', async () => {
  const none = output();
  assert.equal(await runSessionsCommand([], { ...none.streams, discover: async () => ({ sessions: [],
    roots: { claude: '/synthetic/claude/projects', codex: '/synthetic/codex/sessions' } }) }), 1);
  assert.match(none.read().stdout, /No matching readable parent Claude Code or Codex recording/);
  assert.match(none.read().stdout, /Fix: Run Claude Code or Codex in this repository/);
  assert.match(none.read().stdout, /sonah doctor --no-probe/);
  assert.match(none.read().stdout, /Claude Code recordings: \/synthetic\/claude\/projects/);
  assert.match(none.read().stdout, /Codex recordings: \/synthetic\/codex\/sessions/);
  const failed = output();
  assert.equal(await runSessionsCommand([], { ...failed.streams,
    discover: async () => { throw new Error('synthetic-private-diagnostic'); } }), 3);
  assert.match(failed.read().stderr, /Fix:.*readable repository.*Check read access/);
  assert.doesNotMatch(failed.read().stderr, /private-diagnostic/);
});

test('help and invalid arguments do not discover or invoke any provider', async () => {
  let calls = 0;
  const discover = async () => { calls++; return { sessions: [] }; };
  for (const argv of [['--help'], ['-h']]) {
    const out = output();
    assert.equal(await runSessionsCommand(argv, { ...out.streams, discover }), 0);
    assert.equal(out.read().stdout, 'usage: sonah sessions [--repo DIR]\n');
  }
  for (const argv of [['--repo'], ['--repo', '--bad'], ['--bad'], ['extra'], ['--repo', 'one', 'extra']]) {
    const out = output();
    assert.equal(await runSessionsCommand(argv, { ...out.streams, discover }), 2);
    assert.equal(out.read().stderr, 'usage: sonah sessions [--repo DIR]\n');
  }
  assert.equal(calls, 0);
});
