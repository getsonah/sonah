import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionFromLedger } from '../adapters/sonah-ledger.js';

function adapted(sourceLocator) {
  return sessionFromLedger({
    ask: [{ turn: 1, text: 'Create the synthetic module.' }],
    sources: [{ adapter: 'codex' }],
    ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'src/module.js',
      after: { text: 'export const answer = 42;\n' },
      sourceLocator,
      result: { seen: true, outcome: 'succeeded', provenance: 'native' } }],
  }, { sessionKey: 'synthetic-codex' });
}

test('numeric native proof locators survive adapter normalization without sidecar text', () => {
  const locator = { stream: 0, record: 12, part: 0, resultRecord: 13,
    fileChangeRecord: 14, commandExecutionRecord: 15 };
  const session = adapted(locator);
  const action = session.events.find((e) => e.kind === 'invocation');
  const observation = session.observationFor(action.id);
  assert.deepEqual(action.sourceLocator, locator);
  assert.deepEqual(observation.sourceLocator, locator);
  assert.equal(session.succeeded(action.id), true);
  assert.equal(observation.sourceOfResult, 'native');
  assert.deepEqual(observation.output, [], 'a FileChange sidecar is a typed status, not quotable tool output');
});

test('a malformed locator is not repaired from adjacency or output count', () => {
  const session = adapted({ stream: 0, record: 12, part: -1, fileChangeRecord: 14 });
  const action = session.events.find((e) => e.kind === 'invocation');
  assert.equal(action.sourceLocator, undefined);
  assert.equal(session.observationFor(action.id).sourceLocator, undefined);
});
