// M33 R repair, the adapter and the review. An ask's whole-structure strips used to be made by the slicer; an earlier
// Sonah's strips are declared as what they are: Sonah's cut (the recorder kept the whole ask), by their own note and
// coverage cause (`instructions_stripped`), never as an elision by the recorder. M6: Sonah
// strips no ask by its shape any more — the turn is kept whole — so only a persisted ledger an earlier Sonah
// stripped still carries a strip, and is still declared that way. D90 (owner decision 2026-10-15, privacy is not a
// design constraint): nothing in the ask is masked either: a pasted secret block reaches the session and the review
// requests as recorded.
//
// Synthetic recordings and ledgers only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES, ASK_STRIP_KINDS as ADAPTER_STRIP_KINDS } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { buildLedger, sessionCoverageFacts } from '../src/ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { planWindowRequests } from '../src/run-review.js';
import { redact, ASK_STRIP_KINDS } from '../../redact/index.js';
import { userTurn, said, sliced } from '../../slicer/test/m33-r-redact-cut-fixture.js';

const repo = { host: 'local', id: 'synthetic' };
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
const reviewOf = (session) => buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
const causesOf = (built, names) => coverageCauses(built).filter(([cause]) => names.includes(cause));

const BLOCK = Array.from({ length: 30 }, (_, i) => `    correct-horse-battery-staple-lantern-${String(i).padStart(4, '0')}`);
const TAIL_SECRETS = ['quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow'];
const SECRETS = [...TAIL_SECRETS, ...BLOCK.map((line) => line.trim())];
/** A YAML secret block split by a blank line across an indented-block strip (`lines` of it before the blank line). */
const splitBlock = (lines) => ['Please configure the deployment with this:', 'signing_key: |', ...lines, '',
  ...TAIL_SECRETS.map((line) => `    ${line}`), 'Thanks.'].join('\n');

test('M33 R repair, D90: a pasted secret block reaches the ledger, the session and a review request as recorded', async () => {
  for (const lines of [BLOCK, [...BLOCK, ...BLOCK.map((line) => `${line}-b`)]]) {
    const { clean } = await sliced([userTurn(splitBlock(lines)), said('Done.')]);
    const session = sessionFromLedger(clean, { sessionKey: `m33-r-strip-${lines.length}` });
    for (const secret of SECRETS) {
      assert.ok(JSON.stringify(clean).includes(secret), `${lines.length} lines: ledger`);
      assert.ok(JSON.stringify(session.blobs).includes(secret), `${lines.length} lines: session`);
      assert.ok(promptsOf(session).includes(secret), `${lines.length} lines: review requests`);
    }
    // Nothing is withheld, so nothing is declared on the instruction.
    const [instruction] = session.events.filter((event) => event.kind === 'instruction');
    assert.notEqual(instruction.omitted, true);
    assert.notEqual(instruction.redacted, true);
  }
});

test('M6, D90: a pasted block is kept whole where it stands: no stub, no strip declared, nothing withheld', async () => {
  const { clean } = await sliced([userTurn(splitBlock([...BLOCK, ...BLOCK.map((line) => `${line}-b`)])), said('Done.')]);
  assert.doesNotMatch(clean.ask[0].text, /\[indented block, \d+ lines, \d+ chars\]/);
  assert.equal(Object.hasOwn(clean.ask[0], 'elided'), false);
  const session = sessionFromLedger(clean, { sessionKey: 'm33-r-strip-declared' });
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.deepEqual([instruction.stripped, instruction.capped], [undefined, undefined]);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: instruction.id,
    quote: 'Please configure the deployment with this:' }).ok, true);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.note), [],
    'nothing is withheld');
  // The note and cause a persisted strip is declared by are unchanged (below).
  assert.equal(INSTRUCTION_GAP_NOTES.stripped_before_review, 'pasted material in instruction text was replaced by a stub '
    + 'before review; the text around it is quotable, the stripped material is not');
  assert.equal(COVERAGE_CAUSES.indexOf('instructions_stripped'), COVERAGE_CAUSES.indexOf('instructions_capped') + 1);
  assert.equal(COVERAGE_SENTENCE.instructions_stripped({ n: 2 }),
    'Sonah put a stub in place of material that you pasted into 2 messages of yours, so it cannot quote that material');
  const built = reviewOf(session);
  assert.deepEqual(causesOf(built, ['instructions_elided', 'instructions_stripped']), []);
});

test('M33 R repair, M6: an older ledger\'s strips (an earlier Sonah\'s) are declared as Sonah\'s too, its stub never quotable', () => {
  const ledger = redact(led({ ask: [{ turn: 1, text: 'Fix the parser.\n[code block, 40 lines, 1300 chars]\nKeep the API.',
    elided: [{ what: 'code block', chars: 1300 }] }],
  ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] })).ledger;
  assert.deepEqual(ledger.ask[0].elided, [{ what: 'code block', chars: 1300 }], 'a strip is final');
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-r-strip-older' });
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => [gap.count, gap.note]),
    [[1, INSTRUCTION_GAP_NOTES.stripped_before_review]]);
  assert.equal(session.instructionScopeIncomplete, true);
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.deepEqual([instruction.omitted, instruction.stripped], [true, true]);
  assert.equal(session.textSpansOf(instruction, 'text').some((span) => /\[code block, /.test(span)), false,
    'the stub is this review\'s words');
  const built = reviewOf(session);
  assert.deepEqual(causesOf(built, ['instructions_elided', 'instructions_stripped']), [['instructions_stripped', { n: 1 }]]);
  // An elision of a kind no version of Sonah writes is still credited to the recorder.
  const other = sessionFromLedger(redact(led({ ask: [{ turn: 1, text: 'Fix the parser.', elided: [{ what: 'recorder clip', chars: 9 }] }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] })).ledger, { sessionKey: 'm33-r-other' });
  assert.deepEqual(other.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.note),
    [INSTRUCTION_GAP_NOTES.recorder_shortened]);
});

test('M33 R repair, M6: the strip kinds the adapter reads are the ones an earlier redaction wrote', () => {
  assert.deepEqual([...ADAPTER_STRIP_KINDS], [...ASK_STRIP_KINDS]);
  assert.equal(Object.isFrozen(ADAPTER_STRIP_KINDS), true);
});
