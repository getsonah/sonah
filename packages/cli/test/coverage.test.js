// Coverage regressions: synthetic records only, never a judge call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { session, toJsonl } from '../../golden/index.js';
import { sliceLineage, hasActionGaps, hasCaptureGaps } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { buildLedger } from '../../evidence/src/ledger.js';
import { scratchDir } from '../../slicer/test/scratch-dir.js';

async function withHome(run) {
  const home = await scratchDir('sonah-coverage-');
  const saved = process.env.SONAH_HOME;
  process.env.SONAH_HOME = home;
  try { await run(home); }
  finally { if (saved === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = saved; }
}

test('one unreadable record makes the capture incomplete and visible', async () => {
  await withHome(async (home) => {
    const file = join(home, 'synthetic.jsonl');
    // One unreadable record is enough to make the action stream incomplete; no transcript data
    // are needed to reproduce the former qualification false green.
    await writeFile(file, `${toJsonl(session().ask('Please add a parser.').say('Done.').done())}\n{malformed\n`);
    const { ledger } = redact(await sliceLineage([file]));
    assert.equal(hasCaptureGaps(ledger), true);
  });
});

// M33 (C-06): the PR review's session verdict, over a review declared complete and a recorder limit
// (the unmapped observation), is NO_FINDINGS — never CLEAN. Before M33 it read UNCHECKED.
test('an unmapped Codex observation is a recorder limit: the PR review session verdict is NO_FINDINGS', async () => {
  await withHome(async (home) => {
    const file = join(home, 'rollout-2026-09-10T12-00-00-synthetic.jsonl');
    const rows = [
      { type: 'session_meta', payload: { id: 'synthetic', cwd: '/repo' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Run the build.' } },
      { type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'wrapper',
        input: 'const r = await tools.exec_command({cmd:"make build"}); text({...r,exit_code:0});' } },
      { type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'wrapper',
        output: [{ type: 'input_text', text: 'Script completed\nWall time: 0.1 seconds' },
          { type: 'input_text', text: JSON.stringify({ output: 'build passed', exit_code: 0 }) }] } },
    ];
    await writeFile(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
    const raw = await sliceLineage([file], { includeSources: true });
    const { ledger } = redact(raw);
    assert.equal(ledger.capture.captured, 1);
    assert.equal(ledger.capture.unmapped, 1);
    assert.equal(ledger.capture.unsupported, 0);
    assert.equal(ledger.capture.missing, 0);
    assert.equal(ledger.capture.incomplete, false);
    assert.equal(ledger.ledger[0].observationMissing, true);
    assert.equal(ledger.ledger[0].outcome, undefined);
    assert.equal(hasActionGaps(ledger), false, 'the invocation itself is recorded');
    assert.equal(hasCaptureGaps(ledger), true, 'its observation is not attributable');

    const session = sessionFromLedger(ledger, { sessionKey: 'synthetic' });
    assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'observations')
      .map((gap) => [gap.code, gap.count]), [['command_outcome_unknown', 1], ['incomplete_inventory', 1]]);
    const repo = { host: 'github.com', id: 'synthetic' };
    const report = buildLedger({ repo, session, pr: { repo, number: 1, files: [] },
      sessionCoverage: 'complete', codeCoverage: 'complete' });
    assert.equal(report.coverage, 'partial');
    assert.equal(report.sessionStatus, 'NO_FINDINGS');
    assert.notEqual(report.reviewStatus, 'CLEAN');
  });
});

test('a counted drop is a capture gap; a zero count or a redaction is not', () => {
  const base = { ask: [], ledger: [], dropped: [] };
  assert.equal(hasCaptureGaps(base), false);
  assert.equal(hasCaptureGaps({ ...base, capture: { incomplete: true } }), true);
  assert.equal(hasCaptureGaps({ ...base, dropped: [{ reason: 'unknown_schema_files:1' }] }), true);
  assert.equal(hasCaptureGaps({ ...base, dropped: [{ reason: 'unparseable_lines:0' }] }), false);
  assert.equal(hasCaptureGaps({ ...base, dropped: [{ reason: 'redacted:email' }] }), false,
    'redaction is not an adapter failure');
});
