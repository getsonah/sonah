// D180 (the owner, 2026-10-28: "rest pick the low hanging ones for beta 10"; a startup's field review: the request to
// run Sonah showed as "Not checked"): a review cannot check its own end. One that the agent started from its own session
// reads the recording while the command that started it has no result yet, and a recording cut short by a crash or a
// kill ends the same way. So a plain not-checked ask of the message whose turn the read left open (session-story.js
// `storyFacts` `openTurn`: the read's last step holds a command of the main thread whose result no window holds) has
// its own state, `notCheckedOpenTurn`: its status word, its count-line part and one folded line say what Sonah found.
// Every other state, and the header's count of the asks Sonah did not check, is as before. Structure only: the
// recorder's kinds, the main thread's lineage and what the windows hold, never the words. Every session here is
// synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { reportModel } from '../report-model.js';
import { storyFacts, renderReportMarkdown } from '../session-story.js';
import { renderSessionPage } from '../session-page.js';
import { REPORT_PROMPT_WORDS, REPORT_PROMPT_PARTS } from '../report-words.js';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

const OPEN = 'notCheckedOpenTurn';
const row = (id, quote, status, extra = {}) => ({ text: quote, status, ...extra,
  instruction: { role: 'instruction', eventId: id, quote, sessionKey: STORY_KEY } });
const report = (session, rows, without = []) => ({ sessionReview: 'complete', coverage: 'complete', requirements: rows,
  windowResults: [{ windowIndex: 0, eventIds: session.events.map((e) => e.id).filter((id) => !without.includes(id)),
    failure: null }] });
/** An invocation the recorder wrote with no result (the result row dropped from the recording). */
const drop = (b, id) => { const at = b.events.findIndex((e) => e.id === id); b.events.splice(at, 1);
  b.events.forEach((e, i) => { e.sequence = i; }); };
const states = (model) => model.prompt.asks.map((a) => [a.n, a.message, a.state]);

/** Two messages; the second asks for a run of Sonah on this session and more, and its turn holds the agent's
 *  foreground `sonah review` (D172: a bare `sonah review` inside Claude Code reviews the session it runs in). */
function selfRun({ result = 'held', helper = false, later = false } = {}) {
  const b = sessionBuilder();
  b.ask('I1', 'Fix the parser. Then add a test.');
  b.read('A1', 'src/parser.js');
  b.say('C1', 'Fixed the parser and added a test.', 'final');
  b.ask('I2', 'Run Sonah on this session. Also tidy the docs. Rename the helper. Drop the old flag.');
  b.change('A2-0', 'docs/a.md', { operation: 'edit', before: 'a', after: 'b' });
  if (helper) {
    b.delegate('D2', 'Review this session.', 'c1');
    b.ask('child:c1:I0', 'Review this session.', 'agent', 'c1');
    b.run('child:c1:A0', 'sonah review', 'succeeded', 'Recording: x', 'c1');
  } else b.run('A2', 'sonah review', 'succeeded', 'Recording: x');
  if (result === 'none') drop(b, helper ? 'child:c1:A0-r' : 'A2-r');
  // The fix round: a later message of yours and its work, recorded after the read (no window holds them).
  const after = later ? ['I3', 'A3', 'A3-r', 'F3'] : [];
  if (later) {
    b.ask('I3', 'Thanks. Now commit.');
    b.run('A3', 'git commit -m "x"', 'succeeded', '1 file changed');
    b.say('F3', 'Committed.', 'final');
  }
  const session = b.session();
  const rows = [row('I1', 'Fix the parser', 'done'), row('I2', 'Run Sonah on this session', 'not-checked'),
    row('I2', 'Also tidy the docs', 'done'), row('I2', 'Rename the helper', 'not-done'),
    row('I2', 'Drop the old flag', 'partly-done')];
  const without = [...(result === 'unheld' ? [helper ? 'child:c1:A0-r' : 'A2-r'] : []), ...after];
  return { session, report: report(session, rows, without) };
}

test('D180: in an open last turn only the plain not-checked ask moves; done, not done and partly done stay', () => {
  const { session, report: r } = selfRun({ result: 'none' });
  assert.equal(storyFacts(session, r).openTurn, 2);
  const model = reportModel(session, r, {});
  assert.deepEqual(states(model), [[1, 1, 'done'], [2, 2, OPEN], [3, 2, 'done'], [4, 2, 'notDone'], [5, 2, 'partly']]);
  const ask = model.prompt.asks[1];
  assert.equal(ask.status, REPORT_PROMPT_WORDS.status.notCheckedOpenTurn);
  assert.deepEqual(ask.folded.map((line) => line.map((p) => p.text).join('')), [REPORT_PROMPT_WORDS.openTurn]);
  assert.equal(model.prompt.counts[OPEN], 1);
  assert.equal(model.prompt.counts.notChecked, 0);
  assert.ok(model.prompt.parts.includes(REPORT_PROMPT_PARTS.notCheckedOpenTurn(1)));
  assert.ok(model.countLine.prompt.includes(REPORT_PROMPT_PARTS.notCheckedOpenTurn(1)));
  // The same review with the result recorded (a recording grown since) against it with the result held: the model is
  // the same but the moved ask's state, status word and folded line, its count and its count-line part. So the header's
  // count of the asks Sonah did not check (it counts the row's status), every item and every other ask are as before.
  const closed = selfRun({ result: 'held' });
  const before = reportModel(closed.session, closed.report, {});
  assert.deepEqual(states(before), [[1, 1, 'done'], [2, 2, 'notChecked'], [3, 2, 'done'], [4, 2, 'notDone'],
    [5, 2, 'partly']]);
  const grown = selfRun({ result: 'unheld' });
  const after = reportModel(grown.session, grown.report, {});
  const back = (m) => {
    const copy = JSON.parse(JSON.stringify(m));
    for (const a of copy.prompt.asks.filter((x) => x.state === OPEN)) {
      Object.assign(a, { state: 'notChecked', status: REPORT_PROMPT_WORDS.status.notChecked });
      a.folded = a.folded.filter((line) => line.map((p) => p.text).join('') !== REPORT_PROMPT_WORDS.openTurn);
    }
    for (const seg of copy.prompt.messages.flatMap((x) => x.segments)) if (seg.state === OPEN) seg.state = 'notChecked';
    copy.prompt.counts.notChecked += copy.prompt.counts[OPEN];
    copy.prompt.counts[OPEN] = 0;
    const part = [REPORT_PROMPT_PARTS.notCheckedOpenTurn(1), REPORT_PROMPT_PARTS.notChecked(1)];
    copy.prompt.parts = copy.prompt.parts.map((x) => (x === part[0] ? part[1] : x));
    copy.countLine.prompt = copy.countLine.prompt.replace(...part);
    return copy;
  };
  assert.deepEqual(back(after), JSON.parse(JSON.stringify(before)));
  assert.deepEqual(after.notChecked.quiet, before.notChecked.quiet);
  assert.deepEqual(after.tiers, before.tiers, 'no item moves');
  // The page and the .md show the status and the folded line.
  const page = renderSessionPage(session, r, {});
  assert.ok(page.includes(`<span class="tag">${REPORT_PROMPT_WORDS.status.notCheckedOpenTurn}</span>`));
  assert.ok(page.includes(REPORT_PROMPT_WORDS.openTurn));
  const md = renderReportMarkdown(session, r, {});
  assert.ok(md.includes(`| ${REPORT_PROMPT_WORDS.status.notCheckedOpenTurn} |`));
  assert.ok(md.includes(REPORT_PROMPT_WORDS.openTurn));
  assert.ok(md.includes(REPORT_PROMPT_PARTS.notCheckedOpenTurn(1)));
});

test('D180: the command\'s result held by a window moves nothing; recorded but held by none, the ask moves as cut', () => {
  const held = selfRun({ result: 'held' });
  assert.equal(storyFacts(held.session, held.report).openTurn, null);
  assert.ok(!states(reportModel(held.session, held.report, {})).some(([, , s]) => s === OPEN));
  // A render of the same review over a recording that has grown since (the result recorded, no window holds it) gives
  // the state that the cut recording gave.
  const grown = selfRun({ result: 'unheld' });
  const cut = selfRun({ result: 'none' });
  assert.equal(storyFacts(grown.session, grown.report).openTurn, 2);
  assert.deepEqual(states(reportModel(grown.session, grown.report, {})), states(reportModel(cut.session, cut.report, {})));
});

test('D180: a helper\'s open command moves nothing; its hand-off is no command', () => {
  for (const result of ['none', 'unheld']) {
    const { session, report: r } = selfRun({ helper: true, result });
    assert.equal(storyFacts(session, r).steps.at(-1).request, 2, 'the helper\'s work is the second message\'s');
    assert.equal(storyFacts(session, r).openTurn, null, result);
    assert.ok(!states(reportModel(session, r, {})).some(([, , s]) => s === OPEN), result);
  }
});

test('D180: an open command in an earlier message moves nothing; nor does an open call that is no command', () => {
  const b = sessionBuilder();
  b.ask('I1', 'Run the build. Then fix the parser.');
  b.run('A1', 'npm run build', 'succeeded', 'ok');
  drop(b, 'A1-r');
  b.ask('I2', 'Now add a test.');
  b.read('A2', 'src/parser.js');
  drop(b, 'A2-r');
  b.say('F2', 'Added.', 'final');
  const session = b.session();
  const r = report(session, [row('I1', 'Run the build', 'not-checked'), row('I2', 'Now add a test', 'not-checked')]);
  assert.equal(storyFacts(session, r).openTurn, null);
  assert.deepEqual(states(reportModel(session, r, {})), [[1, 1, 'notChecked'], [2, 2, 'notChecked']]);
});

test('D180: a not-checked ask with a code finding in an open turn stays notCheckedCode', () => {
  const { session, report: r } = selfRun({ result: 'none' });
  r.requirements[1] = { ...r.requirements[1], codeLinks: [{ link: 'leads_from', finding: `sha256:${'9'.repeat(64)}` }] };
  const model = reportModel(session, r, {});
  assert.equal(storyFacts(session, r).openTurn, 2);
  assert.equal(model.prompt.asks[1].state, 'notCheckedCode');
  assert.equal(model.prompt.counts[OPEN], 0);
  assert.ok(!model.prompt.parts.includes(REPORT_PROMPT_PARTS.notCheckedOpenTurn(1)));
});

test('D180 with D172: a foreground self-run is open in the last turn; a later message that holds its result is not', () => {
  // The agent's bare `sonah review` (D172) is the read's last command, and its result is not in the read.
  const own = selfRun({ result: 'none' });
  assert.equal(reportModel(own.session, own.report, {}).prompt.asks[1].state, OPEN);
  // The same run with its result held, then a later message of yours with its own work: no turn is left open.
  const b = sessionBuilder();
  b.ask('I1', 'Run Sonah on this session.');
  b.run('A1', 'sonah review', 'succeeded', 'Recording: x');
  b.say('C1', 'The review finished.', 'final');
  b.ask('I2', 'Thanks. Now commit.');
  b.run('A2', 'git commit -m "x"', 'succeeded', '1 file changed');
  b.say('F2', 'Committed.', 'final');
  const session = b.session();
  const r = report(session, [row('I1', 'Run Sonah on this session', 'not-checked'), row('I2', 'Now commit', 'done')]);
  assert.equal(storyFacts(session, r).openTurn, null);
  assert.deepEqual(states(reportModel(session, r, {})), [[1, 1, 'notChecked'], [2, 2, 'done']]);
  // Its result recorded after the later message (a prompt you queued while it ran) and held: none either.
  const q = sessionBuilder();
  q.ask('I1', 'Run Sonah on this session.');
  q.run('A1', 'sonah review', 'succeeded', 'Recording: x');
  const result = q.events.pop();
  q.ask('I2', 'Thanks. Now commit.');
  q.events.push({ ...result, sequence: q.events.length });
  q.say('F2', 'Committed.', 'final');
  const queued = q.session();
  const rq = report(queued, [row('I1', 'Run Sonah on this session', 'not-checked'), row('I2', 'Now commit', 'not-checked')]);
  assert.equal(storyFacts(queued, rq).openTurn, null);
  assert.deepEqual(states(reportModel(queued, rq, {})), [[1, 1, 'notChecked'], [2, 2, 'notChecked']]);
});

// The fix round's tests (the review's findings: the read's last step over a grown recording, D153's states, the two
// orders the record states, and the message the folded line names).

test('D180 fix round: over a recording grown since, later messages that no window holds leave the read\'s last step open', () => {
  // The review read up to the open command; the recording now holds its result and a later message of yours with its
  // own work, none of them held by a window. The open message is the read's last step's, never the session's last.
  const grown = selfRun({ result: 'unheld', later: true });
  const facts = storyFacts(grown.session, grown.report);
  assert.equal(facts.asks.at(-1).k, 3, 'the recording holds a later message');
  assert.equal(facts.steps.at(-1).request, 2);
  assert.equal(facts.openTurn, 2);
  const cut = selfRun({ result: 'none' });
  assert.deepEqual(states(reportModel(grown.session, grown.report, {})), states(reportModel(cut.session, cut.report, {})));
  assert.equal(reportModel(grown.session, grown.report, {}).prompt.counts[OPEN], 1);
});

test('D180 fix round: D153\'s states in an open turn stay, and so do their items', () => {
  // An ask an earlier window found not done that no later window settled, and a partly done one a later window
  // reaffirmed (D153), in the open message: they stay notCheckedLater and laterWork, with the same items and lines.
  const unsettle = (r) => {
    r.requirements[3] = { ...r.requirements[3], recheck: { outcome: 'not_checked_after_later_work' } };
    r.requirements[4] = { ...r.requirements[4], recheck: { outcome: 'reaffirmed' } };
  };
  const open = selfRun({ result: 'unheld' });
  const closed = selfRun({ result: 'held' });
  unsettle(open.report);
  unsettle(closed.report);
  assert.equal(storyFacts(open.session, open.report).openTurn, 2);
  const after = reportModel(open.session, open.report, {});
  const before = reportModel(closed.session, closed.report, {});
  assert.deepEqual(states(after), [[1, 1, 'done'], [2, 2, OPEN], [3, 2, 'done'], [4, 2, 'notCheckedLater'],
    [5, 2, 'laterWork']]);
  assert.deepEqual(states(before).slice(2), states(after).slice(2));
  for (const i of [3, 4]) assert.deepEqual(after.prompt.asks[i], before.prompt.asks[i]);
  assert.deepEqual(after.tiers, before.tiers, 'no item moves');
});

test('D180 fix round: the folded line comes after the session review\'s reason or fact; the part after notChecked', () => {
  // In the open message: an ask with no reason, one the quote gate lowered (D101's reason), one with D115's fact, and
  // one with a code finding; and a plain not-checked ask of the message before.
  const reasons = (r) => {
    r.requirements[0] = { ...r.requirements[0], status: 'not-checked' };
    r.requirements[2] = { ...r.requirements[2], status: 'not-checked', reason: 'deliverable_ungrounded' };
    r.requirements[3] = { ...r.requirements[3], status: 'not-checked', facts: ['no_deliverable_by_end'] };
    r.requirements[4] = { ...r.requirements[4], status: 'not-checked',
      codeLinks: [{ link: 'leads_from', finding: `sha256:${'9'.repeat(64)}` }] };
  };
  const open = selfRun({ result: 'none' });
  const closed = selfRun({ result: 'held' });
  reasons(open.report);
  reasons(closed.report);
  const after = reportModel(open.session, open.report, {});
  const before = reportModel(closed.session, closed.report, {});
  assert.deepEqual(states(after), [[1, 1, 'notChecked'], [2, 2, OPEN], [3, 2, OPEN], [4, 2, OPEN],
    [5, 2, 'notCheckedCode']]);
  const folded = (m, i) => m.prompt.asks[i].folded.map((line) => line.map((p) => p.text).join(''));
  for (const i of [2, 3]) {
    assert.equal(folded(before, i).length, 1, 'the session review\'s own line');
    assert.deepEqual(folded(after, i), [...folded(before, i), REPORT_PROMPT_WORDS.openTurn]);
  }
  assert.deepEqual(after.prompt.parts, [REPORT_PROMPT_PARTS.notChecked(1), REPORT_PROMPT_PARTS.notCheckedOpenTurn(3),
    REPORT_PROMPT_PARTS.notCheckedCode(1)]);
});

test('D180 fix round: the open message is the last of yours recorded before the command, a prompt you queued too', () => {
  // A prompt you queued, or your answer to the agent's question, in the turn of the message before it: it is the last
  // of your messages recorded before the open command, so it is the open message, whatever the command was for. The
  // folded line says that the agent called the command after this message, which is true of each.
  for (const marker of ['queued', 'answer']) {
    const b = sessionBuilder();
    b.ask('I1', 'Run Sonah on this session.');
    b.events.at(-1).turn = 't1';
    b.read('A0', 'src/a.js');
    b.ask('I2', 'Also check the docs.');
    Object.assign(b.events.at(-1), { markers: [marker], turn: 't1' });
    b.run('A1', 'sonah review', 'succeeded', 'Recording: x');
    drop(b, 'A1-r');
    const session = b.session();
    const r = report(session, [row('I1', 'Run Sonah on this session', 'not-checked'),
      row('I2', 'Also check the docs', 'not-checked')]);
    assert.equal(storyFacts(session, r).openTurn, 2, marker);
    const ids = session.events.map((e) => e.id);
    assert.ok(ids.indexOf('I2') < ids.indexOf('A1'), marker);
    assert.ok(!session.events.slice(ids.indexOf('I2') + 1, ids.indexOf('A1')).some((e) => e.kind === 'instruction'), marker);
    assert.deepEqual(states(reportModel(session, r, {})), [[1, 1, 'notChecked'], [2, 2, OPEN]], marker);
  }
});
