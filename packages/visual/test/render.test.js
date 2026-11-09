// Layer 3 tests: layout rules and the rendered page, on a real commit's fixture and on synthetic ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { layout, layoutBase, textWidth, wrapText, flowGrid, normMeaning, normFindings, hit, fnLabel } from '../src/layout.mjs';
import { render, capRows, STOPS, shareLink, FRAMED_SCRIPT, THEME_SCRIPT } from '../src/render.mjs';
import vm from 'node:vm';
import { howWide, HOW, wrapName } from '../src/graph-how.mjs';
import { WHERE } from '../src/graph-where.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');
const FIX = join(HERE, 'fixtures');
const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
const load = (name) => {
  const d = join(FIX, name);
  return { facts: read(join(d, 'facts.json')), meaning: read(join(d, 'meaning.json')), findings: read(join(d, 'findings.json')), run: read(join(d, 'run.json')) };
};
const NAMES = ['d211', 'tiny', 'tiny-abstained', 'large'];
const ALL = Object.fromEntries(NAMES.map((n) => [n, load(n)]));
// layout is async (ELK places the desktop graphs); each fixture's is computed once here
const LAID = {};
for (const n of NAMES) LAID[n] = await layout(ALL[n].facts, ALL[n].meaning, ALL[n].findings);
const page = (x, L = null) => render({ ...x, layout: L ?? LAID[NAMES.find((n) => ALL[n] === x)] });
const pageOf = async (x) => render({ ...x, layout: await layout(x.facts, x.meaning, x.findings) });

// ---------- geometry checks ----------
function segHitsBox([x1, y1], [x2, y2], b) {
  const L = b.x + 0.5, R = b.x + b.w - 0.5, T = b.y + 0.5, B = b.y + b.h - 0.5;
  if (x1 === x2) { const lo = Math.min(y1, y2), hi = Math.max(y1, y2); return x1 > L && x1 < R && hi > T && lo < B; }
  if (y1 === y2) { const lo = Math.min(x1, x2), hi = Math.max(x1, x2); return y1 > T && y1 < B && hi > L && lo < R; }
  return true;
}
const labelRect = (p, size = 11.5) => {
  const w = textWidth(p.text, size, 'sans', true);
  const x = p.anchor === 'middle' ? p.x - w / 2 : p.anchor === 'end' ? p.x - w : p.x;
  return { x, y: p.y - 11, w, h: 14 };
};
const TALL_FONTS = { t1: 12, t2: 10.5, t3: 10.5 };
function flowProblems(v, size, fonts = TALL_FONTS) {
  const out = [];
  for (const b of v.boxes) if (b.x < 0 || b.y < 0 || b.x + b.w > v.w || b.y + b.h > v.h) out.push(`box ${b.id} outside`);
  for (let i = 0; i < v.boxes.length; i++) for (let j = i + 1; j < v.boxes.length; j++) {
    if (hit(v.boxes[i], v.boxes[j])) out.push(`boxes ${v.boxes[i].id} / ${v.boxes[j].id} overlap`);
  }
  for (const e of v.edges) {
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], c = e.points[i];
      if (a[0] !== c[0] && a[1] !== c[1]) out.push(`edge ${e.from}->${e.to} not orthogonal`);
      for (const b of v.boxes) if (segHitsBox(a, c, b)) out.push(`edge ${e.from}->${e.to} crosses box ${b.id}`);
    }
  }
  const labels = v.edges.filter((e) => e.place).map((e) => ({ r: labelRect(e.place, size), e }));
  const pins = v.boxes.flatMap((b) => [...b.pins, ...(b.badge ? [b.badge] : [])].map((p) => ({ x: p.cx - 9, y: p.cy - 9, w: 18, h: 18 })));
  for (const { r, e } of labels) {
    if (r.x < 0 || r.x + r.w > v.w || r.y < 0 || r.y + r.h > v.h) out.push(`label ${e.place.text} outside`);
    for (const b of v.boxes) if (hit(r, b)) out.push(`label ${e.place.text} on box ${b.id}`);
    for (const p of pins) if (hit(r, p)) out.push(`label ${e.place.text} on a pin`);
  }
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    if (hit(labels[i].r, labels[j].r)) out.push(`labels ${labels[i].e.place.text} / ${labels[j].e.place.text} overlap`);
  }
  for (const b of v.boxes) {
    for (const l of b.lines) {
      const fs = l.cls === 't1' ? fonts.t1 : l.cls === 't2' ? fonts.t2 : fonts.t3;
      const w = textWidth(l.text, fs, l.cls === 't2' ? 'mono' : 'sans', l.cls === 't1' || l.cls === 'cnd');
      if (w > b.w + 0.5) out.push(`text "${l.text}" wider than box ${b.id}`);
    }
    for (const p of b.pins) if (Math.abs(p.cx - (b.x + b.w / 2)) < 14 + 9) out.push(`pin over the top centre of ${b.id}`);
  }
  return out;
}
function mapProblems(map, facts) {
  const out = [];
  const things = [
    ...map.boxes.map((b) => ({ ...b, what: `box ${b.path}` })),
    ...map.pills.map((p) => ({ ...p, what: `pill ${p.path}` })),
    ...map.groups.map((g) => ({ x: g.x, y: g.y, w: textWidth(g.caption, 11.5, 'mono', true), h: 18, what: `caption ${g.name}` })),
  ];
  for (const t of things) if (t.x < 0 || t.y < 0 || t.x + t.w > map.w + 0.5 || t.y + t.h > map.h) out.push(`${t.what} outside`);
  for (let i = 0; i < things.length; i++) for (let j = i + 1; j < things.length; j++) {
    if (hit(things[i], things[j])) out.push(`${things[i].what} / ${things[j].what} overlap`);
  }
  for (const b of map.boxes) {
    const inside = [...b.chips.map((c) => ({ ...c, what: `chip ${c.label}` })),
      ...b.chips.flatMap((c) => c.pins.map((p) => ({ x: p.cx - 9, y: p.cy - 9, w: 18, h: 18, what: `pin ${p.n} of ${c.label}`, of: c }))),
      { x: b.x + 14, y: b.y + 12, w: textWidth(b.label, 12.5, 'mono') + 20 + textWidth(b.count, 11.5, 'mono'), h: 18, what: `header ${b.path}` }];
    for (const t of inside) if (t.x < b.x || t.y < b.y || t.x + t.w > b.x + b.w + 0.5 || t.y + t.h > b.y + b.h) out.push(`${t.what} outside its box`);
    for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i], c = inside[j];
      if (a.of && c.of && a.of === c.of) continue; // one chip's pins sit in a row
      if (hit(a, c, -0.5)) out.push(`${a.what} / ${c.what} overlap`);
    }
    if (b.chips.length > 12) out.push(`${b.path} has ${b.chips.length} chips`);
    const fileFns = facts.files.find((f) => f.path === b.path).functions;
    const shown = b.chips.flatMap((c) => c.ids);
    if ([...shown].sort().join() !== [...fileFns].sort().join()) out.push(`${b.path} does not show each function once`);
  }
  return out;
}

// ---------- text measure ----------
test('text is measured by fixed tables and wraps inside its width', () => {
  assert.equal(textWidth('abc', 10, 'mono'), 3 * 0.62 * 10);
  assert.ok(textWidth('WWW', 12) > textWidth('iii', 12));
  assert.ok(textWidth('abc', 12, 'sans', true) >= textWidth('abc', 12));
  for (const [s, w] of [['a long label that must wrap into lines', 90], ['reconcile_partial_refunds_against_settled_ledger_entries', 120],
    ['buildCrossRegionReplicationPlanWithFallbackOrdering and more', 100]]) {
    const lines = wrapText(s, w, 12, 'mono', false, 9);
    for (const l of lines) assert.ok(textWidth(l, 12, 'mono') <= w, `"${l}" wider than ${w}`);
    assert.equal(lines.join('').replace(/\s/g, ''), s.replace(/\s/g, ''));
  }
  const cut = wrapText('one two three four five six seven eight nine ten', 40, 12, 'sans', true, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('…'));
});

// ---------- determinism ----------
test('same input gives the same bytes: twice in one process, and in a fresh one', async () => {
  for (const n of NAMES) {
    const x = ALL[n];
    const a = await pageOf(x), b = await pageOf(x);
    assert.equal(a, b, n);
    assert.equal(a, page(x), n);
    assert.deepEqual(await layout(x.facts, x.meaning, x.findings), LAID[n], n);
    // without a computed layout the page has the phone views at every width, and is the same bytes each time
    const base = render({ facts: x.facts, meaning: x.meaning, findings: x.findings, run: x.run });
    assert.equal(base, render({ facts: x.facts, meaning: x.meaning, findings: x.findings, run: x.run }), n);
    assert.doesNotMatch(base, /<svg class="flow-w"|<svg class="cg"/, `${n}: no desktop graph without the computed layout`);
  }
  // a Promise is never taken for a layout
  assert.throws(() => render({ ...ALL.tiny, layout: layout(ALL.tiny.facts, ALL.tiny.meaning, ALL.tiny.findings) }), /await layout/);
  // a fresh process draws the same bytes (ELK keeps no state between runs that reaches the page)
  const script = `const { layout } = await import(${JSON.stringify(join(SRC, 'layout.mjs'))});
const { render } = await import(${JSON.stringify(join(SRC, 'render.mjs'))});
const { readFileSync } = await import('node:fs');
const r = (f) => JSON.parse(readFileSync(${JSON.stringify(join(FIX, 'd211'))} + '/' + f, 'utf8'));
const x = { facts: r('facts.json'), meaning: r('meaning.json'), findings: r('findings.json'), run: r('run.json') };
const h = (await import('node:crypto')).createHash('sha256').update(render({ ...x, layout: await layout(x.facts, x.meaning, x.findings) })).digest('hex');
console.log(h);`;
  const fresh = execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' }).trim();
  const { createHash } = await import('node:crypto');
  assert.equal(fresh, createHash('sha256').update(page(ALL.d211)).digest('hex'));
});

test('layer 3 reads no clock, random, network or model, and names no example', () => {
  const files = ['layout.mjs', 'render.mjs', 'page.client.js', 'bridge.client.js', 'page.css', 'graph-how.mjs', 'graph-where.mjs',
    'graph-elk.mjs', 'graph-text.mjs', 'upload.mjs'].map((f) => [f, readFileSync(join(SRC, f), 'utf8')]);
  for (const [f, s] of files.filter(([f]) => f.endsWith('.mjs'))) {
    assert.doesNotMatch(s, /Date\.now|new Date|Math\.random|performance\.now|hrtime|fetch\(|node:https?|node:net|child_process|spawn\(/, f);
  }
  // nothing names a function, file or commit of the fixtures
  const words = new Set();
  for (const n of ['d211', 'tiny', 'large']) {
    const { facts } = ALL[n];
    for (const fn of facts.functions) if (fn.name.length >= 8) words.add(fn.name);
    for (const f of facts.files) { const b = f.path.split('/').pop(); if (b.length >= 8) words.add(b); }
    words.add(facts.range.head.slice(0, 7)); words.add(facts.range.base.slice(0, 7)); words.add(facts.repo.name);
  }
  for (const [f, s] of files) for (const w of words) assert.ok(!s.includes(w), `${f} names ${w}`);
});

// ---------- the page ----------
test('the page is one whole document: doctype, UTF-8, a phone viewport, and the page rules', () => {
  for (const n of NAMES) {
    const html = page(ALL[n]);
    const lines = html.split('\n');
    assert.deepEqual(lines.slice(0, 5), ['<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'], n);
    assert.match(lines[5], /^<title>[^<]+<\/title>$/, n);
    assert.ok(html.trimEnd().endsWith('</body>\n</html>'), n);
    assert.equal((html.match(/<body>/g) ?? []).length, 1, n);
    assert.doesNotMatch(html, /<img[\s>]|<script[^>]+src=|<link[^>]+href=|<iframe/i, n);
    assert.match(html, /:root\{/);
    assert.match(html, /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{/);
    assert.match(html, /:root\[data-theme="dark"\]\{/);
    assert.match(html, /max\(16px, env\(safe-area-inset-left,0px\)\)/);
    assert.match(html, /max\(16px, env\(safe-area-inset-right,0px\)\)/);
    assert.match(html, /body\{[^}]*background:var\(--bg\)/);
  }
});

test('the title names the repository and the range', () => {
  const { facts } = ALL.d211;
  const html = page(ALL.d211);
  assert.ok(html.includes(`\n<title>${facts.repo.name} ${facts.range.base.slice(0, 7)}..${facts.range.head.slice(0, 7)}</title>\n`));
});

test('five stops in order everywhere: What, How, Where, Decide, Read (rail, sections, so the keyboard order too)', () => {
  const order = ['what', 'how', 'where', 'decide', 'read'];
  assert.deepEqual(STOPS.map((s) => s.toLowerCase()), order);
  for (const n of NAMES) {
    const html = page(ALL[n]);
    const at = order.map((id) => html.search(new RegExp(`<section class="stop[^"]*" id="${id}"`)));
    assert.ok(at.every((x) => x > 0), n);
    assert.deepEqual([...at].sort((a, b) => a - b), at, n);
    const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>'));
    assert.deepEqual([...rail.matchAll(/data-stop="(\w+)"><span class="st">(\d)<\/span><span>(\w+)<\/span>/g)]
      .map((m) => [m[1], Number(m[2]), m[3].toLowerCase()]), order.map((s, i) => [s, i + 1, s]), n);
  }
});

// The Read stop's sections in page order, each its whole <article>.
const sections = (html) => [...html.matchAll(/<article class="hunk[^"]*" id="r\d+">[\s\S]*?<\/article>/g)].map((m) => m[0]);
test('Read: a diff is open at rest only when a Must act finding names its function; others fold to one row', async () => {
  const x = ALL.d211;
  const L = LAID.d211;
  const ks = normFindings(x.findings, x.facts);
  const m = normMeaning(x.meaning, x.facts);
  const html = page(x);
  const arts = sections(html);
  assert.equal(arts.length, L.route.read.length);
  const seen = { 'must-act': 0, 'must-know': 0, 'good-to-know': 0, none: 0 };
  L.route.read.forEach((id, i) => {
    const art = arts[i];
    const f = x.facts.functions.find((fn) => fn.id === id);
    // the route order is kept: section i holds the route's i-th function
    assert.ok(art.includes(`data-rows="${id}"`), `section ${i + 1} is ${id}`);
    const of = ks.filter((k) => k.fns.includes(id));
    const tiers = new Set(of.map((k) => k.tier));
    const open = tiers.has('must-act');
    seen[open ? 'must-act' : tiers.has('must-know') ? 'must-know' : tiers.has('good-to-know') ? 'good-to-know' : 'none']++;
    const row = art.match(/<button type="button" class="h-row" data-unfold aria-expanded="false" aria-controls="(r\d+-b)"[^>]*>([\s\S]*?)<\/button>/);
    assert.ok(row, `${id} has its one-line row`);
    const rowTag = art.match(/<button type="button" class="h-row"[^>]*>/)[0];
    const bodyTag = art.match(/<div class="h-body" id="(r\d+-b)"[^>]*>/);
    assert.equal(bodyTag[1], row[1]);
    if (open) {
      assert.match(art, /^<article class="hunk" /, id);
      assert.match(rowTag, / hidden>$/, `${id}: the row is hidden while the diff is open`);
      assert.doesNotMatch(bodyTag[0], /hidden/, `${id}: open at rest`);
    } else {
      assert.match(art, /^<article class="hunk shut" /, id);
      assert.doesNotMatch(rowTag, /hidden/, id);
      assert.match(bodyTag[0], / hidden>$/, `${id}: closed at rest`);
      // the row: name, one-liner, counts and the finding pins
      const r = row[2];
      assert.ok(r.includes(`<code class="h-nm">${fnLabel(f)}</code>`), id);
      const sum = m.fns.get(id)?.summary;
      if (sum) assert.ok(r.includes(`>${sum.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</span>`), `${id} summary`);
      assert.ok(r.includes(`<span class="add">+${f.added || 0}</span> <span class="del">−${f.removed || 0}</span>`), id);
      assert.deepEqual([...r.matchAll(/<span class="pin-h t-\w+">(\d+)<\/span>/g)].map((p) => Number(p[1])), of.map((k) => k.n), id);
    }
  });
  assert.ok(Object.values(seen).every((c) => c > 0), `the fixture has all three tiers and untied functions: ${JSON.stringify(seen)}`);
  assert.match(html, /in route order · click a row to open its diff/);
  // the floating card still has every function's whole diff, whatever its section shows at rest
  const data = JSON.parse(html.match(/const SONAH = (.*);\n/)[1]);
  for (const id of L.route.read) assert.deepEqual(data.diff[id], x.facts.functions.find((f) => f.id === id).diff);
  // a page whose read functions all carry a Must act finding has no folded row and says nothing about rows
  const y = structuredClone(ALL.tiny);
  y.findings = [{ tier: 'must-act', title: 't', oneLine: 'o', fns: layoutBase(y.facts, y.meaning, null).route.read, quote: 'q' }];
  const all = await pageOf(y);
  assert.ok(sections(all).length && sections(all).every((a) => a.startsWith('<article class="hunk" ')));
  assert.doesNotMatch(all, /click a row/);
});

test('the local page\'s buttons link to its share url, escaped; any other url, or the hosted page, has none', () => {
  const x = ALL.tiny;
  const head = x.facts.range.head;
  const url = shareLink('https://pr.example.test/', { owner: 'acme', repo: 'a&b', head });
  assert.equal(url, `https://pr.example.test/share?owner=acme&repo=a%26b&head=${head}`);
  const links = (html) => [...html.matchAll(/<a class="btn (?:quiet|strong)" id="(\w+)" href="([^"]*)" target="_blank" rel="noopener" data-intent="(save|invite)"/g)];
  // hosted (the default), even when a url is given: no buttons; the copy link stays
  for (const html of [page(x), render({ ...x, shareUrl: url }), render({ ...x, mode: 'hosted', shareUrl: url })]) {
    assert.equal(links(html).length, 0);
    assert.ok(html.includes('id="copylink"'));
  }
  const local = render({ ...x, mode: 'local', shareUrl: url });
  assert.equal(local, render({ ...x, mode: 'local', shareUrl: url }), 'same input, same bytes');
  const got = links(local);
  assert.deepEqual(got.map((l) => [l[1], l[3]]), [['saveonline', 'save'], ['invite', 'invite'], ['invite2', 'invite']]);
  for (const l of got) assert.equal(l[2], url.replace(/&/g, '&amp;'));
  assert.ok(local.indexOf('id="invite"') < local.indexOf('<main>'), 'in the header');
  const decide = local.slice(local.indexOf('<section class="stop" id="decide"'), local.indexOf('<section class="stop" id="read"'));
  assert.match(decide, /<div class="close">[\s\S]*id="invite2"[\s\S]*<\/div>\s*<\/section>\s*$/, 'at the end of Decide');
  assert.ok(!/id="copylink"|id="share2"|Share with your team/.test(local), 'no copy link on the local page');
  // markup in the url's parts never reaches the page as markup
  const odd = shareLink('https://pr.example.test', { owner: '"><img src=x>', repo: "r'<", head });
  const oddPage = render({ ...x, mode: 'local', shareUrl: odd });
  assert.equal(links(oddPage).length, 3);
  assert.ok(!/<img src=x>|"><img/.test(oddPage));
  // no findings: the strong button is still at the end of Decide
  assert.equal(links(render({ facts: x.facts, meaning: x.meaning, findings: [], mode: 'local', shareUrl: url })).length, 3);
  // not a share url: no button (another scheme, a credential, another path, another or a missing parameter, a fragment;
  // the credential's password is put in at run time, so this file holds no credential-shaped url)
  for (const bad of ['javascript:alert(1)', `https://u:${'p'}@pr.example.test/share?owner=a&repo=b&head=${head}`,
    `https://pr.example.test/r/a/b?owner=a&repo=b&head=${head}`, `https://pr.example.test/share?owner=a&repo=b&head=${head}&token=t`,
    'https://pr.example.test/share?owner=a&repo=b', `https://pr.example.test/share?owner=a&repo=b&head=${head}#x`, null, 42]) {
    assert.equal(links(render({ ...x, mode: 'local', shareUrl: bad })).length, 0, String(bad));
  }
  assert.throws(() => shareLink('file:///tmp', { owner: 'a', repo: 'b', head }));
});

test('the hosted page ends with the bridge to the team page\'s rail; the local page has none and keeps its buttons', () => {
  const x = ALL.d211;
  const bridge = readFileSync(join(SRC, 'bridge.client.js'), 'utf8');
  const hosted = page(x);
  // the bridge is the page's last script, whole and as written (the content origin allows it by its hash)
  assert.ok(hosted.endsWith(`</script>\n<script>\n${bridge}</script>\n</body>\n</html>\n`));
  assert.equal(hosted.split(bridge).length, 2, 'once');
  assert.equal(render({ ...x, layout: LAID.d211, mode: 'hosted' }), hosted, 'hosted is the default');
  const url = shareLink('https://pr.example.test', { owner: 'acme', repo: 'web', head: x.facts.range.head });
  const local = render({ ...x, layout: LAID.d211, mode: 'local', shareUrl: url });
  assert.ok(!local.includes(bridge) && !local.includes('sonah:ready') && !local.includes('postMessage'), 'no bridge');
  assert.ok(local.endsWith('</script>\n</body>\n</html>\n'));
  assert.equal((local.match(/data-intent="(save|invite)"/g) ?? []).length, 3);
  // the hosted page's own decision and share controls hide when the bridge marks it framed (the rail decides)
  assert.match(hosted, /\[data-sonah-framed\] \.fd-act \.dec, \[data-sonah-framed\] \.exl, \[data-sonah-framed\] #decide \.close,\s*\[data-sonah-framed\] \.top \.share\{display:none\}/);
  for (const id of ['share', 'copylink', 'share2', 'tally']) assert.match(hosted, new RegExp(`id="${id}"`));
  assert.ok(/<div class="close"><span class="tally" id="tally">/.test(hosted) && /<div class="tools">[\s\S]*?<div class="share">/.test(hosted));
});

test('the local page makes no request: the stylesheet\'s web-font import is on the hosted page only', () => {
  const x = ALL.d211;
  const css = readFileSync(join(SRC, 'page.css'), 'utf8');
  const [first, ...rest] = css.split('\n');
  assert.match(first, /^@import url\(/, 'page.css opens with its web-font import');
  assert.ok(!rest.some((l) => l.startsWith('@import')), 'and has no other');
  // the hosted page inlines page.css whole; the local page all of it but that first line
  const hosted = page(x);
  assert.ok(hosted.includes(`<style>\n${css}\n`));
  const url = shareLink('https://pr.example.test', { owner: 'acme', repo: 'web', head: x.facts.range.head });
  for (const shareUrl of [null, url]) {
    const local = render({ ...x, layout: LAID.d211, mode: 'local', shareUrl });
    assert.ok(local.includes(`<style>\n${rest.join('\n')}\n`), String(shareUrl));
    assert.doesNotMatch(local, /@import|fonts\.googleapis|fonts\.gstatic/, String(shareUrl));
  }
  // with no share url (the page `sonah visual` writes) the one url on it is the SVG namespace, and it has no button,
  // no upload, no copy link and no bridge: the theme script and the data with the page's own script only
  const local = render({ ...x, layout: LAID.d211, mode: 'local', shareUrl: null });
  assert.deepEqual([...new Set(local.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]*/gi))], ['http://www.w3.org/2000/svg']);
  assert.doesNotMatch(local, /id="saveonline"|data-intent=|id="sonah-upload"|id="copylink"|id="share2"|postMessage/);
  assert.equal((local.match(/<script[\s>]/g) ?? []).length, 2);
});

test('an abstained run still renders: names only, one line for the flow, "No findings"', () => {
  const x = ALL['tiny-abstained'];
  const html = page(x);
  assert.match(html, /No findings/);
  assert.match(html, /<p class="none">No flow: [^<]+<\/p>/);
  assert.ok(!html.split('<script>\nconst SONAH')[0].includes('class="c-what'), 'no "What changed" on the page');
  const data = JSON.parse(html.match(/const SONAH = (.*);\n/)[1]);
  for (const f of Object.values(data.fn)) { assert.equal(f.o, null); assert.equal(f.c, null); }
  for (const fn of x.facts.functions) assert.ok(html.includes(`>${fn.name}</text>`), fn.name);
  // the heading falls back to the commit subject, a fact
  assert.match(html, new RegExp(`<h1>${x.facts.range.commits[0].subject}</h1>`));
  // a story with no flows says so too
  const noFlow = render({ facts: x.facts, meaning: { functions: {}, story: { oneLine: 'x', flows: [] } } });
  assert.match(noFlow, /<p class="none">No flow was drawn[^<]*<\/p>/);
});

test('the card has what it needs: summary, what changed and the function\'s own diff for every function', () => {
  const x = ALL.d211;
  const html = page(x);
  const data = JSON.parse(html.match(/const SONAH = (.*);\n/)[1]);
  assert.equal(data.cap, 40);
  const m = normMeaning(x.meaning, x.facts);
  for (const f of x.facts.functions) {
    assert.deepEqual(data.diff[f.id], f.diff, f.id);
    assert.equal(data.fn[f.id].o, m.fns.get(f.id)?.summary ?? null);
    assert.equal(data.fn[f.id].c, m.fns.get(f.id)?.change ?? null);
  }
  // every chip and step opens a card: each carries a function id the card knows, or an external step it knows
  for (const [, id] of html.matchAll(/data-fn="([^"]+)"/g)) assert.ok(data.fn[id.replace(/&amp;/g, '&').replace(/&#39;/g, "'")], id);
  for (const [, ids] of html.matchAll(/data-group="([^"]+)"/g)) for (const id of ids.split(' ')) assert.ok(data.fn[id], id);
  for (const [, key] of html.matchAll(/data-ext="([^"]+)"/g)) assert.ok(data.ext[key], key);
  assert.match(html, /<div class="card" id="card" role="dialog"/);
});

test('diffs are capped at 40 rows with "+N more"', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ['+', null, i + 1, `line ${i}`]);
  rows.splice(20, 0, ['~', null, null, '']);
  const { shown, rest } = capRows(rows, 40);
  assert.equal(shown.filter((r) => r[0] !== '~').length, 40);
  assert.equal(rest, 10);
  const html = page(ALL.large);
  const long = ALL.large.facts.functions.find((f) => !f.fold && f.diff.filter((r) => r[0] !== '~').length > 40);
  assert.ok(long);
  assert.match(html, /<button type="button" class="c-more" data-expand="[^"]+">\+\d+ more lines<\/button>/);
});

test('the hosted page, framed, is marked before its first paint and paints nothing until the team page\'s theme comes', async () => {
  const x = structuredClone(ALL.tiny);
  const hosted = await pageOf(x);
  const head = hosted.slice(0, hosted.indexOf('</head>'));
  assert.ok(head.includes(`<script>${THEME_SCRIPT}</script>\n<script>${FRAMED_SCRIPT}</script>`), 'both in <head>, the theme first');
  const local = render({ ...x, layout: await layout(x.facts, x.meaning, x.findings), mode: 'local' });
  assert.ok(!local.includes(FRAMED_SCRIPT), 'the local page is never framed by the team page');
  const run = (framed) => {
    const attrs = new Map(), timers = [];
    const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k) };
    const window = {};
    window.parent = framed ? {} : window;
    vm.runInNewContext(FRAMED_SCRIPT, { window, document: { documentElement: root }, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
    return { attrs, timers };
  };
  const inFrame = run(true);
  assert.deepEqual([...inFrame.attrs.keys()].sort(), ['data-sonah-framed', 'data-sonah-wait']);
  assert.deepEqual(inFrame.timers.map((t) => t.ms), [3000], 'at most 3 seconds if no theme ever comes');
  inFrame.timers[0].fn();
  assert.deepEqual([...inFrame.attrs.keys()], ['data-sonah-framed']);
  const alone = run(false);
  assert.deepEqual([alone.attrs.size, alone.timers.length], [0, 0], 'outside a frame: nothing');
  // while it waits nothing is painted and its canvas stays clear, so the frame's own background (the team page's) shows
  assert.match(hosted, /:root\[data-sonah-wait\]\{visibility:hidden; color-scheme:normal; background:transparent\}/);
  assert.match(hosted, /\[data-sonah-framed\] \.top\{display:none\}/, 'framed, the team page names the review: no top bar of its own');
});

test('text from the model and the repository is escaped', async () => {
  const x = structuredClone(ALL.tiny);
  const f = x.facts.functions[0];
  f.diff = [['+', null, 1, '</script><script>alert(1)</script><img src=x onerror=alert(2)>']];
  x.meaning.functions[f.id].summary = '<b>bold</b> & "quoted"';
  x.meaning.story.oneLine = '<script>alert(3)</script>';
  x.findings[0].title = '<img src=y>';
  const html = await pageOf(x);
  assert.doesNotMatch(html, /<img src|<script>alert|<b>bold/);
  assert.equal((html.match(/<script>/g) ?? []).length, 4, 'the theme, the framed mark, the data and client, the bridge');
  const local = render({ ...x, layout: await layout(x.facts, x.meaning, x.findings), mode: 'local' });
  assert.doesNotMatch(local, /<img src|<script>alert|<b>bold/);
  assert.equal((local.match(/<script>/g) ?? []).length, 2, 'the theme, the data and client');
});

test('pages show phones the list map and the tall flow; a desktop graph only while its stop holds it at its floor', () => {
  const html = page(ALL.d211);
  assert.match(html, /<div class="map-p">/);
  assert.match(html, /<div class="flow-tall"><svg class="flow-t"/);
  assert.match(html, /<div class="flow-wide scroll"><svg class="flow-w"/);
  assert.match(html, /<div class="scroll map-w"><svg class="cg"/);
  assert.match(html, /@media \(max-width:719px\)\{ \.map-w\{display:none\} \.map-p\{display:grid\}/);
  assert.match(html, /@media \(max-width:719px\)\{ \.flow-wide\{display:none\} \.flow-tall\{display:block\} \}/);
  // each stop is its graphs' container: the rule reads the column itself, in a window, a frame or a narrow column
  assert.match(html, /\.stop\{[^}]*container-type:inline-size/);
  // a graph's svg never grows past its own width and shrinks with its column (max-width 100%)
  assert.match(html, /\.flow-w, \.flow-t\{display:block; max-width:100%; height:auto\}/);
  assert.match(html, /\.map, \.cg\{display:block; max-width:100%; height:auto\}/);
  // so with one rule per figure at ceil(w × floor), no graph is ever drawn under its floor: below it the phone view shows
  let rules = 0;
  for (const n of ['d211', 'tiny', 'large']) {
    const L = LAID[n], h = page(ALL[n]);
    L.flows.forEach((f, i) => {
      if (!f.wide) { assert.match(h, new RegExp(`<figure class="fig flowfig tall-only" aria-label="Flow ${i + 1}`)); return; }
      const need = Math.ceil(f.wide.w * HOW.minScale);
      assert.ok(need / f.wide.w >= HOW.minScale && need <= HOW.maxW + 40, `${n} flow ${i}: shows from ${need} px`);
      assert.match(h, new RegExp(`<figure class="fig flowfig fq-f${i}"`));
      assert.ok(h.includes(`@container (width < ${need}px){ .fq-f${i} .flow-wide{display:none} .fq-f${i} .flow-tall{display:block} }`), `${n} flow ${i}`);
      rules++;
    });
    if (L.where) {
      const need = Math.ceil(L.where.w * WHERE.minScale);
      assert.ok(need / L.where.w >= WHERE.minScale && need <= WHERE.maxW, `${n}: the code graph shows from ${need} px`);
      assert.ok(h.includes(`@container (width < ${need}px){ .fq-w .map-w{display:none} .fq-w .map-p{display:grid} .fq-w .w-only{display:none !important}`), n);
      assert.match(h, /<div class="cwrap fq-w">/);
      rules++;
    } else assert.doesNotMatch(h, /fq-w/);
  }
  assert.ok(rules >= 4, `${rules} figure rules`);
  // the rule follows the graph's own width
  for (const w of [600, 880, 1100]) {
    const fake = { ...LAID.tiny, flows: LAID.tiny.flows.map((f) => ({ ...f, wide: { ...f.wide, w } })) };
    assert.ok(render({ ...ALL.tiny, layout: fake }).includes(`@container (width < ${Math.ceil(w * HOW.minScale)}px){ .fq-f0 .flow-wide{display:none}`));
  }
  // with no desktop graph the phone views show at every width, with no rule
  const base = render({ facts: ALL.d211.facts, meaning: ALL.d211.meaning, findings: ALL.d211.findings });
  assert.match(base, /<figure class="fig flowfig tall-only"/);
  assert.match(base, /<div class="map-p all">/);
  assert.match(base, /\.flowfig\.tall-only \.flow-tall\{display:block\}/);
  assert.match(base, /\.map-p\.all\{display:grid\}/);
  assert.doesNotMatch(base, /@container \(/);
  // framed on the team page: one column with the stop bar on top at every width, so the graphs get the whole frame
  assert.match(html, /:root\[data-sonah-framed\] \.layout\{grid-template-columns:minmax\(0,1fr\); gap:0\}/);
  assert.match(html, /:root\[data-sonah-framed\] \.rail\{position:sticky; top:0;/);
});

test('How is the first view: What keeps the title, ask, numbers and finding pins; the before / now pairs and the route follow the flows', () => {
  const html = page(ALL.d211);
  const what = html.slice(html.indexOf('<section class="stop" id="what"'), html.indexOf('<section class="stop" id="how"'));
  const how = html.slice(html.indexOf('<section class="stop" id="how"'), html.indexOf('<section class="stop" id="where"'));
  assert.match(what, /<h1>/);
  assert.match(what, /class="sumrow"/);
  assert.doesNotMatch(what, /class="bn"|class="route"/);
  assert.ok(ALL.d211.meaning.story.beforeNow.length && how.includes('class="bn"'), 'the before / now pairs are in How');
  assert.ok(how.indexOf('class="flows"') < how.indexOf('class="bn"') && how.indexOf('class="bn"') < how.indexOf('class="route"'),
    'the flows first, then the pairs, then the route');
  // What stays short: no stop padding past 24 px under it, and How starts 32 px under that
  assert.match(html, /#what\{padding-bottom:24px; gap:20px\}/);
  assert.match(html, /#how\{padding-top:32px\}/);
});

// ---------- the map ----------
test('map: every function once, at most 12 chips a file, nothing overlaps', () => {
  for (const n of ['d211', 'tiny', 'large']) {
    const x = ALL[n];
    const L = layoutBase(x.facts, x.meaning, x.findings);
    assert.deepEqual(mapProblems(L.map, x.facts), [], n);
    const files = new Set([...L.map.boxes.map((b) => b.path), ...L.map.pills.map((p) => p.path)]);
    assert.equal(files.size, x.facts.files.length, `${n}: every file on the map`);
  }
});

test('map: folded functions and those past 12 collapse into "+N more"', () => {
  const x = ALL.large;
  const L = layoutBase(x.facts, x.meaning, x.findings);
  const big = L.map.boxes.find((b) => b.chips.flatMap((c) => c.ids).length > 12);
  assert.ok(big);
  assert.equal(big.chips.length, 12);
  const more = big.chips[11];
  assert.equal(more.kind, 'more');
  assert.equal(more.label, `+${more.ids.length} more`);
  for (const c of L.map.chips) if (c.kind !== 'more') assert.equal(x.facts.functions.find((f) => f.id === c.ids[0]).fold, null);
});

test('map: chips are numbered by their order in the first flow', () => {
  const x = ALL.tiny;
  const L = layoutBase(x.facts, x.meaning, x.findings);
  const byName = Object.fromEntries(L.map.chips.map((c) => [c.label, c.n]));
  assert.deepEqual(byName, { add_item: 1, total: 2, applyDiscount: 3 });
  // within a file, numbered chips come first in number order
  const box = L.map.boxes.find((b) => b.path === 'src/cart.py');
  assert.deepEqual(box.chips.map((c) => c.label), ['add_item', 'total']);
  const none = layoutBase(x.facts, null, null);
  assert.ok(none.map.chips.every((c) => c.n === null));
});

test('map: groups are ordered by their best route tier, then by changed lines; a group of pills uses the whole width', () => {
  for (const n of ['d211', 'large']) {
    const x = ALL[n];
    const L = layoutBase(x.facts, x.meaning, x.findings);
    const file = (p) => x.facts.files.find((y) => y.path === p);
    const tier = (p) => ['read', 'skim', 'skip'].findIndex((t) => x.facts.route[t].some((r) => r.path === p));
    const key = (g) => [Math.min(3, ...g.files.map((f) => (tier(f.path) < 0 ? 3 : tier(f.path)))),
      -g.files.reduce((s, f) => s + file(f.path).added + file(f.path).removed, 0)];
    const keys = L.map.groups.map(key);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    assert.deepEqual(keys, sorted, n);
  }
  // nine test files and no functions: the pills wrap across the map, not one per row
  const files = Array.from({ length: 9 }, (_, i) => ({ path: `test/t${i}.test.js`, status: 'modified', role: 'test', lang: 'javascript', added: 3, removed: 1, functions: [] }));
  const facts = { v: 1, repo: { name: 'r' }, range: { base: 'a'.repeat(40), head: 'b'.repeat(40), commits: [] }, stats: {}, functions: [], mentions: [],
    groups: [{ group: 'test', files: files.map((f) => f.path) }], files,
    route: { read: [], skim: files.map((f) => ({ path: f.path, lines: 4 })), skip: [], lines: { read: 0, skim: 36, skip: 0 } } };
  const pills = layoutBase(facts, null, null).map.pills;
  assert.ok(new Set(pills.map((p) => p.y)).size <= 2, 'at most two rows of pills');
});

test('findings: none shown but some lost to the checks never reads "No findings"', () => {
  const x = ALL['tiny-abstained'];
  const html = render({ facts: x.facts, meaning: x.meaning, findings: [], run: { findingsLost: 2 } });
  assert.doesNotMatch(html, /No findings/);
  assert.match(html, /No finding passed the checks: 2 findings dropped \(see the footer\)\./);
  assert.doesNotMatch(html, /dropped\.json/, 'the page names no file a reader cannot open');
  // A findings call that failed is named as one, not as a dropped finding; an empty "answered by" is left out.
  const failed = render({ facts: x.facts, meaning: x.meaning, findings: [],
    run: { findingsLost: 1, findingsCallFailed: true, calls: 2, costUsd: 0, by: {}, model: '' } });
  assert.match(failed, /The findings call failed, so no finding was checked \(see the footer\)\./);
  assert.match(failed, /The findings call failed<\/b>/);
  assert.doesNotMatch(failed, /1 finding dropped|answered by/);
  // a finding whose title was dropped is titled by its oneLine
  const ks = normFindings([{ tier: 'must-act', title: null, oneLine: 'Retries count tokens twice.', fns: [], quote: 'q' }], x.facts);
  assert.deepEqual([ks[0].title, ks[0].oneLine], ['Retries count tokens twice.', '']);
});

test('the Read stop folds a long doc comment into one row and counts the cap from the definition line', async () => {
  const x = structuredClone(ALL.tiny);
  const f = x.facts.functions.find((fn) => !fn.fold && fn.line);
  const doc = Array.from({ length: 6 }, (_, i) => [' ', i + 1, i + 1, ` * doc line ${i}`]);
  const body = Array.from({ length: 45 }, (_, i) => ['+', null, i + 7, `  step(${i});`]);
  f.line = 7;
  f.diff = [...doc, [' ', 7, 7, 'function f() {'], ...body];
  x.facts.route.read = [{ path: f.path, lines: 46 }];
  const html = await pageOf(x);
  assert.match(html, /<button type="button" class="cmt-b" data-cmt aria-expanded="false">comment, 6 lines<\/button>/);
  assert.match(html, /\+6 more lines/, '40 rows from the definition line: the line itself and 39 of the 45 after it');
});

// ---------- flows ----------
// The desktop How graph (ELK): what must hold for any flow it draws. Returns the problems, and counts every pair of text
// boxes that overlap (edge labels, "was" lines, the lane labels, pins and badges).
function wideProblems(v, flow) {
  const out = [];
  const inside = (r) => r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= v.w + 0.5 && r.y + r.h <= v.h + 0.5;
  for (const b of v.boxes) if (!inside(b)) out.push(`box ${b.id} outside`);
  for (let i = 0; i < v.boxes.length; i++) for (let j = i + 1; j < v.boxes.length; j++) {
    if (hit(v.boxes[i], v.boxes[j])) out.push(`boxes ${v.boxes[i].id} / ${v.boxes[j].id} overlap`);
  }
  for (const e of v.edges) {
    if (e.points.length < 2) out.push(`edge ${e.from}->${e.to} has no route`);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], c = e.points[i];
      if (a[0] !== c[0] && a[1] !== c[1]) out.push(`edge ${e.from}->${e.to} not orthogonal`);
      for (const b of v.boxes) if (b.id !== e.from && b.id !== e.to && segHitsBox(a, c, b)) out.push(`edge ${e.from}->${e.to} crosses box ${b.id}`);
    }
  }
  // text boxes: labels, before-track lines and lane labels, pins and badges
  const texts = [];
  for (const e of v.edges) if (e.label) texts.push({ ...e.label, what: `label ${e.label.text}`, own: `e${e.from}>${e.to}` });
  for (const t of v.before?.tracks ?? []) {
    for (const it of t.items) it.lines.forEach((line, k) => {
      const w = textWidth(line, v.before.font, 'sans');
      texts.push({ x: it.x - w / 2, y: t.textY + k * v.before.line - 11, w, h: 14, what: `was ${line}`, own: `b${it.id}` });
    });
    if (t.k === 0) texts.push({ x: 0, y: t.lineY - 8, w: 60, h: 14, what: 'BEFORE', own: 'lane' });
    if (t.nowY != null) texts.push({ x: 0, y: t.nowY - 11, w: 34, h: 14, what: 'NOW', own: 'lane' });
  }
  for (const b of v.boxes) for (const p of [...b.pins, ...(b.badge ? [{ ...b.badge, n: 'badge' }] : [])]) texts.push({ x: p.cx - 9, y: p.cy - 9, w: 18, h: 18, what: `pin ${p.n} of ${b.id}`, own: b.id, pin: true });
  let overlaps = 0;
  for (const t of texts) {
    if (!inside(t)) out.push(`${t.what} outside`);
    for (const b of v.boxes) if (!t.pin && hit(t, b)) out.push(`${t.what} on box ${b.id}`);
  }
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    if (texts[i].own === texts[j].own) continue;
    if (hit(texts[i], texts[j])) { overlaps++; out.push(`${texts[i].what} / ${texts[j].what} overlap`); }
  }
  for (const b of v.boxes) for (const l of b.lines) {
    const size = l.cls === 't1' ? HOW.t1 : l.cls === 't2' ? HOW.t2 : HOW.t3;
    if (textWidth(l.text, size, l.cls === 't2' ? 'mono' : 'sans', l.cls === 't1') > b.w + 0.5) out.push(`text "${l.text}" wider than box ${b.id}`);
  }
  // the shape: signals go back over the top of their steps; a branch hangs below the step it leaves
  const box = new Map(v.boxes.map((b) => [b.id, b]));
  for (const e of v.edges.filter((x) => x.kind === 'signal')) {
    const top = Math.min(box.get(e.from).y, box.get(e.to).y);
    if (!(Math.min(...e.points.map((p) => p[1])) < top)) out.push(`signal ${e.from}->${e.to} does not go over the top`);
  }
  for (const e of v.edges.filter((x) => x.kind === 'branch')) {
    const a = box.get(e.from), b = box.get(e.to);
    if (!(b.y + b.h / 2 > a.y + a.h / 2) && !(b.x > a.x + a.w)) out.push(`branch ${e.from}->${e.to} neither below nor after its step`);
  }
  // one row when it is not wrapped: the main chain's boxes share their centre line and run left to right
  const g = flowGrid(flow);
  const main = g.main.map((id) => box.get(id));
  const rows = new Set(main.map((b) => Math.round(b.y + b.h / 2)));
  if (rows.size === 1) for (let i = 1; i < main.length; i++) if (!(main[i].x > main[i - 1].x + main[i - 1].w)) out.push(`main ${main[i].id} not right of ${main[i - 1].id}`);
  return { problems: out, overlaps };
}

test('How (desktop): the main chain in a row, branches below, signals over the top, "was" lines above; nothing crosses or overlaps', () => {
  let drawn = 0;
  for (const n of ['d211', 'tiny', 'large']) {
    const m = normMeaning(ALL[n].meaning, ALL[n].facts);
    LAID[n].flows.forEach((f, i) => {
      assert.deepEqual(flowProblems(f.tall, 11, TALL_FONTS), [], `${n} flow ${i} (phone)`);
      if (!f.wide) return;
      drawn++;
      const { problems, overlaps } = wideProblems(f.wide, m.story.flows[i]);
      assert.deepEqual(problems, [], `${n} flow ${i}`);
      assert.equal(overlaps, 0, `${n} flow ${i}: overlapping labels`);
      // a step that names a function opens its card; every step of the flow is drawn once
      assert.deepEqual(f.wide.boxes.map((b) => b.id).sort(), m.story.flows[i].steps.map((s) => s.id).sort());
    });
  }
  assert.ok(drawn >= 4, `desktop graphs drawn: ${drawn}`);
  // the tiny flow: its one "was" line sits on the before track over its own step; the branch is a pill
  const v = LAID.tiny.flows[0].wide;
  const s3 = v.boxes.find((b) => b.id === 's3');
  const item = v.before.tracks[0].items.find((it) => it.id === 's3');
  assert.equal(item.x, Math.round((s3.x + s3.w / 2) * 10) / 10);
  assert.ok(v.before.tracks[0].lineY < s3.y);
  assert.equal(v.edges.find((e) => e.kind === 'branch').label.pill, true);
});

test('How (desktop): a flow too wide for one row wraps with every edge routed, else the phone flow shows', async () => {
  const fn = (k) => ALL.large.facts.functions[k].id;
  const steps = Array.from({ length: 11 }, (_, i) => ({ id: `x${i}`, label: `Step ${i + 1} does a thing`, fn: fn(i), ext: null, isNew: i % 2 === 0, was: i % 3 ? null : 'did it before' }));
  const edges = Array.from({ length: 10 }, (_, i) => ({ from: `x${i}`, to: `x${i + 1}`, kind: 'main', label: i === 4 ? 'when ready' : null }));
  const ctx = { fnName: (id) => id.split('#')[1], pinsOf: () => [], numberOf: () => null };
  const v = await howWide({ title: 't', steps, edges }, ctx);
  assert.ok(v, 'wrapped');
  assert.ok(v.w <= HOW.maxW, `${v.w} wide`);
  const { problems, overlaps } = wideProblems(v, { steps, edges });
  assert.deepEqual(problems, []);
  assert.equal(overlaps, 0);
  assert.ok(new Set(v.boxes.map((b) => Math.round(b.y))).size > 1, 'more than one row');
  // with a signal back across the rows: wrapped only when ELK routes the signal too, else no desktop graph
  const withSignal = [...edges, { from: 'x8', to: 'x2', kind: 'signal', label: 'done' }];
  const s2 = await howWide({ title: 't', steps, edges: withSignal }, ctx);
  if (s2) assert.deepEqual(wideProblems(s2, { steps, edges: withSignal }).problems, []);
  assert.deepEqual(await howWide({ title: 't', steps, edges: withSignal }, ctx), s2, 'the same flow takes the same rung');
  // a page whose flow has no desktop graph shows that flow's phone graph at every width
  const L = await layout(ALL.large.facts, ALL.large.meaning, ALL.large.findings);
  const html = render({ ...ALL.large, layout: { ...L, flows: L.flows.map((f) => ({ ...f, wide: null })) } });
  assert.equal((html.match(/<figure class="fig flowfig tall-only"/g) ?? []).length, L.flows.length);
  assert.doesNotMatch(html, /<svg class="flow-w"/);
});

test('flows: grid rules hold on odd flows (no main chain, a cycle, unknown ids, self loops)', async () => {
  const flow = normMeaning({ story: { flows: [{ title: 't', steps: [
    { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'a', label: 'dup' }],
  edges: [{ from: 'a', to: 'b', kind: 'main' }, { from: 'b', to: 'a', kind: 'main' }, { from: 'a', to: 'zz', kind: 'main' },
    { from: 'c', to: 'c', kind: 'branch' }, { from: 'b', to: 'c', kind: 'odd' }] }] } }, { functions: [] }).story.flows[0];
  assert.equal(flow.steps.length, 3);
  assert.equal(flow.edges.length, 3); // unknown id and self loop dropped
  const g = flowGrid(flow);
  assert.deepEqual(g.main, ['a', 'b', 'c']); // the cycle is cut where it closes; an unknown kind counts as main
  const L = await layout({ functions: [], files: [], groups: [] }, { story: { flows: [flow] } }, null);
  assert.deepEqual(flowProblems(L.flows[0].tall, 11, TALL_FONTS), []);
  if (L.flows[0].wide) assert.deepEqual(wideProblems(L.flows[0].wide, flow).problems, []);
  assert.equal(L.where, null, 'no file, no code graph');
  const loose = normMeaning({ story: { flows: [{ steps: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }], edges: [] }] } }, { functions: [] }).story.flows[0];
  assert.deepEqual(flowGrid(loose).main, ['x', 'y']);
});

test('flows (phone): labels that find no free spot go to a lettered key', () => {
  for (const f of LAID.large.flows) {
    const v = f.tall;
    const keyed = v.edges.filter((e) => e.key);
    assert.equal(keyed.length, v.keys.length);
    for (const e of v.edges) if (e.label) assert.ok(e.place || e.key, `${e.label} is shown`);
  }
});

// ---------- Where (desktop): the code graph ----------
// A fixture with the parser's facts: unchanged callers of two functions (one only may run it), counts, existing tests.
function withImpact(x) {
  const y = structuredClone(x);
  const [a, b] = y.facts.functions.filter((f) => f.status !== 'removed');
  a.impact = { callers: 2, mayRun: 0, hop2: 3, byName: 1 };
  b.impact = { callers: 0, mayRun: 1, hop2: 0, byName: 0 };
  a.existingTests = { count: 2, list: ['test/old.test.js', 'test/older.test.js'] };
  y.facts.impact = { callers: [
    { id: 'lib/use.js#main', path: 'lib/use.js', name: 'main', owner: null, line: 3, kind: 'callable', calls: [a.id], may: false },
    { id: 'lib/use.js#Runner.go', path: 'lib/use.js', name: 'go', owner: 'Runner', line: 9, kind: 'callable', calls: [a.id], may: false },
    { id: 'app/x.py#run', path: 'app/x.py', name: 'run', owner: null, line: 1, kind: 'callable', calls: [b.id], may: true }],
  total: 3, hop2: 3, byName: 1, existingTestFiles: 2 };
  return y;
}

function whereProblems(cg, facts) {
  const out = [];
  const inside = (r, o, m = 0.5) => r.x >= o.x - m && r.y >= o.y - m && r.x + r.w <= o.x + o.w + m && r.y + r.h <= o.y + o.h + m;
  const all = { x: 0, y: 0, w: cg.w, h: cg.h };
  for (const b of cg.boxes) if (!inside(b, all)) out.push(`box ${b.path} outside`);
  for (let i = 0; i < cg.boxes.length; i++) for (let j = i + 1; j < cg.boxes.length; j++) {
    if (hit(cg.boxes[i], cg.boxes[j])) out.push(`boxes ${cg.boxes[i].path} / ${cg.boxes[j].path} overlap`);
  }
  // regions: inside their parent, captions clear of every box
  for (const r of cg.regions) {
    const cap = { x: r.x + 12, y: r.y + 6, w: textWidth(r.label, WHERE.captionFont, 'mono', true), h: 16 };
    for (const b of cg.boxes) if (hit(cap, b)) out.push(`caption ${r.label} on ${b.path}`);
  }
  // rows: inside their box, apart, every function once; pins and marks inside their row
  const shown = [];
  for (const b of cg.boxes) {
    const head = { x: b.x + 14, y: b.y + 10, w: textWidth(b.name, WHERE.nameFont, 'mono', true) + 18 + textWidth(b.count, WHERE.countFont, 'mono'), h: 18 };
    if (!inside(head, b)) out.push(`header of ${b.path} outside its box`);
    for (const r of b.rows) {
      if (!inside(r, b)) out.push(`row ${r.label} outside ${b.path}`);
      if (hit(r, head)) out.push(`row ${r.label} under the header of ${b.path}`);
      shown.push(...r.ids);
      for (const p of r.pins) if (!inside({ x: p.cx - 8, y: p.cy - 8, w: 16, h: 16 }, r)) out.push(`pin ${p.n} outside row ${r.label}`);
      if (r.mark && !inside(r.mark, r)) out.push(`mark outside row ${r.label}`);
      const lead = r.n ? WHERE.numW : 0;
      const textEnd = r.x + 10 + lead + textWidth(r.label, r.kind === 'owner' ? WHERE.ownerFont : WHERE.chipFont, 'mono', r.kind === 'owner');
      const stop = Math.min(r.x + r.w, ...(r.mark ? [r.mark.x] : []), ...(r.ut ? [r.ut.x] : []), ...r.pins.map((p) => p.cx - 8));
      if (textEnd > stop + 0.5) out.push(`row text ${r.label} runs into its marks`);
    }
    for (let i = 0; i < b.rows.length; i++) for (let j = i + 1; j < b.rows.length; j++) if (hit(b.rows[i], b.rows[j])) out.push(`rows ${b.rows[i].label} / ${b.rows[j].label} overlap`);
  }
  const want = facts.files.flatMap((f) => f.functions);
  if ([...shown].sort().join('\n') !== [...want].sort().join('\n')) out.push('not every function shown once');
  // calls: routed, orthogonal, through no box but their own ends'; a bracket inside its box, clear of its left edge
  const boxOf = new Map(cg.boxes.flatMap((b) => b.rows.flatMap((r) => r.ids.map((id) => [id, b]))));
  for (const e of cg.edges.filter((x) => x.kind === 'inner')) {
    const b = boxOf.get(e.from);
    if (e.points[1][0] < b.x + WHERE.bracketMinX - 0.01) out.push(`bracket ${e.from}->${e.to} left of ${b.path}'s margin`);
  }
  for (const e of cg.edges) {
    if (e.points.length < 2) out.push(`call ${e.from}->${e.to} has no route`);
    const ends = new Set([boxOf.get(e.from), boxOf.get(e.to)]);
    for (let i = 1; i < e.points.length; i++) {
      const a = e.points[i - 1], c = e.points[i];
      if (a[0] !== c[0] && a[1] !== c[1]) out.push(`call ${e.from}->${e.to} not orthogonal`);
      for (const b of cg.boxes) if (!ends.has(b) && segHitsBox(a, c, b)) out.push(`call ${e.from}->${e.to} crosses ${b.path}`);
    }
  }
  // overlays: inside the graph, over no file box (its own included) and no folder caption, their chips inside them
  for (const o of cg.overlays) {
    if (!inside(o, all)) out.push(`overlay of ${o.fn} outside`);
    const row = cg.boxes.flatMap((b) => b.rows).find((r) => r.ids.length === 1 && r.ids[0] === o.fn);
    if (hit(o, row)) out.push(`overlay of ${o.fn} covers its row`);
    for (const b of cg.boxes) if (hit(o, b)) out.push(`overlay of ${o.fn} covers ${b.path}`);
    for (const r of cg.regions) {
      const cap = { x: r.x + 12, y: r.y + 6, w: textWidth(r.label, WHERE.captionFont, 'mono', true), h: 16 };
      if (hit(o, cap)) out.push(`overlay of ${o.fn} covers the caption ${r.label}`);
    }
    for (const c of o.chips) if (!inside(c, o)) out.push(`ghost ${c.label} outside its overlay`);
    for (const l of o.lines) {
      const end = l.points.at(-1);
      if (Math.abs(end[1] - (row.y + row.h / 2)) > 0.5) out.push(`ghost line of ${o.fn} misses its row`);
    }
  }
  return out;
}

test('Where (desktop): folders nested, files as boxes of their functions in line order, calls routed through no box', () => {
  for (const n of ['d211', 'tiny']) {
    const cg = LAID[n].where;
    assert.ok(cg, n);
    assert.deepEqual(whereProblems(cg, ALL[n].facts), [], n);
    // rows in line order within each file box
    for (const b of cg.boxes) {
      const lines = b.rows.filter((r) => r.kind !== 'more' && r.ids.length === 1).map((r) => { const f = ALL[n].facts.functions.find((x) => x.id === r.ids[0]); return f.line ?? f.oldLine; });
      assert.deepEqual(lines, [...lines].sort((p, q) => p - q), `${n} ${b.path}`);
    }
  }
  // a graph too big to read at the column's width (150 functions in 30 files) is not drawn: the list shows at every width
  assert.equal(LAID.large.where, null);
  assert.match(page(ALL.large), /<div class="map-p all">/);
  // the d211 fixture's folders: packages/cli and packages/evidence inside the packages they share
  const regions = LAID.d211.where.regions;
  assert.ok(regions.some((r) => r.depth > 0));
  for (const r of regions.filter((x) => x.depth > 0)) {
    const parent = regions.find((p) => r.name.startsWith(`${p.name}/`) && p.depth === r.depth - 1);
    assert.ok(parent && r.x >= parent.x && r.y >= parent.y && r.x + r.w <= parent.x + parent.w + 0.5 && r.y + r.h <= parent.y + parent.h + 0.5, r.name);
  }
  // the d211 fixture draws its calls between files with arrows and the calls inside a file as brackets
  const kinds = new Set(LAID.d211.where.edges.map((e) => e.kind));
  assert.ok(kinds.has('call') && kinds.has('inner'));
});

test('Where (desktop): impact is quiet at rest and drawn only for the selected function', async () => {
  const x = withImpact(ALL.tiny);
  const L = await layout(x.facts, x.meaning, x.findings);
  assert.deepEqual(whereProblems(L.where, x.facts), []);
  const [a, b] = x.facts.functions;
  // a mark on each function with unchanged callers (callers and may-run ones), none elsewhere
  const rows = L.where.boxes.flatMap((bx) => bx.rows);
  assert.equal(rows.find((r) => r.ids[0] === a.id).impact, 2);
  assert.equal(rows.find((r) => r.ids[0] === b.id).impact, 1);
  assert.ok(rows.filter((r) => r.ids[0] !== a.id && r.ids[0] !== b.id).every((r) => !r.mark));
  // one overlay each: ghost chips grouped by file, "may run" kept apart, the counts it does not draw written under it
  const oa = L.where.overlays.find((o) => o.fn === a.id), ob = L.where.overlays.find((o) => o.fn === b.id);
  assert.deepEqual(oa.chips.map((c) => [c.label, c.may]), [['main', false], ['Runner.go', false]]);
  assert.deepEqual(oa.files.map((f) => f.name), ['use.js']);
  assert.deepEqual(oa.notes.map((t) => t.text), ['3 more two calls away', '1 by name only']);
  assert.deepEqual(ob.chips.map((c) => [c.label, c.may]), [['run', true]]);
  // the page: each overlay hidden at rest, the marks shown, the ghosts' cards known to the page script
  const html = render({ ...x, layout: L });
  assert.equal((html.match(/<g class="imp" data-for="[^"]+" hidden>/g) ?? []).length, 2);
  assert.match(html, /<g class="imp-m"><path d="[^"]+"\/><text [^>]+>2<\/text><\/g>/);
  const data = JSON.parse(html.match(/const SONAH = (.*);\n/)[1]);
  assert.deepEqual(data.gh['lib/use.js#Runner.go'], { n: 'Runner.go', p: 'lib/use.js', l: 9, c: [a.id], m: false });
  assert.deepEqual(data.fn[a.id].i, [2, 0, 3, 1]);
  assert.equal(data.fn[a.id].e, 2);
  // facts with no impact (git only, or an abstained run) draw no mark and no overlay
  assert.equal(LAID.d211.where.overlays.length, 0);
  assert.ok(LAID.d211.where.boxes.flatMap((bx) => bx.rows).every((r) => !r.mark));
});

test('Where (desktop): overlays sit where they cover no file and no caption, on a crowded graph too', async () => {
  // the d211 fixture with unchanged callers on many functions in several folders: each overlay finds a clear spot
  const x = structuredClone(ALL.d211);
  const live = x.facts.functions.filter((f) => f.status !== 'removed' && !f.fold).slice(0, 14);
  const callers = [];
  live.forEach((f, i) => {
    f.impact = { callers: 3, mayRun: 0, hop2: i % 3, byName: 0 };
    for (let k = 0; k < 3; k++) callers.push({ id: `lib/far${k}.js#caller${i}`, path: `lib/far${k}.js`, name: `caller${i}`, owner: null, line: 10 + i,
      kind: 'callable', calls: [f.id], may: false });
  });
  x.facts.impact = { callers, total: callers.length, hop2: 0, byName: 0, existingTestFiles: 0 };
  const L = await layout(x.facts, x.meaning, x.findings);
  assert.ok(L.where && L.where.overlays.length >= 10, `${L.where?.overlays.length} overlays`);
  assert.deepEqual(whereProblems(L.where, x.facts), []);
  // the same input, the same spots
  assert.deepEqual((await layout(x.facts, x.meaning, x.findings)).where.overlays, L.where.overlays);
});

test('Where (desktop): a file with more than 3 calls inside it draws them only for the selected function', async () => {
  // one file, five functions calling the next: four calls inside the file
  const names = ['a', 'b', 'c', 'd', 'e'];
  const fns = names.map((n, i) => ({ id: `lib/chain.js#${n}`, path: 'lib/chain.js', name: n, owner: null, kind: 'callable', status: 'changed',
    line: 1 + i * 10, span: [1 + i * 10, 8 + i * 10], oldLine: 1 + i * 10, added: 2, removed: 1, definition: `function ${n}() {`, commentOnly: false,
    diff: [['+', null, 2 + i * 10, `  ${names[i + 1] ?? 'x'}();`]], callers: { count: 0, list: [] }, tests: [], fold: null }));
  const facts = { v: 1, repo: { name: 'chain' }, range: { base: 'a'.repeat(40), head: 'b'.repeat(40), commits: [] },
    stats: { files: 1, added: 10, removed: 5, functions: 5, newFunctions: 0, changedFunctions: 5, removedFunctions: 0 },
    groups: [{ group: 'lib', files: ['lib/chain.js'] }],
    files: [{ path: 'lib/chain.js', status: 'modified', role: 'source', lang: 'js', added: 10, removed: 5, functions: fns.map((f) => f.id) }],
    functions: fns, mentions: names.slice(0, 4).map((n, i) => ({ from: `lib/chain.js#${n}`, to: `lib/chain.js#${names[i + 1]}`, onCodeLine: true, callShaped: true })),
    route: { read: [{ path: 'lib/chain.js', lines: 15 }], skim: [], skip: [], lines: { read: 15, skim: 0, skip: 0 } }, impact: null };
  const L = await layout(facts, null, null);
  const inner = L.where.edges.filter((e) => e.kind === 'inner');
  assert.ok(inner.length && inner.every((e) => e.for), 'none at rest: each belongs to a selected function');
  // each function's own set: its calls in and out, on tracks inside the margin
  for (const n of names) {
    const id = `lib/chain.js#${n}`;
    const mine = inner.filter((e) => e.for === id);
    assert.deepEqual(mine.map((e) => [e.from, e.to]).sort(), facts.mentions.filter((m) => m.from === id || m.to === id).map((m) => [m.from, m.to]).sort());
  }
  assert.deepEqual(whereProblems(L.where, facts), []);
  const html = render({ facts, layout: L });
  assert.equal((html.match(/<path class="cg-e in sel-only" data-for="/g) ?? []).length, inner.length);
  assert.match(html, /\.cg-e\.sel-only\{display:none\}/);
  // three or fewer: drawn at rest, once each
  const few = { ...facts, mentions: facts.mentions.slice(0, 3) };
  const L3 = await layout(few, null, null);
  const at = L3.where.edges.filter((e) => e.kind === 'inner');
  assert.equal(at.length, 3);
  assert.ok(at.every((e) => !e.for));
});

test('Where (desktop): top to bottom wins when it reads at a larger scale, or as well and clearly shorter', async () => {
  // two files with no call between them: left to right stacks them, top to bottom puts them side by side
  const x = structuredClone(ALL.tiny);
  const L = await layout(x.facts, x.meaning, x.findings);
  const boxes = L.where.boxes;
  if (boxes.length >= 2 && !L.where.edges.some((e) => e.kind === 'call')) {
    assert.ok(new Set(boxes.map((b) => Math.round(b.y))).size < boxes.length, 'files with no call between them sit side by side');
  }
  assert.ok(L.where.w <= WHERE.maxW / WHERE.minScale);
});

test('How (desktop): a long method name wraps at its joints onto a third line before it is cut', () => {
  assert.deepEqual(wrapName('D1TraceCollector.convertToOpenInferenceSpans', HOW.fnMax, HOW.t2, HOW.ownMax), ['D1TraceCollector.', 'convertToOpen', 'InferenceSpans']);
  assert.deepEqual(wrapName('runCodePass', HOW.fnMax, HOW.t2, HOW.ownMax), ['runCodePass']);
  for (const l of wrapName('aVeryLongFunctionNameThatGoesOnAndOnAndOnAndOnAndOnForever', HOW.fnMax, HOW.t2, HOW.ownMax)) {
    assert.ok(textWidth(l, HOW.t2, 'mono') <= HOW.fnMax + 0.01, l);
  }
  assert.ok(wrapName('aVeryLongFunctionNameThatGoesOnAndOnAndOnAndOnAndOnForever', HOW.fnMax, HOW.t2, HOW.ownMax).length <= 3);
});

test('the graphs keep their meaning when the meaning was not written: an abstained run still has its code graph', () => {
  const L = LAID['tiny-abstained'];
  assert.equal(L.flows.length, 0);
  assert.ok(L.where && L.where.boxes.length === ALL['tiny-abstained'].facts.files.filter((f) => f.functions.length).length);
  const html = page(ALL['tiny-abstained']);
  assert.match(html, /<svg class="cg"/);
  assert.match(html, /<p class="none">No flow: [^<]+<\/p>/);
});

// ---------- findings ----------
test('findings: ordered by tier, numbered, kept to functions that exist', () => {
  const ks = normFindings([{ tier: 'good-to-know', title: 'c', fns: ['nope'] }, { tier: 'must-act', title: 'a', fns: [] },
    { tier: 'must-know', title: 'b', fns: [] }, { tier: 'must-act', title: '' }], { functions: [] });
  assert.deepEqual(ks.map((k) => [k.n, k.key, k.title, k.fns]), [[1, 'k1', 'a', []], [2, 'k2', 'b', []], [3, 'k3', 'c', []]]);
  const html = page(ALL.d211);
  const ids = [...html.matchAll(/<li class="fd open t-\w+" id="(k\d+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(ids, ALL.d211.findings.map((_, i) => `k${i + 1}`));
});

test('fixtures exist in the contract shapes', () => {
  assert.ok(readdirSync(FIX).includes('d211'));
  for (const n of ['d211', 'tiny', 'large']) {
    const { facts } = ALL[n];
    for (const k of ['v', 'repo', 'range', 'stats', 'groups', 'files', 'functions', 'mentions', 'route']) assert.ok(k in facts, `${n} ${k}`);
    for (const f of facts.functions) {
      for (const k of ['id', 'path', 'name', 'kind', 'status', 'line', 'added', 'removed', 'diff', 'callers', 'tests', 'fold']) assert.ok(k in f, `${n} ${f.id} ${k}`);
    }
  }
  assert.equal(ALL.large.facts.functions.length, 150);
  assert.equal(ALL.large.facts.files.length, 30);
  assert.equal(ALL.tiny.facts.functions.length, 3);
  assert.equal(ALL.tiny.facts.files.length, 2);
});
