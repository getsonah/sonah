// M33 (lane g2): the slicer's text path tokenizers must not stop a path at a space the shell
// quoted or escaped. A `cd` into a quoted directory, a quoted assignment it reads, a quoted
// redirect or tee target, and (until D69 (c), which deleted the guess) an ask naming a work root whose leading segments hold a space are
// each read whole. Synthetic records only; nothing is executed or resolved against the host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';

const human = (text = 'go') => ({ kind: 'user', raw: { type: 'user', message: { role: 'user', content: text } } });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const asst = (...uses) => ({ kind: 'assistant', raw: { type: 'assistant', message: { role: 'assistant', content: uses } } });
const bash = (command, cwd = '/repo', ask = 'go') => buildEvents([human(ask), asst(tool('b1', 'Bash', { command }))], { cwd })
  .events.filter((e) => typeof e.via === 'string');

test('a cd into a quoted or escaped directory holding a space moves the write there', () => {
  for (const command of ['cd "/tmp/my scratch" && echo x > a.js', "cd '/tmp/my scratch'; touch b; tee a.js < b",
    'cd /tmp/my\\ scratch\nsed -i \'s/a/b/\' a.js']) {
    const writes = bash(command);
    assert.equal(writes.length, 1, command);
    // D69 review (F7): spelled where it landed, as recorded outside the cwd — never the project's `a.js`.
    assert.equal(writes[0].path, '/tmp/my scratch/a.js', command);
    assert.equal(writes[0].external, true, `${command}: a scratch directory outside the cwd`);
  }
});

test('a cd back into a cwd holding a space keeps the write inside the project', () => {
  const cwd = '/srv/x/Acme Labs/repo';
  for (const command of [`cd /tmp/scratch; cd "${cwd}"; sed -i 's/a/b/' src/a.js`,
    `cd /tmp/scratch && cd /srv/x/Acme\\ Labs/repo && echo x > src/a.js`]) {
    const writes = bash(command, cwd);
    assert.equal(writes.length, 1, command);
    assert.equal(writes[0].path, 'src/a.js', command);
    assert.equal(writes[0].external, undefined, command);
  }
});

test('a quoted assignment holding a space resolves a later cd "$D"', () => {
  for (const command of ['D="/tmp/my scratch"; cd "$D"; echo x > a.js',
    "export D='/tmp/my scratch'\ncd \"${D}/sub dir\"\necho x > a.js"]) {
    const writes = bash(command);
    assert.equal(writes.length, 1, command);
    assert.equal(writes[0].external, true, command);
  }
  // An unresolved variable still assumes the session cwd.
  const unresolved = bash('cd "$ELSEWHERE/my dir"; echo x > a.js');
  assert.equal(unresolved.length, 1);
  assert.equal(unresolved[0].external, undefined);
});

test('a quoted redirect or tee target holding a space is a write', () => {
  const inside = bash('echo x > "notes dir/a.md"');
  assert.deepEqual(inside.map((w) => [w.path, w.via, w.external]), [['notes dir/a.md', 'redirect', undefined]]);
  assert.equal(inside[0].shellWriteStatusEligible, true, 'one direct echo redirect, as without the space');
  const appended = bash("printf '%s\\n' x >> 'notes dir/a.md'");
  assert.deepEqual(appended.map((w) => [w.path, w.via]), [['notes dir/a.md', 'redirect']]);
  const teed = bash('npm test 2>&1 | tee "out dir/log.txt"');
  assert.deepEqual(teed.map((w) => [w.path, w.via]), [['out dir/log.txt', 'tee']]);
  assert.deepEqual(bash('curl -sSLo "dl dir/LICENSE.txt" https://example.invalid/l').map((w) => [w.path, w.via]),
    [['dl dir/LICENSE.txt', 'curl -o']]);
  assert.deepEqual(bash("wget -q -O 'dl dir/data.json' https://example.invalid/d").map((w) => [w.path, w.via]),
    [['dl dir/data.json', 'wget -O']]);
  const outside = bash('echo x > "/tmp/my scratch/a.js"');
  assert.deepEqual(outside.map((w) => [w.path, w.external]), [['/tmp/my scratch/a.js', true]]);
  const cwd = '/srv/x/Acme Labs/repo';
  const absolute = bash(`echo x > "${cwd}/src/a.js"`, cwd);
  assert.deepEqual(absolute.map((w) => [w.path, w.external]), [['src/a.js', undefined]]);
  // A read of a spaced path, a quoted non-source name and an fd duplication are no writes.
  assert.deepEqual(bash(`cat "${cwd}/src/a.js"`, cwd), []);
  assert.deepEqual(bash('echo x > "my notes"'), []);
  assert.deepEqual(bash('echo x 2>&1'), []);
});

// D69 (c) (owner decision 2026-10-08): no folder is guessed from paths the human's message names, nor elected by a
// majority of writes. The work under review is the recorder's own working directory: a spaced one too.
test('D69 (c): an ask naming a folder elects nothing; the recorder\'s cwd, spaced or not, is the work under review', () => {
  const writes = (ask, cwd) => buildEvents([human(ask),
    asst(tool('t1', 'Write', { file_path: '/tmp/Acme Labs/fix-1/pkg/a.go', content: 'x' })),
    asst(tool('t2', 'Write', { file_path: '/tmp/scr/repro/a.txt', content: 'x' })),
    asst(tool('t3', 'Write', { file_path: '/tmp/scr/repro/b.txt', content: 'x' })),
  ], { cwd }).events.filter((e) => e.kind === 'edit' || e.kind === 'create').map((e) => [e.path, e.external === true]);
  const named = 'Work entirely inside /tmp/Acme Labs/fix-1 and do not touch other files.';
  assert.deepEqual(writes(named, '/srv/elsewhere'), [['/tmp/Acme Labs/fix-1/pkg/a.go', true], ['/tmp/scr/repro/a.txt', true],
    ['/tmp/scr/repro/b.txt', true]], 'outside the cwd: external, whatever the ask names, however many writes');
  assert.deepEqual(writes(named, '/tmp/Acme Labs/fix-1'), [['pkg/a.go', false], ['/tmp/scr/repro/a.txt', true],
    ['/tmp/scr/repro/b.txt', true]], 'the recorder\'s cwd, spaced');
  assert.deepEqual(writes('Fix it.', '/tmp/Acme Labs/fix-1'), writes(named, '/tmp/Acme Labs/fix-1'), 'the ask changes nothing');
});

// Lane g3: a quoted redirect target holding a space is one write. The line-form regex stops at the
// space and would read the quoted word's first half (`"src/a.js`) as a second, phantom write.
test('a quoted redirect, tee or download target holding a space yields exactly one write', () => {
  for (const [command, path, via] of [
    ['echo x > "src/a.js b/c.md"', 'src/a.js b/c.md', 'redirect'],
    ["echo x >> 'src/a.js b/c.md'", 'src/a.js b/c.md', 'redirect'],
    ['npm test | tee "logs/a.txt b/run.txt"', 'logs/a.txt b/run.txt', 'tee'],
    ['curl -sSLo "dl/a.json b/c.json" https://example.invalid/x', 'dl/a.json b/c.json', 'curl -o'],
  ]) {
    assert.deepEqual(bash(command).map((w) => [w.path, w.via]), [[path, via]], command);
  }
  // Unchanged: an unquoted target, and a quoted tee target without a space.
  assert.deepEqual(bash('echo x > src/a.js').map((w) => [w.path, w.via]), [['src/a.js', 'redirect']]);
  assert.deepEqual(bash('npm test | tee "a.md"').map((w) => [w.path, w.via]), [['a.md', 'tee']]);
});
