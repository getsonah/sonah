import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionEvidence, evidenceContext, CHILD_CAPTURE_REASONS } from '../src/session-evidence.js';
import { sliceLineage, hasCaptureGaps } from '../../slicer/index.js';
import { redact, sliceHash } from '../../redact/index.js';

const user = text => ({ type: 'user', message: { content: text } });
const call = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content, is_error = false) => ({ type: 'user', message: { content: [
  { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content), is_error },
] } });
const write = (id, path, content) => call(id, 'Write', { file_path: path, content });
const spawn = (id, child) => [call(id, 'Task', { prompt: 'private child brief' }), result(id, { agentId: child })];
const save = (file, rows) => writeFile(file, rows.map(JSON.stringify).join('\n') + '\n', { mode: 0o600 });

async function fixture(t, { childRows, rootRows } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah child evidence ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'), project = join(projects, 'example');
  const nested = join(project, 'root', 'subagents');
  await mkdir(nested, { recursive: true });
  const root = join(project, 'root.jsonl'), child = join(nested, 'agent-any-name.jsonl');
  const parent = rootRows ?? [user('Review the parser.'), write('parent-write', 'src/root.js', 'root'), ...spawn('spawn-1', 'child-1')];
  const work = childRows ?? [user('Choose a queue independently.'), write('child-write', 'src/child.js', 'const attempts = 3;'), result('child-write', 'written')];
  await save(root, parent.map(r => ({ cwd: '/repo', sessionId: 'root', ...r })));
  const saveChild = rows => save(child, rows.map(r => ({ cwd: '/repo', sessionId: 'root', agentId: 'child-1', isSidechain: true, ...r })));
  await saveChild(work);
  return { dir, root, child, nested, work, saveChild, options: { recordingRoots: { claude: projects } } };
}

// B2: the layout and receipt Claude Code actually writes — the child transcript lives at
// <project>/<sessionId>/subagents/agent-<agentId>.jsonl, and the parent's Agent tool RESULT is
// prose carrying the line `agentId: <16 hex>`. Nothing here is JSON-shaped, which is why the
// live pipeline reported missing_child for every captured child.
const AGENT_A = '0123456789abcdef', AGENT_B = 'fedcba9876543210';
const launch = (id, agentId) => [call(id, 'Agent', { prompt: 'private child brief' }),
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id,
    content: `Async agent launched.\nagentId: ${agentId}\nUse SendMessage to reach it.` }] } }];

async function liveFixture(t, { agents = [AGENT_A], sid = 'e3f1c2d4-1111-4222-8333-abcdefabcdef' } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah live children ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'), project = join(projects, '-Users-someone-repo');
  const nested = join(project, sid, 'subagents');
  await mkdir(nested, { recursive: true });
  const root = join(project, `${sid}.jsonl`);
  await save(root, [user('Read the parser.'), user('Now delegate the migration.'),
    ...agents.flatMap((agentId, i) => launch(`spawn-${i}`, agentId))]
    .map(r => ({ cwd: '/repo', sessionId: sid, isSidechain: false, ...r })));
  const childFile = agentId => join(nested, `agent-${agentId}.jsonl`);
  const saveChild = (agentId, rows) => save(childFile(agentId), rows.map(r => ({ cwd: '/repo', sessionId: sid,
    agentId, isSidechain: true, ...r })));
  for (const agentId of agents) {
    await saveChild(agentId, [user(`Write src/${agentId.slice(0, 4)}.js`),
      write('child-write', `src/${agentId.slice(0, 4)}.js`, 'const attempts = 3;'), result('child-write', 'written')]);
  }
  return { dir, root, nested, sid, childFile, saveChild, options: { recordingRoots: { claude: projects } } };
}

test('B2: the sub-agent transcript Claude Code writes beside the parent links to its delegation', async t => {
  const f = await liveFixture(t);
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.delegations.length, 1);
  assert.equal(ledger.delegations[0].status, 'linked');
  assert.equal(ledger.delegations[0].childId, AGENT_A);
  assert.equal(ledger.delegations[0].turn, 2, 'the turn of the tool_use, not of the first delegation');
  assert.equal(ledger.children.length, 1);
  assert.deepEqual(ledger.children[0].ledger.ledger.map(e => e.path), ['src/0123.js']);
  assert.deepEqual(ledger.children[0].ledger.ask, [], 'a child brief is never a human instruction');
  assert.equal(ledger.children[0].ledger.instructions[0].origin, 'agent-or-inherited');
});

test('D90: an opaque Claude call ID is kept as recorded, with the verified child ID and parent session link', async t => {
  const opaque = 'call_' + createHash('sha256').update('synthetic opaque ID 32')
    .digest('base64url').replace(/[-_]/g, 'A').slice(0, 24);
  const f = await fixture(t, { rootRows: [user('Review the parser.'), ...spawn(opaque, 'child-1')] });
  const ledger = await loadSessionEvidence([f.root], { ...f.options, reviewLinkedChildren: true });
  assert.equal(ledger.delegations[0].status, 'linked');
  assert.equal(ledger.delegations[0].callId, opaque);
  assert.equal(ledger.delegations[0].identityUncheckedFields, undefined);
  assert.equal(ledger.children.length, 1);
});

test('a PR review can clear only resolved child capture flags while the default load and direct child remain guarded', async t => {
  const f = await liveFixture(t);
  const unlinked = await loadSessionEvidence([f.root], f.options);
  assert.equal(hasCaptureGaps(unlinked), true);
  assert.ok(unlinked.capture.reasons.includes(CHILD_CAPTURE_REASONS.REVIEW_UNCHECKED));

  const reviewed = await loadSessionEvidence([f.root], { ...f.options, reviewLinkedChildren: true });
  assert.equal(reviewed.delegations[0].status, 'linked');
  assert.equal(reviewed.children.length, 1);
  assert.equal(hasCaptureGaps(reviewed), false);
  assert.equal(reviewed.capture.incomplete, false);
  assert.equal(reviewed.children[0].ledger.instructionAuthority, 'unchecked');
  assert.deepEqual(reviewed.children[0].ledger.ask, []);
  assert.equal(hasCaptureGaps(reviewed.children[0].ledger), false);

  const standalone = await loadSessionEvidence([f.childFile(AGENT_A)],
    { ...f.options, reviewLinkedChildren: true });
  assert.equal(standalone.instructionAuthority, 'unchecked');
  assert.equal(hasCaptureGaps(standalone), true);
  assert.ok(standalone.capture.reasons.includes(CHILD_CAPTURE_REASONS.INSTRUCTION_AUTHORITY));
});

test('PR review child mode retains genuine incomplete child history', async t => {
  const f = await codexFixture(t);
  f.rows[5].ordinal = 6; f.rows[6].ordinal = 7;
  await save(f.child, f.rows);
  const reviewed = await loadSessionEvidence([f.root], { ...f.options, reviewLinkedChildren: true });
  assert.equal(reviewed.delegations[0].status, 'linked');
  assert.equal(reviewed.children[0].ledger.ledger.length, 0);
  assert.equal(hasCaptureGaps(reviewed.children[0].ledger), true);
  assert.ok(reviewed.children[0].ledger.capture.reasons.includes('child_history_unchecked'));
});

test('PR review child mode retains a missing sibling while transferring the verified one', async t => {
  const f = await liveFixture(t, { agents: [AGENT_A, AGENT_B] });
  await rm(f.childFile(AGENT_B));
  const reviewed = await loadSessionEvidence([f.root], { ...f.options, reviewLinkedChildren: true });
  assert.equal(reviewed.children.length, 1);
  assert.deepEqual(reviewed.delegations.map(d => d.status), ['linked', 'unresolved']);
  assert.equal(hasCaptureGaps(reviewed), true);
  assert.ok(reviewed.capture.reasons.includes(CHILD_CAPTURE_REASONS.CAPTURE_UNCHECKED));
  assert.equal(hasCaptureGaps(reviewed.children[0].ledger), false);
});

test('B2: a deleted child recording still reports the missing child (A3 stays pinned)', async t => {
  const f = await liveFixture(t);
  await rm(f.childFile(AGENT_A));
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children, undefined);
  assert.equal(ledger.delegations[0].status, 'unresolved');
  assert.equal(ledger.delegations[0].reason, 'child_link_unavailable');
  assert.equal(hasCaptureGaps(ledger), true);
});

test('B2: two recordings claiming one agentId are ambiguous, not a pick', async t => {
  const f = await liveFixture(t);
  await save(join(f.nested, 'agent-duplicate.jsonl'),
    [user('Write src/other.js'), write('w', 'src/other.js', 'x')]
      .map(r => ({ cwd: '/repo', sessionId: f.sid, agentId: AGENT_A, isSidechain: true, ...r })));
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children, undefined);
  assert.equal(ledger.delegations[0].reason, 'child_link_ambiguous');
});

test('B2: a child recording naming another parent session is not this session\'s child', async t => {
  const f = await liveFixture(t);
  await f.saveChild(AGENT_A, [user('Write src/0123.js'), write('w', 'src/0123.js', 'x')]
    .map(r => ({ ...r, sessionId: 'a-different-parent-session' })));
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children, undefined);
  assert.equal(ledger.delegations[0].reason, 'child_link_unavailable');
});

test('84 children load, and a caller resource ceiling is declared', async t => {
  const agents = Array.from({ length: 84 }, (_, i) => i.toString(16).padStart(16, '0'));
  const f = await liveFixture(t, { agents });
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children.length, 84);
  assert.equal(ledger.delegations.filter(d => d.status === 'linked').length, 84);
  const limited = await loadSessionEvidence([f.root], { ...f.options, childLimits: { children: 32 } });
  assert.equal(limited.children.length, 32);
  const last = limited.delegations.at(-1);
  assert.equal(last.status, 'unresolved');
  assert.equal(last.reason, 'child_recording_limit');
});

test('Claude child actions link separately; child instructions never become human authority', async t => {
  const f = await fixture(t);
  const raw = await sliceLineage([f.root]);
  const root = await loadSessionEvidence([f.root], f.options);
  assert.deepEqual(root.ask, redact(raw).ledger.ask);
  // M33 P: a ledger that links a helper records its Claude actions' rows (C-03 "M33 P helper placement"); nothing else
  // of an action moves.
  assert.deepEqual(root.ledger.map(({ sourceLocator, ...act }) => act), redact(raw).ledger.ledger);
  assert.deepEqual(root.ledger.map((act) => act.sourceLocator), [{ stream: 0, record: 2, part: 0 }]);
  assert.deepEqual(root.claim, redact(raw).ledger.claim);
  assert.equal(root.delegations[0].status, 'linked');
  assert.deepEqual(root.delegations[0].parentInstruction,
    { text: 'private child brief', tool: 'Task', field: 'prompt' });
  assert.deepEqual(root.children[0].parentInstructions.map(d => [d.callId, d.source, d.record]),
    [['spawn-1', 0, 3]]);
  assert.equal(root.children.length, 1);
  const child = root.children[0].ledger;
  assert.deepEqual(child.ask, []);
  assert.equal(child.instructions[0].origin, 'agent-or-inherited');
  assert.equal(child.ledger[0].path, 'src/child.js');
  assert.equal(hasCaptureGaps(root), true);
});

test('linked changes and retained parent briefs participate in the parent hash', async t => {
  const f = await fixture(t);
  const first = await loadSessionEvidence([f.root], f.options);
  const before = sliceHash(first);
  await f.saveChild([...f.work, write('second-write', 'src/child.js', 'const attempts = 5;')]);
  const next = await loadSessionEvidence([f.root], f.options);
  assert.notEqual(sliceHash(next), before);
  assert.equal(sliceHash(redact(next).ledger), sliceHash(next));
  await rm(f.child);
  const missing = await loadSessionEvidence([f.root], f.options);
  assert.equal(missing.children, undefined);
  assert.equal(missing.delegations[0].status, 'unresolved');
  assert.notEqual(sliceHash(missing), before);
  assert.equal(sliceHash(missing), sliceHash(redact(await sliceLineage([f.root])).ledger));
  const changedBrief = structuredClone(missing);
  changedBrief.delegations[0].parentInstruction.text = 'a different redacted-safe brief';
  assert.notEqual(sliceHash(changedBrief), sliceHash(missing));
});

test('wrong, duplicate, conflicting and redacted source identities cannot link', async t => {
  const f = await fixture(t);
  await f.saveChild(f.work.map(r => ({ ...r, agentId: 'other' })));
  assert.equal((await loadSessionEvidence([f.root], f.options)).children, undefined);
  await f.saveChild(f.work);
  const duplicate = join(f.nested, 'duplicate.jsonl');
  await save(duplicate, f.work.map(r => ({ cwd: '/repo', sessionId: 'root', agentId: 'child-1', isSidechain: true, ...r })));
  assert.equal((await loadSessionEvidence([f.root], f.options)).delegations[0].reason, 'child_link_ambiguous');
  await rm(duplicate);
  await f.saveChild([...f.work, { ...user('later'), agentId: 'different' }]);
  assert.equal((await loadSessionEvidence([f.root], f.options)).delegations[0].reason, 'child_link_source_conflict');
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  await f.saveChild(f.work.map(r => ({ ...r, agentId: secret })));
  const cleaned = await loadSessionEvidence([f.root], f.options);
  assert.equal(cleaned.children, undefined);
  assert.equal(JSON.stringify(cleaned).includes(secret), false);
});

test('D90: child text is kept as recorded, and hashed as recorded', async t => {
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  const f = await fixture(t, { childRows: [user('use ' + secret), write('child-write', 'src/child.js', secret)] });
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children.length, 1);
  assert.ok(JSON.stringify(ledger.children[0].ledger).includes(secret));
  assert.equal(typeof sliceHash(ledger), 'string');
});

test('copies outside a verified store and failed spawns never acquire child links', async t => {
  const f = await fixture(t, { rootRows: [user('Review.'), call('failed', 'Task', {}), result('failed', {}, true)] });
  const failed = await loadSessionEvidence([f.root], f.options);
  assert.equal(failed.delegations[0].status, 'failed');
  assert.equal(hasCaptureGaps(failed), false);
  const outside = await loadSessionEvidence([f.root]);
  assert.equal(outside.children, undefined);
});

test('nested child handoffs link recursively and cycles remain unresolved', async t => {
  const f = await fixture(t, { childRows: [user('Do child work.'), write('w', 'child.js', 'one'), ...spawn('nested', 'child-2')] });
  await save(join(f.nested, 'second.jsonl'), [user('Do grandchild work.'), write('w2', 'grandchild.js', 'two'), ...spawn('back', 'child-1')]
    .map(r => ({ cwd: '/repo', sessionId: 'root', agentId: 'child-2', isSidechain: true, ...r })));
  const ledger = await loadSessionEvidence([f.root], f.options);
  const nested = ledger.children[0].ledger.children[0].ledger;
  assert.equal(nested.ledger[0].path, 'grandchild.js');
  assert.equal(nested.delegations[0].reason, 'child_recording_cycle');
  assert.deepEqual(nested.ask, []);
});

test('Claude inherited main records cannot become child actions; a recording is classified by its rows, never its path', async t => {
  const f = await fixture(t);
  const inherited = [user('Inherited human instruction.'), write('inherited', 'parent.js', 'parent')]
    .map(r => ({ cwd: '/repo', sessionId: 'root', ...r }));
  const child = f.work.map(r => ({ cwd: '/repo', sessionId: 'root', agentId: 'child-1', isSidechain: true, ...r }));
  await save(f.child, [...inherited, ...child]);
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.children, undefined);
  const isolated = await sliceLineage([f.child], { includeSources: true, sidechainAsMain: true, childRecording: true });
  assert.equal(isolated.ledger.length, 0);
  assert.ok(isolated.capture.reasons.includes('child_history_unchecked'));
  const direct = await loadSessionEvidence([f.child], f.options);
  assert.equal(direct.instructionAuthority, 'unchecked');
  assert.equal(direct.ledger.length, 0);
  assert.deepEqual(direct.ask, []);
  assert.equal(hasCaptureGaps(direct), true);
  // M34 labels (C-02 "Slice-time labels"): the same rows saved where a root recording lies are the same recording — a
  // helper's own rows beside unmarked ones — so they are read the same way (fail closed), never promoted by the path.
  await save(f.root, [...inherited, ...child]);
  const mixedRoot = await loadSessionEvidence([f.root], f.options);
  assert.equal(mixedRoot.instructionAuthority, 'unchecked');
  assert.equal(mixedRoot.ledger.length, 0);
  assert.deepEqual(mixedRoot.ask, []);
  // A root recording whose rows all record `isSidechain: false` is never a helper's, whatever directory it is in.
  await save(f.child, inherited.map(r => ({ ...r, isSidechain: false })));
  const rootInHelperDir = await loadSessionEvidence([f.child], f.options);
  assert.equal(rootInHelperDir.instructionAuthority, undefined);
  assert.deepEqual(rootInHelperDir.ledger.map(e => e.path), ['parent.js']);
  // M34 labels review (F7): a main recording whose own rows record `isSidechain: false` and which holds inline sidechain
  // rows (an older recorder's shape) is the root's by its rows: reviewed as main, its sidechain rows dropped by the
  // reader — never withheld whole as a helper's.
  await save(f.root, [...inherited.map(r => ({ ...r, isSidechain: false })), ...child]);
  const inlineSidechains = await loadSessionEvidence([f.root], f.options);
  assert.equal(inlineSidechains.instructionAuthority, undefined);
  assert.deepEqual(inlineSidechains.ledger.map(e => e.path), ['parent.js']);
  assert.equal(inlineSidechains.lineage.role, undefined);
});

test('a child switched to a symlink after indexing is refused before parsing', async t => {
  const f = await fixture(t);
  const context = evidenceContext();
  await loadSessionEvidence([f.root], { ...f.options, context });
  const outside = join(f.dir, 'outside.jsonl');
  await save(outside, f.work.map(r => ({ sessionId: 'root', agentId: 'child-1', isSidechain: true, ...r })));
  await rm(f.child); await symlink(outside, f.child);
  const ledger = await loadSessionEvidence([f.root], { ...f.options, context });
  assert.equal(ledger.children, undefined);
  assert.equal(ledger.delegations[0].reason, 'child_inventory_incomplete');
});

test('a changed candidate cannot consume a valid sibling through its unverified descendants', async t => {
  const f = await fixture(t, { rootRows: [user('Review.'), ...spawn('one', 'child-1'), ...spawn('two', 'child-2')] });
  await save(join(f.nested, 'second.jsonl'), [user('Second brief.'), write('w2', 'second.js', 'two')]
    .map(r => ({ cwd: '/repo', sessionId: 'root', agentId: 'child-2', isSidechain: true, ...r })));
  const context = evidenceContext();
  assert.equal((await loadSessionEvidence([f.root], { ...f.options, context })).children.length, 2);
  await f.saveChild([...f.work, ...spawn('nested', 'child-2')].map(r => ({ ...r, agentId: 'different' })));
  const ledger = await loadSessionEvidence([f.root], { ...f.options, context });
  assert.deepEqual(ledger.delegations.map(d => d.status), ['unresolved', 'linked']);
  assert.equal(ledger.delegations[0].reason, 'child_recording_changed');
  assert.equal(ledger.children[0].ledger.ledger[0].path, 'second.js');
});

const response = payload => ({ type: 'response_item', payload });
async function codexFixture(t, boundary = 4) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah codex children ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'rollout-2026-09-11T12-00-00-root.jsonl');
  const child = join(dir, 'rollout-2026-09-11T12-00-01-child.jsonl');
  await save(root, [{ type: 'session_meta', payload: { id: 'root', cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Review.' }),
    response({ type: 'function_call', name: 'spawn_agent', call_id: 's', arguments: '{}' }),
    response({ type: 'function_call_output', call_id: 's', output: '{"agent_id":"child"}' })]);
  const patch = path => ({ type: 'custom_tool_call', name: 'apply_patch', call_id: path,
    input: '*** Begin Patch\n*** Add File: ' + path + '\n+const attempts = 3;\n*** End Patch' });
  const rows = [{ type: 'session_meta', payload: { id: 'child', cwd: '/repo', source: { subagent: { thread_spawn: { parent_thread_id: 'root' } } },
    ...(boundary == null ? {} : { subagent_history_start_ordinal: boundary }) } },
    response({ type: 'message', role: 'user', content: 'Inherited human instruction.' }), response(patch('inherited.js')),
    response({ type: 'custom_tool_call_output', call_id: 'inherited.js', output: 'Done.' }),
    response({ type: 'message', role: 'user', content: 'Agent brief.' }), response(patch('child.js')),
    response({ type: 'custom_tool_call_output', call_id: 'child.js', output: 'Done.' })]
    .map((r, ordinal) => ({ ordinal, ...r }));
  await save(child, rows);
  return { root, child, rows, options: { recordingRoots: { codex: dir } } };
}

test('Codex ordinal boundary excludes inherited actions; child instruction stays separate', async t => {
  const f = await codexFixture(t);
  const ledger = await loadSessionEvidence([f.root], f.options);
  assert.equal(ledger.delegations[0].status, 'linked');
  const child = ledger.children[0].ledger;
  assert.deepEqual(child.ledger.map(e => e.path), ['child.js']);
  assert.deepEqual(child.instructions.map(a => a.text), ['Agent brief.']);
  assert.deepEqual(child.ask, []);
  const direct = await loadSessionEvidence([f.child], f.options);
  assert.deepEqual(direct.ask, []);
  assert.deepEqual(direct.ledger.map(e => e.path), ['child.js']);
  assert.equal(hasCaptureGaps(direct), true);
});

test('Codex missing, malformed and nonmonotonic history boundaries withhold child actions', async t => {
  for (const boundary of [null, -1, 4]) {
    const f = await codexFixture(t, boundary);
    if (boundary === 4) { f.rows[5].ordinal = 2; await save(f.child, f.rows); }
    const ledger = await loadSessionEvidence([f.root], f.options);
    if (boundary === -1) assert.equal(ledger.children, undefined);
    else {
      const child = ledger.children[0].ledger;
      assert.equal(child.ledger.length, 0);
      assert.ok(child.capture.reasons.includes('child_history_unchecked'));
    }
  }
});

test('a missing ordinal inside new child work stays unchecked rather than silently losing actions', async t => {
  const f = await codexFixture(t);
  f.rows[5].ordinal = 6; f.rows[6].ordinal = 7;
  await save(f.child, f.rows);
  const ledger = await loadSessionEvidence([f.root], f.options);
  const child = ledger.children[0].ledger;
  assert.equal(child.ledger.length, 0);
  assert.ok(child.capture.reasons.includes('child_history_unchecked'));
});

test('repeated metadata cannot conceal a gap in the child action ordinals', async t => {
  const f = await codexFixture(t);
  f.rows.splice(5, 0, { ...f.rows[0], ordinal: 6 });
  f.rows[6].ordinal = 7; f.rows[7].ordinal = 8;
  await save(f.child, f.rows);
  const child = (await loadSessionEvidence([f.root], f.options)).children[0].ledger;
  assert.equal(child.ledger.length, 0);
  assert.ok(child.capture.reasons.includes('child_history_unchecked'));
});

async function codexNoForkFixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah codex no-fork ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'rollout-2026-09-23T12-00-00-root.jsonl');
  const child = join(dir, 'rollout-2026-09-23T12-00-01-child.jsonl');
  const rootRows = [
    { type: 'session_meta', payload: { id: 'root', cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Review the change.' }),
    response({ type: 'function_call', name: 'collaboration.spawn_agent', call_id: 'spawn-1',
      arguments: JSON.stringify({ task_name: 'worker', message: 'Write child.js', fork_turns: 'none' }) }),
    response({ type: 'function_call_output', call_id: 'spawn-1',
      output: JSON.stringify({ task_name: '/root/worker' }) }),
  ];
  const childRows = [
    { type: 'session_meta', payload: { id: 'child', cwd: '/repo', multi_agent_version: 'v2',
      source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/worker' } } } } },
    response({ type: 'message', role: 'user', content: 'Agent brief.' }),
    response({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'edit-child',
      input: '*** Begin Patch\n*** Add File: child.js\n+const checked = true;\n*** End Patch' }),
    response({ type: 'custom_tool_call_output', call_id: 'edit-child', output: 'Done.' }),
  ].map((row, ordinal) => ({ ordinal, ...row }));
  const saveRoot = rows => save(root, rows);
  const saveChild = rows => save(child, rows);
  await saveRoot(rootRows);
  await saveChild(childRows);
  return { root, child, rootRows, childRows, saveRoot, saveChild,
    options: { recordingRoots: { codex: dir } } };
}

test('V2 no-history Codex spawn proves child-owned zero boundary only through the linked parent', async t => {
  const f = await codexNoForkFixture(t);
  const root = await loadSessionEvidence([f.root], f.options);
  assert.equal(root.delegations[0].status, 'linked');
  assert.equal(root.delegations[0].forkTurns, 'none');
  assert.deepEqual(root.children[0].ledger.ledger.map(event => event.path), ['child.js']);
  assert.deepEqual(root.children[0].ledger.instructions.map(item => item.text), ['Agent brief.']);
  assert.deepEqual(root.children[0].ledger.ask, []);
  assert.equal(root.children[0].ledger.capture.reasons.includes('child_history_unchecked'), false);
  const direct = await loadSessionEvidence([f.child], f.options);
  assert.deepEqual(direct.ledger, [], 'child metadata by itself cannot prove the parent spawn');
  assert.ok(direct.capture.reasons.includes('child_history_unchecked'));
});

test('D90: an opaque native call ID is kept as recorded, with a verified Codex child tuple and no-fork boundary', async t => {
  const f = await codexNoForkFixture(t);
  const opaque = 'call_' + createHash('sha256').update('synthetic opaque ID 32')
    .digest('base64url').replace(/[-_]/g, 'A').slice(0, 24);
  const rows = structuredClone(f.rootRows);
  rows[2].payload.call_id = opaque;
  rows[3].payload.call_id = opaque;
  await f.saveRoot(rows);
  const root = await loadSessionEvidence([f.root], { ...f.options, reviewLinkedChildren: true });
  assert.equal(root.delegations[0].status, 'linked');
  assert.equal(root.delegations[0].callId, opaque);
  assert.equal(root.delegations[0].identityUncheckedFields, undefined);
  assert.deepEqual(root.children[0].ledger.ledger.map(event => event.path), ['child.js']);
});

test('no-fork proof fails closed for default spawn, missing result, and explicit spawn failure', async t => {
  for (const change of ['default-fork', 'missing-result', 'failed-result']) {
    const f = await codexNoForkFixture(t);
    const rows = structuredClone(f.rootRows);
    if (change === 'default-fork') {
      rows[2].payload.arguments = JSON.stringify({ task_name: 'worker', message: 'Write child.js' });
    } else if (change === 'missing-result') rows.pop();
    else rows[3].payload.output = JSON.stringify({ is_error: true, agent_id: 'child', task_name: '/root/worker' });
    await f.saveRoot(rows);
    const root = await loadSessionEvidence([f.root], f.options);
    if (change === 'default-fork') {
      assert.equal(root.delegations[0].status, 'linked');
      assert.deepEqual(root.children[0].ledger.ledger, []);
      assert.ok(root.children[0].ledger.capture.reasons.includes('child_history_unchecked'));
    } else {
      assert.equal(root.children, undefined);
      assert.notEqual(root.delegations[0].status, 'linked');
    }
  }
});

test('no-fork proof rejects missing version, inherited base, and parent or task mismatch', async t => {
  for (const change of ['version', 'history-base', 'forked-from', 'parent', 'task']) {
    const f = await codexNoForkFixture(t);
    const rows = structuredClone(f.childRows);
    const meta = rows[0].payload;
    if (change === 'version') delete meta.multi_agent_version;
    if (change === 'history-base') meta.history_base = { segment: 1 };
    if (change === 'forked-from') meta.forked_from_id = 'root';
    if (change === 'parent') meta.source.subagent.thread_spawn.parent_thread_id = 'other';
    if (change === 'task') meta.source.subagent.thread_spawn.agent_path = '/root/other';
    await f.saveChild(rows);
    const root = await loadSessionEvidence([f.root], f.options);
    if (change === 'parent' || change === 'task') {
      assert.equal(root.children, undefined, change);
      assert.notEqual(root.delegations[0].status, 'linked', change);
    } else {
      assert.equal(root.delegations[0].status, 'linked', change);
      assert.deepEqual(root.children[0].ledger.ledger, [], change);
      assert.ok(root.children[0].ledger.capture.reasons.includes('child_history_unchecked'), change);
    }
  }
});

test('untrusted Codex version metadata is closed before it can reach redacted evidence', async t => {
  const f = await codexNoForkFixture(t);
  const rows = structuredClone(f.childRows);
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  rows[0].payload.multi_agent_version = secret;
  await f.saveChild(rows);
  const root = await loadSessionEvidence([f.root], f.options);
  assert.equal(root.delegations[0].status, 'linked');
  assert.deepEqual(root.children[0].ledger.ledger, []);
  assert.ok(root.children[0].ledger.capture.reasons.includes('child_history_unchecked'));
  assert.equal(root.children[0].ledger.sources[0].multiAgentVersion, 'other');
  assert.equal(JSON.stringify(root).includes(secret), false);
});

test('no-fork proof requires metadata at ordinal zero and contiguous source rows', async t => {
  for (const change of ['start-one', 'gap', 'missing-meta-ordinal', 'corrupt-row']) {
    const f = await codexNoForkFixture(t);
    const rows = structuredClone(f.childRows);
    if (change === 'start-one') rows.forEach(row => { row.ordinal += 1; });
    if (change === 'gap') rows.slice(2).forEach(row => { row.ordinal += 1; });
    if (change === 'missing-meta-ordinal') delete rows[0].ordinal;
    if (change === 'corrupt-row') await writeFile(f.child,
      rows.map(JSON.stringify).join('\n') + '\n{"broken":\n');
    else await f.saveChild(rows);
    const root = await loadSessionEvidence([f.root], f.options);
    if (change === 'corrupt-row') {
      assert.equal(root.children, undefined, 'corrupt inventory must not link');
    } else {
      assert.equal(root.delegations[0].status, 'linked', change);
      assert.deepEqual(root.children[0].ledger.ledger, [], change);
      assert.ok(root.children[0].ledger.capture.reasons.includes('child_history_unchecked'), change);
    }
  }
});

async function taskNameFixture(t, { parentPath = '/root', target = 'worker' } = {}) {
  const f = await codexFixture(t);
  const call = (name, id, input) => response({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(input) });
  const output = (id, value) => response({ type: 'function_call_output', call_id: id, output: JSON.stringify(value) });
  await save(f.root, [{ type: 'session_meta', payload: { id: 'root', cwd: '/repo', ...(parentPath ? { agent_path: parentPath } : {}) } },
    response({ type: 'message', role: 'user', content: 'Review the root.' }),
    call('collaboration.spawn_agent', 's', { task_name: 'worker', message: 'Agent task.' }),
    output('s', { task_name: '/root/worker' }),
    call('collaboration.followup_task', 'f1', { target, message: 'More work.' }), output('f1', {}),
    call('collaboration.followup_task', 'f2', { target: '/root/worker', message: 'More work again.' }), output('f2', {})]);
  f.rows[0].payload.source.subagent.thread_spawn.agent_path = '/root/worker';
  await save(f.child, f.rows);
  return f;
}

test('exact task references link once and verified follow-ups retain separate handoff edges', async t => {
  const f = await taskNameFixture(t);
  const root = await loadSessionEvidence([f.root], f.options);
  assert.equal(root.children.length, 1);
  assert.deepEqual(root.delegations.map(d => [d.status, d.link?.source]), [['linked', 0], ['linked', 0], ['linked', 0]]);
  assert.equal(new Set(root.delegations.map(d => d.record)).size, 3);
  assert.deepEqual(root.delegations.map(d => [d.kind, d.parentInstruction.text, d.parentInstruction.tool,
    d.parentInstruction.field]), [
    ['spawn', 'Agent task.', 'collaboration.spawn_agent', 'message'],
    ['followup', 'More work.', 'collaboration.followup_task', 'message'],
    ['followup', 'More work again.', 'collaboration.followup_task', 'message'],
  ]);
  assert.deepEqual(root.children[0].parentInstructions.map(d => d.callId), ['s', 'f1', 'f2']);
  const beforeFollowupChange = sliceHash(root);
  const changedFollowup = structuredClone(root);
  changedFollowup.delegations[1].parentInstruction.text = 'Different follow-up work.';
  changedFollowup.children[0].parentInstructions[1].parentInstruction.text = 'Different follow-up work.';
  assert.notEqual(sliceHash(changedFollowup), beforeFollowupChange);
  assert.deepEqual(root.children[0].ledger.ledger.map(e => e.path), ['child.js']);
  assert.deepEqual(root.ask.map(a => a.text), ['Review the root.']);
  assert.equal(root.ledger.length, 0);
  assert.equal(hasCaptureGaps(root), true);
});

test('a verified Codex root without a task path reuses its direct child for relative follow-ups', async t => {
  const f = await taskNameFixture(t, { parentPath: null });
  const root = await loadSessionEvidence([f.root], f.options);
  assert.deepEqual(root.delegations.map(d => [d.status, d.link?.source]),
    [['linked', 0], ['linked', 0], ['linked', 0]]);
  assert.equal(root.children.length, 1);
  assert.deepEqual(root.children[0].parentInstructions.map(d => d.callId), ['s', 'f1', 'f2']);
});

test('task linkage rejects changed parent metadata and unknown follow-up targets', async t => {
  const f = await taskNameFixture(t, { target: 'other' });
  const root = await loadSessionEvidence([f.root], f.options);
  assert.deepEqual(root.delegations.map(d => d.status), ['linked', 'unresolved', 'linked']);
  f.rows[0].payload.source.subagent.thread_spawn.parent_thread_id = 'different';
  await save(f.child, f.rows);
  const missing = await loadSessionEvidence([f.root], f.options);
  assert.equal(missing.children, undefined);
  assert.ok(missing.delegations.every(d => d.status === 'unresolved'));
});

test('D90: new protocol source and descriptor identities are carried as recorded to matching and hashing', () => {
  const secret = 'sk-ant-api03-' + 'A'.repeat(80);
  const unit = { ask: [], ledger: [], claim: {}, dropped: [],
    sources: [{ parentThreadId: secret, taskPath: '/root/' + secret }],
    delegations: [{ taskName: '/root/' + secret, target: secret, turn: 1 }] };
  const cleaned = redact(unit).ledger;
  assert.equal(cleaned.sources[0].taskPath, '/root/' + secret);
  assert.equal(cleaned.delegations[0].taskName, '/root/' + secret);
  assert.equal(cleaned.delegations[0].target, secret);
  assert.notEqual(cleaned.delegations[0].identityUnchecked, true);
});

test('malformed lines cannot conceal a conflicting identity during indexing or a later read', async t => {
  const f = await fixture(t);
  const context = evidenceContext();
  assert.equal((await loadSessionEvidence([f.root], { ...f.options, context })).children.length, 1);
  await save(f.child, f.work.map(r => ({ sessionId: 'root', agentId: 'child-1', isSidechain: true, ...r })));
  const { appendFile } = await import('node:fs/promises');
  await appendFile(f.child, '{"agentId":\n');
  const indexed = await loadSessionEvidence([f.root], f.options);
  assert.equal(indexed.children, undefined);
  assert.equal(indexed.delegations[0].reason, 'child_inventory_incomplete');
  const stale = await loadSessionEvidence([f.root], { ...f.options, context });
  assert.equal(stale.children, undefined);
  assert.equal(stale.delegations[0].reason, 'child_inventory_incomplete');
});

const largePayload = () => (JSON.stringify({ type: 'event_msg', payload: { text: 'x'.repeat(100_000) } }) + '\n').repeat(81);

test('a large unrelated source no longer blocks a small child with verified identity', async t => {
  const f = await codexFixture(t);
  const namespace = f.options.recordingRoots.codex;
  const other = join(namespace, 'rollout-2026-09-11T11-00-00-other.jsonl');
  await writeFile(other, JSON.stringify({ type: 'session_meta', payload: { id: 'other' } }) + '\n' + largePayload());
  const context = evidenceContext();
  const root = await loadSessionEvidence([f.root], { ...f.options, context });
  const before = redact(await sliceLineage([f.root])).ledger;
  assert.deepEqual(root.ask, before.ask);
  assert.deepEqual(root.ledger, before.ledger);
  assert.deepEqual(root.claim, before.claim);
  assert.equal(root.delegations[0].status, 'linked');
  assert.equal(root.children.length, 1);
  assert.deepEqual(root.children[0].ledger.ledger.map(e => e.path), ['child.js']);
  assert.deepEqual(root.children[0].ledger.ask, []);
  assert.equal(hasCaptureGaps(root), true);
  const [index] = await Promise.all(context.inventories.values());
  assert.equal(index.incomplete, false);
  assert.equal(index.stats.verifiedFiles, 3);
  assert.ok(index.stats.bytesRead > 8_000_000);
});

test('conflicts and malformed tails beyond the old byte ceiling still block a convenient child', async t => {
  const f = await codexFixture(t);
  const other = join(f.options.recordingRoots.codex, 'rollout-2026-09-11T11-00-00-other.jsonl');
  const prefix = JSON.stringify({ type: 'session_meta', payload: { id: 'other' } }) + '\n' + largePayload();
  for (const [tail, reason] of [
    [JSON.stringify({ type: 'session_meta', payload: { id: 'child' } }), 'child_link_source_conflict'],
    ['{"broken":', 'child_inventory_incomplete'],
  ]) {
    await writeFile(other, prefix + tail);
    const root = await loadSessionEvidence([f.root], f.options);
    assert.equal(root.children, undefined);
    assert.equal(root.delegations[0].reason, reason);
    assert.equal(hasCaptureGaps(root), true);
  }
});

test('large child actions use an immutable spool; a lowered action limit remains explicit', async t => {
  const f = await codexFixture(t);
  await appendFile(f.child, largePayload());
  const context = evidenceContext();
  const root = await loadSessionEvidence([f.root], { ...f.options, context });
  const [index] = await Promise.all(context.inventories.values());
  assert.equal(index.incomplete, false);
  assert.equal(index.stats.verifiedFiles, 2);
  assert.equal(root.delegations[0].status, 'linked');
  assert.equal(root.children.length, 1);
  const limited = await loadSessionEvidence([f.root], { ...f.options, childLimits: { actionBytes: 8_000_000 } });
  assert.equal(limited.children, undefined);
  assert.equal(limited.delegations[0].reason, 'child_recording_limit');
  assert.equal(hasCaptureGaps(limited), true);
});

test('a source with no recorded identity cannot be ignored to make another child unique', async t => {
  for (const create of [fixture, codexFixture]) {
    const f = await create(t);
    const file = f.nested ? join(f.nested, 'empty.jsonl')
      : join(f.options.recordingRoots.codex, 'rollout-2026-09-11T11-00-00-empty.jsonl');
    await writeFile(file, '{}\n');
    const root = await loadSessionEvidence([f.root], f.options);
    assert.equal(root.children, undefined);
    assert.equal(root.delegations[0].reason, 'child_inventory_incomplete');
    assert.equal(hasCaptureGaps(root), true);
  }
});

// ---------- M33 conflicting sources and nested-fork ancestor metadata (C-03) ----------
const spawnRows = (id, childId) => [response({ type: 'function_call', name: 'spawn_agent', call_id: id, arguments: '{}' }),
  response({ type: 'function_call_output', call_id: id, output: JSON.stringify({ agent_id: childId }) })];
const m33Patch = path => response({ type: 'custom_tool_call', name: 'apply_patch', call_id: path,
  input: '*** Begin Patch\n*** Add File: ' + path + '\n+const x = 1;\n*** End Patch' });
const m33PatchOut = path => response({ type: 'custom_tool_call_output', call_id: path, output: 'Done.' });

test('M33 A10 an unrelated conflicting rollout no longer withholds the child; a related one does', async t => {
  const f = await codexFixture(t);
  const other = join(f.options.recordingRoots.codex, 'rollout-2026-09-11T11-00-00-other.jsonl');
  await save(other, [{ type: 'session_meta', payload: { id: 'stranger-a' } }, { type: 'session_meta', payload: { id: 'stranger-b' } }]);
  const linked = await loadSessionEvidence([f.root], f.options);
  assert.equal(linked.delegations[0].status, 'linked');
  assert.deepEqual(linked.children[0].ledger.ledger.map(e => e.path), ['child.js']);
  for (const value of ['stranger-a', 'stranger-b']) assert.equal(JSON.stringify(linked).includes(value), false);
  // The same conflict could be this child: it names the child's ID.
  await save(other, [{ type: 'session_meta', payload: { id: 'stranger-a' } }, { type: 'session_meta', payload: { id: 'child' } }]);
  const blocked = await loadSessionEvidence([f.root], f.options);
  assert.equal(blocked.children, undefined);
  assert.equal(blocked.delegations[0].reason, 'child_link_source_conflict');
  // A malformed identity still blocks every link in the namespace.
  await save(other, [{ type: 'session_meta', payload: { id: 'stranger-a', agent_path: 'x'.repeat(201) } }]);
  assert.equal((await loadSessionEvidence([f.root], f.options)).delegations[0].reason, 'child_link_source_conflict');
  // D90 (owner decision 2026-10-15): a key-shaped candidate value is a value like any other (an identity scan once hid
  // it, and a hidden value blocked as if it could be anything): one that is not the child's blocks nothing.
  const keyShaped = 'sk-ant-api03-' + 'C'.repeat(80);
  await save(other, [{ type: 'session_meta', payload: { id: 'stranger-a' } }, { type: 'session_meta', payload: { id: keyShaped } }]);
  assert.equal((await loadSessionEvidence([f.root], f.options)).delegations[0].status, 'linked');
});

test('M33 A10 Claude: an unrelated conflicting agent recording no longer withholds the child', async t => {
  const f = await fixture(t);
  const other = join(f.nested, 'agent-other.jsonl');
  const otherRows = agents => agents.map(agentId => ({ ...user('other work'), cwd: '/repo', sessionId: 'root', agentId,
    isSidechain: true }));
  await save(other, otherRows(['other-1', 'other-2']));
  const linked = await loadSessionEvidence([f.root], f.options);
  assert.equal(linked.delegations[0].status, 'linked');
  assert.equal(linked.children.length, 1);
  await save(other, otherRows(['other-1', 'child-1']));
  const blocked = await loadSessionEvidence([f.root], f.options);
  assert.equal(blocked.children, undefined);
  assert.equal(blocked.delegations[0].reason, 'child_link_source_conflict');
});

test('M33 B4 root -> middle -> nested fork leaf all link by exact recorded identity', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah codex nested fork ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'rollout-2026-09-12T12-00-00-root.jsonl');
  const middle = join(dir, 'rollout-2026-09-12T12-00-01-middle.jsonl');
  const leaf = join(dir, 'rollout-2026-09-12T12-00-02-leaf.jsonl');
  await save(root, [{ type: 'session_meta', payload: { id: 'root', cwd: '/repo' } },
    response({ type: 'message', role: 'user', content: 'Review.' }), ...spawnRows('s-root', 'middle')]);
  const middleMeta = { type: 'session_meta', payload: { id: 'middle', cwd: '/repo', forked_from_id: 'root',
    subagent_history_start_ordinal: 1, multi_agent_version: 'v2', parent_thread_id: 'root', agent_path: '/root/middle',
    source: { subagent: { thread_spawn: { parent_thread_id: 'root', agent_path: '/root/middle' } } } } };
  const middleRows = [middleMeta, response({ type: 'message', role: 'user', content: 'Middle brief.' }),
    m33Patch('middle.js'), m33PatchOut('middle.js'), ...spawnRows('s-mid', 'leaf')]
    .map((r, ordinal) => ({ ...r, ordinal }));
  await save(middle, middleRows);
  const leafMeta = { type: 'session_meta', ordinal: 0, payload: { id: 'leaf', cwd: '/repo', forked_from_id: 'middle',
    subagent_history_start_ordinal: 7, multi_agent_version: 'v2', parent_thread_id: 'middle',
    agent_path: '/root/middle/leaf',
    source: { subagent: { thread_spawn: { parent_thread_id: 'middle', agent_path: '/root/middle/leaf' } } } } };
  const leafRows = [leafMeta, ...middleRows.map((r, i) => ({ ...r, ordinal: i + 1 })),
    { ordinal: 7, ...response({ type: 'message', role: 'user', content: 'Leaf brief.' }) },
    { ordinal: 8, ...m33Patch('leaf.js') }, { ordinal: 9, ...m33PatchOut('leaf.js') }];
  await save(leaf, leafRows);
  const out = await loadSessionEvidence([root], { recordingRoots: { codex: dir }, reviewLinkedChildren: true });
  assert.equal(out.delegations[0].status, 'linked', 'the root spawn links although a nested fork shares the namespace');
  const mid = out.children[0].ledger;
  assert.deepEqual(mid.ledger.filter(e => e.path).map(e => e.path), ['middle.js']);
  assert.equal(mid.delegations[0].status, 'linked');
  const grandchild = mid.children[0].ledger;
  assert.deepEqual(grandchild.ledger.filter(e => e.path).map(e => e.path), ['leaf.js'],
    'inherited middle actions are not new leaf work');
  assert.equal(grandchild.capture.reasons.includes('child_history_unchecked'), false);
  // Near miss: the replayed row at the boundary is a second own identity, so nothing links.
  await save(leaf, [leafMeta, ...leafRows.slice(1).map(r => r.type === 'session_meta' ? { ...r, ordinal: 7 } : r)]);
  const conflicted = await loadSessionEvidence([root], { recordingRoots: { codex: dir }, reviewLinkedChildren: true });
  assert.equal(conflicted.delegations[0].reason, 'child_link_source_conflict',
    'the conflicting leaf could be the root spawn target because it names the middle ID');
  assert.equal(conflicted.children, undefined);
});
