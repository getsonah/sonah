import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratchDir } from '../../slicer/test/scratch-dir.js';
const exec = promisify(execFile);
// fileURLToPath, never URL.pathname: a checkout may live under "Acme Labs", and .pathname
// percent-encodes the space, spawning a nonexistent file. The same class of bug has now been
// found four times in this project; the space in the repo path is doing its job.
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));

// The failure contract. The first audit found garbage input producing a raw stack trace and exit 0
// — a failure reporting success, in a tool whose thesis is that silent false-negatives kill.
async function run(...args) {
  try { const r = await exec('node', [BIN, ...args]); return { code: 0, ...r }; }
  catch (e) { return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

/** Same, but sealed: its own HOME, and a PATH with no `gh`, `claude` or `codex` on it. */
async function runSealed(args, { home, cwd = home }) {
  const options = { cwd, env: { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin' },
    timeout: 30_000, killSignal: 'SIGKILL' };
  try { const r = await exec(process.execPath, [BIN, ...args], options); return { code: 0, ...r }; }
  catch (e) { return { code: e.killed ? 'timeout' : e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

async function sealed(t) {
  const home = await mkdtemp(join(tmpdir(), 'sonah-exit-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  return home;
}

/** Every path under a directory, sorted — for asserting that a command wrote nothing. */
async function tree(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    out.push(rel);
    if (entry.isDirectory()) out.push(...await tree(join(dir, entry.name), rel));
  }
  return out.sort();
}

test('a tool failure exits 3 with a human message, never a stack trace', async () => {
  const r = await run('slice', '/nonexistent.jsonl');
  assert.equal(r.code, 3);
  assert.match(r.stderr, /no such file/);
  assert.doesNotMatch(r.stderr, /at .*\(node:/, 'stack traces are behind SONAH_DEBUG');
});

test('a usage error exits 2', async () => {
  assert.equal((await run('not-a-command')).code, 2);
});

test('--version prints a semver and exits 0', async () => {
  const r = await run('--version');
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
});

test('--help succeeds and names the review, never a retired legacy command', async () => {
  const r = await run('--help');
  assert.equal(r.code, 0);
  assert.match(r.stdout + r.stderr, /sonah review <session\.jsonl>/);
  // Owner decision 2026-10-06: the legacy gate's verdict, docket and app commands are retired.
  for (const retired of RETIRED) assert.doesNotMatch(r.stdout + r.stderr, new RegExp(`sonah ${retired}\\b`), retired);
});

// The gap that let `sonah slice` ship exiting 3 on complete success: every test above covered a
// FAILURE code or a trivial flag, and none asserted that a command which did its job reports it.
// The module sets `process.exitCode = 3` at load as a crash fail-safe, so any branch that forgets
// to clear it inherits "the tool itself failed" while printing a perfect result — the exact
// silent-wrong-signal shape the failure contract exists to prevent, pointed the other way.
const GOLDEN = fileURLToPath(new URL('../../../corpus/golden/d04-clean.jsonl', import.meta.url));

test('a command that did its job exits 0, not the module-level fail-safe', async () => {
  const r = await run('slice', GOLDEN);
  assert.equal(r.code, 0, 'slice completed but reported failure');
  assert.match(r.stdout, /"_hash"/, 'and it really did produce a ledger');
});

// ---------------------------------------------------- M57: redaction runs BEFORE the slice hash
// (Moved from capture.test.js when `capture` retired, D76: it tests `analyze`, which `sonah slice` runs.)
//
// The slice hash is the identity of a session everywhere downstream: it names the verdict cache,
// it is written into commit trailers, and it is what a second machine compares against. If it
// were computed from the raw slice, the identity of every session would be a function of its
// plaintext credentials — and two sessions differing only in a secret would be distinguishable by
// a value that is meant to be safe to publish. Worse, a re-slice after a redaction-rule change
// would keep the old identity and quietly reuse a verdict computed over unredacted text.
//
// This was an invariant of the product (a project rule, before D84: "Redaction fails closed and runs BEFORE
// slice_hash is computed"), and nothing asserted it. AKIAIOSFODNN7EXAMPLE is AWS's own published
// example key, not a credential. D84 (owner decision 2026-10-12): it still holds for `analyze` — what
// `sonah slice` prints and the pull-request route reads, masked — while a session review reads and
// hashes its bounded, unmasked ledger (cli/test/d84-output-masking.test.js).

test('M57: the slice hash is taken after redaction, never before', async () => {
  const [{ analyze }, { sliceLineage }, { redact, sliceHash }] = await Promise.all([
    import('../index.js'), import('../../slicer/index.js'), import('../../redact/index.js')]);

  const KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
  const dir = await scratchDir('dev-hash-');
  const file = join(dir, 'synthetic.jsonl');
  const row = (extra) => ({ sessionId: 'sess-m57', cwd: '/repo', version: '2.1.205',
    gitBranch: 'main', isSidechain: false, ...extra });
  await writeFile(file, [
    row({ type: 'user', uuid: 'u-1', message: { role: 'user', content: 'deploy the worker' } }),
    row({ type: 'assistant', uuid: 'u-2', message: { role: 'assistant', content: [{ type: 'tool_use',
      id: 't-1', name: 'Bash', input: { command: `AWS_ACCESS_KEY_ID=${KEY} aws s3 ls` } }] } }),
    row({ type: 'user', uuid: 'u-3', message: { role: 'user', content: [{ type: 'tool_result',
      tool_use_id: 't-1', content: 'ok', is_error: false }] }, toolUseResult: 'ok' }),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const raw = await sliceLineage([file]);
  assert.ok(JSON.stringify(raw).includes(KEY), 'the fixture must really carry the key before redaction');

  const result = await analyze([file]);
  assert.equal(result.hash, sliceHash(result.ledger), 'the hash names the ledger the caller receives');
  assert.notEqual(result.hash, sliceHash(raw), 'and it is NOT the identity of the unredacted slice');
  assert.equal(result.hash, sliceHash(redact(raw).ledger),
    'the whole difference between the two is redaction, applied first');
  assert.ok(!JSON.stringify(result.ledger).includes(KEY), 'and the key is not in what we hand back');
});

// Owner decision 2026-10-06: the legacy gate's product surface is retired. Each retired command is
// now an unknown command — a usage error, exit 2 — that reads, writes and reaches nothing; bare `sonah`, which opened the
// docket on a terminal and ran `scan` in a pipe, prints the usage table the same way.
// D76: early previews' capture commands `init` and `ledgers` are retired the same way. (`trailer`, which the git hook
// `init` wrote calls, is silent instead, D77: see the commands old hooks call, below.)
const RETIRED = Object.freeze(['scan', 'docket', 'web', 'demo', 'arcs', 'departures', 'bounce', 'tree', 'pr',
  'disposition', 'review-pending', 'init', 'ledgers']);

test('every retired legacy command is a usage error that runs nothing', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  for (const retired of [...RETIRED.map((cmd) => [cmd]), []]) {
    const r = await runSealed(retired.length ? [...retired, GOLDEN] : [], { home });
    assert.equal(r.code, 2, `${retired[0] ?? 'bare sonah'} exited ${r.code}`);
    assert.equal(r.stdout, '', `${retired[0] ?? 'bare sonah'} rendered nothing`);
    assert.match(r.stderr, /^usage:/, `${retired[0] ?? 'bare sonah'} printed the usage table`);
  }
  assert.deepEqual(await tree(home), before, 'no retired command touches a file under SONAH_HOME');
});

/** Runs the binary sealed, with `input` written to its stdin (a hook's payload). `writeError` is the code of the error
 *  the writer got (EPIPE when the command exited before reading its stdin), or null. */
function runWithInput(args, input, { home }) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: home,
      env: { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', writeError = null;
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', (error) => { writeError = error?.code ?? 'error'; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code: signal ? 'timeout' : code, stdout, stderr, writeError }); });
    child.stdin.end(input);
  });
}

// D76 (constraint 3 of the B5 inventory): early previews' `sonah init` installed hooks that call `capture` (Stop,
// PreCompact, SessionEnd) and `capture-outcome` (PostToolUse, with the event on stdin) by name, with no `|| true`. An
// unknown command exits 2, which under Claude Code's hook contract blocks a Stop hook and hands stderr to the agent. So
// both stay as commands that exit 0 and write and print nothing; what a hook sends on stdin is read and discarded.
// D77: the git hook `init` wrote into .git/hooks/prepare-commit-msg runs `node "<bin>" trailer "$1" || true`; as an
// unknown command `trailer` printed the usage on every `git commit`, so it stays the same way, and the commit message
// file git hands it is neither read nor changed.
test('the commands old hooks call exit 0 and write and print nothing', async (t) => {
  const home = await sealed(t);
  await writeFile(`${home}/existing`, '');
  const message = 'Synthetic commit subject\n\n# Please enter the commit message for your changes.\n';
  await writeFile(`${home}/COMMIT_EDITMSG`, message);
  const before = await tree(home);
  const payload = JSON.stringify({ session_id: 'synthetic-1', transcript_path: `${home}/synthetic-1.jsonl`, cwd: home,
    hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_use_id: 'toolu_synthetic1',
    tool_response: { exit_code: 1, stdout: '', stderr: '', interrupted: false } });
  const runs = [
    ...['stop', 'precompact', 'sessionend'].map((reason) => [['capture', '--reason', reason], '']),
    [['capture-outcome'], payload],
    [['capture-outcome'], ''],
    [['trailer', `${home}/COMMIT_EDITMSG`], ''],
  ];
  for (const [args, input] of runs) {
    const r = await runWithInput(args, input, { home });
    const name = `${args.join(' ')}${input ? ' (payload)' : ' (empty stdin)'}`;
    assert.equal(r.code, 0, `${name} exited ${r.code}`);
    assert.equal(r.stdout, '', `${name} printed nothing`);
    assert.equal(r.stderr, '', `${name} printed nothing to stderr`);
    assert.equal(r.writeError, null, `${name}: the hook's writer got no error`);
  }
  assert.deepEqual(await tree(home), before, 'nothing appeared under HOME or SONAH_HOME');
  assert.equal(await readFile(`${home}/COMMIT_EDITMSG`, 'utf8'), message, 'trailer left the commit message as it was');
});

// Second B5.2 review (L3): a PostToolUse payload carries the tool's output and can be large. A command that exits
// before reading its stdin leaves the hook's writer with EPIPE once the pipe buffer is full; both commands read what
// they are sent to its end and discard it, never parsing or keeping it.
test('the commands old hooks call drain a 1 MB payload: exit 0, silent, and the writer gets no EPIPE', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  const payload = JSON.stringify({ session_id: 'synthetic-2', hook_event_name: 'PostToolUse', tool_name: 'Bash',
    tool_input: { command: 'cat synthetic.log' }, tool_response: { exit_code: 0, stdout: 'x'.repeat(1024 * 1024), stderr: '' } });
  for (const args of [['capture-outcome'], ['capture', '--reason', 'stop']]) {
    const r = await runWithInput(args, payload, { home });
    assert.deepEqual(r, { code: 0, stdout: '', stderr: '', writeError: null }, args[0]);
  }
  assert.deepEqual(await tree(home), before, 'nothing was stored');
});

// M34 integration review F1: a kept command's output must name only commands the usage table holds (the retirement once
// left `init`'s consent text naming `sonah scan --deep` and `sonah pr --deep`). That text retired with `init` (D76);
// docs/PRIVACY.md ("What leaves your computer") says which commands reach the network.
test('no kept command names a retired command', async (t) => {
  const home = await sealed(t);
  const usage = (await runSealed(['--help'], { home })).stdout;
  const commands = new Set([...usage.matchAll(/^\s+sonah\s+([a-z][a-z-]*)/gm)].map((m) => m[1]));
  for (const args of [['review', '--help'], ['doctor', '--no-probe'], ['feedback'], ['not-a-command']]) {
    const r = await runSealed(args, { home });
    assert.notEqual(r.code, 'timeout', args.join(' '));
    const text = r.stdout + r.stderr;
    for (const retired of RETIRED)
      assert.doesNotMatch(text, new RegExp(`sonah ${retired}\\b`), `${args[0]} names retired \`sonah ${retired}\``);
    for (const [, named] of text.matchAll(/(?<![.\w/-])sonah ([a-z][a-z-]*)/g))
      assert.ok(commands.has(named), `${args[0]} names \`sonah ${named}\`, which the usage table does not hold`);
    assert.doesNotMatch(text, /--deep\b/, `${args[0]} offers --deep, a flag only retired commands had`);
  }
});

// B3: `sonah pr --post` was the only path in the product that could write to GitHub, and it wrote
// a verdict it had not earned. It was refused until the review-quality gate was met; since the owner decision of
// 2026-10-06 `sonah pr` itself is retired. The property this test kept still holds, more strongly: before any token,
// target or range is read, the command stops — now as a usage error — and nothing under SONAH_HOME moves.
test('pr --post stops before it resolves a token, a target or the range (B3; `pr` retired)', async (t) => {
  const home = await sealed(t);
  const repo = await mkdtemp(join(tmpdir(), 'sonah-exit-pr-'));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const before = await tree(home);
  const r = await runSealed(['pr', '--repo', repo, '--post', '--gh-repo', 'o/r', '--pr', '1',
    '--sha', 'a'.repeat(40)], { home, cwd: repo });
  assert.equal(r.code, 2, `pr --post exited ${r.code}`);
  assert.doesNotMatch(r.stderr, /cannot post/, 'no token or target was resolved');
  assert.equal(r.stdout, '', 'nothing was rendered, so nothing was built');
  assert.doesNotMatch(r.stderr, /reading sessions|compiling /, 'the range was never read');
  assert.deepEqual(await tree(home), before, 'a refused command touches no file under SONAH_HOME');
});
