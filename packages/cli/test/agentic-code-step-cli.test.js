// The agentic code step end to end, through the installed command's own path: `sonah review` (packages/cli/bin) runs
// the session review and the code step through the real claude-cli transport, against a fake `claude` on a temporary
// PATH that prints real-shaped streams — the session review's tool-free answers, and, for the review agent and each
// checking agent, an init event, a Read and its result, the StructuredOutput tool use and its result, and a result
// event holding `structured_output`. A small real git repository holds the change a synthetic recording made. Every
// byte is synthetic; no model, no network; each run gets its own temporary HOME and Sonah home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { session, toJsonl } from '../../golden/src/build.js';

const run = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const START = '2030-01-01T00:00:00.000Z';
const BASE_PARSE = 'export function parse(input) {\n  const parts = input.split(";");\n  return parts.map((part) => part.trim());\n}\n';
const PARSE_LINE = '  const parts = input.split(",");';
const PARSE = BASE_PARSE.replace('  const parts = input.split(";");', PARSE_LINE);
const TITLE = 'SYNTHETIC parse("") returns [""] instead of []';

/**
 * The fake `claude`. A tool-free request (the session review) gets an empty review in the answer's text; an agent
 * request (`--tools Read,Grep,Glob` with `--json-schema`) is answered by the schema it carries: the review agent finds
 * one bug on parse.js line 2 and one statement that holds on line 1; a finding's checking agent upholds the finding it
 * is shown, quoting its trace (its one premise a line of the repository, D110); the batch checking agent upholds every statement. Each call is logged by kind.
 */
const FAKE = (log, { initServed = false, window = 1000000 } = {}) => `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') { console.log('2.1.296 (Claude Code)'); process.exit(0); }
const valueOf = (flag) => args[args.indexOf(flag) + 1];
const model = valueOf('--model');
const served = String(model).replace('[1m]', '');
// D162: Claude Code 2.1.278's shape names the model value as configured in the init and keys the usage by it; 2.1.311's
// names the served id in both (\`initServed\`).
const named = ${initServed} ? served : model, version = ${initServed} ? '2.1.311' : '2.1.296';
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
const usage = { [named]: { contextWindow: ${window}, maxOutputTokens: 128000, inputTokens: 2, outputTokens: 4 } };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const agent = valueOf('--tools') === 'Read,Grep,Glob';
  if (!agent) {
    fs.appendFileSync(${JSON.stringify(log)}, 'session\\n');
    const review = JSON.stringify({ decisions: [], pivots: [], claims: [], requirements: [], failures: [], notClaims: [],
      forbiddenEdits: [] });
    emit({ type: 'system', subtype: 'init', model: named, claude_code_version: version });
    emit({ type: 'assistant', parent_tool_use_id: null, message: { model: served, role: 'assistant',
      content: [{ type: 'text', text: review }] } });
    emit({ type: 'result', subtype: 'success', is_error: false, result: review, modelUsage: usage });
    return;
  }
  const required = JSON.parse(valueOf('--json-schema')).required;
  const step = { step: 'An empty string splits into one empty part.', path: 'src/parse.js', side: 'new', startLine: 2,
    endLine: 2, quote: ${JSON.stringify(PARSE_LINE.trim())} };
  let kind, answer;
  if (required.includes('findings') && !required.includes('entries')) {
    kind = 'review';
    answer = { findings: [{ kind: 'bug', lens: 'behaviour', title: ${JSON.stringify(TITLE)},
      claims: ['Empty input splits into one empty part.'], input: 'parse("")', trace: [step],
      anchor: { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2 }, leadsFrom: [] }],
    // One question, about the one ask (S1, the row code adds for a message no review row names), quoting the words its
    // dossier line shows.
    questions: [{ question: 'SYNTHETIC should a trailing comma give an empty last part?', key: 'S1',
      quote: 'named no ask from this message' }] };
  } else if (required.includes('verdict')) {
    kind = 'verify';
    const shown = JSON.parse(input.split('# The finding to check — untrusted\\n\\n')[1].split('\\n')[0]);
    // D110 (code-verify/3): its one premise, a line of the repository that the trace quotes.
    const receipts = shown.trace.filter((t) => t.side !== 'session').map(({ path, side, startLine, endLine, quote }) => ({
      path, side, startLine, endLine, quote }));
    // D152 (code-verify/5): what the behaviour breaks, the traced line, so that the finding is tied and published.
    answer = { verdict: 'holds', reason: null, claims: shown.claims.map(({ claim }) => ({ claim, verdict: 'holds' })),
      premises: [{ premise: 'SYNTHETIC: the traced line shows it.', source: 'repository', receipts }],
      breaks: receipts.slice(0, 1), receipts, explanation: 'SYNTHETIC: traced and found to hold.' };
  } else if (required.includes('entries')) {
    // F3b (D111): an accounting agent: every item it was shown holds, quoting the changed line.
    kind = 'account';
    const items = input.split('# The items to account for — built by Sonah from its report — untrusted evidence\\n\\n')[1]
      .split('\\n\\n')[0].split('\\n').filter((line) => line.startsWith('{"key":"S')).map((line) => JSON.parse(line).key);
    const receipt = { path: step.path, side: step.side, startLine: step.startLine, endLine: step.endLine, quote: step.quote };
    answer = { entries: items.map((key) => ({ key, outcome: 'holds', receipts: [receipt], by: null, finding: null })),
      findings: [] };
  } else {
    kind = 'batch';
    const keys = input.split('\\n').filter((line) => /^\\{"key":"Q\\d+"/.test(line)).map((line) => JSON.parse(line).key);
    answer = { questions: keys.map((key) => ({ key, verdict: 'sound', receipts: [], explanation: 'SYNTHETIC.' })) };
  }
  fs.appendFileSync(${JSON.stringify(log)}, kind + '\\n');
  const read = 'toolu_synthetic_read', out = 'toolu_synthetic_out';
  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), model: named, permissionMode: 'dontAsk',
    tools: ['Glob', 'Grep', 'Read', 'StructuredOutput'], mcp_servers: [], claude_code_version: version });
  emit({ type: 'assistant', parent_tool_use_id: null, message: { model: served, role: 'assistant',
    content: [{ type: 'tool_use', id: read, name: 'Read', input: { file_path: path.join(process.cwd(), 'src', 'parse.js') } }] } });
  emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: read,
    type: 'tool_result', content: '1\\texport function parse(input) {' }] } });
  emit({ type: 'assistant', parent_tool_use_id: null, message: { model: served, role: 'assistant',
    content: [{ type: 'tool_use', id: out, name: 'StructuredOutput', input: answer }] } });
  emit({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ tool_use_id: out,
    type: 'tool_result', content: 'Structured output provided successfully' }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, duration_ms: 1000, duration_api_ms: 900,
    stop_reason: 'tool_use', terminal_reason: 'completed', result: JSON.stringify(answer), structured_output: answer,
    usage: { input_tokens: 4, output_tokens: 60 }, modelUsage: usage });
});
`;

/** A git repository whose base commit (dated before the session) holds the old parse.js, with the session's edit in the
 *  working tree; and the recording of that session, its rows dated when it began. */
async function project(t, fake = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah agentic cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
    GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
  const files = { 'src/parse.js': BASE_PARSE, 'src/util.js': 'export const SEPARATOR = ",";\n', 'README.md': '# readme\n' };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(repo, path)), { recursive: true });
    await writeFile(join(repo, path), text);
  }
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: repo, env, stdio: 'pipe' });
  await writeFile(join(repo, 'src', 'parse.js'), PARSE);
  const rows = session({ cwd: repo, sessionId: 'sess-agentic-cli', version: '2.1.296' })
    .ask('SYNTHETIC_ASK: make parse split on commas.')
    .edit('src/parse.js', 'input.split(";")', 'input.split(",")')
    .say('SYNTHETIC: parse now splits on commas.').done().map((row) => ({ ...row, timestamp: START }));
  const recording = join(dir, 'recording.jsonl');
  await writeFile(recording, `${toJsonl(rows)}\n`);
  const home = join(dir, 'home'), bin = join(dir, 'bin'), log = join(dir, 'calls.log');
  await mkdir(home); await mkdir(bin);
  await writeFile(join(bin, 'claude'), FAKE(log, fake), { mode: 0o700 });
  const runEnv = { HOME: home, SONAH_HOME: join(dir, 'sonah-home'), CODEX_HOME: join(dir, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(dir, 'claude-projects'), PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', SONAH_NO_UPDATE_CHECK: '1' };
  return { dir, repo, recording, env: runEnv, log };
}

/** `sonah review` as a person runs it, from the repository; resolves `{ code, out, err }` (a nonzero exit included). */
const review = (p, args) => run(process.execPath, [BIN, 'review', p.recording, ...args], { cwd: p.repo, env: p.env,
  maxBuffer: 16 * 1024 * 1024 }).then(({ stdout, stderr }) => ({ code: 0, out: stdout, err: stderr }),
  (error) => ({ code: error.code, out: error.stdout, err: error.stderr }));
const calls = async (p) => (await readFile(p.log, 'utf8').catch(() => '')).split('\n').filter(Boolean);

test('agentic code step end to end: the review agent and its checking agents through the claude-cli transport; a rerun asks nothing; a changed file asks the code step again', { timeout: 120_000 }, async (t) => {
  const p = await project(t);
  const state = join(p.dir, 'state');
  const page = (n) => join(p.dir, `review-${n}.html`);
  const first = await review(p, ['--code-pass', '--state-dir', state, '--format', 'html', '--output', page(1), '--no-open']);
  assert.equal(first.code, 0, `${first.out}\n${first.err}`);
  const asked = await calls(p);
  // The session review's own requests, then the review agent, then — side by side — one checking agent for its one
  // finding, the batch checking agent for its one question and (F3b, D111) one accounting agent for its one ask.
  const agents = (kinds) => { const [first, ...rest] = kinds; return [first, ...rest.sort()]; };
  assert.ok(asked.includes('session'));
  assert.deepEqual(agents(asked.filter((kind) => kind !== 'session')), ['review', 'account', 'batch', 'verify']);
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  assert.deepEqual(report.codePass.findings.map((f) => [f.title, f.anchor.path, f.check.verdict]),
    [[TITLE, 'src/parse.js', 'holds']]);
  assert.deepEqual(report.codePass.questions.map((q) => [q.question, q.check?.verdict]),
    [['SYNTHETIC should a trailing comma give an empty last part?', 'sound']]);
  assert.equal(Object.hasOwn(report.codePass, 'held'), false);
  assert.deepEqual([report.codePass.coverage, report.codePass.footer], ['complete', []]);
  const written = await readFile(page(1), 'utf8');
  // Page /37: the finding is an item of the page, in the code review's words.
  const found = `<em class="by-code-review">${TITLE.replace(/"/g, '&quot;')}</em>`;
  assert.ok(written.includes(found), 'the page shows the finding');
  assert.ok(written.includes(`<code>${PARSE_LINE.trim().replace(/"/g, '&quot;')}</code>`), 'with the line it quotes');

  // The same state folder and the same repository: every answer, the agents' included, is reused; nothing is asked.
  const second = await review(p, ['--code-pass', '--state-dir', state, '--format', 'html', '--output', page(2), '--no-open']);
  assert.equal(second.code, 0, `${second.out}\n${second.err}`);
  assert.deepEqual(await calls(p), asked, 'no call');
  assert.match(second.out, /^Model answers: (\d+) of \1 reused \(no call\)\.$/m);
  assert.ok((await readFile(page(2), 'utf8')).includes(found), 'the page shows the finding again');

  // A file of the repository changed since: the session part is still answered from the store, and the code step asks
  // its review agent and its checking agents again.
  await writeFile(join(p.repo, 'src', 'util.js'), 'export const SEPARATOR = ";";\n');
  const third = await review(p, ['--code-pass', '--state-dir', state, '--format', 'html', '--output', page(3), '--no-open']);
  assert.equal(third.code, 0, `${third.out}\n${third.err}`);
  assert.deepEqual(agents((await calls(p)).slice(asked.length)), ['review', 'account', 'batch', 'verify']);
});

test('D162: Claude Code 2.1.311\'s stream — no selector in the init, the usage keyed by the served id — is admitted for the session review and the code step\'s agents under the 1M window; a rerun asks nothing; under another window the review stops at its first call', { timeout: 120_000 }, async (t) => {
  const p = await project(t, { initServed: true });
  const state = join(p.dir, 'state');
  const page = (n) => join(p.dir, `review-${n}.html`);
  const first = await review(p, ['--code-pass', '--state-dir', state, '--format', 'html', '--output', page(1), '--no-open']);
  assert.equal(first.code, 0, `${first.out}\n${first.err}`);
  const asked = await calls(p);
  const agents = (kinds) => { const [head, ...rest] = kinds; return [head, ...rest.sort()]; };
  assert.ok(asked.includes('session'));
  assert.deepEqual(agents(asked.filter((kind) => kind !== 'session')), ['review', 'account', 'batch', 'verify']);
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  assert.deepEqual(report.codePass.findings.map((f) => [f.title, f.check.verdict]), [[TITLE, 'holds']]);
  assert.equal(report.codePass.coverage, 'complete');
  // The answers stored under this shape replay as any stored answer does: nothing is asked.
  const second = await review(p, ['--code-pass', '--state-dir', state, '--format', 'html', '--output', page(2), '--no-open']);
  assert.equal(second.code, 0, `${second.out}\n${second.err}`);
  assert.deepEqual(await calls(p), asked, 'no call');

  // The same shape under the CLI's 200,000-token window: the first answer is not attested, so the review admits nothing
  // and stops there, and no answer is stored.
  const q = await project(t, { initServed: true, window: 200000 });
  const refusedState = join(q.dir, 'state');
  const refused = await review(q, ['--code-pass', '--state-dir', refusedState, '--format', 'html', '--output',
    join(q.dir, 'review.html'), '--no-open']);
  assert.equal(refused.code, 3, `${refused.out}\n${refused.err}`);
  assert.match(refused.err, /model_unavailable/);
  assert.deepEqual(await calls(q), ['session'], 'one call, then nothing');
  assert.deepEqual(await readdir(join(refusedState, 'answers')).catch(() => []), [], 'no answer is stored');
});
