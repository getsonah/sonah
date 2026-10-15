import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { decodeContent, patchInput, isCodexRollout } from '../src/codex.js';
import { sliceLineage } from '../index.js';
import { labelCodexRecords } from '../src/codex.js';
import { LABEL_BASIS, LABEL_GAPS, opensTurn } from '../src/labels.js';
import { scratchDir } from './scratch-dir.js';

const rec = (payload) => JSON.stringify({ type: 'response_item', timestamp: '', payload });

async function rollout(lines) {
  const d = await scratchDir('codex-');
  const f = join(d, 'rollout-2026-08-31T10-00-00-abc.jsonl');
  await writeFile(f, lines.join('\n'), 'utf8');
  return f;
}

test('a Codex rollout is routed by format, not guessed at after failing', () => {
  assert.ok(isCodexRollout('/x/.codex/sessions/2026/08/rollout-2026-08-31T10-00-00-a.jsonl'));
  assert.ok(!isCodexRollout('/x/.claude/projects/p/abc-123.jsonl'));
});

test("message content is a stringified Python-ish list, not JSON", () => {
  // JSON.parse rejects this outright — single quotes.
  const raw = "[{'type': 'input_text', 'text': 'do not touch the auth middleware'}]";
  assert.equal(decodeContent(raw), 'do not touch the auth middleware');
  assert.equal(decodeContent('plain string'), 'plain string');
});

test('apply_patch carries the path in the patch body, not in an argument', () => {
  const input = patchInput('*** Begin Patch\n*** Update File: src/worker.py\n-old line\n+new line\n*** End Patch');
  assert.equal(input.file_path, 'src/worker.py');
  assert.match(input.old_string, /old line/);
  assert.match(input.new_string, /new line/);
});

test('Codex exit codes beat pattern matching for non-test commands', async () => {
  // Claude Code transcripts have NO exit codes, so outcome there is inference over output text.
  // Codex reports one. Preferring it is strictly better evidence.
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's1', cwd: '/repo', cli_version: '0.117.0' } }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' }),
    // Codex's native header precedes `Output:` (codex-rs/core/src/tools/context.rs response_header).
    rec({ type: 'function_call_output', call_id: 'c1', output: 'Chunk ID: 5f1e2a\nWall time: 0.5000 seconds\nProcess exited with code 2\nOriginal token count: 2\nOutput:\nbuilding…' }),
  ]);
  const l = await sliceLineage([f]);
  const ev = l.ledger.find((e) => e.cmd?.includes('make build'));
  assert.equal(ev.exitCode, 2);
  assert.equal(ev.outcome, 'failed', 'no output pattern says "failed" here — only the exit code does');
});

test('H1: a test runner exiting 0 exited 0; its output is the reviewer\'s to quote, never code\'s to read', async () => {
  // A suite can exit 0 with everything skipped, or print a tally that disagrees with its exit. Reading a status out of
  // runner words misread grep, cat and log output as failures (H1): the typed exit is the status,
  // and whether the output shows a failing suite is judged by the reviewer, who must quote the tally verbatim.
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's2', cwd: '/repo' } }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"pytest tests/"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'Wall time: 1.2000 seconds\nProcess exited with code 0\nOutput:\n1 failed, 3 passed' }),
  ]);
  const l = await sliceLineage([f]);
  const ev = l.ledger.find((e) => e.kind === 'bash');
  assert.equal(ev.exitCode, 0, 'the native header supplies a typed exit 0');
  assert.equal(ev.outcome, 'passed');
  assert.equal(ev.outcomeSource, 'native');
});

test('CRITICAL: M34 labels — the typed UserMessage channel labels a Codex human message, whatever the words', () => {
  // Codex injects AGENTS.md, environment and permission context with role:user, indistinguishable from a real turn by
  // type. Left unfiltered, every repo's AGENTS.md becomes REQUIREMENTS the agent is judged against. M5; M34 labels (C-02 "Slice-time labels"): no list of openings or tag names decides it. Where the
  // rollout's own item stream types the human channel (codex.js marks each message a UserMessage item names,
  // `codexUserMessage`), that mark alone labels it, once, in the reader (`labelCodexRecords`).
  const u = (text, codexUserMessage) => ({ kind: 'user', line: 1, raw: { type: 'user', message: { role: 'user',
    content: [{ type: 'text', text }] }, ...(codexUserMessage === undefined ? {} : { codexUserMessage }) } });
  const labelled = (rec) => { labelCodexRecords([rec], 'root'); return rec; };
  for (const text of ['# AGENTS.md instructions for /Users/x\n<INSTRUCTIONS>', '<environment_context>\n  <cwd>/x</cwd>',
    'add rate limiting to the 3 endpoints']) {
    const rec = labelled(u(text, false));
    assert.equal(opensTurn(rec), false, text);
    assert.deepEqual([rec.label, rec.basis], ['harness', LABEL_BASIS.codexContext], text);
  }
  for (const text of ['add rate limiting to the 3 endpoints', '<send_user_message_question_reply>yes</send_user_message_question_reply>']) {
    const rec = labelled(u(text, true));
    assert.equal(opensTurn(rec), true, text);
    assert.deepEqual([rec.label, rec.basis], ['human', LABEL_BASIS.codexUserMessage], text);
  }
  // Without the stream: the declared legacy fallback — a message made only of top-level elements is harness, counted
  // (it could hold a human's words); any other message is the human's, whatever its words.
  const context = labelled(u('<environment_context>\n  <cwd>/x</cwd>\n</environment_context>'));
  assert.deepEqual([context.label, context.basis, context.gap], ['harness', LABEL_BASIS.legacyFallback, LABEL_GAPS.legacyRecorder]);
  assert.equal(opensTurn(context), false);
  for (const text of ['add rate limiting to the 3 endpoints', '# AGENTS.md instructions for /Users/x\n<INSTRUCTIONS>',
    'You are Codex, based on GPT-5.']) {
    const rec = labelled(u(text));
    assert.deepEqual([rec.label, rec.basis, rec.gap], ['human', LABEL_BASIS.legacyFallback, undefined], text);
  }
});

const typedRow = (thread, turn, id, text) => JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed',
  thread_id: thread, turn_id: turn, item: { id, type: 'UserMessage', content: [{ type: 'text', text, text_elements: [] }] } } });

test('M5: in a rollout with the item stream, only the messages UserMessage items name are asks', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-agents', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nUse tabs.\n</INSTRUCTIONS>' }] }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>' }] }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', model_context_window: 1 } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] }),
    typedRow('s-agents', 't1', 'u1', 'fix the build'),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<turn_aborted>\nThe user interrupted.\n</turn_aborted>' }] }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't2', model_context_window: 1 } }),
    // An image message: the item's words are one of the message's text blocks, the others the harness's wrappers.
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<image name=[Image #1]>' },
      { type: 'input_image', image_url: 'data:image/png;base64,AA==' }, { type: 'input_text', text: '</image>' },
      { type: 'input_text', text: 'and this screen' }] }),
    typedRow('s-agents', 't2', 'u2', 'and this screen'),
  ]);
  const l = await sliceLineage([f]);
  // M34 labels: per content block — the item's words are the human's block; the image wrappers are the harness's, and
  // never part of the ask.
  assert.deepEqual(l.ask.map((a) => a.text), ['fix the build', 'and this screen']);
  assert.equal(l.capture?.labelGaps, undefined, 'the typed channel decided every message: no gap');
  assert.equal((l.capture?.reasons ?? []).includes('codex_message_content_unsupported'), false);
});

test('M5: a typed UserMessage item that names no message is a declared gap, never silence', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-unread', cwd: '/repo' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', model_context_window: 1 } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] }),
    typedRow('s-unread', 't1', 'u1', 'fix the tests'),
    // Another thread's item is not this thread's input: neither read nor declared.
    typedRow('s-other', 't1', 'u2', 'fix the build'),
  ]);
  const l = await sliceLineage([f]);
  assert.deepEqual(l.ask, [], 'no message carries the item\'s words: none is named, every message is context');
  assert.equal(l.capture?.incomplete, true);
  assert.equal(l.capture?.unsupported, 1);
  assert.ok((l.capture?.reasons ?? []).includes('codex_message_content_unsupported'));
});

test('M5: the nearest message carrying the item\'s words is the one named; a farther copy is context', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-copy', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ship it' }] }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', turn_id: 't0', last_agent_message: null } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', model_context_window: 1 } }),
    typedRow('s-copy', 't1', 'u1', 'ship it'),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ship it' }] }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make ship"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'ok\nProcess exited with code 0' }),
  ]);
  const l = await sliceLineage([f]);
  assert.deepEqual(l.ask.map((a) => [a.turn, a.text]), [[1, 'ship it']]);
  assert.deepEqual(l.ledger.map((e) => e.turn), [1], 'the command is the named message\'s turn');
});

test('M5; M34 labels: without the item stream, the legacy fallback labels each message: elements only are harness and counted, words are asks', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-legacy', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>' }] }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>\nUse tabs.\n</user_instructions>' }] }),
    rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] }),
  ]);
  const l = await sliceLineage([f]);
  assert.deepEqual(l.ask.map((a) => a.text), ['fix the build']);
  assert.deepEqual(l.capture?.labelGaps, { legacy_recorder: 2 }, 'each message the fallback set aside is counted');
  assert.equal(l.capture?.incomplete, false, 'a declared loss, not a capture shortfall');
});

// Review finding M5-fallback-population-mischaracterized: a rollout in which no turn ran (session_meta, a developer
// message, an AGENTS.md block, environment context) is decided by the recorder's own declaration of its typed channel.
const stub = (meta, extra = []) => [
  JSON.stringify({ type: 'session_meta', payload: { id: 's-stub', cwd: '/repo', ...meta } }),
  rec({ type: 'message', role: 'developer', content: [{ type: 'input_text', text: '<permissions instructions>\nx\n</permissions instructions>' }] }),
  rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /repo\n\n<INSTRUCTIONS>\nUse tabs.\n</INSTRUCTIONS>' }] }),
  rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>' }] }),
  ...extra,
];

test('M5 review: a rollout declaring its paginated history in which no turn ran has no human ask and no gap', async () => {
  const declared = await sliceLineage([await rollout(stub({ history_mode: 'paginated' }))]);
  assert.deepEqual(declared.ask, [], 'no UserMessage item names its AGENTS.md block: opening context');
  assert.equal(declared.capture?.labelGaps, undefined, 'decided by the declared channel: no gap');
  // No declaration (or another value, or a repeated key): the structural fallback decides, counted, as before.
  for (const meta of [{}, { history_mode: 'legacy' }]) {
    const l = await sliceLineage([await rollout(stub(meta))]);
    assert.deepEqual(l.ask.map((a) => a.text.split('\n')[0]), ['# AGENTS.md instructions for /repo'], JSON.stringify(meta));
    assert.deepEqual(l.capture?.labelGaps, { legacy_recorder: 1 }, JSON.stringify(meta));
  }
  const rows = stub({ history_mode: 'paginated' });
  const repeated = await rollout([rows[0].replace('"cwd"', '"history_mode":"paginated","cwd"'), ...rows.slice(1)]);
  assert.equal((await sliceLineage([repeated])).ask.length, 1, 'a repeated key declares nothing');
});

test('M5 review: a declared rollout in which a turn ran must show the stream; without it the fallback decides, counted', async () => {
  for (const turn of [
    [JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't1', model_context_window: 1 } }),
      rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] })],
    [rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the build' }] }),
      rec({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.' }] })],
  ]) {
    const l = await sliceLineage([await rollout(stub({ history_mode: 'paginated' }, turn))]);
    assert.deepEqual(l.ask.map((a) => a.text.split('\n')[0]), ['# AGENTS.md instructions for /repo', 'fix the build'],
      'the human\'s ask is never silent context');
    assert.deepEqual(l.capture?.labelGaps, { legacy_recorder: 1 });
  }
});

test('M5 review: a stretch recorded before the stream started is decided by the counted fallback, not silently', async () => {
  // Turns 1-2 recorded with no item rows (an older Codex), turns 3-4 after a resume on one that writes the stream.
  const user = (text) => rec({ type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
  const said = (text) => rec({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-mixed', cwd: '/repo' } }),
    user('<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>'),
    user('keep the old flag name'),
    said('Noted.'),
    user('now add the retry'),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'ok\nProcess exited with code 0' }),
    user('<turn_aborted>\nThe user interrupted.\n</turn_aborted>'),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't3', model_context_window: 1 } }),
    user('ship it'),
    typedRow('s-mixed', 't3', 'u3', 'ship it'),
    said('Shipping.'),
    user('<turn_aborted>\nThe user interrupted.\n</turn_aborted>'),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_id: 't4', model_context_window: 1 } }),
    user('tag the release'),
    typedRow('s-mixed', 't4', 'u4', 'tag the release'),
  ]);
  const l = await sliceLineage([f]);
  assert.deepEqual(l.ask.map((a) => a.text), ['keep the old flag name', 'now add the retry', 'ship it', 'tag the release'],
    'the pre-stream asks, the opening one included, are never silent context');
  assert.deepEqual(l.capture?.labelGaps, { legacy_recorder: 2 },
    'the pre-stream opening context and abort notice the fallback set aside are counted; none after the stream started is');
  // The usual shape — the stream's first row (the opening ask's item) before the model's first output — is decided by
  // the stream throughout, its opening context included.
  const usual = await sliceLineage([await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-usual', cwd: '/repo' } }),
    user('<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>'),
    user('keep the old flag name'),
    typedRow('s-usual', 't1', 'u1', 'keep the old flag name'),
    said('Noted.'),
    user('<turn_aborted>\nThe user interrupted.\n</turn_aborted>'),
  ])]);
  assert.deepEqual(usual.ask.map((a) => a.text), ['keep the old flag name']);
  assert.equal(usual.capture?.labelGaps, undefined);
});

test('encrypted reasoning payloads are dropped, not half-parsed', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's3', cwd: '/repo' } }),
    rec({ type: 'reasoning', encrypted_content: 'gAAAAAB…', summary: '[]' }),
    rec({ type: 'message', role: 'user', content: "[{'type':'input_text','text':'fix the build'}]" }),
  ]);
  const l = await sliceLineage([f]);
  assert.equal(l.ask.length, 1);
  assert.equal(l.ask[0].text, 'fix the build');
});

// A human message this adapter cannot read is a missing INSTRUCTION: a declared capture gap, so
// the review renders UNCHECKED — never silence that could later read as "the ask never said".
test('an unreadable Codex user message is a declared capture gap, not a silently missing ask', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { sliceLineage } = await import('../index.js');
  const dir = await scratchDir('sonah-codex-gap-');
  const file = join(dir, 'rollout-2026-09-14T10-00-00-gap.jsonl');
  const rec = (payload) => JSON.stringify({ type: 'response_item', timestamp: '', payload });
  await writeFile(file, [
    JSON.stringify({ type: 'session_meta', payload: { id: 's-gap', cwd: '/repo', cli_version: '0.117.0' } }),
    rec({ type: 'message', role: 'user', content: "[{'type': 'input_text', 'text': 'fix the parser'}]" }),
    rec({ type: 'message', role: 'user', content: "[{'type': 'mystery_block', 'payload': 'unreadable'}]" }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'ok\nProcess exited with code 0' }),
  ].join('\n'), 'utf8');
  const ledger = await sliceLineage([file]);
  assert.equal(ledger.ask.length, 1, 'the readable ask survives');
  assert.equal(ledger.capture?.incomplete, true, 'the unreadable one is a declared gap');
  assert.ok((ledger.capture?.reasons ?? []).includes('codex_message_content_unsupported'));
});

// H43: a call whose result never arrived is recorded as `codex_tool_result_missing`, but the
// counter it increments (`unmapped`) was left out of the `incomplete` expression — so a session
// whose command outcome is unknown could still read CLEAN. An unknown outcome is a capture gap.
test('H43: a Codex tool call with no result row makes the capture incomplete', async () => {
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-h43', cwd: '/repo', cli_version: '0.117.0' } }),
    rec({ type: 'message', role: 'user', content: "[{'type': 'input_text', 'text': 'run the suite'}]" }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"pytest tests/"}' }),
    // no function_call_output for c1: the outcome of that command was never recorded.
  ]);
  const ledger = await sliceLineage([f]);
  const reasons = ledger.capture?.reasons ?? [];
  assert.ok(reasons.includes('codex_tool_result_missing'), `the gap is declared: ${JSON.stringify(reasons)}`);
  assert.equal(ledger.capture?.unmapped, 1);
  assert.equal(ledger.capture?.incomplete, true, 'a result that never arrived is an incomplete capture');
});

test('M34 labels review (F4): a synchronous request_user_input answer is labelled the human\'s and declared unread at its call', async () => {
  const { sessionFromLedger, UNREAD_ANSWER_NOTE } = await import('../../evidence/adapters/sonah-ledger.js');
  const { redact } = await import('../../redact/index.js');
  const question = { questions: [{ id: 'a', header: 'Schema', question: 'Drop the legacy table?',
    options: [{ label: 'Yes', description: 'drop it' }, { label: 'No', description: 'keep it' }] }] };
  const f = await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-f4', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Clean up the schema.' }),
    rec({ type: 'function_call', name: 'request_user_input', call_id: 'q1', arguments: JSON.stringify(question) }),
    // The output is the recorder's text, with no typed answer field: labelled the human's answer, never read as words.
    rec({ type: 'function_call_output', call_id: 'q1', output: 'No, never touch the migrations' }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make migrate"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'Wall time: 0.5 seconds\nProcess exited with code 0\nOutput:\nok' }),
  ]);
  const l = await sliceLineage([f]);
  assert.deepEqual(l.ledger.map((e) => [e.seq, e.humanAnswerUnresolved ?? null]), [[0, true], [1, null]]);
  assert.equal(l.interjections, undefined, 'its text is not read as an instruction');
  assert.equal(l.capture.labels.human, 2, 'the ask and the answer');
  const session = sessionFromLedger(redact(l).ledger, { sessionKey: 'codex-f4' });
  // C-01 event identity: the question's call is named by the call_id the recorder wrote.
  const asked = session.events.find((e) => e.kind === 'invocation' && e.tool === 'request_user_input');
  assert.equal(asked.id, 'q1.0');
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions')
    .map((gap) => [gap.count, gap.eventIds, gap.note]), [[1, [asked.id], UNREAD_ANSWER_NOTE]]);
  // Any other call's output stays an observation, and declares nothing.
  const plain = await sliceLineage([await rollout([
    JSON.stringify({ type: 'session_meta', payload: { id: 's-f4b', cwd: '/repo' } }),
    rec({ type: 'message', role: 'user', content: 'Clean up the schema.' }),
    rec({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make migrate"}' }),
    rec({ type: 'function_call_output', call_id: 'c1', output: 'Wall time: 0.5 seconds\nProcess exited with code 0\nOutput:\nok' }),
  ])]);
  assert.equal(plain.ledger[0].humanAnswerUnresolved, undefined);
});
