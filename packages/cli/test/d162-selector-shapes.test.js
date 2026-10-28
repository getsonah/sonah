// D162: the claude CLI's two stream shapes under the long-context selector (`[1m]`). Claude Code 2.1.278's init named
// the requested value with the selector and keyed the result's `modelUsage` by it; 2.1.311's init and every top-level
// assistant name the id without the selector, and `modelUsage` is keyed by that id. Both are attested: the first as
// before, the second only when its usage gives the selector's window. Every other identity rule stays.
//
// Every stream here is invented and every child process is a fake; no model, no network, no recorded stream.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { acceptedInitModels, createReviewJudge } from '../src/review-judge.js';
import { PROBE_REQUEST, probeOutcome } from '../src/review-probe.js';
import { DOCTOR_FIXES, doctor } from '../src/doctor.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { ANSWER, agentEvents, fakeClaude as fakeAgentClaude, repository } from './agent-transport-fixture.js';
import { manyWindowSession } from './m33-fast-profile-fixture.js';

const harness = await import(pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href);

const PLAIN = 'claude-synthetic-5-5';
const LONG = `${PLAIN}[1m]`;
const OTHER = 'claude-other-9-9';
const LEAK = 'D162_LEAK_SENTINEL sk-ant-FAKE-1621621621';
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const request = { system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' };

const init = (model, version) => ({ type: 'system', subtype: 'init', model, cwd: `/synthetic/${LEAK}`,
  session_id: 'synthetic', claude_code_version: version });
const assistant = (model, text, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent,
  message: { model, role: 'assistant', content: [{ type: 'text', text }] } });
/** A result event with no `modelUsage` field at all. */
const NO_USAGE = Symbol('no modelUsage');
const result = (text, modelUsage) => ({ type: 'result', subtype: 'success', is_error: false, api_error_status: null,
  result: text, duration_ms: 10, duration_api_ms: 9, usage: { input_tokens: 2, output_tokens: 4 },
  ...(modelUsage === NO_USAGE ? {} : { modelUsage }) });
const entry = (contextWindow) => ({ contextWindow, maxOutputTokens: 128000, inputTokens: 2, outputTokens: 4 });
/** Claude Code 2.1.311's shape: the init and the assistant name the served id, `modelUsage` is keyed by it. */
const shape311 = ({ served = PLAIN, configured = served, usage = { [served]: entry(1_000_000) }, extra = [] } = {}) =>
  (text) => [init(configured, '2.1.311'), ...extra, assistant(served, text), result(text, usage)];
/** Claude Code 2.1.278's shape: the init names the value as configured, `modelUsage` is keyed by it. */
const shape278 = ({ configured = LONG, served = PLAIN, usage = { [configured]: entry(1_000_000) } } = {}) =>
  (text) => [init(configured, '2.1.278'), assistant(served, text), result(text, usage)];

function fakeClaude(events, answer = () => EMPTY) {
  const capture = { calls: 0, args: [] };
  const spawnProcess = (command, args) => {
    capture.calls++;
    capture.args.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code, null); } };
    child.kill = () => { setImmediate(() => close(null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => {
      child.stderr.write(LEAK);
      child.stdout.write(events(JSON.stringify(answer())).map((event) => `${JSON.stringify(event)}\n`).join(''));
      setImmediate(() => close(0));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

async function oneCall(model, events, answer) {
  const fake = fakeClaude(events, answer);
  const recorded = [];
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model }, env: { PATH: '/bin' },
    spawnProcess: fake.spawnProcess, onResult: (metadata) => recorded.push(metadata) });
  let answered = null, error = null;
  try { answered = await judge(request); } catch (caught) { error = caught; }
  assert.equal(fake.capture.calls, 1, 'one call');
  assert.equal(recorded.length, 1, 'one report');
  assert.ok(!JSON.stringify(recorded).includes('D162_LEAK_SENTINEL'), 'no stream text is kept');
  return { answer: answered, error, metadata: recorded[0] };
}

test('D162 the init of a full id may name the value as configured or, under a selector, the id without it', () => {
  assert.deepEqual(acceptedInitModels(LONG), [LONG, PLAIN]);
  assert.deepEqual(acceptedInitModels(PLAIN), [PLAIN], 'a plain id has one: itself');
  assert.deepEqual(acceptedInitModels(SESSION_REVIEW_CLAUDE_CLI_MODEL), ['claude-sonnet-5-5[1m]', 'claude-sonnet-5-5']);
});

test('D162 Claude Code 2.1.311\'s shape under the selector is attested when its usage gives the 1M window', async () => {
  const { answer, error, metadata } = await oneCall(LONG, shape311());
  assert.equal(error, null);
  assert.deepEqual(answer, EMPTY);
  assert.equal(metadata.ok, true);
  assert.equal(metadata.attestation, 'attested');
  assert.equal(metadata.providerClass, null);
  assert.equal(metadata.contextWindow, 1_000_000, 'read from the served id\'s usage entry');
  assert.equal(metadata.configuredModel, PLAIN);
  assert.deepEqual(metadata.servedModels, [PLAIN]);
  assert.equal(metadata.cliVersion, '2.1.311');
  // An entry of another model beside it is never read, and does not stand in the way.
  const beside = await oneCall(LONG, shape311({ usage: { [PLAIN]: entry(1_000_000), [OTHER]: entry(200_000) } }));
  assert.equal(beside.metadata.attestation, 'attested');
  assert.equal(beside.metadata.contextWindow, 1_000_000);
  // The usage keyed by the requested value, with the init of 2.1.311, is the same evidence.
  const byValue = await oneCall(LONG, shape311({ usage: { [LONG]: entry(1_000_000) } }));
  assert.equal(byValue.metadata.attestation, 'attested');
  assert.equal(byValue.metadata.contextWindow, 1_000_000);
  // Both keys there and agreeing state one window: the one the selector asks for.
  const agreeing = await oneCall(LONG, shape311({ usage: { [LONG]: entry(1_000_000), [PLAIN]: entry(1_000_000) } }));
  assert.equal(agreeing.metadata.attestation, 'attested');
  assert.equal(agreeing.metadata.contextWindow, 1_000_000);
});

/** 2.1.311's shape under the selector with usage that does not give the 1M window: [name, usage, the window reported]. */
const WITHOUT_THE_WINDOW = [
  ['another window', { [PLAIN]: entry(200_000) }, 200_000],
  ['a larger window', { [PLAIN]: entry(2_000_000) }, 2_000_000],
  ['no usage', NO_USAGE, null],
  ['usage that is not a record', 'SYNTHETIC', null],
  ['usage of another model only', { [OTHER]: entry(1_000_000) }, null],
  ['both keys, disagreeing', { [LONG]: entry(1_000_000), [PLAIN]: entry(200_000) }, null],
  ['both keys, one without a window', { [LONG]: entry(1_000_000), [PLAIN]: { inputTokens: 2 } }, null],
  ['both keys, one entry not a record', { [LONG]: entry(1_000_000), [PLAIN]: 1_000_000 }, null],
  ['a window that is a string', { [PLAIN]: entry('1000000') }, null],
  ['a window of zero', { [PLAIN]: entry(0) }, null],
  ['an entry that is not a record', { [PLAIN]: 1_000_000 }, null],
];

test('D162 2.1.311\'s shape without the selector\'s window is accepted but never attested, and never an identity failure', async () => {
  for (const [name, usage, contextWindow] of WITHOUT_THE_WINDOW) {
    const { answer, error, metadata } = await oneCall(LONG, shape311({ usage }));
    assert.equal(error, null, name);
    assert.deepEqual(answer, EMPTY, `${name}: the answer is returned, as an alias answer is`);
    assert.equal(metadata.ok, true, name);
    assert.equal(metadata.attestation, 'unattested', name);
    assert.equal(metadata.providerClass, null, `${name}: no identity evidence`);
    assert.equal(metadata.contextWindow, contextWindow, name);
  }
});

test('D162 under 2.1.311\'s init, an answer is attested exactly when the window it reports is the selector\'s', async () => {
  // The invariant the scripted runner's `context_window` breaker relies on: no answer of this shape is left unattested
  // while it reports the window the run asked for, so every refused one stops the run.
  const cases = [...WITHOUT_THE_WINDOW.map(([, usage]) => usage), { [PLAIN]: entry(1_000_000) }, { [LONG]: entry(1_000_000) },
    { [LONG]: entry(1_000_000), [PLAIN]: entry(1_000_000) }, { [PLAIN]: entry(1_000_000), [OTHER]: entry(200_000) }];
  for (const usage of cases) {
    const { metadata } = await oneCall(LONG, shape311({ usage }));
    assert.equal(metadata.attestation === 'attested', metadata.contextWindow === 1_000_000, JSON.stringify(usage));
  }
});

test('D162 2.1.278\'s shape is attested as before; its usage keyed by the served id is now read', async () => {
  for (const [name, events, contextWindow] of [
    ['the 1M window', shape278(), 1_000_000],
    // As before D162: the init proves the configuration; the review's admission refuses the window.
    ['another window', shape278({ usage: { [LONG]: entry(200_000) } }), 200_000],
    ['no usage', shape278({ usage: NO_USAGE }), null],
    ['usage keyed by the served id', shape278({ usage: { [PLAIN]: entry(1_000_000) } }), 1_000_000],
    ['both keys, disagreeing', shape278({ usage: { [LONG]: entry(1_000_000), [PLAIN]: entry(200_000) } }), null],
  ]) {
    const { error, metadata } = await oneCall(LONG, events);
    assert.equal(error, null, name);
    assert.equal(metadata.attestation, 'attested', name);
    assert.equal(metadata.configuredModel, LONG, name);
    assert.equal(metadata.contextWindow, contextWindow, name);
  }
});

test('D162 every other identity rule stays: each mismatch is refused under both shapes', async () => {
  const fallback = { type: 'system', subtype: 'model_fallback' };
  for (const [name, model, events] of [
    ['an init of another model', LONG, shape311({ configured: OTHER })],
    ['an assistant of another model', LONG, shape311({ served: OTHER, configured: PLAIN, usage: { [PLAIN]: entry(1_000_000) } })],
    ['the served id carrying the selector', LONG, shape311({ served: LONG, configured: PLAIN })],
    ['the served id carrying the selector, 2.1.278 init', LONG, shape278({ served: LONG })],
    ['a model-fallback event', LONG, shape311({ extra: [fallback] })],
    ['a nested assistant', LONG, shape311({ extra: [assistant(PLAIN, 'SYNTHETIC', 'toolu_synthetic')] })],
    ['the selector in the init of a plain request', PLAIN, shape311({ configured: LONG })],
    ['an init without the selector of another request', `${OTHER}[1m]`, shape311()],
    // A second init naming another model is identity evidence, whichever init comes first.
    ['a second init of another model', LONG, shape311({ extra: [init(OTHER, '2.1.311')] })],
    ['a second init of another model, 2.1.278 init first', LONG,
      (text) => [init(LONG, '2.1.278'), init(OTHER, '2.1.278'), assistant(PLAIN, text), result(text, { [LONG]: entry(1_000_000) })]],
    ['a second init of another model, plain request', PLAIN, shape311({ extra: [init(OTHER, '2.1.311')] })],
  ]) {
    const { answer, error, metadata } = await oneCall(model, events);
    assert.equal(answer, null, name);
    assert.equal(error?.code, 'model_unavailable', name);
    assert.equal(error.providerClass, 'identity_mismatch', name);
    assert.equal(metadata.attestation, 'mismatch', name);
  }
  // A missing or repeated init, or no top-level assistant, fails the call and proves nothing either way, as before.
  for (const [name, events] of [
    ['no init', (text) => [assistant(PLAIN, text), result(text, { [PLAIN]: entry(1_000_000) })]],
    ['two inits, one per shape', (text) => [init(LONG, '2.1.278'), init(PLAIN, '2.1.311'), assistant(PLAIN, text),
      result(text, { [PLAIN]: entry(1_000_000) })]],
    ['no assistant', (text) => [init(PLAIN, '2.1.311'), result(text, { [PLAIN]: entry(1_000_000) })]],
  ]) {
    const { answer, error, metadata } = await oneCall(LONG, events);
    assert.equal(answer, null, name);
    assert.equal(error?.code, 'model_unavailable', name);
    assert.notEqual(error.providerClass, 'identity_mismatch', name);
    assert.equal(metadata.attestation, 'unattested', name);
  }
  // A plain request is attested on its init alone, whatever window its usage gives, as before.
  for (const usage of [{ [PLAIN]: entry(1_000_000) }, { [PLAIN]: entry(200_000) }, NO_USAGE]) {
    const { metadata } = await oneCall(PLAIN, shape311({ usage }));
    assert.equal(metadata.attestation, 'attested');
  }
});

test('D162 the code step\'s agent transport attests both shapes by the same rule', async (t) => {
  const { root, request: agentRequest } = await repository(t);
  const SERVED = 'claude-synthetic-5-5', SELECTED = `${SERVED}[1m]`;
  const withInit = (events, model) => events.map((event, at) => (at === 0 ? { ...event, model } : event));
  const run = async (events) => {
    const fake = await fakeAgentClaude(t, { events });
    const reported = [];
    let answer = null, error = null;
    try {
      answer = await createReviewJudge({ config: { backend: 'claude-cli', model: SELECTED }, env: fake.env,
        onResult: (metadata) => reported.push(metadata) })(agentRequest);
    } catch (caught) { error = caught; }
    assert.equal((await fake.calls()).length, 1, 'one call');
    assert.ok((await fake.calls())[0].args.includes(SELECTED), 'the CLI is asked for the window by the selector');
    return { answer, error, metadata: reported[0] };
  };
  const usage = (key, contextWindow) => ({ result: { modelUsage: { [key]: entry(contextWindow) } } });
  // 2.1.311's shape: the fixture's init and assistants already name the served id.
  const shaped311 = await run(agentEvents(root, usage(SERVED, 1_000_000)));
  assert.equal(shaped311.error, null);
  assert.deepEqual(shaped311.answer, ANSWER);
  assert.equal(shaped311.metadata.attestation, 'attested');
  assert.equal(shaped311.metadata.contextWindow, 1_000_000);
  for (const [name, extra, contextWindow] of [['another window', usage(SERVED, 200_000), 200_000],
    ['usage of another model only', usage(OTHER, 1_000_000), null]]) {
    const got = await run(agentEvents(root, extra));
    assert.equal(got.error, null, name);
    assert.deepEqual(got.answer, ANSWER, name);
    assert.equal(got.metadata.attestation, 'unattested', name);
    assert.equal(got.metadata.providerClass, null, name);
    assert.equal(got.metadata.contextWindow, contextWindow, name);
  }
  // 2.1.278's shape: the init names the value as configured.
  const shaped278 = await run(withInit(agentEvents(root, usage(SELECTED, 1_000_000)), SELECTED));
  assert.equal(shaped278.metadata.attestation, 'attested');
  assert.equal(shaped278.metadata.contextWindow, 1_000_000);
  // Another model in the init is identity evidence on the agent transport too.
  const other = await run(withInit(agentEvents(root, usage(SERVED, 1_000_000)), OTHER));
  assert.equal(other.error?.providerClass, 'identity_mismatch');
  assert.equal(other.metadata.attestation, 'mismatch');
});

test('D162 probeOutcome: 2.1.311\'s shape is ready with the 1M window, a window mismatch without it', async () => {
  const DEFAULT = SESSION_REVIEW_CLAUDE_CLI_MODEL, SERVED = 'claude-sonnet-5-5';
  const outcome = async (events, model = DEFAULT) => {
    const { metadata } = await oneCall(model, events, () => ({ ok: true }));
    return probeOutcome(model, metadata);
  };
  assert.equal(await outcome(shape311({ served: SERVED })), 'ready');
  assert.equal(await outcome(shape311({ served: SERVED, usage: { [DEFAULT]: entry(1_000_000), [SERVED]: entry(1_000_000) } })),
    'ready', 'both keys agreeing on the 1M window');
  assert.equal(await outcome(shape278({ configured: DEFAULT, served: SERVED })), 'ready', '2.1.278\'s shape stays ready');
  for (const usage of [{ [SERVED]: entry(200_000) }, { [SERVED]: entry(2_000_000) }, NO_USAGE, { [OTHER]: entry(1_000_000) },
    { [DEFAULT]: entry(1_000_000), [SERVED]: entry(200_000) }])
    assert.equal(await outcome(shape311({ served: SERVED, usage })), 'context_window_mismatch', String(JSON.stringify(usage)));
  // Shapes still not attested keep their names.
  assert.equal(await outcome(shape311({ served: DEFAULT, configured: SERVED })), 'selector_shape_changed',
    'the served id carrying the selector');
  assert.equal(await outcome(shape311({ served: SERVED, configured: DEFAULT }), SERVED), 'selector_shape_changed',
    'the init naming the selector on a request without one');
  assert.equal(await outcome(shape311({ served: SERVED, extra: [{ type: 'system', subtype: 'model_fallback' }] })),
    'served_model_mismatch', 'a fallback under 2.1.311\'s init is no moved selector');
  assert.equal(await outcome(shape311({ served: OTHER, configured: SERVED })), 'served_model_mismatch');
  // An unattested answer that is not 2.1.311's shape is not read as a window.
  assert.equal(probeOutcome(DEFAULT, { ok: true, attestation: 'unattested', configuredModel: DEFAULT,
    servedModels: [SERVED], contextWindow: 1_000_000 }), 'not_answered');
  assert.equal(probeOutcome(SERVED, { ok: true, attestation: 'unattested', configuredModel: SERVED,
    servedModels: [SERVED], contextWindow: 200_000 }), 'not_answered', 'a plain id asks no window');
  // A failed attempt of 2.1.311's shape is not answered, whatever its window.
  for (const contextWindow of [null, 200_000, 1_000_000])
    assert.equal(probeOutcome(DEFAULT, { ok: false, attestation: 'unattested', configuredModel: SERVED,
      servedModels: [SERVED], contextWindow }), 'not_answered', String(contextWindow));
});

test('D162 sonah doctor reads 2.1.311\'s shape: ready with the 1M window, one plain reason without it', async () => {
  const DEFAULT = SESSION_REVIEW_CLAUDE_CLI_MODEL, SERVED = 'claude-sonnet-5-5';
  const run = async (events) => {
    const fake = fakeClaude(events, () => ({ ok: true }));
    const out = await doctor({}, { env: { HOME: '/tmp/synthetic-d162-home', PATH: '/synthetic/bin',
      SONAH_CODEX_BIN: '/synthetic/bin/codex' }, nodeVersion: '20.0.0',
      runCli: async (file, args) => {
        if (file === '/synthetic/bin/codex') throw Object.assign(new Error(LEAK), { code: 'ENOENT' });
        return { stdout: args[0] === '--version' ? '2.1.311 (Claude Code)' : JSON.stringify({ loggedIn: true }) };
      },
      createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }),
      adapters: async () => ({ claude: { count: 0, where: '/synthetic/claude' }, codex: { count: 0, where: '/synthetic/codex' } }) });
    assert.equal(fake.capture.calls, 1, 'one call');
    assert.ok(!out.text.includes(LEAK), 'no provider text is printed');
    assert.equal(out.healthy, out.facts.model.state === 'ready');
    return { state: out.facts.model.state, providerClass: out.facts.model.providerClass,
      line: out.text.split('\n').find((line) => line.startsWith('Model:')) };
  };
  assert.deepEqual(await run(shape311({ served: SERVED })), { state: 'ready', providerClass: null,
    line: `Model: ${DEFAULT} answered one tiny synthetic request under the 1M context window.` });
  for (const usage of [{ [SERVED]: entry(200_000) }, NO_USAGE])
    assert.deepEqual(await run(shape311({ served: SERVED, usage })), { state: 'context_window_mismatch', providerClass: null,
      line: `Model: Sonah could not confirm the answer came from ${SERVED} under its 1M-token window. `
        + `Fix: ${DOCTOR_FIXES.claude_model}` });
});

test('D162 the scripted runner admits 2.1.311\'s shape under the 1M window and stops at once under another or none', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'sonah-d162-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const options = { parent: join(base, 'SYNTHETIC.jsonl'), codexHome: base, backend: 'claude-cli', model: LONG, maxCalls: 100,
    maxSeconds: 600, timeoutMs: 5000, sessionKey: 'session', concurrency: 1 };
  const deps = (fake) => ({ write: () => {}, progress: () => {}, installSignals: false, loadSession: async () => manyWindowSession(3),
    createJudge: (args) => createReviewJudge({ ...args, env: { PATH: '/bin' }, spawnProcess: fake.spawnProcess }) });
  const full = fakeClaude(shape311());
  const ran = await harness.runSessionReviewHarness({ ...options, out: join(base, 'full') }, deps(full));
  assert.equal(ran.exitCode, 0, JSON.stringify(ran.summary));
  assert.equal(ran.summary.breaker, null);
  assert.equal(ran.summary.servedModel, 'attested');
  assert.deepEqual(ran.summary.contextWindow, { requested: 1_000_000, reported: { 1000000: full.capture.calls } });
  assert.deepEqual(ran.summary.cliVersion, { '2.1.311': full.capture.calls });
  // Both keys agreeing on the 1M window: one window, attested and admitted.
  const agreeing = fakeClaude(shape311({ usage: { [LONG]: entry(1_000_000), [PLAIN]: entry(1_000_000) } }));
  const both = await harness.runSessionReviewHarness({ ...options, out: join(base, 'both') }, deps(agreeing));
  assert.equal(both.exitCode, 0, JSON.stringify(both.summary));
  assert.equal(both.summary.breaker, null);
  assert.equal(both.summary.servedModel, 'attested');
  assert.equal(agreeing.capture.calls, full.capture.calls, 'the same calls as under one entry');
  for (const [name, usage] of [['another', { [PLAIN]: entry(200_000) }], ['none', NO_USAGE],
    ['disagreeing', { [LONG]: entry(1_000_000), [PLAIN]: entry(200_000) }]]) {
    const fake = fakeClaude(shape311({ usage }));
    const run = await harness.runSessionReviewHarness({ ...options, out: join(base, name) }, deps(fake));
    assert.equal(run.summary.breaker, 'context_window', name);
    assert.equal(run.exitCode, 3, `${name}: interrupted, resumable`);
    assert.equal(fake.capture.calls, 1, `${name}: no call after the first`);
  }
});
