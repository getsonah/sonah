// D70 (a), owner decision 2026-10-08: the claude CLI's documented long-context selector (`[1m]`) on a full model id is
// the CLI's context-window setting, never part of the served model's identity. The transport accepts it on claude-cli
// only, attests the served model against the id without it, and records the window the CLI states it ran under; the
// session-only review asks the frozen long-context id (no run profile member: D70 review S0) for every call when the run
// names no model, records which model it asked and where from, and stops when the CLI reports another window.
//
// Every stream and session here is invented; every child process is a fake. No model, no network. The stream shapes
// are the claude CLI's own: the init names the id with the selector, the assistant the id without it, and the result's `modelUsage` is keyed by the id as configured with its `contextWindow`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { CLI_CONTEXT_SELECTORS, REVIEW_TRANSPORT_VERSION, attestableModel, cliContextSelector, cliVersionOf,
  createReviewJudge, reviewJudgeConfig, reviewTransportArguments, selectedContextWindow, servedModelId } from '../src/review-judge.js';
import { answerKey } from '../src/answer-cache.js';
import { PROBE_OUTCOMES, PROBE_REQUEST, probeOutcome } from '../src/review-probe.js';
import { DOCTOR_FIXES, doctor } from '../src/doctor.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL, runProfile } from '../../evidence/src/run-review.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const PLAIN = 'claude-synthetic-5-5';
const LONG = `${PLAIN}[1m]`;
const LEAK = 'D70_LEAK_SENTINEL sk-ant-FAKE-7070707070';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const request = { system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' };

const init = (model, version = '2.1.278') => ({ type: 'system', subtype: 'init', model, cwd: `/synthetic/${LEAK}`,
  session_id: 'synthetic', claude_code_version: version });
const assistant = (model, text) => ({ type: 'assistant', parent_tool_use_id: null,
  message: { model, role: 'assistant', content: [{ type: 'text', text }] } });
const result = (text, modelUsage) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: text, duration_ms: 10, duration_api_ms: 9, usage: { input_tokens: 2, output_tokens: 4 }, modelUsage });
/** The probe's shapes: `configured` in the init and as the `modelUsage` key, `served` on the assistant. */
const shaped = ({ configured, served, window, key = configured }) => (text) => [init(configured), assistant(served, text),
  result(text, { [key]: { contextWindow: window, maxOutputTokens: 128000, inputTokens: 2 } })];

function fakeClaude(events, answer = () => EMPTY) {
  const capture = { calls: 0, args: [] };
  const spawnProcess = (command, args) => {
    capture.calls++;
    capture.args.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false, prompt = '';
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.setEncoding('utf8');
    child.stdin.on('data', (chunk) => { prompt += chunk; });
    child.stdin.on('end', () => setImmediate(() => {
      child.stderr.write(LEAK);
      child.stdout.write(events(JSON.stringify(answer(prompt))).map((event) => `${JSON.stringify(event)}\n`).join(''));
      setImmediate(() => close(0));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

async function oneCall(model, events) {
  const fake = fakeClaude(events);
  const recorded = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model }, env: { PATH: '/bin' },
    spawnProcess: fake.spawnProcess, onResult: (metadata) => recorded.push(metadata) });
  let answer = null, error = null;
  try { answer = await judge(request); } catch (caught) { error = caught; }
  return { answer, error, recorded, fake };
}

test('D70 (a) the selector is one frozen literal; it is read off the end of a full id only', () => {
  assert.deepEqual(CLI_CONTEXT_SELECTORS, { '[1m]': 1_000_000 });
  assert.ok(Object.isFrozen(CLI_CONTEXT_SELECTORS));
  assert.equal(cliContextSelector(LONG), '[1m]');
  assert.equal(cliContextSelector(PLAIN), null);
  assert.equal(cliContextSelector('[1m]'), null, 'a selector alone is no model');
  assert.equal(cliContextSelector(`${PLAIN}[2m]`), null, 'nothing outside the table is a selector');
  assert.equal(servedModelId(LONG), PLAIN);
  assert.equal(servedModelId(PLAIN), PLAIN);
  assert.equal(selectedContextWindow(LONG), 1_000_000);
  assert.equal(selectedContextWindow(PLAIN), null, 'no selector: the CLI\'s own default for the id');
  assert.equal(attestableModel(LONG), true);
  assert.equal(attestableModel(PLAIN), true);
  for (const alias of ['sonnet[1m]', 'claude-sonnet[1m]', 'claude-sonnet-latest[1m]', '[1m]']) assert.equal(attestableModel(alias), false, alias);
});

test('D70 (a) the config takes the selector on claude-cli, on a full id only', () => {
  assert.equal(reviewJudgeConfig({}, { backend: 'claude-cli', model: LONG }).model, LONG);
  assert.equal(reviewJudgeConfig({}, { backend: 'claude-cli', model: PLAIN }).model, PLAIN);
  assert.equal(reviewJudgeConfig({}, { backend: 'claude-cli', model: LONG }).version, 'sonah.review-transport/3',
    'not bumped: a plain id sends what /3 sent, and no answer was ever stored under a selector');
  for (const [backend, model] of [['claude-cli', 'sonnet[1m]'], ['claude-cli', `${PLAIN}[2m]`], ['claude-cli', `${PLAIN}[1m][1m]`],
    ['claude-cli', '[1m]'], ['anthropic-api', LONG], ['codex-cli', 'gpt-5.6-sol[1m]']])
    assert.throws(() => reviewJudgeConfig({}, { backend, model }), { code: 'invalid_model' }, `${backend} ${model}`);
});

test('D70 (a) the probe\'s stream under the long-context id is attested, its window recorded', async () => {
  const { answer, error, recorded, fake } = await oneCall(LONG, shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  assert.equal(error, null);
  assert.deepEqual(answer, EMPTY);
  const args = fake.capture.args[0];
  assert.equal(args[args.indexOf('--model') + 1], LONG, 'the CLI is asked for the window by the selector on its argv');
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].attestation, 'attested');
  assert.equal(recorded[0].contextWindow, 1_000_000);
  assert.equal(recorded[0].configuredModel, LONG);
  assert.deepEqual(recorded[0].servedModels, [PLAIN]);
  assert.ok(!JSON.stringify(recorded).includes('D70_LEAK_SENTINEL'), 'no stream text is kept');
});

test('D70 (a) a plain id is attested as before and records the CLI\'s default window', async () => {
  const { error, recorded } = await oneCall(PLAIN, shaped({ configured: PLAIN, served: PLAIN, window: 200_000 }));
  assert.equal(error, null);
  assert.equal(recorded[0].attestation, 'attested');
  assert.equal(recorded[0].contextWindow, 200_000);
});

test('D70 (a) identity: the init must name the id as configured, the assistant the id without the selector', async () => {
  const cases = [
    // The CLI dropped the selector: its init names the plain id.
    shaped({ configured: PLAIN, served: PLAIN, window: 200_000 }),
    // The assistant names the configured value, which no API serves.
    shaped({ configured: LONG, served: LONG, window: 1_000_000 }),
    // Another model served it.
    shaped({ configured: LONG, served: 'claude-other-9-9', window: 1_000_000 }),
  ];
  for (const events of cases) {
    const { error, recorded } = await oneCall(LONG, events);
    assert.equal(error?.code, 'model_unavailable');
    assert.equal(error.providerClass, 'identity_mismatch');
    assert.equal(recorded[0].attestation, 'mismatch');
  }
  // A plain request answered under the selector's configuration is a mismatch too.
  const crossed = await oneCall(PLAIN, shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  assert.equal(crossed.error?.providerClass, 'identity_mismatch');
});

test('D70 (a) the window is read from the configured value\'s usage entry only, as a positive integer', async () => {
  for (const [events, expected] of [
    [shaped({ configured: LONG, served: PLAIN, window: 1_000_000, key: PLAIN }), null],
    [shaped({ configured: LONG, served: PLAIN, window: '1000000' }), null],
    [shaped({ configured: LONG, served: PLAIN, window: 0 }), null],
    [(text) => [init(LONG), assistant(PLAIN, text), result(text, undefined)], null],
  ]) {
    const { error, recorded } = await oneCall(LONG, events);
    assert.equal(error, null);
    assert.equal(recorded[0].attestation, 'attested', 'the window never decides attestation');
    assert.equal(recorded[0].contextWindow, expected);
  }
});

test('D70 (a) the answer key binds the selector: a stored plain-id answer never answers the long-context id', () => {
  const plain = answerKey(request, { backend: 'claude-cli', model: PLAIN });
  const long = answerKey(request, { backend: 'claude-cli', model: LONG });
  assert.notEqual(plain, long);
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
  assert.deepEqual(reviewTransportArguments({ backend: 'claude-cli', model: PLAIN, system: request.system }).argv
    .map((arg) => (arg === PLAIN ? LONG : arg)),
  reviewTransportArguments({ backend: 'claude-cli', model: LONG, system: request.system }).argv, 'only the model value differs');
});

test('D70 (a) the long-context default is one frozen literal, outside every run profile (D70 review S0)', () => {
  assert.equal(SESSION_REVIEW_CLAUDE_CLI_MODEL, 'claude-sonnet-5-5[1m]');
  assert.equal(attestableModel(SESSION_REVIEW_CLAUDE_CLI_MODEL), true);
  assert.equal(selectedContextWindow(SESSION_REVIEW_CLAUDE_CLI_MODEL), 1_000_000);
  assert.doesNotThrow(() => reviewJudgeConfig({}, { backend: 'claude-cli', model: SESSION_REVIEW_CLAUDE_CLI_MODEL }));
  // A transport default is not part of the review's identity: no profile names it, so no window checkpoint digest moves.
  for (const [scope, speeds] of [['session-only', ['standard', 'm33-fast', 'm33-lean']], ['combined', ['standard']]])
    for (const speed of speeds)
      assert.ok(!JSON.stringify(runProfile(scope, speed)).includes(SESSION_REVIEW_CLAUDE_CLI_MODEL), `${scope} ${speed}`);
});

test('D70 review (S0) the CLI version is read from the init as a SemVer normal version only', async () => {
  for (const [value, expected] of [['2.1.278', '2.1.278'], ['10.0.0', '10.0.0'], ['2.1', null], ['02.1.278', null],
    ['2.1.278-beta.1', null], [`2.1.278 ${LEAK}`, null], [2, null], [undefined, null]]) assert.equal(cliVersionOf(value), expected, String(value));
  const { recorded } = await oneCall(LONG, (text) => [init(LONG, '2.1.278'), assistant(PLAIN, text),
    result(text, { [LONG]: { contextWindow: 1_000_000 } })]);
  assert.equal(recorded[0].cliVersion, '2.1.278');
  assert.equal(recorded[0].attestation, 'attested', 'the version never decides attestation');
  const odd = await oneCall(LONG, (text) => [init(LONG, LEAK), assistant(PLAIN, text), result(text, { [LONG]: { contextWindow: 1_000_000 } })]);
  assert.equal(odd.recorded[0].cliVersion, null);
  assert.equal(odd.recorded[0].attestation, 'attested');
  assert.ok(!JSON.stringify(odd.recorded).includes('D70_LEAK_SENTINEL'));
});

const harnessArgs = (extra = []) => ['--parent', '/synthetic/p.jsonl', '--codex-home', '/synthetic', '--out', '/synthetic/out',
  '--max-calls', '10', '--max-seconds', '60', ...extra];

test('D70 (a) the harness asks the frozen default on claude-cli when no model is named; codex-cli must name one', () => {
  // The option stays absent, so the run records that it took the default (`model.source`).
  assert.equal(Object.hasOwn(harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli'])), 'model'), false);
  assert.equal(Object.hasOwn(harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli', '--speed-profile', 'm33-lean'])),
    'model'), false);
  assert.equal(harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli', '--model', PLAIN])).model, PLAIN,
    'a named model is the one asked');
  assert.equal(harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli', '--max-input-bytes', '5000000'])).maxInputBytes,
    5_000_000);
  for (const bad of ['0', '-1', '1.5', 'x', '01'])
    assert.throws(() => harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli', '--max-input-bytes', bad])), { code: 'usage' }, bad);
  assert.deepEqual(harness.MODEL_SOURCES, ['default', 'named']);
  assert.throws(() => harness.parseHarnessArgs(harnessArgs(['--backend', 'codex-cli'])), { code: 'usage' });
  assert.throws(() => harness.parseHarnessArgs(harnessArgs(['--backend', 'claude-cli', '--model', 'sonnet[1m]'])), { code: 'usage' });
});

test('D70 (a) the run record states the window the model selected and the windows the CLI reported', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-d70-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const fake = fakeClaude(shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  const options = { parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out: join(base, 'out'), backend: 'claude-cli',
    model: LONG, maxCalls: 100, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session', concurrency: 1 };
  const lane = (fake) => ({ write: () => {}, progress: () => {}, installSignals: false, loadSession: async () => manyWindowSession(2),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
  const run = await harness.runSessionReviewHarness(options, { write: () => {}, progress: () => {}, installSignals: false,
    loadSession: async () => manyWindowSession(2),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
  assert.equal(run.exitCode, 0, JSON.stringify(run.summary));
  assert.equal(run.summary.schema, 'sonah.session-review-harness/19');
  assert.equal(run.summary.servedModel, 'attested');
  assert.deepEqual(run.summary.model, { asked: LONG, source: 'named' });
  assert.deepEqual(run.summary.contextWindow, { requested: 1_000_000, reported: { 1000000: fake.capture.calls } });
  assert.deepEqual(run.summary.cliVersion, { '2.1.278': fake.capture.calls });
  const attempts = JSON.parse(await readFile(join(base, 'out', 'attempts.json'), 'utf8'));
  assert.ok(attempts.length > 0 && attempts.every((a) => a.contextWindow === 1_000_000 && a.cliVersion === '2.1.278'));
  assert.deepEqual(run.summary.inputBytes, { sent: attempts.reduce((n, a) => n + a.inputBytes, 0), max: null });
  for (const file of ['attempts.json', 'summary.json'])
    assert.ok(!(await readFile(join(base, 'out', file), 'utf8')).includes('D70_LEAK_SENTINEL'), file);
  // A plain id selects none; an attempt whose stream states no window is counted as unreported.
  const plainBase = join(base, 'plain');
  const unstated = fakeClaude((text) => [init(PLAIN), assistant(PLAIN, text), result(text, undefined)]);
  const plain = await harness.runSessionReviewHarness({ ...options, out: join(plainBase, 'out'), model: PLAIN },
    { write: () => {}, progress: () => {}, installSignals: false, loadSession: async () => manyWindowSession(2),
      createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: unstated.spawnProcess }) });
  assert.equal(plain.exitCode, 0);
  assert.deepEqual(plain.summary.contextWindow, { requested: null, reported: { unreported: unstated.capture.calls } });
  assert.deepEqual(plain.summary.model, { asked: PLAIN, source: 'named' });
  // No model named on claude-cli: the frozen default is asked for every call, and the run says it took the default.
  const byDefault = fakeClaude(shaped({ configured: SESSION_REVIEW_CLAUDE_CLI_MODEL, served: 'claude-sonnet-5-5', window: 1_000_000 }));
  const { model: _named, ...unnamed } = options;
  const taken = await harness.runSessionReviewHarness({ ...unnamed, out: join(base, 'default', 'out') }, lane(byDefault));
  assert.equal(taken.exitCode, 0, JSON.stringify(taken.summary));
  assert.deepEqual(taken.summary.model, { asked: SESSION_REVIEW_CLAUDE_CLI_MODEL, source: 'default' });
  assert.ok(byDefault.capture.args.every((args) => args[args.indexOf('--model') + 1] === SESSION_REVIEW_CLAUDE_CLI_MODEL));
});

test('D70 review (S0) a run that asked for a window stops when the CLI reports another, or answers and reports none', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-d70-window-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, backend: 'claude-cli', model: LONG, maxCalls: 100,
    maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session', concurrency: 1 };
  for (const [name, events] of [
    ['another', shaped({ configured: LONG, served: PLAIN, window: 200_000 })],
    ['none', (text) => [init(LONG), assistant(PLAIN, text), result(text, undefined)]]]) {
    const fake = fakeClaude(events);
    const run = await harness.runSessionReviewHarness({ ...options, out: join(base, name) }, { write: () => {}, progress: () => {},
      installSignals: false, loadSession: async () => manyWindowSession(3),
      createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
    assert.equal(run.summary.breaker, 'context_window', name);
    assert.equal(run.exitCode, 3, `${name}: interrupted, resumable`);
    assert.equal(fake.capture.calls, 1, `${name}: no call after the first`);
  }
  // A plain id requests no window: any reported window goes on.
  const plain = fakeClaude(shaped({ configured: PLAIN, served: PLAIN, window: 200_000 }));
  const ran = await harness.runSessionReviewHarness({ ...options, model: PLAIN, out: join(base, 'plain') }, { write: () => {},
    progress: () => {}, installSignals: false, loadSession: async () => manyWindowSession(3),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: plain.spawnProcess }) });
  assert.equal(ran.exitCode, 0);
  assert.equal(ran.summary.breaker, null);
});

test('D70 review (S0) the request-byte budget sends no attempt past it; the run pauses, resumable, and resumes', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-d70-bytes-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, out: join(base, 'out'), backend: 'claude-cli',
    model: LONG, maxCalls: 100, maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session', concurrency: 1 };
  const deps = (fake) => ({ write: () => {}, progress: () => {}, installSignals: false, loadSession: async () => manyWindowSession(3),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
  const full = fakeClaude(shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  const unbounded = await harness.runSessionReviewHarness({ ...options, out: join(base, 'unbounded') }, deps(full));
  assert.equal(unbounded.exitCode, 0);
  const sizes = JSON.parse(await readFile(join(base, 'unbounded', 'attempts.json'), 'utf8')).map((a) => a.inputBytes);
  assert.ok(sizes.length >= 3, 'premise: three windows, three calls at least');
  // A budget that covers the first attempt only.
  const budget = sizes[0] + Math.min(...sizes.slice(1)) - 1;
  const first = fakeClaude(shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  const paused = await harness.runSessionReviewHarness({ ...options, maxInputBytes: budget }, deps(first));
  assert.equal(paused.summary.breaker, 'max_input_bytes');
  assert.equal(paused.exitCode, 3, 'interrupted, resumable');
  assert.equal(first.capture.calls, 1);
  assert.deepEqual(paused.summary.inputBytes, { sent: sizes[0], max: budget });
  // Resumed with room: the stored answer is replayed, only what is missing is asked.
  const rest = fakeClaude(shaped({ configured: LONG, served: PLAIN, window: 1_000_000 }));
  const resumed = await harness.runSessionReviewHarness(options, deps(rest));
  assert.equal(resumed.exitCode, 0, JSON.stringify(resumed.summary));
  assert.equal(rest.capture.calls, sizes.length - 1, 'nothing answered is asked again');
});

test('D70 review (S0) the probe (sonah doctor): ready on the shape this transport attests, a closed stop on any other', async () => {
  // B5.2 (T8): the one-call readiness check before a paid run is `sonah doctor`'s; the earlier probe script, which printed
  // a closed outcome as a JSON record, is removed. Second B5.2 review (M1): doctor does not decide the script's outcomes.
  // The claude-cli transport refuses an unattested answer (model_unavailable, providerClass identity_mismatch), and
  // doctor reads any answer that is not ok as not_answered before probeOutcome is asked, so a selector or served-model
  // change is `not_answered (identity_mismatch)` in its facts; on its Model: line it gets, like a window mismatch, one
  // plain reason and the update fix (D77 F). This drives doctor() itself: one attempt of PROBE_REQUEST through the real
  // transport over a fake `claude`, with the frozen long-context id doctor checks.
  const DEFAULT = SESSION_REVIEW_CLAUDE_CLI_MODEL, SERVED = servedModelId(DEFAULT);
  const run = async (events) => {
    const fake = fakeClaude(events, () => ({ ok: true }));
    const out = await doctor({}, { env: { HOME: '/tmp/synthetic-d70-home', PATH: '/synthetic/bin',
      SONAH_CODEX_BIN: '/synthetic/bin/codex' }, nodeVersion: '20.0.0',
      runCli: async (file, args) => {
        if (file === '/synthetic/bin/codex') throw Object.assign(new Error(LEAK), { code: 'ENOENT' });
        return { stdout: args[0] === '--version' ? '2.1.278 (Claude Code)' : JSON.stringify({ loggedIn: true }) };
      },
      createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }),
      adapters: async () => ({ claude: { count: 0, where: '/synthetic/claude' }, codex: { count: 0, where: '/synthetic/codex' } }) });
    assert.equal(fake.capture.calls, 1, 'one call');
    assert.ok(!out.text.includes(LEAK), 'no provider text is printed');
    assert.equal(out.healthy, out.facts.model.state === 'ready', 'any outcome but ready needs attention (exit 1)');
    return { state: out.facts.model.state, providerClass: out.facts.model.providerClass,
      line: out.text.split('\n').find((line) => line.startsWith('Model:')) };
  };
  const ready = await run(shaped({ configured: DEFAULT, served: SERVED, window: 1_000_000 }));
  assert.deepEqual(ready, { state: 'ready', providerClass: null,
    line: `Model: ${DEFAULT} answered one tiny synthetic request under the 1M context window.` });
  for (const [name, events, state, providerClass] of [
    // The init names the id without the selector the run asked (probeOutcome: selector_shape_changed).
    ['selector in the init', shaped({ configured: SERVED, served: SERVED, window: 200_000 }), 'not_answered', 'identity_mismatch'],
    // The served model carries the selector (probeOutcome: selector_shape_changed).
    ['selector on the served id', shaped({ configured: DEFAULT, served: DEFAULT, window: 1_000_000 }), 'not_answered',
      'identity_mismatch'],
    // Another served model (probeOutcome: served_model_mismatch).
    ['another served model', shaped({ configured: DEFAULT, served: 'claude-other-9-9', window: 1_000_000 }), 'not_answered',
      'identity_mismatch'],
    ['another window', shaped({ configured: DEFAULT, served: SERVED, window: 200_000 }), 'context_window_mismatch', null],
    ['no window', (text) => [init(DEFAULT), assistant(SERVED, text), result(text, undefined)], 'context_window_mismatch', null],
  ]) {
    const got = await run(events);
    assert.deepEqual([got.state, got.providerClass], [state, providerClass], name);
    // D77 (F): one plain reason and its fix, not the outcome names; facts.model keeps the closed state and class.
    assert.equal(got.line, `Model: Sonah could not confirm the answer came from ${SERVED} under its 1M-token window. `
      + `Fix: ${DOCTOR_FIXES.claude_model}`, name);
  }
  const unanswered = await run((text) => [init(DEFAULT), result(text, undefined)]);
  assert.equal(unanswered.state, 'not_answered');
  assert.match(unanswered.line, /^Model: not_answered\b/);
});

test('D70 review (S0) probeOutcome\'s own test: the closed outcome of one attempt\'s typed fields', async () => {
  // probeOutcome (cli/src/review-probe.js) on transport-shaped streams, read from the attempt's metadata whatever the
  // transport returned. Doctor asks it only for an answered attempt, so its two identity outcomes are reachable only
  // here, through probeOutcome's own callers; the doctor test above pins what doctor prints for those streams.
  const run = async (events, { model = SESSION_REVIEW_CLAUDE_CLI_MODEL } = {}) => {
    const fake = fakeClaude(events, () => ({ ok: true }));
    let metadata = null;
    const judge = createReviewJudge({ config: { backend: 'claude-cli', model }, timeoutMs: 5000, env: { PATH: '/bin' },
      spawnProcess: fake.spawnProcess, onResult: (value) => { metadata = value; } });
    try { await judge(PROBE_REQUEST); } catch { /* the outcome is read from the attempt's typed fields */ }
    assert.equal(fake.capture.calls, 1, 'one call');
    return probeOutcome(model, metadata);
  };
  const DEFAULT = SESSION_REVIEW_CLAUDE_CLI_MODEL, SERVED = servedModelId(DEFAULT);
  assert.equal(await run(shaped({ configured: DEFAULT, served: SERVED, window: 1_000_000 })), 'ready');
  for (const [events, outcome, options] of [
    // The init names the id without the selector the run asked: the CLI's shape changed.
    [shaped({ configured: SERVED, served: SERVED, window: 200_000 }), 'selector_shape_changed'],
    // The served model carries the selector.
    [shaped({ configured: DEFAULT, served: DEFAULT, window: 1_000_000 }), 'selector_shape_changed'],
    // The selector where the run asked none.
    [shaped({ configured: DEFAULT, served: SERVED, window: 1_000_000 }), 'selector_shape_changed', { model: SERVED }],
    [shaped({ configured: DEFAULT, served: 'claude-other-9-9', window: 1_000_000 }), 'served_model_mismatch'],
    [shaped({ configured: DEFAULT, served: SERVED, window: 200_000 }), 'context_window_mismatch'],
    [(text) => [init(DEFAULT), assistant(SERVED, text), result(text, undefined)], 'context_window_mismatch'],
  ]) assert.equal(await run(events, options), outcome, outcome);
  assert.equal(await run(shaped({ configured: SERVED, served: SERVED, window: 200_000 }), { model: SERVED }), 'ready',
    'a plain id requests no window');
  assert.equal(await run((text) => [init(DEFAULT), result(text, undefined)]), 'not_answered');
  assert.deepEqual(PROBE_OUTCOMES, ['ready', 'selector_shape_changed', 'served_model_mismatch', 'context_window_mismatch',
    'not_answered']);
});
