// Redaction. Fails closed.
//
// Transcripts are plaintext and contain every credential the agent ever read: some carry a live
// secret, more carry an email address. Codex writes its sessions world-readable at 0644.
//
// Two rules that are not negotiable:
//   1. Runs over `cmd`, `argsExcerpt`, `tailLines` and `claim`/`ask` text — NEVER
//      over `path`. A redacted path destroys the deviation signal entirely, and a filename is not a
//      credential.
//   2. Fails CLOSED. When a high-entropy string cannot be classified, the whole line is dropped and
//      the drop is recorded in `dropped` so the absence is visible rather than silent.
//
// D84 (owner decision 2026-10-12, "off for the model, on for output"): the reviewer model reads the recorded
// session unredacted — the provider already saw it in the original session — and every text Sonah writes for a
// person is masked. So this module has two jobs. `redact(ledger, { mask: false })` is what the session review loads:
// it BOUNDS and validates (an attached file's head and tail, the recorder's closed facts, the identity shapes) and
// masks nothing. `maskForPeople(text)` is the one output function: the page, the Markdown story (in a file or on the
// terminal) and the PR comment pass every recorded or review-authored text through it before a person can read it,
// and it throws rather than return a text it could not scan (fails closed: the caller writes and posts nothing).
// `redact(ledger)` with masking on (the default) is still what `sonah slice` prints (the pull-request route that also
// read it is removed, D82 step 10). `sliceHash` is over the ledger it is given: for a session review, the bounded,
// unmasked one.
//
// Detection is region-based: every layer emits [start,end) regions which are sorted, merged
// (earlier/larger region wins) and replaced in one pass. Mechanism transcribed from Entire's MIT
// redactor (entireio/cli redact/redact.go: applyRegions ~264-302). Several detector regexes and the
// placeholder rules below are copied near-verbatim from that file and redact/providers.go — see
// THIRD_PARTY_NOTICES.md.

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------------------------
// Known secret shapes. The labels double as the closed set of redaction reasons
// (`redacted:<label>`); never construct a reason string anywhere else.
//
// Prefix-distinctive patterns carry NO leading \b. Rationale transcribed from entireio/cli
// redact/providers.go (comment above providerTokenPatterns): \b requires a non-word character
// before the prefix, so a secret glued to a preceding word character — an underscore-joined name
// (FOO_sb_secret_…) or a literal JSON escape whose trailing letter abuts the prefix
// (…line1\nAKIA…, where the byte before "A" is the literal 'n') — slips past every anchored
// pattern. Measured here before the fix: `foo\nAKIAIOSFODNN7EXAMPLE` reached the output raw.
// Dropping the anchor is redaction-completeness-safe: a mid-word collision with one of these
// prefixes only ever over-redacts, and over-redaction is the safe direction for this stage.
const PATTERNS = [
  [/AKIA[0-9A-Z]{16}\b/g,                            'aws-key'],
  [/ASIA[0-9A-Z]{16}\b/g,                            'aws-temp-key'],
  [/gh[pousr]_[A-Za-z0-9]{36,}\b/g,                  'github-token'],
  [/github_pat_[A-Za-z0-9_]{22,}\b/g,                'github-pat'],
  [/sk-ant-[A-Za-z0-9\-_]{20,}\b/g,                  'anthropic-key'],
  [/sk-[A-Za-z0-9]{32,}\b/g,                         'openai-key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}\b/g,                'slack-token'],
  [/AIza[0-9A-Za-z\-_]{35}\b/g,                      'google-key'],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, 'jwt'],
  // M33 R repair 5: in JSON-escaped text (a write's arguments serialized as JSON: one physical line) a key's body
  // follows its header behind escaped line breaks, and the line rules never see it; it went only when its lines were
  // glued into one token over the entropy floor, and a blank at a line's end split that token apart. When escaped
  // blanks and an escaped line break follow the header, the match runs on to the END line on that physical line, or to
  // its end. A header followed by a real line break is matched alone, as before (the block rule takes its body).
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----(?:(?=((?:[ \t]|\\+[rt])*\\+n))\1(?:[^\n]*?-----END [A-Z ]*PRIVATE KEY-----|[^\n]*))?/g, 'private-key'],
  [/[Bb]earer\s+[A-Za-z0-9\-._~+/]{20,}=*/g,         'bearer'],
  // Low-entropy deterministic provider prefixes, copied verbatim from entireio/cli
  // redact/providers.go (providerTokenPatterns). Supabase sb_secret_ keys measure ~4.2 bits/char —
  // below every entropy floor — and are backed by no other layer, so a miss reaches the ledger
  // raw. sb_publishable_ is intentionally NOT redacted (client-side by design, protected by RLS —
  // their comment, kept). The {20,} floor rejects short identifier collisions.
  [/sb_secret_[A-Za-z0-9_-]{20,}/g,                  'supabase-secret'],
  [/sbp_[a-z0-9_-]{20,}/g,                           'supabase-pat'],
  // Credentialed URI: any scheme with a userinfo password (postgres://u:p@h, redis://:p@h/0,
  // https://u:p@h). Regex copied verbatim from entireio/cli redact/redact.go
  // (credentialedURIPattern, ~line 30). Catches moderate-entropy passwords no shape rule knows,
  // and — unlike the old db-scheme-only rule here — an empty username (redis://:pass@) too.
  [/\b[a-z][a-z0-9+.-]{1,31}:\/\/[^\s/?#@"'`<>:]*:[^\s/?#@"'`<>]+@[^\s"'`<>]+/gi, 'credentialed-uri'],
  // F241: a match starts only where a run of local-part characters starts. `\b` also let it start
  // after every `.` inside one run, so a run with no `@` (`.a.a.a…`) was rescanned from each dot:
  // O(n²), minutes on a 1 MB line. Starting earlier can only widen a mask, never narrow one.
  [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, 'email'],
];

// Characters that follow a backslash in a JSON/string escape. From entireio/cli
// redact/redact.go ~199 (the switch over 'n','t','r','b','f','u','"','\\','/').
const JSON_ESCAPE_LETTERS = 'ntrbfu"\\/';

// ---------------------------------------------------------------------------------------------
// Database / connection-string detection. Patterns copied near-verbatim from entireio/cli
// redact/redact.go (~lines 36-56); (?i) becomes the JS `i` flag. Two deliberate deviations:
//   - Go's regexp is RE2 (linear time); JS backtracks, so the key quantifiers are capped at
//     {0,63} to bound worst-case scans over adversarial multi-MB single-line inputs.
//   - Every rule is gated on a non-placeholder password being present, exactly as upstream —
//     the pattern alone never redacts.
const DB_PASSWORD_KEY_SHAPE =
  '(?:db|database|pg|postgres|postgresql|mysql|mariadb|redis|mongo|mongodb|sqlserver|mssql|jdbc)(?:[_-]+[a-z0-9]+)*[_-]*(?:password|passwd|pwd)';

const JDBC_RE          = /\bjdbc:[^\s"'<>`]+/gi;
const DB_URL_RE        = /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>`]+/gi;
const KEYWORD_DSN_RE   = /\b[a-z_][a-z0-9_]{0,63}=(?:"[^"]*"|'[^']*'|[^\s"']+)(?:\s+[a-z_][a-z0-9_]{0,63}=(?:"[^"]*"|'[^']*'|[^\s"']+)){2,}/gi;
const SEMICOLON_CONN_RE = /\b[a-z][a-z0-9 _-]{0,63}=(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^=;"'\s]+)(?:;[a-z][a-z0-9 _-]{0,63}=(?:\{[^}]*\}|"[^"]*"|'[^']*'|[^=;"'\s]+)){2,}/gi;

// Bounded credential key/value: APP_DB_PASSWORD=... matches via the leading `_` boundary;
// mydbpassword=... does not (entireio/cli redact/redact.go credentialValuePattern, ~line 46).
// W3e-8: the blanks around `=` are blanks on its line (`[ \t]*`, upstream's `\s*`): `DB_PASSWORD=` at a
// line's end has no value, and the next line's first word (a here-document's `EOF`) is not its value.
const CREDENTIAL_VALUE_RE = new RegExp(
  `(?:^|[^A-Za-z0-9])(${DB_PASSWORD_KEY_SHAPE})[ \\t]*=[ \\t]*("[^"]*"|'[^']*'|[^\\s,;&]+)`, 'dgi');

// Gate regexes for the connection-string rules (entireio/cli redact/redact.go ~lines 48-52).
const KEYWORD_HOST_RE     = /(?:^|\s)host=/i;
const KEYWORD_USER_RE     = /(?:^|\s)user=/i;
const SEMICOLON_SERVER_RE = /(?:^|;)\s*(?:server|data source|datasource|addr|address|network address)\s*=/i;
const SEMICOLON_USER_RE   = /(?:^|;)\s*(?:user id|userid|user|uid)\s*=/i;
const PASSWORD_ASSIGN_RE  = /(?:^|[?&;\s])(?:password|pwd)=("[^"]*"|'[^']*'|[^&;\s"']+)/gi;

// Generic greedy password assignment, standing in for the betterleaks generic-password rule the
// upstream pipeline gets from its scanner layer (sonah has no scanner dependency). Greedy to the
// next whitespace so a finding is never split at a placeholder head — see PLACEHOLDER rule below.
// Deviations from upstream, both deliberate:
//   - the boundary class adds `-` so shell shorthand `--password=hunter2` is caught. Upstream
//     pins this as a known gap (redact_test.go TestString_MysqlShellShorthandIsNotRedacted);
//     sonah's primary surface IS shell commands, so the gap is closed here.
//   - bare `pwd` is excluded: `PWD=/workspace/project` is the shell variable, printed constantly
//     in transcripts. `PWD=secret` inside semicolon connection strings is still caught by
//     SEMICOLON_CONN_RE, which is where ODBC-style PWD= actually appears.
//   - W3e-7 / F219: a line start may carry a diff's `+` (`-` and a blank are in the class already):
//     `+password=…` on an added line is the line `password=…`, and masked as it is.
//   - W3e-8: the blanks around `=` are blanks on its line, as for CREDENTIAL_VALUE_RE.
const GENERIC_PASSWORD_RE = /(?:^\+?|[?&;\s-])(?:password|passwd)[ \t]*=[ \t]*("[^"]*"|'[^']*'|[^\s]+)/dgim;

// Assignment shapes with a long value: KEY=…, KEY: …, `api_key = "…"` — a bare name only. It cannot
// match a QUOTED key (`"token": "…"`): the name must be followed by its separator, and there the quote
// stands. A quoted key is the key-name rule's shape Q below (W3e-5 / F209).
const ASSIGNED = /\b([A-Za-z_][A-Za-z0-9_]{2,})\s*[:=]\s*["']?([A-Za-z0-9+/=_\-.]{16,})["']?/dg;
const SECRET_NAME = /(secret|token|passwd|password|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth)/i;
const SECRET_NAME_WORDS = new RegExp(SECRET_NAME.source, 'gi');

// The secret-name vocabulary of the key-name rule, in ONE place (W3e-4 / F201): a value assigned to
// a name containing one of these is a secret whatever the value looks like. The line-start content
// rule (`SECRET_KEY`, the content fields) and the key-name shapes (`secretNamedValues`, every field,
// through `scrub`) both read it. Extend it here and nowhere else. (`SECRET_NAME` above is ASSIGNED's
// own, narrower list for long values; it is a different rule and stays as it is, but for the ordinary
// words below, which narrow every list of names alike — W3e-5 / F211.)
// W3e-8: `client-key-data` written as one word (`ClientKeyData`, Go's and Python's own spelling of the
// kubeconfig field) is the same name; the separators are optional here, as they are for every other
// two-word name in the list. Exported so redact/test/matrix.test.js derives its names from this source.
// M33 R repair 7: `encryption key` and `master key` added (a 64-hex `ENCRYPTION_KEY=…` passed every rule: no name
// knew it, and a hex run never fails the entropy floor). Kept by M33 R repair 8.
export const SECRET_KEY_NAMES = 'pass(?:word|wd)?|pwd|passphrase|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|signing[_-]?key|encryption[_-]?key|master[_-]?key|client[_-]?key[_-]?data|dockerconfigjson|credential|cert|auth|salt|dsn|mnemonic';
// `PWD` and `OLDPWD` are the shell's own working directories, printed constantly and never a secret
// (why GENERIC_PASSWORD_RE excludes bare `pwd`; redact.test.js pins `PWD=/workspace/project` in a
// command). The vocabulary's `pwd` is there for names like `DB_PWD`. The line-start content rule
// keeps masking them, as it always has; only the key-name shapes step around the shell's two names.
const SHELL_DIRECTORY_NAME = /^(?:OLD)?PWD$/i;
// A name whose last word is `hash` holds a digest of the secret, not the secret: upstream's pinned
// over-redaction guard (`DB_PASSWORD_HASH=abcdef` stays, redact.test.js, from entireio/cli
// TestString_BoundedCredentialValueOverRedactionGuards). The key-name shapes honour it too.
const DIGEST_NAME = /(?:^|[_.-])hash$/i;

// W3e-5 / F211. The vocabulary matches substrings, and substring matching stays the rule — `APITOKEN`,
// `newpassword`, `SSHPASS` are secret names, and no list of concatenations could say otherwise. It is
// narrowed only where a secret word is part of a longer ORDINARY word: a name's segments (split at
// `_`, `-`, `.` and every other non-alphanumeric character, at case changes and at digits) are found,
// and a match lying wholly inside a segment that is one of these words does not count. A closed list;
// each entry is tested as a pair (redact/test/name-segments.test.js). `authorization`, `authorize` and
// `authtoken` are not on it.
const ORDINARY_WORD = /^(?:author(?:s|ed|ing|ship)?|authorit(?:y|ies|ative)|tokeni[sz](?:e|es|ed|er|ers|ing|ation|ations)|certificat(?:e|es|ion|ions)|certif(?:y|ied|ies|ying))$/;
const SECRET_WORD = new RegExp(SECRET_KEY_NAMES, 'gi');

/** The segments of a name, as [start, end) pairs: its runs of letters and digits, split at a lower-
 *  to-upper change (`maxTokens`), before the last capital of a capital run a lowercase letter follows
 *  (`XMLToken`: `XML`, `Token`), and between letters and digits. */
function segmentsOf(name) {
  const kind = (c) => (c >= 'a' && c <= 'z' ? 1 : c >= 'A' && c <= 'Z' ? 2 : c >= '0' && c <= '9' ? 3 : 0);
  const out = [];
  let start = -1;
  for (let i = 0; i <= name.length; i++) {
    const k = i < name.length ? kind(name[i]) : 0;
    if (!k) { if (start >= 0) out.push([start, i]); start = -1; continue; }
    if (start < 0) { start = i; continue; }
    const p = kind(name[i - 1]);
    if ((p === 1 && k === 2) || (p === 3) !== (k === 3) || (p === 2 && k === 2 && kind(name[i + 1] ?? '') === 1)) {
      out.push([start, i]);
      start = i;
    }
  }
  return out;
}

/**
 * What kind of secret name `name` is, by the vocabulary `words` (a global regex): 'secret'; 'count'
 * when its only secret word is the plural `tokens` (`max_tokens`: a whole number there is a count);
 * 'cert' when its only secret word is `cert`/`certs` (a certificate file's name there is a filename);
 * null when every match lies inside an ordinary word, or there is none. Linear in the name: the
 * matches and the segments are walked together.
 */
function nameClass(name, words = SECRET_WORD) {
  let segments = null, at = 0, cls = null;
  for (const m of name.matchAll(words)) {
    segments ??= segmentsOf(name);
    while (at < segments.length && segments[at][1] <= m.index) at++;
    const [s0, s1] = segments[at] ?? [m.index, m.index];
    const within = m.index >= s0 && m.index + m[0].length <= s1;
    const segment = within ? name.slice(s0, s1).toLowerCase() : '';
    if (within && ORDINARY_WORD.test(segment)) continue;
    const kind = within && segment === 'tokens' ? 'count' : within && (segment === 'cert' || segment === 'certs') ? 'cert' : 'secret';
    if (kind === 'secret' || (cls && cls !== kind)) return 'secret';
    cls = kind;
  }
  return cls;
}

/** The key-name rule's names: the vocabulary's, less the shell's working directories and a digest.
 *  Returns the name's class (`nameClass`), or null. */
const secretNamed = (name) => (SHELL_DIRECTORY_NAME.test(name.replace(/^-+/, '')) || DIGEST_NAME.test(name)
  ? null : nameClass(name));

// W3e-5 / F211. A value assigned to a secret name that is provably not a credential: exactly true,
// false or null (a boolean is not a credential; a list separator may follow it, as a placeholder's
// may); a whole number under `tokens` (a count); a certificate file's name under `cert` (a filename).
const BOOLEAN_VALUE = /^(?:true|false|null),?$/i;
const CERT_FILE = /^[\w.~/-]*\.(?:pem|crt|cer|der|p7b|p7c|csr|p12|pfx)$/i;
function keptValue(cls, value) {
  if (BOOLEAN_VALUE.test(value)) return true;
  if (cls === 'count') return /^\d+,?$/.test(value);
  if (cls === 'cert') return CERT_FILE.test(value);
  return false;
}
// A value the key-name rule leaves visible because it is a documentation placeholder: `$VAR`,
// `${VAR}`, `<…>`, a mask run, `changeme` … — the content rule's own set (`maskSecretKey`). The words
// and mask runs are this pattern's; a reference and a bracketed name are `isReferencePlaceholder`'s,
// the one rule every layer shares (W3e-8 / F234).
const KEY_VALUE_WORD = /^(?:\*+|x+|\.\.\.|null|none|changeme|example)$/i;
function isKeyValuePlaceholder(value) {
  let t = value.trim();
  if (t.endsWith(',')) t = t.slice(0, -1);
  t = t.replace(/^['"]/, '').replace(/['"]$/, '');
  return KEY_VALUE_WORD.test(t) || isReferencePlaceholder(t);
}

// W3e-8 / F233, F234 — ONE rule, in every layer, for the placeholders that name a value rather than
// being one. Each layer used to have its own: the key-name rule kept `$hunter2` and `<hunter2>` (any
// `$word`, anything in angle brackets) while the ported layers masked `password=$hunter2`, and the
// ported layers kept any `${…}` — `${DB_PASSWORD:-hunter2}`, the docker-compose default, included.
//   `$NAME`    an environment variable's reference: upper case, as the convention writes one — or a
//              lower-case variable named for the secret it holds (`$token`, `$db_password`). Any
//              other `$word` is a value in every layer (`$hunter2`, `$ecret`, `$Password1`).
//   `${…}`     a reference — unless it carries a default (`:-`, `-`, `:=`, `=`, `:?`, `?`, `:+`, `+`):
//              the default is a literal, and the literal is the secret. A default that is empty, or is
//              itself a reference, carries none.
//   `<name>`   upstream's bracketed placeholder (lower-case letters, `_`, `-`), and — so a name's own
//              placeholder is one — a name written in one case with a secret word in it
//              (`<2fa_secret>`, `<my.token>`, `<YOUR_API_KEY>`). `<hunter2>` and `<RealPassword>` are
//              values (redact.test.js pins both).
const ENV_REFERENCE = /^\$[A-Z_][A-Z0-9_]*$/;
const LOWER_REFERENCE = /^\$[a-z_][a-z0-9_]*$/;
const DEFAULT_HEAD = /^\$\{(\w+)(:?[-=?+])/;
const NAMED_PLACEHOLDER_INTERIOR = /^(?:[a-z0-9][a-z0-9_.-]*|[A-Z0-9][A-Z0-9_.-]*)$/;
function isReferencePlaceholder(t) {
  if (ENV_REFERENCE.test(t)) return true;
  if (LOWER_REFERENCE.test(t)) return nameClass(t.slice(1)) !== null;
  if (t.startsWith('${') && t.endsWith('}')) {
    if (t.length > MAX_KEYED_VALUE) return false;      // past the scan bound: not judged (fail closed)
    const d = DEFAULT_HEAD.exec(t);
    if (!d) return true;
    const word = t.slice(d[0].length, -1);
    return word === '' || isReferencePlaceholder(word);
  }
  if (t.length >= 5 && t[0] === '<' && t[t.length - 1] === '>') {
    const inner = t.slice(1, -1);
    return BRACKETED_PLACEHOLDER_INTERIOR.test(inner) || (NAMED_PLACEHOLDER_INTERIOR.test(inner) && nameClass(inner) !== null);
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Placeholder rule, transcribed from entireio/cli redact/redact.go (placeholderSecretValues
// ~73-86, isPlaceholderSecretValue/isBracketedPlaceholder/isRepeatedCharPlaceholder ~423-477,
// and the exact-match-only rule at ~219-234): a value that is itself a documentation placeholder
// (changeme, <password>, ${VAR}, ***) stays visible — but ONLY on an exact match of the complete
// captured value. Splitting a greedy finding at a placeholder head would leak a real secret in
// the tail (`password=changeme&db_pass=hunter2hunter2` must redact whole, never stop at
// `changeme`). Greedy captures above + exact-match here is what enforces that.
const PLACEHOLDER_VALUES = new Set([
  'redacted', '[redacted]', '<redacted>',
  'changeme', 'example', 'placeholder',
  'your_password', 'your_db_password', 'your_secret',
  'secret_here',
]);

const BRACKETED_PLACEHOLDER_INTERIOR = /^[a-z][a-z_-]*$/;

function isPlaceholderSecretValue(value) {
  let t = String(value).trim();
  t = t.replace(/^["']+|["']+$/g, '');
  if (t === '') return true;
  // sonah's own replacement tokens: keeps f(f(x)) === f(x).
  if (t.includes('‹redacted')) return true;
  // `$NAME`, `${NAME}` (no literal default) and `<name>`: the rule every layer shares (W3e-8).
  if (isReferencePlaceholder(t)) return true;
  const normalized = t.toLowerCase();
  if (PLACEHOLDER_VALUES.has(normalized)) return true;
  // Mask runs: "***", "xxxx", "....", "----". Min length 3 so `x` / `**` fall through and a
  // short real password still redacts (upstream isRepeatedCharPlaceholder).
  if (t.length >= 3 && '*x.-'.includes(t[0]) && [...t].every((c) => c === t[0])) return true;
  return false;
}

function unquote(v) {
  if (v.length >= 2) {
    const a = v[0], b = v[v.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return v.slice(1, -1);
  }
  return v;
}

function hasNonPlaceholderPasswordAssignment(candidate) {
  for (const m of candidate.matchAll(PASSWORD_ASSIGN_RE)) {
    const v = unquote(m[1]);
    if (v !== '' && !isPlaceholderSecretValue(v)) return true;
  }
  return false;
}

function hasJDBCPassword(candidate) {
  return candidate.toLowerCase().startsWith('jdbc:') && hasNonPlaceholderPasswordAssignment(candidate);
}

// Query-string password on a database URL (userinfo passwords are the credentialed-uri
// pattern's job — entireio/cli redact/redact.go hasDatabaseURLSecret, ~348-364).
function hasDatabaseURLSecret(candidate) {
  let u;
  try { u = new URL(candidate); } catch { return false; }
  if (u.protocol === '' || u.host === '') return false;
  for (const [key, value] of u.searchParams) {
    const k = key.toLowerCase();
    if ((k === 'password' || k === 'pwd') && value !== '' && !isPlaceholderSecretValue(value)) return true;
  }
  return false;
}

function hasKeywordDSNPassword(candidate) {
  return KEYWORD_HOST_RE.test(candidate) && KEYWORD_USER_RE.test(candidate)
    && hasNonPlaceholderPasswordAssignment(candidate);
}

function hasSemicolonConnectionPassword(candidate) {
  return SEMICOLON_SERVER_RE.test(candidate) && SEMICOLON_USER_RE.test(candidate)
    && hasNonPlaceholderPasswordAssignment(candidate);
}

// The multi-pair DSN patterns (3+ k=v groups) are quadratic under JS backtracking on adversarial
// unbroken `k=v;k=v;…` runs — Go's RE2 is linear and upstream never had to care. maxLen skips
// them on oversized inputs (measured: a 1.8MB semicolon chain hangs without the gate). No real
// connection string approaches 8KB, and on lines past the gate a DSN password is still caught by
// the linear generic-password layer, with the entropy backstop failing closed behind it.
const DSN_MAX_INPUT = 8192;

const CONNECTION_STRING_RULES = [
  [JDBC_RE,           hasJDBCPassword,                'jdbc-dsn',      Infinity],
  [DB_URL_RE,         hasDatabaseURLSecret,           'db-url-query',  Infinity],
  [KEYWORD_DSN_RE,    hasKeywordDSNPassword,          'keyword-dsn',   DSN_MAX_INPUT],
  [SEMICOLON_CONN_RE, hasSemicolonConnectionPassword, 'semicolon-dsn', DSN_MAX_INPUT],
];

// A DSN candidate captured at end of prose drags sentence punctuation with it
// (entireio/cli redact/redact.go trimConnectionStringEnd, ~329-339).
function trimConnectionStringEnd(s, start, end) {
  while (end > start && '.,;:!?)]'.includes(s[end - 1])) end--;
  return end;
}

// ---------------------------------------------------------------------------------------------
// The key-name rule in every field (W3e-4 / F201). The content fields always masked a value
// assigned to a secret-named key, whatever it looked like — but only through `SECRET_KEY`, which is
// anchored at the start of a line and runs in `scrubLines` alone. The command fields, the ask and
// `tailLines` never had it: `export API_TOKEN=hunter2x` came through a command unmasked. Commands are
// exactly where `export X=…`, `-H "Authorization: …"`, `--password …` and `KEY=value cmd` appear.
// These are the shapes a line-start rule cannot see; each fires only for a name in the one
// vocabulary above, and a placeholder value stays visible exactly as it does for the content rule.
// They run inside `scrub`, so every field gets them, in every view W3e-3's `settle` scans.
//
//   L  a secret-named key at the start of a line (after indentation, a list or trace marker,
//      `export`): `API_KEY=…`, `password: …`, `> Authorization: Bearer …`
//   A  a secret-named assignment wherever else a shell word starts: `&& export API_TOKEN=…`,
//      `env NPM_TOKEN=… npm publish`, `"SERVICE_SECRET=…"`, `--from-literal=password=…`
//   F  a secret-named flag and its value: `--password …`, `--token=…`, `--api-key …`
//   U  a user:password pair: `-u user:password`, `--user`, `-U`, `--proxy-user`
//   H  a secret-named header a quote opens: `-H "Authorization: Bearer …"`, `'X-Api-Key: …'`
//
// W3e-5 / F209, F210 — the shapes W3e-4's probes found this rule still missed:
//   Q  a secret-named key in quotes, followed by `:`, `=` or `=>` — JSON, YAML flow, Python and JS
//      objects, TOML, a PHP or Ruby hash, a subscript (`env["API_TOKEN"] = …`) — and the same key in
//      a JSON string (`{\"password\":\"…\"}`). A quoted value runs to its closing quote (escapes
//      respected), an array to its closing bracket, any other value to the next `,` `}` `]` or the
//      end of the line; a nested object is not a value (its own keys are scanned).
//   S  a URL query parameter: `?access_token=…&…`, `&api_key=…#…`, up to `&`, `#`, a blank or a
//      quote; and a signed URL's signature (`sig`, `X-Amz-Signature`), whatever the vocabulary says.
//   G  a password flag glued to its value, after the commands whose `-p` is one: `mysql -p…`,
//      `mysqldump -p'…'`, `mariadb`, and `sshpass -p …` either way. Not every `-p`: `mkdir -p`,
//      `cp -p` and `ssh -p 22` are not these commands, and psql's family takes a port there.
//   C  a `Cookie:` or `Set-Cookie:` header in the L, H or Q shape: the whole value, to the header's end.
//   B  a YAML block scalar under a secret-named key (`password: |`, `token: >-`): every following
//      line indented deeper than the key, up to the first line at or below it, is masked; the
//      indicator stays. One finding per block (`secretBlocks`; the line-structured fields run the
//      same rule over their lines, `maskBlocks` below).
//
// W3e-7 / F221:
//   K  curl's cookie flag and its value: `curl -b 'sid=…'`, `--cookie "…"`, `--cookie=…`, `-sSb …`,
//      `-b…` glued. A value with `=` in it is a cookie string, masked whole; any other names a cookie
//      file (`-b cookies.txt`), and is kept.
//
// M33 R repair 8 (repair 7's label grammar, shape N, replaced; see `proximityValues` below):
//   P  the PROXIMITY rule, after every shape above and every other layer: on a line holding a word of the secret
//      vocabulary (and the 2 non-blank lines after a line that ends at one), every credential-shaped token is masked
//      whatever stands around it; after a password-family word, its value whatever its shape. It reads what no older
//      shape masked, so their bytes and labels stand.
//
// How far a value runs depends on what the field is (`mode`):
//   shell  a command (`cmd`): an assignment is one shell word — what follows it is the command, and
//          stays readable — except in a here-document, whose lines are file content (data).
//   prose  the human's ask and the agent's prose: an assignment is one shell word too; any other
//          line-start value runs to the end of its sentence, so the human's next sentence survives
//          (`Token: … . Use three attempts.` — the ask is the contract, D32).
//   data   everything else (output, file content, a first error line): a line-start value takes the
//          rest of its line, as the content rule does — `env` prints a value raw, spaces and all.
// A value a quote opened runs to its closing quote. A value that is one quoted string is masked
// inside its quotes, and an auth scheme (`Bearer`, `Basic`, …) stays visible.
//
// W3e-7 / F219: a unified diff puts `+`, `-` or a blank before every line, and a diff reaches every
// field. Wherever a shape is anchored at the start of a line or of a shell word, that marker may stand
// before it: `+--token …` on an added line is the line `--token …`, masked as it is. The anchors, and
// how each allows the marker:
//   KEY_AT_LINE_START      `[ \t>*+<-]*` already took it
//   ASSIGNMENT_IN_LINE     a line start is KEY_AT_LINE_START's; after a JSON-escaped line start
//                          (`\n` written as two characters) the marker is allowed now
//   SECRET_FLAG            `^[+-]?` now (a blank was in its class already)
//   USERINFO_FLAG          `^[+-]?` now
//   PASSWORD_FLAG_COMMAND, CONTAINER_COMMAND, CURL_COMMAND   `^[+-]?`
//   BLOCK_KEY              read behind the marker, with the lines its block holds (`secretBlocks`)
//   GENERIC_PASSWORD_RE    `^\+?` now; the content rule's SECRET_KEY, behind ADDED_LINE
//
// W3e-8 / F231, F232 — ONE line start and ONE key name, defined once below and built into every
// anchored shape, instead of each pattern's own. W3e-8's matrix (redact/test/matrix.test.js) found the
// same class five rounds had been finding a few cells at a time: a shape anchored for one context and
// not another.
//   LINE_START   the start of a physical line, or just past an escaped line break — `\n`, `\r` (or an
//                escaped tab, `\t`) written as two characters: a JSON string, `echo -e`, a logged
//                payload — and then a diff marker, `+` or `-` (W3e-7 / F219). F231: KEY_AT_LINE_START,
//                SECRET_FLAG and USERINFO_FLAG took `\n` for no line start; ASSIGNMENT_IN_LINE did.
//   LINE_HEAD    what KEY_AT_LINE_START (and BLOCK_KEY) take for the start of a logical line: a
//                LINE_START, or a command separator — `;`, `&&`, `||` — after which a new command, or
//                in prose a new clause, begins (`cd app; password: …`). There an assignment is one
//                shell word in every field: what follows it is the rest of a command line.
//   KEY_NAME     a key's name. F232: it may start with a digit or a dot — `2FA_SECRET`,
//                `1PASSWORD_TOKEN`, `.token` (a jq or yq path) — not only a letter or `_`.
// Every anchored shape reads them:
//   KEY_AT_LINE_START      LINE_HEAD, KEY_NAME; after an escaped line break its value ends at the next
//   ASSIGNMENT_IN_LINE     LINE_START (as before), KEY_NAME
//   SECRET_FLAG            LINE_START; a flag's name may start with a digit
//   USERINFO_FLAG          LINE_START
//   PASSWORD_FLAG_COMMAND, CONTAINER_COMMAND, CURL_COMMAND   LINE_START
//   QUOTED_HEADER          KEY_NAME (a header's name may hold a `.`); `=` as well as `:`
//   QUOTED_KEY, QUERY_PARAMETER   KEY_NAME
//   BLOCK_KEY              LINE_HEAD, KEY_NAME
const LINE_START = String.raw`(?:^|\\[ntr])[+-]?`;
const LINE_HEAD = String.raw`(^|\\[ntr]|;|&&|\|\|)`;
const KEY_NAME = String.raw`[\w.][\w.-]*`;
const KEY_AT_LINE_START = new RegExp(String.raw`${LINE_HEAD}[ \t>*+<-]*(?:export[ \t]+)?(${KEY_NAME})([ \t]*)([:=])([ \t]*)`, 'gm');
const ASSIGNMENT_IN_LINE = new RegExp(String.raw`(?<=[\s;|(){}<>,:=\`'"]|\\[ntr][+-]?)(${KEY_NAME})=`, 'g');
const SECRET_FLAG = new RegExp(String.raw`(?<=${LINE_START}|[\s;|(){}\`'"])(--?\w[\w.-]*)(=|[ \t]+)`, 'gm');
const USERINFO_FLAG = new RegExp(String.raw`(?<=${LINE_START}|[\s;|(){}\`'"])(?:-[uU](?:[ \t]+|(?=[^\s-]))|--(?:proxy-)?user(?:=|[ \t]+))`, 'gm');
const QUOTED_HEADER = new RegExp(String.raw`(?<=["'])(${KEY_NAME})[ \t]*(?::(?![:/])|=(?!=))[ \t]*`, 'g');
const AUTH_SCHEME = /^(?:Bearer|Basic|Digest|Token|Bot|Negotiate|OAuth)[ \t]+/i;
// Q: the key's quote (or `\"`, a quote escaped inside a JSON string), its name, the same quote, an
// optional `]` (a subscript), the separator. A `==`, `::` or `:/` after it is not a separator.
const QUOTED_KEY = new RegExp(String.raw`(\\?["'])(${KEY_NAME})\1\]?[ \t]*(=>|[:=](?![=:/]))[ \t]*`, 'g');
// S: `?name=` or `&name=`. A Rails-style name (`user[password]`) is one name.
const QUERY_PARAMETER = /[?&]([\w.][\w.[\]-]*)=/g;
// R (W3e-8 / F233): a reference with a default under a secret name — `${DB_PASSWORD:-…}`, `${…-…}`,
// `${…:=…}`, `:?`, `?`, `:+`, `+`. The default is a literal, and the literal is the secret: it is
// masked to the reference's closing brace, unless it is empty or itself a reference.
const DEFAULT_REFERENCE = /\$\{(\w+)(:?[-=?+])/g;
const QUERY_VALUE_END = /[&#\s"'`]/;
// The query parameters that carry a credential whatever the vocabulary says: a signed URL's signature
// (an Azure SAS `sig`, S3's `X-Amz-Signature`, GCS's `X-Goog-Signature`).
const QUERY_SECRET_NAME = /(?:^|[_.-])(?:sig|signature)$/i;
// C: the two headers that carry a session whatever they are called.
const COOKIE_HEADER = /^(?:set-)?cookie$/i;
// G: the commands whose `-p` takes the password glued to it (a bare `-p` prompts, and the word after
// it is the database) — the mysql and mariadb families — and `sshpass`, whose `-p` takes it glued or
// as the next word. psql's family is named because its `-p` is easily mistaken for one: there it is
// the port, so a value that is a port number stays and any other value (which no port is) is masked.
// A path before the command word is allowed; a diff line's hunk marker may stand before it.
const PASSWORD_FLAG_COMMAND = new RegExp(String.raw`(?<=${LINE_START}|[\s;|&(){}\`'"])(?:[\w.~-]*\/)*(mysql(?:dump|admin|import|show|check|pump|slap)?|mariadb(?:-[a-z]+)?|psql|pg_dump(?:all)?|pg_restore|sshpass)(?=[ \t])`, 'gm');
const PORT_FLAG_COMMANDS = new Set(['psql', 'pg_dump', 'pg_dumpall', 'pg_restore']);
// sshpass's own options that take the next word (`-f file`, `-d fd`, `-P prompt`).
const SSHPASS_ARGUMENT_OPTION = /^-[fdP]$/;
const SHELL_OPERATOR = ';&|()<>';
// B: a YAML block scalar's header — `|` or `>`, an optional chomping and indentation indicator in
// either order, an optional comment — and the line that opens one under a key (plain or quoted).
const BLOCK_INDICATOR = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?[ \t\r]*$/;
// W3e-8: the key may follow a command separator on its line (LINE_HEAD: `cd app; password: |`); the
// block is still what is indented deeper than the line. Anchored at the line's start, the indentation
// taken whole (a lookahead and its backreference: never given back, so a megabyte of blanks is read
// once), then every separator tried once: the first whose key's `:` and indicator end the line.
// M33 R repair 4: the key line may end in `\r` (a CRLF text): `.` stops before it, so the line used to match nothing
// and the block's body lines reached every channel. The indicator is taken to the line's end and a `\r` after it.
// M33 R repair 5: any run of `\r` after it. A CRLF file captured through a pseudo-terminal (`script`, a Codex
// `exec_command` with `tty: true`) or converted twice ends each line in `\r\r\n`; one optional `\r` matched none of
// those key lines, and the block's body reached every channel again.
const BLOCK_KEY = new RegExp(String.raw`^(?=([ \t]*(?:-[ \t]+)*))\1(?:[^\n]*?(?:;|&&|\|\|)[ \t]*)?(["']?)(${KEY_NAME})\2[ \t]*:[ \t]*([|>][^\r\n]*)\r*$`);
const LEADING_BLANKS = /^[ \t]*/;
const SECRET_VALUE_MARKER = '‹redacted:secret-value›';
// W3e-5 / F211. The ordinary words that, after a secret-named flag, say it was named in prose and
// given no value ("use --token instead", "pass the --api-key flag"): a closed list of function words,
// each tested (redact/test/name-segments.test.js). Only a value that is one of these words alone — a
// blank, the line's end, or a closing quote or punctuation and then one of those, after it — is not a
// value; one glued to anything else (`instead…`, `the"…"`) is. `a` is not on it: secret-named.test.js
// pins `--token a` as masked (a one-letter value is still a value), and no narrowing unmasks what a
// test masks.
const PROSE_WORDS = new Set(['an', 'and', 'as', 'at', 'but', 'by', 'flag', 'for', 'from', 'if', 'in', 'instead',
  'into', 'is', 'it', 'not', 'of', 'on', 'option', 'or', 'so', 'than', 'that', 'the', 'then', 'this', 'to', 'was', 'when',
  'which', 'with', 'without']);
const PROSE_WORD = /^([A-Za-z]+)(?:["'`]|[.,;:!?)]+)?(?=[ \t\r\n]|$)/;
// W3e-5 / F211. A container runtime's user flag takes `uid:gid`, two numbers — not a user and password.
const CONTAINER_COMMAND = new RegExp(String.raw`(?<=${LINE_START}|[\s;|&(){}\`'"])(?:[\w.~-]*\/)*(?:docker|podman|nerdctl|buildah)(?=[ \t])`, 'gm');
const COMMAND_BREAK = ';&|()\n';
const UID_GID = /^\d{1,10}:\d{1,10}$/;
// W3e-7 / F221, K: curl's cookie flag, `-b`/`--cookie`, takes a cookie string (`name=value; …`) or the
// name of a cookie file to read. A value with `=` in it is a cookie string: masked, whole. Any other is
// a file's name, and a filename is not a credential: kept. `-c`/`--cookie-jar` names the file curl
// writes, never a cookie. Only in curl's own simple command: another command's `-b` is its own.
const CURL_COMMAND = new RegExp(String.raw`(?<=${LINE_START}|[\s;|&(){}\`'"])(?:[\w.~-]*\/)*curl(?=[ \t])`, 'gm');
// curl's short options that take no argument, run together before `b` in one word (`-sSLb`): the cookie
// flag is the `b`, and its value the rest of the word or, when nothing is left, the next word. An
// option that takes an argument (`-d`, `-o`, …) takes the rest of the word itself: `-db=1` is data.
const CURL_COOKIE_SHORT = /^-[0-46#aBfgGiIjJklLMnNOpqRsSvVZ]*b/;
const NEXT = -2;
// W3e-7 / F220: a variable reference or a `<…>` placeholder, as one word, in quotes or not.
const REFERENCE_WORD = /^(["']?)(?:\$[A-Za-z_]\w*|\$\{[^{}\s]*\}|<[^<>\s]*>)\1$/;
// Where `scrub`'s fail-closed step splits tokens (its `split(/[\s,"'`()[\]{}]+/)`), one character.
const TOKEN_BREAK = /[\s,"'`()[\]{}]/;
const MARKERS_ONLY = /^(?:‹[^›]*›)+$/;

/** Is this value a placeholder the key-name rule leaves visible? The content rule's set, plus the
 *  exact-match placeholders every other layer honours. A value that is only this stage's own markers
 *  is one (f(f(x)) === f(x)); a marker with anything else glued to it never shields that. */
function isKeyedPlaceholder(value) {
  const t = value.trim();
  if (!t) return true;
  const u = unquote(t);
  if (MARKERS_ONLY.test(u)) return true;
  if (u.includes('‹')) return false;
  return isKeyValuePlaceholder(t) || isPlaceholderSecretValue(u);
}

// How far one value is scanned. A value that runs on past it is masked to the end of its line (fail
// closed). What it bounds is the work on adversarial single-line inputs of megabytes: measured before
// the bound, ~1MB of `,token=a` took ten minutes, every match re-scanning the one long word.
const MAX_KEYED_VALUE = 1024;

/** Where the line holding each position of `s` ends, by binary search over its newlines. */
function lineEnds(s) {
  const newlines = [];
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) newlines.push(i);
  return (i) => {
    let lo = 0, hi = newlines.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (newlines[mid] < i) lo = mid + 1; else hi = mid; }
    return lo < newlines.length ? newlines[lo] : s.length;
  };
}

/** One shell word from `i`, on a line that ends at `end`: quoted strings, `$(…)`, `${…}` and
 *  backquoted substitutions, escaped characters and plain characters, up to unquoted whitespace or a
 *  shell operator. It never crosses the line; an unclosed quote, or a word longer than
 *  MAX_KEYED_VALUE, runs to the line's end (fail closed); a line-continuation backslash is not part
 *  of it. */
function shellWordEnd(s, i, end) {
  const limit = Math.min(end, i + MAX_KEYED_VALUE);
  let k = i;
  while (k < limit) {
    const c = s[k];
    if (c === '"' || c === "'" || c === '`') {
      let j = k + 1;
      while (j < limit && s[j] !== c) j++;
      if (j >= limit) return end;
      k = j + 1;
    } else if (c === '$' && (s[k + 1] === '(' || s[k + 1] === '{')) {
      const open = s[k + 1], close = open === '(' ? ')' : '}';
      let depth = 0, j = k + 1;
      for (; j < limit; j++) { if (s[j] === open) depth++; else if (s[j] === close && --depth === 0) break; }
      if (j >= limit) return end;
      k = j + 1;
    } else if (c === '\\') {
      if (k + 1 >= end) return k;
      k += 2;
    } else if (/[\s;&|()<>]/.test(c)) return k;
    else k++;
  }
  return end;
}

/** The rest of the line from `i` (the line ends at `end`), without trailing blanks or a
 *  line-continuation backslash. */
function restEnd(s, i, end) {
  let e = end;
  if (e > i && s[e - 1] === '\\') e--;
  while (e > i && (s[e - 1] === ' ' || s[e - 1] === '\t' || s[e - 1] === '\r')) e--;
  return e;
}

/** The rest of the sentence from `i`: to the first run of `.`, `!` or `?` a blank or the line's end
 *  follows, else the rest of the line. A sentence does not end before it has begun: a run at `i`
 *  itself (`password: ... hunter2`) is part of the value (W3e-7 / F220: `...` opened a value and,
 *  ending it there, spared the rest). */
function sentenceEnd(s, i, end) {
  // W3e-8: read in place, to the first stop, never copying the rest of the line: a line may now hold
  // a line start at every command separator, each reading its own sentence.
  const e = restEnd(s, i, end);
  for (let k = i + 1; k < e; k++) {
    if (!SENTENCE_MARK.includes(s[k]) || SENTENCE_MARK.includes(s[k - 1])) continue;
    let r = k;
    while (r < e && SENTENCE_MARK.includes(s[r])) r++;
    if (r >= e || s[r] === ' ' || s[r] === '\t') return k;
    k = r - 1;
  }
  return e;
}
const SENTENCE_MARK = '.!?';

/** From `i` to the quote `q` that closes it on the line, else the rest of the line. */
function closingQuote(s, i, q, end) {
  const limit = Math.min(end, i + MAX_KEYED_VALUE);
  let j = i;
  while (j < limit && s[j] !== q) j++;
  return j < limit ? j : restEnd(s, i, end);
}

/** W3e-7 / F223. Is `s[i, e)` one command substitution, whole: `$(…)` whose parentheses balance at
 *  its last character, or `` `…` `` with no other backquote? One pass; never past the scan bound. */
function isSubstitution(s, i, e) {
  if (e - i > MAX_KEYED_VALUE) return false;
  if (e - i >= 2 && s[i] === '`' && s[e - 1] === '`') return s.indexOf('`', i + 1) === e - 1;
  if (e - i < 3 || s[i] !== '$' || s[i + 1] !== '(' || s[e - 1] !== ')') return false;
  let depth = 0;
  for (let j = i + 1; j < e; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return j === e - 1;
  }
  return false;
}

/**
 * Q. Where a quoted value that opened just before `i` closes, on a line that ends at `end`: the index
 * of its closing quote `q`, or -1 when it does not close within the scan bound. A backslash escapes
 * the character after it. `escaped`: the quotes are themselves escaped (`\"…\"`, JSON inside a JSON
 * string) — the value closes at a quote ONE backslash escapes (the index returned is that backslash);
 * a quote three escape (`\\\"`) is a quote inside it; a bare quote ends the enclosing string, and the
 * value with it.
 */
function quoteClose(s, i, q, end, escaped = false) {
  const limit = Math.min(end, i + MAX_KEYED_VALUE);
  for (let j = i; j < limit;) {
    if (s[j] === '\\') {
      if (!escaped) { j += 2; continue; }
      let r = 1;
      while (j + r < limit && s[j + r] === '\\') r++;
      if (s[j + r] === q && r % 2 === 1) { if (r === 1) return j; j += r + 1; continue; }
      j += r;
      continue;
    }
    if (s[j] === q) return j;
    j++;
  }
  return -1;
}

/** Q. From `[` at `i` to the `]` that closes it on the line (quoted strings skipped): that bracket's
 *  index, or -1 when it does not close within the scan bound. */
function bracketClose(s, i, end) {
  const limit = Math.min(end, i + MAX_KEYED_VALUE);
  let depth = 0;
  for (let j = i; j < limit; j++) {
    const c = s[j];
    if (c === '"' || c === "'") {
      const k = quoteClose(s, j + 1, c, limit);
      if (k < 0) return -1;
      j = k;
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return j;
  }
  return -1;
}

/** Q. A quoted string before a `:` or `=` that is not a key: a `case` label (`case "token":`), a
 *  comparison's operand (`x == "password":`), a ternary's branch (`c ? "token" : …`). `i`: where its
 *  opening quote stands. */
function notAKey(s, i) {
  let k = i;
  while (k > 0 && (s[k - 1] === ' ' || s[k - 1] === '\t')) k--;
  const c = s[k - 1];
  if (c === '=' || c === '!' || c === '?') return true;
  return /(?:^|[^\w$])case$/.test(s.slice(Math.max(0, k - 5), k));
}

/** B. Is `s[vs, end)` — what follows a key's `:` — a YAML block scalar's header? Checked only on a
 *  short rest of line, so a megabyte line of `password: |` costs nothing per match. */
const isBlockHeader = (s, vs, end) => (s[vs] === '|' || s[vs] === '>') && end - vs <= MAX_KEYED_VALUE
  && BLOCK_INDICATOR.test(s.slice(vs, end));
/** M33 R repair 5. The same, for a header in JSON-escaped text up to its escaped line break: a blank there may itself be
 *  escaped (`|\\t` before `\\r\\n`, a YAML text whose key line ends in a tab, serialized as JSON), escaped any number
 *  of times. Read with each escaped tab a tab; without it, the header read `|\\t`, was taken for the value, and the
 *  block's lines after it were left to no rule. */
const ESCAPED_TAB = /(?<!\\)\\+t/g;   // from a run's first backslash: a long run is read once
const isEscapedBlockHeader = (s, vs, end) => isBlockHeader(s, vs, end)
  || ((s[vs] === '|' || s[vs] === '>') && end - vs <= MAX_KEYED_VALUE && BLOCK_INDICATOR.test(s.slice(vs, end).replace(ESCAPED_TAB, '\t')));

/**
 * B. The YAML block scalars under a secret-named key in `lines`, as `[key, first, last]` line indices:
 * the key line, and the first and last line with text that the block holds (the blank lines between
 * them are its too). A block holds every line after its key indented deeper than the key, and blank
 * lines, up to the first line at or below the key's indentation. A block whose text is only this
 * stage's own markers, or one placeholder line, holds nothing to mask and is not returned (f(f(x)) ===
 * f(x); `password: |` over `${DB_PASSWORD}` stays). `strip`: how many leading characters of each line
 * are not its text (a diff line's hunk marker). A line that is not text ends a block. One pass, linear.
 *
 * W3e-7 / F219: a field that is not the diff may hold one (`git diff` output, a patch a body writes):
 * called with no `strip`, a key line that starts with a diff marker is read behind it too, and so is
 * each line of its block — a line that starts with no marker ends that block — and of the two
 * readings the one that holds more lines is taken (a context key, ` password: |`, is also plain
 * indentation, and may be either). Each block carries its own `strip`: `[key, first, last, strip]`.
 */
function secretBlocks(lines, strip = 0) {
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (typeof line !== 'string' || !line.includes(':')) continue;
    let best = blockUnder(lines, i, strip, false);
    if (!strip && (line[0] === '+' || line[0] === '-' || line[0] === ' ')) {
      const marked = blockUnder(lines, i, 1, true);
      if (marked && (!best || marked.last > best.last)) best = marked;
    }
    if (!best) continue;
    const { first, last, strip: lead, cls } = best;
    const held = [];
    for (let j = first; j <= last; j++) { const t = lines[j].slice(lead).trim(); if (t) held.push(t); }
    // W3e-8: one held line that is not a credential for its key (`keptValue`: `true`, a count, a
    // certificate file) is kept, as the same value after `key: ` is.
    if (held.every((t) => MARKERS_ONLY.test(t)) || (held.length === 1 && (isKeyedPlaceholder(held[0]) || keptValue(cls, held[0])))) { i = last; continue; }
    blocks.push([i, first, last, lead]);
    i = last;
  }
  return blocks;
}

/** B. The block a secret-named key on line `i` opens, read `strip` characters in: `{ first, last,
 *  strip }` (the first and last line with text it holds), or null. `marked`: each line's first
 *  character is a diff marker, and a line with none ends the block. */
function blockUnder(lines, i, strip, marked) {
  const m = BLOCK_KEY.exec(strip ? lines[i].slice(strip) : lines[i]);
  const cls = m && m[4].length <= MAX_KEYED_VALUE && BLOCK_INDICATOR.test(m[4]) ? secretNamed(m[3]) : null;
  if (!cls) return null;
  const column = m[1].length;
  let first = -1, last = -1;
  for (let j = i + 1; j < lines.length && typeof lines[j] === 'string'; j++) {
    const c = lines[j][0];
    if (marked && lines[j] && c !== '+' && c !== '-' && c !== ' ') break;
    const text = strip ? lines[j].slice(strip) : lines[j];
    const indent = LEADING_BLANKS.exec(text)[0].length;
    if (text.slice(indent).trim() === '') continue;                // a blank line: the block goes on
    if (indent <= column) break;
    if (first < 0) first = j;
    last = j;
  }
  return first < 0 ? null : { first, last, strip, cls };
}

/** B. A line a block holds, masked where it stands: its lead (a hunk marker), its indentation, the
 *  marker; a blank line is kept as it is. */
function maskedBlockLine(line, strip = 0) {
  const text = line.slice(strip);
  const indent = LEADING_BLANKS.exec(text)[0];
  if (text.slice(indent.length).trim() === '') return line;
  return line.slice(0, strip) + indent + SECRET_VALUE_MARKER + trailingCrs(text);
}

/** M33 R repair 5: the run of carriage returns `text` ends in (a CRLF text's one, a pseudo-terminal capture's two), read
 *  from the end: linear however long the line. */
function trailingCrs(text) {
  let k = text.length;
  while (k > 0 && text[k - 1] === '\r') k--;
  return text.slice(k);
}

/**
 * M33 R repair 3-5. The JSON-escaped line continuations in `text`, as `[start, end)` spans: a write's arguments
 * serialized as JSON (a MultiEdit's `edits`), a JSON document's text, escaped once or more. Escaped once, `KEY=\` + line
 * break + `  value` reads `KEY=\\\n  value`; a line break after a run of carriage returns (`\r\r\n`, a CRLF text
 * captured through a pseudo-terminal) reads `\\\r\r\n`; each further escaping doubles every backslash. Read as a
 * chain of runs of backslashes, each but the last followed by `r`, the last by `n`: a continuation is the chain from its
 * first run of three or more backslashes (the escaped `\` and its line break's escape) to the `n`, and then the blanks
 * and escaped blanks (`\n`, `\r`, `\t`, escaped any number of times) after it. A run that was no continuation (an
 * escaped backslash before an escaped line feed) is read as one too: this is only ever a view, and a view can only drop
 * a line. Linear: each character is read once, however long a run. `first`: stop at the first continuation found.
 */
function escapedContinuations(text, first = false) {
  const spans = [];
  const n = text.length;
  for (let i = text.indexOf('\\'); i >= 0 && i < n;) {
    let from = -1;                                    // the first run of three or more backslashes in this chain
    let k = i;
    let j;
    for (;;) {
      j = k;
      while (j < n && text[j] === '\\') j++;
      if (from < 0 && j - k >= 3) from = k;
      if (text[j] === 'r' && text[j + 1] === '\\') { k = j + 1; continue; }
      break;
    }
    if (from >= 0 && text[j] === 'n') {
      let e = j + 1;
      for (;;) {
        if (e < n && /\s/.test(text[e])) { e++; continue; }
        let q = e;
        while (q < n && text[q] === '\\') q++;
        if (q > e && q < n && (text[q] === 'n' || text[q] === 'r' || text[q] === 't')) { e = q + 1; continue; }
        break;
      }
      spans.push([from, e]);
      if (first) return spans;
      j = e;
    }
    i = text.indexOf('\\', Math.max(j, i + 1));
  }
  return spans;
}

/** The region the value in `s[vs, ve)` occupies: inside its quotes when it is one quoted string,
 *  after an auth scheme; null when nothing is left or it is a placeholder. A placeholder is the WHOLE
 *  value: a value of several words whose first word is one (`none shall pass`) is masked, all of it
 *  (W3e-7 / F220; it used to be kept whole). `cls`: the class of the name it is assigned to
 *  (`nameClass`), when a name gives it: a value provably not a credential for that name is kept
 *  (`keptValue`, W3e-5 / F211) — the whole value, never a word of it. */
function valueRegion(s, vs, ve, { cls = null } = {}) {
  while (ve > vs && (s[ve - 1] === ' ' || s[ve - 1] === '\t')) ve--;
  // A value past the scan bound is masked, not judged (MAX_KEYED_VALUE: fail closed). Judged, a value
  // kept as a placeholder that ran to the line's end (`${ --token ${ …`) left every later match on the
  // line to scan it again: measured before this bound, 1 MB of one line took about a minute.
  if (ve - vs > MAX_KEYED_VALUE) return { start: vs, end: ve };
  const q = s[vs];
  if (ve - vs >= 2 && (q === '"' || q === "'") && s[ve - 1] === q && s.indexOf(q, vs + 1) === ve - 1) { vs++; ve--; }
  const scheme = s.slice(vs, ve).match(AUTH_SCHEME);
  if (scheme) vs += scheme[0].length;
  if (vs >= ve) return null;
  const value = s.slice(vs, ve);
  if (isKeyedPlaceholder(value)) return null;
  if (cls && keptValue(cls, value)) return null;
  const inner = judgedValue(value);
  if (inner !== null && (isKeyedPlaceholder(inner) || (cls && keptValue(cls, inner)))) return null;
  return { start: vs, end: ve };
}

// W3e-8. A value that runs into the closing quote of the string it stands in — a flag or an assignment
// inside a JSON string (`{"cmd": "--token $TOKEN"}`), whose shell word does not close there — ends
// before that quote: the quote, and the brackets and commas that close what holds it, are not part of
// it. Only a value with no other quote in it, and only for judging: what is spared is a placeholder.
const CLOSING_TAIL = /^([^"'\\]*)\\?["'][\]}),;]*$/;
// W3e-8. A YAML block written with escaped line breaks inside a string (`"password: |\n  …"`): what
// it holds is the value, not its header. One held line is judged; more than one is masked.
const ESCAPED_BLOCK = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?[ \t]*\\n/;
/** What of `value` is judged when the whole is not a placeholder: the part before a closing quote,
 *  or an escaped block's one held line; null when neither applies. */
function judgedValue(value) {
  const tail = CLOSING_TAIL.exec(value);
  if (tail) return tail[1];
  const block = ESCAPED_BLOCK.exec(value);
  if (!block) return null;
  const held = value.slice(block[0].length).split('\\n').map((t) => t.trim()).filter(Boolean);
  if (held.length > 1) return null;
  if (!held.length) return '';
  return CLOSING_TAIL.exec(held[0])?.[1] ?? held[0];
}
/** The ported layers' test for a value that is not a credential (a placeholder, a boolean), applied
 *  to the value and to what of it `judgedValue` judges (W3e-8). */
const portedPlaceholder = (v) => isPlaceholderSecretValue(v) || BOOLEAN_VALUE.test(v);
function portedKept(value) {
  if (portedPlaceholder(value)) return true;
  // A string inside a JSON string has its quotes escaped (`db_pwd = \"false\"`): read them as quotes.
  const v = value.replace(/\\(["'])/g, '$1');
  const tail = CLOSING_TAIL.exec(v);
  if (tail) return portedPlaceholder(tail[1]);
  const q = v[0];
  if (q !== '"' && q !== "'") return false;
  const close = v.indexOf(q, 1);
  return close > 0 && /^["']?[\]}),;]*$/.test(v.slice(close + 1)) && portedPlaceholder(v.slice(1, close));
}

/** W3e-7 / F220. Where an assignment's value ends in a field that takes a line-start value to the end
 *  of its line (`ve`): at its first word when that word is a variable reference or a `<…>` placeholder
 *  and more words follow — `API_TOKEN=${API_TOKEN} npm run deploy`, `API_KEY=<your-api-key> npm start`
 *  is a shell assignment written out, and what follows it the command it prefixes, as in a command.
 *  No program prints a reference where a value belongs. This ends the value; it spares nothing: the
 *  value is then that one word, a placeholder only when all of it is. Otherwise `ve`. */
function assignmentEnd(s, vs, ve) {
  const limit = Math.min(ve, vs + MAX_KEYED_VALUE);
  let w = vs;
  while (w < limit && s[w] !== ' ' && s[w] !== '\t') w++;
  if (w >= limit || !REFERENCE_WORD.test(s.slice(vs, w))) return ve;
  // W3e-8 / F234: a `$word` or a `<…>` is a reference only as the one rule has it (`$hunter2` and
  // `<hunter2>` are values, and a value runs to the end of its line); a `${…}` is always the word.
  const word = unquote(s.slice(vs, w));
  return word.startsWith('${') || isReferencePlaceholder(word) ? w : ve;
}

/** The first `:` from `i` that stands outside this stage's markers (`‹redacted:…›` holds one), or Infinity. M33 R repair 9:
 *  `lftp -u bot,‹redacted:secret-value›` (rule 5's mask) read again took the marker's own `:` for the user flag's
 *  separator and masked half the marker: a second pass must read what the first read. `marks`: where the markers open,
 *  read on as `i` grows (each call starts at or past the last: linear over a line). */
function colonOutsideMarkers(s, i, marks) {
  for (let k = i; ;) {
    const c = s.indexOf(':', k);
    if (c < 0) return Infinity;
    if (marks.at < k) { marks.at = s.indexOf('\u2039', k); if (marks.at < 0) marks.at = Infinity; }
    if (marks.at > c) return c;
    const close = s.indexOf('\u203a', marks.at);
    if (close < 0) return c;
    k = close + 1;
  }
}

/** W3e-8. Where a logical line an escaped line break started ends: at the next escaped `\n` or `\r`
 *  (two characters), else `end`. Each character is read by one match at most: another such line
 *  start is itself an escaped line break. */
function escapedLineEnd(s, i, end) {
  for (let k = i; k + 1 < end; k++) if (s[k] === '\\' && (s[k + 1] === 'n' || s[k + 1] === 'r')) return k;
  return end;
}

/** W3e-8. Where a value a quote opened ends, on a line that ends at `end`: `[start, end)` of the value.
 *  `q`: the quote before the key; `escaped`: that quote is itself escaped (`\"`, a string inside a JSON
 *  string) — the value closes at the escaped quote. A value that opens with an escaped quote of its
 *  own (`"password = \"…\""`) is the string inside it. */
function quotedValue(s, vs, q, escaped, end) {
  if (s[vs] === '\\' && (s[vs + 1] === '"' || s[vs + 1] === "'")) {
    const close = quoteClose(s, vs + 2, s[vs + 1], end, true);
    return [vs + 2, close < 0 ? restEnd(s, vs + 2, end) : close];
  }
  if (escaped) {
    const close = quoteClose(s, vs, q, end, true);
    return [vs, close < 0 ? restEnd(s, vs, end) : close];
  }
  return [vs, closingQuote(s, vs, q, end)];
}

/** W3e-8. From `{` at `i` to the `}` that closes it on the line: that brace's index, or -1 when it
 *  does not close within the scan bound. */
function braceClose(s, i, end) {
  const limit = Math.min(end, i + MAX_KEYED_VALUE);
  let depth = 0;
  for (let j = i; j < limit; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}' && --depth === 0) return j;
  }
  return -1;
}

/**
 * The regions of `s` that are values of secret-named keys, in the shapes above. `mode`: 'shell',
 * 'prose' or 'data' — how far a line-start value runs. A match that starts inside a region already
 * running to the end of its line is skipped: nothing it could find lies outside that region.
 */
function secretNamedValues(s, mode) {
  const found = [];
  const endOf = lineEnds(s);
  const reaching = new Map();               // a line's end -> the start of a region that reaches it
  const inside = (i) => reaching.get(endOf(i)) <= i;
  const add = (r) => {
    if (!r) return;
    found.push(r);
    const end = endOf(r.start);
    if (r.end >= restEnd(s, r.start, end) && !(reaching.get(end) <= r.start)) reaching.set(end, r.start);
  };
  const heredoc = s.indexOf('<<');           // a here-document's lines are file content, not a command
  // W3e-8: a line start inside a value this loop already masked finds nothing outside it (its value
  // ends where that one does, or before) — so each character is read once, however many heads a line has.
  let keyed = -1;
  const addKeyed = (r) => { if (r) { add(r); keyed = Math.max(keyed, r.end); } };
  for (const m of s.matchAll(KEY_AT_LINE_START)) {
    if (m.index < keyed || inside(m.index)) continue;
    const [whole, head, name, pre, sep, post] = m;
    const cookie = sep === ':' && COOKIE_HEADER.test(name);
    const cls = cookie ? 'secret' : secretNamed(name);
    if (!cls) continue;
    const vs = m.index + whole.length;
    // W3e-8: a logical line an escaped line break started ends at the next one — unless its value is
    // a block's header, whose lines follow as escaped lines too (`judgedValue` reads them).
    let end = endOf(vs);
    if (head[0] === '\\') { const e = escapedLineEnd(s, vs, end); if (!(sep === ':' && isEscapedBlockHeader(s, vs, e))) end = e; }
    const after = vs - post.length;                     // just past the separator
    if (s[after] === sep || (sep === ':' && s.startsWith('//', after))) continue;   // `==`, `::`, a URL
    if (sep === ':' && isBlockHeader(s, vs, end)) continue;   // B: the lines below hold the value
    // C: a header's value is the whole rest of its line, in every field — a cookie has no sentences.
    if (cookie) { addKeyed(valueRegion(s, vs, restEnd(s, vs, end), { cls })); continue; }
    // A command's words: in a command outside a here-document, and after a command separator in any
    // field (W3e-8: LINE_HEAD) — there `NAME= cmd` is an empty assignment, and `NAME=value` one word.
    const command = head === ';' || head === '&&' || head === '||' || (mode === 'shell' && !(heredoc >= 0 && heredoc < m.index));
    if (sep === '=' && !pre && post && command) continue;
    const assignment = sep === '=' && !pre && !post;
    if (assignment && (mode === 'prose' || command))
      addKeyed(valueRegion(s, vs, shellWordEnd(s, vs, end), { cls }));
    else {
      const ve = mode === 'prose' ? sentenceEnd(s, vs, end) : restEnd(s, vs, end);
      addKeyed(valueRegion(s, vs, assignment ? assignmentEnd(s, vs, ve) : ve, { cls }));
    }
  }
  for (const m of s.matchAll(ASSIGNMENT_IN_LINE)) {
    const cls = secretNamed(m[1]);
    if (!cls || inside(m.index)) continue;
    const vs = m.index + m[0].length;
    if (s[vs] === '=') continue;                        // `==`
    const q = s[m.index - 1];
    const end = endOf(vs);
    if (q === '"' || q === "'") add(valueRegion(s, ...quotedValue(s, vs, q, s[m.index - 2] === '\\', end), { cls }));
    else add(valueRegion(s, vs, shellWordEnd(s, vs, end), { cls }));
  }
  for (const m of s.matchAll(SECRET_FLAG)) {
    const [whole, flag, sep] = m;
    const cls = secretNamed(flag);
    if (!cls || /stdin$/i.test(flag) || inside(m.index)) continue;   // `--password-stdin` takes no value
    const vs = m.index + whole.length;
    const end = endOf(vs);
    // A flag given no value on its line, or followed by another flag, a redirection or a comment.
    if (sep !== '=' && (vs >= end || '-<>|&;#'.includes(s[vs]) || (s[vs] === '\\' && vs + 1 >= end))) continue;
    // W3e-8: a `=` or `:` standing alone after it is a key's spaced separator, not a flag's value — the
    // line `-API_TOKEN = "…"` is a removed diff line (KEY_AT_LINE_START reads it behind its marker).
    if (sep !== '=' && (s[vs] === '=' || s[vs] === ':') && (vs + 1 >= end || s[vs + 1] === ' ' || s[vs + 1] === '\t')) continue;
    // W3e-5 / F211: a flag named in prose ("use --token instead") has no value: one ordinary word from
    // a closed list, then a blank or the line's end (after a closing quote or punctuation, if any).
    if (sep !== '=') {
      const word = PROSE_WORD.exec(s.slice(vs, Math.min(end, vs + 32)));
      if (word && PROSE_WORDS.has(word[1].toLowerCase())) continue;
    }
    add(valueRegion(s, vs, shellWordEnd(s, vs, end), { cls }));
  }
  let containers = null, operators = null;
  /** W3e-5 / F211: does position `i` stand in the simple command of a container runtime? The nearest
   *  such command word before it, with no operator between. Built once, then a binary search each. */
  const inContainerCommand = (i) => {
    if (!containers) {
      containers = [...s.matchAll(CONTAINER_COMMAND)].map((c) => c.index);
      operators = [];
      for (let k = 0; k < s.length; k++) if (COMMAND_BREAK.includes(s[k])) operators.push(k);
    }
    const last = (list) => {
      let lo = 0, hi = list.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < i) lo = mid + 1; else hi = mid; }
      return lo ? list[lo - 1] : -1;
    };
    const container = last(containers);
    return container >= 0 && last(operators) < container;
  };
  // The first `:` at or after the last word's start. Words are met in order, so it is found once for
  // all of them: a word that ran to the line's end with no `:` in it no longer re-read the line for
  // each user flag after it (W3e-7).
  let colon = -1;
  const marks = { at: s.includes('\u2039') ? -1 : Infinity };
  for (const m of s.matchAll(USERINFO_FLAG)) {
    if (inside(m.index)) continue;
    let ws = m.index + m[0].length;
    let we = shellWordEnd(s, ws, endOf(ws));
    const q = s[ws];
    if (we - ws >= 2 && (q === '"' || q === "'") && s[we - 1] === q) { ws++; we--; }
    if (colon < ws) colon = colonOutsideMarkers(s, ws, marks);
    if (colon >= we) continue;
    // W3e-5 / F211: a container's user and group ids (`docker run -u 1000:1000`) are not a password.
    if (we - ws <= 21 && UID_GID.test(s.slice(ws, we)) && inContainerCommand(m.index)) continue;
    // W3e-7 / F223: a password half that is wholly a command substitution (`-u $(id -u):$(id -g)`)
    // names the command it comes from, as a variable reference names a variable (`isKeyedPlaceholder`
    // keeps those already): it is not the value. Anything glued to it, and it is masked.
    const r = valueRegion(s, colon + 1, we);
    if (r && !isSubstitution(s, r.start, r.end)) add(r);
  }
  for (const m of s.matchAll(QUOTED_HEADER)) {
    const cls = COOKIE_HEADER.test(m[1]) ? 'secret' : secretNamed(m[1]);
    if (!cls || inside(m.index)) continue;
    const vs = m.index + m[0].length;
    add(valueRegion(s, ...quotedValue(s, vs, s[m.index - 1], s[m.index - 2] === '\\', endOf(vs)), { cls }));
  }
  for (const m of s.matchAll(QUOTED_KEY)) {
    const [whole, quote, name] = m;
    const cls = COOKIE_HEADER.test(name) ? 'secret' : secretNamed(name);
    if (!cls || inside(m.index) || notAKey(s, m.index)) continue;
    const vs = m.index + whole.length;
    const end = endOf(vs);
    if (vs >= end || s[vs] === '{' || isBlockHeader(s, vs, end)) continue;   // no value here, a nested object, B
    const c = s[vs];
    if (c === '"' || c === "'" || c === '`' || (c === '\\' && s[vs + 1] === '"' && quote === '\\"')) {
      const open = c === '\\' ? 2 : 1;
      const close = quoteClose(s, vs + open, c === '\\' ? '"' : c, end, c === '\\');
      add(valueRegion(s, vs + open, close < 0 ? restEnd(s, vs + open, end) : close, { cls }));
    } else if (c === '[') {
      const close = bracketClose(s, vs, end);
      add(valueRegion(s, vs + 1, close < 0 ? restEnd(s, vs + 1, end) : close, { cls }));
    } else {
      const limit = Math.min(end, vs + MAX_KEYED_VALUE);
      let j = vs;
      while (j < limit && s[j] !== ',' && s[j] !== '}' && s[j] !== ']') j++;
      add(valueRegion(s, vs, j >= limit ? restEnd(s, vs, end) : j, { cls }));
    }
  }
  for (const m of s.matchAll(QUERY_PARAMETER)) {
    const cls = QUERY_SECRET_NAME.test(m[1]) ? 'secret' : secretNamed(m[1]);
    if (!cls || inside(m.index)) continue;
    const vs = m.index + m[0].length;
    if (s[vs] === '=') continue;
    const end = endOf(vs);
    const limit = Math.min(end, vs + MAX_KEYED_VALUE);
    let j = vs;
    while (j < limit && !QUERY_VALUE_END.test(s[j])) j++;
    // A query flag is not a credential (`?password_reset=true`, pinned in redact.test.js): `keptValue`.
    const r = valueRegion(s, vs, j >= limit && limit < end ? restEnd(s, vs, end) : j, { cls });
    if (r) add({ ...r, query: true });
  }
  // R (W3e-8 / F233). A default inside a reference is a literal: masked to the reference's closing
  // brace unless it is empty or itself a reference. A default nested in one already masked is skipped.
  let masked = -1;
  for (const m of s.matchAll(DEFAULT_REFERENCE)) {
    const cls = secretNamed(m[1]);
    if (!cls || m.index < masked || inside(m.index)) continue;
    const ws = m.index + m[0].length;
    const end = endOf(ws);
    const close = braceClose(s, m.index + 1, end);
    const we = close < 0 ? restEnd(s, ws, end) : close;
    const word = s.slice(ws, we);
    if (!word.trim() || (we - ws <= MAX_KEYED_VALUE && isReferencePlaceholder(unquote(word.trim())))) continue;
    add({ start: ws, end: we });
    masked = we;
  }
  const commands = [...s.matchAll(PASSWORD_FLAG_COMMAND)];
  commands.forEach((m, n) => {
    // G. The words of this simple command, up to an operator, the line's end or the next such command
    // (which scans its own words) — so every character is read once, whatever the line holds.
    const command = m[1];
    const lineEnd = endOf(m.index);
    const stop = Math.min(lineEnd, n + 1 < commands.length ? commands[n + 1].index : Infinity);
    const blanks = (k) => { while (k < stop && (s[k] === ' ' || s[k] === '\t')) k++; return k; };
    for (let k = blanks(m.index + m[0].length); k < stop && !SHELL_OPERATOR.includes(s[k]); k = blanks(k)) {
      const we = Math.min(shellWordEnd(s, k, lineEnd), stop);
      if (we <= k) break;
      if (s[k] === '-' && s[k + 1] === 'p') {
        if (we > k + 2) {                                  // `-p<password>`
          if (!(PORT_FLAG_COMMANDS.has(command) && /^\d+$/.test(s.slice(k + 2, we)))) add(valueRegion(s, k + 2, we));
        } else if (command === 'sshpass') {                // `sshpass -p <password>`
          const v = blanks(we);
          if (v < stop && !SHELL_OPERATOR.includes(s[v])) {
            const ve = Math.min(shellWordEnd(s, v, lineEnd), stop);
            add(valueRegion(s, v, ve));
            k = Math.max(ve, v + 1);
            continue;
          }
        }
      } else if (command === 'sshpass') {
        if (s[k] !== '-') break;                           // the command sshpass runs: its options are its own
        if (SSHPASS_ARGUMENT_OPTION.test(s.slice(k, we))) {
          const v = blanks(we);
          k = v < stop && !SHELL_OPERATOR.includes(s[v]) ? Math.max(Math.min(shellWordEnd(s, v, lineEnd), stop), v + 1) : v;
          continue;
        }
      }
      k = we;
    }
  });
  const curls = [...s.matchAll(CURL_COMMAND)];
  curls.forEach((m, n) => {
    // K (W3e-7 / F221). The words of this curl command, up to an operator, the line's end or the next
    // curl (which scans its own words), as for G: every character is read once.
    const lineEnd = endOf(m.index);
    const stop = Math.min(lineEnd, n + 1 < curls.length ? curls[n + 1].index : Infinity);
    const blanks = (k) => { while (k < stop && (s[k] === ' ' || s[k] === '\t')) k++; return k; };
    // A cookie string has `=` in it; a cookie file's name, which the same flag takes, is kept.
    const cookie = (vs, ve) => { if (s.slice(vs, ve).includes('=')) add(valueRegion(s, vs, ve)); };
    for (let k = blanks(m.index + m[0].length); k < stop && !SHELL_OPERATOR.includes(s[k]); k = blanks(k)) {
      const we = Math.min(shellWordEnd(s, k, lineEnd), stop);
      if (we <= k) break;
      let vs = -1;                                         // where the value starts; NEXT: the next word
      if (s.startsWith('--cookie', k) && (we === k + 8 || s[k + 8] === '=')) vs = we === k + 8 ? NEXT : k + 9;
      else if (s[k] === '-' && s[k + 1] !== '-') {
        const short = CURL_COOKIE_SHORT.exec(s.slice(k, Math.min(we, k + 64)));
        if (short) vs = k + short[0].length === we ? NEXT : k + short[0].length;
      }
      if (vs === NEXT) {
        const v = blanks(we);
        if (v < stop && !SHELL_OPERATOR.includes(s[v])) {
          const ve = Math.min(shellWordEnd(s, v, lineEnd), stop);
          if (ve > v) cookie(v, ve);
          k = Math.max(ve, v + 1);
          continue;
        }
      } else if (vs >= 0) cookie(vs, we);
      k = we;
    }
  });
  // B. A block's lines, one region: the text from its first line to its last, each line masked where
  // it stands (`maskedBlockLine`), so the text keeps its lines and the block is declared once.
  if (s.includes('\n') && /:[ \t]*[|>]/.test(s)) {
    const lines = s.split('\n');
    const blocks = secretBlocks(lines);
    if (blocks.length) {
      const starts = [];
      for (let i = 0, o = 0; i < lines.length; i++) { starts.push(o); o += lines[i].length + 1; }
      for (const [, first, last, lead] of blocks) {
        const start = starts[first] + lead + LEADING_BLANKS.exec(lines[first].slice(lead))[0].length;
        const end = starts[last] + lines[last].replace(/[ \t\r]+$/, '').length;
        const repl = [];
        for (let k = first; k <= last; k++) repl.push(maskedBlockLine(k === last ? lines[k].replace(/[ \t\r]+$/, '') : lines[k], lead));
        add({ start, end, repl: repl.join('\n').slice(start - starts[first]) });
      }
    }
  }
  // A value a shell operator ended (`abc;…`) takes the rest of its token. `scrub`'s fail-closed step
  // judges tokens split at blanks, commas, quotes and brackets (TOKEN_BREAK); a fragment glued to a
  // masked value would be judged alone, and pass where the whole token failed. One pass, linear.
  // A query parameter's value is not: `&` ends it, and what follows is the next parameter, scanned
  // on its own by every rule (S).
  found.sort((a, b) => a.start - b.start);
  let reach = 0;
  for (const r of found) {
    if (r.query || r.end <= reach || !';&|<>'.includes(s[r.end] ?? ' ')) continue;
    let e = r.end;
    while (e < s.length && !TOKEN_BREAK.test(s[e])) e++;
    r.end = reach = e;
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// M33 R repair 8 — P, the PROXIMITY rule. The lead's decision after repair 7's two leak hunts: its label grammar
// (shape N: label phrases, joiners, separators, prose lists, for-clauses, next-line values, command and name/value
// shapes) is replaced. A grammar of phrasings did not converge — each hunt found more leaking families (a Unicode space
// at the separator among them), while over-masking of benign lines in those shapes grew. P reads no phrasing: it asks only whether a secret
// word stands NEAR a token, and whether the token is shaped like a credential.
//
//   1. VOCABULARY (the closed lists below; any case unless listed in PROXIMITY_CASED), as words or inside identifiers
//      (`api key`, `api_key`, `apiKey`, `X-Api-Key`, `api.key`, `APIKEY`), a phrase's words joined by any run of
//      blanks (every Unicode space among them), `_`, `-`, `.`, `/`, an apostrophe or nothing; a zero-width character
//      inside a word is read past. A word counts only where a word or a segment of an identifier starts and ends
//      (`tokenizer`, `keyboard`, `monkey`, `secretary` and `1Password` hold none). Three strengths: STRONG
//      (PROXIMITY_STRONG), the PASSWORD family (PROXIMITY_PASSWORD, strong, and rule 4) and WEAK (PROXIMITY_WEAK: `key`
//      and its translations alone). `key` behind another word or segment (`recall key`, `this key`, `recallKey`,
//      `RECALL_KEY`) or before `for` (`key for recall:`) is strong, unless that word names a kind of key that holds no
//      secret (PROXIMITY_PLAIN_KEYS: `primary key`, `sort key`, `cache key`, `public key` …). `pass` alone is the family's
//      only at a line's head (`pass: …`; `first pass`, `tests pass` are prose). A word inside a `$` reference (`$API_KEY`,
//      `${MY_TOKEN}`: a variable's name, not a value) gives no scope — the shell exception F186 pins (`echo $API_KEY=…
//      node app.js`); nor do the shell's `PWD`/`OLDPWD` and a `pwd` command; nor anything inside this stage's markers or
//      a region an older layer masked.
//   2. SCOPE: the line holding a strong word; and the next 2 non-blank lines when that line ENDS at its last strong word
//      — a label line: after the name only markup, a separator, an emoji, a parenthetical or a qualifier
//      (PROXIMITY_TAIL_WORDS) — `Password:`, `**Token** (prod)`, `Here's your new recall API key`; or a heading that holds
//      it (`## Recall API key in prod`); or a few words then a separator end it (`api key in prod:`, `Password for
//      admin:`). A weak word scopes its own line only. (`key` in a function's name, `loadKey()`, is weak.) Lines are split at real line breaks and at escaped ones (`\n`, `\r` written
//      as two characters: JSON text).
//   3. In scope every CREDENTIAL-SHAPED token is masked, whatever words, separators, verbs, tables, quotes or markup
//      stand around it: a maximal run of letters, digits and `+/=_-.~!#$%&*^@` (split at an inner `=` or `&`; sentence
//      punctuation and wrapping marks at its ends, and a diff marker at a line's start, are not its) of eight or more
//      with a letter and a digit, or hex of seven or more (digits only too), or base64/base64url of sixteen or more that
//      reads random, or a UUID. On a weak word's line only: sixteen or more with a letter and a digit, hex or base64 of
//      twenty or more, a UUID. BENIGN never applies in scope. Never masked: the vocabulary word itself, or a name that
//      holds it and nothing credential-shaped besides (`RECALL_API_KEY`, `apiKey`, `--password-stdin`: the NAME stays);
//      a segment of a path or URL with no letter-digit mix; a number of up to six digits; a version (`1.2.3`), a date
//      (`2024-09-01`); a file name with an extension and no letter-digit run of eight; an identifier of words
//      (`user_123_profile`, `OAuth2Client`); a technical word (PROXIMITY_TECH_WORDS: `ed25519`, `base64url` …); a
//      placeholder (`<…>`, `${…}`, `$X`, `***`, `xxx`, `YOUR_…_HERE`, `changeme`).
//   4. PASSWORD FAMILY: also the value written after the word, whatever its shape — after a separator (`:`, `=`, `→`,
//      `—`, a table or HTML cell …), the joining words (PROXIMITY_JOINERS: `is`, `was`, `to`, `with`, `should be`,
//      `is now`, `is still` …), what it is for (`for <name>`), a parenthetical or a qualifier — to the end of its clause
//      (the line; or a string's closing quote, `;`, a comment, a closing tag, the table cell); with no separator, the
//      next word alone. Kept: a placeholder, code (`getpass()`, `os.environ`), a name, a path, an option and the
//      closed PROXIMITY_STOP words (`none`, `required`, `reset`, `manager`, `policy` …; with no separator,
//      PROXIMITY_PROSE too). Before the word: `<v> is my wifi password`, `use <v> as the admin password`, `<v> (db
//      password)`. Below a label line of the family: the first non-blank line, when it is a value of at most six words
//      (`Password:` over `letmein`).
//   5. COMMANDS that set a secret, in any field, found anywhere on a line (prose, a diff, an output's numbered line) and
//      read both as the shell reads them and, when the line holds a quote, with quotes as breaks (a command inside JSON):
//      the input of `--password-stdin` / `--with-token` (the words `echo` or `printf` pipe in, a here-string), `--value`
//      when the command names a secret, `redis-cli -a`, `htpasswd -b`'s password, a registry `login -p`, `security … -w`, `gh secret set … --body/-b`, `npm|yarn|pnpm|bun config set`
//      and `git config` of a secret-named key, `doppler secrets set NAME`, and a here-string into a command that names
//      a secret — whatever its shape. (`echo <v> |` into a command naming a secret is on that command's line: rule 3.)
//   6. ORDER: P runs after every other layer (`scrub`'s regions, and this stage's markers, are no token to it), so
//      their bytes and labels stand. Deterministic, linear (each line is tokenized once; a password value that runs to
//      its clause's end is read once however many words a line holds), idempotent (a masked value is a marker).
// Declared under the existing reason (`redacted:secret-key-value`), marker `‹redacted:secret-value›`.
//
// M33 R repair 9 — the third leak hunt (over repair 8) found major families P's scope or token class did not
// reach. The lead's rule stands: the scope and the token class widen; no phrasing grammar returns.
//   S1. ACROSS AN EVENT'S FIELDS: an event's naming texts (its command, its path, an edit's old line in the file) put its
//       value fields in scope — what it printed, what it writes (`proximityEventScope`, `proximityInherited`, below).
//   S2. A LONE VALUE beside a strong word: a line holding one credential-shaped token, alone or as a value key's value
//       (PROXIMITY_VALUE_KEYS: `value:`, `"Value":`, `default =` …), within 2 non-blank lines of a strong word, ABOVE
//       or below it (`<v>\nthat is my recall api key`, `Your API key has been created successfully.\n<v>`); and a
//       name's whole record (`"Name": "/recall/api-key",` … `"Value": "<v>"`, up to 8 lines each way at its key's column).
//   S3. A LABEL'S BLOCK: rule 2's 2 lines run on, to 16 non-blank lines, while the block a label line opens goes on — to
//       the `}`/`]` closing a `{`/`[` it ends with, the lines indented deeper, the next heading after a heading or a
//       section header (`[recall.api_key]`), else its paragraph. Not for a record (a commit, a log line) or a word that
//       is a key's value (`- name: Configure AWS credentials`): their 2 lines.
//   S4. A WRAPPED LINE: a strong line of prose that ends mid-sentence puts the line right after it in scope when that
//       line goes on (a lower-case word or a credential-shaped token first).
//   S5. A label line may end in `,`, `;`, a line comment or an escaped line break or tab (`"Name": "/recall/api-key",`,
//       `- name: RECALL_API_KEY # used by the sync job`, `recall api key:\r`).
//   S6. Code is no label line: a line that opens a construct (`if …:`, `def …:`, `for … in …:`, `import`), or whose
//       words before its separator are code (`raw_password):`); the family's value below needs the name to end at the
//       word (`MIN_PASSWORD_LENGTH:`, `password_hash:` name none), and reads past a sibling key only in name/value data.
//   Rule 5 adds the closed lists PROXIMITY_SECRET_OPTIONS, _POSITIONS and _INPUTS (`sqlcmd -P`, `mongosh -p`, `zip -P`,
//   `ssh-keygen -N`, `ldapsearch -w`, `az login -p`, `lftp -u user,<v>`, `net user u <v>`, `vault login <v>`, `redis-cli
//   AUTH`, `chpasswd`'s input) and SQL's `IDENTIFIED BY '<v>'`; the vocabulary a wallet's words (`mnemonic`, `seed
//   phrase`, `recovery phrase`), `psk`, `pat`, more languages, markup's `*` between a phrase's words, fullwidth Latin.

/** Vocabulary entries: words separated by a blank (any joiner, or none, in the text); `(s)`: the plural too. */
export const PROXIMITY_STRONG = Object.freeze([
  'api key(s)', 'access key(s)', 'secret key(s)', 'private key(s)', 'signing key(s)', 'encryption key(s)',
  'master key(s)', 'license key(s)', 'licence key(s)', 'ssh key(s)', 'deploy key(s)', 'consumer key(s)', 'auth key(s)',
  'client key data', 'secret(s)', 'client secret(s)', 'webhook secret(s)', 'token', 'access token(s)',
  'refresh token(s)', 'auth token(s)', 'api token(s)', 'bearer token(s)', 'session token(s)', 'id token(s)',
  'bot token(s)', 'oauth token(s)', 'deploy token(s)', 'personal access token(s)', 'bearer', 'credential(s)', 'creds',
  'basic auth', 'dsn', 'recovery code(s)', 'backup code(s)', 'otp', 'totp',
  // M33 R repair 9: a personal access token by its short name (`azure devops pat:`).
  'pat',
  // Other languages: the phrases for an API key, a secret or private key, a token.
  'clé api', 'clé d api', 'clé secrète', 'clé privée', 'clé d accès', 'jeton', 'api schlüssel', 'geheimer schlüssel',
  'privater schlüssel', 'clave', 'chave api', 'chave de api', 'chave secreta', 'chave privada', 'chiave api',
  'chiave segreta', 'chiave privata', 'chiave di accesso', 'api キー', 'アクセスキー', '秘密鍵', 'トークン', '密钥', '秘钥',
  '令牌', 'api ключ', 'ключ api', 'секретный ключ', 'токен', 'api sleutel', 'geheime sleutel', 'api 키', '토큰',
  'klucz api', 'api anahtarı',
]);
/** The password family: strong, and rule 4 reads the value after (or before) the word. */
export const PROXIMITY_PASSWORD = Object.freeze([
  'password(s)', 'passwd', 'passphrase(s)', 'pwd', 'pw', 'passcode(s)', 'pin code(s)', 'pincode(s)', 'PIN',
  'db pass', 'database pass', 'user pass', 'login pass', 'admin pass', 'root pass', 'wifi pass', 'sudo pass', 'ftp pass',
  'smtp pass', 'mail pass', 'email pass', 'account pass', 'ssh pass', 'vpn pass', 'router pass', 'mysql pass',
  'postgres pass', 'pg pass', 'redis pass', 'app pass', 'pass',
  'mot de passe', 'passwort', 'kennwort', 'contraseña', 'contrasena', 'senha', 'пароль', 'パスワード', '密码', '密碼', '口令',
  'wachtwoord', 'hasło', 'haslo', 'şifre', 'lösenord', 'salasana', 'jelszó', 'heslo', '비밀번호',
  // M33 R repair 9: a wallet's words (the value runs to its clause's end, whatever its shape), a Wi-Fi pre-shared key, and
  // the password in more languages.
  'mnemonic(s)', 'mnemonic phrase(s)', 'seed phrase(s)', 'seed words', 'wallet seed words', 'recovery phrase(s)', 'wallet seed(s)', 'psk',
  'wpa psk', 'pre shared key(s)', 'parola', 'parolă', 'lozinka', 'kata sandi', 'mật khẩu', 'كلمة المرور', 'كلمة السر',
  'पासवर्ड', 'κωδικός', 'κωδικός πρόσβασης', 'συνθηματικό', 'סיסמה', 'סיסמא', 'รหัสผ่าน', 'geslo', 'slaptažodis', 'parool',
  'adgangskode', 'passord',
]);
/** Weak: `key` (and its translations) alone. */
export const PROXIMITY_WEAK = Object.freeze(['key(s)', 'clé(s)', 'schlüssel', 'chiave', 'chave(s)', 'キー', 'ключ', 'sleutel',
  '키', 'klucz', 'anahtar', 'nyckel']);
/** Matched only in the case written (`pin the version` is prose). */
export const PROXIMITY_CASED = Object.freeze(['PIN']);
/** Matched only as a line's first word (`pass: …`; `first pass`, `tests pass` are prose). */
export const PROXIMITY_LINE_HEAD = Object.freeze(['pass']);
/** The words before `key` that name a kind of key holding no secret: `key` stays weak behind them. */
export const PROXIMITY_PLAIN_KEYS = Object.freeze(['primary', 'foreign', 'unique', 'composite', 'compound', 'sort', 'partition',
  'range', 'hash', 'cluster', 'clustering', 'row', 'column', 'index', 'table', 'shard', 'routing', 'cache', 'redis',
  'memcache', 's3', 'object', 'bucket', 'blob', 'map', 'dict', 'dictionary', 'hashmap', 'json', 'yaml', 'toml', 'config',
  'registry', 'translation', 'i18n', 'locale', 'message', 'lookup', 'dedupe', 'dedup', 'idempotency', 'react', 'list',
  'element', 'item', 'hot', 'esc', 'escape', 'enter', 'return', 'shift', 'ctrl', 'control', 'alt', 'option', 'cmd',
  'command', 'meta', 'tab', 'space', 'arrow', 'function', 'fn', 'media', 'music', 'piano', 'public', 'publishable',
  'anon', 'pub', 'const', 'let', 'var', 'val', 'def', 'for', 'of', 'in', 'any', 'each', 'every', 'no', 'same', 'by',
  'missing', 'unknown', 'duplicate', 'invalid', 'sorting', 'grouping', 'group', 'cursor', 'pagination', 'page', 'query',
  'state', 'storage', 'local', 'session', 'cookie', 'header', 'field', 'property', 'prop', 'attribute', 'setting',
  'settings', 'env', 'environment', 'variable', 'dotted', 'nested', 'top', 'level', 'root', 'parent', 'child', 'next',
  'previous', 'first', 'last', 'major', 'minor', 'signature', 'gpg', 'pgp']);
/** The words a label line may end with, after its name (`api key value:`, `API key 2:`, `Token (prod)`). */
export const PROXIMITY_TAIL_WORDS = Object.freeze(['value', 'values', 'string', 'id', 'ids', 'here', 'below', 'above', 'prod',
  'production', 'staging', 'stage', 'dev', 'development', 'test', 'testing', 'live', 'sandbox', 'local', 'new', 'old',
  'current', 'latest', 'backup', 'primary', 'secondary', 'copy']);
/** Rule 4: the joining words read past between a password-family word and its value. */
export const PROXIMITY_JOINERS = Object.freeze(['is', 'was', 'were', 'are', 'be', 'to', 'with', 'now', 'still', 'just', 'also',
  'should', 'must', 'will', 'would', 'set', 'changed', 'equals', 'becomes', 'became', "it's", 'as']);
/** Rule 4: a word that is never a password's value (the lead's closed list, extended with type names, states and the
 *  words that say what a password is or what is done with it). */
export const PROXIMITY_STOP = Object.freeze(['none', 'not', 'empty', 'unset', 'required', 'optional', 'field', 'prompt', 'reset',
  'manager', 'policy', 'hash', 'length', 'protected', '1password', 'n/a', 'na', 'null', 'nil', 'undefined', 'true',
  'false', 'yes', 'no', 'string', 'str', 'text', 'number', 'int', 'integer', 'bool', 'boolean', 'bytes', 'object', 'any',
  'unknown', 'void', 'char', 'varchar', 'type', 'input', 'label', 'placeholder', 'hint', 'form', 'box', 'dialog',
  'screen', 'page', 'flow', 'link', 'button', 'change', 'changes', 'update', 'updated', 'expired', 'expires', 'expiry',
  'expiration', 'rotation', 'rotated', 'strength', 'strong', 'weak', 'rule', 'rules', 'requirement', 'requirements',
  'complexity', 'check', 'checks', 'validation', 'validator', 'verification', 'confirm', 'confirmation', 'again',
  'hashing', 'hashed', 'encrypted', 'encryption', 'salted', 'salt', 'stored', 'saved', 'sent', 'shown', 'hidden',
  'masked', 'redacted', 'provided', 'given', 'entered', 'generated', 'missing', 'invalid', 'incorrect', 'wrong',
  'correct', 'valid', 'too', 'very', 'can', 'cannot', "can't", 'could', 'may', 'might', 'need', 'needs', 'needed', 'has',
  'have', 'had', 'does', 'do', 'did', "doesn't", "don't", "isn't", "wasn't", 'see', 'use', 'used', 'using', 'ask', 'read',
  'in', 'on', 'at', 'by', 'via', 'from', 'for', 'of', 'into', 'without', 'and', 'or', 'but', 'if', 'when', 'then', 'that',
  'this', 'it', 'its', 'here', 'there', 'below', 'above', 'auth', 'authentication', 'login', 'logins', 'vault',
  'keychain', 'store', 'storage', 'file', 'env', 'environment', 'variable', 'var', 'argument', 'parameter', 'param',
  'option', 'flag', 'column', 'history', 'match', 'matches', 'mismatch', 'error', 'errors', 'based', 'less',
  'only', 'set', 'unchanged', 'same', 'different', 'blank', 'something', 'anything', 'nothing', 'one', 'ones',
  'stronger', 'longer', 'shorter', 'secure', 'safe', 'later', 'first', 'twice', 'yet', 'already', 'masking',
  'management', 'reuse', 'spraying', 'guessing', 'attempt', 'attempts', 'entry', 'request', 'requests', 'prompted',
  'please', 'kept', 'handled', 'checked', 'compared', 'logged', 'done', 'cleared', 'removed', 'disabled', 'enabled',
  'accepted', 'rejected', 'ignored', 'supported', 'configured', 'defined', 'specified', 'passed', 'loaded',
  'like', 'such', 'each', 'every', 'all', 'my', 'your', 'our', 'their', 'his', 'her', 'mine', 'yours', 'ours',
  'theirs', 'what', 'which', 'who', 'whose', 'where', 'how', 'why', 'auto', 'automatically', 'step', 'steps', 'eof',
  // M33 R repair 9: what a command prints that is no password (a status, a count's word).
  'ok', 'okay', 'success', 'succeeded', 'failed', 'warning', 'total', 'found', 'created', 'deleted', 'written']);
/** Rule 4 with no separator: the prose words that are no value either (`password for the db`, `the password the user
 *  chose`). After a separator they are a value (`wifi password: the purple elephant dances` is a passphrase). */
export const PROXIMITY_PROSE = Object.freeze(['the', 'a', 'an', 'these', 'those', 'is', 'was', 'are', 'were', 'be', 'to',
  'with', 'so', 'than', 'over', 'under', 'onto', 'after', 'before', 'about', 'against', 'during', 'through', 'until',
  'while', 'we', 'you', 'they', 'i', 'he', 'she', 'them', 'him', 'me', 'us', 'will', 'would', 'should', 'must', 'shall',
  'got', 'get', 'gets', 'getting', 'going', 'goes', 'went', 'make', 'makes', 'made', 'take', 'takes', 'took']);
/** Technical words and names whose letters and digits make them look like a credential: never masked. */
export const PROXIMITY_TECH_WORDS = Object.freeze(['ed25519', 'x25519', 'ed448', 'x448', 'base64url', 'base64', 'base32', 'base58',
  'sha1sum', 'sha224sum', 'sha256sum', 'sha384sum', 'sha512sum', 'md5sum', 'b2sum', 'sha224', 'sha256', 'sha384',
  'sha512', 'sha3-256', 'sha3-512', 'argon2', 'argon2id', 'argon2i', 'argon2d', 'pbkdf2', 'blake2b', 'blake2s', 'blake3',
  'chacha20', 'xchacha20', 'poly1305', 'secp256k1', 'secp256r1', 'secp384r1', 'secp521r1', 'prime256v1', 'rsa2048',
  'rsa3072', 'rsa4096', 'aes128', 'aes192', 'aes256', 'utf8mb4', 'utf8mb3', 'aarch64', 'x86_64', 'amd64', 'arm64',
  'ecdsa-sha2-nistp256', 'pkcs12', 'oauth2', 'webauthn', 'fido2', 'http2', 'ipv4', 'ipv6', 'x509', 'p256', 'p384', '1password']);

// M33 R repair 9's closed lists (S1 and rule 5). An event's scope across its fields reads them; each is pinned by
// redact/test/m33-r-repair-9.test.js.
/** S1: a file whose content is a secret whatever it holds (the last segment of a path; `*` any name, `.env.*` any end).
 *  The slicer's own list (slicer/src/before.js `CREDENTIAL_PATH`) withholds a read of these; this one masks what an
 *  event writes to them. Re-declared, never imported: this package imports nothing. */
export const PROXIMITY_SECRET_FILES = Object.freeze(['.env', '.env.*', '*.env', '.envrc', '.netrc', '_netrc', '.pgpass', '.my.cnf',
  '.npmrc', '.pypirc', '.git-credentials', '.htpasswd', 'credentials', 'credentials.json', 'kubeconfig', 'secrets.yml', 'secrets.yaml',
  'secrets.json', 'secrets.toml', 'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', '*.pem', '*.key', '*.p12', '*.pfx', '*.jks',
  '*.keystore', '*.kdbx', '*.ppk']);
/** S1: a command that prints a new secret, whatever its arguments name (words, in any case; a blank: any run of blanks).
 *  Written in lower case: this file names no randomness call (slicer/test/no-io-in-core.test.js greps it). */
export const PROXIMITY_SECRET_SOURCES = Object.freeze(['openssl rand', 'pwgen', 'apg', 'mkpasswd', 'gpg --gen-random',
  '/dev/urandom', '/dev/random', 'randombytes', 'securerandom', 'wg genkey', 'age-keygen']);
/** Rule 5: a command (and the words after it) and the option whose argument is a password, whatever its shape: the next
 *  word, or what is glued to a one-letter option (`7z` only that); a mark after the option: only the part after that mark
 *  (`lftp -u user,<v>`, `smbclient -U user%<v>`, `-pass pass:<v>`). */
export const PROXIMITY_SECRET_OPTIONS = Object.freeze(['sqlcmd -P', 'bcp -P', 'osql -P', 'isql -P', 'mongosh -p', 'mongo -p',
  'mongodump -p', 'mongorestore -p', 'mongoexport -p', 'mongoimport -p', 'mongostat -p', 'mongotop -p', 'cqlsh -p',
  'useradd -p', 'usermod -p', 'zip -P', 'unzip -P', '7z -p', '7za -p', '7zz -p', '7zr -p', 'openssl -k', 'ssh-keygen -N',
  'ssh-keygen -P', 'ldapsearch -w', 'ldapadd -w', 'ldapmodify -w', 'ldapdelete -w', 'ldapwhoami -w', 'ldapcompare -w',
  'ldapmodrdn -w', 'ldappasswd -w', 'ldappasswd -s', 'ldapexop -w', 'az login -p', 'lftp -u ,', 'smbclient -U %',
  'smbclient --user %', 'rpcclient -U %', 'openssl -pass pass:', 'openssl -passin pass:', 'openssl -passout pass:']);
/** Rule 5: a command, its subcommand (anywhere after it for `redis-cli`), and which of the words after the subcommand is a
 *  password (`last`: the last of them); options and `key=value` words are not counted. */
export const PROXIMITY_SECRET_POSITIONS = Object.freeze(['net user 2', 'rabbitmqctl add_user 2', 'rabbitmqctl change_password 2',
  'vault login 1', 'redis-cli auth last']);
/** Rule 5: a command that reads `user<mark>password` from its input (what `echo`/`printf` pipe in, a here-string). */
export const PROXIMITY_SECRET_INPUTS = Object.freeze(['chpasswd :']);
/** The keys whose value is the value (`value:`, `"Value":`, `ParameterValue`, `default =`): S2 reads a line keyed by one
 *  as a lone value beside a strong word (another key's line is a field of its own); rule 4, below a label line of the
 *  family in name/value data, takes its value and reads a sibling key's line (`"Type": "SecureString",`) past, up to 3. */
export const PROXIMITY_VALUE_KEYS = Object.freeze(['value', 'val', 'parametervalue', 'secretstring', 'secretvalue', 'default',
  'defaultvalue', 'content', 'data', 'plaintext']);
/** The recorder's own lines (the Codex native output header, slicer/src/codex.js): a word on one gives no scope, and S1
 *  reads a command's output after them. `<n>` a number, `<id>` a word. */
export const PROXIMITY_RECORDER_LINES = Object.freeze(['Chunk ID: <id>', 'Wall time: <n> seconds', 'Process exited with code <n>',
  'Process running with session ID <n>', 'Original token count: <n>', 'Exit code: <n>', 'Total output lines: <n>', 'Output:']);

// Every Unicode space a writer or a web page puts between words, and the zero-width characters (read past).
const PROX_SPACES = String.raw`\s\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff`;
const PROX_ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/;
// A cheap first look (most lines of a long output hold no vocabulary): a piece every spelling of every entry holds
// (redact/test/m33-r-repair-8.test.js pins that each entry is still found).
const PROX_HINT = /key|tok|secret|pass|pw|bear|cred|dsn|otp|pin|code|auth|cl[e\u00e9]|schl|clav|chav|chiav|jeton|wacht|senh|contra|kennw|has[l\u0142]|[s\u015f]ifre|l[o\u00f6]sen|salas|jelsz|hesl|sleut|klucz|anahtar|nyckel|\u043a\u043b\u044e\u0447|\u043f\u0430\u0440\u043e\u043b|\u0442\u043e\u043a\u0435\u043d|[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]|mnem|seed|recov|psk|pat(?![a-z])|parol|lozink|sandi|kh\u1ea9u|\u0643\u0644\u0645\u0629|\u092a\u093e\u0938|\u03ba\u03c9\u03b4|\u03c3\u03c5\u03bd\u03b8|\u05e1\u05d9\u05e1\u05de|\u0e23\u0e2b\u0e31\u0e2a|geslo|slapta|parool|adgang/i;
// Fullwidth Latin (`ｐａｓｓｗｏｒｄ`) is read as the ASCII it stands for (one code unit each way: no offset moves).
const PROX_FULLWIDTH = /[\uff01-\uff5e]/;
const proxFoldWide = (t) => (PROX_FULLWIDTH.test(t) ? t.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) : t);
// The same first looks, outside this stage's markers (read without a copy of the text).
const PROX_HINT_UNMASKED = new RegExp(`(?:${PROX_HINT.source})(?<!\u2039[a-z]{1,10}:[\\w-]{0,40}(?:${PROX_HINT.source}))`, 'i');
const PROX_MARKER = /\u2039[^\u203a\n]*\u203a/g;
/** Mark this stage's markers in `blocked` (none of their characters is a token). */
function proxBlockMarkers(s, blocked) {
  if (!s.includes('\u2039')) return;
  for (const m of s.matchAll(PROX_MARKER)) blocked.fill(1, m.index, m.index + m[0].length);
}
// M33 R repair 9: markup's `*` between a phrase's words too (`**API** key`).
const PROX_JOIN = String.raw`[${PROX_SPACES}\u200c\u200d\u2060_.'\u2019/*-]{0,16}`;
const PROX_JOIN_CHARS = new RegExp(String.raw`[${PROX_SPACES}\u200c\u200d\u2060_.'\u2019/*-]+`, 'g');
// Scripts written with no blank between words: a word of theirs needs no edge.
const PROX_CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
const proxEscape = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** An entry's spellings as normalized keys (lower case, no joiners), its `(s)` plural too. */
const proxKeys = (entry) => entry.split(' ').reduce((keys, word) => {
  const forms = word.endsWith('(s)') ? [word.slice(0, -3), `${word.slice(0, -3)}s`] : [word];
  return keys.flatMap((k) => forms.map((f) => k + f.toLowerCase()));
}, ['']);
const proxSource = (entry) => entry.split(' ').map((word) => (word.endsWith('(s)')
  ? `${proxEscape(word.slice(0, -3))}s?` : proxEscape(word))).join(PROX_JOIN);
const proxNorm = (text) => text.toLowerCase().replace(PROX_JOIN_CHARS, '');
/** Normalized key → `{ kind, cjk }`. Kinds: 'strong', 'password', 'weak'; 'cased' (the family, in the case written) and
 *  'head' (the family, at a line's head only). */
const PROX_KIND = new Map();
for (const [list, kind] of [[PROXIMITY_STRONG, 'strong'], [PROXIMITY_PASSWORD, 'password'], [PROXIMITY_WEAK, 'weak']]) {
  for (const entry of list) {
    const k = PROXIMITY_CASED.includes(entry) ? 'cased' : PROXIMITY_LINE_HEAD.includes(entry) ? 'head' : kind;
    for (const key of proxKeys(entry)) if (!PROX_KIND.has(key)) PROX_KIND.set(key, { kind: k, cjk: PROX_CJK.test(entry) });
  }
}
// Longest first, so a phrase is read before its last word.
const PROX_VOCABULARY = new RegExp([...PROXIMITY_STRONG, ...PROXIMITY_PASSWORD, ...PROXIMITY_WEAK]
  .sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).map(proxSource).join('|'), 'giu');
const PROX_PLAIN_KEYS = new Set(PROXIMITY_PLAIN_KEYS);
// A key block's armour line (`-----END RSA PRIVATE KEY-----`) is no label line: the block is the PEM rule's.
const PROX_ARMOUR = /^[\s+-]*-----(?:BEGIN|END) /;
// A public key is no secret, nor is what stands beside it (`NEXT_PUBLIC_SUPABASE_KEY`, a publishable key, `public key:
// ssh-ed25519 …`): `key` behind one of these words gives no scope at all.
const PROX_PUBLIC_KEY = /(?:^|[^A-Za-z0-9])(?:public|publishable|anon|pub)(?:[\s_./-]+[A-Za-z0-9]*)?[\s_./-]*$/i;
const PROX_TAIL_WORDS = new Set(PROXIMITY_TAIL_WORDS);
const PROX_JOINERS = new Set(PROXIMITY_JOINERS);
const PROX_STOP = new Set(PROXIMITY_STOP);
const PROX_PROSE = new Set(PROXIMITY_PROSE);
const PROX_TECH = new Set(PROXIMITY_TECH_WORDS);
const PROX_VALUE_KEYS = new Set(PROXIMITY_VALUE_KEYS);
// A wallet's words: the family's value runs to its clause's end even after `NAME=` in a command.
const PROX_PHRASE_KEYS = new Set(['mnemonic(s)', 'mnemonic phrase(s)', 'seed phrase(s)', 'seed words', 'wallet seed words',
  'recovery phrase(s)', 'wallet seed(s)'].flatMap(proxKeys));
// `to` joins a password to its value only after a verb that sets one (`set the db password to …`); elsewhere it is prose
// (`I sent the password to the admin`).
const PROX_SETTING_VERB = /\b(?:set|sets|setting|change|changed|changes|changing|update|updated|updates|reset|rotate|rotated|switch|switched)\b/i;
// Rule 4, read where a password word stands, never past a few characters: what it is for, a parenthetical or a
// qualifier ahead of a separator; a joining word.
const PROX_LOOKAHEAD = new RegExp(String.raw`(?:\(|(?:for|${PROXIMITY_TAIL_WORDS.join('|')})(?![\p{L}\p{N}]))`, 'iuy');
const PROX_JOINER_AT = new RegExp(String.raw`(?:${PROXIMITY_JOINERS.map((w) => w.replace("'", "['\u2019]")).join('|')}):?(?=[\s]|$)`, 'iy');
// The words after which a clause ends a value with no separator before it (rule 4).
const PROX_CLAUSE_WORDS = new Set(['and', 'or', 'then', 'but', 'so', 'for', 'on', 'at', 'to', 'in', 'from', 'if', 'when', 'with', 'via']);
const PROX_COMMAND_HINT = /redis-cli|htpasswd|login|--value|<<<|security|secret|config|doppler|stdin|with-token|sqlcmd|bcp|osql|isql|mongo|cqlsh|useradd|usermod|zip|7z|openssl|ssh-keygen|ldap|lftp|smbclient|rpcclient|net user|rabbitmqctl|vault|chpasswd|IDENTIFIED|identified/;
const PROX_COMMAND_HINT_UNMASKED = new RegExp(`(?:${PROX_COMMAND_HINT.source})(?<!\u2039[a-z]{1,10}:[\\w-]{0,40}(?:${PROX_COMMAND_HINT.source}))`);

// Characters, by kind.
const PROX_LD = /[\p{L}\p{N}]/u;
const PROX_LD_ANY = /[\p{L}\p{N}]/u;
const proxLD = (c) => c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
  || (c.charCodeAt(0) > 127 && PROX_LD.test(c)));
const PROX_BLANK = new RegExp(`[${PROX_SPACES}]`);
const proxBlank = (c) => {
  if (c === undefined) return false;
  const code = c.charCodeAt(0);
  return code < 128 ? code === 32 || (code >= 9 && code <= 13) : PROX_BLANK.test(c);
};
const PROX_TOKEN_CHARS = new Uint8Array(128);
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-.~!#$%&*^@') PROX_TOKEN_CHARS[c.charCodeAt(0)] = 1;
const proxIdent = (c) => c !== undefined && (proxLD(c) || c === '_' || c === '-' || c === '.');
/** 1 lower, 2 upper, 3 digit, 4 a letter with no case (CJK), 0 none. */
const proxCase = (c) => {
  if (c === undefined) return 0;
  if (c >= '0' && c <= '9') return 3;
  const lower = c.toLowerCase(), upper = c.toUpperCase();
  if (lower === upper) return proxLD(c) ? 4 : 0;
  return c === lower ? 1 : 2;
};
/** Is position `i` of `s` where a word, or a segment of an identifier, starts or ends (a non-letter, a case change into
 *  upper case, the last capital of a run before a lower-case letter; `digits`: a change between letters and digits too)?
 *  A vocabulary word takes no edge at a digit: a random token (`…k2pW7d…`) holds short words between its digits, and a
 *  word glued to a digit (`password1`) is a value, not a name. */
function proxEdge(s, i, digits = true) {
  const a = s[i - 1], b = s[i];
  if (!proxLD(a) || !proxLD(b)) return true;
  if (s[i - 2] === '\\' && (a === 'n' || a === 'r' || a === 't')) return true;     // just past an escaped break or tab
  const ka = proxCase(a), kb = proxCase(b);
  if ((ka === 3) !== (kb === 3)) return digits;
  if (ka === 1 && kb === 2) return true;
  return ka === 2 && kb === 2 && proxCase(s[i + 1]) === 1;
}
const proxSkipBlanks = (s, i, end) => { while (i < end && proxBlank(s[i])) i++; return i; };

// Rule 3's shapes and exemptions.
const PROX_HEX = /^[0-9a-f]+$/i;
const PROX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROX_VERSION = /^v?\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z]{1,16}(?:\.[0-9A-Za-z]{1,16})*)?$/;
// A date or a time, whole or in part (an output line's view without its leading number reads `09-30T08`).
const PROX_DATE = /^(?:(?:\d{1,4}[-./]){1,2}\d{1,4}(?:T\d{1,2}(?:[.:]\d{1,9})*Z?)?|(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])(?:T\d{4,6}Z?)?|\d{1,2}(?:[.:]\d{1,9})+Z)$/;
const PROX_PLACEHOLDER = /^(?:your[_-][\w-]*[_-]here|x{3,}|changeme|replace[_-]?me|redacted|placeholder)$/i;
const PROX_FILE = /^[^/]*\.[A-Za-z][A-Za-z0-9]{0,7}$/;
const PROX_BASE64 = /^(?:[A-Za-z0-9+/]+={0,2}|[A-Za-z0-9_-]+)$/;
// A package at a version (`recall-api@1.14.2`, `@octokit/auth-token@4.0.0`): a name of words, then a version.
const PROX_PACKAGE_VERSION = /^@?[A-Za-z][\w.-]{0,63}(?:\/[A-Za-z][\w.-]{0,63})?@v?\d{1,4}(?:\.\d{1,6}){0,3}(?:[-+][0-9A-Za-z.]{1,32})?$/;
const PROX_VOWEL = /[aeiouy]/i;
/** A letter-digit run of eight or more (`Button2024`, `a1b2c3d4`). */
const proxMixedRun = (t) => t.split(/[^A-Za-z0-9]+/).some((r) => r.length >= 8 && /\d/.test(r) && /[A-Za-z]/.test(r));
/** Base64 (or base64url) of letters with no digit that reads random: both cases, ten different characters or more, and
 *  case flips or few vowels. */
function proxRandom64(t) {
  if (!PROX_BASE64.test(t) || !/[a-z]/.test(t) || !/[A-Z]/.test(t)) return false;
  if (new Set(t.length > 64 ? t.slice(0, 64) : t).size < 10) return false;       // a run of a few letters repeated is no key
  if (/[\d+/]/.test(t)) return true;
  let flips = 0, vowels = 0, letters = 0;
  for (let i = 0; i < t.length; i++) {
    const k = proxCase(t[i]);
    if (k !== 1 && k !== 2) continue;
    letters++;
    if (PROX_VOWEL.test(t[i])) vowels++;
    if (i > 0 && (proxCase(t[i - 1]) === 1 || proxCase(t[i - 1]) === 2) && proxCase(t[i - 1]) !== k) flips++;
  }
  return flips * 3 >= t.length || vowels < letters * 0.2;
}
/** Is `t` credential-shaped (rule 3)? On a weak word's line (`weak`) only a longer one is. */
function proxCredential(t, weak) {
  const n = t.length;
  if (n < 7) return false;
  if (PROX_UUID.test(t)) return true;
  const digit = /\d/.test(t), letter = /[A-Za-z]/.test(t);
  if (weak) return (n >= 16 && digit && letter) || (n >= 20 && PROX_HEX.test(t)) || (n >= 20 && proxRandom64(t));
  return (n >= 8 && digit && letter) || PROX_HEX.test(t) || (n >= 16 && proxRandom64(t));
}
/** A camelCase word of words (`OAuth2Client`, `getUser2`): two or more segments of three letters or more, each with a
 *  vowel, every other letter segment of at most two, one number at most, of at most four digits. Never hex. */
function proxCamelWords(t) {
  if (!/^[A-Za-z0-9]+$/.test(t) || PROX_HEX.test(t)) return false;
  let wordy = 0, numbers = 0;
  for (const [a, b] of segmentsOf(t)) {
    const seg = t.slice(a, b);
    if (seg[0] >= '0' && seg[0] <= '9') { if (seg.length > 4 || ++numbers > 1) return false; continue; }
    if (seg.length <= 2) continue;
    if (!PROX_VOWEL.test(seg)) return false;
    wordy++;
  }
  return wordy >= 2;
}
/** An identifier of words (`user_123_profile`, `tenant_2024_q3`, `created_at_2024`): runs split at `_` `-` `.`, each a
 *  word, a number of up to six digits, a short mixed run (`v2`, `x86`) or a word and two digits (`beta3`), one word of
 *  three letters or more among them; all capitals only between `_` (a constant's name, never `ABCD-1234-EFGH`). */
function proxIdentifierWords(t) {
  const runs = t.split(/[_.-]+/).filter(Boolean);
  if (runs.length < 2) return proxCamelWords(t);
  const dashed = t.includes('-');
  let wordy = 0;
  for (const r of runs) {
    if (/^\d+$/.test(r)) { if (r.length > 6) return false; continue; }
    if (/^[A-Za-z]{3,}\d{1,2}$/.test(r) && PROX_VOWEL.test(r)) { wordy++; continue; }              // `beta3`
    if (/^[A-Za-z]+$/.test(r)) {
      if (r.length >= 3 && PROX_VOWEL.test(r)) {
        if (dashed && r === r.toUpperCase()) return false;
        wordy++;
      } else if (r.length > 3) return false;
      continue;
    }
    if (PROX_TECH.has(r.toLowerCase())) { wordy++; continue; }
    if (r.length <= 3 || /^[A-Za-z]{3,}\d{1,2}$/.test(r) || proxCamelWords(r)) continue;
    return false;
  }
  return wordy >= 1;
}
/** Does `t` read as a path (`/etc/x`, `~/.ssh/x`, `src/auth/token2.ts`)? Base64 with a `/` in it does not. */
function proxPathLike(t) {
  if (t[0] === '/' || t[0] === '~' || t[0] === '.' || t.includes('//')) return true;
  const parts = t.split('/').filter(Boolean);
  if (parts.length < 2) return false;
  let wordy = 0;
  for (const p of parts) if ((/^[A-Za-z][A-Za-z0-9_.-]*$/.test(p) && PROX_VOWEL.test(p) && !proxMixedRun(p)) || PROX_FILE.test(p)) wordy++;
  return wordy * 2 >= parts.length;
}

/** The vocabulary occurrences of `s` (edges checked), in order: `{ start, end, key, kind, cjk }`. Zero-width characters
 *  are read past. */
function proxOccurrences(s) {
  // This stage's own markers name no vocabulary (`‹redacted:secret-value›`, `‹redacted:github-token›`): read
  // as blanks, so a second pass finds what the first found and nothing more.
  let t = proxFoldWide(s.includes('\u2039') ? s.replace(PROX_MARKER, (m) => ' '.repeat(m.length)) : s), map = null;
  if (PROX_ZERO_WIDTH.test(s)) {
    const at = [];
    const u = t;
    t = '';
    for (let i = 0; i < u.length; i++) if (!PROX_ZERO_WIDTH.test(u[i])) { t += u[i]; at.push(i); }
    at.push(s.length);
    map = at;
  }
  if (!PROX_HINT.test(t)) return [];
  const found = [];
  const norms = new Map();                                // a text's words repeat: each spelling normalized once
  // Line by line, and only a line the first look passes: a long output of lines with no vocabulary costs one cheap test
  // a line. (A word never spans a line break.)
  for (let from = 0; from <= t.length;) {
    let to = t.indexOf('\n', from);
    if (to < 0) to = t.length;
    const line = from === 0 && to === t.length ? t : t.slice(from, to);
    if (PROX_HINT.test(line)) {
      PROX_VOCABULARY.lastIndex = 0;
      for (let m = PROX_VOCABULARY.exec(line); m; m = PROX_VOCABULARY.exec(line)) {
        const a = m.index, b = a + m[0].length;
        let key = norms.get(m[0]);
        if (key === undefined) { key = proxNorm(m[0]); if (norms.size < 4096) norms.set(m[0], key); }
        const info = PROX_KIND.get(key);
        const edges = info && (info.cjk ? (!/[A-Za-z0-9]/.test(line[a]) || proxEdge(line, a, false))
          : proxEdge(line, a, false) && proxEdge(line, b, false));
        if (!edges || (info.kind === 'cased' && !PROXIMITY_CASED.includes(m[0]))) { PROX_VOCABULARY.lastIndex = a + 1; continue; }
        const x = from + a, y = from + b;
        found.push({ start: map ? map[x] : x, end: map ? map[y - 1] + 1 : y, key, kind: info.kind });
      }
      PROX_VOCABULARY.lastIndex = 0;
    }
    from = to + 1;
  }
  return found;
}

/**
 * P, for `scrub`: the regions of `s` that the proximity rule masks. `mode` as `secretNamedValues`; `prior`: every region
 * an older layer found in `s` (never read as a token, never overlapped). `[]` when `s` holds no vocabulary and no command
 * that sets a secret.
 */
function proximityValues(s, mode, prior) {
  // Most lines: nothing to read (a zero-width character may stand inside a word: then the words are read without it).
  const stdin = proxStdinHint(s);
  if (!stdin && !PROX_HINT_UNMASKED.test(s) && !PROX_COMMAND_HINT_UNMASKED.test(s) && !PROX_ZERO_WIDTH.test(s) && !PROX_FULLWIDTH.test(s)) return [];
  const occs = proxOccurrences(s);
  const commands = stdin || (PROX_COMMAND_HINT.test(s) && (!s.includes('\u2039') || PROX_COMMAND_HINT.test(s.replace(PROX_MARKER, ''))));
  if (!occs.length && !commands) return [];
  const blocked = new Uint8Array(s.length);
  for (const r of prior) blocked.fill(1, Math.max(0, r.start), Math.min(s.length, r.end));
  proxBlockMarkers(s, blocked);
  return proxCore({ s, mode, blocked, occs, lines: proxLines(s, true), strip: 0, crossOnly: false, commands, stdin,
    heredoc: mode === 'shell' ? s.indexOf('<<') : -1 }).map(([start, end]) => ({ start, end }));
}

/**
 * P, for `maskBlocks` (the fields scanned a line at a time): the values the line BEFORE them puts in scope — the next
 * non-blank lines after a label line (rule 2), a password's value below its label (rule 4) — as `{ key, line, start, end }`
 * (the label line, and where the value stands in its own line). What each line makes in scope on its own line is
 * `scrub`'s. `priorOf(i)`: the regions the older layers find in line i (read only for a line a value is looked for in).
 */
function proximityAcross(lines, strip, priorOf) {
  if (lines.length < 2) return [];
  const hinted = (line) => typeof line === 'string' && (PROX_HINT_UNMASKED.test(line) || PROX_ZERO_WIDTH.test(line) || PROX_FULLWIDTH.test(line));
  const blank = (line) => typeof line !== 'string' || proxSkipBlanks(line, Math.min(line.length, strip), line.length) >= line.length;
  const found = [];
  // Only a line holding a word can open a scope: it reaches up to 8 non-blank lines back (a lone value above it, a record's
  // fields, S2) and up to 16 on (its block, S3). Each such run of lines is read on its own, so a long text with few words costs one cheap test
  // a line, and each line is in one run.
  let done = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!hinted(lines[i])) continue;
    let first = i;
    for (let j = i - 1, need = PROX_RECORD_LINES, blanks = 0; j > done && need > 0 && blanks < PROX_BLANK_RUN; j--) {
      if (typeof lines[j] !== 'string') break;
      first = j;
      if (blank(lines[j])) blanks++; else { need--; blanks = 0; }
    }
    let last = i;
    for (let j = i + 1, need = PROX_BLOCK_LINES, blanks = 0; j < lines.length && need > 0 && blanks < PROX_BLANK_RUN; j++) {
      if (typeof lines[j] !== 'string') break;
      last = j;
      if (hinted(lines[j])) { need = PROX_BLOCK_LINES; blanks = 0; } else if (blank(lines[j])) blanks++; else { need--; blanks = 0; }
    }
    if (last > first) proxAcrossRun(lines, first, last, strip, priorOf, found);
    done = last;
    i = last;
  }
  return found;
}
/** `proximityAcross` over the run of lines `first..last`. */
function proxAcrossRun(lines, first, last, strip, priorOf, found) {
  const run = lines.slice(first, last + 1);
  const s = run.join('\n');
  const occs = proxOccurrences(s);
  if (!occs.length) return;
  const starts = [];
  for (let i = 0, o = 0; i < run.length; i++) { starts.push(o); o += run[i].length + 1; }
  const blocked = new Uint8Array(s.length);
  proxBlockMarkers(s, blocked);
  const ctx = { s, mode: 'data', blocked, occs, lines: proxLines(s, false), strip, crossOnly: true, heredoc: -1, keyOf: new Map(),
    prepare: (li) => { for (const r of priorOf(first + li)) blocked.fill(1, starts[li] + Math.max(0, r.start), starts[li] + Math.min(run[li].length, r.end)); } };
  for (const [start, end, line] of proxCore(ctx)) {
    found.push({ key: first + (ctx.keyOf.get(line) ?? line), line: first + line, start: start - starts[line], end: end - starts[line] });
  }
}

/** The lines of `s` as `[start, end, inString]`, split at real line breaks and, when `escaped`, at escaped ones (`\n`,
 *  `\r\n`, `\r` written as two characters by an unescaped backslash: JSON text). `inString`: the line starts inside a
 *  double-quoted string an escaped line break interrupted. */
function proxLines(s, escaped) {
  const lines = [];
  let from = 0, quote = false, opened = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\n') { lines.push([from, i, opened]); from = i + 1; quote = false; opened = false; continue; }
    if (c === '"') { quote = !quote; continue; }
    if (c !== '\\') continue;
    const n = s[i + 1];
    if (escaped && (n === 'n' || n === 'r')) {
      lines.push([from, i, opened]);
      let j = i + 2;
      if (n === 'r' && s[j] === '\\' && s[j + 1] === 'n') j += 2;
      from = j;
      opened = quote;
      i = j - 1;
      continue;
    }
    if (n !== '\n' && n !== '\r') i++;                     // an escaped character: an escaped quote opens nothing
  }
  lines.push([from, s.length, opened]);
  return lines;
}

/** The rule over the lines of `ctx.s`: each region as `[start, end, line]`. Two passes: what each line's words give
 *  (rule 1), then the lines each strong line puts in scope (rules 2 and 4, S2-S4), then each line read once. */
function proxCore(ctx) {
  const { s, lines, occs } = ctx;
  const out = [];
  ctx.out = out;
  ctx.occs = occs;
  const n = lines.length;
  // Each occurrence's line, its identifier, and whether it gives scope at all.
  let li = 0;
  const run = { line: -1, start: 0, end: 0 };
  // The occurrences of line i are occs[first[i] .. first[i] + count[i]) (they come in order).
  const first = new Int32Array(n).fill(-1);
  const count = new Int32Array(n);
  const recorder = new Map();
  for (let oi = 0; oi < occs.length; oi++) {
    const o = occs[oi];
    while (li < lines.length - 1 && o.start >= lines[li + 1][0]) li++;
    o.line = li;
    const [ls, le] = lines[li];
    // The identifier the word stands in: a run of letters, digits, `_`, `-`, `.`. Occurrences come in order, so a run is
    // read once however many words it holds (`tokenTokenToken…`).
    if (!(run.line === li && o.start >= run.start && o.start < run.end)) {
      let a = o.start, b = o.end;
      while (a > Math.max(ls, run.line === li ? run.end : ls) && proxIdent(s[a - 1])) a--;
      while (b < le && proxIdent(s[b])) b++;
      run.line = li;
      run.start = a;
      run.end = Math.max(b, o.end);
    }
    o.identStart = run.start;
    o.identEnd = Math.max(run.end, o.end);
    o.skip = false;
    for (let k = o.start; k < o.end; k++) if (ctx.blocked[k]) { o.skip = true; break; }
    if (!o.skip) o.skip = proxSkipped(s, o, ls, le);
    // M33 R repair 9: a word on the recorder's own line (`Original token count: 40`, the only one of its lines that holds
    // one) gives no scope.
    if (!o.skip && s.startsWith(PROX_RECORDER_VOCABULARY, proxSkipBlanks(s, Math.min(le, ls + ctx.strip), le))) {
      if (!recorder.has(li)) recorder.set(li, proxRecorderLine(s.slice(Math.min(le, ls + ctx.strip), le)));
      o.skip = recorder.get(li);
    }
    if (first[li] < 0) first[li] = oi;
    count[li]++;
  }
  // What each line's words give: 2 a strong word, 1 a weak one; `last`, its last strong word.
  const own = new Uint8Array(n);
  const lastOf = [];
  for (let oi = 0; oi < occs.length;) {
    const i = occs[oi].line;
    const [ls, le] = lines[i];
    const text = Math.min(le, ls + ctx.strip);
    let o2 = 0, last = null;
    const end = oi + count[i];
    for (; oi < end; oi++) {
      const o = occs[oi];
      if (o.skip) continue;
      if (o.kind === 'head' && (o.identStart - text > 64 || !/^[\s>*+\-\u2022]*(?:\d{1,3}[.)][ \t]+)?$/.test(s.slice(text, o.identStart)))) { o.skip = true; continue; }
      o.family = o.kind === 'password' || o.kind === 'cased' || o.kind === 'head';
      if (o.kind === 'weak' && PROX_PUBLIC_KEY.test(s.slice(Math.max(text, o.identStart - 48), o.start))) { o.skip = true; continue; }
      o.strong = o.kind === 'weak' ? proxKeyStrong(s, o, text) : true;
      if (o.strong) { o2 = 2; last = o; } else if (!o2) o2 = 1;
    }
    own[i] = o2;
    if (last) lastOf.push([i, last]);
  }
  // The lines each strong line puts in scope. `scope`: every token (a label's block, S3; a wrapped line, S4); `near`: a
  // lone value line (S2); `below`: a password's value below its label (rule 4). `keyOf`: the line that put it there.
  const info = proxLineInfo(ctx);
  const scope = new Uint8Array(n);
  const near = new Uint8Array(n);
  const below = new Map();
  const keyOf = ctx.keyOf ?? null;
  const mark = (arr, j, i) => { if (!arr[j]) { arr[j] = 1; if (keyOf && !keyOf.has(j)) keyOf.set(j, i); } };
  for (const [i, last] of lastOf) {
    const [ls, le] = lines[i];
    const text = info.textAt(i);
    // Rule 2 and S3: a label line — it ends at its last strong word but for markup, a separator, an emoji, a
    // parenthetical, a qualifier, `,`/`;`, a comment, an escaped break (S5) — scopes its block.
    const tail = !PROX_ARMOUR.test(s.slice(text, Math.min(le, text + 80))) ? proxLabelTail(ctx, last, le, text) : false;
    if (tail) {
      const reach = proxBlock(ctx, info, i, tail, last);
      for (const j of reach) mark(scope, j, i);
      // Rule 4 below a label of the family: the first line of its scope (or a value key's line among its first 3). The
      // name must end at the word (`MIN_PASSWORD_LENGTH:` and `password_hash:` name no password's value).
      if (last.family && !last.plural && last.end === last.identEnd && reach.length) below.set(reach[0], { tail, label: i, left: Math.min(3, reach.length), reach });
    } else if (proxWraps(ctx, info, i)) mark(scope, i + 1, i);
    // S2: the lone value lines within 2 non-blank lines of it, above and below.
    for (const step of [-1, 1]) {
      for (let j = i + step, seen = 0, blanks = 0; j >= 0 && j < n && seen < 2 && blanks < 256; j += step) {
        if (info.blank(j)) { blanks++; continue; }
        seen++;
        mark(near, j, i);
      }
    }
    // S2, name/value data: a key's line whose value names the secret (`"Name": "/recall/api-key",`, `- name: RECALL_API_KEY`)
    // reaches its record's other fields — the lines at its key's column, up to 8 each way, no blank line between, a list
    // item's marker opening the record — so its value key's line is a value whatever fields stand between.
    const head = proxDecorationEnd(s, text, le);
    if (PROX_KEYED.test(s.slice(head, Math.min(last.identStart, head + 140)))) {
      const col = head - ls;
      for (const step of [-1, 1]) {
        for (let j = i + step, seen = 0; j >= 0 && j < n && seen < PROX_RECORD_LINES && !info.blank(j); j += step, seen++) {
          const [js, je] = lines[j];
          const jt = info.textAt(j);
          const jh = proxDecorationEnd(s, jt, je);
          if (jh - js !== col) break;
          const item = /^[-*+\u2022][ \t]/.test(s.slice(proxSkipBlanks(s, jt, je), Math.min(je, jt + 64)).replace(/^[ \t]+/, ''));
          if (step > 0 && item) break;                                     // the next record
          mark(near, j, i);
          if (step < 0 && item) break;                                     // this record's first line
        }
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const valueBelow = below.get(i);
    if (!scope[i] && !near[i] && !valueBelow && !ctx.commands && !own[i]) continue;
    if (info.blank(i) && !own[i]) continue;
    ctx.current = i;
    if (ctx.crossOnly) {
      if ((own[i] < 2 && (scope[i] || near[i])) || valueBelow) ctx.prepare(i);
      if (own[i] < 2 && scope[i]) proxTokens(ctx, i, false);
      else if (own[i] < 2 && near[i]) proxValueLine(ctx, i);
      if (valueBelow) proxBelowFrom(ctx, i, valueBelow, below);
    } else {
      if (own[i] === 2 || scope[i]) proxTokens(ctx, i, false);
      else {
        if (own[i] === 1) proxTokens(ctx, i, true);
        if (near[i]) proxValueLine(ctx, i);
      }
      if (first[i] >= 0) for (let oi = first[i]; oi < first[i] + count[i]; oi++) { const o = occs[oi]; if (!o.skip && o.family) { proxPasswordAfter(ctx, i, o); proxPasswordBefore(ctx, i, o); } }
      if (valueBelow) proxBelowFrom(ctx, i, valueBelow, below);
      proxCommands(ctx, i);
    }
  }
  return out;
}

/** Rule 4 below a label of the family, at line `i` of its scope: the value (`proxPasswordBelow`); a sibling key's line
 *  (`"Type": "SecureString",`) passes the reading to the next line of the scope, up to 3. */
function proxBelowFrom(ctx, i, b, below) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  const d = proxDecorationEnd(s, Math.min(le, ls + ctx.strip), le);
  const fence = s.startsWith('```', d) || s.startsWith('~~~', d);           // a code fence: the value is inside it
  if (!fence && (proxPasswordBelow(ctx, i, b.tail) !== 'next' || b.left <= 1)) return;
  const at = b.reach.indexOf(i);
  const next = b.reach[at + 1];
  if (next === undefined || below.has(next)) return;
  // A sibling field of the same record: its key at the label's key column, no list item of its own (`- name: LOG_LEVEL`
  // after `key: password` is the next record).
  if (!fence) {
    const col = (j) => { const [a, e] = ctx.lines[j]; return proxDecorationEnd(s, Math.min(e, a + ctx.strip), e) - a; };
    // Only name/value data reads past a sibling: the label line is itself a key's line (`- name: DB_PASSWORD`, `"Name": …`).
    const [lls, lle] = ctx.lines[b.label];
    const lh = proxDecorationEnd(s, Math.min(lle, lls + ctx.strip), lle);
    if (!PROX_KEYED.test(s.slice(lh, Math.min(lle, lh + 140)))) return;
    const [ns, ne] = ctx.lines[next];
    const indent = proxSkipBlanks(s, Math.min(ne, ns + ctx.strip), ne);
    if (col(next) !== col(b.label) || /^[-*+\u2022][ \t]/.test(s.slice(indent, indent + 2))) return;
  }
  below.set(next, { ...b, left: b.left - 1 });
}

/** Per line of `ctx`, read once each and only when asked: where its text starts (past `strip`), whether it is blank, its
 *  indentation, its brackets' balance, whether it is a heading. */
function proxLineInfo(ctx) {
  const { s, lines } = ctx;
  const n = lines.length;
  const blankC = new Int8Array(n).fill(-1);
  const indentC = new Int32Array(n).fill(-1);
  const bracesC = new Map();
  const textAt = (i) => Math.min(lines[i][1], lines[i][0] + ctx.strip);
  const blank = (i) => {
    if (blankC[i] < 0) blankC[i] = proxSkipBlanks(s, textAt(i), lines[i][1]) >= lines[i][1] ? 1 : 0;
    return blankC[i] === 1;
  };
  const indent = (i) => {
    if (indentC[i] < 0) {
      let k = textAt(i), w = 0;
      const le = lines[i][1];
      while (k < le && (s[k] === ' ' || s[k] === '\t')) { w += s[k] === '\t' ? 4 : 1; k++; }
      indentC[i] = w;
    }
    return indentC[i];
  };
  const braces = (i) => {
    let d = bracesC.get(i);
    if (d === undefined) {
      d = 0;
      const [, le] = lines[i];
      for (let k = textAt(i); k < le; k++) { const c = s[k]; if (c === '{' || c === '[') d++; else if (c === '}' || c === ']') d--; }
      bracesC.set(i, d);
    }
    return d;
  };
  const heading = (i) => /^[ \t>]*(?:#{1,6}[ \t]|\[\[?[^\][\n]{1,120}\]\]?[ \t]*$)/.test(s.slice(textAt(i), Math.min(lines[i][1], textAt(i) + 130)));
  return { textAt, blank, indent, braces, heading };
}

const PROX_BLOCK_LINES = 16;
const PROX_RECORD_LINES = 8;
const PROX_BLANK_RUN = 256;
/** S3: the lines a label line on `i` scopes — its next 2 non-blank lines (rule 2), and on to 16 non-blank lines while
 *  its block goes on: to the `}`/`]` that closes a `{`/`[` it ends with; through the lines indented deeper than it; to
 *  the next heading after a heading or a section header (`## Recall API key`, `[recall.api_key]`); else its paragraph
 *  (no blank line between). A run of more than 256 blank lines ends it. */
function proxBlock(ctx, info, i, tail, o) {
  const { s, lines } = ctx;
  const n = lines.length;
  const [, le] = lines[i];
  const text = info.textAt(i);
  // Its 2 lines only: a record (a commit, a log line: a credential-shaped token or a digit first), and a label whose word
  // is a key's value (`- name: Configure AWS credentials`, `"Name": "/recall/api-key",`: its value key is beside it).
  const head = proxDecorationEnd(s, text, le);
  const base = proxRecord(s, head, le) || PROX_KEYED.test(s.slice(head, Math.min(o.identStart, head + 140)));
  let e = le;
  const line = s.slice(text, Math.min(le, text + 400));
  const comment = /[ \t](?:#|\/\/)(?:[ \t].*)?$/.exec(line);
  if (comment) e = text + comment.index;
  while (e > text && proxBlank(s[e - 1])) e--;
  const brace = s[e - 1] === '{' || s[e - 1] === '[';
  const heading = tail === 'section' || info.heading(i);
  const own = info.indent(i);
  let depth = brace ? 1 : 0, indented = null, blankSince = false;
  const reach = [];
  for (let j = i + 1, blanks = 0; j < n && reach.length < (base ? 2 : PROX_BLOCK_LINES) && blanks < PROX_BLANK_RUN; j++) {
    if (info.blank(j)) { blanks++; blankSince = true; continue; }
    blanks = 0;
    if (reach.length === 0 && !brace && !heading) indented = info.indent(j) > own;
    if (reach.length >= 2) {
      if (brace) { if (depth <= 0) break; }
      else if (heading) { if (info.heading(j)) break; }
      else if (indented) { if (info.indent(j) <= own) break; }
      else if (blankSince) break;
    }
    reach.push(j);
    blankSince = false;
    if (brace) depth += info.braces(j);
  }
  return reach;
}

/** S4: does strong line `i` wrap onto the next — prose of four words or more that ends mid-sentence (a letter, a digit
 *  or `,` last), not a record (a log line, a commit: a digit or a credential-shaped token first) nor code, the next line
 *  right after it going on (a lower-case word or a credential-shaped token first)? */
function proxWraps(ctx, info, i) {
  const { s, lines } = ctx;
  if (i + 1 >= lines.length) return false;
  const [ls, le] = lines[i];
  let e = le;
  while (e > ls && proxBlank(s[e - 1])) e--;
  if (e <= ls || !(proxLD(s[e - 1]) || s[e - 1] === ',') || e - ls > 400) return false;
  let blanks = 0;                                                        // four words or more: three blanks at least
  for (let k = ls; k < e && blanks < 3; k++) if (s[k] === ' ') blanks++;
  if (blanks < 3 || info.blank(i + 1)) return false;
  const p = proxDecorationEnd(s, info.textAt(i), le);
  if (e <= p || !(proxLD(s[e - 1]) || s[e - 1] === ',') || proxRecord(s, p, e)) return false;
  const line = s.slice(p, e);
  if (/[{}=<>|\\]/.test(line)) return false;
  const words = line.split(/[\s]+/);
  let plain = 0;
  for (const w of words) if (/^[A-Za-z][a-z]+[,;]?$/.test(w) && ++plain >= 4) break;
  if (plain < 4) return false;
  const [, ne] = lines[i + 1];
  const q = proxDecorationEnd(s, info.textAt(i + 1), ne);
  if (q >= ne) return false;
  if (s[q] >= 'a' && s[q] <= 'z') return true;
  let k = q;
  while (k < ne && k - q < 256 && !proxBlank(s[k])) k++;
  return proxCredential(s.slice(q, k).replace(/^["'`(]+|["'`),.;:!?]+$/g, ''), false);
}

/** S2: line `i`, a lone value — past its decoration, an optional key and separator, quotes or markup: one token, a `,`
 *  `;` `.` or a closing bracket after it, a comment — has that token judged by rule 3 (a path is none). */
function proxValueLine(ctx, i) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  if (le - ls > 512) return;
  const p = proxDecorationEnd(s, Math.min(le, ls + ctx.strip), le);
  if (p >= le) return;
  const line = s.slice(p, le);
  const tail = /(?:[ \t]+(?:#|\/\/)(?:[ \t].*)?)?[ \t,;.\r)\]}]*$/.exec(line);
  let e = p + tail.index;
  const key = /^(?:"([^"\n]{1,64})"|'([^'\n]{1,64})'|([A-Za-z_$@][\w.$@-]{0,63}))[ \t]*(?::=|=>|->|:(?![:/])|=(?!=))[ \t]*/.exec(line.slice(0, e - p));
  // A value is alone on its line, or a value key's (`value: <v>`, `"Value": "<v>"`, `default = "<v>"`): another key's value
  // beside a strong word (`x-request-id: 2b7c1f0e`) is a field of its own.
  if (key && !PROX_VALUE_KEYS.has((key[1] ?? key[2] ?? key[3]).toLowerCase())) return;
  let a = key ? p + key[0].length : p;
  for (let n = 0; n < 3 && a < e; n++) {
    if (s.startsWith('**', a) && s.startsWith('**', e - 2) && e - a > 4) { a += 2; e -= 2; continue; }
    const c = s[a];
    if ((c === '"' || c === "'" || c === '`') && s[e - 1] === c && e - a > 2) { a++; e--; continue; }
    break;
  }
  if (e - a < 7 || e - a > 1024) return;
  for (let k = a; k < e; k++) {
    const c = s.charCodeAt(k);
    if (ctx.blocked[k] || c >= 128 || PROX_TOKEN_CHARS[c] !== 1) return;
  }
  const t = s.slice(a, e);
  const base64 = t.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(t) && /\d/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t);
  if (!base64 && t.includes('/') && proxPathLike(t)) return;
  proxToken(ctx, i, a, e, false);
}

/** Is the text at `p` (to `le`) a record — a commit, a log line, an id list: a digit or a credential-shaped token first? */
function proxRecord(s, p, le) {
  if (p >= le || (s[p] >= '0' && s[p] <= '9')) return p < le;
  let k = p;
  while (k < le && k - p < 128 && !proxBlank(s[k])) k++;
  return proxCredential(s.slice(p, k).replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''), false);
}
// A key and its separator at a line's start (`name: `, `"Name": `, `key = `).
const PROX_KEYED = /^(?:"[^"\n]{1,64}"|'[^'\n]{1,64}'|[A-Za-z_$@][\w.$@-]{0,63})[ \t]*(?::(?![:/])|=(?!=))/;

// The recorder's lines, as patterns.
const PROX_RECORDER = PROXIMITY_RECORDER_LINES.map((line) => new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  .replace('<n>', String.raw`\d+(?:\.\d+)?`).replace('<id>', String.raw`\S+`)}$`));
const proxRecorderLine = (text) => text.length <= 64 && PROX_RECORDER.some((re) => re.test(text.trim()));
// The one recorder's line that holds a word of the vocabulary, as it starts.
const PROX_RECORDER_VOCABULARY = 'Original token count: ';

/** Does an occurrence give no scope: inside a `$` reference (`$API_KEY`, `${MY_TOKEN}`, `%TOKEN%`) or a placeholder's
 *  brackets (`<db_password>`), the shell's
 *  `PWD`/`OLDPWD` or a `pwd` command, or `1Password`? */
function proxSkipped(s, o, ls, le) {
  const before = s[o.identStart - 1];
  if (before === '$' || (before === '{' && s[o.identStart - 2] === '$') || (before === '%' && s[o.identEnd] === '%')) return true;
  if (before === '<' && s[o.identEnd] === '>') return true;                     // a placeholder's name (`<db_password>`)
  if (o.key === 'pwd') {
    const name = s.slice(o.identStart, o.identEnd);
    if ((name === 'PWD' || name === 'OLDPWD') && s[o.identEnd] === '=') return true;      // the shell's variable
    if (name === 'pwd' && /(?:^|[;&|(`]|\$ )[ \t]*$/.test(s.slice(Math.max(ls, o.identStart - 8), o.identStart))
      && /^[ \t]*(?:$|[;&|)`])/.test(s.slice(o.identEnd, Math.min(le, o.identEnd + 8)))) return true;
  }
  if (o.key === 'password' && s[o.start - 1] === '1') return true;
  o.plural = o.key !== 'pass' && o.key.endsWith('s') && PROX_KIND.has(o.key.slice(0, -1));
  return false;
}

/** Is `key` (a weak word) strong here: behind a segment of its identifier or a word before it that names no plain kind of
 *  key (`recallKey`, `RECALL_KEY`, `recall key`, `this key`), or before `for` (`key for recall:`)? Translations stay
 *  weak, and so does a function's name (`loadKey()`). */
function proxKeyStrong(s, o, ls) {
  if (o.key !== 'key' && o.key !== 'keys') return false;
  if (s[o.identEnd] === '(') return false;                          // a function's name (`loadKey()`), not a key's
  let k = o.start;
  if (o.identStart < k) {
    if (k - 1 >= o.identStart && (s[k - 1] === '_' || s[k - 1] === '-' || s[k - 1] === '.')) k--;
    let j = k;
    while (j > o.identStart && proxLD(s[j - 1]) && !(j < k && proxEdge(s, j))) j--;
    const prev = s.slice(j, k);
    if (prev && proxLD(prev[0]) && !/^\d+$/.test(prev)) return !PROX_PLAIN_KEYS.has(prev.toLowerCase());
  } else {
    let e = o.start;
    while (e > ls && proxBlank(s[e - 1])) e--;
    if (e < o.start) {
      let j = e;
      while (j > ls && /\p{L}/u.test(s[j - 1])) j--;
      if (j < e && (j === ls || !proxIdent(s[j - 1]))) return !PROX_PLAIN_KEYS.has(s.slice(j, e).toLowerCase());
    }
  }
  return /^[ \t]+for[ \t]/.test(s.slice(o.identEnd, o.identEnd + 6));
}

/** Rule 2: does the line end at its last strong word `o`, but for markup, a separator, an emoji, a parenthetical or a
 *  qualifier — and (M33 R repair 9, S5) a trailing `,` or `;`, a line comment, an escaped line break or tab? A token or
 *  a region an older layer masked after the name is a value: then it does not. Nor is code a label line (S6): a line
 *  that opens a construct (`if …:`, `def …:`, `for … in …:`) or whose words before the separator are code (`):`).
 *  Returns false, 'separator' (the tail holds one: `Password:`, `API_KEY=`), 'label' (`## Password`, `**Token**`) or
 *  'section' (a TOML or INI section header holding the word: `[recall.api_key]`). */
function proxLabelTail(ctx, o, le, ls) {
  const { s } = ctx;
  const from = o.identEnd;
  if (le - from > 200) return false;
  for (let k = from; k < le; k++) if (ctx.blocked[k] && !ctx.crossOnly) return false;
  const head = proxDecorationEnd(s, ls, le);
  if (PROX_CODE_HEAD.test(s.slice(head, Math.min(le, head + 12)))) return false;
  if (s[head] === '[' && /^\[\[?[^\][\n]{1,120}\]\]?[ \t\r]*$/.test(s.slice(head, le))) return 'section';
  let rest = s.slice(from, le);
  if (rest.includes('\u2039') || rest.includes('\u203a')) return false;   // a marker: a value stood there
  rest = rest.replace(/(?:\\[rnt])+[ \t\r]*$/, '');
  const comment = /[ \t](?:#|\/\/)(?=[ \t]|$)/.exec(rest);
  if (comment) rest = rest.slice(0, comment.index);
  rest = rest.replace(/[ \t\r]*[,;]?[ \t\r]*$/, '');
  const cleaned = rest;
  for (let n = 0; n < 64 && rest; n++) {
    const m = PROX_TAIL.exec(rest);
    if (!m || !m[0]) break;
    const word = m[1]?.toLowerCase();
    if (word && !PROX_TAIL_WORDS.has(word) && !/^#?\d{1,4}$|^v\d{1,3}$/.test(word)) break;
    rest = rest.slice(m[0].length);
  }
  if (rest === '') return /[:=\uff1a\u2192\u21d2]|->/.test(cleaned) ? 'separator' : 'label';
  // Or a few words, then a separator that ends the line (`api key in prod:`, `Password for admin:`, `recall api key for the
  // staging cluster:`): what the label is for. No word of them may be credential-shaped (a value stood there), nor code.
  // A markdown heading holding the word is a label line whatever words follow it (`## API key in prod`).
  const tail = cleaned.replace(/[\s*_\x60#]+$/u, '');
  const separated = /(?:[:=\uff1a\u2192\u21d2]|->|=>)$/.test(tail);
  if (!separated && !/^[ \t>]*#{1,6}[ \t]/.test(s.slice(ls, Math.min(le, ls + 16)))) return false;
  const words = (separated ? tail.slice(0, -1) : tail).split(/[\s]+/).filter(Boolean);
  if (words.length > 8 || words.some((w) => proxCredential(w.replace(/^[^\w]+|[^\w]+$/g, ''), false) || PROX_CODE_WORD.test(w))) return false;
  return separated ? 'separator' : 'label';
}
// S6: a line that opens a code construct is no label line (lower case: `If the API key is missing:` is prose).
const PROX_CODE_HEAD = /^(?:if|elif|else|while|for|def|class|with|except|switch|case|catch|function|func|fn|lambda|unless|until|foreach|import|from|export|package|using)(?:[ \t(:{]|$)/;
// A word before a label's separator that is code: a bracket it does not open and close, `=`, `<`, `>`, quotes, `;`.
const PROX_CODE_WORD = /[=<>{};]|^[^(]*\)|\([^)]*$|^[^[]*\]|\[[^\]]*$/;
const PROX_TAIL = new RegExp(String.raw`^(?:[${PROX_SPACES}*_~\x60"'#>=|:{\[\uff1a\u2192\u21d2\u2026!.\-\u2013\u2014\u2022]|<\/[A-Za-z]{1,10}>|\p{Extended_Pictographic}|\ufe0f`
  + String.raw`|\((?=[^()\n]*\p{L})[^()\n]{1,80}\)|\[(?=[^\][\n]*\p{L})[^\][\n]{1,80}\]|(#?[\p{L}\p{N}]{1,16})(?![\p{L}\p{N}]))`, 'u');

/** Where a line's text starts after its decoration: indentation, a quote's `>`, a list marker, an output line's number
 *  (`     2\t`, `2→`). */
function proxDecorationEnd(s, i, le) {
  let k = proxSkipBlanks(s, i, le);
  const number = /^\d{1,7}(?:\t|\u2192)/.exec(s.slice(k, Math.min(le, k + 9)));
  if (number) k = proxSkipBlanks(s, k + number[0].length, le);
  for (let n = 0; n < 8 && k < le; n++) {
    const m = /^(?:>|[-*+\u2022](?=[ \t])|\d{1,3}[.)](?=[ \t]))/.exec(s.slice(k, Math.min(le, k + 5)));
    if (!m) break;
    k = proxSkipBlanks(s, k + m[0].length, le);
  }
  return k;
}

/** Rule 3 over line `i`: each token, judged (`weak`: a weak word's line). */
function proxTokens(ctx, i, weak) {
  const { s, blocked } = ctx;
  const [ls, le] = ctx.lines[i];
  for (let j = ls; j < le;) {
    const code = s.charCodeAt(j);
    if (blocked[j] || code >= 128 || PROX_TOKEN_CHARS[code] !== 1) {
      j += code === 92 && j + 1 < le ? (s[j + 1] === 'u' ? 6 : 2) : 1;   // an escape (`\n`, `\t`, `\"`, `\u00a0`) is no token
      continue;
    }
    let k = j + 1;
    while (k < le && !blocked[k] && s.charCodeAt(k) < 128 && PROX_TOKEN_CHARS[s.charCodeAt(k)] === 1) k++;
    proxToken(ctx, i, j, k, weak);
    j = k;
  }
}

/** One token `[a, b)` of line `i`: its wrapping and a diff marker off, split at an inner `=` or `&`, each piece judged. */
function proxToken(ctx, i, a, b, weak) {
  const { s } = ctx;
  const ls = ctx.lines[i][0];
  if (s[a] === '$' || (s[a - 1] === '{' && s[a - 2] === '$')) return;     // a reference
  while (a < b && '!#%&*^@'.includes(s[a])) a++;
  while (b > a && '.!#$%&*^@'.includes(s[b - 1])) b--;
  if (a === ls && b - a > 1 && (s[a] === '+' || s[a] === '-')) a++;    // a diff marker
  if (b - a < 7) return;
  if (s[a - 1] === '<' && s[b] === '>' && isReferencePlaceholder(`<${s.slice(a, b)}>`)) return;
  let p = a;
  for (let k = a + 1; k < b - 1; k++) {
    if ((s[k] === '=' || s[k] === '&') && s[k + 1] !== '=') { proxPiece(ctx, p, k, weak); p = k + 1; }
  }
  proxPiece(ctx, p, b, weak);
}

function proxPiece(ctx, a, b, weak) {
  const { s } = ctx;
  while (b > a && s[b - 1] === '.') b--;
  if (b - a < 7) return;
  const t = s.slice(a, b);
  // Base64 of both cases and digits is one token, whatever `/` it holds (`Xk9…/mTjBN7o`): never read as a path's segments.
  const base64 = t.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(t) && /\d/.test(t) && /[a-z]/.test(t) && /[A-Z]/.test(t);
  if (!base64 && t.includes('/') && proxPathLike(t)) {
    // A path: each segment on its own; a segment with no letter-digit mix is kept.
    for (let p = a, k = a; k <= b; k++) {
      if (k < b && s[k] !== '/') continue;
      const seg = s.slice(p, k);
      if (/\d/.test(seg) && /[A-Za-z]/.test(seg) && proxCredential(seg, weak) && !proxExempt(ctx, seg, p, k)) ctx.out.push([p, k, ctx.current]);
      p = k + 1;
    }
    return;
  }
  if (proxCredential(t, weak) && !proxExempt(ctx, t, a, b)) ctx.out.push([a, b, ctx.current]);
}

/** Is the credential-shaped `t` (at `[a, b)`) one rule 3 never masks? */
function proxExempt(ctx, t, a, b) {
  if (PROX_UUID.test(t)) return false;
  const lower = t.toLowerCase();
  if (PROX_TECH.has(lower) || /^\d{1,6}$/.test(t) || PROX_VERSION.test(t) || PROX_DATE.test(t)) return true;
  if (PROX_PACKAGE_VERSION.test(t)) return true;                       // M33 R repair 9: `recall-api@1.14.2`
  if (isKeyedPlaceholder(t) || PROX_PLACEHOLDER.test(t)) return true;
  if (proxNamed(ctx, a, b)) return true;
  if (PROX_HEX.test(t)) return false;
  if (PROX_FILE.test(t) && !proxMixedRun(t.slice(0, t.lastIndexOf('.')))) return true;
  return proxIdentifierWords(t);
}

/** Does `[a, b)` hold a vocabulary word, and beside it nothing credential-shaped (the name stays: `RECALL_API_KEY`,
 *  `apiKey2024`, `--password-stdin`; `secret_<40 random>` does not)? */
function proxNamed(ctx, a, b) {
  const { s, occs } = ctx;
  let lo = 0, hi = occs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (occs[mid].start < a) lo = mid + 1; else hi = mid; }
  let any = false, p = a;
  for (let i = lo; i < occs.length && occs[i].start < b; i++) {
    const o = occs[i];
    if (o.end > b) continue;
    any = true;
    if (proxRest(s.slice(p, o.start))) return false;
    p = Math.max(p, o.end);
  }
  return any && !proxRest(s.slice(p, b));
}
const proxRest = (rest) => rest.split(/[^A-Za-z0-9]+/).some((run) => run.length >= 7 && proxCredential(run, false)
  && !PROX_TECH.has(run.toLowerCase()) && !/^\d{1,6}$/.test(run) && !PROX_DATE.test(run) && !proxCamelWords(run));

// ---- rule 4 ---------------------------------------------------------------------------------------------------------

/** At `p`: an explicit separator (`:`, `=`, `:=`, `=>`, `->`, `→`, `⇒`, `：`, `—`, `–`, a lone `-`, a table cell's `|`,
 *  an HTML cell's closing and opening tags); where it ends, or -1. */
function proxSeparator(s, p, le) {
  if (p >= le) return -1;
  const c = s[p], d = s[p + 1];
  if ((c === ':' && d === '=') || (c === '=' && d === '>') || (c === '-' && d === '>')) return p + 2;
  if (c === ':' && d === ':') return proxBlank(s[p + 2]) ? p + 2 : -1;
  if (c === ':') return d === '/' ? -1 : p + 1;
  if (c === '=') return d === '=' || d === '~' ? -1 : p + 1;
  if ('\u2192\u21d2\uff1a\u2014\u2013'.includes(c)) return p + 1;
  if (c === '-' && (proxBlank(d) || d === undefined)) return p + 1;
  if (c === '|' && d !== '|') return p + 1;
  if (c === '<' && d === '/') {
    let k = p;
    const close = /^<\/[A-Za-z]{1,10}>/.exec(s.slice(k, Math.min(le, k + 14)));
    if (!close) return -1;
    k = proxSkipBlanks(s, k + close[0].length, le);
    if (s[k] === ':' || s[k] === '=') k = proxSkipBlanks(s, k + 1, le);
    return k;
  }
  return -1;
}
/** Past markup and opening tags before a value (`**`, `__`, `<code>`, `<td>`, `<span …>`). */
function proxValueStart(s, p, le) {
  for (let n = 0; n < 6; n++) {
    p = proxSkipBlanks(s, p, le);
    const m = /^(?:\*\*|__|<(?:td|th|dd|code|kbd|b|strong|em|i|span|p|pre|samp|var|mark)(?:[ \t][^<>\n]{0,80})?>)/i.exec(s.slice(p, Math.min(le, p + 90)));
    if (!m) break;
    p += m[0].length;
  }
  return p;
}
/** The word at `p` (to a blank or the line's end; an unescaped `"` ends it inside a string): `{ start, end, core, lower }`
 *  — `core`: without wrapping marks and trailing punctuation. */
function proxWordAt(s, p, le, quoted = false) {
  if (p >= le || proxBlank(s[p])) return null;
  let e = p;
  const limit = Math.min(le, p + MAX_KEYED_VALUE);            // a word past the scan bound ends there (read once)
  while (e < limit && !proxBlank(s[e]) && !(quoted && s[e] === '"' && s[e - 1] !== '\\') && !(s[e] === '\\' && /[nrt"]/.test(s[e + 1] ?? ''))) e++;
  if (e === p) return null;
  let a = p, b = e;
  while (a < b && '*_([{<"\'`'.includes(s[a])) a++;
  while (b > a && '*_)]}>"\'`.,;:!?'.includes(s[b - 1])) b--;
  const core = s.slice(a, b);
  return { start: p, end: e, a, b, core, lower: core.toLowerCase() };
}
/** Is the word `w` no password value: a stop word, a placeholder, code, a path, a name, an option? `sep`: a separator
 *  or joining word stood before it (else the prose words stop too). */
function proxNoValue(ctx, w, sep, quoted = false) {
  const { core, lower } = w;
  if (!core || !PROX_LD_ANY.test(core)) return true;                  // no letter or digit: a mark (`|`, a YAML block's `>-`)
  // The word as written, its closing punctuation off: a placeholder in brackets (`<db_password>`) is the one rule's.
  const written = ctx.s.slice(w.start, w.end).replace(/["'\x60,;.)\]}]+$/, '');
  if (written !== core && isKeyedPlaceholder(written)) return true;
  if (PROX_STOP.has(lower) || (!sep && PROX_PROSE.has(lower))) return true;
  if (core[0] === '$' || core.includes('\u2039') || PROX_PLACEHOLDER.test(core) || isKeyedPlaceholder(core)) return true;
  // Code — but in quotes (M33 R repair 9) brackets that do not pair up are a generated password's (`'q7T]zM(4kP;x9{Lw'`).
  if ((/[()[\]{}]/.test(core) && (!quoted || proxBalanced(core))) || /::|=>|->/.test(core)
    || /^[A-Za-z_][A-Za-z_]*(?:\.[A-Za-z_][A-Za-z_]*)+$/.test(core)) return true;   // code
  if (/^(?:\/|~\/|\.\.?\/|[A-Za-z]:\\)/.test(core)) return true;                                                     // a path
  if (!sep && core[0] === '-') return true;                                                                        // an option
  if (/^\d+(?:\.\d+)?%$|^v\d{1,3}(?:\.\d+)*$/.test(core)) return true;                                                  // `0.4%`, `v2`
  return proxNamed(ctx, w.a, w.b);
}
/** Do the brackets of `t` pair up, each kind as often opened as closed? */
function proxBalanced(t) {
  let a = 0, b = 0, c = 0;
  for (const ch of t) { if (ch === '(') a++; else if (ch === ')') a--; else if (ch === '[') b++; else if (ch === ']') b--; else if (ch === '{') c++; else if (ch === '}') c--; }
  return a === 0 && b === 0 && c === 0;
}
/** The region of a password's value `[from, to)` on line `i`: around the older layers' regions, blanks and trailing
 *  punctuation off. */
function proxValue(ctx, from, to) {
  const { s, blocked } = ctx;
  to = proxTrimEnd(s, from, to);
  while (to > from + 1 && '.,;:!?'.includes(s[to - 1])) to--;
  to = proxTrimEnd(s, from, to);
  for (let k = from; k < to;) {
    while (k < to && (blocked[k] || proxBlank(s[k]))) k++;
    let e = k;
    while (e < to && !blocked[e]) e++;
    let f = e;
    while (f > k && proxBlank(s[f - 1])) f--;
    if (f > k) ctx.out.push([k, f, ctx.current]);
    k = e;
  }
}
/** Where a query parameter's value that starts at `from` ends: at `&`, `#` or a blank. */
function proxQueryEnd(s, from, le) {
  let k = from;
  while (k < le && k - from < MAX_KEYED_VALUE && s[k] !== '&' && s[k] !== '#' && !proxBlank(s[k])) k++;
  return k;
}
/** Where `mark` next stands in `s` from `from`, read no further than `le` (the line's end, returned when it does not). */
function proxIndexOf(s, mark, from, le) {
  for (let k = from; k + mark.length <= le; k++) if (s.startsWith(mark, k)) return k;
  return le;
}
function proxTrimEnd(s, from, to) {
  while (to > from && proxBlank(s[to - 1])) to--;
  return to;
}
/** Where a password's value of words that starts at `p` ends on line `i`: the line's end; or a string's closing quote
 *  (the name stands inside one), `;` or a comment after a blank, a closing tag, the table cell. */
function proxClauseEnd(ctx, i, o, p) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  let end = le;
  // Inside a double-quoted string (an odd count of unescaped quotes before the name), or a single-quoted one (when the
  // line's single quotes pair up): the string's closing quote.
  const { dq, sq, singles } = proxQuotes(ctx, i, o.start);
  const table = /^[ \t]*\|/.test(s.slice(ls + ctx.strip, Math.min(le, ls + ctx.strip + 64)));
  for (let k = p; k < end; k++) {
    const c = s[k];
    if (c === '\\') { if (s[k + 1] === '"' && dq) { end = k; break; } k++; continue; }
    if ((c === '"' && dq) || (c === "'" && sq && singles % 2 === 0)) { end = k; break; }
    if (c === '|' && table) { end = k; break; }
    if (c === ';' && (k + 1 >= le || proxBlank(s[k + 1]))) { end = k; break; }
    if (c === '<' && s[k + 1] === '/') { end = k; break; }
    if (proxBlank(s[k - 1]) && (c === '#' || (c === '/' && s[k + 1] === '/')) && (k + 1 >= le || proxBlank(s[k + 1]) || s[k + 1] === '/')) { end = k; break; }
  }
  return end;
}

/** Rule 4, after the word: the value its separator, joining words, `for`-clause or qualifiers lead to. */
function proxPasswordAfter(ctx, i, o) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  if (o.identEnd !== o.end) return;                                    // the name goes on (`passwordHash`, `--password-stdin`)
  // A flag (`--password`, `-p…`): its value is the key-name rule's (shape F). A `-` that opens a line is a diff's marker.
  const flag = s[o.identStart] === '-' && (o.identStart !== ls || s[o.identStart + 1] === '-');
  if (flag) return;
  if (s[o.identStart - 1] === '/' || s[o.identEnd] === '/') return;     // a path's segment (`/etc/passwd`)
  if (ctx.reach > o.start) return;                                     // inside a value already read to its clause's end
  let p = o.end;
  while (p < le && '"\'`*_~'.includes(s[p])) p++;
  let q = proxSkipBlanks(s, p, le);
  let sep = false;
  const r = proxSeparator(s, q, le);
  if (r >= 0) {
    // `NAME= cmd`: in a command, `=` glued to the name and a blank after it is the shell's empty assignment.
    if (s[q] === '=' && q === o.end && ctx.mode === 'shell' && proxBlank(s[q + 1]) && !(ctx.heredoc >= 0 && ctx.heredoc < o.start)) return;
    sep = true;
    q = r;
  } else {
    // What it is for, a parenthetical, a qualifier: read on to a separator or a joining verb (`the password for
    // admin@example.com is …`, `Password (prod): …`, `admin password value: …`); with none, it is prose.
    PROX_LOOKAHEAD.lastIndex = q;
    if (PROX_LOOKAHEAD.test(s)) {
      let k = q, found = -1;
      for (let n = 0; n < 10 && k < le && k - q < 400; n++) {
        k = proxSkipBlanks(s, k, le);
        const r2 = proxSeparator(s, k, le);
        if (r2 >= 0) { found = r2; break; }
        const w = proxWordAt(s, k, le);
        if (!w) break;
        if (n > 0 && (w.lower === 'is' || w.lower === 'was' || w.lower === 'are')) { found = w.end; break; }
        const glued = proxSeparator(s, w.end - 1, le);                       // `for bot@example.com: <v>`
        if (glued === w.end && (s[w.end - 1] === ':' || s[w.end - 1] === '=')) { found = glued; break; }
        k = w.end;
      }
      if (found < 0) return;
      sep = true;
      q = found;
    }
  }
  // The joining words (`is`, `was`, `to` after a verb that sets one, `should be`, `is now`, `is still`, `it's` …).
  let setting = null;                                                  // read only where a `to` stands
  for (let n = 0; n < 4; n++) {
    q = proxSkipBlanks(s, q, le);
    PROX_JOINER_AT.lastIndex = q;
    const j = PROX_JOINER_AT.exec(s);
    if (!j) break;
    const w = { start: q, end: q + j[0].length };
    const lw = j[0].toLowerCase().replace(/:$/, '');
    if (lw === 'to' && setting === null) setting = PROX_SETTING_VERB.test(s.slice(Math.max(ls, o.identStart - 48), o.identStart));
    if (!PROX_JOINERS.has(lw) || (lw === 'to' && !setting && !sep) || (lw === 'set' && !/^set[ \t]+to\b/i.test(s.slice(w.start, w.start + 8)))) break;
    if (lw === 'as') break;
    sep = true;
    q = w.end;
  }
  q = proxValueStart(s, q, le);
  if (q >= le) return;
  // In a command an assignment's value (`PASSWORD=<v> ./run.sh`) is one shell word: an older layer that masked it decided
  // it, and what follows is the command's.
  // M33 R repair 9: not inside a quoted string (`echo "DB_PASSWORD=velvet orchid" >> .env`: the string is the word), nor
  // for a wallet's words (a mnemonic is never one word).
  const oneWord = ctx.mode === 'shell' && s[o.end] === '=' && !(ctx.heredoc >= 0 && ctx.heredoc < o.start)
    && !PROX_PHRASE_KEYS.has(o.key) && !proxQuoted(ctx, i, o);
  if (oneWord && (ctx.blocked[q] || ctx.blocked[q + 1])) return;
  const opened = proxQuoted(ctx, i, o);
  const c = s[q];
  if (c === '"' || c === "'" || c === '`' || (c === '\\' && (s[q + 1] === '"' || s[q + 1] === "'"))) {
    const open = c === '\\' ? 2 : c === '`' && s.startsWith('```', q) ? 3 : 1;
    const mark = open === 2 ? `\\${s[q + 1]}` : s.slice(q, q + open);
    const e = proxIndexOf(s, mark, q + open, le);
    const inner = proxWordAt(s, proxSkipBlanks(s, q + open, e), e);
    if (!inner || proxNoValue(ctx, inner, true, true)) return;
    proxValue(ctx, q + open, e);
    return;
  }
  // In a URL's query (`?db_pwd=<v>&x=1`) the value ends at the next parameter.
  const query = s[o.identStart - 1] === '?' || s[o.identStart - 1] === '&';
  const w = proxWordAt(s, q, query ? Math.min(le, proxQueryEnd(s, q, le)) : le, opened);
  if (!w || proxNoValue(ctx, w, sep) || (!sep && o.plural)) return;
  if (query) { proxValue(ctx, w.a, w.b); return; }
  if (!sep) {
    // With no separator, a word is a value only where its clause ends with it (`login with password <v>`, `admin pass
    // <v> and then …`); a word the sentence goes on from is prose (`the password tests take 180 ms`).
    const after = proxSkipBlanks(s, w.end, le);
    const next = proxWordAt(s, after, le);
    if (!(after >= le || w.b < w.end || /^[,;.!?)\]}"'\x60|]/.test(s[after]) || (next && PROX_CLAUSE_WORDS.has(next.lower)))) return;
    proxValue(ctx, w.a, w.b);
    return;
  }
  const end = oneWord ? w.b : proxClauseEnd(ctx, i, o, q);
  proxValue(ctx, w.a, end);
  ctx.reach = end;
}
/** Does the name stand inside a double-quoted string (an escaped line break's line, or an odd count of quotes before)? */
function proxQuoted(ctx, i, o) {
  return proxQuotes(ctx, i, o.start).dq;
}
/** The quotes open at `to` on line `i`: `{ dq, sq, singles }` — inside a double-quoted string, a single-quoted one, and
 *  how many single quotes the line holds. Read on from where the last call on the line stopped: a line is read once,
 *  however many names it holds. */
function proxQuotes(ctx, i, to) {
  const { s } = ctx;
  const [ls, le, opened] = ctx.lines[i];
  let q = ctx.quotes;
  if (!q || q.line !== i || q.at > to) {
    let singles = 0;
    for (let k = ls; k < le; k++) if (s[k] === "'" && s[k - 1] !== '\\') singles++;
    q = ctx.quotes = { line: i, at: ls, dq: opened, sq: false, singles };
  }
  for (let k = q.at; k < to; k++) {
    if (s[k] === '\\') { k++; continue; }
    if (s[k] === '"') q.dq = !q.dq;
    else if (s[k] === "'") q.sq = !q.sq;
  }
  q.at = Math.max(q.at, to);
  return q;
}

// Rule 4, before the word: `<v> is my wifi password`, `<v> was the old password`, `use <v> as the admin password`, `<v>
// (db password)`, `<v> <- password`.
const PROX_QUALIFIERS = String.raw`(?:[ \t]+[\p{L}\p{N}][\p{L}\p{N}_.-]{0,31}){0,2}`;
const PROX_VALUE_WORD = String.raw`([^\s"'\x60()[\]{}<>,;|]{1,256})["'\x60]?`;
const PROX_BEFORE = [
  new RegExp(String.raw`(?:^|[\s"'\x60(\[{<>,;:=|])${PROX_VALUE_WORD}[ \t]+(?:is|was)[ \t]+(?:my|the|our|your|their|his|her)${PROX_QUALIFIERS}[ \t]+$`, 'diu'),
  new RegExp(String.raw`(?:^[+-]?|\s)use[ \t]+["'\x60]?${PROX_VALUE_WORD}[ \t]+as[ \t]+(?:the|my|our|your|their|a|an)${PROX_QUALIFIERS}[ \t]+$`, 'diu'),
  new RegExp(String.raw`(?:^|[\s"'\x60\[{<>,;:=|])${PROX_VALUE_WORD}[ \t]*\((?:[ \t]*[\p{L}\p{N}][\p{L}\p{N}_.-]{0,31}){0,2}[ \t]*$`, 'diu'),
  new RegExp(String.raw`(?:^|[\s"'\x60(\[{<>,;:=|])${PROX_VALUE_WORD}[ \t]*(?:<-|\u2190)${PROX_QUALIFIERS}[ \t]+$`, 'diu'),
];
function proxPasswordBefore(ctx, i, o) {
  const { s } = ctx;
  const [ls] = ctx.lines[i];
  const c = s[o.identStart - 1];
  if (!(c === ' ' || c === '\t' || c === '(')) return;
  const from = Math.max(ls, o.identStart - 200);
  const near = s.slice(Math.max(from, o.identStart - 96), o.identStart);
  if (!/[ \t(]$/.test(near) || !/(?:^|[ \t])(?:is|was|as)[ \t]|\(|<-|\u2190/i.test(near)) return;
  const prefix = s.slice(from, o.identStart);
  for (const [n, re] of PROX_BEFORE.entries()) {
    const m = re.exec(prefix);
    if (!m) continue;
    if (n === 2 && s[proxSkipBlanks(s, o.identEnd, ctx.lines[i][1])] !== ')') continue;
    const [a] = m.indices[1];
    const w = proxWordAt(s, from + a, o.identStart);
    if (w && !proxNoValue(ctx, w, true)) proxValue(ctx, w.a, w.b);
    return;
  }
}

/** Rule 4, below a label line of the family: the first non-blank line — the whole line after a separator (`Password:`),
 *  else (`## Password`, `**Password**`) when it is a value of at most six words. */
function proxPasswordBelow(ctx, i, tail) {
  const { s } = ctx;
  const [ls, le, opened] = ctx.lines[i];
  let p = proxDecorationEnd(s, Math.min(le, ls + ctx.strip), le);
  if (p >= le || /^\[\u2026 .* \u2026\]$/.test(s.slice(p, le).trimEnd())) return;      // this stage's own note: no value
  // M33 R repair 9: a key/value line (name/value data under a name naming a password): a value key's value is the value
  // (`value: <v>`, `"Value": "<v>"`); a sibling key's line is read past ('next': `"Type": "SecureString",`).
  const kv = /^(?:"([^"\n]{1,64})"|'([^'\n]{1,64})'|([A-Za-z_][\w.-]{0,63}))[ \t]*(?::(?![:/])|=(?!=))[ \t]*/.exec(s.slice(p, Math.min(le, p + 140)));
  if (kv) {
    if (!PROX_VALUE_KEYS.has((kv[1] ?? kv[2] ?? kv[3]).toLowerCase())) return 'next';
    tail = 'separator';
    p += kv[0].length;
    if (p >= le) return;
  }
  let words = 0;
  for (let k = p; k < le && words <= 6;) {
    k = proxSkipBlanks(s, k, le);
    if (k >= le) break;
    words++;
    while (k < le && !proxBlank(s[k])) k++;
  }
  if (words > 6 && tail !== 'separator') return;
  const c = s[p];
  if (c === '"' || c === "'" || c === '`') {
    const open = s.startsWith('```', p) ? 3 : 1;
    const e = proxIndexOf(s, s.slice(p, p + open), p + open, le);
    const inner = proxWordAt(s, proxSkipBlanks(s, p + open, e), e);
    if (inner && !proxNoValue(ctx, inner, true)) proxValue(ctx, p + open, e);
    return;
  }
  const w = proxWordAt(s, p, le, opened);
  if (!w || /[:=]$/.test(s.slice(w.start, w.end)) || s.slice(w.start, w.end).includes('=') || proxNoValue(ctx, w, true)) return;
  let end = le;
  if (opened) for (let k = p; k < le; k++) { if (s[k] === '\\') { k++; continue; } if (s[k] === '"') { end = k; break; } }
  proxValue(ctx, w.a, end);
}

// ---- rule 5 ---------------------------------------------------------------------------------------------------------

const PROX_STDIN_FLAG = /^--(?:password|token|secret)-stdin$|^--with-token$/;
const PROX_REGISTRY_CLIS = new Set(['docker', 'podman', 'nerdctl', 'buildah', 'helm', 'oras', 'skopeo', 'crane', 'regctl', 'finch']);
const PROX_PREFIX_WORDS = new Set(['sudo', 'env', 'command', 'exec', 'time', 'nohup', 'npx', 'bunx']);
/** Rule 5 over line `i`: the simple commands on it, and the values those that set a secret take. Read twice when the line
 *  holds a quote: as the shell reads it, and with every quote a break (a command inside a JSON string or prose, where
 *  the shell's reading runs the whole JSON together). What either reading takes is masked. */
function proxCommands(ctx, i) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  proxStdinSecrets(ctx, i);
  const head = le - ls > 4096 ? s.slice(ls, ls + 4096) : s.slice(ls, le);
  if (!PROX_COMMAND_HINT.test(head)) return;
  if (/identified/i.test(head)) proxIdentifiedBy(ctx, ls, le);
  proxCommandWords(ctx, i, false);
  if (/["'`]/.test(head)) proxCommandWords(ctx, i, true);
}
const PROX_KNOWN_COMMANDS = new Set(['redis-cli', 'htpasswd', 'security', 'gh', 'npm', 'yarn', 'pnpm', 'bun', 'git', 'doppler',
  ...PROX_REGISTRY_CLIS]);
const PROX_LOOSE_BREAK = /["'`{}[\],]/;
function proxCommandWords(ctx, i, loose) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[i];
  const commands = [[]];
  const ops = [];
  let redirect = false;
  for (let k = ls, n = 0; k < le && n < 65536; n++) {
    k = proxSkipBlanks(s, k, le);
    if (k >= le) break;
    const c = s[k];
    if (c === '|' || c === ';' || c === '&') {
      const op = s[k + 1] === c ? c + c : c;
      ops.push(op);
      commands.push([]);
      k += op.length;
      continue;
    }
    if (s.startsWith('<<<', k)) { commands[commands.length - 1].push({ here: true, start: k, end: k + 3 }); k += 3; continue; }
    if (c === '<' || c === '>') { redirect = true; k += s[k + 1] === '>' ? 2 : 1; continue; }
    if (c === '(' || c === ')' || (loose && PROX_LOOSE_BREAK.test(c))) { k++; continue; }
    let we;
    if (loose) {
      we = k;
      while (we < le && we - k < MAX_KEYED_VALUE && !proxBlank(s[we]) && !PROX_LOOSE_BREAK.test(s[we]) && !'|;&<>()'.includes(s[we])
        && !(s[we] === '\\' && /[nrt"']/.test(s[we + 1] ?? ''))) we++;
    } else we = shellWordEnd(s, k, le);
    if (we <= k) { k++; continue; }
    commands[commands.length - 1].push({ start: k, end: we, redirect });
    redirect = false;
    k = we;
  }
  const text = (w) => s.slice(w.start, w.end);
  const plainOf = (words) => words.filter((w) => !w.here && !w.redirect);
  /** The command a segment runs: its first known command word, wherever it stands (after an assignment, `sudo`, a diff
   *  marker, an output line's number, or prose: `Error: rejected redis-cli -a …`), else its first word. */
  const nameOf = (plain) => {
    const bare = (w) => text(w).replace(/^[+-]/, '').replace(/^.*\//, '');
    const at = plain.findIndex((w) => PROX_KNOWN_COMMANDS.has(bare(w)));
    return at >= 0 ? { at, name: bare(plain[at]) } : { at: 0, name: plain.length ? bare(plain[0]) : '' };
  };
  /** A word set as a secret's value: inside its quotes; not an option, a reference, a substitution or a placeholder. */
  const take = (w, from, mark = '') => {
    if (!w || w.here) return;
    let a = w.start, b = w.end;
    if (b - a >= 2 && (s[a] === '"' || s[a] === "'") && s[b - 1] === s[a]) { a++; b--; }    // the word quoted whole
    const option = from === undefined;
    if (from !== undefined) {
      a = Math.max(a, from);
      if (b - a >= 2 && (s[a] === '"' || s[a] === "'") && s[b - 1] === s[a]) { a++; b--; }  // `--value='<v>'`
    }
    if (mark) {                                                        // only what follows the mark (`user,<v>`, `pass:<v>`)
      const at = s.slice(a, b).indexOf(mark);
      if (at < 0) return;
      a += at + mark.length;
    }
    const v = s.slice(a, b);
    if (!v || (option && !mark && v[0] === '-') || v[0] === '$' || v === '*' || isSubstitution(s, a, b) || isKeyedPlaceholder(v)) return;
    proxValueExact(ctx, a, b);
  };
  /** Does word `w` hold a strong word of the vocabulary (`--name /recall/api-key`, `RECALL_API_KEY`)? */
  const names = (w) => {
    const { occs } = ctx;
    let lo = 0, hi = occs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (occs[mid].start < w.start) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < occs.length && occs[k].start < w.end; k++) if (!occs[k].skip && occs[k].strong && occs[k].end <= w.end) return true;
    return false;
  };
  commands.forEach((words, ci) => {
    const plain = plainOf(words);
    const { at, name } = nameOf(plain);
    const args = plain.slice(at + 1);
    const argText = args.map(text);
    const hereWord = () => { const h = words.findIndex((w) => w.here); return h >= 0 ? words[h + 1] : null; };
    const namesSecret = words.some((w) => !w.here && names(w));
    // The input of a flag that reads the secret from stdin: what `echo` / `printf` pipe in (the words after the last of
    // them before the pipe), a here-string.
    if (argText.some((t) => PROX_STDIN_FLAG.test(t))) {
      if (ci > 0 && ops[ci - 1] === '|') {
        const prev = plainOf(commands[ci - 1]);
        let pa = -1;
        const bare = (w) => text(w).replace(/^[+-]/, '').replace(/^.*\//, '');
        for (let k = prev.length - 1; k >= 0; k--) if (/^(?:echo|printf)$/.test(bare(prev[k]))) { pa = k; break; }
        if (pa >= 0) {
          const pn = bare(prev[pa]);
          let format = pn === 'printf';
          for (const w of prev.slice(pa + 1)) {
            const t = text(w);
            if (pn === 'echo' && /^-[neE]+$/.test(t)) continue;
            if (format && t.includes('%')) { format = false; continue; }
            format = false;
            take(w);
          }
        }
      }
      take(hereWord());
    } else if (namesSecret) take(hereWord());
    const nextOf = (k) => (args[k + 1] && !args[k + 1].here ? args[k + 1] : null);
    for (let k = 0; k < args.length; k++) {
      const t = argText[k];
      if (t === '--value' && namesSecret) take(nextOf(k));
      else if (t.startsWith('--value=') && namesSecret) take(args[k], args[k].start + 8);
    }
    if (name === 'redis-cli') argText.forEach((t, k) => { if (t === '-a') take(nextOf(k)); });
    else if (name === 'htpasswd' && argText.some((t) => /^-[A-Za-z]*b[A-Za-z]*$/.test(t))) {
      // `htpasswd -b FILE USER PASSWORD`, `htpasswd -nb USER PASSWORD`.
      const positional = args.filter((w) => text(w)[0] !== '-');
      take(positional[argText.some((t) => /^-[A-Za-z]*n[A-Za-z]*$/.test(t)) ? 1 : 2]);
    } else if (PROX_REGISTRY_CLIS.has(name) && argText.includes('login')) argText.forEach((t, k) => { if (t === '-p') take(nextOf(k)); });
    else if (name === 'security' && /^add-(?:generic|internet)-password$/.test(argText[0] ?? '')) {
      argText.forEach((t, k) => { if (t === '-w') take(nextOf(k)); else if (/^-w[^-]/.test(t)) take(args[k], args[k].start + 2); });
    } else if (name === 'gh' && argText[0] === 'secret' && argText[1] === 'set') {
      argText.forEach((t, k) => {
        if (t === '--body' || t === '-b') take(nextOf(k));
        else if (t.startsWith('--body=')) take(args[k], args[k].start + 7);
        else if (/^-b[^-]/.test(t)) take(args[k], args[k].start + 2);
      });
    } else if (['npm', 'yarn', 'pnpm', 'bun'].includes(name) && argText[0] === 'config' && argText[1] === 'set' && args[2]) {
      const eq = argText[2].indexOf('=');
      if (eq > 0 ? names({ start: args[2].start, end: args[2].start + eq }) : names(args[2])) take(eq > 0 ? args[2] : nextOf(2), eq > 0 ? args[2].start + eq + 1 : undefined);
    } else if (name === 'git' && argText[0] === 'config') {
      const positional = [];
      for (let k = 1; k < args.length; k++) {
        if (argText[k][0] !== '-') { positional.push(args[k]); continue; }
        if (/^-(?:f|-file|-blob)$/.test(argText[k])) k++;                 // an option that takes the next word
      }
      if (positional.length >= 2 && names(positional[0])) take(positional[1]);
    } else if (name === 'doppler' && argText[0] === 'secrets' && argText[1] === 'set') {
      for (let k = 2; k < args.length; k++) {
        const t = argText[k];
        if (t[0] === '-') continue;
        const eq = t.indexOf('=');
        if (eq > 0) { if (names({ start: args[k].start, end: args[k].start + eq })) take(args[k], args[k].start + eq + 1); }
        else if (names(args[k])) { take(nextOf(k)); k++; }
      }
    }
    // M33 R repair 9: the closed lists of commands that take a password with no vocabulary word on their line, at every
    // command of the segment (`docker exec … sqlcmd -P <v>`).
    const unquoted = (w) => { const t = text(w); return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t; };
    // Each such command reads the words up to the next one: every word is read once (a megabyte of `sqlcmd -P a`).
    const ats = [];
    plain.forEach((w, k) => { if (PROX_SECRET_COMMANDS.has(text(w).replace(/^[+-]/, '').replace(/^.*\//, ''))) ats.push(k); });
    ats.forEach((at2, n) => {
      const nm = text(plain[at2]).replace(/^[+-]/, '').replace(/^.*\//, '');
      const rest = plain.slice(at2 + 1, ats[n + 1] ?? plain.length);
      const words = rest.map(unquoted);
      for (const { sub, flag, mark, glued } of PROX_SECRET_OPTION_RULES.get(nm) ?? []) {
        if (sub.some((x, k) => words[k] !== x)) continue;
        words.forEach((t, k) => {
          if (k < sub.length) return;
          if (t === flag && !glued) take(rest[k + 1]?.here ? null : rest[k + 1], undefined, mark);
          else if (flag.startsWith('--') && t.startsWith(`${flag}=`)) take(rest[k], rest[k].start + (text(rest[k]).indexOf('=') + 1), mark);
          else if (!flag.startsWith('--') && flag.length === 2 && t.length > 2 && t.startsWith(flag)) take(rest[k], rest[k].start + text(rest[k]).indexOf(flag) + 2, mark);
        });
      }
      for (const { sub, position } of PROX_SECRET_POSITION_RULES.get(nm) ?? []) {
        const at = nm === 'redis-cli' ? words.findIndex((t) => t.toLowerCase() === sub) : words[0] === sub ? 0 : -1;
        if (at < 0) continue;
        const positional = rest.slice(at + 1).filter((x, k) => { const t = words[at + 1 + k]; return t && !/^[-/]/.test(t) && !t.includes('='); });
        take(position === 'last' ? positional.at(-1) : positional[position - 1]);
      }
      const inputMark = PROX_SECRET_INPUT_MARKS.get(nm);
      if (inputMark !== undefined) {
        // What is piped in: every word of the segment before the pipe that holds the mark (`echo bot:<v>`, `printf '%s\n'
        // bot:<v>`), and a here-string.
        if (ci > 0 && ops[ci - 1] === '|') for (const x of plainOf(commands[ci - 1])) take(x, undefined, inputMark);
        take(hereWord(), undefined, inputMark);
      }
    });
  });
}

// Rule 5's closed lists (PROXIMITY_SECRET_OPTIONS, _POSITIONS, _INPUTS), read once.
const PROX_SECRET_OPTION_RULES = new Map();
for (const entry of PROXIMITY_SECRET_OPTIONS) {
  const parts = entry.split(' ');
  const flagAt = parts.findIndex((p, k) => k > 0 && p[0] === '-');
  const [name, ...sub] = parts.slice(0, flagAt);
  const rule = { sub, flag: parts[flagAt], mark: parts[flagAt + 1] ?? '', glued: /^7z/.test(name) };
  PROX_SECRET_OPTION_RULES.set(name, [...(PROX_SECRET_OPTION_RULES.get(name) ?? []), rule]);
}
const PROX_SECRET_POSITION_RULES = new Map();
for (const entry of PROXIMITY_SECRET_POSITIONS) {
  const [name, sub, position] = entry.split(' ');
  PROX_SECRET_POSITION_RULES.set(name, [...(PROX_SECRET_POSITION_RULES.get(name) ?? []), { sub, position: position === 'last' ? 'last' : Number(position) }]);
}
const PROX_SECRET_INPUT_MARKS = new Map(PROXIMITY_SECRET_INPUTS.map((entry) => entry.split(' ')));
const PROX_SECRET_COMMANDS = new Set([...PROX_SECRET_OPTION_RULES.keys(), ...PROX_SECRET_POSITION_RULES.keys(), ...PROX_SECRET_INPUT_MARKS.keys()]);

// ---- rule 5, stdin ----------------------------------------------------------------------------------------------------
//
// M33 brittleness M7: a literal written to the stdin of a command that reads a secret there is masked, decided from the
// parsed pipeline and its redirections, never from a list of programs. A command reads a secret from stdin when one of
// its words is a stdin-secret flag (`--password-stdin`, `--passwd-stdin`, `--token-stdin`, `--secret-stdin`,
// `--with-token`, `--stdin`, `-S`, `-s`: which program takes `-s` or `-S` as that flag is not knowable here, so every one
// does) or a name that holds a password-family word of the vocabulary (`passwd`, `chpasswd`, `smbpasswd`, `htpasswd`).
// The literals written to its stdin: its own here-string and here-document lines, and, upstream of it in its pipeline,
// what `echo` / `printf` print and every here-string and here-document. Where the structure is not certain the literal
// is masked anyway (fail closed): a group or subshell upstream (or around the command) counts whole, a here-document with
// no closing line runs to the text's end, a printf format that holds literal text is masked with its arguments. A
// program's own arguments are not its output and stay (`aws ecr get-login-password | docker login --password-stdin`).

const PROX_STDIN_SECRET_FLAG = /^--(?:password|passwd|token|secret)-stdin$|^--with-token$|^--stdin$|^-[sS]$/;
/** A password-family word of the vocabulary that can name a command: one ASCII word of 6 letters or more. */
const PROX_STDIN_FAMILY = new RegExp(PROXIMITY_PASSWORD.map((w) => w.replace('(s)', 's?'))
  .filter((w) => /^[a-z]+(?:s\?)?$/.test(w) && w.replace('s?', '').length >= 6).join('|'), 'i');
const PROX_STDIN_HINT = new RegExp(String.raw`(?:^|[^\w-])(?:-[sS]|--(?:password-|passwd-|token-|secret-)?stdin|--with-token)(?![\w-])|`
  + PROX_STDIN_FAMILY.source, 'i');
/** Does `s` hold a stdin-secret signal and a way to write to stdin (a pipe, a here-string, a here-document)? */
const proxStdinHint = (s) => (s.includes('|') || s.includes('<<')) && PROX_STDIN_HINT.test(s);
/** A printf format that writes no literal text: only conversions, escapes and blanks. */
const PROX_PRINTF_DIRECTIVES = /^(?:%[-+ #0']*(?:\d+|\*)?(?:\.(?:\d+|\*)?)?[hlLqjzt]{0,2}[a-zA-Z%]|\\.|\s)*$/;

/** Does line `j` end in a line continuation (`\`) or an operator that carries the command onto the next line? */
function proxContinues(s, line) {
  const [ls, le] = line;
  let e = le;
  while (e > ls && (s[e - 1] === ' ' || s[e - 1] === '\t' || s[e - 1] === '\r')) e--;
  if (e <= ls) return false;
  const c = s[e - 1];
  return c === '\\' || c === '|' || (c === '&' && s[e - 2] === '&');
}

/** The pipeline structure of `spans` (one logical command line, `[start, end]` each): its simple commands (`{ words,
 *  heres, pipeFrom, groupFrom, inGroup }`) and its here-document operators in order (`{ seg, delim, strip }`). `loose`:
 *  every quote a break, as `proxCommandWords` reads a command inside JSON or prose; a `$(` there opens a substitution. */
function proxStdinParse(ctx, spans, loose) {
  const { s } = ctx;
  const segs = [];
  const groups = [];
  const open = () => { const g = { at: segs.length, words: [], heres: [], pipeFrom: null, groupFrom: -1, inGroup: groups.at(-1) ?? -1 }; segs.push(g); return g; };
  const empty = (g) => !g.words.length && !g.heres.length && !g.doc;
  const docs = [];
  const frames = [];
  let cur = open();
  let redirect = false, here = false;
  const openGroup = () => {
    if (empty(cur)) { groups.push(cur.at); cur.inGroup = cur.at; } else { groups.push(segs.length); cur = open(); }
  };
  // A group closed with none open (`+{ … } |` behind a diff marker): everything before it counts (fail closed).
  const closeGroup = () => { cur.groupFrom = groups.length ? groups.pop() : 0; };
  for (const [ls, le] of spans) {
    for (let k = ls, n = 0; k < le && n < 65536; n++) {
      k = proxSkipBlanks(s, k, le);
      if (k >= le) break;
      const c = s[k];
      if (c === '\\' && (k + 1 >= le || (loose && /[nrt]/.test(s[k + 1])))) { k += 2; continue; }   // a continuation, `\n` in JSON
      if (c === '|') {
        if (s[k + 1] === '|') { cur = open(); k += 2; continue; }
        const next = open();
        next.pipeFrom = cur;
        cur = next;
        k += s[k + 1] === '&' ? 2 : 1;
        continue;
      }
      if (c === '&' && s[k + 1] === '>') { redirect = true; k += s[k + 2] === '>' ? 3 : 2; continue; }
      if (c === ';' || c === '&') { cur = open(); k += s[k + 1] === c ? 2 : 1; continue; }
      if (s.startsWith('<<<', k)) { here = true; k += 3; continue; }
      if (s.startsWith('<<', k)) {
        k += 2;
        const strip = s[k] === '-';
        if (strip) k++;
        k = proxSkipBlanks(s, k, le);
        const we = k < le ? shellWordEnd(s, k, le) : k;
        docs.push({ seg: cur, delim: s.slice(k, we).replace(/\\(?=["'])|["'`\\]/g, ''), strip });
        cur.doc = true;
        k = Math.max(we, k + 1);
        continue;
      }
      if (c === '<' || c === '>') {
        k++;
        if (s[k] === '(') { frames.push({ seg: cur, groups: groups.length }); cur = open(); k++; continue; }   // `<(…)`
        if (s[k] === '>' || s[k] === '|') k++;
        if (s[k] === '&') { k++; while (k < le && /[\d-]/.test(s[k])) k++; continue; }                   // `2>&1`: no word
        redirect = true;
        continue;
      }
      if (c === '$' && s[k + 1] === '(' && s[k + 2] !== '(') { frames.push({ seg: cur, groups: groups.length }); cur = open(); k += 2; continue; }
      if (c === '(') { openGroup(); k++; continue; }
      if (c === ')') {
        if (frames.length && frames.at(-1).groups === groups.length) cur = frames.pop().seg;
        else closeGroup();
        k++;
        continue;
      }
      let we;
      if (loose && c === '$' && s[k + 1] === '{') {                          // `${NAME}`: one reference, never split
        we = k + 2;
        while (we < le && we - k < MAX_KEYED_VALUE && s[we] !== '}' && !proxBlank(s[we])) we++;
        if (s[we] === '}') we++;
      } else if (loose && PROX_LOOSE_BREAK.test(c)) { k++; continue; }
      else if (loose) {
        we = k;
        while (we < le && we - k < MAX_KEYED_VALUE && !proxBlank(s[we]) && !PROX_LOOSE_BREAK.test(s[we]) && !'|;&<>()'.includes(s[we])
          && !(s[we] === '\\' && /[nrt"']/.test(s[we + 1] ?? ''))) we++;
      } else we = shellWordEnd(s, k, le);
      if (we <= k) { k++; continue; }
      const w = { start: k, end: we };
      const t = s.slice(k, we);
      if (here) { here = false; cur.heres.push(w); }
      else if (redirect) redirect = false;                                       // a redirection's file
      else if (/^\d+$/.test(t) && (s[we] === '<' || s[we] === '>')) { /* a file descriptor */ }
      else if (!loose && t === '{') openGroup();
      else if (!loose && t === '}') closeGroup();
      else cur.words.push(w);
      k = we;
    }
  }
  return { segs, docs };
}

/** Rule 5, stdin, over the logical command line that starts at line `i`. Read twice when a line of it ends at a `\n`
 *  written as two characters (`proxLines` splits there for JSON text): with that a line break, and as the shell reads
 *  it, a character of the line (`printf "<v>\n" | smbpasswd -s`). What either reading takes is masked. */
function proxStdinSecrets(ctx, i) {
  const { s, lines } = ctx;
  if (!ctx.stdin) return;                                                // no signal and no stdin in the whole text
  if (ctx.stdinState?.used(i)) return;                                   // a here-document's line, masked whole
  const escapedEnd = (j) => s[lines[j][1]] === '\\';
  if (!(i > 0 && proxContinues(s, lines[i - 1]))) {                     // else read with the line it continues
    let to = i;
    while (to + 1 < lines.length && proxContinues(s, lines[to])) to++;
    proxStdinLine(ctx, lines.slice(i, to + 1).map(([a, b]) => [a, b]), to);
  }
  if ((i === 0 || !escapedEnd(i - 1)) && escapedEnd(i)) {               // the shell's line, its escaped breaks inside it
    const spans = [[lines[i][0], lines[i][1]]];
    let to = i;
    while (to + 1 < lines.length && (escapedEnd(to) || proxContinues(s, lines[to]))) {
      to++;
      if (escapedEnd(to - 1)) spans.at(-1)[1] = lines[to][1]; else spans.push([lines[to][0], lines[to][1]]);
    }
    proxStdinLine(ctx, spans, to);
  }
}

function proxStdinLine(ctx, spans, to) {
  const text = ctx.s.slice(spans[0][0], spans.at(-1)[1]);
  if (!proxStdinHint(text)) return;
  proxStdinReading(ctx, spans, to, false);
  if (/["'`]/.test(text)) proxStdinReading(ctx, spans, to, true);
}

function proxStdinReading(ctx, spans, to, loose) {
  const { s, lines } = ctx;
  const { segs, docs } = proxStdinParse(ctx, spans, loose);
  const text = (w) => s.slice(w.start, w.end);
  const unquoted = (t) => (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t);
  const bare = (t) => t.replace(/^[+-]/, '').replace(/^.*\//, '');
  const reads = (g) => g.words.some((w) => {
    const t = text(w);
    return PROX_STDIN_SECRET_FLAG.test(unquoted(t)) || (t[0] !== '-' && /^[\w.+-]+$/.test(bare(t)) && PROX_STDIN_FAMILY.test(bare(t)));
  });
  const consumers = segs.filter(reads);
  if (!consumers.length) return;
  // Each consumer and every command upstream of it: its pipe, the group or subshell around it, a group upstream whole.
  const feeding = new Set();
  const walk = (g) => {
    if (!g || feeding.has(g)) return;
    feeding.add(g);
    if (g.groupFrom >= 0) for (let k = g.groupFrom; k < g.at; k++) walk(segs[k]);
    if (g.inGroup >= 0 && g.inGroup !== g.at) walk(segs[g.inGroup]);
    walk(g.pipeFrom);
  };
  for (const g of consumers) walk(g);
  const take = (a, b) => {
    if (b - a >= 2 && (s[a] === '"' || s[a] === "'") && s[b - 1] === s[a]) { a++; b--; }
    const v = s.slice(a, b);
    if (!v || v[0] === '$' || isSubstitution(s, a, b) || isKeyedPlaceholder(v)) return;
    if (ctx.across) {                                    // a field read a line at a time: only what a line below holds
      const line = proxLineIndex(ctx, a);
      const key = proxLineIndex(ctx, spans[0][0]);
      if (line === key && to === key) return;              // the command line on its own: `scrub`'s
      ctx.prepare(line);
      ctx.current = [line, key];
    }
    proxValueExact(ctx, a, b);
  };
  for (const g of feeding) {
    for (const w of g.heres) take(w.start, w.end);
    const at = g.words.findIndex((w) => /^(?:echo|printf)$/.test(bare(text(w))));
    if (at < 0) continue;
    const args = g.words.slice(at + 1);
    if (bare(text(g.words[at])) === 'echo') {
      let k = 0;
      while (k < args.length && /^-[neE]+$/.test(text(args[k]))) k++;
      for (; k < args.length; k++) take(args[k].start, args[k].end);
    } else {
      let k = 0;
      while (k < args.length && /^-/.test(text(args[k]))) k += text(args[k]) === '-v' ? 2 : 1;   // `-v var`, `--`
      if (k < args.length && PROX_PRINTF_DIRECTIVES.test(unquoted(text(args[k])))) k++;    // a format of directives only
      for (; k < args.length; k++) take(args[k].start, args[k].end);
    }
  }
  // The here-documents' lines, in order after the command line; one with no closing line runs to the text's end. Each
  // line is masked once (`ctx.stdinState`): the reading stays linear however many operators share the lines below them.
  if (!docs.length) return;
  const st = (ctx.stdinState ??= proxStdinState(ctx));
  let next = to + 1;
  for (const d of docs) {
    if (next >= lines.length) break;
    const end = proxStdinClose(ctx, st, d, next, loose);
    if (feeding.has(d.seg)) {
      for (let j = st.free(next); j < end; j = st.free(j + 1)) {
        st.use(j);
        const [ls, le] = lines[j];
        const a = proxSkipBlanks(s, ls, le);
        let b = le;
        while (b > a && proxBlank(s[b - 1])) b--;
        if (b > a) take(a, b);
      }
    }
    next = end + 1;
  }
}

/** The index of the line that starts at `start`. */
function proxLineIndex(ctx, start) {
  const { lines } = ctx;
  let lo = 0, hi = lines.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lines[mid][0] <= start) lo = mid; else hi = mid - 1; }
  return lo;
}

/** Rule 5, stdin, for the fields scanned a line at a time (a file's body, a command's output, each side of a diff): what
 *  a command line puts on the lines below it — a here-document's lines, a pipeline continued onto the next line — as
 *  `{ key, line, start, end }` (the command line, and where the value stands in its own line), like `proximityAcross`.
 *  What a command line holds on its own line is `scrub`'s. `strip` leading characters of each line are not read. */
function proximityStdinAcross(lines, strip, priorOf) {
  if (lines.length < 2) return [];
  const texts = lines.map((line) => (typeof line === 'string' ? line.slice(Math.min(strip, line.length)) : ''));
  const s = texts.join('\n');
  if (!proxStdinHint(s)) return [];
  const starts = [];
  for (let i = 0, o = 0; i < texts.length; i++) { starts.push(o); o += texts[i].length + 1; }
  const blocked = new Uint8Array(s.length);
  proxBlockMarkers(s, blocked);
  const prepared = new Set();
  const ctx = { s, mode: 'data', blocked, lines: proxLines(s, false), stdin: true, across: true, out: [], current: null,
    prepare: (li) => {
      if (prepared.has(li)) return;
      prepared.add(li);
      for (const r of priorOf(li)) blocked.fill(1, starts[li] + Math.max(0, r.start - strip), starts[li] + Math.min(texts[li].length, r.end - strip));
    } };
  for (let i = 0; i < ctx.lines.length; i++) if (texts[i].trim()) proxStdinSecrets(ctx, i);
  return ctx.out.map(([start, end, [line, key]]) => ({ key, line, start: start - starts[line] + strip, end: end - starts[line] + strip }));
}

/** Per text: which lines a here-document's masking took (`free(j)`: the first line from `j` not taken yet), and the
 *  lines by their first word (a here-document's closing line is found without reading every line again). */
function proxStdinState(ctx) {
  const { s, lines } = ctx;
  const up = new Int32Array(lines.length + 1);
  for (let j = 0; j <= lines.length; j++) up[j] = j;
  const free = (j) => {
    let r = j;
    while (up[r] !== r) r = up[r];
    while (up[j] !== r) { const nx = up[j]; up[j] = r; j = nx; }
    return r;
  };
  let byLead = null;
  const candidates = (delim) => {
    if (!byLead) {
      byLead = new Map();
      lines.forEach(([ls, le], j) => {
        const a = proxSkipBlanks(s, ls, le);
        let b = a;
        while (b < le && b - a <= 256 && !proxBlank(s[b]) && !'"\'`,;)]}'.includes(s[b])) b++;
        const lead = s.slice(a, b);
        if (!byLead.has(lead)) byLead.set(lead, []);
        byLead.get(lead).push(j);
      });
    }
    return byLead.get(delim) ?? [];
  };
  return { free, use: (j) => { up[j] = j + 1; }, used: (j) => up[j] !== j, candidates };
}

/** The line that closes here-document `d` whose lines start at `next`; `lines.length` when none does (fail closed). */
function proxStdinClose(ctx, st, d, next, loose) {
  const { s, lines } = ctx;
  if (!d.delim) return lines.length;
  const list = st.candidates(d.delim);
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid] < next) lo = mid + 1; else hi = mid; }
  for (let c = 0; lo < list.length && c < 64; lo++, c++) {
    const j = list[lo];
    let t = s.slice(lines[j][0], lines[j][1]).replace(/\r$/, '');
    if (d.strip) t = t.replace(/^\t+/, '');
    if (t === d.delim) return j;
    // Inside JSON or prose the closing word may carry the string's own closing characters (`EOF",`).
    if (loose && t.trim().startsWith(d.delim) && /^["'`,;)\]}\s]*$/.test(t.trim().slice(d.delim.length))) return j;
  }
  return lines.length;
}

/** A value at `[from, to)`, whole (a command's argument: no sentence punctuation is trimmed), around the older layers'
 *  regions. */
function proxValueExact(ctx, from, to) {
  const { blocked } = ctx;
  for (let k = from; k < to;) {
    while (k < to && blocked[k]) k++;
    let e = k;
    while (e < to && !blocked[e]) e++;
    if (e > k) ctx.out.push([k, e, ctx.current]);
    k = e;
  }
}

// Rule 5, SQL: `IDENTIFIED BY '<v>'` (`CREATE USER`, `ALTER USER`, `GRANT`, in `mysql -e` or a migration), whatever the
// value's shape; `IDENTIFIED WITH <plugin> BY`, `BY PASSWORD`.
const PROX_IDENTIFIED = /\bIDENTIFIED[ \t]+(?:WITH[ \t]+[\w'"`-]{1,64}[ \t]+)?BY[ \t]+(?:PASSWORD[ \t]+)?(\\?["'`])/gi;
function proxIdentifiedBy(ctx, ls, le) {
  const { s } = ctx;
  PROX_IDENTIFIED.lastIndex = ls;
  for (let m = PROX_IDENTIFIED.exec(s); m && m.index < le; m = PROX_IDENTIFIED.exec(s)) {
    const open = m[1];
    const from = m.index + m[0].length;
    const to = proxIndexOf(s, open, from, le);
    if (to > from && !isKeyedPlaceholder(s.slice(from, to)) && s[from] !== '$') proxValueExact(ctx, from, to);
    PROX_IDENTIFIED.lastIndex = Math.max(to, from) + 1;
  }
}

// ---- S1: scope across an event's fields -------------------------------------------------------------------------------
//
// M33 R repair 9. The third leak hunt's first major family: the word and the value in different FIELDS of one event — a
// command's text names the secret and its output is only the value (`echo $RECALL_API_KEY`, `printenv`, `vault kv get
// -field=api_key`, `cat ~/.config/recall/api_key`, `security find-generic-password -w`), a write's or a read's path names
// it and the content is only the value (`.secrets/recall_api_key`), an Edit's new text is only the value and the file's
// line it replaces names it. An event's NAMING texts — its command, its path, and for an edit the lines of the file that
// hold its old text — put its VALUE fields in scope: what the command printed (`tailLines` after the recorder's header)
// and what it writes (`argsExcerpt`, `before`, `after`, `diff`), their first 3 non-blank lines (each of
// an Edit's strings on its own), every line of a credential file's (PROXIMITY_SECRET_FILES). A command that prints a new
// secret (PROXIMITY_SECRET_SOURCES: `openssl rand`, `pwgen`, `/dev/urandom` …) names one whatever its arguments say. In
// scope, rule 3: every credential-shaped token. Named by the password family, also a lone value — one word, or a
// passphrase of three to six words, no status, count, path, file, name, assignment or placeholder — when what was
// printed or written is at most 2 non-blank lines (`security … -w` prints `bluefish`). A `$` reference names here (`$RECALL_API_KEY` is what `echo` prints); the shell's
// `$PWD` and a `pwd` command do not.

const PROX_SECRET_FILE = (() => {
  const exact = new Set(), prefixes = [], suffixes = [];
  for (const f of PROXIMITY_SECRET_FILES) {
    if (f.startsWith('*')) suffixes.push(f.slice(1).toLowerCase());
    else if (f.endsWith('*')) prefixes.push(f.slice(0, -1).toLowerCase());
    else exact.add(f.toLowerCase());
  }
  return (segment) => {
    const x = segment.toLowerCase();
    return exact.has(x) || prefixes.some((q) => x.startsWith(q)) || suffixes.some((q) => x.length > q.length && x.endsWith(q));
  };
})();
const PROX_SECRET_SOURCE = new RegExp(PROXIMITY_SECRET_SOURCES
  .map((entry) => String.raw`(?<![\w-])${proxEscape(entry).replace(/ /g, String.raw`[ \t]+`)}(?![\w-])`).join('|'), 'i');
const PROX_NAMING_MAX = 4096;

/** S1: what a naming text says — `{ strong, password }`: a strong word of the vocabulary stands in it (inside a `$`
 *  reference too), the password family among them. `command`: the text is a command (`pass` at its head names one). */
function proxNaming(text, command) {
  const res = { strong: false, password: false };
  if (typeof text !== 'string' || !text) return res;
  const s = text.length > PROX_NAMING_MAX ? text.slice(0, PROX_NAMING_MAX) : text;
  if (!PROX_HINT.test(s) && !PROX_ZERO_WIDTH.test(s) && !PROX_FULLWIDTH.test(s)) return res;
  for (const o of proxOccurrences(s)) {
    let a = o.start, b = o.end;
    while (a > 0 && proxIdent(s[a - 1])) a--;
    while (b < s.length && proxIdent(s[b])) b++;
    o.identStart = a;
    o.identEnd = b;
    const name = s.slice(a, b);
    if (o.key === 'pwd' && (SHELL_DIRECTORY_NAME.test(name) || name === 'pwd')) continue;     // the shell's PWD, a `pwd` command
    if (o.key === 'password' && s[o.start - 1] === '1') continue;                           // 1Password
    const ls = s.lastIndexOf('\n', o.start - 1) + 1, le = s.indexOf('\n', o.end);
    if (proxRecorderLine(s.slice(ls, le < 0 ? s.length : le))) continue;                // `Original token count: 40`
    if (o.kind === 'head' && !(command && /^(?:[ \t]*(?:sudo[ \t]+)?|.*[;&|(][ \t]*)$/.test(s.slice(Math.max(0, a - 64), a)))) continue;
    if (o.kind === 'weak' && (PROX_PUBLIC_KEY.test(s.slice(Math.max(0, a - 48), o.start)) || !proxKeyStrong(s, o, 0))) continue;
    res.strong = true;
    if (o.kind === 'password' || o.kind === 'cased' || o.kind === 'head') res.password = true;
    if (res.password) break;
  }
  return res;
}

/** S1: does an Edit's old text stand on a line of the file (its `before`) that holds a strong word? Each line of the
 *  edit's strings of six characters or more with a run of three letters or digits is looked for in those lines. */
function proxEditNamed(e) {
  const strings = typeof e.argsExcerpt === 'string' ? e.argsExcerpt : typeof e.after?.text === 'string' ? e.after.text : '';
  const before = e.before?.text;
  if (!strings || typeof before !== 'string' || !before) return false;
  const file = before.length > 200_000 ? before.slice(0, 200_000) : before;
  const named = [];
  let lastLine = -1;
  for (const o of proxOccurrences(file)) {
    if (o.kind === 'weak' || named.length >= 256) continue;
    const ls = file.lastIndexOf('\n', o.start - 1) + 1;
    if (ls === lastLine) continue;
    lastLine = ls;
    const le = file.indexOf('\n', o.start);
    named.push(file.slice(ls, Math.min(ls + 2048, le < 0 ? file.length : le)));            // bounded: each read once
  }
  if (!named.length) return false;
  const pieces = strings.split('\n').map((line) => line.trim()).filter((line) => line.length >= 6 && line.length <= 512
    && line !== '\u27ea\u2192\u27eb' && /[A-Za-z0-9]{3}/.test(line)).slice(0, 256);
  return named.some((line) => pieces.some((piece) => line.includes(piece)));
}

/** S1: an event's scope across its fields, from its naming texts, read before any field is scrubbed: null, or `{ output,
 *  write, all, password }` — what it prints is in scope, what it writes is, every line of it (a credential file), the
 *  password family named it. */
function proximityEventScope(e) {
  if (!e || typeof e !== 'object' || e.genericTool === true) return null;
  const cmd = typeof e.cmd === 'string' ? e.cmd : '';
  const path = typeof e.path === 'string' ? e.path : '';
  const byCmd = proxNaming(cmd, true);
  const byPath = proxNaming(path, false);
  const last = path.split('/').pop();
  const file = Boolean(last) && PROX_SECRET_FILE(last);
  const source = Boolean(cmd) && PROX_SECRET_SOURCE.test(cmd.length > PROX_NAMING_MAX ? cmd.slice(0, PROX_NAMING_MAX) : cmd);
  const editing = e.kind === 'edit' || e.attempted === 'edit';
  const edit = !file && !byPath.strong && editing && proxEditNamed(e);
  // A command that names a credential file (`cat .env`, `cat ~/.npmrc`): its output is in scope; all of it when the command
  // prints the file (PROX_READERS).
  const words = cmd ? (cmd.length > PROX_NAMING_MAX ? cmd.slice(0, PROX_NAMING_MAX) : cmd).split(/[\s;&|<()'"`]+/) : [];
  // (A file the command writes, `cat > .env <<EOF`, prints nothing.)
  const reads = words.some((w, k) => w && w.length <= 256 && !w.includes('>') && !/>$/.test(words[k - 1] ?? '')
    && PROX_SECRET_FILE(w.split('/').pop()));
  const output = byCmd.strong || source || byPath.strong || file || reads;
  const write = byPath.strong || file || edit;
  if (!output && !write) return null;
  const printer = reads && PROX_READERS.has((words.find(Boolean) ?? '').split('/').pop());
  return { output, write, all: file, allOutput: file || printer, password: byCmd.password || byPath.password };
}
// The commands that print a file they are given (S1: a credential file's every line is in scope).
const PROX_READERS = new Set(['cat', 'bat', 'less', 'more', 'head', 'tail', 'nl', 'tac', 'strings', 'xxd', 'od', 'grep', 'rg', 'awk', 'sed',
  'sort', 'cut', 'jq', 'yq', 'type', 'Get-Content', 'gc']);

/** S1: where the recorder's header (PROXIMITY_RECORDER_LINES, ending in `Output:`) ends in the lines of `s`, or -1. */
function proxHeaderEnd(s, lines) {
  for (let i = 0; i < Math.min(lines.length, 8); i++) {
    const text = s.slice(lines[i][0], lines[i][1]);
    if (text === 'Output:') return i;
    if (!proxRecorderLine(text)) return -1;
  }
  return -1;
}

/** S1: the regions an event's scope masks in one of its value fields `text` (already scrubbed: this stage's markers are
 *  no token): `{ all, password }` as `proximityEventScope`; `header`: a command's output, read after the recorder's
 *  header. Each of an Edit's strings (between separator lines) is read on its own. */
function proximityInherited(text, { all = false, password = false, header = false, diff = false } = {}) {
  if (typeof text !== 'string' || !text) return [];
  const blocked = new Uint8Array(text.length);
  proxBlockMarkers(text, blocked);
  const ctx = { s: text, mode: 'data', blocked, occs: proxOccurrences(text), lines: proxLines(text, false), strip: diff ? 1 : 0, out: [], current: 0,
    crossOnly: false, heredoc: -1 };
  const { lines } = ctx;
  let i = header ? proxHeaderEnd(text, lines) + 1 : 0;
  let seen = 0;
  const firsts = [];
  const flush = () => {
    if (password && seen > 0 && seen <= 2) for (const j of firsts) proxLoneValue(ctx, j);
    seen = 0;
    firsts.length = 0;
  };
  for (; i < lines.length; i++) {
    const [ls, le] = lines[i];
    if (le - ls === 3 && text.startsWith('\u27ea\u2192\u27eb', ls)) { flush(); continue; }
    if (proxSkipBlanks(text, ls, le) >= le) continue;
    if (all || seen < 3) { ctx.current = i; proxTokens(ctx, i, false); }
    if (seen < 2) firsts.push(i);
    seen++;
  }
  flush();
  return ctx.out.map(([a, b]) => ({ start: a, end: b }));
}

/** S1, the password family: line `j`, a lone value — one word, or a passphrase of three to six words of three letters or
 *  more; none a status, a count, a path, a file, a name or a placeholder, no word of the vocabulary on it, nothing masked
 *  on it yet — masked whole. */
function proxLoneValue(ctx, j) {
  const { s } = ctx;
  const [ls, le] = ctx.lines[j];
  if (le - ls > 256) return;
  const p = proxDecorationEnd(s, Math.min(le, ls + ctx.strip), le);       // past a diff's marker, a Read's number
  let e = le;
  while (e > p && proxBlank(s[e - 1])) e--;
  if (e <= p) return;
  for (let k = p; k < e; k++) if (ctx.blocked[k]) return;
  const { occs } = ctx;                                                   // a word of the vocabulary on it (in order)
  let lo = 0, hi = occs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (occs[mid].start < p) lo = mid + 1; else hi = mid; }
  if (lo < occs.length && occs[lo].start < e) return;
  const words = s.slice(p, e).split(/\s+/);
  if (words.length === 2 || words.length > 6) return;                  // one word, or a passphrase of 3 to 6
  for (const w of words) {
    const core = proxWordCore(w);
    if (!core) return;
    if (words.length > 1 && !/^[\p{L}\p{N}'\u2019-]{3,}$/u.test(core)) return;       // a phrase is words of 3 or more
    if (proxNoValueWord(w, core)) return;
    if (/^[\w.-]+=/.test(core)) return;                                  // an assignment (`LOG_LEVEL=info`): its key's
  }
  ctx.out.push([p, e, j]);
}
/** A word of a line as the password family reads it: its quotes, brackets and closing punctuation set aside. */
const proxWordCore = (w) => w.replace(/^["'`([]+|["'`)\].,;:!?]+$/g, '');
/** S1, the password family: a word that is never a value alone — a stop or prose word, a count, a version, a date, a
 *  path, a file's name, a placeholder or a `$` reference. (D84 review: also what keeps a value the walk hid in one
 *  place from being masked in every text, `peopleSecretsOf`.) */
function proxNoValueWord(w, core) {
  const lower = core.toLowerCase();
  if (PROX_STOP.has(lower) || PROX_PROSE.has(lower)) return true;
  if (/^\d{1,6}$/.test(core) || PROX_VERSION.test(core) || PROX_DATE.test(core)) return true;
  if (/^(?:\/|~\/|\.\.?\/)/.test(core) || w.endsWith('/')
    || (PROX_FILE.test(core) && !proxMixedRun(core.slice(0, core.lastIndexOf('.'))))) return true;
  return PROX_PLACEHOLDER.test(core) || isKeyedPlaceholder(core) || core[0] === '$';
}

/** Append each of `items` to `list`, one at a time, and return `list` (W3e-7 / F222). A push that
 *  spreads its items passes every item as an argument, and past a few hundred thousand the call
 *  overflows the stack: a command's output of 400K lines threw out of `redact`, and the capture with
 *  it. Every list appended to here grows with the input, so every append is this loop. */
function append(list, items) {
  for (const item of items) list.push(item);
  return list;
}

// ---------------------------------------------------------------------------------------------
// JSON-escape-boundary repair, transcribed from entireio/cli redact/redact.go ~193-205. Ledger
// fields regularly carry undecoded text ("controller.go\nmodel.go") where `\n` is a literal
// backslash-n. A match may begin AT the escape letter — the email pattern matched `nuser@…` in
// `foo\nuser@example.com`, and replacing it turned the `\n` escape into a bare `\` followed by
// the replacement token (measured before this fix). When the character before a match is `\` and
// the first matched character is a known escape letter, advance the start past it and require the
// remainder to still match the pattern on its own (upstream's equivalent: re-check min length).
// If the remainder no longer matches, the finding only existed because of the escape letter —
// discard it; the fail-closed entropy backstop still covers anything real underneath.
function repairEscapeStart(s, start, end, re) {
  if (start === 0 || s[start - 1] !== '\\' || !JSON_ESCAPE_LETTERS.includes(s[start])) {
    return { start, end };
  }
  // Sticky re-match at start+1, with any leading \b — or leading negative lookbehind (F241, the
  // email pattern's run-start anchor) — stripped: the escape letter before the new start is a word
  // character, but the position after a two-character escape is a real boundary.
  const sticky = new RegExp(re.source.replace(/^(?:\\b|\(\?<!\[[^\]]*\]\))/, ''),
    re.flags.replace('d', '').replace('g', '') + 'y');
  sticky.lastIndex = start + 1;
  const m = sticky.exec(s);
  if (!m || m[0].length === 0) return null;
  return { start: start + 1, end: start + 1 + m[0].length };
}

// ---------------------------------------------------------------------------------------------
// Things that look high-entropy but are not secrets and must not trigger a drop.
const BENIGN = [
  /^[0-9a-f]{7,40}$/i,                 // git sha
  /^sha(?:1|256|3-256|512)[-:]/i,
  /^[A-Za-z0-9+/]{20,}={0,2}$/,        // any base64 — too common to drop on shape alone
  /^\d+$/,
];

// Threshold measured, not guessed. Bits/char over real token shapes:
//
//   3.56  uuid                     3.80  kebab slug            3.91  hex32
//   3.96  git sha40                4.02  snake_case path       4.08  long identifier
//   4.35  url                      4.39  prose sentence        4.55  opencode message id
//   ---- 4.6 ----
//   4.66  aws-shaped key           4.81  base64 blob           4.90  supabase key body
//   5.04  random secret            5.16  anthropic-shaped key
//
// 4.0 (the first guess) sits BELOW the entire legitimate band and would fail closed on ordinary
// identifiers and URLs, dropping real content on almost every session. This check is only the
// backstop for secret formats the named PATTERNS above do not know; the margin is deliberately
// tight on the secret side because a missed secret costs trust and a dropped line costs one row.
//
// Re-measured 2026-08-31 against Entire's adversarial vectors (entireio/cli redact/redact_test.go;
// their floor is 4.5, redact.go ~59-63). Verdict: STAY at 4.6.
//   - No secret in their vector set lands in the [4.5, 4.6) band: every low-entropy secret there
//     (AWS key 3.92, Supabase probe 4.20, sbp_ 3.60, low-entropy ghp_ 3.22) is caught by a named
//     pattern above, and everything caught only by entropy sits >= 4.66.
//   - Their own legitimate-content vectors falsify 4.5 for THIS architecture: the OpenCode
//     message id `msg_cb99a444f001Ftd3kTVmr8XQHZ` measures 4.548. Entire survives 4.5 only
//     because its JSONL layer skips id-suffixed fields before entropy runs; sonah's backstop sees
//     ids inline in cmd/args text and has no field skip, so 4.5 would fail closed on real
//     transcript rows. 4.6 clears it with the same one-sided margin as before.
// Exported (M33 T) only so the slicer's encrypted-brief test reads the same floor; its value is unchanged.
// `redactCore`'s scan of short texts, read once per call (M33 R repair 9): the longest text, and how many.
const SCRUB_MEMO_TEXT = 256;
const SCRUB_MEMO_SIZE = 16_384;

export const ENTROPY_MIN = 4.6;
const ENTROPY_LEN = 24;

// UUID_SPLIT. M33 R repair 3, decided by the owner's lead: this backstop dropped many Bash commands whole, most of
// them ONLY because a path token held a UUID — a session's
// scratchpad (`/private/tmp/claude-501/<slug>/<session-uuid>/scratchpad/x.mjs`), a transcript
// (`~/.claude/projects/<slug>/<uuid>.jsonl`). A UUID is a structural identifier, not a secret: alone it already passes
// (3.56 bits/char < 4.6; BENIGN passes hex 7..40), but inside a path it lifts the path's entropy over the floor. Every
// named pattern above runs first, unchanged (`api_key=<uuid>` is still masked by its rule). Effect: most of the
// entropy-dropped Claude Code Bash commands are kept.
//
// M33 R repair 4 (the fourth leak hunt). Repair 3 split the token on its UUIDs and judged each PIECE alone. A piece is not
// the token: the split also cut a secret away from the neighbours that made the token fail
// (`https://hooks.example.test/services/<uuid>/<32 random>` left `/<32 random>`, which has BENIGN's base64 shape and is
// under the 40-character narrowing, while the same URL without the UUID dropped). Now the token is judged WHOLE, as it
// would read had its UUIDs never been written into it (`uuidReadingsFail`): each whole UUID taken out together with the
// separator before it, or the one after it, or neither — every combination, its neighbours kept together — and it
// fails if ANY reading fails: at least ENTROPY_LEN characters and ENTROPY_MIN bits, not BENIGN, the content fields'
// base64 narrowing, exactly the test a token always had. A reading is exactly the token a UUID segment was inserted
// into, so a UUID exempts nothing its token would fail on without it; it only stops a structural identifier from
// inflating its neighbours' entropy. When a token fails, the WHOLE token goes (its UUIDs too), never a piece of it.
// A token holding more than MAX_TOKEN_UUIDS whole UUIDs has too many readings to try: it fails (fail closed).
//
// Whole: the 8-4-4-4-12 hex shape, glued to no ASCII letter or digit on either side — a UUID inside a longer
// alphanumeric run (a secret that happens to hold one, or a random run glued to one) is not one, and the run is tested
// whole, as written, as before.
const WHOLE_UUID = /(?<![0-9A-Za-z])[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9A-Za-z])/gi;
const MAX_TOKEN_UUIDS = 3;
// M33 R repair 6 (the lead's decision on the fifth leak hunt). In a URL a UUID is often the credential itself
// (deploy-hook and webhook URLs, `https://…/deploy_hooks/<uuid>`), and such a URL fails the floor as written (4.68 to
// 4.86 bits/char, measured on four shapes). A token with a URL sign is therefore judged as written AND in every reading
// without its UUIDs, and fails if either does: never weaker than before UUID_SPLIT, and never weaker than repair 4 (a
// UUID cannot dilute a secret beside it under the floor). The recovery is filesystem paths, which
// carry none of these signs.
// A host name before the first `/` (`hooks.example.test/x/<uuid>`, a URL written without its scheme) is one too.
const URL_SIGNS = /:\/\/|[?=@#&]|^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?::\d+)?\//;
const SURROGATE = /[\ud800-\udfff]/;
/** Can `token` hold a whole UUID: 36 characters or more, a `-` among them? Every other token is tested as written. */
const mayHoldUuid = (token) => token.length >= 36 && token.includes('-');

/** Shannon entropy in bits per character of a text of `n` characters whose character counts are `counts`. */
function entropyOfCounts(counts, n) {
  let h = 0;
  for (const c of counts.values()) if (c > 0) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}

/**
 * UUID_SPLIT (M33 R repair 4). Does `token` fail the unclassified high-entropy floor (`fails(text)`, the floor's
 * test of one token)? A token with no whole UUID is tested as written. A token with up to MAX_TOKEN_UUIDS is tested
 * in every reading of it without them — each UUID taken out alone, with the separator before it, or with the one
 * after it — and fails if any reading does; one with more fails. Each reading's entropy is computed from the
 * character counts (the readings differ only in the separators they keep), so a long token is read once, and only a
 * reading over the length and entropy floor is built as text for the BENIGN shapes. Deterministic, no allocation for
 * a token that cannot hold a UUID.
 */
function uuidReadingsFail(token, fails) {
  if (!mayHoldUuid(token)) return fails(token);
  const found = [];
  for (const m of token.matchAll(WHOLE_UUID)) {
    found.push([m.index, m.index + m[0].length]);
    if (found.length > MAX_TOKEN_UUIDS) return true;
  }
  if (!found.length) return fails(token);
  if (URL_SIGNS.test(token) && fails(token)) return true;
  // The bare reading (every UUID taken out alone): its length and character counts.
  const counts = new Map();
  let bare = 0;
  for (let k = 0, f = 0; k < token.length; k++) {
    if (f < found.length && k === found[f][0]) { k = found[f][1] - 1; f++; continue; }
    counts.set(token[k], (counts.get(token[k]) ?? 0) + 1);
    bare++;
  }
  // Each UUID's choices: nothing more, the separator before it, the one after it (a position, or -1 for none).
  const choices = found.map(([s, e]) => [-1, ...(s > 0 ? [s - 1] : []), ...(e < token.length ? [e] : [])]);
  // M33 R repair 5: the pre-filter below counts UTF-16 units; `entropy` counts code points over the unit length. They
  // agree on any text whose every unit is its own code point, and nowhere else: a lone surrogate let the pre-filter pass
  // a reading the floor fails. A token holding any surrogate unit skips the pre-filter: each reading over the length
  // floor is tested exactly (at most 3^MAX_TOKEN_UUIDS of them).
  const exactOnly = SURROGATE.test(token);
  const pick = new Array(found.length);
  const reading = (removed) => {
    let out = '';
    let pos = 0;
    for (let f = 0; f < found.length; f++) {
      const [s, e] = found[f];
      const from = removed.has(s - 1) ? s - 1 : s;
      out += token.slice(pos, Math.max(pos, from));
      pos = Math.max(pos, removed.has(e) ? e + 1 : e);
    }
    return out + token.slice(pos);
  };
  const walk = (f) => {
    if (f < found.length) {
      for (const at of choices[f]) { pick[f] = at; if (walk(f + 1)) return true; }
      return false;
    }
    const removed = new Set(pick.filter((at) => at >= 0));
    const n = bare - removed.size;
    if (n < ENTROPY_LEN) return false;
    for (const at of removed) counts.set(token[at], counts.get(token[at]) - 1);
    const h = entropyOfCounts(counts, n);
    for (const at of removed) counts.set(token[at], counts.get(token[at]) + 1);
    // A pre-filter only: summed in another order than `entropy` sums the text, so it leaves a margin; the reading
    // itself is then tested exactly as any token is.
    if (!exactOnly && h < ENTROPY_MIN - 1e-9) return false;
    return fails(reading(removed));
  };
  return walk(0);
}

// ---------------------------------------------------------------------------------------------
// The closed set of reasons this stage declares, and (W3e-3 / F199) the words a dropped-lines note
// uses for each. A named pattern's reason is `redacted:<its label>`; every other reason is one of
// these constants, never a literal at the place it is declared. The note table below is keyed by
// all of them, and redact/test/every-field.test.js pins that its keys are exactly REDACTION_REASONS.
const PEM_DROP = 'dropped:pem-block';
const ENTROPY_DROP = 'dropped:unclassified-high-entropy';
const ENTROPY_TOKEN_DROP = 'dropped:unclassified-high-entropy-token';
// A prose token removed by the entropy backstop remains a visible cut marker. Downstream
// evidence must know that this is redactor-owned text, not part of the speaker's words.
const DROPPED_TOKEN_MARKER = '‹dropped:high-entropy›';
const droppedTokenCount = (text) => typeof text === 'string'
  ? text.split(DROPPED_TOKEN_MARKER).length - 1 : 0;
const SECRET_VALUE = 'redacted:secret-key-value';
const DB_CREDENTIAL = 'redacted:db-credential';
const PASSWORD_ASSIGNMENT = 'redacted:password-assignment';
const ASSIGNED_SECRET = 'redacted:assigned-secret';

/** Every reason `redact` can declare on `dropped`. */
export const REDACTION_REASONS = Object.freeze([
  ...PATTERNS.map(([, label]) => `redacted:${label}`),
  ...CONNECTION_STRING_RULES.map(([, , label]) => `redacted:${label}`),
  DB_CREDENTIAL, PASSWORD_ASSIGNMENT, ASSIGNED_SECRET, SECRET_VALUE, ENTROPY_TOKEN_DROP, ENTROPY_DROP, PEM_DROP,
]);

/**
 * W3e-3 / F199. What a dropped-lines note says, keyed by the `dropped` reason that dropped the lines:
 * one phrase per reason. The note used to say "unclassified high-entropy content" whatever dropped
 * the lines — a key block, a secret-named value — while the `dropped` record said the truth. Lines
 * dropped for several reasons get one note per reason, in this table's order. The adapter
 * (evidence/adapters/sonah-ledger.js REDACTION_NOTE) recognises every phrase: letters, spaces and
 * hyphens, and redact/test/every-field.test.js pins that it does.
 */
export const DROPPED_NOTE_PHRASES = Object.freeze({
  [PEM_DROP]: 'private key block',
  [ENTROPY_DROP]: 'unclassified high-entropy content',
  [SECRET_VALUE]: 'secret-named value',
  'redacted:private-key': 'private key header',
  'redacted:aws-key': 'AWS access key',
  'redacted:aws-temp-key': 'AWS temporary access key',
  'redacted:github-token': 'GitHub token',
  'redacted:github-pat': 'GitHub personal access token',
  'redacted:anthropic-key': 'Anthropic API key',
  'redacted:openai-key': 'OpenAI API key',
  'redacted:slack-token': 'Slack token',
  'redacted:google-key': 'Google API key',
  'redacted:jwt': 'JSON web token',
  'redacted:bearer': 'bearer token',
  'redacted:supabase-secret': 'Supabase secret key',
  'redacted:supabase-pat': 'Supabase access token',
  'redacted:credentialed-uri': 'URI with a password',
  'redacted:jdbc-dsn': 'JDBC connection string',
  'redacted:db-url-query': 'database URL password',
  'redacted:keyword-dsn': 'keyword connection string',
  'redacted:semicolon-dsn': 'semicolon connection string',
  [DB_CREDENTIAL]: 'database credential',
  [PASSWORD_ASSIGNMENT]: 'password assignment',
  [ASSIGNED_SECRET]: 'secret-named assignment',
  'redacted:email': 'email address',
  [ENTROPY_TOKEN_DROP]: 'unclassified high-entropy token',
});
const NOTE_ORDER = Object.freeze(Object.keys(DROPPED_NOTE_PHRASES));
/** The reason a note names for lines dropped for `reasons`: the first of them in table order. */
const noteReason = (reasons) => {
  let best = -1;
  for (const reason of reasons) {
    const i = NOTE_ORDER.indexOf(reason);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best < 0 ? ENTROPY_DROP : NOTE_ORDER[best];
};
/** One note per reason, in table order: `[… N line(s) dropped: <phrase> …]` (`what` names the lines). */
const droppedNotes = (counts, what = 'line(s)') => NOTE_ORDER.filter((reason) => counts.get(reason))
  .map((reason) => `[… ${counts.get(reason)} ${what} dropped: ${DROPPED_NOTE_PHRASES[reason]} …]`);

/**
 * M33 F, retired by D68 (E) (owner decision 2026-10-07; C-02 "M36 what the agent produced is kept whole"). A closing
 * statement (the slicer's `sayings`) and a helper's final report (a Codex FINAL_ANSWER, a Workflow agent's report) are
 * what the agent PRODUCED: redaction scrubs each WHOLE, exactly as before, and bounds neither. The 8,000 / 6,000 / 2,000
 * code-point budget (`STATEMENT_CAP`, `FINAL_ANSWER_CAP`) and its bounds (`boundStatement`, `boundFinalAnswer`) are
 * deleted. A persisted ledger whose text an earlier Sonah already bounded keeps its marker on a line of its own and its
 * declaration (the adapter recognises both markers, re-declared there, and never quotes across them): a second pass
 * changes nothing. These two markers are kept only so a test and that reader can name them.
 */
export const STATEMENT_OMISSION = '[… statement middle omitted before review …]';
export const FINAL_ANSWER_OMISSION = '[… report middle omitted before review …]';

/**
 * `text` bounded by `cap` at line boundaries around `marker`: `{ text, truncated, middle, removed }` — `middle` is what a
 * cut made now removed (the partial lines at its edges included; '' when nothing was cut now) and `removed` its code
 * points, not counting the line breaks the head and tail keep around the marker.
 *
 * `words` (M33 R repair, an ask's bound only): a side whose window holds no line break — one long line — is not left
 * empty: it is cut at the last word boundary its window holds instead (the head) or the first (the tail), never inside a
 * redaction token, so a one-line ask over the budget keeps up to its first 14,000 and last 6,000 code points as the
 * older slicer did. The text is already scrubbed, so the cut cannot leave part of a secret.
 */
function cutAtLines(text, cap, marker, { words = false } = {}) {
  const whole = String(text);
  const none = { text: whole, truncated: false, middle: '', removed: 0 };
  if (whole.length <= cap.chars) return none;   // UTF-16 units >= code points
  const points = [...whole];
  if (points.length <= cap.chars) return none;
  if (points.length <= cap.head + cap.tail + [...marker].length + 2 && whole.split('\n').includes(marker))
    return { ...none, truncated: true };
  let head = points.slice(0, cap.head).join('');
  let headBreak = true;     // the head ends where a line ends: the text's own line break stands before the marker
  if (points[cap.head] !== '\n') {
    const at = head.lastIndexOf('\n');
    if (at >= 0 || !words) head = head.slice(0, Math.max(0, at));
    else { head = whole.slice(0, wordEnd(whole, head.length)); headBreak = false; }
  }
  let tail = points.slice(-cap.tail).join('');
  let tailBreak = true;
  if (points[points.length - cap.tail - 1] !== '\n') {
    const at = tail.indexOf('\n');
    if (at >= 0) tail = tail.slice(at + 1);
    else if (!words) tail = '';
    else { tail = whole.slice(wordStart(whole, whole.length - tail.length)); tailBreak = false; }
  }
  const middle = whole.slice(head.length, whole.length - tail.length);
  return { text: [...(head ? [head] : []), marker, ...(tail ? [tail] : [])].join('\n'), truncated: true, middle,
    removed: [...middle].length - (head && headBreak ? 1 : 0) - (tail && tailBreak ? 1 : 0) };
}
/** Where a head of scrubbed `text` cut at most `at` UTF-16 units in ends: at the last whitespace before `at` (the word it
 *  would split goes), else at `at`; never inside a surrogate pair or a redaction token (`safeCut`). */
function wordEnd(text, at) {
  if (at >= text.length || /\s/.test(text[at])) return safeCut(text, at);
  for (let k = at - 1; k > 0; k--) if (/\s/.test(text[k])) return safeCut(text, k);
  return safeCut(text, at);
}
/** Where a tail of scrubbed `text` that starts at most at `at` begins: after the first whitespace from `at` (the word it
 *  would split goes), else at `at`; never inside a surrogate pair or a redaction token. */
function wordStart(text, at) {
  if (at <= 0 || /\s/.test(text[at - 1])) return at;
  for (let k = at; k < text.length; k++) if (/\s/.test(text[k])) return k + 1;
  let start = at;
  if (lowSurrogate(text.charCodeAt(start)) && highSurrogate(text.charCodeAt(start - 1))) start++;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  for (const m of text.slice(lineStart, text.indexOf('\n', start) < 0 ? text.length : text.indexOf('\n', start)).matchAll(REDACTOR_TOKEN)) {
    const from = lineStart + m.index;
    if (from < start && start < from + m[0].length) return from + m[0].length;
  }
  return start;
}

// ---------------------------------------------------------------------------------------------
// M33 R. Every other cut Sonah makes of a recorded text, made here, AFTER the text was scrubbed whole.
//
// The slicer used to make each of these cuts itself, mid-line, in UTF-16 units, BEFORE redaction: an ask over 20,000
// characters (its first 14,000 and last 6,000), a file body over 20,000 (its head), a write's arguments over 2,000
// (`argsExcerpt`), a first error line over 200, a hunk header over 100. A token straddling a cut reached redaction as
// a fragment no rule knew and survived into the ledger, the session and the review requests: across every one of those
// cuts a 40-character ghp_ token kept up to 39 of its characters, and across an ask's tail cut a 93-character sk-ant
// key kept up to 92. Now the slicer keeps the text (an excerpt in a window that ends where its line ends; a body whole),
// this redactor scrubs it whole, and only then is it bounded, here. D68 (E) (owner decision 2026-10-07) deleted the
// body's bound and the slicer's memory bound (and M35 the ask's): what the agent produced is kept whole; the bounds left
// are a hunk header's and an attached file's (`ATTACHED_CAP`); D69 (c) deleted the hunk header's and the D69 review
// the excerpt's (`EXCERPT_CAPS`: a write's own arguments are kept whole). A cut of a scrubbed text can no longer leave
// part of a secret; it is still made where it never splits
// a character, a redaction token or one of Sonah's own lines (`safeCut`). Every bound is final: a second pass over a
// bounded text changes nothing. The budgets are the ones the slicer cut at, frozen here; the cuts are Sonah's, each
// declared by Sonah's own marker. Deterministic: no clock, no model, no network.

/**
 * Windowing (owner-confirmed spec 2026-10-06; C-02 "M35 the human message in
 * full"): a human message is kept IN FULL. The 20,000-code-point ask budget (`ASK_CAP`: its first 14,000 and last 6,000
 * code points around `ASK_OMISSION`) is gone; redaction still scrubs every ask whole, exactly as before, and bounds none.
 * Only an attached file (below) keeps a declared middle cut. A persisted ledger whose ask an earlier Sonah already cut
 * (`ASK_OMISSION` on a line of its own, or the older slicer's stub) keeps that cut and its declaration; one an earlier
 * slicer only declared due (its text whole) has the declaration withdrawn and is kept whole (`settledAsk`).
 */
/**
 * M34 labels (C-02 "Slice-time labels"; owner decision 2026-10-06): a file or directory the human attached (an
 * @-mention, an `interjections` entry of kind `attached`) is part of the human's message, bounded like an observation:
 * 2k tokens (at the windowing spec's 3.6 bytes per token, 7,200 code points), its head and tail kept by position only —
 * the same declared middle cut (`ASK_MIDDLE`) an over-long ask has, made here after the text was scrubbed whole.
 */
export const ATTACHED_CAP = Object.freeze({ chars: 7_200, head: 3_600, tail: 3_600 });
/** The interjection kind whose bound is `ATTACHED_CAP` (slicer events.js `INTERJECTION_KINDS.attached`). */
const ATTACHED_KIND = 'attached';
export const ASK_OMISSION = '[… instruction middle omitted before review …]';
export const ASK_MIDDLE = 'middle of turn';
/** The older slicer's own mid-line stub of an ask it cut before redaction: a text carrying it was already bounded. */
const OLDER_ASK_ELISION = /\n\n\[… \d+ chars elided …\]\n\n/;

/**
 * M6 (C-02 "M6 the human turn whole"). Sonah strips nothing from a human turn by its
 * shape any more. M33 R repair's strips — a code fence, a traceback, a run of six or more indented lines, or an
 * attachment element, of at least 1,200 characters, replaced by a stub `[<what>, N lines, M chars]` — stood in for a
 * judgment of meaning ("pasted material, not instruction"): a spec, an interface or acceptance criteria pasted in a fence
 * lost its requirements, while a shorter paste of the same kind survived. Now the turn is kept whole (and, since the
 * windowing spec, in full: no transport budget cuts it) and the model decides, under grounding, whether what was pasted
 * states a requirement. Redaction still scrubs the whole turn first.
 *
 * `ASK_STRIP_KINDS` is the closed set of strips an earlier Sonah made: kept only to read a persisted ledger whose ask
 * still carries one (its stub stands in the text: the declaration stays, `stripMade`) or declares one an earlier slicer
 * left due (its text whole: the declaration is withdrawn, nothing is stripped).
 */
export const ASK_STRIP_KINDS = Object.freeze(['attachment', 'code block', 'traceback', 'indented block']);

/** Is the strip `entry` declares one an earlier pass already made — its own stub stands in `text`? */
const stripMade = (entry, text) => ASK_STRIP_KINDS.includes(entry?.what) && Number.isSafeInteger(entry.chars)
  && text.includes(`[${entry.what}, `) && new RegExp(`\\[${entry.what}, \\d+ lines, ${entry.chars} chars\\]`).test(text);

/**
 * D68 (E) (owner decision 2026-10-07; C-02 "M36 what the agent produced is kept whole"): a file body (`before`, `after`)
 * — a written body, each side of an Edit, the file before an edit — is kept WHOLE. Redaction scrubs it whole, exactly as
 * before, and cuts nothing: the 20,000-UTF-16-unit body cut (`BODY_CAP`, `capBody`, `capEdit`) is deleted, and the
 * window budget is the only bound (C-07). A persisted ledger whose body an earlier Sonah or slicer cut keeps its stub
 * `[… truncated at N chars …]` on a line of its own and its `truncated` declaration (the adapter's `BODY_TRUNCATION`
 * and `BODY_CAPPED_NOTE`): recognised, never produced.
 */

/**
 * M33 R repair 3. A numbered text — a Claude Code Read result, `cat -n` or `nl` output — holds each line of the file
 * behind its number: `     12\t`. This is the slicer's rule for a Read, in one place (slicer/src/before.js
 * `stripLineNumbers` reads it from here): a line's number is `READ_LINE_NUMBER`, and a text is numbered when at least
 * 80% of its non-empty lines carry one, its `<system-reminder>` blocks set aside (they are not lines of the file). The
 * slicer's Read parsing knows this one form; no recorder it reads writes a `N→` form, so neither does this rule.
 */
export const READ_LINE_NUMBER = /^\s*\d+\t/;
// M33 R repair 4. The line-number shapes an output's lines may carry before the text they number. Redaction scans
// `tailLines` once more without each shape present (`scrubTail`); the text shown is never stripped of one, so a shape
// here can only drop a line, never show text: `N` and a tab (the slicer's Read rule, above), `N→` (an arrow-numbered
// listing), `grep -n` (`N:` a matching line, `N-` a context line), `rg -n` and `grep -Hn` (`path:N:`, `path-N-`,
// read both at the first and at the last number a path-like run allows). Bounded, so a long line is read only at its
// start.
// M33 R repair 5 (the fifth leak hunt). A path may hold blanks and colons — a project under a folder like `Acme Labs`,
// Claude Code's own Grep tool printing absolute paths, a Windows drive's `C:` — and the path shapes took neither, so
// such output got no de-numbered view: they take any run of the line now. And the shapes the hunt found unhandled:
// `rg --column` / `--vimgrep` (`path:N:C:`, its context lines `path-N-` in the same view, so a PEM block its match
// opens is closed where the view reads it), a number and a blank (awk's `NR`, `nl -s' '`, `less -N`) or a bar (bat's
// `N │`, a code frame's `N |` and its `> N |`), an enumeration (`N)`, `(N)`, `[N]`), a timestamp before the text (an
// ISO date and time, a clock, a CI log's tab-separated columns before its timestamp). A shape that strips too much
// leaves a view that disagrees with the others, and the line is dropped: wider is always safe.
const OUTPUT_LINE_NUMBERS = Object.freeze([
  READ_LINE_NUMBER,
  /^\s{0,16}\d{1,9}→/,
  /^\d{1,9}[:-]/,
  /^[^\n]{1,512}?[:-]\d{1,9}[:-]/,
  /^[^\n]{1,512}[:-]\d{1,9}[:-]/,
  /^[^\n]{1,512}?(?::\d{1,9}:\d{1,9}:|-\d{1,9}-)/,
  /^[ \t>]{0,16}\d{1,9}(?: ?[│|] ?| )/,
  /^[ \t]{0,16}(?:\(\d{1,9}\)|\[\d{1,9}\]|\d{1,9}\)) ?/,
  /^[^\n]{0,256}?\[?\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?\]?[ \t]/,
  /^\[?\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,9})?\]?[ \t]/,
]);
/**
 * M33 R repair 5. What `cat -e`, `cat -A` and `cat -v` print at a line's end — `$` for its end, `^M` for each carriage
 * return before it — as the length of that decoration on `line` (0: none), read from the end, so a long line costs
 * what its decoration does. A YAML block's key line printed `signing_key: |$` or `|^M$` is no key line until it is
 * read without it. Redaction scans `tailLines` once more without it (and without it behind each line-number shape
 * present): never shown, so it can only drop a line.
 */
function outputLineDecoration(line) {
  let k = line.length;
  if (line[k - 1] === '$') k--;
  while (k >= 2 && line[k - 1] === 'M' && line[k - 2] === '^') k -= 2;
  return line.length - k;
}
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/** `text`, its `<system-reminder>` blocks set aside and its trailing whitespace trimmed: what the 80% rule counts. */
export const readText = (text) => String(text).replace(SYSTEM_REMINDER, '').trimEnd();
/** Is `text` numbered: at least 80% of the non-empty lines of `readText(text)` behind a `READ_LINE_NUMBER`? */
export function isNumberedRead(text) {
  const nonEmpty = readText(text).split('\n').filter((line) => line.trim().length);
  return nonEmpty.length > 0 && nonEmpty.filter((line) => READ_LINE_NUMBER.test(line)).length / nonEmpty.length >= 0.8;
}

/**
 * D69 review: a write's own arguments (`argsExcerpt` of an edit or a create: the text the agent wrote)
 * are kept WHOLE, as D68 (E) keeps every text the agent produced: the slicer's window of them (`excerptWindow`) and this
 * redactor's 2,000-unit bound after it (`EXCERPT_CAPS`, `boundExcerpt`) are deleted — no window reads them, and their
 * other readers needed no bound (the legacy gate; the S1 compiler, legacy renderer and label app, since removed). An
 * excerpt an earlier Sonah windowed and bounded (`…[+N]` at its end: N characters it did not keep) is recognised in a
 * persisted ledger: its text is scrubbed whole without the marker and the marker kept as it was, so a second pass
 * changes nothing; never produced. (D69 (c) deleted the first error line and its cap.)
 */
const EXCERPT_MARK = /…\[\+(\d+)\]$/;

/** One of Sonah's own lines (a dropped-lines note, a stub, a marker): kept whole or not at all. */
const SONAH_LINE = /^\[… .* …\]$/;
const REDACTOR_TOKEN = /‹(?:redacted|dropped)(?::[^›\n]+)?›/g;
const highSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
const lowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Where to cut scrubbed `text` at most `at` UTF-16 units in: `at`, or earlier so the cut never splits a surrogate pair,
 * a redaction token, or one of Sonah's own lines (a note or stub inside the cut is dropped with its line break).
 */
function safeCut(text, at) {
  if (at >= text.length) return text.length;
  let cut = Math.max(0, at);
  if (cut > 0 && highSurrogate(text.charCodeAt(cut - 1)) && lowSurrogate(text.charCodeAt(cut))) cut--;
  const lineStart = text.lastIndexOf('\n', cut - 1) + 1;
  let lineEnd = text.indexOf('\n', cut);
  if (lineEnd < 0) lineEnd = text.length;
  if (cut > lineStart && text.startsWith('[… ', lineStart) && SONAH_LINE.test(text.slice(lineStart, lineEnd)))
    return Math.max(0, lineStart - 1);
  if (text.lastIndexOf('‹', cut - 1) >= lineStart) {
    for (const m of text.slice(lineStart, lineEnd).matchAll(REDACTOR_TOKEN)) {
      const start = lineStart + m.index;
      if (start < cut && cut < start + m[0].length) { cut = start; break; }
    }
  }
  return cut;
}


/**
 * The file names `text` names (slicer/src/ask.js harvested these from what it elided; M33 R: from what this redactor
 * cut too, after scrubbing, so a name is never taken from half a token): each whitespace- or punctuation-delimited
 * word of 3 to 200 characters that ends in a dotted extension, or is a known extensionless build-file name, lowercased,
 * into `mentions` (a Set), at most 1,000 of them. Linear: a split, then a bounded anchored test per word.
 */
export function harvestMentions(text, mentions) {
  for (const tok of String(text ?? '').split(/[\s"'`()[\]{},;:|<>*]+/)) {
    if (mentions.size >= 1000) break;
    if (tok.length < 3 || tok.length > 200) continue;
    // Known extensionless build-file names are ecosystem grammar (class A).
    if (/^(Makefile|Dockerfile|Rakefile|Justfile|Gemfile|Procfile|BUILD|WORKSPACE)$/.test(tok)) {
      mentions.add(tok.toLowerCase());
      continue;
    }
    const mm = /([\w-]{1,80}\.[a-z]{1,6})$/i.exec(tok);
    if (mm) mentions.add(mm[1].toLowerCase());
  }
  return mentions;
}

/** A scrubbed attached file the slicer declared over budget, bounded: `cutAtLines`'s result, `already` when an earlier
 *  bound (or the older slicer's cut, `OLDER_ASK_ELISION`) already shortened it. */
function boundAsk(text, cap = ATTACHED_CAP) {
  const points = [...text].length;
  if (points <= cap.head + cap.tail + 64 && OLDER_ASK_ELISION.test(text))
    return { text, truncated: true, middle: '', removed: 0, already: true };
  const bound = cutAtLines(text, cap, ASK_OMISSION, { words: true });
  if (bound.truncated && bound.middle === '') return { ...bound, already: true };
  if (!bound.truncated && text.split('\n').includes(ASK_OMISSION)) return { ...bound, truncated: true, already: true };
  return { ...bound, already: false };
}

/** Windowing (C-02 "M35 the human message in full"): a scrubbed human message an earlier slicer declared over the
 *  retired ask budget. Never cut now: one an earlier pass already cut (its `ASK_OMISSION` line, or the older slicer's
 *  stub) is kept as it is and keeps its declaration (`already`); any other is whole, and its declaration is withdrawn. */
function settledAsk(text) {
  const cut = text.split('\n').includes(ASK_OMISSION) || OLDER_ASK_ELISION.test(text);
  return cut ? { text, truncated: true, middle: '', removed: 0, already: true } : { text, truncated: false, middle: '', removed: 0 };
}

/**
 * `mask: false` (D84, owner decision 2026-10-12: the model reads the session unredacted): every bound, every closed
 * vocabulary and every identity SHAPE check below runs exactly as with masking, and nothing is masked, withheld or
 * declared for a secret — no text is scanned, no identity is flagged, nothing is added to `dropped`. It is what a
 * session review loads (cli/src/recorded-session.js); what it returns is never written for a person unmasked
 * (`maskForPeople`).
 * @param {Ledger} ledger
 * @param {{mask?: boolean}} [options]
 * @returns {{ledger: Ledger, dropped: Array}}
 */
export function redact(ledger, { mask = true } = {}) {
  return redactCore(ledger, { mask: mask !== false });
}

/**
 * D84 (owner decision 2026-10-12, "off for the model, on for output"): THE output function. One text as a person
 * will read it — on the session page, in the Markdown story, in a PR comment, on the terminal — with every secret this
 * redactor finds masked: first each of `values` wherever it stands as a whole token (`maskValues`; a session's are the
 * values its full-context scan hid, `peopleSecretsOf`), then by the rules of the agent's own words (`claim`: prose,
 * token level, PEM blocks dropped with a note, a secret-named YAML block masked where it stands; a masked or dropped
 * token keeps its line). Every writer for people calls it on each recorded or review-authored text before it cuts or
 * escapes it, and once more on what it is about to write. Deterministic: a function of the text and the values alone (a
 * bounded memo of short texts is a cache of that function, never state that changes an answer). Fails closed: a value
 * that is not text, or a scan that does not return text, throws, and the caller writes and posts nothing. A second
 * pass changes nothing.
 */
export function maskForPeople(text, values = NO_VALUES) {
  if (typeof text !== 'string') throw new TypeError('maskForPeople takes one text');
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
    throw new TypeError('maskForPeople takes a list of values');
  if (!text) return text;
  return scanForPeople(values.length ? maskValues(text, values) : text);
}
/**
 * `maskForPeople` with `values` bound and its answers kept (a cache of that function): what a render applies.
 * `restatedIn` (the review's report, any value): the values one of its texts holds whole — what the model restated —
 * are masked also where a text's end or start cuts them (a title cut from the text it restated one in, `maskValues`).
 */
export function peopleMask(values = NO_VALUES, { restatedIn = null } = {}) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))
    throw new TypeError('peopleMask takes a list of values');
  if (!values.length) return (text) => maskForPeople(text);
  const list = restatedIn === null ? values : withCuts(values, restatedIn);
  const memo = new Map();
  return (text) => {
    if (typeof text !== 'string') throw new TypeError('maskForPeople takes one text');
    if (memo.has(text)) return memo.get(text);
    const masked = maskForPeople(text, list);
    if (text.length <= PEOPLE_MEMO_TEXT) {
      if (memo.size >= PEOPLE_MEMO_SIZE) memo.clear();
      memo.set(text, masked);
    }
    return masked;
  };
}
/** The prose scan of `maskForPeople`. */
function scanForPeople(text) {
  if (!text) return text;
  const short = text.length <= PEOPLE_MEMO_TEXT;
  if (short && peopleMemo.has(text)) return peopleMemo.get(text);
  const masked = redactCore({ ask: [], ledger: [], claim: { text } }, { mask: true }).ledger.claim?.text;
  if (typeof masked !== 'string') throw new TypeError('maskForPeople could not scan the text');
  if (short) {
    if (peopleMemo.size >= PEOPLE_MEMO_SIZE) peopleMemo.clear();
    peopleMemo.set(text, masked);
  }
  return masked;
}
const PEOPLE_MEMO_TEXT = 8_192;
const PEOPLE_MEMO_SIZE = 4_096;
const peopleMemo = new Map();
const NO_VALUES = Object.freeze([]);

// ---- D84 review: what the full-context scan hides -------------------------------------------------------------------
//
// D84 review (2026-10-13, finding 1 and 2). The model reads a session unredacted, and an output pass over one text at a
// time cannot see what this redactor's full walk sees: the context across an event's fields (S1: a command or a path
// that names a secret puts what the command printed, or what the write holds, in scope), a value key inside a
// secret-named file, a key block's lines below its key. So the output layer is given the walk's own findings. The walk
// runs once more, masking on, over the ledger the model read (`peopleSecretsOf`), and each text is set beside the text
// the walk left: what the walk hid of it are the field's hidden values. Structure only: the walk's markers and notes
// are the only words read, and a text is matched by its exact bytes, never by what it says.
// - A field's values are masked in that field wherever the people view shows it (render/session-story.js
//   `sessionForPeople`), as the load masked them in place before D84; a field the walk withheld whole is withheld
//   whole.
// - A value the walk hid and shows nowhere else in the session is the session's: it is masked, as a whole token, in
//   every text written for a person — the recording's other fields, and what the model wrote (a value it restates).
//   A value the walk shows elsewhere (a false find in one place, `pass 8`) is no secret alone and stays elsewhere.
// What the walk does not find, this does not find: these are the load's rules before D84, run on the same text.

/** A redactor's own mark in a text: a masked value, a dropped token, a dropped-lines note. */
const REDACTOR_MARK = new RegExp(String.raw`‹(?:redacted|dropped)(?::[^›\n]+)?›`
  + String.raw`|\[… \d+ (?:diff )?line\(s\) dropped: [A-Za-z][A-Za-z -]*[A-Za-z] …\]`, 'g');
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Does `value` stand whole at `at` in `text`: no letter, digit or `_` joins it on a side that is one itself? */
const wholeAt = (text, value, at) =>
  (at === 0 || !WORD_CHAR.test(value[0]) || !WORD_CHAR.test(text[at - 1]))
  && (at + value.length === text.length || !WORD_CHAR.test(value[value.length - 1])
    || !WORD_CHAR.test(text[at + value.length]));
/** Every place `value` stands whole in `text`. */
function* wholePlaces(text, value) {
  for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) if (wholeAt(text, value, at)) yield at;
}

/** The mark the walk wrote in place of each value of a list `peopleSecretsOf` returned (`‹redacted:secret-value›` for a
 *  value it has none for): kept beside the list, so a list is all a caller passes. */
const VALUE_MARKS = new WeakMap();
const markedList = (marks) => {
  const list = Object.freeze([...marks.keys()].sort(longestFirst));
  VALUE_MARKS.set(list, marks);
  return list;
};

/** The values of a list whose cut part a text's end or start is masked as (`withCuts`): the ones the model restated. */
const VALUE_CUTS = new WeakMap();
/** `values` (with their marks), each of those that `restatedIn`'s texts hold whole also masked where a cut leaves part
 *  of it: a text the model wrote is cut only after it restated a value whole in it (a finding's title, cut from the
 *  text its explanation holds whole). Structure only: which values a text holds, never what the text says. */
function withCuts(values, restatedIn) {
  const corpus = textsOf(restatedIn).join('\n');
  const cuts = new Set(values.filter((value) => corpus.includes(value) && !wholePlaces(corpus, value).next().done));
  const list = Object.freeze([...values]);
  const marks = VALUE_MARKS.get(values);
  if (marks) VALUE_MARKS.set(list, marks);
  VALUE_CUTS.set(list, cuts);
  return list;
}
/** The fewest characters of a value a text's end (or start) may cut it to and still be masked as that value's part. */
const PARTIAL_VALUE_MIN = 4;
/** Where a value cut by the end of `text` starts — `text` ends (but for a cut mark, `…`) in the value's first
 *  characters, at least PARTIAL_VALUE_MIN of them, standing whole on their left — else -1. */
function cutAtEnd(text, value) {
  const end = text.endsWith('…') ? text.length - 1 : text.length;
  for (let at = Math.max(0, end - value.length + 1); at <= end - PARTIAL_VALUE_MIN; at++) {
    if (text[at] !== value[0] || !(at === 0 || !WORD_CHAR.test(value[0]) || !WORD_CHAR.test(text[at - 1]))) continue;
    if (text.slice(at, end) === value.slice(0, end - at)) return at;
  }
  return -1;
}
/** Where a value cut by the start of `text` ends — `text` starts (but for a cut mark, `…`) with the value's last
 *  characters, at least PARTIAL_VALUE_MIN of them, standing whole on their right — else -1. */
function cutAtStart(text, value) {
  const start = text.startsWith('…') ? 1 : 0;
  for (let until = Math.min(text.length, start + value.length - 1); until >= start + PARTIAL_VALUE_MIN; until--) {
    const last = value[value.length - 1];
    if (text[until - 1] !== last || !(until === text.length || !WORD_CHAR.test(last) || !WORD_CHAR.test(text[until])))
      continue;
    if (text.slice(start, until) === value.slice(value.length - (until - start))) return until;
  }
  return -1;
}

/**
 * `text` with each of `values` masked wherever it stands whole — by the mark the walk wrote in its place, when the list
 * is one `peopleSecretsOf` returned, else `‹redacted:secret-value›`: overlapping places are masked as one (the longer
 * value's mark), and a redactor's mark already in the text is never read into. A value the model restated (a list
 * `peopleMask` gave, `restatedIn`) that a text's end or start cuts (a title cut to its first characters, `…` or not)
 * is masked as far as it stands, when PARTIAL_VALUE_MIN characters or more of it do: so no cut made before this pass
 * leaves part of one. Deterministic; idempotent.
 */
export function maskValues(text, values) {
  if (typeof text !== 'string' || !text || !Array.isArray(values) || !values.length) return text;
  const cuts = VALUE_CUTS.get(values);
  const near = (value) => typeof value === 'string' && value && (text.includes(value) || (cuts?.has(value) === true
    && (text.includes(value.slice(0, PARTIAL_VALUE_MIN)) || text.includes(value.slice(-PARTIAL_VALUE_MIN)))));
  if (!values.some(near)) return text;
  const marks = [...text.matchAll(REDACTOR_MARK)].map((m) => [m.index, m.index + m[0].length]);
  const named = VALUE_MARKS.get(values);
  const regions = [];
  for (const value of values) {
    if (typeof value !== 'string' || !value || !text.includes(value)) continue;
    for (const at of wholePlaces(text, value)) {
      const end = at + value.length;
      if (!marks.some(([a, b]) => at < b && a < end)) regions.push([at, end, named?.get(value) ?? SECRET_VALUE_MARKER]);
    }
  }
  for (const value of cuts ?? []) {
    if (value.length <= PARTIAL_VALUE_MIN) continue;
    const cut = text.endsWith('…') ? text.length - 1 : text.length;
    const tail = cutAtEnd(text, value), head = cutAtStart(text, value);
    const mark = named?.get(value) ?? SECRET_VALUE_MARKER;
    if (tail >= 0 && !marks.some(([a, b]) => tail < b && a < cut)) regions.push([tail, cut, mark]);
    const from = text.startsWith('…') ? 1 : 0;
    if (head >= 0 && !marks.some(([a, b]) => from < b && a < head)) regions.push([from, head, mark]);
  }
  if (!regions.length) return text;
  regions.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let out = '', cursor = 0;
  for (const [a, b, mark] of regions) {
    if (b <= cursor) continue;
    out += text.slice(cursor, Math.max(a, cursor)) + (a >= cursor ? mark : '');
    cursor = b;
  }
  return out + text.slice(cursor);
}

/** What the walk hid of `open`, the text the model read, given `shown`, the text the walk left of it (null when it
 *  left none): `{ values, whole }`, `values` a Map of each hidden value to the mark the walk wrote in its place (null
 *  when that is not one mark). `shown`'s text between the walk's marks is found in `open` in order, each line of it
 *  where `shown` has a line's start or end at one too; what of `open` is left over, line by line, was hidden. When
 *  `shown` cannot be read that way, each later line of `open` that `shown` does not hold whole is. Structure only. */
function hiddenOf(open, shown) {
  if (typeof shown !== 'string') return { values: new Map(), whole: true };
  const pieces = [];
  const piece = (from, until) => {
    let at = from;
    for (const line of shown.slice(from, until).split('\n')) {
      if (line) pieces.push({ line, from: at, to: at + line.length, start: at === 0 || shown[at - 1] === '\n',
        end: at + line.length === shown.length || shown[at + line.length] === '\n' });
      at += line.length + 1;
    }
  };
  let last = 0;
  for (const mark of shown.matchAll(REDACTOR_MARK)) { piece(last, mark.index); last = mark.index + mark[0].length; }
  piece(last, shown.length);
  const values = new Map();
  /** The values of `open` in [from, until), the text `shown` holds in [shownFrom, shownTo) in their place. */
  const gap = (from, until, shownFrom, shownTo) => {
    const found = open.slice(from, until).split('\n').map((line) => line.trim()).filter(Boolean);
    const marks = shownFrom === null ? [] : shown.slice(shownFrom, shownTo).match(REDACTOR_MARK) ?? [];
    const mark = found.length === 1 && marks.length === 1 && marks[0].startsWith('\u2039') ? marks[0] : null;
    for (const value of found) if (!values.has(value) || values.get(value) === null) values.set(value, mark);
  };
  let cursor = 0, shownCursor = 0;
  for (const { line, from, to, start, end } of pieces) {
    const fits = (at) => (!start || at === 0 || open[at - 1] === '\n')
      && (!end || at + line.length === open.length || open[at + line.length] === '\n');
    let at = open.indexOf(line, cursor);
    while (at >= 0 && !fits(at)) at = open.indexOf(line, at + 1);
    if (at < 0) {
      // Not read in order: each later line of `open` that `shown` does not hold whole was hidden.
      const lines = new Set(shown.split('\n'));
      let offset = cursor;
      for (const rest of open.slice(cursor).split('\n')) {
        if (!lines.has(rest)) gap(offset, offset + rest.length, null, null);
        offset += rest.length + 1;
      }
      return { values, whole: false };
    }
    gap(cursor, at, shownCursor, from);
    cursor = at + line.length;
    shownCursor = to;
  }
  gap(cursor, open.length, shownCursor, shown.length);
  return { values, whole: false };
}

/** The identities a recording names its rows, hand-offs and recordings by: scanned as identities (`identityFields`, the
 *  event identity's `native`), never shown as a recorded text, so never a hidden value. */
const DELEGATION_IDENTITY_FIELDS = Object.freeze(['callId', 'childId', 'taskName', 'target', 'sessionId']);
const WORKFLOW_IDENTITY_FIELDS = Object.freeze(['runId', 'workflowName']);
const SOURCE_IDENTITY_FIELDS = Object.freeze(['sessionId', 'childId', 'parentThreadId', 'taskPath']);
const IDENTITY_ROWS = Object.freeze({ delegations: [...DELEGATION_IDENTITY_FIELDS, ...WORKFLOW_IDENTITY_FIELDS],
  sources: SOURCE_IDENTITY_FIELDS });

/** Each text of a ledger beside the same text of its masked copy: `visit(open, shown)` (shown null when the masked copy
 *  holds no text there). A list of texts (an output's lines, a hunk's) is one text, its entries joined by line breaks,
 *  as the evidence adapter stores it. `dropped` (declarations) and identities are not texts a person reads. */
function eachText(open, shown, visit, skip = null) {
  if (typeof open === 'string') { visit(open, typeof shown === 'string' ? shown : null); return; }
  if (Array.isArray(open)) {
    if (open.length && open.every((entry) => typeof entry === 'string')) {
      visit(open.join('\n'), Array.isArray(shown) && shown.every((entry) => typeof entry === 'string')
        ? shown.join('\n') : null);
      return;
    }
    open.forEach((entry, i) => eachText(entry, Array.isArray(shown) ? shown[i] : undefined, visit, skip));
    return;
  }
  if (open === null || typeof open !== 'object') return;
  for (const key of Object.keys(open)) {
    if (key === 'dropped' || key === 'identity' || skip?.includes(key)) continue;
    const next = shown !== null && typeof shown === 'object' ? shown[key] : undefined;
    if (Object.hasOwn(IDENTITY_ROWS, key) && Array.isArray(open[key]))
      open[key].forEach((row, i) =>
        eachText(row, Array.isArray(next) ? next[i] : undefined, visit, IDENTITY_ROWS[key]));
    else eachText(open[key], next, visit);
  }
}

/** Every text of a value, `dropped` and identities aside. */
const textsOf = (value) => {
  const texts = [];
  eachText(value, value, (text) => texts.push(text));
  return texts;
};

const NO_FIELD = Object.freeze({ values: NO_VALUES, whole: false });
/** Longest first, then by code unit: one order for one set of values. */
const longestFirst = (a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0);
/** A session with nothing hidden. */
export const NO_PEOPLE_SECRETS = Object.freeze({ values: NO_VALUES, of: () => NO_FIELD });

/**
 * D84 review (2026-10-13), finding 1 and 2: what this redactor's full walk (masking on) hides in `ledger`, a ledger as
 * `redact(…, { mask: false })` returned it — the one the model reads. Returns `{ values, of }`:
 * - `values`: every value the walk hid that it shows nowhere else in the ledger (as a whole token), longest first — the
 *   session's values, masked in every text written for a person (`maskForPeople(text, values)`);
 * - `of(text)`: what the walk hid in the field whose text is `text` — `{ values, whole }`, `whole` when it withheld the
 *   field whole — or, for a text that is part of a field (an input's part, a native output block, a hunk's line), what
 *   it hid in every field holding it; nothing for a text no field with anything hidden holds.
 * Deterministic: the same ledger, the same answer. Fails closed: when the walk throws, this throws.
 */
export function peopleSecretsOf(ledger) {
  const masked = redactCore(ledger, { mask: true }).ledger;
  const fields = new Map();   // a field's text -> { values: Map(value -> mark), whole }
  const clean = new Set();
  eachText(ledger, masked, (open, shown) => {
    if (open === shown || !open) { clean.add(open); return; }
    const found = hiddenOf(open, shown);
    if (!found.values.size && !found.whole) { clean.add(open); return; }
    const prior = fields.get(open);
    if (prior) found.values = joinMarks([prior.values, found.values]);
    fields.set(open, { values: found.values, whole: found.whole || prior?.whole === true });
  });
  // A value the masked ledger still shows somewhere, whole, is no secret alone: kept only where the walk hid it.
  const shownTexts = textsOf(masked);
  const shownLines = new Set(shownTexts.flatMap((text) => text.split('\n').map((line) => line.trim())));
  const corpus = shownTexts.join('\n');
  const tokens = new Set(corpus.match(/[\p{L}\p{N}_]+/gu) ?? []);
  const shownWhole = (value) => {
    if (shownLines.has(value)) return true;
    const token = value.match(/[\p{L}\p{N}_]+/u)?.[0] ?? null;
    if (token !== null && !tokens.has(token)) return false;
    if (token === value) return true;
    return !wholePlaces(corpus, value).next().done;
  };
  // A field withheld whole hides each of its lines.
  const all = new Map();
  for (const [open, { values, whole }] of fields) {
    for (const [value, mark] of values) if (!all.has(value) || all.get(value) === null) all.set(value, mark);
    if (!whole) continue;
    for (const line of open.split('\n').map((text) => text.trim())) if (line && !all.has(line)) all.set(line, null);
  }
  const values = markedList(new Map([...all].filter(([value]) => valueAlone(value) && !shownWhole(value))));
  const exact = new Map([...fields].map(([open, { values: found, whole }]) =>
    [open, Object.freeze({ values: markedList(found), whole })]));
  const entries = [...exact];
  const memo = new Map();
  const of = (text) => {
    if (typeof text !== 'string' || !text) return NO_FIELD;
    if (exact.has(text)) return exact.get(text);
    if (clean.has(text)) return NO_FIELD;
    if (memo.has(text)) return memo.get(text);
    const holding = entries.filter(([open]) => open.length >= text.length && open.includes(text))
      .map(([, found]) => found);
    const answer = joinHidden(holding);
    if (text.length <= PEOPLE_MEMO_TEXT) memo.set(text, answer);
    return answer;
  };
  return Object.freeze({ values, of });
}

/** Can `value` be a secret alone: is some word of it one the password family could read as a value (S1,
 *  `proxNoValueWord`)? A count, a version, a path, a stop word is not; such a value stays masked only where the walk
 *  hid it (`of`), never in every text. */
const valueAlone = (value) => value.split(/\s+/).some((w) => {
  const core = proxWordCore(w);
  return core !== '' && !proxNoValueWord(w, core);
});
/** Several value-to-mark Maps as one: a value's first known mark. */
const joinMarks = (maps) => {
  const out = new Map();
  for (const map of maps)
    for (const [value, mark] of map) if (!out.has(value) || out.get(value) === null) out.set(value, mark);
  return out;
};
/** What several fields hid, together (`peopleSecretsOf`'s `of` answers): their values, each with its mark; withheld
 *  whole when any one was. */
export function joinHidden(found) {
  const list = found.filter((f) => f && (f.values?.length || f.whole));
  if (!list.length) return NO_FIELD;
  if (list.length === 1) return list[0];
  const marks = joinMarks(list.map((f) => VALUE_MARKS.get(f.values) ?? new Map(f.values.map((v) => [v, null]))));
  return Object.freeze({ values: markedList(marks), whole: list.some((f) => f.whole) });
}

/**
 * D87 (the code pass, owner decisions 2026-10-13/14): what the output rules hide in texts that are no part of the
 * session — the repository's files the code pass showed the model, as they were at review time. Each text is read WHOLE
 * by the one output function's rules (`maskForPeople`: so a line that puts the lines below it in scope, a key name before
 * its value, a PEM block, are read with what they put in scope), and what those rules hid of it — each value that can be
 * a secret alone (`valueAlone`) — is returned as one list with its marks, longest first, like `peopleSecretsOf`'s
 * `values`: what every text written for a person is masked with besides the session's (`joinSecretValues`), so a value
 * the model quotes or restates from a file is masked wherever it stands whole. Deterministic. Fails closed: a text that
 * is not a string, or a scan that cannot run, throws, and the caller writes nothing.
 */
export function peopleSecretsOfTexts(texts) {
  if (!Array.isArray(texts) || texts.some((text) => typeof text !== 'string'))
    throw new TypeError('peopleSecretsOfTexts takes a list of texts');
  const found = new Map();
  const keep = (value, mark) => {
    if (value && valueAlone(value) && (!found.has(value) || found.get(value) === null)) found.set(value, mark);
  };
  for (const text of texts) {
    if (!text) continue;
    const shown = scanForPeople(text);
    if (shown === text) continue;
    for (const [value, mark] of hiddenOf(text, shown).values) {
      keep(value, mark);
      // A hidden value that is a string literal as code writes one — a list or statement separator after it, matching
      // quotes around it (the grammar of a JSON, JavaScript or YAML string) — is also its inside, which is what a
      // reviewer quotes when it restates the value.
      const bare = value.replace(/[,;]$/, '');
      const quoted = /^(["'`])(.*)\1$/s.exec(bare);
      if (quoted) keep(quoted[2], mark);
    }
  }
  return markedList(found);
}

/** D87: several value lists (`peopleSecretsOf(…).values`, `peopleSecretsOfTexts`) as one, each value with its first
 *  known mark, longest first. One list alone is returned as it is, so a review with nothing beside the session's values
 *  masks exactly as before. */
export function joinSecretValues(...lists) {
  const nonEmpty = lists.filter((values) => Array.isArray(values) && values.length);
  if (nonEmpty.length === 0) return lists.find(Array.isArray) ?? NO_VALUES;
  if (nonEmpty.length === 1) return nonEmpty[0];
  return markedList(joinMarks(nonEmpty.map((values) => VALUE_MARKS.get(values)
    ?? new Map(values.map((value) => [value, null])))));
}

const PEOPLE_SECRETS = Symbol('sonah.peopleSecrets');
/** D84 review: keep with `session` (built from `ledger`) what the full walk hides in `ledger`, found on first use. */
export function keepPeopleSecrets(session, ledger) {
  let found = null;
  Object.defineProperty(session, PEOPLE_SECRETS, { value: () => (found ??= peopleSecretsOf(ledger)) });
  return session;
}
/** D84 review: what the full walk hides in the ledger `session` was built from (`keepPeopleSecrets`); nothing for a
 *  session built otherwise. Throws when the walk throws. */
export function peopleSecretsFor(session) {
  const found = session !== null && typeof session === 'object' ? session[PEOPLE_SECRETS] : undefined;
  return typeof found === 'function' ? found() : NO_PEOPLE_SECRETS;
}

/** D71 (g): the field name a project instruction file is scrubbed and declared under (prose, token level). */
export const PROJECT_INSTRUCTIONS_WHERE = 'project instructions';

/**
 * M33 R repair. A change, scrubbed WHOLE by the diff channel's own rules before anything of it is cut: `lines` is every
 * line of the change as a diff shows it (each line of the old text as context or `-`, of the new text as context or
 * `+`), and the result is `{ lines, drops, groups }` — each line as this redactor emits it (null where it is dropped, or
 * joined into the line before it), why each dropped line went, and each declaration as the lines it covers and its
 * reasons. The slicer renders a write's diff from these lines (slicer/src/diff.js): it cuts the change — one line of
 * context around each change, a Write's first 30 lines, the 900/400 budget — only once redaction has seen all of it, so
 * a cut can no longer take away the line that makes the lines below it secret (a YAML block's `key: |`, a PEM block's
 * BEGIN line, the first line of a continued one). Its declarations are carried to `redact`, which makes them (the
 * event's `diffRedaction`). Deterministic: no clock, no model, no network. `mask: false` (D84): every line as given,
 * nothing dropped or declared.
 */
export function scrubDiffWhole(lines, { mask = true } = {}) {
  if (!Array.isArray(lines) || !lines.length) return { lines: [], drops: [], groups: [] };
  const text = lines.map(String);
  if (text.some((line) => line.includes('\n'))) throw new TypeError('scrubDiffWhole takes one line per entry');
  return redactCore({ ask: [], ledger: [] }, { diffLines: text, mask: mask !== false });
}

/** The dropped-lines notes a diff carries for lines dropped for `reasons` (one entry per line): one per reason. */
export function diffDropNotes(reasons) {
  const counts = new Map();
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  return droppedNotes(counts, 'diff line(s)');
}

// ---------------------------------------------------------------------------------------------
// D68 (owner decision 2026-10-07; C-02 "M36 recorded facts"). The recorder's TYPED facts about a call, carried on its
// ledger event as `recorded`, in one closed vocabulary: numbers, booleans and fixed members, and recorder strings that
// pass this redactor (a flagged one is withheld whole, `withheld: true`). Nothing in it is derived from what an output
// or a thought says. The slicer writes it (slicer/src/recorded.js); this redactor validates and scrubs it before
// slice_hash; the adapter re-declares it (evidence/adapters/sonah-ledger.js RECORDED_FACTS) and never imports it.
// ---------------------------------------------------------------------------------------------
export const RECORDED_FACTS = Object.freeze({
  // Every key an event's `recorded` may hold; any other is dropped (fails closed) and `withheld` set.
  keys: Object.freeze(['tool', 'commandClass', 'parsedCmd', 'hunks', 'hunkScrub', 'hunksWithheld', 'writeType', 'prior',
    'patch', 'isError', 'denial', 'interrupted', 'noOutputExpected', 'backgroundTaskId', 'editDiff', 'read', 'search',
    'fetch', 'webSearch', 'unrecordedChange', 'withheld']),
  // M36 phase 3 review (D68 F): Claude Code's typed denial of a call (its result row's `toolDenialKind`), the recorder's
  // own closed vocabulary (slicer events.js `CLAUDE_USER_REFUSAL`): the call was refused, blocked or cancelled, so it
  // never ran — never the agent's failure.
  denial: Object.freeze(['user-rejected', 'permission-rule', 'automode-blocked', 'automode-unavailable',
    'automode-parsing-error', 'interrupted', 'cancelled']),
  // (c5) Codex: a command is `read` only when every entry of the recorder's parsed command is a read.
  commandClass: Object.freeze(['read', 'command']),
  parsedCmdTypes: Object.freeze(['read', 'search', 'list_files', 'unknown']),
  // (c2) what a change's hunks were scrubbed with: the whole recorded file, or the change alone (no file context).
  hunkScrub: Object.freeze(['file', 'change']),
  // D68 (R): why a change's recorded hunks are not carried at all (no line of them, scrubbed or not): the file is
  // credential-shaped (slicer before.js `CREDENTIAL_PATH`) or (D69 b) in a harness home folder of the recording's user
  // (`harnessHomePath`: `~/.claude`, `~/.codex`, outside a worktree), withheld whole as its observations and prior state
  // are. `harness_files` is M36's wider rule (every `.claude` directory): recognised in a ledger an earlier slicer wrote,
  // never produced.
  hunksWithheld: Object.freeze(['credential_path', 'harness_home', 'harness_files']),
  // The recorder's typed kind of a whole-file write: Claude Code's Write `create` (the file was not there: the recorder
  // checked) or `update`; a Codex `add` (an apply_patch `*** Add File`, a FileChange `add`: written whether or not the
  // file was there, so its prior state is `unrecorded`).
  writeType: Object.freeze(['create', 'update', 'add']),
  // (c1) the file before a write, as the record holds it: whole (`file`), only as the recorder's hunks (`hunks`), the
  // recorder says there was none (`absent`: a create, an add), or not recorded at all (`unrecorded`: a shell write…).
  prior: Object.freeze(['file', 'hunks', 'absent', 'unrecorded']),
  // What the record holds of the change itself: line-numbered hunks, the call's own old/new strings, a whole written
  // body, or nothing (a shell write the slicer inferred from its command).
  patch: Object.freeze(['hunks', 'strings', 'body', 'none']),
  searchModes: Object.freeze(['content', 'files_with_matches', 'count']),
  read: Object.freeze(['startLine', 'numLines', 'totalLines']),
  search: Object.freeze(['mode', 'numFiles', 'numLines', 'numMatches', 'totalMatches', 'truncated']),
  fetch: Object.freeze(['url', 'code', 'bytes']),
  webSearch: Object.freeze(['query', 'results']),
  editDiff: Object.freeze(['files', 'changedFiles', 'moreFiles', 'shared', 'unavailable']),
  editDiffFile: Object.freeze(['path', 'created', 'deleted', 'hunks', 'hunkScrub', 'hunksWithheld']),
  // A hand-off's (Claude Code Agent) typed result: on its delegation receipt.
  agent: Object.freeze(['tool', 'status', 'totalToolUseCount', 'withheld']),
});
/**
 * D69 review (C-02 "M36 recorded facts"): a recorder string carried as a fact — a tool name, a path, a
 * URL, a query, a parsed command's name, a background task id, an Agent hand-off's typed status — is any non-empty
 * string this redactor does not flag (a flagged one is withheld whole, `withheld: true`, never masked into a fact). The
 * bounds that also held them (`RECORDED_FACT_LIMITS`: a tool name of at most 512 characters, any other string of at most
 * 4,096, a task id of a guessed identifier shape, a status of `[a-z_]{1,40}`) are deleted: none
 * of them changed a recording, several bound text the agent produced (a WebSearch query, a WebFetch URL: D68 E keeps
 * produced text whole), and the shapes guessed identifiers no recorder documents. A non-string, or an empty one, is not
 * carried and the facts say so (`withheld`), as before.
 */
const recorderString = (value) => typeof value === 'string' && value.length > 0;
/** The mask a hunk line redaction dropped is shown as, after its own marker: one per physical line (C-02 M36). */
export const HUNK_LINE_MASK = '‹dropped›';
const HUNK_MARKERS = new Set([' ', '-', '+']);
const PEM_BOUNDARY = /-----(BEGIN|END) [A-Z0-9 ]*-----/;
const plainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
/** One recorded hunk, as the recorder wrote it: `{oldStart, oldLines, newStart, newLines, lines}`, every line one
 *  physical line with its marker (or a `\` no-newline line, or the empty line some writers leave for an empty context
 *  line). Anything else is not a hunk this redactor reads. */
const hunkShape = (h) => plainObject(h) && Object.keys(h).length === 5
  && ['oldStart', 'oldLines', 'newStart', 'newLines'].every((key) => isCount(h[key]))
  && Array.isArray(h.lines)
  && h.lines.every((line) => typeof line === 'string' && !line.includes('\n')
    && (line === '' || HUNK_MARKERS.has(line[0]) || line[0] === '\\'));
const markerOf = (line) => (line === '' ? ' ' : line[0]);

/**
 * D68 (c2) (owner decision 2026-10-07; C-02 "M36 recorded facts"). A change's RECORDED hunks — Claude Code's
 * `structuredPatch`, a Codex FileChange `unified_diff`, a Claude Code `bashEditDiff` file — scrubbed by the diff
 * channel's own rules (`scrubDiffWhole`) before slice_hash. With the whole recorded file (`file`: Claude Code's
 * `originalFile`, when the hunks apply to it line for line) the hunks are placed in it, every other line of it as
 * context, so a key block or a secret-named YAML block that opens above a hunk is judged with its opening line
 * (`scrub: 'file'`). Otherwise all hunks are scrubbed as ONE change with `@@` between them (`scrub: 'change'`: declared
 * scrubbed without whole-file context), and a key-block boundary left open on either side fails closed: every line of
 * the change is masked. Line numbers are the recorder's, so the line count is kept: a line redaction dropped, or joined
 * into another, is shown as its marker and `HUNK_LINE_MASK`, one mask per physical line. A `\` no-newline line is the
 * recorder's own and kept. Returns `{ hunks, scrub, reasons, lost }`, or null for a shape this reads nothing of (the
 * caller keeps no hunk). Deterministic: no clock, no model, no network. `mask: false` (D84): the same shape check,
 * every line as recorded, `scrub` null (nothing was scrubbed), nothing declared.
 */
export function scrubHunks(hunks, file = null, { mask = true } = {}) {
  if (!Array.isArray(hunks) || !hunks.length || !hunks.every(hunkShape)) return null;
  if (mask === false) return { hunks: hunks.map((h) => ({ oldStart: h.oldStart, oldLines: h.oldLines,
    newStart: h.newStart, newLines: h.newLines, lines: [...h.lines] })), scrub: null, reasons: [], lost: false };
  const placed = typeof file === 'string' ? placeInFile(hunks, file) : null;
  let lines;
  let at;                                  // at[h][j]: the index in `lines` of hunk h's line j (-1 for a `\` line)
  let failClosed = false;
  if (placed) ({ lines, at } = placed);
  else {
    lines = [];
    at = hunks.map((h, i) => {
      if (i) lines.push('@@');
      return h.lines.map((line) => {
        if (line[0] === '\\') { lines.push('@@'); return -1; }
        lines.push(line === '' ? ' ' : line);
        return lines.length - 1;
      });
    });
    // A key-block boundary left open on either side of a change seen without its file fails closed.
    for (const side of ['-', '+']) {
      let open = 0;
      for (const line of lines) {
        const m = (line[0] === ' ' || line[0] === side) ? PEM_BOUNDARY.exec(line) : null;
        if (!m) continue;
        if (m[1] === 'BEGIN') { if (open) failClosed = true; open = 1; }
        else if (open) open = 0; else failClosed = true;
      }
      if (open) failClosed = true;
    }
  }
  const whole = failClosed ? null : scrubDiffWhole(lines);
  const reasons = [];
  let lost = false;
  const shown = new Set(at.flat().filter((k) => k >= 0));
  if (whole) for (const g of whole.groups) if (g.at.some((k) => shown.has(k))) for (const r of g.reasons) reasons.push(r);
  const out = hunks.map((h, i) => ({ oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines.map((line, j) => {
      const k = at[i][j];
      if (k < 0) return line;
      const marker = markerOf(line);
      const kept = whole ? whole.lines[k] : null;
      if (typeof kept === 'string' && kept[0] === marker && !kept.includes('\n')) {
        // The empty line the recorder wrote for an empty context line stays as it was.
        return line === '' && kept === ' ' ? '' : kept;
      }
      lost = true;
      if (!whole) reasons.push(PEM_DROP);
      else if (whole.drops[k]) reasons.push(whole.drops[k]);
      return `${marker}${HUNK_LINE_MASK}`;
    }) }));
  return { hunks: out, scrub: placed ? 'file' : 'change',
    reasons: [...new Set(reasons)].filter((reason) => REDACTION_REASONS.includes(reason)), lost };
}

/** The hunks placed in the whole file they were recorded against: every line of `file` a context line except where a
 *  hunk stands, each hunk's context and removed lines checked against the file line for line (exact strings). Null when
 *  any hunk is out of order, overlaps, or does not match: then the file is not the one the hunks were made on. */
function placeInFile(hunks, file) {
  const old = file.split('\n');
  const lines = [];
  const at = [];
  let cursor = 0;
  for (const h of hunks) {
    // A hunk that removes nothing names the line it follows (its start is that line's number); else its first line.
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    if (start < cursor || start > old.length) return null;
    for (; cursor < start; cursor++) lines.push(` ${old[cursor]}`);
    const mine = [];
    for (const line of h.lines) {
      if (line[0] === '\\') { mine.push(-1); continue; }
      if (markerOf(line) !== '+') {
        if (cursor >= old.length || old[cursor] !== line.slice(1)) return null;
        cursor++;
      }
      lines.push(line === '' ? ' ' : line);
      mine.push(lines.length - 1);
    }
    at.push(mine);
  }
  for (; cursor < old.length; cursor++) lines.push(` ${old[cursor]}`);
  return { lines, at };
}

function redactCore(ledger, internal = null) {
  const dropped = [...(ledger.dropped ?? [])];
  const out = structuredClone(ledger);
  // D84: with `mask` false each scanning primitive below (`scrubField`, `scrubLines`, `scrubTail`, `scrubDiff`,
  // `firstFlaggedView`, `inherit`, `inheritLines`, `jsonViewsClean`, the recorded hunks' `scrubHunks`) returns its
  // input as clean, so every field keeps its recorded text; the bounds, the closed vocabularies and the shape checks
  // are the walk's own and run unchanged.
  const mask = internal?.mask !== false;

  // `trace` (W3e-1 / F186, W3e-3 / F197), when given, receives what this scan found instead of
  // `dropped`: one finding per declaration it would have made — `{ entry, start, end }` for a region
  // of `s` it replaced, `{ entry, token }` for an unclassified token a prose field replaced by value,
  // `{ entry, drop: true }` when it drops the whole line. The output is identical either way; the
  // one scanning rule (`settle`, below) scans one text in several views and compares them.
  // The prose fields: the human's ask and the agent's own words (see the fail-closed step below).
  // D71 (g): a project instruction file the harness gave the agent is prose a person wrote, scrubbed like the human's
  // words (token level, fail closed).
  const isTokenLevel = (where) => where === 'ask' || where === 'claim' || where === 'saying' || where === 'commentary'
    || where === 'parent agent instruction' || where === 'child instruction' || where === PROJECT_INSTRUCTIONS_WHERE;
  /** How far a key-name shape's value runs in field `where` (`secretNamedValues`). */
  const modeOf = (where) => (where === 'cmd' ? 'shell' : isTokenLevel(where) ? 'prose' : 'data');

  /**
   * Every region the layers before P find in `s` (steps 1-6 of `scrub`), not yet merged or declared. M33 R repair 8: a
   * function of its own so that `maskBlocks` can read what they would mask on a line before P masks a value there that
   * only the line above puts in scope — their bytes and labels stand (P never reads inside them).
   */
  const priorRegions = (s, where) => {
    // Collect regions from every layer, then merge and replace once. Regions carry their own
    // replacement text and reason; on overlap the earlier/larger region wins (same ordering as
    // entireio/cli redact/redact.go applyRegions).
    const regions = [];

    // 1. Known secret shapes.
    for (const [re, label] of PATTERNS) {
      for (const m of s.matchAll(re)) {
        const r = repairEscapeStart(s, m.index, m.index + m[0].length, re);
        if (!r) continue;
        regions.push({ ...r, repl: `‹redacted:${label}›`, reason: `redacted:${label}` });
      }
    }

    // 2. Connection strings (pattern proposes, password gate disposes).
    if (s.includes('=')) {
      for (const [re, gate, label, maxLen] of CONNECTION_STRING_RULES) {
        if (s.length > maxLen) continue;
        for (const m of s.matchAll(re)) {
          const r = repairEscapeStart(s, m.index, m.index + m[0].length, re);
          if (!r) continue;
          const end = trimConnectionStringEnd(s, r.start, r.end);
          if (r.start >= end) continue;
          if (!gate(s.slice(r.start, end))) continue;
          regions.push({ start: r.start, end, repl: `‹redacted:${label}›`, reason: `redacted:${label}` });
        }
      }

      // 3. Bounded credential key/values (DB_PASSWORD=...). Region covers the value only, so the
      // key and any quotes stay readable: PGPASSWORD='‹redacted:db-credential›'. A boolean is not a
      // credential (W3e-7 / F224: W3e-5's rule, `BOOLEAN_VALUE`, on the value inside its quotes).
      for (const m of s.matchAll(CREDENTIAL_VALUE_RE)) {
        let [vs, ve] = m.indices[2];
        if (ve - vs >= 2) {
          const a = s[vs], b = s[ve - 1];
          if ((a === '"' && b === '"') || (a === "'" && b === "'")) { vs++; ve--; }
        }
        if (vs >= ve || portedKept(s.slice(vs, ve))) continue;
        regions.push({ start: vs, end: ve, repl: '‹redacted:db-credential›', reason: DB_CREDENTIAL });
      }

      // 4. Generic password assignment. The capture is greedy on purpose; the placeholder check
      // runs on the exact whole capture (never a prefix), so a placeholder head cannot shield a
      // secret tail. So does the boolean check (W3e-7 / F224): `password=true` is kept,
      // `password=true,hunter2` is not.
      for (const m of s.matchAll(GENERIC_PASSWORD_RE)) {
        let [vs, ve] = m.indices[1];
        if (ve - vs >= 2) {
          const a = s[vs], b = s[ve - 1];
          if ((a === '"' && b === '"') || (a === "'" && b === "'")) { vs++; ve--; }
        }
        if (vs >= ve || portedKept(s.slice(vs, ve))) continue;
        regions.push({ start: vs, end: ve, repl: '‹redacted:password-assignment›', reason: PASSWORD_ASSIGNMENT });
      }
    }

    // 5. Named assignment shapes (TOKEN=..., "api_key": "..."). Outside the '=' guard: the
    // separator may be ':' alone.
    for (const m of s.matchAll(ASSIGNED)) {
      if (!SECRET_NAME.test(m[1])) continue;
      if (isPlaceholderSecretValue(m[2])) continue;
      // W3e-5 / F211: not when every secret word of the name is inside an ordinary word
      // (`TOKENIZER_PATH=…`), nor for a value provably not a credential for it (a count).
      const cls = nameClass(m[1], SECRET_NAME_WORDS);
      if (!cls || keptValue(cls, m[2])) continue;
      const [vs, ve] = m.indices[2];
      regions.push({ start: vs, end: ve, repl: '‹redacted›', reason: ASSIGNED_SECRET });
    }

    // 6. The key-name rule, in every field (W3e-4 / F201): a value assigned to a secret-named key,
    // whatever it looks like — `export API_TOKEN=…`, `--password …`, `-u user:…`, an auth header.
    // Pushed last, so where a named pattern above covers the same value its label is kept. A YAML
    // block's region carries its own replacement: its lines, each masked where it stands (W3e-5).
    for (const r of secretNamedValues(s, modeOf(where)))
      regions.push({ start: r.start, end: r.end, repl: r.repl ?? SECRET_VALUE_MARKER, reason: SECRET_VALUE });
    return regions;
  };

  /**
   * M33 R repair 9: `scrub` of a short text is a function of the text and the field's class alone, and a field's lines
   * repeat (blank lines, braces, a log's lines, every view of every line of a field scanned in several views): each short
   * text is scanned once per call of `redact` and its result, and what it declared, replayed. The output and the
   * declarations are exactly the scan's. Bounded: texts of at most 256 characters, 16,384 of them.
   */
  const scrubMemo = new Map();
  const scrub = (s, turn, where, trace = null) => {
    if (typeof s !== 'string' || !s) return s;
    if (s.length > SCRUB_MEMO_TEXT) return scrubOnce(s, turn, where, trace);
    const key = `${modeOf(where)}\u0000${where}\u0000${s}`;
    let hit = scrubMemo.get(key);
    if (!hit) {
      const found = [];
      const out = scrubOnce(s, turn, where, { findings: found });
      hit = { out, found: found.map(({ entry, ...rest }) => ({ reason: entry.reason, rest })) };
      if (scrubMemo.size < SCRUB_MEMO_SIZE) scrubMemo.set(key, hit);
    }
    for (const { reason, rest } of hit.found) {
      const entry = { turn, reason, where };
      if (trace) trace.findings.push({ entry, ...rest }); else dropped.push(entry);
    }
    return hit.out;
  };
  const scrubOnce = (s, turn, where, trace = null) => {
    const declare = trace ? (entry, found) => trace.findings.push({ entry, ...found }) : (entry) => dropped.push(entry);
    const tokenLevel = isTokenLevel(where);
    const regions = priorRegions(s, where);

    // 7. M33 R repair 8, P: the proximity rule, over what every layer above left (`proximityValues`). Declared under the
    // key-name rule's reason; BENIGN is never consulted for what it masks.
    for (const r of proximityValues(s, modeOf(where), regions))
      regions.push({ start: r.start, end: r.end, repl: SECRET_VALUE_MARKER, reason: SECRET_VALUE });

    let t = s;
    if (regions.length > 0) {
      regions.sort((a, b) => (a.start - b.start) || (b.end - a.end));
      const merged = [regions[0]];
      for (const r of regions.slice(1)) {
        const last = merged[merged.length - 1];
        if (r.start <= last.end) { if (r.end > last.end) last.end = r.end; } // first region keeps its label
        else merged.push(r);
      }
      let b = '';
      let prev = 0;
      for (const r of merged) {
        b += s.slice(prev, r.start) + r.repl;
        prev = r.end;
        declare({ turn, reason: r.reason, where }, { start: r.start, end: r.end });
      }
      t = b + s.slice(prev);
    }

    // Fail closed: an unclassifiable high-entropy run means we do not understand this TOKEN.
    // Command fields drop the whole line (an over-drop costs one row). Prose fields — the ask,
    // the claim, mid-session sayings — drop the token and keep the line: dropping a whole ask
    // drops the CONTRACT, and every write the agent then made looks unrequested (D32). The
    // unclassified token is removed either way; the rest of the line has already passed every named pattern and the
    // per-token entropy floor, so token-level loses no coverage.
    let kept = t;
    // EVERY channel narrows BENIGN: a base64 run of 40+ chars is a secret until proven otherwise
    // (a Kubernetes Secret value, a PEM body line). This was once limited to `diff`/`before`,
    // which meant the same key body sailed through `ask`, `cmd`, `tailLines` and `argsExcerpt`
    // on the base64 exemption — a PEM body line seen without its header is just base64 (H41).
    // `path` is the only channel not narrowed, and it never reaches scrub() at all: a filename
    // is not a credential. Redaction fails closed; the cost is an occasional dropped row, and
    // the drop is declared.
    const contentField = where !== 'path';
    /** The floor's test of one token: long enough, not a BENIGN shape (base64 narrowed in content fields), dense enough. */
    const failsFloor = (tok) => tok.length >= ENTROPY_LEN
      && !(BENIGN.some((re) => re.test(tok)) && !(contentField && /^[A-Za-z0-9+/]{40,}={0,2}$/.test(tok)))
      && entropy(tok) >= ENTROPY_MIN;
    for (const raw of t.split(/[\s,"'`()[\]{}]+/)) {
      // A token glued to a ‹redacted:…› marker (key:secret pairs) is tested by its remaining
      // sub-tokens — the marker is an exact-match exemption, never a shield for what touches it.
      // M33 R repair 4: a token holding a whole canonical UUID is tested whole, in every reading of it without its
      // UUIDs (`UUID_SPLIT`, `uuidReadingsFail`, above); when it fails, the whole token goes, its UUIDs too.
      for (const marked of raw.split(/‹[^›]*›/)) {
        if (marked.length < ENTROPY_LEN) continue;
        if (!uuidReadingsFail(marked, failsFloor)) continue;
        const entry = { turn, reason: tokenLevel ? ENTROPY_TOKEN_DROP : ENTROPY_DROP, where };
        if (!tokenLevel) { declare(entry, { drop: true }); return null; } // caller drops the whole line
        declare(entry, { token: marked });
        kept = kept.split(marked).join(DROPPED_TOKEN_MARKER);
      }
    }
    return kept;
  };

  /**
   * M33 R repair 9, S1: one value field of an event its naming texts put in scope (`proximityEventScope`), already
   * scrubbed — `text` masked where `proximityInherited` says, each line it changes declared once under the key-name rule's
   * reason. `header`: a command's output (read after the recorder's header).
   */
  const inherit = (text, scope, turn, where, header = false) => {
    if (!mask || !scope || typeof text !== 'string' || !text) return text;
    const regions = proximityInherited(text, { all: scope.all, password: scope.password, header, diff: where === 'diff' });
    if (!regions.length) return text;
    regions.sort((a, b) => a.start - b.start || b.end - a.end);
    let out = '', prev = 0;
    const touched = new Set();
    for (const r of regions) {
      if (r.start < prev) { if (r.end <= prev) continue; r.start = prev; }
      out += text.slice(prev, r.start) + SECRET_VALUE_MARKER;
      prev = r.end;
      touched.add(text.lastIndexOf('\n', r.start - 1));
    }
    for (let k = 0; k < touched.size; k++) dropped.push({ turn, reason: SECRET_VALUE, where });
    return out + text.slice(prev);
  };
  /** S1 over an output's entries (`tailLines`): each entry a line. */
  const inheritLines = (entries, scope, turn, where) => {
    if (!mask || !scope || !Array.isArray(entries) || !entries.length) return entries;
    const text = entries.map((entry) => (typeof entry === 'string' ? entry : '')).join('\n');
    const masked = inherit(text, { ...scope, all: scope.allOutput }, turn, where, true);
    if (masked === text) return entries;
    const lines = masked.split('\n');
    if (lines.length !== entries.length) return entries.map((entry, i) => (typeof entry === 'string' ? inherit(entry, scope, turn, where, false) : entry));
    return entries.map((entry, i) => (typeof entry === 'string' ? lines[i] : entry));
  };

  // The per-line rules of multi-line content fields (`scrubLines`, below).
  // The vocabulary is SECRET_KEY_NAMES (one place, W3e-4); this regex is byte-for-byte what it was.
  const SECRET_KEY = new RegExp(`^\\s*(?:export\\s+)?[\\w.-]*(?:${SECRET_KEY_NAMES})[\\w.-]*\\s*[:=]\\s*(?!\\$\\{|\\$\\w|<|\\*{3}|xxx|\\.\\.\\.)(\\S.*)$`, 'i');
  // The name SECRET_KEY matched: everything its `[\w.-]*…[\w.-]*` covered (W3e-5 / F211).
  const CONTENT_KEY_NAME = /^\s*(?:export\s+)?([\w.-]*)/i;
  const PEM_BEGIN = /^-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE|OPENSSH PRIVATE KEY)-----/;
  const PEM_END = /^-----END /;
  // A unified-diff hunk line carries a marker. Content fields carry none, so `/^/` captures ''.
  const HUNK_MARKER = /^[+\- ]/;
  const NO_MARKER = /^/;
  // W3e-7 / F219: a content field may hold a diff (a patch a body writes, a diff a saying pastes). Its
  // `+` lines are read behind the `+` as the diff field reads them: SECRET_KEY's `^\s*` already takes a
  // blank and its `[\w.-]*` a `-`, never a `+`, so `+2FA_SECRET=…` in a body was masked by no layer.
  const ADDED_LINE = /^\+/;
  // The recorder's own lines, re-declared, never imported: this package imports nothing.
  //   STUB_LINE      — the head-truncation stub, written on a line of its own by an earlier Sonah: this
  //                    module's own cap of a body it scrubbed (M33 R to D68), the slicer's memory bound
  //                    (M33 R to D68), or an older slicer's cut. Nothing writes it since D68 (E); it is
  //                    recognised in a persisted ledger. redact/test/stub-continuation.test.js pins that
  //                    every such stub is recognised here.
  //   SEPARATOR_LINE — the marker between an Edit's segments (slicer/src/events.js ARG_SEP,
  //                    `\n⟪→⟫\n`): a line of its own, never the field's first or last.
  const STUB_LINE = /^\[… truncated at \d+ chars …\]/;
  const SEPARATOR_LINE = '⟪→⟫';
  // A backslash, the newline after it and all the whitespace that follows: the shell's (and
  // make's, and C's) line continuation. The scan joins across it; the output keeps it (F186).
  // M33 R repair 3: the newline is LF or CRLF — a CRLF file's continued line is one logical line too
  // (the slicer's `continuationBefore`/`logicalLineEnd` read it the same way).
  // M33 R repair 5: LF after any run of CR — a CRLF file captured through a pseudo-terminal ends its lines `\r\r\n`, and
  // its `KEY=\` + `\r\r\n` + value went with no key. A CR with no LF after its run is still no line break.
  const CONTINUATION = /\\\r*\n\s*/g;
  // M33 R repair 3: the same continuation inside JSON-escaped text — a write's arguments serialized as JSON (a
  // MultiEdit's `edits`), a JSON document a command prints: an escaped backslash, an escaped line break (`\n` or
  // `\r\n`), and the whitespace after it, escaped or not. There `KEY=\` + line break + `  value` reads
  // `KEY=\\\n  value`, and the value rules, which never look past the escaped line break, kept the value. The whole
  // field is also scanned with these joined (`fieldViews`), so the value goes with its key.
  // M33 R repair 4: escaped once or twice — a JSON file's text inside JSON arguments (a MultiEdit of package.json)
  // reads `\\\\\\r\\n` for `\\\r\n`: the line break's `\` may be doubled too. And every line-structured field (a
  // body, a saying, the claim, `tailLines`, the diff) scans a line that holds one joined across it as well
  // (`escapedView`): a JSON file's `KEY=\\\n  value` is one physical line there, and its value went with no key.
  // M33 R repair 5: escaped any number of times, and with any run of escaped carriage returns. Escaped three times (a
  // JSON text in a JSON text in JSON arguments) the `\` reads as eight backslashes and its line break's escape as four
  // more: the old pattern took only those four and left the eight between the two halves of a token, so the join never
  // assembled it. A continuation is now read by `escapedContinuations` (a module function), a linear scan, not a
  // pattern: a pattern taking runs of any length, each of which may be cut short, backtracks without bound on a long
  // run (a trial one took minutes on a megabyte of backslashes).
  const hasEscapedContinuation = (text) => text.includes('\\\\\\') && escapedContinuations(text, true).length > 0;

  /**
   * One line of a PEM block? The raw line is tested before the marker-stripped one, because
   * `-----BEGIN` itself starts with `-`: stripping a marker first would eat one of the five dashes
   * and never match.
   */
  const isPemLine = (re, line, marker) => {
    const s = typeof line === 'string' ? line : String(line ?? '');
    return re.test(s) || re.test(s.replace(marker, ''));
  };

  /**
   * The key-block state machine, one logical line at a time, for EVERY field. A block is one secret
   * spanning lines: dropped whole (audit H41: masking the header alone let the base64 body — which
   * IS the key — through). Returns whether a block is open after `group`, marks the group `pem`,
   * and declares each block once.
   *
   * W3e-3 / F197: a block begins at the first sign of one — the joined line or any physical line of
   * it — and ends only where the joined line AND a physical line both end one. Neither view can
   * close a block the other still sees, so this drops at least what the physical-line machine
   * (every field but the content fields) and the joined-line one (`scrubLines`) each dropped.
   */
  const pemStep = (group, open, turn, where, declare = true) => {
    const anyLine = (re) => group.physical.some((line) => isPemLine(re, line, HUNK_MARKER));
    if (open) {
      group.pem = true;
      return !(isPemLine(PEM_END, group.joined, HUNK_MARKER) && anyLine(PEM_END));
    }
    if (!isPemLine(PEM_BEGIN, group.joined, HUNK_MARKER) && !anyLine(PEM_BEGIN)) return false;
    group.pem = true;
    if (declare) dropped.push({ turn, reason: PEM_DROP, where });
    return true;
  };

  /** The same machine over physical lines only — a diff's, whose lines each carry a hunk marker and
   *  whose continued lines are joined per side (`scrubDiff`). Returns the surviving lines. `track`
   *  (M33 R repair, `scrubDiffWhole`), when given, receives where each surviving line stood in `lines`
   *  (`index`) and each block dropped: the lines it held and what it declared (`blocks`).
   *
   *  M33 R repair 2: one machine per side, as the diff's YAML blocks and continued lines already are. A
   *  diff shows two texts: the old one (context and `-` lines) and the new one (context and `+` lines);
   *  a line of neither (`…`, a hunk header, a note) is a line of both. Run over the two interleaved, a
   *  removed END line closed a block the new text still held open (BEGIN common, END changed), and the
   *  added body lines after it were kept. Now a line is dropped when either side holds it inside a
   *  block; blocks the two sides share lines of are one block, declared once, in the order they start. */
  const dropPemBlocks = (lines, turn, where, track = null) => {
    const spans = [];
    for (const side of ['-', '+']) {
      let open = false;
      lines.forEach((line, i) => {
        const marker = line[0];
        if ((marker === '-' || marker === '+') && marker !== side) return;
        const group = { physical: [line], joined: line };
        const wasOpen = open;
        open = pemStep(group, open, turn, where, false);
        if (!group.pem) return;
        if (!wasOpen) spans.push([]);
        spans[spans.length - 1].push(i);
      });
    }
    const owner = new Map();
    const blocks = [];
    for (const span of spans) {
      const met = [...new Set(span.map((i) => owner.get(i)).filter(Boolean))];
      const block = met[0] ?? { at: new Set(), live: true };
      if (!met.length) blocks.push(block);
      for (const other of met.slice(1)) {
        other.live = false;
        for (const i of other.at) { block.at.add(i); owner.set(i, block); }
      }
      for (const i of span) { block.at.add(i); owner.set(i, block); }
    }
    const merged = blocks.filter((block) => block.live).map((block) => [...block.at].sort((a, b) => a - b))
      .sort((a, b) => a[0] - b[0]);
    for (const at of merged) {
      const entry = { turn, reason: PEM_DROP, where };
      dropped.push(entry);
      track?.blocks.push({ at, entries: [entry] });
    }
    const kept = [];
    lines.forEach((line, i) => { if (!owner.has(i)) { kept.push(line); track?.index.push(i); } });
    return kept;
  };

  /**
   * W3e-5 / F210, shape B, for the fields scanned a line at a time (`scrubLines`, `tailLines`, each
   * side of a diff): no line scan sees the key a block's lines belong to, so the block is found over
   * the lines first. Each line it holds keeps its indentation (and `strip` leading characters, a hunk
   * marker — or, W3e-7, the marker a block found behind one carries) and loses its text; the block is
   * declared once. Returns the lines, masked, and the
   * indices masked (`at`, for the diff's two sides); the same array when no block is found.
   */
  const maskBlocks = (lines, turn, where, strip = 0, declare = true) => {
    const blocks = secretBlocks(lines, strip);
    const out = [...lines];
    const at = [];
    for (const [, first, last, lead] of blocks) {
      for (let k = first; k <= last; k++) { out[k] = maskedBlockLine(lines[k], lead); at.push(k); }
      if (declare) dropped.push({ turn, reason: SECRET_VALUE, where });
    }
    // M33 R repair 8, P across lines (`proximityAcross`): a value only the line above it puts in scope — the 2 non-blank
    // lines after a label line, a password's value below its label — masked where it stands, after the blocks (a line a
    // block masked holds only markers), around what the older layers mask on its line (`priorRegions`). Each line is
    // declared once, and reported with the blocks as `[key, line, line, strip]`.
    const across = proximityAcross(out, strip, (i) => priorRegions(out[i], where));
    // M33 brittleness M7: what a command line feeds to a stdin that reads a secret, on the lines below it.
    for (const c of proximityStdinAcross(out, strip, (i) => priorRegions(out[i], where))) across.push(c);
    if (!blocks.length && !across.length) return { lines, at: [] };
    const byLine = new Map();
    for (const c of across) { if (!byLine.has(c.line)) byLine.set(c.line, []); byLine.get(c.line).push(c); }
    const marked = [];
    const held = new Set(at);
    for (const [k, list] of byLine) {
      // The values one line holds, merged where they meet (a token and a password's value may overlap), then replaced
      // from the last.
      list.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const c of list) {
        const last = merged[merged.length - 1];
        if (last && c.start <= last.end) last.end = Math.max(last.end, c.end);
        else merged.push({ ...c });
      }
      let line = out[k];
      for (const c of merged.reverse()) line = line.slice(0, c.start) + SECRET_VALUE_MARKER + line.slice(c.end);
      out[k] = line;
      if (!held.has(k)) { held.add(k); at.push(k); }
      marked.push([list[0].key, k, k, strip]);
      if (declare) dropped.push({ turn, reason: SECRET_VALUE, where });
    }
    return { lines: out, at, blocks: [...blocks, ...marked] };
  };

  /**
   * `KEY = value` with a secret-named key: the whole value goes, whatever its length or charset.
   * SECRET_KEY is `^`-anchored, so on a diff it has to be matched against the line's CONTENT and
   * the `+`/`-`/space marker re-attached to the masked result — otherwise the identical .env line
   * was masked as a pre-edit snapshot and kept verbatim as a hunk line (audit M85).
   * Returns the masked line, or null when the rule does not apply. `trace` as for `scrub`.
   */
  const maskSecretKey = (line, turn, where, marker = NO_MARKER, trace = null) => {
    const lead = line.match(marker)?.[0] ?? '';
    const body = line.slice(lead.length);
    const kv = body.match(SECRET_KEY);
    if (!kv) return null;
    const value = kv[1];
    // W3e-8: an empty quoted value (`password = ""`) holds nothing, as an empty value does; nor does a
    // value that is only this stage's own markers (f(f(x)) === f(x): a value another layer masked first,
    // `DB_PASSWORD=${…:-…}` in a body, was re-labelled by this rule on a second pass).
    const bare = unquote(value.trim());
    if (isKeyValuePlaceholder(value) || !bare.trim() || MARKERS_ONLY.test(bare.trim())) return null;
    // A YAML block scalar's header is not the value: the lines below it are (`maskBlocks`, W3e-5).
    if (BLOCK_INDICATOR.test(value)) return null;
    // W3e-5 / F211: the name's secret word is part of an ordinary word (`author: …`), or the value is
    // provably not a credential for it (`TOKENIZERS_PARALLELISM=false`, `max_tokens: 4096`). The
    // shell's working directories and a digest name stay masked here, as they always have. W3e-8 /
    // F235: judged inside its quotes too, as every other layer judges it — `password: "true"` was
    // masked here and kept in every other field.
    const cls = nameClass(CONTENT_KEY_NAME.exec(body)[1]);
    if (!cls || keptValue(cls, value.trim()) || keptValue(cls, bare)) return null;
    const entry = { turn, reason: SECRET_VALUE, where };
    if (trace) trace.findings.push({ entry, start: line.length - value.length, end: line.length });
    else dropped.push(entry);
    return lead + body.slice(0, body.length - value.length) + '‹redacted:secret-value›';
  };

  /** One line through the per-line rules, in the order they have always run here: a secret-named
   *  key first (it takes the rest of the line), every layer of `scrub` otherwise. */
  const scanLine = (line, turn, where, trace = null, marker = ADDED_LINE) => {
    const masked = maskSecretKey(line, turn, where, marker, trace);
    return masked !== null ? masked : scrub(line, turn, where, trace);
  };
  /** A diff line: matched on its content, its `+`/`-`/space marker kept (M85). */
  const scanHunkLine = (line, turn, where, trace = null) => scanLine(line, turn, where, trace, HUNK_MARKER);

  /**
   * The logical lines of a run of physical lines: the physical lines CONTINUATION joins, as
   * `{ physical, joined, first }` (`first`: its first physical line's index in `lines`). A logical
   * line of more than one physical line also carries `offsets` (where each physical line starts in
   * `physical.join('\n')`), `at` (for each character of that text, its index in `joined`, or -1
   * where the join removed it) and `src` (for each character of `joined`, its index in that text).
   * `joined` is exactly what `text.replace(CONTINUATION, '')` has always produced for that line.
   */
  const logicalLines = (lines) => {
    const text = lines.join('\n');
    const removed = new Uint8Array(text.length);
    let continued = false;
    for (const m of text.matchAll(CONTINUATION)) { removed.fill(1, m.index, m.index + m[0].length); continued = true; }
    if (!continued) return lines.map((line, i) => ({ physical: [line], joined: line, first: i }));
    const groups = [];
    let first = 0;    // the logical line's first physical line
    let start = 0;    // where it starts in `text`
    let offset = 0;   // where physical line i starts in `text`
    for (let i = 0; i < lines.length; i++) {
      const end = offset + lines[i].length;   // the newline after line i, or the end of `text`
      offset = end + 1;
      if (end < text.length && removed[end]) continue;   // a continued newline: the line goes on
      const physical = lines.slice(first, i + 1);
      if (physical.length === 1) groups.push({ physical, joined: physical[0], first });
      else {
        const at = new Int32Array(end - start);
        let n = 0;
        for (let k = start; k < end; k++) at[k - start] = removed[k] ? -1 : n++;
        const src = new Int32Array(n);
        for (let k = 0; k < at.length; k++) if (at[k] >= 0) src[at[k]] = k;
        let joined = '';
        for (let k = start; k < end;) {
          if (removed[k]) { k++; continue; }
          let j = k + 1;
          while (j < end && !removed[j]) j++;
          joined += text.slice(k, j);
          k = j;
        }
        const offsets = [];
        for (let q = 0, o = 0; q < physical.length; q++) { offsets.push(o); o += physical[q].length + 1; }
        groups.push({ physical, joined, at, src, offsets, first });
      }
      first = i + 1;
      start = end + 1;
    }
    return groups;
  };
  /** How many characters `group.physical.join('\n')` has. */
  const groupSize = (g) => g.physical.length === 1 ? g.physical[0].length
    : g.offsets[g.offsets.length - 1] + g.physical[g.physical.length - 1].length;

  // ---- W3e-3 / F197: one scanning rule for every field -----------------------------------------
  //
  // A UNIT is what one decision covers: a logical line, or a whole field whose contract is all or
  // nothing. A VIEW is one scan of one form of the unit's text — joined, one physical line, the
  // whole field — with `map(k)`: where character k of the scanned text stands in the unit. A FORM
  // is a way the unit can be emitted, with `hidden(p)`: true when unit position p does not appear
  // in it as itself (the scan that made the form replaced it, or a join removed it).

  const look = (text, map, detect, turn, where) => {
    const trace = { findings: [] };
    return { text, map, trace, out: detect(text, turn, where, trace) };
  };
  const clean = (views) => views.every((v) => v.trace.findings.length === 0);
  const entriesOf = (views) => views.flatMap((v) => v.trace.findings.map((f) => f.entry));
  const dropsOf = (views) => views.flatMap((v) => v.trace.findings.filter((f) => f.drop).map((f) => f.entry.reason));

  /** Every character where it stood, each masked by the view that scanned its line. `from`/`to`:
   *  the unit positions the views cover. `text` is null when a view dropped its line. */
  const writtenForm = (lines, views, from, to) => {
    const mask = new Uint8Array(to - from);
    for (const v of views) for (const f of v.trace.findings) {
      if (f.start === undefined) continue;
      for (let k = f.start; k < f.end; k++) { const p = v.map(k); if (p >= from && p < to) mask[p - from] = 1; }
    }
    return { kind: 'written', text: lines.some((l) => typeof l !== 'string') ? null : lines.join('\n'), lines,
      joins: () => false, hidden: (p) => p >= from && p < to && mask[p - from] === 1,
      entries: entriesOf(views), drops: dropsOf(views), views };
  };

  /** The masked joined form: the joined text as `view`, its own scan, masked it (behind `prefix`, a
   *  diff line's marker). `joinedAt(p)` is where unit position p stands in the joined text: -1
   *  where the join removed it, null where p is not part of it. */
  const joinedForm = (view, joinedAt, prefix = '') => {
    const mask = new Uint8Array(view.text.length);
    for (const f of view.trace.findings) if (f.start !== undefined) mask.fill(1, f.start, f.end);
    const text = typeof view.out === 'string' ? prefix + view.out : null;
    return { kind: 'joined', text, lines: [text], joins: () => true,
      hidden: (p) => { const j = joinedAt(p); return j != null && (j < 0 || mask[j] === 1); },
      entries: entriesOf([view]), drops: dropsOf([view]), views: [view] };
  };

  /** Does `form` show nothing of finding `f` of `view`? Fails closed. */
  const hides = (form, view, f) => {
    if (f.drop) return false;                            // only dropping the unit hides a drop
    if (f.token !== undefined) {
      // A prose token is replaced by value: it must not appear in the form — and a form that keeps
      // a continuation as written must not show, in halves, a token only the join assembled.
      if (form.text.includes(f.token.replace(/\\$/, ''))) return false;
      for (let i = view.text.indexOf(f.token); i >= 0; i = view.text.indexOf(f.token, i + 1))
        for (let k = i; k + 1 < i + f.token.length; k++) {
          const p = view.map(k);
          if (view.map(k + 1) !== p + 1 && !form.joins(p)) return false;
        }
      return true;
    }
    for (let k = f.start; k < f.end; k++) {
      const p = view.map(k);
      if (p < 0 || !form.hidden(p)) return false;
    }
    return true;
  };

  /**
   * THE rule, for every field. W3e-1 / F186 made it for the content fields; W3e-3 / F197 found the
   * command fields, the diff, `tailLines` and the ask never had it — a token split across a
   * continued line reached the output whole, in two halves side by side — and every path now calls
   * this one function. Given every view of a unit (joined AND each physical line, and the whole
   * field where a field has always been scanned whole) and the forms it may take — first what the
   * field has always emitted, last the masked joined form (`makers`, built only when needed):
   *   { clean: true }      every view is clean: the unit is emitted as written, byte for byte;
   *   { form, entries }    the first form that shows nothing any view found;
   *   { drop, entries }    no form does: the unit is dropped and counted — for an all-or-nothing
   *                        field the field goes — and `drop` is the reason the note names.
   * No original physical line of a unit in which anything was found is emitted as written.
   * Declarations (`entries`, pushed by the caller): the chosen form's own scan, exactly what that
   * form has always declared; on a drop, the field's own form's declarations, plus each finding of
   * another view that the last form tried would still have shown — what dropped it.
   */
  const settle = (views, makers) => {
    if (clean(views)) return { clean: true };
    const forms = [];
    for (const make of makers) {
      const form = make();
      forms.push(form);
      if (form && form.text !== null && views.every((v) => v.trace.findings.every((f) => hides(form, v, f))))
        return { form, entries: form.entries };
    }
    const [own] = forms;
    if (own.text === null) return { drop: noteReason(own.drops), entries: own.entries };
    const last = forms.filter((form) => form && form.text !== null).pop();
    const mine = new Set(own.views);
    const causes = views.flatMap((v) => v.trace.findings.filter((f) => !hides(last, v, f)).map((f) => ({ v, f })));
    return { drop: noteReason(causes.map(({ f }) => f.entry.reason)),
      entries: [...own.entries, ...causes.filter(({ v }) => !mine.has(v)).map(({ f }) => f.entry)] };
  };

  /**
   * One logical line of a line-structured field, through `settle`. `written`: the field has always
   * emitted each physical line masked where it stands (`tailLines`, a whole field's lines), tried
   * before the masked joined line; otherwise it has always emitted the masked joined line (the
   * content fields, W3e-1). `base`: where the group starts in the caller's unit; `P`/`J`: views the
   * caller already has.
   */
  const settleGroup = (group, detect, turn, where, { written, base = 0, P = null, J = null } = {}) => {
    const size = groupSize(group);
    P ??= group.physical.map((line, i) => look(line, (k) => base + (group.offsets?.[i] ?? 0) + k, detect, turn, where));
    if (group.physical.length === 1) {
      const E = escapedView(group.joined, (k) => base + k, detect, turn, where);
      return settle(E ? [...P, E] : P, [() => writtenForm([P[0].out], P, base, base + size)]);
    }
    J ??= look(group.joined, (k) => base + group.src[k], detect, turn, where);
    const E = escapedView(group.joined, (k) => base + group.src[k], detect, turn, where);
    const joined = () => joinedForm(J, (p) => (p >= base && p < base + size ? group.at[p - base] : null));
    return settle([J, ...P, ...(E ? [E] : [])],
      written ? [() => writtenForm(P.map((v) => v.out), P, base, base + size), joined] : [joined]);
  };

  /**
   * M33 R repair 4. The view of `text` (one logical line) joined across its JSON-escaped continuations
   * (`escapedContinuations`), scanned by `detect`; `map(k)`: where character k of `text` stands in the unit. Null when
   * `text` holds none. It is one more view and never a form: a line it finds anything in that the line's own form does
   * not hide is dropped and counted (`settle`) — the value a JSON-escaped continuation carries goes with its key, or
   * the line goes. Fails closed: the joined text is never shown.
   */
  const escapedView = (text, map, detect, turn, where) => {
    if (!hasEscapedContinuation(text)) return null;
    const cuts = escapedContinuations(text);
    const src = new Int32Array(text.length - cuts.reduce((n, [a, b]) => n + b - a, 0));
    let joined = '';
    let from = 0;
    let n = 0;
    for (const [a, b] of [...cuts, [text.length, text.length]]) {
      for (let k = from; k < a; k++) src[n++] = k;
      joined += text.slice(from, a);
      from = b;
    }
    return look(joined, (k) => map(src[k]), detect, turn, where);
  };

  /**
   * Every view of a field that is scanned as one string, and the forms it may take (`scrubField`).
   * Views: the whole field (as it has always been scanned), the whole field joined across every
   * continuation, each continued logical line joined, and each physical line. Forms: the whole field
   * masked as written (what it has always emitted); each logical line by the line rule — as
   * written, masked where it stands, or joined and masked — with none dropped; the whole field
   * joined and masked.
   *
   * M33 R repair 3: the whole field joined is joined across its JSON-escaped continuations too
   * (`escapedContinuations`), and is a view whenever the field holds either kind; a field that holds
   * no escaped one is joined exactly as before.
   */
  const fieldViews = (text, detect, turn, where) => {
    const lines = text.split('\n');
    const starts = [];
    for (let i = 0, o = 0; i < lines.length; i++) { starts.push(o); o += lines[i].length + 1; }
    const groups = logicalLines(lines);
    const W = look(text, (k) => k, detect, turn, where);
    const P = lines.map((line, i) => look(line, (k) => starts[i] + k, detect, turn, where));
    const J = new Map();
    for (const g of groups) if (g.physical.length > 1) J.set(g, look(g.joined, (k) => starts[g.first] + g.src[k], detect, turn, where));
    let JW = null;
    let at = null;
    const escaped = hasEscapedContinuation(text);
    if (J.size || escaped) {
      at = new Int32Array(text.length);
      const removed = new Uint8Array(text.length);
      for (const m of text.matchAll(CONTINUATION)) removed.fill(1, m.index, m.index + m[0].length);
      if (escaped) for (const [a, b] of escapedContinuations(text)) removed.fill(1, a, b);
      let n = 0;
      for (let k = 0; k < text.length; k++) at[k] = removed[k] ? -1 : n++;
      const src = new Int32Array(n);
      for (let k = 0; k < text.length; k++) if (at[k] >= 0) src[at[k]] = k;
      let joined = '';
      for (let k = 0; k < text.length;) {
        if (removed[k]) { k++; continue; }
        let j = k + 1;
        while (j < text.length && !removed[j]) j++;
        joined += text.slice(k, j);
        k = j;
      }
      JW = look(joined, (k) => src[k], detect, turn, where);
    }
    const byLine = () => {
      const out = [], entries = [], parts = [];
      for (const g of groups) {
        const base = starts[g.first];
        const s = settleGroup(g, detect, turn, where,
          { written: true, base, P: P.slice(g.first, g.first + g.physical.length), J: J.get(g) ?? null });
        if (s.drop) return null;                         // a dropped line: this form cannot show the field
        if (s.clean) { append(out, g.physical); continue; }
        append(out, s.form.lines);
        append(entries, s.entries);
        parts.push({ from: base, to: base + groupSize(g), form: s.form });
      }
      const owner = (p) => parts.find((part) => p >= part.from && p < part.to)?.form ?? null;
      return { kind: 'lines', text: out.join('\n'), lines: out, joins: (p) => owner(p)?.joins(p) ?? false,
        hidden: (p) => owner(p)?.hidden(p) ?? false, entries, drops: [], views: [] };
    };
    return {
      views: [W, ...(JW ? [JW] : []), ...J.values(), ...P],
      makers: [() => writtenForm([W.out], [W], 0, text.length), byLine, ...(JW ? [() => joinedForm(JW, (p) => at[p])] : [])],
    };
  };

  /**
   * A field scanned as one string, whose contract is all or nothing: `cmd`, `argsExcerpt` (an
   * unclassifiable token drops the whole field — fail closed means the field goes, not the line) and the ask (prose: a token is replaced, and no line is ever cut out of the
   * human's words). Key blocks go first, over logical lines. Returns `{ text, pemLines }`; `text`
   * is null when the field goes.
   */
  const scrubField = (value, turn, where) => {
    if (!mask) return { text: value, pemLines: 0, retainedText: value };
    const lines = value.split('\n');
    const groups = logicalLines(lines);
    let open = false;
    for (const group of groups) open = pemStep(group, open, turn, where);
    const pemLines = groups.reduce((n, g) => n + (g.pem ? g.physical.length : 0), 0);
    // Keep a non-citable cut marker where a PEM block was removed. Without a marker, the
    // surviving words on either side became adjacent and could ground a quote never written.
    const kept = [];
    let cut = 0;
    for (const group of groups) {
      if (group.pem) { cut += group.physical.length; continue; }
      if (cut) { for (const note of droppedNotes(new Map([[PEM_DROP, cut]]))) kept.push(note); cut = 0; }
      for (const line of group.physical) kept.push(line);
    }
    if (cut) for (const note of droppedNotes(new Map([[PEM_DROP, cut]]))) kept.push(note);
    const text = pemLines ? kept.join('\n') : value;
    const retainedText = pemLines ? groups.filter((g) => !g.pem).flatMap((g) => g.physical).join('\n') : value;
    // One line: the whole field, its joined form and its only physical line are one text.
    // M33 R repair 3: unless it holds a JSON-escaped continuation, which joins it to the line it continues.
    if (!text.includes('\n') && !hasEscapedContinuation(text)) return { text: scrub(text, turn, where), pemLines, retainedText };
    const { views, makers } = fieldViews(text, scrub, turn, where);
    const s = settle(views, makers);
    append(dropped, s.entries ?? []);
    return { text: s.clean ? text : s.form ? s.form.text : null, pemLines, retainedText };
  };

  /** The first view of an identity or a name that found anything (for a value on one line, the whole-string scan these
   *  fields always had), or null when every view is clean. Declares nothing. */
  const firstFlaggedView = (value, turn, where) => {
    if (!mask || typeof value !== 'string' || !value) return null;
    const views = value.includes('\n') ? fieldViews(value, scrub, turn, where).views : [look(value, (k) => k, scrub, turn, where)];
    return views.find((v) => v.trace.findings.length) ?? null;
  };
  /**
   * An identity or a name — a delegation's or a recording's identities, an ask's mentions: kept
   * only when every view of it is clean. Declares the first view that found anything.
   */
  const flagged = (value, turn, where) => {
    const first = firstFlaggedView(value, turn, where);
    if (!first) return false;
    append(dropped, entriesOf([first]));
    return true;
  };

  /**
   * D68 (C-02 "M36 recorded facts"). An event's `recorded` facts, REBUILT from their closed vocabulary
   * (`RECORDED_FACTS`): a member outside it, a value of the wrong type or a number out of range is dropped and the
   * facts say `withheld`; a recorder string any view of this redactor flags (a tool name, a path, a URL, a query, a
   * task id) is withheld whole, never masked into a fact; recorded hunks are scrubbed again as one change
   * (`scrubHunks`, line count kept), and kept only if that reads them. `{ facts, masked }`: `facts` null when there is
   * nothing to rebuild, `masked` when a hunk line was masked here. Fails closed: nothing passes it unscrubbed.
   */
  const recordedFacts = (value, turn, where) => {
    if (!plainObject(value)) return { facts: null, masked: false };
    const out = {};
    let withheld = value.withheld === true;
    let masked = false;
    // A recorder string is read as written and with its separators as spaces (a vendor or MCP name, a path or a URL glues
    // words with `_ . / : -`, and a detector that needs a word boundary would miss a credential glued to one), as a
    // generic tool's name always was.
    const text = (v) => {
      if (!recorderString(v)) { if (v !== undefined) withheld = true; return undefined; }
      const spaced = v.replace(/[_./:-]+/g, ' ');
      if (flagged(v, turn, where) || (spaced !== v && flagged(spaced, turn, where))) { withheld = true; return undefined; }
      return v;
    };
    const member = (v, list) => (list.includes(v) ? v : (withheld = withheld || v !== undefined, undefined));
    const flag = (v) => (typeof v === 'boolean' ? v : (withheld = withheld || v !== undefined, undefined));
    const num = (v) => (isCount(v) ? v : (withheld = withheld || v !== undefined, undefined));
    const put = (target, key, v) => { if (v !== undefined) target[key] = v; };
    const pick = (v, keys, read) => {
      if (!plainObject(v)) { withheld = true; return undefined; }
      const o = {};
      for (const key of Object.keys(v)) if (!keys.includes(key)) withheld = true;
      for (const key of keys) if (Object.hasOwn(v, key)) put(o, key, read(key, v[key]));
      return Object.keys(o).length ? o : undefined;
    };
    const hunksOf = (v) => {
      const scrubbed = scrubHunks(v, null, { mask });
      if (!scrubbed) { withheld = true; return undefined; }
      if (scrubbed.lost) masked = true;
      for (const reason of scrubbed.reasons) dropped.push({ turn, reason, where: 'hunks' });
      return scrubbed.hunks;
    };
    const ref = (v) => (plainObject(v) && Object.keys(v).length === 2 && isCount(v.turn) && isCount(v.seq)
      ? { turn: v.turn, seq: v.seq } : (withheld = true, undefined));
    for (const key of Object.keys(value)) if (!RECORDED_FACTS.keys.includes(key)) withheld = true;
    put(out, 'tool', text(value.tool));
    put(out, 'commandClass', member(value.commandClass, RECORDED_FACTS.commandClass));
    if (Object.hasOwn(value, 'parsedCmd')) {
      if (!Array.isArray(value.parsedCmd)) withheld = true;
      else out.parsedCmd = value.parsedCmd.map((entry) => {
        if (!plainObject(entry) || !RECORDED_FACTS.parsedCmdTypes.includes(entry.type)) { withheld = true; return { type: 'unknown' }; }
        const keys = { read: ['name', 'path'], search: ['query', 'path'], list_files: ['path'], unknown: [] }[entry.type];
        const kept = { type: entry.type };
        for (const key of Object.keys(entry)) if (key !== 'type' && !keys.includes(key)) withheld = true;
        for (const key of keys) {
          if (!Object.hasOwn(entry, key)) continue;
          if (entry[key] === null) { kept[key] = null; continue; }
          const v = text(entry[key]);
          kept[key] = v === undefined ? null : v;
        }
        return kept;
      });
    }
    // D68 (R): hunks withheld whole (`hunksWithheld`) carry no line: a `hunks` beside the reason is never read.
    const hunksWithheld = member(value.hunksWithheld, RECORDED_FACTS.hunksWithheld);
    if (!hunksWithheld && Object.hasOwn(value, 'hunks')) put(out, 'hunks', hunksOf(value.hunks));
    // D84: with masking off nothing is scrubbed, so no scrub is declared where the slicer declared none.
    if (out.hunks)
      put(out, 'hunkScrub', member(value.hunkScrub, RECORDED_FACTS.hunkScrub) ?? (mask ? 'change' : undefined));
    put(out, 'hunksWithheld', hunksWithheld);
    put(out, 'writeType', member(value.writeType, RECORDED_FACTS.writeType));
    put(out, 'prior', member(value.prior, RECORDED_FACTS.prior));
    put(out, 'patch', member(value.patch, RECORDED_FACTS.patch));
    for (const key of ['isError', 'interrupted', 'noOutputExpected']) put(out, key, flag(value[key]));
    put(out, 'denial', member(value.denial, RECORDED_FACTS.denial));
    if (Object.hasOwn(value, 'backgroundTaskId')) {
      const id = value.backgroundTaskId;
      put(out, 'backgroundTaskId', text(id));
    }
    if (Object.hasOwn(value, 'editDiff')) put(out, 'editDiff', pick(value.editDiff, RECORDED_FACTS.editDiff, (key, v) => {
      // D68 (R): a file whose hunks are withheld whole (`hunksWithheld`, a closed reason) has no hunk read.
      if (key === 'files') return Array.isArray(v) ? v.map((file) => pick(file, RECORDED_FACTS.editDiffFile,
        (k, x) => (k === 'path' ? text(x)
          : k === 'hunks' ? (RECORDED_FACTS.hunksWithheld.includes(file.hunksWithheld) ? undefined : hunksOf(x))
            : k === 'hunkScrub' ? (RECORDED_FACTS.hunksWithheld.includes(file.hunksWithheld) ? undefined
              : member(x, RECORDED_FACTS.hunkScrub))
              : k === 'hunksWithheld' ? member(x, RECORDED_FACTS.hunksWithheld) : flag(x)))).filter(Boolean)
        : (withheld = true, undefined);
      if (key === 'changedFiles') return Array.isArray(v)
        ? v.map((path) => text(path)).filter((path) => path !== undefined) : (withheld = true, undefined);
      return key === 'moreFiles' ? num(v) : flag(v);
    }));
    if (Object.hasOwn(value, 'read')) put(out, 'read', pick(value.read, RECORDED_FACTS.read, (key, v) => num(v)));
    if (Object.hasOwn(value, 'search')) put(out, 'search', pick(value.search, RECORDED_FACTS.search,
      (key, v) => (key === 'mode' ? member(v, RECORDED_FACTS.searchModes) : key === 'truncated' ? flag(v) : num(v))));
    if (Object.hasOwn(value, 'fetch')) put(out, 'fetch', pick(value.fetch, RECORDED_FACTS.fetch,
      (key, v) => (key === 'url' ? text(v) : num(v))));
    if (Object.hasOwn(value, 'webSearch')) put(out, 'webSearch', pick(value.webSearch, RECORDED_FACTS.webSearch,
      (key, v) => (key === 'query' ? text(v) : num(v))));
    if (Object.hasOwn(value, 'unrecordedChange')) {
      const u = value.unrecordedChange;
      if (!plainObject(u) || Object.keys(u).some((key) => key !== 'since' && key !== 'commands')
        || !Array.isArray(u.commands)) withheld = true;
      else {
        const since = ref(u.since);
        const commands = u.commands.map(ref).filter(Boolean);
        if (since) out.unrecordedChange = { since, commands };
      }
    }
    if (withheld) out.withheld = true;
    return { facts: Object.keys(out).length ? out : null, masked };
  };

  /**
   * `tailLines`: one entry per physical line of a command's output, as it has always been scanned —
   * and now each run of continued entries joined as well. A clean logical line keeps its entries;
   * a dirty one its entries masked where they stand, or one entry, joined and masked; a line
   * nothing can show safely is replaced by a non-citable note at that cut. An entry
   * that is not text is left where it is, and no line continues across it.
   *
   * M33 R repair 3: a numbered output — a Claude Code Read result, `cat -n`, `nl` (each line behind
   * `READ_LINE_NUMBER`, the slicer's own rule for a Read) — was scanned only with each line's
   * `     N\t` on, which defeats every line-anchored rule: a YAML secret block's key and its lines'
   * indentation, a PEM BEGIN line at the start of its line, a continued line (the next line's number
   * stands between the `\` and the token's second half). Its body lines, short key lines and split
   * tokens reached the ledger, the session and the review requests verbatim. Now it is scrubbed
   * twice, by this one rule: as written (the numbered view) and with every number stripped as the
   * slicer strips a Read's (the de-numbered view, the text the file holds; `denumbered`). The result
   * is mapped back line by line: an entry is shown only where both views show it on its own (not
   * dropped, not joined into another line) and agree on it — the numbered view's line is its number
   * followed by the de-numbered view's line — so a line neither view touched keeps its bytes, and a
   * line both mask alike keeps that mask. Any other entry is dropped and counted under the reason
   * that touched it (fails closed: a view's mask is never patched onto the other's line, and a line
   * one view masks and the other does not is dropped). Each reason is declared as often as the view
   * that found it more often declared it, never once per view.
   *
   * M33 R repair 4 (the fourth leak hunt): the same held for every other line-number shape — `N→`,
   * `grep -n` (`N:`, `N-`), `rg -n` / `grep -Hn` (`path:N:`, `path-N-`): a YAML block's body, a short
   * PEM body and a continued env value reached the output behind them. Now each shape some entry
   * carries (`OUTPUT_LINE_NUMBERS`) is one more de-numbered view, by the same rule: an entry is shown
   * only where EVERY view shows it on its own and agrees on it, and each reason is declared as often
   * as the view that declared it most often.
   */
  const scrubTail = (entries, turn) => {
    if (!mask) return { kept: [...entries], lost: false };
    const plain = denumbered(entries);
    if (!plain.length) return assembleTail(tailUnits(entries, turn));
    const mark = dropped.length;
    const asWritten = tailUnits(entries, turn);
    const fromWritten = dropped.splice(mark);
    const views = plain.map((view) => {
      const units = tailUnits(view.lines, turn);
      return { ...view, units, declared: dropped.splice(mark) };
    });
    // Each reason as often as the view that declared it most often did.
    const most = new Map();
    for (const entry of fromWritten) most.set(entry.reason, (most.get(entry.reason) ?? 0) + 1);
    append(dropped, fromWritten);
    for (const view of views) {
      const count = new Map();
      for (const entry of view.declared) {
        const k = (count.get(entry.reason) ?? 0) + 1;
        count.set(entry.reason, k);
        if (k > (most.get(entry.reason) ?? 0)) { most.set(entry.reason, k); dropped.push(entry); }
      }
    }
    const n = entries.length;
    const merged = { out: new Array(n), gone: new Array(n).fill(null), lead: new Int32Array(n).fill(-1) };
    const alone = (units, i) => units.gone[i] === null && units.lead[i] < 0;
    for (let i = 0; i < n; i++) {
      if (alone(asWritten, i) && views.every((v) => alone(v.units, i)
        && (typeof entries[i] !== 'string' || asWritten.out[i] === v.prefix[i] + v.units.out[i] + v.suffix[i]))) {
        merged.out[i] = asWritten.out[i];
        continue;
      }
      const all = [...views.map((v) => v.units), asWritten];
      merged.gone[i] = all.find((units) => units.gone[i] !== null)?.gone[i] ?? noteReason(all.flatMap((units) => units.why[i]));
    }
    return assembleTail(merged);
  };

  /**
   * `entries` de-numbered, once for each line-number shape some entry carries (`OUTPUT_LINE_NUMBERS`): `[{ lines,
   * prefix }]`, each line's number in `prefix`, or `[]` when no entry carries one. The slicer's Read rule
   * (`READ_LINE_NUMBER`) is stripped as the slicer strips a Read's; an entry with no number of that shape, or that is
   * not text, is left as it is. The slicer strips a text only when 80% of its lines are numbered (`isNumberedRead`),
   * because there the stripped text is what is SHOWN, and a false strip would change it. Here each de-numbered view is a
   * scan whose result is never shown (`scrubTail` shows the numbered view's line or nothing), so it is taken wherever
   * any line carries a number of its shape: a short `nl -ba` output behind a Codex shell header (five un-numbered lines)
   * is numbered too, and so is a line a timestamp happens to start. A view can only drop a line, never reveal one:
   * fails closed. M33 R repair 4: every shape, not only the Read's.
   *
   * M33 R repair 5: `[{ lines, prefix, suffix }]`, each line's end decoration (`outputLineDecoration`: `cat -e`'s `$`,
   * `cat -A`'s `^M$`, `cat -v`'s `^M`) in `suffix`. When some entry carries one, the entries are also read without it,
   * alone and behind each line-number shape present (`cat -n -A`): a decoration and a number each stand where a rule
   * looks, and only a view without both reads the line as the file holds it.
   */
  const denumbered = (entries) => {
    const text = (entry) => typeof entry === 'string';
    const shapes = OUTPUT_LINE_NUMBERS.filter((shape) => entries.some((entry) => text(entry) && shape.test(entry)));
    const decorated = entries.some((entry) => text(entry) && outputLineDecoration(entry) > 0);
    const views = [];
    const view = (shape, undecorated) => {
      const prefix = [];
      const suffix = [];
      const lines = [];
      for (const entry of entries) {
        if (!text(entry)) { prefix.push(''); suffix.push(''); lines.push(entry); continue; }
        const number = shape ? shape.exec(entry)?.[0] ?? '' : '';
        const rest = number ? entry.slice(number.length) : entry;
        const end = undecorated ? rest.length - outputLineDecoration(rest) : rest.length;
        prefix.push(number);
        suffix.push(rest.slice(end));
        lines.push(end < rest.length ? rest.slice(0, end) : rest);
      }
      views.push({ prefix, suffix, lines });
    };
    for (const shape of shapes) view(shape, false);
    if (decorated) {
      view(null, true);
      for (const shape of shapes) view(shape, true);
    }
    return views;
  };

  /**
   * The rule of `tailLines` over `entries`, entry by entry, in the order it has always run (blocks, PEM blocks, then
   * each logical line through `settle`), declaring as it always did: `out[i]` — entry i as shown, `gone[i]` — the
   * reason it was dropped (else null), `lead[i]` — for the lines of one logical line shown joined, the entry that
   * carries it (else -1), `why[i]` — the reasons of what changed entry i.
   */
  const tailUnits = (entries, turn) => {
    const where = 'tailLines';
    const n = entries.length;
    const out = new Array(n);
    const gone = new Array(n).fill(null);
    const lead = new Int32Array(n).fill(-1);
    const why = Array.from({ length: n }, () => []);
    const units = [];
    let run = [];
    let from = 0;
    const flush = () => {
      if (!run.length) return;
      const masked = maskBlocks(run, turn, where);
      for (const k of masked.at) why[from + k].push(SECRET_VALUE);
      for (const group of logicalLines(masked.lines)) units.push({ ...group, first: from + group.first });
      run = [];
    };
    entries.forEach((entry, i) => {
      if (typeof entry === 'string') { if (!run.length) from = i; run.push(entry); }
      else { flush(); units.push({ other: true, value: entry, first: i }); }
    });
    flush();
    let open = false;
    for (const unit of units) {
      if (unit.other) { if (open) unit.pem = true; continue; }
      open = pemStep(unit, open, turn, where);
    }
    for (const unit of units) {
      const at = unit.first;
      const size = unit.other ? 1 : unit.physical.length;
      if (unit.pem) { gone.fill(PEM_DROP, at, at + size); continue; }
      if (unit.other) { out[at] = unit.value; continue; }
      if (size === 1 && !hasEscapedContinuation(unit.joined)) {
        const mark = dropped.length;
        const r = scrub(unit.joined, turn, where);
        for (let k = mark; k < dropped.length; k++) why[at].push(dropped[k].reason);
        if (r === null) gone[at] = ENTROPY_DROP; else out[at] = r;
        continue;
      }
      const s = settleGroup(unit, scrub, turn, where, { written: true });
      append(dropped, s.entries ?? []);
      // Each distinct reason once per line: a logical line of N lines can carry N declarations (F222's sizes).
      const reasons = Array.from(new Set((s.entries ?? []).map((entry) => entry.reason)));
      if (reasons.length) for (let k = at; k < at + size; k++) append(why[k], reasons);
      if (s.clean) unit.physical.forEach((line, k) => { out[at + k] = line; });
      else if (s.form?.kind === 'written') s.form.lines.forEach((line, k) => { out[at + k] = line; });
      else if (s.form) { out[at] = s.form.text; lead.fill(at, at, at + size); }
      else gone.fill(s.drop ?? ENTROPY_DROP, at, at + size);
    }
    return { out, gone, lead, why };
  };

  /** `tailLines` as shown: each entry shown on its own, a joined logical line once, and a note at each cut counting the
   *  entries dropped there, by reason. `lost`: whether any entry was dropped. */
  const assembleTail = ({ out, gone, lead }) => {
    const kept = [];
    let lost = false;
    const omitted = new Map();
    for (let i = 0; i < out.length; i++) {
      if (gone[i] !== null) { omitted.set(gone[i], (omitted.get(gone[i]) ?? 0) + 1); lost = true; continue; }
      if (lead[i] >= 0 && lead[i] !== i) continue;
      append(kept, droppedNotes(omitted));
      omitted.clear();
      kept.push(out[i]);
    }
    append(kept, droppedNotes(omitted));
    return { kept, lost };
  };

  /**
   * The content channel's diff (D31). A diff
   * of a .env or a config file is exactly where a secret lives. It shows two texts: the old one
   * (context and `-` lines) and the new one (context and `+` lines). A continued line is continued
   * in one of them, so each side's continued lines are joined on their own — a token split across
   * a context line and an added line is whole only in the new text. Every line is also scanned on
   * its own, as the diff always was. A logical line clean everywhere is kept as written; a dirty one
   * is each line masked where it stands (the diff's own form), or, when it is one side's lines under
   * one marker, the joined line masked under that marker; else its lines are dropped, counted, and
   * the note names why. An unclassifiable token drops that diff line, never the whole diff.
   *
   * `aligned` (M33 R repair, `scrubDiffWhole`), when given, also receives the result line by line:
   * `lines` (each line of `text` as emitted, or null where it was dropped or joined into another),
   * `drops` (the reason a dropped line went, else null) and `groups` (each declaration made, as the
   * lines of `text` it covers and its reasons). The text returned is the same either way.
   */
  const scrubDiff = (text, turn, aligned = null) => {
    const where = 'diff';
    const all = text.split('\n');
    if (!mask) {
      if (aligned) Object.assign(aligned, { lines: [...all], drops: new Array(all.length).fill(null), groups: [] });
      return { text, lost: false };
    }
    const track = aligned ? { index: [], blocks: [] } : null;
    const lines = dropPemBlocks(all, turn, where, track);
    const lost = new Map();
    const lose = (reason, n) => lost.set(reason, (lost.get(reason) ?? 0) + n);
    if (lines.length !== all.length) lose(PEM_DROP, all.length - lines.length);
    // What each declaration covers, by line of `all`, and why each dropped line went (aligned only).
    const groups = track ? track.blocks.filter((b) => b.entries.length) : null;
    const drops = track ? new Array(lines.length).fill(null) : null;
    const covered = (at, entries) => { if (groups && entries.length) groups.push({ at: at.map((i) => track.index[i]), entries }); };
    // A YAML block under a secret-named key (W3e-5 / F210), found on each side's text (old: context
    // and `-`; new: context and `+`), each line it holds masked under its marker. A block both sides
    // hold (context lines) is declared once.
    const declaredBlocks = new Set();
    for (const side of ['-', '+']) {
      let run = [];
      const flush = () => {
        const { lines: masked, at, blocks } = maskBlocks(run.map((i) => lines[i]), turn, where, 1, false);
        for (const k of at) lines[run[k]] = masked[k];
        for (const [, first, last] of blocks ?? []) {
          const key = run.slice(first, last + 1).join(',');
          if (declaredBlocks.has(key)) continue;
          declaredBlocks.add(key);
          const entry = { turn, reason: SECRET_VALUE, where };
          dropped.push(entry);
          covered(run.slice(first, last + 1), [entry]);
        }
        run = [];
      };
      for (let i = 0; i < lines.length; i++) {
        const marker = lines[i][0];
        if (marker !== ' ' && marker !== '-' && marker !== '+') flush();
        else if (marker === ' ' || marker === side) run.push(i);
      }
      flush();
    }
    const n = lines.length;
    const starts = [];
    for (let i = 0, o = 0; i < n; i++) { starts.push(o); o += lines[i].length + 1; }

    // Each side's continued logical lines, as the diff lines they span. Context lines continued
    // alike on both sides are one logical line.
    const sides = [];
    const seen = new Set();
    for (const side of ['-', '+']) {
      let run = [];
      const flush = () => {
        if (run.length > 1) for (const group of logicalLines(run.map((i) => lines[i].slice(1)))) {
          if (group.physical.length === 1) continue;
          const idx = run.slice(group.first, group.first + group.physical.length);
          if (seen.has(idx.join(','))) continue;
          seen.add(idx.join(','));
          sides.push({ idx, group });
        }
        run = [];
      };
      for (let i = 0; i < n; i++) {
        const marker = lines[i][0];
        if (marker !== ' ' && marker !== '-' && marker !== '+') flush();   // `…`, `@@ … @@`, an elision
        else if (marker === ' ' || marker === side) run.push(i);
      }
      flush();
    }
    // Logical lines that share a diff line (a context line both sides continue) are one unit.
    const root = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i) => { while (root[i] !== i) i = root[i] = root[root[i]]; return i; };
    for (const { idx } of sides) for (const i of idx) root[find(i)] = find(idx[0]);
    const units = new Map();
    for (const s of sides) {
      const r = find(s.idx[0]);
      if (!units.has(r)) units.set(r, { lines: new Set(), sides: [] });
      units.get(r).sides.push(s);
      for (const i of s.idx) units.get(r).lines.add(i);
    }
    const unitOf = new Map();
    for (const unit of units.values()) for (const i of unit.lines) unitOf.set(i, unit);

    const out = new Array(n).fill(null);
    const done = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (done[i]) continue;
      const unit = unitOf.get(i);
      if (!unit && !hasEscapedContinuation(lines[i])) {
        const mark = dropped.length;
        const r = scanHunkLine(lines[i], turn, where);
        if (r === null) { lose(ENTROPY_DROP, 1); if (drops) drops[i] = ENTROPY_DROP; } else out[i] = r;
        covered([i], dropped.slice(mark));
        continue;
      }
      if (!unit) {
        // M33 R repair 4: a diff line holding a JSON-escaped continuation is also scanned joined across it
        // (`escapedView`); what that view finds, the line as written must hide, or the line goes.
        const P = look(lines[i], (j) => starts[i] + j, scanHunkLine, turn, where);
        const E = escapedView(lines[i], (j) => starts[i] + j, scanHunkLine, turn, where);
        const s = settle([P, E], [() => writtenForm([P.out], [P], starts[i], starts[i] + lines[i].length)]);
        append(dropped, s.entries ?? []);
        covered([i], s.entries ?? []);
        if (s.clean) out[i] = lines[i];
        else if (s.form) out[i] = s.form.lines[0];
        else { lose(s.drop, 1); if (drops) drops[i] = s.drop; }
        continue;
      }
      const idx = [...unit.lines].sort((a, b) => a - b);
      for (const k of idx) done[k] = 1;
      const P = idx.map((k) => look(lines[k], (j) => starts[k] + j, scanHunkLine, turn, where));
      const E = [];
      const J = unit.sides.map(({ idx: span, group }) => {
        const toDiff = new Int32Array(groupSize(group)).fill(-1);
        group.physical.forEach((line, j) => { for (let c = 0; c < line.length; c++) toDiff[group.offsets[j] + c] = starts[span[j]] + 1 + c; });
        const escaped = escapedView(group.joined, (k) => toDiff[group.src[k]], scanLine, turn, where);   // M33 R repair 4
        if (escaped) E.push(escaped);
        return look(group.joined, (k) => toDiff[group.src[k]], scanLine, turn, where);
      });
      const [only] = unit.sides;
      const marker = unit.sides.length === 1 && only.idx.every((k) => lines[k][0] === lines[only.idx[0]][0]) ? lines[only.idx[0]][0] : null;
      const joinedAt = (p) => {
        for (let j = 0; j < only.idx.length; j++) {
          const at = starts[only.idx[j]];
          if (p < at || p >= at + lines[only.idx[j]].length) continue;
          if (p === at) return j === 0 ? null : -1;           // the first marker stands; the others go
          return only.group.at[only.group.offsets[j] + (p - at - 1)];
        }
        return null;
      };
      const s = settle([...P, ...J, ...E], [() => writtenForm(P.map((v) => v.out), P, starts[idx[0]], starts[idx[idx.length - 1]] + lines[idx[idx.length - 1]].length),
        ...(marker !== null ? [() => joinedForm(J[0], joinedAt, marker)] : [])]);
      append(dropped, s.entries ?? []);
      covered(idx, s.entries ?? []);
      if (s.clean) for (const k of idx) out[k] = lines[k];
      else if (s.form?.kind === 'written') idx.forEach((k, j) => { out[k] = s.form.lines[j]; });
      else if (s.form) out[only.idx[0]] = s.form.text;
      else { lose(s.drop, idx.length); if (drops) for (const k of idx) drops[k] = s.drop; }
    }
    const kept = out.filter((line) => line !== null);
    append(kept, droppedNotes(lost, 'diff line(s)'));
    if (aligned) {
      aligned.lines = new Array(all.length).fill(null);
      aligned.drops = new Array(all.length).fill(null);
      for (const block of track.blocks) for (const k of block.at) aligned.drops[k] = PEM_DROP;
      for (let i = 0; i < n; i++) { aligned.lines[track.index[i]] = out[i]; aligned.drops[track.index[i]] = drops[i]; }
      aligned.groups = groups.map(({ at, entries }) => ({ at, reasons: entries.map((entry) => entry.reason) }));
    }
    return { text: kept.join('\n'), lost: lost.size > 0 };
  };

  /**
   * One logical line of a content field (`scrubLines`), through `settle`: a line of one physical
   * line is its own every view; a continued one is scanned joined and per physical line, and a
   * dirty one is emitted as these fields always emitted it, joined and masked (W3e-1 / F186).
   */
  const scanGroup = (group, turn, where) => {
    if (group.physical.length === 1 && !hasEscapedContinuation(group.joined)) {
      const r = scanLine(group.joined, turn, where);
      return r === null ? { drop: ENTROPY_DROP } : { lines: [r] };
    }
    const s = settleGroup(group, scanLine, turn, where, { written: false });
    append(dropped, s.entries ?? []);
    return s.clean ? { lines: group.physical } : s.form ? { lines: s.form.lines } : { drop: s.drop };
  };

  /**
   * Per-line scrub for multi-line content fields: named patterns replace in place, an
   * unclassifiable line is dropped, a PEM block is dropped whole, and every drop is declared by a
   * note at the end of the segment it was dropped from — one note per reason (W3e-3 / F199).
   *
   *   cut   — the field declares the recorder's head-truncation (`truncated`): its stub lines are
   *           the recorder's, and each ends the text the record holds.
   *   parts — the field is an Edit's own text (`parts`): its separator lines are the recorder's,
   *           and each ends one recorded string and starts the next.
   *
   * W3d-6 / F169: no logical line continues into a stub line. The stub is where the recorded text
   * ENDS, not a continuation of it — what followed the cut was never recorded, so there is no tail
   * to join. Joining a kept text that ends in `\` used to eat the stub's leading newline, the reader
   * (evidence/adapters/sonah-ledger.js BODY_TRUNCATION) no longer recognised it, and the recorder's
   * words became quotable as the session's code. W3e-1 holds a separator line to the same rule: it
   * is not a continuation of the string before it either.
   *
   * W3e-1 / F185: an unclosed PEM block ends at the first stub (of a declared cut) or separator
   * after it — each recorded string is its own scope, so the stub, the separator and the next side
   * survive and the key lines are still dropped and counted. A stub-shaped line in a field that
   * declares no cut is not the recorder's, and is dropped with an open block as it always was.
   *
   * W3e-1 / F184: the note is written at the end of the SEGMENT it counts — for an Edit, before
   * the separator that ends it; for any other field, at the end, as before — so no count lands
   * inside another segment, and the adapter can tell a side redaction emptied from an empty one.
   */
  const scrubLines = (text, turn, where, { cut = false, parts = 0 } = {}) => {
    if (!mask) return { text, droppedLines: 0 };
    const lines = text.split('\n');
    // 1. The recorder's structure: separator lines (an Edit's own text only) between segments;
    //    within a segment, a stub line starts a new piece. Logical lines never cross either.
    const units = [];
    let piece = null;
    lines.forEach((line, i) => {
      if (parts > 0 && i > 0 && i < lines.length - 1 && line === SEPARATOR_LINE) {
        units.push({ separator: true });
        piece = null;
        return;
      }
      const stub = i > 0 && STUB_LINE.test(line);
      if (!piece || stub) units.push(piece = { lines: [], stub });
      piece.lines.push(line);
    });
    // A YAML block under a secret-named key, within its piece (W3e-5 / F210): its lines are masked
    // where they stand before anything else reads them. A block never crosses the recorder's lines.
    for (const unit of units) if (!unit.separator) unit.lines = maskBlocks(unit.lines, turn, where).lines;
    // 2. PEM blocks over logical lines, all of them before any per-line scan, so the declarations
    //    keep the order they have always had. A block is one secret spanning lines: dropped whole.
    let inPem = false;
    for (const unit of units) {
      if (unit.separator || (unit.stub && cut)) inPem = false;
      if (unit.separator) continue;
      unit.groups = logicalLines(unit.lines);
      for (const group of unit.groups) inPem = pemStep(group, inPem, turn, where);
    }
    // 3. Every logical line through the rule; a dropped one counts its physical lines under the
    //    reason that dropped it.
    const out = [];
    let droppedLines = 0;
    const segment = new Map();
    const lose = (reason, n) => segment.set(reason, (segment.get(reason) ?? 0) + n);
    const closeSegment = () => {
      append(out, droppedNotes(segment));
      for (const n of segment.values()) droppedLines += n;
      segment.clear();
    };
    for (const unit of units) {
      if (unit.separator) {
        // The recorder's own three characters, scanned like every emitted line: always clean.
        const r = scanLine(SEPARATOR_LINE, turn, where);
        if (r === null) { lose(ENTROPY_DROP, 1); continue; }   // never; and it would fail closed
        closeSegment();
        out.push(r);
        continue;
      }
      for (const group of unit.groups) {
        if (group.pem) { lose(PEM_DROP, group.physical.length); continue; }
        const kept = scanGroup(group, turn, where);
        if (kept.drop) lose(kept.drop, group.physical.length);
        else {
          // Put the omission marker at the cut, before the next surviving words. Appending it
          // only at the end of the field made text on both sides appear contiguous to review.
          if (segment.size) closeSegment();
          append(out, kept.lines);
        }
      }
    }
    closeSegment();
    return { text: out.join('\n'), droppedLines };
  };

  // M33 R repair: the slicer's whole-change scrub (`scrubDiffWhole`): the diff channel's rules, line by line.
  if (internal?.diffLines) {
    const aligned = {};
    scrubDiff(internal.diffLines.join('\n'), null, aligned);
    return aligned;
  }

  // OWNER DECISION B (2026-10-01): a human instruction recorded within a turn (`interjections`: a queued prompt, an
  // AskUserQuestion answer) is the human's words exactly as an ask is, and is scrubbed by exactly the ask's rules —
  // whole first, and only then bounded — under the same name.
  for (const a of [...out.ask, ...(Array.isArray(out.interjections) ? out.interjections : [])]) {
    // M33 R: an attached file the slicer declared over its budget (`{ what: 'middle of turn' }`) is kept WHOLE by it; it
    // is scrubbed whole here and only the scrubbed text is bounded (`boundAsk`), so no cut ever hands redaction half a
    // token or a block whose key was cut away. Windowing (C-02 "M35 the human message in full"): a human message is
    // never bounded (`settledAsk`). What redaction withheld is declared whether it survives the cut or not;
    // the dropped tokens are counted in the text as kept, so a second pass keeps the count.
    //
    // M6: no ask is stripped by its shape any more (`ASK_STRIP_KINDS`). A persisted ledger
    // whose ask declares such a strip is settled: a strip an earlier pass made (its stub stands in the text) is kept as
    // it is; one an earlier slicer only left due (the text whole, unfolded) is withdrawn, and the text is folded and
    // trimmed as that slicer's strip pass would have, so a second pass changes nothing. `ask` stays the scrubber other
    // packages use: an ask with no strip declared is never folded here.
    const stripsDue = Array.isArray(a.elided) && a.elided.some((entry) => ASK_STRIP_KINDS.includes(entry?.what));
    let bound = null;
    if (typeof a.text === 'string') {
      const lines = a.text.split('\n').length;
      const r = scrubField(a.text, a.turn, 'ask');
      if (r.pemLines) { a.redacted = true; a.redactedLines = r.pemLines; }
      if (r.text === null || (r.pemLines && !r.retainedText.trim())) {
        // W3e-3 / F198: nothing of this instruction is left that can be shown. It used to become
        // the literal "[line dropped: …]", which the adapter placed as the HUMAN's words, quotable.
        // Now it has no text at all and declares the drop; the adapter marks it omitted.
        a.text = '';
        a.redacted = true;
        a.redactedLines = lines;
      } else {
        let scrubbed = r.text;
        if (stripsDue) {
          a.elided = a.elided.filter((entry) => !ASK_STRIP_KINDS.includes(entry?.what) || stripMade(entry, scrubbed));
          scrubbed = scrubbed.replace(/\n{3,}/g, '\n\n').trim();
          if (!a.elided.length) delete a.elided;
        }
        const due = Array.isArray(a.elided) && a.elided.some((entry) => entry?.what === ASK_MIDDLE);
        // Windowing (C-02 "M35 the human message in full"): only an attached file is bounded; a human message never is.
        bound = !due ? null : a.kind === ATTACHED_KIND ? boundAsk(scrubbed, ATTACHED_CAP) : settledAsk(scrubbed);
        a.text = bound ? bound.text : scrubbed;
        const tokenDrops = droppedTokenCount(a.text);
        if (r.text.includes('‹redacted') || droppedTokenCount(r.text)) a.redacted = true;
        if (tokenDrops) a.redactedTokens = tokenDrops;
      }
    }
    const pending = Array.isArray(a.elided) ? a.elided.findIndex((entry) => entry?.what === ASK_MIDDLE) : -1;
    // The declaration, settled: the code points this bound cut (and the names in what it cut, still named by the ask),
    // kept as it was for an ask an earlier bound already cut, and withdrawn when nothing was cut.
    if (pending >= 0) {
      if (bound?.truncated && !bound.already) {
        a.elided[pending] = { ...a.elided[pending], chars: bound.removed };
        const names = harvestMentions(bound.middle, new Set(Array.isArray(a.mentions) ? a.mentions : []));
        if (names.size) a.mentions = [...names];
      } else if (!bound?.truncated) {
        a.elided.splice(pending, 1);
        if (!a.elided.length) delete a.elided;
      }
    }
    // Names harvested from material the slicer elided (slicer/src/ask.js `harvest`): session text,
    // lowercased. A name any view flags is not kept (W3e-3: it reached the output unscanned).
    if (Array.isArray(a.mentions)) {
      const kept = a.mentions.filter((m) => !flagged(m, a.turn, 'ask mention'));
      if (kept.length !== a.mentions.length) {
        a.redacted = true;
        if (kept.length) a.mentions = kept; else delete a.mentions;
      }
    }
    // Gain I (2026-10-13): an image the human attached (slicer `humanNonTextOf`) cannot be scanned for a secret. D84:
    // the model reads it as recorded (`mask: false` keeps it); with masking on — what a person reads — its media type
    // and data are withheld (fail closed), and only its block and type stay, so its loss stays declared where it was.
    if (mask && Array.isArray(a.nonText))
      a.nonText = a.nonText.map((entry) => ({ block: entry?.block ?? null, type: entry?.type ?? null }));
  }

  for (const e of out.ledger) {
    if (e.genericTool === true && typeof e.tool === 'string') {
      const original = e.tool;
      const r = scrubField(original, e.turn, 'tool name');
      // Vendor and MCP names use punctuation as separators. Some token detectors require
      // word boundaries and would miss a credential immediately followed by an underscore.
      const spaced = original.replace(/[_./:-]+/g, ' ');
      const separated = spaced !== original ? scrubField(spaced, e.turn, 'tool name') : null;
      if (r.text !== original || separated && separated.text !== spaced) {
        e.tool = 'other';
        e.toolNameRedacted = true;
      }
    }
    // Workflow and TaskOutput expose opaque task IDs in two different native records. They may
    // establish a completion link only AFTER this pass, and only when every present ID survived
    // the same fail-closed identity scan. Never let a redaction placeholder become a join key.
    const taskIdFields = ['workflowTaskId', 'taskOutputTaskId', 'taskOutputResultTaskId'];
    const presentTaskIds = taskIdFields.filter((field) => Object.hasOwn(e, field));
    delete e.taskIdentityChecked;
    if (presentTaskIds.length || e.taskIdentityRedacted === true) {
      for (const field of presentTaskIds) {
        const value = e[field];
        if (typeof value !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_./:-]{0,199}$/.test(value)
          || flagged(value, e.turn, 'task identity')) {
          delete e[field];
          e.taskIdentityRedacted = true;
        }
      }
      e.taskIdentityChecked = true;
    }
    // JSON escapes line breaks inside string values. Scanning only the serialized text can
    // remove a PEM header while leaving its encoded body behind. Inspect decoded leaves too;
    // if any view changes, withhold the entire generic input rather than leave a misleading
    // or partly secret JSON object.
    // D84: a check of what the scan would change, so with masking off there is nothing to withhold.
    if (mask && e.genericTool === true && typeof e.argsExcerpt === 'string') {
      const original = e.argsExcerpt;
      let parsed;
      try { parsed = JSON.parse(original); } catch { parsed = undefined; }
      const leaves = [];
      const visit = (value, depth = 0) => {
        if (depth > 64) return;
        if (typeof value === 'string') { leaves.push(value); return; }
        if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
        if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
          leaves.push(key);
          visit(item, depth + 1);
        }
      };
      if (parsed !== undefined) visit(parsed);
      const views = [original, ...leaves];
      if (leaves.length) views.push(leaves.join('\n'), leaves.join(''));
      const unsafe = parsed === undefined || views.some((view) => {
        const cleaned = scrubField(view, e.turn, 'argsExcerpt');
        return cleaned.text !== view || cleaned.pemLines > 0;
      });
      if (unsafe) {
        delete e.argsExcerpt;
        e.inputRedacted = true;
        e.redacted = true;
        if (parsed === undefined) e.inputUnparsed = true;
      }
    }
    // Commands and an edit's arguments: all or nothing. Multi-line commands
    // (heredocs) and write arguments carry whole PEM blocks; those go first.
    //
    // D69 (c): a ledger an earlier slicer wrote may carry a `firstErrorLine` (deleted with its patterns); no reader reads
    // it, so it is dropped here, never scrubbed or shown, and the ledger stays readable.
    delete e.firstErrorLine;
    //
    // D69 review: a write's own arguments arrive whole and are scrubbed whole. One an earlier Sonah windowed and bounded
    // (`…[+N]` at its end, `EXCERPT_MARK`) is scrubbed without that marker, and the marker kept as it was. A generic
    // tool's input was never an excerpt: it is kept whole.
    const ownArgs = e.genericTool !== true && e.kind !== 'other' && e.attempted !== 'other';
    // M33 R repair 9, S1: what the event's naming texts (its command, its path, an edit's old line) put in scope across its
    // fields, read from them as recorded, before any field is scrubbed.
    const scope = proximityEventScope(e);
    const writes = scope?.write ? scope : null;
    const prints = scope?.output ? scope : null;
    for (const f of ['cmd', 'argsExcerpt', 'inputMetadata']) {
      if (typeof e[f] !== 'string') continue;
      const original = e[f];
      const excerpt = f === 'argsExcerpt' && ownArgs ? EXCERPT_MARK.exec(original) : null;
      const r = scrubField(excerpt ? original.slice(0, excerpt.index) : original, e.turn, f);
      if (r.pemLines) e.redacted = true;
      if (r.text !== null && f === 'argsExcerpt' && ownArgs) r.text = inherit(r.text, writes, e.turn, f);
      if (r.text === null) { delete e[f]; e.redacted = true; }
      else e[f] = excerpt ? `${r.text}${excerpt[0]}` : r.text;
      // A generic tool's input is evidence in its own right. Preserve that it was captured
      // while declaring that redaction changed or withheld what the reviewer can read.
      if (f === 'argsExcerpt' && e.kind === 'other' && e.inputRecorded === true
        && r.text !== original) e.inputRedacted = true;
      if (f === 'inputMetadata' && r.text !== original) e.inputMetadataRedacted = true;
    }
    // The pre-edit snapshot (experiment 3): the file's first version in the session, same per-line
    // posture as the diff — it is file content, which is where secrets live.
    //
    // D68 (E): both bodies arrive WHOLE (a persisted ledger's may carry an earlier Sonah's stub at its cut,
    // `truncated`) and are scrubbed whole; nothing cuts them. The lines redaction dropped are declared.
    if (e.before && typeof e.before.text === 'string') {
      const r = scrubLines(e.before.text, e.turn, 'before', { cut: e.before.truncated === true });
      r.text = inherit(r.text, writes, e.turn, 'before');
      e.before.text = r.text;
      if (r.droppedLines) { e.before.redactedLines = r.droppedLines; e.redacted = true; }
    }
    // The after-state view (S1-B) is the same kind of content as the pre-edit view: a file body,
    // which is where secrets live. Same posture, same place in the order — before sliceHash.
    if (e.after && typeof e.after.text === 'string') {
      const parts = Number.isSafeInteger(e.after.parts) && e.after.parts > 0 ? e.after.parts : 0;
      const ra = scrubLines(e.after.text, e.turn, 'after', { cut: e.after.truncated === true, parts });
      ra.text = inherit(ra.text, writes, e.turn, 'after');
      e.after.text = ra.text;
      if (ra.droppedLines) { e.after.redactedLines = ra.droppedLines; e.redacted = true; }
    }
    // M33 R repair: the slicer renders a write's diff from the change as `scrubDiffWhole` scrubbed it whole, and only
    // then cuts it. What that scrub withheld from the lines it shows is declared here, by this redactor, as the diff's:
    // `diffRedaction` is `{ reasons, lost? }` — the reasons of the declarations it made over those lines, and whether
    // it dropped any of them. Fails closed: a declaration that is not one this redactor can make withholds the diff.
    if (Object.hasOwn(e, 'diffRedaction')) {
      const declared = e.diffRedaction;
      delete e.diffRedaction;
      const valid = declared !== null && typeof declared === 'object' && !Array.isArray(declared)
        && Object.keys(declared).every((key) => key === 'reasons' || key === 'lost')
        && Array.isArray(declared.reasons) && declared.reasons.every((reason) => REDACTION_REASONS.includes(reason))
        && (declared.lost === undefined || declared.lost === true);
      if (!valid) { delete e.diff; e.redacted = true; }
      else {
        for (const reason of declared.reasons) dropped.push({ turn: e.turn, reason, where: 'diff' });
        if (declared.lost) e.redacted = true;
      }
    }
    if (typeof e.diff === 'string') {
      const r = scrubDiff(e.diff, e.turn);
      if (r.lost) e.redacted = true;
      r.text = inherit(r.text, writes, e.turn, 'diff');
      // D69 (c): the slicer computes no hunk header (its keyword list is deleted), so none is bounded here.
      e.diff = r.text;
    }
    // D68 (c2): what the slicer's whole-file or whole-change scrub of the recorded hunks withheld (`scrubHunks`), declared
    // here as the hunks' (`where: 'hunks'`), as a diff's is. A declaration this redactor cannot make withholds every
    // recorded hunk of the event (fails closed).
    if (Object.hasOwn(e, 'hunkRedaction')) {
      const declared = e.hunkRedaction;
      delete e.hunkRedaction;
      const valid = plainObject(declared) && Object.keys(declared).every((key) => key === 'reasons' || key === 'lost')
        && Array.isArray(declared.reasons) && declared.reasons.every((reason) => REDACTION_REASONS.includes(reason))
        && (declared.lost === undefined || declared.lost === true);
      if (!valid) {
        if (plainObject(e.recorded)) {
          delete e.recorded.hunks;
          delete e.recorded.hunkScrub;
          if (plainObject(e.recorded.editDiff) && Array.isArray(e.recorded.editDiff.files))
            for (const file of e.recorded.editDiff.files) if (plainObject(file)) { delete file.hunks; delete file.hunkScrub; }
          e.recorded.withheld = true;
        }
        e.redacted = true;
      } else {
        for (const reason of declared.reasons) dropped.push({ turn: e.turn, reason, where: 'hunks' });
        if (declared.lost) e.redacted = true;
      }
    }
    if (Object.hasOwn(e, 'recorded')) {
      const { facts, masked } = recordedFacts(e.recorded, e.turn, 'recorded');
      if (facts === null) delete e.recorded; else e.recorded = facts;
      if (facts?.withheld === true || masked) e.redacted = true;
    }
    // A key echoed by `cat` arrives as one tailLines entry per line.
    if (Array.isArray(e.tailLines)) {
      const originalSpans = Array.isArray(e.outputSpans)
        ? e.outputSpans.join('\n') : null;
      const r = scrubTail(e.tailLines, e.turn);
      if (r.lost) e.redacted = true;
      r.kept = inheritLines(r.kept, prints, e.turn, 'tailLines');
      e.tailLines = r.kept;
      // Native result blocks are independent quote sources. The joined view lets the
      // redactor detect secrets across block boundaries; if it changes that view, discard
      // the original blocks rather than retaining unredacted duplicates.
      if (originalSpans !== null && (r.lost || r.kept.join('\n') !== originalSpans)) {
        delete e.outputSpans;
        e.observationRedacted = true;
      }
    }
  }

  // Prose fields get the PEM / key-value / base64 line rules too (D36: replies are shown at
  // volume); token-level fail-closed keeps every readable line. Every text the claim carries, not
  // only the final message (W3e-3: a `prBody` passed through unscanned).
  if (out.claim && typeof out.claim === 'object') {
    for (const [key, value] of Object.entries(out.claim))
      if (typeof value === 'string' && value) out.claim[key] = scrubLines(value, null, 'claim').text;
  }

  // Per-turn assistant texts feed per-arc claims; a secret in a mid-session message must not
  // outlive redaction any more than one in the final message.
  //
  // M33 F repair 3, D68 (E): the slicer keeps the WHOLE statement; it is scrubbed whole here and kept whole (what the
  // agent produced is never bounded). What redaction withheld is declared; the count of dropped tokens is of the text
  // as kept, so a second pass keeps it.
  for (const s2 of out.sayings ?? []) {
    const result = scrubLines(s2.text, s2.turn, 'saying');
    s2.text = result.text;
    if (result.droppedLines) s2.redactedLines = result.droppedLines;
    const tokenDrops = droppedTokenCount(result.text);
    if (result.text.includes('‹redacted') || droppedTokenCount(result.text)) s2.redacted = true;
    if (tokenDrops) s2.redactedTokens = tokenDrops;
  }
  for (const statement of out.commentary ?? []) {
    const result = scrubLines(statement.text, statement.turn, 'commentary');
    statement.text = result.text;
    if (result.droppedLines) statement.redactedLines = result.droppedLines;
    const tokenDrops = droppedTokenCount(result.text);
    if (result.text.includes('‹redacted') || tokenDrops) statement.redacted = true;
    if (tokenDrops) statement.redactedTokens = tokenDrops;
  }
  if (out.commentaryCapture && Array.isArray(out.commentary)) {
    out.commentaryCapture.bytes = out.commentary.reduce((n,s) => n + Buffer.byteLength(s.text), 0);
  }
  // D71 (g), owner decision 2026-10-08: each project instruction file the harness gave the agent (the slicer's
  // `projectInstructions`) is scrubbed whole, as the agent's own words are, before slice_hash; what redaction withheld is
  // declared on it. Fails closed: an entry whose text is not a string keeps none.
  for (const entry of Array.isArray(out.projectInstructions) ? out.projectInstructions : []) {
    if (entry === null || typeof entry !== 'object') continue;
    if (typeof entry.text !== 'string') { entry.text = ''; entry.redacted = true; continue; }
    const result = scrubLines(entry.text, Number.isSafeInteger(entry.turn) ? entry.turn : null, PROJECT_INSTRUCTIONS_WHERE);
    entry.text = result.text;
    if (result.droppedLines) entry.redactedLines = result.droppedLines;
    const tokenDrops = droppedTokenCount(result.text);
    if (result.text.includes('‹redacted') || tokenDrops) entry.redacted = true;
    if (tokenDrops) entry.redactedTokens = tokenDrops;
  }

  // C-01 event identity (2026-10-07). The identifier the recorder wrote for a row or call (`identity.native`: a Claude
  // Code row uuid, a Codex call_id or item id; slicer event-identity.js), by which the evidence adapter names the
  // element's canonical event, is an untrusted string like every other source identity, and is scanned exactly as a
  // hand-off's call id is (`identityFields`, below). A flagged one is withheld whole — never masked into an id — and the
  // identity marked `withheld: true`, so the adapter names that event by its row position instead and counts it
  // (`event_id_withheld`). Fails closed: this is the export sanitizer C-01 lets a native identifier pass through.
  // The withholding is declared there, on the identity, and nowhere else: never as a redaction loss in `dropped`, which
  // the adapter reads as a capture loss (a dropped entry of any other reason keeps a native shortfall from being the
  // recording's sole cause, `nativeShortfallOnly`). C-01: a withheld id is counted, never a coverage loss; nothing of the
  // event is missing. A hand-off's call id, which is also its `native`, is declared once, by `identityFields` below.
  for (const row of ['ask', 'interjections', 'ledger', 'commentary', 'sayings', 'marks', 'delegations', 'projectInstructions']
    .flatMap((field) => (Array.isArray(out[field]) ? out[field] : []))) {
    const identity = row?.identity;
    if (identity === null || typeof identity !== 'object' || Array.isArray(identity)
      || typeof identity.native !== 'string') continue;
    if (firstFlaggedView(identity.native, Number.isSafeInteger(row.turn) ? row.turn : null, 'event identity')) {
      const { native, ...kept } = identity;
      row.identity = { ...kept, withheld: true };
    }
  }

  // Source identities are untrusted strings too. Keep the loss scoped to the field it cut:
  // a call ID is not the same proof as a Codex parent/task/child tuple. A surviving field is
  // merely eligible for later independent verification, never proof by its shape alone.
  const identityFields = (row, names, turn, where) => {
    const prior = row.identityUncheckedFields;
    const valid = prior === undefined || Array.isArray(prior)
      && prior.every((name) => names.includes(name)) && new Set(prior).size === prior.length;
    const lost = new Set(valid && Array.isArray(prior) ? prior : []);
    for (const field of names) {
      if (typeof row[field] !== 'string') continue;
      if (flagged(row[field], turn, where)) { row[field] = null; lost.add(field); }
    }
    if (lost.size) row.identityUncheckedFields = [...lost].sort();
    else delete row.identityUncheckedFields;
    return { lost, invalid: !valid };
  };
  const available = (row, lost, field) => !lost.has(field)
    && typeof row[field] === 'string' && row[field].length > 0;
  /** M33 W: is `text` JSON whose every decoded string and key, alone and joined by line breaks (so a key block split
   *  across strings is one text again), a scan leaves unchanged? */
  const jsonViewsClean = (text, turn) => {
    if (!mask) return true;
    let parsed;
    try { parsed = JSON.parse(text); } catch { return false; }
    const leaves = [];
    const visit = (value, depth = 0) => {
      if (depth > 64) { leaves.push(null); return; }
      if (typeof value === 'string') { leaves.push(value); return; }
      if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
      if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) {
        leaves.push(key);
        visit(item, depth + 1);
      }
    };
    visit(parsed);
    if (leaves.includes(null)) return false;
    const views = leaves.length ? [...leaves, leaves.join('\n')] : [];
    return views.every((view) => {
      const cleaned = scrubField(view, turn, 'workflow agent report');
      return cleaned.text === view && !cleaned.pemLines;
    });
  };
  for (const d of out.delegations ?? []) {
    // C-03 M33 D: a Claude hand-off's recorded sessionId is an identity too. A scrubbed one is
    // named in identityUncheckedFields and can never become a join key (slicer child-links.js).
    // M33 W: a Workflow agent's hand-off also records its run id and the workflow's name; both are identities too.
    const { lost, invalid } = identityFields(d, [...DELEGATION_IDENTITY_FIELDS,
      ...(d.kind === 'workflow-agent' ? WORKFLOW_IDENTITY_FIELDS : [])], d.turn, 'delegation');
    // Claude's Agent/Task receipt and a Codex spawn with only childId have no `kind`
    // property. The resolver treats every non-followup delegation with a surviving child
    // identity as eligible for independent proof, so the coarse flag must do the same.
    const possible = d.adapter === 'codex' && d.kind === 'followup'
      ? available(d, lost, 'target')
      : d.adapter === 'codex' && d.kind !== 'followup'
        ? available(d, lost, 'childId') || available(d, lost, 'taskName')
        : d.adapter === 'claude' && d.kind !== 'followup'
          ? available(d, lost, 'childId') : false;
    if (invalid || lost.size && !possible) d.identityUnchecked = true;
    // D68 (C-02 "M36 recorded facts"): a Claude Code Agent hand-off's typed result (its status and tool-use count),
    // rebuilt from its closed vocabulary; a status that is not a plain recorder member is withheld.
    if (Object.hasOwn(d, 'recorded')) {
      const r = d.recorded;
      const kept = {};
      let held = !plainObject(r) || Object.keys(r).some((key) => !RECORDED_FACTS.agent.includes(key)) || r.withheld === true;
      if (plainObject(r)) {
        // D69 review: the tool name and the typed status are recorder strings, read as `recordedFacts` reads one
        // (`recorderString`, then this redactor's flags, as written and with its separators as spaces); no length bound,
        // no shape guess.
        const carried = (v) => recorderString(v) && !flagged(v, d.turn, 'recorded')
          && !flagged(v.replace(/[_./:-]+/g, ' '), d.turn, 'recorded');
        if (carried(r.tool)) kept.tool = r.tool;
        else if (r.tool !== undefined) held = true;
        if (carried(r.status)) kept.status = r.status;
        else if (r.status !== undefined) held = true;
        if (isCount(r.totalToolUseCount)) kept.totalToolUseCount = r.totalToolUseCount;
        else if (r.totalToolUseCount !== undefined) held = true;
      }
      if (held) kept.withheld = true;
      if (Object.keys(kept).length) d.recorded = kept; else delete d.recorded;
    }
    if (d.parentInstruction && typeof d.parentInstruction.text === 'string') {
      const cleaned = scrubLines(d.parentInstruction.text, d.turn, 'parent agent instruction');
      d.parentInstruction.text = cleaned.text;
      if (cleaned.droppedLines) d.parentInstruction.redactedLines = cleaned.droppedLines;
      if (cleaned.droppedLines || cleaned.text.includes('‹redacted') || droppedTokenCount(cleaned.text))
        d.parentInstruction.redacted = true;
    }
    // M33 F: a helper's final report is what the parent RECEIVED — a tool result — so it is scrubbed exactly as
    // recorded tool output is (`scrubTail`, one entry per physical line, joined continued lines checked too), and
    // scrubbed WHOLE. D68 (E): it is what the helper produced, so it is kept whole — no bound (a report an earlier
    // Sonah bounded keeps its marker and `truncated`; a flag is never unset). Its redaction is declared. M33 F repair
    // 3: the report is REBUILT from its allow-list — its scrubbed text; the row (>= 1) and human turn (>= 0) it was received on, numbers the slicer wrote that
    // place it; `truncated` and `redacted`, only ever true — so no other field of it passes redaction unscrubbed. Fails
    // closed: a report that is not text keeps nothing but the fact that redaction withheld it, and where it was received.
    if (d.finalAnswer != null) {
      const report = d.finalAnswer;
      const shaped = report !== null && typeof report === 'object' && !Array.isArray(report);
      const placed = (key, least) => (shaped && Number.isSafeInteger(report[key]) && report[key] >= least
        ? { [key]: report[key] } : {});
      const where = { ...placed('record', 1), ...placed('turn', 0) };
      if (!shaped || typeof report.text !== 'string') {
        d.finalAnswer = { text: '', ...where, redacted: true };
      } else {
        // M33 W repair: a Workflow agent's report is judged by its RECORDED decoded strings first, before any scrub of
        // its serialized line. That scrub sees a JSON string's lines run together behind escapes: it can mask the one
        // line that gives the others their context (a key block's BEGIN header) and leave the rest to a decoded check
        // that no longer knows them. So any decoded string or key of the recorded text — each alone, and all joined by
        // line breaks — that a scan would change withholds the WHOLE report (fails closed), whatever the serialized
        // scrub would have masked. A report this bound already cut (a later pass) is never JSON again and is final.
        const recordedBound = report.truncated === true && report.text.split('\n').includes(FINAL_ANSWER_OMISSION);
        if (d.kind === 'workflow-agent' && report.text !== '' && !recordedBound && !jsonViewsClean(report.text, d.turn)) {
          d.finalAnswer = { text: '', ...where, redacted: true };
          continue;
        }
        const r = scrubTail(report.text.split('\n'), d.turn);
        const scrubbed = r.kept.filter((line) => typeof line === 'string').join('\n');
        const withheld = r.lost || scrubbed.includes('‹redacted') || scrubbed.includes('‹dropped')
          || droppedTokenCount(scrubbed) > 0;
        // M33 W: a Workflow agent's report is the exact recorded JSON text of its journal `result` value. JSON escapes
        // line breaks, so a key block or a `KEY=value` line inside a string can hide from a scan of the serialized
        // text. What redaction left (only a secret no decoded string shows alone: one named by its key in another
        // string) is kept only when it is still JSON and every decoded string (and key) of it is clean
        // (`jsonViewsClean`); otherwise the whole report is withheld (fails closed). A report this bound already
        // cut was checked whole before it was cut, and is never JSON again: the bound is final, so it is kept.
        const bound = report.truncated === true && scrubbed.split('\n').includes(FINAL_ANSWER_OMISSION);
        if (d.kind === 'workflow-agent' && scrubbed !== '' && !bound && !jsonViewsClean(scrubbed, d.turn)) {
          d.finalAnswer = { text: '', ...where, redacted: true };
          continue;
        }
        d.finalAnswer = { text: scrubbed, ...where,
          ...(report.truncated === true ? { truncated: true } : {}),
          ...(withheld || report.redacted === true ? { redacted: true } : {}) };
      }
    }
  }

  for (const source of out.sources ?? []) {
    const { lost, invalid } = identityFields(source, SOURCE_IDENTITY_FIELDS, null, 'recording identity');
    const possible = source.adapter === 'codex' && source.nested === true
      ? available(source, lost, 'sessionId')
        || available(source, lost, 'parentThreadId') && available(source, lost, 'taskPath')
      : source.adapter === 'codex' || source.adapter === 'claude' && source.nested !== true
        ? available(source, lost, 'sessionId')
        : source.adapter === 'claude' && source.nested === true
          ? available(source, lost, 'childId') && available(source, lost, 'sessionId') : false;
    if (invalid || lost.size && !possible) source.identityUnchecked = true;
  }
  // The lineage's session id is the same recording identity: scanned like the others (W3e-3: it
  // reached the output unscanned).
  if (out.lineage && typeof out.lineage.rootSessionId === 'string'
      && flagged(out.lineage.rootSessionId, null, 'recording identity')) out.lineage.rootSessionId = null;
  // Filenames can contain arbitrary credentials or opaque private path components. Their
  // content is not evidence of the session itself; keep only stable order and count at the
  // export boundary. No raw filename participates in an exported identity or hash.
  if (out.lineage && Array.isArray(out.lineage.files))
    out.lineage.files = out.lineage.files.map((_file, index) => `recording-${index + 1}`);
  for (const instruction of out.instructions ?? []) {
    const cleaned = scrubLines(instruction.text, instruction.turn, 'child instruction');
    instruction.text = cleaned.text;
    if (cleaned.droppedLines) instruction.redactedLines = cleaned.droppedLines;
    if (cleaned.droppedLines || cleaned.text.includes('‹redacted') || droppedTokenCount(cleaned.text))
      instruction.redacted = true;
  }
  for (const child of out.children ?? []) {
    for (const receipt of child.parentInstructions ?? []) {
      if (receipt.parentInstruction && typeof receipt.parentInstruction.text === 'string') {
        const cleaned = scrubLines(receipt.parentInstruction.text, receipt.turn, 'parent agent instruction');
        receipt.parentInstruction.text = cleaned.text;
        if (cleaned.droppedLines) receipt.parentInstruction.redactedLines = cleaned.droppedLines;
        if (cleaned.droppedLines || cleaned.text.includes('‹redacted') || droppedTokenCount(cleaned.text))
          receipt.parentInstruction.redacted = true;
      }
    }
    child.ledger = redactCore(child.ledger, { mask }).ledger;
  }

  out.dropped = dropped;
  return { ledger: out, dropped };
}

/** Shannon entropy in bits per character. */
export function entropy(s) {
  const freq = new Map();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Content hash over the ledger's bytes as `redact` returned them, with keys sorted so it is stable across runs. D84: a
 *  session review hashes its bounded, unmasked ledger (`redact(…, { mask: false })`), so one recording has one hash
 *  whatever an output masks; a SHA3-256 digest names the session and shows none of its text. `sonah slice` hashes the
 *  masked ledger it prints. */
export function sliceHash(ledger) {
  const receipt = d => ({ adapter: d.adapter, callId: d.callId, turn: d.turn,
    ...(d.source !== undefined ? { source: d.source } : {}), ...(d.record !== undefined ? { record: d.record } : {}),
    ...(d.kind ? { kind: d.kind } : {}), ...(d.parentInstruction ? { parentInstruction: d.parentInstruction } : {}),
    // M33 F: an attached final report is evidence of the hand-off; a ledger without one hashes exactly as before.
    ...(d.finalAnswer ? { finalAnswer: d.finalAnswer } : {}),
    // D68 (C-02 "M36 recorded facts"): the hand-off's typed result facts; a ledger without them hashes as before.
    ...(d.recorded ? { recorded: d.recorded } : {}) });
  const content = unit => ({ ask: unit.ask, ledger: unit.ledger, claim: unit.claim,
    // OWNER DECISION B (2026-10-01): the human's words recorded within a turn are session content; absent, the hash is
    // as before.
    ...(unit.interjections?.length ? { interjections: unit.interjections } : {}),
    // D71 (g): the project's instruction files the harness gave the agent are session content; absent, the hash is as before.
    ...(unit.projectInstructions?.length ? { projectInstructions: unit.projectInstructions } : {}),
    ...(unit.delegations?.length ? { delegationReceipts: unit.delegations.map(receipt) } : {}),
    // M33 W: a Workflow call's run record (what was linked, and each declared loss); absent, the hash is as before.
    ...(unit.workflowRuns?.length ? { workflowRuns: unit.workflowRuns } : {}),
    // M33 P: where each linked helper's work was delivered and received, and each send that split nothing; absent, the
    // hash is as before.
    ...(unit.helperSegments?.length ? { helperSegments: unit.helperSegments } : {}),
    ...(unit.helperDeliveryLosses?.length ? { helperDeliveryLosses: unit.helperDeliveryLosses } : {}),
    ...(Array.isArray(unit.commentary) ? { commentary: unit.commentary, commentaryCapture: unit.commentaryCapture } : {}),
    ...(unit.instructionAuthority === 'unchecked' ? { instructionAuthority: 'unchecked', instructions: unit.instructions,
      sources: unit.sources, capture: unit.capture, dropped: unit.dropped } : {}),
    ...(unit.children?.length ? { delegations: unit.delegations, children: unit.children.map(child => ({ source: child.source,
      content: content(child.ledger), instructions: child.ledger.instructions,
      capture: child.ledger.capture, delegations: child.ledger.delegations })) } : {}) });
  const canonical = JSON.stringify(content(ledger), sortedReplacer);
  return createHash('sha3-256').update(canonical).digest('hex');
}

function sortedReplacer(_k, v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    // Code-unit order, never localeCompare: the hash must be the same bytes on every machine
    // (audit M86 — Czech collation reordered keys and changed the digest).
    return Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }
  return v;
}
