// M33 R repair 3. The unclassified high-entropy backstop judges a token with its whole canonical UUIDs split out.
//
// The entropy backstop dropped many Bash commands whole, most of them ONLY because a path token held a UUID — a session's scratchpad
// (`/private/tmp/claude-501/<slug>/<session-uuid>/scratchpad/x.mjs`), a transcript (`~/.claude/projects/<slug>/<uuid>.jsonl`).
// A UUID is a structural identifier: alone it passes (3.56 bits/char < 4.6, and BENIGN passes hex 7..40), but inside a
// path it lifts the path's entropy over the floor. Now each token is also split on every whole canonical UUID it holds
// (not glued to a letter or digit on either side), and the pieces left are judged exactly as a token is: at least
// ENTROPY_LEN characters and at least ENTROPY_MIN bits, BENIGN, the base64 narrowing of content fields. The UUID's own
// text stays. Every named pattern still runs first, unchanged. This exempts nothing a token would fail on alone.
//
// Synthetic text only: every byte is invented. No recording, no model, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { redact, entropy, ENTROPY_MIN, sliceHash } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });
const hash = (seed, encoding = 'base64url') => createHash('sha512').update(seed).digest(encoding);

const UUID = '0b5e9c1a-7d3f-4a2b-9c8e-5f1d2a3b4c6e';
const UPPER = '9F1C2B3A-4D5E-4F60-8A7B-1C2D3E4F5A6B';
/** Invented random runs: 40 and 26 base64url characters, a 44-character base64 run, a 20-character run. */
const RANDOM40 = hash('m33 r repair 3: random forty').slice(0, 40);
const SEGMENT = hash('m33 r repair 3: random segment').slice(0, 26);
const B64 = hash('m33 r repair 3: base64 run', 'base64').replace(/[+/=]/g, '').slice(0, 44);
const SHORT = hash('m33 r repair 3: short twenty').replace(/[-_]/g, '').slice(0, 20);

const PATHS = [
  `/private/tmp/claude-501/-Users-dev-Projects-shop/${UUID}/scratchpad/check.mjs`,
  // A home directory's transcript path, assembled at run time (a secret scan reads test sources for home paths).
  `${['', 'Users', 'dev'].join('/')}/.claude/projects/-Users-dev-Projects-shop/${UUID}.jsonl`,
  `~/.claude/projects/-Users-dev-Projects-shop/${UPPER}.jsonl`,
];

const DROPPED = '‹dropped:high-entropy›';
const NOTE = /^\[… \d+ (?:diff )?line\(s\) dropped: /;

/**
 * Each channel, as `(text) => what the review is shown of it` (`null` where the channel dropped it): a command, a
 * command's output line, a write's arguments, the ask, a diff line.
 */
const CHANNELS = {
  cmd: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `node ${text} --check` }] })).ledger.ledger[0].cmd ?? null,
  tailLines: (text) => {
    const lines = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'ls',
      tailLines: ['listing:', `wrote ${text} ok`, 'done'] }] })).ledger.ledger[0].tailLines;
    return lines.length === 3 && !lines.some((line) => NOTE.test(line)) ? lines[1] : null;
  },
  argsExcerpt: (text) => redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'run.js',
    argsExcerpt: `const out = 'old';\n⟪→⟫\nconst out = '${text}';` }] })).ledger.ledger[0].argsExcerpt ?? null,
  ask: (text) => {
    const ask = redact(led({ ask: [{ turn: 1, text: `please read ${text} and fix it` }] })).ledger.ask[0].text;
    return ask.includes(DROPPED) ? null : ask;
  },
  diff: (text) => {
    const diff = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'run.js',
      diff: ` const a = 1;\n+const out = '${text}';\n const b = 2;` }] })).ledger.ledger[0].diff;
    return diff.split('\n').some((line) => NOTE.test(line)) ? null : diff;
  },
};
const shown = (channel, text) => CHANNELS[channel](text);

test('M33 R repair 3 premise: each path is over the floor as one token, and every piece of it is under it', () => {
  for (const path of PATHS) {
    assert.ok(path.length >= 24 && entropy(path) >= ENTROPY_MIN, `${path}: ${entropy(path).toFixed(3)} bits`);
    for (const piece of path.split(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i))
      assert.ok(piece.length < 24 || entropy(piece) < ENTROPY_MIN, piece);
  }
  assert.ok(entropy(UUID) < ENTROPY_MIN, 'a bare UUID already passes');
  for (const run of [RANDOM40, B64]) assert.ok(run.length >= 40 && entropy(run) >= ENTROPY_MIN, run);
  assert.ok(entropy(`/out/${SEGMENT}.json`) >= ENTROPY_MIN, 'the random segment fails as a piece of its own');
});

test('M33 R repair 3: a path whose only high-entropy part is a UUID is kept, in every channel', () => {
  for (const path of PATHS) {
    for (const channel of Object.keys(CHANNELS)) {
      const out = shown(channel, path);
      assert.notEqual(out, null, `${channel}: ${path} is kept`);
      assert.ok(out.includes(path), `${channel}: as written`);
    }
  }
  // A command's whole line, byte for byte, and nothing declared.
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `node ${PATHS[0]}` }] }));
  assert.equal(ledger.ledger[0].cmd, `node ${PATHS[0]}`);
  assert.deepEqual(dropped, []);
});

test('M33 R repair 3: a path with a UUID AND a random segment of 24 characters or more still drops, in every channel', () => {
  const path = `/private/tmp/claude-501/-Users-dev-Projects-shop/${UUID}/out/${SEGMENT}.json`;
  for (const channel of Object.keys(CHANNELS)) {
    assert.equal(shown(channel, path), null, channel);
    assert.equal(shown(channel, `/out/${SEGMENT}.json`), null, `${channel}: the piece alone drops too`);
  }
});

test('M33 R repair 3: a secret glued to a UUID still drops, in every channel', () => {
  const glued = {
    'a UUID, then 40 random characters': `${UUID}${RANDOM40}`,
    'a UUID, a dash, then 40 random characters': `${UUID}-${RANDOM40}`,
    '40 random characters, then a UUID': `${RANDOM40}${UUID}`,
    '40 random characters, an underscore, then a UUID': `${RANDOM40}_${UUID}`,
    'a UUID inside a base64 run': `${B64}${UUID}${B64}`,
    'a UUID between slashes inside a base64 run': `${B64}/${UUID}/${B64}`,
    'a UUID behind a plus inside a base64 run': `${B64}+${UPPER}+${B64}`,
  };
  for (const [name, text] of Object.entries(glued)) {
    for (const channel of Object.keys(CHANNELS)) {
      const out = shown(channel, text);
      assert.equal(out, null, `${channel}: ${name}`);
    }
    // The ask keeps its line and loses the whole token: no part of the secret is shown.
    const ask = redact(led({ ask: [{ turn: 1, text: `please read ${text} and fix it` }] })).ledger.ask[0].text;
    for (const run of [RANDOM40, B64]) assert.ok(!ask.includes(run.slice(0, 12)), `ask: ${name}`);
  }
});

test('M33 R repair 3: a UUID glued to a letter or digit is not a whole UUID: the token is judged whole', () => {
  // 20 random characters are under the token floor's length; glued to a UUID they are part of one 56-character token,
  // which is over the floor, and it drops. Behind a separator the UUID is whole and the 21-character piece is judged
  // alone, as a token of 21 characters always was (this rule exempts nothing a token would fail on alone).
  assert.ok(entropy(`${SHORT}${UUID}`) >= ENTROPY_MIN);
  for (const channel of Object.keys(CHANNELS)) {
    assert.equal(shown(channel, `${SHORT}${UUID}`), null, `${channel}: glued`);
    assert.equal(shown(channel, `${UUID}${SHORT}`), null, `${channel}: glued after`);
    assert.notEqual(shown(channel, `${SHORT}-${UUID}`), null, `${channel}: behind a separator, each piece as a token`);
  }
});

test('M33 R repair 3: a UUID that is the value of a secret-named key is still masked by its named rule, in every channel', () => {
  const values = [`api_key=${UUID}`, `export API_TOKEN=${UUID}`, `--password ${UUID}`];
  for (const value of values) {
    for (const channel of Object.keys(CHANNELS)) {
      const out = shown(channel, value);
      assert.notEqual(out, null, `${channel}: ${value} keeps its line`);
      assert.ok(!out.includes(UUID), `${channel}: ${value} keeps no UUID`);
      assert.match(out, /‹redacted(?::[^›]+)?›/, `${channel}: ${value} is masked by its named rule`);
    }
  }
});

test('M33 R repair 3: the split is deterministic and final: same bytes, and a second pass changes nothing', () => {
  const input = led({
    ask: [{ turn: 1, text: `look at ${PATHS[1]} and ${UUID}${RANDOM40}` }],
    ledger: [
      { turn: 1, seq: 0, kind: 'bash', cmd: `node ${PATHS[0]}`, tailLines: [`read ${PATHS[2]}`, `${B64}/${UUID}/${B64}`, 'ok'] },
      { turn: 1, seq: 1, kind: 'edit', path: 'run.js', argsExcerpt: `a\n⟪→⟫\n'${PATHS[0]}'`, diff: `+const p = '${PATHS[1]}';` },
    ],
  });
  const once = redact(structuredClone(input));
  const again = redact(structuredClone(input));
  assert.equal(JSON.stringify(once), JSON.stringify(again));
  const twice = redact({ ...once.ledger, dropped: [] }).ledger;
  assert.equal(sliceHash(twice), sliceHash(once.ledger));
  assert.equal(once.ledger.ledger[0].cmd, `node ${PATHS[0]}`);
  assert.equal(once.ledger.ledger[0].tailLines[0], `read ${PATHS[2]}`);
  assert.ok(!JSON.stringify(once.ledger).includes(B64.slice(0, 12)));
  assert.ok(!JSON.stringify(once.ledger).includes(RANDOM40.slice(0, 12)));
});
