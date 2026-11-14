// Layer 2, the call: one request to the claude CLI in print mode (`claude -p`), the prompt on stdin.
// The argv, the clean environment and the reading of the stream follow how Sonah's session review calls the CLI.
// A failure is a TransportError whose `kind` is one of TRANSPORT_ERRORS, read from the stream's typed fields only,
// never from its text.

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Why a call failed (closed). */
export const TRANSPORT_ERRORS = Object.freeze([
  'usage_limit',     // a rate limit or usage limit was reached
  'auth',            // not signed in, or the key or account was refused
  'billing',         // the account cannot pay for the call
  'model_not_found', // the model asked for does not exist for this account
  'cli_missing',     // the CLI could not be started
  'timeout',         // our own time limit stopped the call
  'output_limit',    // the CLI printed more than the bound
  'provider_busy',   // the provider was overloaded or failed on its side (the CLI has already retried)
  'call_failed',     // anything else: a non-zero exit, an error result, no result
]);

/** Kinds after which no further call can succeed: the job stops and says why. */
export const STOP_ERRORS = Object.freeze(['usage_limit', 'auth', 'billing', 'model_not_found', 'cli_missing']);

export class TransportError extends Error {
  constructor(kind, { costUsd = null, ms = null, exitCode = null } = {}) {
    super(`claude call failed: ${kind}`);
    this.name = 'TransportError';
    this.kind = TRANSPORT_ERRORS.includes(kind) ? kind : 'call_failed';
    this.costUsd = costUsd;
    this.ms = ms;
    this.exitCode = exitCode;
  }
}

export const DEFAULT_TIMEOUT_MS = 10 * 60_000;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
/** With a deadline, a call starts only while at least this much is left before it (the private client's rule: less
 *  is too little for claude to answer). */
export const DEADLINE_MIN_MS = 1_000;
const KILL_GRACE_MS = 5_000;  // SIGTERM, then SIGKILL after this
const STDIO_GRACE_MS = 2_000; // after SIGKILL, settle without `close` after this

/** The argv of one call, as Sonah's session calls use it; `--effort` only when one is given. */
export function claudeArgs({ system, model, effort = null }) {
  return ['--print', '--model', model, ...(effort ? ['--effort', effort] : []),
    '--output-format', 'stream-json', '--verbose', '--tools', '', '--disable-slash-commands',
    '--setting-sources', '', '--mcp-config', '{"mcpServers":{}}', '--strict-mcp-config',
    '--no-session-persistence', '--system-prompt', system];
}

// Kept from the parent as they are: home, user and shell, path, language, certificates.
const KEPT = Object.freeze(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'USER', 'LOGNAME', 'SHELL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']);
// The account the CLI runs on: the server's API key, or a login given by environment or config folder.
const ACCOUNT = Object.freeze(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']);
// Set on every call, whatever the parent set: no title request, no fallback model, no memory, no plugins or hooks,
// no CLAUDE.md, and a five-minute prompt cache.
const SET = Object.freeze({
  CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1', CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK: '1',
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_SAFE_MODE: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
  FORCE_PROMPT_CACHING_5M: '1',
});

/** The environment of one call: nothing else of the parent's reaches the CLI (no other CLAUDE_* setting). */
export function claudeEnv(env = process.env) {
  const out = {};
  for (const k of KEPT) if (env[k] != null) out[k] = env[k];
  for (const k of ACCOUNT) if (typeof env[k] === 'string' && env[k] !== '') out[k] = env[k];
  return { ...out, ...SET };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Typed values to kinds. The assistant `error` enum of the CLI's stream, and the API status.
const ERROR_KIND = Object.freeze(Object.assign(Object.create(null), {
  rate_limit: 'usage_limit', authentication_failed: 'auth', oauth_org_not_allowed: 'auth', account_on_hold: 'auth',
  verification_required: 'auth', cloud_credential_error: 'auth', billing_error: 'billing',
  model_not_found: 'model_not_found', overloaded: 'provider_busy', server_error: 'provider_busy',
}));
const STATUS_KIND = Object.freeze(Object.assign(Object.create(null), {
  401: 'auth', 402: 'billing', 403: 'auth', 404: 'model_not_found', 429: 'usage_limit', 529: 'provider_busy',
}));
const statusKind = (s) => (Number.isSafeInteger(s) ? STATUS_KIND[s] ?? (s >= 500 && s <= 599 ? 'provider_busy'
  : 'call_failed') : 'call_failed');
// When several are seen, the first of these wins.
const PRECEDENCE = Object.freeze(['usage_limit', 'auth', 'billing', 'model_not_found', 'provider_busy', 'call_failed']);

/** What one call's stream-json output says, by typed fields: the models, the last result, the failure kinds seen. */
export function readStream(output) {
  const s = { initModel: null, servedModel: null, result: null, kinds: new Set() };
  for (const line of output.split('\n')) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!isObj(e) || typeof e.type !== 'string') continue;
    if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string') s.initModel ??= e.model;
    else if (e.type === 'assistant') {
      const model = isObj(e.message) ? e.message.model : null;
      if (typeof model === 'string' && model !== '<synthetic>') s.servedModel = model;
      if (typeof e.error === 'string') s.kinds.add(ERROR_KIND[e.error] ?? 'call_failed');
      if (e.api_error_status != null) s.kinds.add(statusKind(e.api_error_status));
    } else if (e.type === 'result') {
      s.result = e;
      if (e.api_error_status != null) s.kinds.add(statusKind(e.api_error_status));
    } else if (e.type === 'rate_limit_event') {
      const info = isObj(e.rate_limit_info) ? e.rate_limit_info : e;
      if (info.status === 'rejected') s.kinds.add('usage_limit');
    }
  }
  return s;
}

const okResult = (r) => isObj(r) && r.subtype === 'success' && r.is_error !== true && typeof r.result === 'string';
const costOf = (r) => (isObj(r) && Number.isFinite(r.total_cost_usd) ? r.total_cost_usd : null);

/**
 * A transport: async (request) -> { text, model, costUsd, ms }, or a thrown TransportError.
 * Each call runs in a fresh empty folder, so no repository setting is read. `env` is the parent environment the clean
 * one is taken from (tests pass their own).
 * Two stops from outside, each null by default (then every call runs as it always did):
 * - `deadline`, a time in milliseconds on Date.now()'s clock (a background job's last minute): each call's time limit
 *   is the shorter of `timeoutMs` and what is left before it, so a call still running then stops as its own time limit
 *   stops it, `timeout`; a call asked with less than DEADLINE_MIN_MS left fails at once as `timeout`, and no claude
 *   starts. Such a call's claude leads a process group of its own (not on Windows, which has none): every stop of it
 *   signals the whole group, so what that claude started ends with it, and the group is killed if this process exits
 *   while the call runs (a job's backstop exit).
 * - `signal`, an AbortSignal (a person's Ctrl-C or SIGTERM): once it is aborted, a call still running stops, and a call
 *   asked after it fails at once without starting claude, each as `call_failed`.
 */
export function claudeTransport({ bin = 'claude', model = 'sonnet', effort = null, timeoutMs = DEFAULT_TIMEOUT_MS,
  env = process.env, maxOutputBytes = MAX_OUTPUT_BYTES, deadline = null, signal = null } = {}) {
  if (deadline !== null && !Number.isFinite(deadline)) throw new TypeError('claudeTransport: deadline is a time');
  const transport = async (request) => {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    if (signal?.aborted) throw new TransportError('call_failed');
    const left = deadline === null ? Infinity : deadline - Date.now();
    if (left < DEADLINE_MIN_MS) throw new TransportError('timeout');
    const dir = await mkdtemp(join(tmpdir(), 'sonah-visual-call-'));
    try {
      const run = await runOnce({ bin, argv: claudeArgs({ system: request.system, model, effort }),
        cwd: dir, env: claudeEnv(env), input: request.prompt, timeoutMs: Math.min(timeoutMs, left), maxOutputBytes,
        signal, group: deadline !== null && process.platform !== 'win32' });
      if (run.spawnFailed) throw new TransportError('cli_missing', { ms: elapsed() });
      const s = readStream(run.output);
      const costUsd = costOf(s.result);
      if (run.stop) throw new TransportError(run.stop, { costUsd, ms: elapsed(), exitCode: run.exitCode });
      if (run.exitCode === 0 && okResult(s.result)) {
        return { text: s.result.result, model: s.servedModel ?? s.initModel ?? model, costUsd, ms: elapsed() };
      }
      const kind = PRECEDENCE.find((k) => s.kinds.has(k)) ?? 'call_failed';
      throw new TransportError(kind, { costUsd, ms: elapsed(), exitCode: run.exitCode });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  transport.by = 'claude-cli';
  transport.model = model;
  return transport;
}

// The process groups of the calls running with a deadline. They are not in this process's group, so they are killed
// when this process exits first (one 'exit' listener, added with the first of them).
const groups = new Set();
let groupsEndOnExit = false;
function trackGroup(pid) {
  groups.add(pid);
  if (groupsEndOnExit) return;
  groupsEndOnExit = true;
  process.on('exit', () => { for (const g of groups) try { process.kill(-g, 'SIGKILL'); } catch { /* gone */ } });
}

/** Start the CLI once, write the prompt, collect stdout. Never reads stderr (it can echo input). `signal` stops it
 *  (`call_failed`); with `group`, the CLI leads a process group of its own, and a stop signals the whole group. */
function runOnce({ bin, argv, cwd, env, input, timeoutMs, maxOutputBytes, signal = null, group = false }) {
  return new Promise((resolve) => {
    let child, output = '', size = 0, stop = null, done = false, closed = false;
    let timer = null, graceTimer = null;
    const onAbort = () => halt('call_failed');
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ output, stop, ...r });
    };
    const kill = (how) => {
      if (group) try { process.kill(-child.pid, how); return; } catch { /* the group is gone: the child alone */ }
      try { child.kill(how); } catch { /* already gone */ }
    };
    const halt = (why) => {
      if (stop || closed) return;
      stop = why;
      kill('SIGTERM');
      graceTimer = setTimeout(() => {
        if (closed) return;
        kill('SIGKILL');
        graceTimer = setTimeout(() => {
          for (const p of [child.stdin, child.stdout, child.stderr]) try { p?.destroy(); } catch { /* ignore */ }
          finish({ exitCode: null });
        }, STDIO_GRACE_MS);
      }, KILL_GRACE_MS);
    };
    // Stopped before it started: no claude.
    if (signal?.aborted) {
      stop = 'call_failed';
      finish({ exitCode: null });
      return;
    }
    try {
      child = spawn(bin, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], ...(group ? { detached: true } : {}) });
    } catch {
      finish({ spawnFailed: true, exitCode: null });
      return;
    }
    if (group && Number.isSafeInteger(child.pid)) {
      trackGroup(child.pid);
      child.once('close', () => groups.delete(child.pid));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    child.on('error', () => { if (!closed) finish({ spawnFailed: stop === null && output === '', exitCode: null }); });
    timer = setTimeout(() => halt('timeout'), timeoutMs);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (stop) return;
      size += Buffer.byteLength(chunk);
      if (size > maxOutputBytes) { halt('output_limit'); return; }
      output += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('close', (exitCode) => { closed = true; finish({ exitCode }); });
  });
}
