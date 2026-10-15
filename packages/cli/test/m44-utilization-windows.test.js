// M44. From claude-cli 2.1.296 a `rate_limit_event` reports utilization only per window, in
// `rate_limit_info.unifiedWindows` ({ five_hour: { utilization, resetsAt }, seven_day: ... }); the top-level `utilization`
// older versions report is absent. Each window's utilization is kept under a closed RATE_LIMIT_WINDOWS name (any other
// name counts as `other`, never kept), the old top-level field is still read, and `--stop-at-utilization U` compares the
// highest utilization any reported window carries. The usage lines show each window in plain words.
//
// Every stream, session and report here is invented; every child process and transport is a fake. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { RATE_LIMIT_WINDOWS, createReviewJudge, highestUtilization, rateLimitOf, rateLimitRecordOf } from '../src/review-judge.js';
import { RATE_LIMIT_WINDOW_WORDS, createReviewBudget, utilizationWords } from '../src/review-budget.js';
import { readSessionReviewProgress } from '../src/session-review.js';
import { doctor } from '../src/doctor.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const LEAK = 'M44_WINDOW_LEAK_SENTINEL';
const MODEL = 'claude-synthetic-1';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };

/** A `rate_limit_event` as claude-cli 2.1.296 prints it: no top-level utilization, the windows under `unifiedWindows`. */
const event = (info) => ({ type: 'rate_limit_event', rate_limit_info: info, uuid: LEAK, session_id: LEAK });
const windowsOnly = (fiveHour, sevenDay) => event({ status: 'allowed', resetsAt: 1800000000, rateLimitType: 'five_hour',
  overageStatus: 'rejected', overageDisabledReason: LEAK, isUsingOverage: false,
  unifiedWindows: { five_hour: { utilization: fiveHour, resetsAt: 1800000000 },
    seven_day: { utilization: sevenDay, resetsAt: 1900000000 } } });
/** The record the transport hands its onResult, from one event. */
const reported = (info) => rateLimitOf(event(info));

// ---- reading one event ----------------------------------------------------------------------------------------
test('M44 the windows are a closed list: the three the CLI schema names, then `other`', () => {
  assert.deepEqual(RATE_LIMIT_WINDOWS, ['five_hour', 'seven_day', 'seven_day_overage_included', 'other']);
  assert.ok(Object.isFrozen(RATE_LIMIT_WINDOWS));
  assert.deepEqual(Object.keys(RATE_LIMIT_WINDOW_WORDS), RATE_LIMIT_WINDOWS);
  assert.ok(Object.isFrozen(RATE_LIMIT_WINDOW_WORDS));
});

test('M44 unifiedWindows only (2.1.296): each window\'s utilization is kept; nothing else of the event', () => {
  const record = rateLimitOf(windowsOnly(0.57, 0.18));
  assert.deepEqual(record, { status: 'allowed', rateLimitType: 'five_hour', utilization: null, resetsAt: 1800000000,
    windows: { five_hour: 0.57, seven_day: 0.18 } });
  assert.equal(highestUtilization(record), 0.57);
  assert.equal(utilizationWords(record), '0.57 (five-hour 0.57, seven-day 0.18)');
  assert.ok(!JSON.stringify(record).includes(LEAK));
  // The three named windows, in the list's order whatever order the CLI printed them in.
  const three = reported({ unifiedWindows: { seven_day_overage_included: { utilization: 0.3, resetsAt: 1 },
    seven_day: { utilization: 0.2, resetsAt: 1 }, five_hour: { utilization: 0.1, resetsAt: 1 } } });
  assert.deepEqual(Object.keys(three.windows), ['five_hour', 'seven_day', 'seven_day_overage_included']);
  assert.equal(utilizationWords(three), '0.3 (five-hour 0.1, seven-day 0.2, seven-day with extra usage 0.3)');
});

test('M44 the old top-level utilization alone (older CLIs) is read as before, with no windows', () => {
  const record = reported({ status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.4, resetsAt: 1 });
  assert.deepEqual(record, { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.4, resetsAt: 1, windows: null });
  assert.equal(highestUtilization(record), 0.4);
  assert.equal(utilizationWords(record), '0.4');
});

test('M44 both: the highest is taken over the top-level field and every window', () => {
  const windowHigher = reported({ utilization: 0.5, unifiedWindows: { five_hour: { utilization: 0.92 }, seven_day: { utilization: 0.1 } } });
  assert.deepEqual([windowHigher.utilization, windowHigher.windows], [0.5, { five_hour: 0.92, seven_day: 0.1 }]);
  assert.equal(highestUtilization(windowHigher), 0.92);
  const topHigher = reported({ utilization: 0.95, unifiedWindows: { five_hour: { utilization: 0.2 }, seven_day: { utilization: 0.1 } } });
  assert.equal(highestUtilization(topHigher), 0.95);
  assert.equal(utilizationWords(topHigher), '0.95 (five-hour 0.2, seven-day 0.1)');
});

test('M44 a window under an unknown name counts as `other` (the highest); its name is never kept', () => {
  const record = reported({ unifiedWindows: { five_hour: { utilization: 0.1 }, [`${LEAK}_a`]: { utilization: 0.97 },
    [`${LEAK}_b`]: { utilization: 0.3 }, other: { utilization: 0.2 } } });
  assert.deepEqual(record.windows, { five_hour: 0.1, other: 0.97 });
  assert.equal(highestUtilization(record), 0.97);
  assert.equal(utilizationWords(record), '0.97 (five-hour 0.1, other limit 0.97)');
  assert.ok(!JSON.stringify(record).includes(LEAK));
  // A name that is an Object.prototype member, as JSON.parse makes it an own key: `other`, and nothing is polluted.
  const parsed = rateLimitOf(JSON.parse('{"type":"rate_limit_event","rate_limit_info":{"unifiedWindows":'
    + '{"__proto__":{"utilization":0.8},"constructor":{"utilization":0.6},"toString":{"utilization":0.7}}}}'));
  assert.deepEqual(parsed.windows, { other: 0.8 });
  assert.equal(Object.getPrototypeOf(parsed.windows), Object.prototype);
  assert.equal({}.utilization, undefined);
});

test('M44 malformed values are no reading: closed, never parsed from text, never thrown on', () => {
  for (const value of ['0.95', '95%', 'high', null, true, [0.9], { utilization: '0.9' }, -0.1, -1, Number.NaN,
    Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, LEAK]) {
    const record = reported({ utilization: value, unifiedWindows: { five_hour: { utilization: value }, seven_day: value } });
    assert.deepEqual([record.utilization, record.windows], [null, null], String(value));
    assert.equal(highestUtilization(record), null);
    assert.equal(utilizationWords(record), 'not reported');
  }
  // A window that is not a record, or unifiedWindows that is not one, reports nothing; good windows beside it stay.
  for (const unified of [null, 0.9, 'five_hour', [{ utilization: 0.9 }], true])
    assert.equal(reported({ unifiedWindows: unified }).windows, null, JSON.stringify(unified));
  assert.deepEqual(reported({ unifiedWindows: { five_hour: 0.9, seven_day: [0.9], seven_day_overage_included: { utilization: 0.4 } } })
    .windows, { seven_day_overage_included: 0.4 });
  // Above 1 is kept: the CLI's schema states usage can run past a window's cap, and that must still stop a review.
  const over = reported({ unifiedWindows: { five_hour: { utilization: 1.04 }, seven_day: { utilization: 0.5 } } });
  assert.deepEqual([over.windows, highestUtilization(over)], [{ five_hour: 1.04, seven_day: 0.5 }, 1.04]);
  // Nothing but a record is a record.
  for (const value of [null, undefined, 0.9, 'x', [], true]) {
    assert.equal(rateLimitRecordOf(value), null);
    assert.equal(highestUtilization(value), null);
    assert.equal(utilizationWords(value), 'not reported');
  }
});

test('M44 a record closed once closes again to itself; a record with bad windows is closed the same way', () => {
  for (const record of [rateLimitOf(windowsOnly(0.57, 0.18)), reported({ utilization: 0.4 }), reported({}),
    reported({ utilization: 0.5, unifiedWindows: { x: { utilization: 0.6 }, five_hour: { utilization: 0.1 } } })])
    assert.deepEqual(rateLimitRecordOf(record), record);
  assert.deepEqual(rateLimitRecordOf({ status: LEAK, windows: { five_hour: '0.9', seven_day: 0.3, [LEAK]: 0.6, other: -1 } }),
    { status: 'unknown', rateLimitType: null, utilization: null, resetsAt: null, windows: { seven_day: 0.3, other: 0.6 } });
});

// ---- the transport, through a fake claude child --------------------------------------------------------------
function fakeClaude(events) {
  return () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => {
      const text = JSON.stringify(EMPTY);
      child.stdout.write(events(text).map((line) => `${JSON.stringify(line)}\n`).join(''));
      setImmediate(() => close(0));
    }));
    return child;
  };
}

test('M44 the claude transport keeps the last event\'s windows, and no text of it', async () => {
  const init = { type: 'system', subtype: 'init', model: MODEL, cwd: `/synthetic/${LEAK}`, session_id: 'synthetic' };
  const assistant = (text) => ({ type: 'assistant', parent_tool_use_id: null,
    message: { model: MODEL, role: 'assistant', content: [{ type: 'text', text }] } });
  const result = (text) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null, result: text,
    usage: { input_tokens: 1, output_tokens: 1 } });
  const recorded = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: { PATH: '/bin' },
    spawnProcess: fakeClaude((text) => [init, windowsOnly(0.2, 0.1), assistant(text), windowsOnly(0.57, 0.18), result(text)]),
    onResult: (metadata) => recorded.push(metadata) });
  assert.deepEqual(await judge({ system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' }), EMPTY);
  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0].rateLimit, { status: 'allowed', rateLimitType: 'five_hour', utilization: null,
    resetsAt: 1800000000, windows: { five_hour: 0.57, seven_day: 0.18 } });
  assert.ok(!JSON.stringify(recorded[0].rateLimit).includes(LEAK));
});

// ---- the review's optional stop and usage line ---------------------------------------------------------------
test('M44 --stop-at-utilization fires at or over U on either window, never below', () => {
  const fires = (rateLimit, bound = 0.9) => {
    const budget = createReviewBudget({ stopAtUtilization: bound });
    budget.record({ rateLimit });
    return budget.snapshot().reason;
  };
  // Windows only: the five-hour window pauses a review before the seven-day one, and the seven-day one does too.
  assert.equal(fires(rateLimitOf(windowsOnly(0.91, 0.18))), 'utilization');
  assert.equal(fires(rateLimitOf(windowsOnly(0.18, 0.9))), 'utilization', 'exactly U fires');
  assert.equal(fires(rateLimitOf(windowsOnly(0.89, 0.89))), null);
  assert.equal(fires(rateLimitOf(windowsOnly(0.57, 0.18)), 0.6), null);
  // The old top-level field only, and both.
  assert.equal(fires(reported({ utilization: 0.9 })), 'utilization');
  assert.equal(fires(reported({ utilization: 0.89 })), null);
  assert.equal(fires(reported({ utilization: 0.2, unifiedWindows: { seven_day: { utilization: 0.95 } } })), 'utilization');
  assert.equal(fires(reported({ utilization: 0.95, unifiedWindows: { seven_day: { utilization: 0.2 } } })), 'utilization');
  assert.equal(fires(reported({ utilization: 0.5, unifiedWindows: { five_hour: { utilization: 0.6 } } })), null);
  // An unknown window is a limit too; a reading over 1 still stops; malformed readings never do.
  assert.equal(fires(reported({ unifiedWindows: { [LEAK]: { utilization: 0.93 } } })), 'utilization');
  assert.equal(fires(reported({ unifiedWindows: { five_hour: { utilization: 1.2 } } })), 'utilization');
  for (const value of ['0.99', -0.99, Number.NaN, Number.POSITIVE_INFINITY, null, [1]])
    assert.equal(fires(reported({ utilization: value, unifiedWindows: { five_hour: { utilization: value } } })), null, String(value));
  // With no stop asked, nothing pauses whatever is reported.
  const free = createReviewBudget();
  free.record({ rateLimit: rateLimitOf(windowsOnly(1.3, 1.1)) });
  assert.equal(free.snapshot().reason, null);
});

test('M44 the usage line shows each window in plain words, from the latest attempt that reported one', async () => {
  const budget = createReviewBudget({ stopAtUtilization: 0.95 });
  await budget.wrap(async () => {
    budget.record({ rateLimit: rateLimitOf(windowsOnly(0.41, 0.17)) });
    budget.record({ rateLimit: rateLimitOf(windowsOnly(0.57, 0.18)) });
    budget.record({ rateLimit: reported({ unifiedWindows: { five_hour: { utilization: 'x' } } }) });
    budget.record({});
    return {};
  })({ system: 's', prompt: 'p' });
  assert.match(budget.summaryLine(), /; utilization 0\.57 \(five-hour 0\.57, seven-day 0\.18\)\.$/);
  assert.deepEqual([budget.snapshot().utilization, budget.snapshot().windows], [0.57, { five_hour: 0.57, seven_day: 0.18 }]);
  assert.equal(budget.snapshot().reason, null);
  assert.ok(!budget.summaryLine().includes(LEAK));
  const old = createReviewBudget();
  old.record({ rateLimit: { utilization: 0.4 } });
  assert.match(old.summaryLine(), /; utilization 0\.4\.$/);
  assert.equal(old.snapshot().windows, null);
  assert.match(createReviewBudget().summaryLine(), /; utilization not reported\.$/);
});

// ---- the scripted runner ----------------------------------------------------------------------------------------
async function directory(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah-m44-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const options = (base, extra = {}) => ({ parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out: join(base, 'out'),
  backend: 'claude-cli', model: MODEL, maxCalls: 1000, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session',
  concurrency: 1, ...extra });
const quiet = { write: () => {}, progress: () => {}, installSignals: false };
/** A transport whose n-th attempt reports `rateLimitOf(n)` as the claude transport would hand it on; attested. */
const reporting = (eventOf, calls = { n: 0 }) => ({ onResult }) => async (request) => {
  calls.n++;
  const reportedEvent = eventOf(calls.n);
  await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1,
    rateLimit: reportedEvent === null ? null : rateLimitOf(reportedEvent) });
  return request.challenge ? { votes: [] } : EMPTY;
};

test('M44 the harness stops admitting on the five-hour window alone; below U on both it runs to the end', async (t) => {
  const base = await directory(t, 'stop');
  const calls = { n: 0 };
  const stopped = await harness.runSessionReviewHarness(options(base, { stopAtUtilization: 0.9 }), { ...quiet,
    loadSession: async () => manyWindowSession(4), createJudge: reporting((n) => windowsOnly(n >= 2 ? 0.93 : 0.5, 0.2), calls) });
  assert.equal(stopped.exitCode, 3, JSON.stringify(stopped.summary));
  assert.deepEqual([stopped.summary.state, stopped.summary.breaker], ['interrupted', 'utilization']);
  assert.equal(calls.n, 2, 'no window was admitted after the attempt that crossed the bound');
  assert.equal(stopped.summary.schema, 'sonah.session-review-harness/17');
  assert.deepEqual(stopped.summary.rateLimit.windows, { five_hour: 0.93, seven_day: 0.2 });
  assert.equal(stopped.summary.rateLimit.utilization, null, 'the top-level field stays what the CLI reported');
  const attempts = JSON.parse(await readFile(join(base, 'out', 'attempts.json'), 'utf8'));
  assert.deepEqual(attempts.map((a) => a.rateLimit.windows.five_hour), [0.5, 0.93]);
  const progress = await readSessionReviewProgress(join(base, 'out', 'review'));
  assert.deepEqual(progress.rateLimit, stopped.summary.rateLimit);
  const below = await directory(t, 'below');
  const run = await harness.runSessionReviewHarness(options(below, { stopAtUtilization: 0.95 }), { ...quiet,
    loadSession: async () => manyWindowSession(3), createJudge: reporting(() => windowsOnly(0.94, 0.94)) });
  assert.deepEqual([run.exitCode, run.summary.breaker], [0, null]);
  const seven = await directory(t, 'seven');
  const weekly = await harness.runSessionReviewHarness(options(seven, { stopAtUtilization: 0.8 }), { ...quiet,
    loadSession: async () => manyWindowSession(3), createJudge: reporting(() => windowsOnly(0.1, 0.8)) });
  assert.deepEqual([weekly.exitCode, weekly.summary.breaker], [3, 'utilization']);
});

test('M44 a progress written before windows still reads; one with an unknown window or a bad value does not', async (t) => {
  const base = await directory(t, 'progress');
  await harness.runSessionReviewHarness(options(base), { ...quiet, loadSession: async () => manyWindowSession(1),
    createJudge: reporting(() => windowsOnly(0.57, 0.18)) });
  const folder = join(base, 'out', 'review'), file = join(folder, 'progress.json');
  const written = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(written.rateLimit.windows, { five_hour: 0.57, seven_day: 0.18 });
  const rewrite = async (rateLimit) => {
    await writeFile(file, JSON.stringify({ ...written, rateLimit }), { mode: 0o600 });
    await chmod(file, 0o600);
    return readSessionReviewProgress(folder);
  };
  const { windows: _, ...before } = written.rateLimit;
  assert.deepEqual((await rewrite(before))?.rateLimit, before, 'a pre-M44 progress stays a valid progress');
  assert.deepEqual((await rewrite({ ...before, windows: null }))?.rateLimit, { ...before, windows: null });
  for (const windows of [{ [LEAK]: 0.5 }, { five_hour: '0.5' }, { five_hour: -1 }, { five_hour: null }, {}, [0.5]])
    assert.equal(await rewrite({ ...before, windows }), null, JSON.stringify(windows));
});

// ---- the probe and the doctor ----------------------------------------------------------------------------------
test('M44 the probe (sonah doctor) states the windows its one attempt reported, even when it was not answered', async () => {
  // B5.2 (T8): the earlier probe script, whose `sonah.review-probe/2` record carried `rateLimit.windows`, is removed; the
  // one-call check before a paid run is `sonah doctor`'s, which states the same windows on its `Claude usage:` line.
  let calls = 0;
  const out = await doctor({}, { env: { HOME: '/tmp/synthetic-m44-home', PATH: '/synthetic/bin',
    SONAH_CODEX_BIN: '/synthetic/bin/codex' }, nodeVersion: '20.0.0',
    runCli: async (file, args) => {
      if (file === '/synthetic/bin/codex') throw Object.assign(new Error(LEAK), { code: 'ENOENT' });
      return { stdout: args[0] === '--version' ? '2.1.296 (Claude Code)' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) };
    },
    createJudge: ({ onResult }) => async () => {
      calls++;
      onResult({ ok: false, rateLimit: rateLimitOf(windowsOnly(0.57, 0.18)) });
      throw new Error(LEAK);
    },
    adapters: async () => ({ claude: { count: 0, where: '/synthetic/claude' }, codex: { count: 0, where: '/synthetic/codex' } }) });
  assert.equal(calls, 1, 'one attempt');
  assert.equal(out.facts.model.state, 'not_answered');
  assert.match(out.text, /^Claude usage: utilization 0\.57 \(five-hour 0\.57, seven-day 0\.18\)\.$/m);
  assert.ok(!out.text.includes(LEAK));
});

test('M44 sonah doctor states the usage its one probe reported, in plain words, and nothing when none', async () => {
  const LONG = SESSION_REVIEW_CLAUDE_CLI_MODEL;
  const ready = { ok: true, attestation: 'attested', configuredModel: LONG, servedModels: [LONG.slice(0, -4)],
    contextWindow: 1_000_000 };
  const run = (metadata) => doctor({}, { env: { HOME: '/tmp/synthetic-m44-home', PATH: '/synthetic/bin',
    SONAH_CODEX_BIN: '/synthetic/bin/codex' }, nodeVersion: '20.0.0',
    runCli: async (file, args) => {
      if (file === '/synthetic/bin/codex') throw Object.assign(new Error(LEAK), { code: 'ENOENT' });
      return { stdout: args[0] === '--version' ? '2.1.296 (Claude Code)' : JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) };
    },
    createJudge: ({ onResult }) => async () => { onResult(metadata); return { ok: true }; },
    adapters: async () => ({ claude: { count: 0, where: '/synthetic/claude' }, codex: { count: 0, where: '/synthetic/codex' } }) });
  const windows = await run({ ...ready, rateLimit: rateLimitOf(windowsOnly(0.57, 0.18)) });
  assert.equal(windows.facts.model.state, 'ready');
  assert.match(windows.text, /^Claude usage: utilization 0\.57 \(five-hour 0\.57, seven-day 0\.18\)\.$/m);
  const old = await run({ ...ready, rateLimit: { status: 'allowed', utilization: 0.4 } });
  assert.match(old.text, /^Claude usage: utilization 0\.4\.$/m);
  for (const rateLimit of [null, reported({ unifiedWindows: { five_hour: { utilization: '0.5' } } })]) {
    const none = await run({ ...ready, rateLimit });
    assert.doesNotMatch(none.text, /Claude usage/);
  }
  assert.ok(!windows.text.includes(LEAK));
});

// ---- the product's session route (`sonah review`) ------------------------------------------------------------------
/** A synthetic recording and `sonah review` over it with a fake transport: the n-th call reports `rateLimitFor(n)`. With
 *  `ask`, the narrative names the request as done, so a challenge call follows it. */
async function commandFixture(t, name) {
  const base = await directory(t, name);
  const home = join(base, 'home'), repo = join(base, 'repo'), file = join(base, 'recording.jsonl');
  await mkdir(home); await mkdir(repo);
  const ask = 'Read the synthetic file.';
  await writeFile(file, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-m44', version: '2.1.296' })
    .ask(ask).read('a.js', 'Synthetic file content.').done()) + '\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  const state = join(env.SONAH_HOME, 'session-reviews', createHash('sha256').update(file).digest('hex'), 'review');
  const run = async (args, rateLimitFor, { requirement = false } = {}) => {
    const chunks = { stdout: '', stderr: '' }, calls = [];
    // The session's review alone: the code step (on by default, owner decision 2026-10-14) is off by its flag.
    const code = await runSessionReviewCommand([file, '--no-code-pass', ...args], { cwd: repo, env, installSignals: false,
      loadReviews: async () => new Map(), openPage: async () => {},
      stdout: { write: (text) => { chunks.stdout += text; } }, stderr: { write: (text) => { chunks.stderr += text; } },
      createJudge: ({ onResult, config }) => async (request) => {
        calls.push(request);
        onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000,
          rateLimit: rateLimitFor(calls.length) });
        if (request.challenge) return { votes: request.challenge.items.map(({ key, candidate }) => ({ key,
          verdict: 'not-refuted', explanation: 'The synthetic recording contains the cited read.', receipts: candidate.receipts })) };
        const instruction = request.window.events.find((e) => e.kind === 'instruction');
        const action = request.window.events.find((e) => e.kind === 'invocation');
        return { decisions: [], pivots: [], claims: [], requirements: requirement && instruction && action ? [{ text: ask,
          instruction: { eventId: instruction.id, role: 'instruction', quote: ask }, status: 'done',
          deliverable: { eventId: action.id, role: 'action', quote: 'a.js' } }] : [],
          failures: [], notClaims: [], forbiddenEdits: [] };
      } });
    return { code, chunks, calls };
  };
  return { run, state };
}

test('M44 sonah review pauses on the five-hour window alone, prints each window and stores them in progress', async (t) => {
  const { run, state } = await commandFixture(t, 'command');
  const paused = await run(['--stop-at-utilization', '0.9'], () => rateLimitOf(windowsOnly(0.93, 0.2)));
  assert.equal(paused.code, 3, paused.chunks.stdout);
  assert.equal(paused.calls.length, 1);
  assert.match(paused.chunks.stdout, /Review stopped where you asked \(utilization\)/);
  assert.match(paused.chunks.stdout, /; utilization 0\.93 \(five-hour 0\.93, seven-day 0\.2\)\.\n/);
  assert.ok(!paused.chunks.stdout.includes(LEAK));
  assert.deepEqual((await readSessionReviewProgress(state)).rateLimit, { status: 'allowed', rateLimitType: 'five_hour',
    utilization: null, resetsAt: 1800000000, windows: { five_hour: 0.93, seven_day: 0.2 } });
  // Resumed, the stored answer is reused: no call, so nothing new is reported, and the review completes.
  const resumed = await run(['--stop-at-utilization', '0.9'], () => rateLimitOf(windowsOnly(0.99, 0.99)));
  assert.equal(resumed.code, 0, resumed.chunks.stdout);
  assert.equal(resumed.calls.length, 0);
  assert.match(resumed.chunks.stdout, /; utilization not reported\.\n/);
});

test('M44 sonah review: a later call that reports no rate limit keeps the earlier reading in progress and the usage line', async (t) => {
  const { run, state } = await commandFixture(t, 'command-later-none');
  const done = await run([], (n) => (n === 1 ? rateLimitOf(windowsOnly(0.41, 0.17)) : null), { requirement: true });
  assert.equal(done.code, 0, done.chunks.stdout);
  assert.ok(done.calls.length >= 2, 'the narrative call, then its challenge passes');
  assert.ok(done.calls.slice(1).every((request) => request.challenge), 'every later call is a challenge reporting none');
  assert.deepEqual((await readSessionReviewProgress(state)).rateLimit.windows, { five_hour: 0.41, seven_day: 0.17 });
  assert.match(done.chunks.stdout, /; utilization 0\.41 \(five-hour 0\.41, seven-day 0\.17\)\.\n/);
});

test('M44 the 2.1.296 rateLimitType `seven_day_overage_included` is kept by name', () => {
  assert.equal(reported({ rateLimitType: 'seven_day_overage_included' }).rateLimitType, 'seven_day_overage_included');
  assert.equal(reported({ rateLimitType: LEAK }).rateLimitType, 'unknown');
});
