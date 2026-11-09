// Layer 2 prompts: deterministic requests from facts, bounded sizes, short ids mapped back, answer shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BOUNDS, LIMITS, answerProblems, diffLines, findingsRequest, fixFields, fixRequest, functionRequests, mapAnswerIds,
  requestId, retryRequest, shortIds, storyRequest,
} from '../src/requests.mjs';
import { limitFailures, mergeFixes } from '../src/checks.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Made-up facts in the contract's shape. Names and numbers are invented for the test.
function fnOf(path, name, n, extra = {}) {
  const line = 10 * n;
  return {
    id: `${path}#${name}`, path, name, kind: 'callable', status: 'changed', line, span: [line, line + 6],
    oldLine: line - 1, added: 2, removed: 1, definition: `function ${name}(a) {`, commentOnly: false,
    diff: [
      [' ', line - 1, line, `function ${name}(a) {`],
      ['-', line, null, `  return a + ${n};`],
      ['+', null, line + 1, `  const b = a * ${n};`],
      ['+', null, line + 2, '  return b;'],
      [' ', line + 1, line + 3, '}'],
    ],
    callers: { count: 2, list: [] }, tests: [], fold: null, ...extra,
  };
}

function factsOf(fns, extra = {}) {
  const paths = [...new Set(fns.map((f) => f.path))];
  return {
    v: 1, repo: { name: 'sample' },
    range: { base: 'a'.repeat(40), head: 'b'.repeat(40), commits: [
      { sha: 'c'.repeat(40), subject: 'Make totals scale by the factor', body: 'Totals were offset, not scaled.\n\nThe ask: scale them.' },
    ] },
    stats: { files: paths.length, added: 10, removed: 3, functions: fns.length, newFunctions: 0, changedFunctions: fns.length, removedFunctions: 0 },
    groups: [{ group: 'lib', files: paths }],
    files: paths.map((p) => ({ path: p, status: 'modified', role: p.includes('test') ? 'test' : 'source', lang: 'js', added: 5, removed: 1,
      functions: fns.filter((f) => f.path === p).map((f) => f.id) })),
    functions: fns,
    mentions: [],
    route: { read: paths.filter((p) => !p.includes('test')).map((p) => ({ path: p, lines: 6 })), skim: [], skip: [], lines: { read: 6, skim: 0, skip: 0 } },
    ...extra,
  };
}

const many = (n, path = 'lib/calc.js') => Array.from({ length: n }, (_, i) => fnOf(path, `step${i + 1}`, i + 1));

test('functions: unfolded functions only, in facts order, in even batches of at most 25, short ids global', () => {
  const fns = many(30);
  fns.splice(3, 0, fnOf('lib/calc.js', 'LIMIT', 99, { kind: 'value', fold: 'value' }));
  const facts = factsOf(fns);
  const reqs = functionRequests(facts);
  assert.equal(reqs.length, 2);
  assert.deepEqual(reqs.map((r) => Object.keys(r.ids).length), [15, 15]);
  for (const r of reqs) {
    assert.equal(r.kind, 'functions');
    assert.match(r.id, /^[0-9a-f]{64}$/);
    assert.equal(r.id, requestId(r.kind, r.system, r.prompt));
  }
  const shorts = shortIds(facts);
  assert.equal(shorts.get(fns[3].id), 'f4');
  assert.ok(!Object.values(reqs[0].ids).includes(fns[3].id), 'a folded function is not asked');
  assert.equal(reqs[0].ids.f5, fns[4].id, 'short ids count every function, folded ones too');
  const asked = reqs.flatMap((r) => Object.values(r.ids));
  assert.deepEqual(asked, fns.filter((f) => f.fold == null).map((f) => f.id));
  assert.match(reqs[0].prompt, /<diff id="f1" name="step1" at="lib\/calc\.js:10">/);
  assert.match(reqs[0].prompt, /Make totals scale by the factor/);
});

test('functions: no unfolded function gives no request', () => {
  assert.deepEqual(functionRequests(factsOf([fnOf('lib/a.js', 'x', 1, { fold: 'tiny' })])), []);
});

test('functions: a batch closes early when its diffs pass the size bound', () => {
  const big = Array.from({ length: 12 }, (_, i) => {
    const f = fnOf('lib/big.js', `wide${i + 1}`, i + 1);
    f.diff = Array.from({ length: 140 }, (_, k) => ['+', null, k + 1, `  value_${k} = compute(${'x'.repeat(50)});`]);
    return f;
  });
  const reqs = functionRequests(factsOf(big));
  assert.ok(reqs.length > 1);
  for (const r of reqs) assert.ok(Object.keys(r.ids).length <= BOUNDS.batchMax);
  assert.deepEqual(reqs.flatMap((r) => Object.values(r.ids)), big.map((f) => f.id));
});

test('requests are deterministic: no clock or random read, same facts give the same bytes', () => {
  const facts = factsOf(many(4));
  const [now, rnd] = [Date.now, Math.random];
  Date.now = () => { throw new Error('clock read'); };
  Math.random = () => { throw new Error('random read'); };
  try {
    const a = [functionRequests(facts), storyRequest(facts, []), findingsRequest(facts)];
    const b = [functionRequests(structuredClone(facts)), storyRequest(structuredClone(facts), []), findingsRequest(structuredClone(facts))];
    assert.deepEqual(a, b);
  } finally { [Date.now, Math.random] = [now, rnd]; }
});

test('a change to one function changes only its own batch id', () => {
  const fns = many(30);
  const before = functionRequests(factsOf(fns)).map((r) => r.id);
  fns[20].diff[2][3] = '  const b = a * 1000;';
  const after = functionRequests(factsOf(fns)).map((r) => r.id);
  assert.equal(before[0], after[0]);
  assert.notEqual(before[1], after[1]);
});

test('diff lines: old and new numbers, marks, one gap line, long lines cut', () => {
  const rows = [[' ', 4, 4, 'a'], ['~', null, null, ''], ['-', 9, null, 'old'], ['+', null, 9, 'x'.repeat(300)]];
  const out = diffLines(rows);
  assert.equal(out[0], '    4     4   a');
  assert.equal(out[1].trim(), '⋮');
  assert.equal(out[2], '    9       - old');
  assert.ok(out[3].startsWith('          9 + xxx'));
  assert.ok(out[3].endsWith('⟨line cut⟩'));
});

test('diff lines: a long diff keeps changed lines first and says how many are not shown', () => {
  const rows = [];
  for (let k = 1; k <= 400; k++) rows.push(k % 50 === 0 ? ['+', null, k, `  changed ${k}`] : [' ', k, k, `  same ${k}`]);
  const out = diffLines(rows, { maxRows: 40, maxChars: 100_000 });
  const shownChanged = out.filter((l) => l.includes('changed'));
  assert.equal(shownChanged.length, 8, 'all 8 changed lines fit once far context is dropped');
  assert.ok(out.length <= 40);
  const tight = diffLines(rows, { maxRows: 6, maxChars: 100_000 });
  assert.match(tight.at(-1), /⋮ \d+ added and 0 removed lines below are not shown/);
  assert.deepEqual(diffLines(rows, { maxRows: 6, maxChars: 100_000 }), tight);
});

test('story: commits, checked notes, calls between functions and changed lines; every function mapped', () => {
  const fns = many(3);
  fns.push(fnOf('lib/calc.js', 'RATE', 7, { kind: 'value', fold: 'value' }));
  const facts = factsOf(fns, { mentions: [
    { from: fns[0].id, to: fns[1].id, onCodeLine: true, callShaped: true },
    { from: fns[2].id, to: fns[0].id, onCodeLine: true, callShaped: false },
    { from: fns[1].id, to: fns[2].id, onCodeLine: false, callShaped: false },
  ] });
  const notes = [{ id: fns[0].id, summary: 'Scales a total by its factor.', change: 'Now multiplies instead of adding.' }];
  const r = storyRequest(facts, notes);
  assert.equal(r.kind, 'story');
  assert.match(r.prompt, /Totals were offset, not scaled\./);
  assert.match(r.prompt, /now: Scales a total by its factor\./);
  assert.match(r.prompt, /change: Now multiplies instead of adding\./);
  assert.match(r.prompt, /^f1 calls f2$/m);
  assert.match(r.prompt, /^f3 names f1$/m);
  assert.doesNotMatch(r.prompt, /f2 (calls|names) f3/, 'a mention off code lines is not a call');
  assert.match(r.prompt, /folded: value/);
  assert.match(r.prompt, /^\+ {3}const b = a \* 1;$/m);
  assert.equal(Object.keys(r.ids).length, 4);
  const byObject = storyRequest(facts, { [fns[0].id]: notes[0] });
  assert.equal(byObject.id, r.id, 'notes as a list or keyed by id give the same request');
});

test('findings: read-route functions only, route order, comment-only left out; no route falls back to all code', () => {
  const a = fnOf('lib/b.js', 'second', 2), b = fnOf('lib/a.js', 'first', 1);
  const c = fnOf('lib/a.js', 'noted', 3, { commentOnly: true, fold: 'comment-only' });
  const t = fnOf('test/a.test.js', 'helper', 4);
  const facts = factsOf([a, b, c, t]);
  facts.route.read = [{ path: 'lib/a.js', lines: 3 }, { path: 'lib/b.js', lines: 3 }];
  const r = findingsRequest(facts);
  assert.deepEqual(Object.values(r.ids), [b.id, a.id]);
  assert.ok(r.prompt.indexOf('name="first"') < r.prompt.indexOf('name="second"'));
  assert.doesNotMatch(r.prompt, /name="helper"|name="noted"/);
  facts.route.read = [];
  const all = findingsRequest(facts);
  assert.deepEqual(Object.values(all.ids), [a.id, b.id, t.id], 'no route: every function with code changed');
  const none = findingsRequest(factsOf([c]));
  assert.deepEqual(none.ids, {});
  assert.match(none.prompt, /\(none: no code changed\)/);
});

test('findings: the total size is bounded and the rest are named as not shown', () => {
  const fns = Array.from({ length: 40 }, (_, i) => {
    const f = fnOf('lib/wide.js', `part${i + 1}`, i + 1);
    f.diff = Array.from({ length: 100 }, (_, k) => ['+', null, k + 1, `  item_${k} = ${'y'.repeat(70)};`]);
    return f;
  });
  const r = findingsRequest(factsOf(fns));
  assert.ok(r.prompt.length < BOUNDS.findingsChars + 20_000);
  assert.ok(Object.keys(r.ids).length < 40);
  assert.match(r.prompt, /Not shown for size, so no finding may name them: part\d+/);
});

test('answer shapes: functions entries checked against the ids asked', () => {
  const [r] = functionRequests(factsOf(many(3)));
  assert.deepEqual(answerProblems(r, { functions: [
    { id: 'f1', summary: 's', change: 'c' }, { id: 'f2', summary: 's', change: 'c' }, { id: 'f3', summary: 's', change: 'c' },
  ] }), { fatal: [], soft: [] });
  const p = answerProblems(r, { functions: [{ id: 'f1', summary: 's', change: 'c' }, { id: 'f9', summary: 's', change: 'c' }] });
  assert.deepEqual(p.fatal, []);
  assert.ok(p.soft.some((s) => s.includes('"f9" is not one of the functions given')));
  assert.ok(p.soft.some((s) => s.includes('no entry for: f2, f3')));
  assert.deepEqual(answerProblems(r, { notes: [] }).fatal, ['the answer has no "functions" list']);
  const stable = Object.values(r.ids).map((id) => ({ id, summary: 's', change: 'c' }));
  assert.deepEqual(answerProblems(r, { functions: stable }).soft, [], 'stable ids are accepted too');
});

test('answer shapes: story flows name listed functions, edges join steps; findings quote what was shown', () => {
  const facts = factsOf(many(2));
  const s = storyRequest(facts, []);
  const good = { oneLine: 'o', ask: 'a', beforeNow: [{ before: 'b', now: 'n' }], glossary: [], flows: [{ title: 't',
    steps: [{ id: 's1', label: 'l', fn: null, ext: 'caller', was: null, isNew: false },
      { id: 's2', label: 'l', fn: 'f1', ext: null, was: 'w', isNew: true }],
    edges: [{ from: 's1', to: 's2', label: null, kind: 'main' }] }] };
  assert.deepEqual(answerProblems(s, good), { fatal: [], soft: [] });
  const bad = structuredClone(good);
  bad.flows[0].steps[1].fn = 'f77';
  bad.flows[0].edges.push({ from: 's1', to: 's9', label: null, kind: 'main' });
  bad.flows[0].edges.push({ from: 's1', to: 's2', label: null, kind: 'sideways' });
  const soft = answerProblems(s, bad).soft;
  assert.equal(soft.length, 3);

  const f = findingsRequest(facts);
  const finding = { tier: 'must-know', title: 't', oneLine: 'o', fns: ['f2'], quote: 'const b = a * 2;' };
  assert.deepEqual(answerProblems(f, { findings: [finding] }), { fatal: [], soft: [] });
  assert.deepEqual(answerProblems(f, { findings: [] }), { fatal: [], soft: [] });
  const wrong = answerProblems(f, { findings: [{ ...finding, tier: 'urgent', quote: 'const b = a / 2;' }] }).soft;
  assert.equal(wrong.length, 2);
  // A quote must come from the code of a diff line, as the checks require: not the line numbers, marks or commit text.
  for (const quote of ['22 + ', 'Totals were offset', 'Functions a reviewer reads']) {
    assert.equal(answerProblems(f, { findings: [{ ...finding, quote }] }).soft.length, 1, quote);
  }
  assert.deepEqual(answerProblems(f, { list: [] }).fatal, ['the answer has no "findings" list']);
});

test('ids map back to stable ids; unknown ids are kept for the checks to drop', () => {
  const facts = factsOf(many(2));
  const [r] = functionRequests(facts);
  const mapped = mapAnswerIds(r, { functions: [{ id: 'f2', summary: 's', change: 'c' }, { id: 'f8', summary: 's', change: 'c' }] });
  assert.deepEqual(mapped.functions.map((e) => e.id), [facts.functions[1].id, 'f8']);
  const s = storyRequest(facts, []);
  const story = mapAnswerIds(s, { flows: [{ steps: [{ id: 's1', fn: 'f1' }, { id: 's2', fn: null, ext: 'x' }], edges: [] }] });
  assert.deepEqual(story.flows[0].steps.map((x) => x.fn), [facts.functions[0].id, null]);
  const f = findingsRequest(facts);
  assert.deepEqual(mapAnswerIds(f, { findings: [{ fns: ['f1', facts.functions[1].id] }] }).findings[0].fns,
    [facts.functions[0].id, facts.functions[1].id]);
});

test('a re-ask appends the problems and has its own id', () => {
  const [r] = functionRequests(factsOf(many(2)));
  const again = retryRequest(r, ['no entry for: f2']);
  assert.notEqual(again.id, r.id);
  assert.equal(again.retryOf, r.id);
  assert.ok(again.prompt.startsWith(r.prompt));
  assert.match(again.prompt, /Your previous answer could not be used:\n- no entry for: f2\n/);
  assert.deepEqual(again.ids, r.ids);
  assert.equal(retryRequest(r, ['no entry for: f2']).id, again.id);
});

test('the limit re-ask lists exactly the failing fields with their counts, keeps the prompt as its prefix', () => {
  const [r] = functionRequests(factsOf(many(2)));
  const long = 'one two three four five six seven eight nine ten eleven twelve thirteen';
  const answer = { functions: [{ id: 'f1', summary: long, change: 'Fine.' }, { id: 'f2', summary: 'Short.', change: 'Fine.' }] };
  const fails = limitFailures('functions', answer);
  assert.deepEqual(fails.map((f) => [f.key, f.words, f.limit]), [['f1.summary', 13, LIMITS.summary]]);
  const fix = fixRequest(r, fails);
  assert.ok(fix.prompt.startsWith(r.prompt), 'the same prefix, for the prompt cache');
  assert.equal(fix.system, r.system);
  assert.notEqual(fix.id, r.id);
  assert.deepEqual(fix.fix, ['f1.summary']);
  assert.ok(fix.prompt.includes(`- "f1.summary": 13 words, at most ${LIMITS.summary}; write it in 9 words or fewer: "${long}"`));
  assert.ok(fix.prompt.endsWith('{"fields":{"f1.summary":"..."}}'));
  assert.deepEqual(fixFields(fix, { fields: { 'f1.summary': 'Short now.', 'f2.change': 'not asked' } }), { 'f1.summary': 'Short now.' });
  assert.equal(fixFields(fix, { functions: [] }), null);
  const merged = mergeFixes(answer, fails, { 'f1.summary': 'Short now.' });
  assert.deepEqual(merged.fixed, ['f1.summary']);
  assert.equal(merged.answer.functions[0].summary, 'Short now.');
  assert.equal(answer.functions[0].summary, long, 'the first answer is not changed');
  assert.deepEqual(mergeFixes(answer, fails, { 'f1.summary': long }).fixed, [], 'a field still over its limit is not taken');
});

test('limit failures in a story: a list over its count is asked for whole, the texts inside it are not listed', () => {
  const step = (id, label) => ({ id, label, fn: null, ext: 'x', was: null, isNew: false });
  const story = { oneLine: 'a b c d e f g h i j k l m n o p', ask: 'Fine.', beforeNow: [{ before: 'b', now: 'n' }],
    flows: [{ title: 'T', steps: [step('s1', 'one two three four five six'), step('s2', 'ok')], edges: [] },
      { title: 'U', steps: Array.from({ length: LIMITS.stepsMax + 1 }, (_, i) => step(`s${i}`, 'one two three four five six')), edges: [] }],
    glossary: Array.from({ length: LIMITS.glossaryMax + 1 }, (_, i) => ({ term: `t${i}`, def: 'd' })) };
  const fails = limitFailures('story', story);
  assert.deepEqual(fails.map((f) => f.key), ['oneLine', 'flows[0].steps[0].label', 'flows[1]', 'glossary']);
  assert.deepEqual(fails.filter((f) => f.list).map((f) => [f.whole, f.count, f.limit]),
    [[true, LIMITS.stepsMax + 1, LIMITS.stepsMax], [false, LIMITS.glossaryMax + 1, LIMITS.glossaryMax]]);
  const merged = mergeFixes(story, fails, { 'flows[0].steps[0].label': 'Five words or fewer', glossary: [{ term: 't1', def: 'd' }],
    'flows[1]': { title: 'U', steps: [step('s1', 'ok')], edges: [] } });
  assert.deepEqual(merged.fixed, ['flows[0].steps[0].label', 'flows[1]', 'glossary']);
  assert.equal(merged.answer.oneLine, story.oneLine);
  assert.equal(merged.answer.glossary.length, 1);
});

test('the limits the prompts state are the limits the checks count: one frozen object, stated at each prompt end', async () => {
  const { LIMITS: checked } = await import('../src/checks.mjs');
  assert.equal(checked, LIMITS);
  assert.ok(Object.isFrozen(LIMITS));
  const facts = factsOf(many(2));
  const reqs = [...functionRequests(facts), storyRequest(facts, {}), findingsRequest(facts)];
  for (const r of reqs) {
    const tail = r.prompt.split('\n').slice(-3).join('\n');
    assert.match(tail, /^Shape: \{/m, `${r.kind}: the shape before the end`);
    assert.match(tail, /^Limits/m, `${r.kind}: the limits beside the shape`);
  }
  assert.ok(reqs[0].prompt.includes(`"summary" at most ${LIMITS.summary}`));
});

test('no prompt or code names a function or commit of the reference example', () => {
  const example = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'ref', 'meaning-d211.json'), 'utf8'));
  const names = example.functions.map((f) => f.name);
  for (const file of ['src/requests.mjs', 'src/transport-claude.mjs', 'src/answers.mjs']) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const name of [...names, example.commit]) assert.ok(!new RegExp(`\\b${name}\\b`).test(text), `${file} names ${name}`);
  }
});
