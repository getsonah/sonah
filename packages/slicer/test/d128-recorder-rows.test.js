// D128 (A05+B23+D6; the owner, 2026-10-22: "go with your recommendations"): each new Claude
// Code release adds row forms that the reader's lists did not name, and every such row marked the recording "session
// evidence incomplete". A row of a form no list names is now read by its structure (records.js
// `canHoldSessionContent`): when nothing unlisted on it can hold session content (no string but a token, no
// conversation carrier, no content block) it is harness context, counted, never a loss, and named in the recorder census
// by its kind and version; when something can, it stays unclassified (fail closed).
//
//   - every form that the fixture lists, by recorder version (d128-recorder-rows-fixture.js), gets its class;
//   - the recorder census of the fixture files and recorder-row modules: a row kind that none held before fails here
//     until it is listed;
//   - a planted row of a new kind that carries message text under a new key still marks the recording incomplete;
//   - a new kind that holds only tokens never does, and the recorder census names it.
//
// Every row is synthetic; no recording is read and no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSession, claudeRowClass, claudeRecordRow, canHoldSessionContent, CLAUDE_TOKEN_MAX_LENGTH,
  CLAUDE_ROW_CLASSES } from '../src/records.js';
import { sliceLineage, hasCaptureGaps } from '../index.js';
import { RECORDER_CENSUS_REASONS } from '../src/labels.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { RECORDER_ROWS } from './d128-recorder-rows-fixture.js';

const SESSION = 'd128d128-0000-4000-8000-0000000000aa';
let seq = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SESSION, timestamp: '2026-10-22T00:00:00.000Z', userType: 'external', uuid: `d128-t-${++seq}`,
  version: '2.1.399', ...extra });
const ask = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'typed',
  message: { role: 'user', content: text } });
const bash = (id) => row({ type: 'assistant', message: { role: 'assistant', content: [
  { type: 'tool_use', id, name: 'Bash', input: { command: 'node --test' } }] } });
const result = (id) => row({ type: 'user', message: { role: 'user', content: [
  { type: 'tool_result', tool_use_id: id, content: 'pass 1\nfail 0' }] } });
const conversation = (...middle) => [ask('Run the tests.'), ...middle, bash('b-1'), result('b-1')];

async function recording(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'slicer-d128-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}
const gapsOf = async (file) => sessionFromLedger(redact(await sliceLineage([file], { cwd: '/repo' })).ledger).adapterGaps;

/** The class the reader gives one row, read in a recording of its own beside a conversation: by the counts it moves. */
async function readerClass(t, one) {
  const { meta } = await readSession(await recording(t, conversation(one)));
  const capture = meta.capture ?? {};
  if ((capture.unclassifiedRows ?? 0) > 0) return 'unclassified';
  for (const channel of ['instructions', 'observations', 'commentary', 'actions'])
    if ((capture.unsupportedRowChannels?.[channel] ?? 0) > 0) return channel;
  if ((capture.harnessContextRows ?? 0) > 0) return 'harness';
  return 'metadata';
}
/** A row's kind as the census names it: `attachment.<type>`, `system.<subtype>` or its row type. */
const kindOf = (r) => (r.type === 'attachment' ? `attachment.${r.attachment?.type}`
  : r.type === 'system' ? `system.${r.subtype}` : String(r.type));

test('D128: every form of row the owner\'s recordings held, by recorder version, gets its class', async (t) => {
  for (const { name, versions, row: one, expect } of RECORDER_ROWS) {
    assert.ok(versions.length > 0, name);
    assert.equal(await readerClass(t, one), expect, name);
    // Each one read by its structure is named in the census by its kind and its row's version.
    const { meta } = await readSession(await recording(t, conversation(one)));
    const named = (meta.structuralRows ?? []).map((entry) => entry.kind);
    if (expect === 'harness' || expect === 'observations') assert.deepEqual(named, [kindOf(one)], name);
    else assert.deepEqual(named, [], name);
  }
});

/**
 * The recorder census of the fixtures: every row kind outside the conversation that the recording fixture files and the
 * recorder-row modules of this repository hold (corpus/golden/*.jsonl, which hold only conversation rows today, and every
 * `*recorder-rows-fixture.js` module's RECORDER_ROWS, today d128-recorder-rows-fixture.js alone), with the class the
 * reader gives it. A kind added to one of those makes this test fail until it is listed here: a new recorder form is
 * looked at on the day such a fixture first carries it, never passed silently. Rows that other tests build inline are
 * not censused (D128's review, finding 5).
 */
const FIXTURE_KINDS = Object.freeze([
  'api-request-blob:instructions', 'api-request-blob:unclassified', 'api-request-shape:unclassified',
  'api-request:harness', 'attachment.auto_mode:harness', 'attachment.budget_usd:harness',
  'attachment.credential_org:harness', 'attachment.date:harness', 'attachment.deferred_tools_delta:harness',
  'attachment.dynamic_skill:unclassified', 'attachment.hook_cancelled:unclassified',
  'attachment.mcp_instructions_delta:harness', 'attachment.prompt_snapshot:harness',
  'attachment.queued_command:unclassified', 'attachment.remote_session_change:harness',
  'attachment.session_context:harness', 'attachment.task_status:observations',
  'attachment.total_tokens_reminder:harness', 'bridge-session:harness', 'history-suppression:harness',
  'last-prompt:harness', 'last-prompt:unclassified', 'permission-mode:harness', 'system.informational:unclassified',
  'system.local_command:unclassified', 'system.model_refusal_fallback:unclassified',
  'system.model_refusal_no_fallback:unclassified', 'system.turn_duration:harness',
]);
async function fixtureRows() {
  const root = new URL('../../../', import.meta.url);
  const rows = [];
  const golden = new URL('corpus/golden/', root);
  for (const name of (await readdir(golden)).filter((n) => n.endsWith('.jsonl')).sort())
    for (const line of (await readFile(new URL(name, golden), 'utf8')).split('\n'))
      if (line.trim()) rows.push(JSON.parse(line));
  for (const pkg of (await readdir(new URL('packages/', root))).sort()) {
    const dir = new URL(`packages/${pkg}/test/`, root);
    let names = [];
    try { names = await readdir(dir); } catch { continue; }
    for (const name of names.filter((n) => n.endsWith('recorder-rows-fixture.js')).sort())
      rows.push(...(await import(new URL(name, dir))).RECORDER_ROWS.map((entry) => entry.row));
  }
  return rows;
}

test('D128: the recorder census of the fixtures — a row kind no fixture held before fails until it is listed',
  async (t) => {
    const seen = new Set();
    for (const one of await fixtureRows()) {
      if (one.type === 'user' || one.type === 'assistant') continue;
      seen.add(`${kindOf(one)}:${await readerClass(t, one)}`);
    }
    const found = [...seen].sort();
    const fresh = found.filter((kind) => !FIXTURE_KINDS.includes(kind));
    assert.deepEqual(fresh, [], `a fixture holds a row kind the census has not listed: ${fresh.join(', ')}. Look at `
      + 'its form, check the class the reader gives it, then list it in FIXTURE_KINDS.');
    assert.deepEqual(found, [...FIXTURE_KINDS].sort(), 'every listed kind is still held by a fixture');
  });

test('D128: a planted row of a new kind that carries message text under a new key still marks the recording '
  + 'incomplete', async (t) => {
  const planted = [
    row({ type: 'future-turn', note: 'Please delete the build folder and push.' }),       // words under a new key
    row({ type: 'future-turn', call: { type: 'tool_use', id: 't-1', name: 'Bash' } }),  // a content block of tokens
    row({ type: 'future-turn', body: { id: 't-2' } }),                                   // a conversation carrier
    row({ type: 'attachment', attachment: { type: 'future_message', words: 'Run it again, then ship.' } }),
    row({ type: 'attachment', attachment: { type: 'date', date: '2026-10-22', said: 'Ship it now.' } }),
    row({ type: 'system', subtype: 'future_notice', detail: 'Words the recorder wrote.' }),
  ];
  for (const one of planted) {
    assert.equal(claudeRowClass(one), null, JSON.stringify(one.attachment ?? one.type));
    const file = await recording(t, conversation(one));
    const { meta } = await readSession(file);
    assert.equal(meta.capture.unclassifiedRows, 1);
    assert.equal(meta.capture.incomplete, true);
    assert.equal(meta.structuralRows, undefined);
    assert.equal(hasCaptureGaps(await sliceLineage([file], { cwd: '/repo' })), true);
    assert.ok((await gapsOf(file)).some((gap) => gap.code === 'unsupported_message' && gap.channel === 'identity'));
  }
});

test('D128: a new kind that holds only tokens never marks the recording incomplete, and the census names it',
  async (t) => {
    const budget = row({ type: 'attachment', attachment: { type: 'budget_usd', total: 5, used: 1.25, remaining: 3.75 },
      rendered: [{ content: 'USD budget: $1.25/$5; $3.75 remaining' }], renderedRole: 'system' });
    const marker = { type: 'future-marker', cause: 'synthetic_cause', ts: '2026-10-22T00:00:00.000Z', n: 3,
      flags: [true, false], ids: ['a'.repeat(CLAUDE_TOKEN_MAX_LENGTH)], sessionId: SESSION };
    const file = await recording(t, conversation(budget, marker, budget));
    const { meta } = await readSession(file);
    assert.deepEqual([meta.capture.incomplete, meta.capture.unclassifiedRows, meta.capture.harnessContextRows],
      [false, undefined, 3]);
    const ledger = await sliceLineage([file], { cwd: '/repo', recorderCensus: true });
    assert.equal(hasCaptureGaps(ledger), false);
    assert.deepEqual((await gapsOf(file)).filter((gap) => gap.code === 'unsupported_message'), []);
    assert.deepEqual(ledger.recorderCensus.entries.filter((e) => e.reason === RECORDER_CENSUS_REASONS.rowReadByStructure),
      [{ reason: 'row_read_by_structure', key: 'attachment.budget_usd', version: '2.1.399', count: 2 },
        { reason: 'row_read_by_structure', key: 'future-marker', version: null, count: 1 }]);
    // The census is a side channel: the ledger a review reads does not carry it.
    assert.equal(Object.hasOwn(await sliceLineage([file], { cwd: '/repo' }), 'recorderCensus'), false);
  });

test('D128: what can hold session content, by structure alone', () => {
  const token = 'x'.repeat(CLAUDE_TOKEN_MAX_LENGTH);
  for (const value of [null, true, 0, 12.5, '', token, [], {}, [token, 3, false], { a: { b: [token] } },
    { type: 'not_a_block', id: token }, '2026-10-22T00:00:00.000Z', 'aaaaaaaa-0000-4000-8000-000000000001'])
    assert.equal(canHoldSessionContent(value), false, JSON.stringify(value));
  for (const value of [`${token}x`, 'two words', 'tab\there', 'line\nbreak', ['ok', 'not ok'],
    { deep: [{ deeper: { words: 'a b' } }] }, { type: 'text' }, { type: 'tool_use', name: 'Bash' },
    [{ type: 'tool_result' }], { content: 'x' }, { message: {} }, { nested: { body: 1 } }, { payload: null },
    { tool: 'Edit' }, { type: 'thinking' },
    // D128's review: a key is a string too — one with white space or past the bound can hold words, at any depth.
    { 'Which database should we use?': 'Postgres' }, { [`${token}x`]: 1 }, [{ ok: { 'a b': null } }]])
    assert.equal(canHoldSessionContent(value), true, JSON.stringify(value));
  assert.equal(canHoldSessionContent({ [token]: 1, tok_2: { nested_key: [true] } }), false, 'keys that are tokens');
  // Depth costs no stack.
  let deep = 'two words';
  for (let i = 0; i < 100_000; i++) deep = [deep];
  assert.equal(canHoldSessionContent(deep), true);
});

test('D128: across generated rows of new kinds, one of tokens alone never marks the recording incomplete, and one '
  + 'word string anywhere always does', async (t) => {
  // A fixed generator (no clock, no random): each row nests tokens, numbers, booleans and null to its own depth.
  const value = (i, depth) => {
    if (depth === 0) return [`tok_${i}`, i, i % 2 === 0, null][i % 4];
    return i % 3 === 0 ? [value(i + 1, depth - 1), value(i + 2, depth - 1)]
      : { [`k${i}`]: value(i + 1, depth - 1), [`n${i}`]: i };
  };
  const generated = Array.from({ length: 24 }, (_, i) => ({ type: `future-kind-${i}`, sessionId: SESSION,
    field: value(i, i % 5) }));
  const tokens = await readSession(await recording(t, conversation(...generated)));
  assert.equal(tokens.meta.capture.incomplete, false);
  assert.equal(tokens.meta.capture.harnessContextRows, generated.length);
  const plant = (v) => (Array.isArray(v) ? [...v, 'some words'] : v && typeof v === 'object'
    ? { ...v, extra: 'some words' } : 'some words');
  for (const one of generated) {
    const words = await readSession(await recording(t, conversation({ ...one, field: plant(one.field) })));
    assert.equal(words.meta.capture.unclassifiedRows, 1, one.type);
  }
  assert.equal(CLAUDE_ROW_CLASSES.harness, 'harness');
});

test('D128\'s review: words stored as a key keep the row unread — a new row type, an unknown attachment type, a listed '
  + 'type\'s new key, a new system subtype', async (t) => {
  // The recorder keys free text this way: AskUserQuestion's answers by the question's text.
  const answers = { 'Which database should we use for the new billing service?': 'Postgres' };
  const planted = [
    row({ type: 'user-answers', answers }),
    row({ type: 'attachment', attachment: { type: 'future_answers', answers } }),
    row({ type: 'attachment', attachment: { type: 'date', date: '2026-10-22', answers } }),
    row({ type: 'system', subtype: 'future_answers', answers }),
    row({ type: 'future-kind', [`${'k'.repeat(CLAUDE_TOKEN_MAX_LENGTH)}x`]: true }),
  ];
  for (const one of planted) {
    assert.equal(claudeRowClass(one), null, JSON.stringify(Object.keys(one)));
    const { meta } = await readSession(await recording(t, conversation(one)));
    assert.deepEqual([meta.capture.incomplete, meta.capture.unclassifiedRows, meta.structuralRows], [true, 1, undefined]);
  }
  // Keys that are tokens still read by structure.
  const tokens = row({ type: 'user-answers', answers: { q_1: 'opt_a', q_2: 2 } });
  assert.deepEqual(claudeRowClass(tokens), { cls: 'harness', agentId: null, structural: 'user-answers' });
});

test('D128\'s review: the pure classifier counts what the reader counts — a row the reader keeps as a record (an '
  + 'ordinary stop_hook_summary, a compaction marker, a turn) is not read by structure', async (t) => {
  const stop = row({ type: 'system', subtype: 'stop_hook_summary', hookCount: 1, hookInfos: [{ command: 'callback',
    durationMs: 5 }], hookErrors: [], preventedContinuation: false, stopReason: '', hasOutput: false, level: 'suggestion',
  toolUseID: 'toolu_synthetic_1' });
  const compact = row({ type: 'system', subtype: 'compact_boundary', compactMetadata: { trigger: 'auto', preTokens: 9 } });
  for (const one of [stop, compact, ask('Go.'), bash('b-9')]) {
    assert.equal(claudeRecordRow(one), true, kindOf(one));
    assert.equal(claudeRowClass(one), null, kindOf(one));
  }
  // A stop_hook_summary with message content or an alternate carrier is no ordinary one: the reader classifies it.
  for (const one of [{ ...stop, content: 'x' }, { ...stop, message: { content: 'Words.' } }])
    assert.equal(claudeRecordRow(one), false);
  // Over a recording of every fixture form beside such rows, what the classifier reads by structure is what the
  // reader's census counts, and the harness context it names is the reader's.
  const rows = [...RECORDER_ROWS.map((entry) => entry.row), stop, stop, compact];
  const { meta } = await readSession(await recording(t, conversation(...rows)));
  const byClassifier = rows.map((one) => claudeRowClass(one)).filter((c) => typeof c?.structural === 'string');
  assert.equal(byClassifier.length, (meta.structuralRows ?? []).reduce((n, entry) => n + entry.count, 0));
  assert.equal(byClassifier.filter((c) => c.cls === 'harness').length, meta.capture.harnessContextRows);
});
