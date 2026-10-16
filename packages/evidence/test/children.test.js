// B2 — a captured sub-agent session is linked, transferred and reviewed.
//
// In an agent-delegated workflow the sub-agents' sessions ARE the session: when Sonah reviewed
// its own wave the code had been written by eight children, none of them linked, and the report
// said `missing_child` eight times. A3 made that gap honest. This makes it go away when the
// child recording exists — and keeps it when it does not.
//
// Every fixture is synthetic and written to a temp directory. No real recording is read, no
// model is called: the judge is injected and records the prompt it was handed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, HELPER_PLACEMENT_NOTES } from '../adapters/sonah-ledger.js';
import { buildLedger, sessionCoverageFacts, instructionReviewScope, deriveColumn } from '../src/ledger.js';
import { verifyReceipt } from '../src/session.js';
import { planWindows } from '../src/windows.js';
import { buildNarrativePrompt } from '../src/prompt.js';
import { runReview } from '../src/run-review.js';

const AGENT_A = '0123456789abcdef';
const AGENT_B = 'fedcba9876543210';
const SID = 'e3f1c2d4-1111-4222-8333-abcdefabcdef';

const save = (file, rows) => writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const write = (id, path, content) => call(id, 'Write', { file_path: path, content });

/** The layout and receipt Claude Code writes: a prose Agent result naming the agentId, with its typed launch sidecar
 *  (L2: the status decides the launch mode, never the prose), and the child transcript at
 *  <project>/<sessionId>/subagents/agent-<agentId>.jsonl. */
const launch = (id, agentId, brief) => [call(id, 'Agent', { prompt: brief }),
  { ...result(id, `Async agent launched.\nagentId: ${agentId}\nUse SendMessage to reach it.`),
    toolUseResult: { status: 'async_launched', isAsync: true, agentId, description: 'synthetic' } }];

async function fixture(t, { turns, children = [AGENT_A] } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah b2 children ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'), project = join(projects, '-Users-someone-repo');
  const nested = join(project, SID, 'subagents');
  await mkdir(nested, { recursive: true });
  const root = join(project, `${SID}.jsonl`);
  const rows = turns ?? [
    user('Read the parser first.'),
    write('parent-write', '/repo/src/parser.js', 'const parser = 1;'),
    result('parent-write', 'File created successfully'),
    user('Now delegate the migration.'),
    ...launch('spawn-a', AGENT_A, 'Write src/child.js and keep it small'),
  ];
  // M34 labels review (F6): the root is a typed recorder (2.1.219 and later), whose human prompts carry the host's typed
  // origin; an unversioned one is labelled by the declared legacy fallback, every row of it a counted gap.
  await save(root, rows.map((r) => ({ cwd: '/repo', sessionId: SID, isSidechain: false, version: '2.1.284',
    ...(r.type === 'user' && typeof r.message?.content === 'string' ? { origin: { kind: 'human' } } : {}), ...r })));
  const childFile = (agentId) => join(nested, `agent-${agentId}.jsonl`);
  const saveChild = (agentId, extra = []) => save(childFile(agentId),
    [user(`Write src/${agentId.slice(0, 4)}.js and keep it small`),
      write('child-write', `/repo/src/${agentId.slice(0, 4)}.js`, 'const attempts = 3;'),
      result('child-write', 'File created successfully'),
      say('Wrote the file as asked.'), ...extra]
      .map((r) => ({ cwd: '/repo', sessionId: SID, agentId, isSidechain: true, ...r })));
  for (const agentId of children) await saveChild(agentId);
  return { dir, root, nested, childFile, saveChild, options: { recordingRoots: { claude: projects } } };
}

/** The production path: slice + link + redact, then the canonical adapter. */
async function reviewed(root, options) {
  const ledger = redact(await loadSessionEvidence([root], options)).ledger;
  return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'parent' }) };
}

const repo = { host: 'github.com', id: '1' };
const pathsOf = (session) => session.events.filter((e) => e.kind === 'invocation')
  .flatMap((e) => (e.paths ?? []).map((p) => p.path));

// ---- linked ---------------------------------------------------------------------------

test('B2: a linked child becomes a reviewable part of the session', async (t) => {
  const f = await fixture(t);
  const { session } = await reviewed(f.root, f.options);

  const delegations = session.delegations();
  assert.equal(delegations.length, 1, 'the hand-off is an action the ledger can see');
  const link = session.childFor(delegations[0].id);
  assert.ok(link, 'the delegation carries a child link');
  assert.equal(link.state, 'verified');
  assert.equal(link.childId, AGENT_A);
  assert.equal(link.childSession, link.session.sessionKey);

  // The child's own work is in the reviewed session, after the assignment that produced it.
  const child = session.events.find((e) => e.kind === 'invocation'
    && (e.paths ?? []).some((p) => p.path === 'src/0123.js'));
  assert.ok(child, `the child's write is visible to the review; paths were ${pathsOf(session)}`);
  assert.equal(child.childId, AGENT_A, 'and is attributed to the child, not to the parent');
  assert.ok(child.sequence > delegations[0].sequence, 'it comes after the delegate event');
  assert.ok(pathsOf(session).includes('src/parser.js'), "the parent's own actions are untouched");

  // Transferred is not the same as merely present: the child's text has to be quotable, which
  // means its blob keys travelled with its events.
  assert.equal(verifyReceipt(session, { eventId: child.id, role: 'action', quote: 'src/0123.js' }).ok, true);
  const said = session.events.find((e) => e.kind === 'commentary' && e.childId === AGENT_A);
  assert.ok(said && session.textOf(said, 'text').includes('Wrote the file as asked.'));
  assert.equal(new Set(session.events.map((e) => e.id)).size, session.events.length, 'ids stay unique');
  assert.equal(new Set(session.events.map((e) => e.sequence)).size, session.events.length,
    'sequence numbers stay unique across the transfer');
});

test('B2: a linked child contributes no missing_child gap', async (t) => {
  const f = await fixture(t);
  const { session } = await reviewed(f.root, f.options);
  const report = buildLedger({ repo, session, pr: null });
  assert.deepEqual(report.gaps.filter((g) => g.code === 'missing_child' || g.code === 'ambiguous_child'), []);
  assert.equal(sessionCoverageFacts({ session }).delegationsUnlinked, 0);
  // The child's own capture is incomplete (its instruction authority is unchecked) and that is
  // declared ON THE CHILD — a different claim from "this work was never captured".
  // M33 P second repair: its result is the asynchronous launch stub (no `run_in_background` input, as Claude Code writes
  // it), and no completion of it was recorded: its work stands after the session's last request, declared.
  const declared = session.adapterGaps.filter((g) => g.channel === 'children' && g.note !== HELPER_PLACEMENT_NOTES.unreceived);
  assert.deepEqual(declared.map((g) => g.code), ['incomplete_inventory']);
  assert.deepEqual(declared[0].eventIds, [session.delegations()[0].id]);
  assert.deepEqual(session.adapterGaps.filter((g) => g.note === HELPER_PLACEMENT_NOTES.unreceived)
    .map((g) => [g.code, g.count, g.eventIds]), [['incomplete_inventory', 1, [session.delegations()[0].id]]]);
});

test('B2: the review is handed the child\'s work', async (t) => {
  const f = await fixture(t);
  const { session } = await reviewed(f.root, f.options);
  const prompts = [];
  const judge = async (request) => {
    prompts.push(request.prompt);
    return request.challenge ? { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'Synthetic support vote for orchestration testing.', receipts: [] })) }
      : { decisions: [], pivots: [], requirements: [], claims: [] };
  };
  const report = await runReview({ session, pr: null, judge });
  assert.ok(prompts.length, 'the session was reviewed at all');
  assert.ok(prompts.some((p) => p.includes('src/0123.js')), "the child's write reached the reviewer");
  assert.equal(report.coverageFacts.delegationsUnlinked, 0);
});

// ---- missing and ambiguous stay exactly as they were ------------------------------------

test('B2: a child recording that does not exist is still a missing child (A3)', async (t) => {
  const f = await fixture(t);
  await rm(f.childFile(AGENT_A));
  const { session } = await reviewed(f.root, f.options);
  assert.deepEqual(session.children, []);
  const report = buildLedger({ repo, session, pr: null });
  assert.deepEqual(report.gaps.map((g) => g.code), ['missing_child']);
  assert.notEqual(report.sessionStatus, 'CLEAN');
});

test('B2: two recordings claiming one agentId are an ambiguous child, not a link', async (t) => {
  const f = await fixture(t);
  await save(join(f.nested, 'agent-duplicate.jsonl'),
    [user('Write src/other.js'), write('w', '/repo/src/other.js', 'x')]
      .map((r) => ({ cwd: '/repo', sessionId: SID, agentId: AGENT_A, isSidechain: true, ...r })));
  const { session } = await reviewed(f.root, f.options);
  assert.deepEqual(session.children, []);
  assert.deepEqual(buildLedger({ repo, session, pr: null }).gaps.map((g) => g.code), ['ambiguous_child']);
  assert.ok(!pathsOf(session).includes('src/other.js'), 'an unlinked candidate contributes no actions');
});

// ---- authority ------------------------------------------------------------------------

test('B2: a child\'s instructions never carry human authority', async (t) => {
  const f = await fixture(t);
  const { session } = await reviewed(f.root, f.options);
  const instructions = session.events.filter((e) => e.kind === 'instruction');
  const childInstructions = instructions.filter((e) => e.childId === AGENT_A);
  assert.ok(childInstructions.length, 'the assignment the child worked under is recorded');
  assert.ok(childInstructions.every((e) => e.authority !== 'human'));
  assert.ok(instructions.some((e) => e.authority === 'human'), "the parent's own asks stay human");

  // A decision citing the child's assignment cannot settle a column...
  const action = session.events.find((e) => e.kind === 'invocation'
    && (e.paths ?? []).some((p) => p.path === 'src/0123.js'));
  const quote = session.sourcesFor(childInstructions[0])[0].text.slice(0, 20);
  const cited = deriveColumn(session, { instruction: { eventId: childInstructions[0].id, role: 'instruction', quote },
    settles: false, settledValueQuote: null }, true, [action]);
  assert.equal(cited.column, null);
  assert.equal(cited.reason, 'ambiguous_authority');

  // ...and the child's work can never be certified `unasked` against the parent's history.
  const scope = instructionReviewScope(session);
  assert.equal(scope.complete, true, 'the child assignment cannot erase the root human inventory');
  const absent = deriveColumn(session, null, true, [action],
    { dimension: 'file layout', scopeDigest: scope.scopeDigest, noRelevantInstruction: true, checks: [] },
    'file layout');
  assert.equal(absent.column, null);
  assert.equal(absent.reason, 'instructions_partial');
});

test('B2: the reviewer is never told a parent agent\'s brief is a human instruction', async (t) => {
  const f = await fixture(t);
  const { session } = await reviewed(f.root, f.options);
  // M35: the helper is a session of its own — its brief opens its own session, after the parent's. M36 phase 3 (D68 K):
  // small, it shares the parent's window, under its own heading.
  const windows = planWindows(session);
  const promptOf = (window) => buildNarrativePrompt({ session, window }).prompt;
  const assignment = session.events.find((e) => e.kind === 'instruction' && e.childId === AGENT_A);
  const helper = windows.find((window) => window.parts.some((part) => part.session.childId === AGENT_A));
  const line = promptOf(helper).split('\n').find((l) => l.startsWith(`[${assignment.id}]`));
  assert.ok(line, 'the child\'s assignment is in the prompt');
  assert.ok(!line.includes('HUMAN'), `a brief is not a human instruction, but the prompt said: ${line}`);
  assert.match(line, /authority=agent/);
  // The parent's own ask keeps its header.
  const human = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  assert.match(promptOf(windows[0]).split('\n').find((l) => l.startsWith(`[${human.id}]`)), /HUMAN INSTRUCTION/);
});

// ---- F29: the turn of the tool_use ------------------------------------------------------

test('F29: each delegate event carries the turn its own tool_use happened in', async (t) => {
  const f = await fixture(t, {
    children: [AGENT_A, AGENT_B],
    turns: [
      user('Read the parser first.'),                                        // turn 1
      user('Delegate the first piece.'),                                     // turn 2
      ...launch('spawn-a', AGENT_A, 'Write src/0123.js and keep it small'),
      // A background agent reporting in is an event, not an ask: it must not advance the turn.
      { ...user('<task-notification>the first agent reported in</task-notification>'),
        origin: { kind: 'task-notification' } },
      user('Check the parser while it runs.'),                               // turn 3
      write('parent-write', '/repo/src/parser.js', 'const parser = 1;'),
      result('parent-write', 'File created successfully'),
      user('Delegate the second piece.'),                                    // turn 4
      ...launch('spawn-b', AGENT_B, 'Write src/fedc.js and keep it small'),
    ],
  });
  const { session } = await reviewed(f.root, f.options);
  const ids = session.delegations().map((e) => e.id);
  assert.equal(ids.length, 2);
  // C-01 event identity: the turn is the event's own field, never read off its id.
  assert.deepEqual(session.delegations().map((e) => e.turn), ['T2', 'T4'],
    'a second delegation must not inherit the turn of the first');
  assert.equal(session.children.length, 2);
  assert.deepEqual(session.children.map((c) => c.assignmentEvent), ids);
});

// ---- shapes the disk fixture cannot reach as cheaply ------------------------------------

// A Codex follow-up is a second hand-off to a child an earlier spawn already linked. Two edges,
// one recording: counting its actions twice would inflate the session with work nobody did.
const childUnit = (source, unit) => ({ source, ledger: unit, parentInstructions: [] });
const grandchild = {
  ask: [], instructions: [{ turn: 1, text: 'Grandchild assignment.' }], instructionAuthority: 'unchecked',
  ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'src/grandchild.js', via: 'Write' }],
  capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] },
};
const worker = {
  ask: [], instructions: [{ turn: 1, text: 'Worker assignment.' }], instructionAuthority: 'unchecked',
  ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'src/worker.js', via: 'Write' }],
  capture: { incomplete: true, reasons: ['child_instruction_authority_unchecked'] },
  delegations: [{ adapter: 'codex', callId: 'g', turn: 1, childId: 'grand-1', status: 'linked',
    reason: 'child_recording_linked', source: 0, link: { source: 0 } }],
  children: [childUnit(0, grandchild)],
};

test('M29: a follow-up is a second edge, not proof its assignment affected the child', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Do the work.' }], ledger: [], children: [childUnit(0, worker)],
    delegations: [
      { adapter: 'codex', kind: 'spawn', callId: 's', turn: 1, childId: 'worker-1', status: 'linked',
        reason: 'child_recording_linked', source: 0, link: { source: 0 },
        parentInstruction: { text: 'Build the worker.', tool: 'collaboration.spawn_agent', field: 'message' } },
      { adapter: 'codex', kind: 'followup', callId: 'f', turn: 1, status: 'linked',
        reason: 'child_followup_linked', source: 0, link: { source: 0 },
        parentInstruction: { text: 'One more thing.', tool: 'collaboration.followup_task', field: 'message' } },
    ],
  }, { sessionKey: 'parent' });

  // Three hand-offs are now visible: the two the parent made, and the one the child made.
  assert.equal(session.delegations().length, 3);
  assert.ok(session.delegations().every((e) => session.childFor(e.id)?.state === 'verified'),
    'a transferred grandchild must not read as a missing child');
  assert.deepEqual(session.children.map((c) => c.relation).sort(), ['followup', 'spawn', 'spawn']);
  assert.equal(new Set(session.children.filter((c) => c.childId === 'worker-1')
    .map((c) => c.childSession)).size, 1, 'one child, two edges');
  assert.deepEqual(buildLedger({ repo, session, pr: null }).gaps, []);
  const followup = session.children.find((c) => c.relation === 'followup');
  assert.equal(followup.assignmentEffectProven, false);
  assert.deepEqual(session.adapterGaps.filter((g) => g.channel === 'children'
    && g.eventIds?.includes(followup.assignmentEvent)).map((g) => g.code), ['incomplete_inventory'],
  'the linked identity does not establish attributable post-follow-up work');
  assert.equal(pathsOf(session).filter((p) => p === 'src/worker.js').length, 1, 'its work is counted once');
  // The grandchild travelled with it and kept its OWN identity, not the child's.
  const deep = session.events.find((e) => (e.paths ?? []).some((p) => p.path === 'src/grandchild.js'));
  assert.ok(deep, 'a grandchild is transferred through the child that linked it');
  assert.equal(deep.childId, 'grand-1');
  assert.equal(new Set(session.events.map((e) => e.id)).size, session.events.length);
});

test('B2: a child link serializes as link facts, not as a second copy of the evidence', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Do the work.' }], ledger: [], children: [childUnit(0, worker)],
    delegations: [{ adapter: 'codex', kind: 'spawn', callId: 's', turn: 1, childId: 'worker-1',
      status: 'linked', reason: 'child_recording_linked', source: 0, link: { source: 0 } }],
  }, { sessionKey: 'parent' });
  const link = session.childFor(session.delegations()[0].id);
  assert.ok(link.session, 'the child Session is reachable for a caller that wants it');
  // pr-review.js hashes `session.children` into EVERY window reuse key. The child's events are
  // already hashed there as window events; re-encoding its whole session per window is pure
  // cost, so the handle is not part of the serialized link.
  const encoded = JSON.parse(JSON.stringify(session.children));
  assert.deepEqual(Object.keys(encoded[0]).sort(),
    ['assignmentEvent', 'childId', 'childSession', 'historyStart', 'relation', 'sessionKey', 'state']);
  assert.ok(!JSON.stringify(session.children).includes('src/worker.js'));
});

test('B2: a delegation linked to evidence this ledger does not carry stays a missing child', () => {
  const session = sessionFromLedger({
    ask: [{ turn: 1, text: 'Do the work.' }], ledger: [],
    delegations: [{ adapter: 'claude', callId: 's', turn: 1, childId: AGENT_A, status: 'linked',
      reason: 'child_recording_linked', source: 0, link: { source: 4 } }],
  }, { sessionKey: 'parent' });
  assert.deepEqual(session.children.map((c) => c.state), ['missing']);
  assert.deepEqual(buildLedger({ repo, session, pr: null }).gaps.map((g) => g.code), ['missing_child']);
});
