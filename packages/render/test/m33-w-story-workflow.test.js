// M33 W (Claude Code Workflow agents), the session story. A Workflow run is one helper group, named by the run's
// recorded workflowName in plain words (a plain identifier only, else just "workflow"); each agent is shown by the
// brief it received through the existing helper label order, and by what it reported, within the existing clips.
// Synthetic recordings (cli/test/m33-w-workflow-fixture.js); a deterministic fake judge; no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { renderSessionStory, STORY_SENTENCES } from '../session-story.js';
import { loadSessionEvidence } from '../../cli/src/session-evidence.js';
import { redact } from '../../redact/index.js';
import { sessionFromLedger } from '../../evidence/adapters/sonah-ledger.js';
import { runReview } from '../../evidence/src/run-review.js';
import { windowNarrative, fixtureJudge } from '../../cli/test/m33-fast-profile-fixture.js';
import { AGENTS, RUN, SID, SLUG, TEXT, fixerRows, linkedRun, mkdir, parentRows, rm, scratch, testerRows, workflowRows,
  writeTree } from '../../cli/test/m33-w-workflow-fixture.js';

async function story(t, { workflowName = 'fix-parser', run = linkedRun() } = {}) {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const previous = process.env.SONAH_HOME;
  process.env.SONAH_HOME = join(dir, 'home');
  t.after(() => { if (previous === undefined) delete process.env.SONAH_HOME; else process.env.SONAH_HOME = previous; });
  const transcriptDir = join(dir, 'projects', SLUG, SID, 'subagents', 'workflows', RUN);
  const tree = await writeTree(dir, { parent: parentRows({ workflows: [workflowRows({ transcriptDir, workflowName })] }), run });
  await mkdir(join(dir, 'codex'), { recursive: true });
  const ledger = redact(await loadSessionEvidence([tree.parent], { outcomes: new Map(), reviewLinkedChildren: true,
    recordingRoots: { claude: tree.projects, codex: join(dir, 'codex') } })).ledger;
  const session = sessionFromLedger(ledger, { sessionKey: 'm33-w-story' });
  const report = await runReview({ session, pr: null, reviewScope: 'session-only', concurrency: 1,
    judge: fixtureJudge({ narrativeOf: (r) => windowNarrative(session, r.window) }) });
  return renderSessionStory(session, report);
}

test('M33 W a workflow run is one helper group named by its recorded workflowName, each agent by its brief', async (t) => {
  assert.equal(STORY_SENTENCES.workflow, 'workflow');
  const markdown = await story(t);
  assert.match(markdown, /2 helpers: workflow fix parser \(Fix the nested-inpu/, 'one group in the chart, named in plain words');
  assert.equal(markdown.split('workflow fix parser (').length - 1, 2, 'once in the overview, once in the step chart');
  assert.match(markdown, /- Helper \(workflow fix parser\): Fix the nested-input branch in src\/parser\.js/);
  assert.match(markdown, /- Helper \(workflow fix parser\): Run the parser test suite with npm test/);
  assert.match(markdown, /reported: "Ran npm test: 12 passed\."/);
  assert.match(markdown, /2 helper agents/);
});

test('M33 W a workflowName that is not a plain identifier is never shown; the group is just "workflow"', async (t) => {
  for (const workflowName of ['fix parser now', null, '../escape', 'x'.repeat(65)]) {
    const markdown = await story(t, { workflowName });
    assert.match(markdown, /2 helpers: workflow \(Fix the nested/, String(workflowName));
    assert.match(markdown, /- Helper \(workflow\): Fix the nested-input/);
    if (typeof workflowName === 'string') assert.equal(markdown.includes(workflowName), false);
  }
});

test('M33 W the story repeats no brief or report beyond the existing clips', async (t) => {
  const brief = `${TEXT.fixerBrief} ${'Keep every nested-input case covered and explain each change in one line. '.repeat(6)}`;
  const report = { summary: `${'The nested-input branch now maps arrays element by element. '.repeat(6)}Done.` };
  const run = linkedRun({ agents: { [AGENTS.fixer]: fixerRows({ brief }), [AGENTS.tester]: testerRows() },
    journal: [...linkedRun().journal.slice(0, 2), JSON.stringify({ type: 'result', agentId: AGENTS.fixer,
      key: JSON.parse(linkedRun().journal[2]).key, result: report }), linkedRun().journal[3]] });
  const markdown = await story(t, { run });
  assert.equal(markdown.includes(brief.trim()), false);
  assert.equal(markdown.includes(JSON.stringify(report)), false);
  assert.match(markdown, /- Helper \(workflow fix parser\): Fix the nested-input branch in src\/parser\.js so test\/parser\.test\.js p… — reported: /);
});
