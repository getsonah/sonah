// D80 (owner decision 2026-10-12), the first and fourth answers. (1) D79's "or failed" is narrowed: a write the slicer
// parsed from a command (a heredoc's body, `shellWriteOf`) has no change row only when its command did not run; one
// whose command failed keeps its row, never as done — named apart with its own closed words (its command failed, so
// whether this write happened is not recorded) in the story, on the page and as the write's evidence outcome
// (ledger.js `actionOutcome`, the form `command-failed`). (2) One phrase for a stopped command: a call the recorder
// typed with a stopped denial kind (`interrupted`, `cancelled`: ledger.js STOPPED_DENIALS) reads "stopped before it
// finished" in the story, on the page and in the evidence alike — never failed, never did not run. Typed fields only.
// Every session here is synthetic; every string, path and command is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSessionStory, storyFacts, activityPhrases, STORY_BULLETS, STORY_SENTENCES } from '../session-story.js';
import { renderSessionPage, PAGE_LABELS, PAGE_OUTCOME_WORDS } from '../session-page.js';
import { resultOutcome, actionOutcome, STOPPED_DENIALS, STOPPED_WORDS, RESULT_OUTCOME_WORDS }
  from '../../evidence/src/ledger.js';
import { CHECKLIST_OUTCOME_WORDS } from '../../evidence/src/review.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';
import { checklistSession, checklistReport } from './session-page-checklist-fixture.js';

const text = (b, key, value) => {
  b.blobs[key] = value;
  return value === '' ? [] : [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(value, 'utf8') }];
};
/** A Bash call and its result, as d79-refusals.test.js builds them: Claude Code records a denial as an error result and
 *  types the kind on the result row, which the slicer carries on the call (`recorded.denial`). */
function command(b, id, cmd, { denial = null, result = 'failed', exitCode = null, isError = true } = {}) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
    paths: [], command: text(b, `${id}-cmd`, cmd), input: [], changes: [],
    recorded: { tool: 'Bash', ...(isError ? { isError: true } : {}), ...(denial ? { denial } : {}) } });
  b.events.push({ sequence: b.events.length, id: `${id}-r`, kind: 'observation', invocation: id, callKey: id,
    phase: 'terminal', result, exitCode, terminalStatusProven: true, output: [], sourceOfResult: 'native' });
}
const ends = {
  refused: (b, id, cmd) => command(b, id, cmd, { denial: 'user-rejected' }),
  failed: (b, id, cmd) => command(b, id, cmd, { exitCode: 1 }),
  interrupted: (b, id, cmd) => command(b, id, cmd, { denial: 'interrupted' }),
  cancelled: (b, id, cmd) => command(b, id, cmd, { denial: 'cancelled' }),
};
/** The sibling write the slicer emits beside a `cat > path <<'EOF'` command (`shellWriteOf` names the command). */
function heredoc(b, id, of, path, body) {
  b.events.push({ sequence: b.events.length, id, kind: 'invocation', callKey: id, tool: 'heredoc', operation: 'edit',
    paths: [{ path }], command: [], input: [], shellWriteOf: of, shellWriteStatusEligible: true,
    changes: [{ path, before: [], after: text(b, `${id}-after`, body), diff: [],
      extent: { chars: body.length, lines: body.split('\n').length, truncated: false, cap: null, recorded: true,
        redactedLines: 0, priorState: 'none' } }] });
}
const reportOf = (session, extra = {}) => ({ windowResults: [{ windowIndex: 0,
  eventIds: session.events.map((e) => e.id), failure: null }], sessionStatus: 'NO_FINDINGS', ...extra });
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const unescape = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');
const textOf = (html) => unescape(html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<\/?code>/g, '')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([.,;:])/g, '$1');

const FAILED_WORDS = 'its command failed, so whether this write happened is not recorded';
const STOPPED_WRITE_WORDS = 'its command stopped before it finished, so whether this write happened is not recorded';

/** One heredoc write of `src/a.js` by a command that ended as `end`, beside one plain Write of `NOTES.md`. */
function heredocBy(end) {
  const b = sessionBuilder();
  b.ask('I1', 'Write the module and run its checks.');
  b.change('W0', 'NOTES.md', { after: 'Writing the module.\n' });
  ends[end](b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF\nnpm test");
  heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\n');
  return b.session();
}

test('D80 the words: one phrase for a stopped call, and one for a write its failed or stopped command may not have '
  + 'made', () => {
    assert.equal(STOPPED_WORDS, 'stopped before it finished');
    assert.deepEqual([...STOPPED_DENIALS], ['interrupted', 'cancelled']);
    assert.equal(STORY_SENTENCES.stopped, STOPPED_WORDS);
    assert.equal(PAGE_LABELS.stopped, STOPPED_WORDS);
    assert.equal(STORY_BULLETS.stopped, 'Stopped before it finished');
    const words = RESULT_OUTCOME_WORDS['no-terminal-status'];
    assert.equal(words.interrupted, `no terminal status recorded (${STOPPED_WORDS})`);
    assert.equal(CHECKLIST_OUTCOME_WORDS['no-terminal-status'](null, 'interrupted'), 'It stopped before it finished.');
    assert.equal(STORY_SENTENCES.unconfirmedWrite('failed'), FAILED_WORDS);
    assert.equal(STORY_SENTENCES.unconfirmedWrite('stopped'), STOPPED_WRITE_WORDS);
    assert.equal(words['command-failed'], `no terminal status recorded (${FAILED_WORDS})`);
    assert.equal(words['command-stopped'], `no terminal status recorded (${STOPPED_WRITE_WORDS})`);
    assert.equal(PAGE_OUTCOME_WORDS['no-terminal-status'](null, 'command-failed'),
      'Its command failed, so whether this write happened is not recorded.');
    assert.equal(PAGE_OUTCOME_WORDS['no-terminal-status'](null, 'command-stopped'),
      'Its command stopped before it finished, so whether this write happened is not recorded.');
  });

test('D80 story: a heredoc whose command failed keeps its row, named apart with its own words, never as done', () => {
  const session = heredocBy('failed');
  const facts = storyFacts(session, reportOf(session));
  // Its row is kept, marked; it is none of the changed files (no title verb, no file list, no "files changed").
  assert.deepEqual(facts.whole.unconfirmed.map((row) => [row.event.id, row.path, row.unconfirmed, row.counts.added]),
    [['H1-w1', 'src/a.js', 'failed', 1]]);
  assert.deepEqual(facts.whole.files.map((file) => file.path), ['NOTES.md']);
  assert.deepEqual(activityPhrases(facts.whole).map((p) => p.key), ['edit', 'failed']);
  const story = renderSessionStory(session, reportOf(session));
  assert.match(story, /Step 1 — Wrote 1 file · 1 command failed\n/);
  assert.ok(story.includes(`\n- ${STORY_BULLETS.unconfirmedWrite}: \`src/a.js\` +1 −? — ${FAILED_WORDS}\n`), story);
  assert.match(story, /\nFiles: `NOTES\.md` \+1 −0\n/);
  assert.match(story, / · 1 file changed \(\+1 −0\)/);
  // The engineer section's legend covers the `?` its row shows.
  assert.ok(story.includes(STORY_SENTENCES.countLegend));
});

test('D80 story: a heredoc of a refused command still has no row and no bullet', () => {
  const session = heredocBy('refused');
  const facts = storyFacts(session, reportOf(session));
  assert.deepEqual([facts.whole.unconfirmed.length, facts.whole.changes.map((row) => row.event.id)], [0, ['W0']]);
  const story = renderSessionStory(session, reportOf(session));
  assert.match(story, /Step 1 — Wrote 1 file · 1 command did not run\n/);
  assert.equal(story.includes(STORY_BULLETS.unconfirmedWrite), false);
  assert.equal(story.includes('src/a.js` +'), false);
  const page = textOf(renderSessionPage(session, reportOf(session)));
  assert.equal(page.includes(PAGE_LABELS.unconfirmedWrites), false);
});

test('D80 page: the failed command\'s write is listed apart from the changed files, and an edit a row shows from it '
  + 'says so', () => {
  const session = heredocBy('failed');
  const plain = textOf(renderSessionPage(session, reportOf(session)));
  const at = (t, label) => t.slice(t.indexOf(label), t.indexOf(label) + 300);
  assert.ok(plain.includes(`${PAGE_LABELS.files} 1 file NOTES.md +1 −0 step 1 ${PAGE_LABELS.unconfirmedWrites} `
    + `src/a.js +1 −? ${FAILED_WORDS} step 1`), at(plain, PAGE_LABELS.files));
  // A finding citing the write shows its edit with the same words, never as a plain edit.
  const finding = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
    title: 'The module was not written', receipts: [receipt('action', 'H1-w1', 'src/a.js')] };
  const html = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI', findings: [finding] }));
  assert.match(html, new RegExp(`${PAGE_LABELS.editCited} <code>src/a\\.js</code> <span class="mono">\\+1 −\\?</span> `
    + `<span class="flagchip">${FAILED_WORDS}</span></summary>`));
  // The check a row rests on reads the write's own evidence words.
  const row = { text: 'Write the module', instruction: receipt('instruction', 'I1', 'Write the module'),
    status: 'not-checked', reason: 'deliverable_ungrounded', restsOn: ['H1-w1'] };
  const narrative = { requirements: [{ text: row.text, instruction: row.instruction, status: row.status }] };
  const rests = textOf(renderSessionPage(session, reportOf(session, { reviewScope: 'session-only', requirements: [row],
    windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null, narrative }] })));
  assert.ok(rests.includes(`${PAGE_LABELS.restsOn} Tool heredoc Its command failed, so whether this write happened is `
    + 'not recorded. step 1'), at(rests, PAGE_LABELS.restsOn));
  assert.deepEqual(actionOutcome(session, session.event('H1-w1')).form, 'command-failed');
});

test('D80 an interrupted and a cancelled denial read the same, stopped before it finished, in story, page and '
  + 'evidence', () => {
    const read = (kind) => {
      const session = heredocBy(kind);
      const facts = storyFacts(session, reportOf(session));
      const c = facts.whole.commands.find((x) => x.event.id === 'H1');
      const story = renderSessionStory(session, reportOf(session));
      const page = renderSessionPage(session, reportOf(session));
      const t = textOf(page);
      const result = session.event('H1-r');
      return {
        story: [c.failed, c.didNotRun, c.stopped, activityPhrases(facts.whole).map((p) => [p.key, p.text, p.alarm]),
          story.match(/Step 1 — [^\n]*\n/)?.[0],
          story.includes(`\n- ${STORY_BULLETS.stopped}: \`cat > src/a.js <<'EOF' export const a = 1; EOF npm test\`\n`),
          story.includes(`\n- ${STORY_BULLETS.unconfirmedWrite}: \`src/a.js\` +1 −? — ${STOPPED_WRITE_WORDS}\n`),
          story.includes(`${STORY_BULLETS.failed}:`)],
        page: [t.includes(`${PAGE_LABELS.failedStopped} 1 of 1 command stopped before it finished; 1 is cited by no `
          + 'row'),
          /<span class="flagchip">stopped before it finished<\/span>/.test(page),
          t.includes(`Wrote 1 file · 1 command stopped before it finished`),
          t.includes(`src/a.js +1 −? ${STOPPED_WRITE_WORDS}`), /failed, exit|flagchip">failed</.test(page)],
        evidence: [resultOutcome(session, result), actionOutcome(session, session.event('H1-w1')).form,
          PAGE_OUTCOME_WORDS[resultOutcome(session, result).class](null, resultOutcome(session, result).form)],
      };
    };
    const interrupted = read('interrupted');
    assert.deepEqual(read('cancelled'), interrupted);
    assert.deepEqual(interrupted.story.slice(0, 4), [false, false, true, [['edit', 'wrote 1 file', false],
      ['stopped', '1 command stopped before it finished', false]]]);
    assert.equal(interrupted.story[4], 'Step 1 — Wrote 1 file · 1 command stopped before it finished\n');
    assert.deepEqual(interrupted.story.slice(5), [true, true, false]);
    assert.deepEqual(interrupted.page, [true, true, true, true, false]);
    assert.deepEqual(interrupted.evidence, [{ class: 'no-terminal-status', form: 'interrupted',
      words: 'no terminal status recorded (stopped before it finished)' }, 'command-stopped',
    'It stopped before it finished.']);
  });

test('D80 page: the commands part counts failed, refused and stopped commands apart, and folds them as commands',
  () => {
    const b = sessionBuilder();
    b.ask('I1', 'Set things up and run the checks.');
    // One written note, so the step is a full step with bullets, not a quiet one folded into a line.
    b.change('W0', 'NOTES.md', { after: 'Setting up.\n' });
    ends.failed(b, 'R1', 'npm test');
    ends.refused(b, 'R2', 'rm -rf build');
    ends.interrupted(b, 'R3', 'npm run watch');
    ends.cancelled(b, 'R4', 'npm run long');
    const s = b.session();
    const html = renderSessionPage(s, reportOf(s));
    const t = textOf(html);
    assert.ok(t.includes(`${PAGE_LABELS.failedStopped} 1 of 4 commands failed, 1 did not run (refused before it ran), `
      + 'and 2 stopped before they finished; 4 are cited by no row on this page, in step 1. '
      + `${PAGE_LABELS.flaggedList(4)}`), t.slice(t.indexOf(PAGE_LABELS.failedStopped)));
    assert.match(t, /Wrote 1 file · 1 command failed · 1 command did not run/, 'a title keeps three phrases');
    // Cited by a row: beside it under its own label.
    const finding = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', title: 'The watcher ran',
      receipts: [receipt('action', 'R3', 'npm run watch')] };
    const cited = renderSessionPage(s, reportOf(s, { sessionStatus: 'FYI', findings: [finding] }));
    assert.match(cited, new RegExp(`${PAGE_LABELS.stoppedCited}</span> <code>npm run watch</code> `
      + '<span class="flagchip">stopped before it finished</span>'));
    // The story names each kind apart, kept past the bullet cap.
    const story = renderSessionStory(s, reportOf(s));
    assert.match(story,
      /\n- Failed: `npm test` \(exit 1\)\n- Did not run: `rm -rf build`\n- Stopped before it finished: 2 commands\n/);
    assert.ok(story.includes(`<summary>${STORY_SENTENCES.stoppedSummary}</summary>\n\n- \`npm run watch\`\n`
      + '- `npm run long`'));
  });

test('D80 page: a decision citing a failed command\'s write shows it with its words, never among the files changed',
  () => {
    const session = heredocBy('failed');
    const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'module layout', chosen: 'one module',
      value: null, valueReceipt: null, valueState: 'unchecked', actions: ['W0', 'H1-w1'], stated: null,
      constrainedBy: null, instructionReview: null, column: 'asked-chose', columnState: 'grounded', amends: [],
      materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [], ...fields });
    const html = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI',
      decisions: [decided({}), decided({ dimension: 'file order', columnState: 'unchecked' })] }));
    const item = (title) => {
      const at = html.indexOf(`<h4 class="title">${title}</h4>`);
      assert.ok(at >= 0, `premise: the row ${title} is shown`);
      return textOf(html.slice(html.lastIndexOf('<li class="finding', at), html.indexOf('</li>', at)));
    };
    // A decision of how previews each edit: the write its command may not have made carries its words, under the
    // neutral label a cited edit has (review of D80 N), never "The edit it was made in".
    assert.ok(item('Module layout').includes(`${PAGE_LABELS.editMade} NOTES.md +1 −0 +Writing the module. `
      + `${PAGE_LABELS.editCited} src/a.js +1 −? ${FAILED_WORDS} +export const a = 1;`), item('Module layout'));
    // Any other decision names the files its actions changed, and that write apart, with its words.
    assert.ok(item('File order').includes(`${PAGE_LABELS.changedFiles} NOTES.md ${PAGE_LABELS.unconfirmedWrites} `
      + `src/a.js ${FAILED_WORDS}`), item('File order'));
  });

test('D80 page: a failure row of a stopped call reads stopped before it finished, read again from the recording',
  () => {
    // The checklist fixture's refused call (`X2`, a failure row the report keeps as did-not-run), typed as stopped
    // instead.
    for (const kind of STOPPED_DENIALS) {
      const session = checklistSession();
      session.event('X2').recorded.denial = kind;
      const html = renderSessionPage(session, checklistReport());
      const at = html.indexOf('id="failure-3"');
      const item = textOf(html.slice(at, html.indexOf('</div></li>', at)));
      assert.ok(item.includes('It stopped before it finished.'), item);
      assert.equal(item.includes(PAGE_OUTCOME_WORDS['did-not-run']()), false, kind);
    }
  });

// ---- the review of D80 N --------------------------------------------------------------------------------------------

/** A write W0 (`NOTES.md`), a write W2 (`src/b.js`) and a heredoc H1-w1 (`src/a.js`) whose command exited 1. */
function moreEditsSession() {
  const b = sessionBuilder();
  b.ask('I1', 'Write the module and run its checks.');
  b.change('W0', 'NOTES.md', { after: 'Writing the module.\n' });
  b.change('W2', 'src/b.js', { after: 'export const b = 2;\n' });
  ends.failed(b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF\nnpm test");
  heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\n');
  return b.session();
}
/** The text of one shown row, found by the start of its element. */
const rowText = (html, start) => {
  const at = html.indexOf(start);
  assert.ok(at >= 0, `premise: ${start} is shown`);
  return textOf(html.slice(at, html.indexOf('</div></li>', at)));
};

test('D80 (review of N) page: a row that shows one edit never counts a write its failed command may not have made '
  + 'among its more edits', () => {
  const session = moreEditsSession();
  const MORE = 'more edit, not shown here: src/a.js';
  const APART = `${PAGE_LABELS.unconfirmedWrites} src/a.js ${FAILED_WORDS}`;
  // A decision whose grounded code is in W0, citing W0, W2 and the heredoc: its preview is W0's; W2 is its one more
  // edit; the heredoc is named apart, with its command's end.
  const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'module layout', chosen: 'one module',
    value: 'Writing the module.', valueState: 'grounded', actions: ['W0', 'W2', 'H1-w1'], stated: null,
    valueReceipt: { eventId: 'W0', field: 'added-code', role: 'code', quote: 'Writing the module.',
      sessionKey: STORY_KEY },
    constrainedBy: null, instructionReview: null, column: 'unasked', columnState: 'grounded', amends: [],
    materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [], ...fields });
  for (const column of ['unasked', 'asked-chose']) {
    const html = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI',
      decisions: [decided({ column })] }));
    const item = rowText(html, 'id="decision-1"');
    assert.ok(item.includes(`${PAGE_LABELS.editMade} NOTES.md +1 −0`), item);
    assert.ok(item.includes('It was also made in 1 more edit, not shown here: src/b.js.'), item);
    assert.equal(item.includes(MORE), false, item);
    assert.ok(item.includes(APART), item);
  }
  // A finding citing W0's code and the heredoc: its preview is W0's; the heredoc is named apart.
  const finding = { origin: 'session-review', kind: 'claim_contradicted', status: 'FYI',
    title: 'The module was not written',
    receipts: [receipt('code', 'W0', 'Writing the module.'), receipt('action', 'H1-w1', 'src/a.js')] };
  const html = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI', findings: [finding] }));
  const item = rowText(html, 'id="finding-1"');
  assert.ok(item.includes(`${PAGE_LABELS.editCited} NOTES.md +1 −0`), item);
  assert.equal(item.includes('more edit, not shown here'), false, item);
  assert.ok(item.includes(APART), item);
});

test('D80 (review of N) page: writes of a failed and of a stopped command a row cites are named one line per end, '
  + 'each with its own words', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Write the modules.');
  ends.failed(b, 'H1', "cat > src/a.js <<'EOF'\nexport const a = 1;\nEOF");
  heredoc(b, 'H1-w1', 'H1', 'src/a.js', 'export const a = 1;\n');
  ends.interrupted(b, 'H2', "cat > src/b.js <<'EOF'\nexport const b = 2;\nEOF");
  heredoc(b, 'H2-w1', 'H2', 'src/b.js', 'export const b = 2;\n');
  ends.failed(b, 'H3', "cat > src/c.js <<'EOF'\nexport const c = 3;\nEOF");
  heredoc(b, 'H3-w1', 'H3', 'src/c.js', 'export const c = 3;\n');
  const session = b.session();
  const decision = { actorSession: STORY_KEY, dimension: 'module layout', chosen: 'three modules', value: null,
    valueReceipt: null, valueState: 'unchecked', actions: ['H1-w1', 'H2-w1', 'H3-w1'], stated: null,
    constrainedBy: null, instructionReview: null, column: 'asked-chose', columnState: 'unchecked', amends: [],
    materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked', reasons: [] };
  const html = renderSessionPage(session, reportOf(session, { sessionStatus: 'FYI', decisions: [decision] }));
  const item = rowText(html, 'id="decision-1"');
  assert.ok(item.includes(`${PAGE_LABELS.unconfirmedWrites} src/a.js and src/c.js ${FAILED_WORDS} `
    + `${PAGE_LABELS.unconfirmedWrites} src/b.js ${STOPPED_WRITE_WORDS}`), item);
  assert.equal(item.includes(PAGE_LABELS.changedFiles), false, item);
});

test('D80 (review of N) story: a step whose only command was stopped before it finished is never drawn as reading only',
  () => {
    const b = sessionBuilder();
    b.ask('I1', 'Write the notes.');
    b.change('W0', 'NOTES.md', { after: 'Notes.\n' });
    b.ask('I2', 'Clean the build.');
    ends.interrupted(b, 'R1', 'rm -rf build');
    const session = b.session();
    const story = renderSessionStory(session, reportOf(session));
    assert.match(story, /class S2 step\n/);
    assert.equal(/class S2 quiet/.test(story), false);
    assert.match(story, /Step 2 · 1 command stopped before it finished/);
    // A refused command never ran: its step is still drawn as reading only.
    const r = sessionBuilder();
    r.ask('I1', 'Write the notes.');
    r.change('W0', 'NOTES.md', { after: 'Notes.\n' });
    r.ask('I2', 'Clean the build.');
    ends.refused(r, 'R1', 'rm -rf build');
    const refused = r.session();
    assert.match(renderSessionStory(refused, reportOf(refused)), /class S2 quiet\n/);
  });
