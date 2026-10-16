// Fix 1 made safe to share: "Referred from <path>" names a project instruction file by the path the
// recording carries only when that path lies inside the working tree as written. An absolute path, a home-relative one
// or one that climbs out of the tree is named by its file name alone, on the page, in the report .md and in the report
// (session.js `referredPath`), never by a home or absolute path. Structure only: the path's segments, no file system.
// Every recording here is synthetic (invented asks, rules, paths and code); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { referredPath } from '../src/session.js';
import { renderSessionPage } from '../../render/session-page.js';
import { REPORT_ITEM_WORDS } from '../../render/report-words.js';
import { renderReportMarkdown } from '../../render/session-story.js';

const ASK = 'Write the parser in src/parser.js.';
const RULE = 'Trim every input with s.trim() before parsing it.';
const RULES = `# Project rules\n${RULE}\nNever add a runtime dependency.`;
const CODE = 'export const parse = (s) => s.trim();\n';

/** One request recorded in /repo: the ask, the project's instruction file at `path` as the harness gave it, the write
 *  that adopted the choice, and the agent's closing words. */
const rows = (path) => [
  humanAsk(ASK),
  row({ type: 'attachment', attachment: { type: 'instructions', files: [{ path, type: 'Project', content: RULES }] } }),
  call('w1', 'Write', { file_path: '/repo/src/parser.js', content: CODE }, 'Writing the parser now.'),
  result('w1', 'File created successfully at: /repo/src/parser.js', { type: 'create', filePath: '/repo/src/parser.js',
    content: CODE, structuredPatch: [] }),
  said('The parser is written.'),
].map((r, i) => ({ ...r, uuid: `u-referred-${i + 1}` }));

async function fixture(t, path) {
  const { session } = await load(t, rows(path));
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write');
  return { session, ask, write, file: session.projectInstructions[0] ?? null };
}

const fileQuote = (file) => ({ eventId: file.id, role: 'project-instructions', quote: RULE });
const codeQuote = (write) => ({ eventId: write.id, role: 'code', quote: 's.trim()' });
const decision = (write, extra) => ({ dimension: 'input trimming', chosen: 'trim the input', value: 's.trim()',
  valueReceipt: { ...codeQuote(write), field: 'added-code' }, actions: [write.id], ...extra });
/** A session-only review whose one window answers `decisionOf(scopeDigest)`, every challenge vote upholding it. */
const reviewWith = (session, write, decisionOf, voteReceipt) => runReview({ session, reviewScope: 'session-only',
  judge: async (request) => (!request.challenge
    ? { decisions: [decisionOf(/^scopeDigest: (\S+)$/m.exec(request.prompt)?.[1] ?? null)], pivots: [], claims: [],
      requirements: [] }
    : { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
      explanation: 'Synthetic.', receipts: [voteReceipt] })) }) });
/** A decision the project file settled (its covering words and its value quoted from the file). */
const settledReview = (session, write, file) => reviewWith(session, write, () => decision(write, {
  constrainedBy: { instruction: fileQuote(file), settles: true, settledValueQuote: 's.trim()' } }), fileQuote(file));
/** A decision made without asking, whose review checked the ask and the project file, neither relevant. */
const unaskedReview = (session, write, ask, file) => reviewWith(session, write, (scopeDigest) => decision(write, {
  instructionReview: { dimension: 'input trimming', scopeDigest, noRelevantInstruction: true, checks: [
    { instruction: { eventId: ask.id, role: 'instruction', quote: ASK }, relevant: false,
      explanation: 'SYNTHETIC: the ask names the file, not how its input is trimmed.' },
    { instruction: fileQuote(file), relevant: false,
      explanation: 'SYNTHETIC: the project file says nothing that covers this choice.' }] } }), codeQuote(write));
const label = (text) => `<span class="label">${text}</span>`;
/** D97: the page names a project instruction file by the words it labels the file's quote with. */
const fileLabel = (name) => label(REPORT_ITEM_WORDS.referredFrom(name));

test('referred path: inside the working tree as written it reads as recorded; else only its file name', () => {
  for (const inside of ['CLAUDE.md', 'docs/AGENTS.md', './CLAUDE.md', 'docs/../CLAUDE.md', 'a/b/../../CLAUDE.md'])
    assert.equal(referredPath(inside), inside, inside);
  for (const [outside, name] of [
    ['/srv/team-rules/CLAUDE.md', 'CLAUDE.md'], // absolute
    ['~/team-rules/CLAUDE.md', 'CLAUDE.md'], // home-relative
    ['~fixture/team-rules/AGENTS.md', 'AGENTS.md'], // another user's home
    ['$HOME/team-rules/CLAUDE.md', 'CLAUDE.md'], ['${HOME}/CLAUDE.md', 'CLAUDE.md'],
    ['%USERPROFILE%\\team-rules\\CLAUDE.md', 'CLAUDE.md'],
    ['../team-rules/CLAUDE.md', 'CLAUDE.md'], ['docs/../../CLAUDE.md', 'CLAUDE.md'], // climbs out of the tree
    ['C:\\fixture\\team-rules\\CLAUDE.md', 'CLAUDE.md'], ['C:/fixture/CLAUDE.md', 'CLAUDE.md'], // a drive
    ['\\\\server\\share\\CLAUDE.md', 'CLAUDE.md'], ['file:///srv/team-rules/CLAUDE.md', 'CLAUDE.md'],
    ['/srv/team-rules/CLAUDE.md/', 'CLAUDE.md'], ['/srv/./team-rules/../CLAUDE.md', 'CLAUDE.md'],
    ['/', '…'], ['~', '…'], ['', '…'], // no file name past the root
  ]) {
    assert.equal(referredPath(outside), name, outside);
    assert.equal(referredPath(referredPath(outside)), name, `${outside}: once named, it stays named`);
  }
});

for (const [kind, path, dir] of [
  ['an absolute path', '/srv/team-rules/CLAUDE.md', '/srv/team-rules'],
  ['a home path', '~/team-rules/CLAUDE.md', '~/team-rules'],
  ['a path climbing out of the tree', '../team-rules/CLAUDE.md', '../team-rules'],
]) {
  test(`referred path: a project file at ${kind} is named by its file name alone everywhere`, async (t) => {
    const { session, write, ask, file } = await fixture(t, path);
    assert.equal(file.path, path, 'premise: the recording carries the path as the harness gave it');
    const report = await settledReview(session, write, file);
    assert.equal(report.decisions.length, 1);
    const [d] = report.decisions;
    assert.equal(d.column, 'asked-settled');
    assert.equal(d.constrainedBy.referredFrom, path, 'the row keeps the recorded path; only what a person reads moves');
    const html = renderSessionPage(session, report);
    assert.ok(html.includes(`${fileLabel('CLAUDE.md')} <q class="said">`), 'the page names the file');
    // D97: the report .md (the story since /32) lists the decision you settled with the file's words under its name.
    const story = renderReportMarkdown(session, report);
    assert.ok(story.includes(`${REPORT_ITEM_WORDS.referredFrom('CLAUDE.md')} “`), 'the report .md names the file');
    // The unasked decision's check names the file the same way, in its sentence and its folded quote.
    const unasked = await unaskedReview(session, write, ask, file);
    assert.equal(unasked.decisions[0].column, 'unasked');
    const checked = renderSessionPage(session, unasked);
    assert.ok(checked.includes(REPORT_ITEM_WORDS.checkedAgainst(1, ['CLAUDE.md'])), 'the sentence');
    for (const [where, text] of [['page', html], ['story', story], ['unasked page', checked],
      ['unasked story', renderReportMarkdown(session, unasked)]])
      assert.ok(!text.includes(dir), `the ${where} never shows where the file lies`);
  });
}

test('referred path: a project file inside the working tree is named by the path it carries', async (t) => {
  const { session, write, file } = await fixture(t, '/repo/docs/AGENTS.md');
  assert.equal(file.path, 'docs/AGENTS.md', 'premise: the slicer spells it under the recorder\'s working directory');
  const report = await settledReview(session, write, file);
  assert.ok(renderSessionPage(session, report).includes(`${fileLabel('docs/AGENTS.md')} <q class="said">`));
  assert.ok(renderReportMarkdown(session, report).includes(`${REPORT_ITEM_WORDS.referredFrom('docs/AGENTS.md')} “`));
});
