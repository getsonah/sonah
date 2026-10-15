// D78. A challenge reply that is a bare list of votes is read as the batch's `votes` (the model's most common
// unreadable reply was the votes list without its object). Structure only: a challenge request, a non-empty list
// whose every element is a vote of the request's own schema for one of the batch's own keys. Any other list stays
// unreadable.
//
// Every child, stream and request here is invented; every spawn and fetch is a fake. No model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { answerOf, createReviewJudge } from '../src/review-judge.js';
import { answerStorable } from '../src/answer-cache.js';
import { CHALLENGE_SCHEMA } from '../../evidence/src/challenge.js';

const MODEL = 'claude-synthetic-5-5';
const CLI = { backend: 'claude-cli', model: MODEL };
const ENV = { HOME: '/synthetic', PATH: '/bin' };
const bytes = { system: 'SYNTHETIC_SYSTEM', prompt: 'SYNTHETIC_PROMPT' };
const narrative = { ...bytes, label: 'narrative:w1', window: { index: 0 }, evidencePrompt: 'SYNTHETIC_EVIDENCE' };
const items = [{ key: 'k1' }, { key: 'k2' }];
const batch = { ...bytes, label: 'challenge:w1:b1:p1', schema: CHALLENGE_SCHEMA,
  challenge: { items, pass: 1, batchIndex: 0 } };
const votes = [{ key: 'k1', verdict: 'not-refuted', explanation: 'synthetic', receipts: [] },
  { key: 'k2', verdict: 'refuted', explanation: 'synthetic', receipts: [] }];

/** A fake child that prints `events` as stream lines and exits 0 (the claude CLI's and Codex's shape alike). */
function fakeChild(events) {
  const spawns = [];
  const spawnProcess = (command, args, options) => {
    spawns.push({ command, args, env: options.env });
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { setImmediate(() => child.emit('close', null, null)); return true; };
    child.stdin.resume();
    child.stdin.on('end', () => setImmediate(() => {
      child.stdout.write(events.map((event) => `${JSON.stringify(event)}\n`).join(''));
      setImmediate(() => child.emit('close', 0, null));
    }));
    return child;
  };
  return { spawnProcess, spawns };
}
const claudeReply = (text) => [{ type: 'system', subtype: 'init', model: MODEL, session_id: 'synthetic' },
  { type: 'assistant', parent_tool_use_id: null,
    message: { model: MODEL, role: 'assistant', content: [{ type: 'text', text }] } },
  { type: 'result', subtype: 'success', is_error: false, api_error_status: null, result: text, num_turns: 1,
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }];
const codexReply = (text) => [{ type: 'thread.started', thread_id: 'synthetic' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'answer', type: 'agent_message', text } },
  { type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } }];
const outcome = async (judge, request) => {
  try { return { answer: await judge(request) }; } catch (error) { return { error }; }
};

test('D78 answerOf: an object as it came; a bare list as votes only of the schema, for the batch\'s own keys', () => {
  assert.deepEqual(answerOf({ votes }, batch), { votes });
  assert.deepEqual(answerOf({ claims: [] }, narrative), { claims: [] });
  assert.deepEqual(answerOf(votes, batch), { votes });
  assert.equal(answerOf(votes, narrative), null, 'a list on a narrative request is no answer');
  assert.equal(answerOf(votes, { ...batch, challenge: null }), null, 'nor on a request without a challenge record');
  assert.equal(answerOf([], batch), null, 'an empty list is no answer');
  for (const list of [[1, 2], ['k1'], [votes[0], null], [votes[0], [votes[1]]]])
    assert.equal(answerOf(list, batch), null, `a list holding a non-object: ${JSON.stringify(list)}`);
  // Only votes of the request's own schema for the batch's own keys: a foreign key, a field the schema does not have,
  // or a required field left out keeps the whole list unreadable (retried and re-asked as before, never stored).
  assert.deepEqual(answerOf([votes[1]], batch), { votes: [votes[1]] }, 'a subset of the keys is read');
  for (const list of [[{ ...votes[0], key: 'k9' }], [votes[0], { ...votes[1], confidence: 1 }],
    [{ key: 'k1', verdict: 'refuted' }],
    [{ error: 'synthetic' }]])
    assert.equal(answerOf(list, batch), null, `not a vote of the batch: ${JSON.stringify(list)}`);
  assert.equal(answerOf(votes, { ...batch, challenge: { ...batch.challenge, items: [] } }), null,
    'a batch without keys');
  assert.equal(answerOf(votes, { ...batch, schema: undefined }), null, 'a challenge request without its schema');
  for (const value of [null, undefined, 'votes', 7, true]) assert.equal(answerOf(value, batch), null);
  // The wrapped answer is what the cache stores for a challenge request: it carries `votes`.
  assert.equal(answerStorable(batch, answerOf(votes, batch)), true);
});

test('D78 claude-cli: a bare votes list answers a challenge batch, unreadable on a narrative call', async () => {
  for (const text of [JSON.stringify(votes), `\`\`\`json\n${JSON.stringify(votes)}\n\`\`\``]) {
    const challenge = fakeChild(claudeReply(text));
    const judge = createReviewJudge({ config: CLI, env: ENV,
      spawnProcess: challenge.spawnProcess });
    assert.deepEqual((await outcome(judge, batch)).answer, { votes });
    const reading = fakeChild(claudeReply(text));
    const narrativeJudge = createReviewJudge({ config: { backend: 'claude-cli', model: MODEL },
      env: { HOME: '/synthetic', PATH: '/bin' }, spawnProcess: reading.spawnProcess });
    assert.equal((await outcome(narrativeJudge, narrative)).error?.code, 'model_response_invalid');
  }
  const empty = fakeChild(claudeReply('[]'));
  const judge = createReviewJudge({ config: CLI, env: ENV,
    spawnProcess: empty.spawnProcess });
  assert.equal((await outcome(judge, batch)).error?.code, 'model_response_invalid', 'an empty list stays unreadable');
});

test('D78 codex-cli and anthropic-api read a bare votes list the same way', async () => {
  const codex = fakeChild(codexReply(JSON.stringify(votes)));
  const codexJudge = createReviewJudge({ config: { backend: 'codex-cli', model: 'gpt-synthetic' },
    env: { HOME: '/synthetic', PATH: '/bin' }, spawnProcess: codex.spawnProcess });
  assert.deepEqual((await outcome(codexJudge, batch)).answer, { votes });
  assert.equal((await outcome(codexJudge, narrative)).error?.code, 'model_response_invalid');
  const api = createReviewJudge({ config: { backend: 'anthropic-api', model: MODEL },
    env: { ANTHROPIC_API_KEY: 'synthetic' },
    fetchImpl: async () => new Response(JSON.stringify({ stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(votes) }] })) });
  assert.deepEqual((await outcome(api, batch)).answer, { votes });
  assert.equal((await outcome(api, narrative)).error?.code, 'model_response_invalid');
});
