// M33 H1b (stage review, finding 1). A narrative whose claim carries a deeply nested `resolvedBy` must
// not end a CLI run: the report is written with JSON.stringify (`saveReport`; the removed PR
// route's `store.save` too, D82 step 10), which throws on a value that deep. The review itself
// reads the claim; what it keeps of the resolution is bounded, so the run finishes and saves.
//
// Synthetic session (/srv/x paths), synthetic judge: no recording, no model call, no git, no GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../../evidence/src/session.js';
import { reviewSession, createSessionReviewStore, readSessionReviewProgress } from '../src/session-review.js';
import { createAnswerCache } from '../src/answer-cache.js';

const TEXT = {
  ask: 'SYNTHETIC_H1B_ASK: make the synthetic replay report no gaps.',
  replay: 'node /srv/x/replay.js',
  claim: 'SYNTHETIC_H1B_CLAIM: this change clears the gap.',
  three: 'SYNTHETIC_H1B_REPLAY: gaps=3',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const session = () => new Session({ sessionKey: 'sess-h1b', adapter: 'claude', blobs: { ...TEXT }, events: [
  { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 },
  { id: 'C1', kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole('claim'), ...T1 },
  { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'Bash', operation: 'command', paths: [],
    command: whole('replay'), input: [], changes: [], ...T1 },
  { id: 'A1-r', kind: 'observation', invocation: 'A1', callKey: 'A1', phase: 'terminal', result: 'failed', exitCode: 1,
    terminalStatusProven: true, output: whole('three'), sourceOfResult: 'native', ...T1 },
].map((event, sequence) => ({ ...event, sequence })) });

const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const STATED = receipt('C1', 'commentary', 'this change clears the gap.');
const nested = (depth) => JSON.parse(`${'{"a":'.repeat(depth)}1${'}'.repeat(depth)}`);
const CLAIM = (resolvedBy) => ({ text: 'The agent said the change clears the gap.', stated: STATED,
  contradictedBy: receipt('A1-r', 'observation', TEXT.three), resolvedBy });
const EMPTY = { decisions: [], pivots: [], claims: [], requirements: [] };
const votes = (request) => ({ votes: request.challenge.items.map(({ key }) => ({ key,
  verdict: 'not-refuted', explanation: 'Recorded.', receipts: [STATED] })) });
const contradictions = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');

test('M33 H1b: a session-only review whose claim carries a 20000-deep resolvedBy finishes and saves its report', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-h1b-session-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createSessionReviewStore(join(dir, 'review'));
  const answerCache = createAnswerCache(join(dir, 'answers'), { backend: 'synthetic', model: 'synthetic' });
  const judge = async (request) => (request.challenge ? votes(request) : { ...EMPTY, claims: [CLAIM(nested(20000))] });
  const { report, progress } = await reviewSession({ session: session(), judge, answerCache, store,
    backend: 'synthetic', model: 'synthetic' });
  assert.deepEqual(contradictions(report).map((f) => f.status), ['DECIDE']);
  assert.equal(progress.state, 'finished');
  assert.equal((await readSessionReviewProgress(join(dir, 'review'))).state, 'finished');
});
