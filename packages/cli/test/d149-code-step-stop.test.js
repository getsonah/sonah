// D149: the review's stop signals (SIGINT, SIGTERM) stop the code step too, as they stop the session review: so a stop
// during the code step ends its calls and lets it remove what it made (its start-commit folder) before the process ends.
//
// A synthetic session and folder, fake agents: no recording of anyone's, no model, no network. The signal is emitted to
// this process's own listeners only (`process.emit`), which sends nothing to any process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { codeSession, codeJudge, repoWith, sha256 } from './code-pass-fixture.js';

test('D149: a stop signal during the code step reaches it: its signal aborts, and the step is given its start-commit folder\'s place', async (t) => {
  const root = await repoWith(t);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d149-stop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl');
  await mkdir(home);
  await writeFile(file, '{}\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const before = process.listenerCount(signal);
    const seen = [];
    await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, `state-${signal}`), '--format',
      'md', '--output', join(dir, `story-${signal}.md`), '--no-open', '--code-pass'], {
      stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: root, env, installSignals: true,
      loadReviews: async () => new Map(), openPage: async () => {},
      loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
      runCode: async (args) => {
        process.emit(signal);
        seen.push([args.signal.aborted, args.startFolderAt]);
        return { report: args.report };
      },
      createJudge: ({ config, onResult }) => async (request) => {
        onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
        return codeJudge()(request);
      } }).catch(() => null);
    assert.deepEqual(seen, [[true, join(dir, `state-${signal}`, 'code-pass', 'start-commit')]], signal);
    assert.equal(process.listenerCount(signal), before, `${signal}: the listener is removed after the step`);
  }
});
