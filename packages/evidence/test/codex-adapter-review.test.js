// W4-1: synthetic source identity and Codex result coverage through the production read path.
// No real recording, model, or ambient Sonah/Claude/Codex store is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';
import { buildLedger } from '../src/ledger.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', payload });
const complete = (value) => [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
  { type: 'input_text', text: JSON.stringify(value) }];
const wrapper = rec({ type: 'custom_tool_call', name: 'functions.exec', call_id: 'wrapper',
  input: 'text(await tools.exec_command({cmd:"make build"}));' });
const result = (value) => rec({ type: 'custom_tool_call_output', call_id: 'wrapper', output: complete(value) });

async function syntheticCodex(lines) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-w4-adapter-'));
  const file = join(dir, 'rollout-2026-09-23T00-00-00-synthetic.jsonl');
  const previous = Object.fromEntries(['SONAH_HOME', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'SONAH_CLAUDE_PROJECTS']
    .map((key) => [key, process.env[key]]));
  try {
    // analyze() consults these roots for outcomes and child discovery. Point all of them at the
    // fixture directory so the test cannot open a user's local session or store by accident.
    for (const key of Object.keys(previous)) process.env[key] = dir;
    await writeFile(file, [JSON.stringify({ type: 'session_meta', payload: { id: 'synthetic', cwd: '/synthetic-repo' } }),
      rec({ type: 'message', role: 'user', content: "[{'type': 'input_text', 'text': 'Run the build.'}]" }),
      ...lines].join('\n') + '\n');
    const { ledger } = await analyze([file]);
    return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'synthetic' }) };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
}

test('canonical adapter follows a verified Codex source through analyze', async () => {
  const { ledger, session } = await syntheticCodex([wrapper, result({ output: 'built', exit_code: 0 })]);
  assert.deepEqual(ledger.sources.map((source) => source.adapter), ['codex']);
  assert.equal(session.adapter, 'codex');
  assert.ok(session.events.some((event) => event.kind === 'invocation' && event.operation === 'command'));
  assert.ok(session.events.some((event) => event.kind === 'observation' && event.result === 'succeeded'));
  assert.equal(session.adapterGaps.filter((gap) => gap.channel === 'observations').length, 0);
});

test('an unmapped Codex wrapper result declares a session observation gap and cannot read CLEAN', async () => {
  const { ledger, session } = await syntheticCodex([wrapper,
    result({ output: 'built', exit_code: 0 }), result({ output: 'failed', exit_code: 2 })]);
  assert.equal(ledger.capture.unmapped, 1);
  assert.equal(ledger.capture.incomplete, false, 'this is specifically the missing-coverage case');
  assert.equal(session.adapter, 'codex');
  assert.ok(session.events.some((event) => event.kind === 'invocation'));
  assert.ok(!session.events.some((event) => event.kind === 'observation'));
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations')
    .map((gap) => [gap.code, gap.count]),
  [['command_outcome_unknown', 1], ['incomplete_inventory', 1]]);
  const repo = { host: 'github.com', id: 'synthetic' };
  const report = buildLedger({ repo, session, pr: { repo, number: 1, files: [] },
    sessionCoverage: 'complete', codeCoverage: 'complete' });
  // M33 (C-06): a review declared complete over a recording whose wrapper result could not be
  // mapped — a declared recorder limit — reads NO_FINDINGS, and so does the aggregate beside a clean
  // code review (DECIDE > UNCHECKED > FYI > NO_FINDINGS > CLEAN). Never CLEAN; before M33, UNCHECKED.
  assert.equal(report.coverage, 'partial');
  assert.equal(report.sessionStatus, 'NO_FINDINGS');
  assert.equal(report.reviewStatus, 'NO_FINDINGS');
});

test('capture incompleteness stays on actions, while an unmapped result has its own observation gap', () => {
  const session = sessionFromLedger({ sources: [{ adapter: 'codex' }],
    capture: { incomplete: true, unmapped: 2 } });
  assert.deepEqual(session.adapterGaps.filter((gap) => ['actions', 'observations'].includes(gap.channel))
    .map((gap) => [gap.channel, gap.scope, gap.count]),
  [['observations', 'session', 2], ['actions', 'session', null]]);
});

test('Cursor identity survives its parser fallback, and old Claude ledgers remain Claude', () => {
  assert.equal(sessionFromLedger({ sources: [{ adapter: 'cursor', identityConflict: true }] }).adapter, 'cursor');
  assert.equal(sessionFromLedger({ sources: [{ adapter: 'claude', identityConflict: false }] }).adapter, 'claude');
  assert.equal(sessionFromLedger({}).adapter, 'claude');
});

test('mixed or unrecognised source adapters declare identity uncertainty', () => {
  for (const sources of [[{ adapter: 'claude' }, { adapter: 'codex' }], [{ adapter: 'new-vendor' }]]) {
    const session = sessionFromLedger({ sources });
    assert.equal(session.adapter, 'unknown');
    assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'identity'), [{
      code: 'incomplete_inventory', channel: 'identity', scope: 'session', count: sources.length,
      sessionKey: session.sessionKey, lossOrdinal: 0,
      note: 'recording sources did not establish one supported adapter',
    }]);
  }
});
