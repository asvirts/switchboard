import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';

const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

async function sandbox(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-t3-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const config = join(root, 'config');
  await Promise.all([mkdir(join(home, '.claude'), { recursive: true }), mkdir(join(home, '.codex'), { recursive: true }), mkdir(cwd, { recursive: true })]);
  const claude = join(home, '.claude', 'settings.json');
  const codex = join(home, '.codex', 'config.toml');
  await writeFile(claude, '{"original":true}\n');
  await writeFile(codex, 'model = "original"\n');
  const env: NodeJS.ProcessEnv = { HOME: home, SWITCHBOARD_HOME: config, PATH: '' };
  function cli(args: string[], input?: string) {
    const result = spawnSync(process.execPath, [entry, 't3', ...args], { env, cwd, input, encoding: 'utf8', timeout: 5000, maxBuffer: 4_000_000 });
    if (result.error && (result.error as NodeJS.ErrnoException).code !== 'EPIPE') assert.ifError(result.error);
    return result;
  }
  return { root, home, cwd, config, claude, codex, cli };
}

function request(task: string) {
  return {
    task, tier: 'routine', family: 'codex',
    capabilities: { inheritedProviderInstanceId: 'codex', providers: [{
      providerInstanceId: 'codex', driverKind: 'codex', canRunChildTask: true, canRunCrossProviderChildTask: true,
      models: [{ id: 'gpt-6-luna', options: [{ id: 'reasoningEffort', values: ['low'] }] }],
    }] },
  };
}

test('policy and instructions work without keys or executable providers', async t => {
  const s = await sandbox(t);
  const policy = s.cli(['policy']);
  assert.equal(policy.status, 0, policy.stderr);
  assert.equal(JSON.parse(policy.stdout).routing.codex.routine.model, 'gpt-6-luna');
  const instructions = s.cli(['instructions']);
  assert.equal(instructions.status, 0, instructions.stderr);
  assert.match(instructions.stdout, /<!-- switchboard:t3:start -->/);
  assert.ok(instructions.stdout.includes(entry));
  assert.match(instructions.stdout, /orchestrator_capabilities/);
  assert.deepEqual(await readdir(s.cwd), []);
  assert.deepEqual(await readdir(s.home), ['.claude', '.codex']);
});

test('init is repeatable and preserves existing project instructions, model policy, and native settings', async t => {
  const s = await sandbox(t);
  const agents = join(s.cwd, 'AGENTS.md');
  await writeFile(agents, '# Project guidance\n\nKeep this instruction.\n');
  const first = s.cli(['init']);
  assert.equal(first.status, 0, first.stderr);
  const initial = await readFile(agents, 'utf8');
  assert.match(initial, /^# Project guidance\n\nKeep this instruction\./);
  assert.equal(initial.split('<!-- switchboard:t3:start -->').length - 1, 1);
  const policyPath = join(s.config, 't3-policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.routing.codex.routine.model = 'custom-model';
  const custom = JSON.stringify(policy, null, 2) + '\n';
  await writeFile(policyPath, custom);
  const second = s.cli(['init']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(agents, 'utf8'), initial);
  assert.equal(await readFile(policyPath, 'utf8'), custom);
  assert.equal(await readFile(s.claude, 'utf8'), '{"original":true}\n');
  assert.equal(await readFile(s.codex, 'utf8'), 'model = "original"\n');
});

test('setup replaces only a well-formed managed block and rejects malformed markers', async t => {
  const s = await sandbox(t);
  const agents = join(s.cwd, 'AGENTS.md');
  await writeFile(agents, 'before\n<!-- switchboard:t3:start -->\nold managed text\n<!-- switchboard:t3:end -->\nafter\n');
  assert.equal(s.cli(['init']).status, 0);
  const updated = await readFile(agents, 'utf8');
  assert.match(updated, /^before\n/);
  assert.match(updated, /\nafter\n$/);
  assert.doesNotMatch(updated, /old managed text/);
  const malformed = 'before\n<!-- switchboard:t3:start -->\nunclosed\n';
  await writeFile(agents, malformed);
  assert.equal(s.cli(['init']).status, 2);
  assert.equal(await readFile(agents, 'utf8'), malformed);
});

test('setup rejects a symlinked AGENTS.md without changing its target', async t => {
  const s = await sandbox(t);
  const target = join(s.root, 'target.md');
  await writeFile(target, 'preserved\n');
  await symlink(target, join(s.cwd, 'AGENTS.md'));
  assert.equal(s.cli(['init']).status, 2);
  assert.equal(await readFile(target, 'utf8'), 'preserved\n');
});

test('route consumes JSON on stdin, emits a plan, and retains no task files', async t => {
  const s = await sandbox(t);
  const task = 'PRIVATE_SYNTHETIC_TASK\nwith details';
  const result = s.cli(['route'], JSON.stringify(request(task)));
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.selection.model, 'gpt-6-luna');
  assert.match(plan.delegation.task, /PRIVATE_SYNTHETIC_TASK\nwith details/);
  assert.equal(plan.verificationRequired, true);
  assert.deepEqual(await readdir(s.cwd), []);
  await assert.rejects(readdir(s.config), { code: 'ENOENT' });
  assert.equal(await readFile(s.claude, 'utf8'), '{"original":true}\n');
  assert.equal(await readFile(s.codex, 'utf8'), 'model = "original"\n');
});

test('route rejects malformed and oversized input without exposing its contents', async t => {
  const s = await sandbox(t);
  for (const body of ['{"task":"SECRET_PRIVATE_INPUT"', 'SECRET_PRIVATE_INPUT'.repeat(110_000), JSON.stringify({ ...request('bounded task'), SECRET_PRIVATE_INPUT: true })]) {
    const result = s.cli(['route'], body);
    assert.equal(result.status, 2);
    assert.doesNotMatch(result.stdout + result.stderr, /SECRET_PRIVATE_INPUT/);
  }
  assert.deepEqual(await readdir(s.cwd), []);
});
