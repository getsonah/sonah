// M36 phase 3 (owner decision D68 Q; C-07 "M36 evidence re-ask", "Window checkpoints"; D60): a session-only window's
// deterministic evidence re-ask goes through the one reuse rule — its answer is stored by its exact request bytes, and a
// saved review replays every call, the first answer, its re-ask and every challenge, with no call. The checkpoint's
// answer list names the re-ask under its window (its label).
//
// A synthetic session and a synthetic judge only; the answer store is a temp directory. No recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { planWindowRequests, runReview } from '../../evidence/src/run-review.js';
import { answerStorable, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { windowOfLabel } from '../src/session-review.js';

const LONG = Array.from({ length: 400 }, (_, k) => `line ${k + 1}: ${k === 199 ? 'not ok 7 - FAILS in the middle'
  : `ok ${'.'.repeat(40)}`}`).join('\n');
const blobs = { ask: 'Run the suite and tell me.', cmd: 'npm test', out: LONG, said: 'The whole suite passes.' };
const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
const session = () => new Session({ sessionKey: 'm36-reask-cache', adapter: 'claude', blobs: { ...blobs }, events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: ref('ask'), turn: 'T1' },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [], command: ref('cmd'), input: [],
    changes: [], turn: 'T1' },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'succeeded', exitCode: 0,
    terminalStatusProven: true, sourceOfResult: 'native', output: ref('out'), turn: 'T1' },
  { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref('said'), turn: 'T1' },
].map((event, sequence) => ({ ...event, sequence })) });
const IDENTITY = Object.freeze({ backend: 'claude-cli', model: 'claude-sonnet-5' });
const empty = { decisions: [], pivots: [], claims: [], requirements: [] };

test('M36 Q: the re-ask is stored by its bytes; a saved review replays the first answer, the re-ask and the challenges with no call', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m36-reask-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const s = session();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const a = (id) => plan.requests[0].aliases.of(id);
  const claim = { text: 'The agent said the suite passes.', stated: { eventId: a('C1'), role: 'commentary', quote: 'The whole suite passes.' },
    contradictedBy: { eventId: a('A1-r'), role: 'observation', quote: 'not ok 7 - FAILS in the middle' } };
  const labels = [];
  const live = async (request) => {
    labels.push(request.label);
    if (request.challenge) return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
      explanation: 'Synthetic.', receipts: [item.candidate.contradictedBy ?? item.candidate.stated] })) };
    if (request.label.endsWith(':evidence')) return { ...empty, claims: [claim] };
    const first = { ...empty, evidenceRequests: [{ eventId: a('A1-r'), fromLine: 199, throughLine: 201 }] };
    assert.equal(answerStorable(request, first), true, 'the store keeps an answer carrying its requests');
    return first;
  };
  const first = memoizeJudge(live, createAnswerCache(dir, IDENTITY));
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', judge: first });
  assert.ok(labels.includes('narrative:w1:evidence'));
  assert.equal(windowOfLabel('narrative:w1:evidence'), 1, 'a checkpoint lists it under its window');
  assert.deepEqual(report.findings.map((f) => f.status), ['DECIDE']);
  const calls = labels.length;
  const replay = memoizeJudge(async () => assert.fail('a saved review makes no call'), createAnswerCache(dir, IDENTITY));
  const again = await runReview({ session: session(), pr: null, reviewScope: 'session-only', judge: replay });
  assert.equal(labels.length, calls);
  assert.deepEqual(again.findings, report.findings);
  assert.deepEqual(again.windowResults[0].evidence, report.windowResults[0].evidence);
});
