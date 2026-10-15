// The review of the W1-W3 fixes (2026-10-14), its low findings: four precision guards of W1 B and W2 could be removed
// with every test still passing, and the new W1 A / W2 vocabulary members were retyped as literals in several modules.
// One fixture per guard, each failing when its guard is removed, and the named constants pinned to their vocabularies.
// Every recording here is synthetic; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { Session } from '../src/session.js';
import { readForbiddenEdit } from '../src/forbidden.js';
import { readWrittenStatement, windowSourceMap } from '../src/written.js';
import { codeContradictionSource, contradictionSourceOf, projectFilesBefore, FORBIDDEN_EDIT_REJECTIONS,
  WRITTEN_CONTRADICTION_REJECTIONS, CONTRADICTION_SOURCES, WITHHELD_REJECTION_CAUSES, EVIDENCE_QUOTE_MAX,
  OWN_WRITTEN_SOURCE, FILE_CONTENT_SOURCE, SOURCE_REWRITTEN_CAUSE, SOURCE_NOT_FILE_CONTENT_CAUSE, RESTS_ON_REPAIRED,
  DECISION_RECOLUMN_RECORD, CHANGED_SINCE_LABEL as LEDGER_CHANGED_SINCE_LABEL } from '../src/ledger.js';
import { CHANGED_SINCE_LABEL } from '../src/claims.js';

// ---- W1 B: a project instruction file's edit -------------------------------------------------------------------------
const RULE = 'Never add a runtime dependency.';
const RULES = `# Project rules\n${RULE}`;
const PACKAGE = '{"name":"fmt","dependencies":{"left-pad":"1.3.0"}}\n';
const DEPENDENCY = '"left-pad":"1.3.0"';
const projectFile = () => row({ type: 'attachment', attachment: { type: 'instructions',
  files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } });
const fileRows = ({ twice = false } = {}) => [
  humanAsk('Add left-pad support to the formatter.'),
  projectFile(),
  ...(twice ? [said('Reading the project rules again.'), projectFile()] : []),
  call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency.'),
  result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
    content: PACKAGE, structuredPatch: [] }),
  said('Added left-pad support.'),
].map((r, i) => ({ ...r, uuid: `u-frg-${twice ? 'b' : 'a'}-${i + 1}` }));
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const fileEdit = (file, write) => ({ text: 'The project file forbids it; the agent added left-pad.',
  instruction: quote(file.id, 'project-instructions', RULE), violation: quote(write.id, 'code', DEPENDENCY) });
const mapOf = (file, write) => ({ [file.id]: [{ role: 'project-instructions', text: RULES }],
  [write.id]: [{ role: 'code', text: PACKAGE }] });

test('guard: a project file the window was not shown whole under its own id is not the rule an edit goes against',
  async (t) => {
    const { session } = await load(t, fileRows({ twice: true }));
    const write = session.events.find((e) => e.kind === 'invocation');
    const [first, repeat] = session.projectInstructions;
    assert.ok(repeat && repeat.afterSequence < write.sequence, 'recorded twice, both before the write');
    // The window shows the repeat as the earlier file, never whole under its own id: projectFilesBefore lists the first.
    assert.deepEqual(projectFilesBefore(session, [write]).map((f) => f.eventId), [first.id]);
    assert.ok(readForbiddenEdit(fileEdit(first, write), { session, sourceMap: mapOf(first, write) }).edit);
    assert.equal(readForbiddenEdit(fileEdit(repeat, write), { session, sourceMap: mapOf(repeat, write) }).withheld,
      FORBIDDEN_EDIT_REJECTIONS[11], 'not_after');
  });

test('guard: a project file a helper was given is never the person\'s instruction to the main agent', async (t) => {
  const { session } = await load(t, fileRows());
  const write = session.events.find((e) => e.kind === 'invocation');
  const [file] = session.projectInstructions;
  file.childId = 'synthetic-helper';
  assert.equal(readForbiddenEdit(fileEdit(file, write), { session, sourceMap: mapOf(file, write) }).withheld,
    FORBIDDEN_EDIT_REJECTIONS[1], 'instruction_not_human, by the cited file\'s actor, before any other check');
});

// ---- W2: the own_written source ----------------------------------------------------------------------------------------
const TEXT = {
  ask: 'SYNTHETIC_FRG_ASK: tidy parse and tell me what changed.',
  body: 'export function parse(s) {\n  return s; // trimmed\n}\n',
  long: `// ${'SYNTHETIC_FRG_LONG '.repeat(8)}covers nested input.\n`,
  note: '// SYNTHETIC_FRG_NOTE: the comment above covers nested input.\n',
  said: 'SYNTHETIC_FRG_SAID: parse no longer returns s.',
};
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
const T1 = { turn: 'T1' };
const write = (id, path, key, { operation = 'write', hunks } = {}) => [
  { id, kind: 'invocation', callKey: id, tool: operation, operation, paths: [{ path }], command: [], input: [],
    changes: [{ path, before: [], after: whole(key), diff: [], extent: { chars: TEXT[key].length, lines: 3,
      truncated: false, cap: null, recorded: true, redactedLines: 0, priorState: 'none' } }],
    ...(hunks ? { recorded: { hunks } } : {}), ...T1 },
  { id: `${id}-r`, kind: 'observation', invocation: id, callKey: id, phase: 'terminal', result: 'succeeded',
    terminalStatusProven: true, output: [], sourceOfResult: 'native', ...T1 }];
const sessionOf = (events) => new Session({ sessionKey: 'sess-frg', adapter: 'claude', blobs: { ...TEXT },
  events: events.map((event, sequence) => ({ ...event, sequence })), children: [] });
const ask = () => ({ id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), ...T1 });
const saidEvent = () => ({ id: 'C1', kind: 'commentary', phase: 'final', beforeInvocation: null, text: whole('said'),
  ...T1 });

test('guard: a quote in both an edit\'s replaced lines and its added lines is the file\'s recorded content', () => {
  // The removed line and the added line both hold `return s;`: the region the record shows replaced decides first.
  const hunks = [{ oldStart: 1, newStart: 1, lines: [' export function parse(s) {', '-  return s;',
    '+  return s; // trimmed', ' }'] }];
  const session = sessionOf([ask(), ...write('W1', 'src/parse.js', 'body', { operation: 'edit', hunks }), saidEvent()]);
  const cited = quote('W1', 'code', 'return s;');
  assert.equal(codeContradictionSource(session, cited), FILE_CONTENT_SOURCE);
  assert.deepEqual(contradictionSourceOf(session, [quote('C1', 'commentary', 'parse no longer returns s.'), cited]),
    { ok: true, source: FILE_CONTENT_SOURCE });
  // Only in the added line: the agent's own written text.
  assert.equal(codeContradictionSource(session, quote('W1', 'code', '// trimmed')), OWN_WRITTEN_SOURCE);
});

test('guard: a written statement\'s own_written contradiction is at most EVIDENCE_QUOTE_MAX characters', () => {
  const events = [ask(), ...write('W1', 'test/parse.test.js', 'long'), ...write('W2', 'test/notes.js', 'note')];
  const session = sessionOf(events);
  const sourceMap = windowSourceMap(session, { events: session.events });
  const statement = (text) => ({ text: 'The note says the comment covers nested input.',
    stated: quote('W2', 'code', 'the comment above covers nested input.'), contradictedBy: quote('W1', 'code', text) });
  const longQuote = TEXT.long.trim();
  assert.ok(longQuote.length > EVIDENCE_QUOTE_MAX);
  const roles = ['observation', 'code'];
  assert.equal(readWrittenStatement(statement(longQuote), { session, sourceMap, roles }).ignored,
    WRITTEN_CONTRADICTION_REJECTIONS[1], 'a quote over the bound does not ground (ungrounded)');
  const short = readWrittenStatement(statement('covers nested input.'), { session, sourceMap, roles });
  assert.deepEqual([short.contradiction?.eventId, short.source], ['W1', OWN_WRITTEN_SOURCE]);
});

test('vocabulary: every name the W1 A, W2 and W3 code reads is its vocabulary\'s member, spelled once', () => {
  assert.equal(OWN_WRITTEN_SOURCE, 'own_written');
  assert.equal(FILE_CONTENT_SOURCE, 'file_content');
  assert.ok(CONTRADICTION_SOURCES.includes(OWN_WRITTEN_SOURCE) && CONTRADICTION_SOURCES.includes(FILE_CONTENT_SOURCE));
  assert.deepEqual([SOURCE_NOT_FILE_CONTENT_CAUSE, SOURCE_REWRITTEN_CAUSE], ['source_not_file_content', 'source_rewritten']);
  assert.ok(WITHHELD_REJECTION_CAUSES.includes(SOURCE_REWRITTEN_CAUSE));
  assert.equal(RESTS_ON_REPAIRED, 'restsOnRepaired');
  assert.deepEqual([...DECISION_RECOLUMN_RECORD], ['refuted', 'existence', 'asked', 'withheld', 'challenged']);
  assert.ok(Object.isFrozen(DECISION_RECOLUMN_RECORD));
  assert.equal(CHANGED_SINCE_LABEL, LEDGER_CHANGED_SINCE_LABEL, 'one label, kept in the constants file');
});
