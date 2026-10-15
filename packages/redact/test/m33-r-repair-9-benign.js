// M33 R repair 9 — more of the over-mask budget's benign corpus, written for the shapes repair 9's wider scope reads: code
// whose `:` closes a construct on a password-named identifier, pretty-printed name/value data holding no value, blocks
// and sections under a secret word, wrapped prose, records (git, logs, test runners) beside the vocabulary, and EVENTS —
// a command whose own text names a token, a password or a key and whose output holds none, a read or a write of a file
// so named. Every line is written here (no recording read); hashes, ids and timestamps are invented. Repair 8's corpus
// (m33-r-repair-8-benign.js) is read with it.
//
// Read by redact/test/m33-r-repair-9.test.js, which reports the share of lines kept byte for byte and lists every line
// that is not.

export const BENIGN_DOCUMENTS_9 = {
  'auth service (Python)': `import bcrypt
from django.contrib.auth.hashers import make_password, check_password

MIN_PASSWORD_LENGTH = 12
PASSWORD_RESET_TTL = 3600

def set_password(user, raw_password):
    if len(raw_password) < MIN_PASSWORD_LENGTH:
        raise ValueError("password must be at least 12 characters")
    if raw_password.lower() in COMMON_PASSWORDS:
        raise ValueError("password is too common")
    user.password_hash = make_password(raw_password)
    user.save(update_fields=["password_hash"])

def verify(user, raw_password):
    return check_password(raw_password, user.password_hash)

def rotate_api_key(account):
    for key in account.api_keys.filter(revoked=False):
        key.revoked = True
        key.save()
    return account.api_keys.create(prefix=generate_prefix(8))

class PasswordResetToken(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    token_hash = models.CharField(max_length=64)
    expires_at = models.DateTimeField()`,
  'ssm describe-parameters (no values)': `{
    "Parameters": [
        {
            "Name": "/recall/api-key",
            "Type": "SecureString",
            "KeyId": "alias/aws/ssm",
            "LastModifiedDate": "2026-09-28T10:41:07.512000+00:00",
            "Version": 3,
            "Tier": "Standard",
            "DataType": "text"
        },
        {
            "Name": "/recall/region",
            "Type": "String",
            "Version": 1,
            "Tier": "Standard"
        }
    ]
}`,
  'Postman environment (placeholders)': `{
  "name": "recall staging",
  "values": [
    {
      "key": "baseUrl",
      "value": "https://api.staging.example.test",
      "enabled": true
    },
    {
      "key": "apiKey",
      "value": "{{RECALL_API_KEY}}",
      "type": "secret",
      "enabled": true
    }
  ]
}`,
  'Terraform sensitive variables': `variable "recall_api_key" {
  type        = string
  description = "API key for the recall sync job, set from the CI secret store"
  sensitive   = true
}

variable "db_password" {
  type      = string
  sensitive = true
  nullable  = false
}

resource "aws_ssm_parameter" "recall_api_key" {
  name  = "/recall/api-key"
  type  = "SecureString"
  value = var.recall_api_key
  tags  = { team = "platform", rotation = "90d" }
}`,
  'Kubernetes env from secrets': `spec:
  containers:
    - name: sync
      image: ghcr.io/example/recall-sync:1.14.2
      env:
        - name: RECALL_API_KEY # mounted from the recall secret
          valueFrom:
            secretKeyRef:
              name: recall-secrets
              key: api-key
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: recall-db
              key: password
        - name: LOG_LEVEL
          value: info`,
  'GitHub workflow (pinned actions)': `jobs:
  release:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11
        with:
          token: \${{ secrets.RELEASE_TOKEN }}
      - uses: actions/setup-node@8f152de45cc393bb48ce5d89d36b731f54556e65
        with:
          node-version: 20
      - run: npm ci
      - run: npm publish
        env:
          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}`,
  'runbook (API keys section)': `# Recall operations

## Rotating API keys

Keys are rotated every 90 days by the rotate-keys job.
The job writes the new key to the secret store and restarts the sync workers.
See the rotate-keys workflow, run 4521, for the last rotation.

1. Open the admin console.
2. Choose Settings, then API keys.
3. Revoke the key with the oldest creation date.

## Deploys

Deploys go out from main after CI passes.
The last deploy was build 1.14.2 at 08:40 UTC.`,
  'release email (wrapped prose)': `Hi all,

We rotated the recall API key this morning as part of the quarterly rotation; the old key
stops working on October 3 at 09:00 UTC. No action is needed for services that read the
key from the secret store. If you pinned it in a local .env file, pull the new value from
the vault entry recall/api-key and restart your worker.

Thanks,
Platform`,
  'git log (auth work)': `$ git log --oneline -8
9c1e7a2 Merge pull request #412 from example/rotate-keys
5b3f0d9 Rotate the signing key on a schedule
e48a1c6 Fix flaky retry test
2d7b9f4 Add password strength meter to signup
71ac3e8 Bump eslint to 9.11.1
0f6d2b5 Document the token refresh flow
c39e5a1 Remove unused helpers
88b2f17 Initial import`,
  'service log (tokens)': `2026-09-30T08:14:02.117Z INFO  sync worker started (pid 48213)
2026-09-30T08:14:05.402Z WARN  token refresh failed for tenant acme, retrying in 5s
2026-09-30T08:14:10.415Z INFO  token refreshed for tenant acme request_id=7f3a9c2e1b44
2026-09-30T08:15:00.000Z INFO  rotated api key prefix rk_live_ for tenant acme
2026-09-30T08:15:00.912Z INFO  sync batch 18 done in 812ms (1204 items)
2026-09-30T08:16:31.006Z ERROR password reset mail bounced for user 48213
2026-09-30T08:16:31.007Z INFO  queue depth 0`,
  'vitest output (token tests)': `> recall-api@1.14.2 test
> vitest run src/auth

 ✓ src/auth/token.test.ts (12 tests) 41ms
 ✓ src/auth/password.test.ts (9 tests) 118ms
 ✓ src/auth/api-key.test.ts (6 tests) 22ms

 Test Files  3 passed (3)
      Tests  27 passed (27)
   Start at  08:20:11
   Duration  1.42s`,
  'OAuth response (no token)': `HTTP/1.1 200 OK
content-type: application/json
x-request-id: 2b7c1f0e

{
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "repo read:org",
  "created_at": 1727683200
}`,
  'React login form': `export function LoginForm({ onSubmit }: Props) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(password); }}>
      <label htmlFor="password">Password</label>
      <input id="password" type={showPassword ? 'text' : 'password'} value={password}
        onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      <button type="submit">Sign in</button>
    </form>
  );
}`,
  'Vault policy (HCL)': `path "secret/data/recall/*" {
  capabilities = ["read", "list"]
}

path "secret/metadata/recall/*" {
  capabilities = ["list"]
}`,
  'package-lock excerpt': `    "node_modules/@octokit/auth-token": {
      "version": "4.0.0",
      "resolved": "https://registry.npmjs.org/@octokit/auth-token/-/auth-token-4.0.0.tgz",
      "license": "MIT",
      "engines": {
        "node": ">= 18"
      }
    },`,
  'docker compose secrets': `services:
  sync:
    image: recall-sync:1.14.2
    secrets:
      - recall_api_key
      - db_password
secrets:
  recall_api_key:
    file: ./secrets/recall_api_key.txt
  db_password:
    environment: DB_PASSWORD`,
  'agent summary (prose)': `I moved the API key lookup into config.ts so the sync job and the CLI read it the same way.
The key itself still comes from RECALL_API_KEY; nothing is hard-coded.
Tests: 27 passed, 0 failed. The password reset tests were already flaky on main and still are.
Next I would add a check that fails fast when the token is missing.`,
};

const numbered = (lines) => lines.map((line, i) => `${String(i + 1).padStart(6)}\t${line}`);

/** Events whose command or path names a secret and whose output or content holds none. */
export const BENIGN_EVENTS_9 = {
  'npm test -- token': { turn: 1, seq: 0, kind: 'bash', cmd: 'npm test -- token',
    tailLines: ['> recall-api@1.14.2 test', '> vitest run token', '', ' ✓ src/auth/token.test.ts (12 tests) 41ms', '',
      ' Test Files  1 passed (1)', '      Tests  12 passed (12)', '   Duration  612ms'] },
  'grep -rn api_key src/': { turn: 1, seq: 0, kind: 'bash', cmd: 'grep -rn "api_key" src/',
    tailLines: ['src/config.py:12:    api_key = os.environ["RECALL_API_KEY"]', 'src/client.py:31:        headers={"x-api-key": api_key},',
      'src/client.py:58:    if not api_key:'] },
  'kubectl get secrets': { turn: 1, seq: 0, kind: 'bash', cmd: 'kubectl get secrets -n recall',
    tailLines: ['NAME                TYPE     DATA   AGE', 'recall-api-key      Opaque   1      12d', 'recall-db           Opaque   2      90d'] },
  'gh auth status': { turn: 1, seq: 0, kind: 'bash', cmd: 'gh auth status --show-token=false',
    tailLines: ['github.com', '  ✓ Logged in to github.com account ada (keyring)', '  - Active account: true', '  - Git operations protocol: https',
      "  - Token scopes: 'gist', 'read:org', 'repo'"] },
  'aws secretsmanager list-secrets': { turn: 1, seq: 0, kind: 'bash', cmd: "aws secretsmanager list-secrets --query 'SecretList[].Name'",
    tailLines: ['[', '    "recall/api-key",', '    "recall/db-password"', ']'] },
  'vault kv list': { turn: 1, seq: 0, kind: 'bash', cmd: 'vault kv list secret/recall', tailLines: ['Keys', '----', 'api-key', 'db-password'] },
  'docker login --password-stdin': { turn: 1, seq: 0, kind: 'bash', cmd: 'docker login -u bot --password-stdin registry.example.test < token.txt',
    tailLines: ['Login Succeeded'] },
  'pytest test_passwords.py': { turn: 1, seq: 0, kind: 'bash', cmd: 'pytest tests/test_passwords.py -q',
    tailLines: ['.......                                                                  [100%]', '7 passed in 0.12s'] },
  'git log -- password.py': { turn: 1, seq: 0, kind: 'bash', cmd: 'git log --oneline -3 -- src/auth/password.py',
    tailLines: ['2d7b9f4 Add password strength meter to signup', 'a4c81e0 Hash with argon2id', '33f9d27 Initial auth module'] },
  'read src/auth/token.ts': { turn: 1, seq: 0, kind: 'read', path: 'src/auth/token.ts',
    tailLines: numbered(["import { sign, verify } from 'jsonwebtoken';", "import { config } from '../config';", '',
      'export const ACCESS_TTL_SECONDS = 900;', 'export const REFRESH_TTL_SECONDS = 1209600;', '',
      'export function issue(userId: string) {', '  return sign({ sub: userId }, config.jwtSecret, { expiresIn: ACCESS_TTL_SECONDS });', '}']) },
  'write src/auth/password_policy.py': { turn: 1, seq: 0, kind: 'create', path: 'src/auth/password_policy.py',
    argsExcerpt: 'MIN_LENGTH = 12\nMAX_LENGTH = 128\nREQUIRE_DIGIT = True\n\ndef check(candidate):\n    return MIN_LENGTH <= len(candidate) <= MAX_LENGTH\n',
    after: { text: 'MIN_LENGTH = 12\nMAX_LENGTH = 128\nREQUIRE_DIGIT = True\n\ndef check(candidate):\n    return MIN_LENGTH <= len(candidate) <= MAX_LENGTH\n', truncated: false, lines: 7 } },
  'edit .env.example': { turn: 1, seq: 0, kind: 'edit', path: '.env.example', argsExcerpt: 'LOG_LEVEL=info\n⟪→⟫\nLOG_LEVEL=debug',
    diff: '-LOG_LEVEL=info\n+LOG_LEVEL=debug', after: { text: 'LOG_LEVEL=debug\n⟪→⟫\nLOG_LEVEL=info', truncated: false, lines: 3, parts: 1, priorParts: 1 } },
};
