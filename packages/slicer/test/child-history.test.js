// F52: schema drift in a child recording declares a partial history, never an empty one.
//
// `childRecording` withheld a child's WHOLE history unless every record carried `isSidechain:true`
// and the child's `agentId`. One vendor schema drift — a record type that stops carrying agentId,
// say — silently emptied a linked child: zero actions, and nothing saying they had been dropped.
//
// The rule now separates two things that the old check collapsed:
//   drift          — a record carrying ONE of the child's two markers (its agentId, or
//                    isSidechain:true) but not both. It is child-origin with a damaged shape: it
//                    is dropped, the rest of the child survives, and the gap is declared
//                    (`capture.incomplete`, SLICE_REASONS.CHILD_HISTORY_PARTIAL).
//   mixed history  — a record carrying NEITHER marker, i.e. inherited main-thread history, or no
//                    single child identity at all. Provenance is unknown, so the whole history is
//                    still withheld as unchecked (pinned in cli/test/child-recordings.test.js).
//
// Every recording is synthetic and written to a temp directory. No real session is read.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sliceLineage, SLICE_REASONS, hasCaptureGaps } from '../index.js';
import { recordingIdentity } from '../src/recording-identity.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';

const CHILD = '0123456789abcdef';
const base = { cwd: '/repo', sessionId: 'root', agentId: CHILD, isSidechain: true };
const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const call = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const result = (id, content) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

/** A child's work, every record stamped as the child's unless `drift` rewrites one. */
function work(drift = {}) {
  const rows = [
    user('Write the queue module.'),
    call('w1', 'Write', { file_path: '/repo/src/queue.js', content: 'export const attempts = 3;\n' }),
    result('w1', 'File created successfully at: /repo/src/queue.js'),
    say('Checking the retry path next.'),
    call('e1', 'Edit', { file_path: '/repo/src/queue.js', old_string: 'attempts = 3', new_string: 'attempts = 5' }),
    result('e1', 'The file /repo/src/queue.js has been updated.'),
    say('Queue written with five attempts.'),
  ].map((r) => ({ ...base, ...r }));
  for (const [index, rewrite] of Object.entries(drift)) rows[index] = rewrite(rows[index]);
  return rows;
}
const without = (key) => (row) => { const { [key]: _, ...rest } = row; return rest; };

async function sliceChild(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-child-history-'));
  try {
    const file = join(dir, 'root', 'subagents', `agent-${CHILD}.jsonl`);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    return await sliceLineage([file], { includeSources: true, sidechainAsMain: true, childRecording: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const paths = (ledger) => ledger.ledger.map((e) => `${e.kind} ${e.path}`);

test('F52 a clean child keeps every record and declares nothing partial', async () => {
  const ledger = await sliceChild(work());
  assert.deepEqual(paths(ledger), ['create src/queue.js', 'edit src/queue.js']);
  assert.ok(!(ledger.capture?.reasons ?? []).includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
});

test('F52 one record that lost its agentId drops alone; the rest survive and the gap is declared', async () => {
  const ledger = await sliceChild(work({ 3: without('agentId') }));
  assert.deepEqual(paths(ledger), ['create src/queue.js', 'edit src/queue.js'], 'the other records survive');
  assert.equal(ledger.sayings.some((s) => s.text === 'Checking the retry path next.'), false, 'the drifted record is not kept');
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
  assert.ok(!ledger.capture.reasons.includes('child_history_unchecked'), 'partial, not unchecked');
  assert.ok(ledger.dropped.some((d) => d.reason === SLICE_REASONS.CHILD_HISTORY_PARTIAL), 'declared where drops are read');
  assert.equal(hasCaptureGaps(ledger), true, 'a partial child is a capture gap, never a clean one');
});

test('F52 one record that lost isSidechain but kept the child agentId is drift too', async () => {
  const ledger = await sliceChild(work({ 3: without('isSidechain') }));
  assert.deepEqual(paths(ledger), ['create src/queue.js', 'edit src/queue.js']);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
});

test('a partial child history retains the channel of an unsupported child row', async () => {
  const rows = work({ 3: without('agentId') });
  rows.splice(1, 0, { ...base, type: 'future_user_record',
    message: { role: 'user', content: 'Check the queue boundary too.' } });
  const ledger = await sliceChild(rows);
  assert.equal(ledger.capture.unsupportedRowChannels.instructions, 1);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
  assert.ok(sessionFromLedger(ledger).adapterGaps.some((gap) => gap.channel === 'instructions'
    && gap.code === 'unsupported_message'));
});

test('F52 a drifted tool result costs that result only, and the write it belonged to stays', async () => {
  const ledger = await sliceChild(work({ 2: without('agentId') }));
  const write = ledger.ledger.find((e) => e.kind === 'create');
  assert.ok(write, 'the write survives its drifted result');
  assert.equal(write.result, undefined, 'its result was not kept, so none is claimed');
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
});

const inherited = () => [user('Inherited human instruction.'),
  call('p1', 'Write', { file_path: '/repo/parent.js', content: 'parent' })].map((r) => ({ cwd: '/repo', sessionId: 'root', ...r }));

test('F52 inherited main-thread records still withhold the whole history as unchecked', async () => {
  const ledger = await sliceChild([...inherited(), ...work()]);
  assert.equal(ledger.ledger.length, 0);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_UNCHECKED));
  assert.ok(!ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
});

test('F52 a second agentId is a conflict, not drift, and still withholds', async () => {
  const ledger = await sliceChild(work({ 3: (row) => ({ ...row, agentId: 'fedcba9876543210' }) }));
  assert.equal(ledger.ledger.length, 0);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_UNCHECKED));
});

// ---- F111: one reason table -------------------------------------------------------------------
//
// Both reasons a child recording can declare about its own history are members of SLICE_REASONS,
// declared once there and read from there. The unchecked one was still a bare literal at the call
// site after F52, invisible to the table (F15).

test('F52 F111 both child-history reasons are declared members, never spelled at the call site (F15)', async () => {
  assert.equal(SLICE_REASONS.CHILD_HISTORY_PARTIAL, 'child_history_partial');
  assert.equal(SLICE_REASONS.CHILD_HISTORY_UNCHECKED, 'child_history_unchecked');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const records = await readFile(join(root, 'src', 'records.js'), 'utf8');
  const index = await readFile(join(root, 'index.js'), 'utf8');
  for (const reason of ['child_history_partial', 'child_history_unchecked']) {
    assert.ok(!records.includes(`'${reason}'`), `records.js reads ${reason} from the table`);
    assert.equal(index.split(`'${reason}'`).length - 1, 1, `${reason} is declared exactly once, in the table`);
  }
});

// F130: the Codex reader's capture table and the child-evidence render (since removed) both spelled the unchecked
// reason themselves — a second declaration and an inline literal the table could not see.
test('F130 child_history_unchecked is declared once, in SLICE_REASONS; the Codex table reads it', async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const literal = "'child_history_unchecked'";
  const count = async (file) => (await readFile(join(root, file), 'utf8')).split(literal).length - 1;
  assert.equal(await count('slicer/index.js'), 1, 'the one declaration');
  assert.equal(await count('slicer/src/codex-exec.js'), 0, 'the Codex capture table reads the member');
  const { CODEX_CAPTURE_REASONS } = await import('../src/codex-exec.js');
  assert.equal(CODEX_CAPTURE_REASONS.childHistory, SLICE_REASONS.CHILD_HISTORY_UNCHECKED);
});

test('F111 every reason a child recording declares is a member of the slicer table', async () => {
  const members = new Set(Object.values(SLICE_REASONS));
  const cases = {
    clean: work(),
    partial: work({ 3: without('agentId') }),
    inherited: [...inherited(), ...work()],
    conflict: work({ 3: (row) => ({ ...row, agentId: 'fedcba9876543210' }) }),
  };
  const seen = new Set();
  for (const [name, rows] of Object.entries(cases)) {
    const ledger = await sliceChild(rows);
    for (const reason of ledger.capture?.reasons ?? []) {
      assert.ok(members.has(reason), `${name}: capture reason outside the table: ${reason}`);
      seen.add(reason);
    }
    for (const drop of ledger.dropped ?? []) {
      assert.ok(members.has(String(drop.reason)), `${name}: drop reason outside the table: ${drop.reason}`);
    }
  }
  // The cases above must actually reach both child-history branches, or this proves nothing.
  assert.ok(seen.has(SLICE_REASONS.CHILD_HISTORY_PARTIAL) && seen.has(SLICE_REASONS.CHILD_HISTORY_UNCHECKED));
});

// ---- F110: an isSidechain drift does not unlink a child ---------------------------------------
//
// F52 made the READER keep a child whose one record drifted. The IDENTITY did not follow: one
// record without `isSidechain` still set `nested: false`, and the parent-side link requires a
// nested source (child-links.js), so the drifted child could never be linked at all. A record
// carrying exactly ONE of the two child markers is drift under one child identity; `nested` is
// decided by the records that carry both (the child's own) against those that carry neither
// (inherited main-thread history) — the same classification records.js applies.

function identityOf(rows) {
  const id = recordingIdentity('claude');
  for (const row of rows) id.observe(row);
  return id.value();
}

test('F110 one record that lost isSidechain leaves the recording nested', () => {
  const id = identityOf(work({ 3: without('isSidechain') }));
  assert.equal(id.childId, CHILD);
  assert.equal(id.nested, true, 'a drifted record does not decide nested');
  assert.equal(id.mixedHistory, false, 'drift is not inherited history');
  assert.equal(id.identityConflict, false);
});

test('F110 an explicit isSidechain:false on a record that keeps the child agentId is drift too', () => {
  const id = identityOf(work({ 3: (row) => ({ ...row, isSidechain: false }) }));
  assert.equal(id.nested, true);
  assert.equal(id.mixedHistory, false);
});

test('F110 inherited records carrying neither marker still make the history mixed, never nested', () => {
  const id = identityOf([...inherited(), ...work()]);
  assert.equal(id.nested, false);
  assert.equal(id.mixedHistory, true);
});

test('F110 with no child identity at all, the sidechain marker alone still decides, as before', () => {
  const noAgent = work().map(without('agentId'));
  assert.equal(identityOf(noAgent).nested, true, 'an all-sidechain recording without agentId is nested');
  const oneMain = work({ 3: without('isSidechain') }).map(without('agentId'));
  assert.equal(identityOf(oneMain).nested, false, 'with no identity to drift from, a non-sidechain record is main-thread');
  assert.equal(identityOf(oneMain).mixedHistory, true);
});

test('F110 over every mix of marker classes, only agentId-only drift changes the answer, and only toward nested', () => {
  // One record per class; a scaffolding record carries the identity so childId is single in every
  // mix. `before` is the rule this change replaced: any non-sidechain conversation record un-nested.
  const CLASSES = {
    both: { isSidechain: true, agentId: CHILD },
    sidechainOnly: { isSidechain: true },
    agentOnly: { agentId: CHILD },
    neither: {},
  };
  const names = Object.keys(CLASSES);
  for (let mask = 1; mask < 1 << names.length; mask++) {
    const present = names.filter((_, i) => mask & (1 << i));
    const rows = [{ type: 'progress', sessionId: 'root', agentId: CHILD },
      ...present.map((name) => ({ type: 'user', sessionId: 'root', message: { content: name }, ...CLASSES[name] }))];
    const has = (name) => present.includes(name);
    const sidechain = has('both') || has('sidechainOnly');
    const before = sidechain && !has('agentOnly') && !has('neither');
    const id = identityOf(rows);
    assert.equal(id.childId, CHILD);
    assert.equal(id.nested, sidechain && !has('neither'), present.join('+'));
    assert.equal(id.mixedHistory, sidechain && has('neither'), present.join('+'));
    if (before) assert.equal(id.nested, true, `${present.join('+')}: never un-nested`);
    if (id.nested !== before) assert.ok(has('agentOnly') && !has('neither'), present.join('+'));
  }
});

test('F110 the sliced child source is nested and declares the drift as partial', async () => {
  const ledger = await sliceChild(work({ 3: without('isSidechain') }));
  assert.equal(ledger.sources[0].nested, true, 'the source the parent-side link reads is nested');
  assert.deepEqual(paths(ledger), ['create src/queue.js', 'edit src/queue.js']);
  assert.ok(ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));
  assert.ok(!ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_UNCHECKED));
});

// The parent side, end to end: a parent recording and its child written beside it on disk in the
// layout Claude Code uses (<project>/<sessionId>.jsonl and <project>/<sessionId>/subagents/
// agent-<agentId>.jsonl), loaded through loadSessionEvidence exactly as a review loads them.
const launch = (id, agentId) => [call(id, 'Agent', { prompt: 'Write the queue module.' }),
  { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id,
    content: `Async agent launched.\nagentId: ${agentId}\nUse SendMessage to reach it.` }] } }];

async function linkChild(t, childRows) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-child-drift-')));
  const home = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'sonah-home');   // no outcome sidecar is read from the machine
  t.after(async () => {
    if (home === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = home;
    await rm(dir, { recursive: true, force: true });
  });
  const projects = join(dir, 'projects');
  const project = join(projects, '-repo');
  await mkdir(join(project, 'root', 'subagents'), { recursive: true });
  const parent = join(project, 'root.jsonl');
  const save = (file, rows) => writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  await save(parent, [user('Delegate the queue module.'), ...launch('spawn-1', CHILD)]
    .map((r) => ({ cwd: '/repo', sessionId: 'root', isSidechain: false, ...r })));
  await save(join(project, 'root', 'subagents', `agent-${CHILD}.jsonl`), childRows);
  return loadSessionEvidence([parent], { recordingRoots: { claude: projects, codex: join(dir, 'codex') } });
}

test('F110 a child with one record missing isSidechain still links from the parent side, declared partial', async (t) => {
  const ledger = await linkChild(t, work({ 3: without('isSidechain') }));
  assert.equal(ledger.delegations.length, 1);
  assert.equal(ledger.delegations[0].status, 'linked', `got ${ledger.delegations[0].reason}`);
  assert.equal(ledger.children?.length, 1);
  const child = ledger.children[0].ledger;
  assert.deepEqual(paths(child), ['create src/queue.js', 'edit src/queue.js'], 'the child\'s own work survives');
  assert.ok(child.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL), 'the drift is declared');
  assert.equal(hasCaptureGaps(child), true);
});

test('F110 a clean child links, and a child carrying inherited history still does not', async (t) => {
  const clean = await linkChild(t, work());
  assert.equal(clean.delegations[0].status, 'linked');
  assert.ok(!clean.children[0].ledger.capture.reasons.includes(SLICE_REASONS.CHILD_HISTORY_PARTIAL));

  const mixed = await linkChild(t, [...inherited(), ...work()]);
  assert.equal(mixed.delegations[0].status, 'unresolved', 'inherited history is not drift: no link');
  assert.equal(mixed.children, undefined);
});
