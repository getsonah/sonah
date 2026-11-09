// graph-where.mjs: the desktop Where code graph, placed by ELK (graph-elk.mjs). Rules, the same for any PR (a graph too
// big to read at the column's width is not drawn: the page's list map shows instead):
//  - folders are nested regions (a folder group inside the one whose path holds it; a shared parent path is a region
//    when two groups share it); each file with changed functions is one box, its functions as rows in line order (at
//    most MAX_ROWS; folded ones, and those past the cap, are one "+N more" row);
//  - a call between changed functions in two files leaves the caller's row on the box's right and enters the callee's
//    row on the left (ELK routes it; no route crosses a box); a call inside one file is a bracket in the box's margin,
//    drawn at rest when the file has at most BRACKETS_AT_REST of them, else only for the selected function;
//  - ELK places the graph left to right and top to bottom, folders nested and flat; the one that shows at the largest
//    scale in the column wins, then the shorter one (top to bottom puts files with no call between them side by side);
//  - impact is quiet at rest: a small mark on a function with unchanged callers. Each such function has an overlay,
//    drawn only when it is selected: its unchanged callers as ghost chips in faint file boxes (at most GHOST_MAX, then
//    "+N more"), beside its row where that covers no file box and no folder caption, else in a free margin of the
//    graph, else the graph grows; dashed lines go into its row. Counts the graph does not draw (two calls away, by name
//    only) are written under them.
import { textWidth, fitText } from './graph-text.mjs';
import { tryLayout, routeOf, r1 } from './graph-elk.mjs';

export const WHERE = Object.freeze({ maxW: 1100, minScale: 0.8, head: 36, rowH: 26, rowGap: 4, padL: 22, padR: 10, bottom: 10, minW: 160,
  maxRows: 12, nameFont: 12.5, countFont: 11.5, chipFont: 12, captionFont: 11.5, captionH: 26, numW: 22, utW: 14,
  pinR: 8, pinGap: 18, markW: 30, markText: 11, labelMax: 200, ghostMax: 6, ghostFont: 12, ghostRowH: 24, ghostGap: 14, ownerH: 16,
  ownerFont: 11, indent: 12, bracketsAtRest: 3, bracketMinX: 4, bracketTop: 16, slideStep: 12 });

const arr = (x) => (Array.isArray(x) ? x : []);
const base = (p) => String(p).split('/').pop();
const countText = (f) => `${f.status === 'A' || f.status === 'added' ? 'new ' : ''}+${f.added || 0}${f.removed ? ` −${f.removed}` : ''}`;
const label = (f) => (f ? (f.owner ? `${f.owner}.${f.name ?? ''}` : f.name ?? '') : '');
const impactOf = (f) => (f?.impact ? (f.impact.callers || 0) + (f.impact.mayRun || 0) : 0);

// Regions: the folder groups as a tree by path, a shared parent path being a region of its own.
function regionTree(groups) {
  const names = [...new Set(groups.map((g) => g.name))];
  const paths = new Set(names.filter((n) => n !== 'root' && n !== 'other'));
  // a parent path shared by two or more groups is a region too
  const prefixes = new Map();
  for (const n of paths) {
    const segs = n.split('/');
    for (let k = 1; k < segs.length; k++) { const p = segs.slice(0, k).join('/'); prefixes.set(p, (prefixes.get(p) ?? 0) + 1); }
  }
  for (const [p, c] of prefixes) if (c >= 2) paths.add(p);
  const parentOf = (n) => {
    const segs = n.split('/');
    for (let k = segs.length - 1; k >= 1; k--) { const p = segs.slice(0, k).join('/'); if (paths.has(p)) return p; }
    return null;
  };
  const regions = new Map();
  for (const n of [...paths].sort()) regions.set(n, { id: `r:${n}`, name: n, parent: parentOf(n), label: '' });
  for (const n of names.filter((x) => x === 'root' || x === 'other')) regions.set(n, { id: `r:${n}`, name: n, parent: null, label: n });
  for (const r of regions.values()) if (!r.label) r.label = r.parent ? r.name.slice(r.parent.length + 1) : r.name;
  return regions;
}

/**
 * The desktop Where code graph. ctx: { numberOf(id), pinsOf([id]) }.
 * Returns null when no file has a changed function; else { w, h, regions, boxes, edges, overlays, others }.
 */
export async function whereWide(facts, ctx) {
  const P = WHERE;
  const fns = arr(facts.functions);
  const fnById = new Map(fns.map((f) => [f.id, f]));
  const files = arr(facts.files).filter((f) => arr(f.functions).some((id) => fnById.has(id)));
  if (!files.length) return null;
  // a repository parsed in part: its counts are lower bounds and no function is said to have no test
  const partial = !!facts.impact?.partial;
  const groupOf = new Map();
  for (const g of arr(facts.groups)) for (const p of arr(g.files)) if (!groupOf.has(p)) groupOf.set(p, String(g.group || '.'));
  const groups = files.map((f) => ({ name: groupOf.get(f.path) ?? 'other' }));
  const regions = regionTree(groups);

  // calls between changed functions: call-shaped mentions on code lines, once per pair
  const calls = [];
  const seen = new Set();
  for (const m of arr(facts.mentions)) {
    if (!m?.callShaped || !m.onCodeLine || m.from === m.to || !fnById.has(m.from) || !fnById.has(m.to)) continue;
    if (fnById.get(m.from).status === 'removed' || fnById.get(m.to).status === 'removed') continue;
    const k = `${m.from}\0${m.to}`;
    if (!seen.has(k)) { seen.add(k); calls.push({ from: m.from, to: m.to }); }
  }
  const linked = new Set(calls.flatMap((c) => [c.from, c.to]));

  // file boxes: rows in line order; folded ones (and those past the cap) as one "+N more" row unless a call needs them
  const fileLabel = new Map();
  const baseCount = new Map();
  for (const f of files) baseCount.set(base(f.path), (baseCount.get(base(f.path)) ?? 0) + 1);
  for (const f of files) fileLabel.set(f.path, baseCount.get(base(f.path)) > 1 ? f.path.split('/').slice(-2).join('/') : base(f.path));
  const boxes = files.map((f, bi) => {
    const all = arr(f.functions).map((id) => fnById.get(id)).filter(Boolean);
    const lineOf = (x) => x.line ?? x.oldLine ?? 0;
    const inOrder = [...all].sort((a, b) => lineOf(a) - lineOf(b) || fns.indexOf(a) - fns.indexOf(b));
    let shown = inOrder.filter((x) => !x.fold || linked.has(x.id));
    let hidden = inOrder.filter((x) => !shown.includes(x));
    if (shown.length + (hidden.length ? 1 : 0) > P.maxRows) {
      const keep = new Set([...shown.filter((x) => linked.has(x.id)), ...shown.filter((x) => !linked.has(x.id))].slice(0, P.maxRows - 1));
      hidden = inOrder.filter((x) => !keep.has(x));
      shown = inOrder.filter((x) => keep.has(x));
    }
    // rows in line order; a class's (an owner's) methods sit under one owner line and name only themselves, unless the
    // class itself is the row just above
    const rows = [];
    let owner = null;
    for (const x of shown) {
      const o = x.owner ?? null;
      const prev = rows[rows.length - 1];
      if (o && o !== owner && !(prev && prev.kind !== 'owner' && prev.fn?.owner == null && prev.fn?.name === o)) {
        rows.push({ id: `${f.path}#owner@${x.id}`, ids: [], kind: 'owner', name: o, n: null, notest: false, pins: [], impact: 0 });
      }
      owner = o;
      const tested = partial || arr(x.tests).length + (x.existingTests?.count ?? 0) > 0;
      rows.push({ id: x.id, ids: [x.id], fn: x, kind: x.status === 'new' ? 'new' : x.status === 'removed' ? 'gone' : 'chg',
        name: (o ? x.name : label(x)) || '(top level)', full: label(x) || '(top level)', indent: o ? P.indent : 0,
        n: ctx.numberOf(x.id), notest: x.status !== 'removed' && !tested, pins: ctx.pinsOf([x.id]), impact: impactOf(x) });
    }
    if (hidden.length) rows.push({ id: `${f.path}#+more`, ids: hidden.map((x) => x.id), kind: 'more', name: `+${hidden.length} more`,
      full: `+${hidden.length} more`, indent: 0, n: null, notest: false, pins: ctx.pinsOf(hidden.map((x) => x.id)), impact: 0 });
    // row widths: badge, name, callers mark (an arrow and the count: as wide as its number needs), no-test mark, pins;
    // heights: an owner line is shorter
    let dy = P.head;
    for (const r of rows) {
      if (r.kind === 'owner') {
        r.label = fitText(r.name, P.labelMax, P.ownerFont, 'mono', true);
        r.w = Math.ceil(textWidth(r.label, P.ownerFont, 'mono', true) + 4);
        r.h = P.ownerH; r.dy = dy; dy += P.ownerH + P.rowGap;
        continue;
      }
      r.markW = r.impact ? Math.max(P.markW, Math.ceil(P.markText + textWidth(`${r.impact}${partial ? '+' : ''}`, 10, 'sans', true) + 8)) : 0;
      const lead = r.n ? P.numW : 0;
      const tail = r.markW + (r.notest ? P.utW : 0) + (r.pins.length ? 6 + Math.min(r.pins.length, 4) * P.pinGap : 0);
      r.label = fitText(r.name, P.labelMax - r.indent, P.chipFont, 'mono');
      r.w = Math.ceil(r.indent + 10 + lead + textWidth(r.label, P.chipFont, 'mono') + 10 + tail);
      r.h = P.rowH; r.dy = dy; dy += P.rowH + P.rowGap;
    }
    const name = fileLabel.get(f.path);
    const count = countText(f);
    const headW = Math.ceil(textWidth(name, P.nameFont, 'mono', true) + 18 + textWidth(count, P.countFont, 'mono') + 24);
    const w = Math.ceil(Math.max(P.minW, headW, ...rows.map((r) => r.w + P.padL + P.padR)));
    const h = dy - P.rowGap + P.bottom;
    return { id: `f${bi}`, path: f.path, region: regions.get(groupOf.get(f.path) ?? 'other'), name, count, w, h, rows };
  });
  const rowAt = new Map();
  for (const b of boxes) b.rows.forEach((r, i) => { for (const id of r.ids) rowAt.set(id, { box: b, row: r, i }); });
  const between = calls.filter((c) => rowAt.get(c.from).box !== rowAt.get(c.to).box);
  const inner = calls.filter((c) => rowAt.get(c.from).box === rowAt.get(c.to).box && rowAt.get(c.from).row !== rowAt.get(c.to).row);

  // ELK: regions as compound nodes, file boxes with one port per row (in on the left, out on the right, fixed)
  const outs = new Set(between.map((c) => rowAt.get(c.from).row.id)), ins = new Set(between.map((c) => rowAt.get(c.to).row.id));
  const fileNode = (b) => ({ id: b.id, width: b.w, height: b.h,
    layoutOptions: { 'elk.portConstraints': 'FIXED_POS', 'elk.padding': '[top=0,left=0,bottom=0,right=0]' },
    ports: b.rows.flatMap((r, i) => [
      ...(ins.has(r.id) ? [{ id: `${b.id}.${i}.i`, x: 0, y: r.dy + r.h / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } }] : []),
      ...(outs.has(r.id) ? [{ id: `${b.id}.${i}.o`, x: b.w, y: r.dy + r.h / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } }] : []),
    ]) });
  const regionNodes = new Map();
  for (const r of regions.values()) regionNodes.set(r.name, { id: r.id, layoutOptions: { 'elk.padding': `[top=${P.captionH + 4},left=8,bottom=8,right=8]`,
    'elk.nodeSize.constraints': 'MINIMUM_SIZE', 'elk.nodeSize.minimum': `(${Math.ceil(textWidth(r.label, P.captionFont, 'mono', true) + 24)}, 40)` }, children: [] });
  for (const b of boxes) regionNodes.get(b.region.name).children.push(fileNode(b));
  // nested: a region inside its parent's; flat: every region at the top (the parents left out)
  const rootsOf = (nested) => {
    const nodes = new Map([...regionNodes].map(([k, n]) => [k, { ...n, children: [...n.children] }]));
    const top = [];
    for (const r of [...regions.values()].sort((a, c) => (a.name < c.name ? -1 : 1))) {
      const node = nodes.get(r.name);
      if (r.parent && nested) nodes.get(r.parent).children.push(node); else top.push(node);
    }
    // regions that hold no box (directly or below) are left out
    const prune = (n) => { n.children = (n.children ?? []).filter((c) => !c.id.startsWith('r:') || prune(c)); return n.children.length > 0; };
    return top.filter(prune);
  };
  const portOf = (id, end) => { const at = rowAt.get(id); return `${at.box.id}.${at.box.rows.indexOf(at.row)}.${end}`; };
  const graphOf = (nested, dir) => ({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': dir, 'elk.hierarchyHandling': 'INCLUDE_CHILDREN', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '20', 'elk.layered.spacing.nodeNodeBetweenLayers': '36', 'elk.spacing.edgeEdge': '7',
      'elk.spacing.edgeNode': '12', 'elk.layered.spacing.edgeNodeBetweenLayers': '12', 'elk.spacing.componentComponent': '28',
      'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.thoroughness': '40',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.json.edgeCoords': 'ROOT', 'elk.json.shapeCoords': 'ROOT', 'elk.padding': '[top=6,left=6,bottom=6,right=6]',
    },
    children: structuredClone(rootsOf(nested)),
    edges: between.map((c, i) => ({ id: `c${i}`, sources: [portOf(c.from, 'o')], targets: [portOf(c.to, 'i')] })),
  });
  // ELK's variants in a fixed order: callers left of callees, then top to bottom; folders nested, then every folder at
  // the top level. Each is placed whole (boxes, calls, brackets, overlays); the one that shows at the largest scale in
  // the column wins, then the clearly shorter one, else the earlier one. ELK can fail on some graphs: that variant is
  // left out, and with none left (or none that reads at minScale) the page shows the list at every width.
  const flatToo = [...regions.values()].some((r) => r.parent);
  const variants = [[true, 'RIGHT'], ...(flatToo ? [[false, 'RIGHT']] : []), [true, 'DOWN'], ...(flatToo ? [[false, 'DOWN']] : [])];
  let best = null;
  for (const [nested, dir] of variants) {
    const g = await tryLayout(graphOf(nested, dir));
    if (!g) continue;
    const scene = placed(g, { regions, boxes, between, inner, facts });
    const scale = Math.min(1, P.maxW / scene.w);
    if (!best || scale >= best.scale + 0.02 || (scale > best.scale - 0.02 && scene.h <= best.scene.h * 0.9)) best = { scale, scene };
  }
  // a graph that would show at less than minScale of its size is no help: the list shows instead
  if (!best || best.scale < P.minScale) return null;
  return best.scene;
}

// One ELK result as the page draws it: regions, file boxes with their rows, calls between files, brackets inside a
// file, and the overlays.
function placed(g, { regions, boxes, between, inner, facts }) {
  const P = WHERE;
  const pos = new Map();
  const walk = (x) => { for (const c of x.children ?? []) { pos.set(c.id, c); walk(c); } };
  walk(g);
  const edgeById = new Map();
  const collect = (x) => { for (const e of x.edges ?? []) edgeById.set(e.id, e); for (const c of x.children ?? []) collect(c); };
  collect(g);

  const outRegions = [...regions.values()].filter((r) => pos.has(r.id)).map((r) => {
    const p = pos.get(r.id);
    const depth = (() => { let d = 0; for (let q = r.parent; q; q = regions.get(q)?.parent) d++; return d; })();
    return { id: r.id, name: r.name, label: r.label, depth, x: r1(p.x), y: r1(p.y), w: r1(p.width), h: r1(p.height) };
  }).sort((a, b) => a.depth - b.depth || (a.name < b.name ? -1 : 1));
  const outBoxes = boxes.map((b) => {
    const p = pos.get(b.id);
    const x = r1(p.x), y = r1(p.y);
    return { path: b.path, name: b.name, count: b.count, x, y, w: b.w, h: b.h,
      rows: b.rows.map((r) => {
        const ry = y + r.dy;
        const rx = x + P.padL + (r.indent ?? 0), rw = b.w - P.padL - P.padR - (r.indent ?? 0);
        if (r.kind === 'owner') return { id: r.id, ids: [], kind: 'owner', label: r.label, x: r1(rx), y: r1(ry), w: r1(rw), h: r.h, pins: [] };
        const pins = r.pins.slice(0, 4).map((k, j, list) => ({ ...k, more: j === 3 && r.pins.length > 4 ? r.pins.length - 3 : 0,
          cx: r1(rx + rw - 12 - (list.length - 1 - j) * P.pinGap), cy: r1(ry + r.h / 2) }));
        const right = rx + rw - (pins.length ? 6 + pins.length * P.pinGap : 0);
        return { id: r.id, ids: r.ids, kind: r.kind, label: r.label, full: r.full, n: r.n, notest: r.notest, impact: r.impact,
          x: r1(rx), y: r1(ry), w: r1(rw), h: r.h, pins,
          mark: r.impact ? { x: r1(right - (r.notest ? P.utW : 0) - r.markW + 2), y: r1(ry + 5), w: r.markW - 6, h: r.h - 10 } : null,
          ut: r.notest ? { x: r1(right - P.utW + 2), y: r1(ry + r.h / 2 - 4) } : null };
      }) };
  });
  const rowBox = new Map();
  for (const b of outBoxes) for (const r of b.rows) for (const id of r.ids) rowBox.set(id, { b, r });
  const edges = between.map((c, i) => ({ from: c.from, to: c.to, kind: 'call', points: routeOf(edgeById.get(`c${i}`)) }));
  // calls inside one file: brackets in the box's left margin, nested spans on separate tracks, never left of the box.
  // A file with more than bracketsAtRest of them draws none at rest: each function gets its own set (`for`), shown only
  // while it is selected, its tracks counted within that set.
  const byBox = new Map();
  for (const c of inner) { const b = rowBox.get(c.from).b; (byBox.get(b) ?? byBox.set(b, []).get(b)).push(c); }
  const span = (c) => { const ya = rowBox.get(c.from).r.y, yz = rowBox.get(c.to).r.y; return [Math.min(ya, yz), Math.max(ya, yz)]; };
  const brackets = (b, list, forId) => {
    const sorted = [...list].sort((p, q) => (span(p)[1] - span(p)[0]) - (span(q)[1] - span(q)[0]) || (p.from + p.to < q.from + q.to ? -1 : 1));
    const tracks = [];
    const at = sorted.map((c) => {
      const [lo, hi] = span(c);
      let t = 0;
      while ((tracks[t] ?? []).some(([a, z]) => lo <= z && a <= hi)) t++;
      (tracks[t] ??= []).push([lo, hi]);
      return { c, t };
    });
    // the tracks share the margin from bracketTop down to bracketMinX, at most 4 apart
    const room = P.bracketTop - P.bracketMinX;
    const step = tracks.length > 1 ? Math.min(4, room / (tracks.length - 1)) : 0;
    for (const { c, t } of at) {
      const a = rowBox.get(c.from).r, z = rowBox.get(c.to).r;
      const x = r1(Math.max(b.x + P.bracketMinX, b.x + P.bracketTop - t * step));
      const down = z.y > a.y;
      const ya = r1(a.y + a.h / 2 + (down ? 4 : -4)), yz = r1(z.y + z.h / 2 + (down ? -4 : 4));
      edges.push({ from: c.from, to: c.to, kind: 'inner', ...(forId ? { for: forId } : {}), points: [[a.x, ya], [x, ya], [x, yz], [r1(z.x - 1), yz]] });
    }
  };
  for (const [b, list] of byBox) {
    if (list.length <= P.bracketsAtRest) { brackets(b, list, null); continue; }
    const ids = [...new Set(list.flatMap((c) => [c.from, c.to]))]
      .sort((p, q) => rowBox.get(p).r.y - rowBox.get(q).r.y || (p < q ? -1 : 1));
    for (const id of ids) brackets(b, list.filter((c) => c.from === id || c.to === id), id);
  }
  const scene = { w: Math.ceil(g.width), h: Math.ceil(g.height), regions: outRegions, boxes: outBoxes, edges };
  scene.overlays = overlaysOf(facts, scene, rowBox);
  return scene;
}

// One overlay per function with unchanged callers: ghost chips in faint file boxes, lines into its row. It goes where it
// covers no file box and no folder caption, in a fixed order of spots: beside its file box level with the row (left,
// where callers come from, then right), above or below the box, beside it higher or lower, then the graph's own left
// and right margins; with no such spot the graph grows to the right to hold it. So an overlay is always inside the
// graph's bounds and never hides a file.
function overlaysOf(facts, scene, rowBox) {
  const P = WHERE;
  const callers = arr(facts.impact?.callers);
  const out = [];
  for (const f of arr(facts.functions)) {
    const at = rowBox.get(f.id);
    if (!at || at.r.ids.length !== 1 || !impactOf(f)) continue;
    const mine = callers.filter((c) => arr(c.calls).includes(f.id));
    if (!mine.length) continue;
    const shown = mine.slice(0, P.ghostMax);
    const more = Math.max(0, impactOf(f) - shown.length);
    const files = [];
    for (const c of shown) {
      let fb = files.find((x) => x.path === c.path);
      if (!fb) { fb = { path: c.path, name: base(c.path), chips: [] }; files.push(fb); }
      const name = c.kind === 'top' ? '(top level)' : c.owner ? `${c.owner}.${c.name}` : c.name;
      fb.chips.push({ id: c.id, label: fitText(name, P.labelMax, P.ghostFont, 'mono'), may: !!c.may, line: c.line, path: c.path });
    }
    const notes = [];
    if (more) notes.push(`+${more} more caller${more === 1 ? '' : 's'}`);
    if (f.impact.hop2) notes.push(`${f.impact.hop2} more two calls away`);
    if (f.impact.byName) notes.push(`${f.impact.byName} by name only`);
    // geometry inside the overlay: caption, file boxes stacked, notes
    const capH = 20, padX = 10, fileHead = 24, gap = 8;
    let w = Math.ceil(textWidth(captionOf(facts), 11, 'sans', true) + 2 * padX);
    let y = capH;
    for (const fb of files) {
      const chipW = Math.max(...fb.chips.map((c) => textWidth(c.label + (c.may ? '  may run' : ''), P.ghostFont, 'mono') + 20));
      fb.w = Math.ceil(Math.max(textWidth(fb.name, 11.5, 'mono', true) + 20, chipW + 16));
      fb.y = y;
      fb.h = fileHead + fb.chips.length * (P.ghostRowH + 4) - 4 + 8;
      y += fb.h + gap;
      w = Math.max(w, fb.w + 2 * padX);
    }
    for (const t of notes) w = Math.max(w, Math.ceil(textWidth(t, 11, 'sans') + 2 * padX));
    const h = Math.ceil(y - gap + 8 + notes.length * 15 + (notes.length ? 6 : 0));
    out.push({ f, at, files, notes, w, h, y, capH, padX, fileHead, gap });
  }
  // what an overlay may not cover: every file box and every folder caption
  const blocked = [...scene.boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    ...scene.regions.map((r) => ({ x: r.x + 8, y: r.y + 2, w: Math.ceil(textWidth(r.label, P.captionFont, 'mono', true) + 10), h: P.captionH - 4 }))];
  for (const o of out) scene.h = Math.max(scene.h, o.h);
  return out.map((o) => placeOverlay(o, scene, spotFor(o, scene, blocked), facts));
}

// The overlay's caption: a repository parsed in part has at least these callers.
const captionOf = (facts) => (facts.impact?.partial ? 'unchanged callers, at least' : 'unchanged callers');

const clear = (rect, blocked, m = 2) => !blocked.some((b) => rect.x < b.x + b.w + m && b.x < rect.x + rect.w + m && rect.y < b.y + b.h + m && b.y < rect.y + rect.h + m);

// The overlay's top-left corner: the first spot in the fixed order that is inside the graph and clear; else the graph
// grows to the right (scene.w, and scene.h when it must) and the overlay sits there, level with its row.
function spotFor({ at, w, h }, scene, blocked) {
  const P = WHERE;
  const b = at.b, r = at.r;
  const ty = r.y + r.h / 2;
  const want = ty - h / 2;
  const inside = (x, y) => x >= 0 && y >= 0 && x + w <= scene.w && y + h <= scene.h;
  const ok = (x, y) => inside(x, y) && clear({ x, y, w, h }, blocked);
  const ys = [];
  for (let k = 0; k * P.slideStep <= scene.h; k++) ys.push(want - k * P.slideStep, want + k * P.slideStep);
  for (const y of [r.y + r.h - h, r.y]) ys.push(y);
  const byNear = [...new Set(ys.map((y) => r1(Math.max(0, Math.min(scene.h - h, y)))))].sort((p, q) => Math.abs(p - want) - Math.abs(q - want) || p - q);
  const level = byNear.filter((y) => y <= ty && ty <= y + h);
  const beside = [b.x - P.ghostGap - w, b.x + b.w + P.ghostGap];
  const tries = [
    ...beside.flatMap((x) => level.map((y) => [x, y])),
    ...[b.x, b.x + b.w - w, b.x + b.w / 2 - w / 2].flatMap((x) => [b.y - P.ghostGap - h, b.y + b.h + P.ghostGap].map((y) => [x, y])),
    ...beside.flatMap((x) => byNear.map((y) => [x, y])),
    ...[0, scene.w - w].flatMap((x) => byNear.map((y) => [x, y])),
  ];
  for (const [x, y] of tries) if (ok(r1(x), r1(y))) return { x: r1(x), y: r1(y) };
  const x = Math.ceil(scene.w + P.ghostGap);
  const y = r1(Math.max(0, want));
  scene.w = Math.ceil(x + w + 6);
  scene.h = Math.max(scene.h, Math.ceil(y + h));
  return { x, y };
}

function placeOverlay({ f, at, files, notes, w, h, y, padX, fileHead, gap }, scene, spot, facts) {
  const P = WHERE;
  const b = at.b, r = at.r;
  const ox = spot.x, oy = spot.y;
  const chips = [];
  for (const fb of files) {
    fb.x = r1(ox + padX); fb.y = r1(oy + fb.y); fb.w = r1(w - 2 * padX);
    fb.chips.forEach((c, i) => { Object.assign(c, { x: r1(fb.x + 8), y: r1(fb.y + fileHead + i * (P.ghostRowH + 4)), w: r1(fb.w - 16), h: P.ghostRowH }); chips.push(c); });
  }
  // lines: from each chip to a trunk just outside the file box on the overlay's side, then into the row's end there
  const side = ox + w / 2 <= b.x + b.w / 2 ? 'left' : 'right';
  const tx = side === 'left' ? r1(b.x - 6) : r1(b.x + b.w + 6);
  const ty = r1(r.y + r.h / 2);
  const endX = side === 'left' ? r1(r.x - 1) : r1(r.x + r.w + 1);
  const lines = chips.map((c) => {
    const cy = r1(c.y + c.h / 2);
    const cx = tx <= c.x ? c.x : tx >= c.x + c.w ? r1(c.x + c.w) : side === 'left' ? c.x : r1(c.x + c.w);
    return { may: c.may, points: [[cx, cy], [tx, cy], [tx, ty], [endX, ty]] };
  });
  return { fn: f.id, side, x: ox, y: oy, w, h, caption: captionOf(facts), files: files.map((fb) => ({ path: fb.path, name: fb.name,
    x: fb.x, y: fb.y, w: fb.w, h: fb.h })), chips, lines, notes: notes.map((t, i) => ({ text: t, x: r1(ox + padX), y: r1(oy + y - gap + 8 + 11 + i * 15) })) };
}
