// M33 S: the session story. A GitHub-ready Markdown account of one recorded session, rendered from the
// redacted Session and a finished review report only. Every session and report here is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderSessionStory, diffLines, mermaidLabel, clipPath, commandFacts, failedCommandText, STORY_LIMITS, STORY_CHART_COLLAPSES,
  STORY_OVERVIEW_COLLAPSES, STORY_SENTENCES, STORY_REVIEW_WORDS, STORY_WHO_DECIDED, STORY_MATERIALITY_WORDS } from '../session-story.js';
import { sessionBuilder, storySession, storyReport, STORY_KEY, TEXT } from './session-story-fixture.js';
import { redisPivotSession, redisPivotPr, REDIS_PIVOT_TEXT } from '../../evidence/fixtures/redis-pivot.js';
import { DECISION_CANDIDATES, FINDING_CANDIDATES } from '../../evidence/fixtures/redis-pivot-candidates.js';
import { buildLedger, honestStatuses, PUBLIC_STATUSES } from '../../evidence/src/ledger.js';
import { planWindows } from '../../evidence/src/windows.js';

const SNAPSHOT = new URL('./snapshots/session-story.md', import.meta.url);

/** Every Mermaid block of a story, as its lines: the overview first, then each request's step chart (M33 S5). */
function mermaidBlocks(story) {
  const blocks = [];
  for (let at = 0; ;) {
    const start = story.indexOf('```mermaid\n', at);
    if (start === -1) return blocks;
    const end = story.indexOf('\n```\n', start);
    blocks.push(story.slice(start + '```mermaid\n'.length, end).split('\n'));
    at = end;
  }
}
/** The overview's lines ("What happened"). */
const chartLines = (story) => { const [overview] = mermaidBlocks(story); assert.ok(overview, 'the story carries an overview'); return overview; };
/** Every step chart's lines, as one text. */
const stepChartText = (story) => mermaidBlocks(story).slice(1).map((lines) => lines.join('\n')).join('\n');
const NODE = /^\s*([A-Za-z][A-Za-z0-9_]*)(\(\["|\{\{"|\{"|>"|\[\["|\[")(.*?)("\]\)|"\}\}|"\}|"\]\]|"\])$/;
const EDGE = /^\s*([A-Za-z][A-Za-z0-9_]*) (-->|---|-\.->|-\.->\|[a-z0-9 ,]+ not charted\|) ([A-Za-z][A-Za-z0-9_]*)$/;
const nodesOf = (lines) => lines.filter((line) => NODE.test(line)).length;
const sentence = (reasons) => `${STORY_SENTENCES.chartSimplified} ${reasons.join('; ')}.`;

/** Every line of every chart is a node, an edge or a class line (no helper lane); every label is safe and within 60
 *  characters; the overview has at most 60 nodes (it aims at 30, and has more only to keep every request and every
 *  step with a finding or a contradicted statement), a step chart at most 40. Returns the ids of all charts. */
function assertChartSafe(story) {
  const all = new Set();
  const edges = [];
  mermaidBlocks(story).forEach((lines, b) => {
    assert.equal(lines[0], 'flowchart TD');
    const ids = new Set();
    for (const line of lines.slice(1)) {
      if (/^\s*(classDef|class) /.test(line)) continue;
      const node = line.match(NODE);
      if (node) {
        const [, id, , label] = node;
        assert.equal(ids.has(id), false, `node id ${id} is unique`);
        ids.add(id);
        all.add(id);
        assert.doesNotMatch(label, /["`[\]{}<>|;&\\\n\r]/, `label is Mermaid-safe: ${label}`);
        assert.ok(label.length > 0 && [...label].length <= STORY_LIMITS.chartLabelChars, `label within 60: ${label}`);
        continue;
      }
      const edge = line.match(EDGE);
      assert.ok(edge, `every chart line is a known form: ${line}`);
      assert.ok(ids.has(edge[1]) || lines.some((l) => l.match(NODE)?.[1] === edge[1]), `edge ${edge[1]} is declared`);
      edges.push([edge[1], edge[3], lines]);
    }
    assert.ok(ids.size <= (b ? STORY_LIMITS.stepChartNodes : STORY_LIMITS.overviewMaxNodes), `chart ${b}: ${ids.size} nodes`);
    if (!b && ids.size > STORY_LIMITS.overviewNodes) assert.ok(story.includes(STORY_SENTENCES.overviewPast)
      || story.includes(STORY_SENTENCES.overviewOver), 'an overview past its target says why');
  });
  for (const [from, to, lines] of edges) {
    const declared = new Set(lines.map((line) => line.match(NODE)?.[1]).filter(Boolean));
    assert.ok(declared.has(from) && declared.has(to), `edge ${from} -> ${to} joins declared nodes`);
  }
  return { ids: all, edges };
}

/** A session of `count` windows built by `each(b, i)`; the report holds one window per call. */
function builtStory(count, each, { report = {}, adapter = 'claude' } = {}) {
  const b = sessionBuilder();
  const windows = [];
  for (let i = 0; i < count; i++) {
    const before = b.events.length;
    each(b, i);
    windows.push(b.events.slice(before).map((e) => e.id));
  }
  return { session: b.session(adapter), report: { windowResults: windows.map((eventIds, windowIndex) =>
    ({ windowIndex, eventIds, failure: null })), sessionStatus: 'NO_FINDINGS', ...report } };
}
/** A decision the ledger derived a column for (`columnState` grounded), as a report holds it. */
const decided = (fields) => ({ columnState: 'grounded', materiality: 'material', ...fields });
const filesLine = (story, n = 1) => story.split(`<a name="step-${n}"></a>`)[1].split('\n').find((line) => line.startsWith('Files: '));

test('M33 S the synthetic story renders exactly its snapshot', () => {
  const story = renderSessionStory(storySession(), storyReport());
  assert.equal(story, readFileSync(SNAPSHOT, 'utf8'));
});

test('M33 S the same inputs give the same bytes, run after run', () => {
  const first = renderSessionStory(storySession(), storyReport());
  const second = renderSessionStory(storySession(), storyReport());
  assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(second)), 0);
  // A report read back from its JSON renders the same bytes as the object it was written from.
  const reread = renderSessionStory(storySession(), JSON.parse(JSON.stringify(storyReport())));
  assert.equal(reread, first);
});

test('M33 S the document is laid out in the owner-approved order', () => {
  const story = renderSessionStory(storySession(), storyReport());
  // Story /14 (D77 C): the fixture's seven review windows review two requests, so the story has two steps.
  const order = ['# Add rate limiting', 'Claude Code recording · 2 asks · 2 steps · 2 helper agents · 7 commands',
    STORY_SENTENCES.countLegend,
    // D71 (a): what you asked for first, then where to look; the review's own run state, never a session status.
    '| Requests addressed | Findings | Decided without asking | Changes of approach | Review |',
    '| 0 of 2 requests fully addressed · 2 partly addressed | 2 | 1 | 1 | did not complete · 1 of 2 steps not reviewed |',
    'Read as: [Product](#for-product) · [Lead](#for-leads) · [Engineer](#for-engineers)',
    // D88 (story /25): the page's order — the agent's judgment first, then your requests, what the agent told you (its
    // contradicted claim, a finding), the edits against what you said (a finding), and what Sonah could not check, under
    // its own heading, folded; then what happened and the engineer section. D71 (a): a finding is never under a status's
    // heading. (A report from before the checklist has no failure rows, so no failures section.)
    '## <a name="for-leads"></a>For leads: decisions and changes of approach',
    '## <a name="for-product"></a>For product: your requests', '## What the agent told you', '**Finding**',
    '## Edits against what you said', '**Finding**', '## What Sonah could not check (2)', '<details>',
    '## What happened', '```mermaid',
    '## <a name="for-engineers"></a>For engineers: step by step', '_Generated by Sonah from a redacted recording; review before sharing._'];
  let at = -1;
  for (const part of order) {
    const next = story.indexOf(part, at + 1);
    assert.ok(next > at, `${part} comes next`);
    at = next;
  }
  assert.ok(story.endsWith('_Generated by Sonah from a redacted recording; review before sharing._\n'));
  assert.doesNotMatch(story, /could go wrong/i, 'no "what could go wrong" section');
  assert.doesNotMatch(story, /Needs your decision|Worth a look|needs your decision|worth a look|Session status/);
  // Every step has one anchor, and every step link points at one.
  for (let n = 1; n <= 2; n++) assert.equal(story.split(`<a name="step-${n}"></a>`).length, 2, `step ${n} anchor`);
  assert.equal(story.includes('<a name="step-3"></a>'), false);
  for (const [, n] of story.matchAll(/\(#step-(\d+)\)/g)) assert.ok(Number(n) >= 1 && Number(n) <= 2);
});

test('M33 S the title is the option, else the first human ask clipped to 80', () => {
  const story = renderSessionStory(storySession(), storyReport(), { title: 'Rate limiting | "the story"' });
  assert.ok(story.startsWith('# Rate limiting \\| "the story"\n'));
  const fallback = renderSessionStory(storySession(), storyReport());
  const [first] = fallback.split('\n');
  assert.equal([...first.slice(2)].length, 80);
  assert.ok(first.endsWith('…'));
});

test('M33 S the finding receipts are the recorded quotes, grounded again in this session', () => {
  const story = renderSessionStory(storySession(), storyReport());
  assert.match(story, /\*\*Finding\*\* · \[step 2\]\(#step-2\) — The final message says all tests pass; the last test run failed\n> \*\*Agent said:\*\* All tests pass\n>\n> \*\*Recorded result:\*\* fail 1\n/);
  // A receipt whose quote is not in this recording is never shown; the sentence says so.
  const report = storyReport();
  report.findings[1].receipts = report.findings[1].receipts.map((r) => ({ ...r, quote: `${r.quote} (edited)` }));
  const edited = renderSessionStory(storySession(), report);
  assert.doesNotMatch(edited, /\(edited\)/);
  assert.match(edited, /\*\*Finding\*\* · \[step 2\]\(#step-2\) — The final message[^\n]*\n> _The recorded quotes for this finding were not found in this recording\._/);
  // A quote over 120 characters is clipped and marked.
  const long = storyReport();
  const b = sessionBuilder();
  b.ask('I1', 'Say it.');
  b.say('C1', `Done: ${'x'.repeat(200)}`, 'final');
  b.run('A1', 'npm test', 'failed', `fail ${'y'.repeat(200)}`);
  long.findings = [{ status: 'DECIDE', kind: 'claim_contradicted', title: 'Long', receipts: [
    { role: 'commentary', eventId: 'C1', quote: `Done: ${'x'.repeat(200)}`, sessionKey: STORY_KEY },
    { role: 'observation', eventId: 'A1-r', quote: `fail ${'y'.repeat(200)}`, sessionKey: STORY_KEY }] }];
  long.windowResults = [{ windowIndex: 0, eventIds: ['I1', 'C1', 'A1', 'A1-r'], failure: null }];
  const clipped = renderSessionStory(b.session(), long);
  const said = clipped.split('\n').find((line) => line.startsWith('> **Agent said:** '));
  assert.equal([...said.slice('> **Agent said:** '.length)].length, STORY_LIMITS.quoteChars);
  assert.ok(said.endsWith('…'));
});

test('M33 S hostile text becomes Mermaid-safe labels and escaped Markdown, with no live mention', () => {
  const hostile = 'He said "drop it"; use [x] {y} | z `rm -rf` <script>alert(1)</script> &amp; #35; \\n\nnext\u202Eline @octocat fixes #12';
  // Story /14 (D77 C): a step is one of your requests, so each window here is asked for in a request of its own.
  const { session, report } = builtStory(3, (b, i) => {
    b.ask(`I${i + 1}`, hostile);
    b.say(`C${i}`, hostile);
    b.change(`W${i}`, `src/${i}"[|]<x>;.js`, { after: 'a\nb\n' });
    if (i === 2) b.delegate('D2', hostile, 'h1');
  }, { report: {} });
  report.findings = [{ status: 'DECIDE', kind: 'claim_contradicted', title: hostile,
    receipts: [{ role: 'commentary', eventId: 'C0', quote: 'He said "drop it"; use [x]', sessionKey: STORY_KEY }] }];
  report.decisions = [decided({ dimension: hostile, chosen: hostile, actions: ['W1'], column: 'unasked' }),
    decided({ dimension: hostile, chosen: hostile, actions: ['W1'], column: 'asked-settled', materiality: 'cosmetic' })];
  report.pivots = [{ abandoned: hostile, adopted: hostile, receipts: [{ role: 'commentary', eventId: 'C1', quote: 'use [x]' }] }];
  report.requirements = [{ instruction: { role: 'instruction', eventId: 'I1', quote: 'He said' }, text: hostile, status: 'open' }];
  const story = renderSessionStory(session, report, { title: hostile });
  const { ids } = assertChartSafe(story);
  // The overview draws the request, its phases, the finding, the change of approach and the helper; the step chart
  // every step, the finding, both decisions and the helper beside the step that spawned it.
  for (const id of ['A1', 'S1', 'S2', 'S3', 'F1', 'P2', 'H3', 'F1_1', 'U2', 'K2']) assert.ok(ids.has(id), `${id} drawn`);
  // Outside the chart, markup is escaped, never live.
  assert.doesNotMatch(story, /<script>/);
  assert.doesNotMatch(story, /\u202E/, 'a bidi override is shown as its code point');
  assert.match(story, /‹U\+202E›/);
  assert.match(story, /\\<script\\>/);
  // Pasted into a PR, recorded text never mentions a GitHub user or references an issue.
  const prose = story.replace(/```mermaid[\s\S]*?```/, '');
  assert.doesNotMatch(prose, /@octocat/);
  assert.doesNotMatch(prose, /#12\b/);
  assert.match(prose, /@<!-- -->octocat fixes \\#<!-- -->12/);
  // Table cells escape their pipes.
  const row = story.split('\n').find((line) => line.startsWith('| [2](#step-2) |'));
  assert.equal(row.split(/(?<!\\)\|/).length, 5, 'a decision row keeps exactly three cells');
  assert.equal(mermaidLabel('a\nb "c" [d] |e| `f` <g> ;h &i \\j'), "a b 'c' (d) /e/ 'f' (g) ,h +i /j");
  assert.equal(mermaidLabel('   '), '-');
});

test('M33 S, D77 C: the quiet windows of one request are one step, and the chain breaks only where a request starts', () => {
  // Eight review windows that only ran commands, two requests (at windows 0 and 5). Story /14: a step is one of your
  // requests, so the eight windows are two steps — nothing is left to fold inside a request — each the one node under
  // its request in the overview and the one node of its request's step chart.
  const { session, report } = builtStory(8, (b, i) => {
    if (i === 0 || i === 5) b.ask(`I${i}`, `Request ${i}`);
    b.run(`R${i}`, `echo ${i}`, 'succeeded', 'ok');
    if (i === 3) b.run(`R${i}b`, 'ls', 'succeeded', 'ok');
  });
  const story = renderSessionStory(session, report);
  assertChartSafe(story);
  const chart = chartLines(story).join('\n');
  assert.match(chart, /S1\["Step 1 · ran 6 commands"\]/);
  assert.match(chart, /S2\["Step 2 · ran 3 commands"\]/);
  assert.match(chart, /A1 --> S1\n\s*S1 --> A2\n\s*A2 --> S2/);
  assert.match(stepChartText(story), /S1\["1 · Ran 6 commands"\][\s\S]*S2\["2 · Ran 3 commands"\]/);
  assert.doesNotMatch(story, /simplified to stay within/, 'nothing needed simplifying');
  // The engineer section: each request's heading, its step chart folded (M33 S5), then its one quiet step on one line.
  assert.match(story, /\n<a name="step-1"><\/a>\*\*Step 1\*\* · 6 commands · no changes\n\n### You: Request 5\n\n<details>\n<summary>Show the step chart \(step 2\)<\/summary>\n[^]*?<\/details>\n\n<a name="step-2"><\/a>\*\*Step 2\*\* · 3 commands · no changes\n/);
  assert.doesNotMatch(story, /#### <a name="step-/, 'no quiet step keeps a block of its own');
  assert.match(story, /· 2 asks · 2 steps · /);
});

test('M33 S5 a step chart aims at 40 nodes, and says which simplifications took nodes away', () => {
  // Story /14 (D77 C): a request is one step, so its step chart is one step node and what hangs off it; only its findings
  // can take it past 40. One request over 45 windows, each changing a file a finding cites, with an unasked and a settled
  // decision: 48 nodes, 47 without the settled one, 46 without the decision made without asking, 2 once the findings are
  // one node. (D78: the levels that grouped steps — helper-only steps, plain steps — are removed: one step, nothing to
  // group.)
  const settled = builtStory(45, (b, i) => { if (!i) b.ask('I0', 'Go.'); b.change(`W${i}`, `f${i}.js`, { after: 'x\n' }); });
  settled.report.findings = Array.from({ length: 45 }, (_, i) => ({ status: 'FYI', kind: 'code_issue', title: `Finding ${i}`,
    receipts: [{ role: 'action', eventId: `W${i}`, quote: `f${i}.js`, sessionKey: STORY_KEY }] }));
  settled.report.decisions = [decided({ dimension: 'd', chosen: 'c', actions: ['W0'], column: 'unasked' }),
    decided({ dimension: 's', chosen: 'c', actions: ['W1'], column: 'asked-settled' })];
  const one = renderSessionStory(settled.session, settled.report);
  assertChartSafe(one);
  const [, steps] = mermaidBlocks(one);
  assert.ok(nodesOf(steps) <= STORY_LIMITS.stepChartNodes, `${nodesOf(steps)} nodes`);
  assert.match(steps.join('\n'), /F1_all\["45 findings"\]/);
  assert.ok(one.includes(sentence([STORY_CHART_COLLAPSES[1], STORY_CHART_COLLAPSES[2], STORY_CHART_COLLAPSES[3]])));
  // The overview of the same session is one request and one phase, its findings one node beside it.
  assert.deepEqual(chartLines(one).filter((line) => NODE.test(line)).map((line) => line.match(NODE)[1]), ['A1', 'S1', 'F1']);
  assert.match(chartLines(one).join('\n'), /F1\["45 findings"\]/);
});

test('M33 S the step chart keeps each finding a node of its own while room allows, and counts the decisions made without asking', () => {
  // Story /14 (D77 C): 118 windows that only spawn a helper and one that changes a file are one request's one step, with
  // two findings and two unasked decisions: nothing to group, the findings stay one node each, the decisions one node.
  const { session, report } = builtStory(119, (b, i) => {
    if (!i) b.ask('I0', 'Go.');
    if (i === 118) { b.change('W', 'src/x.js', { after: 'x\n' }); b.say('C', 'I changed x and y here.'); }
    else b.delegate(`D${i}`, `brief ${i}`, `h${i}`);
  });
  report.findings = [1, 2].map((k) => ({ status: 'FYI', kind: 'code_issue', title: `Finding ${k}`,
    receipts: [{ role: 'commentary', eventId: 'C', quote: 'I changed x and y', sessionKey: STORY_KEY }] }));
  report.decisions = [1, 2].map((k) => decided({ dimension: `d${k}`, chosen: 'c', actions: ['W'], column: 'unasked' }));
  const story = renderSessionStory(session, report);
  const { ids } = assertChartSafe(story);
  for (const id of ['F1_1', 'F1_2']) assert.ok(ids.has(id), `${id} drawn on its own`);
  assert.equal(ids.has('F1_all'), false);
  // A step's decisions made without asking are always one node, with their count; its 118 helpers one node.
  assert.match(stepChartText(story), /U1\{\{"2 decisions made without asking"\}\}/);
  assert.match(stepChartText(story), /H1\[\["118 helpers: brief 0 \/ brief 1 \/ brief 2/);
  assert.doesNotMatch(story, /simplified to stay within/);
  // The overview: the request, its one step, its findings one node beside it.
  assert.match(chartLines(story).join('\n'), /F1\["2 findings"\]/);
});

test('M33 S at the hard stop the chart keeps requests and findings first, and counts what it left out', () => {
  // 150 steps, each changing a file with an unasked decision; 20 of them hold a finding; a second request
  // starts at step 146. Nothing groups, so the chart must choose.
  // Story /14 (D77 C): a step is one of your requests, so each of the 150 windows is asked for in a request of its own.
  const findingSteps = Array.from({ length: 20 }, (_, k) => 7 * (k + 1));
  const { session, report } = builtStory(150, (b, i) => {
    b.ask(`I${i}`, i === 0 ? 'Go.' : i === 145 ? 'Then finish.' : `Request ${i}.`);
    b.change(`W${i}`, `f${i}.js`, { after: 'x\n' });
  });
  report.decisions = Array.from({ length: 150 }, (_, i) =>
    decided({ dimension: `d${i}`, chosen: 'c', actions: [`W${i}`], column: 'unasked' }));
  report.findings = findingSteps.map((n) => ({ status: 'FYI', kind: 'code_issue', title: `Finding at ${n}`,
    receipts: [{ role: 'action', eventId: `W${n - 1}`, quote: `f${n - 1}.js`, sessionKey: STORY_KEY }] }));
  const story = renderSessionStory(session, report);
  assertChartSafe(story);
  // 150 requests, each one step, cannot all be drawn within 60 nodes: the hard stop keeps requests first (M33 S5 review),
  // in chain order, and counts everything it left out — every step and every finding — on the dashed edges between
  // them and on its end node, so no finding is dropped without a count.
  const overview = chartLines(story).join('\n');
  assert.match(overview, /^\s*A1\(\["You: Go\."\]\)$/m);
  const overviewNodes = nodesOf(chartLines(story));
  assert.ok(overviewNodes > STORY_LIMITS.overviewNodes && overviewNodes <= STORY_LIMITS.overviewMaxNodes, `${overviewNodes} nodes`);
  const requestsDrawn = chartLines(story).filter((line) => /^\s*A\d+\(\["/.test(line)).length;
  assert.ok(requestsDrawn >= 50 && requestsDrawn < 150, `${requestsDrawn} requests drawn`);
  assert.match(overview, /^\s*A1 -\.->\|1 step not charted\| A2$/m, 'the step between two requests is counted on their edge');
  assert.match(overview, /^\s*A7 -\.->\|1 step, 1 finding not charted\| A8$/m, 'and a finding with it');
  const counted = (pattern) => [...overview.matchAll(pattern)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(counted(/(\d+) findings? not charted/g), findingSteps.length, 'every finding is counted');
  assert.equal(counted(/(\d+) steps?(?:,| not charted)/g), 150, 'every step is counted');
  assert.match(overview, /MORE\["… \d+ steps, \d+ requests, \d+ findings not charted"\]/);
  assert.ok(story.includes(`${STORY_SENTENCES.overviewPast} `));
  assert.ok(story.includes(`${STORY_OVERVIEW_COLLAPSES[STORY_OVERVIEW_COLLAPSES.length - 1]}.`));
  // Each request's step chart is one step with its finding and its decision, well within 40 nodes.
  const [, first] = mermaidBlocks(story);
  assert.ok(nodesOf(first) <= STORY_LIMITS.stepChartNodes);
  assert.match(first.join('\n'), /S1\["1 · Wrote 1 file · files \+1 −0"\]/);
  for (const n of [1, 150]) assert.match(story, new RegExp(`<a name="step-${n}"></a>Step ${n} — `), 'every step is still listed');
});

test('M33 S the snippet is the change a finding or decision cites, else the largest change', () => {
  const big = Array.from({ length: 20 }, (_, i) => `big line ${i}`).join('\n');
  const make = () => builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'src/big.js', { after: big });
    b.change('W2', 'src/small.js', { after: 'small one\nsmall two\n' });
  });
  const snippetPath = (story) => story.match(/<summary>Snippet: <code>([^<]+)<\/code>/)?.[1];
  const plain = make();
  const largest = renderSessionStory(plain.session, plain.report);
  assert.equal(snippetPath(largest), 'src/big.js');
  assert.match(largest, /<details>\n<summary>Snippet: <code>src\/big\.js<\/code> · \+20 −0 · first 12 of 20 lines<\/summary>/);
  assert.equal(largest.split('\n').filter((line) => /^\+big line/.test(line)).length, STORY_LIMITS.snippetLines);
  // An unasked decision citing the small change wins, and opens the snippet.
  const unasked = make();
  unasked.report.decisions = [decided({ dimension: 'd', chosen: 'c', actions: ['W2'], column: 'unasked' })];
  const cited = renderSessionStory(unasked.session, unasked.report);
  assert.equal(snippetPath(cited), 'src/small.js');
  assert.match(cited, /<details open>\n<summary>Snippet: <code>src\/small\.js/);
  // A settled decision cites too, but its snippet stays closed.
  const settled = make();
  settled.report.decisions = [decided({ dimension: 'd', chosen: 'c', actions: ['W2'], column: 'asked-settled' })];
  assert.match(renderSessionStory(settled.session, settled.report), /<details>\n<summary>Snippet: <code>src\/small\.js/);
  // So does a decision the review could not check: it is only possibly made without asking.
  const possible = make();
  possible.report.decisions = [{ dimension: 'd', chosen: 'c', actions: ['W2'], column: null, columnState: 'unchecked', materiality: 'material' }];
  assert.match(renderSessionStory(possible.session, possible.report), /<details>\n<summary>Snippet: <code>src\/small\.js/);
  // A finding's code receipt beats a decision, and picks the hunk holding its quote; the summary says which.
  const before = Array.from({ length: 40 }, (_, i) => `line ${i}`);
  const after = before.map((line, i) => (i === 3 ? 'first change' : i === 35 ? 'second change' : line));
  const hunks = builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'src/two.js', { operation: 'write', after: after.join('\n'), before: before.join('\n') });
    b.change('W2', 'src/small.js', { after: 'small one\n' });
  });
  hunks.report.decisions = [decided({ dimension: 'd', chosen: 'c', actions: ['W2'], column: 'unasked' })];
  hunks.report.findings = [{ status: 'FYI', kind: 'code_issue', title: 'Second change',
    receipts: [{ role: 'code', eventId: 'W1', quote: 'second change', sessionKey: STORY_KEY }] }];
  const story = renderSessionStory(hunks.session, hunks.report);
  assert.equal(snippetPath(story), 'src/two.js');
  assert.match(story, /<summary>Snippet: <code>src\/two\.js<\/code> · \+2 −2 · hunk 2 of 2<\/summary>/);
  const diff = story.slice(story.indexOf('```diff'), story.indexOf('```\n\n</details>', story.indexOf('```diff')));
  assert.deepEqual(diff.split('\n').slice(1, -1), [' line 33', ' line 34', '-line 35', '+second change', ' line 36', ' line 37']);
  // D79: a decision's value receipt the ledger kept without its value (`value_paraphrased`) picks the hunk holding its
  // quote as a grounded value's does; the same decision with the receipt dropped shows the change's first hunk.
  const paraphrased = builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'src/two.js', { operation: 'write', after: after.join('\n'), before: before.join('\n') });
  });
  const kept = { eventId: 'W1', role: 'code', field: 'added-code', quote: 'second change', sessionKey: STORY_KEY };
  paraphrased.report.decisions = [decided({ dimension: 'd', chosen: 'the second line changed', actions: ['W1'],
    column: 'unasked', value: null, valueState: 'unchecked', valueReceipt: kept,
    valueUnchecked: { cause: 'value_paraphrased', action: 'W1' }, reasons: ['value_unchecked'] })];
  assert.match(renderSessionStory(paraphrased.session, paraphrased.report),
    /<details open>\n<summary>Snippet: <code>src\/two\.js<\/code> · \+2 −2 · hunk 2 of 2<\/summary>/);
  paraphrased.report.decisions = [decided({ dimension: 'd', chosen: 'the second line changed', actions: ['W1'],
    column: 'unasked', value: null, valueState: 'unchecked', valueReceipt: null,
    valueUnchecked: { cause: 'unmatched', action: null }, reasons: ['value_unchecked'] })];
  assert.match(renderSessionStory(paraphrased.session, paraphrased.report),
    /<details open>\n<summary>Snippet: <code>src\/two\.js<\/code> · \+2 −2 · hunk 1 of 2<\/summary>/);
  // A cited change that changes no line (an identical rewrite) has no snippet: the largest change is shown.
  const same = builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'src/same.js', { after: 'same\n', before: 'same\n' });
    b.change('W2', 'src/other.js', { after: `${'o'.repeat(300)}\n` });
  });
  same.report.decisions = [decided({ dimension: 'd', chosen: 'c', actions: ['W1'], column: 'unasked' })];
  const fallback = renderSessionStory(same.session, same.report);
  assert.equal(snippetPath(fallback), 'src/other.js');
  // A snippet line is at most 160 characters, its diff marker included.
  const line = fallback.split('\n').find((l) => l.startsWith('+ooo'));
  assert.equal([...line].length, STORY_LIMITS.snippetLineChars);
  assert.ok(line.endsWith('…'));
});

test('M33 S line counts come from the recorded change bodies', () => {
  assert.deepEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']),
    { ops: [[' ', 'a'], ['-', 'b'], ['+', 'x'], [' ', 'c']], added: 1, removed: 1, exact: true });
  assert.deepEqual(diffLines([], ['a', 'b']), { ops: [['+', 'a'], ['+', 'b']], added: 2, removed: 0, exact: true });
  assert.deepEqual(diffLines(['a', 'b'], []), { ops: [['-', 'a'], ['-', 'b']], added: 0, removed: 2, exact: true });
  // Myers agrees with a plain LCS on seeded pseudo-random inputs.
  let seed = 7;
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed; };
  const lcs = (a, b) => {
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    return t[0][0];
  };
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: next() % 30 }, () => String.fromCharCode(97 + (next() % 5)));
    const b = Array.from({ length: next() % 30 }, () => String.fromCharCode(97 + (next() % 5)));
    const d = diffLines(a, b);
    const common = lcs(a, b);
    assert.equal(d.added, b.length - common);
    assert.equal(d.removed, a.length - common);
    assert.deepEqual(d.ops.filter((op) => op[0] !== '+').map((op) => op[1]), a, 'the script replays the old side');
    assert.deepEqual(d.ops.filter((op) => op[0] !== '-').map((op) => op[1]), b, 'and the new side');
  }
  // Past its work bound the diff stops, and falls back to lower-bound counts with no script.
  const wide = Array.from({ length: 400 }, (_, i) => `a${i}`), other = Array.from({ length: 400 }, (_, i) => `b${i}`);
  assert.deepEqual(diffLines(wide, other, { maxWork: 1000 }), { ops: null, added: 400, removed: 400, exact: false });
  // Through the renderer: create, delete, segment edit, whole-file-prior edit, replace-all, and no body.
  const { session, report } = builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'created.js', { after: 'one\ntwo\nthree\n' });
    b.change('W2', 'deleted.js', { operation: 'delete', before: 'x\ny\n' });
    b.change('W3', 'segment.js', { operation: 'edit', before: 'keep\nold\n', after: 'keep\nnew\nmore\n', priorState: 'edit-text' });
    b.change('W4', 'whole.js', { operation: 'edit', before: 'a\nb\nc\n', after: 'z\n' });
    b.change('W5', 'all.js', { operation: 'edit', before: 'p', after: 'q\nr', priorState: 'edit-text', extent: { replaceAll: true } });
    b.change('W6', 'shell.js', { after: '', extent: { recorded: false } });
    b.change('W7', 'failed.js', { after: 'never\n', result: 'failed' });
    // Two terminal receipts, one failed: the Session reads the outcome as unknown, so the write counts.
    b.change('W8', 'twice.js', { after: 'maybe\n' });
    b.events.push({ id: 'W8-r2', sequence: b.events.length, kind: 'observation', invocation: 'W8', callKey: 'W8',
      phase: 'terminal', result: 'failed', exitCode: 1, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
  });
  assert.equal(session.actionOutcomeOf('W7'), 'failed');
  assert.equal(session.actionOutcomeOf('W8'), 'unknown');
  const story = renderSessionStory(session, report);
  assert.equal(filesLine(story), 'Files: `created.js` +3 −0, `deleted.js` +0 −2, `segment.js` +2 −1, `whole.js` +1 −?, `all.js` +≥2 −≥1, `shell.js` +? −?, `twice.js` +1 −0');
  assert.doesNotMatch(story, /failed\.js/, 'a write the record says failed changed nothing');
  assert.match(story, /`\?` and `≥n` in line counts: the recording did not keep enough text/);
});

test('M33 S a rewrite is diffed against the body written before it, never counted as a create', () => {
  const v1 = 'one\ntwo\nthree\nfour\n', v2 = 'one\nTWO\nthree\nfour\n';
  const { session, report } = builtStory(2, (b, i) => {
    if (!i) {
      b.ask('I1', 'Write things twice.');
      b.change('W1', 'a.js', { after: v1 });                          // a create
      b.change('D1', 'gone.js', { operation: 'delete', before: 'old\n' });
      b.change('E1', 'edited.js', { after: 'e1\ne2\n' });
      b.change('E2', 'edited.js', { operation: 'edit', before: 'e1', after: 'E1', priorState: 'edit-text' });
      b.change('H1', 'shell.txt', { operation: 'edit', tool: 'heredoc', after: 'h1\nh2\n' });
      b.change('H2', 'expanded.txt', { operation: 'edit', tool: 'heredoc', after: 'x $HOME\n', extent: { expanded: true } });
    } else {
      b.ask('I2', 'Now write them again.');                           // story /14: the second window is a request of its own
      b.change('W2', 'a.js', { after: v2 });                          // the record keeps no prior: +1 −1
      b.change('W3', 'gone.js', { after: 'new\nfile\n' });            // after a delete: a create
      b.change('E3', 'edited.js', { after: 'x\n' });                  // after an edit: prior unknown
      b.change('H3', 'shell.txt', { operation: 'edit', tool: 'heredoc', after: 'h1\nh2\nh3\n' });   // after a heredoc body
      b.change('W4', 'cut.js', { after: 'c\n' });
      b.change('W5', 'cut.js', { after: 'c\nd\n', extent: { truncated: true } });
    }
  });
  const story = renderSessionStory(session, report);
  assert.equal(filesLine(story, 1), 'Files: `a.js` +4 −0, `gone.js` +0 −1, `edited.js` +3 −1, `shell.txt` +2 −?, `expanded.txt` +≥1 −?');
  // A rewrite of a body the recorder cut cannot be counted: the create before it is exact, the rewrite is not.
  assert.equal(filesLine(story, 2), 'Files: `a.js` +1 −1, `gone.js` +2 −0, `edited.js` +1 −?, `shell.txt` +1 −0, `cut.js` +≥1 −?');
  assert.match(story, /^Claude Code recording · 2 asks · 2 steps · .* · 6 files changed \(\+≥16 −≥3\)$/m);
});

test('M33 S redacted lines and CRLF line ends are counted honestly', () => {
  const { session, report } = builtStory(1, (b) => {
    b.ask('I1', 'Change things.');
    b.change('W1', 'dropped.js', { after: 'a\nb\n', extent: { redactedLines: 2 } });
    b.change('W2', 'prior.js', { operation: 'edit', before: 'k\nsecret\n', after: 'k\n', priorState: 'edit-text',
      beforeExtent: { redactedLines: 1 } });
    b.change('W3', 'crlf.js', { after: 'x\r\ny\r\nz\r\nw\r\nv\r\n', before: 'x\ny\n' });
  });
  const story = renderSessionStory(session, report);
  assert.equal(filesLine(story), 'Files: `dropped.js` +≥2 −0, `prior.js` +0 −≥1, `crlf.js` +3 −0');
  assert.match(story, /<summary>Snippet: <code>crlf\.js<\/code>/);
  const snippet = story.slice(story.indexOf('```diff'), story.indexOf('```\n\n</details>', story.indexOf('```diff')));
  assert.doesNotMatch(snippet, /\n\n/, 'no blank line is interleaved in a CRLF snippet');
});

test('M33 S writes outside the repository are counted, never shown', () => {
  const secret = Array.from({ length: 30 }, (_, i) => `private memory line ${i}`).join('\n');
  const outsidePath = 'Users/jdoe/.claude/projects/-Users-jdoe-acme/memory/feedback.md';
  const { session, report } = builtStory(2, (b, i) => {
    if (!i) {
      b.ask('I1', 'Fix the typo.');
      b.change('W1', 'src/a.js', { operation: 'edit', before: 'teh', after: 'the', priorState: 'edit-text' });
      b.change('M1', outsidePath, { after: secret, outside: true });
    } else {
      b.delegate('D1', 'Look around.', 'k1');
      b.change('child:k1:M', 'tmp/claude-1/scratchpad/notes.md', { after: 'scratch\n', outside: true, childId: 'k1' });
    }
  });
  const story = renderSessionStory(session, report);
  for (const hidden of [outsidePath, 'jdoe', 'private memory', 'scratchpad', 'scratch\n']) assert.equal(story.includes(hidden), false, hidden);
  // Story /14 (D77 C): both windows review the one request, so they are one step; the helper's write outside the
  // repository is counted in it beside the agent's own.
  assert.match(story, /^Claude Code recording · 1 ask · 1 step · 1 helper agent · 0 commands · 1 file changed \(\+1 −1\) · 2 files outside the repository, not shown$/m);
  assert.match(story, /Step 1 — Edited 1 file in src · spawned 1 helper\n\n0 commands · files \+1 −1 · helpers 1 · 2 files outside the repository, not shown/);
  assert.equal(filesLine(story), 'Files: `src/a.js` +1 −1');
  assert.match(story, /<summary>Snippet: <code>src\/a\.js<\/code> · \+1 −1<\/summary>/);
  assert.match(chartLines(story).join('\n'), /H1\[\["1 helper: Look around\."\]\]/);
});

test('M33 S, M1 step titles are facts: files, failed commands, reads, helpers, installs — never a runner name', () => {
  const { session, report } = builtStory(5, (b, i) => {
    if (!i) {
      b.ask('I1', 'Go.');
      for (const f of ['a', 'b', 'c']) b.change(`E${f}`, `src/middleware/${f}.js`, { operation: 'edit', before: 'x', after: 'y', priorState: 'edit-text' });
      b.run('T1', 'npm test', 'failed');
      b.run('T2', 'npx vitest run', 'failed');
      b.run('T3', 'node --test-concurrency=1 --test packages', 'succeeded');
      b.run('T4', 'cat jest.config.js', 'succeeded');
    }
    // Story /14 (D77 C): a step is one of your requests, so each window here is asked for in a request of its own.
    if (i === 1) { b.ask('I2', 'Read around.'); for (let r = 0; r < 12; r++) b.read(`R${r}`, `src/r${r}.js`); }
    if (i === 2) { b.ask('I3', 'Delegate.'); b.delegate('D1', 'one', 'h1'); b.delegate('D2', 'two', null); }
    if (i === 3) { b.ask('I4', 'Echo.'); for (let r = 0; r < 5; r++) b.run(`C${r}`, `echo ${r}`, 'succeeded'); }
    if (i === 4) {
      b.ask('I5', 'Install the runners.');
      b.run('P1', 'pip install pytest', 'succeeded');
      b.run('P2', 'npm install --save-dev jest vitest', 'succeeded');
    }
  });
  const story = renderSessionStory(session, report);
  assert.match(story, /Step 1 — Edited 3 files in src\/middleware · 2 commands failed · read 1 file\n/);
  // Quiet steps fold into one line each run; a run's line names what its commands did.
  assert.match(story, /<a name="step-2"><\/a>\*\*Step 2\*\* · read 12 files in src · 0 commands · no changes\n/);
  assert.match(story, /Step 3 — Spawned 2 helpers\n/);
  assert.match(story, /<a name="step-4"><\/a>\*\*Step 4\*\* · 5 commands · no changes\n/);
  assert.match(story, /<a name="step-5"><\/a>\*\*Step 5\*\* · installed packages · 2 commands · no changes\n/,
    'installing packages is said as such');
  assert.match(stepChartText(story), /S4\["4 · Ran 5 commands"\]/, 'the bare count, only when nothing else applies');
  assert.match(chartLines(story).join('\n'), /S3\["Step 3 · spawned 2 helpers"\]/, 'a phase that only spawned helpers says so');
  // M1: every failed command, counted on one line when there are several, their recorded words folded (M33 S3); a
  // passing runner command is no title word and no bullet.
  assert.match(story, /- Failed: 2 commands\n\n<details>\n<summary>Show the failed commands<\/summary>\n\n- `npm test` \(exit 1\)\n- `npx vitest run` \(exit 1\)\n\n<\/details>\n/);
  assert.doesNotMatch(story, /ran tests|Tests:/, 'no runner-name phrase');
  for (const command of ['npm test', 'pytest -q', './gradlew test', 'cat jest.config.js', 'pip install pytest'])
    assert.equal(Object.hasOwn(commandFacts(command), 'test'), false, `${command}: no test fact`);
  // A failed command is named by its recorded words, its leading cd dropped; one naming a path outside the working tree
  // is counted, never named.
  assert.equal(failedCommandText('cd "/srv/work tree" && npm test'), 'npm test');
  assert.equal(failedCommandText('npm test 2>/dev/null'), 'npm test 2>/dev/null');
  for (const command of ['cat /srv/elsewhere/notes.txt', 'cat ~/notes.txt', 'ls ../other-checkout', 'npm test > /tmp/out.txt', 'node --prefix=/usr x'])
    assert.equal(failedCommandText(command), null, command);
});

test('M33 S5 helpers hang beside the step that spawned them and join the chain again at the next node', () => {
  const story = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(story, /subgraph/, 'no helper lane');
  // Story /14 (D77 C): the helpers were spawned under request 2, whose step is the chain's last node, so they hang
  // beside it and there is no next node to join.
  const chart = chartLines(story).join('\n');
  assert.match(chart, /H2\[\["2 helpers: Write unit tests for the token bucket in test\/li…"\]\]/);
  assert.match(chart, /S2 -\.-> H2\n/);
  assert.doesNotMatch(chart, /H2 -\.->/, 'no node follows the last step');
  assert.match(stepChartText(story), /S2 -\.-> H2\n/);
  assert.doesNotMatch(story, /\|(spawned|result|follow-up)\|/, 'no labelled edge across the chart');
  // A recorded successful result of the hand-off, in a later step, is named on the helper node, never drawn.
  const b = sessionBuilder();
  b.ask('I1', 'Delegate.');
  b.delegate('D1', 'do the thing', 'k1');
  b.change('child:k1:W', 'x.js', { after: 'x\n', childId: 'k1' });
  b.ask('I2', 'Check between.');   // story /14: the later window is a request of its own, so the result merges in step 2
  b.run('Z', 'echo between', 'succeeded');
  b.events.push({ id: 'D1-r', sequence: b.events.length, kind: 'observation', invocation: 'D1', callKey: 'D1', phase: 'terminal',
    result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
  b.delegate('D2', 'follow up', 'k1', 'followup');
  const withResult = renderSessionStory(b.session(), { windowResults: [
    { windowIndex: 0, eventIds: ['I1', 'D1', 'child:k1:W', 'child:k1:W-r'], failure: null },
    { windowIndex: 1, eventIds: ['I2', 'Z', 'Z-r', 'D1-r', 'D2'], failure: null }] });
  assertChartSafe(withResult);
  const [overview, ...stepCharts] = mermaidBlocks(withResult).map((lines) => lines.join('\n'));
  assert.match(overview, /H1\[\["1 helper: do the thing · merged at step 2"\]\]/);
  assert.match(overview, /S1 -\.-> H1\n/);
  assert.match(overview, /H1 -\.-> A2\n/, 'back into the next node of the chain, the second request');
  assert.doesNotMatch(overview, /S2 -\.-> H1/, 'a follow-up is not drawn back to the helper');
  // Each request's step chart is its one step: the helper hangs beside step 1, with no next node of that request.
  assert.equal(stepCharts.length, 2);
  assert.match(stepCharts[0], /H1\[\["1 helper: do the thing · merged at step 2"\]\]/);
  assert.match(stepCharts[0], /S1 -\.-> H1\n/);
  assert.doesNotMatch(stepCharts[0], /H1 -\.->/);
  assert.doesNotMatch(stepCharts[1], /H1/);
  assert.match(withResult, /1 helper agent · /);
});

test('M33 S the document is bounded, and says where it stopped', () => {
  // Story /14 (D77 C): a step is one of your requests, so each of the 300 windows is asked for in a request of its own.
  const { session, report } = builtStory(300, (b, i) => {
    b.ask(`I${i}`, i ? `File ${i}.` : 'Go.');
    b.change(`W${i}`, `src/file-${i}.js`, { after: Array.from({ length: 20 }, (_, n) => `line ${n} of file ${i}`).join('\n') });
  });
  const full = renderSessionStory(session, report);
  assert.ok(Buffer.byteLength(full) <= STORY_LIMITS.maxBytes);
  // At 30 KB even the plainest blocks (no snippets, no file lists) do not all fit.
  const small = renderSessionStory(session, report, { maxBytes: 30_000 });
  assert.ok(Buffer.byteLength(small) <= 30_000, 'the whole document stays under the bound');
  const stop = small.match(/_Stopped here to keep this file under 30 KB: steps (\d+)–300 are not shown\._/);
  assert.ok(stop);
  assert.ok(small.endsWith('_Generated by Sonah from a redacted recording; review before sharing._\n'));
  // A link never points at a step the file does not show: those are plain step numbers.
  const first = Number(stop[1]);
  for (const [, n] of small.matchAll(/\(#step-(\d+)\)/g)) assert.ok(Number(n) < first, `step ${n} is shown`);
  assert.match(small, new RegExp(`\\[step 1\\]\\(#step-1\\)\\.`));
  assert.match(small, /_…and 260 requests not shown\._/, 'the product section lists 40 requests and counts the rest');
  // Asked for less than the floor, the bound is the floor.
  assert.ok(Buffer.byteLength(renderSessionStory(session, report, { maxBytes: 1000 })) <= STORY_LIMITS.minBytes);
});

test('M33 S every head section keeps to its share, even with every cap filled by multibyte text', () => {
  const wide = (n) => '漢'.repeat(n);
  // Each request holds eight long stretches of words, one for each of its requirements to cite.
  const stretch = (r) => `${r}${wide(170)}`;
  const { session, report } = builtStory(40, (b, i) => {
    b.ask(`I${i}`, `${Array.from({ length: 8 }, (_, r) => stretch(r)).join(' ')} ${i}`);
    b.say(`C${i}`, `${wide(130)} said ${i}`);
    b.change(`W${i}`, `${wide(300)}/${i}.js`, { after: `${wide(200)}\n` });
  }, { report: {} });
  report.requirements = Array.from({ length: 40 }, (_, i) => Array.from({ length: 8 }, (__, r) =>
    ({ instruction: { role: 'instruction', eventId: `I${i}`, quote: stretch(r) }, text: `${wide(170)} ${r}`, status: 'open' }))).flat();
  report.findings = Array.from({ length: 30 }, (_, i) => ({ status: 'DECIDE', kind: 'code_issue', title: `${wide(170)} ${i}`,
    receipts: [{ role: 'commentary', eventId: `C${i}`, quote: `${wide(130)} said ${i}`, sessionKey: STORY_KEY },
      { role: 'instruction', eventId: `I${i}`, quote: wide(125), sessionKey: STORY_KEY }] }));
  report.decisions = Array.from({ length: 60 }, (_, i) => ({ dimension: wide(100), chosen: `${wide(100)} ${i}`,
    actions: [`W${i % 40}`], column: 'unasked', materiality: 'material' }));
  report.promises = Array.from({ length: 50 }, (_, i) => ({ text: `${wide(170)} ${i}`, stated: { role: 'commentary', eventId: `C${i % 40}` } }));
  report.pivots = Array.from({ length: 30 }, (_, i) => ({ abandoned: wide(80), adopted: `${wide(80)} ${i}`,
    receipts: [{ role: 'commentary', eventId: `C${i}`, quote: wide(10) }] }));
  for (const maxBytes of [STORY_LIMITS.maxBytes, 40_000, STORY_LIMITS.minBytes]) {
    const story = renderSessionStory(session, report, { maxBytes });
    assert.ok(Buffer.byteLength(story) <= maxBytes, `${Buffer.byteLength(story)} bytes within ${maxBytes}`);
    assertChartSafe(story);
    // A long title is clipped in a step chart's node, never its line counts.
    for (const line of stepChartText(story).split('\n').filter((l) => /^\s*S\d+\["/.test(l)))
      assert.match(line, / · files \+1 −0( · \d+ approach(es)? abandoned)?"\]$/);
    assert.match(story, /_…and \d+ (findings?|requests?|decisions?|promises?) not shown\._/, 'a cut is stated');
    assert.ok(story.endsWith(`${STORY_SENTENCES.footer}\n`));
    // Paths are clipped in the middle, keeping the file name.
    for (const [, path] of story.matchAll(/`([^`]*\.js)`/g)) assert.ok([...path].length <= STORY_LIMITS.pathChars, path);
  }
  assert.equal(clipPath(`${'d/'.repeat(100)}name.js`, 20), 'd/d/d/d/d/d/d/…/name.js'.slice(0, 20 - 'name.js'.length - 2) + '…/name.js');
  assert.equal([...clipPath(`${'d/'.repeat(100)}name.js`, 20)].length, 20);
  assert.equal(clipPath('short/path.js'), 'short/path.js');
  // Requests that no step holds are bounded too.
  const extra = sessionBuilder();
  extra.ask('I0', 'Go.');
  extra.run('R', 'echo', 'succeeded');
  for (let i = 0; i < 60; i++) extra.ask(`late${i}`, `late ${i} ${wide(170)}`);
  const late = renderSessionStory(extra.session(), { windowResults: [{ windowIndex: 0, eventIds: ['I0', 'R', 'R-r'], failure: null }] });
  assert.equal(late.split('\n').filter((line) => line.startsWith('### You: ') && line.includes('late')).length, STORY_LIMITS.asks);
  assert.match(late, /_…and 20 requests not shown\._\n\n---/);
});

test('M33 S the review\'s run state, materiality and unchecked decisions read in words; no status (D71)', () => {
  assert.deepEqual(STORY_REVIEW_WORDS, { complete: 'complete', incomplete: 'did not complete' });
  const story = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(story.split('## What happened')[0], /\| (DECIDE|NO_FINDINGS|UNCHECKED) \|/);
  // Only the decision the review is sure was made without asking is tabled, with its impact as a fact.
  // Story /14 (D77 C): the fixture's seven windows are two steps, one per request.
  assert.match(story, /\| \[1\]\(#step-1\) \| limiter algorithm: in-process token bucket \| changes behaviour \|\n\n/);
  // M33 brittleness H4: the others in the C-06 decision order (you asked and the agent chose how, you settled, unchecked).
  assert.ok(story.includes('**Other decisions: 3** — 1 you asked, agent chose · 1 you settled · 1 agent; could not check if you asked'));
  // M33 brittleness H4: materiality never leaves a decision made without asking out of the table or its count.
  for (const materiality of ['material', 'structural', 'cosmetic', undefined]) {
    const report = storyReport();
    const unasked = report.decisions.filter((d) => d.column === 'unasked' && d.columnState === 'grounded');
    assert.equal(unasked.length, 1);
    for (const d of unasked) d.materiality = materiality;
    const told = renderSessionStory(storySession(), report);
    assert.match(told, new RegExp(`\\| \\[1\\]\\(#step-1\\) \\| limiter algorithm: in-process token bucket \\| `
      + `${materiality === undefined ? '–' : STORY_MATERIALITY_WORDS[materiality]} \\|\\n\\n`), String(materiality));
    assert.match(told, /\n\| 0 of 2 requests fully addressed · 2 partly addressed \| 2 \| 1 \| 1 \| /, `${materiality}: counted once in the top row`);
    assert.ok(told.includes('**Other decisions: 3** — '), String(materiality));
  }
  assert.match(story, /- \[step 2\]\(#step-2\) · test runner: node --test — agent; could not check if you asked · cosmetic\n/);
  assert.doesNotMatch(story, /Decisions the review could not check/, 'counted for leads, never again in a step (M33 S3)');
  assert.doesNotMatch(story, /Maybe not asked/, 'a decision nobody could check is not drawn as one made without asking');
  assert.match(story, /U1\{\{"Not asked: limiter algorithm: in-process token bucket"\}\}/);
  assert.deepEqual(Object.values(STORY_MATERIALITY_WORDS), ['changes behaviour', 'changes structure', 'cosmetic']);
  assert.ok(story.includes(STORY_SENTENCES.materialityLegend));
  // The failed review window held request 2's work, so request 2's step says it was not reviewed.
  assert.match(story, /Step 2 — Changed 2 files · 1 command failed · ran test\/limiter\.test\.js\n\n5 commands · files \+10 −1 · helpers 2 · 1 file outside the repository, not shown · not reviewed \(the review of this step did not finish\)\n/);
  assert.equal(STORY_WHO_DECIDED.unchecked, 'agent; could not check if you asked');
  // D71 (a): a stored status changes nothing the story says; the Review cell is whether the session review completed,
  // recomputed from the report's facts.
  const heads = PUBLIC_STATUSES.map((status) => {
    const report = { ...storyReport(), sessionStatus: status, windowResults: storyReport().windowResults.map((w) => ({ ...w, failure: null })) };
    const told = renderSessionStory(storySession(), report);
    const word = STORY_REVIEW_WORDS[honestStatuses({ ...report }).sessionReview === 'complete' ? 'complete' : 'incomplete'];
    assert.match(told, new RegExp(`\\| ${word} \\|\n`), status);
    assert.doesNotMatch(told, /Needs your decision|Worth a look|needs your decision|worth a look|\bclean\b/, status);
    return told;
  });
  assert.equal(new Set(heads).size, 1, 'the stored status is never read');
});

test('M33 S a real ledger report of the redis-pivot session renders its grounded rows', () => {
  const session = redisPivotSession();
  const report = buildLedger({ repo: { host: 'github.com', id: '42' }, session, pr: redisPivotPr(),
    candidates: DECISION_CANDIDATES, findingCandidates: FINDING_CANDIDATES, sessionCoverage: 'complete' });
  const { session: omitted, ...saved } = report;
  // M35 windowing: a small work budget (111 tokens, about 400 bytes) cuts the session into two windows.
  saved.windowResults = planWindows(session, { workTokens: 111, carriedTokens: 0, trimTokens: 2_000 })
    .map((w) => ({ windowIndex: w.index, eventIds: w.events.map((e) => e.id), failure: null }));
  const story = renderSessionStory(session, JSON.parse(JSON.stringify(saved)));
  assertChartSafe(story);
  assert.match(story, /\*\*Finding\*\* · \[step \d\]\(#step-\d\) — The final message says the tests pass; the integration run failed\n> \*\*Agent said:\*\* verified it works — the tests pass\n>\n> \*\*Recorded result:\*\* Tests: 1 failed, 11 passed, 12 total/);
  // M33 brittleness M4: the agent's earlier words cited among its receipts no longer make the breach FYI; D71 (a): it
  // is a "Finding" either way.
  assert.match(story, /\*\*Finding\*\* · \[step \d\]\(#step-\d\) — Redis was added although the instruction forbade new infrastructure/);
  assert.match(story, /- \[step \d\]\(#step-\d\) · cache backend: Redis as a shared cache store — you asked, agent chose · /);
  assert.match(story, /`config\/redis\.yml` \+5 −0/);
  // M1: the failed command, by its recorded words and exit; the passing one is no bullet.
  assert.match(story, /- Failed: `npm run test:integration` \(exit 1\)\n/);
  assert.doesNotMatch(story, /npm run test:unit/);
  assert.ok(story.includes(`# ${REDIS_PIVOT_TEXT.ask.slice(0, 79)}…`));
});

test('M33 S duration is read only from timestamps the recording carries', () => {
  const plain = renderSessionStory(storySession(), storyReport());
  assert.doesNotMatch(plain.split('\n')[2], /min/);
  const session = storySession();
  session.events[0].timestamp = '2026-09-30T10:00:00Z';
  session.events[session.events.length - 1].timestamp = '2026-09-30T11:05:30.500Z';
  assert.match(renderSessionStory(session, storyReport()).split('\n')[2], /^Claude Code recording · 1 h 6 min · 2 asks/);
});

test('M33 S the fixture carries what the snapshot shows', () => {
  // The plan file the fixture writes outside the repository is counted in the snapshot and never shown.
  const story = readFileSync(SNAPSHOT, 'utf8');
  assert.equal(story.includes(TEXT.planPath), false);
  assert.equal(story.includes(TEXT.planBody.trim()), false);
  assert.match(story, /`src\/limiter\/token-bucket\.js` \+12 −1/, 'the rewrite adds +1 −1 to the create');
});
