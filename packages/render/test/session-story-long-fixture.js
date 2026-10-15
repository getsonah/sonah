// A long synthetic session and its finished review report, for the session story's readability rules
// (M33 S2, M33 S3), with the shape of a long Codex session: 113 review windows, 11 human asks (M5: the five harness
// context messages Codex records as user messages — the first of them, the plugin list, several sibling elements before
// any human ask — are no instruction event at all: the slicer reads none of them as an ask, by Codex's typed UserMessage
// channel), requirements the review re-proposed in every window in other words, each citing the human's words, about a
// hundred decisions whose authority the review could not check, long read-only stretches, a step that ran five test
// commands and wrote three statements into a file, and a few dozen notable steps. Every string, path and command is
// invented for this fixture.

import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

export const LONG_STEPS = 113;

/** The plugin list Codex injects as ONE user message: several sibling elements, eight closing tags. */
export const LONG_PLUGINS = ['<recommended_plugins>', '  <plugin name="docs">Search the product docs</plugin>',
  '  <plugin name="tracker">Read and file issues</plugin>', '</recommended_plugins>', '<skills>',
  '  <skill name="review">Review a pull request</skill>', '</skills>', '<apps>', '  <app name="browser">Open a page</app>',
  '</apps>', '<collaboration_mode>pair</collaboration_mode>'].join('\n');

/** Context the harness injects as user messages: each is whole elements. M5: no UserMessage item names any of them, so
 *  the slicer reads none of them as an ask and the session holds no event for them; kept to check the story never
 *  shows their words. */
export const LONG_HARNESS = Object.freeze([
  { id: 'X-plugins', step: 1, text: LONG_PLUGINS },
  { id: 'X-env-1', step: 1, text: '<environment_context>\n  <cwd>/workspace/app</cwd>\n  <shell>zsh</shell>\n</environment_context>' },
  { id: 'X-rules', step: 1, text: '<user_instructions>\nFollow the repository rules in AGENTS.md before any change.\n</user_instructions>' },
  { id: 'X-env-2', step: 30, text: '  <environment_context>\n  <cwd>/workspace/app</cwd>\n</environment_context>\n' },
  { id: 'X-perm', step: 55, text: '<permissions instructions>\nNetwork access is restricted.\n</permissions>' },
]);

/** A requirement: the review's words for it, the status the last window that proposed it gave, and the human's
 *  words it cites (a span of its ask's text, overlapping no other requirement's, except in Q11: a review often cites
 *  the whole of a one-sentence ask for each of its requirements, and only its own words then tell them apart). */
const R = (text, final, quote) => Object.freeze({ text, final, quote });
/** The words both requirements of Q11 cite. */
export const LONG_SHARED_QUOTE = 'Check the whole story stays under seventy kilobytes, then commit';

/** The human asks, the step each starts in, and the distinct requirements the review tracked for each. Q5 starts
 *  and ends with a tag but is not only elements: it is a human ask. */
export const LONG_ASKS = Object.freeze([
  { id: 'Q1', step: 1, text: 'Repair the session evidence so every review window sees the whole instruction history. '
      + 'Receipts must still ground against the recording, redaction must still run before hashing, child sessions keep '
      + 'their own history, add no new runtime dependency, old reports must still load and window splits must stay '
      + 'deterministic. Gaps are declared, never dropped; tests must cover the repaired history; document the fix in the '
      + 'handoff. The evidence digest must stay stable.',
    requirements: [R('Every window sees the whole instruction history', 'addressed', 'every review window sees the whole instruction history'),
      R('Receipts still ground against the recording', 'addressed', 'Receipts must still ground against the recording'),
      R('Redaction still runs before hashing', 'addressed', 'redaction must still run before hashing'),
      R('Child sessions keep their own history', 'partly-addressed', 'child sessions keep their own history'),
      R('No new runtime dependency', 'addressed', 'add no new runtime dependency'),
      R('Old reports still load', 'addressed', 'old reports must still load'),
      R('Window splits stay deterministic', 'addressed', 'window splits must stay deterministic'),
      R('Gaps are declared, never dropped', 'open', 'Gaps are declared, never dropped'),
      R('Tests cover the repaired history', 'addressed', 'tests must cover the repaired history'),
      R('The fix is documented in the handoff', 'open', 'document the fix in the handoff')] },
  { id: 'Q2', step: 8, text: 'Make the review report say which window proposed each requirement. Window numbers must match the '
      + 'step numbers, and bump the report schema version.',
    requirements: [R('Each requirement names its window', 'addressed', 'say which window proposed each requirement'),
      R('Window numbers match the step numbers', 'addressed', 'Window numbers must match the step numbers'),
      R('The report schema version is bumped', 'addressed', 'bump the report schema version')] },
  { id: 'Q3', step: 20, text: 'Deduplicate the requirements a long review repeats in every window. Keep one row per distinct '
      + 'requirement. Letter case must not make a new requirement, nor punctuation, nor spacing. The last window decides the '
      + 'status, and each row says where it was worked on. Show at most eight rows per request, fold the rest into a details '
      + 'block, and make the counts cell count requests, not rows.',
    requirements: [R('One row per distinct requirement', 'addressed', 'Keep one row per distinct requirement'),
      R('Case does not make a new requirement', 'addressed', 'Letter case must not make a new requirement'),
      R('Punctuation does not make a new requirement', 'addressed', 'nor punctuation'),
      R('Spacing does not make a new requirement', 'addressed', 'nor spacing'),
      R('The last window decides the status', 'addressed', 'The last window decides the status'),
      R('Each row says where it was worked on', 'partly-addressed', 'each row says where it was worked on'),
      R('At most eight rows are visible per request', 'addressed', 'Show at most eight rows per request'),
      R('The rest fold into a details block', 'addressed', 'fold the rest into a details block'),
      R('The counts cell counts requests, not rows', 'open', 'make the counts cell count requests, not rows')] },
  { id: 'Q4', step: 31, text: 'Show decisions for leads only when the review is sure nobody asked. Keep cosmetic decisions out '
      + 'of the table and count the rest in a details block.',
    requirements: [R('Only decisions nobody asked about are counted', 'addressed', 'Show decisions for leads only when the review is sure nobody asked'),
      R('Cosmetic decisions stay out of the table', 'addressed', 'Keep cosmetic decisions out of the table'),
      R('The rest are counted in a details block', 'addressed', 'count the rest in a details block')] },
  { id: 'Q5', step: 42, text: '<code>npm test</code> fails on main; make it pass without skipping tests, then rerun <code>npm test</code>',
    requirements: [R('The suite passes on main', 'open', 'fails on main; make it pass'),
      R('No test is skipped', 'addressed', 'without skipping tests')] },
  { id: 'Q6', step: 55, text: 'Fold the quiet steps of the engineer section into one line each. Notable steps keep their block, '
      + 'and every step keeps its anchor.',
    requirements: [R('Quiet steps fold into one line', 'addressed', 'Fold the quiet steps of the engineer section into one line each'),
      R('Notable steps keep their block', 'addressed', 'Notable steps keep their block'),
      R('Every step keeps its anchor', 'addressed', 'every step keeps its anchor')] },
  { id: 'Q7', step: 63, text: 'Keep the chart under sixty nodes for a long session, and say how it was simplified.',
    requirements: [R('The chart has at most sixty nodes', 'addressed', 'Keep the chart under sixty nodes'),
      R('The simplification is stated', 'addressed', 'say how it was simplified')] },
  { id: 'Q8', step: 74, text: 'Name what each step did instead of counting its commands. Fall back to a command count only when '
      + 'nothing else applies.',
    requirements: [R('Titles name reads, tests, commits and scripts', 'addressed', 'Name what each step did instead of counting its commands'),
      R('Ran N commands only when nothing else applies', 'partly-addressed', 'Fall back to a command count only when nothing else applies')] },
  { id: 'Q9', step: 86, text: 'Hide the harness context messages from the story, but count them in the meta line.',
    requirements: [R('Context messages never become asks', 'addressed', 'Hide the harness context messages from the story'),
      R('The meta line counts them', 'addressed', 'count them in the meta line')] },
  { id: 'Q10', step: 97, text: 'Use plain words for every status the story shows, materiality included.',
    requirements: [R('No closed token reaches a reader', 'addressed', 'Use plain words for every status the story shows'),
      R('Materiality reads in plain words', 'open', 'materiality included')] },
  { id: 'Q11', step: 105, text: 'Check the whole story stays under seventy kilobytes, then commit.',
    requirements: [R('The story stays under seventy kilobytes', 'addressed', LONG_SHARED_QUOTE),
      R('The work is committed', 'open', LONG_SHARED_QUOTE)] },
]);

/** One requirement of Q1 whose rewordings were proposed on a schedule: the variant first seen later was
 *  last proposed EARLIER, so the status of the last window differs from that of the last report row. A
 *  proposal whose instruction quote does not ground (step 6) is not counted. */
export const LONG_SCHEDULED = Object.freeze({
  ask: 'Q1', text: 'The evidence digest stays stable', quote: 'The evidence digest must stay stable', status: 'addressed', steps: [1, 5],
  proposals: Object.freeze([[1, 'The evidence digest stays stable', 'open'], [2, 'the evidence digest stays stable', 'open'],
    [3, 'the evidence digest stays stable', 'partly-addressed'], [5, 'The evidence digest stays stable', 'addressed'],
    [6, 'The evidence digest stays stable', 'open', 'a quote the ask never said']]),
});

/** An edit step that ran four test commands besides the one every edit step runs (one of them failed) and wrote
 *  three statements into a file outside the repository (one a recorded result contradicts). */
export const BUSY_STEP = Object.freeze({ step: 110, tests: Object.freeze([['npm test', 'succeeded'],
  ['node --test packages/render/test/session-story.test.js', 'succeeded'], ['npm run test:unit', 'failed'],
  ['npx vitest run', 'succeeded']]), written: Object.freeze([['The story stays under seventy kilobytes', 'unverified'],
  ['Every request keeps its heading', 'unverified'], ['All tests pass', 'contradicted']]) });

export const EDIT_STEPS = Object.freeze([2, 3, 9, 10, 14, 21, 22, 27, 32, 36, 43, 44, 50, 56, 64, 65, 70, 75, 80, 87, 88, 98,
  99, 106, 110]);
export const PIVOT_STEPS = Object.freeze([3, 10, 15, 22, 28, 36, 44, 51, 58, 65, 71, 80, 88, 93, 99, 106, 111]);
const DOUBLE_PIVOTS = Object.freeze([10, 44, 99]);
/** Helpers spawned, by step. */
export const HELPER_STEPS = Object.freeze({ 12: 2, 33: 1, 57: 2, 76: 1, 90: 2, 107: 1 });
export const FINDING_STEPS = Object.freeze({ 22: 'FYI', 65: 'FYI', 113: 'DECIDE' });
/** Decisions the review derived a column for: thirteen made without asking (ten changing behaviour or structure,
 *  three cosmetic — a lead is shown all thirteen, M33 brittleness H4), and four you were asked about. */
export const CONFIDENT_DECISIONS = Object.freeze([
  ...[2, 9, 21, 43, 64, 98].map((step) => ({ step, column: 'unasked', materiality: 'material' })),
  ...[14, 32, 75, 106].map((step) => ({ step, column: 'unasked', materiality: 'structural' })),
  ...[27, 50, 87].map((step) => ({ step, column: 'unasked', materiality: 'cosmetic' })),
  ...[3, 44].map((step) => ({ step, column: 'asked-settled', materiality: 'structural' })),
  ...[10, 70].map((step) => ({ step, column: 'asked-chose', materiality: 'material' })),
]);
export const UNCHECKED_DECISIONS = 100;
const MATERIALITY = Object.freeze(['material', 'structural', 'cosmetic']);
const uncheckedStep = (k) => 1 + ((k * 37) % LONG_STEPS);

const EDIT_PATHS = Object.freeze(['packages/evidence/src/windows.js', 'packages/evidence/src/ledger.js',
  'packages/evidence/src/run-review.js', 'packages/render/session-story.js']);
export const editPath = (step) => EDIT_PATHS[step % EDIT_PATHS.length];
export const testPath = (step) => `packages/evidence/test/window-split-${step % 7}.test.js`;
/** The commands a read-only stretch runs: reads and searches over the repository, in this order. */
const READS = (s) => [
  `sed -n '1,160p' packages/evidence/src/part-${s % 9}.js`,
  'rg -n "windowResults" packages/evidence/src',
  `nl -ba packages/evidence/test/part-${s % 5}.test.js | sed -n '40,120p'`,
  'cat packages/render/session-story.js',
  'git status --short',
  'ls packages/evidence/src',
  'git diff --stat',
  'wc -l packages/evidence/src/ledger.js packages/evidence/src/session.js',
  'rg -n "columnState" packages/evidence/src/ledger.js',
  'head -n 40 packages/evidence/src/windows.js',
  'git log --oneline -5',
  "find packages/evidence -name '*.test.js'",
  'grep -rn "materiality" packages/evidence/src/materiality.js',
  "sed -n '200,260p' packages/evidence/src/run-review.js",
  'tail -n 30 packages/evidence/src/prompt.js',
];
/** Commands some steps run besides their reads. */
export const SPECIAL_COMMANDS = Object.freeze({
  5: ['node scripts/session-review.mjs --report out/report.json'],
  6: ['node scripts/session-review.mjs --dry-run', 'node scripts/session-story.mjs --out out/story.md'],
  10: ['git add -A && git commit -m "Repair the window history"'],
  17: ["jq '.windowResults | length' out/report.json"],
  25: ['npm install'],
  44: ['git merge --no-ff topic/requirements'],
  45: ['node scripts/probe.mjs', 'python3 tools/check.py', 'bash scripts/run.sh', 'npx prettier --check .'],
  60: ['git worktree add ../wt-chart -b chart'],
  111: ['git add -A && git commit -m "Keep the story short"'],
});

const bodyOf = (step, version) => Array.from({ length: 14 }, (_, i) =>
  (i === 3 ? `  const limit${step} = ${version === 'after' ? 60 : 120}; // the window bound for step ${step}`
    : i === 5 ? `  const carried${step} = history.slice(${version === 'after' ? 0 : 1}); // the instructions carried in`
      : `  // line ${i} of the window helper that splits the recorded session`)).join('\n');

/** The session, and the ids of the events each window (step) holds. */
export function longSession() {
  const b = sessionBuilder();
  const windows = [];
  const askAt = new Map(LONG_ASKS.map((ask) => [ask.step, ask]));
  for (let s = 1; s <= LONG_STEPS; s++) {
    const before = b.events.length;
    if (askAt.has(s)) b.ask(askAt.get(s).id, askAt.get(s).text);
    const quiet = !EDIT_STEPS.includes(s) && !PIVOT_STEPS.includes(s) && !HELPER_STEPS[s] && !FINDING_STEPS[s];
    const reads = READS(s).slice(0, quiet ? 11 + (s % 5) : 4);
    reads.forEach((command, i) => b.run(`R${s}-${i}`, command, 'succeeded', 'ok'));
    (SPECIAL_COMMANDS[s] ?? []).forEach((command, i) => b.run(`X${s}-${i}`, command, 'succeeded', 'ok'));
    if (quiet && s % 3 === 0) b.run(`T${s}`, `node --test --test-concurrency=1 ${testPath(s)}`, s % 12 === 0 ? 'failed' : 'succeeded',
      s % 12 === 0 ? 'fail 1' : 'fail 0');
    if (EDIT_STEPS.includes(s)) {
      b.change(`E${s}`, editPath(s), { operation: 'edit', before: bodyOf(s, 'before'), after: bodyOf(s, 'after'),
        priorState: 'edit-text' });
      b.change(`E${s}b`, testPath(s), { operation: 'edit', before: bodyOf(s + 1, 'before'), after: bodyOf(s + 1, 'after'),
        priorState: 'edit-text' });
      b.run(`T${s}`, `node --test --test-concurrency=1 ${testPath(s)}`, 'succeeded', 'fail 0');
    }
    if (s === BUSY_STEP.step) {
      BUSY_STEP.tests.forEach(([command, result], i) => b.run(`B${s}-${i}`, command, result, result === 'failed' ? 'fail 1' : 'fail 0'));
      b.change(`O${s}`, '/tmp/pr-body.md', { after: `${BUSY_STEP.written.map(([text]) => `${text}.`).join('\n')}\n`, outside: true });
    }
    if (PIVOT_STEPS.includes(s)) {
      for (let j = 1; j <= (DOUBLE_PIVOTS.includes(s) ? 2 : 1); j++)
        b.say(`P${s}-${j}`, `Switching from approach ${s}.${j} to plan ${s}.${j}: the first one broke the window split.`);
    }
    for (let h = 1; h <= (HELPER_STEPS[s] ?? 0); h++) {
      const childId = `h${s}x${h}`;
      b.delegate(`D${s}-${h}`, `Write tests for the fold rule, part ${s}.${h}`, childId);
      b.ask(`child:${childId}:I0`, `Write tests for the fold rule, part ${s}.${h}`, 'agent', childId);
      b.change(`child:${childId}:W`, `packages/render/test/fold-${s}-${h}.test.js`, { after: `test ${s}.${h}\n`, childId });
    }
    if (FINDING_STEPS[s] === 'FYI') b.say(`F${s}`, `I widened the window bound for step ${s} to make the split fit.`);
    if (s === 50) b.say('W50', 'I will document the fold rule in the handoff next.');
    if (s === LONG_STEPS) {
      b.run('T-last', 'npm test', 'failed', 'tests 40\npass 38\nfail 2');
      b.say('F-last', 'All checks pass and the story renders.', 'final');
    }
    windows.push(b.events.slice(before).map((event) => event.id));
  }
  return { session: b.session('codex'), windows };
}

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
/** The span a window's proposal cites: the requirement's own words, or those words less their first or their last
 *  word (always at least half of them), so the quotes of one requirement differ from window to window. */
const quoteIn = (quote, s) => {
  const words = quote.split(' ');
  const cut = s % 3 === 1 ? words.slice(1).join(' ') : s % 3 === 2 ? words.slice(0, -1).join(' ') : quote;
  return cut.length >= 10 && 2 * cut.length >= quote.length ? cut : quote;
};
const phase = (s, start, end, final) => {
  const p = (s - start) / Math.max(1, end - start);
  if (p < 1 / 3) return 'open';
  if (p < 2 / 3) return final === 'open' ? 'open' : 'partly-addressed';
  return final;
};
const lower = (text) => text[0].toLowerCase() + text.slice(1);
/** A window's words for a requirement: the review rewords it every time, so that text alone cannot merge them. */
const variants = (text) => [text, `Make sure that ${lower(text)}`, `${text}, as asked`, `The request wants: ${lower(text)}`];

/** Each window's surviving narrative requirements: every requirement of the ask in force is proposed
 *  again in every window, in other words, citing a slightly different span of the same human words. */
function narratives() {
  const byStep = new Map();
  const add = (s, row) => { if (!byStep.has(s)) byStep.set(s, []); byStep.get(s).push(row); };
  LONG_ASKS.forEach((ask, a) => {
    const end = a + 1 < LONG_ASKS.length ? LONG_ASKS[a + 1].step - 1 : LONG_STEPS;
    for (let s = ask.step; s <= end; s++)
      for (const r of ask.requirements)
        add(s, { text: variants(r.text)[s % 4], instruction: receipt('instruction', ask.id, quoteIn(r.quote, s)),
          status: phase(s, ask.step, end, r.final) });
  });
  const q1 = LONG_ASKS.find((ask) => ask.id === LONG_SCHEDULED.ask);
  for (const [s, text, status, quote] of LONG_SCHEDULED.proposals)
    add(s, { text, instruction: receipt('instruction', q1.id, quote ?? quoteIn(LONG_SCHEDULED.quote, s)), status });
  // A requirement proposed from a harness message (no instruction event, M5): never grounded, never a human request.
  add(1, { text: 'Follow the repository rules', instruction: receipt('instruction', 'X-rules', 'Follow the repository rules'),
    status: 'open' });
  return byStep;
}

/** The finished review report, as report.private.json holds it. Its requirements are merged across
 *  windows the way the review merges them (run-review.js `mergeWindowOutputs`): one row per exact
 *  instruction and text, kept where first seen, with the newest grounded status. */
export function longReport(session, windows) {
  const proposed = narratives();
  const grounded = (row) => session.event(row.instruction.eventId)?.kind === 'instruction'
    && session.textSpansOf(session.event(row.instruction.eventId), 'text').join('').includes(row.instruction.quote);
  const merged = new Map();
  for (let s = 1; s <= LONG_STEPS; s++)
    for (const row of proposed.get(s) ?? []) if (grounded(row)) merged.set(JSON.stringify([row.instruction.eventId, row.text]), row);
  const firstEvent = (s) => windows[s - 1].find((id) => /^(E|R)\d/.test(id));
  const decision = (i, step, fields) => ({ actorSession: STORY_KEY, dimension: `window rule ${i} for the evidence split`,
    chosen: `keep option ${i % 4} for the carried instruction history`,
    value: null, valueReceipt: null, valueState: 'unchecked', actions: [EDIT_STEPS.includes(step) ? `E${step}` : firstEvent(step)],
    stated: null, constrainedBy: null, instructionReview: null, amends: [], materialityRule: 'synthetic', relevance: 'unchecked',
    reasons: [], id: `sha256:long-d${i}`, ...fields });
  const decisions = [
    ...CONFIDENT_DECISIONS.map((d, i) => decision(i, d.step, { column: d.column, columnState: 'grounded', materiality: d.materiality })),
    ...Array.from({ length: UNCHECKED_DECISIONS }, (_, k) => decision(100 + k, uncheckedStep(k),
      { column: null, columnState: 'unchecked', materiality: MATERIALITY[k % 3], reasons: ['instructions_partial'] })),
  ];
  const pivots = PIVOT_STEPS.flatMap((s) => Array.from({ length: DOUBLE_PIVOTS.includes(s) ? 2 : 1 }, (_, j) => ({
    abandoned: `approach ${s}.${j + 1} for the window split`, adopted: `plan ${s}.${j + 1} that keeps the split`,
    receipts: [receipt('commentary', `P${s}-${j + 1}`, `Switching from approach ${s}.${j + 1}`)] })));
  const findings = [
    ...[22, 65].map((s) => ({ origin: 'session-review', kind: 'code_issue', status: 'FYI',
      title: `The window bound was widened at step ${s} without a test`, explanation: 'Synthetic.', scope: 'session-effect',
      anchor: null, id: `sha256:long-f${s}`, receipts: [receipt('commentary', `F${s}`, 'I widened the window bound')] })),
    { origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
      title: 'The final message says all checks pass; the last test run failed', explanation: 'Synthetic.',
      scope: 'session-effect', anchor: null, id: 'sha256:long-f-last',
      receipts: [receipt('commentary', 'F-last', 'All checks pass'), receipt('observation', 'T-last-r', 'fail 2')] },
  ];
  return {
    repo: { host: 'github.com', id: '0' }, pr: null, reviewScope: 'session-only',
    decisions, findings, pivots,
    requirements: [...merged.values()],
    promises: [{ id: 'sha256:long-p1', stated: receipt('commentary', 'W50', 'I will document the fold rule in the handoff next'),
      text: 'The fold rule will be documented in the handoff', status: 'open',
      receipts: [receipt('commentary', 'W50', 'I will document the fold rule in the handoff next')] }],
    writtenClaims: BUSY_STEP.written.map(([text, label], i) => ({ id: `sha256:long-w${i}`, text, label,
      stated: receipt('code', `O${BUSY_STEP.step}`, text), receipts: [receipt('code', `O${BUSY_STEP.step}`, text)] })),
    windowResults: windows.map((eventIds, windowIndex) => ({ windowIndex, eventIds: [...eventIds],
      narrative: { decisions: [], pivots: [], claims: [], requirements: proposed.get(windowIndex + 1) ?? [] },
      failure: [67, 70].includes(windowIndex) ? 'model_unavailable' : null })),
    sessionStatus: 'DECIDE', reviewStatus: 'DECIDE', coverage: 'partial',
  };
}

/** The steps the story must show as full blocks: a file change, a finding, a decision made without asking
 *  that the review is sure of, a change of approach, or a helper spawned. Every other step is quiet. */
export const NOTABLE_STEPS = Object.freeze([...new Set([...EDIT_STEPS, ...PIVOT_STEPS, ...Object.keys(HELPER_STEPS).map(Number),
  ...Object.keys(FINDING_STEPS).map(Number), ...CONFIDENT_DECISIONS.filter((d) => d.column === 'unasked').map((d) => d.step)])]
  .sort((a, b) => a - b));
