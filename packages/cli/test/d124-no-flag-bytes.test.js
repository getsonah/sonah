// D124 (the --code-repo option): without the flag, every request byte and every report byte are as before it. Three
// shapes run through the CLI with no --code-repo: a session in a git repository with a recorded write (the ordinary
// case); a session that wrote in its own repository and in a sibling one (D117's place, with D113's window there); and
// the smoke's S1 shape (a session that started in a folder of no repository and changed a repository only through a
// script). Every request the reviewer is sent (its label, system text, prompt and the agent's folders) and every report
// byte (the .md and the page) is digested, with the throwaway folders' paths named by role, and each digest is the one
// the tree before D124 gives (commit f731f368, this file run there unchanged). The one move by design: the S1 shape's
// reason (`no_seen_write`) now ends with the way out, `--code-repo`, which is taken out before its report is digested.
// A later change that moves these bytes on purpose records the new digests here with the decision that moved them.
//
// Throwaway folders and repositories, synthetic sessions, a deterministic fake reviewer: no recording, no model, no
// network. Every commit date and every file time that a rule reads is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { readCodeSnapshot } from '../src/code-snapshot.js';
import { renderSessionPage } from '../../render/session-page.js';
import { CODE_TEXT, CODE_FILES, buildCodeSession, codeJudge, codeSession, sha256 } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z';
const END = '2030-01-02T00:00:00.000Z';
const DURING = new Date('2030-01-01T12:00:00.000Z');
const T1 = { turn: 'T1' };
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const NO_ROWS = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const digest = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);
/** The options `readCode` was given before D124, by name. */
const READ_CODE_OPTIONS = ['harnessHomes', 'maxBytes', 'own', 'recording', 'root'];

async function folder(t, name) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), `sonah-d124b-${name}-`)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function put(root, files, time = null) {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
    if (time) await utimes(join(root, path), time, time);
  }
}
async function repository(root, base, after = {}) {
  await put(root, base);
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: root, env: GIT_ENV, stdio: 'pipe' });
  await put(root, after, DURING);
}
async function recordingIn(base) {
  const recording = join(base, 'recording.jsonl');
  await writeFile(recording, `${JSON.stringify({ timestamp: START })}\n${JSON.stringify({ timestamp: END })}\n`);
  return recording;
}

/** The three shapes: each `{ base, recorded, recording, session }`, every path under `base`. */
const SHAPES = {
  // A session in a git repository that wrote src/parse.js (as recorded), beside a file changed while it ran.
  ordinary: async (t) => {
    const base = await folder(t, 'ord');
    const root = join(base, 'work');
    await repository(root, { ...CODE_FILES, 'src/parse.js': 'export function parse() {}\n' },
      { 'src/parse.js': CODE_FILES['src/parse.js'], 'src/gen.js': 'export const gen = 1;\n' });
    return { base, recorded: root, recording: await recordingIn(base), session: codeSession() };
  },
  // D117: a recorded write in the working repository and one in a sibling repository, whose other file changed while
  // the session ran.
  sibling: async (t) => {
    const base = await folder(t, 'sib');
    const root = join(base, 'work'), lib = join(base, 'lib');
    await repository(root, { ...CODE_FILES, 'src/parse.js': 'export function parse() {}\n' },
      { 'src/parse.js': CODE_FILES['src/parse.js'] });
    await repository(lib, { 'src/text.js': 'export const a = 1;\n', 'src/other.js': 'export const b = 1;\n' },
      { 'src/text.js': 'export const a = 2;\n', 'src/other.js': 'export const b = 2;\n' });
    return { base, recorded: root, recording: await recordingIn(base),
      session: codeSession({ writes: [{ path: join(lib, 'src/text.js'), text: 'export const a = 2;\n' }] }) };
  },
  // The smoke's S1 shape: a scratch folder of no repository beside `app`, changed only through a script.
  script: async (t) => {
    const base = await folder(t, 'scr');
    const sandbox = join(base, 'sandbox'), app = join(base, 'app');
    await put(sandbox, { 'scratch-notes.txt': 'notes\n' });
    await repository(app, { 'src/money.js': 'export const cents = 1;\n' }, { 'src/money.js': 'export const cents = 2;\n' });
    const cmd = `python3 - <<'EOF'\nbase='${app}/'\nopen(base+'src/money.js','w').write(src)\nEOF`;
    const session = buildCodeSession('s-d124b-script', { ...CODE_TEXT, cmd }, [
      { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
      { id: 'B1', kind: 'invocation', callKey: 'B1', tool: 'Bash', operation: 'command', paths: [],
        command: [{ sourceKey: 'cmd', fromByte: 0, untilByte: Buffer.byteLength(cmd) }], input: [], changes: [], ...T1 },
      { id: 'B1-r', kind: 'observation', invocation: 'B1', blob: 'wrote', ...T1 },
      { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
    return { base, recorded: sandbox, recording: await recordingIn(base), session };
  },
};

/** One review with no --code-repo, from the session's working directory: the digests of its requests and report. */
async function digestsOf(t, shape) {
  const { base, recorded, recording, session } = await SHAPES[shape](t);
  const run = await folder(t, 'run');
  const calls = [], read = [];
  const output = join(run, 'story.html');
  const state = join(run, 'state');
  const answer = codeJudge({ narrative: NO_ROWS, review: () => ({ findings: [], questions: [] }) });
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'html',
    '--output', output, '--no-open', '--code-pass'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: recorded,
    env: { HOME: join(run, 'home'), SONAH_HOME: join(run, '.sonah'), CODEX_HOME: join(run, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(run, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: recorded }),
    readCode: async (...args) => { read.push(args); return readCodeSnapshot(...args); },
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return answer(request);
    } });
  assert.equal(code, 0, shape);
  // The throwaway folders by role (as written, and as the .md escapes them), so the digests hold on any machine.
  const escaped = (path) => path.replace(/[\\`*_[\]|]/g, '\\$&');
  const named = (text) => text.split(run).join('<run>').split(base).join('<base>').split(escaped(run)).join('<run>')
    .split(escaped(base)).join('<base>');
  // The one move by design (D124): the S1 shape's reason ends with the way out.
  const before = (text) => text.replace(/\. To review that code, run sonah review again with --code-repo (?:&lt;|<)the (?:repository's|repository&#39;s) folder(?:&gt;|>)/g, '');
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  const requests = calls.map((r) => JSON.stringify([r.label ?? null, r.system ?? null, r.prompt ?? null,
    r.agent ? [r.agent.root, r.agent.addDirs] : null]));
  return { read: read.map(([, options]) => Object.keys(options).sort()),
    given: [JSON.stringify(report), ...requests].some((text) => text.includes('"given"')),
    requests: digest(named(requests.join('\n'))),
    md: digest(named(before(await readFile(join(run, 'story.md'), 'utf8')))),
    page: digest(named(before(renderSessionPage(session, report, { folder: recorded })))),
    labels: calls.map((r) => r.label ?? null) };
}

test('D124: without --code-repo, the requests and the report of each shape are byte for byte those of the tree before '
  + 'it', async (t) => {
  const got = {};
  for (const shape of Object.keys(SHAPES)) got[shape] = await digestsOf(t, shape);
  for (const [shape, { read, given }] of Object.entries(got)) {
    assert.deepEqual(read, [READ_CODE_OPTIONS], `${shape}: readCode is given what it was before`);
    assert.equal(given, false, `${shape}: no place is marked as given`);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([shape, { requests, md, page, labels }]) =>
    [shape, { requests, md, page, labels }])), {
    ordinary: { requests: '3c472f0b2f284287', md: 'a09fe0c69d03cc64', page: 'a02f1faa4ffc40c8',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    sibling: { requests: '1d3c67aaf360cf88', md: 'b1812c72b1ab876d', page: 'c343233d8e955682',
      labels: ['narrative:w1', 'code-review:agent', 'code-account:1'] },
    script: { requests: 'afe064acbf3c9007', md: 'ca1b2f9c65a8b4d6', page: '24575f4cfcd62511', labels: ['narrative:w1'] },
  });
});
