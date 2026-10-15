// R2 execution and loss-accounting tests; all session content is synthetic. These do not
// measure model quality. M35 (windowing): the byte-budget splitter these
// tests froze is gone (windows.js `planWindows`, tested in m35-windowing.test.js): a compaction is no window boundary, so
// the adapter's compaction marks are tested here and the windows only for what they still promise.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, LEDGER_BOUNDARY_VERSION } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import { planWindows, WINDOW_SETTINGS } from '../src/windows.js';

const textsSession = (texts) => {
  const blobs = Object.fromEntries(texts.map((text, index) => [`b${index}`, text]));
  const events = texts.map((text, index) => ({
    id: `E${index}`, sequence: index, kind: 'commentary', phase: 'working',
    text: [{ sourceKey: `b${index}`, fromByte: 0, untilByte: Buffer.byteLength(text) }],
  }));
  return new Session({ sessionKey: 'synthetic-r2', events, blobs });
};

const ledger = () => ({
  ask: [{ turn: 1, text: 'Use the existing cache.' }, { turn: 2, text: 'Check its failure path.' }],
  ledger: [
    { turn: 1, seq: 0, kind: 'test', cmd: 'synthetic-test', outcome: 'passed', tailLines: ['OK'] },
    { turn: 2, seq: 0, kind: 'test', cmd: 'synthetic-failure-test', outcome: 'failed', tailLines: ['Failed'] },
  ],
  commentary: [
    { turn: 1, beforeEvent: 0, text: 'Checking the existing implementation.' },
    { turn: 2, beforeEvent: 99, text: 'The failure path needs follow-up.' },
  ],
  sayings: [{ turn: 1, text: 'The first check passed.' }, { turn: 2, text: 'The second check failed.' }],
  marks: [],
});

test('R2 adapts compaction marks after their recorded turn without changing evidence identities or text', () => {
  const input = ledger();
  const original = sessionFromLedger(input);
  input.marks = [{ turn: 1, kind: 'compaction' }];
  const adapted = sessionFromLedger(input);
  const boundaryIndex = adapted.events.findIndex((event) => event.kind === 'boundary');
  assert.equal(adapted.events[boundaryIndex - 1].id, 'F1');
  assert.equal(adapted.events[boundaryIndex + 1].id, 'I2');
  const work = adapted.events.filter((event) => event.kind !== 'boundary');
  assert.deepEqual(work.map((event) => event.id), original.events.map((event) => event.id));
  assert.deepEqual(work.map((event) => adapted.sourcesFor(event)),
    original.events.map((event) => original.sourcesFor(event)));
  assert.deepEqual(adapted.events.map((event) => event.sequence), adapted.events.map((_, index) => index));
  assert.deepEqual(adapted.adapterSegmentation, {
    version: LEDGER_BOUNDARY_VERSION, compactionMarks: 1, emittedCompactions: 1,
    unlocatedCompactions: 0, outOfRangeCompactions: 0, position: 'after-turn', positionPrecision: 'turn',
  });
  // M35: a compaction is no window boundary — the two short segments are one window, every event in it once.
  const windows = planWindows(adapted);
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].events.map((event) => event.id), adapted.events.map((event) => event.id));
  assert.deepEqual(windows[0].segments.map((segment) => segment.start), ['I1', 'I2']);
});

test('R2 keeps duplicate, initial and final compaction records without empty or misnumbered windows', () => {
  const input = ledger();
  input.marks = [
    { turn: 0, kind: 'compaction' }, { turn: 1, kind: 'compaction' },
    { turn: 1, kind: 'compaction' }, { turn: 2, kind: 'compaction' },
    { turn: 2, kind: 'interrupt' },
  ];
  const adapted = sessionFromLedger(input);
  assert.equal(adapted.events.filter((event) => event.kind === 'boundary').length, 4);
  const windows = planWindows(adapted);
  assert.deepEqual(windows.map((window) => window.index), [0]);
  assert.deepEqual(windows[0].events.filter((event) => event.kind === 'boundary').map((event) => event.id),
    ['B0-0', 'B1-1', 'B1-2', 'B2-3'], 'every compaction rides in its window, none splits it');
});

test('R2 retains mark-only and final-message-only turns and declares unlocated malformed marks', () => {
  const adapted = sessionFromLedger({
    sayings: [{ turn: 3, text: 'Synthetic final-only record.' }],
    marks: [{ turn: 2, kind: 'compaction' }, { turn: -1, kind: 'compaction' },
      { turn: '3', kind: 'compaction' }, { kind: 'compaction' }, { turn: 4, kind: 'notification' }],
  });
  assert.deepEqual(adapted.events.map((event) => event.id), ['B2-0', 'F3']);
  assert.equal(adapted.textOf(adapted.event('F3')), 'Synthetic final-only record.');
  assert.equal(adapted.adapterSegmentation.unlocatedCompactions, 3);
  assert.ok(adapted.adapterGaps.some((gap) => gap.code === 'unsupported_message' && gap.count === 3));
});

test('R2 empty or boundary-only sessions produce no phantom model-call window', () => {
  assert.deepEqual(planWindows(textsSession([])), []);
  const session = textsSession([]);
  session.events = [{ id: 'B', kind: 'boundary', boundary: 'compaction', sequence: 0 }];
  assert.deepEqual(planWindows(session), []);
});

for (const workTokens of [0, -1, 1.5, Infinity, NaN, '8', Number.MAX_SAFE_INTEGER + 1]) {
  test(`R2, M35 rejects an invalid work budget ${String(workTokens)}`, () => {
    assert.throws(() => planWindows(textsSession(['text']), { ...WINDOW_SETTINGS, workTokens }), RangeError);
  });
}
