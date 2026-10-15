import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openLocalPage, presentLocalPage, LOCAL_PAGE_OPEN_TIMEOUT_MS, LOCAL_PAGE_OPEN_FIX } from '../src/local-page.js';

function output() {
  let stdout = '', stderr = '';
  return { stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } },
    read: () => ({ stdout, stderr }) };
}

test('each native opener receives one encoded file URL without a shell or inherited output', async () => {
  const file = resolve("synthetic folder/owner's 100% # ? & ; $(literal).html");
  for (const [platform, command, prefix] of [['darwin', 'open', []], ['linux', 'xdg-open', []],
    ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler']]]) {
    let invocation;
    await openLocalPage(file, { platform, exec: async (...args) => {
      invocation = args;
      return { stdout: 'SYNTHETIC_PRIVATE_OPENER_OUTPUT', stderr: 'SYNTHETIC_PRIVATE_OPENER_ERROR' };
    } });
    assert.deepEqual(invocation, [command, [...prefix, pathToFileURL(file).href], {
      shell: false, windowsHide: true, timeout: LOCAL_PAGE_OPEN_TIMEOUT_MS }]);
    assert.equal(new URL(invocation[1].at(-1)).protocol, 'file:');
    assert.equal(invocation[1].length, prefix.length + 1);
  }
});

test('presentation prints the absolute path before opening; no-open suppresses the opener', async () => {
  const file = 'synthetic page.html', out = output();
  const opened = [];
  await presentLocalPage(file, { ...out, openPage: async path => {
    assert.equal(out.read().stdout, `Local page: ${resolve(file)}\n`);
    opened.push(path);
  } });
  assert.deepEqual(opened, [resolve(file)]);
  assert.equal(out.read().stderr, '');
  const headless = output();
  await presentLocalPage(file, { ...headless, noOpen: true, openPage: () => assert.fail('headless must not open') });
  assert.equal(headless.read().stdout, `Local page: ${resolve(file)}\n`);
});

test('opener failure or timeout gives only fixed instructions and preserves successful presentation', async () => {
  for (const code of ['ENOENT', 'ETIMEDOUT']) {
    const out = output();
    await presentLocalPage('synthetic.html', { ...out, openPage: async () => {
      throw Object.assign(new Error('SYNTHETIC_PRIVATE_OPENER_ERROR'), { code });
    } });
    assert.equal(out.read().stderr, `${LOCAL_PAGE_OPEN_FIX}\n`);
    assert.doesNotMatch(out.read().stderr, /SYNTHETIC_PRIVATE|ENOENT|ETIMEDOUT/);
    assert.equal(out.read().stdout, `Local page: ${resolve('synthetic.html')}\n`);
  }
});
