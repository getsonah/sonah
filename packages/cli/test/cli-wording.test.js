// What the terminal says, in plain words for someone who has never seen Sonah: `sonah review --help` lists every option
// it documents (`--profile standard`, the one alternative to the default setting) and no experiment; a usage error
// names the problem; a missing or unwritable --output folder has its own code; a dry run says what it did and what a
// review would do; the top-level help, `sonah help`, `sonah slice` and the debug switch use the product's name.
// Synthetic recordings only; nothing here builds a reviewer or reaches a model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { REVIEW_SPEED_PROFILE_NAMES } from '../../evidence/src/review-profiles.js';
import { dryRunLines, parseSessionReviewArgs, runSessionReviewCommand, sessionReviewUsage }
  from '../src/session-review-command.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const noJudge = () => assert.fail('this path must not construct a reviewer');
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-cli-wording-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-wording', version: '2.1.284' })
    .ask('Read the synthetic file.').read('a.js', 'Synthetic file content.').done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { directory, file, env, options: { cwd: repo, env, installSignals: false, createJudge: noJudge,
    loadReviews: async () => new Map(), openPage: () => assert.fail('nothing here opens a page') } };
}

async function cli(args, { env = {} } = {}) {
  const home = await mkdtemp(join(tmpdir(), 'sonah-cli-wording-home-'));
  try {
    const r = await exec(process.execPath, [BIN, ...args], { cwd: home,
      env: { HOME: home, SONAH_HOME: home, PATH: '/usr/bin:/bin', ...env }, timeout: 30_000 });
    return { code: 0, ...r };
  } catch (e) { return { code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }; }
  finally { await rm(home, { recursive: true, force: true }); }
}

const INTERNAL = /m33|deviation|quality gate|private preview|publication is disabled|Source utility|preflight/i;

test('review --help lists every option it documents, within 80 columns, and no experiment or internal line',
  async () => {
  const out = streams();
  assert.equal(await runSessionReviewCommand(['--help'], out), 0);
  const help = out.chunks.stdout;
  assert.equal(help, `${sessionReviewUsage}\n`);
  assert.match(help, /^sonah review \[session\.jsonl\] \[options\]\n/);
  assert.doesNotMatch(help, INTERNAL);
  // Owner decision 2026-10-13: the default is the lean profile; `--profile standard` is listed as the slower one,
  // and no experiment's name is (INTERNAL).
  assert.match(help, /^ {2}--profile standard {7}check every item in three passes/m);
  assert.deepEqual(help.match(/--profile [\w-]+/g), ['--profile standard', '--profile standard'],
    'the option line and the --concurrency bound name standard, and nothing else');
  for (const option of ['--repo', '--choose', '--dry-run', '--backend', '--model', '--timeout', '--concurrency',
    '--profile', '--format', '--output', '--no-open', '--state-dir', '--max-calls', '--max-input-bytes',
    '--stop-at-utilization', '--github', '--pr', '--post-comment'])
    assert.ok(help.split(/[\s,]+/).includes(option), `${option} is listed`);
  for (const line of help.split('\n')) assert.ok(line.length <= 80, `wider than 80 columns: ${line}`);
  // D97: --format says what each writes (the Markdown report for your pull request, and with html the page beside it),
  // and one line says how gh picks the pull request when you give no number (`gh pr comment --help`).
  assert.match(help, /^ {2}--format md\|html {9}md \(the default\): the report for your pull request$/m);
  assert.match(help, /^ {27}in Markdown\. html: the HTML page, and the Markdown$/m);
  assert.match(help, /^ {27}report beside it \(needs --output\)$/m);
  assert.match(help, /^With no PR number, gh pr comment --body-file FILE posts to your branch's PR\.$/m);
  // --output: only --format html opens a page (the Markdown report alone opens nothing).
  assert.match(help, new RegExp('^ {2}--output FILE {12}write new files, in a folder that exists, instead\\n {27}of '
    + 'printing\\. With --format html, the page opens in\\n {27}your browser$', 'm'));
  assert.doesNotMatch(help, /--edit-last|Markdown story/);
  // Every name is accepted, the unlisted experiments' too: a profile's name may key stored answers.
  for (const profile of REVIEW_SPEED_PROFILE_NAMES)
    assert.equal(parseSessionReviewArgs(['--profile', profile]).profile, profile);
});

test('a usage error names the problem in fixed words, then the usage line, never the whole option list', async () => {
  for (const [args, problem] of [
    [['--fromat', 'html'], 'unknown option --fromat'],
    [['--format', 'pdf'], '--format takes md or html'],
    [['--format', 'html'], '--format html needs --output FILE'],
    [['a.jsonl', 'b.jsonl'], 'more than one recording path is given'],
    [['a.jsonl', '--choose', '1'], 'give a recording path or --choose N, not both'],
    [['--choose', '0'], '--choose needs a whole number from 1'],
    [['--timeout', '2147483648'], '--timeout can be at most 2147483647 milliseconds'],
    [['--concurrency', '13'], '--concurrency can be at most 12'],
    [['--profile', 'standard', '--concurrency', '4'], '--concurrency can be at most 3'],
    [['--backend', 'other'], '--backend takes claude-cli, codex-cli or anthropic-api'],
    [['--profile', 'other'], 'unknown --profile value'],
    [['--output'], '--output needs a value'],
    [['--repo', 'a', '--repo', 'b'], '--repo is given twice'],
    [['--no-open', '--no-open'], '--no-open is given twice'],
    [['--max-calls', '0'], '--max-calls needs a whole number from 1'],
    [['--github', 'example/demo', '--pr', '7'], '--github and --pr are used only with --post-comment'],
    [['--github', 'example/demo', '--pr', '7', '--post-comment'], '--post-comment needs --format html --output FILE'],
    [['--post-comment', '--format', 'html', '--output', 'p.html'],
      '--post-comment needs --github OWNER/REPO and --pr N'],
    [['--github', 'example/demo', '--post-comment', '--format', 'html', '--output', 'p.html'],
      '--post-comment needs --github OWNER/REPO and --pr N'],
    [['--github', 'example', '--pr', '7', '--post-comment', '--format', 'html', '--output', 'p.html'],
      '--github takes OWNER/REPO and --pr a pull request number'],
    [['--github', 'example/demo', '--pr', 'seven', '--post-comment', '--format', 'html', '--output', 'p.html'],
      '--github takes OWNER/REPO and --pr a pull request number'],
  ]) {
    const out = streams();
    assert.equal(await runSessionReviewCommand(args, { ...out, createJudge: noJudge }), 2, args.join(' '));
    assert.equal(out.chunks.stdout, '');
    assert.equal(out.chunks.stderr, `sonah review: ${problem}.\nusage: sonah review [session.jsonl] [options]\n`
      + 'Run sonah review --help to see the options.\n', args.join(' '));
  }
  // A value is never repeated back, nor one given as --name=value; an unknown option is, cut at 40 characters, and a
  // shortened one ends in "..." with no second full stop.
  const value = streams();
  assert.equal(await runSessionReviewCommand(['--format', 'SYNTHETIC_PRIVATE_VALUE'], value), 2);
  assert.doesNotMatch(value.chunks.stderr, /SYNTHETIC_PRIVATE_VALUE/);
  const long = `--${'x'.repeat(60)}`, cut = `--${'x'.repeat(38)}...`;
  for (const [arg, shown] of [[`--token=${'SYNTHETIC_SECRET_'.repeat(3)}`, '--token=...'], [long, cut],
    [`${long}=SYNTHETIC_SECRET`, cut], ['--output=', '--output=...']]) {
    const out = streams();
    assert.equal(await runSessionReviewCommand([arg], out), 2, arg);
    assert.equal(out.chunks.stderr.split('\n')[0], `sonah review: unknown option ${shown}`, arg);
    assert.doesNotMatch(out.chunks.stderr, /SYNTHETIC_SECRET/, arg);
  }
});

test('a missing or unwritable --output folder is named by its own code, before anything is read', async (t) => {
  const input = await fixture(t);
  const blocked = join(input.directory, 'blocked'), afile = join(input.directory, 'a-file');
  await mkdir(blocked); await writeFile(afile, 'synthetic');
  await chmod(blocked, 0o500);
  const cases = [[join(input.directory, 'absent', 'review.html'), 'output_folder_missing'],
    [join(afile, 'review.html'), 'output_folder_missing']];
  // A superuser can write anywhere, so the unwritable folder is checked only where permissions apply.
  if (process.getuid?.() !== 0) cases.push([join(blocked, 'review.html'), 'output_folder_unwritable']);
  try {
    for (const dryRun of [[], ['--dry-run']]) for (const [output, code] of cases) {
      const out = streams();
      assert.equal(await runSessionReviewCommand([input.file, ...dryRun, '--format', 'html', '--output', output], {
        ...input.options, ...out, discover: () => assert.fail('nothing is discovered'),
        loadSession: () => assert.fail('nothing is read') }), 2, output);
      assert.match(out.chunks.stderr, new RegExp(`^Review could not complete: ${code}\\.\\nFix: `));
      assert.match(out.chunks.stderr, /such as ~\/review\.html\.\n$/);
      await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
    }
  } finally { await chmod(blocked, 0o700); }
});

test('a dry run says in plain words what it did and what a review would do', async (t) => {
  const input = await fixture(t), out = streams();
  assert.equal(await runSessionReviewCommand([input.file, '--dry-run'], { ...input.options, ...out }), 0);
  const lines = out.chunks.stdout.trimEnd().split('\n');
  assert.equal(lines[0], `Recording: ${input.file} (claude).`);
  assert.equal(lines[1], 'Dry run: Sonah sent nothing to a model, and wrote or posted nothing.');
  assert.match(lines[2], /^The session has \d+ events, and Sonah would review them in 1 window\.$/);
  assert.match(lines[3], /^A review should take roughly \d+-\d+ minutes \(less if answers are already stored\)\.$/);
  // Owner decision 2026-10-14: beside the estimate, whether the code step runs (on by default) and what it adds; the
  // session only read a.js and changed nothing, so the agentic code step has no change to review and adds no call.
  assert.equal(lines[4], 'Code review: on (the default). It reviews the change with read-only access to the whole '
    + 'repository. It found no change to review here, so it adds no call. Turn it off with --no-code-pass, or for every '
    + 'review with sonah config code-pass off.');
  assert.match(lines[5], /^In the recording: 1 action · 1 message of yours · \d+ known gaps?\.$/);
  assert.doesNotMatch(out.chunks.stdout, /windows;|first requests|runs to the end|No findings were evaluated/);
  assert.doesNotMatch(out.chunks.stdout, INTERNAL);
  assert.equal(out.chunks.stderr, '');
  await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
  assert.deepEqual(dryRunLines({ events: 1, windows: 1, over: 0 }), ['Dry run: Sonah sent nothing to a model, and wrote '
    + 'or posted nothing.', 'The session has 1 event, and Sonah would review it in 1 window.']);
  assert.deepEqual(dryRunLines({ events: 30, windows: 3, over: 2 }).slice(1), ['The session has 30 events, and Sonah '
    + 'would review them in 3 windows.', '2 windows are too large for one call. A review would not send them and would '
    + 'list them as not covered.']);
});

test('the top-level help, sonah help, sonah slice and the debug switch use the product\'s own name', async () => {
  const help = await cli(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Sonah reviews a recorded AI coding session/);
  assert.match(help.stdout, /--output ~\/review\.html/, 'the example writes outside the repository');
  assert.doesNotMatch(help.stdout, INTERNAL);
  for (const line of help.stdout.split('\n')) assert.ok(line.length <= 80, `wider than 80 columns: ${line}`);
  const asked = await cli(['help']);
  assert.deepEqual([asked.code, asked.stdout], [0, help.stdout]);
  const slice = await cli(['slice']);
  assert.deepEqual([slice.code, slice.stderr], [2, 'usage: sonah slice <session.jsonl>\n']);
  // A crash prints one line; SONAH_DEBUG (or its earlier name, DEVIATION_DEBUG) adds the stack trace.
  const missing = join(tmpdir(), 'sonah-cli-wording-absent', 'session.jsonl');
  const plain = await cli(['slice', missing]);
  assert.deepEqual([plain.code, plain.stderr], [3, `sonah: no such file: ${missing}\n`]);
  for (const name of ['SONAH_DEBUG', 'DEVIATION_DEBUG']) {
    const debug = await cli(['slice', missing], { env: { [name]: '1' } });
    assert.equal(debug.code, 3);
    assert.ok(debug.stderr.startsWith(plain.stderr) && debug.stderr.length > plain.stderr.length, name);
  }
});
