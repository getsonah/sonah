// Synthetic regression for the C-05 rule: one quote must come from one uninterrupted source
// span. The adapter deliberately keeps both sides of elision/redaction/truncation as separate
// TextRefs. Joining them for a prompt or verifier used to invent words at their seam.

import test from 'node:test';
import assert from 'node:assert/strict';
import { Session, verifyReceipt, repairReceipt } from '../src/session.js';
import { repairQuote } from '../src/receipt-repair.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { planWindows } from '../src/windows.js';
import { groundFinding } from '../src/ledger.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

const utf8 = (text) => Buffer.byteLength(text, 'utf8');
const ref = (key, start, end, blob) => ({ sourceKey: key,
  fromByte: utf8(blob.slice(0, start)), untilByte: utf8(blob.slice(0, end)) });
const fenced = (text) => [...text.matchAll(/<<<\n([\s\S]*?)\n>>>/g)].map((match) => match[1]);

function splitSession() {
  const left = 'Never use ';
  const right = 'Redis here.';
  const marker = '[attachment, 3 lines, 20 chars]';
  const blob = left + marker + right;
  const refs = [ref('body', 0, left.length, blob),
    ref('body', left.length + marker.length, blob.length, blob)];
  const events = [
    { id: 'I1', kind: 'instruction', authority: 'human', omitted: true, sequence: 0, text: refs },
    { id: 'C1', kind: 'commentary', phase: 'working', sequence: 1, text: refs },
    { id: 'A1', kind: 'invocation', tool: 'Write', operation: 'write', sequence: 2,
      paths: [{ path: 'src/config.js' }], command: refs,
      changes: [{ path: 'src/config.js', after: refs, before: [],
        extent: { recorded: true, redactedLines: 1 } }] },
    { id: 'O1', kind: 'observation', invocation: 'A1', phase: 'terminal', result: 'succeeded',
      sequence: 3, output: refs },
  ];
  return new Session({ sessionKey: 'disjoint', blobs: { body: blob }, events });
}

test('every role grounds only within a surviving span, never across the removed interval', () => {
  const session = splitSession();
  const roles = [
    ['I1', 'instruction'], ['C1', 'commentary'], ['A1', 'action'],
    ['A1', 'code'], ['O1', 'observation'],
  ];
  for (const [eventId, role] of roles) {
    const receipt = (quote) => ({ eventId, role, quote });
    assert.equal(verifyReceipt(session, receipt('use Redis')).ok, false, `${role} joined a hole`);
    assert.equal(repairReceipt(session, receipt('use Redis')).ok, false, `${role} repaired a hole`);
    assert.equal(verifyReceipt(session, receipt('Never use')).ok, true, `${role} lost its left span`);
    assert.equal(verifyReceipt(session, receipt('Redis here')).ok, true, `${role} lost its right span`);
  }
  assert.deepEqual(session.textSpanInfoOf(session.event('I1')), {
    spans: ['Never use ', 'Redis here.'], complete: false,
  });
  assert.deepEqual(session.sourcesFor(session.event('I1')),
    [{ role: 'instruction', text: 'Never use ' }, { role: 'instruction', text: 'Redis here.' }]);
});

test('the model sees two fences and the source map preserves the same two regions', () => {
  const session = splitSession();
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: planWindows(session)[0] });
  const spans = fenced(evidencePrompt);
  assert.ok(spans.includes('Never use '));
  assert.ok(spans.includes('Redis here.'));
  assert.ok(!spans.some((span) => span.includes('use Redis')), 'no citable fence crosses the cut');
  assert.match(evidencePrompt, /source gap: quote the surviving regions separately/);
  for (const eventId of ['I1', 'C1', 'O1']) {
    assert.deepEqual(sourceMap[eventId].map((source) => source.text), ['Never use ', 'Redis here.']);
  }
  // M36 phase 2 (C-07 "M36 window format"): a window lists the code it shows — the written body's two regions; a change
  // with no before side shows none (it used to list an empty source for it, which grounded nothing).
  assert.deepEqual(sourceMap.A1.filter((source) => source.role === 'code').map((source) => source.text),
    ['Never use ', 'Redis here.']);
});

test('a later window receives surviving instruction spans without a fabricated inventory join', () => {
  const source = splitSession();
  const session = new Session({ sessionKey: source.sessionKey, blobs: source.blobs,
    events: [source.event('I1'),
      { id: 'B1', kind: 'boundary', sequence: 1, boundary: 'compaction' },
      { id: 'C2', kind: 'commentary', phase: 'working', sequence: 2,
        text: [{ sourceKey: 'body', fromByte: 0, untilByte: 9 }] }] });
  // M35: a compaction splits nothing, so the later window is built by hand: the events after the instruction.
  assert.equal(planWindows(session).length, 1);
  const later = { index: 1, events: session.events.slice(1) };
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: later });
  assert.match(evidencePrompt, /complete: false/);
  assert.deepEqual(sourceMap.I1.map((source) => source.text), ['Never use ', 'Redis here.']);
  const spans = fenced(evidencePrompt);
  assert.ok(spans.includes('Never use '));
  assert.ok(spans.includes('Redis here.'));
  assert.ok(!spans.some((span) => span.includes('use Redis')));
});

test('word-dropping repair cannot turn a bridge quote into a one-sided receipt', () => {
  const left = 'ban ';
  const right = 'using Redis cache in the production request path';
  const marker = '[…]';
  const blob = left + marker + right;
  const event = { id: 'C1', kind: 'commentary', phase: 'working', sequence: 0,
    text: [ref('body', 0, left.length, blob),
      ref('body', left.length + marker.length, blob.length, blob)] };
  const session = new Session({ sessionKey: 'near-miss-gap', blobs: { body: blob }, events: [event] });
  const quote = left + right;
  const receipt = { eventId: 'C1', role: 'commentary', quote };
  assert.equal(verifyReceipt(session, receipt).ok, false);
  assert.equal(repairQuote([left, right], quote, 4, { disjointGroups: [[left, right]] }), null);
  assert.equal(repairReceipt(session, receipt).ok, false);
  // A real near miss wholly inside one side still repairs to a single exact source span.
  const valid = repairReceipt(session, { ...receipt, quote: `${right},` });
  assert.equal(valid.ok, true);
  assert.equal(valid.receipt.quote, right);
});

test('repair rejects a model-inserted space at a gap that originally had no space', () => {
  const left = 'ban';
  const right = 'using Redis cache in the production request path';
  const blob = `${left}[…]${right}`;
  const event = { id: 'C1', kind: 'commentary', phase: 'working', sequence: 0,
    text: [ref('body', 0, left.length, blob), ref('body', left.length + 3, blob.length, blob)] };
  const session = new Session({ sessionKey: 'space-gap', blobs: { body: blob }, events: [event] });
  assert.equal(repairReceipt(session, { eventId: 'C1', role: 'commentary',
    quote: `${left} ${right}` }).ok, false);
});

test('touching UTF-8 TextRefs form one source; malformed refs fail closed even with one survivor', () => {
  const blob = 'Finish 🙂 safely.';
  const split = 'Finish 🙂'.length;
  const first = ref('utf8', 0, split, blob);
  const second = ref('utf8', split, blob.length, blob);
  const adjacent = { id: 'C1', kind: 'commentary', phase: 'working', sequence: 0,
    text: [first, second] };
  const session = new Session({ sessionKey: 'utf8', blobs: { utf8: blob }, events: [adjacent] });
  assert.deepEqual(session.textSpanInfoOf(adjacent), { spans: [blob], complete: true });
  assert.equal(verifyReceipt(session, { eventId: 'C1', role: 'commentary', quote: 'Finish 🙂 safely' }).ok, true);

  const malformed = { ...adjacent, text: [first, { sourceKey: 'missing', fromByte: 0, untilByte: 4 }, second] };
  const broken = new Session({ sessionKey: 'utf8', blobs: { utf8: blob }, events: [malformed] });
  assert.deepEqual(broken.textSpanInfoOf(malformed), {
    spans: ['Finish 🙂', ' safely.'], complete: false,
  });
  assert.equal(verifyReceipt(broken, { eventId: 'C1', role: 'commentary', quote: 'Finish 🙂 safely' }).ok, false);
  assert.equal(verifyReceipt(broken, { eventId: 'C1', role: 'commentary', quote: ' safely.' }).ok, true);
});

test('synthetic redaction marks remain uncitable even in one ref; ordinary Unicode remains exact', () => {
  const blob = 'Use “résumé 🙂” and ‹redacted:api-key› today.\n[… 1 line(s) dropped: key block …]';
  const event = { id: 'C1', kind: 'commentary', phase: 'working', sequence: 0,
    text: [ref('body', 0, blob.length, blob)] };
  const session = new Session({ sessionKey: 'inline-mask', blobs: { body: blob }, events: [event] });
  const receipt = (quote) => ({ eventId: 'C1', role: 'commentary', quote });
  assert.deepEqual(session.textSpansOf(event), ['Use “résumé 🙂” and ', ' today.']);
  assert.equal(verifyReceipt(session, receipt('“résumé 🙂”')).ok, true);
  assert.equal(verifyReceipt(session, receipt('‹redacted:api-key›')).ok, false);
  assert.equal(verifyReceipt(session, receipt('redacted:api-key')).ok, false);
  assert.equal(verifyReceipt(session, receipt('and ‹redacted:api-key› today')).ok, false);
  assert.equal(verifyReceipt(session, receipt('[… 1 line(s) dropped: key block …]')).ok, false);
  assert.equal(verifyReceipt(session, receipt('line(s) dropped: key block')).ok, false);
  assert.equal(repairReceipt(session, receipt('and ‹redacted:api-key› today')).ok, false);
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: planWindows(session)[0] });
  assert.ok(!fenced(evidencePrompt).some((span) => span.includes('redacted:api-key')
    || span.includes('line(s) dropped')));
  assert.deepEqual(sourceMap.C1.map((source) => source.text), ['Use “résumé 🙂” and ', ' today.']);
});

test('an adapted elided ask cannot ground a false finding from its joined head and tail', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Never use [code block, 2 lines, 20 chars]Redis here.',
      elided: [{ kind: 'code block', lines: 2, chars: 20 }] }],
    ledger: [], commentary: [], sayings: [], marks: [], dropped: [], claim: { finalMessage: '' },
  }, { sessionKey: 'adapted-elision' });
  const instruction = session.events.find((event) => event.kind === 'instruction');
  assert.ok(instruction);
  assert.deepEqual(session.textSpansOf(instruction), ['Never use ', 'Redis here.']);
  assert.equal(verifyReceipt(session, { eventId: instruction.id, role: 'instruction', quote: 'use Redis' }).ok, false);
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: planWindows(session)[0] });
  assert.ok(!fenced(evidencePrompt).some((span) => span.includes('use Redis')));
  assert.deepEqual(sourceMap[instruction.id].map((source) => source.text), ['Never use ', 'Redis here.']);

  const code = splitSession();
  const finding = groundFinding({ repo: { host: 'github.com', id: '1' }, session: code,
    pr: { files: [{ path: 'src/config.js' }] }, candidate: {
      kind: 'code_issue', title: 'Synthetic cross-gap claim', explanation: 'A test fixture only.',
      receipts: [{ eventId: 'A1', role: 'code', quote: 'use Redis' }],
    } });
  assert.equal(finding.ok, false);
  assert.equal(finding.reason, 'receipt_rejected');
});

test('adapter splits inline redaction masks in visible commentary and written code', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Keep the two surviving spans visible.' }],
    commentary: [{ turn: 1, beforeEvent: 0, text: 'Before ‹redacted:api-key› after.', redactedLines: 0 }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'src/masked.js',
      after: { text: 'const before = 1; ‹redacted:api-key› const after = 2;', redactedLines: 0 },
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } }],
    sayings: [], marks: [], dropped: [], claim: { finalMessage: '' },
  }, { sessionKey: 'adapted-inline-mask' });
  const commentary = session.events.find((event) => event.kind === 'commentary');
  const invocation = session.events.find((event) => event.kind === 'invocation');
  assert.deepEqual(session.textSpansOf(commentary), ['Before ', ' after.']);
  assert.deepEqual(session.textSpansOf(invocation.changes[0], 'after'),
    ['const before = 1; ', ' const after = 2;']);
  assert.equal(verifyReceipt(session, { eventId: commentary.id, role: 'commentary', quote: 'Before  after' }).ok, false);
  assert.equal(verifyReceipt(session, { eventId: invocation.id, role: 'code', quote: '1;  const after' }).ok, false);
  assert.equal(verifyReceipt(session, { eventId: commentary.id, role: 'commentary', quote: 'Before ' }).ok, true);
  const { evidencePrompt, sourceMap } = buildNarrativePrompt({ session, window: planWindows(session)[0] });
  assert.ok(!fenced(evidencePrompt).some((span) => span.includes('redacted:api-key')));
  assert.deepEqual(sourceMap[commentary.id].map((source) => source.text), ['Before ', ' after.']);
});
