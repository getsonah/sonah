// D104 (F5 part 4, the mark): the session-review harness summary (/19) counts the results the session review saw only in
// part and the published rows that carry the mark, by closed status, as integers only. No session text leaves the harness.
// Synthetic session (evidence/test/d104-seen-in-part-fixture.js) and a fake transport only: no recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { REQUIREMENT_STATUSES, PROMISE_STATUSES, FAILURE_HANDLINGS, WRITTEN_LABELS } from '../../evidence/src/ledger.js';
import { oneTurn, ROWS } from '../../evidence/test/d104-seen-in-part-fixture.js';

const HARNESS = pathToFileURL(fileURLToPath(new URL('../../../scripts/session-review.mjs', import.meta.url))).href;
const harness = await import(HARNESS);
const voteReceipt = ({ candidate }) => candidate.response ?? candidate.deliverable ?? candidate.supportedBy
  ?? candidate.stated ?? candidate.instruction;

async function run(t, answer) {
  const base = await mkdtemp(join(tmpdir(), 'sonah-d104-harness-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const createJudge = ({ onResult }) => async (request) => {
    await onResult({ ok: true, attestation: 'attested', providerClass: null, elapsedMs: 1, inputBytes: 1 });
    return answer(request);
  };
  let stdout = '';
  const { summary } = await harness.runSessionReviewHarness({ parent: join(base, 'SYNTHETIC.jsonl'),
    codexHome: base, out: join(base, 'out'), backend: 'claude-cli', model: 'claude-synthetic-1', maxCalls: 50,
    maxSeconds: 60, timeoutMs: 1000, sessionKey: 'd104-claude', concurrency: 1 },
  { loadSession: async () => oneTurn(), createJudge, write: (text) => { stdout += text; },
    progress: () => {}, installSignals: false });
  assert.doesNotMatch(stdout, /SYNTHETIC_D104/, 'no session text leaves the harness');
  assert.deepEqual(JSON.parse(stdout.trim()), summary, 'stdout is the summary');
  return summary;
}

test('D104 the harness summary counts the results seen in part and the marked rows by closed status (/19)', async (t) => {
  const summary = await run(t, (request) => (request.challenge
    ? { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Recorded.',
      receipts: [voteReceipt(item)] })) }
    : { decisions: [], pivots: [], ...structuredClone(ROWS) }));
  assert.equal(summary.schema, 'sonah.session-review-harness/19');
  assert.equal(summary.state, 'finished');
  const zeros = (vocabulary) => Object.fromEntries(vocabulary.map((token) => [token, 0]));
  assert.deepEqual(summary.seenInPart, { results: 4, rows: {
    requirements: { ...zeros(REQUIREMENT_STATUSES), done: 1 },
    promises: { ...zeros(PROMISE_STATUSES), verified: 2 },
    failures: { ...zeros(FAILURE_HANDLINGS), 'told-human': 1, 'not-checked': 1, 'passed-over': 1 },
    writtenClaims: zeros(WRITTEN_LABELS), decisions: 0, pivots: 0, findings: 0 } });
});

test('D104 with no row proposed, the failure rows code keeps for each failed long result are marked, not checked', async (t) => {
  const summary = await run(t, (request) => (request.challenge ? { votes: [] }
    : { decisions: [], pivots: [], claims: [], requirements: [] }));
  assert.equal(summary.seenInPart.results, 4, 'the count is the windows\', whatever the rows');
  assert.deepEqual(Object.keys(summary.seenInPart.rows.requirements), [...REQUIREMENT_STATUSES], 'every status, always');
  // The suite, the lint and the end-to-end run failed: code keeps a not-checked row for each, which cites its result.
  assert.deepEqual(summary.seenInPart.rows.failures, { ...Object.fromEntries(FAILURE_HANDLINGS.map((h) => [h, 0])),
    'not-checked': 3 });
  assert.equal(Object.values(summary.seenInPart.rows.promises).reduce((n, k) => n + k, 0), 0);
});
