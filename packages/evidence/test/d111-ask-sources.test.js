// D111 amended (2026-10-18; the owner: "go for fix first"): the truth check of real reports found the footer saying "3 of
// your asks that the code review's item-by-item check did not examine" of three asks an agent wrote into a helper's
// brief. The asks the item-by-item check did not examine are now counted by whose words each rests on, read from the
// recorded event its instruction receipt cites (code-context.js `askSourceOf`, ledger.js CODE_ACCOUNT_ASK_SOURCES), and
// only those that rest on your own words are called yours. Synthetic sessions and files, deterministic fake agents: no
// recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CODE_ACCOUNT_ASK_SOURCES } from '../src/ledger.js';
import { runCodePass, codeSnapshotPlan, freezeCodeSnapshot, withCodePass } from '../src/code-pass.js';
import { askSourceOf } from '../src/code-context.js';
import { CODE_REPORT_WORDS as W, codeFooterLines } from '../src/code-report.js';
import { renderSessionPage, escapeHtml } from '../../render/session-page.js';
import { renderReportMarkdown } from '../../render/session-story.js';
import { CODE_FILES, CODE_TEXT, buildCodeSession, withRun, readsEveryFile, accountItemsShown, PARSE_QUOTE }
  from '../../cli/test/code-pass-fixture.js';

const enc = (text) => new TextEncoder().encode(text);
const sha = (text) => createHash('sha256').update(text).digest('hex');
const ROOT = '/work/repo';
const R = (eventId, role, quote) => ({ eventId, role, quote });
const BRIEF = 'SYNTHETIC_BRIEF: never modify the fixtures, and never read credentials from the other repositories.';
const PEER = 'SYNTHETIC_PEER: please also keep the parser pure.';
const FILE = 'SYNTHETIC_RULES: keep every function pure.';

/** One turn of your own (I1), a brief the agent wrote for a helper (H1, an instruction of the helper's session recorded
 *  with its parent agent's authority), another agent's message (M1), the write of src/parse.js, and two project files:
 *  yours, given to the main agent (P0), and one given to the helper (P1). */
function sourcedSession() {
  return buildCodeSession('sess-ask-sources', { ...CODE_TEXT, brief: BRIEF, peer: PEER, rules: FILE }, [
    { id: 'I1', kind: 'instruction', blob: 'ask', turn: 'T1' },
    { id: 'M1', kind: 'instruction', blob: 'peer', authority: 'peer', turn: 'T1' },
    { id: 'H1', kind: 'instruction', blob: 'brief', authority: 'agent', childId: 'helper-1', turn: 'H' },
    { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', turn: 'T1' },
    { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', turn: 'T1' },
    { id: 'C1', kind: 'commentary', blob: 'claim', turn: 'T1' },
  ], { projectInstructions: [{ path: `${ROOT}/CLAUDE.md`, blob: 'rules' },
    { path: `${ROOT}/CLAUDE.md`, blob: 'rules', childId: 'helper-1' }] });
}
/** Seven asks: 1 on your words, 2 on the helper's brief, and 4 on what is not yours or cannot be read — another agent's
 *  message, an event the session does not hold, a project file given to the helper, and an ask with no instruction. */
function sourcedReport() {
  const ask = (text, instruction) => ({ text, status: 'done', ...(instruction ? { instruction } : {}) });
  return { repo: { host: 'github.com', id: '0' }, reviewScope: 'session-only', findings: [], pivots: [], failures: [],
    promises: [], writtenClaims: [], decisions: [],
    requirements: [
      ask('SYNTHETIC ask on your words', R('I1', 'instruction', 'add a parse function')),
      ask('SYNTHETIC ask of the brief', R('H1', 'instruction', 'never modify the fixtures')),
      ask('SYNTHETIC ask of the brief again', R('H1', 'instruction', 'never read credentials')),
      ask('SYNTHETIC ask of a peer', R('M1', 'instruction', 'keep the parser pure')),
      ask('SYNTHETIC ask of an event not held', R('NOPE', 'instruction', 'anything')),
      ask('SYNTHETIC ask of a helper\'s file', R('P1', 'project-instructions', 'keep every function pure')),
      ask('SYNTHETIC ask with no instruction', null)] };
}
/** The code step on the report: the review reads every file and proposes nothing; the accounting answers `outcome`
 *  for every item (not examined, with no receipt; or holds, on a line of the change). */
async function runWith(outcome) {
  const session = sourcedSession();
  const report = sourcedReport();
  const plan = codeSnapshotPlan(session);
  const snapshot = freezeCodeSnapshot(plan, plan.map((entry) => (Object.hasOwn(CODE_FILES, entry.path)
    ? { path: entry.path, bytes: enc(CODE_FILES[entry.path]) } : { path: entry.path, state: 'deleted' })),
  { base: { kind: 'recorded_edits' } });
  const named = (path) => String(path).replace(/^\.\//, '').replace(`${ROOT}/`, '');
  const repo = { root: ROOT, top: ROOT, read: (path) => (Object.hasOwn(CODE_FILES, named(path))
    ? { path: named(path), text: CODE_FILES[named(path)], sha256: sha(CODE_FILES[named(path)]) } : null),
  base: () => null };
  const line = { path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2, quote: PARSE_QUOTE };
  const judge = async (request) => {
    if (request.label === 'code-review:agent') return withRun({ findings: [], questions: [] }, readsEveryFile(request));
    if (/^code-account:\d+(:reask)?$/.test(request.label)) return { findings: [], entries: accountItemsShown(request.prompt)
      .map(({ key }) => ({ key, outcome, receipts: outcome === 'not_examined' ? [] : [line], by: null, finding: null })) };
    throw new Error(`unexpected ${request.label}`);
  };
  const result = await runCodePass({ report, session, snapshot, repo, judge, root: ROOT, base: { kind: 'recorded_edits' } });
  return { session, report: withCodePass(report, result) };
}

test('D111 amended: whose words an ask rests on is read from the recorded event its instruction cites, never its words', () => {
  assert.deepEqual(CODE_ACCOUNT_ASK_SOURCES, ['person', 'helper_brief', 'other']);
  const session = sourcedSession();
  const of = (eventId, role = 'instruction') => askSourceOf(session, R(eventId, role, 'x'));
  assert.equal(of('I1'), 'person', 'a root instruction recorded with human authority');
  assert.equal(of('P0', 'project-instructions'), 'person', 'your project file, given to the main agent');
  assert.equal(of('H1'), 'helper_brief', 'an instruction of a helper\'s session, its parent agent\'s words');
  assert.equal(of('M1'), 'other', 'another agent\'s message');
  assert.equal(of('P1', 'project-instructions'), 'other', 'a project file given to a helper');
  assert.equal(of('C1', 'commentary'), 'other', 'the agent\'s own words');
  assert.equal(of('NOPE'), 'other', 'an event the session does not hold');
  assert.equal(askSourceOf(session, null), 'other', 'no instruction receipt');
  assert.equal(askSourceOf(null, R('I1', 'instruction', 'x')), 'other', 'no session to read');
  // The words of the receipt never decide: the same quote on the helper's event is the helper's brief.
  assert.equal(askSourceOf(session, R('H1', 'instruction', CODE_TEXT.ask)), 'helper_brief');
});

test('D111 amended: the asks the item-by-item check did not examine are counted by whose words each rests on, and only yours are called yours', async () => {
  const { session, report } = await runWith('not_examined');
  const pass = report.codePass;
  // The record counts the asks by scope, as before: seven not examined.
  assert.deepEqual(pass.footer.filter((e) => e.kind === 'unaccounted'), [{ kind: 'unaccounted', scope: 'ask', count: 7 }]);
  // The readers split them by source, in CODE_ACCOUNT_ASK_SOURCES order, the parts summing to the record's count.
  const lines = codeFooterLines(report, { session });
  assert.deepEqual(lines.filter((l) => /item-by-item check/.test(l)), [W.unaccounted.ask.person(1),
    W.unaccounted.ask.helper_brief(2), W.unaccounted.ask.other(4)]);
  assert.equal(W.unaccounted.ask.helper_brief(2), '2 asks that an agent wrote into a helper\'s brief, which the code '
    + 'review\'s item-by-item check did not examine in a way that Sonah could use');
  assert.equal(W.unaccounted.ask.other(4), '4 asks that Sonah could not trace to your own words, which the code review\'s '
    + 'item-by-item check did not examine in a way that Sonah could use');
  // "your asks" counts only the one ask on your words, on every reader.
  const page = renderSessionPage(session, report);
  const md = renderReportMarkdown(session, report);
  for (const text of [page, md]) {
    assert.equal((text.match(/of your asks that the code review/g) ?? []).length, 1);
    assert.ok(text.includes('1 of your asks that the code review'));
    assert.doesNotMatch(text, /[2-9] of your asks/);
  }
  for (const line of lines.filter((l) => /item-by-item check/.test(l))) {
    assert.ok(page.includes(escapeHtml(line)), line);
    assert.ok(md.includes(line), line);
  }
  // With no session Sonah cannot read whose words they are: all seven are counted, none of them as yours.
  assert.deepEqual(codeFooterLines(report).filter((l) => /item-by-item check/.test(l)), [W.unaccounted.ask.other(7)]);
  // A record whose entries do not sum to the footer's count (a hand-edited or older record) is never split into yours.
  const torn = { ...report, codePass: { ...pass, account: { ...pass.account, entries: pass.account.entries.slice(0, 1) } } };
  assert.deepEqual(codeFooterLines(torn, { session }).filter((l) => /item-by-item check/.test(l)),
    [W.unaccounted.ask.other(7)]);
});

test('D111 amended: with every ask examined no line of the accounting is printed, whatever their sources', async () => {
  const { session, report } = await runWith('holds');
  assert.equal(report.codePass.coverage, 'complete');
  assert.deepEqual(codeFooterLines(report, { session }).filter((l) => /item-by-item check/.test(l)), []);
  for (const text of [renderSessionPage(session, report), renderReportMarkdown(session, report)])
    assert.doesNotMatch(text, /item-by-item check did not examine/);
});
