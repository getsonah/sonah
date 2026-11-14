#!/usr/bin/env node
// A stand-in for the claude CLI in tests: reads the prompt on stdin and prints stream-json lines as the real CLI does.
// It is driven by $HOME/fake-claude.json, { rules: [{ when, mode, text, model, cost }] }: the first rule whose `when`
// is in the prompt or the system prompt (or that has no `when`) decides the reply. Each call is logged to
// $HOME/fake-claude.log.jsonl as { argv, env, cwd, stdin }. It makes no network call.
// D226: mode `slow` replies as `ok` after the rule's `ms` milliseconds (a call still running when a test stops it), and
// first appends its process id to $HOME/fake-claude.pids, so a test can tell whether that process ended.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const home = process.env.HOME ?? '.';
const argv = process.argv.slice(2);
// A test runner that picks this file up as a test (any .mjs under test/) runs it with no CLI argv: do nothing then.
// It also does nothing in a HOME that a test did not set up, so it never writes into a real home folder.
if (!argv.includes('--print') || !existsSync(join(home, 'fake-claude.json'))) process.exit(0);
const system = argv[argv.indexOf('--system-prompt') + 1] ?? '';
const model = argv[argv.indexOf('--model') + 1] ?? 'unknown';

let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { stdin += c; });
process.stdin.on('end', () => {
  appendFileSync(join(home, 'fake-claude.log.jsonl'),
    JSON.stringify({ argv, env: process.env, cwd: process.cwd(), stdin }) + '\n');
  let rules = [];
  try { rules = JSON.parse(readFileSync(join(home, 'fake-claude.json'), 'utf8')).rules ?? []; } catch { /* none */ }
  const rule = rules.find((r) => !r.when || stdin.includes(r.when) || system.includes(r.when)) ?? { mode: 'ok', text: '{}' };
  reply(rule);
});

const served = (rule) => rule.model ?? (model === 'sonnet' ? 'claude-sonnet-test' : model);
const say = (o) => process.stdout.write(JSON.stringify(o) + '\n');

function reply(rule) {
  if (rule.mode === 'slow') {
    appendFileSync(join(home, 'fake-claude.pids'), `${process.pid}\n`);
    setTimeout(() => reply({ ...rule, mode: 'ok' }), rule.ms ?? 1000);
    return undefined;
  }
  say({ type: 'system', subtype: 'init', model: served(rule), claude_code_version: '0.0.0-test', tools: [] });
  const cost = rule.cost ?? 0.0125;
  switch (rule.mode ?? 'ok') {
    case 'ok':
      say({ type: 'assistant', message: { model: served(rule), content: [{ type: 'text', text: rule.text ?? '' }] },
        parent_tool_use_id: null });
      say({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
      say({ type: 'result', subtype: 'success', is_error: false, result: rule.text ?? '', total_cost_usd: cost,
        duration_ms: 5 });
      return process.exit(0);
    case 'usage_limit':
      say({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } });
      say({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'limit reached' }] },
        error: 'rate_limit', parent_tool_use_id: null });
      say({ type: 'result', subtype: 'success', is_error: true, result: 'limit reached', total_cost_usd: 0 });
      return process.exit(1);
    case 'auth':
      say({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'please sign in' }] },
        error: 'authentication_failed', parent_tool_use_id: null });
      say({ type: 'result', subtype: 'success', is_error: true, result: 'please sign in' });
      return process.exit(1);
    case 'overloaded':
      say({ type: 'result', subtype: 'success', is_error: true, result: 'overloaded', api_error_status: 529,
        total_cost_usd: 0 });
      return process.exit(1);
    case 'exit':
      return process.exit(2);
    case 'no_result':
      return process.exit(0);
    case 'hang':
      setInterval(() => {}, 1000);
      return undefined;
    default:
      return process.exit(3);
  }
}
