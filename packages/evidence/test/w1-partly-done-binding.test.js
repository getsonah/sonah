// W1 h3 (owner decision 2026-10-13): a partly-done requirement rests on two receipts, the part that is met (its
// deliverable) and the part that is not (its shortfall), so a checking vote binds to it through either. Before, it bound
// only through the deliverable (or the instruction), and a vote that upheld the row by citing its shortfall was rejected
// `support_unbound`, leaving a right "partly done" not checked. Every recording here is synthetic; no model is called —
// the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, humanAsk, said, call, result } from './m33-u-unasked-fixture.js';
import { runReview, bindingsFor } from '../src/run-review.js';

const ASK = 'Fix greet.js so empty names give the guest greeting. Also add a test for it.';

function rows() {
  return [
    humanAsk(ASK),
    call('t1', 'Edit', { file_path: '/repo/greet.js', old_string: 'return name',
      new_string: 'return name || "guest"' }),
    result('t1', 'The file /repo/greet.js has been updated.', { filePath: '/repo/greet.js', oldString: 'return name',
      newString: 'return name || "guest"', originalFile: 'return name\n', structuredPatch: [], userModified: false,
      replaceAll: false }),
    said('Fixed greet.js; I did not add a test.'),
  ];
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });

function fixture(session) {
  const ask = session.events.find((event) => event.kind === 'instruction');
  const edit = session.events.find((event) => event.kind === 'invocation');
  const closing = session.events.find((event) => event.kind === 'commentary');
  return {
    whole: quote(ask.id, 'instruction', ASK),
    deliverable: quote(edit.id, 'code', 'return name || "guest"'),
    shortfall: quote(closing.id, 'commentary', 'I did not add a test.'),
  };
}
const partly = (n) => ({ text: 'fix greet.js and add a test', instruction: n.whole, status: 'partly-done',
  deliverable: n.deliverable, shortfall: n.shortfall });

test('W1 h3: a partly-done requirement binds through its deliverable and its shortfall', async (t) => {
  const { session } = await load(t, rows());
  const n = fixture(session);
  const item = { key: 'requirements:0', type: 'requirement', candidate: partly(n) };
  const bound = bindingsFor(session, [item]).get(item.key);
  const events = bound instanceof Set ? bound : bound.events;
  assert.ok(events.has(n.deliverable.eventId), 'its deliverable');
  assert.ok(events.has(n.shortfall.eventId), 'and its shortfall');
  assert.ok(events.has(n.whole.eventId), 'and its instruction, as before');
  // Done binds through its deliverable alone and not-done through its shortfall alone, as before.
  const done = bindingsFor(session, [{ ...item, candidate: { ...partly(n), status: 'done', shortfall: null } }])
    .get(item.key);
  assert.ok(!(done instanceof Set ? done : done.events).has(n.shortfall.eventId));
  const notDone = bindingsFor(session, [{ ...item, candidate: { ...partly(n), status: 'not-done' } }]).get(item.key);
  assert.ok(!(notDone instanceof Set ? notDone : notDone.events).has(n.deliverable.eventId));
});

test('W1 h3: a vote that upholds a partly-done row by citing its shortfall counts, and the row is published',
  async (t) => {
    const { session } = await load(t, rows());
    const n = fixture(session);
    // Every check upholds the row, citing only the shortfall (the part that is not met).
    const judge = async (request) => (!request.challenge
      ? { decisions: [], pivots: [], claims: [], requirements: [partly(n)] }
      : { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
        explanation: 'Synthetic: the shortfall shows the test was not added.',
        receipts: [n.shortfall] })) });
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge });
    const row = report.requirements.find((r) => r.text === 'fix greet.js and add a test');
    assert.equal(row.status, 'partly-done');
    assert.equal(row.reason ?? null, null);
    const votes = report.windowResults[0].challenge.results.find((r) => r.key === 'requirements:0').votes;
    assert.ok(votes.length > 0 && votes.every((vote) => vote.valid === true && vote.cause === undefined),
      'no vote is rejected support_unbound');
  });
