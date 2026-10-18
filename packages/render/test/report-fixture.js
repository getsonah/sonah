// The report model's fixtures (D97): one synthetic session and its review report in six shapes, for the
// report model, the placement test and the page. Every string, path, command, hash and id here is invented.
//
//   (a) `triagedReport`   a code step like code-pass/10: triage entries, files with +/- counts, notes and asks, a
//                         finding's anchor span, a dropped note, every item kind of D97 at least once,
//                         a promise folded into a contradiction finding, a confirmed promise a `claim_false` contradicts,
//                         a disclosed edit, a passed-over refusal of a read (a tool that is no command), and a call refused by
//                         each of `user-rejected`, `permission-rule` and `automode-blocked`;
//   (b) `untriagedReport` the same as code-pass/9 wrote it: no triage, no counts, no notes;
//   (c) `sessionOnlyReport` the same with no code step;
//   (d) `codePass3Report` a code step of code-pass/3: questions with no `from`, `id` or `check`, its `rejected`, `groups`,
//                         `votes` and `codeStatus`, and rows marked `shown-in-code`;
//   (e) `codePass8Report` a code step of code-pass/8: `held`, a withheld entry of what `held`, a deleted file and a file
//                         outside the root with no `sha256`;
//   (f) `codePass1Report` a code step of code-pass/1: one finding of kind `code_issue`.
import { createHash } from 'node:crypto';
import { sessionBuilder, STORY_KEY } from './session-story-fixture.js';

export const REPORT_TEXT = Object.freeze({
  ask1: 'Add rate limiting to the API. Return 429 with a Retry-After header in seconds. Keep the auth checks before the '
    + 'limiter. Do not change the CI config. Update the README.',
  ask2: 'Also add a test for the limiter.',
  ask3: 'Thanks, that is all.',
  plan: 'I will use a token bucket. I will not add Redis, an in-process bucket is enough.',
  pivot: 'The Redis store needs a server, so I am switching to an in-process token bucket.',
  limiter: 'export function limiter(rate) {\n  let tokens = rate;\n  refill();\n  return (req, res, next) => {\n'
    + '    if (tokens < 1) return res.status(429).set("Retry-After", 1000).end();\n    tokens -= 1;\n    next();\n  };\n}\n',
  server: 'app.use(auth());\napp.use(limiter(10));\n',
  serverBefore: 'app.use(auth());\n',
  ci: 'run: npm test --silent\n',
  ciBefore: 'run: npm test\n',
  readme: 'Rate limiting is enabled by default.\n',
  readmeBefore: 'A small API.\n',
  docs: 'The limiter answers with 503 when it is full.\n',
  readmeClaim: 'The README said version 3 before my edit.',
  final: 'Done: rate limiting works and all tests pass. The limiter uses Redis. I reverted the CI change. '
    + 'I told you that I changed the CI file. The auth checks stay before the limiter.',
  testsFailed: 'FAIL test/limiter.test.js\nTests: 1 failed, 4 passed',
  lint: 'lint ok',
  redis: 'connect ECONNREFUSED 127.0.0.1:6379',
});
const T = REPORT_TEXT;
const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });
const id = (c) => `sha256:${c.repeat(64).slice(0, 64)}`;
const sha = (text) => createHash('sha256').update(text).digest('hex');
export const HEAD = '1'.repeat(40);
export const START = '2'.repeat(40);

/** A tool call of any kind, its result as given (`recorded`: the recorder's typed facts on the call). */
function call(b, callId, { tool, operation = 'other', command = null, paths = [], recorded = null, result = 'unknown',
  output = '', exitCode = null, proven = false }) {
  const put = (text) => {
    const key = `${callId}-${b.events.length}`;
    b.blobs[key] = text;
    return [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  b.events.push({ sequence: b.events.length, id: callId, kind: 'invocation', callKey: callId, tool, operation,
    paths: paths.map((path) => ({ path })), command: command === null ? [] : put(command), input: [], changes: [],
    ...(recorded ? { recorded } : {}) });
  b.events.push({ sequence: b.events.length, id: `${callId}-r`, kind: 'observation', invocation: callId, callKey: callId,
    phase: 'terminal', result, exitCode, terminalStatusProven: proven, output: output ? put(output) : [],
    sourceOfResult: 'native' });
}

/** The session every report shape reviews. */
export function reportSession() {
  const b = sessionBuilder();
  b.ask('I1', T.ask1);
  b.say('C1', T.plan);
  b.run('R0', 'redis-server --version', 'failed', T.redis);
  b.say('C2', T.pivot);
  b.change('W1', 'src/limiter.js', { after: T.limiter });
  b.change('W2', 'src/server.js', { operation: 'edit', before: T.serverBefore, after: T.server, priorState: 'edit-text' });
  b.change('W3', '.github/workflows/ci.yml', { operation: 'edit', before: T.ciBefore, after: T.ci, priorState: 'edit-text' });
  b.change('W4', 'README.md', { operation: 'edit', before: T.readmeBefore, after: T.readme, priorState: 'edit-text' });
  b.change('W5', 'docs/limits.md', { after: T.docs });
  b.say('C3', T.readmeClaim);
  b.run('R1', 'npm test', 'failed', T.testsFailed);
  // A Read as the adapter spells it (evidence session.js READ_TOOLS: `tool: 'read'`, `operation: 'other'`).
  call(b, 'X1', { tool: 'read', paths: ['secrets/.env'], recorded: { denial: 'permission-rule' }, result: 'failed' });
  call(b, 'X2', { tool: 'Bash', operation: 'command', command: 'rm -rf dist', recorded: { denial: 'automode-blocked' },
    result: 'failed' });
  call(b, 'X3', { tool: 'Bash', operation: 'command', command: 'git push --force', recorded: { denial: 'user-rejected' },
    result: 'failed' });
  call(b, 'X4', { tool: 'Bash', operation: 'command', command: 'curl -X POST https://example.invalid/deploy',
    recorded: { denial: 'permission-rule' }, result: 'failed' });
  b.run('R2', 'npm run lint', 'succeeded', T.lint);
  b.say('F1', T.final, 'final');
  b.ask('I2', T.ask2);
  b.say('F2', 'I added no test yet.', 'final');
  b.ask('I3', T.ask3);
  return b.session();
}
/** Every event of the session, in one review window. */
const windowIds = (session) => session.events.map((event) => event.id);

const decided = (fields) => ({ actorSession: STORY_KEY, dimension: 'store', chosen: 'a store', value: null,
  valueReceipt: null, valueState: 'unchecked', actions: [], stated: null, constrainedBy: null, instructionReview: null,
  column: 'unasked', columnState: 'grounded', amends: [], materiality: 'structural', materialityRule: 'synthetic',
  relevance: 'unchecked', reasons: [], ...fields });

/** A code receipt of a file's text: its lines `from` to `to` (1-based), the span stored with the file's hash. */
function codeReceipt(path, text, from, to, quote, side = 'new') {
  const span = text.split('\n').slice(from - 1, to).join('\n');
  return { eventId: `file:${path}`, role: 'code', side, quote, path, startLine: from, endLine: to, sha256: sha(text), span };
}

/** The session review's rows, shared by every shape. */
function sessionRows(session) {
  const ask = (quote, status, extra = {}) => ({ text: quote, instruction: receipt('instruction', 'I1', quote), status,
    ...extra });
  return {
    reviewScope: 'session-only', coverage: 'complete', sessionReview: 'complete', sessionStatus: 'DECIDE',
    promptVersion: 'sonah.narrative/37',
    windowResults: [{ windowIndex: 0, eventIds: windowIds(session), failure: null,
      narrative: { requirements: [] }, challenge: { complete: true }, groundingComplete: true }],
    requirements: [
      ask('Add rate limiting to the API', 'done', { deliverable: receipt('code', 'W1', 'export function limiter(rate)') }),
      ask('Return 429 with a Retry-After header in seconds', 'not-done',
        { shortfall: receipt('code', 'W1', 'set("Retry-After", 1000)') }),
      ask('Keep the auth checks before the limiter', 'done',
        { deliverable: receipt('commentary', 'F1', 'The auth checks stay before the limiter.') }),
      ask('Do not change the CI config', 'partly-done', { deliverable: receipt('commentary', 'F1', 'I reverted the CI change.'),
        shortfall: receipt('code', 'W3', 'run: npm test --silent') }),
      // D101: a row the quote gate lowered carries the cause of the test that refused its quote, and code's numbers.
      ask('Update the README', 'not-checked', { reason: 'deliverable_ungrounded', cause: 'quote_over_limit',
        quoteLength: { chars: 134, counted: 134, limit: 120 }, quotePlace: 'cited' }),
      { text: 'Also add a test for the limiter', instruction: receipt('instruction', 'I2', 'Also add a test for the limiter'),
        status: 'not-done', shortfall: receipt('commentary', 'F2', 'I added no test yet.') },
      { instruction: receipt('instruction', 'I1', 'Update the README'), status: 'not-checked' },
    ],
    promises: [
      { id: id('a'), stated: receipt('commentary', 'F1', 'all tests pass'), text: 'All tests pass', status: 'open',
        receipts: [receipt('commentary', 'F1', 'all tests pass')] },
      { id: id('b'), stated: receipt('commentary', 'F1', 'rate limiting works'), text: 'Rate limiting works', status: 'open',
        receipts: [receipt('commentary', 'F1', 'rate limiting works')] },
      { id: id('c'), stated: receipt('commentary', 'F1', 'The limiter uses Redis.'), text: 'The limiter uses Redis',
        status: 'open', receipts: [receipt('commentary', 'F1', 'The limiter uses Redis.')] },
      { id: id('d'), stated: receipt('commentary', 'F1', 'I reverted the CI change.'), text: 'The CI change is reverted',
        status: 'verified', receipts: [receipt('commentary', 'F1', 'I reverted the CI change.'),
          receipt('observation', 'R2-r', 'lint ok')] },
      { id: id('e'), stated: receipt('commentary', 'C1', 'I will use a token bucket.'), text: 'A token bucket',
        status: 'incomplete', receipts: [receipt('commentary', 'C1', 'I will use a token bucket.')], restsOn: ['X2'] },
    ],
    writtenClaims: [
      { id: id('f'), stated: receipt('code', 'W4', 'Rate limiting is enabled by default.'), text: 'Enabled by default',
        label: 'unverified', receipts: [receipt('code', 'W4', 'Rate limiting is enabled by default.')] },
      { id: id('g'), stated: receipt('code', 'W5', 'The limiter answers with 503 when it is full.'),
        text: 'It answers 503', label: 'contradicted', receipts: [
          receipt('code', 'W5', 'The limiter answers with 503 when it is full.'),
          receipt('observation', 'R1-r', 'Tests: 1 failed, 4 passed')] },
    ],
    findings: [
      { id: id('h'), origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE', contradictionSource: 'result',
        title: 'Claim contradicted by a recorded result', receipts: [receipt('commentary', 'F1', 'The limiter uses Redis.'),
          receipt('observation', 'R0-r', 'connect ECONNREFUSED')] },
      { id: id('i'), origin: 'session-review', kind: 'claim_contradicted', status: 'FYI', disclosureReason: 'self_corrected',
        contradictionSource: 'file_content', title: "Claim contradicted by a file's recorded content",
        receipts: [receipt('commentary', 'C3', 'The README said version 3'), receipt('code', 'W4', 'A small API.')] },
      { id: id('j'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'DECIDE', breach: 'wrote',
        title: 'Edit against your instruction', receipts: [receipt('instruction', 'I1', 'Do not change the CI config'),
          receipt('code', 'W3', 'run: npm test --silent')] },
      { id: id('k'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'FYI', breach: 'wrote',
        disclosureReason: 'disclosed', disclosedBy: receipt('commentary', 'F1', 'I told you that I changed the CI file.'),
        title: 'Edit against your instruction', receipts: [receipt('instruction', 'I1', 'Do not change the CI config'),
          receipt('code', 'W3', 'run: npm test --silent')] },
      { id: id('l'), origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'FYI', breach: 'wrote',
        disclosureReason: 'self_corrected', title: 'Edit against your instruction',
        receipts: [receipt('instruction', 'I1', 'Do not change the CI config'), receipt('code', 'W3', 'run: npm test --silent')] },
      { id: id('m'), origin: 'code-review', kind: 'code_issue', status: 'DECIDE', title: 'An earlier code review finding',
        receipts: [receipt('code', 'W2', 'app.use(limiter(10));')] },
    ],
    decisions: [
      decided({ id: id('1'), dimension: 'store', chosen: 'no Redis', notActing: true,
        stated: receipt('commentary', 'C1', 'I will not add Redis, an in-process bucket is enough.') }),
      decided({ id: id('2'), dimension: 'deploy', chosen: 'push the branch', actions: ['X3'] }),
      decided({ id: id('3'), dimension: 'Retry-After unit', chosen: 'seconds', column: 'asked-chose', actions: ['W1'],
        stated: receipt('commentary', 'C1', 'I will use a token bucket.'),
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Return 429 with a Retry-After header in seconds'),
          settles: false, settledValueQuote: null } }),
      decided({ id: id('4'), dimension: 'limit per client', chosen: 'ten requests', column: null, columnState: 'unchecked',
        reasons: ['instructions_partial'], actions: ['W2'] }),
      decided({ id: id('5'), dimension: 'auth order', chosen: 'auth first', column: 'asked-settled', actions: ['W2'],
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Keep the auth checks before the limiter'), settles: true,
          settledValueQuote: 'Keep the auth checks before the limiter' } }),
      decided({ id: id('6'), dimension: 'build output', chosen: 'clean dist', actions: ['X2'] }),
      decided({ id: id('7'), dimension: 'deploy hook', chosen: 'call the deploy hook', actions: ['X4'] }),
    ],
    pivots: [{ abandoned: 'a Redis store', adopted: 'an in-process token bucket',
      receipts: [receipt('commentary', 'C2', 'I am switching to an in-process token bucket')] }],
    failures: [
      { eventId: 'R1-r', action: 'R1', outcome: 'ran-failed', form: 'exit', tool: 'bash', handling: 'passed-over',
        response: receipt('commentary', 'F1', 'all tests pass') },
      { eventId: 'X1-r', action: 'X1', outcome: 'did-not-run', form: 'denial', tool: 'read', handling: 'passed-over' },
      { eventId: 'X3-r', action: 'X3', outcome: 'did-not-run', form: 'denial', tool: 'Bash', handling: 'told-human',
        response: receipt('commentary', 'F1', 'I told you that I changed the CI file.') },
      { eventId: 'R0-r', action: 'R0', outcome: 'ran-failed', form: 'exit', tool: 'bash', handling: 'acted-on' },
    ],
  };
}

const FILES = Object.freeze({ limiter: { path: 'src/limiter.js', text: T.limiter }, server: { path: 'src/server.js', text: T.server },
  ci: { path: '.github/workflows/ci.yml', text: T.ci }, readme: { path: 'README.md', text: T.readme },
  docs: { path: 'docs/limits.md', text: T.docs } });

/** The code step's published findings, as code-pass/9 and /10 write them. */
function codeFindings() {
  const L = FILES.limiter;
  const step = (text, from, to, quote) => ({ step: text, source: 'file', ...codeReceipt(L.path, L.text, from, to, quote) });
  const finding = (fields) => ({ origin: 'code-review', status: 'DECIDE', scope: 'current-code', lens: 'behaviour',
    foundByLenses: ['behaviour'], claims: [], input: '', leadsFrom: [], receipts: [],
    check: { verdict: 'holds', explanation: 'The refill runs once, before any request.', receipts: [] }, ...fields });
  return [
    finding({ id: id('p'), kind: 'bug', title: 'The bucket refills before the first request',
      trace: [step('The limiter calls refill at creation.', 3, 3, 'refill();')], anchor: { path: L.path, side: 'new',
        startLine: 2, endLine: 3 }, claims: [{ text: 'refill runs at creation', verdict: 'holds' },
        { text: 'refill runs on every request', verdict: 'false' }], input: 'a burst of 11 requests',
      leadsFrom: [{ key: 'S1', kind: 'ask', source: 'requirements', index: 0, id: null }] }),
    finding({ id: id('q'), kind: 'ask_not_met', title: 'Retry-After is sent in milliseconds',
      trace: [step('The header value is 1000.', 5, 5, 'set("Retry-After", 1000)')], anchor: { path: L.path, side: 'new',
        startLine: 5, endLine: 5 }, leadsFrom: [{ key: 'S2', kind: 'ask', source: 'requirements', index: 1, id: null }] }),
    finding({ id: id('r'), kind: 'claim_false', title: 'The CI change is still there', lens: 'claims',
      trace: [{ step: 'The CI file still runs the silent tests.', source: 'file',
        ...codeReceipt(FILES.ci.path, FILES.ci.text, 1, 1, 'npm test --silent') }],
      anchor: { path: FILES.ci.path, side: 'new', startLine: 1, endLine: 1 },
      leadsFrom: [{ key: 'S9', kind: 'claim', source: 'promises', index: 3, id: id('d') }] }),
    finding({ id: id('s'), kind: 'contract_break', title: 'The server mounts the limiter after a route',
      trace: [{ step: 'The limiter is the second middleware.', source: 'file',
        ...codeReceipt(FILES.server.path, FILES.server.text, 2, 2, 'app.use(limiter(10));') }],
      anchor: { path: FILES.server.path, side: 'new', startLine: 2, endLine: 2 } }),
    finding({ id: id('t'), kind: 'weak_test', title: 'No test covers the 429 answer',
      trace: [step('Nothing calls the limiter in a test.', 5, 5, 'res.status(429)')],
      anchor: { path: L.path, side: 'new', startLine: 5, endLine: 5 } }),
    finding({ id: id('u'), kind: 'missed_case', title: 'A rate of zero lets every request through',
      trace: [step('tokens starts at rate.', 2, 2, 'let tokens = rate;')], anchor: { path: L.path, side: 'new',
        startLine: 2, endLine: 2 } }),
  ];
}
const codeQuestions = () => [
  { id: 'Q1', question: 'Should the limit be per client or global? The ask does not say.', from: 'review',
    concerns: { key: 'S12', kind: 'decision', source: 'decisions', index: 3, id: id('4') },
    quote: null, check: { verdict: 'sound', explanation: 'The code keeps one global counter.' } },
  { id: 'Q2', question: 'The limiter counts preflight requests', from: 'finding',
    finding: { title: 'The limiter counts preflight requests', kind: 'bug',
      anchor: { path: FILES.limiter.path, side: 'new', startLine: 6, endLine: 6 } },
    concerns: null, quote: null, check: { verdict: 'refuted', reason: 'not_against_goal', explanation: 'It is as written.' } },
  { id: 'Q3', question: 'Is a 429 body needed?', from: 'review', concerns: { key: 'S1', kind: 'ask',
    source: 'requirements', index: 0, id: null }, quote: null },
];
const codeWithheld = () => [
  { what: 'finding', text: 'The bucket never empties', kind: 'bug', lens: 'behaviour', reason: 'verify_refuted',
    check: { verdict: 'refuted', reason: 'incorrect', explanation: 'tokens -= 1 empties it.' } },
];
const filesOf = (counts = true) => [
  { path: FILES.limiter.path, type: 'added', state: 'shown', sha256: sha(FILES.limiter.text), hunks: 1,
    ...(counts ? { added: 9, removed: 0, what: 'adds a token bucket limiter',
      asks: [{ source: 'requirements', index: 0 }] } : {}) },
  { path: FILES.server.path, type: 'modified', state: 'shown', sha256: sha(FILES.server.text), hunks: 1,
    ...(counts ? { added: 1, removed: 0, what: 'mounts the limiter', asks: [{ source: 'requirements', index: 0 }] } : {}) },
  { path: FILES.ci.path, type: 'modified', state: 'shown', sha256: sha(FILES.ci.text), hunks: 1,
    ...(counts ? { added: 1, removed: 1, what: 'runs the tests silently', asks: [] } : {}) },
  { path: FILES.readme.path, type: 'modified', state: 'shown', sha256: sha(FILES.readme.text), hunks: 1,
    ...(counts ? { added: 1, removed: 1, what: 'says that limiting is on', asks: [{ source: 'requirements', index: 4 }] } : {}) },
  { path: FILES.docs.path, type: 'added', state: 'shown', sha256: sha(FILES.docs.text), hunks: 1,
    ...(counts ? { added: 1, removed: 0, what: 'documents the full answer', asks: [] } : {}) },
];

/** (a) A code step like code-pass/10's: triage, file notes, anchor spans. */
export function triagedReport(session = reportSession()) {
  const base = sessionRows(session);
  const findings = codeFindings();
  const L = FILES.limiter;
  // The anchor's lines as code-pass/10 records them, the lines the change added or modified, and the file's hash.
  findings[0].anchorSpan = { startLine: 2, lines: L.text.split('\n').slice(1, 3), linesCut: 0, charsCut: 0 };
  findings[0].anchorSha256 = sha(L.text);
  findings[0].anchorChanged = [2, 3];
  const where = codeReceipt(L.path, L.text, 3, 3, 'refill();');
  // The ask rows the code step tied a finding, a withheld finding and a question to (ask-code-links.js).
  base.requirements[0] = { ...base.requirements[0], codeLinks: [{ link: 'leads_from', finding: id('p') }] };
  base.requirements[4] = { ...base.requirements[4], codeLinks: [{ link: 'withheld_finding', withheld: 0 },
    { link: 'question_concerns', question: 2 }] };
  // The row the claim_false finding contradicts, marked by the code step as code-pass/7 and later mark it.
  base.promises[3] = { ...base.promises[3], codeCheck: { outcome: 'contradicted-by-code', receipts: [], by: 'finding',
    finding: id('r') } };
  return { ...base, codeCoverage: 'complete', codePass: {
    version: { pass: 'sonah.code-pass/10' }, ran: true, required: false,
    // The review agent's record, as every code step since code-pass/7 keeps it: its request answered.
    agent: { turns: 9, tools: { Read: 6, Grep: 2, Glob: 1 }, reads: 4, terminal: 'answered' },
    base: { kind: 'git', commit: START }, gaps: [], coverage: 'complete', files: filesOf(true),
    findings, questions: codeQuestions(), withheld: codeWithheld(), footer: [],
    triage: [
      { ref: { finding: id('p') }, level: 'high', impact: 'A burst of requests passes the limit at start.',
        action: 'Refill the bucket after the first request.', label: 'fix the refill order', where },
      { ref: { finding: id('t') }, level: 'low', impact: 'A wrong status code would still pass the tests.',
        action: 'Add a test for the 429 answer.', label: 'test the 429 answer', where: null },
      { ref: { finding: id('u') }, level: 'low', impact: 'A zero rate turns the limiter off.',
        action: 'Reject a rate below one.', label: 'reject a zero rate', where: null },
      { ref: { source: 'promises', index: 0, id: id('a') }, level: 'high', impact: 'You may merge with a failing test.',
        action: 'Run the tests again.', label: 'check the test claim', where: null },
      { ref: { source: 'promises', index: 1, id: id('b') }, level: 'low', impact: 'You may trust an unchecked claim.',
        action: 'Try the limit by hand.', label: 'try the limit', where: null },
      { ref: { source: 'decisions', index: 1, id: id('2') }, level: 'high', impact: 'The agent tried to force a push.',
        action: 'Check the remote branch.', label: 'check the forced push', where: null },
      { ref: { source: 'decisions', index: 5, id: id('6') }, level: 'high', impact: 'The build output may be gone.',
        action: 'Build again before you deploy.', label: 'rebuild dist', where: null },
      { ref: { source: 'decisions', index: 6, id: id('7') }, level: 'high', impact: 'A deploy may have started.',
        action: 'Check the deploy log.', label: 'check the deploy', where: null },
      { ref: { source: 'promises', index: 4, id: id('e') }, level: 'medium', impact: 'The bucket may be untested.',
        action: 'Run the limiter once by hand.', label: 'check the bucket claim', where: null },
      { ref: { source: 'writtenClaims', index: 0, id: id('f') }, level: 'medium', impact: 'The README may be wrong.',
        action: 'Read the README.', label: 'check the README line', where: null },
      { ref: { source: 'requirements', index: 1, id: null }, level: 'low', impact: 'NOT USED: a merged row.',
        action: 'NOT USED.', label: 'not used', where: null },
      { ref: { source: 'findings', index: 1, id: id('i') }, level: 'high', impact: 'The README history may be wrong.',
        action: 'Read the README diff.', label: 'read the README diff', where: null },
    ],
    triageDropped: [{ key: 'S99', index: 10, cause: 'triage_key_unknown' }], filesDropped: [],
  } };
}

/** (b) The same, as code-pass/9 wrote it: no triage, no counts, no notes, no anchor spans. */
export function untriagedReport(session = reportSession()) {
  const a = triagedReport(session);
  const { triage, triageDropped, filesDropped, ...pass } = a.codePass;
  return { ...a, codePass: { ...pass, version: { pass: 'sonah.code-pass/9' }, files: filesOf(false),
    findings: pass.findings.map(({ anchorSpan, anchorSha256, anchorChanged, ...f }) => f) } };
}

/** (c) The same review with no code step. */
export function sessionOnlyReport(session = reportSession()) {
  const { codePass, codeCoverage, ...rest } = untriagedReport(session);
  const requirements = rest.requirements.map(({ codeLinks, ...r }) => r);
  const promises = rest.promises.map(({ codeCheck, ...p }) => p);
  return { ...rest, requirements, promises };
}

/** (d) A code step of code-pass/3: questions with no `from`, `id` or `check`; `rejected`, `groups`, `votes`,
 *  `codeStatus`; rows marked `shown-in-code`. */
export function codePass3Report(session = reportSession()) {
  const c = sessionOnlyReport(session);
  const shown = { outcome: 'shown-in-code', receipts: [], by: 'check' };
  return { ...c,
    promises: c.promises.map((p, i) => (i === 1 ? { ...p, codeCheck: shown } : p)),
    decisions: c.decisions.map((d, i) => (i === 2 ? { ...d, codeCheck: shown } : d)),
    requirements: c.requirements.map((r, i) => (i === 0 ? { ...r, codeCheck: shown } : r)),
    codePass: { version: { pass: 'sonah.code-pass/3' }, ran: true, base: { kind: 'git', commit: START }, coverage: 'complete',
      files: filesOf(false), findings: codeFindings().slice(0, 2).map(({ check, ...f }) => f),
      questions: [{ question: 'Is the limit per client?', concerns: { source: 'decisions', index: 3 } }],
      rejected: 2, groups: [['F1']], votes: [{ key: 'F1', verdict: 'holds' }], codeStatus: 'DECIDE', footer: {} } };
}

/** (e) A code step of code-pass/8: `held`, a withheld entry of what `held`, a deleted file and a file outside the root
 *  with no `sha256`. */
export function codePass8Report(session = reportSession()) {
  const b = untriagedReport(session);
  return { ...b, codePass: { ...b.codePass, version: { pass: 'sonah.code-pass/8' },
    held: [{ text: 'The auth check runs first', receipts: [] }],
    withheld: [...b.codePass.withheld, { what: 'held', text: 'The README is right', reason: 'verify_refuted' }],
    files: [...b.codePass.files, { path: 'src/old.js', type: 'deleted', state: 'deleted', hunks: 1 },
      { path: '../scratch/notes.md', type: 'added', state: 'outside_root' }] } };
}

/** (f) A code step of code-pass/1: one finding of kind `code_issue`. */
export function codePass1Report(session = reportSession()) {
  const c = sessionOnlyReport(session);
  return { ...c, codePass: { version: { pass: 'sonah.code-pass/1' }, ran: true, coverage: 'complete',
    base: { kind: 'git', commit: START }, files: filesOf(false),
    findings: [{ id: id('v'), origin: 'code-review', kind: 'code_issue', status: 'DECIDE', title: 'A code issue',
      anchor: { path: FILES.limiter.path, side: 'new', startLine: 1, endLine: 1 }, receipts: [] }],
    rejected: 1, codeStatus: 'DECIDE' } };
}

/** Every shape, by its letter. */
export const REPORT_SHAPES = Object.freeze({ a: triagedReport, b: untriagedReport, c: sessionOnlyReport,
  d: codePass3Report, e: codePass8Report, f: codePass1Report });

/** The CLI's facts for a repository whose HEAD holds every file of the change, pushed to GitHub. */
export const repoFacts = (overrides = {}) => ({
  repo: { head: HEAD, start: START, prefix: '', atHead: Object.values(FILES).map((f) => f.path), goneAtHead: [],
    ...overrides.repo },
  github: { owner: 'example-org', repo: 'example-api', remote: 'origin', pushed: true, startPushed: true,
    ...overrides.github },
  sonahVersion: '0.9.0',
});
