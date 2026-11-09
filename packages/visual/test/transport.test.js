// Layer 2 calls and replay: the claude transport against a stand-in CLI (no real call), and answerAll.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TransportError, claudeArgs, claudeEnv, claudeTransport } from '../src/transport-claude.mjs';
import { answerAll, answerStore, lastJsonObject, stopOf } from '../src/answers.mjs';
import { functionRequests, findingsRequest } from '../src/requests.mjs';
import { checkFunctions } from '../src/checks.mjs';

const FAKE = join(dirname(fileURLToPath(import.meta.url)), 'fake-claude.mjs');
let scratch;
before(() => { chmodSync(FAKE, 0o755); scratch = mkdtempSync(join(tmpdir(), 'sonah-visual-test-')); });
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
/** A fresh HOME for the fake CLI with its rules; returns the env to pass and a reader of its call log. */
function fakeHome(rules, extraEnv = {}) {
  const dir = mkdtempSync(join(scratch, 'home-'));
  writeFileSync(join(dir, 'fake-claude.json'), JSON.stringify({ rules }));
  const env = { PATH: process.env.PATH, HOME: dir, ...extraEnv };
  const calls = () => (existsSync(join(dir, 'fake-claude.log.jsonl'))
    ? readFileSync(join(dir, 'fake-claude.log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { env, calls, dir };
}

const request = (prompt = 'Say hello as JSON.') => ({ id: 'a'.repeat(64), kind: 'functions', system: 'You answer in JSON.', prompt, ids: {} });

// Made-up facts in the contract's shape, two functions.
function smallFacts() {
  const fn = (name, n) => ({ id: `src/m.py#${name}`, path: 'src/m.py', name, kind: 'callable', status: 'changed', line: n,
    span: [n, n + 3], oldLine: n, added: 1, removed: 1, definition: `def ${name}(x):`, commentOnly: false,
    diff: [[' ', n, n, `def ${name}(x):`], ['-', n + 1, null, '    return x'], ['+', null, n + 1, `    return x * ${n}`]],
    callers: { count: 1, list: [] }, tests: [], fold: null });
  const fns = [fn('scale', 3), fn('shift', 9)];
  return { v: 1, repo: { name: 'tiny' }, range: { base: '1'.repeat(40), head: '2'.repeat(40), commits: [{ sha: '3'.repeat(40), subject: 'Scale values', body: '' }] },
    stats: { files: 1, added: 2, removed: 2, functions: 2, newFunctions: 0, changedFunctions: 2, removedFunctions: 0 },
    groups: [], files: [{ path: 'src/m.py', status: 'modified', role: 'source', lang: 'py', added: 2, removed: 2, functions: fns.map((f) => f.id) }],
    functions: fns, mentions: [], route: { read: [{ path: 'src/m.py', lines: 4 }], skim: [], skip: [], lines: { read: 4, skim: 0, skip: 0 } } };
}
const GOOD = JSON.stringify({ functions: [{ id: 'f1', summary: 'Multiplies a value by three.', change: 'Now multiplies instead of returning it as is.' },
  { id: 'f2', summary: 'Multiplies a value by nine.', change: 'Now multiplies instead of returning it as is.' }] });

// ------------------------------------------------------------------------------------------------- transport

test('argv is the session-call argv; --effort only when given', () => {
  assert.deepEqual(claudeArgs({ system: 'S', model: 'sonnet' }), ['--print', '--model', 'sonnet', '--output-format',
    'stream-json', '--verbose', '--tools', '', '--disable-slash-commands', '--setting-sources', '', '--mcp-config',
    '{"mcpServers":{}}', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', 'S']);
  assert.deepEqual(claudeArgs({ system: 'S', model: 'opus', effort: 'high' }).slice(0, 5), ['--print', '--model', 'opus', '--effort', 'high']);
});

test('environment: clean, with the account and Sonah settings, no other CLAUDE_* of the parent', () => {
  const env = claudeEnv({ HOME: '/h', PATH: '/p', ANTHROPIC_API_KEY: 'test-only-key', CLAUDECODE: '1',
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '7', CLAUDE_CODE_ENTRYPOINT: 'cli', ANTHROPIC_BASE_URL: 'http://elsewhere', OTHER: 'x',
    FORCE_PROMPT_CACHING_5M: '0' });
  assert.equal(env.HOME, '/h');
  assert.equal(env.ANTHROPIC_API_KEY, 'test-only-key');
  assert.equal(env.FORCE_PROMPT_CACHING_5M, '1');
  assert.equal(env.CLAUDE_CODE_SAFE_MODE, '1');
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS', 'CLAUDE_CODE_ENTRYPOINT', 'ANTHROPIC_BASE_URL', 'OTHER'])
    assert.ok(!(k in env), `${k} must not reach the CLI`);
});

test('a call sends the prompt on stdin, the system prompt in argv, and returns text, served model, cost and time', async () => {
  const { env, calls } = fakeHome([{ mode: 'ok', text: 'Sure: {"ok": true}', cost: 0.042 }], { CLAUDECODE: '1', CLAUDE_CODE_MAX_OUTPUT_TOKENS: '7' });
  const t = claudeTransport({ bin: FAKE, env });
  const out = await t(request('the prompt\nwith two lines'));
  assert.equal(out.text, 'Sure: {"ok": true}');
  assert.equal(out.model, 'claude-sonnet-test');
  assert.equal(out.costUsd, 0.042);
  assert.ok(Number.isFinite(out.ms) && out.ms >= 0);
  const [call] = calls();
  assert.deepEqual(call.argv, claudeArgs({ system: 'You answer in JSON.', model: 'sonnet' }));
  assert.equal(call.stdin, 'the prompt\nwith two lines');
  assert.equal(call.env.FORCE_PROMPT_CACHING_5M, '1');
  assert.ok(!('CLAUDECODE' in call.env) && !('CLAUDE_CODE_MAX_OUTPUT_TOKENS' in call.env));
  assert.notEqual(call.cwd, process.cwd());
  assert.ok(!existsSync(call.cwd), 'the private working folder is removed after the call');
  assert.equal(t.by, 'claude-cli');
});

test('failures are typed: usage limit, auth, busy provider, exit, no result', async () => {
  const cases = [['usage_limit', 'usage_limit'], ['auth', 'auth'], ['overloaded', 'provider_busy'], ['exit', 'call_failed'],
    ['no_result', 'call_failed']];
  for (const [mode, kind] of cases) {
    const { env } = fakeHome([{ mode }]);
    await assert.rejects(claudeTransport({ bin: FAKE, env })(request()),
      (e) => e instanceof TransportError && e.kind === kind, `${mode} -> ${kind}`);
  }
});

test('a hung call stops at the timeout; too much output stops at the bound; a missing CLI is its own kind', async () => {
  const hang = fakeHome([{ mode: 'hang' }]);
  await assert.rejects(claudeTransport({ bin: FAKE, env: hang.env, timeoutMs: 300 })(request()),
    (e) => e instanceof TransportError && e.kind === 'timeout');
  const loud = fakeHome([{ mode: 'ok', text: 'x'.repeat(5000) }]);
  await assert.rejects(claudeTransport({ bin: FAKE, env: loud.env, maxOutputBytes: 1000 })(request()),
    (e) => e instanceof TransportError && e.kind === 'output_limit');
  await assert.rejects(claudeTransport({ bin: join(scratch, 'no-such-cli'), env: { PATH: process.env.PATH } })(request()),
    (e) => e instanceof TransportError && e.kind === 'cli_missing');
});

// ---------------------------------------------------------------------------------------------------- answers

test('lastJsonObject: the last object, past prose, fences, braces in strings and stray braces', () => {
  assert.deepEqual(lastJsonObject('First {"a":1} then {"b":"}{"}.'), { b: '}{' });
  assert.deepEqual(lastJsonObject('Note { not json.\n```json\n{"c": [1, {"d": 2}]}\n```\nDone.'), { c: [1, { d: 2 }] });
  assert.equal(lastJsonObject('no object here [1,2]'), null);
  assert.equal(lastJsonObject(null), null);
});

test('answerAll with the CLI: an unparsable reply is asked once more with the problem; both are stored and replay', async () => {
  const { env, calls } = fakeHome([
    { when: 'could not be used', mode: 'ok', text: `Here it is:\n${GOOD}`, cost: 0.02 },
    { mode: 'ok', text: 'I looked at both functions and they look fine.', cost: 0.01 },
  ]);
  const store = answerStore(join(scratch, `answers${++n}`));
  const reqs = functionRequests(smallFacts());
  const seen = [];
  const [r] = await answerAll(reqs, { transport: claudeTransport({ bin: FAKE, env }), store, onRequest: (q) => seen.push(q.id) });
  assert.equal(r.error, null);
  assert.equal(r.id, reqs[0].id);
  assert.deepEqual(r.answer.functions.map((e) => e.id), ['src/m.py#scale', 'src/m.py#shift']);
  assert.equal(r.by, 'claude-cli');
  assert.equal(r.model, 'claude-sonnet-test');
  assert.equal(r.costUsd, 0.03);
  assert.equal(r.attempts.length, 2);
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
  const second = calls()[1].stdin;
  assert.match(second, /Your previous answer could not be used:\n- no JSON object was found in the answer/);
  assert.equal(readdirSync(store.dir).length, 2);
  const stored = store.get(seen[1]);
  assert.equal(stored.by, 'claude-cli');
  assert.equal(stored.costUsd, 0.02);
  assert.equal(stored.retryOf, seen[0]);

  // Replay: nothing is asked, the same answer comes back.
  const never = async () => { throw new Error('no call on replay'); };
  const [again] = await answerAll(reqs, { transport: never, store });
  assert.deepEqual(again.answer, r.answer);
  assert.equal(again.replayed, true);
  assert.equal(again.costUsd, 0.03);
  assert.equal(calls().length, 2);
});

test('a text one word over its limit is asked once more for that field only; the fix is merged and replays', async () => {
  const over = 'Multiplies the value it is given by three and then returns the result'; // 13 words
  const thrice = [over, over, over].join(' '); // 39 words
  const first = JSON.stringify({ functions: [{ id: 'f1', summary: over, change: 'Now multiplies instead of returning it as is.' },
    { id: 'f2', summary: 'Multiplies a value by nine.', change: thrice }] }); // f2's change is 39 words
  const fix = JSON.stringify({ fields: { 'f1.summary': 'Multiplies the value by three.', 'f2.change': thrice } });
  const { env, calls } = fakeHome([
    { when: 'which are over their limits', mode: 'ok', text: fix, cost: 0.005 },
    { mode: 'ok', text: first, cost: 0.02 },
  ]);
  const store = answerStore(join(scratch, `answers${++n}`));
  const reqs = functionRequests(smallFacts());
  const [r] = await answerAll(reqs, { transport: claudeTransport({ bin: FAKE, env }), store });
  assert.equal(r.error, null);
  assert.equal(r.attempts.length, 2);
  assert.deepEqual(r.limits, { over: 2, fixed: 1 });
  assert.equal(r.answer.functions[0].summary, 'Multiplies the value by three.');
  assert.equal(r.answer.functions[1].change, thrice, 'a field still over its limit keeps the first text for the checks to drop');
  assert.equal(r.answer.functions[1].summary, 'Multiplies a value by nine.', 'fields that passed are kept from the first answer');
  assert.ok(Math.abs(r.costUsd - 0.025) < 1e-9);
  const asked = calls()[1].stdin;
  assert.ok(asked.startsWith(calls()[0].stdin), 'the re-ask keeps the first prompt as its prefix');
  assert.ok(asked.includes(`- "f1.summary": 13 words, at most 12; write it in 9 words or fewer: "${over}"`));
  assert.ok(asked.includes('- "f2.change": 39 words, at most 30; write it in 22 words or fewer:'));
  assert.ok(!asked.includes('"f2.summary"'), 'only the failing fields are listed');
  const { value, dropped } = checkFunctions(smallFacts(), [r]);
  assert.equal(value['src/m.py#scale'].summary, 'Multiplies the value by three.');
  assert.equal(value['src/m.py#shift'].change, null);
  assert.deepEqual(dropped.map((d) => d.reason), ['over_word_limit']);

  // Replay: nothing is asked, the merged answer comes back the same.
  const never = async () => { throw new Error('no call on replay'); };
  const [again] = await answerAll(reqs, { transport: never, store });
  assert.deepEqual(again.answer, r.answer);
  assert.equal(calls().length, 2);
});

test('replay only: a missing answer is pending; a stand-in record with stable ids is used', async () => {
  const store = answerStore(join(scratch, `answers${++n}`));
  const reqs = functionRequests(smallFacts());
  const [pending] = await answerAll(reqs, { transport: null, store });
  assert.equal(pending.error, 'pending');
  assert.equal(pending.answer, null);
  store.put(reqs[0].id, { id: reqs[0].id, kind: 'functions', by: 'stand-in', model: 'stand-in', ms: 0, costUsd: 0,
    answer: { functions: [{ id: 'src/m.py#scale', summary: 's', change: 'c' }, { id: 'f2', summary: 's', change: 'c' }] } });
  const [r] = await answerAll(reqs, { transport: null, store });
  assert.equal(r.error, null);
  assert.equal(r.by, 'stand-in');
  assert.deepEqual(r.answer.functions.map((e) => e.id), ['src/m.py#scale', 'src/m.py#shift']);
});

test('an answer that fails twice abstains as answer_invalid; a usable first answer survives a broken re-ask', async () => {
  const facts = smallFacts();
  const reqs = functionRequests(facts);
  const bad = async () => ({ text: 'nothing useful', model: 'm', costUsd: 0.01, ms: 1 });
  const [r] = await answerAll(reqs, { transport: bad, store: answerStore(join(scratch, `answers${++n}`)) });
  assert.equal(r.error, 'answer_invalid');
  assert.equal(r.answer, null);
  assert.equal(r.attempts.length, 2);

  let calls = 0;
  const partial = async () => (++calls === 1
    ? { text: '{"functions":[{"id":"f1","summary":"s","change":"c"}]}', model: 'm', costUsd: 0.01, ms: 1 }
    : { text: 'still nothing', model: 'm', costUsd: 0.01, ms: 1 });
  const [kept] = await answerAll(reqs, { transport: partial, store: answerStore(join(scratch, `answers${++n}`)) });
  assert.equal(kept.error, null);
  assert.deepEqual(kept.answer.functions.map((e) => e.id), ['src/m.py#scale']);
  assert.deepEqual(kept.problems, ['no entry for: f2']);
});

test('at most three calls at a time; results keep request order', async () => {
  const reqs = Array.from({ length: 10 }, (_, i) => findingsRequest({ ...smallFacts(), repo: { name: `r${i}` } }));
  let inFlight = 0, most = 0;
  const slow = async (q) => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise((res) => setTimeout(res, 15));
    inFlight--;
    return { text: '{"findings":[]}', model: 'm', costUsd: 0, ms: 15, by: 'stand-in' };
  };
  const out = await answerAll(reqs, { transport: slow, store: answerStore(join(scratch, `answers${++n}`)) });
  assert.equal(most, 3);
  assert.deepEqual(out.map((r) => r.id), reqs.map((q) => q.id));
  assert.ok(out.every((r) => r.error === null && r.by === 'stand-in'));
});

test('a usage limit stops new calls: the rest are pending and the job can say why', async () => {
  const { env, calls } = fakeHome([{ mode: 'usage_limit' }]);
  const reqs = Array.from({ length: 4 }, (_, i) => findingsRequest({ ...smallFacts(), repo: { name: `r${i}` } }));
  const out = await answerAll(reqs, { transport: claudeTransport({ bin: FAKE, env }), store: answerStore(join(scratch, `answers${++n}`)),
    concurrency: 1 });
  assert.equal(out[0].error, 'usage_limit');
  assert.deepEqual(out.slice(1).map((r) => r.error), ['pending', 'pending', 'pending']);
  assert.equal(calls().length, 1);
  assert.equal(stopOf(out), 'usage_limit');
});
