// W3c-11 — shell writes are seen, and a heredoc's body is recorded.
//
// W3c-8 found the gaps: a `sed -i` whose quoted script holds a space produced
// no event at all, a write inside a command classed as a test (`npm test 2>&1 | tee out.txt`) was
// never looked for, and a heredoc — whose whole body sits in the recorded command — was declared
// "unrecorded" although the record carries every byte of it.
//
// The heredoc body is taken from the REDACTED command, never the raw one: the redactor's `cmd`
// posture is the one this text arrived under, so the body can never hold a byte the recorded
// command would not. The planted-secret tests below read the slicer's own output, BEFORE the
// pipeline's redaction pass, so a body copied from the raw command fails them.
//
// Every fixture is synthetic. No real recording is read and no session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';
import { attachBefore } from '../src/before.js';
import { redact } from '../../redact/index.js';

// ---- synthetic records ---------------------------------------------------------------
let seq = 0;
const uid = () => `w3c11-${String(++seq).padStart(6, '0')}`;
const base = { sessionId: 'sess-w3c11', cwd: '/repo', version: '2.1.205', isSidechain: false };
const userTurn = (text) => ({ ...base, type: 'user', uuid: uid(), message: { role: 'user', content: text } });
const toolUse = (id, name, input) => ({ ...base, type: 'assistant', uuid: uid(),
  message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content) => ({ ...base, type: 'user', uuid: uid(),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });

const records = (raw) => raw.map((r, i) => ({ kind: r.type, raw: r, line: i + 1, source: 0 }));
const build = (raw, cwd = '/repo') => buildEvents(records(raw), { cwd }).events;

/** One command, run and answered; returns every event and the shell-write siblings. */
function run(command, out = '') {
  const events = build([userTurn('go'), toolUse('b1', 'Bash', { command }), toolResult('b1', out)]);
  return { events, writes: events.filter((e) => typeof e.via === 'string') };
}
const byPath = (writes) => Object.fromEntries(writes.map((w) => [w.path, w]));

test('a sole lexically complete direct shell write carries status eligibility', () => {
  const commands = [
    "cat > src/one.js <<'EOF'\nexport const one = 1;\nEOF",
    "sed -i 's/old/new/' src/one.js",
    "echo 'export const one = 1' > src/one.js",
    "printf '%s\\n' 'export const one = 1' >> src/one.js",
  ];
  for (const command of commands) {
    const { writes } = run(command);
    assert.equal(writes.length, 1, 'fixture proves exactly one inferred write');
    assert.equal(writes[0].shellWriteStatusEligible, true);
  }
});

test('compound, nested, incomplete and heuristic shell writes cannot inherit command status', () => {
  const commands = [
    'tee src/one.js; false',
    "sed -i 's/old/new/' src/one.js; true",
    "sed -i 's/old/new/e' src/one.js",
    "echo one > src/one.js | cat",
    'echo $(date) > src/one.js',
    'echo one > src/one.js > src/two.js',
    'echo one > src/one.js; echo two > src/two.js',
    "cat > src/one.js <<'EOF'\nunterminated\n",
    'cat > src/one.js <<',
    "node -e \"require('fs').writeFileSync('src/one.js','one')\"",
  ];
  for (const [index, command] of commands.entries()) {
    const { writes } = run(command);
    assert.ok(writes.length > 0, `fixture ${index} retains the inferred write`);
    assert.ok(writes.every((write) => write.shellWriteStatusEligible !== true));
  }
  assert.ok(run("bash -c 'echo one > src/one.js'").writes.every((write) =>
    write.shellWriteStatusEligible !== true));
});

// ---- 1. heredoc bodies --------------------------------------------------------------

test('W3c-11 a quoted heredoc records exactly the bytes between the delimiter lines as its after', () => {
  const { writes } = run("cat > src/limits.js <<'EOF'\nexport const MAX = 120;\nexport const MIN = 1;\nEOF");
  assert.equal(writes.length, 1);
  const [w] = writes;
  assert.equal(w.path, 'src/limits.js');
  assert.equal(w.via, 'heredoc');
  assert.deepEqual(w.after, { text: 'export const MAX = 120;\nexport const MIN = 1;\n', truncated: false, lines: 3 },
    'the body, no delimiter line, no command line, no extent flag for a plain overwrite');
  assert.ok(!('_body' in w) && !('_heredoc' in w), 'no transient field survives');

  const dq = run('cat > src/limits.js <<"EOF"\nexport const MAX = 120;\nEOF').writes[0];
  assert.deepEqual(dq.after, { text: 'export const MAX = 120;\n', truncated: false, lines: 2 },
    'a double-quoted delimiter is quoted too: no expansion');
});

test('W3c-11 an unquoted delimiter records the body and declares it was expanded', () => {
  const { writes: [w] } = run('cat > deploy/env.sh <<EOF\nexport ROOT=$PWD\nEOF');
  assert.equal(w.after.text, 'export ROOT=$PWD\n', 'the text as recorded, never a guessed expansion');
  assert.equal(w.after.expanded, true, 'the file received this text after shell expansion');
  assert.equal(w.after.append, undefined);
});

test('W3c-11 <<- strips leading tabs from the body and finds an indented delimiter', () => {
  const { writes: [w] } = run("if true; then\n\tcat > src/a.py <<-'EOF'\n\tdef f():\n\t    return 1\n\tEOF\nfi");
  assert.equal(w.path, 'src/a.py');
  assert.equal(w.after.text, 'def f():\n    return 1\n', 'leading TABS go, the indentation spaces stay');
  assert.equal(w.after.expanded, undefined);
});

test('W3c-11 cat >> with a heredoc is an append, and says so', () => {
  const { writes: [w] } = run("cat >> CHANGELOG.md <<'EOF'\n- rate limiting\nEOF");
  assert.equal(w.path, 'CHANGELOG.md');
  assert.equal(w.via, 'heredoc');
  assert.equal(w.after.text, '- rate limiting\n');
  assert.equal(w.after.append, true, 'the file received this text at its end, not as its whole state');
});

test('W3c-11 the operator may come before the redirect: cat <<EOF > path', () => {
  const { writes: [w] } = run("cat <<'EOF' > docs/notes.md\n# Notes\nEOF");
  assert.equal(w.path, 'docs/notes.md');
  assert.equal(w.via, 'heredoc');
  assert.equal(w.after.text, '# Notes\n');
});

test('W3c-11 several heredocs in one command each keep their own body; an apostrophe in one derails nothing', () => {
  const { writes } = run([
    "cat > docs/a.md <<'EOF'", "it's done", 'EOF',
    "cat > docs/b.md <<'EOF'", 'B', 'EOF',
    "sed -i 's/max: 100/max: 120/' config/limits.yml",
  ].join('\n'));
  const w = byPath(writes);
  assert.deepEqual(Object.keys(w).sort(), ['config/limits.yml', 'docs/a.md', 'docs/b.md']);
  assert.equal(w['docs/a.md'].after.text, "it's done\n");
  assert.equal(w['docs/b.md'].after.text, 'B\n');
  assert.equal(w['config/limits.yml'].via, 'sed -i');
  assert.equal(w['config/limits.yml'].after, undefined, 'a sed script is not a body');
});

test('W3c-11 a heredoc inside a runner command is still recorded, and the command stays a command (M1: `bash`)', () => {
  const { events, writes } = run("npm test && cat > test/summary.md <<'EOF'\nall green\nEOF", 'Tests: 3 passed');
  assert.equal(events.find((e) => e.cmd).kind, 'bash');
  assert.deepEqual(writes.map((w) => `${w.path} via ${w.via}`), ['test/summary.md via heredoc']);
  assert.equal(writes[0].after.text, 'all green\n');
});

test('W3c-11 an unterminated heredoc is still a write, but its body is never guessed', () => {
  const { writes } = run("cat > src/x.js <<'EOF'\nconst x = 1;\n");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'src/x.js');
  assert.equal(writes[0].after, undefined, 'no terminating line: the record does not say where the body ends');
});

test('W3c-11 a path written twice in one command carries no heredoc body: the body is not its final state', () => {
  const { writes } = run("cat > src/x.js <<'EOF'\nconst A = 1;\nEOF\nsed -i 's/A = 1/A = 2/' src/x.js");
  assert.equal(writes.length, 1, 'one path, one sibling');
  assert.equal(writes[0].after, undefined);
});

test('W3c-11 an empty heredoc empties the file, and that is recorded as empty', () => {
  const { writes: [w] } = run("cat > src/empty.js <<'EOF'\nEOF");
  assert.deepEqual(w.after, { text: '', truncated: false, lines: 0 });
});

test('W3c-11, D68 (E) an over-long heredoc body is kept whole through redaction', () => {
  const body = `${'x'.repeat(20_000)}\nTAIL_RECORDED\n`;
  const { events } = run(`cat > src/big.js <<'EOF'\n${body}EOF`);
  const [w] = redact({ ask: [], ledger: events, claim: {} }).ledger.ledger.filter((e) => typeof e.via === 'string');
  assert.equal(w.after.truncated, false);
  assert.equal(w.after.text, body);
});

test('W3c-11 a delete after a heredoc overwrite takes its body as prior state; after an appended heredoc it does not', () => {
  const overwrite = [
    { turn: 1, seq: 0, kind: 'read', path: 'a.md', _readText: 'OLD' },
    { turn: 2, seq: 1, kind: 'edit', path: 'a.md', via: 'heredoc', _body: 'NEW\n', _heredoc: { append: false, expanded: false } },
    { turn: 3, seq: 0, kind: 'delete', path: 'a.md' },
  ];
  attachBefore(overwrite);
  assert.equal(overwrite[2].before.text, 'NEW\n');
  assert.equal(overwrite[2].before.source, 'write');

  const appended = [
    { turn: 1, seq: 1, kind: 'edit', path: 'b.md', via: 'heredoc', _body: 'MORE\n', _heredoc: { append: true, expanded: false } },
    { turn: 2, seq: 0, kind: 'delete', path: 'b.md' },
  ];
  attachBefore(appended);
  assert.equal(appended[1].before, undefined, 'an appended tail is not the state of the file');
  assert.equal(appended[0].after.append, true);
});

test('W3c-11 end to end: the heredoc reaches its change as a recorded body; a tee beside it stays unrecorded', async () => {
  // The adapter owns placement (packages/evidence); this pins only that the slicer's `after`
  // is the field it reads, so a heredoc is no longer declared a write whose body is missing.
  const { sessionFromLedger } = await import('../../evidence/adapters/sonah-ledger.js');
  const events = build([userTurn('write the fixture and log the run'),
    toolUse('b1', 'Bash', { command: "cat > test/fixtures/orders.json <<'EOF'\n[{\"id\": 1}]\nEOF\nnode gen.js | tee docs/api.md" }),
    toolResult('b1', 'ok')]);
  const { ledger } = redact({ ask: [{ turn: 1, text: 'write the fixture and log the run' }], ledger: events, claim: {} });
  const session = sessionFromLedger(ledger, { sessionKey: 'w3c11' });
  const changes = Object.fromEntries(session.events.filter((e) => e.kind === 'invocation')
    .flatMap((e) => e.changes ?? []).map((c) => [c.path, c]));
  assert.equal(changes['test/fixtures/orders.json'].extent.recorded, true);
  assert.equal(changes['test/fixtures/orders.json'].extent.chars, '[{"id": 1}]\n'.length);
  assert.equal(changes['docs/api.md'].extent.recorded, false, 'a tee body is the output of a command, never in the record');
});

// ---- 1. the body comes from the REDACTED command --------------------------------------------

const KEY = 'AKIAIOSFODNN7EXAMPLE';

test('W3c-11 a planted secret in a heredoc body never reaches the recorded body, even before redaction runs', () => {
  const command = `cat > config/deploy.json <<'EOF'\n{"region": "eu-west-1",\n "aws": "${KEY}"}\nEOF`;
  const { events, writes: [w] } = run(command);
  assert.equal(w.path, 'config/deploy.json');
  assert.ok(typeof w.after?.text === 'string', 'the body is recorded');
  assert.ok(!w.after.text.includes(KEY), 'the slicer took the body from the redacted command, not the raw one');
  assert.ok(w.after.text.includes('‹redacted'), 'and the redactor\'s marker says where the secret was');
  assert.ok(w.after.text.startsWith('{"region": "eu-west-1",\n'), 'the rest of the body is intact');

  const clean = redact({ ask: [], ledger: events, claim: {} }).ledger;
  assert.ok(!JSON.stringify(clean).includes(KEY), 'and nothing downstream of redaction carries it either');
});

test('W3c-11 when redaction drops the whole command, the heredoc body is not recorded (fail closed)', () => {
  // An unclassifiable high-entropy token fails the `cmd` channel closed: the whole command goes.
  // A body copied from the raw command and scrubbed line by line would keep every other line.
  const NOISE = 'Zq8x-T3vL_m9Rk2Wp7Yd4Hs6Nf1Bc5Gj0Xa';
  const command = `cat > src/seed.js <<'EOF'\nexport const PUBLIC = 1;\nexport const SEED = '${NOISE}';\nEOF`;
  const probe = redact({ ask: [], ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: command }], claim: {} });
  assert.equal(probe.ledger.ledger[0].cmd, undefined, 'fixture check: the redactor drops this command');

  const { writes } = run(command);
  assert.equal(writes.length, 1, 'the write is still seen: its path is not a secret');
  assert.equal(writes[0].after, undefined, 'the body the redacted command does not hold is not recorded');
});

// ---- 2. sed -i with quoted scripts ---------------------------------------------------------

test('W3c-11 the W3c-8 example: sed -i with a quoted script holding spaces is a write', () => {
  const { writes } = run("sed -i 's/max: 100/max: 120/' config/limits.yml");
  assert.deepEqual(writes.map((w) => `${w.path} via ${w.via}`), ['config/limits.yml via sed -i']);
});

test('W3c-11 sed -i forms: BSD suffix, attached suffix, double quotes, several -e, several files', () => {
  const cases = [
    ["sed -i '' 's/a b/c d/' src/a.js", ['src/a.js']],
    ['sed -i.bak "s/foo bar/baz/g" src/b.js', ['src/b.js']],
    ["sed -i -e 's/a/b/' -e 's/c d/e/' src/c.js", ['src/c.js']],
    ["sed -i '' -e 's/a/b/' -e 's/c d/e/' src/c2.js", ['src/c2.js']],
    ["sed -Ei 's/x y/z/' src/d.js src/e.js", ['src/d.js', 'src/e.js']],
    ["sed -i 's/a/b/; s/c/d/' src/f.js", ['src/f.js']],
    ["sed -i \\\n  -e 's/a/b/' \\\n  src/g.js", ['src/g.js']],
    ["sed --in-place=.orig --expression='s/a b/c/' src/h.js", ['src/h.js']],
    ["sed -i 's/a/b/' src/i.js 2>/dev/null", ['src/i.js']],
    ["cd /repo && sed -i 's/old name/new name/g' src/j.js && npm run build", ['src/j.js']],
  ];
  for (const [command, expected] of cases) {
    const { writes } = run(command);
    assert.deepEqual(writes.map((w) => w.path).sort(), expected, command);
    assert.ok(writes.every((w) => w.via === 'sed -i'), command);
  }
});

test('W3c-11 a path-qualified sed, and GNU sed installed as gsed, are sed', () => {
  // The old line scan's `\bsed` matched `/usr/bin/sed -i`, and reading the command word as exactly
  // `sed` lost such writes.
  for (const [command, expected] of [
    ["/usr/bin/sed -i 's/a b/c/' src/k.js", ['src/k.js']],
    ["gsed -i 's/a b/c/' src/l.js", ['src/l.js']],
    ["sudo /bin/sed -i -e 's/x/y/' conf/app.yml", ['conf/app.yml']],
  ]) {
    const { writes } = run(command);
    assert.deepEqual(writes.map((w) => `${w.path} via ${w.via}`), expected.map((p) => `${p} via sed -i`), command);
  }
  assert.deepEqual(run("unsed -i 's/a/b/' src/m.js").writes, [], 'a different program whose name ends in sed is not sed');
});

test('W3c-11 sed without -i writes nothing it names; its redirect target is the write', () => {
  assert.deepEqual(run("sed -n '1,20p' src/a.js").writes, []);
  assert.deepEqual(run("sed 's/a b/c/' src/in.js > src/out.js").writes.map((w) => `${w.path} via ${w.via}`),
    ['src/out.js via redirect']);
});

// ---- 3. writes inside commands of any class ---------------------------------------------

test('W3c-11 npm test 2>&1 | tee out.txt stays a command and gains its write sibling', () => {
  const { events, writes } = run('npm test 2>&1 | tee out.txt', 'Tests: 12 passed, 12 total');
  const cmd = events.find((e) => e.cmd);
  assert.equal(cmd.kind, 'bash', 'M1: every shell command is `bash`');
  assert.deepEqual(writes.map((w) => `${w.path} via ${w.via}`), ['out.txt via tee']);
  assert.equal(events.indexOf(writes[0]), events.indexOf(cmd) + 1, 'the sibling directly follows its command');
});

test('W3c-11 redirects and tee -a from runner commands are writes too', () => {
  assert.deepEqual(run('pytest -x > results.txt').writes.map((w) => `${w.path} via ${w.via}`), ['results.txt via redirect']);
  assert.deepEqual(run('npm test 2>&1 | tee -a logs/runs.txt').writes.map((w) => `${w.path} via ${w.via}`),
    ['logs/runs.txt via tee']);
  assert.equal(run('pytest -x > results.txt').events.find((e) => e.cmd).kind, 'bash');
});

// ---- 4. F129: a delete after an empty write ------------------------------------------------

test('F129 a delete after a Write of empty content takes the empty write as its prior state, not an older read', () => {
  const events = [
    { turn: 1, seq: 0, kind: 'read', path: 'src/gone.js', _readText: 'OLD' },
    { turn: 2, seq: 0, kind: 'create', path: 'src/gone.js', _body: '', _writeType: 'update' },
    { turn: 3, seq: 0, kind: 'delete', path: 'src/gone.js' },
  ];
  attachBefore(events);
  assert.deepEqual(events[2].before, { text: '', source: 'write', turn: 2, seq: 0, partial: false, truncated: false, lines: 0 },
    'the last thing the record saw at that path is the emptied file');
});

// ---- 5. F131: NotebookEdit edit_mode ------------------------------------------------------

test('F131 NotebookEdit delete records no after and no diff for the cell', () => {
  const events = build([
    userTurn('drop the scratch cell'),
    toolUse('n1', 'NotebookEdit', { notebook_path: '/repo/notes/explore.ipynb', cell_id: 'c3', new_source: 'print(1)', edit_mode: 'delete' }),
    toolResult('n1', 'Deleted cell c3.'),
  ]);
  const [cell] = events.filter((e) => e.kind === 'edit');
  assert.equal(cell.path, 'notes/explore.ipynb');
  assert.equal(cell.after, undefined, 'a deleted cell has no after');
  assert.equal(cell.diff, undefined, 'and no diff claiming its source was written');
});

test('F131 NotebookEdit insert records the new cell source as its body, declared as an insert', () => {
  const events = build([
    userTurn('add an imports cell'),
    toolUse('n2', 'NotebookEdit', { notebook_path: '/repo/notes/explore.ipynb', cell_type: 'code', new_source: 'import os\n', edit_mode: 'insert' }),
    toolResult('n2', 'Inserted cell.'),
    toolUse('n3', 'NotebookEdit', { notebook_path: '/repo/notes/explore.ipynb', cell_id: 'c1', new_source: 'x = 2\n' }),
    toolResult('n3', 'Updated cell c1.'),
  ]);
  const [inserted, replaced] = events.filter((e) => e.kind === 'edit');
  assert.deepEqual(inserted.after, { text: 'import os\n', truncated: false, lines: 2, insert: true });
  assert.deepEqual(replaced.after, { text: 'x = 2\n', truncated: false, lines: 2 }, 'the default mode declares nothing new');
  assert.ok(!('_insert' in inserted), 'no transient field survives');
});
