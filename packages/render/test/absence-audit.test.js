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
  REVIEW_ROW_KEYS, auditProblems, fingerprintOf } from './absence-audit.js';

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
  // sonah, 1 other. D105's words of what the code review saw and what Sonah did not send it: 9 sonah, 1 other; none
  // states an absence. Its review's: a file read with lines Sonah could not tell, and the terminal's words for a
  // request too large to send: 2 sonah. Its second review's: a file seen whole but not as it was before: 1 sonah.
  // D107's words of a repair that no item stood in place of: 12 sonah in (`unmatched`, `uncompared`, `ambiguous`,
  // `matched_past_limit` and `unnamed` twice each, `unplaced` for a finding, `brought`); the members read at an index
  // (`different`, `absent`, `repeated`: 6 sonah) kept for earlier reports, byte for byte; 1 other read again (a list
  // past its limit). D109's words of the one tally, read: 9 sonah in (`questionsChecked`, `rulesLinesUnknown`, the seen
  // groups but whole, `shownFiles` for an earlier report, `states.left_out`, `unseenShown`), 3 other (`seenGroups.whole`,
  // `states.other_repository`, `states.outside_writer_root`); `how`, `base`, `files`, `linesUnknown` and two footer kinds
  // read again in their classes; none states an absence ("Sonah found no recorded edit" says what Sonah found). D109's
  // review: 2 sonah in (`noAnswer`, a review whose call did not answer; `notInChange`, the writes Sonah counts and did not
  // review), 1 other (`change`, the size line's count of the change); `questionsChecked`, `footerKinds.outside_root` and
  // `unseenFiles` read again in their classes; none states an absence. D110's words of the premise contract: 6 sonah in
  // (a premise that Sonah could not check, the item to verify, its kind, its line beside an ask, its note, and the check
  // that holds on such a premise), 6 other (how
  // code computes the label, a check that it confirms, a premise in the repository or the language, the premise label,
  // the source of a finding to verify); none states an absence. Read again with new words: the code review's method and
  // its check (`how`, `checkHolds`: no second reviewer), a question from a finding, the line with no finding published,
  // a checked bug's kind and its bound, and the ask's status line. D110's review read four again, each in its class: how
  // code computes the label, a check that it confirms and a premise in the repository (what the check quotes or names,
  // never what Sonah says settles a premise: 3 other), and the line beside an ask (1 sonah); no count moved. D111's words
  // of the accounting: 4 sonah in (the asks, the statements written into a file and the decisions not to act left
  // without a check Sonah could use, and a finding of the accounting with no repair asked), 1 other (its part, as a
  // call that did not answer names it); none states an absence. The code step's line read again with the accounting's
  // calls, and the dry run's line of the code review's calls (2 other); no count moved. D111's review read seven again,
  // each in its class: the three counts by kind, now of what the item-by-item check did not examine in a way that Sonah
  // could use, never of the code review as a whole, and the finding with no repair asked (4 sonah); the part, and the two
  // terminal lines with the items named by the kinds in scope (3 other); no count moved. D111's second review: 1 sonah
  // in (the terminal's code review that covered the whole change but whose item-by-item check did not examine every
  // item in a way that Sonah could use), and the coverage line read again with no list named (sonah); none states an
  // absence.
  // The join of buckets B and C (0.3.0-beta.4): each side's count added to the other's; the code review's method read
  // again in its class with both sides' words (D109: what Sonah sent it; D110: the same model checks, never a second
  // reviewer; `how` other), and the open questions' checks the same way (`questionsChecked` sonah); no count moved.
  // E1-F8's (D112): an item's members line and two tier sentences, 3 other; a refused read's default tier, 1 absence
  // proved by the recorder's typed denial. Joined after bucket C: its count added; no sentence of either read again.
  // D111 amended (2026-10-18): the asks the item-by-item check did not examine, counted by whose words each rests on: 2
  // sonah in (an ask an agent wrote into a helper's brief; one Sonah could not trace to your own words), the person's
  // line read again under its new key (sonah), and the scope words that named every ask yours read again with the session
  // review's asks (`unrepaired.accounted` sonah; the code step's line and the dry run's, other). D109 amended: the
  // coverage line and the header's count of files the code review did not see, read again with how many of them its
  // checks read and whose reading Sonah counts (sonah). None states an absence.
  // D113 (0.3.0-beta.5, the session's own change): 3 absence in, each proved by the recorded writes' search (the files
  // that changed outside this session's recorded writes, on the page and on the terminal; a session with no write that
  // could have changed a file), 2 sonah in (the base line of a change that holds only the session's recorded writes; a
  // change with none of them in the working directory, as what Sonah found), and the terminal's line of the change read
  // again (sonah).
  // D113's review: the terminal's run-state words of an empty change, by why, as the page says them: 1 absence in (no
  // write that could have changed a file, by the recorded writes' search) and 1 sonah in (none of its writes in the
  // change).
  // D115: an ask of the session review that an agent wrote into a helper's brief, and one that Sonah read and could not
  // place among the asks of your prompt: 2 sonah in; the end-of-recording fact, an ask the session review tied only to
  // the agent's words (its line and its count) read again with new words (sonah). None states an absence.
  // The join of 0.3.0-beta.5's two lanes (D113 and D114; D115 and D116): each side's count added to the other's; no
  // sentence of either read again.
  // D113 amended (the owner, 2026-10-18: "tag it by outside the evaluated session"): 7 absence in, each proved by the
  // recorded writes' search that places a file outside the evaluated session (the tag beside a file and a withheld
  // finding, the line of the files the code review was given, what it saw of them, an item about such code, their count
  // and the tag after a label, and the files list's line of them); the page's and the terminal's lines of the files named
  // apart read again with the tag (absence). Its review: 2 absence in, by the same search (why an ask not met or a claim
  // the code contradicts, anchored in such a file, is withheld). Its second review: 1 absence in, by the same search
  // (the PR comment's count of the findings about code outside the evaluated session).
  // D117 (the session's change in every repository or folder it wrote to): 2 absence in, proved by the recorded writes'
  // search (the files of another git repository that changed outside this session's recorded writes, on the page and in
  // the dry run), 4 sonah in (another repository's base line, with the files of it no recorded write changed; a place
  // whose change is the recorded edits, Sonah naming where git could not say; where the change's files lie and how many
  // the code review did not see; the dry run's line of a working directory with no start commit beside other places),
  // 3 other in (where a file of the files list lies; the dry run's line of each other place, and its tail); read again:
  // the header's count of the change with how many places hold it (other), the base lines with the working directory's
  // repository named (sonah), and the footer's home folders with Sonah's own (sonah). Its review: 1 other in (the dry
  // run's tail when no repository holds the working directory); read again: the dry run's tail with places and the code
  // step's line (other), and its line of no change (sonah), each with the working directory named when no repository
  // holds it, the code step's line also with the other folders its agents read. Where D117 meets D113 amended: 1 absence
  // in, by the same search (another repository's files named apart, given to the code review), and another repository's
  // files named apart, on the page and in the dry run, read again in D113 amended's words. D117 amended (the owner,
  // 2026-10-18): 5 sonah in (the folders of no repository the session wrote to, listed and not reviewed, and its writes
  // not resolved, counted apart, each on the page and in the dry run; that Sonah does not yet see every edit of helper
  // agents or of scripts after a cd).
  // D118 (the owner's go, 2026-10-18; the dogfood's DF2 and DF1): the first screen's "No code was reviewed." and its
  // closed reasons, 1 absence in (no write that could have changed a file, by the recorded writes' search) and 10 sonah
  // in; the folder's label, 1 other; the terminal's status words when no code was reviewed, 2 sonah; the paths the
  // recording does not resolve, 1 sonah; the items' line beside the no-code sentence replaces the old no-code line
  // (sonah). D119 (DF11): 6 sonah in, each kind that the inventory cause summed, in one unit (workflow runs, run folder
  // entries, workflow calls with no launch, helper recordings read in part, calls whose input Sonah holds in part, calls
  // of code cells no recorded item accounts for); its sentence on the page and in the coverage causes read again,
  // counted by kind (sonah). D122 (b), the beta.5 integration: 1 absence out (D112's refused read's default tier,
  // removed: it placed no stored row). D122 (a review low of D118): 1 sonah in, the GitHub check's title of a run that
  // finished and reviewed no code; and 1 sonah in, the closed reason of a record of an earlier code step that made no
  // request and did not record why. D122 (d) (the dogfood rerun's relative names): 1 sonah in, the closed cause of an
  // item whose relative path more than one place of the change holds. D123 (the beta.5 end-to-end smoke): 5 sonah in, no
  // write of the session that Sonah can read beside shell commands (the code review's line, the first screen's reason,
  // the terminal's run-state words, the Files section) and the Files section where no git base names a repository; the
  // heading of What the agent did read again with no count of files (other). None states an absence. D124 (the
  // --code-repo option): 2 sonah in, the fixes of a folder given with --code-repo that is not there or in no git
  // repository ("Sonah read and sent nothing"); the first screen's reason `no_seen_write` read again with the way out
  // (sonah), and the review's usage with the option (other). D124's review: 2 sonah in, the first screen's reason when a
  // repository was given with --code-repo (`no_seen_write_given`) and the line of the working folder's own repository
  // given (`givenHere`). D125 (an ask that the code review checked in the code): 4 other in, the status, the count
  // part, the line of the code review's verdict and the lead of where Sonah found its quotes; none states an absence.
  // D125 amended (the owner: "go for option 3"; the status and the counts as before, a note on the row): 3 other out
  // (the status, the count part, the lead of where Sonah found its quotes), the verdict's line read again with the lead
  // (other), and 1 sonah in (that Sonah did not check it); none states an absence.
  // D126 (N0, a session that opens on a compaction): 5 sonah in (the part before it not read, by each of its 4 reasons,
  // and the terminal's line when it was not read), 1 other (the terminal's line when it was read). D127 (B10d, N1): 1
  // absence in (a compaction and what the agent's context dropped, on the recorder's typed counts: `typed_compaction`), 1
  // sonah (the part before the compaction that Sonah did not read, beside the title), 2 other (the recordings Sonah read
  // the session from, and the first compaction after an ask). D129 (C7, what a review cost): 1 sonah in, the footer's
  // sentence of Sonah's own calls, tokens, time and usage limits ("no model calls" is a fact of Sonah's run, from its
  // usage record), and 4 other in, each usage limit's name; none states an absence. Joined at the beta.6 integration:
  // [89, 424, 383] + D126 and D127's [1, 6, 3] + D129's [0, 1, 4]. D131 (R1, a shortened report .md): 1 sonah in, the
  // count of your messages that the report does not show (what Sonah shows, never a fact of the recording). D132 (R3 b):
  // 1 sonah in, the footer's sentence of what the whole review cost over its runs, and the run's own sentence read again
  // with the list cost that FOOTER_LIST_COST may add (sonah); none states an absence. D133 (R2, quiet the gap lines): 2
  // other in, the count line's sentence split in two (Sonah found nothing for Must act or Must know, read again as sonah;
  // that this does not mean the work is correct, other) and the short line beside the title of a session whose earlier
  // part Sonah did not read (other); none states an absence. D133's review: 1 sonah out, the terminal coverage line's
  // part "code pass reviewed no code" (RUN_STATE_WORDS `codePassNoCode`), with the line. Where D131 and D132 meet D133:
  // [90, 431, 390] + D131 and D132's [0, 2, 0] + D133's [0, -1, 2].
  // D131's review: 1 sonah in, the .md's sentence of what Sonah checked when its table does not show every ask.
  assert.deepEqual(AUDIT_CLASSES.map(count), [90, 433, 392]);
  // The absence keys: proved, or held for the owner. D115: and the session review's row sentences (REVIEW_ROW_KEYS),
  // each registered on its proof.
  const proved = Object.values(ABSENCE_REGISTRY).reduce((n, m) => n + Object.keys(m).length, 0);
  const held = Object.values(ABSENCE_HELD).reduce((n, m) => n + Object.keys(m).length, 0);
  const rows = Object.values(REVIEW_ROW_KEYS).reduce((n, keys) => n + keys.length, 0);
  // E1-F8 (D112): one more proved, a refused read's default tier (the recorder's typed denial). D113: three more, by the
  // recorded writes' search; D113's review: one more, the terminal's run-state words of a session with no such write.
  // D115: 6 row sentences. D113 amended: 7 more, by the recorded writes' search; its review: 2 more, by the same search;
  // its second review: 1 more, by the same search. D117: two more, by the recorded writes' search (another repository's
  // files named apart, on the page and in the dry run); the merge: one more, by the same search (another repository's
  // files named apart, given to the code review). D118 (a): 1 more, by the same search (the first screen's no-write
  // reason). D122 (b): E1-F8's one out again (the refused read's default tier is removed). D127 (B10d): 1 more, by the
  // compaction's typed boundary row (`typed_compaction`).
  assert.deepEqual([proved - rows, rows, held], [87, 6, 3]);
});

test('D100: each proof names code that declares it, and every proof is used', async () => {
  const declares = (text, name) => new RegExp(`(?:^|\\n)\\s*(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|`
    + `(?:const|let)\\s+${name}\\b)`).test(text);
  for (const [id, proof] of Object.entries(ABSENCE_PROOFS)) {
    assert.ok(['recorder', 'search', 'system', 'gate', 'report'].includes(proof.kind), id);
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
  const problems = auditProblems(tables, { census, registry, held: {}, rows: {} });
  assert.deepEqual(problems.map((p) => `${p.problem} ${p.key}`).sort(), ['changed T.read', 'not_absence T.other',
    'proof_unknown T.other', 'unread T.new', 'unregistered T.unproved']);
  // Read and recorded, the same tables pass.
  const read = { m: { ...census.m, 'T.read': ['other', fingerprintOf(['Sonah read it, and more.'])],
    'T.new': ['sonah', fingerprintOf(['The recording holds no result.'])] } };
  assert.deepEqual(auditProblems(tables, { census: read, registry: { m: { 'T.gone': { typed_stop: 'call' },
    'T.unproved': { typed_denial: 'call' } } }, held: {}, rows: {} }), []);
});

test('D100: an absence stands only on a proof whose code checks as far as its words claim', () => {
  // The review of A1c: "The recording does not show whether 1 write of a failed or stopped command happened." was
  // registered on a proof that reads one write's own record (its command's typed end), not the recording. Its words
  // claim the recording; its proof checks one call. The registry records the reach each sentence claims, read by a
  // person as its class is, and the audit holds it to the reach of the proof's code.
  assert.deepEqual(Object.keys(ABSENCE_SCOPES), ['call', 'recorder', 'lineage', 'recording', 'code', 'system',
    'judgment', 'review']);
  const old = 'The recording does not show whether 1 write of a failed or stopped command happened.';
  const now = 'Sonah could not read whether 1 write happened: it stopped before it finished, or its command failed or '
    + 'stopped.';
  const tables = new Map([['m', new Map([['T.old', [old]], ['T.now', [now]]])]]);
  const census = { m: { 'T.old': ['absence', fingerprintOf([old])], 'T.now': ['absence', fingerprintOf([now])] } };
  const problems = (registry, proofs = ABSENCE_PROOFS) => auditProblems(tables, { census, registry, held: {}, proofs,
    rows: {} })
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
