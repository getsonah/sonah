// M36 phase 2 review (owner decisions 2026-10-07, D68 P, R, T, H, critique c1, c4; C-05 "M36 grounding per shown
// span", C-07 "M36 window format"). Each finding of the phase's review, reproduced and held fixed:
//   - the report grounds every decision and finding in the session as the window that proposed it showed it (c4);
//   - a helper's report its parent received is shown whole, like what the agent produced (P);
//   - an inline mask the adapter cut out of an output's refs stays in its line: lines and cuts follow the stored text (T);
//   - a prior state is labelled by the event that recorded it, a Read with its typed lines (c1);
//   - a tail never stops making progress on a block that opens with a line break;
//   - an output Sonah withheld is said to be withheld, never labelled a recorded empty result (R, L);
//   - a single omitted line the tail shows in part is said so (T);
//   - a Grep's pattern and a Read's offset and limit are its input whatever its path (P).
//
// Synthetic sessions and recordings only. No real recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Session } from '../src/session.js';
import { WINDOW_SETTINGS, COMBINED_WINDOW_SETTINGS, bytesOfTokens, eventView, lineCut, lineCount, shownBytes, SHOWN_GAPS }
  from '../src/windows.js';
import { planWindowRequests, runReview } from '../src/run-review.js';
import { omittedLine, OUTPUT_WITHHELD_WORDS } from '../src/prompt.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

const blobs = {};
let counter = 0;
const key = () => `m36r${++counter}`;
/** A text ref to a fresh blob holding `text`. */
const ref = (text) => {
  const k = key();
  blobs[k] = text;
  return [{ sourceKey: k, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
};
/** `text` stored whole, exposed as the ranges between its markers — exactly as the adapter's `putAround` lays refs. */
const around = (text, marker) => {
  const k = key();
  blobs[k] = text;
  const at = (index) => Buffer.byteLength(text.slice(0, index), 'utf8');
  const refs = [];
  let cursor = 0;
  for (const match of text.matchAll(marker)) {
    if (match.index > cursor) refs.push({ sourceKey: k, fromByte: at(cursor), untilByte: at(match.index) });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) refs.push({ sourceKey: k, fromByte: at(cursor), untilByte: at(text.length) });
  return refs;
};
const TOKEN = /‹redacted(?::[^›\n]+)?›/g;
const NOTE = /(?:^|\n)\[… \d+ line\(s\) dropped: [A-Za-z][A-Za-z -]*[A-Za-z] …\](?=\n|$)/g;
const ask = (id, text) => ({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(text) });
const said = (id, text) => ({ id, kind: 'commentary', phase: 'final', beforeInvocation: null, text: ref(text) });
const run = (id, command, over = {}) => ({ id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command',
  paths: [], command: ref(command), input: [], changes: [], ...over });
const out = (id, invocation, text, over = {}) => ({ id, kind: 'observation', invocation, callKey: invocation,
  phase: 'terminal', result: 'succeeded', exitCode: 0, terminalStatusProven: true, sourceOfResult: 'native',
  output: ref(text), ...over });
const session = (events) => new Session({ sessionKey: 'm36-review', adapter: 'claude', blobs: { ...blobs },
  events: events.map((event, sequence) => ({ ...event, sequence })) });
const lines = (n, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1} of the synthetic output`).join('\n');
const SIDE = bytesOfTokens(WINDOW_SETTINGS.trimTokens) / 2;

// ---- (c4) the report publishes what the window grounded ---------------------------------------------------------------

test('M36 review c4: a claim contradicted only by a result\'s omitted middle publishes no finding in the report', async () => {
  const rows = Array.from({ length: 400 }, (_, i) => (i === 199 ? 'line 200 FAILED: assertion error in parser'
    : `line ${i + 1} ok in the synthetic output`)).join('\n');
  const s = session([ask('I1', 'Run the checks and tell me.'), run('A1', './check.sh'), out('A1-r', 'A1', rows),
    said('C1', 'Done: every check passed, nothing failed.')]);
  const plan = planWindowRequests({ session: s, reviewScope: 'session-only' });
  const prompt = plan.requests[0].request.prompt;
  assert.ok(!prompt.includes('line 200 FAILED'), 'premise: the failing line is in the cut middle');
  const alias = (header) => prompt.match(new RegExp(`^\\[(E\\d+)\\] ${header}`, 'm'))[1];
  const review = (quote) => runReview({ session: s, pr: null, reviewScope: 'session-only', plan,
    judge: async (request) => (request.challenge ? { votes: request.challenge.items.map(({ key: k, candidate }) => ({ key: k,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: [candidate?.stated
        ?? { eventId: alias('HUMAN'), role: 'instruction', quote: 'Run the checks' }] })) }
      : { decisions: [], pivots: [], requirements: [], writtenClaims: [],
        claims: [{ text: 'every check passed', stated: { eventId: alias('AGENT SAID'), role: 'commentary',
          quote: 'every check passed, nothing failed' },
        contradictedBy: { eventId: alias('RESULT'), role: 'observation', quote } }] }) });
  const hidden = await review('line 200 FAILED: assertion error in parser');
  assert.equal(hidden.windowResults[0].grounding.rejectedFindings, 1, 'the window withheld it');
  assert.equal(hidden.findings.length, 0, 'and so does the report: never re-grounded in the whole recorded text');
  // A contradiction the window showed still publishes.
  const shown = await review('line 2 ok in the synthetic output');
  assert.equal(shown.findings.length, 1);
  assert.deepEqual(shown.findings[0].receipts.map((r) => r.role), ['commentary', 'observation']);
});

test('M36 review c4: a joint (combined) answer\'s session finding quoting a result\'s omitted middle is withheld', async () => {
  const { runCodeReview } = await import('../src/code-review.js');
  const { redisPivotPr } = await import('../fixtures/redis-pivot.js');
  const rows = Array.from({ length: 400 }, (_, i) => (i === 199 ? 'line 200 FAILED: assertion error in parser'
    : `line ${i + 1} ok in the synthetic output`)).join('\n');
  const s = session([ask('I1', 'Run the checks and tell me.'), run('A1', './check.sh'), out('A1-r', 'A1', rows),
    said('C1', 'Done: every check passed, nothing failed.')]);
  const pr = { ...redisPivotPr(), headOid: 'a'.repeat(40), enumeration: 'complete',
    files: [{ path: 'config/redis.yml', change: 'added', contentState: 'complete' }] };
  const diff = ['diff --git a/config/redis.yml b/config/redis.yml', 'new file mode 100644', '--- /dev/null',
    '+++ b/config/redis.yml', '@@ -0,0 +1,2 @@', '+cache:', '+  backend: redis', ''].join('\n');
  const finding = (quote) => ({ origin: 'session-review', kind: 'claim_contradicted', title: 'The checks did not all pass',
    explanation: 'Synthetic: the closing message says every check passed; the run recorded otherwise.',
    scope: 'session-effect', anchor: null, receipts: [{ role: 'commentary', eventId: 'C1', quote: 'every check passed, nothing failed' },
      { role: 'observation', eventId: 'A1-r', quote }] });
  const review = (quote) => runCodeReview({ session: s, pr, diff,
    judge: async () => ({ decisions: [], pivots: [], claims: [], requirements: [], codeFindings: [],
      sessionFindings: [finding(quote)], reviewedFiles: ['config/redis.yml'] }),
    challengeJudge: async ({ challenge }) => ({ votes: challenge.items.map(({ key, candidate }) => ({ key,
      verdict: 'not-refuted', explanation: 'Synthetic.', receipts: candidate.receipts ?? [] })) }) });
  const contradicted = (report) => report.findings.filter((f) => f.kind === 'claim_contradicted');
  assert.equal(contradicted(await review('line 200 FAILED: assertion error in parser')).length, 0,
    'the combined window cut that line: it grounds in no span the window showed');
  assert.equal(contradicted(await review('line 2 ok in the synthetic output')).length, 1, 'a shown span still grounds');
});

// ---- (P) a helper's report is what the agent produced ------------------------------------------------------------------

test('M36 review P: a helper\'s report its parent received is shown whole; over a window\'s whole budget alone it is cut, declared', () => {
  const report = lines(400, 'reported');
  const s = session([ask('I1', 'Delegate.'), { id: 'D1', kind: 'invocation', callKey: 'D1', tool: 'Agent',
    operation: 'delegate', paths: [], command: [], input: ref('Look into it.'), changes: [] },
  out('D1-r', 'D1', report, { result: 'unknown', exitCode: null, helperReported: true }),
  run('A1', 'cat big.txt'), out('A1-r', 'A1', report)]);
  const whole = eventView(s, s.event('D1-r'));
  assert.equal(whole.fields[0].omitted, null, 'whole, though over the 2k trim');
  assert.equal(whole.fields[0].spans.join(''), report);
  assert.ok(eventView(s, s.event('A1-r')).fields[0].omitted, 'any other result is cut by the positional rule');
  assert.equal(shownBytes(s, s.event('D1-r')), Buffer.byteLength(report), 'planned as shown');
  const huge = `${lines(9_000, 'reported')}\n`;
  const big = session([{ ...out('D2-r', 'D2', huge, { result: 'unknown', exitCode: null, helperReported: true }) }]);
  const cut = eventView(big, big.event('D2-r'), COMBINED_WINDOW_SETTINGS).fields[0];
  assert.equal(cut.gap, SHOWN_GAPS.reportOverBudget);
  assert.ok(cut.spans.reduce((n, x) => n + Buffer.byteLength(x), 0) <= bytesOfTokens(COMBINED_WINDOW_SETTINGS.workTokens));
  assert.match(omittedLine('E2', cut, null, 'report'), /of this report, [\d,]+ UTF-8 bytes, are not shown \(report_over_budget: /);
});

// ---- (T) lines are the stored text's own --------------------------------------------------------------------------------

test('M36 review T: an inline mask cut out of an output\'s refs stays in its line; the cut and its omitted lines follow the stored text', () => {
  const rows = Array.from({ length: 300 }, (_, i) => `L${String(i + 1).padStart(3, '0')} ${'z'.repeat(30)}`);
  rows[99] = `L100 TOKEN=‹redacted:aws-key› ${'q'.repeat(40)}`;
  const text = `${rows.join('\n')}\n`;
  const s = session([run('A1', 'cat env.txt'), { ...out('A1-r', 'A1', ''), output: around(text, TOKEN) }]);
  const event = s.event('A1-r');
  const regions = s.textRegionsOf(event, 'output');
  assert.equal(regions.text, text, 'the stored text, the mask in its own line (never a line break of its own)');
  const at = text.indexOf('‹redacted');
  assert.deepEqual(s.textSpansOf(event, 'output'), [text.slice(0, at), text.slice(at + '‹redacted:aws-key›'.length)],
    'the quotable spans are what they were: the mask is never quotable');
  const view = eventView(s, event);
  assert.equal(view.lines, 300);
  const output = view.fields[0];
  const head = output.spans.slice(0, output.headCount).join(''), tail = output.spans.slice(output.headCount).join('');
  assert.ok(head.endsWith('\n') && !head.includes('TOKEN'), 'the head ends on a whole line before the masked one');
  assert.deepEqual(output.omitted, { fromLine: lineCount(head) + 1, throughLine: 300 - lineCount(tail), partFrom: false,
    partThrough: false });
  assert.equal(output.omitted.fromLine, 100);
  // A dropped-lines note keeps its own line, as before.
  const noted = 'kept 1\n[… 2 line(s) dropped: private key …]\nkept 2';
  const t = session([run('A2', 'cat key'), { ...out('A2-r', 'A2', ''), output: around(noted, NOTE) }]);
  assert.equal(t.textRegionsOf(t.event('A2-r'), 'output').text, noted);
  assert.equal(eventView(t, t.event('A2-r')).lines, 3);
  // Two blobs, or an unreadable ref between, are still joined by one line break.
  const twoBlobs = session([{ ...out('A3-r', 'A3', ''), output: [...ref('one'), ...ref('two')] }]);
  assert.equal(twoBlobs.textRegionsOf(twoBlobs.event('A3-r'), 'output').text, 'one\ntwo');
});

test('M36 review T: one omitted line the tail shows in part is said to be shown in part', () => {
  const text = `OK\n${'x'.repeat(20_000)}`;
  const cut = lineCut({ text, ranges: [{ from: 0, until: text.length }] }, SIDE);
  assert.deepEqual(cut.omitted, { fromLine: 2, throughLine: 2, partFrom: false, partThrough: true });
  assert.match(omittedLine('E3', { ...cut, gap: null }), /line 2 of this output, [\d,]+ UTF-8 bytes, is not shown; line 2 in part/);
  const both = `${'x'.repeat(20_000)}`;
  const one = lineCut({ text: both, ranges: [{ from: 0, until: both.length }] }, SIDE);
  assert.deepEqual(one.omitted, { fromLine: 1, throughLine: 1, partFrom: true, partThrough: true });
  assert.match(omittedLine('E3', { ...one, gap: null }), /is not shown; line 1 in part —/, 'named once');
});

test('M36 review: a tail over a block that opens with a line break always makes progress', { timeout: 10_000 }, () => {
  const edit = { id: 'E1', kind: 'invocation', callKey: 'E1', tool: 'edit', operation: 'edit', paths: [{ path: 'a.txt' }],
    command: [], input: [], changes: [{ path: 'a.txt', before: [], after: [], diff: [], extent: { recorded: true } }],
    recorded: { tool: 'Edit', hunkScrub: 'file',
      hunks: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 4, lines: [` ${'x'.repeat(40)}`, '+', '+abcdefghij', ' yyyyyyyy'] }] } };
  const s = session([edit]);
  // Budget 36 bytes, a side of 18: the last run (8 bytes) leaves 10, exactly the added run's bytes ('\nabcdefghij') - 1.
  const view = eventView(s, s.event('E1'), { workTokens: 10, carriedTokens: 0, trimTokens: 2 }).edit;
  assert.equal(view.gap.reason, 'edit_over_budget');
  assert.deepEqual(view.blocks.map((b) => [b.run.side, b.part, b.spans.join('')]),
    [['context', 'head', 'x'.repeat(18)], ['added', 'tail', 'abcdefghij'], ['context', null, 'yyyyyyyy']]);
});

// ---- recordings through the production path: withheld outputs, prior states, read inputs -----------------------------

const SID = 'c0ffee00-0000-4000-8000-0000000036e2';
let uuid = 0;
const row = (extra) => ({ cwd: '/repo', entrypoint: 'cli', gitBranch: 'main', isSidechain: false, parentUuid: null,
  sessionId: SID, timestamp: '2026-10-07T00:00:00Z', userType: 'external', uuid: `m36r-${++uuid}`, version: '2.1.284',
  ...extra });
const human = (text) => row({ type: 'user', origin: { kind: 'human' }, promptSource: 'sdk', message: { role: 'user', content: text } });
const agentSaid = (text) => row({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolCall = (id, name, input) => row({ type: 'assistant', message: { role: 'assistant',
  content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id, content, sidecar) => row({ type: 'user', ...(sidecar ? { toolUseResult: sidecar } : {}),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] } });
async function recorded(rows) {
  const dir = await mkdtemp(join(tmpdir(), 'm36r-'));
  try {
    const path = join(dir, `${SID}.jsonl`);
    await writeFile(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const s = sessionFromLedger(redact(await sliceLineage([path], { cwd: '/repo' })).ledger, { sessionKey: 's' });
    return { session: s, prompt: planWindowRequests({ session: s, reviewScope: 'session-only' }).requests[0].request.prompt };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

test('M36 review R, L: an output Sonah withheld is said to be withheld — never labelled a recorded empty result', async () => {
  const settings = '/repo/config/.env';
  const { session: s, prompt } = await recorded([human('Check the settings.'), toolCall('r9', 'Read', { file_path: settings }),
    toolResult('r9', '     1\tMODE=x\n     2\tLEVEL=y', { type: 'text', file: { filePath: settings, content: 'MODE=x\nLEVEL=y',
      numLines: 2, startLine: 1, totalLines: 2 } }), agentSaid('Read it.')]);
  const result = s.events.find((e) => e.kind === 'observation');
  assert.equal(result.outputWithheld, true);
  const label = prompt.split('\n').find((l) => l.startsWith('  recorded: tool Read'));
  assert.ok(label.endsWith(` · read lines 1–2 of 2 · ${OUTPUT_WITHHELD_WORDS}`), 'the recorder\'s facts kept, no size');
  assert.ok(!label.includes('0 line(s)'));
  const after = prompt.slice(prompt.indexOf(label) + label.length).split('\n')[1];
  assert.ok(!after.startsWith('<<<'), 'no empty fence beside it');
});

test('M36 review c1, P: a prior state from a partial Read is labelled by that Read and its typed lines; a Grep keeps its pattern', async () => {
  const FILE = '/repo/src/config.js';
  const file = Array.from({ length: 600 }, (_, i) => `const v${i + 1} = ${i + 1};`);
  const part = file.slice(99, 149);
  const { session: s, prompt } = await recorded([human('Raise v120.'),
    toolCall('g1', 'Grep', { pattern: 'SYNTHETIC_retryCount', path: '/repo/src', output_mode: 'files_with_matches' }),
    toolResult('g1', 'Found 1 file\nsrc/config.js', { mode: 'files_with_matches', filenames: ['src/config.js'], numFiles: 1 }),
    toolCall('r1', 'Read', { file_path: FILE, offset: 100, limit: 50 }),
    toolResult('r1', part.map((l, i) => `${String(100 + i).padStart(6)}\t${l}`).join('\n'),
      { type: 'text', file: { filePath: FILE, content: part.join('\n'), numLines: 50, startLine: 100, totalLines: 600 } }),
    toolCall('e1', 'Edit', { file_path: FILE, old_string: file[119], new_string: 'const v120 = 999;' }),
    toolResult('e1', 'The file has been updated successfully.'), agentSaid('Raised v120.')]);
  const aliases = (tool) => [...prompt.matchAll(new RegExp(`^\\[(E\\d+)\\] ACTION · tool=${tool}`, 'gm'))].map((m) => m[1]);
  const [, read] = aliases('read'); // the Grep, then the Read
  const [edit] = aliases('edit');
  assert.ok(prompt.includes(`  src/config.js, lines 100–149 of 600, as read at [${read}] (50 line(s), `));
  // D71 (S2): a session-only request offers the request under the brief's last step (S3: step 6).
  assert.ok(prompt.includes(`is not shown: ask for [${edit}] and a line range of it, counted from its own first line `
    + "under step 6 if a row's status depends on it."));
  assert.ok(!prompt.includes(`as recorded before [${edit}]`), 'never framed as the call\'s own record');
  const change = s.events.find((e) => e.operation === 'edit').changes[0];
  assert.deepEqual({ ...change.priorRecord, eventId: typeof change.priorRecord.eventId },
    { source: 'read', eventId: 'string', partial: true, window: { from: 100, to: 149, total: 600 } });
  // P: the agent's own query fields are its tool input, whatever its path.
  assert.ok(prompt.includes('SYNTHETIC_retryCount'), 'the Grep pattern is shown');
  assert.match(prompt, /"offset": ?100/);
});

test('M36 review: a helper\'s Edit keeps its own replaced text and the Read that recorded its prior state, renamed into its parent', () => {
  const child = { ask: [], instructions: [{ turn: 1, text: 'Change b.' }],
    ledger: [{ turn: 1, seq: 0, kind: 'read', path: 'src/b.js', tailLines: ['const b = 1;', 'const c = 3;'] },
      { turn: 1, seq: 1, kind: 'edit', path: 'src/b.js', after: { text: 'const b = 2;\n⟪→⟫\nconst b = 1;', parts: 1 },
        before: { text: 'const b = 1;\nconst c = 3;', source: 'read', turn: 1, seq: 0, partial: false, truncated: false, lines: 2 },
        result: { seen: true, outcome: 'succeeded', provenance: 'native' } }],
    commentary: [], sayings: [], marks: [], claim: { finalMessage: '' }, dropped: [] };
  const ledger = { ask: [{ turn: 1, text: 'Delegate the change.' }], commentary: [], sayings: [], marks: [],
    ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'ls', outcome: 'passed', exitCode: 0, tailLines: ['parent own text'] }],
    delegations: [{ turn: 1, status: 'linked', kind: 'spawn', childId: '0123456789abcdef', link: { source: 0 },
      parentInstruction: { text: 'Change b.', tool: 'Agent' } }],
    children: [{ source: 0, ledger: child }], claim: { finalMessage: '' }, dropped: [] };
  const s = sessionFromLedger(ledger, { sessionKey: 'parent' });
  const edit = s.events.find((e) => e.operation === 'edit');
  assert.ok(edit.childId, 'premise: the helper\'s edit, placed in its parent');
  const [change] = edit.changes;
  assert.equal(s.textOf(change, 'replaced'), 'const b = 1;', 'its own replaced text, from its own blob');
  const read = s.events.find((e) => e.kind === 'invocation' && e.childId && e.id !== edit.id && e.paths?.[0]?.path === 'src/b.js');
  assert.equal(change.priorRecord.eventId, read.id, 'the helper\'s Read, by its id in the parent');
  // The helper is a session of its own: its window shows the replaced text from its own blob.
  const prompts = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests.map((r) => r.request.prompt);
  assert.ok(prompts.some((p) => p.includes('  text it replaced in src/b.js (role=code):\n<<<\nconst b = 1;\n>>>')));
});

// ---- D69 review (finding F2): only a request that can ask is told how to ask --------------------------------------------

test('D69 review F2: a combined window states what it omits and offers no request; a session-only window says how to ask', () => {
  // A failed result of 2,000 lines: cut by the positional rule in both scopes.
  const s = session([ask('I1', 'Run the checks.'), run('A1', './check.sh'),
    out('A1-r', 'A1', lines(2_000, 'checked'), { result: 'failed', exitCode: 1 })]);
  const combined = planWindowRequests({ session: s, reviewScope: 'combined' }).requests[0].request;
  const sessionOnly = planWindowRequests({ session: s, reviewScope: 'session-only' }).requests[0].request;
  for (const request of [combined, sessionOnly]) assert.match(request.prompt, /omitted: lines [\d,]+–[\d,]+ of this output, [\d,]+ UTF-8 bytes, are not shown/);
  // The combined contract has no `evidenceRequests` member and no re-ask (D68 Q; D69 d): no channel is offered.
  assert.equal(Object.hasOwn(combined.schema.properties, 'evidenceRequests'), false, 'premise: combined has no request member');
  assert.ok(!combined.prompt.includes('available on request'));
  assert.ok(!combined.prompt.includes('evidenceRequests'));
  assert.match(combined.prompt, /are not shown\. Quote the shown spans only, never across the cut\./);
  assert.equal(Object.hasOwn(sessionOnly.schema.properties, 'evidenceRequests'), true);
  // D71 (S2): a session-only request offers the lines under its brief's last step (S3: step 6).
  assert.match(sessionOnly.prompt, /are not shown; ask for them under step 6 if a row's status depends on them \(\[E\d+\] lines [\d,]+–[\d,]+\)\. Quote the shown spans/);
  assert.ok(!sessionOnly.evidencePrompt.includes('ask for'), 'never offered to a challenger');
  const cut = { omitted: { fromLine: 3, throughLine: 9, partFrom: false, partThrough: false }, omittedBytes: 70, gap: null };
  assert.equal(omittedLine('E1', cut, null, 'output', false),
    '  omitted: lines 3–9 of this output, 70 UTF-8 bytes, are not shown. Quote the shown spans only, never across the cut.');
  assert.equal(omittedLine('E1', cut), '  omitted: lines 3–9 of this output, 70 UTF-8 bytes, are not shown — available on '
    + 'request as [E1] lines 3–9. Quote the shown spans only, never across the cut.', 'the default: a session-only line');
});
