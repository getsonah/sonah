// M33 R repair, the adapter and the review. An ask's whole-structure strips used to be made by the slicer before
// redaction: a strip that took a YAML secret block's key left the block's later lines unmasked in the ask, the session
// and the review requests. Now redaction makes the strips after it has scrubbed the whole ask, and they are declared as
// what they are: Sonah's cut (the recorder kept the whole ask), by their own note and coverage cause
// (`instructions_stripped`), never as an elision by the recorder. M6: Sonah strips no ask
// by its shape any more — the turn is kept whole up to the transport budget — so only a persisted ledger an earlier
// Sonah stripped still carries a strip, and is still declared that way.
//
// Synthetic recordings and ledgers only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES, ASK_STRIP_KINDS as ADAPTER_STRIP_KINDS } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { buildLedger, sessionCoverageFacts } from '../src/ledger.js';
import { coverageCauses, renderReview, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { planWindowRequests } from '../src/run-review.js';
import { redact, ASK_STRIP_KINDS } from '../../redact/index.js';
import { userTurn, said, sliced } from '../../slicer/test/m33-r-redact-cut-fixture.js';

const repo = { host: 'local', id: 'synthetic' };
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => `${request.prompt ?? ''}\n${request.evidencePrompt ?? ''}`).join('\n');
const reviewOf = (session) => buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
const causesOf = (built, names) => coverageCauses(built).filter(([cause]) => names.includes(cause));
const notCheckedLine = (text, code) => text.split('\n').find((row) => row.startsWith(`- \`${code}\``));
const leaks = (text, secrets) => secrets.flatMap((secret) => Array.from({ length: Math.max(0, secret.length - 7) },
  (_, i) => secret.slice(i, i + 8))).filter((fragment) => text.includes(fragment));

const BLOCK = Array.from({ length: 30 }, (_, i) => `    correct-horse-battery-staple-lantern-${String(i).padStart(4, '0')}`);
const TAIL_SECRETS = ['quiet-meadow-orchard-violet-ember', 'paper-tiger-river-stone-hollow'];
const SECRETS = [...TAIL_SECRETS, ...BLOCK.map((line) => line.trim())];
/** A YAML secret block split by a blank line across an indented-block strip (`lines` of it before the blank line). */
const splitBlock = (lines) => ['Please configure the deployment with this:', 'signing_key: |', ...lines, '',
  ...TAIL_SECRETS.map((line) => `    ${line}`), 'Thanks.'].join('\n');

test('M33 R repair: a strip that took a secret block\'s key leaves no line of it in the ledger, the session or a review request', async () => {
  for (const lines of [BLOCK, [...BLOCK, ...BLOCK.map((line) => `${line}-b`)]]) {
    const { clean } = await sliced([userTurn(splitBlock(lines)), said('Done.')]);
    const session = sessionFromLedger(clean, { sessionKey: `m33-r-strip-${lines.length}` });
    assert.deepEqual(leaks(JSON.stringify(clean), SECRETS), [], `${lines.length} lines: ledger`);
    assert.deepEqual(leaks(JSON.stringify(session.blobs), SECRETS), [], `${lines.length} lines: session`);
    assert.deepEqual(leaks(promptsOf(session), SECRETS), [], `${lines.length} lines: review requests`);
    // What redaction withheld is declared on the instruction, whether or not the strip took it.
    const [instruction] = session.events.filter((event) => event.kind === 'instruction');
    assert.equal(instruction.omitted, true);
    assert.equal(instruction.redacted, true);
  }
});

test('M6: a pasted block is kept whole and scrubbed where it stands: no stub, no strip declared', async () => {
  const { clean } = await sliced([userTurn(splitBlock([...BLOCK, ...BLOCK.map((line) => `${line}-b`)])), said('Done.')]);
  assert.doesNotMatch(clean.ask[0].text, /\[indented block, \d+ lines, \d+ chars\]/);
  assert.equal(Object.hasOwn(clean.ask[0], 'elided'), false);
  const session = sessionFromLedger(clean, { sessionKey: 'm33-r-strip-declared' });
  const [instruction] = session.events.filter((event) => event.kind === 'instruction');
  assert.deepEqual([instruction.stripped, instruction.capped], [undefined, undefined]);
  assert.equal(verifyReceipt(session, { role: 'instruction', eventId: instruction.id,
    quote: 'Please configure the deployment with this:' }).ok, true);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions').map((gap) => gap.note),
    [INSTRUCTION_GAP_NOTES.redaction_withheld], 'only what redaction withheld');
  // The note and cause a persisted strip is declared by are unchanged (below).
  assert.equal(INSTRUCTION_GAP_NOTES.stripped_before_review, 'pasted material in instruction text was replaced by a stub '
    + 'before review; the text around it is quotable, the stripped material is not');
  assert.equal(COVERAGE_CAUSES.indexOf('instructions_stripped'), COVERAGE_CAUSES.indexOf('instructions_capped') + 1);
  assert.equal(COVERAGE_SENTENCE.instructions_stripped({ n: 2 }),
    '2 instructions had pasted material replaced by a stub before review, so what was stripped cannot be quoted');
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
