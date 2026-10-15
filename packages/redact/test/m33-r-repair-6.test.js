// M33 R repair 6, the lead's decision on the fifth leak hunt. The UUID rule (UUID_SPLIT, repairs 3-5) judges a token in
// every reading without its whole UUIDs, which recovers filesystem paths — a session's scratchpad, a transcript — that
// the floor dropped only because a UUID lifted their entropy. In a URL, though, the UUID is often the credential itself
// (deploy-hook and webhook URLs), and the floor dropped such a URL as written. A token with a URL sign (`://`, `?`, `=`,
// `@`, `#`, `&`) is now judged as written AND in every reading without its UUIDs, and fails if either does: never
// weaker than before UUID_SPLIT, and never weaker than repair 4.
//
// Synthetic text only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact, entropy, ENTROPY_MIN } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const UUID = '6c1d9e2f-3a4b-4c5d-8e7f-0a1b2c3d4e5f';
const SECRET = createHash('sha256').update('m33 r repair 6: hook secret').digest('base64').replace(/[+/=]/g, '').slice(0, 32);
const cmdOf = (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `curl -s -X POST ${text}` }] })).ledger.ledger[0].cmd ?? '';
const askOf = (text) => redact(led({ ask: [{ turn: 1, text: `post the status to ${text} when done` }] })).ledger.ask[0].text;

const CREDENTIAL_URLS = [
  `https://api.example.test/client/v4/pages/webhooks/deploy_hooks/${UUID}`,
  `https://automation.example.test/webhook/${UUID}`,
  `https://hooks.example.test/hooks/catch/${UUID}`,
  `https://hooks.example.test/trigger?token=${UUID}`,
  `hooks.example.test/x/${UUID}`,
];

test('M33 R repair 6: a URL whose UUID is its credential is dropped exactly as it was before UUID_SPLIT', () => {
  for (const url of CREDENTIAL_URLS) {
    assert.ok(entropy(url) >= ENTROPY_MIN, `premise: ${url} fails the floor as written`);
    assert.ok(!cmdOf(url).includes(UUID), `cmd: ${url}`);
    assert.ok(!askOf(url).includes(UUID), `ask: ${url}`);
  }
});

test('M33 R repair 6: a UUID never dilutes a secret beside it in a URL below the floor (repair 4 still holds)', () => {
  for (const url of [`https://hooks.example.test/services/${UUID}/${SECRET}`, `https://hooks.example.test/s?k=${SECRET}&id=${UUID}`]) {
    assert.ok(!cmdOf(url).includes(SECRET.slice(0, 8)), `cmd: ${url}`);
    assert.ok(!askOf(url).includes(SECRET.slice(0, 8)), `ask: ${url}`);
  }
});

test('M33 R repair 6: filesystem paths holding a UUID are still kept (the recovery)', () => {
  for (const path of [`/private/tmp/claude-501/-Users-dev-Code-proj/${UUID}/scratchpad/x.mjs`,
    `~/.claude/projects/-Users-dev-Code-proj/${UUID}.jsonl`, `/var/folders/ab/T/${UUID}/out.json`]) {
    assert.ok(cmdOf(path).includes(path), `cmd: ${path}`);
  }
});

test('M33 R repair 6: a URL with a UUID that passes as written and in every reading is kept', () => {
  const url = `https://ex.test/a/${UUID}`;
  assert.ok(entropy(url) < ENTROPY_MIN || url.length < 24, `premise: ${entropy(url)}`);
  assert.ok(cmdOf(url).includes(url));
});
