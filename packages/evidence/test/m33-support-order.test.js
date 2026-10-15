// Owner decision 2026-10-05 (M33 light fixes, G3): a recorded result may support a claim whether it was recorded
// before or after it — code checks the order, structurally.
//
// `supportCheck` (claims.js) accepts a result recorded after the claim (as before), or one recorded BEFORE it in its
// own recorded turn with no human instruction between and no in-repository change between its run and the claim that
// did not provably fail (`stale_run`). An order it cannot read is never accepted. The model proposes the support (the
// narrative prompt asks for a result recorded before or after the claim); code verifies it and the challenge judges it.
//
// Synthetic sessions (/srv/x paths) and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { supportCheck } from '../src/claims.js';
import * as ledger from '../src/ledger.js';
import * as reviewRun from '../src/run-review.js';
import * as review from '../src/review.js';
import { challengeSystem } from '../src/challenge.js';
import { STORY_PROMISE_WORDS } from '../../render/session-story.js';

const SESSION_KEY = 'sess-support-order';
const TEXT = {
  ask: 'SYNTHETIC_SO_ASK: make the suite pass.',
  later: 'SYNTHETIC_SO_LATER: and add a changelog line.',
  said: 'SYNTHETIC_SO_SAID: All 14 tests pass.',
  run: 'npm test',
  out: 'SYNTHETIC_SO_RUN: 14 passing, 0 failing',
  edited: 'export const parse = (s) => s;\n',
};
const QUOTE = TEXT.out;
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const ask = (id, key = 'ask') => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: whole(key), ...T1 });
const said = (id = 'C1', over = {}) => ({ id, kind: 'commentary', phase: 'working', beforeInvocation: null, text: whole('said'),
  ...T1, ...over });
const run = (id = 'A1', over = {}) => [
  { id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [], command: whole('run'), input: [],
    changes: [], ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result: 'succeeded', exitCode: 0,
    terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native', ...T1, ...over }];
/** An edit of `path` (outside the repository when `outside`) with its own terminal result. */
const edit = (id, path, { outside = false, result = 'succeeded' } = {}) => [
  { id, kind: 'invocation', callKey: id, tool: 'edit', operation: 'edit', paths: [{ path }], command: [], input: [],
    changes: [{ path, before: [], after: whole('edited'), diff: [], extent: { chars: TEXT.edited.length, lines: 2,
      truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' },
    ...(outside ? { outsideRepository: true } : {}) }], ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result,
    terminalStatusProven: true, output: [], sourceOfResult: 'native', ...T1 }];
const sessionOf = (events) => new Session({ sessionKey: SESSION_KEY, adapter: 'claude', blobs: { ...TEXT },
  events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const claim = { text: 'The agent said all 14 tests pass.', stated: receipt('C1', 'commentary', 'All 14 tests pass.'),
  contradictedBy: null, supportedBy: receipt('A1-r', 'observation', QUOTE) };
const shown = { 'A1-r': [{ role: 'observation', text: TEXT.out }] };
const check = (events) => supportCheck(sessionOf(events), claim, shown);
const [, , , , , NOT_LATER, , , NOT_SAME_TURN, STALE_RUN] = ledger.SUPPORT_REJECTIONS;

test('G3 support order: a run before the claim in its turn, with no change between, supports it', () => {
  assert.equal(STALE_RUN, 'stale_run');
  assert.equal(check([ask('I1'), ...run(), said()]).ok, true, 'no change between');
  assert.equal(check([ask('I1'), ...run(), ...edit('E1', '.claude/notes.md', { outside: true }), said()]).ok, true,
    'an outside-repository write between does not block');
  assert.equal(check([ask('I1'), ...run(), ...edit('E1', 'src/parse.js', { result: 'failed' }), said()]).ok, true,
    'an in-repository edit that failed changed nothing');
  // A later run, as before.
  assert.equal(check([ask('I1'), said(), ...run()]).ok, true);
});

test('G3 support order: a stale, interrupted, other-turn or unordered earlier run never supports', () => {
  const reason = (events) => check(events).reason;
  assert.equal(reason([ask('I1'), ...run(), ...edit('E1', 'src/parse.js'), said()]), STALE_RUN, 'an in-repository edit between');
  assert.equal(reason([ask('I1'), ...run(), ...edit('E1', 'src/parse.js', { result: 'unknown' }), said()]), STALE_RUN,
    'an edit whose outcome is unknown');
  assert.equal(reason([ask('I1'), ...run(), ask('I2', 'later'), said()]), NOT_SAME_TURN, 'a human instruction between');
  assert.equal(reason([ask('I1'), ...run(), said('C1', { turn: 'T2' })]), NOT_SAME_TURN, 'another recorded turn');
  assert.equal(reason([ask('I1'), ...run(), said('C1', { turn: undefined })]), NOT_SAME_TURN, 'a turn code cannot read');
  // A later run keeps its rules: a human instruction between is still not the same turn.
  assert.equal(reason([ask('I1'), said(), ask('I2', 'later'), ...run()]), NOT_SAME_TURN);
  // An order code cannot read is never accepted.
  const unordered = sessionOf([ask('I1'), ...run(), said()]);
  delete unordered.event('C1').sequence;
  assert.equal(supportCheck(unordered, claim, shown).reason, NOT_LATER);
  const noRun = sessionOf([ask('I1'), ...run(), said()]);
  delete noRun.event('A1').sequence;
  assert.equal(supportCheck(noRun, claim, shown).reason, STALE_RUN, 'its run\'s place unknown');
});

test('G3 support order: the model is asked for a result before or after the claim; the challenge judges either', async () => {
  const plan = reviewRun.planWindowRequests({ session: sessionOf([ask('I1'), ...run(), said()]), pr: null,
    reviewScope: 'session-only' });
  // D71 (S2): a session-only review says the rule once, in its brief (the system prompt) and its claim note; a combined
  // request still says it in its task and contract (D71 i).
  const brief = plan.requests[0].request.system.replace(/\s+/g, ' ');
  assert.ok(brief.includes("It must lie in the claim's turn (no human message between them); one recorded before the claim "
    + 'counts only when no edit was recorded between that result and the claim.'));
  assert.ok(!/recorded AFTER the claim/.test(brief));
  const { CLAIM_NOTE } = await import('../src/challenge.js');
  assert.ok(CLAIM_NOTE.replace(/\s+/g, ' ').includes('its supportedBy, a result recorded before or after it in its turn'));
  const combined = reviewRun.planWindowRequests({ session: sessionOf([ask('I1'), ...run(), said()]), pr: null,
    reviewScope: 'combined' }).requests[0].request.prompt.replace(/\s+/g, ' ');
  assert.ok(combined.includes('recorded before or after the claim, confirms exactly the claimed state'));
  assert.ok(combined.includes('recorded before or after the claim in the same turn, confirms exactly what was claimed'));
  assert.ok(challengeSystem().replace(/\s+/g, ' ').includes('its supportedBy, a result recorded before or after it, said to confirm it.'));
});

test('G3 support order: a support the model cites from an earlier run is asked, and an upheld one reads "confirmed by a recorded result"', async () => {
  const seen = [];
  const judge = async (request) => {
    seen.push(request);
    if (!request.challenge) return request.window.index === 0
      ? { decisions: [], pivots: [], requirements: [], claims: [structuredClone(claim)] }
      : { decisions: [], pivots: [], requirements: [], claims: [] };
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [item.key.endsWith(':support') ? item.candidate.supportedBy : item.candidate.stated] })) };
  };
  const report = await reviewRun.runReview({ session: sessionOf([ask('I1'), ...run(), said()]), pr: null,
    reviewScope: 'session-only', judge });
  assert.ok(seen.some((r) => r.challenge?.items.some((i) => i.key.endsWith(':support'))), 'asked as its own item');
  assert.deepEqual(report.promises.map((p) => p.status), ['verified']);
  assert.equal(STORY_PROMISE_WORDS.verified, 'confirmed by a recorded result');
  assert.equal(review.PROMISE_STATUS_WORDS.verified, 'confirmed by a recorded result');
  // W3 F1(b) (owner decision 2026-10-13): the same answer after an in-repository edit between the run and the claim is
  // asked on the session route with that edit listed under "changed since:", and verified only when every counted vote
  // upholds it (w3-support-changed-since.test.js); before, it was refused `stale_run` and never asked. The combined
  // route still refuses it (`supportCheck` without `checklist`).
  const stale = await reviewRun.runReview({ session: sessionOf([ask('I1'), ...run(), ...edit('E1', 'src/parse.js'), said()]),
    pr: null, reviewScope: 'session-only', judge });
  assert.deepEqual(stale.promises.map((p) => p.status), ['verified']);
  assert.equal(stale.counts.promiseSupport.rejected.stale_run, 0);
  assert.equal(stale.counts.promiseSupport.staleAsked.upheld, 1);
  assert.equal(check([ask('I1'), ...run(), ...edit('E1', 'src/parse.js'), said()]).reason, STALE_RUN);
});
