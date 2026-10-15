// OWNER DECISION B (2026-10-01) fixtures: synthetic Claude Code and Codex recordings for the `unasked` column tests.
//
// Every row is invented and mirrors only shapes the repository's own tests already use (the recorder's key sets, the
// AskUserQuestion input schema, a `queued_command` prompt attachment). No real recording is read; nothing here holds a
// secret. A recording is written to a temp directory, sliced, redacted and adapted exactly as the review loads one.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { sliceLineage } from '../../slicer/index.js';
import { redact, ASK_OMISSION } from '../../redact/index.js';
// C-01 event identity: a test names an event by its positional label, and checks a pin rendered back
// (stable-ids-fixture.js).
import { adapt as adaptRegistered, twinOf, textBeforeStableIds } from './stable-ids-fixture.js';
export { named, labelOf, beforeStableIds, sessionBeforeStableIds, withoutIdentity } from './stable-ids-fixture.js';
/** `sessionFromLedger`, registered for the positional-label helpers (stable-ids-fixture.js). */
export const adapt = (ledger, sessionKey = 'm33-u') => adaptRegistered(ledger, { sessionKey });
import { planWindowRequests } from '../src/run-review.js';

export const SESSION = 'c0ffee00-0000-4000-8000-00000000a001';
let uuid = 0;
export const row = (extra) => ({ cwd: '/repo', entrypoint: 'claude-desktop', gitBranch: 'main', isSidechain: false,
  parentUuid: null, sessionId: SESSION, timestamp: '2026-10-01T00:00:00Z', userType: 'external',
  uuid: `u-${++uuid}`, version: '2.1.284', ...extra });
export const user = (text, extra = {}) => row({ type: 'user', message: { role: 'user', content: text }, ...extra });
/** M34 labels: a human's prompt row, as Claude Code 2.1.219 and later records one (the host's typed origin). */
export const humanAsk = (text, extra = {}) => user(text, { origin: { kind: 'human' }, promptSource: 'sdk', ...extra });
export const said = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
export const call = (id, name, input, text = null) => row({ type: 'assistant', message: { role: 'assistant',
  content: [...(text ? [{ type: 'text', text }] : []), { type: 'tool_use', id, name, input }] } });
export const result = (id, content, sidecar, isError) => row({ type: 'user', ...(sidecar === undefined ? {} : { toolUseResult: sidecar }),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content,
    ...(isError === undefined ? {} : { is_error: isError }) }] } });
export const compact = () => row({ type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted' });
/** A prompt the human queued while the agent worked, as Claude Code records it: a `queued_command` attachment. */
export const queued = (prompt, payload = {}, extra = {}) => row({ type: 'attachment',
  attachment: { type: 'queued_command', commandMode: 'prompt', prompt, ...payload }, ...extra });
const SUCCESS = Object.freeze({ stdout: 'ok', stderr: '', interrupted: false, isImage: false, noOutputExpected: false });

export const QUESTION = Object.freeze({ question: 'Which flag name should the CLI use?', header: 'Flag', multiSelect: false,
  options: [{ label: '--strict', description: 'Strict parsing' }, { label: '--safe', description: 'Safe parsing' }] });
export const ANSWER = '--strict';
export const QUEUED = 'Also keep the parser free of semicolons.';
/** The visible text Claude Code returns for an answered question (the answers are also in the typed sidecar). */
export const answeredText = (pairs) => `User has answered your questions: ${pairs.map(([q, a]) => `"${q}"="${a}"`).join(', ')}. `
  + 'You can now continue with the user\'s answers in mind.';

/**
 * The Claude Code recording. Two requests split by a recorded compaction:
 *   1. ask → Write src/parser.js → (queued prompt, when asked) → Bash node --test → statement
 *   2. ask → (AskUserQuestion and its answer, when asked) → Edit src/cli.js → statement
 * `sidecar` replaces the AskUserQuestion's typed answer sidecar (`null`: none recorded).
 */
export function claudeRows({ queuedPrompt = null, queuedPayload = { origin: { kind: 'human' } }, queuedExtra = {},
  ask = false, sidecar, longAsk = false } = {}) {
  const questions = [QUESTION];
  const answers = sidecar === undefined ? { questions, answers: { [QUESTION.question]: ANSWER } } : sidecar;
  // C-01 event identity: the recording's rows carry their own uuids, numbered within it, so its ledger bytes (which now
  // record each row's uuid) do not depend on how many rows the process built before it.
  return [
    humanAsk(longAsk ? `Write the parser in src/parser.js.\n${'Keep the public API unchanged. '.repeat(900)}`
      : 'Write the parser in src/parser.js. Keep the public API unchanged.'),
    call('w1', 'Write', { file_path: '/repo/src/parser.js', content: 'export const parse = (s) => s.trim();\n' },
      'Writing the parser now.'),
    result('w1', 'File created successfully at: /repo/src/parser.js', { type: 'create', filePath: '/repo/src/parser.js',
      content: 'export const parse = (s) => s.trim();\n', structuredPatch: [] }),
    ...(queuedPrompt === null ? [] : [queued(queuedPrompt, queuedPayload, queuedExtra)]),
    call('b1', 'Bash', { command: 'node --test', description: 'Run the tests' }),
    result('b1', 'ℹ pass 1\nℹ fail 0', SUCCESS, false),
    said('The parser is written and the tests pass.'),
    compact(),
    humanAsk('Now add a flag to the CLI in src/cli.js.'),
    ...(ask ? [call('q1', 'AskUserQuestion', { questions }, 'One question first.'),
      result('q1', answeredText([[QUESTION.question, ANSWER]]), answers ?? undefined)] : []),
    call('e1', 'Edit', { file_path: '/repo/src/cli.js', old_string: 'const flags = [];', new_string: 'const flags = [\'--strict\'];' }),
    result('e1', 'The file /repo/src/cli.js has been updated successfully.'),
    said('Added the flag.'),
  ].map((r, i) => ({ ...r, uuid: `u-claude-${i + 1}` }));
}

const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });
/** A Codex rollout of two requests, with no queued prompt and no question tool. `longAsk`: the second ask is over the
 *  ask budget, so redaction caps it after scrubbing it whole. */
export function codexRows({ longAsk = false } = {}) {
  return [
    { type: 'session_meta', payload: { id: 'codex-u-0001', cwd: '/repo', cli_version: '0.117.0' } },
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Fix the failing build.' }] }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Running the build first.' }] }),
    rollout({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' }),
    rollout({ type: 'function_call_output', call_id: 'c1', output: 'Wall time: 0.5000 seconds\nProcess exited with code 0\nOutput:\nbuilt' }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The build passes.' }] }),
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: longAsk
      ? `Now run the tests.\n${'Report every failing case by name. '.repeat(800)}` : 'Now run the tests.' }] }),
    rollout({ type: 'function_call', name: 'exec_command', call_id: 'c2', arguments: '{"cmd":"make test"}' }),
    rollout({ type: 'function_call_output', call_id: 'c2', output: 'Wall time: 0.5000 seconds\nProcess exited with code 0\nOutput:\nok' }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Tests pass.' }] }),
  ];
}

/**
 * M35 (windowing): no Sonah cuts a human message any more. A ledger an earlier Sonah persisted still carries the cut it
 * made — an ask over its retired 20,000-code-point budget kept as its first 14,000 and last 6,000 code points around
 * Sonah's own marker on a line of its own, declared `{ what: 'middle of turn' }` — and the adapter still declares it as
 * capped before review. This makes such a ledger from a fresh slice: every ask and in-turn instruction over the old
 * budget, cut there. Test-only; nothing in the product writes it.
 */
export function legacyAskCap(ledger) {
  const cut = (entry) => {
    if (typeof entry?.text !== 'string' || entry.text.length <= 20_000) return entry;
    const head = entry.text.slice(0, 14_000), tail = entry.text.slice(-6_000);
    return { ...entry, text: `${head.slice(0, head.lastIndexOf(' '))}\n${ASK_OMISSION}\n${tail.slice(tail.indexOf(' ') + 1)}`,
      elided: [...(entry.elided ?? []), { what: 'middle of turn', chars: entry.text.length - 20_000 }] };
  };
  return { ...ledger, ask: (ledger.ask ?? []).map(cut),
    ...(Array.isArray(ledger.interjections) ? { interjections: ledger.interjections.map(cut) } : {}) };
}

/** Write `rows` as one recording, slice, redact and adapt it. `name` decides the reader (a Codex rollout name).
 *  `legacyCap`: the sliced ledger as an earlier Sonah persisted it (`legacyAskCap`), before redaction. */
export async function load(t, rows, { name = `${SESSION}.jsonl`, sessionKey = 'm33-u', legacyCap = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-u-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, name);
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const sliced = await sliceLineage([file], { cwd: '/repo' });
  const raw = legacyCap ? legacyAskCap(sliced) : sliced;
  const ledger = redact(raw).ledger;
  return { raw, ledger, session: adapt(ledger, sessionKey) };
}
export const CODEX_NAME = 'rollout-2026-10-01T00-00-00-codex-u-0001.jsonl';

const sha = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
/** The canonical session's bytes: events, blobs, gaps and links, as the review reads them. */
export const sessionDigest = (session) => sha({ events: session.events, blobs: session.blobs, gaps: session.adapterGaps,
  children: session.children });
/** M33 brittleness L3: the session's bytes as they were before the adapter set its recorder-schema flags (`asksHuman`,
 *  `humanChoice`) on an action — rendered back, so a session pin taken before them stays checkable byte for byte. */
export const beforeHumanInteractionFlags = (session) => ({ blobs: session.blobs, adapterGaps: session.adapterGaps,
  children: session.children,
  events: session.events.map(({ asksHuman: _asks, humanChoice: _choice, ...event }) => event) });
/** Every window's narrative request bytes, in order. M33 N: `renderBack` maps each prompt first (a later change's texts
 *  taken out, m33-n-forbidden-edit-fixture.js `beforeForbiddenEdit`), so a pin of an earlier version stays checkable. */
export const promptDigests = (session, renderBack = (prompt) => prompt) => sessionPrompts(session)
  .map((prompt) => sha(renderBack(prompt)));
/** M35 (windowing): a session-only review's narrative requests, in order, as `planWindowRequests` builds them. */
export const sessionPrompts = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => request.prompt);
/**
 * C-01 event identity: `promptDigests` of `session` as an adapter before stable ids sent them — and a proof that only the
 * ids moved: each request now, rendered back against its twin's (stable-ids-fixture.js `textBeforeStableIds`), must be the
 * twin's byte for byte, or this throws.
 */
export function promptDigestsBeforeStableIds(session, renderBack = (prompt) => prompt) {
  const requests = (of) => sessionPrompts(of);
  const before = requests(twinOf(session));
  const now = requests(session);
  if (now.length !== before.length) throw new Error('stable ids moved the windows');
  return now.map((request, k) => sha(renderBack(textBeforeStableIds(session, request, before[k]))));
}
