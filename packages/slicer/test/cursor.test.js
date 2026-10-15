import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  isCursorSession, cursorSessionDir, sanitizePathForCursor, resolveCursorLineages,
  cursorLineageKey, readCursorSession, stripCursorTags,
} from '../src/cursor.js';
import { readSession } from '../src/records.js';
import { labelCursorRecords } from '../src/cursor.js';
import { opensTurn } from '../src/labels.js';
import { sliceLineage } from '../index.js';
import { scratchDir } from './scratch-dir.js';

// Every fixture lives under a fake HOME containing a space — this repo's oldest enemy.
async function fakeHome() {
  return scratchDir('sonah cursor-');
}

/** Write one Cursor transcript in either layout and return its path. */
async function session(home, repo, id, lines, { nested = false } = {}) {
  const dir = cursorSessionDir(repo, { home });
  const fileDir = nested ? join(dir, id) : dir;
  await mkdir(fileDir, { recursive: true });
  const f = join(fileDir, `${id}.jsonl`);
  await writeFile(f, lines.join('\n'), 'utf8');
  return f;
}

const user = (text) => JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text }] } });
const asst = (blocks) => JSON.stringify({ role: 'assistant', message: { content: blocks } });

// Shapes transcribed from Entire's real capture:
// entireio/cli cmd/entire/cli/agent/cursor/testdata/real_session_tool_use.jsonl
const REPO = '/Users/x/Downloads/Acme Labs/repo';
const WRAPPED_ASK = '<timestamp>Monday, Aug 24, 2026, 3:01 PM (UTC-5)</timestamp>\n<user_query>\nfix the flaky test\n</user_query>';

test('sanitisation matches Cursor: leading slash gone, every non-alphanumeric — spaces included — becomes a dash', () => {
  // Transcribed from their cursor.go sanitizePathForCursor; "Acme Labs" is the case that matters.
  assert.equal(sanitizePathForCursor(REPO), 'Users-x-Downloads-Acme-Labs-repo');
  assert.equal(sanitizePathForCursor('/a/b.c_d'), 'a-b-c-d');
});

test('session dir follows their convention: ~/.cursor/projects/<sanitized>/agent-transcripts', () => {
  const home = '/Users/synthetic user';
  assert.equal(
    cursorSessionDir(REPO, { home }),
    join(home, '.cursor', 'projects', 'Users-x-Downloads-Acme-Labs-repo', 'agent-transcripts'),
  );
  assert.equal(cursorSessionDir(REPO, { home: '' }), null);
});

test('routing is by session-dir convention and survives a home directory with a space', () => {
  assert.ok(isCursorSession('/Users/synthetic user/.cursor/projects/Users-x-repo/agent-transcripts/abc.jsonl'));
  assert.ok(isCursorSession('/h/.cursor/projects/p/agent-transcripts/abc/abc.jsonl')); // IDE nested
  assert.ok(!isCursorSession('/Users/x/.claude/projects/p/abc-123.jsonl'));
  assert.ok(!isCursorSession('/x/.codex/sessions/2026/08/rollout-2026-08-31T10-00-00-a.jsonl'));
});

test('discovery finds both layouts: CLI flat <id>.jsonl and IDE nested <id>/<id>.jsonl', async () => {
  const home = await fakeHome();
  const flat = await session(home, REPO, 'conv-flat', [user('hi')]);
  const nested = await session(home, REPO, 'conv-nested', [user('hi')], { nested: true });
  // An empty conversation dir: the IDE creates the directory before flushing the file
  // (their ResolveSessionFile comment). Must not error, must not surface.
  await mkdir(join(cursorSessionDir(REPO, { home }), 'conv-pending'), { recursive: true });

  const lineages = await resolveCursorLineages(REPO, { home });
  const files = lineages.flat();
  assert.equal(files.length, 2);
  assert.ok(files.includes(flat));
  assert.ok(files.includes(nested));
  // No continuation pointer exists in their code, so every file stands alone.
  assert.ok(lineages.every((l) => l.length === 1));
});

test('discovery of a repo with no Cursor history is empty, never an error', async () => {
  const home = await fakeHome();
  assert.deepEqual(await resolveCursorLineages('/no/such/repo', { home }), []);
  assert.deepEqual(await resolveCursorLineages(REPO, { home: '' }), []);
});

test('readSession routes a .cursor/projects path to the Cursor reader', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-route', [user(WRAPPED_ASK)]);
  const { meta } = await readSession(f);
  assert.equal(meta.agent, 'cursor');
  // Identity comes from the filename — the lines carry no sessionId (their AGENT.md).
  assert.equal(meta.sessionId, 'conv-route');
  assert.equal(cursorLineageKey(meta), 'conv-route');
});

test('role is normalised to type: without it every Cursor line reads as scaffolding', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-role', [
    user('do the thing'),
    asst([{ type: 'text', text: 'done' }]),
  ]);
  const { records } = await readCursorSession(f);
  assert.deepEqual(records.map((r) => r.kind), ['user', 'assistant']);
});

test('timestamp prefix and user_query wrapper are stripped from the ask; pasted <timestamp> content survives', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-strip', [user(WRAPPED_ASK)]);
  const l = await sliceLineage([f], { cwd: REPO });
  assert.equal(l.ask.length, 1);
  assert.equal(l.ask[0].text, 'fix the flaky test');

  // The strip is anchored to the message start (their ide_tags.go: "position is the only safe
  // discriminator") — a <timestamp> element pasted BY the user is content, not scaffolding.
  const pasted = stripCursorTags('<user_query>\nwhy does <timestamp>{{now}}</timestamp> render empty?\n</user_query>');
  assert.equal(pasted, 'why does <timestamp>{{now}}</timestamp> render empty?');
});

test('a user turn that is only IDE-injected context strips to nothing and is not a human turn', () => {
  const d = {
    type: 'user',
    message: { content: [{ type: 'text', text: stripCursorTags('<ide_opened_file>src/a.js</ide_opened_file>') }] },
  };
  // M34 labels: Cursor's labeller labels a user block holding only the scaffolding its reader strips as harness.
  const [rec] = labelCursorRecords([{ kind: 'user', raw: d }]);
  assert.equal(rec.label, 'harness');
  assert.equal(opensTurn(rec), false);
});

test('Cursor tool calls land as canonical events: Shell→bash, StrReplace→edit, Write contents→create, Glob keys→read', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-tools', [
    user(WRAPPED_ASK),
    asst([{ type: 'tool_use', name: 'Shell', input: { command: 'npm test', description: 'run suite' } }]),
    asst([{ type: 'tool_use', name: 'StrReplace', input: { path: `${REPO}/src/app.js`, old_string: 'a', new_string: 'b' } }]),
    asst([{ type: 'tool_use', name: 'Write', input: { path: `${REPO}/notes.md`, contents: 'line 1\nline 2' } }]),
    asst([{ type: 'tool_use', name: 'Glob', input: { glob_pattern: '**/*.md', target_directory: `${REPO}/docs` } }]),
    JSON.stringify({ type: 'turn_ended', status: 'success' }), // scaffolding, dropped silently
  ]);
  const l = await sliceLineage([f], { cwd: REPO });

  const kinds = l.ledger.map((e) => e.kind);
  assert.deepEqual(kinds, ['bash', 'edit', 'create', 'read']);

  const [testEv, edit, create, glob] = l.ledger;
  assert.equal(testEv.cmd, 'npm test');
  // Paths are keyed `path` and absolute in Cursor transcripts; they must come out repo-relative
  // even when the repo path contains a space.
  assert.equal(edit.path, 'src/app.js');
  assert.match(edit.argsExcerpt, /a/);
  assert.equal(create.path, 'notes.md');
  assert.match(create.argsExcerpt, /line 1/, 'Write body is keyed `contents`; it must survive as the create args');
  assert.equal(glob.path, 'docs', 'target_directory maps to the read path, repo-relative');
});

test('CAVEAT: a transcript with tool calls but no outputs marks shell outcomes unknown, never inferred', async () => {
  // Entire's real capture has six tool_use blocks and zero tool_result carriers — Cursor omits
  // tool outputs on disk in some modes. A degraded verdict is worse than no verdict.
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-noout', [
    user(WRAPPED_ASK),
    asst([{ type: 'tool_use', name: 'Shell', input: { command: 'pytest tests/', description: 'run tests' } }]),
    asst([{ type: 'tool_use', name: 'StrReplace', input: { path: `${REPO}/src/app.js`, old_string: 'a', new_string: 'b' } }]),
    asst([{ type: 'tool_use', name: 'Read', input: { path: `${REPO}/src/app.js` } }]),
  ]);

  const { meta } = await readCursorSession(f);
  assert.equal(meta.toolOutputsMissing, true);

  const l = await sliceLineage([f], { cwd: REPO });
  const shell = l.ledger.find((e) => e.kind === 'bash');
  assert.equal(shell.outcome, 'unknown');
  assert.equal(shell.tailLines, undefined, 'no output means no tail — nothing is fabricated');

  const read = l.ledger.find((e) => e.kind === 'read');
  assert.equal(read.bytes, undefined, 'a synthetic empty result would fabricate bytes:0 — a claim, not an absence');
});

test('when Cursor DOES record outputs they attach normally, and outputs-missing is not flagged', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-out', [
    user(WRAPPED_ASK),
    asst([{ type: 'tool_use', id: 'call_1', name: 'Shell', input: { command: 'pytest tests/' } }]),
    JSON.stringify({
      role: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '1 failed, 3 passed' }] },
    }),
    // A second call whose result never arrived: stays absent, exactly like Claude Code.
    asst([{ type: 'tool_use', id: 'call_2', name: 'Shell', input: { command: 'npm run build' } }]),
  ]);

  const { meta } = await readCursorSession(f);
  assert.equal(meta.toolOutputsMissing, false);

  const l = await sliceLineage([f], { cwd: REPO });
  const t = l.ledger.find((e) => e.cmd === 'pytest tests/');
  assert.deepEqual(t.tailLines, ['1 failed, 3 passed'], 'the output attaches');
  assert.equal(t.outcome, 'unknown', 'H1: Cursor records no typed status here, and its output text is never read for one');
  const b = l.ledger.find((e) => e.cmd === 'npm run build');
  assert.equal(b.outcome, undefined, 'one individually missing result is not the outputs-omitting mode');
});

test('one malformed line costs one line, never the session', async () => {
  const home = await fakeHome();
  const f = await session(home, REPO, 'conv-corrupt', [
    'null',
    '{broken json',
    user('still here'),
  ]);
  const { records, corrupt } = await readCursorSession(f);
  assert.equal(corrupt, 2);
  assert.equal(records.length, 1);
});
