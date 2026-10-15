// M33 brittleness M7: a secret written to a command's stdin was masked for one
// program only (`chpasswd`, plus `--password-stdin` / `--with-token`). `echo <v> | sudo -S …`, `sudo -S … <<< "<v>"` and
// `printf "<v>\n" | smbpasswd -s` reached the ledger in plaintext (3 of 3 password shapes through `scrubDiffWhole`).
//
// The rule now reads the parsed pipeline and its redirections: any literal written to the stdin of a command that reads
// a secret there — a stdin-secret flag (`-S`, `-s`, `--stdin`, `--password-stdin`, `--passwd-stdin`, …) or a name of the
// password family — is masked: what `echo` / `printf` print upstream of it, a here-string, a here-document's lines. Where
// the structure is not certain the literal is masked anyway (fail closed). Nothing masked before is unmasked.
//
// Accepted over-redaction (safety wins ties): which program takes `-s` / `-S` as its stdin-secret flag is not knowable
// globally, so `echo hello | grep -s h` loses `hello`; a password-family word anywhere in command position does the same
// (`echo x | tee passwd.bak`). Pinned below so the cost stays visible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, scrubDiffWhole, REDACTION_REASONS } from '../index.js';

const M = '‹redacted:secret-value›';
const PASSWORDS = {
  'a human password': 'Hunter2024!',
  'a passphrase': 'velvet orchid tundra marble',
  'a random token': 'a3f9c2e81b7d4f60a9e2c4b7d1f8e6a0c3b5d7f9',
};

const one = (event) => redact({ ask: [], ledger: [event] }).ledger.ledger[0];
const CHANNELS = {
  cmd: (text) => one({ turn: 1, seq: 0, kind: 'bash', cmd: text }).cmd,
  ask: (text) => redact({ ask: [{ turn: 1, text }], ledger: [] }).ledger.ask[0].text,
  'a file body': (text) => one({ turn: 1, seq: 0, kind: 'create', path: 'setup.sh', after: { text, truncated: false, lines: 1 } }).after.text,
  tailLines: (text) => one({ turn: 1, seq: 0, kind: 'bash', cmd: 'cat setup.sh', tailLines: text.split('\n') }).tailLines.join('\n'),
  diff: (text) => scrubDiffWhole(text.split('\n').map((line) => `+${line}`)).lines.join('\n'),
};
const cmdOf = CHANNELS.cmd;

/** Every 8-character run of each word of `value` (the word whole when shorter) that `out` still holds. */
const leaks = (out, value) => value.split(' ').flatMap((w) => {
  const n = Math.min(8, w.length);
  const found = [];
  for (let i = 0; i + n <= w.length; i++) if (String(out).includes(w.slice(i, i + n))) found.push(w.slice(i, i + n));
  return found;
});

function assertMasked(shapes) {
  const failures = [];
  for (const [form, shape] of Object.entries(shapes)) {
    for (const [kind, value] of Object.entries(PASSWORDS)) {
      for (const [channel, run] of Object.entries(CHANNELS)) {
        const out = run(shape(value));
        if (leaks(out, value).length) failures.push(`${channel} | ${form} | ${kind}: ${JSON.stringify(out)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
}

test('M7: the three shapes that leaked are masked, 3 password shapes each, in every channel', () => {
  assertMasked({
    'echo <v> | sudo -S': (v) => `echo ${v} | sudo -S apt-get update`,
    'sudo -S <<< "<v>"': (v) => `sudo -S apt-get update <<< "${v}"`,
    'printf "<v>\\n" | smbpasswd -s': (v) => `printf "${v}\\n" | smbpasswd -s -a bot`,
  });
  // Through scrubDiffWhole too: none of the 9 leaks (all 9 did before).
  for (const shape of [(v) => `echo ${v} | sudo -S apt-get update`, (v) => `sudo -S apt-get update <<< "${v}"`,
    (v) => `printf "${v}\\n" | smbpasswd -s`]) {
    for (const value of Object.values(PASSWORDS)) assert.deepEqual(leaks(scrubDiffWhole([`+${shape(value)}`]).lines.join('\n'), value), []);
  }
});

test('M7: here-documents, printf formats, upstream pipes, other stdin-secret flags and password-family names', () => {
  assertMasked({
    'cat <<EOF | sudo -S': (v) => `cat <<EOF | sudo -S tee /etc/apt/auth.conf\n${v}\nEOF`,
    "sudo -S <<'EOF'": (v) => `sudo -S apt-get update <<'EOF'\n${v}\nEOF\necho done`,
    'sudo -S <<-EOF, tab-indented': (v) => `sudo -S apt-get update <<-EOF\n\t${v}\n\tEOF`,
    'printf with literal text in its format': (v) => `printf '${v}%s\\n' "" | sudo -S true`,
    "printf '%s\\n' <v> | smbpasswd -s": (v) => `printf '%s\\n' '${v}' | smbpasswd -s -a bot`,
    'echo -n': (v) => `echo -n "${v}" | sudo -S true`,
    'two pipes upstream': (v) => `echo "${v}" | tr -d '\\n' | sudo -S true`,
    'passwd --stdin': (v) => `echo "${v}" | passwd --stdin bot`,
    'gh auth login --with-token': (v) => `echo ${v} | gh auth login --with-token`,
    'a JSON string holding the command': (v) => `{"command": "echo ${v} | sudo -S apt-get update"}`,
    'markdown inline code': (v) => `run \`echo ${v} | sudo -S apt-get update\` first`,
    'a redirect between': (v) => `echo ${v} 2>/dev/null | sudo -S true`,
    'a password-family name after options': (v) => `echo "${v}" | sudo -u root smbpasswd -a bot`,
  });
});

test('M7: chpasswd and docker login --password-stdin are still masked', () => {
  assertMasked({
    'echo user:<v> | chpasswd': (v) => `echo "bot:${v}" | chpasswd`,
    'chpasswd here-string': (v) => `chpasswd <<< 'bot:${v}'`,
    "printf … | sudo chpasswd": (v) => `printf '%s\\n' 'bot:${v}' | sudo chpasswd`,
    'docker login --password-stdin': (v) => `echo ${v} | docker login -u bot --password-stdin registry.example.test`,
  });
  // A program's own output into --password-stdin is no literal: the command stays readable.
  const ecr = 'aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin 1.dkr.ecr.example.test';
  assert.equal(cmdOf(ecr), ecr);
});

test('M7: where the structure is not certain, the literal is masked anyway (fail closed)', () => {
  assertMasked({
    'a subshell upstream': (v) => `(echo ${v}; echo ${v}) | passwd bot`,
    'a brace group upstream': (v) => `{ echo ${v}; echo ${v}; } | sudo -S true`,
    'a group around the command': (v) => `echo ${v} | (sleep 1; sudo -S true)`,
    'a here-document with no closing line': (v) => `sudo -S apt-get update <<EOF\nfirst\n${v}`,
    'a pipeline continued with a backslash': (v) => `echo ${v} \\\n  | sudo -S true`,
    'a pipeline continued after its pipe': (v) => `echo ${v} |\n  sudo -S true`,
  });
  // The unclosed here-document runs to the text's end: every line after it is masked.
  assert.equal(cmdOf('sudo -S true <<EOF\nfirst\nsecond'), `sudo -S true <<EOF\n${M}\n${M}`);
  // A closed one stops at its closing line; what follows is read as commands again.
  assert.equal(cmdOf('sudo -S true <<EOF\nfirst\nEOF\nls -la'), `sudo -S true <<EOF\n${M}\nEOF\nls -la`);
});

test('M7: ordinary pipes, references and other commands\' here-documents keep their bytes', () => {
  const kept = [
    'echo hello | grep h', 'cat file | sort', 'cat file | sudo -S tee /etc/hosts', 'sudo -S apt-get update < pw.txt',
    'echo $PW | sudo -S true', 'echo "${PW}" | sudo -S true', `printf '%s\\n' "$PW" | sudo -S true`,
    'echo "$(pass show sudo)" | sudo -S true', 'curl -s https://api.example.test/v1/items | jq .',
    'git log --oneline | head -5', 'cat <<EOF > notes.txt\nhello world\nEOF',
    // A here-document inside a command substitution feeds `cat`, not the command around it (`git commit -s`).
    'git commit -s -m "$(cat <<\'EOF\'\nFix the parser\n\nSigned-off-by: A\nEOF\n)"',
  ];
  for (const text of kept) for (const [channel, run] of Object.entries(CHANNELS)) {
    const want = channel === 'diff' ? text.split('\n').map((line) => `+${line}`).join('\n') : text;
    assert.equal(run(text), want, `${channel}: ${JSON.stringify(text)}`);
  }
});

test('M7: accepted over-redaction — `-s` and `-S` count for every program, so a literal piped to one is masked', () => {
  assert.equal(cmdOf('echo hello | grep -s h'), `echo ${M} | grep -s h`);
  assert.equal(cmdOf("echo '[1,2]' | jq -s add"), `echo '${M}' | jq -s add`);
});

test('M7: what the rule masks is declared under the closed reason vocabulary; redaction is idempotent and deterministic', () => {
  const texts = Object.values(PASSWORDS).flatMap((v) => [`echo ${v} | sudo -S true`, `sudo -S true <<EOF\n${v}\nEOF`]);
  const run = () => redact({ ask: [], ledger: texts.map((cmd, i) => ({ turn: 1, seq: i, kind: 'bash', cmd })) });
  const first = run();
  assert.ok(first.dropped.length > 0);
  for (const entry of first.dropped) assert.ok(REDACTION_REASONS.includes(entry.reason), entry.reason);
  assert.deepEqual(run(), first);
  const again = redact({ ask: [], ledger: first.ledger.ledger });
  assert.deepEqual(again.ledger.ledger.map((e) => e.cmd), first.ledger.ledger.map((e) => e.cmd));
});
