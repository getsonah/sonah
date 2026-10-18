// The claude-cli agent transport (`sonah.review-agent-transport/2`): a request that carries `agent` runs Claude Code with
// Read, Grep and Glob over a repository and answers through the CLI's structured output tool. Every byte here is
// synthetic: invented repositories, prompts, answers and streams. No model is called, no real ~/.claude or ~/.sonah is
// read: each test gets its own temporary HOME, and the `claude` it starts is a fake executable on a temporary PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_MAX_OUTPUT_BYTES, AGENT_RESULT_FAILURES, AGENT_TOOL_NAMES, REVIEW_AGENT_TRANSPORT_VERSION, REVIEW_EFFORT,
  REVIEW_TRANSPORT_VERSION, agentRequestOf, agentRunRecord, createReviewJudge, isAgentRequest, reviewAgentKeyArgs,
  reviewCliArgs, reviewTransportArguments, withTransportRetry } from '../src/review-judge.js';
import { JUDGE_FAILURE_CODES, RETRYABLE_JUDGE_CODES } from '../../evidence/src/ledger.js';
import { TRANSPORT_SHORTFALL } from '../../evidence/src/run-review.js';
import { ANSWER, MODEL, PROMPT, SCHEMA, SYSTEM, agentEvents, fakeClaude, judgeOf, repository } from './agent-transport-fixture.js';

// ---- the argv, the working directory, the environment -----------------------------------------------------------
test('agent transport: the argv the agent is spawned with is reviewTransportArguments\' agent branch, with the read-only '
  + 'tools, the restriction, the turn budget and the schema; the prompt goes on stdin, the working directory is the root',
async (t) => {
  const { top, root, request } = await repository(t);
  const fake = await fakeClaude(t, { events: agentEvents(root) });
  await judgeOf(fake)(request);
  const [call] = await fake.calls();
  const agent = agentRequestOf(request);
  assert.deepEqual(call.args, reviewTransportArguments({ backend: 'claude-cli', model: MODEL, system: SYSTEM, agent,
    schema: SCHEMA }).argv);
  assert.deepEqual(call.args, ['--print', '--model', MODEL, '--effort', REVIEW_EFFORT, '--output-format', 'stream-json',
    '--verbose', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read', 'Grep', 'Glob', '--permission-mode', 'dontAsk',
    '--permission-prompts', 'none', '--restricted', '--add-dir', top, '--max-turns', '40',
    '--json-schema', JSON.stringify(SCHEMA), '--disable-slash-commands', '--setting-sources', '',
    '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', SYSTEM]);
  assert.ok(!call.args.includes('--include-partial-messages'), 'nothing reads a partial message');
  assert.ok(!call.args.includes(PROMPT));
  assert.equal(call.stdin, PROMPT);
  assert.equal(call.cwd, await realpath(root));
  // localEnvironment, plus the switch that loads no CLAUDE.md as the agent's own instructions; the login's USER, LOGNAME
  // and SHELL kept; no API key and no inherited Claude option.
  for (const [key, value] of Object.entries({ HOME: fake.home, USER: 'synthetic-user', LOGNAME: 'synthetic-user',
    SHELL: '/bin/sh', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' })) assert.equal(call.env[key], value, key);
  assert.equal(call.env.ANTHROPIC_API_KEY, undefined);
  assert.equal(call.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, undefined);
  // The key's arguments: the same argv with each --add-dir path and the system prompt left out.
  assert.deepEqual(reviewAgentKeyArgs(call.args), call.args.filter((arg) => arg !== top && arg !== SYSTEM));
});

test('agent transport: a session request\'s argv and environment are byte for byte as before', async (t) => {
  // The tool-free argv, pinned whole: every stored session answer is keyed by it (answer-cache.js).
  assert.deepEqual(reviewCliArgs({ system: 'S', model: 'sonnet' }), ['--print', '--model', 'sonnet', '--effort', 'high',
    '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--tools', '', '--disable-slash-commands',
    '--setting-sources', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence',
    '--system-prompt', 'S']);
  assert.deepEqual(reviewTransportArguments({ backend: 'claude-cli', model: 'sonnet', system: 'S' }),
    { argv: reviewCliArgs({ system: 'S', model: 'sonnet' }) });
  assert.equal(REVIEW_TRANSPORT_VERSION, 'sonah.review-transport/3');
  // D105: /2, the run record holds each Read's lines.
  assert.equal(REVIEW_AGENT_TRANSPORT_VERSION, 'sonah.review-agent-transport/2');
  const { root } = await repository(t);
  const fake = await fakeClaude(t, { events: agentEvents(root, { tools: [] }) });
  await judgeOf(fake)({ system: SYSTEM, prompt: PROMPT });
  const [call] = await fake.calls();
  assert.deepEqual(call.args, reviewCliArgs({ system: SYSTEM, model: MODEL }));
  assert.equal(call.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, undefined, 'only an agent request loads no CLAUDE.md');
  assert.notEqual(call.cwd, await realpath(root), 'a session request runs in its own private folder');
});

// ---- what the stream may hold --------------------------------------------------------------------------------------
test('agent transport: a real-shaped stream (Read, then StructuredOutput) is accepted; structured_output is the answer, '
  + 'and what the agent did rides on it, not enumerable, and reaches onResult', async (t) => {
  const { root, request } = await repository(t);
  const fake = await fakeClaude(t, { events: agentEvents(root) });
  const reported = [];
  const answer = await judgeOf(fake, { onResult: (metadata) => reported.push(metadata) })(request);
  assert.deepEqual(answer, ANSWER);
  assert.deepEqual(Object.keys(answer), ['exports']);
  assert.equal(JSON.stringify(answer), JSON.stringify(ANSWER), 'a stored answer never holds it');
  const run = { numTurns: 3, toolCalls: { Read: 1, Grep: 0, Glob: 0, StructuredOutput: 1 }, reads: [join(root, 'a.js')],
    readRanges: [{ path: join(root, 'a.js'), startLine: 1, numLines: 1, totalLines: 1 }], readsUnranged: 0,
    readsUnrangedPaths: [], readsFailed: [],
    // The result's one denial names no Read of this run: no Read is counted refused for it.
    permissionDenials: 1, durationMs: 4321, costUsd: 0.0125,
    usage: { input_tokens: 4, cache_creation_input_tokens: 400, cache_read_input_tokens: 900, output_tokens: 60 } };
  assert.deepEqual(answer.agentRun, run);
  assert.equal(reported.length, 1);
  assert.deepEqual(reported[0].agentRun, run);
  assert.equal(reported[0].ok, true);
  assert.equal(reported[0].attestation, 'attested', 'the agent answer is attested as any answer is');
  assert.equal(reported[0].toolUse, 2);
  assert.deepEqual(AGENT_TOOL_NAMES, ['Read', 'Grep', 'Glob', 'StructuredOutput']);
  // The structured output is the answer even when the result's text is not JSON.
  const prose = await fakeClaude(t, { events: agentEvents(root, { result: { result: 'Done: the answer was submitted.' } }) });
  assert.deepEqual(await judgeOf(prose)(request), ANSWER);
});

test('agent transport /2 (D105): each Read\'s path, start line, line count and total lines come from its typed result, '
  + 'by structure, with no text; a result of another shape, another tool\'s, or one shared by two results gives none',
async (t) => {
  const { root, request } = await repository(t);
  const FILE = join(root, 'a.js');
  const typed = (id, file) => ({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
    { tool_use_id: id, type: 'tool_result', content: 'SYNTHETIC_FILE_TEXT' }] }, tool_use_result: { type: 'text', file } });
  const use = (id, name, input) => ({ type: 'assistant', parent_tool_use_id: null, message: { model: MODEL,
    role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
  const HOSTS = '/etc/hosts';
  const base = agentEvents(root, { tools: ['StructuredOutput'], result: { permission_denials: [
    { tool_name: 'Read', tool_use_id: 'r6', tool_input: { file_path: HOSTS } }] } });
  const at = base.findIndex((e) => e.type === 'assistant' && e.message.content.some((b) => b.name === 'StructuredOutput'));
  const events = [...base.slice(0, at),
    use('r1', 'Read', { file_path: FILE, offset: 125, limit: 80 }),
    typed('r1', { filePath: FILE, content: 'SYNTHETIC_FILE_TEXT', startLine: 125, numLines: 80, totalLines: 423 }),
    // The same id's result again counts once.
    typed('r1', { filePath: FILE, content: 'SYNTHETIC_FILE_TEXT', startLine: 1, numLines: 9, totalLines: 423 }),
    use('g1', 'Grep', { pattern: 'export' }),
    typed('g1', { filePath: FILE, content: 'SYNTHETIC_FILE_TEXT', startLine: 1, numLines: 1, totalLines: 1 }),
    use('r2', 'Read', { file_path: join(root, 'missing.js') }),
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: 'r2', type: 'tool_result',
      is_error: true, content: 'File does not exist.' }] } },
    use('r3', 'Read', { file_path: FILE }), use('r4', 'Read', { file_path: FILE }),
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [
      { tool_use_id: 'r3', type: 'tool_result', content: 'x' }, { tool_use_id: 'r4', type: 'tool_result', content: 'y' }] },
    tool_use_result: { type: 'text', file: { filePath: FILE, content: 'x', startLine: 1, numLines: 1, totalLines: 1 } } },
    use('r5', 'Read', { file_path: FILE }),
    typed('r5', { filePath: FILE, content: 'SYNTHETIC_FILE_TEXT', startLine: 0, numLines: 1, totalLines: 1 }),
    // A Read the CLI refused: its result typed as an error, and the result event lists it among the refused uses.
    use('r6', 'Read', { file_path: HOSTS }),
    { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: 'r6', type: 'tool_result',
      is_error: true, content: 'SYNTHETIC refusal' }] } },
    // A tool result typed as an error is a failed Read, whatever typed range rides beside it.
    use('r7', 'Read', { file_path: FILE }),
    { ...typed('r7', { filePath: FILE, content: 'SYNTHETIC_FILE_TEXT', startLine: 1, numLines: 423, totalLines: 423 }),
      message: { role: 'user', content: [{ tool_use_id: 'r7', type: 'tool_result', is_error: true,
        content: 'SYNTHETIC_FILE_TEXT' }] } },
    ...base.slice(at)];
  const fake = await fakeClaude(t, { events });
  const answer = await judgeOf(fake)(request);
  assert.deepEqual(answer.agentRun.readRanges, [{ path: FILE, startLine: 125, numLines: 80, totalLines: 423 }]);
  assert.equal(answer.agentRun.toolCalls.Read, 7);
  assert.equal(answer.agentRun.readsUnranged, 3, 'a shared result and a malformed one have no range');
  // The paths those Reads asked for are kept, each once, so no reader calls a file read this way unseen.
  assert.deepEqual(answer.agentRun.readsUnrangedPaths, [FILE]);
  // A Read that failed read nothing: apart, by its path and its closed reason, never ranged or unranged.
  assert.deepEqual(answer.agentRun.readsFailed, [{ path: join(root, 'missing.js'), reason: 'failed' },
    { path: HOSTS, reason: 'refused' }, { path: FILE, reason: 'failed' }]);
  assert.deepEqual(agentRunRecord(answer.agentRun).readsFailed, answer.agentRun.readsFailed, 'the store keeps them');
  assert.doesNotMatch(JSON.stringify(answer.agentRun), /SYNTHETIC_FILE_TEXT|SYNTHETIC refusal|does not exist/,
    'no text of a file or of a failure is kept');
});

test('agent transport: the same stream on a session request fails model_tool_use, as any tool use does', async (t) => {
  const { root, request } = await repository(t);
  const fake = await fakeClaude(t, { events: agentEvents(root) });
  const { agent, ...session } = request;
  const reported = [];
  await assert.rejects(judgeOf(fake, { onResult: (m) => reported.push(m) })(session), { code: 'model_tool_use' });
  assert.equal(reported[0].agentRun, undefined, 'a session call reports no agent run');
});

test('agent transport: a tool use of any other name, or of none, fails the agent call model_tool_use', async (t) => {
  const { root, request } = await repository(t);
  for (const tools of [['Read', 'Bash', 'StructuredOutput'], ['Write', 'StructuredOutput'], ['Agent', 'StructuredOutput'],
    [undefined, 'StructuredOutput'], ['read', 'StructuredOutput']]) {
    const fake = await fakeClaude(t, { events: agentEvents(root, { tools }) });
    await assert.rejects(judgeOf(fake)(request), { code: 'model_tool_use' }, String(tools));
  }
  // Grep and Glob are the agent working too.
  const fake = await fakeClaude(t, { events: agentEvents(root, { tools: ['Glob', 'Grep', 'Read', 'Read', 'StructuredOutput'] }) });
  const answer = await judgeOf(fake)(request);
  assert.deepEqual(answer.agentRun.toolCalls, { Read: 2, Grep: 1, Glob: 1, StructuredOutput: 1 });
  assert.deepEqual(answer.agentRun.reads, [join(root, 'a.js')], 'each path read is listed once');
});

test('agent transport: with no structured_output object, the result text is read as any reply is', async (t) => {
  const { root, request } = await repository(t);
  for (const structured of [undefined, null, ['exports'], 'text']) {
    const fake = await fakeClaude(t, { events: agentEvents(root, { result: { structured_output: structured,
      result: `Here it is:\n\`\`\`json\n${JSON.stringify({ exports: ['b'] })}\n\`\`\`` } }) });
    assert.deepEqual(await judgeOf(fake)(request), { exports: ['b'] }, String(structured));
  }
  const unreadable = await fakeClaude(t, { events: agentEvents(root, { result: { structured_output: undefined,
    result: 'I could not answer.' } }) });
  await assert.rejects(judgeOf(unreadable)(request), { code: 'model_response_invalid' });
});

test('agent transport: an agent reply that could not be read is not retried by the transport (its caller\'s re-ask '
  + 'is the one retry); a session reply is retried once, as before', async (t) => {
  const { root, request } = await repository(t);
  const unreadable = { events: agentEvents(root, { result: { structured_output: undefined, result: 'I could not answer.' } }) };
  const agentFake = await fakeClaude(t, unreadable);
  await assert.rejects(withTransportRetry(judgeOf(agentFake))(request), { code: 'model_response_invalid' });
  assert.equal((await agentFake.calls()).length, 1, 'one call: the code step\'s repair or re-ask asks again, once');
  assert.ok(RETRYABLE_JUDGE_CODES.includes('model_response_invalid'), 'still retryable for a session request');
  const { agent, schema, ...session } = request;
  const sessionFake = await fakeClaude(t, { events: agentEvents(root, { tools: [], result: { structured_output: undefined,
    result: 'I could not answer.' } }) });
  await assert.rejects(withTransportRetry(judgeOf(sessionFake))(session), { code: 'model_response_invalid' });
  assert.equal((await sessionFake.calls()).length, 2, 'a session request keeps its one transport retry');
});

test('agent transport: error_max_turns is model_turn_limit and error_max_structured_output_retries is '
  + 'model_structured_output_failed; neither is retried', async (t) => {
  const { root, request } = await repository(t);
  assert.deepEqual(JSON.parse(JSON.stringify(AGENT_RESULT_FAILURES)), {
    error_max_turns: { code: 'model_turn_limit', transportClass: 'turn_limit' },
    error_max_structured_output_retries: { code: 'model_structured_output_failed', transportClass: 'structured_output_failed' } });
  // As the CLI prints a stopped run (2.1.296, a live turn-limit run): is_error, no result text, exit 1.
  const stopped = (subtype, tools = ['Read']) => agentEvents(root, { tools, result: { subtype, is_error: true,
    terminal_reason: 'max_turns', errors: ['synthetic'], result: undefined, structured_output: undefined } });
  for (const [subtype, { code, transportClass }] of Object.entries(AGENT_RESULT_FAILURES)) {
    const fake = await fakeClaude(t, { exit: 1, events: stopped(subtype) });
    const reported = [];
    const error = await withTransportRetry(judgeOf(fake, { onResult: (m) => reported.push(m) }))(request).then(
      () => assert.fail('a stopped run never answers'), (e) => e);
    assert.equal(error.code, code);
    assert.equal(error.transportClass, transportClass, 'its class, beside its code');
    assert.ok(TRANSPORT_SHORTFALL.includes(transportClass), 'a member of the closed class list');
    assert.equal(reported[0].transportClass, transportClass, 'the recorded result carries the class too');
    assert.equal(error.agentRun.numTurns, 2, 'what the agent did rides on its failure too');
    assert.equal((await fake.calls()).length, 1, `${code} was asked again`);
    assert.equal(reported.length, 1);
    assert.ok(JUDGE_FAILURE_CODES.includes(code));
    assert.ok(!RETRYABLE_JUDGE_CODES.includes(code));
  }
  // Without the mapping the same run read model_unavailable, which is retried: the session transport's rule is unchanged.
  const fake = await fakeClaude(t, { exit: 1, events: agentEvents(root, { tools: [], result: { subtype: 'error_during_execution',
    is_error: true, result: undefined, structured_output: undefined } }) });
  await assert.rejects(withTransportRetry(judgeOf(fake))(request), { code: 'model_unavailable' });
  assert.equal((await fake.calls()).length, 2);
  // A session call has no turn budget or schema of its own, so it never reads those subtypes: as before, unavailable.
  const { agent, ...session } = request;
  for (const subtype of Object.keys(AGENT_RESULT_FAILURES)) {
    const sessionFake = await fakeClaude(t, { exit: 1, events: stopped(subtype, []) });
    await assert.rejects(withTransportRetry(judgeOf(sessionFake))(session), { code: 'model_unavailable',
      transportClass: 'exit_nonzero' }, subtype);
    assert.equal((await sessionFake.calls()).length, 2, `${subtype} on a session call is retried as before`);
  }
});

/** An in-process child for timing and output-size tests: `emit(child)` writes its stdout; kill closes it. */
function inProcessSpawn(emit, spawned = []) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => setImmediate(() => child.emit('close', null));
    spawned.push({ args, options });
    child.stdin.on('finish', () => setImmediate(() => emit(child)));
    return child;
  };
}

test('agent transport: agent.timeoutMs replaces the judge\'s timeout, and an agent call that times out is not retried',
async (t) => {
  const { request } = await repository(t);
  const spawned = [];
  const silent = inProcessSpawn(() => {}, spawned);
  const judge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: { HOME: '/synthetic', PATH: '/bin' },
    timeoutMs: 20_000, spawnProcess: silent });
  const started = Date.now();
  await assert.rejects(withTransportRetry(judge)({ ...request, agent: { ...request.agent, timeoutMs: 40 } }),
    { code: 'model_timeout' });
  assert.ok(Date.now() - started < 10_000, 'the agent\'s own timeout fired, not the judge\'s');
  assert.equal(spawned.length, 1, 'one stuck agent is not asked again');
  // A session request that times out is retried once, as before.
  const sessionSpawned = [];
  const sessionJudge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL },
    env: { HOME: '/synthetic', PATH: '/bin' }, timeoutMs: 40, spawnProcess: inProcessSpawn(() => {}, sessionSpawned) });
  await assert.rejects(withTransportRetry(sessionJudge)({ system: SYSTEM, prompt: PROMPT }), { code: 'model_timeout' });
  assert.equal(sessionSpawned.length, 2);
});

test('agent transport: an agent call may print up to AGENT_MAX_OUTPUT_BYTES; a session call keeps its bound', async (t) => {
  const { root, request } = await repository(t);
  assert.equal(AGENT_MAX_OUTPUT_BYTES, 64 * 1024 * 1024);
  const filler = `${'x'.repeat((1 << 20) - 1)}\n`; // one MiB per line, never an event
  const printing = (mebibytes) => inProcessSpawn((child) => {
    for (let at = 0; at < mebibytes; at++) child.stdout.write(filler);
    child.stdout.write(agentEvents(root).map((event) => JSON.stringify(event)).join('\n'));
    child.emit('close', 0);
  });
  const env = { HOME: '/synthetic', PATH: '/bin' };
  const judge = (spawnProcess) => createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env, spawnProcess });
  // 17 MiB: over the session bound (16 MiB), under the agent's.
  assert.deepEqual(await judge(printing(17))(request), ANSWER);
  await assert.rejects(judge(printing(17))({ system: SYSTEM, prompt: PROMPT }), { code: 'model_output_limit' });
  await assert.rejects(judge(printing(65))(request), { code: 'model_output_limit' });
});

// ---- what is refused before anything starts ----------------------------------------------------------------------
test('agent transport: an agent request is refused invalid_model_input on codex-cli and anthropic-api, malformed, with '
  + 'images, or outside an existing directory, before anything starts', async (t) => {
  const { top, root, request } = await repository(t);
  const started = [], reported = [];
  const never = (...args) => { started.push(args); throw new Error('must not start'); };
  const judge = (config) => createReviewJudge({ config, env: { HOME: '/synthetic', PATH: '/bin', ANTHROPIC_API_KEY: 'x' },
    spawnProcess: never, fetchImpl: never, onResult: (m) => reported.push(m) });
  for (const config of [{ backend: 'codex-cli', model: 'gpt-synthetic-1' }, { backend: 'anthropic-api', model: MODEL }])
    await assert.rejects(judge(config)(request), { code: 'invalid_model_input' }, config.backend);
  const claude = judge({ backend: 'claude-cli', model: MODEL });
  const file = join(root, 'a.js');
  const malformed = [{ agent: null }, { agent: 'root' }, { agent: { ...request.agent, root: 'pkg' } },
    { agent: { ...request.agent, root: undefined } }, { agent: { ...request.agent, maxTurns: 0 } },
    { agent: { ...request.agent, maxTurns: 1.5 } }, { agent: { ...request.agent, maxTurns: '40' } },
    { agent: { ...request.agent, timeoutMs: 0 } }, { agent: { ...request.agent, timeoutMs: 2 ** 31 } },
    { agent: { ...request.agent, addDirs: top } }, { agent: { ...request.agent, addDirs: ['relative'] } },
    { agent: { ...request.agent, budgetUsd: 1 } }, { schema: undefined }, { schema: [] }, { schema: 'object' },
    { agent: { ...request.agent, root: join(top, 'absent') } }, { agent: { ...request.agent, root: file } },
    { agent: { ...request.agent, addDirs: [join(top, 'absent')] } },
    { images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }];
  for (const change of malformed)
    await assert.rejects(claude({ ...request, ...change }), { code: 'invalid_model_input' }, JSON.stringify(change));
  assert.deepEqual(started, []);
  assert.deepEqual(reported, [], 'a refused request reaches no onResult: nothing was sent');
  assert.equal(isAgentRequest({ ...request, agent: null }), true, 'a malformed agent is still an agent request');
  assert.equal(isAgentRequest({ system: SYSTEM, prompt: PROMPT }), false);
  assert.equal(reviewTransportArguments({ backend: 'codex-cli', model: 'gpt-synthetic-1', system: SYSTEM,
    agent: agentRequestOf(request), schema: SCHEMA }), null, 'no other backend has an agent transport');
});
