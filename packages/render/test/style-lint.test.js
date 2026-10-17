// Sonah's style linter (docs/STYLE.md): each rule on a sentence that breaks it and on its corrected form, the
// structural errors of a module's declarations, and the modules that must pass it. Pure: it imports the modules and
// reads their tables; it renders nothing and sends nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { lintText, lintModules, moduleEntries, reportLines, sentencesOf, passiveOf, actionFault, STYLE_RULES,
  STYLE_KIND_NAMES, STYLE_ALLOW_NAMES, MAX_SENTENCE_WORDS, WORD_MODULE_DIRS, WORD_MODULES_NAMED } from './style-lint.js';
import { steWordCount } from '../../evidence/src/ste-count.js';
import * as ledger from '../../evidence/src/ledger.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rules = (text, kind = 'description', options) => [...new Set(lintText(text, kind, options).map((v) => v.rule))];

// ---- each rule fires on a bad sentence and is silent on its corrected form ------------------------------------------

const PAIRS = [
  ['L1-length', 'Sonah read every recorded result of the session and every edit of the agent before it wrote this '
    + 'page for you to read today.', 'Sonah read every recorded result and every edit before it wrote this page.'],
  ['L2-passive', 'The quote was not found in the recording.', 'Sonah did not find the quote in the recording.'],
  ['L4-semicolon', 'The command failed; the agent did not say so.', 'The command failed. The agent did not say so.'],
  ['L5-contraction', "The agent didn't run the tests.", 'The agent did not run the tests.'],
  ['L6-term', 'The user asked for a cache.', 'You asked for a cache.'],
  ['L7-phrase', 'Sonah lists the files, e.g. the tests.', 'Sonah lists the files, for example the tests.'],
  ['L8-ing', 'The agent is running the tests.', 'The agent runs the tests.'],
  ['L10-hedge', 'The change may break the build.', 'Sonah did not check whether the change breaks the build.'],
];
for (const [rule, bad, good] of PAIRS) {
  test(`style lint ${rule}: fires on a sentence that breaks it, and is silent on its corrected form`, () => {
    assert.ok(rules(bad).includes(rule), `${rule} on: ${bad}`);
    assert.ok(!rules(good).includes(rule), `${rule} on: ${good}`);
    assert.equal(STYLE_RULES[rule], ['L8-ing', 'L10-hedge'].includes(rule) ? 'warning' : 'error');
  });
}

test('style lint L3-one-action: one imperative sentence, one action verb, the verb first', () => {
  assert.deepEqual(rules('Commit your work and push the commit.', 'action'), ['L3-one-action']);
  assert.deepEqual(rules('Commit your work. Push the commit.', 'action'), ['L3-one-action'], 'two sentences');
  assert.deepEqual(rules('Your work needs a commit.', 'action'), ['L3-one-action'], 'not a verb first');
  assert.deepEqual(rules('Commit your work.', 'action'), []);
  // An alternative is one action, and a condition may come first (S13).
  assert.deepEqual(rules('Choose a new --output file, or leave out --output.', 'action'), []);
  assert.deepEqual(rules('If the folder does not exist, create it.', 'action'), []);
  assert.equal(actionFault('Wait for the other review, then retry.'), 'a second action verb');
  // Only an action is held to it.
  assert.deepEqual(rules('Commit your work and push the commit.', 'notice'), []);
});

test('style lint L9-paragraph: a description or a notice of more than six sentences', () => {
  const seven = Array.from({ length: 7 }, (_, i) => `Sonah checked part ${i + 1}.`).join(' ');
  assert.ok(rules(seven, 'notice').includes('L9-paragraph'));
  assert.ok(rules(seven, 'description').includes('L9-paragraph'));
  assert.ok(!rules(seven.split('. ').slice(0, 6).join('. '), 'notice').includes('L9-paragraph'));
  assert.ok(!rules(seven, 'fragment').includes('L9-paragraph'));
});

test('style lint L12-render: a rendered entry never holds undefined, NaN, an object or two spaces', () => {
  for (const bad of ['Sonah read undefined files.', 'Sonah read NaN files.', 'Sonah read [object Object].',
    'Sonah read  two files.'])
    assert.ok(rules(bad, 'description', { rendered: true }).includes('L12-render'), bad);
  assert.ok(!rules('Sonah read two files.', 'description', { rendered: true }).includes('L12-render'));
  assert.ok(!rules('Sonah read  two files.', 'description').includes('L12-render'), 'a fixed string is not rendered');
});

test('style lint, the known misfires: an -ed adjective, "not" before a participle, and words that only end in -ing', () => {
  assert.equal(passiveOf('The person is excited.'), null, 'an -ed adjective on the allowlist');
  assert.equal(passiveOf('The status is unchanged.'), null, 'an un-…-ed word reads as an adjective');
  assert.equal(passiveOf('The cache is not used.'), 'is not used', 'one word between "be" and the participle');
  assert.equal(passiveOf('The cache is only read once.'), 'is only read', 'an irregular participle');
  assert.equal(passiveOf('The result got lost.'), 'got lost', '"get" makes a passive too');
  assert.equal(passiveOf('The file is in the repository.'), null);
  for (const word of ['nothing', 'something', 'during', 'recording', 'findings'])
    assert.ok(!rules(`Sonah found ${word} new.`).includes('L8-ing'), word);
  // A glossary term inside an allowed phrase, an option name or code is not the term.
  assert.deepEqual(rules('Post the report on the pull request.'), []);
  assert.deepEqual(rules('Read the project instruction file.'), []);
  assert.deepEqual(rules('Turn it off with --no-code-pass.'), []);
  assert.deepEqual(rules('Run `claude --model x` in Claude Code.'), []);
  assert.ok(rules('Claude wrote the code.').includes('L6-term'));
  // A term is matched with its plural too.
  for (const plural of ['The agent made two choices.', 'Sonah lists the rows.', 'The agent kept its promises.',
    'Sonah read the transcripts.', 'Sonah read your requests.'])
    assert.ok(rules(plural).includes('L6-term'), plural);
  assert.ok(rules('Every finding', 'heading').includes('L6-term'), 'finding is a heading term only');
  assert.ok(!rules('Sonah lists every finding.', 'description').includes('L6-term'));
});

test('style lint: sentences split at a line break and after . ! ? before an upper-case letter, a digit or a quote', () => {
  assert.deepEqual(sentencesOf('One. Two! Three? "Four." 5 more.\nSix'), ['One.', 'Two!', 'Three?', '"Four."', '5 more.', 'Six']);
  assert.deepEqual(sentencesOf('Read src/a.js. then stop.'), ['Read src/a.js. then stop.']);
  assert.deepEqual(sentencesOf('  \n— ·'), []);
});

test('style lint: words are counted the STE way', () => {
  assert.equal(steWordCount('Read src/a.js:12 (the second branch) with `npm test -- --watch` now.'), 6);
  assert.equal(steWordCount('A well-known {name} — 3 files · 2 runs.'), 7);
  assert.equal(steWordCount('file(s) and run(s)'), 3);
  assert.equal(MAX_SENTENCE_WORDS, 20);
});

// ---- structure -------------------------------------------------------------------------------------------------------

test('style lint: an entry with no kind, a function with no fixture and a declaration that names nothing are errors', () => {
  const ns = { STYLE_KINDS: { 'T.a': 'notice', 'T.fn': 'notice', GONE: 'label', 'T.b': 'shouting' },
    STYLE_FIXTURES: { 'T.missing': [[1]] }, STYLE_ALLOW: { 'T.a': ['nonsense'], 'T.zz': ['actor-unknown'] },
    T: { a: 'Sonah read it.', b: 'Sonah read it.', c: 'Sonah read it.', fn: (n) => `Sonah read ${n}.`, nested: { d: 'x' } } };
  const codes = moduleEntries('m', ns).errors.map((e) => `${e.code} ${e.key}`).sort();
  assert.deepEqual(codes, ['allow_unknown T.a', 'allow_unused T.zz', 'fixture_missing T.fn', 'fixture_unused T.missing',
    'kind_missing T.c', 'kind_missing T.nested.d', 'kind_unknown T.b', 'kind_unused GONE']);
  assert.deepEqual(moduleEntries('m', {}).errors.map((e) => e.code), ['tables_missing']);
  // A whole table may take one kind; a member's own kind wins; a function renders once per fixture.
  const ok = { STYLE_KINDS: { T: 'notice', 'T.title': 'heading' }, STYLE_FIXTURES: { 'T.fn': [[1], [2]] },
    T: { title: 'What Sonah read', fn: (n) => `Sonah read ${n} files.` } };
  const { entries, errors } = moduleEntries('m', ok);
  assert.deepEqual(errors, []);
  assert.deepEqual(entries.map((e) => [e.key, e.kind, e.text]), [['T.title', 'heading', 'What Sonah read'],
    ['T.fn', 'notice', 'Sonah read 1 files.'], ['T.fn', 'notice', 'Sonah read 2 files.']]);
  assert.ok(STYLE_KIND_NAMES.includes('fragment') && STYLE_ALLOW_NAMES.includes('request-bytes'));
});

test('style lint: an allow passes only its own rule, is counted, and request-bytes lists errors without failing', () => {
  const ns = { STYLE_KINDS: { T: 'notice' }, STYLE_ALLOW: { 'T.passive': ['actor-unknown'], 'T.request': ['request-bytes'],
    'T.both': ['actor-unknown'], 'T.term': ['quoted-term'], 'T.ing': ['technical-noun'] },
    T: { passive: 'The call was refused before it ran.', request: 'The call was refused; it did not run.',
      plain: 'The call was refused.', both: 'The call was refused; it did not run.',
      term: 'You typed "the user"; Sonah kept it.', ing: 'The working directory is gone; Sonah stopped.' } };
  const report = lintModules([['m', ns]]);
  // An entry's allow passes its own rule only: the semicolon beside an allowed passive, quoted term or "-ing" noun is
  // still an error.
  assert.deepEqual(report.errors.map((v) => `${v.key} ${v.rule}`), ['T.both L4-semicolon', 'T.ing L4-semicolon',
    'T.plain L2-passive', 'T.term L4-semicolon']);
  assert.deepEqual(report.byAllow, { 'actor-unknown': 2, 'quoted-term': 1, 'request-bytes': 2, 'technical-noun': 1 });
  assert.ok(reportLines(report).some((line) => line.startsWith('T.request L4-semicolon (request-bytes) "')));
});

// ---- the modules that must pass ---------------------------------------------------------------------------------------

/** Every module the linter discovers, and the ones that must declare their tables. */
const DISCOVERED = WORD_MODULE_DIRS;
const NAMED = WORD_MODULES_NAMED;
const MANDATORY = ['packages/evidence/src/review.js', 'packages/evidence/src/code-report.js',
  'packages/evidence/src/ledger.js', 'packages/cli/src/session-review-command.js', 'packages/cli/src/pr-sharing.js',
  'packages/cli/src/local-page.js', 'packages/github/publication.js',
  // D97's report: the page's and the .md's words, the .md's own, and the lines the CLI prints after the review.
  'packages/render/report-words.js', 'packages/render/session-story.js', 'packages/cli/src/report-output.js'];

async function discovered() {
  const paths = [...NAMED];
  for (const dir of DISCOVERED)
    for (const name of (await readdir(join(ROOT, dir))).sort()) if (name.endsWith('.js')) paths.push(`${dir}/${name}`);
  const modules = [];
  for (const path of [...new Set(paths)]) modules.push([path, await import(pathToFileURL(join(ROOT, path)).href)]);
  return modules;
}

test('style lint: every mandatory module declares its tables, and the fixed words of each pass with no error', async (t) => {
  const modules = await discovered();
  for (const path of MANDATORY) assert.ok(modules.some(([p]) => p === path), `${path} is discovered`);
  const linted = modules.filter(([path, ns]) => MANDATORY.includes(path) || Object.hasOwn(ns, 'STYLE_KINDS'));
  const report = lintModules(linted);
  t.diagnostic(reportLines(report).join('\n'));
  assert.deepEqual(report.structure.map((e) => `${e.module} ${e.code} ${e.key}`), []);
  assert.deepEqual(report.errors.map((v) => `${v.module} ${v.key} ${v.rule} "${v.sentence}"`), []);
  // The words a model request carries are listed and counted, never rewritten in place.
  assert.ok((report.byAllow['request-bytes'] ?? 0) > 0, 'ledger.js result words are listed');
});

// The page has no word table of its own: each table it exports is report-words.js's own object (the linter reads it
// there), so a word added to the page alone would fail here, not slip past the linter.
test('style lint: the page\'s word tables are report-words.js\'s, so the linter reads every word the page shows', async () => {
  const page = await import(pathToFileURL(join(ROOT, 'packages/render/session-page.js')).href);
  const reportWords = await import(pathToFileURL(join(ROOT, 'packages/render/report-words.js')).href);
  const tables = Object.entries(page).filter(([name, value]) => /_WORDS$/.test(name) && value && typeof value === 'object');
  assert.deepEqual(tables.map(([name]) => name).sort(), ['PAGE_ANSWER_WORDS', 'PAGE_CAUSE_WORDS', 'PAGE_COLUMN_REASON_WORDS',
    'PAGE_GAP_WORDS']);
  for (const [name, table] of tables)
    assert.ok(Object.values(reportWords).includes(table), `${name} is a report-words.js table`);
  assert.equal(Object.hasOwn(page, 'STYLE_KINDS'), false, 'its words are declared where they are written');
});

/** The relative modules `path` imports, statically or dynamically, and re-exports, as paths from the repository root. */
async function importsOf(path) {
  const text = await readFile(join(ROOT, path), 'utf8');
  const specifiers = [...text.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((m) => m[1]);
  return specifiers.map((s) => join(dirname(path), s));
}
/** Every module `entry` reaches by its imports, itself included. */
async function closureOf(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    if (path.endsWith('.js') || path.endsWith('.mjs')) queue.push(...await importsOf(path));
  }
  return seen;
}

test('style lint: no request builder reaches the word tables the rewrite moved, so no request byte moves', async () => {
  const builders = ['prompt.js', 'challenge.js', 'code-context.js', 'code-pass.js', 'review-agent.js',
    'code-review-prompt.js'].map((name) => join('packages/evidence/src', name));
  const moved = ['packages/evidence/src/review.js', 'packages/evidence/src/code-report.js',
    'packages/cli/src/session-review-command.js', 'packages/cli/src/pr-sharing.js', 'packages/cli/src/local-page.js',
    'packages/github/publication.js'];
  for (const builder of builders) {
    const reached = await closureOf(builder);
    assert.ok(reached.size > 1, `${builder} imports modules`);
    for (const words of moved) assert.ok(!reached.has(words), `${builder} reaches ${words} through its imports`);
  }
});

// The words a model request carries (every session-only request writes each result's `outcome:` line from these), so
// they are pinned here as they are: changing one moves request bytes, and no stored answer would replay. D100 (review
// of A1c): the two forms of a write whose command failed or stopped are an ACTION's (`actionOutcome`), which
// `resultOutcome` never returns, so no request carries them; their words were rewritten to say what Sonah could read,
// and no request byte moved.
test('style lint: the words a model request carries are not rewritten', async () => {
  assert.equal(ledger.STOPPED_WORDS, 'stopped before it finished');
  const source = await readFile(join(ROOT, 'packages/evidence/src/ledger.js'), 'utf8');
  const start = source.indexOf('export function resultOutcome(');
  const body = source.slice(start, source.indexOf('\n}\n', start));
  assert.ok(start > 0 && body.includes('outcomeOf('));
  for (const form of ['command-failed', 'command-stopped']) assert.equal(body.includes(form), false, form);
  assert.deepEqual(['failed', 'stopped'].map(ledger.shellWriteWords), [
    'command failed, so Sonah could not read whether this write happened',
    'command stopped before it finished, so Sonah could not read whether this write happened']);
  assert.deepEqual(JSON.parse(JSON.stringify(ledger.RESULT_OUTCOME_WORDS)), {
    'ran-exit-0': { exit: 'ran, exit 0' },
    'ran-completed': { typed: 'ran, completed' },
    'ran-failed': { exit: 'ran, failed (exit {n})', flag: 'ran, failed (error flag set)',
      typed: 'ran, failed (the recorder typed it as failed)' },
    'did-not-run': { denial: 'did not run (the recorder typed the call as {kind})' },
    'no-terminal-status': { background: 'no terminal status recorded (run in the background)',
      none: 'no terminal status recorded (no result recorded)',
      interrupted: 'no terminal status recorded (stopped before it finished)',
      cancelled: 'no terminal status recorded (the recorder typed it as cancelled)',
      'command-failed': 'no terminal status recorded (its command failed, so Sonah could not read whether this write '
        + 'happened)',
      'command-stopped': 'no terminal status recorded (its command stopped before it finished, so Sonah could not read '
        + 'whether this write happened)' },
    'failed-or-refused': { untyped: 'failed or refused before it ran; the recorder does not type which' },
    'output-no-status': { output: 'output recorded; no exit code or completion typed for it',
      unread: 'result recorded; none of its output is shown, and no exit code or completion is typed for it' },
    // D99 (F1 guard): a new class, added; no word above moved. Its review added a form with the same words, so no
    // request byte moved for it.
    'end-unread': { background: 'run in the background; Sonah could not read whether or how it ended',
      unchecked: 'run in the background; Sonah could not read whether or how it ended' },
  });
});

test('style lint: request-bytes passes only words that a model request carries', async () => {
  const modules = await discovered();
  const carried = moduleEntries('ledger', ledger).entries.filter((e) => e.allows.includes('request-bytes'))
    .map((e) => e.text);
  assert.ok(carried.length > 0);
  // Outside ledger.js, an entry that carries the reason holds the ledger's words literally: a sentence of its own does
  // not hide behind it.
  for (const [path, ns] of modules) {
    if (path === 'packages/evidence/src/ledger.js' || !Object.hasOwn(ns, 'STYLE_KINDS')) continue;
    for (const entry of moduleEntries(path, ns).entries.filter((e) => e.allows.includes('request-bytes')))
      assert.ok(carried.some((words) => entry.text.includes(words)), `${path} ${entry.key}: "${entry.text}"`);
  }
});
