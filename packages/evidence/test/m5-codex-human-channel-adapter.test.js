// M5 (C-02 "M5 Codex human channel"); M34 labels (C-02 "Slice-time labels") at the
// evidence adapter: messages of a rollout (or rows of a recorder) with no typed human channel that the declared legacy
// fallback set aside as harness by their structure alone (`capture.labelGaps.legacy_recorder`) are declared as one
// unlocated instructions gap with their own closed note, named by their own coverage cause, so the human instruction
// history is complete at no bound (precision over recall).
//
// Every fixture is synthetic. No model is called.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger, LABEL_GAP_NOTES } from '../adapters/sonah-ledger.js';
import { coverageCauses, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { instructionReviewScope } from '../src/ledger.js';

/** The coverage causes as every reader names them (the CLI's and the page's "Not covered" line). */
const causeLine = (report) => coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ');

const led = (capture) => ({ ask: [{ turn: 1, text: 'Fix the parser.' }], ledger: [{ turn: 1, seq: 0, kind: 'bash',
  cmd: 'npm test', outcome: 'passed', exitCode: 0, exitCodeSource: 'native' }], claim: { finalMessage: '' }, dropped: [],
...(capture ? { capture: { calls: 0, wrappers: 0, captured: 0, unsupported: 0, missing: 0, unmapped: 0, reasons: [],
  incomplete: false, ...capture } } : {}) });
const NOTE = LABEL_GAP_NOTES.legacy_recorder[1];
const gapsOf = (session) => (session.adapterGaps ?? []).filter((gap) => gap.note === NOTE);

test('M5; M34 labels: a legacy fallback count is one unlocated instructions gap; none without it', () => {
  const none = sessionFromLedger(led(), { sessionKey: 'm5-none' });
  assert.deepEqual(gapsOf(none), []);
  assert.equal(instructionReviewScope(none).complete, true);
  const zero = sessionFromLedger(led({ labelGaps: { legacy_recorder: 0 } }), { sessionKey: 'm5-zero' });
  assert.deepEqual(gapsOf(zero), []);
  const two = sessionFromLedger(led({ labelGaps: { legacy_recorder: 2 } }), { sessionKey: 'm5-two' });
  assert.deepEqual(gapsOf(two).map((gap) => [gap.code, gap.channel, gap.scope, gap.count, Object.hasOwn(gap, 'eventIds')]),
    [['incomplete_inventory', 'instructions', 'session', 2, false]]);
  assert.equal(instructionReviewScope(two).complete, false);
  assert.equal(instructionReviewScope(two, { upTo: 0 }).complete, false, 'a loss at every bound');
  // A value that is not a count still declares the loss, uncounted (fail closed).
  const bad = sessionFromLedger(led({ labelGaps: { legacy_recorder: 'two' } }), { sessionKey: 'm5-bad' });
  assert.deepEqual(gapsOf(bad).map((gap) => gap.count), [null]);
});

test('M5; M34 labels: the loss is named by its own cause, never by the recorder\'s', () => {
  assert.ok(COVERAGE_CAUSES.includes('labels_legacy_recorder'));
  for (const retired of ['instructions_unattributed', 'instructions_unattributed_structure', 'instructions_wordless'])
    assert.equal(COVERAGE_CAUSES.includes(retired), false, retired);
  // M34 labels review (F6): every row the fallback labelled is counted, whichever way it read it.
  // D100: the fallback also labels a row of no plain version, so "an old recorder" is not proved: said as what Sonah reads.
  assert.equal(COVERAGE_SENTENCE.labels_legacy_recorder({ n: 1 }), '1 record carries no mark of your messages that Sonah '
    + 'can read, so Sonah could not check whether it holds a message of yours');
  const report = { repo: { host: 'github.com', id: 'm5' }, pr: null, session: null, hasSessionEvidence: true,
    coverageFacts: { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, instructions: 1,
      instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 1, declared: 'partial' },
    decisions: [], findings: [], rejectedDecisions: [], rejectedFindings: [],
    gaps: [{ code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 2, note: NOTE }],
    counts: { decisions: 0, byColumn: {}, uncheckedColumn: 0, rejectedDecisions: 0, rejectedFindings: 0 },
    coverage: 'partial', codeCoverage: 'complete' };
  assert.deepEqual(coverageCauses(report).map(([cause, { n }]) => [cause, n]), [['labels_legacy_recorder', 2]]);
  const header = causeLine(report);
  assert.match(header, /2 records carry no mark of your messages that Sonah can read/);
  assert.doesNotMatch(header, /opening words|elided by the recorder/);
});
