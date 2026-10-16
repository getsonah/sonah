// D90 (owner decision 2026-10-15, privacy is not a design constraint). No Sonah writes a redaction mark now (`‹redacted…›`,
// `‹dropped…›`, a dropped-lines note), so in a ledger a review slices today those characters are the recording's own
// text: a person pasted an earlier Sonah page into a request, an agent printed one, a file holds one. They are placed
// whole and quotable, and nothing is declared withheld for them. They are an earlier redactor's marks only where the
// record declares that redactor's work (its list of what it dropped, or the field's own declaration).
//
// Synthetic ledgers only. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { hunkRunsOf, verifyReceipt } from '../src/session.js';
import { planWindowRequests, runReview } from '../src/run-review.js';

const pr = { repo: { host: 'local', id: 'synthetic' }, files: [] };
const empty = async () => ({ decisions: [], pivots: [], claims: [], requirements: [] });

const NOTE = '[… 2 line(s) dropped: unclassified high-entropy content …]';
const ASK = 'The page said "Retry test is ‹redacted:secret-value›" and mail ‹redacted:email›.\n'
  + `It also showed ‹dropped:high-entropy› and\n${NOTE}\nFix the masking.`;
const SAID = 'The old page printed ‹redacted:secret-value› where the test name was.';
const CMD = "grep -rn '‹redacted' packages/render";
const OUT = "packages/render/old.js:12:  return '‹redacted:secret-value›';";
const INPUT = 'query: ‹dropped:high-entropy› tools';
const BODY = "const MARK = '‹dropped:high-entropy›';\nexport default MARK;";
const BRIEF = 'Find where the page printed ‹redacted:email›.';

/** A ledger as the slicer writes one today: the texts as recorded, no redactor's declaration anywhere. */
const recorded = (over = {}) => ({
  ask: [{ turn: 1, text: ASK }],
  commentary: [{ turn: 1, beforeEvent: 0, text: SAID }],
  ledger: [
    { turn: 1, seq: 0, kind: 'bash', cmd: CMD, tailLines: OUT.split('\n'), exitCode: 0, exitCodeSource: 'native',
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } },
    { turn: 1, seq: 1, kind: 'other', tool: 'ToolSearch', argsExcerpt: INPUT, inputRecorded: true,
      result: { seen: true, outcome: 'unknown', provenance: 'native' }, tailLines: ['Found.'] },
    { turn: 1, seq: 2, kind: 'create', path: 'src/mark.js', after: { text: BODY, truncated: false, lines: 2 },
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } },
  ],
  delegations: [{ turn: 1, status: 'unresolved', kind: 'spawn', parentInstruction: { tool: 'Agent', text: BRIEF } }],
  claim: { finalMessage: '' }, dropped: [], ...over,
});
const load = (ledger, key) => sessionFromLedger(redact(ledger).ledger, { sessionKey: key });
const quote = (session, eventId, role, text) => verifyReceipt(session, { eventId, role, quote: text }).ok;

test('a mark-shaped string a recording holds is its own text: placed whole, quotable, and never declared withheld', () => {
  const session = load(recorded(), 'd90-recorded-marks');
  assert.deepEqual(session.adapterGaps.filter((gap) => /redact/.test(String(gap.note ?? ''))), []);
  assert.ok(!session.adapterGaps.some((gap) => gap.channel === 'instructions'));
  const instruction = session.events.find((event) => event.kind === 'instruction');
  assert.equal(instruction.omitted, undefined);
  assert.equal(instruction.redacted, undefined);
  assert.deepEqual(session.textSpanInfoOf(instruction), { spans: [ASK], complete: true });
  assert.ok(quote(session, instruction.id, 'instruction', 'Retry test is ‹redacted:secret-value›'));
  assert.ok(quote(session, instruction.id, 'instruction', 'showed ‹dropped:high-entropy› and'));
  const commentary = session.events.find((event) => event.kind === 'commentary');
  assert.ok(quote(session, commentary.id, 'commentary', 'printed ‹redacted:secret-value› where'));
  assert.ok(quote(session, 'A1-0', 'action', "'‹redacted' packages/render"));
  assert.ok(quote(session, session.observationFor('A1-0').id, 'observation', "return '‹redacted:secret-value›'"));
  assert.ok(quote(session, 'A1-1', 'action', 'query: ‹dropped:high-entropy› tools'));
  const write = session.event('A1-2');
  assert.notEqual(write.changes[0].redacted, true);
  assert.ok(quote(session, write.id, 'code', "const MARK = '‹dropped:high-entropy›';"));
  const delegate = session.events.find((event) => event.operation === 'delegate');
  assert.ok(quote(session, delegate.id, 'action', 'printed ‹redacted:email›'));
});

test('the review reads such a request whole and is not held partial by it', async () => {
  const ledger = recorded({ ledger: [recorded().ledger[1]], delegations: [] });
  const session = load(ledger, 'd90-recorded-marks-review');
  const [built] = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  for (const line of ASK.split('\n')) assert.ok(built.request.prompt.includes(line), line);
  const report = await runReview({ session, pr, judge: empty });
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.ok(!JSON.stringify(report).includes('withheld by redaction'));
});

test('the same characters are an earlier redactor\'s marks where the record declares its work', () => {
  // The ledger an earlier Sonah's redactor wrote names what it masked in its own list (`dropped`, its closed reasons).
  const session = load(recorded({ dropped: [{ turn: 1, reason: 'redacted:secret-value', where: 'ask' }] }),
    'd90-declared-marks');
  const instruction = session.events.find((event) => event.kind === 'instruction');
  assert.equal(instruction.omitted, true);
  assert.equal(instruction.redacted, true);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'instructions'
    && /withheld by redaction/.test(gap.note)));
  assert.ok(!quote(session, instruction.id, 'instruction', 'Retry test is ‹redacted:secret-value›'));
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'observations'));
  assert.equal(session.event('A1-2').changes[0].redacted, true);
  // A field's own declaration does the same for that field alone.
  const field = load(recorded({ ask: [{ turn: 1, text: ASK, redacted: true }] }), 'd90-declared-field');
  assert.equal(field.events.find((event) => event.kind === 'instruction').omitted, true);
  assert.ok(!field.adapterGaps.some((gap) => gap.channel === 'observations'));
});

test('a recorded hunk holding a mark-shaped line is one source; one an earlier redactor declared it scrubbed is cut there', () => {
  const hunks = [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 3, lines: ['+a', '+‹dropped›', '+b'] }];
  const event = (recordedFacts) => ({ id: 'A1', kind: 'invocation', recorded: recordedFacts });
  const [fresh] = hunkRunsOf(event({ hunks }));
  assert.deepEqual(fresh.spans, ['a\n‹dropped›\nb']);
  const [scrubbed] = hunkRunsOf(event({ hunks, hunkScrub: 'file' }));
  assert.deepEqual(scrubbed.spans, ['a\n', '\nb']);
});
