// Synthetic fixture `middle-instruction` (ACCEPTANCE "Required reusable synthetic scenarios"):
//   "Long instruction with the crucial constraint in a fenced middle block; later amendment
//    and commentary."
//
// This is the case that separates reading a SESSION from reading the last message. The binding
// constraint sits in a fenced block in the middle of a long brief, and a later human amendment
// changes it. Anything that summarises to the final reply, or reads only the first paragraph,
// gets this wrong in both directions: it misses the original rule and misses that it moved.
//
// Every string is invented for this fixture.

import { Session } from '../src/session.js';

const TEXT = {
  brief: [
    'Please pick up the export pipeline work. Background: the reporting team has been asking for',
    'CSV exports for a while and we finally have the schema settled, so this should be mostly',
    'mechanical. There is an existing exporter in the billing module you can crib from.',
    '',
    'A few things worth knowing before you start. The reporting team runs their own scheduler, so',
    'you do not need to add any cron wiring. The schema team already added the columns. QA has a',
    'fixture set they will point at this once it exists.',
    '',
    '```',
    'Hard constraint: exports must stream. Do not buffer a whole result set in memory —',
    'we OOMed twice last quarter doing exactly that.',
    '```',
    '',
    'Beyond that use your judgement on file layout and naming. If you want to add a progress log',
    'that is fine. Ping me if the streaming interface turns out to be painful, there is a wrapper',
    'in utils somewhere that might help but I cannot remember what it is called.',
  ].join('\n'),
  amendment: 'Change of plan on the streaming thing — finance needs a deterministic byte count up front for the signed-URL header, so buffer it after all. Cap it at 50MB and fail loudly above that.',
  commentary: 'Reading the brief, the hard constraint is streaming, so I will build this on the streaming writer.',
  afterAmendment: 'Switching to a buffered implementation with the 50MB cap, per the amendment.',
  writeAfter: 'const MAX_EXPORT_BYTES = 50 * 1024 * 1024;\n\nexport async function writeExport(rows) {\n  const buffer = [];\n  for await (const row of rows) buffer.push(serialize(row));\n  const body = buffer.join("\\n");\n  if (Buffer.byteLength(body) > MAX_EXPORT_BYTES) throw new ExportTooLarge();\n  return body;\n}\n',
};

const blobs = { ...TEXT };
const whole = (key) => [{ sourceKey: key, fromByte: 0, untilByte: Buffer.byteLength(blobs[key], 'utf8') }];

const events = [
  // The decisive rule is fenced, in the middle, surrounded by chatty context.
  { id: 'M1', kind: 'instruction', sequence: 0, authority: 'human', text: whole('brief'), supersedes: [] },
  { id: 'M2', kind: 'commentary', sequence: 1, phase: 'working', text: whole('commentary'), beforeInvocation: null },

  // A later human amendment REVERSES the fenced constraint.
  { id: 'M3', kind: 'instruction', sequence: 2, authority: 'human', text: whole('amendment'), supersedes: ['M1'] },
  { id: 'M4', kind: 'commentary', sequence: 3, phase: 'working', text: whole('afterAmendment'), beforeInvocation: 'M5' },

  { id: 'M5', kind: 'invocation', sequence: 4, callKey: 'm1', tool: 'Write', operation: 'write',
    paths: [{ path: 'src/export/writer.js' }], command: [], input: [],
    changes: [{ path: 'src/export/writer.js', before: [], after: whole('writeAfter'), diff: [] }] },
  { id: 'M6', kind: 'observation', sequence: 5, invocation: 'M5', callKey: 'm1', phase: 'terminal',
    result: 'succeeded', exitCode: 0, output: [], sourceOfResult: 'native' },
];

export const MIDDLE_INSTRUCTION_TEXT = TEXT;

export function middleInstructionSession() {
  return new Session({ sessionKey: 'sess-middle-instruction', adapter: 'claude', events, blobs });
}

export function middleInstructionPr() {
  return {
    repo: { host: 'github.com', id: '42' },
    number: 11,
    baseOid: 'b'.repeat(40),
    headOid: 'h'.repeat(40),
    files: [{ path: 'src/export/writer.js', change: 'added' }],
  };
}

/** What a model proposes: the buffering choice, cited against the AMENDMENT, not the brief. */
export const MIDDLE_DECISION_CANDIDATES = [
  {
    actorSession: 'sess-middle-instruction',
    dimension: 'export buffering strategy',
    chosen: 'buffer the whole export with a 50MB cap',
    value: 'src/export/writer.js',
    valueReceipt: { role: 'action', field: 'path', eventId: 'M5', quote: 'src/export/writer.js' },
    actions: ['M5'],
    stated: { role: 'commentary', eventId: 'M4', quote: 'Switching to a buffered implementation' },
    constrainedBy: {
      instruction: { role: 'instruction', eventId: 'M3', quote: 'buffer it after all. Cap it at 50MB' },
      settles: true,
      settledValueQuote: 'Cap it at 50MB',
    },
  },
];
