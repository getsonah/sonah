// A captured invocation without a recorded result is still an action, but not a checked
// observation. Synthetic sessions only; no ambient recordings or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { sliceLineage, hasActionGaps } from '../../slicer/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { buildLedger } from '../src/ledger.js';
// M33 (C-06 "M33 session verdict"): the reviews below COMPLETE — every window answered, challenged
// and grounded — and their coverage is partial only by a recorder limit the adapter declared (a
// capture, redaction, outcome, child or pair gap). That reads NO_FINDINGS: never CLEAN, always
// shown with the partial coverage and its causes. Before M33 it read UNCHECKED, which now means
// the review itself did not complete.
const RECORDER_LIMITED = 'NO_FINDINGS';

async function fixture(t, adapter, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-missing-observation-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = adapter === 'cursor'
    ? join(dir, '.cursor', 'projects', 'repo', 'agent-transcripts', 'synthetic.jsonl')
    : join(dir, 'synthetic.jsonl');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  const ledger = await sliceLineage([file], { cwd: '/repo', includeSources: true });
  const session = sessionFromLedger(ledger, { sessionKey: 'synthetic' });
  const repo = { host: 'github.com', id: 'synthetic' };
  // Hold review work complete to isolate the capture guard from model and code coverage.
  const report = buildLedger({ repo, session, pr: { repo, number: 1, files: [] },
    sessionCoverage: 'complete', codeCoverage: 'complete' });
  return { ledger, session, report };
}

// M34 labels review (F6): a typed recorder (2.1.219 and later), whose human prompts carry the host's typed origin; an
// unversioned one is labelled by the declared legacy fallback, every row of it a counted gap.
const claude = (type, content) => ({ type, sessionId: 'synthetic', cwd: '/repo', version: '2.1.284',
  ...(type === 'user' && typeof content === 'string' ? { origin: { kind: 'human' } } : {}),
  message: { role: type, content } });
const cursor = (role, content) => ({ role, message: { content } });
const result = (id, content, is_error = false) =>
  ({ type: 'tool_result', tool_use_id: id, content, is_error });

test('Claude: a missing result preserves visible T and A, declares missing O, and cannot read CLEAN', async (t) => {
  const { ledger, session, report } = await fixture(t, 'claude', [
    claude('user', 'Run the build.'),
    claude('assistant', [{ type: 'text', text: 'Running the build.' },
      { type: 'tool_use', id: 'build', name: 'Bash', input: { command: 'make build' } }]),
  ]);
  assert.equal(ledger.commentary[0].text, 'Running the build.');
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.ledger[0].cmd, 'make build');
  assert.equal(ledger.ledger[0].outcome, undefined);
  assert.equal(ledger.capture.incomplete, false);
  assert.equal(hasActionGaps(ledger), false);
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 1);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 0);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations')
    .map((gap) => [gap.code, gap.count]), [['command_outcome_unknown', 1], ['incomplete_inventory', 1]]);
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('Cursor: wholly omitted outputs keep all calls but no fabricated observation', async (t) => {
  const { ledger, session, report } = await fixture(t, 'cursor', [
    cursor('user', '<user_query>Build and write the module.</user_query>'),
    cursor('assistant', [{ type: 'text', text: 'Running the build.' },
      { type: 'tool_use', name: 'Shell', input: { command: 'make build' } },
      { type: 'tool_use', name: 'Write', input: { path: '/repo/src/mod.js', contents: 'export const ready = true;\n' } }]),
  ]);
  assert.equal(ledger.commentary[0].text, 'Running the build.');
  assert.equal(ledger.ledger.length, 2);
  assert.equal(ledger.ledger[0].outcome, 'unknown');
  assert.equal(ledger.capture.incomplete, false);
  assert.equal(hasActionGaps(ledger), false);
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 2);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 0);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations')
    .map((gap) => [gap.code, gap.count]),
  [['write_outcome_unknown', 1], ['command_outcome_unknown', 1], ['incomplete_inventory', 2]]);
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('Cursor: one recorded failure remains checked while a second missing result is partial', async (t) => {
  const { ledger, session, report } = await fixture(t, 'cursor', [
    cursor('user', '<user_query>Run both checks.</user_query>'),
    cursor('assistant', [{ type: 'tool_use', id: 'first', name: 'Shell', input: { command: 'make first' } },
      { type: 'tool_use', id: 'second', name: 'Shell', input: { command: 'make second' } }]),
    cursor('user', [result('first', 'Build failed', true)]),
  ]);
  assert.equal(ledger.ledger[0].outcome, 'failed');
  assert.equal(ledger.ledger[1].outcome, undefined);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 1);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations')
    .map((gap) => [gap.code, gap.count]), [['command_outcome_unknown', 1], ['incomplete_inventory', 1]]);
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});

test('a recorded failure alone is checked observation evidence', async (t) => {
  const { session, report } = await fixture(t, 'claude', [
    claude('user', 'Run the build.'),
    claude('assistant', [{ type: 'tool_use', id: 'build', name: 'Bash', input: { command: 'make build' } }]),
    claude('user', [result('build', 'Build failed', true)]),
  ]);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 1);
  assert.equal(session.adapterGaps.filter((gap) => gap.channel === 'observations').length, 0);
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('unknown and changed-schema tool calls retain correlated A/O beside a known action', async (t) => {
  const { ledger, session, report } = await fixture(t, 'claude', [
    claude('user', 'Inspect and build.'),
    claude('assistant', [{ type: 'tool_use', id: 'future', name: 'FutureCodeTool', input: { path: '/repo/src/app.js' } },
      { type: 'tool_use', id: 'unplaced-read', name: 'Read', input: {} },
      { type: 'tool_use', id: 'build', name: 'Bash', input: { command: 'make build' } }]),
    claude('user', [result('future', 'changed'), result('unplaced-read', 'some bytes'),
      result('build', 'Build failed', true)]),
  ]);
  assert.equal(ledger.ledger.length, 3);
  assert.equal(ledger.capture?.unsupportedActions ?? 0, 0);
  assert.equal(ledger.capture?.unsupported ?? 0, 0);
  assert.equal(ledger.capture?.incomplete ?? false, false);
  assert.equal(hasActionGaps(ledger), false);
  assert.equal(session.events.filter((event) => event.kind === 'invocation').length, 3);
  assert.equal(session.events.filter((event) => event.kind === 'observation').length, 3);
  assert.equal(session.adapterGaps.filter((gap) => gap.channel === 'actions').length, 0);
  assert.equal(report.sessionStatus, 'CLEAN');
});

test('a result with no recorded call declares a missing-action inventory', async (t) => {
  const { ledger, session, report } = await fixture(t, 'claude', [
    claude('user', 'Run the build.'),
    claude('user', [result('lost-call', 'done')]),
    claude('assistant', [{ type: 'tool_use', id: 'build', name: 'Bash', input: { command: 'make build' } }]),
    claude('user', [result('build', 'Build failed', true)]),
  ]);
  assert.equal(ledger.ledger.length, 1);
  assert.equal(ledger.capture.orphanResults, 1);
  assert.equal(ledger.capture.incomplete, true);
  assert.ok(session.adapterGaps.some((gap) => gap.code === 'incomplete_inventory' && gap.channel === 'actions'));
  assert.equal(report.sessionStatus, RECORDER_LIMITED);
});
