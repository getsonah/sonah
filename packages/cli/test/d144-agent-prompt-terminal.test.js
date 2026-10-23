// D144 (0.3.0-beta.7; the owner, 2026-10-23): a prompt for the agent is in the report Sonah
// writes to a file, and never on the terminal. A review run in the agent's own shell prints the report to its terminal
// when no --output is given; the agent would read its prompts there unasked.
//
// Synthetic session, synthetic files and a deterministic fake reviewer: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { REPORT_AGENT_PROMPT_WORDS } from '../../render/report-words.js';
import { codeSession, codeJudge, repoWith, sha256 } from './code-pass-fixture.js';

/** One `sonah review` of the synthetic session with the code step on: what it printed, and the report file it wrote. */
async function review(t, { root, output = true, html = false }) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d144-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl'), out = join(dir, html ? 'story.html' : 'story.md');
  await mkdir(home);
  await writeFile(file, '{}\n');
  let printed = '';
  const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(dir, 'state'), '--no-open',
    '--code-pass', ...(html ? ['--format', 'html'] : []), ...(output ? ['--output', out] : [])], {
    stdout: { write: (text) => { printed += text; } }, stderr: { write: () => {} }, cwd: root,
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ config, onResult }) => async (request) => {
      onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
      return codeJudge()(request);
    } });
  return { code, printed, written: output ? await readFile(out, 'utf8') : null,
    beside: html ? await readFile(join(dir, 'story.md'), 'utf8') : null };
}

test('D144: the report file holds the prompts for the agent; the report printed to the terminal holds none', async (t) => {
  const root = await repoWith(t);
  const summary = `<details><summary>${REPORT_AGENT_PROMPT_WORDS.fold}</summary>`;
  const toFile = await review(t, { root });
  assert.ok(toFile.written.includes(summary), 'the synthetic review has a Must act item with a prompt');
  assert.equal(toFile.printed.includes(REPORT_AGENT_PROMPT_WORDS.fold), false, 'the lines after it name no prompt');
  const toTerminal = await review(t, { root, output: false });
  assert.equal(toTerminal.code, toFile.code);
  assert.ok(toTerminal.printed.includes('### Must act'), 'the report is printed');
  for (const words of [REPORT_AGENT_PROMPT_WORDS.fold, REPORT_AGENT_PROMPT_WORDS.voice, REPORT_AGENT_PROMPT_WORDS.fix])
    assert.equal(toTerminal.printed.includes(words), false, words);
  // Nothing else moves: the printed report is the file's, without its prompts' folds.
  const withoutPrompts = toFile.written.replace(/\n\n<details><summary>Prompt for the agent<\/summary>\n\n[\s\S]*?\n\n<\/details>/g,
    '');
  assert.ok(toTerminal.printed.includes(withoutPrompts), 'the terminal report is the file report without the folds');
});

test('D144: a page written with --format html holds the prompts, and so does the .md written beside it', async (t) => {
  const root = await repoWith(t);
  const page = await review(t, { root, html: true });
  assert.ok(page.written.includes(`<summary>${REPORT_AGENT_PROMPT_WORDS.fold}`), 'the page holds the fold');
  assert.ok(page.beside.includes(`<details><summary>${REPORT_AGENT_PROMPT_WORDS.fold}</summary>`),
    'the .md beside the page holds it too');
  assert.equal(page.printed.includes(REPORT_AGENT_PROMPT_WORDS.voice), false, 'the terminal holds none');
});
