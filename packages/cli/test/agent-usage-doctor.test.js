// The agent transport in the CLI around it: the usage tally keeps the turns and cost agent calls report, and `sonah
// doctor` checks once, with no model call, that the installed claude accepts the agent options. Every byte here is
// synthetic; no CLI or model is started, and each test gets its own temporary HOME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_CLI_OPTIONS } from '../src/review-judge.js';
import { createReviewBudget } from '../src/review-budget.js';
import { AGENT_OPTIONS_CHECK, doctor } from '../src/doctor.js';
import { writeCodePass } from '../src/settings.js';

async function scratch(t, name) {
  const dir = await mkdtemp(join(tmpdir(), `sonah agent ${name}-`));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

// ---- the usage tally -----------------------------------------------------------------------------------------------
test('agent transport: the usage tally keeps turns and cost, and the usage line names turns only when an agent ran', async () => {
  const request = { system: 'S', prompt: 'P' };
  const budget = createReviewBudget();
  const judge = budget.wrap(async (metadata) => { budget.record(metadata); return {}; });
  await judge({ usage: { input_tokens: 1, output_tokens: 1 }, costUsd: 0.25 });
  const before = budget.summaryLine();
  assert.doesNotMatch(before, /turns/, 'no agent request ran');
  await judge({ usage: { input_tokens: 1, output_tokens: 1 }, costUsd: 0.5, agentRun: { numTurns: 12 } });
  await judge({ usage: null, costUsd: null, agentRun: { numTurns: null } });
  const state = budget.snapshot();
  assert.deepEqual([state.agentCalls, state.turns, state.turnsReportedCalls, state.costUsd, state.costReportedCalls],
    [2, 12, 1, 0.75, 2]);
  assert.match(budget.summaryLine(), /; output tokens 2 \(2\/3 calls reported\); agent turns 12 \(1\/2 agent calls reported\); wall /);
  const unreported = createReviewBudget();
  await unreported.wrap(async () => { unreported.record({ agentRun: {} }); return {}; })(request);
  assert.equal(unreported.snapshot().turns, null);
  assert.match(unreported.summaryLine(), /agent turns not reported \(0\/1 agent calls reported\)/);
  assert.equal(createReviewBudget().snapshot().costUsd, 0);
});

// ---- doctor ------------------------------------------------------------------------------------------------------
test('agent transport: doctor checks once, with no model call, that claude accepts the agent options, and says plainly '
  + 'when it does not', async (t) => {
  assert.deepEqual(AGENT_CLI_OPTIONS, ['--restricted', '--max-turns', '--json-schema']);
  assert.ok(AGENT_CLI_OPTIONS.every((option) => AGENT_OPTIONS_CHECK.includes(option)));
  assert.deepEqual(AGENT_OPTIONS_CHECK.slice(-2), ['auth', 'status']);
  const home = await scratch(t, 'doctor-home');
  const signedIn = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' });
  const run = async ({ accepts, backend = 'claude-cli', codePass = undefined, authReadable = true }) => {
    const commands = [];
    await rm(join(home, '.sonah'), { recursive: true, force: true });
    if (codePass !== undefined) await writeCodePass(codePass, { env: { HOME: home }, home });
    const runCli = async (file, args) => {
      commands.push(args);
      if (file !== 'claude') throw Object.assign(new Error('absent'), { code: 'ENOENT' });
      if (args[0] === '--version') return { stdout: '2.1.296 (Claude Code)\n' };
      if (args.join(' ') === 'auth status') return { stdout: authReadable ? signedIn : 'unreadable' };
      if (args.join(' ') === AGENT_OPTIONS_CHECK.join(' '))
        if (accepts) return { stdout: authReadable ? signedIn : 'unreadable' };
        else throw Object.assign(new Error('unknown option'), { code: 1, stdout: '' });
      throw new Error('unexpected command');
    };
    const result = await doctor({ probe: false, ...(backend === 'claude-cli' ? {} : { backend, model: 'gpt-synthetic-1' }) },
      { env: { HOME: home, PATH: '/synthetic/bin', SONAH_CODEX_BIN: '/synthetic/codex' }, home, nodeVersion: '20.0.0',
        runCli, adapters: async () => ({ claude: { count: 0, where: 'x' }, codex: { count: 0, where: 'y' } }) });
    return { result, commands };
  };
  const accepted = await run({ accepts: true });
  assert.equal(accepted.result.facts.agentOptions.state, 'accepted');
  assert.match(accepted.result.text, /^Claude code-step options: accepted \(--restricted, --max-turns, --json-schema\)\.$/m);
  assert.equal(accepted.result.healthy, true);
  assert.equal(accepted.commands.filter((args) => args.join(' ') === AGENT_OPTIONS_CHECK.join(' ')).length, 1, 'checked once');
  const refused = await run({ accepts: false });
  assert.equal(refused.result.facts.agentOptions.state, 'refused');
  assert.match(refused.result.text, /^Claude code-step options: this Claude Code refused at least one of --restricted, --max-turns, --json-schema, which the code step's review agent needs\. Fix: Update Claude Code with claude update/m);
  assert.ok(refused.result.attention.includes('claude_agent'));
  assert.doesNotMatch(refused.result.text, /unknown option/, 'the CLI\'s own text is never shown');
  // With the code step off, or on another backend, nothing a review runs needs them: said, not attention.
  for (const settings of [{ accepts: false, codePass: false }, { accepts: false, backend: 'codex-cli' }]) {
    const quiet = await run(settings);
    assert.equal(quiet.result.facts.agentOptions.state, 'refused');
    assert.ok(!quiet.result.attention.includes('claude_agent'), JSON.stringify(settings));
  }
  // When even the plain sign-in check cannot be read, the options cannot be told apart: not checked, no attention.
  const unknown = await run({ accepts: false, authReadable: false });
  assert.equal(unknown.result.facts.agentOptions.state, 'unknown');
  assert.ok(!unknown.result.attention.includes('claude_agent'));
  assert.match(unknown.result.text, /^Claude code-step options: not checked/m);
});
