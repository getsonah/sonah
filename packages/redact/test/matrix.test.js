// W3e-8 — redaction is tested over the cross-product, not case by case (security).
//
// Five redaction rounds each found a few more leaks, and each round's leaks were the same class: a
// pattern anchored for one surrounding context and not another (F231–F235). A suite that lists the
// cases a person thought of finds the next few; this file lists the space instead, and asserts over
// every cell of it:
//
//   names     every entry of the key-name vocabulary (`SECRET_KEY_NAMES`, expanded from the one
//             regex source), in lower, UPPER and Camel case, bare and behind a prefix (`DB_`, `x-`,
//             `my.`) or a leading digit (`2FA_`, `1PASSWORD_`)
//   shapes    how a value is given to a name (`SHAPES` below)
//   contexts  what stands before the shape (`CONTEXTS` below)
//   fields    every field class of the W3e-3 inventory (redact/test/every-field.test.js): a command,
//             a command's arguments, the ask, a body, a diff, a tail, a saying, a claim, a child's
//             instruction and a delegation brief — each cell in its own string, so no cell sees
//             another
//
// The positive half: a value `V` that nothing catches on its own (the premise test pins that) is
// given to every name in every shape, context and field; neither `V` nor any six characters of it
// survives. The negative half: each documentation placeholder, in the same positions, comes back
// byte for byte — except where a shape makes it part of a larger literal (`${NAME:-…}`: the default
// is a literal, never a placeholder), and the exemptions `EXEMPT` names, each pinned by an older test.
//
// Two exclusions, each stated where it is made: the bare name `pwd` (the shell's working directory:
// `PWD=/workspace/project` is pinned kept, redact.test.js), and the negative half's names, which are
// every entry once per batch with the case and prefix rotating (every pairing of the positive half's
// names appears across the batches; the full product of both halves would take a minute).
//
// A failing test prints how many cells failed, by context × field, and the first few cells in full.
// Every fixture is synthetic; the value is assembled at run time. No real recording is read and no
// session text is printed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, entropy, SECRET_KEY_NAMES } from '../index.js';

// ---- names --------------------------------------------------------------------------------------

/** Every string an alternation of literals, `(?:…)` groups and `[…]` classes (each optionally `?`)
 *  matches — the whole grammar `SECRET_KEY_NAMES` is written in. */
function expand(source) {
  let i = 0;
  const alternation = () => {
    const out = [];
    let seq = [''];
    for (;;) {
      if (i >= source.length || source[i] === ')') { out.push(...seq); return out; }
      if (source[i] === '|') { out.push(...seq); seq = ['']; i++; continue; }
      let options;
      if (source.startsWith('(?:', i)) { i += 3; options = alternation(); i++; }
      else if (source[i] === '[') { const j = source.indexOf(']', i); options = [...source.slice(i + 1, j)]; i = j + 1; }
      else options = [source[i++]];
      if (source[i] === '?') { options = ['', ...options]; i++; }
      seq = seq.flatMap((s) => options.map((o) => s + o));
    }
  };
  return [...new Set(alternation())];
}

const ENTRIES = expand(SECRET_KEY_NAMES ?? '');
const PREFIXES = ['', 'DB_', 'x-', 'my.', '2FA_', '1PASSWORD_'];
const CASES = {
  lower: (s) => s.toLowerCase(),
  UPPER: (s) => s.toUpperCase(),
  // Each word capitalised; `_` dropped, `-` and `.` kept: `DbPassword`, `X-Api-Key`, `My.Token`, `2faSecret`.
  Camel: (s) => s.toLowerCase().split(/([_.-])/).map((w) => (w === '_' ? '' : w && w[0].toUpperCase() + w.slice(1))).join(''),
};
/** The shell's own working directory is not a secret name (SHELL_DIRECTORY_NAME in redact/index.js). */
const SHELL_DIRECTORY = /^pwd$/i;
const VARIANTS = PREFIXES.flatMap((prefix) => Object.entries(CASES).map(([label, cased]) => ({ prefix, label, cased })));
const variantName = (entry, { prefix, cased }) => cased(prefix + entry);
const NAMES = [...new Set(ENTRIES.flatMap((entry) => VARIANTS.map((v) => variantName(entry, v))))]
  .filter((name) => !SHELL_DIRECTORY.test(name));

/** A name as a variable's name, for a `${…}` reference: `-` and `.` are not allowed there. */
const variable = (name) => name.replace(/[.-]/g, '_');

// ---- the value ----------------------------------------------------------------------------------

/** Twelve letters and digits: under every length and entropy floor, no known prefix, not a word. */
const V = ['Qm4x', 'Zr7k', 'Wp2n'].join('');
const GRAMS = Array.from({ length: V.length - 5 }, (_, i) => V.slice(i, i + 6));
const leaks = (out) => typeof out === 'string' && GRAMS.some((g) => out.includes(g));

// ---- shapes -------------------------------------------------------------------------------------

/** How a value `v` is given to a name `n`, as the lines of text it takes. */
const SHAPES = {
  'NAME=v': (n, v) => [`${n}=${v}`],
  'export NAME=v': (n, v) => [`export ${n}=${v}`],
  'NAME=v cmd': (n, v) => [`${n}=${v} ./run.sh`],
  'NAME: v': (n, v) => [`${n}: ${v}`],
  '"NAME": "v"': (n, v) => [`"${n}": "${v}"`],
  "'NAME': 'v'": (n, v) => [`'${n}': '${v}'`],
  'NAME = "v"': (n, v) => [`${n} = "${v}"`],
  '--name v': (n, v) => [`--${n} ${v}`],
  '--name=v': (n, v) => [`--${n}=${v}`],
  '-H "NAME: v"': (n, v) => [`-H "${n}: ${v}"`],
  '?name=v&x=1': (n, v) => [`/v1/items?${n}=${v}&x=1`],
  'NAME: | (a YAML block)': (n, v) => [`${n}: |`, `  ${v}`],
  '${NAME:-v}': (n, v) => [`\${${variable(n)}:-${v}}`],
  '${NAME-v}': (n, v) => [`\${${variable(n)}-${v}}`],
  '${NAME:=v}': (n, v) => [`\${${variable(n)}:=${v}}`],
};
/** The shapes whose value is a reference's default: a literal, never a placeholder. */
const DEFAULTS = new Set(['${NAME:-v}', '${NAME-v}', '${NAME:=v}']);

// ---- contexts -----------------------------------------------------------------------------------

/** What stands before a shape. A context that writes a line start writes it before each line. */
const CONTEXTS = {
  'start of text': (lines) => lines.join('\n'),
  'after a newline': (lines) => `cd app\n${lines.join('\n')}`,
  'after an escaped \\n': (lines) => `step one\\n${lines.join('\\n')}`,
  'after "; "': (lines) => `cd app; ${lines.join('\n')}`,
  'after "&& "': (lines) => `cd app && ${lines.join('\n')}`,
  'after a diff +': (lines) => lines.map((l) => `+${l}`).join('\n'),
  'after a diff -': (lines) => lines.map((l) => `-${l}`).join('\n'),
  'inside a JSON string': (lines) => `{"input": ${JSON.stringify(lines.join('\n'))}}`,
  'inside a heredoc body': (lines) => `cat > .env <<'EOF'\n${lines.join('\n')}\nEOF`,
  'after 2 spaces of indentation': (lines) => lines.map((l) => `  ${l}`).join('\n'),
};
const DIFF_CONTEXTS = new Set(['after a diff +', 'after a diff -']);

// ---- fields -------------------------------------------------------------------------------------

/** The text the diff field is given: the context's own lines when it writes a diff, else each line
 *  an added line. */
const asDiff = (text, context) => (DIFF_CONTEXTS.has(context) ? text : text.split('\n').map((l) => `+${l}`).join('\n'));

/** What each field is given for `text` — what it must return when nothing in it is a secret. */
const INPUT = {
  command: (text) => text,
  'command arguments': (text) => text,
  ask: (text) => text,
  body: (text) => text,
  diff: (text, context) => asDiff(text, context),
  tail: (text) => text,
  saying: (text) => text,
  claim: (text) => text,
  instruction: (text) => text,
  'delegation brief': (text) => text,
};
const FIELDS = Object.keys(INPUT);

/** Every field class over a batch of texts, in one ledger: each text in its own string. Returns, per
 *  field, what came out for each text (null where the field was dropped). */
function through(texts, context) {
  const { ledger: out } = redact({
    ask: texts.map((text) => ({ turn: 1, text })),
    ledger: texts.map((text, i) => ({ turn: 1, seq: i, kind: 'bash', cmd: text, argsExcerpt: text, tailLines: text.split('\n'),
      diff: asDiff(text, context), after: { text, truncated: false, lines: text.split('\n').length } })),
    claim: Object.fromEntries(texts.map((text, i) => [`m${i}`, text])),
    sayings: texts.map((text) => ({ turn: 1, text })),
    instructions: texts.map((text) => ({ turn: 1, text })),
    delegations: texts.map((text, i) => ({ adapter: 'claude', callId: `call-${i}`, turn: 1, childId: null, status: 'unresolved',
      reason: 'child_unchecked', parentInstruction: { text, tool: 'Task', field: 'prompt' } })),
    dropped: [],
  });
  const tail = (e) => (Array.isArray(e.tailLines) ? e.tailLines.join('\n') : null);
  return {
    command: out.ledger.map((e) => e.cmd ?? null),
    'command arguments': out.ledger.map((e) => e.argsExcerpt ?? null),
    ask: out.ask.map((a) => a.text),
    body: out.ledger.map((e) => e.after.text),
    diff: out.ledger.map((e) => e.diff),
    tail: out.ledger.map(tail),
    saying: out.sayings.map((s) => s.text),
    claim: texts.map((_, i) => out.claim[`m${i}`]),
    instruction: out.instructions.map((s) => s.text),
    'delegation brief': out.delegations.map((d) => d.parentInstruction.text),
  };
}

// ---- the tally ----------------------------------------------------------------------------------

/** Failing cells, counted by context × field, with the first few in full. */
function tally() {
  const counts = new Map();
  const examples = [];
  let total = 0;
  return {
    add(context, field, cell) {
      const key = `${context} | ${field}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total++;
      if (examples.length < 6) examples.push({ context, field, ...cell });
    },
    get total() { return total; },
    report(what, cells) {
      const rows = [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, n]) => `  ${n}\t${k}`);
      return [`${total} of ${cells} cells ${what}, by context | field:`, ...rows, 'first cells:',
        ...examples.map((e) => `  [${e.context} | ${e.field}] ${JSON.stringify(e.input)} -> ${JSON.stringify(e.output)}`)].join('\n');
    },
  };
}

// ---- premise ------------------------------------------------------------------------------------

test('W3e-8 matrix: the names are every entry of the vocabulary, in every case and prefix', () => {
  assert.equal(typeof SECRET_KEY_NAMES, 'string', 'premise: the vocabulary is exported');
  const whole = new RegExp(`^(?:${SECRET_KEY_NAMES})$`, 'i');
  for (const entry of ENTRIES) assert.match(entry, whole);
  // Every top-level alternative of the source contributes at least one entry.
  for (const alternative of SECRET_KEY_NAMES.split(/\|(?![^(]*\))/))
    assert.ok(ENTRIES.some((e) => new RegExp(`^(?:${alternative})$`).test(e)), alternative);
  assert.ok(ENTRIES.length >= 29, `${ENTRIES.length} entries`);
  assert.equal(NAMES.length, new Set(NAMES).size);
  assert.ok(NAMES.length >= ENTRIES.length * VARIANTS.length - VARIANTS.length, `${NAMES.length} names`);
  for (const name of ['2FA_SECRET', '1PASSWORD_TOKEN', 'my.token', 'x-api-key', 'X-Api-Key', 'DbPassword', 'ClientKeyData'])
    assert.ok(NAMES.includes(name), name);
});

test('W3e-8 matrix premise: the value alone is caught by nothing, in every context and field', () => {
  // So every cell below isolates the key-name rule: only the name makes V a secret.
  for (const [context, write] of Object.entries(CONTEXTS)) {
    const texts = [[`echo ${V}`], [`color=${V}`], [`--color ${V}`], [`color: ${V}`], [`/v1/items?color=${V}&x=1`]].map(write);
    const outs = through(texts, context);
    for (const field of FIELDS) {
      texts.forEach((text, i) => {
        const input = INPUT[field](text, context);
        // A line the entropy backstop drops is dropped whatever it holds (BACKSTOP, below): not a rule
        // that catches V.
        if (!backstopDrops(input)) assert.equal(outs[field][i], input, `${context} | ${field}: ${text}`);
      });
    }
  }
});

// ---- the positive half: no value survives -------------------------------------------------------

for (const [shape, give] of Object.entries(SHAPES)) {
  test(`W3e-8 matrix: ${shape} — the value survives in no name, context or field`, () => {
    const t = tally();
    let cells = 0;
    for (const [context, write] of Object.entries(CONTEXTS)) {
      const texts = NAMES.map((name) => write(give(name, V)));
      const outs = through(texts, context);
      for (const field of FIELDS) {
        outs[field].forEach((output, i) => {
          cells++;
          if (leaks(output)) t.add(context, field, { input: texts[i], output });
        });
      }
    }
    assert.ok(cells >= NAMES.length * FIELDS.length * Object.keys(CONTEXTS).length, 'premise: every cell ran');
    assert.equal(t.total, 0, t.report('leak the value', cells));
  });
}

// ---- the negative half: no placeholder is masked ------------------------------------------------

/** A name as an environment variable's: upper case, runs of other characters one `_`, never a digit first. */
const envName = (name) => name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^(?=\d)/, '_');
const PLACEHOLDERS = {
  $NAME: (n) => `$${envName(n)}`,
  '${NAME}': (n) => `\${${envName(n)}}`,
  '<name>': (n) => `<${n.toLowerCase()}>`,
  '***': () => '***',
  changeme: () => 'changeme',
  true: () => 'true',
  false: () => 'false',
  null: () => 'null',
  empty: () => '',
};

/**
 * The cells an older test pins masked, each with the test that pins it. Checked, not assumed: in a
 * probe batch of every name, each cell an exemption names must still be masked (the last tests below),
 * so it can neither outlive its reason nor cover a cell that is kept; and together they exempt under a
 * tenth of the negative half.
 *   GENERIC_GREEDY  the generic password layer (`password=…`) takes its value to the next blank, and
 *                   a placeholder followed by more (`password=changeme&sslmode=require`) is masked
 *                   whole — never split at a placeholder head (redact.test.js 'PLACEHOLDER SPLIT').
 *                   In a query string, `&x=1` follows every value.
 *   WHOLE_VALUE     `NAME=p ./run.sh` where the field reads the rest of the line as the value: a data
 *                   or content field at a line start, a here-document's lines in a command (secret-
 *                   named.test.js F201 'masks the rest of its line'; whole-value.test.js F220 'that shape
 *                   is an assignment only': `API_TOKEN=null npm run deploy` is masked there), and a
 *                   quoted string, whose value runs to its closing quote (whole-value.test.js F220 'the
 *                   quoted-assignment shapes judge the whole value'). The value is `p ./run.sh`: a
 *                   larger literal. A reference or `<…>` followed by words ends the value where it is
 *                   written out unquoted (F220), so those three are not exempt there. And `NAME= cmd`
 *                   with nothing after `=`: the ported layers read it as `NAME = cmd` in every field
 *                   (redact.test.js 'GAP CLOSED' reads `--password=…` the same way).
 *   BACKSTOP        a token of the text the fail-closed entropy rule drops whatever the value is — a
 *                   long generated name, or the name glued into a URL — (redact.test.js 'unclassifiable
 *                   high-entropy content fails CLOSED'). Computed by that rule's own floor and length
 *                   (ENTROPY_MIN, ENTROPY_LEN, BENIGN in redact/index.js).
 */
const GENERIC_NAME = /(?:^|-)pass(?:word|wd)$/i;
/** The names the two ported layers read (`password=`, `DB_PASSWORD=`): they know no command. */
const PORTED_NAME = /(?:^|-)pass(?:word|wd)$|^db[_-]?(?:password|passwd|pwd)$/i;
const REFERENCES = new Set(['$NAME', '${NAME}', '<name>']);
/** The fields that read the rest of a line-start line as its value (`data` in redact/index.js) … */
const DATA_FIELDS = new Set(['command arguments', 'body', 'diff', 'tail']);
/** … and the prose fields read a line at a time, whose content rule does too, for a value it reads
 *  at all (never one that opens with `***`, `$` or `<`). */
const PROSE_LINE_FIELDS = new Set(['saying', 'claim', 'instruction', 'delegation brief']);
const SEPARATORS = new Set(['after "; "', 'after "&& "']);
const backstopDrops = (text) => text.split(/[\s,"'`()[\]{}]+/).some((tok) => tok.length >= 24 && entropy(tok) >= 4.6
  && !/^[0-9a-f]{7,40}$/i.test(tok) && !/^\d+$/.test(tok) && !/^[A-Za-z0-9+/]{20,39}={0,2}$/.test(tok));
const EXEMPT = {
  GENERIC_GREEDY: ({ shape, name }) => shape === '?name=v&x=1' && GENERIC_NAME.test(name),
  WHOLE_VALUE: ({ shape, name, placeholder, context, field }) => shape === 'NAME=v cmd' && (context === 'inside a JSON string'
    || (placeholder === 'empty' && (field !== 'command' || context === 'inside a heredoc body' || PORTED_NAME.test(name)))
    || (!REFERENCES.has(placeholder) && placeholder !== 'empty' && !SEPARATORS.has(context) && (DATA_FIELDS.has(field)
      || (field === 'command' && context === 'inside a heredoc body')
      || (PROSE_LINE_FIELDS.has(field) && placeholder !== '***' && context !== 'after an escaped \\n')))),
  BACKSTOP: ({ text }) => backstopDrops(text),
};
const exempt = (cell) => Object.values(EXEMPT).some((rule) => rule(cell));

/** The negative half's names for one batch: every entry once, the case and prefix rotating with the
 *  batch, so across the batches every entry meets every case and prefix. */
const rotated = (k) => ENTRIES.map((entry, e) => {
  for (let step = 0; step < VARIANTS.length; step++) {
    const name = variantName(entry, VARIANTS[(e + k + step) % VARIANTS.length]);
    if (!SHELL_DIRECTORY.test(name)) return name;
  }
  return null;
}).filter(Boolean);

const PLACEHELD = Object.entries(SHAPES).filter(([shape]) => !DEFAULTS.has(shape));

for (const [s, [shape, give]] of PLACEHELD.entries()) {
  test(`W3e-8 matrix: ${shape} — every placeholder is kept byte for byte`, () => {
    const t = tally();
    let cells = 0;
    Object.entries(CONTEXTS).forEach(([context, write], c) => {
      Object.entries(PLACEHOLDERS).forEach(([placeholder, value], p) => {
        const names = rotated(s * 7 + c * 3 + p);
        const texts = names.map((name) => write(give(name, value(name))));
        const outs = through(texts, context);
        for (const field of FIELDS) {
          outs[field].forEach((output, i) => {
            const input = INPUT[field](texts[i], context);
            if (exempt({ shape, name: names[i], placeholder, context, field, text: input })) return;
            cells++;
            if (output !== input) t.add(context, field, { input, output, placeholder });
          });
        }
      });
    });
    assert.equal(t.total, 0, t.report('masked a placeholder', cells));
  });
}

/** Every cell `rule` exempts in one (shape, context, placeholder) batch of every name: each must still
 *  be masked, or the exemption has outlived its reason. Returns how many cells it checked. */
function stillMasked(rule, shape, context, placeholder) {
  const texts = NAMES.map((name) => CONTEXTS[context](SHAPES[shape](name, PLACEHOLDERS[placeholder](name))));
  const outs = through(texts, context);
  let n = 0;
  for (const field of FIELDS) outs[field].forEach((output, i) => {
    const input = INPUT[field](texts[i], context);
    if (!rule({ shape, name: NAMES[i], placeholder, context, field, text: input })) return;
    n++;
    assert.notEqual(output, input, `${field}: ${texts[i]}`);
  });
  return n;
}

test('W3e-8 matrix: every exemption still masks what it names (it has not outlived its reason)', () => {
  assert.ok(stillMasked(EXEMPT.GENERIC_GREEDY, '?name=v&x=1', 'start of text', 'changeme') > 0, 'GENERIC_GREEDY');
  for (const [context, placeholder] of [['start of text', 'changeme'], ['after a newline', 'true'], ['inside a heredoc body', 'null'],
    ['inside a JSON string', '${NAME}'], ['after a diff +', '***']])
    assert.ok(stillMasked(EXEMPT.WHOLE_VALUE, 'NAME=v cmd', context, placeholder) > 0, `WHOLE_VALUE ${context} ${placeholder}`);
  // `NAME= cmd`: the ported layers' names (the others are kept in a command, where it is an empty assignment).
  assert.ok(stillMasked(EXEMPT.WHOLE_VALUE, 'NAME=v cmd', 'start of text', 'empty') > 0, 'WHOLE_VALUE empty');
  assert.ok(stillMasked(EXEMPT.WHOLE_VALUE, 'NAME=v cmd', 'inside a heredoc body', 'empty') > 0, 'WHOLE_VALUE empty, heredoc');
  const backstop = (cell) => EXEMPT.BACKSTOP(cell);
  assert.ok(stillMasked(backstop, '?name=v&x=1', 'start of text', 'changeme') > 0, 'BACKSTOP');
});

test('W3e-8 matrix: the exemptions leave most of the negative half checked', () => {
  // An exemption that swallowed the matrix would pass it vacuously.
  let cells = 0, exempted = 0;
  PLACEHELD.forEach(([shape, give], s) => Object.entries(CONTEXTS).forEach(([context, write], c) => {
    Object.entries(PLACEHOLDERS).forEach(([placeholder, value], p) => {
      for (const name of rotated(s * 7 + c * 3 + p)) for (const field of FIELDS) {
        cells++;
        if (exempt({ shape, name, placeholder, context, field, text: INPUT[field](write(give(name, value(name))), context) })) exempted++;
      }
    });
  }));
  assert.ok(exempted / cells < 0.1, `${exempted} of ${cells} cells exempt`);
});
