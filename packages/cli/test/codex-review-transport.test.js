// W4-1: synthetic Codex review transport. No real CLI or model is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, stat } from 'node:fs/promises';
import { answerKey } from '../src/answer-cache.js';
import { createReviewJudge, reviewJudgeConfig, reviewTransportArguments } from '../src/review-judge.js';

const request = { system: 'Synthetic private system café.', prompt: 'Synthetic private prompt éclair.' };
const answer = [
  { type: 'thread.started', thread_id: 'synthetic-private-thread' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: '{"value":"café"}' } },
  { type: 'turn.completed', usage: { input_tokens: 20, cached_input_tokens: 2, output_tokens: 7 } },
];
const line = (event) => `${JSON.stringify(event)}\n`;

function fakeCodex({ events = answer, exitCode = 0, hang = false, throwOnSpawn = false,
  emitError = false, splitBytes = false, stderrText = `Synthetic private stderr ${request.prompt}`,
  inspect = async () => {} } = {}) {
  const capture = { calls: 0, kills: 0, stdin: '' };
  const spawnProcess = (command, args, options) => {
    capture.calls++;
    if (throwOnSpawn) throw new Error(`Synthetic private process path ${request.prompt}`);
    Object.assign(capture, { command, args, options });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let closed = false;
    const close = (code) => { if (!closed) { closed = true; child.emit('close', code); } };
    child.kill = () => { capture.kills++; setImmediate(() => close(null)); return true; };
    child.stdin.on('data', (chunk) => { capture.stdin += chunk.toString('utf8'); });
    child.stdin.on('finish', () => setImmediate(async () => {
      try { await inspect(capture); } catch (error) { child.emit('error', error); return; }
      if (stderrText) child.stderr.write(stderrText);
      if (emitError) { child.emit('error', new Error(request.prompt)); return; }
      if (hang) return;
      const bytes = Buffer.from(events.map((event) => typeof event === 'string' ? event : line(event)).join(''));
      if (splitBytes) for (const byte of bytes) child.stdout.write(Buffer.from([byte]));
      else child.stdout.write(bytes);
      setImmediate(() => close(exitCode));
    }));
    return child;
  };
  return { spawnProcess, capture };
}

async function rejected(judge) {
  try { await judge(request); } catch (error) { return error; }
  assert.fail('Expected the Codex transport to reject the synthetic reply');
}

test('W4-1 Codex review is explicit and requires a model', () => {
  assert.deepEqual(reviewJudgeConfig({}, { backend: 'codex-cli', model: 'gpt-5.6-sol' }),
    { backend: 'codex-cli', model: 'gpt-5.6-sol', version: 'sonah.review-transport/3' });
  assert.throws(() => reviewJudgeConfig({}, { backend: 'codex-cli' }), { code: 'invalid_model' });
  assert.throws(() => reviewJudgeConfig({}, { backend: 'codex' }), { code: 'unsupported_backend' });
});

test('W4-1 Codex sends stdin and a private instructions file with stable, cache-bound argv', async () => {
  const fake = fakeCodex({ splitBytes: true, inspect: async (capture) => {
    capture.directoryMode = (await stat(capture.options.cwd)).mode & 0o777;
    capture.instructionsMode = (await stat(`${capture.options.cwd}/instructions.txt`)).mode & 0o777;
    capture.instructions = await readFile(`${capture.options.cwd}/instructions.txt`, 'utf8');
  } });
  const metrics = [];
  const env = { HOME: '/synthetic-home', CODEX_HOME: '/synthetic-auth', PATH: '/bin', LANG: 'C',
    OPENAI_API_KEY: 'synthetic-secret', CODEX_API_KEY: 'synthetic-secret', ANTHROPIC_API_KEY: 'synthetic-secret',
    OPENAI_BASE_URL: 'https://invalid.example', CODEX_BASE_URL: 'https://invalid.example',
    SONAH_CODEX_BIN: '/private/override', NODE_EXTRA_CA_CERTS: '/private/cert' };
  const judge = createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' }, env,
    spawnProcess: fake.spawnProcess, onResult: (measurement) => metrics.push(measurement) });
  assert.deepEqual(await judge(request), { value: 'café' });
  const { command, args, options, stdin } = fake.capture;
  assert.equal(command, '/private/override');
  assert.equal(stdin, request.prompt);
  assert.ok(!args.includes(request.prompt) && !args.includes(request.system));
  assert.deepEqual(args, reviewTransportArguments({ backend: 'codex-cli', model: 'gpt-5.6-sol', system: request.system }).argv);
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-5.6-sol');
  assert.ok(args.includes('--ephemeral') && args.includes('--ignore-user-config') && args.includes('--ignore-rules'));
  assert.ok(args.includes('--json') && args.includes('read-only') && args.includes('shell_tool'));
  assert.ok(!args.includes('tools.view_image=false'), 'the native CLI rejects this retired config key');
  assert.equal(args.at(-1), '-');
  assert.ok(args.some((arg) => arg.includes('model_instructions_file="instructions.txt"')));
  assert.deepEqual(options.env, { HOME: '/synthetic-home', CODEX_HOME: '/synthetic-auth', PATH: '/bin', LANG: 'C' });
  assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
  assert.equal(fake.capture.directoryMode, 0o700);
  assert.equal(fake.capture.instructionsMode, 0o600);
  assert.equal(fake.capture.instructions, request.system);
  assert.equal(metrics[0].usage.output_tokens, 7);
  assert.equal(metrics[0].toolUse, 0);
  assert.ok(!JSON.stringify(metrics).includes('Synthetic private'));
  await assert.rejects(stat(options.cwd), { code: 'ENOENT' });
});

test('W4-1 D60 answers separate backends, models, instructions and exact Codex argv', () => {
  const identity = { backend: 'codex-cli', model: 'gpt-5.6-sol' };
  const transport = reviewTransportArguments({ ...identity, system: request.system });
  assert.equal(transport.instructions, request.system);
  assert.equal(typeof transport.argv, 'object');
  const key = answerKey(request, identity);
  assert.notEqual(key, answerKey(request, { ...identity, model: 'gpt-6-sol' }));
  assert.notEqual(key, answerKey({ ...request, system: 'Different synthetic instructions' }, identity));
  assert.notEqual(key, answerKey(request, { backend: 'claude-cli', model: identity.model }));
  assert.notEqual(key, answerKey(request, { ...identity, transportArguments: () =>
    ({ ...transport, argv: [...transport.argv, '--synthetic-different-flag'] }) }));
});

test('W4-1 Codex rejects incomplete, failed, tool-using, malformed, or nonzero turns', async () => {
  const tool = { type: 'item.started', item: { id: 'tool', type: 'command_execution', command: request.prompt } };
  const cases = [
    ['missing completion', { events: answer.slice(0, -1) }, 'model_response_incomplete'],
    ['failed turn', { events: [...answer, { type: 'turn.failed', error: { message: request.prompt } }] }, 'model_unavailable'],
    ['error event', { events: [...answer, { type: 'error', message: request.prompt }] }, 'model_unavailable'],
    ['attempted tool', { events: [tool, ...answer] }, 'model_tool_use'],
    ['nonzero exit', { exitCode: 9 }, 'model_unavailable'],
    ['invalid final JSON', { events: [answer[0], { type: 'item.completed', item: { type: 'agent_message', text: '```json\n{}\n```' } }, answer.at(-1)] }, 'model_response_invalid'],
    ['array final JSON', { events: [answer[0], { type: 'item.completed', item: { type: 'agent_message', text: '[]' } }, answer.at(-1)] }, 'model_response_invalid'],
    ['scalar final JSON', { events: [answer[0], { type: 'item.completed', item: { type: 'agent_message', text: '3' } }, answer.at(-1)] }, 'model_response_invalid'],
    ['malformed stream event', { events: [answer[0], '{private non-json}\n', ...answer.slice(1)] }, 'model_response_invalid'],
    ['no answer item', { events: [answer[0], answer.at(-1)] }, 'model_unavailable'],
  ];
  for (const [name, options, code] of cases) {
    const fake = fakeCodex(options), metrics = [];
    const error = await rejected(createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' },
      spawnProcess: fake.spawnProcess, onResult: (m) => metrics.push(m) }));
    assert.equal(error.code, code, name);
    assert.equal(metrics.length, 1, name);
    assert.ok(!JSON.stringify({ error: error.message, metrics }).includes(request.prompt), name);
    assert.ok(!JSON.stringify({ error: error.message, metrics }).includes('synthetic-private-thread'), name);
  }
});

test('W4-1 a Codex error item is a failed response, not a tool attempt', async () => {
  const warning = { type: 'item.completed', item: { id: 'diagnostic', type: 'error', message: request.prompt } };
  const metrics = [];
  const fake = fakeCodex({ events: [answer[0], warning, ...answer.slice(1)] });
  const error = await rejected(createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' },
    spawnProcess: fake.spawnProcess, onResult: (m) => metrics.push(m) }));
  assert.equal(error.code, 'model_unavailable');
  assert.equal(error.transportClass, 'unknown');
  assert.equal(metrics[0].toolUse, 0);
  assert.ok(!JSON.stringify({ error: error.message, metrics }).includes(request.prompt));
});

test('W4-1 Codex timeout, byte ceiling and process errors fail closed without text', async () => {
  const cases = [
    ['timeout', { hang: true }, { timeoutMs: 20 }, 'model_timeout', 'timeout'],
    ['stdout limit', { stderrText: '' }, { maxOutputBytes: 10 }, 'model_output_limit', 'output_limit'],
    ['stderr limit', { stderrText: request.prompt.repeat(5) }, { maxOutputBytes: 10 }, 'model_output_limit', 'output_limit'],
    ['spawn exception', { throwOnSpawn: true }, {}, 'model_unavailable', 'spawn_failed'],
    ['spawn error', { emitError: true }, {}, 'model_unavailable', 'spawn_failed'],
  ];
  for (const [name, fakeOptions, judgeOptions, code, transportClass] of cases) {
    const fake = fakeCodex(fakeOptions), metrics = [];
    const error = await rejected(createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' },
      spawnProcess: fake.spawnProcess, onResult: (m) => metrics.push(m), ...judgeOptions }));
    assert.equal(error.code, code, name);
    assert.equal(error.transportClass, transportClass, name);
    assert.equal(metrics[0].transportClass, transportClass, name);
    assert.ok(!JSON.stringify({ error: error.message, metrics }).includes(request.prompt), name);
    if (name === 'timeout' || name.endsWith('limit')) assert.ok(fake.capture.kills > 0, name);
  }
});

test('M25 Codex executable override cannot enter a failed review result', async () => {
  const fake = fakeCodex({ throwOnSpawn: true });
  const metrics = [];
  const privatePath = `/synthetic/${request.prompt}/codex`;
  const error = await rejected(createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-5.6-sol' },
    env: { SONAH_CODEX_BIN: privatePath, PATH: '/bin' }, spawnProcess: fake.spawnProcess,
    onResult: (measurement) => metrics.push(measurement) }));
  assert.equal(error.code, 'model_unavailable');
  assert.equal(error.transportClass, 'spawn_failed');
  assert.equal(fake.capture.calls, 1);
  assert.equal(metrics[0].transportClass, 'spawn_failed');
  assert.ok(!JSON.stringify({ error: error.message, metrics }).includes(privatePath));
  assert.ok(!JSON.stringify({ error: error.message, metrics }).includes(request.prompt));
});
