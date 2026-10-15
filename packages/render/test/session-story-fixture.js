// Synthetic session + finished review report for the session story (M33 S). Every string is invented
// for this fixture: no real session, path or credential appears here.
//
// The session: two human asks, seven review windows (steps), a pivot (a Redis store written, a test run
// failing, the store deleted for an in-process token bucket), an unasked decision, a settled decision, an
// unverified-column decision, a DECIDE finding (the final message says the tests pass; the last run
// failed), an FYI finding, two helper agents with linked child sessions (one writes tests, one edits the
// README), created, edited, rewritten and deleted files, a plan file written outside the repository (the
// story counts it and never shows it), and two quiet steps that the chart collapses.

import { Session } from '../../evidence/src/session.js';

export const STORY_KEY = 'story';

export const TEXT = Object.freeze({
  ask1: 'Add rate limiting to the public API middleware. Keep the existing auth checks intact and do not add a new datastore.',
  ask2: 'Also add tests for the limiter and make sure the whole suite passes.',
  readFirst: 'I will read the middleware first.',
  redisPlan: 'A shared store is the simplest way to share counters, so I will add a Redis client for the limiter.',
  redisBody: [
    "import { createClient } from 'redis';",
    '',
    'export function redisStore(url) {',
    '  const client = createClient({ url });',
    '  return { hit: (key) => client.incr(key) };',
    '}',
    '',
  ].join('\n'),
  pivot: 'Redis is not available here and you asked for no new datastore, so I am switching to an in-process token bucket.',
  // D84: the page and the story show the session masked; a value assigned to a name holding a secret's word (`tokens =
  // …`) reads to the redactor as a secret, so the bucket's count is `left`, and this fixture's counts stay exact.
  bucketBody: [
    'export function tokenBucket({ capacity, refillPerSecond }) {',
    '  let left = capacity;',
    '  let last = 0;',
    '  return function take(now) {',
    '    left = Math.min(capacity, left + ((now - last) / 1000) * refillPerSecond);',
    '    last = now;',
    '    if (left < 1) return false;',
    '    left -= 1;',
    '    return true;',
    '  };',
    '}',
    '',
  ].join('\n'),
  bucketGuard: '    if (left < 1) return false; // over the limit',
  planPath: 'Users/dev/.claude/plans/rate-limit-plan.md',
  planBody: 'Private plan: try Redis first, then fall back.\n',
  indexBefore: [
    "import { requireAuth } from './auth.js';",
    '',
    '// no limit yet',
    'export function middleware(app) {',
    '  app.use(requireAuth);',
    '}',
    '',
  ].join('\n'),
  indexFirstEdit: [
    "import { tokenBucket } from '../limiter/token-bucket.js';",
    '',
    'const take = tokenBucket({ capacity: 60, refillPerSecond: 1 });',
  ].join('\n'),
  indexSecondBefore: '  app.use(requireAuth);',
  indexSecondAfter: [
    '  app.use(requireAuth);',
    '  app.use((req, res, next) => {',
    '    if (take(req.time)) return next();',
    "    res.status(429).set('Retry-After', '1').end();",
    '  });',
  ].join('\n'),
  wired: 'The limiter is wired in after the auth check, so auth still runs first.',
  brief1: 'Write unit tests for the token bucket in test/limiter.test.js',
  testBody: [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { tokenBucket } from '../src/limiter/token-bucket.js';",
    '',
    "test('a full bucket admits one request', () => {",
    '  const take = tokenBucket({ capacity: 1, refillPerSecond: 1 });',
    '  assert.equal(take(0), true);',
    '  assert.equal(take(0), false);',
    '});',
    '',
  ].join('\n'),
  brief2: 'Update the README section about request limits',
  readmeBefore: '## Limits\n\nNone yet.',
  readmeAfter: '## Limits\n\nRequests over the limit receive HTTP 429 with Retry-After.',
  final: 'All tests pass and the limiter is wired in. I will document the limiter defaults in the README next.',
});

/** A tiny session builder: every text becomes its own blob, referenced whole. */
export function sessionBuilder(sessionKey = STORY_KEY) {
  const blobs = {};
  const events = [];
  const children = [];
  let n = 0;
  const put = (text) => {
    const key = `t${n++}`;
    blobs[key] = text;
    return text === '' ? [] : [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(text, 'utf8') }];
  };
  const push = (event) => { events.push({ sequence: events.length, ...event }); return event.id; };
  const done = (id, result = 'succeeded', output = '', extra = {}) => push({ id: `${id}-r`, kind: 'observation',
    invocation: id, callKey: id, phase: 'terminal', result, exitCode: result === 'succeeded' ? 0 : 1,
    terminalStatusProven: true, output: put(output), sourceOfResult: 'native', ...extra });
  const scope = (childId = null) => (childId ? { childId } : {});
  return {
    blobs, events, children,
    ask: (id, text, authority = 'human', childId = null) => push({ id, kind: 'instruction', authority, supersedes: [],
      text: put(text), ...scope(childId) }),
    say: (id, text, phase = 'working', childId = null) => push({ id, kind: 'commentary', phase, beforeInvocation: null,
      text: put(text), ...scope(childId) }),
    read: (id, path, childId = null) => {
      push({ id, kind: 'invocation', callKey: id, tool: 'read', operation: 'other', paths: [{ path }], command: [],
        input: [], changes: [], ...scope(childId) });
      done(id, 'succeeded', '', scope(childId));
    },
    run: (id, command, result, output = '', childId = null) => {
      push({ id, kind: 'invocation', callKey: id, tool: 'bash', operation: 'command', paths: [], command: put(command),
        input: [], changes: [], ...scope(childId) });
      done(id, result, output, scope(childId));
    },
    /** A write, edit or delete with one change. `before` is the recorded prior text (or null). */
    change: (id, path, { operation = 'write', after = '', before = null, priorState = before === null ? 'none'
      : operation === 'delete' ? 'deleted-state' : 'first-write', childId = null, extent = {}, result = 'succeeded',
    outside = false, tool = operation === 'write' ? 'create' : operation, beforeExtent = {} } = {}) => {
      const afterRefs = operation === 'delete' ? [] : put(after);
      const beforeRefs = before === null ? [] : put(before);
      push({ id, kind: 'invocation', callKey: id, tool, operation, paths: [{ path }], command: [], input: [],
        changes: [{ path, before: beforeRefs, after: afterRefs, diff: [],
          extent: { chars: after.length, lines: after ? after.split('\n').length : 0, truncated: false, cap: null,
            recorded: true, redactedLines: 0, priorState, ...extent },
          ...(before === null ? {} : { beforeExtent: { chars: before.length, lines: before.split('\n').length, truncated: false,
            cap: null, recorded: true, redactedLines: 0, ...beforeExtent } }),
          ...(outside ? { outsideRepository: true } : {}) }], ...scope(childId) });
      done(id, result, '', scope(childId));
    },
    delegate: (id, brief, childId = null, relation = 'spawn', parentChildId = null) => {
      push({ id, kind: 'invocation', callKey: id, tool: 'Task', operation: 'delegate', paths: [], command: [],
        input: put(brief), changes: [], ...scope(parentChildId) });
      if (childId) children.push({ assignmentEvent: id, childSession: `${sessionKey}/child:${childId}`,
        sessionKey: `${sessionKey}/child:${childId}`, childId, relation, state: 'verified', historyStart: null });
    },
    session: (adapter = 'claude') => new Session({ sessionKey, adapter, events, blobs, children }),
  };
}

export function storySession() {
  const b = sessionBuilder();
  // Step 1: the ask, and exploring.
  b.ask('I1', TEXT.ask1);
  b.say('C1-0', TEXT.readFirst);
  b.read('A1-0', 'src/middleware/auth.js');
  b.read('A1-1', 'src/middleware/index.js');
  b.run('A1-2', 'rg -n "limit" src', 'succeeded', 'src/middleware/index.js:3:// no limit yet');
  // Step 2: the Redis store, a failing test run, the pivot, and the store deleted.
  b.say('C2-0', TEXT.redisPlan);
  b.change('A2-0', 'src/limiter/redis-store.js', { after: TEXT.redisBody });
  b.run('A2-1', 'npm test', 'failed', 'FAIL test/limiter.test.js\nError: connect ECONNREFUSED 127.0.0.1:6379\nTests: 1 failed, 8 passed');
  b.say('C2-1', TEXT.pivot);
  b.change('A2-2', 'src/limiter/redis-store.js', { operation: 'delete', before: TEXT.redisBody });
  // Step 3: the token bucket, and two edits of the middleware (the first without an isolated replaced text).
  b.change('A3-0', 'src/limiter/token-bucket.js', { after: TEXT.bucketBody });
  b.change('A3-1', 'src/middleware/index.js', { operation: 'edit', after: TEXT.indexFirstEdit, before: TEXT.indexBefore });
  b.change('A3-2', 'src/middleware/index.js', { operation: 'edit', after: TEXT.indexSecondAfter,
    before: TEXT.indexSecondBefore, priorState: 'edit-text' });
  // A whole-file rewrite of the bucket: the record keeps no prior state for a path's second write, so the
  // story diffs it against the body written before it (+1 −1), not as a create.
  b.change('A3-3', 'src/limiter/token-bucket.js',
    { after: TEXT.bucketBody.replace('    if (left < 1) return false;', TEXT.bucketGuard) });
  b.say('C3-0', TEXT.wired);
  // Step 4: the second ask, and two helpers with linked child sessions.
  b.ask('I2', TEXT.ask2);
  b.delegate('D4-0', TEXT.brief1, 'c1');
  b.ask('child:c1:I0', TEXT.brief1, 'agent', 'c1');
  b.change('child:c1:A0-0', 'test/limiter.test.js', { after: TEXT.testBody, childId: 'c1' });
  b.run('child:c1:A0-1', 'node --test test/limiter.test.js', 'succeeded', 'ℹ tests 1\nℹ pass 1\nℹ fail 0', 'c1');
  b.delegate('D4-1', TEXT.brief2, 'c2');
  b.ask('child:c2:I0', TEXT.brief2, 'agent', 'c2');
  b.change('child:c2:A0-0', 'README.md', { operation: 'edit', after: TEXT.readmeAfter, before: TEXT.readmeBefore,
    priorState: 'edit-text', childId: 'c2' });
  // Steps 5 and 6: quiet in the chart. Step 5 also writes a plan file outside the repository.
  b.run('A5-0', 'npm run lint', 'succeeded', 'no problems');
  b.run('A5-1', 'git status --short', 'succeeded', ' M src/middleware/index.js');
  b.change('A5-2', TEXT.planPath, { after: TEXT.planBody, outside: true });
  b.run('A6-0', 'git diff --stat', 'succeeded', ' 1 file changed');
  // Step 7: the last test run fails, and the final message says the tests pass.
  // D84: as Node's own test runner prints its summary (`ℹ pass 8`); a bare `pass 8` at a line's head reads to the
  // redactor's line-head rule as a password, and the page and story now mask the session they show.
  b.run('A7-0', 'npm test', 'failed', 'ℹ tests 9\nℹ pass 8\nℹ fail 1\nnot ok 1 - rejects a burst over capacity');
  b.say('F7', TEXT.final, 'final');
  return b.session();
}

/** The windows of `storySession`, one per step. */
export const STORY_WINDOWS = Object.freeze([
  ['I1', 'C1-0', 'A1-0', 'A1-0-r', 'A1-1', 'A1-1-r', 'A1-2', 'A1-2-r'],
  ['C2-0', 'A2-0', 'A2-0-r', 'A2-1', 'A2-1-r', 'C2-1', 'A2-2', 'A2-2-r'],
  ['A3-0', 'A3-0-r', 'A3-1', 'A3-1-r', 'A3-2', 'A3-2-r', 'A3-3', 'A3-3-r', 'C3-0'],
  ['I2', 'D4-0', 'child:c1:I0', 'child:c1:A0-0', 'child:c1:A0-0-r', 'child:c1:A0-1', 'child:c1:A0-1-r',
    'D4-1', 'child:c2:I0', 'child:c2:A0-0', 'child:c2:A0-0-r'],
  ['A5-0', 'A5-0-r', 'A5-1', 'A5-1-r', 'A5-2', 'A5-2-r'],
  ['A6-0', 'A6-0-r'],
  ['A7-0', 'A7-0-r', 'F7'],
]);

const receipt = (role, eventId, quote) => ({ role, eventId, quote, sessionKey: STORY_KEY });

/** A finished review report of `storySession`, in the shape report.private.json holds (no `session`). */
export function storyReport() {
  return {
    repo: { host: 'github.com', id: '0' },
    pr: null,
    reviewScope: 'session-only',
    decisions: [
      { actorSession: STORY_KEY, dimension: 'limiter algorithm', chosen: 'in-process token bucket', value: null,
        valueReceipt: null, valueState: 'unchecked', actions: ['A3-0'], stated: receipt('commentary', 'C2-1',
          'switching to an in-process token bucket'), constrainedBy: null, instructionReview: null, column: 'unasked',
        columnState: 'grounded', amends: [], materiality: 'material', materialityRule: 'synthetic', relevance: 'unchecked',
        reasons: [], id: 'sha256:d100000000000000000000000000000000000000000000000000000000000000' },
      { actorSession: STORY_KEY, dimension: 'rate limit response', chosen: 'HTTP 429 with Retry-After', value: null,
        valueReceipt: null, valueState: 'unchecked', actions: ['A3-2'], stated: null, constrainedBy: null,
        instructionReview: null, column: 'asked-chose', columnState: 'grounded', amends: [], materiality: 'material',
        materialityRule: 'synthetic', relevance: 'unchecked', reasons: [], id: 'sha256:d200000000000000000000000000000000000000000000000000000000000000' },
      { actorSession: STORY_KEY, dimension: 'auth checks', chosen: 'kept before the limiter', value: null,
        valueReceipt: null, valueState: 'unchecked', actions: ['A3-2'], stated: null,
        constrainedBy: { instruction: receipt('instruction', 'I1', 'Keep the existing auth checks intact'), settles: true,
          settledValueQuote: 'Keep the existing auth checks intact' },
        instructionReview: null, column: 'asked-settled', columnState: 'grounded', amends: [], materiality: 'structural',
        materialityRule: 'synthetic', relevance: 'unchecked', reasons: [], id: 'sha256:d300000000000000000000000000000000000000000000000000000000000000' },
      { actorSession: `${STORY_KEY}/child:c1`, dimension: 'test runner', chosen: 'node --test', value: null,
        valueReceipt: null, valueState: 'unchecked', actions: ['child:c1:A0-1'], stated: null, constrainedBy: null,
        instructionReview: null, column: null, columnState: 'unchecked', amends: [], materiality: 'cosmetic',
        materialityRule: 'synthetic', relevance: 'unchecked', reasons: ['instructions_partial'], id: 'sha256:d400000000000000000000000000000000000000000000000000000000000000' },
    ],
    findings: [
      { origin: 'session-review', kind: 'edit_under_negative_requirement', status: 'FYI',
        title: 'A Redis store was added although you ruled out a new datastore',
        explanation: 'Synthetic explanation.', scope: 'session-effect', anchor: null, id: 'sha256:f2',
        receipts: [receipt('instruction', 'I1', 'do not add a new datastore'),
          receipt('action', 'A2-0', 'src/limiter/redis-store.js'),
          receipt('commentary', 'C2-0', 'I will add a Redis client')] },
      { origin: 'session-review', kind: 'claim_contradicted', status: 'DECIDE',
        title: 'The final message says all tests pass; the last test run failed',
        explanation: 'Synthetic explanation.', scope: 'session-effect', anchor: null, id: 'sha256:f1',
        receipts: [receipt('commentary', 'F7', 'All tests pass'), receipt('observation', 'A7-0-r', 'fail 1')] },
    ],
    pivots: [
      { abandoned: 'Redis-backed counter store', adopted: 'in-process token bucket',
        receipts: [receipt('commentary', 'C2-1', 'so I am switching to an in-process token bucket')] },
    ],
    requirements: [
      { instruction: receipt('instruction', 'I1', 'Add rate limiting to the public API middleware'),
        text: 'Rate limiting on the public API middleware', status: 'addressed' },
      { instruction: receipt('instruction', 'I1', 'Keep the existing auth checks intact'),
        text: 'Existing auth checks stay intact', status: 'addressed' },
      { instruction: receipt('instruction', 'I1', 'do not add a new datastore'),
        text: 'No new datastore', status: 'partly-addressed' },
      { instruction: receipt('instruction', 'I2', 'add tests for the limiter'),
        text: 'Tests for the limiter', status: 'addressed' },
      { instruction: receipt('instruction', 'I2', 'make sure the whole suite passes'),
        text: 'The whole suite passes', status: 'open' },
    ],
    promises: [
      { id: 'sha256:p1', stated: receipt('commentary', 'F7', 'I will document the limiter defaults in the README next'),
        text: 'The limiter defaults will be documented in the README', status: 'open',
        receipts: [receipt('commentary', 'F7', 'I will document the limiter defaults in the README next')] },
    ],
    writtenClaims: [
      { id: 'sha256:w1', stated: receipt('code', 'child:c2:A0-0', 'Requests over the limit receive HTTP 429'),
        text: 'Requests over the limit receive HTTP 429', label: 'unverified',
        receipts: [receipt('code', 'child:c2:A0-0', 'Requests over the limit receive HTTP 429')] },
    ],
    windowResults: STORY_WINDOWS.map((eventIds, windowIndex) => ({ windowIndex, eventIds: [...eventIds],
      failure: windowIndex === 5 ? 'model_unavailable' : null })),
    sessionStatus: 'DECIDE',
    reviewStatus: 'DECIDE',
    coverage: 'partial',
  };
}
