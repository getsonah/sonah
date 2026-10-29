// D171 (the owner, 2026-10-28: "a page-footer line for /sonah users"): the page's footer says that a newer Sonah is out
// when the CLI hands the report model that fact (`newerVersion`, its update check's answer), after the line that names
// Sonah. With no such fact the page is as before, byte for byte; the .md never carries it. Pure: the render reads no
// clock and no network, and the same input gives the same bytes. Synthetic fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel, visibleWords } from '../report-model.js';
import { PAGE_LIMITS, sessionPage } from '../session-page.js';
import { renderReportMarkdown } from '../session-story.js';
import { REPORT_FOOTER_WORDS } from '../report-words.js';
import { REPORT_SHAPES, reportSession, repoFacts, sessionReviewOnlyReport } from './report-fixture.js';

const NEWER = '0.3.0-beta.10';
const LINE = `<p>${REPORT_FOOTER_WORDS.newer(NEWER)}</p>`;

test('the footer line: its words, after the line that names Sonah, only with the fact', () => {
  assert.equal(REPORT_FOOTER_WORDS.newer(NEWER), 'Sonah 0.3.0-beta.10 is out. Update with npm install -g getsonah@latest.');
  for (const [shape, make] of Object.entries(REPORT_SHAPES)) {
    const session = reportSession(), report = make(session);
    const facts = { ...repoFacts(), sessionHash: 'a'.repeat(64) };
    const without = sessionPage(session, report, facts).html;
    const withNewer = sessionPage(session, report, { ...facts, newerVersion: NEWER }).html;
    assert.ok(!without.includes(LINE), shape);
    assert.equal(withNewer.split(LINE).length, 2, `${shape}: said once`);
    assert.equal(withNewer.replace(LINE, ''), without, `${shape}: the page differs by that line alone`);
    assert.match(withNewer, new RegExp(`<footer class="foot"><p class="gen">[^<]*</p>${LINE.replace(/[.*+?^${}()|[\]\\]/g,
      '\\$&')}`), `${shape}: right after the line that names Sonah`);
    assert.equal(sessionPage(session, report, { ...facts, newerVersion: NEWER }).html, withNewer, `${shape}: pure`);
    // The model: the line, or null.
    assert.equal(reportModel(session, report, facts).footer.newer, null);
    assert.equal(reportModel(session, report, { ...facts, newerVersion: NEWER }).footer.newer,
      REPORT_FOOTER_WORDS.newer(NEWER));
    // The .md never carries it.
    assert.equal(renderReportMarkdown(session, report, { ...facts, newerVersion: NEWER }),
      renderReportMarkdown(session, report, facts), `${shape}: the .md is the same`);
  }
});

test('no line for a fact that is not a version string, and no other byte moves', () => {
  const session = reportSession(), report = REPORT_SHAPES.a(session);
  const facts = repoFacts();
  const without = sessionPage(session, report, facts).html;
  for (const value of [undefined, null, '', 42, true, {}, ['1.0.0'], '<b>1.0.0</b>', '1.0.0 beta', 'x'.repeat(41)]) {
    assert.equal(sessionPage(session, report, { ...facts, newerVersion: value }).html, without, String(value));
    assert.equal(reportModel(session, report, { ...facts, newerVersion: value }).footer.newer, null, String(value));
  }
});

test('the words a reader sees count the line when the page shows it', () => {
  const session = reportSession(), report = REPORT_SHAPES.a(session);
  const plain = visibleWords(reportModel(session, report, repoFacts()));
  const newer = visibleWords(reportModel(session, report, { ...repoFacts(), newerVersion: NEWER }));
  assert.ok(newer > plain, `${plain} words, then ${newer}`);
});

test('at the page\'s size bound the line moves nothing else: the same parts kept, the same whole, the same .md', () => {
  // D171 fix round: the line is not weighed against the bound. The fixture's second ask, padded until the page without
  // the line is whole and within the line's bytes of the bound, so that weighing it would cut the page.
  const bytes = (text) => Buffer.byteLength(text, 'utf8');
  const padded = (n) => {
    const session = reportSession();
    const ask = session.events.find((event) => event.id === 'I2');
    const [span] = ask.text;
    const text = `${session.blobs[span.sourceKey]}${' pad'.repeat(n)}`;
    session.blobs[span.sourceKey] = text;
    ask.text = [{ ...span, untilByte: bytes(text) }];
    return session;
  };
  const page = (n, extra = {}) => {
    const session = padded(n);
    return sessionPage(session, sessionReviewOnlyReport(session), { ...repoFacts(), ...extra });
  };
  let whole = 0, cut = 200_000;
  assert.ok(page(whole).whole && !page(cut).whole, 'premise: the padding crosses the bound');
  while (cut - whole > 1) { const mid = Math.floor((whole + cut) / 2); if (page(mid).whole) whole = mid; else cut = mid; }
  const without = page(whole);
  assert.ok(bytes(without.html) <= PAGE_LIMITS.maxBytes && bytes(without.html) + bytes(LINE) > PAGE_LIMITS.maxBytes,
    `premise: ${bytes(without.html)} bytes, whole, within the line of the bound`);
  const withNewer = page(whole, { newerVersion: NEWER });
  assert.equal(withNewer.whole, true, 'still whole');
  assert.equal(withNewer.html.replace(LINE, ''), without.html, 'the page differs by that line alone');
  assert.equal(bytes(withNewer.html), bytes(without.html) + bytes(LINE), 'past the bound by that line');
  const session = padded(whole), report = sessionReviewOnlyReport(session);
  assert.equal(renderReportMarkdown(session, report, { ...repoFacts(), page: { whole: withNewer.whole } }),
    renderReportMarkdown(session, report, { ...repoFacts(), page: { whole: without.whole } }), 'the .md the CLI writes');
});
