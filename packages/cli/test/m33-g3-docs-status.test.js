// M33 G3, amended by D71 (a) (owner decision 2026-10-08: no verdict anywhere the human sees). What README.md and
// docs/INSTALL.md say about the exit code and the statuses must be what the code does:
//   - The exit code reports only whether Sonah's own review ran: 0 complete, 1 incomplete, 3 failed. A finding never
//     moves it, and neither do the recording's declared limits.
//   - No doc tells a reader a status (DECIDE, FYI, CLEAN, NO_FINDINGS, UNCHECKED) as something Sonah shows.
// The behaviour is checked on synthetic reports first, so the docs are held to the code, not to themselves. No
// recording, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Session } from '../../evidence/src/session.js';
import { honestStatuses } from '../../evidence/src/ledger.js';
import { reviewExitCode } from '../src/session-review-command.js';

const README = await readFile(new URL('../../../README.md', import.meta.url), 'utf8');
const INSTALL = await readFile(new URL('../../../docs/INSTALL.md', import.meta.url), 'utf8');
const TROUBLESHOOTING = await readFile(new URL('../../../docs/TROUBLESHOOTING.md', import.meta.url), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

function sessionWithLimit() {
  const blobs = { ask: 'SYNTHETIC_G3_DOCS ask', cmd: 'npm test', out: 'SYNTHETIC_G3_DOCS 3 passed' };
  const whole = (k) => [{ sourceKey: k, fromByte: 0, untilByte: Buffer.byteLength(blobs[k]) }];
  const session = new Session({ sessionKey: 's', blobs, events: [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', supersedes: [], text: whole('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, callKey: 'a1', tool: 'Bash', operation: 'command', paths: [],
      command: whole('cmd'), input: [], changes: [] },
    { id: 'A1-r', kind: 'observation', sequence: 2, invocation: 'A1', callKey: 'a1', phase: 'terminal', result: 'succeeded',
      exitCode: 0, terminalStatusProven: true, output: whole('out'), sourceOfResult: 'native' }] });
  session.adapterGaps = [{ code: 'command_outcome_unknown', channel: 'observations', scope: 'session', count: 2 }];
  return session;
}
const FACTS = { windows: 1, windowsWithNarrative: 1, windowsFailed: 0, actions: 1, reviewableEvents: 3, instructions: 1,
  instructionsElided: 0, instructionsWithheld: 0, delegationsUnlinked: 0, adapterGaps: 1, pairGaps: 0, declared: null };
const reportOf = (over) => ({ reviewScope: 'combined', pr: null, codeCoverage: 'complete', decisions: [],
  hasSessionEvidence: true, findings: [], counts: { decisions: 0, byColumn: {} }, coverageFacts: FACTS, gaps: [],
  session: sessionWithLimit(), sessionReview: 'complete', ...over });

test('D71 premise: a completed review exits 0 with or without findings and over recorder limits; an incomplete one 1', () => {
  const withFinding = { ...reportOf({ findings: [{ origin: 'code-review', status: 'FYI', kind: 'code_issue', receipts: [] }] }) };
  assert.equal(honestStatuses(withFinding).sessionReview, 'complete', 'premise: the session review completed');
  assert.equal(honestStatuses(withFinding).coverage, 'partial', 'premise: over a declared recorder limit');
  assert.equal(reviewExitCode(withFinding), 0);
  assert.equal(reviewExitCode(reportOf({ findings: [{ origin: 'session-review', status: 'DECIDE', kind: 'edit_not_asked_for',
    receipts: [] }] })), 0, 'a finding never moves the exit');
  assert.equal(reviewExitCode(reportOf({})), 0);
  assert.equal(reviewExitCode(reportOf({ sessionReview: 'incomplete' })), 1);
  assert.equal(reviewExitCode(reportOf({ codeCoverage: 'partial' })), 1, 'a code review that did not read every file');
  assert.equal(reviewExitCode(null), 3);
});

const STATUS_WORDS = /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/;

test('D71 README: no status is told, and the exit codes are left to the guide', () => {
  // The README is the short front page (owner decision 2026-10-15); the exit codes are told in TROUBLESHOOTING and
  // INSTALL, checked below, and the README only links to them.
  const text = flat(README);
  assert.ok(/\(docs\/TROUBLESHOOTING\.md\)/.test(text), 'the troubleshooting guide is linked');
  assert.ok(!/^\| `[0-9]+` \|/m.test(README), 'the exit-code table is kept in one place, not repeated here');
  assert.ok(!STATUS_WORDS.test(text), 'no status is told');
});

test('the one exit-code table (docs/TROUBLESHOOTING.md): the run state, and no status is told', () => {
  const text = flat(TROUBLESHOOTING);
  assert.ok(/The exit code reports only whether Sonah's own review ran/.test(text), 'the exit is the run state');
  assert.ok(/a review with findings that ran to the end exits `0`/.test(text), 'a finding never moves the exit');
  assert.ok(/\| `1` \| Sonah's review ran but did not complete/.test(text), 'exit 1 is incomplete');
  assert.ok(/\| `3` \| Sonah's review failed/.test(text), 'exit 3 is failed');
  assert.ok(!STATUS_WORDS.test(text), 'no status is told');
});

test('D71 INSTALL: the exit code is the run state, and no status is told', () => {
  const text = flat(INSTALL);
  assert.ok(/Exit codes report only whether Sonah's own review ran/.test(text), 'the exit is the run state');
  assert.ok(/A review with findings that ran to the end exits `0`/.test(text), 'a finding never moves the exit');
  assert.ok(/It never gives a verdict on the agent's work/.test(text), 'no verdict');
  assert.ok(!STATUS_WORDS.test(text), 'no status is told');
});
