// R7: no live provider, registry package, user configuration or GitHub write.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, writeFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourcePackageFiles, assertPackageListing, SOURCE_ROOT } from '../../../scripts/package-source.mjs';
import { SESSION_REVIEW_CLAUDE_CLI_MODEL } from '../../evidence/src/run-review.js';
import { PROBE_REQUEST } from '../src/review-probe.js';
import { AGENT_OPTIONS_CHECK } from '../src/doctor.js';
import { session, toJsonl } from '../../golden/src/build.js';

const exec = promisify(execFile);

test('source package allowlist excludes data and rejects unexpected or missing members', async () => {
  const paths = await sourcePackageFiles();
  const pkg = JSON.parse(await readFile(join(SOURCE_ROOT, 'package.json'), 'utf8'));
  assertPackageListing(['package.json', ...pkg.files], paths);
  assert.equal(pkg.dependencies, undefined);
  assert.ok(paths.includes('THIRD_PARTY_NOTICES.md'));
  assert.ok(paths.includes('packages/cli/src/review-judge.js'));
  assert.ok(paths.includes('packages/cli/src/doctor.js'));
  assert.ok(paths.includes('packages/cli/src/review-probe.js'));
  assert.ok(paths.every((path) => !/(?:^|\/)(?:corpus|test|fixtures|dist|release)(?:\/|$)/.test(path)));
  assert.ok(paths.every((path) => path === 'package.json' || !path.endsWith('.json')), 'no data file');
  assert.throws(() => assertPackageListing([...paths, 'corpus/private.json'], paths));
  assert.throws(() => assertPackageListing(paths.slice(1), paths));
});

test('the npm package is getsonah: it installs the command sonah, is not private and runs no install script', async () => {
  const pkg = JSON.parse(await readFile(join(SOURCE_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'getsonah');
  assert.deepEqual(pkg.bin, { sonah: 'packages/cli/bin/sonah.js' });
  assert.equal(pkg.private, undefined);
  assert.deepEqual(['preinstall', 'install', 'postinstall'].filter((hook) => pkg.scripts?.[hook]), []);
});

test('a failed install names what npm said: its exit code, the start and end of its error report, or that it is not '
  + 'on PATH', { timeout: 60_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-install-failed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakeBin = join(directory, 'fake-bin'), emptyBin = join(directory, 'empty-bin'), home = join(directory, 'home');
  await mkdir(fakeBin); await mkdir(emptyBin); await mkdir(home);
  // A synthetic npm that fails the way npm 10 does: a Node warning, then its error report on stderr (the error code and
  // the cause first, the line naming its full log last), then a non-zero exit. SYNTHETIC_NPM=plain writes no report.
  await writeFile(join(fakeBin, 'npm'), `#!/bin/sh
if [ "$SYNTHETIC_NPM" = plain ]; then echo "synthetic first line" >&2; echo "synthetic last line" >&2; exit 3; fi
cat >&2 <<'EOF'
(node:1) ExperimentalWarning: a synthetic warning before the report
npm error code ESYNTHETIC
npm error syscall mkdir
npm error path /synthetic/prefix
npm error errno -1
npm error Error: ESYNTHETIC: a synthetic cause, mkdir '/synthetic/prefix'
npm error
npm error A synthetic explanation of the cause.
npm error A complete log of this run can be found in: /synthetic/_logs/debug-0.log
EOF
exit 7
`, { mode: 0o700 });
  const install = async (bin, env = {}) => {
    try {
      await exec(process.execPath, [join(SOURCE_ROOT, 'scripts/install.mjs'), '--prefix', join(directory, 'prefix')],
        { cwd: directory, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, ...env } });
      return assert.fail('the install must not complete');
    } catch (error) { return { code: error.code, stdout: error.stdout, stderr: error.stderr }; }
  };
  const generic = 'Install did not complete. Check that Node.js 20+ and npm are installed, then rerun with --prefix '
    + '/absolute/path/to/a/directory/you/own.\n';
  const failed = await install(fakeBin);
  assert.deepEqual([failed.code, failed.stdout], [1, '']);
  assert.equal(failed.stderr, `${generic}npm exited with code 7. What it said:\n  npm error code ESYNTHETIC\n`
    + '  npm error syscall mkdir\n  npm error path /synthetic/prefix\n  ...\n'
    + '  npm error A complete log of this run can be found in: /synthetic/_logs/debug-0.log\n');
  const plain = await install(fakeBin, { SYNTHETIC_NPM: 'plain' });
  assert.deepEqual([plain.code, plain.stderr], [1, `${generic}npm exited with code 3. What it said:\n`
    + '  synthetic last line\n']);
  // With no npm on PATH (and none in /usr/bin or /bin on this machine), the installer says so.
  const npmElsewhere = await exec('/bin/sh', ['-c', 'PATH=/usr/bin:/bin command -v npm']).then(() => true, () => false);
  if (!npmElsewhere) {
    const absent = await install(emptyBin);
    assert.deepEqual([absent.code, absent.stderr],
      [1, `${generic}npm could not be started: it was not found on PATH.\n`]);
  }
  await assert.rejects(stat(join(directory, 'prefix')), { code: 'ENOENT' });
});

test('the installer replaces an earlier install named sonah in its folder, and leaves another package of that name',
  { timeout: 240_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-install-earlier-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const home = join(directory, 'home'), userConfig = join(directory, 'npmrc');
  await mkdir(home); await writeFile(userConfig, '');
  const env = { HOME: home, PATH: `${dirname(process.execPath)}:${process.env.PATH}`, LANG: 'C.UTF-8',
    npm_config_cache: join(directory, 'npm-cache'), npm_config_userconfig: userConfig,
    npm_config_globalconfig: join(directory, 'no-global-npmrc'), npm_config_offline: 'true',
    npm_config_update_notifier: 'false' };
  const run = (file, args, cwd = directory) => exec(file, args, { cwd, env, maxBuffer: 4 * 1024 * 1024 });
  // A synthetic package named sonah, installed into the prefix with npm, its command printing `said`.
  const placeEarlier = async (prefix, bin, said) => {
    const source = join(directory, `source-${said}`);
    await mkdir(join(source, dirname(bin)), { recursive: true });
    await writeFile(join(source, 'package.json'), JSON.stringify({ name: 'sonah', version: '0.2.2-preview.8',
      bin: { sonah: bin } }));
    await writeFile(join(source, bin), `#!/usr/bin/env node\nconsole.log(${JSON.stringify(said)});\n`, { mode: 0o755 });
    const packed = JSON.parse((await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', directory],
      source)).stdout)[0].filename;
    await run('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund',
      join(directory, packed)]);
    assert.equal((await run(join(prefix, 'bin', 'sonah'), [])).stdout.trim(), said, 'premise: the earlier command');
  };
  const install = (prefix) => run(process.execPath, [join(SOURCE_ROOT, 'scripts/install.mjs'), '--prefix', prefix],
    SOURCE_ROOT);
  const version = JSON.parse(await readFile(join(SOURCE_ROOT, 'package.json'), 'utf8')).version;

  // Sonah's own earlier install: the installer removes it, then installs getsonah and its sonah command.
  const ours = join(directory, 'ours');
  await placeEarlier(ours, 'packages/cli/bin/sonah.js', 'earlier sonah');
  const replaced = await install(ours);
  assert.ok(replaced.stdout.startsWith(`Replaced the earlier install, named sonah, in ${ours}.\n`), replaced.stdout);
  assert.equal((await run(join(ours, 'bin', 'sonah'), ['--version'])).stdout.trim(), version);
  assert.deepEqual((await readdir(join(ours, 'lib', 'node_modules'))).sort(), ['getsonah']);

  // Another package named sonah (not Sonah's command): left in place, and npm's refusal is reported.
  const other = join(directory, 'other');
  await placeEarlier(other, 'cli.js', 'another package');
  const refused = await install(other).then(() => assert.fail('the install must not complete'), (error) => error);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /^Install did not complete\. /);
  assert.match(refused.stderr, /npm exited with code /);
  assert.equal((await run(join(other, 'bin', 'sonah'), [])).stdout.trim(), 'another package');
  assert.ok((await readdir(join(other, 'lib', 'node_modules'))).includes('sonah'));
});

test('one installer command in a fresh HOME produces an installed CLI and a synthetic HTML review without manual steps',
  { timeout: 120_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sonah-install-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const freshHome = join(directory, 'home'), prefix = join(freshHome, '.local');
  const work = join(directory, 'repo'), fakeBin = join(directory, 'fake-bin');
  await mkdir(freshHome); await mkdir(work); await mkdir(fakeBin);
  const userConfig = join(directory, 'npmrc'); await writeFile(userConfig, '');
  const env = { HOME: freshHome, PATH: `${fakeBin}:${dirname(process.execPath)}:${process.env.PATH}`, LANG: 'C.UTF-8',
    SONAH_HOME: join(freshHome, '.sonah'), SONAH_CODEX_BIN: join(fakeBin, 'codex-absent'), npm_config_cache: join(directory, 'npm-cache'),
    npm_config_userconfig: userConfig, npm_config_globalconfig: join(directory, 'no-global-npmrc'),
    npm_config_offline: 'true', npm_config_update_notifier: 'false',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
    GIT_AUTHOR_NAME: 'Synthetic Installer', GIT_AUTHOR_EMAIL: 'installer@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic Installer', GIT_COMMITTER_EMAIL: 'installer@example.invalid' };
  const run = (file, args, cwd = work) => exec(file, args, { cwd, env, maxBuffer: 4 * 1024 * 1024 });
  const installedOutput = await run(process.execPath, [join(SOURCE_ROOT, 'scripts/install.mjs')], SOURCE_ROOT);
  assert.ok(installedOutput.stdout.includes(join(prefix, 'bin', 'sonah')));
  assert.ok(installedOutput.stdout.includes('export PATH='));
  assert.deepEqual(await readdir(freshHome), ['.local']);
  const bin = join(prefix, 'bin', 'sonah'), installed = join(prefix, 'lib', 'node_modules', 'getsonah');
  assert.equal((await run(bin, ['--version'])).stdout.trim(),
    JSON.parse(await readFile(join(SOURCE_ROOT, 'package.json'), 'utf8')).version);
  const help = (await run(bin, ['review', '--help'])).stdout;
  assert.match(help, /--backend claude-cli\|codex-cli\|anthropic-api/);
  assert.match(help, /--format md\|html/);
  assert.deepEqual((await readdir(join(prefix, 'lib', 'node_modules'))).sort(), ['getsonah']);

  const expected = await sourcePackageFiles();
  for (const path of expected)
    assert.deepEqual(await readFile(join(installed, path)), await readFile(join(SOURCE_ROOT, path)), `installed source differs: ${path}`);

  // Session discovery reads the repository's top level from git.
  await run('git', ['-c', 'core.hooksPath=/dev/null', 'init', '--quiet']);
  const recording = join(directory, 'synthetic.jsonl');
  // B1: write bodies now travel, so an ordinary edit no longer makes a session UNCHECKED. The
  // remaining honest coverage loss is a body the RECORDER head-truncated, and this oversized
  // write is what still produces it — which is what the partial/complete split below tests.
  const oversizedBody = `export const notes = [\n${'  "the recorder caps a body when it is too long",\n'.repeat(450)}];\n`;
  await writeFile(recording, toJsonl(session({ cwd: work, sessionId: 'synthetic-install-recording' })
    .ask('SYNTHETIC_INSTALL_ASK: update the exported value.')
    .edit('a.js', 'export const value = 1;', 'export const value = 2;')
    .create('notes.js', oversizedBody)
    .say('The synthetic value was updated.').done()) + '\n');

  const callLog = join(directory, 'fake-calls'), probeLog = join(directory, 'fake-probes');
  const agentLog = join(directory, 'fake-agent-calls');
  await writeFile(join(fakeBin, 'claude'), `#!${process.execPath}\nconst fs = require('node:fs');
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') { console.log('2.1.278 (Claude Code)'); process.exit(0); }
if (args.join(' ') === 'auth status') { console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})); process.exit(0); }
// doctor's check that this CLI knows the agent transport's options (they come before auth status).
if (args.join(' ') === ${JSON.stringify(AGENT_OPTIONS_CHECK.join(' '))}) {
  console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'})); process.exit(0);
}
// The agent transport's argv: read-only tools, confined, a turn budget and a JSON schema, no partial messages.
const valueOf = (flag) => args[args.indexOf(flag) + 1];
const agent = valueOf('--tools') === 'Read,Grep,Glob';
if (agent && (!args.includes('--restricted') || valueOf('--permission-mode') !== 'dontAsk'
  || !/^[1-9][0-9]*$/.test(valueOf('--max-turns')) || args.includes('--include-partial-messages'))) process.exit(12);
if (!agent && valueOf('--tools') !== '' || !args.includes('--strict-mcp-config')) process.exit(8);
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  if (agent) {
    // An answer in the shape the request's schema asks for: each required member empty of its type.
    const schema = JSON.parse(valueOf('--json-schema')), empty = { array: [], object: {}, string: '', integer: 0,
      number: 0, boolean: false };
    const answer = Object.fromEntries((schema.required || []).map((key) => [key,
      empty[(schema.properties || {})[key]?.type] ?? null]));
    const model = valueOf('--model');
    fs.appendFileSync(${JSON.stringify(agentLog)}, JSON.stringify({ cwd: process.cwd(), input }) + '\\n');
    process.stdout.write(JSON.stringify({type:'system',subtype:'init',model,claude_code_version:'2.1.296',
      tools:['Glob','Grep','Read','StructuredOutput']}) + '\\n');
    process.stdout.write(JSON.stringify({type:'assistant',parent_tool_use_id:null,message:{model:model.replace('[1m]',''),
      role:'assistant',content:[{type:'tool_use',id:'toolu_1',name:'StructuredOutput',input:answer}]}}) + '\\n');
    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,num_turns:1,
      result:JSON.stringify(answer),structured_output:answer,
      modelUsage:{[model]:{contextWindow:1000000,maxOutputTokens:128000,inputTokens:2,outputTokens:4}}}) + '\\n');
    return;
  }
  if (input.includes(${JSON.stringify(PROBE_REQUEST.prompt)})) {
    const configured = ${JSON.stringify(SESSION_REVIEW_CLAUDE_CLI_MODEL)};
    if (args[args.indexOf('--model') + 1] !== configured) process.exit(10);
    fs.appendFileSync(${JSON.stringify(probeLog)}, 'probe\\n');
    const model = configured.replace('[1m]', ''), answer = JSON.stringify({ok:true});
    process.stdout.write(JSON.stringify({type:'system',subtype:'init',model:configured,claude_code_version:'2.1.278'}) + '\\n');
    process.stdout.write(JSON.stringify({type:'assistant',parent_tool_use_id:null,message:{model,role:'assistant',
      content:[{type:'text',text:answer}]}}) + '\\n');
    process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:answer,
      usage:{input_tokens:2,output_tokens:4},modelUsage:{[configured]:{contextWindow:1000000,maxOutputTokens:128000,
        inputTokens:2,outputTokens:4}}}) + '\\n');
    return;
  }
  if (!input.includes('SYNTHETIC_INSTALL_ASK')) process.exit(9);
  fs.appendFileSync(${JSON.stringify(callLog)}, input.includes('export const value = 2;') ? 'call+code\\n'
    : input.includes('synthetic linked helper receipt') ? 'call+helper\\n' : 'call\\n');
  const model = args[args.indexOf('--model') + 1];
  // D82 step 10: the session review is the one route, and it asks the frozen 1M model.
  if (model !== ${JSON.stringify(SESSION_REVIEW_CLAUDE_CLI_MODEL)}) process.exit(11);
  const review = {decisions:[],pivots:[],claims:[],requirements:[],failures:[],notClaims:[],forbiddenEdits:[]};
  // M33 refreeze: a real stream names its model in one system init event and in every top-level
  // assistant event before the result.
  process.stdout.write(JSON.stringify({type:'system',subtype:'init',model,claude_code_version:'2.1.278'}) + '\\n');
  process.stdout.write(JSON.stringify({type:'assistant',parent_tool_use_id:null,message:{model:model.replace('[1m]',''),role:'assistant',
    content:[{type:'text',text:JSON.stringify(review)}]}}) + '\\n');
  process.stdout.write(JSON.stringify({type:'result',subtype:'success',is_error:false,result:JSON.stringify(review),
    modelUsage:{[model]:{contextWindow:1000000,maxOutputTokens:128000,inputTokens:2,outputTokens:4}}}) + '\\n');
});\n`, { mode: 0o700 });

  // The installed doctor uses this same fake executable. Discovery-only must make no model
  // request; the explicit probe must make exactly one request with typed 1M stream metadata.
  const discovery = await run(bin, ['doctor', '--no-probe']);
  assert.match(discovery.stdout, /Claude sign-in: signed in/);
  assert.match(discovery.stdout, /Model: not checked \(--no-probe\)/);
  assert.match(discovery.stdout, /^Code step \(code-pass\): on \(the default\)\. /m);
  await assert.rejects(stat(probeLog), { code: 'ENOENT' });
  await assert.rejects(stat(callLog), { code: 'ENOENT' });
  const doctor = await run(bin, ['doctor', '--backend', 'claude-cli', '--model', SESSION_REVIEW_CLAUDE_CLI_MODEL]);
  assert.match(doctor.stdout, /answered one tiny synthetic request under the 1M context window/);
  assert.match(doctor.stdout, /^Claude code-step options: accepted \(--restricted, --max-turns, --json-schema\)\.$/m);
  // The installed agent transport, through the same fake executable: one agent request, answered in its schema's shape.
  const { createReviewJudge } = await import(pathToFileURL(join(installed, 'packages/cli/src/review-judge.js')).href);
  const agentAnswer = await createReviewJudge({ config: { backend: 'claude-cli', model: SESSION_REVIEW_CLAUDE_CLI_MODEL },
    env })({ system: 'SYNTHETIC_AGENT_SYSTEM', prompt: 'SYNTHETIC_AGENT_PROMPT', agent: { root: work, maxTurns: 3 },
    schema: { type: 'object', required: ['findings', 'note'], properties: { findings: { type: 'array' },
      note: { type: 'string' } } } });
  assert.deepEqual(agentAnswer, { findings: [], note: '' });
  assert.equal(agentAnswer.agentRun.toolCalls.StructuredOutput, 1);
  const [agentCall, ...moreAgentCalls] = (await readFile(agentLog, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual([agentCall.input, agentCall.cwd, moreAgentCalls], ['SYNTHETIC_AGENT_PROMPT', await realpath(work), []]);
  assert.equal(await readFile(probeLog, 'utf8'), 'probe\n', 'doctor probes once without retrying');
  await assert.rejects(stat(callLog), { code: 'ENOENT' });
  await assert.rejects(stat(env.SONAH_HOME), { code: 'ENOENT' });

  // D82 step 10: the installed session review of an explicit recording (the PR route this proof drove before is
  // removed): a dry run that calls and writes nothing, the page, then the same review again with no call.
  const args = ['review', recording];
  const dryOutput = join(directory, 'dry.html');
  const dry = await run(bin, [...args, '--format', 'html', '--output', dryOutput, '--dry-run']);
  assert.match(dry.stdout, /^Dry run: Sonah sent nothing to a model, and wrote or posted nothing\.$/m);
  await assert.rejects(stat(dryOutput), { code: 'ENOENT' });
  await assert.rejects(stat(callLog), { code: 'ENOENT' });
  await assert.rejects(stat(env.SONAH_HOME), { code: 'ENOENT' });
  // Owner decision 2026-10-14: the code step is on by default, and the dry run says so. The installed `sonah config`
  // then turns it off, so the reviews below are the session's alone (the code step has its own tests).
  assert.match(dry.stdout, /^Code review: on \(the default\)\. /m);
  const off = await run(bin, ['config', 'code-pass', 'off']);
  assert.equal(off.stdout, `code-pass: off (set in ${join(env.SONAH_HOME, 'config.json')}). A review reads and sends the `
    + 'session only. Change it with sonah config code-pass on, or for one review with --code-pass.\n');
  assert.equal((await stat(join(env.SONAH_HOME, 'config.json'))).mode & 0o777, 0o600);
  const output = join(directory, 'review.html');
  // D71 (a): the review ran to completion, so it exits 0 — the real adapter's head-truncated write body is a recorder
  // limit, named in the output, never an exit — and no status is printed or written.
  const reviewed = await run(bin, [...args, '--format', 'html', '--output', output, '--no-open']);
  // D118 (a): the code step is off by the setting, so "complete" names what is missing, and the next line says why.
  assert.match(reviewed.stdout, /^Sonah's review: complete, but no code was reviewed \(session review complete\)\.\nNo code was reviewed\. Reason: this review ran without the code review\./m);
  assert.match(reviewed.stdout, /^Not covered: /m);
  assert.ok(reviewed.stdout.includes(`Local page: ${output}`));
  assert.doesNotMatch(reviewed.stdout, /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/);
  const written = await readFile(output, 'utf8');
  assert.match(written, /^<!doctype html>/i);
  assert.match(written, /Content-Security-Policy/);
  assert.match(written, /SYNTHETIC_INSTALL_ASK/);
  assert.ok(!written.includes('<script'));
  assert.ok(!written.includes('https://'));
  assert.ok(!written.includes('http://'));
  assert.doesNotMatch(written, /\b(DECIDE|FYI|CLEAN|NO_FINDINGS|UNCHECKED)\b/);
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  // The recorded edit's body travels with the session (B1): the model saw the changed line.
  const callsAfterReview = await readFile(callLog, 'utf8');
  assert.match(callsAfterReview, /^call\+code\n/);
  // D60: the same review again re-runs every deterministic step, but every request is the same bytes, so each is
  // answered by its stored answer with no call.
  const again = await run(bin, args);
  assert.match(again.stdout, /^Sonah's review: complete, but no code was reviewed \(session review complete\)\./m);
  assert.match(again.stdout, /^Model answers: (\d+) of \1 reused \(no call\)\.$/m);
  assert.equal(await readFile(callLog, 'utf8'), callsAfterReview, 'the same requests were not sent again');

  // The installed PR comment wiring (B3, on the session review since D82 step 10), through an injected fake GitHub:
  // two metadata reads (before the first model call, and after the page so the comment binds the current head), the
  // comment shown, nothing posted without a confirmation.
  const installedCommand = await import(pathToFileURL(join(installed, 'packages/cli/src/session-review-command.js'))
    .href);
  let reads = 0, out = '';
  const shared = join(directory, 'shared.html');
  const code = await installedCommand.runSessionReviewCommand([recording, '--github', 'example/demo', '--pr', '7',
    '--post-comment', '--format', 'html', '--output', shared, '--no-open'], { cwd: work, installSignals: false,
    env: { ...env, SONAH_GITHUB_ACTOR_ID: '7', SONAH_GITHUB_APP_ID: '9' },
    stdout: { write: text => { out += text; } }, stderr: { write: () => {} }, confirm: async () => false,
    client: { async request(request) {
      reads++; assert.equal(request.method, 'GET'); assert.equal(request.path, '/repos/example/demo/pulls/7');
      return { status: 200, headers: {}, data: { number: 7, base: { sha: 'b'.repeat(40),
        repo: { id: 42, name: 'demo', private: true, owner: { login: 'example' } } }, head: { sha: 'a'.repeat(40) } } };
    } } });
  assert.equal(code, 0); assert.equal(reads, 2);
  assert.match(out, /^PR comment preview for example\/demo#7, head a{40}:\nSonah advisory review$/m);
  assert.match(out, /^Sonah did not post the PR comment\.$/m);
  assert.equal(await readFile(callLog, 'utf8'), callsAfterReview, 'the comment is built from stored answers');

  // B2: use native storage, no explicit recording or Git range, and a helper newer than its parent.
  // The installed command must pick the parent, link the helper, and reuse answers on the next run.
  const parentId = '11111111-2222-4333-8444-555555555555', helperId = '0123456789abcdef';
  const project = join(freshHome, '.claude', 'projects', work.replaceAll('/', '-'));
  const helperDirectory = join(project, parentId, 'subagents');
  await mkdir(helperDirectory, { recursive: true });
  const parentFile = join(project, `${parentId}.jsonl`), childFile = join(helperDirectory, `agent-${helperId}.jsonl`);
  const parents = session({ cwd: work, sessionId: parentId, version: '2.1.284' })
    .ask('SYNTHETIC_INSTALL_ASK: inspect the repository with a helper.')
    .tool('Agent', { prompt: 'SYNTHETIC_INSTALL_ASK: inspect a file in the linked helper.' }, 'synthetic launch',
      { sidecar: { status: 'async_launched', isAsync: true, agentId: helperId, description: 'inspect' } }).done();
  parents.push({ cwd: work, sessionId: parentId, isSidechain: false, version: '2.1.284', type: 'user',
    origin: { kind: 'task-notification' }, message: { role: 'user', content: `<task-notification>\n`
      + `<task-id>${helperId}</task-id>\n<tool-use-id>${parents[1].message.content[0].id}</tool-use-id>\n`
      + '<status>completed</status>\n<summary>Agent finished</summary>\n</task-notification>' } });
  const children = session({ cwd: work, sessionId: parentId, version: '2.1.284' })
    .ask('SYNTHETIC_INSTALL_ASK: inspect a file in the linked helper.')
    .read('a.js', 'synthetic linked helper receipt').done()
    .map(row => ({ ...row, agentId: helperId, isSidechain: true }));
  await writeFile(parentFile, toJsonl(parents) + '\n', { mode: 0o600 });
  await writeFile(childFile, toJsonl(children) + '\n', { mode: 0o600 });
  await utimes(parentFile, 1_000, 1_000); await utimes(childFile, 2_000, 2_000);
  const callsBeforeDiscovery = await readFile(callLog, 'utf8');
  const listed = await run(bin, ['sessions']);
  assert.ok(listed.stdout.includes(parentFile));
  assert.ok(!listed.stdout.includes(childFile), 'a newer helper must not become a parent choice');
  const sessionState = join(directory, 'session-state'), sessionDryOutput = join(directory, 'session-dry.html');
  await run(bin, ['review', '--choose', '1', '--dry-run', '--state-dir', sessionState,
    '--format', 'html', '--output', sessionDryOutput]);
  assert.equal(await readFile(callLog, 'utf8'), callsBeforeDiscovery);
  await assert.rejects(stat(sessionState), { code: 'ENOENT' });
  await assert.rejects(stat(sessionDryOutput), { code: 'ENOENT' });
  const sessionOutput = join(directory, 'session.html');
  const autoReviewed = await run(bin, ['review', '--format', 'html', '--output', sessionOutput, '--no-open', '--state-dir', sessionState]);
  assert.ok(autoReviewed.stdout.includes(parentFile));
  assert.ok(autoReviewed.stdout.includes(`Local page: ${sessionOutput}`));
  const afterSession = await readFile(callLog, 'utf8');
  assert.ok(afterSession.length > callsBeforeDiscovery.length);
  assert.ok(afterSession.slice(callsBeforeDiscovery.length).includes('call+helper'), 'the model receives linked helper evidence');
  assert.ok(!afterSession.slice(callsBeforeDiscovery.length).includes('call+code'), 'bare review never invents a code range');
  const sessionHtml = await readFile(sessionOutput, 'utf8');
  assert.match(sessionHtml, /^<!doctype html>/i);
  // D97: the page shows your prompt (the helper's brief was on the removed steps card; the call log above shows the
  // model received the linked helper's evidence).
  assert.match(sessionHtml, /inspect the repository with a helper/);
  assert.ok(!sessionHtml.includes('<script'));
  assert.equal((await stat(sessionOutput)).mode & 0o777, 0o600);
  await run(bin, ['review', '--choose', '1', '--state-dir', sessionState]);
  assert.equal(await readFile(callLog, 'utf8'), afterSession, 'choosing the same parent reuses exact stored answers');

  assert.equal(await readFile(probeLog, 'utf8'), 'probe\n', 'reviewing does not run another doctor probe');
  await run('npm', ['uninstall', '--global', '--prefix', prefix, '--ignore-scripts', 'getsonah']);
  await assert.rejects(stat(bin), { code: 'ENOENT' });
  await assert.rejects(stat(installed), { code: 'ENOENT' });
  assert.ok((await stat(output)).isFile(), 'uninstall preserves the requested report');
  assert.ok((await stat(env.SONAH_HOME)).isDirectory(), 'uninstall preserves review history');
});
