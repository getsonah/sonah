// W3 F1(a) (owner decision 2026-10-13): a support recorded before the claim is refused
// `stale_run` when an in-repository change was recorded between its run and the claim (owner decision 2026-10-05). The
// result of the claim actor's own write shows only what that write did to its own paths, so only a later change to one
// of those typed paths makes it stale; another file's change no longer voids it (a CHANGELOG line's own result was
// voided by a later edit of a test file). Recorder structure only: the write's typed paths, the later
// actions' typed changes, outcomes and order.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { supportCheck } from '../src/claims.js';
import { runReview } from '../src/run-review.js';

const TEXT = {
  ask: 'SYNTHETIC_W3A_ASK: add a changelog line and fix the parser.',
  line: '- Fixed the parser.\n',
  other: 'export const parse = (s) => s.trim();\n',
  done: 'The file CHANGELOG.md has been updated successfully.',
  said: 'SYNTHETIC_W3A_SAID: I added the changelog line.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const write = (id, path, key, { result = 'succeeded', output = null, outside = false } = {}) => [
  { id, kind: 'invocation', callKey: id, tool: 'edit', operation: 'edit', paths: [{ path }], command: [], input: [],
    changes: [{ path, before: [], after: whole(key), diff: [], extent: { chars: TEXT[key].length, lines: 1,
      truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' },
    ...(outside ? { outsideRepository: true } : {}) }], ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result, terminalStatusProven: true,
    output: output ? whole(output) : [], sourceOfResult: 'native', ...T1 }];
const ask = { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 };
const said = { id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'), ...T1 };
const sessionOf = (events) => new Session({ sessionKey: 'sess-w3-own-write', adapter: 'claude', blobs: { ...TEXT },
  events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
const claim = { text: 'The agent added the changelog line.', stated: { eventId: 'C1', role: 'commentary',
  quote: 'I added the changelog line.' }, supportedBy: { eventId: 'W1-r', role: 'observation',
  quote: 'has been updated successfully' } };
const shown = { 'W1-r': [{ role: 'observation', text: TEXT.done }] };
const check = (events) => supportCheck(sessionOf(events), claim, shown);
const own = () => write('W1', 'CHANGELOG.md', 'line', { output: 'done' });

test('W3 F1(a): an own write\'s result is stale only when a later change touches one of that write\'s paths', () => {
  // A later change to another path, before the claim: no longer stale.
  assert.deepEqual(check([ask, ...own(), ...write('W2', 'src/parse.js', 'other'), said]).ok, true);
  // A later change to the same path, before the claim: stale, as before.
  assert.equal(check([ask, ...own(), ...write('W2', 'CHANGELOG.md', 'other'), said]).reason, 'stale_run');
  // … even outside the repository by its change row (the same typed path is the same file).
  assert.equal(check([ask, ...own(), ...write('W2', 'CHANGELOG.md', 'other', { outside: true }), said]).reason,
    'stale_run');
  // A same-path change recorded as failed changed nothing; one whose outcome is unknown is a change.
  assert.equal(check([ask, ...own(), ...write('W2', 'CHANGELOG.md', 'other', { result: 'failed' }), said]).ok, true);
  assert.equal(check([ask, ...own(), ...write('W2', 'CHANGELOG.md', 'other', { result: 'unknown' }), said]).reason,
    'stale_run');
  // A same-path change after the claim is no concern of the claim.
  assert.equal(check([ask, ...own(), said, ...write('W2', 'CHANGELOG.md', 'other')]).ok, true);
  // A same-path change whose place in the order code cannot read is stale; another path's is no concern.
  const unordered = sessionOf([ask, ...own(), ...write('W2', 'CHANGELOG.md', 'other'), said]);
  delete unordered.event('W2').sequence;
  assert.equal(supportCheck(unordered, claim, shown).reason, 'stale_run');
  const elsewhere = sessionOf([ask, ...own(), ...write('W2', 'src/parse.js', 'other'), said]);
  delete elsewhere.event('W2').sequence;
  assert.equal(supportCheck(elsewhere, claim, shown).ok, true);
});

test('W3 F1(a): the own write\'s result is asked and can verify the claim', async () => {
  const events = [ask, ...own(), ...write('W2', 'src/parse.js', 'other'), said];
  const answer = { decisions: [], pivots: [], requirements: [], claims: [structuredClone(claim)] };
  const asked = [];
  const report = await runReview({ session: sessionOf(events), pr: null, reviewScope: 'session-only',
    judge: async (request) => {
      if (!request.challenge) return structuredClone(answer);
      asked.push(...request.challenge.items);
      return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic.', receipts: [item.key.endsWith(':support') ? claim.supportedBy : claim.stated] })) };
    } });
  assert.ok(asked.some((item) => item.key.endsWith(':support')), 'asked as its own item');
  assert.deepEqual(report.promises.map((p) => p.status), ['verified']);
  assert.equal(report.counts.promiseSupport.rejected.stale_run, 0);
});
