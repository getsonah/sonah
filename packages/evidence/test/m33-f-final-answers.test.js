// M33 F (helper final answers), the adapter. A helper's FINAL_ANSWER the slicer attached to its hand-off becomes that
// delegate's observation — role observation, like any tool result: it is what the parent agent received — quotable as
// a RESULT, scrubbed as output and then bounded with its cut declared as this review's. It is placed where the parent
// RECEIVED it (its own recorded turn and row), not beside the hand-off: windows and order show when it arrived, and a
// report reviewed apart from its hand-off is declared as a split pair. Its status is not judged: `unknown`, never
// `succeeded`, and a refused hand-off stays failed. Every inter-agent message the recording withheld is declared as its
// own counted children-channel gap, by the closed reason it was withheld for.
//
// Review request bytes change for a window that holds an attributed report (the report is now evidence), and for no
// other: the request-byte pin against base 2e05794 is in cli/test/m33-f-final-answers-baseline.test.js.
//
// Synthetic Codex rollouts only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFromLedger, INTER_AGENT_GAP_NOTES, INTER_AGENT_LOSS_GAPS, HELPER_REPORT_CLIPPED_NOTE, HELPER_DELIVERY_GAP_NOTES }
  from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { buildLedger } from '../src/ledger.js';
import { coverageCauses, renderReview, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { planWindowRequests } from '../src/run-review.js';
import { planWindows } from '../src/windows.js';
import { stableEvidence } from './m35-windows-fixture.js';
import { sliceLineage } from '../../slicer/index.js';
import { INTER_AGENT_LOSS_COUNTS } from '../../slicer/src/inter-agent.js';
import { redact, FINAL_ANSWER_OMISSION } from '../../redact/index.js';
/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a helper report by (M33 F to D68 E). */
const FINAL_ANSWER_CAP = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { TEXT, SECRET, finalAnswer, newTask, rootRows, attributedRows, unattachedRows, lateReportRows, rootMeta, ask,
  said, spawn, call, output, jsonl } from './m33-f-final-answer-fixture.js';
import { childRows } from './m33-t-helper-brief-fixture.js';
import { adapt, named, labelOf } from './stable-ids-fixture.js';

const repo = { host: 'local', id: 'synthetic' };

async function sessionOf(t, rows, sessionKey = 'm33-f') {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-f-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-01T12-00-00-synthetic.jsonl');
  await writeFile(file, jsonl(rows));
  const ledger = redact(await sliceLineage([file])).ledger;
  // C-01 event identity: registered, so an event can be named by its positional label (stable-ids-fixture.js).
  return { ledger, session: adapt(ledger, { sessionKey }) };
}
const reportOf = (session, delegate) => session.events.find((event) => event.kind === 'observation'
  && event.invocation === delegate.id) ?? null;
// C-01 event identity: the hand-off's event by its positional label (`D<turn>-<index>`), never by parsing its id.
const delegateFor = (session, ledger, callId) => {
  const index = ledger.delegations.findIndex((d) => d.callId === callId);
  return session.event(named(session, `D${ledger.delegations[index].turn}-${index}`));
};
/** The session's own actions and hand-offs and their results, in order (by kind, never by an id's shape). */
const workIds = (session) => session.events.filter((event) => event.kind === 'invocation' || event.kind === 'observation')
  .map((event) => event.id);
const resultOf = (session, event) => session.observationFor(event.id).id;
const childrenGaps = (session) => session.adapterGaps.filter((gap) => gap.channel === 'children'
  && gap.code === 'incomplete_inventory' && Object.values(INTER_AGENT_GAP_NOTES).includes(gap.note))
  .map((gap) => [gap.note, gap.count]);

test('M33 F the adapter declares exactly the slicer\'s closed communication losses, one note each', () => {
  assert.deepEqual(INTER_AGENT_LOSS_GAPS.map(([key]) => key), [...INTER_AGENT_LOSS_COUNTS]);
  assert.deepEqual(INTER_AGENT_LOSS_GAPS.map(([, note]) => note), [INTER_AGENT_GAP_NOTES.unparsed,
    INTER_AGENT_GAP_NOTES.encrypted, INTER_AGENT_GAP_NOTES.unattributed, INTER_AGENT_GAP_NOTES.ambiguous]);
  assert.equal(new Set(Object.values(INTER_AGENT_GAP_NOTES)).size, 4);
  // The existing note is unchanged, word for word.
  assert.equal(INTER_AGENT_GAP_NOTES.unparsed,
    'native inter-agent messages were recorded without attributable communication evidence');
  // M33 F repair: an unattributed report is one no hand-off of the recording matched by its recorded sender and
  // recipient — which is all the slicer can say (a mismatched sender line, a report addressed elsewhere, a withheld
  // history), never that the report "named no hand-off".
  assert.equal(INTER_AGENT_GAP_NOTES.unattributed,
    'helper final reports matched no hand-off of this recording by their recorded sender and recipient, so they were not attached to one');
  assert.equal(INTER_AGENT_GAP_NOTES.ambiguous,
    'helper final reports could belong to more than one hand-off, so they were not attached to one');
  assert.equal(Object.isFrozen(INTER_AGENT_GAP_NOTES) && Object.isFrozen(INTER_AGENT_LOSS_GAPS), true);
});

test('M33 F an attributed report is its hand-off\'s observation where the parent received it, quotable as a result', async (t) => {
  const { ledger, session } = await sessionOf(t, attributedRows());
  const fix = delegateFor(session, ledger, 'spawn-fix');
  const report = reportOf(session, fix);
  assert.ok(report, 'the report is an observation of the hand-off');
  assert.equal(report.invocation, fix.id);
  assert.equal(session.observationFor(fix.id), report, 'still the hand-off\'s own result');
  // Recorded order: both spawns, then both reports, then the command. The fix report arrived after the notes spawn, so
  // it follows that spawn, never sits beside its own; and it precedes the command recorded after it.
  const notesDelegate = delegateFor(session, ledger, 'spawn-notes');
  const command = session.events.find((event) => event.kind === 'invocation' && event.operation === 'command');
  assert.deepEqual(workIds(session),
    [fix.id, notesDelegate.id, report.id, resultOf(session, notesDelegate), command.id, resultOf(session, command)]);
  assert.equal(report.turn, 'T1');
  assert.deepEqual({ phase: report.phase, result: report.result, exitCode: report.exitCode,
    sourceOfResult: report.sourceOfResult, helperReported: report.helperReported,
    terminalStatusProven: report.terminalStatusProven },
  { phase: 'terminal', result: 'unknown', exitCode: null, sourceOfResult: 'native', helperReported: true,
    terminalStatusProven: undefined });
  assert.equal(session.textSpansOf(report, 'output').join(''), TEXT.fixReport);
  assert.deepEqual(session.sourcesFor(report), [{ role: 'observation', text: TEXT.fixReport }]);
  const quote = 'Fixed the nested-input parser in src/parser.js.';
  assert.equal(verifyReceipt(session, { eventId: report.id, role: 'observation', quote }).ok, true);
  assert.equal(verifyReceipt(session, { eventId: fix.id, role: 'action', quote }).ok, false,
    'the report is a result, never the hand-off\'s own action text');
  const notes = delegateFor(session, ledger, 'spawn-notes');
  assert.equal(session.textSpansOf(reportOf(session, notes), 'output').join(''), TEXT.notesReport);
});

test('M33 F an attached report judges nothing: the hand-off stays unlinked and its gap stays declared', async (t) => {
  const withReports = await sessionOf(t, attributedRows(), 'with');
  const without = await sessionOf(t, rootRows(), 'without');
  const unresolved = ({ session }) => session.adapterGaps.filter((gap) => gap.delegationUnresolved === true)
    .map((gap) => [gap.code, gap.channel, gap.count, gap.eventIds]);
  assert.deepEqual(unresolved(withReports), unresolved(without));
  assert.equal(unresolved(withReports).length, 2);
  for (const delegate of withReports.session.delegations())
    assert.equal(withReports.session.outcomeOf(delegate.id), 'unknown', 'reported back, not succeeded');
  const report = buildLedger({ repo, session: withReports.session, pr: null, sessionCoverage: 'complete' });
  assert.equal(report.coverage, 'partial');
  // A refused hand-off keeps its failed result, and a report naming its task is not attached to it.
  const refused = await sessionOf(t, [rootMeta(), ask(),
    ...spawn('spawn-x', 'fix_parser', TEXT.fixBrief, { is_error: true }),
    finalAnswer('/root/fix_parser', TEXT.fixReport)], 'refused');
  const [delegate] = refused.session.delegations();
  const rows = refused.session.events.filter((event) => event.kind === 'observation' && event.invocation === delegate.id);
  assert.deepEqual(rows.map((row) => [row.result, row.helperReported]), [['failed', undefined]]);
});

test('M33 F review requests carry an attributed report as a RESULT, and nothing of an unattached one', async (t) => {
  const attributed = (await sessionOf(t, attributedRows(), 'attributed')).session;
  // M35: a request names events by its window's aliases; read with them written back as stable ids.
  const prompts = stableEvidence(planWindowRequests({ session: attributed, reviewScope: 'session-only' }));
  const fix = attributed.delegations()[0];
  assert.ok(prompts.includes(`[${resultOf(attributed, fix)}] RESULT of ${fix.id}`),
    'the report is shown as the hand-off\'s result');
  assert.ok(prompts.includes(TEXT.fixReport));
  assert.ok(prompts.includes(TEXT.notesReport));
  const unattached = (await sessionOf(t, unattachedRows(), 'unattached')).session;
  const plain = planWindowRequests({ session: unattached, reviewScope: 'session-only' }).requests
    .map(({ request }) => request.evidencePrompt).join('\n');
  for (const text of [TEXT.notesReport, 'I was never spawned here', 'still working', 'Message Type'])
    assert.equal(plain.includes(text), false, text);
  assert.equal(unattached.events.some((event) => event.helperReported === true), false);
});

test('M33 F a truncated report declares its cut, and no quote can cross it', async (t) => {
  const lines = Array.from({ length: 900 }, (_, i) => `Report line ${String(i).padStart(4, '0')} checked.`);
  const long = lines.join('\n');
  const { ledger: whole, session: kept } = await sessionOf(t, rootRows([finalAnswer('/root/fix_parser', long)]));
  // D68 (E): a helper's report is what it produced, kept whole: one span, nothing clipped.
  const keptReport = reportOf(kept, delegateFor(kept, whole, 'spawn-fix'));
  assert.deepEqual(kept.textSpansOf(keptReport, 'output'), [long]);
  assert.equal(kept.adapterGaps.some((gap) => gap.code === 'source_clipped'), false);
  // A ledger an earlier Sonah persisted with the report bounded (its marker on a line of its own) is read as written.
  const ledger = structuredClone(whole);
  const handOff = ledger.delegations.find((d) => d.callId === 'spawn-fix');
  handOff.finalAnswer = { ...handOff.finalAnswer, truncated: true,
    text: [...lines.slice(0, 200), FINAL_ANSWER_OMISSION, ...lines.slice(-70)].join('\n') };
  const session = adapt(ledger, { sessionKey: 'm33-f-persisted' });
  const fix = delegateFor(session, ledger, 'spawn-fix');
  const report = reportOf(session, fix);
  const spans = session.textSpansOf(report, 'output');
  assert.equal(spans.length, 2, 'head and tail are two sources: the stub is this review\'s words, never quotable');
  assert.equal(spans.some((span) => span.includes(FINAL_ANSWER_OMISSION)), false);
  assert.ok(spans[0].startsWith('Report line 0000 checked.') && spans[0].endsWith(' checked.'), 'whole lines only');
  // (The tail span keeps the line break after the stub, as a recorder-cut tool output's does.)
  assert.ok(spans[1].startsWith('\nReport line ') && spans[1].endsWith('Report line 0899 checked.'), 'whole lines only');
  assert.ok([...spans[0]].length <= FINAL_ANSWER_CAP.head && [...spans[1].slice(1)].length <= FINAL_ANSWER_CAP.tail);
  // The cut is declared as what made it: this review's cap on a helper report, never the recorder's (Codex kept the
  // whole report). It is its own observation-channel `source_clipped` gap, apart from recorded tool output's.
  const clipped = session.adapterGaps.filter((gap) => gap.code === 'source_clipped' && gap.channel === 'observations');
  assert.deepEqual(clipped.map((gap) => [gap.count, gap.eventIds, gap.note]), [[1, [report.id], HELPER_REPORT_CLIPPED_NOTE]]);
  assert.equal(HELPER_REPORT_CLIPPED_NOTE,
    'a helper final report was capped before review; its head and tail are quotable, the elided middle is not');
  assert.equal(verifyReceipt(session, { eventId: report.id, role: 'observation',
    quote: `${spans[0].slice(-30)}\n${FINAL_ANSWER_OMISSION}` }).ok, false);
  assert.equal(verifyReceipt(session, { eventId: report.id, role: 'observation',
    quote: 'Report line 0001 checked.' }).ok, true);
});

test('M33 F a report redaction scrubbed declares that its output was partly withheld', async (t) => {
  const { ledger, session } = await sessionOf(t, rootRows([finalAnswer('/root/fix_parser',
    `Deployed the fix.\nI used the key ${SECRET} to call the API.\nAll 13 tests pass.`)]));
  const report = reportOf(session, delegateFor(session, ledger, 'spawn-fix'));
  assert.equal(JSON.stringify(session.blobs).includes(SECRET), false);
  const withheld = session.adapterGaps.find((gap) => gap.code === 'incomplete_inventory'
    && gap.channel === 'observations' && gap.note === 'recorded tool output was partly withheld by redaction');
  assert.ok(withheld?.eventIds.includes(report.id));
  assert.equal(verifyReceipt(session, { eventId: report.id, role: 'observation', quote: 'All 13 tests pass.' }).ok, true);
});

test('M33 F every withheld inter-agent message is declared, counted by its closed reason', async (t) => {
  const { ledger, session } = await sessionOf(t, unattachedRows());
  assert.deepEqual(INTER_AGENT_LOSS_COUNTS.map((key) => ledger.capture[key] ?? 0), [1, 2, 1, 1]);
  assert.deepEqual(childrenGaps(session), [[INTER_AGENT_GAP_NOTES.unparsed, 1], [INTER_AGENT_GAP_NOTES.encrypted, 2],
    [INTER_AGENT_GAP_NOTES.unattributed, 1], [INTER_AGENT_GAP_NOTES.ambiguous, 1]]);
  // An attributed report is no loss: only the encrypted brief message is declared.
  const attributed = await sessionOf(t, attributedRows(), 'attributed');
  assert.deepEqual(childrenGaps(attributed.session), [[INTER_AGENT_GAP_NOTES.encrypted, 1]]);
  // A ledger persisted before M33 F declares exactly what it always did.
  const legacy = sessionFromLedger({ ask: [{ turn: 1, text: 'Synthetic.' }],
    capture: { interAgentMessagesUnparsed: 3, interAgentMessagesSoleIncomplete: true, incomplete: true,
      genericIncomplete: false, reasons: [] } }, { sessionKey: 'legacy' });
  assert.deepEqual(childrenGaps(legacy), [[INTER_AGENT_GAP_NOTES.unparsed, 3]]);
  assert.equal(legacy.adapterGaps.some((gap) => gap.channel === 'actions' && gap.code === 'incomplete_inventory'), false);
});

test('M33 F a communication-only capture stays typed, and a counter that is not a count still declares its loss', () => {
  const gapsOf = (capture) => sessionFromLedger({ ask: [{ turn: 1, text: 'Synthetic.' }], capture },
    { sessionKey: 'typed' }).adapterGaps;
  const encryptedOnly = gapsOf({ interAgentMessagesUnparsed: 0, interAgentMessagesEncrypted: 2,
    interAgentMessagesSoleIncomplete: true, incomplete: true, genericIncomplete: false, reasons: [] });
  assert.equal(encryptedOnly.some((gap) => gap.channel === 'actions'), false, 'no generic actions gap beside it');
  assert.deepEqual(encryptedOnly.map((gap) => [gap.channel, gap.count, gap.note]),
    [['children', 2, INTER_AGENT_GAP_NOTES.encrypted]]);
  const broken = gapsOf({ interAgentMessagesUnparsed: 0, interAgentFinalAnswersAmbiguous: 'two',
    interAgentMessagesSoleIncomplete: true, incomplete: true, genericIncomplete: false, reasons: [] });
  assert.deepEqual(broken.filter((gap) => gap.channel === 'children').map((gap) => [gap.count, gap.note]),
    [[null, INTER_AGENT_GAP_NOTES.ambiguous]], 'declared, uncounted: never read as a number, never dropped');
});

test('M33 F the review names encrypted inter-agent messages in plain words', async (t) => {
  assert.ok(COVERAGE_CAUSES.includes('messages_encrypted'));
  assert.equal(COVERAGE_CAUSES.indexOf('messages_encrypted'), COVERAGE_CAUSES.indexOf('briefs_encrypted') + 1);
  assert.equal(COVERAGE_SENTENCE.messages_encrypted({ n: 1 }),
    '1 inter-agent message was encrypted by the recorder, so it cannot be shown or checked');
  assert.equal(COVERAGE_SENTENCE.messages_encrypted({ n: 3 }),
    '3 inter-agent messages were encrypted by the recorder, so they cannot be shown or checked');
  const { session } = await sessionOf(t, [rootMeta(), ask(), newTask('/root/fix_parser'), newTask('/root/other')]);
  const report = buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
  assert.equal(report.coverage, 'partial');
  assert.deepEqual(coverageCauses(report).filter(([cause]) => cause === 'messages_encrypted'),
    [['messages_encrypted', { n: 2 }]]);
});

test('M33 F a linked helper\'s report sits between its hand-off and its transferred history', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-f-linked-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const linked = join(dir, 'linked');
  await mkdir(linked);
  const root = join(linked, 'rollout-2026-10-01T12-00-00-root.jsonl');
  // A no-history spawn, so the helper's own recording proves where its work starts and its events transfer.
  await writeFile(root, jsonl([rootMeta('root'), ask(),
    call('spawn_agent', 'spawn-fix', { message: TEXT.fixBrief, task_name: 'fix_parser', fork_turns: 'none' }),
    output('spawn-fix', { task_name: '/root/fix_parser' }), finalAnswer('/root/fix_parser', TEXT.fixReport)]));
  await writeFile(join(linked, 'rollout-2026-10-01T12-00-01-child.jsonl'), jsonl(childRows()));
  const ledger = await loadSessionEvidence([root], { recordingRoots: { codex: linked }, reviewLinkedChildren: true });
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-f-linked' });
  const [delegate] = session.delegations();
  assert.equal(session.childFor(delegate.id)?.state, 'verified');
  // The helper's transferred history hangs from its hand-off; its report is what the parent received AFTER that work,
  // at the report's own row, so it follows the whole history.
  const at = session.events.findIndex((event) => event.id === delegate.id);
  const reportAt = session.events.findIndex((event) => event.kind === 'observation' && event.invocation === delegate.id);
  const history = session.events.map((event, index) => [event, index]).filter(([event]) => typeof event.childId === 'string')
    .map(([, index]) => index);
  assert.ok(history.length > 0 && history[0] === at + 1, 'the child history follows its hand-off');
  assert.ok(reportAt > history.at(-1), 'the report follows the helper\'s work');
  assert.equal(session.events[reportAt].helperReported, true);
  assert.equal(session.events[reportAt].invocation, delegate.id);
  assert.equal(session.textSpansOf(session.events[reportAt], 'output').join(''), TEXT.fixReport);
  // The helper's own encrypted brief message is its typed gap, transferred; never a generic child loss. The parent's
  // report was attributed, so the parent declares no communication loss of its own. M33 P: that encrypted message is an
  // arrival addressed to the helper whose payload no send of this parent recorded (its brief here is plaintext), so it
  // cuts nothing of the helper's history, and the parent says so. M5: this synthetic
  // helper records no typed human channel (no item stream), so its harness plugin list is set aside by structure alone
  // (only top-level elements) and that decision is its declared loss, which the parent states as its linked child's own.
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'children')
    .map((gap) => [gap.note, gap.count, gap.sessionKey === session.sessionKey ? 'parent' : 'child']),
  [['the linked child session declares an incomplete capture of its own', null, 'parent'],
    [INTER_AGENT_GAP_NOTES.encrypted, 1, 'child'], [HELPER_DELIVERY_GAP_NOTES.helper_arrival_unmatched, 1, 'parent']]);
});

// ---- placement: where the parent received the report ------------------------------------------------------------

test('M33 F a report arriving turns after its spawn lands in the later window, after a claim made in between', async (t) => {
  const { ledger, session } = await sessionOf(t, lateReportRows());
  const [delegate] = session.delegations();
  const fa = ledger.delegations[0].finalAnswer;
  assert.deepEqual([ledger.delegations[0].turn, fa.turn], [1, 3], 'spawned in turn 1, received in turn 3');
  const report = session.observationFor(delegate.id);
  // Still that hand-off's result: linked by invocation, unjudged, quotable as a RESULT.
  assert.deepEqual({ id: report.id, invocation: report.invocation, helperReported: report.helperReported,
    result: report.result }, { id: named(session, 'D1-0-r'), invocation: delegate.id, helperReported: true,
    result: 'unknown' });
  assert.equal(session.outcomeOf(delegate.id), 'unknown');
  assert.equal(verifyReceipt(session, { eventId: report.id, role: 'observation',
    quote: 'Fixed the nested-input parser in src/parser.js.' }).ok, true);
  // Placed when it arrived: in turn 3, after that turn's ask and after the claim of turn 2, before the closing words.
  const seq = (predicate) => session.events.find(predicate).sequence;
  const claim = seq((event) => event.kind === 'commentary' && session.textSpansOf(event, 'text').join('') === TEXT.claim);
  const check = seq((event) => event.kind === 'instruction' && event.turn === 'T3');
  const done = seq((event) => event.kind === 'commentary' && session.textSpansOf(event, 'text').join('') === TEXT.done);
  assert.equal(report.turn, 'T3');
  assert.ok(delegate.sequence < claim && claim < check && check < report.sequence && report.sequence < done,
    JSON.stringify(session.events.map((event) => event.id)));
  // M35 (windowing): the recorder compacted between the claim and the report, which splits no window; the parent's
  // segments (the spawn, the claim and the report the parent received) are one window, every event once.
  const windows = planWindows(session).filter((window) => !window.session.helper);
  const windowOf = (id) => windows.findIndex((window) => window.events.some((event) => event.id === id));
  assert.equal(windows.length, 1);
  assert.deepEqual([windowOf(delegate.id), windowOf(report.id)], [0, 0]);
  const requests = planWindowRequests({ session, reviewScope: 'session-only' }).requests;
  const holding = requests.filter(({ request }) => request.evidencePrompt.includes(TEXT.fixReport))
    .map(({ window }) => window.session.childId);
  assert.deepEqual([...new Set(holding)], [null], 'the report is the parent\'s observation, in the parent\'s window');
});

test('M33 F a report follows work recorded before it and precedes a hand-off recorded after it, in one turn', async (t) => {
  const { ledger, session } = await sessionOf(t, [rootMeta(), ask(), said(TEXT.plan),
    ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief),
    call('exec_command', 'cmd-1', { cmd: 'npm test' }), output('cmd-1', 'Process exited with code 0\nOutput:\nok 13 tests'),
    finalAnswer('/root/fix_parser', TEXT.fixReport),
    ...spawn('spawn-notes', 'write_changelog', TEXT.notesBrief),
    said(TEXT.done)]);
  const fix = delegateFor(session, ledger, 'spawn-fix');
  const notes = delegateFor(session, ledger, 'spawn-notes');
  const command = session.events.find((event) => event.kind === 'invocation' && event.operation === 'command');
  assert.deepEqual(workIds(session), [fix.id, command.id, resultOf(session, command), resultOf(session, fix), notes.id]);
  assert.equal(session.events.at(-1).kind, 'commentary', 'the closing statement still ends the turn');
  // Nothing else moved: the same events in the same order as without the report, with the report inserted.
  const without = await sessionOf(t, [rootMeta(), ask(), said(TEXT.plan), ...spawn('spawn-fix', 'fix_parser', TEXT.fixBrief),
    call('exec_command', 'cmd-1', { cmd: 'npm test' }), output('cmd-1', 'Process exited with code 0\nOutput:\nok 13 tests'),
    ...spawn('spawn-notes', 'write_changelog', TEXT.notesBrief), said(TEXT.done)], 'without');
  // (Two recordings: a row-position id after the removed row moves with its line, so the events are compared by their
  // positional labels — C-01 event identity.)
  assert.deepEqual(session.events.filter((event) => event.id !== resultOf(session, fix)).map((event) => labelOf(session, event.id)),
    without.session.events.map((event) => labelOf(without.session, event.id)));
});

// ---- the cut is this review's, and is said to be ----------------------------------------------------------------

test('M33 F a report cut before review carries Sonah\'s own marker and declaration, never the recorder\'s', async (t) => {
  const lines = Array.from({ length: 900 }, (_, i) => `Report line ${String(i).padStart(4, '0')} checked.`);
  const { ledger: whole } = await sessionOf(t, rootRows([finalAnswer('/root/fix_parser', lines.join('\n'))]));
  assert.equal(whole.delegations.find((d) => d.callId === 'spawn-fix').finalAnswer.truncated, undefined, 'D68 (E): uncut');
  // A ledger an earlier Sonah persisted with the report bounded, redacted again: its marker and flag stand.
  const persisted = structuredClone(whole);
  const handOff = persisted.delegations.find((d) => d.callId === 'spawn-fix');
  handOff.finalAnswer = { ...handOff.finalAnswer, truncated: true,
    text: [...lines.slice(0, 200), FINAL_ANSWER_OMISSION, ...lines.slice(-70)].join('\n') };
  const ledger = redact({ ...persisted, dropped: [] }).ledger;
  const session = adapt(ledger, { sessionKey: 'm33-f-persisted' });
  const kept = ledger.delegations.find((d) => d.callId === 'spawn-fix').finalAnswer;
  assert.equal(kept.truncated, true);
  assert.equal(kept.text.split(`\n${FINAL_ANSWER_OMISSION}\n`).length, 2, 'Sonah\'s own marker, once, on its own line');
  assert.equal(kept.text.includes('omitted by recorder'), false, 'never the recorder\'s stub');
  const report = reportOf(session, delegateFor(session, ledger, 'spawn-fix'));
  const clipped = session.adapterGaps.filter((gap) => gap.code === 'source_clipped');
  assert.deepEqual(clipped.map((gap) => [gap.channel, gap.eventIds, gap.note]),
    [['observations', [report.id], HELPER_REPORT_CLIPPED_NOTE]]);
  assert.doesNotMatch(HELPER_REPORT_CLIPPED_NOTE, /recorder/);
  // The review says so in the same words: its header names the helper report capped before review, and neither the
  // header nor the list of what was not checked credits the cut to the recorder.
  const built = buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
  const causes = coverageCauses(built);
  assert.deepEqual(causes.filter(([cause]) => ['reports_capped', 'source_clipped'].includes(cause)),
    [['reports_capped', { n: 1 }]]);
  assert.equal(COVERAGE_CAUSES.indexOf('reports_capped'), COVERAGE_CAUSES.indexOf('source_clipped') + 1);
  assert.equal(COVERAGE_SENTENCE.reports_capped({ n: 1 }),
    '1 helper report was capped before review, so its elided middle cannot be quoted');
  assert.equal(COVERAGE_SENTENCE.reports_capped({ n: 2 }),
    '2 helper reports were capped before review, so their elided middle cannot be quoted');
  const text = renderReview(built);
  assert.match(text, /1 helper report was capped before review, so its elided middle cannot be quoted/);
  const line = text.split('\n').find((row) => row.startsWith('- `source_clipped`'));
  assert.ok(line, text);
  assert.ok(line.includes(HELPER_REPORT_CLIPPED_NOTE), line);
  assert.doesNotMatch(line, /recorder/);
  // A tool output the recorder cut keeps its own words: only the helper report's cut is Sonah's.
  assert.equal(COVERAGE_SENTENCE.source_clipped({ n: 1 }),
    '1 recorded text(s) were cut short by the recorder, so what was cut cannot be quoted');
});

test('M33 F a report never precedes its own hand-off: without a later recorded position it stays right after it', async (t) => {
  const { ledger } = await sessionOf(t, lateReportRows());
  const placedAt = (finalAnswer) => {
    const copy = structuredClone(ledger);
    copy.delegations[0].finalAnswer = { ...copy.delegations[0].finalAnswer, ...finalAnswer };
    for (const [key, value] of Object.entries(finalAnswer)) if (value === undefined) delete copy.delegations[0].finalAnswer[key];
    const session = adapt(copy, { sessionKey: 'fallback' });
    const ids = session.events.map((event) => event.id);
    return [ids.indexOf(named(session, 'D1-0-r')) - ids.indexOf(named(session, 'D1-0')),
      session.event(named(session, 'D1-0-r')).turn];
  };
  const record = ledger.delegations[0].record;
  // Where it was received: turn 3.
  assert.equal(placedAt({})[1], 'T3');
  // No recorded turn (a ledger written before placement), an earlier turn than the hand-off's, or the hand-off's own
  // turn on a row not after it: the recording cannot place it after its hand-off, so it stays right after it.
  for (const moved of [{ turn: undefined }, { turn: 0 }, { turn: 1, record: record - 1 }, { turn: 1, record }])
    assert.deepEqual(placedAt(moved), [1, 'T1'], JSON.stringify(moved));
  // The hand-off's own turn, on a later row: its own block after the hand-off, in that turn.
  const later = placedAt({ turn: 1 });
  assert.equal(later[1], 'T1');
  assert.ok(later[0] >= 1);
});
