// D210 (lever 1): every claude call Sonah makes asks the CLI for the five-minute prompt cache (review-judge.js
// `claudeEnvironment` sets FORCE_PROMPT_CACHING_5M), whatever the person's shell holds; the account-only environment of
// doctor's `--version` and `auth status` does not. No argv, system prompt or prompt byte moves, so no answer key moves and
// an answer stored before replays. The usage record and the "Review usage" line split the cache writes by how long the
// cache keeps them (review-budget.js). Every byte here is synthetic: the spawn and doctor's commands are injected, no CLI
// or model is started, and no real ~/.claude is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLI_PROMPT_CACHE_5M_VARIABLE, REVIEW_AGENT_TRANSPORT_VERSION, REVIEW_TRANSPORT_VERSION, agentRequestOf,
  claudeEnvironment, createReviewJudge, reviewAgentCliArgs, reviewCliArgs } from '../src/review-judge.js';
import { answerKey, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { CACHE_WRITE_FIELDS, CODE_STEP_PART, REVIEW_USAGE_VERSION, createReviewBudget } from '../src/review-budget.js';
import { doctor } from '../src/doctor.js';

const MODEL = 'claude-sonnet-5-5[1m]';
const SYSTEM = 'D151_SYNTHETIC_SYSTEM';
const SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['exports'],
  properties: { exports: { type: 'array', items: { type: 'string' } } } });
/** The person's own cache settings (2.1.311's names, byte search): none of them reaches a call. */
const PERSON = Object.freeze({ HOME: '/synthetic/home', PATH: '/synthetic/bin', USER: 'synthetic-user', LANG: 'C',
  FORCE_PROMPT_CACHING_5M: '0', ENABLE_PROMPT_CACHING_1H: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h',
  CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL: '1h', DISABLE_PROMPT_CACHING: '1' });
const PERSON_CACHE_NAMES = ['ENABLE_PROMPT_CACHING_1H', 'CLAUDE_CODE_PROMPT_CACHE_TTL',
  'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL', 'DISABLE_PROMPT_CACHING'];

/** A spawn that records each call's argv and environment, then fails the call (exit 1). */
function capturingSpawn() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => child.emit('close', 1, null)));
    return child;
  };
  return { calls, spawnProcess };
}

async function scratch(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah d210-${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The requests of D151's pins (d151-claude-environment.test.js), byte for byte. */
const requests = (root) => ({
  session: { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'narrative:w1' },
  challenge: { system: SYSTEM, prompt: 'D151_SYNTHETIC_CHALLENGE_PROMPT', label: 'challenge:w1:b1:p1', schema: SCHEMA,
    challenge: { items: [], pass: 1, batchIndex: 0 } },
  agent: { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'code-review:agent', schema: SCHEMA,
    agent: { root, addDirs: [], maxTurns: 3 } },
});

// ---- the environment ------------------------------------------------------------------------------------------------
test('D210: a session, a challenge and an agent call each ask for the five-minute cache, and no cache setting of the '
  + 'person\'s reaches them', async (t) => {
  assert.equal(CLI_PROMPT_CACHE_5M_VARIABLE, 'FORCE_PROMPT_CACHING_5M');
  const root = await scratch(t, 'env');
  const fake = capturingSpawn();
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: PERSON,
    spawnProcess: fake.spawnProcess });
  const sent = requests(root);
  for (const kind of ['session', 'challenge', 'agent']) await judge(sent[kind]).catch(() => {});
  assert.equal(fake.calls.length, 3);
  for (const [kind, call] of [['session', fake.calls[0]], ['challenge', fake.calls[1]], ['agent', fake.calls[2]]]) {
    assert.equal(call.env.FORCE_PROMPT_CACHING_5M, '1', `${kind}: Sonah's value, never the person's 0`);
    for (const name of PERSON_CACHE_NAMES) assert.equal(Object.hasOwn(call.env, name), false, `${kind}: ${name}`);
  }
  // The builder as the transport calls it, and the account part alone: no model call, so no cache setting.
  assert.equal(claudeEnvironment(PERSON, { request: sent.session }).FORCE_PROMPT_CACHING_5M, '1');
  const account = claudeEnvironment(PERSON, { accountOnly: true });
  assert.equal(Object.hasOwn(account, 'FORCE_PROMPT_CACHING_5M'), false);
  for (const name of PERSON_CACHE_NAMES) assert.equal(Object.hasOwn(account, name), false, name);
});

test('D210: doctor\'s four checks run without the cache setting, and its probe, a model call, with it', async () => {
  const commands = [];
  const status = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' });
  const runCli = async (file, args, options) => {
    commands.push({ file, args, env: options.env });
    if (file !== 'claude') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
    if (args[0] === '--version') return { stdout: '2.1.311 (Claude Code)\n' };
    return { stdout: status };
  };
  const fake = capturingSpawn();
  await doctor({ probe: true }, { env: PERSON, nodeVersion: '20.0.0', runCli,
    createJudge: (options) => createReviewJudge({ ...options, spawnProcess: fake.spawnProcess }),
    adapters: async () => ({ claude: { count: 1, where: 'x' }, codex: { count: 0, where: 'y' } }),
    commitLink: async () => null });
  const checks = commands.filter((c) => c.file === 'claude');
  assert.equal(checks.length, 4);
  for (const check of checks) assert.equal(Object.hasOwn(check.env, 'FORCE_PROMPT_CACHING_5M'), false, check.args[0]);
  assert.equal(fake.calls.length, 1, 'the probe');
  assert.equal(fake.calls[0].env.FORCE_PROMPT_CACHING_5M, '1');
});

// ---- no argv, key or version moves; a stored answer replays -----------------------------------------------------------
test('D210: the argv, the answer keys and both transport versions are D151\'s pins', async (t) => {
  const sent = requests('/synthetic/repo/pkg');
  const agentRequest = { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'code-review:agent', schema: SCHEMA,
    agent: { root: '/synthetic/repo/pkg', addDirs: ['/synthetic/repo'], maxTurns: 40 } };
  const identity = { backend: 'claude-cli', model: MODEL };
  // Computed at 36da44be, before D151, and pinned by d151-claude-environment.test.js.
  assert.equal(answerKey(sent.session, identity), '2db2a432b7387f6e7a18effd3f3794dc70ac045d777cd9d252a391fe1ea470a4');
  assert.equal(answerKey(sent.challenge, identity), '7090543ce678a4d46f105264a9cb208bf23ab73516e0e0fc5f61b201cbc0a512');
  assert.equal(answerKey(agentRequest, { ...identity, repoState: 'a'.repeat(64) }),
    '3bc460b0fb39869cd944b752c3c8b7916e5671e95474922bbd21f71bbcb2bc07');
  assert.deepEqual([REVIEW_TRANSPORT_VERSION, REVIEW_AGENT_TRANSPORT_VERSION],
    ['sonah.review-transport/3', 'sonah.review-agent-transport/2']);
  // The switch is in the environment, never in the argv a call is spawned with.
  const root = await scratch(t, 'argv');
  const fake = capturingSpawn();
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: PERSON,
    spawnProcess: fake.spawnProcess });
  const local = requests(root);
  for (const kind of ['session', 'challenge', 'agent']) await judge(local[kind]).catch(() => {});
  assert.deepEqual(fake.calls[0].args, reviewCliArgs({ system: SYSTEM, model: MODEL }));
  assert.deepEqual(fake.calls[1].args, reviewCliArgs({ system: SYSTEM, model: MODEL }));
  assert.deepEqual(fake.calls[2].args, reviewAgentCliArgs({ system: SYSTEM, model: MODEL,
    agent: agentRequestOf(local.agent), schema: SCHEMA }));
  for (const call of fake.calls) assert.ok(!JSON.stringify(call.args).includes('CACHING'), 'no switch in the argv');
});

/** An answer file as Sonah 0.3.0-beta.12 wrote it (answer-cache.js `put`: `<key>.<occurrence>.json`, owner-only). */
async function storedBefore(directory, key, record) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(join(directory, `${key}.0.json`), JSON.stringify({ key, occurrence: 0, ...record }), { mode: 0o600 });
}

test('D210: an answer stored before the switch, under its pinned key, replays through the judge that sets it, with no '
  + 'call', async (t) => {
  const dir = await scratch(t, 'replay');
  const identity = { backend: 'claude-cli', model: MODEL };
  const session = requests('/synthetic/repo/pkg').session;
  const sessionKey = '2db2a432b7387f6e7a18effd3f3794dc70ac045d777cd9d252a391fe1ea470a4';
  await storedBefore(join(dir, 'session'), sessionKey, { response: { summary: 'D210_SYNTHETIC_STORED' } });
  const agentRequest = { system: SYSTEM, prompt: 'D151_SYNTHETIC_PROMPT', label: 'code-review:agent', schema: SCHEMA,
    agent: { root: '/synthetic/repo/pkg', addDirs: ['/synthetic/repo'], maxTurns: 40 } };
  const agentKey = '3bc460b0fb39869cd944b752c3c8b7916e5671e95474922bbd21f71bbcb2bc07';
  const run = { numTurns: 2, toolCalls: { Read: 1, Grep: 0, Glob: 0, StructuredOutput: 1 }, reads: ['a.js'],
    readRanges: [{ path: 'a.js', startLine: 1, numLines: 3, totalLines: 3 }], readsUnranged: 0, readsUnrangedPaths: [],
    readsFailed: [] };
  await storedBefore(join(dir, 'code'), agentKey, { response: { exports: ['D210_SYNTHETIC'] }, run });

  const fake = capturingSpawn();
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: PERSON,
    spawnProcess: fake.spawnProcess });
  const sessionMemo = memoizeJudge(judge, createAnswerCache(join(dir, 'session'), identity));
  assert.deepEqual(await sessionMemo(session), { summary: 'D210_SYNTHETIC_STORED' });
  const codeMemo = memoizeJudge(judge, createAnswerCache(join(dir, 'code'), { ...identity, repoState: 'a'.repeat(64) }));
  const answer = await codeMemo(agentRequest);
  assert.deepEqual(answer, { exports: ['D210_SYNTHETIC'] });
  assert.deepEqual(answer.agentRun, run, 'its reading record is set again, as before');
  assert.equal(fake.calls.length, 0, 'nothing was asked again');
  assert.deepEqual([sessionMemo.answers, codeMemo.answers], [{ calls: 0, reused: 1 }, { calls: 0, reused: 1 }]);
  // The control: a request the store does not hold is sent, with the switch.
  await sessionMemo({ ...session, prompt: 'D210_SYNTHETIC_NEW' }).catch(() => {});
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].env.FORCE_PROMPT_CACHING_5M, '1');
});

// ---- the cache writes by how long the cache keeps them ----------------------------------------------------------------
/** One attempt's metadata as the claude CLI reports it, with `cache_creation` when `writes` is given. */
const attempt = (uncached, write, read, writes = null) => ({ ok: true, costUsd: 0.01, usage: { input_tokens: uncached,
  output_tokens: 1, cache_creation_input_tokens: write, cache_read_input_tokens: read,
  ...(writes ? { cache_creation: { [CACHE_WRITE_FIELDS.fiveMinutes]: writes[0],
    [CACHE_WRITE_FIELDS.oneHour]: writes[1] } } : {}) } });

test('D210: the usage record and the usage line split the cache writes, summed like the others, the code step\'s part '
  + 'apart', async () => {
  const budget = createReviewBudget({}, { now: () => 0 });
  const send = (part) => budget.wrap(async (metadata) => { budget.record(metadata, part); return {}; }, part);
  await send(null)(attempt(10, 20408, 0, [0, 20408]));
  await send(null)(attempt(10, 20411, 0, [20411, 0]));
  await send(CODE_STEP_PART)(attempt(5, 300, 700, [300, 0]));
  const usage = budget.usageRecord();
  assert.equal(usage.version, REVIEW_USAGE_VERSION);
  assert.equal(REVIEW_USAGE_VERSION, 'sonah.review-usage/1', 'the one reader reads no member of the split');
  assert.deepEqual(usage.inputSplit, { uncached: 25, cacheWrite: 41119, cacheRead: 700, reportedCalls: 3,
    cacheWrites: { fiveMinutes: 20711, oneHour: 20408, reportedCalls: 3 } });
  assert.deepEqual(usage.code.inputSplit, { uncached: 5, cacheWrite: 300, cacheRead: 700, reportedCalls: 1,
    cacheWrites: { fiveMinutes: 300, oneHour: 0, reportedCalls: 1 } });
  const line = budget.summaryLine({ codeStep: true });
  assert.ok(line.includes('input tokens 41844 (3/3 calls reported: 25 uncached, 41119 written to the cache (20711 for '
    + 'five minutes, 20408 for one hour), 700 read from the cache); '), line);
  assert.ok(line.includes('Code step: 1 of these calls; 0 input bytes; input tokens 1005 (1/1 calls reported: 5 '
    + 'uncached, 300 written to the cache (300 for five minutes, 0 for one hour), 700 read from the cache); '), line);
});

test('D210: a call that reports no such split leaves the record and the line as before; one that reports a value that '
  + 'is not a count adds nothing', async () => {
  const before = createReviewBudget({}, { now: () => 0 });
  const wrap = (budget) => budget.wrap(async (metadata) => { budget.record(metadata); return {}; });
  await wrap(before)(attempt(10, 4, 6));
  assert.deepEqual(before.usageRecord().inputSplit, { uncached: 10, cacheWrite: 4, cacheRead: 6, reportedCalls: 1 });
  assert.match(before.summaryLine(), /\(1\/1 calls reported: 10 uncached, 4 written to the cache, 6 read from the cache\); /);
  // Two calls report the split of the input, one of them the split of its writes: the line says how many.
  const mixed = createReviewBudget({}, { now: () => 0 });
  await wrap(mixed)(attempt(10, 4, 6));
  await wrap(mixed)(attempt(10, 8, 0, [8, 0]));
  await wrap(mixed)(attempt(10, 8, 0, ['8', 0]));
  await wrap(mixed)({ ok: true, usage: { input_tokens: 1, cache_creation_input_tokens: 2,
    cache_creation: { ephemeral_5m_input_tokens: 2 } } });
  assert.deepEqual(mixed.usageRecord().inputSplit.cacheWrites, { fiveMinutes: 10, oneHour: 0, reportedCalls: 2 });
  assert.match(mixed.summaryLine(), /22 written to the cache \(10 for five minutes, 0 for one hour; 2\/4 calls reported\), /);
});
