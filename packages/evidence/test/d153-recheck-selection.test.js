// D153: the after-point re-check's selection (recheck.js `recheckSelection`), by order and window only. An accusing row
// is re-checked by each later window of its own session whose events of that session were all recorded after every
// receipt the row rests on; a window of another session never re-checks it, and a row with no such window is
// `no_later_work`. Synthetic sessions only: no recording, no model, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RECHECK_KINDS, RECHECK_OUTCOMES, REPORT_ITEM_KINDS } from '../src/ledger.js';
import { recheckAnchor, recheckSelection, rowReceipts } from '../src/recheck.js';
import { planWindows } from '../src/windows.js';
import * as reviewRun from '../src/run-review.js';
import { recheckSession, launchSession, twoHelpersSession, backgroundSession, receipt } from './d153-recheck-fixture.js';

const plan = () => {
  const session = recheckSession();
  return { session, windows: reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).windows };
};
const ask = (instruction, status, { deliverable = null, shortfall = null, text = 'an ask' } = {}) => ({ text,
  instruction: receipt(instruction, 'instruction', `words of ${instruction}`), status,
  ...(deliverable ? { deliverable } : {}), ...(shortfall ? { shortfall } : {}) });
const claim = (receipts, status = 'DECIDE') => ({ origin: 'session-review', kind: 'claim_contradicted', status, receipts });
const written = (stated, receipts, label = 'contradicted') => ({ id: 'w:1', text: 'a statement', stated, label, receipts });

/** The rows of every case, in one list: [name, entry]. */
const CASES = [
  ['partly done in the first window', { source: 'requirements', index: 0, row: ask('I1', 'partly-done',
    { deliverable: receipt('ED1', 'code', 'return name'), shortfall: receipt('C1', 'commentary', 'I did not add a test') }) }],
  ['not done at the end of the second window', { source: 'requirements', index: 1, row: ask('I2', 'not-done',
    { shortfall: receipt('C2', 'commentary', 'The changelog is not updated.') }) }],
  ['not done before the helper it launched', { source: 'requirements', index: 2, row: ask('I2', 'not-done',
    { shortfall: receipt('D1', 'action', 'check the docs') }) }],
  ['a helper\'s contradicted claim', { source: 'findings', index: 0, row: claim([receipt('WC', 'commentary', 'The docs'),
    receipt('WF1-r0', 'observation', 'yyy')]) }],
  ['a contradicted statement settled in the last window', { source: 'writtenClaims', index: 0,
    row: written(receipt('ED1', 'code', 'return name'), [receipt('ED1', 'code', 'return name'),
      receipt('A3-r', 'observation', 'ok 1')]) }],
  ['a done ask', { source: 'requirements', index: 3, row: ask('I1', 'done', { deliverable: receipt('ED1', 'code', 'return') }) }],
  ['partly done, judged in the second window', { source: 'requirements', index: 4, window: 1, row: ask('I1', 'partly-done',
    { deliverable: receipt('ED1', 'code', 'return name'), shortfall: receipt('C1', 'commentary', 'I did not add') }) }],
  ['an ask whose receipts name no recorded event', { source: 'requirements', index: 5, row: ask('X0', 'not-done',
    { shortfall: receipt('X1', 'commentary', 'gone') }) }],
  ['a claim the caller names as corrected', { source: 'findings', index: 1, kind: 'claim_corrected',
    row: claim([receipt('C1', 'commentary', 'I did not'), receipt('A3-r', 'observation', 'ok 1')]) }],
  ['a claim the agent corrected', { source: 'findings', index: 2,
    row: claim([receipt('C1', 'commentary', 'I did not'), receipt('A3-r', 'observation', 'ok 1')], 'FYI') }],
  ['a helper\'s claim on the first event of the last window', { source: 'findings', index: 3,
    row: claim([receipt('WC2', 'commentary', 'Done checking.')]) }],
  ['a helper\'s claim whose last receipt is the main agent\'s', { source: 'findings', index: 4,
    row: claim([receipt('WC', 'commentary', 'The docs'), receipt('C2', 'observation', 'The changelog')]) }],
];
const entries = CASES.map(([, entry]) => entry);

test('D153: the vocabularies are closed, and every re-checked kind is an item kind', () => {
  assert.deepEqual(RECHECK_KINDS, ['ask_partly_done', 'ask_not_done', 'claim_contradicted', 'written_contradicted']);
  assert.deepEqual(RECHECK_OUTCOMES, ['moved', 'reaffirmed', 'not_checked_after_later_work', 'no_later_work',
    'not_placed']);
  assert.ok(Object.isFrozen(RECHECK_KINDS) && Object.isFrozen(RECHECK_OUTCOMES));
  for (const kind of RECHECK_KINDS) assert.ok(REPORT_ITEM_KINDS.includes(kind), kind);
});

test('D153: the fixture plans three windows of the main agent and two of its helper, one packed with the last', () => {
  const { windows } = plan();
  assert.deepEqual(windows.map((w) => w.parts.map((part) => [part.session.childId, part.events[0].id])),
    [[[null, 'I1']], [[null, 'I2']], [['w', 'B1']], [['w', 'WC2'], [null, 'I3']]]);
});

test('D153: a row\'s after point is its receipt recorded last, and its session is its subject\'s', () => {
  const { session } = plan();
  const [partly, , beforeHelper, helperClaim, writtenRow] = entries;
  assert.deepEqual(recheckAnchor(session, 'requirements', partly.row), { eventId: 'C1', sequence: 2, actor: null });
  assert.deepEqual(recheckAnchor(session, 'requirements', beforeHelper.row), { eventId: 'D1', sequence: 65, actor: null });
  assert.deepEqual(recheckAnchor(session, 'findings', helperClaim.row), { eventId: 'WF1-r0', sequence: 69, actor: 'w' });
  assert.deepEqual(recheckAnchor(session, 'writtenClaims', writtenRow.row), { eventId: 'A3-r', sequence: 255,
    actor: null });
  assert.equal(recheckAnchor(session, 'requirements', entries[7].row), null, 'no receipt names a recorded event');
  assert.equal(recheckAnchor(session, 'findings', claim([receipt('A3-r', 'observation', 'ok')])), null,
    'a claim with no words of the agent names no session');
  assert.equal(recheckAnchor(session, 'decisions', partly.row), null, 'a source with no subject');
  assert.deepEqual(rowReceipts({ ...partly.row, receipts: [receipt('A3', 'action', 'x'), null, { eventId: '' }] })
    .map((r) => r.eventId), ['I1', 'ED1', 'C1', 'A3'], 'field order, then the list; a receipt with no event is none');
});

test('D153: the selection, case by case (the golden result on the fixture)', () => {
  const { session, windows } = plan();
  const out = recheckSelection({ session, windows, rows: entries });
  const by = (at) => out.rows.find((row) => row.at === at) ?? null;
  const shape = (at) => (by(at) ? { kind: by(at).kind, anchor: by(at).anchor?.eventId ?? null, actor: by(at).actor,
    judgedIn: by(at).judgedIn, later: by(at).later, outcome: by(at).outcome } : null);
  assert.deepEqual(CASES.map(([name], at) => [name, shape(at)]), [
    ['partly done in the first window', { kind: 'ask_partly_done', anchor: 'C1', actor: null, judgedIn: null,
      later: [1, 3], outcome: null }],
    ['not done at the end of the second window', { kind: 'ask_not_done', anchor: 'C2', actor: null, judgedIn: null,
      later: [3], outcome: null }],
    // The helper's window holds only events recorded after this row (the launch is its after point), but they are the
    // helper's: it never re-checks a row of the main agent.
    ['not done before the helper it launched', { kind: 'ask_not_done', anchor: 'D1', actor: null, judgedIn: null,
      later: [3], outcome: null }],
    // The last window holds the helper's last piece beside the main agent's last message: it re-checks the helper's row.
    ['a helper\'s contradicted claim', { kind: 'claim_contradicted', anchor: 'WF1-r0', actor: 'w', judgedIn: null,
      later: [3], outcome: null }],
    ['a contradicted statement settled in the last window', { kind: 'written_contradicted', anchor: 'A3-r', actor: null,
      judgedIn: null, later: [], outcome: 'no_later_work' }],
    ['a done ask', null],
    ['partly done, judged in the second window', { kind: 'ask_partly_done', anchor: 'C1', actor: null, judgedIn: 1,
      later: [3], outcome: null }],
    ['an ask whose receipts name no recorded event', { kind: 'ask_not_done', anchor: null, actor: undefined,
      judgedIn: null, later: [], outcome: 'not_placed' }],
    ['a claim the caller names as corrected', null],
    ['a claim the agent corrected', null],
    // Its window starts with it: the window that judged it, never one after it.
    ['a helper\'s claim on the first event of the last window', { kind: 'claim_contradicted', anchor: 'WC2', actor: 'w',
      judgedIn: null, later: [], outcome: 'no_later_work' }],
    // The row is its subject's (the helper's words): a later window of the main agent never re-checks it.
    ['a helper\'s claim whose last receipt is the main agent\'s', { kind: 'claim_contradicted', anchor: 'C2', actor: 'w',
      judgedIn: null, later: [], outcome: 'no_later_work' }],
  ]);
  assert.deepEqual(out.windows, [[], [0], [], [0, 1, 2, 3, 6]], 'each window re-checks its rows, in the order given');
});

test('D153: every window that re-checks a row starts, for the row\'s session, after the row\'s after point', () => {
  const { session, windows } = plan();
  const out = recheckSelection({ session, windows, rows: entries });
  for (const row of out.rows) for (const k of row.later) {
    const own = windows[k].events.filter((event) => (event.childId ?? null) === row.actor);
    assert.ok(own.length > 0, `window ${k} holds the row's session`);
    assert.ok(own.every((event) => event.sequence > row.anchor.sequence), `window ${k} is after row ${row.at}`);
    assert.ok(row.judgedIn === null || k > row.judgedIn, 'after the window that judged it');
  }
  // And each window that holds such events and comes after is one of them (none is missed).
  for (const row of out.rows.filter((r) => r.anchor !== null)) {
    const expected = windows.map((window, k) => k).filter((k) => {
      const own = windows[k].events.filter((event) => (event.childId ?? null) === row.actor);
      return (row.judgedIn === null || k > row.judgedIn) && own.length > 0
        && own.every((event) => event.sequence > row.anchor.sequence);
    });
    assert.deepEqual(row.later, expected, `row ${row.at}`);
  }
});

test('D153: the selection reads no word — the same structure with other text selects the same', () => {
  const { session, windows } = plan();
  const reworded = entries.map((entry) => ({ ...entry, row: JSON.parse(JSON.stringify(entry.row)
    .replace(/"quote":"[^"]*"/g, '"quote":"other words"').replace(/"text":"[^"]*"/g, '"text":"other words"')) }));
  assert.deepEqual(recheckSelection({ session, windows, rows: reworded }),
    recheckSelection({ session, windows, rows: entries }));
});

test('D153: one window, or windows planned by planWindows directly, or nothing to read', () => {
  const { session } = plan();
  const windows = planWindows(session, reviewRun.planWindowRequests({ session, reviewScope: 'session-only' }).settings);
  assert.deepEqual(recheckSelection({ session, windows, rows: entries }).windows, [[], [0], [], [0, 1, 2, 3, 6]]);
  const one = recheckSelection({ session, windows: [windows[0]], rows: [entries[0]] });
  assert.deepEqual(one.rows.map((r) => r.outcome), ['no_later_work'], 'a review of one window re-checks nothing');
  assert.deepEqual(recheckSelection({ session, windows, rows: null }), { rows: [], windows: [[], [], [], []] });
  assert.deepEqual(recheckSelection({ session: null, windows: null, rows: [null, 3, entries[0]] }),
    { rows: [{ at: 2, source: 'requirements', index: 0, kind: 'ask_partly_done', anchor: null, actor: undefined,
      judgedIn: null, later: [], launched: [], outcome: 'not_placed' }], windows: [] }, 'never throws on what it is given');
});

test('D153: a helper the row\'s session launched after it, with work after it, is later work no window re-checks', () => {
  const rows = [
    // Its last receipt (C1) comes before the launch (D1): the helper's work is after it.
    { source: 'requirements', index: 0, row: ask('I1', 'partly-done', { deliverable: receipt('ED1', 'code', 'return name'),
      shortfall: receipt('C1', 'commentary', 'I did not add a test') }) },
    // Its last receipt is the launch itself: the helper's work is recorded after it.
    { source: 'requirements', index: 1, row: ask('I1', 'not-done', { shortfall: receipt('D1', 'action', 'check the docs') }) },
    // Its last receipt (C9) comes after the helper's work.
    { source: 'requirements', index: 2, row: ask('I1', 'not-done', { shortfall: receipt('C9', 'commentary', 'The changelog') }) },
    // The helper's own row: its later window re-checks it, as before.
    { source: 'findings', index: 0, row: claim([receipt('WC', 'commentary', 'The docs'), receipt('WC', 'commentary', 'docs')]) },
  ];
  const run = (link) => {
    const session = launchSession({ link });
    const { windows } = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
    assert.deepEqual(windows.map((w) => w.parts.map((part) => [part.session.childId, part.events[0].id])),
      [[[null, 'I1']], [['w', 'B1']], [['w', 'WC2']]], 'no window of the main agent follows its first');
    return recheckSelection({ session, windows, rows }).rows.map((r) => [r.later, r.launched, r.outcome]);
  };
  assert.deepEqual(run('verified'), [[[], ['w'], 'not_checked_after_later_work'],
    [[], ['w'], 'not_checked_after_later_work'], [[], [], 'no_later_work'], [[2], [], null]]);
  // A helper whose launch is not verified (C-03) names no launch: nothing is inferred.
  assert.deepEqual(run('unresolved'), [[[], [], 'no_later_work'], [[], [], 'no_later_work'], [[], [], 'no_later_work'],
    [[2], [], null]]);
  // By recorded order and the verified launch only: the same structure with other words gives the same.
  const session = launchSession();
  const { windows } = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  const reworded = rows.map((entry) => ({ ...entry, row: JSON.parse(JSON.stringify(entry.row)
    .replace(/"quote":"[^"]*"/g, '"quote":"other words"')) }));
  assert.deepEqual(recheckSelection({ session, windows, rows: reworded }), recheckSelection({ session, windows, rows }));
});

test('D153: only a helper the row\'s own session launched counts as its later work', () => {
  const session = twoHelpersSession();
  const { windows } = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  assert.deepEqual(windows.map((w) => w.parts.map((part) => [part.session.childId, part.session.launchedBy])),
    [[[null, null], ['w', 'D1']], [['v', 'D2']]]);
  const rows = [
    // Helper w's words, before the main agent launched helper v: v is not w's.
    { source: 'findings', index: 0, row: claim([receipt('WC', 'commentary', 'The docs'), receipt('WC', 'commentary', 'docs')]) },
    // The main agent's words, before it launched v (and after it launched w).
    { source: 'requirements', index: 0, row: ask('I1', 'not-done', { shortfall: receipt('C5', 'commentary', 'I did not') }) },
  ];
  assert.deepEqual(recheckSelection({ session, windows, rows }).rows.map((r) => [r.actor, r.launched, r.outcome]),
    [['w', [], 'no_later_work'], [null, ['v'], 'not_checked_after_later_work']]);
});

test('D153: a helper launched before the row whose work is recorded after it is later work too (its history is placed where it was received)', () => {
  const session = backgroundSession();
  const { windows } = reviewRun.planWindowRequests({ session, reviewScope: 'session-only' });
  assert.deepEqual(windows.map((w) => w.parts.map((part) => [part.session.childId, part.events[0].id])),
    [[[null, 'I1']], [['w', 'B1']], [['w', 'WC2']]]);
  assert.ok(session.event('D1').sequence < session.event('C1').sequence, 'launched before the row\'s after point');
  assert.ok(session.event('B1').sequence > session.event('C1').sequence, 'its work recorded after it');
  const rows = [{ source: 'requirements', index: 0, row: ask('I1', 'partly-done', { deliverable: receipt('ED1', 'code',
    'return name'), shortfall: receipt('C1', 'commentary', 'I did not add a test') }) }];
  assert.deepEqual(recheckSelection({ session, windows, rows }).rows.map((r) => [r.later, r.launched, r.outcome]),
    [[[], ['w'], 'not_checked_after_later_work']]);
  // Without the helper's session record (no verified launch), nothing is inferred.
  const bare = windows.map((w) => ({ ...w, session: null, parts: w.parts.map((part) => ({ ...part, session: null })) }));
  assert.deepEqual(recheckSelection({ session, windows: bare, rows }).rows.map((r) => r.outcome), ['no_later_work']);
});
