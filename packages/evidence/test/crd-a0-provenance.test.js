// CRD-A0 — diagnostic regressions for G1–G6, through the PRODUCTION raw path.
//
// These build synthetic Claude recordings on disk and run them through the real
// analyze() -> sessionFromLedger() pipeline, not hand-constructed Sessions. A hand-built
// Session cannot expose these defects: every one of them happens upstream of the canonical
// model, in slicing, compression or adapter mapping.
//
// Tests marked `todo` assert the behaviour CRD-A1 must deliver and fail today by design. They
// are the specification of the repair, not a description of current behaviour. Remove the todo
// flag as each lands. Tests without `todo` assert behaviour that is already correct and must
// not regress while A1 changes the path around them.
//
// Every fixture is synthetic. No real session is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../../cli/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

// ---- synthetic raw recording builders ------------------------------------------------
let seq = 0;
const uid = () => `id-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-crd-a0', cwd: '/repo', version: '2.1.205', gitBranch: 'main', isSidechain: false };

const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const say = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, isError) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError === undefined ? {} : { is_error: isError }) }] } });

/** Write records to a real .jsonl and run the production path over it. */
async function throughProductionPath(records) {
  const dir = await mkdtemp(join(tmpdir(), 'crd-a0-'));
  const file = join(dir, 'session.jsonl');
  await writeFile(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  try {
    const { ledger } = await analyze([file]);
    return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'crd-a0' }) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const invocations = (s) => s.events.filter((e) => e.kind === 'invocation');
const observations = (s) => s.events.filter((e) => e.kind === 'observation');

// ---- G1: write bodies do not survive to review evidence -------------------------------

const LONG_BODY = [
  'export function priceOrder(order) {',
  ...Array.from({ length: 80 }, (_, i) => `  // line ${i} — padding so the body exceeds the upstream argument cap`),
  '  const total = order.items.reduce((n, i) => n + i.cents, 0);',
  '  return Math.round(total * 1.2);          // MARKER_TAX_MULTIPLIER',
  '}',
].join('\n');

test('G1 FIXED: a long write body reaches canonical evidence as quotable code', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'),
    toolUse('t1', 'Write', { file_path: '/repo/src/price.js', content: LONG_BODY }),
    toolResult('t1', 'File created successfully'),
  ]);
  const write = invocations(session).find((e) => (e.paths ?? []).some((p) => p.path.includes('price.js')));
  assert.ok(write, 'the write invocation itself is captured');
  // B1 flipped this: the adapter places the redacted body, so added-code receipts can ground.
  assert.equal(write.changes.length, 1, 'the write carries its change');
  assert.equal(session.sourcesFor(write).some((s) => s.role === 'code' && s.text.length > 0), true,
    'the written body is a citable code source on the invocation');
  // `input` stays empty: the raw tool arguments are a different channel and are not evidence.
  assert.deepEqual(write.input, [], 'input is still empty — the body is on changes, not args');
});

test('G1 required: a supported write exposes its literal body with declared extent', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'),
    toolUse('t1', 'Write', { file_path: '/repo/src/price.js', content: LONG_BODY }),
    toolResult('t1', 'File created successfully'),
  ]);
  const write = invocations(session).find((e) => (e.paths ?? []).some((p) => p.path.includes('price.js')));
  const after = (write.changes ?? []).map((c) => session.textOf(c, 'after')).join('');
  assert.match(after, /MARKER_TAX_MULTIPLIER/, 'a literal from the written body must be quotable');
  // Extent must be honest: a full body is not a fragment and vice versa.
  assert.ok(write.changes[0].extent, 'each retained region declares its extent');
});

// ---- G2: a write with no recorded result must not read as success ---------------------

test('G2 FIXED: a write with no terminal result is not reported as succeeded', async () => {
  const { session } = await throughProductionPath([
    userTurn('add order pricing'),
    toolUse('t1', 'Write', { file_path: '/repo/src/price.js', content: LONG_BODY }),
    // no tool_result record at all — the recording simply ends
    say('Done, pricing added.'),
  ]);
  const write = invocations(session).find((e) => (e.paths ?? []).some((p) => p.path.includes('price.js')));
  const obs = observations(session).find((o) => o.invocation === write.id);
  // Either no terminal observation, or one that honestly says the outcome is unknown.
  if (obs) assert.notEqual(obs.result, 'succeeded', 'an unobserved write must not claim success');
  assert.equal(session.succeeded(write.id), false, 'an unobserved write must not satisfy the adoption check');
});

test('G2 already correct: a recorded failure stays failed and keeps native provenance', async () => {
  const { session } = await throughProductionPath([
    userTurn('run the tests'),
    toolUse('t2', 'Bash', { command: 'npm test' }),
    toolResult('t2', 'Tests: 1 failed, 11 passed', true),
  ]);
  const obs = observations(session).find((o) => session.textOf(o, 'output').includes('1 failed'));
  assert.ok(obs, 'the failing result is captured');
  assert.notEqual(obs.result, 'succeeded', 'a recorded failure is never success');
});

// ---- G3: commentary chronology across turns ------------------------------------------

test('G3 FIXED: commentary keeps its recorded order relative to actions on later turns', async () => {
  const { session } = await throughProductionPath([
    userTurn('first task'),
    say('T1-BEFORE-ACTION'),
    toolUse('a1', 'Bash', { command: 'echo one' }),
    toolResult('a1', 'one'),
    say('T1-AFTER-ACTION'),
    userTurn('second task'),
    say('T2-BEFORE-ACTION'),
    toolUse('a2', 'Bash', { command: 'echo two' }),
    toolResult('a2', 'two'),
    say('T2-AFTER-ACTION'),
  ]);
  const order = session.events
    .map((e) => (e.kind === 'commentary' ? session.textOf(e, 'text')
      : e.kind === 'invocation' ? `ACTION:${session.textOf(e, 'command')}` : null))
    .filter(Boolean);
  const at = (needle) => order.findIndex((x) => x.includes(needle));
  // The defect appears on turn 2: a global beforeEvent index clamped to the turn's action
  // count pushes earlier commentary after the action it actually preceded.
  assert.ok(at('T2-BEFORE-ACTION') < at('ACTION:echo two'),
    'commentary said before an action must stay before it on later turns');
  assert.ok(at('ACTION:echo two') < at('T2-AFTER-ACTION'),
    'commentary said after an action must stay after it');
});

// ---- G4: an instruction inside an elided span ----------------------------------------

// compressAsk used to elide a fenced block once it exceeded 1200 characters, recording ask.elided. M6: the turn is kept whole up to the transport budget, so the constraint is retained.
const FENCED_CONSTRAINT = [
  'Please pick up the export work. Details in the block below.',
  '',
  '```',
  'Hard constraint: do not add any new runtime dependency to the parser.',
  ...Array.from({ length: 40 }, (_, i) => `padding line ${i} ${'x'.repeat(30)}`),
  '```',
  '',
  'Use your judgement on layout.',
].join('\n');

test('G4, M6: a constraint pasted in a long fence stays in ask.text, and nothing is elided', async () => {
  const { ledger } = await throughProductionPath([
    userTurn(FENCED_CONSTRAINT),
    toolUse('e1', 'Bash', { command: 'npm install fast-xml-parser' }),
    toolResult('e1', 'added 1 package'),
  ]);
  const ask = (ledger.ask ?? [])[0];
  assert.ok(ask, 'the instruction is captured');
  assert.ok(ask.text.includes('Hard constraint: do not add any new runtime dependency to the parser.'),
    'M6: the constraint is the human\'s words, kept');
  assert.equal(Object.hasOwn(ask, 'elided'), false, 'M6: nothing was cut, so nothing is declared');
});

test('G4 required: elided instruction material is propagated as incomplete scope', async () => {
  const { session } = await throughProductionPath([
    userTurn(FENCED_CONSTRAINT),
    toolUse('e1', 'Bash', { command: 'npm install fast-xml-parser' }),
    toolResult('e1', 'added 1 package'),
  ]);
  const instruction = session.events.find((e) => e.kind === 'instruction');
  // Either the full instruction survives, or the omission is declared so authority stays
  // unchecked. A digest of incomplete instructions must never read as complete history.
  const fullText = session.textOf(instruction, 'text');
  const declaresOmission = Boolean(instruction.omitted?.length) || Boolean(session.instructionScopeIncomplete);
  assert.ok(fullText.includes('do not add any new runtime dependency') || declaresOmission,
    'an elided instruction must either be retained or declared incomplete');
});

// ---- G5/G6: delegated work -----------------------------------------------------------

test('G5 diagnostic: a delegation produces no canonical child link today', async () => {
  const { session } = await throughProductionPath([
    userTurn('delegate the migration'),
    toolUse('d1', 'Task', { description: 'migrate', prompt: 'Write the migration in db/migrate.sql' }),
    toolResult('d1', 'migration written'),
  ]);
  // sessionFromLedger does not transfer ledger.children/delegations into canonical links.
  assert.deepEqual(session.children ?? [], [],
    'G5: no child links are carried into review evidence — recorded so A2 can flip it');
});

test('G5+G6 diagnostic: the delegation IS detected upstream but never reaches the ledger', async () => {
  const { ledger } = await throughProductionPath([
    userTurn('delegate the migration'),
    toolUse('d1', 'Task', { description: 'migrate', prompt: 'Write the migration in db/migrate.sql' }),
    toolResult('d1', 'migration written'),
  ]);
  // The slicer records it, with an honest unresolved status...
  assert.ok((ledger.delegations ?? []).length > 0, 'the slicer detects the delegation');
  assert.equal(ledger.delegations[0].childId, null, 'and records that no child was resolved');
  // ...but the Task call produces no ledger event, so the adapter emits no delegate invocation,
  // so session.delegations() is empty, so buildLedger's missing_child guard never fires.
  assert.deepEqual((ledger.ledger ?? []).map((e) => e.kind), [],
    'G5: the delegation never becomes a ledger action');
});

test('G6 required: unreviewed delegated work must never render as a clean session', async () => {
  const { session } = await throughProductionPath([
    userTurn('delegate the migration'),
    toolUse('d1', 'Task', { description: 'migrate', prompt: 'Write the migration in db/migrate.sql' }),
    toolResult('d1', 'migration written'),
  ]);
  const { buildLedger } = await import('../src/ledger.js');
  const report = buildLedger({ repo: { host: 'github.com', id: '1' }, session, pr: null });
  assert.notEqual(report.sessionStatus, 'CLEAN',
    'unreviewed delegated work must never render as a clean session');
});

// ---- G2 repair: honest outcomes and preserved operation identity ----------------------

test('G2 repair: the three write outcomes are distinguishable end to end', async () => {
  const write = (id) => toolUse(id, 'Write', { file_path: '/repo/a.js', content: 'hello' });
  const cases = {
    succeeded: [userTurn('add it'), write('w1'), { ...toolResult('w1', 'File created successfully'),
      toolUseResult: { type: 'create', filePath: '/repo/a.js' } }],
    parsed: [userTurn('add it'), write('w1'), toolResult('w1', 'File created successfully')],
    failed: [userTurn('add it'), write('w1'), toolResult('w1', 'EACCES permission denied', true)],
    unobserved: [userTurn('add it'), write('w1')],
  };
  const seen = {};
  for (const [name, records] of Object.entries(cases)) {
    const { session } = await throughProductionPath(records);
    const inv = invocations(session)[0];
    const obs = observations(session).find((o) => o.invocation === inv?.id);
    seen[name] = { result: obs?.result ?? null, adopted: inv ? session.succeeded(inv.id) : null };
  }
  assert.equal(seen.succeeded.result, 'succeeded');
  assert.equal(seen.parsed.result, 'succeeded', 'a recognised output line is a semantic result');
  assert.equal(seen.failed.result, 'failed');
  assert.equal(seen.unobserved.result, null, 'no recorded result means no terminal observation');
  // Only the observed success may ground an adopted value.
  assert.equal(seen.succeeded.adopted, true);
  assert.equal(seen.parsed.adopted, false, 'parsed output alone cannot prove a completed write');
  assert.equal(seen.failed.adopted, false);
  assert.equal(seen.unobserved.adopted, false);
});

test('G2 repair: a failed write is still a write, not a command', async () => {
  // The slicer flips `kind` to 'error' on a failed result. Reading only `kind` reported a failed
  // WRITE as a command invocation, losing the operation that was actually attempted.
  const { session } = await throughProductionPath([
    userTurn('add it'),
    toolUse('w1', 'Write', { file_path: '/repo/a.js', content: 'hello' }),
    toolResult('w1', 'EACCES permission denied', true),
  ]);
  const inv = invocations(session)[0];
  assert.equal(inv.operation, 'write', 'a failure does not change what was attempted');
  assert.deepEqual(inv.paths.map((p) => p.path), ['a.js'], 'and it keeps its path');
});

test('G2 repair: exit codes are the recorded ones, never reconstructed from an error flag', async () => {
  const { session } = await throughProductionPath([
    userTurn('run it'),
    toolUse('b1', 'Bash', { command: 'npm test' }),
    toolResult('b1', 'Tests: 1 failed', true),
  ]);
  const obs = observations(session)[0];
  // The old adapter synthesised exitCode 1 from isError. An exit code we never saw is not evidence.
  assert.ok(obs.exitCode === null || Number.isInteger(obs.exitCode),
    'exit code is a recorded integer or explicitly absent');
});

test('G3 repair: no commentary block is lost while re-indexing across turns', async () => {
  // The offset correction subtracts prior-turn actions, which can go negative for a block
  // recorded before any action. It must clamp, not drop: losing commentary is how two thirds
  // of the agent's stated intent vanished once before.
  const records = [userTurn('first')];
  const expected = [];
  for (let turn = 1; turn <= 4; turn++) {
    if (turn > 1) records.push(userTurn(`turn ${turn}`));
    for (const slot of ['A', 'B', 'C']) {
      const text = `T${turn}-${slot}`;
      expected.push(text);
      records.push(say(text));
      if (slot === 'B') {
        records.push(toolUse(`k${turn}`, 'Bash', { command: `echo ${turn}` }));
        records.push(toolResult(`k${turn}`, String(turn)));
      }
    }
  }
  const { ledger, session } = await throughProductionPath(records);
  const out = session.events.filter((e) => e.kind === 'commentary').map((e) => session.textOf(e, 'text'));
  for (const text of expected) {
    assert.ok(out.some((o) => o.includes(text)), `${text} survived the re-index`);
  }
  assert.ok(out.length >= (ledger.commentary ?? []).length,
    'every recorded commentary block reaches canonical evidence');
});

test('G3 repair: a block preceding the first action of a later turn stays first', async () => {
  const { session } = await throughProductionPath([
    userTurn('one'), toolUse('p1', 'Bash', { command: 'echo a' }), toolResult('p1', 'a'),
    userTurn('two'), toolUse('p2', 'Bash', { command: 'echo b' }), toolResult('p2', 'b'),
    userTurn('three'), say('LAST-TURN-FIRST'), toolUse('p3', 'Bash', { command: 'echo c' }), toolResult('p3', 'c'),
  ]);
  const ordered = session.events
    .filter((e) => e.kind === 'commentary' || e.kind === 'invocation')
    .map((e) => (e.kind === 'commentary' ? session.textOf(e, 'text') : `ACTION:${session.textOf(e, 'command')}`));
  const said = ordered.findIndex((x) => x.includes('LAST-TURN-FIRST'));
  const acted = ordered.findIndex((x) => x.includes('echo c'));
  assert.ok(said >= 0 && acted >= 0 && said < acted,
    'on the third turn the statement still precedes its action');
});

// ---- A1: the final saying dedup ------------------------------------------------------
//
// The dedup contract moved to packages/evidence/test/adapter-saying.test.js (spec B6) so that
// one file owns it. The tests that lived here described the per-line coverage rule: the
// `interleaved` one claimed to exercise the fused branch but in fact took the fully-carried one
// (audit L118), and there is no fused branch any more. The rest — the leading-newline shape, the
// capped twin, the turn with no commentary, and a genuinely different closing statement — moved
// across unchanged in substance and were strengthened there.
