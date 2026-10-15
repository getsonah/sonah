// OWNER DECISION 2026-10-06 (C-02 "L1 refused calls", session type). L1 declares every call the recorder typed
// `user-rejected` as a possibly unread human answer. In a session no human submitted — `claude -p`, an SDK run, Sonah's
// own instrument calls, seeded test sessions — no one was there to answer a permission prompt, and the
// recorder types a prompt no one could be shown `user-rejected` too. Whether a human submitted the session is read from
// the recorder's typed prompt fields only (`promptSource`, a host-declared `origin`, `turnOrigin`), never from text:
//
//   - interactive: any human-typed `promptSource` (`typed`, `queued`, `suggestion_accepted`) or `human` origin/turn;
//   - non-interactive: at least one prompt typed `sdk` with no declared origin, and every other typed prompt that or the
//     harness's own (`system`, no declared origin);
//   - unknown: anything else (no typed prompt, a value outside the vocabulary, a host origin that is not a human's) —
//     L1 as built (fail closed).
//
// Every row is synthetic (packages/evidence/test/m33-u-unasked-fixture.js). No real recording is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, queued, user, call, result, said } from '../../evidence/test/m33-u-unasked-fixture.js';
import { CLAUDE_SESSION_TYPE, CLAUDE_HOST_ORIGIN_RECORDER, SESSION_TYPES, claudeSessionType } from '../src/events.js';
import { UNREAD_ANSWER_NOTE, INSTRUCTION_GAP_NOTES, LABEL_GAP_NOTES } from '../../evidence/adapters/sonah-ledger.js';

const edit = (id) => call(id, 'Edit', { file_path: '/repo/src/cli.js', old_string: 'a', new_string: 'b' });
const refused = (id) => ({ ...result(id, 'Permission to use Edit has been denied.', 'Error: denied', true),
  toolDenialKind: 'user-rejected' });
const SDK = Object.freeze({ promptSource: 'sdk' });
const HUMAN_DESKTOP = Object.freeze({ promptSource: 'sdk', origin: { kind: 'human' } });
const recs = (...raws) => raws.map((raw) => ({ raw, adapter: 'claude' }));
const prompt = (extra) => ({ type: 'user', message: { role: 'user', content: 'Fix it.' }, version: '2.1.284', ...extra });

test('session type: one frozen vocabulary of the recorder\'s typed prompt fields, no wording', () => {
  assert.ok(Object.isFrozen(CLAUDE_SESSION_TYPE) && Object.isFrozen(CLAUDE_SESSION_TYPE.humanPromptSources));
  assert.deepEqual(JSON.parse(JSON.stringify(CLAUDE_SESSION_TYPE)), { humanPromptSources: ['typed', 'queued',
    'suggestion_accepted'], sdkPromptSource: 'sdk', systemPromptSource: 'system', humanOrigin: 'human',
  sdkTurnOrigin: 'sdk', systemTurnOrigin: 'system' });
  assert.deepEqual({ ...SESSION_TYPES }, { interactive: 'interactive', nonInteractive: 'non-interactive',
    unknown: 'unknown' });
});

test('session type: read from typed prompt rows only', () => {
  const { interactive, nonInteractive, unknown } = SESSION_TYPES;
  for (const [rows, expected, why] of [
    [recs(prompt(SDK)), nonInteractive, 'claude -p / an SDK run'],
    [recs(prompt({ ...SDK, turnOrigin: 'sdk' })), nonInteractive, 'the recorder classified the turn sdk'],
    [recs(prompt(SDK), prompt({ promptSource: 'system', isMeta: true })), nonInteractive, 'with a harness prompt'],
    [recs(prompt(HUMAN_DESKTOP)), interactive, 'a host declared the human'],
    [recs(prompt(SDK), prompt(HUMAN_DESKTOP)), interactive, 'one human prompt is enough'],
    [recs(prompt({ ...SDK, turnOrigin: 'human' })), interactive, 'the recorder classified the turn human'],
    ...['typed', 'queued', 'suggestion_accepted'].map((source) =>
      [recs(prompt({ promptSource: source })), interactive, `the interactive terminal: ${source}`]),
    [recs(prompt(SDK), { type: 'attachment', attachment: { type: 'queued_command', commandMode: 'prompt',
      prompt: 'Also this.', origin: { kind: 'human' } } }), interactive, 'a prompt the human queued'],
    [recs(prompt({})), unknown, 'no typed prompt: a recorder older than the field, or a helper'],
    [recs(), unknown, 'no rows'],
    [recs(prompt({ promptSource: 'system' })), unknown, 'only the harness\'s own'],
    [recs(prompt(SDK), prompt({ promptSource: 'system', origin: { kind: 'task-notification' } })), unknown,
      'a host origin that is not a human\'s'],
    [recs(prompt({ ...SDK, origin: { kind: 'coordinator' } })), unknown, 'a coordinator\'s submission'],
    [recs(prompt({ ...SDK, turnOrigin: 'peer' })), unknown, 'a peer\'s turn'],
    [recs(prompt({ promptSource: 'remote' })), unknown, 'a value outside the vocabulary'],
    [recs(prompt({ promptSource: 'sdk', origin: null })), unknown, 'an origin out of shape'],
  ]) assert.equal(claudeSessionType(rows), expected, why);
  // Another adapter's rows are not Claude's typed fields.
  assert.equal(claudeSessionType([{ raw: prompt(SDK), adapter: 'codex' }]), unknown);
});

test('L1 session type: a refusal in a session no human submitted declares no unread answer', async (t) => {
  const { raw, session } = await load(t, [user('Clean up.', SDK), edit('e1'), refused('e1'), said('Stopped.')]);
  assert.equal(raw.ledger[0].humanAnswerUnresolved, undefined);
  assert.equal(raw.ledger[0].isError, true, 'still a failed call');
  assert.deepEqual(raw.ask.map((a) => a.text), ['Clean up.'], 'the prompt is read as before');
  assert.ok(!(session.adapterGaps ?? []).some((gap) => gap.note === UNREAD_ANSWER_NOTE));
  // A hand-off refused there is not counted either.
  const handOff = await load(t, [user('Add a flag.', SDK),
    call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    refused('t1'), said('Done.')]);
  assert.equal(handOff.raw.capture?.instructionsFeedbackUnplaced, undefined);
});

test('L1 session type: a human\'s session keeps L1 as built', async (t) => {
  // M34 labels review (F3): the refusal the recorder typed (`toolDenialKind: user-rejected`) is labelled `human` +
  // `refusal`, linked to the refused call, but its result's text is the recorder's and is never read as the human's
  // instruction: the call keeps its declared unread answer.
  for (const [first, extra, why] of [
    [user('Clean up.', HUMAN_DESKTOP), [], 'a host declared the human'],
    [user('Clean up.', { promptSource: 'typed' }), [], 'the interactive terminal'],
    [user('Clean up.', SDK), [queued('Keep the cache.', { origin: { kind: 'human' } })], 'the human queued a prompt'],
  ]) {
    const { raw, session } = await load(t, [first, ...extra, edit('e1'), refused('e1'), said('Stopped.')]);
    const event = raw.ledger.find((e) => e.attempted === 'edit');
    assert.equal(event?.humanAnswerUnresolved, true, why);
    assert.equal(event?.refusalSessionUnknown, undefined, why);
    assert.equal(raw.capture?.instructionsRefusalSessionUnknown, undefined, why);
    assert.ok(!(raw.interjections ?? []).some((entry) => entry.kind === 'refusal'), why);
    assert.ok(!session.events.some((e) => e.kind === 'instruction' && (e.markers ?? []).includes('refusal')), why);
    assert.ok((session.adapterGaps ?? []).some((gap) => gap.note === UNREAD_ANSWER_NOTE), why);
  }
});

// L1 session-type review (finding L1S-unknown-type-not-counted). The owner's rule keeps the declaration where the
// session type is missing or ambiguous AND counts it as its own closed gap: the call is `refusalSessionUnknown` (not
// `humanAnswerUnresolved`), counted in `capture.instructionsRefusalSessionUnknown`, and declared by the adapter with
// its own closed note (INSTRUCTION_GAP_NOTES.refusal_session_unknown) and review cause, so its rate is computable apart
// from a refusal a human gave. It still caps certification exactly as before: an instructions-channel loss at the call.
test('L1 session-type review: a refusal in a session whose type is not recorded is declared under its own reason', async (t) => {
  // M34 labels: an untyped prompt is the human's only on a recorder that types none (the legacy fallback); a
  // coordinator's submission on a root thread is a peer's message, which opens no turn.
  // M34 labels review (F6): a prompt the declared legacy fallback read as the human's is counted under its gap,
  // located at the instruction its row opens.
  // C-01 event identity: the refused call and the instruction are found by what they are, never by turn and seq.
  const legacy = (session) => ({ count: 1, eventIds: [session.events.find((e) => e.kind === 'instruction').id],
    note: LABEL_GAP_NOTES.legacy_recorder[1] });
  for (const [first, why, legacyGap] of [
    [user('Clean up.', { version: '2.1.205' }), 'no typed prompt', true],
    [user('Clean up.', { ...SDK, origin: { kind: 'coordinator' } }), 'a coordinator\'s submission', false],
    [user('Clean up.', { ...SDK, version: '2.1.170' }), 'an sdk prompt on a recorder that carries no host origin', true],
  ]) {
    const { raw, session } = await load(t, [first, edit('e1'), refused('e1'), said('Stopped.')]);
    const call0 = session.events.find((e) => e.kind === 'invocation').id;
    const labelGaps = legacyGap ? [legacy(session)] : [];
    const event = raw.ledger.find((e) => e.attempted === 'edit');
    assert.equal(event?.refusalSessionUnknown, true, why);
    assert.equal(event?.humanAnswerUnresolved, undefined, why);
    assert.equal(raw.capture.instructionsRefusalSessionUnknown, 1, why);
    assert.equal(raw.capture.incomplete, false, `${why}: a declared loss, not a capture shortfall`);
    const gaps = (session.adapterGaps ?? []).filter((gap) => gap.channel === 'instructions');
    assert.deepEqual(gaps.map(({ count, eventIds, note }) => ({ count, eventIds, note })),
      [{ count: 1, eventIds: [call0], note: INSTRUCTION_GAP_NOTES.refusal_session_unknown }, ...labelGaps], why);
    assert.ok(!gaps.some((gap) => gap.note === UNREAD_ANSWER_NOTE), why);
  }
  // A hand-off refused there, which no ledger action carries, is counted under the same reason: the gap then names no
  // call, a loss at every bound (fail closed), and the unplaced count of a human's refusal stays unused.
  const handOff = await load(t, [user('Add a flag.', { version: '2.1.205' }), edit('e1'), { ...result('e1', 'ok', undefined, false) },
    call('t1', 'Agent', { description: 'Add it', prompt: 'Add the flag.', subagent_type: 'general-purpose' }),
    refused('t1'), said('Done.')]);
  assert.equal(handOff.raw.capture.instructionsRefusalSessionUnknown, 1);
  assert.equal(handOff.raw.capture.instructionsFeedbackUnplaced, undefined);
  assert.deepEqual(handOff.session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.refusal_session_unknown)
    .map((gap) => [gap.count, Object.hasOwn(gap, 'eventIds')]), [[1, false]]);
  // Its review cause: evidence/test/l1-session-unknown-adapter.test.js.
});

// L1 session-type review (finding L1S-absent-origin-read-as-no-human). The recorder itself presumes a prompt with no
// declared origin is a human's, and Claude Desktop recorders older than the origin field type its human's prompts `sdk`
// with none. So an `sdk` prompt with no origin says no human submitted it only on a recorder whose own code carries a
// host's declared origin (2.1.237 on, CLAUDE_HOST_ORIGIN_RECORDER); anywhere else it proves nothing: unknown.
test('L1 session-type review: an sdk prompt with no origin proves no human only on a recorder that carries one', async (t) => {
  assert.ok(Object.isFrozen(CLAUDE_HOST_ORIGIN_RECORDER));
  assert.deepEqual({ ...CLAUDE_HOST_ORIGIN_RECORDER }, { field: 'version', oldest: '2.1.237' });
  const { interactive, nonInteractive, unknown } = SESSION_TYPES;
  const at = (version, extra = SDK) => prompt({ ...extra, version });
  for (const [rows, expected, why] of [
    [recs(at('2.1.237')), nonInteractive, 'the oldest recorder read that carries a host origin'],
    [recs(at('2.1.284'), at('2.1.237')), nonInteractive, 'a resumed run, every sdk row on such a recorder'],
    [recs(at('2.1.236')), unknown, 'an older recorder: the absence proves nothing'],
    [recs(at('2.1.170')), unknown, 'a Desktop recorder whose human\'s prompts carry no origin'],
    [recs(at('2.1.284'), at('2.1.170')), unknown, 'one such row is enough'],
    [recs(at(undefined)), unknown, 'no version recorded'],
    ...['v2.1.284', '2.1.284-beta', '2.1', '', 2].map((version) => [recs(at(version)), unknown, `version ${version}`]),
    [recs(at('2.1.170', HUMAN_DESKTOP)), interactive, 'a declared human, whatever the recorder'],
    [recs(at('2.1.170', { promptSource: 'typed' })), interactive, 'the interactive terminal'],
    [recs(at('2.1.284'), at('2.1.170', { promptSource: 'system', isMeta: true })), nonInteractive,
      'the harness\'s own prompt on any recorder'],
  ]) assert.equal(claudeSessionType(rows), expected, why);
  // End to end: a refusal in a session of such a recorder keeps its declaration.
  const old = (r) => ({ ...r, version: '2.1.170' });
  const { raw, session } = await load(t, [old(user('Clean up.', SDK)), old(edit('e1')), old(refused('e1')),
    old(said('Stopped.'))]);
  assert.equal(raw.ledger[0].refusalSessionUnknown, true);
  assert.ok((session.adapterGaps ?? []).some((gap) => gap.note === INSTRUCTION_GAP_NOTES.refusal_session_unknown));
  // The same rows on a recorder that carries a host origin declare nothing.
  const recent = await load(t, [user('Clean up.', SDK), edit('e1'), refused('e1'), said('Stopped.')]);
  assert.equal(recent.raw.ledger[0].humanAnswerUnresolved, undefined);
});
