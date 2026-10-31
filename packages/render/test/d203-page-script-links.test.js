// D203 (0.3.0-beta.11; the owner, 2026-10-31: "Yes, extend the script"): the page's one pinned script also follows an
// in-page link to its place. A link into another tab is that tab's label (D196's `tabLinks`), which opens the tab at its
// top with no script; the script then opens every fold around the place, brings it into view below the tab bar and
// focuses it, and lets such a label take keyboard focus. Its behaviour is checked in a browser; here,
// what node can check: the script's text holds those steps and nothing that loads, sends, stores or navigates; every
// page with an in-page link carries it by its hash; every place a link names is on the page; the stylesheet leaves room
// under the tab bar. Every session synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderSessionPage, PAGE_SCRIPT, PAGE_SCRIPT_HASH, PAGE_CSS } from '../session-page.js';
import { reportSession, triagedReport, repoFacts, REPORT_SHAPES } from './report-fixture.js';

test('D203: the script follows a link to its place: opens its folds, brings it into view, focuses it; a tab\'s label takes focus', () => {
  // The two kinds of in-page link the page writes, read after the label has opened its tab (a task after the click).
  assert.ok(PAGE_SCRIPT.includes(`'label.xl[data-href],a[href^="#"]'`));
  assert.ok(PAGE_SCRIPT.includes('setTimeout(function(){show(id);go(id)},0)'));
  // Every fold around the place, and the place when it is a fold, opens; then focus without a jump, then into view.
  for (const step of ["if(d.tagName==='DETAILS')d.open=true", "if(t.tagName==='DETAILS')t.open=true",
    "t.setAttribute('tabindex','-1')", 't.focus({preventScroll:true})', "t.scrollIntoView({block:'start'})"])
    assert.ok(PAGE_SCRIPT.includes(step), step);
  // A link that is a tab's label takes keyboard focus, and Enter or Space follows it.
  assert.ok(PAGE_SCRIPT.includes("document.querySelectorAll('label.xl[data-href]').forEach(function(l){l.tabIndex=0;"
    + "l.setAttribute('role','link')})"));
  // Its review: a tabindex the script added goes when the place loses focus, so a later click does not ring it again.
  assert.ok(PAGE_SCRIPT.includes("t.addEventListener('blur',function(){t.removeAttribute('tabindex')},{once:true})"));
  assert.ok(PAGE_SCRIPT.includes("if(e.key!=='Enter'&&e.key!==' ')return") && PAGE_SCRIPT.includes('l.click()'));
  // It loads, sends, stores and navigates nothing, and writes no markup. D204 (the owner: "Yes, add Back"): it reads the
  // address's fragment and its own history entries' state alone, and writes its own history entries alone.
  const rest = PAGE_SCRIPT.replace(/location\.hash/g, '').replace(/history\.(?:replaceState|pushState)\(/g, '')
    .replace(/history\.state\b/g, '');
  assert.equal(/fetch|XMLHttpRequest|sendBeacon|WebSocket|import|eval|Function\(|location|history|cookie|Storage|src|innerHTML|outerHTML|insertAdjacent|document\.write|open\(/
    .test(rest), false);
  assert.deepEqual([...new Set(PAGE_SCRIPT.match(/location\.\w+|history\.\w+/g))].sort(),
    ['history.pushState', 'history.replaceState', 'history.state', 'location.hash']);
  assert.equal(PAGE_SCRIPT_HASH, `sha256-${createHash('sha256').update(PAGE_SCRIPT).digest('base64')}`);
});

test('D203: every page with an in-page link carries the one script by its hash, and every place a link names is on the page', () => {
  const session = reportSession();
  const pages = [renderSessionPage(session, triagedReport(session), repoFacts()),
    ...Object.values(REPORT_SHAPES).map((shape) => renderSessionPage(session, shape(session), repoFacts()))];
  for (const html of pages) {
    const links = [...html.matchAll(/(?:data-href|href)="#([^"]+)"/g)].map((m) => m[1]);
    assert.ok(links.length > 0, 'the header\'s tiles at least');
    assert.equal((html.match(/<script>/g) ?? []).length, 1);
    assert.ok(html.includes(`<script>${PAGE_SCRIPT}</script>`) && html.includes(`script-src '${PAGE_SCRIPT_HASH}'`));
    const ids = new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
    assert.deepEqual([...new Set(links.filter((id) => !ids.has(id)))], [], 'a link names a place the page holds');
  }
});

test('D203: the stylesheet leaves room under the tab bar for any place a link brings into view, more on a phone', () => {
  // Every element with an id, a panel too (its review: a panel's heading went under the wrapped tab bar on a phone).
  assert.match(PAGE_CSS, /\n\[id\] \{ scroll-margin-top: 64px; \}/);
  assert.match(PAGE_CSS, /@media \(max-width: 560px\) \{[^@]*\n  \[id\] \{ scroll-margin-top: 104px; \}/);
  // The focus rings in the ink of the accent (its review: the accent itself is under 3:1 on the light theme's ground).
  assert.match(PAGE_CSS, /\n:focus-visible \{ outline: 2px solid var\(--accent-ink\)/);
  assert.match(PAGE_CSS, /\.panel \[tabindex="-1"\]:not\(\.part\):focus \{ outline: 2px solid var\(--accent-ink\)/);
  assert.equal(/outline: 2px solid var\(--accent\)/.test(PAGE_CSS), false);
});
