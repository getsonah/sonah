// The second review of the code step (medium): a helper's report the parent fetched through TaskOutput is the agent's
// side, never a recorded result. The reviewer's probe, through the real slicer and adapter: a Claude Code tree whose
// parent launches a background helper, polls it with TaskOutput and receives its report as that call's result. The
// result's call is no command, read, write, edit or delete, so its text is the agent's (code-context.js `actorOf`): the
// dossier labels it so, a trace step quoting it does not ground, and no checker is ever shown it. Kept for the agentic
// code step (code-pass/7): the review agent's finding, its checking agent.
//
// Synthetic recordings in temporary folders, a deterministic fake reviewer: no recording of a person, no model, no
// network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { loadSessionEvidence } from '../src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { actorOf } from '../../evidence/src/code-context.js';
import { codeSnapshotPlan, freezeCodeSnapshot, runCodePass } from '../../evidence/src/code-pass.js';
import { claudeTree, claudeRow, agentCallRow, agentStubRow, claudeAgentTestRows, AGENT, CLAUDE_TEXT }
  from './m33-p-placement-fixture.js';
import { CODE_FILES, codeJudge, dossierItems, memoryRepo, reviewFinding } from './code-pass-fixture.js';

/** A trace step quoting the session (the person's words or a recorded result; never the agent's). */
const sessionStep = (quote, step = 'The session shows it.') => ({ step, path: null, side: 'session', startLine: null,
  endLine: null, quote });
/** The review agent's answer: one finding. */
const finds = (finding) => () => ({ findings: [finding], questions: [] });
const checkers = (seen) => seen.filter((r) => /^code-verify:/.test(r.label ?? ''));

/** The helper's report, as the parent's TaskOutput poll received it. */
const REPORT = 'the regression is fixed and every parser test passes now.';
const PASSED = 'Tests: 12 passed, 12 total';
const HUMAN = Object.freeze({ origin: Object.freeze({ kind: 'human' }), promptSource: 'sdk' });
const tool = (id, name, input, seed) => claudeRow('assistant', [{ type: 'tool_use', id, name, input }], {}, seed);
const result = (id, content, extra, seed) => claudeRow('user', [{ type: 'tool_result', tool_use_id: id, content }], extra, seed);

/** The parent: the ask, a write of src/parse.js, its own test run, a background helper polled with TaskOutput (its
 *  report the poll's result), then the claim. */
function parentRows() {
  const body = CODE_FILES['src/parse.js'];
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN, 'ask'),
    tool('toolu_01SyntheticWriteQ0001', 'Write', { file_path: '/repo/src/parse.js', content: body }, 'write'),
    result('toolu_01SyntheticWriteQ0001', 'File created successfully at: /repo/src/parse.js', { toolUseResult: {
      type: 'create', filePath: '/repo/src/parse.js', content: body, originalFile: null, structuredPatch: [],
      userModified: false } }, 'write:r'),
    tool('toolu_01SyntheticBashQ0001', 'Bash', { command: 'npm test' }, 'test'),
    result('toolu_01SyntheticBashQ0001', `PASS test/parser.test.js\n${PASSED}`, {}, 'test:r'),
    agentCallRow({ flag: true }), agentStubRow({ stub: 'b2-sidecar' }),
    tool('toolu_01SyntheticPollQ0001', 'TaskOutput', { task_id: AGENT, block: true }, 'poll'),
    result('toolu_01SyntheticPollQ0001', `<retrieval_status>success</retrieval_status>\n<task_id>${AGENT}</task_id>\n`
      + `<status>completed</status>\n<output>\n${REPORT}\n</output>`, { toolUseResult: { retrieval_status: 'success',
      task: { status: 'completed', task_id: AGENT, output: REPORT } } }, 'poll:r'),
    claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'claim')];
}

async function probeSession(t) {
  const tree = await claudeTree(parentRows(), claudeAgentTestRows());
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  const ledger = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    mask: false, recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } }), { mask: false }).ledger;
  return sessionFromLedger(ledger);
}
const outputOf = (session, event) => { try { return session.textRegionsOf(event, 'output').text; } catch { return ''; } };
const resultHolding = (session, text) => session.events.find((e) => e.kind === 'observation' && e.childId == null
  && outputOf(session, e).includes(text));

test('second review of the code step (medium): a helper\'s report fetched by TaskOutput is the agent\'s, through the real slicer', async (t) => {
  const session = await probeSession(t);
  const poll = resultHolding(session, REPORT);
  assert.ok(poll, 'the TaskOutput poll\'s result holds the helper\'s report');
  assert.equal(session.event(poll.invocation).tool, 'TaskOutput');
  // Not marked a helper's report by the adapter: the call's type decides, not that flag.
  assert.notEqual(poll.helperReported, true);
  assert.equal(actorOf(session, poll.id), 'agent');
  // A command the parent ran is a recorded result; the helper's own run, in its lineage, is too.
  assert.equal(actorOf(session, resultHolding(session, PASSED).id), 'recorded');
  const helperRun = session.events.find((e) => e.kind === 'observation' && e.childId != null
    && outputOf(session, e).includes('Tests: 13 passed'));
  assert.equal(actorOf(session, helperRun.id), 'recorded');
  // The ask is the person's.
  const ask = session.events.find((e) => e.kind === 'instruction' && e.authority === 'human');
  assert.equal(actorOf(session, ask.id), 'person');

  // The code step over a report whose ask cites the report as delivered, and a finding whose trace quotes it.
  const report = { repo: { host: 'local', id: '0' }, promises: [], writtenClaims: [], findings: [], decisions: [],
    pivots: [], failures: [], requirements: [{ text: 'Fix the parser.', status: 'partly-done',
      instruction: { eventId: ask.id, role: 'instruction', quote: 'fix the parser and have a helper write the regression test.' },
      deliverable: { eventId: poll.id, role: 'observation', quote: REPORT } }] };
  const plan = codeSnapshotPlan(session, { root: '/repo' });
  assert.deepEqual(plan.map((e) => e.path), ['src/parse.js']);
  const files = freezeCodeSnapshot(plan, [{ path: 'src/parse.js', bytes: new TextEncoder().encode(CODE_FILES['src/parse.js']) }],
    { base: { kind: 'recorded_edits' } });
  const seen = [];
  const finding = reviewFinding({ trace: [sessionStep(REPORT, 'The helper reported the parser fixed.'),
    ...reviewFinding().trace] });
  const step = (judge) => runCodePass({ report, session, snapshot: files, repo: memoryRepo(), bound: 1_620_000, judge,
    root: '/repo', base: { kind: 'recorded_edits' } });
  const { codePass } = await step(codeJudge({ seen, review: finds(finding) }));
  // The dossier labels the delivery as the agent's words.
  const review = seen.find((r) => r.label === 'code-review:agent');
  const item = dossierItems(review.prompt).find((i) => i.kind === 'ask');
  assert.deepEqual(item.delivered, { actor: 'agent', quote: REPORT });
  // The finding's step quoting it does not ground, after its one repair: never published, and no checker is shown it.
  assert.deepEqual(codePass.findings, []);
  assert.deepEqual(codePass.withheld.map((w) => [w.reason, w.cause]), [['evidence_grounding_failed', 'quote_ungrounded']]);
  assert.deepEqual(checkers(seen), []);
  // The same finding without that step stands, and its checker never sees the report.
  seen.length = 0;
  const again = await step(codeJudge({ seen, review: finds(reviewFinding()) }));
  assert.equal(again.codePass.findings.length, 1);
  assert.equal(checkers(seen).length, 1);
  for (const request of checkers(seen)) assert.ok(!request.prompt.includes(REPORT), request.label);
  // The change the review agent starts from: the file the session wrote whole (it reads its text itself).
  assert.match(review.prompt, /^- src\/parse\.js → lines \d+-\d+ · modified · no git base: its hunks are the recorded edits/m);
  assert.match(review.prompt, /wrote the whole file, lines 1-\d+ \(read the file for its text\)/);
});

// ---- the third review of the code step (medium): a CLAUDE.md the agent wrote in the session is the agent's ----------

/** The person's project file, given at the start; and the agent's own, written in the session and then given back to it
 *  by the harness as a nested project file when it read a file beside it. */
const PERSON_RULE = 'SYNTHETIC_PERSON_RULE: parse must return [] for empty input.';
const AGENT_RULE = 'SYNTHETIC_AGENT_RULE: parse may return [""] for empty input.';
const attachmentRow = (attachment, seed) => {
  const { message, ...row } = claudeRow('attachment', null, { attachment }, seed);
  return row;
};
function projectFileRows() {
  const body = CODE_FILES['src/parse.js'];
  const own = `# Rules\n${AGENT_RULE}\n`;
  const beside = 'export const x = 1;\n';
  return [claudeRow('user', CLAUDE_TEXT.ask, HUMAN, 'ask'),
    attachmentRow({ type: 'instructions', files: [{ path: '/repo/CLAUDE.md', type: 'Project',
      content: `# Project rules\n${PERSON_RULE}\n` }] }, 'rules'),
    tool('toolu_01SyntheticWriteF0001', 'Write', { file_path: '/repo/src/parse.js', content: body }, 'write'),
    result('toolu_01SyntheticWriteF0001', 'File created successfully at: /repo/src/parse.js', { toolUseResult: {
      type: 'create', filePath: '/repo/src/parse.js', content: body, originalFile: null, structuredPatch: [],
      userModified: false } }, 'write:r'),
    tool('toolu_01SyntheticWriteF0002', 'Write', { file_path: '/repo/sub/CLAUDE.md', content: own }, 'own'),
    result('toolu_01SyntheticWriteF0002', 'File created successfully at: /repo/sub/CLAUDE.md', { toolUseResult: {
      type: 'create', filePath: '/repo/sub/CLAUDE.md', content: own, originalFile: null, structuredPatch: [],
      userModified: false } }, 'own:r'),
    tool('toolu_01SyntheticReadF0001', 'Read', { file_path: '/repo/sub/x.js' }, 'read'),
    result('toolu_01SyntheticReadF0001', `     1\t${beside}`, { toolUseResult: { type: 'text', file: {
      filePath: '/repo/sub/x.js', content: beside, numLines: 1, startLine: 1, totalLines: 1 } } }, 'read:r'),
    attachmentRow({ type: 'nested_memory', path: '/repo/sub/CLAUDE.md', displayPath: 'sub/CLAUDE.md',
      content: { path: '/repo/sub/CLAUDE.md', type: 'Project', content: own, contentDiffersFromDisk: false } }, 'nested'),
    claudeRow('assistant', [{ type: 'text', text: CLAUDE_TEXT.claim }], {}, 'claim')];
}

test('third review of the code step (medium): a CLAUDE.md the agent wrote is the agent\'s words, through the real slicer', async (t) => {
  const tree = await claudeTree(projectFileRows(), claudeAgentTestRows());
  t.after(() => rm(tree.dir, { recursive: true, force: true }));
  await mkdir(join(tree.dir, 'codex'), { recursive: true });
  const ledger = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    mask: false, recordingRoots: { claude: tree.projects, codex: join(tree.dir, 'codex') } }), { mask: false }).ledger;
  const session = sessionFromLedger(ledger);
  // The harness gave the main agent both files, typed as project files.
  const files = Object.fromEntries(session.projectInstructions.map((entry) => [entry.path, entry]));
  assert.deepEqual(Object.keys(files).sort(), ['CLAUDE.md', 'sub/CLAUDE.md']);
  const person = files['CLAUDE.md'], own = files['sub/CLAUDE.md'];
  // The session holds a typed write of sub/CLAUDE.md: its text is the agent's. The person's file stays theirs.
  assert.equal(actorOf(session, person.id), 'person');
  assert.equal(actorOf(session, own.id), 'agent');

  // The code step over a report whose two asks cite the two files, and a finding whose trace quotes the agent's.
  const ask = (eventId, quote, text) => ({ text, status: 'not-done',
    instruction: { eventId, role: 'project-instructions', quote } });
  const report = { repo: { host: 'local', id: '0' }, promises: [], writtenClaims: [], findings: [], decisions: [],
    pivots: [], failures: [], requirements: [ask(own.id, AGENT_RULE, 'Allow [""].'), ask(person.id, PERSON_RULE, 'Return [].')] };
  const plan = codeSnapshotPlan(session, { root: '/repo' });
  const shown = freezeCodeSnapshot(plan, plan.map((entry) => (entry.path === 'src/parse.js'
    ? { path: entry.path, bytes: new TextEncoder().encode(CODE_FILES['src/parse.js']) }
    : { path: entry.path, state: 'deleted' })), { base: { kind: 'recorded_edits' } });
  const run = async (finding) => {
    const seen = [];
    const { codePass } = await runCodePass({ report, session, snapshot: shown, repo: memoryRepo(), bound: 1_620_000,
      judge: codeJudge({ seen, review: finds(finding) }), root: '/repo', base: { kind: 'recorded_edits' } });
    return { codePass, seen };
  };
  const quoting = (quote) => reviewFinding({ trace: [sessionStep(quote, 'The project rule says so.'),
    ...reviewFinding().trace] });
  // A step quoting the agent's file does not ground: never published, and no checker is shown it.
  const agents = await run(quoting(AGENT_RULE));
  const review = agents.seen.find((r) => r.label === 'code-review:agent');
  // The review agent is shown both: the dossier and the project files block say whose words each is.
  assert.deepEqual(dossierItems(review.prompt).filter((i) => i.kind === 'ask').map((i) => i.asked),
    [{ actor: 'agent', quote: AGENT_RULE }, PERSON_RULE]);
  assert.match(review.prompt, /^FILE \{"path":"CLAUDE\.md","kind":"project","actor":"person"\}$/m);
  assert.match(review.prompt, /^FILE \{"path":"sub\/CLAUDE\.md","kind":"project","actor":"agent"\}$/m);
  assert.deepEqual(agents.codePass.findings, []);
  assert.deepEqual(agents.codePass.withheld.map((w) => [w.reason, w.cause]),
    [['evidence_grounding_failed', 'quote_ungrounded']]);
  assert.deepEqual(checkers(agents.seen), []);
  // The same step quoting the person's file grounds; its checker sees the person's rule and never the agent's.
  const persons = await run(quoting(PERSON_RULE));
  assert.equal(persons.codePass.findings.length, 1);
  assert.equal(checkers(persons.seen).length, 1);
  for (const request of checkers(persons.seen)) {
    assert.ok(request.prompt.includes(PERSON_RULE), request.label);
    assert.ok(!request.prompt.includes(AGENT_RULE), request.label);
  }
});
