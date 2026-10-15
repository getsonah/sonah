// M33 brittleness L3 review: a question call whose answer no human instruction carries (`answerTo`) holds the human's
// answer only in its own recorded result. Codex records every answer that way (its request_user_input result is never
// read into the instruction history), so a forbidden edit after "May I remove it?" / "Yes, remove it." was asked of the
// challengers with nothing naming that answer — and, in a dossier profile, without the answer shown at all. Such a call
// is now named between the two events (`humanChoicesBetween`), shown whole with its result in every profile, and the
// edit is withheld `history_partial` whenever it was not shown. Structure only: which action asked, and whether any
// instruction answers it; never what the answer says.
//
// M34 labels (merged into M33 integration; M34 labels review F4): the slicer now labels a synchronous Codex
// `request_user_input` output the human's `answer`, linked to its call, and — its output being the recorder's text with
// no typed answer field — declares that answer unread at the call (`humanAnswerUnresolved`, the adapter's located
// UNREAD_ANSWER_NOTE gap), exactly as a Claude Code question's unread answer is. That located loss makes the history
// between the rule and the edit incomplete, so the edit is withheld `history_partial` and never asked: nothing is
// published DECIDE (L3's intent) and no history is certified complete without the human's answer (F4's). L3's naming is
// kept and still exercised: the same ledger with that one flag set aside (as M33 integration adapted it before the
// merge) is named, shown and judged exactly as before.
//
// Every row is synthetic. No real recording is read; no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, UNREAD_ANSWER_NOTE } from '../adapters/sonah-ledger.js';
import { Session } from '../src/session.js';
import { asksHuman, humanChoice } from '../src/ledger.js';
import * as forbidden from '../src/forbidden.js';
import * as reviewRun from '../src/run-review.js';

const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });
const ASK = 'Tidy docs/legacy.md. Do not remove the SYNTHETIC_L3_LEGACY_NOTE line.';
const CONSTRAINT = 'Do not remove the SYNTHETIC_L3_LEGACY_NOTE line.';
const NOTE = 'SYNTHETIC_L3_LEGACY_NOTE stays here.';
const ANSWER = 'Yes, remove it.';

/** The human's rule, the agent's question and the human's answer in its result, then a patch that removes the line. */
function codexRows() {
  return [
    { type: 'session_meta', payload: { id: 'codex-l3-q-0001', cwd: '/repo', cli_version: '0.117.0' } },
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: ASK }] }),
    rollout({ type: 'function_call', name: 'request_user_input', call_id: 'q1',
      arguments: JSON.stringify({ questions: [{ question: 'May I remove the legacy note?' }] }) }),
    rollout({ type: 'function_call_output', call_id: 'q1', output: ANSWER }),
    rollout({ type: 'custom_tool_call', name: 'apply_patch', call_id: 'p1', input: ['*** Begin Patch',
      '*** Update File: docs/legacy.md', '@@', ' Intro line.', `-${NOTE}`, ' Outro line.', '*** End Patch'].join('\n') }),
    rollout({ type: 'custom_tool_call_output', call_id: 'p1',
      output: 'Exit code: 0\nWall time: 0.1 seconds\nOutput:\nSuccess. Updated the following files:\nM docs/legacy.md\n' }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tidied the docs.' }] }),
  ];
}

/** `unreadAnswerSetAside`: the ledger with every action's `humanAnswerUnresolved` taken out before it is redacted and
 *  adapted — the slicer's F4 declaration set aside, so L3's naming path is read on the same rows. */
async function load(t, rows, { unreadAnswerSetAside = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-l3-q-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-01T00-00-00-codex-l3-q-0001.jsonl');
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo', includeSources: true });
  if (unreadAnswerSetAside) for (const event of raw.ledger) delete event.humanAnswerUnresolved;
  return sessionFromLedger(redact(raw).ledger, { sessionKey: 'm33-l3-q' });
}
const unreadAt = (session) => session.adapterGaps.filter((gap) => gap.note === UNREAD_ANSWER_NOTE)
  .flatMap((gap) => gap.eventIds ?? []);
const receipt = (eventId, role, quote) => ({ eventId, role, quote });
const sourceMap = (session) => Object.fromEntries(session.events.map((e) => [e.id, session.sourcesFor(e)]));

function shapeOf(session) {
  const question = session.events.find((e) => e.kind === 'invocation' && asksHuman(e));
  const patch = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const proposal = { text: 'SYNTHETIC_L3: the human kept the note; the agent removed it.',
    instruction: receipt(ask.id, 'instruction', CONSTRAINT), violation: receipt(patch.id, 'code', NOTE) };
  return { question, patch, ask, proposal };
}

test('L3 review + M34 labels F4: a Codex question no instruction answers is named; its unread answer withholds the edit',
  async (t) => {
  const merged = await load(t, codexRows());
  {
    const { question, patch, ask, proposal } = shapeOf(merged);
    assert.equal(merged.adapter, 'codex');
    assert.ok(question && asksHuman(question) && !humanChoice(question));
    assert.equal(merged.events.filter((e) => e.kind === 'instruction' && e.answerTo === question.id).length, 0);
    // F4: the answer is declared unread at its call — located there, so a loss for every bound that reaches it.
    assert.deepEqual(unreadAt(merged), [question.id]);
    assert.deepEqual(forbidden.humanChoicesBetween(merged, ask.sequence, patch.sequence), [question.id]);
    assert.equal(forbidden.humanInstructionsBetween(merged, ask.sequence, patch.sequence).complete, false);
    // Shown whole or not, the edit is never asked without the human's answer read.
    assert.deepEqual(forbidden.readForbiddenEdit(proposal, { session: merged, sourceMap: sourceMap(merged) }),
      { withheld: 'history_partial' });
  }
  // L3's naming, on the same rows with F4's declaration set aside.
  const session = await load(t, codexRows(), { unreadAnswerSetAside: true });
  const { question, patch, ask, proposal } = shapeOf(session);
  // Premises: the adapter's flag, no instruction carries the answer, and the edit landed as a removal.
  assert.equal(session.adapter, 'codex');
  assert.deepEqual(unreadAt(session), [], 'premise: no unread answer declared');
  assert.ok(question && asksHuman(question) && !humanChoice(question));
  assert.equal(session.events.filter((e) => e.kind === 'instruction' && e.answerTo === question.id).length, 0);
  assert.ok(ask.sequence < question.sequence && question.sequence < patch.sequence);
  assert.equal(session.actionOutcomeOf(patch), 'succeeded');
  assert.deepEqual(forbidden.humanChoicesBetween(session, ask.sequence, patch.sequence), [question.id]);
  const { edit } = forbidden.readForbiddenEdit(proposal, { session, sourceMap: sourceMap(session) });
  assert.equal(edit.breach, 'removed');
  assert.deepEqual(edit.between, []);
  assert.deepEqual(edit.choices, [question.id], 'the answer is named for the challengers');
  // Not shown to the window, with or without its result: withheld, never asked without it.
  const map = sourceMap(session);
  const result = session.events.find((e) => e.kind === 'observation' && e.invocation === question.id);
  for (const hidden of [question.id, result.id]) {
    const { [hidden]: _gone, ...shown } = map;
    assert.deepEqual(forbidden.readForbiddenEdit(proposal, { session, sourceMap: shown }), { withheld: 'history_partial' },
      hidden);
  }
});

test('L3 review: a question an instruction answers is not named again; its answer is a named instruction', () => {
  const blobs = { ask: ASK, note: `${NOTE}\n`, answer: ANSWER, q: 'May I remove the legacy note?' };
  const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const events = (answered) => [
    { id: 'I1', kind: 'instruction', authority: 'human', supersedes: [], text: whole('ask'), turn: 'T1' },
    { id: 'Q1', kind: 'invocation', callKey: 'Q1', tool: 'AskUserQuestion', operation: 'other', asksHuman: true,
      paths: [], command: [], input: whole('q'), changes: [], turn: 'T1' },
    ...(answered ? [{ id: 'I2', kind: 'instruction', authority: 'human', supersedes: [], text: whole('answer'),
      answerTo: 'Q1', turn: 'T1' }] : []),
    { id: 'A1', kind: 'invocation', callKey: 'A1', tool: 'edit', operation: 'edit', paths: [], command: [], input: [],
      changes: [], turn: 'T1' },
  ].map((event, sequence) => ({ ...event, sequence }));
  const answered = new Session({ sessionKey: 'm33-l3-q', blobs, events: events(true) });
  assert.deepEqual(forbidden.humanChoicesBetween(answered, 0, 3), []);
  assert.deepEqual(forbidden.humanInstructionsBetween(answered, 0, 3).ids, ['I2']);
  const unanswered = new Session({ sessionKey: 'm33-l3-q', blobs, events: events(false) });
  assert.deepEqual(forbidden.humanChoicesBetween(unanswered, 0, 2), ['Q1']);
  // A helper's question is no root action, and the human's choice flag still names its action as before.
  const helper = new Session({ sessionKey: 'm33-l3-q', blobs,
    events: events(false).map((e) => (e.id === 'Q1' ? { ...e, childId: 'h1' } : e)) });
  assert.deepEqual(forbidden.humanChoicesBetween(helper, 0, 2), []);
});

/** Upholds every item unless the challenge request it is sent shows the human's answer; then refutes, citing it. */
const judgeOf = (proposal, seen) => async (request) => {
  seen.push(request);
  if (request.challenge) return { votes: request.challenge.items.map((item) => (request.prompt.includes(ANSWER)
    ? { key: item.key, verdict: 'refuted', explanation: 'Synthetic: the human allowed it.', receipts: [] }
    : { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic: ruled out.', receipts: [item.candidate.violation] })) };
  const asked = `${request.system}${request.prompt}`.includes('"forbiddenEdits"');
  return { decisions: [], pivots: [], claims: [], requirements: [], ...(asked ? { forbiddenEdits: [proposal] } : {}) };
};

test('L3 review: in every profile the forbidden run is shown the human\'s answer, and nothing is published DECIDE',
  async (t) => {
    // M34 labels F4 (merged): with the answer declared unread at its call, no profile asks the edit at all — it is
    // withheld `history_partial` — and nothing is published DECIDE.
    const merged = await load(t, codexRows());
    for (const profile of [null, 'm33-fast', 'm33-lean']) {
      const seen = [];
      const report = await reviewRun.runReview({ session: merged, pr: null, reviewScope: 'session-only',
        ...(profile ? { speedProfile: profile } : {}), judge: judgeOf(shapeOf(merged).proposal, seen) });
      assert.deepEqual(seen.filter((r) => r.challenge && r.label.includes(':forbidden')), [], `${profile}: never asked`);
      assert.equal(report.counts.forbiddenEdits.withheld.history_partial, 1, String(profile));
      assert.deepEqual(report.findings.filter((f) => f.kind === 'edit_under_negative_requirement'), [], String(profile));
    }
    // L3's profiles, on the same rows with F4's declaration set aside.
    const session = await load(t, codexRows(), { unreadAnswerSetAside: true });
    const { question, proposal } = shapeOf(session);
    for (const profile of [null, 'm33-fast', 'm33-lean']) {
      const seen = [];
      const report = await reviewRun.runReview({ session, pr: null, reviewScope: 'session-only',
        ...(profile ? { speedProfile: profile } : {}), judge: judgeOf(proposal, seen) });
      const sent = seen.filter((r) => r.challenge && r.label.includes(':forbidden'));
      assert.ok(sent.length > 0, `${profile}: the edit was asked`);
      for (const request of sent) {
        assert.deepEqual(request.challenge.items[0].candidate.humanChoicesBetween, [question.id], String(profile));
        assert.ok(request.prompt.includes(ANSWER), `${profile}: the answer is in the evidence sent`);
      }
      assert.deepEqual(report.findings.filter((f) => f.kind === 'edit_under_negative_requirement'), [], String(profile));
    }
  });
