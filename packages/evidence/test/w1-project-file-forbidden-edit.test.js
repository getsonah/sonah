// W1 B (owner decision 2026-10-13; D83 (2) carried into step 5): what the person wrote for the agent in a project
// instruction file given to the main agent before a change counts as their words, so a change against it is an edit
// against what they said (`forbiddenEdits`, role project-instructions). Before, only a human message could be the
// instruction an edit goes against, and a decision whose answer went against such a file was filed "you settled it" on
// it. Code checks the file by structure (projectFilesBefore: shown to the main agent whole, before the
// change), the challenge judges it on the file form of the proposition, and every reader labels the file's words as the
// file's. Every recording here is synthetic (invented rules, paths and code); no model is called — the judges are code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { projectFilesBefore, groundFinding, FORBIDDEN_EDIT_REJECTIONS } from '../src/ledger.js';
import { readForbiddenEdit, forbiddenShape } from '../src/forbidden.js';
import { CHALLENGE_PROFILE, FORBIDDEN_EDIT_PROPOSITION, FORBIDDEN_EDIT_PROPOSITION_FILE, FORBIDDEN_EDIT_NOTE,
  forbiddenEditProposition } from '../src/challenge.js';
import { SONAH_SESSION_REVIEW_AGENT, SESSION_REVIEW_AGENT_VERSION } from '../src/review-agent.js';
import { SESSION_NARRATIVE_SCHEMA } from '../src/prompt.js';
import { renderSessionPage, PAGE_VERSION } from '../../render/session-page.js';
import { renderReportMarkdown, STORY_VERSION } from '../../render/session-story.js';

const ASK = 'Add left-pad support to the formatter.';
const RULE = 'Never add a runtime dependency.';
const RULES = `# Project rules\nKeep functions small.\n${RULE}`;
const PACKAGE = '{"name":"fmt","dependencies":{"left-pad":"1.3.0"}}\n';
const DEPENDENCY = '"left-pad":"1.3.0"';
const projectFile = () => row({ type: 'attachment', attachment: { type: 'instructions',
  files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } });
/** The ask, the project's instruction file (before the write, or after it: `late`), the write that added the
 *  dependency, and the agent's closing words. */
const rows = ({ late = false } = {}) => [
  humanAsk(ASK),
  ...(late ? [] : [projectFile()]),
  call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency.'),
  result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
    content: PACKAGE, structuredPatch: [] }),
  ...(late ? [projectFile()] : []),
  said('Added left-pad support.'),
].map((r, i) => ({ ...r, uuid: `u-w1b-${i + 1}` }));

async function fixture(t, options) {
  const { session } = await load(t, rows(options));
  const write = session.events.find((e) => e.kind === 'invocation' && e.operation === 'write');
  return { session, write, file: session.projectInstructions[0] };
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const edit = (n, role = 'project-instructions') => ({ text: 'The project said never to add a runtime dependency; the '
  + 'agent added left-pad.', instruction: quote(n.file.id, role, RULE), violation: quote(n.write.id, 'code', DEPENDENCY) });
const answer = (edits) => ({ requirements: [], claims: [], decisions: [], pivots: [], forbiddenEdits: edits });
/** Every challenge item upheld, citing its own instruction (a forbidden edit's: the file) or its first receipt. */
const judgeOf = (first, seen = []) => async (request) => {
  seen.push(request);
  if (!request.challenge) return first;
  return { votes: request.challenge.items.map((item) => ({ key: item.key, verdict: 'not-refuted',
    explanation: 'Synthetic.', receipts: [item.candidate.instruction ?? item.candidate.statement] })) };
};

test('W1 B: the versions, the contract and the brief', () => {
  // W2 moved it once more (sonah.session-review-agent/11): a claim is compared with the evidence; the agent's own text.
  assert.equal(SESSION_REVIEW_AGENT_VERSION, 'sonah.session-review-agent/11');
  // W2 moved it once more (sonah.challenge/32): CLAIM_NOTE judges the agent's own written text like a result.
  // W3 F1(b) moved it once more (sonah.challenge/33): a support with changes since its run is asked, listed.
  // W3 F2 moved it once more (sonah.challenge/34): a support whose result failed is asked, judged on its outcome.
  // The fix review moved it (sonah.challenge/35 to /37): stopped results, a file rule's lifts, the existence check.
  // D87 moved it once more (sonah.challenge/38, its /35 renumbered at the merge): the code pass's own run; no other
  // request byte moved.
  // The code step moved it once more (sonah.challenge/39): the code pass's run left challengeItems for a runner of its
  // own, verdict first; no other request byte moved.
  // The review of the code step moved it once more (sonah.challenge/40): no `duplicate` refutation, and a
  // finding's checker sees no agent words; no other request byte moved.
  // The second review of the code step moved it once more (sonah.challenge/41): a code check's checker sees no word
  // of the agent's in any row; no other request byte moved.
  // The third review of the code step moved it once more (sonah.challenge/42): a code check's checker sees
  // what its row states again; no other request byte moved.
  // The re-ask of a void vote moved it once more (sonah.challenge/43): a vote a reply cast that could not be
  // counted is asked again once, naming its cause; no first-round request byte moved.
  // Its withdrawal moved it once more (sonah.challenge/44): a vote a reply cast that could not be counted stands
  // again, as before /43; no first-round request byte moved.
  assert.equal(CHALLENGE_PROFILE.version, 'sonah.challenge/44');
  // W2 moved both once more (story /21, page /26): the agent's own earlier text that contradicts a claim says so.
  // The review of W4 moved it once more (sonah.session-story/22): an ask no action followed says why it reads not done.
  // D87 moved it once more (sonah.session-story/23, its /22 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-story/24): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-story/25): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-story/26, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-story/27): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-story/28): one counting, the claims every reader lists.
  // The release review moved it once more (sonah.session-story/29): with the home folder as the repository, the footer
  // says only the session's files were read and counts the rest.
  // The agentic code step's release item moved it once more (sonah.session-story/30): an ask's status beside what the
  // code step tied to it, the session shown as loaded (the footer saying the story is generated from the recorded
  // session), and the code step's new report.
  // The cleanup moved it once more (sonah.session-story/31): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // D97 moved it once more (sonah.session-story/32): the story is the report .md.
  assert.equal(STORY_VERSION, 'sonah.session-story/32');
  // W4 moved it once more (sonah.session-page/27): an ask no action followed reads not done in this session.
  // D87 moved it once more (sonah.session-page/28, its /27 renumbered at the merge): a review with a code pass lists
  // what the code review found.
  // The W4 revert moved it once more (sonah.session-page/29): W4's words beside an ask are gone with W4.
  // D88 moved it once more (sonah.session-page/30): the judgment first, the rows Sonah could not check folded.
  // The code step moved it once more (sonah.session-page/31, renumbered at its merge with D88): what the code
  // review found, in the method's order. The review of the code step moved it once more (sonah.session-page/32): the
  // footer counts paths outside the working directory.
  // The judgment-first review moved it once more (sonah.session-page/33): one counting, folded groups by their count.
  // The release review moved it once more (sonah.session-page/34): with the home folder as the repository, the footer
  // says only the session's files were read and counts the rest.
  // The agentic code step's release item moved it once more (sonah.session-page/35): an ask's status beside what the
  // code step tied to it, the session shown as loaded (the footer saying the page is generated from the recorded
  // session), and the code step's new report.
  // The cleanup moved it once more (sonah.session-page/36): no statement found to hold, no row shown in the code, no
  // claim found false and no all-clear footer.
  // The report model moved it once more (sonah.session-page/37, D97): the page renders the report's tiers.
  assert.equal(PAGE_VERSION, 'sonah.session-page/37');
  const role = SESSION_NARRATIVE_SCHEMA.properties.forbiddenEdits.items.properties.instruction.properties.role;
  assert.deepEqual(role, { enum: ['instruction', 'project-instructions'] });
  // The brief: step 5 and its contract rule admit the file; step 3 never settles a choice on words its answer goes
  // against or reaches beyond.
  assert.ok(SONAH_SESSION_REVIEW_AGENT.includes('or in a project instruction file given to the main agent before the'));
  assert.ok(SONAH_SESSION_REVIEW_AGENT.includes('"instruction": {"eventId":"E<k>","role":"instruction|project-instructions"'));
  assert.ok(SONAH_SESSION_REVIEW_AGENT.includes('goes against or reaches beyond never settle the choice'));
  assert.ok(!SONAH_SESSION_REVIEW_AGENT.includes('Only the human\'s own words count as the instruction'));
  // The file form of the proposition, chosen by the role code sets from the cited source.
  assert.notEqual(FORBIDDEN_EDIT_PROPOSITION_FILE, FORBIDDEN_EDIT_PROPOSITION);
  assert.equal(forbiddenEditProposition({ instruction: { role: 'project-instructions' } }),
    FORBIDDEN_EDIT_PROPOSITION_FILE);
  assert.equal(forbiddenEditProposition({ instruction: { role: 'instruction' } }), FORBIDDEN_EDIT_PROPOSITION);
  assert.ok(FORBIDDEN_EDIT_NOTE.includes('project instruction file'));
});

test('W1 B: code reads an edit against a project instruction file the main agent was given before it', async (t) => {
  const n = await fixture(t);
  assert.deepEqual(projectFilesBefore(n.session, [n.write]), [{ eventId: n.file.id, path: 'CLAUDE.md' }]);
  assert.ok(forbiddenShape(edit(n)), 'the contract admits the file\'s role');
  const sourceMap = { [n.file.id]: [{ role: 'project-instructions', text: RULES }],
    [n.write.id]: [{ role: 'code', text: PACKAGE }] };
  const read = readForbiddenEdit(edit(n), { session: n.session, sourceMap });
  assert.ok(read.edit, `withheld ${read.withheld}`);
  assert.deepEqual([read.edit.instruction.eventId, read.edit.instruction.role, read.edit.breach],
    [n.file.id, 'project-instructions', 'wrote']);
  // The role is the cited source's, never the model's word.
  const named = readForbiddenEdit(edit(n, 'instruction'), { session: n.session, sourceMap });
  assert.equal(named.edit?.instruction.role, 'project-instructions');
  // The file must be one the main agent was given before the change.
  const late = await fixture(t, { late: true });
  const lateMap = { [late.file.id]: [{ role: 'project-instructions', text: RULES }],
    [late.write.id]: [{ role: 'code', text: PACKAGE }] };
  assert.equal(readForbiddenEdit(edit(late), { session: late.session, sourceMap: lateMap }).withheld,
    FORBIDDEN_EDIT_REJECTIONS[11], 'not_after');
  // A human message is still read as before; a role of project-instructions on it does not ground.
  const ask = n.session.events.find((e) => e.kind === 'instruction');
  const humanMap = { ...sourceMap, [ask.id]: [{ role: 'instruction', text: ASK }] };
  assert.equal(readForbiddenEdit({ ...edit(n), instruction: quote(ask.id, 'project-instructions', 'left-pad support') },
    { session: n.session, sourceMap: humanMap }).withheld, 'instruction_ungrounded');
});

test('W1 B: an edit against the project file is checked on the file form, published, and every reader names the file',
  async (t) => {
    const n = await fixture(t);
    // The default CLI profile (m33-lean, its forbidden-edit run shown a dossier) publishes it too.
    const lean = await runReview({ session: n.session, pr: null, reviewScope: 'session-only', speedProfile: 'm33-lean',
      judge: judgeOf(answer([edit(n)])) });
    assert.ok(lean.findings.some((f) => f.kind === 'edit_under_negative_requirement'), 'published in m33-lean');
    const seen = [];
    const report = await runReview({ session: n.session, pr: null, reviewScope: 'session-only',
      judge: judgeOf(answer([edit(n)]), seen) });
    const finding = report.findings.find((f) => f.kind === 'edit_under_negative_requirement');
    assert.ok(finding, 'published');
    assert.equal(finding.status, 'DECIDE');
    assert.deepEqual(finding.receipts.map((r) => [r.eventId, r.role, r.quote]),
      [[n.file.id, 'project-instructions', RULE], [n.write.id, 'code', DEPENDENCY]]);
    const items = seen.filter((r) => r.challenge).flatMap((r) => r.challenge.items)
      .filter((i) => i.type === 'forbidden-edit');
    assert.deepEqual([...new Set(items.map((i) => i.key))], ['forbiddenEdits:0'], 'one item, asked in each pass');
    assert.ok(items.every((i) => i.candidate.proposition === FORBIDDEN_EDIT_PROPOSITION_FILE), 'on the file form');
    assert.equal(items[0].candidate.instruction.role, 'project-instructions');
    // The page and the report .md show the file's words as the file's.
    const html = renderSessionPage(n.session, report, { sessionHash: 'a'.repeat(64) });
    // D97: the page labels the file's words with the file's name.
    assert.match(html, /The project instruction file [^<]+ says:<\/span> <q class="said">/);
    assert.ok(html.includes('Never add a runtime dependency.'));
    // D97: and the report .md, under the file's name.
    const story = renderReportMarkdown(n.session, report);
    assert.match(story, new RegExp(`The project instruction file [^\\n]+ says: “${RULE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}”`));
  });

test('W1 B: the ledger publishes a file\'s rule only when the main agent was given it before the change', async (t) => {
  const late = await fixture(t, { late: true });
  const candidate = { origin: 'session-review', kind: 'edit_under_negative_requirement', title: 't', explanation: 'e',
    scope: 'session-effect', anchor: null, forbiddenEdit: {},
    receipts: [quote(late.file.id, 'project-instructions', RULE), quote(late.write.id, 'code', DEPENDENCY)] };
  const out = groundFinding({ repo: { host: 'github.com', id: '0' }, session: late.session, pr: null, candidate });
  assert.deepEqual([out.ok, out.reason, out.cause], [false, 'receipt_rejected', 'rule_after_action']);
  const n = await fixture(t);
  const before = groundFinding({ repo: { host: 'github.com', id: '0' }, session: n.session, pr: null,
    candidate: { ...candidate, receipts: [quote(n.file.id, 'project-instructions', RULE),
      quote(n.write.id, 'code', DEPENDENCY)] } });
  assert.equal(before.ok, true);
  // The combined route (no forbidden-edit route fields) still needs a human instruction.
  const { forbiddenEdit: _route, ...combined } = candidate;
  const joint = groundFinding({ repo: { host: 'github.com', id: '0' }, session: n.session, pr: null,
    candidate: { ...combined, receipts: [quote(n.file.id, 'project-instructions', RULE),
      quote(n.write.id, 'action', '/repo/package.json')] } });
  assert.equal(joint.ok, false);
});
