import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { redact, sliceHash, entropy } from '../index.js';

const led = (over) => ({ ask: [], ledger: [], claim: { finalMessage: '' }, dropped: [], ...over });

// Scrub one string through the real pipeline via a ledger cmd field.
// Returns the scrubbed string, or null when the fail-closed backstop dropped the line.
const scrub = (s) => {
  const { ledger } = redact(led({ ledger: [{ turn: 1, kind: 'bash', cmd: s }] }));
  return ledger.ledger[0].cmd ?? null;
};

test('known secret shapes are replaced, not dropped', () => {
  const { ledger, dropped } = redact(led({
    ledger: [{ turn: 1, kind: 'bash', cmd: 'export AWS_KEY=AKIAIOSFODNN7EXAMPLE && deploy' }],
  }));
  assert.match(ledger.ledger[0].cmd, /‹redacted:aws-key›/);
  assert.ok(dropped.some((d) => d.reason === 'redacted:aws-key'));
});

test('paths are never touched', () => {
  const p = 'src/config/AKIAIOSFODNN7EXAMPLE/handler.js';
  const { ledger } = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: p }] }));
  assert.equal(ledger.ledger[0].path, p, 'a filename is not a credential');
});

test('unclassifiable high-entropy content fails CLOSED and is declared', () => {
  const blob = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';
  const { ledger, dropped } = redact(led({
    ledger: [{ turn: 3, kind: 'bash', cmd: `curl -H "X-Custom: ${blob}" api` }],
  }));
  assert.equal(ledger.ledger[0].cmd, undefined, 'the line is dropped, not kept');
  assert.equal(ledger.ledger[0].redacted, true);
  assert.ok(dropped.some((d) => d.reason === 'dropped:unclassified-high-entropy'));
});

test('a git sha is benign and does not trigger a drop', () => {
  const cmd = 'git show 9ff306d4a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const { ledger } = redact(led({ ledger: [{ turn: 1, kind: 'bash', cmd }] }));
  assert.equal(ledger.ledger[0].cmd, cmd);
});

test('sliceHash is stable under key order and changes with content', () => {
  const a = led({ ask: [{ turn: 1, text: 'x' }], ledger: [{ kind: 'edit', turn: 1, path: 'a.js' }] });
  const b = led({ ask: [{ text: 'x', turn: 1 }], ledger: [{ path: 'a.js', turn: 1, kind: 'edit' }] });
  assert.equal(sliceHash(a), sliceHash(b));
  const c = led({ ask: [{ turn: 1, text: 'y' }], ledger: a.ledger });
  assert.notEqual(sliceHash(a), sliceHash(c));
});

test('M86: sliceHash is identical under en_US and cs_CZ locales, and pinned', () => {
  // The collation locale is process-wide and read once at startup, so the only honest test
  // spawns two processes. Czech orders the digraph `ch` after `h`, which reordered `childId`
  // past `historyStart` under the old localeCompare sort and changed the digest: the same
  // redacted ledger hashed to different bytes on a Czech-locale machine, so verdict caches
  // missed across machines and frozen-hash assertions failed.
  const code = `import('${new URL('../index.js', import.meta.url).href}').then(({ sliceHash }) => {
    const src = { adapter: 'claude', sessionId: 's1', childId: 'c1', parentThreadId: null, taskPath: null,
      nested: true, mixedHistory: false, forked: false, historyStart: null, identityConflict: false };
    process.stdout.write(sliceHash({ ask: [], ledger: [], claim: {}, instructionAuthority: 'unchecked',
      instructions: [], sources: [src], capture: null, dropped: [] }));
  })`;
  const run = (locale) => execFileSync(process.execPath, ['--input-type=module', '-e', code],
    { env: { ...process.env, LANG: locale, LC_ALL: locale }, encoding: 'utf8' });
  const en = run('en_US.UTF-8'), cs = run('cs_CZ.UTF-8');
  assert.equal(en, cs, 'the hash must not depend on the machine\'s collation locale');
  assert.match(en, /^[0-9a-f]{64}$/);
  // Pin the digest: any change to canonical serialisation must be deliberate and visible here.
  assert.equal(en, 'f7799fdd0fdc5335b1499c134e386eab7a4503fef0c369badcde9d553d54e173');
});

test('the entropy threshold sits above every legitimate token shape', () => {
  // The checker only ever sees whitespace-free tokens >= 24 chars, so these are the real cases.
  const legit = [
    'getUserAuthenticationTokenFromRequestHeader',
    'src_components_dashboard_settings_panel_view',
    'https://github.com/entireio/cli/blob/main/README.md',
    '4f2a91c7-28db-4a83-9d2e-482217df292d',
    '9ff306d4a1b2c3d4e5f60718293a4b5c6d7e8f90',
  ];
  const secrets = [
    'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd',
    'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    'dGhpcyBpcyBhIHRlc3Qgb2YgYmFzZTY0IGVuY29kaW5n',
  ];
  for (const s of legit) assert.ok(entropy(s) < 4.6, `${s} must not trip the backstop`);
  for (const s of secrets) assert.ok(entropy(s) >= 4.6, `${s} must trip the backstop`);
});

test('a long identifier in a command is not dropped', () => {
  const cmd = 'node -e "getUserAuthenticationTokenFromRequestHeader()"';
  const { ledger } = redact(led({ ledger: [{ turn: 1, kind: 'bash', cmd }] }));
  assert.equal(ledger.ledger[0].cmd, cmd, 'identifiers are not secrets');
});

// =============================================================================================
// Vectors below are vendored from Entire's MIT redactor test suite
// (entireio/cli redact/redact_test.go and providers.go fixtures) — see THIRD_PARTY_NOTICES.md.
// Where sonah's fail-closed design deliberately diverges from Entire's behaviour, the divergence
// is asserted explicitly and explained inline, never papered over.
//
// Supabase prefixes are assembled from fragments (their fixture style) so no complete token
// shape appears verbatim in source and secret scanners stay quiet.
const sbs = 'sb' + '_secret_';
const sbp = 'sb' + 'p_';
const sbpub = 'sb' + '_publishable_';
// The AWS-shaped key (AKIA and 16 base32 characters) is a synthetic value, assembled the same way.
const akia = 'AKIA' + 'SYNTHETICTESTKEY';

test('ESCAPE BOUNDARY: a secret glued to a literal JSON escape is still redacted', () => {
  // entireio/cli redact_test.go TestString_SupabaseProviderTokenBoundaries: a \b anchor only
  // fires after a non-word char, so in undecoded text "line1\nAKIA…" the literal 'n' abuts the
  // prefix and an anchored pattern misses it. Before this port the AWS key below reached the
  // output raw.
  const out = scrub('deploy foo\\nAKIAIOSFODNN7EXAMPLE now');
  assert.equal(out, 'deploy foo\\n‹redacted:aws-key› now');

  const ghp = scrub('line1\\nghp_1234567890abcdefghijklmnopqrstuvwxyzAB');
  assert.equal(ghp, 'line1\\n‹redacted:github-token›');

  const sb = scrub(`first line\\n${sbs}probe_20260710_7f91c2d8e4a6b3f0`);
  assert.equal(sb, 'first line\\n‹redacted:supabase-secret›');
});

test('ESCAPE BOUNDARY: replacement never corrupts an escape sequence', () => {
  // entireio/cli redact.go ~193-205: a match may begin AT the escape letter; consuming it turns
  // "\n" into a bare "\" followed by the replacement token. Before this port
  // foo\nuser@example.com became foo\‹redacted:email› — the escape was eaten.
  assert.equal(scrub('foo\\nuser@example.com'), 'foo\\n‹redacted:email›');
  // Their TestString_JSONEscapeSequences vectors: escapes in plain file lists survive verbatim.
  for (const s of [
    'controller.go\\nmodel.go\\nview.go',
    'something.go\\tanother.go',
    'C:\\\\Users\\\\test\\\\file.go',
  ]) assert.equal(scrub(s), s);
});

test('SUPABASE: low-entropy provider prefixes are redacted with no other layer backing them', () => {
  // entireio/cli providers.go + TestString_SupabaseProviderTokens (issue #1716): sb_secret_
  // bodies measure ~4.2 bits/char, below every entropy floor. Prefix+length is the only net.
  const secret = sbs + 'probe_20260710_7f91c2d8e4a6b3f0';
  assert.ok(entropy(secret) < 4.6, 'probe must stay a low-entropy regression case');

  assert.equal(scrub(secret), '‹redacted:supabase-secret›');
  assert.equal(scrub(`service_role key: ${secret}`), 'service_role key: ‹redacted:supabase-secret›');
  assert.equal(scrub(`SUPABASE_SERVICE_ROLE_KEY="${sbs}9uM4GhB0STF5R4K3HxQtlg_bzWW6DRj"`),
    'SUPABASE_SERVICE_ROLE_KEY="‹redacted:supabase-secret›"');
  assert.equal(scrub(`SUPABASE_ACCESS_TOKEN=${sbp}test_probe_20260710_test_probe_2026071`),
    'SUPABASE_ACCESS_TOKEN=‹redacted:supabase-pat›');
  // Real key bodies are base64url and contain hyphens; the charset must keep '-'.
  assert.equal(scrub(sbs + 'probe-20260710-7f91c2d8e4a6b3f0'), '‹redacted:supabase-secret›');
  // No leading anchor: glued to a preceding word char must still redact.
  assert.equal(scrub('x' + secret), 'x‹redacted:supabase-secret›');
});

test('SUPABASE: over-redaction guards — publishable keys, short bodies, bare prefix', () => {
  // entireio/cli TestString_SupabaseProviderTokenOverRedactionGuards + LengthBoundaries.
  const publishable = `NEXT_PUBLIC_SUPABASE_KEY="${sbpub}probe_20260710_7f91c2d8e4a6b3f0"`;
  assert.equal(scrub(publishable), publishable, 'publishable keys are client-side by design');
  assert.equal(scrub(sbs + 'boundary_probe_2026x'), '‹redacted:supabase-secret›', '20-char body redacts');
  assert.equal(scrub(sbs + 'boundary_probe_2026'), sbs + 'boundary_probe_2026', '19-char body is preserved');
  const prose = `the ${sbs} prefix identifies Supabase secret keys`;
  assert.equal(scrub(prose), prose, 'a bare prefix is not a credential');
});

test('SUPABASE: long-identifier over-redaction is accepted and pinned', () => {
  // entireio/cli TestString_SupabaseProviderTokenLongIdentifierOverRedaction: identifiers that
  // merely start with the prefix ARE redacted. Intentional — reintroducing an anchor or body cap
  // to "fix" this reopens the low-entropy under-redaction gap. Do not reverse silently.
  assert.equal(scrub(`func ${sbs}key_rotation_handler() {}`), 'func ‹redacted:supabase-secret›() {}');
});

test('CREDENTIALED URI: userinfo passwords are redacted for any scheme', () => {
  // entireio/cli TestString_CredentialedURIs.
  assert.equal(scrub('DATABASE_URL=postgres://app:pwd123@db.example.com:5432/app'),
    'DATABASE_URL=‹redacted:credentialed-uri›');
  assert.equal(scrub('mongo=mongodb+srv://user:pass123@cluster0.example.mongodb.net/app?retryWrites=true'),
    'mongo=‹redacted:credentialed-uri›');
  assert.equal(scrub('mysql://root:p@localhost:3306/app'), '‹redacted:credentialed-uri›');
  // Empty username — the old db-url pattern required one and leaked this whole shape.
  assert.equal(scrub('cache redis://:hunter2@localhost:6379/0'), 'cache ‹redacted:credentialed-uri›');
  assert.equal(scrub('proxy=https://user:pass@example.com/path'), 'proxy=‹redacted:credentialed-uri›');
  // No password → not a credentialed URI. DIVERGENCE from Entire: sonah has an always-on email
  // pattern, so git@github.com is redacted as an email; the scheme and path stay readable and
  // nothing secret is involved. Entire preserves the whole string.
  assert.equal(scrub('repo=ssh://git@github.com/entireio/cli'), 'repo=ssh://‹redacted:email›/entireio/cli');
  const path = 'url=https://example.com/a:b@c';
  assert.equal(scrub(path), path, 'colon+at in a path is not userinfo');
});

test('DSN: keyword, semicolon, and JDBC connection strings with real passwords are redacted whole', () => {
  // entireio/cli TestString_DatabaseConnectionStringRedaction. The pattern proposes, the
  // password gate disposes: no non-placeholder password, no redaction.
  assert.equal(scrub('dsn="host=db.example.com port=5432 user=svc password=secret dbname=app sslmode=require"'),
    'dsn="‹redacted:keyword-dsn›"');
  assert.equal(scrub('password=secret sslmode=require user=svc host=db.example.com dbname=app'),
    '‹redacted:keyword-dsn›');
  assert.equal(scrub('conn=Server=tcp:db.example.com,1433;Database=app;User Id=svc;Password=secret;Encrypt=true'),
    'conn=‹redacted:semicolon-dsn›');
  assert.equal(scrub('conn=Driver={ODBC Driver 18 for SQL Server};Server=db;UID=svc;PWD=secret;Database=app'),
    'conn=‹redacted:semicolon-dsn›');
  assert.equal(scrub('jdbc:postgresql://db.example.com:5432/app?user=svc&password=secret&ssl=true'),
    '‹redacted:jdbc-dsn›');
  assert.equal(scrub('jdbc:sqlserver://db.example.com:1433;databaseName=app;user=svc;password=secret;encrypt=true'),
    '‹redacted:jdbc-dsn›');
  assert.equal(scrub('DATABASE_URL=postgresql://db.example.com:5432/app?user=svc&password=secret&sslmode=require'),
    'DATABASE_URL=‹redacted:db-url-query›');
  // Quoted password with embedded semicolons must not split the capture.
  assert.equal(scrub('conn=Server=db.example.com;User ID=svc;Password="se;cret;here";Encrypt=true'),
    'conn=‹redacted:semicolon-dsn›');
});

test('DSN: placeholder password in a database URL — sonah fails closed where Entire preserves', () => {
  // Entire preserves this string outright (the ${DB_PASSWORD} placeholder clears its gate and it
  // has no entropy backstop). Sonah's gate also clears it — no region is emitted — but the URL
  // token itself measures 4.85 bits/char, so the fail-closed backstop drops the line. That is
  // the designed asymmetry: an over-drop costs one row; this test pins that it NEVER leaks and
  // NEVER gets half-redacted.
  const out = scrub('DATABASE_URL=postgresql://db.example.com/app?user=svc&password=${DB_PASSWORD}');
  assert.equal(out, null, 'fail closed: dropped whole, not kept or partially scrubbed');
});

test('CREDENTIAL KV: db-prefixed password variables are redacted even at low entropy', () => {
  // entireio/cli TestString_BoundedCredentialValueRedaction.
  assert.equal(scrub('DB_PASSWORD=secret123'), 'DB_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub("PGPASSWORD='secret123'"), "PGPASSWORD='‹redacted:db-credential›'");
  assert.equal(scrub('MYSQL_ROOT_PASSWORD=secret123'), 'MYSQL_ROOT_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('MONGO_INITDB_ROOT_PASSWORD=secret123'), 'MONGO_INITDB_ROOT_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('APP_DB_PASSWORD=secret123'), 'APP_DB_PASSWORD=‹redacted:db-credential›',
    'prefix joined by underscore still matches via the non-alphanumeric boundary');
  assert.equal(scrub('DB__PASSWORD=secret123'), 'DB__PASSWORD=‹redacted:db-credential›');
});

test('CREDENTIAL KV: over-redaction guards', () => {
  // entireio/cli TestString_BoundedCredentialValueOverRedactionGuards.
  for (const s of [
    'DB_PASSWORD=${DB_PASSWORD}',
    'DB_PASSWORD=REDACTED',
    'DB_PASSWORD=<password>',
    'DB_PASSWORD=your_password',
    'DB_PASSWORD=<your-db-password>',
    'DB_PASSWORD=*****',
    'DB_PASSWORD=......',
    'DB_PASSWORD=secret_here',
    'DB_PASSWORD=placeholder',
    'DB_PASSWORD_HASH=abcdef',
    'MYSQL_USER_ID=alice',
    'PWD=/workspace/project',
    'the password field should be rotated regularly',
    'key=not-a-secret-setting',
    'https://example.com/?password_reset=true',
  ]) assert.equal(scrub(s), s, `must be preserved: ${s}`);
});

test('PLACEHOLDER: single-char masks and opaque <…> wrappers fall through to redaction', () => {
  // entireio/cli TestString_ShortAndOpaquePlaceholdersFallThrough: short or digit-bearing
  // values are not documentation placeholders.
  assert.equal(scrub('DB_PASSWORD=x'), 'DB_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('DB_PASSWORD=xx'), 'DB_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('DB_PASSWORD=*'), 'DB_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('DB_PASSWORD=<hunter2>'), 'DB_PASSWORD=‹redacted:db-credential›');
  assert.equal(scrub('DB_PASSWORD=<RealPassword>'), 'DB_PASSWORD=‹redacted:db-credential›');
});

test('PLACEHOLDER SPLIT: a greedy finding is never truncated at a placeholder head', () => {
  // entireio/cli redact.go ~219-234: the placeholder check runs on the EXACT whole capture.
  // Stopping at "changeme" would leak the real secret in the tail.
  assert.equal(scrub('password=changeme&db_pass=hunter2hunter2'), 'password=‹redacted:password-assignment›');
  assert.equal(scrub('password="changeme;realSecret42"'), 'password="‹redacted:password-assignment›"');
  assert.equal(scrub('password=changeme&sslmode=require'), 'password=‹redacted:password-assignment›');
  // An exact placeholder, alone, stays visible.
  assert.equal(scrub('password=changeme'), 'password=changeme');
  assert.equal(scrub('password=not-a-secret-setting'), 'password=‹redacted:password-assignment›');
});

test('GAP CLOSED: shell shorthand --password= is redacted (deliberate deviation from Entire)', () => {
  // entireio/cli TestString_MysqlShellShorthandIsNotRedacted pins --password= as a known gap in
  // their pipeline. Shell commands are sonah's PRIMARY surface, so the boundary class here
  // includes '-' and the gap is closed. Inverting this vector is intentional.
  assert.equal(scrub('mysql -u svc --password=hunter2 -h db.example.com app'),
    'mysql -u svc --password=‹redacted:password-assignment› -h db.example.com app');
});

test('IDEMPOTENT: f(f(x)) === f(x) for every replacement shape', () => {
  // entireio/cli TestString_RedactionIsIdempotent.
  const inputs = [
    'DATABASE_URL=postgres://svc:hunter2@db.example.com/app',
    'DB_PASSWORD=hunter2',
    'conn=Server=db.example.com;User ID=svc;Password="se;cret;here";Encrypt=true',
    'jdbc:postgresql://db.example.com:5432/app?user=svc&password=hunter2',
    'export AWS_KEY=AKIAIOSFODNN7EXAMPLE && deploy',
    sbs + 'probe_20260710_7f91c2d8e4a6b3f0',
  ];
  for (const input of inputs) {
    const once = scrub(input);
    assert.notEqual(once, null, `must not fail closed on a classified secret: ${input}`);
    assert.equal(scrub(once), once, `not idempotent for: ${input}`);
  }
});

test('PATHS WITH SPACES: a repo may live in "Acme Labs" and every detector must survive it', () => {
  // The repo's oldest enemy. None of the ported patterns may fire on, corrupt, or drop a
  // command that carries a space-bearing path.
  for (const s of [
    'cd "/Users/x/Acme Labs/deviation" && npm test',
    'cp /Users/x/Acme Labs/deviation/index.js /tmp/out.js',
    'ls -la /Users/x/Acme Labs',
    'Reading file: /tmp/test/model.go',
  ]) assert.equal(scrub(s), s, `must be preserved verbatim: ${s}`);
  // DIVERGENCE from Entire's TestString_FilePaths, pinned rather than hidden: a macOS
  // /private/var/folders/... token measures 4.72 bits/char, so a cmd carrying one is dropped by
  // the fail-closed backstop (pre-existing behaviour, unchanged by this port — the `path` FIELD
  // is never scrubbed and never at risk). Entire preserves it; making it BENIGN here would let
  // any unknown secret hide inside a path-shaped token, which is exactly what fail-closed forbids.
  assert.equal(scrub('/private/var/folders/v4/31cd3cg52_sfrpb1mbtr7q7r0000gn/T/TestE2E_Something/controller'),
    null, 'high-entropy tmp path in cmd text fails closed');
  // And a real secret next to a space-bearing path is still caught, path untouched.
  assert.equal(scrub('PGPASSWORD=hunter2 pg_dump "/Users/x/Acme Labs/db"'),
    'PGPASSWORD=‹redacted:db-credential› pg_dump "/Users/x/Acme Labs/db"');
});

test('ENTROPY FLOOR: 4.6 holds against Entire\'s vectors; 4.5 would fail closed on real ids', () => {
  // Re-evaluated 2026-08-31 against entireio/cli redact_test.go (their floor: 4.5,
  // redact.go ~59-63). Two findings, both pinned here:
  //   1. No secret in their vector set lands in [4.5, 4.6): every low-entropy secret is caught
  //      by a named pattern, and everything caught only by entropy sits >= 4.66. Moving to 4.5
  //      buys no recall.
  //   2. Their OpenCode message id measures 4.548. Entire tolerates 4.5 because a JSONL layer
  //      skips id fields before entropy runs; sonah has no field skip, so 4.5 would drop real
  //      rows. 4.6 is the correct floor for THIS architecture.
  const msgId = 'msg_cb99a444f001Ftd3kTVmr8XQHZ';
  assert.ok(entropy(msgId) >= 4.5, 'the id sits above Entire\'s floor — the falsifying case for 4.5');
  assert.ok(entropy(msgId) < 4.6, 'and below sonah\'s floor');
  const cmd = `sonah check --session ${msgId} --json`;
  assert.equal(scrub(cmd), cmd, 'a transcript row carrying an OpenCode id must survive');
  // Low-entropy secrets from their vectors are all caught by name, not entropy:
  for (const [s, label] of [
    ['key=' + akia, 'aws-key'],                                           // 3.18 bits/char
    [sbs + 'probe_20260710_7f91c2d8e4a6b3f0', 'supabase-secret'],         // 4.20
    ['SUPABASE_ACCESS_TOKEN=' + sbp + 'test_probe_20260710_test_probe_2026071', 'supabase-pat'], // 3.60
  ]) assert.match(scrub(s), new RegExp(`‹redacted:${label}›`), `named pattern must catch: ${s}`);
});

test('D32: a pasted blob in an ASK drops the token, not the turn — the contract survives', () => {
  const blob = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';
  const { ledger, dropped } = redact(led({
    ask: [{ turn: 1, text: `add rate limiting to the upload route. do not touch billing. context: ${blob}` }],
    claim: { finalMessage: `Done. Rate limiting added. Trace id ${blob}` },
  }));
  assert.match(ledger.ask[0].text, /do not touch billing/, 'the prohibition is still readable');
  assert.ok(!ledger.ask[0].text.includes(blob), 'the unclassified token is gone');
  assert.match(ledger.ask[0].text, /‹dropped:high-entropy›/, 'the absence is marked in place');
  assert.match(ledger.claim.finalMessage, /Rate limiting added/);
  assert.ok(!ledger.claim.finalMessage.includes(blob));
  assert.ok(dropped.some((d) => d.reason === 'dropped:unclassified-high-entropy-token' && d.where === 'ask'));
  // Command fields keep the whole-line posture (the DSN and tmp-path tests above pin it).
  const cmdOut = redact(led({ ledger: [{ turn: 2, kind: 'bash', cmd: `curl -H "X: ${blob}" api` }] }));
  assert.equal(cmdOut.ledger.ledger[0].cmd, undefined, 'commands still drop the line');
});

test('D31 diffs are scrubbed before sliceHash: secrets replaced, unclassifiable lines dropped, rest kept', () => {
  const blob = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';
  const diff = ['@@ .env @@', '-AWS_KEY=' + akia, '+AWS_KEY=AKIAIOSFODNN7EXAMPLE', ' PORT=3000', '+TOKEN=' + blob, '+TRACE=' + blob].join('\n');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 2, kind: 'edit', path: '.env', diff }] }));
  const out = ledger.ledger[0].diff;
  assert.ok(!out.includes(akia), 'named secret gone');
  assert.match(out, /‹redacted:aws-key›/);
  assert.match(out, /PORT=3000/, 'benign lines kept');
  assert.ok(!out.includes(blob), 'unclassifiable token gone');
  // A secret-NAMED key is masked in place, exactly as the same line is in a pre-edit snapshot
  // (M85); a key with no secret-ish name has only the entropy backstop, so its line is dropped.
  assert.match(out, /^\+TOKEN=‹redacted:secret-value›$/m, 'the named key is masked, not dropped');
  assert.ok(!/TRACE/.test(out), 'the unnamed high-entropy line is dropped whole');
  assert.match(out, /1 diff line\(s\) dropped/, 'the drop is declared inside the diff');
  assert.equal(ledger.ledger[0].redacted, true);
  assert.ok(dropped.some((d) => d.where === 'diff'));
});

test('pre-edit snapshots (before.text) are scrubbed line by line like diffs', () => {
  const blob = 'Zk3!q9Xv%2Lp#7Rw@Nb^4Ty&8Ue*Hs$Jd';
  const text = ['export const PORT = 3000;', `const key = "${akia}";`, 'const junk = "' + blob + '";', 'export default PORT;'].join('\n');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 4, kind: 'edit', path: 'src/config.js', before: { text, source: 'read', turn: 2 } }] }));
  const out = ledger.ledger[0].before.text;
  assert.match(out, /PORT = 3000/);
  assert.match(out, /‹redacted:aws-key›/);
  assert.ok(!out.includes(blob));
  assert.match(out, /1 line\(s\) dropped/);
  assert.equal(ledger.ledger[0].before.redactedLines, 1);
  assert.equal(ledger.ledger[0].redacted, true);
  assert.ok(dropped.some((d) => d.where === 'before'));
});

test('SECURITY REVIEW: a marker never shields the secret glued to it', () => {
  const out = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: '.env', diff: `+AWS=${akia}:wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY` }] })).ledger.ledger[0].diff;
  assert.ok(!out.includes('wJalrXUtnFEMI'), 'the secret half is gone: ' + out);
  assert.ok(!out.includes(akia), 'the key half is gone too');
  assert.ok(/‹redacted:aws-key›|diff line\(s\) dropped/.test(out), 'replaced or dropped, never kept');
});

test('SECURITY REVIEW: PEM blocks drop whole; long base64 in file content is not benign; key-named values go whatever their shape', () => {
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy2l1Ce0Y2pMtE2zSo9lY2b', 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Qgb2YgdGhlIGVtZXJnZW5jeSBicm9h', '-----END RSA PRIVATE KEY-----', 'PORT=3000'].join('\n');
  const r1 = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: 'k.pem', before: { text: pem, source: 'read', turn: 1 } }] }));
  const t1 = r1.ledger.ledger[0].before.text;
  assert.ok(!t1.includes('MIIEowIBAAKCAQEA'), 'PEM body gone'); assert.ok(!t1.includes('END RSA')); assert.match(t1, /PORT=3000/);
  assert.ok(r1.dropped.some((d) => d.reason === 'dropped:pem-block'));
  const b64 = 'data:\n  token: ' + 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5YWJjZGVmZ2hpams=';
  const t2 = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: 'secret.yaml', before: { text: b64, source: 'read', turn: 1 } }] })).ledger.ledger[0].before.text;
  assert.ok(!t2.includes('QUJDREVGR0hJSktM'), 'a 60-char base64 value in file content is not benign: ' + t2);
  const kv = ['DB_PASS="Tr0ub4dor&3"', 'password: hunter2', 'API_KEY = ' + String.fromCharCode(36) + '{API_KEY}', 'name = "alpha"', 'export GH_TOKEN=ghp_ABCDEFGHIJKLMNOPQR\\\nSTUVWXYZ0123456789abcdefgh'].join('\n');
  const t3 = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: 'config.py', before: { text: kv, source: 'read', turn: 1 } }] })).ledger.ledger[0].before.text;
  assert.ok(!t3.includes('Tr0ub4dor'), 'short punctuated password gone: ' + t3);
  assert.ok(!t3.includes('hunter2'), 'colon-assigned password gone');
  assert.ok(t3.includes('API_KEY = ' + String.fromCharCode(36) + '{API_KEY}'), 'a placeholder stays: ' + t3);
  assert.match(t3, /name = "alpha"/, 'non-secret keys untouched');
  assert.ok(!t3.includes('STUVWXYZ0123456789abcdefgh'), 'a continuation-split token leaks no tail');
});

test('D36: sayings and the final message get the line rules — PEM bodies and key-named values never reach the prompt', () => {
  const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy2l1Ce0Y2pMtE2zSo9lY2b', '-----END RSA PRIVATE KEY-----', 'Here is the summary.', 'STRIPE_SECRET: p@ss-w0rd!'].join('\n');
  const { ledger } = redact(led({ sayings: [{ turn: 2, text: pem }], claim: { finalMessage: pem } }));
  for (const out of [ledger.sayings[0].text, ledger.claim.finalMessage]) {
    assert.ok(!out.includes('MIIEowIBAAKCAQEA'), 'PEM body gone');
    assert.ok(!out.includes('p@ss-w0rd'), 'key-named value gone');
    assert.match(out, /Here is the summary\./, 'prose lines stay');
  }
});

// =============================================================================================
// H41 / M85 — a secret must not survive because of the CHANNEL it arrived on.
// =============================================================================================

// A synthetic RSA key: the header is decoration, the base64 body IS the private key.
const PEM = ['-----BEGIN RSA PRIVATE KEY-----',
  'MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF8PbnGy1hJvKq9zJ4QwT5lpBcXyz',
  'Qm3s8bTn2wIDAQABAoIBAQCt7L3mR9xY2k1ZVtqfa0K8x1QpQ2sM8f7Tt6y1Ubqz',
  '-----END RSA PRIVATE KEY-----'];
const BODY = PEM[1];

// The same key arriving on each channel redaction actually has.
const pemLedger = (where, lines) => {
  if (where === 'ask') return led({ ask: [{ turn: 1, text: `key:\n${lines.join('\n')}\nthanks` }] });
  if (where === 'cmd') return led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: `cat <<EOF\n${lines.join('\n')}\nEOF` }] });
  if (where === 'tailLines') return led({ ledger: [{ turn: 1, seq: 0, kind: 'bash', cmd: 'cat k', tailLines: [...lines] }] });
  return led({ ledger: [{ turn: 1, seq: 0, kind: 'create', path: 'k.pem', argsExcerpt: lines.join('\n') }] });
};

for (const where of ['ask', 'cmd', 'tailLines', 'argsExcerpt']) {
  test(`H41: a PEM block is dropped whole in ${where}`, () => {
    // Only scrubLines (claim / saying / commentary / before) carried the PEM state machine, so
    // outside it only the -----BEGIN line was masked and every base64 body line survived.
    const { ledger, dropped } = redact(pemLedger(where, PEM));
    assert.ok(!JSON.stringify(ledger).includes(BODY), `${where}: the key body must not survive`);
    assert.ok(!JSON.stringify(ledger).includes(PEM[2]), `${where}: no body line may survive`);
    assert.ok(dropped.some((d) => d.reason === 'dropped:pem-block' && d.where === where),
      `${where}: the drop must be declared once as dropped:pem-block`);
  });

  test(`H41: a lone PEM body line is dropped in ${where}`, () => {
    // Seen without its header — one tailLines entry, one pasted line. Still 64 characters of
    // base64, which the BENIGN base64 exemption used to wave through on non-content channels.
    const { ledger } = redact(pemLedger(where, [BODY]));
    assert.ok(!JSON.stringify(ledger).includes(BODY), `${where}: a headerless key body must not survive`);
  });
}

test('H41: a PEM block in an event diff is dropped whole and declared', () => {
  const diff = PEM.map((l) => '+' + l).join('\n');
  const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, seq: 0, kind: 'edit', path: 'k.pem', diff }] }));
  assert.ok(!ledger.ledger[0].diff.includes(BODY));
  assert.ok(!ledger.ledger[0].diff.includes('END RSA'), 'the block goes whole, not line by line');
  assert.ok(dropped.some((d) => d.reason === 'dropped:pem-block' && d.where === 'diff'));
});

// D82 step 10: the pull request's diff blocks are no longer read (the PR comment reads the PR's metadata only), so
// `scrubDiffBlock` is gone; what it checked is the ledger's diff field itself, given a whole unified-diff block.
test('the diff channel scrubs a whole unified-diff block, its headers included', () => {
  const diffOf = (diff) => redact({ ask: [], ledger: [{ turn: 0, diff }] }).ledger.ledger[0].diff;
  const block = `diff --git a/k.pem b/k.pem\n--- /dev/null\n+++ b/k.pem\n@@ -0,0 +1,4 @@\n${PEM.map((l) => '+' + l).join('\n')}\n`;
  assert.ok(!diffOf(block).includes(BODY), 'the key body does not survive');
  // Without its header, where nothing but the base64 shape gives the body away.
  const bare = diffOf(`diff --git a/k.b64 b/k.b64\n--- /dev/null\n+++ b/k.b64\n@@ -0,0 +1,1 @@\n+${BODY}\n`);
  assert.ok(!bare.includes(BODY));
  // A secret-named key=value on a hunk line (F1).
  const kv = diffOf('diff --git a/.env b/.env\n--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n+STRIPE_SECRET: p@ss-w0rd!\n');
  assert.ok(!kv.includes('p@ss-w0rd!'));
  assert.ok(kv.includes('+STRIPE_SECRET: ‹redacted:secret-value›'), 'the hunk marker is re-attached');
  // A clean block comes back byte for byte.
  const clean = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;\n';
  assert.equal(diffOf(clean), clean);
});

test('M85: a secret-named value is masked identically in before.text and in a diff hunk line', () => {
  // The SECRET_KEY rule is ^-anchored, so `+STRIPE_SECRET: ...` never matched it and the value
  // survived in a diff while the identical line in a pre-edit snapshot was masked.
  const line = 'STRIPE_SECRET: p@ss-w0rd!';
  const masked = 'STRIPE_SECRET: ‹redacted:secret-value›';
  const snapshot = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: '.env', before: { text: line, source: 'read', turn: 1 } }] }));
  assert.equal(snapshot.ledger.ledger[0].before.text, masked);
  for (const prefix of ['+', '-', ' ']) {
    const { ledger, dropped } = redact(led({ ledger: [{ turn: 1, kind: 'edit', path: '.env', diff: prefix + line }] }));
    assert.equal(ledger.ledger[0].diff, prefix + masked, `hunk marker ${JSON.stringify(prefix)} is kept, the value is not`);
    assert.ok(dropped.some((d) => d.reason === 'redacted:secret-key-value' && d.where === 'diff'));
  }
  // A placeholder still stays readable, prefix or not.
  const ph = 'STRIPE_SECRET: ' + String.fromCharCode(36) + '{STRIPE_SECRET}';
  assert.equal(redact(led({ ledger: [{ turn: 1, kind: 'edit', path: '.env', diff: '+' + ph }] })).ledger.ledger[0].diff, '+' + ph);
});
