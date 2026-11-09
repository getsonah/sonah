// graph-how.mjs: the desktop How graph of one flow, placed by ELK (graph-elk.mjs). Rules, the same for any flow:
//  - the main chain runs left to right in one row; a chain wider than the column wraps into rows (ELK's wrapping, the
//    first aspect ratio that fits wins);
//  - a branch leaves its step's bottom edge and hangs below the row, its condition on the edge;
//  - a signal goes back over the top of the row as an arc, out of and into the steps' top edges;
//  - each step's "was" line sits on a "before" track over its own box (one track per row that has one).
// Boxes are sized from their text with the page's own font tables, so nothing is placed by hand.
import { textWidth, wrapText, fitText } from './graph-text.mjs';
import { tryLayout, routeOf, r1 } from './graph-elk.mjs';

export const HOW = Object.freeze({ t1: 13, t2: 11.5, t3: 11, padX: 11, padY: 10, gap: 4, labelMax: 124, fnMax: 136, ownMax: 168,
  boxMin: 100, edgeFont: 11.5, edgeMax: 170, pillPad: 9, pillH: 20, maxW: 1100, minScale: 0.86, laneW: 66, wasFont: 11.5,
  wasLine: 15, pinGap: 20, pinR: 9, layerGap: 30 });

// A function name wrapped at its own joints (camelCase, _, .), at most three lines; a part too long alone is cut. A
// method's owner and name break at the dot first, so the name itself stays whole when it fits (wrapping onto a second
// and third line before it is cut).
export function wrapName(name, max, size, ownMax = max) {
  const dot = String(name).lastIndexOf('.');
  if (dot > 0 && dot < name.length - 1 && textWidth(name, size, 'mono') > max) {
    const owner = name.slice(0, dot + 1), own = name.slice(dot + 1);
    if (textWidth(own, size, 'mono') <= ownMax) return [fitText(owner, max, size, 'mono'), own];
    const rest = wrapName(own, max, size, ownMax);
    if (rest.length <= 2 && textWidth(owner, size, 'mono') <= max) return [owner, ...rest];
  }
  const parts = String(name).split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[_.])(?=[^_.])/);
  const lines = [];
  let cur = '';
  for (const p of parts) {
    if (cur && textWidth(cur + p, size, 'mono') > max) { lines.push(cur); cur = p; } else cur += p;
  }
  if (cur) lines.push(cur);
  if (lines.length <= 3) return lines.map((l) => fitText(l, max, size, 'mono'));
  return [fitText(lines[0], max, size, 'mono'), fitText(lines[1], max, size, 'mono'), fitText(lines.slice(2).join(''), max, size, 'mono')];
}

// A step's text: its label (bold), then its function's name (mono) or its outside thing's name.
function stepLines(step, fnName) {
  const P = HOW;
  const lines = [];
  const title = step.label || (step.fn ? '' : step.ext || '');
  for (const t of title ? wrapText(title, P.labelMax, P.t1, 'sans', true, 3) : []) lines.push({ text: t, cls: 't1', size: P.t1, face: 'sans', bold: true });
  if (step.fn && fnName) for (const t of wrapName(fnName, P.fnMax, P.t2, P.ownMax)) lines.push({ text: t, cls: 't2', size: P.t2, face: 'mono', bold: false });
  else if (step.ext && step.label) lines.push({ text: fitText(step.ext, P.labelMax, P.t3), cls: 't2 mut', size: P.t3, face: 'sans', bold: false });
  return lines;
}
const lineW = (l) => textWidth(l.text, l.size, l.face, l.bold);

/**
 * The desktop How graph of one flow (normalized as layout.mjs normFlow gives it).
 * ctx: { fnName(id), pinsOf([id]) -> [{ key, n, tier }], numberOf(id) }.
 * Returns { w, h, boxes, edges, before, keys: [] }: boxes { id, fn, ext, label, isNew, was, x, y, w, h, lines, pins, n,
 * badge }, edges { from, to, kind, points, label: { text, x, y, w, h, pill } | null }, before { tracks, font, line };
 * or null when ELK could not place it.
 */
export async function howWide(flow, ctx) {
  const P = HOW;
  const steps = flow.steps;
  const nodes = steps.map((s) => {
    const lines = stepLines(s, s.fn ? ctx.fnName(s.fn) : null);
    const w = Math.ceil(Math.max(P.boxMin, ...lines.map(lineW)) + 2 * P.padX);
    const h = Math.ceil(Math.max(44, 2 * P.padY + lines.reduce((t, l) => t + l.size + P.gap, 0) - P.gap + 2));
    return { s, lines, w, h };
  });
  const edges = flow.edges.map((e, i) => {
    const text = e.label ? fitText(e.label, P.edgeMax, P.edgeFont, 'sans', e.kind !== 'main') : null;
    const tw = text ? Math.ceil(textWidth(text, P.edgeFont, 'sans', e.kind !== 'main')) : 0;
    // a branch's condition is a pill on its edge; other labels are plain text beside theirs
    const pill = e.kind === 'branch';
    return { ...e, id: `e${i}`, text, lw: text ? tw + (pill ? 2 * P.pillPad : 8) : 0, lh: text ? (pill ? P.pillH : 16) : 0, pill };
  });
  const ports = new Map(nodes.map((n) => [n.s.id, []]));
  const port = (nid, eid, side) => { const id = `${nid}.${eid}.${side}`; ports.get(nid).push({ id, layoutOptions: { 'elk.port.side': side } }); return id; };
  const elkEdges = edges.map((e) => {
    const [a, b] = e.kind === 'signal' ? ['NORTH', 'NORTH'] : e.kind === 'branch' ? ['SOUTH', 'WEST'] : ['EAST', 'WEST'];
    return { id: e.id, sources: [port(e.from, e.id, a)], targets: [port(e.to, e.id, b)],
      labels: e.text ? [{ id: `${e.id}.l`, text: e.text, width: e.lw, height: e.lh }] : [],
      layoutOptions: e.kind === 'main' ? { 'elk.layered.priority.straightness': '10', 'elk.layered.priority.direction': '10' } : {} };
  });
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': '30', 'elk.layered.spacing.nodeNodeBetweenLayers': String(P.layerGap),
      'elk.layered.spacing.edgeNodeBetweenLayers': '14', 'elk.spacing.edgeEdge': '12', 'elk.spacing.edgeNode': '16',
      'elk.spacing.edgeLabel': '4', 'elk.spacing.labelNode': '6',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.placement': 'CENTER', 'elk.layered.edgeLabels.sideSelection': 'SMART_UP',
      'elk.portConstraints': 'FIXED_SIDE', 'elk.layered.mergeEdges': 'false',
      'elk.padding': '[top=16,left=8,bottom=16,right=8]',
      'elk.json.edgeCoords': 'ROOT', 'elk.json.shapeCoords': 'ROOT',
    },
    children: nodes.map((n) => ({ id: n.s.id, width: n.w, height: n.h, ports: ports.get(n.s.id),
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' } })),
    edges: elkEdges,
  };
  // ELK can fail on some graphs; a fixed ladder of simpler settings follows, and with none left the flow has no desktop
  // graph (the page shows its phone flow at every width). The same flow always takes the same rung.
  const rungs = [{}, { 'elk.layered.considerModelOrder.strategy': 'NONE' }];
  const freeSignals = (gr) => { for (const c of gr.children) for (const p of c.ports) if (p.id.endsWith('.NORTH')) p.layoutOptions = {}; return gr; };
  // a layout counts only when every edge has a route (ELK's wrapping can leave a back edge out)
  const whole = (r) => r && edges.every((e) => routeOf((r.edges ?? []).find((x) => x.id === e.id)).length >= 2);
  let base = null, g = null;
  for (const extra of [...rungs.map((x) => [x, false]), [rungs[1], true]]) {
    const tryGraph = { ...graph, layoutOptions: { ...graph.layoutOptions, ...extra[0] } };
    const r = await tryLayout(extra[1] ? freeSignals(structuredClone(tryGraph)) : structuredClone(tryGraph));
    if (whole(r)) { g = r; base = extra[1] ? freeSignals(structuredClone(tryGraph)) : tryGraph; break; }
  }
  if (!g) return null;
  // one row while it shows at minScale or more of its size; wider, it wraps into rows (the first aspect ratio that fits
  // wins, in a fixed order); a flow that fits neither way has no desktop graph (its phone flow shows instead)
  const lane = steps.some((s) => s.was) ? P.laneW : 0;
  const limit = P.maxW - lane;
  if (g.width + lane > P.maxW / P.minScale) {
    let fit = null;
    search: for (const ar of ['4', '3.5', '3', '2.5', '2', '1.6']) {
      for (const strategy of ['SINGLE_EDGE', 'MULTI_EDGE']) {
        const w = await tryLayout(structuredClone({ ...base, layoutOptions: { ...base.layoutOptions,
          'elk.layered.wrapping.strategy': strategy, 'elk.aspectRatio': ar } }));
        if (whole(w) && w.width <= limit) { fit = w; break search; }
      }
    }
    if (!fit) return null;
    g = fit;
  }
  const pos = new Map(g.children.map((c) => [c.id, c]));
  const route = new Map((g.edges ?? []).map((e) => [e.id, e]));
  const scene = {
    w: g.width, h: g.height,
    boxes: nodes.map((n) => { const p = pos.get(n.s.id); return { n, x: p.x, y: p.y, w: n.w, h: n.h }; }),
    edges: edges.map((e) => {
      const r = route.get(e.id);
      const l = r?.labels?.[0];
      return { e, points: routeOf(r), label: l && e.text ? { text: e.text, x: l.x, y: l.y, w: l.width, h: l.height, pill: e.pill } : null };
    }),
  };
  addBefore(scene);
  return finish(scene, ctx);
}

// The before track: each step's "was" line on a dotted track over its own box. Rows come from the drawn boxes
// (vertical overlap), so a wrapped flow gets one track per row; a band opens above each row that has a "was" and
// everything at or below that row moves down. The first track carries the BEFORE and NOW lane labels.
function addBefore(scene) {
  const P = HOW;
  if (!scene.boxes.some((b) => b.n.s.was)) { scene.before = null; return; }
  const rows = [];
  for (const b of [...scene.boxes].sort((a, c) => a.y - c.y || a.x - c.x)) {
    const r = rows[rows.length - 1];
    if (r && b.y < r.bottom - 4) { r.boxes.push(b); r.bottom = Math.max(r.bottom, b.y + b.h); r.top = Math.min(r.top, b.y); }
    else rows.push({ boxes: [b], top: b.y, bottom: b.y + b.h });
  }
  const shift = (minY, dy) => {
    for (const b of scene.boxes) if (b.y >= minY) b.y += dy;
    for (const e of scene.edges) {
      e.points = e.points.map(([x, y]) => [x, y >= minY ? y + dy : y]);
      if (e.label && e.label.y >= minY) e.label.y += dy;
    }
    scene.h += dy;
  };
  const tracks = [];
  for (let k = rows.length - 1; k >= 0; k--) { // bottom row first, so a shift never moves a row still to be handled
    const items = rows[k].boxes.filter((b) => b.n.s.was).map((b) => ({ id: b.n.s.id, box: b, was: b.n.s.was }))
      .sort((a, c) => a.box.x - c.box.x);
    if (!items.length) continue;
    const cx = (m) => m.box.x + m.box.w / 2;
    items.forEach((it, i) => {
      const gapL = i ? cx(it) - cx(items[i - 1]) : Infinity;
      const gapR = i < items.length - 1 ? cx(items[i + 1]) - cx(it) : Infinity;
      const room = Math.max(70, Math.min(176, Math.min(gapL, gapR) - 14));
      it.lines = wrapText(it.was, room, P.wasFont, 'sans', false, 3);
      it.w = Math.ceil(Math.max(...it.lines.map((t) => textWidth(t, P.wasFont, 'sans'))));
    });
    const maxLines = Math.max(...items.map((it) => it.lines.length));
    const head = k === 0 ? 30 : 10;
    const bandH = head + 22 + (maxLines - 1) * P.wasLine + (k === 0 ? 40 : 18);
    // the first band sits over everything (signals and their labels too)
    const minTop = Math.min(...scene.boxes.map((b) => b.y), ...scene.edges.flatMap((e) => [...e.points.map((p) => p[1]), ...(e.label ? [e.label.y] : [])]));
    shift(k === 0 ? -Infinity : rows[k].top - 1, k === 0 ? Math.max(0, bandH - minTop + 4) : bandH);
    tracks.push({ k, items, bandH, head, maxLines });
  }
  for (const t of tracks) {
    const top = t.k === 0 ? 0 : Math.min(...t.items.map((it) => it.box.y)) - t.bandH;
    t.lineY = top + t.head + 6; t.textY = t.lineY + 22;
    t.nowY = t.k === 0 ? t.textY + (t.maxLines - 1) * P.wasLine + 26 : null;
    for (const it of t.items) it.x = it.box.x + it.box.w / 2;
  }
  // the lane labels need the left edge: everything moves right when a box or a "was" line would sit under them
  const minX = Math.min(...tracks.flatMap((t) => t.items.map((it) => it.x - it.w / 2)), ...scene.boxes.map((b) => b.x),
    ...scene.edges.flatMap((e) => [...e.points.map((p) => p[0]), ...(e.label ? [e.label.x] : [])]));
  const shiftX = minX < P.laneW ? P.laneW - minX : 0;
  if (shiftX) {
    for (const b of scene.boxes) b.x += shiftX;
    for (const e of scene.edges) { e.points = e.points.map(([x, y]) => [x + shiftX, y]); if (e.label) e.label.x += shiftX; }
    for (const t of tracks) for (const it of t.items) it.x += shiftX;
    scene.w += shiftX;
  }
  scene.w = Math.max(scene.w, ...tracks.flatMap((t) => t.items.map((it) => it.x + it.w / 2 + 8)));
  scene.before = { tracks: tracks.sort((a, c) => a.k - c.k).map((t) => ({ k: t.k, lineY: r1(t.lineY), textY: r1(t.textY),
    nowY: t.nowY == null ? null : r1(t.nowY), x0: r1(t.items[0].x), x1: r1(t.items[t.items.length - 1].x),
    items: t.items.map((it) => ({ id: it.id, x: r1(it.x), lines: it.lines })) })), font: P.wasFont, line: P.wasLine };
}

// The scene as the page draws it: box text placed, pins and the flow-order badge on each box's top edge.
function finish(scene, ctx) {
  const P = HOW;
  const boxes = scene.boxes.map(({ n, x, y, w, h }) => {
    const s = n.s;
    const total = n.lines.reduce((t, l) => t + l.size + P.gap, 0) - P.gap;
    let ly = y + (h - total) / 2 - 1;
    const lines = n.lines.map((l) => { ly += l.size; const out = { text: l.text, cls: l.cls, x: r1(x + w / 2), y: r1(ly) }; ly += P.gap; return out; });
    const own = s.fn ? ctx.pinsOf([s.fn]) : [];
    const num = s.fn ? ctx.numberOf(s.fn) : null;
    // pins on the top edge, right-aligned, lowest number first, clear of the badge; what does not fit is one "+N" pin
    const room = Math.max(1, Math.floor((w - 2 * 12 - (num ? 2 * P.pinR + 8 : 0)) / P.pinGap) + 1);
    const shown = own.length > room ? [...own.slice(0, room - 1), { ...own[room - 1], more: own.length - room + 1 }] : own;
    const pins = shown.map((p, i) => ({ ...p, cx: r1(x + w - 12 - (shown.length - 1 - i) * P.pinGap), cy: r1(y) }));
    return { id: s.id, fn: s.fn, ext: s.ext, label: s.label, isNew: s.isNew, was: s.was, x: r1(x), y: r1(y), w: r1(w), h: r1(h),
      lines, pins, n: num, badge: num ? { cx: r1(x + 14), cy: r1(y) } : null };
  });
  const edges = scene.edges.map(({ e, points, label }) => ({ from: e.from, to: e.to, kind: e.kind, points,
    label: label ? { text: label.text, x: r1(label.x), y: r1(label.y), w: r1(label.w), h: r1(label.h), pill: label.pill } : null }));
  return { w: Math.ceil(scene.w), h: Math.ceil(scene.h), boxes, edges, before: scene.before, keys: [] };
}
