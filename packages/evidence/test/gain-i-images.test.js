// Gain I, the images you pasted (2026-10-13), on synthetic recordings and a table judge (never
// a model): an image a person pasted into a message is carried on that message's instruction, its loss is located at
// it, a review request whose backend sends images carries it — and only then is that message's loss cleared, for that
// request and the checks of its window — and nothing written for a person ever holds it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { runReview, planWindowRequests } from '../src/run-review.js';
import { instructionReviewScope, decisionInstructionHistoryComplete, windowEnd } from '../src/ledger.js';
import { REQUEST_IMAGE_LIMITS, IMAGE_BACKENDS, deliverableImage, sniffedMediaType, imageSize, requestImages,
  deliveredView, clearedView } from '../src/images.js';
import { INSTRUCTION_GAP_NOTES, sessionFromLedger } from '../adapters/sonah-ledger.js';
import { coverageCauses } from '../src/review.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { renderSessionPage } from '../../render/session-page.js';
import { named, labelOf, humanAsk, call, result, said } from './m33-u-unasked-fixture.js';
import { readingStableIds } from './m35-windows-fixture.js';
import { bytesOfTokens } from '../src/windows.js';
import { pastedRows, loadPasted, imageBlock, png, jpeg, gif, webp, ASK } from './gain-i-images-fixture.js';

const DIMENSION = 'SYNTHETIC_GAIN_I_DIMENSION: how the module is exported';
const digestOf = (prompt) => /^scopeDigest: (\S+)$/m.exec(prompt)?.[1] ?? null;
const located = (session) => session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.nontext_attached);
const unplaced = (session) => session.adapterGaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.nontext_unplaced);
const plan = (session, backend) => planWindowRequests({ session, reviewScope: 'session-only', backend });

/** A table judge: on window 1 it proposes one decision "made without asking you" on the write, checked against the one
 *  human message; every check upholds it. Every request it is sent is kept in `asked`. */
function judge(session, asked) {
  const id = (label) => named(session, label);
  return async (request) => {
    asked.push(request);
    if (request.challenge) return { votes: request.challenge.items.map(({ key }) => ({ key, verdict: 'not-refuted',
      explanation: 'SYNTHETIC: the record shows it.',
      receipts: [{ eventId: id('I1'), role: 'instruction', quote: ASK }] })) };
    const empty = { decisions: [], pivots: [], claims: [], requirements: [] };
    if (!/:w1(?::|$)/.test(request.label ?? '')) return empty;
    return { ...empty, decisions: [{ dimension: DIMENSION, chosen: 'Use src/parser.js', actions: [id('A1-0')],
      value: 'src/parser.js',
      valueReceipt: { eventId: id('A1-0'), role: 'action', field: 'path', quote: 'src/parser.js' },
      stated: { eventId: id('C1-0-1'), role: 'commentary', quote: 'Writing the parser now.' }, constrainedBy: null,
      instructionReview: { dimension: DIMENSION, scopeDigest: digestOf(request.prompt), noRelevantInstruction: true,
        checks: [{ instruction: { eventId: id('I1'), role: 'instruction', quote: ASK }, relevant: false,
          explanation: 'SYNTHETIC: the message and its screenshot do not touch how the module is exported.' }] } }] };
  };
}

test('Gain I: a pasted image rides on its message, and its loss is located there', async (t) => {
  const { raw, ledger, session } = await loadPasted(t, pastedRows());
  assert.equal(raw.capture.instructionsNonText, 1, 'the slicer still counts it');
  assert.deepEqual(raw.ask[0].nonText.map(({ block, type, mediaType }) => ({ block, type, mediaType })),
    [{ block: 1, type: 'image', mediaType: 'image/png' }]);
  assert.equal(ledger.ask[0].nonText[0].data, raw.ask[0].nonText[0].data,
    'D84: the model\'s load keeps it as recorded');
  const message = session.event(named(session, 'I1'));
  assert.equal(message.nonText.length, 1);
  assert.deepEqual(located(session).map(({ count, eventIds }) => ({ count, eventIds })),
    [{ count: 1, eventIds: [message.id] }]);
  assert.deepEqual(unplaced(session), []);
  // The loss is a cause of its own, never "elided by the recorder".
  const causes = coverageCauses({ gaps: session.adapterGaps, session }).map(([cause]) => cause);
  assert.ok(causes.includes('instructions_nontext'));
  assert.ok(!causes.includes('instructions_elided'));
});

test('Gain I: an image an earlier Sonah withheld the data of (its masked ledger) keeps its loss, and none is sent', async (t) => {
  // D90 (owner decision 2026-10-15): no Sonah withholds an image's data now; a ledger an earlier one masked carries the
  // block without its data, and is read so.
  const withoutData = (ledger) => {
    for (const block of ledger.ask[0].nonText ?? []) { delete block.data; delete block.mediaType; }
    return ledger;
  };
  const { ledger, session } = await loadPasted(t, pastedRows(), { persisted: withoutData });
  assert.deepEqual(ledger.ask[0].nonText, [{ block: 1, type: 'image' }]);
  assert.equal(located(session).length, 1);
  assert.deepEqual(requestImages(session, null, 'claude-cli'), { images: [], delivered: [] });
});

test('Gain I: a message carrying images alone opens no instruction; its blocks stay a loss at every bound',
  async (t) => {
  const { raw, session } = await loadPasted(t, pastedRows([imageBlock(png(10, 10))], { words: false }));
  assert.equal(raw.capture.instructionsNonText, 1);
  assert.ok(raw.ask.every((ask) => ask.nonText === undefined));
  assert.deepEqual(located(session), []);
  assert.deepEqual(unplaced(session).map(({ count, eventIds }) => ({ count, eventIds })),
    [{ count: 1, eventIds: undefined }]);
  assert.equal(INSTRUCTION_GAP_NOTES.nontext_unplaced,
    'human input contained nontext blocks that this reviewer could not read');
});

test('Gain I: a request carries the images on a backend that sends them, and only its scope reads them as shown',
  async (t) => {
  const { session } = await loadPasted(t, pastedRows());
  const plain = plan(session).requests[0];
  assert.equal(plain.request.images, undefined, 'no backend named: no image, today\'s request');
  assert.equal(plain.session, undefined);
  assert.match(plain.request.prompt, /^complete: false$/m);
  for (const backend of IMAGE_BACKENDS) {
    const built = plan(session, backend).requests[0];
    assert.deepEqual(built.request.images.map(({ eventId, block, mediaType }) => ({ eventId, block, mediaType })),
      [{ eventId: named(session, 'I1'), block: 1, mediaType: 'image/png' }], backend);
    assert.match(built.request.prompt, /^complete: true$/m, backend);
    assert.match(built.request.prompt, / · the human attached an image: image 1 of those sent with this request/,
      backend);
    // The scope the request was built from is the one its grounding reads: the same digest.
    const scope = instructionReviewScope(built.session, { upTo: windowEnd(built.window) });
    assert.equal(scope.complete, true);
    assert.equal(digestOf(built.request.prompt), scope.scopeDigest);
    assert.equal(scope.instructions[0].images, 1);
    assert.notEqual(scope.scopeDigest, instructionReviewScope(session, { upTo: windowEnd(built.window) }).scopeDigest);
    // The session itself is untouched: its loss stands for every reader that was not shown the image.
    assert.equal(located(session).length, 1);
    assert.equal(located(built.session).length, 0);
  }
  assert.equal(plan(session, 'some-other-backend').requests[0].request.images, undefined);
});

test('Gain I: a session with no nontext input plans byte for byte as before, whatever the backend', async (t) => {
  const { session } = await loadPasted(t, pastedRows([]));
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.channel === 'instructions'), []);
  const before = plan(session).requests.map(({ request }) => [request.system, request.prompt]);
  for (const backend of IMAGE_BACKENDS) {
    const now = plan(session, backend).requests;
    assert.deepEqual(now.map(({ request }) => [request.system, request.prompt]), before, backend);
    assert.ok(now.every((built) => built.request.images === undefined && built.session === undefined));
  }
});

test('Gain I: "made without asking you" is certified only where the window\'s requests carried the image',
  async (t) => {
  const { session } = await loadPasted(t, pastedRows());
  for (const [backend, column] of [['claude-cli', 'unasked'], [undefined, null]]) {
    const asked = [];
    const report = await runReview({ session, pr: null, reviewScope: 'session-only', backend,
      judge: readingStableIds(session, judge(session, asked)) });
    const decision = report.decisions.find((d) => labelOf(session, d.actions[0]) === 'A1-0');
    assert.equal(decision.column, column, String(backend));
    if (column === null) assert.deepEqual(decision.reasons, ['instructions_partial']);
    const carried = asked.filter((request) => Array.isArray(request.images) && request.images.length === 1);
    // Every request of the window — its narrative and each of its checks — carries the image, or none does.
    assert.equal(carried.length, backend ? asked.length : 0, String(backend));
    assert.ok(asked.some((request) => request.challenge), 'the window was checked');
    // The report's own loss: none where every window that reached the message carried its image.
    assert.equal(report.gaps.some((gap) => gap.note === INSTRUCTION_GAP_NOTES.nontext_attached), !backend);
  }
});

test('Gain I: a message whose image no request carries withholds the history from it on, never before it',
  async (t) => {
  // An image over the pixel cap is carried by no request: its loss stays, located at its message.
  const write = (id, path) => [call(id, 'Write', { file_path: `/repo/${path}`, content: 'export const n = 1;\n' }),
    result(id, `File created successfully at: /repo/${path}`, { type: 'create', filePath: `/repo/${path}`,
      content: 'export const n = 1;\n', structuredPatch: [] })];
  const rows = [humanAsk('Write src/a.js.'), ...write('w1', 'src/a.js'),
    humanAsk([{ type: 'text', text: 'Now src/b.js, like this.' },
      imageBlock(png(REQUEST_IMAGE_LIMITS.maxWidth + 1, 10))]),
    ...write('w2', 'src/b.js'), said('Both written.')].map((r, i) => ({ ...r, uuid: `u-gain-i-loc-${i + 1}` }));
  const { session } = await loadPasted(t, rows);
  assert.ok(plan(session, 'claude-cli').requests.every((built) => built.request.images === undefined));
  const [before, after] = ['A1-0', 'A2-0'].map((label) => session.event(named(session, label)));
  assert.equal(decisionInstructionHistoryComplete(session, [before]), true, 'recorded before the message: certifiable');
  assert.equal(decisionInstructionHistoryComplete(session, [after]), false, 'recorded after it: never');
  assert.deepEqual(located(session)[0].eventIds, [named(session, 'I2')]);
});

test('Gain I: deliverable images are the CLI\'s formats, signed, sized by their header and within its caps', () => {
  const entry = (bytes, mediaType) => ({ block: 0, type: 'image', mediaType,
    data: Buffer.from(bytes).toString('base64') });
  for (const [bytes, mediaType, size] of [[png(640, 480), 'image/png', { width: 640, height: 480 }],
    [jpeg(1024, 768), 'image/jpeg', { width: 1024, height: 768 }],
    [gif(32, 16), 'image/gif', { width: 32, height: 16 }],
    [webp(2000, 2000), 'image/webp', { width: 2000, height: 2000 }]]) {
    assert.equal(sniffedMediaType(bytes), mediaType);
    assert.deepEqual(imageSize(bytes, mediaType), size);
    assert.deepEqual(deliverableImage(entry(bytes, mediaType)),
      { block: 0, mediaType, data: entry(bytes, mediaType).data });
  }
  const refused = [
    entry(png(10, 10), 'image/jpeg'),                                  // its bytes are another format
    entry(png(2001, 10), 'image/png'),                                 // over the pixel cap
    entry(jpeg(10, 2001), 'image/jpeg'),
    { ...entry(png(10, 10), 'image/png'), data: 'not base64!' },
    { ...entry(png(10, 10), 'image/png'), type: 'document' },
    { block: 0, type: 'image' },                                       // recorded without its data (a path, a URL)
    entry(png(10, 10), 'image/svg+xml'),
    { ...entry(png(10, 10), 'image/png'), data: 'A'.repeat(REQUEST_IMAGE_LIMITS.maxBase64Chars + 4) },
  ];
  for (const bad of refused) assert.equal(deliverableImage(bad), null, JSON.stringify(bad).slice(0, 80));
});

test('Gain I: a request carries whole messages only, earliest first, within its count and size caps', () => {
  const data = Buffer.from(png(8, 8)).toString('base64');
  const image = (block) => ({ block, type: 'image', mediaType: 'image/png', data });
  const message = (id, sequence, nonText, words = 'SYNTHETIC words') => ({ id, kind: 'instruction', authority: 'human',
    sequence, nonText, words });
  // The inventory reads each message's visible words (ledger.js `instructionReviewScope`).
  const sessionOf = (events) => ({ events, textSpanInfoOf: (event) => ({ spans: [event.words], complete: true }) });
  const session = sessionOf([message('m3', 30, [image(1)]), message('m1', 10, [image(1), image(2)]),
    message('m2', 20, [image(1), { block: 2, type: 'image' }]),
    message('m4', 40, Array.from({ length: REQUEST_IMAGE_LIMITS.maxImages }, (_, k) => image(k + 1))),
    message('m5', 50, [image(1)])]);
  const { images, delivered } = requestImages(session, null, 'claude-cli');
  assert.deepEqual(delivered, ['m1', 'm3'], 'm2 has a block no request can carry; m4 would pass the count cap');
  assert.deepEqual(images.map(({ eventId, block }) => [eventId, block]), [['m1', 1], ['m1', 2], ['m3', 1]]);
  assert.deepEqual(requestImages(session, 25, 'claude-cli').delivered, ['m1'], 'bounded at the window\'s end');
  assert.deepEqual(requestImages(session, null, undefined), { images: [], delivered: [] });
  // Only a message the inventory lists is carried: one with no visible words, or repeating an earlier event's id or
  // sequence, is not (it keeps its loss), and never shifts the images after it.
  const skipped = sessionOf([message('m0', 5, [image(1)], '   '), message('m1', 10, [image(1)]),
    message('m1', 15, [image(1)]), message('m2', 10, [image(1)]), message('m3', 20, [image(1)])]);
  assert.deepEqual(requestImages(skipped, null, 'claude-cli').images.map(({ eventId }) => eventId), ['m1', 'm3']);
});

test('Gain I: the images a request sends are the ones its header numbers, read from one inventory', async (t) => {
  const write = (id, path) => [call(id, 'Write', { file_path: `/repo/${path}`, content: 'export const n = 1;\n' }),
    result(id, `File created successfully at: /repo/${path}`, { type: 'create', filePath: `/repo/${path}`,
      content: 'export const n = 1;\n', structuredPatch: [] })];
  const rows = [humanAsk([{ type: 'text', text: 'Write src/a.js like this.' }, imageBlock(png(10, 10))]),
    ...write('w1', 'src/a.js'),
    humanAsk([{ type: 'text', text: 'Then src/b.js like this.' }, imageBlock(jpeg(20, 20), 'image/jpeg')]),
    ...write('w2', 'src/b.js'), said('Both written.')].map((r, i) => ({ ...r, uuid: `u-gain-i-num-${i + 1}` }));
  const { session } = await loadPasted(t, rows);
  const [first, second] = ['I1', 'I2'].map((label) => named(session, label));
  const both = plan(session, 'claude-cli').requests[0];
  assert.deepEqual(both.request.images.map(({ eventId }) => eventId), [first, second]);
  assert.match(both.request.prompt, / · the human attached an image: image 2 of those sent with this request/);
  // The first message as an inventory leaves it out (here: no visible words; a repeated id or sequence alike).
  const view = Object.create(session);
  view.events = session.events.map((event) => (event.id === first ? { ...event, text: [] } : event));
  const built = plan(view, 'claude-cli').requests[0];
  assert.deepEqual(built.request.images.map(({ eventId, mediaType }) => [eventId, mediaType]),
    [[second, 'image/jpeg']], 'the image sent first is the one the header calls image 1');
  const scope = instructionReviewScope(built.session, { upTo: windowEnd(built.window) });
  assert.deepEqual(scope.instructions.filter((entry) => entry.images).map((entry) => [entry.eventId, entry.images]),
    [[second, 1]]);
  assert.deepEqual(built.request.prompt.match(/ · the human attached an image: image \d+ of those sent/g),
    [' · the human attached an image: image 1 of those sent']);
  assert.deepEqual(located(built.session)[0].eventIds, [first], 'the message left out keeps its loss');
});

/** A turn of the person's — its words and `blocks` — then one Write big enough that two such turns are two codex-cli
 *  windows (CODEX_WINDOW_SETTINGS). */
const BIG = bytesOfTokens(60_000);
function bigTurn(k, blocks) {
  const path = `src/part${k}.js`, content = `${'x'.repeat(BIG)}\n`;
  return [humanAsk([{ type: 'text', text: `Write ${path} like this.` }, ...blocks]),
    call(`w${k}`, 'Write', { file_path: `/repo/${path}`, content }, `Writing ${path}.`),
    result(`w${k}`, `File created successfully at: /repo/${path}`, { type: 'create', filePath: `/repo/${path}`,
      content, structuredPatch: [] })];
}
const twoWindows = (first, second) => [...bigTurn(1, first), ...bigTurn(2, second), said('Both written.')]
  .map((r, i) => ({ ...r, uuid: `u-gain-i-two-${i + 1}` }));
/** A judge that answers every window with nothing proposed, and fails the narrative of window `failing` (none: 0). */
const answering = (failing = 0) => async (request) => {
  if (request.label === `narrative:w${failing}`) throw Object.assign(new Error('model_unavailable'),
    { code: 'model_unavailable' });
  return { decisions: [], pivots: [], claims: [], requirements: [] };
};
const reportLoss = (report) => report.gaps.filter((gap) => gap.note === INSTRUCTION_GAP_NOTES.nontext_attached)
  .flatMap((gap) => gap.eventIds);
const reviewed = (session, failing = 0) => runReview({ session, pr: null, reviewScope: 'session-only',
  backend: 'codex-cli', judge: answering(failing) });

test('Gain I: the report clears a message\'s loss only when every window that reached it was sent its images',
  async (t) => {
  const { session } = await loadPasted(t, twoWindows([], [imageBlock(png(30, 20))]));
  const image = named(session, 'I2');
  const built = plan(session, 'codex-cli');
  assert.equal(built.windows.length, 2, 'premise: two windows');
  assert.ok(windowEnd(built.windows[0]) < session.event(image).sequence, 'premise: window 1 ends before the message');
  assert.equal(built.requests[0].request.images, undefined);
  assert.deepEqual(built.requests[1].request.images.map(({ eventId }) => eventId), [image]);
  assert.deepEqual(reportLoss(await reviewed(session)), [], 'the one window that reached it carried it');
  // A window whose request was never answered showed no image: the message keeps its loss in the report.
  const failed = await reviewed(session, 2);
  assert.equal(failed.windowResults[1].failure, 'model_unavailable');
  assert.deepEqual(reportLoss(failed), [image]);
});

test('Gain I: a message a window\'s cap kept out keeps its loss; one every reaching window carried clears',
  async (t) => {
  const twenty = Array.from({ length: REQUEST_IMAGE_LIMITS.maxImages }, (_, k) => imageBlock(png(8 + k, 8)));
  const { session } = await loadPasted(t, twoWindows(twenty, [imageBlock(png(30, 20))]));
  const [first, second] = ['I1', 'I2'].map((label) => named(session, label));
  const built = plan(session, 'codex-cli');
  assert.equal(built.windows.length, 2, 'premise: two windows');
  for (const { request } of built.requests)
    assert.deepEqual([...new Set(request.images.map(({ eventId }) => eventId))], [first], 'the count cap holds');
  assert.deepEqual(reportLoss(await reviewed(session)), [second]);
  // Window 2 carried the first message, but window 1, which reached it too, was never answered.
  assert.deepEqual(reportLoss(await reviewed(session, 1)), [first, second]);
});

test('Gain I: the cleared view drops only the carried messages from a located loss, never an unlocated one', () => {
  const located = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 2,
    eventIds: ['m1', 'm2'], note: INSTRUCTION_GAP_NOTES.nontext_attached };
  const unlocated = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 3,
    eventIds: ['m1'], note: INSTRUCTION_GAP_NOTES.nontext_attached };
  const other = { code: 'incomplete_inventory', channel: 'instructions', scope: 'session', count: 1,
    note: INSTRUCTION_GAP_NOTES.nontext_unplaced };
  const session = { adapterGaps: [located, unlocated, other], events: [] };
  assert.equal(clearedView(session, new Set()), session);
  assert.deepEqual(clearedView(session, new Set(['m1'])).adapterGaps,
    [{ ...located, count: 1, eventIds: ['m2'] }, unlocated, other]);
  assert.deepEqual(clearedView(session, new Set(['m1', 'm2'])).adapterGaps, [unlocated, other]);
  const view = deliveredView(session, [{ eventId: 'm2' }, { eventId: 'm2' }]);
  assert.equal(view.shownImages.get('m2'), 2);
  assert.equal(session.shownImages, undefined);
  assert.equal(deliveredView(session, []), session);
});

test('Gain I: a Codex message keeps a data-URL image whole; a path-only image is carried by no request', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-gain-i-codex-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = Buffer.from(png(20, 10)).toString('base64');
  const rollout = (payload) => ({ type: 'response_item', timestamp: '2026-10-01T00:00:00Z', payload });
  const rows = [
    { type: 'session_meta', payload: { id: 'codex-gain-i-0001', cwd: '/repo', cli_version: '0.117.0' } },
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Match this layout.' },
      { type: 'input_image', image_url: `data:image/png;base64,${data}`, detail: 'high' }] }),
    rollout({ type: 'function_call', name: 'exec_command', call_id: 'c1', arguments: '{"cmd":"make build"}' }),
    rollout({ type: 'function_call_output', call_id: 'c1',
      output: 'Wall time: 0.5000 seconds\nProcess exited with code 0\nOutput:\nbuilt' }),
    rollout({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'And this one.' },
      { type: 'input_image', image_url: 'shot.png' }] }),
    rollout({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] }),
  ];
  const file = join(dir, 'rollout-2026-10-01T00-00-00-codex-gain-i-0001.jsonl');
  await writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const raw = await sliceLineage([file], { cwd: '/repo' });
  assert.deepEqual(raw.ask.map((ask) => ask.nonText?.map(({ type, mediaType, data: d }) => [type, mediaType ?? null,
    d === data])), [[['image', 'image/png', true]], [['image', null, false]]]);
  const session = sessionFromLedger(redact(raw).ledger, { sessionKey: 'gain-i-codex' });
  const { delivered } = requestImages(session, null, 'codex-cli');
  assert.equal(delivered.length, 1, 'the path-only image keeps its message\'s loss');
  assert.equal(located(session)[0].count, 2);
});

test('Gain I: the page and the report .md say an image was attached, and never hold it', async (t) => {
  const { session } = await loadPasted(t, pastedRows([imageBlock(png(64, 48)), imageBlock(png(32, 32))]));
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', backend: 'claude-cli',
    judge: readingStableIds(session, judge(session, [])) });
  const data = session.event(named(session, 'I1')).nonText[0].data;
  const story = renderReportMarkdown(session, report);
  const page = renderSessionPage(session, report);
  assert.ok(story.includes('You attached 2 images to this message. Sonah does not show them.'));
  // D97: the page says it under the message, in the report's words.
  assert.ok(page.includes('You attached 2 images to this message. Sonah does not show them.'));
  for (const text of [story, page]) assert.ok(!text.includes(data.slice(0, 40)), 'no image byte is ever written for a person');
});
