// D103 (owner decision 2026-10-17: "for D increase the limit from 3.6k to 12k"; amends D68 P): the skim — the bytes a
// session-only window shows at each end of a result longer than twice it — is a frozen literal in windows.js, keyed by
// the recording's harness (the adapter that loaded it): 12,000 bytes a side for a Claude Code recording, 3,600 for a
// Codex rollout and for any harness the table does not list. The reviewer backend keeps choosing the budgets. A result at
// or under twice the skim is shown whole; a longer one shows a whole-line head and tail, its middle named by lines and
// bytes and offered on request. The skim is bound in the windowing profile and the run-profile digest.
//
// Invariants, as tests: the table and its fallback; the settings each review gets; the partition (head, named middle
// and tail are the stored output, byte for byte); every omission declared in its request; the bound (a request over it
// is declared unreviewed, never clipped); the profile and the window keys bind the skim.
//
// Synthetic sessions and judges only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Session } from '../src/session.js';
import { SKIM_SIDE_BYTES, SKIM_FALLBACK_BYTES, skimSideBytesOf, windowSettingsOf, windowingProfileOf, WINDOW_SETTINGS,
  CODEX_WINDOW_SETTINGS, COMBINED_WINDOW_SETTINGS, WINDOWING_PROFILE, WINDOWING_VERSION, WINDOW_REQUEST_MAX_BYTES,
  eventView, lineCount, byteLength } from '../src/windows.js';
import { planWindowRequests, runReview, runProfile } from '../src/run-review.js';
import { reviewInputBytes } from '../src/challenge.js';
import { canonicalJson } from '../contracts/canonical.js';
import { inventorySession, fixtureJudge, windowNarrative } from '../../cli/test/m33-fast-profile-fixture.js';
import * as sr from '../../cli/src/session-review.js';
import { createAnswerCache } from '../../cli/src/answer-cache.js';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const blobs = {};
let counter = 0;
const ref = (text) => {
  const key = `d103s${++counter}`;
  blobs[key] = text;
  return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
const ask = (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text) });
const said = (id, text) => ({ id, kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref(text) });
const run = (id, command) => ({ id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command', paths: [],
  command: ref(command), input: [], changes: [] });
const out = (id, invocation, text) => ({ id, kind: 'observation', invocation, callKey: invocation, phase: 'terminal',
  result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native', output: ref(text) });
const session = (events, adapter = 'claude') => new Session({ sessionKey: `d103-${adapter}`, adapter, blobs: { ...blobs },
  events: events.map((event, sequence) => ({ ...event, sequence })) });
/** `bytes` of numbered lines (about 40 bytes each), exactly. */
const sized = (bytes, tag = 'row') => {
  let text = '';
  for (let k = 1; byteLength(text) < bytes; k++) text += `${tag} ${String(k).padStart(5, '0')} of the synthetic output\n`;
  return text.slice(0, bytes);
};
const HARNESSES = ['claude', 'codex', 'cursor', 'unknown', undefined, '__proto__', 'constructor', 'toString'];
const BACKENDS = [undefined, 'claude-cli', 'anthropic-api', 'codex-cli'];

// ---- the table ------------------------------------------------------------------------------------------------------------

test('D103 the skim is a frozen literal per harness; a harness the table does not list gets the smallest, never a larger', () => {
  assert.equal(WINDOWING_VERSION, 'sonah.windows/9');
  assert.deepEqual({ ...SKIM_SIDE_BYTES }, { claude: 12_000, codex: 3_600 });
  assert.ok(Object.isFrozen(SKIM_SIDE_BYTES));
  assert.equal(SKIM_FALLBACK_BYTES, 3_600);
  for (const harness of HARNESSES) {
    const side = skimSideBytesOf(harness);
    assert.ok(side <= Math.max(...Object.values(SKIM_SIDE_BYTES)), String(harness));
    assert.equal(side, harness === 'claude' ? 12_000 : 3_600, `${String(harness)}: listed, or the smallest`);
  }
});

test('D103 every review gets its backend\'s budgets and its recording\'s skim; a combined review keeps 3,600 for every harness', () => {
  for (const backend of BACKENDS) for (const harness of HARNESSES) {
    const settings = windowSettingsOf('session-only', backend, harness);
    const budgets = backend === 'codex-cli' ? CODEX_WINDOW_SETTINGS : WINDOW_SETTINGS;
    assert.deepEqual({ ...settings }, { workTokens: budgets.workTokens, carriedTokens: budgets.carriedTokens,
      skimSideBytes: skimSideBytesOf(harness) }, `${backend}/${String(harness)}`);
    assert.ok(Object.isFrozen(settings));
    // One frozen object per review shape: a precomputed plan is bound to it by identity.
    assert.equal(windowSettingsOf('session-only', backend, harness), settings);
    assert.deepEqual(windowingProfileOf('session-only', backend, harness).skimSideBytes, settings.skimSideBytes);
    assert.equal(windowSettingsOf('combined', backend, harness), COMBINED_WINDOW_SETTINGS);
    assert.equal(windowingProfileOf('combined', backend, harness).skimSideBytes, 3_600);
  }
  // A review that names no harness is the smallest skim's, as every review before D103 was.
  assert.equal(windowSettingsOf('session-only'), WINDOW_SETTINGS);
  assert.deepEqual(windowingProfileOf('session-only'), WINDOWING_PROFILE);
  assert.equal(WINDOW_SETTINGS.skimSideBytes, SKIM_FALLBACK_BYTES);
});

// ---- the cut ----------------------------------------------------------------------------------------------------------

test('D103 a result at or under twice its harness\'s skim is whole; one byte over, a whole-line head and tail of at most the skim', () => {
  for (const [adapter, side] of [['claude', 12_000], ['codex', 3_600], ['cursor', 3_600]]) {
    const atSize = sized(2 * side), over = `${sized(2 * side + 1_000)}last line\n`;
    const s = session([ask('I1', 'Run it.'), run('A1', 'cat a.txt'), out('A1-r', 'A1', atSize), run('A2', 'cat b.txt'),
      out('A2-r', 'A2', over), said('C1', 'Done.')], adapter);
    // The plan windows by the session's harness; a function given no settings does too.
    const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
    assert.equal(built.settings.skimSideBytes, side, adapter);
    assert.equal(eventView(s, s.event('A1-r')).fields[0].omitted, null, `${adapter}: at twice the skim, whole`);
    assert.deepEqual(built.sourceMap['A1-r'].map((x) => x.text), [atSize]);
    const view = eventView(s, s.event('A2-r'));
    const [field] = view.fields;
    const head = field.spans.slice(0, field.headCount).join(''), tail = field.spans.slice(field.headCount).join('');
    assert.ok(byteLength(head) <= side && byteLength(tail) <= side, adapter);
    assert.ok(byteLength(head) > side - 100 && byteLength(tail) > side - 100, `${adapter}: the cut is the skim's`);
    assert.ok(head.endsWith('\n') && over.startsWith(head) && over.endsWith(tail)
      && over[over.length - tail.length - 1] === '\n', `${adapter}: whole lines`);
    // Named by lines and bytes, and offered on request.
    const lines = field.omitted.fromLine === field.omitted.throughLine ? `line ${field.omitted.fromLine}`
      : `lines ${field.omitted.fromLine.toLocaleString('en-US')}–${field.omitted.throughLine.toLocaleString('en-US')}`;
    const alias = built.aliases.of('A2-r');
    assert.ok(built.request.prompt.includes(`  omitted: ${lines} of this output, `
      + `${field.omittedBytes.toLocaleString('en-US')} UTF-8 bytes, are not shown; ask for them under step 6 if a row's `
      + `status depends on them ([${alias}] ${lines}).`), adapter);
  }
});

test('D103 partition: the head, the named middle and the tail are the stored output, byte for byte, at every skim', () => {
  const shapes = [sized(24_000), sized(24_001), sized(70_000), `${'x'.repeat(30_000)}`, `${sized(5_000)}${'é'.repeat(15_000)}\n${sized(9_000)}`,
    `${'😀'.repeat(8_000)}\nshort\n${'z'.repeat(40_000)}`, sized(7_200), sized(7_201)];
  for (const adapter of ['claude', 'codex', 'cursor']) {
    for (const text of shapes) {
      const s = session([run('A1', 'cat it'), out('A1-r', 'A1', text)], adapter);
      const [field] = eventView(s, s.event('A1-r')).fields;
      const side = skimSideBytesOf(adapter);
      if (byteLength(text) <= 2 * side) {
        assert.equal(field.omitted, null);
        assert.equal(field.spans.join(''), text);
        continue;
      }
      const head = field.spans.slice(0, field.headCount).join(''), tail = field.spans.slice(field.headCount).join('');
      const middle = text.slice(head.length, text.length - tail.length);
      assert.equal(head + middle + tail, text, `${adapter}: nothing lost, nothing twice`);
      assert.equal(byteLength(middle), field.omittedBytes, `${adapter}: the bytes named`);
      assert.equal(lineCount(head.endsWith('\n') ? head : `${head}\n`) + (head.endsWith('\n') ? 1 : 0), field.omitted.fromLine);
      const through = lineCount(text.slice(0, text.length - tail.length));
      assert.equal(field.omitted.throughLine, through, `${adapter}: the lines named`);
    }
  }
});

test('D103 every result a request shows in part is declared in that request, with its lines and bytes', () => {
  const s = session([ask('I1', 'Check them.'), run('A1', 'a'), out('A1-r', 'A1', sized(30_000, 'a')), run('A2', 'b'),
    out('A2-r', 'A2', sized(10_000, 'b')), run('A3', 'c'), out('A3-r', 'A3', sized(100_000, 'c')), said('C1', 'Checked.')]);
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests;
  const cut = ['A1-r', 'A2-r', 'A3-r'].filter((id) => eventView(s, s.event(id), built.settings).fields[0].omitted);
  assert.deepEqual(cut, ['A1-r', 'A3-r'], 'the 10 KB result is whole in a Claude Code recording');
  for (const id of cut) {
    const { omitted, omittedBytes } = eventView(s, s.event(id), built.settings).fields[0];
    const alias = built.aliases.of(id);
    const header = built.request.prompt.indexOf(`[${alias}] RESULT`);
    const line = built.request.prompt.indexOf(`  omitted: lines ${omitted.fromLine.toLocaleString('en-US')}–`
      + `${omitted.throughLine.toLocaleString('en-US')} of this output, ${omittedBytes.toLocaleString('en-US')} UTF-8 bytes`,
    header);
    assert.ok(header >= 0 && line > header, id);
    // Its source map holds only the shown spans.
    assert.equal(built.sourceMap[id].reduce((n, x) => n + byteLength(x.text), 0),
      byteLength(blobs[s.event(id).output[0].sourceKey]) - omittedBytes);
  }
});

// ---- the bound ---------------------------------------------------------------------------------------------------------

test('D103 bound: a window over the request bound is declared unreviewed_scope, never clipped and never sent', async () => {
  // Sixty 30 KB results in one segment with no message between them: shown whole in a Claude Code recording, they are
  // larger than a window's whole work budget alone, so that window is oversize and its request over the bound.
  const s = inventorySession();
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const over = plan.requests.filter(({ request }) => reviewInputBytes(request) > WINDOW_REQUEST_MAX_BYTES);
  assert.equal(over.length, 1, 'premise: one request over the bound');
  assert.equal(over[0].window.oversize, true);
  const labels = [];
  const report = await runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: fixtureJudge({ narrativeOf: (request) => windowNarrative(s, request.window), seen: labels, omitOnPass: 0 }) });
  const w = over[0].window.index + 1;
  assert.deepEqual(report.windowFailures.map((f) => `${f.window}:${f.reason}`), [`${w}:unreviewed_scope`]);
  assert.ok(!labels.some((request) => request.label === `narrative:w${w}`), 'never sent');
  assert.ok(labels.every((request) => reviewInputBytes(request) <= WINDOW_REQUEST_MAX_BYTES), 'every request sent fits');
  // At the smallest skim (no harness named) the same results fit one window, as before D103.
  const unkeyed = Object.create(s, { adapter: { value: undefined, enumerable: true } });
  const before = planWindowRequests({ session: unkeyed, reviewScope: 'session-only' });
  assert.ok(before.requests.every(({ request }) => reviewInputBytes(request) <= WINDOW_REQUEST_MAX_BYTES));
});

// ---- the profile and the window keys -------------------------------------------------------------------------------------

test('D103 the run profile binds the skim its harness resolves to; omitted, the smallest', () => {
  const digest = (...args) => sha256(canonicalJson(runProfile('session-only', ...args)));
  for (const backend of BACKENDS) {
    assert.equal(runProfile('session-only', undefined, backend, 'claude').windowing.skimSideBytes, 12_000);
    assert.notEqual(digest(undefined, backend, 'claude'), digest(undefined, backend), backend);
    for (const harness of ['codex', 'cursor', 'unknown', undefined])
      assert.equal(digest(undefined, backend, harness), digest(undefined, backend), `${backend}/${String(harness)}`);
    // A combined profile is one for every harness.
    if (backend !== 'codex-cli')
      assert.equal(sha256(canonicalJson(runProfile('combined', undefined, backend, 'claude'))),
        sha256(canonicalJson(runProfile('combined', undefined, backend))));
  }
  assert.equal(sr.sessionProfileDigest(undefined, 'claude-cli', 'claude'), digest(undefined, 'claude-cli', 'claude'));
  assert.equal(sr.sessionProfileDigest(), digest());
});

test('D103 a review stores its windows under the profile of its recording\'s harness', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d103-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const s = session([ask('I1', 'Run it.'), run('A1', 'npm test'), out('A1-r', 'A1', sized(30_000)), said('C1', 'Done.')]);
  const identity = { backend: 'claude-cli', model: 'sonnet' };
  const answerCache = createAnswerCache(join(dir, 'answers'), identity);
  await sr.reviewSession({ session: s, answerCache, store: sr.createSessionReviewStore(join(dir, 'review')), ...identity,
    judge: async (request) => (request.challenge ? { votes: [] }
      : { decisions: [], pivots: [], claims: [], requirements: [] }) });
  const [name] = (await readdir(join(dir, 'review', 'windows'))).filter((n) => !n.startsWith('.'));
  const record = JSON.parse(await readFile(join(dir, 'review', 'windows', name), 'utf8'));
  const [built] = planWindowRequests({ session: s, reviewScope: 'session-only', backend: identity.backend }).requests;
  const keyOf = (profile) => sr.windowKeyOf({ answerKey: answerCache.keyOf(built.request), profile, window: 1 });
  assert.equal(record.windowKey, keyOf(sr.sessionProfileDigest(undefined, identity.backend, 'claude')));
  assert.notEqual(record.windowKey, keyOf(sr.sessionProfileDigest(undefined, identity.backend)));
});
