// C-03 "M33 child placement": a verified linked child's transferred history is placed immediately
// after its spawn assignment (and that assignment's own recorded result), in parent order, instead
// of after the parent's last event. Follow-ups keep their own link records and never move the
// history. Event identities are unchanged: only sequence (order) moves.
//
// Before M33 every hand-off of a turn, and the child history behind it, was emitted after the
// turn's last parent event — so a parent's closing claims about child work were reviewed in an
// earlier window than the child work itself, decisions were duplicated with conflicting columns
// and requirement rows doubled.
//
// Synthetic ledgers and synthetic recordings only: no private recording is read, no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { planWindows } from '../src/windows.js';
import { buildLedger } from '../src/ledger.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';

// ---- synthetic ledgers ---------------------------------------------------------------------------

/** A located Codex-shaped command: its call row and its result row on stream 0. */
const cmd = (turn, seq, record, name, extra = {}) => ({ turn, seq, kind: 'bash', cmd: `node ${name}.js`,
  outcome: 'passed', exitCode: 0, exitCodeSource: 'native', tailLines: [`${name} ok`],
  sourceLocator: { stream: 0, record, part: 0, resultRecord: record + 1 }, ...extra });
const say = (turn, record, beforeEvent, text) => ({ turn, source: 0, record, block: 0, beforeEvent, text });
const spawn = (turn, record, childId, source, extra = {}) => ({ adapter: 'codex', kind: 'spawn', callId: `call-${childId}`,
  turn, childId, status: 'linked', reason: 'child_recording_linked', source: 0, record, link: { source },
  parentInstruction: { tool: 'spawn_agent', field: 'message', text: `Take the ${childId} piece.` }, ...extra });
const followup = (turn, record, source) => ({ adapter: 'codex', kind: 'followup', callId: `followup-${record}`, turn,
  status: 'linked', reason: 'child_followup_linked', source: 0, record, target: 'helper', link: { source },
  parentInstruction: { tool: 'followup_task', field: 'message', text: 'One more synthetic check.' } });
const helper = (name, extra = {}) => ({ ask: [], instructions: [{ turn: 1, text: `Take the ${name} piece.` }],
  instructionAuthority: 'unchecked', sayings: [], marks: [],
  ledger: [cmd(1, 0, 3, `${name}-read`), cmd(1, 1, 6, `${name}-write`)],
  commentary: [say(1, 8, 2, `The ${name} piece is done.`)],
  capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] }, ...extra });
const unit = (source, ledger) => ({ source, ledger, parentInstructions: [] });

/** One parent turn: work, two spawns, more work, a follow-up
 *  to the first helper, more work, and a closing claim about the helpers' work. */
const parentLedger = (over = {}) => ({
  ask: [{ turn: 1, text: 'Split the synthetic work across two helpers, then summarise.' }],
  ledger: [cmd(1, 0, 5, 'survey'), cmd(1, 1, 20, 'check'), cmd(1, 2, 40, 'verify')],
  commentary: [say(1, 3, 0, 'Surveying before delegating.'), say(1, 50, 3, 'Both helpers finished their pieces.')],
  sayings: [], marks: [],
  delegations: [spawn(1, 10, 'helper-a', 0), spawn(1, 12, 'helper-b', 1), followup(1, 30, 0)],
  children: [unit(0, helper('alpha')), unit(1, helper('beta'))],
  ...over,
});
/** The same ledger with every hand-off's row withheld: nothing proves where a hand-off was
 *  recorded, so each keeps the pre-M33 place after the turn's work. That is the "before" layout. */
const unplaced = (ledger) => ({ ...ledger,
  delegations: ledger.delegations.map(({ record, ...rest }) => rest) });

const ids = (session) => session.events.map((event) => event.id);
const at = (session, id) => {
  const index = session.events.findIndex((event) => event.id === id);
  assert.ok(index >= 0, `event ${id} exists`);
  return index;
};
const byId = (session) => new Map(session.events.map((event) => [event.id, event]));
const withoutSequence = ({ sequence, ...rest }) => rest;
const sortedGaps = (session) => session.adapterGaps.map((gap) => ({ ...gap,
  ...(Array.isArray(gap.eventIds) ? { eventIds: [...gap.eventIds].sort() } : {}),
  ...(Array.isArray(gap.writes) ? { writes: [...gap.writes].sort((a, b) => a.eventId.localeCompare(b.eventId)) } : {}) }));

/** Only order moved: the same ids, the same events field for field except `sequence`, the same
 *  blobs, links and declared losses; sequences stay contiguous. */
function onlyOrderMoved(placed, legacy) {
  assert.deepEqual([...ids(placed)].sort(), [...ids(legacy)].sort(), 'the sorted id sets are equal');
  assert.equal(new Set(ids(placed)).size, placed.events.length, 'ids stay unique');
  const old = byId(legacy);
  for (const event of placed.events)
    assert.deepEqual(withoutSequence(event), withoutSequence(old.get(event.id)), `${event.id} is unchanged but for sequence`);
  assert.deepEqual(placed.events.map((event) => event.sequence), placed.events.map((_, index) => index));
  assert.deepEqual(placed.blobs, legacy.blobs);
  assert.deepEqual(JSON.parse(JSON.stringify(placed.children)), JSON.parse(JSON.stringify(legacy.children)));
  assert.deepEqual(sortedGaps(placed), sortedGaps(legacy));
}
const childSpan = (session, childId) => {
  const indexes = session.events.flatMap((event, index) => (event.childId === childId ? [index] : []));
  return { first: indexes[0], last: indexes.at(-1), count: indexes.length,
    contiguous: indexes.every((index, i) => i === 0 || index === indexes[i - 1] + 1) };
};

// ---- placement -----------------------------------------------------------------------------------

test('M33 child placement: a verified child\'s history follows its spawn, before the parent\'s later work', () => {
  const session = sessionFromLedger(parentLedger(), { sessionKey: 'parent' });
  const a = childSpan(session, 'helper-a');
  const b = childSpan(session, 'helper-b');
  assert.ok(a.count > 0 && a.contiguous && b.count > 0 && b.contiguous, 'each history is transferred whole, once');
  // The spawn is placed at its row: after the work recorded before it (record 5), and its child's
  // history immediately after it.
  assert.equal(at(session, 'D1-0'), at(session, 'A1-0-r') + 1, 'the first spawn follows the work recorded before it');
  assert.equal(a.first, at(session, 'D1-0') + 1, 'the first history starts right after its spawn');
  assert.equal(at(session, 'D1-1'), a.last + 1, 'the second spawn (record 12) follows the first history');
  assert.equal(b.first, at(session, 'D1-1') + 1, 'the second history starts right after its spawn');
  // Parent work recorded after the spawns comes after both histories, not before them.
  assert.equal(at(session, 'A1-1'), b.last + 1, 'the parent\'s next command follows the histories');
  // The closing claim about the helpers' work is read after that work.
  const closing = session.events.findLastIndex((event) => event.kind === 'commentary' && event.childId == null);
  assert.ok(closing > a.last && closing > b.last, 'the closing claim follows the child work it describes');
  assert.equal(closing, session.events.length - 1);
});

test('M33 child placement: event identities are unchanged; only sequence moves', () => {
  const placed = sessionFromLedger(parentLedger(), { sessionKey: 'parent' });
  const legacy = sessionFromLedger(unplaced(parentLedger()), { sessionKey: 'parent' });
  assert.notDeepEqual(ids(placed), ids(legacy), 'premise: the placement moved something');
  onlyOrderMoved(placed, legacy);
  // The legacy layout is the pre-M33 one: every hand-off after the turn's last parent event.
  assert.ok(at(legacy, 'D1-0') > at(legacy, 'A1-2-r'));
  assert.equal(legacy.events.findLastIndex((event) => event.kind === 'commentary' && event.childId == null),
    at(legacy, 'D1-0') - 1, 'before M33 the hand-offs followed the closing claim');
});

test('M33 child placement: a follow-up keeps its link record and does not move the history', () => {
  const session = sessionFromLedger(parentLedger(), { sessionKey: 'parent' });
  const a = childSpan(session, 'helper-a');
  // The follow-up (record 30) is at its own row: after the parent's command at record 20 and
  // before the one at record 40 — never beside, inside or ahead of the history it addresses.
  assert.equal(at(session, 'D1-2'), at(session, 'A1-1-r') + 1);
  assert.equal(at(session, 'A1-2'), at(session, 'D1-2') + 1);
  assert.equal(a.first, at(session, 'D1-0') + 1, 'the history is still the one block right after the spawn');
  assert.ok(at(session, 'D1-2') > a.last);
  const edges = session.children.filter((link) => link.childId === 'helper-a');
  assert.deepEqual(edges.map((link) => [link.assignmentEvent, link.relation, link.state]),
    [['D1-0', 'spawn', 'verified'], ['D1-2', 'followup', 'verified']]);
  assert.equal(edges[1].assignmentEffectProven, false);
  assert.ok(session.adapterGaps.some((gap) => gap.channel === 'children' && gap.code === 'incomplete_inventory'
    && gap.eventIds?.length === 1 && gap.eventIds[0] === 'D1-2'), 'the follow-up keeps its own declared loss');
  assert.deepEqual(buildLedger({ repo: { host: 'github.com', id: '1' }, session, pr: null }).gaps
    .filter((gap) => gap.code === 'missing_child'), []);
});

test('M33 child placement: a nested child is placed after its own spawn inside the child\'s history', () => {
  const grandchild = helper('gamma');
  const middle = helper('alpha', {
    ledger: [cmd(1, 0, 3, 'alpha-read'), cmd(1, 1, 9, 'alpha-write')],
    commentary: [say(1, 12, 2, 'The alpha piece is done, with gamma\'s part.')],
    delegations: [spawn(1, 6, 'helper-g', 0)],
    children: [unit(0, grandchild)],
  });
  const ledger = parentLedger({ delegations: [spawn(1, 10, 'helper-a', 0)], children: [unit(0, middle)],
    ledger: [cmd(1, 0, 5, 'survey'), cmd(1, 1, 20, 'check')],
    commentary: [say(1, 50, 2, 'The helper finished.')] });
  const session = sessionFromLedger(ledger, { sessionKey: 'parent' });
  const prefix = 'child:helper-a:';
  const g = childSpan(session, 'helper-g');
  assert.ok(g.count > 0 && g.contiguous);
  // Inside the child's history: its command at record 3, its spawn at record 6 with the
  // grandchild's history right behind it, then its command at record 9.
  assert.equal(at(session, `${prefix}D1-0`), at(session, `${prefix}A1-0-r`) + 1);
  assert.equal(g.first, at(session, `${prefix}D1-0`) + 1);
  assert.equal(at(session, `${prefix}A1-1`), g.last + 1);
  // And the child's whole history (grandchild included) is right after the parent's spawn.
  assert.equal(at(session, `${prefix}I1`), at(session, 'D1-0') + 1);
  assert.ok(at(session, 'A1-1') > at(session, `${prefix}A1-1-r`));
  onlyOrderMoved(session, sessionFromLedger({ ...unplaced(ledger), children: [unit(0, unplaced(middle))] },
    { sessionKey: 'parent' }));
});

// ---- precision: never inferred ---------------------------------------------------------------------

test('M33 child placement: a hand-off moves back only past parent events proven recorded after it', () => {
  const place = (ledger) => ids(sessionFromLedger(ledger, { sessionKey: 'parent' }));
  const legacy = place(unplaced(parentLedger()));
  // No row on the hand-off, or a row on another stream: nothing is proven, nothing moves.
  assert.deepEqual(place(unplaced(parentLedger())), legacy);
  const otherStream = parentLedger();
  otherStream.delegations = otherStream.delegations.map((d) => ({ ...d, source: 1 }));
  assert.deepEqual(place(otherStream), legacy);
  // Actions with no recorded row are never passed: the hand-off may only move back past the closing
  // commentary, whose row is recorded after it. M33 P amended who records none: a Claude ledger used to
  // (makeEvent set a row locator for Codex only), so every Claude Agent/Task and Workflow block stood after
  // the turn's last parent action. Now a ledger that links a helper records its Claude actions' rows too
  // (cli/test/m33-p-helper-placement.test.js: a synchronous Agent's block stands at its call row, before the
  // parent's later work); what still records none — a ledger written before M33 P, or one that links no
  // helper — keeps exactly this rule: unlocated work is never jumped.
  const unlocated = parentLedger();
  unlocated.ledger = unlocated.ledger.map(({ sourceLocator, ...rest }) => rest);
  const order = place(unlocated);
  assert.ok(order.indexOf('D1-0') > order.indexOf('A1-2-r'), 'unlocated parent work is not jumped');
  assert.equal(order.findLastIndex((id) => id.startsWith('C1-')), order.length - 1);
  // Recorded rows out of step with the event order: the scan stops at the first event not proven
  // after the hand-off, so nothing is placed ahead of work recorded before it.
  const inverted = parentLedger({ ledger: [cmd(1, 0, 5, 'survey'), cmd(1, 1, 45, 'check'), cmd(1, 2, 8, 'verify')] });
  const inv = place(inverted);
  assert.ok(inv.indexOf('D1-0') > inv.indexOf('A1-2-r'), 'a hand-off is never placed before work recorded before it');
});

test('M33 child placement: an action and its result are never separated, even around an interrupt row', () => {
  // A command called at record 8 whose result lands at record 11; the spawn is at record 9 and a
  // typed abort row at record 10 sits between the call and the result.
  const ledger = parentLedger({
    ledger: [cmd(1, 0, 5, 'survey'), { ...cmd(1, 1, 8, 'long'), sourceLocator: { stream: 0, record: 8, part: 0, resultRecord: 11 } }],
    commentary: [say(1, 50, 2, 'Summary after the helper.')],
    delegations: [spawn(1, 9, 'helper-a', 0)], children: [unit(0, helper('alpha'))],
    marks: [{ kind: 'interrupt', source: 'codex_turn_aborted', turn: 1, stream: 0, record: 10, beforeEvent: 2 }],
  });
  const session = sessionFromLedger(ledger, { sessionKey: 'parent' });
  const order = ids(session);
  assert.deepEqual(order.slice(order.indexOf('A1-1'), order.indexOf('A1-1-r') + 1), ['A1-1', 'B1-i0', 'A1-1-r'],
    'the rider stays inside its pair');
  assert.ok(order.indexOf('D1-0') > order.indexOf('A1-1-r'), 'the hand-off is not placed inside the pair');
  assert.equal(session.events.at(-1).kind, 'commentary', 'the closing commentary still follows the child work');
  assert.equal(session.events.at(-1).childId, undefined, 'and it is the parent\'s');
  for (const window of planWindows(session)) {
    const inWindow = new Set(window.events.map((event) => event.id));
    assert.equal(inWindow.has('A1-1'), inWindow.has('A1-1-r'), 'the pair is reviewed together');
  }
});

test('M33 child placement, M35: compactions travel with their sessions; the windows are each session\'s, none closed by one', () => {
  const childWithCompaction = helper('alpha', { marks: [{ turn: 1, kind: 'compaction' }],
    ask: [], instructions: [{ turn: 1, text: 'Take the alpha piece.' }, { turn: 2, text: 'Continue alpha.' }],
    ledger: [cmd(1, 0, 3, 'alpha-read'), cmd(2, 0, 9, 'alpha-write')],
    commentary: [say(2, 11, 1, 'The alpha piece is done.')] });
  const ledger = {
    ask: [{ turn: 1, text: 'Delegate the synthetic piece.' }, { turn: 2, text: 'Now summarise.' }],
    ledger: [cmd(1, 0, 5, 'survey'), cmd(1, 1, 20, 'check'), cmd(2, 0, 60, 'final')],
    commentary: [say(1, 30, 2, 'The helper reported back.'), say(2, 61, 2, 'Summary for the second ask.')],
    sayings: [],
    marks: [{ turn: 1, kind: 'compaction' },
      { kind: 'interrupt', source: 'codex_turn_aborted', turn: 1, stream: 0, record: 25, beforeEvent: 2 }],
    delegations: [spawn(1, 10, 'helper-a', 0)], children: [unit(0, childWithCompaction)],
  };
  const session = sessionFromLedger(ledger, { sessionKey: 'parent' });
  const order = ids(session);
  const a = childSpan(session, 'helper-a');
  assert.equal(a.first, order.indexOf('D1-0') + 1);
  assert.equal(order.indexOf('A1-1'), a.last + 1, 'the parent\'s work recorded after the spawn follows the history');
  // The parent's compaction still ends turn 1: after the child history and all of turn 1's work.
  const compaction = session.events.findIndex((event) => event.boundary === 'compaction' && event.childId == null);
  assert.ok(compaction > a.last && compaction > order.indexOf('B1-i0') && compaction < order.indexOf('I2'));
  // The typed interrupt row (record 25) follows the parent command recorded before it.
  assert.ok(order.indexOf('B1-i0') > order.indexOf('A1-1-r'));
  const windows = planWindows(session);
  const compactions = session.events.filter((event) => event.boundary === 'compaction').map((event) => event.id);
  assert.equal(compactions.length, 2, 'the child\'s own compaction travels with it');
  // M35 (windowing): a compaction is no window boundary; the helper is a session of its own, reviewed right after the
  // parent's window that launched it; every event is in exactly one window. M36 phase 3 (D68 K): small, it shares that
  // window, as its own part.
  assert.deepEqual(windows.map((window) => window.parts.map((part) => part.session.childId)), [[null, 'helper-a']]);
  assert.ok(windows[0].parts[1].events.every((event) => event.childId === 'helper-a'));
  assert.ok(windows[0].parts[0].events.every((event) => event.childId == null));
  assert.deepEqual(windows.flatMap((window) => window.events.map((event) => event.id)).sort(), [...order].sort());
  onlyOrderMoved(session, sessionFromLedger(unplaced(ledger), { sessionKey: 'parent' }));
});

// ---- end to end: the recorder's own layout -------------------------------------------------------

const AGENT = '0123456789abcdef';
const SID = 'e3f1c2d4-1111-4222-8333-abcdefabcdef';
const save = (file, rows) => writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
const userRow = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const callRow = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const resultRow = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const sayRow = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('end to end: a Claude parent\'s closing claim is read after the linked child\'s work', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-m33-child-placement-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects');
  const project = join(projects, '-srv-x-repo');
  const nested = join(project, SID, 'subagents');
  await mkdir(nested, { recursive: true });
  const root = join(project, `${SID}.jsonl`);
  await save(root, [
    userRow('Delegate the synthetic migration, then tell me what changed.'),
    sayRow('Handing the migration to a helper.'),
    callRow('spawn-a', 'Agent', { prompt: 'Write src/child.js and keep it small' }),
    // L2: with the typed sidecar Claude Code writes for a completed synchronous agent (its status decides the mode).
    { ...resultRow('spawn-a', `Agent finished.\nagentId: ${AGENT}\nThe helper wrote src/child.js.`),
      toolUseResult: { status: 'completed', agentId: AGENT, content: [{ type: 'text', text: 'The helper wrote src/child.js.' }] } },
    sayRow('The helper wrote src/child.js as asked.'),
  ].map((r) => ({ cwd: '/srv/x/repo', sessionId: SID, isSidechain: false, ...r })));
  await save(join(nested, `agent-${AGENT}.jsonl`), [
    userRow('Write src/child.js and keep it small'),
    callRow('child-write', 'Write', { file_path: '/srv/x/repo/src/child.js', content: 'const attempts = 3;' }),
    resultRow('child-write', 'File created successfully'),
    sayRow('Wrote the file as asked.'),
  ].map((r) => ({ cwd: '/srv/x/repo', sessionId: SID, agentId: AGENT, isSidechain: true, ...r })));
  const ledger = redact(await loadSessionEvidence([root], { recordingRoots: { claude: projects } })).ledger;
  assert.equal(ledger.delegations?.[0]?.status, 'linked', 'premise: the child is linked');
  const session = sessionFromLedger(ledger, { sessionKey: 'parent' });
  const order = ids(session);
  const child = childSpan(session, AGENT);
  assert.ok(child.count > 0 && child.contiguous);
  assert.equal(child.first, order.indexOf(session.delegations()[0].id) + 1);
  const claim = session.events.findIndex((event) => event.kind === 'commentary' && event.childId == null
    && session.textOf(event, 'text').includes('The helper wrote'));
  assert.ok(claim > child.last, 'the parent\'s claim about the child\'s work is read after that work');
  const opening = session.events.findIndex((event) => event.kind === 'commentary' && event.childId == null
    && session.textOf(event, 'text').includes('Handing the migration'));
  assert.ok(opening < order.indexOf(session.delegations()[0].id), 'commentary recorded before the hand-off stays before it');
  assert.deepEqual(session.events.map((event) => event.sequence), session.events.map((_, index) => index));
});
