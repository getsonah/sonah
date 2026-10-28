// D153: a synthetic recording of four windows for the after-point re-check's selection and request. Three hold the main
// agent's work, one per human message, each split off by size alone; two hold the work of a helper the second message's
// work launched: one of its own, and its last message, packed beside the main agent's last message (D68 K). No
// recording, no model, no network.
import { Session } from '../src/session.js';
import { bytesOfTokens } from '../src/windows.js';

export const KEY = 'sess-d153-recheck';

export const TEXT = Object.freeze({
  ask1: 'SYNTHETIC_R_ASK1: fix greet.js so empty names give the guest greeting, and add a test for it.',
  ask2: 'SYNTHETIC_R_ASK2: ask a helper to check the docs, then update the changelog.',
  ask3: 'SYNTHETIC_R_ASK3: now add the missing test.',
  brief: 'SYNTHETIC_R_BRIEF: check the docs for the greeting.',
  edit1: 'return name || "guest"',
  run3: 'node --test test/greet.test.js',
  out3: 'SYNTHETIC_R_OUT3: ok 1 - empty name gives the guest greeting',
  said1: 'SYNTHETIC_R_SAID1: Fixed greet.js; I did not add a test yet.',
  said2: 'SYNTHETIC_R_SAID2: The changelog is not updated.',
  helperSaid: 'SYNTHETIC_R_HELPER: The docs mention the guest greeting.',
  helperSaid2: 'SYNTHETIC_R_HELPER2: Done checking.',
  cat: 'cat /srv/r/big.log',
  big: 'y'.repeat(bytesOfTokens(3_000)),
  // Step 4: a statement written into a file, a test run that fails and one that passes, the agent's claims, and the
  // later edit that replaces the statement.
  readme1: 'SYNTHETIC_R_README: Empty names get the guest greeting.\n',
  readme2: 'SYNTHETIC_R_README: Empty names are refused with an error.\n',
  readme3: 'SYNTHETIC_R_README: Empty names get the guest greeting. See greet.js.\n',
  testRun: 'npm test',
  testFail: 'SYNTHETIC_R_FAIL: not ok 1 - empty name gives the guest greeting',
  testPass: 'SYNTHETIC_R_PASS: ok 1 - empty name gives the guest greeting',
  claim1: 'SYNTHETIC_R_CLAIM1: All tests pass.',
  claim2: 'SYNTHETIC_R_CLAIM2: Fixed it: all tests pass now.',
  updated: 'The file has been updated.',
});

/**
 * The session from `rows`: [id, kind, blobKey, extra]. Kinds: ask, brief (a helper's assignment), delegate (a Task
 * hand-off; the helper is `w`), edit (an Edit whose written text is the blob), cmd (a Bash command), out (its result;
 * extra.of names the command), said (the agent's words), filler (60 results of a `cat`, each 3k tokens: more work than
 * one window holds). `extra.child` places the event in helper `w`'s session. Step 4: an edit of `extra.path` (else
 * greet.js) that replaced the text `extra.replaced` names, write (a whole body of `extra.path`), fail (a failed result
 * of the command `extra.of` names).
 */
export function build(rows, { link = 'verified' } = {}) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const events = [];
  for (const [id, kind, key, extra = {}] of rows) {
    const child = extra.child === true ? 'w' : extra.child;
    const where = child ? { childId: child, turn: `child:${child}:T1` } : { turn: extra.turn ?? 'T1' };
    if (kind === 'filler') {
      events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [], command: ref('cat'),
        input: [], changes: [], ...where });
      for (let k = 0; k < 60; k++) events.push({ id: `${id}-r${k}`, kind: 'observation', invocation: id, callKey: id,
        phase: 'progress', result: 'succeeded', exitCode: null, output: ref('big'), sourceOfResult: 'native', ...where });
    } else if (kind === 'ask') events.push({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...where });
    else if (kind === 'brief') events.push({ id, kind: 'instruction', authority: 'agent', supersedes: [], text: ref(key), ...where });
    else if (kind === 'delegate') events.push({ id, kind: 'invocation', callKey: id, tool: 'Task', operation: 'delegate',
      paths: [], command: [], input: ref(key), changes: [], ...where });
    else if (kind === 'edit') events.push({ id, kind: 'invocation', callKey: id, tool: 'Edit', operation: 'edit',
      paths: [extra.path ?? '/srv/r/greet.js'], command: [], input: [], changes: [{ path: extra.path ?? '/srv/r/greet.js',
        after: ref(key), ...(extra.replaced ? { replaced: ref(extra.replaced) } : {}) }], ...where });
    // Step 4: a structured write of a whole body (`extra.path`).
    else if (kind === 'write') events.push({ id, kind: 'invocation', callKey: id, tool: 'Write', operation: 'write',
      paths: [extra.path], command: [], input: [], changes: [{ path: extra.path, after: ref(key) }], ...where });
    // Step 4: a result that failed (`extra.of` names the command).
    else if (kind === 'fail') events.push({ id, kind: 'observation', invocation: extra.of, callKey: extra.of,
      phase: 'terminal', result: 'failed', exitCode: 1, terminalStatusProven: true, output: ref(key),
      sourceOfResult: 'native', ...where });
    else if (kind === 'cmd') events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command', paths: [],
      command: ref(key), input: [], changes: [], ...where });
    else if (kind === 'out') events.push({ id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      result: 'succeeded', exitCode: 0, terminalStatusProven: true, output: ref(key), sourceOfResult: 'native', ...where });
    else events.push({ id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key), ...where });
  }
  // Each hand-off launches the helper its `extra.launches` names (`w` unless named).
  const children = rows.filter(([, kind]) => kind === 'delegate').map(([id, , , extra = {}]) => ({ assignmentEvent: id,
    childId: extra.launches ?? 'w', childSession: `${KEY}/child:${extra.launches ?? 'w'}`,
    sessionKey: `${KEY}/child:${extra.launches ?? 'w'}`, relation: 'spawn', state: link, historyStart: null }));
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT },
    events: events.map((event, sequence) => ({ ...event, sequence })), children });
}

/** The four-window session: the main agent's three human messages, and the helper the second one's work launched. */
export const recheckSession = () => build([
  ['I1', 'ask', 'ask1'], ['ED1', 'edit', 'edit1'], ['C1', 'said', 'said1'], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }], ['D1', 'delegate', 'brief', { turn: 'T2' }],
  ['B1', 'brief', 'brief', { child: true }], ['WC', 'said', 'helperSaid', { child: true }], ['WF1', 'filler', 'cat', { child: true }],
  ['WF2', 'filler', 'cat', { child: true }], ['WC2', 'said', 'helperSaid2', { child: true }],
  ['C2', 'said', 'said2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
  ['I3', 'ask', 'ask3', { turn: 'T3' }], ['A3', 'cmd', 'run3', { turn: 'T3' }],
  ['A3-r', 'out', 'out3', { of: 'A3', turn: 'T3' }], ['F3', 'filler', 'cat', { turn: 'T3' }],
]);

/** D153: the main agent's one message, whose work ends by launching a helper; the helper's work fills
 *  two windows of its own after the main agent's, and no window of the main agent follows (`link`: the helper link's
 *  state, verified unless named). */
export const launchSession = ({ link = 'verified' } = {}) => build([
  ['I1', 'ask', 'ask1'], ['ED1', 'edit', 'edit1'], ['C1', 'said', 'said1'], ['D1', 'delegate', 'brief'],
  ['B1', 'brief', 'brief', { child: true }], ['WC', 'said', 'helperSaid', { child: true }],
  ['WF1', 'filler', 'cat', { child: true }], ['WF2', 'filler', 'cat', { child: true }],
  ['WC2', 'said', 'helperSaid2', { child: true }], ['C9', 'said', 'said2'],
], { link });

/** D153: the main agent launches helper `w`, then, after `w`'s work, helper `v`; no window of the main agent or of `w`
 *  follows `w`'s own. */
export const twoHelpersSession = () => build([
  ['I1', 'ask', 'ask1'], ['D1', 'delegate', 'brief'],
  ['B1', 'brief', 'brief', { child: true }], ['WC', 'said', 'helperSaid', { child: true }],
  ['WF1', 'filler', 'cat', { child: true }],
  ['C5', 'said', 'said1'], ['D2', 'delegate', 'brief', { launches: 'v' }],
  ['B2', 'brief', 'brief', { child: 'v' }], ['VF', 'filler', 'cat', { child: 'v' }],
]);

/** D153: the main agent launches helper `w`, says the ask is not done, and ends its turn; `w`'s history is recorded after
 *  that (the adapter places a helper's history where its parent received its work, not at its launch), in windows of its
 *  own; no window of the main agent follows. */
export const backgroundSession = () => build([
  ['I1', 'ask', 'ask1'], ['ED1', 'edit', 'edit1'], ['D1', 'delegate', 'brief'], ['C1', 'said', 'said1'],
  ['B1', 'brief', 'brief', { child: true }], ['WC', 'said', 'helperSaid', { child: true }],
  ['WF1', 'filler', 'cat', { child: true }], ['WF2', 'filler', 'cat', { child: true }],
  ['WC2', 'said', 'helperSaid2', { child: true }],
]);

export const receipt = (eventId, role, quote) => ({ eventId, role, quote });

/** D153: two windows of the main agent. w1: the agent writes a statement into README.md, runs the tests, which
 *  fail, and claims they pass. w2: it edits README.md (`edit2`: the edit's rows, by default one that replaces the
 *  statement, with its result), runs the tests, which pass, and says so. */
export const correctionSession = ({ edit2 = [['ED2', 'edit', 'readme2', { path: README, replaced: 'readme1',
  turn: 'T2' }], ['ED2-r', 'out', 'updated', { of: 'ED2', turn: 'T2' }]], pass = 'out' } = {}) => build([
  ['I1', 'ask', 'ask1'], ['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
  ['A1', 'cmd', 'testRun'], ['A1-r', 'fail', 'testFail', { of: 'A1' }], ['C1', 'said', 'claim1'], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }], ...edit2, ['A2', 'cmd', 'testRun', { turn: 'T2' }],
  ['A2-r', pass, pass === 'fail' ? 'testFail' : 'testPass', { of: 'A2', turn: 'T2' }],
  ['C2', 'said', 'claim2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }]]);
export const README = '/srv/r/README.md';

/** D153: three windows of the main agent. w1 writes a statement into README.md, runs the tests, which fail, and claims
 *  they pass; w2 says the changelog is not updated; w3 replaces the statement, runs the tests, which pass, and says so. */
export const laterCorrectionSession = () => build([
  ['I1', 'ask', 'ask1'], ['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
  ['A1', 'cmd', 'testRun'], ['A1-r', 'fail', 'testFail', { of: 'A1' }], ['C1', 'said', 'claim1'], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }], ['C2', 'said', 'said2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
  ['I3', 'ask', 'ask3', { turn: 'T3' }],
  ['ED2', 'edit', 'readme2', { path: README, replaced: 'readme1', turn: 'T3' }],
  ['ED2-r', 'out', 'updated', { of: 'ED2', turn: 'T3' }], ['A2', 'cmd', 'testRun', { turn: 'T3' }],
  ['A2-r', 'out', 'testPass', { of: 'A2', turn: 'T3' }], ['C3', 'said', 'claim2', { turn: 'T3' }],
  ['F3', 'filler', 'cat', { turn: 'T3' }]]);

/** D153: three windows of the main agent. w1 writes a statement into README.md, runs the tests, which fail, and claims
 *  they pass; w2 replaces the statement, runs the tests, which pass (or, `w2Fails`, fail), and says so; w3 runs the
 *  tests again — they fail (`fails`) or pass — then, with `recovers`, runs them once more, they pass and it says so,
 *  and writes the statement back (`putBack`) or does not. */
export const recontradictionSession = ({ fails = true, putBack = true, recovers = false, w2Fails = false } = {}) => build([
  ['I1', 'ask', 'ask1'], ['WR1', 'write', 'readme1', { path: README }], ['WR1-r', 'out', 'updated', { of: 'WR1' }],
  ['A1', 'cmd', 'testRun'], ['A1-r', 'fail', 'testFail', { of: 'A1' }], ['C1', 'said', 'claim1'], ['F1', 'filler'],
  ['I2', 'ask', 'ask2', { turn: 'T2' }],
  ['ED2', 'edit', 'readme2', { path: README, replaced: 'readme1', turn: 'T2' }],
  ['ED2-r', 'out', 'updated', { of: 'ED2', turn: 'T2' }], ['A2', 'cmd', 'testRun', { turn: 'T2' }],
  ['A2-r', w2Fails ? 'fail' : 'out', w2Fails ? 'testFail' : 'testPass', { of: 'A2', turn: 'T2' }],
  ['C2', 'said', 'claim2', { turn: 'T2' }], ['F2', 'filler', 'cat', { turn: 'T2' }],
  ['I3', 'ask', 'ask3', { turn: 'T3' }], ['A3', 'cmd', 'testRun', { turn: 'T3' }],
  ['A3-r', fails ? 'fail' : 'out', fails ? 'testFail' : 'testPass', { of: 'A3', turn: 'T3' }],
  ...(recovers ? [['A4', 'cmd', 'testRun', { turn: 'T3' }], ['A4-r', 'out', 'testPass', { of: 'A4', turn: 'T3' }],
    ['C4', 'said', 'claim2', { turn: 'T3' }]] : []),
  ...(putBack ? [['WR3', 'write', 'readme1', { path: README, turn: 'T3' }], ['WR3-r', 'out', 'updated',
    { of: 'WR3', turn: 'T3' }]] : []),
  ['F3', 'filler', 'cat', { turn: 'T3' }]]);
