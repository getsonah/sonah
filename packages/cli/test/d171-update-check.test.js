// D171 (the owner, 2026-10-28): the update notice. At most once a day, a GET of getsonah's dist-tags from npm's public
// registry, 2 seconds at most, silent on any failure; one line on stderr after a review's output, one line in
// `sonah doctor`, and (render d171-footer-newer.test.js) a line in the page's footer. Off with SONAH_NO_UPDATE_CHECK,
// CI, or `sonah config update-check off`. Stdout moves only by doctor's own line. Option A and the day claim (the
// owner, 2026-10-29): only a review's first call to the reviewer and doctor start the check, and of the commands that
// find the cache a day old, one makes it, by a claim beside the cache.
//
// No network: every check here is given a fake fetch and a fake clock, or (through the installed entry) a cache file
// checked less than a day ago, which the entry reads instead of asking. D171 fix round: every entry run also loads
// d171-lookup-fixture.js, whose host lookup never reaches the network and logs what it was asked, and the real request
// (`registryFetch`) is tested against local servers on 127.0.0.1 only. Synthetic sessions only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import dns from 'node:dns';
import { writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkForUpdate, claimUpdateCheck, compareVersions, endOnceWritten, isNewer, latestOf, lookupPending,
  parseVersion, readUpdateCache, registryFetch, updateCheckWhenAsked, UPDATE_CHECK_FILE, UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_TIMEOUT_MS, UPDATE_CHECK_URL, UPDATE_COMMAND, UPDATE_NOTICE_COMMANDS, UPDATE_NOTICE_WORDS,
  updateCachePath, updateClaimPath, updateNoticeApplies, writeUpdateNotice } from '../src/update-check.js';
import { CONFIG_USAGE, parseSettings, parseUpdateCheckSetting, readSettings, readUpdateCheckSetting,
  resolveUpdateCheck, runConfigCommand, settingsPath, UPDATE_CHECK_DEFAULT, UPDATE_CHECK_SETTING_FILE,
  UPDATE_CHECK_SETTING_WORDS, UPDATE_CHECK_SOURCES, updateCheckSettingPath, writeCodePass, writeUpdateCheck }
  from '../src/settings.js';
import { doctor } from '../src/doctor.js';
import { DRY_RUN_WORDS, REVIEW_FIX_WORDS, runSessionReviewCommand } from '../src/session-review-command.js';
import { REPORT_FOOTER_WORDS } from '../../render/report-words.js';
import { codeJudge, codeSession, repoWith, sha256 } from './code-pass-fixture.js';
import { session, toJsonl } from '../../golden/src/build.js';

const exec = promisify(execFile);
const BIN = fileURLToPath(new URL('../bin/sonah.js', import.meta.url));
const UPDATE_CHECK_MODULE = new URL('../src/update-check.js', import.meta.url).href;
/** The preload of every entry run here: a host lookup that never reaches the network (d171-lookup-fixture.js). */
const NO_NETWORK = pathToFileURL(fileURLToPath(new URL('./d171-lookup-fixture.js', import.meta.url))).href;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INSTALLED = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
const DAY = UPDATE_CHECK_INTERVAL_MS;
const T0 = Date.parse('2026-10-28T12:00:00.000Z');

async function scratch(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d171-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const home = join(dir, 'home');
  await mkdir(home);
  return { dir, home, env: { HOME: home, SONAH_HOME: join(home, '.sonah') } };
}
/** A fake registry: each call recorded, answering `text` (a function of the call's index may vary it). */
function registry(answer = '{"latest":"0.3.0-beta.10","beta":"0.3.0-beta.10"}') {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    const value = typeof answer === 'function' ? answer(calls.length - 1) : answer;
    if (value instanceof Error) throw value;
    return value;
  };
  return { calls, fetch };
}
const clock = (start = T0) => { const c = { at: start, now: () => c.at }; return c; };
const streams = () => {
  const chunks = { stdout: '', stderr: '' };
  return { chunks, stdout: { write: (text) => { chunks.stdout += text; } },
    stderr: { write: (text) => { chunks.stderr += text; } } };
};

test('the comparator: semver order, prerelease identifiers field by field, numbers as numbers', () => {
  const ordered = ['0.2.9', '0.3.0-alpha', '0.3.0-alpha.1', '0.3.0-alpha.beta', '0.3.0-beta', '0.3.0-beta.2',
    '0.3.0-beta.9', '0.3.0-beta.10', '0.3.0-beta.11', '0.3.0-rc.1', '0.3.0', '0.3.1', '0.10.0', '1.0.0', '10.0.0'];
  for (let i = 0; i < ordered.length; i++) for (let j = 0; j < ordered.length; j++)
    assert.equal(compareVersions(ordered[i], ordered[j]), Math.sign(i - j), `${ordered[i]} against ${ordered[j]}`);
  assert.equal(compareVersions('1.0.0+build.1', '1.0.0'), 0, 'build metadata is not ordered');
  assert.equal(compareVersions('99999999999999999999.0.0', '99999999999999999998.0.0'), 1, 'past a safe integer');
  for (const bad of ['', '1', '1.0', '01.0.0', '1.0.0-', '1.0.0-01', '1.0.0-a..b', 'v1.0.0', ' 1.0.0', '1.0.0 ',
    '1.0.0-a+', 'latest', `1.0.0-${'a'.repeat(40)}`, null, 3, {}]) {
    assert.equal(parseVersion(bad), null, String(bad));
    assert.equal(compareVersions(bad, '1.0.0'), null, String(bad));
    assert.equal(isNewer(bad, '1.0.0'), false);
    assert.equal(isNewer('1.0.0', bad), false);
  }
  assert.equal(isNewer('0.3.0-beta.10', '0.3.0-beta.9'), true);
  assert.equal(isNewer('0.3.0-beta.9', '0.3.0-beta.9'), false, 'the same version is not newer');
  assert.equal(isNewer('0.3.0-beta.9', '0.3.0-beta.10'), false, 'an older latest never gives the line');
  assert.equal(isNewer('0.3.0', '0.3.0-beta.10'), true);
});

test('the registry\'s answer: only strict JSON with a version as latest', () => {
  assert.equal(latestOf('{"latest":"0.3.0-beta.10","beta":"0.3.0-beta.11"}'), '0.3.0-beta.10');
  for (const bad of ['', 'not json', 'null', '[]', '"0.3.0"', '{}', '{"beta":"1.0.0"}', '{"latest":1}',
    '{"latest":"next"}', '{"latest":"1.0.0","latest":"2.0.0"}', '<html></html>'])
    assert.equal(latestOf(bad), null, bad);
});

test('the check: one request a day by the clock, the cache\'s exact bytes, owner-only', async (t) => {
  const box = await scratch(t);
  const reg = registry(), c = clock(), seen = [];
  const check = () => checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: c.now, fetch: reg.fetch,
    checked: (what) => seen.push(what) });
  assert.deepEqual(await check(), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
  assert.deepEqual(reg.calls.map((call) => call.url), [UPDATE_CHECK_URL]);
  assert.equal(UPDATE_CHECK_URL, 'https://registry.npmjs.org/-/package/getsonah/dist-tags');
  assert.ok(reg.calls[0].options.signal instanceof AbortSignal);
  const path = updateCachePath({ env: box.env });
  assert.equal(path, join(box.env.SONAH_HOME, UPDATE_CHECK_FILE));
  assert.equal(await readFile(path, 'utf8'), '{"checkedAt":"2026-10-28T12:00:00.000Z","latest":"0.3.0-beta.10"}\n');
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(box.env.SONAH_HOME)).mode & 0o777, 0o700);
  assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], 'no temporary file is left beside it');
  // Within the day: the cache's answer, no request.
  c.at = T0 + DAY - 1;
  assert.deepEqual(await check(), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
  assert.equal(reg.calls.length, 1);
  // A day later: one request again, and the cache rewritten.
  c.at = T0 + DAY;
  await check();
  assert.equal(reg.calls.length, 2);
  assert.equal((await readUpdateCache({ env: box.env })).checkedAt, T0 + DAY);
  assert.deepEqual(seen, ['fetched', 'cached', 'fetched']);
  // A cache from the future (a clock set back) is not fresh: one request, and it is written again.
  c.at = T0;
  await check();
  assert.equal(reg.calls.length, 3);
  assert.equal((await readUpdateCache({ env: box.env })).checkedAt, T0);
});

test('the check: only a strictly newer latest gives the notice; same, older and malformed answers give none',
  async (t) => {
    for (const [answer, installed, expected] of [
      ['{"latest":"0.3.0-beta.10"}', '0.3.0-beta.9', '0.3.0-beta.10'],
      ['{"latest":"0.3.0-beta.9"}', '0.3.0-beta.9', null],
      ['{"latest":"0.3.0-beta.8"}', '0.3.0-beta.9', null],
      ['{"latest":"0.3.0"}', '0.3.0-beta.10', '0.3.0'],
      ['{"latest":"next"}', '0.3.0-beta.9', null],
      ['{"latest":"9.9.9"', '0.3.0-beta.9', null],
      ['{"latest":"9.9.9"}', 'not a version', null]]) {
      const box = await scratch(t);
      const got = await checkForUpdate({ installed, env: box.env, now: clock().now, fetch: registry(answer).fetch });
      assert.deepEqual(got, expected === null ? null : { installed, latest: expected }, `${answer} against ${installed}`);
    }
  });

test('a cache that is stale, broken or a link is ignored and written again; a folder in its place asks nothing',
  async (t) => {
  for (const [name, place] of [
    ['stale', (path) => writeFile(path, '{"checkedAt":"2026-10-27T11:59:59.999Z","latest":"0.3.0-beta.9"}\n')],
    ['not json', (path) => writeFile(path, 'not json\n')],
    ['another shape', (path) => writeFile(path, '{"checkedAt":"2026-10-28T11:00:00.000Z","latest":"0.3.0","x":1}\n')],
    ['a time not ISO', (path) => writeFile(path, '{"checkedAt":"yesterday","latest":"0.3.0"}\n')],
    ['a latest not a version', (path) => writeFile(path, '{"checkedAt":"2026-10-28T11:00:00.000Z","latest":"new"}\n')],
    ['duplicate keys', (path) => writeFile(path,
      '{"checkedAt":"2026-10-28T11:00:00.000Z","latest":null,"latest":"0.3.0"}\n')],
    ['too large', (path) => writeFile(path, `{"checkedAt":"2026-10-28T11:00:00.000Z","latest":null}${' '.repeat(2000)}`)],
    ['a link', async (path, dir) => { const other = join(dir, 'elsewhere.json');
      await writeFile(other, '{"checkedAt":"2026-10-28T11:00:00.000Z","latest":null}\n'); await symlink(other, path); }],
    ['a folder', (path) => mkdir(path)]]) {
    const box = await scratch(t);
    await mkdir(box.env.SONAH_HOME, { recursive: true });
    const path = updateCachePath({ env: box.env });
    await place(path, box.dir);
    if (name === 'stale') assert.equal((await readUpdateCache({ env: box.env })).checkedAt, T0 - DAY - 1, name);
    else assert.equal(await readUpdateCache({ env: box.env }), null, name);
    const reg = registry();
    const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock().now, fetch: reg.fetch });
    // A folder in the cache's place cannot keep the day's check, so no request is made (at most once a day).
    const unkept = name === 'a folder';
    assert.deepEqual([reg.calls.length, got?.latest], unkept ? [0, undefined] : [1, '0.3.0-beta.10'], name);
    if (!unkept)
      assert.deepEqual(await readUpdateCache({ env: box.env }), { checkedAt: T0, latest: '0.3.0-beta.10' }, name);
  }
});

test('each switch turns it off: nothing is read or sent, and no file is written', async (t) => {
  const cases = [
    ['SONAH_NO_UPDATE_CHECK=1', { SONAH_NO_UPDATE_CHECK: '1' }, null, 'env'],
    ['SONAH_NO_UPDATE_CHECK=true', { SONAH_NO_UPDATE_CHECK: 'true' }, null, 'env'],
    ['CI=true', { CI: 'true' }, null, 'ci'],
    ['CI=1', { CI: '1' }, null, 'ci'],
    ['sonah config update-check off', {}, false, 'config'],
    ['an unreadable settings file', {}, 'invalid', 'invalid']];
  assert.deepEqual(UPDATE_CHECK_SOURCES, ['env', 'ci', 'config', 'invalid', 'default']);
  assert.equal(UPDATE_CHECK_DEFAULT, true, 'the owner, 2026-10-28: on by default');
  for (const [name, extra, setting, source] of cases) {
    const box = await scratch(t);
    const env = { ...box.env, ...extra };
    if (setting === false) await writeUpdateCheck(false, { env });
    if (setting === 'invalid') {
      await mkdir(env.SONAH_HOME, { recursive: true });
      await writeFile(updateCheckSettingPath({ env }), '{"version":1,"updateCheck":"off"}\n', { mode: 0o600 });
    }
    assert.deepEqual(await resolveUpdateCheck({ env }), { on: false, source }, name);
    const before = await readdir(env.SONAH_HOME).catch(() => []);
    const reg = registry(), seen = [];
    assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env, now: clock().now, fetch: reg.fetch,
      checked: (what) => seen.push(what) }), null, name);
    assert.deepEqual([reg.calls.length, seen], [0, ['off']], name);
    assert.deepEqual(await readdir(env.SONAH_HOME).catch(() => []), before, `${name}: no file written`);
  }
  // An empty variable is not set; with none, the default is on; the file can turn it on again.
  const box = await scratch(t);
  assert.deepEqual(await resolveUpdateCheck({ env: { ...box.env, SONAH_NO_UPDATE_CHECK: '', CI: '' } }),
    { on: true, source: 'default' });
  await writeUpdateCheck(true, { env: box.env });
  assert.deepEqual(await resolveUpdateCheck({ env: box.env }), { on: true, source: 'config' });
  assert.deepEqual(await resolveUpdateCheck({ env: { ...box.env, CI: 'true' } }), { on: false, source: 'ci' },
    'the environment comes before the file');
  // D171 fix round: config.json is not the check's file; one that cannot be read leaves the check as its own file says.
  const other = await scratch(t);
  await mkdir(other.env.SONAH_HOME, { recursive: true });
  await writeFile(settingsPath({ env: other.env }), 'not json\n', { mode: 0o600 });
  assert.deepEqual(await resolveUpdateCheck({ env: other.env }), { on: true, source: 'default' });
});

test('the 2-second limit: a registry that never answers gives nothing, aborted, and waits a day', async (t) => {
  const box = await scratch(t);
  assert.equal(UPDATE_CHECK_TIMEOUT_MS, 2_000);
  let signal = null, calls = 0;
  const never = (url, options) => { calls++; signal = options.signal; return new Promise(() => {}); };
  const c = clock();
  const started = performance.now();
  const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: c.now, fetch: never });
  const took = performance.now() - started;
  assert.equal(got, null);
  assert.ok(took >= 1_900 && took < 3_500, `gave up after ${Math.round(took)} ms`);
  assert.equal(signal.aborted, true, 'the request is aborted');
  assert.deepEqual(await readUpdateCache({ env: box.env }), { checkedAt: T0, latest: null },
    'a failed check counts as the day\'s check');
  c.at = T0 + DAY - 1;
  assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: c.now, fetch: never }), null);
  assert.equal(calls, 1, 'no second request that day');
});

test('at most once a day by structure: the day is kept before the request, and a folder that cannot keep it asks nothing',
  async (t) => {
    const box = await scratch(t);
    const c = clock();
    const reg = registry();
    const kept = [];
    const fetch = async (url, options) => {
      kept.push(await readUpdateCache({ env: box.env }));
      return reg.fetch(url, options);
    };
    const seen = [];
    const check = () => checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: c.now, fetch,
      checked: (what) => seen.push(what) });
    assert.deepEqual(await check(), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
    // A day later the old answer is kept while the new request runs.
    c.at = T0 + DAY;
    await check();
    assert.deepEqual(kept, [{ checkedAt: T0, latest: null }, { checkedAt: T0 + DAY, latest: '0.3.0-beta.10' }],
      'the day\'s check is in the cache before its request');
    assert.deepEqual(seen, ['fetched', 'fetched']);
    // A superuser can write anywhere, so the folder that cannot be written is checked only where permissions apply.
    if (process.getuid?.() === 0) return;
    const blocked = await scratch(t);
    await mkdir(blocked.env.SONAH_HOME, { mode: 0o500 });
    const none = registry();
    const unkept = [];
    try {
      assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: blocked.env, now: clock().now,
        fetch: none.fetch, checked: (what) => unkept.push(what) }), null);
      assert.equal(none.calls.length, 0, 'no request without a cache to keep the day in');
      assert.deepEqual(unkept, ['unkept']);
      assert.deepEqual(await readdir(blocked.env.SONAH_HOME), []);
    } finally { await chmod(blocked.env.SONAH_HOME, 0o700); }
  });

/** The cache's exact bytes for `{ checkedAt, latest }`. */
const cacheText = ({ checkedAt, latest }) => `${JSON.stringify({ checkedAt: new Date(checkedAt).toISOString(), latest })}\n`;

test('at most once a day across commands: checks started together make one request between them', async (t) => {
  // Before the claim, every command that read a stale cache before another had kept the day's check asked again.
  for (const [name, before] of [['no cache', null], ['a stale cache', { checkedAt: T0 - DAY - 1, latest: '0.3.0-beta.9' }],
    ['a cache from the future', { checkedAt: T0 + 60_000, latest: '0.3.0-beta.9' }]]) {
    for (const count of [2, 8]) {
      const box = await scratch(t);
      if (before) {
        await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
        await writeFile(updateCachePath({ env: box.env }), cacheText(before), { mode: 0o600 });
      }
      const reg = registry(), seen = [];
      const answers = await Promise.all(Array.from({ length: count }, () => checkForUpdate({ installed: '0.3.0-beta.9',
        env: box.env, now: clock().now, fetch: reg.fetch, checked: (what) => seen.push(what) })));
      const label = `${name}, ${count} at once`;
      assert.equal(reg.calls.length, 1, label);
      // One made the check; each other found it claimed, or (read after it was kept) cached.
      assert.deepEqual([seen.length, seen.filter((what) => what === 'fetched').length], [count, 1], label);
      assert.ok(seen.every((what) => ['fetched', 'claimed', 'cached'].includes(what)), `${label}: ${seen}`);
      assert.ok(answers.some((answer) => answer?.latest === '0.3.0-beta.10'), label);
      assert.deepEqual(await readUpdateCache({ env: box.env }), { checkedAt: T0, latest: '0.3.0-beta.10' }, label);
      assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], `${label}: no claim is left`);
    }
  }
});

test('the claim: named after the cache it follows; a command that read the cache before another kept its check stops',
  async (t) => {
    const box = await scratch(t);
    const where = { env: box.env };
    assert.equal(updateClaimPath(null, where), join(box.env.SONAH_HOME, '.update-check.json.none.claim'));
    assert.equal(updateClaimPath({ checkedAt: T0, latest: null }, where),
      join(box.env.SONAH_HOME, `.update-check.json.${T0}.claim`));
    // This command read a stale cache; another then kept its own check. The claim lands (the other's has gone), the
    // cache read again has changed, and this command stops: no request, and its claim is removed.
    const stale = { checkedAt: T0 - DAY - 1, latest: '0.3.0-beta.9' };
    const kept = { checkedAt: T0, latest: '0.3.0-beta.10' };
    await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
    await writeFile(updateCachePath(where), cacheText(kept), { mode: 0o600 });
    assert.deepEqual(await claimUpdateCheck(stale, T0 + 5, where), { standing: kept });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE]);
    // The same from no cache: a cache written since stops it too.
    assert.deepEqual(await claimUpdateCheck(null, T0 + 5, where), { standing: kept });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE]);
    // The winner: its claim, renamed over the cache, holds the day's check and the answer the cache held.
    assert.equal(await claimUpdateCheck(kept, T0 + DAY, where), 'won');
    assert.deepEqual(await readUpdateCache(where), { checkedAt: T0 + DAY, latest: '0.3.0-beta.10' });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE]);
    // A check kept by another command while this one's request ran (one whose clock is behind, for which this check is
    // from the future) is not written over with this one's answer.
    const other = await scratch(t);
    const behind = { checkedAt: T0 - 1_000, latest: '0.3.0-beta.11' };
    const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: other.env, now: clock().now, fetch: async () => {
      await writeFile(updateCachePath({ env: other.env }), cacheText(behind), { mode: 0o600 });
      return '{"latest":"0.3.0-beta.10"}';
    } });
    assert.deepEqual(got, { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
    assert.deepEqual(await readUpdateCache({ env: other.env }), behind);
  });

test('a command that stopped between its claim and its request: its claim is the day\'s check; a day later the next',
  async (t) => {
    const HOUR = 60 * 60 * 1000;
    const box = await scratch(t);
    const where = { env: box.env };
    await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
    // The cache a day old, and the claim on the check after it, landed an hour ago by a command that then stopped.
    const old = { checkedAt: T0 - DAY - HOUR, latest: '0.3.0-beta.10' };
    await writeFile(updateCachePath(where), cacheText(old), { mode: 0o600 });
    await writeFile(updateClaimPath(old, where), cacheText({ checkedAt: T0 - HOUR, latest: '0.3.0-beta.10' }),
      { mode: 0o600 });
    const reg = registry('{"latest":"0.3.0-beta.11"}'), c = clock(), seen = [];
    const check = () => checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: c.now, fetch: reg.fetch,
      checked: (what) => seen.push(what) });
    // Within a day of the claim: no request, and its answer (the one the cache held) is used.
    assert.deepEqual(await check(), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
    c.at = T0 - HOUR + DAY - 1;
    await check();
    assert.deepEqual([reg.calls.length, seen], [0, ['claimed', 'claimed']]);
    // A day after the claim: it is renamed over the cache, and the check after it is made, once.
    c.at = T0 - HOUR + DAY;
    assert.deepEqual(await check(), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.11' });
    assert.deepEqual([reg.calls.length, seen.at(-1)], [1, 'fetched']);
    assert.deepEqual(await readUpdateCache(where), { checkedAt: T0 - HOUR + DAY, latest: '0.3.0-beta.11' });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE]);
    // A claim from the future (the clock set back since it landed) or one that cannot be read is not fresh either:
    // renamed over the cache at once, and one request.
    for (const [name, claimText] of [['from the future', cacheText({ checkedAt: T0 + HOUR, latest: null })],
      ['not a cache', 'not json\n'], ['empty', '']]) {
      const other = await scratch(t);
      const at = { env: other.env };
      await mkdir(other.env.SONAH_HOME, { recursive: true, mode: 0o700 });
      await writeFile(updateCachePath(at), cacheText(old), { mode: 0o600 });
      await writeFile(updateClaimPath(old, at), claimText, { mode: 0o600 });
      const once = registry();
      const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: other.env, now: clock().now, fetch: once.fetch });
      assert.deepEqual([once.calls.length, got?.latest], [1, '0.3.0-beta.10'], name);
      assert.deepEqual(await readUpdateCache(at), { checkedAt: T0, latest: '0.3.0-beta.10' }, name);
      assert.deepEqual(await readdir(other.env.SONAH_HOME), [UPDATE_CHECK_FILE], name);
    }
  });

test('what commands that stopped left beside the cache is removed by the next check that is made', async (t) => {
  // A claim that follows a cache since replaced can make no check, and a temporary file a day old belongs to no command
  // still running: the next command that makes a check removes them. A claim named after the cache there now, a
  // temporary file made less than a day ago, a folder at such a name and Sonah's other files stay.
  const box = await scratch(t);
  const where = { env: box.env }, dir = box.env.SONAH_HOME;
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeCodePass(false, where);
  await writeFile(updateCachePath(where), cacheText({ checkedAt: T0 - DAY - 1, latest: '0.3.0-beta.9' }),
    { mode: 0o600 });
  const id = (n) => `0000000${n}-0000-4000-8000-000000000000`;
  const left = [`.update-check.json.${T0 - 5 * DAY}.claim`, '.update-check.json.none.claim',
    `.update-check.json.${T0 - 2 * DAY}.${id(1)}.tmp`, `.update-check.json.${T0 - DAY}.${id(2)}.tmp`];
  const kept = [`.update-check.json.${T0}.claim`, `.update-check.json.${T0 - 1_000}.${id(3)}.tmp`];
  for (const name of [...left, ...kept])
    await writeFile(join(dir, name), cacheText({ checkedAt: T0 - 3 * DAY, latest: null }), { mode: 0o600 });
  await mkdir(join(dir, `.update-check.json.${T0 - 3 * DAY}.claim`));
  await writeFile(join(dir, 'notes.txt'), 'not Sonah\'s\n');
  const reg = registry(), seen = [];
  assert.deepEqual(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock().now, fetch: reg.fetch,
    checked: (what) => seen.push(what) }), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
  assert.deepEqual([reg.calls.length, seen], [1, ['fetched']]);
  assert.deepEqual((await readdir(dir)).sort(), [...kept, `.update-check.json.${T0 - 3 * DAY}.claim`, 'config.json',
    'notes.txt', UPDATE_CHECK_FILE].sort());
  // A check answered from the cache makes no check, and removes nothing.
  await writeFile(join(dir, left[0]), '');
  await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock(T0 + 1).now, fetch: reg.fetch });
  assert.ok((await readdir(dir)).includes(left[0]));
  assert.equal(reg.calls.length, 1);
});

test('a claim found is judged by the clock read after it: a running command\'s claim is never taken over', async (t) => {
  // D171 fix round. Another command read the same stale cache, read the clock after this one did and landed its claim
  // first, so the claim's time is after this command's first reading. Judged by that reading it looked from the
  // future, and was renamed over the cache as if a stopped command had left it; judged by the clock read after it, it
  // holds the day's check. T9 is far from the real clock, so a claim judged by any other clock is not fresh either.
  const T9 = Date.parse('2099-01-01T00:00:00.000Z');
  const box = await scratch(t);
  const where = { env: box.env };
  await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  const stale = { checkedAt: T9 - 2 * DAY, latest: '0.3.0-beta.9' };
  const live = { checkedAt: T9 + 1, latest: '0.3.0-beta.10' };
  await writeFile(updateCachePath(where), cacheText(stale), { mode: 0o600 });
  await writeFile(updateClaimPath(stale, where), cacheText(live), { mode: 0o600 });
  assert.deepEqual(await claimUpdateCheck(stale, T9, where, () => T9 + 2), { standing: live });
  // Through the check: the clock reads T9 after the cache, and T9 + 2 after the claim. Its answer, no request.
  let reads = 0;
  const reg = registry(), seen = [];
  assert.deepEqual(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: () => (reads++ ? T9 + 2 : T9),
    fetch: reg.fetch, checked: (what) => seen.push(what) }), { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
  assert.deepEqual([reg.calls.length, seen], [0, ['claimed']]);
  assert.deepEqual([await readUpdateCache(where), await readFile(updateClaimPath(stale, where), 'utf8')],
    [stale, cacheText(live)], 'nothing was moved');
  // After a take-over the clock is read again, after the cache: here another command keeps its check (its clock read
  // after this one's second reading) between this command's take-over and its next read of the cache. In a child
  // process whose rename, once it has moved the stopped command's claim, lets that command keep its check.
  const other = await scratch(t);
  const at = { env: other.env };
  await mkdir(other.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  await writeFile(updateCachePath(at), cacheText(stale), { mode: 0o600 });
  await writeFile(updateClaimPath(stale, at), cacheText({ checkedAt: T9 - DAY - 1, latest: null }), { mode: 0o600 });
  const run = await child(`const fs = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
const rename = fs.promises.rename;
let first = true;
fs.promises.rename = async (from, to) => {
  await rename(from, to);
  if (first && from.endsWith('.claim')) {
    first = false;
    fs.writeFileSync(to, ${JSON.stringify(cacheText({ checkedAt: T9 + 15, latest: '0.3.0-beta.11' }))});
  }
};
syncBuiltinESMExports();
let calls = 0, reads = 0;
const seen = [];
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(other.env.SONAH_HOME)} },
  now: () => ${T9} + 10 * reads++, fetch: async () => { calls++; return '{"latest":"0.3.0-beta.10"}'; },
  checked: (what) => seen.push(what) });
console.log(JSON.stringify({ got, calls, seen }));`);
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(run.stdout), { got: { installed: '0.3.0-beta.9', latest: '0.3.0-beta.11' }, calls: 0,
    seen: ['cached'] }, 'the check kept since is fresh by the clock read after it');
});

test('a command that finds the day\'s check claimed uses the answer that holds it, only when fresh', async (t) => {
  // D171 fix round. (1) No cache when this command reads it; while it claims, a computer whose clock is an hour ahead
  // keeps its check in the shared folder. This command stops (the cache changed) and gives no notice from a check that
  // is from the future by its clock.
  const HOUR = 60 * 60 * 1000;
  const box = await scratch(t);
  const where = { env: box.env };
  await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  let first = true;
  const ahead = () => {
    if (first) {
      first = false;
      writeFileSync(updateCachePath(where), cacheText({ checkedAt: T0 + HOUR, latest: '0.3.0-beta.11' }));
    }
    return T0;
  };
  const reg = registry(), seen = [];
  assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: ahead, fetch: reg.fetch,
    checked: (what) => seen.push(what) }), null);
  assert.deepEqual([reg.calls.length, seen], [0, ['claimed']]);
  // (2) A claim that its command renames over the cache between this command's link and its read of the claim: this
  // command uses the answer the cache now holds. In a child process whose link, finding the claim there, first lets the
  // claim's command rename it.
  const other = await scratch(t);
  const at = { env: other.env };
  await mkdir(other.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  const stale = { checkedAt: T0 - 2 * DAY, latest: null };
  await writeFile(updateCachePath(at), cacheText(stale), { mode: 0o600 });
  await writeFile(updateClaimPath(stale, at), cacheText({ checkedAt: T0, latest: '0.3.0-beta.11' }), { mode: 0o600 });
  const run = await child(`const fs = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
const link = fs.promises.link;
fs.promises.link = async (from, to) => {
  try { return await link(from, to); } catch (error) {
    if (error.code === 'EEXIST') await fs.promises.rename(to, ${JSON.stringify(updateCachePath(at))});
    throw error;
  }
};
syncBuiltinESMExports();
let calls = 0;
const seen = [];
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(other.env.SONAH_HOME)} },
  now: () => ${T0 + 5}, fetch: async () => { calls++; return '{"latest":"0.3.0-beta.10"}'; }, checked: (what) => seen.push(what) });
console.log(JSON.stringify({ got, calls, seen }));`);
  assert.equal(run.code, 0);
  assert.deepEqual(JSON.parse(run.stdout), { got: { installed: '0.3.0-beta.9', latest: '0.3.0-beta.11' }, calls: 0,
    seen: ['claimed'] });
  // (3) A command stopped for a day after it read the cache again, whose claim another command took over meanwhile:
  // its rename finds the claim gone, and it makes no request. In a child process whose first rename of a claim first
  // lets the other command take it over; the clock reads a day later after that.
  const third = await scratch(t);
  const on = { env: third.env };
  await mkdir(third.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  await writeFile(updateCachePath(on), cacheText(stale), { mode: 0o600 });
  const taken = await child(`const fs = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
const rename = fs.promises.rename;
let first = true;
fs.promises.rename = async (from, to) => {
  if (first && from.endsWith('.claim')) { first = false; await rename(from, to); }
  return rename(from, to);
};
syncBuiltinESMExports();
let calls = 0, reads = 0;
const seen = [];
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(third.env.SONAH_HOME)} },
  now: () => (reads++ ? ${T0 + DAY + 1} : ${T0}), fetch: async () => { calls++; return '{"latest":"0.3.0-beta.10"}'; },
  checked: (what) => seen.push(what) });
console.log(JSON.stringify({ got, calls, seen }));`);
  assert.equal(taken.code, 0);
  assert.deepEqual(JSON.parse(taken.stdout), { got: null, calls: 0, seen: ['claimed'] });
});

test('anything but a regular file at a claim\'s name stays there, and no request is made while it is', async (t) => {
  // D171 fix round: a folder or a link at the claim's name is never renamed over the cache (before, a folder was moved
  // to update-check.json's name and stayed there); every check finds the day claimed and asks nothing.
  for (const [name, place] of [['a folder', (path) => mkdir(path)],
    ['a link', (path, dir) => symlink(join(dir, 'elsewhere.json'), path)]]) {
    const box = await scratch(t);
    const where = { env: box.env };
    await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
    await place(updateClaimPath(null, where), box.dir);
    const reg = registry(), seen = [];
    for (const day of [0, 2, 4]) {
      assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock(T0 + day * DAY).now,
        fetch: reg.fetch, checked: (what) => seen.push(what) }), null, name);
    }
    assert.deepEqual([reg.calls.length, seen], [0, ['claimed', 'claimed', 'claimed']], name);
    assert.deepEqual(await readdir(box.env.SONAH_HOME), ['.update-check.json.none.claim'], name);
    const found = await lstat(updateClaimPath(null, where));
    assert.ok(name === 'a folder' ? found.isDirectory() : found.isSymbolicLink(), name);
  }
});

test('silent on failure: a refused, failed or odd answer gives no line and no error', async (t) => {
  for (const answer of [new Error('ENOTFOUND'), Object.assign(new Error('status'), { code: 503 }), '', '{"latest":7}',
    '<!doctype html>']) {
    const box = await scratch(t);
    const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock().now,
      fetch: registry(answer).fetch });
    assert.equal(got, null, String(answer));
    const out = streams();
    await writeUpdateNotice(async () => got, out.stderr);
    assert.equal(out.chunks.stderr, '');
  }
  // A fetch that throws before it returns a promise, a clock that throws, and a notice that rejects: still silent.
  const box = await scratch(t);
  assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock().now,
    fetch: () => { throw new Error('sync'); } }), null);
  assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env,
    now: () => { throw new Error('clock'); }, fetch: registry().fetch }), null);
  const out = streams();
  await writeUpdateNotice(async () => { throw new Error('no'); }, out.stderr);
  assert.equal(out.chunks.stderr, '');
  // A folder that cannot be written keeps no cache, so no request is made and no line is given (the check below).
  // A settings file that cannot be read (here, Sonah's folder is a file) turns the check off.
  const unreadable = await scratch(t);
  await writeFile(unreadable.env.SONAH_HOME, 'a file where the folder should be');
  const reg = registry();
  assert.equal(await checkForUpdate({ installed: '0.3.0-beta.9', env: unreadable.env, now: clock().now,
    fetch: reg.fetch }), null);
  assert.equal(reg.calls.length, 0);
});

test('the line: once, its exact words; the commands that check, closed', async (t) => {
  assert.equal(UPDATE_COMMAND, 'npm install -g getsonah@latest');
  assert.equal(UPDATE_NOTICE_WORDS.line('0.3.0-beta.10', '0.3.0-beta.9'),
    'Sonah 0.3.0-beta.10 is out, and you have 0.3.0-beta.9. Update with npm install -g getsonah@latest.');
  assert.equal(UPDATE_NOTICE_WORDS.doctor('0.3.0-beta.10', '0.3.0-beta.9'),
    'Sonah: 0.3.0-beta.9, and 0.3.0-beta.10 is out. Update with npm install -g getsonah@latest.');
  assert.ok(REPORT_FOOTER_WORDS.newer('1.0.0').endsWith(`Update with ${UPDATE_COMMAND}.`), 'the page gives the same command');
  const out = streams();
  // A scratch home and a fake fetch: with a switch broken (a mutant), nothing reaches the registry or the real home.
  const box = await scratch(t);
  const reg = registry();
  const notice = updateCheckWhenAsked({ installed: '0.3.0-beta.9', env: { ...box.env, SONAH_NO_UPDATE_CHECK: '1' },
    fetch: reg.fetch, now: clock().now });
  assert.equal(notice.asked(), false, 'option A: made, not started, until a command asks it');
  assert.equal(notice(), notice(), 'started once');
  assert.equal(notice.asked(), true);
  assert.equal(await notice(), null);
  assert.equal(reg.calls.length, 0);
  await writeUpdateNotice(async () => ({ installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' }), out.stderr);
  assert.equal(out.chunks.stderr, `${UPDATE_NOTICE_WORDS.line('0.3.0-beta.10', '0.3.0-beta.9')}\n`);
  // Option A: only review and doctor are handed a check; `config`, which sets its switch, never checks.
  assert.deepEqual(UPDATE_NOTICE_COMMANDS, ['review', 'doctor']);
  for (const argv of [['review'], ['review', 'x.jsonl'], ['doctor', '--no-probe'], ['review', '--session', 'abc']])
    assert.equal(updateNoticeApplies(argv), true, argv.join(' '));
  for (const argv of [[], ['--version'], ['-v'], ['help'], ['--help'], ['capture'], ['capture-outcome'], ['trailer'],
    ['not-a-command'], ['review', '--help'], ['doctor', '-h'], ['review', '--session', 'abc', '--background'],
    ['sessions'], ['sessions', '--github', 'o/r', '--pr', '1'], ['decision', 'accept'], ['hook', 'add'], ['skill', 'add'],
    ['feedback'], ['slice', 'x.jsonl'],
    ['config'], ['config', 'update-check', 'off'], ['config', 'update-check', 'on'], ['config', 'code-pass', 'off']])
    assert.equal(updateNoticeApplies(argv), false, argv.join(' '));
});

test('settings: the update check\'s own file; config.json stays as before D171, and neither write touches the other',
  async (t) => {
    // config.json's shape is the one a Sonah older than beta.10 reads: a key for the update check is not in it.
    assert.equal(parseSettings('{"version":1,"updateCheck":false}'), null);
    assert.deepEqual(parseSettings('{"version":1,"codePass":false}'), { codePass: false });
    assert.equal(UPDATE_CHECK_SETTING_FILE, 'update-check-setting.json');
    assert.deepEqual(parseUpdateCheckSetting('{"version":1,"updateCheck":false}'), { updateCheck: false });
    for (const text of ['{"version":1,"updateCheck":"off"}', '{"version":1,"updateCheck":null}', '{"version":1}',
      '{"version":2,"updateCheck":false}', '{"version":1,"updateCheck":false,"updateCheck":true}',
      '{"version":1,"updateCheck":false,"codePass":true}', 'not json'])
      assert.equal(parseUpdateCheckSetting(text), null, text);
    const box = await scratch(t);
    const path = settingsPath({ env: box.env }), updatePath = updateCheckSettingPath({ env: box.env });
    assert.equal(updatePath, join(box.env.SONAH_HOME, UPDATE_CHECK_SETTING_FILE));
    await writeUpdateCheck(false, { env: box.env });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_SETTING_FILE], 'no config.json is written');
    assert.equal(await readFile(updatePath, 'utf8'), '{"version":1,"updateCheck":false}\n');
    assert.equal((await stat(updatePath)).mode & 0o777, 0o600);
    await writeCodePass(false, { env: box.env });
    assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":false}\n', 'the bytes before D171');
    await writeUpdateCheck(true, { env: box.env });
    assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":false}\n');
    assert.deepEqual(await readUpdateCheckSetting({ env: box.env }), { state: 'ok', settings: { updateCheck: true } });
    assert.deepEqual(await readSettings({ env: box.env }), { state: 'ok', settings: { codePass: false } });
    // A file that cannot be read is replaced by its own write only; the other file is left as it is.
    await writeFile(updatePath, 'not json\n');
    await writeCodePass(true, { env: box.env });
    assert.equal(await readFile(updatePath, 'utf8'), 'not json\n');
    assert.deepEqual(await resolveUpdateCheck({ env: box.env }), { on: false, source: 'invalid' });
    await writeUpdateCheck(true, { env: box.env });
    assert.equal(await readFile(updatePath, 'utf8'), '{"version":1,"updateCheck":true}\n');
    await assert.rejects(writeUpdateCheck('off', { env: box.env }), { code: 'usage' });
  });

test('sonah config over a settings file that cannot be read: setting the other one never resets it', async (t) => {
  // The case the fix round found: config.json not readable (here, writable by others), the update check set off by its
  // line's fix. The code step's file keeps its bytes and still needs its own fix; the reverse holds too.
  const box = await scratch(t);
  const config = async (argv) => {
    const out = streams();
    return { code: await runConfigCommand(argv, { ...out, env: box.env, home: box.home }), ...out.chunks };
  };
  const path = settingsPath({ env: box.env }), updatePath = updateCheckSettingPath({ env: box.env });
  await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
  await writeFile(path, '{"version":1,"codePass":false}\n');
  await chmod(path, 0o664);
  const before = await config([]);
  assert.equal(before.code, 1);
  assert.match(before.stdout.split('\n')[0], /^code-pass: the settings file .* could not be read\./);
  assert.equal(before.stdout.split('\n')[1], UPDATE_CHECK_SETTING_WORDS.on(null), 'not the update check\'s file');
  assert.equal((await config(['update-check', 'off'])).code, 0);
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"codePass":false}\n');
  assert.equal((await stat(path)).mode & 0o777, 0o664, 'not rewritten');
  const after = await config([]);
  assert.deepEqual([after.code, after.stdout.split('\n')[0]], [1, before.stdout.split('\n')[0]]);
  assert.equal(after.stdout.split('\n')[1], UPDATE_CHECK_SETTING_WORDS.off(updatePath));
  // The reverse: the update check's file unreadable, the code step set: the check stays off, its file as it was.
  await writeFile(updatePath, '{"version":1,"updateCheck":maybe}\n', { mode: 0o600 });
  assert.equal((await config(['code-pass', 'on'])).code, 0);
  assert.equal(await readFile(updatePath, 'utf8'), '{"version":1,"updateCheck":maybe}\n');
  const reverse = await config([]);
  assert.equal(reverse.code, 1);
  assert.equal(reverse.stdout.split('\n')[1], UPDATE_CHECK_SETTING_WORDS.invalid(updatePath));
  assert.match(reverse.stdout.split('\n')[0], /^code-pass: on \(set in /);
});

test('sonah config: shows the update check, sets it, and says how it is set', async (t) => {
  const box = await scratch(t);
  const config = async (argv, env = box.env) => {
    const out = streams();
    return { code: await runConfigCommand(argv, { ...out, env, home: box.home }), ...out.chunks };
  };
  const path = updateCheckSettingPath({ env: box.env });
  assert.equal(CONFIG_USAGE, 'sonah config [code-pass|update-check on|off]');
  const shown = await config([]);
  assert.deepEqual([shown.code, shown.stdout.split('\n')[1]], [0, UPDATE_CHECK_SETTING_WORDS.on(null)]);
  assert.equal(UPDATE_CHECK_SETTING_WORDS.on(null), 'update-check: on (the default). Once a day at most, Sonah asks '
    + 'npm\'s registry for the latest version of getsonah. When it is newer than yours, Sonah says so. Sonah asks only '
    + 'with a review\'s first call to the reviewer, and in sonah doctor. Change it with sonah config update-check off.');
  await assert.rejects(stat(box.env.SONAH_HOME), { code: 'ENOENT' }, 'showing writes nothing');
  const off = await config(['update-check', 'off']);
  assert.deepEqual([off.code, off.stdout, off.stderr], [0, `${UPDATE_CHECK_SETTING_WORDS.off(path)}\n`, '']);
  assert.equal(UPDATE_CHECK_SETTING_WORDS.off(path), `update-check: off (set in ${path}). Sonah does not ask npm's `
    + 'registry for the latest version. Change it with sonah config update-check on.');
  assert.equal((await config([])).stdout.split('\n')[1], UPDATE_CHECK_SETTING_WORDS.off(path));
  const on = await config(['update-check', 'on']);
  assert.deepEqual([on.code, on.stdout], [0, `${UPDATE_CHECK_SETTING_WORDS.on(path)}\n`]);
  assert.equal(await readFile(path, 'utf8'), '{"version":1,"updateCheck":true}\n');
  assert.equal((await config([], { ...box.env, SONAH_NO_UPDATE_CHECK: '1' })).stdout.split('\n')[1],
    'update-check: off (your environment sets SONAH_NO_UPDATE_CHECK). Sonah does not ask npm\'s registry for the '
    + 'latest version.');
  assert.equal((await config([], { ...box.env, CI: 'true' })).stdout.split('\n')[1], UPDATE_CHECK_SETTING_WORDS.offBy('CI'));
  for (const argv of [['update-check'], ['update-check', 'yes'], ['update-check', 'off', 'on'], ['updateCheck', 'off']]) {
    const bad = await config(argv);
    assert.deepEqual([bad.code, bad.stdout, bad.stderr], [2, '', `usage: ${CONFIG_USAGE}\n`], argv.join(' '));
  }
  await writeFile(path, '{"version":1,"updateCheck":maybe}\n');
  const unreadable = await config([]);
  assert.deepEqual([unreadable.code, unreadable.stdout.split('\n')[1]], [1, UPDATE_CHECK_SETTING_WORDS.invalid(path)]);
});

/** A doctor run with no claude, no codex and a fixed home: the review setup's own lines, and the notice given. */
async function doctorRun(box, updateNotice) {
  const missing = () => Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }));
  return doctor({ probe: false }, { env: { ...box.env, PATH: '/synthetic/bin', SONAH_CODEX_BIN: '/synthetic/bin/codex' },
    home: box.home, nodeVersion: '20.0.0', runCli: missing, commitLink: async () => null,
    adapters: async () => ({ claude: { count: 1, where: 'claude' }, codex: { count: 0, where: 'codex' } }),
    ...(updateNotice ? { updateNotice } : {}) });
}

test('sonah doctor: one line before its last, never needing attention', async (t) => {
  const box = await scratch(t);
  const plain = await doctorRun(box);
  const none = await doctorRun(box, async () => null);
  const newer = await doctorRun(box, async () => ({ installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' }));
  const failing = await doctorRun(box, async () => { throw new Error('no'); });
  assert.equal(none.text, plain.text);
  assert.equal(failing.text, plain.text);
  const lines = plain.text.split('\n');
  assert.equal(newer.text, [...lines.slice(0, -1), UPDATE_NOTICE_WORDS.doctor('0.3.0-beta.10', '0.3.0-beta.9'),
    lines.at(-1)].join('\n'));
  assert.deepEqual([newer.healthy, newer.attention], [plain.healthy, plain.attention], 'not a reason for attention');
  assert.deepEqual([plain.facts.newer, newer.facts.newer], [null, { installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' }]);
});

/** One review of the synthetic session through the command, in `dir` (made again each time), with `updateNotice`. */
async function reviewIn(dir, { format, updateNotice }) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const home = join(dir, 'home');
  await mkdir(home);
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const out = streams(), sent = [];
  const output = join(dir, format === 'html' ? 'review.html' : 'review.md');
  const judge = codeJudge();
  const code = await runSessionReviewCommand([file, '--no-code-pass', '--concurrency', '1', '--state-dir',
    join(dir, 'state'), '--format', format, '--output', output, '--no-open'], {
    ...out, cwd: dir, env: { HOME: home, SONAH_HOME: join(home, '.sonah') }, installSignals: false,
    loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: dir }),
    ...(updateNotice ? { updateNotice } : {}),
    createJudge: ({ onResult }) => async (request) => {
      sent.push(JSON.stringify([request.label, request.system, request.prompt]));
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  const read = (path) => readFile(path, 'utf8').catch(() => null);
  return { code, sent, stdout: out.chunks.stdout.replace(/wall \d+ ms/g, 'wall 0 ms').replace(/\d+(?:\.\d+)? s\b/g, 'N s'),
    stderr: out.chunks.stderr, page: format === 'html' ? await read(output) : null,
    md: await read(format === 'html' ? join(dir, 'review.md') : output),
    home: await readdir(join(home, '.sonah')).catch(() => []) };
}

test('a review: stdout, the requests and the .md are the same with and without a newer version; the page says it',
  async (t) => {
    const box = await scratch(t);
    const dir = join(box.dir, 'case');
    const newer = async () => ({ installed: '0.3.0-beta.9', latest: '0.3.0-beta.10' });
    for (const format of ['md', 'html']) {
      const without = await reviewIn(dir, { format });
      const none = await reviewIn(dir, { format, updateNotice: async () => null });
      const withNewer = await reviewIn(dir, { format, updateNotice: newer });
      for (const [name, run] of [['none', none], ['newer', withNewer]]) {
        assert.equal(run.code, without.code, `${format} ${name}`);
        assert.deepEqual(run.sent, without.sent, `${format} ${name}: the requests, byte for byte`);
        assert.equal(run.stdout, without.stdout, `${format} ${name}: stdout, byte for byte`);
        assert.equal(run.stderr, without.stderr, `${format} ${name}: the command itself writes no notice`);
        assert.equal(run.md, without.md, `${format} ${name}: the .md never carries it`);
        assert.deepEqual(run.home, without.home, `${format} ${name}: no file in Sonah's folder`);
      }
      assert.ok(without.sent.length > 0 && without.md.length > 0);
      if (format === 'html') {
        const line = `<p>${REPORT_FOOTER_WORDS.newer('0.3.0-beta.10')}</p>`;
        assert.equal(none.page, without.page, 'no newer version: the same page, byte for byte');
        assert.ok(!without.page.includes(line));
        assert.equal(withNewer.page.replace(line, ''), without.page, 'the page differs by its footer line alone');
        assert.equal(withNewer.page.split(line).length, 2, 'said once');
      }
    }
  });

test('option A: a review starts the update check with its first call to the reviewer, once', async (t) => {
  const box = await scratch(t);
  const dir = join(box.dir, 'case');
  const home = join(dir, 'home');
  await mkdir(home, { recursive: true });
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, '{}\n');
  const order = [];
  const judge = codeJudge();
  const run = async (argv) => {
    const out = streams();
    const code = await runSessionReviewCommand([file, ...argv], { ...out, cwd: dir,
      env: { HOME: home, SONAH_HOME: join(home, '.sonah') }, installSignals: false,
      loadReviews: async () => new Map(), openPage: async () => {},
      loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: dir }),
      updateNotice: async () => { order.push('check'); return null; },
      createJudge: ({ onResult }) => async (request) => {
        order.push('request');
        onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
        return judge(request);
      } });
    return { code, ...out.chunks };
  };
  const state = ['--state-dir', join(dir, 'state')];
  // The dry run says that Sonah sent nothing: no check.
  const dry = await run([...state, '--no-code-pass', '--dry-run']);
  assert.ok(dry.stdout.includes(`\n${DRY_RUN_WORDS.nothing}\n`), 'the dry run says that Sonah sent nothing');
  assert.deepEqual([dry.code, order], [0, []], 'dry run');
  // The six stops that come before the reviewer's transport is made (each one's fix says that Sonah read and sent
  // nothing): no check.
  await mkdir(join(home, '.sonah'), { recursive: true });
  await mkdir(join(dir, 'not-git'), { recursive: true });
  for (const [code, argv, setup] of [
    ['invalid_effort', ['--no-code-pass', '--effort', 'bogus']],
    ['effort_claude_cli_only', ['--no-code-pass', '--backend', 'codex-cli', '--model', 'gpt-6.1-sol', '--effort', 'high']],
    ['code_repo_not_found', ['--code-repo', join(dir, 'absent')]],
    ['code_repo_not_git', ['--code-repo', join(dir, 'not-git')]],
    ['config_invalid', [], () => writeFile(join(home, '.sonah', 'config.json'), 'not json\n', { mode: 0o600 })],
    ['state_dir_holds_root', ['--code-pass', '--state-dir', dir]]]) {
    await setup?.();
    const stopped = await run(argv.includes('--state-dir') ? argv : [...state, ...argv]);
    assert.ok(stopped.stderr.startsWith(`Review could not complete: ${code}.\nFix: ${REVIEW_FIX_WORDS[code]}`), code);
    assert.deepEqual([stopped.code, order], [2, []], code);
    await rm(join(home, '.sonah', 'config.json'), { force: true });
  }
  // A first call that the review's own limit refuses (--max-input-bytes) is no call to the reviewer: no check.
  const refused = await run(['--state-dir', join(dir, 'limited'), '--no-code-pass', '--concurrency', '1',
    '--max-input-bytes', '1', '--format', 'md', '--output', join(dir, 'limited.md')]);
  assert.notEqual(refused.code, 0, 'the limit stops the review');
  assert.deepEqual(order, [], 'a call the budget refuses starts nothing');
  // A review that sends: the check once, with its first request and not before it.
  await run([...state, '--no-code-pass', '--concurrency', '1', '--format', 'md', '--output', join(dir, 'a.md')]);
  assert.equal(order[0], 'request');
  assert.equal(order.filter((what) => what === 'check').length, 1, 'once, however many requests');
  assert.ok(order.filter((what) => what === 'request').length > 1);
  // The same review on its stored answers alone sends no request, and asks nothing: as .md, and (fix round) as the page,
  // which awaits the answer only when the check started.
  order.length = 0;
  await run([...state, '--no-code-pass', '--concurrency', '1', '--format', 'md', '--output', join(dir, 'b.md')]);
  assert.deepEqual(order, [], 'a run on stored answers alone');
  const page = await run([...state, '--no-code-pass', '--concurrency', '1', '--format', 'html', '--output',
    join(dir, 'c.html'), '--no-open']);
  assert.deepEqual([page.code, order], [0, []], 'the page, on stored answers alone');
  assert.ok(!(await readFile(join(dir, 'c.html'), 'utf8')).includes(' is out. Update with '), 'no footer line');
});

test('option A: a review whose session answers are all stored checks when its code step calls the reviewer',
  async (t) => {
    // The code step's transport is wrapped as the session's: a run that replays every session answer but whose code
    // step asks again (its stored answers removed) starts the check with the code step's first call, once.
    const root = await repoWith(t);
    const box = await scratch(t);
    const file = join(box.dir, 'recording.jsonl');
    await writeFile(file, '{}\n');
    const order = [];
    const judge = codeJudge();
    const run = async (name) => {
      const out = streams();
      const code = await runSessionReviewCommand([file, '--concurrency', '1', '--state-dir', join(box.dir, 'state'),
        '--format', 'md', '--output', join(box.dir, `${name}.md`)], { ...out, cwd: root,
        env: { ...box.env, CODEX_HOME: join(box.dir, 'codex'), SONAH_CLAUDE_PROJECTS: join(box.dir, 'claude') },
        installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
        loadSession: async () => ({ session: codeSession(), hash: sha256('synthetic'), cwd: root }),
        updateNotice: async () => { order.push('check'); return null; },
        createJudge: ({ onResult }) => async (request) => {
          order.push(/^code-/.test(request.label ?? '') ? 'code step' : 'session');
          onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
          return judge(request);
        } });
      return { code, ...out.chunks };
    };
    const first = await run('first');
    assert.equal(first.code, 0, first.stderr);
    assert.ok(order.includes('session') && order.includes('code step'), order.join(' '));
    assert.deepEqual([order[0] !== 'check', order.filter((what) => what === 'check').length], [true, 1], 'the first run');
    await rm(join(box.dir, 'state', 'code-pass', 'answers'), { recursive: true, force: true });
    order.length = 0;
    const second = await run('second');
    assert.equal(second.code, 0, second.stderr);
    assert.ok(!order.includes('session'), 'every session answer is stored');
    assert.deepEqual([order[0], order.filter((what) => what === 'check').length], ['code step', 1], order.join(' '));
  });

/** A fake `claude` for the entry's review: `--version`, and the session review's tool-free requests, each answered with
 *  an empty review in the shape Claude Code 2.1.296 prints (as agentic-code-step-cli.test.js's). */
const FAKE_CLAUDE = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') { console.log('2.1.296 (Claude Code)'); process.exit(0); }
const model = args[args.indexOf('--model') + 1];
const served = String(model).replace('[1m]', '');
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
process.stdin.on('data', () => {});
process.stdin.on('end', () => {
  const review = JSON.stringify({ decisions: [], pivots: [], claims: [], requirements: [], failures: [], notClaims: [],
    forbiddenEdits: [] });
  emit({ type: 'system', subtype: 'init', model, claude_code_version: '2.1.296' });
  emit({ type: 'assistant', parent_tool_use_id: null, message: { model: served, role: 'assistant',
    content: [{ type: 'text', text: review }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: review, modelUsage: { [model]: {
    contextWindow: 1000000, maxOutputTokens: 128000, inputTokens: 2, outputTokens: 4 } } });
});
`;

// ---- the installed entry: a cache checked less than a day ago, so no request is made ----------------------------

/** The entry run in a scratch home whose cache says `latest` (none: no cache), with `extra` environment, under the
 *  no-network lookup (`lookups`: the host names it was asked; `ms`: how long the run took). */
async function entry(t, argv, { latest, extra = {}, timeout = 30_000 } = {}) {
  const box = await scratch(t);
  const log = join(box.dir, 'lookups.log');
  const env = { ...box.env, PATH: '/usr/bin:/bin', SONAH_CLAUDE_PROJECTS: join(box.home, 'projects'),
    CODEX_HOME: join(box.home, 'codex'), SONAH_CODEX_BIN: join(box.home, 'absent-codex'), D171_LOOKUP_LOG: log,
    ...extra };
  let cache = null;
  if (latest !== undefined) {
    await mkdir(env.SONAH_HOME, { recursive: true, mode: 0o700 });
    // A minute ago, so the entry reads it as checked today and asks nothing.
    cache = `${JSON.stringify({ checkedAt: new Date(Date.now() - 60_000).toISOString(), latest })}\n`;
    await writeFile(updateCachePath({ env }), cache, { mode: 0o600 });
  }
  const started = performance.now();
  const run = await exec(process.execPath, ['--import', NO_NETWORK, BIN, ...argv], { cwd: box.home, env, timeout })
    .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }));
  const ms = performance.now() - started;
  const after = await readFile(updateCachePath({ env }), 'utf8').catch(() => null);
  const lookups = (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  return { ...run, ms, cache: after, cacheKept: after === cache, lookups,
    files: (await readdir(env.SONAH_HOME).catch(() => [])).sort(), home: box.home };
}

/** A review through the entry, as /sonah's detached review runs it: a fake `claude` on PATH that answers the session
 *  review, a synthetic recording, the page and the .md in a folder of their own. `plain` makes two runs' text
 *  comparable (their folders, the times). */
async function entryReview(t, argv = [], { latest, extra = {}, timeout } = {}) {
  const box = await scratch(t);
  const bin = join(box.dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o700 });
  const recording = join(box.dir, 'recording.jsonl');
  const rows = session({ cwd: box.dir, sessionId: 'sess-d171-entry', version: '2.1.296' })
    .ask('SYNTHETIC_ASK: say hello.').say('SYNTHETIC: hello.').done()
    .map((row) => ({ ...row, timestamp: '2030-01-01T00:00:00.000Z' }));
  await writeFile(recording, `${toJsonl(rows)}\n`);
  const page = join(box.dir, 'review.html');
  const run = await entry(t, ['review', recording, '--no-code-pass', '--state-dir', join(box.dir, 'state'), '--format',
    'html', '--output', page, '--no-open', ...argv], { latest, ...(timeout ? { timeout } : {}),
    extra: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, LANG: 'C.UTF-8', ...extra } });
  const plain = (text) => text.replaceAll(box.dir, 'DIR').replaceAll(run.home, 'HOME')
    .replace(/wall \d+ ms/g, 'wall 0 ms').replace(/\d+(?:\.\d+)? s\b/g, 'N s');
  return { ...run, plain, page: await readFile(page, 'utf8').catch(() => null) };
}

test('option A: no command but review and doctor checks: no request, no file, no line',
  async (t) => {
    // A fresh home (no cache, the check on by default): a check would look the registry up and write update-check.json.
    // A cache checked today that knows 99.0.0: a check would print the line. Neither happens, and the output is the
    // same as with the check off. (`feedback` and `skill add` write their own files in the scratch home. `sonah config`,
    // whose stdout says the setting, has its own test below.)
    const line = UPDATE_NOTICE_WORDS.line('99.0.0', INSTALLED);
    const homeless = (run, text) => text.replaceAll(run.home, 'HOME');
    for (const argv of [['feedback'], ['sessions'], ['decision'], ['slice'], ['hook', 'remove'], ['skill', 'add'],
      ['skill', 'remove']]) {
      const name = argv.join(' ');
      const off = await entry(t, argv, { extra: { SONAH_NO_UPDATE_CHECK: '1' } });
      const fresh = await entry(t, argv);
      assert.deepEqual([fresh.lookups, fresh.cache], [[], null], `${name}: nothing asked, no update-check.json`);
      assert.deepEqual([fresh.code, homeless(fresh, fresh.stdout), homeless(fresh, fresh.stderr), fresh.files],
        [off.code, homeless(off, off.stdout), homeless(off, off.stderr), off.files], `${name}: as with the check off`);
      const cached = await entry(t, argv, { latest: '99.0.0' });
      assert.ok(!cached.stderr.includes(line) && !cached.stdout.includes(line), `${name}: no line`);
      assert.deepEqual([cached.cacheKept, cached.lookups], [true, []], name);
    }
  });

test('the entry: sonah config never checks, so update-check off asks nothing and prints no line in its own run',
  async (t) => {
    // The fix round's case: a fresh home, no cache, the check on by default, and the first command the switch-off.
    const fresh = await entry(t, ['config', 'update-check', 'off']);
    assert.deepEqual([fresh.code, fresh.stderr, fresh.lookups, fresh.files], [0, '', [], [UPDATE_CHECK_SETTING_FILE]]);
    assert.equal(fresh.stdout, `${UPDATE_CHECK_SETTING_WORDS.off(join(fresh.home, '.sonah', UPDATE_CHECK_SETTING_FILE))}\n`);
    assert.equal(fresh.cache, null, 'no update-check.json');
    // A cache checked today that knows a newer version: still no line, after any form of the command.
    for (const argv of [['config'], ['config', 'update-check', 'off'], ['config', 'update-check', 'on'],
      ['config', 'code-pass', 'off'], ['config', 'bogus']]) {
      const run = await entry(t, argv, { latest: '99.0.0' });
      assert.ok(!run.stderr.includes(' is out') && !run.stdout.includes(' is out'), argv.join(' '));
      assert.deepEqual([run.cacheKept, run.lookups], [true, []], argv.join(' '));
    }
  });

test('the entry: a host lookup that never answers ends with the 2-second limit, not with the resolver', async (t) => {
  // D171 fix round: an abort cannot stop the system's lookup, which held the process until the resolver gave up. Here
  // the lookup never answers and holds the process 30 seconds; the run must end by itself soon after the limit. Option
  // A: a review that sends (its check starts with its first request), and doctor once its options are read.
  const off = await entryReview(t, [], { extra: { SONAH_NO_UPDATE_CHECK: '1' } });
  const hung = await entryReview(t, [], { extra: { D171_LOOKUP: 'hang' }, timeout: 20_000 });
  assert.equal(off.code, 0, `${off.stdout}\n${off.stderr}`);
  assert.equal(hung.code, off.code, `ended by itself (${Math.round(hung.ms)} ms)`);
  assert.ok(hung.ms < 12_000, `${Math.round(hung.ms)} ms`);
  assert.deepEqual([hung.plain(hung.stdout), hung.plain(hung.stderr)], [off.plain(off.stdout), off.plain(off.stderr)],
    'the command\'s own output, whole, and no line');
  assert.ok(!hung.page.includes(' is out. Update with '), 'no footer line');
  assert.deepEqual([hung.lookups, off.lookups], [['registry.npmjs.org'], []]);
  assert.equal(JSON.parse(hung.cache).latest, null, 'the failed check is the day\'s check');
  // A lookup that fails at once (no network): the same output, and the process ends as it would anyway.
  const failed = await entryReview(t);
  assert.deepEqual([failed.code, failed.plain(failed.stderr), failed.lookups], [off.code, off.plain(off.stderr),
    ['registry.npmjs.org']]);
  assert.equal(JSON.parse(failed.cache).latest, null);
  // Doctor reads the answer itself; given a usage error it asks nothing.
  const doctorOff = await entry(t, ['doctor', '--no-probe'], { extra: { SONAH_NO_UPDATE_CHECK: '1' } });
  const doctorHung = await entry(t, ['doctor', '--no-probe'], { extra: { D171_LOOKUP: 'hang' }, timeout: 20_000 });
  assert.deepEqual([doctorHung.code, doctorHung.stdout.replaceAll(doctorHung.home, 'HOME'), doctorHung.stderr],
    [doctorOff.code, doctorOff.stdout.replaceAll(doctorOff.home, 'HOME'), doctorOff.stderr]);
  assert.ok(doctorHung.ms < 12_000, `${Math.round(doctorHung.ms)} ms`);
  assert.deepEqual(doctorHung.lookups, ['registry.npmjs.org']);
  assert.equal(JSON.parse(doctorHung.cache).latest, null, 'the failed check is the day\'s check');
});

test('option A through the entry: a dry run, the two refused efforts and doctor\'s refused effort ask nothing',
  async (t) => {
  // A fresh home, the check on by default: a check would look the registry up and write update-check.json.
  const dry = await entryReview(t, ['--dry-run']);
  assert.equal(dry.code, 0, dry.stderr);
  assert.ok(dry.stdout.includes(`\n${DRY_RUN_WORDS.nothing}\n`), 'the dry run says that Sonah sent nothing');
  assert.deepEqual([dry.lookups, dry.cache, dry.files, dry.page], [[], null, [], null], 'dry run');
  for (const [argv, code] of [[['--effort', 'bogus'], 'invalid_effort'],
    [['--backend', 'codex-cli', '--model', 'gpt-6.1-sol', '--effort', 'high'], 'effort_claude_cli_only']]) {
    const stopped = await entryReview(t, argv);
    assert.ok(stopped.stderr.includes(`Fix: ${REVIEW_FIX_WORDS[code]}`), code);
    assert.deepEqual([stopped.code, stopped.lookups, stopped.cache], [2, [], null], code);
  }
  const doctor = await entry(t, ['doctor', '--no-probe', '--effort', 'bogus']);
  assert.ok(doctor.stderr.includes(`Fix: ${REVIEW_FIX_WORDS.invalid_effort}`));
  assert.deepEqual([doctor.code, doctor.lookups, doctor.cache], [2, [], null], 'doctor\'s refused effort');
});

test('option A through the entry: a review whose first call is refused on this computer still checks; CI turns it off',
  async (t) => {
    // No API key for anthropic-api (the call is refused before any request leaves), and no claude on PATH (the
    // call's spawn fails): each is a call to the reviewer, so the check starts with it. The lookup fixture answers
    // ENOTFOUND, so no line, and the failed check is the day's. Nothing is asked of Anthropic: its host is never looked
    // up.
    for (const [name, argv, extra] of [
      ['no API key', ['--backend', 'anthropic-api', '--model', 'claude-sonnet-5-5'], {}],
      ['no claude', [], { PATH: '/usr/bin:/bin' }]]) {
      const off = await entryReview(t, argv, { extra: { ...extra, SONAH_NO_UPDATE_CHECK: '1' } });
      const on = await entryReview(t, argv, { extra });
      assert.notEqual(off.code, 0, `${name}: ${off.stderr}`);
      assert.deepEqual([on.code, on.plain(on.stdout), on.plain(on.stderr)], [off.code, off.plain(off.stdout),
        off.plain(off.stderr)], `${name}: the same output as with the check off`);
      assert.deepEqual([on.lookups, off.lookups], [['registry.npmjs.org'], []], name);
      assert.equal(JSON.parse(on.cache).latest, null, name);
    }
    // CI set at the entry: a review that calls the reviewer asks nothing, writes no cache, and a cache that knows a
    // newer version gives no line and no footer line.
    const ci = await entryReview(t, [], { extra: { CI: 'true' } });
    assert.deepEqual([ci.code, ci.lookups, ci.cache], [0, [], null], `${ci.stdout}\n${ci.stderr}`);
    const known = await entryReview(t, [], { latest: '99.0.0', extra: { CI: 'true' } });
    assert.equal(known.code, 0, known.stderr);
    assert.ok(!known.stderr.includes(' is out') && !known.page.includes(' is out. Update with '), 'no line');
    assert.deepEqual([known.cacheKept, known.lookups], [true, []]);
  });

test('option A through the entry: sonah sessions --github asks GitHub and never checks', async (t) => {
  // The lookup fixture answers GitHub's host with ENOTFOUND, so nothing leaves; the log shows what was asked.
  const argv = ['sessions', '--github', 'synthetic-owner/synthetic-repo', '--pr', '1'];
  const fresh = await entry(t, argv);
  assert.ok(fresh.lookups.includes('api.github.com'), `it asked GitHub: ${fresh.lookups}`);
  assert.ok(!fresh.lookups.includes('registry.npmjs.org'), 'and not npm\'s registry');
  assert.equal(fresh.cache, null, 'no update-check.json');
  const known = await entry(t, argv, { latest: '99.0.0' });
  assert.ok(!known.stderr.includes(' is out') && !known.stdout.includes(' is out'));
  assert.deepEqual([known.cacheKept, known.lookups.includes('registry.npmjs.org')], [true, false]);
});

test('the entry: a /sonah-style review writes the newer version in the page\'s footer, and only there', async (t) => {
  // Through bin/sonah.js, as the detached review that /sonah starts runs: a fake `claude` that answers the session
  // review, a cache checked a minute ago. The page carries the line once; the .md and stdout do not move.
  const box = await scratch(t);
  const bin = join(box.dir, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o700 });
  const recording = join(box.dir, 'recording.jsonl');
  const rows = session({ cwd: box.dir, sessionId: 'sess-d171-footer', version: '2.1.296' })
    .ask('SYNTHETIC_ASK: say hello.').say('SYNTHETIC: hello.').done()
    .map((row) => ({ ...row, timestamp: '2030-01-01T00:00:00.000Z' }));
  await writeFile(recording, `${toJsonl(rows)}\n`);
  const runReview = async (name, latest) => {
    const dir = join(box.dir, name);
    await mkdir(dir);
    const page = join(dir, 'review.html');
    const run = await entry(t, ['review', recording, '--no-code-pass', '--state-dir', join(dir, 'state'), '--format',
      'html', '--output', page, '--no-open'], { latest, extra: { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      LANG: 'C.UTF-8' } });
    return { ...run, page: await readFile(page, 'utf8'), md: await readFile(join(dir, 'review.md'), 'utf8'), dir };
  };
  const same = await runReview('same', INSTALLED);
  const newer = await runReview('newer', '99.0.0');
  assert.equal(same.code, 0, `${same.stdout}\n${same.stderr}`);
  assert.equal(newer.code, 0, `${newer.stdout}\n${newer.stderr}`);
  const line = `<p>${REPORT_FOOTER_WORDS.newer('99.0.0')}</p>`;
  assert.ok(!same.page.includes(line));
  assert.equal(newer.page.split(line).length, 2, 'the page says it once');
  assert.ok(!newer.md.includes('99.0.0') && !same.md.includes('is out'), 'the .md never carries it');
  const plain = (run, text) => text.replaceAll(run.dir, 'DIR').replaceAll(run.home, 'HOME')
    .replace(/wall \d+ ms/g, 'wall 0 ms').replace(/\d+(?:\.\d+)? s\b/g, 'N s');
  assert.equal(plain(newer, newer.stdout), plain(same, same.stdout), 'stdout, byte for byte');
  assert.equal(plain(newer, newer.md), plain(same, same.md), 'the .md, byte for byte');
  assert.ok(newer.stderr.endsWith(`${UPDATE_NOTICE_WORDS.line('99.0.0', INSTALLED)}\n`));
  assert.deepEqual([newer.cacheKept, newer.lookups, same.lookups], [true, [], []]);
});

// ---- the real request, against local servers on 127.0.0.1 (no host lookup, no network) ---------------------------

/** A local HTTP server answering `respond(request, response)`; the requests' headers are kept. */
async function localServer(t, respond) {
  const seen = [];
  const server = http.createServer((request, response) => { seen.push(request.headers); respond(request, response); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}/-/package/getsonah/dist-tags`, seen };
}
const viaHttp = (url) => (_, options) => registryFetch(url, { ...options, get: http.get });

test('registryFetch: a GET with accept only (no user agent), 200 and at most 64 KB, else nothing', async (t) => {
  const answers = { ok: '{"latest":"99.0.0"}', missing: '{"latest":"99.0.0"}', large: `{"latest":"99.0.0"}${
    ' '.repeat(64 * 1024)}`, edge: `{"latest":"99.0.0"}${' '.repeat(64 * 1024 - 19)}` };
  const local = await localServer(t, (request, response) => {
    const kind = new URL(request.url, 'http://x').searchParams.get('kind');
    response.writeHead(kind === 'missing' ? 404 : 200, { 'content-type': 'application/json' });
    response.end(answers[kind]);
  });
  const at = (kind) => `${local.url}?kind=${kind}`;
  assert.equal(await registryFetch(at('ok'), { get: http.get }), answers.ok);
  assert.deepEqual(Object.keys(local.seen[0]).sort(), ['accept', 'connection', 'host'], 'no user agent, cookie or token');
  assert.equal(local.seen[0].accept, 'application/json');
  await assert.rejects(registryFetch(at('missing'), { get: http.get }), { message: 'status' });
  await assert.rejects(registryFetch(at('large'), { get: http.get }), { message: 'too_large' });
  assert.equal((await registryFetch(at('edge'), { get: http.get })).length, 64 * 1024, 'exactly 64 KB is read');
  // Through the check: only the 200 answer gives the version.
  for (const [kind, expected] of [['ok', '99.0.0'], ['missing', null], ['large', null]]) {
    const box = await scratch(t);
    const got = await checkForUpdate({ installed: '0.3.0-beta.9', env: box.env, now: clock().now,
      fetch: viaHttp(at(kind)) });
    assert.equal(got?.latest ?? null, expected, kind);
  }
});

/** A child process that runs `code` (an ES module, `M` the update-check module) and exits by itself, or is killed. */
const child = (code, timeout = 10_000) => exec(process.execPath, ['--input-type=module', '-e',
  `const M = await import(${JSON.stringify(UPDATE_CHECK_MODULE)});\n${code}`], { timeout })
  .then((r) => ({ code: 0, stdout: r.stdout }), (e) => ({ code: e.code, killed: e.killed, stdout: e.stdout ?? '' }));

test('registryFetch: a server that never answers is given up on, and no socket or timer holds the process', async (t) => {
  // A TLS server that accepts and never answers, on 127.0.0.1: the real node:https request, aborted at the limit.
  const sockets = new Set();
  const server = net.createServer((socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { for (const socket of sockets) socket.destroy(); return new Promise((resolve) => server.close(resolve)); });
  const url = `https://127.0.0.1:${server.address().port}/`;
  const box = await scratch(t);
  const home = (name) => JSON.stringify(join(box.dir, name));
  const silent = await child(`const started = performance.now();
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${home('silent')} }, now: () => 0,
  timeoutMs: 300, fetch: (_, options) => M.registryFetch(${JSON.stringify(url)}, options) });
console.log(JSON.stringify({ got, ms: Math.round(performance.now() - started) }));`);
  assert.equal(silent.code, 0, `the child ended by itself (killed: ${silent.killed})`);
  const { got, ms } = JSON.parse(silent.stdout);
  assert.equal(got, null);
  assert.ok(ms >= 250 && ms < 5_000, `${ms} ms`);
  assert.deepEqual(await readUpdateCache({ env: { SONAH_HOME: join(box.dir, 'silent') } }), { checkedAt: 0, latest: null });
  // A quick answer: the limit's timer is cleared, so nothing waits for it.
  const quick = await child(`await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${home('quick')} },
  now: () => 0, fetch: async () => '{"latest":"99.0.0"}' });
console.log(JSON.stringify(process.getActiveResourcesInfo().filter((kind) => kind === 'Timeout')));`);
  assert.deepEqual([quick.code, JSON.parse(quick.stdout)], [0, []], 'no timer left');
  assert.equal((await readUpdateCache({ env: { SONAH_HOME: join(box.dir, 'quick') } })).latest, '99.0.0');
});

test('at most once a day across processes: two commands started at one instant make one request', async (t) => {
  // Each child waits for the same instant, then checks with a fake fetch that logs each request to one file. Before
  // the claim, every round made two.
  for (let round = 0; round < 5; round++) {
    const box = await scratch(t);
    const log = join(box.dir, 'requests.log');
    const start = Date.now() + 500;
    const code = `const { appendFileSync } = await import('node:fs');
await new Promise((resolve) => setTimeout(resolve, Math.max(0, ${start} - Date.now())));
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(box.env.SONAH_HOME)} },
  now: () => ${T0}, fetch: async () => { appendFileSync(${JSON.stringify(log)}, 'request\\n'); return '{"latest":"0.3.0-beta.10"}'; } });
console.log(JSON.stringify(got));`;
    const runs = await Promise.all([child(code), child(code)]);
    assert.deepEqual(runs.map((run) => run.code), [0, 0], `round ${round}`);
    assert.equal((await readFile(log, 'utf8')).split('\n').filter(Boolean).length, 1, `round ${round}: one request`);
    assert.deepEqual(await readUpdateCache({ env: box.env }), { checkedAt: T0, latest: '0.3.0-beta.10' });
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], `round ${round}: no claim is left`);
  }
});

/** The requests a test's fake fetches logged, one line each. */
const logged = async (log) => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);

test('with the real clock: a command whose cache read is held until another kept its check asks nothing', async (t) => {
  // D171 fix round: the clock is read after the cache. Before, a command that read the clock, then the cache only after
  // another command (whose clock read came later) had kept its check, found that check from the future and asked
  // again. Two processes with the real clock (no `now`, as the entry gives none): A's first read of the cache waits
  // until B, started once A waits, has made its whole check.
  for (let round = 0; round < 3; round++) {
    const box = await scratch(t);
    const log = join(box.dir, 'requests.log'), waiting = join(box.dir, 'a.waiting'), done = join(box.dir, 'b.done');
    await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
    await writeFile(updateCachePath({ env: box.env }), cacheText({ checkedAt: Date.now() - 2 * DAY, latest: null }),
      { mode: 0o600 });
    const until = (path) => `{ const end = Date.now() + 5000;
  while (!fs.existsSync(${JSON.stringify(path)}) && Date.now() < end) await new Promise((r) => setTimeout(r, 2)); }`;
    const check = (who) => `const seen = [];
await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(box.env.SONAH_HOME)} },
  fetch: async () => { fs.appendFileSync(${JSON.stringify(log)}, '${who}\\n'); return '{"latest":"0.3.0-beta.10"}'; },
  checked: (what) => seen.push(what) });
console.log(JSON.stringify(seen));`;
    const [a, b] = await Promise.all([child(`const fs = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
const open = fs.promises.open;
let first = true;
fs.promises.open = async (path, ...rest) => {
  if (first && String(path).endsWith('/${UPDATE_CHECK_FILE}')) {
    first = false;
    fs.writeFileSync(${JSON.stringify(waiting)}, '');
    ${until(done)}
  }
  return open(path, ...rest);
};
syncBuiltinESMExports();
${check('A')}`), child(`const fs = await import('node:fs');
${until(waiting)}
await new Promise((r) => setTimeout(r, 5));
${check('B')}
fs.writeFileSync(${JSON.stringify(done)}, '');`)]);
    assert.deepEqual([a.code, b.code], [0, 0], `round ${round}`);
    assert.deepEqual([await logged(log), JSON.parse(a.stdout), JSON.parse(b.stdout)], [['B'], ['cached'], ['fetched']],
      `round ${round}: one request`);
    assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], `round ${round}: no claim is left`);
  }
});

test('a claim that a stopped command left days ago, found by checks started together: one request, nothing left',
  async (t) => {
    // D171 fix round. Each check finds the claim not fresh and renames it over the cache; one rename moves it, and the
    // others, whose rename finds it gone, make no request. 8 checks in one process (one clock), then 4 processes with
    // the real clock started at one instant; 3 rounds each.
    const setup = async (box, at) => {
      const old = { checkedAt: at - 3 * DAY, latest: null };
      await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
      await writeFile(updateCachePath({ env: box.env }), cacheText(old), { mode: 0o600 });
      await writeFile(updateClaimPath(old, { env: box.env }), cacheText({ checkedAt: at - 2 * DAY, latest: null }),
        { mode: 0o600 });
    };
    for (let round = 0; round < 3; round++) {
      const box = await scratch(t);
      await setup(box, T0);
      const reg = registry(), seen = [];
      await Promise.all(Array.from({ length: 8 }, () => checkForUpdate({ installed: '0.3.0-beta.9', env: box.env,
        now: clock().now, fetch: reg.fetch, checked: (what) => seen.push(what) })));
      assert.deepEqual([reg.calls.length, seen.filter((what) => what === 'fetched').length], [1, 1],
        `one process, round ${round}: ${seen}`);
      assert.deepEqual(await readUpdateCache({ env: box.env }), { checkedAt: T0, latest: '0.3.0-beta.10' });
      assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], `one process, round ${round}`);
    }
    for (let round = 0; round < 3; round++) {
      const box = await scratch(t);
      await setup(box, Date.now());
      const log = join(box.dir, 'requests.log');
      const start = Date.now() + 500;
      const code = `const { appendFileSync } = await import('node:fs');
await new Promise((resolve) => setTimeout(resolve, Math.max(0, ${start} - Date.now())));
await M.checkForUpdate({ installed: '0.3.0-beta.9', env: { SONAH_HOME: ${JSON.stringify(box.env.SONAH_HOME)} },
  fetch: async () => { appendFileSync(${JSON.stringify(log)}, 'request\\n'); return '{"latest":"0.3.0-beta.10"}'; } });`;
      const runs = await Promise.all(Array.from({ length: 4 }, () => child(code)));
      assert.deepEqual(runs.map((run) => run.code), [0, 0, 0, 0], `processes, round ${round}`);
      assert.equal((await logged(log)).length, 1, `processes, round ${round}: one request`);
      assert.equal((await readUpdateCache({ env: box.env })).latest, '0.3.0-beta.10');
      assert.deepEqual(await readdir(box.env.SONAH_HOME), [UPDATE_CHECK_FILE], `processes, round ${round}`);
    }
  });

test('a folder that cannot hard-link: link refused, so no request is made there, and nothing is left', async (t) => {
  // FAT, exFAT and many SMB shares refuse link(). The claim cannot be made there, so the check errs on the side of no
  // request (never more than once a day; on such a folder, never). In a child process whose node:fs link refuses with
  // each code, from no cache and from a stale one.
  const stale = cacheText({ checkedAt: T0 - DAY - 1, latest: '0.3.0-beta.9' });
  for (const code of ['EPERM', 'ENOTSUP', 'EXDEV']) {
    for (const before of [null, stale]) {
      const box = await scratch(t);
      if (before) {
        await mkdir(box.env.SONAH_HOME, { recursive: true, mode: 0o700 });
        await writeFile(updateCachePath({ env: box.env }), before, { mode: 0o600 });
      }
      const run = await child(`const fs = await import('node:fs');
const { syncBuiltinESMExports } = await import('node:module');
fs.promises.link = async () => { throw Object.assign(new Error('refused'), { code: ${JSON.stringify(code)} }); };
syncBuiltinESMExports();
let calls = 0;
const seen = [];
const got = await M.checkForUpdate({ installed: '0.3.0-beta.9',
  env: { SONAH_HOME: ${JSON.stringify(box.env.SONAH_HOME)} }, now: () => ${T0},
  fetch: async () => { calls++; return '{"latest":"0.3.0-beta.10"}'; }, checked: (what) => seen.push(what) });
console.log(JSON.stringify({ got, calls, seen }));`);
      const label = `${code}, ${before ? 'a stale cache' : 'no cache'}`;
      assert.equal(run.code, 0, label);
      assert.deepEqual(JSON.parse(run.stdout), { got: null, calls: 0, seen: ['unkept'] }, label);
      assert.deepEqual(await readdir(box.env.SONAH_HOME), before ? [UPDATE_CHECK_FILE] : [], `${label}: nothing left`);
      if (before) assert.equal(await readFile(updateCachePath({ env: box.env }), 'utf8'), before, label);
    }
  }
});

test('lookupPending: the check\'s own lookup is counted until it answers, and the entry\'s end waits for its streams',
  async () => {
    const original = dns.lookup;
    const asked = [];
    const URL_ = 'https://registry.npmjs.org/-/package/getsonah/dist-tags';
    const until = async (ok) => { while (!ok()) await new Promise((resolve) => setImmediate(resolve)); };
    let release;
    try {
      // A stand-in for the system's lookup: it answers only when released, and never reaches the network.
      dns.lookup = (hostname, options, callback) => {
        asked.push(hostname);
        release = () => callback(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
      };
      const answered = registryFetch(URL_);
      await until(() => asked.length === 1);
      assert.equal(lookupPending(), true, 'counted while it runs');
      release();
      await assert.rejects(answered, { code: 'ENOTFOUND' });
      assert.equal(lookupPending(), false, 'not after it answers');
      // Aborted while the lookup runs: the request ends, and the lookup is still counted until it answers.
      const controller = new AbortController();
      const held = registryFetch(URL_, { signal: controller.signal });
      await until(() => asked.length === 2);
      controller.abort();
      await assert.rejects(held, { name: 'AbortError' });
      assert.equal(lookupPending(), true, 'an abort does not end the lookup');
      release();
      assert.equal(lookupPending(), false);
    } finally { dns.lookup = original; }
    assert.deepEqual(asked, ['registry.npmjs.org', 'registry.npmjs.org'], 'the stand-in answered every lookup');
    // The end: each stream's writes handed on, then the exit with the command's code.
    const order = [];
    const stream = (name) => ({ write: (text, done) => {
      order.push(`${name} ${JSON.stringify(text)}`);
      setImmediate(() => { order.push(`${name} handed on`); done(); });
    } });
    const saved = process.exitCode;
    process.exitCode = 1;
    try {
      await endOnceWritten({ streams: [stream('stdout'), stream('stderr')], exit: (code) => order.push(`exit ${code}`) });
    } finally { process.exitCode = saved; }
    assert.deepEqual(order, ['stdout ""', 'stderr ""', 'stdout handed on', 'stderr handed on', 'exit 1']);
  });

test('the entry: --help, --version, the old hooks and review --background never check; doctor says it in its lines',
  async (t) => {
    const line = UPDATE_NOTICE_WORDS.line('99.0.0', INSTALLED);
    for (const argv of [['--version'], ['--help'], ['sessions', '--help'], ['review', '--help'], ['not-a-command'],
      ['review', '--session', '', '--background']]) {
      const run = await entry(t, argv, { latest: '99.0.0' });
      assert.ok(!run.stderr.includes(line) && !run.stdout.includes(line), argv.join(' '));
      assert.ok(run.cacheKept, argv.join(' '));
    }
    // review --background: its one line on stdout, which the agent repeats word for word, and nothing on stderr.
    const background = await entry(t, ['review', '--session', '', '--background'], { latest: '99.0.0' });
    const backgroundOff = await entry(t, ['review', '--session', '', '--background'],
      { extra: { SONAH_NO_UPDATE_CHECK: '1' } });
    assert.deepEqual([background.code, background.stdout, background.stderr],
      [backgroundOff.code, backgroundOff.stdout, '']);
    // doctor: its own line before the last, no stderr line, the same exit code.
    const off = await entry(t, ['doctor', '--no-probe'], { extra: { SONAH_NO_UPDATE_CHECK: '1' } });
    const newer = await entry(t, ['doctor', '--no-probe'], { latest: '99.0.0' });
    const lines = off.stdout.replaceAll(off.home, 'HOME').trimEnd().split('\n');
    assert.equal(newer.stdout.replaceAll(newer.home, 'HOME'), `${[...lines.slice(0, -1),
      UPDATE_NOTICE_WORDS.doctor('99.0.0', INSTALLED), lines.at(-1)].join('\n')}\n`);
    assert.deepEqual([newer.code, newer.stderr], [off.code, off.stderr]);
  });

// No test reaches npm's registry: every test that runs the CLI's entry turns the check off (or, here, hands it a cache
// checked today). Read from the test files' own text: a file that names the entry and starts a process sets the switch.
test('every test that runs the entry turns the update check off', async () => {
  const offenders = [];
  for (const pkg of await readdir(join(ROOT, 'packages'))) {
    const dir = join(ROOT, 'packages', pkg, 'test');
    for (const name of await readdir(dir).catch(() => [])) {
      if (!name.endsWith('.test.js') || name === 'd171-update-check.test.js') continue;
      const text = await readFile(join(dir, name), 'utf8');
      // The entry as an argument list's first item (`[BIN, …]`), or the installed command by its path.
      const names = /\[\s*BIN\b|'bin', 'sonah(?:\.js)?'\)/.test(text);
      const starts = /\b(?:execFile|execFileSync|spawn|spawnSync)\b/.test(text);
      if (names && starts && !text.includes('SONAH_NO_UPDATE_CHECK')) offenders.push(`${pkg}/test/${name}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('a library call makes no request: the commands default to no notice', async (t) => {
  // runSessionReviewCommand and doctor are given no update check unless the entry passes one (above: the same bytes).
  const box = await scratch(t);
  const plain = await doctorRun(box);
  assert.equal(plain.facts.newer, null);
  assert.deepEqual(await readdir(box.env.SONAH_HOME).catch(() => []), []);
});
