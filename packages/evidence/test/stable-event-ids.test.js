// C-01 event identity (stable event ids, 2026-10-07; contract C-01 "Event identity"). Every canonical event is
// named by the RECORDER's own identity of what it was read from — a Claude Code row's uuid and content block, a Codex
// call's call_id (or a message's item id) and part, else the row's position — never by a turn number, a sequence or an
// ordinal. So a slicer change that renumbers turns, a recording that grows, or a row copied into a forked or resumed
// recording leaves every other event's id where it was.
//
// Every fixture here is synthetic. No real recording is read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage, NATIVE_ID, IDENTITY_SUB, IDENTITY_KEYS } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger, eventIdCounts, EVENT_ID_GAPS, IDENTITY_NATIVE, IDENTITY_SUB as ADAPTER_SUB,
  IDENTITY_KEYS as ADAPTER_KEYS } from '../adapters/sonah-ledger.js';
import { PROMPT_VERSION, buildChallengeDossier } from '../src/prompt.js';
import { CHALLENGE_PROFILE, CHALLENGE_DOSSIER_VERSION } from '../src/challenge.js';
import { CODE_REVIEW_VERSION } from '../src/code-review-prompt.js';
import { WINDOWING_VERSION } from '../src/windows.js';
import { STORY_VERSION } from '../../render/session-story.js';
import { PAGE_VERSION } from '../../render/session-page.js';
import { adapt, twinOf, beforeStableIds, textBeforeStableIds } from './stable-ids-fixture.js';
import { INTEGRATION_VERSIONS, STABLE_IDS_VERSIONS, DISCLOSURE_WORDS_VERSIONS, WINDOWING_VERSIONS, RECORDED_FACTS_VERSIONS, FORMAT_VERSIONS, CONVERSATION_VERSIONS, D69_VERSIONS, D69_REVIEW_VERSIONS, D71_BRIEF_VERSIONS, D71_CHANNELS_VERSIONS, D69_PAGE_VERSIONS,
  D69_PAGE_REVIEW_VERSIONS, D70_PAGE_VERSIONS, D71_READER_VERSIONS, D71_PAGE_VERSIONS, D71_FIX_READER_VERSIONS, D71_FIX_VERSIONS, S7_VERSIONS, S7_READER_VERSIONS, STEPS_READER_VERSIONS,
  ANSWER_ONCE_READER_VERSIONS, REQUEST_STEPS_READER_VERSIONS, ATTACHED_FILE_READER_VERSIONS,
  VALUE_RECEIPT_READER_VERSIONS, REFUSALS_READER_VERSIONS, D80_VERSIONS, D80_READER_VERSIONS,
  D84_OUTPUT_READER_VERSIONS, FIX_COLUMN_VERSIONS, FIX_COLUMN_READER_VERSIONS }
  from './m33-integration-fixture.js';
import { PRELAUNCH_READER_VERSIONS, ASKS_FIXES_VERSIONS, W1_VERSIONS, W1_READER_VERSIONS, W2_READER_VERSIONS,
  W4_READER_VERSIONS, CODE_PASS_READER_VERSIONS, W4_REVERT_READER_VERSIONS, JUDGMENT_FIRST_READER_VERSIONS,
  W2_VERSIONS, W3_VERSIONS, FIX_REVIEW_VERSIONS, CODE_PASS_VERSIONS, CODE_STEP_VERSIONS, CODE_STEP_READER_VERSIONS,
  CODE_STEP_REVIEW_VERSIONS, CODE_STEP_REREVIEW_VERSIONS, CODE_STEP_THIRD_REVIEW_VERSIONS, VOID_VOTE_REASK_VERSIONS, CLEANUP_VERSIONS, CODE_STEP_REVIEW_READER_VERSIONS,
  JUDGMENT_FIRST_REVIEW_READER_VERSIONS, RELEASE_REVIEW_READER_VERSIONS, RELEASE_REVIEW_VERSIONS, AGENTIC_READER_VERSIONS,
  CLEANUP_READER_VERSIONS, REPORT_READER_VERSIONS, REPORT_MD_READER_VERSIONS, ONE_READING_READER_VERSIONS,
  ABSENCE_READER_VERSIONS, ABSENCE_AUDIT_READER_VERSIONS, GROUNDING_CAUSE_READER_VERSIONS,
  SECOND_RELEASE_REVIEW_VERSIONS, CHOICE_REANCHOR_VERSIONS, SKIM_VERSIONS, CITED_WHOLE_VERSIONS, SEEN_READER_VERSIONS,
  ONE_BOUND_READER_VERSIONS, REPAIR_MERGE_READER_VERSIONS, PREMISE_READER_VERSIONS, ACCOUNT_READER_VERSIONS,
  ONE_ITEM_READER_VERSIONS }
  from './m33-integration-fixture.js';

let n = 0;
const uid = () => `5e1d0000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const base = { sessionId: 'sess-ids', cwd: '/repo', version: '2.1.284', gitBranch: 'main', isSidechain: false,
  parentUuid: 'p' };
const HUMAN = { origin: { kind: 'human' }, promptSource: 'sdk' };
const user = (content, extra = {}) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content }, ...extra });
const ask = (text, extra = {}) => user(text, { ...HUMAN, ...extra });
const said = (text) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  content: [{ type: 'text', text }] } });
const call = (id, name, input = {}, text = null) => ({ ...base, type: 'assistant', uuid: uid(), message: { role: 'assistant',
  content: [...(text === null ? [] : [{ type: 'text', text }]), { type: 'tool_use', id, name, input }] } });
const result = (id, content) => user([{ type: 'tool_result', tool_use_id: id, content }]);

/** A synthetic Claude Code session: three requests, commentary, commands with results, a shell write, an edit, and a
 *  harness row (`isMeta`) between the first two requests. */
function claudeRows() {
  n = 0;
  return [
    ask('Add a retry to the fetch helper and keep the public API unchanged.'),
    call('toolu_1', 'Read', { file_path: '/repo/src/fetch.js' }, 'I will read the helper first.'),
    result('toolu_1', 'export function fetchIt() {}'),
    call('toolu_2', 'Bash', { command: 'npm test 2>&1 | tee out.txt' }),
    result('toolu_2', 'ok 1 fetch'),
    said('The helper now retries; the tests pass.'),
    user('<local-command-caveat>Caveat: generated by a local command.</local-command-caveat>', { isMeta: true }),
    ask('Now document the retry in the README.'),
    call('toolu_3', 'Edit', { file_path: '/repo/README.md', old_string: 'Fetch', new_string: 'Fetch (retries)' },
      'Documenting it.'),
    result('toolu_3', 'The file /repo/README.md has been updated successfully.'),
    said('Documented.'),
    ask('Thanks. Run the linter once more.'),
    call('toolu_4', 'Bash', { command: 'npm run lint' }),
    result('toolu_4', 'lint ok'),
    said('Lint is clean.'),
  ];
}

async function sessionOf(rows, name = 'session.jsonl', options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'stable-ids-'));
  try {
    const file = join(dir, name);
    await writeFile(file, rows.map((row) => (typeof row === 'string' ? row : JSON.stringify(row))).join('\n') + '\n');
    const ledger = redact(await sliceLineage([file], { includeSources: true, ...options })).ledger;
    return { ledger, session: sessionFromLedger(ledger, { sessionKey: 'stable' }) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Each canonical event's id, by what it is: its kind and the recorded row, block and sub-event it was read from. */
const idsOf = (session) => session.events.map((event) => event.id);

test('C-01: the adapter re-declares the slicer\'s identity vocabulary exactly', () => {
  assert.equal(IDENTITY_NATIVE.source, NATIVE_ID.source);
  assert.equal(ADAPTER_SUB.source, IDENTITY_SUB.source);
  assert.deepEqual(ADAPTER_KEYS, IDENTITY_KEYS);
  assert.deepEqual(Object.values(EVENT_ID_GAPS), ['event_id_unrecorded', 'event_id_row_unidentified',
    'event_id_withheld', 'event_id_duplicate']);
  assert.ok(Object.isFrozen(EVENT_ID_GAPS));
});

test('C-01: every event of a recorded Claude Code session is named by its row uuid and block, uniquely', async () => {
  const rows = claudeRows();
  const { ledger, session } = await sessionOf(rows);
  const ids = idsOf(session);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  // No id carries a turn or a sequence: each is a recorded uuid, a block, and at most a fixed sub-event suffix.
  const uuids = new Set(rows.map((row) => row.uuid));
  for (const id of ids) {
    const [head, ...rest] = id.split('.');
    assert.ok(uuids.has(head), `${id} is named by a recorded row`);
    assert.ok(rest.length >= 1 && /^\d+$/.test(rest[0]), `${id} names the row's block`);
  }
  assert.deepEqual(eventIdCounts(session), { events: ids.length, derived: ids.length, gaps: {} });
  // The instruction is its row's; an action its tool_use block's; its result `.r`; a shell write `.w<k>` of its call.
  assert.equal(session.events.find((e) => e.kind === 'instruction').id, `${rows[0].uuid}.0`);
  const read = session.events.find((e) => e.kind === 'invocation' && e.tool === 'read');
  assert.equal(read.id, `${rows[1].uuid}.1`);
  assert.equal(session.observationFor(read.id).id, `${rows[1].uuid}.1.r`);
  assert.equal(session.events.find((e) => e.kind === 'commentary' && e.id.startsWith(rows[1].uuid)).id, `${rows[1].uuid}.0`);
  const write = session.events.find((e) => e.kind === 'invocation' && typeof e.shellWriteOf === 'string');
  assert.equal(write.shellWriteOf, `${rows[3].uuid}.0`);
  assert.equal(write.id, `${rows[3].uuid}.0.w0`);
  // The ledger records where each element was read, so a reader joins them by structure, never by an id's shape.
  assert.deepEqual(ledger.ask[0].identity, { stream: 0, record: 1, block: 0, native: rows[0].uuid });
});

test('C-01 (a) prefix stability: a recording truncated at any line names every event of its first lines alike', async () => {
  const rows = claudeRows();
  const full = await sessionOf(rows);
  const fullIds = new Set(idsOf(full.session));
  for (let cut = 1; cut < rows.length; cut++) {
    const prefix = await sessionOf(rows.slice(0, cut));
    for (const id of idsOf(prefix.session))
      assert.ok(fullIds.has(id), `line ${cut}: ${id} names the same event in the whole recording`);
  }
});

test('C-01 (b) relabel stability: changing one harness row\'s label changes no other event\'s id', async () => {
  const rows = claudeRows();
  const before = await sessionOf(rows);
  // The harness row (the recorder's own, `isMeta`) becomes a human submission: it now opens a turn of its own, so every
  // later turn is renumbered — a positional id (`A<turn>-<seq>`) of every later event would move.
  const relabelled = rows.map((row) => (row.isMeta === true ? (({ isMeta, ...rest }) => ({ ...rest, ...HUMAN }))(row) : row));
  const after = await sessionOf(relabelled);
  const harness = rows.find((row) => row.isMeta === true).uuid;
  const turnsBefore = before.session.events.filter((e) => e.kind === 'instruction').map((e) => e.turn);
  const turnsAfter = after.session.events.filter((e) => e.kind === 'instruction').map((e) => e.turn);
  assert.deepEqual(turnsBefore, ['T1', 'T2', 'T3']);
  assert.deepEqual(turnsAfter, ['T1', 'T2', 'T3', 'T4'], 'the turns were renumbered');
  const afterIds = idsOf(after.session);
  assert.deepEqual(afterIds.filter((id) => !id.startsWith(harness)), idsOf(before.session),
    'every other event keeps its id, in its order');
  assert.deepEqual(afterIds.filter((id) => id.startsWith(harness)), [`${harness}.0`], 'the relabelled row is one instruction');
});

test('C-01 (c) a row copied into a forked or resumed recording keeps its id (its uuid)', async () => {
  const rows = claudeRows();
  const original = await sessionOf(rows.slice(0, 6), 'original.jsonl');
  // A resumed recording repeats the earlier rows with the SAME uuids, under its own session id, then goes on.
  const copied = rows.slice(0, 6).map((row) => ({ ...row, sessionId: 'sess-resumed' }));
  const resumed = await sessionOf([...copied, ...rows.slice(6).map((row) => ({ ...row, sessionId: 'sess-resumed' }))],
    'resumed.jsonl');
  const resumedIds = new Set(idsOf(resumed.session));
  for (const id of idsOf(original.session)) assert.ok(resumedIds.has(id), `${id} keeps its id in the resumed recording`);
  // A fork that copies the rows into a later position of its own file still names them by their uuid.
  const forked = await sessionOf([ask('Start over from the earlier session.'), ...copied], 'forked.jsonl');
  const forkedIds = new Set(idsOf(forked.session));
  for (const id of idsOf(original.session)) assert.ok(forkedIds.has(id), `${id} keeps its id where the fork copied it`);
});

test('C-01: a row repeated within one lineage keeps the first claim; the repeat is named by its row position, counted', async () => {
  const rows = claudeRows().slice(0, 6);
  const { session } = await sessionOf([...rows, rows[5]]);
  const ids = idsOf(session);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes(`${rows[5].uuid}.0`));
  assert.ok(ids.includes('s0.L7.0'), 'the repeated row is named by its stream and line');
  assert.deepEqual(eventIdCounts(session).gaps, { [EVENT_ID_GAPS.duplicate]: 1 });
});

test('C-01: a Claude Code row with no uuid is named by its row position and counted', async () => {
  const rows = claudeRows().slice(0, 3).map(({ uuid, ...row }, i) => (i === 0 ? row : { uuid, ...row }));
  const { session } = await sessionOf(rows);
  const instruction = session.events.find((e) => e.kind === 'instruction');
  assert.equal(instruction.id, 's0.L1.0');
  assert.deepEqual(eventIdCounts(session).gaps, { [EVENT_ID_GAPS.rowUnidentified]: 1 });
});

test('C-01: a ledger that records no identity keeps the positional ids every ledger had before, counted', () => {
  const ledger = { ask: [{ turn: 1, text: 'Fix the flaky test.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'npm test', outcome: 'passed', outcomeSource: 'native',
      exitCode: 0, exitCodeSource: 'native', tailLines: ['ok'] }],
    commentary: [{ turn: 1, source: 0, record: 2, block: 0, beforeEvent: 0, text: 'Running the tests.' }],
    sayings: [], marks: [], dropped: [] };
  const session = sessionFromLedger(ledger, { sessionKey: 'legacy' });
  assert.deepEqual(idsOf(session), ['I1', 'C1-0-1', 'A1-0', 'A1-0-r']);
  assert.deepEqual(eventIdCounts(session), { events: 4, derived: 0, gaps: { [EVENT_ID_GAPS.unrecorded]: 4 } });
});

test('C-01: a Codex rollout names a call by its call_id and part, a message by its item id, else by its line', async () => {
  const rec = (payload) => JSON.stringify({ type: 'response_item', timestamp: '', payload });
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-ids', cwd: '/repo', cli_version: '0.117.0' } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build it.' }] }),
    rec({ type: 'message', role: 'assistant', id: 'msg_0a1b2c', content: [{ type: 'output_text', text: 'Building.' }] }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'call_build', arguments: '{"cmd":"make build"}' }),
    rec({ type: 'function_call_output', call_id: 'call_build', output: 'Process exited with code 0\nOutput:\nbuilt' }),
  ];
  const { session } = await sessionOf(lines, 'rollout-2026-10-07T10-00-00-ids.jsonl');
  const byKind = (kind) => session.events.filter((e) => e.kind === kind).map((e) => e.id);
  assert.deepEqual(byKind('instruction'), ['s0.L2.0'], 'a message with no item id is named by its line');
  assert.deepEqual(byKind('commentary'), ['msg_0a1b2c.0']);
  assert.deepEqual(byKind('invocation'), ['call_build.0']);
  assert.deepEqual(byKind('observation'), ['call_build.0.r']);
  // Codex's own rule names a message with no item id by its line: no gap.
  assert.deepEqual(eventIdCounts(session).gaps, {});
  // Prefix stability holds on the rollout too (it is append-only).
  const prefix = await sessionOf(lines.slice(0, 4), 'rollout-2026-10-07T10-00-00-ids.jsonl');
  for (const id of idsOf(prefix.session)) assert.ok(idsOf(session).includes(id));
});

test('C-01: a recorder id an earlier redaction withheld is never an id: the event is named by its row position, counted', async () => {
  const rec = (payload) => JSON.stringify({ type: 'response_item', timestamp: '', payload });
  // A synthetic call id redaction's backstop scans as a possible credential (mixed case and digits, high entropy).
  const secretShaped = 'call_7CrfqsOSIDBHB0nXutiLsYj4';
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { id: 'codex-withheld', cwd: '/repo', cli_version: '0.117.0' } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build it.' }] }),
    rec({ type: 'function_call', name: 'exec_command', call_id: secretShaped, arguments: '{"cmd":"make build"}' }),
    rec({ type: 'function_call_output', call_id: secretShaped, output: 'Process exited with code 0\nOutput:\nbuilt' }),
  ];
  const { ledger: today } = await sessionOf(lines, 'rollout-2026-10-07T10-00-00-withheld.jsonl');
  // D90 (owner decision 2026-10-15): today the id is kept as recorded; a ledger an earlier Sonah wrote carries it
  // withheld whole (fails closed), never masked into an id, and is read so.
  assert.deepEqual(today.ledger[0].identity, { stream: 0, record: 3, block: 0, native: secretShaped });
  const ledger = structuredClone(today);
  for (const event of ledger.ledger)
    if (event.identity?.native === secretShaped) event.identity = { stream: 0, record: event.identity.record, block: 0, withheld: true };
  const session = sessionFromLedger(redact(ledger).ledger, { sessionKey: 'stable' });
  assert.deepEqual(ledger.ledger[0].identity, { stream: 0, record: 3, block: 0, withheld: true });
  assert.deepEqual(session.events.filter((e) => e.kind === 'invocation').map((e) => e.id), ['s0.L3.0']);
  assert.ok(!idsOf(session).some((id) => id.includes(secretShaped)));
  assert.deepEqual(eventIdCounts(session).gaps, { [EVENT_ID_GAPS.withheld]: 2 });
});

test('C-01: every instrument whose bytes name an event moved by its ids alone, and each took one next version', async () => {
  const { ledger } = await sessionOf(claudeRows());
  const session = adapt(ledger, { sessionKey: 'stable' });
  const twin = twinOf(session);
  // A window of the last request's events: a challenge item citing its closing statement is shown a dossier of it
  // (prompt.js `buildChallengeDossier`). (M35 retired the carry, whose bytes this also checked.)
  const windowOf = (s) => {
    const from = s.events.filter((e) => e.kind === 'instruction').at(-1).sequence;
    return { index: 0, events: s.events.filter((e) => e.sequence >= from) };
  };
  const items = (s) => [{ key: 'claims:0', type: 'claim', candidate: { text: 'Lint is clean.', stated: {
    eventId: windowOf(s).events.find((e) => e.kind === 'commentary').id, role: 'commentary', quote: 'Lint is clean.' } } }];
  const dossier = (s) => buildChallengeDossier({ session: s, window: windowOf(s), items: items(s) }).evidencePrompt;
  for (const [name, of] of [['dossier', dossier]]) {
    assert.notEqual(of(session), of(twin), `${name}: a recorded session's bytes name its events by their stable ids`);
    // Rendered back to the positional ids, they are the twin's byte for byte: nothing but the ids moved.
    assert.equal(textBeforeStableIds(session, of(session), of(twin)), of(twin), name);
  }
  assert.equal(beforeStableIds(session, items(session)[0].candidate.stated.eventId), items(twin)[0].candidate.stated.eventId);
  // So each such instrument took ONE next version, as the narrative did (C-01 *Versions*): the narrative, the challenge
  // (its candidates' receipts and the evidence it shows), the dossier, the code review (the narrative evidence it shares)
  // and the carry. The story and the page render no event id and keep theirs.
  // (The narrative and the code review moved once more since, by the D64 wording's proposer sentences alone:
  // DISCLOSURE_WORDS_VERSIONS, whose `before` is each one's stable-ids version.)
  // (And every one of them moved once more since, by M35 windowing: WINDOWING_VERSIONS, whose `before` is each one's
  // version before it; the carry is retired.)
  const now = { ...STABLE_IDS_VERSIONS, prompt: DISCLOSURE_WORDS_VERSIONS.prompt,
    codeReview: DISCLOSURE_WORDS_VERSIONS.codeReview };
  for (const k of ['prompt', 'codeReview']) assert.equal(DISCLOSURE_WORDS_VERSIONS[k].before, STABLE_IDS_VERSIONS[k].after);
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview', 'carry']) assert.equal(WINDOWING_VERSIONS[k].before, now[k].after, k);
  // (And the four request instruments once more by M36 phase 1, the evidence they carry: RECORDED_FACTS_VERSIONS.)
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview'])
    assert.equal(RECORDED_FACTS_VERSIONS[k].before, WINDOWING_VERSIONS[k].after, k);
  // (And the four request instruments and the windowing profile once more by M36 phase 3: CONVERSATION_VERSIONS.)
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview', 'windows'])
    assert.equal(CONVERSATION_VERSIONS[k].before, FORMAT_VERSIONS[k].after, k);
  // D71 (S2) moved each once more (D71_BRIEF_VERSIONS): the reviewer brief as the checklist.
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview', 'windows'])
    assert.equal(D71_BRIEF_VERSIONS[k].before, D69_REVIEW_VERSIONS[k].after, k);
  // D71 (S3) moved three of them once more (D71_CHANNELS_VERSIONS): the new channels; the code review and the window
  // format did not move.
  for (const k of ['prompt', 'challenge', 'dossier'])
    assert.equal(D71_CHANNELS_VERSIONS[k].before, D71_BRIEF_VERSIONS[k].after, k);
  // S6 moved two of them once more (D71_FIX_VERSIONS): the output-no-status words (narrative, dossier).
  for (const k of ['prompt', 'dossier']) assert.equal(D71_FIX_VERSIONS[k].before, D71_CHANNELS_VERSIONS[k].after, k);
  // S7 moved three of them once more (S7_VERSIONS): the outcome classes `stopped` and `not-typed` left the table.
  for (const k of ['prompt', 'dossier']) assert.equal(S7_VERSIONS[k].before, D71_FIX_VERSIONS[k].after, k);
  assert.equal(S7_VERSIONS.challenge.before, D71_CHANNELS_VERSIONS.challenge.after);
  // The D80 integration moved two of them once more (D80_VERSIONS): a stopped call's outcome line (narrative, dossier).
  for (const k of ['prompt', 'dossier']) assert.equal(D80_VERSIONS[k].before, S7_VERSIONS[k].after, k);
  // The column fix moved the challenge once more (FIX_COLUMN_VERSIONS): who decided a decision (its note and
  // propositions); the narrative, the dossier, the code review and the window format did not move.
  assert.equal(FIX_COLUMN_VERSIONS.challenge.before, S7_VERSIONS.challenge.after);
  // The asks fixes moved the narrative once more (ASKS_FIXES_VERSIONS): S3's re-ask of a refuted requirement.
  assert.equal(ASKS_FIXES_VERSIONS.prompt.before, D80_VERSIONS.prompt.after);
  // W1 A moved the narrative once more (W1_VERSIONS): the re-ask of a decision refuted on who decided it; and W1 B the
  // challenge (the file form of the forbidden-edit proposition and its note).
  assert.equal(W1_VERSIONS.prompt.before, ASKS_FIXES_VERSIONS.prompt.after);
  assert.equal(W1_VERSIONS.challenge.before, FIX_COLUMN_VERSIONS.challenge.after);
  // W2 moved the challenge once more (W2_VERSIONS): CLAIM_NOTE judges the agent's own written text like a result.
  assert.equal(W2_VERSIONS.challenge.before, W1_VERSIONS.challenge.after);
  // W3 F1(b) moved it once more (W3_VERSIONS): a support with changes since its run is asked, listed.
  assert.equal(W3_VERSIONS.challenge.before, W2_VERSIONS.challenge.after);
  // The fix review moved it once more (FIX_REVIEW_VERSIONS): a cancelled or stopped result, as a failed one.
  assert.equal(FIX_REVIEW_VERSIONS.challenge.before, W3_VERSIONS.challenge.after);
  // D87 moved it once more (CODE_PASS_VERSIONS: challenge): the code pass's own run; no other request byte moved.
  assert.equal(CODE_PASS_VERSIONS.challenge.before, FIX_REVIEW_VERSIONS.challenge.after);
  // The code step moved it once more (CODE_STEP_VERSIONS: challenge): the code pass's run left challengeItems.
  assert.equal(CODE_STEP_VERSIONS.challenge.before, CODE_PASS_VERSIONS.challenge.after);
  // The review of the code step moved it once more (CODE_STEP_REVIEW_VERSIONS: challenge): no `duplicate`, and a
  // finding's checker sees no agent words.
  assert.equal(CODE_STEP_REVIEW_VERSIONS.challenge.before, CODE_STEP_VERSIONS.challenge.after);
  // The second review of the code step moved it once more (CODE_STEP_REREVIEW_VERSIONS: challenge): a code check's
  // checker sees no word of the agent's in any row.
  assert.equal(CODE_STEP_REREVIEW_VERSIONS.challenge.before, CODE_STEP_REVIEW_VERSIONS.challenge.after);
  // The third review of the code step moved it once more (CODE_STEP_THIRD_REVIEW_VERSIONS: challenge): a code
  // check's checker sees what its row states again.
  assert.equal(CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.before, CODE_STEP_REREVIEW_VERSIONS.challenge.after);
  // The release review moved the prompt once more (RELEASE_REVIEW_VERSIONS: prompt): a project instruction file the
  // session wrote is left out of the window.
  assert.equal(RELEASE_REVIEW_VERSIONS.prompt.before, W1_VERSIONS.prompt.after);
  // The second release review moved it once more (SECOND_RELEASE_REVIEW_VERSIONS: prompt): that file's path is compared
  // under the working directory.
  assert.equal(SECOND_RELEASE_REVIEW_VERSIONS.prompt.before, RELEASE_REVIEW_VERSIONS.prompt.after);
  // The re-ask of a void vote moved it once more (VOID_VOTE_REASK_VERSIONS: challenge): a vote a reply cast that could
  // not be counted is asked again once, naming its cause.
  assert.equal(VOID_VOTE_REASK_VERSIONS.challenge.before, CODE_STEP_THIRD_REVIEW_VERSIONS.challenge.after);
  // G2 moved it once more (CHOICE_REANCHOR_VERSIONS: prompt): the re-ask of a choice not to act whose existence check
  // refuted its words.
  assert.equal(CHOICE_REANCHOR_VERSIONS.prompt.before, SECOND_RELEASE_REVIEW_VERSIONS.prompt.after);
  // Its withdrawal moved it once more (CLEANUP_VERSIONS: challenge): a vote a reply cast that could not be counted
  // stands again, as before /43.
  assert.equal(CLEANUP_VERSIONS.challenge.before, VOID_VOTE_REASK_VERSIONS.challenge.after);
  // D103 moved the prompt and the window format once more (SKIM_VERSIONS): the skim keyed by the recording's harness.
  assert.equal(SKIM_VERSIONS.prompt.before, CHOICE_REANCHOR_VERSIONS.prompt.after);
  assert.equal(SKIM_VERSIONS.windows.before, D71_BRIEF_VERSIONS.windows.after);
  // And the dossier (SKIM_VERSIONS: dossier): the evidence a session-only dossier shows moved as the narrative's.
  assert.equal(SKIM_VERSIONS.dossier.before, D80_VERSIONS.dossier.after);
  assert.deepEqual([PROMPT_VERSION, CHALLENGE_PROFILE.version, CHALLENGE_DOSSIER_VERSION, CODE_REVIEW_VERSION,
    WINDOWING_VERSION], [SKIM_VERSIONS.prompt.after, CITED_WHOLE_VERSIONS.challenge.after,
    CITED_WHOLE_VERSIONS.dossier.after, D71_BRIEF_VERSIONS.codeReview.after, SKIM_VERSIONS.windows.after]);
  // D103 moved the challenge and the dossier once more (CITED_WHOLE_VERSIONS): cited results shown whole.
  assert.equal(CITED_WHOLE_VERSIONS.challenge.before, CLEANUP_VERSIONS.challenge.after);
  assert.equal(CITED_WHOLE_VERSIONS.dossier.before, SKIM_VERSIONS.dossier.after);
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview', 'windows'])
    assert.equal(D69_VERSIONS[k].before, CONVERSATION_VERSIONS[k].after, k);
  // (And all five once more by the D69 review: D69_REVIEW_VERSIONS.)
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview', 'windows'])
    assert.equal(D69_REVIEW_VERSIONS[k].before, D69_VERSIONS[k].after, k);
  // (And the four request instruments and the windowing profile once more by M36 phase 2, the window format.)
  for (const k of ['prompt', 'challenge', 'dossier', 'codeReview'])
    assert.equal(FORMAT_VERSIONS[k].before, RECORDED_FACTS_VERSIONS[k].after, k);
  assert.equal(FORMAT_VERSIONS.windows.before, WINDOWING_VERSIONS.windows.after);
  // (The story and the page moved once more since, by the D64 wording's reader words alone: DISCLOSURE_WORDS_VERSIONS;
  // and the story once more by M35's helper placement: WINDOWING_VERSIONS.)
  assert.equal(WINDOWING_VERSIONS.story.before, DISCLOSURE_WORDS_VERSIONS.story.after);
  // (And the story once more by M36 phase 3's packed windows: CONVERSATION_VERSIONS.)
  assert.equal(CONVERSATION_VERSIONS.story.before, WINDOWING_VERSIONS.story.after);
  // (And the page once more by D69 (f), the judgment-first page: D69_PAGE_VERSIONS.)
  assert.equal(D69_PAGE_VERSIONS.page.before, DISCLOSURE_WORDS_VERSIONS.page.after);
  // (And the page once more by its review, D69 f (g): D69_PAGE_REVIEW_VERSIONS; and by D70 (b): D70_PAGE_VERSIONS.)
  assert.equal(D69_PAGE_REVIEW_VERSIONS.page.before, D69_PAGE_VERSIONS.page.after);
  assert.equal(D70_PAGE_VERSIONS.page.before, D69_PAGE_REVIEW_VERSIONS.page.after);
  // (And both once more by D71 (a), no verdict: D71_READER_VERSIONS.)
  assert.deepEqual([D71_READER_VERSIONS.story.before, D71_READER_VERSIONS.page.before],
    [CONVERSATION_VERSIONS.story.after, D70_PAGE_VERSIONS.page.after]);
  // (And both once more by D71 (S4), the page as the checklist: D71_PAGE_VERSIONS.)
  assert.deepEqual([D71_PAGE_VERSIONS.story.before, D71_PAGE_VERSIONS.page.before],
    [D71_READER_VERSIONS.story.after, D71_READER_VERSIONS.page.after]);
  // (And both once more by S6, the fixes of the S5 review: D71_FIX_READER_VERSIONS.)
  assert.deepEqual([D71_FIX_READER_VERSIONS.story.before, D71_FIX_READER_VERSIONS.page.before],
    [D71_PAGE_VERSIONS.story.after, D71_PAGE_VERSIONS.page.after]);
  // (And the page once more by S7: S7_READER_VERSIONS.)
  assert.equal(S7_READER_VERSIONS.page.before, D71_FIX_READER_VERSIONS.page.after);
  // (And the page once more by night/steps: STEPS_READER_VERSIONS.)
  assert.equal(STEPS_READER_VERSIONS.page.before, S7_READER_VERSIONS.page.after);
  // (And the page once more by the answer command printed once: ANSWER_ONCE_READER_VERSIONS.)
  assert.equal(ANSWER_ONCE_READER_VERSIONS.page.before, STEPS_READER_VERSIONS.page.after);
  // (And both once more by D77 C, a step is one of your requests: REQUEST_STEPS_READER_VERSIONS.)
  assert.deepEqual([REQUEST_STEPS_READER_VERSIONS.story.before, REQUEST_STEPS_READER_VERSIONS.page.before],
    [D71_FIX_READER_VERSIONS.story.after, ANSWER_ONCE_READER_VERSIONS.page.after]);
  // (And both once more by D79, a file you attached belongs to its message's request: ATTACHED_FILE_READER_VERSIONS.)
  assert.deepEqual([ATTACHED_FILE_READER_VERSIONS.story.before, ATTACHED_FILE_READER_VERSIONS.page.before],
    [REQUEST_STEPS_READER_VERSIONS.story.after, REQUEST_STEPS_READER_VERSIONS.page.after]);
  // (And the page once more by D79, a verbatim value receipt kept when the value is a paraphrase:
  // VALUE_RECEIPT_READER_VERSIONS; the story keeps its version.)
  assert.equal(VALUE_RECEIPT_READER_VERSIONS.page.before, ATTACHED_FILE_READER_VERSIONS.page.after);
  // (And both once more by D79, a refused command did not run: REFUSALS_READER_VERSIONS.)
  assert.deepEqual([REFUSALS_READER_VERSIONS.story.before, REFUSALS_READER_VERSIONS.page.before],
    [ATTACHED_FILE_READER_VERSIONS.story.after, VALUE_RECEIPT_READER_VERSIONS.page.after]);
  // (And both once more by the D80 integration, its four items in one step: D80_READER_VERSIONS.)
  assert.deepEqual([D80_READER_VERSIONS.story.before, D80_READER_VERSIONS.page.before],
    [REFUSALS_READER_VERSIONS.story.after, REFUSALS_READER_VERSIONS.page.after]);
  // (And the page once more by D84 (4) c, the steps not fully reviewed named: PRELAUNCH_READER_VERSIONS.)
  assert.equal(PRELAUNCH_READER_VERSIONS.page.before, D80_READER_VERSIONS.page.after);
  // (And both once more by D84, what they show is masked: D84_OUTPUT_READER_VERSIONS; the page after the pre-launch
  // items' /22.)
  assert.deepEqual([D84_OUTPUT_READER_VERSIONS.story.before, D84_OUTPUT_READER_VERSIONS.page.before],
    [D80_READER_VERSIONS.story.after, PRELAUNCH_READER_VERSIONS.page.after]);
  // (And both once more by the column fix, a decision a project instruction file covers names it:
  // FIX_COLUMN_READER_VERSIONS, after D84's. Page /20 and /21 were decisions step 3's and D83 (2)'s, reverted and never
  // reused.)
  assert.deepEqual([FIX_COLUMN_READER_VERSIONS.story.before, FIX_COLUMN_READER_VERSIONS.page.before],
    [D84_OUTPUT_READER_VERSIONS.story.after, D84_OUTPUT_READER_VERSIONS.page.after]);
  // (And the page once more by W1 A, a decision kept "could not tell" for a refuted column says why, and both by W1 B,
  // a project file's rule of an edit is labelled as the file's: W1_READER_VERSIONS.)
  assert.deepEqual([W1_READER_VERSIONS.story.before, W1_READER_VERSIONS.page.before],
    [FIX_COLUMN_READER_VERSIONS.story.after, FIX_COLUMN_READER_VERSIONS.page.after]);
  // (And both once more by W2, the agent's own earlier text that contradicts a claim or a written statement says so:
  // W2_READER_VERSIONS.)
  assert.deepEqual([W2_READER_VERSIONS.story.before, W2_READER_VERSIONS.page.before],
    [W1_READER_VERSIONS.story.after, W1_READER_VERSIONS.page.after]);
  // (And both once more by W4, an ask no action followed reads not done in this session — the story since the review of
  // W4: W4_READER_VERSIONS; reverted below.)
  assert.deepEqual([W4_READER_VERSIONS.story.before, W4_READER_VERSIONS.page.before],
    [W2_READER_VERSIONS.story.after, W2_READER_VERSIONS.page.after]);
  // (And both once more by D87, a review with a code pass lists what the code review found: CODE_PASS_READER_VERSIONS.)
  assert.deepEqual([CODE_PASS_READER_VERSIONS.story.before, CODE_PASS_READER_VERSIONS.page.before],
    [W4_READER_VERSIONS.story.after, W4_READER_VERSIONS.page.after]);
  // (And both once more by the W4 revert, W4's words beside an ask gone with W4: W4_REVERT_READER_VERSIONS.)
  assert.deepEqual([W4_REVERT_READER_VERSIONS.story.before, W4_REVERT_READER_VERSIONS.page.before],
    [CODE_PASS_READER_VERSIONS.story.after, CODE_PASS_READER_VERSIONS.page.after]);
  // (And both once more by D88, the judgment and the settled problems first, the rows Sonah could not check folded:
  // JUDGMENT_FIRST_READER_VERSIONS.)
  assert.deepEqual([JUDGMENT_FIRST_READER_VERSIONS.story.before, JUDGMENT_FIRST_READER_VERSIONS.page.before],
    [W4_REVERT_READER_VERSIONS.story.after, W4_REVERT_READER_VERSIONS.page.after]);
  // (And both once more by the code step, what the code review found in the method's order: CODE_STEP_READER_VERSIONS,
  // after D88's link, renumbered at their merge.)
  assert.deepEqual([CODE_STEP_READER_VERSIONS.story.before, CODE_STEP_READER_VERSIONS.page.before],
    [JUDGMENT_FIRST_READER_VERSIONS.story.after, JUDGMENT_FIRST_READER_VERSIONS.page.after]);
  // (And both once more by the review of the code step, the footer counts paths outside the working directory:
  // CODE_STEP_REVIEW_READER_VERSIONS.)
  assert.deepEqual([CODE_STEP_REVIEW_READER_VERSIONS.story.before, CODE_STEP_REVIEW_READER_VERSIONS.page.before],
    [CODE_STEP_READER_VERSIONS.story.after, CODE_STEP_READER_VERSIONS.page.after]);
  // (And both once more by the judgment-first review's low findings, one counting for every reader and the folded
  // groups headed by their whole count: JUDGMENT_FIRST_REVIEW_READER_VERSIONS.)
  assert.deepEqual([JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.before, JUDGMENT_FIRST_REVIEW_READER_VERSIONS.page.before],
    [CODE_STEP_REVIEW_READER_VERSIONS.story.after, CODE_STEP_REVIEW_READER_VERSIONS.page.after]);
  // (And both once more by the release review, the home folder as the repository in the footer:
  // RELEASE_REVIEW_READER_VERSIONS.)
  assert.deepEqual([RELEASE_REVIEW_READER_VERSIONS.story.before, RELEASE_REVIEW_READER_VERSIONS.page.before],
    [JUDGMENT_FIRST_REVIEW_READER_VERSIONS.story.after, JUDGMENT_FIRST_REVIEW_READER_VERSIONS.page.after]);
  // (And both once more by the agentic code step's release item: AGENTIC_READER_VERSIONS, one link for the item — an
  // ask's status beside what the code step tied to it, the session shown as loaded, the code step's new report on
  // every reader — rendering back to the release review's.)
  assert.deepEqual([RELEASE_REVIEW_READER_VERSIONS.story.after, RELEASE_REVIEW_READER_VERSIONS.page.after],
    ['sonah.session-story/29', 'sonah.session-page/34']);
  // (And both once more by the cleanup: CLEANUP_READER_VERSIONS, one link — no statement found to hold, no row shown in
  // the code, no claim found false and no all-clear footer — rendering back to the agentic code step's.)
  assert.deepEqual([CLEANUP_READER_VERSIONS.story.before, CLEANUP_READER_VERSIONS.page.before],
    [AGENTIC_READER_VERSIONS.story, AGENTIC_READER_VERSIONS.page]);
  // (And the page once more by the report model, D97: REPORT_READER_VERSIONS, one link after the cleanup's; and the
  // story, now the report .md: REPORT_MD_READER_VERSIONS, one link after the cleanup's.)
  assert.equal(REPORT_READER_VERSIONS.page.before, CLEANUP_READER_VERSIONS.page.after);
  assert.equal(REPORT_MD_READER_VERSIONS.story.before, CLEANUP_READER_VERSIONS.story.after);
  // (And both once more by D98, ONE_READING_READER_VERSIONS: one link after D97's, one effect rule.)
  assert.deepEqual([ONE_READING_READER_VERSIONS.story.before, ONE_READING_READER_VERSIONS.page.before],
    [REPORT_MD_READER_VERSIONS.story.after, REPORT_READER_VERSIONS.page.after]);
  // (And both once more by D99, ABSENCE_READER_VERSIONS: one link after D98's, an absence only where code proves it.)
  assert.deepEqual([ABSENCE_READER_VERSIONS.story.before, ABSENCE_READER_VERSIONS.page.before],
    [ONE_READING_READER_VERSIONS.story.after, ONE_READING_READER_VERSIONS.page.after]);
  // (And both once more by D100, ABSENCE_AUDIT_READER_VERSIONS: one link after D99's, the audit of absence sentences.)
  assert.deepEqual([ABSENCE_AUDIT_READER_VERSIONS.story.before, ABSENCE_AUDIT_READER_VERSIONS.page.before],
    [ABSENCE_READER_VERSIONS.story.after, ABSENCE_READER_VERSIONS.page.after]);
  // (And both once more by D101, GROUNDING_CAUSE_READER_VERSIONS: one link after D100's, an ask says which test refused
  // its quote.)
  assert.deepEqual([GROUNDING_CAUSE_READER_VERSIONS.story.before, GROUNDING_CAUSE_READER_VERSIONS.page.before],
    [ABSENCE_AUDIT_READER_VERSIONS.story.after, ABSENCE_AUDIT_READER_VERSIONS.page.after]);
  // (And both once more by the shown-in-part mark, D104: SEEN_READER_VERSIONS, one link after D101's.)
  assert.deepEqual([SEEN_READER_VERSIONS.story.before, SEEN_READER_VERSIONS.page.before],
    [GROUNDING_CAUSE_READER_VERSIONS.story.after, GROUNDING_CAUSE_READER_VERSIONS.page.after]);
  // (And both once more by bucket B, D105 and D107 in one move: ONE_BOUND_READER_VERSIONS, REPAIR_MERGE_READER_VERSIONS,
  // one link after D104's: what the code review saw, and why no repaired version was checked, by identity.)
  assert.deepEqual(REPAIR_MERGE_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual([ONE_BOUND_READER_VERSIONS.story.before, ONE_BOUND_READER_VERSIONS.page.before],
    [SEEN_READER_VERSIONS.story.after, SEEN_READER_VERSIONS.page.after]);
  // (And in the same move, 0.3.0-beta.4 moving each reader once: D110, PREMISE_READER_VERSIONS, the premise contract;
  // D111, ACCOUNT_READER_VERSIONS, the accounting's footer counts; D112, ONE_ITEM_READER_VERSIONS, an item's members,
  // and the order by final level.)
  assert.deepEqual(PREMISE_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual(ACCOUNT_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual(ONE_ITEM_READER_VERSIONS, ONE_BOUND_READER_VERSIONS);
  assert.deepEqual([STORY_VERSION, PAGE_VERSION], [ONE_BOUND_READER_VERSIONS.story.after,
    ONE_BOUND_READER_VERSIONS.page.after]);
  for (const k of ['story', 'page']) assert.equal(DISCLOSURE_WORDS_VERSIONS[k].before, INTEGRATION_VERSIONS[k].after);
});
