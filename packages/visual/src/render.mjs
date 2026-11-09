// Layer 3, part 2: the review page, drawn from data. Same input, same bytes: no clock, random, network or model.
// Five stops in order: What, How, Where, Decide, Read (the flow first: it is the better first view, then where each
// step's code sits). Positions come from layout.mjs; nothing is placed by hand.
// The page is one whole UTF-8 document, served by Sonah's server as it is (text/html; charset=utf-8).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { layoutBase, normMeaning, normFindings, countText, fnLabel, TIERS } from './layout.mjs';
import { HOW } from './graph-how.mjs';
import { WHERE } from './graph-where.mjs';
import { scriptJson, uploadText } from './upload.mjs';

const CSS = readFileSync(new URL('./page.css', import.meta.url), 'utf8');
// The local page is opened from disk and makes no request: it leaves out the stylesheet's web-font import (its first
// line starting `@import url(`) and draws in the fallback fonts, which the width tables already allow for
// (graph-text.mjs). The hosted page keeps the import.
const LOCAL_CSS = CSS.replace(/^@import url\([^\n]*\n?/m, '');
const CLIENT = readFileSync(new URL('./page.client.js', import.meta.url), 'utf8');
// The hosted page's last script: its side of the team page's frame protocol (bridge.client.js says how it works).
const BRIDGE = readFileSync(new URL('./bridge.client.js', import.meta.url), 'utf8');
for (const [name, text] of [['page.client.js', CLIENT], ['bridge.client.js', BRIDGE]]) {
  if (/<\/?script/i.test(text)) throw new Error(`${name} must not contain a script tag`);
}
/** The page's one script in <head>: the stored theme before first paint (the server hashes it for its CSP). */
export const THEME_SCRIPT = "try { const t = localStorage.getItem('sonah-review-theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}";
/**
 * The hosted page's second script in <head>. Framed (on the team page), it marks the root at once, before the first
 * paint, so the frame's one-column layout is the first one drawn, and nothing of the page is painted until the team
 * page's theme comes (bridge.client.js; at most 3 seconds if it never does): a sandboxed frame keeps no theme, so it
 * would first paint in the system's. Outside a frame it does nothing.
 */
export const FRAMED_SCRIPT = "try { if (window.parent !== window) { const r = document.documentElement; r.setAttribute('data-sonah-framed', ''); r.setAttribute('data-sonah-wait', ''); setTimeout(() => r.removeAttribute('data-sonah-wait'), 3000); } } catch (e) {}";
const CARD_ROWS = 40; // diff rows shown before "+N more", counted from the definition line
const FOLD_HEAD = 4; // this many rows or more above the definition line (its doc comment) fold into one row

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = scriptJson; // JSON safe in a script element: "<" and the line separators as \u escapes
const arr = (x) => (Array.isArray(x) ? x : []);
const short = (sha) => String(sha ?? '').slice(0, 7);
const base = (p) => String(p).split('/').pop();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const TIER_CLS = Object.freeze({ 'must-act': 'act', 'must-know': 'know', 'good-to-know': 'good' });
const TIER_NAME = Object.freeze({ 'must-act': 'Must act', 'must-know': 'Must know', 'good-to-know': 'Good to know' });
/** The page's stops, in reading order (the rail, the sections and so the keyboard order). */
export const STOPS = Object.freeze(['What', 'How', 'Where', 'Decide', 'Read']);
const pts = (p) => p.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');

function pinA(k, extra = '') {
  return `<a href="#${k.key}" class="pin-h t-${TIER_CLS[k.tier]}${extra}" title="${esc(k.title)}" aria-label="${esc(`Finding ${k.n}: ${k.title}`)}">${k.n}</a>`;
}
function pinSvg(p, r = 9) {
  const label = p.more ? `+${p.more}` : String(p.n);
  return `<a href="#${p.key}" class="pin t-${TIER_CLS[p.tier]}" data-k="find" aria-label="${esc(p.more ? `${p.more} more findings` : `Finding ${p.n}`)}"><circle cx="${p.cx}" cy="${p.cy}" r="${r}"/><text x="${p.cx}" y="${p.cy + 3.8}" text-anchor="middle"${p.more ? " class=\"pm\"" : ""}>${label}</text></a>`;
}
// The count of a function's unchanged callers: a small incoming arrow and the number, no circle (the How number and
// the finding pins are the circles).
function callersMark(x, cy, label) {
  const r = (v) => Math.round(v * 10) / 10;
  return `<g class="imp-m"><path d="M${r(x + 1)},${r(cy)} H${r(x + 8)} M${r(x + 5)},${r(cy - 3)} L${r(x + 8)},${r(cy)} L${r(x + 5)},${r(cy + 3)}"/><text x="${r(x + 11)}" y="${r(cy + 3.5)}">${esc(label)}</text></g>`;
}

// ---------- the keys ----------
// A graph's key: one entry per kind of mark the graph has (from the data, so a key shows only what is there), each a
// real small sample drawn with the graph's own classes and a few plain words. Hover or focus on an entry lights the
// marks it names (each carries its tokens in data-k) and quiets the rest (page.client.js). `only` keeps an entry to the
// view that has it: 'w-only' the desktop graph, 'p-only' the phone view.
function keyHtml(entries) {
  const list = entries.filter(Boolean);
  if (!list.length) return '';
  return `<ul class="key" aria-label="Key">${list.map((e) => `<li${e.only ? ` class="${e.only}"` : ''}><button type="button" class="k" data-k-for="${e.k}">${e.sample}<span>${esc(e.words)}</span></button></li>`).join('')}</ul>`;
}
const ks = (w, inner) => `<svg class="ks" viewBox="0 0 ${w} 18" width="${w}" height="18" aria-hidden="true">${inner}</svg>`;
const KS = Object.freeze({
  chip: (kind) => ks(28, `<g class="chip ${kind}"><rect class="bd" x="1" y="2" width="26" height="14" rx="4.5"/></g>`),
  more: (label) => { const w = Math.ceil(label.length * 6.6 + 14); return ks(w, `<g class="chip more"><rect class="bd" x="1" y="1" width="${w - 2}" height="16" rx="5"/><text class="nm" x="7" y="12.6">${esc(label)}</text></g>`); },
  num: () => ks(16, '<g class="chip"><circle class="cn" cx="8" cy="9" r="7.5"/><text class="cnt" x="8" y="12.5" text-anchor="middle">1</text></g>'),
  badge: () => ks(16, '<g class="nb"><circle cx="8" cy="9" r="7"/><text x="8" y="12.5" text-anchor="middle">1</text></g>'),
  pins: (firsts) => ks(firsts.length * 19 + 1, firsts.map((p, i) => `<g class="pin t-${TIER_CLS[p.tier]}"><circle cx="${9 + i * 19}" cy="9" r="8"/><text x="${9 + i * 19}" y="12.6" text-anchor="middle">${p.n}</text></g>`).join('')),
  callers: (label) => ks(Math.ceil(13 + label.length * 6.2), callersMark(0, 9, label)),
  notest: () => ks(12, '<g class="chip"><g class="ut"><rect x="1.5" y="4.5" width="9" height="9" rx="1.5"/><line x1="1.5" y1="13.5" x2="10.5" y2="4.5"/></g></g>'),
  call: (inner) => ks(inner ? 42 : 26, '<path class="cg-e" d="M1,9 H20"/><path class="mk-call" d="M18,5.5 L25,9 L18,12.5 z"/>'
    + (inner ? '<path class="cg-e in" d="M38,2.5 H32 V13.5 H35"/><path class="mk-call" d="M34.5,10.5 L39,13.5 L34.5,16.5 z"/>' : '')),
  node: (kind) => ks(28, `<g class="node ${kind}"><rect x="1" y="2" width="26" height="14" rx="5"/></g>`),
  line: (cls) => ks(26, `<path class="${cls}" d="M1,9 H25"/>`),
  was: () => ks(26, '<line class="b-line" x1="1" y1="9" x2="25" y2="9"/><circle class="b-dot" cx="13" cy="9" r="4"/>'),
});
// The key's finding sample: for each tier the graph's pins have, in tier order, its lowest finding number.
const firstPins = (pins) => TIERS.map((tier) => {
  const ns = pins.filter((p) => p && p.tier === tier && !p.more && Number.isSafeInteger(p.n)).map((p) => p.n);
  return ns.length ? { tier, n: Math.min(...ns) } : null;
}).filter(Boolean);
// Which kinds of mark a view has: the tokens its marks carry (data-k).
const tokensOf = (marks) => new Set(marks.flatMap((m) => m.split(' ').filter(Boolean)));
// An entry for a token: shown in both views, or kept to the one that has it (only when there are two views).
const onlyOf = (t, wide, tall) => (wide && tall ? (wide.has(t) && tall.has(t) ? '' : wide.has(t) ? 'w-only' : 'p-only') : '');
const hasIn = (t, wide, tall) => (wide && wide.has(t)) || tall.has(t);
const fnAttr = (ids) => (ids.length === 1 ? `data-fn="${esc(ids[0])}" data-key="${esc(ids[0])}"` : `data-group="${esc(ids.join(' '))}"`);

// Item keys, by structure only, so a decision made on one version finds the same item on the next one.
// A function's key is its facts id; a finding's is k_ + 16 hex of sha256(its sorted function ids, one per line, then
// its quote, trimmed as the page shows it). The server checks decisions against these same keys.
export function findingKey(fns, quote) {
  const ids = arr(fns).map(String).sort();
  return `k_${createHash('sha256').update(`${ids.join('\n')}\n${String(quote ?? '').trim()}`).digest('hex').slice(0, 16)}`;
}

// ---------- What ----------
// The same text, by letters and digits only (a string comparison, not a reading of meaning).
const sameText = (a, b) => { const k = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); return k(a) === k(b); };
// The findings line when none is shown: "No findings" only when no finding was lost to the checks and the call that
// asks for them did not fail.
const noFindings = (lost, failed) => (failed ? '<b>The findings call failed</b> <span class="dim">· nothing was checked</span>'
  : lost ? `<b>No finding passed the checks</b> <span class="dim">· ${plural(lost, 'finding')} dropped</span>` : '<b>No findings</b>');

function whatStop(facts, m, ks, lost, failed) {
  const st = facts.stats ?? {};
  const commits = arr(facts.range?.commits);
  const head = m.story?.oneLine || (commits.length === 1 ? commits[0].subject : '')
    || `${plural(commits.length || 0, 'commit')} on ${facts.repo?.name ?? 'this repository'}`;
  const askText = m.story?.ask && !(!m.story.oneLine && sameText(m.story.ask, head)) ? m.story.ask : '';
  const ask = askText ? `<div class="ask"><span class="lbl">Ask</span><span>${esc(askText)}</span></div>` : '';
  const fnParts = [[st.newFunctions, 'new'], [st.changedFunctions, 'changed'], [st.removedFunctions, 'removed']]
    .filter(([n]) => n).map(([n, w]) => `${num(n)} ${w}`).join(' · ');
  const tierCells = TIERS.map((t) => {
    const of = ks.filter((k) => k.tier === t);
    return of.length ? `<div class="tg"><div class="tp">${of.map((k) => pinA(k)).join('')}</div><span>${TIER_NAME[t]}</span></div>` : '';
  }).join('');
  return `<section class="stop" id="what" aria-labelledby="h-what">
    <h2 class="vh" id="h-what">What changed</h2>
    <h1>${esc(head)}</h1>
    ${ask}
    <div class="sumrow">
      <div class="cell"><div class="big">${num(st.files ?? arr(facts.files).length)}</div><div class="cap">files · <span class="add">+${num(st.added)}</span> <span class="del">−${num(st.removed)}</span> lines</div></div>
      <div class="cell"><div class="big">${num(st.functions ?? arr(facts.functions).length)}</div><div class="cap">functions${fnParts ? ` · ${fnParts}` : ''}</div></div>
      <div class="cell"><div class="cap">${ks.length ? `<b>${plural(ks.length, 'finding')}</b>` : noFindings(lost, failed)}</div>${ks.length ? `<div class="tiers">${tierCells}</div>` : ''}</div>
    </div>
  </section>`;
}

// Under the flows (How is the first view): the before / now pairs side by side, then the read route bar.
function afterFlows(m, L) {
  const pairs = m.story?.beforeNow ?? [];
  const bn = pairs.length ? `<div class="bn" role="table" aria-label="Before and now">
    <div class="bn-h" role="row"><span class="lbl" role="columnheader">Before</span><span aria-hidden="true"></span><span class="lbl now" role="columnheader">Now</span></div>
    ${pairs.map((p) => `<div class="bn-r" role="row"><span class="bn-b" role="cell"><i class="lbl">Before</i>${esc(p.before)}</span><svg class="bn-a" viewBox="0 0 24 12" aria-hidden="true"><path d="M1,6 H21 M16,1.5 L21.5,6 L16,10.5"/></svg><span class="bn-n" role="cell"><i class="lbl now">Now</i>${esc(p.now)}</span></div>`).join('')}
  </div>` : '';
  const route = L.route;
  const bar = route.total ? `<div class="route">
      <div class="lbl">Suggested route <span class="dim">· ${num(route.total)} diff lines</span></div>
      <div class="rb">${route.bar.filter((t) => t.lines).map((t) => `<div class="rb-g rb-${t.tier}" style="flex-grow:${t.lines}">${t.items.filter((x) => x.lines).map((x) => `<button type="button" class="seg" data-path="${esc(x.path)}" style="flex-grow:${x.lines}" title="${esc(`${base(x.path)} · ${x.lines} lines`)}" aria-label="${esc(`${t.tier}: ${base(x.path)}, ${x.lines} lines`)}"></button>`).join('')}</div>`).join('')}</div>
      <div class="rb-key">${route.bar.map((t) => `<span><i class="sw sw-${t.tier}"></i>${t.tier} ${t.tier === 'read' ? `<b>${num(t.lines)}</b>` : num(t.lines)}</span>`).join('')}</div>
      ${route.bar[0].items.length ? `<div class="rb-files">${route.bar[0].items.map((x) => `<button type="button" class="fl" data-path="${esc(x.path)}">${esc(base(x.path))}</button>`).join('')}</div>` : ''}
    </div>` : '';
  return `${bn}${bar}`;
}

// ---------- Where ----------
// A polyline with soft corners (orthogonal routes from the layout).
function polyD(p, rad = 7) {
  if (p.length < 2) return '';
  const f = (v) => Math.round(v * 10) / 10;
  let d = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const [ax, ay] = p[i - 1], [bx, by] = p[i], [cx, cy] = p[i + 1];
    const l1 = Math.hypot(bx - ax, by - ay), l2 = Math.hypot(cx - bx, cy - by);
    const r = Math.min(rad, l1 / 2, l2 / 2);
    if (r < 0.5) { d += ` L${f(bx)},${f(by)}`; continue; }
    const a = [bx - ((bx - ax) / l1) * r, by - ((by - ay) / l1) * r], c = [bx + ((cx - bx) / l2) * r, by + ((cy - by) / l2) * r];
    d += ` L${f(a[0])},${f(a[1])} Q${f(bx)},${f(by)} ${f(c[0])},${f(c[1])}`;
  }
  const z = p[p.length - 1];
  return `${d} L${f(z[0])},${f(z[1])}`;
}

// What a function's chip shows, as the key's tokens (data-k): its kind, its How number, findings, callers outside this
// change, no test found, and (on the desktop graph) a call line. A graph row's pins are `pins`; a list chip's, `allPins`.
const pinsOfChip = (c) => (c.allPins ?? c.pins ?? []);
const callEnds = (cg) => new Set(cg.edges.flatMap((e) => [e.from, e.to]));
const chipTokens = (c, calls) => [c.kind, c.n ? 'num' : '', pinsOfChip(c).length ? 'find' : '', c.impact ? 'out' : '',
  c.notest ? 'notest' : '', calls && c.ids.some((id) => calls.has(id)) ? 'call' : ''].filter(Boolean).join(' ');
// The list chip's callers glyph: the code graph's small incoming arrow, in HTML.
const ARROW_IN = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1,5 H8 M5,2 L8,5 L5,8"/></svg>';

// The desktop code graph: nested folder regions, file boxes of function rows, calls; one overlay per function with
// unchanged callers, hidden until that function is selected.
function codeGraphSvg(cg, tierOf, more = '') {
  const P = [];
  P.push(`<svg class="cg" viewBox="0 0 ${cg.w} ${cg.h}" width="${cg.w}" height="${cg.h}" xmlns="http://www.w3.org/2000/svg">`);
  P.push('<defs><marker id="mk-call" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0.5 L10,5 L0,9.5 z" class="mk-call"/></marker><marker id="mk-imp" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0,0.5 L10,5 L0,9.5 z" class="mk-imp"/></marker></defs>');
  for (const r of cg.regions) P.push(`<g class="rg d${Math.min(r.depth, 3)}" aria-hidden="true"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="18"/><text class="r-lbl" x="${r.x + 12}" y="${r.y + 18}">${esc(r.label)}</text></g>`);
  for (const b of cg.boxes) {
    const [, isNew, add, del] = b.count.match(/^(new )?\+(\d+)(?: −(\d+))?$/) ?? [];
    const cnt = `${isNew ? '<tspan class="nw">new </tspan>' : ''}<tspan class="add">+${add ?? 0}</tspan>${del ? `<tspan class="del" dx="6">−${del}</tspan>` : ''}`;
    const t = tierOf(b.path);
    P.push(`<g class="m-file g-${t}" data-path="${esc(b.path)}" tabindex="0" role="button" aria-label="${esc(`${b.path}, ${t}, ${b.count} lines`)}"><rect class="fb" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14"/><text class="fn" x="${b.x + 14}" y="${b.y + 23}">${esc(b.name)}</text><text class="fcnt" x="${b.x + b.w - 12}" y="${b.y + 23}">${cnt}</text></g>`);
  }
  // calls: between files, and inside one file as brackets (a file with many draws each function's own set only while
  // it is selected: data-for)
  for (const e of cg.edges) P.push(`<path class="cg-e${e.kind === 'inner' ? ' in' : ''}${e.for ? ' sel-only' : ''}"${e.for ? ` data-for="${esc(e.for)}"` : ''} data-from="${esc(e.from)}" data-to="${esc(e.to)}" data-k="call" d="${polyD(e.points, e.kind === 'inner' ? 3 : 7)}" marker-end="url(#mk-call)"/>`);
  const calls = callEnds(cg);
  for (const b of cg.boxes) for (const c of b.rows) {
    if (c.kind === 'owner') { P.push(`<text class="own" x="${c.x + 2}" y="${c.y + c.h - 4}">${esc(c.label)}</text>`); continue; }
    const what = c.kind === 'more' ? `${c.ids.length} more functions in ${base(b.path)}` : `${c.full ?? c.label}, ${c.kind === 'new' ? 'new' : c.kind === 'gone' ? 'removed' : 'changed'}${c.impact ? `, ${plural(c.impact, 'unchanged caller')}` : ''}`;
    const tx = c.x + 10 + (c.n ? 22 : 0), ty = c.y + c.h / 2 + 4.2;
    P.push(`<g class="chip ${c.kind}" ${fnAttr(c.ids)} data-k="${chipTokens(c, calls)}" tabindex="0" role="button" aria-label="${esc(what)}" data-box="${c.x} ${c.y} ${c.w} ${c.h}"><title>${esc(what)}</title><rect class="ring" x="${c.x - 3}" y="${c.y - 3}" width="${c.w + 6}" height="${c.h + 6}" rx="10"/><rect class="bd" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="8"/>${c.n ? `<circle class="cn" cx="${c.x + 16}" cy="${c.y + c.h / 2}" r="8"/><text class="cnt" x="${c.x + 16}" y="${c.y + c.h / 2 + 3.6}" text-anchor="middle">${c.n}</text>` : ''}<text class="nm" x="${tx}" y="${ty}">${esc(c.label)}</text>${c.mark ? callersMark(c.mark.x, c.mark.y + c.mark.h / 2, `${c.impact}${more}`) : ''}${c.ut ? `<g class="ut"><rect x="${c.ut.x}" y="${c.ut.y}" width="8" height="8" rx="1.5"/><line x1="${c.ut.x}" y1="${c.ut.y + 8}" x2="${c.ut.x + 8}" y2="${c.ut.y}"/></g>` : ''}</g>`);
  }
  for (const b of cg.boxes) for (const c of b.rows) for (const p of c.pins) P.push(pinSvg(p, 8));
  for (const o of cg.overlays) {
    P.push(`<g class="imp" data-for="${esc(o.fn)}" hidden><rect class="imp-bg" x="${o.x}" y="${o.y}" width="${o.w}" height="${o.h}" rx="12"/><text class="imp-c" x="${o.x + 10}" y="${o.y + 15}">${esc(o.caption)}</text>`);
    for (const f of o.files) P.push(`<rect class="imp-f" x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" rx="10"/><text class="imp-fn" x="${f.x + 8}" y="${f.y + 16}">${esc(f.name)}</text>`);
    for (const l of o.lines) P.push(`<path class="imp-l${l.may ? ' may' : ''}" d="${polyD(l.points, 5)}" marker-end="url(#mk-imp)"/>`);
    for (const c of o.chips) P.push(`<g class="chip ghost${c.may ? ' may' : ''}" data-ghost="${esc(c.id)}" tabindex="0" role="button" aria-label="${esc(`${c.label}, unchanged${c.may ? ', may run it' : ''}`)}"><rect class="bd" x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="7"/><text class="nm" x="${c.x + 9}" y="${c.y + c.h / 2 + 4}">${esc(c.label)}${c.may ? '<tspan class="mr" dx="8">may run</tspan>' : ''}</text></g>`);
    for (const t of o.notes) P.push(`<text class="imp-n" x="${t.x}" y="${t.y}">${esc(t.text)}</text>`);
    P.push('</g>');
  }
  P.push('</svg>');
  return P.join('\n');
}

function mapList(map, tierOf, more = '') {
  return map.groups.map((g) => {
    const cards = g.files.filter((f) => !f.pill).map((f) => `<div class="pc g-${tierOf(f.path)}"><button type="button" class="pc-h" data-path="${esc(f.path)}"><code>${esc(f.label)}</code><span class="pc-c">${esc(f.count)}</span></button><div class="pc-b">${f.chips.map((c) => `<span class="pwrap"><button type="button" class="pchip ${c.kind}" ${fnAttr(c.ids)} data-k="${chipTokens(c, null)}">${c.n ? `<i class="rn">${c.n}</i>` : ''}${esc(c.label)}${c.impact ? `<i class="imp-h" title="${esc(`${more ? 'at least ' : ''}${plural(c.impact, 'unchanged caller')}`)}">${ARROW_IN}${c.impact}${more}</i>` : ''}${c.notest ? '<i class="ut-h" title="no test found"></i>' : ''}</button>${c.allPins.map((p) => `<a href="#${p.key}" class="pin-h t-${TIER_CLS[p.tier]}" data-k="find" aria-label="Finding ${p.n}">${p.n}</a>`).join('')}</span>`).join('')}</div></div>`);
    const others = g.files.filter((f) => f.pill);
    if (others.length) cards.push(`<div class="pc other">${others.map((f) => `<button type="button" class="pfile" data-path="${esc(f.path)}"><code>${esc(f.label)}</code><span class="pc-c">${esc(f.count)}</span></button>`).join('')}</div>`);
    return `<div class="pg"><div class="r-lbl pg-h">${esc(g.caption)}</div>${cards.join('')}</div>`;
  }).join('');
}

function whereStop(facts, L, tierOf) {
  const map = L.map;
  const cg = L.where;
  // a repository parsed in part: the counts beyond the diff are lower bounds
  const more = facts.impact?.partial ? '+' : '';
  const wideRows = cg ? cg.boxes.flatMap((b) => b.rows).filter((c) => c.kind !== 'owner') : null;
  const rows = wideRows ?? map.chips;
  // the key: what the desktop graph has and what the list has (the figure rule shows one of them)
  const wide = cg ? tokensOf(wideRows.map((c) => chipTokens(c, callEnds(cg)))) : null;
  const tall = tokensOf(map.chips.map((c) => chipTokens(c, null)));
  const entry = (k, sample, words) => (hasIn(k, wide, tall) ? { k, sample, words, only: onlyOf(k, wide, tall) } : null);
  const mores = [...rows, ...map.chips].filter((c) => c.kind === 'more');
  const fnById = new Map(arr(facts.functions).map((f) => [f.id, f]));
  const small = mores.every((c) => c.ids.every((id) => fnById.get(id)?.fold));
  const firsts = firstPins([...rows, ...map.chips].flatMap(pinsOfChip));
  const firstImpact = rows.find((c) => c.impact)?.impact ?? map.chips.find((c) => c.impact)?.impact ?? 0;
  const key = keyHtml([
    entry('new', KS.chip('new'), 'new'),
    entry('chg', KS.chip('chg'), 'changed'),
    entry('gone', KS.chip('gone'), 'removed'),
    entry('more', KS.more(mores.length ? mores[0].label : ''), small ? 'small changes' : 'the rest of the file'),
    entry('num', KS.num(), 'same number in How'),
    entry('find', KS.pins(firsts), 'finding'),
    entry('out', KS.callers(`${firstImpact}${more}`), 'callers outside this change'),
    entry('notest', KS.notest(), 'no test found'),
    entry('call', KS.call(!!cg && cg.edges.some((e) => e.kind === 'inner')), 'calls'),
  ]);
  // files with no changed function: one line of pills under the graph
  const others = map.groups.flatMap((g) => g.files.filter((f) => f.pill));
  const otherHtml = cg && others.length ? `<div class="others w-only"><span class="lbl">Also changed</span>${others.map((f) => `<button type="button" class="pfile" data-path="${esc(f.path)}"><code>${esc(base(f.path))}</code><span class="pc-c">${esc(f.count)}</span></button>`).join('')}</div>` : '';
  const body = map.boxes.length || map.pills.length
    ? `${cg ? `<div class="scroll map-w">${codeGraphSvg(cg, tierOf, more)}</div>${otherHtml}` : ''}<div class="map-p${cg ? '' : ' all'}">${mapList(map, tierOf, more)}</div>`
    : '<p class="none">No files changed.</p>';
  // the key and the figure switch together, by the column's own width (the page's figure rules); the key stays in view
  // over the figure on a desktop (page.css)
  return `<section class="stop" id="where" aria-labelledby="h-where">
    <div class="sh"><h2 id="h-where">Where</h2><span class="hint">Click a function to see its diff${rows.some((c) => c.impact) ? ' and what calls it' : ''}</span></div>
    <div class="cwrap${cg ? ' fq-w' : ''}">
    ${key}
    <figure class="fig mapfig" aria-label="${esc(`Change map: ${plural(map.groups.length, 'folder group')}, ${plural(arr(facts.files).length, 'file')}, ${plural(map.chips.filter((c) => c.kind !== 'more').length, 'function')} shown`)}">${body}</figure>
    </div>
  </section>`;
}

// ---------- How ----------
const MARKERS = (uid) => `<defs>${[['m', 'mk-ink'], ['b', 'mk-route'], ['s', 'mk-sig']].map(([k, c]) => `<marker id="${uid}-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0.5 L10,5 L0,9.5 z" class="${c}"/></marker>`).join('')}</defs>`;
const stepKind = (b) => (b.fn ? (b.isNew ? 'new' : 'chg') : b.ext ? 'ext' : 'plain');
// What a step and an edge show, as the key's tokens (data-k): the step's kind, its number, findings and, on the desktop
// flow, its "was" on the before track; an edge's kind (a main edge names nothing, so it quiets with the rest).
const stepTokens = (b, wide) => [stepKind(b) === 'plain' ? '' : stepKind(b), b.n ? 'num' : '', b.pins.length ? 'find' : '',
  wide && b.was ? 'was' : ''].filter(Boolean).join(' ');
const edgeToken = (kind) => (kind === 'branch' || kind === 'signal' ? kind : '');
const flowTokens = (v, wide) => [...v.boxes.map((b) => stepTokens(b, wide)), ...v.edges.map((e) => edgeToken(e.kind))];
function stepAttrs(b, uid) {
  return b.fn ? `data-fn="${esc(b.fn)}" data-key="${esc(b.fn)}" data-step="${esc(`${uid}:${b.id}`)}" tabindex="0" role="button"`
    : b.ext ? `data-ext="${esc(`${uid}:${b.id}`)}" tabindex="0" role="button"` : '';
}

// The desktop flow (graph-how.mjs): the before track, the main row, branches below with their conditions as pills,
// signals as dashed arcs over the top.
function flowWideSvg(v, uid) {
  const P = [];
  P.push(`<svg class="flow-w" viewBox="0 0 ${v.w} ${v.h}" width="${v.w}" height="${v.h}" xmlns="http://www.w3.org/2000/svg">`);
  P.push(MARKERS(uid));
  if (v.before) {
    P.push('<g class="before" data-k="was" aria-hidden="true">');
    for (const t of v.before.tracks) {
      if (t.k === 0) P.push(`<text class="trk-l" x="0" y="${t.lineY + 4}">BEFORE</text>`);
      if (t.x1 > t.x0) P.push(`<line class="b-line" x1="${t.x0}" y1="${t.lineY}" x2="${t.x1}" y2="${t.lineY}"/>`);
      for (const it of t.items) {
        P.push(`<circle class="b-dot" cx="${it.x}" cy="${t.lineY}" r="4"/>`);
        it.lines.forEach((line, i) => P.push(`<text class="b-t" x="${it.x}" y="${Math.round((t.textY + i * v.before.line) * 10) / 10}" text-anchor="middle">${esc(line)}</text>`));
      }
      if (t.nowY != null) P.push(`<text class="trk-l now" x="0" y="${t.nowY}">NOW</text>`);
    }
    P.push('</g>');
  }
  for (const e of v.edges) {
    const c = e.kind === 'signal' ? ['f-sig', 's'] : e.kind === 'branch' ? ['f-b', 'b'] : ['f-e', 'm'];
    P.push(`<path class="${c[0]}" data-k="${edgeToken(e.kind)}" d="${polyD(e.points, 8)}" marker-end="url(#${uid}-${c[1]})"/>`);
  }
  for (const e of v.edges) {
    const l = e.label;
    if (!l) continue;
    const cx = Math.round((l.x + l.w / 2) * 10) / 10, cy = Math.round((l.y + l.h / 2) * 10) / 10;
    if (l.pill) P.push(`<g class="pill" data-k="${edgeToken(e.kind)}"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" rx="${l.h / 2}"/><text x="${cx}" y="${cy + 3.8}" text-anchor="middle">${esc(l.text)}</text></g>`);
    else P.push(`<text class="el${e.kind === 'signal' ? ' sig-l' : ''}" data-k="${edgeToken(e.kind)}" x="${cx}" y="${cy + 4}" text-anchor="middle">${esc(l.text)}</text>`);
  }
  for (const b of v.boxes) {
    const aria = [b.label, b.fn ? null : b.ext, b.was ? `was: ${b.was}` : null].filter(Boolean).join(', ') || b.lines.map((l) => l.text).join(' ');
    P.push(`<g class="node ${stepKind(b)}" ${stepAttrs(b, uid)} data-k="${stepTokens(b, true)}" aria-label="${esc(aria)}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14"/>${b.lines.map((l) => `<text class="${l.cls}" x="${l.x}" y="${l.y}" text-anchor="middle">${esc(l.text)}</text>`).join('')}</g>`);
    if (b.badge) P.push(`<g class="nb" data-k="num" aria-hidden="true"><circle cx="${b.badge.cx}" cy="${b.badge.cy}" r="8"/><text x="${b.badge.cx}" y="${b.badge.cy + 3.6}" text-anchor="middle">${b.n}</text></g>`);
    for (const p of b.pins) P.push(pinSvg(p));
  }
  P.push('</svg>');
  return P.join('\n');
}

// Each desktop graph shows while the column holds it at its floor (HOW.minScale, WHERE.minScale of its own width) or
// more: one container rule per figure, on the stop's own width, so the same figure shows the same way in a window, a
// frame or a narrow column. Narrower, the phone view (the tall flow, the list map). Deterministic: the widths are data.
export const needOf = (w, minScale) => Math.ceil(w * minScale);
function figureRules(L) {
  const out = [];
  L.flows.forEach((f, i) => {
    if (f.wide) out.push(`@container (width < ${needOf(f.wide.w, HOW.minScale)}px){ .fq-f${i} .flow-wide{display:none} .fq-f${i} .flow-tall{display:block} }`);
  });
  // How's key entries for what only a desktop flow draws (the before track): gone once no flow that draws it shows
  const before = L.flows.filter((f) => f.wide?.before).map((f) => needOf(f.wide.w, HOW.minScale));
  if (before.length) out.push(`@container (width < ${Math.min(...before)}px){ .fq-h .w-only{display:none !important} }`);
  if (L.where) out.push(`@container (width < ${needOf(L.where.w, WHERE.minScale)}px){ .fq-w .map-w{display:none} .fq-w .map-p{display:grid} .fq-w .w-only{display:none !important} .fq-w .p-only{display:inline-flex !important} }`);
  return out.join('\n');
}

// The phone flow (layout.mjs layoutFlow): top to bottom, branches in a lane to the right.
function flowSvg(v, cls, uid) {
  const P = [];
  P.push(`<svg class="${cls}" viewBox="0 0 ${v.w} ${v.h}" width="${v.w}" height="${v.h}" xmlns="http://www.w3.org/2000/svg">`);
  P.push(MARKERS(uid));
  for (const e of v.edges) {
    const c = e.kind === 'signal' ? ['f-sig', 's'] : e.kind === 'branch' ? ['f-b', 'b'] : ['f-e', 'm'];
    P.push(`<path class="${c[0]}" data-k="${edgeToken(e.kind)}" d="${pts(e.points)}" marker-end="url(#${uid}-${c[1]})"/>`);
  }
  for (const e of v.edges) {
    if (e.place) P.push(`<text class="el${e.kind === 'signal' ? ' sig-l' : e.kind === 'branch' ? ' acc' : ''}" data-k="${edgeToken(e.kind)}" x="${e.place.x}" y="${e.place.y}"${e.place.anchor === 'start' ? '' : ` text-anchor="${e.place.anchor}"`}>${esc(e.place.text)}</text>`);
    if (e.key) P.push(`<g class="fk k-${e.kind}" data-k="${edgeToken(e.kind)}" aria-hidden="true"><circle cx="${e.key.cx}" cy="${e.key.cy}" r="${e.key.r}"/><text x="${e.key.cx}" y="${e.key.cy + 3.6}" text-anchor="middle">${e.key.letter}</text></g>`);
  }
  for (const b of v.boxes) {
    P.push(`<g class="node ${stepKind(b)}" ${stepAttrs(b, uid)} data-k="${stepTokens(b, false)}" aria-label="${esc(b.lines.map((l) => l.text).join(' '))}"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12"/>${b.lines.map((l) => `<text class="${l.cls}" x="${l.x}" y="${l.y}" text-anchor="middle">${esc(l.text)}</text>`).join('')}</g>`);
    if (b.badge) P.push(`<g class="nb" data-k="num" aria-hidden="true"><circle cx="${b.badge.cx}" cy="${b.badge.cy}" r="8"/><text x="${b.badge.cx}" y="${b.badge.cy + 3.6}" text-anchor="middle">${b.n}</text></g>`);
    for (const p of b.pins) P.push(pinSvg(p));
  }
  P.push('</svg>');
  return P.join('\n');
}
const keyList = (v) => (v.keys.length ? `<ol class="fkey">${v.keys.map((k) => `<li><i class="fk-i k-${k.kind}">${k.letter}</i>${esc(k.text)}</li>`).join('')}</ol>` : '');

function howStop(m, L) {
  let body;
  if (!m.story) body = '<p class="none">No flow: the story of this change was not written.</p>';
  else if (!L.flows.length) body = '<p class="none">No flow was drawn for this change.</p>';
  else {
    // the key: what the desktop flows have (a flow too wide for its column shows its phone flow there) and what the
    // phone flows have
    const anyWide = L.flows.some((f) => f.wide);
    const wide = anyWide ? tokensOf(L.flows.flatMap((f) => (f.wide ? flowTokens(f.wide, true) : flowTokens(f.tall, false)))) : null;
    const tall = tokensOf(L.flows.flatMap((f) => flowTokens(f.tall, false)));
    const entry = (k, sample, words) => (hasIn(k, wide, tall) ? { k, sample, words, only: onlyOf(k, wide, tall) } : null);
    const boxes = L.flows.flatMap((f) => [f.wide, f.tall].filter(Boolean)).flatMap((v) => v.boxes);
    const firsts = firstPins(boxes.flatMap((b) => b.pins));
    const key = keyHtml([
      entry('new', KS.node('new'), 'new or changed'),
      entry('chg', KS.node('chg'), 'works as before'),
      entry('ext', KS.node('ext'), 'outside this change'),
      entry('branch', KS.line('f-b'), 'branch'),
      entry('signal', KS.line('f-sig'), 'signal back'),
      entry('was', KS.was(), 'before: what it did'),
      entry('num', KS.badge(), 'same number in Where'),
      entry('find', KS.pins(firsts), 'finding'),
    ]);
    body = `<div class="cwrap${anyWide ? ' fq-h' : ''}">${key}<div class="flows">${L.flows.map((f, i) => `<figure class="fig flowfig ${f.wide ? `fq-f${i}` : 'tall-only'}" aria-label="${esc(`Flow ${i + 1}: ${f.title}`)}">
      ${f.title ? `<figcaption class="ft">${esc(f.title)}</figcaption>` : ''}
      ${f.wide ? `<div class="flow-wide scroll">${flowWideSvg(f.wide, `f${i}w`)}</div>` : ''}
      <div class="flow-tall">${flowSvg(f.tall, 'flow-t', `f${i}t`)}${keyList(f.tall)}</div>
    </figure>`).join('')}</div></div>`;
  }
  const terms = m.story?.glossary?.length
    ? `<details class="terms"><summary>Terms</summary><dl>${m.story.glossary.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join('')}</dl></details>` : '';
  return `<section class="stop" id="how" aria-labelledby="h-how">
    <div class="sh"><h2 id="h-how">How</h2>${L.flows.length ? '<span class="hint">Click a step to see that function\'s diff</span>' : ''}</div>
    ${body}
    ${afterFlows(m, L)}
    ${terms}
  </section>`;
}

// ---------- Decide ----------
// share: the local page's "Invite your team" button, or null on the hosted page (copy link there).
function decideStop(ks, fnById, lost, failed, share) {
  if (!ks.length) {
    const none = failed ? 'The findings call failed, so no finding was checked (see the footer).'
      : lost ? `No finding passed the checks: ${plural(lost, 'finding')} dropped (see the footer).` : 'No findings';
    return `<section class="stop" id="decide" aria-labelledby="h-decide"><h2 id="h-decide">Decide</h2><p class="none">${none}</p>${share ? `<div class="close">${share}</div>` : ''}</section>`;
  }
  const row = (k) => `<li class="fd open t-${TIER_CLS[k.tier]}" id="${k.key}" data-key="${findingKey(k.fns, k.quote)}">
      <span class="fd-pin">${pinA(k)}</span>
      <div class="fd-main">
        <div class="fd-title">${esc(k.title)}</div>
        <div class="fd-sub"><span class="tier">${TIER_NAME[k.tier]}</span>${k.fns.map((id) => `<button type="button" class="fc" data-fn="${esc(id)}" data-key="${esc(id)}">${esc(fnById.has(id) ? fnLabel(fnById.get(id)) : id)}</button>`).join('')}${k.oneLine || k.quote ? `<details class="fd-more"><summary aria-label="Detail"><span aria-hidden="true">···</span></summary>${k.oneLine ? `<p>${esc(k.oneLine)}</p>` : ''}${k.quote ? `<code class="q">${esc(k.quote)}</code>` : ''}</details>` : ''}</div>
      </div>
      <div class="fd-act"><span class="marks"></span><span class="dec"><button type="button" class="cf" aria-pressed="false" aria-label="${esc(`Confirm finding ${k.n}`)}" title="Confirm"><i class="g-ok"></i></button><button type="button" class="ov" aria-pressed="false" aria-label="${esc(`Override finding ${k.n}`)}" title="Override">×</button></span></div>
    </li>`;
  const groups = TIERS.map((t) => {
    const of = ks.filter((k) => k.tier === t);
    return of.length ? `<h3 class="grp">${TIER_NAME[t]} <span>${of.length}</span></h3><ol class="finds">${of.map(row).join('')}</ol>` : '';
  }).join('');
  return `<section class="stop" id="decide" aria-labelledby="h-decide">
    <h2 id="h-decide">Decide</h2>
    <div class="exl"><span class="dk"><span class="dec"><button type="button" tabindex="-1" aria-hidden="true" class="cf"><i class="g-ok"></i></button></span>confirm</span><span class="dk"><span class="dec"><button type="button" tabindex="-1" aria-hidden="true" class="ov">×</button></span>override</span></div>
    ${groups}
    <div class="close"><span class="tally" id="tally"><b>0</b> of ${ks.length} decided</span>${share ?? '<button type="button" class="btn" id="share2">Share with team</button><span class="copied" id="copied2" hidden>Link copied</span>'}</div>
  </section>`;
}

// ---------- Read ----------
const rowNo = (r) => (r[0] === '-' ? r[1] : r[2] ?? r[1]);
export function diffRows(rows) {
  return rows.map((r) => {
    if (r[0] === '~') return '<span class="l gap"><i></i><b>⋮</b></span>';
    const cls = r[0] === '+' ? ' a' : r[0] === '-' ? ' d' : '';
    const mark = r[0] === '+' ? '+' : r[0] === '-' ? '−' : ' ';
    return `<span class="l${cls}"><i>${rowNo(r) ?? ''}</i><b>${mark}</b>${esc(r[3])}</span>`;
  }).join('');
}
// The rows above a function's definition line (its doc comment or decorators), when there are FOLD_HEAD or more:
// they fold into one row that opens on click, and the cap is counted from the definition line.
export function headRows(rows, line) {
  const at = line == null ? -1 : rows.findIndex((r) => r[0] !== '-' && r[0] !== '~' && r[2] === line);
  const head = at > 0 ? rows.slice(0, at) : [];
  return head.filter((r) => r[0] !== '~').length >= FOLD_HEAD ? { head, body: rows.slice(at) } : { head: [], body: rows };
}
// The first `cap` changed or context rows (gaps are free), and how many rows are left.
export function capRows(rows, cap) {
  const shown = [];
  let c = 0;
  for (const r of rows) { if (r[0] !== '~') { if (c === cap) break; c++; } shown.push(r); }
  return { shown, rest: rows.filter((r) => r[0] !== '~').length - c };
}
// One folded head: a row that says what it holds, and the rows themselves, hidden until it is clicked.
export function foldedHead(head) {
  if (!head.length) return '';
  const n = head.filter((r) => r[0] !== '~').length;
  const a = head.filter((r) => r[0] === '+').length, d = head.filter((r) => r[0] === '-').length;
  const ch = a || d ? ` · ${a ? `+${a}` : ''}${a && d ? ' ' : ''}${d ? `−${d}` : ''}` : '';
  return `<span class="l cmt"><i></i><b></b><button type="button" class="cmt-b" data-cmt aria-expanded="false">comment, ${n} lines${ch}</button></span><span class="cmt-rows" hidden>${diffRows(head)}</span>`;
}

// A diff is open at rest only when a Must act finding names its function; any other folds into one row (its name,
// one-liner, counts and finding pins) that opens on click or Enter. The tier is the checked finding's, a fact here.
export const openAtRest = (pins) => pins.some((k) => k.tier === 'must-act');
const CHEV = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 L8 6 L4.5 9.5"/></svg>';

function readStop(L, fnById, m, pinsOf, partial) {
  let shut = 0;
  const items = L.route.read.map((id, i) => {
    const f = fnById.get(id);
    const mean = m.fns.get(id);
    const { head, body } = headRows(arr(f.diff), f.line);
    const { shown, rest } = capRows(body, CARD_ROWS);
    const tests = arr(f.tests).length;
    const pins = pinsOf([id]);
    const open = openAtRest(pins);
    if (!open) shut++;
    const n = i + 1, name = fnLabel(f) || '(top level)';
    const counts = `<span class="add">+${f.added || 0}</span> <span class="del">−${f.removed || 0}</span>`;
    const said = [name, mean?.summary, `+${f.added || 0} −${f.removed || 0}`,
      pins.length ? `${pins.length === 1 ? 'finding' : 'findings'} ${pins.map((k) => k.n).join(', ')}` : '', 'show its diff'];
    const row = `<button type="button" class="h-row" data-unfold aria-expanded="false" aria-controls="r${n}-b" aria-label="${esc(said.filter(Boolean).join(', '))}"${open ? ' hidden' : ''}><span class="hn">${n}</span><code class="h-nm">${esc(name)}</code><span class="h-sum"${mean?.summary ? ` title="${esc(mean.summary)}"` : ''}>${esc(mean?.summary ?? '')}</span><span class="h-cnt">${counts}</span>${pins.length ? `<span class="h-pins">${pins.map((k) => `<span class="pin-h t-${TIER_CLS[k.tier]}">${k.n}</span>`).join('')}</span>` : ''}${CHEV}</button>`;
    return `<article class="hunk${open ? '' : ' shut'}" id="r${n}">
      ${row}
      <div class="h-body" id="r${n}-b"${open ? '' : ' hidden'}>
      <div class="hh"><span class="hn">${n}</span><div class="ht"><button type="button" class="hname" data-fn="${esc(id)}"><code>${esc(name)}</code></button><span class="stchip ${f.status === 'new' ? 'new' : f.status === 'removed' ? 'removed' : 'changed'}">${esc(f.status)}</span><span class="lc">${esc(f.path)}:${f.line ?? f.oldLine ?? ''}</span><span class="lc hk">${counts}</span></div><button type="button" class="h-fold" data-fold aria-expanded="true" aria-controls="r${n}-b" aria-label="${esc(`Fold ${name}`)}" title="Fold">${CHEV}</button></div>
      ${mean?.summary || f.status !== 'removed' || pins.length ? `<div class="hone">${mean?.summary ? `<span>${esc(mean.summary)}</span>` : ''}${f.status !== 'removed' && (tests || !partial) ? `<span class="tchip">${tests ? plural(tests, 'test') : 'no test found'}</span>` : ''}${pins.map((p) => pinA(p)).join('')}</div>` : ''}
      ${mean?.change ? `<div class="c-what r-what"><span class="lbl">What changed</span><p>${esc(mean.change)}</p></div>` : ''}
      <pre class="code diff" data-rows="${esc(id)}">${foldedHead(head)}${diffRows(shown)}</pre>
      ${rest > 0 ? `<button type="button" class="c-more" data-expand="${esc(id)}">+${rest} more line${rest === 1 ? '' : 's'}</button>` : ''}
      </div>
    </article>`;
  });
  const folded = L.route.folded.length
    ? `<div class="folded"><span class="lbl">Folded <span class="dim">· values, comment-only and tiny changes</span></span><div class="c-fns">${L.route.folded.map((id) => `<button type="button" class="c-tab" data-fn="${esc(id)}">${esc(fnLabel(fnById.get(id)) || '(top level)')}</button>`).join('')}</div></div>` : '';
  return `<section class="stop" id="read" aria-labelledby="h-read">
    <div class="sh"><h2 id="h-read">Read</h2>${items.length ? `<span class="hint">${plural(items.length, 'function')}, in route order${shut ? ' · click a row to open its diff' : ''}</span>` : ''}</div>
    ${items.length ? `<div class="hunks">${items.join('')}</div>` : '<p class="none">Nothing on the read route: no function with more than values or comments changed.</p>'}
    ${folded}
  </section>`;
}

function footer(facts, run) {
  const parts = [];
  if (run && typeof run === 'object') {
    if (Number.isFinite(run.calls)) parts.push(plural(run.calls, 'model call'));
    if (Number.isFinite(run.costUsd)) parts.push(`$${run.costUsd.toFixed(2)}`);
    if (run.model) parts.push(`model ${esc(run.model)}`);
    const by = typeof run.by === 'string' ? { [run.by]: null } : run.by && typeof run.by === 'object' ? run.by : null;
    if (by && Object.keys(by).length) parts.push(`answered by ${Object.keys(by).sort().map((k) => (Number.isFinite(by[k]) ? `${esc(k)} (${by[k]})` : esc(k))).join(', ')}`);
    if (Number.isFinite(run.dropped) && run.dropped) parts.push(`${plural(run.dropped, 'text')} or item${run.dropped === 1 ? '' : 's'} dropped by checks`);
  }
  parts.push(`line numbers at ${esc(short(facts.range?.head))}`);
  return `<div class="foot">${parts.join(' · ')}</div>`;
}

const sunMoon = '<svg class="i-moon" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1z"/></svg><svg class="i-sun" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.2M10 16v2.2M1.8 10H4M16 10h2.2M4.2 4.2l1.6 1.6M14.2 14.2l1.6 1.6M4.2 15.8l1.6-1.6M14.2 5.8l1.6-1.6"/></svg>';

// ---------- the local page's buttons: "Save online" and "Invite your team" ----------
// The url of the hosted /share page for one review: the configured server, the review's repository and commit, and
// nothing else (no path, token or code from the laptop). Throws on a server url that is not http(s).
export function shareLink(server, { owner, repo, head }) {
  const u = new URL(String(server));
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('the server url must be http(s)');
  u.username = ''; u.password = ''; u.hash = '';
  u.pathname = `${u.pathname.replace(/\/+$/, '')}/share`;
  u.search = new URLSearchParams({ owner: String(owner ?? ''), repo: String(repo ?? ''), head: String(head ?? '') }).toString();
  return u.href;
}
// A share url the page may carry: http(s), no credentials or fragment, a path ending in /share, and exactly the
// owner, repo and head parameters, each once. Anything else is not linked (null).
export function shareHref(url) {
  if (typeof url !== 'string') return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.hash) return null;
  if (!u.pathname.endsWith('/share')) return null;
  const keys = [...u.searchParams.keys()];
  const want = ['head', 'owner', 'repo'];
  if (keys.length !== want.length || [...keys].sort().join() !== want.join() || want.some((k) => !u.searchParams.get(k))) return null;
  return u.href;
}
/** The parts of a share url the page may carry (shareHref): { action: the server's /share, owner, repo, head }, or null. */
export function shareParts(url) {
  const href = shareHref(url);
  if (!href) return null;
  const u = new URL(href);
  return { action: `${u.origin}${u.pathname}`, owner: u.searchParams.get('owner'), repo: u.searchParams.get('repo'),
    head: u.searchParams.get('head') };
}
// The two buttons: links to the server's /share page (the way without script, and when the page carries no upload);
// with the upload the page's script posts it there instead (page.client.js). "Invite your team" is the one strong
// button on the page; "Save online" is quiet. On phones the long words drop (page.css .lw); the names stay whole.
const LINK_ICON = '<svg class="i-link" viewBox="0 0 20 20" aria-hidden="true"><path d="M8.6 11.4a3.4 3.4 0 0 0 4.8 0l2.6-2.6a3.4 3.4 0 0 0-4.8-4.8l-1 1"/><path d="M11.4 8.6a3.4 3.4 0 0 0-4.8 0L4 11.2a3.4 3.4 0 0 0 4.8 4.8l1-1"/></svg>';
const saveBtn = (href) => `<a class="btn quiet" id="saveonline" href="${esc(href)}" target="_blank" rel="noopener" data-intent="save" aria-label="Save online">${LINK_ICON}<span>Save<span class="lw"> online</span></span></a>`;
const inviteBtn = (href, id, short) => `<a class="btn strong" id="${id}" href="${esc(href)}" target="_blank" rel="noopener" data-intent="invite" aria-label="Invite your team"><span>Invite${short ? '<span class="lw"> your team</span>' : ' your team'}</span></a>`;
// The upload the local page carries (upload.mjs uploadBody): only the review this page shows (its repository and range,
// the share url's owner, repo and head) and only within the server's cap; else none, and the buttons stay links.
function pageUpload(upload, facts, parts) {
  if (!parts || !upload || typeof upload !== 'object') return null;
  const same = upload.repo?.owner === parts.owner && upload.repo?.name === parts.repo && upload.head === parts.head
    && upload.head === facts.range?.head && upload.base === facts.range?.base;
  return same ? uploadText(upload) : null;
}

// ---------- the page ----------

// layout: the positions `await layout(facts, meaning, findings)` computed (layout.mjs); without it the page has the
// phone views at every width (layoutBase), never a half-placed graph.
// mode: 'hosted' (the default: the page the team page frames, with copy link, ending with the bridge to the team
// page's rail) or 'local' (a page made on a laptop, no bridge: when shareUrl is a share url, "Save online" and "Invite
// your team" at the top right and "Invite your team" at the end of Decide, linking to shareUrl; with `upload` (the body
// upload.mjs uploadBody builds for this review) the page carries it in <script type="application/json"
// id="sonah-upload"> and a click posts it to the server's /share).
export function render({ facts, meaning = null, findings = null, layout = null, run = null, mode = 'hosted', shareUrl = null,
  upload = null }) {
  if (layout && typeof layout.then === 'function') throw new TypeError('render needs the computed layout: await layout(...) first');
  const m = normMeaning(meaning, facts);
  const ks = normFindings(findings, facts);
  const L = layout ?? layoutBase(facts, meaning, findings);
  const fnById = new Map(arr(facts.functions).map((f) => [f.id, f]));
  const tier = new Map();
  for (const t of L.route.bar) for (const x of t.items) tier.set(x.path, t.tier);
  const tierOf = (p) => tier.get(p) ?? 'none';
  const pinsOf = (ids) => { const s = new Set(ids); return ks.filter((k) => k.fns.some((id) => s.has(id))); };
  const repo = facts.repo?.name ?? 'repository';
  const range = `${short(facts.range?.base)}..${short(facts.range?.head)}`;
  const lost = Number.isFinite(run?.findingsLost) ? run.findingsLost : 0;
  const failed = run?.findingsCallFailed === true;
  const local = mode === 'local';
  const href = local ? shareHref(shareUrl) : null;
  const parts = href ? shareParts(href) : null;
  const sent = pageUpload(upload, facts, parts);

  // what the client needs: per function its facts, meaning and diff; files; findings; external steps
  const readAt = new Map(L.route.read.map((id, i) => [id, `r${i + 1}`]));
  const FN = {}, DIFF = {}, CALLS = {};
  for (const f of arr(facts.functions)) {
    const mean = m.fns.get(f.id);
    FN[f.id] = { n: fnLabel(f) || '(top level)', p: f.path, l: f.line ?? f.oldLine ?? null, d: f.line ?? null, s: f.status, t: arr(f.tests).length,
      a: f.added || 0, r: f.removed || 0, o: mean?.summary || null, c: mean?.change || null, k: pinsOf([f.id]).map((k) => k.key),
      h: readAt.get(f.id) ?? null,
      // the parser's facts, where a grammar covers the file: existing tests, changed nested functions, impact counts
      ...(f.existingTests?.count ? { e: f.existingTests.count } : {}), ...(arr(f.nested).length ? { in: f.nested } : {}),
      ...(f.impact ? { i: [f.impact.callers || 0, f.impact.mayRun || 0, f.impact.hop2 || 0, f.impact.byName || 0] } : {}) };
    DIFF[f.id] = arr(f.diff);
    CALLS[f.id] = [];
  }
  for (const x of arr(facts.mentions)) {
    if (!x || !x.callShaped || !x.onCodeLine || !CALLS[x.from] || !CALLS[x.to] || CALLS[x.from].includes(x.to)) continue;
    CALLS[x.from].push(x.to);
  }
  const FILES = {};
  for (const f of arr(facts.files)) {
    FILES[f.path] = { t: tierOf(f.path), c: countText(f), role: f.role || '', fns: arr(f.functions).filter((id) => fnById.has(id)) };
  }
  const KF = Object.fromEntries(ks.map((k) => [k.key, { n: k.n, tier: TIER_CLS[k.tier], title: k.title }]));
  // unchanged callers (the parser's impact): what a ghost chip's card says
  const GH = {};
  for (const c of arr(facts.impact?.callers)) {
    if (!c || typeof c.id !== 'string') continue;
    GH[c.id] = { n: c.kind === 'top' ? '(top level)' : c.owner ? `${c.owner}.${c.name}` : c.name, p: c.path, l: c.line || null,
      c: arr(c.calls).filter((id) => fnById.has(id)), m: !!c.may };
  }
  const EXT = {}, STEP = {};
  L.flows.forEach((f, i) => {
    for (const [v, b] of [['w', f.wide], ['t', f.tall]].filter(([, x]) => x).flatMap(([v, x]) => x.boxes.map((b) => [v, b]))) {
      if (b.ext) EXT[`f${i}${v}:${b.id}`] = { n: b.ext, label: b.label, was: b.was };
      else if (b.fn && (b.label || b.was)) STEP[`f${i}${v}:${b.id}`] = { label: b.label || null, was: b.was || null };
    }
  });
  const DATA = { fn: FN, diff: DIFF, calls: CALLS, files: FILES, kf: KF, ext: EXT, step: STEP, gh: GH, range, cap: CARD_ROWS,
    foldHead: FOLD_HEAD, ...(facts.impact?.partial ? { partial: true } : {}) };

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(`${repo} ${range}`)}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${local ? LOCAL_CSS : CSS}
${figureRules(L)}
</style>
<script>${THEME_SCRIPT}</script>
${local ? '' : `<script>${FRAMED_SCRIPT}</script>\n`}</head>
<body>
<div class="wrap">
  <header class="top${href ? ' with-share' : ''}">
    <span class="brand">Sonah</span>
    <span class="crumb"><span class="rv">review</span><span class="sl">/</span><span class="pr">${esc(repo)}</span><code class="sha">${esc(range)}</code></span>
    <div class="tools">
      <button type="button" class="ibtn" id="theme" aria-label="Switch theme" title="Theme">${sunMoon}</button>
      ${local ? (href ? `${saveBtn(href)}${inviteBtn(href, 'invite', true)}` : '') : `<div class="share">
        <button type="button" class="btn" id="share" aria-expanded="false" aria-controls="sharepop">Share</button>
        <div class="pop" id="sharepop" hidden>
          <button type="button" class="btn" id="copylink">Copy link</button>
          <input class="linkfield" id="linkfield" readonly hidden aria-label="Review link">
          <span class="copied" id="copied" hidden>Link copied</span>
        </div>
      </div>`}
    </div>
  </header>

  <div class="layout">
    <nav class="rail" aria-label="Review stops">
      <ol>
        ${STOPS.map((s, i) => `<li><a href="#${s.toLowerCase()}" data-stop="${s.toLowerCase()}"><span class="st">${i + 1}</span><span>${s}</span></a></li>`).join('\n        ')}
      </ol>
    </nav>

    <main>
      ${whatStop(facts, m, ks, lost, failed)}
      ${howStop(m, L)}
      ${whereStop(facts, L, tierOf)}
      ${decideStop(ks, fnById, lost, failed, local ? (href ? inviteBtn(href, 'invite2', false) : '') : null)}
      ${readStop(L, fnById, m, pinsOf, !!facts.impact?.partial)}
      ${footer(facts, run)}
    </main>
  </div>
</div>

<div class="card" id="card" role="dialog" aria-modal="false" aria-labelledby="cardTitle" tabindex="-1" hidden></div>

${sent ? `<script type="application/json" id="sonah-upload" data-action="${esc(parts.action)}">${sent}</script>\n` : ''}<script>
const SONAH = ${json(DATA)};
${CLIENT}
</script>
${local ? '' : `<script>\n${BRIDGE}</script>\n`}</body>
</html>
`;
}
