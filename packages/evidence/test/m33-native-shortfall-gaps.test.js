// C-02 "M33 native-first Codex code-mode evidence" + refreeze: the per-turn shortfall is declared
// as COUNTED gaps, never only as a capture counter. The slicer writes three capture integers —
// `nativeInventoryShortfall`, `nativeCommandShortfall`, `nativeWriteShortfall` — and the adapter
// declares them exactly: an `actions` `incomplete_inventory` gap with the inventory shortfall, and
// `command_outcome_unknown` / `write_outcome_unknown` gaps with the command / file shortfalls.
// When that shortfall is a recording's ONLY incomplete cause, the generic uncounted `actions` gap is
// not declared beside it: the counted gap already states the loss (M33 refreeze). Any other cause
// keeps the generic gap.
//
// Synthetic ledgers and synthetic Codex rollouts only: no private recording, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFromLedger, eventIdCounts, EVENT_ID_GAPS } from '../adapters/sonah-ledger.js';
import { withoutIdentity } from './stable-ids-fixture.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { runReview } from '../src/run-review.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';

/** The coverage causes as every reader names them (the CLI's and the page's "Not covered" line). */
const causeLine = (report) => coverageCauses(report).map(([cause, counts]) => COVERAGE_SENTENCE[cause](counts)).join('; ');

const INVENTORY_REASON = 'codex_native_inventory_incomplete';
const ask = [{ turn: 1, text: 'Run the synthetic build and lint.' }];
const act = { turn: 1, seq: 0, kind: 'bash', cmd: 'node build.js', outcome: 'passed', exitCode: 0,
  exitCodeSource: 'native', tailLines: ['ok'] };
/** A ledger whose slicer declared a native-first shortfall, and nothing else incomplete. */
const shortfallLedger = (counts, over = {}) => ({ ask, ledger: [act], commentary: [], sayings: [], marks: [],
  capture: { calls: 0, wrappers: 1, captured: 0, unsupported: 0, missing: 0, unmapped: 0,
    interAgentMessagesUnparsed: 0, interAgentMessagesSoleIncomplete: false, reasons: [INVENTORY_REASON],
    incomplete: true, genericIncomplete: true, nativeItems: 1, nativeInventoryGaps: 1, ...counts, ...over } });
const gapsOf = (session, channel, code) => session.adapterGaps.filter((g) => g.channel === channel && g.code === code);
const eventless = (gap) => !Array.isArray(gap.eventIds) || gap.eventIds.length === 0;

test('C-02 native-first: each shortfall integer is declared as its own counted gap', () => {
  const session = sessionFromLedger(shortfallLedger({ nativeInventoryShortfall: 5, nativeCommandShortfall: 3,
    nativeWriteShortfall: 2 }), { sessionKey: 'native-shortfall' });
  const inventory = gapsOf(session, 'actions', 'incomplete_inventory').filter((g) => g.count === 5);
  assert.equal(inventory.length, 1, 'the actions incomplete_inventory gap carries the inventory shortfall');
  assert.equal(inventory[0].scope, 'session');
  const commands = gapsOf(session, 'observations', 'command_outcome_unknown').filter(eventless);
  assert.deepEqual(commands.map((g) => g.count), [3], 'one command_outcome_unknown gap with the command shortfall');
  const writes = gapsOf(session, 'observations', 'write_outcome_unknown').filter(eventless);
  assert.deepEqual(writes.map((g) => g.count), [2], 'one write_outcome_unknown gap with the file shortfall');
  for (const gap of [...inventory, ...commands, ...writes]) {
    assert.equal(gap.scope, 'session');
    assert.equal(gap.sessionKey, 'native-shortfall');
    assert.ok(Number.isSafeInteger(gap.lossOrdinal), 'an eventless loss keeps a source-local ordinal (C-03)');
  }
  // M33 refreeze: the shortfall is this recording's only incomplete cause, so no generic uncounted
  // actions gap is declared beside the counted one.
  assert.deepEqual(gapsOf(session, 'actions', 'incomplete_inventory').filter((g) => g.count === null), [],
    'the counted gap already states the loss');
  // Three distinct losses never collapse into one identity.
  const ordinals = [...inventory, ...commands, ...writes].map((g) => `${g.code}/${g.channel}/${g.lossOrdinal}`);
  assert.equal(new Set(ordinals).size, 3);
});

test('C-02 native-first: an inventory-only shortfall (an MCP family) declares no command or write outcome gap', () => {
  const session = sessionFromLedger(shortfallLedger({ nativeInventoryShortfall: 1, nativeCommandShortfall: 0,
    nativeWriteShortfall: 0 }));
  assert.deepEqual(gapsOf(session, 'actions', 'incomplete_inventory').map((g) => g.count), [1]);
  assert.deepEqual(gapsOf(session, 'observations', 'command_outcome_unknown').filter(eventless), []);
  assert.deepEqual(gapsOf(session, 'observations', 'write_outcome_unknown').filter(eventless), []);
});

test('C-02 native-first: a ledger without the native counters is unchanged, and zero declares nothing', () => {
  const legacy = shortfallLedger({});
  for (const key of ['nativeItems', 'nativeInventoryGaps']) delete legacy.capture[key];
  const zero = shortfallLedger({ nativeInventoryShortfall: 0, nativeCommandShortfall: 0, nativeWriteShortfall: 0 });
  const plain = sessionFromLedger(legacy).adapterGaps;
  assert.deepEqual(sessionFromLedger(zero).adapterGaps, plain);
  assert.ok(!plain.some((g) => g.code === 'command_outcome_unknown' || g.code === 'write_outcome_unknown'));
});

test('C-02 native-first: a counter that is not a safe nonnegative integer fails closed as an uncounted gap', () => {
  for (const bad of [-1, 1.5, '3', Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, null, true, {}]) {
    const session = sessionFromLedger(shortfallLedger({ nativeInventoryShortfall: bad, nativeCommandShortfall: bad,
      nativeWriteShortfall: bad }));
    const label = String(bad);
    // Never read as a count, never suppressed: each one is still declared, with no count stated.
    assert.ok(gapsOf(session, 'actions', 'incomplete_inventory').filter(eventless).length >= 2, label);
    assert.ok(gapsOf(session, 'actions', 'incomplete_inventory').every((g) => g.count === null
      || Number.isSafeInteger(g.count) && g.count >= 0), label);
    for (const code of ['command_outcome_unknown', 'write_outcome_unknown']) {
      const declared = gapsOf(session, 'observations', code).filter(eventless);
      assert.equal(declared.length, 1, `${label}: ${code}`);
      assert.equal(declared[0].count, null, `${label}: ${code}`);
    }
  }
});

test('C-02 native-first: a completed review names each shortfall with its count', async () => {
  const session = sessionFromLedger(shortfallLedger({ nativeInventoryShortfall: 5, nativeCommandShortfall: 3,
    nativeWriteShortfall: 2 }), { sessionKey: 'native-shortfall' });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only',
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [] }) });
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  const causes = Object.fromEntries(coverageCauses(report));
  assert.equal(causes.command_outcome_unknown.n, 3);
  assert.equal(causes.write_outcome_unknown.n, 2);
  // The inventory shortfall (5) alone: the generic declaration is not made beside it (M33 refreeze).
  assert.equal(causes.incomplete_inventory.n, 5, JSON.stringify(causes.incomplete_inventory));
  const header = causeLine(report);
  assert.match(header, /the recording does not show the exit status of 3 commands/);
  assert.match(header, /the recording does not show whether 2 writes succeeded/);
});

// ---- M33 refreeze: the generic gap beside a sole native shortfall ------------------------------
// The generic declaration is the one with no count and no note (a counter that is not a count is
// declared uncounted too, but with the shortfall's own note).
const generic = (session) => gapsOf(session, 'actions', 'incomplete_inventory')
  .filter((g) => g.count === null && g.note === undefined);
const counted = { nativeInventoryShortfall: 5, nativeCommandShortfall: 3, nativeWriteShortfall: 2 };

test('M33 refreeze: any other incomplete cause keeps the generic uncounted gap beside the counted one', () => {
  assert.deepEqual(generic(sessionFromLedger(shortfallLedger(counted))), [], 'premise: the sole cause declares none');
  const otherReason = (reason) => ({ reasons: [INVENTORY_REASON, reason] });
  for (const [name, over, extra] of [
    ['an unsupported item', { unsupported: 1 }],
    ['a missing result', { missing: 1 }],
    ['an unmapped result', { unmapped: 1 }],
    ['unparsed inter-agent messages', { interAgentMessagesUnparsed: 2 }],
    ['nontext human input', { instructionsNonText: 1 }],
    ['unclassified rows', { unclassifiedRows: 1 }],
    ['unsupported actions', { unsupportedActions: 1 }],
    ['orphan results', { orphanResults: 1 }],
    ['missing observations', { observationsMissing: 1 }],
    ['a non-integer loss counter', { unsupported: '0' }],
    ['unsupported row channels', { unsupportedRowChannels: { actions: 1 } }],
    ['another capture reason', otherReason('codex_wrapper_unsupported')],
    ['a delegation reason', otherReason('delegated_capture_unchecked')],
    ['no reasons', { reasons: [] }],
    ['the reason with no counted shortfall', { nativeInventoryShortfall: 0 }],
    ['a shortfall that is not a count', { nativeInventoryShortfall: '5' }],
    ['unparseable source lines', {}, { dropped: [{ turn: null, reason: 'unparseable_lines', count: 2 }] }],
    ['a conflicting source identity', {}, { sources: [{ adapter: 'codex', identityConflict: true }] }],
    ['an unresolved hand-off', {}, { delegations: [{ adapter: 'codex', turn: 1, status: 'unresolved',
      reason: 'delegation_result_malformed', source: 0, record: 3 }] }],
  ]) {
    const ledger = { ...shortfallLedger(counted, over), ...(extra ?? {}) };
    assert.equal(generic(sessionFromLedger(ledger)).length, 1, name);
  }
  // A capture that is not incomplete at all declares no generic gap either way.
  assert.deepEqual(generic(sessionFromLedger(shortfallLedger(counted, { incomplete: false }))), []);
});

test('M33 refreeze: a linked child whose only loss is its native shortfall declares no generic gap of its own', () => {
  const child = { ...shortfallLedger({ nativeInventoryShortfall: 2, nativeCommandShortfall: 1, nativeWriteShortfall: 0 }),
    ask: [], instructions: [{ turn: 1, text: 'Run the synthetic helper build.' }] };
  const session = sessionFromLedger({ ask, ledger: [act], commentary: [], sayings: [], marks: [],
    children: [{ source: 0, ledger: child, parentInstructions: [] }],
    delegations: [{ adapter: 'codex', kind: 'spawn', callId: 'c1', turn: 1, childId: 'helper-1', status: 'linked',
      reason: 'child_recording_linked', source: 0, record: 9, link: { source: 0 } }] }, { sessionKey: 'parent' });
  const own = (gap) => gap.sessionKey !== 'parent';
  assert.deepEqual(session.adapterGaps.filter((g) => own(g) && g.channel === 'actions' && g.code === 'incomplete_inventory')
    .map((g) => g.count), [2], 'the child\'s counted gap travels; no generic one beside it');
  assert.deepEqual(session.adapterGaps.filter((g) => own(g) && g.code === 'command_outcome_unknown'
    && !g.eventIds?.length).map((g) => g.count), [1]);
  // The parent's pointer to the child's incomplete capture is a different claim and is kept.
  assert.ok(session.adapterGaps.some((g) => !own(g) && g.channel === 'children' && g.code === 'incomplete_inventory'
    && g.count === null && g.eventIds?.[0] === 'D1-0'));
});

test('C-01 event identity: a recorder id an earlier redaction withheld is no redaction loss, so a native shortfall stays the sole cause', () => {
  // A synthetic call id an earlier Sonah's entropy backstop withheld as a possible credential (mixed case and digits,
  // high entropy). D90 (owner decision 2026-10-15): today's redaction keeps it as recorded; the ledger an earlier one
  // wrote carries the identity withheld (`withheld: true`, no native id), and is read below.
  const secretShaped = 'call_7CrfqsOSIDBHB0nXutiLsYj4';
  const identity = (record) => ({ stream: 0, record, block: 0, native: secretShaped });
  const withheld = (record) => ({ stream: 0, record, block: 0, withheld: true });
  assert.deepEqual(redact({ ...shortfallLedger(counted), ledger: [{ ...act, identity: identity(4) }] }).ledger.ledger[0]
    .identity, identity(4), 'today, as recorded');
  // A Codex parent whose hand-off linked (so its capture's reasons were left with the native shortfall alone, the
  // generic flag still set): the adapter's own sole-cause rule (`nativeShortfallOnly`) decides the generic gap.
  const identified = { ...shortfallLedger(counted), ledger: [{ ...act, identity: withheld(4) }],
    dropped: [{ turn: null, reason: INVENTORY_REASON }] };
  const now = redact(identified).ledger;
  assert.deepEqual(now.ledger[0].identity, withheld(4), 'premise: the recorder\'s id was withheld whole');
  // As before stable ids (the same ledger with no identity, which nothing scanned): the same declarations, the same gaps.
  const before = redact(withoutIdentity(identified)).ledger;
  assert.deepEqual(now.dropped, before.dropped, 'the withheld id is declared on its identity, never in `dropped`');
  const shape = (session) => session.adapterGaps.map(({ eventIds: _ids, ...gap }) => gap);
  const session = sessionFromLedger(now, { sessionKey: 'withheld' });
  assert.deepEqual(shape(session), shape(sessionFromLedger(before, { sessionKey: 'withheld' })));
  assert.deepEqual(generic(session), [], 'no generic uncounted gap beside the counted shortfall');
  assert.equal(eventIdCounts(session).gaps[EVENT_ID_GAPS.withheld], 2, 'the withheld id is counted (action, result)');
  // A hand-off whose call id is also its recorder id is declared once (as the hand-off identity it always was).
  const handOff = { adapter: 'codex', kind: 'spawn', callId: null, turn: 1, status: 'unresolved',
    reason: 'delegation_result_malformed', source: 0, record: 9, identity: withheld(9), identityUncheckedFields: ['callId'],
    identityUnchecked: true };
  const delegated = redact({ ...identified, delegations: [handOff],
    dropped: [...identified.dropped, { turn: 1, reason: 'dropped:unclassified-high-entropy', where: 'delegation' }] }).ledger;
  assert.equal(delegated.delegations[0].callId, null);
  assert.equal(delegated.delegations[0].identity.withheld, true);
  assert.deepEqual(delegated.dropped.filter((d) => d.reason !== INVENTORY_REASON).map((d) => d.where), ['delegation']);
});

test('M33 refreeze: each counter maps to its own gap; an unproved-turn floor counts only toward the inventory', () => {
  // The slicer counts an unproved turn's max(P - N, 1) floor only in the inventory shortfall.
  const floor = sessionFromLedger(shortfallLedger({ nativeInventoryShortfall: 4, nativeCommandShortfall: 0,
    nativeWriteShortfall: 0 }));
  assert.deepEqual(gapsOf(floor, 'actions', 'incomplete_inventory').map((g) => g.count), [4]);
  assert.deepEqual(gapsOf(floor, 'observations', 'command_outcome_unknown'), []);
  assert.deepEqual(gapsOf(floor, 'observations', 'write_outcome_unknown'), []);
  // Each counter is read as itself, never derived from another; an absent one declares nothing.
  const partial = shortfallLedger({ nativeInventoryShortfall: 6, nativeCommandShortfall: 2 });
  const session = sessionFromLedger(partial);
  assert.deepEqual(gapsOf(session, 'actions', 'incomplete_inventory').map((g) => g.count), [6]);
  assert.deepEqual(gapsOf(session, 'observations', 'command_outcome_unknown').map((g) => g.count), [2]);
  assert.deepEqual(gapsOf(session, 'observations', 'write_outcome_unknown'), []);
  const writesOnly = sessionFromLedger(shortfallLedger({ nativeWriteShortfall: 1 }));
  assert.deepEqual(gapsOf(writesOnly, 'observations', 'write_outcome_unknown').map((g) => g.count), [1]);
  assert.deepEqual(gapsOf(writesOnly, 'observations', 'command_outcome_unknown'), []);
});

// ---- end to end: a synthetic paginated Codex rollout ------------------------------------------
const OWN = 'thread-own';
const item = (payload) => ({ type: 'response_item', payload });
const eventMsg = (payload) => ({ type: 'event_msg', payload });
const rowsFor = (natives) => [
  { type: 'session_meta', payload: { id: OWN, cwd: '/repo' } },
  eventMsg({ type: 'task_started', turn_id: 't1', model_context_window: 1 }),
  item({ type: 'message', role: 'user', content: 'Build, lint and test.' }),
  item({ type: 'custom_tool_call', name: 'exec', call_id: 'w1',
    input: 'text(await tools.exec_command({cmd:"node build.js"})); text(await tools.exec_command({cmd:"node lint.js"})); '
      + 'text(await tools.exec_command({cmd:"node test.js"}));' }),
  ...natives.map((script, index) => eventMsg({ type: 'item_completed', thread_id: OWN, turn_id: 't1', item: {
    id: `i${index + 1}`, type: 'CommandExecution', status: 'completed', source: 'unified_exec_startup',
    command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0, stdout: '', stderr: '',
    aggregated_output: `${script} ran`, formatted_output: '', parsed_cmd: [], process_id: '4242',
    duration: { secs: 0, nanos: 1 } } })),
  item({ type: 'custom_tool_call_output', call_id: 'w1',
    output: ['Script completed', 'a', 'b', 'c'].map((text) => ({ type: 'input_text', text })) }),
];
async function slice(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-native-shortfall-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-09-29T10-00-00-synthetic.jsonl');
  await writeFile(file, rows.map((value) => JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 });
  return sliceLineage([file]);
}

test('end to end: three dispatched commands and one native item declare a command shortfall of two', async (t) => {
  const ledger = await slice(t, rowsFor(['node build.js']));
  assert.equal(ledger.capture.nativeCommandShortfall, 2, 'premise: the slicer counted the shortfall');
  const session = sessionFromLedger(redact(ledger).ledger, { sessionKey: 'native-shortfall' });
  assert.deepEqual(gapsOf(session, 'observations', 'command_outcome_unknown').filter(eventless).map((g) => g.count), [2]);
  assert.ok(gapsOf(session, 'actions', 'incomplete_inventory').some((g) => g.count === 2));
  assert.deepEqual(ledger.capture.reasons, [INVENTORY_REASON], 'premise: the shortfall is the only cause');
  assert.deepEqual(gapsOf(session, 'actions', 'incomplete_inventory').filter((g) => g.count === null), [],
    'no generic uncounted gap beside the counted one');
  // Near miss: every dispatched command has its native item — no shortfall, no counted gap.
  const whole = await slice(t, rowsFor(['node build.js', 'node lint.js', 'node test.js']));
  assert.equal(whole.capture.nativeInventoryShortfall, 0);
  const exact = sessionFromLedger(redact(whole).ledger, { sessionKey: 'native-shortfall' });
  assert.deepEqual(gapsOf(exact, 'observations', 'command_outcome_unknown'), []);
  assert.deepEqual(gapsOf(exact, 'actions', 'incomplete_inventory'), []);
});
