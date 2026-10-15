// P1 (the asks fixes, 2026-10-13; sonah.session-review-agent/9). An ask to run the tests, every attempt of which
// was refused, could be filed not-checked resting on those attempts, while another on the same evidence was filed
// not-done quoting the refusal. Step 1 of the brief now says such a run is not-done, its shortfall quoting that
// refusal. Wording the model reads: no code reads a word of it, and code
// already grounds such a shortfall (the test below keeps that). Every recording here is synthetic; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { SONAH_SESSION_REVIEW_AGENT, SONAH_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { textBeforeAsksFixes, ASKS_FIXES_VERSIONS, W1_VERSIONS, W2_VERSIONS, textBeforeW1 }
  from './m33-integration-fixture.js';

const flat = (text) => text.replace(/\s+/g, ' ');
const SENTENCE = 'When every attempt at it has a RESULT whose "outcome:" line says it did not run (it was refused or'
  + ' blocked), it is not-done, and "shortfall" quotes that refusal from the RESULT, never not-checked resting on those'
  + ' attempts.';

test('P1: one version bump, /9 (/8 had been released); rendered back, the brief is /8\'s byte for byte', () => {
  // W1 B moved it once more (sonah.session-review-agent/10): an edit may go against a project instruction file.
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  assert.equal(W1_VERSIONS.agent.before, ASKS_FIXES_VERSIONS.agent.after);
  assert.equal(W2_VERSIONS.agent.before, W1_VERSIONS.agent.after);
  assert.equal(W2_VERSIONS.agent.after, SESSION_REVIEW_AGENT_VERSION);
  // The /8 brief main 7ac6158 sends (its digest: m33-c-claims.test.js MOVED_BY_FIX_COLUMN.system, one window's system).
  const back = textBeforeAsksFixes(SONAH_SESSION_REVIEW_AGENT);
  assert.equal(createHash('sha256').update(back).digest('hex'),
    '1382ab5b5bf01a8065eecf4d28472845a3857c5c8439f8e4df0a0717965ed761');
  // W1 B's texts rendered back first (`textBeforeW1`), P1's sentence is the one difference.
  assert.equal(Buffer.byteLength(textBeforeW1(SONAH_SESSION_REVIEW_AGENT)) - Buffer.byteLength(back), 223,
    'one sentence, 223 bytes');
});

test('P1: step 1 says a requested run refused at every attempt is not-done, once, after the outcome sentence', () => {
  const brief = flat(SONAH_SESSION_REVIEW_AGENT);
  assert.equal(brief.split(SENTENCE).length, 2, 'once');
  const at = brief.indexOf(SENTENCE);
  assert.ok(brief.indexOf('STEP 1. WHAT THE HUMAN ASKED') < at && at < brief.indexOf('STEP 2. WHAT THE AGENT TOLD'));
  assert.ok(brief.indexOf('says it ran to an outcome.') < at, 'after the sentence on a run that ran');
  assert.ok(at < brief.indexOf('A result the human asked to be told is done only when'), 'before the told sentence');
  // The status definitions themselves did not move: not-checked still names restsOn for a check that did not finish.
  assert.ok(brief.includes('not-checked What would settle it is not in this window: nothing here delivers the ask, the'
    + ' check it needs did not run or did not finish ("restsOn" names those ACTIONs)'));
  assert.ok(!flat(SONAH_REVIEW_AGENT).includes('refused or blocked'), 'the combined route\'s brief did not move');
});

test('P1: no product code reads the sentence\'s words', async () => {
  const roots = ['packages/evidence/src', 'packages/cli/src', 'packages/render', 'packages/slicer/src'];
  let hits = 0;
  for (const root of roots) {
    const dir = new URL(`../../../${root}/`, import.meta.url);
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.js') || name === 'review-agent.js') continue;
      const text = await readFile(new URL(name, dir), 'utf8');
      if (text.includes('refused or blocked') || text.includes('resting on those attempts')) hits++;
    }
  }
  assert.equal(hits, 0);
});

test('P1: a not-done row quoting a refused run\'s RESULT grounds and is published as the model gives it', async (t) => {
  const SIDECAR = { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
  const { session } = await load(t, [
    humanAsk('Run npm test and tell me the result.'),
    call('t1', 'Bash', { command: 'npm test' }),
    result('t1', 'This command requires approval', { ...SIDECAR }, true),
    call('t2', 'Bash', { command: 'npm test' }),
    result('t2', 'This command requires approval', { ...SIDECAR }, true),
    said('I could not run the tests: the command needs approval.'),
  ]);
  const ask = session.events.find((event) => event.kind === 'instruction');
  const refused = session.events.filter((event) => event.kind === 'observation');
  assert.equal(refused.length, 2);
  const answer = { decisions: [], pivots: [], claims: [], requirements: [{ text: 'run the tests',
    instruction: { eventId: ask.id, role: 'instruction', quote: 'Run npm test' }, status: 'not-done',
    shortfall: { eventId: refused[1].id, role: 'observation', quote: 'This command requires approval' } }] };
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: async (request) => (
    request.challenge ? { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
      explanation: 'Synthetic.', receipts: [item.candidate.shortfall ?? item.candidate.instruction].filter(Boolean)
        .map((r) => ({ eventId: r.eventId, role: r.role, quote: r.quote })) })) } : structuredClone(answer)) });
  const row = report.requirements.find((r) => r.text === 'run the tests');
  assert.deepEqual([row.status, row.reason ?? null, row.shortfall.quote], ['not-done', null,
    'This command requires approval'], 'code grounds the refusal as a shortfall: no code change was needed');
});
