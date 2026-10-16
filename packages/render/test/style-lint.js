// The style linter for Sonah's own fixed words (docs/STYLE.md): plain English at about 80% of ASD-STE100. It reads the
// word tables a module declares (`STYLE_KINDS`, `STYLE_FIXTURES`, `STYLE_ALLOW`) and checks the form of each sentence:
// its length, its voice markers, its punctuation and the listed terms. It never reads session text or model output,
// so it judges form, never meaning; what only a person can check is listed in docs/STYLE.md.
//
// Pure helpers, Node stdlib only: no network, model, clock or random read. Same tables in, same report out.
import { steWordCount } from '../../evidence/src/ste-count.js';

/** The kind of each string, declared by the module beside its tables (from structure: which table and which key). */
export const STYLE_KIND_NAMES = Object.freeze(['heading', 'label', 'status', 'action', 'description', 'notice',
  'fragment']);
/** The closed reasons a table entry may carry to pass a rule:
 *    actor-unknown   a passive whose actor nobody can know (L2)
 *    quoted-term     the entry names a term the person or a tool uses (L6, L7)
 *    technical-noun  an "-ing" word that is a technical noun (L8)
 *    request-bytes   a model request carries the entry's words, so they are not rewritten: its errors are listed and
 *                    counted, and do not fail. */
export const STYLE_ALLOW_NAMES = Object.freeze(['actor-unknown', 'quoted-term', 'technical-noun', 'request-bytes']);

/** The rules, each with its level. L11 (an item starts with its type word) is the renderer's, not the linter's. */
export const STYLE_RULES = Object.freeze({
  'L1-length': 'error', 'L2-passive': 'error', 'L3-one-action': 'error', 'L4-semicolon': 'error',
  'L5-contraction': 'error', 'L6-term': 'error', 'L7-phrase': 'error', 'L8-ing': 'warning', 'L9-paragraph': 'error',
  'L10-hedge': 'warning', 'L12-render': 'error' });
/** The structural errors: a module's tables that the linter cannot read as declared. */
export const STYLE_STRUCTURE_ERRORS = Object.freeze(['kind_missing', 'kind_unknown', 'kind_unused', 'fixture_missing',
  'fixture_unused', 'fixture_not_text', 'allow_unknown', 'allow_unused', 'tables_missing']);

/** S1: at most 20 words a sentence, counted the STE way (`steWordCount`). */
export const MAX_SENTENCE_WORDS = 20;
/** S12: at most 6 sentences a paragraph (one table entry). */
export const MAX_PARAGRAPH_SENTENCES = 6;

const BE_FORMS = Object.freeze(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'get', 'gets', 'got',
  'gotten', 'getting']);
/** At most one of these may stand between the form of "be" and the participle (an "-ly" word too). */
const BETWEEN = Object.freeze(['not', 'also', 'only']);
/** Past participles that do not end in "-ed". */
export const IRREGULAR_PARTICIPLES = Object.freeze(['begun', 'bound', 'broken', 'brought', 'built', 'bought', 'caught',
  'chosen', 'cut', 'done', 'drawn', 'driven', 'fallen', 'forbidden', 'forgotten', 'found', 'frozen', 'given', 'grown',
  'held', 'hidden', 'kept', 'known', 'laid', 'led', 'left', 'lost', 'made', 'meant', 'met', 'mistaken', 'overridden',
  'overwritten', 'paid', 'put', 'read', 'rerun', 'rewritten', 'run', 'said', 'seen', 'sent', 'set', 'shown', 'sold',
  'spent', 'split', 'spoken', 'stolen', 'struck', 'stuck', 'taken', 'taught', 'thought', 'thrown', 'told', 'torn',
  'understood', 'undone', 'upheld', 'withdrawn', 'withheld', 'written']);
/** Words that end in "-ed" and are not past participles after "be": adjectives, and words that only end so. A word
 *  that starts with "un-" and ends in "-ed" reads as an adjective too ("unchanged"). */
export const ED_NOT_PARTICIPLES = Object.freeze(['advanced', 'beloved', 'bored', 'complicated', 'concerned',
  'crooked', 'detailed', 'embed', 'exceed', 'excited', 'feed', 'hundred', 'indeed', 'interested', 'naked', 'need',
  'pleased', 'proceed', 'red', 'rugged', 'sacred', 'seed', 'shed', 'speed', 'succeed', 'surprised', 'tired', 'wicked',
  'worried']);
/** The verbs an action may start with (S3): Sonah's own instructions to the person. */
export const ACTION_VERBS = Object.freeze(['add', 'answer', 'ask', 'change', 'check', 'choose', 'commit', 'confirm',
  'copy', 'create', 'delete', 'fix', 'give', 'install', 'keep', 'leave', 'make', 'move', 'name', 'open', 'post', 'push',
  'read', 'remove', 'rename', 'replace', 'rerun', 'retry', 'run', 'send', 'set', 'share', 'skip', 'start', 'stop',
  'type', 'update', 'use', 'wait', 'write']);
/** A condition that may come before the action (S13: "If X, then Y"): the action's verb is then the first word after
 *  the condition's comma. */
const CONDITION_WORDS = Object.freeze(['if', 'when', 'after', 'before', 'unless', 'once']);
/** The words a second action verb may not follow in one action (S3). */
const JOINERS = Object.freeze(['and', 'then']);

/**
 * S4, the glossary: each term Sonah does not use, and the term it uses instead. Matched as whole words, in any case,
 * with a plural. `kinds` limits a term to those kinds of text. The allowed phrases are taken out first.
 */
export const GLOSSARY = Object.freeze([
  ['the user', 'you'], ['the developer', 'you'], ['the human', 'you'], ['human', 'you, or your message'],
  ['the assistant', 'the agent'], ['the model', 'the agent, or the session review'], ['claude', 'the agent'],
  ['we', 'Sonah'], ['the review', 'Sonah, the session review or the code review'],
  ['code pass', 'the code review'], ['code step', 'the code review'], ['review agent', 'the code review'],
  ['your requests', 'your prompt'], ['your instructions', 'your prompt'],
  ['request', 'message, or ask'], ['requirement', 'ask'], ['instruction', 'ask, or message'],
  ['choice', 'decision'], ['judgment', 'decision'], ['judgement', 'decision'],
  ['promise', 'claim'], ['statement', 'claim'],
  ['verified', 'checked'], ['confirmed', 'checked'], ['grounded', 'checked'],
  ['unverified', 'not checked'], ['unknown', 'not checked'],
  ['transcript', 'the recording'], ['the log', 'the recording'],
  ['row', 'item'], ['finding', 'item', ['heading']],
].map(([term, use, kinds = null]) => Object.freeze({ term, use, kinds })));
/** Phrases that hold a glossary term and are allowed: technical nouns and the one statement the glossary keeps (a
 *  statement that the agent wrote into a file, which names who wrote it). */
export const ALLOWED_PHRASES = Object.freeze(['pull request', 'pull requests', 'instruction file', 'instruction files',
  'claude code', 'claude-cli', 'statement that the agent wrote', 'statements that the agent wrote']);
/** S5: idioms, phrasal verbs, Latin abbreviations and wordy phrases. */
export const BANNED_PHRASES = Object.freeze(['e.g.', 'i.e.', 'etc.', 'via', 'go with', 'down the line', 'in terms of',
  'take a look', 'set up', 'figure out', 'look into', 'point out', 'in order to', 'make sure', 'check out',
  'carry out', 'find out']);
/** S9: "-ing" words that are allowed: the glossary nouns and the function words. */
export const ING_ALLOWED = Object.freeze(['recording', 'recordings', 'finding', 'findings', 'during', 'something',
  'nothing', 'anything', 'everything']);
/** S11: hedges, which fixed text does not use. */
export const HEDGES = Object.freeze(['may', 'might', 'perhaps', 'possibly', 'appears', 'seems', 'likely']);
/** L12: what a rendered entry never holds. */
const RENDER_FAULTS = Object.freeze(['undefined', 'NaN', '[object Object]', '  ']);

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A whole-word, any-case pattern for a phrase, with an optional plural on its last word. */
const phrasePattern = (phrase, plural = true) => new RegExp(`(?<![\\w-])${escapeRegExp(phrase)}${plural
  ? '(?:s|es)?' : ''}(?![\\w-])`, 'giu');

/**
 * The sentences of a text: split at a line break, and after `.`, `!` or `?` followed by a space and an upper-case
 * letter, a digit or a quotation mark. Abbreviations are banned (S5), so no exception list is needed.
 */
export function sentencesOf(text) {
  return String(text).split(/\n+/).flatMap((line) => line.split(/(?<=[.!?][)"'”’]?)\s+(?=[\p{Lu}\p{N}"'“‘`])/u))
    .map((s) => s.trim()).filter((s) => /[\p{L}\p{N}]/u.test(s));
}

/** The text a term rule reads: code spans, options (`--name`) and the allowed phrases taken out. */
function termText(sentence) {
  let text = sentence.replace(/(`+)[\s\S]*?\1/g, ' ').replace(/(?<![\w-])--?[A-Za-z][\w-]*/g, ' ');
  for (const phrase of ALLOWED_PHRASES) text = text.replace(phrasePattern(phrase, false), ' ');
  return text;
}
/** The words of a sentence, lower case, without the punctuation around them. */
const wordsOf = (sentence) => termText(sentence).toLowerCase().split(/\s+/)
  .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

/** Is `word` a past participle (L2)? */
function participle(word) {
  if (IRREGULAR_PARTICIPLES.includes(word)) return true;
  if (!word.endsWith('ed') || word.length < 4 || ED_NOT_PARTICIPLES.includes(word)) return false;
  return !word.startsWith('un');
}
/** L2: a form of "be" (or "get"), then at most one of "not", "also", "only" or an "-ly" word, then a participle. */
export function passiveOf(sentence) {
  const words = wordsOf(sentence);
  for (let i = 0; i < words.length - 1; i++) {
    if (!BE_FORMS.includes(words[i])) continue;
    let j = i + 1;
    if (BETWEEN.includes(words[j]) || (words[j].endsWith('ly') && words[j].length > 3)) j++;
    if (j < words.length && participle(words[j])) return `${words[i]} ${words.slice(i + 1, j + 1).join(' ')}`;
  }
  return null;
}

/** L3: why an action breaks "one imperative sentence, one verb of action, the verb first", or null. */
export function actionFault(text) {
  const sentences = sentencesOf(text);
  if (sentences.length !== 1) return 'more than one sentence';
  const [sentence] = sentences;
  const tokens = sentence.toLowerCase().replace(/(`+)[\s\S]*?\1/g, ' code ').split(/\s+/).filter(Boolean);
  let start = 0;
  if (CONDITION_WORDS.includes(tokens[0]?.replace(/[^\p{L}]/gu, ''))) {
    const comma = tokens.findIndex((t) => t.endsWith(','));
    start = comma < 0 ? tokens.length : comma + 1;
  }
  const bare = (t) => (t ?? '').replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (!ACTION_VERBS.includes(bare(tokens[start]))) return 'the first word is not an action verb';
  for (let i = start + 1; i < tokens.length; i++) {
    const joined = JOINERS.includes(bare(tokens[i - 1])) || tokens[i - 1].endsWith(',');
    if (joined && ACTION_VERBS.includes(bare(tokens[i]))) return 'a second action verb';
  }
  return null;
}

/**
 * Every rule's findings on one text of a given kind: `[{ rule, level, sentence, detail }]`, in rule order. `rendered`
 * marks the rendering of a function entry (L12 reads it).
 */
export function lintText(text, kind, { rendered = false } = {}) {
  const out = [];
  const add = (rule, sentence, detail = null) => out.push({ rule, level: STYLE_RULES[rule], sentence, detail });
  const sentences = sentencesOf(text);
  const prose = kind !== 'fragment';
  for (const sentence of sentences) {
    const n = steWordCount(sentence);
    if (prose && n > MAX_SENTENCE_WORDS) add('L1-length', sentence, `${n} words`);
    const passive = prose ? passiveOf(sentence) : null;
    if (passive) add('L2-passive', sentence, passive);
  }
  if (kind === 'action') { const fault = actionFault(text); if (fault) add('L3-one-action', text, fault); }
  for (const sentence of sentences) {
    if (sentence.includes(';')) add('L4-semicolon', sentence);
    const contraction = sentence.match(/\p{L}['’](?:t|re|ll|ve|d|m)(?![\p{L}])/iu);
    if (contraction && /n['’]t|['’](?:re|ll|ve|d|m)/i.test(contraction[0])) add('L5-contraction', sentence, contraction[0]);
    const terms = termText(sentence);
    for (const { term, use, kinds } of GLOSSARY) {
      if (kinds && !kinds.includes(kind)) continue;
      if (phrasePattern(term).test(terms)) add('L6-term', sentence, `"${term}": use ${use}`);
    }
    for (const phrase of BANNED_PHRASES)
      if (new RegExp(`(?<![\\w-])${escapeRegExp(phrase)}(?![\\w-])`, 'iu').test(terms)) add('L7-phrase', sentence, phrase);
    const ing = wordsOf(sentence).filter((w) => /ing$|ings$/.test(w) && w.length > 4 && !ING_ALLOWED.includes(w));
    if (ing.length) add('L8-ing', sentence, ing.join(', '));
    const hedge = wordsOf(sentence).filter((w) => HEDGES.includes(w));
    if (hedge.length) add('L10-hedge', sentence, hedge.join(', '));
  }
  if ((kind === 'description' || kind === 'notice') && sentences.length > MAX_PARAGRAPH_SENTENCES)
    add('L9-paragraph', text, `${sentences.length} sentences`);
  if (rendered) for (const fault of RENDER_FAULTS) if (String(text).includes(fault)) add('L12-render', text, fault);
  return out;
}

// ---- reading a module's tables --------------------------------------------------------------------------------------

const plainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** The most specific key of `map` that is `path` or one of its ancestors ('A.b.c', 'A.b', 'A'), or null. */
function governing(map, path) {
  const parts = path.split('.');
  for (let n = parts.length; n > 0; n--) {
    const key = parts.slice(0, n).join('.');
    if (Object.hasOwn(map, key)) return key;
  }
  return null;
}
/** The value at a dotted path of a module's exports, or undefined. */
function at(ns, path) {
  let value = ns;
  for (const part of path.split('.')) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function') || !Object.hasOwn(value, part))
      return undefined;
    value = value[part];
  }
  return value;
}

/**
 * The entries of a module's declared tables, and its structural errors. A module declares `STYLE_KINDS` (path → kind;
 * a path names an export, `TABLE`, or a member, `TABLE.key`), `STYLE_FIXTURES` (path of a function → its argument
 * lists) and `STYLE_ALLOW` (path → reasons; a path covers what is under it). Every string under a named table needs a
 * kind, every function a fixture; a declaration that names nothing is an error too, so the declarations stay true.
 */
export function moduleEntries(module, ns) {
  const kinds = plainObject(ns.STYLE_KINDS) ? ns.STYLE_KINDS : null;
  const fixtures = plainObject(ns.STYLE_FIXTURES) ? ns.STYLE_FIXTURES : {};
  const allow = plainObject(ns.STYLE_ALLOW) ? ns.STYLE_ALLOW : {};
  const errors = [];
  const entries = [];
  const error = (code, key) => errors.push({ module, code, key });
  if (!kinds) { error('tables_missing', 'STYLE_KINDS'); return { entries, errors }; }
  const usedKinds = new Set(), usedFixtures = new Set(), usedAllow = new Set();
  for (const [key, kind] of Object.entries(kinds)) if (!STYLE_KIND_NAMES.includes(kind)) error('kind_unknown', key);
  for (const [key, reasons] of Object.entries(allow))
    if (!Array.isArray(reasons) || !reasons.length || reasons.some((r) => !STYLE_ALLOW_NAMES.includes(r)))
      error('allow_unknown', key);
  const allowsOf = (path) => {
    const out = new Set();
    for (const key of Object.keys(allow)) if (path === key || path.startsWith(`${key}.`)) {
      usedAllow.add(key);
      for (const r of Array.isArray(allow[key]) ? allow[key] : []) out.add(r);
    }
    return [...out].sort();
  };
  const walk = (path, value) => {
    if (typeof value === 'string' || typeof value === 'function') {
      const kindKey = governing(kinds, path);
      if (kindKey === null) { error('kind_missing', path); return; }
      usedKinds.add(kindKey);
      const kind = kinds[kindKey];
      if (typeof value === 'string') { entries.push({ module, key: path, kind, text: value, allows: allowsOf(path) }); return; }
      if (!Object.hasOwn(fixtures, path)) { error('fixture_missing', path); return; }
      usedFixtures.add(path);
      const lists = Array.isArray(fixtures[path]) ? fixtures[path] : [];
      if (!lists.length) { error('fixture_missing', path); return; }
      for (const args of lists) {
        const text = value(...(Array.isArray(args) ? args : [args]));
        if (typeof text !== 'string') { error('fixture_not_text', path); continue; }
        entries.push({ module, key: path, kind, text, rendered: true, allows: allowsOf(path) });
      }
      return;
    }
    if (Array.isArray(value)) value.forEach((v, i) => walk(`${path}.${i}`, v));
    else if (plainObject(value)) for (const [k, v] of Object.entries(value)) walk(`${path}.${k}`, v);
  };
  const tables = [...new Set(Object.keys(kinds).map((key) => key.split('.')[0]))].sort();
  for (const table of tables) {
    if (at(ns, table) === undefined) { error('kind_unused', table); continue; }
    walk(table, at(ns, table));
  }
  for (const key of Object.keys(kinds)) if (!usedKinds.has(key) && !errors.some((e) => e.key === key.split('.')[0]))
    error('kind_unused', key);
  for (const key of Object.keys(fixtures)) if (!usedFixtures.has(key)) error('fixture_unused', key);
  for (const key of Object.keys(allow)) if (!usedAllow.has(key)) error('allow_unused', key);
  return { entries, errors };
}

/**
 * The linter's report over modules (`[name, namespace]`): every violation `{ module, key, rule, level, sentence,
 * detail, allowed }` sorted by key then rule, the structural errors, and the counts per rule and per allow. A violation
 * an allow passes is kept and marked (`allowed`: the reason); a `request-bytes` entry's errors are kept and counted as
 * such, and none of them fails.
 */
export function lintModules(modules) {
  const violations = [];
  const structure = [];
  for (const [module, ns] of modules) {
    const { entries, errors } = moduleEntries(module, ns);
    structure.push(...errors);
    const seen = new Set();
    for (const entry of entries) for (const v of lintText(entry.text, entry.kind, { rendered: entry.rendered === true })) {
      const allowed = v.rule === 'L2-passive' && entry.allows.includes('actor-unknown') ? 'actor-unknown'
        : ['L6-term', 'L7-phrase'].includes(v.rule) && entry.allows.includes('quoted-term') ? 'quoted-term'
          : v.rule === 'L8-ing' && entry.allows.includes('technical-noun') ? 'technical-noun'
            : v.level === 'error' && entry.allows.includes('request-bytes') ? 'request-bytes' : null;
      const id = `${module} ${entry.key} ${v.rule} ${v.sentence}`;
      if (seen.has(id)) continue;
      seen.add(id);
      violations.push({ module, key: entry.key, rule: v.rule, level: v.level, sentence: v.sentence, detail: v.detail,
        allowed });
    }
  }
  violations.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1
    : a.sentence < b.sentence ? -1 : a.sentence > b.sentence ? 1 : 0));
  const errors = violations.filter((v) => v.level === 'error' && v.allowed === null);
  const count = (list, by) => list.reduce((m, v) => ({ ...m, [by(v)]: (m[by(v)] ?? 0) + 1 }), {});
  // The entries (table keys) each rule flags, apart from how many sentences of them it flags.
  const keysByRule = {};
  for (const v of violations.filter((x) => x.allowed === null)) (keysByRule[v.rule] ??= new Set()).add(`${v.module} ${v.key}`);
  return { violations, errors, warnings: violations.filter((v) => v.level === 'warning' && v.allowed === null),
    structure, byRule: count(violations.filter((v) => v.allowed === null), (v) => v.rule),
    keysByRule: Object.fromEntries(Object.entries(keysByRule).map(([r, s]) => [r, s.size])),
    byAllow: count(violations.filter((v) => v.allowed !== null), (v) => v.allowed) };
}

/** The report as lines: one a violation, `<TABLE.key> <rule> "<sentence, at most 120 characters>"` (an allowed one
 *  says its allow), then the structural errors, then the counts per rule and per allow. */
export function reportLines(report) {
  const clip = (s) => { const c = [...s]; return c.length <= 120 ? s : `${c.slice(0, 119).join('')}…`; };
  return [...report.violations.map((v) => `${v.key} ${v.rule}${v.allowed ? ` (${v.allowed})` : ''} "${clip(v.sentence)}"`),
    ...report.structure.map((e) => `${e.module} ${e.code} ${e.key}`),
    `rules: ${Object.entries(report.byRule).sort().map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`,
    `allows: ${Object.entries(report.byAllow).sort().map(([r, n]) => `${r} ${n}`).join(', ') || 'none'}`];
}
