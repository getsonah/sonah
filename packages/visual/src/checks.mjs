// checks.mjs: layer 2's grounding. Every answer the model gives is checked by code against layer 1's facts before
// anything is shown: function ids exist, word and count limits hold, a "was" only where allowed, each flow's main edges
// form one chain and every step is joined to it, glossary terms and finding quotes appear literally in the diff, tiers
// are in the closed set. What fails is dropped with one closed reason; nothing is repaired or reworded here.
// A text that fails only its word limit is set to null and its item is kept when the item is still grounded (a step
// keeps its function, a finding its tier, functions and quote). Checks return { value, dropped }.
// Code checks structure and verbatim text only; what a text means is never judged here.
//
// limitFailures and mergeFixes serve the one limit re-ask (answers.mjs): which texts and lists of an answer are over
// their limits, and the answer with the re-asked fields put in where they now pass.

import { DROP_REASONS as R, isDropReason } from './reasons.mjs';
import { LIMITS, modelRows } from './requests.mjs';

export { LIMITS };
export const TIERS = Object.freeze(['must-act', 'must-know', 'good-to-know']);
export const EDGE_KINDS = Object.freeze(['main', 'branch', 'signal']);

export const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const isText = (s) => typeof s === 'string' && s.trim().length > 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// A record from answerAll ({ id, kind, answer, error }) or a bare answer object.
function unwrap(x) {
  if (x && typeof x === 'object' && !Array.isArray(x) && 'answer' in x && 'kind' in x) {
    return { rid: x.id ?? '', answer: x.answer, error: x.error ?? null };
  }
  return { rid: '', answer: x, error: null };
}
const at = (rid, path) => (rid ? (path ? `${rid}/${path}` : rid) : path);
const listOf = (answer, key) => (Array.isArray(answer) ? answer : Array.isArray(answer?.[key]) ? answer[key] : null);
const failedReason = (error) => (isDropReason(error) ? error : R.call_failed);

// The diff as the model read it: each function's rows (gaps left out), one text per function.
function diffTexts(facts) {
  return (facts.functions ?? []).map((fn) => modelRows(fn).filter((r) => r[0] !== '~').map((r) => r[3]).join('\n'));
}
const inDiff = (texts, s) => texts.some((t) => t.includes(s));

// One text field: null and a drop when it is missing or over its limit.
function textField(value, limit, where, dropped) {
  if (!isText(value)) { dropped.push({ where, reason: R.missing_text }); return null; }
  if (words(value) > limit) { dropped.push({ where, reason: R.over_word_limit }); return null; }
  return value.trim();
}

// ---------- the limit re-ask ----------

/**
 * The texts and lists of a raw answer (short ids, as the model wrote it) that are over their limits, in answer order.
 * Each: { key, path, list: false, limit, text, words } for a text; { key, path, list: true, whole, unit, count, limit }
 * for a list. A list over its count is asked for whole, so the texts inside it are not listed as well.
 */
export function limitFailures(kind, answer) {
  const out = [];
  if (!isObj(answer)) return out;
  const text = (key, path, value, limit) => {
    if (isText(value) && words(value) > limit) out.push({ key, path, list: false, limit, text: value, words: words(value) });
  };
  const count = (key, path, list, limit, unit, whole = false) => {
    if (!Array.isArray(list) || list.length <= limit) return false;
    out.push({ key, path, list: true, whole, unit, count: list.length, limit });
    return true;
  };
  if (kind === 'functions' && Array.isArray(answer.functions)) {
    const seen = new Set();
    answer.functions.forEach((e, i) => {
      if (!isObj(e) || typeof e.id !== 'string' || seen.has(e.id)) return;
      seen.add(e.id);
      text(`${e.id}.summary`, ['functions', i, 'summary'], e.summary, LIMITS.summary);
      text(`${e.id}.change`, ['functions', i, 'change'], e.change, LIMITS.change);
    });
  } else if (kind === 'story') {
    text('oneLine', ['oneLine'], answer.oneLine, LIMITS.oneLine);
    text('ask', ['ask'], answer.ask, LIMITS.ask);
    if (!count('beforeNow', ['beforeNow'], answer.beforeNow, LIMITS.beforeNowMax, 'pairs') && Array.isArray(answer.beforeNow)) {
      answer.beforeNow.forEach((p, i) => {
        if (!isObj(p)) return;
        text(`beforeNow[${i}].before`, ['beforeNow', i, 'before'], p.before, LIMITS.beforeNowSide);
        text(`beforeNow[${i}].now`, ['beforeNow', i, 'now'], p.now, LIMITS.beforeNowSide);
      });
    }
    if (!count('flows', ['flows'], answer.flows, LIMITS.flowsMax, 'flows') && Array.isArray(answer.flows)) {
      answer.flows.forEach((f, i) => {
        if (!isObj(f)) return;
        const key = `flows[${i}]`;
        if (count(key, ['flows', i], f.steps, LIMITS.stepsMax, 'steps', true)) return;
        text(`${key}.title`, ['flows', i, 'title'], f.title, LIMITS.flowTitle);
        (Array.isArray(f.steps) ? f.steps : []).forEach((s, j) => {
          if (!isObj(s)) return;
          text(`${key}.steps[${j}].label`, ['flows', i, 'steps', j, 'label'], s.label, LIMITS.stepLabel);
          if (s.isNew === true) text(`${key}.steps[${j}].was`, ['flows', i, 'steps', j, 'was'], s.was, LIMITS.stepWas);
        });
        (Array.isArray(f.edges) ? f.edges : []).forEach((e, j) => {
          if (isObj(e)) text(`${key}.edges[${j}].label`, ['flows', i, 'edges', j, 'label'], e.label, LIMITS.edgeLabel);
        });
      });
    }
    if (!count('glossary', ['glossary'], answer.glossary, LIMITS.glossaryMax, 'terms') && Array.isArray(answer.glossary)) {
      answer.glossary.forEach((g, i) => { if (isObj(g)) text(`glossary[${i}].def`, ['glossary', i, 'def'], g.def, LIMITS.glossaryDef); });
    }
  } else if (kind === 'findings') {
    if (!count('findings', ['findings'], answer.findings, LIMITS.findingsMax, 'findings') && Array.isArray(answer.findings)) {
      answer.findings.forEach((k, i) => {
        if (!isObj(k)) return;
        text(`findings[${i}].title`, ['findings', i, 'title'], k.title, LIMITS.findingTitle);
        text(`findings[${i}].oneLine`, ['findings', i, 'oneLine'], k.oneLine, LIMITS.findingOneLine);
      });
    }
  }
  return out;
}

/**
 * The answer with each re-asked field put in where it now passes its limit; a field that still fails, or was not given,
 * keeps the first answer's value (the checks then drop it). Returns { answer, fixed: [key] }.
 */
export function mergeFixes(answer, failures, fields) {
  const out = structuredClone(answer);
  const fixed = [];
  for (const f of failures) {
    if (!fields || !Object.hasOwn(fields, f.key)) continue;
    const v = fields[f.key];
    const ok = !f.list ? isText(v) && words(v) <= f.limit
      : f.whole ? isObj(v) && Array.isArray(v.steps) && v.steps.length > 0 && v.steps.length <= f.limit
        : Array.isArray(v) && v.length > 0 && v.length <= f.limit;
    if (!ok) continue;
    let node = out;
    for (const k of f.path.slice(0, -1)) node = node?.[k];
    if (node === null || typeof node !== 'object') continue;
    node[f.path.at(-1)] = typeof v === 'string' ? v.trim() : v;
    fixed.push(f.key);
  }
  return { answer: out, fixed };
}

// ---------- functions ----------

// answers: the function batches' records (or bare answers). value: { [functionId]: { summary, change } } in facts
// order; a field that failed is null, and an entry with neither field is left out.
export function checkFunctions(facts, answers) {
  const dropped = [];
  const ids = new Set((facts.functions ?? []).map((fn) => fn.id));
  const got = new Map();
  for (const rec of answers ?? []) {
    const { rid, answer, error } = unwrap(rec);
    if (answer == null) { dropped.push({ where: at(rid, ''), reason: error ? failedReason(error) : R.answer_invalid }); continue; }
    const entries = listOf(answer, 'functions');
    if (!entries) { dropped.push({ where: at(rid, ''), reason: R.answer_invalid }); continue; }
    entries.forEach((e, i) => {
      const where = at(rid, `functions[${i}]`);
      if (!e || typeof e !== 'object' || !ids.has(e.id)) { dropped.push({ where, reason: R.unknown_function }); return; }
      if (got.has(e.id)) { dropped.push({ where, reason: R.duplicate_function }); return; }
      const summary = textField(e.summary, LIMITS.summary, `${where}.summary`, dropped);
      const change = textField(e.change, LIMITS.change, `${where}.change`, dropped);
      got.set(e.id, { summary, change });
    });
  }
  const value = {};
  for (const fn of facts.functions ?? []) {
    const m = got.get(fn.id);
    if (m && (m.summary !== null || m.change !== null)) value[fn.id] = m;
  }
  return { value, dropped };
}

// ---------- story ----------

function capped(list, limit, where, dropped) {
  for (let i = limit; i < list.length; i++) dropped.push({ where: `${where}[${i}]`, reason: R.over_count_limit });
  return list.slice(0, limit);
}

// value: { oneLine, ask, beforeNow: [{ before, now }], flows, glossary: [{ term, def }] }; a failed text is null.
export function checkStory(facts, answer) {
  const dropped = [];
  const { rid, answer: a, error } = unwrap(answer);
  const value = { oneLine: null, ask: null, beforeNow: [], flows: [], glossary: [] };
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    dropped.push({ where: at(rid, ''), reason: a == null && error ? failedReason(error) : R.answer_invalid });
    return { value, dropped };
  }
  const p = (path) => at(rid, path);
  value.oneLine = textField(a.oneLine, LIMITS.oneLine, p('oneLine'), dropped);
  value.ask = textField(a.ask, LIMITS.ask, p('ask'), dropped);

  capped(Array.isArray(a.beforeNow) ? a.beforeNow : [], LIMITS.beforeNowMax, p('beforeNow'), dropped).forEach((pair, i) => {
    const [before, now] = Array.isArray(pair) ? pair : [pair?.before, pair?.now];
    const where = p(`beforeNow[${i}]`);
    for (const [side, s] of [['before', before], ['now', now]]) {
      if (!isText(s)) { dropped.push({ where: `${where}.${side}`, reason: R.missing_text }); return; }
      if (words(s) > LIMITS.beforeNowSide) { dropped.push({ where: `${where}.${side}`, reason: R.over_word_limit }); return; }
    }
    value.beforeNow.push({ before: before.trim(), now: now.trim() });
  });

  const fnIds = new Set((facts.functions ?? []).map((fn) => fn.id));
  capped(Array.isArray(a.flows) ? a.flows : [], LIMITS.flowsMax, p('flows'), dropped).forEach((flow, i) => {
    const kept = checkFlow(flow, fnIds, p(`flows[${i}]`), dropped);
    if (kept) value.flows.push(kept);
  });

  const texts = diffTexts(facts);
  const terms = new Set();
  capped(Array.isArray(a.glossary) ? a.glossary : [], LIMITS.glossaryMax, p('glossary'), dropped).forEach((g, i) => {
    const where = p(`glossary[${i}]`);
    if (!isText(g?.term)) { dropped.push({ where, reason: R.missing_text }); return; }
    if (terms.has(g.term)) { dropped.push({ where, reason: R.duplicate_term }); return; }
    if (!inDiff(texts, g.term)) { dropped.push({ where, reason: R.term_not_in_diff }); return; }
    if (!isText(g.def)) { dropped.push({ where: `${where}.def`, reason: R.missing_text }); return; }
    if (words(g.def) > LIMITS.glossaryDef) { dropped.push({ where: `${where}.def`, reason: R.over_word_limit }); return; }
    terms.add(g.term);
    value.glossary.push({ term: g.term, def: g.def.trim() });
  });
  return { value, dropped };
}

// One flow: steps first (a dropped step takes its edges with it), then edges, then the main chain on what is left, then
// every step must be joined to that chain by main or branch edges. A title or label that fails is null; the page then
// names the step by its function or external.
function checkFlow(flow, fnIds, where, dropped) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) { dropped.push({ where, reason: R.missing_text }); return null; }
  const title = textField(flow.title, LIMITS.flowTitle, `${where}.title`, dropped);
  const given = new Set();
  const steps = [];
  (Array.isArray(flow.steps) ? flow.steps : []).forEach((s, j) => {
    const sw = `${where}.steps[${j}]`;
    const id = typeof s?.id === 'string' || typeof s?.id === 'number' ? String(s.id) : '';
    if (!id) { dropped.push({ where: sw, reason: R.missing_text }); return; }
    if (given.has(id)) { dropped.push({ where: sw, reason: R.duplicate_step }); return; }
    given.add(id);
    const fn = s.fn ?? null;
    if (fn !== null && !fnIds.has(fn)) { dropped.push({ where: sw, reason: R.unknown_function }); return; }
    const ext = isText(s.ext) ? s.ext.trim() : null;
    if (fn === null && ext === null) { dropped.push({ where: sw, reason: R.step_without_target }); return; }
    // The first LIMITS.stepsMax good steps are kept; an edge to a later one is dropped with it.
    if (steps.length >= LIMITS.stepsMax) { dropped.push({ where: sw, reason: R.over_count_limit }); return; }
    const label = textField(s.label, LIMITS.stepLabel, `${sw}.label`, dropped);
    const isNew = s.isNew === true;
    let was = null;
    if (s.was != null) {
      // "was" says what this step did before the change, so it belongs only on a step the change makes new.
      if (!isNew) dropped.push({ where: `${sw}.was`, reason: R.was_not_allowed });
      else if (!isText(s.was)) dropped.push({ where: `${sw}.was`, reason: R.missing_text });
      else if (words(s.was) > LIMITS.stepWas) dropped.push({ where: `${sw}.was`, reason: R.over_word_limit });
      else was = s.was.trim();
    }
    steps.push({ id, label, fn, ext, was, isNew, j });
  });
  if (!steps.length) { dropped.push({ where, reason: R.flow_without_steps }); return null; }

  const kept = new Set(steps.map((s) => s.id));
  let edges = [];
  (Array.isArray(flow.edges) ? flow.edges : []).forEach((e, j) => {
    const ew = `${where}.edges[${j}]`;
    const from = e?.from == null ? '' : String(e.from); const to = e?.to == null ? '' : String(e.to);
    if (!given.has(from) || !given.has(to)) { dropped.push({ where: ew, reason: R.unknown_step }); return; }
    if (!kept.has(from) || !kept.has(to)) { dropped.push({ where: ew, reason: R.edge_to_dropped_step }); return; }
    if (!EDGE_KINDS.includes(e.kind)) { dropped.push({ where: ew, reason: R.edge_kind_unknown }); return; }
    let label = null;
    if (e.label != null) {
      if (!isText(e.label)) dropped.push({ where: `${ew}.label`, reason: R.missing_text });
      else if (words(e.label) > LIMITS.edgeLabel) dropped.push({ where: `${ew}.label`, reason: R.over_word_limit });
      else label = e.label.trim();
    }
    edges.push({ from, to, label, kind: e.kind, j });
  });

  if (!isOneChain(steps, edges.filter((e) => e.kind === 'main'))) {
    dropped.push({ where, reason: R.main_not_one_chain });
    return null;
  }
  // A step that no main or branch edge joins to the chain would be drawn beside steps it has nothing to do with.
  const joined = new Set(mainChain({ steps, edges }));
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) {
      if (e.kind === 'signal' || joined.has(e.from) === joined.has(e.to)) continue;
      joined.add(e.from); joined.add(e.to); grew = true;
    }
  }
  for (const s of steps) if (!joined.has(s.id)) dropped.push({ where: `${where}.steps[${s.j}]`, reason: R.step_not_joined });
  for (const e of edges) {
    if (!joined.has(e.from) || !joined.has(e.to)) dropped.push({ where: `${where}.edges[${e.j}]`, reason: R.edge_to_dropped_step });
  }
  edges = edges.filter((e) => joined.has(e.from) && joined.has(e.to));
  return { title, steps: steps.filter((s) => joined.has(s.id)).map(({ j, ...s }) => s), edges: edges.map(({ j, ...e }) => e) };
}

// The main edges form one simple path: each step at most one main edge in and out, one start, no cycle, all joined.
// A flow of one step needs no main edge; a longer flow needs at least one.
export function isOneChain(steps, mains) {
  if (!mains.length) return steps.length === 1;
  const next = new Map(); const into = new Map();
  for (const e of mains) {
    if (e.from === e.to || next.has(e.from) || into.has(e.to)) return false;
    next.set(e.from, e.to); into.set(e.to, e.from);
  }
  const starts = [...next.keys()].filter((id) => !into.has(id));
  if (starts.length !== 1) return false;
  let n = 0;
  for (let cur = starts[0]; next.has(cur); cur = next.get(cur)) if (++n > mains.length) return false;
  return n === mains.length;
}

// The main chain's step ids in order (for layout and numbering); [] when there is none, the one step for a single step.
export function mainChain(flow) {
  const mains = (flow.edges ?? []).filter((e) => e.kind === 'main');
  if (!mains.length) return flow.steps?.length === 1 ? [flow.steps[0].id] : [];
  const next = new Map(mains.map((e) => [e.from, e.to]));
  const into = new Set(mains.map((e) => e.to));
  const out = [];
  for (let cur = [...next.keys()].find((id) => !into.has(id)); cur !== undefined && out.length <= mains.length; cur = next.get(cur)) out.push(cur);
  return out;
}

// ---------- findings ----------

// value: [{ tier, title, oneLine, fns, quote }]. A finding that fails its grounding (tier, functions, quote) is dropped
// whole with its first reason. A title or oneLine over its limit is null and the finding is kept, so a grounded finding
// is never lost for its wording alone; with neither text left it is dropped. At most LIMITS.findingsMax are kept, the
// first good ones in the model's order.
export function checkFindings(facts, answer) {
  const dropped = [];
  const { rid, answer: a, error } = unwrap(answer);
  const list = a == null ? null : listOf(a, 'findings');
  if (!list) {
    dropped.push({ where: at(rid, ''), reason: a == null && error ? failedReason(error) : R.answer_invalid });
    return { value: [], dropped };
  }
  const fnIds = new Set((facts.functions ?? []).map((fn) => fn.id));
  const texts = diffTexts(facts);
  const value = [];
  list.forEach((k, i) => {
    const where = at(rid, `findings[${i}]`);
    const reason = groundReason(k, fnIds, texts) ?? (value.length >= LIMITS.findingsMax ? R.over_count_limit : null);
    if (reason) { dropped.push({ where, reason }); return; }
    const own = [];
    const title = textField(k.title, LIMITS.findingTitle, `${where}.title`, own);
    const oneLine = textField(k.oneLine, LIMITS.findingOneLine, `${where}.oneLine`, own);
    if (title === null && oneLine === null) { dropped.push({ where, reason: own[0].reason }); return; }
    dropped.push(...own);
    value.push({ tier: k.tier, title, oneLine, fns: [...k.fns], quote: k.quote });
  });
  return { value, dropped };
}

function groundReason(k, fnIds, texts) {
  if (!isObj(k)) return R.missing_text;
  if (!TIERS.includes(k.tier)) return R.tier_unknown;
  if (!Array.isArray(k.fns) || k.fns.some((id) => !fnIds.has(id))) return R.unknown_function;
  if (!isText(k.quote)) return R.missing_text;
  if (k.quote.length > LIMITS.quoteChars) return R.quote_too_long;
  if (!inDiff(texts, k.quote)) return R.quote_not_in_diff;
  return null;
}

/**
 * The grounding of findings against facts alone (no answer record): per finding, its first failing reason (tier,
 * functions, quote length, the quote literally in the diff the model read) or null. The server runs it on an upload.
 */
export function groundFindings(facts, list) {
  const fnIds = new Set((facts?.functions ?? []).map((fn) => fn.id));
  const texts = diffTexts(facts ?? {});
  return (Array.isArray(list) ? list : []).map((k) => groundReason(k, fnIds, texts));
}

/** How many findings a check lost whole (all of them, when the request itself failed counts as one): the page then
 *  never says "No findings". A text nulled inside a kept finding does not count. */
export function findingsLost(dropped) {
  return (dropped ?? []).filter((d) => !/\.(title|oneLine)$/.test(d.where)).length;
}
