import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { buildLedger } from '../src/ledger.js';
import { runCodeReview } from '../src/code-review.js';

const repo = { host: 'local', id: 'synthetic' };
// M33 (C-06 "M33 session verdict"): every case below declares its session review complete
// (`sessionCoverage: 'complete'`, or a code review whose session windows all completed) and caps
// coverage only with a recorder limit — a child, outcome or result the recording could not hold.
// That reads NO_FINDINGS, never CLEAN: the gap is still declared and the coverage still partial.
// Before M33 the same reports read UNCHECKED, the status now reserved for a review that did not complete.
const RECORDER_LIMITED = 'NO_FINDINGS';
function review(reason, { kind = 'spawn', status = 'unresolved' } = {}) {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Review the synthetic task.' }],
    delegations: [{ adapter: 'codex', callId: 'safe_call', turn: 1, source: 0,
      kind, status, reason, taskName: '/root/worker',
      parentInstruction: { tool: 'spawn_agent', field: 'message', text: 'Do the synthetic task.' } }],
  }, { sessionKey: 'synthetic-session' });
  return { session, report: buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' }) };
}

test('unverified inventory is not reported as proof that a child recording is absent', () => {
  const { session, report } = review('child_inventory_incomplete');
  const gap = session.adapterGaps.find((g) => g.channel === 'children');
  assert.equal(gap.code, 'incomplete_inventory');
  assert.equal(gap.delegationUnresolved, true);
  assert.equal(gap.note, 'the child recording inventory could not be verified');
  assert.deepEqual(report.gaps.map((g) => g.code), ['incomplete_inventory']);
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('different failed child-link proofs keep distinct closed gap codes', () => {
  const cases = [
    ['child_link_identity_redacted', 'identity_redacted'],
    ['child_link_identity_conflict', 'identity_conflict'],
    ['child_recording_changed', 'source_changed'],
    ['child_recording_unavailable', 'source_unreadable'],
    ['child_recording_limit', 'storage_limit'],
    ['delegation_result_malformed', 'unsupported_message'],
    ['delegation_result_missing', 'missing_result'],
    ['child_link_ambiguous', 'ambiguous_child'],
  ];
  for (const [reason, code] of cases) {
    const { session, report } = review(reason);
    assert.deepEqual(session.adapterGaps.filter((g) => g.channel === 'children').map((g) => g.code), [code], reason);
    assert.deepEqual(report.gaps.map((g) => g.code), [code], reason);
    assert.equal(report.sessionStatus, RECORDER_LIMITED, reason);
  }
});

test('only an unmatched spawn after verified inventory is a missing child; a follow-up can cascade', () => {
  const spawn = review('child_link_unavailable');
  const followup = review('child_link_unavailable', { kind: 'followup' });
  assert.deepEqual(spawn.report.gaps.map((g) => g.code), ['missing_child']);
  assert.deepEqual(followup.report.gaps.map((g) => g.code), ['incomplete_inventory']);
  assert.equal(followup.report.sessionStatus, RECORDER_LIMITED);
});

test('a proven failed spawn has a failed terminal observation and no phantom missing child', () => {
  const { session, report } = review('delegation_spawn_failed', { status: 'failed' });
  const assignment = session.events.find((e) => e.kind === 'invocation' && e.operation === 'delegate');
  assert.equal(session.outcomeOf(assignment.id), 'failed');
  assert.deepEqual(session.adapterGaps.filter((g) => g.channel === 'children'), []);
  assert.deepEqual(report.gaps, []);
});

test('a task-linked Codex child keeps its identity when an earlier child starts linking', () => {
  const child = (path) => ({ source: 0, ledger: {
    ledger: [{ turn: 1, seq: 0, kind: 'edit', path, via: 'apply_patch' }],
  } });
  const delegation = (taskName, source, status) => ({
    adapter: 'codex', kind: 'spawn', turn: 1, source: 0, taskName,
    status, reason: status === 'linked' ? 'child_recording_linked' : 'child_link_unavailable',
    ...(status === 'linked' ? { link: { source } } : {}),
    parentInstruction: { tool: 'spawn_agent', field: 'message', text: 'Do the synthetic task.' },
  });
  const make = (earlierLinked) => sessionFromLedger({
    ask: [{ turn: 1, text: 'Run both tasks.' }],
    sources: [{ adapter: 'codex', sessionId: 'parent-1', identityConflict: false }],
    children: earlierLinked
      ? [{ ...child('src/earlier.js'), source: 0 }, { ...child('src/target.js'), source: 1 }]
      : [{ ...child('src/target.js'), source: 0 }],
    delegations: [delegation('/root/earlier', 0, earlierLinked ? 'linked' : 'unresolved'),
      delegation('/root/target', earlierLinked ? 1 : 0, 'linked')],
  }, { sessionKey: 'synthetic-session' });
  const first = make(false), second = make(true);
  const target = (session) => ({
    link: session.children.find((item) => item.assignmentEvent === 'D1-1'),
    event: session.events.find((item) => item.paths?.some(({ path }) => path === 'src/target.js')),
  });
  const before = target(first), after = target(second);
  assert.equal(before.link.state, 'verified');
  assert.equal(after.link.state, 'verified');
  assert.equal(before.link.childSession, after.link.childSession);
  assert.equal(before.event.id, after.event.id);
  assert.equal(before.event.childId, after.event.childId);
  assert.equal(before.link.childId, before.event.childId);
  assert.equal(after.link.childId, after.event.childId);
  assert.deepEqual(first.actorForActions([before.event]),
    { state: 'verified-child', sessionKey: before.link.childSession, childId: before.event.childId });
  assert.match(before.event.childId, /^tuple\|[a-f0-9]{64}$/);
});

test('an outcome-unknown write caps coverage even when no finding is proposed', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Create the synthetic module.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'src/synthetic.js',
      after: { text: 'export const synthetic = 1;\n' },
      result: { seen: true, outcome: 'unknown', provenance: 'native' } }] },
  { sessionKey: 'synthetic-write' });
  const gap = session.adapterGaps.find((item) => item.code === 'write_outcome_unknown');
  assert.deepEqual(gap.eventIds, ['A1-0']);
  const report = buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  assert.equal(session.adapterGaps.filter((item) => item.code === 'write_outcome_unknown').length, 1);
});

test('a command with output but no known exit status caps coverage', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Run the synthetic test.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'unknown',
      tailLines: ['synthetic test output'] }] }, { sessionKey: 'synthetic-test' });
  assert.deepEqual(session.adapterGaps.filter((item) => item.code === 'command_outcome_unknown')
    .map((item) => item.eventIds), [['A1-0']]);
  assert.equal(buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' }).sessionStatus, RECORDER_LIMITED);
});

test('a known failed result is evidence of failure and does not declare outcome unknown', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Try the synthetic write.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'src/synthetic.js',
      after: { text: 'export const synthetic = 1;\n' },
      result: { seen: true, outcome: 'failed', provenance: 'native' } }] },
  { sessionKey: 'synthetic-failure' });
  assert.equal(session.adapterGaps.filter((item) => item.code === 'write_outcome_unknown').length, 0);
});

test('a complete empty-finding code review cannot turn an unknown write result into CLEAN', async () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Create the synthetic module.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'src/synthetic.js',
      after: { text: 'export const synthetic = 1;\n' },
      result: { seen: true, outcome: 'unknown', provenance: 'native' } }] },
  { sessionKey: 'synthetic-empty-review' });
  const diff = ['diff --git a/src/synthetic.js b/src/synthetic.js', 'new file mode 100644',
    '--- /dev/null', '+++ b/src/synthetic.js', '@@ -0,0 +1 @@',
    '+export const synthetic = 1;', ''].join('\n');
  const pr = { repo, number: 1, baseOid: 'b'.repeat(40), diffBaseOid: 'b'.repeat(40),
    headOid: 'a'.repeat(40), gitAlgorithm: 'sha1', enumeration: 'complete',
    files: [{ path: 'src/synthetic.js', change: 'added', contentState: 'complete' }] };
  const judge = async (request) => ({ decisions: [], pivots: [], claims: [], requirements: [],
    codeFindings: [], sessionFindings: [],
    reviewedFiles: request.label?.startsWith('code+chunk:') ? ['src/synthetic.js'] : [] });
  const report = await runCodeReview({ session, pr, diff, judge });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
  assert.notEqual(report.reviewStatus, 'CLEAN');
  assert.deepEqual(report.gaps.filter((item) => item.code === 'write_outcome_unknown')
    .map((item) => item.eventIds), [['A1-0']]);
});

test('green-looking command output does not establish exit status without typed proof', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Run the synthetic checks.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'passed',
      outcomeSource: 'parsed-output', tailLines: ['1 passed'] }] },
  { sessionKey: 'synthetic-parsed-status' });
  const observation = session.events.find((event) => event.kind === 'observation');
  // H1: an older ledger's pass read from output text is no result: `unknown`, never `succeeded`.
  assert.equal(observation.result, 'unknown');
  assert.equal(observation.sourceOfResult, 'unknown');
  assert.equal(observation.terminalStatusProven, false);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown')
    .map((gap) => gap.eventIds), [['A1-0']]);
});

test('typed native exit closes the exit-status gap even if test semantics remain unknown', () => {
  for (const exitCode of [0, 1]) {
    const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Run the synthetic checks.' }],
      ledger: [{ turn: 1, seq: 0, kind: 'test', cmd: 'npm test', outcome: 'unknown',
        exitCode, exitCodeSource: 'native', tailLines: ['unclassified test log'] }] },
    { sessionKey: `synthetic-typed-${exitCode}` });
    const observation = session.events.find((event) => event.kind === 'observation');
    assert.equal(observation.result, 'unknown');
    assert.equal(observation.terminalStatusProven, true);
    assert.equal(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown').length, 0);
  }
});

test('an interrupted or conflicting numeric result does not prove terminal completion', () => {
  for (const flag of ['interrupted', 'conflict']) {
    const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Run the synthetic build.' }],
      ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'make build', outcome: 'unknown',
        exitCode: 0, exitCodeSource: 'native', [flag]: true }] },
    { sessionKey: `synthetic-${flag}` });
    assert.equal(session.events.find((event) => event.kind === 'observation').terminalStatusProven, false);
    assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown')
      .map((gap) => gap.eventIds), [['A1-0']]);
  }
});

test('a shell write inherits only a proved command status', () => {
  const session = sessionFromLedger({ ask: [{ turn: 1, text: 'Update the synthetic source.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: "sed -i 's/a/b/' src/synthetic.js",
      outcome: 'passed', outcomeSource: 'parsed-output' },
    { turn: 1, seq: 1, kind: 'edit', path: 'src/synthetic.js', via: 'sed -i' }] },
  { sessionKey: 'synthetic-shell-status' });
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'write_outcome_unknown')
    .map((gap) => gap.eventIds), [['A1-1']]);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'command_outcome_unknown')
    .map((gap) => gap.eventIds), [['A1-0']]);
});
