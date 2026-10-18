// D105 (F2 part A; amends D92): one request, one bound, a manifest. The code step's review request is a frozen
// list of blocks, each within its frozen cap; only when their sum is over the bound do the lowest give way, in whole units
// (the earliest commands, then the largest hunks, then the largest rule files), each named in fixed words and in the
// manifest; nothing is cut inside a line; the review is not sent only when its minimum does not fit (too large to send).
// The commands are listed once, numbered. Every agent's reading record is kept, and what the code review saw is computed
// from the manifest and those records alone.
//
// Since D108 the code step sends part B by default (D106: the changed files whole and the session's reads; owner,
// 2026-10-17: "Yes, keep it on for now"). These tests run part A, the setting off (`runCodePass({ wholeFiles: false
// })`), whose bytes they pin; d106-whole-files.test.js holds the same invariants with part B on.
//
// Synthetic sessions and files, an in-memory repository reader and deterministic fake agents: no recording, no model, no
// network. Each invariant is a test that fails on a mutant of its rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_SHOWN_STATES, CODE_LEFT_OUT_REASONS, CODE_SEEN_STATES, CODE_FILE_STATES, CODE_DIFF_STATES }
  from '../src/ledger.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass, codeSeenOf, runRecordOf, changeBlock,
  CODE_RULE_BLOCK_MAX_BYTES, CODE_CHANGE_BLOCK_MAX_BYTES, CODE_REQUEST_BLOCKS, RULE_LEFT_OUT_WORDS, AGENT_RUN_FIELD }
  from '../src/code-pass.js';
import { CHANGE_ROW_WORDS, SHOWN_SIDE_BYTES, commandsLeftOutLine, shownLines } from '../src/code-context.js';
import { reviewInputBytes } from '../src/challenge.js';
import { CODE_REPORT_WORDS, codeCoverageLines, codeFooterLines, codeSeenLines, codeUnseenFiles } from '../src/code-report.js';
import { buildCodeSession, holds, allSound, verifiedFinding, batchItems, accountsHold, accountsHoldWith }
  from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const GIT = { kind: 'git', commit: 'a'.repeat(40), how: 'reflog' };
const ASK = 'SYNTHETIC_ASK: add the three modules and run the tests.';
const RULES = 'SYNTHETIC_RULES: every module exports one function.';

/** `n` lines of `width` bytes each (a file's text, ending in a line end). */
const linesOf = (tag, n, width = 40) => Array.from({ length: n }, (_, i) => `${tag} ${String(i + 1).padStart(5, '0')}`
  .padEnd(width, '.')).join('\n') + '\n';
/** git's own patch of an added file. */
const addedPatch = (path, text) => {
  const rows = text.split('\n').slice(0, -1);
  return [`diff --git a/${path} b/${path}`, 'new file mode 100644', '--- /dev/null', `+++ b/${path}`,
    `@@ -0,0 +1,${rows.length} @@`, ...rows.map((r) => `+${r}`), ''].join('\n');
};
/** git's own patch of a file whose line `at` (1-based) changed from `before`'s to `after`'s, three lines of context. */
const modifiedPatch = (path, before, after, at) => {
  const a = before.split('\n').slice(0, -1), b = after.split('\n').slice(0, -1);
  const from = Math.max(1, at - 3), to = Math.min(a.length, at + 3);
  const rows = [];
  for (let l = from; l <= to; l++) {
    if (l === at) rows.push(`-${a[l - 1]}`, `+${b[l - 1]}`); else rows.push(` ${a[l - 1]}`);
  }
  const count = to - from + 1;
  return [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`,
    `@@ -${from},${count} +${from},${count} @@`, ...rows, ''].join('\n');
};

/**
 * A session that writes `files` (path -> text) and then runs `commands` (each a command text), the project's rule file
 * loaded (`rules`; `moreRules`, path -> text, more rule files after it); and the snapshot of that change with a git base
 * (each file added, unless `modified` gives its text at the start commit and the line that changed; `patches` replaces a
 * path's patch).
 */
function fixture({ files, commands = [], rules = RULES, moreRules = {}, modified = {}, beforeEdits = [], patches = {} }) {
  const blobs = { ask: ASK, rules, ok: 'ok', ...Object.fromEntries(Object.values(moreRules)
    .map((text, at) => [`rules-${at}`, text])) };
  const T1 = { turn: 'T1' };
  const region = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];
  const command = (id, text) => {
    blobs[`cmd-${id}`] = text;
    return [{ id, kind: 'invocation', tool: 'Bash', operation: 'command', paths: [], input: [], changes: [],
      callKey: id, command: region(`cmd-${id}`), ...T1 },
    { id: `${id}-r`, kind: 'observation', invocation: id, blob: 'ok', ...T1 }];
  };
  const specs = [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    ...beforeEdits.flatMap((text, at) => command(`A${at + 1}`, text)),
    ...Object.entries(files).map(([path, text], at) => {
      blobs[`file-${at}`] = text;
      return { id: `W${at + 1}`, kind: 'invocation', write: path, blob: `file-${at}`, ...T1 };
    }),
    ...commands.flatMap((text, at) => command(`B${at + 1}`, text))];
  const session = buildCodeSession('sess-d105', blobs, specs,
    { projectInstructions: [...(rules === null ? [] : [{ path: 'CLAUDE.md', blob: 'rules' }]),
      ...Object.keys(moreRules).map((path, at) => ({ path, blob: `rules-${at}` }))] });
  const plan = codeSnapshotPlan(session, { root: ROOT });
  const reads = plan.map((entry) => {
    const text = files[entry.path];
    const before = modified[entry.path];
    return before ? { path: entry.path, bytes: enc(text), type: 'modified', base: { bytes: enc(before.text) },
      patch: patches[entry.path] ?? modifiedPatch(entry.path, before.text, text, before.at) }
      : { path: entry.path, bytes: enc(text), type: 'added', patch: patches[entry.path] ?? addedPatch(entry.path, text) };
  });
  const snapshot = freezeCodeSnapshot(plan, reads, { base: GIT });
  const now = { ...files, 'CLAUDE.md': rules ?? '', ...moreRules };
  const before = Object.fromEntries(Object.entries(modified).map(([path, m]) => [path, m.text]));
  const fileOf = (set, path) => {
    const named = String(path).replace(`${ROOT}/`, '');
    return Object.hasOwn(set, named) ? { path: named, text: set[named], sha256: sha(set[named]) } : null;
  };
  const repo = { root: ROOT, top: ROOT, read: (path) => fileOf(now, path), base: (path) => fileOf(before, path) };
  const report = { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], promises: [],
    requirements: [{ text: 'Add the modules.', instruction: { eventId: 'I1', role: 'instruction', quote: ASK },
      status: 'done' }], decisions: [], failures: [], writtenClaims: [], pivots: [] };
  return { session, snapshot, repo, report };
}

/** The fake agents: the review agent answers `review(prompt)` (default nothing), with `run` set on its answer as the
 *  transport sets it; a finding's checker answers `verify(finding, request)` (default: it holds), the questions' checker
 *  `batch(items, request)` (default: every question sound). `seen` receives every request. */
function agents({ review = () => ({ findings: [], questions: [] }), run = null, seen = [], verify = holds,
  batch = allSound, account = accountsHold } = {}) {
  const withRun = (answer, label) => {
    const record = typeof run === 'function' ? run(label) : run;
    if (record) Object.defineProperty(answer, AGENT_RUN_FIELD, { value: record, enumerable: false });
    return answer;
  };
  return async (request) => {
    // F3b (D111): an accounting agent's request answers every item as holding, and stays out of `seen`: this file
    // reads the review's requests and its checks' (d111-accounting.test.js reads the accounting's).
    if (/^code-account:\d+(:reask)?$/.test(request.label ?? '')) return account(request.prompt);
    seen.push(request);
    if (['code-review:agent', 'code-review:repair'].includes(request.label))
      return withRun(review(request.prompt, request), request.label);
    if (/^code-verify:F\d+/.test(request.label)) return withRun(verify(verifiedFinding(request.prompt), request),
      request.label);
    if (/^code-verify:batch/.test(request.label)) return withRun(batch(batchItems(request.prompt), request), request.label);
    throw new Error(`unexpected request ${request.label}`);
  };
}
/** Part A's run: the setting off (D108 turned it on by default). */
const runWith = (f, judge, bound = Infinity) => runCodePass({ report: f.report, session: f.session, snapshot: f.snapshot,
  repo: f.repo, judge, bound, base: GIT, root: ROOT, wholeFiles: false });

/** The three modules of the fixture: small, medium, large (their hunks 2, 20 and 60 lines long). */
const FILES = Object.freeze({ 'src/a.js': linesOf('alpha', 2), 'src/b.js': linesOf('beta', 20),
  'src/c.js': linesOf('gamma', 60) });
const COMMANDS = Object.freeze(Array.from({ length: 40 }, (_, i) => `npm test -- --grep case-${String(i + 1).padStart(2, '0')}`));
const commandLines = (prompt) => prompt.split('\n').filter((line) => line.startsWith('{"command":"C'));
const NO_MARK = /not shown …\]|characters not shown/;

test('D105: under the bound nothing is left out or padded; the request is the sum of its blocks, each within its cap',
  async () => {
    const f = fixture({ files: FILES, commands: COMMANDS });
    const seen = [];
    const result = await runWith(f, agents({ seen }));
    const [request] = seen;
    const { review } = result.codePass.manifest;
    assert.equal(review.sent, true);
    assert.deepEqual(review.files.map((x) => [x.path, x.state, x.shown, x.lines]), [['src/a.js', 'whole', [[1, 2]], 2],
      ['src/b.js', 'whole', [[1, 20]], 20], ['src/c.js', 'whole', [[1, 60]], 60]]);
    assert.deepEqual(review.rules, [{ path: 'CLAUDE.md', kind: 'project', state: 'whole', shown: [[1, 1]], lines: 1 }]);
    assert.deepEqual(review.commands, { count: 40, from: 1, inPart: [] });
    assert.equal(commandLines(request.prompt).length, 40);
    // The request's bytes are its brief and its blocks, joined: nothing padded, nothing else.
    const { brief, total, ...blocks } = review.bytes;
    assert.deepEqual(Object.keys(blocks), [...CODE_REQUEST_BLOCKS]);
    assert.equal(total, reviewInputBytes(request));
    assert.equal(total, brief + Object.values(blocks).reduce((a, b) => a + b, 0) + CODE_REQUEST_BLOCKS.length - 1);
    assert.ok(blocks.rules <= CODE_RULE_BLOCK_MAX_BYTES + 1_000 && blocks.change <= CODE_CHANGE_BLOCK_MAX_BYTES + 1_000);
    assert.doesNotMatch(request.prompt, NO_MARK);
    assert.deepEqual([result.codePass.footer, result.codePass.coverage], [[], 'complete']);
  });

test('D105: over the bound the lowest blocks give way in whole units — the earliest commands, then the largest hunks, '
  + 'then the largest rule files — each named in fixed words and in the manifest; the request always fits', async () => {
  const rules = linesOf('rule', 30);
  const f = fixture({ files: FILES, commands: COMMANDS, rules });
  const sizeAt = async (bound) => {
    const seen = [];
    const result = await runWith(f, agents({ seen }), bound);
    return { result, request: seen.find((r) => r.label === 'code-review:agent') ?? null };
  };
  const full = (await sizeAt(Infinity)).request;
  const fullBytes = reviewInputBytes(full);
  // One byte under: the earliest command leaves first (the latest are kept: each file's commands run to the last).
  const one = await sizeAt(fullBytes - 1);
  assert.ok(reviewInputBytes(one.request) <= fullBytes - 1);
  const kept = commandLines(one.request.prompt);
  assert.ok(kept.length < 40 && kept.length > 30, `${kept.length}`);
  const from = 40 - kept.length + 1;
  assert.equal(JSON.parse(kept[0]).command, `C${from}`);
  assert.ok(one.request.prompt.includes(commandsLeftOutLine(1, from - 1)));
  assert.deepEqual(one.result.codePass.manifest.review.commands, { count: 40, from, inPart: [] });
  assert.deepEqual(one.result.codePass.footer, [{ kind: 'commands_left_out', count: from - 1 }]);
  assert.equal(one.result.codePass.coverage, 'partial');
  assert.ok(one.result.codePass.manifest.review.files.every((x) => x.state === 'whole'), 'no hunk gave way first');
  // With every command gone and still over: the largest hunks leave next (src/c.js), named in the table of contents.
  // (The request with no command: the one above less the command lines it kept.)
  const withoutCommands = reviewInputBytes(one.request)
    - commandLines(one.request.prompt).reduce((n, line) => n + Buffer.byteLength(line) + 1, 0);
  const two = await sizeAt(withoutCommands - 50);
  const files = two.result.codePass.manifest.review.files;
  assert.deepEqual(files.map((x) => [x.path, x.state, x.reason ?? null]), [['src/a.js', 'whole', null],
    ['src/b.js', 'whole', null], ['src/c.js', 'left_out', 'request_bound']]);
  assert.deepEqual(two.result.codePass.manifest.review.commands.from, 41, 'every command left out first');
  assert.match(two.request.prompt, new RegExp(`^- src/c\\.js · added · ${CHANGE_ROW_WORDS.request_bound
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
  assert.deepEqual(two.result.codePass.footer.find((e) => e.kind === 'clipped'), { kind: 'clipped', path: 'src/c.js' });
  // Then the rule file, with every hunk gone and still over; and on every bound, the invariants.
  const sweep = [];
  let ruleLeftOut = 0;
  for (let bound = fullBytes; bound > 0; bound -= 997) {
    const { result, request } = await sizeAt(bound);
    const { review } = result.codePass.manifest;
    if (!review.sent) { sweep.push(bound); continue; }
    // The invariant on every bound: a request sent fits it, and is the review request the step sent.
    assert.ok(reviewInputBytes(request) <= bound, `${bound}`);
    assert.equal(review.bytes.total, reviewInputBytes(request));
    assert.doesNotMatch(request.prompt, NO_MARK);
    if (review.rules[0].state === 'left_out') {
      ruleLeftOut++;
      assert.equal(review.rules[0].reason, 'request_bound');
      assert.ok(review.files.every((x) => x.state === 'left_out'), 'every hunk gave way before the rule file');
      assert.ok(request.prompt.includes(RULE_LEFT_OUT_WORDS.request_bound));
      assert.ok(!request.prompt.includes(rules.slice(0, 40)));
    }
  }
  assert.ok(ruleLeftOut > 0, 'some bound left the rule file out');
  // Below the minimum: not sent, too large, never a call that did not answer; the bytes of each block are recorded.
  assert.ok(sweep.length > 0);
  const { result: dropped, request: none } = await sizeAt(sweep[0]);
  assert.equal(none, null);
  const pass = dropped.codePass;
  assert.deepEqual([pass.manifest.review.sent, pass.agent.terminal, pass.calls.review, pass.coverage],
    [false, 'not_sent', 0, 'missing']);
  assert.deepEqual(pass.footer, [{ kind: 'too_large', part: 'review', count: 1 }]);
  assert.ok(pass.manifest.review.bytes.total > sweep[0]);
  assert.deepEqual(Object.keys(pass.manifest.review.bytes), ['brief', ...CODE_REQUEST_BLOCKS, 'total']);
  assert.deepEqual(codeSeenOf(pass).files.map((x) => x.state), ['not_seen', 'not_seen', 'not_seen']);
});

test('D105: each block keeps its frozen cap — a rule file over the rule block\'s cap and hunks over the change block\'s are '
  + 'named, never cut; the review is still sent', async () => {
  const big = linesOf('huge', Math.ceil((CODE_RULE_BLOCK_MAX_BYTES + 10_000) / 40));
  const f = fixture({ files: { ...FILES, 'src/huge.js': linesOf('hugefile', Math.ceil((CODE_CHANGE_BLOCK_MAX_BYTES
    + 10_000) / 40)) }, commands: COMMANDS.slice(0, 3), rules: big });
  const seen = [];
  const result = await runWith(f, agents({ seen }), 1_620_000 * 4);
  const { review } = result.codePass.manifest;
  assert.equal(review.sent, true);
  assert.deepEqual(review.rules.map((x) => [x.state, x.reason, x.shown]), [['left_out', 'block_cap', []]]);
  assert.equal(review.rules[0].lines, big.split('\n').length - 1);
  assert.deepEqual(review.files.find((x) => x.path === 'src/huge.js').state, 'left_out');
  assert.deepEqual(review.files.find((x) => x.path === 'src/huge.js').reason, 'block_cap');
  assert.ok(review.bytes.change <= CODE_CHANGE_BLOCK_MAX_BYTES);
  assert.ok(review.bytes.rules <= CODE_RULE_BLOCK_MAX_BYTES);
  const [request] = seen;
  assert.ok(request.prompt.includes(RULE_LEFT_OUT_WORDS.block_cap));
  assert.ok(!request.prompt.includes(big.slice(0, 60)), 'no part of a rule file over the cap is shown');
  assert.match(request.prompt, /^- src\/huge\.js · added · not shown here: its hunks are over this block's bound/m);
});

test('D105: every path of the change is in the manifest once, with one closed state; every rule file once', async () => {
  const before = linesOf('beta', 20);
  const after = before.replace('beta 00007', 'BETA 00007');
  const f = fixture({ files: { ...FILES, 'src/b.js': after }, commands: COMMANDS.slice(0, 2),
    modified: { 'src/b.js': { text: before, at: 7 } } });
  // A binary file too: not shown, by its own state.
  f.snapshot.push({ path: 'img/logo.png', changed: true, recorded: false, state: 'binary', type: 'added',
    diff: 'withheld', base: null, hunks: [] });
  const result = await runWith(f, agents());
  const { review } = result.codePass.manifest;
  const paths = review.files.map((x) => x.path);
  assert.deepEqual(paths, [...new Set(paths)], 'each path once');
  assert.deepEqual(new Set(paths), new Set(result.codePass.files.map((x) => x.path)));
  for (const entry of review.files) {
    assert.ok(CODE_SHOWN_STATES.includes(entry.state), entry.path);
    if (['left_out', 'not_shown'].includes(entry.state)) {
      assert.ok([...CODE_LEFT_OUT_REASONS, ...CODE_FILE_STATES, ...CODE_DIFF_STATES].includes(entry.reason), entry.path);
      assert.deepEqual(entry.shown, []);
    }
  }
  assert.deepEqual(review.files.map((x) => [x.path, x.state, x.reason ?? null]), [['img/logo.png', 'not_shown', 'binary'],
    ['src/a.js', 'whole', null], ['src/b.js', 'hunks_only', null], ['src/c.js', 'whole', null]]);
  // git's hunk (lines 4 to 10), widened by the change block's context (five lines before, one after).
  assert.deepEqual(review.files.find((x) => x.path === 'src/b.js').shown, [[1, 11]]);
  assert.equal(review.rules.length, 1);
});

test('D105: each recorded command is listed once, numbered, whatever the number of changed files; a file names its first '
  + 'command after its last edit', async () => {
  const commands = COMMANDS.slice(0, 10);
  const one = await (async () => { const seen = []; await runWith(fixture({ files: { 'src/a.js': FILES['src/a.js'] },
    commands }), agents({ seen })); return seen[0].prompt; })();
  const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`src/m${String(i).padStart(2, '0')}.js`,
    linesOf(`m${i}`, 3)]));
  const seen = [];
  // A command before every edit is after no file's last edit: not listed.
  await runWith(fixture({ files: many, commands, beforeEdits: ['npm ci --synthetic-before-edits'] }), agents({ seen }));
  assert.ok(!seen[0].prompt.includes('synthetic-before-edits'));
  for (const prompt of [one, seen[0].prompt]) {
    const lines = commandLines(prompt);
    assert.equal(lines.length, 10);
    assert.deepEqual(lines.map((l) => JSON.parse(l).ran), commands);
    for (const text of commands) assert.equal(prompt.split(text).length - 1, 1, `${text} once`);
  }
  // Every file of the 25 names C1: every command came after every file's last edit.
  const first = seen[0].prompt.split('\n').filter((l) => l.startsWith('{"path":"src/m'));
  assert.equal(first.length, 25);
  assert.ok(first.every((l) => JSON.parse(l).firstCommandAfterLastEdit === 'C1'));
});

test('D105: nothing is cut inside a line — a long command shows its first and last whole lines, named by number, in the '
  + 'request and the manifest; a line longer than a side is shown in no part', async () => {
  const long = [`printf '${'x'.repeat(1_500)}'`, `echo ${'y'.repeat(1_500)}`, `printf '${'z'.repeat(1_500)}'`].join('\n');
  const oneLine = `node -e "${'w'.repeat(5_000)}"`;
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'] }, commands: ['npm test', long, oneLine] });
  const seen = [];
  const result = await runWith(f, agents({ seen }));
  const shown = commandLines(seen[0].prompt).map((l) => JSON.parse(l));
  assert.deepEqual(shown[1].ran, { lines: 3, parts: [{ lines: [1, 1], text: long.split('\n')[0] },
    { lines: [3, 3], text: long.split('\n')[2] }] });
  assert.deepEqual(shown[2].ran, { lines: 1, parts: [] }, 'one line over a side: no part of it, never cut');
  assert.deepEqual(result.codePass.manifest.review.commands.inPart, [
    { n: 2, reason: 'item_cap', shown: [[1, 1], [3, 3]], lines: 3, bytes: Buffer.byteLength(long) },
    { n: 3, reason: 'item_cap', shown: [], lines: 1, bytes: Buffer.byteLength(oneLine) }]);
  assert.doesNotMatch(seen[0].prompt, NO_MARK);
  // The rule (`shownLines`): whole up to twice a side; each part's text literally in the text.
  assert.equal(shownLines('a\nb').whole, true);
  const cut = shownLines(long);
  for (const part of cut.parts) assert.ok(long.includes(part.text));
  assert.equal(SHOWN_SIDE_BYTES, 2_000);
});

test('D105: every agent request\'s reading record is kept — paths and counts only — and what the code review saw is a pure '
  + 'function of the manifest and the review\'s records', async () => {
  const before = linesOf('beta', 20);
  const after = before.replace('beta 00007', 'BETA 00007');
  const gammaBefore = linesOf('gamma', 60);
  const gammaAfter = gammaBefore.replace('gamma 00030', 'GAMMA 00030');
  const f = fixture({ files: { ...FILES, 'src/b.js': after, 'src/c.js': gammaAfter }, commands: COMMANDS.slice(0, 2),
    modified: { 'src/b.js': { text: before, at: 7 }, 'src/c.js': { text: gammaBefore, at: 30 } } });
  const range = (path, startLine, numLines, totalLines) => ({ path: `${ROOT}/${path}`, startLine, numLines, totalLines });
  const review = { numTurns: 6, toolCalls: { Read: 3, Grep: 1, Glob: 0, StructuredOutput: 1 },
    reads: [`${ROOT}/src/b.js`, `${ROOT}/src/c.js`], readsUnranged: 1,
    // b.js read whole in two pages; c.js lines 40 to 45 only.
    readRanges: [range('src/b.js', 1, 10, 20), range('src/b.js', 11, 10, 20), range('src/c.js', 40, 6, 60)] };
  const checker = { numTurns: 2, toolCalls: { Read: 1, Grep: 0, Glob: 0, StructuredOutput: 1 }, reads: [`${ROOT}/src/c.js`],
    readsUnranged: 0, readRanges: [range('src/c.js', 1, 60, 60)] };
  const finding = { kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: the changed line is wrong', claims: [],
    input: 'SYNTHETIC input', trace: [{ step: 'It changed.', path: 'src/c.js', side: 'new', startLine: 30, endLine: 30,
      quote: 'GAMMA 00030' }], anchor: { path: 'src/c.js', side: 'new', startLine: 30, endLine: 30 }, leadsFrom: [] };
  const result = await runWith(f, agents({ review: () => ({ findings: [finding], questions: [] }),
    run: (label) => (label.startsWith('code-review') ? review : checker) }));
  const pass = result.codePass;
  // F3b (D111): the accounting's batch last; a fake accounting agent sets no run record.
  assert.deepEqual(pass.agents.map((a) => a.label), ['code-review:agent', 'code-verify:F1', 'code-account:1']);
  assert.equal(pass.agents[2].run, null);
  assert.deepEqual(pass.agents[0].run, { turns: 6, tools: { Read: 3, Grep: 1, Glob: 0 }, unranged: 1, reads: [
    { path: 'src/b.js', ranges: [[1, 20]], lines: 20 }, { path: 'src/c.js', ranges: [[40, 45]], lines: 60 }],
  unrangedPaths: [], failed: [] });
  for (const text of [...Object.values(FILES), after, gammaAfter]) assert.ok(!JSON.stringify(pass.agents)
    .includes(text.split('\n')[0]), 'no file text in a run record');
  // What the code review saw: a.js shown whole; b.js hunks plus a read of every line: whole; c.js hunks and lines 40 to
  // 45: in part, the lines named (its widened hunk 22 to 34 and the read). A checker's read of c.js is the checker's,
  // never the review's.
  const seen = codeSeenOf(pass);
  assert.deepEqual(seen.files.map((x) => [x.path, x.state, x.lines ?? null]), [['src/a.js', 'whole', null],
    ['src/b.js', 'whole', null], ['src/c.js', 'in_part', [[22, 34], [40, 45]]]]);
  assert.deepEqual(seen.rules.map((x) => x.state), ['whole']);
  assert.ok(seen.files.every((x) => CODE_SEEN_STATES.includes(x.state)));
  // Pure: the same manifest and records, the same answer; another field of the record changes nothing.
  assert.deepEqual(codeSeenOf({ manifest: structuredClone(pass.manifest), agents: structuredClone(pass.agents) }), seen);
  assert.deepEqual(codeSeenOf({ ...pass, findings: [], footer: [], coverage: 'missing' }), seen);
  // Without the review's records: hunks only for the modified files.
  assert.deepEqual(codeSeenOf({ manifest: pass.manifest, agents: [pass.agents[1]] }).files.map((x) => x.state),
    ['whole', 'hunks_only', 'hunks_only']);
  // The published finding's receipt sits on lines the request showed: counted inside.
  assert.deepEqual(pass.receiptPlaces, { inside: 1, outside: 0, unknown: 0 });
  // A run record with no transport ranges counts its Reads as unranged, gives no line, and keeps their paths.
  assert.deepEqual(runRecordOf({ [AGENT_RUN_FIELD]: { numTurns: 1, toolCalls: { Read: 2 }, reads: ['x'] } }),
    { turns: 1, tools: { Read: 2, Grep: null, Glob: null }, reads: [], unranged: 2, unrangedPaths: ['x'], failed: [] });
  assert.equal(runRecordOf({}), null);
});

test('D105: a file whose hunks show no line of it (a whole-file write with no git base) is seen only when the review '
  + 'reads it; unread, the footer names it and the coverage is partial', async () => {
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'] }, commands: ['npm test'] });
  const plan = codeSnapshotPlan(f.session, { root: ROOT });
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => ({ path: entry.path, bytes: enc(FILES[entry.path]) })),
    { base: { kind: 'recorded_edits' } });
  // F3b (D111): the change shows no line of the file, so the accounting quotes its first line from the repository.
  const account = accountsHoldWith({ path: 'src/a.js', side: 'new', startLine: 1, endLine: 1,
    quote: FILES['src/a.js'].split('\n')[0] });
  const runOn = (run) => runCodePass({ report: f.report, session: f.session, snapshot, repo: f.repo,
    judge: agents({ run, account }), bound: Infinity, base: { kind: 'recorded_edits' }, root: ROOT, wholeFiles: false });
  const unread = (await runOn(null)).codePass;
  assert.deepEqual(unread.manifest.review.files.map((x) => [x.path, x.state, x.shown]), [['src/a.js', 'hunks_only', []]]);
  assert.deepEqual(codeSeenOf(unread).files.map((x) => x.state), ['not_seen']);
  assert.deepEqual([unread.footer, unread.coverage], [[{ kind: 'withheld', path: 'src/a.js' }], 'partial']);
  const whole = (await runOn({ numTurns: 2, toolCalls: { Read: 1 }, reads: [`${ROOT}/src/a.js`], readsUnranged: 0,
    readRanges: [{ path: `${ROOT}/src/a.js`, startLine: 1, numLines: 2, totalLines: 2 }] })).codePass;
  assert.deepEqual(codeSeenOf(whole).files.map((x) => x.state), ['whole']);
  assert.deepEqual([whole.footer, whole.coverage], [[], 'complete']);
});

/** A run record as the agent transport /2 sets it, of Reads with these typed ranges (`ranges`), these Reads with none
 *  (`unranged`: paths relative to the working directory) and these Reads that failed (`failed`: `[path, reason]`). */
const runOf = (ranges, unranged = [], failed = []) => ({ numTurns: 2,
  toolCalls: { Read: ranges.length + unranged.length + failed.length },
  reads: [...new Set([...failed.map(([p]) => `${ROOT}/${p}`), ...ranges.map((r) => r.path),
    ...unranged.map((p) => `${ROOT}/${p}`)])],
  readRanges: ranges, readsUnranged: unranged.length, readsUnrangedPaths: unranged.map((p) => `${ROOT}/${p}`),
  readsFailed: failed.map(([p, reason]) => ({ path: `${ROOT}/${p}`, reason })) });
const rangeOf = (path, startLine, numLines, totalLines) => ({ path: `${ROOT}/${path}`, startLine, numLines, totalLines });

test('D105: a file whose hunks the request left out is covered only when the review saw its change — read in part, it '
  + 'keeps the coverage partial; read whole, it does not', async () => {
  // 10,250 lines of 40 bytes: over the change block's cap, so its hunks are left out (`block_cap`).
  const huge = linesOf('hugefile', 10_250);
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'], 'src/huge.js': huge }, commands: ['npm test'] });
  const runOn = async (run) => (await runWith(f, agents({ run }), 1_620_000 * 4)).codePass;
  const unread = await runOn(null);
  const entry = unread.manifest.review.files.find((x) => x.path === 'src/huge.js');
  assert.deepEqual([entry.state, entry.reason, entry.shown, entry.change, entry.lines],
    ['left_out', 'block_cap', [], [[1, 10_250]], 10_250], 'a left-out file keeps the lines its hunks hold');
  // D109 (its review): its hunks alone are over the change block's cap (`alone`): too large on its own, named among the
  // files withheld by their state, never as left out for room.
  assert.equal(entry.alone, true);
  assert.deepEqual([unread.footer, unread.coverage], [[{ kind: 'withheld', path: 'src/huge.js' }], 'partial']);
  // A default Read stops at 2,000 lines of a large file, and a review may read only the head: seen in part, its change
  // not seen, so the coverage stays partial; the readers name it with its lines, never as unseen.
  for (const ranges of [[rangeOf('src/huge.js', 1, 10, 10_250)], [rangeOf('src/huge.js', 1, 2_000, 10_250)]]) {
    const part = await runOn(runOf(ranges));
    const seen = codeSeenOf(part).files.find((x) => x.path === 'src/huge.js');
    assert.deepEqual([seen.state, seen.lines, seen.changeSeen], ['in_part', [[1, ranges[0].numLines]], false]);
    assert.deepEqual([part.footer, part.coverage], [[], 'partial']);
  }
  // Read over every line: seen whole, its change seen, the coverage complete.
  const whole = await runOn(runOf([rangeOf('src/huge.js', 1, 10_250, 10_250)]));
  assert.deepEqual(codeSeenOf(whole).files.map((x) => [x.path, x.state, x.changeSeen]),
    [['src/a.js', 'whole', true], ['src/huge.js', 'whole', true]]);
  assert.deepEqual([whole.footer, whole.coverage], [[], 'complete']);
});

test('D105: whether the review saw a file\'s change is a pure function of the manifest and the review\'s records — every '
  + 'line of its hunks shown or read on its side, or the whole file, and every row on the earlier side shown; a file read '
  + 'with no typed lines is never called unseen', () => {
  const file = (path, state, shown, extra = {}) => ({ path, state, side: 'new', shown, beforeUnshown: 0, lines: 60,
    ...extra });
  const manifest = { review: { sent: true, files: [
    file('a.js', 'left_out', [], { reason: 'request_bound', change: [[25, 34]] }),
    file('b.js', 'left_out', [], { reason: 'request_bound', change: [[25, 34]] }),
    file('c.js', 'hunks_only', [[25, 34]]),
    file('d.js', 'hunks_only', []),
    file('e.js', 'not_shown', [], { reason: 'binary', beforeUnshown: null }),
    file('f.js', 'left_out', [], { reason: 'block_cap', change: [[1, 60]] }),
    file('g.js', 'hunks_only', [[25, 34]]),
    file('h.js', 'not_shown', [], { reason: 'withheld', beforeUnshown: null }),
    { path: 'old.js', state: 'left_out', reason: 'block_cap', side: 'old', shown: [], change: [[1, 9]], lines: 9 },
    // The earlier side (the reviewer's probe): a modified file left out, whose hunks hold rows there.
    file('m.js', 'left_out', [], { reason: 'request_bound', change: [[25, 34]], beforeUnshown: 10 }),
    file('w1.js', 'left_out', [], { reason: 'request_bound', change: [[25, 34]], beforeUnshown: 10 }),
    file('w2.js', 'left_out', [], { reason: 'block_cap', change: [[1, 60]] }),
    file('w3.js', 'not_shown', [], { reason: 'unreadable', beforeUnshown: null }),
    file('w4.js', 'not_shown', [], { reason: 'oversize' }),
    file('w5.js', 'whole', [[1, 60]], { beforeUnshown: 4 }),
    file('w6.js', 'whole', [[1, 60]]),
    file('w7.js', 'left_out', [], { reason: 'request_bound', change: [[25, 34]], beforeUnshown: undefined })],
  rules: [{ path: 'AGENTS.md', kind: 'project', state: 'left_out', reason: 'request_bound', shown: [], lines: 900 },
    { path: 'RULES.md', kind: 'project', state: 'left_out', reason: 'request_bound', shown: [], lines: 9 }] } };
  const whole = (path) => ({ path, ranges: [[1, 60]], lines: 60 });
  const agents = [{ label: 'code-review:agent', run: { reads: [
    { path: 'a.js', ranges: [[1, 50]], lines: 60 }, { path: 'b.js', ranges: [[40, 45]], lines: 60 },
    { path: 'c.js', ranges: [[50, 55]], lines: 60 }, { path: 'd.js', ranges: [[1, 30]], lines: 60 },
    { path: 'e.js', ranges: [[1, 30]], lines: 60 }, { path: 'g.js', ranges: [[1, 5]], lines: 60 },
    { path: 'old.js', ranges: [[1, 9]], lines: 9 }, { path: 'AGENTS.md', ranges: [[1, 40]], lines: 900 },
    { path: 'm.js', ranges: [[1, 50]], lines: 60 }, whole('w1.js'), whole('w2.js'), whole('w3.js'), whole('w4.js'),
    whole('w7.js')],
  unrangedPaths: ['f.js', 'g.js', 'h.js', 'old.js', 'RULES.md'],
  // A Read that failed read nothing: it makes no file seen.
  failed: [{ path: 'b.js', reason: 'failed' }, { path: 'x.js', reason: 'refused' }] } },
  // A checker's reads are its own: they never make the review's change seen.
  { label: 'code-verify:F1', run: { reads: [{ path: 'b.js', ranges: [[1, 60]], lines: 60 }], unrangedPaths: [] } }];
  const seen = codeSeenOf({ manifest, agents });
  assert.deepEqual(seen.files.map((x) => [x.path, x.state, x.changeSeen]), [
    ['a.js', 'in_part', true], // left out, read over its hunks' lines, no row on the earlier side
    ['b.js', 'in_part', false], // left out, read elsewhere
    ['c.js', 'in_part', true], // its hunks shown
    ['d.js', 'in_part', false], // its hunks name no line: only the whole file shows its change
    ['e.js', 'in_part', false], // no hunk can be shown
    ['f.js', 'lines_unknown', false], // read with no typed lines: never unseen, its change not shown
    ['g.js', 'lines_unknown', true], // its hunks shown; which other lines it read is unknown
    ['h.js', 'lines_unknown', false],
    ['old.js', 'not_seen', false], // a deleted file's old side cannot be read now
    ['m.js', 'in_part', false], // read over its hunks' lines now, but no Read shows the rows they held before
    ['w1.js', 'whole', false], // read whole as it is now: still not as it was
    ['w2.js', 'whole', true], // read whole, and its hunks hold no row on the earlier side (an added file)
    ['w3.js', 'whole', false], // its hunks cannot be shown, and it is not added: an earlier side Sonah could not show
    ['w4.js', 'whole', true], // its hunks cannot be shown, but it was added: nothing before it
    ['w5.js', 'whole', false], // shown whole (part B) while its hunks were not
    ['w6.js', 'whole', true], // shown whole with its hunks
    ['w7.js', 'whole', false]]); // no earlier side recorded: not known, so not seen
  assert.deepEqual(seen.rules.map((x) => [x.path, x.state]), [['AGENTS.md', 'in_part'], ['RULES.md', 'lines_unknown']]);
  assert.ok(seen.rules.every((x) => !Object.hasOwn(x, 'changeSeen')));
  assert.ok(seen.files.every((x) => CODE_SEEN_STATES.includes(x.state)));
  // Pure: the same manifest and records give the same answer.
  assert.deepEqual(codeSeenOf({ manifest: structuredClone(manifest), agents: structuredClone(agents) }), seen);
  // A request too large to send saw nothing.
  assert.ok(codeSeenOf({ manifest: { review: { ...manifest.review, sent: false } }, agents }).files
    .every((x) => x.state === 'not_seen' && x.changeSeen === false));
});

test('D105: a file the review read with no typed lines is never named unseen: the footer leaves it to the seen lines, '
  + 'and while its change is not seen the coverage stays partial', async () => {
  const huge = linesOf('hugefile', 10_250);
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'], 'src/huge.js': huge }, commands: ['npm test'] });
  const pass = (await runWith(f, agents({ run: runOf([], ['src/huge.js']) }), 1_620_000 * 4)).codePass;
  assert.deepEqual(pass.agents[0].run.unrangedPaths, ['src/huge.js']);
  assert.deepEqual(codeSeenOf(pass).files.map((x) => [x.path, x.state]), [['src/a.js', 'whole'],
    ['src/huge.js', 'lines_unknown']]);
  assert.deepEqual([pass.footer, pass.coverage], [[], 'partial']);
});

test('D105 (review): a Read that failed read nothing — a left-out file whose only Read failed is not seen, named so, and '
  + 'counted unseen; never "read, though Sonah could not tell which lines it saw"', async () => {
  const huge = linesOf('hugefile', 10_250);
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'], 'src/huge.js': huge }, commands: ['npm test'] });
  const runOn = async (run) => (await runWith(f, agents({ run }), 1_620_000 * 4)).codePass;
  for (const reason of ['failed', 'refused']) {
    const pass = await runOn(runOf([], [], [['src/huge.js', reason]]));
    assert.deepEqual([pass.agents[0].run.failed, pass.agents[0].run.unrangedPaths, pass.agents[0].run.unranged],
      [[{ path: 'src/huge.js', reason }], [], 0], 'kept apart, never unranged');
    assert.deepEqual(codeSeenOf(pass).files.map((x) => [x.path, x.state, x.changeSeen]),
      [['src/a.js', 'whole', true], ['src/huge.js', 'not_seen', false]]);
    // D109 (its review): its hunks alone are over the change block's cap: too large on its own (`oversize`).
    assert.deepEqual([pass.footer, pass.coverage], [[{ kind: 'withheld', path: 'src/huge.js' }], 'partial']);
    assert.equal(codeUnseenFiles(pass), 1, 'the header counts it as a file the code review did not see');
    assert.deepEqual(codeSeenLines(pass), [], 'no line says the code review read it');
    assert.deepEqual(codeFooterLines({ codePass: pass }), [CODE_REPORT_WORDS.footerKinds.withheld({ n: 1,
      states: [[CODE_REPORT_WORDS.states.oversize, 1]], paths: ['src/huge.js'] })]);
    // D109: the one tally: one file seen whole, one not seen, the header's count the coverage line's.
    assert.equal(codeCoverageLines(pass)[0], CODE_REPORT_WORDS.files(2, [['whole', 1]], 1));
  }
  // A failed whole Read and then Reads of its first 2,000 lines: seen in part, with those lines, never lines unknown.
  const part = await runOn(runOf([rangeOf('src/huge.js', 1, 2_000, 10_250)], [], [['src/huge.js', 'failed']]));
  assert.deepEqual(part.agents[0].run.unrangedPaths, []);
  const seen = codeSeenOf(part).files.find((x) => x.path === 'src/huge.js');
  assert.deepEqual([seen.state, seen.lines, seen.changeSeen], ['in_part', [[1, 2_000]], false]);
  assert.deepEqual(codeSeenLines(part), [CODE_REPORT_WORDS.seenInPart(['src/huge.js (lines 1 to 2000 of 10250)'])]);
  // The same path read once more with no typed lines, by a Read that did not fail: lines unknown, as before.
  const unknown = await runOn(runOf([], ['src/huge.js'], [['src/huge.js', 'failed']]));
  assert.deepEqual(codeSeenOf(unknown).files.map((x) => x.state), ['whole', 'lines_unknown']);
});

test('D105 (review): a modified file left out for room is seen only with its earlier side — read over its hunks\' lines, '
  + 'or whole, as it is now, its change is not seen and the coverage stays partial; the readers say so truly', async () => {
  // The reviewer's probe: three files, no command; src/b.js modified (line 7) is the largest hunk, so it gives way.
  const before = linesOf('beta', 20);
  const after = before.replace('beta 00007', 'BETA 00007');
  const f = fixture({ files: { 'src/a.js': linesOf('alpha', 2), 'src/b.js': after, 'src/c.js': linesOf('gamma', 3) },
    rules: null, modified: { 'src/b.js': { text: before, at: 7 } } });
  const seen = [];
  const all = (await runWith(f, agents({ seen }))).codePass;
  assert.equal(all.coverage, 'complete', 'every hunk shown: complete');
  const bound = reviewInputBytes(seen[0]) - 1;
  const runOn = async (run) => (await runWith(f, agents({ run }), bound)).codePass;
  const unread = await runOn(null);
  const entry = unread.manifest.review.files.find((x) => x.path === 'src/b.js');
  assert.deepEqual([entry.state, entry.reason], ['left_out', 'request_bound']);
  const [[from, through]] = entry.change;
  // Its hunks hold on the earlier side the rows they hold now, the line that changed among them; none of an added file.
  assert.equal(entry.beforeUnshown, through - from + 1);
  assert.deepEqual(unread.manifest.review.files.filter((x) => x.path !== 'src/b.js').map((x) => x.beforeUnshown), [0, 0]);
  // Read over every line its hunks hold now (lines 1 to 11 hold them): seen in part, its change not seen.
  assert.ok(from >= 1 && through <= 11, `${from} to ${through}`);
  const part = await runOn(runOf([rangeOf('src/b.js', 1, 11, 20)]));
  const inPart = codeSeenOf(part).files.find((x) => x.path === 'src/b.js');
  assert.deepEqual([inPart.state, inPart.changeSeen], ['in_part', false]);
  assert.deepEqual([part.footer, part.coverage], [[], 'partial']);
  assert.equal(codeCoverageLines(part)[0], CODE_REPORT_WORDS.files(3, [['whole', 2], ['in_part', 1]], 0));
  assert.deepEqual(codeSeenLines(part), [CODE_REPORT_WORDS.seenInPart(['src/b.js (lines 1 to 11 of 20)'])]);
  // Read whole as it is now: seen whole, but not as it was, so its change is not seen; one line says exactly that.
  const whole = await runOn(runOf([rangeOf('src/b.js', 1, 20, 20)]));
  const wholeB = codeSeenOf(whole).files.find((x) => x.path === 'src/b.js');
  assert.deepEqual([wholeB.state, wholeB.changeSeen], ['whole', false]);
  assert.deepEqual([whole.footer, whole.coverage], [[], 'partial']);
  assert.equal(codeCoverageLines(whole)[0], CODE_REPORT_WORDS.files(3, [['whole', 2], ['whole_not_before', 1]], 0));
  assert.deepEqual(codeSeenLines(whole), [CODE_REPORT_WORDS.wholeNotBefore(['src/b.js'])]);
  assert.equal(codeUnseenFiles(whole), 0, 'it saw the file: never counted as one it did not see');
  assert.equal(CODE_REPORT_WORDS.wholeNotBefore(['src/b.js']),
    '1 file of the change that the code review saw whole, but not as it was before: src/b.js');
});

test('D105 (review): a file whose hunks cannot be shown is seen with its change only when it was added — a modified one '
  + 'read whole has an earlier side that Sonah could not show', async () => {
  const before = linesOf('delta', 30);
  const after = before.replace('delta 00012', 'DELTA 00012');
  const added = linesOf('newly', 5);
  // Each patch broken: its hunks do not turn the base into the file now, so neither diff can be read.
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'], 'src/d.js': after, 'src/n.js': added }, rules: null,
    modified: { 'src/d.js': { text: before, at: 12 } },
    patches: { 'src/d.js': modifiedPatch('src/d.js', before, after, 12).replace('+DELTA 00012', '+DELTA 99999'),
      'src/n.js': addedPatch('src/n.js', added).replace('+newly 00003', '+newly 99999') } });
  const runOn = async (run) => (await runWith(f, agents({ run }))).codePass;
  const unread = await runOn(null);
  assert.deepEqual(unread.manifest.review.files.map((x) => [x.path, x.state, x.reason ?? null, x.beforeUnshown]),
    [['src/a.js', 'whole', null, 0], ['src/d.js', 'not_shown', 'unreadable', null],
      ['src/n.js', 'not_shown', 'unreadable', 0]]);
  const pass = await runOn(runOf([rangeOf('src/d.js', 1, 30, 30), rangeOf('src/n.js', 1, 5, 5)]));
  assert.deepEqual(codeSeenOf(pass).files.map((x) => [x.path, x.state, x.changeSeen]), [['src/a.js', 'whole', true],
    ['src/d.js', 'whole', false], ['src/n.js', 'whole', true]]);
  assert.deepEqual([pass.footer, pass.coverage], [[], 'partial']);
  assert.deepEqual(codeSeenLines(pass), [CODE_REPORT_WORDS.wholeNotBefore(['src/d.js'])]);
  // Its state ("not readable": its diff) is not said beside the line that says the review saw it whole.
  assert.equal(codeCoverageLines(pass)[0], CODE_REPORT_WORDS.files(3, [['whole', 2], ['whole_not_before', 1]], 0));
});

test('D105: a rule or skill file over its block\'s cap keeps the coverage partial until the review saw it whole',
  async () => {
    const big = linesOf('rule', 10_250);
    const f = fixture({ files: { 'src/a.js': FILES['src/a.js'] }, commands: ['npm test'], rules: big });
    const runOn = async (run) => (await runWith(f, agents({ run }), 1_620_000 * 4)).codePass;
    const lines = big.split('\n').length - 1;
    for (const [run, state, coverage] of [[null, 'not_seen', 'partial'],
      [runOf([rangeOf('CLAUDE.md', 1, 40, lines)]), 'in_part', 'partial'],
      [runOf([], ['CLAUDE.md']), 'lines_unknown', 'partial'],
      [runOf([rangeOf('CLAUDE.md', 1, lines, lines)]), 'whole', 'complete']]) {
      const pass = await runOn(run);
      assert.deepEqual([pass.manifest.review.rules[0].state, pass.manifest.review.rules[0].reason], ['left_out', 'block_cap']);
      assert.deepEqual([codeSeenOf(pass).rules[0].state, pass.coverage], [state, coverage], state);
    }
  });

test('D105: where the published receipts sit is counted — inside what the review was shown or read, outside it, or in a '
  + 'file it read with no typed lines (unknown)', async () => {
  const gammaBefore = linesOf('gamma', 60);
  const gammaAfter = gammaBefore.replace('gamma 00030', 'GAMMA 00030');
  const f = fixture({ files: { 'src/a.js': FILES['src/a.js'], 'src/c.js': gammaAfter }, commands: ['npm test'],
    modified: { 'src/c.js': { text: gammaBefore, at: 30 } } });
  const step = (line, quote) => ({ step: `It reaches line ${line}.`, path: 'src/c.js', side: 'new', startLine: line,
    endLine: line, quote });
  // Line 30 is in the shown hunk (22 to 34); line 50 is not.
  const finding = { kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: the changed line is wrong', claims: [],
    input: 'SYNTHETIC input', trace: [step(30, 'GAMMA 00030'), step(50, 'gamma 00050')],
    anchor: { path: 'src/c.js', side: 'new', startLine: 30, endLine: 30 }, leadsFrom: [] };
  const placesWith = async (run) => (await runWith(f, agents({ review: () => ({ findings: [finding], questions: [] }),
    run: (label) => (label.startsWith('code-review') ? run : null) }))).codePass;
  const unread = await placesWith(null);
  assert.equal(unread.findings.length, 1);
  assert.deepEqual(unread.receiptPlaces, { inside: 1, outside: 1, unknown: 0 });
  assert.deepEqual((await placesWith(runOf([rangeOf('src/c.js', 45, 10, 60)]))).receiptPlaces,
    { inside: 2, outside: 0, unknown: 0 });
  assert.deepEqual((await placesWith(runOf([], ['src/c.js']))).receiptPlaces, { inside: 1, outside: 0, unknown: 1 });
  // A Read of it that failed read nothing: the receipt outside what was seen, never unknown.
  assert.deepEqual((await placesWith(runOf([], [], [['src/c.js', 'failed']]))).receiptPlaces,
    { inside: 1, outside: 1, unknown: 0 });
});

/** A finding about src/a.js's first line whose trace also quotes the project's rule file (the person's words, which its
 *  checker is shown whole). */
const ruleFinding = { kind: 'bug', lens: 'behaviour', title: 'SYNTHETIC: the module breaks the rule', claims: [],
  input: 'SYNTHETIC input', trace: [{ step: 'The rule says so.', path: null, side: 'session', startLine: null,
    endLine: null, quote: 'rule 00001' }, { step: 'The module does otherwise.', path: 'src/a.js', side: 'new', startLine: 1,
    endLine: 1, quote: 'alpha 00001' }], anchor: { path: 'src/a.js', side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [] };
const outOf = (pass) => pass.footer.filter((f) => ['failed', 'too_large'].includes(f.kind));
const labelsOf = (seen) => seen.map((r) => r.label);
/** The bound at which the request labelled `label` is sent and fits exactly: the checkers are shown the change the
 *  review was, so a lower bound can shrink them too; from no bound down, each step the size it was sent at. */
async function exactBound(f, judgeOf, label) {
  let bound = Infinity;
  for (let step = 0; step < 8; step++) {
    const seen = [];
    await runWith(f, judgeOf(seen), bound);
    const size = reviewInputBytes(seen.find((r) => r.label === label));
    if (size === bound) return bound;
    bound = size;
  }
  throw new Error(`no exact bound for ${label}`);
}

test('D105: a finding\'s checking request too large to send is not sent, and is never a call that did not answer — the '
  + 'finding is withheld so, the footer names it, the coverage is partial; its re-ask too', async () => {
  // A long rule file: the review leaves it out for room, while the checker of a finding that quotes it is shown it whole.
  // The review reads every file and the rule file whole, so only what was not sent can keep its coverage short.
  const f = fixture({ files: FILES, rules: linesOf('rule', 1_500) });
  const review = () => ({ findings: [ruleFinding], questions: [] });
  const run = (label) => (label.startsWith('code-review') ? runOf([rangeOf('src/a.js', 1, 2, 2),
    rangeOf('src/b.js', 1, 20, 20), rangeOf('src/c.js', 1, 60, 60), rangeOf('CLAUDE.md', 1, 1_500, 1_500)]) : null);
  assert.equal((await runWith(f, agents({ review, run }))).codePass.coverage, 'complete', 'every request sent: complete');
  const checker = await exactBound(f, (seen) => agents({ review, seen, run }), 'code-verify:F1');
  const seen = [];
  const over = (await runWith(f, agents({ review, seen, run }), checker - 1)).codePass;
  assert.deepEqual([over.manifest.review.sent, over.manifest.review.rules[0].state], [true, 'left_out']);
  assert.ok(codeSeenOf(over).files.every((x) => x.changeSeen) && codeSeenOf(over).rules[0].state === 'whole');
  assert.deepEqual(labelsOf(seen), ['code-review:agent']);
  assert.deepEqual([over.calls.verify, over.withheld.map((w) => w.reason)], [0, ['request_too_large']]);
  assert.deepEqual(outOf(over), [{ kind: 'too_large', part: 'verify', count: 1 }]);
  assert.equal(over.coverage, 'partial');
  // Its first request fits exactly; its answer cannot be used, and the re-ask with its note does not fit: not sent.
  const unusable = (finding, request) => (request.label.endsWith(':reask') ? holds(finding) : { verdict: 'holds' });
  const reseen = [];
  const reask = (await runWith(f, agents({ review, seen: reseen, verify: unusable, run }), checker)).codePass;
  assert.deepEqual(labelsOf(reseen), ['code-review:agent', 'code-verify:F1']);
  assert.deepEqual([reask.calls.verifyRepeat, reask.withheld.map((w) => w.reason)], [0, ['verify_unexecuted']]);
  assert.deepEqual(outOf(reask), [{ kind: 'too_large', part: 'verify', count: 1 }]);
  assert.equal(reask.coverage, 'partial');
});

test('D105: the questions\' checking request too large to send is not sent, and is never a call that did not answer; '
  + 'its re-ask too', async () => {
  const f = fixture({ files: FILES, commands: COMMANDS.slice(0, 3), rules: linesOf('rule', 1_500) });
  // The most questions an answer may hold, each long: the review's request holds none of them, its checker's all.
  const questions = Array.from({ length: 20 }, (_, i) => ({ question: `SYNTHETIC question ${i + 1}: `.padEnd(990, 'q'),
    key: 'S1', quote: ASK.slice(0, 40) }));
  const review = () => ({ findings: [], questions });
  const checker = await exactBound(f, (seen) => agents({ review, seen }), 'code-verify:batch');
  const seen = [];
  const over = (await runWith(f, agents({ review, seen }), checker - 1)).codePass;
  assert.equal(over.manifest.review.sent, true);
  assert.deepEqual([labelsOf(seen), over.calls.batch], [['code-review:agent'], 0]);
  // F3b (D111): the accounting's request carries the same questions, so it is too large to send at this bound too.
  assert.deepEqual(outOf(over), [{ kind: 'too_large', part: 'batch', count: 1 },
    { kind: 'too_large', part: 'account', count: 1 }]);
  assert.ok(over.questions.length === 20 && over.questions.every((q) => !Object.hasOwn(q, 'check')), 'published unchecked');
  assert.equal(over.coverage, 'partial');
  // Its first request fits exactly; its answer cannot be used, and the re-ask with its note does not fit: not sent.
  const unusable = (items, request) => (request.label.endsWith(':reask') ? allSound(items) : { questions: 'none' });
  const reseen = [];
  const reask = (await runWith(f, agents({ review, seen: reseen, batch: unusable }), checker)).codePass;
  assert.deepEqual([labelsOf(reseen), reask.calls.batchRepeat], [['code-review:agent', 'code-verify:batch'], 0]);
  assert.deepEqual(outOf(reask), [{ kind: 'too_large', part: 'batch', count: 1 },
    { kind: 'too_large', part: 'account', count: 1 }]);
  assert.equal(reask.coverage, 'partial');
});

test('D105: whole units fill smallest first whatever their order by path — the change block\'s hunks under its cap, and '
  + 'over the bound the largest hunks give way first', async () => {
  // By path the largest comes first, by size last.
  const files = { 'src/a.js': linesOf('alpha', 60), 'src/m.js': linesOf('mid', 20), 'src/z.js': linesOf('zeta', 2) };
  const f = fixture({ files });
  const bySize = ['src/z.js', 'src/m.js', 'src/a.js'];
  // Under every cap of a sweep, the files whose hunks fit are the smallest ones: a first part of the size order.
  let partial = 0;
  for (let maxBytes = 0; maxBytes <= 8_000; maxBytes += 40) {
    const { shown } = changeBlock(f.snapshot, { maxBytes });
    assert.deepEqual([...shown].sort((x, y) => bySize.indexOf(x) - bySize.indexOf(y)), bySize.slice(0, shown.size),
      `${maxBytes}`);
    if (shown.size > 0 && shown.size < 3) partial++;
  }
  assert.ok(partial > 0, 'some cap shows only part of the change');
  // One request over the bound: the largest file's hunks leave, the smaller stay whole.
  const seen = [];
  await runWith(f, agents({ seen }));
  const over = (await runWith(f, agents(), reviewInputBytes(seen[0]) - 50)).codePass;
  assert.deepEqual(over.manifest.review.files.map((x) => [x.path, x.state, x.reason ?? null]),
    [['src/a.js', 'left_out', 'request_bound'], ['src/m.js', 'whole', null], ['src/z.js', 'whole', null]]);
  // D109: the record says the file was left out for room (as one over the block's cap), never that it is too large on
  // its own; the gap counts it from the one tally, by that state.
  assert.deepEqual(over.files.map((x) => [x.path, x.state]), [['src/a.js', 'left_out'], ['src/m.js', 'shown'],
    ['src/z.js', 'shown']]);
  assert.deepEqual(over.gaps.map((g) => [g.code, g.count, g.byState?.left_out ?? null]),
    [['code_unreviewable', 1, 1]]);
});

test('D105: rule and skill files fill smallest first whatever their order — over the bound the largest gives way first',
  async () => {
    // The larger rule file is loaded first.
    const f = fixture({ files: { 'src/a.js': FILES['src/a.js'] }, rules: linesOf('rule', 300),
      moreRules: { 'docs/CLAUDE.md': linesOf('docrule', 30) } });
    const seen = [];
    await runWith(f, agents({ seen }));
    let one = 0;
    for (let bound = reviewInputBytes(seen[0]); bound > 0; bound -= 499) {
      const { review } = (await runWith(f, agents(), bound)).codePass.manifest;
      if (!review.sent) break;
      const states = review.rules.map((x) => [x.path, x.state]);
      // Whenever one rule file is shown and the other left out, the one shown is the smaller.
      if (states.filter(([, state]) => state === 'whole').length === 1) {
        one++;
        assert.deepEqual(states, [['CLAUDE.md', 'left_out'], ['docs/CLAUDE.md', 'whole']], `${bound}`);
      }
    }
    assert.ok(one > 0, 'some bound shows one rule file of the two');
  });
