// Materiality is a closed rule over grounded actions. These synthetic actions exercise each path rule of
// MATERIALITY_RULES, through the rank that applies them (evidence/src/materiality.js `materialityOf`), and the trust
// boundaries, without reading transcripts or making any model calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATERIALITY_RULES, materialityOf } from '../src/materiality.js';

const decision = (extra = {}) => ({
  dimension: 'implementation mechanism', chosen: 'the observed implementation', ...extra,
});
// One grounded action on one path (none when the path is absent); a created file is a write.
const rankPath = (path, kind = 'edit', extra = {}) => materialityOf(decision(extra),
  [{ operation: kind === 'create' ? 'write' : kind, paths: path === undefined ? [] : [{ path }] }]).materiality;

test('dependency manifests and lockfiles are material', () => {
  for (const path of [
    'package.json', 'packages/app/package.json', 'package-lock.json', 'npm-shrinkwrap.json',
    'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'requirements.txt',
    'pyproject.toml', 'poetry.lock', 'uv.lock', 'Pipfile', 'Pipfile.lock',
    'Cargo.toml', 'Cargo.lock', 'go.mod', 'go.sum', 'Gemfile', 'Gemfile.lock',
    'composer.json', 'composer.lock', 'pom.xml', 'build.gradle.kts', 'gradle.lockfile',
    'packages.lock.json', 'app.csproj', 'library.fsproj', 'requirements-dev.txt',
  ]) assert.equal(rankPath(path), 'material', path);
});

test('schema and migration paths are material', () => {
  for (const path of [
    'db/schema.sql', 'prisma/schema.prisma', 'schemas/user.json',
    'migrations/001-add-user.sql', 'db/migration/001-user.js', 'src/user.schema.ts',
    'src/user.migration.ts',
  ]) assert.equal(rankPath(path), 'material', path);
});

test('routes, handlers and public API paths are material', () => {
  for (const path of [
    'src/routes/users.ts', 'src/route.ts', 'src/api/users.ts',
    'src/handlers/users.js', 'src/public-api.ts', 'src/public_api.ts',
    'src/routes/+server.ts', 'openapi.yaml', 'swagger.json',
  ]) assert.equal(rankPath(path), 'material', path);
});

test('config and CI paths are material', () => {
  for (const path of [
    '.github/workflows/test.yml', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml',
    'azure-pipelines.yml', 'Dockerfile', 'docker-compose.yml', 'config/deploy.yml',
    'vite.config.ts', 'tsconfig.json', 'tsconfig.build.json', 'settings.toml',
    '.eslintrc.cjs', '.prettierrc', 'Dockerfile.production',
  ]) assert.equal(rankPath(path), 'material', path);
});

test('auth and secrets paths are material', () => {
  for (const path of [
    'src/auth/session.ts', 'src/authentication.ts', 'src/authorization.ts',
    'secrets/deploy.json', 'credentials/deploy.json', 'permissions/read.ts',
    '.env', '.env.example', 'certificates/server.pem', 'certificates/server.key',
  ]) assert.equal(rankPath(path), 'material', path);
});

test('every deletion is material, including tests, copy, styling and unnamed paths', () => {
  for (const path of ['src/old.js', 'test/helper.test.js', 'README.md', 'styles.css', undefined]) {
    assert.equal(rankPath(path, 'delete', { dimension: 'naming' }), 'material', String(path));
  }
});

test('material path rules respect filename and directory boundaries', () => {
  for (const path of [
    'package.json.bak', 'src/routesmith.ts', 'src/apiary.ts', 'src/author.ts',
    'src/tokenize.js', 'src/configuration-helper.ts', 'schematics/helper.js',
  ]) assert.equal(rankPath(path), 'structural', path);
  assert.equal(rankPath('C:\\repo\\.github\\workflows\\test.yml'), 'material');
});

test('new source modules are structural', () => {
  for (const path of ['src/new.js', 'src/new.ts', 'src/widget.tsx', 'src/worker.py']) {
    assert.equal(rankPath(path, 'create', { dimension: 'naming' }), 'structural', path);
  }
  assert.equal(rankPath('docs/example.js', 'create'), 'structural', 'source modules outrank copy directories');
  assert.equal(rankPath('src/auth/new.ts', 'create', { dimension: 'file placement' }), 'material');
});

test('known styling and copy paths are cosmetic', () => {
  for (const path of [
    'src/styles.css', 'src/styles.scss', 'src/styles.less', 'src/styles.sass', 'src/styles.styl',
    'README.md', 'docs/usage.md', 'locale/en.json', 'i18n/en.json', 'copy/welcome.json',
  ]) {
    assert.equal(rankPath(path), 'cosmetic', path);
  }
  assert.equal(rankPath('src/styles.css', 'create'), 'cosmetic');
});

test('M33 brittleness M8: the dimension text is never read — paths and actions alone rank a decision', () => {
  // The placement and naming phrase rules decided nothing; they are gone. An edit to existing code is
  // structural whatever its dimension says; a style or copy path is cosmetic whatever its dimension says.
  for (const dimension of ['naming', 'variable name', 'function naming', 'method names', 'class name', 'parameter names',
    'identifier name', 'file placement', 'directory layout', 'database name and retention policy']) {
    assert.equal(rankPath('src/worker.js', 'edit', { dimension }), 'structural', dimension);
    assert.equal(rankPath('src/worker.js', 'bash', { dimension }), 'structural', dimension);
    assert.equal(rankPath('docs/usage.md', 'edit', { dimension }), 'cosmetic', dimension);
    assert.equal(rankPath('styles.css', 'edit', { dimension }), 'cosmetic', dimension);
    assert.equal(rankPath('package.json', 'edit', { dimension }), 'material', dimension);
  }
  assert.ok(!('placement' in MATERIALITY_RULES) && !('naming' in MATERIALITY_RULES));
});

test('model-supplied ranks cannot override the path rules', () => {
  assert.equal(rankPath('package.json', 'edit', { rank: 'cosmetic', materiality: 'cosmetic', confidence: 1 }), 'material');
  assert.equal(rankPath('styles.css', 'edit', { rank: 'material', materiality: 'material', confidence: 1 }), 'cosmetic');
});

test('the rule list is frozen', () => {
  assert.ok(Object.isFrozen(MATERIALITY_RULES));
  for (const value of Object.values(MATERIALITY_RULES)) assert.ok(Object.isFrozen(value));
});
