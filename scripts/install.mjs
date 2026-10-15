#!/usr/bin/env node
// Install the reviewed source closure locally. No model, lifecycle hook or shell-profile edit.
import { mkdtemp, rm, access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packSource } from './package-source.mjs';

const run = promisify(execFile);
const args = process.argv.slice(2);
/** What npm said when it failed (the pack or the install): that it could not be started, or its exit code and then the
 *  start and the end of its error report. npm writes each report line as "npm error ..." (recent npm) or "npm ERR! ..."
 *  (older npm). The first lines name the error code and its cause (for example "code EPERM", then the path); the last
 *  line says where npm wrote its full log. Output with no such line is shown by its last line. Nothing when the
 *  failure was not npm's. */
const npmFailure = (error) => {
  if (error?.path !== 'npm' && !/^npm\s/.test(typeof error?.cmd === 'string' ? error.cmd : '')) return '';
  if (error?.code === 'ENOENT') return 'npm could not be started: it was not found on PATH.\n';
  const what = Number.isInteger(error?.code) ? `npm exited with code ${error.code}.`
    : error?.signal ? `npm was stopped (${error.signal}).` : '';
  if (!what) return '';
  const lines = String(error?.stderr ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
  const report = lines.filter((line) => /^npm (?:error|ERR!)\s+\S/.test(line));
  const said = report.length > 4 ? [...report.slice(0, 3), '...', report.at(-1)]
    : report.length ? report : lines.slice(-1);
  const cut = (line) => (line.length > 300 ? `${line.slice(0, 300)}...` : line);
  return said.length ? `${what} What it said:\n${said.map((line) => `  ${cut(line)}\n`).join('')}` : `${what}\n`;
};
/** The package name Sonah was installed under before it went to npm as `getsonah`. Such an install owns the `sonah`
 *  command in its prefix, and npm will not link the new package's command over another package's, so it is removed
 *  first: only when it is Sonah's own (its package.json gives this name and runs packages/cli/bin/sonah.js as `sonah`),
 *  never another package of that name, which npm then reports as it is. */
const EARLIER_NAME = 'sonah';
const earlierInstall = async (prefix) => {
  try {
    const pkg = JSON.parse(await readFile(join(prefix, 'lib', 'node_modules', EARLIER_NAME, 'package.json'), 'utf8'));
    return pkg?.name === EARLIER_NAME && pkg?.bin?.sonah === 'packages/cli/bin/sonah.js';
  } catch { return false; }
};
const usage = 'node scripts/install.mjs [--prefix DIR]';
const shellQuote = (text) => "'" + text.split("'").join("'\\''") + "'";
if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  process.stdout.write(`${usage}\nInstalls into ~/.local by default; no shell-profile edits.\n`);
} else if (args.length && (args.length !== 2 || args[0] !== '--prefix' || !args[1] || args[1].startsWith('-'))) {
  process.stderr.write(`usage: ${usage}\n`);
  process.exitCode = 2;
} else if (Number(process.versions.node.split('.')[0]) < 20) {
  process.stderr.write('Install requires Node.js 20 or newer. Install a current Node.js release (including npm), then rerun this command.\n');
  process.exitCode = 1;
} else {
  const prefix = args.length ? resolve(args[1]) : join(homedir(), '.local');
  let scratch;
  try {
    scratch = await mkdtemp(join(tmpdir(), 'sonah-install-'));
    const packed = await packSource({ outputDir: scratch });
    const replaced = await earlierInstall(prefix);
    if (replaced) {
      await run('npm', ['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund',
        EARLIER_NAME], { maxBuffer: 4 * 1024 * 1024 });
    }
    await run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', packed.path],
      { maxBuffer: 4 * 1024 * 1024 });
    const executable = join(prefix, 'bin', 'sonah');
    await access(executable, constants.X_OK);
    if (replaced) process.stdout.write(`Replaced the earlier install, named ${EARLIER_NAME}, in ${prefix}.\n`);
    process.stdout.write(`Installed Sonah: ${executable}\nRun: ${shellQuote(executable)} --help\n`);
    process.stdout.write(`To use sonah by name in this terminal: export PATH=${shellQuote(join(prefix, 'bin'))}:$PATH\n`);
  } catch (error) {
    process.stderr.write('Install did not complete. Check that Node.js 20+ and npm are installed, then rerun with --prefix /absolute/path/to/a/directory/you/own.\n');
    process.stderr.write(npmFailure(error));
    process.exitCode = 1;
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
  }
}
