// OWNER DECISION B (2026-10-01), end to end on a synthetic Claude Code recording: "decided without asking you" (the
// `unasked` column) can fire. The human queued a long prompt mid-turn that Sonah capped before review, so the window's
// instruction scope is incomplete as a whole; the window's request says which decisions it is still complete for, a
// decision before the capped prompt is certified `unasked` against the asks before it, and one after it never is.
// The judge is a table, never a model; every byte is synthetic (m33-u-unasked-fixture.js). The column is neutral: no
// finding is made of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runReview } from '../src/run-review.js';
import { claudeRows, load, QUEUED, named, labelOf, beforeStableIds } from './m33-u-unasked-fixture.js';
import { readingStableIds } from './m35-windows-fixture.js';

const ASK = 'Write the parser in src/parser.js.';
const DIMENSION = 'SYNTHETIC_U_DIMENSION: how the module is exported';
const digestOf = (prompt) => /^scopeDigest: (\S+)$/m.exec(prompt)?.[1] ?? null;
const check = (eventId, quote) => ({ instruction: { eventId, role: 'instruction', quote }, relevant: false,
  explanation: 'SYNTHETIC: this instruction does not touch how the module is exported.' });
const decision = (action, value, field, stated, checks, scopeDigest) => ({ dimension: DIMENSION, chosen: `Use ${value}`,
  actions: [action], value, valueReceipt: { eventId: action, role: 'action', field, quote: value }, stated, constrainedBy: null,
  instructionReview: { dimension: DIMENSION, scopeDigest, noRelevantInstruction: true, checks } });

// C-01 event identity: the table judge names each event by its positional label in `session` (`named`).
function judge(session, asked = []) {
  const id = (label) => named(session, label);
  return async (request) => {
    asked.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'SYNTHETIC: the record shows it.', receipts: [{ eventId: id('I1'), role: 'instruction', quote: ASK }] })) };
    const empty = { decisions: [], pivots: [], claims: [], requirements: [] };
    if (!/:w1(?::|$)/.test(request.label ?? '')) return empty;
    const scopeDigest = digestOf(request.prompt);
    return { ...empty, decisions: [
      decision(id('A1-0'), 'src/parser.js', 'path', { eventId: id('C1-0-1'), role: 'commentary', quote: 'Writing the parser now.' },
        [check(id('I1'), ASK)], scopeDigest),
      decision(id('A1-1'), 'node --test', 'command', null, [check(id('I1'), ASK), check(id('I1-1'), QUEUED)], scopeDigest),
    ] };
  };
}

test('U a capped queued prompt leaves decisions before it certifiable as unasked, and those after it unchecked', async (t) => {
  const long = `${QUEUED}\n${'Keep the parser small. '.repeat(1200)}`;
  const { session } = await load(t, claudeRows({ queuedPrompt: long }), { legacyCap: true });
  const asked = [];
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', // M35 windowing: the table judge reads its request with its window's aliases written back (`readingStableIds`).
  judge: readingStableIds(session, judge(session, asked)) });
  const narrative = asked.find((request) => !request.challenge && /:w1(?::|$)/.test(request.label ?? ''));
  // M33 U repair: complete AT the earliest action too, so the range ends just before the capped prompt (sequence 4).
  assert.match(narrative.prompt, /^complete: false\ncompleteFor: earliest action sequence 1 through 3$/m);
  assert.match(beforeStableIds(session, narrative.prompt), /^\[I1-1\] HUMAN INSTRUCTION · authority=human · sequence=4 · role=instruction · queued while the agent was working$/m);
  const byAction = Object.fromEntries(report.decisions.map((d) => [labelOf(session, d.actions[0]), d]));
  assert.equal(byAction['A1-0'].column, 'unasked', 'recorded before the capped prompt: certified');
  assert.equal(byAction['A1-0'].columnState, 'grounded');
  assert.equal(byAction['A1-1'].column, null, 'recorded after it: never certified');
  assert.deepEqual(byAction['A1-1'].reasons, ['instructions_partial']);
  // The column is neutral: nothing about it became a finding.
  assert.deepEqual(report.findings, []);
});
