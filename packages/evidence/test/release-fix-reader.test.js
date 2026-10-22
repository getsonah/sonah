// Release fix 3 (2026-10-12): read more of the person's messages.
//   3b  A recording row the reader did not support is read by its type and fields, so the reader knows whether it
//       carries the person's input: the recorder's turn-limit notice is harness context; an instructions-class
//       attachment the labeller gives to the harness (a file restored after a compaction, a reference to one, a
//       queued command the recorder flagged `isMeta`) is harness context, never an instructions loss. A row labelled
//       the human's or a peer's, or one whose label carries a gap (a legacy recorder's), keeps its declaration.
//   3c  The person's answer to a question that let them choose several options (`multiSelect`) is read from the
//       recorder's typed list: each chosen option is a human instruction answering the question. Anything else keeps
//       the answer declared unread.
// Every row is synthetic (invented asks, paths, questions and options); no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, row, humanAsk, call, result, said, answeredText } from './m33-u-unasked-fixture.js';
import { claudeRowClass, CLAUDE_ROW_CLASSES } from '../../slicer/src/records.js';
import { instructionReviewScope, decisionInstructionHistoryComplete } from '../src/ledger.js';
import { UNREAD_ANSWER_NOTE } from '../adapters/sonah-ledger.js';

const attachment = (payload, extra = {}) => row({ type: 'attachment', attachment: payload, ...extra });
const edit = (id) => [
  call(id, 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [];',
    new_string: 'const flags = [1];' }),
  result(id, 'The file /repo/src/cli.js has been updated successfully.'),
];
const gapsOn = (session, channel) => session.adapterGaps.filter((gap) => gap.channel === channel);

test('3b: the turn-limit notice is harness context; with an extra field it stays unclassified (fail closed)',
  async (t) => {
    const notice = attachment({ type: 'max_turns_reached', maxTurns: 3, turnCount: 3 });
    assert.equal(claudeRowClass(notice).cls, CLAUDE_ROW_CLASSES.harness);
    // D128: an extra field that can hold session content (words) keeps it unclassified; one of a token is read by its
    // structure.
    assert.equal(claudeRowClass(attachment({ type: 'max_turns_reached', maxTurns: 3, turnCount: 3,
      note: 'a note in words' })), null);
    assert.equal(claudeRowClass(attachment({ type: 'max_turns_reached', maxTurns: 3, turnCount: 3, note: 'x' }))?.structural,
      'attachment.max_turns_reached');
    const { raw, session } = await load(t, [humanAsk('Add a flag to src/cli.js.'), ...edit('e1'), notice]);
    assert.equal(raw.capture?.unclassifiedRows ?? 0, 0);
    assert.ok(raw.capture.harnessContextRows >= 1, 'counted as harness context');
    assert.deepEqual(gapsOn(session, 'identity'), []);
    assert.equal(instructionReviewScope(session).complete, true);
  });

test('3b: files the recorder restored after a compaction, a reference to one and a queued command it flagged isMeta '
  + 'are harness context, never an instructions loss', async (t) => {
  const prompt = humanAsk('Add a flag to src/cli.js.', { uuid: 'u-rs-ask' });
  const summary = row({ type: 'user', uuid: 'u-rs-sum', isCompactSummary: true, isVisibleInTranscriptOnly: true,
    message: { role: 'user', content: 'Summary of earlier work.' } });
  const rows = [prompt, said('Reading first.'),
    row({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: 'u-rs-cb' }), summary,
    attachment({ type: 'file', filename: '/repo/src/cli.js', displayPath: 'src/cli.js', content: 'restored text' },
      { uuid: 'u-rs-f', parentUuid: summary.uuid }),
    attachment({ type: 'compact_file_reference', filename: '/repo/src/old.js', displayPath: 'src/old.js' },
      { uuid: 'u-rs-r', parentUuid: 'u-rs-f' }),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'A reminder the recorder wrote.',
      isMeta: true }, { uuid: 'u-rs-q' }),
    ...edit('e1'), said('Added the flag.')];
  const { raw, session } = await load(t, rows);
  assert.equal(raw.capture?.unsupportedRowChannels?.instructions ?? 0, 0);
  assert.equal(raw.capture?.incomplete ?? false, false, 'no loss is declared for them');
  assert.ok(raw.capture.harnessContextRows >= 3);
  assert.deepEqual(gapsOn(session, 'instructions').filter((gap) => gap.code === 'unsupported_message'), []);
  assert.equal(session.events.filter((e) => e.kind === 'instruction').length, 1, 'none of them is read as an ask');
  assert.equal(instructionReviewScope(session).complete, true);
});

test('3b: an attachment the human gave keeps its place: a mentioned file is read, a PDF and a peer\'s queued message '
  + 'stay declared', async (t) => {
  const prompt = humanAsk('Add a flag to src/cli.js.', { uuid: 'u-hk-ask' });
  const rows = [prompt,
    attachment({ type: 'file', filename: '/repo/SPEC.md', displayPath: 'SPEC.md', content: 'The spec text.' },
      { uuid: 'u-hk-f', parentUuid: prompt.uuid }),
    attachment({ type: 'pdf_reference', filename: '/repo/spec.pdf', displayPath: 'spec.pdf', fileSize: 10,
      pageCount: 1 }, { uuid: 'u-hk-p', parentUuid: 'u-hk-f' }),
    said('Reading it.'),
    attachment({ type: 'queued_command', commandMode: 'prompt', prompt: 'A message from another agent.',
      origin: { kind: 'peer' } }, { uuid: 'u-hk-q' }),
    ...edit('e1'), said('Added the flag.')];
  const { session } = await load(t, rows);
  const read = session.events.filter((e) => e.kind === 'instruction' && (e.markers ?? []).includes('attached'));
  assert.equal(read.length, 1, 'the mentioned file is read as the human\'s');
  const declared = gapsOn(session, 'instructions').filter((gap) => gap.code === 'unsupported_message');
  assert.deepEqual(declared.map((gap) => gap.count), [2], 'the PDF (no text) and the peer\'s message');
  assert.equal(instructionReviewScope(session).complete, false);
});

test('3b: a queued prompt of tag elements with no origin is harness context on a typed recorder; on a legacy one its '
  + 'label carries a gap, so it stays a declared instructions loss (fail closed)', async (t) => {
  // The labeller gives both to the harness; only the legacy recorder's (before 2.1.219, the declared fallback) carries
  // the `legacy_recorder` gap, so only it keeps its declaration (the row's version alone differs).
  const rowsAt = (extra) => [humanAsk('Add a flag to src/cli.js.'), said('Reading first.'),
    attachment({ type: 'queued_command', commandMode: 'prompt',
      prompt: '<teammate-message teammate_id="planner">Use the v2 API.</teammate-message>' }, extra),
    ...edit('e1'), said('Added the flag.')];
  const typed = await load(t, rowsAt({}));
  assert.equal(typed.raw.capture?.unsupportedRowChannels?.instructions ?? 0, 0);
  assert.equal(instructionReviewScope(typed.session).complete, true);
  const legacy = await load(t, rowsAt({ version: '2.1.170' }));
  assert.equal(legacy.raw.interjections, undefined, 'never read as the human\'s');
  assert.equal(legacy.raw.capture?.unsupportedRowChannels?.instructions, 1, 'still a declared loss');
  assert.deepEqual(gapsOn(legacy.session, 'instructions').filter((gap) => gap.code === 'unsupported_message')
    .map((gap) => gap.count), [1]);
  assert.equal(instructionReviewScope(legacy.session).complete, false);
});

const MULTI = Object.freeze({ question: 'Which checks should the CLI run?', header: 'Checks', multiSelect: true,
  options: [{ label: 'lint', description: 'Lint the sources' }, { label: 'unit', description: 'Unit tests' },
    { label: 'e2e', description: 'End-to-end tests' }] });
const SINGLE = Object.freeze({ question: 'Which flag name?', header: 'Flag', multiSelect: false,
  options: [{ label: '--strict', description: 'Strict' }, { label: '--safe', description: 'Safe' }] });
/** The ask; a question call; its result (visible text and typed sidecar); an edit after it; the close. */
const asked = ({ questions = [MULTI], answers, visible }) => [
  humanAsk('Add a checks flag to src/cli.js.'),
  call('q1', 'AskUserQuestion', { questions }, 'One question first.'),
  result('q1', visible ?? answeredText(questions.map((q) => [q.question, [answers[q.question]].flat().join(',')])),
    { questions, answers }),
  ...edit('e1'), said('Added the flag.')];

test('3c: each option chosen in a multiSelect answer is a human instruction answering the question', async (t) => {
  const { session } = await load(t, asked({ questions: [MULTI, SINGLE],
    answers: { [MULTI.question]: ['lint', 'unit'], [SINGLE.question]: '--strict' } }));
  const question = session.events.find((e) => e.kind === 'invocation' && e.asksHuman === true);
  const answers = session.events.filter((e) => e.kind === 'instruction' && (e.markers ?? []).includes('answer'));
  assert.deepEqual(answers.map((e) => session.textOf(e)), ['lint', 'unit', '--strict'], 'in the recorded order');
  assert.ok(answers.every((e) => e.authority === 'human' && e.answerTo === question.id));
  assert.equal(new Set(answers.map((e) => e.id)).size, 3);
  assert.deepEqual(gapsOn(session, 'instructions').filter((gap) => gap.note === UNREAD_ANSWER_NOTE), []);
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'edit');
  assert.equal(instructionReviewScope(session).complete, true);
  assert.equal(decisionInstructionHistoryComplete(session, [write]), true, 'the answers are in its history');
  assert.equal(decisionInstructionHistoryComplete(session, [question, write]), false, 'it asked');
});

test('3c: a list the recorder did not type as the question\'s (not multiSelect), an empty list, or an option not in '
  + 'the text the agent read keeps the answer unread', async (t) => {
  const cases = [
    asked({ questions: [SINGLE], answers: { [SINGLE.question]: ['--strict'] } }),
    asked({ questions: [MULTI], answers: { [MULTI.question]: [] }, visible: answeredText([[MULTI.question, '']]) }),
    asked({ questions: [MULTI], answers: { [MULTI.question]: ['lint', 'unit'] },
      visible: answeredText([[MULTI.question, 'lint']]) }),
  ];
  for (const rows of cases) {
    const { session } = await load(t, rows);
    assert.equal(session.events.filter((e) => (e.markers ?? []).includes('answer')).length, 0);
    assert.deepEqual(gapsOn(session, 'instructions').filter((gap) => gap.note === UNREAD_ANSWER_NOTE)
      .map((gap) => gap.count), [1], 'declared unread at its call');
  }
});
