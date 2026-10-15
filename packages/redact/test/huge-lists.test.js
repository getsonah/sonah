// W3e-7 / F222 — a huge field is scanned, not crashed on.
//
// `scrubTail` collected its units with `units.push(...logicalLines(…))`: a spread passes every element
// as an argument, and past a few hundred thousand the call overflows the stack — a command whose
// output ran to 400K lines threw `RangeError: Maximum call stack size exceeded` out of `redact`, and
// the whole capture with it. Every spread-push over a list that grows with the input is now a loop.
// The same shape stood where a continued line's physical lines, a settled form's lines and a unit's
// declarations are appended, so each of those is driven past the same size here too.
//
// Every input is synthetic and low-entropy. Nothing is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { redact } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const V = ['hunt', 'er2', 'xW3e7'].join('');
const MASK = '‹redacted:secret-value›';
const N = 400_000;

test('F222 a tail of 400K entries is scanned: every clean entry kept, every secret masked and declared', () => {
  const tail = Array.from({ length: N }, (_, i) => (i % 1000 === 7 ? `API_TOKEN=${V}` : `step ${i} ok`));
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make all', tailLines: tail }] }));
  const out = ledger.ledger[0].tailLines;
  assert.equal(out.length, N);
  for (let i = 0; i < N; i++) assert.equal(out[i], i % 1000 === 7 ? `API_TOKEN=${MASK}` : `step ${i} ok`, `entry ${i}`);
  assert.equal(dropped.length, N / 1000);
  assert.ok(dropped.every((d) => d.reason === 'redacted:secret-key-value' && d.where === 'tailLines'));
});

test('F222 a tail whose 400K entries are one continued line is scanned and kept', () => {
  const tail = Array.from({ length: N }, (_, i) => (i < N - 1 ? `  arg${i % 10} \\` : '  done'));
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make all', tailLines: tail }] })).ledger.ledger[0].tailLines;
  assert.equal(out.length, N);
  assert.deepEqual(out, tail);
});

test('F222 a tail whose 400K continued entries each hold a secret is masked where each stands', () => {
  const tail = Array.from({ length: N }, (_, i) => (i < N - 1 ? `  --token ${V} \\` : '  done'));
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make all', tailLines: tail }] }));
  const out = ledger.ledger[0].tailLines;
  assert.equal(out.length, N);
  assert.ok(out.every((line, i) => line === (i < N - 1 ? `  --token ${MASK} \\` : '  done')));
  assert.equal(dropped.length, N - 1);
});

test('F222, D68 (E) a body of 400K continued lines is scanned and kept whole', () => {
  const text = Array.from({ length: N }, (_, i) => (i < N - 1 ? `  arg${i % 10} \\` : '  done')).join('\n');
  const after = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'build.sh', after: { text, truncated: false, lines: N } }] }))
    .ledger.ledger[0].after;
  assert.equal(after.text, text);
  assert.equal(after.truncated, false);
});

test('F222 a command of 400K continued lines, then a secret split across a continuation, is kept line by line', () => {
  // The whole-field scan cannot hide the joined secret, so each logical line is settled on its own and
  // the 400K clean lines are appended as they stand.
  const clean = Array.from({ length: N }, (_, i) => (i < N - 1 ? `  arg${i % 10} \\` : '  done')).join('\n');
  const [a, b] = [V.slice(0, 5), V.slice(5)];
  const out = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `${clean}\nexport API_TOKEN=${a}\\\n${b} && deploy` }] }))
    .ledger.ledger[0].cmd;
  assert.equal(out, `${clean}\nexport API_TOKEN=${MASK} && deploy`);
});

test('F222 a command of 400K continued lines, each holding a secret, is masked and every value declared', () => {
  const text = Array.from({ length: N }, (_, i) => (i < N - 1 ? `  --token ${V} \\` : '  done')).join('\n');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: text }] }));
  assert.equal(ledger.ledger[0].cmd, text.replaceAll(V, MASK));
  assert.equal(dropped.length, N - 1);
});

test('F222 no spread-push is left in redact', () => {
  // The rule, held in the source: a spread passes every element as an argument. `push` takes a loop.
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  assert.equal(/\.push\(\s*\.\.\./.test(source), false);
  assert.equal(/\.(?:unshift|splice|concat)\([^)]*\.\.\./.test(source), false);
  assert.equal(/(?:Math\.(?:max|min)|String\.fromCharCode|fromCodePoint)\(\s*\.\.\./.test(source), false);
});
