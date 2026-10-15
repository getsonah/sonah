// What a model PROPOSES for the redis-pivot session. Two of these are deliberately bad, so the
// tests prove the grounder withholds them rather than printing an unsupported accusation.

export const DECISION_CANDIDATES = [
  {
    // Well-supported: the ask raised caching but left the mechanism open -> asked-chose.
    actorSession: 'sess-redis-pivot',
    dimension: 'cache backend',
    chosen: 'Redis as a shared cache store',
    value: 'config/redis.yml',
    valueReceipt: { role: 'action', field: 'path', eventId: 'E3', quote: 'config/redis.yml' },
    actions: ['E3'],
    stated: { role: 'commentary', eventId: 'E2', quote: 'add a small Redis layer' },
    constrainedBy: {
      instruction: { role: 'instruction', eventId: 'E1', quote: 'Add response caching to the products API' },
      settles: false,
      settledValueQuote: null,
    },
  },
  {
    // LYING MODEL 1: supplies a severity. The whole candidate is rejected, not stripped.
    actorSession: 'sess-redis-pivot',
    dimension: 'cache expiry',
    chosen: '300 second TTL',
    severity: 'high',
    actions: ['E3'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null,
  },
  {
    // LYING MODEL 2: cites an action that does not exist in the session.
    actorSession: 'sess-redis-pivot',
    dimension: 'connection pooling',
    chosen: 'default pool',
    actions: ['E99'],
    value: null, valueReceipt: null, stated: null, constrainedBy: null,
  },
];

export const FINDING_CANDIDATES = [
  {
    origin: 'session-review',
    kind: 'edit_under_negative_requirement',
    title: 'Redis was added although the instruction forbade new infrastructure',
    explanation: 'The instruction ruled out new services and datastores. The agent added a Redis configuration anyway. It did say so at the time, which is why this is informational rather than blocking — but the choice is yours to keep or revert.',
    scope: 'current-code',
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 1, endLine: 5 },
    receipts: [
      { role: 'instruction', eventId: 'E1', quote: 'Do not add any new infrastructure' },
      { role: 'action', eventId: 'E3', quote: 'config/redis.yml' },
      { role: 'commentary', eventId: 'E2', quote: 'that is technically new infrastructure' },
    ],
  },
  {
    origin: 'session-review',
    kind: 'claim_contradicted',
    title: 'The final message says the tests pass; the integration run failed',
    explanation: 'The closing message reports verification succeeded. The integration suite it would have needed reported a failure and exited non-zero. A later unit run did pass, but a passing unit suite does not establish the integration result.',
    scope: 'session-effect',
    anchor: null,
    receipts: [
      { role: 'commentary', eventId: 'E9', quote: 'verified it works — the tests pass' },
      { role: 'observation', eventId: 'E6', quote: 'Tests: 1 failed, 11 passed, 12 total' },
    ],
  },
  {
    // LYING MODEL 3: a real-sounding accusation whose instruction quote was never said.
    origin: 'session-review',
    kind: 'edit_under_negative_requirement',
    title: 'Agent ignored an instruction to avoid YAML config',
    explanation: 'Plausible wording, fabricated evidence.',
    scope: 'current-code',
    anchor: null,
    receipts: [
      { role: 'instruction', eventId: 'E1', quote: 'do not use YAML for configuration' },
      { role: 'action', eventId: 'E3', quote: 'config/redis.yml' },
    ],
  },
];

/** An ordinary code-review finding, preserved untouched alongside the ledger. */
export const CODE_FINDINGS = [
  {
    id: 'sha256:' + 'c'.repeat(64),
    origin: 'code-review',
    kind: 'code_issue',
    title: 'Cache host is hardcoded to localhost',
    explanation: 'config/redis.yml pins host to localhost, which will not resolve in a deployed environment. Expected: read the host from configuration or environment.',
    receipts: [{ role: 'code', eventId: 'E3', quote: 'host: localhost' }],
    scope: 'current-code',
    anchor: { path: 'config/redis.yml', side: 'RIGHT', startLine: 3, endLine: 3 },
    status: 'DECIDE',
  },
];
