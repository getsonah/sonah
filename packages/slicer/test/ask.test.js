import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressAsk } from '../src/ask.js';
import { redact } from '../../redact/index.js';

// M6: the slicer keeps the turn whole and declares only the transport budget's middle cut;
// redaction scrubs the whole turn and makes that cut. Nothing is stripped by its shape.
const compressed = (raw) => {
  const { text, elided } = compressAsk(raw);
  // As events.js records it: `elided` only when a cut is due.
  return redact({ ask: [{ turn: 1, text, ...(elided.length ? { elided } : {}) }], ledger: [], claim: {}, dropped: [] })
    .ledger.ask[0];
};

test('M6: pasted material is kept whole — a long fence, traceback or indented block is the human\'s words too', () => {
  const body = Array.from({ length: 60 }, (_, i) => `  line ${i} of the pasted spec: the endpoint must return 429`).join('\n');
  const trace = `Traceback (most recent call last):\n${Array.from({ length: 40 }, (_, i) => `  File "app.py", line ${i}, in handler`).join('\n')}\nValueError: bad`;
  const indented = Array.from({ length: 40 }, (_, i) => `    acceptance ${i}: the limit is per client`).join('\n');
  const raw = `do not touch the auth middleware\n\n\`\`\`\n${body}\n\`\`\`\n\n${trace}\n\n${indented}\n\nadd rate limiting to 3 endpoints`;
  assert.ok(body.length >= 1200 && trace.length >= 1200 && indented.length >= 1200, 'each paste is past the retired 1,200 bound');
  const { text, elided } = compressed(raw);
  assert.equal(text, raw, 'kept byte for byte');
  assert.equal(elided, undefined);
  assert.doesNotMatch(text, /\[(code block|traceback|indented block|attachment), \d+ lines/);
  assert.deepEqual(compressAsk(raw), { text: raw, elided: [] }, 'the slicer declares no strip');
});

test('M6: runs of blank lines are folded and the turn trimmed, as they always were; nothing else changes', () => {
  assert.deepEqual(compressAsk('\n\n  fix it\n\n\n\nthen ship  \n'), { text: 'fix it\n\nthen ship', elided: [] });
});

test('a short fence is instruction, not a paste', () => {
  const { text, elided } = compressAsk('run `npm test` first');
  assert.equal(elided.length, 0);
  assert.match(text, /npm test/);
});

test('an ordinary 17 KB turn retains its middle instruction', () => {
  const instruction = 'Do not change the public API.';
  const raw = 'START ' + 'x'.repeat(8500) + instruction + 'y'.repeat(8400) + ' END';
  const { text, elided } = compressAsk(raw);
  assert.equal(text, raw);
  assert.deepEqual(elided, []);
  assert.match(text, /Do not change the public API/);
});

test('windowing (M35): an over-long human turn is kept in full and declares no elision; only an attached file has a budget', () => {
  const raw = 'START ' + 'x'.repeat(22000) + ' END';
  const { text, elided } = compressAsk(raw);
  assert.equal(text, raw, 'nothing is cut, and nothing is due');
  assert.deepEqual(elided, []);
  const attached = compressAsk(raw, { chars: 7200, head: 3600, tail: 3600 });
  assert.equal(attached.text, raw, 'an attached file is kept whole until redaction');
  assert.deepEqual(attached.elided, [{ what: 'middle of turn', chars: raw.length - 7200 }]);
});
