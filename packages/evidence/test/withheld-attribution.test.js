// W3e-5 / F212 — the header says who withheld an instruction.
//
// The review header said "N instruction(s) were elided by the recorder" while N counted every omitted
// instruction (ledger.js `sessionCoverageFacts`), so asks REDACTION withheld (W3e-3 / F198, W3e-4 /
// F204) were credited to the recorder. The count is now split by cause: `instructionsElided` counts
// the recorder's elisions only, `instructionsWithheld` the asks redaction left no words of, and each
// has its own closed phrase. A declared instructions-channel gap is named by the cause its note (the
// adapter's closed INSTRUCTION_GAP_NOTES) says. Tested alone and together, from a real redaction
// through the adapter, and on a report written before the split.
//
// Every fixture is synthetic; the key block is assembled at run time. No model is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, INSTRUCTION_GAP_NOTES } from '../adapters/sonah-ledger.js';
import * as review from '../src/review.js';
import * as ledgerModule from '../src/ledger.js';

const { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } = review;
const { sessionCoverageFacts, coverageFrom, honestStatuses } = ledgerModule;

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const keyLine = (i) => Array.from({ length: 64 }, (_, k) => B64[(i * 29 + k * 37 + ((k * k) % 11)) % 64]).join('');
/** An ask that is only a pasted key block. */
const KEY_ASK = [BEGIN, keyLine(0), keyLine(1), END].join('\n');
/** That ask as an earlier Sonah's redactor left it: no word of it. D90 (owner decision 2026-10-15): no Sonah withholds
 *  an ask now (`redact` keeps KEY_ASK as recorded, below); a ledger an earlier one wrote is still read. */
const withheld = (turn) => ({ turn, text: '', redacted: true, redactedLines: 4 });
/** An ask the recorder shortened: an elision of a kind no version of Sonah writes. (M33 R repair: a strip of pasted
 *  material, `[code block, N lines, M chars]`, is Sonah's, declared as stripped before review — `STRIPPED_ASK`.) */
const ELIDED_ASK = { text: 'Fix the parser.\nKeep the tests green.', elided: [{ what: 'recorder clip', chars: 1200 }] };
const STRIPPED_ASK = { text: 'Fix the parser.\n[code block, 40 lines, 1200 chars]\nKeep the tests green.',
  elided: [{ what: 'code block', chars: 1200 }] };

const RECORDER = /the recorder shortened/;
const WITHHELD = /redaction removed/;

function sessionOf(asks) {
  const { ledger } = redact(led({ ask: asks, ledger: [{ turn: 9, seq: 0, kind: 'bash',
    cmd: 'npm test', outcome: 'passed', exitCode: 0, exitCodeSource: 'native' }] }));
  return sessionFromLedger(ledger, { sessionKey: 'w3e5-f212' });
}

const REPO = { host: 'github.com', id: '212' };
const PR = { repo: REPO, number: 212, enumeration: 'complete', files: [{ path: 'src/a.js', change: 'modified', contentState: 'complete' }] };
/** Facts that reduce to `complete` but for what `over` adds. */
const FACTS = (over = {}) => ({ windows: 2, windowsWithNarrative: 2, windowsFailed: 0, actions: 3, instructions: 3,
  instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 0, declared: 'complete', ...over });
const report = (gaps, facts) => ({ repo: REPO, pr: PR, session: null, hasSessionEvidence: true, coverageFacts: facts,
  codeCoverageFacts: { placed: ['src/a.js'] }, decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [], gaps,
  counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
  coverage: 'complete', codeCoverage: 'complete' });
/** The coverage causes as every reader names them (the CLI's and the page's "Not covered" line), or null for none. */
const headerOf = (r) => { const causes = coverageCauses(r);
  return causes.length ? `Not covered: ${causes.map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ')}.` : null; };
const recorderGap = (count) => ({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count,
  note: INSTRUCTION_GAP_NOTES.recorder_shortened });
const withheldGap = (count, eventIds) => ({ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count,
  eventIds, note: INSTRUCTION_GAP_NOTES.redaction_withheld });

// ---- the facts ------------------------------------------------------------------------------------

test('F212 the facts count the recorder\'s elisions and redaction\'s withholdings apart', () => {
  const session = sessionOf([{ turn: 1, ...ELIDED_ASK }, withheld(2), withheld(3),
    { turn: 4, text: 'keep the public API stable' }]);
  const facts = sessionCoverageFacts({ session, windows: [{}], perWindow: [] });
  assert.equal(facts.instructions, 4);
  assert.equal(facts.instructionsElided, 1, 'the recorder shortened one ask');
  assert.equal(facts.instructionsWithheld, 2, 'redaction left no words of two');
  // M33 R repair: an ask whose pasted material Sonah stripped is neither: its own declared gap names it.
  const stripped = sessionOf([{ turn: 1, ...STRIPPED_ASK }, withheld(2)]);
  const strippedFacts = sessionCoverageFacts({ session: stripped, windows: [{}], perWindow: [] });
  assert.deepEqual([strippedFacts.instructionsElided, strippedFacts.instructionsWithheld], [0, 1]);
});

test('F212 an instruction redaction withheld still caps coverage on its own', () => {
  assert.equal(coverageFrom(FACTS({ instructionsWithheld: 1 })), 'partial');
  assert.equal(coverageFrom(FACTS()), 'complete', 'premise: nothing else caps');
  const r = report([], FACTS({ instructionsWithheld: 1 }));
  assert.notEqual(honestStatuses(r).coverage, 'complete');
});

// ---- the header -------------------------------------------------------------------------------------

test('F212 the recorder\'s elisions alone are credited to the recorder', () => {
  const header = headerOf(report([recorderGap(2)], FACTS({ instructionsElided: 2 })));
  assert.equal(header, `Not covered: ${COVERAGE_SENTENCE.instructions_elided({ n: 2 })}.`);
  assert.match(header, RECORDER);
  assert.doesNotMatch(header, WITHHELD);
});

test('F212 redaction\'s withholdings alone are never credited to the recorder', () => {
  const header = headerOf(report([withheldGap(2, ['I2', 'I3'])], FACTS({ instructionsWithheld: 2 })));
  assert.equal(header, 'Not covered: redaction removed 2 messages of yours.');
  assert.doesNotMatch(header, RECORDER);
});

test('F212 both together: each cause is named once, with its own count, in the fixed order', () => {
  const r = report([recorderGap(1), withheldGap(2, ['I2', 'I3'])], FACTS({ instructionsElided: 1, instructionsWithheld: 2 }));
  assert.deepEqual(coverageCauses(r).map(([cause, { n }]) => [cause, n]),
    [['instructions_elided', 1], ['instructions_withheld', 2]]);
  assert.equal(headerOf(r),
    'Not covered: the recorder shortened 1 message of yours; redaction removed 2 messages of yours.');
});

test('F212 a declared gap is named by the cause its note says, when no fact counts it', () => {
  // A declaration read without facts that count it (a report whose facts were computed elsewhere).
  const facts = FACTS({ windowsFailed: 1 });
  const withheld = headerOf(report([withheldGap(1, ['I2'])], facts));
  assert.match(withheld, /redaction removed 1 message of yours/);
  assert.doesNotMatch(withheld, RECORDER);
  const shortened = headerOf(report([recorderGap(3)], facts));
  assert.match(shortened, /the recorder shortened 3 messages of yours/);
  assert.doesNotMatch(shortened, WITHHELD);
});

test('F212 from a persisted redaction through the adapter: the header names each cause by its own count', () => {
  assert.equal(sessionOf([{ turn: 1, text: KEY_ASK }]).instructionScopeIncomplete, false, 'D90: today, as recorded');
  const session = sessionOf([{ turn: 1, ...ELIDED_ASK }, withheld(2), withheld(3)]);
  const facts = sessionCoverageFacts({ session, windows: [{}, {}],
    perWindow: [{ narrative: 'n', challenge: { complete: true }, groundingComplete: true },
      { narrative: 'n', challenge: { complete: true }, groundingComplete: true }] });
  const r = { ...report([], facts), session };
  assert.equal(headerOf(r),
    'Not covered: the recorder shortened 1 message of yours; redaction removed 2 messages of yours.');
  const onlyWithheld = sessionOf([withheld(2)]);
  const f2 = sessionCoverageFacts({ session: onlyWithheld, windows: [{}],
    perWindow: [{ narrative: 'n', challenge: { complete: true }, groundingComplete: true }] });
  const header = headerOf({ ...report([], f2), session: onlyWithheld });
  assert.equal(header, 'Not covered: redaction removed 1 message of yours.');
  // M33 R repair: a strip of pasted material is named as Sonah's, never as the recorder's.
  const stripped = sessionOf([{ turn: 1, ...STRIPPED_ASK }, withheld(2)]);
  const f3 = sessionCoverageFacts({ session: stripped, windows: [{}],
    perWindow: [{ narrative: 'n', challenge: { complete: true }, groundingComplete: true }] });
  const strippedHeader = headerOf({ ...report([], f3), session: stripped });
  assert.equal(strippedHeader, 'Not covered: redaction removed 1 message of yours; Sonah put a stub in place of material '
    + 'that you pasted into 1 message of yours, so it cannot quote that material.');
  assert.doesNotMatch(strippedHeader, RECORDER);
});

test('F212 a report written before the split: its one count is divided by the declarations\' notes', () => {
  // Then, `instructionsElided` counted every omitted instruction and there was no `instructionsWithheld`.
  const old = FACTS({ instructionsElided: 3 });
  delete old.instructionsWithheld;
  const r = report([recorderGap(1), withheldGap(2, ['I2', 'I3'])], old);
  assert.equal(headerOf(r),
    'Not covered: the recorder shortened 1 message of yours; redaction removed 2 messages of yours.');
  const allWithheld = report([withheldGap(2, ['I2', 'I3'])], { ...old, instructionsElided: 2 });
  assert.equal(headerOf(allWithheld), 'Not covered: redaction removed 2 messages of yours.');
});

test('F212 the phrasebook is closed: the new cause has one sentence, and it names no recorder', () => {
  assert.ok(COVERAGE_CAUSES.includes('instructions_withheld'));
  assert.equal(COVERAGE_CAUSES.indexOf('instructions_withheld'), COVERAGE_CAUSES.indexOf('instructions_elided') + 1);
  assert.deepEqual(Object.keys(COVERAGE_SENTENCE).sort(), [...COVERAGE_CAUSES].sort());
  assert.equal(COVERAGE_SENTENCE.instructions_withheld({ n: 2 }), 'redaction removed 2 messages of yours');
  assert.equal(COVERAGE_SENTENCE.instructions_withheld({ n: null }), 'redaction removed some messages of yours');
  assert.doesNotMatch(COVERAGE_SENTENCE.instructions_withheld({ n: 1 }), /recorder/);
});
