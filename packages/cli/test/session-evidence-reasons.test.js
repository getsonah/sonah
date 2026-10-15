// M65: the IO layer's child-link and capture reasons are a closed vocabulary too.
//
// session-evidence.js emitted five link reasons and two capture reasons as bare literals, outside
// any declared map — so `child_recording_cycle` and `child_recording_changed` were invented at the
// call site and nothing could enumerate them. A per-reason false-positive rate over an
// unenumerable set is not computable, which is the whole reason the vocabulary is closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSessionEvidence, CHILD_RECORDING_REASONS, CHILD_CAPTURE_REASONS } from '../src/session-evidence.js';
import { CHILD_LINK_REASONS } from '../../slicer/src/child-links.js';

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'session-evidence.js');

const declared = () => new Set([
  ...Object.values(CHILD_RECORDING_REASONS),
  ...Object.values(CHILD_CAPTURE_REASONS),
  ...Object.values(CHILD_LINK_REASONS),
]);

test('the module declares its own reasons, and every declared value is a bare lowercase token', () => {
  assert.ok(Object.keys(CHILD_RECORDING_REASONS).length >= 5, 'the five IO-layer link reasons are declared');
  assert.ok(Object.keys(CHILD_CAPTURE_REASONS).length >= 2, 'the capture reasons are declared');
  for (const value of declared()) {
    assert.match(value, /^[a-z][a-z_]*$/, `${value} is not a bare token`);
  }
  assert.equal(Object.isFrozen(CHILD_RECORDING_REASONS), true);
  assert.equal(Object.isFrozen(CHILD_CAPTURE_REASONS), true);
});

test('no reason is written as a literal at the call site', async () => {
  const whole = await readFile(SOURCE, 'utf8');
  // The declaration block is where the strings are SUPPOSED to be spelled out. Scan the code
  // that emits them: everything from the entry point onward.
  const start = whole.indexOf('export async function loadSessionEvidence');
  assert.ok(start > 0, 'the entry point moved; this scan is anchored on it');
  const source = whole.slice(start);
  const literals = new Set();
  // `reason: 'x'` / `d.reason !== 'x'` — the link-reason positions.
  for (const m of source.matchAll(/reason\s*(?::|!==|===|==)\s*'([^']+)'/g)) literals.add(m[1]);
  // Any child_*/delegated_* token spelled out anywhere in the module.
  for (const m of source.matchAll(/'(child_[a-z_]+|delegated_[a-z_]+)'/g)) literals.add(m[1]);
  assert.deepEqual([...literals], [],
    `these reasons are spelled out instead of read from a declared map: ${[...literals].join(', ')}`);
});

// One reason exercised end to end, so the map is not merely decorative: a namespace holding an
// unreadable recording makes the inventory incomplete, and the delegation is declared unresolved
// with the token that says why.
test('an incomplete inventory declares its reason from the map', async (t) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'sonah-child-reasons-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const projects = join(dir, 'projects');
  const project = join(projects, 'example');
  await mkdir(join(project, 'root', 'subagents'), { recursive: true });
  const root = join(project, 'root.jsonl');
  const call = (id, name, input) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id, content) => ({ type: 'user', message: { content: [
    { type: 'tool_result', tool_use_id: id, content: JSON.stringify(content), is_error: false }] } });
  const rows = [
    { type: 'user', message: { content: 'Review the parser.' } },
    call('parent-write', 'Write', { file_path: 'src/root.js', content: 'root' }),
    call('spawn-1', 'Task', { prompt: 'private child brief' }),
    result('spawn-1', { agentId: 'child-1' }),
  ].map(r => ({ cwd: '/repo', sessionId: 'root', ...r }));
  await writeFile(root, rows.map(r => JSON.stringify(r)).join('\n') + '\n', { mode: 0o600 });
  // An unreadable recording in the same namespace: the index cannot verify it, so it is incomplete.
  await writeFile(join(project, 'root', 'subagents', 'agent-broken.jsonl'), 'not json at all\n', { mode: 0o600 });

  const ledger = await loadSessionEvidence([root], { recordingRoots: { claude: projects } });
  const reasons = (ledger.delegations ?? []).map(d => d.reason).filter(Boolean);
  assert.ok(reasons.length, 'the delegation was declared unresolved with a reason');
  for (const r of reasons) assert.ok(declared().has(r), `${r} is not a declared reason`);
  assert.ok(reasons.includes(CHILD_RECORDING_REASONS.INVENTORY_INCOMPLETE),
    `expected an incomplete-inventory reason, got ${JSON.stringify(reasons)}`);
});
