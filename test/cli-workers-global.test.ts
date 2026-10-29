import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';

const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

async function sandbox(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-global-workers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const codex = join(root, 'custom codex home');
  const claude = join(root, 'custom claude home');
  const config = join(root, 'switchboard');
  const project = join(root, 'project');
  await Promise.all([home, codex, claude, config, project].map(dir => mkdir(dir, { recursive: true })));
  await Promise.all([
    writeFile(join(codex, 'AGENTS.md'), 'Ignored Codex instruction.\n'),
    writeFile(join(codex, 'AGENTS.override.md'), 'Existing Codex instruction.\n'),
    writeFile(join(claude, 'CLAUDE.md'), 'Existing Claude instruction.\n'),
    writeFile(join(codex, 'config.toml'), 'model = "original"\n'),
    writeFile(join(claude, 'settings.json'), '{"original":true}\n'),
  ]);
  const env: NodeJS.ProcessEnv = { HOME: home, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, SWITCHBOARD_HOME: config, PATH: '' };
  function cli(...args: string[]) {
    const result = spawnSync(process.execPath, [entry, ...args], { env, cwd: project, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    return result;
  }
  return { root, home, codex, claude, config, project, cli };
}

test('global workers install for both custom homes, preserve settings and coexist with T3', async t => {
  const s = await sandbox(t);
  const t3 = s.cli('t3', 'init', '--global');
  assert.equal(t3.status, 0, t3.stderr);
  const policyFile = join(s.config, 't3-policy.json');
  const policy = JSON.parse(await readFile(policyFile, 'utf8'));
  policy.routing.codex.routine.model = 'custom-codex-model';
  policy.routing.claude.standard.model = 'custom-claude-model';
  const policyText = JSON.stringify(policy, null, 2) + '\n';
  await writeFile(policyFile, policyText);
  const initial = s.cli('workers', 'status', '--global');
  assert.equal(initial.status, 0, initial.stderr);
  assert.equal(JSON.parse(initial.stdout).installed, false);
  const result = s.cli('workers', 'init', '--global');
  assert.equal(result.status, 0, result.stderr);
  const codex = await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8');
  const claude = await readFile(join(s.claude, 'CLAUDE.md'), 'utf8');
  assert.match(codex, /Existing Codex instruction/);
  assert.match(claude, /Existing Claude instruction/);
  assert.match(codex, /switchboard:t3:global:start/);
  assert.match(claude, /switchboard:t3:global:start/);
  assert.match(codex, /switchboard_routine/);
  assert.match(claude, /switchboard-routine/);
  assert.match(await readFile(join(s.codex, 'agents', 'switchboard_routine.toml'), 'utf8'), /custom-codex-model/);
  assert.match(await readFile(join(s.claude, 'agents', 'switchboard-standard.md'), 'utf8'), /custom-claude-model/);
  assert.equal(await readFile(join(s.codex, 'AGENTS.md'), 'utf8'), 'Ignored Codex instruction.\n');
  assert.equal(await readFile(join(s.codex, 'config.toml'), 'utf8'), 'model = "original"\n');
  assert.equal(await readFile(join(s.claude, 'settings.json'), 'utf8'), '{"original":true}\n');
  assert.equal(await readFile(policyFile, 'utf8'), policyText);
  await assert.rejects(readFile(join(s.project, 'AGENTS.md')), { code: 'ENOENT' });
  const current = s.cli('workers', 'status', '--global');
  assert.equal(current.status, 0, current.stderr);
  assert.equal(JSON.parse(current.stdout).installed, true);
  const again = s.cli('workers', 'init', '--global');
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8'), codex);
  assert.equal(await readFile(join(s.claude, 'CLAUDE.md'), 'utf8'), claude);
  assert.equal(await readFile(policyFile, 'utf8'), policyText);
  const removed = s.cli('workers', 'uninstall', '--global');
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8'), /switchboard:t3:global:start/);
  assert.match(await readFile(join(s.claude, 'CLAUDE.md'), 'utf8'), /switchboard:t3:global:start/);
  assert.doesNotMatch(await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8'), /switchboard_routine/);
  assert.doesNotMatch(await readFile(join(s.claude, 'CLAUDE.md'), 'utf8'), /switchboard-routine/);
  await assert.rejects(readFile(join(s.codex, 'agents', 'switchboard_routine.toml')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(s.claude, 'agents', 'switchboard-standard.md')), { code: 'ENOENT' });
  assert.equal(await readFile(policyFile, 'utf8'), policyText);
  assert.equal(JSON.parse(s.cli('workers', 'status', '--global').stdout).installed, false);
});

test('global install refuses existing conflicting agent definitions before modifying instructions', async t => {
  const s = await sandbox(t);
  await mkdir(join(s.claude, 'agents'));
  const path = join(s.claude, 'agents', 'switchboard-routine.md');
  await writeFile(path, 'User-owned definition.\n');
  const result = s.cli('workers', 'init', '--global');
  assert.equal(result.status, 2);
  assert.equal(await readFile(path, 'utf8'), 'User-owned definition.\n');
  assert.equal(await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8'), 'Existing Codex instruction.\n');
  assert.equal(await readFile(join(s.claude, 'CLAUDE.md'), 'utf8'), 'Existing Claude instruction.\n');
  await assert.rejects(readFile(join(s.codex, 'agents', 'switchboard_routine.toml')), { code: 'ENOENT' });
});

test('global uninstall preserves a modified worker and reports it', async t => {
  const s = await sandbox(t);
  const installed = s.cli('workers', 'init', '--global');
  assert.equal(installed.status, 0, installed.stderr);
  const path = join(s.codex, 'agents', 'switchboard_routine.toml');
  await writeFile(path, 'User edited worker.\n');
  const removed = s.cli('workers', 'uninstall', '--global');
  assert.equal(await readFile(path, 'utf8'), 'User edited worker.\n');
  assert.match(removed.stdout + removed.stderr, /preserv|modif|edit|chang|conflict/i);
});

test('global uninstall does not delete an identical worker that existed before setup', async t => {
  const s = await sandbox(t);
  assert.equal(s.cli('workers', 'init', '--global').status, 0);
  const path = join(s.codex, 'agents', 'switchboard_routine.toml');
  const content = await readFile(path, 'utf8');
  assert.equal(s.cli('workers', 'uninstall', '--global').status, 0);
  await writeFile(path, content);
  const installed = s.cli('workers', 'init', '--global');
  assert.equal(installed.status, 0, installed.stderr);
  const removed = s.cli('workers', 'uninstall', '--global');
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(await readFile(path, 'utf8'), content);
});

test('global install refuses symlinked agent directories', async t => {
  const s = await sandbox(t);
  const target = join(s.root, 'existing-agents');
  await mkdir(target);
  await symlink(target, join(s.codex, 'agents'));
  assert.equal(s.cli('workers', 'init', '--global').status, 2);
  assert.equal(await readFile(join(s.codex, 'AGENTS.override.md'), 'utf8'), 'Existing Codex instruction.\n');
  assert.equal(await readFile(join(s.claude, 'CLAUDE.md'), 'utf8'), 'Existing Claude instruction.\n');
});

test('global setup defaults to user homes when provider homes are not configured', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-default-homes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { HOME: root, SWITCHBOARD_HOME: join(root, 'state'), PATH: '' };
  const result = spawnSync(process.execPath, [entry, 'workers', 'init', '--global'], {
    env, cwd: root, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(join(root, '.codex', 'AGENTS.md'), 'utf8'), /switchboard_routine/);
  assert.match(await readFile(join(root, '.claude', 'CLAUDE.md'), 'utf8'), /switchboard-routine/);
  assert.match(await readFile(join(root, '.codex', 'agents', 'switchboard_routine.toml'), 'utf8'), /gpt-6-luna/);
  assert.match(await readFile(join(root, '.claude', 'agents', 'switchboard-routine.md'), 'utf8'), /claude-haiku-5-5/);
});
