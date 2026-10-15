// M33 R repair 8 — the over-mask budget's benign corpus: realistic code, configs, logs, git output and prose that name
// keys, tokens and passwords and hold no secret. Every line is written here (no recording read); hashes, ids and
// timestamps are invented. Each document is one text, as a file body, a command's output or a message carries it, so the
// proximity rule's next-line scope reads it as it would read the real thing.
//
// Read by redact/test/m33-r-repair-8.test.js, which reports the share of lines kept byte for byte, per document and per
// channel, and lists every line that is not.

export const BENIGN_DOCUMENTS = {
  'auth middleware (TypeScript)': `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSecret } from './secrets';

const TOKEN_HEADER = 'authorization';
const API_KEY_HEADER = 'x-api-key';

export interface AuthOptions {
  issuer: string;
  audience: string;
  clockToleranceSeconds?: number;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers[TOKEN_HEADER];
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  const token = header.slice('Bearer '.length);
  try {
    const secret = await getSecret('JWT_SIGNING_KEY');
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    req.user = payload as UserClaims;
    return next();
  } catch (err) {
    logger.warn({ err, path: req.path }, 'token verification failed');
    return res.status(401).json({ error: 'invalid token' });
  }
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.get(API_KEY_HEADER);
  if (!apiKey) return res.status(401).send('API key required');
  if (!timingSafeEqual(Buffer.from(apiKey), Buffer.from(process.env.SERVICE_API_KEY ?? ''))) {
    return res.status(403).send('API key rejected');
  }
  return next();
}

// Refresh tokens live for 30 days; access tokens for 15 minutes.
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;`,

  'config loader (Python)': `import os
from dataclasses import dataclass
from functools import lru_cache


@dataclass(frozen=True)
class Settings:
    database_url: str
    redis_url: str
    openai_api_key: str
    stripe_secret_key: str
    session_secret: str
    token_ttl_seconds: int = 3600


@lru_cache(maxsize=1)
def load_settings() -> Settings:
    missing = [name for name in ("OPENAI_API_KEY", "STRIPE_SECRET_KEY", "SESSION_SECRET") if not os.environ.get(name)]
    if missing:
        raise RuntimeError(f"missing required secrets: {', '.join(missing)}")
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        redis_url=os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
        openai_api_key=os.environ["OPENAI_API_KEY"],
        stripe_secret_key=os.environ["STRIPE_SECRET_KEY"],
        session_secret=os.environ["SESSION_SECRET"],
        token_ttl_seconds=int(os.environ.get("TOKEN_TTL_SECONDS", "3600")),
    )


def masked(value: str) -> str:
    """Show the last four characters of a key in logs, never the key."""
    return "*" * 8 + value[-4:]`,

  '.env.example': `# Copy to .env.local and fill in. Never commit real values.
DATABASE_URL=postgres://localhost:5432/app_dev
REDIS_URL=redis://localhost:6379/0
OPENAI_API_KEY=
STRIPE_SECRET_KEY=sk_test_your_key_here
STRIPE_WEBHOOK_SECRET=whsec_replace_me
GITHUB_TOKEN=<your personal access token>
SESSION_SECRET=changeme
JWT_SIGNING_KEY=\${JWT_SIGNING_KEY}
SENTRY_DSN=
# Leave blank to disable the mailer.
SMTP_PASSWORD=
LOG_LEVEL=debug`,

  'docker-compose.yml': `version: "3.9"
services:
  db:
    image: postgres:16.2
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?set it in .env}
      POSTGRES_DB: app_dev
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
  redis:
    image: redis:7.2-alpine
    command: ["redis-server", "--requirepass", "\${REDIS_PASSWORD}"]
  api:
    build: .
    env_file: .env.local
    environment:
      NODE_ENV: development
      API_KEY_HEADER: x-api-key
    depends_on:
      - db
      - redis
    ports:
      - "3000:3000"
volumes:
  pgdata: {}`,

  'kubernetes deployment': `apiVersion: apps/v1
kind: Deployment
metadata:
  name: recall-api
  labels:
    app: recall-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: recall-api
  template:
    metadata:
      labels:
        app: recall-api
    spec:
      containers:
        - name: api
          image: ghcr.io/example/recall-api:1.14.2
          env:
            - name: RECALL_API_KEY
              valueFrom:
                secretKeyRef:
                  name: recall-secrets
                  key: api-key
            - name: DATABASE_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: recall-db
                  key: password
            - name: LOG_LEVEL
              value: info
          ports:
            - containerPort: 8080`,

  'GitHub Actions workflow': `name: deploy
on:
  push:
    branches: [main]
permissions:
  contents: read
  id-token: write
jobs:
  deploy:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/deploy
          aws-region: eu-west-1
      - name: Deploy
        env:
          RECALL_API_KEY: \${{ secrets.RECALL_API_KEY }}
          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}
        run: |
          echo "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}" > ~/.npmrc
          npm run deploy -- --env production`,

  'terraform variables': `variable "region" {
  type    = string
  default = "eu-west-1"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "api_token_ttl" {
  type        = number
  default     = 3600
  description = "Lifetime of an issued API token, in seconds"
}

resource "aws_secretsmanager_secret" "recall_api_key" {
  name        = "recall/api-key"
  description = "Recall API key for the sync job"
}

output "secret_arn" {
  value = aws_secretsmanager_secret.recall_api_key.arn
}`,

  'application log': `2026-09-30T08:14:02.117Z INFO  server listening on :8080 (pid 48213)
2026-09-30T08:14:05.402Z INFO  request_id=7f3a9b2c method=POST path=/v1/sync status=200 duration_ms=184
2026-09-30T08:14:05.403Z DEBUG token cache hit for tenant 42
2026-09-30T08:15:11.020Z WARN  access token expired, refreshing (tenant 42)
2026-09-30T08:15:11.391Z INFO  token refreshed for tenant 42, expires in 900s
2026-09-30T08:16:40.775Z ERROR auth: invalid API key for tenant 17 (key ending ...a91c)
2026-09-30T08:16:40.776Z INFO  request_id=c41d8e07 method=GET path=/v1/items status=401 duration_ms=3
2026-09-30T08:17:02.003Z INFO  password reset email queued for user 9921
2026-09-30T08:17:02.010Z INFO  job=send-email attempt=1 queue=mail
2026-09-30T08:18:30.512Z WARN  rate limit reached for api key prefix rk_live (tenant 17), retry in 30s
2026-09-30T08:19:44.120Z INFO  webhook signature verified (event evt_1Pq2Rs, type invoice.paid)
2026-09-30T08:19:44.121Z INFO  request_id=0b6e1f55 method=POST path=/webhooks/stripe status=200 duration_ms=41
2026-09-30T08:20:00.000Z INFO  cron: rotating signing key (next rotation 2026-10-30)
2026-09-30T08:20:00.212Z INFO  signing key rotated, kid=2026-09-30
2026-09-30T08:21:13.904Z ERROR db: password authentication failed for user "app" (attempt 2 of 5)
2026-09-30T08:21:15.910Z INFO  db: connected to postgres 16.2 on db.internal:5432
2026-09-30T08:22:47.331Z DEBUG credentials loaded from environment (3 keys)
2026-09-30T08:23:05.678Z INFO  GET /healthz 200 1ms
2026-09-30T08:23:35.678Z INFO  GET /healthz 200 1ms
2026-09-30T08:24:02.880Z WARN  bearer token missing on /v1/admin, rejecting`,

  'test runner output': `> recall-api@1.14.2 test
> node --test test/

▶ auth
  ✔ rejects a request with no bearer token (2.1ms)
  ✔ rejects an expired access token (1.4ms)
  ✔ accepts a valid token and sets req.user (3.8ms)
  ✔ refresh token rotation issues a new pair (5.2ms)
▶ auth (14.6ms)
▶ api keys
  ✔ requireApiKey returns 401 without a key (0.9ms)
  ✔ requireApiKey returns 403 for a wrong key (1.1ms)
  ✔ masked() shows only the last four characters (0.4ms)
▶ api keys (3.0ms)
▶ passwords
  ✔ hashes with argon2id and verifies (182.4ms)
  ✔ rejects a password shorter than 12 characters (0.6ms)
  ✔ password reset tokens are single use (7.9ms)
▶ passwords (191.5ms)
ℹ tests 10
ℹ suites 3
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 812.37`,

  'git output': `$ git log --oneline -15
4c1e9a7 Merge pull request #212 from example/rotate-signing-key
b83f2d0 Rotate the JWT signing key monthly
91aa6c4 Fix token refresh race when two tabs refresh at once
e05b7d2 Add requireApiKey middleware for the sync endpoint
2f8c113 Bump jsonwebtoken from 9.0.1 to 9.0.2
c7d94e1 Document the password policy in SECURITY.md
0a5e3f9 Mask API keys in request logs
6b21c88 Add rate limiting per tenant
f4e0d37 Use secretKeyRef for RECALL_API_KEY in the deployment
1d9b7a2 Store refresh tokens hashed (sha256)
88e4c1a Remove the legacy session cookie
3a7f6d0 Upgrade to Node 20
ae2b5f1 Add healthz endpoint
7c3d8e9 Initial commit
$ git status
On branch rotate-signing-key
Your branch is up to date with 'origin/rotate-signing-key'.

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
\tmodified:   src/auth/keys.ts
\tmodified:   src/auth/tokens.ts
\tmodified:   test/auth.test.ts

no changes added to commit (use "git add" and/or "git commit -a")
$ git diff --stat
 src/auth/keys.ts    | 24 +++++++++++++++++-------
 src/auth/tokens.ts  | 11 ++++++-----
 test/auth.test.ts   | 38 ++++++++++++++++++++++++++++++++++++++
 3 files changed, 56 insertions(+), 17 deletions(-)`,

  'npm and pip output': `$ npm install jsonwebtoken@9.0.2
added 15 packages, and audited 412 packages in 3s

58 packages are looking for funding
  run \`npm fund\` for details

found 0 vulnerabilities
$ pip install "passlib[argon2]==1.7.4" python-dotenv==1.0.1
Collecting passlib[argon2]==1.7.4
  Downloading passlib-1.7.4-py2.py3-none-any.whl (525 kB)
Collecting argon2-cffi>=18.2.0
  Using cached argon2_cffi-23.1.0-py3-none-any.whl (15 kB)
Installing collected packages: python-dotenv, argon2-cffi-bindings, argon2-cffi, passlib
Successfully installed argon2-cffi-23.1.0 argon2-cffi-bindings-21.2.0 passlib-1.7.4 python-dotenv-1.0.1`,

  'README (setup)': `# Recall API

The Recall API syncs notes between devices. It needs a Recall API key and a database.

## Getting an API key

1. Sign in to the dashboard.
2. Open **Settings → API keys** and click **Create key**.
3. Copy the key once; it is shown only at creation.

> **Note:** API keys are secrets. Do not paste them into issues, chat or commits.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| \`RECALL_API_KEY\` | yes | Your Recall API key |
| \`DATABASE_URL\` | yes | Postgres connection string |
| \`SESSION_SECRET\` | yes | Signs session cookies; 32 random bytes |
| \`TOKEN_TTL_SECONDS\` | no | Access token lifetime (default 3600) |
| \`SMTP_PASSWORD\` | no | Mailer password; leave unset to disable mail |

Set them in \`.env.local\` (see \`.env.example\`) or in your shell:

\`\`\`bash
export RECALL_API_KEY="<your key>"
export DATABASE_URL="postgres://localhost:5432/app_dev"
npm run dev
\`\`\`

## Rotating keys

Keys can be rotated at any time from the dashboard. The old key keeps working for 24 hours, so deploy the new one
before it expires. Webhook secrets rotate the same way.

## Passwords

User passwords are hashed with argon2id (memory 64 MiB, 3 iterations). A password must be at least 12 characters;
there is no other complexity rule. Password reset links expire after 30 minutes and work once.

## Troubleshooting

- \`401 invalid token\`: the access token expired; the client refreshes it automatically.
- \`403 API key rejected\`: the key was revoked or belongs to another workspace.
- \`password authentication failed\`: check \`DATABASE_URL\` and the database user's password.`,

  'agent explanation': `I traced the 401s to the token refresh path. Two tabs refresh at the same time, both send the same refresh token,
and the second request fails because refresh tokens are single use. The fix serializes refreshes per session.

What I changed:
- src/auth/tokens.ts: added a per-session mutex around refreshAccessToken()
- test/auth.test.ts: a test that fires two refreshes at once and expects one new token pair

The API key path is unaffected. I did not touch the signing key rotation.

I ran the suite: 10 passed, 0 failed. The password tests take about 180 ms because argon2id is slow on purpose.

One thing to check: STRIPE_WEBHOOK_SECRET is read at startup, so rotating it needs a restart. If you want, I can make
it reload on SIGHUP.

The secret you mentioned is not in the repo; I searched with \`git log -S\` and found nothing.
Your token from earlier was not printed anywhere in the output above.`,

  'SQL migration': `-- 0007_users_passwords.sql
CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  prefix      TEXT NOT NULL,
  key_hash    TEXT NOT NULL,
  last_used   TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);

CREATE INDEX api_keys_prefix_idx ON api_keys (prefix);
CREATE TABLE refresh_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users (id),
  expires_at  TIMESTAMPTZ NOT NULL
);`,

  'Go JWT signing': `package auth

import (
	"crypto/ed25519"
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var ErrNoSigningKey = errors.New("auth: no signing key configured")

type Signer struct {
	key    ed25519.PrivateKey
	keyID  string
	issuer string
}

func NewSigner(key ed25519.PrivateKey, keyID, issuer string) (*Signer, error) {
	if len(key) == 0 {
		return nil, ErrNoSigningKey
	}
	return &Signer{key: key, keyID: keyID, issuer: issuer}, nil
}

func (s *Signer) AccessToken(subject string, ttl time.Duration) (string, error) {
	claims := jwt.RegisteredClaims{Subject: subject, Issuer: s.issuer, ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl))}
	token := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	token.Header["kid"] = s.keyID
	return token.SignedString(s.key)
}`,

  'shell session': `$ gh auth status
github.com
  ✓ Logged in to github.com account octocat (keyring)
  - Active account: true
  - Git operations protocol: https
  - Token: gho_************************************
  - Token scopes: 'gist', 'read:org', 'repo', 'workflow'
$ export GITHUB_TOKEN="$(gh auth token)"
$ curl -sS -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/example/recall-api/actions/runs?per_page=1 | jq '.workflow_runs[0].status'
"completed"
$ aws secretsmanager describe-secret --secret-id recall/api-key --query 'LastRotatedDate'
"2026-09-01T10:00:00+00:00"
$ kubectl get secret recall-secrets -o jsonpath='{.metadata.creationTimestamp}'
2026-08-14T09:30:11Z
$ op read "op://Engineering/Recall API/credential" >/dev/null && echo "key present"
key present
$ ssh-keygen -lf ~/.ssh/id_ed25519.pub
256 SHA256:Qm3yZt8h1U4vN0aRk2pW7dXcLs5eFj9gTb6oIq hello@example.invalid (ED25519)
$ pwd
/workspace/recall-api
$ echo $PWD
/workspace/recall-api`,

  'CHANGELOG': `## 1.14.2 (2026-09-30)

### Security
- API keys are now compared in constant time (#204).
- Refresh tokens are stored as SHA-256 hashes, never in plaintext (#198).
- The signing key rotates monthly; the previous key verifies tokens for 24 hours (#212).

### Fixed
- Token refresh race when two tabs refresh at once (#209).
- Password reset emails were sent twice when the user double-clicked (#201).

## 1.14.1 (2026-09-12)

### Changed
- Minimum password length raised from 10 to 12 characters.
- \`TOKEN_TTL_SECONDS\` default lowered from 7200 to 3600.`,

  'security policy (prose)': `# Security

## Reporting

Email security reports to the address in SECURITY.md. Please do not open a public issue for a leaked credential;
rotate it first, then tell us which key or token was exposed and when.

## Secrets in this repository

We keep no secrets in the repository. Configuration that needs a password, an API key or a token reads it from the
environment, and CI reads it from the repository's encrypted secrets. A pre-commit hook scans staged changes for
anything that looks like a private key, an AWS access key or a GitHub token and refuses the commit.

If you think a secret was committed:
1. Revoke the key or token in the provider's dashboard.
2. Open a private advisory.
3. Do not force-push to hide it; the old commit is already public.

## Password policy

- Passwords are at least 12 characters.
- We check new passwords against a list of breached passwords.
- Two-factor authentication is required for maintainers; recovery codes are shown once.
- Session tokens expire after 30 days of inactivity.`,

  'Dockerfile': `# syntax=docker/dockerfile:1.7
FROM node:20.17-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# The npm token is a build secret: it never lands in a layer.
RUN --mount=type=secret,id=npm_token \\
    NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci --omit=dev
COPY . .
RUN npm run build

FROM node:20.17-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER node
CMD ["node", "dist/server.js"]`,

  'docker build output': `#0 building with "desktop-linux" instance using docker driver
#1 [internal] load build definition from Dockerfile
#1 transferring dockerfile: 612B done
#2 [internal] load metadata for docker.io/library/node:20.17-alpine
#2 DONE 1.2s
#3 [build 1/6] FROM docker.io/library/node:20.17-alpine@sha256:2d07db07a2df6830718ae2a47db6fedce6745f5bcd174c398f2acdda90a11c03
#3 CACHED
#4 [build 4/6] RUN --mount=type=secret,id=npm_token     NPM_TOKEN="$(cat /run/secrets/npm_token)" npm ci --omit=dev
#4 3.912 added 213 packages in 3s
#4 DONE 4.4s
#5 exporting to image
#5 writing image sha256:7b1f0c9e4d2a6b8c3e5f7a9d1b3c5e7f9a2b4c6d8e0f1a3b5c7d9e1f3a5b7c9d 0.0s done
#5 naming to docker.io/example/recall-api:1.14.2 done`,

  'HTTP client (Python requests)': `import requests

from .settings import load_settings


class RecallClient:
    def __init__(self, base_url: str = "https://api.recall.example.test/v1", timeout: float = 10.0):
        settings = load_settings()
        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {settings.openai_api_key}",
            "User-Agent": "recall-sync/1.14.2",
        })
        self._base_url = base_url
        self._timeout = timeout

    def sync(self, notes: list[dict]) -> dict:
        response = self._session.post(f"{self._base_url}/sync", json={"notes": notes}, timeout=self._timeout)
        if response.status_code == 401:
            raise PermissionError("Recall rejected the API key; check RECALL_API_KEY")
        response.raise_for_status()
        return response.json()`,

  'pytest output': `============================= test session starts ==============================
platform darwin -- Python 3.12.4, pytest-8.3.2, pluggy-1.5.0
rootdir: /workspace/recall-sync
collected 9 items

tests/test_auth.py::test_missing_token_raises PASSED                      [ 11%]
tests/test_auth.py::test_bearer_header_is_set PASSED                      [ 22%]
tests/test_auth.py::test_api_key_rejected_maps_to_permission_error PASSED [ 33%]
tests/test_settings.py::test_missing_secrets_are_listed PASSED            [ 44%]
tests/test_settings.py::test_token_ttl_default PASSED                     [ 55%]
tests/test_settings.py::test_masked_shows_last_four PASSED                [ 66%]
tests/test_sync.py::test_sync_posts_notes PASSED                          [ 77%]
tests/test_sync.py::test_sync_retries_on_502 PASSED                       [ 88%]
tests/test_sync.py::test_timeout_is_passed PASSED                         [100%]

============================== 9 passed in 0.41s ===============================`,
};
