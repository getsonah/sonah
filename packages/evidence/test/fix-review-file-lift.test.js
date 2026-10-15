// The review of the W1-W3 fixes (2026-10-14), its finding on W1 B: Claude Code records a project instruction file
// (CLAUDE.md) after the first prompt of its turn, and W1 B counted the human instructions that may lift the file's rule
// from the file's place, exclusive — so the person's own ask was never among them. The reviewer's probe: the ask "Add
// left-pad as a runtime dependency", then the file "never add a runtime dependency", then the write — read as an edit
// against what the person said with no message offered as lifting it. Now, by order alone, a file's edit is asked with
// every human instruction (and every human choice) recorded from the session's start up to the action
// (forbidden.js SESSION_START), its proposition names them, and the note says so. Whether a message lifts the rule is
// the checker's: here the judge is code that refutes exactly when the item names a human instruction it can cite.
// Every recording here is synthetic (invented rules, paths and code); no model is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import { row, humanAsk, call, result, said, load } from './m33-u-unasked-fixture.js';
import { runReview } from '../src/run-review.js';
import { readForbiddenEdit, humanInstructionsBetween, SESSION_START } from '../src/forbidden.js';
import { FORBIDDEN_EDIT_PROPOSITION_FILE, FORBIDDEN_EDIT_NOTE } from '../src/challenge.js';
import { FORBIDDEN_EDIT_REJECTIONS } from '../src/ledger.js';

const ASK = 'Add left-pad as a runtime dependency.';
const RULE = 'Never add a runtime dependency.';
const RULES = `# Project rules\nKeep functions small.\n${RULE}`;
const PACKAGE = '{"name":"fmt","dependencies":{"left-pad":"1.3.0"}}\n';
const DEPENDENCY = '"left-pad":"1.3.0"';
/** As Claude Code records it: the prompt, the project file attached after it, the write, the closing words. */
const rows = () => [
  humanAsk(ASK),
  row({ type: 'attachment', attachment: { type: 'instructions',
    files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } }),
  call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency.'),
  result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
    content: PACKAGE, structuredPatch: [] }),
  said('Added left-pad as a runtime dependency.'),
].map((r, i) => ({ ...r, uuid: `u-frfl-${i + 1}` }));

async function fixture(t) {
  const { session } = await load(t, rows());
  return { session, ask: session.events.find((e) => e.kind === 'instruction'),
    write: session.events.find((e) => e.kind === 'invocation' && e.operation === 'write'),
    file: session.projectInstructions[0] };
}
const quote = (eventId, role, text) => ({ eventId, role, quote: text });
const edit = (n) => ({ text: 'The project file forbids a new runtime dependency; the agent added left-pad.',
  instruction: quote(n.file.id, 'project-instructions', RULE), violation: quote(n.write.id, 'code', DEPENDENCY) });

test('fix review: the probe — a file attached after the ask, the ask is among the messages that may lift its rule',
  async (t) => {
    const n = await fixture(t);
    // The recorder's order: the ask, then the file's place, then the write.
    assert.ok(n.ask.sequence <= n.file.afterSequence && n.file.afterSequence < n.write.sequence);
    const sourceMap = { [n.file.id]: [{ role: 'project-instructions', text: RULES }],
      [n.write.id]: [{ role: 'code', text: PACKAGE }] };
    const read = readForbiddenEdit(edit(n), { session: n.session, sourceMap });
    assert.ok(read.edit, `withheld ${read.withheld}`);
    assert.deepEqual(read.edit.between, [n.ask.id], 'the person\'s own ask is offered as the lift');
    // Counted from the file's place, as W1 B did, it was not.
    assert.deepEqual(humanInstructionsBetween(n.session, n.file.afterSequence, n.write.sequence).ids, []);
    assert.deepEqual(humanInstructionsBetween(n.session, SESSION_START, n.write.sequence).ids, [n.ask.id]);
  });

test('fix review: the probe publishes no edit against what the person said, in either profile', async (t) => {
  const n = await fixture(t);
  /** The checking judge, in code: a forbidden-edit item that names a human instruction is refuted, citing it (the
   *  person asked for what the action did); any other item is upheld on its own first receipt. */
  const judge = (seen) => async (request) => {
    if (!request.challenge) return { requirements: [], claims: [], decisions: [], pivots: [], forbiddenEdits: [edit(n)] };
    seen.push(...request.challenge.items);
    return { votes: request.challenge.items.map((item) => {
      const lift = item.type === 'forbidden-edit' ? item.candidate.humanInstructionsBetween?.[0] : undefined;
      return lift ? { key: item.key, verdict: 'refuted', explanation: 'The person asked for this dependency.',
        receipts: [quote(lift, 'instruction', ASK)] }
        : { key: item.key, verdict: 'not-refuted', explanation: 'Synthetic.',
          receipts: [item.candidate.instruction ?? item.candidate.statement ?? item.candidate.stated] };
    }) };
  };
  for (const speedProfile of [undefined, 'm33-lean']) {
    const seen = [];
    const report = await runReview({ session: n.session, pr: null, reviewScope: 'session-only', judge: judge(seen),
      ...(speedProfile ? { speedProfile } : {}) });
    const items = seen.filter((item) => item.type === 'forbidden-edit');
    assert.ok(items.length > 0, `${speedProfile ?? 'standard'}: asked`);
    assert.ok(items.every((item) => item.candidate.proposition === FORBIDDEN_EDIT_PROPOSITION_FILE
      && item.candidate.humanInstructionsBetween.length === 1), `${speedProfile ?? 'standard'}: the ask is named`);
    assert.equal(report.findings.filter((f) => f.kind === 'edit_under_negative_requirement').length, 0,
      `${speedProfile ?? 'standard'}: no edit against what the person said`);
    // Refuted by valid votes citing the ask (resolved, not left unsettled by votes that did not ground).
    assert.deepEqual(report.windowResults[0].challenge.rejected.filter((r) => r.type === 'forbidden-edit')
      .map((r) => [r.key, r.resolved, r.reason]), [['forbiddenEdits:0', true, 'kind_rejected']],
    speedProfile ?? 'standard');
  }
});

test('fix review: the file form of the proposition and the note name every message from the session\'s start', () => {
  assert.equal(SESSION_START, -1);
  assert.ok(FORBIDDEN_EDIT_PROPOSITION_FILE.includes('no human instruction recorded before the action, from the '
    + 'session\'s start, asked for it, allowed it or lifted that rule'));
  assert.ok(!FORBIDDEN_EDIT_PROPOSITION_FILE.includes('no later human instruction'));
  assert.ok(FORBIDDEN_EDIT_NOTE.includes('For such a file "humanInstructionsBetween" names every human instruction'
    + ' recorded before the action from the session\'s start, the message the file was given with included'));
});

test('fix review: a human choice recorded before the file\'s place is offered as the lift too (from the session\'s start)',
  async (t) => {
    const PLAN = 'Plan: add left-pad as a runtime dependency of fmt.';
    // The ask, a plan the person approved (a human choice), then the project file, then the write.
    const { session } = await load(t, [
      humanAsk(ASK),
      call('p1', 'ExitPlanMode', { plan: PLAN }),
      result('p1', 'User has approved your plan.', { plan: PLAN, isAgent: false }),
      row({ type: 'attachment', attachment: { type: 'instructions',
        files: [{ path: '/repo/CLAUDE.md', type: 'Project', content: RULES }] } }),
      call('w1', 'Write', { file_path: '/repo/package.json', content: PACKAGE }, 'Adding the dependency.'),
      result('w1', 'File created successfully at: /repo/package.json', { type: 'create', filePath: '/repo/package.json',
        content: PACKAGE, structuredPatch: [] }),
      said('Added left-pad as a runtime dependency.'),
    ].map((r, i) => ({ ...r, uuid: `u-frfl-c-${i + 1}` })));
    const n = { session, ask: session.events.find((e) => e.kind === 'instruction'),
      write: session.events.find((e) => e.kind === 'invocation' && e.operation === 'write'),
      file: session.projectInstructions[0] };
    const plan = session.events.find((e) => e.kind === 'invocation' && e.humanChoice === true);
    const approval = session.events.find((e) => e.kind === 'observation' && e.invocation === plan.id);
    assert.ok(plan.sequence < n.file.afterSequence && n.file.afterSequence < n.write.sequence, 'the choice is before the file');
    const sourceMap = { [n.file.id]: [{ role: 'project-instructions', text: RULES }],
      [n.write.id]: [{ role: 'code', text: PACKAGE }], [plan.id]: [{ role: 'action', text: PLAN }],
      [approval.id]: [{ role: 'observation', text: 'User has approved your plan.' }] };
    const read = readForbiddenEdit(edit(n), { session, sourceMap });
    assert.ok(read.edit, `withheld ${read.withheld}`);
    assert.deepEqual([read.edit.between, read.edit.choices], [[n.ask.id], [plan.id]]);
    // Not shown to the window, that choice could be the lift: the edit is withheld, never asked without it.
    const { [approval.id]: _approval, ...unshown } = sourceMap;
    assert.equal(readForbiddenEdit(edit(n), { session, sourceMap: unshown }).withheld, FORBIDDEN_EDIT_REJECTIONS.at(-1));
    assert.equal(FORBIDDEN_EDIT_REJECTIONS.at(-1), 'history_partial');
  });
