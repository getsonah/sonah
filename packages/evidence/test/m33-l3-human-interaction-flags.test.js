// M33 brittleness L3: "asked the human" and "plan approval" are recorder schema, set by the adapter as flags
// (`asksHuman`, `humanChoice`), the way `answerTo` is — never a tool-name list in evidence code. Each harness's own
// built-in names live in the adapter (adapters/sonah-ledger.js HUMAN_INTERACTION_TOOLS); a recorder whose schema the
// adapter does not know leaves both unset and its session declares that it cannot tell, so nothing is certified on
// their absence.
//
// Every row is synthetic (m33-u-unasked-fixture.js shapes). No real recording is read; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
// M34 labels (merged into M33 integration): the human's prompt is `humanAsk`, the typed origin a 2.1.219+ recorder writes.
import { humanAsk, said, call, result, codexRows, CODEX_NAME, SESSION, QUESTION } from './m33-u-unasked-fixture.js';
import { sessionFromLedger, HUMAN_INTERACTION_TOOLS, HUMAN_INTERACTION_UNKNOWN_NOTE } from '../adapters/sonah-ledger.js';
import { instructionReviewScope, windowEnd, asksHuman, humanChoice } from '../src/ledger.js';
import { humanInstructionsBetween } from '../src/forbidden.js';
import { planWindows } from '../src/windows.js';
import { runReview } from '../src/run-review.js';
import { coverageCauses, COVERAGE_SENTENCE } from '../src/review.js';

/** Write `rows` as one recording and load it as the review does: sliced with its parser's source identity, redacted,
 *  adapted. */
async function load(t, rows, { name = `${SESSION}.jsonl` } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-l3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const ledger = redact(await sliceLineage([file], { cwd: '/repo', includeSources: true })).ledger;
  return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'm33-l3' }) };
}
const flagged = (session) => session.events.filter((event) => event.kind === 'invocation')
  .map((event) => [event.tool, asksHuman(event), humanChoice(event)]);
const unknownGaps = (session) => session.adapterGaps.filter((gap) => gap.note === HUMAN_INTERACTION_UNKNOWN_NOTE);

test('L3: each harness\'s own built-in tool names, closed and frozen, in the adapter only', () => {
  assert.deepEqual(Object.keys(HUMAN_INTERACTION_TOOLS), ['claude', 'codex']);
  assert.deepEqual(HUMAN_INTERACTION_TOOLS.claude, { asksHuman: ['AskUserQuestion'], humanChoice: ['ExitPlanMode'] });
  assert.deepEqual(HUMAN_INTERACTION_TOOLS.codex, { asksHuman: ['request_user_input', 'request_user_input_async'],
    humanChoice: [] });
  assert.ok(Object.isFrozen(HUMAN_INTERACTION_TOOLS));
  for (const schema of Object.values(HUMAN_INTERACTION_TOOLS))
    assert.ok(Object.isFrozen(schema) && Object.isFrozen(schema.asksHuman) && Object.isFrozen(schema.humanChoice));
});

test('L3: the Claude adapter flags its question call and its plan approval, and nothing else', async (t) => {
  const { session } = await load(t, [humanAsk('Add a flag to the CLI in src/cli.js.'),
    call('p1', 'ExitPlanMode', { plan: 'Add the flag.' }), result('p1', 'User has approved your plan.'),
    call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'), result('q1', 'interrupted', undefined, true),
    call('e1', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [];', new_string: 'const flags = [1];' }),
    result('e1', 'The file /repo/src/cli.js has been updated successfully.'), said('Added the flag.')]);
  assert.equal(session.adapter, 'claude');
  assert.deepEqual(flagged(session), [['ExitPlanMode', false, true], ['AskUserQuestion', true, false], ['edit', false, false]]);
  assert.deepEqual(unknownGaps(session), []);
});

test('L3: the Codex adapter flags its own question tool by its own schema', async (t) => {
  const rows = codexRows();
  const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });
  rows.splice(3, 0, rollout({ type: 'function_call', name: 'request_user_input_async', call_id: 'q1',
    arguments: JSON.stringify({ questions: [{ question: 'Which target?' }] }) }),
  rollout({ type: 'function_call_output', call_id: 'q1', output: '{"accepted":true}' }));
  const { session } = await load(t, rows, { name: CODEX_NAME });
  assert.equal(session.adapter, 'codex');
  const question = session.events.find((event) => event.kind === 'invocation' && event.tool === 'request_user_input_async');
  assert.ok(question, 'the question call is an action of the session');
  assert.equal(question.asksHuman, true);
  assert.equal(session.events.filter(asksHuman).length, 1);
  assert.equal(session.events.filter(humanChoice).length, 0, 'Codex records no human-choice tool');
  assert.deepEqual(unknownGaps(session), []);
});

test('L3: a recorder whose schema the adapter does not know leaves the flags unset and declares it, failing closed',
  async (t) => {
    const rows = [humanAsk('Write the parser in src/parser.js.'),
      call('q1', 'AskUserQuestion', { questions: [QUESTION] }, 'One question first.'), result('q1', 'interrupted', undefined, true),
      call('e1', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [];', new_string: 'const flags = [1];' }),
      result('e1', 'The file /repo/src/cli.js has been updated successfully.'), said('Done.')];
    const { ledger, session: claude } = await load(t, rows);
    const complete = (session) => planWindows(session)
      .map((window) => instructionReviewScope(session, { upTo: windowEnd(window) }).complete);
    assert.deepEqual(unknownGaps(claude), []);
    // The same ledger, its source read by a recorder this adapter has no human-interaction schema for.
    const other = sessionFromLedger({ ...ledger, sources: ledger.sources.map((source) => ({ ...source, adapter: 'cursor' })) },
      { sessionKey: 'm33-l3' });
    assert.equal(other.adapter, 'cursor');
    assert.equal(other.events.filter((event) => asksHuman(event) || humanChoice(event)).length, 0, 'never a guessed flag');
    const actions = other.events.filter((event) => event.kind === 'invocation' && event.childId == null).length;
    assert.deepEqual(unknownGaps(other).map(({ code, channel, scope, count, eventIds, note }) =>
      ({ code, channel, scope, count, eventIds, note })), [{ code: 'incomplete_inventory', channel: 'instructions',
      scope: 'session', count: actions, eventIds: undefined, note: HUMAN_INTERACTION_UNKNOWN_NOTE }]);
    // Unlocated: no history is complete at any bound, so no decision is `unasked` and no forbidden edit is asked.
    assert.ok(complete(claude).some(Boolean), 'premise: the Claude reading certifies a history');
    assert.ok(complete(other).every((value) => value === false));
    assert.equal(humanInstructionsBetween(other, 0, other.events.length).complete, false);
  });

// ---- M33 brittleness L3 review: the unknown-schema gap is named as itself, never as elided instructions ----------------

test('L3 review: a recorder with no known schema is named as that in the header, never as elided instructions',
  async (t) => {
    const rows = [humanAsk('Write the parser in src/parser.js.'),
      call('e1', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [];', new_string: 'const flags = [1];' }),
      result('e1', 'The file /repo/src/cli.js has been updated successfully.'),
      call('e2', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [1];', new_string: 'const flags = [2];' }),
      result('e2', 'The file /repo/src/cli.js has been updated successfully.'), said('Done.')];
    const { ledger } = await load(t, rows);
    const other = sessionFromLedger({ ...ledger, sources: ledger.sources.map((source) => ({ ...source, adapter: 'cursor' })) },
      { sessionKey: 'm33-l3' });
    const actions = other.events.filter((event) => event.kind === 'invocation' && event.childId == null).length;
    assert.ok(actions >= 2, 'premise: more actions than instructions');
    assert.equal(other.events.filter((event) => event.kind === 'instruction' && event.omitted === true).length, 0,
      'premise: nothing was elided');
    const judge = async (request) => (request.challenge ? { votes: [] }
      : { decisions: [], pivots: [], claims: [], requirements: [] });
    const report = await runReview({ session: other, pr: null, reviewScope: 'session-only', judge });
    const causes = coverageCauses(report);
    assert.deepEqual(causes.filter(([cause]) => cause.startsWith('instructions_')), [], 'no instruction was elided');
    assert.deepEqual(causes.find(([cause]) => cause === 'human_interaction_unknown'), ['human_interaction_unknown',
      { n: actions }]);
    assert.equal(COVERAGE_SENTENCE.human_interaction_unknown({ n: actions }),
      'the format of the recorder does not say which actions asked you a question or kept your answer');
    // Still a declared loss: the session is never certified complete on it (fail closed).
    assert.notEqual(report.coverage, 'complete');
  });
