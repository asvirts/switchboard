import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('native worker setup installs project definitions and preserves existing instructions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-workers-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  await mkdir(project);
  await writeFile(join(project, 'AGENTS.md'), 'Existing Codex guidance.\n');
  await writeFile(join(project, 'CLAUDE.md'), 'Existing Claude guidance.\n');
  const run = () => spawnSync(process.execPath, [entry, 'workers', 'init'], {
    cwd: project, env: { HOME: root, SWITCHBOARD_HOME: join(root, 'config'), PATH: '' }, encoding: 'utf8',
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const agents = await readFile(join(project, 'AGENTS.md'), 'utf8');
  const claude = await readFile(join(project, 'CLAUDE.md'), 'utf8');
  assert.match(agents, /^Existing Codex guidance\./);
  assert.match(agents, /switchboard_routine/);
  assert.match(claude, /^Existing Claude guidance\./);
  assert.match(claude, /switchboard-routine/);
  assert.match(await readFile(join(project, '.codex/agents/switchboard_routine.toml'), 'utf8'), /gpt-6-luna/);
  assert.match(await readFile(join(project, '.claude/agents/switchboard-routine.md'), 'utf8'), /claude-haiku-5-5/);
  const again = run();
  assert.equal(again.status, 0, again.stderr);
  assert.equal(await readFile(join(project, 'AGENTS.md'), 'utf8'), agents);
  assert.equal(await readFile(join(project, 'CLAUDE.md'), 'utf8'), claude);
  const custom = join(project, '.codex/agents/switchboard_routine.toml');
  await writeFile(custom, 'user content\n');
  assert.equal(run().status, 2);
  assert.equal(await readFile(custom, 'utf8'), 'user content\n');
});

test('setup checks both instruction files before installing worker definitions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-workers-conflict-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'CLAUDE.md'), '<!-- switchboard:workers:start -->\n');
  const result = spawnSync(process.execPath, [entry, 'workers', 'init'], {
    cwd: root, env: { HOME: root, SWITCHBOARD_HOME: join(root, 'config'), PATH: '' }, encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  await assert.rejects(readFile(join(root, '.codex/agents/switchboard_routine.toml')), { code: 'ENOENT' });
  assert.equal(await readFile(join(root, 'CLAUDE.md'), 'utf8'), '<!-- switchboard:workers:start -->\n');
});
