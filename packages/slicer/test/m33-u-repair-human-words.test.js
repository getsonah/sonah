// M33 U repair (OWNER DECISION B, 2026-10-01): the human's own words inside a Claude Code tool result are never left
// undeclared.
//
//   - A call the human refused — L1: the recorder's typed `toolDenialKind:
//     "user-rejected"` beside its one `is_error` result block, whatever the words — on any tool: the call is
//     `humanAnswerUnresolved` (the adapter's located instructions gap). M34 labels: that block is labelled `human` +
//     `refusal`, linked to the refused call; M34 labels review (F3): its result's text is still never read as an
//     instruction — Claude Code writes its own rejection words into every refusal's result and records no separate
//     field for the human's feedback. Another denial kind, an interrupt, an error with no denial kind, or a Codex result
//     carrying the same text is no such loss. On a recorder that types no refusal
//     (CLAUDE_UNTYPED_DENIAL_RECORDER, L1 review), every failed call is `refusalUntyped` and counted instead.
//   - Every Claude AskUserQuestion call's answer is unresolved until it is read: one outside the known input schema
//     (a generic tool), one declined with feedback, one whose result was never recorded. A question interrupted, or
//     declined without words, carries none, exactly as before.
//   - Where no ledger action carries the call (a hand-off, a result for no recorded call), the words are counted
//     (`capture.instructionsFeedbackUnplaced`) and declared session-wide by the adapter.
//   - M34 labels: a queued prompt is the human's by its typed origin alone, whatever it holds (no tag shape refuses it);
//     with no origin on a typed recorder it is not provably the human's: not read, its row still counted.
//
// Every row is synthetic (packages/evidence/test/m33-u-unasked-fixture.js). No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeRows, load, queued, user as recordedUser, call, result, said, answeredText, QUESTION, CODEX_NAME }
  from '../../evidence/test/m33-u-unasked-fixture.js';
import { CLAUDE_USER_REFUSAL, CLAUDE_UNTYPED_DENIAL_RECORDER } from '../src/events.js';
import { sliceHash } from '../../redact/index.js';
import { INSTRUCTION_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';

/** L1 session-type review: every prompt here is a human's, typed at the interactive terminal (`promptSource: 'typed'`),
 *  so a refusal is a human's (C-02 "L1 refused calls"). The same rows with no typed prompt are a session whose type
 *  the recorder did not record, declared under their own reason (slicer/test/l1-session-type.test.js). */
const user = (text, extra = {}) => recordedUser(text, { promptSource: 'typed', ...extra });

const REJECTED = 'The user doesn\'t want to proceed with this tool use. The tool use was rejected (eg. if it was a file '
  + 'edit, the new_string was NOT written to the file).';
const saying = (words) => `${REJECTED} To tell you how to proceed, the user said:\n${words}`;
const PLAIN = `${REJECTED} STOP what you are doing and wait for the user to tell you how to proceed.`;
const WORDS = 'Do not touch the flags list.';
const edit = (id) => call(id, 'Edit', { file_path: '/repo/src/cli.js', old_string: 'a', new_string: 'b' });
/** A call the human refused, as Claude Code records it at a permission prompt: its `is_error` result block, the sidecar
 *  `Error: <the text>`, and the typed denial kind. */
const rejected = (id, text = saying(WORDS), kind = 'user-rejected') => ({ ...result(id, text, `Error: ${text}`, true),
  ...(kind === null ? {} : { toolDenialKind: kind }) });
const eventOf = (raw, tool) => raw.ledger.find((event) => event.tool === tool || event.kind === tool);

test('L1: the human\'s refusal is the recorder\'s typed denial kind, one frozen value, no wording', () => {
  assert.ok(Object.isFrozen(CLAUDE_USER_REFUSAL));
  assert.deepEqual({ ...CLAUDE_USER_REFUSAL }, { field: 'toolDenialKind', kind: 'user-rejected' });
  assert.ok(Object.isFrozen(CLAUDE_UNTYPED_DENIAL_RECORDER));
  assert.deepEqual({ ...CLAUDE_UNTYPED_DENIAL_RECORDER }, { field: 'version', newest: '2.1.141' });
});

test('L1: every call the human refused marks that call, whatever its words, on any tool; it is never an instruction', async (t) => {
  // M34 labels review (F3): the recorder's real rejection texts included (PLAIN is what Claude Code writes when the human
  // gives no feedback): none is read as the human's words, in a session a human submitted to as anywhere else.
  for (const [use, tool] of [[edit('e1'), 'Edit'], [call('e1', 'Bash', { command: 'rm -rf build', description: 'Clean' }), 'bash'],
    [call('e1', 'mcp__files__write', { path: 'x' }), 'mcp__files__write']]) {
    for (const text of [saying(WORDS), PLAIN, 'Permission denied: ne touchez pas au dossier build.', '']) {
      const { raw } = await load(t, [user('Clean up.'), use, rejected('e1', text), said('Stopped.')]);
      const event = raw.ledger[0];
      assert.equal(event.humanAnswerUnresolved, true, `${tool}: ${text}`);
      assert.equal(raw.interjections, undefined, tool);
      assert.deepEqual(raw.ask.map((a) => a.text), ['Clean up.'], tool);
    }
  }
  // Another denial kind (a rule, the auto-mode classifier, an interrupt, a cancelled background call), an error with no
  // denial kind — whatever its words, the old rejection sentence included — an interrupt notice, or a refusal's kind on
  // a result that is not an error: no human answered, nothing to declare.
  for (const kind of ['permission-rule', 'automode-blocked', 'automode-unavailable', 'interrupted', 'cancelled', null]) {
    const { raw } = await load(t, [user('Clean up.'), edit('e1'), rejected('e1', saying(WORDS), kind), said('Stopped.')]);
    assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined, String(kind));
  }
  for (const [content, isError] of [[PLAIN, true], ['[Request interrupted by user for tool use]', true], [saying(WORDS), false]]) {
    const { raw } = await load(t, [user('Clean up.'), edit('e1'), result('e1', content, undefined, isError), said('Stopped.')]);
    assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined, content);
  }
  const notError = await load(t, [user('Clean up.'), edit('e1'), { ...result('e1', 'ok', undefined, false),
    toolDenialKind: 'user-rejected' }, said('Done.')]);
  assert.equal(notError.raw.ledger[0].humanAnswerUnresolved, undefined, 'a refusal is an error result');
});

test('L1 review (OWNER DECISION 2026-10-06): a recorder that types no refusal declares its refusal channel unreadable', async (t) => {
  // Review finding L1-pre-typed-recorder-fail-open. A recorder at or below CLAUDE_UNTYPED_DENIAL_RECORDER (2.1.141: its own
  // code holds no `toolDenialKind`) records a refusal as an error like any other: every failed call on its rows is
  // marked `refusalUntyped` and counted, whatever its words — never read, never an answer of its own.
  const old = (r, version = '2.1.141') => ({ ...r, version });
  const refusedOld = old(result('e1', saying('keep the old flag name'), 'User rejected tool use', true));
  const { raw, session } = await load(t, [old(user('Rename the flag.')), old(edit('e1')), refusedOld, old(said('Kept.'))]);
  assert.equal(raw.ledger[0].refusalUntyped, true);
  assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined, 'not read as a typed refusal');
  assert.equal(raw.capture.instructionsRefusalUntyped, 1);
  assert.equal(raw.capture.incomplete, false, 'a declared loss, not a capture shortfall');
  // C-01 event identity: the refused call, found by what it is (the session's one action).
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.refusal_untyped)
    .map(({ count, eventIds }) => ({ count, eventIds })),
  [{ count: 1, eventIds: [session.events.find((e) => e.kind === 'invocation').id] }]);
  // Any failed call, whatever its words; an older version too; a result that is no error is not.
  for (const [rows, marked, why] of [
    [[old(user('Run the tests.')), old(call('b1', 'Bash', { command: 'npm test', description: 'Test' })),
      old(result('b1', 'Error: 1 failing', 'Error: 1 failing', true))], true, 'a failing command'],
    [[old(user('Fix it.'), '1.0.12'), old(edit('e1'), '1.0.12'), old(rejected('e1', PLAIN, null), '1.0.12')], true, '1.0.12'],
    [[old(user('Fix it.')), old(edit('e1')), old(result('e1', 'ok', undefined, false))], undefined, 'not an error'],
  ]) {
    const loaded = await load(t, rows);
    assert.equal(loaded.raw.ledger[0].refusalUntyped, marked, why);
    assert.equal(loaded.raw.capture?.instructionsRefusalUntyped, marked ? 1 : undefined, why);
  }
  // No signal: a later recorder (every refusal from 2.1.222 on is typed), or a version out of shape —
  // read as L1 reads it: an error with no denial kind is a failed call.
  for (const version of ['2.1.142', '2.1.205', '2.1.284', '2.1.1410', 'v2.1.100', '2.1.100-beta', '', undefined, 2]) {
    const rows = [user('Rename the flag.'), edit('e1'), refusedOld, said('Kept.')].map((r) => ({ ...r, version }));
    const loaded = await load(t, rows);
    assert.equal(loaded.raw.ledger[0].refusalUntyped, undefined, String(version));
    assert.equal(loaded.raw.ledger[0].humanAnswerUnresolved, undefined, String(version));
    assert.equal(loaded.raw.capture?.instructionsRefusalUntyped, undefined, String(version));
  }
  // Whatever the session type later rows record: the old recorder typed none for its own rows.
  const headless = await load(t, [old(user('Rename the flag.', { promptSource: 'sdk' })), old(edit('e1')), refusedOld,
    old(said('Kept.'))]);
  assert.equal(headless.raw.ledger[0].refusalUntyped, true);
  // A failed hand-off no ledger action carries is counted too, so the gap names no call: a loss at every bound.
  const handOff = await load(t, [old(user('Add a flag.')), old(edit('e1')), old(result('e1', 'ok', undefined, false)),
    old(call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' })),
    old(result('t1', PLAIN, undefined, true)), old(said('Done.'))]);
  assert.equal(handOff.raw.capture.instructionsRefusalUntyped, 1);
  assert.deepEqual(handOff.session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.refusal_untyped)
    .map((gap) => [gap.count, Object.hasOwn(gap, 'eventIds')]), [[1, false]]);
});

test('U repair: a Codex result carrying the same words is no Claude rejection', async (t) => {
  const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });
  const { raw } = await load(t, [
    { type: 'session_meta', payload: { id: 'codex-u-0001', cwd: '/repo', cli_version: '0.117.0' } },
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Print the notes.' }] }),
    rollout({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"cat notes.txt"}' }),
    rollout({ type: 'function_call_output', call_id: 'c1',
      output: `Wall time: 0.5000 seconds\nProcess exited with code 1\nOutput:\n${saying(WORDS)}` }),
  ], { name: CODEX_NAME });
  assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined);
});

test('U repair: every Claude question\'s answer is unresolved until it is read', async (t) => {
  const drifted = { ...QUESTION, extraField: 'drift' };
  const generic = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [drifted] }),
    result('q1', answeredText([[QUESTION.question, '--safe']]), { questions: [drifted], answers: { [QUESTION.question]: '--safe' } }),
    said('Done.')]);
  assert.equal(generic.raw.ledger[0].genericTool, true);
  assert.equal(generic.raw.ledger[0].humanAnswerUnresolved, true, 'outside the known schema: not read, declared');
  assert.equal(generic.raw.interjections, undefined);
  const declined = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [QUESTION] }),
    rejected('q1', saying('Neither. Use --compat.')), said('Done.')]);
  assert.equal(declined.raw.ledger[0].humanAnswerUnresolved, true, 'declined with words');
  assert.equal(declined.raw.interjections, undefined);
  const unrecorded = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [QUESTION] }), said('Done.')]);
  assert.equal(unrecorded.raw.ledger[0].humanAnswerUnresolved, true, 'no result recorded');
  for (const content of ['[Request interrupted by user for tool use]', PLAIN]) {
    const none = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [QUESTION] }),
      result('q1', content, undefined, true), said('Done.')]);
    assert.equal(none.raw.ledger[0].humanAnswerUnresolved, undefined, `${content}: no refusal recorded`);
  }
  // L1: a question the human refused may carry an answer, whatever its words (F3: the recorder's own words included).
  const refused = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [QUESTION] }),
    rejected('q1', PLAIN), said('Done.')]);
  assert.equal(refused.raw.ledger[0].humanAnswerUnresolved, true, 'refused without words');
  assert.equal(refused.raw.interjections, undefined);
  // An error result is never read as an answer, whatever its sidecar says.
  const errored = await load(t, [user('Add a flag.'), call('q1', 'AskUserQuestion', { questions: [QUESTION] }),
    result('q1', answeredText([[QUESTION.question, '--safe']]), { questions: [QUESTION], answers: { [QUESTION.question]: '--safe' } }, true),
    said('Done.')]);
  assert.equal(errored.raw.interjections, undefined);
});

/** H1: the fixture's test command's status is now its typed Claude Code verdict
 *  (`outcomeSource: 'native'`), no longer a pass read from its output text (`parsed-output`). Its only moved byte. */
const MOVED_BY_H1 = Object.freeze({ before: '0f8a2bbce94a5f1ad81f3a558ff7195b33b5d2516ffe9ac5388e73591779e3db',
  after: 'c50bd0a4a260078c5ffaccae98149b4f0e496a375941a6f9363ec0c54b5d04de' });
/** M1: the same command's kind is `bash`, no longer `test` (no runner-name label). */
const MOVED_BY_M1 = Object.freeze({ after: '6e3f0fbc8bb208e8754b94811edf546d83ec4467ce553e393dcfed04b9ad7c60' });
/** C-01 event identity (stable event ids, 2026-10-07): every ledger element records where the recorder wrote it
 *  (`identity`: its row, block and the row's uuid). Its only moved bytes: with each identity taken out, the ledger
 *  hashes to M1's pin (asserted below). */
const MOVED_BY_STABLE_IDS = Object.freeze({ after: '731c34755adeb60996fe245baebad5b45c858a324e433106f37395a36738f8d8' });
/** D68 (C-02 "M36 recorded facts"): every action records the recorder's typed facts about it (`recorded`: here each
 *  call's tool name and the typed error flag of its result). Its only moved bytes: with each `recorded` taken out, the
 *  ledger hashes to the stable ids' pin (asserted below). */
const MOVED_BY_RECORDED_FACTS = Object.freeze({ after: '81af9ab77a636ff7cf99b337ae4e46a0086d3f0f5a0acc8dc9040469ba095cea' });
/** M36 phase 2 review (D68 H, critique c1): a prior state names the event that recorded it (`before.seq` beside its
 *  `turn`: here the created file's own body). Its only moved bytes: with each `before.seq` taken out, the ledger hashes to
 *  the recorded facts' pin (asserted below). */
const MOVED_BY_M36_FORMAT = Object.freeze({ after: '8366adb7de50051dec88c8b91ee4ff96ba00029a71363619cbacff49e82fc4ce' });
/** D69 (c) (owner decision 2026-10-08): the slicer names no hunk by an "enclosing definition" and lists no names a created
 *  file "defines" (its programming-language keyword list is deleted): the created parser's diff no longer opens with
 *  `@@ defines: parse @@`, nor the flag edit's with `@@ const flags = []; @@`. Its only moved bytes: with each header put
 *  back (`withD69Headers`), the ledger hashes to the M36 pin (asserted below). */
const MOVED_BY_D69 = Object.freeze({ after: '8012828e14c5a58e07408a287503b809f35dbf4c8a1d43e5f8cadd324e0baeaf' });
const D69_HEADERS = Object.freeze({ 'src/parser.js': '@@ defines: parse @@', 'src/cli.js': '@@ const flags = []; @@' });
const withD69Headers = (ledger) => ({ ...ledger, ledger: (ledger.ledger ?? []).map((event) =>
  (typeof event?.diff === 'string' && Object.hasOwn(D69_HEADERS, event.path)
    ? { ...event, diff: `${D69_HEADERS[event.path]}\n${event.diff}` } : event)) });
const withoutPriorSeq = (ledger) => ({ ...ledger,
  ledger: (ledger.ledger ?? []).map((event) => (event?.before && 'seq' in event.before
    ? { ...event, before: (({ seq, ...rest }) => rest)(event.before) } : event)) });
const withoutIdentity = (ledger) => Object.fromEntries(Object.entries(ledger).map(([key, value]) => [key,
  ['ask', 'ledger', 'interjections', 'commentary'].includes(key) && Array.isArray(value)
    ? value.map(({ identity, ...rest }) => rest) : value]));
const withoutRecorded = (ledger) => ({ ...ledger,
  ledger: (ledger.ledger ?? []).map(({ recorded, ...rest }) => rest) });

test('U repair: an unanswered question with a recorded result keeps 269cf6d\'s ledger bytes', async (t) => {
  const { raw, ledger } = await load(t, claudeRows({ ask: true, sidecar: null }));
  assert.deepEqual(Object.keys(eventOf(raw, 'AskUserQuestion')),
    ['turn', 'seq', 'kind', 'tool', 'inputRecorded', 'argsExcerpt', 'identity', 'recorded', 'tailLines',
      'humanAnswerUnresolved', 'result']);
  // M34 labels: the slice hash covers the evidence, not the capture counts, so the label counts move no pin.
  assert.equal(sliceHash(ledger), MOVED_BY_D69.after,
    'pinned on 269cf6d, moved only by H1, M1, stable ids, the recorded facts, the prior state\'s recording event and D69');
  const m36 = withD69Headers(ledger);
  assert.equal(sliceHash(m36), MOVED_BY_M36_FORMAT.after, 'the computed hunk headers are the only bytes D69 moved');
  assert.equal(sliceHash(withoutPriorSeq(m36)), MOVED_BY_RECORDED_FACTS.after, 'the recording event is the only byte M36 moved');
  assert.equal(sliceHash(withoutRecorded(withoutPriorSeq(m36))), MOVED_BY_STABLE_IDS.after,
    'the recorded facts are the only bytes D68 moved');
  assert.equal(sliceHash(withoutIdentity(withoutRecorded(withoutPriorSeq(m36)))), MOVED_BY_M1.after,
    'the identities are the only bytes stable ids moved');
});

test('U repair: words with no ledger action to carry them are counted, unplaced', async (t) => {
  const handOff = await load(t, [user('Add a flag.'),
    call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    rejected('t1', saying('No helpers.')), said('Done.')]);
  assert.equal(handOff.raw.capture.instructionsFeedbackUnplaced, 1);
  const orphan = await load(t, [user('Add a flag.'), rejected('nope', saying('Not that.')), said('Done.')]);
  assert.equal(orphan.raw.capture.instructionsFeedbackUnplaced, 1);
  // L1: a hand-off the human refused without words is counted too; one denied by a rule is not.
  const plain = await load(t, [user('Add a flag.'),
    call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    rejected('t1', PLAIN), said('Done.')]);
  assert.equal(plain.raw.capture?.instructionsFeedbackUnplaced, 1);
  const rule = await load(t, [user('Add a flag.'),
    call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    rejected('t1', PLAIN, 'permission-rule'), said('Done.')]);
  assert.equal(rule.raw.capture?.instructionsFeedbackUnplaced, undefined);
});

test('M34 labels: a queued prompt is read by its typed origin, never by its tag shape', async (t) => {
  for (const prompt of ['<teammate-message teammate_id="researcher">Use the v2 API.</teammate-message>',
    '<agent-message from="planner">Ship it.</agent-message>', '<user-prompt-submit-hook>Lint.</user-prompt-submit-hook>',
    '<a>one</a>\n<b>two</b>']) {
    const untyped = await load(t, claudeRows({ queuedPrompt: prompt, queuedPayload: {} }));
    assert.equal(untyped.raw.interjections, undefined, `${prompt}: no origin on a typed recorder`);
    // Release fix 3b (2026-10-12): the harness's by its label, so harness context, no declared loss.
    assert.equal(untyped.raw.capture?.unsupportedRowChannels?.instructions ?? 0, 0, 'harness context');
    const human = await load(t, claudeRows({ queuedPrompt: prompt, queuedPayload: { origin: { kind: 'human' } } }));
    assert.deepEqual(human.raw.interjections.map((entry) => entry.text), [prompt], `${prompt}: the human's, whole`);
  }
  const prose = 'Please keep <b>bold</b> headings.';
  const { raw } = await load(t, claudeRows({ queuedPrompt: prose }));
  assert.deepEqual(raw.interjections.map((entry) => entry.text), [prose]);
});
