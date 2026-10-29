import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { TestContext } from 'node:test';

const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const start = '<!-- switchboard:t3:global:start -->';
const end = '<!-- switchboard:t3:global:end -->';

async function sandbox(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-global-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const cwd = join(root, 'project');
  const config = join(root, 'config');
  const codexHome = join(home, '.codex');
  const claudeHome = join(home, '.claude');
  await Promise.all([mkdir(codexHome, { recursive: true }), mkdir(claudeHome, { recursive: true }), mkdir(cwd, { recursive: true })]);
  const codex = join(codexHome, 'AGENTS.md');
  const claude = join(claudeHome, 'CLAUDE.md');
  const codexSettings = join(codexHome, 'config.toml');
  const claudeSettings = join(claudeHome, 'settings.json');
  await Promise.all([
    writeFile(codex, '# Existing Codex instructions\nFollow my defaults.\n'),
    writeFile(claude, '# Existing Claude instructions\nFollow my defaults.\n'),
    writeFile(codexSettings, 'model = "original"\n'),
    writeFile(claudeSettings, '{"original":true}\n'),
  ]);
  const env: NodeJS.ProcessEnv = { HOME: home, SWITCHBOARD_HOME: config, PATH: '' };
  function cli(...args: string[]) {
    const result = spawnSync(process.execPath, [entry, 't3', ...args], { env, cwd, encoding: 'utf8', timeout: 5000 });
    assert.ifError(result.error);
    return result;
  }
  return { root, home, cwd, config, codexHome, claudeHome, codex, claude, codexSettings, claudeSettings, env, cli };
}

async function filesWithin(dir: string): Promise<Array<{ path: string; content: string; mode: number }>> {
  const found: Array<{ path: string; content: string; mode: number }> = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesWithin(path));
    else if (entry.isFile()) found.push({ path, content: await readFile(path, 'utf8'), mode: (await stat(path)).mode & 0o777 });
  }
  return found;
}

function status(cli: (...args: string[]) => ReturnType<typeof spawnSync>) {
  const result = cli('status', '--global');
  assert.equal(result.status, 0, String(result.stderr));
  return JSON.parse(String(result.stdout)) as { installed: boolean; workflow: string; targets: Array<{ file: string; installed: boolean }> };
}

test('global setup preserves provider instructions, settings and existing worker policy; it is idempotent', async t => {
  const s = await sandbox(t);
  const oldCodex = await readFile(s.codex, 'utf8');
  const oldClaude = await readFile(s.claude, 'utf8');
  const first = s.cli('init', '--global');
  assert.equal(first.status, 0, first.stderr);
  const codex = await readFile(s.codex, 'utf8');
  const claude = await readFile(s.claude, 'utf8');
  for (const [value, old] of [[codex, oldCodex], [claude, oldClaude]]) {
    assert.ok(value!.includes(old!));
    assert.equal(value!.split(start).length - 1, 1);
    assert.equal(value!.split(end).length - 1, 1);
    assert.ok(value!.includes(join(s.config, 't3-instructions.md')));
    assert.match(value!, /T3/i);
    assert.match(value!, /worker|child|subagent/i);
  }
  const workflow = await readFile(join(s.config, 't3-instructions.md'), 'utf8');
  assert.match(workflow, /orchestrator_capabilities/);
  assert.match(workflow, /delegate_task/);
  const backups = await filesWithin(join(s.config, 't3-global-backups'));
  assert.ok(backups.some(file => file.content === oldCodex && (file.mode & 0o077) === 0));
  assert.ok(backups.some(file => file.content === oldClaude && (file.mode & 0o077) === 0));
  const policyPath = join(s.config, 't3-policy.json');
  const existing = JSON.parse(await readFile(policyPath, 'utf8'));
  existing.routing.codex.routine.model = 'custom-model';
  const custom = JSON.stringify(existing) + '\n';
  await writeFile(policyPath, custom);
  const second = s.cli('init', '--global');
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await readFile(s.codex, 'utf8'), codex);
  assert.equal(await readFile(s.claude, 'utf8'), claude);
  assert.equal(await readFile(policyPath, 'utf8'), custom);
  assert.equal(await readFile(s.codexSettings, 'utf8'), 'model = "original"\n');
  assert.equal(await readFile(s.claudeSettings, 'utf8'), '{"original":true}\n');
  assert.deepEqual(await readdir(s.cwd), []);
  const current = status(s.cli);
  assert.equal(current.installed, true);
  assert.equal(current.workflow, join(s.config, 't3-instructions.md'));
  assert.deepEqual(new Set(current.targets.filter(target => target.installed).map(target => target.file)), new Set([s.codex, s.claude]));
});

test('global uninstall removes only managed instructions and leaves user edits and policy', async t => {
  const s = await sandbox(t);
  assert.equal(s.cli('init', '--global').status, 0);
  await writeFile(s.codex, (await readFile(s.codex, 'utf8')) + '\nA later user edit.\n');
  const remove = s.cli('uninstall', '--global');
  assert.equal(remove.status, 0, remove.stderr);
  const codex = await readFile(s.codex, 'utf8');
  const claude = await readFile(s.claude, 'utf8');
  assert.match(codex, /Existing Codex instructions/);
  assert.match(codex, /A later user edit/);
  assert.match(claude, /Existing Claude instructions/);
  assert.ok(!codex.includes(start) && !codex.includes(end));
  assert.ok(!claude.includes(start) && !claude.includes(end));
  assert.ok((await stat(join(s.config, 't3-policy.json'))).isFile());
  assert.ok((await stat(join(s.config, 't3-global-backups'))).isDirectory());
  assert.equal(status(s.cli).installed, false);
  const again = s.cli('uninstall', '--global');
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(s.codex, 'utf8'), codex);
  assert.equal(await readFile(s.claude, 'utf8'), claude);
});

test('global setup uses Codex override precedence and custom provider homes', async t => {
  const s = await sandbox(t);
  const override = join(s.codexHome, 'AGENTS.override.md');
  await writeFile(override, '# Existing override\n');
  let result = s.cli('init', '--global');
  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readFile(override, 'utf8')).includes(start));
  assert.ok(!(await readFile(s.codex, 'utf8')).includes(start));
  assert.equal(s.cli('uninstall', '--global').status, 0);

  const otherCodex = join(s.root, 'other-codex');
  const otherClaude = join(s.root, 'other-claude');
  await Promise.all([mkdir(otherCodex), mkdir(otherClaude)]);
  s.env.CODEX_HOME = otherCodex;
  s.env.CLAUDE_CONFIG_DIR = otherClaude;
  result = s.cli('init', '--global');
  assert.equal(result.status, 0, result.stderr);
  assert.ok((await readFile(join(otherCodex, 'AGENTS.md'), 'utf8')).includes(start));
  assert.ok((await readFile(join(otherClaude, 'CLAUDE.md'), 'utf8')).includes(start));
  assert.ok(!(await readFile(s.claude, 'utf8')).includes(start));
});

test('global setup preflights both instruction files before modifying either', async t => {
  for (const issue of ['malformed', 'symlink'] as const) {
    const s = await sandbox(t);
    const oldCodex = await readFile(s.codex, 'utf8');
    const malformed = `Existing\n${start}\nunclosed\n`;
    if (issue === 'malformed') await writeFile(s.claude, malformed);
    else {
      await rm(s.claude);
      await symlink(s.codex, s.claude);
    }
    const result = s.cli('init', '--global');
    assert.equal(result.status, 2);
    assert.equal(await readFile(s.codex, 'utf8'), oldCodex);
    if (issue === 'malformed') assert.equal(await readFile(s.claude, 'utf8'), malformed);
  }
});

test('global status reports missing workflow and invalid global flags fail', async t => {
  const s = await sandbox(t);
  assert.equal(s.cli('init', '--global').status, 0);
  await rm(join(s.config, 't3-instructions.md'));
  assert.equal(status(s.cli).installed, false);
  for (const args of [['init', '--global', '--unknown'], ['uninstall'], ['status']]) {
    assert.equal(s.cli(...args).status, 2);
  }
});
