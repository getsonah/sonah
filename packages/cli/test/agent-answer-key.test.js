// The agent transport's answer key (answer-cache.js): an agent request is keyed by its argv less paths and system prompt,
// the agent transport's version and the repository's state; every session request is keyed byte for byte as before.
// Every byte here is synthetic; each test gets its own temporary folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { REVIEW_AGENT_TRANSPORT_VERSION, agentRequestOf, agentRunRecord, reviewAgentCliArgs, reviewAgentKeyArgs }
  from '../src/review-judge.js';
import { ANSWER_CACHE_VERSION, REPO_STATE, answerKey, createAnswerCache, memoizeJudge } from '../src/answer-cache.js';
import { PROBE_REQUEST } from '../src/review-probe.js';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { ANSWER, MODEL, OTHER_STATE, PROMPT, SCHEMA, STATE, SYSTEM, repository, scratch } from './agent-transport-fixture.js';

// ---- the answer key ----------------------------------------------------------------------------------------------
test('agent transport: every session request\'s answer key is byte for byte the one computed before the agent transport',
() => {
  // Computed at f826aee, before the agent transport, by the same calls.
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const pinned = [
    [PROBE_REQUEST, { backend: 'claude-cli', model: SESSION_REVIEW_CLAUDE_CLI_MODEL },
      '988ea414f3ae5d1ff980bdba2a5a10d7f1aa19aa6e42fa8383684f076343de0c'],
    [{ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', label: 'narrative:w1' }, { backend: 'claude-cli', model: 'sonnet' },
      '6c18e28eed6682f68b4b1c72da18e4366cbe354ea4a5e372f28eab132cc5ec47'],
    [{ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P', images: [{ mediaType: 'image/png', data: png }] },
      { backend: 'claude-cli', model: 'claude-sonnet-5-5[1m]' }, '2152496d77b5fa663218a0c9974b682e9cb427583973b243e41a10ecfb0d77ca'],
    [{ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' }, { backend: 'codex-cli', model: 'gpt-6.1-sol' },
      '9ec1846021eed72374d1000649e2d99b010969ff0d56038b4ce49c26bea31025'],
    [{ system: 'SYNTHETIC_S', prompt: 'SYNTHETIC_P' }, { backend: 'anthropic-api', model: 'claude-sonnet-5-5' },
      '36f4fd801d5346aea05a1909255143478eca48e87e2fd43ca79d1060e00ef841'],
  ];
  for (const [request, identity, key] of pinned) {
    assert.equal(answerKey(request, identity), key, `${identity.backend} ${request.label ?? ''}`);
    assert.equal(answerKey(request, { ...identity, repoState: STATE }), key, 'a repository state moves no session key');
  }
});

test('agent transport: an agent request\'s key binds its argv less paths and system prompt, the agent transport version '
  + 'and the repository state; it is never a session key', async (t) => {
  const { request } = await repository(t);
  const identity = { backend: 'claude-cli', model: MODEL, repoState: STATE };
  const key = answerKey(request, identity);
  const agent = agentRequestOf(request);
  const argv = reviewAgentCliArgs({ system: SYSTEM, model: MODEL, agent, schema: SCHEMA });
  assert.equal(key, createHash('sha256').update(JSON.stringify({ v: ANSWER_CACHE_VERSION,
    transport: REVIEW_AGENT_TRANSPORT_VERSION, backend: 'claude-cli', model: MODEL, agent: reviewAgentKeyArgs(argv),
    system: SYSTEM, prompt: PROMPT, repo: STATE })).digest('hex'));
  assert.ok(REPO_STATE.test(STATE));
  // A moved checkout (another root and --add-dir path), its own timeout, its label: the same key.
  const moved = await scratch(t, 'moved');
  for (const same of [{ agent: { ...request.agent, root: moved, addDirs: [dirname(moved)] } },
    { agent: { ...request.agent, timeoutMs: 1000 } }, { label: 'code-verify:F1' }])
    assert.equal(answerKey({ ...request, ...same }, identity), key, JSON.stringify(same));
  // Everything the agent is asked with, and the repository it reads: another key.
  for (const [changed, other] of [[{ agent: { ...request.agent, maxTurns: 41 } }, identity],
    [{ agent: { ...request.agent, addDirs: [] } }, identity], [{ schema: { ...SCHEMA, required: [] } }, identity],
    [{ system: `${SYSTEM} ` }, identity], [{ prompt: `${PROMPT}\n` }, identity], [{}, { ...identity, model: 'claude-other-5-5' }],
    [{}, { ...identity, repoState: OTHER_STATE }]])
    assert.notEqual(answerKey({ ...request, ...changed }, other), key, JSON.stringify(changed));
  // The same system and prompt sent as a session request is another question.
  assert.notEqual(answerKey({ system: SYSTEM, prompt: PROMPT }, identity), key);
  // No key, so never looked up or stored: no repository state, another backend, a malformed agent, images.
  for (const [changed, other] of [[{}, { ...identity, repoState: null }], [{}, { ...identity, repoState: 'A'.repeat(64) }],
    [{}, { ...identity, backend: 'codex-cli' }], [{}, { ...identity, backend: 'anthropic-api' }],
    [{ agent: { ...request.agent, maxTurns: 0 } }, identity], [{ schema: undefined }, identity],
    [{ images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }, identity]])
    assert.equal(answerKey({ ...request, ...changed }, other), null, JSON.stringify([changed, other.backend, other.repoState]));
});

test('agent transport: a stored agent answer replays for the same request and repository state, from a moved checkout '
  + 'too; another state is asked again; with no state nothing is stored or replayed', async (t) => {
  const { request } = await repository(t);
  const store = await scratch(t, 'answers');
  const identity = { backend: 'claude-cli', model: MODEL };
  let calls = 0;
  // An agent answer carries its run record, as the transport sets it (D105: one without it is never stored).
  const answering = async () => { calls++; return withRun({ exports: ['a'] }); };
  const first = memoizeJudge(answering, createAnswerCache(store, { ...identity, repoState: STATE }));
  assert.deepEqual(await first(request), ANSWER);
  assert.equal(calls, 1);
  const again = memoizeJudge(answering, createAnswerCache(store, { ...identity, repoState: STATE }));
  assert.deepEqual(await again(request), ANSWER);
  assert.deepEqual(again.answers, { calls: 0, reused: 1 });
  // The next review, from a checkout moved elsewhere (another root and --add-dir path), same repository state.
  const moved = await scratch(t, 'moved');
  const fromMoved = memoizeJudge(answering, createAnswerCache(store, { ...identity, repoState: STATE }));
  assert.deepEqual(await fromMoved({ ...request, agent: { ...request.agent, root: moved, addDirs: [dirname(moved)] } }),
    ANSWER);
  assert.deepEqual(fromMoved.answers, { calls: 0, reused: 1 });
  assert.equal(calls, 1, 'the same request and state are not asked again');
  const changed = memoizeJudge(answering, createAnswerCache(store, { ...identity, repoState: OTHER_STATE }));
  await changed(request);
  assert.equal(calls, 2, 'another repository state is another question');
  const stored = (await readdir(store)).length;
  const stateless = memoizeJudge(answering, createAnswerCache(store, identity));
  await stateless(request); await stateless(request);
  assert.equal(calls, 4, 'with no repository state an agent request is always asked');
  assert.equal((await readdir(store)).length, stored, 'and never stored');
  assert.deepEqual(stateless.answers, { calls: 2, reused: 0 });
  for (const repoState of ['', 'a'.repeat(63), 'A'.repeat(64), 7, {}])
    assert.throws(() => createAnswerCache(store, { ...identity, repoState }), TypeError, String(repoState));
});

// ---- D105: the reading record is stored with the answer and set on it again on replay ---------------------------------
/** A run record as the agent transport /2 sets it on an answer: not enumerable, with what it read. */
const RUN = Object.freeze({ numTurns: 4, toolCalls: { Read: 2, Grep: 1, Glob: 0, StructuredOutput: 1 },
  reads: ['/repo/pkg/a.js', '/repo/pkg/b.png'], readRanges: [{ path: '/repo/pkg/a.js', startLine: 125, numLines: 80,
    totalLines: 423 }], readsUnranged: 1, readsUnrangedPaths: ['/repo/pkg/b.png'],
  readsFailed: [{ path: '/repo/pkg/gone.js', reason: 'failed' }, { path: '/etc/hosts', reason: 'refused' }],
  permissionDenials: 0, durationMs: 10, costUsd: 0.01, usage: { input_tokens: 1 } });
function withRun(answer, run = RUN) {
  return Object.defineProperty(answer, 'agentRun', { value: structuredClone(run), enumerable: false });
}

test('D105: an agent answer is stored with its reading record and replays with it, set again, not enumerable; one '
  + 'without a record is never stored, and a stored one without it is a miss; a session answer\'s record is as before',
async (t) => {
  const { request } = await repository(t);
  const store = await scratch(t, 'answers-run');
  const identity = { backend: 'claude-cli', model: MODEL, repoState: STATE };
  // Stored with its record (paths and counts only), and replayed with it.
  const cache = createAnswerCache(store, identity);
  assert.equal(await cache.put(request, withRun({ exports: ['a'] })), true);
  const [name] = await readdir(store);
  const record = JSON.parse(await readFile(join(store, name), 'utf8'));
  assert.deepEqual(Object.keys(record), ['key', 'occurrence', 'response', 'run']);
  assert.deepEqual(record.run, agentRunRecord(RUN));
  assert.deepEqual(Object.keys(record.run), ['numTurns', 'toolCalls', 'reads', 'readRanges', 'readsUnranged',
    'readsUnrangedPaths', 'readsFailed'],
    'no duration, cost or usage');
  assert.deepEqual(record.run.readsFailed, RUN.readsFailed, 'the Reads that read nothing, apart: paths and reasons');
  const replayed = await createAnswerCache(store, identity).get(request);
  assert.deepEqual(replayed, { exports: ['a'] });
  assert.deepEqual(Object.keys(replayed), ['exports'], 'not enumerable');
  assert.deepEqual(replayed.agentRun, agentRunRecord(RUN));
  // A live agent answer with no record (or a record of /1, with no ranges) is not stored.
  const bare = await scratch(t, 'answers-bare');
  const { readRanges: _r, readsUnranged: _u, ...older } = RUN;
  // Nor one whose record does not keep the paths of its Reads with no range: a reader would call those files unseen.
  const { readsUnrangedPaths: _p, ...unnamed } = RUN;
  // Nor one that does not keep its failed Reads apart, or names a reason outside the closed list (CODE_READ_FAILURES).
  const { readsFailed: _f, ...unfailed } = RUN;
  const unreasoned = { ...RUN, readsFailed: [{ path: '/repo/pkg/gone.js', reason: 'too_large' }] };
  const texted = { ...RUN, readsFailed: [{ path: '/repo/pkg/gone.js', reason: 'failed', text: 'File does not exist.' }] };
  for (const answer of [{ exports: ['a'] }, withRun({ exports: ['a'] }, older), withRun({ exports: ['a'] }, unnamed),
    withRun({ exports: ['a'] }, unfailed), withRun({ exports: ['a'] }, unreasoned), withRun({ exports: ['a'] }, texted)])
    assert.equal(await createAnswerCache(bare, identity).put(request, answer), false);
  assert.deepEqual(await readdir(bare), []);
  // A stored agent record without its run (or with one that is not a record) is a miss: asked again live.
  for (const run of [undefined, { ...agentRunRecord(RUN), readRanges: [{ path: 'x', startLine: 0, numLines: 1,
    totalLines: 1 }] }]) {
    const { run: _run, ...rest } = record;
    await writeFile(join(store, name), JSON.stringify(run === undefined ? rest : { ...rest, run }), { mode: 0o600 });
    assert.equal(await createAnswerCache(store, identity).get(request), null);
  }
  // A session request's stored record holds no run, and is read as before.
  const session = await scratch(t, 'answers-session');
  const sessionRequest = { system: SYSTEM, prompt: PROMPT, schema: SCHEMA };
  assert.equal(await createAnswerCache(session, identity).put(sessionRequest, withRun({ exports: ['a'] })), true);
  const [sessionName] = await readdir(session);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(join(session, sessionName), 'utf8'))), ['key', 'occurrence',
    'response']);
  assert.equal((await createAnswerCache(session, identity).get(sessionRequest)).agentRun, undefined);
});
