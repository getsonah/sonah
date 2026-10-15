// M33 S5: the story's charts read at page width on GitHub. One chart of a long story drew its helpers in one lane at
// the bottom, joined to their steps by edges the height of the chart: GitHub scaled it to the page and every label was
// unreadable. "What happened" is now a small overview (requests and their phases, at most 30 nodes, at most three side
// by side), and each request's steps are charted once, folded, at the top of that request in the engineer section.
// The sessions here are synthetic (session-story-charts-fixture.js, session-story-long-fixture.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, STORY_LIMITS, STORY_SENTENCES, STORY_OVERVIEW_COLLAPSES, STORY_CHART_COLLAPSES } from '../session-story.js';
import { helpersSession, manyRequestSession, decideSession, HELPERS, HELPERS_STEPS, MANY_ASK_STEPS, MANY_STEPS, MANY_FINDINGS,
  MANY_FAILING, DECIDE_PLACES } from './session-story-charts-fixture.js';
import { longSession, longReport, LONG_ASKS } from './session-story-long-fixture.js';
import { sessionBuilder } from './session-story-fixture.js';

// Story /14 (owner decision D77 C): a step is one of your requests — every event the review windows hold under that
// request — so the 37-window one-request session is one step, and the 113-window ten-request session ten steps. The
// charts below are read against those steps.
/** The step (1-based: its request's number) that holds the many-request fixture's window step `s`. */
const manyRequestOf = (s) => MANY_ASK_STEPS.filter((a) => a <= s).length;
/** The overview's two counting levels as its sentence names them (D78: its only levels before the hard stop). */
const COUNTED = `${STORY_OVERVIEW_COLLAPSES[1]}; ${STORY_OVERVIEW_COLLAPSES[2]}.`;

// ---- reading a chart back ------------------------------------------------------------------------------------

/** Every Mermaid block of a story, in order, as its lines, with where it starts. */
function mermaidBlocks(story) {
  const blocks = [];
  for (let at = 0; ;) {
    const start = story.indexOf('```mermaid\n', at);
    if (start === -1) return blocks;
    const end = story.indexOf('\n```\n', start);
    blocks.push({ start, lines: story.slice(start + '```mermaid\n'.length, end).split('\n') });
    at = end;
  }
}
const NODE = /^\s*([A-Za-z][A-Za-z0-9_]*)(\(\["|\{\{"|\{"|>"|\[\["|\[")(.*?)("\]\)|"\}\}|"\}|"\]\]|"\])$/;
const EDGE = /^\s*([A-Za-z][A-Za-z0-9_]*) (-->|---|-\.->|-\.->\|[a-z0-9 ,]+ not charted\|) ([A-Za-z][A-Za-z0-9_]*)$/;

/** A chart's nodes (in declaration order), edges and classes; every line must be a known form, every label safe. */
function parseChart(lines) {
  assert.equal(lines[0], 'flowchart TD');
  const nodes = new Map(), edges = [], classes = new Map();
  for (const line of lines.slice(1)) {
    if (/^\s*classDef \w+ [^;]+$/.test(line)) continue;
    const cls = line.match(/^\s*class (\S+) (\w+)$/);
    if (cls) { for (const id of cls[1].split(',')) classes.set(id, cls[2]); continue; }
    const node = line.match(NODE);
    if (node) {
      const [, id, , label] = node;
      assert.equal(nodes.has(id), false, `node id ${id} is unique`);
      assert.doesNotMatch(label, /["`[\]{}<>|;&\\\n\r]/, `label is Mermaid-safe: ${label}`);
      assert.ok(label.length > 0);
      assert.ok([...label].length <= STORY_LIMITS.chartLabelChars, `label within ${STORY_LIMITS.chartLabelChars} chars: ${label}`);
      nodes.set(id, { id, label });
      continue;
    }
    const edge = line.match(EDGE);
    assert.ok(edge, `every chart line is a known form: ${line}`);
    const gap = edge[2].match(/^-\.->\|(.*)\|$/)?.[1] ?? null;
    if (gap !== null) assert.ok([...gap].length <= STORY_LIMITS.chartLabelChars, `edge label within 60 chars: ${gap}`);
    edges.push({ from: edge[1], arrow: edge[2], to: edge[3], gap });
  }
  for (const { from, to } of edges) assert.ok(nodes.has(from) && nodes.has(to), `edge ${from} -> ${to} joins declared nodes`);
  for (const id of nodes.keys()) assert.ok(classes.has(id), `${id} has a class`);
  return { nodes, edges, classes };
}

/** The edges out of a helper node: its one edge back into the main chain. */
const isBackEdge = (chart, edge) => chart.classes.get(edge.from) === 'helper';

/**
 * Ranks computed from the edge structure, as a layered layout places them: a node no edge enters is at rank 0,
 * every other one rank below the lowest-placed node an edge comes from (longest path). `back`: whether a helper's
 * back edge counts, as it does in Mermaid's own layout, or is the one edge left out, as the charts are designed.
 */
function layout(chart, { back }) {
  const edges = chart.edges.filter((edge) => back || !isBackEdge(chart, edge));
  const into = new Map([...chart.nodes.keys()].map((id) => [id, 0]));
  for (const { to } of edges) into.set(to, into.get(to) + 1);
  const rank = new Map();
  const ready = [...chart.nodes.keys()].filter((id) => into.get(id) === 0);
  for (const id of ready) rank.set(id, 0);
  while (ready.length) {
    const id = ready.shift();
    for (const edge of edges.filter((e) => e.from === id)) {
      rank.set(edge.to, Math.max(rank.get(edge.to) ?? 0, rank.get(id) + 1));
      into.set(edge.to, into.get(edge.to) - 1);
      if (into.get(edge.to) === 0) ready.push(edge.to);
    }
  }
  assert.equal(rank.size, chart.nodes.size, 'the chart has no cycle');
  const perRank = new Map();
  for (const r of rank.values()) perRank.set(r, (perRank.get(r) ?? 0) + 1);
  return { rank, width: Math.max(...perRank.values()), spans: edges.map((edge) => ({ ...edge, span: rank.get(edge.to) - rank.get(edge.from) })) };
}

/**
 * The layout rules every chart keeps (spec: "never create an edge that skips more than one rank of the main chain
 * except the single back edge from a helper to the next node"): no helper lane; leaving out each helper's one back
 * edge, which goes into the chain node right after the one that spawned it, every edge spans exactly one rank. Ranked
 * as Mermaid ranks them, back edges included, the back edge spans one rank and the chain edge beside a helper spans
 * two: a short fork and join around the helper, never passing another chain node. Nothing else spans two, nothing
 * spans more.
 */
function assertLayout(lines) {
  assert.ok(!lines.some((line) => /^\s*subgraph /.test(line)), 'no helper lane');
  const chart = parseChart(lines);
  const designed = layout(chart, { back: false });
  for (const { from, to, span } of designed.spans) assert.equal(span, 1, `${from} -> ${to} spans one rank`);
  const chain = (from, to) => chart.edges.some((e) => e.from === from && e.to === to && !isBackEdge(chart, e) && e.arrow !== '---'
    && chart.classes.get(to) !== 'helper');
  for (const helper of [...chart.nodes.keys()].filter((id) => chart.classes.get(id) === 'helper')) {
    const spawners = chart.edges.filter((e) => e.to === helper).map((e) => e.from);
    assert.equal(spawners.length, 1, `${helper} hangs off one node`);
    const backs = chart.edges.filter((e) => e.from === helper);
    assert.ok(backs.length <= 1, `${helper} has at most one back edge`);
    for (const e of backs) assert.ok(chain(spawners[0], e.to), `${helper} returns into ${e.to}, the node right after ${spawners[0]}`);
  }
  const drawn = layout(chart, { back: true });
  for (const { from, to, span } of drawn.spans) {
    assert.ok(span <= 2, `${from} -> ${to} spans ${span} ranks`);
    if (span === 2) assert.ok(chart.edges.some((e) => e.from === from && chart.classes.get(e.to) === 'helper'
      && chart.edges.some((b) => b.from === e.to && b.to === to)), `${from} -> ${to} spans two ranks only beside a helper`);
  }
  return { chart, designed, drawn };
}

/** The overview: the first chart, under "What happened" (D88: after the checklist, before the engineer section). */
function overviewOf(story) {
  const [first] = mermaidBlocks(story);
  assert.ok(story.lastIndexOf('## What happened', first.start) !== -1 && story.indexOf('## <a name="for-engineers">') > first.start);
  return assertLayout(first.lines);
}
/** The step charts: every chart after the overview, each in its own details block in the engineer section. */
function stepChartsOf(story) {
  const engineer = story.indexOf('## <a name="for-engineers"></a>');
  return mermaidBlocks(story).slice(1).map((block) => {
    assert.ok(block.start > engineer, 'a step chart is in the engineer section');
    const open = story.lastIndexOf('<details>', block.start);
    assert.ok(open > engineer && story.lastIndexOf('</details>', block.start) < open, 'inside a details block');
    assert.ok(story.slice(open, block.start).startsWith('<details>\n<summary>Show the step chart (step'), 'with its summary');
    const heading = story.lastIndexOf('\n### You', open);
    assert.ok(heading > engineer, 'under its request');
    assert.equal(story.slice(heading, open).split('\n').filter(Boolean).length, 1, 'right after the request heading');
    return { ...assertLayout(block.lines), heading: story.slice(heading + 1, story.indexOf('\n', heading + 1)) };
  });
}

const render = (build) => { const { session, report } = build(); return { session, report, story: renderSessionStory(session, report) }; };
const helperCount = (chart) => [...chart.nodes.values()].filter((node) => chart.classes.get(node.id) === 'helper')
  .reduce((n, node) => n + Number(node.label.match(/^(\d+) helpers?: /)[1]), 0);
const count = (text, pattern) => [...text.matchAll(pattern)].reduce((n, m) => n + Number(m[1]), 0);

/**
 * What an overview accounts for, wherever it says it: findings on finding nodes ("Finding: …" is one, "3 findings"
 * three; D71 (a): never a status) and on dashed edges; changes of approach on their marker node, a phase's label ("2 changes of
 * approach", "2 approach changes") and dashed edges; helpers on helper nodes, a phase's label ("2 helpers", "spawned 2
 * helpers") and dashed edges.
 */
function accounted(chart) {
  let findings = 0, pivots = 0, helpers = 0;
  for (const { id, label } of chart.nodes.values()) {
    const cls = chart.classes.get(id);
    if (cls === 'finding') findings += /^Finding: /.test(label) ? 1 : Number(label.match(/^(\d+) findings$/)[1]);
    else if (cls === 'abandoned') pivots += Number(label.match(/^(\d+) changes? of approach$/)[1]);
    else if (cls === 'helper') helpers += Number(label.match(/^(\d+) helpers?: /)[1]);
    else if (id !== 'EARLIER' && id !== 'MORE') {
      pivots += count(label, /(?:^| · )(\d+) (?:changes? of approach|approach changes?)(?: · |$)/g);
      // "spawned 2 helpers" says what a phase did; when its helpers hang beside it, they are counted there.
      if (!chart.edges.some((e) => e.from === id && chart.classes.get(e.to) === 'helper'))
        helpers += count(label, /(?:^| · )(?:spawned )?(\d+) helpers?(?: · |$)/g);
    }
  }
  const gaps = [...chart.edges.map((e) => e.gap).filter(Boolean), ...['EARLIER', 'MORE'].filter((id) => chart.nodes.has(id))
    .map((id) => chart.nodes.get(id).label)];
  for (const gap of gaps) {
    findings += count(gap, /(\d+) findings?/g);
    pivots += count(gap, /(\d+) (?:changes? of approach|approach changes?)/g);
    helpers += count(gap, /(\d+) helpers?/g);
  }
  return { findings, pivots, helpers };
}
/** The number in the head table's column (D71 (a): Requests addressed, Findings, Decided without asking, Changes of
 *  approach, Review). */
const headCount = (story, column) => {
  const lines = story.split('\n');
  return Number(lines[lines.findIndex((line) => line.startsWith('| Requests addressed | Findings |')) + 2].split('|')[column + 1]);
};
/** Every helper a session's steps spawned (a delegate that is not a follow-up). */
const spawned = (session, report) => {
  const inSteps = new Set(report.windowResults.flatMap((w) => w.eventIds));
  return session.events.filter((e) => e.kind === 'invocation' && e.operation === 'delegate' && inSteps.has(e.id)
    && session.childFor(e.id)?.relation !== 'followup').length;
};

// ---- the 37-step session with eight helpers -------------------------------------------------------------------------

const HELPERS_STORY = render(helpersSession).story;

test('M33 S5 the 37-window, one-request overview is small: the request, its one step, its helpers and findings beside it', () => {
  const { chart, designed, drawn } = overviewOf(HELPERS_STORY);
  assert.ok(chart.nodes.size <= STORY_LIMITS.overviewNodes, `${chart.nodes.size} nodes`);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth, `designed width ${designed.width}`);
  assert.ok(drawn.width <= STORY_LIMITS.overviewWidth, `drawn width ${drawn.width}`);
  // Story /14: the 37 review windows review one request, so they are one step; its eight helpers hang beside it on one
  // node and its two findings on one. Nothing needed simplifying.
  assert.deepEqual([...chart.nodes.keys()], ['A1', 'S1', 'H1', 'F1']);
  assert.equal(HELPERS_STORY.includes(STORY_SENTENCES.overviewSimplified), false);
  // Every one of the eight helpers is counted once, on the node beside the step that spawned them; every finding and
  // change of approach is on the chart.
  assert.equal(helperCount(chart), Object.keys(HELPERS).length);
  assert.deepEqual(accounted(chart), { findings: 2, pivots: 2, helpers: 8 });
  const label = (id) => chart.nodes.get(id).label;
  // A helper's brief gives way to its count and to where its result was merged, never the other way round.
  assert.equal(label('H1'), '8 helpers: Map every caller of sliceSess… · merged at step 1');
  assert.equal(label('F1'), '2 findings');
  // A count is never cut: the contradicted statement and the failed commands take their short forms.
  assert.equal(label('S1'), 'Step 1 · 1 contradicted · 3 failed · 2 approach changes');
  assert.equal(chart.classes.get('S1'), 'step');
  // Findings are red, every one alike (D71 (a): no status tells them apart).
  assert.equal(chart.classes.get('F1'), 'finding');
  assert.ok(HELPERS_STORY.includes('  classDef finding fill:#fee2e2,stroke:#b91c1c,color:#111827,stroke-width:2px\n'));
  assert.doesNotMatch(HELPERS_STORY, /classDef (decide|fyi)|Needs your decision|Worth a look/);
  // No node follows the one step, so the helpers' node has nothing to return into: no edge across the chart.
  assert.equal(chart.edges.filter((e) => e.from === 'H1').length, 0);
});

test('M33 S5 the one request is charted once, folded at the top of the request: its one step and what hangs off it', () => {
  const charts = stepChartsOf(HELPERS_STORY);
  assert.equal(charts.length, 1, 'one step chart for the one request');
  const [{ chart, heading }] = charts;
  assert.ok(heading.startsWith('### You: Rework the arc slicer'));
  assert.ok(HELPERS_STORY.includes('<summary>Show the step chart (step 1)</summary>'));
  // Story /14: the request's 37 windows are one step; beside it its eight helpers (one node), its two findings (one
  // node each), its decisions made without asking (one node), the decision you settled and its abandoned approaches.
  assert.deepEqual([...chart.nodes.keys()], ['S1', 'H1', 'F1_1', 'F1_2', 'U1', 'K1', 'P1']);
  assert.equal(helperCount(chart), Object.keys(HELPERS).length);
  assert.equal(chart.nodes.get('U1').label, '2 decisions made without asking');
  assert.equal(chart.nodes.get('P1').label, '2 approaches abandoned');
  assert.equal(HELPERS_STEPS, 37);
  // Seven nodes need no simplification, and no level is named.
  assert.equal(HELPERS_STORY.includes(STORY_SENTENCES.chartSimplified), false);
});

// ---- the 113-step session with ten requests ---------------------------------------------------------------------

const MANY_STORY = render(manyRequestSession).story;

test('M33 S5 the 113-step, ten-request overview draws every request within 30 nodes, three side by side at most', () => {
  const { chart, designed, drawn } = overviewOf(MANY_STORY);
  assert.ok(chart.nodes.size <= STORY_LIMITS.overviewNodes, `${chart.nodes.size} nodes`);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth && drawn.width <= STORY_LIMITS.overviewWidth);
  const asks = [...chart.nodes.keys()].filter((id) => /^A\d+$/.test(id));
  assert.equal(asks.length, MANY_ASK_STEPS.length, 'one node per request');
  // Story /14: each request is one step, drawn beside its request, its finding (where one is) beside it.
  assert.deepEqual([...chart.nodes.keys()].filter((id) => /^S\d+$/.test(id)), MANY_ASK_STEPS.map((_, k) => `S${k + 1}`));
  for (const n of Object.keys(MANY_FINDINGS).map(Number)) {
    const k = manyRequestOf(n);
    assert.ok(chart.nodes.has(`S${k}`) && chart.nodes.has(`F${k}`), `the finding at window ${n} has its node beside step ${k}`);
  }
  const { session, report } = manyRequestSession();
  assert.deepEqual(accounted(chart), { findings: 3, pivots: headCount(MANY_STORY, 3), helpers: spawned(session, report) });
  assert.equal(headCount(MANY_STORY, 3), 6);
  // Requests come in order down the chain.
  const { rank } = designed;
  for (let k = 1; k < asks.length; k++) assert.ok(rank.get(`A${k + 1}`) > rank.get(`A${k}`));
  assert.match(MANY_STORY, /The overview was simplified to stay within 30 nodes/);
  // The phase sentence is under the overview, once, and says every request's steps are charted: here they all are.
  const legend = `${STORY_SENTENCES.phaseLegendSimplified} ${STORY_SENTENCES.stepChartsAll}`;
  assert.ok(MANY_STORY.includes(`\n\`\`\`\n\n${legend}\n\nThe overview was simplified`), 'the phase sentence is under the overview');
  assert.equal(MANY_STORY.split(STORY_SENTENCES.phaseLegendSimplified).length, 2, 'once');
});

test('M33 S5 review, M1: a failed command is never left out of the label of its step or its phase', () => {
  // The review found four failing runs of the 113-step session named in no chart: a label kept the directory of an
  // edit and dropped the failure. A failed command is kept first ("2 failed" when the full words do not fit).
  // Story /14: a failing window's request is one step; the step's node, in the overview and in its step chart, keeps
  // the failure in its label.
  const overview = overviewOf(MANY_STORY).chart;
  assert.deepEqual(MANY_FAILING, [17, 51, 85, 102, 113]);
  for (const n of MANY_FAILING) {
    const k = manyRequestOf(n);
    const phase = overview.nodes.get(`S${k}`);
    assert.match(phase.label, / · \d+ (commands? )?failed\b/, `window ${n} in ${phase.id}: ${phase.label}`);
    const node = stepChartsOf(MANY_STORY).map(({ chart }) => chart.nodes.get(`S${k}`)).find(Boolean);
    assert.match(node.label, new RegExp(`^${k} · (Edited|Changed) \\d+ files · 1 (command )?failed · `), node.label);
  }
  const [steps] = stepChartsOf(HELPERS_STORY);
  assert.equal(steps.chart.nodes.get('S1').label, '1 · Changed 7 files · 3 commands failed · files +25 −17');
});

test('M33 S5 each of the ten requests has one step chart of its own steps, within 40 nodes', () => {
  const charts = stepChartsOf(MANY_STORY);
  assert.equal(charts.length, MANY_ASK_STEPS.length);
  charts.forEach(({ chart, heading }, k) => {
    assert.ok(heading.startsWith(`### You: Request ${k + 1}: `), heading);
    assert.ok(chart.nodes.size <= STORY_LIMITS.stepChartNodes);
    // Story /14: a request's chart holds its one step, and nothing of another request's.
    assert.deepEqual([...chart.nodes.keys()].filter((id) => /^S\d+/.test(id)), [`S${k + 1}`]);
  });
  assert.equal(MANY_STEPS, 113);
  assert.ok(Buffer.byteLength(MANY_STORY) <= STORY_LIMITS.targetBytes);
});

test('M33 S5 the 11-request long story keeps the same overview rules', () => {
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  const story = renderSessionStory(session, report);
  const { chart, designed, drawn } = overviewOf(story);
  assert.ok(chart.nodes.size <= STORY_LIMITS.overviewNodes);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth && drawn.width <= STORY_LIMITS.overviewWidth);
  assert.equal([...chart.nodes.keys()].filter((id) => /^A\d+$/.test(id)).length, LONG_ASKS.length);
  const charts = stepChartsOf(story);
  assert.ok(charts.length <= LONG_ASKS.length);
  const shown = charts.length;
  if (shown < LONG_ASKS.length) assert.ok(story.includes(`the step charts of ${LONG_ASKS.length - shown} request`));
  for (const { chart: c } of charts) assert.ok(c.nodes.size <= STORY_LIMITS.stepChartNodes);
  // Story /14: each request's chart is its one step, so all eleven fit, and the sentence under the overview says so.
  assert.equal(shown, LONG_ASKS.length);
  assert.ok(story.includes(`${STORY_SENTENCES.phaseLegendSimplified} ${STORY_SENTENCES.stepChartsAll}\n`));
  assert.equal(story.includes(STORY_SENTENCES.stepChartsSome), false);
});

test('M33 S5 review: no finding, change of approach or helper leaves the long overview without a count', () => {
  // The review found the long story's overview dropping two changes of approach and a helper behind "N steps not
  // charted". Story /14: eleven requests are eleven steps, 22 chain nodes with their findings; the changes of approach
  // and the helpers are counted on their step's label instead of drawn (levels 1 and 2), and no hard stop is needed.
  const { session, windows } = longSession();
  const report = longReport(session, windows);
  const story = renderSessionStory(session, report);
  const { chart } = overviewOf(story);
  assert.ok(story.includes(`${STORY_SENTENCES.overviewSimplified} ${COUNTED}`));
  assert.equal(story.includes(STORY_OVERVIEW_COLLAPSES[STORY_OVERVIEW_COLLAPSES.length - 1]), false, 'no hard stop');
  const findings = headCount(story, 1);
  assert.deepEqual(accounted(chart), { findings, pivots: headCount(story, 3), helpers: spawned(session, report) });
  assert.deepEqual([findings, headCount(story, 3), spawned(session, report)], [3, 20, 9]);
  // Every finding keeps its own node, beside its own step.
  for (const x of report.findings) assert.ok([...chart.nodes.values()].some(({ label }) => label.endsWith(x.title.slice(0, 20))
    || label.includes(x.title.slice(0, 30))), x.title);
  // When even the short words leave no room for what a step did, its counts stand in their short forms.
  assert.equal(chart.nodes.get('S2').label, 'Step 2 · changed 7 files · 3 changes of approach · 2 helpers');
  assert.equal(chart.nodes.get('S11').label, 'Step 11 · 1 contradicted · 2 approach changes · 1 helper');
  assert.equal(chart.edges.filter((e) => e.gap).length, 0, 'nothing was left out');
});

test('M33 S5 review: ten requests with two decisions each keep every finding counted on a node, within 30 nodes', () => {
  const { session, report } = decideSession({ requests: 10 });
  const story = renderSessionStory(session, report);
  const { chart, designed, drawn } = overviewOf(story);
  // Story /14: each request is one step, its two findings one red node beside it: exactly 30 nodes.
  assert.equal(chart.nodes.size, STORY_LIMITS.overviewNodes, `${chart.nodes.size} nodes`);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth && drawn.width <= STORY_LIMITS.overviewWidth);
  for (let r = 0; r < 10; r++) {
    assert.ok(chart.nodes.has(`A${r + 1}`) && chart.nodes.has(`S${r + 1}`), `request ${r + 1} and its step are drawn`);
    assert.equal(chart.nodes.get(`F${r + 1}`)?.label, `${DECIDE_PLACES.length} findings`);
    assert.equal(chart.classes.get(`F${r + 1}`), 'finding');
  }
  assert.deepEqual(accounted(chart), { findings: 20, pivots: 10, helpers: 5 });
  // It says how it was simplified (the changes of approach and the helpers counted on their step), and needed no more.
  assert.ok(story.includes(`${STORY_SENTENCES.overviewSimplified} ${COUNTED}`));
  assert.equal(story.includes(STORY_SENTENCES.overviewPast), false);
  assert.equal(story.includes(STORY_OVERVIEW_COLLAPSES[STORY_OVERVIEW_COLLAPSES.length - 1]), false, 'no hard stop');
  assert.ok(Buffer.byteLength(story) <= STORY_LIMITS.targetBytes);
});

test('M33 S5 review: an overview past 30 nodes that nothing else simplified says why', () => {
  // Fifteen requests whose one step each needs your decision (story /14: a request is one step): 45 nodes, every one of
  // them a request, a step with a finding or its finding. No level takes a node away, and the hard stop leaves nothing out.
  const b = sessionBuilder();
  const windows = [], findings = [];
  for (let s = 1; s <= 15; s++) {
    const at = b.events.length;
    b.ask(`I${s}`, `Request ${s}.`);
    b.change(`W${s}`, `src/f${s}.js`, { after: 'x\n' });
    b.say(`C${s}`, `I skipped check ${s}.`);
    findings.push({ status: 'DECIDE', kind: 'code_issue', title: `Check ${s} skipped`,
      receipts: [{ role: 'commentary', eventId: `C${s}`, quote: `I skipped check ${s}` }] });
    windows.push(b.events.slice(at).map((e) => e.id));
  }
  const story = renderSessionStory(b.session(), { findings,
    windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })) });
  const { chart, designed } = overviewOf(story);
  assert.equal(chart.nodes.size, 45);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth);
  assert.ok(story.includes(`${STORY_SENTENCES.phaseLegend} ${STORY_SENTENCES.stepChartsAll}\n\n${STORY_SENTENCES.overviewOver}\n`));
  assert.equal(story.includes(STORY_SENTENCES.overviewSimplified), false);
});

test('M33 S5 review: past 30 nodes each request keeps its one step, its findings counted on one node, within 60', () => {
  // Fifteen requests with two decisions each: 45 nodes (story /14: a request is one step), past the 30 the overview
  // aims at but within the 60 it never exceeds, each request's two findings on one red node beside its step; none left out.
  const { session, report } = decideSession({ requests: 15 });
  const story = renderSessionStory(session, report);
  const { chart, designed, drawn } = overviewOf(story);
  assert.ok(chart.nodes.size > STORY_LIMITS.overviewNodes && chart.nodes.size <= STORY_LIMITS.overviewMaxNodes, `${chart.nodes.size} nodes`);
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth && drawn.width <= STORY_LIMITS.overviewWidth);
  for (let r = 0; r < 15; r++) {
    assert.ok(chart.nodes.has(`A${r + 1}`) && chart.nodes.has(`S${r + 1}`), `request ${r + 1}`);
    assert.equal(chart.nodes.get(`F${r + 1}`).label, '2 findings');
    assert.equal(chart.classes.get(`F${r + 1}`), 'finding');
  }
  assert.deepEqual(accounted(chart), { findings: 30, pivots: 15, helpers: 8 });
  // It says why it has more than 30 nodes, and how it was simplified (the changes of approach and the helpers counted
  // on their step). (D78: the level that made each request one phase is removed: a request is one step.)
  assert.ok(story.includes(`${STORY_SENTENCES.overviewPast} ${COUNTED}`));
  assert.ok(story.includes(`${STORY_SENTENCES.phaseLegendSimplified} `), 'the phase sentence says the rule was simplified');
  // Past even that, a request's findings are counted on the dashed edge where they were left out, never dropped.
  const twenty = decideSession({ requests: 20 });
  const past = overviewOf(renderSessionStory(twenty.session, twenty.report)).chart;
  assert.ok(past.nodes.size <= STORY_LIMITS.overviewMaxNodes);
  assert.equal(accounted(past).findings, 40);
});

test('M33 S5 the charts are deterministic, and read the same from a report read back from JSON', () => {
  for (const build of [helpersSession, manyRequestSession]) {
    const { session, report, story } = render(build);
    assert.equal(renderSessionStory(session, report), story);
    assert.equal(renderSessionStory(session, JSON.parse(JSON.stringify(report))), story);
  }
});

test('M33 S5 the overview keeps to the chart share; step charts past it only use room nobody else uses', () => {
  const { session, windows } = longSession();
  const long = renderSessionStory(session, longReport(session, windows));
  for (const story of [HELPERS_STORY, MANY_STORY, long]) {
    const overview = story.slice(story.indexOf('## What happened'), story.indexOf('## <a name="for-engineers">'));
    assert.ok(Buffer.byteLength(overview) <= Math.floor(STORY_LIMITS.targetBytes * 0.15), `${Buffer.byteLength(overview)} bytes of overview`);
    assert.ok(Buffer.byteLength(story) <= STORY_LIMITS.targetBytes, `${Buffer.byteLength(story)} bytes`);
    assert.equal(story.includes('_To keep this file short, snippets'), false, 'no step block gave way to a chart');
  }
  // Story /14: each request's chart is its one step, so the long story holds all eleven, and no chart is counted out.
  const headings = long.split('\n### You').slice(1);
  const charted = headings.map((part) => part.slice(0, part.indexOf('\n#### ') === -1 ? undefined : part.indexOf('\n#### '))
    .includes('<summary>Show the step chart'));
  assert.equal(charted.length, LONG_ASKS.length);
  assert.ok(charted.every(Boolean), 'every request keeps its chart');
  assert.doesNotMatch(long, /the step charts of \d+ requests? are not shown/);
});

// ---- rules on small sessions ------------------------------------------------------------------------------------

test('M33 S5 a phase with a finding, a change of approach and helpers keeps two side nodes: the change is counted on it', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Go.');
  b.run('R1', 'cat src/a.js', 'succeeded', 'x');
  const windows = [['I1', 'R1', 'R1-r']];
  const before = b.events.length;
  b.change('W2', 'src/a.js', { after: 'a\n' });
  b.say('P2', 'Switching to plan b.');
  b.say('C2', 'I dropped the old check.');
  b.delegate('D2', 'Look at the old check', 'k2');
  windows.push(b.events.slice(before).map((e) => e.id));
  const after = b.events.length;
  b.run('R3', 'cat src/b.js', 'succeeded', 'x');
  windows.push(b.events.slice(after).map((e) => e.id));
  const report = { windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
    findings: [{ status: 'FYI', kind: 'code_issue', title: 'The old check was dropped',
      receipts: [{ role: 'commentary', eventId: 'C2', quote: 'I dropped the old check' }] }],
    pivots: [{ abandoned: 'plan a', adopted: 'plan b', receipts: [{ role: 'commentary', eventId: 'P2', quote: 'Switching to plan b' }] }] };
  const story = renderSessionStory(b.session(), report);
  const { chart, designed } = overviewOf(story);
  // Story /14: the three windows review one request, so they are one step, with its two side nodes; the change of
  // approach is counted on it.
  assert.deepEqual([...chart.nodes.keys()], ['A1', 'S1', 'H1', 'F1']);
  assert.match(chart.nodes.get('S1').label, / · 1 change of approach$/);
  assert.ok(designed.width <= 3);
  assert.equal(chart.edges.filter((e) => e.from === 'H1').length, 0, 'no node follows the one step');
});

test('M33 S5 a helper result merged later is named on the helper node, never drawn as an edge', () => {
  const b = sessionBuilder();
  // Story /14: a step is one of your requests, so the later windows are requests of their own; the result merges in step 3.
  b.ask('I1', 'Delegate.');
  b.delegate('D1', 'do the thing', 'k1');
  b.change('child:k1:W', 'x.js', { after: 'x\n', childId: 'k1' });
  b.ask('I2', 'Read a.');
  b.run('Z', 'cat a.js', 'succeeded');
  b.ask('I3', 'Write y.');
  b.change('W3', 'y.js', { after: 'y\n' });
  b.events.push({ id: 'D1-r', sequence: b.events.length, kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal',
    result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
  const story = renderSessionStory(b.session(), { windowResults: [
    { windowIndex: 0, eventIds: ['I1', 'D1', 'child:k1:W', 'child:k1:W-r'], failure: null },
    { windowIndex: 1, eventIds: ['I2', 'Z', 'Z-r'], failure: null },
    { windowIndex: 2, eventIds: ['I3', 'W3', 'W3-r', 'D1-r'], failure: null }] });
  const overview = overviewOf(story).chart;
  const [helper] = [...overview.nodes.values()].filter((node) => overview.classes.get(node.id) === 'helper');
  assert.equal(helper.label, '1 helper: do the thing · merged at step 3');
  assert.deepEqual(overview.edges.filter((e) => e.from === helper.id).map((e) => e.to), [overview.edges.find((e) => e.from === 'S1'
    && overview.classes.get(e.to) !== 'helper').to], 'its one back edge goes into the next node of the chain (the next request)');
  // In request 1's own step chart the helper hangs beside the one step, with no next node to return into.
  const [first, ...rest] = stepChartsOf(story);
  const own = [...first.chart.nodes.values()].find((node) => first.chart.classes.get(node.id) === 'helper');
  assert.equal(own.label, '1 helper: do the thing · merged at step 3');
  assert.equal(first.chart.edges.filter((e) => e.from === own.id).length, 0);
  for (const { chart } of rest) assert.equal([...chart.nodes.values()].some((node) => chart.classes.get(node.id) === 'helper'), false);
});

test('M33 S5 a request whose step chart does not fit is counted, never cut silently', () => {
  // Story /14: the one-request session is one step and fits 20 KB whole; the ten-request session does not: the step
  // charts that do not fit are counted, never cut silently.
  const { session, report } = helpersSession();
  const small = renderSessionStory(session, report, { maxBytes: STORY_LIMITS.minBytes });
  assert.ok(Buffer.byteLength(small) <= STORY_LIMITS.minBytes);
  assert.equal(mermaidBlocks(small).length, 2, 'the overview and the one request\'s chart');
  assert.doesNotMatch(small, /are not shown/);
  const many = manyRequestSession();
  const tight = renderSessionStory(many.session, many.report, { maxBytes: STORY_LIMITS.minBytes });
  assert.ok(Buffer.byteLength(tight) <= STORY_LIMITS.minBytes);
  const shown = mermaidBlocks(tight).length - 1;
  assert.ok(shown >= 1 && shown < MANY_ASK_STEPS.length, `${shown} step charts shown`);
  assert.ok(tight.includes(`_To keep this file short, the step charts of ${MANY_ASK_STEPS.length - shown} requests are not shown._`));
  const { chart } = overviewOf(tight);
  assert.ok(chart.nodes.size <= STORY_LIMITS.overviewNodes);
  assert.ok(tight.includes(`${STORY_SENTENCES.overviewSimplified} ${COUNTED}`));
});

test('M33 S5 review: counts on a label are never cut; the head and tail take shorter words first', () => {
  // One step with twelve contradicted statements, three changes of approach, a finding and a helper: the review saw
  // "Step 102 · 12 statements contradicted · 3 changes of approa…".
  // Story /14: a step is one of your requests, so each window here is asked for in a request of its own.
  const b = sessionBuilder();
  b.ask('I1', 'Go.');
  b.run('R1', 'cat src/a.js', 'succeeded', 'x');
  const windows = [b.events.map((e) => e.id)];
  const before = b.events.length;
  b.ask('I2', 'Write the notes.');
  b.change('W2', 'src/a.js', { after: 'a\n' });
  for (let i = 0; i < 12; i++) b.change(`O${i}`, `/tmp/notes-${i}.md`, { after: `Claim ${i} holds.\n`, outside: true });
  for (let i = 0; i < 3; i++) b.say(`P${i}`, `Switching to plan ${i}.`);
  b.say('C2', 'I dropped the old check.');
  b.delegate('D2', 'Look at the old check', 'k2');
  windows.push(b.events.slice(before).map((e) => e.id));
  const after = b.events.length;
  b.ask('I3', 'Read b.');
  b.run('R3', 'cat src/b.js', 'succeeded', 'x');
  windows.push(b.events.slice(after).map((e) => e.id));
  const report = { windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })),
    findings: [{ status: 'DECIDE', kind: 'code_issue', title: 'The old check was dropped',
      receipts: [{ role: 'commentary', eventId: 'C2', quote: 'I dropped the old check' }] }],
    pivots: [0, 1, 2].map((i) => ({ abandoned: `plan ${i - 1}`, adopted: `plan ${i}`,
      receipts: [{ role: 'commentary', eventId: `P${i}`, quote: `Switching to plan ${i}` }] })),
    writtenClaims: Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, text: `Claim ${i} holds`, label: 'contradicted',
      stated: { role: 'code', eventId: `O${i}`, quote: `Claim ${i} holds` }, receipts: [] })) };
  const story = renderSessionStory(b.session(), report);
  const { chart, designed } = overviewOf(story);
  const label = chart.nodes.get('S2').label;
  assert.equal(label, 'Step 2 · 12 contradicted · wrote 1 file · 3 approach changes');
  assert.ok(designed.width <= STORY_LIMITS.overviewWidth);
  assert.deepEqual(accounted(chart), { findings: 1, pivots: 3, helpers: 1 });
});

test('M33 S5 review: a phase that wrote a file outside the repository is not drawn as reading', () => {
  const b = sessionBuilder();
  const windows = [];
  const step = (add) => { const at = b.events.length; add(); windows.push(b.events.slice(at).map((e) => e.id)); };
  // Story /14: a step is one of your requests, so each window here is asked for in a request of its own.
  step(() => { b.ask('I1', 'Read a.'); b.run('R1', 'cat src/a.js', 'succeeded', 'x'); });
  step(() => { b.ask('I2', 'Change a.'); b.change('W2', 'src/a.js', { after: 'a\n' }); });
  step(() => { b.ask('I3', 'Write the PR body.'); b.change('O3', '/tmp/pr-body.md', { after: 'Body.\n', outside: true }); });
  const story = renderSessionStory(b.session(), { windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })) });
  const { chart } = overviewOf(story);
  assert.equal(chart.classes.get('S1'), 'quiet', 'reading only: dashed');
  assert.equal(chart.nodes.get('S3').label, 'Step 3 · changed 1 file outside the repository');
  assert.equal(chart.classes.get('S3'), 'step', 'a write outside the repository is no reading');
});

test('M33 S5 review: steps before the first request have no step chart, and the sentence under the overview says so', () => {
  const b = sessionBuilder();
  b.run('R0', 'cat src/a.js', 'succeeded', 'x');
  const windows = [b.events.map((e) => e.id)];
  const at = b.events.length;
  b.ask('I1', 'Go.');
  b.change('W1', 'src/a.js', { after: 'a\n' });
  windows.push(b.events.slice(at).map((e) => e.id));
  const story = renderSessionStory(b.session(), { windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds, failure: null })) });
  assert.equal(stepChartsOf(story).length, 1);
  assert.ok(story.includes(`${STORY_SENTENCES.phaseLegend} ${STORY_SENTENCES.stepChartsSome}\n`));
  // With every step under a request whose chart is shown, it says every step is charted.
  assert.ok(HELPERS_STORY.includes(`${STORY_SENTENCES.stepChartsAll}\n`));
});

test('M33 S5 a long step title is clipped in a step chart node, never its line counts', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Go.');
  b.change('W1', `${'deeply/'.repeat(12)}nested.js`, { after: 'x\n' });
  for (let i = 0; i < 12; i++) b.run(`R${i}`, `cat ${'deeply/'.repeat(12)}f${i}.js`, 'succeeded');
  b.run('T', 'npm test', 'failed');
  const story = renderSessionStory(b.session(), { windowResults: [{ windowIndex: 0, eventIds: b.events.map((e) => e.id), failure: null }] });
  const [{ chart }] = stepChartsOf(story);
  assert.match(chart.nodes.get('S1').label, / · files \+1 −0$/);
  assert.ok([...chart.nodes.get('S1').label].length <= STORY_LIMITS.chartLabelChars);
});
