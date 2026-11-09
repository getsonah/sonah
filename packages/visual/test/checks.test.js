// Layer 2's grounding: small hand-made answers, good and bad, checked against small hand-made facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFunctions, checkStory, checkFindings, findingsLost, isOneChain, limitFailures, mainChain, mergeFixes, LIMITS, words }
  from '../src/checks.mjs';
import { DROP_REASONS, DROP_REASON_MEANING, isDropReason } from '../src/reasons.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fnOf = (path, name, status, diff) => ({ id: `${path}#${name}`, path, name, kind: 'callable', status, line: 2,
  span: [1, 9], oldLine: status === 'new' ? null : 2, added: 1, removed: 1, definition: diff[0]?.[3] ?? '',
  commentOnly: false, diff, callers: { count: 0, list: [] }, tests: [], fold: null });
const FACTS = {
  v: 1,
  functions: [
    fnOf('src/q.js', 'enqueue', 'changed', [
      [' ', 2, 2, 'export function enqueue(job, queue) {'],
      ['-', 3, null, '  queue.push(job);'],
      ['+', null, 3, '  if (queue.length >= MAX_JOBS) return false;'],
      ['+', null, 4, '  queue.push(job); // retry later'],
      ['~', null, null, ''],
    ]),
    fnOf('src/q.js', 'drain', 'new', [['+', null, 9, 'export function drain(queue) {'], ['+', null, 10, '  return queue.splice(0);']]),
    fnOf('src/w.py', 'run', 'changed', [[' ', 5, 5, 'def run(self):'], ['+', null, 6, '    self.backoff = 2']]),
  ],
};
const E = 'src/q.js#enqueue'; const D = 'src/q.js#drain'; const W = 'src/w.py#run';
const n = (k) => Array.from({ length: k }, (_, i) => `w${i}`).join(' '); // a text of exactly k words
const reasons = (dropped) => dropped.map((d) => d.reason);
const rec = (id, kind, answer, error = null) => ({ id, kind, answer, error, by: 'stand-in', model: null, costUsd: 0, ms: 0 });
const seen = new Set(); // every reason a check gave, to test they are all from the closed list
const note = (out) => { for (const d of out.dropped) seen.add(d.reason); return out; };

// ---------- functions ----------

test('checkFunctions keeps good entries in facts order, keyed by id', () => {
  const out = note(checkFunctions(FACTS, [rec('r1', 'functions', { functions: [
    { id: D, summary: 'Empties a queue and returns its jobs.', change: 'Adds a way to take every waiting job at once.' },
    { id: E, summary: 'Adds a job to a queue unless it is full.', change: 'Now refuses a job when the queue is full.' },
  ] })]));
  assert.deepEqual(out.dropped, []);
  assert.deepEqual(Object.keys(out.value), [E, D]);
  assert.deepEqual(out.value[E], { summary: 'Adds a job to a queue unless it is full.', change: 'Now refuses a job when the queue is full.' });
});

test('checkFunctions drops unknown ids, repeats, missing and over-long texts, and failed requests', () => {
  const out = note(checkFunctions(FACTS, [
    rec('r1', 'functions', { functions: [
      { id: 'src/q.js#nothere', summary: 'x', change: 'y' },
      { id: E, summary: n(LIMITS.summary + 1), change: n(LIMITS.change) },
      { id: W, summary: '', change: n(LIMITS.change + 1) },
    ] }),
    rec('r2', 'functions', { functions: [{ id: E, summary: 'Again.', change: 'Again.' }] }),
    rec('r3', 'functions', null, 'answer_invalid'),
    rec('r4', 'functions', null, 'spawn claude ENOENT'),
    rec('r5', 'functions', { notFunctions: true }),
  ]));
  assert.deepEqual(out.dropped, [
    { where: 'r1/functions[0]', reason: 'unknown_function' },
    { where: 'r1/functions[1].summary', reason: 'over_word_limit' },
    { where: 'r1/functions[2].summary', reason: 'missing_text' },
    { where: 'r1/functions[2].change', reason: 'over_word_limit' },
    { where: 'r2/functions[0]', reason: 'duplicate_function' },
    { where: 'r3', reason: 'answer_invalid' },
    { where: 'r4', reason: 'call_failed' },
    { where: 'r5', reason: 'answer_invalid' },
  ]);
  // a field that failed is null; an entry with neither field is left out
  assert.deepEqual(out.value, { [E]: { summary: null, change: n(LIMITS.change) } });
});

test('word limits count words, not characters, and are exact at the limit', () => {
  assert.equal(words('  one   two\tthree\nfour '), 4);
  const at = note(checkFunctions(FACTS, [{ functions: [{ id: E, summary: n(12), change: n(30) }] }]));
  assert.deepEqual(at.dropped, []);
  const over = note(checkFunctions(FACTS, [{ functions: [{ id: E, summary: n(13), change: n(31) }] }]));
  assert.deepEqual(reasons(over.dropped), ['over_word_limit', 'over_word_limit']);
});

// ---------- story ----------

const goodFlow = () => ({
  title: 'A job meets a full queue',
  steps: [
    { id: 's1', label: 'Caller hands over a job', fn: null, ext: 'worker loop', was: null, isNew: false },
    { id: 's2', label: 'Queue full? Refuse', fn: E, ext: null, was: 'always pushed', isNew: true },
    { id: 's3', label: 'Drain takes every job', fn: D, ext: null, was: null, isNew: true },
    { id: 's4', label: 'Retry after backoff', fn: W, ext: null, was: null, isNew: true },
  ],
  edges: [
    { from: 's1', to: 's2', label: null, kind: 'main' },
    { from: 's2', to: 's3', label: 'accepted', kind: 'main' },
    { from: 's2', to: 's4', label: 'refused', kind: 'branch' },
    { from: 's4', to: 's1', label: 'try again', kind: 'signal' },
  ],
});
const goodStory = () => ({
  oneLine: 'A full queue now refuses new jobs instead of growing.',
  ask: 'Stop the queue from growing without bound.',
  beforeNow: [{ before: 'Every job was pushed', now: 'A full queue refuses jobs' }, ['No way to drain', 'Drain takes all jobs']],
  flows: [goodFlow()],
  glossary: [{ term: 'MAX_JOBS', def: 'The most jobs a queue holds.' }, { term: 'backoff', def: 'The wait before a retry.' }],
});

test('checkStory keeps a good story whole (a pair may be an object or two strings)', () => {
  const out = note(checkStory(FACTS, rec('s', 'story', goodStory())));
  assert.deepEqual(out.dropped, []);
  assert.equal(out.value.oneLine, goodStory().oneLine);
  assert.deepEqual(out.value.beforeNow[1], { before: 'No way to drain', now: 'Drain takes all jobs' });
  assert.deepEqual(out.value.flows, [goodFlow()]);
  assert.deepEqual(out.value.glossary.map((g) => g.term), ['MAX_JOBS', 'backoff']);
});

test('checkStory drops texts over their limits and lists over their counts', () => {
  const s = goodStory();
  s.oneLine = n(LIMITS.oneLine + 1);
  s.ask = n(LIMITS.ask + 1);
  s.beforeNow = [['a', n(LIMITS.beforeNowSide + 1)], ['b', 'c'], ['d', 'e'], ['f', 'g']];
  s.flows = [goodFlow(), goodFlow(), goodFlow(), goodFlow()];
  s.glossary = Array.from({ length: 9 }, () => ({ term: 'queue', def: 'A list of jobs.' }));
  const out = note(checkStory(FACTS, s));
  assert.equal(out.value.oneLine, null);
  assert.equal(out.value.ask, null);
  assert.equal(out.value.beforeNow.length, 2);
  assert.equal(out.value.flows.length, 3);
  assert.deepEqual(out.value.glossary, [{ term: 'queue', def: 'A list of jobs.' }]);
  assert.deepEqual(out.dropped, [
    { where: 'oneLine', reason: 'over_word_limit' },
    { where: 'ask', reason: 'over_word_limit' },
    { where: 'beforeNow[3]', reason: 'over_count_limit' },
    { where: 'beforeNow[0].now', reason: 'over_word_limit' },
    { where: 'flows[3]', reason: 'over_count_limit' },
    { where: 'glossary[8]', reason: 'over_count_limit' },
    ...Array.from({ length: 7 }, (_, i) => ({ where: `glossary[${i + 1}]`, reason: 'duplicate_term' })),
  ]);
});

test('checkStory: a glossary term must appear literally in the diff (case and all)', () => {
  const s = goodStory();
  s.glossary = [
    { term: 'retry later', def: 'Words on an added line.' },
    { term: 'max_jobs', def: 'Not the diff\'s case.' },
    { term: 'circuit breaker', def: 'Not in the diff at all.' },
    { term: 'splice', def: n(LIMITS.glossaryDef + 1) },
    { term: '', def: 'No term.' },
  ];
  const out = note(checkStory(FACTS, s));
  assert.deepEqual(out.value.glossary.map((g) => g.term), ['retry later']);
  assert.deepEqual(out.dropped, [
    { where: 'glossary[1]', reason: 'term_not_in_diff' },
    { where: 'glossary[2]', reason: 'term_not_in_diff' },
    { where: 'glossary[3].def', reason: 'over_word_limit' },
    { where: 'glossary[4]', reason: 'missing_text' },
  ]);
});

test('checkStory: steps name a function that exists or an external; "was" only on a new step', () => {
  const f = goodFlow();
  f.steps[0].was = 'it was here'; // not a new step
  f.steps[1].was = n(LIMITS.stepWas + 1);
  f.steps.push({ id: 's5', label: 'Ghost step', fn: 'src/q.js#ghost', ext: null, was: null, isNew: true });
  f.steps.push({ id: 's6', label: 'Nobody does this', fn: null, ext: null, was: null, isNew: true });
  f.steps.push({ id: 's7', label: n(LIMITS.stepLabel + 1), fn: D, ext: null, was: null, isNew: true });
  f.steps.push({ id: 's3', label: 'Same id again', fn: D, ext: null, was: null, isNew: true });
  f.edges.push({ from: 's3', to: 's6', label: null, kind: 'branch' });
  f.edges.push({ from: 's3', to: 'nowhere', label: null, kind: 'branch' });
  f.edges.push({ from: 's3', to: 's4', label: null, kind: 'loop' });
  f.edges[1].label = n(LIMITS.edgeLabel + 1);
  const out = note(checkStory(FACTS, { ...goodStory(), flows: [f] }));
  assert.deepEqual(out.dropped, [
    { where: 'flows[0].steps[0].was', reason: 'was_not_allowed' },
    { where: 'flows[0].steps[1].was', reason: 'over_word_limit' },
    { where: 'flows[0].steps[4]', reason: 'unknown_function' },
    { where: 'flows[0].steps[5]', reason: 'step_without_target' },
    { where: 'flows[0].steps[6].label', reason: 'over_word_limit' },
    { where: 'flows[0].steps[7]', reason: 'duplicate_step' },
    { where: 'flows[0].edges[1].label', reason: 'over_word_limit' },
    { where: 'flows[0].edges[4]', reason: 'edge_to_dropped_step' },
    { where: 'flows[0].edges[5]', reason: 'unknown_step' },
    { where: 'flows[0].edges[6]', reason: 'edge_kind_unknown' },
    { where: 'flows[0].steps[6]', reason: 'step_not_joined' }, // s7 keeps its function but no edge joins it
  ]);
  const kept = out.value.flows[0];
  assert.deepEqual(kept.steps.map((s) => [s.id, s.was]), [['s1', null], ['s2', null], ['s3', null], ['s4', null]]);
  assert.equal(kept.edges.length, 4);
  assert.equal(kept.edges[1].label, null);
});

test('checkStory: a label over its limit is null and the step stays; a step joined by a branch stays', () => {
  const f = goodFlow();
  f.steps[1].label = n(LIMITS.stepLabel + 1);
  f.steps.push({ id: 's9', label: 'Side path', fn: D, ext: null, was: null, isNew: true });
  f.edges.push({ from: 's9', to: 's2', label: null, kind: 'branch' }); // joined, though the edge points into the chain
  f.steps.push({ id: 's8', label: 'Only a signal', fn: D, ext: null, was: null, isNew: true });
  f.edges.push({ from: 's8', to: 's1', label: null, kind: 'signal' }); // a signal alone does not join
  const out = note(checkStory(FACTS, { ...goodStory(), flows: [f] }));
  const kept = out.value.flows[0];
  assert.equal(kept.steps[1].label, null);
  assert.equal(kept.steps[1].fn, f.steps[1].fn);
  assert.deepEqual(kept.steps.map((s) => s.id), ['s1', 's2', 's3', 's4', 's9']);
  assert.deepEqual(reasons(out.dropped), ['over_word_limit', 'step_not_joined', 'edge_to_dropped_step']);
  assert.ok(!kept.edges.some((e) => e.from === 's8' || e.to === 's8'));
});

test('checkStory: a flow whose main edges are not one chain is dropped whole', () => {
  const fork = goodFlow(); fork.edges[2].kind = 'main'; // s2 -> s3 and s2 -> s4 both main
  const twice = goodFlow(); twice.edges.push({ from: 's1', to: 's2', label: null, kind: 'main' }); // the same main edge twice
  const rotated = goodFlow(); rotated.edges[3].kind = 'main'; // s4 -> s1 -> s2 -> s3 is still one chain
  const loop = goodFlow(); loop.edges.push({ from: 's3', to: 's1', label: null, kind: 'main' }); // s1 -> s2 -> s3 -> s1
  const apart = goodFlow(); apart.edges = [{ from: 's1', to: 's2', label: null, kind: 'main' }, { from: 's3', to: 's4', label: null, kind: 'main' }];
  const none = goodFlow(); none.edges = [];
  const broken = goodFlow(); broken.steps[1].fn = 'src/q.js#ghost'; // the middle step drops, so the chain breaks
  const single = { title: 'One step', steps: [{ id: 'x', label: 'Drain', fn: D, ext: null, was: null, isNew: true }], edges: [] };
  const empty = { title: 'Nothing', steps: [], edges: [] };
  for (const [flow, expect] of [[fork, 'main_not_one_chain'], [twice, 'main_not_one_chain'], [loop, 'main_not_one_chain'],
    [apart, 'main_not_one_chain'], [none, 'main_not_one_chain'], [empty, 'flow_without_steps']]) {
    const out = note(checkStory(FACTS, { ...goodStory(), flows: [flow] }));
    assert.deepEqual(out.value.flows, []);
    assert.equal(out.dropped.at(-1).reason, expect);
    assert.equal(out.dropped.at(-1).where, 'flows[0]');
  }
  const b = note(checkStory(FACTS, { ...goodStory(), flows: [broken] }));
  assert.deepEqual(reasons(b.dropped), ['unknown_function', 'edge_to_dropped_step', 'edge_to_dropped_step',
    'edge_to_dropped_step', 'main_not_one_chain']);
  const one = note(checkStory(FACTS, { ...goodStory(), flows: [single, rotated] }));
  assert.equal(one.value.flows.length, 2);
  assert.deepEqual(mainChain(one.value.flows[1]), ['s4', 's1', 's2', 's3']);
  assert.deepEqual(mainChain(goodFlow()), ['s1', 's2', 's3']);
  assert.equal(isOneChain(goodFlow().steps, goodFlow().edges.filter((e) => e.kind === 'main')), true);
});

test('checkStory: a flow title over its word limit is null and the flow stays; steps past the count limit are dropped', () => {
  const long = { ...goodFlow(), title: n(LIMITS.flowTitle + 1) };
  const out = note(checkStory(FACTS, { ...goodStory(), flows: [long] }));
  assert.equal(out.value.flows.length, 1);
  assert.equal(out.value.flows[0].title, null);
  assert.deepEqual(out.dropped, [{ where: 'flows[0].title', reason: 'over_word_limit' }]);
  const untitled = note(checkStory(FACTS, { ...goodStory(), flows: [{ ...goodFlow(), title: '' }] }));
  assert.deepEqual(untitled.dropped, [{ where: 'flows[0].title', reason: 'missing_text' }]);
  // A chain one step longer than allowed: the last step and its edge go, the rest is still one chain.
  const k = LIMITS.stepsMax + 1;
  const steps = Array.from({ length: k }, (_, i) => ({ id: `s${i + 1}`, label: `Step ${i + 1}`, fn: null, ext: 'tool', was: null, isNew: false }));
  const edges = steps.slice(1).map((s, i) => ({ from: steps[i].id, to: s.id, label: null, kind: 'main' }));
  const many = note(checkStory(FACTS, { ...goodStory(), flows: [{ title: 'A long path', steps, edges }] }));
  assert.equal(many.value.flows[0].steps.length, LIMITS.stepsMax);
  assert.deepEqual(many.dropped, [{ where: `flows[0].steps[${k - 1}]`, reason: 'over_count_limit' },
    { where: `flows[0].edges[${k - 2}]`, reason: 'edge_to_dropped_step' }]);
});

test('checkStory on a missing or malformed answer', () => {
  assert.deepEqual(note(checkStory(FACTS, rec('s', 'story', null, 'answer_invalid'))).dropped, [{ where: 's', reason: 'answer_invalid' }]);
  assert.deepEqual(note(checkStory(FACTS, rec('s', 'story', null, 'timeout after 600000 ms'))).dropped, [{ where: 's', reason: 'call_failed' }]);
  assert.deepEqual(note(checkStory(FACTS, [1, 2])).dropped, [{ where: '', reason: 'answer_invalid' }]);
  const partial = note(checkStory(FACTS, { oneLine: 'Only a line.' }));
  assert.equal(partial.value.oneLine, 'Only a line.');
  assert.deepEqual(partial.dropped, [{ where: 'ask', reason: 'missing_text' }]);
});

// ---------- findings ----------

const goodFinding = () => ({ tier: 'must-know', title: 'A full queue now refuses jobs', oneLine: 'Callers that ignored the return value lose the job.',
  fns: [E], quote: 'if (queue.length >= MAX_JOBS) return false;' });

test('checkFindings keeps a grounded finding; a quote may span consecutive rows of one function', () => {
  const two = { ...goodFinding(), quote: '  if (queue.length >= MAX_JOBS) return false;\n  queue.push(job);' };
  const none = { ...goodFinding(), fns: [], tier: 'good-to-know' };
  const out = note(checkFindings(FACTS, rec('k', 'findings', { findings: [goodFinding(), two, none] })));
  assert.deepEqual(out.dropped, []);
  assert.equal(out.value.length, 3);
  assert.deepEqual(out.value[0], goodFinding());
});

test('checkFindings keeps at most the first LIMITS.findingsMax good findings', () => {
  const list = [{ ...goodFinding(), tier: 'critical' }, ...Array.from({ length: LIMITS.findingsMax + 1 }, () => goodFinding())];
  const out = note(checkFindings(FACTS, rec('k', 'findings', { findings: list })));
  assert.equal(out.value.length, LIMITS.findingsMax);
  assert.deepEqual(out.dropped, [{ where: 'k/findings[0]', reason: 'tier_unknown' },
    { where: `k/findings[${LIMITS.findingsMax + 1}]`, reason: 'over_count_limit' }]);
});

test('checkFindings drops a finding whole when its grounding fails; a text over its limit is null and the finding stays', () => {
  const bad = [
    { ...goodFinding(), tier: 'critical' },
    { ...goodFinding(), title: n(LIMITS.findingTitle + 1) },
    { ...goodFinding(), oneLine: n(LIMITS.findingOneLine + 1) },
    { ...goodFinding(), fns: [E, 'src/q.js#ghost'] },
    { ...goodFinding(), quote: `${'x'.repeat(LIMITS.quoteChars + 1)}` },
    { ...goodFinding(), quote: 'if (queue.length > MAX_JOBS) return false;' }, // close, but not literally there
    { ...goodFinding(), quote: '' },
    { ...goodFinding(), fns: 'src/q.js#enqueue' },
    { ...goodFinding(), tier: 'must-act', quote: 'queue.push(job); // retry later' },
  ];
  const out = note(checkFindings(FACTS, rec('k', 'findings', { findings: bad })));
  assert.deepEqual(out.dropped, [
    { where: 'k/findings[0]', reason: 'tier_unknown' },
    { where: 'k/findings[1].title', reason: 'over_word_limit' },
    { where: 'k/findings[2].oneLine', reason: 'over_word_limit' },
    { where: 'k/findings[3]', reason: 'unknown_function' },
    { where: 'k/findings[4]', reason: 'quote_too_long' },
    { where: 'k/findings[5]', reason: 'quote_not_in_diff' },
    { where: 'k/findings[6]', reason: 'missing_text' },
    { where: 'k/findings[7]', reason: 'unknown_function' },
  ]);
  assert.deepEqual(out.value.map((k) => [k.tier, k.title === null, k.oneLine === null]),
    [['must-know', true, false], ['must-know', false, true], ['must-act', false, false]]);
  assert.equal(findingsLost(out.dropped), 6);
  // with neither text left, the finding is dropped
  const mute = note(checkFindings(FACTS, [{ ...goodFinding(), title: n(LIMITS.findingTitle + 1), oneLine: '' }]));
  assert.deepEqual(mute.value, []);
  assert.deepEqual(mute.dropped, [{ where: 'findings[0]', reason: 'over_word_limit' }]);
  // a quote of exactly 120 characters is within the limit
  const long = { ...FACTS, functions: [fnOf('a.js', 'f', 'new', [['+', null, 1, 'y'.repeat(130)]])] };
  const ok = note(checkFindings(long, [{ ...goodFinding(), fns: ['a.js#f'], quote: 'y'.repeat(120) }]));
  assert.deepEqual(ok.dropped, []);
  assert.deepEqual(note(checkFindings(FACTS, rec('k', 'findings', null, 'answer_invalid'))).dropped, [{ where: 'k', reason: 'answer_invalid' }]);
});

// ---------- the closed vocabulary ----------

test('every reason a check gives is in the closed list, and none is spelled inline in checks.mjs', () => {
  assert.ok(Object.isFrozen(DROP_REASONS));
  assert.ok(seen.size >= 15, `${seen.size} reasons exercised`);
  for (const r of seen) assert.ok(DROP_REASONS.includes(r) && isDropReason(r), r);
  for (const r of DROP_REASONS) {
    assert.equal(DROP_REASONS[r], r);
    assert.equal(typeof DROP_REASON_MEANING[r], 'string');
  }
  assert.equal(isDropReason('made_up'), false);
  const src = readFileSync(join(ROOT, 'src/checks.mjs'), 'utf8');
  for (const r of DROP_REASONS) assert.ok(!src.includes(`'${r}'`) && !src.includes(`"${r}"`), `${r} spelled inline`);
  assert.deepEqual(JSON.parse(JSON.stringify(DROP_REASONS)), [...DROP_REASONS]);
});
