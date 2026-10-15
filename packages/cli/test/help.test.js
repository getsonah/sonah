// `--help` is a question, never a command.
//
// Audit H21: every subcommand except `review` fell through to its own branch when `--help` was
// present, because the dispatch only ever looked at argv[0]. `sonah init --help` installed a
// prepare-commit-msg hook into whatever repository the reviewer happened to be standing in,
// `sonah doctor --help` spent a live model call, `sonah feedback --help` wrote a bundle into $HOME,
// and `sonah web --help` bound a port and opened a browser. Asking a tool what it does must not be
// a way of finding out by doing it.
//
// The test spawns the real binary once per command name parsed out of the usage table itself, so a
// command added to the table is covered the day it is added. Everything runs inside a throwaway
// HOME and a throwaway git repository; the two things `init` would have written are asserted absent.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
// fileURLToPath, never URL.pathname: a checkout may live under "Acme Labs", and .pathname
// percent-encodes the space, spawning a nonexistent file.
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));

// PATH without the user's own bin directories: `claude`, `codex` and `gh` must be absent, so a
// branch that reached a model or GitHub would fail loudly rather than quietly succeed.
const PATH = '/usr/bin:/bin';

async function run(args, { home, cwd }) {
  const options = { cwd, env: { HOME: home, SONAH_HOME: home, PATH }, timeout: 20_000,
    killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024 };
  try { const r = await exec(process.execPath, [BIN, ...args], options); return { code: 0, ...r }; }
  catch (e) { return { code: e.killed ? 'timeout' : e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

async function sandbox(t) {
  const home = await mkdtemp(join(tmpdir(), 'sonah-help-home-'));
  const cwd = await mkdtemp(join(tmpdir(), 'sonah-help-repo-'));
  t.after(() => Promise.all([rm(home, { recursive: true, force: true }), rm(cwd, { recursive: true, force: true })]));
  await exec('git', ['init', '-q'], { cwd });
  return { home, cwd };
}

const exists = async (path) => { try { await access(path); return true; } catch { return false; } };

/** The command names the usage table itself advertises. Parsed, never hand-listed. */
function commandsIn(usage) {
  const names = new Set();
  for (const line of usage.split('\n')) {
    const m = /^\s+sonah\s+([a-z][a-z-]*)/.exec(line);
    if (m) names.add(m[1]);
  }
  return [...names];
}

test('the usage table advertises every command the dispatch implements', async (t) => {
  const box = await sandbox(t);
  const r = await run(['--help'], box);
  assert.equal(r.code, 0);
  const listed = commandsIn(r.stdout + r.stderr);
  // Owner decision 2026-10-06: the legacy gate's eleven verdict, docket and app commands are retired,
  // so the table lists the nine that remain (it listed 20 before); D69 f (g) adds `decision`, your answer to one decision
  // on a session page. D76 retires `init` and `ledgers`; `capture`, `capture-outcome` and (D77) `trailer` stay only for
  // hooks early previews installed, doing nothing, and are no longer advertised. Owner decision 2026-10-14 adds
  // `config`, the code step's switch.
  assert.deepEqual(listed.sort(), ['config', 'decision', 'doctor', 'feedback', 'review', 'sessions', 'slice']);
});

test('every command answers --help without running, writing or reaching out', async (t) => {
  const box = await sandbox(t);
  const listed = commandsIn((await run(['--help'], box)).stdout);
  const before = (await readdir(box.home)).sort();
  const broken = [];
  for (const cmd of listed) {
    for (const flag of ['--help', '-h']) {
      const r = await run([cmd, flag], box);
      const after = (await readdir(box.home)).sort();
      const hook = await exists(join(box.cwd, '.git', 'hooks', 'prepare-commit-msg'));
      // `review` answers --help itself, with its own single-command usage line rather than the
      // whole table; the third test below pins that text. (D82 step 10: its line, now the only review route's.)
      const helpful = cmd === 'review' ? /^sonah review \[session\.jsonl\]/m : /usage:/;
      if (r.code !== 0) broken.push(`${cmd} ${flag}: exit ${r.code}`);
      else if (!helpful.test(r.stdout + r.stderr)) broken.push(`${cmd} ${flag}: no usage text`);
      else if (JSON.stringify(after) !== JSON.stringify(before)) broken.push(`${cmd} ${flag}: wrote to HOME (${after.join(',')})`);
      else if (hook) broken.push(`${cmd} ${flag}: installed a git hook`);
      // Leave the sandbox as we found it so one bad command does not cascade into the rest.
      await rm(join(box.cwd, '.git', 'hooks', 'prepare-commit-msg'), { force: true });
      for (const entry of after) if (!before.includes(entry)) await rm(join(box.home, entry), { recursive: true, force: true });
    }
  }
  assert.deepEqual(broken, [], `--help executed the command for: ${broken.join('; ')}`);
});

test('an unknown command still prints usage and exits 2, and --help is not a command', async (t) => {
  const box = await sandbox(t);
  const unknown = await run(['not-a-command'], box);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /usage:/);
  // `review` keeps its own --help, which is a different (longer) usage line for one command.
  const review = await run(['review', '--help'], box);
  assert.equal(review.code, 0);
  assert.match(review.stdout, /^sonah review \[session\.jsonl\]/m);
  assert.doesNotMatch(review.stdout, /--base|--head/, 'D82 step 10: the combined route is removed');
});

test('B1 doctor help explains the one model check and optional backend without spending a call', async (t) => {
  const box = await sandbox(t);
  const result = await run(['doctor', '--help'], box);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /one model check, session locations/);
  assert.match(result.stdout, /--backend claude-cli\|codex-cli/);
  assert.match(result.stdout, /--no-probe/);
  assert.deepEqual(await readdir(box.home), []);
});
