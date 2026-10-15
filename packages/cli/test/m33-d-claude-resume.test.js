// M33 D (C-03) end to end over a synthetic Claude Code project directory:
//   - a RESUMED parent (a prior-session block copied first, then the current block) links the
//     children its current block launched, by the sessionId recorded on each hand-off's own rows;
//     its file identity stays declared as conflicting;
//   - a forked hand-off whose child recording carries another session's id stays missing;
//   - a grandchild spawn inside a child recording (which writes no result sidecar) links through the
//     17-hex `agentId:` receipt line;
//   - Workflow agent recordings below `subagents/workflows/` are named by the inventory instead of
//     being skipped silently, without making the Agent-child inventory incomplete.
// Every recording here is synthetic, written to a temp directory. No real session is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { indexRecordings, RECORDING_INVENTORY_NOTES } from '../src/recording-inventory.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const PRIOR = '11111111-2222-4333-8444-555555555555';
const SID = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const FORK = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const CHILD = 'a0123456789abcdef', FORKED = 'afedcba9876543210', GRANDCHILD = 'a00000000000000aa';
const save = (file, rows) => writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
const base = (sessionId, extra) => ({ cwd: '/repo', sessionId, isSidechain: false, version: '2.1.222', ...extra });
const ask = (sessionId, text) => base(sessionId, { type: 'user', message: { role: 'user', content: text } });
const call = (sessionId, id, name, input, extra = {}) => base(sessionId, { type: 'assistant', ...extra,
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const answer = (sessionId, id, content, extra = {}) => base(sessionId, { type: 'user', ...extra,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const agentLaunch = (sessionId, id, agentId, { sidecar = true, extra = {} } = {}) => [
  call(sessionId, id, 'Agent', { description: 'child', prompt: 'Migrate the parser.' }, extra),
  answer(sessionId, id, `Async agent launched successfully.\nagentId: ${agentId} (internal ID)\nThe agent is working.`, {
    ...extra, ...(sidecar ? { toolUseResult: { agentId, canReadOutputFile: true, description: 'child', isAsync: true,
      outputFile: '/private/tmp/out', prompt: 'Migrate the parser.', resolvedModel: 'm', status: 'async_launched' } } : {}) })];
const childRow = (agentId) => (r) => ({ ...r, isSidechain: true, agentId });
const childWork = (sessionId, agentId, path) => [ask(sessionId, 'Migrate the parser.'),
  call(sessionId, 'child-write', 'Write', { file_path: `/repo/${path}`, content: 'export const v = 2;\n' }),
  answer(sessionId, 'child-write', `File created successfully at: /repo/${path}`,
    { toolUseResult: { type: 'create', filePath: `/repo/${path}`, content: 'export const v = 2;\n', originalFile: null,
      structuredPatch: [], userModified: false } })].map(childRow(agentId));

async function project(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah m33 d resume ')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects'), root = join(projects, '-Users-someone-repo');
  const nested = (session) => join(root, session, 'subagents');
  await mkdir(nested(SID), { recursive: true });
  await mkdir(nested(FORK), { recursive: true });
  return { projects, root, nested, options: { recordingRoots: { claude: projects }, reviewLinkedChildren: true } };
}

test('M33 D F6: a resumed parent links the children its current block launched, by their recorded session', async (t) => {
  const p = await project(t);
  const parent = join(p.root, `${SID}.jsonl`);
  await save(parent, [
    ask(PRIOR, 'Earlier: read the parser.'),                            // copied prior-session block
    base(PRIOR, { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Read it.' }] } }),
    { type: 'custom-title', customTitle: 'Resumed', sessionId: SID },   // the current block opens
    ask(SID, 'Now delegate the migration.'),
    ...agentLaunch(SID, 'spawn-1', CHILD),
    ...agentLaunch(SID, 'spawn-2', FORKED),
  ]);
  await save(join(p.nested(SID), `agent-${CHILD}.jsonl`), childWork(SID, CHILD, 'src/parser.js'));
  // A fork's child lives in another session's directory and records that session.
  await save(join(p.nested(FORK), `agent-${FORKED}.jsonl`), childWork(FORK, FORKED, 'src/other.js'));

  const ledger = await loadSessionEvidence([parent], p.options);
  assert.equal(ledger.sources[0].identityConflict, true, 'the file identity stays conflicting');
  const byChild = Object.fromEntries(ledger.delegations.map((d) => [d.childId, d]));
  assert.equal(byChild[CHILD].status, 'linked');
  assert.equal(byChild[CHILD].sessionId, SID);
  assert.equal(byChild[FORKED].status, 'unresolved');
  assert.equal(byChild[FORKED].reason, 'child_link_unavailable');
  assert.equal(ledger.children.length, 1);
  assert.deepEqual(ledger.children[0].ledger.ledger.map((e) => e.path), ['src/parser.js']);

  const session = sessionFromLedger(redact(ledger).ledger, { sessionKey: 'resumed' });
  const gaps = (channel, code) => session.adapterGaps.filter((g) => g.channel === channel && g.code === code);
  assert.equal(gaps('identity', 'incomplete_inventory').length, 1);
  assert.equal(gaps('children', 'missing_child').length, 1);
  assert.ok(!session.adapterGaps.some((g) => g.channel === 'children' && /could not be verified against a child/.test(g.note ?? '')));
});

test('M33 D F7: a grandchild spawned inside a child recording links through the 17-hex receipt line', async (t) => {
  const p = await project(t);
  const parent = join(p.root, `${SID}.jsonl`);
  await save(parent, [ask(SID, 'Delegate.'), ...agentLaunch(SID, 'spawn-1', CHILD)]);
  // Child recordings write no result sidecar: the visible line is the only identity carrier.
  await save(join(p.nested(SID), `agent-${CHILD}.jsonl`), [
    ...childWork(SID, CHILD, 'src/parser.js'),
    ...agentLaunch(SID, 'spawn-g', GRANDCHILD, { sidecar: false }).map(childRow(CHILD)),
  ]);
  await save(join(p.nested(SID), `agent-${GRANDCHILD}.jsonl`), childWork(SID, GRANDCHILD, 'src/grand.js'));

  const ledger = await loadSessionEvidence([parent], p.options);
  assert.equal(ledger.delegations[0].status, 'linked');
  const childLedger = ledger.children[0].ledger;
  assert.equal(childLedger.delegations[0].childId, GRANDCHILD);
  assert.equal(childLedger.delegations[0].status, 'linked');
  assert.deepEqual(childLedger.children[0].ledger.ledger.map((e) => e.path), ['src/grand.js']);
});

test('M33 D F8: workflow agent recordings are named by the inventory, and Agent children still link', async (t) => {
  const p = await project(t);
  const run = join(p.nested(SID), 'workflows', 'wrun0000000001');
  await mkdir(run, { recursive: true });
  await save(join(run, 'journal.jsonl'), [{ type: 'started', agentId: 'aeeeeeeeeeeeeeeee', key: 'k' }]);
  await save(join(run, 'agent-aeeeeeeeeeeeeeeee.jsonl'), childWork(SID, 'aeeeeeeeeeeeeeeee', 'src/wf.js'));
  await save(join(p.nested(SID), `agent-${CHILD}.jsonl`), childWork(SID, CHILD, 'src/parser.js'));

  const found = await indexRecordings(p.root, 'claude');
  assert.equal(found.incomplete, false);
  assert.equal(found.files.length, 1);
  assert.ok(found.stats.reasons.includes(RECORDING_INVENTORY_NOTES.WORKFLOW_RECORDINGS_UNINDEXED));
  assert.equal(found.stats.unindexedDirectories, 1);

  const parent = join(p.root, `${SID}.jsonl`);
  await save(parent, [ask(SID, 'Delegate.'), ...agentLaunch(SID, 'spawn-1', CHILD)]);
  const ledger = await loadSessionEvidence([parent], p.options);
  assert.equal(ledger.delegations[0].status, 'linked');
});

test('M33 D repair: a parent with an interleaved or third session is not the resumed shape and links nothing', async (t) => {
  const THIRD = 'cccccccc-dddd-4eee-8fff-000000000000';
  const shapes = [
    // A row of the prior session after the current block began.
    ['interleaved', [ask(PRIOR, 'Earlier: read the parser.'), { type: 'custom-title', customTitle: 'Resumed', sessionId: SID },
      ask(SID, 'Now delegate the migration.'), ...agentLaunch(SID, 'spawn-1', CHILD), ask(PRIOR, 'A prior row, late.')]],
    // Two copied blocks, then the current one.
    ['three sessions', [ask(THIRD, 'Much earlier.'), ask(PRIOR, 'Earlier: read the parser.'),
      { type: 'custom-title', customTitle: 'Resumed', sessionId: SID }, ask(SID, 'Now delegate the migration.'),
      ...agentLaunch(SID, 'spawn-1', CHILD)]],
  ];
  for (const [name, rows] of shapes) {
    const p = await project(t);
    const parent = join(p.root, `${SID}.jsonl`);
    await save(parent, rows);
    await save(join(p.nested(SID), `agent-${CHILD}.jsonl`), childWork(SID, CHILD, 'src/parser.js'));
    const ledger = await loadSessionEvidence([parent], p.options);
    assert.equal(ledger.sources[0].identityConflict, true, name);
    assert.equal(ledger.sources[0].sessionIdConflictOnly, undefined, name);
    const [delegation] = ledger.delegations;
    assert.deepEqual([delegation.childId, delegation.status, delegation.reason],
      [CHILD, 'unresolved', 'delegation_child_unchecked'], name);
    assert.equal((ledger.children ?? []).length, 0, name);
    const session = sessionFromLedger(redact(ledger).ledger, { sessionKey: 'not-resumed' });
    assert.ok(session.adapterGaps.some((g) => g.channel === 'identity' && g.code === 'incomplete_inventory'), name);
  }
});
