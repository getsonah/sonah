// D100, the audit of absence sentences (absence-audit.js): every fixed sentence of the word tables was read by a person
// and has a class; an absence sentence stands only beside the code that proves it, or is held for the owner with a
// closed reason. A sentence added or changed fails here until a person reads it again. Pure: it imports the word
// modules and reads the files the proofs name; it renders nothing and sends nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { moduleEntries, WORD_MODULE_DIRS, WORD_MODULES_NAMED } from './style-lint.js';
import { AUDIT_CLASSES, ABSENCE_PROOFS, ABSENCE_REGISTRY, ABSENCE_HELD, ABSENCE_SCOPES, HELD_REASONS, READ_CENSUS,
  auditProblems, fingerprintOf } from './absence-audit.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The word tables as the style linter reads them: module -> key -> the texts of the key (each fixture of a function),
 *  and module -> its entries, for the allows. */
async function wordTables() {
  const paths = [...WORD_MODULES_NAMED];
  for (const dir of WORD_MODULE_DIRS)
    for (const name of (await readdir(join(ROOT, dir))).sort()) if (name.endsWith('.js')) paths.push(`${dir}/${name}`);
  const tables = new Map(), entriesOf = new Map();
  for (const path of [...new Set(paths)]) {
    const ns = await import(pathToFileURL(join(ROOT, path)).href);
    if (!Object.hasOwn(ns, 'STYLE_KINDS')) continue;
    const { entries } = moduleEntries(path, ns);
    const keys = new Map();
    for (const entry of entries) keys.set(entry.key, [...(keys.get(entry.key) ?? []), entry.text]);
    tables.set(path, keys);
    entriesOf.set(path, entries);
  }
  return { tables, entriesOf };
}

/** What a person does about each problem, said once, so the failure tells them. */
const what = (p) => (p.problem === 'unread' || p.problem === 'changed'
  ? `${p.problem}: ${p.module} ${p.key}\n    ${p.texts.map((t) => JSON.stringify(t)).join('\n    ')}\n    Read it. If it`
    + ' states an absence or a negative fact about the recording, the session or the code, tie it to the code that'
    + ' proves it (ABSENCE_REGISTRY) or make it say what Sonah found or could not read. Then record it in READ_CENSUS:'
    + ` '${p.key}': ['<${AUDIT_CLASSES.join('|')}>', '${p.fingerprint}'],`
  : `${p.problem}: ${p.module} ${p.key}`);

test('D100: every fixed sentence of the word tables was read, and none changed since', async () => {
  const { tables } = await wordTables();
  assert.ok(tables.size >= 10, 'the word modules are found');
  const problems = auditProblems(tables);
  assert.deepEqual(problems.map(what), []);
});

test('D100: the census reads every key the linter reads, in its closed classes, and counts them', async () => {
  const { tables } = await wordTables();
  const keys = [...tables].reduce((n, [, k]) => n + k.size, 0);
  const census = Object.values(READ_CENSUS).flatMap((m) => Object.values(m));
  assert.equal(census.length, keys);
  const count = (cls) => census.filter(([c]) => c === cls).length;
  // D101's cause and anchor words, read when D100 and D101 were joined: 11 sonah, 3 other. D104's mark and count words,
  // read when D100 and D104 were joined: 3 sonah, 4 other. The words for a working folder that the system refuses: 1
  // sonah, 1 other.
  assert.deepEqual(AUDIT_CLASSES.map(count), [71, 330, 362]);
  // The absence keys: proved, or held for the owner.
  const proved = Object.values(ABSENCE_REGISTRY).reduce((n, m) => n + Object.keys(m).length, 0);
  const held = Object.values(ABSENCE_HELD).reduce((n, m) => n + Object.keys(m).length, 0);
  assert.deepEqual([proved, held], [68, 3]);
});

test('D100: each proof names code that declares it, and every proof is used', async () => {
  const declares = (text, name) => new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|`
    + `(?:const|let)\\s+${name}\\b)`).test(text);
  for (const [id, proof] of Object.entries(ABSENCE_PROOFS)) {
    assert.ok(['recorder', 'search', 'system', 'gate'].includes(proof.kind), id);
    assert.ok(typeof proof.proves === 'string' && proof.proves.length > 0, id);
    assert.ok(proof.where.length > 0, id);
    for (const [file, name] of proof.where)
      assert.ok(declares(await readFile(join(ROOT, file), 'utf8'), name), `${id}: ${file} declares ${name}`);
  }
  const used = new Set(Object.values(ABSENCE_REGISTRY).flatMap((m) => Object.values(m).flatMap(Object.keys)));
  assert.deepEqual(Object.keys(ABSENCE_PROOFS).filter((id) => !used.has(id)), []);
});

/** The `class.form` pairs that `resultOutcome` (ledger.js `source`) can return: each `outcomeOf(class, form` in its
 *  body, a form named by a constant read from the module (`ledger`). Pure. */
function formsOfResultOutcome(source, ledger) {
  const start = source.indexOf('export function resultOutcome(');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  return new Set([...body.matchAll(/outcomeOf\(\s*'([^']+)'\s*,\s*(?:'([^']+)'|(\w+))/g)]
    .map(([, cls, form, name]) => `${cls}.${form ?? ledger[name]}`));
}

/** Every shipped source file of the packages (no test folder), by its path from the root. */
async function shippedSources(dir = 'packages') {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory() && !['test', 'node_modules'].includes(entry.name)) out.push(...await shippedSources(path));
    else if (entry.isFile() && /\.m?js$/.test(entry.name)) out.push(path);
  }
  return out;
}

test('D100: a held absence sentence is one a model request carries, or one that no reader reaches', async () => {
  const { entriesOf } = await wordTables();
  assert.deepEqual(HELD_REASONS, ['request_words', 'unreached']);
  const ledgerPath = 'packages/evidence/src/ledger.js';
  const sent = formsOfResultOutcome(await readFile(join(ROOT, ledgerPath), 'utf8'),
    await import(pathToFileURL(join(ROOT, ledgerPath)).href));
  assert.ok(sent.has('output-no-status.output') && sent.has('no-terminal-status.background'), [...sent].join(' '));
  // An outcome's words are read only by a request, through resultOutcome (prompt.js writes each result's outcome line):
  // no shipped reader takes another outcome's words.
  const readers = [];
  for (const path of await shippedSources())
    for (const line of (await readFile(join(ROOT, path), 'utf8')).split('\n'))
      for (const [, name] of line.matchAll(/\b(\w*Outcome)\([^()]*\)\.words\b/g)) readers.push(`${path} ${name}`);
  assert.deepEqual(readers, ['packages/evidence/src/prompt.js resultOutcome']);
  for (const [module, keys] of Object.entries(ABSENCE_HELD))
    for (const [key, reason] of Object.entries(keys)) {
      assert.ok(HELD_REASONS.includes(reason), `${module} ${key}`);
      const entries = entriesOf.get(module).filter((e) => e.key === key);
      assert.ok(entries.length && entries.every((e) => e.allows.includes('request-bytes')), `${module} ${key}`);
      // The reason of an outcome's words is decided by code: a form that resultOutcome returns is carried by a request,
      // and one it never returns is read by no one. Any other held key must be request words.
      const [table, cls, form] = key.split('.');
      if (module === ledgerPath && table === 'RESULT_OUTCOME_WORDS')
        assert.equal(reason, sent.has(`${cls}.${form}`) ? 'request_words' : 'unreached', `${module} ${key}`);
      else assert.equal(reason, 'request_words', `${module} ${key}`);
    }
});

test('D100: a word table that gains or changes a sentence fails the audit until a person reads it', () => {
  const census = { m: { 'T.read': ['other', fingerprintOf(['Sonah read it.'])],
    'T.gone': ['absence', fingerprintOf(['The recording holds no end of it.'])],
    'T.unproved': ['absence', fingerprintOf(['The agent ran nothing.'])] } };
  const registry = { m: { 'T.gone': { typed_stop: 'call' }, 'T.other': { no_such_proof: 'call' } } };
  const tables = new Map([['m', new Map([['T.read', ['Sonah read it, and more.']],
    ['T.gone', ['The recording holds no end of it.']], ['T.unproved', ['The agent ran nothing.']],
    ['T.new', ['The recording holds no result.']]])]]);
  const problems = auditProblems(tables, { census, registry, held: {} });
  assert.deepEqual(problems.map((p) => `${p.problem} ${p.key}`).sort(), ['changed T.read', 'not_absence T.other',
    'proof_unknown T.other', 'unread T.new', 'unregistered T.unproved']);
  // Read and recorded, the same tables pass.
  const read = { m: { ...census.m, 'T.read': ['other', fingerprintOf(['Sonah read it, and more.'])],
    'T.new': ['sonah', fingerprintOf(['The recording holds no result.'])] } };
  assert.deepEqual(auditProblems(tables, { census: read, registry: { m: { 'T.gone': { typed_stop: 'call' },
    'T.unproved': { typed_denial: 'call' } } }, held: {} }), []);
});

test('D100: an absence stands only on a proof whose code checks as far as its words claim', () => {
  // The review of A1c: "The recording does not show whether 1 write of a failed or stopped command happened." was
  // registered on a proof that reads one write's own record (its command's typed end), not the recording. Its words
  // claim the recording; its proof checks one call. The registry records the reach each sentence claims, read by a
  // person as its class is, and the audit holds it to the reach of the proof's code.
  assert.deepEqual(Object.keys(ABSENCE_SCOPES), ['call', 'recorder', 'lineage', 'recording', 'code', 'system',
    'judgment']);
  const old = 'The recording does not show whether 1 write of a failed or stopped command happened.';
  const now = 'Sonah could not read whether 1 write happened: it stopped before it finished, or its command failed or '
    + 'stopped.';
  const tables = new Map([['m', new Map([['T.old', [old]], ['T.now', [now]]])]]);
  const census = { m: { 'T.old': ['absence', fingerprintOf([old])], 'T.now': ['absence', fingerprintOf([now])] } };
  const problems = (registry, proofs = ABSENCE_PROOFS) => auditProblems(tables, { census, registry, held: {}, proofs })
    .map((p) => `${p.problem} ${p.key}${p.scope ? ` ${p.scope}` : ''}`);
  // The old words claim the whole recording; a call's typed end checks one call.
  assert.deepEqual(problems({ m: { 'T.old': { shell_write_result: 'recording' }, 'T.now': { typed_stop: 'call' } } }),
    ['scope_unproved T.old recording']);
  // Only a search of the recording's rows checks a claim over all of them.
  assert.deepEqual(problems({ m: { 'T.old': { background_end_absent: 'recording' }, 'T.now': { typed_stop: 'call' } } }),
    []);
  assert.deepEqual(problems({ m: { 'T.old': { typed_stop: 'everywhere' }, 'T.now': { typed_stop: 'call' } } }),
    ['scope_unknown T.old everywhere']);
  // A proof that names a reach its kind of code cannot check fails on its own.
  const proofs = { ...ABSENCE_PROOFS, shell_write_result: { ...ABSENCE_PROOFS.shell_write_result,
    scopes: ['recording'] } };
  assert.deepEqual(problems({ m: { 'T.old': { shell_write_result: 'recording' }, 'T.now': { typed_stop: 'call' } } },
    proofs), ['proof_scope shell_write_result recording']);
  // Every proof of the registry names reaches its kind can check, and every registered sentence's reach is checked
  // (the first test of this file runs the same audit on every word table).
  for (const [id, proof] of Object.entries(ABSENCE_PROOFS)) {
    assert.ok(proof.scopes.length > 0, id);
    for (const scope of proof.scopes) assert.ok(ABSENCE_SCOPES[scope].includes(proof.kind), `${id} ${scope}`);
  }
});

/** The names of the top-level functions of `source` that return `token` (`reason: TOKEN` or `error: TOKEN`). Pure. */
function returnersOf(source, token) {
  const names = new Set();
  const starts = [...source.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm)];
  for (const [i, m] of starts.entries()) {
    const body = source.slice(m.index, starts[i + 1]?.index ?? source.length);
    if (new RegExp(`return\\b[^;]*\\b(?:reason|error):\\s*${token}\\b`).test(body)) names.add(m[1]);
  }
  return names;
}

test('D100: the proof of a quote\'s place names every check of the code review that gives its cause', async () => {
  // The cause anchor_off_quote has one set of words, and two checks give it: a quote that is not on the lines that it
  // names (groundCodeReceipt), and a finding whose lines no code step of its trace quotes (groundFinding). Its proof
  // names both, so its words must hold for both.
  const source = await readFile(join(ROOT, 'packages/evidence/src/code-pass.js'), 'utf8');
  const returners = returnersOf(source, 'ANCHOR_OFF_QUOTE');
  assert.deepEqual([...returners].sort(), ['groundCodeReceipt', 'groundFinding']);
  const [proof] = Object.keys(ABSENCE_REGISTRY['packages/evidence/src/code-report.js']
    ['CODE_REPORT_WORDS.causes.anchor_off_quote']);
  const named = new Set(ABSENCE_PROOFS[proof].where.filter(([file]) => file === 'packages/evidence/src/code-pass.js')
    .map(([, name]) => name));
  assert.deepEqual([...returners].filter((name) => !named.has(name)), []);
});
