import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeWorkerFiles, claudeWorkerInstructions, installClaudeWorkers } from '../src/cli-workers/claude.ts';
import { defaultT3Policy } from '../src/t3/routing.ts';

test('Claude worker definitions map each policy tier to native model and effort fields', () => {
  const policy = structuredClone(defaultT3Policy);
  policy.routing.claude.standard = { model: 'custom:model', effort: 'high' };
  const files = claudeWorkerFiles(policy);
  assert.equal(Object.keys(files).length, 4);
  assert.match(files['switchboard-standard.md']!, /^---\nname: switchboard-standard\n/m);
  assert.match(files['switchboard-standard.md']!, /model: "custom:model"\neffort: "high"/);
  assert.match(files['switchboard-standard.md']!, /Do not spawn or delegate/);
  assert.match(claudeWorkerInstructions(), /native Agent tool/);
});

test('install is idempotent and does not overwrite an edited agent', async () => {
  const project = await mkdtemp(join(tmpdir(), 'switchboard-claude-'));
  try {
    const paths = await installClaudeWorkers(project, defaultT3Policy);
    assert.equal(paths.length, 4);
    await installClaudeWorkers(project, defaultT3Policy);
    const edited = join(project, '.claude/agents/switchboard-standard.md');
    await writeFile(edited, 'personal content');
    await assert.rejects(installClaudeWorkers(project, defaultT3Policy), /already exists with different content/);
    assert.equal(await readFile(edited, 'utf8'), 'personal content');
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('install refuses a conflict before writing other worker definitions', async () => {
  const project = await mkdtemp(join(tmpdir(), 'switchboard-claude-'));
  try {
    await mkdir(join(project, '.claude/agents'), { recursive: true });
    const conflict = join(project, '.claude/agents/switchboard-demanding.md');
    await writeFile(conflict, 'user agent');
    await assert.rejects(installClaudeWorkers(project, defaultT3Policy), /already exists with different content/);
    await assert.rejects(readFile(join(project, '.claude/agents/switchboard-routine.md')), { code: 'ENOENT' });
  } finally { await rm(project, { recursive: true, force: true }); }
});

test('install refuses symlinked agent directories', async () => {
  const project = await mkdtemp(join(tmpdir(), 'switchboard-claude-'));
  const destination = await mkdtemp(join(tmpdir(), 'switchboard-elsewhere-'));
  try {
    await mkdir(join(project, '.claude'));
    await symlink(destination, join(project, '.claude/agents'));
    await assert.rejects(installClaudeWorkers(project, defaultT3Policy), /Expected a directory/);
  } finally {
    await rm(project, { recursive: true, force: true });
    await rm(destination, { recursive: true, force: true });
  }
});
