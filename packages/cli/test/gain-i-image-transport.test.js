// Gain I, the images you pasted (2026-10-13): a review request's images reach the reviewer on
// every backend whose transport sends them — claude-cli as one stream-json user message, anthropic-api as image blocks,
// codex-cli as attached files — are bound into the answer key, and are refused rather than dropped. A request that
// carries none is sent and keyed byte for byte as before. Synthetic processes and bytes only: no CLI and no model runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, readdir, stat } from 'node:fs/promises';
import { createReviewJudge, reviewCliArgs, reviewCodexArgs, reviewApiBody, reviewTransportArguments, claudeStreamInput,
  requestImagesOf, sendableImages, codexImageFile } from '../src/review-judge.js';
import { answerKey } from '../src/answer-cache.js';
import { createReviewBudget, chargedInputBytes } from '../src/review-budget.js';
import { REQUEST_IMAGE_LIMITS, IMAGE_BACKENDS } from '../../evidence/src/images.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64').toString('base64');
const image = { eventId: 'm1', block: 1, mediaType: 'image/png', data: PNG };
const plain = { system: 'Synthetic system.', prompt: 'Synthetic prompt.' };
const withImages = { ...plain, images: [image, { ...image, block: 2 }] };

function fakeClaude(inspect) {
  return (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit('close', 1);
    let stdin = ''; child.stdin.on('data', (d) => { stdin += d; });
    child.stdin.on('finish', () => setImmediate(async () => {
      try { await inspect({ command, args, options, stdin }); } catch (error) { child.emit('error', error); return; }
      const events = [{ type: 'system', subtype: 'init', model: 'claude-test-1' },
        { type: 'assistant', parent_tool_use_id: null, message: { model: 'claude-test-1', content: [] } },
        { type: 'result', subtype: 'success', is_error: false, result: '{"value":"ok"}', usage: { output_tokens: 1 } }];
      child.stdout.write(events.map((e) => JSON.stringify(e)).join('\n'));
      child.emit('close', 0);
    }));
    return child;
  };
}

test('Gain I: claude-cli sends a request with images as one stream-json user message; one without, as before',
  async () => {
  assert.deepEqual(reviewCliArgs({ system: 's', model: 'm', images: false }),
    reviewCliArgs({ system: 's', model: 'm' }));
  const args = reviewCliArgs({ system: 's', model: 'm', images: true });
  assert.equal(args[args.indexOf('--input-format') + 1], 'stream-json');
  assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
  assert.ok(args.includes('--print'));
  const seen = [];
  const judge = createReviewJudge({ env: { HOME: '/synthetic', PATH: '/bin' },
    spawnProcess: fakeClaude((call) => seen.push(call)) });
  assert.deepEqual(await judge(withImages), { value: 'ok' });
  assert.deepEqual(await judge(plain), { value: 'ok' });
  const [carried, before] = seen;
  assert.ok(carried.args.includes('--input-format'));
  assert.ok(!before.args.includes('--input-format'));
  assert.equal(before.stdin, plain.prompt, 'a request without images is its prompt on stdin, as before');
  assert.ok(carried.stdin.endsWith('\n') && carried.stdin.indexOf('\n') === carried.stdin.length - 1, 'one line');
  const message = JSON.parse(carried.stdin);
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  assert.deepEqual(message.message.content, [{ type: 'text', text: plain.prompt }, { type: 'text', text: 'Image 1:' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
    { type: 'text', text: 'Image 2:' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }]);
  assert.equal(claudeStreamInput(plain.prompt, [image]).split('\n').length, 2);
});

test('Gain I: anthropic-api sends the images as blocks of its one user message; without, the body is as before',
  async () => {
  assert.deepEqual(reviewApiBody({ system: 's', prompt: 'p', model: 'm', images: [] }),
    reviewApiBody({ system: 's', prompt: 'p', model: 'm' }));
  let body = null;
  const judge = createReviewJudge({ env: { ANTHROPIC_API_KEY: 'synthetic' },
    config: { backend: 'anthropic-api', model: 'claude-test-1' },
    fetchImpl: async (url, options) => {
      body = JSON.parse(options.body);
      const reply = { model: 'claude-test-1', stop_reason: 'end_turn',
        content: [{ type: 'text', text: '{"value":"ok"}' }] };
      return { ok: true, status: 200, body: [Buffer.from(JSON.stringify(reply))] };
    } });
  assert.deepEqual(await judge(withImages), { value: 'ok' });
  assert.equal(body.messages.length, 1);
  assert.deepEqual(body.messages[0].content.map((block) => block.type), ['text', 'text', 'image', 'text', 'image']);
  assert.equal(body.messages[0].content[2].source.data, PNG);
  assert.deepEqual(
    reviewTransportArguments({ backend: 'anthropic-api', model: 'claude-test-1', system: 's', images: [image] }),
    reviewTransportArguments({ backend: 'anthropic-api', model: 'claude-test-1', system: 's' }),
    'the images ride in the messages, which the arguments never hold; the key binds them itself');
});

test('Gain I: codex-cli attaches each image as an owner-only file by --image, straight after exec', async () => {
  assert.deepEqual(reviewCodexArgs({ model: 'gpt-test', images: [] }), reviewCodexArgs({ model: 'gpt-test' }));
  const args = reviewCodexArgs({ model: 'gpt-test', images: [image, { ...image, mediaType: 'image/jpeg' }] });
  assert.deepEqual(args.slice(0, 5), ['exec', '--image', 'image-1.png', '--image', 'image-2.jpg']);
  assert.equal(args.at(-1), '-', 'the prompt is still read from stdin');
  assert.equal(codexImageFile(3, 'image/webp'), 'image-3.webp');
  let files = null;
  const spawnProcess = (command, argv, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => true;
    child.stdin.resume();
    child.stdin.on('finish', () => setImmediate(async () => {
      files = { names: (await readdir(options.cwd)).sort(), png: await readFile(`${options.cwd}/image-1.png`), argv,
        mode: (await stat(`${options.cwd}/image-1.png`)).mode & 0o777 };
      const events = [{ type: 'thread.started', thread_id: 't' }, { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'a', type: 'agent_message', text: '{"value":"ok"}' } },
        { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }];
      child.stdout.write(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
      setImmediate(() => child.emit('close', 0));
    }));
    return child;
  };
  const judge = createReviewJudge({ env: { HOME: '/synthetic', PATH: '/bin', SONAH_CODEX_BIN: '/synthetic/codex' },
    config: { backend: 'codex-cli', model: 'gpt-test' }, spawnProcess });
  assert.deepEqual(await judge(withImages), { value: 'ok' });
  assert.deepEqual(files.names, ['image-1.png', 'image-2.png', 'instructions.txt']);
  assert.deepEqual(files.png, Buffer.from(PNG, 'base64'));
  assert.equal(files.mode, 0o600);
  assert.deepEqual(files.argv.slice(0, 5), ['exec', '--image', 'image-1.png', '--image', 'image-2.png']);
});

test('Gain I: a request with images is refused on a backend whose transport sends none; no unknown backend is reached',
  () => {
  for (const backend of IMAGE_BACKENDS) assert.equal(sendableImages(withImages, backend).length, 2, backend);
  for (const backend of ['some-other-backend', undefined]) {
    assert.equal(sendableImages(withImages, backend), null, String(backend));
    assert.deepEqual(sendableImages(plain, backend), [], 'a request without images is sendable as before');
  }
  assert.equal(sendableImages({ ...plain, images: 'one' }, 'claude-cli'), null);
  // The judge itself is built only for a backend it has a transport for, so no request ever reaches another.
  assert.throws(() => createReviewJudge({ config: { backend: 'some-other-backend', model: 'synthetic-model' } }),
    { code: 'unsupported_backend' });
});

test('Gain I: --max-input-bytes counts each image a request sends, every time; a request without images as before',
  async () => {
  const text = Buffer.byteLength(plain.system) + Buffer.byteLength(plain.prompt);
  assert.equal(chargedInputBytes(plain), text);
  assert.equal(chargedInputBytes(withImages), text + 2 * PNG.length);
  const budget = createReviewBudget({ maxInputBytes: 2 * (text + 2 * PNG.length) });
  let delivered = 0;
  const judge = budget.wrap(async () => { delivered++; return {}; });
  await judge(withImages);
  await judge(withImages);
  assert.equal(budget.snapshot().inputBytes, 2 * (text + 2 * PNG.length));
  await assert.rejects(judge(plain), { code: 'budget_exhausted' });
  assert.equal(delivered, 2);
  assert.equal(budget.snapshot().reason, 'max_input_bytes');
});

test('Gain I: a request\'s images are refused whole when they are not ones a request can carry, never dropped',
  async () => {
  const bad = [{ images: 'one' }, { images: [{ mediaType: 'image/svg+xml', data: PNG }] },
    { images: [{ mediaType: 'image/png', data: 'not base64' }] },
    { images: Array.from({ length: REQUEST_IMAGE_LIMITS.maxImages + 1 }, () => image) }];
  for (const extra of bad) {
    assert.equal(requestImagesOf({ ...plain, ...extra }), null);
    const judge = createReviewJudge({ spawnProcess: fakeClaude(() => assert.fail('never spawned')) });
    await assert.rejects(judge({ ...plain, ...extra }),
      { code: 'invalid_model_input' });
    assert.equal(answerKey({ ...plain, ...extra }, { backend: 'claude-cli', model: 'sonnet' }), null);
  }
});

test('Gain I: the answer key binds each image and the argv it changes; a request without images keys as before', () => {
  const key = (request, backend = 'claude-cli') => answerKey(request, { backend, model: 'sonnet' });
  const legacy = answerKey(plain, { backend: 'claude-cli', model: 'sonnet',
    transportArguments: ({ backend, model, system, ...rest }) => (Object.keys(rest).length ? assert.fail('extra member')
      : reviewTransportArguments({ backend, model, system })) });
  assert.equal(key(plain), legacy, 'no images: the arguments are asked for exactly as before');
  assert.notEqual(key(withImages), key(plain));
  const shorter = Buffer.from(Buffer.from(PNG, 'base64').subarray(0, 40)).toString('base64');
  const other = { ...withImages, images: [image, { ...image, data: shorter }] };
  assert.notEqual(key(other), key(withImages), 'another image is another question');
  assert.equal(key({ ...withImages, images: withImages.images.map((i) => ({ ...i, eventId: 'elsewhere' })) }),
    key(withImages), 'only what is sent is keyed');
  for (const backend of ['anthropic-api', 'codex-cli']) assert.notEqual(key(withImages, backend), key(plain, backend));
});
