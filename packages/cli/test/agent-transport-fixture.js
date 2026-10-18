// Shared by the agent transport's tests (agent-transport.test.js, agent-answer-key.test.js): a synthetic repository, a
// fake `claude` executable on a temporary PATH, and a real-shaped agent stream. Every byte is synthetic, and every test
// gets its own temporary HOME: no real ~/.claude or ~/.sonah is read.
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createReviewJudge } from '../src/review-judge.js';

export const MODEL = 'claude-synthetic-5-5';
export const SYSTEM = 'SYNTHETIC_AGENT_SYSTEM: review the change with your tools.';
export const PROMPT = 'SYNTHETIC_AGENT_PROMPT: what does a.js export?';
export const SCHEMA = Object.freeze({ type: 'object', additionalProperties: false, required: ['exports'],
  properties: { exports: { type: 'array', items: { type: 'string' } } } });
export const ANSWER = Object.freeze({ exports: ['a'] });
export const STATE = 'a'.repeat(64), OTHER_STATE = 'b'.repeat(64);

export async function scratch(t, name) {
  // A space in every path: a checkout may live under one.
  const dir = await mkdtemp(join(tmpdir(), `sonah agent ${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A synthetic repository with a nested working directory, and a request whose agent runs there. */
export async function repository(t) {
  const top = await scratch(t, 'repo');
  const root = join(top, 'pkg');
  await mkdir(root);
  await writeFile(join(root, 'a.js'), 'export const a = 1;\n');
  return { top, root, request: { label: 'code-review:agent', system: SYSTEM, prompt: PROMPT, schema: SCHEMA,
    agent: { root, addDirs: [top], maxTurns: 40 } } };
}

/**
 * A fake `claude` on a temporary PATH. It logs each call (argv, working directory, environment, stdin) to
 * HOME/calls.jsonl and prints the events of HOME/scenario.json, then exits with its `exit` code. The judge passes HOME
 * and PATH through (review-judge.js `localEnvironment`), so the fake finds both.
 */
export async function fakeClaude(t, scenario) {
  const home = await scratch(t, 'home'), bin = join(home, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'claude'), `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const home = process.env.HOME;
const scenario = JSON.parse(fs.readFileSync(path.join(home, 'scenario.json'), 'utf8'));
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  fs.appendFileSync(path.join(home, 'calls.jsonl'), JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(),
    env: process.env, stdin: input }) + '\\n');
  for (const event of scenario.events) process.stdout.write(JSON.stringify(event) + '\\n');
  process.exitCode = scenario.exit ?? 0;
});
`, { mode: 0o700 });
  const setScenario = (value) => writeFile(join(home, 'scenario.json'), JSON.stringify(value));
  await setScenario(scenario);
  const calls = async () => (await readFile(join(home, 'calls.jsonl'), 'utf8').catch(() => '')).split('\n')
    .filter(Boolean).map((line) => JSON.parse(line));
  const env = { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, USER: 'synthetic-user',
    LOGNAME: 'synthetic-user', SHELL: '/bin/sh', ANTHROPIC_API_KEY: 'SYNTHETIC_KEY_NEVER_PASSED',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '7' };
  return { home, env, calls, setScenario };
}

/** A real-shaped agent stream, as Claude Code 2.1.296 prints it with --json-schema: init, a thinking block, a Read,
 *  its result, the StructuredOutput tool use and its result, then the result event holding `structured_output`. */
export function agentEvents(root, { answer = ANSWER, tools = ['Read', 'StructuredOutput'], result = {} } = {}) {
  const assistant = (content) => ({ type: 'assistant', parent_tool_use_id: null,
    message: { model: MODEL, role: 'assistant', content } });
  // Claude Code 2.1.296 prints a Read's typed result beside its tool result (`tool_use_result.file`): what the agent
  // transport /2 reads its lines from.
  const toolResult = (id, content, typed = undefined) => ({ type: 'user', parent_tool_use_id: null,
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content }] },
    ...(typed ? { tool_use_result: typed } : {}) });
  const events = [{ type: 'system', subtype: 'init', cwd: root, model: MODEL, permissionMode: 'dontAsk',
    tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'], mcp_servers: [], claude_code_version: '2.1.296' },
  assistant([{ type: 'thinking', thinking: '' }])];
  tools.forEach((name, at) => {
    const id = `toolu_synthetic_${at}`;
    const input = name === 'Read' ? { file_path: join(root, 'a.js') } : name === 'StructuredOutput' ? answer
      : name === undefined ? {} : { pattern: 'export' };
    events.push(assistant([{ type: 'tool_use', id, ...(name === undefined ? {} : { name }), input }]),
      toolResult(id, name === 'StructuredOutput' ? 'Structured output provided successfully' : '1\texport const a = 1;',
        name === 'Read' ? { type: 'text', file: { filePath: join(root, 'a.js'), content: 'export const a = 1;\n',
          numLines: 1, startLine: 1, totalLines: 1 } } : undefined));
  });
  events.push({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: {
    five_hour: { utilization: 0.12 } } } });
  events.push({ type: 'result', subtype: 'success', is_error: false, num_turns: tools.length + 1, duration_ms: 4321,
    duration_api_ms: 4000, total_cost_usd: 0.0125, stop_reason: 'tool_use', terminal_reason: 'completed',
    permission_denials: [{ tool_name: 'Read', tool_use_id: 'toolu_denied', tool_input: { file_path: '/etc/hosts' } }],
    result: JSON.stringify(answer), structured_output: answer,
    usage: { input_tokens: 4, cache_creation_input_tokens: 400, cache_read_input_tokens: 900, output_tokens: 60 },
    modelUsage: { [MODEL]: { contextWindow: 200000, maxOutputTokens: 128000, inputTokens: 4, outputTokens: 60 } },
    ...result });
  return events;
}

export const judgeOf = (fake, extra = {}) => createReviewJudge({ config: { backend: 'claude-cli', model: MODEL }, env: fake.env,
  ...extra });
