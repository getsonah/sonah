import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Session, verifyReceipt } from '../src/session.js';
import { redisPivotSession, redisPivotPr } from '../fixtures/redis-pivot.js';
import { buildLedger, coverageFrom, gapKey, groundDecision, honestStatuses, instructionReviewScope,
  sessionCoverageFacts, unrecordedCover } from '../src/ledger.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { runReview } from '../src/run-review.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';

const repo = { host: 'github.com', id: '1' };
const quiet = async () => ({ decisions: [], pivots: [], claims: [], requirements: [] });
// M33 (C-06 "M33 session verdict"): the reviews below COMPLETE — every window answered, challenged
// and grounded — and their coverage is partial only by a recorder limit the adapter declared (a
// capture, redaction, outcome, child or pair gap). That reads NO_FINDINGS: never CLEAN, always
// shown with the partial coverage and its causes. Before M33 it read UNCHECKED, which now means
// the review itself did not complete.
const RECORDER_LIMITED = 'NO_FINDINGS';

function writeSession(receipts) {
  const source = redisPivotSession();
  const events = structuredClone(source.events).filter((event) => event.id !== 'E4');
  events.splice(3, 0, ...receipts.map((receipt, index) => ({ id: `E4-${index}`, kind: 'observation',
    sequence: 3 + index, invocation: 'E3', callKey: 'c1', phase: 'terminal',
    output: [], exitCode: null, ...receipt })));
  return new Session({ sessionKey: source.sessionKey, adapter: source.adapter,
    events, blobs: structuredClone(source.blobs) });
}

function adoptedPath(session) {
  const pr = redisPivotPr();
  pr.enumeration = 'complete';
  pr.files[0].contentState = 'complete';
  return groundDecision({ repo: pr.repo, session, pr, instructionHistoryComplete: true,
    candidate: { actorSession: session.sessionKey, dimension: 'cache config', chosen: 'Redis',
      actions: ['E3'], value: 'config/redis.yml',
      valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
      stated: null, constrainedBy: null } });
}

test('M29 direct write adoption needs exactly one typed terminal success', () => {
  const status = { result: 'succeeded', terminalStatusProven: true, sourceOfResult: 'native' };
  const proven = writeSession([status]);
  assert.equal(proven.actionOutcomeOf('E3'), 'succeeded');
  assert.equal(proven.succeeded('E3'), true);
  assert.equal(adoptedPath(proven).decision.valueState, 'grounded');

  for (const receipts of [
    [{ ...status, terminalStatusProven: false, sourceOfResult: 'parsed-output' }],
    [{ ...status, sourceOfResult: 'parsed-output' }],
    [status, status],
    [status, { ...status, result: 'failed' }],
  ]) {
    const uncertain = writeSession(receipts);
    assert.equal(uncertain.actionOutcomeOf('E3'), 'unknown');
    assert.equal(uncertain.succeeded('E3'), false);
    const decision = adoptedPath(uncertain);
    assert.equal(decision.decision.valueState, 'unchecked');
    assert.notEqual(decision.decision.relevance, 'survives');
  }
  const failed = writeSession([{ result: 'failed', terminalStatusProven: true, sourceOfResult: 'native' }]);
  assert.equal(failed.actionOutcomeOf('E3'), 'failed');
  assert.equal(adoptedPath(failed).decision.valueState, 'unchecked');
});

function delegated({ followup = false } = {}) {
  const child = { ask: [], ledger: [], commentary: [{ turn: 1, record: 1, block: 0,
    text: 'First task done.' }], capture: { incomplete: false, reasons: [] } };
  const delegations = [{ adapter: 'codex', kind: 'spawn', turn: 1, childId: 'worker-1',
    status: 'linked', source: 0, link: { source: 0 },
    parentInstruction: { text: 'Do the first task.', tool: 'collaboration.spawn_agent' } }];
  if (followup) delegations.push({ adapter: 'codex', kind: 'followup', turn: 2,
    childId: 'worker-1', status: 'linked', source: 0, link: { source: 0 },
    parentInstruction: { text: 'Do the second task.', tool: 'collaboration.followup_task' } });
  return sessionFromLedger({ ask: [{ turn: 1, text: 'Ask the child to work.' },
    ...(followup ? [{ turn: 2, text: 'Ask for the second task.' }] : [])],
  ledger: [], children: [{ source: 0, ledger: child }], delegations,
  capture: { incomplete: false, reasons: [] } }, { sessionKey: 'synthetic-parent' });
}

test('M29 verified child identity does not certify a follow-up with no child delta', async () => {
  const spawnOnly = delegated();
  assert.equal(spawnOnly.children[0].state, 'verified');
  assert.equal(spawnOnly.adapterGaps.filter((gap) => gap.channel === 'children').length, 0);
  const followup = delegated({ followup: true });
  const edges = followup.children.filter((link) => link.relation === 'followup');
  assert.equal(edges.length, 1);
  assert.equal(edges[0].state, 'verified');
  assert.equal(edges[0].assignmentEffectProven, false);
  const gaps = followup.adapterGaps.filter((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'children' && gap.eventIds?.includes(edges[0].assignmentEvent));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].count, 1);
  assert.equal(verifyReceipt(followup, { eventId: edges[0].assignmentEvent,
    role: 'action', quote: 'Do the second task.' }).ok, true);
  assert.equal(verifyReceipt(followup, { eventId: edges[0].assignmentEvent,
    role: 'instruction', quote: 'Do the second task.' }).ok, false);
  const report = await runReview({ session: followup, pr: null, judge: quiet });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('M29 a placed PR path cannot cover an unrecorded historical body', () => {
  const gap = { code: 'unrecorded_body', channel: 'code', scope: 'session', count: 1,
    writes: [{ eventId: 'A1', path: 'src/a.js', outsideRepository: false }] };
  const pr = { files: [{ path: 'src/a.js', change: 'modified', contentState: 'complete' }] };
  assert.equal(unrecordedCover(gap, { pr, placed: ['src/a.js'] }).capping, 1);
  assert.equal(unrecordedCover(gap, { pr, placed: [] }).capping, 1);
  const external = { ...gap, writes: [{ ...gap.writes[0], outsideRepository: true }] };
  assert.equal(unrecordedCover(external, { pr, placed: [] }).capping, 0);
});

function transferredScratch({ childCapture = { incomplete: false, reasons: [] },
  observationRedacted = false } = {}) {
  const child = { ask: [{ turn: 1, text: 'Write only a scratch note.' }], ledger: [
    { turn: 1, seq: 0, kind: 'bash', cmd: 'echo x > /tmp/note.js', outcome: 'passed',
      exitCode: 0, exitCodeSource: 'native', tailLines: [], observationRedacted },
    { turn: 1, seq: 1, kind: 'edit', path: 'tmp/note.js', via: 'redirect',
      external: true, shellWriteStatusEligible: true },
  ], capture: childCapture };
  const parent = { ask: [{ turn: 1, text: 'Delegate a scratch note.' }], ledger: [],
    children: [{ source: 0, ledger: child }], delegations: [{ adapter: 'codex', kind: 'spawn',
      turn: 1, childId: 'worker', status: 'linked', source: 0, link: { source: 0 },
      parentInstruction: { text: 'Write only a scratch note.', tool: 'collaboration.spawn_agent' } }],
    capture: { incomplete: false, reasons: [] } };
  return sessionFromLedger(parent, { sessionKey: 'parent' });
}

test('M29 a linked child outside-repository body gap stays noncapping after transfer', async () => {
  const session = transferredScratch();
  assert.equal(session.children[0].state, 'verified');
  assert.deepEqual(session.adapterGaps.map((gap) => gap.code), ['unrecorded_body']);
  assert.equal(unrecordedCover(session.adapterGaps[0]).capping, 0);
  assert.deepEqual(session.adapterGaps[0].eventIds, ['child:worker:A1-1']);
  const report = await runReview({ session, pr: null, judge: quiet });
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.coverage, 'complete');
});

test('M29 transferred child losses keep their own channel and canonical event IDs', async () => {
  const session = transferredScratch({ observationRedacted: true });
  const observationGap = session.adapterGaps.find((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'observations');
  assert.deepEqual(observationGap.eventIds, ['child:worker:A1-0-r']);
  assert.equal(observationGap.sessionKey, 'parent/child:worker');
  assert.equal(session.adapterGaps.some((gap) => gap.channel === 'children'), false);
  const report = await runReview({ session, pr: null, judge: quiet });
  assert.equal(report.sessionStatus, RECORDER_LIMITED);

  const incomplete = transferredScratch({ childCapture: { incomplete: true,
    reasons: ['source_unreadable'] } });
  assert.equal(incomplete.adapterGaps.some((gap) => gap.channel === 'children'
    && gap.code === 'incomplete_inventory'), true,
  'an explicitly incomplete child capture still caps its parent');
});

test('M29 a verified child instruction loss cannot erase the root human inventory', () => {
  const session = transferredScratch({ childCapture: { incomplete: false, reasons: [],
    instructionsNonText: 1 } });
  const childGap = session.adapterGaps.find((gap) => gap.channel === 'instructions');
  assert.equal(childGap.sessionKey, 'parent/child:worker');
  assert.equal(instructionReviewScope(session).complete, true);

  childGap.sessionKey = 'unverified-child';
  assert.equal(instructionReviewScope(session).complete, false,
    'unverified child provenance must fail closed');
  childGap.sessionKey = 'parent/child:worker';
  childGap.eventIds = [session.events.find((event) => event.kind === 'instruction'
    && event.childId == null).id];
  assert.equal(instructionReviewScope(session).complete, false,
    'a child-labelled gap that names a root event must fail closed');
});

test('M29 a requested session-only reducer keeps PR relevance visible without capping session work', () => {
  const session = redisPivotSession();
  const report = buildLedger({ repo, session, pr: null, reviewScope: 'session-only',
    sessionCoverage: 'complete', codeCoverage: 'missing', candidates: [{
      actorSession: session.sessionKey, dimension: 'cache config', chosen: 'Redis',
      actions: ['E3'], value: 'config/redis.yml',
      valueReceipt: { eventId: 'E3', field: 'path', role: 'action', quote: 'config/redis.yml' },
      stated: null, constrainedBy: null,
    }] });
  assert.equal(report.decisions[0].relevance, 'unchecked');
  assert.equal(report.reviewScope, 'session-only');
  assert.equal(report.coverage, 'complete');
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.codeStatus, 'UNCHECKED');
  assert.equal(report.reviewStatus, 'CLEAN');
  assert.equal(honestStatuses(report).reviewStatus, 'CLEAN');

  for (const addition of [{ pr: redisPivotPr() }, { codeJudgment: { state: 'complete' } },
    { codeCoverageFacts: { placed: ['config/redis.yml'] } },
    { codeCoverage: 'complete' }, { findings: [{ origin: 'code-review', status: 'FYI' }] },
    { findings: [{ origin: 'unknown', status: 'FYI' }] },
    { judgments: [{ capability: 'code', state: 'complete' }] },
    { codeFindings: [{ status: 'FYI' }] }, { codeChallenges: [{ complete: true }] },
    { codeFindingCandidates: [{}] }, { rejectedCodeFindings: [{}] },
    { findingFunnel: { direct: { code: { proposed: 1 } } } },
    { findingFunnel: { final: { code: 1 } } },
    { gaps: [{ code: 'code_unreviewable', channel: 'code', scope: 'pr', count: 1 }] }]) {
    const joined = honestStatuses({ ...report, ...addition });
    assert.equal(joined.reviewScope, 'combined', 'a later code/PR join invalidates session-only scope');
    assert.equal(joined.reviewStatus, 'UNCHECKED');
  }
  const suppliedPr = buildLedger({ repo, session, pr: redisPivotPr(), reviewScope: 'session-only',
    sessionCoverage: 'complete', codeCoverage: 'missing' });
  assert.equal(suppliedPr.reviewScope, 'combined');
  assert.equal(suppliedPr.reviewStatus, 'UNCHECKED');
});

function communicationChild({ count = 2, sole = true, otherLoss = false } = {}) {
  return { ask: [{ turn: 1, text: 'Complete the synthetic child task.' }], ledger: [],
    capture: { incomplete: true, genericIncomplete: !sole,
      interAgentMessagesUnparsed: count, interAgentMessagesSoleIncomplete: sole,
      ...(otherLoss ? { unsupportedRowChannels: { actions: 1 } } : {}),
      reasons: otherLoss ? ['unsupported_tool'] : ['inter_agent_messages_unparsed'] } };
}

function linkedCommunication(child) {
  return sessionFromLedger({ ask: [{ turn: 1, text: 'Delegate the synthetic task.' }],
    ledger: [], children: [{ source: 0, ledger: child }],
    delegations: [{ adapter: 'codex', kind: 'spawn', turn: 1, childId: 'worker',
      status: 'linked', source: 0, link: { source: 0 },
      parentInstruction: { text: 'Complete the synthetic child task.',
        tool: 'collaboration.spawn_agent' } }],
    capture: { incomplete: false, reasons: [] } }, { sessionKey: 'parent' });
}

test('M29c native inter-agent rows declare one counted child loss, never generic action loss', async () => {
  const child = sessionFromLedger(communicationChild(), { sessionKey: 'child-alone' });
  assert.deepEqual(child.adapterGaps.map((gap) => [gap.code, gap.channel, gap.count]),
    [['incomplete_inventory', 'children', 2]]);
  assert.equal(child.adapterGaps[0].sessionKey, 'child-alone');
  assert.equal(child.adapterGaps[0].lossOrdinal, 0);

  const parent = linkedCommunication(communicationChild());
  const gaps = parent.adapterGaps.filter((gap) => gap.channel === 'children');
  assert.equal(gaps.length, 1, 'the linked child generic capture gap is redundant');
  assert.equal(gaps[0].count, 2);
  assert.equal(gaps[0].sessionKey, 'parent/child:worker');
  assert.equal(gaps[0].lossOrdinal, 0);
  assert.equal(parent.adapterGaps.every((gap) => typeof gap.sessionKey === 'string'), true);
  const report = await runReview({ session: parent, pr: null, reviewScope: 'session-only', judge: quiet });
  assert.equal(report.sessionStatus, RECORDER_LIMITED, 'typed child communication remains capping: a recorder limit, never CLEAN');
});

test('M29c synthetic native Codex row keeps its communication counter through slice and redaction', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m29c-agent-message-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-27T10-00-00-synthetic.jsonl');
  const rows = [
    { type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Review the parser.' } },
    { type: 'response_item', payload: { type: 'agent_message', id: 'synthetic-message',
      author: 'child', recipient: 'parent', content: [{ type: 'input_text', text: 'Synthetic reply.' },
        { type: 'encrypted_content', data: 'opaque' }] } },
  ];
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const sliced = await sliceLineage([file]);
  assert.equal(sliced.capture.interAgentMessagesUnparsed, 1);
  assert.equal(sliced.capture.interAgentMessagesSoleIncomplete, true);
  const session = sessionFromLedger(redact(sliced).ledger, { sessionKey: 'synthetic-session' });
  assert.deepEqual(session.adapterGaps.map((gap) => [gap.code, gap.channel, gap.count]),
    [['incomplete_inventory', 'children', 1]]);
  assert.equal(session.adapterGaps[0].sessionKey, 'synthetic-session');
  assert.equal(session.adapterGaps[0].lossOrdinal, 0);
});

test('M29c any second child capture cause keeps its broad gap beside typed communication', () => {
  const parent = linkedCommunication(communicationChild({ sole: false, otherLoss: true }));
  const childGaps = parent.adapterGaps.filter((gap) => gap.channel === 'children');
  assert.equal(childGaps.length, 2);
  assert.ok(childGaps.some((gap) => gap.count === 2 && gap.sessionKey === 'parent/child:worker'));
  assert.ok(childGaps.some((gap) => gap.count === null && gap.sessionKey === 'parent'));
  assert.ok(parent.adapterGaps.some((gap) => gap.channel === 'actions'),
    'an independent unsupported action still has its own gap');
  const contradictory = linkedCommunication({ ...communicationChild(),
    capture: { ...communicationChild().capture, genericIncomplete: true } });
  assert.equal(contradictory.adapterGaps.filter((gap) => gap.channel === 'children').length, 2,
    'an explicit generic incomplete cause cannot be silenced by a sole-cause flag');
});

test('M29c gap identity separates owners and same-source eventless losses across reload', () => {
  // Two eventless losses of one code and channel from one source: an unmapped result and a call with no result.
  const ledger = { ask: [{ turn: 1, text: 'Synthetic instruction.' }], ledger: [],
    capture: { incomplete: false, unmapped: 1, observationsMissing: 1 } };
  const one = sessionFromLedger(ledger, { sessionKey: 'child-one' });
  const two = sessionFromLedger(ledger, { sessionKey: 'child-two' });
  const actionGaps = one.adapterGaps.filter((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'observations');
  assert.equal(actionGaps.length, 2);
  assert.deepEqual(actionGaps.map((gap) => gap.lossOrdinal), [0, 1]);
  assert.notEqual(gapKey(actionGaps[0]), gapKey(actionGaps[1]));
  const otherOwner = two.adapterGaps.find((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'observations');
  assert.notEqual(gapKey(actionGaps[0]), gapKey(otherOwner));
  const reloaded = structuredClone(actionGaps[0]);
  reloaded.note = 'rendered differently';
  reloaded.count = 9;
  assert.equal(gapKey(reloaded), gapKey(actionGaps[0]));
  delete reloaded.lossOrdinal;
  assert.notEqual(gapKey(reloaded), gapKey(actionGaps[0]),
    'legacy no-ordinal declarations cannot erase a newly identified loss');
});

test('M29 fully judged instruction/commentary-only scope is reviewable; empty and boundary-only are not', () => {
  const visible = sessionFromLedger({ ask: [{ turn: 1, text: 'Explain the parser design.' }],
    commentary: [{ turn: 1, record: 0, block: 0, text: 'The parser reads one record at a time.' }],
    ledger: [], capture: { incomplete: false, reasons: [] } }, { sessionKey: 'no-action' });
  const judged = { windows: [{}], perWindow: [{ narrative: {}, challenge: { complete: true },
    groundingComplete: true }] };
  const facts = sessionCoverageFacts({ session: visible, ...judged });
  assert.equal(facts.actions, 0);
  assert.equal(facts.reviewableEvents, 2);
  assert.equal(coverageFrom(facts), 'complete');
  assert.equal(coverageFrom({ ...facts, reviewableEvents: null }), 'missing');
  const report = buildLedger({ repo, session: visible, pr: null, reviewScope: 'session-only',
    sessionCoverage: coverageFrom(facts), coverageFacts: facts });
  assert.equal(report.sessionStatus, 'CLEAN');
  assert.equal(report.reviewStatus, 'CLEAN');

  for (const events of [[], [{ id: 'B1', sequence: 0, kind: 'boundary', boundary: 'compaction' }]]) {
    const session = new Session({ sessionKey: 'empty-or-boundary', events });
    const only = sessionCoverageFacts({ session, ...judged });
    assert.equal(only.reviewableEvents, 0);
    assert.equal(coverageFrom(only), 'missing');
    const inconclusive = buildLedger({ repo, session, pr: null, reviewScope: 'session-only',
      sessionCoverage: coverageFrom(only), coverageFacts: only });
    assert.equal(inconclusive.sessionStatus, 'UNCHECKED');
  }
});

function actorSession() {
  const blobs = { ask: 'Keep the changelog tidy.', root: 'export const root = 1;\n',
    assignment: 'Implement the worker module.', child: 'export const child = 2;\n' };
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key]) }];
  const events = [
    { id: 'I1', kind: 'instruction', sequence: 0, authority: 'human', text: ref('ask') },
    { id: 'A1', kind: 'invocation', sequence: 1, operation: 'write', tool: 'Write',
      paths: [{ path: 'src/root.js' }], command: [], input: [], changes: [{ path: 'src/root.js',
        before: [], after: ref('root'), diff: [] }] },
    { id: 'O1', kind: 'observation', sequence: 2, phase: 'terminal', invocation: 'A1',
      result: 'succeeded', terminalStatusProven: true, sourceOfResult: 'native', output: [] },
    { id: 'child:worker:I1', kind: 'instruction', sequence: 3, childId: 'worker',
      authority: 'parent-assignment', text: ref('assignment') },
    { id: 'child:worker:A1', kind: 'invocation', sequence: 4, childId: 'worker',
      operation: 'write', tool: 'Write', paths: [{ path: 'src/child.js' }], command: [], input: [],
      changes: [{ path: 'src/child.js', before: [], after: ref('child'), diff: [] }] },
    { id: 'child:worker:O1', kind: 'observation', sequence: 5, childId: 'worker', phase: 'terminal',
      invocation: 'child:worker:A1', result: 'succeeded', terminalStatusProven: true,
      sourceOfResult: 'native', output: [] },
  ];
  const children = [{ assignmentEvent: 'D1', childId: 'worker', childSession: 'parent/child:worker',
    sessionKey: 'parent/child:worker', relation: 'spawn', state: 'verified', historyStart: null }];
  const session = new Session({ sessionKey: 'parent', adapter: 'codex', events, blobs, children });
  session.adapterGaps = [{ code: 'incomplete_inventory', channel: 'children', scope: 'session',
    count: 1, eventIds: ['D2'] }, { code: 'source_clipped', channel: 'observations', scope: 'session',
    count: 1, eventIds: ['child:worker:O1'] }];
  return session;
}

function actorDecision(session, action, actor, over = {}) {
  const path = action === 'A1' ? 'src/root.js' : 'src/child.js';
  return groundDecision({ repo, session, pr: { enumeration: 'complete', files: [
    { path, change: 'added', contentState: 'complete' }] }, instructionHistoryComplete: true,
  candidate: { actorSession: actor, dimension: 'module layout', chosen: path, actions: [action],
    value: path, valueReceipt: { eventId: action, role: 'action', field: 'path', quote: path },
    stated: null, constrainedBy: null, ...over } });
}

test('M29 actor identity comes from every canonical action and one verified child mapping', () => {
  const session = actorSession();
  assert.deepEqual(session.actorForActions(['A1']),
    { state: 'root', sessionKey: 'parent', childId: null });
  assert.deepEqual(session.actorForActions([session.event('child:worker:A1')]),
    { state: 'verified-child', sessionKey: 'parent/child:worker', childId: 'worker' });
  assert.equal(session.actorForActions(['A1', 'child:worker:A1']).state, 'ambiguous');
  assert.equal(session.actorForActions([{ id: 'A1', childId: 'worker' }]).state, 'root',
    'the canonical event wins over a caller-supplied object');
  assert.equal(actorDecision(session, 'child:worker:A1', 'parent').reason, 'ambiguous_authority');
  assert.equal(actorDecision(session, 'A1', 'parent', { actions: ['A1', 'child:worker:A1'] }).reason,
    'ambiguous_authority');
  const missing = actorSession(); missing.children = [];
  assert.equal(missing.actorForActions(['child:worker:A1']).state, 'ambiguous');
  const conflicting = actorSession();
  conflicting.children.push({ ...conflicting.children[0], childSession: 'parent/other', sessionKey: 'parent/other' });
  assert.equal(conflicting.actorForActions(['child:worker:A1']).state, 'ambiguous');
  const followup = actorSession();
  followup.children.push({ ...followup.children[0], assignmentEvent: 'D2', relation: 'followup' });
  assert.equal(followup.actorForActions(['child:worker:A1']).state, 'verified-child');
});

test('M29 child gaps do not erase root unasked, while child inherited human authority stays unchecked', () => {
  const session = actorSession();
  const scope = instructionReviewScope(session);
  assert.equal(scope.complete, true);
  assert.deepEqual(scope.instructions.map((instruction) => instruction.eventId), ['I1']);
  const rootOnly = new Session({ sessionKey: session.sessionKey,
    events: session.events.filter((event) => event.childId == null), blobs: session.blobs });
  assert.equal(scope.scopeDigest, instructionReviewScope(rootOnly).scopeDigest);
  const absence = { dimension: 'module layout', scopeDigest: scope.scopeDigest,
    noRelevantInstruction: true, checks: [{ instruction: { eventId: 'I1', role: 'instruction',
      quote: 'Keep the changelog tidy.' }, relevant: false,
      explanation: 'The changelog request does not address module layout.' }] };
  const root = actorDecision(session, 'A1', 'parent', { instructionReview: absence });
  assert.equal(root.decision.column, 'unasked');
  const child = actorDecision(session, 'child:worker:A1', 'parent/child:worker',
    { instructionReview: absence, constrainedBy: { instruction: { eventId: 'I1',
      role: 'instruction', quote: 'Keep the changelog tidy.' }, settles: false, settledValueQuote: null } });
  assert.equal(child.decision.valueState, 'grounded');
  assert.equal(child.decision.column, null);
  assert.equal(child.decision.columnState, 'unchecked');
  assert.ok(child.decision.reasons.includes('instructions_partial'));

  for (const channel of ['instructions', 'identity', undefined]) {
    const uncertain = actorSession();
    uncertain.adapterGaps.push({ code: 'incomplete_inventory', channel, scope: 'session', count: 1 });
    assert.equal(instructionReviewScope(uncertain).complete, false, `${channel} can hide the root ask`);
  }
});
