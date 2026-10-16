// An ask's status never contradicts Sonah's own findings: `sonah review` joins what the code step tied to each ask
// (ask-code-links.js) beside the ask's status when the code step joins the report, so the saved report and every
// reader carry it, and the status stays the session review's. Synthetic session, files and fake reviewer: no recording,
// no model, no network; a temporary HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSessionReviewCommand } from '../src/session-review-command.js';
import { codeSession, codeJudge, dossierItems, reviewFinding, gitRepoWith, sha256 } from './code-pass-fixture.js';

/** One `sonah review --code-pass` run on the synthetic session; the review agent finds one bug, following from the
 *  dossier items `leads(items)` names, and its checking agent upholds it. */
async function review(t, leads) {
  const root = await gitRepoWith(t);
  const dir = await mkdtemp(join(tmpdir(), 'sonah-ask-join-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home'), file = join(dir, 'recording.jsonl'), state = join(dir, 'state');
  await mkdir(home); await writeFile(file, '{}\n');
  const env = { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
    SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') };
  const judge = codeJudge({ review: (prompt) => ({ findings: [reviewFinding({ leadsFrom: leads(dossierItems(prompt)) })],
    questions: [] }) });
  const output = join(dir, 'story.md');
  const code = await runSessionReviewCommand([file, '--code-pass', '--concurrency', '1', '--state-dir', state,
    '--format', 'md', '--output', output, '--no-open'], {
    stdout: { write: () => {} }, stderr: { write: () => {} }, cwd: root, env, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, report, story: await readFile(output, 'utf8') };
}

test('the code step\'s join: a finding that follows from the ask is linked on its row, beside an unchanged status', async (t) => {
  const linked = await review(t, (items) => items.filter((item) => item.kind === 'ask').map((item) => item.key));
  assert.equal(linked.code, 0);
  const [finding] = linked.report.codePass.findings;
  assert.equal(typeof finding?.id, 'string');
  const [row] = linked.report.requirements;
  assert.deepEqual(row.codeLinks, [{ link: 'leads_from', finding: finding.id }]);
  assert.equal(row.status, 'partly-done', 'the status is the session review\'s');
  // D97: the report .md (the story since /32) says it in the ask's item, among its evidence, with the finding's words.
  assert.match(linked.story, /\n- The session review marked it partly done, and a finding of the code review concerns it\. \*/);
  // A finding that follows from the claim alone links no ask: the row is saved as the session review left it.
  const unlinked = await review(t, (items) => items.filter((item) => item.kind === 'claim').map((item) => item.key));
  assert.equal(unlinked.report.codePass.findings.length, 1);
  assert.equal(Object.hasOwn(unlinked.report.requirements[0], 'codeLinks'), false);
  const { codeLinks: _links, ...fields } = row;
  assert.deepEqual(fields, unlinked.report.requirements[0], 'every other field of the row is the same with and without it');
});
