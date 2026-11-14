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
  // D171: no test reaches npm's registry: the update check is off in every run of the entry.
  try {
    const r = await exec('node', [BIN, ...args], { env: { ...process.env, SONAH_NO_UPDATE_CHECK: '1' } });
    return { code: 0, ...r };
  }
  catch (e) { return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
}

/** Same, but sealed: its own HOME, and a PATH with no `gh`, `claude` or `codex` on it. */
async function runSealed(args, { home, cwd = home }) {
  const options = { cwd, env: { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin', SONAH_NO_UPDATE_CHECK: '1' },
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

// ---------------------------------------------------- D90: `sonah slice` prints the recording as recorded
// (Moved from capture.test.js when `capture` retired, D76: it tests `analyze`, which `sonah slice` runs.)
//
// M57 made `analyze` hash its ledger after redaction (masking on), and D84 kept that for `sonah slice` while a session
// review read and hashed its bounded, unmasked ledger. D90 (owner decision 2026-10-15, privacy is not a design
// constraint): `sonah slice` masks nothing either. It prints the ledger a review reads — bounded and validated — and
// its hash names that ledger. AKIAIOSFODNN7EXAMPLE is AWS's own published example key, not a credential.

test('D90: sonah slice prints the recorded text, and its hash names the bounded ledger it prints', async () => {
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
  assert.ok(JSON.stringify(raw).includes(KEY), 'the fixture really carries the key');

  const result = await analyze([file]);
  assert.equal(result.hash, sliceHash(result.ledger), 'the hash names the ledger the caller receives');
  assert.equal(result.hash, sliceHash(redact(raw).ledger),
    'the bounded, unmasked ledger a session review reads and hashes');
  assert.ok(JSON.stringify(result.ledger).includes(`AWS_ACCESS_KEY_ID=${KEY} aws s3 ls`), 'the command as recorded');
  assert.ok(!/‹(?:redacted|dropped)/.test(JSON.stringify(result.ledger)), 'nothing is masked');
  // The command prints it.
  const printed = await run('slice', file);
  assert.equal(printed.code, 0, printed.stderr);
  const ledger = JSON.parse(printed.stdout);
  assert.equal(ledger._hash, result.hash);
  assert.ok(ledger.ledger.some((event) => event.cmd === `AWS_ACCESS_KEY_ID=${KEY} aws s3 ls`), 'printed as recorded');
});

// Owner decision 2026-10-06: the legacy gate's product surface is retired. Each retired command is
// now an unknown command — a usage error, exit 2 — that reads, writes and reaches nothing; bare `sonah`, which opened the
// docket on a terminal and ran `scan` in a pipe, prints the usage table the same way when it is not in a terminal (as
// here: the test's pipes). D218: in a terminal, it draws the graphs page instead (d218-bare-sonah.test.js).
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
      env: { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin', SONAH_NO_UPDATE_CHECK: '1' },
      stdio: ['pipe', 'pipe', 'pipe'] });
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

// D225: the hidden `pre-push`, which the push script of `sonah hook add --push` runs at each push, stays for good and
// must never fail, slow or stop a push: it exits 0 and says nothing outside a repository with the push hook, with its
// --help or any other word, with an empty input or a 1 MB one (read to its end, so the writer gets no EPIPE), and
// writes nothing.
test('pre-push exits 0, silent, drains a 1 MB input and writes nothing where no push hook is on', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  const sha = 'a'.repeat(40);
  const refs = `refs/heads/feature ${sha} refs/heads/feature ${'0'.repeat(40)}\n`;
  const big = refs.repeat(Math.ceil((1024 * 1024) / refs.length) + 10);
  for (const [args, input] of [[['pre-push', 'origin', 'ssh://example.invalid/acme/widgets.git'], refs],
    [['pre-push', 'origin', 'ssh://example.invalid/acme/widgets.git'], big], [['pre-push'], ''],
    [['pre-push', '--help'], refs], [['pre-push', '-h'], '']]) {
    const r = await runWithInput(args, input, { home });
    assert.deepEqual(r, { code: 0, stdout: '', stderr: '', writeError: null }, `${args.join(' ')} (${input.length} bytes)`);
  }
  assert.deepEqual(await tree(home), before, 'nothing was stored');
});

// D227: the hidden `push-run --repo DIR`, which `pre-push` starts in the background, stays for good too: it exits 0
// and prints nothing with no argument, with --help, outside a git repository, for a folder that is not there, or with
// its input a 1 MB one (drained), and writes nothing where no push hook left a ticket.
test('push-run exits 0, silent, drains a 1 MB input and writes nothing where no ticket waits', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  const big = 'x'.repeat(1024 * 1024 + 10);
  for (const [args, input] of [[['push-run'], ''], [['push-run', '--help'], ''], [['push-run', '-h'], big],
    [['push-run', '--repo', home], big], [['push-run', '--repo', join(home, 'not there')], ''],
    [['push-run', '--repo', home, '--json'], '']]) {
    const r = await runWithInput(args, input, { home });
    assert.deepEqual(r, { code: 0, stdout: '', stderr: '', writeError: null }, `${args.join(' ')} (${input.length} bytes)`);
  }
  assert.deepEqual(await tree(home), before, 'nothing was stored');
});

// D230: the hidden `remind-hook`, which the SessionStart entry of `sonah remind on` runs at each start of Claude Code,
// and `remind-refresh <folder>`, which the hook starts in the background, stay for good too. Neither may fail or slow
// that start, and Claude Code shows what a hook prints: they exit 0 and print nothing with no connection, with --help or
// any other word, with Claude Code's input, an empty one, one that is not JSON or a 1 MB one (read to its end, so the
// writer gets no EPIPE), and write nothing.
test('remind-hook and remind-refresh exit 0, silent, drain a 1 MB input and write nothing with no connection',
  async (t) => {
    const home = await sealed(t);
    const before = await tree(home);
    const input = JSON.stringify({ session_id: '3c3c3c3c-0000-4000-8000-000000000000', cwd: home,
      hook_event_name: 'SessionStart', source: 'startup' });
    const big = `${input}${' '.repeat(1024 * 1024)}`;
    for (const [args, stdin] of [[['remind-hook'], input], [['remind-hook'], big], [['remind-hook'], ''],
      [['remind-hook'], 'not json'], [['remind-hook', '--help'], input], [['remind-hook', '-h'], ''],
      [['remind-refresh', home], ''], [['remind-refresh'], big], [['remind-refresh', '--help'], ''],
      [['remind-refresh', 'not/absolute'], ''], [['remind-refresh', home, home], '']]) {
      const r = await runWithInput(args, stdin, { home });
      assert.deepEqual(r, { code: 0, stdout: '', stderr: '', writeError: null }, `${args.join(' ')} (${stdin.length} bytes)`);
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
  for (const args of [['review', '--help'], ['doctor', '--no-probe'], ['feedback'], ['not-a-command'], ['status'],
    ['disconnect'], ['connect', 'ABCD-EFGH', '--server', 'http://127.0.0.1:9'], ['share']]) {
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

// D224: the connection commands' codes, from the real entry in a sealed home, with no server to reach: `status` with no
// connection says so and exits 0; `disconnect` with none exits 2; `connect` with a code outside a terminal stops before
// it sends anything (2), as does a usage error (2) and a --token whose standard input holds no token (2). Nothing is
// written under HOME or SONAH_HOME.
test('connect, disconnect and status exit by the contract and write nothing when they do not connect', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  const cases = [
    [['status'], 0, /no connection to a Sonah Team server/],
    [['disconnect'], 2, /no connection to a Sonah Team server/],
    [['connect'], 2, /^sonah connect: give the code/],
    [['connect', 'ABCD-EFGH', '--server', 'http://example.com'], 2, /--server takes an https address/],
    [['connect', 'ABCD-EFGH', '--server', 'http://127.0.0.1:9'], 2, /this is not a terminal\. Sonah sent nothing/],
    [['status', 'now'], 2, /^sonah status: it takes no argument/],
    // The token is read from standard input, here an ended pipe with no token on it.
    [['connect', '--token', '--server', 'http://127.0.0.1:9'], 2, /^That is not an upload token\./],
  ];
  for (const [args, code, said] of cases) {
    const r = args[1] === '--token' ? await runWithInput(args, '\n', { home }) : await runSealed(args, { home });
    assert.equal(r.code, code, args.join(' '));
    assert.match(r.stdout + r.stderr, said, args.join(' '));
    assert.doesNotMatch(r.stderr, /at .*\(node:/, 'no stack trace');
  }
  assert.deepEqual(await tree(home), before, 'nothing appeared under HOME or SONAH_HOME');
});

// D228 review 3: `sonah share`'s codes, from the real entry in a sealed home, with no server to reach. D228's contract
// names this file among the tests that pin share's behaviour, and no case here ran a share. A usage error exits 2
// before anything is read, and with no connection the share says so and exits 2 in a folder that is no git repository,
// since it reads the connection first. Nothing is written under HOME or SONAH_HOME.
test('share exits by the contract with no connection, and a usage error stops it before that', async (t) => {
  const home = await sealed(t);
  const before = await tree(home);
  const cases = [
    [['share'], 2, /^This computer has no connection to Sonah Team now\./],
    [['share', 'now'], 2, /^sonah share: it takes no argument/],
    [['share', '--dir'], 2, /^sonah share: --dir needs a value/],
    [['share', '--branch', 'a', '--branch', 'b'], 2, /^sonah share: --branch is given twice/],
    [['share', '--out', 'x'], 2, /^sonah share: unknown option --out/],
  ];
  for (const [args, code, said] of cases) {
    const r = await runSealed(args, { home });
    assert.equal(r.code, code, args.join(' '));
    assert.match(r.stdout + r.stderr, said, args.join(' '));
    assert.doesNotMatch(r.stderr, /at .*\(node:/, 'no stack trace');
  }
  assert.deepEqual(await tree(home), before, 'nothing appeared under HOME or SONAH_HOME');
});
