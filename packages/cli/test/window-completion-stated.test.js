// W3d-5 / F177. The CLI says how many review windows completed and, for every other one, the closed
// reason — one line beside the run state, tokens and counts only.
//
// Every byte is synthetic: an invented recording and a table transport. No model, no network, no
// real ~/.sonah — SONAH_HOME is a temporary directory. (D82 step 10: the command test ran through the
// removed PR route; it runs through the session review command.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { session as recording, toJsonl } from '../../golden/src/build.js';
import { WINDOW_INCOMPLETE_REASONS } from '../../evidence/src/run-review.js';
import { runSessionReviewCommand, windowCompletionLine } from '../src/session-review-command.js';

test('F177 the completion line: a count, then each recorded reason in vocabulary order, then the unexplained', () => {
  assert.equal(windowCompletionLine({ windows: 11, complete: 11, byReason: {}, unexplained: 0 }), 'Windows complete: 11 of 11');
  assert.equal(windowCompletionLine({ windows: 11, complete: 9,
    byReason: { 'challenge:votes_invalid': 1, 'narrative:model_unavailable': 1 }, unexplained: 0 }),
  'Windows complete: 9 of 11; incomplete: narrative:model_unavailable ×1, challenge:votes_invalid ×1');
  assert.equal(windowCompletionLine({ windows: 11, complete: 3,
    byReason: { 'grounding:relevance': 4, 'grounding:session': 2, 'challenge:items_unresolved': 1 }, unexplained: 2 }),
  'Windows complete: 3 of 11; incomplete: grounding:session ×2, grounding:relevance ×4, challenge:items_unresolved ×1; '
    + 'incomplete with no recorded reason: 2');
  assert.equal(windowCompletionLine({ windows: 2, complete: 0, byReason: {}, unexplained: 2 }),
    'Windows complete: 0 of 2; incomplete with no recorded reason: 2');
  // Closed: a token outside the vocabulary, or a count that is not a count, never prints.
  assert.equal(windowCompletionLine({ windows: 2, complete: 1, byReason: { 'narrative:ok': 1, 'SYNTHETIC text': 1,
    'narrative:schema': 'one', 'narrative:no_json': 1 }, unexplained: 0 }), 'Windows complete: 1 of 2; incomplete: narrative:no_json ×1');
  for (const malformed of [undefined, null, {}, { windows: 2, complete: 3, byReason: {}, unexplained: 0 },
    { windows: 2, complete: '2', byReason: {}, unexplained: 0 }, { windows: 2, complete: 2, byReason: {}, unexplained: -1 }])
    assert.equal(windowCompletionLine(malformed), null, JSON.stringify(malformed));
  for (const token of WINDOW_INCOMPLETE_REASONS)
    assert.match(windowCompletionLine({ windows: 1, complete: 0, byReason: { [token]: 1 }, unexplained: 0 }), new RegExp(`; incomplete: ${token} ×1$`));
});

// ---- the command --------------------------------------------------------------------------------
const ASK = 'SYNTHETIC_WCS_ASK: read the synthetic file.';
/** Answers every narrative with nothing to report; every checking call votes on nothing when `unvoted`. */
const transport = ({ unvoted = false } = {}) => ({ onResult, config }) => async (request) => {
  onResult({ ok: true, backend: config.backend, attestation: 'attested', contextWindow: 1_000_000 });
  if (request.challenge) return { votes: unvoted ? [] : request.challenge.items.map(({ key, candidate }) => ({ key,
    verdict: 'not-refuted', explanation: 'SYNTHETIC support.', receipts: candidate.receipts })) };
  const instruction = request.window.events.find((event) => event.kind === 'instruction');
  const action = request.window.events.find((event) => event.kind === 'invocation');
  return { decisions: [], pivots: [], claims: [], failures: [], notClaims: [], forbiddenEdits: [],
    requirements: [{ text: ASK, instruction: { eventId: instruction.id, role: 'instruction', quote: ASK },
      status: 'done', deliverable: { eventId: action.id, role: 'action', quote: 'a.js' } }] };
};

async function review(t, options) {
  const home = await mkdtemp(join(tmpdir(), 'sonah-wcs-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const repo = join(home, 'repo');
  await mkdir(repo);
  const path = join(home, 'synthetic.jsonl');
  await writeFile(path, toJsonl(recording({ cwd: repo, sessionId: 'synthetic-wcs', version: '2.1.284' })
    .ask(ASK).read('a.js', 'SYNTHETIC_WCS file content.').done()) + '\n');
  const out = { stdout: '', stderr: '' };
  // The session's review alone: the code step (on by default, owner decision 2026-10-14) is off by its flag.
  const code = await runSessionReviewCommand([path, '--no-code-pass'], { cwd: repo, installSignals: false,
    createJudge: transport(options),
    env: { HOME: home, SONAH_HOME: join(home, '.sonah'), CODEX_HOME: join(home, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(home, 'claude-projects') },
    loadReviews: async () => new Map(), openPage: async () => {},
    stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } });
  assert.doesNotMatch(out.stderr, /could not complete/);
  return { code, ...out, lines: out.stdout.split('\n') };
}

test('F177 the CLI prints the completion line beside the run state, after the window progress', async (t) => {
  const clean = await review(t, {});
  assert.match(clean.stderr, /^Review window 1\/1 finished$/m);
  const at = clean.lines.findIndex((line) => line.startsWith("Sonah's review:"));
  assert.ok(clean.lines.slice(at, at + 4).includes('Windows complete: 1 of 1'), clean.stdout);
  assert.equal(clean.code, 0);

  const unvoted = await review(t, { unvoted: true });
  assert.ok(unvoted.lines.includes('Windows complete: 0 of 1; incomplete: challenge:votes_invalid ×1'),
    unvoted.stdout);
  assert.equal(unvoted.code, 1, 'D71 (a): an incomplete window leaves Sonah\'s review incomplete, exit 1');
});
