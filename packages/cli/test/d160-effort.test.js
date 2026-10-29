// D160: `sonah review --effort LEVEL` (and SONAH_EFFORT), the effort of every claude-cli call the review makes: the
// session windows, their re-asks and checks, and the code step's agents. The closed levels; the flag over the variable;
// the refusal on every other backend; the argv a fake `claude` is started with; the answer keys at the default (as
// before) and at another level (another key); a replay at the same level with no call, and none across levels; the run's
// identity, its usage entry and its record; `sonah doctor --effort`.
//
// Synthetic sessions, synthetic files, a deterministic fake reviewer and a fake `claude` executable: no recording, no
// model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REVIEW_EFFORT, REVIEW_EFFORTS, createReviewJudge, reviewAgentKeyArgs, reviewCliArgs, reviewEffortOf,
  reviewJudgeConfig, reviewTransportArguments } from '../src/review-judge.js';
import { answerKey, createAnswerCache } from '../src/answer-cache.js';
import { REVIEW_FIX_WORDS, parseSessionReviewArgs, runSessionReviewCommand, sessionReviewUsage }
  from '../src/session-review-command.js';
import { sameRunIdentity, usageRunIdentityValid } from '../src/session-review.js';
import { DOCTOR_USAGE, doctor, parseDoctorArgs, runDoctorCommand } from '../src/doctor.js';
import { feedbackBundle } from '../src/feedback.js';
import { CLI_SAFE_ERROR_CODES, EFFORT_PROBLEMS } from '../../evidence/src/ledger.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { codeSession, codeJudge, gitRepoWith, repoWith, sha256 } from './code-pass-fixture.js';
import { MODEL, PROMPT, SCHEMA, STATE, SYSTEM, agentEvents, fakeClaude, repository } from './agent-transport-fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SESSION_MODEL = SESSION_REVIEW_CLAUDE_CLI_MODEL;
const OPUS = 'claude-opus-5-5[1m]';
const CODE_LABEL = /^code-(?:review|verify|account)(?::|$)/;
const windowOf = (model) => (model.endsWith('[1m]') ? 1_000_000 : 200_000);
const effortOf = (argv) => argv[argv.indexOf('--effort') + 1];
/** A valid one-pixel PNG (gain-i-image-transport.test.js's): a request with it is an image request (requestImagesOf). */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const IMAGES = Object.freeze([{ mediaType: 'image/png', data: PNG }]);

/**
 * One `sonah review` run on the synthetic session, its files under `root`, its state under `state`. Every judge the
 * command makes is recorded with its settings (`judges`: `{ model, effort, config }`), and every request with the
 * settings of the judge it reached and the argv that judge's transport would start `claude` with (`calls`).
 */
async function review(t, { root, state, argv = [], env = {}, loadSession = undefined } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d160-run-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl');
  await mkdir(home); await writeFile(file, '{}\n');
  const output = join(dir, 'story.md');
  const judge = codeJudge();
  let out = '', err = '', loaded = 0;
  const judges = [], calls = [];
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects'), ...env },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: loadSession ?? (async () => { loaded++; return { session: codeSession(), hash: sha256('synthetic'), cwd: root }; }),
    createJudge: ({ config, onResult }) => {
      judges.push({ model: config.model, effort: config.effort, config });
      return async (request) => {
        const sent = reviewTransportArguments({ backend: config.backend, model: config.model, effort: config.effort,
          system: request.system, ...(request.agent ? { agent: request.agent, schema: request.schema } : {}) });
        calls.push({ model: config.model, effort: config.effort, request, argv: sent?.argv ?? null });
        onResult({ ok: true, backend: config.backend, attestation: config.backend === 'claude-cli' ? 'attested' : 'unattested',
          contextWindow: windowOf(config.model), usage: { input_tokens: 10, output_tokens: 2 } });
        return judge(request);
      };
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8').catch(() => 'null'));
  const runs = JSON.parse(await readFile(join(state, 'review', 'usage.private.json'), 'utf8').catch(() => 'null'))?.runs
    ?? null;
  return { code, out, err, judges, calls, report, runs, loaded: () => loaded };
}

async function stateDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d160-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'state');
}

/** The names of the stored answers under `dir` (`<key>.<occurrence>.json`), sorted. */
const stored = async (dir) => (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.json')).sort();

// ---- the closed levels and the settings ----------------------------------------------------------------------------
test('D160: the levels are claude --help\'s for --effort, in its order; the default is high', () => {
  assert.deepEqual(REVIEW_EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.ok(Object.isFrozen(REVIEW_EFFORTS));
  assert.equal(REVIEW_EFFORT, 'high');
  // None named: the default, on every backend.
  for (const backend of ['claude-cli', 'codex-cli', 'anthropic-api'])
    for (const none of [undefined, null]) assert.equal(reviewEffortOf(backend, none), REVIEW_EFFORT, backend);
  for (const level of REVIEW_EFFORTS) assert.equal(reviewEffortOf('claude-cli', level), level);
  // Any other value, by exact membership: no case folding, no trimming, no number.
  for (const other of ['', 'High', 'MAX', ' max', 'max ', 'maximum', 'ultra', 'x-high', '5', 'none'])
    assert.throws(() => reviewEffortOf('claude-cli', other), { code: 'invalid_effort', message: 'invalid_effort' }, other);
  // Any named effort on another backend, the default's name included, is refused, before its value is read.
  for (const backend of ['codex-cli', 'anthropic-api', 'other'])
    for (const level of [...REVIEW_EFFORTS, 'bogus'])
      assert.throws(() => reviewEffortOf(backend, level), { code: 'effort_claude_cli_only' }, `${backend} ${level}`);
  // Each is a code the review prints by name, with its fix.
  assert.deepEqual(EFFORT_PROBLEMS, ['invalid_effort', 'effort_claude_cli_only']);
  for (const code of EFFORT_PROBLEMS) {
    assert.ok(CLI_SAFE_ERROR_CODES.includes(code), code);
    assert.equal(typeof REVIEW_FIX_WORDS[code], 'string', code);
  }
});

test('D160: the settings carry an effort only when it is not the default, and never read SONAH_EFFORT', () => {
  const base = { backend: 'claude-cli', model: SESSION_MODEL, version: 'sonah.review-transport/3' };
  assert.deepEqual(reviewJudgeConfig({}, { backend: 'claude-cli', model: SESSION_MODEL }), base);
  assert.deepEqual(reviewJudgeConfig({}, { backend: 'claude-cli', model: SESSION_MODEL, effort: 'high' }), base);
  for (const level of ['low', 'medium', 'xhigh', 'max'])
    assert.deepEqual(reviewJudgeConfig({}, { backend: 'claude-cli', model: SESSION_MODEL, effort: level }),
      { ...base, effort: level });
  // The variable is the commands' to read: a settings object made without an effort is at the default.
  assert.deepEqual(reviewJudgeConfig({ SONAH_EFFORT: 'max' }, { backend: 'claude-cli', model: SESSION_MODEL }), base);
  assert.deepEqual(reviewJudgeConfig({ SONAH_EFFORT: 'bogus' }, { backend: 'claude-cli', model: SESSION_MODEL }), base);
  assert.throws(() => reviewJudgeConfig({}, { backend: 'claude-cli', model: SESSION_MODEL, effort: 'bogus' }),
    { code: 'invalid_effort' });
  // codex-cli and anthropic-api: no effort at all, and a named one refused, never ignored.
  assert.deepEqual(reviewJudgeConfig({}, { backend: 'codex-cli', model: 'gpt-5.6-sol' }),
    { backend: 'codex-cli', model: 'gpt-5.6-sol', version: 'sonah.review-transport/3' });
  for (const [backend, model] of [['codex-cli', 'gpt-5.6-sol'], ['anthropic-api', 'claude-test-1']])
    for (const effort of ['high', 'max'])
      assert.throws(() => reviewJudgeConfig({}, { backend, model, effort }), { code: 'effort_claude_cli_only' });
  // The judge re-reads its settings: one made at an effort keeps it, whatever the environment holds.
  assert.doesNotThrow(() => createReviewJudge({ config: { backend: 'claude-cli', model: SESSION_MODEL, effort: 'max' },
    env: { SONAH_EFFORT: 'bogus' } }));
  assert.throws(() => createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol', effort: 'max' }, env: {} }),
    { code: 'effort_claude_cli_only' });
});

// ---- the argv, through a fake claude ----------------------------------------------------------------------------------
test('D160: a fake claude is started with --effort LEVEL beside the model, once, for a session request, an image request '
  + 'and an agent request; at the default its argv is byte for byte as before', async (t) => {
  const { root, request } = await repository(t);
  const pinnedDefault = ['--print', '--model', MODEL, '--effort', 'high', '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--tools', '', '--disable-slash-commands', '--setting-sources', '', '--mcp-config',
    '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', SYSTEM];
  for (const level of [undefined, ...REVIEW_EFFORTS]) {
    const config = reviewJudgeConfig({}, { backend: 'claude-cli', model: MODEL, effort: level });
    // A session request (no tools) and an agent request (the code step's), each through its own fake claude.
    const plain = await fakeClaude(t, { events: agentEvents(root, { tools: [] }) });
    await createReviewJudge({ config, env: { ...plain.env, SONAH_EFFORT: 'low' } })({ system: SYSTEM, prompt: PROMPT });
    const [session] = await plain.calls();
    const asked = level ?? REVIEW_EFFORT;
    assert.equal(effortOf(session.args), asked, String(level));
    assert.equal(session.args.filter((arg) => arg === '--effort').length, 1);
    assert.deepEqual(session.args, reviewCliArgs({ system: SYSTEM, model: MODEL, effort: asked }));
    assert.deepEqual(session.args, reviewTransportArguments({ backend: 'claude-cli', model: MODEL, system: SYSTEM,
      ...(config.effort ? { effort: config.effort } : {}) }).argv);
    if (asked === REVIEW_EFFORT) assert.deepEqual(session.args, pinnedDefault, 'the default argv as before');
    else assert.deepEqual(session.args, pinnedDefault.map((arg) => (arg === 'high' ? asked : arg)), 'only the level moves');
    const agentFake = await fakeClaude(t, { events: agentEvents(root) });
    await createReviewJudge({ config, env: agentFake.env })(request);
    const [agent] = await agentFake.calls();
    assert.equal(effortOf(agent.args), asked, `agent ${level}`);
    assert.equal(agent.args.filter((arg) => arg === '--effort').length, 1);
    // An image request (Gain I): one stream-json message on stdin, at the same level.
    const imageFake = await fakeClaude(t, { events: agentEvents(root, { tools: [] }) });
    await createReviewJudge({ config, env: imageFake.env })({ system: SYSTEM, prompt: PROMPT, images: IMAGES });
    const [image] = await imageFake.calls();
    assert.ok(image.args.includes('--input-format'), 'sent as an image request');
    assert.equal(effortOf(image.args), asked, `image ${level}`);
    assert.equal(image.args.filter((arg) => arg === '--effort').length, 1);
    assert.deepEqual(image.args, reviewCliArgs({ system: SYSTEM, model: MODEL, effort: asked, images: true }));
  }
});

// ---- the answer keys ---------------------------------------------------------------------------------------------------
test('D160: the golden keys: a session request, an image request and an agent request at the default keep the keys '
  + '5a4c8aac gave them', () => {
  // Computed once by the answerKey of a `git archive 5a4c8aac` export (the code before D160), for these exact requests;
  // not recomputed here.
  const session = { label: 'narrative:w1', system: SYSTEM, prompt: PROMPT, schema: SCHEMA };
  const agent = { label: 'code-review:agent', system: SYSTEM, prompt: PROMPT, schema: SCHEMA,
    agent: { root: '/tmp', addDirs: [], maxTurns: 40 } };
  const image = { ...session, images: IMAGES };
  const identity = { backend: 'claude-cli', model: MODEL, repoState: STATE };
  const golden = { session: '0c5e6bbfaf50a958d4cb8e7882dc2c64e11c5f4015beb99f1acdf6bfe5445e19',
    agent: '2c659f480fb8b68943cfef76bf56a1ac2d0930d772fe06309c008d9100f8e72c',
    image: 'f6d7e309662da16f7c54728f9906c930b2052d8b9376d14b10032f58eface759' };
  const requests = { session, agent, image };
  for (const effort of [undefined, null, REVIEW_EFFORT])
    for (const [name, request] of Object.entries(requests))
      assert.equal(answerKey(request, { ...identity, effort }), golden[name], `${name} ${effort}`);
  for (const [name, request] of Object.entries(requests)) {
    const others = REVIEW_EFFORTS.filter((level) => level !== REVIEW_EFFORT)
      .map((effort) => answerKey(request, { ...identity, effort }));
    assert.ok(others.every((key) => key !== golden[name]), name);
    assert.equal(new Set(others).size, others.length, `${name}: one key per level`);
  }
});

test('D160: an answer key at the default is the key as before; at any other level it is another key, per level', async (t) => {
  const { request: agentRequest } = await repository(t);
  const session = { label: 'narrative:w1', system: SYSTEM, prompt: PROMPT, schema: SCHEMA };
  const identity = { backend: 'claude-cli', model: MODEL, repoState: STATE };
  for (const request of [session, { ...session, images: IMAGES }, agentRequest]) {
    const before = answerKey(request, identity);
    assert.match(before, /^[0-9a-f]{64}$/);
    assert.equal(answerKey(request, { ...identity, effort: REVIEW_EFFORT }), before);
    assert.equal(answerKey(request, { ...identity, effort: undefined }), before);
    assert.equal(answerKey(request, { ...identity, effort: null }), before);
    // At the default, the transport's arguments are asked for exactly as before: no effort member.
    assert.equal(answerKey(request, { ...identity, effort: REVIEW_EFFORT, transportArguments: (input) => {
      assert.equal(Object.hasOwn(input, 'effort'), false);
      return reviewTransportArguments(input);
    } }), before);
    const others = REVIEW_EFFORTS.filter((level) => level !== REVIEW_EFFORT)
      .map((effort) => answerKey(request, { ...identity, effort }));
    assert.equal(new Set([before, ...others]).size, REVIEW_EFFORTS.length, 'one key per level');
    // The cache keys as answerKey does, with the effort its settings carry.
    const config = reviewJudgeConfig({}, { backend: 'claude-cli', model: MODEL, effort: 'max' });
    const dir = await mkdtemp(join(tmpdir(), 'sonah-d160-cache-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    assert.equal(createAnswerCache(dir, { ...config, repoState: STATE }).keyOf(request),
      answerKey(request, { ...identity, effort: 'max' }));
    assert.equal(createAnswerCache(dir, { ...reviewJudgeConfig({}, { backend: 'claude-cli', model: MODEL }),
      repoState: STATE }).keyOf(request), before);
  }
  // The agent key binds the level through its argv (`--effort` and its value kept), as the session key does.
  const agent = { ...agentRequest.agent };
  const argv = reviewTransportArguments({ backend: 'claude-cli', model: MODEL, effort: 'max', system: SYSTEM, agent,
    schema: SCHEMA }).argv;
  assert.equal(effortOf(reviewAgentKeyArgs(argv)), 'max');
  // An effort the review could never ask for is no key at all.
  assert.throws(() => createAnswerCache('/tmp/unused', { backend: 'claude-cli', model: MODEL, effort: 'bogus' }),
    TypeError);
});

// ---- the command: the flag, the variable, the refusals -------------------------------------------------------------
test('D160: --effort is parsed once and listed; a missing value is a usage error', () => {
  assert.equal(parseSessionReviewArgs(['--effort', 'max']).effort, 'max');
  assert.equal(parseSessionReviewArgs([]).effort, undefined);
  assert.throws(() => parseSessionReviewArgs(['--effort', 'max', '--effort', 'low']),
    { code: 'usage', problem: '--effort is given twice' });
  assert.throws(() => parseSessionReviewArgs(['--effort']), { code: 'usage', problem: '--effort needs a value' });
  assert.throws(() => parseSessionReviewArgs(['--effort', '--dry-run']), { code: 'usage' });
  assert.match(sessionReviewUsage, /^ {2}--effort LEVEL {11}the effort Sonah asks claude-cli for: low, medium,$/m);
  assert.match(sessionReviewUsage, /^ {27}high \(the default\), xhigh or max\. The code review$/m);
  assert.ok(sessionReviewUsage.split('\n').every((line) => line.length <= 80));
});

test('D160: every judge the review makes, the session\'s and the code step\'s, asks at the effort named: the flag, else '
  + 'SONAH_EFFORT; with neither, the default, and its settings as before', async (t) => {
  const root = await repoWith(t);
  const cases = [
    { argv: [], env: {}, effort: undefined },
    { argv: ['--effort', 'high'], env: {}, effort: undefined },
    { argv: ['--effort', 'max'], env: {}, effort: 'max' },
    { argv: [], env: { SONAH_EFFORT: 'xhigh' }, effort: 'xhigh' },
    { argv: ['--effort', 'low'], env: { SONAH_EFFORT: 'xhigh' }, effort: 'low' },
    // The flag wins, the default's name included.
    { argv: ['--effort', 'high'], env: { SONAH_EFFORT: 'max' }, effort: undefined },
    { argv: ['--effort', 'max', '--code-model', OPUS], env: {}, effort: 'max' },
  ];
  for (const { argv, env, effort } of cases) {
    const run = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', ...argv], env });
    const name = `${argv.join(' ')} ${JSON.stringify(env)}`;
    assert.equal(run.code, 0, `${name}: ${run.err}`);
    assert.equal(run.judges.length, 2, name);
    for (const judge of run.judges) {
      assert.equal(judge.effort, effort, name);
      assert.equal(Object.hasOwn(judge.config, 'effort'), effort !== undefined, `${name}: settings as before at the default`);
    }
    const code = run.calls.filter(({ request }) => CODE_LABEL.test(request.label));
    assert.ok(code.length > 0 && run.calls.length > code.length, name);
    for (const call of run.calls) assert.equal(effortOf(call.argv), effort ?? REVIEW_EFFORT, `${name} ${call.request.label}`);
  }
});

test('D160: an effort the review cannot ask for stops it before anything is read: a value off the list, or any effort '
  + 'on codex-cli or anthropic-api', async (t) => {
  const root = await repoWith(t);
  const cases = [
    [['--effort', 'maximum'], {}, 'invalid_effort'],
    [['--effort', 'Max'], {}, 'invalid_effort'],
    [[], { SONAH_EFFORT: 'bogus' }, 'invalid_effort'],
    [[], { SONAH_EFFORT: '' }, 'invalid_effort'],
    [['--effort', 'bogus', '--dry-run'], {}, 'invalid_effort'],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol', '--effort', 'max'], {}, 'effort_claude_cli_only'],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol', '--effort', 'high'], {}, 'effort_claude_cli_only'],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol'], { SONAH_EFFORT: 'max' }, 'effort_claude_cli_only'],
    [['--model', 'gpt-5.6-sol', '--effort', 'max'], { SONAH_REVIEW_BACKEND: 'codex-cli' }, 'effort_claude_cli_only'],
    [['--backend', 'anthropic-api', '--model', 'claude-test-1', '--effort', 'low'], { ANTHROPIC_API_KEY: 'synthetic' },
      'effort_claude_cli_only'],
    [['--backend', 'anthropic-api', '--model', 'claude-test-1'], { ANTHROPIC_API_KEY: 'synthetic', SONAH_EFFORT: 'max' },
      'effort_claude_cli_only'],
    [['--model', 'claude-test-1'], { SONAH_REVIEW_BACKEND: 'anthropic-api', ANTHROPIC_API_KEY: 'synthetic',
      SONAH_EFFORT: 'high' }, 'effort_claude_cli_only'],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol', '--effort', 'max', '--dry-run'], {}, 'effort_claude_cli_only'],
  ];
  for (const [argv, env, problem] of cases) {
    const state = await stateDir(t);
    const run = await review(t, { root, state, argv, env });
    const name = `${argv.join(' ')} ${JSON.stringify(env)}`;
    assert.equal(run.code, 2, name);
    assert.equal(run.err, `Review could not complete: ${problem}.\nFix: ${REVIEW_FIX_WORDS[problem]}\n`, name);
    assert.equal(run.out, '', `${name}: nothing said before`);
    assert.equal(run.loaded(), 0, `${name}: the recording is never read`);
    assert.deepEqual(run.judges, [], name);
    assert.deepEqual(await readdir(join(state, '..')), [], `${name}: nothing written`);
  }
  // codex-cli with no effort named reviews as before.
  const codex = await review(t, { root, state: await stateDir(t), argv: ['--backend', 'codex-cli', '--model', 'gpt-5.6-sol'] });
  assert.equal(codex.code, 0, codex.err);
  assert.ok(codex.judges.length > 0 && codex.judges.every((judge) => !Object.hasOwn(judge.config, 'effort')));
});

// ---- replay, identity and the record -----------------------------------------------------------------------------------
test('D160: a stored answer replays at its own effort with no call, and never at another; the run\'s identity, its '
  + 'usage entry and its record name the effort only when it is not the default', async (t) => {
  const root = await gitRepoWith(t);
  const state = await stateDir(t);
  const answers = join(state, 'answers'), codeAnswers = join(state, 'code-pass', 'answers');
  const first = await review(t, { root, state, argv: ['--code-pass', '--effort', 'max'] });
  assert.equal(first.code, 0, first.err);
  const asked = first.calls.length;
  assert.ok(asked > 0 && first.calls.some(({ request }) => CODE_LABEL.test(request.label)));
  const atMax = { session: await stored(answers), code: await stored(codeAnswers) };
  assert.ok(atMax.session.length > 0 && atMax.code.length > 0);
  assert.equal(first.report.instrument.effort, 'max');
  // The same effort again: every answer is reused, the session's and the code step's, and nothing is asked.
  const again = await review(t, { root, state, argv: ['--code-pass', '--effort', 'max'] });
  assert.equal(again.code, 0, again.err);
  assert.deepEqual(again.calls, [], 'a second run at max makes no call');
  assert.match(again.out, /^Model answers: (\d+) of \1 reused \(no call\)\.$/m);
  assert.match(again.out, /^Code review answers: (\d+) of \1 reused \(no call\)\.$/m);
  // The same effort from the variable is the same question.
  const fromEnv = await review(t, { root, state, argv: ['--code-pass'], env: { SONAH_EFFORT: 'max' } });
  assert.deepEqual(fromEnv.calls, []);
  // The default on the same state: nothing stored at max is replayed; every request is asked again.
  const plain = await review(t, { root, state, argv: ['--code-pass'] });
  assert.equal(plain.code, 0, plain.err);
  assert.equal(plain.calls.length, asked, 'every request asked again at the default');
  assert.equal(Object.hasOwn(plain.report.instrument, 'effort'), false, 'the record as before');
  const atHigh = { session: await stored(answers), code: await stored(codeAnswers) };
  assert.equal(atHigh.session.length, 2 * atMax.session.length, 'answers at high stored beside those at max');
  assert.deepEqual(atHigh.session.filter((name) => atMax.session.includes(name)), atMax.session);
  // And another level is another question again.
  const xhigh = await review(t, { root, state, argv: ['--code-pass', '--effort', 'xhigh'] });
  assert.equal(xhigh.calls.length, asked);
  // The run entries: max, max, max, the default (no effort member), xhigh.
  assert.deepEqual(xhigh.runs.map((run) => run.identity.effort ?? null), ['max', 'max', 'max', null, 'xhigh']);
  for (const run of xhigh.runs) {
    assert.ok(usageRunIdentityValid(run.identity));
    assert.deepEqual(Object.keys(run.identity), ['backend', 'model', 'codeModel',
      ...(run.identity.effort ? ['effort'] : [])]);
  }
  // Only runs at the same effort are summed as one review's cost.
  const [max1, max2, , high1, x1] = xhigh.runs.map((run) => run.identity);
  assert.ok(sameRunIdentity(max1, max2));
  assert.ok(!sameRunIdentity(max1, high1) && !sameRunIdentity(high1, x1) && !sameRunIdentity(max1, x1));
  assert.ok(sameRunIdentity(high1, { backend: 'claude-cli', model: SESSION_MODEL, codeModel: null }));
  // An identity naming the default, or an effort off the list, is not one a run writes.
  for (const effort of ['high', 'bogus', null])
    assert.equal(usageRunIdentityValid({ backend: 'claude-cli', model: SESSION_MODEL, codeModel: null, effort }), false);
});

test('D160: the dry run with the code step and --state-dir counts the stored answers at the effort named: none at max '
  + 'after a review at high, all after a review at max', async (t) => {
  const root = await gitRepoWith(t);
  const reuse = /^Stored session answers: the store answers (\d+) of (\d+) session calls, with no new call\.(?: A review would make at least (\d+) new calls?\.)?$/m;
  const counted = (run) => {
    const [, reused, total, missing] = run.out.match(reuse) ?? [];
    return { reused: Number(reused), total: Number(total), missing: Number(missing ?? 0) };
  };
  const highState = await stateDir(t);
  assert.equal((await review(t, { root, state: highState, argv: ['--code-pass'] })).code, 0);
  const atHigh = counted(await review(t, { root, state: highState, argv: ['--dry-run', '--code-pass'] }));
  assert.ok(atHigh.reused > 0 && atHigh.missing === 0, JSON.stringify(atHigh));
  const maxOnHigh = await review(t, { root, state: highState, argv: ['--dry-run', '--code-pass', '--effort', 'max'] });
  assert.equal(maxOnHigh.code, 0);
  assert.deepEqual(maxOnHigh.judges, [], 'a dry run makes no judge');
  const none = counted(maxOnHigh);
  assert.equal(none.reused, 0, 'nothing stored at high is counted for max');
  assert.ok(none.missing > 0);
  const maxState = await stateDir(t);
  assert.equal((await review(t, { root, state: maxState, argv: ['--code-pass', '--effort', 'max'] })).code, 0);
  const all = counted(await review(t, { root, state: maxState, argv: ['--dry-run', '--code-pass', '--effort', 'max'] }));
  assert.deepEqual(all, { reused: atHigh.reused, total: atHigh.reused, missing: 0 }, 'every answer stored at max counted');
  const highOnMax = counted(await review(t, { root, state: maxState, argv: ['--dry-run', '--code-pass'] }));
  assert.equal(highOnMax.reused, 0, 'nothing stored at max is counted for the default');
});

test('D160: --model X with no --code-model runs the code step on X at the same effort, and so does --code-model X: '
  + 'a review on Opus at max', async (t) => {
  const root = await repoWith(t);
  for (const argv of [['--model', OPUS, '--effort', 'max'], ['--model', OPUS, '--code-model', OPUS, '--effort', 'max']]) {
    const run = await review(t, { root, state: await stateDir(t), argv: ['--code-pass', ...argv] });
    assert.equal(run.code, 0, run.err);
    assert.deepEqual(run.judges.map(({ model, effort }) => [model, effort]), [[OPUS, 'max'], [OPUS, 'max']]);
    for (const call of run.calls) {
      assert.equal(call.argv[call.argv.indexOf('--model') + 1], OPUS);
      assert.equal(effortOf(call.argv), 'max');
    }
  }
});

// ---- doctor and feedback -------------------------------------------------------------------------------------------------
test('D160: sonah doctor takes --effort (else SONAH_EFFORT) as the review does, and its probe asks at it', async () => {
  assert.match(DOCTOR_USAGE, /\[--effort LEVEL\]$/);
  assert.equal(parseDoctorArgs(['--effort', 'max'], {}).effort, 'max');
  assert.equal(parseDoctorArgs([], { SONAH_EFFORT: 'xhigh' }).effort, 'xhigh');
  assert.equal(parseDoctorArgs(['--effort', 'low'], { SONAH_EFFORT: 'xhigh' }).effort, 'low');
  assert.equal(Object.hasOwn(parseDoctorArgs([], {}), 'effort'), false, 'none named: the options as before');
  for (const [argv, env] of [[['--effort', 'bogus'], {}], [[], { SONAH_EFFORT: 'bogus' }],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol', '--effort', 'max'], {}],
    [['--backend', 'codex-cli', '--model', 'gpt-5.6-sol'], { SONAH_EFFORT: 'high' }], [['--effort'], {}]])
    assert.throws(() => parseDoctorArgs(argv, env), { code: 'usage' }, argv.join(' '));
  // A refused effort is said by its code and the review's fix, which names SONAH_EFFORT; nothing else is run.
  const refusal = async (argv, env) => {
    let err = '', out = '';
    const code = await runDoctorCommand(argv, { stdout: { write: (text) => { out += text; } },
      stderr: { write: (text) => { err += text; } }, env, runCli: async () => assert.fail('nothing is run') });
    return { code, err, out };
  };
  for (const [argv, env, problem] of [[['--effort', 'bogus'], {}, 'invalid_effort'],
    [['--no-probe'], { SONAH_EFFORT: 'Max' }, 'invalid_effort'], [[], { SONAH_EFFORT: '' }, 'invalid_effort'],
    [['--backend', 'codex-cli', '--model', 'gpt-6.1-sol', '--no-probe'], { SONAH_EFFORT: 'max' }, 'effort_claude_cli_only'],
    [['--backend', 'codex-cli', '--model', 'gpt-6.1-sol', '--effort', 'high'], {}, 'effort_claude_cli_only']]) {
    const run = await refusal(argv, env);
    assert.equal(run.code, 2);
    assert.equal(run.err, `Doctor could not run: ${problem}.\nFix: ${REVIEW_FIX_WORDS[problem]}\n`, argv.join(' '));
    assert.match(run.err, /SONAH_EFFORT/);
    assert.equal(run.out, '');
  }
  // Any other usage problem keeps the usage line.
  assert.match((await refusal(['--effort'], {})).err, /^usage: sonah doctor /);
  // The probe: one judge, made at the effort named; none named, its settings as before.
  const probe = async (options, env = {}) => {
    const made = [];
    const result = await doctor(options, { env: { HOME: '/nonexistent-d160', ...env }, home: '/nonexistent-d160',
      nodeVersion: '22.0.0', cwd: '/nonexistent-d160', commitLink: async () => null,
      adapters: async () => ({ claude: { count: 0, where: '/x' }, codex: { count: 0, where: '/y' } }),
      runCli: async (file, args) => (args[0] === '--version' ? { stdout: '2.1.310 (Claude Code)' }
        : { stdout: JSON.stringify({ loggedIn: true }) }),
      createJudge: ({ config, onResult }) => {
        made.push(config);
        return async () => {
          onResult({ ok: true, attestation: 'attested', contextWindow: 1_000_000, configuredModel: config.model,
            servedModels: ['claude-sonnet-5-5'] });
          return { ok: true };
        };
      } });
    return { made, result };
  };
  const plain = await probe({});
  assert.deepEqual(plain.made, [{ backend: 'claude-cli', model: SESSION_MODEL }]);
  assert.match(plain.result.text, new RegExp(`^Model: ${SESSION_MODEL.replace(/[[\]]/g, '\\$&')} answered one tiny `, 'm'));
  const max = await probe({ effort: 'max' });
  assert.deepEqual(max.made, [{ backend: 'claude-cli', model: SESSION_MODEL, effort: 'max' }]);
  assert.match(max.result.text, /^Model: claude-sonnet-5-5\[1m\] answered one tiny synthetic request under the 1M context window, asked at effort max\.$/m);
  const fromEnv = await probe({}, { SONAH_EFFORT: 'xhigh' });
  assert.deepEqual(fromEnv.made, [{ backend: 'claude-cli', model: SESSION_MODEL, effort: 'xhigh' }]);
  const high = await probe({ effort: 'high' });
  assert.doesNotMatch(high.result.text, /at effort/, 'the default is not named');
  // The command table of `sonah --help` lists it on doctor's row, within 80 columns.
  const help = spawnSync(process.execPath, [join(HERE, '..', 'bin', 'sonah.js'), '--help'], { encoding: 'utf8',
    env: { ...process.env, SONAH_NO_UPDATE_CHECK: '1' } });
  assert.match(help.stdout + help.stderr, /^ {6}\[--backend claude-cli\|codex-cli\] \[--model ID\] \[--effort LEVEL\]$/m);
  assert.ok((help.stdout + help.stderr).split('\n').every((line) => line.length <= 80));
});

test('D160: sonah feedback reads an effort the review would refuse as an invalid configuration', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d160-feedback-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const text = async (env, outDir) => {
    await mkdir(outDir, { recursive: true });
    const { text: written } = await feedbackBundle({ outDir, env,
      adapters: async () => ({ claude: { count: 0 }, codex: { count: 0 } }), now: new Date('2026-10-27T00:00:00.000Z') });
    return written;
  };
  assert.match(await text({}, join(dir, 'a')), /^ {2}model: claude-sonnet-5-5\[1m\]$/m);
  assert.match(await text({ SONAH_EFFORT: 'max' }, join(dir, 'b')), /^ {2}model: claude-sonnet-5-5\[1m\]$/m);
  for (const [env, at] of [[{ SONAH_EFFORT: 'bogus' }, 'c'], [{ SONAH_EFFORT: 'max', SONAH_REVIEW_BACKEND: 'codex-cli',
    SONAH_MODEL: 'gpt-5.6-sol' }, 'd']])
    assert.match(await text(env, join(dir, at)), /provider and model: UNCHECKED \(invalid configuration\)/);
});
