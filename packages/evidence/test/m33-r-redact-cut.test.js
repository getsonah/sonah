// M33 R, the adapter and the review. Two of the cuts M33 R moved behind redaction reach the session: an over-long ask
// (redaction's bound around Sonah's own marker, `ASK_OMISSION`) and a capped file body (the same stub as before, now
// written after redaction). Both are Sonah's cuts — the recorder kept the whole text — so neither is credited to the
// recorder any more: each is declared by its own note, which the review header names by its own coverage cause
// (`instructions_capped`, `bodies_capped`). The recorder's own cuts keep the words they always had.
//
// Synthetic recordings and ledgers only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES, BODY_CAPPED_NOTE } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { buildLedger, sessionCoverageFacts } from '../src/ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { planWindowRequests } from '../src/run-review.js';
import { redact, ASK_OMISSION } from '../../redact/index.js';
/** The body cap an earlier Sonah cut at (M33 R to D68 E): its stub stands only in a persisted ledger. */
const BODY_CAP = 20_000;
import { GHP, SK, prose, across, userTurn, said, toolUse, toolResult, sliced, CUTS }
  from '../../slicer/test/m33-r-redact-cut-fixture.js';

const repo = { host: 'local', id: 'synthetic' };
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => request.evidencePrompt).join('\n');
const askLines = (n) => Array.from({ length: n }, (_, i) => `Instruction line ${String(i).padStart(4, '0')}: keep the parser stable.`);
// M35 (windowing): redaction no longer bounds a human message; a ledger persisted by an earlier Sonah still carries its
// cut (`ASK_OMISSION` on a line of its own, the declaration kept), and the adapter still declares it as Sonah's.
const capped = (lines) => redact(led({ ask: [{ turn: 1, text: [...lines.slice(0, 300), ASK_OMISSION, ...lines.slice(-100)].join('\n'),
  elided: [{ what: 'middle of turn', chars: 1 }] }],
  ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] })).ledger;
const reviewOf = (session) => buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
const causesOf = (built, names) => coverageCauses(built).filter(([cause]) => names.includes(cause));
/** Whether the report declares a gap of `code` with `note` (on its own list or the session's). */
const declaredNote = (built, code, note) => [...(built.gaps ?? []), ...(built.session?.adapterGaps ?? [])]
  .some((gap) => gap?.code === code && gap.note === note);

test('M33 R an ask capped before review: its marker is never quotable, and the cut is declared as Sonah\'s', () => {
  const lines = askLines(600);
  const ledger = capped(lines);
  assert.ok(ledger.ask[0].text.includes(`\n${ASK_OMISSION}\n`), 'premise: an earlier Sonah bounded the scrubbed ask');
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-r-ask' });
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.equal(instruction.omitted, true, 'its middle is missing: nothing may be certified against what is left');
  assert.equal(instruction.capped, true);
  assert.equal(instruction.redacted, undefined);
  const spans = session.textSpansOf(instruction, 'text');
  assert.equal(spans.length, 2, 'head and tail are two sources: the marker is this review\'s words');
  assert.equal(spans.some((span) => span.includes(ASK_OMISSION)), false);
  const quote = (text) => verifyReceipt(session, { role: 'instruction', eventId: instruction.id, quote: text }).ok;
  assert.equal(quote(lines[0]), true);
  assert.equal(quote(lines.at(-1)), true);
  const head = spans[0].split('\n').at(-1);
  assert.equal(quote(`${head}\n${ASK_OMISSION}`), false, 'no quote spans the cut');
  // Declared in its own words, never the recorder's, and named by its own cause.
  const gaps = session.adapterGaps.filter((gap) => gap.channel === 'instructions');
  assert.deepEqual(gaps.map((gap) => [gap.code, gap.count, gap.note]),
    [['incomplete_inventory', 1, INSTRUCTION_GAP_NOTES.capped_before_review]]);
  assert.equal(INSTRUCTION_GAP_NOTES.capped_before_review,
    'instruction text was capped before review; its head and tail are quotable, the elided middle is not');
  assert.doesNotMatch(INSTRUCTION_GAP_NOTES.capped_before_review, /recorder/);
  assert.equal(INSTRUCTION_GAP_NOTES.recorder_shortened, 'instruction text was elided by the recorder', 'unchanged');
  assert.equal(session.instructionScopeIncomplete, true);
  const facts = sessionCoverageFacts({ session, windows: [], perWindow: [] });
  assert.equal(facts.instructionsElided, 0, 'not counted as an ask the recorder shortened');
  const built = reviewOf(session);
  assert.deepEqual(causesOf(built, ['instructions_elided', 'instructions_capped', 'instructions_withheld']),
    [['instructions_capped', { n: 1 }]]);
  assert.equal(COVERAGE_CAUSES.indexOf('instructions_capped'), COVERAGE_CAUSES.indexOf('instructions_withheld') + 1);
  assert.equal(COVERAGE_SENTENCE.instructions_capped({ n: 1 }),
    'Sonah cut the middle out of 1 message of yours before its review, so it cannot quote that part');
  assert.equal(COVERAGE_SENTENCE.instructions_capped({ n: 2 }),
    'Sonah cut the middle out of 2 messages of yours before its review, so it cannot quote that part');
  assert.ok(declaredNote(built, 'incomplete_inventory', INSTRUCTION_GAP_NOTES.capped_before_review),
    'the cut is declared with its own note');
  assert.doesNotMatch(INSTRUCTION_GAP_NOTES.capped_before_review, /recorder/);
});

test('M33 R an ask both stripped by the slicer and capped before review is declared by both causes', () => {
  const lines = askLines(600);
  lines.splice(5, 0, '[code block, 40 lines, 1300 chars]');
  // M35: a ledger an earlier Sonah both stripped and capped (redaction no longer caps a human message).
  const ledger = redact(led({ ask: [{ turn: 1, text: [...lines.slice(0, 300), ASK_OMISSION, ...lines.slice(-100)].join('\n'),
    elided: [{ what: 'code block', chars: 1300 }, { what: 'middle of turn', chars: 1 }] }],
  ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] })).ledger;
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-r-both' });
  // M33 R repair: the strip is Sonah's too (redaction's, after it scrubbed the whole ask), never the recorder's.
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => [gap.count, gap.note]),
    [[1, INSTRUCTION_GAP_NOTES.capped_before_review], [1, INSTRUCTION_GAP_NOTES.stripped_before_review]]);
  assert.deepEqual(causesOf(reviewOf(session), ['instructions_elided', 'instructions_capped', 'instructions_stripped']),
    [['instructions_capped', { n: 1 }], ['instructions_stripped', { n: 1 }]]);
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.deepEqual([instruction.omitted, instruction.capped, instruction.stripped], [true, true, true]);
});

test('M33 R an older ledger\'s pre-redaction ask cut is still never quoted across, and declared as Sonah\'s too', () => {
  const ledger = led({ ask: [{ turn: 1, text: 'Keep the parser stable.\n\n[… 2400 chars elided …]\n\nAnd ship it.',
    elided: [{ what: 'middle of turn', chars: 2400 }] }],
  ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] });
  const again = redact(structuredClone(ledger)).ledger;
  assert.equal(again.ask[0].text, ledger.ask[0].text, 'redaction does not cut an ask that older cut already bounded');
  assert.deepEqual(again.ask[0].elided, ledger.ask[0].elided);
  const session = sessionFromLedger(again, { sessionKey: 'm33-r-legacy' });
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.equal(session.textSpansOf(instruction, 'text').some((span) => span.includes('chars elided')), false);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.note),
    [INSTRUCTION_GAP_NOTES.capped_before_review]);
});

test('M33 R, D68 (E) a persisted file body capped before review is declared as Sonah\'s cut, in the gap, the header and the request', async () => {
  const { clean } = await sliced([userTurn('write the big module'),
    toolUse('w1', 'Write', { file_path: '/repo/src/big.js', content: prose(30_000) }), toolResult('w1', 'File created successfully')]);
  // D68 (E): the production path keeps the body whole and declares no cut.
  const whole = sessionFromLedger(clean, { sessionKey: 'm33-r-body-whole' });
  assert.equal(whole.adapterGaps.some((gap) => gap.code === 'source_clipped'), false);
  // A ledger an earlier Sonah persisted with the body capped is still declared as Sonah's cut.
  const persisted = structuredClone(clean);
  const body = persisted.ledger.find((e) => e.kind === 'create').after;
  body.text = `${body.text.slice(0, BODY_CAP)}\n[… truncated at ${BODY_CAP} chars …]`;
  body.truncated = true;
  body.lines = body.text.split('\n').length;
  const session = sessionFromLedger(persisted, { sessionKey: 'm33-r-body' });
  const gaps = session.adapterGaps.filter((gap) => gap.code === 'source_clipped' && gap.channel === 'code');
  assert.deepEqual(gaps.map((gap) => [gap.count, gap.note]), [[1, BODY_CAPPED_NOTE]]);
  assert.equal(BODY_CAPPED_NOTE, 'a file body was capped before review; only its head is quotable as code');
  assert.doesNotMatch(BODY_CAPPED_NOTE, /recorder/);
  const built = reviewOf(session);
  assert.deepEqual(causesOf(built, ['source_clipped', 'bodies_capped']), [['bodies_capped', { n: 1 }]]);
  assert.equal(COVERAGE_CAUSES.indexOf('bodies_capped'), COVERAGE_CAUSES.indexOf('statements_capped') + 1);
  assert.equal(COVERAGE_SENTENCE.bodies_capped({ n: 1 }),
    'Sonah shortened 1 file body before its review, so it cannot quote what it left out');
  assert.equal(COVERAGE_SENTENCE.bodies_capped({ n: 3 }),
    'Sonah shortened 3 file bodies before its review, so it cannot quote what it left out');
  assert.ok(declaredNote(built, 'source_clipped', BODY_CAPPED_NOTE), 'the cut is declared with its own note');
  assert.doesNotMatch(BODY_CAPPED_NOTE, /recorder/);
  // The review request declares the cut beside the body, and the stub is never inside a quotable span. M33 R repair:
  // its extent line names the cut as Sonah's, never the recorder's (write-bodies.test.js pins the same words).
  const prompt = promptsOf(session);
  assert.match(prompt, new RegExp(`extent: ${BODY_CAP.toLocaleString('en-US')} chars shown — capped before review at `
    + `${BODY_CAP.toLocaleString('en-US')} chars; the rest of this body was not shown and cannot be quoted`));
  assert.doesNotMatch(prompt, /head-truncated by the recorder/);
  const [write] = session.events.filter((event) => event.kind === 'invocation');
  assert.equal(verifyReceipt(session, { eventId: write.id, role: 'code', quote: `truncated at ${BODY_CAP} chars` }).ok, false);
});

test('M33 R the recorder\'s own cuts keep their words: output the recorder clipped; an ask\'s strip is Sonah\'s', () => {
  const session = sessionFromLedger(led({
    ask: [{ turn: 1, text: 'Fix the parser.\n[code block, 40 lines, 1200 chars]\nKeep the tests green.',
      elided: [{ what: 'code block', chars: 1200 }] }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0,
      tailLines: ['ok 1', '[… output omitted by recorder …]', 'ok 9'], tailClipped: true }] }), { sessionKey: 'm33-r-recorder' });
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'source_clipped').map((gap) => [gap.channel, gap.note]),
    [['observations', 'the recorder retained only head and tail of tool output']]);
  // M33 R repair: the strip of pasted material is Sonah's (the recorder kept the whole ask), declared as such.
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.note),
    [INSTRUCTION_GAP_NOTES.stripped_before_review]);
  assert.deepEqual(causesOf(reviewOf(session), ['source_clipped', 'bodies_capped', 'instructions_elided', 'instructions_capped',
    'instructions_stripped']), [['instructions_stripped', { n: 1 }], ['source_clipped', { n: 1 }]]);
});

test('M33 R, D90 end to end: a token where an old ask or body cut fell reaches the ledger, the session and the review request whole', async () => {
  for (const [cut, build] of Object.entries({ askHead: CUTS.askHead, askTail: CUTS.askTail, readBefore: CUTS.readBefore,
    writeAfter: CUTS.writeAfter, editSegment: CUTS.editSegment })) {
    for (const [name, token] of Object.entries({ ghp: GHP, sk: SK })) {
      for (let offset = -2; offset <= token.length + 2; offset += name === 'ghp' ? 5 : 11) {
        const where = `${cut}: ${name} ${offset} characters across the cut`;
        const { clean } = await sliced(build(token, offset));
        const session = sessionFromLedger(clean, { sessionKey: `m33-r-${cut}-${name}-${offset}` });
        assert.ok(JSON.stringify(clean).includes(token), `${where}: ledger`);
        assert.ok(JSON.stringify(session.blobs).includes(token), `${where}: session`);
        // A Read's long output is shown in a request by the window's own observation bound (its head and tail), and
        // the file before an edit only on request: neither is a cut of what is recorded.
        if (cut !== 'readBefore') assert.ok(promptsOf(session).includes(token), `${where}: review requests`);
      }
    }
  }
});

test('M33 R a session with nothing over a cap declares no Sonah cut', async () => {
  const { clean } = await sliced([userTurn(across(GHP, 900, 3, 4_000)),
    toolUse('w1', 'Write', { file_path: '/repo/src/small.js', content: prose(14_000) }), toolResult('w1', 'File created successfully'),
    said('Done.')]);
  const session = sessionFromLedger(clean, { sessionKey: 'm33-r-small' });
  assert.deepEqual(causesOf(reviewOf(session), ['instructions_capped', 'bodies_capped', 'source_clipped']), []);
  assert.equal(clean.ask[0].text.includes(ASK_OMISSION), false);
});
