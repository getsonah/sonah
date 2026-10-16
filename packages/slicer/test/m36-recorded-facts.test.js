// D68 (owner decision 2026-10-07; C-02 "M36 recorded facts"). The recorder's typed facts about a call, read once at
// slicing from its own structured fields and carried on the ledger event as `recorded`, rebuilt from its closed
// vocabulary before slice_hash: the recorder's tool name and a Codex command's class (c5); a Codex command's parsed
// meaning (C 3); a change's recorded, line-numbered hunks, as recorded (c2, C 1, D; D90: nothing in them is masked); a Codex delete's recorded prior state (C 2); web searches (C 4); a Claude Code sidecar's numbers, booleans
// and strings (D); and a change of a file between two recorded states that no edit recorded (E).
//
// Synthetic recordings only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvents } from '../src/events.js';
import { sliceLineage } from '../index.js';
import { parseUnifiedHunks, commandClassOf, recordedHunks, claudeAgentFacts } from '../src/recorded.js';
import { redact, sliceHash, validHunks, RECORDED_FACTS } from '../../redact/index.js';
import { sessionFromLedger, RECORDED_FACT_KEYS, RECORDED_AGENT_KEYS } from '../../evidence/adapters/sonah-ledger.js';

// ---- builders -------------------------------------------------------------------------------------------------------

let uid = 0;
const base = { sessionId: 'sess-m36', cwd: '/repo', version: '2.1.284', isSidechain: false };
const userRow = (text) => ({ kind: 'user', adapter: 'claude', raw: { ...base, type: 'user', uuid: `u${++uid}`,
  origin: { kind: 'human' }, message: { role: 'user', content: text } } });
const call = (id, name, input) => ({ kind: 'assistant', adapter: 'claude', raw: { ...base, type: 'assistant',
  uuid: `u${++uid}`, message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } } });
const result = (id, content, sidecar, isError = false) => ({ kind: 'user', adapter: 'claude', raw: { ...base,
  type: 'user', uuid: `u${++uid}`, ...(sidecar !== undefined ? { toolUseResult: sidecar } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } } });
const build = (rows) => buildEvents(rows.map((r, i) => ({ ...r, line: i + 1, source: 0 })), { cwd: '/repo' }).events;
const clean = (events) => redact({ ask: [], ledger: events, claim: { finalMessage: '' }, dropped: [] });

const FILE = ['function rate() {', '  return 0.2;', '}', ''].join('\n');
const patch = (oldStart, lines) => ({ oldStart, oldLines: lines.filter((l) => l[0] !== '+').length, newStart: oldStart,
  newLines: lines.filter((l) => l[0] !== '-').length, lines });
const EDIT_HUNKS = [patch(1, [' function rate() {', '-  return 0.2;', '+  return 0.25;', ' }'])];
const editSidecar = (originalFile, structuredPatch = EDIT_HUNKS) => ({ filePath: '/repo/src/rate.js',
  oldString: '  return 0.2;', newString: '  return 0.25;', originalFile, replaceAll: false, structuredPatch,
  userModified: false });

// ---- the vocabulary -----------------------------------------------------------------------------------------------

test('the closed vocabulary is one list, re-declared by the adapter exactly', () => {
  assert.ok(Object.isFrozen(RECORDED_FACTS));
  assert.deepEqual([...RECORDED_FACT_KEYS], [...RECORDED_FACTS.keys]);
  assert.deepEqual([...RECORDED_AGENT_KEYS], [...RECORDED_FACTS.agent]);
  assert.deepEqual([...RECORDED_FACTS.commandClass], ['read', 'command']);
  assert.deepEqual([...RECORDED_FACTS.hunkScrub], ['file', 'change']);
});

// ---- Claude Code ----------------------------------------------------------------------------------------------------

test('a Claude Code Edit: tool, typed error flag, hunks as recorded, prior state recorded', () => {
  const [edit] = build([userRow('raise the rate'),
    call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: '  return 0.2;', new_string: '  return 0.25;' }),
    result('e1', 'The file has been updated.', editSidecar(FILE))]);
  assert.deepEqual(edit.recorded, { tool: 'Edit', patch: 'hunks', prior: 'file', isError: false, hunks: EDIT_HUNKS });
  // With no recorded file (the recorder keeps one for small files only) the hunks are the prior state's only record.
  const [big] = build([userRow('raise the rate'),
    call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: '  return 0.2;', new_string: '  return 0.25;' }),
    result('e1', 'The file has been updated.', editSidecar(null))]);
  assert.equal(big.recorded.hunkScrub, undefined, 'D90: nothing scrubs them');
  assert.equal(big.recorded.prior, 'hunks');
  // A failed call types its error flag and nothing of its sidecar.
  const [failed] = build([userRow('raise the rate'),
    call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: 'x', new_string: 'y' }),
    result('e1', 'String not found.', 'Error: String not found.', true)]);
  assert.deepEqual(failed.recorded, { tool: 'Edit', patch: 'strings', prior: 'unrecorded', isError: true });
});

test('a Claude Code Write: its type, its prior state, and an update\'s recorded hunks', () => {
  const [created] = build([userRow('add it'), call('w1', 'Write', { file_path: '/repo/a.js', content: 'x\n' }),
    result('w1', 'File created successfully', { type: 'create', filePath: '/repo/a.js', content: 'x\n',
      structuredPatch: [], originalFile: null, userModified: false })]);
  assert.deepEqual(created.recorded, { tool: 'Write', patch: 'body', prior: 'absent', isError: false, writeType: 'create' });
  const [updated] = build([userRow('rewrite it'), call('w1', 'Write', { file_path: '/repo/src/rate.js',
    content: FILE.replace('0.2', '0.25') }), result('w1', 'The file has been updated.', { type: 'update',
    filePath: '/repo/src/rate.js', content: FILE.replace('0.2', '0.25'), structuredPatch: EDIT_HUNKS, originalFile: FILE,
    userModified: false })]);
  assert.deepEqual(updated.recorded, { tool: 'Write', patch: 'body', prior: 'file', isError: false, writeType: 'update',
    hunks: EDIT_HUNKS });
});

test('a Claude Code sidecar\'s typed numbers: Read window, Grep and Glob counts, WebFetch, WebSearch, Bash flags', () => {
  const events = build([userRow('look around'),
    call('r1', 'Read', { file_path: '/repo/a.js', offset: 10, limit: 5 }),
    result('r1', 'a', { type: 'text', file: { filePath: '/repo/a.js', content: 'a', numLines: 5, startLine: 10, totalLines: 40 } }),
    call('g1', 'Grep', { pattern: 'x' }),
    result('g1', 'a.js', { mode: 'files_with_matches', filenames: ['a.js'], numFiles: 1, totalFiles: 1 }),
    call('g2', 'Glob', { pattern: '*.js' }),
    result('g2', 'a.js', { filenames: ['a.js'], numFiles: 1, totalMatches: 900, truncated: true, durationMs: 3,
      countIsComplete: false }),
    call('f1', 'WebFetch', { url: 'https://example.invalid/doc', prompt: 'p' }),
    result('f1', 'doc', { bytes: 1200, code: 200, codeText: 'OK', durationMs: 4, result: 'doc', url: 'https://example.invalid/doc' }),
    call('s1', 'WebSearch', { query: 'node test runner' }),
    result('s1', 'results', { query: 'node test runner', results: ['a', { title: 't' }], durationSeconds: 1 }),
    call('b1', 'Bash', { command: 'sleep 100', run_in_background: true }),
    result('b1', 'Command running in background with ID: bg1', { stdout: '', stderr: '', interrupted: false,
      isImage: false, noOutputExpected: false, backgroundTaskId: 'bg1' })]);
  const facts = Object.fromEntries(events.map((e) => [e.recorded.tool, e.recorded]));
  assert.deepEqual(facts.Read.read, { startLine: 10, numLines: 5, totalLines: 40 });
  assert.deepEqual(facts.Grep.search, { mode: 'files_with_matches', numFiles: 1 });
  assert.deepEqual(facts.Glob.search, { numFiles: 1, totalMatches: 900, truncated: true });
  assert.deepEqual(facts.WebFetch.fetch, { url: 'https://example.invalid/doc', code: 200, bytes: 1200 });
  assert.deepEqual(facts.WebSearch.webSearch, { query: 'node test runner', results: 2 });
  assert.deepEqual({ ...facts.Bash, tool: undefined }, { tool: undefined, isError: false, interrupted: false,
    noOutputExpected: false, backgroundTaskId: 'bg1' });
});

test('a Bash call\'s bashEditDiff: the files it changed, typed, each with its hunks as recorded', () => {
  const [bash] = build([userRow('fix it'), call('b1', 'Bash', { command: 'node fix.js' }),
    result('b1', 'done', { stdout: 'done', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
      bashEditDiff: { files: [{ filePath: '/repo/src/rate.js', hunks: EDIT_HUNKS }, { filePath: '/repo/new.js',
        hunks: [patch(0, ['+x'])], created: true }], changedFiles: ['/repo/src/rate.js', '/repo/new.js'], moreFiles: 0 } })]);
  assert.deepEqual(bash.recorded.editDiff, { files: [{ path: 'src/rate.js', hunks: EDIT_HUNKS },
    { path: 'new.js', created: true, hunks: [patch(0, ['+x'])] }],
  changedFiles: ['src/rate.js', 'new.js'], moreFiles: 0 });
});

// ---- hunks: as recorded, line count kept -----------------------------------------------------------------------------

// A GitHub-token-shaped value, assembled at run time (a secret scan reads test sources for token shapes).
const KEY = ['ghp', `${'Zk3Qw8Rt'.repeat(4)}Ab9x`].join('_');
const BEGIN = ['-----BEGIN', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');
const END = ['-----END', 'RSA', 'PRIVATE', 'KEY-----'].join(' ');

test('(c2), D90: a change\'s recorded hunks are carried as recorded — a secret-named block, a token, a key block too', () => {
  const file = ['deploy:', '  signing_key: |', '    c3ludGhldGljLXZhbHVlLWxpbmUtb25l', '    c3ludGhldGljLXZhbHVlLWxpbmUtdHdv',
    'done: true', ''].join('\n');
  for (const hunks of [[patch(4, ['     c3ludGhldGljLXZhbHVlLWxpbmUtdHdv', '-done: true', '+done: false'])],
    [patch(3, [' const a = 1;', `+const k = "${KEY}";`])],
    [patch(10, [' QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5', ` ${END}`, '+x = 1'])],
    [patch(1, [`+${BEGIN}`, '+QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5', `+${END}`, '+ok'])]]) {
    for (const originalFile of [file, null]) {
      const [edit] = build([userRow('change it'),
        call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: 'x', new_string: 'y' }),
        result('e1', 'The file has been updated.', editSidecar(originalFile, hunks))]);
      assert.deepEqual(edit.recorded.hunks, hunks, JSON.stringify(hunks).slice(0, 60));
      assert.equal(edit.recorded.hunkScrub, undefined);
      assert.equal(edit.recorded.withheld, undefined);
    }
  }
  // Not hunks in the recorder's shape: none is carried, and the facts say the record held some.
  for (const bad of [[{ oldStart: 1 }], [{ ...patch(1, ['+a']), lines: ['?a'] }], [{ ...patch(1, ['+a']), lines: ['+a\nb'] }]]) {
    const [edit] = build([userRow('change it'),
      call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: 'x', new_string: 'y' }),
      result('e1', 'The file has been updated.', editSidecar(null, bad))]);
    assert.equal(edit.recorded.hunks, undefined, JSON.stringify(bad));
    assert.equal(edit.recorded.withheld, true, JSON.stringify(bad));
  }
});

test('(c2), D90: redaction carries recorded hunks as recorded before slice_hash, keeps the count, and is final', () => {
  const event = { turn: 1, seq: 0, kind: 'edit', path: 'src/a.js',
    recorded: { tool: 'Edit', hunks: [patch(3, [' const a = 1;', `+const k = "${KEY}";`])], hunkScrub: 'change' } };
  const once = clean([event]).ledger;
  assert.deepEqual(once.ledger[0].recorded.hunks, event.recorded.hunks, 'as recorded');
  assert.deepEqual(redact({ ...once, dropped: [] }).ledger.ledger, once.ledger, 'a second pass changes nothing');
  assert.notEqual(sliceHash(once), sliceHash({ ...once, ledger: once.ledger.map(({ recorded, ...e }) => e) }),
    'slice_hash covers the recorded facts');
});

test('redaction rebuilds recorded facts from the closed vocabulary; a recorder string is carried as recorded (D90)', () => {
  const [event] = clean([{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat a', recorded: { tool: 'exec_command',
    commandClass: 'sometimes', parsedCmd: [{ type: 'read', name: 'a', path: `/tmp/${KEY}/a` }, { type: 'fly' }],
    fetch: { url: `https://x.invalid/?token=${KEY}`, code: 200 }, invented: 1 } }]).ledger.ledger;
  assert.deepEqual(event.recorded, { tool: 'exec_command',
    parsedCmd: [{ type: 'read', name: 'a', path: `/tmp/${KEY}/a` }, { type: 'unknown' }],
    fetch: { url: `https://x.invalid/?token=${KEY}`, code: 200 }, withheld: true });
  assert.equal(event.redacted, true);
});

test('(R) redaction carries a withheld file\'s reason and never a hunk line beside it (fails closed)', () => {
  const [event] = clean([{ turn: 1, seq: 0, kind: 'edit', path: '.env', recorded: { tool: 'Edit', patch: 'hunks',
    hunksWithheld: 'credential_path', hunks: [patch(1, [' A=CONTEXT_OF_THE_FILE', '-B=1', '+B=2'])], hunkScrub: 'change',
    editDiff: { files: [{ path: '.claude/settings.json', hunksWithheld: 'harness_files', hunks: [patch(1, ['+x'])] }] } } }])
    .ledger.ledger;
  assert.deepEqual(event.recorded, { tool: 'Edit', hunksWithheld: 'credential_path', patch: 'hunks',
    editDiff: { files: [{ path: '.claude/settings.json', hunksWithheld: 'harness_files' }] } });
  const [odd] = clean([{ turn: 1, seq: 0, kind: 'edit', path: 'a', recorded: { tool: 'Edit', hunksWithheld: 'secret' } }])
    .ledger.ledger;
  assert.deepEqual(odd.recorded, { tool: 'Edit', withheld: true }, 'a reason outside the closed list is not carried');
  // D69 (b): `harness_home` is the one reason the harness home folders are withheld for; M36's `harness_files` is read
  // in a ledger an earlier slicer wrote (above), never produced.
  assert.deepEqual([...RECORDED_FACTS.hunksWithheld], ['credential_path', 'harness_home', 'harness_files']);
  const [home] = clean([{ turn: 1, seq: 0, kind: 'edit', path: 'srv/u/.codex/config.toml', recorded: { tool: 'Edit',
    hunksWithheld: 'harness_home', hunks: [patch(1, ['+x'])] } }]).ledger.ledger;
  assert.deepEqual(home.recorded, { tool: 'Edit', hunksWithheld: 'harness_home' });
});

// ---- Codex ----------------------------------------------------------------------------------------------------------

const OWN = 'thread-own';
const ev = (payload) => ({ type: 'event_msg', payload });
const it = (payload) => ({ type: 'response_item', payload });
const row = (value, turn = 't1') => ev({ type: 'item_completed', thread_id: OWN, turn_id: turn, item: value });
const opening = [{ type: 'session_meta', payload: { id: OWN, cwd: '/repo' } },
  ev({ type: 'task_started', turn_id: 't1', model_context_window: 1 }), it({ type: 'message', role: 'user', content: 'Go.' }),
  row({ id: 'u-1', type: 'UserMessage', content: [{ type: 'text', text: 'Go.', text_elements: [] }] }),
  row({ id: 'm1', type: 'AgentMessage' })];
const command = (id, script, parsed) => row({ id, type: 'CommandExecution', status: 'completed',
  source: 'unified_exec_startup', command: ['/bin/zsh', '-lc', script], cwd: 'file:///repo', exit_code: 0,
  aggregated_output: 'out', parsed_cmd: parsed, process_id: '1', duration: { secs: 0, nanos: 1 } });
async function codex(t, rows) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m36-recorded-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'rollout-2026-10-07T10-00-00-synthetic.jsonl');
  await writeFile(file, [...opening, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return sliceLineage([file]);
}

test('(c5, C 3) a Codex command: the recorder\'s parsed meaning, and read only when every part is a read', async (t) => {
  const ledger = await codex(t, [
    command('c1', 'cat a.txt', [{ type: 'read', cmd: 'cat a.txt', name: 'a.txt', path: 'a.txt' }]),
    command('c2', 'cat a.txt | rg x', [{ type: 'read', cmd: 'cat a.txt', name: 'a.txt', path: 'a.txt' },
      { type: 'search', cmd: 'rg x', query: 'x', path: null }]),
    command('c3', 'npm test', [{ type: 'unknown', cmd: 'npm test' }]),
    command('c4', 'ls', [{ type: 'list_files', cmd: 'ls', path: null }, { type: 'spell', cmd: 'x' }])]);
  const facts = ledger.ledger.filter((e) => e.kind === 'bash').map((e) => e.recorded);
  assert.deepEqual(facts.map((f) => [f.tool, f.commandClass]), [['CommandExecution', 'read'],
    ['CommandExecution', 'command'], ['CommandExecution', 'command'], ['CommandExecution', 'command']]);
  assert.deepEqual(facts[0].parsedCmd, [{ type: 'read', name: 'a.txt', path: 'a.txt' }]);
  assert.deepEqual(facts[1].parsedCmd[1], { type: 'search', query: 'x', path: null });
  assert.equal(facts[3].parsedCmd, undefined, 'a parsed command outside the closed shape is not carried');
  assert.equal(commandClassOf(undefined), 'command', 'a command the recorder typed no meaning for is a command');
});

test('(C 1, C 2) a Codex FileChange: an update keeps its line-numbered hunks; a delete carries the file it removed', async (t) => {
  const diff = '@@ -2,3 +2,3 @@\n line one\n-old\n+new\n line three\n';
  const ledger = await codex(t, [row({ id: 'f1', type: 'FileChange', status: 'completed', changes: {
    '/repo/src/a.js': { type: 'update', unified_diff: diff, move_path: null },
    '/repo/src/gone.js': { type: 'delete', content: 'export const gone = 1;\n' } } })]);
  const [update, del] = ledger.ledger.filter((e) => ['edit', 'delete'].includes(e.kind));
  assert.deepEqual(update.recorded, { tool: 'FileChange', patch: 'hunks', prior: 'hunks',
    hunks: [{ oldStart: 2, oldLines: 3, newStart: 2, newLines: 3, lines: [' line one', '-old', '+new', ' line three'] }] });
  assert.deepEqual(del.recorded, { tool: 'FileChange', prior: 'file' });
  // An add is the recorder's verb, not an existence check (Codex writes the file whether or not it was there): its
  // prior state is unrecorded, its verb typed (M36 review).
  const added = await codex(t, [row({ id: 'f2', type: 'FileChange', status: 'completed', changes: {
    '/repo/src/new.js': { type: 'add', content: 'export const x = 1;\n' } } })]);
  assert.deepEqual(added.ledger.find((e) => e.kind === 'create').recorded, { tool: 'FileChange', patch: 'body',
    prior: 'unrecorded', writeType: 'add' });
  assert.equal(del.before.text, 'export const gone = 1;\n');
  assert.equal(del.before.source, 'original');
});

test('(C 4) web search items: an Extension result is an action with its results quotable; a WebSearch item has none', async (t) => {
  const ledger = await codex(t, [
    row({ id: 'w1', type: 'Extension', kind: 'web.search', query: 'node test', action: { type: 'search', query: 'node test' },
      results: [{ type: 'web', ref_id: 'r1', title: 'Node test runner', url: 'https://example.invalid/a',
        domain: 'example.invalid', snippet: 'The test runner.', thumbnail_url: null }] }),
    row({ id: 'w2', type: 'WebSearch', query: 'node assert', action: { type: 'search', query: 'node assert' } })]);
  const searches = ledger.ledger.filter((e) => e.genericTool === true);
  assert.deepEqual(searches.map((e) => e.recorded.tool), ['Extension', 'WebSearch']);
  assert.deepEqual(searches[0].outputSpans, ['Node test runner', 'https://example.invalid/a', 'The test runner.']);
  assert.equal(searches[1].tailLines, undefined, 'the recorder kept no result');
  assert.equal(ledger.capture.unsupported ?? 0, 0, 'clean shapes are no gap');
});

test('parseUnifiedHunks reads numbers, defaults a missing length to 1, and refuses a hunk that does not add up', () => {
  assert.deepEqual(parseUnifiedHunks('@@ -1 +1 @@\n-a\n+b\n'), [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1,
    lines: ['-a', '+b'] }]);
  assert.deepEqual(parseUnifiedHunks('@@ -0,0 +1,2 @@\n+a\n+b'), [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2,
    lines: ['+a', '+b'] }]);
  assert.equal(parseUnifiedHunks('@@ -1,2 +1,2 @@\n-a\n+b\n'), null, 'one old line missing');
  assert.equal(parseUnifiedHunks('-a\n+b'), null, 'no header');
  assert.equal(parseUnifiedHunks(''), null);
});

// ---- E: an unrecorded change between two recorded states ------------------------------------------------------------

test('recordedHunks reads the recorder\'s hunks as written, any number of them (D68 E: no fixed size limit)', () => {
  assert.deepEqual(recordedHunks(EDIT_HUNKS), EDIT_HUNKS);
  assert.equal(recordedHunks([]), null);
  const many = Array.from({ length: 5000 }, (_, i) => patch(2 * i + 1, [`-a${i}`, `+b${i}`]));
  assert.equal(recordedHunks(many).length, 5000);
  assert.equal(validHunks(many).length, 5000);
});

test('E: a file changed between a recorded Write and a later recorded file by something not recorded as an edit', () => {
  const WRITTEN = FILE.replace('0.2;', '0.25;');
  const second = [patch(1, [' function rate() {', '-  return 0.3;', '+  return 0.35;', ' }'])];
  const rows = (between, original) => [userRow('tune the rate'),
    call('e1', 'Write', { file_path: '/repo/src/rate.js', content: WRITTEN }),
    result('e1', 'The file has been updated.', { type: 'update', filePath: '/repo/src/rate.js', content: WRITTEN,
      structuredPatch: EDIT_HUNKS, originalFile: FILE, userModified: false }),
    ...between,
    call('e2', 'Edit', { file_path: '/repo/src/rate.js', old_string: '  return 0.3;', new_string: '  return 0.35;' }),
    result('e2', 'The file has been updated.', editSidecar(original, second))];
  const sed = [call('b1', 'Bash', { command: "sed -i 's/0.25/0.3/' src/rate.js" }),
    result('b1', '', { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: true,
      bashEditDiff: { files: [{ filePath: '/repo/src/rate.js', hunks: [patch(2, ['-  return 0.25;', '+  return 0.3;'])] }] } })];
  const changed = FILE.replace('0.2', '0.3');
  const events = build(rows(sed, changed));
  const [first, , , last] = events;
  assert.equal(first.recorded.unrecordedChange, undefined);
  const bash = events.find((e) => e.kind === 'bash');
  assert.deepEqual(last.recorded.unrecordedChange, { since: { turn: first.turn, seq: first.seq },
    commands: [{ turn: bash.turn, seq: bash.seq }] });
  // The same file as the Write left it: nothing to record.
  const same = build(rows([], WRITTEN));
  assert.equal(same.at(-1).recorded.unrecordedChange, undefined);
  // An earlier state the record does not hold whole is never compared: the file an Edit left is not recorded, and is
  // never computed from its hunks (owner (H): no computed end state), whatever the recorded file before it.
  for (const firstOriginal of [null, FILE]) {
    const unknown = build([userRow('tune'),
      call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: '  return 0.2;', new_string: '  return 0.25;' }),
      result('e1', 'The file has been updated.', editSidecar(firstOriginal)),
      call('e2', 'Edit', { file_path: '/repo/src/rate.js', old_string: 'c', new_string: 'd' }),
      result('e2', 'The file has been updated.', editSidecar(changed, second))]);
    assert.equal(unknown.at(-1).recorded.unrecordedChange, undefined, String(firstOriginal !== null));
  }
  // Through redaction and the adapter: the earlier call and the command, by event id.
  const ledger = clean(events).ledger;
  const session = sessionFromLedger({ ...ledger, ask: [{ turn: 1, text: 'tune the rate' }] }, { sessionKey: 'm36-e' });
  const invocations = session.events.filter((e) => e.kind === 'invocation');
  const [i1, ib, i2] = [invocations[0], invocations.find((e) => e.operation === 'command'), invocations.at(-1)];
  assert.deepEqual(i2.recorded.unrecordedChange, { since: i1.id, commands: [ib.id] });
  assert.equal(i2.recorded.tool, 'Edit');
});

test('(c1) a shell write declares that the recorder kept no patch of it and no prior state', () => {
  const events = build([userRow('write it'), call('b1', 'Bash', { command: "cat > src/a.js <<'EOF'\nx\nEOF" }),
    result('b1', '', { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: true }),
    call('b2', 'Bash', { command: 'echo y > src/b.js' }), result('b2', '', { stdout: '', stderr: '', interrupted: false,
      isImage: false, noOutputExpected: true })]);
  const writes = events.filter((e) => typeof e.via === 'string');
  assert.deepEqual(writes.map((e) => e.recorded), [{ tool: 'Bash', prior: 'unrecorded', patch: 'body' },
    { tool: 'Bash', prior: 'unrecorded', patch: 'none' }]);
});

// ---- M36 review -------------------------------------------------------------------------------------------------------

const direct = (name, callId, input) => it({ type: 'function_call', name, call_id: callId, arguments: JSON.stringify(input) });
const output = (callId, value) => it({ type: 'function_call_output', call_id: callId, output: value });

test('(C 2) a delete an apply_patch call made, settled by its FileChange item: the content the item recorded is its prior state', async (t) => {
  const patchText = '*** Begin Patch\n*** Delete File: src/old.js\n*** End Patch';
  const ledger = await codex(t, [direct('functions.apply_patch', 'p1', { patch: patchText }),
    row({ id: 'p1', type: 'FileChange', status: 'completed', changes: {
      'src/old.js': { type: 'delete', content: 'export const old = 1;\n' } } }),
    output('p1', 'Success. Updated the following files:\nD src/old.js')]);
  const del = ledger.ledger.find((e) => e.kind === 'delete');
  assert.ok(Number.isInteger(del.sourceLocator.fileChangeRecord), 'joined to the item');
  assert.deepEqual(del.recorded, { tool: 'functions.apply_patch', prior: 'file' });
  assert.equal(del.before.source, 'original');
  assert.equal(del.before.text, 'export const old = 1;\n');
});

test('(c5) a call the recorder named a command tool is a command, whatever kind the slicer made of it', async (t) => {
  const ledger = await codex(t, [direct('shell_command', 's1', { command: 'ls -la' }), output('s1', 'a\nb'),
    direct('functions.shell_command', 's2', { command: 'pwd', workdir: '/repo' }), output('s2', '/repo'),
    direct('functions.exec_command', 's3', { cmd: ['git', 'status'] }), output('s3', 'clean'),
    direct('functions.update_plan', 's4', { plan: [] }), output('s4', 'ok')]);
  const facts = ledger.ledger.filter((e) => e.recorded?.tool).map((e) => [e.recorded.tool, e.recorded.commandClass]);
  assert.deepEqual(facts, [['shell_command', 'command'], ['functions.shell_command', 'command'],
    ['functions.exec_command', 'command'], ['functions.update_plan', undefined]]);
});

test('a recorder fact Sonah cannot carry is declared (`withheld`), never dropped in silence', async (t) => {
  // Claude Code: hunks that are not hunks; a URL, a task id or a hand-off status that is no string.
  const [edit] = build([userRow('raise the rate'),
    call('e1', 'Edit', { file_path: '/repo/src/rate.js', old_string: '  return 0.2;', new_string: '  return 0.25;' }),
    result('e1', 'The file has been updated.', editSidecar(FILE, [{ oldStart: 1 }]))]);
  assert.equal(edit.recorded.withheld, true);
  assert.equal(edit.recorded.hunks, undefined);
  const events = build([userRow('look'), call('f1', 'WebFetch', { url: 'https://example.invalid/doc', prompt: 'p' }),
    result('f1', 'doc', { bytes: 1, code: 200, url: { href: 'https://example.invalid/doc' } }),
    call('b1', 'Bash', { command: 'sleep 1', run_in_background: true }),
    result('b1', 'started', { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 42 })]);
  assert.deepEqual(events[0].recorded.fetch, { code: 200, bytes: 1 });
  assert.equal(events[0].recorded.withheld, true);
  assert.equal(events[1].recorded.backgroundTaskId, undefined);
  assert.equal(events[1].recorded.withheld, true);
  assert.deepEqual(claudeAgentFacts('Agent', { status: { done: true }, totalToolUseCount: 3 }),
    { tool: 'Agent', withheld: true, totalToolUseCount: 3 });
  // D69 review (audit): a recorder string is carried whatever its length or shape — the bounds (`RECORDED_FACT_LIMITS`:
  // 4,096 characters, a guessed task-id shape, a `[a-z_]{1,40}` status) are deleted, as none of them changed a
  // recording; redaction still withholds a flagged one whole.
  const long = `https://example.invalid/${'a'.repeat(5000)}`;
  const carried = build([userRow('look'), call('f2', 'WebFetch', { url: long, prompt: 'p' }),
    result('f2', 'doc', { bytes: 1, code: 200, url: long }),
    call('b2', 'Bash', { command: 'sleep 1', run_in_background: true }),
    result('b2', 'started', { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'task id!' })]);
  assert.deepEqual(carried[0].recorded.fetch, { url: long, code: 200, bytes: 1 });
  assert.equal(carried[0].recorded.withheld, undefined);
  assert.equal(carried[1].recorded.backgroundTaskId, 'task id!');
  assert.deepEqual(claudeAgentFacts('Agent', { status: 'Completed Fully', totalToolUseCount: 3 }),
    { tool: 'Agent', status: 'Completed Fully', totalToolUseCount: 3 });
  // Codex: a parsed command of a shape outside the closed one, an update whose diff holds no readable hunk.
  const ledger = await codex(t, [command('c1', 'ls', [{ type: 'spell', cmd: 'x' }]),
    row({ id: 'f1', type: 'FileChange', status: 'completed', changes: {
      '/repo/src/a.js': { type: 'update', unified_diff: 'not a diff', move_path: null } } })]);
  const [bash, update] = ['bash', 'edit'].map((kind) => ledger.ledger.find((e) => e.kind === kind));
  assert.deepEqual([bash.recorded.commandClass, bash.recorded.withheld], ['command', true]);
  assert.deepEqual([update.recorded.prior, update.recorded.withheld], ['unrecorded', true]);
  // No count bounds a parsed command: 300 reads are a read.
  const reads = Array.from({ length: 300 }, (_, i) => ({ type: 'read', cmd: `cat f${i}`, name: `f${i}`, path: `f${i}` }));
  const many = await codex(t, [command('c2', 'cat f*', reads)]);
  assert.equal(many.ledger.find((e) => e.kind === 'bash').recorded.commandClass, 'read');
});

test('D69 (c): a command\'s bashEditDiff files are spelled by the recorder\'s cwd, as the edits of the same files are', () => {
  const sidecar = (path) => ({ filePath: path, oldString: 'a', newString: 'b', originalFile: null,
    structuredPatch: [patch(1, ['-a', '+b'])] });
  const rows = [userRow('fix it'),
    call('e1', 'Edit', { file_path: '/srv/work/proj/src/a.js', old_string: 'a', new_string: 'b' }),
    result('e1', 'The file has been updated.', sidecar('/srv/work/proj/src/a.js')),
    call('e2', 'Edit', { file_path: '/srv/work/proj/src/b.js', old_string: 'a', new_string: 'b' }),
    result('e2', 'The file has been updated.', sidecar('/srv/work/proj/src/b.js')),
    call('b1', 'Bash', { command: 'node fix.js' }),
    result('b1', 'done', { stdout: 'done', stderr: '', interrupted: false, isImage: false, noOutputExpected: false,
      bashEditDiff: { files: [{ filePath: '/srv/work/proj/src/a.js', hunks: [patch(1, ['-b', '+c'])] },
        { filePath: '/srv/u/start/notes.md', hunks: [patch(0, ['+n'])], created: true }],
      changedFiles: ['/srv/work/proj/src/a.js', '/srv/u/start/notes.md'] } })];
  const events = buildEvents(rows.map((r, i) => ({ ...r, line: i + 1, source: 0 })), { cwd: '/srv/u/start' }).events;
  const [a, , bash] = events;
  // No work root is elected from the writes (D69 c): a file outside the cwd is spelled as recorded, one path everywhere —
  // D69 review (F7): its leading `/` kept, so it never reads as a file of the project.
  assert.equal(a.path, '/srv/work/proj/src/a.js');
  assert.equal(a.external, true);
  assert.deepEqual(bash.recorded.editDiff.files.map((f) => f.path), ['/srv/work/proj/src/a.js', 'notes.md']);
  assert.deepEqual(bash.recorded.editDiff.changedFiles, ['/srv/work/proj/src/a.js', 'notes.md']);
  assert.equal(JSON.stringify(events).includes('_editDiffAbs'), false, 'no transient path is left');
});
