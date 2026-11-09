#!/usr/bin/env node
// The package file of `getsonah`, from source only. No build, lifecycle hook, model call or publication.
import { readFile, lstat, realpath, mkdir, mkdtemp, copyFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const run = promisify(execFile);
export const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PACKAGE_ENTRY = 'packages/cli/bin/sonah.js';
// npm includes a package README even with a file allowlist (packages/github/README.md). The visual review's vendored
// code ships with its record and each upstream licence beside it.
export const PACKAGE_DOCUMENTS = Object.freeze([
  'package.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'README.md',
  'docs/INSTALL.md', 'docs/PRIVACY.md', 'docs/TROUBLESHOOTING.md', 'packages/github/README.md',
  'packages/visual/src/vendor/THIRD_PARTY.md', 'packages/visual/src/vendor/elkjs/LICENSE.md',
  'packages/visual/src/vendor/tree-sitter-go/LICENSE', 'packages/visual/src/vendor/tree-sitter-javascript/LICENSE',
  'packages/visual/src/vendor/tree-sitter-python/LICENSE', 'packages/visual/src/vendor/tree-sitter-typescript/LICENSE',
  'packages/visual/src/vendor/web-tree-sitter/LICENSE']);

/** A file the package runs or reads, by its path: a script (`.js`, `.mjs`, `.cjs`; a dotted name such as
 *  `page.client.js` too) or an asset a script reads (`.css`, `.hex`), inside a package. No data file. */
const RUNTIME_PATH = /^packages\/[\w-]+\/(?:[\w-]+\/)*[\w-]+(?:\.[\w-]+)*\.(?:m?js|cjs|css|hex)$/;
/** A script's local loads, each by a literal relative specifier: a static or lazy import; `new URL('./x',
 *  import.meta.url)`, less a folder (a specifier ending in `/`); `createRequire(import.meta.url)('./x')`. */
const LOADS = Object.freeze([
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g,
  /\bnew URL\(\s*['"](\.[^'"]*[^/'"])['"]\s*,\s*import\.meta\.url\s*\)/g,
  /\bcreateRequire\(\s*import\.meta\.url\s*\)\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
]);
/** Whether the text before `index`, on its line, opens a comment: a `//`, or a block comment's `/*` or `*` line. */
const inComment = (source, index) => {
  const before = source.slice(source.lastIndexOf('\n', index - 1) + 1, index);
  return /(?:^|\s)\/\//.test(before) || /^\s*(?:\/\*|\*)/.test(before);
};

/** Follow local loads, including lazy commands. Ship no audit/data tree. A vendored file (under a `vendor/` folder)
 *  and an asset are leaves: shipped as they are, never followed (a vendored bundle names files it never loads). */
export async function sourcePackageFiles(root = SOURCE_ROOT) {
  root = await realpath(root);
  const seen = new Set(PACKAGE_DOCUMENTS);
  async function regularSource(path) {
    let absolute = root;
    for (const part of path.split('/')) {
      absolute = join(absolute, part);
      if ((await lstat(absolute)).isSymbolicLink()) throw new Error('Package symlinks are not allowed');
    }
    if (!(await lstat(absolute)).isFile()) throw new Error('Package sources must be regular files');
    return absolute;
  }
  async function include(path) {
    path = path.split(sep).join('/');
    if (seen.has(path)) return;
    if (!RUNTIME_PATH.test(path) || /\/(?:test|fixtures)\//.test(path))
      throw new Error('Non-runtime import in package closure');
    const absolute = await regularSource(path);
    seen.add(path);
    if (/\/vendor\//.test(path) || !/\.(?:m?js|cjs)$/.test(path)) return;
    const source = await readFile(absolute, 'utf8');
    for (const pattern of LOADS) for (const match of source.matchAll(pattern)) {
      if (!inComment(source, match.index)) await include(relative(root, resolve(dirname(absolute), match[1])));
    }
  }
  await include(PACKAGE_ENTRY);
  for (const path of PACKAGE_DOCUMENTS) await regularSource(path);
  return [...seen].sort();
}

export function assertPackageListing(actual, expected) {
  const paths = actual.map((item) => typeof item === 'string' ? item : item.path).sort();
  if (JSON.stringify(paths) !== JSON.stringify([...expected].sort()))
    throw new Error('Package membership differs from the reviewed runtime closure');
}

export async function packSource({ root = SOURCE_ROOT, outputDir = join(root, 'release'), env = process.env } = {}) {
  const expected = await sourcePackageFiles(root);
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assertPackageListing(['package.json', ...pkg.files], expected);
  if (pkg.scripts?.preinstall || pkg.scripts?.install || pkg.scripts?.postinstall)
    throw new Error('The package must have no install hooks');
  const scratch = await mkdtemp(join(tmpdir(), 'sonah-pack-'));
  try {
    const { stdout } = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', scratch],
      { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });
    const [result] = JSON.parse(stdout);
    assertPackageListing(result.files, expected);
    if (result.filename !== `${pkg.name}-${pkg.version}.tgz`) throw new Error('Unexpected package filename');
    await mkdir(outputDir, { recursive: true });
    const target = join(outputDir, result.filename);
    await copyFile(join(scratch, result.filename), target);
    return { path: target, files: expected.length, bytes: result.size, integrity: result.integrity };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Run as a script (by its own path, a symlink to it, or a path with spaces; both sides resolved, so it holds under
 *  --preserve-symlinks-main too), never when imported. */
const invokedDirectly = () => {
  try { return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(new URL(import.meta.url)); }
  catch { return false; }
};

if (invokedDirectly()) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--output-dir')) {
    process.stderr.write('usage: node scripts/package-source.mjs [--output-dir DIR]\n');
    process.exitCode = 2;
  } else {
    try {
      const result = await packSource({ outputDir: args.length ? resolve(args[1]) : undefined });
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } catch {
      process.stderr.write('Source package withheld: metadata, membership, or npm pack validation failed.\n');
      process.exitCode = 1;
    }
  }
}
