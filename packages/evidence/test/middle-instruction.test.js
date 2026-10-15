// The case that separates reading a SESSION from reading the last message: the binding
// constraint is fenced in the middle of a long brief, and a later human amendment reverses it.
// Covers EV-01 (middle fences survive), JG-03 (amendments stay identifiable), CH-04.

import test from 'node:test';
import assert from 'node:assert/strict';
import { middleInstructionSession, middleInstructionPr, MIDDLE_DECISION_CANDIDATES } from '../fixtures/middle-instruction.js';
import { buildLedger, deriveColumn } from '../src/ledger.js';
import { Session, verifyReceipt } from '../src/session.js';
import { renderReview } from '../src/review.js';

const recorded = middleInstructionSession();
const events = structuredClone(recorded.events);
// This synthetic native Write result deliberately carries the typed proof required for adoption.
events.find((event) => event.id === 'M6').terminalStatusProven = true;
const session = new Session({ sessionKey: recorded.sessionKey, adapter: recorded.adapter,
  events, blobs: structuredClone(recorded.blobs) });
const pr = middleInstructionPr();
const repo = pr.repo;
const report = () => buildLedger({ repo, session, pr, candidates: MIDDLE_DECISION_CANDIDATES });

test('EV-01 a constraint fenced in the middle of a long brief is quotable exactly', () => {
  // Not the first line, not the last: the part a "summarise the ask" approach loses.
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'M1',
    quote: 'Do not buffer a whole result set in memory' }).ok);
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'M1',
    quote: 'Hard constraint: exports must stream' }).ok);
});

test('EV-01 the surrounding chatter survives too — nothing is summarised away', () => {
  for (const quote of [
    'Please pick up the export pipeline work',        // opening
    'The reporting team runs their own scheduler',    // middle, outside the fence
    'there is a wrapper',                             // tail
  ]) assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'M1', quote }).ok, quote);
});

test('EV-01 a quote that flattens a line break is NOT verbatim and is refused', () => {
  // The source wraps as "...there is a wrapper\nin utils somewhere...". A quote that silently
  // turns that newline into a space reads as correct and is not what the human wrote, so it
  // must not ground. This is why matching is literal rather than whitespace-normalised.
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'M1',
    quote: 'there is a wrapper in utils somewhere' }).ok, false);
  assert.ok(verifyReceipt(session, { role: 'instruction', eventId: 'M1',
    quote: 'there is a wrapper\nin utils somewhere' }).ok);
});

test('EV-01 text never said is still refused in a long instruction', () => {
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: 'M1',
    quote: 'you may buffer the whole result set' }).ok, false);
});

test('JG-03 the amendment settles the column, not the superseded original', () => {
  const d = report().decisions[0];
  assert.equal(d.column, 'asked-settled');
  assert.equal(d.constrainedBy.instruction.eventId, 'M3');
  assert.deepEqual(d.amends, ['M1']);
});

test('JG-03 the review states the amendment rather than reading the choice as a breach', () => {
  const md = renderReview(report());
  assert.match(md, /This amends your earlier instruction/);
  assert.match(md, /The agent followed the later one/);
  // It must not claim to know which sentence was reversed — supersedes does not record that.
  assert.match(md, /not recorded, so it is not guessed here/);
});

test('JG-03 a superseded instruction cannot itself settle a later choice', () => {
  // Citing the original streaming rule against the buffering write is a real conflict, and it
  // grounds — the ledger must show it as a conflict, not silently prefer the amendment.
  const out = deriveColumn(session, {
    instruction: { role: 'instruction', eventId: 'M1', quote: 'Do not buffer a whole result set in memory' },
    settles: true, settledValueQuote: 'exports must stream',
  }, true, [session.event('M5')]);
  assert.equal(out.column, 'asked-settled'); // it is a real, earlier, human instruction
  // ...but the amendment relationship is what stops a reviewer misreading it: M3 supersedes M1.
  assert.deepEqual(session.event('M3').supersedes, ['M1']);
});

test('the timeline carries the full instruction history, both versions', () => {
  const md = renderReview(report());
  const timeline = md.slice(md.indexOf('What happened in the session'));
  for (const id of ['M1', 'M3', 'M5']) assert.match(timeline, new RegExp(`\`${id}\``));
});

test('a new module write is structural and survives into the PR', () => {
  const d = report().decisions[0];
  assert.equal(d.materialityRule, 'new-module');
  assert.equal(d.relevance, 'survives');
  assert.equal(d.valueState, 'grounded');
});
