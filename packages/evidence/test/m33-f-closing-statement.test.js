// M33 F repair 3, the adapter and the review. A closing statement (slicer `sayings`) is no longer cut by the slicer
// before redaction; redaction scrubs it whole and only then bounds the scrubbed text around Sonah's own marker
// (redact/index.js `STATEMENT_OMISSION`). The adapter never lets a quote cross that marker, and declares the cut as what
// it is — this review's, not the recorder's (the recorder kept the whole statement) — by its own note, which the review
// header names by its own coverage cause `statements_capped`. A statement cut before redaction by an older slicer
// ('[…]') is still split and declared, in the same words: that cut was Sonah's too.
//
// D68 (E) (owner decision 2026-10-07): what the agent produced is kept whole, so redaction bounds no statement any
// more; a statement an earlier Sonah bounded (its marker on a line of its own) is still read, split and declared here.
//
// End to end, a token straddling either cut reaches neither the ledger, the session nor a review request.
//
// Synthetic Codex rollouts and synthetic ledgers only. No recording, no model, no network. Nothing prints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionFromLedger, CLOSING_STATEMENT_CLIPPED_NOTE, HELPER_REPORT_CLIPPED_NOTE } from '../adapters/sonah-ledger.js';
import { verifyReceipt } from '../src/session.js';
import { buildLedger } from '../src/ledger.js';
import { coverageCauses, renderReview, COVERAGE_CAUSES, COVERAGE_SENTENCE } from '../src/review.js';
import { planWindowRequests } from '../src/run-review.js';
import { sliceLineage } from '../../slicer/index.js';
import { redact, STATEMENT_OMISSION } from '../../redact/index.js';

/** The 8,000 / 6,000 / 2,000 code points an earlier Sonah bounded a statement by (M33 F to D68 E). */
const STATEMENT_CAP = Object.freeze({ chars: 8000, head: 6000, tail: 2000 });
/** A statement as an earlier Sonah persisted it: its first and last lines around the marker on a line of its own. */
const persistedBound = (lines, head = 150, tail = 50) => [...lines.slice(0, head), STATEMENT_OMISSION, ...lines.slice(-tail)].join('\n');
import { SECRET, rootMeta, ask, said, jsonl } from './m33-f-final-answer-fixture.js';

const repo = { host: 'local', id: 'synthetic' };
const GHP = `ghp_${'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz'.slice(0, 36)}`;
const leaks = (text, token) => Array.from({ length: token.length - 7 }, (_, i) => token.slice(i, i + 8))
  .filter((fragment) => text.includes(fragment));
const LINE = 'checked the parser module and left it as it was';
const prose = (n) => {
  let out = '';
  while (out.length + LINE.length + 1 <= n) out += `${LINE}\n`;
  return out + 'y'.repeat(n - out.length);
};
const straddling = (token, at, after) => `${prose(at)}${token} is the key\n${prose(after - 12)}`;
const acrossHead = (token, offset) => straddling(token, STATEMENT_CAP.head - offset, 4_000);
const acrossTail = (token, offset) => straddling(token, 7_000, STATEMENT_CAP.tail + offset - token.length);
const statementLines = (n) => Array.from({ length: n }, (_, i) => `Statement line ${String(i).padStart(4, '0')} said.`);
const compact = (text) => ({ ask: [{ turn: 1, text: 'summarise the work' }], commentary: [], ledger: [],
  claim: { finalMessage: '' }, dropped: [], sayings: [{ turn: 1, text }] });
const quotes = (session, eventId, quote) => verifyReceipt(session, { role: 'commentary', eventId, quote }).ok;
const promptsOf = (session) => planWindowRequests({ session, reviewScope: 'session-only' }).requests
  .map(({ request }) => request.evidencePrompt).join('\n');

test('M33 F repair 3 a statement cut before review: its marker is never quotable, and the cut is declared as Sonah\'s', () => {
  const lines = statementLines(400);
  // D68 (E): redaction keeps the statement whole now; a persisted one an earlier Sonah bounded keeps its marker.
  assert.equal(redact(compact(lines.join('\n'))).ledger.sayings[0].text, lines.join('\n'), 'nothing bounds it now');
  const ledger = redact(compact(persistedBound(lines))).ledger;
  assert.ok(ledger.sayings[0].text.includes(`\n${STATEMENT_OMISSION}\n`), 'the persisted marker stays');
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-f-statement' });
  const said = session.events.filter((event) => event.kind === 'commentary');
  assert.deepEqual(said.map((event) => [event.id, event.phase]), [['F1', 'final']]);
  const spans = session.textSpansOf(said[0], 'text');
  assert.equal(spans.length, 2, 'head and tail are two sources: the marker is this review\'s words');
  assert.equal(spans.some((span) => span.includes(STATEMENT_OMISSION) || span.includes('[…')), false);
  assert.equal(quotes(session, 'F1', lines[0]), true);
  assert.equal(quotes(session, 'F1', lines.at(-1)), true);
  const head = spans[0].split('\n').at(-1);
  assert.equal(quotes(session, 'F1', `${head}\n${STATEMENT_OMISSION}`), false);
  assert.equal(quotes(session, 'F1', `${head}\n${spans[1].trim().split('\n')[0]}`), false, 'no quote spans the cut');
  // Declared as this review's cut, in its own words, never the recorder's.
  const clipped = session.adapterGaps.filter((gap) => gap.code === 'source_clipped');
  assert.deepEqual(clipped.map((gap) => [gap.channel, gap.count, gap.note]), [['commentary', 1, CLOSING_STATEMENT_CLIPPED_NOTE]]);
  assert.equal(CLOSING_STATEMENT_CLIPPED_NOTE,
    'a closing statement was capped before review; its head and tail are quotable, the elided middle is not');
  assert.doesNotMatch(CLOSING_STATEMENT_CLIPPED_NOTE, /recorder/);
  assert.notEqual(CLOSING_STATEMENT_CLIPPED_NOTE, HELPER_REPORT_CLIPPED_NOTE);
  // The review names it by its own cause, and its line under "What was not checked" does not credit the recorder.
  const built = buildLedger({ repo, session, pr: null, sessionCoverage: 'complete' });
  assert.deepEqual(coverageCauses(built).filter(([cause]) => ['statements_capped', 'source_clipped'].includes(cause)),
    [['statements_capped', { n: 1 }]]);
  assert.equal(COVERAGE_CAUSES.indexOf('statements_capped'), COVERAGE_CAUSES.indexOf('reports_capped') + 1);
  assert.equal(COVERAGE_SENTENCE.statements_capped({ n: 1 }),
    '1 closing statement was capped before review, so its elided middle cannot be quoted');
  assert.equal(COVERAGE_SENTENCE.statements_capped({ n: 2 }),
    '2 closing statements were capped before review, so their elided middle cannot be quoted');
  const text = renderReview(built);
  assert.match(text, /1 closing statement was capped before review, so its elided middle cannot be quoted/);
  const line = text.split('\n').find((row) => row.startsWith('- `source_clipped`'));
  assert.ok(line && line.includes(CLOSING_STATEMENT_CLIPPED_NOTE), text);
  assert.doesNotMatch(line, /recorder/);
  // A clipped commentary gap declared without that note keeps the cause it always had.
  assert.equal(COVERAGE_SENTENCE.source_clipped({ n: 1 }),
    '1 recorded text(s) were cut short by the recorder, so what was cut cannot be quoted');
});

test('M33 F repair 3 a side the bound left empty emits nothing, and the cut is still declared', () => {
  const session = sessionFromLedger(redact(compact(STATEMENT_OMISSION)).ledger, { sessionKey: 'm33-f-empty' });
  assert.deepEqual(session.events.filter((event) => event.kind === 'commentary'), [], 'no event of the marker alone');
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'source_clipped')
    .map((gap) => [gap.channel, gap.count, gap.note]), [['commentary', 1, CLOSING_STATEMENT_CLIPPED_NOTE]]);
});

test('M33 F repair 3 an older ledger\'s pre-redaction cut is still split, never quoted across, and declared the same way', () => {
  const session = sessionFromLedger(compact('HEAD-OF-THE-STATEMENT\n[…]\nTAIL-OF-THE-STATEMENT'), { sessionKey: 'legacy' });
  assert.deepEqual(session.events.filter((event) => event.kind === 'commentary').map((event) => event.id), ['F1-head', 'F1-tail']);
  assert.deepEqual(session.adapterGaps.filter((gap) => gap.code === 'source_clipped')
    .map((gap) => [gap.channel, gap.count, gap.note]), [['commentary', 1, CLOSING_STATEMENT_CLIPPED_NOTE]]);
});

test('M33 F repair 3, D68 (E) end to end: a token at either retired cut reaches no ledger, session or review request', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-m33-f-statement-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let n = 0;
  for (const [name, token] of Object.entries({ ghp: GHP, sk: SECRET })) {
    for (const [side, build] of [['head', acrossHead], ['tail', acrossTail]]) {
      for (let offset = -2; offset <= token.length + 2; offset += name === 'ghp' ? 3 : 7) {
        const where = `${name} across the ${side} cut at ${offset}`;
        const statement = build(token, offset);
        // The recorded rollout: the statement is one assistant message, so it is also the turn's commentary block.
        const file = join(dir, `rollout-2026-10-01T12-00-00-e2e-${n++}.jsonl`);
        await writeFile(file, jsonl([rootMeta(), ask(), said(statement)]));
        const ledger = redact(await sliceLineage([file])).ledger;
        const session = sessionFromLedger(ledger, { sessionKey: `e2e-${n}` });
        assert.deepEqual(leaks(JSON.stringify(ledger), token), [], `${where}: ledger`);
        assert.deepEqual(leaks(JSON.stringify(session.blobs), token), [], `${where}: session`);
        assert.deepEqual(leaks(promptsOf(session), token), [], `${where}: review requests`);
        // The whole statement is the block that carries it (scrubbed): one event, no duplicate, nothing clipped.
        // (C-01 event identity: told apart by kind and phase, never by an id's shape.)
        assert.deepEqual(session.events.filter((event) => event.kind === 'commentary').map((event) => event.phase), ['final'], where);
        assert.equal(session.adapterGaps.some((gap) => gap.code === 'source_clipped'), false, where);
        // A ledger whose statement no block carries (compact) keeps it too, whole: nothing clipped.
        const alone = sessionFromLedger(redact(compact(statement)).ledger, { sessionKey: `alone-${n}` });
        assert.deepEqual(leaks(JSON.stringify(alone.blobs), token), [], `${where}: compact session`);
        assert.deepEqual(leaks(promptsOf(alone), token), [], `${where}: compact review requests`);
        assert.equal(alone.adapterGaps.some((gap) => gap.code === 'source_clipped'), false, `${where}: compact`);
      }
    }
  }
});
