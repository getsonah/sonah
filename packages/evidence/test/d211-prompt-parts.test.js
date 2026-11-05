// D211 (0.3.0-beta.13): the requests that share a long first part — a window's refuted-row re-asks, the code step's
// checking agents of one change, and every re-ask and repair of its original — are cut there (`parts`), and a request
// that shares its first part with one sent before it is sent once that one's reply has begun. No prompt byte moves:
// every digest below was computed ONCE from the same fixture (d211-prompt-parts-fixture.js) run against
// `git archive 20be6999`, the code before D211. Every byte is synthetic; no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOW_ANSWER } from '../src/prompt.js';
import { REPLY_BEGUN } from '../src/challenge.js';
import { receiptRepairOnce } from '../src/code-pass.js';
import { ANSWER_REPLAYED, appendedRequest, continuedRequest, promptCutsOf, promptPartsOf, staggerSharedParts }
  from '../src/prompt-parts.js';
import { syntheticReasks, s3Run, codeRun, sha16, IMAGE } from './d211-prompt-parts-fixture.js';

const t0 = { after: () => {} };
const firstPart = (request) => request.prompt.slice(0, request.parts[0]);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- (a) the session's re-asks ---------------------------------------------------------------------------------------

/** 20be6999's digests of the re-asks (the same whichever "Now answer" the kept request ended with). D212 withdrew the
 *  third kind, W1 A's recolumn re-ask (20be6999's digest a02289609980dacb). */
const SYNTHETIC_DIGESTS = { restatus: '619608879b7932c2', reanchor: '9621c190a27d466b' };

test('D211 (a): every re-ask of a window is cut after the kept request\'s body and the two newlines after it, the same '
  + 'first part for both kinds; its bytes are 20be6999\'s', () => {
  for (const { name, kept, tail, reasks } of syntheticReasks()) {
    const body = kept.prompt.slice(0, kept.prompt.length - `\n${tail.join('\n')}`.length);
    for (const [kind, reask] of Object.entries(reasks)) {
      assert.equal(sha16(reask.prompt), SYNTHETIC_DIGESTS[kind], `${name} ${kind}: no byte moved`);
      assert.deepEqual(reask.parts, [body.length + 2], `${name} ${kind}`);
      assert.deepEqual(promptCutsOf(reask), reask.parts, `${name} ${kind}: the transport sends the cut as it is`);
      assert.equal(firstPart(reask), `${body}\n\n`, `${name} ${kind}`);
      assert.equal(promptPartsOf(reask.prompt, reask.parts).join(''), reask.prompt);
      assert.equal(reask.system, kept.system);
      assert.deepEqual(reask.schema, kept.schema);
    }
    assert.deepEqual(Object.keys(reasks), ['restatus', 'reanchor'], `${name}: the kinds`);
    assert.equal(new Set(Object.values(reasks).map(firstPart)).size, 1, `${name}: one first part for every kind`);
    if (name === 'image') assert.deepEqual(reasks.restatus.images, [IMAGE], 'the images ride along, as before');
    assert.equal(kept.parts, undefined, 'the kept request itself is sent whole, as before');
  }
});

test('D211 (a): through runReview, a window\'s two restatus re-asks share the kept request\'s body as their first part; '
  + 'their bytes are 20be6999\'s', async () => {
  const { kept, reasks } = await s3Run(t0);
  assert.equal(sha16(kept.prompt), 'ed79e3b4bd0a592c');
  assert.equal(kept.parts, undefined);
  assert.deepEqual(reasks.map((r) => [r.label, sha16(r.prompt)]), [['narrative:w1:restatus:0', '938f00680f01415c'],
    ['narrative:w1:restatus:1', 'b80ac94810b9599d']]);
  const body = kept.prompt.slice(0, kept.prompt.length - `\n${NOW_ANSWER.join('\n')}`.length);
  for (const reask of reasks) {
    assert.equal(firstPart(reask), `${body}\n\n`, reask.label);
    assert.deepEqual(promptCutsOf(reask), reask.parts);
  }
});

// ---- (b) the code step's requests ------------------------------------------------------------------------------------

/** 20be6999's digests of the code step's requests (system and prompt), by label. */
const CODE_DIGESTS = Object.freeze({ 'code-review:agent': '0fc094c97558b55c', 'code-review:repair': '3af29e27d12512ad',
  'code-verify:F1': '5963370273062d48', 'code-verify:F2': '1d9899e6ec52c17e', 'code-verify:F3': 'b99f22d16afd2559',
  'code-verify:batch': '87627819f996c458', 'code-account:1': '63381edf96154a00',
  'code-verify:F1:reask': '6cb17501640f1587', 'code-verify:batch:reask': '02662c124547edf6',
  'code-account:1:reask': 'b7f4416d8d015831' });

test('D211 (b): each checking agent is cut after the person\'s words and the change; a re-ask or repair keeps its '
  + 'original\'s cut and adds one at its end; every byte and the order are 20be6999\'s', async () => {
  const seen = await codeRun();
  assert.deepEqual(seen.map((r) => r.label), Object.keys(CODE_DIGESTS), 'today\'s order');
  for (const r of seen) assert.equal(sha16(`${r.system}\u0000${r.prompt}`), CODE_DIGESTS[r.label], r.label);
  const by = Object.fromEntries(seen.map((r) => [r.label, r]));
  const next = { 'code-verify:F1': '# The finding to check', 'code-verify:F2': '# The finding to check',
    'code-verify:F3': '# The finding to check', 'code-verify:batch': '# The review\'s questions',
    'code-account:1': '# The code review\'s findings and questions' };
  for (const [label, heading] of Object.entries(next)) {
    const r = by[label];
    assert.equal(r.parts.length, 1, label);
    assert.deepEqual(promptCutsOf(r), r.parts, label);
    assert.ok(firstPart(r).startsWith('# '), label);
    assert.ok(firstPart(r).endsWith('\n\n'), label);
    assert.ok(r.prompt.slice(r.parts[0]).startsWith(heading), label);
  }
  // The checks of one change share it; the accounting is built from the person's words as its own (D89), so its first
  // part is its own.
  assert.equal(new Set(['code-verify:F1', 'code-verify:F2', 'code-verify:F3', 'code-verify:batch']
    .map((label) => firstPart(by[label]))).size, 1);
  // Each re-ask: its original byte for byte, then its note; its original's cut, and one at the original's end.
  for (const original of ['code-verify:F1', 'code-verify:batch', 'code-account:1']) {
    const again = by[`${original}:reask`];
    assert.ok(again.prompt.startsWith(by[original].prompt) && again.prompt.length > by[original].prompt.length);
    assert.deepEqual(again.parts, [...by[original].parts, by[original].prompt.length], original);
    assert.deepEqual(promptCutsOf(again), again.parts, original);
  }
  // The review agent is sent whole, as before; its repair, its request and its note byte for byte, is cut at its end.
  assert.equal(by['code-review:agent'].parts, undefined);
  const repair = by['code-review:repair'];
  assert.ok(repair.prompt.startsWith(by['code-review:agent'].prompt));
  assert.deepEqual(repair.parts, [by['code-review:agent'].prompt.length]);
});

test('D211 (b): a receipt repair keeps its request\'s cuts and adds one at its end; a request rebuilt with its blocks '
  + 'given way is not cut', async () => {
  const request = { system: 'S', prompt: 'SYNTHETIC first part\n\nSYNTHETIC rest', parts: [22], schema: {} };
  let sent = null;
  await receiptRepairOnce({ judge: async (r) => { sent = r; return []; }, request, label: 'repair', note: '\nNOTE ',
    failed: [{ candidate: { a: 1 }, index: 0 }], readRepaired: () => [], identity: () => 'x', fits: () => true });
  assert.equal(sent.prompt, `${request.prompt}\nNOTE [{"a":1}]`);
  assert.deepEqual(sent.parts, [22, request.prompt.length]);
  assert.deepEqual(appendedRequest(request, ''), request);
  const original = { system: 'S', prompt: 'SYNTHETIC whole request' };
  assert.deepEqual(continuedRequest(original, { system: 'S', prompt: 'SYNTHETIC whole request NOTE' }).parts,
    [original.prompt.length]);
  for (const other of [{ system: 'S', prompt: 'SYNTHETIC rebuilt NOTE' }, { system: 'T', prompt: `${original.prompt} N` },
    { system: 'S', prompt: original.prompt }])
    assert.equal(continuedRequest(original, other), other, 'shares no prefix to cut at: as it was');
});

test('D211: cuts the transport could not send as they are are none — the prompt goes whole, the same text', () => {
  const prompt = 'SYNTHETIC one\n\nSYNTHETIC two\n\nSYNTHETIC three';
  assert.deepEqual(promptCutsOf({ prompt, parts: [15, 30] }), [15, 30]);
  assert.deepEqual(promptPartsOf(prompt, [15, 30]).join(''), prompt);
  for (const parts of [undefined, [], [0], [prompt.length], [30, 15], [15, 15], [1.5], ['15'], 15, [-1]])
    assert.deepEqual(promptCutsOf({ prompt, parts }), [], JSON.stringify(parts));
  assert.deepEqual(promptCutsOf({ prompt: 'SYNTHETIC\n\n\n', parts: [9] }), [], 'a part of white space only');
  assert.deepEqual(promptCutsOf({ prompt: 'SYNTHETIC 😀 after', parts: [11] }), [], 'inside a surrogate pair');
  assert.deepEqual(promptCutsOf({ parts: [1] }), []);
});

// ---- (d) the order: a request that shares a first part waits for the first one's reply ------------------------------

/** A judge in code that answers each request when the test says: `calls` gets each request as it arrives. */
function heldJudge() {
  const calls = [];
  const judge = (request) => new Promise((resolve, reject) => { calls.push({ request, resolve, reject }); });
  return { calls, judge, labels: () => calls.map((c) => c.request.label) };
}
const shared = 'SYNTHETIC shared first part\n\n';
const sibling = (label, over = {}) => ({ system: 'S', schema: { type: 'object' }, prompt: `${shared}${label}`,
  parts: [shared.length], label, ...over });

test('D211 (d): siblings wait for the first one\'s reply to begin, then go in the order given; a request given after '
  + 'one that waits goes after it; with nothing waiting a request goes at once', async () => {
  const { calls, judge, labels } = heldJudge();
  const send = staggerSharedParts(judge);
  const answers = [send(sibling('A1')), send(sibling('A2')), send({ system: 'S', prompt: 'SYNTHETIC whole', label: 'W' }),
    send(sibling('B1', { system: 'T' })), send(sibling('A3'))];
  await tick();
  assert.deepEqual(labels(), ['A1'], 'only the first is sent; the rest wait, in order');
  assert.equal(typeof calls[0].request[REPLY_BEGUN], 'function');
  calls[0].request[REPLY_BEGUN]();
  calls[0].request[REPLY_BEGUN]();
  await tick();
  assert.deepEqual(labels(), ['A1', 'A2', 'W', 'B1', 'A3'], 'today\'s order once the reply began');
  assert.equal(calls[1].request[REPLY_BEGUN], undefined, 'a sibling carries no signal');
  assert.equal(typeof calls[3].request[REPLY_BEGUN], 'function', 'the first of another first part carries its own');
  calls.forEach((c, at) => c.resolve(at));
  assert.deepEqual(await Promise.all(answers), [0, 1, 2, 3, 4]);
  // Every first part's first one has begun: a later request goes at once, in the same turn.
  send(sibling('A4'));
  assert.deepEqual(labels().at(-1), 'A4');
  // A request sent whole goes at once when nothing waits.
  const plain = heldJudge();
  staggerSharedParts(plain.judge)({ system: 'S', prompt: 'P', label: 'P1' });
  assert.deepEqual(plain.labels(), ['P1']);
});

test('D211 (d): a first one answered from the store made no call, so the next one waiting leads in its place',
  async () => {
  for (const stored of [['A1'], ['A1', 'A2']]) {
    const { calls, judge, labels } = heldJudge();
    // A judge in code standing for the answer store: a stored label is answered at once and says so (ANSWER_REPLAYED).
    const store = (request) => {
      if (!stored.includes(request.label)) return judge(request);
      request[ANSWER_REPLAYED]();
      return Promise.resolve(`stored ${request.label}`);
    };
    const seen = [];
    const send = staggerSharedParts((request) => { seen.push(request.label); return store(request); });
    const answers = ['A1', 'A2', 'A3', 'A4'].map((label) => send(sibling(label)));
    await tick();
    const leader = stored.length === 1 ? 'A2' : 'A3';
    assert.deepEqual(labels(), [leader], `after ${stored.join(', ')} stored, ${leader} leads alone`);
    assert.equal(typeof calls[0].request[REPLY_BEGUN], 'function', 'the new leader carries the signal');
    calls[0].request[REPLY_BEGUN]();
    await tick();
    assert.deepEqual(seen, ['A1', 'A2', 'A3', 'A4'], 'the order given');
    calls.forEach((c) => c.resolve(c.request.label));
    assert.deepEqual(await Promise.all(answers), ['A1', 'A2', 'A3', 'A4']
      .map((label) => (stored.includes(label) ? `stored ${label}` : label)));
  }
  // With none waiting, the next one given leads.
  const { calls, judge, labels } = heldJudge();
  const send = staggerSharedParts((request) => {
    if (request.label !== 'A1') return judge(request);
    request[ANSWER_REPLAYED]();
    return Promise.resolve('stored');
  });
  assert.equal(await send(sibling('A1')), 'stored');
  await tick();
  send(sibling('A2')); send(sibling('A3'));
  await tick();
  assert.deepEqual(labels(), ['A2']);
  calls[0].resolve('done');
  await tick();
  assert.deepEqual(labels(), ['A2', 'A3']);
});

test('D211 (d): a sibling never waits forever — it goes when the first one\'s call settles, failed or aborted; the '
  + 'first one\'s own signal is still called', async () => {
  for (const settle of ['resolve', 'reject']) {
    const { calls, judge, labels } = heldJudge();
    const send = staggerSharedParts(judge);
    let own = 0;
    const first = Object.defineProperty(sibling('A1'), REPLY_BEGUN, { value: () => { own++; } });
    const answers = [send(first).catch((e) => e.code), send(sibling('A2'))];
    await tick();
    assert.deepEqual(labels(), ['A1']);
    if (settle === 'resolve') calls[0].resolve('stored');
    else calls[0].reject(Object.assign(new Error('review_cancelled'), { code: 'review_cancelled' }));
    await tick();
    assert.deepEqual(labels(), ['A1', 'A2'], settle);
    calls[1].resolve('second');
    assert.deepEqual(await Promise.all(answers), [settle === 'resolve' ? 'stored' : 'review_cancelled', 'second']);
    calls[0].request[REPLY_BEGUN]();
    assert.equal(own, 1, 'the request\'s own REPLY_BEGUN is called too');
  }
  // An abort reaches the waiting siblings: the first call stops with the review, each sibling is sent and refused.
  const controller = new AbortController();
  const sent = [];
  const judge = (request) => {
    sent.push(request.label);
    if (controller.signal.aborted) return Promise.reject(Object.assign(new Error('c'), { code: 'review_cancelled' }));
    return new Promise((resolve, reject) => controller.signal.addEventListener('abort',
      () => reject(Object.assign(new Error('c'), { code: 'review_cancelled' }))));
  };
  const send = staggerSharedParts(judge);
  const answers = ['A1', 'A2', 'A3'].map((label) => send(sibling(label)).catch((e) => e.code));
  await tick();
  controller.abort();
  assert.deepEqual(await Promise.all(answers), ['review_cancelled', 'review_cancelled', 'review_cancelled']);
  assert.deepEqual(sent, ['A1', 'A2', 'A3']);
  // A judge that throws at once is a failed first call: its siblings still go.
  const throwing = staggerSharedParts((request) => { if (request.label === 'A1') throw new Error('x'); return 'ok'; });
  const [a, b] = [throwing(sibling('A1')).catch(() => 'failed'), throwing(sibling('A2'))];
  assert.deepEqual([await a, await b], ['failed', 'ok']);
});

test('D211 (d): through runReview, a window\'s second re-ask is sent only once the first one\'s reply has begun',
  async () => {
  const log = [];
  const { reasks } = await s3Run(t0, { hold: (request) => {
    log.push(request.label);
    if (request.label !== 'narrative:w1:restatus:0') return null;
    assert.equal(typeof request[REPLY_BEGUN], 'function');
    return tick(20).then(() => { log.push('begun'); request[REPLY_BEGUN](); }).then(() => tick(20));
  } });
  assert.deepEqual(log, ['narrative:w1:restatus:0', 'begun', 'narrative:w1:restatus:1']);
  assert.deepEqual(reasks.map((r) => r.label), ['narrative:w1:restatus:0', 'narrative:w1:restatus:1']);
});

test('D211 (d): through runCodePass, the checks of one change wait for the first one\'s reply, and every later request '
  + 'keeps today\'s order', async () => {
  const log = [];
  const seen = await codeRun({ hold: (request) => {
    log.push(request.label);
    if (request.label !== 'code-verify:F1') return null;
    assert.equal(typeof request[REPLY_BEGUN], 'function');
    return tick(20).then(() => { log.push('begun'); request[REPLY_BEGUN](); }).then(() => tick(20));
  } });
  assert.deepEqual(log.slice(0, 8), ['code-review:agent', 'code-review:repair', 'code-verify:F1', 'begun',
    'code-verify:F2', 'code-verify:F3', 'code-verify:batch', 'code-account:1']);
  // A re-ask is sent once its original answered, so when that is depends on the answers, as before.
  assert.deepEqual(seen.map((r) => r.label).sort(), Object.keys(CODE_DIGESTS).sort());
  // A first check that fails before its reply begins lets the rest go when it settles.
  const failed = [];
  await codeRun({ hold: (request) => {
    failed.push(request.label);
    return request.label === 'code-verify:F1' ? tick(20).then(() => { failed.push('settled'); throw new Error('x'); })
      : null;
  } });
  assert.deepEqual(failed.slice(2, 5), ['code-verify:F1', 'settled', 'code-verify:F2']);
});
