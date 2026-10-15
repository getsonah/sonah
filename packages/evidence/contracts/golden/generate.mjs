// Regenerates golden/vectors.json. Run deliberately, never automatically:
//   node packages/evidence/contracts/golden/generate.mjs
// A changed vector means the wire format changed and every stored digest is invalidated.
import { writeFileSync } from 'node:fs';
import { canonicalJson, digestOf, identityDigest } from '../canonical.js';

// Synthetic only. Every string here is invented for the fixture.
const records = {
  'C-01 minimal record': { schema: 'sonah.text/1', text: '' },
  'C-02 text blob': {
    schema: 'sonah.text/1', repo: { host: 'github.com', id: '1' }, role: 'instruction',
    redactionProfile: 'p1', sourceKey: 'k1',
    chunk: { index: 0, fromByte: 0, untilByte: 12, totalBytes: 12 }, text: 'do the thing',
  },
  'C-02 multibyte text': { schema: 'sonah.text/1', text: 'héllo 😀 wörld' },
  'C-03 gap': {
    schema: 'sonah.gap/1', code: 'missing_chunk', channel: 'commentary', scope: 'session',
    sessionKey: 's1', prContext: null, commitOid: null, eventIds: [], fromSequence: null,
    untilSequence: null, count: 1,
  },
  'C-04 evidence link': {
    schema: 'sonah.link/1', repo: { host: 'github.com', id: '1' },
    commitOid: 'a'.repeat(40), snapshots: [], boundary: { beforeOid: null, afterOid: null, patchReceipt: null },
    verification: 'unlinked', basis: 'none', coveredPaths: [], coverage: 'unknown',
  },
};

const identities = {
  'C-06 finding identity': {
    tag: 'sonah.finding-identity/1',
    fields: { repo: { host: 'github.com', id: '1' }, origin: 'session-review', kind: 'code_issue', scope: 'current-code', receipts: ['r2', 'r1'], anchor: null },
    sets: ['receipts'],
  },
  'C-06 requirement identity': {
    tag: 'sonah.requirement-identity/1',
    fields: { repo: { host: 'github.com', id: '1' }, instruction: 'i1', text: 'add caching' },
    sets: [],
  },
  'C-06 identity with astral set members': {
    tag: 'sonah.finding-identity/1',
    fields: { repo: { host: 'github.com', id: '1' }, receipts: ['\u{1F600}', 'Ａ'] },
    sets: ['receipts'],
  },
};

const vectors = {
  schema: 'sonah.golden-vectors/1',
  note: 'Frozen cross-implementation vectors. An independent implementation of C-01 must reproduce every digest below byte for byte.',
  records: {}, identities: {},
};
for (const [name, record] of Object.entries(records)) {
  vectors.records[name] = { canonical: canonicalJson(record), digest: digestOf(record) };
}
for (const [name, spec] of Object.entries(identities)) {
  vectors.identities[name] = { tag: spec.tag, digest: identityDigest(spec.tag, spec.fields, spec.sets) };
}
writeFileSync(new URL('./vectors.json', import.meta.url), JSON.stringify(vectors, null, 2) + '\n');
console.log(`wrote ${Object.keys(records).length} record + ${Object.keys(identities).length} identity vectors`);
