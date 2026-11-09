// Layer 3, part 1: every position on the page, computed from data by fixed rules.
// No clock, random, network or model. Nothing here knows a repository, file, function or commit: every constant is a
// frozen literal that holds for any PR. Text is measured with fixed font tables, so boxes are sized from their text.

// ---------- text measure (graph-text.mjs) and the desktop graphs (ELK) ----------
import { textWidth, fitText, wrapText } from './graph-text.mjs';
import { howWide } from './graph-how.mjs';
import { whereWide } from './graph-where.mjs';
export { textWidth, fitText, wrapText };

// ---------- inputs ----------
const str = (x) => (typeof x === 'string' ? x.trim() : '');
/** A function's name as the page shows it: `Owner.name` for a definition inside another (a method in its class). */
export const fnLabel = (f) => (f ? (f.owner ? `${f.owner}.${f.name ?? ''}` : f.name ?? '') : '');
const arr = (x) => (Array.isArray(x) ? x : []);
export const TIERS = Object.freeze(['must-act', 'must-know', 'good-to-know']);
const EDGE_KINDS = new Set(['main', 'branch', 'signal']);

// The meaning as the page reads it: one-liners by function id, and the story (or null when it was not written).
export function normMeaning(meaning, facts) {
  const ids = new Set(arr(facts?.functions).map((f) => f.id));
  const fns = new Map();
  const src = meaning?.functions ?? meaning?.value?.functions;
  const put = (id, e) => {
    if (!ids.has(id) || !e) return;
    const summary = str(e.summary), change = str(e.change);
    if (summary || change) fns.set(id, { summary, change });
  };
  if (Array.isArray(src)) for (const e of src) put(e?.id, e);
  else if (src && typeof src === 'object') for (const id of Object.keys(src).sort()) put(id, src[id]);
  const s = meaning?.story ?? (meaning && (meaning.oneLine || meaning.flows) ? meaning : null);
  let story = null;
  if (s && typeof s === 'object') {
    story = {
      oneLine: str(s.oneLine),
      ask: str(s.ask),
      beforeNow: arr(s.beforeNow).map((p) => (Array.isArray(p) ? { before: str(p[0]), now: str(p[1]) }
        : { before: str(p?.before), now: str(p?.now) })).filter((p) => p.before || p.now),
      flows: arr(s.flows).filter((f) => f && arr(f.steps).length).map((f) => normFlow(f, ids)),
      glossary: arr(s.glossary).filter((g) => g && str(g.term)).map((g) => ({ term: str(g.term), def: str(g.def) })),
    };
  }
  return { fns, story };
}

function normFlow(flow, ids) {
  const steps = [];
  const seen = new Set();
  for (const s of arr(flow.steps)) {
    if (!s || s.id == null || seen.has(String(s.id))) continue;
    seen.add(String(s.id));
    const fn = ids.has(s.fn) ? s.fn : null;
    steps.push({ id: String(s.id), label: str(s.label), fn, ext: fn ? null : str(s.ext) || null, was: str(s.was) || null,
      isNew: !!s.isNew });
  }
  const edges = arr(flow.edges).filter((e) => e && seen.has(String(e.from)) && seen.has(String(e.to))
    && String(e.from) !== String(e.to)).map((e) => ({ from: String(e.from), to: String(e.to),
    kind: EDGE_KINDS.has(e.kind) ? e.kind : 'main', label: str(e.label) || null }));
  return { title: str(flow.title), steps, edges };
}

// Findings in page order (tier, then as given), numbered from 1; each keeps only functions the facts have.
export function normFindings(findings, facts) {
  const ids = new Set(arr(facts?.functions).map((f) => f.id));
  const list = Array.isArray(findings) ? findings : arr(findings?.findings ?? findings?.value);
  const rank = (t) => { const i = TIERS.indexOf(t); return i < 0 ? TIERS.length - 1 : i; };
  // A finding whose title was dropped by the checks is titled by its oneLine (then shown once, not twice).
  return list.filter((k) => k && (str(k.title) || str(k.oneLine)))
    .map((k, i) => ({ k, i }))
    .sort((a, b) => rank(a.k.tier) - rank(b.k.tier) || a.i - b.i)
    .map(({ k }, j) => ({ n: j + 1, key: `k${j + 1}`, tier: TIERS.includes(k.tier) ? k.tier : 'good-to-know',
      title: str(k.title) || str(k.oneLine), oneLine: str(k.title) ? str(k.oneLine) : '', quote: str(k.quote),
      fns: arr(k.fns).filter((id) => ids.has(id)) }));
}

// ---------- the map ----------
const MAP = Object.freeze({
  W: 1000, GROUP_GAP_X: 40, GROUP_GAP_Y: 36, CAPTION_H: 26, BOX_GAP: 18, BOX_PAD: 14, HEAD_H: 44, NAME_Y: 26,
  BOX_MIN: 220, BOX_MAX: 470, BOX_BOTTOM: 16, CHIP_H: 28, CHIP_GAP_X: 10, CHIP_GAP_Y: 10, CHIP_PAD: 10, CHIP_FONT: 12,
  NUM_W: 22, UT_W: 16, PIN_R: 9, PIN_GAP: 21, PIN_OFF: 15, PIN_MAX: 3, MAX_CHIPS: 12, NAME_FONT: 12.5,
  COUNT_FONT: 11.5, CAPTION_FONT: 11.5, PILL_H: 26, PILL_PAD: 10, PILL_GAP: 8, PILL_FONT: 11.5, PILLS_MIN_W: 320,
});
const base = (p) => String(p).split('/').pop();
const changed = (f) => (f.added || 0) + (f.removed || 0);
export const countText = (f) => `${f.status === 'A' || f.status === 'added' ? 'new ' : ''}+${f.added || 0}${f.removed ? ` −${f.removed}` : ''}`;
const pinRoom = (n) => (n ? MAP.PIN_OFF + (n - 1) * MAP.PIN_GAP + MAP.PIN_R + 3 : 0);

function chipOf(c, numberOf) {
  const extra = (c.n ? MAP.NUM_W : 0) + (c.notest ? MAP.UT_W : 0) + 2 * MAP.CHIP_PAD;
  const shown = Math.min(c.pins.length, MAP.PIN_MAX + (c.pins.length > MAP.PIN_MAX ? 1 : 0));
  const room = pinRoom(shown);
  const labelMax = MAP.BOX_MAX - 2 * MAP.BOX_PAD - extra - room;
  const label = fitText(c.label, labelMax, MAP.CHIP_FONT, 'mono');
  const w = Math.ceil(textWidth(label, MAP.CHIP_FONT, 'mono') + extra);
  return { ...c, label, w, h: MAP.CHIP_H, foot: w + room, shownPins: shown };
}

function layoutMap(facts, numberOf, pinsOf) {
  const fnById = new Map(arr(facts.functions).map((f) => [f.id, f]));
  const files = arr(facts.files);
  const fileByPath = new Map(files.map((f) => [f.path, f]));
  const fnIndex = new Map(arr(facts.functions).map((f, i) => [f.id, i]));
  // groups as the facts give them; files no group lists go in one last group
  const groups = arr(facts.groups).map((g) => ({ name: str(g.group) || '.', paths: arr(g.files).filter((p) => fileByPath.has(p)) }));
  const listed = new Set(groups.flatMap((g) => g.paths));
  const rest = files.map((f) => f.path).filter((p) => !listed.has(p));
  if (rest.length) groups.push({ name: 'other', paths: rest });
  // groups by their best route tier (a group with a file to read first, then skim, then skip), then by changed lines
  const tierRank = new Map();
  ['read', 'skim', 'skip'].forEach((t, i) => { for (const x of arr(facts.route?.[t])) if (x?.path) tierRank.set(x.path, i); });
  const best = (g) => Math.min(3, ...g.paths.map((p) => tierRank.get(p) ?? 3));
  const groupLines = (g) => g.paths.reduce((s, p) => s + changed(fileByPath.get(p)), 0);
  const ordered = groups.filter((g) => g.paths.length)
    .map((g, i) => ({ g, i })).sort((a, b) => best(a.g) - best(b.g) || groupLines(b.g) - groupLines(a.g) || a.i - b.i)
    .map(({ g }) => g);

  const chips = [];
  const outGroups = [];
  const boxes = [];
  const pills = [];
  const blocks = [];
  for (const g of ordered) {
    const fileObjs = g.paths.map((p) => fileByPath.get(p));
    const withFns = fileObjs.filter((f) => arr(f.functions).some((id) => fnById.has(id)))
      .map((f, i) => ({ f, i })).sort((a, b) => changed(b.f) - changed(a.f) || a.i - b.i).map(({ f }) => f);
    const without = fileObjs.filter((f) => !withFns.includes(f));
    // a file's label is its base name, or its path in the group when two files share a base name
    const baseCount = new Map();
    for (const f of fileObjs) baseCount.set(base(f.path), (baseCount.get(base(f.path)) ?? 0) + 1);
    const prefix = g.name === 'root' || g.name === '.' ? '' : `${g.name}/`;
    const labelOf = (p) => (baseCount.get(base(p)) > 1 ? (p.startsWith(prefix) ? p.slice(prefix.length) : p) : base(p));

    const gBoxes = withFns.map((f) => {
      const fns = arr(f.functions).map((id) => fnById.get(id)).filter(Boolean);
      const lineOf = (x) => x.line ?? x.oldLine ?? 0;
      const byNum = (a, b) => (numberOf(a.id) ?? Infinity) - (numberOf(b.id) ?? Infinity) || lineOf(a) - lineOf(b)
        || fnIndex.get(a.id) - fnIndex.get(b.id);
      const open = fns.filter((x) => !x.fold).sort(byNum);
      const folded = fns.filter((x) => x.fold).sort((a, b) => lineOf(a) - lineOf(b) || fnIndex.get(a.id) - fnIndex.get(b.id));
      let shown = open, hidden = folded;
      if (open.length + (folded.length ? 1 : 0) > MAP.MAX_CHIPS) {
        shown = open.slice(0, MAP.MAX_CHIPS - 1);
        hidden = [...open.slice(MAP.MAX_CHIPS - 1), ...folded];
      }
      // tested: a test this PR changed reaches it, or (the parser's) an existing test calls it
      const items = shown.map((x) => chipOf({ ids: [x.id], kind: x.status === 'new' ? 'new' : x.status === 'removed' ? 'gone' : 'chg',
        label: fnLabel(x) || '(top level)', n: numberOf(x.id),
        // a repository parsed in part (facts.impact.partial) never says a function has no test: it may have one unread
        notest: !facts.impact?.partial && x.status !== 'removed' && !arr(x.tests).length && !(x.existingTests?.count > 0),
        impact: (x.impact?.callers || 0) + (x.impact?.mayRun || 0), pins: pinsOf([x.id]) }, numberOf));
      if (hidden.length) {
        items.push(chipOf({ ids: hidden.map((x) => x.id), kind: 'more', label: `+${hidden.length} more`, n: null, notest: false,
          pins: pinsOf(hidden.map((x) => x.id)) }, numberOf));
      }
      const label0 = labelOf(f.path);
      const count = countText(f);
      const headMax = MAP.BOX_MAX - 2 * MAP.BOX_PAD - 20 - textWidth(count, MAP.COUNT_FONT, 'mono');
      const label = fitText(label0, headMax, MAP.NAME_FONT, 'mono', true);
      const headW = textWidth(label, MAP.NAME_FONT, 'mono', true) + 20 + textWidth(count, MAP.COUNT_FONT, 'mono');
      const innerMax = MAP.BOX_MAX - 2 * MAP.BOX_PAD;
      const natural = items.reduce((s, c) => s + c.foot, 0) + Math.max(0, items.length - 1) * MAP.CHIP_GAP_X;
      const inner = Math.min(innerMax, Math.max(natural, headW));
      // chips wrap into rows inside the box
      const rows = [];
      let cur = [], used = 0;
      for (const c of items) {
        const add = (cur.length ? MAP.CHIP_GAP_X : 0) + c.foot;
        if (cur.length && used + add > inner) { rows.push(cur); cur = []; used = 0; }
        used += (cur.length ? MAP.CHIP_GAP_X : 0) + c.foot;
        cur.push(c);
      }
      if (cur.length) rows.push(cur);
      const rowW = (r) => r.reduce((s, c) => s + c.foot, 0) + (r.length - 1) * MAP.CHIP_GAP_X;
      const w = Math.ceil(Math.max(MAP.BOX_MIN, Math.max(headW, ...rows.map(rowW)) + 2 * MAP.BOX_PAD));
      const h = MAP.HEAD_H + rows.length * MAP.CHIP_H + Math.max(0, rows.length - 1) * MAP.CHIP_GAP_Y + MAP.BOX_BOTTOM;
      return { path: f.path, label, count, w, h, rows };
    });

    // boxes shelf-packed in the group, each row stretched to one height
    const shelf = [];
    {
      let row = [], x = 0;
      for (const b of gBoxes) {
        if (row.length && x + MAP.BOX_GAP + b.w > MAP.W) { shelf.push(row); row = []; x = 0; }
        x += (row.length ? MAP.BOX_GAP : 0) + b.w;
        row.push(b);
      }
      if (row.length) shelf.push(row);
    }
    const shelfW = Math.max(0, ...shelf.map((r) => r.reduce((s, b) => s + b.w, 0) + (r.length - 1) * MAP.BOX_GAP));
    const caption = fitText(g.name, MAP.W, MAP.CAPTION_FONT, 'mono', true);
    const captionW = textWidth(caption, MAP.CAPTION_FONT, 'mono', true);
    // files with no functions: small pills under the boxes
    const pillItems = without.map((f) => {
      const count = countText(f);
      const label = fitText(labelOf(f.path), MAP.W - 2 * MAP.PILL_PAD - 10 - textWidth(count, 11, 'mono'), MAP.PILL_FONT, 'mono');
      return { path: f.path, label, count, role: f.role || '',
        w: Math.ceil(2 * MAP.PILL_PAD + textWidth(label, MAP.PILL_FONT, 'mono') + 10 + textWidth(count, 11, 'mono')), h: MAP.PILL_H };
    });
    // pills wrap under the boxes; a group of pills only uses the map's whole width
    const pillWrap = shelf.length ? Math.min(MAP.W, Math.max(shelfW, MAP.PILLS_MIN_W, ...pillItems.map((p) => p.w))) : MAP.W;
    const pillRows = [];
    {
      let row = [], x = 0;
      for (const p of pillItems) {
        if (row.length && x + MAP.PILL_GAP + p.w > pillWrap) { pillRows.push(row); row = []; x = 0; }
        x += (row.length ? MAP.PILL_GAP : 0) + p.w;
        row.push(p);
      }
      if (row.length) pillRows.push(row);
    }
    const pillsW = Math.max(0, ...pillRows.map((r) => r.reduce((s, p) => s + p.w, 0) + (r.length - 1) * MAP.PILL_GAP));
    const shelfH = shelf.reduce((s, r) => s + Math.max(...r.map((b) => b.h)), 0) + Math.max(0, shelf.length - 1) * MAP.BOX_GAP;
    const pillsH = pillRows.length * MAP.PILL_H + Math.max(0, pillRows.length - 1) * MAP.PILL_GAP;
    const blockW = Math.ceil(Math.max(shelfW, pillsW, captionW));
    const blockH = MAP.CAPTION_H + shelfH + (shelf.length && pillRows.length ? 14 : 0) + pillsH;
    blocks.push({ g, caption, shelf, pillRows, w: blockW, h: blockH, shelfH });
  }

  // group blocks shelf-packed in the map, top-aligned
  let x = 0, y = 0, rowH = 0;
  for (const bl of blocks) {
    if (x > 0 && x + MAP.GROUP_GAP_X + bl.w > MAP.W) { x = 0; y += rowH + MAP.GROUP_GAP_Y; rowH = 0; }
    if (x > 0) x += MAP.GROUP_GAP_X;
    bl.x = x; bl.y = y;
    x += bl.w; rowH = Math.max(rowH, bl.h);
  }
  const H = Math.ceil(y + rowH + 8);
  for (const bl of blocks) {
    const files = [];
    outGroups.push({ name: bl.g.name, caption: bl.caption, x: bl.x, y: bl.y, w: bl.w, h: bl.h, files });
    let by = bl.y + MAP.CAPTION_H;
    for (const row of bl.shelf) {
      const rh = Math.max(...row.map((b) => b.h));
      let bx = bl.x;
      for (const b of row) {
        const box = { path: b.path, label: b.label, count: b.count, x: bx, y: by, w: b.w, h: rh, chips: [] };
        let cy = by + MAP.HEAD_H;
        for (const r of b.rows) {
          let cx = bx + MAP.BOX_PAD;
          for (const c of r) {
            const pins = c.pins.slice(0, c.shownPins).map((p, i) => ({ ...p,
              more: i === MAP.PIN_MAX ? c.pins.length - MAP.PIN_MAX : 0,
              cx: cx + c.w + MAP.PIN_OFF + i * MAP.PIN_GAP, cy: cy + MAP.CHIP_H / 2 }));
            const chip = { ids: c.ids, kind: c.kind, label: c.label, n: c.n, notest: c.notest, impact: c.impact || 0, path: b.path, allPins: c.pins,
              x: cx, y: cy, w: c.w, h: c.h, pins };
            box.chips.push(chip); chips.push(chip);
            cx += c.foot + MAP.CHIP_GAP_X;
          }
          cy += MAP.CHIP_H + MAP.CHIP_GAP_Y;
        }
        boxes.push(box); files.push(box);
        bx += b.w + MAP.BOX_GAP;
      }
      by += rh + MAP.BOX_GAP;
    }
    if (bl.shelf.length) by += 14 - MAP.BOX_GAP;
    for (const row of bl.pillRows) {
      let px = bl.x;
      for (const p of row) {
        const pill = { path: p.path, label: p.label, count: p.count, role: p.role, x: px, y: by, w: p.w, h: p.h };
        pills.push(pill); files.push({ ...pill, pill: true, chips: [] });
        px += p.w + MAP.PILL_GAP;
      }
      by += MAP.PILL_H + MAP.PILL_GAP;
    }
  }
  return { w: MAP.W, h: H, groups: outGroups, boxes, chips, pills, nameY: MAP.NAME_Y, pad: MAP.BOX_PAD, pinR: MAP.PIN_R };
}

// ---------- flows (the phone's tall flow; the desktop one is graph-how.mjs) ----------
// One flow, top to bottom: the main chain in lane 0, every other step in lane 1 to its right, beside its source.
// Edges run only through corridors (between lanes) and bands (between rows), where no box is, so no edge crosses a box.
// Corridor c0 is left of lane 0 (signals back), c1 between the lanes, c2 right of lane 1.
const FLOW_TALL = Object.freeze({ boxMin: 104, boxMax: 140, padX: 9, padY: 9, t1: 12, t2: 10.5, t3: 10.5, gapLine: 3,
  margin: 12, band: 34, bandPad: 11, trackB: 7, pinClear: 13, corridor: 26, padC: 11, track: 8, labelFont: 11,
  labelMax: 150, sigReserve: false, top: 20, bottom: 20 });
const LABEL_H = 14; // a one-line edge label's box
const KEY_R = 8; // a key marker's radius
const PORT_GAP = 10;

// Lane and row of each step, from the edges only.
export function flowGrid(flow) {
  const order = flow.steps.map((s) => s.id);
  const edges = flow.edges;
  const mainEdges = edges.filter((e) => e.kind === 'main');
  const lane = new Map(), row = new Map();
  const main = [];
  if (mainEdges.length) {
    const succ = new Map(), hasPred = new Set(), inMain = new Set();
    for (const e of mainEdges) { if (!succ.has(e.from)) succ.set(e.from, e.to); hasPred.add(e.to); inMain.add(e.from); inMain.add(e.to); }
    const starts = [...order.filter((id) => inMain.has(id) && !hasPred.has(id)), ...order.filter((id) => inMain.has(id))];
    for (const s of starts) {
      for (let at = s; at != null && !lane.has(at); at = succ.get(at)) { lane.set(at, 0); row.set(at, main.length); main.push(at); }
    }
  } else {
    const targets = new Set(edges.filter((e) => e.kind === 'branch').map((e) => e.to));
    for (const id of order) if (!targets.has(id)) { lane.set(id, 0); row.set(id, main.length); main.push(id); }
    if (!main.length && order.length) { lane.set(order[0], 0); row.set(order[0], 0); main.push(order[0]); }
  }
  const taken = new Set();
  const place = (id, desired) => { let r = Math.max(0, desired); while (taken.has(r)) r++; taken.add(r); lane.set(id, 1); row.set(id, r); };
  let pending = order.filter((id) => !lane.has(id));
  while (pending.length) {
    let placed = false;
    for (const id of pending) {
      // a step's source is the first placed step with a main or branch edge to it
      const src = edges.find((e) => e.to === id && lane.has(e.from) && e.kind !== 'signal');
      if (!src) continue;
      place(id, lane.get(src.from) === 0 ? row.get(src.from) : row.get(src.from) + 1);
      placed = true;
    }
    pending = pending.filter((id) => !lane.has(id));
    if (!placed && pending.length) {
      const id = pending[0];
      const before = order.slice(0, order.indexOf(id)).filter((x) => lane.has(x));
      place(id, before.length ? row.get(before[before.length - 1]) : 0);
      pending = pending.slice(1);
    }
  }
  return { lane, row, main };
}

function boxLines(step, cond, P, inner, fnName) {
  const lines = [];
  if (cond) for (const t of wrapText(cond, inner, P.t3, 'sans', true, 2)) lines.push({ text: t, cls: 'cnd', size: P.t3 });
  for (const t of wrapText(step.label || fnName || step.ext || '', inner, P.t1, 'sans', true, 4)) lines.push({ text: t, cls: 't1', size: P.t1 });
  // the function's name, `Owner.name` for a method, may take three lines in a narrow box
  if (step.fn && fnName) for (const t of wrapText(fnName, inner, P.t2, 'mono', false, 3)) lines.push({ text: t, cls: 't2', size: P.t2 });
  else if (step.ext) for (const t of wrapText(step.ext, inner, P.t3, 'sans', false, 2)) lines.push({ text: t, cls: 't2 mut', size: P.t3 });
  if (step.was) for (const t of wrapText(`was: ${step.was}`, inner, P.t3, 'sans', false, 4)) lines.push({ text: t, cls: 'was', size: P.t3 });
  return lines;
}
const lineWidth = (l) => textWidth(l.text, l.size, l.cls === 't2' ? 'mono' : 'sans', l.cls === 't1' || l.cls === 'cnd');

function layoutFlow(flow, P, ctx) {
  const { lane, row } = flowGrid(flow);
  const steps = flow.steps;
  const edges = flow.edges.map((e, i) => ({ ...e, i }));
  const sById = new Map(steps.map((s) => [s.id, s]));
  const hasLane1 = steps.some((s) => lane.get(s.id) === 1);
  const nRows = Math.max(0, ...steps.map((s) => row.get(s.id) + 1));
  const occupied = [new Set(), new Set()];
  for (const s of steps) occupied[lane.get(s.id)].add(row.get(s.id));

  // a branch step shows the label of the branch edge that leads to it inside its own box
  const condOf = new Map();
  for (const e of edges) {
    if (e.kind === 'branch' && e.label && lane.get(e.to) === 1 && !condOf.has(e.to)) { condOf.set(e.to, e.label); e.inBox = true; }
  }

  // box text and sizes; one width per lane
  const inner = P.boxMax - 2 * P.padX;
  const content = new Map();
  for (const s of steps) {
    const lines = boxLines(s, condOf.get(s.id), P, inner, s.fn ? ctx.fnName(s.fn) : null);
    content.set(s.id, lines);
  }
  const natural = (id) => Math.max(0, ...content.get(id).map(lineWidth)) + 2 * P.padX;
  const laneW = [0, 1].map((L) => {
    const ids = steps.filter((s) => lane.get(s.id) === L).map((s) => s.id);
    return ids.length ? Math.ceil(Math.min(P.boxMax, Math.max(P.boxMin, ...ids.map(natural)))) : 0;
  });
  const boxH = (id) => {
    const ls = content.get(id);
    return Math.max(44, Math.ceil(2 * P.padY + ls.reduce((h, l) => h + l.size + P.gapLine, 0)));
  };
  const rowH = Array.from({ length: nRows }, (_, r) => Math.max(0, ...steps.filter((s) => row.get(s.id) === r).map((s) => boxH(s.id))));

  // plan each edge: straight down, straight across, or through a corridor
  const sideKey = (id, side) => `${id}|${side}`;
  const ports = new Map(); // box side -> [{ e, end, other, down }]
  const addPort = (id, side, rec) => { const k = sideKey(id, side); if (!ports.has(k)) ports.set(k, []); ports.get(k).push(rec); };
  const corridors = [[], [], []];
  const bandUse = new Map(); // band index -> [e]
  const useBand = (b, e) => { if (!bandUse.has(b)) bandUse.set(b, []); bandUse.get(b).push(e); return b; };
  for (const e of edges) {
    const la = lane.get(e.from), lb = lane.get(e.to), ra = row.get(e.from), rb = row.get(e.to);
    const between = (L, a, b) => [...occupied[L]].some((r) => r > a && r < b);
    if (e.kind !== 'signal' && la === lb && rb > ra && !between(la, ra, rb)) {
      e.type = 'down';
      addPort(e.from, 'bottom', { e, end: 'out', down: true }); addPort(e.to, 'top', { e, end: 'in', down: true });
    } else if (e.kind !== 'signal' && la !== lb && ra === rb) {
      e.type = 'across';
      addPort(e.from, la === 0 ? 'right' : 'left', { e, end: 'out', otherRow: rb });
      addPort(e.to, lb === 0 ? 'right' : 'left', { e, end: 'in', otherRow: ra });
    } else {
      e.type = 'corr';
      const c = e.kind === 'signal' ? 0 : la !== lb ? 1 : la === 0 ? 1 : 2;
      e.c = c;
      corridors[c].push(e);
      // where it leaves its source
      if (c === 0 && la === 1) { e.exit = { band: useBand(ra + 1, e), side: 'bottom' }; }
      else e.exit = { side: c === 0 ? 'left' : c === 1 ? (la === 0 ? 'right' : 'left') : 'right' };
      // where it enters its target
      if (c === 0 && lb === 1) {
        const fromBelow = ra >= rb;
        e.entry = { band: useBand(fromBelow ? rb + 1 : rb, e), side: fromBelow ? 'bottom' : 'top' };
      } else e.entry = { side: c === 0 ? 'left' : c === 1 ? (lb === 0 ? 'right' : 'left') : 'right' };
      addPort(e.from, e.exit.side, { e, end: 'out', otherRow: rb });
      addPort(e.to, e.entry.side, { e, end: 'in', otherRow: ra });
    }
  }
  // tracks: shorter spans nearer the boxes
  for (const list of corridors) {
    list.sort((a, b) => Math.abs(row.get(a.from) - row.get(a.to)) - Math.abs(row.get(b.from) - row.get(b.to)) || a.i - b.i);
    list.forEach((e, t) => { e.track = t; });
  }
  // a band's tracks: in edge order, one per use
  const bandTrack = new Map();
  for (const [b, list] of bandUse) {
    let t = 0;
    for (const e of list) {
      if (e.exit.band === b && !bandTrack.has(`${e.i}|x`)) bandTrack.set(`${e.i}|x`, t++);
      else if (e.entry.band === b && !bandTrack.has(`${e.i}|n`)) bandTrack.set(`${e.i}|n`, t++);
    }
  }
  const bandN = (b) => (bandUse.get(b) ?? []).length;

  // signal labels: wide flows keep room for them left of the tracks
  const labelled = edges.filter((e) => e.label && !e.inBox && e.type !== 'down');
  const fitLabel = (s) => fitText(s, P.labelMax, P.labelFont, 'sans', true);
  const sigReserve = P.sigReserve
    ? Math.ceil(Math.max(0, ...labelled.filter((e) => e.c === 0).map((e) => textWidth(fitLabel(e.label), P.labelFont, 'sans', true) + 10)))
    : 0;

  // x of lanes and corridors
  const n = corridors.map((l) => l.length);
  const W0 = n[0] ? P.padC + (n[0] - 1) * P.track + P.padC + sigReserve : 0;
  const W1 = hasLane1 || n[1] ? Math.max(P.corridor, 2 * P.padC + Math.max(0, n[1] - 1) * P.track) : 0;
  const W2 = n[2] ? 2 * P.padC + (n[2] - 1) * P.track : 0;
  const x0 = P.margin + W0;
  const laneX = [x0, x0 + laneW[0] + W1];
  const right = laneX[1] + laneW[1] + W2;
  const W = Math.ceil(right + P.margin);
  const trackX = (e) => (e.c === 0 ? laneX[0] - P.padC - e.track * P.track
    : e.c === 1 ? laneX[0] + laneW[0] + P.padC + e.track * P.track
      : laneX[1] + laneW[1] + P.padC + e.track * P.track);

  // y of bands and rows
  const bandH = Array.from({ length: nRows + 1 }, (_, b) => {
    const tracks = bandN(b);
    const need = tracks ? P.bandPad + tracks * P.trackB + P.pinClear : 0;
    return Math.max(b === 0 ? P.top : b === nRows ? P.bottom : P.band, need);
  });
  const bandTop = [];
  const rowTop = [];
  {
    let y = 0;
    for (let r = 0; r <= nRows; r++) {
      bandTop[r] = y; y += bandH[r];
      if (r < nRows) { rowTop[r] = y; y += rowH[r]; }
    }
  }
  const H = Math.ceil(bandTop[nRows] + bandH[nRows]);
  const bandY = (b, t) => bandTop[b] + P.bandPad + t * P.trackB;

  // boxes
  const boxes = steps.map((s) => {
    const L = lane.get(s.id), r = row.get(s.id), h = boxH(s.id), w = laneW[L];
    const x = laneX[L], y = rowTop[r] + Math.round((rowH[r] - h) / 2);
    const lines = [];
    let ly = y + P.padY;
    for (const l of content.get(s.id)) { ly += l.size + P.gapLine; lines.push({ text: l.text, cls: l.cls, x: x + w / 2, y: ly - P.gapLine - 1 }); }
    // a little more room under the last line than over the first, as text sits on its baseline
    const shift = Math.round((h - (ly - y) - P.padY) / 2);
    for (const l of lines) l.y += shift;
    // finding pins sit on the top edge, right-aligned, lowest number first, clear of the arrow at the top centre;
    // what does not fit becomes one "+N" pin
    const own = s.fn ? ctx.pinsOf([s.fn]) : [];
    const room = Math.max(1, Math.floor((w / 2 - 14 - 23) / 21) + 1);
    const shownPins = own.length > room ? [...own.slice(0, room - 1), { ...own[room - 1], more: own.length - room + 1 }] : own;
    const pins = shownPins.map((p, i) => ({ ...p, cx: x + w - 14 - (shownPins.length - 1 - i) * 21, cy: y }));
    const num = s.fn ? ctx.numberOf(s.fn) : null;
    return { id: s.id, fn: s.fn, ext: s.ext, label: s.label, isNew: s.isNew, was: s.was, lane: L, row: r, x, y, w, h, lines,
      pins, n: num, badge: num ? { cx: x + 14, cy: y } : null };
  });
  const box = new Map(boxes.map((b) => [b.id, b]));

  // ports spread along each side
  const portAt = new Map(); // `${edge}|${end}` -> [x, y]
  for (const [k, list] of ports) {
    const [id, side] = k.split('|');
    const b = box.get(id);
    if (side === 'left' || side === 'right') {
      list.sort((a, c) => a.otherRow - c.otherRow || a.e.i - c.e.i);
      const gap = list.length > 1 ? Math.min(PORT_GAP, (b.h - 16) / (list.length - 1)) : 0;
      list.forEach((p, j) => {
        const y = b.y + b.h / 2 + (j - (list.length - 1) / 2) * gap;
        portAt.set(`${p.e.i}|${p.end}`, [side === 'left' ? b.x : b.x + b.w, Math.round(y)]);
      });
    } else {
      const downs = list.filter((p) => p.down), others = list.filter((p) => !p.down);
      downs.forEach((p, j) => portAt.set(`${p.e.i}|${p.end}`, [Math.round(b.x + b.w / 2 + j * 12), side === 'top' ? b.y : b.y + b.h]));
      // band routes head left, so their ports sit left of the centre, away from a straight edge
      others.sort((a, c) => a.e.i - c.e.i);
      others.forEach((p, j) => portAt.set(`${p.e.i}|${p.end}`, [Math.round(b.x + b.w / 2 - (j + 1) * 14), side === 'top' ? b.y : b.y + b.h]));
    }
  }

  // points of each edge
  const out = [];
  for (const e of edges) {
    const a = portAt.get(`${e.i}|out`), z = portAt.get(`${e.i}|in`);
    let pts;
    if (e.type === 'down') {
      if (a[0] === z[0]) pts = [a, z];
      else { const ym = Math.round((a[1] + z[1]) / 2); pts = [a, [a[0], ym], [z[0], ym], z]; }
    } else if (e.type === 'across') {
      if (a[1] === z[1]) pts = [a, z];
      else { const xm = Math.round((a[0] + z[0]) / 2); pts = [a, [xm, a[1]], [xm, z[1]], z]; }
    } else {
      const tx = trackX(e);
      pts = [a];
      if (e.exit.band != null) { const y = bandY(e.exit.band, bandTrack.get(`${e.i}|x`)); pts.push([a[0], y], [tx, y]); }
      else pts.push([tx, a[1]]);
      if (e.entry.band != null) { const y = bandY(e.entry.band, bandTrack.get(`${e.i}|n`)); pts.push([tx, y], [z[0], y], z); }
      else pts.push([tx, z[1]], z);
    }
    out.push({ from: e.from, to: e.to, kind: e.kind, type: e.type, label: e.inBox ? null : e.label,
      points: simplify(pts.map(([x, y]) => [Math.round(x), Math.round(y)])), place: null, key: null, i: e.i });
  }
  // the arrow's tip stops one unit short of the box edge
  for (const e of out) {
    const p = e.points, q = p[p.length - 1], r = p[p.length - 2];
    if (!r) continue;
    const dx = Math.sign(q[0] - r[0]), dy = Math.sign(q[1] - r[1]);
    p[p.length - 1] = [q[0] - dx, q[1] - dy];
  }

  // labels: the first free spot along the edge, else a lettered key under the flow
  const solid = [...boxes.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })),
    ...boxes.flatMap((b) => [...b.pins, ...(b.badge ? [b.badge] : [])].map((p) => ({ x: p.cx - 10, y: p.cy - 10, w: 20, h: 20 })))];
  // every edge's segments, as thin boxes: a label keeps off every edge but its own, so it never reads as another's
  const segs = out.flatMap((e, k) => e.points.slice(1).map((b, i) => {
    const a = e.points[i];
    return { k, x: Math.min(a[0], b[0]) - 1, y: Math.min(a[1], b[1]) - 1, w: Math.abs(a[0] - b[0]) + 2, h: Math.abs(a[1] - b[1]) + 2 };
  }));
  const taken = [];
  const free = (r, k) => r.x >= 2 && r.y >= 2 && r.x + r.w <= W - 2 && r.y + r.h <= H - 2
    && !solid.some((s) => hit(r, s, 3)) && !taken.some((s) => hit(r, s, 4)) && !segs.some((s) => s.k !== k && hit(r, s, 2));
  const keys = [];
  const order = out.filter((e) => e.label).sort((a, b) => (a.type === 'down' ? 0 : 1) - (b.type === 'down' ? 0 : 1) || a.i - b.i);
  for (const e of order) {
    const text = fitLabel(e.label);
    const w = Math.ceil(textWidth(text, P.labelFont, 'sans', true));
    const cands = labelSpots(e.points, w, e.type === 'down' ? [0] : [0, -16, 16, -32, 32]);
    const k = out.indexOf(e);
    const spot = cands.find((c) => free(c.rect, k));
    if (spot) { taken.push(spot.rect); e.place = { text, x: spot.x, y: spot.y, anchor: spot.anchor }; continue; }
    const letter = String.fromCharCode(97 + (keys.length % 26)) + (keys.length >= 26 ? Math.floor(keys.length / 26) : '');
    const mid = longestMid(e.points);
    e.key = { letter, cx: mid[0], cy: mid[1], r: KEY_R };
    keys.push({ letter, text: e.label, kind: e.kind });
  }
  for (const e of out) delete e.i;
  return { w: W, h: H, boxes, edges: out, keys };
}

function simplify(pts) {
  const p = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (last && last[0] === q[0] && last[1] === q[1]) continue;
    p.push(q);
  }
  // drop middle points of straight runs
  return p.filter((q, i) => {
    if (i === 0 || i === p.length - 1) return true;
    const a = p[i - 1], b = p[i + 1];
    return !((a[0] === q[0] && q[0] === b[0]) || (a[1] === q[1] && q[1] === b[1]));
  });
}

export function hit(a, b, m = 0) {
  return a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
}

function longestMid(points) {
  let best = null, len = -1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], l = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
    if (l > len) { len = l; best = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]; }
  }
  return best ?? points[0];
}

// Spots beside each segment, longest segment first: right then left of a vertical one, above then below a horizontal one.
function labelSpots(points, w, shifts) {
  const segs = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    segs.push({ a, b, len: Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]), i });
  }
  segs.sort((s, t) => t.len - s.len || s.i - t.i);
  const out = [];
  for (const { a, b, len } of segs) {
    if (len < 18) continue;
    if (a[0] === b[0]) {
      const x = a[0], lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
      for (const d of shifts) {
        const yc = Math.round((lo + hi) / 2) + d;
        if (yc - LABEL_H / 2 < lo - 2 || yc + LABEL_H / 2 > hi + 2) continue;
        out.push({ x: x + 7, y: yc + 4, anchor: 'start', rect: { x: x + 6, y: yc - LABEL_H / 2, w: w + 2, h: LABEL_H } });
        out.push({ x: x - 7, y: yc + 4, anchor: 'end', rect: { x: x - 8 - w, y: yc - LABEL_H / 2, w: w + 2, h: LABEL_H } });
      }
    } else {
      const y = a[1], lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      if (hi - lo < w + 8) continue;
      for (const d of [0, -20, 20]) {
        const xc = Math.round((lo + hi) / 2) + d;
        if (xc - w / 2 < lo || xc + w / 2 > hi) continue;
        out.push({ x: xc, y: y - 6, anchor: 'middle', rect: { x: xc - w / 2 - 1, y: y - 6 - 11, w: w + 2, h: LABEL_H } });
        out.push({ x: xc, y: y + 15, anchor: 'middle', rect: { x: xc - w / 2 - 1, y: y + 15 - 11, w: w + 2, h: LABEL_H } });
      }
    }
  }
  return out;
}

// ---------- the read route ----------
function routeOf(facts, numberOf) {
  const r = facts.route ?? {};
  const bar = ['read', 'skim', 'skip'].map((tier) => {
    const items = arr(r[tier]).filter((x) => x && x.path).map((x) => ({ path: x.path, lines: Math.max(0, x.lines | 0) }));
    return { tier, items, lines: items.reduce((s, x) => s + x.lines, 0) };
  });
  const readPaths = new Set(bar[0].items.map((x) => x.path));
  const fns = arr(facts.functions).map((f, i) => ({ f, i })).filter(({ f }) => readPaths.has(f.path));
  const size = (f) => (f.added || 0) + (f.removed || 0);
  const read = fns.filter(({ f }) => !f.fold).sort((a, b) => (numberOf(a.f.id) ?? Infinity) - (numberOf(b.f.id) ?? Infinity)
    || size(b.f) - size(a.f) || a.i - b.i).map(({ f }) => f.id);
  const folded = fns.filter(({ f }) => f.fold).map(({ f }) => f.id);
  return { bar, read, folded, total: bar.reduce((s, t) => s + t.lines, 0) };
}

// ---------- all of it ----------
// What every view needs: chip numbers (a function's first place in the first flow, read top to bottom, main lane
// first), finding pins, names.
function contextOf(facts, meaning, findings) {
  const m = normMeaning(meaning, facts);
  const ks = normFindings(findings, facts);
  const fnById = new Map(arr(facts?.functions).map((f) => [f.id, f]));
  const flowsIn = m.story?.flows ?? [];
  const numbers = new Map();
  if (flowsIn.length) {
    const g = flowGrid(flowsIn[0]);
    const seq = flowsIn[0].steps.map((s, i) => ({ s, i }))
      .sort((a, b) => g.row.get(a.s.id) - g.row.get(b.s.id) || g.lane.get(a.s.id) - g.lane.get(b.s.id) || a.i - b.i);
    for (const { s } of seq) if (s.fn && !numbers.has(s.fn)) numbers.set(s.fn, numbers.size + 1);
  }
  const numberOf = (id) => numbers.get(id) ?? null;
  const pinsOf = (ids) => {
    const set = new Set(ids);
    return ks.filter((k) => k.fns.some((id) => set.has(id))).map((k) => ({ key: k.key, n: k.n, tier: k.tier }));
  };
  return { flowsIn, numbers, ctx: { numberOf, pinsOf, fnName: (id) => fnLabel(fnById.get(id)) } };
}

/**
 * The positions every page can have without ELK: the phone flows, the list map, the route. `wide` and `where` are
 * null here, so a page drawn from it shows the phone views at every width.
 */
export function layoutBase(facts, meaning, findings) {
  const { flowsIn, numbers, ctx } = contextOf(facts, meaning, findings);
  const flows = flowsIn.map((f) => ({ title: f.title, wide: null, tall: layoutFlow(f, FLOW_TALL, ctx) }));
  const map = layoutMap(facts ?? {}, ctx.numberOf, ctx.pinsOf);
  map.order = Object.fromEntries([...numbers]);
  const route = routeOf(facts ?? {}, ctx.numberOf);
  return { map, flows, route, where: null };
}

/**
 * Every position on the page: layoutBase, plus the desktop How graph of each flow and the desktop Where code graph,
 * placed by ELK (graph-how.mjs, graph-where.mjs). Async because ELK is; the same input gives the same positions.
 */
export async function layout(facts, meaning, findings) {
  const out = layoutBase(facts, meaning, findings);
  const { flowsIn, ctx } = contextOf(facts, meaning, findings);
  for (let i = 0; i < flowsIn.length; i++) out.flows[i].wide = await howWide(flowsIn[i], ctx);
  out.where = await whereWide(facts ?? {}, ctx);
  return out;
}
