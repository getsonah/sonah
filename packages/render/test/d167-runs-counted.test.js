// D167 (the owner, 2026-10-28: "the .md (PR comment) keeps the counts of what the agent did and points to the page for
// the full runs list; the page keeps everything"; a user's review: the tool calls and commands in the .md "clutter the
// doc a bit for long horizon sessions"). The .md's Runs part counts the runs by their results, in the header's result
// parts, and says where their list is when the page lists a run that the .md does not; it keeps the line of each run
// that another part of the same .md names by number (its review: an item's Where too, as that .md prints them), so no
// such name points to nothing. The page lists the runs as before. Structure only, every session and report synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { renderSessionPage } from '../session-page.js';
import { renderReportMarkdown, REPORT_MD_LIMITS } from '../session-story.js';
import { REPORT_DID_WORDS, REPORT_SECTION_WORDS, REPORT_ITEM_WORDS, REPORT_TRIM_WORDS, REPORT_NOT_CHECKED_WORDS,
  REPORT_SEEN_WORDS } from '../report-words.js';
import { REPORT_SHAPES, reportSession, triagedReport, repoFacts } from './report-fixture.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const r = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const windowOf = (session) => [{ windowIndex: 0, eventIds: session.events.map((e) => e.id), failure: null }];
const bytes = (text) => Buffer.byteLength(text, 'utf8');
/** The .md's Runs part: from its heading to the next heading. */
const runsPart = (md) => {
  const at = md.indexOf(`#### ${REPORT_SECTION_WORDS.runs}`);
  return at < 0 ? null : md.slice(at, md.indexOf('\n#### ', at + 1) + 1);
};
/** The numbers of the run lines a text holds. */
const runLines = (text) => [...text.matchAll(/^- run (\d+) · /gm)].map((m) => Number(m[1]));
/** The runs that the .md names outside its Runs part, by its own words (`REPORT_ITEM_WORDS.run`, which
 *  `REPORT_SEEN_WORDS.ofRun` holds), read from the rendered text, never from the model. */
const namedOutside = (md) => {
  const part = runsPart(md);
  const rest = part === null ? md : md.split(part).join('');
  return [...new Set([...rest.matchAll(/\brun (\d+)\b/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
};
/** Every `run-<k>` the model links to (`href`) or anchors (`anchor`) outside its Runs list, by kind. */
function runRefs(model) {
  const out = { href: new Set(), anchor: new Set() };
  const visit = (v) => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (v === null || typeof v !== 'object') return;
    for (const key of ['href', 'anchor']) if (typeof v[key] === 'string' && /^run-\d+$/.test(v[key])) out[key].add(Number(v[key].slice(4)));
    Object.values(v).forEach(visit);
  };
  visit({ ...model, did: { ...model.did, runs: null } });
  return out;
}

/** Two quiet runs before the last edit (exit 0, no failure row), a failure the agent passed over (its item names it in
 *  its Where; its row holds a mark on its own result), the edit, a failed run after it and one that passed after it.
 *  The review's claim holds a mark on the failed run's result, so the claims list names that run. */
function fiveRuns(files = 0, late = false) {
  const b = sessionBuilder();
  b.ask('I1', 'Speed up the build.');
  // `files` writes with long paths first, so the .md is shortened to the lists' counts (`didCounts`).
  for (let k = 0; k < files; k++) b.change(`WF${k}`, `src/very/long/directory/name/for/the/generated/module/number/${k}/`
    + `${'segment-'.repeat(25)}file.js`, { after: `x${k}\n` });
  b.run('R0', 'npm ci', 'succeeded', 'added 12 packages');
  b.run('R1', 'npm run lint', 'succeeded', 'ok');
  b.run('R2', 'npm test', 'failed', 'FAIL build.test.js');
  b.change('W1', 'src/build.js', { after: 'export const build = () => 1;\n' });
  b.run('R3', 'npm run build', 'failed', 'Error: out of memory');
  b.run('R4', 'node bench.js', 'succeeded', '1.2s');
  // `late`: a write after the last run, so a file no command ran after.
  if (late) b.change('W2', 'docs/notes.md', { after: 'Notes.\n' });
  b.say('F1', 'The build is faster.', 'final');
  const session = b.session();
  const at = session.events.findIndex((e) => e.id === 'R3-r');
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'speed', instruction: r('instruction', 'I1', 'Speed up the build.'), status: 'done',
      deliverable: r('code', 'W1', 'export const build = () => 1;') }],
    failures: [{ eventId: 'R2-r', action: 'R2', outcome: 'ran-failed', form: 'exit', tool: 'bash', handling: 'passed-over',
      response: r('commentary', 'F1', 'The build is faster.'), seenInPart: [{ eventId: 'R2-r',
        sequence: session.events.findIndex((e) => e.id === 'R2-r'), fromLine: 1, throughLine: 40, partFrom: false,
        partThrough: false, fileLines: null, bytes: 2_000 }] }],
    promises: [{ id: `sha256:${'d'.repeat(64)}`, stated: r('commentary', 'F1', 'The build is faster.'),
      text: 'The build is faster', status: 'open', receipts: [r('commentary', 'F1', 'The build is faster.')],
      seenInPart: [{ eventId: 'R3-r', sequence: at, fromLine: 10, throughLine: 60, partFrom: false, partThrough: false,
        fileLines: null, bytes: 4_000 }] }] };
  return { session, report };
}

test('D167: the .md counts every run by its result part and lists none, but the runs another part of it names', () => {
  const { session, report } = fiveRuns();
  const model = reportModel(session, report, {});
  const { runs } = model.did;
  // The model: five runs, two quiet before the edit; every run's part counted, in the words and order of the cut runs'.
  assert.deepEqual([runs.total, runs.shown.length, runs.quietExit0, runs.cut], [5, 3, 2, 0]);
  assert.deepEqual(runs.parts, ['3 exited with code 0', '2 failed']);
  const md = renderReportMarkdown(session, report, {});
  // Its review: the failure item's Where (run 3) and the claims list's mark (run 4) each keep their run's line, so
  // every "run N" of the .md has its run in the .md; the page lists a run the .md does not (run 5), so the sentence.
  const item = runs.shown.find((run) => run.k === 3).item;
  const part = runsPart(md);
  const blocks = part.split('\n\n');
  assert.deepEqual(blocks.slice(0, 3), [`#### ${REPORT_SECTION_WORDS.runs}`,
    REPORT_DID_WORDS.runsCounted(5, runs.parts.join(', ')), REPORT_DID_WORDS.runsNamed]);
  assert.deepEqual(blocks.slice(4), [REPORT_DID_WORDS.runsOnPage, '']);
  const [three, four] = blocks[3].split('\n');
  assert.deepEqual(runLines(md), [3, 4]);
  // A kept line is the run's line as the page's list wrote it, its own shown-in-part mark included.
  assert.ok(three.startsWith(`- run 3 · \`npm test\` · failed, exit code 1 · the agent passed over it → item ${item} · `
    + `${REPORT_SEEN_WORDS.label} ${REPORT_SEEN_WORDS.lead} ${REPORT_SEEN_WORDS.ofRun(3)}. `), three);
  assert.equal(four, '- run 4 · `npm run build` · failed, exit code 1');
  assert.ok(md.includes(`${REPORT_SEEN_WORDS.ofRun(4)}.`), 'premise: the claims list names run 4');
  assert.ok(md.includes(`\`npm test\`  \nWhere: ${REPORT_ITEM_WORDS.run(3)}\n\n<details><summary>Evidence · Why Must know`));
  assert.deepEqual(namedOutside(md), [3, 4]);
  // No other run is listed: neither the quiet ones nor the one that passed after the edit.
  for (const command of ['npm ci', 'npm run lint', 'node bench.js']) assert.equal(md.includes(command), false, command);
  // The page lists the runs as before: every run the list shows, and the quiet ones counted; none of the .md's words.
  const page = renderSessionPage(session, report, {});
  for (const run of runs.shown) assert.ok(page.includes(`<li id="run-${run.k}">`), `run ${run.k}`);
  assert.ok(page.includes(REPORT_DID_WORDS.moreRuns(2)));
  for (const words of [REPORT_DID_WORDS.runsNamed, REPORT_DID_WORDS.runsOnPage, REPORT_DID_WORDS.runsCounted(5,
    runs.parts.join(', '))]) assert.equal(page.includes(words), false, words);
});

/** The fixture report grown by `n` asks not done, so the .md is shortened past the evidence of Must know and Must act
 *  (D131's last steps) when `n` is large. */
function grownReport(session, n) {
  const report = triagedReport(session);
  report.requirements = [...report.requirements, ...Array.from({ length: n }, (_, k) => ({
    text: `Also add a test for the limiter ${k}`, instruction: r('instruction', 'I2', 'Also add a test for the limiter'),
    status: 'not-done', shortfall: r('commentary', 'F2', 'I added no test yet.') }))];
  return report;
}

test('D167: on every fixture and shortening, the .md keeps the line of exactly the runs it names elsewhere', () => {
  const session = reportSession();
  const mds = Object.entries(REPORT_SHAPES).map(([name, shape]) => [name, renderReportMarkdown(session, shape(session),
    repoFacts())]);
  for (const n of [100, 200]) mds.push([`grown ${n}`, renderReportMarkdown(session, grownReport(session, n), repoFacts())]);
  const { session: five, report } = fiveRuns();
  mds.push(['five', renderReportMarkdown(five, report, {})]);
  let dropped = 0, cut = 0;
  for (const [name, md] of mds) {
    // Read from the text: a run the .md names outside its Runs part has its line there, and no other run has one.
    assert.deepEqual(runLines(runsPart(md) ?? ''), namedOutside(md), name);
    if (md.includes(REPORT_TRIM_WORDS.mdShortened) && !md.includes('<summary>Evidence · Why Must')) cut++;
    if (name.startsWith('grown') && !runLines(runsPart(md) ?? '').includes(4)) dropped++;
  }
  // Premises: a .md shortened past every evidence fold of Must know and Must act, where the run that only item 11's
  // evidence named (run 4) keeps no line, while the failures' Where keep theirs.
  assert.ok(cut > 0 && dropped > 0, `${cut} ${dropped}`);
  const grown = mds.find(([name]) => name === 'grown 200')[1];
  assert.deepEqual(runLines(runsPart(grown)), [2, 3]);
  // An item's own Where of a run is in an item that shows the run's call (its command or its tool).
  for (const [name, shape] of Object.entries(REPORT_SHAPES)) {
    const model = reportModel(session, shape(session), repoFacts());
    const md = renderReportMarkdown(session, shape(session), repoFacts());
    for (const k of runRefs(model).anchor) {
      const run = model.did.runs.shown.find((x) => x.k === k);
      const at = md.indexOf(`Where: ${REPORT_ITEM_WORDS.run(k)}`);
      assert.ok(at > 0, `${name}: Where: run ${k}`);
      assert.ok(md.slice(md.lastIndexOf('<a name="item-', at), at).includes(run.text ?? run.tool), `${name}: run ${k}`);
    }
    // The count line counts every run, its parts summing to the total; the page's list holds a run the .md does not.
    if (model.did.runs.total) {
      assert.ok(md.includes(`\n${REPORT_DID_WORDS.runsCounted(model.did.runs.total, model.did.runs.parts.join(', '))}\n`), name);
      assert.equal(model.did.runs.parts.reduce((n, p) => n + Number(/\d+/.exec(p)[0]), 0), model.did.runs.total, name);
      assert.ok(md.includes(`\n${REPORT_DID_WORDS.runsOnPage}\n`), name);
    }
  }
});

test('D167: a long session\'s runs no longer shorten the .md; the page still lists them and counts the rest', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Make the flaky suite pass.');
  b.change('W1', 'test/flaky.js', { after: 'retry(3);\n' });
  for (let k = 0; k < 1_500; k++) b.run(`R${k}`, `npm test -- --grep "case ${k} of the flaky suite"`, 'failed', `FAIL ${k}`);
  b.say('F1', 'Done.', 'final');
  const session = b.session();
  const report = { windowResults: windowOf(session), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'pass', instruction: r('instruction', 'I1', 'Make the flaky suite pass.'), status: 'done',
      deliverable: r('code', 'W1', 'retry(3);') }] };
  const md = renderReportMarkdown(session, report, {});
  assert.ok(bytes(md) <= REPORT_MD_LIMITS.maxBytes, `${bytes(md)} bytes`);
  assert.equal(md.includes(REPORT_TRIM_WORDS.mdShortened), false, 'the .md is whole');
  assert.ok(md.includes(`\n${REPORT_DID_WORDS.runsCounted(1_500, '1500 failed')}\n`));
  assert.deepEqual(runLines(md), []);
  const page = renderSessionPage(session, report, {});
  assert.equal([...page.matchAll(/<li id="run-\d+">/g)].length, 40);
  assert.ok(page.includes(REPORT_DID_WORDS.runsCut(40, 1_460, '1460 failed')));
});

test('D167: the lists step cuts no count of runs and keeps the lines of the runs still named; it leaves out the files no command ran after', () => {
  const session = reportSession();
  const whole = renderReportMarkdown(session, triagedReport(session), repoFacts());
  // Grown past the bound by what Sonah could not check (proposals withheld) and Good to know (questions), so the lists of
  // what the agent did keep their counts (D131's `didCounts`).
  const report = triagedReport(session);
  const long = (k, n) => `${'word '.repeat(n)}${k}`;
  report.codePass.questions = [...report.codePass.questions, ...Array.from({ length: 125 }, (_, k) => ({ id: `G${k}`,
    question: `Question ${k}`, from: 'finding', finding: { title: `Finding ${k}`, kind: 'bug' }, concerns: null,
    quote: null, check: { verdict: 'refuted', reason: 'not_against_goal', explanation: long(k, 50) } }))];
  report.codePass.withheld = [...report.codePass.withheld, ...Array.from({ length: 90 }, (_, k) => ({ what: 'finding',
    text: long(k, 25), kind: 'bug', lens: 'behaviour', reason: 'verify_refuted',
    check: { verdict: 'refuted', reason: 'incorrect', explanation: long(k, 25) } }))];
  const short = renderReportMarkdown(session, report, repoFacts());
  assert.ok(bytes(short) <= REPORT_MD_LIMITS.maxBytes);
  assert.match(short, new RegExp(`#### ${REPORT_SECTION_WORDS.files}\\n\\n${REPORT_NOT_CHECKED_WORDS.rowsNotShown(5)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'premise: the lists keep their counts');
  // Every part that names a run here (the failures' Where, item 11's evidence) is still printed, so the part is equal.
  assert.equal(runsPart(short), runsPart(whole));
  assert.deepEqual(runLines(runsPart(short)), [2, 3, 4], 'the failures\' runs and the run that item 11 rests on');
  assert.deepEqual(namedOutside(short), [2, 3, 4]);
  // A run that only the claims list named (its mark) loses its line with that list at `didCounts`; one that an item
  // names keeps it. The fiveRuns session grown by 200 files with long paths stops there.
  const { session: five, report: fiveReport } = fiveRuns(200);
  const grown = renderReportMarkdown(five, fiveReport, {});
  assert.ok(grown.includes(REPORT_TRIM_WORDS.mdShortened) && grown.includes(`#### ${REPORT_SECTION_WORDS.claims}\n\n`
    + `${REPORT_NOT_CHECKED_WORDS.rowsNotShown(1)}`), 'premise: the claims list keeps its count');
  assert.deepEqual(runLines(runsPart(grown)), [3]);
  assert.deepEqual(namedOutside(grown), [3]);
  // The files no command ran after: said whole, and left out with the lists at `didCounts`.
  const notes = REPORT_DID_WORDS.neverRan('`docs/notes.md`');
  const [late, lateGrown] = [fiveRuns(0, true), fiveRuns(200, true)].map((x) => renderReportMarkdown(x.session, x.report, {}));
  assert.ok(runsPart(late).includes(`\n\n${notes}\n\n`));
  assert.ok(lateGrown.includes(`#### ${REPORT_SECTION_WORDS.claims}\n\n${REPORT_NOT_CHECKED_WORDS.rowsNotShown(1)}`));
  assert.equal(lateGrown.includes(notes), false);
  assert.equal(runsPart(lateGrown).split('\n\n')[1], runsPart(late).split('\n\n')[1], 'the count line, at both');
});

test('D167: with every run quiet, the .md counts them and points to no list, since the page lists none', () => {
  // Exit 0 before the last edit and no failure row: the page lists none of them and counts them (`moreRuns`), so the
  // .md says no sentence about a list. Its review: a session's exploring commands before its first edit are this shape.
  const b = sessionBuilder();
  b.ask('I1', 'Tidy the notes.');
  b.run('R0', 'ls docs', 'succeeded', 'notes.md');
  b.run('R1', 'git status', 'succeeded', 'clean');
  b.change('W1', 'docs/notes.md', { after: 'Notes.\n' });
  b.say('F1', 'Done.', 'final');
  const s = b.session();
  const report = { windowResults: windowOf(s), sessionReview: 'complete', coverage: 'complete',
    requirements: [{ text: 'tidy', instruction: r('instruction', 'I1', 'Tidy the notes.'), status: 'done',
      deliverable: r('code', 'W1', 'Notes.') }] };
  const { runs } = reportModel(s, report, {}).did;
  assert.deepEqual([runs.total, runs.shown.length, runs.quietExit0], [2, 0, 2]);
  const md = renderReportMarkdown(s, report, {});
  assert.equal(runsPart(md), [`#### ${REPORT_SECTION_WORDS.runs}`, REPORT_DID_WORDS.runsCounted(2, '2 exited with code 0'),
    REPORT_DID_WORDS.neverRan('`docs/notes.md`')].join('\n\n') + '\n\n');
  assert.equal(md.includes(REPORT_DID_WORDS.runsOnPage), false);
  const page = renderSessionPage(s, report, {});
  assert.ok(page.includes(`<ol class="rows runs"></ol><p class="cut">${REPORT_DID_WORDS.moreRuns(2)}</p>`));
});

test('D167: a What the agent did of runs alone is not shortened by the lists step, so the notice sits elsewhere', () => {
  // No file, claim, decision left out or settled, no file a command ran after: the lists step leaves nothing out of
  // What the agent did (its runs are counted at every step), so its shortened notice is on the first part it shortens
  // after that, What Sonah could not check (proposals withheld, counted one step later). No message of yours, no item.
  const b = sessionBuilder();
  b.run('R0', 'npm test', 'failed', 'FAIL a');
  b.run('R1', 'npm run build', 'failed', 'Error');
  b.say('F1', 'Done.', 'final');
  const s = b.session();
  const long = (k) => `${'word '.repeat(60)}${k}`;
  const report = { windowResults: windowOf(s), sessionReview: 'complete', coverage: 'complete', codeCoverage: 'complete',
    codePass: { version: { pass: 'sonah.code-pass/10' }, ran: true, required: false,
      base: { kind: 'git', commit: 'a'.repeat(40) }, gaps: [], coverage: 'complete', files: [], findings: [],
      questions: [], footer: [], withheld: Array.from({ length: 400 }, (_, k) => ({ what: 'finding', text: long(k),
        kind: 'bug', lens: 'behaviour', reason: 'verify_refuted', check: { verdict: 'refuted', reason: 'incorrect',
          explanation: long(k) } })) } };
  const { did } = reportModel(s, report, {});
  assert.deepEqual([did.files.total, did.runs.total, did.runs.shown.length, did.runs.neverRan.length, did.claims.total,
    did.leftOut.length, did.settled.length], [0, 2, 2, 0, 0, 0, 0]);
  const md = renderReportMarkdown(s, report, {});
  assert.ok(md.includes(REPORT_NOT_CHECKED_WORDS.rowsNotShown(400)), 'premise: shortened past the lists step');
  const did0 = md.indexOf('<summary>What the agent did'), nc = md.indexOf('<summary>What Sonah could not check');
  const notice = md.indexOf(REPORT_TRIM_WORDS.mdShortened);
  assert.ok(did0 > 0 && nc > did0 && notice > nc, `${did0} ${nc} ${notice}`);
  assert.equal(md.split(REPORT_TRIM_WORDS.mdShortened).length, 2, 'said once');
});

test('D167: with no run, the .md says so and points to no list; the sentence names no path and no link', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Explain the parser.');
  b.say('F1', 'It splits lines.', 'final');
  const session = b.session();
  const md = renderReportMarkdown(session, { windowResults: windowOf(session), sessionReview: 'complete',
    coverage: 'complete' }, {});
  assert.equal(runsPart(md), `#### ${REPORT_SECTION_WORDS.runs}\n\n${REPORT_DID_WORDS.noRuns}\n\n`);
  assert.equal(md.includes(REPORT_DID_WORDS.runsOnPage), false);
  // The .md is posted to GitHub: the sentence names the page and how it is written, never a file path, never a link.
  assert.doesNotMatch(REPORT_DID_WORDS.runsOnPage, /\blink|https?:|\/|\\|~|\.html\b/i);
  assert.ok(REPORT_DID_WORDS.runsOnPage.includes('HTML page'));
  // Its review: the command as the CLI's usage says it (`--format html` needs `--output FILE`; FILE its placeholder).
  assert.ok(REPORT_DID_WORDS.runsOnPage.includes('sonah review --format html --output FILE writes'));
});
