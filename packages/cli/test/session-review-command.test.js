// B2: temporary synthetic recordings and fake transport only. No user recordings or provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL, planWindowRequests } from '../../evidence/src/run-review.js';
import { requestBoundOf, reviewSpeedProfile } from '../../evidence/src/review-profiles.js';
import { requestFits, reviewInputBytes } from '../../evidence/src/challenge.js';
import { estimateMinutes } from '../src/review-budget.js';
import { loadRecordedSessionWithHash } from '../src/recorded-session.js';
import { DEFAULT_REVIEW_PROFILE, parseSessionReviewArgs, runSessionReviewCommand, sessionReviewUsage }
  from '../src/session-review-command.js';

const ASK = 'Read the synthetic file.';
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: text => { chunks.stdout += text; } },
    stderr: { write: text => { chunks.stderr += text; } } };
};
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-session-command-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), repo = join(directory, 'repo');
  await mkdir(home); await mkdir(repo);
  const file = join(directory, 'recording.jsonl');
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-command', version: '2.1.284' })
    .ask(ASK).read('a.js', 'Synthetic file content.').done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  return { directory, home, repo, file, env, options: { cwd: repo, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {} } };
}
const noJudge = () => assert.fail('this path must not construct a reviewer');
function fakeTransport({ calls = [], metadata = {}, before = null } = {}) {
  return ({ onResult, config }) => async (request) => {
    calls.push(request);
    if (before) await before(request);
    onResult({ ok: true, backend: config.backend, attestation: config.backend === 'claude-cli' ? 'attested' : 'unattested',
      contextWindow: config.backend === 'claude-cli' ? 1_000_000 : null, ...metadata });
    if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: 'The synthetic recording contains the cited read.',
      receipts: candidate.receipts })) };
    const instruction = request.window.events.find(event => event.kind === 'instruction');
    const action = request.window.events.find(event => event.kind === 'invocation');
    return { decisions: [], pivots: [], claims: [], requirements: instruction && action ? [{
      text: ASK, instruction: { eventId: instruction.id, role: 'instruction', quote: ASK }, status: 'done',
      deliverable: { eventId: action.id, role: 'action', quote: 'a.js' } }] : [],
      failures: [], notClaims: [], forbiddenEdits: [] };
  };
}
const stateOf = (input) => join(input.env.SONAH_HOME, 'session-reviews',
  createHash('sha256').update(input.file).digest('hex'));
/** These tests pin the session's review alone, so the code step (on by default, owner decision 2026-10-14) is turned off
 *  for each of them with its flag; code-pass-command.test.js and code-step-setting.test.js test the code step and its
 *  setting, and that the session's requests are the same bytes either way. */
const sessionOnly = (argv, dependencies) => runSessionReviewCommand([...argv, '--no-code-pass'], dependencies);

test('session command grammar is strict and documents the one review route and its PR comment', () => {
  // D82 step 10: the combined code review (--base, --head, --github/--pr as a code target) is removed.
  assert.doesNotMatch(sessionReviewUsage, /--base|--head/);
  assert.match(sessionReviewUsage, /--github OWNER\/REPO --pr N --post-comment/);
  assert.match(sessionReviewUsage, /claude-cli\|codex-cli\|anthropic-api/);
  assert.deepEqual(parseSessionReviewArgs([]), { dryRun: false, noOpen: false, format: 'md', profile: 'm33-lean',
    concurrency: 4, maxCalls: null, maxInputBytes: null, stopAtUtilization: null });
  assert.equal(parseSessionReviewArgs(['--no-open']).noOpen, true);
  const parsed = parseSessionReviewArgs(['--repo', 'repo', '--choose', '2', '--timeout', '60000',
    '--profile', 'm33-lean', '--concurrency', '12', '--format', 'html', '--output', 'page.html']);
  assert.equal(parsed.choose, 2); assert.equal(parsed.timeoutMs, 60000); assert.equal(parsed.concurrency, 12);
  for (const args of [['a', 'b'], ['--unknown'], ['--base', 'main'], ['--choose', '0'], ['--choose', '01'],
    ['a', '--choose', '1'], ['--concurrency', '13'], ['--profile', 'standard', '--concurrency', '4'],
    ['--profile', 'unknown'], ['--timeout', '2147483648'],
    ['--dry-run', '--dry-run'], ['--no-open', '--no-open'], ['--repo', 'a', '--repo', 'b'], ['--format', 'pdf'], ['--format', 'html'],
    ['--backend', 'unknown'], ['--model']]) assert.throws(() => parseSessionReviewArgs(args), { code: 'usage' });
});

test('session budget flags have strict usage grammar and dry runs still construct no reviewer', async (t) => {
  for (const args of [['--max-calls', '0'], ['--max-calls', '01'], ['--max-input-bytes', '1e6'],
    ['--stop-at-utilization', '0'], ['--stop-at-utilization', '0.9000001'], ['--stop-at-utilization', '1.01'],
    ['--max-calls', '2', '--max-calls', '3']])
    assert.throws(() => parseSessionReviewArgs(args), { code: 'usage' });
  const input = await fixture(t), out = streams();
  const parsed = parseSessionReviewArgs(['--max-calls', '1', '--max-input-bytes', '1', '--stop-at-utilization', '0.5']);
  assert.equal(parsed.maxCalls, 1); assert.equal(parsed.maxInputBytes, 1); assert.equal(parsed.stopAtUtilization, 0.5);
  assert.equal(await runSessionReviewCommand([input.file, '--dry-run', '--max-calls', '1'], {
    ...input.options, ...out, createJudge: noJudge }), 0);
  assert.doesNotMatch(out.chunks.stdout, /Review usage:|Review stopped where you asked/);
});

test('session physical-call pause retains narrative and resumes only unanswered challenges', async (t) => {
  const input = await fixture(t), calls = [], out = streams();
  const argv = [input.file, '--concurrency', '1', '--max-calls', '1'];
  assert.equal(await sessionOnly(argv, { ...input.options, ...out,
    createJudge: fakeTransport({ calls, metadata: { usage: { input_tokens: 10, cache_read_input_tokens: 5,
      cache_creation_input_tokens: 2, output_tokens: 3 } } }) }), 3);
  assert.equal(calls.length, 1);
  assert.match(out.chunks.stdout, /Review usage: 1 calls/);
  assert.match(out.chunks.stdout, /input tokens 17 \(1\/1 calls reported\)/);
  assert.match(out.chunks.stdout, /output tokens 3 \(1\/1 calls reported\)/);
  assert.match(out.chunks.stdout, /Review stopped where you asked \(max_calls\)/);
  // D84 (4) a: the estimate is a rough time only.
  assert.match(out.chunks.stdout,
    /This review should take roughly \d+-\d+ minutes \(less if answers are already stored\)\./);
  assert.doesNotMatch(out.chunks.stdout, /should take[^\n]*(model calls|MB|window)/);
  const progress = JSON.parse(await readFile(join(stateOf(input), 'review', 'progress.json'), 'utf8'));
  assert.equal(progress.state, 'interrupted');
  assert.ok((await readdir(join(stateOf(input), 'answers'))).length > 0);
  await assert.rejects(stat(join(stateOf(input), 'review', 'active.lock')), { code: 'ENOENT' });
  const resumedCalls = [], resumed = streams();
  assert.equal(await sessionOnly([input.file, '--concurrency', '1'], { ...input.options, ...resumed,
    createJudge: fakeTransport({ calls: resumedCalls }) }), 0);
  assert.ok(resumedCalls.length > 0); assert.ok(resumedCalls.every(request => request.challenge));
  assert.match(resumed.chunks.stdout, /input tokens not reported/);
  const cached = streams();
  assert.equal(await sessionOnly([input.file, '--concurrency', '1'], { ...input.options, ...cached,
    createJudge: () => async () => assert.fail('stored answers need no new transport') }), 0);
  assert.match(cached.chunks.stdout, /Review usage: 0 calls/);
  assert.match(cached.chunks.stdout, /input tokens 0 \(0\/0 calls reported\)/);
});

test('session byte and reported-utilization pauses never open or output a completed review', async (t) => {
  for (const kind of ['bytes', 'utilization']) {
    const input = await fixture(t), calls = [], out = streams(), output = join(input.repo, 'paused.html');
    const options = kind === 'bytes' ? ['--max-input-bytes', '1'] : ['--stop-at-utilization', '0.5'];
    const metadata = kind === 'utilization' ? { rateLimit: { status: 'allowed_warning', rateLimitType: 'seven_day',
      utilization: 0.75, resetsAt: 1_000 } } : {};
    assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', output, ...options], {
      ...input.options, ...out, createJudge: fakeTransport({ calls, metadata }),
      openPage: () => assert.fail('an interrupted review must not open a completed page') }), 3);
    assert.equal(calls.length, kind === 'bytes' ? 0 : 1);
    assert.match(out.chunks.stdout, kind === 'bytes' ? /Review stopped where you asked \(max_input_bytes\)/ : /Review stopped where you asked \(utilization\)/);
    assert.doesNotMatch(out.chunks.stdout, /Local page:|<!doctype html>/i);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    if (kind === 'utilization') {
      assert.match(out.chunks.stdout, /utilization 0.75/);
      const progress = JSON.parse(await readFile(join(stateOf(input), 'review', 'progress.json'), 'utf8'));
      assert.equal(progress.rateLimit.utilization, 0.75);
      const resumed = streams(), resumedCalls = [];
      assert.equal(await sessionOnly([input.file], { ...input.options, ...resumed,
        createJudge: fakeTransport({ calls: resumedCalls }) }), 0);
      assert.ok(resumedCalls.every(request => request.challenge), 'the in-flight narrative survived the utilization pause');
    }
  }
});

test('help, invalid arguments and no discovered sessions do not load, call models or write state', async (t) => {
  const input = await fixture(t);
  for (const [args, code] of [[['--help'], 0], [['--unknown'], 2], [[], 1]]) {
    const out = streams(); let scans = 0;
    assert.equal(await runSessionReviewCommand(args, { ...input.options, ...out, createJudge: noJudge,
      openPage: () => assert.fail('preflight must not open'),
      discover: async ({ repo, claudeProjects, codexHome }) => {
        scans++; assert.equal(repo, input.repo); assert.equal(claudeProjects, input.env.SONAH_CLAUDE_PROJECTS);
        assert.equal(codexHome, input.env.CODEX_HOME); return { sessions: [] };
      }, loadSession: async () => assert.fail('nothing selected') }), code);
    assert.equal(scans, args.length ? 0 : 1);
    if (!args.length) {
      assert.match(out.chunks.stdout, /No Claude Code or Codex session was found/);
      assert.ok(out.chunks.stdout.includes(input.env.SONAH_CLAUDE_PROJECTS));
      assert.ok(out.chunks.stdout.includes(input.env.CODEX_HOME));
      assert.match(out.chunks.stdout, /SONAH_CLAUDE_PROJECTS or CODEX_HOME/);
    }
    await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
  }
});

test('dry run selects latest or numbered recording, uses configured helper roots, and makes no model or history writes', async (t) => {
  const input = await fixture(t);
  const discovery = { sessions: [{ file: input.file, adapter: 'claude' }, { file: input.file, adapter: 'codex' }] };
  for (const choose of [[], ['--choose', '2']]) {
    const out = streams(), output = join(input.directory, `dry-${choose.length}.html`);
    let loaded = 0;
    assert.equal(await runSessionReviewCommand([...choose, '--dry-run', '--backend', 'anthropic-api',
      '--format', 'html', '--output', output], { ...input.options, ...out, discover: async () => discovery,
      openPage: () => assert.fail('dry run must not open'),
      loadSession: async (args) => {
        loaded++; assert.deepEqual(args, { parent: input.file, codexHome: input.env.CODEX_HOME,
          claudeProjects: input.env.SONAH_CLAUDE_PROJECTS, sessionKey: 'session' });
        return loadRecordedSessionWithHash(args);
      }, loadReviews: async () => assert.fail('dry run must not read decision responses'), createJudge: noJudge }), 0);
    assert.equal(loaded, 1);
    assert.match(out.chunks.stdout, choose.length ? /\(codex\)/ : /\(claude\)/);
    assert.match(out.chunks.stdout, /^Dry run: nothing was sent to a model, written or posted\.$/m);
    await assert.rejects(stat(output), { code: 'ENOENT' });
    await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
  }
});

// D84 (4) a, its review: the route feeds the estimate the plan's own windows: one size per window it sends (a window
// over the review's request bound is declared unreviewed and never sent), in the profile's lanes or --concurrency.
// Three windows of a codex-cli review (each long thought opens a window), the last over its bound.
test('the estimate is the plan\'s time: one size per window sent, in the lanes or --concurrency', async (t) => {
  const input = await fixture(t), file = join(input.directory, 'windows.jsonl');
  let built = recording({ cwd: input.repo, sessionId: 'synthetic-estimate', version: '2.1.284' }).ask(ASK);
  for (const [n, bytes] of [120_000, 120_000, 120_000, 700_000].entries())
    built = built.say(`Reading the next file.\n${'s'.repeat(bytes)}`).read(`f${n}.js`, 'Synthetic file content.');
  await writeFile(file, toJsonl(built.done()) + '\n');
  const { session } = await loadRecordedSessionWithHash({ parent: file, codexHome: input.env.CODEX_HOME,
    claudeProjects: input.env.SONAH_CLAUDE_PROJECTS, sessionKey: 'session' });
  const { requests } = planWindowRequests({ session, reviewScope: 'session-only', backend: 'codex-cli',
    speedProfile: DEFAULT_REVIEW_PROFILE });
  const bound = requestBoundOf(reviewSpeedProfile(DEFAULT_REVIEW_PROFILE), 'session-only', 'codex-cli');
  const sizes = requests.map(({ request }) => reviewInputBytes(request));
  const sent = requests.filter(({ request }) => requestFits(request, bound))
    .map(({ request }) => reviewInputBytes(request));
  assert.deepEqual([sizes.length, sent.length], [3, 2], 'three windows, the last over the bound');
  const lanes = reviewSpeedProfile(DEFAULT_REVIEW_PROFILE).windowConcurrency;
  const expected = estimateMinutes({ requestBytes: sent, lanes });
  const oneLane = estimateMinutes({ requestBytes: sent, lanes: 1 });
  // The case tells the wiring apart: one summed size, one lane, or the window never sent each quote another time.
  for (const other of [estimateMinutes({ requestBytes: [sent[0] + sent[1]], lanes }), oneLane,
    estimateMinutes({ requestBytes: sizes, lanes })]) assert.notDeepEqual(other, expected);
  for (const [args, [lo, hi]] of [[[], expected], [['--concurrency', '1'], oneLane]]) {
    const out = streams();
    assert.equal(await runSessionReviewCommand([file, '--dry-run', '--backend', 'codex-cli', ...args],
      { ...input.options, ...out, createJudge: noJudge }), 0);
    assert.match(out.chunks.stdout, /^The session has \d+ events, to be reviewed in 3 windows\.$/m);
    assert.match(out.chunks.stdout, /^1 window is too large for one request: a review would not send it and /m);
    assert.ok(out.chunks.stdout.includes(`A review should take roughly ${lo}-${hi} minutes (less if answers are `
      + 'already stored).\n'), out.chunks.stdout);
  }
});

test('explicit synthetic recording uses actual loader and engine, defaults to Claude 1M, and resumes exact answers and HTML', async (t) => {
  const input = await fixture(t), calls = [], first = join(input.directory, 'first.html'), second = join(input.directory, 'second.html');
  let historyReads = 0;
  const options = { ...input.options, ...streams(), discover: async () => assert.fail('explicit path must not scan'),
    loadReviews: async () => { historyReads++; return new Map(); }, createJudge: (args) => {
      assert.equal(args.config.model, SESSION_REVIEW_CLAUDE_CLI_MODEL);
      return fakeTransport({ calls })(args);
    } };
  const argv = output => [input.file, '--format', 'html', '--output', output];
  assert.equal(await sessionOnly(argv(first), options), 0);
  assert.ok(calls.length > 0);
  assert.equal(options.chunks.stderr.includes('code review'), false);
  assert.match(options.chunks.stdout, /session review complete/);
  const sent = calls.length;
  assert.equal(await sessionOnly(argv(second), options), 0);
  assert.equal(calls.length, sent, 'identical requests are answered from exact transport cache');
  assert.equal(historyReads, 2);
  const html = await readFile(first, 'utf8');
  assert.match(html, /^<!doctype html>/i); assert.match(html, /Content-Security-Policy/);
  assert.match(html, /Read the synthetic file/);
  assert.equal(await readFile(second, 'utf8'), html);
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  const progress = JSON.parse(await readFile(join(stateOf(input), 'review', 'progress.json'), 'utf8'));
  assert.equal(progress.attempt, 2); assert.equal(progress.calls.live, 0); assert.ok(progress.calls.reused > 0);
  assert.ok((await readdir(join(stateOf(input), 'answers'))).length > 0);
});

test('HTML announces an absolute path and opens only a successfully saved page, with headless and failure alternatives', async t => {
  const input = await fixture(t), opened = [];
  const names = ["owner's 100% # page.html", 'headless.html', 'opener-failed.html'];
  for (let index = 0; index < names.length; index++) {
    const out = streams(), output = join(input.repo, names[index]);
    const argv = [input.file, '--format', 'html', '--output', names[index], ...(index === 1 ? ['--no-open'] : [])];
    const code = await sessionOnly(argv, { ...input.options, ...out, createJudge: fakeTransport(),
      openPage: async file => {
        assert.equal(file, output);
        assert.ok(out.chunks.stdout.includes(`Local page: ${output}\n`));
        assert.match(await readFile(file, 'utf8'), /^<!doctype html>/i);
        opened.push(file);
        if (index === 2) throw new Error('SYNTHETIC_PRIVATE_OPENER_ERROR');
      } });
    assert.equal(code, 0, 'an opener error must not change the completed review result');
    assert.ok(out.chunks.stdout.includes(`Local page: ${output}\n`));
    assert.match(await readFile(output, 'utf8'), /^<!doctype html>/i);
    if (index === 2) {
      assert.match(out.chunks.stderr, /page is saved.*could not be opened automatically/);
      assert.match(out.chunks.stderr, /Open the printed HTML path.*--no-open/);
      assert.doesNotMatch(out.chunks.stderr, /SYNTHETIC_PRIVATE_OPENER_ERROR/);
    }
  }
  assert.deepEqual(opened, [join(input.repo, names[0]), join(input.repo, names[2])]);
});

test('a competing output created after review admission is preserved and never opened', async t => {
  const input = await fixture(t), out = streams(), output = join(input.repo, 'competing.html');
  const code = await runSessionReviewCommand([input.file, '--format', 'html', '--output', output], {
    ...input.options, ...out, createJudge: fakeTransport({ before: async () => writeFile(output, 'synthetic competing page') }),
    openPage: () => assert.fail('failed output write must not open'),
  });
  assert.equal(code, 2);
  assert.match(out.chunks.stderr, /output_exists/);
  assert.equal(await readFile(output, 'utf8'), 'synthetic competing page');
  assert.doesNotMatch(out.chunks.stdout, /Local page:/);
});

test('missing recording, out-of-range choice and existing output refuse before spending or changing state', async (t) => {
  const input = await fixture(t), output = join(input.directory, 'existing.html');
  await writeFile(output, 'prior page');
  for (const args of [[join(input.directory, 'absent.jsonl')], ['--choose', '2'],
    [input.file, '--format', 'html', '--output', output]]) {
    const out = streams();
    assert.equal(await runSessionReviewCommand(args, { ...input.options, ...out, createJudge: noJudge,
      openPage: () => assert.fail('missing input or existing output must not open'),
      discover: async () => ({ sessions: [{ file: input.file, adapter: 'claude' }] }) }), 2);
    assert.match(out.chunks.stderr, /session_not_found|output_exists/);
    assert.match(out.chunks.stderr, /Fix:/);
    await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
  }
  assert.equal(await readFile(output, 'utf8'), 'prior page');
});

test('a changed reviewer model does not reuse another model answers; Markdown remains available', async (t) => {
  const input = await fixture(t), calls = [];
  for (const model of ['gpt-synthetic-a', 'gpt-synthetic-b']) {
    const out = streams(), before = calls.length;
    assert.equal(await sessionOnly([input.file, '--backend', 'codex-cli', '--model', model],
      { ...input.options, ...out, createJudge: fakeTransport({ calls }) }), 0);
    assert.ok(calls.length > before);
    assert.match(out.chunks.stdout, /Read the synthetic file/);
    assert.doesNotMatch(out.chunks.stdout, /<!doctype html>/i);
  }
});

test('explicit state directory contains reports and exact-answer reuse without touching default state', async (t) => {
  const input = await fixture(t), calls = [], options = { ...input.options, ...streams(), createJudge: fakeTransport({ calls }) };
  const args = [input.file, '--state-dir', 'private-state'];
  assert.equal(await sessionOnly(args, options), 0);
  const sent = calls.length;
  assert.equal(await sessionOnly(args, options), 0);
  assert.equal(calls.length, sent);
  assert.ok((await readdir(join(input.repo, 'private-state', 'answers'))).length > 0);
  assert.ok((await stat(join(input.repo, 'private-state', 'review', 'report.private.json'))).isFile());
  await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
});

test('Claude aliases and unattested or wrong-context answers cannot enter the answer cache', async (t) => {
  for (const [argv, metadata] of [[['--model', 'sonnet'], null], [[], { attestation: 'unattested' }],
    [[], { contextWindow: 200000 }]]) {
    const input = await fixture(t), out = streams(), calls = [];
    const code = await runSessionReviewCommand([input.file, ...argv], { ...input.options, ...out,
      createJudge: metadata ? fakeTransport({ calls, metadata }) : noJudge });
    assert.equal(code, metadata ? 3 : 2);
    assert.match(out.chunks.stderr, metadata ? /model_unavailable/ : /invalid_model/);
    if (metadata) {
      assert.equal(calls.length, 1);
      await assert.rejects(stat(join(stateOf(input), 'answers')), { code: 'ENOENT' });
    } else await assert.rejects(stat(input.env.SONAH_HOME), { code: 'ENOENT' });
  }
});

test('interruption releases the lock, names resume, and failure text stays private', async (t) => {
  const input = await fixture(t), out = streams(), controller = new AbortController();
  controller.abort();
  assert.equal(await runSessionReviewCommand([input.file], { ...input.options, ...out,
    signal: controller.signal, createJudge: noJudge }), 3);
  assert.match(out.chunks.stderr, /review_interrupted/);
  assert.match(out.chunks.stderr, /same command again to resume/);
  await assert.rejects(stat(join(stateOf(input), 'review', 'active.lock')), { code: 'ENOENT' });
  const failed = streams();
  assert.equal(await runSessionReviewCommand([input.file], { ...input.options, ...failed,
    loadSession: async () => { throw new Error('SYNTHETIC_PRIVATE_PROVIDER_TEXT'); }, createJudge: noJudge }), 3);
  assert.match(failed.chunks.stderr, /review_failed/);
  assert.doesNotMatch(failed.chunks.stderr, /SYNTHETIC_PRIVATE_PROVIDER_TEXT|Error:|at /);
});

test('an interrupted live review resumes its stored narrative without another physical narrative call', async (t) => {
  const input = await fixture(t), controller = new AbortController(), firstCalls = [], first = streams();
  assert.equal(await sessionOnly([input.file, '--concurrency', '1'], { ...input.options, ...first,
    signal: controller.signal, createJudge: fakeTransport({ calls: firstCalls, before: () => controller.abort() }) }), 3);
  assert.equal(firstCalls.length, 1);
  assert.match(first.chunks.stderr, /review_interrupted/);
  assert.ok((await readdir(join(stateOf(input), 'answers'))).length > 0, 'the completed answer survived interruption');
  await assert.rejects(stat(join(stateOf(input), 'review', 'active.lock')), { code: 'ENOENT' });
  const resumedCalls = [], resumed = streams();
  assert.equal(await sessionOnly([input.file, '--concurrency', '1'], { ...input.options, ...resumed,
    createJudge: fakeTransport({ calls: resumedCalls }) }), 0);
  assert.ok(resumedCalls.length > 0);
  assert.ok(resumedCalls.every(request => request.challenge), 'only unanswered challenges were sent live');
  assert.match(resumed.chunks.stdout, /Model answers: 1 of \d+ reused/);
});

// D69 f (g): the round trip an earlier page script's test pinned, re-pointed to the live path (second B5.2
// review, L2): `sonah review --format html` writes the page, the `sonah decision` binary records an answer against the
// report that review wrote, and the next page `sonah review` writes shows it under its decision and changes nothing else.
test('D69 f (g) an answer recorded with `sonah decision` is shown under its decision the next time sonah review writes the page', async (t) => {
  const input = await fixture(t);
  // D83 (3): a decision citing only a read is the agent's housekeeping and is not listed, so this recording also edits
  // the file inside the repository, and the decision cites the edit.
  await writeFile(input.file, toJsonl(recording({ cwd: input.repo, sessionId: 'synthetic-command', version: '2.1.284' })
    .ask(ASK).read('a.js', 'Synthetic file content.').edit('a.js', 'Synthetic', 'Edited').done()) + '\n');
  // The command's own reader of recorded answers (decision-reviews.js) reads SONAH_HOME from the process environment.
  const saved = process.env.SONAH_HOME;
  process.env.SONAH_HOME = input.env.SONAH_HOME;
  t.after(() => { if (saved === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = saved; });
  const { loadReviews: stub, ...live } = input.options; // without the fixture's stub, the command reads the answers file
  const deciding = (args) => {
    const base = fakeTransport()(args);
    return async (request) => {
      const answer = await base(request);
      if (request.challenge) return answer;
      const instruction = request.window.events.find(event => event.kind === 'instruction');
      const action = request.window.events.find(event => event.kind === 'invocation' && event.operation === 'edit');
      return { ...answer, decisions: [{ dimension: 'which file to edit', chosen: 'Edit a.js', value: 'a.js',
        valueReceipt: { eventId: action.id, field: 'path', role: 'action', quote: 'a.js' }, actions: [action.id], stated: null,
        constrainedBy: { instruction: { eventId: instruction.id, role: 'instruction', quote: ASK }, settles: false,
          settledValueQuote: null } }] };
    };
  };
  const page = async (name) => {
    const out = streams(), output = join(input.directory, name);
    assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', output, '--no-open'], { ...live,
      ...out, openPage: () => assert.fail('--no-open never opens the page'), createJudge: deciding }), 0, out.chunks.stderr);
    return readFile(output, 'utf8');
  };
  const before = await page('before.html');
  const { hash } = await loadRecordedSessionWithHash({ parent: input.file, codexHome: input.env.CODEX_HOME,
    claudeProjects: input.env.SONAH_CLAUDE_PROJECTS, sessionKey: 'session' });
  const report = join(stateOf(input), 'review', 'report.private.json');
  const { decisions } = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(decisions.length, 1, 'premise: the review kept the one decision');
  const short = decisions[0].id.slice('sha256:'.length, 'sha256:'.length + 12);
  // Page /14 (D77 B): the command is printed once, with ROW_ID in the id's place; each row names its short id.
  assert.ok(before.includes(`sonah decision accept|change|clarify ${hash} ROW_ID --report REPORT`),
    'the command names the session hash');
  assert.ok(before.includes(`<span class="label">Decision id</span> <code>${short}</code>`), 'the row names its id');
  // The command and where the report is kept name no folder of this computer's.
  for (const value of [input.directory, report]) assert.equal(before.includes(value), false, 'the page is path-free');
  assert.doesNotMatch(before, /class="note answer"/);
  const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [BIN, 'decision', 'change', hash, short, '--report', report,
    '--reason', 'Read the other file.'], { cwd: input.directory,
    env: { PATH: '/usr/bin:/bin', HOME: input.home, SONAH_HOME: input.env.SONAH_HOME } });
  assert.equal(stdout, `recorded: change ${short}\n`);
  const after = await page('after.html');
  assert.match(after, /<p class="note answer"><span class="label">Your answer<\/span> You asked to change it\. Your reason: Read the other file\.<\/p>/);
  assert.equal(after.replace(/<p class="note answer">.*?<\/p>/, ''), before, 'the answer changes nothing else');
});

// ---- D82 step 10: the count-only PR comment, moved onto the session review ------------------------------------
const COMMENT = ['--github', 'example/demo', '--pr', '7', '--post-comment', '--format', 'html'];
const SHARING = { SONAH_GITHUB_ACTOR_ID: '7', SONAH_GITHUB_APP_ID: '9' };
/** A fake GitHub: the PR's metadata, the review and check writes. `reads` and `writes` record every request.
 *  `isPrivate(n)` answers the n-th metadata read (1-based); `status` is the metadata read's HTTP status. */
function fakeGitHub({ isPrivate = () => true, status = 200 } = {}) {
  const value = { reads: [], writes: [], reviews: [] };
  let metadataReads = 0;
  value.client = { async request(request) {
    if (request.method === 'GET') {
      value.reads.push(request.path);
      if (request.path === '/repos/example/demo/pulls/7' && request.headers === undefined) {
        if (status !== 200) return { status, data: {} };
        return { status: 200, data: { number: 7, base: { sha: 'b'.repeat(40), repo: { id: 42, name: 'demo',
          private: isPrivate(++metadataReads), owner: { login: 'example' } } }, head: { sha: 'a'.repeat(40) } } };
      }
      if (request.path.includes('/reviews?')) return { status: 200, data: structuredClone(value.reviews) };
      if (request.path.includes('/check-runs?')) return { status: 200, data: { check_runs: [] } };
      assert.fail(`the comment reads only the PR's metadata, not ${request.path}`);
    }
    value.writes.push(structuredClone(request));
    if (request.path.endsWith('/reviews')) {
      const review = { ...structuredClone(request.body), id: 101, state: 'PENDING', user: { id: 7 } };
      value.reviews.push(review); return { status: 200, data: review };
    }
    if (request.path.endsWith('/events')) {
      Object.assign(value.reviews[0], { state: 'COMMENTED', body: request.body.body });
      return { status: 200, data: structuredClone(value.reviews[0]) };
    }
    return { status: 201, data: { ...structuredClone(request.body), id: 201, app: { id: 9 } } };
  } };
  return value;
}
const refusingClient = { request: async () => assert.fail('this path must not reach GitHub') };

test('D82 step 10 the PR comment flags go together, only with the page, and name nothing but the PR', () => {
  const parsed = parseSessionReviewArgs([...COMMENT, '--output', 'page.html']);
  assert.deepEqual([parsed.github, parsed.number, parsed.postComment], ['example/demo', 7, true]);
  for (const args of [['--post-comment'], ['--github', 'example/demo', '--pr', '7'], ['--github', 'example/demo'],
    [...COMMENT], ['--github', 'example/demo', '--pr', '7', '--post-comment', '--output', 'page.md'],
    [...COMMENT.slice(0, 2), '--pr', '0', ...COMMENT.slice(4), '--output', 'p.html'],
    ['--github', 'example', '--pr', '7', '--post-comment', '--format', 'html', '--output', 'p.html'],
    // Names the GitHub client would refuse (client.js `targetPath`) are refused here, before any review.
    ...['a_b/demo', '.x/demo', '-x/demo', 'example/..', 'example/demo/extra', '/demo', 'example/']
      .map((name) => ['--github', name, '--pr', '7', '--post-comment', '--format', 'html', '--output', 'p.html']),
    [...COMMENT, '--output', 'p.html', '--post-comment'], ['--base', 'main'], ['--head', 'HEAD']])
    assert.throws(() => parseSessionReviewArgs(args), { code: 'usage' }, args.join(' '));
});

test('D82 step 10 a confirmed comment is built from the session review\'s checklist, posted after the page',
  async (t) => {
  const input = await fixture(t), out = streams(), github = fakeGitHub(), output = join(input.repo, 'page.html');
  let opened = null, previewed = null;
  const code = await sessionOnly([input.file, ...COMMENT, '--output', output], { ...input.options, ...out,
    env: { ...input.env, ...SHARING }, client: github.client, createJudge: fakeTransport(),
    openPage: async (path) => { opened = path; },
    confirm: async ({ body }) => {
      assert.equal(opened, output, 'the page is written and opened first');
      previewed = body; return true;
    } });
  assert.equal(code, 0, out.chunks.stderr);
  // The PR's metadata only (read again by the publisher before each write): never its files or diff.
  assert.deepEqual([...new Set(github.reads.filter((path) => !path.includes('?')))], ['/repos/example/demo/pulls/7']);
  assert.equal(github.writes.length, 3);
  assert.equal(github.writes[1].body.event, 'COMMENT');
  assert.equal(github.writes[2].body.conclusion, 'neutral');
  const body = github.writes[0].body.body;
  assert.equal(body, previewed);
  assert.match(out.chunks.stdout, /PR comment preview for example\/demo#7, head a{40}:/);
  assert.match(body, /^Sonah advisory review\n\nSonah's review ran to completion\./);
  assert.doesNotMatch(body, /Read the synthetic file|a\.js|Synthetic file content/, 'counts and fixed words only');
  assert.match(out.chunks.stdout, /PR comment and neutral advisory check posted\./);
  // The journal sits beside the session review's own state.
  assert.ok((await readdir(join(stateOf(input), 'publication'))).some((name) => name.endsWith('.json')));
});

test('D82 step 10 without confirmation nothing is posted, and posting is off unless asked', async (t) => {
  for (const answer of [false, null]) {
    const input = await fixture(t), out = streams(), github = fakeGitHub();
    const code = await sessionOnly([input.file, ...COMMENT, '--output', join(input.repo, 'page.html')], {
      ...input.options, ...out, env: { ...input.env, ...SHARING }, client: github.client, createJudge: fakeTransport(),
      confirm: async () => answer });
    assert.equal(code, answer === null ? 2 : 0);
    assert.equal(github.writes.length, 0);
    assert.match(out.chunks.stdout, /PR comment not posted\./);
  }
  const input = await fixture(t), out = streams();
  assert.equal(await sessionOnly([input.file, '--format', 'html', '--output', join(input.repo, 'p.html')], {
    ...input.options, ...out, env: { ...input.env, ...SHARING }, client: refusingClient,
    createJudge: fakeTransport() }), 0);
  assert.doesNotMatch(out.chunks.stdout, /PR comment/);
});

test('D82 step 10 a comment that could never be posted stops the review before its first model call', async (t) => {
  const input = await fixture(t), out = streams(), page = join(input.repo, 'page.html');
  // No principal ids: nothing is read, from the recording or from GitHub.
  assert.equal(await runSessionReviewCommand([input.file, ...COMMENT, '--output', page], {
    ...input.options, ...out, client: refusingClient, createJudge: noJudge }), 2);
  assert.match(out.chunks.stderr, /Review could not complete: publication_disabled\./);
  await assert.rejects(readdir(stateOf(input)), { code: 'ENOENT' }, 'nothing was read or written');
  // A public repository, or a pull request that does not exist or that the token cannot read (GitHub answers 404 or
  // 401): the metadata read refuses it before the reviewer is built, and nothing is written.
  for (const [github, code] of [[fakeGitHub({ isPrivate: () => false }), 'publication_disabled'],
    [fakeGitHub({ status: 404 }), 'github_unavailable'], [fakeGitHub({ status: 401 }), 'github_unavailable']]) {
    const early = streams();
    assert.equal(await runSessionReviewCommand([input.file, ...COMMENT, '--output', page], {
      ...input.options, ...early, env: { ...input.env, ...SHARING }, client: github.client, createJudge: noJudge }), 2);
    assert.match(early.chunks.stderr, new RegExp(`Review could not complete: ${code}\\.`));
    assert.deepEqual(github.reads, ['/repos/example/demo/pulls/7'], 'its metadata only');
    assert.equal(github.writes.length, 0);
    await assert.rejects(stat(page), { code: 'ENOENT' });
    await assert.rejects(readdir(stateOf(input)), { code: 'ENOENT' });
  }
});

test('D82 step 10 a missing GitHub token stops the review before the reviewer is built', async (t) => {
  const input = await fixture(t), out = streams(), page = join(input.repo, 'page.html');
  t.mock.method(globalThis, 'fetch', async () => assert.fail('GitHub is never called without a token'));
  assert.equal(await runSessionReviewCommand([input.file, ...COMMENT, '--output', page], {
    ...input.options, ...out, env: { ...input.env, ...SHARING }, resolveToken: async () => null,
    createJudge: noJudge }), 2);
  assert.match(out.chunks.stderr, /Review could not complete: github_auth_missing\.\nFix: Run gh auth login/);
  await assert.rejects(stat(page), { code: 'ENOENT' });
  await assert.rejects(readdir(stateOf(input)), { code: 'ENOENT' }, 'no review state was written');
});

test('D82 step 10 a repository made public after the review started is refused after the page, which is kept',
  async (t) => {
  const input = await fixture(t), out = streams(), page = join(input.repo, 'page.html');
  const github = fakeGitHub({ isPrivate: (n) => n === 1 });
  assert.equal(await runSessionReviewCommand([input.file, ...COMMENT, '--output', page], {
    ...input.options, ...out, env: { ...input.env, ...SHARING }, client: github.client, createJudge: fakeTransport(),
    confirm: () => assert.fail('a public PR is never offered for confirmation') }), 3);
  assert.equal(github.writes.length, 0);
  assert.match(out.chunks.stderr,
    /Sharing could not complete: publication_disabled\. The local page and review history are retained\./);
  assert.ok((await stat(page)).isFile());
});

test('D82 step 10 a dry run shows the comment of the last finished review, reading nothing from GitHub', async (t) => {
  const input = await fixture(t), env = { ...input.env, ...SHARING };
  const dry = async (name) => {
    const out = streams();
    const argv = [input.file, '--dry-run', ...COMMENT, '--output', join(input.repo, name)];
    assert.equal(await sessionOnly(argv, { ...input.options, ...out, env, client: refusingClient,
      createJudge: noJudge }), 0, out.chunks.stderr);
    await assert.rejects(stat(join(input.repo, name)), { code: 'ENOENT' });
    return out.chunks.stdout;
  };
  assert.match(await dry('first.html'),
    /^PR comment for example\/demo#7: this recording has no finished review yet, so there is no comment to show\./m);
  const github = fakeGitHub(), out = streams();
  assert.equal(await sessionOnly([input.file, ...COMMENT, '--output', join(input.repo, 'page.html')], {
    ...input.options, ...out, env, client: github.client, createJudge: fakeTransport(),
    confirm: async () => false }), 0);
  const preview = /:\n(Sonah advisory review[\s\S]*?)\n\n<!-- sonah-review:/.exec(out.chunks.stdout)[1];
  const shown = await dry('second.html');
  assert.match(shown, new RegExp('^PR comment for example/demo#7, as this recording\'s last finished review would post '
    + 'it \\(a dry run reads nothing from GitHub and posts nothing\\):$', 'm'));
  assert.ok(shown.includes(`${preview}\n`), 'the same comment text the review previewed, without the PR\'s marker');
  assert.equal(github.writes.length, 0);
});
