// D207 (a false NONE, independently checked on a real session): two write shapes the recorder missed, read as structure
// beside the existing forms and placed the same way (the `cd` in effect, `shellSpelling`). A script's `writeFile` whose
// path is in a one-hop variable, as `open()` already read it; and a lexed `mv` or `cp` of one source to one target, in a
// command's place. Nothing here is a word list: the program's grammar and the lexer's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { sliceLineage } from '../index.js';
import { scratchDir } from './scratch-dir.js';

const CWD = '/w/main repo';
async function edits(command) {
  const d = await scratchDir('d207-shapes-');
  const f = join(d, 's.jsonl');
  await writeFile(f, [
    JSON.stringify({ type: 'user', cwd: CWD, sessionId: 's', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }),
    JSON.stringify({ type: 'assistant', cwd: CWD, message: { role: 'assistant', content: [{ type: 'tool_use', id: '1',
      name: 'Bash', input: { command } }] } }),
  ].join('\n'), 'utf8');
  return (await sliceLineage([f])).ledger.filter((e) => e.kind === 'edit')
    .map((e) => `${e.path}${e.external ? ' external' : ''} via ${e.via}`);
}

test('D207: a script\'s writeFile of a path held in a one-hop variable is a write, as open() of one is', async () => {
  // The real shape: a node heredoc that names its path once and writes it.
  assert.deepEqual(await edits(`node --input-type=module <<'NODE'\nimport {writeFile} from 'node:fs/promises';\n`
    + `const path='docs/RELEASE.md';\nawait writeFile(path,text,{flag:'wx'});\nNODE`), ['docs/RELEASE.md via script writeFile']);
  assert.deepEqual(await edits(`node -e "const out = 'o.json'; require('fs').writeFileSync(out , '{}')"`),
    ['o.json via script writeFile']);
  // Placed by the cd in effect where the script stands, as every scripted write is.
  assert.deepEqual(await edits(`cd /w/other && node -e "const p='lib/b.js'; fs.writeFileSync(p,'x')"`),
    ['/w/other/lib/b.js external via script writeFile']);
  // No string held in the variable, a call on it, or no source extension: nothing.
  assert.deepEqual(await edits(`node -e "const p = require('path'); fs.writeFileSync(p.join('a', 'b.md'), 'x')"`), []);
  assert.deepEqual(await edits(`node -e "fs.writeFileSync(target, 'x')"`), []);
  assert.deepEqual(await edits(`node -e "const t='/tmp/out'; fs.writeFileSync(t, 'x')"`), []);
  // The literal form is as before.
  assert.deepEqual(await edits(`node -e "require('fs').writeFileSync('lib/c.js','x')"`), ['lib/c.js via script writeFile']);
});

test('D207: a mv or cp of one source to one target writes the target', async () => {
  // The real shape: a test moved to a new folder.
  assert.deepEqual(await edits('mv packages/release/test/audit.test.js packages/distribution/test/audit.test.js'),
    ['packages/distribution/test/audit.test.js via mv']);
  assert.deepEqual(await edits('mkdir -p docs && cp -f a.md "docs/my notes.md"'), ['docs/my notes.md via cp']);
  assert.deepEqual(await edits('/bin/mv -f -- old.js new.js'), ['new.js via mv']);
  assert.deepEqual(await edits('mv -- -x.md y.md'), ['y.md via mv']);
  assert.deepEqual(await edits('mv a.js b.js 2>/dev/null'), ['b.js via mv']);
  assert.deepEqual((await edits('cp a.js b.js | tee log.txt')).sort(), ['b.js via cp', 'log.txt via tee']);
  // Placed by the cd in effect, as every shell write is.
  assert.deepEqual(await edits('cd /w/other && mv a.js b.js'), ['/w/other/b.js external via mv']);
  assert.deepEqual(await edits('cd sub && cp ../a.py b.py'), ['sub/b.py via cp']);
});

test('D207: a mv or cp whose target is not read is no write', async () => {
  for (const command of [
    'mv -t dir a.md b.md', // the target folder is an option's word
    'cp --target-directory=dir a.md', 'mv -S .bak a.md b.md', // a word option: which word is the target is not read
    'mv a.md b.md docs/', // several sources move into a folder
    'mv a.md docs/', // a folder, which no source extension names
    'echo mv a.js b.js', // not in a command's place
    "'mv' a.js b.js", // quoted: not read as the program
    'xargs mv a.js b.js', // the head is xargs
    'git mv a.js b.js', // the head is git (TROUBLESHOOTING's row of the files outside the evaluated session names it)
    'mv a.js', // one operand
    'mv a.js b.bin', // no source extension
  ]) assert.deepEqual(await edits(command), [], command);
});

test('D207\'s second review: a name holds the path assigned to it nearest before the call, never its last one anywhere',
  async () => {
    // Assigned again after the call: the call wrote the first path, and the second is only read.
    assert.deepEqual(await edits(`node -e "let p='a.md'; require('fs').writeFileSync(p,'x'); p='b.md'; `
      + `console.log(require('fs').readFileSync(p,'utf8'))"`), ['a.md via script writeFile']);
    assert.deepEqual(await edits(`python3 -c "p = 'a.md'\nopen(p, 'w').write('x')\np = 'b.md'\nprint(open(p).read())"`),
      ['a.md via script open(w)']);
    // Two scripts in one command, each with its own name: each call reads the path before it.
    assert.deepEqual(await edits(`node -e "const f='a.json'; require('fs').writeFileSync(f,'{}')" && `
      + `node -e "const f='b.json'; console.log(require('fs').readFileSync(f,'utf8'))"`), ['a.json via script writeFile']);
    // A name written twice, each after its own path: both (the last one alone before).
    assert.deepEqual((await edits(`python3 -c "p = 'a.md'\nopen(p, 'w')\np = 'b.md'\nopen(p, 'w')"`)).sort(),
      ['a.md via script open(w)', 'b.md via script open(w)']);
    // A function defined before its callers assign the name: each path the command gives it.
    assert.deepEqual((await edits(`python3 - <<'PY'\ndef sub(p, a, b):\n    s = open(p).read(); open(p, 'w').write(s.replace(a, b))\n`
      + `p = 'docs/a.md'\nsub(p, 'x', 'y')\np = 'docs/b.md'\nsub(p, 'x', 'y')\nPY`)).sort(),
    ['docs/a.md via script open(w)', 'docs/b.md via script open(w)']);
    // A property of the same name, a comparison and a compound assignment give the name no path.
    assert.deepEqual(await edits(`python3 -c "p = 'a.md'\nself.p = 'c.md'\nif p == 'b.md': pass\nopen(p, 'w', encoding='utf-8')"`),
      ['a.md via script open(w)']);
  });
