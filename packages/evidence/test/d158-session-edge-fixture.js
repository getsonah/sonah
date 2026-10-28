// D158: a synthetic recording for the session's edge maps (struggle.js, claims.js `claimsAgainstRuns`). The main agent
// runs the tests, which fail naming two files; it edits one, runs them again (they fail naming the test file), edits
// that, and they pass; it says so in its turn's last message, then changes README.md, runs a search that fails, hands
// work to a helper, and changes CHANGELOG.md; a run of the tests the person refused follows. The helper's command fails
// naming its file; it edits the file (a result read from output, so the edit's effect is not proved) and runs the
// command again, with no typed end. No recording, no model, no network.
import { Session } from '../src/session.js';

export const KEY = 'sess-d158-edge';

export const TEXT = Object.freeze({
  ask: 'SYNTHETIC_E_ASK: fix greet.js so empty names get the guest greeting, with a test.',
  test: 'npm test',
  fail1: 'not ok 1 - empty name\n  at greet (src/greet.js:3:9)\n  at test/greet.test.js:5:3',
  fail2: 'not ok 1 - test/greet.test.js expects "Guest"',
  pass: 'ok 1 - empty name gets the guest greeting',
  greet: 'return name || "guest";',
  greetTest: 'assert.equal(greet(""), "Hello, guest");',
  readme: 'Empty names get the guest greeting.',
  changelog: '- Empty names get the guest greeting.',
  grep: 'grep -rn guest docs',
  said: 'SYNTHETIC_E_SAID: All tests pass.',
  brief: 'SYNTHETIC_E_BRIEF: make lib/x.js print its name.',
  helperRun: 'node lib/x.js',
  helperFail: 'Error: lib/x.js:1 unexpected token',
  helperEdit: 'console.log("x");',
  helperOut: 'x',
  helperSaid: 'SYNTHETIC_E_HELPER: Done.',
  updated: 'The file has been updated.',
  saidLast: 'SYNTHETIC_E_LAST: Changelog updated.',
  working: 'SYNTHETIC_E_WORKING: The tests pass; now the docs.',
  // A command that writes a file and runs the tests, a run whose output is piped, and another command that exits 0.
  sedTest: 'sed -i \'s/name/name || "guest"/\' src/greet.js && node --test test/greet.test.js',
  sedUtil: 'sed -i \'s/a/b/\' src/util.js && node --test',
  teeRun: 'npm test 2>&1 | tee out.txt',
  status: 'git status --short',
  piped: 'not ok 1 - empty name\n# pass 0\n# fail 1',
});

/**
 * The session from `rows`: [id, kind, key, extra]. Kinds: ask (the person's words), brief (a helper's assignment),
 * delegate (a hand-off to helper `w`), said (the agent's words; `extra.phase`), cmd (a command; `extra.denial` the
 * recorder's denial kind), edit (an edit of `extra.path`; `extra.outside` marks it outside the repository), parsed (a
 * write of `extra.path` the slicer parsed from the command `extra.of` names, `shellWriteOf`), ok (a typed exit 0 of the
 * call `extra.of` names), fail (a typed exit 1), untyped (a result read from output: no exit code, its status parsed),
 * uncovered (a typed exit 0 that does not cover every command of its line: a pipeline). `extra.child` places the event
 * in helper `w`'s session.
 */
export function build(rows) {
  const ref = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(TEXT[key], 'utf8') }];
  const events = [];
  for (const [id, kind, key, extra = {}] of rows) {
    const where = extra.child ? { childId: 'w', turn: 'child:w:T1' } : { turn: extra.turn ?? 'T1' };
    const result = (fields) => ({ id, kind: 'observation', invocation: extra.of, callKey: extra.of, phase: 'terminal',
      output: ref(key), ...fields, ...where });
    if (kind === 'ask') events.push({ id, kind: 'instruction', authority: 'human', supersedes: [], text: ref(key), ...where });
    else if (kind === 'brief') events.push({ id, kind: 'instruction', authority: 'agent', supersedes: [], text: ref(key),
      ...where });
    else if (kind === 'delegate') events.push({ id, kind: 'invocation', callKey: id, tool: 'Task', operation: 'delegate',
      paths: [], command: [], input: ref(key), changes: [], ...where });
    else if (kind === 'cmd') events.push({ id, kind: 'invocation', callKey: id, tool: 'Bash', operation: 'command',
      paths: [], command: ref(key), input: [], changes: [], ...(extra.denial ? { recorded: { denial: extra.denial } } : {}),
      ...where });
    else if (kind === 'edit') events.push({ id, kind: 'invocation', callKey: id, tool: 'Edit', operation: 'edit',
      paths: [extra.path], command: [], input: [], changes: [{ path: extra.path, after: ref(key),
        ...(extra.outside ? { outsideRepository: true } : {}) }], ...where });
    else if (kind === 'parsed') events.push({ id, kind: 'invocation', callKey: extra.of, tool: 'Bash', operation: 'write',
      shellWriteOf: extra.of, shellWriteStatusEligible: true, paths: [extra.path], command: [], input: [],
      changes: [{ path: extra.path, after: ref(key) }], ...where });
    else if (kind === 'ok') events.push(result({ result: 'succeeded', exitCode: 0, terminalStatusProven: true,
      sourceOfResult: 'native' }));
    else if (kind === 'uncovered') events.push(result({ result: 'unknown', exitCode: 0, terminalStatusProven: true,
      sourceOfResult: 'native', lastStatus: { exitCode: 0, verdict: null }, coversAll: false, statusGap: 'pipeline' }));
    else if (kind === 'fail') events.push(result({ result: 'failed', exitCode: 1, terminalStatusProven: true,
      sourceOfResult: 'native' }));
    else if (kind === 'untyped') events.push(result({ result: 'succeeded', exitCode: null, terminalStatusProven: false,
      sourceOfResult: 'parsed-output' }));
    else events.push({ id, kind: 'commentary', phase: extra.phase ?? 'working', beforeInvocation: null, text: ref(key),
      ...where });
  }
  const children = rows.some(([, kind]) => kind === 'delegate') ? [{ assignmentEvent: 'D1', childId: 'w',
    childSession: `${KEY}/child:w`, sessionKey: `${KEY}/child:w`, relation: 'spawn', state: 'verified',
    historyStart: null }] : [];
  return new Session({ sessionKey: KEY, adapter: 'claude', blobs: { ...TEXT },
    events: events.map((event, sequence) => ({ ...event, sequence })), children });
}

export const ROWS = Object.freeze([
  ['I1', 'ask', 'ask'],
  ['A1', 'cmd', 'test'], ['A1-r', 'fail', 'fail1', { of: 'A1' }],
  ['ED1', 'edit', 'greet', { path: 'src/greet.js' }], ['ED1-r', 'ok', 'updated', { of: 'ED1' }],
  ['A2', 'cmd', 'test'], ['A2-r', 'fail', 'fail2', { of: 'A2' }],
  ['ED2', 'edit', 'greetTest', { path: 'test/greet.test.js' }], ['ED2-r', 'ok', 'updated', { of: 'ED2' }],
  ['A3', 'cmd', 'test'], ['A3-r', 'ok', 'pass', { of: 'A3' }],
  ['C0', 'said', 'working'],
  ['C1', 'said', 'said', { phase: 'final' }],
  ['ED3', 'edit', 'readme', { path: 'README.md' }], ['ED3-r', 'ok', 'updated', { of: 'ED3' }],
  ['A4', 'cmd', 'grep'], ['A4-r', 'fail', 'pass', { of: 'A4' }],
  ['D1', 'delegate', 'brief'],
  ['B1', 'brief', 'brief', { child: true }],
  ['WA1', 'cmd', 'helperRun', { child: true }], ['WA1-r', 'fail', 'helperFail', { of: 'WA1', child: true }],
  ['WE1', 'edit', 'helperEdit', { path: 'lib/x.js', child: true }],
  ['WE1-r', 'untyped', 'updated', { of: 'WE1', child: true }],
  ['WA2', 'cmd', 'helperRun', { child: true }], ['WA2-r', 'untyped', 'helperOut', { of: 'WA2', child: true }],
  ['WC', 'said', 'helperSaid', { child: true, phase: 'final' }],
  ['ED4', 'edit', 'changelog', { path: 'CHANGELOG.md' }], ['ED4-r', 'ok', 'updated', { of: 'ED4' }],
  ['A5', 'cmd', 'test', { denial: 'user-rejected' }], ['A5-r', 'fail', 'fail2', { of: 'A5' }],
  ['C2', 'said', 'saidLast', { phase: 'final' }],
]);

export const edgeSession = (rows = ROWS) => build(rows);

export const receipt = (eventId, role, quote) => ({ eventId, role, quote });
/** A verified claim on C1's words, supported by the passing run's result. */
export const VERIFIED = Object.freeze({ id: 'p:verified', stated: receipt('C1', 'commentary', 'All tests pass.'),
  text: 'all tests pass', status: 'verified',
  receipts: [receipt('C1', 'commentary', 'All tests pass.'), receipt('A3-r', 'observation', 'ok 1 - empty name')] });
/** The same support, on words that are not the last message of their turn (C0). */
export const WORKING = Object.freeze({ id: 'p:working', stated: receipt('C0', 'commentary', 'The tests pass'),
  text: 'the tests pass', status: 'verified',
  receipts: [receipt('C0', 'commentary', 'The tests pass'), receipt('A3-r', 'observation', 'ok 1 - empty name')] });
/** A verified claim in the last message, on a result after which no edit is recorded (A5-r). */
export const NO_EDIT_AFTER = Object.freeze({ id: 'p:last', stated: receipt('C2', 'commentary', 'Changelog updated.'),
  text: 'the changelog is updated', status: 'verified',
  receipts: [receipt('C2', 'commentary', 'Changelog updated.'), receipt('A5-r', 'observation', 'not ok 1')] });
