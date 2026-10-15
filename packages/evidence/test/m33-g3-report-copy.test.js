// M33 G3. Two copy defects in a review's text:
//   1. "What was not checked" printed a gap's note after the phrasebook sentence even when the
//      note IS that sentence, so the line read "X; X". Each clause is said once — and no declared
//      cause, count, event or distinct note is dropped for it.
//   2. A decision whose value is unchecked read "could not be grounded in an action" whatever the
//      reason. When the write it cites has no established outcome, the card now says exactly that;
//      when the write is recorded as not succeeding it says so; and when every write it cites is
//      proven, the card blames the value's quote, never the write.
//      M33 G4: the card says the cause the LEDGER recorded on the row (`valueUnchecked`), never one
//      it infers from the session; these rows carry the cause `groundDecision` records for them.
// Synthetic input only: no model, no provider, no recording.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/session.js';
import { renderReview, GAP_SENTENCE } from '../src/review.js';

const blobs = {};
const put = (key, text) => {
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
const write = (id, path, sequence) => ({ id, kind: 'invocation', sequence, callKey: id.toLowerCase(), tool: 'Write',
  operation: 'write', paths: [{ path }], command: [], input: [],
  changes: [{ path, before: [], after: put(`${id}-body`, `export const SYNTHETIC_G3_${id} = 1;\n`), diff: [] }] });
const outcome = (id, result, sequence) => ({ id: `${id}-r`, kind: 'observation', sequence, invocation: id,
  callKey: id.toLowerCase(), phase: 'terminal', result, exitCode: null, terminalStatusProven: true,
  output: put(`${id}-out`, `SYNTHETIC_G3_${id}_RESULT`), sourceOfResult: 'native' });
const session = new Session({ sessionKey: 'sess-g3-copy', adapter: 'claude', blobs, events: [
  { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: put('ask', 'SYNTHETIC_G3_ASK: write the modules.') },
  write('W1', 'src/proven.js', 1), outcome('W1', 'succeeded', 2),
  write('W2', 'src/unknown.js', 3),
  write('W3', 'src/failed.js', 4), outcome('W3', 'failed', 5),
  { id: 'X1', kind: 'invocation', sequence: 6, callKey: 'x1', tool: 'Bash', operation: 'command', paths: [],
    command: put('cmd', 'npm test'), input: [], changes: [] },
] });

const decision = (actions, over = {}) => ({ actorSession: 'sess-g3-copy', dimension: `SYNTHETIC_G3_DIM_${actions.join('_')}`,
  chosen: 'SYNTHETIC_G3_CHOSEN', value: null, valueReceipt: null, valueState: 'unchecked', actions, stated: null,
  constrainedBy: null, instructionReview: null, column: 'asked-chose', columnState: 'grounded', amends: [],
  materiality: 'structural', materialityRule: 'new-module', relevance: 'session-effect', reasons: ['value_unchecked'], ...over });
const report = (over) => ({
  repo: { host: 'github.com', id: '1' }, pr: null, reviewScope: 'session-only', session, hasSessionEvidence: true,
  decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps: [],
  counts: { decisions: 0, byColumn: { 'asked-settled': 0, 'asked-chose': 0, unasked: 0 }, uncheckedColumn: 0,
    rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'partial', codeCoverage: 'missing', sessionReview: 'complete', ...over,
});
const cardOf = (md, dimension) => {
  const start = md.indexOf(`<summary><b>${dimension}</b>`);
  assert.ok(start >= 0, `premise: the card for ${dimension} is rendered`);
  return md.slice(start, md.indexOf('</details>', start));
};
const withDecisions = (decisions) => renderReview(report({ decisions,
  counts: { decisions: decisions.length, byColumn: { 'asked-settled': 0, 'asked-chose': decisions.length, unasked: 0 },
    uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 } }));

// ---- 1. one clause, said once -----------------------------------------------------------------

const gapLine = (md, code) => md.split('\n').filter((line) => line.startsWith(`- \`${code}\``));

test('M33 G3 a gap whose note is its phrasebook sentence says that sentence once', () => {
  const md = renderReview(report({ gaps: [
    { code: 'write_outcome_unknown', channel: 'observations', scope: 'session', count: 2, eventIds: ['W2', 'W3'],
      note: 'the recording does not establish whether these attempted writes completed' },
    { code: 'command_outcome_unknown', channel: 'observations', scope: 'session', count: 1, eventIds: ['X1'],
      note: 'the recording does not establish whether these shell or test commands completed' },
  ] }));
  assert.deepEqual(gapLine(md, 'write_outcome_unknown'),
    [`- \`write_outcome_unknown\` at \`W2\` (2) — ${GAP_SENTENCE.write_outcome_unknown}.`]);
  assert.deepEqual(gapLine(md, 'command_outcome_unknown'),
    [`- \`command_outcome_unknown\` at \`X1\` (1) — ${GAP_SENTENCE.command_outcome_unknown}.`]);
  // Every declared cause is still named with its count in the header.
  assert.match(md, /Not covered: .*2 attempted write\(s\) have no provable outcome/);
  assert.match(md, /Not covered: .*1 shell or test command\(s\) have no provable exit status/);
});

test('M33 G3 a note that repeats the sentence and adds a clause keeps the added clause', () => {
  const md = renderReview(report({ gaps: [{ code: 'write_outcome_unknown', channel: 'observations', scope: 'session',
    count: 1, eventIds: ['W2'],
    note: 'the recording does not establish whether these attempted writes completed; 1 finding(s) depending on them were withheld' }] }));
  assert.deepEqual(gapLine(md, 'write_outcome_unknown'), [`- \`write_outcome_unknown\` at \`W2\` (1) — `
    + `${GAP_SENTENCE.write_outcome_unknown}; 1 finding(s) depending on them were withheld.`]);
});

test('M33 G3 a distinct note, and a note on another channel\'s wording, are kept whole', () => {
  const md = renderReview(report({ gaps: [
    { code: 'incomplete_inventory', channel: 'actions', scope: 'session', count: 3, eventIds: ['X1'],
      note: 'SYNTHETIC_G3 distinct note' },
    { code: 'write_outcome_unknown', channel: 'children', scope: 'session', count: 1, eventIds: ['W2'],
      note: 'the recording does not establish whether these attempted writes completed' },
  ] }));
  assert.deepEqual(gapLine(md, 'incomplete_inventory'),
    [`- \`incomplete_inventory\` at \`X1\` (3) — ${GAP_SENTENCE.incomplete_inventory}; SYNTHETIC\\_G3 distinct note.`]);
  const [child] = gapLine(md, 'write_outcome_unknown');
  assert.match(child, /delegated sub-agent recording does not establish/, 'the children phrasebook sentence');
  assert.match(child, /; the recording does not establish whether these attempted writes completed\.$/,
    'a note that differs from the sentence it follows is not a duplicate, and is kept');
});

// ---- 2. an unchecked value says why, and never blames a proven write ---------------------------

test('M33 G3 a value on a write with no established outcome says so, not "could not be grounded"', () => {
  const md = withDecisions([decision(['W2'], { valueUnchecked: { cause: 'write_outcome_unknown', action: 'W2' } })]);
  const card = cardOf(md, 'SYNTHETIC\\_G3\\_DIM\\_W2');
  assert.doesNotMatch(card, /could not be grounded/);
  assert.match(card, /the recording does not establish whether the write it was quoted from \(`W2`\) completed/);
});

test('M33 G3 a value on a write recorded as not succeeding says so', () => {
  const card = cardOf(withDecisions([decision(['W3'], { valueUnchecked: { cause: 'write_unsuccessful', action: 'W3' } })]),
    'SYNTHETIC\\_G3\\_DIM\\_W3');
  assert.doesNotMatch(card, /could not be grounded/);
  assert.match(card, /the write it was quoted from \(`W3`\) is recorded as failed or cancelled/);
});

test('M33 G3 a value whose cited write is proven never says the write could not be grounded', () => {
  const card = cardOf(withDecisions([decision(['W1', 'X1'], { valueUnchecked: { cause: 'unmatched', action: null } })]),
    'SYNTHETIC\\_G3\\_DIM\\_W1\\_X1');
  assert.doesNotMatch(card, /could not be grounded/);
  assert.doesNotMatch(card, /does not establish whether/, 'a proven write is never called unproven');
  assert.match(card, /did not check out against the recorded text of the actions it cites/);
});

test('M33 G3 the unknown outcome is named even beside a proven write, and a grounded value is unchanged', () => {
  const md = withDecisions([decision(['W1', 'W2'], { valueUnchecked: { cause: 'write_outcome_unknown', action: 'W2' } }),
    decision(['W1'], { dimension: 'SYNTHETIC_G3_GROUNDED', value: 'src/proven.js', valueState: 'grounded', reasons: [],
      valueReceipt: { eventId: 'W1', field: 'path', role: 'action', quote: 'src/proven.js' } })]);
  assert.match(cardOf(md, 'SYNTHETIC\\_G3\\_DIM\\_W1\\_W2'), /it was quoted from \(`W2`\) completed/);
  assert.match(cardOf(md, 'SYNTHETIC\\_G3\\_GROUNDED'), /\*\*What was adopted\.\*\* `src\/proven\.js`/);
});

test('M33 G3 a report rendered without its session names no cause it cannot read', () => {
  const decisions = [decision(['W2'])];
  const md = renderReview(report({ session: null, decisions,
    counts: { decisions: 1, byColumn: { 'asked-settled': 0, 'asked-chose': 1, unasked: 0 }, uncheckedColumn: 0,
      rejectedDecisions: 0, rejectedFindings: 0 } }));
  const card = cardOf(md, 'SYNTHETIC\\_G3\\_DIM\\_W2');
  assert.match(card, /The specific value was not confirmed from the recorded actions, so it is shown as unchecked rather than guessed\./);
  assert.doesNotMatch(card, /could not be grounded|did not check out|does not establish/);
});

test('M33 G3 the withheld count of unchecked values does not say "could not be grounded"', () => {
  const md = withDecisions([decision(['W1']), decision(['W2'])]);
  const withheld = md.slice(md.indexOf('### Checked, inconclusive'));
  assert.match(withheld, /- 2 decision\(s\) whose adopted value was not confirmed from the recorded actions \(shown as unchecked\)\./);
  assert.doesNotMatch(md, /could not be grounded/);
});
