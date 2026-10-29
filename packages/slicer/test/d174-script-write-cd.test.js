// D174: a script's relative write is placed by the `cd` before its command, exactly as the shell forms are (shellWrites
// `dir`), by the script's offset in the command; an unresolved, relative or later `cd` leaves it where it was (beta.9
// known issue 2, narrowed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sliceLineage } from '../index.js';
import { scratchDir } from './scratch-dir.js';

const CWD = '/w/main repo';
async function edits(command) {
  const d = await scratchDir('script-cd-');
  const f = join(d, 's.jsonl');
  await writeFile(f, [
    JSON.stringify({ type: 'user', cwd: CWD, sessionId: 's', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
    JSON.stringify({ type: 'assistant', cwd: CWD, message: { role: 'assistant', content: [{ type: 'tool_use', id: '1',
      name: 'Bash', input: { command } }] } }),
  ].join('\n'), 'utf8');
  return (await sliceLineage([f])).ledger.filter((e) => e.kind === 'edit')
    .map((e) => `${e.path}${e.external ? ' external' : ''} via ${e.via}`);
}

test('a script after an absolute cd writes there, as a shell form does', async () => {
  assert.deepEqual(await edits(`cd "/w/other tree" && python3 - <<'PY'\nopen('src/a.js','w').write('x')\nPY`),
    ['/w/other tree/src/a.js external via script open(w)']);
  assert.deepEqual(await edits(`cd /w/other && node -e "require('fs').writeFileSync('lib/b.js','x')"`),
    ['/w/other/lib/b.js external via script writeFile']);
  assert.deepEqual(await edits(`D=/w/other; cd "$D"; python3 - <<'PY'\np='f.json'\nopen(p,'w')\nPY`),
    ['/w/other/f.json external via script open(w)']);
  // A command the lexer cannot read keeps its line split, with the same offsets.
  assert.deepEqual(await edits(`cd /w/other && python3 -c "open('k.py','w')" '`), ['/w/other/k.py external via script open(w)']);
  assert.deepEqual((await edits(`python3 -c "open('k0.py','w')" && cd /w/a; python3 -c "open('k1.py','w')"; cd /w/b; true; `
    + `python3 -c "open('k2.py','w')" '`)).sort(),
  ['/w/a/k1.py external via script open(w)', '/w/b/k2.py external via script open(w)', 'k0.py via script open(w)']);
  // A heredoc a shell reads: its body lines are scanned as commands (as for the shell forms), each at its own offset.
  assert.deepEqual((await edits(`bash <<'EOF'\npython3 -c "open('c0.py','w')"\ncd /w/x\npython3 -c "open('c.py','w')"\n`
    + `cd /w/y\nEOF`)).sort(), ['/w/x/c.py external via script open(w)', 'c0.py via script open(w)']);
});

test('a script after a cd into a folder of the cwd is spelled under it', async () => {
  assert.deepEqual(await edits(`cd "/w/main repo/backend" && python3 -c "open('app/x.py','w')"`),
    ['backend/app/x.py via script open(w)']);
  assert.deepEqual(await edits(`cd "/w/main repo" && python3 -c "open('./c.py','w')"`), ['c.py via script open(w)']);
});

test('no cd, a later cd, an unresolved or relative cd, or an absolute path: as before', async () => {
  assert.deepEqual(await edits(`python3 -c "open('d.py','w')"`), ['d.py via script open(w)']);
  assert.deepEqual(await edits(`python3 -c "open('e.py','w')" && cd /w/other`), ['e.py via script open(w)']);
  assert.deepEqual(await edits(`cd "$X" && python3 -c "open('g.py','w')"`), ['g.py via script open(w)']);
  assert.deepEqual(await edits(`cd sub && python3 -c "open('h.py','w')"`), ['h.py via script open(w)']);
  assert.deepEqual(await edits(`cd /w/other && python3 -c "open('/w/main repo/i.py','w')"`), ['i.py via script open(w)']);
});

test('each script of one command is placed by the cd in effect where it stands', async () => {
  assert.deepEqual((await edits(`python3 -c "open('a.py','w')" && cd /w/other && python3 -c "open('b.py','w')"`)).sort(),
    ['/w/other/b.py external via script open(w)', 'a.py via script open(w)']);
  assert.deepEqual((await edits(`cd /w/one && python3 -c "open('a.py','w')"\ncd /w/two\npython3 - <<'PY'\nopen('b.py','w')\nPY`))
    .sort(), ['/w/one/a.py external via script open(w)', '/w/two/b.py external via script open(w)']);
  // `cd -` goes back to the session's cwd, as for the shell forms.
  assert.deepEqual(await edits(`cd /w/other && cd - && python3 -c "open('m.py','w')"`), ['m.py via script open(w)']);
});

test('a shell form and a script after the same cd name one file', async () => {
  assert.deepEqual(await edits(`cd /w/other && cat > j.js <<'EOF'\nx\nEOF\npython3 -c "open('j.js','w')"`),
    ['/w/other/j.js external via heredoc']);
});

// Fix round (the limits the records state): scripts follow a `cd` exactly as the shell forms do, with the same limits.
test('a relative or ~ cd is not followed: the write stays where the last followed cd put it, as a shell form\'s', async () => {
  assert.deepEqual(await edits(`cd /w/other && cd sub && python3 -c "open('x.js','w')"`),
    ['/w/other/x.js external via script open(w)']);
  assert.deepEqual(await edits(`cd /w/other && cd sub && echo x > s.js`), ['/w/other/s.js external via redirect']);
  assert.deepEqual(await edits(`cd /w/other && cd ~/proj && python3 -c "open('y.js','w')"`),
    ['/w/other/y.js external via script open(w)']);
});

test('a cd to a folder the command does not give, pushd, a subshell or another shell: the cwd, as before', async () => {
  for (const [command, path] of [[`cd /w/other && cd "$WORKTREE" && python3 -c "open('z1.js','w')"`, 'z1.js'],
    [`cd "$(git rev-parse --show-toplevel)" && python3 -c "open('z2.js','w')"`, 'z2.js'],
    [`pushd /w/other && python3 -c "open('z3.js','w')"`, 'z3.js'],
    [`(cd /w/other && python3 -c "open('z4.js','w')")`, 'z4.js'],
    [`bash -c "cd /w/other && python3 -c \\"open('z5.js','w')\\""`, 'z5.js']])
    assert.deepEqual(await edits(command), [`${path} via script open(w)`], command);
});

// Beta.10's release check: after a cd that Sonah followed, the forms it does not follow leave the write in that cd's
// folder, not in the cwd (the CHANGELOG's words).
test('after a followed cd, pushd, a subshell, another shell or a script\'s own chdir: the write stays in that folder',
  async () => {
    for (const [command, path] of [[`cd /w/other && pushd /w/x && python3 -c "open('p.js','w')"`, 'p.js'],
      [`cd /w/other && (cd /w/x && python3 -c "open('q.js','w')")`, 'q.js'],
      [`cd /w/other && bash -c "cd /w/x && python3 -c \\"open('t.js','w')\\""`, 't.js'],
      [`cd /w/other && python3 -c "import os; os.chdir('/w/x'); open('r.js','w')"`, 'r.js']])
      assert.deepEqual(await edits(command), [`/w/other/${path} external via script open(w)`], command);
  });

test('a cd in a heredoc body reaches the commands after it, as for the shell forms (kept: 0 such writes measured)', async () => {
  assert.deepEqual(await edits(`cat > /tmp/run.sh <<'EOF'\ncd /w/x\nEOF\npython3 -c "open('b.py','w')"`),
    ['/tmp/run.sh external via heredoc', '/w/x/b.py external via script open(w)']);
  assert.deepEqual(await edits(`cat > /tmp/run.sh <<'EOF'\ncd /w/x\nEOF\necho x > b.js`),
    ['/tmp/run.sh external via heredoc', '/w/x/b.js external via redirect']);
  assert.deepEqual(await edits(`python3 - <<'PY' && cd /w/y\nopen('a.py','w')\nPY`), ['/w/y/a.py external via script open(w)']);
});
