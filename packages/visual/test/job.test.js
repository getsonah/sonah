// The whole job end to end on a real commit, with the stand-in CLI as the transport (no real model call).
// Run 1 asks every request through the fake CLI; a replay from the stored answers gives the same bytes; replay-only
// with an empty store stops "pending" and names the requests it needs. The real commit is one of this repository's own:
// without its history (a shallow clone, an export without history) these tests skip. `sonah visual` has its own tests.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extract } from '../src/extract.mjs';
import { functionRequests, storyRequest, findingsRequest, mapAnswerIds, STORY_SYSTEM, FINDINGS_SYSTEM } from '../src/requests.mjs';
import { checkFunctions } from '../src/checks.mjs';
import { claudeTransport, TransportError } from '../src/transport-claude.mjs';
import { renderFinished, runJob } from '../src/job.mjs';
import { shareLink } from '../src/render.mjs';
import { uploadBody, scriptJson } from '../src/upload.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fake-claude.mjs');
// This repository (packages/visual/test is three folders down), unless another checkout is named.
const REPO = process.env.SONAH_TEST_REPO ?? join(HERE, '..', '..', '..');
const HEAD = process.env.SONAH_TEST_COMMIT ?? '5bcdc782';
const BASE = `${HEAD}^`;

const hasCommit = (repo, sha) => {
  if (!existsSync(repo)) return false;
  try { execFileSync('git', ['-C', repo, 'cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' }); return true; } catch { return false; }
};
const skip = !hasCommit(REPO, HEAD) && 'repository not here';

const OUTPUTS = ['facts.json', 'requests', 'answers', 'meaning.json', 'findings.json', 'dropped.json', 'page.html', 'run.json'];
const read = (dir, name) => readFileSync(join(dir, name), 'utf8');
const json = (dir, name) => JSON.parse(read(dir, name));
const firstLine = (s) => s.split('\n')[0];

let scratch;
before(() => { chmodSync(FAKE, 0o755); scratch = mkdtempSync(join(tmpdir(), 'sonah-visual-job-')); });
after(() => rmSync(scratch, { recursive: true, force: true }));

// Answers a stand-in would give, built from the request alone (its ids) and the facts, so they hold for any commit.
function functionsAnswer(req) {
  return { functions: Object.keys(req.ids).map((id) => ({ id, summary: 'Does its part of the change.',
    change: 'Changes what this part does in the new version.' })) };
}

function storyAnswer(facts, req) {
  const short = Object.fromEntries(Object.entries(req.ids).map(([s, stable]) => [stable, s]));
  const fns = facts.functions.filter((f) => f.fold == null).slice(0, 3).map((f) => short[f.id]);
  const named = facts.functions.find((f) => f.diff.some((r) => r[0] !== '~' && r[3].includes(f.name)));
  const steps = [
    { id: 's1', label: 'A caller starts it', fn: null, ext: 'caller', was: null, isNew: false },
    ...fns.map((fn, i) => ({ id: `s${i + 2}`, label: `Step ${i + 1} runs`, fn, ext: null, was: i === 0 ? 'ran the old way' : null,
      isNew: i < 2 })),
    { id: 'sx', label: 'The error path', fn: null, ext: 'error handler', was: null, isNew: true },
  ];
  const chain = steps.filter((s) => s.id !== 'sx');
  const edges = chain.slice(1).map((s, i) => ({ from: chain[i].id, to: s.id, label: null, kind: 'main' }));
  edges.push({ from: 's2', to: 'sx', label: 'when it fails', kind: 'branch' });
  edges.push({ from: chain.at(-1).id, to: 's2', label: 'retry', kind: 'signal' });
  return {
    oneLine: 'The change makes this part of the program work differently.',
    ask: 'Make the program behave as the commit message says.',
    beforeNow: [{ before: 'It worked the old way.', now: 'It works the new way.' }],
    flows: [{ title: 'One request through the change', steps, edges }],
    glossary: [
      ...(named ? [{ term: named.name, def: 'A function this change touches.' }] : []),
      { term: 'zz-term-found-in-no-diff', def: 'Dropped by the check.' },
    ],
  };
}

function findingsAnswer(facts, req) {
  const byId = new Map(facts.functions.map((f) => [f.id, f]));
  const [short, stable] = Object.entries(req.ids)[0];
  const row = byId.get(stable).diff.find((r) => r[0] === '+' && r[3].trim().length >= 8);
  const quote = row[3].trim().slice(0, 60).trim();
  return { findings: [
    { tier: 'must-know', title: 'A consequence a reviewer should know', oneLine: 'When this line runs, the new path is taken.',
      fns: [short], quote },
    { tier: 'must-act', title: 'A finding whose quote is made up', oneLine: 'When it runs, nothing shown supports it.',
      fns: [short], quote: 'this text is in no diff at all' },
  ] };
}

// The fake CLI's rules: one per functions batch (by its closing line), then the story and findings by system prompt.
function standInRules(facts) {
  const fnReqs = functionRequests(facts);
  const fnRecords = fnReqs.map((r) => ({ id: r.id, kind: r.kind, answer: mapAnswerIds(r, functionsAnswer(r)), error: null }));
  const story = storyRequest(facts, checkFunctions(facts, fnRecords).value);
  const findings = findingsRequest(facts);
  return [
    ...fnReqs.map((r) => ({ when: r.prompt.split('\n').at(-1), text: JSON.stringify(functionsAnswer(r)) })),
    { when: firstLine(STORY_SYSTEM), text: `Here it is:\n${JSON.stringify(storyAnswer(facts, story))}` },
    { when: firstLine(FINDINGS_SYSTEM), text: JSON.stringify(findingsAnswer(facts, findings)) },
  ];
}

test('job: the whole job on a real commit with the stand-in CLI; a replay gives the same bytes', { skip }, async () => {
  const facts = await extract({ repoDir: REPO, base: BASE, head: HEAD });
  const home = mkdtempSync(join(scratch, 'home-'));
  writeFileSync(join(home, 'fake-claude.json'), JSON.stringify({ rules: standInRules(facts) }));
  const transport = claudeTransport({ bin: FAKE, env: { PATH: process.env.PATH, HOME: home } });

  const live = join(scratch, 'live');
  const run = await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: live, transport });
  assert.equal(run.status, 'complete', JSON.stringify(run.error ?? run.needed));
  for (const name of OUTPUTS) assert.ok(existsSync(join(live, name)), `${name} is written`);
  assert.equal(read(live, 'facts.json'), `${JSON.stringify(facts, null, 1)}\n`, 'facts.json is the extract');

  // Every request asked was written for a stand-in, and every one has its answer stored under the same id.
  const requests = readdirSync(join(live, 'requests')).sort();
  const answers = readdirSync(join(live, 'answers')).sort();
  assert.deepEqual(answers, requests);
  const fnBatches = functionRequests(facts).length;
  const kinds = run.requests.map((r) => r.kind);
  assert.deepEqual(kinds, [...Array(fnBatches).fill('functions'), 'story', 'findings']);
  assert.equal(requests.length, fnBatches + 3, 'the findings re-ask is written too');
  for (const r of run.requests) {
    assert.equal(r.by, 'claude-cli');
    assert.equal(r.model, 'claude-sonnet-test');
    assert.equal(r.replayed, false);
  }
  const findingsRun = run.requests.find((r) => r.kind === 'findings');
  assert.equal(findingsRun.reasked.length, 1, 'a quote not in the prompt is asked once more');
  assert.equal(run.totals.calls, fnBatches + 3, 'the re-ask is a call of its own');
  assert.deepEqual(run.totals.by, { 'claude-cli': fnBatches + 3 });
  assert.ok(run.totals.costUsd > 0);

  // Meaning and findings as checked: the made-up quote and the made-up term are dropped with their closed reasons.
  const meaning = json(live, 'meaning.json');
  const unfolded = facts.functions.filter((f) => f.fold == null).map((f) => f.id);
  assert.deepEqual(Object.keys(meaning.functions), unfolded);
  assert.equal(meaning.story.flows.length, 1);
  assert.equal(meaning.story.flows[0].steps.length, 5);
  const findings = json(live, 'findings.json');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].tier, 'must-know');
  const reasons = json(live, 'dropped.json').map((d) => d.reason).sort();
  assert.deepEqual(reasons, ['quote_not_in_diff', 'term_not_in_diff']);
  assert.deepEqual(run.totals.dropped, { quote_not_in_diff: 1, term_not_in_diff: 1 });

  // The page: five stops in order, the story, the finding, every function's data, the run footer, no broken values.
  const html = read(live, 'page.html');
  const stops = ['what', 'how', 'where', 'decide', 'read'].map((s) => html.indexOf(`<section class="stop" id="${s}"`));
  assert.ok(stops.every((at, i) => at > 0 && (i === 0 || at > stops[i - 1])), 'the five stops, in order');
  assert.ok(html.includes(meaning.story.oneLine));
  assert.ok(html.includes('One request through the change'));
  assert.ok(html.includes(findings[0].title));
  const data = JSON.parse(html.match(/const SONAH = (\{.*\});\n/)[1]);
  assert.deepEqual(Object.keys(data.fn).sort(), facts.functions.map((f) => f.id).sort());
  assert.ok(html.includes('claude-sonnet-test'), 'the footer names the model');
  // No broken value in an attribute or a text node (the diffs' own code may say "undefined", so only whole values).
  const broken = html.match(/(?:="|>)(?:undefined|null|NaN|\[object Object\])(?:"|<)|(?:[\s,="])NaN[\s,"]/);
  assert.equal(broken, null, broken && html.slice(Math.max(0, broken.index - 120), broken.index + 60));
  if (process.env.SONAH_TEST_KEEP) cpSync(live, process.env.SONAH_TEST_KEEP, { recursive: true });

  // Replay: the stored answers alone give the same files; a second replay gives the same run.json too.
  const replay = join(scratch, 'replay');
  cpSync(join(live, 'answers'), join(replay, 'answers'), { recursive: true });
  const again = await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: replay, transport: null });
  assert.equal(again.status, 'complete');
  for (const name of ['facts.json', 'meaning.json', 'findings.json', 'dropped.json', 'page.html'])
    assert.equal(read(replay, name), read(live, name), `${name} replays byte for byte`);
  assert.deepEqual(readdirSync(join(replay, 'requests')).sort(), requests);
  const strip = (r) => ({ ...r, requests: r.requests.map(({ replayed, ...x }) => x) });
  assert.deepEqual(strip(json(replay, 'run.json')), strip(run), 'run.json differs only in "replayed"');
  assert.ok(json(replay, 'run.json').requests.every((r) => r.replayed));
  const before = read(replay, 'run.json');
  await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: replay, transport: null });
  assert.equal(read(replay, 'run.json'), before);
  assert.equal(read(replay, 'page.html'), read(live, 'page.html'));
});

test('job: a local run\'s page carries the upload the client would send; drawn again, the same bytes', { skip }, async () => {
  const out = join(scratch, 'local');
  cpSync(join(scratch, 'live', 'answers'), join(out, 'answers'), { recursive: true });
  const shareUrl = shareLink('http://127.0.0.1:9', { owner: 'acme', repo: 'widgets', head: execFileSync('git', ['-C', REPO, 'rev-parse', HEAD], { encoding: 'utf8' }).trim() });
  const run = await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: out, transport: null, mode: 'local', shareUrl, branch: 'feature/x' });
  assert.equal(run.status, 'complete');
  const html = read(out, 'page.html');
  const text = /<script type="application\/json" id="sonah-upload" data-action="http:\/\/127\.0\.0\.1:9\/share">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(text, 'the page carries its upload');
  // exactly the body the laptop client posts: the files of the run, the page drawn again in mode hosted
  const body = uploadBody({ owner: 'acme', name: 'widgets', branch: 'feature/x', page: await renderFinished(out, { mode: 'hosted' }),
    facts: json(out, 'facts.json'), meaning: json(out, 'meaning.json'), findings: json(out, 'findings.json'), run: json(out, 'run.json') });
  assert.equal(text, scriptJson(body));
  assert.equal(await renderFinished(out, { mode: 'local', shareUrl, branch: 'feature/x' }), html, 'drawn again, the same bytes');
  // the hosted page of the same run carries none
  assert.ok(!(await renderFinished(out)).includes('<script type="application/json"'));
});

test('job: replay-only with an empty store is pending and names the requests it needs', { skip }, async () => {
  const facts = await extract({ repoDir: REPO, base: BASE, head: HEAD });
  const out = join(scratch, 'empty');
  const run = await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: out, transport: null });
  assert.equal(run.status, 'pending');
  // The functions and the findings are asked at once; the story waits for the functions.
  const want = [...functionRequests(facts).map((r) => r.id), findingsRequest(facts).id];
  assert.deepEqual(run.needed, want);
  assert.deepEqual(readdirSync(join(out, 'requests')).sort(), want.map((id) => `${id}.json`).sort());
  for (const id of want) {
    const req = json(join(out, 'requests'), `${id}.json`);
    assert.equal(req.id, id);
    assert.ok(req.system && req.prompt && req.ids, 'a stand-in gets the whole request');
  }
  assert.deepEqual(json(out, 'run.json').needed, want);
  assert.equal(json(out, 'run.json').totals.calls, 0);
  for (const name of ['page.html', 'meaning.json', 'findings.json']) assert.ok(!existsSync(join(out, name)), `no ${name} yet`);
});

test('job: a story or findings call that failed ends the job in error, with no page', { skip }, async () => {
  const facts = await extract({ repoDir: REPO, base: BASE, head: HEAD });
  for (const failing of ['findings', 'story']) {
    const out = join(scratch, `failed-${failing}`);
    const transport = async (req) => {
      if (req.kind === failing) throw new TransportError(failing === 'findings' ? 'call_failed' : 'timeout');
      const answer = req.kind === 'functions' ? functionsAnswer(req) : req.kind === 'story' ? storyAnswer(facts, req) : { findings: [] };
      return { text: JSON.stringify(answer), model: 'stand-in', costUsd: 0, ms: 1 };
    };
    const run = await runJob({ repoDir: REPO, base: BASE, head: HEAD, outDir: out, transport });
    assert.equal(run.status, 'error', failing);
    assert.equal(run.error, `the ${failing} call failed`);
    for (const name of ['page.html', 'meaning.json', 'findings.json']) assert.ok(!existsSync(join(out, name)), `no ${name}`);
  }
});
