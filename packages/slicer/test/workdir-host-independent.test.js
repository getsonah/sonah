// Lane g3: a Bash call's `workdir` is compared with the recorded session cwd lexically. The
// slicer is deterministic (a project rule): a relative session cwd must never be resolved against the
// host's process.cwd(), so the same records slice to the same bytes from any working directory.
// Synthetic records only; process.cwd is stubbed, nothing is executed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEvents } from '../src/events.js';

const records = (input) => [
  { kind: 'assistant', adapter: 'claude', raw: { type: 'assistant', message: { role: 'assistant',
    content: [{ type: 'tool_use', id: 'c1', name: 'Bash', input }] } } },
  { kind: 'user', adapter: 'claude', raw: { type: 'user', message: { role: 'user',
    content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] } } },
];
const shape = (events) => events.map((e) => `${e.kind}${e.genericTool ? ':generic' : ''}`).join(',');

function underHostCwd(host, fn) {
  const saved = process.cwd;
  process.cwd = () => host;
  try { return fn(); } finally { process.cwd = saved; }
}

test('a relative session cwd slices to the same bytes whatever the host working directory is', () => {
  const inputs = [
    { command: 'npm test', workdir: '/srv/x/host-a/repo' },   // equals <host-a>/repo only on host-a
    { command: 'npm test', workdir: '/srv/x/host-b/repo' },
    { command: 'npm test', workdir: '.' },
    { command: 'npm test', workdir: './' },
    { command: 'npm test', workdir: '../repo' },
    { command: 'npm test', workdir: 'sub' },
  ];
  for (const cwd of ['repo', 'repo/', 'a/../repo', '.']) {
    for (const input of inputs) {
      const runs = ['/srv/x/host-a', '/srv/x/host-b'].map((host) =>
        underHostCwd(host, () => JSON.stringify(buildEvents(records(input), { cwd }).events)));
      assert.equal(runs[0], runs[1], `cwd ${cwd}, workdir ${input.workdir}`);
    }
  }
});

test('the lexical comparison: the same directory is Bash, another one or an unresolvable one is generic', () => {
  const kind = (cwd, workdir) => underHostCwd('/srv/x/host-a',
    () => shape(buildEvents(records({ command: 'npm test', workdir }), { cwd }).events));
  // Same directory, lexically.
  for (const [cwd, workdir] of [['/srv/x/repo', '/srv/x/repo'], ['/srv/x/repo', '/srv/x/repo/'],
    ['/srv/x/repo/', '/srv/x/repo'], ['/srv/x/repo', '.'], ['/srv/x/repo', ''], ['/srv/x/repo', '../repo'],
    ['/srv/x/repo', '/srv/x/other/../repo'], ['repo', '.'], ['repo', './'], ['repo/', '../repo']]) {
    assert.equal(kind(cwd, workdir), 'bash', `${cwd} ${workdir}`);
  }
  // Another directory, or a relative cwd against an absolute workdir (no host to resolve it by).
  for (const [cwd, workdir] of [['/srv/x/repo', '/srv/x/other'], ['/srv/x/repo', 'sub'],
    ['repo', '/srv/x/host-a/repo'], ['repo', 'sub'], ['repo', '../other']]) {
    assert.equal(kind(cwd, workdir), 'other:generic', `${cwd} ${workdir}`);
  }
});
