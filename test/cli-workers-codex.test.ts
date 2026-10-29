import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'smol-toml';
import { codexWorkerFiles, installCodexWorkers } from '../src/cli-workers/codex.ts';
import { defaultT3Policy } from '../src/t3/routing.ts';

test('Codex roles use the configured model and effort without changing native permissions', () => {
  const policy = structuredClone(defaultT3Policy);
  policy.routing.codex.standard.model = 'custom-model';
  delete policy.routing.codex.standard.effort;
  const files = codexWorkerFiles(policy);
  assert.equal(files.length, 4);
  const routine = parse(files[0]!.content);
  assert.equal(routine.name, 'switchboard_routine');
  assert.equal(routine.model, 'gpt-6-luna');
  assert.equal(routine.model_reasoning_effort, 'low');
  assert.match(String(routine.developer_instructions), /do not spawn/);
  assert.equal(routine.sandbox_mode, undefined);
  assert.equal(routine.approval_policy, undefined);
  const standard = parse(files[1]!.content);
  assert.equal(standard.model, 'custom-model');
  assert.equal(standard.model_reasoning_effort, undefined);
});

test('installation is idempotent and refuses to overwrite an existing role', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-codex-workers-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const installed = await installCodexWorkers(root, defaultT3Policy);
  assert.equal(installed.length, 4);
  const first = await readFile(installed[0]!, 'utf8');
  await installCodexWorkers(root, defaultT3Policy);
  assert.equal(await readFile(installed[0]!, 'utf8'), first);
  await writeFile(installed[2]!, 'user content');
  await assert.rejects(installCodexWorkers(root, defaultT3Policy), /Refusing to overwrite/);
  assert.equal(await readFile(installed[2]!, 'utf8'), 'user content');
});

test('installation refuses a symlinked native agent directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'switchboard-codex-symlink-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, '.codex'));
  await mkdir(join(root, 'other'));
  await symlink(join(root, 'other'), join(root, '.codex', 'agents'));
  await assert.rejects(installCodexWorkers(root, defaultT3Policy), /real directory/);
});
