// D192 (D186's way A): from a start folder that no git repository holds, a write after a relative or a `~` `cd` lands
// in the sibling repository that shell grammar puts it in, so the code step reviews that file there (a place, D117)
// where it counted a file that does not exist and said that it could show no changed lines (`none_shown`). A change of
// folder that Sonah does not follow (`pushd`, a subshell) keeps that result. Throwaway repositories in temporary folders,
// a synthetic recording written where Claude Code writes one (so the slicer reads its home), the code-pass fixture's
// deterministic fake judge: no real recording, no model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { reportNotReviewedOf } from '../../evidence/src/code-report.js';
import { codeJudge } from './code-pass-fixture.js';

const START = '2030-01-01T00:00:00.000Z', MID = '2030-01-01T00:00:05.000Z', END = '2030-01-01T00:00:10.000Z';
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
  GIT_AUTHOR_DATE: '2029-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2029-01-01T00:00:00Z', GIT_AUTHOR_NAME: 'synthetic',
  GIT_AUTHOR_EMAIL: 's@example.invalid', GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' };
const NO_ROWS = () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
const py = (body) => `python3 - <<'PY'\n${body}\nPY`;

/** A review of one Bash command run from `<w>/start` (in no repository), beside the repository `<w>/app`, whose
 *  `src/money.js` changed while the session ran. The recording lies at `<w>/.claude/projects/-start/s.jsonl`. */
async function review(t, command) {
  const w = await realpath(await mkdtemp(join(tmpdir(), 'sonah-d192-')));
  t.after(() => rm(w, { recursive: true, force: true }));
  const app = join(w, 'app'), start = join(w, 'start');
  await mkdir(join(app, 'src'), { recursive: true });
  await writeFile(join(app, 'src/money.js'), 'export const a = 1;\n');
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'base']])
    execFileSync('git', args, { cwd: app, env: GIT_ENV, stdio: 'pipe' });
  await mkdir(start, { recursive: true });
  await writeFile(join(app, 'src/money.js'), 'export const a = 2;\n');
  await utimes(join(app, 'src/money.js'), new Date(MID), new Date(MID));
  const rec = join(w, '.claude', 'projects', '-start', 's.jsonl');
  await mkdir(dirname(rec), { recursive: true });
  const row = (extra) => ({ cwd: start, sessionId: 's', ...extra });
  await writeFile(rec, [
    row({ type: 'user', uuid: 'u1', timestamp: START, message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
    row({ type: 'assistant', uuid: 'a1', parentUuid: 'u1', timestamp: START, message: { role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: command(app) } }] } }),
    row({ type: 'user', uuid: 'u2', parentUuid: 'a1', timestamp: MID, message: { role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: '' }] } }),
    row({ type: 'assistant', uuid: 'a2', parentUuid: 'u2', timestamp: END, message: { role: 'assistant',
      content: [{ type: 'text', text: 'done' }] } }),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const run = join(w, 'run');
  await mkdir(run, { recursive: true });
  const state = join(run, 'state');
  const labels = [];
  await runSessionReviewCommand([rec, '--concurrency', '1', '--state-dir', state, '--format', 'md', '--output',
    join(run, 'story.md'), '--no-open', '--code-pass'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: start, installSignals: false,
    env: { HOME: join(run, 'home'), SONAH_HOME: join(run, '.sonah'), CODEX_HOME: join(run, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(run, 'claude'), SONAH_NO_UPDATE_CHECK: '1' },
    loadReviews: async () => new Map(), openPage: async () => {},
    createJudge: ({ onResult }) => async (request) => {
      labels.push(request.label);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return codeJudge({ narrative: NO_ROWS })(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  const cp = report.codePass;
  return { codeCalls: labels.filter((label) => /^code-/.test(label)).length,
    places: (cp?.base?.places ?? []).map((p) => p.at.replace(w, '<w>')),
    files: (cp?.files ?? []).map((f) => `${String(f.path).replace(w, '<w>')}:${f.state}`),
    notReviewed: reportNotReviewedOf(report) ?? null };
}

const REVIEWED = { places: ['<w>/app'], files: ['<w>/app/src/money.js:shown'], notReviewed: null };

test('a write after a relative cd, from no repository, is reviewed in the repository it landed in', async (t) => {
  for (const command of [() => `cd ../app && ${py("open('src/money.js','w').write('x')")}`,
    () => "cd ../app/src && sed -i 's/2/3/' money.js"]) {
    const { codeCalls, ...got } = await review(t, command);
    assert.deepEqual(got, REVIEWED, command());
    assert.ok(codeCalls > 0, command());
  }
});

test('a write after a ~ cd, or a relative cd after an absolute one, is reviewed there too', async (t) => {
  for (const command of [() => `cd ~/app && ${py("open('src/money.js','w').write('x')")}`,
    (app) => `cd ${dirname(app)} && cd app && ${py("open('src/money.js','w').write('x')")}`]) {
    const { codeCalls, ...got } = await review(t, command);
    assert.deepEqual(got, REVIEWED, command('<app>'));
    assert.ok(codeCalls > 0);
  }
});

test('after pushd or in a subshell, as before: a file that does not exist, and no changed lines to show', async (t) => {
  for (const [command, path] of [[(app) => `pushd ${app} && ${py("open('src/money.js','w').write('x')")}`, 'src/money.js'],
    [(app) => `pushd ${app} && cd src && sed -i 's/2/3/' money.js`, 'money.js'],
    [() => "(cd ../app && cd src && sed -i 's/2/3/' money.js)", 'money.js']]) {
    const got = await review(t, command);
    assert.deepEqual(got, { codeCalls: 0, places: [], files: [`${path}:deleted`], notReviewed: 'none_shown' }, command('<app>'));
  }
});
