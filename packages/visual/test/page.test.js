// The page's own script and the bridge, run as they are on the rendered page in a small DOM (test/dom.mjs): a click on
// "Save online" or "Invite your team" posts exactly the upload and the intent; the keys light what they name; the
// card's width; the theme the team page sends in. And the keys as markup: only what the graph has, no two marks alike.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layout } from '../src/layout.mjs';
import { render, shareLink } from '../src/render.mjs';
import { uploadBody } from '../src/upload.mjs';
import { Event, loadPage, settle } from './dom.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name) => {
  const r = (f) => JSON.parse(readFileSync(join(HERE, 'fixtures', name, f), 'utf8'));
  return { facts: r('facts.json'), meaning: r('meaning.json'), findings: r('findings.json'), run: r('run.json') };
};
const D211 = load('d211');
const L211 = await layout(D211.facts, D211.meaning, D211.findings);
const SERVER = 'http://127.0.0.1:9/sonah';
const HOSTED = render({ ...D211, layout: L211 });
const URL211 = shareLink(SERVER, { owner: 'acme', repo: 'web', head: D211.facts.range.head });
const UPLOAD = uploadBody({ owner: 'acme', name: 'web', branch: 'main', page: HOSTED, ...D211 });
const LOCAL = render({ ...D211, layout: L211, mode: 'local', shareUrl: URL211, upload: UPLOAD });
// Two lists of nodes, the same nodes in the same order (by identity: a node's own fields are the whole page).
const sameNodes = (a, b, what) => {
  const name = (el) => `${el.localName}.${el.getAttribute('class')}[${el.getAttribute('data-k') ?? ''}]`;
  assert.ok(a.length === b.length && a.every((el, i) => el === b[i]), `${what}: ${a.length} ${a.slice(0, 4).map(name)} vs ${b.length} ${b.slice(0, 4).map(name)}`);
};
const click = (el, init = {}) => { const ev = new Event('click', { bubbles: true, cancelable: true, ...init }); el.dispatchEvent(ev); return ev; };

test('a click on "Save online" or "Invite your team" posts exactly the upload and the intent to /share, in a new tab', () => {
  const { document } = loadPage(LOCAL);
  const text = document.getElementById('sonah-upload').textContent;
  for (const [id, intent] of [['saveonline', 'save'], ['invite', 'invite'], ['invite2', 'invite']]) {
    const before = document.submitted.length;
    const ev = click(document.getElementById(id));
    assert.equal(ev.defaultPrevented, true, `${id}: the link is not followed`);
    assert.equal(document.submitted.length, before + 1, id);
    assert.deepEqual(document.submitted.at(-1), { method: 'post', action: `${SERVER}/share`, enctype: 'multipart/form-data',
      target: '_blank', rel: 'noopener', hidden: true, inBody: true, fields: [['upload', text], ['intent', intent]] }, id);
    assert.equal(document.querySelectorAll('form').length, 0, `${id}: the form is gone after it is sent`);
  }
  assert.deepEqual(JSON.parse(text), JSON.parse(JSON.stringify(UPLOAD)));
  // a click on the text inside the button (a span) counts; a click anywhere else sends nothing
  click(document.getElementById('invite').querySelector('span'));
  assert.equal(document.submitted.at(-1).fields[1][1], 'invite');
  const n = document.submitted.length;
  click(document.getElementById('theme'));
  click(document.querySelector('#where .key [data-k-for]'));
  assert.equal(document.submitted.length, n);
});

test('without the upload (over the cap, or none given) the buttons stay links: the click is not taken', () => {
  const page = render({ ...D211, layout: L211, mode: 'local', shareUrl: URL211 });
  const { document } = loadPage(page);
  assert.equal(document.getElementById('sonah-upload'), null);
  for (const id of ['saveonline', 'invite', 'invite2']) {
    const a = document.getElementById(id);
    assert.equal(a.getAttribute('href'), URL211, id);
    assert.equal(click(a).defaultPrevented, false, id);
  }
  assert.equal(document.submitted.length, 0);
});

test('keys: hover or focus on an entry lights the marks it names (by data-k) and quiets the rest; leaving restores', async () => {
  const { document } = loadPage(LOCAL);
  for (const stop of ['where', 'how']) {
    const sec = document.getElementById(stop);
    const marks = sec.querySelectorAll('[data-k]');
    for (const entry of sec.querySelectorAll('.key [data-k-for]')) {
      const t = entry.getAttribute('data-k-for');
      const named = marks.filter((el) => el.getAttribute('data-k').split(' ').includes(t));
      assert.ok(named.length > 0, `${stop} ${t}: the key names something the graph has`);
      for (const [on, off] of [['mouseenter', 'mouseleave'], ['focus', 'blur']]) {
        entry.dispatchEvent(new Event(on));
        assert.ok(sec.classList.contains('k-on'), `${stop} ${t} ${on}`);
        sameNodes(sec.querySelectorAll('.k-lit'), named, `${stop} ${t} ${on}: exactly what it names`);
        entry.dispatchEvent(new Event(off));
        assert.ok(!sec.classList.contains('k-on') && sec.querySelectorAll('.k-lit').length === 0, `${stop} ${t} ${off}`);
      }
    }
  }
  // the code graph's "new" entry lights its new chips (graph and list) and nothing else
  const where = document.getElementById('where');
  where.querySelector('.key [data-k-for="new"]').dispatchEvent(new Event('mouseenter'));
  const lit = where.querySelectorAll('.k-lit');
  assert.ok(lit.length > 0 && lit.every((el) => el.classList.contains('new')));
  sameNodes(lit, where.querySelectorAll('svg.cg .chip.new, .map-p .pchip.new'), 'the new chips');
  // one stop at a time: lighting How's entry lets Where's go
  document.querySelector('#how .key [data-k-for]').dispatchEvent(new Event('mouseenter'));
  assert.ok(!where.classList.contains('k-on') && document.getElementById('how').classList.contains('k-on'));
  await settle();
});

test('the card: about 600 px on a desktop, never wider than its column or the window less 32 px; the phone sheet as before', () => {
  // the card opened on a code graph row at x (its box 170 x 26 at y 300), in a window vw wide with the page's column col
  const open = (vw, col, x) => {
    const { document } = loadPage(LOCAL, { width: vw });
    document.querySelector('main').rect = { x: vw - col - 16, y: 0, width: col, height: 9000 };
    const chip = document.querySelector('svg.cg g.chip[data-fn]');
    chip.rect = { x, y: 300, width: 170, height: 26 };
    click(chip, { detail: 1 });
    const card = document.getElementById('card');
    assert.equal(card.hidden, false);
    const c = { x: parseFloat(card.style.left), y: parseFloat(card.style.top), w: parseFloat(card.style.width) };
    if (vw >= 700) assert.ok(c.x + c.w <= x || c.x >= x + 170 || c.y >= 326, `${vw}: beside the row, not over it`);
    return c.w;
  };
  assert.equal(open(1440, 1140, 790), 600);
  assert.equal(open(1280, 1120, 720), 600);
  assert.equal(open(1440, 1140, 120), 600, 'on the other side when that one is free');
  assert.equal(open(1440, 520, 790), 520, 'a narrow column holds it');
  // where only a narrower side is free, that side (at least 380 px): never past 600, the column or the window less 32
  for (const [vw, col, x] of [[800, 768, 440], [800, 768, 40], [720, 688, 300], [1024, 600, 500]]) {
    const w = open(vw, col, x);
    assert.ok(w >= 380 && w <= Math.min(600, col, vw - 32), `${vw}/${col}: ${w}`);
  }
  // under 700 px: the full-width sheet (the window less the page's side padding), as before
  assert.equal(open(640, 608, 200), 640 - 32);
  assert.equal(open(400, 368, 100), 400 - 32);
  // the stylesheet's own cap matches
  assert.ok(LOCAL.includes('.card{position:absolute; z-index:50; top:0; left:0; width:min(600px, calc(100vw - 32px));'));
});

test('the bridge: the team page\'s theme comes in as sonah:theme, light or dark only; the page sends none of its own', async () => {
  const posted = [];
  const parent = { postMessage: (m) => posted.push(JSON.parse(JSON.stringify(m))) };
  const { document, window } = loadPage(HOSTED, { parent, storage: false });
  const root = document.documentElement;
  const send = (data, source = parent) => window.fire(new Event('message', { source, data }));
  assert.ok(root.hasAttribute('data-sonah-framed'), 'framed: the page\'s own switch hides (page.css)');
  assert.ok(HOSTED.includes('[data-sonah-framed] #theme, [data-sonah-framed] [data-intent]{display:none}'));
  assert.deepEqual(posted.map((m) => m.type), ['sonah:ready']);
  send({ type: 'sonah:theme', theme: 'dark' });
  assert.equal(root.getAttribute('data-theme'), 'dark');
  await settle();
  assert.ok(root.classList.contains('is-dark'), 'the page follows it (its icon and label)');
  send({ type: 'sonah:theme', theme: 'light' });
  assert.equal(root.getAttribute('data-theme'), 'light');
  // anything else is ignored: other values, other shapes, another window
  for (const theme of ['blue', 'DARK', 'dark ', '', null, 1, ['dark'], { toString: () => 'dark' }]) send({ type: 'sonah:theme', theme });
  send({ type: 'sonah:theme', theme: 'dark' }, { postMessage() {} });
  send('sonah:theme dark');
  send(['sonah:theme', 'dark']);
  assert.equal(root.getAttribute('data-theme'), 'light');
  await settle();
  assert.ok(!root.classList.contains('is-dark'));
  // the page never tells the theme back (the team page has the one switch)
  assert.deepEqual(posted.map((m) => m.type), ['sonah:ready']);
  // the other messages are as they were: marks still mark
  const key = posted[0].keys[0];
  send({ type: 'sonah:marks', marks: { [key]: { act: 'confirm' } } });
  assert.ok(document.querySelectorAll('[data-key], [data-fn]').some((el) => el.getAttribute('data-mark') === 'confirm'));
  // outside a frame the bridge does nothing, so a theme message changes nothing
  const alone = loadPage(HOSTED);
  alone.window.fire(new Event('message', { source: alone.window, data: { type: 'sonah:theme', theme: 'dark' } }));
  assert.equal(alone.document.documentElement.getAttribute('data-theme'), null);
  assert.ok(!alone.document.documentElement.hasAttribute('data-sonah-framed'));
});

test('keys as markup: only what the graph has, a sample with the graph\'s own classes, a few words; no two marks alike', async () => {
  const where = (html) => html.slice(html.indexOf('<section class="stop" id="where"'), html.indexOf('<section class="stop" id="decide"'));
  const how = (html) => html.slice(html.indexOf('<section class="stop" id="how"'), html.indexOf('<section class="stop" id="where"'));
  const entries = (sec) => [...sec.matchAll(/<li( class="[wp]-only")?><button type="button" class="k" data-k-for="(\w+)"><svg class="ks"[^>]*>([\s\S]*?)<\/svg><span>([^<]*)<\/span><\/button><\/li>/g)]
    .map((m) => ({ only: m[1] ? m[1].slice(8, -1) : '', k: m[2], sample: m[3], words: m[4] }));
  const w = entries(where(HOSTED));
  assert.deepEqual(w.map((e) => e.k), ['new', 'chg', 'more', 'num', 'find', 'notest', 'call']);
  for (const e of w) assert.ok(e.words.split(' ').length <= 4, e.words);
  assert.ok(!/folded|cap|order in the first flow/.test(w.map((e) => e.words).join(' ')), 'no jargon');
  // the samples are the graph's own marks: a chip of its kind, the number circle, the pins, the no-test mark, a call
  assert.match(w.find((e) => e.k === 'new').sample, /<g class="chip new"><rect class="bd"/);
  assert.match(w.find((e) => e.k === 'chg').sample, /<g class="chip chg"><rect class="bd"/);
  assert.match(w.find((e) => e.k === 'more').sample, /<g class="chip more">[\s\S]*>\+\d+ more<\/text>/);
  assert.match(w.find((e) => e.k === 'num').sample, /<circle class="cn"/);
  // the finding sample: numbered pins at the graph's own size, the first finding of each tier the graph has
  const pins = [...w.find((e) => e.k === 'find').sample.matchAll(/<g class="pin t-(act|know|good)"><circle cx="[\d.]+" cy="9" r="8"\/><text [^>]*>(\d+)<\/text><\/g>/g)];
  assert.ok(pins.length >= 1, 'numbered, as on the graph');
  const firstOf = (t) => Math.min(...L211.where.boxes.flatMap((b) => b.rows).flatMap((r) => r.pins ?? []).filter((p) => p.tier === t && !p.more).map((p) => p.n));
  const cls = { act: 'must-act', know: 'must-know', good: 'good-to-know' };
  for (const [, t, n] of pins) assert.equal(Number(n), firstOf(cls[t]), `${t}: its first finding's number`);
  assert.match(w.find((e) => e.k === 'notest').sample, /<g class="ut">/);
  assert.match(w.find((e) => e.k === 'call').sample, /class="cg-e"/);
  // calls inside a file are drawn as brackets in its margin: the sample shows one too when the graph has them
  assert.equal(/class="cg-e in"/.test(w.find((e) => e.k === 'call').sample), L211.where.edges.some((e) => e.kind === 'inner'));
  assert.equal(w.find((e) => e.k === 'call').only, 'w-only', 'calls are drawn on the desktop graph only');
  // How's key, the same component
  const h = entries(how(HOSTED));
  assert.deepEqual(h.map((e) => e.k), ['new', 'chg', 'ext', 'branch', 'signal', 'was', 'num', 'find']);
  assert.equal(h.find((e) => e.k === 'was').only, 'w-only', 'the before track is drawn on the desktop flow only');
  assert.match(h.find((e) => e.k === 'chg').sample, /<g class="node chg"><rect/);
  // a kind the graph does not have has no entry (no removed function here; with one, "removed")
  assert.ok(!w.some((e) => e.k === 'gone' || e.k === 'out'));
  const x = structuredClone(D211);
  const f = x.facts.functions.find((g) => g.status !== 'removed' && !g.fold);
  f.status = 'removed';
  f.impact = { callers: 0, mayRun: 0, hop2: 0, byName: 0 };
  const g = x.facts.functions.find((h) => h !== f && h.status !== 'removed' && !h.fold);
  g.impact = { callers: 12, mayRun: 0, hop2: 0, byName: 0 };
  x.facts.impact = { callers: [], total: 12, hop2: 0, byName: 0, existingTestFiles: 0, partial: true };
  const page = render({ ...x, layout: await layout(x.facts, x.meaning, x.findings) });
  const w2 = entries(where(page));
  assert.ok(w2.some((e) => e.k === 'gone' && e.words === 'removed'));
  const out = w2.find((e) => e.k === 'out');
  assert.equal(out.words, 'callers outside this change');
  assert.match(out.sample, /<g class="imp-m"><path d="[^"]+"\/><text [^>]*>12\+<\/text><\/g>/, 'at least: the count carries +');
  // no two marks alike, on the graph itself: the How number is a ring at the chip's left, the pins are filled
  // tier-coloured circles at its right, the callers count an arrow with its number (no circle, no box)
  const svg = where(page).slice(where(page).indexOf('<svg class="cg"'));
  const chips = [...svg.matchAll(/<g class="chip (?:new|chg|gone|more)"[^>]*data-box="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)">([\s\S]*?)<\/g>(?=\n)/g)];
  let nums = 0, marks = 0;
  for (const [, x0, , w0, , body] of chips) {
    const mid = Number(x0) + Number(w0) / 2;
    for (const m of body.matchAll(/<circle class="cn" cx="([\d.]+)"/g)) { nums++; assert.ok(Number(m[1]) < mid, 'the number on the left'); }
    const imp = /<g class="imp-m">([\s\S]*?)<\/g>/.exec(body);
    if (imp) { marks++; assert.doesNotMatch(imp[1], /<circle|<rect/, 'no circle or box'); assert.match(imp[1], /^<path d="M[^"]+"\/><text/); }
  }
  assert.ok(nums > 0 && marks > 0, `${nums} numbers, ${marks} callers marks`);
  const rows = L211.where.boxes.flatMap((b) => b.rows).filter((r) => r.pins?.length);
  assert.ok(rows.length && rows.every((r) => r.pins.every((p) => p.cx > r.x + r.w / 2)), 'the pins on the right');
  // and in the stylesheet: the number a ring of the route colour, a pin filled with its tier's, new and changed apart
  assert.match(page, /\.chip \.cn\{fill:none; stroke:var\(--route\); stroke-width:1\.6\}/);
  assert.match(page, /\.nb circle\{fill:var\(--bg\); stroke:var\(--route\); stroke-width:1\.6\}/);
  assert.match(page, /\.pin circle\{fill:var\(--tc\)/);
  assert.match(page, /\.chip\.new \.bd\{fill:var\(--chip-new\)\}/);
  assert.match(page, /\.chip\.chg \.bd\{fill:var\(--chip-chg\); stroke:var\(--hair-2\); stroke-width:1\}/);
  for (const theme of [/:root\{[^}]*--chip-new:rgba\(62,124,116,\.2\); --chip-chg:#FFFFFF;/, /:root\[data-theme="dark"\]\{[^}]*--chip-new:rgba\(135,183,175,\.27\); --chip-chg:transparent;/]) {
    assert.match(page, theme);
  }
  // on a desktop the key stays in view over its figure, under the stop bar; on phones it stays put
  assert.match(page, /@media \(min-width:720px\)\{\s*\.key\{position:sticky; top:var\(--stick\);/);
  assert.match(page, /:root\[data-sonah-framed\]\{--stick:64px\}/);
});
