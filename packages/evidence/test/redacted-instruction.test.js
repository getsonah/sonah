// W3e-4 / F204, F205 — an instruction redaction withheld is declared as such, and the model is told.
//
// W3e-3 (F198) made an ask redaction could not show an instruction event with no text, `omitted`
// and `redacted`. Two readers were still not told:
//
// F204. The session's instruction-incompleteness flag and the `incomplete_inventory` gap on the
// `instructions` channel counted only asks the RECORDER shortened. An ask REDACTION emptied is just
// as missing; it now sets the flag and is counted, by its own gap, whose note (from a closed table)
// says which of the two losses it is.
//
// F205. The narrative prompt rendered such an instruction as an empty fence: a human instruction
// with nothing in it, and nothing telling the model its words were withheld. It now renders its
// header and one fixed line from a closed table — never text — and nothing about it is quotable.
//
// Every fixture is synthetic; the key block is assembled at run time. No model is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../redact/index.js';
import * as adapter from '../adapters/sonah-ledger.js';
import * as prompts from '../src/prompt.js';
import { verifyReceipt } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { instructionReviewScope, gapKey } from '../src/ledger.js';

const { sessionFromLedger } = adapter;
const { buildNarrativePrompt } = prompts;
const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });

const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const keyLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
/** An ask that is only a pasted key block: redaction leaves nothing of it. */
const KEY_ASK = [BEGIN, keyLine(0), keyLine(1), END].join('\n');
/** An ask whose pasted code block was stripped: its middle is a stub, not the human's words. M33 R repair: the strip is
 *  Sonah's (the recorder kept the whole ask), declared as stripped before review. */
const ELIDED_ASK = { text: 'Fix the parser.\n[code block, 40 lines, 1200 chars]\nKeep the tests green.',
  elided: [{ what: 'code block', chars: 1200 }] };
/** An ask with an elision of a kind no version of Sonah writes: still credited to the recorder. */
const SHORTENED_ASK = { text: 'Fix the parser.\nKeep the tests green.', elided: [{ what: 'recorder clip', chars: 1200 }] };

function sessionOf(asks) {
  const { ledger } = redact(led({ ask: asks, ledger: [{ turn: 2, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', exitCode: 0 }] }));
  return sessionFromLedger(ledger, { sessionKey: 'w3e4' });
}

const NOTES = () => adapter.INSTRUCTION_GAP_NOTES ?? {};
const instructionGaps = (session) => session.adapterGaps.filter((g) => g.channel === 'instructions');

// ---- F204 ----------------------------------------------------------------------------------------

test('F204 an ask redaction withheld makes the instruction scope incomplete, on the session and in a gap', () => {
  const session = sessionOf([{ turn: 1, text: 'keep the public API stable' }, { turn: 2, text: KEY_ASK }]);
  const withheld = session.events.find((e) => e.id === 'I2');
  assert.ok(withheld.omitted && withheld.redacted, 'premise: the ask was redacted away (W3e-3)');
  assert.equal(session.instructionScopeIncomplete, true, 'the session flag says so');
  assert.deepEqual(instructionGaps(session), [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session',
    count: 1, eventIds: ['I2'], sessionKey: session.sessionKey,
    note: NOTES().redaction_withheld }], 'and the gap counts it, naming why');
  assert.equal(instructionReviewScope(session).complete, false);
});

test('F204 "recorder shortened" and "redaction withheld" are two declarations, each counting its own asks', () => {
  const session = sessionOf([{ turn: 1, ...SHORTENED_ASK }, { turn: 2, text: KEY_ASK }, { turn: 3, text: KEY_ASK }]);
  const gaps = instructionGaps(session);
  // OWNER DECISION B (2026-10-01): the recorder-shortened gap names its ask too, as the withheld one always did, so it
  // carries no loss ordinal; the two stay distinct identities by their closed notes (`gapKey`).
  assert.deepEqual(gaps, [
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1,
      eventIds: ['I1'], sessionKey: session.sessionKey, note: NOTES().recorder_shortened },
    { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 2,
      eventIds: ['I2', 'I3'], sessionKey: session.sessionKey, note: NOTES().redaction_withheld },
  ]);
  assert.equal(new Set(gaps.map(gapKey)).size, 2, 'distinct identities: a reader that de-duplicates by gapKey keeps both');
  assert.equal(session.instructionScopeIncomplete, true);
  // M33 R repair: an ask whose pasted material Sonah stripped is declared by its own note, never the recorder's.
  const stripped = sessionOf([{ turn: 1, ...ELIDED_ASK }, { turn: 2, text: KEY_ASK }]);
  assert.deepEqual(instructionGaps(stripped).map((gap) => [gap.count, gap.note]),
    [[1, NOTES().stripped_before_review], [1, NOTES().redaction_withheld]]);
  assert.equal(stripped.instructionScopeIncomplete, true);
});

test('F204 the notes come from one closed table, and the recorder\'s note is unchanged', () => {
  const notes = NOTES();
  assert.equal(Object.isFrozen(notes), true);
  // M33 R: and one for an ask Sonah capped before review, never credited to the recorder; M33 R repair: and one for an
  // ask whose pasted material Sonah stripped before review. L1 review: and one for failed calls on a Claude Code recorder
  // that types no refusal. L1 session-type review: and one for calls refused in a session whose type the recorder did
  // not record. M34 labels: H2's and M5's actor notes are deleted with their fallbacks; the label gaps that replace them
  // have their own closed table (LABEL_GAP_NOTES, test/m34-labels-adapter.test.js).
  // Gain I: and the two nontext notes, the located one (a human message that carried an image) and the unplaced one
  // (the literal the adapter always wrote).
  assert.deepEqual(Object.keys(notes).sort(), ['capped_before_review', 'nontext_attached', 'nontext_unplaced',
    'recorder_shortened', 'redaction_withheld', 'refusal_session_unknown', 'refusal_untyped',
    'stripped_before_review']);
  assert.equal(notes.nontext_unplaced,
    'human input contained nontext blocks that this reviewer could not read');
  assert.doesNotMatch(notes.stripped_before_review, /recorder/);
  assert.equal(notes.recorder_shortened, 'instruction text was elided by the recorder');
  assert.notEqual(notes.redaction_withheld, notes.recorder_shortened);
  const elidedOnly = sessionOf([{ turn: 1, ...ELIDED_ASK }]);
  for (const gap of [...instructionGaps(elidedOnly), ...instructionGaps(sessionOf([{ turn: 1, text: KEY_ASK }]))])
    assert.ok(Object.values(notes).includes(gap.note), gap.note);
  // A session nothing was withheld from declares nothing on the channel.
  const whole = sessionOf([{ turn: 1, text: 'keep the public API stable' }]);
  assert.deepEqual(instructionGaps(whole), []);
  assert.equal(whole.instructionScopeIncomplete, false);
});

// ---- F205 ----------------------------------------------------------------------------------------

const WITHHELD = () => prompts.INSTRUCTION_WITHHELD ?? {};

test('F205 a withheld instruction is rendered with its header and one fixed line, never an empty fence', () => {
  const session = sessionOf([{ turn: 1, text: 'keep the public API stable' }, { turn: 2, text: KEY_ASK }]);
  const [window] = planWindows(session);
  const { prompt, sourceMap } = buildNarrativePrompt({ session, window });
  const line = WITHHELD().redacted;
  assert.equal(typeof line, 'string', 'the line comes from a closed table');
  const at = prompt.indexOf('[I2] HUMAN INSTRUCTION · authority=human');
  assert.ok(at >= 0, 'the header is kept');
  const block = prompt.slice(at, prompt.indexOf('\n\n', at));
  assert.equal(block.split('\n').length, 2, 'the header and one line');
  assert.equal(block.split('\n')[1], `  ${line}`);
  assert.ok(!block.includes('<<<'), 'no fence, empty or otherwise');
  // Nothing of it is quotable: the source map holds no text for it, and the line is not a source.
  assert.ok(sourceMap.I2.every((source) => source.text === ''), 'the source map holds no text for it');
  assert.ok(!JSON.stringify(sourceMap).includes(line));
  for (const quote of [line, 'text withheld', 'redaction removed this instruction'])
    assert.equal(verifyReceipt(session, { eventId: 'I2', role: 'instruction', quote }).ok, false, quote);
  // The other instruction is rendered and grounds as before.
  assert.ok(verifyReceipt(session, { eventId: 'I1', role: 'instruction', quote: 'public API stable' }).ok);
});

test('F205 the table is closed, and the line says what happened without any of the text', () => {
  const table = WITHHELD();
  assert.equal(Object.isFrozen(table), true);
  assert.deepEqual(Object.keys(table), ['redacted']);
  assert.match(table.redacted, /^text withheld: /);
  assert.match(table.redacted, /redaction/);
});

test('F205 an instruction the recorder shortened is still shown as what it kept', () => {
  const session = sessionOf([{ turn: 1, ...ELIDED_ASK }]);
  const [window] = planWindows(session);
  const { prompt } = buildNarrativePrompt({ session, window });
  const at = prompt.indexOf('[I1] HUMAN INSTRUCTION');
  assert.ok(prompt.slice(at).includes('Fix the parser.'), 'its retained words are shown');
  assert.ok(!prompt.includes(WITHHELD().redacted ?? '\u0000'), 'and it is not said to be withheld by redaction');
});
