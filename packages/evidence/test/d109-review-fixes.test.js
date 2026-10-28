// D109's review (2026-10-18): the fixes an independent reviewer asked for, each pinned through the code that builds the
// record, never on a hand-built manifest alone. (1) With a git base, the review request's manifest says which files a
// recorded edit of the session wrote (`recorded`), so the change line says it can hold work done after the session on
// every reader; a file whose hunks cannot be shown is named by its own state (a deleted one "not there any more"). (2) A
// review whose call did not answer and shows no sign that it read its request counts nothing as seen. (3) A file whose
// hunks alone are over the change block's cap is too large on its own (`oversize`), never left out for room; one that
// fits alone but not beside the others is left out for room. (4) No open question checked is said in true words.
// (5) The paragraph on how the code review works prints only where the record shows that the review read what Sonah
// sent it, and each of its sentences holds in every state the code step can end in.
//
// Synthetic sessions, snapshots and deterministic fake agents: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isCodeReviewLabel, codeSnapshotPlan, freezeCodeSnapshot, runCodePass, changeBlock, codeChangeTally, codeSeenOf,
  CODE_CHANGE_BLOCK_MAX_BYTES } from '../src/code-pass.js';
import { CODE_REPORT_WORDS as W, codeBaseLine, codeCoverageLines, codeFooterLines, codeSeenLines, codeUnseenFiles,
  codeQuestionsLine, codeHowLine, withheldWhy } from '../src/code-report.js';
import { renderSessionPage } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { CODE_FILES, codeSession, memoryRepo, holds, holdsWith, repositoryPremise, allSound, withRun, reviewFinding,
  verifiedFinding, batchItems, SYNTHETIC_RUN } from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const ROOT = '/work/repo';
const COMMIT = 'a'.repeat(40);
const GIT = { kind: 'git', commit: COMMIT, how: 'reflog' };
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const PARSE_PATCH = ['diff --git a/src/parse.js b/src/parse.js', 'index 1111111..2222222 100644', '--- a/src/parse.js',
  '+++ b/src/parse.js', '@@ -1,4 +1,4 @@ export function parse(input) {', ' export function parse(input) {',
  '-  const parts = input.split(";");', '+  const parts = input.split(",");', '   return parts.map((part) => part.trim());',
  ' }', ''].join('\n');
/** An added file of `n` lines of `width` characters, and git's patch of it. */
const addedFile = (path, n, width = 20) => {
  const lines = Array.from({ length: n }, (_, i) => `${String(i).padStart(6, '0')}${'x'.repeat(Math.max(0, width - 6))}`);
  return { path, type: 'added', head: `${lines.join('\n')}\n`, patch: `diff --git a/${path} b/${path}\nnew file mode 100644\n`
    + `--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${n} @@\n${lines.map((l) => `+${l}`).join('\n')}\n` };
};
/**
 * A git snapshot of `codeSession` (its one recorded write, src/parse.js) with `extra` paths git lists that no recorded
 * edit wrote: `{ path, type, head?, base?, patch?, state? }` (`state`: the CLI's own state of the file now; `base:
 * 'oversize'` a side at the start commit too large to read).
 */
function snapshotOf(extra = []) {
  const session = codeSession();
  const plan = [...codeSnapshotPlan(session)];
  for (const e of extra) plan.push({ path: e.path, recordedPath: e.path, changed: true, recorded: false, outside: false,
    last: null, edits: [] });
  const reads = plan.map((entry) => {
    if (entry.path === 'src/parse.js') return { path: entry.path, bytes: enc(CODE_FILES['src/parse.js']), type: 'modified',
      base: { bytes: enc(BASE_PARSE) }, patch: PARSE_PATCH };
    const e = extra.find((x) => x.path === entry.path);
    if (!e) return { path: entry.path, bytes: enc(CODE_FILES[entry.path] ?? '') };
    return { path: e.path, ...(e.state ? { state: e.state } : { bytes: enc(e.head) }), type: e.type,
      ...(e.base === 'oversize' ? { base: { state: 'oversize' } } : {}), patch: e.patch ?? null };
  });
  return { session, snapshot: freezeCodeSnapshot(plan, reads, { base: GIT }) };
}
/** The code step's fake agents: the review answers `review()` (by default nothing), each check holds or is sound. */
const judgeOf = ({ review = () => withRun({ findings: [], questions: [] }) } = {}) => async (request) => {
  // D149: and each review unit's request (`code-review:review:U<k>:R1`), with its repair.
  if (isCodeReviewLabel(request.label)) return review(request);
  if (/^code-verify:F\d+/.test(request.label)) return holds({});
  if (/^code-verify:batch/.test(request.label)) return allSound({ items: [] });
  throw new Error(`unexpected request ${request.label}`);
};
const runOn = ({ session, snapshot }, judge = judgeOf(), more = {}) => runCodePass({ report: {}, session, snapshot,
  repo: memoryRepo({ root: ROOT }), judge, base: GIT, root: ROOT, ...more });
const textOf = (html) => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ').replace(/&#39;/g, '\'')
  .replace(/\s+/g, ' ');

test('D109 review: the manifest the code step builds says which files a recorded edit wrote, so every reader says the '
  + 'change can hold work done after the session; a file whose hunks cannot be shown is named by its own state', async () => {
  const fixture = snapshotOf([{ ...addedFile('src/later.js', 3) },
    { path: 'old/gone.txt', type: 'deleted', state: 'deleted', base: 'oversize' }]);
  const { codePass } = await runOn(fixture);
  const entries = Object.fromEntries(codePass.manifest.review.files.map((e) => [e.path, e]));
  assert.deepEqual(Object.fromEntries(Object.entries(entries).map(([path, e]) => [path, e.recorded])),
    { 'old/gone.txt': false, 'src/later.js': false, 'src/parse.js': true });
  // The deleted file's hunks cannot be shown (its side at the start commit is too large to read): its own state.
  assert.deepEqual([entries['old/gone.txt'].state, entries['old/gone.txt'].reason], ['not_shown', 'deleted']);
  const line = W.base(COMMIT, 2, 3);
  assert.match(line, /So it can hold work done after the session\. Sonah found no recorded edit of the session that wrote 2 of its 3 files\.$/);
  assert.equal(codeBaseLine(codePass), line);
  // The footer names the deleted file as not there any more, never as one named without a line shown.
  assert.ok(codeFooterLines({ codePass }).includes(W.footerKinds.withheld({ n: 1, states: [[W.states.deleted, 1]],
    paths: ['old/gone.txt'] })), codeFooterLines({ codePass }).join('\n'));
  // Every reader says it, from the record the code step wrote.
  const report = { codePass };
  const page = textOf(renderSessionPage(fixture.session, report));
  const md = renderReportMarkdown(fixture.session, report);
  for (const text of [page, md]) {
    assert.ok(text.includes('So it can hold work done after the session.'), 'the change line\'s caveat');
    assert.ok(text.includes('Sonah found no recorded edit of the session that wrote 2 of its 3 files.'));
    assert.ok(text.includes('not there any more'));
    assert.doesNotMatch(text, /named without a line shown/);
  }
  // When the recorded edits wrote every file of the change, no reader says it.
  const own = await runOn(snapshotOf());
  assert.equal(codeBaseLine(own.codePass), W.base(COMMIT));
  assert.doesNotMatch(renderReportMarkdown(fixture.session, { codePass: own.codePass }), /work done after the session/);
});

test('D109 review: a review whose call did not answer, with no turn and no tool call recorded, counts nothing as seen — '
  + 'never "saw"; one whose record shows it acted counts what it was shown', async () => {
  // later.js and parse.js are shown whole; gone.txt's hunks cannot be shown.
  const fixture = snapshotOf([{ ...addedFile('src/later.js', 3) },
    { path: 'old/gone.txt', type: 'deleted', state: 'deleted', base: 'oversize' }]);
  const failing = (run) => judgeOf({ review: () => {
    const error = new Error('the agent did not answer');
    Object.defineProperty(error, 'agentRun', { value: run, enumerable: false });
    throw error;
  } });
  const silent = { numTurns: null, toolCalls: { Read: 0, Grep: 0, Glob: 0 }, reads: [], readRanges: [], readsUnranged: 0,
    readsUnrangedPaths: [], readsFailed: [] };
  const { codePass } = await runOn(fixture, failing(silent));
  assert.equal(codePass.agent.terminal, 'failed');
  const tally = codeChangeTally(codePass);
  assert.equal(tally.answered, false);
  assert.equal(tally.groups.not_seen.length, tally.total);
  assert.ok(codeSeenOf(codePass).files.every((f) => f.state === 'not_seen' && f.changeSeen === false));
  assert.deepEqual(codeCoverageLines(codePass), [W.noAnswer(3), W.coverage.missing]);
  assert.deepEqual(codeSeenLines(codePass), []);
  const footer = codeFooterLines({ codePass });
  assert.deepEqual(footer, [W.footerKinds.failed({ count: 1, parts: [W.parts.review] })]);
  assert.equal(codeUnseenFiles(codePass), 3);
  assert.equal(codePass.gaps.find((g) => g.code === 'code_unreviewable').count, 3);
  assert.ok(!codePass.footer.some((e) => e.kind === 'withheld' || e.kind === 'clipped'), 'the record names no file');
  for (const text of [textOf(renderSessionPage(fixture.session, { codePass })),
    renderReportMarkdown(fixture.session, { codePass })]) {
    assert.ok(text.includes('The code review did not answer, so Sonah counts none of them as seen.'));
    assert.doesNotMatch(text, /The code review saw|It saw \d/);
  }
  // A rule file the request showed is no more seen than a file of the change: no seen line names it either.
  const withRule = structuredClone(codePass);
  withRule.manifest.review.rules = [{ path: 'AGENTS.md', kind: 'project', state: 'left_out', reason: 'request_bound',
    shown: [], lines: 40 }];
  assert.deepEqual(codeSeenLines(withRule), []);
  assert.deepEqual(codeSeenLines({ ...withRule, agent: { ...withRule.agent, terminal: 'answered' } }),
    [W.rulesNotSeen(['AGENTS.md'])]);
  // A call that failed after the agent acted (a turn and a Read recorded): what the request showed counts as seen.
  const acted = { ...silent, numTurns: 4, toolCalls: { Read: 1, Grep: 0, Glob: 0 } };
  const after = await runOn(fixture, failing(acted));
  assert.equal(after.codePass.agent.terminal, 'failed');
  assert.equal(codeChangeTally(after.codePass).answered, true);
  assert.equal(codeCoverageLines(after.codePass)[0], W.files(3, [['whole', 2]], 1));
  assert.deepEqual(after.codePass.footer.filter((e) => e.kind === 'withheld'), [{ kind: 'withheld', path: 'old/gone.txt' }]);
});

test('D109 review: a file whose hunks alone are over the change block\'s cap is too large on its own — `oversize`, named '
  + 'by that state — and one that fits alone but not beside the others is left out for room', async () => {
  // At a small cap: big.js can never fit beside the table of contents; a.js and b.js each fit alone, not together.
  const small = snapshotOf([addedFile('src/big.js', 400, 30), addedFile('src/a.js', 40), addedFile('src/b.js', 45)]);
  const block = changeBlock(small.snapshot, { maxBytes: 3_000 });
  assert.deepEqual(block.alone, ['src/big.js']);
  assert.ok(block.clipped.includes('src/big.js') && block.clipped.includes('src/b.js'), JSON.stringify(block.clipped));
  assert.ok(!block.alone.includes('src/b.js'), 'b.js fits alone: left out for room');
  // At the real cap, through the code step (part A, so no file is shown whole instead): hunks of about 460 KB as the
  // change block shows them (about 51 bytes a row), and two of about 204 KB and 214 KB that fit alone but not together.
  // D149: those two are planned as two review units, each shown by its own request; huge.js, over every unit's room
  // alone, stays too large on its own.
  const real = snapshotOf([addedFile('src/huge.js', 9_000, 30), addedFile('src/one.js', 4_000, 30),
    addedFile('src/two.js', 4_200, 30)]);
  const { codePass } = await runOn(real, judgeOf(), { wholeFiles: false });
  const entries = Object.fromEntries(codePass.manifest.review.files.map((e) => [e.path, e]));
  assert.deepEqual([entries['src/huge.js'].state, entries['src/huge.js'].reason, entries['src/huge.js'].alone],
    ['left_out', 'block_cap', true]);
  // one.js's and two.js's hunks are shown, each in its unit, and an added file's hunks hold every line of it.
  assert.deepEqual([entries['src/one.js'].state, entries['src/two.js'].state], ['whole', 'whole']);
  assert.equal(codePass.manifest.units.length, 2);
  assert.equal(CODE_CHANGE_BLOCK_MAX_BYTES, 400_000);
  const states = Object.fromEntries(codePass.files.map((f) => [f.path, f.state]));
  assert.deepEqual([states['src/huge.js'], states['src/two.js']], ['oversize', 'shown']);
  const units = Object.fromEntries(codeChangeTally(codePass).units.map((u) => [u.path, u.state]));
  assert.deepEqual([units['src/huge.js'], units['src/two.js']], ['oversize', 'shown']);
  assert.deepEqual(codePass.footer.filter((e) => ['withheld', 'clipped'].includes(e.kind)),
    [{ kind: 'withheld', path: 'src/huge.js' }]);
  const lines = codeFooterLines({ codePass });
  assert.ok(lines.includes(W.footerKinds.withheld({ n: 1, states: [[W.states.oversize, 1]], paths: ['src/huge.js'] })),
    lines.join('\n'));
  assert.equal(codePass.gaps.find((g) => g.code === 'code_unreviewable').byState.oversize, 1);
});

test('D109 review: when no open question carries a check record, the line says so in true words', () => {
  const unchecked = { question: 'R?', from: 'review' };
  assert.equal(codeQuestionsLine({ ran: true, questions: [unchecked] }), 'Sonah publishes the open question unchecked.');
  assert.equal(codeQuestionsLine({ ran: true, questions: [unchecked, unchecked] }),
    'Sonah publishes the 2 open questions unchecked.');
  for (const n of [1, 2, 5]) assert.doesNotMatch(W.questionsChecked(0, n), /checked 0|the other/);
});

test('D109 review: the paragraph on how the code review works prints only where the record shows that the review read '
  + 'what Sonah sent it, and each of its sentences holds in every state the code step can end in', async () => {
  const fixture = snapshotOf([{ ...addedFile('src/later.js', 3) }]);
  // One claim of the session, so a question of the code review has a dossier item (S1) to name.
  const report = { promises: [{ id: `sha256:${'1'.repeat(64)}`, stated: { eventId: 'C1', role: 'commentary',
    quote: 'parse now returns an empty list for empty input.' }, text: 'The agent said parse returns an empty list.',
  status: 'open', receipts: [] }] };
  const question = { question: 'Should empty input throw?', key: 'S1', quote: 'parse now returns an empty list' };
  const silent = { ...SYNTHETIC_RUN, numTurns: null, toolCalls: { Read: 0, Grep: 0, Glob: 0 } };
  const acted = { ...silent, numTurns: 3, toolCalls: { Read: 1, Grep: 0, Glob: 0 } };
  /** A call that fails with the transport's code, carrying `run` as its reading record (none: no record at all). */
  const fails = (code, run = null) => () => {
    const error = Object.assign(new Error(code), { code });
    if (run) Object.defineProperty(error, 'agentRun', { value: run, enumerable: false });
    throw error;
  };
  const answer = (over = {}) => () => withRun({ findings: [], questions: [], ...over });
  const agents = ({ review = answer(), repair = null, verify = (f) => withRun(holds(f)),
    batch = (items) => withRun(allSound(items)) } = {}) => async (request) => {
    if (request.label === 'code-review:agent') return review(request);
    if (request.label === 'code-review:repair') return (repair ?? review)(request);
    if (/^code-verify:F\d+/.test(request.label)) return verify(verifiedFinding(request.prompt));
    if (/^code-verify:batch/.test(request.label)) return batch(batchItems(request.prompt));
    throw new Error(`unexpected request ${request.label}`);
  };
  // D152: a check that holds, with no receipt of what the behaviour breaks, of a finding that follows from no row.
  const open = (f) => withRun(holdsWith(f, [repositoryPremise(f)], []));
  const unusable = () => withRun({ findings: 'none' });
  const ungrounded = reviewFinding({ title: 'A finding whose quote is not in the file',
    trace: [{ ...reviewFinding().trace[0], quote: 'not in the file at all' }] });
  // Every state, with whether the paragraph prints there.
  const states = [
    ['an answer with nothing to publish', agents(), true],
    ['an answer whose finding and question each have a check', agents({ review: answer({ findings: [reviewFinding()],
      questions: [question] }) }), true],
    ['an answer whose checks failed', agents({ review: answer({ findings: [reviewFinding()], questions: [question] }),
      verify: fails('model_unavailable'), batch: fails('model_unavailable') }), true],
    ['an answer whose finding its check found real, tied to nothing it breaks', agents({ review: answer({
      findings: [reviewFinding()] }), verify: open }), true],
    ['an answer whose item the one repair fixed', agents({ review: answer({ findings: [ungrounded] }),
      repair: answer({ findings: [reviewFinding()] }) }), true],
    ['a reply outside the contract that the one repair answered', agents({ review: unusable,
      repair: answer({ findings: [reviewFinding()] }) }), true],
    ['a reply outside the contract, and its repair too', agents({ review: unusable, repair: unusable }), true],
    ['a reply outside the contract whose repair failed', agents({ review: unusable,
      repair: fails('model_unavailable') }), true],
    ['a call that failed after a turn and a read', agents({ review: fails('model_unavailable', acted) }), true],
    ['a call that failed with no turn and no tool call', agents({ review: fails('model_unavailable', silent) }), false],
    ['a call with no answer stored and no record', agents({ review: fails('max_calls') }), false],
  ];
  const ran = [];
  for (const [name, judge, prints] of states) ran.push([name, (await runOn(fixture, judge, { report })).codePass, prints]);
  ran.push(['a request too large to send', (await runOn(fixture, agents(), { report, bound: 2_000 })).codePass, false]);
  ran.push(['no change to review', (await runOn({ session: fixture.session, snapshot: [] }, agents(), { report }))
    .codePass, false]);
  ran.push(['a step that did not run', (await runOn(fixture, agents(), { report, gate: 'code_step_backend' })).codePass,
    false]);
  const said = [W.noFile, W.noRoot, ...Object.values(W.notRun)];
  const unread = (line, total) => said.includes(line) || line === W.noAnswer(total) || line === W.tooLarge(total);
  // D152: every state here runs under the tie rule, so the paragraph is its words (`howTied`); a record before it reads
  // `how` (below).
  for (const [name, codePass, prints] of ran) {
    assert.equal(codeHowLine(codePass), prints ? W.howTied : null, name);
    for (const text of [textOf(renderSessionPage(fixture.session, { ...report, codePass })),
      renderReportMarkdown(fixture.session, { ...report, codePass })])
      assert.equal(text.includes(W.howTied), prints, `${name}: the paragraph on a reader`);
    // Printed, the record shows that the review read what Sonah sent it, and the coverage line says what it saw; not
    // printed, the coverage line says what became of the review instead.
    const tally = codeChangeTally(codePass);
    const total = tally?.total ?? 0;
    assert.equal(unread(codeCoverageLines(codePass)[0], total), !prints, `${name}: ${codeCoverageLines(codePass)[0]}`);
    if (prints) assert.equal(tally.sent === true && tally.answered === true, true, name);
    // The paragraph's rules hold in every state: each published finding, tied or open, has a check that found the
    // problem real, no question comes from a finding (D152), and each item withheld has its reason.
    assert.ok([...codePass.findings, ...codePass.open].every((f) => f.check?.verdict === 'holds'), name);
    assert.deepEqual(codePass.questions.filter((q) => q.from === 'finding'), [], name);
    assert.ok(codePass.withheld.every((w) => withheldWhy(w) !== null), name);
  }
  // The states are what their names say.
  const at = (name) => ran.find(([n]) => n === name)[1];
  assert.deepEqual([at('an answer whose finding and question each have a check').findings.length,
    at('an answer whose finding and question each have a check').questions.map((q) => q.check?.verdict)], [1, ['sound']]);
  assert.deepEqual(at('an answer whose checks failed').withheld.map((w) => w.reason), ['request_failed']);
  assert.deepEqual(at('an answer whose checks failed').questions.map((q) => q.check ?? null), [null]);
  assert.deepEqual(at('an answer whose finding its check found real, tied to nothing it breaks').open.length, 1);
  assert.deepEqual([at('an answer whose item the one repair fixed').calls.repair,
    at('an answer whose item the one repair fixed').findings.length], [1, 1]);
  assert.deepEqual(['a reply outside the contract that the one repair answered', 'a reply outside the contract, and its '
    + 'repair too', 'a reply outside the contract whose repair failed', 'a call that failed after a turn and a read',
  'a call that failed with no turn and no tool call', 'a call with no answer stored and no record',
  'a request too large to send', 'no change to review'].map((name) => at(name).agent.terminal),
  ['answered', 'unusable', 'failed', 'failed', 'failed', 'failed', 'not_sent', 'not_sent']);
  assert.equal(at('a request too large to send').manifest.review.sent, false);
  assert.equal(at('no change to review').manifest, undefined);
  assert.equal(at('a step that did not run').ran, false);
  // The words never say that the code review read the change, or that Sonah reviewed it.
  for (const words of [W.how, W.howTied]) assert.doesNotMatch(words, /read the change|Sonah reviewed/);
  // A report written before D105 (no manifest) is read by its review agent's record; a step before code-pass/7, with
  // no such record, worked another way, and none prints.
  const { manifest, agents: runs, receiptPlaces, ...earlier } = at('an answer with nothing to publish');
  const failed = { terminal: 'failed', turns: null, tools: { Read: 0, Grep: 0, Glob: 0 }, reads: 0 };
  for (const [agent, prints] of [[{ ...failed, terminal: 'answered' }, true], [{ ...failed, terminal: 'unusable' }, true],
    [{ ...failed, turns: 2 }, true], [{ ...failed, reads: 1 }, true], [{ ...failed, tools: { Read: 0, Grep: 1, Glob: 0 } },
      true], [failed, false], [{ ...failed, terminal: 'not_sent' }, false], [undefined, false]]) {
    const pass = { ...earlier, ...(agent ? { agent } : { agent: undefined }) };
    assert.equal(codeHowLine(pass), prints ? W.howTied : null, JSON.stringify(agent));
    assert.equal(renderReportMarkdown(fixture.session, { ...report, codePass: pass }).includes(W.howTied), prints,
      JSON.stringify(agent));
    // D152: a record before the tie rule (its version names none) prints the paragraph of its day.
    const { tie: _tie, ...before } = pass.version;
    assert.equal(codeHowLine({ ...pass, version: before }), prints ? W.how : null, JSON.stringify(agent));
  }
  // A step that did not run prints none, whatever else its record holds.
  assert.equal(codeHowLine({ ...earlier, ran: false, agent: { ...failed, terminal: 'answered' } }), null);
});
