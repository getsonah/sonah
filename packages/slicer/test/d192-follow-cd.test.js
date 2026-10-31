// D192 (D186's way A; the owner, D188: "Fix A: follow the cd (Recommended)"): a `cd` to a relative folder is followed
// from the folder the command stands in when Sonah knows it, and a `cd` to `~` or `~/…` from the recording's home, for
// the shell's own writes and a script's alike (shellWrites `dir`, `cdFolder`). Every other change of folder stays as it
// was, and leaves the folder unknown, so no relative `cd` after it is followed from a folder that may be wrong.
// Synthetic records only; nothing is executed or resolved against the host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';

const CWD = '/w/main repo';
const HOME = '/srv/me';
const human = (text = 'go') => ({ kind: 'user', raw: { type: 'user', message: { role: 'user', content: text } } });
const asst = (command) => ({ kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command } }] } } });
/** The writes one command makes, each as `path[ external] via how`, in the order the slicer emits them. */
const writes = (command, { cwd = CWD, home = null } = {}) => buildEvents([human(), asst(command)], { cwd, home }).events
  .filter((e) => typeof e.via === 'string').map((e) => `${e.path}${e.external ? ' external' : ''} via ${e.via}`);
const py = (body) => `python3 - <<'PY'\n${body}\nPY`;

test('a relative cd from the cwd places a shell form\'s and a script\'s write in that folder', () => {
  assert.deepEqual(writes('cd sub && echo x > a.js'), ['sub/a.js via redirect']);
  assert.deepEqual(writes(`cd sub/app && ${py("open('b.py','w')")}`), ['sub/app/b.py via script open(w)']);
  assert.deepEqual(writes('cd "my dir" && sed -i \'s/a/b/\' c.js'), ['my dir/c.js via sed -i']);
  assert.deepEqual(writes('cd my\\ dir && echo x > c.js'), ['my dir/c.js via redirect']);
  assert.deepEqual(writes("cd ./sub\ncat > d.json <<'EOF'\n{}\nEOF"), ['sub/d.json via heredoc']);
  // Above the cwd: the folder shell grammar gives, outside the cwd.
  assert.deepEqual(writes('cd .. && echo x > up.js'), ['/w/up.js external via redirect']);
  assert.deepEqual(writes(`cd ../other/lib && ${py("open('e.py','w')")}`), ['/w/other/lib/e.py external via script open(w)']);
  // Back into the cwd.
  assert.deepEqual(writes('cd sub && cd .. && echo x > f.js'), ['f.js via redirect']);
});

test('a relative cd after an absolute or a followed one is followed from that folder', () => {
  assert.deepEqual(writes('cd /w/other && cd sub && echo x > s.js'), ['/w/other/sub/s.js external via redirect']);
  assert.deepEqual(writes(`cd /w/other && cd sub && ${py("open('x.js','w')")}`),
    ['/w/other/sub/x.js external via script open(w)']);
  assert.deepEqual(writes('cd /w/other/a && cd ../b && cd c && echo x > g.js'), ['/w/other/b/c/g.js external via redirect']);
  assert.deepEqual(writes('D=/w/other; cd "$D"; cd lib; echo x > h.js'), ['/w/other/lib/h.js external via redirect']);
  // Each write by the folder where it stands.
  assert.deepEqual(writes('echo x > i.js && cd sub && echo x > j.js'), ['i.js via redirect', 'sub/j.js via redirect']);
});

test('~ and ~/x are followed from the recording\'s home, and not without one', () => {
  assert.deepEqual(writes('cd ~ && echo x > h.js', { home: HOME }), ['/srv/me/h.js external via redirect']);
  assert.deepEqual(writes(`cd ~/proj && ${py("open('p.py','w')")}`, { home: HOME }),
    ['/srv/me/proj/p.py external via script open(w)']);
  assert.deepEqual(writes('cd ~/proj && cd src && echo x > q.js', { home: HOME }),
    ['/srv/me/proj/src/q.js external via redirect']);
  // A cwd under the home: the write is under the cwd, spelled relative to it.
  assert.deepEqual(writes('cd ~/proj/src && echo x > r.js', { cwd: '/srv/me/proj', home: HOME }), ['src/r.js via redirect']);
  // A home harness folder is outside the work (D69 b), as its absolute spelling is.
  assert.deepEqual(writes('cd ~/.claude && echo x > notes.md', { cwd: '/srv/me', home: HOME }),
    ['.claude/notes.md external via redirect']);
  // No home read from where the recording lies: as before.
  assert.deepEqual(writes('cd ~/proj && echo x > n.js'), ['n.js via redirect']);
  assert.deepEqual(writes('cd /w/other && cd ~/proj && echo x > y.js'), ['/w/other/y.js external via redirect']);
});

test('not followed, as before: ~user, a quoted ~, an option, an operand the shell expands, cd -, no cwd', () => {
  for (const command of ['cd ~bob && echo x > a.js', 'cd "~/proj" && echo x > a.js', 'cd "~/my dir" && echo x > a.js',
    'cd -P && echo x > a.js', 'cd src* && echo x > a.js', 'cd src? && echo x > a.js', 'cd [ab] && echo x > a.js',
    'cd $(pwd) && echo x > a.js', 'cd a\\b && echo x > a.js', 'cd {a,b} && echo x > a.js'])
    assert.deepEqual(writes(command, { home: HOME }), ['a.js via redirect'], command);
  // A home that is not an absolute POSIX folder places no `~`.
  assert.deepEqual(writes('cd ~/proj && echo x > n.js', { home: 'C:/Users/me' }), ['n.js via redirect']);
  // `cd -` goes back to the cwd, as for the shell forms (D174).
  assert.deepEqual(writes('cd sub && cd - && echo x > m.js'), ['m.js via redirect']);
  assert.deepEqual(writes('cd sub && echo x > a.js', { cwd: '' }), ['a.js via redirect']);
  // D192's close check: a `cd` at the head of a pipeline or in a background job runs in a subshell, and is not followed.
  for (const command of ['cd sub | cat && echo x > a.js', 'cd sub & echo x > a.js', 'cd sub &\necho x > a.js'])
    assert.deepEqual(writes(command), ['a.js via redirect'], command);
});

test('after a change of folder Sonah does not follow, a relative cd is not followed either', () => {
  for (const command of ['cd "$X" && cd sub && echo x > v.js', 'cd "$(git rev-parse --show-toplevel)" && cd sub && echo x > v.js',
    'cd ~bob && cd sub && echo x > v.js', 'cd sub && cd - && cd lib && echo x > v.js', 'pushd /w/x && cd sub && echo x > v.js',
    'popd && cd sub && echo x > v.js', 'cd sub 2>/dev/null && cd lib && echo x > v.js',
    'if cd sub; then cd lib; echo x > v.js; fi', '{ cd sub; cd lib; echo x > v.js; }'])
    assert.deepEqual(writes(command, { home: HOME }), ['v.js via redirect'], command);
  // A subshell's own folder is not followed, and its writes stay where they were (D174's limits).
  assert.deepEqual(writes(`(cd sub && ${py("open('z.js','w')")})`), ['z.js via script open(w)']);
  assert.deepEqual(writes(`(cd /w/x && cd sub && ${py("open('z.js','w')")})`), ['z.js via script open(w)']);
  // An absolute cd makes the folder known again.
  assert.deepEqual(writes('pushd /w/x && cd /w/y && cd sub && echo x > s.js'), ['/w/y/sub/s.js external via redirect']);
  // A quoted `cd` word is an argument, not a change of folder.
  assert.deepEqual(writes('git commit -m "cd" && cd sub && echo x > q.js'), ['sub/q.js via redirect']);
  // Another shell's cd, a command substitution's and a script's own change of folder leave this shell where it was.
  assert.deepEqual(writes('bash -c "cd /w/x" && cd sub && echo x > b.js'), ['sub/b.js via redirect']);
  assert.deepEqual(writes('echo "$(cd /w/x && pwd)" && cd sub && echo x > c.js'), ['sub/c.js via redirect']);
});

test('a cd on a heredoc body line is not followed, and a command that does not lex follows no relative cd', () => {
  // The body is input to a command, never a change of this shell's folder.
  assert.deepEqual(writes("cat > notes.md <<'EOF'\ncd docs\nEOF\necho x > a.js"), ['notes.md via heredoc', 'a.js via redirect']);
  assert.deepEqual(writes("cat > run.sh <<'EOF'\ncd ~/proj\nEOF\ncd sub && echo x > b.js", { home: HOME }),
    ['run.sh via heredoc', 'b.js via redirect']);
  // An absolute cd on a body line still reaches the commands after it (D174, kept), and leaves the folder unknown.
  assert.deepEqual(writes("cat > run.sh <<'EOF'\ncd /w/x\nEOF\ncd sub\necho x > c.js"),
    ['run.sh via heredoc', '/w/x/c.js external via redirect']);
  // An unterminated quote: the line split, with no relative cd followed (an absolute one is, D174).
  assert.deepEqual(writes(`cd sub && python3 -c "open('k.py','w')" '`), ['k.py via script open(w)']);
});

// Known limits, kept and pinned (D192's judgment calls 6 to 8 and its close check): shell grammar that the slicer does not
// read here. A rule for one ships only when it changes real recordings; a fix moves these pins.
test('known limits, pinned: the separator before a cd, block arms, the operand\'s text, a heredoc\'s line, a subshell\'s end, a change of folder not followed, a ~ write target', () => {
  // A `cd` after `||` is followed as if it ran, from the folder the left side gave.
  assert.deepEqual(writes('cd sub || cd lib && echo x > a.js'), ['sub/lib/a.js via redirect']);
  // A `cd` on a line of its own inside `if`, `case` or `{ … }` is a command part: followed as if it ran, so the arms of
  // an `if` or a `case` are followed one after another (the close check).
  assert.deepEqual(writes('if [ -d a ]; then\n  cd a\nfi\necho x > f.js'), ['a/f.js via redirect']);
  assert.deepEqual(writes('if [ -d a ]; then\n  cd a\nelse\n  cd b\nfi\necho x > f.js'), ['a/b/f.js via redirect']);
  assert.deepEqual(writes('case "$1" in\n  y)\n    cd a\n    ;;\n  n)\n    cd b\n    ;;\nesac\necho x > f.js'),
    ['a/b/f.js via redirect']);
  assert.deepEqual(writes('{\ncd sub\necho x > a.js\n}\necho x > b.js'), ['sub/a.js via redirect', 'sub/b.js via redirect']);
  // The operand is read from the part's text: a redirection or a parenthesis glued to it is read as part of the folder.
  assert.deepEqual(writes('cd sub>/dev/null && echo x > a.js'), ['sub>/dev/null/a.js via redirect']);
  // A heredoc's body takes the folder left after its whole operator line, a `cd` after the operator too.
  assert.deepEqual(writes("python3 - <<'PY' && cd sub\nopen('x.py','w')\nPY"), ['sub/x.py via script open(w)']);
  // The end of a subshell on lines of its own restores no folder: its absolute `cd` (D174) reaches the parts after it.
  assert.deepEqual(writes('(\ncd /w/x\n)\ncd sub\necho x > a.js'), ['/w/x/sub/a.js external via redirect']);
  // zsh's `cd +N` is read as a folder named `+N`, and CDPATH is not read.
  assert.deepEqual(writes('cd +1 && echo x > f.js'), ['+1/f.js via redirect']);
  assert.deepEqual(writes('export CDPATH=/opt; cd a && echo x > f.js'), ['a/f.js via redirect']);
  // A change of folder that is not followed leaves `dir` where the last followed `cd` put it.
  assert.deepEqual(writes('cd sub && pushd .. && echo x > a.js'), ['sub/a.js via redirect']);
  assert.deepEqual(writes('cd sub && popd; echo x > a.js'), ['sub/a.js via redirect']);
  assert.deepEqual(writes('cd sub && cd ~bob && echo x > a.js', { home: HOME }), ['sub/a.js via redirect']);
  assert.deepEqual(writes(`cd sub && (cd lib && ${py("open('z.js','w')")})`), ['sub/z.js via script open(w)']);
  // A `cd` to a substitution with no space in it does the same (the close check); one with a space is read as an unset
  // variable and resets the folder to the cwd (D174), as `cd -` does.
  assert.deepEqual(writes('cd sub && cd $(pwd) && echo x > a.js'), ['sub/a.js via redirect']);
  assert.deepEqual(writes('cd sub && cd `pwd` && echo x > a.js'), ['sub/a.js via redirect']);
  assert.deepEqual(writes('cd sub && cd "$(git rev-parse --show-toplevel)" && echo x > a.js'), ['a.js via redirect']);
  // So does a spaced backquote; on a heredoc body line such a `cd` is not read, and the folder stays (the verify pass).
  assert.deepEqual(writes('cd sub && cd `git rev-parse --show-toplevel` && echo x > a.js'), ['a.js via redirect']);
  assert.deepEqual(writes("cd /w/x && bash <<'SH'\ncd \"$(git rev-parse --show-toplevel)\"\necho x > a.js\nSH"),
    ['/w/x/a.js external via redirect']);
  // A `cd` at the end of a pipeline, which zsh runs in the shell itself, is not followed either (a known limit).
  assert.deepEqual(writes('cat x | cd sub && echo x > a.js'), ['a.js via redirect']);
  // A shell write's target that begins with `~` is joined to the folder a `cd` gave like any relative name (after an
  // absolute `cd` since D174), and is spelled as recorded with no `cd` before it.
  assert.deepEqual(writes('cd sub && echo x > ~/a.js', { home: HOME }), ['sub/~/a.js via redirect']);
  assert.deepEqual(writes('cd /w/x && echo x > ~/a.js', { home: HOME }), ['/w/x/~/a.js external via redirect']);
  assert.deepEqual(writes('echo x > ~/a.js', { home: HOME }), ['~/a.js via redirect']);
});
