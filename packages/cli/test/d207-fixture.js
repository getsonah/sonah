// D207's throwaway repositories and synthetic recordings, by the recorders' own row shapes. No session text, no model, no
// network; every commit date is fixed.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { buildCodeSession, CODE_TEXT, codeJudge, sha256 } from './code-pass-fixture.js';

export const at = (hms, day = 1) => `2030-01-0${day}T${hms}.000Z`;
export const ms = (hms, day = 1) => Date.parse(at(hms, day));

export async function scratch(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d207-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** A git repository: `git(args, when)` runs with the committer's date `when` (ISO), and `put` writes a file, its time set. */
export async function repository(t, files = { 'a.txt': 'one\n', 'b.txt': 'one\n' }) {
  const top = await scratch(t);
  const git = (args, when = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd: top, stdio: 'pipe', env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
    GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  const put = async (path, text, when = null) => {
    await mkdir(dirname(join(top, path)), { recursive: true });
    await writeFile(join(top, path), text);
    if (when !== null) await utimes(join(top, path), when / 1000, when / 1000);
  };
  git(['init', '-q', '-b', 'main']);
  for (const [path, text] of Object.entries(files)) await put(path, text);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'the base']);
  return { top, git, put, base: git(['rev-parse', 'HEAD']).trim() };
}

/** Claude Code's rows. */
const claudeRow = (timestamp, type, content, extra = {}) => JSON.stringify({ cwd: '/repo', version: '2.1.296', uuid: `${type}-${timestamp}-${Math.abs(hash(JSON.stringify(content)))}`,
  ...(timestamp === null ? {} : { timestamp }), type, ...(type === 'user' ? { origin: { kind: 'human' } } : {}), ...extra,
  message: { role: type, content } });
function hash(text) { let n = 0; for (const c of text) n = (n * 31 + c.charCodeAt(0)) | 0; return n; }
export const claude = {
  human: (when, text = 'do it', extra) => claudeRow(when, 'user', text, extra),
  action: (when, command, id = `c-${when}`, extra) => claudeRow(when, 'assistant', [{ type: 'tool_use', id, name: 'Bash', input: { command } }], extra),
  result: (when, text, id, extra) => claudeRow(when, 'user', [{ type: 'tool_result', tool_use_id: id, content: text }], extra),
  thought: (when, text, extra) => claudeRow(when, 'assistant', [{ type: 'text', text }], extra),
  // Text and a call in one row: only the call's block is an action.
  mixed: (when, text, command, id = `c-${when}`) => claudeRow(when, 'assistant', [{ type: 'text', text },
    { type: 'tool_use', id, name: 'Bash', input: { command } }]),
};

/** Codex's rollout rows. */
const codexRow = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });
const item = (when, payload) => codexRow(when, 'response_item', payload);
const THREAD = '00000000-0000-0000-0000-000000000000';
export const ROLLOUT = 'rollout-2030-01-01T10-00-00-00000000-0000-0000-0000-000000000000.jsonl';
export const codex = {
  meta: (when) => codexRow(when, 'session_meta', { id: THREAD, cwd: '/repo', timestamp: when }),
  human: (when, text = 'do it') => item(when, { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }),
  say: (when, text = 'done') => item(when, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }),
  execCommand: (when, cmd, id = `x-${when}`) => item(when, { type: 'function_call', name: 'exec_command', call_id: id, arguments: JSON.stringify({ cmd }) }),
  shell: (when, command, id = `s-${when}`) => item(when, { type: 'function_call', name: 'shell', call_id: id, arguments: JSON.stringify({ command: ['bash', '-lc', command] }) }),
  custom: (when, name, input, id = `u-${when}`) => item(when, { type: 'custom_tool_call', name, call_id: id, input }),
  output: (when, id, text = 'ok') => item(when, { type: 'function_call_output', call_id: id, output: text }),
  customOutput: (when, id, texts) => item(when, { type: 'custom_tool_call_output', call_id: id,
    output: texts.map((text) => ({ type: 'input_text', text })) }),
  ended: (when) => codexRow(when, 'event_msg', { type: 'task_complete' }),
  // The paginated item stream: a recording's own thread, one turn, a native command with no call row.
  turnStarted: (when) => codexRow(when, 'event_msg', { type: 'task_started', turn_id: 't1', model_context_window: 1 }),
  nativeCommand: (when, script) => codexRow(when, 'event_msg', { type: 'item_completed', thread_id: THREAD, turn_id: 't1',
    item: { id: `i-${when}`, type: 'CommandExecution', source: 'agent', command: ['/bin/zsh', '-lc', script],
      cwd: 'file:///repo', status: 'completed', exit_code: 0, aggregated_output: '' } }),
};

/** A recording in a folder of its own. */
export async function recording(t, rows, name = 'session.jsonl') {
  const file = join(await scratch(t), name);
  await writeFile(file, `${rows.join('\n')}\n`);
  return file;
}

/** A session with no recorded write, or one that writes each of `writes` (`[path, blob]`, the blob's text in `blobs`). */
export const sessionOf = (key = 's', writes = [], blobs = {}) => buildCodeSession(key, { ...CODE_TEXT, ...blobs }, [
  { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
  ...writes.flatMap(([path, blob], at) => [{ id: `W${at + 1}`, kind: 'invocation', write: path, blob, turn: 'T1' },
    { id: `W${at + 1}-r`, kind: 'observation', invocation: `W${at + 1}`, blob: 'wrote', turn: 'T1' }]),
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', turn: 'T1' }]);

/** One `sonah review` of a recording whose working directory is `root`, through the command, with a fake reviewer that
 *  proposes nothing: its exit code, every request, the terminal, the error stream, the .md, the record and what the
 *  snapshot was given. No model, no network. */
export async function reviewOf(t, { root, file, session, extra = [] }) {
  const dir = await scratch(t);
  const calls = [], read = [];
  let out = '', err = '';
  const output = join(dir, 'story.md');
  const state = join(dir, 'state');
  const answer = codeJudge({ narrative: () => ({ decisions: [], pivots: [], claims: [], requirements: [] }),
    review: () => ({ findings: [], questions: [] }) });
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', state, '--format', 'md', '--output',
    output, '--no-open', '--code-pass', ...extra], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); },
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return answer(request);
    } });
  const readBack = async (path) => { try { return await readFile(path, 'utf8'); } catch { return null; } };
  const record = await readBack(join(state, 'review', 'report.private.json'));
  return { code, calls, codeCalls: calls.filter((r) => /^code-/.test(r.label ?? '')), out, err, read,
    written: await readBack(output), report: record === null ? null : JSON.parse(record) };
}
