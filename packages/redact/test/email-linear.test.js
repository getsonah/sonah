// F241: the email pattern (`\b[local]+@…`) restarted at every `.`-word boundary inside one run of
// local-part characters, so a run with no `@` (`.a.a.a…`) cost O(n²): ~2 s at 64 KB, minutes at
// 1 MB. A match now starts only where a run starts, so each run is scanned once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../index.js';
import { assertLinear } from './linear-clock.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
test('F241: a 1 MB run of local-part characters with no @ is scanned in linear time', () => {
  const text = '.a'.repeat(512 * 1024);
  assertLinear(() => redact(led({ ask: [{ turn: 1, text }] })), 1000, 'ask');
});

test('F241: an address is still masked, whatever precedes it', () => {
  const address = ['someone', 'example.org'].join('@');
  for (const text of [`mail ${address} now`, `.${address}`, `x.y.${address}`, `<${address}>`,
    `foo\\n${address}`, `a\\t${address}`]) {
    const out = JSON.stringify(redact(led({ ask: [{ turn: 1, text }] })));
    assert.ok(!out.includes(address), `leaked in: ${text}`);
  }
});
