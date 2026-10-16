// OWNER DECISION B (2026-10-01): the human's own words recorded inside a Claude Code turn are human instructions.
//
//   - A prompt the human queued while the agent worked (a `queued_command` attachment of mode `prompt`, on the main
//     thread, its origin absent or the human's, not a meta row) is read at its recorded row: its turn, the actions
//     recorded before it (`beforeEvent`, as commentary is placed), its stream and record.
//   - An AskUserQuestion answer is read from the call's typed answer sidecar — exactly `{questions, answers}`, the
//     call's own recorded questions, one non-empty answer per question, each shown in the result the agent read — at
//     the result's row, one instruction per answer, the answer text only. The call is named by its recorded turn and seq.
//   - Harness-injected context is never an instruction: HARNESS_BLOCK and the closed harness-context tags
//     (`isHarnessContext`) apply as they do to a user row; no opening words decide one (H2 review).
//   - Anything not read keeps the declaration it had: a queued prompt stays a counted unsupported instructions row
//     (unless its label gives it to the harness with no gap: release fix 3b, harness context), and an answer stays
//     `humanAnswerUnresolved`. The capture counts are unchanged either way — the other readers of the
//     ledger read `ask` only, so for them a queued prompt is still unread.
//   - Both are scrubbed whole by redaction exactly as an ask is, before any cut.
//
// Every row is synthetic (packages/evidence/test/m33-u-unasked-fixture.js). No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeRows, codexRows, load, queued, user, call, result, said, answeredText, QUESTION, ANSWER, QUEUED,
  CODEX_NAME } from '../../evidence/test/m33-u-unasked-fixture.js';
import { ASK_OMISSION, sliceHash } from '../../redact/index.js';

const GH = ['gh', 'p_', 'W3e3SplitToken', 'AbcdefGhij', 'KlmnPqrs12', '3456'].join('');

test('U a queued prompt is a human instruction at its recorded row; the capture still counts it for ask-only readers', async (t) => {
  const { raw } = await load(t, claudeRows({ queuedPrompt: QUEUED }));
  assert.deepEqual(raw.interjections.map(({ identity, ...entry }) => entry),
    [{ turn: 1, kind: 'queued', beforeEvent: 1, source: 0, record: 4, text: QUEUED }]);
  // C-01 event identity: named by its own row (its recorded uuid) and block.
  assert.deepEqual(raw.interjections.map(({ identity }) => identity),
    [{ stream: 0, record: 4, block: 0, native: 'u-claude-4' }]);
  assert.deepEqual(raw.ask.map((a) => a.turn), [1, 2], 'no new turn: the agent kept working under the same request');
  assert.equal(raw.capture.unsupportedRowChannels.instructions, 1);
  // With a rendered human turn it is read the same way; M34 labels: with no origin recorded only on a recorder that types
  // none (the declared legacy fallback) — on a typed recorder a queued prompt with no origin is not provably the human's.
  for (const [payload, extra] of [[{}, { version: '2.1.170' }], [{ origin: { kind: 'human' }, source_uuid: 'u-x',
    timestamp: 'x' }, { renderedInHumanTurn: [{ content: QUEUED }], rendered: [{ content: QUEUED }] }]]) {
    const again = await load(t, claudeRows({ queuedPrompt: QUEUED, queuedPayload: payload, queuedExtra: extra }));
    assert.deepEqual(again.raw.interjections.map((i) => i.text), [QUEUED], JSON.stringify(payload));
  }
  const untyped = await load(t, claudeRows({ queuedPrompt: QUEUED, queuedPayload: {} }));
  assert.equal(untyped.raw.interjections, undefined);
});

test('H2 review (H2-uncounted-wording): no opening words decide a queued prompt, so none is refused uncounted', async (t) => {
  // The declared fallback's and Codex's openings refused no queued prompt; a human's queued words that open
  // the same way are read, never dropped by wording.
  for (const prompt of ['[Request interrupted by user] then also fix the lexer.',
    '# AGENTS.md instructions from the Codex repo: port these to CLAUDE.md.', 'You are Codex, based on GPT: explain this.']) {
    const { raw } = await load(t, claudeRows({ queuedPrompt: prompt }));
    assert.deepEqual(raw.interjections.map((i) => i.text), [prompt], prompt);
    assert.equal(Object.hasOwn(raw.capture, 'instructionsActorByOpening'), false);
  }
});

test('U harness context, meta rows, another origin or another agent\'s row are never read as an instruction', async (t) => {
  // M34 labels (C-02 "Slice-time labels"): the row's typed fields decide, never its words. A prompt the host typed the
  // human's is the human's, whatever it holds (a block is labelled whole), so these are read:
  for (const [prompt, payload] of [['<system-reminder>The date changed.</system-reminder>', { origin: { kind: 'human' } }],
    [QUEUED, { origin: { kind: 'human', extra: 1 } }]]) {
    const { raw } = await load(t, claudeRows({ queuedPrompt: prompt, queuedPayload: payload }));
    assert.deepEqual(raw.interjections.map((i) => i.text), [prompt], `${prompt} ${JSON.stringify(payload)}`);
  }
  // Release fix 3b (2026-10-12): a row the labeller gives to the harness (no origin on a typed recorder, a meta row) is
  // harness context, no declared loss; one labelled an observation or left unlabelled keeps its declared loss.
  const cases = [
    ['<environment_context>cwd</environment_context>', {}, 0],
    ['<command-name>/clear</command-name>', {}, 0],
    ['[SYSTEM NOTIFICATION - NOT USER INPUT] a task finished', {}, 0],
    ['   ', {}, 0],
    [QUEUED, { isMeta: true }, 0],
    [QUEUED, { origin: { kind: 'task-notification' } }, 1],
    [QUEUED, { origin: 'human' }, 1],
  ];
  for (const [prompt, payload, declared] of cases) {
    const { raw } = await load(t, claudeRows({ queuedPrompt: prompt, queuedPayload: payload }));
    assert.equal(raw.interjections, undefined, `${prompt} ${JSON.stringify(payload)}`);
    assert.equal(raw.capture?.unsupportedRowChannels?.instructions ?? 0, declared,
      `${prompt} ${JSON.stringify(payload)}`);
  }
  // A helper's row (a sidechain row of a child recording) is never the human's.
  const child = await load(t, [user('Brief.', { isSidechain: true, agentId: 'a0123456789abcdef' }),
    queued(QUEUED, {}, { isSidechain: true, agentId: 'a0123456789abcdef' })]);
  assert.equal(child.raw.interjections, undefined);
});

test('U an AskUserQuestion answer is read from its typed sidecar, the answer only, at the result\'s row', async (t) => {
  const { raw } = await load(t, claudeRows({ ask: true }));
  assert.deepEqual(raw.interjections.map(({ identity, ...entry }) => entry),
    [{ turn: 2, kind: 'answer', beforeEvent: 3, source: 0, record: 10, text: ANSWER, call: { turn: 2, seq: 0 } }]);
  // C-01 event identity: the first answer of its result block, named by the result row's uuid.
  assert.deepEqual(raw.interjections.map(({ identity }) => identity),
    [{ stream: 0, record: 10, block: 0, native: 'u-claude-10', sub: 'a0' }]);
  const asked = raw.ledger.find((e) => e.tool === 'AskUserQuestion');
  assert.equal(asked.humanAnswerUnresolved, undefined, 'incorporated, so not unresolved');
  // Two questions: one instruction per answer, in the call's order.
  const second = { ...QUESTION, question: 'Should the flag be documented?', header: 'Docs' };
  const rows = [user('Add the flag.'),
    call('q2', 'AskUserQuestion', { questions: [QUESTION, second] }),
    result('q2', answeredText([[QUESTION.question, ANSWER], [second.question, 'Yes, in the README']]),
      { questions: [QUESTION, second], answers: { [second.question]: 'Yes, in the README', [QUESTION.question]: ANSWER } }),
    said('Done.')];
  const two = await load(t, rows);
  assert.deepEqual(two.raw.interjections.map((i) => [i.text, i.call.seq, i.record]), [[ANSWER, 0, 3], ['Yes, in the README', 0, 3]]);
});

test('U an answer that is not exactly the typed record of this call stays unresolved, never guessed', async (t) => {
  const questions = [QUESTION];
  const sidecars = [
    null,
    { questions, answers: { [QUESTION.question]: ANSWER }, annotations: { [QUESTION.question]: { notes: 'x' } } },
    { questions, answers: { 'Another question?': ANSWER } },
    { questions, answers: {} },
    { questions, answers: { [QUESTION.question]: '' } },
    { questions, answers: { [QUESTION.question]: 3 } },
    { questions: [{ ...QUESTION, question: 'Something else?' }], answers: { [QUESTION.question]: ANSWER } },
    { answers: { [QUESTION.question]: ANSWER } },
    { questions, answers: { [QUESTION.question]: 'an answer the agent was never shown' } },
    [{ questions, answers: { [QUESTION.question]: ANSWER } }],
  ];
  for (const sidecar of sidecars) {
    const { raw } = await load(t, claudeRows({ ask: true, sidecar }));
    assert.equal(raw.interjections, undefined, JSON.stringify(sidecar));
    assert.equal(raw.ledger.find((e) => e.tool === 'AskUserQuestion').humanAnswerUnresolved, true, JSON.stringify(sidecar));
  }
  // A second, different result row for the same call retracts the first: neither is an answer.
  const rows = claudeRows({ ask: true });
  const at = rows.findIndex((r) => r.toolUseResult?.answers);
  rows.splice(at + 1, 0, result('q1', answeredText([[QUESTION.question, '--safe']]),
    { questions, answers: { [QUESTION.question]: '--safe' } }));
  const { raw } = await load(t, rows);
  assert.equal(raw.interjections, undefined);
});

test('U, D90 what a queued prompt or an answer says is kept as recorded and never cut, exactly as an ask', async (t) => {
  const secret = `Use the token ${GH} for the registry.`;
  const { ledger } = await load(t, claudeRows({ queuedPrompt: secret }));
  assert.equal(ledger.interjections[0].text, secret);
  assert.equal(ledger.interjections[0].redacted, undefined);
  const answer = await load(t, claudeRows({ ask: true, sidecar: { questions: [QUESTION], answers: { [QUESTION.question]: secret } } }).map(
    (r) => (r.message?.content?.[0]?.tool_use_id === 'q1' ? { ...r, message: { ...r.message, content: [{ ...r.message.content[0],
      content: answeredText([[QUESTION.question, secret]]) }] } } : r)));
  assert.ok(answer.ledger.interjections[0].text.includes(secret));
  // Windowing (M35): over the retired ask budget, a queued prompt is kept in full — never cut.
  const long = `${secret}\n${'Keep the parser small. '.repeat(1200)}\nEnd of the queued note.`;
  const whole = await load(t, claudeRows({ queuedPrompt: long }));
  assert.equal(Object.hasOwn(whole.raw.interjections[0], 'elided'), false);
  assert.ok(!whole.ledger.interjections[0].text.includes(ASK_OMISSION));
  assert.ok(whole.ledger.interjections[0].text.endsWith('End of the queued note.'));
  assert.ok(whole.ledger.interjections[0].text.startsWith(secret));
});

test('U a recording with neither shape keeps its ledger bytes: no interjections member at all', async (t) => {
  for (const [rows, options] of [[claudeRows(), {}], [claudeRows({ ask: true, sidecar: null }), {}],
    [codexRows(), { name: CODEX_NAME }]]) {
    const { raw } = await load(t, rows, options);
    assert.equal(Object.hasOwn(raw, 'interjections'), false);
  }
  // What the human said mid-turn is session content: it moves the session's hash; an empty list is no content.
  const { ledger } = await load(t, claudeRows({ queuedPrompt: QUEUED }));
  const without = structuredClone(ledger);
  delete without.interjections;
  assert.notEqual(sliceHash(ledger), sliceHash(without));
  assert.equal(sliceHash({ ...without, interjections: [] }), sliceHash(without));
});
