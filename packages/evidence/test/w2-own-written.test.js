// W2 (owner decision 2026-10-13; root cause 1): for claims about the agent's own work, the
// settling evidence is often text the agent itself wrote, which no contradiction source admitted (an edit's added lines
// were "never recorded file content"). The new source `own_written` is the text the claim actor's own edit or write
// added — its added hunk lines or the body it wrote, never its removed or context lines (those stay `file_content`) —
// when that edit or write ran to a recorded success and was recorded before the statement. A later change to the same
// typed path, not recorded as failed, withholds it (`source_rewritten`). A statement written into a file may cite such
// text too (role code, where the session-only contract admits it). Code reads structure only: the cited event, the
// region that holds the quote, the actor, the typed outcome and the recorded order.
//
// Synthetic sessions and synthetic judges only: no recording, no model call. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { contradictionSourceOf, codeContradictionSource, ownWrittenCheck, samePathChangedBetween, findingReceiptCheck,
  CONTRADICTION_SOURCES, CONTRADICTION_ROLES, CONTRADICTION_RECEIPT_ROLES, WITHHELD_REJECTION_CAUSES,
  WRITTEN_CONTRADICTION_REJECTIONS } from '../src/ledger.js';
import { readWrittenStatement, publishedStatement, writtenShape, writeActionOf, windowSourceMap } from '../src/written.js';
import { runReview, OWN_WRITTEN_TITLE, CONTRADICTION_TITLES } from '../src/run-review.js';
import { SESSION_NARRATIVE_SCHEMA } from '../src/prompt.js';
import { CHECKLIST_CONTRADICTION_WORDS } from '../src/review.js';
import { REPORT_CONTRADICTION_SOURCES } from '../../render/report-words.js';

const TEXT = {
  ask: 'SYNTHETIC_W2O_ASK: add a test for parse and tell me what it covers.',
  test: "test('top level', () => {\n  assert.equal(parse('a'), 'a');\n});\n",
  comment: '// SYNTHETIC_W2O_COMMENT: this test covers nested input.\n',
  other: 'export const other = 1;\n',
  said: 'SYNTHETIC_W2O_SAID: The new test covers nested input.',
};
const QUOTE = "assert.equal(parse('a'), 'a');";
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const ask = () => ({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 });
const said = (over = {}) => ({ id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'),
  ...T1, ...over });
/** A write of `path` whose body is TEXT[key], with its own typed terminal result. */
const write = (id, path, key, { result = 'succeeded', operation = 'write', childId, hunks } = {}) => [
  { id, kind: 'invocation', callKey: id, tool: operation, operation, paths: [{ path }], command: [], input: [],
    changes: [{ path, before: [], after: whole(key), diff: [], extent: { chars: TEXT[key].length, lines: 3,
      truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }],
    ...(hunks ? { recorded: { hunks } } : {}), ...(childId ? { childId } : {}), ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result, terminalStatusProven: true,
    output: [], sourceOfResult: 'native', ...(childId ? { childId } : {}), ...T1 }];
const sessionOf = (events) => new Session({ sessionKey: 'sess-w2-own', adapter: 'claude', blobs: { ...TEXT },
  events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const stated = receipt('C1', 'commentary', 'The new test covers nested input.');
const against = receipt('W1', 'code', QUOTE);
const sourceOf = (events, cited = against) => contradictionSourceOf(sessionOf(events), [stated, cited]);

test('W2 own_written: the closed words — one more source on role code, one more withheld cause, each said', () => {
  assert.deepEqual(CONTRADICTION_SOURCES, ['result', 'human_message', 'file_content', 'project_instructions',
    'own_written']);
  assert.equal(CONTRADICTION_ROLES.own_written, 'code');
  // A contract lists each role once: the session-only claim contract's bytes did not move.
  assert.deepEqual(CONTRADICTION_RECEIPT_ROLES, ['observation', 'instruction', 'code', 'project-instructions']);
  assert.deepEqual(SESSION_NARRATIVE_SCHEMA.properties.claims.items.properties.contradictedBy.properties.role,
    { enum: ['observation', 'instruction', 'code', 'project-instructions'] });
  assert.equal(WITHHELD_REJECTION_CAUSES.at(-1), 'source_rewritten');
  assert.deepEqual(WRITTEN_CONTRADICTION_REJECTIONS.slice(3, 5), ['not_own_written', 'source_rewritten']);
  // Every reader has words for it.
  assert.equal(CHECKLIST_CONTRADICTION_WORDS.own_written, 'What the agent itself wrote contradicts it');
  // D97: the page's words for what contradicts a claim, one per source.
  assert.deepEqual(Object.keys(REPORT_CONTRADICTION_SOURCES), [...CONTRADICTION_SOURCES]);
  assert.equal(REPORT_CONTRADICTION_SOURCES.own_written, 'What the agent wrote');
  assert.notEqual(OWN_WRITTEN_TITLE, CONTRADICTION_TITLES.code);
});

test('W2 own_written: the text the claim actor\'s own completed write added, recorded before the words', () => {
  const base = [ask(), ...write('W1', 'test/parse.test.js', 'test')];
  assert.deepEqual(sourceOf([...base, said()]), { ok: true, source: 'own_written' });
  // A later write of another path, a later change of the same path recorded as failed, or one recorded after the words
  // changes nothing.
  assert.equal(sourceOf([...base, ...write('W2', 'src/other.js', 'other'), said()]).source, 'own_written');
  assert.equal(sourceOf([...base, ...write('W2', 'test/parse.test.js', 'other', { result: 'failed' }), said()]).source,
    'own_written');
  assert.equal(sourceOf([...base, said(), ...write('W2', 'test/parse.test.js', 'other')]).source, 'own_written');
  // The region decides before any check runs (a candidate's words and title).
  assert.equal(codeContradictionSource(sessionOf([...base, said()]), against), 'own_written');
});

test('W2 own_written: rewritten, another actor\'s, failed, later or not added text is withheld by its cause', () => {
  const base = [ask(), ...write('W1', 'test/parse.test.js', 'test')];
  const cause = (events, cited) => sourceOf(events, cited).cause;
  // A later non-failed change to the same typed path, before the words: the file may no longer hold the text.
  assert.equal(cause([...base, ...write('W2', 'test/parse.test.js', 'other', { operation: 'edit' }), said()]),
    'source_rewritten');
  assert.equal(cause([...base, ...write('W2', 'test/parse.test.js', 'other', { result: 'unknown' }), said()]),
    'source_rewritten', 'an outcome code cannot read is no failure');
  // The write is a helper's, the statement the main agent's.
  assert.equal(cause([ask(), ...write('W1', 'test/parse.test.js', 'test', { childId: 'helper-1' }), said()]),
    'source_not_file_content');
  // The write did not run to a recorded success.
  assert.equal(cause([ask(), ...write('W1', 'test/parse.test.js', 'test', { result: 'failed' }), said()]),
    'source_not_file_content');
  // Recorded after the words.
  assert.equal(cause([ask(), said(), ...write('W1', 'test/parse.test.js', 'test')]), 'source_not_before');
  // A quote the write did not add.
  assert.equal(cause([...base, said()], receipt('W1', 'code', 'SYNTHETIC_NOT_WRITTEN')), 'source_not_file_content');
  // The removed or context lines of an edit that ran stay file_content, whoever reads them.
  const hunks = [{ oldStart: 1, newStart: 1, lines: [' function parse(s) {', `-${QUOTE}`, '+  return s;', ' }'] }];
  const edited = [ask(), ...write('W1', 'src/parse.js', 'test', { operation: 'edit', hunks }), said()];
  assert.equal(codeContradictionSource(sessionOf(edited), receipt('W1', 'code', ' function parse(s) {')), 'file_content');
  assert.equal(sourceOf(edited, receipt('W1', 'code', 'function parse(s) {')).source, 'file_content');
  // Its added hunk lines are the agent's own text.
  assert.equal(sourceOf(edited, receipt('W1', 'code', 'return s;')).source, 'own_written');
});

test('W2 own_written: the same-path check reads typed changes, and fails closed on what it cannot read', () => {
  const session = sessionOf([ask(), ...write('W1', 'a.js', 'test'), ...write('W2', 'a.js', 'other'), said()]);
  const w1 = session.event('W1');
  assert.equal(samePathChangedBetween(session, w1, ['a.js'], session.event('C1').sequence), true);
  assert.equal(samePathChangedBetween(session, w1, ['b.js'], session.event('C1').sequence), false);
  assert.equal(samePathChangedBetween(session, w1, [null], session.event('C1').sequence), true, 'a path it cannot read');
  const unordered = sessionOf([ask(), ...write('W1', 'a.js', 'test'), ...write('W2', 'a.js', 'other'), said()]);
  delete unordered.event('W2').sequence;
  assert.equal(samePathChangedBetween(unordered, unordered.event('W1'), ['a.js'], 99), true, 'an order it cannot read');
  assert.equal(ownWrittenCheck(session, against, [session.event('C1')], { said: session.event('C1').sequence }),
    'source_rewritten');
});

test('W2 own_written: a claim the agent\'s own test contradicts is published under its own source and title', async () => {
  const session = sessionOf([ask(), ...write('W1', 'test/parse.test.js', 'test'), said()]);
  const answer = { decisions: [], pivots: [], requirements: [], claims: [{ text: 'The test covers nested input.',
    stated, contradictedBy: against }] };
  const asked = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', judge: async (request) => {
    if (!request.challenge) return structuredClone(answer);
    asked.push(...request.challenge.items);
    return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
      receipts: [against] })) };
  } });
  assert.ok(asked.some((item) => item.type === 'claim' && item.candidate.contradictedBy?.eventId === 'W1'));
  const finding = report.findings.find((f) => f.kind === 'claim_contradicted');
  assert.equal(finding.contradictionSource, 'own_written');
  assert.ok(finding.title.startsWith(OWN_WRITTEN_TITLE));
  assert.equal(report.counts.checklist.contradictions.own_written, 1);
  // The same claim with the test rewritten before the words: withheld, never published.
  const rewritten = sessionOf([ask(), ...write('W1', 'test/parse.test.js', 'test'),
    ...write('W2', 'test/parse.test.js', 'other', { operation: 'edit' }), said()]);
  const again = await runReview({ session: rewritten, pr: null, reviewScope: 'session-only', judge: async (request) => (
    !request.challenge ? structuredClone(answer) : { votes: request.challenge.items.map((item) => ({ key: item.key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [against] })) }) });
  assert.equal(again.findings.filter((f) => f.kind === 'claim_contradicted').length, 0);
  assert.deepEqual(again.rejectedFindings.map((r) => [r.reason, r.cause]), [['receipt_rejected', 'source_rewritten']]);
});

test('W2 own_written: a written statement may cite the agent\'s own earlier written text, where the contract admits code', () => {
  const statement = { text: 'The comment says the test covers nested input.',
    stated: receipt('W2', 'code', 'this test covers nested input.'), contradictedBy: against };
  const events = [ask(), ...write('W1', 'test/parse.test.js', 'test'), ...write('W2', 'test/notes.js', 'comment')];
  const session = sessionOf(events);
  const sourceMap = windowSourceMap(session, { events: session.events });
  const roles = ['observation', 'code'];
  const read = readWrittenStatement(statement, { session, sourceMap, roles });
  assert.deepEqual([read.contradiction.eventId, read.contradiction.quote, read.source], ['W1', QUOTE, 'own_written']);
  const { record } = publishedStatement({ host: 'github.com', id: '0' }, read, 'upheld');
  assert.deepEqual([record.label, record.contradictionSource], ['contradicted', 'own_written']);
  // D97: the readers say what contradicts it by that source (report-words.js REPORT_CONTRADICTION_SOURCES).
  assert.equal(REPORT_CONTRADICTION_SOURCES[record.contradictionSource], 'What the agent wrote');
  // Not upheld: no source on the record, so a reader says nothing about it.
  assert.equal(publishedStatement({ host: 'github.com', id: '0' }, read, 'refuted').record.contradictionSource, undefined);
  // Where the contract admits only a RESULT (the combined route's), the statement is unreadable as before.
  assert.equal(writtenShape(statement), false);
  assert.deepEqual(readWrittenStatement(statement, { session, sourceMap }), { withheld: 'written_unreadable' });
  // Recorded after the statement's write, or rewritten before it: refused by its closed reason.
  const later = sessionOf([ask(), ...write('W2', 'test/notes.js', 'comment'), ...write('W1', 'test/parse.test.js', 'test')]);
  assert.equal(readWrittenStatement(statement, { session: later, sourceMap: windowSourceMap(later, { events: later.events }),
    roles }).ignored, 'not_own_written');
  const rewritten = sessionOf([ask(), ...write('W1', 'test/parse.test.js', 'test'),
    ...write('W3', 'test/parse.test.js', 'other', { operation: 'edit' }), ...write('W2', 'test/notes.js', 'comment')]);
  assert.equal(readWrittenStatement(statement, { session: rewritten,
    sourceMap: windowSourceMap(rewritten, { events: rewritten.events }), roles }).ignored, 'source_rewritten');
  assert.equal(writeActionOf(session, 'W1'), session.event('W1'), 'one definition of a write, re-exported');
});

test('W2 own_written: the combined route\'s contradiction check is unchanged: only a RESULT, without the session route\'s flag', () => {
  const session = sessionOf([ask(), ...write('W1', 'test/parse.test.js', 'test'), said()]);
  assert.equal(findingReceiptCheck(session, 'claim_contradicted', [stated, against]).cause, 'role_missing');
});
