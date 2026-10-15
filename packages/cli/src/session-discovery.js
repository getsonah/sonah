// B2: find parent recordings by native storage and recorded workspace metadata only.
// Discovery reads just enough opening metadata to choose a recording; the evidence loader
// remains responsible for whole-recording identity checks and linking every helper.
import { createReadStream } from 'node:fs';
import { readdir, realpath, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { claudeProjectsDir } from './claude-home.js';
import { strictJson } from '../../slicer/src/strict-json.js';

const execute = promisify(execFile);
// POSIX single-quote grammar, shared with the installer's copyable command hints.
const shellQuote = text => "'" + text.split("'").join("'\\''") + "'";
export const SESSIONS_USAGE = 'sonah sessions [--repo DIR]';
export const SESSION_DISCOVERY_FIX = 'Run Claude Code or Codex in this repository, then retry; '
  + 'or pass an existing recording path to sonah review. Use sonah doctor --no-probe to check recording locations.';
const DIRECTORY_FIX = 'Run from a readable repository or directory, or pass --repo with its correct path. '
  + 'Check read access to the configured Claude and Codex recording directories.';

/** A repository's exact physical root; a directory outside Git is its own workspace. */
async function workspace(directory) {
  const physical = await realpath(resolve(directory));
  if (!(await stat(physical)).isDirectory()) throw new Error('session_discovery_unavailable');
  try {
    const { stdout } = await execute('git', ['-C', physical, 'rev-parse', '--show-toplevel']);
    // Git terminates this path with one LF. A trailing space or newline may belong to the path.
    return await realpath(stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout);
  } catch { return physical; }
}

/** Native openings: Claude conversation rows carry cwd/sidechain/agentId; Codex's first
 * session_meta carries its own cwd and source. Do not retain message or tool text, and stop
 * once this opening establishes a candidate or a helper. A later contradiction is a loader
 * concern, not a discovery claim that the complete recording has been verified.
 */
async function openingMetadata(file, adapter) {
  const input = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      const parsed = strictJson(line);
      if (!parsed.strict || !parsed.value || Array.isArray(parsed.value) || typeof parsed.value !== 'object') return null;
      const row = parsed.value;
      if (adapter === 'codex') {
        if (row.type !== 'session_meta') continue;
        const meta = row.payload;
        if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.source?.subagent
          || meta.parent_thread_id != null || (meta.agent_path != null && meta.agent_path !== '/root')) return null;
        if (typeof meta.cwd !== 'string' || !isAbsolute(meta.cwd)) return null;
        return { cwd: meta.cwd, ...(typeof meta.id === 'string' ? { id: meta.id } : {}) };
      }
      if (row.isSidechain === true || row.agentId != null) return null;
      if (typeof row.cwd === 'string' && isAbsolute(row.cwd))
        return { cwd: row.cwd, ...(typeof row.sessionId === 'string' ? { id: row.sessionId } : {}) };
    }
  } catch { /* unreadable/malformed metadata cannot identify a candidate */ }
  finally { lines.close(); input.destroy(); }
  return null;
}

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch { return []; }
}

async function claudeFiles(root) {
  const files = [];
  // Claude Code: projects/<repo-slug>/<session>.jsonl. Helpers live below the session
  // directory in subagents/ and are deliberately not standalone choices.
  for (const project of await entries(root)) if (project.isDirectory()) {
    const directory = join(root, project.name);
    for (const entry of await entries(directory))
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(join(directory, entry.name));
  }
  return files;
}

async function codexFiles(root) {
  const files = [];
  // Codex: sessions/<year>/<month>/<day>/rollout-*.jsonl. These regexes are the
  // documented numeric directory/name grammar, never words from a session.
  for (const year of await entries(root)) if (year.isDirectory() && /^\d{4}$/.test(year.name)) {
    const yearDir = join(root, year.name);
    for (const month of await entries(yearDir)) if (month.isDirectory() && /^\d{2}$/.test(month.name)) {
      const monthDir = join(yearDir, month.name);
      for (const day of await entries(monthDir)) if (day.isDirectory() && /^\d{2}$/.test(day.name)) {
        const dayDir = join(monthDir, day.name);
        for (const entry of await entries(dayDir)) if (entry.isFile()
          && /^rollout-\d{4}-\d{2}-\d{2}T/.test(entry.name) && entry.name.endsWith('.jsonl'))
          files.push(join(dayDir, entry.name));
      }
    }
  }
  return files;
}

/** The resolved paths are private local inputs, never transcript excerpts. Empty or
 * unavailable recorder stores yield no matching readable parent; no size filter is applied.
 * Subdirectories and symlink spellings match by exact canonical Git root. Distinct repositories
 * with the same name, and nested repositories, remain distinct.
 */
export async function discoverSessions({ repo = process.cwd(), claudeProjects = claudeProjectsDir(),
  codexHome = process.env.CODEX_HOME || join(homedir(), '.codex') } = {}) {
  const current = await workspace(repo);
  const roots = { claude: resolve(claudeProjects), codex: join(resolve(codexHome), 'sessions') };
  const candidates = [...(await claudeFiles(roots.claude)).map((file) => ({ file, adapter: 'claude' })),
    ...(await codexFiles(roots.codex)).map((file) => ({ file, adapter: 'codex' }))];
  const workspaces = new Map(), sessions = [];
  for (const { file, adapter } of candidates) {
    const metadata = await openingMetadata(file, adapter);
    if (!metadata) continue;
    if (!workspaces.has(metadata.cwd)) workspaces.set(metadata.cwd, workspace(metadata.cwd).catch(() => null));
    if (await workspaces.get(metadata.cwd) !== current) continue;
    try {
      const info = await stat(file);
      if (!info.isFile()) continue;
      sessions.push({ file, adapter, ...metadata, modifiedMs: info.mtimeMs });
    } catch { /* a removed/unreadable candidate is no longer selectable */ }
  }
  sessions.sort((a, b) => b.modifiedMs - a.modifiedMs || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { repo: current, roots, sessions };
}

/** A read-only numbered list; choose explicitly through sonah review --choose N.
 * The local file identifies each choice on the user's own terminal. No recorded cwd,
 * session id, transcript text, or caught error message becomes terminal output.
 */
export async function runSessionsCommand(argv, { stdout = process.stdout, stderr = process.stderr,
  discover = discoverSessions, ...options } = {}) {
  let repo;
  if (argv.includes('--help') || argv.includes('-h')) { stdout.write(`usage: ${SESSIONS_USAGE}\n`); return 0; }
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--repo' || !argv[1] || argv[1].startsWith('--'))) {
    stderr.write(`usage: ${SESSIONS_USAGE}\n`); return 2;
  }
  if (argv.length) repo = argv[1];
  try {
    const found = await discover({ ...options, ...(repo === undefined ? {} : { repo }) });
    if (!found.sessions.length) {
      stdout.write(`No matching readable parent Claude Code or Codex recording was found. Fix: ${SESSION_DISCOVERY_FIX}\n`);
      if (found.roots) stdout.write(`Claude Code recordings: ${found.roots.claude}\nCodex recordings: ${found.roots.codex}\n`);
      return 1;
    }
    stdout.write('Parent recordings for this repository, newest first:\n');
    found.sessions.forEach((session, index) => {
      const adapter = session.adapter === 'claude' ? 'Claude Code' : 'Codex';
      stdout.write(`${index + 1}. ${adapter} · modified ${new Date(session.modifiedMs).toISOString()} · ${session.file} · sonah review --repo ${shellQuote(found.repo)} --choose ${index + 1}\n`);
    });
    return 0;
  } catch {
    stderr.write(`Session discovery could not complete. Fix: ${DIRECTORY_FIX}\n`);
    return 3;
  }
}
