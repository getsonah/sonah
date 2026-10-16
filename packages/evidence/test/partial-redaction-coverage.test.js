import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { instructionReviewScope } from '../src/ledger.js';
import { buildEvents } from '../../slicer/src/events.js';

const PEM = [
  `-----BEGIN RSA PRI${'VATE'} KEY-----`,
  'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy2l1Ce0Y2pMtE2zSo9lY2b',
  `-----END RSA PRI${'VATE'} KEY-----`,
].join('\n');
const source = (over = {}) => ({ ask: [{ turn: 1, text: 'Fix the parser.' }], ledger: [],
  claim: { finalMessage: '' }, dropped: [], ...over });
// D90 (owner decision 2026-10-15, privacy is not a design constraint): no Sonah masks or drops a recorded text now, but
// a ledger an earlier Sonah redacted is still read as it was written. Each `persisted…` ledger below is literally what
// that redactor wrote for the text named beside it: its note in place of a dropped key block, its mark in place of a
// masked value, the counts and flags it declared.
const NOTE = '[… 3 line(s) dropped: private key block …]';
/** `Never use\n<key block>\nRedis here.` as an ask, after the earlier redactor. */
const persistedPemAsk = () => source({ ask: [{ turn: 1, text: `Never use\n${NOTE}\nRedis here.`, redacted: true,
  redactedLines: 3 }] });

test('a partial PEM cut leaves visible instruction spans but cannot certify full authority or a bridge quote', () => {
  // D90: today's redaction keeps the key block as recorded; the ledger an earlier one wrote is read below.
  assert.equal(redact(source({ ask: [{ turn: 1, text: `Never use\n${PEM}\nRedis here.` }] })).ledger.ask[0].text,
    `Never use\n${PEM}\nRedis here.`);
  const { ledger } = redact(persistedPemAsk());
  assert.ok(ledger.ask[0].redactedLines > 0);
  assert.match(ledger.ask[0].text, /line\(s\) dropped/);
  const session = sessionFromLedger(ledger);
  const instruction = session.event('I1');
  const spans = session.textSpansOf(instruction);
  assert.equal(spans.length, 2);
  assert.equal(instruction.omitted, true);
  assert.equal(instruction.redacted, true);
  assert.equal(verifyReceipt(session, { eventId: 'I1', role: 'instruction', quote: 'use\nRedis' }).ok, false);
  assert.equal(verifyReceipt(session, { eventId: 'I1', role: 'instruction', quote: 'Never use' }).ok, true);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions'));
  const inventory = instructionReviewScope(session);
  assert.equal(inventory.complete, false);
  assert.deepEqual(inventory.instructions[0].spans, spans);
});

test('partially redacted working commentary declares T loss and cannot bridge the dropped block', () => {
  const { ledger } = redact(source({ commentary: [{ turn: 1, beforeEvent: 0,
    text: `Do not deploy\n${NOTE}\nuntil tests pass.`, redactedLines: 3 }] }));
  assert.ok(ledger.commentary[0].redactedLines > 0);
  const session = sessionFromLedger(ledger);
  const commentary = session.events.find((event) => event.kind === 'commentary');
  assert.equal(session.textSpansOf(commentary).length, 2);
  assert.equal(verifyReceipt(session, { eventId: commentary.id, role: 'commentary',
    quote: 'deploy\nuntil tests' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'commentary'));
});

test('an inline redaction marker is neither instruction text nor a bridge between its sides', () => {
  const session = sessionFromLedger(source({ ask: [{ turn: 1,
    text: 'Use ‹redacted:secret-value› Redis', redacted: true }] }));
  const instruction = session.event('I1');
  assert.equal(session.textSpansOf(instruction).length, 2);
  assert.equal(verifyReceipt(session, { eventId: 'I1', role: 'instruction',
    quote: '‹redacted:secret-value›' }).ok, false);
  assert.equal(verifyReceipt(session, { eventId: 'I1', role: 'instruction',
    quote: 'Use  Redis' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions'));
});

test('generic redaction masks split human and command evidence and declare their channels', () => {
  const { ledger } = redact(source({ ask: [{ turn: 1, text: 'Please set API_TOKEN=‹redacted› today.', redacted: true }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'echo API_TOKEN=‹redacted›', outcome: 'passed' }],
    dropped: [{ turn: 1, reason: 'redacted:assigned-secret', where: 'ask' },
      { turn: 1, reason: 'redacted:assigned-secret', where: 'cmd' }] }));
  assert.match(ledger.ask[0].text, /‹redacted›/);
  const session = sessionFromLedger(ledger);
  assert.equal(session.textSpansOf(session.event('I1')).length, 2);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions'));
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'actions'));
  assert.equal(verifyReceipt(session, { eventId: 'A1-0', role: 'action',
    quote: '‹redacted›' }).ok, false);
});

test('redacted tool output retains two separate quotable spans and declares O loss', () => {
  const { ledger } = redact(source({ ledger: [{ turn: 1, seq: 0, kind: 'bash',
    cmd: 'node --test', outcome: 'passed', tailLines: ['Never use', NOTE, 'Redis here.'], redacted: true }],
  dropped: [{ turn: 1, reason: 'redacted:secret-key-value', where: 'tailLines' },
    { turn: 1, reason: 'dropped:pem-block', where: 'tailLines' }] }));
  const session = sessionFromLedger(ledger);
  const observation = session.event('A1-0-r');
  assert.equal(session.textSpansOf(observation, 'output').length, 2);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'use\nRedis' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('a masked written body declares a code gap while keeping its visible source', () => {
  const { ledger } = redact(source({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'src/config.js',
    after: { text: 'export const API_TOKEN=‹redacted:secret-value›', truncated: false } }],
  dropped: [{ turn: 1, reason: 'redacted:secret-key-value', where: 'after' }] }));
  const session = sessionFromLedger(ledger);
  const write = session.event('A1-0');
  assert.equal(write.changes[0].redacted, true);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'code'));
  assert.equal(verifyReceipt(session, { eventId: write.id, role: 'code',
    quote: '‹redacted:secret-value›' }).ok, false);
});

test('ordinary multiline output survives the recorder and remains quotable', () => {
  const output = Array.from({ length: 60 }, (_, index) => `line ${index}: ${'x'.repeat(24)}`).join('\n');
  const call = { kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'node --test' } }] } } };
  const result = { kind: 'user', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call-1', content: output }] } } };
  const built = buildEvents([call, result]);
  assert.equal(built.events[0].tailClipped, undefined);
  assert.equal(built.events[0].tailLines.join('\n'), output);
  const { ledger } = redact(source({ ledger: built.events }));
  const session = sessionFromLedger(ledger);
  assert.equal(session.adapterGaps.some((gap) => gap.channel === 'observations' && gap.code === 'source_clipped'), false);
  // C-01 event identity: the command's result, found by what it is (the session's one observation).
  const observation = session.events.find((event) => event.kind === 'observation').id;
  assert.equal(verifyReceipt(session, { eventId: observation, role: 'observation', quote: 'line 30:' }).ok, true);
});

test('a large tool output remains whole below the review window budget', () => {
  const output = Array.from({ length: 300 }, (_, index) => index === 150
    ? 'MIDDLE-SYNTHETIC-RECEIPT' : `line ${index}: ${'x'.repeat(490)}`).join('\n');
  const call = { kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: [
    { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'node --test' } }] } } };
  const result = { kind: 'user', raw: { type: 'user', message: { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call-1', content: output }] } } };
  const built = buildEvents([call, result]);
  assert.equal(built.events[0].tailLines.join('\n'), output);
  assert.equal(built.events[0].tailClipped, undefined);
  const { ledger } = redact(source({ ledger: built.events }));
  const session = sessionFromLedger(ledger);
  assert.equal(session.adapterGaps.some((gap) => gap.channel === 'observations'
    && gap.code === 'source_clipped'), false);
  assert.equal(session.adapterGaps.some((gap) => gap.code === 'command_outcome_unknown'), true,
    'the complete output does not establish the command exit status');
  assert.equal(verifyReceipt(session, { eventId: session.events.find((event) => event.kind === 'observation').id,
    role: 'observation', quote: 'MIDDLE-SYNTHETIC-RECEIPT' }).ok, true);
});

test('a historical recorder-clipped output cannot ground a quote across its omitted middle', () => {
  const { ledger } = redact(source({ ledger: [{ turn: 1, seq: 0, kind: 'test',
    cmd: 'node --test', outcome: 'unknown', tailClipped: true,
    tailLines: ['GO', '[… output omitted by recorder …]', 'STOP'] }] }));
  const session = sessionFromLedger(ledger);
  const observation = session.event('A1-0-r');
  assert.equal(session.textSpansOf(observation, 'output').length, 2);
  assert.equal(verifyReceipt(session, { eventId: observation.id, role: 'observation',
    quote: 'GO\n[… output omitted by recorder …]\nSTOP' }).ok, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations' && gap.code === 'source_clipped'));
});
