// A token removed from prose is a real evidence cut. Its marker and count must survive
// redaction so the session adapter can declare the missing instruction or commentary span.
// The fixtures are generated synthetic text; no recording or secret is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact } from '../index.js';

const ledger = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const token = createHash('sha512').update('synthetic token drop coverage fixture').digest('base64url');
const marker = '‹dropped:high-entropy›';

test('a high-entropy prose cut marks each affected instruction and assistant statement', () => {
  const input = ledger({
    ask: [{ turn: 1, text: `Review ${token} carefully.` }],
    commentary: [{ turn: 1, beforeEvent: 0, text: `I inspected ${token} today.` }],
    sayings: [{ turn: 1, text: `Summary for ${token}.` }],
  });
  const once = redact(input);
  assert.equal(once.dropped.filter((d) => d.reason === 'dropped:unclassified-high-entropy-token').length, 3);
  for (const row of [once.ledger.ask[0], once.ledger.commentary[0], once.ledger.sayings[0]]) {
    assert.equal(row.redacted, true);
    assert.equal(row.redactedTokens, 1);
    assert.ok(row.text.includes(marker));
  }
  assert.ok(!JSON.stringify(once.ledger).includes(token), 'removed token cannot leak through metadata');
  const twice = redact({ ...once.ledger, dropped: [] }).ledger;
  for (const row of [twice.ask[0], twice.commentary[0], twice.sayings[0]]) {
    assert.equal(row.redacted, true);
    assert.equal(row.redactedTokens, 1);
  }
});

test('a generic tool keeps capture provenance when input is masked or wholly withheld', () => {
  const namedSecret = ['gh', 'p_', 'AbCdEfGhIj', 'KlMnOpQrSt', 'UvWxYz0123', '456789'].join('');
  const once = redact(ledger({ ledger: [
    { turn: 1, seq: 0, kind: 'other', inputRecorded: true, argsExcerpt: `query ${namedSecret}` },
    { turn: 1, seq: 1, kind: 'other', inputRecorded: true, argsExcerpt: token },
    { turn: 1, seq: 2, kind: 'other', inputRecorded: true, argsExcerpt: 'query synthetic-data' },
  ] })).ledger.ledger;
  assert.equal(once[0].inputRecorded, true);
  assert.equal(once[0].inputRedacted, true);
  assert.ok(!once[0].argsExcerpt.includes(namedSecret));
  assert.equal(once[1].inputRecorded, true);
  assert.equal(once[1].inputRedacted, true);
  assert.equal(once[1].argsExcerpt, undefined);
  assert.equal(once[2].inputRedacted, undefined);
  assert.equal(once[2].argsExcerpt, 'query synthetic-data');
  const twice = redact(ledger({ ledger: once })).ledger.ledger;
  assert.equal(twice[0].inputRedacted, true);
  assert.equal(twice[1].inputRedacted, true);
  assert.ok(!JSON.stringify(twice).includes(namedSecret));
  assert.ok(!JSON.stringify(twice).includes(token));
});

test('task completion identities are checked after redaction and dirty values cannot join', () => {
  const namedSecret = ['gh', 'p_', 'AbCdEfGhIj', 'KlMnOpQrSt', 'UvWxYz0123', '456789'].join('');
  const cleanId = 'task-007';
  const once = redact(ledger({ ledger: [
    { turn: 1, seq: 0, kind: 'other', workflowTaskId: cleanId,
      taskOutputTaskId: cleanId, taskOutputResultTaskId: cleanId },
    { turn: 1, seq: 1, kind: 'other', workflowTaskId: namedSecret,
      taskOutputTaskId: cleanId },
    { turn: 1, seq: 2, kind: 'other', taskOutputResultTaskId: 'bad\nidentity' },
    { turn: 1, seq: 3, kind: 'other', taskIdentityChecked: true },
  ] })).ledger.ledger;
  assert.deepEqual([once[0].workflowTaskId, once[0].taskOutputTaskId,
    once[0].taskOutputResultTaskId], [cleanId, cleanId, cleanId]);
  assert.equal(once[0].taskIdentityChecked, true);
  assert.equal(once[0].taskIdentityRedacted, undefined);
  assert.equal(once[1].workflowTaskId, undefined);
  assert.equal(once[1].taskOutputTaskId, cleanId);
  assert.equal(once[1].taskIdentityRedacted, true);
  assert.equal(once[1].taskIdentityChecked, true);
  assert.equal(once[2].taskOutputResultTaskId, undefined);
  assert.equal(once[2].taskIdentityRedacted, true);
  assert.equal(once[2].taskIdentityChecked, true);
  assert.equal(once[3].taskIdentityChecked, undefined);
  assert.ok(!JSON.stringify(once).includes(namedSecret));
  const twice = redact(ledger({ ledger: once })).ledger.ledger;
  assert.deepEqual([twice[0].workflowTaskId, twice[0].taskOutputTaskId,
    twice[0].taskOutputResultTaskId], [cleanId, cleanId, cleanId]);
  assert.equal(twice[0].taskIdentityChecked, true);
  assert.equal(twice[1].taskIdentityRedacted, true);
  assert.equal(twice[1].taskIdentityChecked, true);
  assert.equal(twice[2].taskIdentityRedacted, true);
  assert.equal(twice[2].taskIdentityChecked, true);
});
