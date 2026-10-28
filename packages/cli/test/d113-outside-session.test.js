// D113 amended (2026-10-18; the owner, in chat: "changed during the session is fine, for code review, you can even
// review code that is outside the session, but tag it by outside the evaluated session"). D113's time window stays as
// built. What changed: the files git shows differing from the session's start commit that no recorded write of the
// session could have changed (D113's files named apart) are read and given to the code review too, after the session's
// own change; every such file, and every finding and question anchored in one, is tagged in the fixed words "outside the
// evaluated session" on the page, in the .md, in the files list and on the terminal; the session's own change and its
// coverage lines stay as they are; the one tally gains their part, with its own counts that add up; and a finding on
// such a file never ties to the person's asks or the agent's claims of this session (no ask tie, no claim contradiction).
//
// Throwaway git repositories in temporary folders, synthetic sessions, a deterministic fake reviewer: no recording, no
// model, no network. Every commit date is fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCodeSnapshot, snapshotTexts } from '../src/code-snapshot.js';
import { runSessionReviewCommand, codeSnapshotLine, CODE_SNAPSHOT_WORDS } from '../src/session-review-command.js';
import { CODE_REPORT_WORDS, codeCoverageLines, codeFooterLines, codeChangedOutsideLine, codeOutsideSeenLine,
  codeReceiptFound, withheldWhy, CODE_REPORT_LIMITS } from '../../evidence/src/code-report.js';
import { codeChangeTally, CODE_TALLY_GROUPS, OUTSIDE_SESSION_WORDS } from '../../evidence/src/code-pass.js';
import { askCodeLinks } from '../../evidence/src/ask-code-links.js';
import { ATTENTION_WORDS } from '../../evidence/src/review.js';
import { honestStatuses } from '../../evidence/src/ledger.js';
import { publicCommentText } from '../../github/publication.js';
import { reportModel, reportItems } from '../../render/report-model.js';
import { sessionPage, escapeHtml } from '../../render/session-page.js';
import { REPORT_COUNT_WORDS, REPORT_DID_WORDS, REPORT_ITEM_WORDS, REPORT_NOT_CHECKED_WORDS }
  from '../../render/report-words.js';
import { CODE_FILES, CODE_TEXT, PARSE_QUOTE, buildCodeSession, codeJudge, holds, holdsWith, repositoryPremise, reviewFinding,
  dossierItems, accountsHold, sha256, readsEveryFile, SYNTHETIC_RUN } from './code-pass-fixture.js';

const W = CODE_REPORT_WORDS;
const START = '2030-01-01T00:00:00.000Z';
const BASE_PARSE = CODE_FILES['src/parse.js'].replace('split(",")', 'split(";")');
const T1 = { turn: 'T1' };
const OLD_NOW = 'export const old = 2;\nexport const other = 3;\n';
const LATER_DOC = 'SYNTHETIC_LATER_DOC: written by a later commit.\n';
const OUTSIDE_HEADING = `# The files ${OUTSIDE_SESSION_WORDS}`;

/** A git repository made of `base` (committed before the session), then `session` (the files as the session left them,
 *  uncommitted), then `later` (committed after the session: the repository moved). */
async function movedRepository(t, { base, session = {}, later = {} }) {
  const root = await mkdtemp(join(tmpdir(), 'sonah-d113o-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args, date = '2029-01-01T00:00:00Z') => execFileSync('git', args, { cwd: root, stdio: 'pipe',
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))),
      GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date, GIT_AUTHOR_NAME: 'synthetic', GIT_AUTHOR_EMAIL: 's@example.invalid',
      GIT_COMMITTER_NAME: 'synthetic', GIT_COMMITTER_EMAIL: 's@example.invalid' } }).toString();
  const write = async (files) => {
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), text);
    }
  };
  git(['init', '-q', '-b', 'main']);
  await write(base);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  await write(session);
  if (Object.keys(later).length) {
    await write(later);
    git(['add', '--', ...Object.keys(later)]);
    git(['commit', '-q', '-m', 'later work'], '2031-01-01T00:00:00Z');
  }
  return root;
}
async function recordingAt(t) {
  const dir = await mkdtemp(join(tmpdir(), 'sonah-d113o-rec-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'recording.jsonl');
  await writeFile(file, `${JSON.stringify({ timestamp: START })}\n`);
  return file;
}
/** A session that writes src/parse.js, then claims and ends. */
const parseSession = (key) => buildCodeSession(key, CODE_TEXT, [
  { id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
  { id: 'W1', kind: 'invocation', write: 'src/parse.js', blob: 'body', ...T1 },
  { id: 'W1-r', kind: 'observation', invocation: 'W1', blob: 'wrote', ...T1 },
  { id: 'C1', kind: 'commentary', blob: 'claim', ...T1 },
  { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
/** One `sonah review --code-pass` run: every request kept, the story (.md), the terminal and the record read back. */
async function reviewIn(t, { root, recording, session, judge, at = null, argv = [] }) {
  const dir = at ?? await mkdtemp(join(tmpdir(), 'sonah-d113o-run-'));
  if (at === null) t.after(() => rm(dir, { recursive: true, force: true }));
  const calls = [];
  let out = '', err = '';
  // A run in a folder of an earlier run writes its own story beside that run's.
  const output = join(dir, at === null ? 'story.md' : 'story-again.md');
  const state = join(dir, 'state');
  const code = await runSessionReviewCommand([recording, '--concurrency', '1', '--state-dir', state, '--format', 'md',
    '--output', output, '--no-open', '--code-pass', ...argv], {
    stdout: { write: (text) => { out += text; } }, stderr: { write: (text) => { err += text; } }, cwd: root,
    env: { HOME: join(dir, 'home'), SONAH_HOME: join(dir, '.sonah'), CODEX_HOME: join(dir, 'codex'),
      SONAH_CLAUDE_PROJECTS: join(dir, 'claude') },
    installSignals: false, loadReviews: async () => new Map(), openPage: async () => {},
    loadSession: async () => ({ session, hash: sha256('synthetic'), cwd: root }),
    createJudge: ({ onResult }) => async (request) => {
      calls.push(request);
      onResult({ ok: true, backend: 'claude-cli', attestation: 'attested', contextWindow: 1_000_000 });
      return judge(request);
    } });
  // A dry run (`--dry-run`) writes nothing: only what it printed and the calls it made (none).
  if (argv.includes('--dry-run')) return { code, calls, out, err, dir };
  const report = JSON.parse(await readFile(join(state, 'review', 'report.private.json'), 'utf8'));
  return { code, calls, out, written: await readFile(output, 'utf8'), report, dir };
}
/** The story's text with Markdown's escapes taken out. */
const plainText = (md) => md.replace(/\\(.)/g, '$1');
/** The ask's words a trace step of the code review may quote (the person's root instruction). */
const ASK_QUOTE = 'add a parse function that returns [] for empty input';
const OPEN_AWAY = 'SYNTHETIC_OPEN_AWAY: the later doc names no version';

/**
 * The code review's answer: the fixture's claim the code contradicts (on the session's own src/parse.js); and, when the
 * request shows the files outside the evaluated session, a bug on lib/old.js that leads from the ask and the claim and
 * whose trace quotes the ask, an ask not met on lib/old.js, and a bug on docs/later.md that its check finds not against
 * the goal.
 */
const reviewWith = (prompt) => {
  const items = dossierItems(prompt);
  const ask = items.find((i) => i.kind === 'ask');
  const claim = items.find((i) => i.kind === 'claim');
  const own = reviewFinding({ kind: 'claim_false', lens: 'claims', title: 'parse("") returns [""], not the empty list '
    + 'the agent said', leadsFrom: [claim.key] });
  if (!prompt.includes(OUTSIDE_HEADING)) return { findings: [own], questions: [] };
  const old = (over) => ({ kind: 'bug', lens: 'behaviour', title: 'old is 2 where its callers expect 1',
    claims: ['Callers read old as 1.'], input: 'import { old }',
    trace: [{ step: 'The person asked for parse.', path: null, side: 'session', startLine: null, endLine: null,
      quote: ASK_QUOTE }, { step: 'old is now 2.', path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1,
      quote: 'export const old = 2;' }],
    anchor: { path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1 }, leadsFrom: [ask.key, claim.key], ...over });
  return { findings: [own, old({}), old({ kind: 'ask_not_met', lens: 'ask', title: 'the ask is not met in lib/old.js',
    leadsFrom: [ask.key] }), { kind: 'bug', lens: 'behaviour', title: OPEN_AWAY, claims: [], input: 'read it',
    trace: [{ step: 'The doc line.', path: 'docs/later.md', side: 'new', startLine: 1, endLine: 1,
      quote: 'SYNTHETIC_LATER_DOC' }], anchor: { path: 'docs/later.md', side: 'new', startLine: 1, endLine: 1 },
    leadsFrom: [ask.key] }], questions: [] };
};
/** Every finding holds. D152: the one on docs/later.md with no receipt of what it breaks, so that, tied to nothing of
 *  the session (outside it, its `leadsFrom` is dropped), it is published open. */
const verifyWith = (finding) => (finding.title === OPEN_AWAY ? holdsWith(finding, [repositoryPremise(finding)], [])
  : holds(finding));
/** The item-by-item check agrees with the code review, and adds one finding of its own on lib/old.js. */
const accountWith = (prompt) => ({ ...accountsHold(prompt), findings: [{ kind: 'bug', lens: 'behaviour',
  title: 'SYNTHETIC_ACCOUNT: other is 3', claims: [], input: 'import { other }',
  trace: [{ step: 'other is 3.', path: 'lib/old.js', side: 'new', startLine: 2, endLine: 2,
    quote: 'export const other = 3;' }], anchor: { path: 'lib/old.js', side: 'new', startLine: 2, endLine: 2 },
  leadsFrom: [] }] });

test('D113 amended: the files outside the evaluated session are read apart and given to the code review after the session\'s own change; every finding on them is tagged and ties to no ask or claim of the session', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE, 'lib/old.js': 'export const old = 1;\n' },
    session: { 'src/parse.js': CODE_FILES['src/parse.js'] },
    later: { 'lib/old.js': OLD_NOW, 'docs/later.md': LATER_DOC } });
  const recording = await recordingAt(t);
  const session = parseSession('s-d113o-given');
  // The snapshot: the change is the session's own file; the files named apart are read apart, never into the change.
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.deepEqual(snapshot.files.map((f) => [f.path, f.diff]), [['src/parse.js', 'recorded']]);
  assert.deepEqual(snapshot.base.changedOutside, ['docs/later.md', 'lib/old.js']);
  assert.deepEqual(snapshot.outsideFiles.map((f) => [f.path, f.diff, f.recorded, f.type]), [
    ['docs/later.md', 'unrecorded_change', false, 'added'], ['lib/old.js', 'unrecorded_change', false, 'modified']]);
  assert.ok(!snapshotTexts(snapshot).some((text) => text.includes('SYNTHETIC_LATER_DOC')), 'never in the change');
  // The terminal's dry-run line: tagged, and given to the code review apart from the change.
  assert.ok(codeSnapshotLine(snapshot).includes(CODE_SNAPSHOT_WORDS.changedOutside(2, true)), codeSnapshotLine(snapshot));
  assert.ok(CODE_SNAPSHOT_WORDS.changedOutside(2, true).includes(OUTSIDE_SESSION_WORDS));

  const seen = [];
  const run = await reviewIn(t, { root, recording, session, judge: codeJudge({ review: reviewWith, verify: verifyWith,
    account: accountWith, seen }) });
  const pass = run.report.codePass;
  // The review agent's request: their block after the change; the change block counts them and names none.
  const review = run.calls.find((r) => r.label === 'code-review:agent');
  const [mine, theirs] = review.prompt.split(OUTSIDE_HEADING);
  assert.ok(theirs.includes('- docs/later.md → lines') && theirs.includes('SYNTHETIC_LATER_DOC'), 'given');
  assert.ok(!mine.includes('docs/later.md') && !mine.includes('lib/old.js'), 'not the change');
  // A finding's check: the block only beside a finding outside the evaluated session.
  const checks = run.calls.filter((r) => /^code-verify:F\d+$/.test(r.label));
  const checkOf = (title) => checks.find((r) => r.prompt.includes(JSON.stringify(title).slice(1, -1)));
  assert.ok(!checkOf('parse("") returns [""], not the empty list the agent said').prompt.includes(OUTSIDE_HEADING));
  assert.ok(checkOf('old is 2 where its callers expect 1').prompt.includes(OUTSIDE_HEADING));
  // The item-by-item check is shown neither their block nor a finding on them, and keeps the session's own change.
  for (const r of run.calls.filter((x) => /^code-account:/.test(x.label))) {
    assert.ok(!r.prompt.includes(OUTSIDE_HEADING) && !r.prompt.includes('lib/old.js'), r.label);
  }
  // The record: the session's own change as it is; their files apart.
  assert.deepEqual(pass.files.map((f) => f.path), ['src/parse.js']);
  assert.deepEqual(pass.outsideFiles.map((f) => [f.path, f.state, f.type]), [['docs/later.md', 'shown', 'added'],
    ['lib/old.js', 'shown', 'modified']]);
  // The findings: the session's own ties stand; the one on lib/old.js is tagged and ties to nothing of the session.
  const own = pass.findings.find((f) => f.kind === 'claim_false');
  assert.ok(own.outsideSession === undefined && own.leadsFrom.length === 1);
  const away = pass.findings.find((f) => f.anchor.path === 'lib/old.js');
  assert.deepEqual([away.outsideSession, away.leadsFrom, away.kind], [true, [], 'bug']);
  assert.ok(away.trace.some((s) => s.source === 'session'), 'its trace quotes the ask');
  assert.ok(pass.findings.every((f) => f.anchor.path !== 'lib/old.js' || f.outsideSession === true));
  // The ask not met on lib/old.js is out of scope (a tie kind), withheld tagged and with no row it leads from.
  const notMet = pass.withheld.find((w) => w.kind === 'ask_not_met');
  assert.deepEqual([notMet.reason, notMet.outsideSession, notMet.leadsFrom], ['out_of_scope', true, undefined]);
  // The item-by-item check's own finding on lib/old.js: out of scope there (it keeps the session's own change).
  const accounted = pass.withheld.find((w) => w.text === 'SYNTHETIC_ACCOUNT: other is 3');
  assert.deepEqual([accounted.reason, accounted.repair, accounted.outsideSession], ['out_of_scope', 'accounted', true]);
  // Why each is withheld: the tie kind as a tie, by its kind and with no cause of the scope; any other kind by the scope
  // (the change is the session's own).
  assert.ok(withheldWhy(notMet).startsWith(W.outsideTie.ask_not_met), withheldWhy(notMet));
  assert.ok(!withheldWhy(notMet).includes(W.withheldReasons.out_of_scope), withheldWhy(notMet));
  assert.ok(withheldWhy(accounted).startsWith(W.withheldReasons.out_of_scope), withheldWhy(accounted));
  // D152: the finding on docs/later.md, tied to nothing (outside the evaluated session its rows are dropped, and its
  // check gave no receipt of what it breaks): published open, tagged; no question comes from a finding.
  const open = pass.open.find((f) => f.title === OPEN_AWAY);
  assert.deepEqual([open.leadsFrom, open.outsideSession, pass.questions.filter((q) => q.from === 'finding')],
    [[], true, []]);
  // No ask tie and no claim contradiction from them: only the session's own finding contradicts the claim, and no ask
  // links anything outside the evaluated session.
  const claim = run.report.promises.find(Boolean);
  assert.equal(claim.codeCheck?.finding, own.id);
  const links = askCodeLinks(run.report, session).flat();
  assert.ok(links.every((l) => l.finding !== away.id), JSON.stringify(links));
  assert.ok(!links.some((l) => l.link === 'withheld_finding' && pass.withheld[l.withheld].outsideSession === true));
  assert.ok(!links.some((l) => l.link === 'question_concerns' && pass.questions[l.question].outsideSession === true));
  // The one tally: the session's own part as it is, and their part with its own counts that add up.
  const tally = codeChangeTally(pass);
  assert.deepEqual([tally.total, tally.outside.total], [1, 2]);
  assert.equal(CODE_TALLY_GROUPS.reduce((n, g) => n + tally.outside.groups[g].length, 0), tally.outside.total);
  assert.deepEqual(tally.outside.units.map((u) => [u.path, u.group]), [['docs/later.md', 'whole'],
    ['lib/old.js', 'whole']]);
  // Its receipts on their shown hunks count as inside what the review was shown.
  assert.equal(pass.receiptPlaces.outside, 0, JSON.stringify(pass.receiptPlaces));

  // The .md, the page and the terminal: each such file and each finding or question on one, tagged.
  const text = plainText(run.written);
  assert.ok(text.includes(`${W.outsideFiles(['docs/later.md', 'lib/old.js'])}.`), text);
  assert.ok(text.includes(W.outsideSeen([['whole', 2]], 0)), text);
  assert.ok(text.includes(REPORT_DID_WORDS.outsideSession(2)), 'the files list');
  assert.match(text, /^- `docs\/later\.md` · new · \+1 −0 · outside the evaluated session → item \d+$/m);
  assert.match(text, /^- `lib\/old\.js` · changed · \+2 −1 · outside the evaluated session → item \d+$/m);
  // An item's head, its words in emphasis (Markdown, or HTML in a fold), then the marker.
  const heads = text.replace(/<\/?em>|\*/g, '');
  assert.ok(heads.includes(`old is 2 where its callers expect 1 ${REPORT_ITEM_WORDS.outsideSession}`), 'the item');
  assert.ok(heads.includes(`${OPEN_AWAY} ${REPORT_ITEM_WORDS.outsideSession}`), 'the open finding on it');
  assert.ok(heads.includes(`the ask is not met in lib/old.js · ${W.outsideTag} · `
    + `${REPORT_NOT_CHECKED_WORDS.withheldWhy(withheldWhy(notMet))}`), 'the withheld finding, and why');
  assert.ok(!heads.includes(`not the empty list the agent said ${REPORT_ITEM_WORDS.outsideSession}`), 'the session\'s own');
  assert.equal(heads.split(REPORT_ITEM_WORDS.outsideSession).length - 1, 2, 'one marker an item on them');
  assert.ok(text.includes(REPORT_COUNT_WORDS.outside(2)), 'the count line');
  assert.ok(run.out.includes(`${REPORT_COUNT_WORDS.outside(2)}\n`), run.out);
  // The PR comment (its second review): the published findings counted apart, those about code outside the evaluated
  // session in the tag's words; never one count of both.
  const comment = publicCommentText({ ...run.report, ...honestStatuses(run.report) }).summary
    .replace(/\\(.)/g, '$1').replace(/&#64;/g, '@');
  assert.deepEqual(pass.findings.map((f) => f.outsideSession === true), [false, true]);
  assert.ok(comment.includes(`- ${ATTENTION_WORDS.codeFindings(1)}`), comment);
  assert.ok(comment.includes(`- ${ATTENTION_WORDS.codeFindingsOutside(1)}`), comment);
  assert.ok(ATTENTION_WORDS.codeFindingsOutside(1).includes(OUTSIDE_SESSION_WORDS));
  assert.ok(!comment.includes(ATTENTION_WORDS.codeFindings(2)), comment);
  const model = reportModel(session, run.report, {});
  const items = reportItems(model);
  const awayItems = items.filter((item) => item.scope.outsideSession === true);
  assert.equal(awayItems.length, 2);
  // Must act names each item by its label: tagged exactly when the item is about code outside the evaluated session.
  assert.ok(model.countLine.labels.some((l) => awayItems.some((item) => item.n === l.n)), 'one is named');
  for (const l of model.countLine.labels)
    assert.equal(l.parts.some((p) => p.text === REPORT_COUNT_WORDS.outsideLabel), awayItems.some((item) => item.n === l.n),
      `${l.n}`);
  // Its anchor's changed lines, by their file's change; its quotes shown only while their file is the one recorded.
  assert.deepEqual(away.anchorChanged, [1]);
  const receipt = away.receipts.find((r) => r.path === 'lib/old.js');
  assert.equal(codeReceiptFound(run.report, receipt), true);
  const moved = { ...run.report, codePass: { ...pass, outsideFiles: pass.outsideFiles.map((f) => (f.path === 'lib/old.js'
    ? { ...f, sha256: 'f'.repeat(64) } : f)) } };
  assert.equal(codeReceiptFound(moved, receipt), false, 'a quote of another version of their file');
  // The item's excerpt by the same rule: shown from the record, none for another version of their file.
  const excerptOfAway = (report) => [...reportModel(session, report, {}).tiers.must_act, ...reportModel(session, report, {})
    .tiers.must_know, ...reportModel(session, report, {}).tiers.good_to_know].find((item) => item.rowId === away.id)
    .where[0].excerpt;
  assert.ok(excerptOfAway(run.report) !== null, 'an excerpt');
  assert.equal(excerptOfAway(moved), null, 'none of another version');
  const { html: page } = sessionPage(session, run.report, {});
  assert.ok(page.includes(`<span class="scope">${REPORT_ITEM_WORDS.outsideSession}</span>`), 'the page\'s item');
  assert.ok(page.includes(`<p class="count-outside">${REPORT_COUNT_WORDS.outside(2)}</p>`), 'the page\'s count');
  assert.ok(page.includes(`<p class="note">${escapeHtml(REPORT_DID_WORDS.outsideSession(2))}</p>`), 'the page\'s files list');
  assert.equal(page.split(` · ${W.outsideTag}`).length - 1, 4, 'each file on the page\'s files list, each withheld finding');
});

test('D113 amended, judgment call (h) settled by the owner ("b"), on every path: a finding anchored in a file outside the evaluated session whose scope holds a changed line of the session\'s own is the session\'s, untagged and tied; one whose only changed lines in scope are theirs is tagged and ties to nothing (a claim the code contradicts withheld, its second review)', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE, 'lib/old.js': 'export const old = 1;\n' },
    session: { 'src/parse.js': CODE_FILES['src/parse.js'] }, later: { 'lib/old.js': OLD_NOW } });
  const session = parseSession('s-d113o-h');
  // Code steps: the session's own changed line of src/parse.js (2), an unchanged one (1), and lib/old.js's line their
  // change touched (1).
  const OWN = { step: 'parse splits on commas.', path: 'src/parse.js', side: 'new', startLine: 2, endLine: 2,
    quote: PARSE_QUOTE };
  const KEPT = { step: 'parse is exported.', path: 'src/parse.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export function parse(input) {' };
  const THEIRS = { step: 'old is now 2.', path: 'lib/old.js', side: 'new', startLine: 1, endLine: 1,
    quote: 'export const old = 2;' };
  const at = (step) => ({ path: step.path, side: step.side, startLine: step.startLine, endLine: step.endLine });
  const keys = {};
  const item = (kind, lens, title, trace, leadsFrom) => ({ kind, lens, title, claims: [], input: 'read it', trace,
    anchor: at(trace[0]), leadsFrom });
  const [HERE, HERE_CLAIM, AWAY, AWAY_CLAIM] = ['SYNTHETIC_H: a contract on lib/old.js that src/parse.js breaks',
    'SYNTHETIC_H: the claim, against lib/old.js through src/parse.js', 'SYNTHETIC_H: a contract on src/parse.js that '
    + 'lib/old.js breaks', 'SYNTHETIC_H: the claim, against src/parse.js through lib/old.js'];
  // The code review: anchored in lib/old.js through the session's own line (a contract break from the ask; a claim the
  // code contradicts from the claim); anchored in src/parse.js on a line the change did not touch, through lib/old.js's
  // changed line alone (the same two kinds).
  const review = (prompt) => {
    const items = dossierItems(prompt);
    keys.ask = items.find((i) => i.kind === 'ask').key;
    keys.claim = items.find((i) => i.kind === 'claim').key;
    return { findings: [item('contract_break', 'contracts', HERE, [THEIRS, OWN], [keys.ask]),
      item('claim_false', 'claims', HERE_CLAIM, [THEIRS, OWN], [keys.claim]),
      item('contract_break', 'contracts', AWAY, [KEPT, THEIRS], [keys.ask]),
      item('claim_false', 'claims', AWAY_CLAIM, [KEPT, THEIRS], [keys.ask, keys.claim])], questions: [] };
  };
  // The item-by-item check's own findings, the same two shapes with other kinds.
  const [ACC_HERE, ACC_AWAY] = ['SYNTHETIC_H_ACCOUNT: a rule on lib/old.js that src/parse.js breaks',
    'SYNTHETIC_H_ACCOUNT: the claim, against src/parse.js line 1 through lib/old.js'];
  const account = (prompt) => ({ ...accountsHold(prompt), findings: [
    item('rule_break', 'rules', ACC_HERE, [{ ...THEIRS }, OWN], [keys.ask]),
    item('claim_false', 'claims', ACC_AWAY, [{ ...KEPT, step: 'parse is the export.' }, THEIRS], [keys.ask, keys.claim])] });
  const run = await reviewIn(t, { root, recording: await recordingAt(t), session, judge: codeJudge({ review, account }) });
  const pass = run.report.codePass;
  const links = askCodeLinks(run.report, session).flat();
  const published = (title) => pass.findings.find((f) => f.title === title);
  const withheldAs = (title) => pass.withheld.find((w) => w.text === title);
  // The session's: untagged, tied — the ask links it, the claim is contradicted by it; its check is the session's own.
  for (const title of [HERE, HERE_CLAIM, ACC_HERE]) {
    const f = published(title);
    assert.ok(f, title);
    assert.deepEqual([f.outsideSession, f.anchor.path, f.leadsFrom.length], [undefined, 'lib/old.js', 1], title);
  }
  assert.ok(links.some((l) => l.finding === published(HERE).id), 'the ask links the contract break');
  assert.ok(links.some((l) => l.finding === published(ACC_HERE).id), 'the ask links the item-by-item check\'s finding');
  assert.equal(run.report.promises.find(Boolean).codeCheck?.finding, published(HERE_CLAIM).id, 'the claim, contradicted');
  // Theirs alone: tagged, no tie. A contract break in scope by their line alone is published tagged; a claim the code
  // contradicts so is withheld out of scope, tagged, with no row it leads from and no ask link (on either path).
  const away = published(AWAY);
  assert.deepEqual([away.outsideSession, away.leadsFrom], [true, []]);
  assert.ok(links.every((l) => l.finding !== away.id));
  for (const [title, repair] of [[AWAY_CLAIM, undefined], [ACC_AWAY, 'accounted']]) {
    const w = withheldAs(title);
    assert.deepEqual([w.reason, w.repair, w.outsideSession, w.leadsFrom], ['out_of_scope', repair, true, undefined],
      title);
    assert.ok(withheldWhy(w).startsWith(`${W.outsideTie.claim_false}, and `) || withheldWhy(w)
      === W.outsideTie.claim_false, withheldWhy(w));
    assert.ok(!links.some((l) => l.link === 'withheld_finding' && pass.withheld[l.withheld] === w), title);
  }
});

test('D113 amended: the session\'s own change and its coverage lines stay as they are when files outside the evaluated session are given beside it, whatever becomes of the checks of the findings on them', async (t) => {
  const base = { 'src/parse.js': BASE_PARSE, 'lib/old.js': 'export const old = 1;\n' };
  const session = parseSession('s-d113o-same');
  const still = await movedRepository(t, { base, session: { 'src/parse.js': CODE_FILES['src/parse.js'] } });
  const moved = await movedRepository(t, { base, session: { 'src/parse.js': CODE_FILES['src/parse.js'] },
    later: { 'lib/old.js': OLD_NOW, 'docs/later.md': LATER_DOC } });
  // The code review: the session's own claim the code contradicts; given the files outside the evaluated session, two
  // findings on them, whose checks fail (the call) and come back void (its re-ask's call fails too). A check too large
  // to send cannot be reached here at the request bound (the session review takes no rule file over it): the evidence
  // test holds that one (d113-outside-session.test.js, "counted apart").
  const [FAILS, VOID] = ['SYNTHETIC_AWAY_FAILS: old is 2', 'SYNTHETIC_AWAY_VOID: other is 3'];
  const review = (prompt) => {
    const items = dossierItems(prompt);
    const ask = items.find((i) => i.kind === 'ask');
    const own = reviewFinding({ kind: 'claim_false', lens: 'claims', title: 'parse("") returns [""], not the empty list '
      + 'the agent said', leadsFrom: [items.find((i) => i.kind === 'claim').key] });
    if (!prompt.includes(OUTSIDE_HEADING)) return { findings: [own], questions: [] };
    const away = (title, line, quote) => ({ kind: 'bug', lens: 'behaviour', title, claims: [], input: 'read it',
      trace: [{ step: 'The changed line.', path: 'lib/old.js', side: 'new', startLine: line, endLine: line, quote }],
      anchor: { path: 'lib/old.js', side: 'new', startLine: line, endLine: line }, leadsFrom: [ask.key] });
    return { findings: [own, away(FAILS, 1, 'export const old = 2;'), away(VOID, 2, 'export const other = 3;')],
      questions: [] };
  };
  const verify = (finding, request) => {
    if (finding.title === FAILS || (finding.title === VOID && request.label.endsWith(':reask')))
      throw new Error('SYNTHETIC: the call did not answer');
    return finding.title === VOID ? {} : holds(finding);
  };
  // Only the checks shown their block read anything: every file of the fixture, the session's own src/parse.js among them.
  const run = (request) => (/^code-verify:F\d+/.test(request.label) && request.prompt.includes(OUTSIDE_HEADING)
    ? readsEveryFile(request) : SYNTHETIC_RUN);
  const judge = () => codeJudge({ review, verify, run });
  const quiet = await reviewIn(t, { root: still, recording: await recordingAt(t), session, judge: judge() });
  const busy = await reviewIn(t, { root: moved, recording: await recordingAt(t), session, judge: judge() });
  const [a, b] = [quiet.report.codePass, busy.report.codePass];
  assert.equal(a.outsideFiles, undefined);
  assert.equal(b.outsideFiles.length, 2);
  // Each finding on them was withheld, tagged, by what became of its check; their checks' calls are counted apart (one
  // call failed, one re-ask failed).
  assert.deepEqual(b.withheld.filter((w) => w.outsideSession === true).map((w) => [w.text, w.reason]),
    [[FAILS, 'request_failed'], [VOID, 'verify_unexecuted']]);
  assert.deepEqual(b.outsideChecks, { keys: ['F2', 'F3'], failed: 2, tooLarge: 0 });
  assert.equal(a.outsideChecks, undefined);
  assert.ok(b.agents.some((x) => x.label === 'code-verify:F3' && x.run.reads.some((r) => r.path === 'src/parse.js')),
    'a check of a finding on them read the session\'s own file');
  // The session's own, as in the repository that did not move: its change, coverage, footer, gaps, findings, questions
  // and withheld rows; the coverage and footer lines; the one tally's part of it (what its checks read among it); the
  // manifest; the header; the terminal's run-state line; the exit code.
  assert.equal(a.coverage, 'complete');
  const own = (rows) => rows.filter((x) => x.outsideSession !== true).map(({ id: _id, ...rest }) => rest);
  for (const key of ['files', 'coverage', 'footer', 'gaps']) assert.deepEqual(b[key], a[key], key);
  for (const key of ['findings', 'questions', 'withheld']) assert.deepEqual(own(b[key]), own(a[key]), key);
  assert.deepEqual(codeCoverageLines(b), codeCoverageLines(a));
  assert.deepEqual(codeFooterLines(busy.report), codeFooterLines(quiet.report));
  const { outside: _outside, units: unitsB, ...ownB } = codeChangeTally(b);
  const { units: unitsA, ...ownA } = codeChangeTally(a);
  assert.deepEqual([ownB, unitsB], [ownA, unitsA]);
  assert.deepEqual(b.manifest.review.files, a.manifest.review.files);
  const headerOf = (report) => { const { size, runs, reviewIncomplete, didNotCheck, noCode } = reportModel(session, report,
    {}).header; return { size, runs, reviewIncomplete, didNotCheck, noCode }; };
  assert.deepEqual(headerOf(busy.report), headerOf(quiet.report));
  const runState = (out) => out.split('\n').find((line) => line.startsWith('Sonah\'s review:'));
  assert.equal(runState(busy.out), runState(quiet.out));
  assert.deepEqual([busy.code, quiet.code], [0, 0], 'the exit code (--code-pass makes the code review\'s coverage count)');
  // Only the count of what the code review saw of them is added.
  assert.equal(codeOutsideSeenLine(a), null);
  assert.equal(codeOutsideSeenLine(b), W.outsideSeen([['whole', 2]], 0));
});

test('D113 amended: the reuse dry run counts the block of the files outside the evaluated session in the review request it would send, and says they are given only if there is room for them', async (t) => {
  // A later doc of about 20 KB: their block alone moves the request's size by many KB.
  const big = Array.from({ length: 400 }, (_, i) => `SYNTHETIC_LATER_LINE ${String(i).padStart(3, '0')}: a line that `
    + 'a later commit wrote.').join('\n') + '\n';
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE, 'lib/old.js': 'export const old = 1;\n' },
    session: { 'src/parse.js': CODE_FILES['src/parse.js'] }, later: { 'lib/old.js': OLD_NOW, 'docs/later.md': big } });
  const recording = await recordingAt(t);
  const session = parseSession('s-d113o-dry');
  const first = await reviewIn(t, { root, recording, session, judge: codeJudge() });
  const review = first.calls.find((r) => r.label === 'code-review:agent');
  assert.ok(review.prompt.split(OUTSIDE_HEADING)[1].includes('SYNTHETIC_LATER_LINE 399'), 'their block, whole');
  // The dry run on the same state: the same review request, its size counted with their block.
  const dry = await reviewIn(t, { root, recording, session, judge: codeJudge(), at: first.dir, argv: ['--dry-run'] });
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual(dry.calls, []);
  const kb = /code-review:agent (\d+) KB/.exec(dry.out);
  assert.equal(Number(kb?.[1]), Math.ceil((Buffer.byteLength(review.system, 'utf8')
    + Buffer.byteLength(review.prompt, 'utf8')) / 1024), dry.out);
  // Its snapshot line: given apart only if there is room for them (their block gives way first).
  assert.ok(dry.out.includes(CODE_SNAPSHOT_WORDS.changedOutside(2, true)), dry.out);
  assert.ok(CODE_SNAPSHOT_WORDS.changedOutside(2, true).endsWith(' If there is room in the code review\'s input, Sonah '
    + 'gives them to the code review apart from the change.'));
});

test('D113 amended: with no change of the session\'s own to review, no code review runs and the files outside the evaluated session are said so, tagged', async (t) => {
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE }, later: { 'lib/old.js': OLD_NOW,
    'docs/later.md': LATER_DOC } });
  const recording = await recordingAt(t);
  const session = buildCodeSession('s-d113o-none', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  const snapshot = await readCodeSnapshot(session, { root, maxBytes: 1_000_000, recording });
  assert.equal(snapshot.outsideFiles.length, 2, 'read');
  assert.ok(codeSnapshotLine(snapshot).includes(CODE_SNAPSHOT_WORDS.changedOutside(2, false)), 'not given');
  const run = await reviewIn(t, { root, recording, session, judge: codeJudge() });
  assert.deepEqual(run.calls.filter((r) => /^code-/.test(r.label)), [], 'no code review call');
  assert.equal(run.report.codePass.outsideFiles, undefined);
  const text = plainText(run.written);
  assert.ok(text.includes(`${W.changedOutside(['docs/later.md', 'lib/old.js'])}.`), text);
  assert.ok(text.includes(W.noWrite), text);
  assert.ok(text.includes(REPORT_DID_WORDS.outsideSession(2)), 'the files list');
  assert.match(text, /^- `docs\/later\.md` · outside the evaluated session$/m);
  // The page's row the same: its path and the tag, no type with no record of the file.
  const { html: page } = sessionPage(session, run.report, {});
  assert.ok(page.includes(`<li><code>docs/later.md</code> · ${W.outsideTag}</li>`), 'the page\'s files list');
});

test('D113 amended: the files list names the first files outside the evaluated session, as the code review\'s note does, and counts the rest, on the page and in the .md', async (t) => {
  const bound = CODE_REPORT_LIMITS.changedOutsideNames;
  const later = Object.fromEntries(Array.from({ length: bound + 2 }, (_, i) => [`docs/n${String(i).padStart(2, '0')}.md`,
    `SYNTHETIC_LATER_DOC ${i}\n`]));
  const root = await movedRepository(t, { base: { 'src/parse.js': BASE_PARSE }, later });
  const recording = await recordingAt(t);
  const session = buildCodeSession('s-d113o-more', CODE_TEXT, [{ id: 'I1', kind: 'instruction', blob: 'ask', ...T1 },
    { id: 'C2', kind: 'commentary', blob: 'final', phase: 'final', ...T1 }]);
  const run = await reviewIn(t, { root, recording, session, judge: codeJudge() });
  const text = plainText(run.written);
  const lines = text.split('\n');
  const lead = lines.indexOf(REPORT_DID_WORDS.outsideSession(bound + 2));
  assert.ok(lead >= 0, text);
  const rows = lines.slice(lead + 1).filter((line) => line.trim()).slice(0, bound + 1);
  assert.deepEqual(rows.slice(0, bound), Object.keys(later).slice(0, bound).map((p) => `- \`${p}\` · ${W.outsideTag}`));
  assert.equal(rows[bound], REPORT_DID_WORDS.moreFiles(2));
  const { html: page } = sessionPage(session, run.report, {});
  const [, away] = page.split(`<p class="note">${escapeHtml(REPORT_DID_WORDS.outsideSession(bound + 2))}</p>`);
  assert.ok(away.startsWith(`<ul class="files"><li><code>docs/n00.md</code> · ${W.outsideTag}</li>`), away.slice(0, 200));
  assert.ok(!away.split('</ul>')[0].includes('docs/n10.md'), 'the first names only');
  assert.ok(away.split('</ul>')[1].startsWith(`<p class="cut">${escapeHtml(REPORT_DID_WORDS.moreFiles(2))}</p>`),
    away.slice(0, 2000));
});

test('D113 amended readers: the line of the files outside the evaluated session says whether the code review saw them, bounded as before, and its counts add up to them', () => {
  const commit = 'c'.repeat(40);
  const unit = (path, state, shown, lines = 10) => ({ path, state, side: 'new', shown, change: [[1, lines]],
    beforeUnshown: 0, lines, recorded: false });
  const bound = CODE_REPORT_LIMITS.changedOutsideNames;
  for (const n of [1, bound, bound + 1, 30]) {
    const paths = Array.from({ length: n }, (_, i) => `docs/f${String(i).padStart(3, '0')}.md`);
    const outsideFiles = paths.map((path, i) => (i % 3 === 0 ? unit(path, 'whole', [[1, 10]])
      : i % 3 === 1 ? unit(path, 'hunks_only', [[1, 2]]) : unit(path, 'left_out', [])));
    const pass = { ran: true, base: { kind: 'git', commit, how: 'reflog', changedOutside: [...paths].reverse(),
      written: 1 }, files: [{ path: 'src/a.js', state: 'shown' }], withheld: [], footer: [], coverage: 'complete',
    agent: { terminal: 'answered' }, agents: [],
    manifest: { review: { sent: true, files: [unit('src/a.js', 'whole', [[1, 10]])], rules: [], outsideFiles } } };
    const line = codeChangedOutsideLine(pass);
    assert.equal(line, W.outsideFiles(paths.slice(0, bound), Math.max(0, n - bound)), `${n}`);
    assert.ok(line.includes(OUTSIDE_SESSION_WORDS), line);
    const outside = codeChangeTally(pass).outside;
    assert.equal(outside.total, n);
    const seen = codeOutsideSeenLine(pass);
    // Each group's count, and the files not seen, sum to the files the line counts.
    const counts = [...seen.matchAll(/(?:saw|see) (\d+)/g)].map((m) => Number(m[1]));
    assert.equal(counts.reduce((a, b) => a + b, 0), n, seen);
    // The session's own part does not move.
    assert.deepEqual(codeCoverageLines(pass), codeCoverageLines({ ...pass, manifest: { review: { ...pass.manifest.review,
      outsideFiles: undefined } } }));
    // A review that did not answer, or was not sent, did not review them.
    for (const review of [{ ...pass.manifest.review, sent: false }]) {
      const unsent = { ...pass, manifest: { review } };
      assert.equal(codeChangedOutsideLine(unsent), W.changedOutside(paths.slice(0, bound), Math.max(0, n - bound)));
      assert.equal(codeOutsideSeenLine(unsent), null);
    }
  }
});

test('D113 amended docs: TROUBLESHOOTING explains the line of the files outside the evaluated session and the item marker; PRIVACY says they are sent apart and left out first', async () => {
  const flat = (text) => text.replace(/\s+/g, ' ');
  const trouble = await readFile(new URL('../../../docs/TROUBLESHOOTING.md', import.meta.url), 'utf8');
  const row = trouble.split('\n').find((line) => line.startsWith('  | files that changed outside this session\'s '
    + 'recorded writes are outside the evaluated session |'));
  assert.ok(row, 'the row of the line when the code review was given them');
  assert.ok(W.outsideFiles(['a.md']).startsWith('1 file that changed outside this session\'s recorded writes is outside '
    + 'the evaluated session'), 'the row names the words the page prints');
  assert.ok(row.includes(REPORT_ITEM_WORDS.outsideSession), row);
  const privacy = flat(await readFile(new URL('../../../docs/PRIVACY.md', import.meta.url), 'utf8'));
  assert.ok(privacy.includes('Sonah leaves out whole parts (first the files outside the evaluated session, then the '
    + 'lines the session read'), 'left out first');
  assert.ok(privacy.includes('is outside the evaluated session: when the change holds a file to review, it is sent too'));
});
