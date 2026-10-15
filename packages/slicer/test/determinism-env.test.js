// F9: the slicer's path normaliser read $HOME.
//
// A project rule: `slicer`, `redact` and `render` make no network, model, clock or random
// reads — same input, same bytes out, forever. An environment read belongs on that list: it is
// the machine leaking into a hashed structure, which is what H38 and M89 already cost once.
//
// `relative()`'s branch was dead — the leading `/` is stripped before `$HOME` (which starts with
// one) is compared — so the two-HOME slice below passed before the branch was deleted as well as
// after. It is the regression guard, not the falsifier. The falsifier is the source assertion:
// it fails on the code as it stood.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sliceLineage } from '../index.js';
import { relative } from '../src/events.js';
import { redact, sliceHash } from '../../redact/index.js';
import { scratchDir } from './scratch-dir.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

test('relative() reads no environment, and neither does the module it lives in', async () => {
  const events = await readFile(join(SRC, 'events.js'), 'utf8');
  assert.ok(!events.includes('process.env'), 'events.js must not read the environment');
  // A guard that passes on anything proves nothing: the same predicate, pointed at the one file
  // in this package that still reads $HOME, must find it. cursor.js resolves an external tool's
  // per-repo session directory and takes `home` as an injectable option; it is out of this
  // change's scope and is reported as remaining.
  const cursor = await readFile(join(SRC, 'cursor.js'), 'utf8');
  assert.ok(cursor.includes('process.env'), 'cursor.js is the remaining reader — the grep is real');
});

test('a path outside cwd normalises the same way whatever $HOME says', async () => {
  const saved = process.env.HOME;
  try {
    for (const home of ['/Users/someone', '/var/empty/other']) {
      process.env.HOME = home;
      // D69 review (F7): outside the cwd a path is spelled as recorded, its leading `/` kept.
      assert.equal(relative('/Users/someone/elsewhere/config.js', '/repo'),
        '/Users/someone/elsewhere/config.js', `$HOME=${home} must not rewrite a path`);
      // By whole path segments: a sibling folder that shares the cwd's name as a prefix is outside it.
      assert.equal(relative('/repo-old/src/a.js', '/repo'), '/repo-old/src/a.js');
      assert.equal(relative('/repo/src/a.js', '/repo'), 'src/a.js');
      assert.equal(relative('/repo', '/repo'), '');
    }
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
  }
});

test('the same recording slices to the same bytes and the same slice_hash under two HOMEs', async () => {
  const d = await scratchDir('slicer-env-');
  const f = join(d, 's.jsonl');
  // One absolute path outside cwd, and one under the first $HOME below — the shapes the deleted
  // branch would have rewritten.
  await writeFile(f, [
    JSON.stringify({ type: 'user', sessionId: 's', cwd: '/repo', message: { role: 'user', content: 'read the config' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/Users/someone/elsewhere/config.js' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'port = 8080', is_error: false }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cat /var/empty/other/notes.txt' } }] } }),
    JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'nothing', is_error: false }] } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Read it.' }] } }),
  ].join('\n'), 'utf8');

  const saved = process.env.HOME;
  const runs = [];
  try {
    for (const home of ['/Users/someone', '/var/empty/other']) {
      process.env.HOME = home;
      const ledger = await sliceLineage([f], { cwd: '/repo' });
      runs.push({ events: JSON.stringify(ledger.ledger), hash: sliceHash(redact(ledger).ledger) });
    }
  } finally {
    if (saved === undefined) delete process.env.HOME; else process.env.HOME = saved;
  }
  assert.ok(runs[0].events.includes('Users/someone/elsewhere/config.js'),
    'the fixture must actually carry a path $HOME could have rewritten');
  assert.equal(runs[0].events, runs[1].events, 'the ledger bytes do not depend on $HOME');
  assert.equal(runs[0].hash, runs[1].hash, 'and neither does slice_hash');
});
