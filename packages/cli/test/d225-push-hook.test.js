// D225 (item 10, C3): the push hook. `sonah hook add --push` writes Sonah's push script into the git common dir and the
// runner `pre-push` by D143's rules (else it prints the line to add); a push hands the refs to the hidden
// `sonah pre-push`, which leaves one ticket per pushed branch (at most 3, the newest tips first) and never slows, stops
// or fails the push; `sonah hook remove --push` deletes only Sonah's own bytes. Ported from sonah-hosted
// test/client/hook.test.js (its 7 tests, with D143's placement in place of core.hooksPath and getsonah's exit codes),
// plus the plan's additions. Real git in throwaway repositories under a sealed HOME and SONAH_HOME, each with a space in
// its path, whose push remote is ssh://example.invalid/acme/widgets.git, served by a stand-in for ssh from a temp bare
// repository (team-helpers.js `pushRepo`); a stand-in Sonah Team server on 127.0.0.1 where a test needs one. No model,
// no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { HOOK_PROBLEMS, PUSH_HOOK_CHECKS, PUSH_HOOK_PROBLEMS, PUSH_HOOK_STATES } from '../../evidence/src/ledger.js';
import { AGENT_SESSION_RUNNER, HOOK_WORDS, PRE_COMMIT_HOOK_ID, runHookCommand } from '../src/agent-session-hook.js';
import { CONNECT_WORDS, runConnectCommand, runDisconnectCommand, runStatusCommand } from '../src/connect-command.js';
import { doctor } from '../src/doctor.js';
import { HUSKY_PUSH_STUBS, LEFTHOOK_PUSH_CALL, LEFTHOOK_PUSH_RUN, PRE_COMMIT_PUSH_STEPS, PRIVATE_CLIENT_MARK,
  PUSH_HOOK_LINE, PUSH_HOOK_RUNNER, PUSH_HOOK_WORDS, parsePushScript, pushHookFacts, pushHookReport, pushScriptText,
  temporaryInstall } from '../src/push-hook.js';
import { PRE_PUSH_WORDS, pushedBranches, remoteArg, runPrePush } from '../src/push-hook-run.js';
import { PUSH_BRANCHES_MAX, leaveTicket, takeRunner, waitingTickets } from '../src/push-queue.js';
import { gitOut, worktreesOf } from '../src/team-git.js';
import { markRefused, readConnection, readHooks, writeConnection } from '../src/team-home.js';
import { newToken, pushRepo, runEntry, sealedHome, staticClosure, streams, teamServer } from './team-helpers.js';

// The default server, which a hook made with no connection names: no test ever connects to it, and no call reaches it.
const SERVER = 'https://pr.sonah.dev';
// The server of a connection that no call may reach: in-process commands get a fetch that fails the test (noFetch),
// and a test that runs the real entry while connected connects to a stand-in server on 127.0.0.1.
const OFFLINE = 'http://127.0.0.1:9';
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const VERSION = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8')).version;
const ZERO = '0'.repeat(40);

/** A sealed home (a space in its path) and a repository in it whose push remote the stand-in for ssh serves. */
async function setup(t, options = {}) {
  const home = await sealedHome(t, 'sonah d225 ');
  const repo = await pushRepo(home, options);
  const where = { env: repo.env };
  const common = await realpath(join(repo.work, '.git'));
  return { home, repo, where, common };
}
/** The git runner the commands use in-process: git in the repository's sealed environment. */
const sealedGit = (env) => (dir, args) => gitOut(dir, args, { env });
/** A fetch that the test does not expect: any call fails the test. */
const noFetch = async () => { throw new Error('a call that the test does not expect'); };
/** `sonah hook ...` in-process, in the repository's sealed environment. */
async function hook({ repo }, argv, push = {}, cwd = repo.work) {
  const out = streams();
  const code = await runHookCommand(argv, { cwd, git: sealedGit(repo.env), stdout: out.stdout, stderr: out.stderr,
    push: { env: repo.env, fetch: noFetch, ...push } });
  return { code, ...out.chunks };
}
/** `sonah pre-push` in-process: `lines` on standard input, from `cwd`, in `env`. D227: it starts no runner (its `start`
 *  says none could start), so the tickets stay for the test to read. */
async function prePush({ repo }, lines, { env = repo.env, cwd = repo.work, now } = {}) {
  const out = streams();
  await runPrePush(['origin', 'ssh://example.invalid/acme/widgets.git'], { stdin: Readable.from([lines]),
    stderr: out.stderr, env, cwd, git: sealedGit(env), start: async () => false, ...(now ? { now } : {}) });
  return out.chunks.stderr;
}
const connectAs = (where, login = 'octo', server = OFFLINE) => writeConnection({ server, token: newToken(), login }, where);
const mode = async (path) => (await stat(path)).mode & 0o777;
const exists = (path) => lstat(path).then(() => true, () => false);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const branchesOf = async (where, common) => (await waitingTickets(where, common)).map((x) => x.branch).sort();

// D225 review (second look 1): every module the hidden `sonah pre-push` loads at a push, by its path under the
// repository, and the most bytes of them all together. Node evaluates each module of an entry's static import closure
// before the entry runs, so this is what a push pays for before git goes on. It is a closed list on purpose: an import
// added to any of these modules lands in the push path, and nothing else would catch it (the hook once reached
// visual-command.js and, behind it, the code snapshot, the code pass and the whole decisions ledger: 36 files and
// 2.0 MB, with only the 5-second cap of bin/sonah.js and the bound of the push test above to show it).
// D229: fix-waiting.js joins it, for the line of the comments that wait on a pushed branch, and the repository of the
// URL git gave the hook is read by team-git.js `remoteRepository` (moved there from visual-command.js), so the closure
// gains that one module and nothing behind it.
const PRE_PUSH_MODULES = Object.freeze([
  'packages/cli/src/fix-waiting.js', 'packages/cli/src/push-hook-run.js', 'packages/cli/src/push-queue.js',
  'packages/cli/src/settings.js', 'packages/cli/src/team-git.js', 'packages/cli/src/team-home.js',
  'packages/cli/src/visual-lock.js', 'packages/cli/src/visual-server.js',
  'packages/evidence/src/push-run-states.js', 'packages/slicer/src/strict-json.js',
  'packages/visual/src/fix-prompt.mjs',
]);
const PRE_PUSH_BYTES_MAX = 150 * 1024;

test('pre-push lines: pushed branches only, a deleted branch and a tag leave nothing; the remote keeps no password', () => {
  const a = 'a'.repeat(40), b = 'b'.repeat(40);
  const lines = [`refs/heads/x ${a} refs/heads/x ${ZERO}`, `(delete) ${ZERO} refs/heads/gone ${b}`,
    `refs/tags/v1 ${b} refs/tags/v1 ${ZERO}`, `refs/heads/y ${b} refs/heads/feature/y ${a}`,
    `refs/heads/x ${b} refs/heads/x ${a}`, 'nonsense', ''].join('\n');
  assert.deepEqual(pushedBranches(lines), [{ branch: 'x', sha: b }, { branch: 'feature/y', sha: b }]);
  assert.deepEqual(pushedBranches(`refs/heads/s ${'c'.repeat(64)} refs/heads/s ${'0'.repeat(64)}`),
    [{ branch: 's', sha: 'c'.repeat(64) }]);
  assert.equal(remoteArg('origin'), 'origin');
  assert.equal(remoteArg('https://bob:secret@github.com/acme/w.git'), 'https://github.com/acme/w.git');
  assert.equal(remoteArg('--upload-pack=evil'), null);
  assert.equal(remoteArg('origin\nx'), null);
  // The run's environment (the private client's runEnv) comes with the push run that starts it (C4).
});

test('hook add --push writes the script and the runner where git runs them; remove --push removes only its own',
  async (t) => {
  const { home, repo, where, common } = await setup(t);
  const runner = join(repo.work, '.git', 'hooks', 'pre-push');
  const script = join(repo.work, '.git', 'sonah', 'pre-push.sh');
  const r = await runEntry(['hook', 'add', '--push'], { env: repo.env, cwd: repo.work });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stderr, '');
  assert.equal(await readFile(runner, 'utf8'), PUSH_HOOK_RUNNER);
  assert.equal(await mode(runner), 0o755);
  const written = parsePushScript(await readFile(script, 'utf8'));
  assert.ok(written, 'the script is one that Sonah writes');
  assert.equal(await realpath(written.node), await realpath(process.execPath), 'the script names this node');
  assert.equal(written.cli, await realpath(BIN), 'and this install, by its real path');
  assert.equal(written.version, VERSION, 'and its version');
  assert.equal(written.home, home.sonahHome, 'and SONAH_HOME, which was set');
  assert.equal(written.claudeDir, join(home.root, 'bin'), 'and the folder of the claude on PATH');
  assert.equal(await readFile(join(home.sonahHome, 'team', 'hooks.json'), 'utf8'),
    `${JSON.stringify({ v: 1, repos: [{ common, server: SERVER }] })}\n`);
  assert.equal(await mode(join(home.sonahHome, 'team', 'hooks.json')), 0o600);
  assert.equal(await mode(join(home.sonahHome, 'team')), 0o700);
  assert.equal(r.stdout, [PUSH_HOOK_WORDS.turnedOn(runner), '', PUSH_HOOK_WORDS.about(SERVER), PUSH_HOOK_WORDS.cost,
    PUSH_HOOK_WORDS.cap, PUSH_HOOK_WORDS.skipOnce, PUSH_HOOK_WORDS.stopIt, PUSH_HOOK_WORDS.notConnected, ''].join('\n'));
  const again = await runEntry(['hook', 'add', '--push'], { env: repo.env, cwd: repo.work });
  assert.equal(again.code, 0);
  assert.ok(again.stdout.startsWith(`${PUSH_HOOK_WORDS.alreadyOn}\n`), 'a second add changes nothing');
  assert.equal(await exists(join(repo.work, '.git', 'hooks', 'prepare-commit-msg')), false, 'no commit link');

  const u = await runEntry(['hook', 'remove', '--push'], { env: repo.env, cwd: repo.work });
  assert.equal(u.code, 0, u.stderr);
  assert.equal(u.stdout, `${PUSH_HOOK_WORDS.removed([runner, script])}\n${PUSH_HOOK_WORDS.unlisted}\n`);
  assert.equal(await exists(runner), false);
  assert.equal(await exists(join(repo.work, '.git', 'sonah')), false, 'Sonah\'s folder, empty, goes too');
  assert.deepEqual((await readHooks(where)).repos, []);
  const none = await runEntry(['hook', 'remove', '--push'], { env: repo.env, cwd: repo.work });
  assert.deepEqual([none.code, none.stdout], [0, `${PUSH_HOOK_WORDS.nothingToRemove}\n`]);
});

test('a hook Sonah did not write is never changed: add prints the line, and the line works in that hook', async (t) => {
  const { repo, where, common } = await setup(t);
  await connectAs(where);
  const file = join(repo.work, '.git', 'hooks', 'pre-push');
  const theirs = '#!/bin/sh\nset -eu\n# the team\'s own checks: they read the pushed refs too\ncat > "$HOME/their-hook-saw"\n'
    + 'exit 0\n';
  await mkdir(join(repo.work, '.git', 'hooks'), { recursive: true });
  await writeFile(file, theirs, { mode: 0o755 });
  const r = await hook({ repo }, ['add', '--push']);
  assert.equal(r.code, 1, 'a line for the person to add');
  assert.equal(await readFile(file, 'utf8'), theirs, 'their hook is byte for byte the same');
  assert.ok(r.stdout.startsWith(`${PUSH_HOOK_WORDS.notOnForeign(file)}\n${PUSH_HOOK_WORDS.addLine(file)}\n\n`
    + `${PUSH_HOOK_LINE}\n`), r.stdout);
  // git runs no line of Sonah's yet, so the words say what a push does once it does, never "now" (D143's rule).
  assert.ok(r.stdout.includes(`\n\n${PUSH_HOOK_WORDS.aboutOnce(OFFLINE)}\n${PUSH_HOOK_WORDS.cost}\n`), r.stdout);
  assert.ok(!r.stdout.includes(PUSH_HOOK_WORDS.about(OFFLINE)), r.stdout);
  assert.deepEqual((await pushHookFacts(repo.work, { git: sealedGit(repo.env) })).state, 'not_checked');

  // The line, right after their first line, leaves the ticket and still gives their hook the pushed refs. D227: this
  // test holds the repository's runner, so the push starts none and the ticket stays to be read.
  await writeFile(file, theirs.replace('#!/bin/sh\n', `#!/bin/sh\n${PUSH_HOOK_LINE}\n`));
  const sha = await repo.commit('feature', 'export const add = (a, b) => b + a;\n');
  const runner = await takeRunner(where, common);
  const p = repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(await readFile(join(repo.root, 'their-hook-saw'), 'utf8'),
    `refs/heads/feature ${sha} refs/heads/feature ${ZERO}\n`);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.behind(['feature'])}\n`);
  const [ticket] = await waitingTickets(where, common);
  assert.deepEqual([ticket.branch, ticket.sha, ticket.remote, ticket.dir, ticket.common, ticket.server, ticket.login],
    ['feature', sha, 'origin', await realpath(repo.work), common, OFFLINE, 'octo']);
  assert.equal(repo.git(['ls-remote', 'origin', 'refs/heads/feature']).split('\t')[0], sha, 'the push reached the remote');

  // remove --push leaves their hook as it is; the line now does nothing in this repository.
  const u = await hook({ repo }, ['remove', '--push']);
  assert.ok(u.stdout.includes(HOOK_WORDS.lineLeft(file)), u.stdout);
  assert.ok((await readFile(file, 'utf8')).includes(PUSH_HOOK_LINE));
  assert.deepEqual(await waitingTickets(where, common), [], 'its tickets went with it');
  await repo.commit('feature', 'export const add = (a, b) => a + b + 0;\n');
  const quiet = repo.push(['-q', 'origin', 'feature']);
  assert.deepEqual([quiet.code, quiet.stderr], [0, '']);
  assert.deepEqual(await waitingTickets(where, common), [], 'no ticket once the repository is off the list');
  await runner.release();
});

test('core.hooksPath, husky, lefthook and pre-commit: Sonah writes no runner there and prints what to add', async (t) => {
  const { repo, where } = await setup(t);
  const git = sealedGit(repo.env);
  const own = join(repo.work, '.git', 'hooks', 'pre-push');
  // core.hooksPath outside the repository, and inside it (decision 1 reverses the private client's writing there).
  for (const folder of [join(repo.root, 'shared-hooks'), join(repo.work, '.githooks')]) {
    repo.git(['config', 'core.hooksPath', folder]);
    const r = await hook({ repo }, ['add', '--push']);
    assert.equal(r.code, 1, r.stderr);
    assert.ok(r.stdout.startsWith(`${PUSH_HOOK_WORDS.notOnHooksPath(folder)}\n`
      + `${HOOK_WORDS.createFile(join(folder, 'pre-push'))}\n\n${PUSH_HOOK_RUNNER.trimEnd()}\n`), r.stdout);
    assert.equal(await exists(folder), false, 'nothing is written where core.hooksPath sends git');
    assert.equal(await exists(own), false, 'nor where git would not look');
    assert.ok(r.stdout.includes(PUSH_HOOK_WORDS.aboutOnce(SERVER)) && !r.stdout.includes(PUSH_HOOK_WORDS.about(SERVER)),
      r.stdout);
    assert.equal((await readHooks(where)).repos.length, 1, 'the repository is on the list: the line works once added');
  }
  // husky: the line goes into .husky/pre-push, where the person edits the hook.
  repo.git(['config', 'core.hooksPath', '.husky/_']);
  await mkdir(join(repo.work, '.husky', '_'), { recursive: true });
  await writeFile(join(repo.work, '.husky', '_', 'pre-push'), '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n',
    { mode: 0o755 });
  let r = await hook({ repo }, ['add', '--push']);
  assert.ok(r.stdout.includes(`${PUSH_HOOK_WORDS.addLine(join(repo.work, '.husky', 'pre-push'))}\n\n${PUSH_HOOK_LINE}`));
  await writeFile(join(repo.work, '.husky', 'pre-push'), `${PUSH_HOOK_LINE}\nnpm test\n`);
  let facts = await pushHookFacts(repo.work, { git });
  assert.deepEqual([facts.state, facts.lineIn], ['not_checked', join(repo.work, '.husky', 'pre-push')]);
  repo.git(['config', '--unset', 'core.hooksPath']);
  // lefthook: its command with use_stdin, so the refs reach Sonah's line.
  await writeFile(join(repo.work, 'lefthook.yml'), 'pre-push:\n  commands:\n    test:\n      run: npm test\n');
  await mkdir(join(repo.work, '.git', 'hooks'), { recursive: true });
  await writeFile(own, `#!/bin/sh\n${LEFTHOOK_PUSH_CALL} "$@"\n`, { mode: 0o755 });
  r = await hook({ repo }, ['add', '--push']);
  assert.equal(r.code, 1);
  assert.ok(r.stdout.includes(`${PUSH_HOOK_WORDS.mergeLefthook(join(repo.work, 'lefthook.yml'))}\n\n    sonah-push:\n`
    + `      use_stdin: true\n      run: '${LEFTHOOK_PUSH_RUN}'\n`), r.stdout);
  assert.equal((await pushHookFacts(repo.work, { git })).state, 'not_run', 'lefthook runs no line of Sonah\'s yet');
  // lefthook moved Sonah's runner to .old: nothing runs it, and the report needs the person.
  await rm(own);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  await rename(own, `${own}.old`);
  await writeFile(own, `#!/bin/sh\n${LEFTHOOK_PUSH_CALL} "$@"\n`, { mode: 0o755 });
  facts = await pushHookFacts(repo.work, { git });
  assert.deepEqual([facts.state, facts.file], ['moved', `${own}.old`]);
  // pre-commit: its steps, then its hook runs Sonah's runner that it kept as .legacy: on.
  await rm(join(repo.work, 'lefthook.yml'));
  await rm(`${own}.old`);
  await writeFile(own, `#!/usr/bin/env bash\n${PRE_COMMIT_HOOK_ID}\nexec pre-commit hook-impl\n`, { mode: 0o755 });
  r = await hook({ repo }, ['add', '--push']);
  assert.ok(r.stdout.includes(`${PUSH_HOOK_WORDS.notOnPreCommit(own)}\n${PUSH_HOOK_WORDS.preCommitSteps(repo.work)}\n\n`
    + `${PRE_COMMIT_PUSH_STEPS}\n`), r.stdout);
  await writeFile(`${own}.legacy`, PUSH_HOOK_RUNNER, { mode: 0o755 });
  facts = await pushHookFacts(repo.work, { git });
  assert.deepEqual([facts.state, facts.route, facts.file], ['on', 'pre-commit', `${own}.legacy`]);
  // remove --push deletes Sonah's runner where pre-commit moved it, and leaves pre-commit's own hook.
  const u = await hook({ repo }, ['remove', '--push']);
  assert.ok(u.stdout.startsWith(PUSH_HOOK_WORDS.removed([`${own}.legacy`, join(repo.work, '.git', 'sonah', 'pre-push.sh')])));
  assert.ok((await readFile(own, 'utf8')).includes(PRE_COMMIT_HOOK_ID));
});

test('a push returns at once and Sonah never fails it', async (t) => {
  const { repo, where, common } = await setup(t);
  const server = await teamServer(t);
  await writeConnection({ server: server.url, token: server.addToken({ login: 'octo', team: 'Acme', seat: 'paid' }),
    login: 'octo' }, where);
  assert.equal((await runEntry(['hook', 'add', '--push'], { env: repo.env, cwd: repo.work })).code, 0);
  const sha = await repo.commit('feature', 'export const add = (a, b) => a + b + 1;\n');
  // D227: this test holds the repository's runner, so no push starts one, and the tickets stay to be read.
  const runner = await takeRunner(where, common);
  t.after(() => runner.release());
  // The hook alone, as git runs it (standard input: one pushed branch), five times.
  const hookFile = join(repo.work, '.git', 'hooks', 'pre-push');
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const r = spawnSync(hookFile, ['origin', 'ssh://example.invalid/acme/widgets.git'], { cwd: repo.work, env: repo.env,
      encoding: 'utf8', input: `refs/heads/t${i} ${sha} refs/heads/t${i} ${ZERO}\n` });
    times.push(performance.now() - t0);
    assert.equal(r.status, 0, r.stderr);
  }
  assert.deepEqual(await branchesOf(where, common), ['t0', 't1', 't2', 't3', 't4']);
  const p = repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.code, 0, p.stderr);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.behind(['feature'])}\n`);
  t.diagnostic(`the hook alone returns in ${Math.round(median(times))} ms (median of 5); a push with it ${Math.round(p.ms)} ms`);
  assert.ok(median(times) < 1500, `the hook took ${median(times)} ms`);

  // A broken Sonah never fails a push: a node that is gone, a Sonah that fails inside, a damaged script, none at all.
  const script = join(repo.work, '.git', 'sonah', 'pre-push.sh');
  const good = await readFile(script, 'utf8');
  await writeFile(script, good.replace(/^sonah_node=.*$/m, 'sonah_node=\'/nowhere/node\''));
  await repo.commit('feature', 'export const add = (a, b) => a + b + 2;\n');
  const moved = repo.push(['-q', 'origin', 'feature']);
  assert.equal(moved.code, 0, 'node is gone');
  assert.equal(moved.stderr, `sonah: ${PUSH_HOOK_WORDS.scriptMoved}\n`);
  await writeFile(script, good);
  await rm(join(repo.env.SONAH_HOME, 'team', 'queue'), { recursive: true });
  await writeFile(join(repo.env.SONAH_HOME, 'team', 'queue'), 'not a folder');
  await repo.commit('feature', 'export const add = (a, b) => a + b + 3;\n');
  const failed = repo.push(['-q', 'origin', 'feature']);
  assert.deepEqual([failed.code, failed.stderr], [0, ''], 'Sonah fails inside the hook: exit 0, and not one word');
  await writeFile(script, 'this is not ( shell\n');
  await writeFile(hookFile, `#!/bin/sh\nset -eu\n${PUSH_HOOK_LINE}\nexit 0\n`);
  await chmod(hookFile, 0o755);
  await repo.commit('feature', 'export const add = (a, b) => a + b + 4;\n');
  assert.equal(repo.push(['-q', 'origin', 'feature']).code, 0, 'the sourced file is damaged, under set -eu');
  await rm(script);
  await repo.commit('feature', 'export const add = (a, b) => a + b + 5;\n');
  assert.equal(repo.push(['-q', 'origin', 'feature'], { HOME: undefined }).code, 0, 'no script, and HOME unset');
});

test('D225 review (second look 1): the hidden pre-push loads these modules and no more, so a push stays light',
  async (t) => {
    const closure = await staticClosure('packages/cli/src/push-hook-run.js');
    const bytes = [...closure.values()].reduce((all, size) => all + size, 0);
    t.diagnostic(`the hidden pre-push loads ${closure.size} modules, ${bytes} bytes`);
    assert.deepEqual([...closure.keys()].sort(), [...PRE_PUSH_MODULES],
      'a module was added to or taken out of the push path: it is paid for at every push');
    assert.ok(bytes < PRE_PUSH_BYTES_MAX, `the push path reads ${bytes} bytes`);
    // What each heavy module was reached through, and is not any more: the two edges that led to it.
    for (const module of ['packages/cli/src/visual-command.js', 'packages/cli/src/code-snapshot.js',
      'packages/evidence/src/ledger.js', 'packages/evidence/src/code-pass.js'])
      assert.equal(closure.has(module), false, module);
    // And the lists and the check that took them there are read where they always were.
    const [states, server] = [await import('../../evidence/src/ledger.js'), await import('../src/visual-command.js')];
    assert.deepEqual([states.PUSH_RUN_STATES, states.PUSH_RUN_REASONS].map((list) => list.length), [12, 28]);
    assert.equal(server.visualServer('https://pr.sonah.dev/'), 'https://pr.sonah.dev');
  });

test('a deleted branch or a tag leaves nothing', async (t) => {
  const { repo, where, common } = await setup(t);
  await connectAs(where);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  const sha = await repo.commit('gone', 'export const add = (a, b) => a - -b;\n');
  repo.git(['push', '-q', '--no-verify', 'origin', 'gone']);
  repo.git(['tag', 'v1', sha]);
  const del = repo.push(['origin', '--delete', 'gone']);
  assert.equal(del.code, 0, del.stderr);
  const tag = repo.push(['origin', 'v1']);
  assert.equal(tag.code, 0, tag.stderr);
  assert.deepEqual(await waitingTickets(where, common), [], 'no ticket');
  assert.doesNotMatch(del.stderr + tag.stderr, /sonah:/);
});

test('a push before connecting leaves nothing and says so; add --push says it, and asks no server', async (t) => {
  const { repo, where, common } = await setup(t);
  const r = await hook({ repo }, ['add', '--push']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.endsWith(`${PUSH_HOOK_WORDS.notConnected}\n`), 'no seat line, and no call (noFetch)');
  await repo.commit('feature', 'export const add = (a, b) => a + b;\n// x\n');
  const p = repo.push(['-q', 'origin', 'feature']);
  assert.equal(p.code, 0);
  assert.equal(p.stderr, `sonah: ${PRE_PUSH_WORDS.notConnected}\n`);
  assert.deepEqual(await waitingTickets(where, common), []);
});

test('one ticket per branch, a newer push replaces it; at most 3 branches, the newest first, and a line for the rest',
  async (t) => {
  const { repo, where, common } = await setup(t);
  await connectAs(where);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  // Five branches, their tips one day apart: e is the newest.
  const shas = {};
  for (const [i, b] of ['a', 'b', 'c', 'd', 'e'].entries()) {
    repo.git(['checkout', '-q', '-b', b, 'main']);
    const date = `2026-01-0${i + 1}T12:00:00Z`;
    repo.git(['commit', '-q', '--allow-empty', '-m', b], { GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date });
    shas[b] = repo.git(['rev-parse', 'HEAD']);
  }
  const lines = ['b', 'e', 'a', 'd', 'c'].map((b) => `refs/heads/${b} ${shas[b]} refs/heads/${b} ${ZERO}`).join('\n');
  const said = await prePush({ repo }, `${lines}\n`);
  assert.equal(said, `sonah: ${PRE_PUSH_WORDS.queued(['e', 'd', 'c'])}\nsonah: ${PRE_PUSH_WORDS.rest(['b', 'a'], 0)}\n`);
  assert.deepEqual(await branchesOf(where, common), ['c', 'd', 'e']);
  assert.equal(PUSH_BRANCHES_MAX, 3);
  // A newer push of d replaces its waiting ticket.
  repo.git(['checkout', '-q', 'd']);
  repo.git(['commit', '-q', '--allow-empty', '-m', 'd2']);
  const d2 = repo.git(['rev-parse', 'HEAD']);
  await prePush({ repo }, `refs/heads/d ${d2} refs/heads/d ${shas.d}\n`);
  const tickets = await waitingTickets(where, common);
  assert.deepEqual(tickets.map((x) => [x.branch, x.sha]).sort(), [['c', shas.c], ['d', d2], ['e', shas.e]]);
  // A mirror push of many branches names ten of the rest and counts the others.
  const many = Array.from({ length: 15 }, (_, i) => `refs/heads/m${i} ${shas.a} refs/heads/m${i} ${ZERO}`).join('\n');
  const manySaid = await prePush({ repo }, many);
  assert.ok(manySaid.endsWith(`sonah: ${PRE_PUSH_WORDS.rest(['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11',
    'm12'], 2)}\n`), manySaid);
  // A push from a linked worktree leaves its ticket in the repository's queue, with the worktree as its folder.
  const tree = join(repo.root, 'second tree');
  repo.git(['worktree', 'add', '-q', '-b', 'side', tree, 'main']);
  repo.git(['commit', '-q', '--allow-empty', '-m', 'side'], {}, tree);
  const side = repo.git(['rev-parse', 'HEAD'], {}, tree);
  const p = repo.run(['push', '-q', 'origin', 'side'], {}, tree);
  assert.equal(p.code, 0, p.stderr);
  const ticket = (await waitingTickets(where, common)).find((x) => x.branch === 'side');
  assert.deepEqual([ticket.sha, ticket.dir, ticket.common], [side, await realpath(tree), common]);
});

test('a push leaves nothing under CI, with the refused mark, or for another server; a new connection drops the tickets',
  async (t) => {
  const { repo, where, common } = await setup(t);
  await connectAs(where);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  const sha = repo.git(['rev-parse', 'HEAD']);
  const line = `refs/heads/feature ${sha} refs/heads/feature ${ZERO}\n`;
  assert.equal(await prePush({ repo }, line, { env: { ...repo.env, CI: 'true' } }), '', 'CI: nothing, and no word');
  assert.equal(await prePush({ repo }, line, { env: { ...repo.env, CI: '' } }), `sonah: ${PRE_PUSH_WORDS.queued(['feature'])}\n`,
    'CI set to the empty string is not CI');
  // D227 review: the mark is of the token the connection holds.
  assert.equal(await markRefused((await readConnection(where)).connection, where), true);
  assert.equal(await prePush({ repo }, line), `sonah: ${PRE_PUSH_WORDS.refused(OFFLINE)}\n`);
  // A new connection (here, the same login again) removes the mark.
  await connectAs(where);
  const local = await teamServer(t, { codes: {} });
  await connectAs(where, 'octo', local.url);
  assert.equal(await prePush({ repo }, line), `sonah: ${PRE_PUSH_WORDS.otherServer(OFFLINE, local.url)}\n`);
  // Back to the hook's server: tickets of octo on it, then `sonah connect --token` as another login replaces the
  // connection and drops them (A5), and `sonah disconnect` drops what is left.
  const server = await teamServer(t);
  await connectAs(where, 'octo', server.url);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0, 'the hook moves to the connected server');
  await prePush({ repo }, line);
  assert.deepEqual(await branchesOf(where, common), ['feature']);
  const token = server.addToken({ login: 'hubot', team: 'Acme', seat: 'paid' });
  const out = streams();
  const code = await runConnectCommand(['--token', '--server', server.url, '--no-hook'], { stdout: out.stdout,
    stderr: out.stderr, env: repo.env, interactive: true, ask: async () => true, readToken: async () => token,
    cwd: repo.work, git: sealedGit(repo.env) });
  assert.equal(code, 0, out.chunks.stderr);
  assert.ok(out.chunks.stdout.includes(CONNECT_WORDS.oldEnded), 'the old token was not one this server made');
  assert.deepEqual(await waitingTickets(where, common), [], 'the tickets of @octo went with the connection');
  await prePush({ repo }, line);
  assert.deepEqual(await branchesOf(where, common), ['feature']);
  assert.equal((await waitingTickets(where, common))[0].login, 'hubot');
  const gone = streams();
  assert.equal(await runDisconnectCommand([], { ...gone, env: repo.env }), 0);
  assert.deepEqual(await waitingTickets(where, common), [], 'disconnect drops every ticket');
  assert.equal(await exists(join(repo.env.SONAH_HOME, 'team', 'queue')), false);
});

test('hook add --push refuses before it writes anything: no working tree, bare, a temporary install, Windows, the '
  + 'private client, an unreadable list', async (t) => {
  const { home, repo } = await setup(t);
  const before = async () => [await exists(join(repo.work, '.git', 'sonah')), await exists(home.sonahHome)];
  const notes = join(repo.root, 'notes');
  await mkdir(notes);
  let r = await hook({ repo }, ['add', '--push'], {}, notes);
  assert.deepEqual([r.code, r.stderr], [2, `${HOOK_WORDS.problems.hook_not_git(notes)}\n`]);
  r = await hook({ repo }, ['add', '--push'], {}, repo.bare);
  assert.deepEqual([r.code, r.stderr], [2, `${HOOK_WORDS.problems.hook_bare_repository(repo.bare)}\n`]);
  // npx, pnpm dlx (its cache folder, and older pnpm's dlx-<pid>), bunx and yarn dlx make a folder for one run.
  for (const parts of [['.npm', '_npx', '1a2b3c'], ['pnpm', 'dlx', '9f8e'], ['T', 'dlx-4242'], ['T', 'bunx-501-getsonah@latest'],
    ['T', 'xfs-1a2b', 'dlx-77']]) {
    const folder = join(repo.root, ...parts, 'node_modules', 'getsonah', 'packages', 'cli', 'bin');
    await mkdir(folder, { recursive: true });
    const cli = join(folder, 'sonah.js');
    await writeFile(cli, '');
    assert.ok(temporaryInstall(cli), cli);
    r = await hook({ repo }, ['add', '--push'], { cliPath: cli });
    assert.deepEqual([r.code, r.stderr], [2, `${PUSH_HOOK_WORDS.problems.push_hook_temporary_install(cli)}\n`]);
  }
  assert.equal(temporaryInstall('/opt/node/lib/node_modules/getsonah/packages/cli/bin/sonah.js'), false);
  r = await hook({ repo }, ['add', '--push'], { platform: 'win32' });
  assert.deepEqual([r.code, r.stderr], [2, `${PUSH_HOOK_WORDS.problems.push_hook_windows}\n`]);
  assert.deepEqual(await before(), [false, false], 'nothing was written');
  // The private client's push hook already reviews the pushes here: exit 1, nothing changed.
  const own = join(repo.work, '.git', 'hooks', 'pre-push');
  await mkdir(join(repo.work, '.git', 'hooks'), { recursive: true });
  const theirs = `#!/bin/sh\n# ${PRIVATE_CLIENT_MARK}: written by sonah-pr hook install\nexit 0\n`;
  await writeFile(own, theirs, { mode: 0o755 });
  r = await hook({ repo }, ['add', '--push']);
  assert.deepEqual([r.code, r.stdout], [1, `${PUSH_HOOK_WORDS.privateClient(own)}\n`]);
  assert.equal(await readFile(own, 'utf8'), theirs);
  assert.deepEqual(await before(), [false, false]);
  await rm(own);
  // A list that is not Sonah's file of its shape is never written over.
  await mkdir(join(home.sonahHome, 'team'), { recursive: true });
  await writeFile(join(home.sonahHome, 'team', 'hooks.json'), '{"v":1,"repos":"not a list"}\n', { mode: 0o600 });
  r = await hook({ repo }, ['add', '--push']);
  assert.deepEqual([r.code, r.stderr], [2, `${PUSH_HOOK_WORDS.problems.push_hook_list_unreadable(
    join(home.sonahHome, 'team', 'hooks.json'))}\n`]);
  assert.equal(await exists(join(repo.work, '.git', 'sonah')), false);
  r = await hook({ repo }, ['remove', '--push']);
  assert.equal(r.code, 2);
  // A script that Sonah did not write is never written over.
  await rm(join(home.sonahHome, 'team', 'hooks.json'));
  await mkdir(join(repo.work, '.git', 'sonah'));
  await writeFile(join(repo.work, '.git', 'sonah', 'pre-push.sh'), '# not Sonah\'s\n');
  r = await hook({ repo }, ['add', '--push']);
  assert.deepEqual([r.code, r.stderr], [2, `${HOOK_WORDS.problems.hook_file_foreign(
    join(repo.work, '.git', 'sonah', 'pre-push.sh'))}\n`]);
  r = await hook({ repo }, ['remove', '--push']);
  assert.equal(await readFile(join(repo.work, '.git', 'sonah', 'pre-push.sh'), 'utf8'), '# not Sonah\'s\n');
  for (const argv of [['add', '--push', '--push'], ['add', '--repo', '--push'], ['remove', '--push', '--repo'],
    ['add', '--push', 'x']]) {
    r = await hook({ repo }, argv);
    assert.deepEqual([r.code, r.stderr], [2, 'usage: sonah hook add|remove [--push] [--repo DIR]\n'], argv.join(' '));
  }
  assert.deepEqual([...HOOK_PROBLEMS, ...PUSH_HOOK_PROBLEMS].filter((c) => !(c in HOOK_WORDS.problems)
    && !(c in PUSH_HOOK_WORDS.problems)), [], 'every problem has its words');
});

test('hook add --push says the seat from GET /api/token when connected (A6), and the refusal of a revoked token',
  async (t) => {
  const { repo, where } = await setup(t);
  const server = await teamServer(t);
  const token = server.addToken({ login: 'octo', team: 'Acme', seat: 'free' });
  await writeConnection({ server: server.url, token, login: 'octo' }, where);
  let r = await hook({ repo }, ['add', '--push'], { fetch: globalThis.fetch });
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.endsWith(`${PUSH_HOOK_WORDS.stopIt}\n${CONNECT_WORDS.seat.free('Acme')}\n`), r.stdout);
  assert.ok(r.stdout.includes(PUSH_HOOK_WORDS.about(server.url)), 'the hook is for the connected server');
  assert.deepEqual(server.calls.map((c) => [c.method, c.url, c.authorization]), [['GET', '/api/token', `Bearer ${token}`]]);
  assert.deepEqual((await readHooks(where)).repos.map((x) => x.server), [server.url]);
  // A token the server no longer takes: said, and marked, so a push starts nothing.
  server.tokens.get(token).live = false;
  r = await hook({ repo }, ['add', '--push'], { fetch: globalThis.fetch });
  assert.ok(r.stdout.endsWith(`${CONNECT_WORDS.status.refused(server.url)}\n`), r.stdout);
  const sha = repo.git(['rev-parse', 'HEAD']);
  assert.equal(await prePush({ repo }, `refs/heads/main ${sha} refs/heads/main ${ZERO}\n`),
    `sonah: ${PRE_PUSH_WORDS.refused(server.url)}\n`);
  for (const text of [r.stdout, r.stderr]) assert.ok(!text.includes(token), 'the token is never printed');
});

test('sonah connect offers the push hook in a git working tree ([Y/n], the cost and the server), then the commit link',
  async (t) => {
  const { home, repo, where } = await setup(t);
  const server = await teamServer(t, { codes: { 'ABCD-EFGH': { login: 'octo', team: 'Acme', seat: 'paid' },
    'WXYZ-2345': { login: 'octo', team: 'Acme', seat: 'paid' } } });
  const connect = async (argv, { answers = [], cwd = repo.work, interactive = true, token = null } = {}) => {
    const out = streams();
    const asked = [];
    const code = await runConnectCommand(argv, { stdout: out.stdout, stderr: out.stderr, env: repo.env, interactive,
      cwd, git: sealedGit(repo.env), hostname: () => 'test-host', readToken: async () => token,
      ask: async (question, { yes }) => {
        asked.push(question);
        const said = answers.shift();
        assert.notEqual(said, undefined, `a question the test does not answer: ${question}`);
        return said === '' ? yes : said === 'y';
      } });
    assert.deepEqual(answers, []);
    return { code, asked, ...out.chunks };
  };
  // Outside a working tree: no question.
  let r = await connect(['ABCD-EFGH', '--server', server.url], { answers: [''], cwd: home.root });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.asked, [CONNECT_WORDS.ask(server.url, 'octo')]);
  // In the repository: the connection, then the hook (yes), then the commit link (no).
  r = await connect(['WXYZ-2345', '--server', server.url], { answers: ['', '', 'n'] });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.asked, [CONNECT_WORDS.ask(server.url, 'octo'), CONNECT_WORDS.askHook(server.url),
    CONNECT_WORDS.askLink]);
  const runner = join(repo.work, '.git', 'hooks', 'pre-push');
  assert.ok(r.stdout.includes(`${CONNECT_WORDS.hookCost}\n\n${PUSH_HOOK_WORDS.turnedOn(runner)}\n`), r.stdout);
  assert.ok(r.stdout.includes(`${HOOK_WORDS.publicLine}\n${CONNECT_WORDS.linkLater}\n`), 'the public line before the question');
  assert.equal(r.stdout.split(CONNECT_WORDS.seat.paid('Acme')).length, 2, 'the seat is said once');
  assert.deepEqual((await readHooks(where)).repos.map((x) => x.server), [server.url]);
  assert.equal(await exists(join(repo.work, '.git', 'hooks', 'prepare-commit-msg')), false, 'no commit link');
  // --token with --hook outside a terminal: the hook with no question; the link is only named.
  await rm(runner);
  const token = server.addToken({ login: 'octo', team: 'Acme', seat: 'paid' });
  r = await connect(['--token', '--server', server.url, '--hook'], { interactive: false, token });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.asked, []);
  assert.ok(r.stdout.includes(PUSH_HOOK_WORDS.turnedOn(runner)));
  assert.ok(r.stdout.endsWith(`${CONNECT_WORDS.linkLater}\n`));
  // In a terminal, the link's yes turns D143's link on.
  r = await connect(['--token', '--server', server.url], { answers: ['', 'y'], token });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.asked, [CONNECT_WORDS.askHook(server.url), CONNECT_WORDS.askLink]);
  assert.equal(await readFile(join(repo.work, '.git', 'hooks', 'prepare-commit-msg'), 'utf8'), AGENT_SESSION_RUNNER);
  assert.ok(r.stdout.includes(PUSH_HOOK_WORDS.alreadyOn));
  // A no to the hook, and --no-hook: nothing more; outside a terminal with neither, the command is only named.
  r = await connect(['--token', '--server', server.url], { answers: ['n'], token });
  assert.ok(r.stdout.endsWith(`${CONNECT_WORDS.hookLater}\n`));
  r = await connect(['--token', '--server', server.url, '--no-hook'], { token });
  assert.ok(!r.stdout.includes(CONNECT_WORDS.hookCost));
  r = await connect(['--token', '--server', server.url], { interactive: false, token });
  assert.ok(r.stdout.endsWith(`${CONNECT_WORDS.hookCost}\n${CONNECT_WORDS.hookLater}\n`));
  // --hook outside a working tree: connected, and the hook needs you (1).
  r = await connect(['--token', '--server', server.url, '--hook'], { interactive: false, token, cwd: home.root });
  assert.deepEqual([r.code, r.stdout.endsWith(`${HOOK_WORDS.problems.hook_not_git(home.root)}\n`)], [1, true]);
  for (const argv of [['--hook', '--no-hook', 'ABCD-EFGH'], ['--hook', '--hook', 'ABCD-EFGH']]) {
    r = await connect(argv);
    assert.equal(r.code, 2, argv.join(' '));
  }
});

test('sonah status and sonah doctor report each hooked repository from its files', async (t) => {
  const { home, repo, where, common } = await setup(t);
  const git = sealedGit(repo.env);
  await connectAs(where);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  const s = PUSH_HOOK_WORDS.report;
  const report = (connection = { server: OFFLINE }) => pushHookReport({ env: repo.env, git, connection });
  let r = await report();
  assert.deepEqual(r, { lines: [s.heading(repo.work, OFFLINE), `  ${s.on.runner}`], attention: false,
    repos: [{ common, server: OFFLINE, state: 'on', checks: [] }] });
  // Waiting branches.
  const sha = repo.git(['rev-parse', 'HEAD']);
  await leaveTicket(where, { common, dir: repo.work, branch: 'feature', sha, server: OFFLINE, login: 'octo' });
  assert.deepEqual((await report()).lines.slice(2), [`  ${s.waiting(['feature'])}`]);
  // Another server than the connection's.
  r = await report({ server: 'http://127.0.0.1:8080' });
  assert.deepEqual([r.attention, r.repos[0].checks], [true, ['other_server']]);
  assert.ok(r.lines.includes(`  ${s.otherServer('http://127.0.0.1:8080')}`));
  // The node, then the Sonah, that the script names are gone; then another install.
  const script = join(repo.work, '.git', 'sonah', 'pre-push.sh');
  const good = await readFile(script, 'utf8');
  const named = parsePushScript(good);
  await writeFile(script, pushScriptText({ ...named, node: '/nowhere/node' }));
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].checks], [true, ['node_gone']]);
  assert.ok(r.lines.includes(`  ${s.nodeGone('/nowhere/node')}`) && r.lines.includes(`  ${s.refresh(repo.work)}`));
  await writeFile(script, pushScriptText({ ...named, cli: '/nowhere/sonah.js' }));
  assert.deepEqual((await report()).repos[0].checks, ['sonah_gone']);
  const other = join(repo.root, 'other install', 'sonah.js');
  await mkdir(join(repo.root, 'other install'));
  await writeFile(other, '');
  await writeFile(script, pushScriptText({ ...named, cli: other, version: '0.3.0-beta.9' }));
  r = await report();
  assert.deepEqual(r.repos[0].checks, ['other_install']);
  assert.ok(r.lines.includes(`  ${s.otherInstall('0.3.0-beta.9', other)}`));
  await writeFile(script, good);
  // core.hooksPath set after the hook, to a folder with no pre-push: git no longer runs it.
  repo.git(['config', 'core.hooksPath', '.githooks']);
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state], [true, 'not_run']);
  assert.ok(r.lines.includes(`  ${s.notRun(join(repo.work, '.githooks', 'pre-push'))}`), r.lines.join('\n'));
  // husky 9's install, after the hook: core.hooksPath is .husky/_, where husky writes its own pre-push (its bytes as
  // husky 9.1.7 writes them), which runs only .husky/pre-push. Off while that file holds no line of Sonah's, there or
  // not; not checked once it holds one.
  repo.git(['config', 'core.hooksPath', '.husky/_']);
  await mkdir(join(repo.work, '.husky', '_'), { recursive: true });
  await writeFile(join(repo.work, '.husky', '_', 'pre-push'), HUSKY_PUSH_STUBS[0], { mode: 0o755 });
  const huskyFile = join(repo.work, '.husky', 'pre-push');
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state], [true, 'not_run']);
  assert.ok(r.lines.includes(`  ${s.notRun(huskyFile)}`), r.lines.join('\n'));
  await writeFile(huskyFile, 'npm test\n');
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state, r.lines[1]], [true, 'not_run', `  ${s.notRun(huskyFile)}`]);
  await writeFile(huskyFile, `${PUSH_HOOK_LINE}\nnpm test\n`);
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state, r.lines[1]], [false, 'not_checked', `  ${s.lineNotChecked(huskyFile)}`]);
  // A hook in husky's folder that is not husky's own bytes: Sonah cannot tell what it runs.
  await rm(huskyFile);
  await writeFile(join(repo.work, '.husky', '_', 'pre-push'), `${HUSKY_PUSH_STUBS[0]}\nnode scripts/check.js\n`);
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state], [false, 'not_checked']);
  repo.git(['config', '--unset', 'core.hooksPath']);
  await rm(join(repo.work, '.husky'), { recursive: true });
  // The runner without its executable bit; then the script gone.
  const runner = join(repo.work, '.git', 'hooks', 'pre-push');
  await chmod(runner, 0o644);
  assert.ok((await report()).lines.includes(`  ${s.notExecutable(runner)}`));
  await chmod(runner, 0o755);
  await rm(script);
  r = await report();
  assert.deepEqual([r.attention, r.repos[0].state, r.lines[1]], [true, 'off', `  ${s.off}`]);
  await writeFile(script, good);

  // sonah status: the connection (its server answers), then the hooks; 1 when a hook needs you.
  const server = await teamServer(t);
  const token = server.addToken({ login: 'octo', team: 'Acme', seat: 'paid' });
  await writeConnection({ server: server.url, token, login: 'octo' }, where);
  const out = streams();
  let code = await runStatusCommand([], { ...out, env: repo.env, git });
  assert.equal(code, 1, 'the hook is for another server than the connection\'s');
  assert.ok(out.chunks.stdout.startsWith(`${CONNECT_WORDS.status.connected(server.url, 'octo')}\n`
    + `${CONNECT_WORDS.seat.paid('Acme')}\n\n${s.heading(repo.work, OFFLINE)}\n`), out.chunks.stdout);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  const again = streams();
  code = await runStatusCommand([], { ...again, env: repo.env, git });
  assert.equal(code, 0, again.chunks.stdout);
  // A token the server no longer takes is marked by status, so a push starts nothing.
  server.tokens.get(token).live = false;
  const refused = streams();
  assert.equal(await runStatusCommand([], { ...refused, env: repo.env, git }), 1);
  assert.equal(await prePush({ repo }, `refs/heads/main ${sha} refs/heads/main ${ZERO}\n`),
    `sonah: ${PRE_PUSH_WORDS.refused(server.url)}\n`);

  // sonah doctor: the same lines, and push_hook among what needs attention when one needs you.
  const doc = async () => doctor({ probe: false }, { env: repo.env, nodeVersion: '20.0.0',
    runCli: async () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); },
    adapters: async () => ({ claude: { count: 0, where: 'c' }, codex: { count: 0, where: 'x' } }),
    commitLink: async () => null, cwd: home.root });
  let result = await doc();
  assert.ok(result.text.includes(`${s.heading(repo.work, server.url)}\n  ${s.on.runner}`), result.text);
  assert.ok(!result.attention.includes('push_hook'));
  assert.deepEqual(result.facts.pushHooks, [{ common, server: server.url, state: 'on', checks: [] }]);
  await rm(script);
  result = await doc();
  assert.ok(result.attention.includes('push_hook'));
  // A repository that is gone: said, never attention; and a list with no repository adds no line.
  await rm(repo.work, { recursive: true });
  result = await doc();
  assert.ok(result.text.includes(`${s.heading(common, server.url)}\n  ${s.gone(common)}`), result.text);
  assert.ok(!result.attention.includes('push_hook'));
  assert.deepEqual(result.facts.pushHooks[0].checks, ['repository_gone']);
  assert.deepEqual(PUSH_HOOK_STATES, ['off', 'on', 'moved', 'not_run', 'not_checked']);
  assert.deepEqual(PUSH_HOOK_CHECKS, ['node_gone', 'sonah_gone', 'other_install', 'other_server', 'repository_gone']);
});

test('a git older than 2.36 (no worktree list -z) still finds each hooked repository: the report reads it as it is',
  async (t) => {
  const { repo, where, common } = await setup(t);
  const git = sealedGit(repo.env);
  // git before 2.36 (Ubuntu 22.04 has 2.34, Debian 11 2.30) refuses `worktree list -z` as an unknown switch (exit 129),
  // which gitOut reads as no answer; it answers everything else as today's git does.
  const asked = [];
  const oldGit = (dir, args) => {
    asked.push(args.join(' '));
    return args[0] === 'worktree' && args.includes('-z') ? Promise.resolve(null) : git(dir, args);
  };
  await connectAs(where);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  const tree = join(repo.root, 'second tree');
  repo.git(['worktree', 'add', '-q', '-b', 'side', tree, 'main']);
  const listed = await worktreesOf(common, { git: oldGit });
  assert.deepEqual(listed, await worktreesOf(common, { git }), 'the same list as with -z');
  // D229: the list carries each worktree's commit and branch too, which `sonah fix` reads to find the one of a branch.
  assert.deepEqual(listed.map(({ path, bare, branch, prunable }) => ({ path, bare, branch, prunable })),
    [{ path: repo.work, bare: false, branch: 'refs/heads/main', prunable: false },
      { path: await realpath(tree), bare: false, branch: 'refs/heads/side', prunable: false }]);
  assert.deepEqual(listed.map((w) => w.head), [repo.git(['rev-parse', 'main']), repo.git(['rev-parse', 'side'])]);
  assert.ok(asked.includes('worktree list --porcelain'), 'read again without -z');
  const s = PUSH_HOOK_WORDS.report;
  assert.deepEqual(await pushHookReport({ env: repo.env, git: oldGit, connection: { server: OFFLINE } }),
    { lines: [s.heading(repo.work, OFFLINE), `  ${s.on.runner}`], attention: false,
      repos: [{ common, server: OFFLINE, state: 'on', checks: [] }] });
  // A git that answers neither form: the repository reads as gone, as before.
  const noGit = (dir, args) => (args[0] === 'worktree' ? Promise.resolve(null) : git(dir, args));
  assert.deepEqual((await pushHookReport({ env: repo.env, git: noGit })).repos[0].checks, ['repository_gone']);
});

test('plain hook remove says that the push hook stays; the push script names no secret and reads back exactly',
  async (t) => {
  const { repo } = await setup(t);
  assert.equal((await hook({ repo }, ['add', '--push'])).code, 0);
  assert.equal((await hook({ repo }, ['add'])).code, 0);
  const r = await hook({ repo }, ['remove']);
  assert.equal(r.code, 0);
  assert.ok(r.stdout.endsWith(`${HOOK_WORDS.historyStays}\n${PUSH_HOOK_WORDS.stays}\n`), r.stdout);
  assert.equal(await exists(join(repo.work, '.git', 'hooks', 'pre-push')), true, 'plain remove leaves the push hook');
  assert.equal(await exists(join(repo.work, '.git', 'hooks', 'prepare-commit-msg')), false);
  const u = await hook({ repo }, ['remove', '--push']);
  assert.equal(u.code, 0);
  const plain = await hook({ repo }, ['remove']);
  assert.ok(!plain.stdout.includes(PUSH_HOOK_WORDS.stays), 'no push hook, no line');
  // The script's values read back exactly, a quote in a path among them; a changed byte is not Sonah's.
  const values = { version: '0.3.0-beta.17', node: '/opt/it\'s node/bin/node', cli: '/opt/a b/sonah.js',
    home: '/srv/sonah home', claudeDir: '/opt/claude bin' };
  assert.deepEqual(parsePushScript(pushScriptText(values)), values);
  assert.deepEqual(parsePushScript(pushScriptText({ ...values, home: null, claudeDir: null })),
    { ...values, home: null, claudeDir: null });
  assert.equal(parsePushScript(`${pushScriptText(values)}echo extra\n`), null);
  assert.equal(PUSH_HOOK_LINE.includes('\''), false, 'the line holds no single quote');
  assert.equal(spawnSync('sh', ['-n', '-c', pushScriptText(values)]).status, 0, 'the script is shell');
  assert.deepEqual((await readdir(join(repo.work, '.git'))).filter((n) => n === 'sonah'), []);
});
